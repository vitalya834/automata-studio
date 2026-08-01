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
  const planPath = join(temporaryDirectory, 'generated-plan.json');
  const junitPath = join(temporaryDirectory, 'junit.xml');
  const htmlPath = join(temporaryDirectory, 'report.html');
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
    const generated = await execFileAsync(process.execPath, [
      resolve('dist-cli/runner-cli.js'), 'generate', resolve('examples/game-session.fsm'),
      '--strategy', 'transition-cover', '--output', planPath,
    ], { cwd: process.cwd(), windowsHide: true });
    const executed = await execFileAsync(process.execPath, [
      resolve('dist-cli/runner-cli.js'), 'run', '--plan', planPath,
      '--adapter', 'http', '--config', configPath, '--junit', junitPath, '--html', htmlPath,
    ], { cwd: process.cwd(), windowsHide: true });
    if (generated.stderr !== '') process.stderr.write(generated.stderr);
    if (executed.stderr !== '') process.stderr.write(executed.stderr);
    process.stdout.write('Automata Studio full pipeline -> generated tests -> HTTP game service\n');
    process.stdout.write(`Endpoint: http://127.0.0.1:${port} (ephemeral, simulated)\n`);
    process.stdout.write(generated.stdout);
    process.stdout.write(executed.stdout);
    process.stdout.write('Evidence: JUnit XML + standalone HTML generated successfully\n');
  } finally {
    await server.stop();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`HTTP demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
