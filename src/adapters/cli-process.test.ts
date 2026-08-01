import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runTestPlan, type TestPlan } from '../testing';
import { CliProcessAdapter, CliProcessAdapterError } from './cli-process';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '..', 'test-fixtures', 'cli-sut');

const adapters: CliProcessAdapter[] = [];

function makeAdapter(fixture: string, overrides: Partial<ConstructorParameters<typeof CliProcessAdapter>[0]> = {}): CliProcessAdapter {
  const adapter = new CliProcessAdapter({
    executable: process.execPath,
    args: [join(fixturesDir, fixture)],
    responseTimeoutMs: 5_000,
    ...overrides,
  });
  adapters.push(adapter);
  return adapter;
}

async function expectAdapterError(promise: Promise<unknown>, kind: CliProcessAdapterError['kind']): Promise<CliProcessAdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliProcessAdapterError);
    const adapterError = error as CliProcessAdapterError;
    expect(adapterError.kind).toBe(kind);
    return adapterError;
  }
  throw new Error(`Expected rejection with kind ${kind}.`);
}

afterEach(async () => {
  // No orphan processes: every adapter is closed and reports no running child.
  while (adapters.length > 0) {
    const adapter = adapters.pop();
    if (!adapter) break;
    await adapter.close();
    expect(adapter.running).toBe(false);
  }
});

describe('happy path', () => {
  it('drives the turnstile fixture through reset/input/close', async () => {
    const adapter = makeAdapter('turnstile.cjs');
    await adapter.reset();

    const unlock = await adapter.send('coin');
    expect(unlock.output).toBe('unlock');
    expect(unlock.metadata).toEqual({ from: 'locked', to: 'unlocked' });
    expect(unlock.durationMs).toBeGreaterThanOrEqual(0);
    expect(unlock.timestamp).toBeGreaterThan(0);

    const lock = await adapter.send('push');
    expect(lock.output).toBe('lock');

    // reset returns to the initial state.
    await adapter.reset();
    const again = await adapter.send('coin');
    expect(again.output).toBe('unlock');

    await adapter.close();
    expect(adapter.running).toBe(false);
  });

  it('works end-to-end under runTestPlan', async () => {
    const plan: TestPlan = {
      schemaVersion: '1.0',
      id: 'plan-turnstile',
      name: 'Turnstile over CLI process',
      modelId: 'mealy-turnstile',
      metadata: {},
      cases: [
        {
          id: 'case-1',
          name: 'coin then push',
          metadata: {},
          steps: [
            { input: 'coin', allowedExpectedOutputs: ['unlock'], timeoutMs: 5_000 },
            { input: 'push', allowedExpectedOutputs: ['lock'], timeoutMs: 5_000 },
          ],
        },
      ],
    };
    const adapter = makeAdapter('turnstile.cjs');
    const result = await runTestPlan(plan, adapter);
    expect(result.verdict).toBe('pass');
    expect(result.counts.pass).toBe(1);
    expect(adapter.running).toBe(false);
  });
});

describe('failures', () => {
  it('times out when the SUT never responds', async () => {
    const adapter = makeAdapter('silent.cjs', { responseTimeoutMs: 100 });
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('coin'), 'response-timeout');
    expect(error.message).toContain('100 ms');
  });

  it('rejects malformed JSON as a protocol error', async () => {
    const adapter = makeAdapter('malformed.cjs');
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('coin'), 'protocol');
    expect(error.message).toContain('not valid JSON');
  });

  it('rejects a mismatched requestId', async () => {
    const adapter = makeAdapter('wrong-id.cjs');
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('coin'), 'protocol');
    expect(error.message).toContain('bogus-999');
  });

  it('reports early process exit with code and captured stderr', async () => {
    const adapter = makeAdapter('early-exit.cjs', { stderrLimitBytes: 4_096 });
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('coin'), 'process-exit');
    expect(error.message).toContain('code 7');
    expect(error.stderr).toContain('boom: simulated crash');
    expect(error.stderrTruncated).toBe(true);
    expect(adapter.stderrSnapshot().truncated).toBe(true);
  });

  it('rejects oversized response lines', async () => {
    const adapter = makeAdapter('big-line.cjs', { maxLineBytes: 4_096 });
    await adapter.reset();
    const error = await expectAdapterError(adapter.send('coin'), 'protocol');
    expect(error.message).toContain('4096 byte');
  });

  it('fails to start a nonexistent executable', async () => {
    const adapter = makeAdapter('turnstile.cjs', {
      executable: join(fixturesDir, 'does-not-exist.exe'),
    });
    await expectAdapterError(adapter.reset(), 'spawn');
    expect(adapter.running).toBe(false);
  });

  it('recovers after a failure with a fresh process on reset', async () => {
    const adapter = makeAdapter('malformed.cjs');
    await adapter.reset();
    await expectAdapterError(adapter.send('coin'), 'protocol');
    // The broken child is gone; send without reset fails fast.
    await expectAdapterError(adapter.send('coin'), 'protocol');
    await adapter.reset();
    expect(adapter.running).toBe(true);
  });
});

