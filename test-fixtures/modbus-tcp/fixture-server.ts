/**
 * Deterministic in-process Modbus TCP fixture server for adapter tests.
 * Binds to 127.0.0.1 on an ephemeral port; never touches real equipment.
 *
 * The default behaviour serves reads/writes (function codes 1-6) from an
 * in-memory data store. Tests can install a `handler` to reshape the reply:
 * fragment it, batch it with the previous response, corrupt ids, answer with
 * a Modbus exception, stay silent or drop the connection.
 */

import { createServer } from 'node:net';
import type { AddressInfo, Server, Socket } from 'node:net';

export type FixtureRequest = {
  transactionId: number;
  protocolId: number;
  unitId: number;
  functionCode: number;
  address: number;
  /** Quantity for reads, raw value for writes. */
  value: number;
};

export type FixtureAction =
  | { kind: 'reply'; frames: readonly Buffer[]; interFrameDelayMs?: number }
  | { kind: 'silent' }
  | { kind: 'close' };

export type FixtureContext = {
  /** The previous response frame sent on this socket, if any. */
  lastResponse?: Buffer;
};

/** Return undefined to use the default reply. */
export type FixtureHandler = (request: FixtureRequest, normalReply: Buffer, context: FixtureContext) => FixtureAction | undefined;

export class ModbusFixtureServer {
  readonly coils = new Map<number, boolean>();
  readonly discreteInputs = new Map<number, boolean>();
  readonly holdingRegisters = new Map<number, number>();
  readonly inputRegisters = new Map<number, number>();
  handler: FixtureHandler | undefined;

  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly buffers = new Map<Socket, Buffer>();
  private readonly lastResponses = new Map<Socket, Buffer>();

  get openSocketCount(): number {
    return this.sockets.size;
  }

  async start(): Promise<number> {
    const server = createServer((socket) => {
      this.sockets.add(socket);
      this.buffers.set(socket, Buffer.alloc(0));
      socket.setNoDelay(true);
      socket.on('data', (chunk: Buffer) => this.onData(socket, chunk));
      socket.on('error', () => { /* client teardown is expected in tests */ });
      socket.on('close', () => {
        this.sockets.delete(socket);
        this.buffers.delete(socket);
        this.lastResponses.delete(socket);
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    return (server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private onData(socket: Socket, chunk: Buffer): void {
    let buffer = Buffer.concat([this.buffers.get(socket) ?? Buffer.alloc(0), chunk]);
    // All FC1-6 requests are exactly 12 bytes; buffer until complete.
    while (buffer.length >= 12) {
      const frame = buffer.subarray(0, 12);
      buffer = buffer.subarray(12);
      this.onRequest(socket, frame);
    }
    this.buffers.set(socket, buffer);
  }

  private onRequest(socket: Socket, frame: Buffer): void {
    const request: FixtureRequest = {
      transactionId: frame.readUInt16BE(0),
      protocolId: frame.readUInt16BE(2),
      unitId: frame.readUInt8(6),
      functionCode: frame.readUInt8(7),
      address: frame.readUInt16BE(8),
      value: frame.readUInt16BE(10),
    };
    const normalReply = this.buildReply(request);
    const action = this.handler?.(request, normalReply, { lastResponse: this.lastResponses.get(socket) })
      ?? { kind: 'reply', frames: [normalReply] } satisfies FixtureAction;

    if (action.kind === 'silent') return;
    if (action.kind === 'close') {
      socket.destroy();
      return;
    }
    this.lastResponses.set(socket, normalReply);
    const frames = [...action.frames];
    const delay = action.interFrameDelayMs ?? 0;
    const writeNext = (index: number): void => {
      if (index >= frames.length || socket.destroyed) return;
      socket.write(frames[index]);
      if (index + 1 < frames.length) setTimeout(() => writeNext(index + 1), delay);
    };
    writeNext(0);
  }

  private buildReply(request: FixtureRequest): Buffer {
    const pdu = this.buildPdu(request);
    const frame = Buffer.alloc(7 + pdu.length);
    frame.writeUInt16BE(request.transactionId, 0);
    frame.writeUInt16BE(0, 2);
    frame.writeUInt16BE(1 + pdu.length, 4);
    frame.writeUInt8(request.unitId, 6);
    pdu.copy(frame, 7);
    return frame;
  }

  private buildPdu(request: FixtureRequest): Buffer {
    const { functionCode, address, value } = request;
    switch (functionCode) {
      case 1:
      case 2: {
        const store = functionCode === 1 ? this.coils : this.discreteInputs;
        const quantity = value;
        const byteCount = Math.ceil(quantity / 8);
        const pdu = Buffer.alloc(2 + byteCount);
        pdu.writeUInt8(functionCode, 0);
        pdu.writeUInt8(byteCount, 1);
        for (let index = 0; index < quantity; index += 1) {
          if (store.get(address + index) === true) {
            const offset = 2 + Math.floor(index / 8);
            pdu.writeUInt8(pdu.readUInt8(offset) | (1 << index % 8), offset);
          }
        }
        return pdu;
      }
      case 3:
      case 4: {
        const store = functionCode === 3 ? this.holdingRegisters : this.inputRegisters;
        const quantity = value;
        const pdu = Buffer.alloc(2 + quantity * 2);
        pdu.writeUInt8(functionCode, 0);
        pdu.writeUInt8(quantity * 2, 1);
        for (let index = 0; index < quantity; index += 1) {
          pdu.writeUInt16BE(store.get(address + index) ?? 0, 2 + index * 2);
        }
        return pdu;
      }
      case 5: {
        this.coils.set(address, value === 0xff00);
        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(5, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(value, 3);
        return pdu;
      }
      case 6: {
        this.holdingRegisters.set(address, value);
        const pdu = Buffer.alloc(5);
        pdu.writeUInt8(6, 0);
        pdu.writeUInt16BE(address, 1);
        pdu.writeUInt16BE(value, 3);
        return pdu;
      }
      default: {
        const pdu = Buffer.alloc(2);
        pdu.writeUInt8(functionCode | 0x80, 0);
        pdu.writeUInt8(1, 1); // illegal function
        return pdu;
      }
    }
  }
}

/** Build a Modbus exception reply for a request (for handler-based tests). */
export function exceptionReply(request: FixtureRequest, exceptionCode: number): Buffer {
  const frame = Buffer.alloc(9);
  frame.writeUInt16BE(request.transactionId, 0);
  frame.writeUInt16BE(0, 2);
  frame.writeUInt16BE(3, 4);
  frame.writeUInt8(request.unitId, 6);
  frame.writeUInt8(request.functionCode | 0x80, 7);
  frame.writeUInt8(exceptionCode, 8);
  return frame;
}
