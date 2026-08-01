/**
 * Canonical Model IR v1 for Automata Studio.
 *
 * Discriminated TypeScript types mirroring schema/automata-model-v1.schema.json
 * plus a runtime validator with JSON-pointer diagnostics.
 *
 * The validator is strictly stronger than the JSON Schema: it enforces every
 * structural rule of the schema plus cross-reference rules (unique IDs,
 * declared references, initial-configuration consistency) that JSON Schema
 * 2020-12 cannot express. Validation never mutates its input and is
 * deterministic: the same input always yields the same diagnostics in the
 * same order.
 */

// ---------------------------------------------------------------------------
// Shared envelope types
// ---------------------------------------------------------------------------

export type SchemaVersion = '1.0';

export type ModelKind = 'mealy' | 'moore' | 'efsm' | 'tfsm';

export type SemanticProfile =
  | 'deterministic.complete'
  | 'deterministic.partial'
  | 'nondeterministic.complete'
  | 'nondeterministic.partial';

export type DataType = 'bool' | 'int' | 'real' | 'string';

export type TimeUnit = 'ns' | 'us' | 'ms' | 's' | 'min' | 'h' | 'ticks';

export type Provenance = {
  createdBy: string;
  createdByVersion?: string;
  sourceFormat: string;
  seed?: number | string;
  timestamp: string;
};

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Namespaced extension bag; every key must start with `x-`. */
export type Extensions = Record<string, JsonValue>;

/** Non-semantic presentation metadata (graph coordinates etc.). */
export type Presentation = {
  positions?: Record<string, { x: number; y: number }>;
};

export type SymbolParam = {
  name: string;
  type: DataType;
};

export type AlphabetSymbol = {
  id: string;
  description?: string;
};

export type ParamAlphabetSymbol = AlphabetSymbol & {
  params?: SymbolParam[];
};

export type Alphabet = { symbols: AlphabetSymbol[] };
export type ParamAlphabet = { symbols: ParamAlphabetSymbol[] };

export type PlainState = {
  id: string;
  name?: string;
  description?: string;
};

export type InitialConfiguration = {
  stateId: string;
};

type ModelEnvelope<Kind extends ModelKind> = {
  schemaVersion: SchemaVersion;
  id: string;
  name: string;
  description?: string;
  modelKind: Kind;
  semanticProfile: SemanticProfile;
  provenance: Provenance;
  extensions?: Extensions;
  presentation?: Presentation;
};

// ---------------------------------------------------------------------------
// Mealy / Moore
// ---------------------------------------------------------------------------

export type MealyTransition = {
  id: string;
  from: string;
  to: string;
  input: string;
  output: string;
};

export type MealyModel = ModelEnvelope<'mealy'> & {
  inputAlphabet: Alphabet;
  outputAlphabet: Alphabet;
  states: PlainState[];
  transitions: MealyTransition[];
  initial: InitialConfiguration;
};

export type MooreState = PlainState & { output: string };

export type MooreTransition = {
  id: string;
  from: string;
  to: string;
  input: string;
};

export type MooreModel = ModelEnvelope<'moore'> & {
  inputAlphabet: Alphabet;
  outputAlphabet: Alphabet;
  states: MooreState[];
  transitions: MooreTransition[];
  initial: InitialConfiguration;
};

// ---------------------------------------------------------------------------
// EFSM
// ---------------------------------------------------------------------------

/** Language-tagged expression; v1 stores text only, no evaluator. */
export type Expression = {
  language: string;
  text: string;
};

export type VariableDeclaration = {
  name: string;
  type: DataType;
  description?: string;
};

export type Update = Expression & { target: string };

export type EfsmTransition = {
  id: string;
  from: string;
  to: string;
  input: string;
  output?: string;
  guard?: Expression;
  updates?: Update[];
};

export type EfsmInitialConfiguration = InitialConfiguration & {
  variableValues: Record<string, boolean | number | string>;
};

export type EfsmModel = ModelEnvelope<'efsm'> & {
  inputAlphabet: ParamAlphabet;
  outputAlphabet: ParamAlphabet;
  variables: VariableDeclaration[];
  states: PlainState[];
  transitions: EfsmTransition[];
  initial: EfsmInitialConfiguration;
};

// ---------------------------------------------------------------------------
// TFSM
// ---------------------------------------------------------------------------

export type TimingProfile =
  | 'timedGuards'
  | 'timeouts'
  | 'outputDelays'
  | 'timeoutsAndOutputDelays'
  | 'alurDill';

export type FiniteEndpoint = { value: number; inclusive: boolean };
export type InfiniteEndpoint = { unbounded: true };
export type UpperEndpoint = FiniteEndpoint | InfiniteEndpoint;

export type TimeInterval = {
  lower: FiniteEndpoint;
  upper: UpperEndpoint;
};

