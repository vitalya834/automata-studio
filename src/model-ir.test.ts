import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as AjvModule from 'ajv/dist/2020';
import {
  formatDiagnostics,
  isAutomataModel,
  validateModel,
  type DiagnosticCode,
} from './model-ir';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const validDir = join(root, 'examples', 'models', 'valid');
const invalidDir = join(root, 'examples', 'models', 'invalid');
const schemaPath = join(root, 'schema', 'automata-model-v1.schema.json');

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fixtureNames(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
}

const Ajv2020 = AjvModule.default;
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: {
    'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  },
});
const schemaValidate = ajv.compile(loadJson(schemaPath) as object);

const validNames = fixtureNames(validDir);
const invalidNames = fixtureNames(invalidDir);

/** Diagnostic code the TypeScript validator must emit per invalid fixture. */
const EXPECTED_CODES: Record<string, DiagnosticCode> = {
  'clock-reset-undeclared.json': 'missing-reference',
  'duplicate-state-id.json': 'duplicate-id',
  'initial-state-undeclared.json': 'initial-configuration',
  'interval-bounds.json': 'interval-bounds',
  'missing-reference.json': 'missing-reference',
  'missing-time-unit.json': 'required',
  'moore-transition-output.json': 'output-conflict',
  'probability-field.json': 'probability-forbidden',
  'timeout-target-undeclared.json': 'missing-reference',
  'timing-outside-tfsm.json': 'timing-outside-tfsm',
  'unknown-semantic-field.json': 'unknown-field',
  'wrong-schema-version.json': 'enum',
};

/**
 * Invalid fixtures the JSON Schema alone can catch. The remaining ones break
 * cross-reference rules that JSON Schema 2020-12 cannot express; for those
 * only the runtime validator (which is strictly stronger) rejects.
 */
const SCHEMA_DETECTABLE = new Set([
  'missing-time-unit.json',
  'moore-transition-output.json',
  'probability-field.json',
  'timing-outside-tfsm.json',
  'unknown-semantic-field.json',
  'wrong-schema-version.json',
]);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as object)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('fixture inventory', () => {
  it('has all required example models', () => {
    expect(validNames).toContain('mealy-turnstile.json');
    expect(validNames).toContain('mealy-partial-nondet.json');
    expect(validNames).toContain('efsm-login-retry.json');
    expect(validNames).toContain('tfsm-password-timeout.json');
    expect(validNames).toContain('tfsm-lamp-output-delay.json');
    expect(validNames).toContain('tfsm-timeout-and-linear-delay.json');
    expect(validNames).toContain('tfsm-alur-dill-two-clocks.json');
    expect(invalidNames).toEqual(Object.keys(EXPECTED_CODES).sort());
  });
});

describe('valid fixtures', () => {
  for (const name of validNames) {
    it(`${name} passes the TypeScript validator`, () => {
      const result = validateModel(loadJson(join(validDir, name)));
      expect(formatDiagnostics(result.diagnostics)).toBe('');
      expect(result.ok).toBe(true);
    });

    it(`${name} passes the JSON Schema`, () => {
      const document = loadJson(join(validDir, name));
      const valid = schemaValidate(document);
      expect(ajv.errorsText(schemaValidate.errors)).toBe('No errors');
      expect(valid).toBe(true);
    });
  }
});

describe('invalid fixtures', () => {
  for (const name of invalidNames) {
    it(`${name} fails the TypeScript validator with ${EXPECTED_CODES[name]}`, () => {
      const result = validateModel(loadJson(join(invalidDir, name)));
      expect(result.ok).toBe(false);
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes).toContain(EXPECTED_CODES[name]);
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.message.length).toBeGreaterThan(0);
        expect(diagnostic.path === '' || diagnostic.path.startsWith('/')).toBe(true);
      }
    });

    it(`${name} agrees with the JSON Schema`, () => {
      const document = loadJson(join(invalidDir, name));
      const schemaRejects = !schemaValidate(document);
      expect(schemaRejects).toBe(SCHEMA_DETECTABLE.has(name));
    });
  }
});

describe('validator behaviour', () => {
  it('is deterministic: same input, same diagnostics in the same order', () => {
    const document = loadJson(join(invalidDir, 'missing-reference.json'));
    const first = validateModel(document);
    const second = validateModel(document);
    expect(second.diagnostics).toEqual(first.diagnostics);
  });

  it('does not mutate its input', () => {
    const document = loadJson(join(validDir, 'efsm-login-retry.json'));
    const snapshot = JSON.stringify(document);
    const result = validateModel(deepFreeze(document));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  it('rejects non-object inputs with a root-pointer diagnostic', () => {
    const result = validateModel('not a model');
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ code: 'type', path: '' });
  });

  it('rejects NaN and non-finite numbers that cannot come from JSON', () => {
    const document = loadJson(join(validDir, 'tfsm-password-timeout.json')) as Record<string, unknown>;
    const states = document['states'] as { timeout?: { after: number } }[];
    const timeout = states[1].timeout;
    expect(timeout).toBeDefined();
    if (timeout) timeout.after = Number.NaN;
    const result = validateModel(document);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'invalid-number' && d.path === '/states/1/timeout/after')).toBe(true);
  });

  it('checks efsm initial values against declared variable types', () => {
    const document = loadJson(join(validDir, 'efsm-login-retry.json')) as Record<string, unknown>;
    const initial = document['initial'] as { variableValues: Record<string, unknown> };
    initial.variableValues['retries'] = 'zero';
    const result = validateModel(document);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'initial-configuration' && d.path === '/initial/variableValues/retries')).toBe(true);
  });

  it('reports JSON-pointer paths for nested errors', () => {
    const result = validateModel(loadJson(join(invalidDir, 'missing-reference.json')));
    expect(result.ok).toBe(false);
    const paths = result.diagnostics.map((d) => d.path);
    expect(paths).toContain('/transitions/0/to');
    expect(paths).toContain('/transitions/0/input');
  });

  it('exposes a type guard', () => {
    expect(isAutomataModel(loadJson(join(validDir, 'mealy-turnstile.json')))).toBe(true);
    expect(isAutomataModel({})).toBe(false);
  });
});
