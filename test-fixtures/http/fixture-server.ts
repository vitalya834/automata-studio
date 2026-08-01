import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export class HttpGameFixtureServer {
  private server: Server | undefined;
  private state = 'menu';

  async start(): Promise<number> {
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        if (request.method === 'POST' && request.url === '/reset') {
          this.state = 'menu';
          response.statusCode = 204;
          response.end();
          return;
        }
        if (request.method !== 'POST' || request.url !== '/game/action') {
          response.statusCode = 404;
          response.end(JSON.stringify({ output: 'not_found' }));
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { action?: string };
        if (this.state === 'menu' && body.action === 'start') this.state = 'playing';
        else if (this.state === 'playing' && body.action === 'pause') this.state = 'paused';
        else if (this.state === 'paused' && body.action === 'resume') this.state = 'playing';
        else if (this.state === 'playing' && body.action === 'win') this.state = 'victory';
        response.end(JSON.stringify({ output: this.state }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    return (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
