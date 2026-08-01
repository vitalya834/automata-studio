import type { AdapterResponse, JsonValue, SutAdapter } from '../testing';

export type HttpOutputSelector =
  | { kind: 'status' }
  | { kind: 'text' }
  | { kind: 'json-pointer'; pointer?: string };

export type HttpOperation = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: JsonValue;
  output?: HttpOutputSelector;
};

export type HttpAdapterOptions = {
  baseUrl: string;
  reset?: HttpOperation;
  inputs: Record<string, HttpOperation>;
  maxResponseBytes?: number;
};

const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const forbiddenHeaders = new Set(['connection', 'content-length', 'host', 'transfer-encoding']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateOperation(value: unknown, path: string): asserts value is HttpOperation {
  if (!isObject(value)) throw new TypeError(`${path} must be an object.`);
  if (typeof value.path !== 'string' || value.path.trim() === '') throw new TypeError(`${path}.path must be a non-empty string.`);
  if (value.method !== undefined && (typeof value.method !== 'string' || !methods.has(value.method))) {
    throw new TypeError(`${path}.method must be GET, POST, PUT, PATCH or DELETE.`);
  }
  if (value.method === 'GET' && value.body !== undefined) throw new TypeError(`${path} cannot use a body with GET.`);
  if (value.headers !== undefined) {
    if (!isObject(value.headers) || !Object.entries(value.headers).every(([name, item]) =>
      name.trim() !== '' && typeof item === 'string' && !forbiddenHeaders.has(name.toLowerCase()))) {
      throw new TypeError(`${path}.headers must contain string values and no transport-controlled headers.`);
    }
  }
  if (value.output !== undefined) {
    if (!isObject(value.output) || !['status', 'text', 'json-pointer'].includes(String(value.output.kind))) {
      throw new TypeError(`${path}.output.kind must be status, text or json-pointer.`);
    }
    if (value.output.kind === 'json-pointer' && value.output.pointer !== undefined
      && (typeof value.output.pointer !== 'string' || (!value.output.pointer.startsWith('/') && value.output.pointer !== ''))) {
      throw new TypeError(`${path}.output.pointer must be an RFC 6901 JSON pointer.`);
    }
  }
}

function pointerValue(value: unknown, pointer = '/output'): unknown {
  if (pointer === '') return value;
  let current = value;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(current) && !Array.isArray(current)) throw new Error(`JSON pointer ${JSON.stringify(pointer)} was not found.`);
    if (!Object.hasOwn(current, key)) throw new Error(`JSON pointer ${JSON.stringify(pointer)} was not found.`);
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function outputSymbol(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value) || isObject(value)) return JSON.stringify(value);
  throw new Error('Selected HTTP output is not a JSON value.');
}

export class HttpAdapter implements SutAdapter {
  private readonly baseUrl: URL;
  private readonly maxResponseBytes: number;
  private closed = false;

  constructor(
    private readonly options: HttpAdapterOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    try { this.baseUrl = new URL(options.baseUrl); } catch { throw new TypeError('baseUrl must be an absolute URL.'); }
    if (!['http:', 'https:'].includes(this.baseUrl.protocol) || this.baseUrl.username || this.baseUrl.password) {
      throw new TypeError('baseUrl must be an HTTP(S) URL without embedded credentials.');
    }
    if (!isObject(options.inputs) || Object.keys(options.inputs).length === 0) {
      throw new TypeError('inputs must contain at least one symbol mapping.');
    }
    Object.entries(options.inputs).forEach(([symbol, operation]) => {
      if (symbol.trim() === '') throw new TypeError('Input symbols must not be empty.');
      validateOperation(operation, `inputs.${symbol}`);
      this.resolveUrl(operation.path);
    });
    if (options.reset !== undefined) {
      validateOperation(options.reset, 'reset');
      this.resolveUrl(options.reset.path);
    }
    this.maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
      throw new TypeError('maxResponseBytes must be a positive safe integer.');
    }
  }

  private resolveUrl(path: string): URL {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) throw new TypeError('HTTP operation paths must stay on the baseUrl origin.');
    return url;
  }

  private async request(operation: HttpOperation, signal?: AbortSignal): Promise<{ response: Response; text: string; durationMs: number }> {
    if (this.closed) throw new Error('Adapter is closed.');
    signal?.throwIfAborted();
    const startedAt = Date.now();
    const headers = new Headers(operation.headers);
    const body = operation.body === undefined ? undefined : JSON.stringify(operation.body);
    if (body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const response = await this.fetchImpl(this.resolveUrl(operation.path), {
      method: operation.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body,
      signal,
      redirect: 'error',
    });
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
      await response.body?.cancel();
      throw new Error(`HTTP response exceeds maxResponseBytes (${this.maxResponseBytes}).`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (reader !== undefined) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += chunk.value.byteLength;
        if (received > this.maxResponseBytes) {
          await reader.cancel();
          throw new Error(`HTTP response exceeds maxResponseBytes (${this.maxResponseBytes}).`);
        }
        chunks.push(chunk.value);
      }
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { response, text: new TextDecoder().decode(bytes), durationMs: Date.now() - startedAt };
  }

  async reset(signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Adapter is closed.');
    if (this.options.reset === undefined) return;
    const { response } = await this.request(this.options.reset, signal);
    if (!response.ok) throw new Error(`HTTP reset returned ${response.status}.`);
  }

  async send(input: string, signal?: AbortSignal): Promise<AdapterResponse> {
    const operation = this.options.inputs[input];
    if (operation === undefined) throw new Error(`No HTTP operation is mapped for input ${JSON.stringify(input)}.`);
    const { response, text, durationMs } = await this.request(operation, signal);
    const selector = operation.output ?? { kind: 'json-pointer' as const, pointer: '/output' };
    let selected: unknown;
    if (selector.kind === 'status') selected = response.status;
    else if (selector.kind === 'text') selected = text;
    else {
      let json: unknown;
      try { json = JSON.parse(text) as unknown; } catch { throw new Error('HTTP response is not valid JSON.'); }
      selected = pointerValue(json, selector.pointer);
    }
    return {
      output: outputSymbol(selected),
      timestamp: Date.now(),
      durationMs,
      metadata: { status: response.status, ok: response.ok, url: response.url },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
