import type {
  OutputDelay,
  TfsmModel,
  TfsmState,
  TfsmTransition,
  TimeInterval,
} from './model-ir';

export type TimedVerdict = 'pass' | 'fail' | 'early' | 'late' | 'timeout' | 'invalid';

export type DelayWindow = {
  lower: number;
  lowerInclusive: boolean;
  upper: number | null;
  upperInclusive: boolean;
};

export type TimedInputAction = {
  kind: 'input';
  at: number;
  input: string;
  expectedAccepted: boolean;
  expectedTransitionId?: string;
  expectedOutput?: string;
  expectedDelay?: DelayWindow;
};

export type TimedWaitAction = {
  kind: 'wait';
  until: number;
  expectedState: string;
};

export type TimedAction = TimedInputAction | TimedWaitAction;

export type TimedTestCase = {
  id: string;
  name: string;
  target: 'transition' | 'guard-boundary' | 'output-delay' | 'timeout';
  actions: TimedAction[];
};

export type TimedObservation = {
  output: string | null;
  observedAt: number | null;
};

export type TimedOracleResult = {
  verdict: TimedVerdict;
  message: string;
  actualDelay: number | null;
};

export type SimulatorOutput = {
  symbol: string;
  emittedAt: number;
  delay: number;
};

export type SimulatorInputResult = {
  accepted: boolean;
  transitionId?: string;
  state: string;
  residenceTime: number;
  output?: SimulatorOutput;
};

export type TimeoutEvent = { at: number; from: string; to: string };

export type TimedStepTrace = {
  action: TimedAction;
  verdict: TimedVerdict;
  message: string;
  state: string;
  transitionId?: string;
  observation?: TimedObservation;
};

export type TimedCaseResult = {
  caseId: string;
  name: string;
  verdict: TimedVerdict;
  trace: TimedStepTrace[];
};

export type TimedCampaignResult = {
  modelId: string;
  timeUnit: string;
  verdict: TimedVerdict;
  counts: Record<TimedVerdict, number>;
  cases: TimedCaseResult[];
};

function isFiniteUpper(interval: TimeInterval): interval is TimeInterval & {
  upper: { value: number; inclusive: boolean };
} {
  return 'value' in interval.upper;
}

export function intervalContains(interval: TimeInterval, value: number): boolean {
  const aboveLower = value > interval.lower.value ||
    (value === interval.lower.value && interval.lower.inclusive);
  if (!aboveLower) return false;
  if (!isFiniteUpper(interval)) return true;
  return value < interval.upper.value ||
    (value === interval.upper.value && interval.upper.inclusive);
}

export function outputDelayWindow(delay: OutputDelay | undefined, residenceTime: number): DelayWindow {
  if (!delay) return { lower: 0, lowerInclusive: true, upper: 0, upperInclusive: true };
  if (delay.kind === 'constant') {
    return { lower: delay.value, lowerInclusive: true, upper: delay.value, upperInclusive: true };
  }
  if (delay.kind === 'linearFamily') {
    const value = delay.base + delay.slope * residenceTime;
    return { lower: value, lowerInclusive: true, upper: value, upperInclusive: true };
  }
  return {
    lower: delay.interval.lower.value,
    lowerInclusive: delay.interval.lower.inclusive,
    upper: isFiniteUpper(delay.interval) ? delay.interval.upper.value : null,
    upperInclusive: isFiniteUpper(delay.interval) ? delay.interval.upper.inclusive : false,
  };
}

function windowContains(window: DelayWindow, value: number, tolerance: number): boolean {
  const scale = Math.max(1, Math.abs(value), Math.abs(window.lower), Math.abs(window.upper ?? 0));
  const effectiveTolerance = Math.max(tolerance, Number.EPSILON * scale * 8);
  const lower = window.lower - effectiveTolerance;
  const upper = window.upper === null ? null : window.upper + effectiveTolerance;
  const aboveLower = value > lower || (window.lowerInclusive && value === lower);
  const belowUpper = upper === null || value < upper || (window.upperInclusive && value === upper);
  return aboveLower && belowUpper;
}

