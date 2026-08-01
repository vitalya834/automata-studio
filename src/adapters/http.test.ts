import { describe, expect, it, vi } from 'vitest';
import { HttpAdapter, type HttpAdapterOptions } from './http';

const config = (): HttpAdapterOptions => ({
  baseUrl: 'https://sut.example/api/',
  reset: { method: 'POST', path: 'reset' },
  inputs: {
    classify: {
      method: 'POST', path: 'predict', body: { features: [0.2, 0.8] },
      output: { kind: 'json-pointer', pointer: '/prediction/label' },
    },
    health: { path: 'health', output: { kind: 'status' } },
  },
});

describe('HttpAdapter', () => {
  it('resets and maps an input to a JSON API output', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ prediction: { label: 'cat' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    const adapter = new HttpAdapter(config(), fetchMock);

    await adapter.reset();
    const response = await adapter.send('classify');

    expect(response.output).toBe('cat');
    expect(response.metadata).toMatchObject({ status: 200, ok: true });
    expect(fetchMock).toHaveBeenNthCalledWith(1, new URL('https://sut.example/api/reset'), expect.objectContaining({
      method: 'POST', redirect: 'error',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, new URL('https://sut.example/api/predict'), expect.objectContaining({
      method: 'POST', body: JSON.stringify({ features: [0.2, 0.8] }),
    }));
  });

  it('can use status codes as FSM outputs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    const adapter = new HttpAdapter(config(), fetchMock);
    expect((await adapter.send('health')).output).toBe('200');
  });

  it('rejects cross-origin paths, unsafe headers and oversized responses', async () => {
    expect(() => new HttpAdapter({ ...config(), inputs: { bad: { path: 'https://evil.example/' } } })).toThrow('baseUrl origin');
    expect(() => new HttpAdapter({ ...config(), inputs: { bad: { path: '/', headers: { Host: 'evil.example' } } } }))
      .toThrow('transport-controlled');
    expect(() => new HttpAdapter({ ...config(), inputs: { bad: { method: 'GET', path: '/', body: {} } } }))
      .toThrow('body with GET');

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('12345'));
    const adapter = new HttpAdapter({ ...config(), maxResponseBytes: 4 }, fetchMock);
    await expect(adapter.send('health')).rejects.toThrow('maxResponseBytes');
  });

  it('rejects unknown symbols and use after close', async () => {
    const adapter = new HttpAdapter(config(), vi.fn<typeof fetch>());
    await expect(adapter.send('missing')).rejects.toThrow('No HTTP operation');
    await adapter.close();
    await expect(adapter.reset()).rejects.toThrow('closed');
  });
});
