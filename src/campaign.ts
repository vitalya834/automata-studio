import { analyzeMachine, type Machine } from './fsm';
import type { JsonObject, TestPlan } from './testing';

export type RandomWalkCampaignOptions = {
  id: string;
  name: string;
  modelId: string;
  cases: number;
  maxSteps: number;
  timeoutMs?: number;
  seed: number | string;
  metadata?: JsonObject;
};

function requirePositive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
}

function seededRandom(seed: number | string): () => number {
  let state = 2166136261;
  for (const char of String(seed)) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

export function randomWalkToTestPlan(machine: Machine, options: RandomWalkCampaignOptions): TestPlan {
  requirePositive(options.cases, 'cases');
  requirePositive(options.maxSteps, 'maxSteps');
  if (options.cases > 100_000) throw new RangeError('cases must not exceed 100000.');
  if (options.maxSteps > 10_000) throw new RangeError('maxSteps must not exceed 10000.');
  if (options.cases * options.maxSteps > 1_000_000) {
    throw new RangeError('A random-walk campaign must not exceed 1000000 requested steps.');
  }
  const timeoutMs = options.timeoutMs ?? 1_000;
  requirePositive(timeoutMs, 'timeoutMs');
  if (!analyzeMachine(machine).deterministic) throw new TypeError('Random-walk generation requires a deterministic machine.');
  if (!machine.states.some((state) => state.id === machine.initialState)) throw new TypeError('The initial state does not exist.');

  const outgoing = new Map<string, Array<{ transition: Machine['transitions'][number]; index: number }>>();
  machine.transitions.forEach((transition, index) => {
    const list = outgoing.get(transition.from) ?? [];
    list.push({ transition, index });
    outgoing.set(transition.from, list);
  });
  if ((outgoing.get(machine.initialState)?.length ?? 0) === 0) {
    throw new TypeError('The initial state has no outgoing transitions to generate a test step.');
  }

  const random = seededRandom(options.seed);
  return {
    schemaVersion: '1.0',
    id: options.id,
    name: options.name,
    modelId: options.modelId,
    metadata: {
      ...(options.metadata ?? {}),
      generator: 'random-walk',
      seed: options.seed,
      requestedCases: options.cases,
      maxSteps: options.maxSteps,
    },
    cases: Array.from({ length: options.cases }, (_, caseIndex) => {
      let state = machine.initialState;
      const stateTrace = [state];
      const steps = [] as TestPlan['cases'][number]['steps'];
      for (let stepIndex = 0; stepIndex < options.maxSteps; stepIndex += 1) {
        const choices = outgoing.get(state) ?? [];
        if (choices.length === 0) break;
        const selected = choices[Math.floor(random() * choices.length)];
        steps.push({
          input: selected.transition.input,
          allowedExpectedOutputs: [selected.transition.output ?? null],
          timeoutMs,
          metadata: { transitionIndex: selected.index, from: selected.transition.from, to: selected.transition.to },
        });
        state = selected.transition.to;
        stateTrace.push(state);
      }
      return {
        id: `${options.id}-rw-${caseIndex + 1}`,
        name: `Random walk ${caseIndex + 1}`,
        metadata: { seed: options.seed, stateTrace },
        steps,
      };
    }),
  };
}
