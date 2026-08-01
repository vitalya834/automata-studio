import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTestPlan, type TestPlan } from '../testing';
import { ModbusTcpAdapter, ModbusTcpAdapterError, type ModbusTcpAdapterOptions } from './modbus-tcp';
import { ModbusFixtureServer, exceptionReply } from '../../test-fixtures/modbus-tcp/fixture-server';

const servers: ModbusFixtureServer[] = [];
const adapters: ModbusTcpAdapter[] = [];

async function makeServer(): Promise<{ server: ModbusFixtureServer; port: number }> {
  const server = new ModbusFixtureServer();
  servers.push(server);
  const port = await server.start();
  return { server, port };
}

function makeAdapter(port: number, overrides: Partial<ModbusTcpAdapterOptions> = {}): ModbusTcpAdapter {
  const adapter = new ModbusTcpAdapter({
    host: '127.0.0.1',
    port,
    inputs: {
      read_lamp: {
        operation: { kind: 'readCoils', address: 10, quantity: 1 },
        outputs: [{ symbol: 'lamp_on', when: { kind: 'valueAt', index: 0, equals: 1 } }],
        otherwise: 'lamp_off',
      },
    },
    responseTimeoutMs: 5_000,
    ...overrides,
  });
  adapters.push(adapter);
  return adapter;
}

async function expectAdapterError(promise: Promise<unknown>, kind: ModbusTcpAdapterError['kind']): Promise<ModbusTcpAdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ModbusTcpAdapterError);
    const adapterError = error as ModbusTcpAdapterError;
    expect(adapterError.kind).toBe(kind);
    return adapterError;
  }
  throw new Error(`Expected rejection with kind ${kind}.`);
}

afterEach(async () => {
  // No socket or server survives a test.
  while (adapters.length > 0) {
    const adapter = adapters.pop();
    if (!adapter) break;
    await adapter.close();
    expect(adapter.connected).toBe(false);
  }
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server) break;
    await vi.waitFor(() => expect(server.openSocketCount).toBe(0));
    await server.stop();
  }
});

describe('happy path', () => {
  it('maps coil reads to output symbols through predicates', async () => {
    const { server, port } = await makeServer();
    const adapter = makeAdapter(port);
    await adapter.reset();

    server.coils.set(10, true);
    const on = await adapter.send('read_lamp');
    expect(on.output).toBe('lamp_on');
    expect(on.metadata).toMatchObject({ functionCode: 1, address: 10, values: [1] });
    expect(on.durationMs).toBeGreaterThanOrEqual(0);

    server.coils.set(10, false);
    const off = await adapter.send('read_lamp');
    expect(off.output).toBe('lamp_off');
    expect(off.metadata).toMatchObject({ values: [0] });
  });

  it('reads holding registers with equals and range predicates', async () => {
    const { server, port } = await makeServer();
    server.holdingRegisters.set(100, 42);
    server.holdingRegisters.set(101, 7);
    const adapter = makeAdapter(port, {
      inputs: {
        read_pair: {
          operation: { kind: 'readHoldingRegisters', address: 100, quantity: 2 },
          outputs: [
            { symbol: 'exact', when: { kind: 'equals', values: [42, 7] } },
            { symbol: 'high', when: { kind: 'valueAt', index: 0, min: 100 } },
          ],
          otherwise: 'other',
        },
      },
    });
    await adapter.reset();
    expect((await adapter.send('read_pair')).output).toBe('exact');
    server.holdingRegisters.set(100, 500);
    expect((await adapter.send('read_pair')).output).toBe('high');
    server.holdingRegisters.set(100, 1);
    expect((await adapter.send('read_pair')).output).toBe('other');
  });

  it('writes a single coil and a single register behind the safety gate', async () => {
    const { server, port } = await makeServer();
    const adapter = makeAdapter(port, {
      allowWrites: true,
      inputs: {
        switch_on: {
          operation: { kind: 'writeSingleCoil', address: 10, value: true },
          onSuccess: 'switched_on',
        },
        set_speed: {
          operation: { kind: 'writeSingleRegister', address: 200, value: 7 },
          onSuccess: 'speed_set',
        },
      },
    });
    await adapter.reset();
    const coil = await adapter.send('switch_on');
    expect(coil.output).toBe('switched_on');
    expect(coil.metadata).toMatchObject({ functionCode: 5, address: 10, written: 1 });
    expect(server.coils.get(10)).toBe(true);

    const register = await adapter.send('set_speed');
    expect(register.output).toBe('speed_set');
    expect(server.holdingRegisters.get(200)).toBe(7);
  });

  it('runs end-to-end under runTestPlan', async () => {
    const { server, port } = await makeServer();
    server.coils.set(10, true);
    const plan: TestPlan = {
      schemaVersion: '1.0',
      id: 'plan-modbus',
      name: 'Lamp over Modbus TCP',
      modelId: 'lamp',
      metadata: {},
      cases: [{
        id: 'case-1',
        name: 'lamp reads on',
        metadata: {},
        steps: [{ input: 'read_lamp', allowedExpectedOutputs: ['lamp_on'], timeoutMs: 5_000 }],
      }],
    };
    const adapter = makeAdapter(port);
    const result = await runTestPlan(plan, adapter);
    expect(result.verdict).toBe('pass');
    expect(adapter.connected).toBe(false);
  });
});