export function evaluateTimedObservation(
  action: TimedInputAction,
  observation: TimedObservation,
  tolerance = 0,
): TimedOracleResult {
  if (!action.expectedAccepted) {
    return { verdict: 'invalid', message: 'A rejected input must not be evaluated as an output observation.', actualDelay: null };
  }
  if (observation.output !== action.expectedOutput) {
    return {
      verdict: 'fail',
      message: `Expected output ${JSON.stringify(action.expectedOutput)}, received ${JSON.stringify(observation.output)}.`,
      actualDelay: observation.observedAt === null ? null : observation.observedAt - action.at,
    };
  }
  if (observation.observedAt === null) {
    return { verdict: 'timeout', message: 'Expected output was not observed.', actualDelay: null };
  }
  const actualDelay = observation.observedAt - action.at;
  const window = action.expectedDelay ?? { lower: 0, lowerInclusive: true, upper: 0, upperInclusive: true };
  if (windowContains(window, actualDelay, tolerance)) {
    return { verdict: 'pass', message: `Output observed after ${actualDelay}.`, actualDelay };
  }
  const scale = Math.max(1, Math.abs(actualDelay), Math.abs(window.lower), Math.abs(window.upper ?? 0));
  const effectiveTolerance = Math.max(tolerance, Number.EPSILON * scale * 8);
  if (actualDelay < window.lower - effectiveTolerance ||
    (actualDelay === window.lower - effectiveTolerance && !window.lowerInclusive)) {
    return { verdict: 'early', message: `Output arrived too early after ${actualDelay}.`, actualDelay };
  }
  return { verdict: 'late', message: `Output arrived too late after ${actualDelay}.`, actualDelay };
}

function tfsmStates(model: TfsmModel): TfsmState[] {
  return model.states as TfsmState[];
}

function tfsmTransitions(model: TfsmModel): TfsmTransition[] {
  return model.transitions as TfsmTransition[];
}

function nominalDelay(window: DelayWindow): number {
  if (window.upper === null) return window.lower + (window.lowerInclusive ? 0 : 1);
  if (window.lower === window.upper) return window.lower;
  return (window.lower + window.upper) / 2;
}

export class VirtualTfsmSimulator {
  private state: string;
  private stateEnteredAt = 0;
  private clock = 0;

  constructor(private readonly model: TfsmModel) {
    if (model.timingProfile === 'alurDill') {
      throw new TypeError('Alur-Dill models require a zone/region engine and are not supported by the v0.5 simulator.');
    }
    this.state = model.initial.stateId;
  }

  get currentState(): string { return this.state; }
  get now(): number { return this.clock; }
  get residenceTime(): number { return this.clock - this.stateEnteredAt; }

  reset(): void {
    this.state = this.model.initial.stateId;
    this.stateEnteredAt = 0;
    this.clock = 0;
  }

  advanceTo(target: number): TimeoutEvent[] {
    if (!Number.isFinite(target) || target < this.clock) {
      throw new RangeError('Virtual time must be finite and monotonic.');
    }
    const events: TimeoutEvent[] = [];
    for (let transitions = 0; transitions < 1_000; transitions += 1) {
      const state = tfsmStates(this.model).find((item) => item.id === this.state);
      if (!state?.timeout) break;
      const dueAt = this.stateEnteredAt + state.timeout.after;
      if (dueAt > target) break;
      const from = this.state;
      this.clock = dueAt;
      this.state = state.timeout.to;
      this.stateEnteredAt = dueAt;
      events.push({ at: dueAt, from, to: this.state });
      if (transitions === 999) throw new Error('Timeout cycle exceeded 1,000 transitions.');
    }
    this.clock = target;
    return events;
  }

  send(input: string, at: number): SimulatorInputResult {
    this.advanceTo(at);
    const residenceTime = this.residenceTime;
    const candidates = tfsmTransitions(this.model).filter((transition) =>
      transition.from === this.state && transition.input === input &&
      (!transition.timedGuard || intervalContains(transition.timedGuard, residenceTime)));
    if (candidates.length > 1) {
      throw new Error(`Ambiguous TFSM transition from ${this.state} on ${input} at ${residenceTime}.`);
    }
    const transition = candidates[0];
    if (!transition) return { accepted: false, state: this.state, residenceTime };
    this.state = transition.to;
    this.stateEnteredAt = at;
    const window = outputDelayWindow(transition.outputDelay, residenceTime);
    const delay = nominalDelay(window);
    return {
      accepted: true,
      transitionId: transition.id,
      state: this.state,
      residenceTime,
      output: { symbol: transition.output, emittedAt: at + delay, delay },
    };
  }
}