describe('cancellation', () => {
  it('honours AbortSignal for a pending request and stops the child', async () => {
    const adapter = makeAdapter('silent.cjs');
    await adapter.reset();
    const controller = new AbortController();
    const pending = adapter.send('coin', controller.signal);
    controller.abort();
    await expectAdapterError(pending, 'cancelled');
    await adapter.close();
    expect(adapter.running).toBe(false);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const adapter = makeAdapter('turnstile.cjs');
    await adapter.reset();
    const controller = new AbortController();
    controller.abort();
    await expectAdapterError(adapter.send('coin', controller.signal), 'cancelled');
  });
});

describe('close', () => {
  it('close() is idempotent and leaves no child running', async () => {
    const adapter = makeAdapter('turnstile.cjs');
    await adapter.reset();
    await adapter.close();
    expect(adapter.running).toBe(false);
    await adapter.close();
    await adapter.close();
    expect(adapter.running).toBe(false);
  });

  it('close() before any start is a no-op', async () => {
    const adapter = makeAdapter('turnstile.cjs');
    await adapter.close();
    expect(adapter.running).toBe(false);
  });

  it('rejects reset and send after close', async () => {
    const adapter = makeAdapter('turnstile.cjs');
    await adapter.close();
    await expectAdapterError(adapter.reset(), 'closed');
    await expectAdapterError(adapter.send('coin'), 'closed');
  });

  it('close() terminates a child even after a timeout failure', async () => {
    const adapter = makeAdapter('silent.cjs', { responseTimeoutMs: 100 });
    await adapter.reset();
    await expectAdapterError(adapter.send('coin'), 'response-timeout');
    await adapter.close();
    expect(adapter.running).toBe(false);
  });
});

describe('environment allowlist', () => {
  it('passes only allowlisted variables and never exposes values', async () => {
    process.env['CLI_SUT_TEST_SECRET'] = 'super-secret-value';
    try {
      const hidden = makeAdapter('echo-env.cjs');
      await hidden.reset();
      const withoutAllowlist = await hidden.send('CLI_SUT_TEST_SECRET');
      expect(withoutAllowlist.output).toBeNull();
      await hidden.close();

      const allowed = makeAdapter('echo-env.cjs', { envAllowlist: ['CLI_SUT_TEST_SECRET'] });
      await allowed.reset();
      const withAllowlist = await allowed.send('CLI_SUT_TEST_SECRET');
      expect(withAllowlist.output).toBe('present');
      await allowed.close();
    } finally {
      delete process.env['CLI_SUT_TEST_SECRET'];
    }
  });
});

describe('construction', () => {
  it('rejects invalid configuration', () => {
    expect(() => new CliProcessAdapter({ executable: '  ' })).toThrow(TypeError);
    expect(() => new CliProcessAdapter({ executable: 'node', responseTimeoutMs: 0 })).toThrow(TypeError);
    expect(() => new CliProcessAdapter({ executable: 'node', maxLineBytes: -1 })).toThrow(TypeError);
  });
});