describe('reset semantics', () => {
  it('reset is non-destructive by default: connect only, no operations', async () => {
    const { server, port } = await makeServer();
    let requests = 0;
    server.handler = () => { requests += 1; return undefined; };
    const adapter = makeAdapter(port);
    await adapter.reset();
    expect(requests).toBe(0);
    expect(adapter.connected).toBe(true);
  });

  it('runs configured reset operations, writes gated by allowWrites', async () => {
    const { server, port } = await makeServer();
    server.coils.set(10, true);
    const adapter = makeAdapter(port, {
      allowWrites: true,
      resetOperations: [
        { kind: 'writeSingleCoil', address: 10, value: false },
        { kind: 'readCoils', address: 10, quantity: 1 },
      ],
    });
    await adapter.reset();
    expect(server.coils.get(10)).toBe(false);
  });

  it('rejects write reset operations without the safety gate', () => {
    expect(() => makeAdapter(1502, {
      resetOperations: [{ kind: 'writeSingleCoil', address: 10, value: false }],
    })).toThrowError(/allowWrites/);
  });

  it('rejects write input mappings without the safety gate', () => {
    expect(() => makeAdapter(1502, {
      inputs: {
        forbidden: { operation: { kind: 'writeSingleRegister', address: 1, value: 1 } },
      },
    })).toThrowError(/allowWrites/);
  });
});

describe('framing', () => {
  it('reassembles a response fragmented across TCP segments', async () => {
    const { server, port } = await makeServer();
    server.coils.set(10, true);
    server.handler = (request, normal) => request.functionCode === 1
      ? { kind: 'reply', frames: [normal.subarray(0, 5), normal.subarray(5)], interFrameDelayMs: 10 }
      : undefined;
    const adapter = makeAdapter(port);
    await adapter.reset();
    const response = await adapter.send('read_lamp');
    expect(response.output).toBe('lamp_on');
  });

  it('parses two buffered frames in one segment, discarding the stale duplicate', async () => {
    const { server, port } = await makeServer();
    server.coils.set(10, true);
    let calls = 0;
    server.handler = (request, normal, context) => {
      if (request.functionCode !== 1) return undefined;
      calls += 1;
      if (calls === 2 && context.lastResponse !== undefined) {
        return { kind: 'reply', frames: [Buffer.concat([context.lastResponse, normal])] };
      }
      return undefined;
    };
    const adapter = makeAdapter(port);
    await adapter.reset();
    await adapter.send('read_lamp');
    const second = await adapter.send('read_lamp');
    expect(second.output).toBe('lamp_on');
    expect(second.metadata).toMatchObject({ staleFramesDiscarded: 1 });
  });

  it('rejects a transaction id that matches nothing', async () => {
    const { server, port } = await makeServer();
    server.handler = (request, normal) => {
      if (request.functionCode !== 1) return undefined;
      const corrupted = Buffer.from(normal);
      corrupted.writeUInt16BE((request.transactionId + 1000) & 0xffff, 0);
      return { kind: 'reply', frames: [corrupted] };
    };
    const adapter = makeAdapter(port);
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('read_lamp'), 'protocol');
    expect(error.message).toContain('mismatch');
  });

  it('rejects a unit id mismatch', async () => {
    const { server, port } = await makeServer();
    server.handler = (request, normal) => {
      if (request.functionCode !== 1) return undefined;
      const corrupted = Buffer.from(normal);
      corrupted.writeUInt8(99, 6);
      return { kind: 'reply', frames: [corrupted] };
    };
    const adapter = makeAdapter(port);
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('read_lamp'), 'protocol');
    expect(error.message).toContain('Unit id mismatch');
  });

  it('enforces the bounded receive buffer', async () => {
    const { server, port } = await makeServer();
    server.coils.set(10, true);
    const adapter = makeAdapter(port, { maxReceiveBufferBytes: 8 });
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('read_lamp'), 'protocol');
    expect(error.message).toContain('8 bytes');
  });
});

