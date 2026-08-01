import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ModbusFixtureServer } from '../test-fixtures/modbus-tcp/fixture-server';

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const server = new ModbusFixtureServer();
  const port = await server.start();
  server.coils.set(10, true);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'automata-modbus-demo-'));
  const configPath = join(temporaryDirectory, 'adapter.json');
  const config = {
    host: '127.0.0.1',
    port,
    allowWrites: false,
    inputs: {
      read_lamp: {
        operation: { kind: 'readCoils', address: 10, quantity: 1 },
        outputs: [{ symbol: 'lamp_on', when: { kind: 'valueAt', index: 0, equals: 1 } }],
        otherwise: 'lamp_off',
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      resolve('dist-cli/runner-cli.js'),
      'run',
      resolve('examples/test-plans/modbus-lamp.json'),
      '--adapter', 'modbus',
      '--config', configPath,
    ], { cwd: process.cwd(), windowsHide: true });
    if (stderr !== '') process.stderr.write(stderr);
    process.stdout.write('Automata Studio runner CLI → Modbus TCP loopback\n');
    process.stdout.write(`Endpoint: 127.0.0.1:${port} (ephemeral, simulated)\n`);
    process.stdout.write(stdout);
  } finally {
    await server.stop();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Modbus demo failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