type AccessPath = { state: string; enteredAt: number; actions: TimedInputAction[] };

function stateTimeout(model: TfsmModel, stateId: string): number | undefined {
  return tfsmStates(model).find((state) => state.id === stateId)?.timeout?.after;
}

function nominalGuardTime(transition: TfsmTransition, timeout: number | undefined, epsilon: number): number | undefined {
  const guard = transition.timedGuard;
  let value = guard ? guard.lower.value + (guard.lower.inclusive ? 0 : epsilon) : 0;
  if (guard && isFiniteUpper(guard) && !intervalContains(guard, value)) {
    value = (guard.lower.value + guard.upper.value) / 2;
  }
  if (guard && !intervalContains(guard, value)) return undefined;
  if (timeout !== undefined && value >= timeout) return undefined;
  return value;
}

function accessPaths(model: TfsmModel, epsilon: number): Map<string, AccessPath> {
  const paths = new Map<string, AccessPath>();
  paths.set(model.initial.stateId, { state: model.initial.stateId, enteredAt: 0, actions: [] });
  const queue = [model.initial.stateId];
  while (queue.length) {
    const source = queue.shift()!;
    const path = paths.get(source)!;
    for (const transition of tfsmTransitions(model).filter((item) => item.from === source)) {
      if (paths.has(transition.to)) continue;
      const residence = nominalGuardTime(transition, stateTimeout(model, source), epsilon);
      if (residence === undefined) continue;
      const at = path.enteredAt + residence;
      const action: TimedInputAction = {
        kind: 'input', at, input: transition.input, expectedAccepted: true,
        expectedTransitionId: transition.id, expectedOutput: transition.output,
        expectedDelay: outputDelayWindow(transition.outputDelay, residence),
      };
      paths.set(transition.to, { state: transition.to, enteredAt: at, actions: [...path.actions, action] });
      queue.push(transition.to);
    }
  }
  return paths;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 0))].sort((a, b) => a - b);
}

export function generateTimedBoundaryCases(model: TfsmModel, epsilon = 0.001): TimedTestCase[] {
  if (model.timingProfile === 'alurDill') return [];
  if (!(epsilon > 0) || !Number.isFinite(epsilon)) throw new RangeError('epsilon must be positive and finite.');
  const paths = accessPaths(model, epsilon);
  const cases: TimedTestCase[] = [];
  for (const transition of tfsmTransitions(model)) {
    const access = paths.get(transition.from);
    if (!access) continue;
    const timeout = stateTimeout(model, transition.from);
    const nominal = nominalGuardTime(transition, timeout, epsilon);
    const probes = transition.timedGuard
      ? uniqueNumbers([
          transition.timedGuard.lower.value - epsilon,
          transition.timedGuard.lower.value,
          transition.timedGuard.lower.value + epsilon,
          ...(isFiniteUpper(transition.timedGuard) ? [
            transition.timedGuard.upper.value - epsilon,
            transition.timedGuard.upper.value,
            transition.timedGuard.upper.value + epsilon,
          ] : []),
        ])
      : transition.outputDelay?.kind === 'linearFamily'
        ? uniqueNumbers(timeout === undefined ? [0, 1, 10] : [0, timeout / 2, Math.max(0, timeout - epsilon)])
        : nominal === undefined ? [] : [nominal];
    for (const probe of probes.filter((value) => timeout === undefined || value < timeout)) {
      const activeTransitions = tfsmTransitions(model).filter((candidate) =>
        candidate.from === transition.from && candidate.input === transition.input &&
        (!candidate.timedGuard || intervalContains(candidate.timedGuard, probe)));
      const expectedTransition = activeTransitions.length === 1 ? activeTransitions[0] : undefined;
      const expectedAccepted = expectedTransition !== undefined;
      const action: TimedInputAction = {
        kind: 'input',
        at: access.enteredAt + probe,
        input: transition.input,
        expectedAccepted,
        ...(expectedAccepted && {
          expectedTransitionId: expectedTransition.id,
          expectedOutput: expectedTransition.output,
          expectedDelay: outputDelayWindow(expectedTransition.outputDelay, probe),
        }),
      };
      cases.push({
        id: `${model.id}-${transition.id}-t${String(probe).replace('.', '_')}`,
        name: `${transition.id}: ${transition.input} at t=${probe} ${model.timeUnit}`,
        target: transition.timedGuard ? 'guard-boundary' : transition.outputDelay ? 'output-delay' : 'transition',
        actions: [...access.actions, action],
      });
    }
  }
  for (const state of tfsmStates(model)) {
    if (!state.timeout) continue;
    const access = paths.get(state.id);
    if (!access) continue;
    cases.push({
      id: `${model.id}-${state.id}-timeout`,
      name: `${state.id}: timeout at ${state.timeout.after} ${model.timeUnit}`,
      target: 'timeout',
      actions: [...access.actions, {
        kind: 'wait', until: access.enteredAt + state.timeout.after, expectedState: state.timeout.to,
      }],
    });
  }
  return cases;
}

