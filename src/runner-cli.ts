import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CliProcessAdapter } from './adapters/cli-process';
import { parseTestPlan, runTestPlan, type TestRunResult } from './testing';
import { parseRunnerCliArgs, RunnerCliUsageError } from './runner-cli-options';

const HELP = `Automata Studio test runner v0.6

Usage:
  automata validate <plan.json> [--format text|json]
  automata run <plan.json> --adapter cli --executable <path> [options]

CLI adapter options:
  --arg <value>                 Repeat for every executable argument
  --cwd <directory>             Child process working directory
  --env <NAME>                  Allow one environment variable; repeatable
  --startup-timeout <ms>        Process startup deadline
  --response-timeout <ms>       Adapter response deadline
  --report <file>               Write the complete JSON result
  --format text|json            Console output format (default: text)

Examples:
  npm run cli -- validate examples/test-plans/turnstile-transition-cover.json
  npm run demo:cli

Safety: executables are spawned directly without a shell. Environment variables
are hidden unless explicitly allowed with --env.
`;

function validationText(planPath: string, cases: number): string {
  return `VALID  ${planPath}\nCases: ${cases}`;
}

function resultText(result: TestRunResult): string {
  const duration = result.finishedAt - result.startedAt;
  const lines = [
    `${result.verdict.toUpperCase()}  plan=${result.planId}  duration=${duration}ms`,
    `Cases: pass=${result.counts.pass} fail=${result.counts.fail} timeout=${result.counts.timeout} inconclusive=${result.counts.inconclusive} invalid=${result.counts.invalid}`,
  ];
  for (const testCase of result.cases) {
    lines.push(`  ${testCase.verdict.toUpperCase().padEnd(12)} ${testCase.caseId} — ${testCase.name}`);
    for (const step of testCase.steps) {
      const output = step.response === undefined ? '—' : JSON.stringify(step.response.output);
      lines.push(`    ${step.verdict.toUpperCase().padEnd(10)} #${step.index + 1} input=${JSON.stringify(step.input)} output=${output}`);
    }
  }
  if (result.closeError !== undefined) lines.push(`Adapter close error: ${result.closeError}`);
  return lines.join('\n');
}

async function readPlan(planPath: string) {
  const absolute = resolve(planPath);
  let source: string;
  try {
    source = await readFile(absolute, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RunnerCliUsageError(`Cannot read plan ${JSON.stringify(absolute)}: ${message}`);
  }
  const parsed = parseTestPlan(source);
  if (!parsed.ok) {
    const diagnostics = parsed.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join('\n');
    throw new RunnerCliUsageError(`Invalid Test Plan IR in ${JSON.stringify(absolute)}:\n${diagnostics}`);
  }
  return parsed.value;
}

async function main(): Promise<number> {
  const command = parseRunnerCliArgs(process.argv.slice(2));
  if (command.kind === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const plan = await readPlan(command.planPath);
  if (command.kind === 'validate') {
    const value = command.format === 'json'
      ? JSON.stringify({ valid: true, planId: plan.id, cases: plan.cases.length }, null, 2)
      : validationText(command.planPath, plan.cases.length);
    process.stdout.write(`${value}\n`);
    return 0;
  }

  const adapter = new CliProcessAdapter({
    executable: command.executable,
    args: command.args,
    cwd: command.cwd,
    envAllowlist: command.envAllowlist,
    startupTimeoutMs: command.startupTimeoutMs,
    responseTimeoutMs: command.responseTimeoutMs,
  });
  const result = await runTestPlan(plan, adapter);
  const json = JSON.stringify(result, null, 2);
  if (command.reportPath !== undefined) {
    await writeFile(resolve(command.reportPath), `${json}\n`, 'utf8');
  }
  process.stdout.write(`${command.format === 'json' ? json : resultText(result)}\n`);
  return result.verdict === 'pass' ? 0 : 1;
}

main().then(
  (exitCode) => { process.exitCode = exitCode; },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ERROR: ${message}\n\n${error instanceof RunnerCliUsageError ? HELP : ''}`);
    process.exitCode = 2;
  },
);
