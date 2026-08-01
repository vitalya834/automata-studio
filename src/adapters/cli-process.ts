/**
 * CLI process SUT adapter (v0.6).
 *
 * Drives a local child process speaking one UTF-8 JSON object per line over
 * stdin/stdout (JSON Lines). Implements the SutAdapter contract from
 * src/testing.ts. See docs/adapters/CLI-PROCESS.md for the protocol and the
 * security boundaries.
 *
 * Security invariants:
 * - the executable is spawned directly with an argument array; no shell,
 *   no string-built command line;
 * - the child only receives environment variables from a small platform
 *   baseline plus an explicit allowlist; values are never logged and never
 *   included in error messages;
 * - stderr is captured as bounded diagnostic text and is never parsed as
 *   protocol data.
 */

import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { AdapterResponse, JsonObject, JsonValue, OutputSymbol, SutAdapter } from '../testing';

// ---------------------------------------------------------------------------
// Public configuration and error types
// ---------------------------------------------------------------------------

export type CliProcessAdapterOptions = {
  /** Executable path or name (resolved via the child PATH baseline). */
  executable: string;
  /** Argument array passed verbatim to the executable. */
  args?: readonly string[];
  /** Working directory of the child process. */
  cwd?: string;
  /**
   * Names of environment variables copied from the current process into the
   * child. A small platform baseline (PATH, SystemRoot, TEMP, ...) is always
   * included so that ordinary executables can start at all.
   */
  envAllowlist?: readonly string[];
  /** Milliseconds to wait for the child process to spawn. Default 5000. */
  startupTimeoutMs?: number;
  /** Milliseconds to wait for each protocol response. Default 5000. */
  responseTimeoutMs?: number;
  /** Maximum accepted stdout line size in bytes. Default 65536. */
  maxLineBytes?: number;
  /** Maximum retained stderr bytes (diagnostics only). Default 16384. */
  stderrLimitBytes?: number;
};

export type CliProcessAdapterErrorKind =
  | 'spawn'
  | 'startup-timeout'
  | 'response-timeout'
  | 'protocol'
  | 'process-exit'
  | 'broken-pipe'
  | 'cancelled'
  | 'closed'
  | 'state';

export class CliProcessAdapterError extends Error {
  readonly kind: CliProcessAdapterErrorKind;
  /** Bounded stderr diagnostics captured up to the failure. */
  readonly stderr: string;
  /** True when the captured stderr exceeded the limit and was truncated. */
  readonly stderrTruncated: boolean;

  constructor(kind: CliProcessAdapterErrorKind, message: string, stderr = '', stderrTruncated = false) {
    super(message);
    this.name = 'CliProcessAdapterError';
    this.kind = kind;
    this.stderr = stderr;
    this.stderrTruncated = stderrTruncated;
  }
}

export type StderrSnapshot = { text: string; truncated: boolean };

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type RequestType = 'reset' | 'input' | 'close';
type ResponseType = 'ready' | 'output' | 'closed';

const EXPECTED_RESPONSE: Record<RequestType, ResponseType> = {
  reset: 'ready',
  input: 'output',
  close: 'closed',
};

type ParsedResponse = {
  type: ResponseType;
  requestId: string;
  symbol: OutputSymbol;
  metadata?: JsonObject;
};

type Pending = {
  requestId: string;
  expected: ResponseType;
  resolve: (response: ParsedResponse) => void;
  reject: (error: CliProcessAdapterError) => void;
};

type Child = ChildProcessByStdio<Writable, Readable, Readable>;

