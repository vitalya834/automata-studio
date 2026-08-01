import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateSequenceDataset, sequenceDatasetToJsonLines } from './dataset';
import { parseMachine } from './fsm';

function option(name: string, positionalIndex: number, fallback?: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? process.argv[2 + positionalIndex] ?? fallback : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} is required.`);
  return value;
}

function positive(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write('Usage: npm run dataset -- model.fsm dataset.jsonl [episodes=100] [maxSteps=20] [seed=2026]\n');
    return;
  }
  const inputPath = resolve(option('--input', 0));
  const outputPath = resolve(option('--output', 1));
  const parsed = parseMachine(await readFile(inputPath, 'utf8'));
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (parsed.machine === undefined || errors.length > 0) {
    throw new Error(errors.map((diagnostic) => `line ${diagnostic.line}: ${diagnostic.message}`).join('\n') || 'Model could not be parsed.');
  }
  const episodes = positive(option('--episodes', 2, '100'), '--episodes');
  const maxSteps = positive(option('--max-steps', 3, '20'), '--max-steps');
  const seed = option('--seed', 4, '2026');
  const samples = generateSequenceDataset(parsed.machine, { episodes, maxSteps, seed });
  await writeFile(outputPath, sequenceDatasetToJsonLines(samples), 'utf8');
  process.stdout.write(`Generated ${samples.length} records from ${episodes} episodes -> ${outputPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Dataset generation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
