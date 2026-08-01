import type { Machine, TransitionCoverResult } from './fsm';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type TestVerdict = 'pass' | 'fail' | 'timeout' | 'inconclusive' | 'invalid';
export type OutputSymbol = string | null;

export type TestStep = {
  input: string;
  allowedExpectedOutputs: OutputSymbol[];
  timeoutMs: number;
  metadata?: JsonObject;
};

export type TestCase = {
  id: string;
  name: string;
  metadata: JsonObject;
  steps: TestStep[];
};

export type TestPlan = {
  schemaVersion: '1.0';
  id: string;
  name: string;
  modelId: string;
  metadata: JsonObject;
  cases: TestCase[];
};

export type AdapterResponse = {
  output: OutputSymbol;
  /** Unix time in milliseconds at which the response was observed. */
  timestamp: number;
  durationMs: number;
  metadata?: JsonObject;
};

export interface SutAdapter {
  reset(signal?: AbortSignal): Promise<void>;
  send(input: string, signal?: AbortSignal): Promise<AdapterResponse>;
  close(): Promise<void>;
}

export type TestStepTrace = {
  index: number;
  input: string;
  allowedExpectedOutputs: OutputSymbol[];
  startedAt: number;
  finishedAt: number;
  verdict: TestVerdict;
  response?: AdapterResponse;
  message?: string;
};

export type TestCaseResult = {
  caseId: string;
  name: string;
  verdict: TestVerdict;
  startedAt: number;
  finishedAt: number;
  steps: TestStepTrace[];
  message?: string;
};

export type VerdictCounts = Record<TestVerdict, number>;

export type TestRunResult = {
  planId: string;
  startedAt: number;
  finishedAt: number;
  verdict: TestVerdict;
  cancelled: boolean;
  cases: TestCaseResult[];
  counts: VerdictCounts;
  closeError?: string;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type TestPlanParseResult =
  | { ok: true; value: TestPlan }
  | { ok: false; issues: ValidationIssue[] };

const verdictPriority: Record<TestVerdict, number> = {
  pass: 0,
  inconclusive: 1,
  fail: 2,
  timeout: 3,
  invalid: 4,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function requireString(
  object: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[],
): string | undefined {
  const value = object[key];
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ path: `${path}.${key}`, message: 'Expected a non-empty string.' });
    return undefined;
  }
  return value;
}

function validateMetadata(value: unknown, path: string, issues: ValidationIssue[]): value is JsonObject {
  if (!isObject(value) || !isJsonValue(value)) {
    issues.push({ path, message: 'Expected an object containing JSON values.' });
    return false;
  }
  return true;
}

export function validateTestPlan(value: unknown): TestPlanParseResult {
  const issues: ValidationIssue[] = [];
  if (!isObject(value)) return { ok: false, issues: [{ path: '$', message: 'Expected an object.' }] };

  if (value.schemaVersion !== '1.0') {
    issues.push({ path: '$.schemaVersion', message: 'Only schemaVersion "1.0" is supported.' });
  }
  requireString(value, 'id', '$', issues);
  requireString(value, 'name', '$', issues);
  requireString(value, 'modelId', '$', issues);
  validateMetadata(value.metadata, '$.metadata', issues);

  if (!Array.isArray(value.cases)) {
    issues.push({ path: '$.cases', message: 'Expected an array.' });
  } else {
    const caseIds = new Set<string>();
    value.cases.forEach((candidate, caseIndex) => {
      const path = `$.cases[${caseIndex}]`;
      if (!isObject(candidate)) {
        issues.push({ path, message: 'Expected an object.' });
        return;
      }
      const id = requireString(candidate, 'id', path, issues);
      requireString(candidate, 'name', path, issues);
      if (id && caseIds.has(id)) issues.push({ path: `${path}.id`, message: 'Case id must be unique.' });
      if (id) caseIds.add(id);
      validateMetadata(candidate.metadata, `${path}.metadata`, issues);
      if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) {
        issues.push({ path: `${path}.steps`, message: 'Expected a non-empty array.' });
        return;
      }
      candidate.steps.forEach((step, stepIndex) => {
        const stepPath = `${path}.steps[${stepIndex}]`;
        if (!isObject(step)) {
          issues.push({ path: stepPath, message: 'Expected an object.' });
          return;
        }
        requireString(step, 'input', stepPath, issues);
        if (!Array.isArray(step.allowedExpectedOutputs) || step.allowedExpectedOutputs.length === 0 ||
          !step.allowedExpectedOutputs.every((output) => output === null || typeof output === 'string')) {
          issues.push({ path: `${stepPath}.allowedExpectedOutputs`, message: 'Expected a non-empty array of strings or null.' });
        }
        if (!Number.isSafeInteger(step.timeoutMs) || (step.timeoutMs as number) <= 0) {
          issues.push({ path: `${stepPath}.timeoutMs`, message: 'Expected a positive safe integer.' });
        }
        if (step.metadata !== undefined) validateMetadata(step.metadata, `${stepPath}.metadata`, issues);
      });
    });
  }

  return issues.length === 0 ? { ok: true, value: value as TestPlan } : { ok: false, issues };
}