describe('exceptions and failures', () => {
  it('maps a Modbus exception to a configured output symbol', async () => {
    const { server, port } = await makeServer();
    server.handler = (request) => request.functionCode === 1
      ? { kind: 'reply', frames: [exceptionReply(request, 2)] }
      : undefined;
    const adapter = makeAdapter(port, {
      inputs: {
        read_lamp: {
          operation: { kind: 'readCoils', address: 10, quantity: 1 },
          outputs: [{ symbol: 'lamp_on', when: { kind: 'always' } }],
          onException: 'lamp_unavailable',
        },
      },
    });
    await adapter.reset();
    const response = await adapter.send('read_lamp');
    expect(response.output).toBe('lamp_unavailable');
    expect(response.metadata).toMatchObject({ exceptionCode: 2 });
  });

  it('rejects an unmapped Modbus exception', async () => {
    const { server, port } = await makeServer();
    server.handler = (request) => request.functionCode === 1
      ? { kind: 'reply', frames: [exceptionReply(request, 4)] }
      : undefined;
    const adapter = makeAdapter(port);
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('read_lamp'), 'modbus-exception');
    expect(error.exceptionCode).toBe(4);
  });

  it('times out when the SUT stays silent and recovers on reset', async () => {
    const { server, port } = await makeServer();
    server.handler = (request) => request.functionCode === 1 ? { kind: 'silent' } : undefined;
    const adapter = makeAdapter(port, { responseTimeoutMs: 100 });
    await adapter.reset();
    await expectAdapterError(adapter.send('read_lamp'), 'response-timeout');
    expect(adapter.connected).toBe(false);
    server.handler = undefined;
    await adapter.reset();
    expect((await adapter.send('read_lamp')).output).toBe('lamp_off');
  });

  it('honours AbortSignal for a pending request', async () => {
    const { server, port } = await makeServer();
    server.handler = (request) => request.functionCode === 1 ? { kind: 'silent' } : undefined;
    const adapter = makeAdapter(port);
    await adapter.reset();
    const controller = new AbortController();
    const pending = adapter.send('read_lamp', controller.signal);
    controller.abort();
    await expectAdapterError(pending, 'cancelled');
    expect(adapter.connected).toBe(false);
  });

  it('reports an early disconnect', async () => {
    const { server, port } = await makeServer();
    server.handler = (request) => request.functionCode === 1 ? { kind: 'close' } : undefined;
    const adapter = makeAdapter(port);
    await adapter.reset();
    await expectAdapterError(adapter.send('read_lamp'), 'disconnected');
  });

  it('fails to connect when nothing listens on the port', async () => {
    const { server, port } = await makeServer();
    await server.stop();
    const adapter = makeAdapter(port, { connectTimeoutMs: 2_000 });
    await expectAdapterError(adapter.reset(), 'connect');
    expect(adapter.connected).toBe(false);
  });

  it('rejects an unknown input symbol', async () => {
    const { port } = await makeServer();
    const adapter = makeAdapter(port);
    await adapter.reset();
    await expectAdapterError(adapter.send('no_such_symbol'), 'config');
  });
});

describe('close', () => {
  it('close() is idempotent and closes the socket', async () => {
    const { port } = await makeServer();
    const adapter = makeAdapter(port);
    await adapter.reset();
    expect(adapter.connected).toBe(true);
    await adapter.close();
    expect(adapter.connected).toBe(false);
    await adapter.close();
    await adapter.close();
    expect(adapter.connected).toBe(false);
  });

  it('close() before any connect is a no-op; use after close rejects', async () => {
    const { port } = await makeServer();
    const adapter = makeAdapter(port);
    await adapter.close();
    await expectAdapterError(adapter.reset(), 'closed');
    await expectAdapterError(adapter.send('read_lamp'), 'closed');
  });
});

describe('configuration validation', () => {
  it('rejects invalid addresses, quantities and values', () => {
    expect(() => makeAdapter(1502, {
      inputs: { bad: { operation: { kind: 'readCoils', address: -1, quantity: 1 } } },
    })).toThrowError(/address/);
    expect(() => makeAdapter(1502, {
      inputs: { bad: { operation: { kind: 'readHoldingRegisters', address: 0, quantity: 126 } } },
    })).toThrowError(/quantity/);
    expect(() => makeAdapter(1502, {
      allowWrites: true,
      inputs: { bad: { operation: { kind: 'writeSingleRegister', address: 0, value: 70000 } } },
    })).toThrowError(/value/);
    expect(() => makeAdapter(0)).toThrowError(/port/);
  });
});