const verdictRank: Record<TimedVerdict, number> = {
  pass: 0, fail: 1, early: 2, late: 3, timeout: 4, invalid: 5,
};

function worstVerdict(verdicts: TimedVerdict[]): TimedVerdict {
  return verdicts.reduce((worst, verdict) => verdictRank[verdict] > verdictRank[worst] ? verdict : worst, 'pass');
}

export function runVirtualTimedCampaign(model: TfsmModel, cases = generateTimedBoundaryCases(model)): TimedCampaignResult {
  if (model.timingProfile === 'alurDill') {
    return {
      modelId: model.id, timeUnit: model.timeUnit, verdict: 'invalid',
      counts: { pass: 0, fail: 0, early: 0, late: 0, timeout: 0, invalid: 1 }, cases: [],
    };
  }
  const results = cases.map<TimedCaseResult>((testCase) => {
    const simulator = new VirtualTfsmSimulator(model);
    const trace: TimedStepTrace[] = [];
    for (const action of testCase.actions) {
      if (action.kind === 'wait') {
        simulator.advanceTo(action.until);
        const verdict: TimedVerdict = simulator.currentState === action.expectedState ? 'pass' : 'fail';
        trace.push({ action, verdict, state: simulator.currentState,
          message: verdict === 'pass' ? `Reached ${action.expectedState}.` : `Expected ${action.expectedState}, reached ${simulator.currentState}.` });
        if (verdict !== 'pass') break;
        continue;
      }
      let actual: SimulatorInputResult;
      try {
        actual = simulator.send(action.input, action.at);
      } catch (error) {
        trace.push({ action, verdict: 'invalid', state: simulator.currentState,
          message: error instanceof Error ? error.message : String(error) });
        break;
      }
      if (actual.accepted !== action.expectedAccepted ||
        (action.expectedTransitionId && actual.transitionId !== action.expectedTransitionId)) {
        trace.push({ action, verdict: 'fail', state: actual.state, transitionId: actual.transitionId,
          message: action.expectedAccepted ? 'Expected input acceptance by the target transition.' : 'Expected input rejection.' });
        break;
      }
      if (!actual.accepted) {
        trace.push({ action, verdict: 'pass', state: actual.state, message: 'Input rejected at the expected boundary.' });
        continue;
      }
      const observation = { output: actual.output?.symbol ?? null, observedAt: actual.output?.emittedAt ?? null };
      const oracle = evaluateTimedObservation(action, observation);
      trace.push({ action, verdict: oracle.verdict, state: actual.state,
        transitionId: actual.transitionId, observation, message: oracle.message });
      if (oracle.verdict !== 'pass') break;
    }
    return { caseId: testCase.id, name: testCase.name, verdict: worstVerdict(trace.map((item) => item.verdict)), trace };
  });
  const counts: Record<TimedVerdict, number> = { pass: 0, fail: 0, early: 0, late: 0, timeout: 0, invalid: 0 };
  for (const result of results) counts[result.verdict] += 1;
  return { modelId: model.id, timeUnit: model.timeUnit,
    verdict: worstVerdict(results.map((result) => result.verdict)), counts, cases: results };
}

export function serializeTimedTestCases(model: TfsmModel, cases: TimedTestCase[]): string {
  return JSON.stringify({ schemaVersion: '0.5', modelId: model.id, timeUnit: model.timeUnit, cases }, null, 2);
}