export type OutputDelay =
  | { kind: 'constant'; value: number }
  | { kind: 'interval'; interval: TimeInterval }
  | { kind: 'linearFamily'; base: number; slope: number };

export type Timeout = {
  after: number;
  to: string;
};

export type TfsmState = PlainState & { timeout?: Timeout };

export type TfsmTransition = {
  id: string;
  from: string;
  to: string;
  input: string;
  output: string;
  timedGuard?: TimeInterval;
  outputDelay?: OutputDelay;
};

export type ClockDeclaration = {
  name: string;
  description?: string;
};

export type ClockConstraintOp = '<' | '<=' | '==' | '>=' | '>';

export type ClockConstraint = {
  clock: string;
  op: ClockConstraintOp;
  value: number;
};

export type AlurDillLocation = PlainState & { invariant?: ClockConstraint[] };

export type AlurDillTransition = {
  id: string;
  from: string;
  to: string;
  input: string;
  guard?: ClockConstraint[];
  resets: string[];
};

export type TfsmModel = ModelEnvelope<'tfsm'> & {
  timingProfile: TimingProfile;
  timeUnit: TimeUnit;
  inputAlphabet: Alphabet;
  outputAlphabet: Alphabet;
  clocks?: ClockDeclaration[];
  states: (TfsmState | AlurDillLocation)[];
  transitions: (TfsmTransition | AlurDillTransition)[];
  initial: InitialConfiguration;
};

export type AutomataModel = MealyModel | MooreModel | EfsmModel | TfsmModel;

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticCode =
  | 'type'
  | 'required'
  | 'unknown-field'
  | 'enum'
  | 'pattern'
  | 'duplicate-id'
  | 'missing-reference'
  | 'initial-configuration'
  | 'probability-forbidden'
  | 'timing-outside-tfsm'
  | 'output-conflict'
  | 'interval-bounds'
  | 'invalid-number'
  | 'timing-profile';

export type ValidationDiagnostic = {
  code: DiagnosticCode;
  /** JSON pointer (RFC 6901) into the validated document. */
  path: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; model: AutomataModel; diagnostics: [] }
  | { ok: false; model?: undefined; diagnostics: ValidationDiagnostic[] };

// ---------------------------------------------------------------------------
// Validator implementation
// ---------------------------------------------------------------------------

const SEMANTIC_PROFILES: readonly SemanticProfile[] = [
  'deterministic.complete',
  'deterministic.partial',
  'nondeterministic.complete',
  'nondeterministic.partial',
];

const MODEL_KINDS: readonly ModelKind[] = ['mealy', 'moore', 'efsm', 'tfsm'];
const DATA_TYPES: readonly DataType[] = ['bool', 'int', 'real', 'string'];
const TIME_UNITS: readonly TimeUnit[] = ['ns', 'us', 'ms', 's', 'min', 'h', 'ticks'];
const TIMING_PROFILES: readonly TimingProfile[] = [
  'timedGuards',
  'timeouts',
  'outputDelays',
  'timeoutsAndOutputDelays',
  'alurDill',
];
const CLOCK_OPS: readonly ClockConstraintOp[] = ['<', '<=', '==', '>=', '>'];