export function parseTestPlan(source: string): TestPlanParseResult {
  try {
    return validateTestPlan(JSON.parse(source) as unknown);
  } catch (error) {
    return { ok: false, issues: [{ path: '$', message: `Invalid JSON: ${errorMessage(error)}` }] };
  }
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortJson(value[key]);
    return sorted;
  }
  return value;
}

export function serializeTestPlan(plan: TestPlan, space = 2): string {
  const validation = validateTestPlan(plan);
  if (!validation.ok) throw new TypeError(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
  return JSON.stringify(sortJson(plan), null, space);
}

function aggregateVerdict(verdicts: TestVerdict[]): TestVerdict {
  if (verdicts.length === 0) return 'inconclusive';
  return verdicts.reduce((worst, verdict) =>
    verdictPriority[verdict] > verdictPriority[worst] ? verdict : worst, 'pass');
}

function emptyCounts(): VerdictCounts {
  return { pass: 0, fail: 0, timeout: 0, inconclusive: 0, invalid: 0 };
}

type SettledSend =
  | { kind: 'response'; response: AdapterResponse }
  | { kind: 'timeout' }
  | { kind: 'cancelled' }
  | { kind: 'error'; error: unknown };

async function sendWithDeadline(
  adapter: SutAdapter, input: string, timeoutMs: number, externalSignal?: AbortSignal,
): Promise<SettledSend> {
  if (externalSignal?.aborted) return { kind: 'cancelled' };
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;

  const deadline = new Promise<SettledSend>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort(new DOMException('Step timed out.', 'TimeoutError'));
      resolve({ kind: 'timeout' });
    }, timeoutMs);
    if (externalSignal) {
      abortHandler = () => {
        controller.abort(externalSignal.reason);
        resolve({ kind: 'cancelled' });
      };
      externalSignal.addEventListener('abort', abortHandler, { once: true });
    }
  });
  const sending = adapter.send(input, controller.signal).then<SettledSend, SettledSend>(
    (response) => ({ kind: 'response', response }),
    (error: unknown) => controller.signal.aborted
      ? (externalSignal?.aborted ? { kind: 'cancelled' } : { kind: 'timeout' })
      : { kind: 'error', error },
  );
  const result = await Promise.race([sending, deadline]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  if (externalSignal && abortHandler) externalSignal.removeEventListener('abort', abortHandler);
  return result;
}

function cancelledCase(testCase: TestCase, now: number): TestCaseResult {
  return {
    caseId: testCase.id,
    name: testCase.name,
    verdict: 'inconclusive',
    startedAt: now,
    finishedAt: now,
    steps: [],
    message: 'Run cancelled before this case started.',
  };
}

