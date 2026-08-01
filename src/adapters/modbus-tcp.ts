/**
 * Modbus TCP SUT adapter (v0.7).
 *
 * Implements the SutAdapter contract from src/testing.ts over Modbus TCP
 * (MBAP + PDU, function codes 1-6). Abstract input symbols are mapped to
 * typed Modbus operations through configuration; observations are mapped
 * back to stable output symbols by configured predicates. Raw values and
 * timing appear only in response metadata, never in symbols.
 *
 * Safety invariants:
 * - connects only to the configured host/port; no scanning, no discovery;
 * - all write operations (input mappings and reset operations) require the
 *   explicit `allowWrites: true` gate, checked at construction time;
 * - reset is non-destructive by default (connection check only);
 * - a write request is never retried automatically: any failure surfaces to
 *   the caller with the connection torn down;
 * - the receive buffer is bounded; oversized or unknown frames are fatal.
 */

import { Socket } from 'node:net';
import type { AdapterResponse, JsonObject, OutputSymbol, SutAdapter } from '../testing';

// ---------------------------------------------------------------------------
// Public configuration types
// ---------------------------------------------------------------------------

export type ModbusReadKind = 'readCoils' | 'readDiscreteInputs' | 'readHoldingRegisters' | 'readInputRegisters';
export type ModbusWriteKind = 'writeSingleCoil' | 'writeSingleRegister';

export type ModbusOperation =
  | { readonly kind: ModbusReadKind; readonly address: number; readonly quantity: number }
  | { readonly kind: 'writeSingleCoil'; readonly address: number; readonly value: boolean }
  | { readonly kind: 'writeSingleRegister'; readonly address: number; readonly value: number };

/**
 * Predicate over the observed values of a read. Values are normalised to
 * numbers: bits become 0/1, registers are unsigned 16-bit integers.
 */
export type OutputCondition =
  | { kind: 'always' }
  | { kind: 'equals'; values: readonly number[] }
  | { kind: 'valueAt'; index: number; equals?: number; min?: number; max?: number };

export type OutputRule = {
  readonly symbol: OutputSymbol;
  readonly when: OutputCondition;
};

export type ModbusInputMapping = {
  readonly operation: ModbusOperation;
  /** For reads: evaluated in order, first matching rule wins. */
  outputs?: readonly OutputRule[];
  /** For reads: output when no rule matches. Default null. */
  otherwise?: OutputSymbol;
  /** For writes: output after a confirmed echo. Default null. */
  onSuccess?: OutputSymbol;
  /**
   * Output symbol for a Modbus exception response to this operation. When
   * absent, an exception response rejects with kind "modbus-exception".
   */
  onException?: OutputSymbol;
};

export type ModbusTcpAdapterOptions = {
  host: string;
  port: number;
  /** MBAP unit identifier. Default 1. */
  unitId?: number;
  /** Abstract input symbol -> Modbus operation and output mapping. */
  inputs: Readonly<Record<string, ModbusInputMapping>>;
  /**
   * Operations executed by reset() after the connection check, in order.
   * Reset is non-destructive by default; any write here (or in `inputs`)
   * requires `allowWrites: true`.
   */
  resetOperations?: readonly ModbusOperation[];
  /** Explicit safety gate for every write operation. Default false. */
  allowWrites?: boolean;
  /** Milliseconds to wait for the TCP connection. Default 5000. */
  connectTimeoutMs?: number;
  /** Milliseconds to wait for each Modbus response. Default 5000. */
  responseTimeoutMs?: number;
  /** Maximum buffered receive bytes. Default 8192. */
  maxReceiveBufferBytes?: number;
};

export type ModbusTcpAdapterErrorKind =
  | 'config'
  | 'connect'
  | 'connect-timeout'
  | 'response-timeout'
  | 'protocol'
  | 'modbus-exception'
  | 'disconnected'
  | 'cancelled'
  | 'closed'
  | 'state';

export class ModbusTcpAdapterError extends Error {
  readonly kind: ModbusTcpAdapterErrorKind;
  /** Modbus exception code, present when kind is "modbus-exception". */
  readonly exceptionCode?: number;

  constructor(kind: ModbusTcpAdapterErrorKind, message: string, exceptionCode?: number) {
    super(message);
    this.name = 'ModbusTcpAdapterError';
    this.kind = kind;
    if (exceptionCode !== undefined) this.exceptionCode = exceptionCode;
  }
}

