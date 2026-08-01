import { describe, expect, it } from 'vitest';
import type { Machine } from './fsm';
import { conformanceSuiteToTestPlan, generateConformanceSuite } from './conformance';
import { validateTestPlan } from './testing';

const turnstile: Machine = {
  name: 'Turnstile',
  initialState: 'locked',
  states: [
    { id: 'locked', final: false, sourceLine: 1 },
    { id: 'unlocked', final: false, sourceLine: 2 },
  ],
  inputs: ['coin', 'push'],
  outputs: ['thanks', 'unlock', 'lock', 'alarm'],
  transitions: [
    { from: 'locked', to: 'unlocked', input: 'coin', output: 'unlock', sourceLine: 3 },
    { from: 'locked', to: 'locked', input: 'push', output: 'alarm', sourceLine: 4 },
    { from: 'unlocked', to: 'unlocked', input: 'coin', output: 'thanks', sourceLine: 5 },
    { from: 'unlocked', to: 'locked', input: 'push', output: 'lock', sourceLine: 6 },
  ],
};

describe('conformance generation', () => {
  it.each(['w', 'wp', 'hsi'] as const)('generates a deterministic executable %s suite', (method) => {
    const suite = generateConformanceSuite(turnstile, { method });
    expect(suite.diagnostics).toEqual([]);
    expect(suite.characterizationSet).toContainEqual(['coin']);
    expect(suite.traces.length).toBeGreaterThan(0);
    expect(new Set(suite.traces.map((trace) => JSON.stringify(trace.inputs))).size).toBe(suite.traces.length);
    const plan = conformanceSuiteToTestPlan(suite, { id: `turnstile-${method}`, name: method, modelId: 'turnstile' });
    expect(validateTestPlan(plan)).toEqual({ ok: true, value: plan });
  });

  it('expands the W method for extra implementation states', () => {
    const base = generateConformanceSuite(turnstile, { method: 'w', maxImplementationStates: 2 });
    const expanded = generateConformanceSuite(turnstile, { method: 'w', maxImplementationStates: 3 });
    expect(expanded.traces.length).toBeGreaterThan(base.traces.length);
  });

  it('rejects partial machines and equivalent states explicitly', () => {
    const partial = { ...turnstile, transitions: turnstile.transitions.slice(0, 3) };
    expect(generateConformanceSuite(partial, { method: 'w' }).diagnostics[0].message).toContain('deterministic complete');

    const equivalent: Machine = {
      ...turnstile,
      transitions: [
        { from: 'locked', to: 'unlocked', input: 'coin', output: 'same', sourceLine: 3 },
        { from: 'locked', to: 'locked', input: 'push', output: 'same', sourceLine: 4 },
        { from: 'unlocked', to: 'locked', input: 'coin', output: 'same', sourceLine: 5 },
        { from: 'unlocked', to: 'unlocked', input: 'push', output: 'same', sourceLine: 6 },
      ],
    };
    expect(generateConformanceSuite(equivalent, { method: 'hsi' }).diagnostics.some((item) => item.message.includes('equivalent'))).toBe(true);
  });

  it('enforces the case explosion guard', () => {
    const suite = generateConformanceSuite(turnstile, { method: 'w', maxImplementationStates: 4, maxCases: 2 });
    expect(suite.traces).toEqual([]);
    expect(suite.diagnostics[0].message).toContain('maxCases');
  });
});
