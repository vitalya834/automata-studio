import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CliProcessAdapter } from './adapters/cli-process';
import { ModbusTcpAdapter, type ModbusTcpAdapterOptions } from './adapters/modbus-tcp';
import { HttpAdapter, type HttpAdapterOptions } from './adapters/http';
import {
  parseTestPlan,
  runTestPlan,
  serializeTestPlan,
  transitionCoverToTestPlan,
  type TestRunResult,
} from './testing';
import { parseRunnerCliArgs, RunnerCliUsageError } from './runner-cli-options';
import { testRunToHtml, testRunToJUnit } from './reports';
import { generateTransitionCover, parseMachine, type Machine } from './fsm';
import { randomWalkToTestPlan } from './campaign';
import { conformanceSuiteToTestPlan, generateConformanceSuite } from './conformance';

const HELP = `Automata Studio test runner v1.0

Usage:
  automata generate <model.fsm> --output <plan.json> [options]
  automata validate <plan.json> [--format text|json]
  automata run <plan.json> --adapter cli --executable <path> [options]
  automata run <plan.json> --adapter modbus --config <adapter.json> [options]
  automata run <plan.json> --adapter http --config <adapter.json> [options]

Generator options:
  --strategy transition-cover|random-walk|w|wp|hsi
                                  Generation algorithm
  --cases <count>               Random-walk case count (default: 25)
  --max-steps <count>           Maximum steps per random walk (default: 20)
  --timeout <ms>                Per-step deadline (default: 1000)
  --seed <value>                Reproducible random seed (default: 2026)
  --max-implementation-states <count>
                                  IUT state upper bound for W (default: model size)
  --max-cases <count>           Conformance-suite safety limit (default: 10000)
  --output <file>               Destination Test Plan IR JSON

CLI adapter options:
  --arg <value>                 Repeat for every executable argument
  --cwd <directory>             Child process working directory
  --env <NAME>                  Allow one environment variable; repeatable
  --startup-timeout <ms>        Process startup deadline
  --response-timeout <ms>       Adapter response deadline
  --report <file>               Write the complete JSON result
  --junit <file>                Write a JUnit XML evidence report
  --html <file>                 Write a standalone HTML evidence report
  --format text|json            Console output format (default: text)

Modbus adapter options:
  --config <file>               Host, unit ID, symbol mapping and write gate
  --report <file>               Write the complete JSON result
  --junit <file>                Write a JUnit XML evidence report
  --html <file>                 Write a standalone HTML evidence report
  --format text|json            Console output format (default: text)

HTTP adapter options:
  --config <file>               Base URL, reset request and input mappings
  --report <file>               Write the complete JSON result
  --junit <file>                Write a JUnit XML evidence report
  --html <file>                 Write a standalone HTML evidence report
  --format text|json            Console output format (default: text)

Examples:
  npm run cli -- generate examples/game-session.fsm --output game-plan.json
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

async function readDslMachine(modelPath: string): Promise<Machine> {
  const absolute = resolve(modelPath);
  let source: string;
  try { source = await readFile(absolute, 'utf8'); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RunnerCliUsageError(`Cannot read model ${JSON.stringify(absolute)}: ${message}`);
  }
  const parsed = parseMachine(source);
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (parsed.machine === undefined || errors.length > 0) {
    throw new RunnerCliUsageError(`Invalid FSM model in ${JSON.stringify(absolute)}:\n${errors
      .map((diagnostic) => `  line ${diagnostic.line}: ${diagnostic.message}`).join('\n')}`);
  }
  return parsed.machine;
}

function planSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^[.-]+|[.-]+$/g, '') || 'campaign';
}

async function readModbusConfig(configPath: string): Promise<ModbusTcpAdapterOptions> {
  const absolute = resolve(configPath);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(absolute, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RunnerCliUsageError(`Cannot read Modbus config ${JSON.stringify(absolute)}: ${message}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RunnerCliUsageError(`Modbus config ${JSON.stringify(absolute)} must be a JSON object.`);
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['host'] !== 'string' || typeof candidate['port'] !== 'number'
    || typeof candidate['inputs'] !== 'object' || candidate['inputs'] === null || Array.isArray(candidate['inputs'])) {
    throw new RunnerCliUsageError('Modbus config requires string host, numeric port and object inputs.');
  }
  return value as ModbusTcpAdapterOptions;
}

async function readHttpConfig(configPath: string): Promise<HttpAdapterOptions> {
  const absolute = resolve(configPath);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(absolute, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RunnerCliUsageError(`Cannot read HTTP config ${JSON.stringify(absolute)}: ${message}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RunnerCliUsageError(`HTTP config ${JSON.stringify(absolute)} must be a JSON object.`);
  }
  return value as HttpAdapterOptions;
}

async function main(): Promise<number> {
  const command = parseRunnerCliArgs(process.argv.slice(2));
  if (command.kind === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  if (command.kind === 'generate') {
    const machine = await readDslMachine(command.modelPath);
    const id = `${planSlug(machine.name)}-${command.strategy}`;
    const plan = command.strategy === 'transition-cover'
      ? transitionCoverToTestPlan(generateTransitionCover(machine), {
          id, name: `${machine.name} transition cover`, modelId: machine.name, timeoutMs: command.timeoutMs,
          metadata: { sourceModel: command.modelPath },
        })
      : command.strategy === 'random-walk'
        ? randomWalkToTestPlan(machine, {
          id, name: `${machine.name} random-walk campaign`, modelId: machine.name,
          cases: command.cases, maxSteps: command.maxSteps, timeoutMs: command.timeoutMs, seed: command.seed,
          metadata: { sourceModel: command.modelPath },
        })
        : conformanceSuiteToTestPlan(generateConformanceSuite(machine, {
            method: command.strategy,
            maxImplementationStates: command.maxImplementationStates,
            maxCases: command.maxCases,
          }), {
            id,
            name: `${machine.name} ${command.strategy.toUpperCase()} conformance campaign`,
            modelId: machine.name,
            timeoutMs: command.timeoutMs,
            metadata: { sourceModel: command.modelPath },
          });
    await writeFile(resolve(command.outputPath), `${serializeTestPlan(plan)}\n`, 'utf8');
    process.stdout.write(`GENERATED  ${command.strategy}  cases=${plan.cases.length}  output=${resolve(command.outputPath)}\n`);
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

  const adapter = command.adapter === 'cli'
    ? new CliProcessAdapter({
        executable: command.executable,
        args: command.args,
        cwd: command.cwd,
        envAllowlist: command.envAllowlist,
        startupTimeoutMs: command.startupTimeoutMs,
        responseTimeoutMs: command.responseTimeoutMs,
      })
    : command.adapter === 'modbus'
      ? new ModbusTcpAdapter(await readModbusConfig(command.configPath))
      : new HttpAdapter(await readHttpConfig(command.configPath));
  const result = await runTestPlan(plan, adapter);
  const json = JSON.stringify(result, null, 2);
  const writes: Promise<void>[] = [];
  if (command.reportPath !== undefined) writes.push(writeFile(resolve(command.reportPath), `${json}\n`, 'utf8'));
  if (command.junitPath !== undefined) writes.push(writeFile(resolve(command.junitPath), testRunToJUnit(result), 'utf8'));
  if (command.htmlPath !== undefined) writes.push(writeFile(resolve(command.htmlPath), testRunToHtml(result), 'utf8'));
  await Promise.all(writes);
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