export async function runTestPlan(
  plan: TestPlan,
  adapter: SutAdapter,
  options: { signal?: AbortSignal; now?: () => number } = {},
): Promise<TestRunResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const cases: TestCaseResult[] = [];
  const validation = validateTestPlan(plan);
  if (!validation.ok) {
    const message = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');
    try { await adapter.close(); } catch { /* Reported only for executable plans. */ }
    return {
      planId: isObject(plan) && typeof plan.id === 'string' ? plan.id : '',
      startedAt,
      finishedAt: now(),
      verdict: 'invalid',
      cancelled: false,
      cases: [{ caseId: '', name: 'Invalid test plan', verdict: 'invalid', startedAt, finishedAt: now(), steps: [], message }],
      counts: { pass: 0, fail: 0, timeout: 0, inconclusive: 0, invalid: 1 },
    };
  }

  let closeError: string | undefined;
  try {
    for (const testCase of plan.cases) {
      if (options.signal?.aborted) {
        cases.push(cancelledCase(testCase, now()));
        continue;
      }
      const caseStartedAt = now();
      const traces: TestStepTrace[] = [];
      let verdict: TestVerdict = 'pass';
      let message: string | undefined;
      try {
        await adapter.reset(options.signal);
      } catch (error) {
        verdict = options.signal?.aborted ? 'inconclusive' : 'invalid';
        message = options.signal?.aborted ? 'Run cancelled during adapter reset.' : `Adapter reset failed: ${errorMessage(error)}`;
      }

      if (verdict === 'pass') {
        for (let index = 0; index < testCase.steps.length; index += 1) {
          const step = testCase.steps[index];
          const stepStartedAt = now();
          const settled = await sendWithDeadline(adapter, step.input, step.timeoutMs, options.signal);
          const finishedAt = now();
          if (settled.kind === 'response') {
            const matches = step.allowedExpectedOutputs.includes(settled.response.output);
            traces.push({
              index,
              input: step.input,
              allowedExpectedOutputs: [...step.allowedExpectedOutputs],
              startedAt: stepStartedAt,
              finishedAt,
              response: settled.response,
              verdict: matches ? 'pass' : 'fail',
              ...(!matches && { message: `Unexpected output ${JSON.stringify(settled.response.output)}.` }),
            });
            if (!matches) { verdict = 'fail'; message = `Step ${index} output mismatch.`; break; }
          } else {
            verdict = settled.kind === 'timeout' ? 'timeout' : settled.kind === 'cancelled' ? 'inconclusive' : 'invalid';
            message = settled.kind === 'timeout' ? `Step ${index} timed out after ${step.timeoutMs} ms.`
              : settled.kind === 'cancelled' ? `Run cancelled during step ${index}.`
                : `Adapter send failed at step ${index}: ${errorMessage(settled.error)}`;
            traces.push({ index, input: step.input, allowedExpectedOutputs: [...step.allowedExpectedOutputs],
              startedAt: stepStartedAt, finishedAt, verdict, message });
            break;
          }
        }
      }
      cases.push({ caseId: testCase.id, name: testCase.name, verdict, startedAt: caseStartedAt,
        finishedAt: now(), steps: traces, ...(message && { message }) });
    }
  } finally {
    try { await adapter.close(); } catch (error) { closeError = errorMessage(error); }
  }

  const counts = emptyCounts();
  for (const result of cases) counts[result.verdict] += 1;
  const verdict = aggregateVerdict(cases.map((result) => result.verdict));
  return { planId: plan.id, startedAt, finishedAt: now(), verdict, cancelled: options.signal?.aborted ?? false,
    cases, counts, ...(closeError && { closeError }) };
}

export class InMemoryFsmAdapter implements SutAdapter {
  private currentState: string;
  private closed = false;

  constructor(private readonly machine: Machine) {
    if (!machine.states.some((state) => state.id === machine.initialState)) {
      throw new TypeError(`Initial state ${JSON.stringify(machine.initialState)} does not exist.`);
    }
    const keys = new Set<string>();
    for (const transition of machine.transitions) {
      const key = `${transition.from}\0${transition.input}`;
      if (keys.has(key)) throw new TypeError('InMemoryFsmAdapter requires a deterministic machine.');
      keys.add(key);
    }
    this.currentState = machine.initialState;
  }

  async reset(signal?: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('Adapter is closed.');
    signal?.throwIfAborted();
    this.currentState = this.machine.initialState;
  }

  async send(input: string, signal?: AbortSignal): Promise<AdapterResponse> {
    if (this.closed) throw new Error('Adapter is closed.');
    signal?.throwIfAborted();
    const startedAt = Date.now();
    const transition = this.machine.transitions.find((item) => item.from === this.currentState && item.input === input);
    if (!transition) throw new Error(`No transition from ${JSON.stringify(this.currentState)} for ${JSON.stringify(input)}.`);
    this.currentState = transition.to;
    return { output: transition.output ?? null, timestamp: Date.now(), durationMs: Date.now() - startedAt,
      metadata: { from: transition.from, to: transition.to, sourceLine: transition.sourceLine } };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export function transitionCoverToTestPlan(
  cover: TransitionCoverResult,
  options: { id: string; name: string; modelId: string; timeoutMs?: number; metadata?: JsonObject },
): TestPlan {
  const timeoutMs = options.timeoutMs ?? 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be a positive safe integer.');
  return {
    schemaVersion: '1.0',
    id: options.id,
    name: options.name,
    modelId: options.modelId,
    metadata: { ...(options.metadata ?? {}), generator: 'transition-cover', diagnosticCount: cover.diagnostics.length },
    cases: cover.tests.map((test, index) => ({
      id: `${options.id}-tc-${index + 1}`,
      name: `Cover transition ${test.targetTransition.index}`,
      metadata: { targetTransition: test.targetTransition.index, sourceLine: test.targetTransition.sourceLine,
        stateTrace: test.stateTrace },
      steps: test.inputTrace.map((input, stepIndex) => ({
        input,
        allowedExpectedOutputs: [test.outputTrace[stepIndex] ?? null],
        timeoutMs,
        metadata: { transitionIndex: test.coveredTransitions[stepIndex].index },
      })),
    })),
  };
}
