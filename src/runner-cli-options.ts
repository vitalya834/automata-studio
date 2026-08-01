export type OutputFormat = 'text' | 'json';

export type RunnerCliCommand =
  | { kind: 'help' }
  | { kind: 'validate'; planPath: string; format: OutputFormat }
  | {
      kind: 'run';
      planPath: string;
      adapter: 'cli';
      executable: string;
      args: string[];
      cwd?: string;
      envAllowlist: string[];
      startupTimeoutMs?: number;
      responseTimeoutMs?: number;
      reportPath?: string;
      junitPath?: string;
      htmlPath?: string;
      format: OutputFormat;
    }
  | {
      kind: 'run';
      planPath: string;
      adapter: 'modbus';
      configPath: string;
      reportPath?: string;
      junitPath?: string;
      htmlPath?: string;
      format: OutputFormat;
    }
  | {
      kind: 'run';
      planPath: string;
      adapter: 'http';
      configPath: string;
      reportPath?: string;
      junitPath?: string;
      htmlPath?: string;
      format: OutputFormat;
    };

export class RunnerCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerCliUsageError';
  }
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || (flag !== '--arg' && value.startsWith('--'))) {
    throw new RunnerCliUsageError(`${flag} requires a value.`);
  }
  return value;
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RunnerCliUsageError(`${flag} must be a positive integer.`);
  }
  return parsed;
}

export function parseRunnerCliArgs(argv: string[]): RunnerCliCommand {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    return { kind: 'help' };
  }

  const kind = argv[0];
  if (kind !== 'run' && kind !== 'validate') {
    throw new RunnerCliUsageError(`Unknown command ${JSON.stringify(kind)}.`);
  }

  let planPath: string | undefined = argv[1]?.startsWith('--') === false ? argv[1] : undefined;
  let adapter: string | undefined;
  let executable: string | undefined;
  let configPath: string | undefined;
  const args: string[] = [];
  let cwd: string | undefined;
  const envAllowlist: string[] = [];
  let startupTimeoutMs: number | undefined;
  let responseTimeoutMs: number | undefined;
  let reportPath: string | undefined;
  let junitPath: string | undefined;
  let htmlPath: string | undefined;
  let format: OutputFormat = 'text';

  for (let index = planPath === undefined ? 1 : 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { kind: 'help' };
    const value = valueAfter(argv, index, flag);
    index += 1;
    switch (flag) {
      case '--plan': planPath = value; break;
      case '--adapter': adapter = value; break;
      case '--executable': executable = value; break;
      case '--config': configPath = value; break;
      case '--arg': args.push(value); break;
      case '--cwd': cwd = value; break;
      case '--env': envAllowlist.push(value); break;
      case '--startup-timeout': startupTimeoutMs = positiveInteger(value, flag); break;
      case '--response-timeout': responseTimeoutMs = positiveInteger(value, flag); break;
      case '--report': reportPath = value; break;
      case '--junit': junitPath = value; break;
      case '--html': htmlPath = value; break;
      case '--format':
        if (value !== 'text' && value !== 'json') {
          throw new RunnerCliUsageError('--format must be text or json.');
        }
        format = value;
        break;
      default: throw new RunnerCliUsageError(`Unknown option ${JSON.stringify(flag)}.`);
    }
  }

  if (planPath === undefined) throw new RunnerCliUsageError('A plan path or --plan is required.');
  if (kind === 'validate') {
    if (adapter !== undefined || executable !== undefined || configPath !== undefined || args.length > 0 || cwd !== undefined
      || envAllowlist.length > 0 || startupTimeoutMs !== undefined || responseTimeoutMs !== undefined
      || reportPath !== undefined || junitPath !== undefined || htmlPath !== undefined) {
      throw new RunnerCliUsageError('validate accepts only --plan and --format.');
    }
    return { kind, planPath, format };
  }

  if (adapter !== 'cli' && adapter !== 'modbus' && adapter !== 'http') {
    throw new RunnerCliUsageError('run requires --adapter cli, --adapter modbus or --adapter http.');
  }
  if (adapter === 'modbus' || adapter === 'http') {
    if (configPath === undefined) throw new RunnerCliUsageError(`--config is required for the ${adapter} adapter.`);
    if (executable !== undefined || args.length > 0 || cwd !== undefined || envAllowlist.length > 0
      || startupTimeoutMs !== undefined || responseTimeoutMs !== undefined) {
      throw new RunnerCliUsageError(`${adapter} connection and mapping options belong in --config.`);
    }
    return { kind, planPath, adapter, configPath, reportPath, junitPath, htmlPath, format };
  }
  if (configPath !== undefined) throw new RunnerCliUsageError('--config is only valid for the modbus and http adapters.');
  if (executable === undefined) throw new RunnerCliUsageError('--executable is required for the cli adapter.');

  return {
    kind,
    planPath,
    adapter,
    executable,
    args,
    cwd,
    envAllowlist,
    startupTimeoutMs,
    responseTimeoutMs,
    reportPath,
    junitPath,
    htmlPath,
    format,
  };
}