const IDENTIFIER = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u;
const EXTENSION_KEY = /^x-[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Field names that would smuggle probabilistic semantics into v1. */
const PROBABILITY_FIELDS = new Set(['probability', 'prob', 'weight', 'rate']);

/** Timing-related field names that are only legal inside tfsm models. */
const TIMING_FIELDS = new Set(['timedGuard', 'outputDelay', 'timeout', 'timeUnit', 'timingProfile', 'clocks', 'invariant', 'resets']);

function escapePointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointer(...segments: (string | number)[]): string {
  if (segments.length === 0) return '';
  return '/' + segments.map(escapePointerSegment).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Context {
  readonly diagnostics: ValidationDiagnostic[] = [];

  report(code: DiagnosticCode, path: string, message: string): void {
    this.diagnostics.push({ code, path, message });
  }

  requireString(parent: Record<string, unknown>, key: string, path: string, options?: { optional?: boolean; identifier?: boolean; nonEmpty?: boolean }): string | undefined {
    const value = parent[key];
    if (value === undefined) {
      if (!options?.optional) this.report('required', path, `Missing required field "${key}".`);
      return undefined;
    }
    if (typeof value !== 'string') {
      this.report('type', `${path}/${escapePointerSegment(key)}`, `Field "${key}" must be a string.`);
      return undefined;
    }
    if (options?.identifier && !IDENTIFIER.test(value)) {
      this.report('pattern', `${path}/${escapePointerSegment(key)}`, `"${value}" is not a valid identifier (letters, digits, "_", ".", "-", must not start with "." or "-").`);
      return undefined;
    }
    if (options?.nonEmpty && value.length === 0) {
      this.report('pattern', `${path}/${escapePointerSegment(key)}`, `Field "${key}" must not be empty.`);
      return undefined;
    }
    return value;
  }

  requireNumber(parent: Record<string, unknown>, key: string, path: string, options?: { optional?: boolean; min?: number; exclusiveMin?: number }): number | undefined {
    const value = parent[key];
    if (value === undefined) {
      if (!options?.optional) this.report('required', path, `Missing required field "${key}".`);
      return undefined;
    }
    const fieldPath = `${path}/${escapePointerSegment(key)}`;
    if (typeof value !== 'number') {
      this.report('type', fieldPath, `Field "${key}" must be a number.`);
      return undefined;
    }
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      this.report('invalid-number', fieldPath, `Field "${key}" must be a finite number, got ${String(value)}.`);
      return undefined;
    }
    if (options?.min !== undefined && value < options.min) {
      this.report('invalid-number', fieldPath, `Field "${key}" must be >= ${options.min}, got ${value}.`);
      return undefined;
    }
    if (options?.exclusiveMin !== undefined && value <= options.exclusiveMin) {
      this.report('invalid-number', fieldPath, `Field "${key}" must be > ${options.exclusiveMin}, got ${value}.`);
      return undefined;
    }
    return value;
  }

  checkKeys(record: Record<string, unknown>, path: string, allowed: readonly string[], context: string): void {
    for (const key of Object.keys(record)) {
      if (allowed.includes(key)) continue;
      const keyPath = `${path}/${escapePointerSegment(key)}`;
      if (PROBABILITY_FIELDS.has(key)) {
        this.report('probability-forbidden', keyPath, `Probability field "${key}" is forbidden in Model IR v1 (${context}).`);
      } else if (TIMING_FIELDS.has(key)) {
        this.report('timing-outside-tfsm', keyPath, `Timing field "${key}" is only allowed in tfsm models with a matching timing profile (${context}).`);
      } else {
        this.report('unknown-field', keyPath, `Unknown field "${key}" in ${context}. Unknown semantic fields are rejected; use the "extensions" namespace instead.`);
      }
    }
  }

  requireArray(parent: Record<string, unknown>, key: string, path: string, options?: { optional?: boolean; minItems?: number }): unknown[] | undefined {
    const value = parent[key];
    if (value === undefined) {
      if (!options?.optional) this.report('required', path, `Missing required field "${key}".`);
      return undefined;
    }
    const fieldPath = `${path}/${escapePointerSegment(key)}`;
    if (!Array.isArray(value)) {
      this.report('type', fieldPath, `Field "${key}" must be an array.`);
      return undefined;
    }
    if (options?.minItems !== undefined && value.length < options.minItems) {
      this.report('type', fieldPath, `Field "${key}" must have at least ${options.minItems} item(s).`);
      return undefined;
    }
    return value;
  }

  requireObject(parent: Record<string, unknown>, key: string, path: string, options?: { optional?: boolean }): Record<string, unknown> | undefined {
    const value = parent[key];
    if (value === undefined) {
      if (!options?.optional) this.report('required', path, `Missing required field "${key}".`);
      return undefined;
    }
    const fieldPath = `${path}/${escapePointerSegment(key)}`;
    if (!isRecord(value)) {
      this.report('type', fieldPath, `Field "${key}" must be an object.`);
      return undefined;
    }
    return value;
  }

  requireEnum<T extends string>(parent: Record<string, unknown>, key: string, path: string, values: readonly T[]): T | undefined {
    const value = this.requireString(parent, key, path);
    if (value === undefined) return undefined;
    if (!(values as readonly string[]).includes(value)) {
      this.report('enum', `${path}/${escapePointerSegment(key)}`, `Field "${key}" must be one of: ${values.join(', ')}. Got "${value}".`);
      return undefined;
    }
    return value as T;
  }
}

// -- reusable fragment validators -------------------------------------------

function validateProvenance(ctx: Context, root: Record<string, unknown>): void {
  const provenance = ctx.requireObject(root, 'provenance', '');
  if (!provenance) return;
  const path = '/provenance';
  ctx.checkKeys(provenance, path, ['createdBy', 'createdByVersion', 'sourceFormat', 'seed', 'timestamp'], 'provenance');
  ctx.requireString(provenance, 'createdBy', path, { nonEmpty: true });
  ctx.requireString(provenance, 'createdByVersion', path, { optional: true, nonEmpty: true });
  ctx.requireString(provenance, 'sourceFormat', path, { nonEmpty: true });
  const seed = provenance['seed'];
  if (seed !== undefined && typeof seed !== 'string' && !(typeof seed === 'number' && Number.isInteger(seed))) {
    ctx.report('type', `${path}/seed`, 'Field "seed" must be an integer or a string.');
  }
  const timestamp = ctx.requireString(provenance, 'timestamp', path);
  if (timestamp !== undefined && !TIMESTAMP.test(timestamp)) {
    ctx.report('pattern', `${path}/timestamp`, `Field "timestamp" must be an RFC 3339 date-time, got "${timestamp}".`);
  }
}

function validateExtensions(ctx: Context, root: Record<string, unknown>): void {
  const extensions = ctx.requireObject(root, 'extensions', '', { optional: true });
  if (!extensions) return;
  for (const key of Object.keys(extensions)) {
    if (!EXTENSION_KEY.test(key)) {
      ctx.report('pattern', `/extensions/${escapePointerSegment(key)}`, `Extension key "${key}" must start with "x-".`);
    }
  }
}

function validatePresentation(ctx: Context, root: Record<string, unknown>): void {
  const presentation = ctx.requireObject(root, 'presentation', '', { optional: true });
  if (!presentation) return;
  ctx.checkKeys(presentation, '/presentation', ['positions'], 'presentation');
  const positions = ctx.requireObject(presentation, 'positions', '/presentation', { optional: true });
  if (!positions) return;
  for (const [key, value] of Object.entries(positions)) {
    const path = `/presentation/positions/${escapePointerSegment(key)}`;
    if (!isRecord(value)) {
      ctx.report('type', path, 'Position must be an object with "x" and "y".');
      continue;
    }
    ctx.checkKeys(value, path, ['x', 'y'], 'position');
    ctx.requireNumber(value, 'x', path);
    ctx.requireNumber(value, 'y', path);
  }
}

function validateAlphabet(ctx: Context, root: Record<string, unknown>, key: 'inputAlphabet' | 'outputAlphabet', allowParams: boolean): Set<string> {
  const symbols = new Set<string>();
  const alphabet = ctx.requireObject(root, key, '');
  if (!alphabet) return symbols;
  const path = `/${key}`;
  ctx.checkKeys(alphabet, path, ['symbols'], key);
  const list = ctx.requireArray(alphabet, 'symbols', path);
  if (!list) return symbols;
  list.forEach((entry, index) => {
    const symbolPath = `${path}/symbols/${index}`;
    if (!isRecord(entry)) {
      ctx.report('type', symbolPath, 'Alphabet symbol must be an object.');
      return;
    }
    const allowed = allowParams ? ['id', 'description', 'params'] : ['id', 'description'];
    ctx.checkKeys(entry, symbolPath, allowed, `${key} symbol`);
    const id = ctx.requireString(entry, 'id', symbolPath, { identifier: true });
    if (id !== undefined) {
      if (symbols.has(id)) {
        ctx.report('duplicate-id', `${symbolPath}/id`, `Duplicate symbol "${id}" in ${key}.`);
      }
      symbols.add(id);
    }
    ctx.requireString(entry, 'description', symbolPath, { optional: true });
    if (allowParams) {
      const params = ctx.requireArray(entry, 'params', symbolPath, { optional: true });
      params?.forEach((param, paramIndex) => {
        const paramPath = `${symbolPath}/params/${paramIndex}`;
        if (!isRecord(param)) {
          ctx.report('type', paramPath, 'Symbol parameter must be an object.');
          return;
        }
        ctx.checkKeys(param, paramPath, ['name', 'type'], 'symbol parameter');
        ctx.requireString(param, 'name', paramPath, { identifier: true });
        ctx.requireEnum(param, 'type', paramPath, DATA_TYPES);
      });
    }
  });
  return symbols;
}

function validateTimeInterval(ctx: Context, interval: Record<string, unknown>, path: string): void {
  ctx.checkKeys(interval, path, ['lower', 'upper'], 'time interval');
  const lower = ctx.requireObject(interval, 'lower', path);
  const upper = ctx.requireObject(interval, 'upper', path);
  let lowerValue: number | undefined;
  let lowerInclusive = false;
  if (lower) {
    const lowerPath = `${path}/lower`;
    ctx.checkKeys(lower, lowerPath, ['value', 'inclusive'], 'interval lower endpoint');
    lowerValue = ctx.requireNumber(lower, 'value', lowerPath, { min: 0 });
    const inclusive = lower['inclusive'];
    if (typeof inclusive !== 'boolean') {
      ctx.report('type', `${lowerPath}/inclusive`, 'Field "inclusive" must be a boolean.');
    } else {
      lowerInclusive = inclusive;
    }
  }
  if (upper) {
    const upperPath = `${path}/upper`;
    if (upper['unbounded'] !== undefined) {
      ctx.checkKeys(upper, upperPath, ['unbounded'], 'interval upper endpoint');
      if (upper['unbounded'] !== true) {
        ctx.report('type', `${upperPath}/unbounded`, 'Field "unbounded" must be the literal true.');
      }
      return;
    }
    ctx.checkKeys(upper, upperPath, ['value', 'inclusive'], 'interval upper endpoint');
    const upperValue = ctx.requireNumber(upper, 'value', upperPath, { min: 0 });
    const upperInclusive = upper['inclusive'];
    if (typeof upperInclusive !== 'boolean') {
      ctx.report('type', `${upperPath}/inclusive`, 'Field "inclusive" must be a boolean.');
      return;
    }
    if (lowerValue !== undefined && upperValue !== undefined) {
      if (lowerValue > upperValue) {
        ctx.report('interval-bounds', path, `Interval lower bound ${lowerValue} exceeds upper bound ${upperValue}.`);
      } else if (lowerValue === upperValue && (!lowerInclusive || !upperInclusive)) {
        ctx.report('interval-bounds', path, `Interval [${lowerValue}, ${upperValue}] is empty because an endpoint is exclusive.`);
      }
    }
  }
}

function validateOutputDelay(ctx: Context, delay: Record<string, unknown>, path: string): void {
  const kind = ctx.requireEnum(delay, 'kind', path, ['constant', 'interval', 'linearFamily'] as const);
  if (kind === 'constant') {
    ctx.checkKeys(delay, path, ['kind', 'value'], 'output delay');
    ctx.requireNumber(delay, 'value', path, { min: 0 });
  } else if (kind === 'interval') {
    ctx.checkKeys(delay, path, ['kind', 'interval'], 'output delay');
    const interval = ctx.requireObject(delay, 'interval', path);
    if (interval) validateTimeInterval(ctx, interval, `${path}/interval`);
  } else if (kind === 'linearFamily') {
    ctx.checkKeys(delay, path, ['kind', 'base', 'slope'], 'output delay');
    ctx.requireNumber(delay, 'base', path, { min: 0 });
    ctx.requireNumber(delay, 'slope', path);
  }
}

function validateExpression(ctx: Context, expression: Record<string, unknown>, path: string, extraKeys: readonly string[] = []): void {
  ctx.checkKeys(expression, path, ['language', 'text', ...extraKeys], 'expression');
  ctx.requireString(expression, 'language', path, { nonEmpty: true });
  ctx.requireString(expression, 'text', path, { nonEmpty: true });
}

function validateClockConstraints(ctx: Context, list: unknown[], path: string, clocks: ReadonlySet<string>): void {
  list.forEach((entry, index) => {
    const constraintPath = `${path}/${index}`;
    if (!isRecord(entry)) {
      ctx.report('type', constraintPath, 'Clock constraint must be an object.');
      return;
    }
    ctx.checkKeys(entry, constraintPath, ['clock', 'op', 'value'], 'clock constraint');
    const clock = ctx.requireString(entry, 'clock', constraintPath, { identifier: true });
    if (clock !== undefined && !clocks.has(clock)) {
      ctx.report('missing-reference', `${constraintPath}/clock`, `Clock "${clock}" is not declared in "clocks".`);
    }
    ctx.requireEnum(entry, 'op', constraintPath, CLOCK_OPS);
    ctx.requireNumber(entry, 'value', constraintPath, { min: 0 });
  });
}

// -- state and transition validators per kind --------------------------------

type StateRules = {
  requireOutput: boolean;
  allowTimeout: boolean;
  allowInvariant: boolean;
};

function validateStates(ctx: Context, root: Record<string, unknown>, rules: StateRules, outputSymbols: ReadonlySet<string>, clocks: ReadonlySet<string>): { ids: Set<string>; timeoutTargets: { path: string; to: string }[] } {
  const ids = new Set<string>();
  const timeoutTargets: { path: string; to: string }[] = [];
  const list = ctx.requireArray(root, 'states', '', { minItems: 1 });
  if (!list) return { ids, timeoutTargets };
  const allowed = ['id', 'name', 'description'];
  if (rules.requireOutput) allowed.push('output');
  if (rules.allowTimeout) allowed.push('timeout');
  if (rules.allowInvariant) allowed.push('invariant');
  list.forEach((entry, index) => {
    const path = `/states/${index}`;
    if (!isRecord(entry)) {
      ctx.report('type', path, 'State must be an object.');
      return;
    }
    ctx.checkKeys(entry, path, allowed, 'state');
    const id = ctx.requireString(entry, 'id', path, { identifier: true });
    if (id !== undefined) {
      if (ids.has(id)) ctx.report('duplicate-id', `${path}/id`, `Duplicate state id "${id}".`);
      ids.add(id);
    }
    ctx.requireString(entry, 'name', path, { optional: true });
    ctx.requireString(entry, 'description', path, { optional: true });
    if (rules.requireOutput) {
      const output = ctx.requireString(entry, 'output', path, { identifier: true });
      if (output !== undefined && !outputSymbols.has(output)) {
        ctx.report('missing-reference', `${path}/output`, `State output "${output}" is not in the output alphabet.`);
      }
    }
    if (rules.allowTimeout) {
      const timeout = ctx.requireObject(entry, 'timeout', path, { optional: true });
      if (timeout) {
        const timeoutPath = `${path}/timeout`;
        ctx.checkKeys(timeout, timeoutPath, ['after', 'to'], 'timeout');
        ctx.requireNumber(timeout, 'after', timeoutPath, { exclusiveMin: 0 });
        const target = ctx.requireString(timeout, 'to', timeoutPath, { identifier: true });
        if (target !== undefined) timeoutTargets.push({ path: `${timeoutPath}/to`, to: target });
      }
    }
    if (rules.allowInvariant) {
      const invariant = ctx.requireArray(entry, 'invariant', path, { optional: true });
      if (invariant) validateClockConstraints(ctx, invariant, `${path}/invariant`, clocks);
    }
  });
  return { ids, timeoutTargets };
}

type TransitionRules = {
  output: 'required' | 'optional' | 'forbidden';
  allowTimedGuard: boolean;
  allowOutputDelay: boolean;
  allowEfsmFields: boolean;
  alurDill: boolean;
};

function validateTransitions(
  ctx: Context,
  root: Record<string, unknown>,
  rules: TransitionRules,
  stateIds: ReadonlySet<string>,
  inputSymbols: ReadonlySet<string>,
  outputSymbols: ReadonlySet<string>,
  variables: ReadonlySet<string>,
  clocks: ReadonlySet<string>,
): void {
  const list = ctx.requireArray(root, 'transitions', '');
  if (!list) return;
  const ids = new Set<string>();
  // "output" stays in the allowed key set even when forbidden so that the
  // specific output-conflict diagnostic fires instead of a generic
  // unknown-field one.
  const allowed = ['id', 'from', 'to', 'input', 'output'];
  if (rules.allowTimedGuard) allowed.push('timedGuard');
  if (rules.allowOutputDelay) allowed.push('outputDelay');
  if (rules.allowEfsmFields) allowed.push('guard', 'updates');
  if (rules.alurDill) allowed.push('guard', 'resets');
  list.forEach((entry, index) => {
    const path = `/transitions/${index}`;
    if (!isRecord(entry)) {
      ctx.report('type', path, 'Transition must be an object.');
      return;
    }
    ctx.checkKeys(entry, path, allowed, 'transition');
    const id = ctx.requireString(entry, 'id', path, { identifier: true });
    if (id !== undefined) {
      if (ids.has(id)) ctx.report('duplicate-id', `${path}/id`, `Duplicate transition id "${id}".`);
      ids.add(id);
    }
    for (const endpoint of ['from', 'to'] as const) {
      const state = ctx.requireString(entry, endpoint, path, { identifier: true });
      if (state !== undefined && !stateIds.has(state)) {
        ctx.report('missing-reference', `${path}/${endpoint}`, `Transition ${endpoint === 'from' ? 'source' : 'target'} state "${state}" is not declared.`);
      }
    }
    const input = ctx.requireString(entry, 'input', path, { identifier: true });
    if (input !== undefined && !inputSymbols.has(input)) {
      ctx.report('missing-reference', `${path}/input`, `Input symbol "${input}" is not in the input alphabet.`);
    }
    if (rules.output === 'forbidden') {
      if (entry['output'] !== undefined) {
        ctx.report('output-conflict', `${path}/output`, rules.alurDill
          ? 'Alur–Dill edges carry input labels only; outputs are not part of the v1 Alur–Dill profile.'
          : 'Moore transitions must not carry outputs; outputs belong to states.');
      }
    } else {
      const output = ctx.requireString(entry, 'output', path, { identifier: true, optional: rules.output === 'optional' });
      if (output !== undefined && !outputSymbols.has(output)) {
        ctx.report('missing-reference', `${path}/output`, `Output symbol "${output}" is not in the output alphabet.`);
      }
    }
    if (rules.allowTimedGuard) {
      const guard = ctx.requireObject(entry, 'timedGuard', path, { optional: true });
      if (guard) validateTimeInterval(ctx, guard, `${path}/timedGuard`);
    }
    if (rules.allowOutputDelay) {
      const delay = ctx.requireObject(entry, 'outputDelay', path, { optional: true });
      if (delay) validateOutputDelay(ctx, delay, `${path}/outputDelay`);
    }
    if (rules.allowEfsmFields) {
      const guard = ctx.requireObject(entry, 'guard', path, { optional: true });
      if (guard) validateExpression(ctx, guard, `${path}/guard`);
      const updates = ctx.requireArray(entry, 'updates', path, { optional: true });
      updates?.forEach((update, updateIndex) => {
        const updatePath = `${path}/updates/${updateIndex}`;
        if (!isRecord(update)) {
          ctx.report('type', updatePath, 'Update must be an object.');
          return;
        }
        validateExpression(ctx, update, updatePath, ['target']);
        const target = ctx.requireString(update, 'target', updatePath, { identifier: true });
        if (target !== undefined && !variables.has(target)) {
          ctx.report('missing-reference', `${updatePath}/target`, `Update target "${target}" is not a declared variable.`);
        }
      });
    }
    if (rules.alurDill) {
      const guard = ctx.requireArray(entry, 'guard', path, { optional: true });
      if (guard) validateClockConstraints(ctx, guard, `${path}/guard`, clocks);
      const resets = ctx.requireArray(entry, 'resets', path);
      resets?.forEach((reset, resetIndex) => {
        const resetPath = `${path}/resets/${resetIndex}`;
        if (typeof reset !== 'string') {
          ctx.report('type', resetPath, 'Clock reset must be a clock name string.');
        } else if (!clocks.has(reset)) {
          ctx.report('missing-reference', resetPath, `Reset clock "${reset}" is not declared in "clocks".`);
        }
      });
    }
  });
}

function validateInitial(ctx: Context, root: Record<string, unknown>, stateIds: ReadonlySet<string>, efsmVariables?: Map<string, DataType>): void {
  const initial = ctx.requireObject(root, 'initial', '');
  if (!initial) return;
  const path = '/initial';
  const allowed = efsmVariables ? ['stateId', 'variableValues'] : ['stateId'];
  ctx.checkKeys(initial, path, allowed, 'initial configuration');
  const stateId = ctx.requireString(initial, 'stateId', path, { identifier: true });
  if (stateId !== undefined && !stateIds.has(stateId)) {
    ctx.report('initial-configuration', `${path}/stateId`, `Initial state "${stateId}" is not declared.`);
  }
  if (!efsmVariables) return;
  const values = ctx.requireObject(initial, 'variableValues', path);
  if (!values) return;
  for (const [name, value] of Object.entries(values)) {
    const valuePath = `${path}/variableValues/${escapePointerSegment(name)}`;
    const declared = efsmVariables.get(name);
    if (declared === undefined) {
      ctx.report('missing-reference', valuePath, `Initial value for undeclared variable "${name}".`);
      continue;
    }
    const jsType = typeof value;
    const matches =
      (declared === 'bool' && jsType === 'boolean') ||
      (declared === 'int' && jsType === 'number' && Number.isInteger(value)) ||
      (declared === 'real' && jsType === 'number' && Number.isFinite(value as number)) ||
      (declared === 'string' && jsType === 'string');
    if (!matches) {
      ctx.report('initial-configuration', valuePath, `Initial value for "${name}" must match its declared type "${declared}".`);
    }
  }
  for (const name of efsmVariables.keys()) {
    if (!(name in values)) {
      ctx.report('initial-configuration', `${path}/variableValues`, `Variable "${name}" has no initial value.`);
    }
  }
}

// -- top-level ---------------------------------------------------------------

const COMMON_KEYS = ['schemaVersion', 'id', 'name', 'description', 'modelKind', 'semanticProfile', 'inputAlphabet', 'outputAlphabet', 'states', 'transitions', 'initial', 'provenance', 'extensions', 'presentation'];

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Validate an arbitrary JSON value against Model IR v1.
 * Never mutates `value`; deterministic diagnostic order.
 */
export function validateModel(value: unknown): ValidationResult {
  const ctx = new Context();
  if (!isRecord(value)) {
    ctx.report('type', '', 'Model must be a JSON object.');
    return { ok: false, diagnostics: ctx.diagnostics };
  }

  const root = value;
  const schemaVersion = root['schemaVersion'];
  if (schemaVersion !== '1.0') {
    ctx.report('enum', '/schemaVersion', `Field "schemaVersion" must be "1.0", got ${JSON.stringify(schemaVersion ?? null)}.`);
  }
  ctx.requireString(root, 'id', '', { identifier: true });
  ctx.requireString(root, 'name', '', { nonEmpty: true });
  ctx.requireString(root, 'description', '', { optional: true });
  const modelKind = ctx.requireEnum(root, 'modelKind', '', MODEL_KINDS);
  ctx.requireEnum(root, 'semanticProfile', '', SEMANTIC_PROFILES);
  validateProvenance(ctx, root);
  validateExtensions(ctx, root);
  validatePresentation(ctx, root);

  if (modelKind === 'mealy' || modelKind === 'moore') {
    ctx.checkKeys(root, '', COMMON_KEYS, `${modelKind} model`);
    const inputs = validateAlphabet(ctx, root, 'inputAlphabet', false);
    const outputs = validateAlphabet(ctx, root, 'outputAlphabet', false);
    const isMoore = modelKind === 'moore';
    const { ids } = validateStates(ctx, root, { requireOutput: isMoore, allowTimeout: false, allowInvariant: false }, outputs, EMPTY_SET);
    validateTransitions(ctx, root, { output: isMoore ? 'forbidden' : 'required', allowTimedGuard: false, allowOutputDelay: false, allowEfsmFields: false, alurDill: false }, ids, inputs, outputs, EMPTY_SET, EMPTY_SET);
    validateInitial(ctx, root, ids);
  } else if (modelKind === 'efsm') {
    ctx.checkKeys(root, '', [...COMMON_KEYS, 'variables'], 'efsm model');
    const inputs = validateAlphabet(ctx, root, 'inputAlphabet', true);
    const outputs = validateAlphabet(ctx, root, 'outputAlphabet', true);
    const variableTypes = new Map<string, DataType>();
    const variables = ctx.requireArray(root, 'variables', '');
    variables?.forEach((entry, index) => {
      const path = `/variables/${index}`;
      if (!isRecord(entry)) {
        ctx.report('type', path, 'Variable declaration must be an object.');
        return;
      }
      ctx.checkKeys(entry, path, ['name', 'type', 'description'], 'variable declaration');
      const name = ctx.requireString(entry, 'name', path, { identifier: true });
      const type = ctx.requireEnum(entry, 'type', path, DATA_TYPES);
      ctx.requireString(entry, 'description', path, { optional: true });
      if (name !== undefined) {
        if (variableTypes.has(name)) ctx.report('duplicate-id', `${path}/name`, `Duplicate variable "${name}".`);
        if (type !== undefined) variableTypes.set(name, type);
      }
    });
    const { ids } = validateStates(ctx, root, { requireOutput: false, allowTimeout: false, allowInvariant: false }, outputs, EMPTY_SET);
    validateTransitions(ctx, root, { output: 'optional', allowTimedGuard: false, allowOutputDelay: false, allowEfsmFields: true, alurDill: false }, ids, inputs, outputs, new Set(variableTypes.keys()), EMPTY_SET);
    validateInitial(ctx, root, ids, variableTypes);
  } else if (modelKind === 'tfsm') {
    ctx.checkKeys(root, '', [...COMMON_KEYS, 'timingProfile', 'timeUnit', 'clocks'], 'tfsm model');
    const profile = ctx.requireEnum(root, 'timingProfile', '', TIMING_PROFILES);
    ctx.requireEnum(root, 'timeUnit', '', TIME_UNITS);
    const inputs = validateAlphabet(ctx, root, 'inputAlphabet', false);
    const outputs = validateAlphabet(ctx, root, 'outputAlphabet', false);

    const clockNames = new Set<string>();
    const clockList = root['clocks'];
    if (profile === 'alurDill') {
      const clocks = ctx.requireArray(root, 'clocks', '', { minItems: 1 });
      clocks?.forEach((entry, index) => {
        const path = `/clocks/${index}`;
        if (!isRecord(entry)) {
          ctx.report('type', path, 'Clock declaration must be an object.');
          return;
        }
        ctx.checkKeys(entry, path, ['name', 'description'], 'clock declaration');
        const name = ctx.requireString(entry, 'name', path, { identifier: true });
        ctx.requireString(entry, 'description', path, { optional: true });
        if (name !== undefined) {
          if (clockNames.has(name)) ctx.report('duplicate-id', `${path}/name`, `Duplicate clock "${name}".`);
          clockNames.add(name);
        }
      });
    } else if (clockList !== undefined && profile !== undefined) {
      ctx.report('timing-profile', '/clocks', `Field "clocks" is only allowed with the "alurDill" timing profile, not "${profile}".`);
    }

    if (profile !== undefined) {
      const allowTimeout = profile === 'timeouts' || profile === 'timeoutsAndOutputDelays';
      const alurDill = profile === 'alurDill';
      const { ids, timeoutTargets } = validateStates(ctx, root, { requireOutput: false, allowTimeout, allowInvariant: alurDill }, outputs, clockNames);
      for (const target of timeoutTargets) {
        if (!ids.has(target.to)) {
          ctx.report('missing-reference', target.path, `Timeout target state "${target.to}" is not declared.`);
        }
      }
      validateTransitions(
        ctx,
        root,
        {
          output: alurDill ? 'forbidden' : 'required',
          allowTimedGuard: profile === 'timedGuards',
          allowOutputDelay: profile === 'outputDelays' || profile === 'timeoutsAndOutputDelays',
          allowEfsmFields: false,
          alurDill,
        },
        ids,
        inputs,
        outputs,
        EMPTY_SET,
        clockNames,
      );
      validateInitial(ctx, root, ids);
    }
  }

  if (ctx.diagnostics.length > 0) {
    return { ok: false, diagnostics: ctx.diagnostics };
  }
  return { ok: true, model: value as unknown as AutomataModel, diagnostics: [] };
}

/** Type guard built on validateModel. */
export function isAutomataModel(value: unknown): value is AutomataModel {
  return validateModel(value).ok;
}

/** Render diagnostics as stable, human-readable lines. */
export function formatDiagnostics(diagnostics: readonly ValidationDiagnostic[]): string {
  return diagnostics.map((d) => `${d.path || '/'} [${d.code}] ${d.message}`).join('\n');
}