const WINDOWS_ENV_BASELINE = ['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP'] as const;
const POSIX_ENV_BASELINE = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'] as const;

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value as object).every(isJsonValue);
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `terminated by signal ${signal}`;
  return `exited with code ${code ?? 'unknown'}`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class CliProcessAdapter implements SutAdapter {
  private readonly options: Required<Pick<CliProcessAdapterOptions,
    'executable' | 'args' | 'envAllowlist' | 'startupTimeoutMs' | 'responseTimeoutMs' | 'maxLineBytes' | 'stderrLimitBytes'>> &
    Pick<CliProcessAdapterOptions, 'cwd'>;

  private child: Child | undefined;
  private childExit: Promise<void> = Promise.resolve();
  private stdoutCarry = '';
  private stderrText = '';
  private stderrTruncated = false;
  private pending: Pending | undefined;
  private completedIds = new Set<string>();
  private requestCounter = 0;
  /** Set when the protocol or the process broke; cleared by the next reset(). */
  private fatal: CliProcessAdapterError | undefined;
  private closePromise: Promise<void> | undefined;

  constructor(options: CliProcessAdapterOptions) {
    if (options.executable.trim() === '') throw new TypeError('executable must be a non-empty string.');
    this.options = {
      executable: options.executable,
      args: [...(options.args ?? [])],
      cwd: options.cwd,
      envAllowlist: [...(options.envAllowlist ?? [])],
      startupTimeoutMs: options.startupTimeoutMs ?? 5_000,
      responseTimeoutMs: options.responseTimeoutMs ?? 5_000,
      maxLineBytes: options.maxLineBytes ?? 65_536,
      stderrLimitBytes: options.stderrLimitBytes ?? 16_384,
    };
    for (const [key, value] of Object.entries({
      startupTimeoutMs: this.options.startupTimeoutMs,
      responseTimeoutMs: this.options.responseTimeoutMs,
      maxLineBytes: this.options.maxLineBytes,
      stderrLimitBytes: this.options.stderrLimitBytes,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${key} must be a positive safe integer.`);
    }
  }

  /** True while a child process is alive. */
  get running(): boolean {
    return this.child !== undefined;
  }

  /** Bounded diagnostic stderr captured from the current/last child. */
  stderrSnapshot(): StderrSnapshot {
    return { text: this.stderrText, truncated: this.stderrTruncated };
  }

  async reset(signal?: AbortSignal): Promise<void> {
    this.ensureNotClosed();
    // A reset recovers from a previous protocol/process failure: wait until
    // the broken child is fully gone, then start a fresh one.
    if (this.fatal !== undefined) {
      await this.terminate();
      this.fatal = undefined;
    }
    if (this.child === undefined) await this.start(signal);
    await this.request('reset', undefined, signal);
  }

  async send(input: string, signal?: AbortSignal): Promise<AdapterResponse> {
    this.ensureNotClosed();
    if (this.child === undefined) {
      throw this.fatal ?? new CliProcessAdapterError('state', 'Adapter has no running process; call reset() first.');
    }
    const startedAt = Date.now();
    const response = await this.request('input', input, signal);
    const timestamp = Date.now();
    const result: AdapterResponse = { output: response.symbol, timestamp, durationMs: timestamp - startedAt };
    if (response.metadata !== undefined) result.metadata = response.metadata;
    return result;
  }

  async close(): Promise<void> {
    this.closePromise ??= this.performClose();
    return this.closePromise;
  }

  // -- lifecycle -------------------------------------------------------------

  private async performClose(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    if (this.fatal === undefined && this.pending === undefined) {
      // Polite shutdown: ask the SUT to close, but never rely on it.
      try {
        await this.request('close', undefined);
      } catch {
        // Diagnostics only; termination below guarantees cleanup.
      }
    }
    await this.terminate();
  }

  private async terminate(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    child.kill();
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
    await this.childExit;
    clearTimeout(forceTimer);
  }

  private ensureNotClosed(): void {
    if (this.closePromise !== undefined) throw new CliProcessAdapterError('closed', 'Adapter is closed.');
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const baseline = process.platform === 'win32' ? WINDOWS_ENV_BASELINE : POSIX_ENV_BASELINE;
    const names = new Set<string>([...baseline, ...this.options.envAllowlist]);
    const env: NodeJS.ProcessEnv = {};
    for (const name of names) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    return env;
  }

  private async start(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new CliProcessAdapterError('cancelled', 'Cancelled before the process started.');
    this.stdoutCarry = '';
    this.stderrText = '';
    this.stderrTruncated = false;
    this.completedIds.clear();

    const child = spawn(this.options.executable, this.options.args, {
      cwd: this.options.cwd,
      env: this.buildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    this.child = child;
    this.childExit = new Promise((resolve) => {
      child.once('exit', (code, signalName) => {
        this.child = undefined;
        this.onChildExit(code, signalName);
        resolve();
      });
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.onStderr(chunk));
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      this.fail(new CliProcessAdapterError('broken-pipe', `Writing to the SUT failed: ${error.code ?? error.message}.`,
        this.stderrText, this.stderrTruncated));
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        void this.terminate();
        reject(new CliProcessAdapterError('startup-timeout',
          `Process did not start within ${this.options.startupTimeoutMs} ms.`, this.stderrText, this.stderrTruncated));
      }, this.options.startupTimeoutMs);
      const onSpawn = () => { cleanup(); resolve(); };
      const onError = (error: Error) => {
        cleanup();
        this.child = undefined;
        reject(new CliProcessAdapterError('spawn', `Failed to spawn ${JSON.stringify(this.options.executable)}: ${error.message}.`));
      };
      const onAbort = () => {
        cleanup();
        void this.terminate();
        reject(new CliProcessAdapterError('cancelled', 'Cancelled while the process was starting.'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        child.off('spawn', onSpawn);
        child.off('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // -- request/response ------------------------------------------------------

  private request(type: RequestType, symbol: string | undefined, signal?: AbortSignal): Promise<ParsedResponse> {
    return new Promise<ParsedResponse>((resolve, reject) => {
      if (this.fatal) { reject(this.fatal); return; }
      const child = this.child;
      if (child === undefined) {
        reject(new CliProcessAdapterError('state', 'No running process.'));
        return;
      }
      if (this.pending !== undefined) {
        reject(new CliProcessAdapterError('state', 'A request is already pending; the protocol is strictly sequential.'));
        return;
      }
      if (signal?.aborted) {
        reject(new CliProcessAdapterError('cancelled', 'Cancelled before the request was sent.'));
        return;
      }

      this.requestCounter += 1;
      const requestId = `r${this.requestCounter}`;
      const expected = EXPECTED_RESPONSE[type];

      const timer = setTimeout(() => {
        this.fail(new CliProcessAdapterError('response-timeout',
          `No ${expected} response for ${requestId} within ${this.options.responseTimeoutMs} ms.`,
          this.stderrText, this.stderrTruncated));
      }, this.options.responseTimeoutMs);
      const onAbort = () => {
        this.fail(new CliProcessAdapterError('cancelled', `Request ${requestId} was cancelled.`));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pending = {
        requestId,
        expected,
        resolve: (response) => { settle(); resolve(response); },
        reject: (error) => { settle(); reject(error); },
      };
      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.completedIds.add(requestId);
        this.pending = undefined;
      };

      const message: Record<string, JsonValue> = { type, requestId };
      if (type === 'input') message['symbol'] = symbol ?? '';
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        this.fail(new CliProcessAdapterError('broken-pipe',
          `Writing to the SUT failed: ${error instanceof Error ? error.message : String(error)}.`,
          this.stderrText, this.stderrTruncated));
      }
    });
  }

  /**
   * Record a fatal failure: reject the pending request, remember the error so
   * later sends fail fast, and terminate the child. reset() recovers by
   * spawning a fresh process.
   */
  private fail(error: CliProcessAdapterError): void {
    if (this.fatal === undefined) this.fatal = error;
    this.pending?.reject(error);
    if (this.child !== undefined) void this.terminate();
  }

  private onChildExit(code: number | null, signalName: NodeJS.Signals | null): void {
    if (this.closePromise !== undefined || this.fatal !== undefined) {
      // Expected during close() or after a failure already reported.
      this.pending?.reject(this.fatal ?? new CliProcessAdapterError('closed', 'Adapter is closing.'));
      return;
    }
    const error = new CliProcessAdapterError('process-exit',
      `SUT process ${describeExit(code, signalName)} before responding.`, this.stderrText, this.stderrTruncated);
    if (this.pending !== undefined) {
      this.fatal = error;
      this.pending.reject(error);
    } else {
      // Early exit with no request in flight: report on the next call.
      this.fatal = new CliProcessAdapterError('process-exit',
        `SUT process ${describeExit(code, signalName)} unexpectedly.`, this.stderrText, this.stderrTruncated);
    }
  }

  private onStderr(chunk: string): void {
    const remaining = this.options.stderrLimitBytes - Buffer.byteLength(this.stderrText, 'utf8');
    if (remaining <= 0) {
      this.stderrTruncated = true;
      return;
    }
    if (Buffer.byteLength(chunk, 'utf8') > remaining) {
      this.stderrText += chunk.slice(0, remaining);
      this.stderrTruncated = true;
    } else {
      this.stderrText += chunk;
    }
  }

  private onStdout(chunk: string): void {
    this.stdoutCarry += chunk;
    if (Buffer.byteLength(this.stdoutCarry, 'utf8') > this.options.maxLineBytes && !this.stdoutCarry.includes('\n')) {
      this.fail(new CliProcessAdapterError('protocol',
        `SUT wrote more than ${this.options.maxLineBytes} bytes without a line break.`, this.stderrText, this.stderrTruncated));
      return;
    }
    let newlineIndex = this.stdoutCarry.indexOf('\n');
    while (newlineIndex >= 0) {
      let line = this.stdoutCarry.slice(0, newlineIndex);
      this.stdoutCarry = this.stdoutCarry.slice(newlineIndex + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length > 0) {
        this.onLine(line);
        if (this.fatal !== undefined) return;
      }
      newlineIndex = this.stdoutCarry.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    if (Buffer.byteLength(line, 'utf8') > this.options.maxLineBytes) {
      this.fail(new CliProcessAdapterError('protocol',
        `SUT response line exceeds the ${this.options.maxLineBytes} byte limit.`, this.stderrText, this.stderrTruncated));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.fail(new CliProcessAdapterError('protocol', 'SUT wrote a line that is not valid JSON.',
        this.stderrText, this.stderrTruncated));
      return;
    }
    if (!isPlainObject(parsed)) {
      this.fail(new CliProcessAdapterError('protocol', 'SUT response is not a JSON object.',
        this.stderrText, this.stderrTruncated));
      return;
    }
    const type = parsed['type'];
    const requestId = parsed['requestId'];
    if (typeof requestId !== 'string' || requestId === '') {
      this.fail(new CliProcessAdapterError('protocol', 'SUT response is missing a requestId.',
        this.stderrText, this.stderrTruncated));
      return;
    }
    const pending = this.pending;
    if (pending === undefined || requestId !== pending.requestId) {
      const reason = this.completedIds.has(requestId)
        ? `Duplicate response for already completed request ${JSON.stringify(requestId)}.`
        : pending === undefined
          ? `Unsolicited response with requestId ${JSON.stringify(requestId)}.`
          : `Response requestId ${JSON.stringify(requestId)} does not match pending ${JSON.stringify(pending.requestId)}.`;
      this.fail(new CliProcessAdapterError('protocol', reason, this.stderrText, this.stderrTruncated));
      return;
    }
    if (type !== pending.expected) {
      this.fail(new CliProcessAdapterError('protocol',
        `Expected a ${JSON.stringify(pending.expected)} response for ${pending.requestId}, got ${JSON.stringify(type)}.`,
        this.stderrText, this.stderrTruncated));
      return;
    }

    let symbol: OutputSymbol = null;
    if (pending.expected === 'output') {
      const raw = parsed['symbol'];
      if (raw !== null && typeof raw !== 'string') {
        this.fail(new CliProcessAdapterError('protocol',
          `Output response ${pending.requestId} must carry a string or null symbol.`, this.stderrText, this.stderrTruncated));
        return;
      }
      symbol = raw ?? null;
    }
    const response: ParsedResponse = { type: pending.expected, requestId, symbol };
    const metadata = parsed['metadata'];
    if (metadata !== undefined) {
      if (!isPlainObject(metadata) || !isJsonValue(metadata)) {
        this.fail(new CliProcessAdapterError('protocol',
          `Response metadata for ${pending.requestId} must be a JSON object.`, this.stderrText, this.stderrTruncated));
        return;
      }
      response.metadata = metadata as JsonObject;
    }
    pending.resolve(response);
  }
}
