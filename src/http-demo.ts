import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { HttpGameFixtureServer } from '../test-fixtures/http/fixture-server';

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const server = new HttpGameFixtureServer();
  const port = await server.start();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'automata-http-demo-'));
  const configPath = join(temporaryDirectory, 'adapter.json');
  const operation = (action: string) => ({
    method: 'POST', path: '/game/action', body: { action }, output: { kind: 'json-pointer', pointer: '/output' },
  });
  await writeFile(configPath, `${JSON.stringify({
    baseUrl: `http://127.0.0.1:${port}`,
    reset: { method: 'POST', path: '/reset' },
    inputs: {
      start: operation('start'), pause: operation('pause'), resume: operation('resume'), win: operation('win'),
    },
  }, null, 2)}\n`, 'utf8');
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      resolve('dist-cli/runner-cli.js'), 'run', resolve('examples/test-plans/http-game.json'),
      '--adapter', 'http', '--config', configPath,
    ], { cwd: process.cwd(), windowsHide: true });
    if (stderr !== '') process.stderr.write(stderr);
    process.stdout.write('Automata Studio runner CLI -> HTTP game service loopback\n');
    process.stdout.write(`Endpoint: http://127.0.0.1:${port} (ephemeral, simulated)\n`);
    process.stdout.write(stdout);
  } finally {
    await server.stop();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`HTTP demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