// ---------------------------------------------------------------------------
// Protocol constants and helpers
// ---------------------------------------------------------------------------

const MBAP_HEADER_BYTES = 7;
/** Maximum Modbus TCP ADU: MBAP (7) + PDU (253). */
const MAX_FRAME_BYTES = 260;
const FUNCTION_CODES: Record<ModbusOperation['kind'], number> = {
  readCoils: 1,
  readDiscreteInputs: 2,
  readHoldingRegisters: 3,
  readInputRegisters: 4,
  writeSingleCoil: 5,
  writeSingleRegister: 6,
};
const EXCEPTION_NAMES: Record<number, string> = {
  1: 'illegal function',
  2: 'illegal data address',
  3: 'illegal data value',
  4: 'server device failure',
  5: 'acknowledge',
  6: 'server device busy',
};
/** How many completed transaction ids are remembered for stale-frame detection. */
const COMPLETED_ID_MEMORY = 32;

function isReadOperation(operation: ModbusOperation): operation is Extract<ModbusOperation, { quantity: number }> {
  return operation.kind !== 'writeSingleCoil' && operation.kind !== 'writeSingleRegister';
}

function isBitRead(kind: ModbusReadKind): boolean {
  return kind === 'readCoils' || kind === 'readDiscreteInputs';
}

