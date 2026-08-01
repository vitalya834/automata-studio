import { describe, expect, it } from 'vitest';
import { parseRunnerCliArgs, RunnerCliUsageError } from './runner-cli-options';

describe('runner CLI options', () => {
  it('shows help by default', () => {
    expect(parseRunnerCliArgs([])).toEqual({ kind: 'help' });
  });

  it('parses validation with JSON output', () => {
    expect(parseRunnerCliArgs(['validate', 'plan.json', '--format', 'json']))
      .toEqual({ kind: 'validate', planPath: 'plan.json', format: 'json' });
  });

  it('parses reproducible random-walk generation', () => {
    expect(parseRunnerCliArgs([
      'generate', 'game.fsm', '--strategy', 'random-walk', '--output', 'game-plan.json',
      '--cases', '40', '--max-steps', '30', '--timeout', '750', '--seed', 'game-2026',
    ])).toEqual({
      kind: 'generate', modelPath: 'game.fsm', strategy: 'random-walk', outputPath: 'game-plan.json',
      cases: 40, maxSteps: 30, timeoutMs: 750, seed: 'game-2026',
      maxImplementationStates: undefined, maxCases: 10_000,
    });
    expect(() => parseRunnerCliArgs(['generate', 'game.fsm'])).toThrow('--output');
  });

  it('parses standards-based conformance generation limits', () => {
    expect(parseRunnerCliArgs([
      'generate', 'controller.fsm', '--strategy', 'w', '--output', 'w-plan.json',
      '--max-implementation-states', '6', '--max-cases', '2500',
    ])).toMatchObject({ strategy: 'w', maxImplementationStates: 6, maxCases: 2500 });
  });

  it('parses a CLI process run without building a command string', () => {
    expect(parseRunnerCliArgs([
      'run', '--plan', 'plan.json', '--adapter', 'cli', '--executable', 'node',
      '--arg', 'sut.cjs', '--arg', '--safe-mode', '--env', 'SUT_TOKEN',
      '--response-timeout', '2500', '--report', 'result.json', '--junit', 'junit.xml',
    ])).toEqual({
      kind: 'run',
      planPath: 'plan.json',
      adapter: 'cli',
      executable: 'node',
      args: ['sut.cjs', '--safe-mode'],
      cwd: undefined,
      envAllowlist: ['SUT_TOKEN'],
      startupTimeoutMs: undefined,
      responseTimeoutMs: 2500,
      reportPath: 'result.json',
      junitPath: 'junit.xml',
      htmlPath: undefined,
      format: 'text',
    });
  });

  it('rejects missing values, unsafe ambiguity and invalid numbers', () => {
    expect(() => parseRunnerCliArgs(['run', '--plan'])).toThrow(RunnerCliUsageError);
    expect(() => parseRunnerCliArgs(['run', '--plan', 'p', '--adapter', 'modbus']))
      .toThrow('--config is required');
    expect(() => parseRunnerCliArgs(['run', '--plan', 'p', '--adapter', 'cli', '--executable', 'x',
      '--response-timeout', '0'])).toThrow('positive integer');
    expect(() => parseRunnerCliArgs(['validate', '--plan', 'p', '--executable', 'x']))
      .toThrow('validate accepts only');
  });

  it('parses a Modbus run with adapter configuration isolated from the plan', () => {
    expect(parseRunnerCliArgs([
      'run', 'plan.json', '--adapter', 'modbus', '--config', 'modbus.json',
      '--format', 'json', '--report', 'result.json', '--html', 'report.html',
    ])).toEqual({
      kind: 'run', planPath: 'plan.json', adapter: 'modbus', configPath: 'modbus.json',
      format: 'json', reportPath: 'result.json', junitPath: undefined, htmlPath: 'report.html',
    });
  });

  it('parses an HTTP API run', () => {
    expect(parseRunnerCliArgs([
      'run', 'plan.json', '--adapter', 'http', '--config', 'http.json', '--html', 'report.html',
    ])).toEqual({
      kind: 'run', planPath: 'plan.json', adapter: 'http', configPath: 'http.json',
      format: 'text', reportPath: undefined, junitPath: undefined, htmlPath: 'report.html',
    });
  });
});
