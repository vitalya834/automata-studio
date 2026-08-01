import { describe, expect, it } from 'vitest';
import { randomWalkToTestPlan } from './campaign';
import type { Machine } from './fsm';
import { validateTestPlan } from './testing';

const machine = (): Machine => ({
  name: 'Session', initialState: 'menu',
  states: [
    { id: 'menu', final: false, sourceLine: 1 },
    { id: 'playing', final: false, sourceLine: 2 },
  ],
  transitions: [
    { from: 'menu', to: 'playing', input: 'start', output: 'playing', sourceLine: 3 },
    { from: 'playing', to: 'playing', input: 'tick', output: 'playing', sourceLine: 4 },
    { from: 'playing', to: 'menu', input: 'quit', output: 'menu', sourceLine: 5 },
  ],
});

describe('random-walk campaign generator', () => {
  it('creates a reproducible valid Test Plan IR with oracle outputs', () => {
    const options = { id: 'session-random', name: 'Session fuzz', modelId: 'Session', cases: 5, maxSteps: 8, seed: 2026 };
    const first = randomWalkToTestPlan(machine(), options);
    const second = randomWalkToTestPlan(machine(), options);
    expect(first).toEqual(second);
    expect(validateTestPlan(first).ok).toBe(true);
    expect(first.cases).toHaveLength(5);
    expect(first.cases.every((item) => item.steps.length === 8)).toBe(true);
    expect(first.cases[0].steps[0]).toMatchObject({ input: 'start', allowedExpectedOutputs: ['playing'] });
  });

  it('rejects invalid limits, nondeterminism and dead initial states', () => {
    expect(() => randomWalkToTestPlan(machine(), {
      id: 'x', name: 'x', modelId: 'x', cases: 0, maxSteps: 1, seed: 1,
    })).toThrow('cases');
    expect(() => randomWalkToTestPlan(machine(), {
      id: 'x', name: 'x', modelId: 'x', cases: 10_000, maxSteps: 1_000, seed: 1,
    })).toThrow('1000000');
    const nondeterministic = machine();
    nondeterministic.transitions.push({ from: 'menu', to: 'menu', input: 'start', output: 'menu', sourceLine: 6 });
    expect(() => randomWalkToTestPlan(nondeterministic, {
      id: 'x', name: 'x', modelId: 'x', cases: 1, maxSteps: 1, seed: 1,
    })).toThrow('deterministic');
    const dead = machine();
    dead.transitions = dead.transitions.filter((transition) => transition.from !== 'menu');
    expect(() => randomWalkToTestPlan(dead, {
      id: 'x', name: 'x', modelId: 'x', cases: 1, maxSteps: 1, seed: 1,
    })).toThrow('no outgoing');
  });
});