function describeException(code: number): string {
  const name = EXCEPTION_NAMES[code];
  return name === undefined ? `exception code ${code}` : `exception code ${code} (${name})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOutputSymbol(value: unknown): value is OutputSymbol {
  return value === null || typeof value === 'string';
}

type ExecutedOperation = {
  functionCode: number;
  transactionId: number;
  values?: number[];
  exceptionCode?: number;
  staleFramesDiscarded: number;
};

type Pending = {
  transactionId: number;
  operation: ModbusOperation;
  staleFramesDiscarded: number;
  resolve: (result: ExecutedOperation) => void;
  reject: (error: ModbusTcpAdapterError) => void;
};

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------

function validateOperation(operation: ModbusOperation, where: string, allowWrites: boolean): void {
  if (!isRecord(operation)) throw new ModbusTcpAdapterError('config', `${where}: operation must be an object.`);
  const { kind } = operation;
  if (typeof kind !== 'string' || !Object.hasOwn(FUNCTION_CODES, kind)) {
    throw new ModbusTcpAdapterError('config', `${where}: unknown operation kind ${JSON.stringify(kind)}.`);
  }
  if (!Number.isSafeInteger(operation.address) || operation.address < 0 || operation.address > 0xffff) {
    throw new ModbusTcpAdapterError('config', `${where}: address must be an integer in [0, 65535].`);
  }
  if (isReadOperation(operation)) {
    const limit = isBitRead(operation.kind) ? 2000 : 125;
    if (!Number.isSafeInteger(operation.quantity) || operation.quantity < 1 || operation.quantity > limit) {
      throw new ModbusTcpAdapterError('config', `${where}: quantity must be an integer in [1, ${limit}].`);
    }
    if (operation.address + operation.quantity > 0x10000) {
      throw new ModbusTcpAdapterError('config', `${where}: address + quantity exceeds the 16-bit address space.`);
    }
  } else {
    if (!allowWrites) {
      throw new ModbusTcpAdapterError('config',
        `${where}: ${operation.kind} is a write; set allowWrites: true to permit writes explicitly.`);
    }
    if (operation.kind === 'writeSingleCoil' && typeof operation.value !== 'boolean') {
      throw new ModbusTcpAdapterError('config', `${where}: coil value must be boolean.`);
    }
    if (operation.kind === 'writeSingleRegister' &&
      (!Number.isSafeInteger(operation.value) || operation.value < 0 || operation.value > 0xffff)) {
      throw new ModbusTcpAdapterError('config', `${where}: register value must be an integer in [0, 65535].`);
    }
  }
}

function validateObservedValue(value: number, where: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new ModbusTcpAdapterError('config', `${where} must be an integer in [0, ${maximum}].`);
  }
}

function validateCondition(condition: OutputCondition, where: string, maximum: number): void {
  if (!isRecord(condition)) throw new ModbusTcpAdapterError('config', `${where}: condition must be an object.`);
  if (condition.kind !== 'always' && condition.kind !== 'equals' && condition.kind !== 'valueAt') {
    const unknownKind = (condition as unknown as Record<string, unknown>)['kind'];
    throw new ModbusTcpAdapterError('config', `${where}: unknown condition kind ${JSON.stringify(unknownKind)}.`);
  }
  if (condition.kind === 'equals') {
    if (!Array.isArray(condition.values) || condition.values.length === 0) {
      throw new ModbusTcpAdapterError('config', `${where}: equals condition needs a non-empty values array.`);
    }
    condition.values.forEach((value, index) => validateObservedValue(value, `${where}.values[${index}]`, maximum));
    return;
  }
  if (condition.kind === 'valueAt') {
    if (!Number.isSafeInteger(condition.index) || condition.index < 0) {
      throw new ModbusTcpAdapterError('config', `${where}: valueAt index must be a non-negative integer.`);
    }
    if (condition.equals === undefined && condition.min === undefined && condition.max === undefined) {
      throw new ModbusTcpAdapterError('config', `${where}: valueAt needs "equals", "min" or "max".`);
    }
    if (condition.equals !== undefined) validateObservedValue(condition.equals, `${where}.equals`, maximum);
    if (condition.min !== undefined) validateObservedValue(condition.min, `${where}.min`, maximum);
    if (condition.max !== undefined) validateObservedValue(condition.max, `${where}.max`, maximum);
    if (condition.min !== undefined && condition.max !== undefined && condition.min > condition.max) {
      throw new ModbusTcpAdapterError('config', `${where}: min must not exceed max.`);
    }
  }
}

function cloneOperation(operation: ModbusOperation): ModbusOperation {
  if (isReadOperation(operation)) return { kind: operation.kind, address: operation.address, quantity: operation.quantity };
  if (operation.kind === 'writeSingleCoil') return { kind: operation.kind, address: operation.address, value: operation.value };
  return { kind: operation.kind, address: operation.address, value: operation.value };
}

function cloneCondition(condition: OutputCondition): OutputCondition {
  if (condition.kind === 'always') return { kind: 'always' };
  if (condition.kind === 'equals') return { kind: 'equals', values: [...condition.values] };
  return { kind: 'valueAt', index: condition.index, equals: condition.equals, min: condition.min, max: condition.max };
}

function cloneMapping(mapping: ModbusInputMapping): ModbusInputMapping {
  return {
    operation: cloneOperation(mapping.operation),
    outputs: mapping.outputs?.map((rule) => ({ symbol: rule.symbol, when: cloneCondition(rule.when) })),
    otherwise: mapping.otherwise,
    onSuccess: mapping.onSuccess,
    onException: mapping.onException,
  };
}

function conditionMatches(condition: OutputCondition, values: readonly number[]): boolean {
  switch (condition.kind) {
    case 'always':
      return true;
    case 'equals':
      return condition.values.length === values.length && condition.values.every((value, index) => values[index] === value);
    case 'valueAt': {
      const value = values[condition.index];
      if (value === undefined) return false;
      if (condition.equals !== undefined && value !== condition.equals) return false;
      if (condition.min !== undefined && value < condition.min) return false;
      if (condition.max !== undefined && value > condition.max) return false;
      return true;
    }
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class ModbusTcpAdapter implements SutAdapter {
  private readonly host: string;
  private readonly port: number;
  private readonly unitId: number;
  private readonly inputs: ReadonlyMap<string, ModbusInputMapping>;
  private readonly resetOperations: readonly ModbusOperation[];
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly maxReceiveBufferBytes: number;

  private socket: Socket | undefined;
  private socketClosed: Promise<void> = Promise.resolve();
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private pending: Pending | undefined;
  private transactionCounter = 0;
  private completedIds: number[] = [];
  private fatal: ModbusTcpAdapterError | undefined;
  private closePromise: Promise<void> | undefined;
  private resetting = false;

  constructor(options: ModbusTcpAdapterOptions) {
    if (!isRecord(options)) throw new ModbusTcpAdapterError('config', 'options must be an object.');
    if (typeof options.host !== 'string' || options.host.trim() === '') {
      throw new ModbusTcpAdapterError('config', 'host must be a non-empty string.');
    }
    if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65535) {
      throw new ModbusTcpAdapterError('config', 'port must be an integer in [1, 65535].');
    }
    const unitId = options.unitId ?? 1;
    if (!Number.isSafeInteger(unitId) || unitId < 0 || unitId > 255) {
      throw new ModbusTcpAdapterError('config', 'unitId must be an integer in [0, 255].');
    }
    const allowWrites = options.allowWrites ?? false;
    if (typeof allowWrites !== 'boolean') throw new ModbusTcpAdapterError('config', 'allowWrites must be boolean.');
    if (!isRecord(options.inputs)) throw new ModbusTcpAdapterError('config', 'inputs must be an object.');
    for (const [symbol, mapping] of Object.entries(options.inputs)) {
      const where = `inputs[${JSON.stringify(symbol)}]`;
      if (symbol.trim() === '') throw new ModbusTcpAdapterError('config', 'input symbols must be non-empty strings.');
      if (!isRecord(mapping)) throw new ModbusTcpAdapterError('config', `${where}: mapping must be an object.`);
      validateOperation(mapping.operation, where, allowWrites);
      if (mapping.outputs !== undefined && !Array.isArray(mapping.outputs)) {
        throw new ModbusTcpAdapterError('config', `${where}.outputs must be an array.`);
      }
      const maximum = isReadOperation(mapping.operation) && isBitRead(mapping.operation.kind) ? 1 : 0xffff;
      for (const [index, rule] of (mapping.outputs ?? []).entries()) {
        if (!isRecord(rule) || !isOutputSymbol(rule.symbol)) {
          throw new ModbusTcpAdapterError('config', `${where}.outputs[${index}] must contain a string/null symbol and condition.`);
        }
        validateCondition(rule.when as OutputCondition, `${where}.outputs[${index}].when`, maximum);
      }
      for (const field of ['otherwise', 'onSuccess', 'onException'] as const) {
        if (mapping[field] !== undefined && !isOutputSymbol(mapping[field])) {
          throw new ModbusTcpAdapterError('config', `${where}.${field} must be a string or null.`);
        }
      }
      if (!isReadOperation(mapping.operation) && mapping.outputs !== undefined) {
        throw new ModbusTcpAdapterError('config', `${where}: "outputs" predicates apply to reads; use "onSuccess" for writes.`);
      }
    }
    if (options.resetOperations !== undefined && !Array.isArray(options.resetOperations)) {
      throw new ModbusTcpAdapterError('config', 'resetOperations must be an array.');
    }
    for (const [index, operation] of (options.resetOperations ?? []).entries()) {
      validateOperation(operation, `resetOperations[${index}]`, allowWrites);
    }
    for (const [key, value] of Object.entries({
      connectTimeoutMs: options.connectTimeoutMs ?? 5_000,
      responseTimeoutMs: options.responseTimeoutMs ?? 5_000,
      maxReceiveBufferBytes: options.maxReceiveBufferBytes ?? 8_192,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new ModbusTcpAdapterError('config', `${key} must be a positive safe integer.`);
    }

    this.host = options.host;
    this.port = options.port;
    this.unitId = unitId;
    this.inputs = new Map(Object.entries(options.inputs).map(([symbol, mapping]) => [symbol, cloneMapping(mapping)]));
    this.resetOperations = (options.resetOperations ?? []).map(cloneOperation);
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 5_000;
    this.maxReceiveBufferBytes = options.maxReceiveBufferBytes ?? 8_192;
  }

  /** True while a TCP connection is open. */
  get connected(): boolean {
    return this.socket !== undefined && !this.socket.connecting && !this.socket.destroyed;
  }

  async reset(signal?: AbortSignal): Promise<void> {
    this.ensureNotClosed();
    if (this.resetting) throw new ModbusTcpAdapterError('state', 'A reset/connect operation is already in progress.');
    this.resetting = true;
    try {
      if (this.fatal !== undefined) {
        await this.disconnect();
        this.fatal = undefined;
      }
      if (!this.connected) await this.connect(signal);
      // Non-destructive by default: reset ends here unless operations were
      // configured explicitly (writes among them are gated by allowWrites).
      for (const operation of this.resetOperations) {
        const result = await this.execute(operation, signal);
        if (result.exceptionCode !== undefined) {
          throw this.makeFatal(new ModbusTcpAdapterError('modbus-exception',
            `Reset operation ${operation.kind} @${operation.address} failed with ${describeException(result.exceptionCode)}.`,
            result.exceptionCode));
        }
      }
    } finally {
      this.resetting = false;
    }
  }

  async send(input: string, signal?: AbortSignal): Promise<AdapterResponse> {
    this.ensureNotClosed();
    const mapping = this.inputs.get(input);
    if (mapping === undefined) {
      throw new ModbusTcpAdapterError('config', `Input symbol ${JSON.stringify(input)} has no configured Modbus operation.`);
    }
    if (this.resetting || !this.connected) {
      throw this.fatal ?? new ModbusTcpAdapterError('state', 'Adapter is not connected; call reset() first.');
    }

    const startedAt = Date.now();
    const result = await this.execute(mapping.operation, signal);
    const timestamp = Date.now();

    const metadata: JsonObject = {
      functionCode: result.functionCode,
      address: mapping.operation.address,
      transactionId: result.transactionId,
    };
    if (result.staleFramesDiscarded > 0) metadata['staleFramesDiscarded'] = result.staleFramesDiscarded;

    let output: OutputSymbol;
    if (result.exceptionCode !== undefined) {
      if (mapping.onException === undefined) {
        throw this.makeFatal(new ModbusTcpAdapterError('modbus-exception',
          `SUT answered ${mapping.operation.kind} @${mapping.operation.address} with ${describeException(result.exceptionCode)}.`,
          result.exceptionCode));
      }
      output = mapping.onException;
      metadata['exceptionCode'] = result.exceptionCode;
    } else if (isReadOperation(mapping.operation)) {
      const values = result.values ?? [];
      metadata['values'] = [...values];
      output = mapping.otherwise ?? null;
      for (const rule of mapping.outputs ?? []) {
        if (conditionMatches(rule.when, values)) {
          output = rule.symbol;
          break;
        }
      }
    } else {
      output = mapping.onSuccess ?? null;
      metadata['written'] = mapping.operation.kind === 'writeSingleCoil'
        ? (mapping.operation.value ? 1 : 0)
        : mapping.operation.value;
    }

    return { output, timestamp, durationMs: timestamp - startedAt, metadata };
  }

  async close(): Promise<void> {
    this.closePromise ??= this.disconnect();
    return this.closePromise;
  }

  // -- connection lifecycle --------------------------------------------------

  private ensureNotClosed(): void {
    if (this.closePromise !== undefined) throw new ModbusTcpAdapterError('closed', 'Adapter is closed.');
  }

  private async connect(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new ModbusTcpAdapterError('cancelled', 'Cancelled before connecting.');
    const socket = new Socket();
    socket.setNoDelay(true);
    this.socket = socket;
    this.receiveBuffer = Buffer.alloc(0);
    this.completedIds = [];
    this.socketClosed = new Promise((resolve) => {
      socket.once('close', () => {
        // Ignore delayed events from a socket already detached/replaced.
        if (this.socket === socket) {
          this.socket = undefined;
          this.onSocketClosed();
        }
        resolve();
      });
    });
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', () => { /* 'close' follows and carries the failure. */ });

    await new Promise<void>((resolve, reject) => {
      const abandon = () => {
        // Synchronous detach so `connected` is false the moment we reject;
        // the 'close' event still resolves socketClosed afterwards.
        socket.destroy();
        if (this.socket === socket) this.socket = undefined;
      };
      const timer = setTimeout(() => {
        cleanup();
        abandon();
        reject(new ModbusTcpAdapterError('connect-timeout',
          `Could not connect to ${this.host}:${this.port} within ${this.connectTimeoutMs} ms.`));
      }, this.connectTimeoutMs);
      const onConnect = () => { cleanup(); resolve(); };
      const onError = (error: Error) => {
        cleanup();
        abandon();
        reject(new ModbusTcpAdapterError('connect', `Connection to ${this.host}:${this.port} failed: ${error.message}.`));
      };
      const onAbort = () => {
        cleanup();
        abandon();
        reject(new ModbusTcpAdapterError('cancelled', 'Cancelled while connecting.'));
      };
      const onClose = () => {
        cleanup();
        reject(this.closePromise !== undefined
          ? new ModbusTcpAdapterError('closed', 'Adapter closed while connecting.')
          : new ModbusTcpAdapterError('connect', `Connection to ${this.host}:${this.port} closed before it was established.`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('error', onError);
        socket.off('close', onClose);
        signal?.removeEventListener('abort', onAbort);
      };
      socket.once('connect', onConnect);
      socket.once('error', onError);
      socket.once('close', onClose);
      signal?.addEventListener('abort', onAbort, { once: true });
      socket.connect({ host: this.host, port: this.port });
    });
  }

  private async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.pending?.reject(this.fatal ?? new ModbusTcpAdapterError('closed', 'Adapter is closing.'));
    socket?.destroy();
    await this.socketClosed;
  }

  private onSocketClosed(): void {
    if (this.pending !== undefined && this.fatal === undefined && this.closePromise === undefined) {
      this.pending.reject(new ModbusTcpAdapterError('disconnected',
        'SUT closed the connection before responding.'));
    } else {
      this.pending?.reject(this.fatal ?? new ModbusTcpAdapterError('closed', 'Adapter is closing.'));
    }
  }

  private makeFatal(error: ModbusTcpAdapterError): ModbusTcpAdapterError {
    if (this.fatal === undefined) this.fatal = error;
    this.pending?.reject(error);
    // Synchronous detach: the connection is unusable from this point on.
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
    return error;
  }

  // -- request execution -----------------------------------------------------

  private execute(operation: ModbusOperation, signal?: AbortSignal): Promise<ExecutedOperation> {
    return new Promise<ExecutedOperation>((resolve, reject) => {
      if (this.fatal !== undefined) { reject(this.fatal); return; }
      const socket = this.socket;
      if (socket === undefined) { reject(new ModbusTcpAdapterError('state', 'Not connected.')); return; }
      if (this.pending !== undefined) {
        reject(new ModbusTcpAdapterError('state', 'A Modbus request is already in flight; requests are strictly sequential.'));
        return;
      }
      if (signal?.aborted) { reject(new ModbusTcpAdapterError('cancelled', 'Cancelled before the request was sent.')); return; }

      this.transactionCounter = (this.transactionCounter + 1) & 0xffff;
      const transactionId = this.transactionCounter;

      const timer = setTimeout(() => {
        this.makeFatal(new ModbusTcpAdapterError('response-timeout',
          `No response for transaction ${transactionId} within ${this.responseTimeoutMs} ms.`));
      }, this.responseTimeoutMs);
      const onAbort = () => {
        this.makeFatal(new ModbusTcpAdapterError('cancelled', `Transaction ${transactionId} was cancelled.`));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.completedIds.push(transactionId);
        if (this.completedIds.length > COMPLETED_ID_MEMORY) this.completedIds.shift();
        this.pending = undefined;
      };
      this.pending = {
        transactionId,
        operation,
        staleFramesDiscarded: 0,
        resolve: (result) => { settle(); resolve(result); },
        reject: (error) => { settle(); reject(error); },
      };

      socket.write(this.encodeRequest(transactionId, operation));
    });
  }

  private encodeRequest(transactionId: number, operation: ModbusOperation): Buffer {
    const frame = Buffer.alloc(12);
    frame.writeUInt16BE(transactionId, 0);
    frame.writeUInt16BE(0, 2); // protocol id
    frame.writeUInt16BE(6, 4); // remaining bytes: unit id + PDU
    frame.writeUInt8(this.unitId, 6);
    frame.writeUInt8(FUNCTION_CODES[operation.kind], 7);
    frame.writeUInt16BE(operation.address, 8);
    if (isReadOperation(operation)) {
      frame.writeUInt16BE(operation.quantity, 10);
    } else if (operation.kind === 'writeSingleCoil') {
      frame.writeUInt16BE(operation.value ? 0xff00 : 0x0000, 10);
    } else {
      frame.writeUInt16BE(operation.value, 10);
    }
    return frame;
  }

  // -- response parsing ------------------------------------------------------

  private onData(chunk: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
    if (this.receiveBuffer.length > this.maxReceiveBufferBytes) {
      this.makeFatal(new ModbusTcpAdapterError('protocol',
        `Receive buffer exceeded ${this.maxReceiveBufferBytes} bytes.`));
      return;
    }
    // A single TCP read may carry a fragment, one frame, or several frames.
    while (this.receiveBuffer.length >= MBAP_HEADER_BYTES) {
      const declaredLength = this.receiveBuffer.readUInt16BE(4);
      const frameLength = 6 + declaredLength;
      if (declaredLength < 2 || frameLength > MAX_FRAME_BYTES) {
        this.makeFatal(new ModbusTcpAdapterError('protocol',
          `Invalid MBAP length field ${declaredLength}.`));
        return;
      }
      if (this.receiveBuffer.length < frameLength) return; // wait for the rest
      const frame = this.receiveBuffer.subarray(0, frameLength);
      this.receiveBuffer = this.receiveBuffer.subarray(frameLength);
      this.onFrame(frame);
      if (this.fatal !== undefined) return;
    }
  }

  private onFrame(frame: Buffer): void {
    const transactionId = frame.readUInt16BE(0);
    const protocolId = frame.readUInt16BE(2);
    const unitId = frame.readUInt8(6);
    const pending = this.pending;

    if (pending === undefined || transactionId !== pending.transactionId) {
      if (this.completedIds.includes(transactionId)) {
        // Stale duplicate of an already answered transaction: discard.
        if (pending !== undefined) pending.staleFramesDiscarded += 1;
        return;
      }
      this.makeFatal(new ModbusTcpAdapterError('protocol',
        pending === undefined
          ? `Unsolicited frame with transaction id ${transactionId}.`
          : `Transaction id mismatch: expected ${pending.transactionId}, got ${transactionId}.`));
      return;
    }
    if (protocolId !== 0) {
      this.makeFatal(new ModbusTcpAdapterError('protocol', `Invalid MBAP protocol id ${protocolId}; expected 0.`));
      return;
    }
    if (unitId !== this.unitId) {
      this.makeFatal(new ModbusTcpAdapterError('protocol', `Unit id mismatch: expected ${this.unitId}, got ${unitId}.`));
      return;
    }

    const functionCode = frame.readUInt8(7);
    const expectedCode = FUNCTION_CODES[pending.operation.kind];
    const base: ExecutedOperation = {
      functionCode: expectedCode,
      transactionId,
      staleFramesDiscarded: pending.staleFramesDiscarded,
    };

    if (functionCode === (expectedCode | 0x80)) {
      if (frame.length !== 9) {
        this.makeFatal(new ModbusTcpAdapterError('protocol',
          `Exception response must be exactly 9 bytes, got ${frame.length}.`));
        return;
      }
      pending.resolve({ ...base, exceptionCode: frame.readUInt8(8) });
      return;
    }
    if (functionCode !== expectedCode) {
      this.makeFatal(new ModbusTcpAdapterError('protocol',
        `Function code mismatch: expected ${expectedCode}, got ${functionCode}.`));
      return;
    }

    const operation = pending.operation;
    if (isReadOperation(operation)) {
      const byteCount = frame.length >= 9 ? frame.readUInt8(8) : -1;
      const payload = frame.subarray(9);
      if (byteCount < 0 || payload.length !== byteCount) {
        this.makeFatal(new ModbusTcpAdapterError('protocol', 'Read response byte count does not match the frame.'));
        return;
      }
      const values: number[] = [];
      if (isBitRead(operation.kind)) {
        if (byteCount !== Math.ceil(operation.quantity / 8)) {
          this.makeFatal(new ModbusTcpAdapterError('protocol',
            `Expected ${Math.ceil(operation.quantity / 8)} status bytes, got ${byteCount}.`));
          return;
        }
        for (let index = 0; index < operation.quantity; index += 1) {
          const byte = payload.readUInt8(Math.floor(index / 8));
          values.push((byte >> index % 8) & 1);
        }
      } else {
        if (byteCount !== operation.quantity * 2) {
          this.makeFatal(new ModbusTcpAdapterError('protocol',
            `Expected ${operation.quantity * 2} register bytes, got ${byteCount}.`));
          return;
        }
        for (let index = 0; index < operation.quantity; index += 1) {
          values.push(payload.readUInt16BE(index * 2));
        }
      }
      pending.resolve({ ...base, values });
      return;
    }

    // Write echo: the response must repeat address and value exactly.
    if (frame.length !== 12) {
      this.makeFatal(new ModbusTcpAdapterError('protocol',
        `Write echo response must be exactly 12 bytes, got ${frame.length}.`));
      return;
    }
    const echoAddress = frame.readUInt16BE(8);
    const echoValue = frame.readUInt16BE(10);
    const sentValue = operation.kind === 'writeSingleCoil' ? (operation.value ? 0xff00 : 0x0000) : operation.value;
    if (echoAddress !== operation.address || echoValue !== sentValue) {
      this.makeFatal(new ModbusTcpAdapterError('protocol',
        `Write echo mismatch: sent @${operation.address}=${sentValue}, echoed @${echoAddress}=${echoValue}.`));
      return;
    }
    pending.resolve(base);
  }
}
