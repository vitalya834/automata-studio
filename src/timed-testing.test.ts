import { describe, expect, it } from 'vitest';
import type { TfsmModel } from './model-ir';
import {
  VirtualTfsmSimulator,
  evaluateTimedObservation,
  generateTimedBoundaryCases,
  outputDelayWindow,
  runVirtualTimedCampaign,
  type TimedInputAction,
} from './timed-testing';

const guardModel: TfsmModel = {
  schemaVersion: '1.0', id: 'door', name: 'Door', modelKind: 'tfsm',
  semanticProfile: 'deterministic.partial', timingProfile: 'timedGuards', timeUnit: 's',
  inputAlphabet: { symbols: [{ id: 'badge' }] }, outputAlphabet: { symbols: [{ id: 'armed' }, { id: 'open' }] },
  states: [{ id: 'closed' }, { id: 'waiting' }, { id: 'opened' }],
  transitions: [
    { id: 't1', from: 'closed', to: 'waiting', input: 'badge', output: 'armed' },
    { id: 't2', from: 'waiting', to: 'opened', input: 'badge', output: 'open', timedGuard: {
      lower: { value: 0, inclusive: false }, upper: { value: 5, inclusive: true },
    } },
  ], initial: { stateId: 'closed' },
  provenance: { createdBy: 'test', sourceFormat: 'unit', timestamp: '2026-08-01T10:00:00Z' },
};

describe('VirtualTfsmSimulator', () => {
  it('applies timed guards against residence time', () => {
    const simulator = new VirtualTfsmSimulator(guardModel);
    expect(simulator.send('badge', 0).accepted).toBe(true);
    expect(simulator.send('badge', 0).accepted).toBe(false);
    expect(simulator.send('badge', 5).transitionId).toBe('t2');
  });

  it('fires state timeouts before an input at the same timestamp', () => {
    const model: TfsmModel = { ...guardModel, timingProfile: 'timeouts',
      states: [{ id: 'closed' }, { id: 'waiting', timeout: { after: 3, to: 'closed' } }, { id: 'opened' }] };
    const simulator = new VirtualTfsmSimulator(model);
    simulator.send('badge', 0);
    const events = simulator.advanceTo(3);
    expect(events).toEqual([{ at: 3, from: 'waiting', to: 'closed' }]);
    expect(simulator.currentState).toBe('closed');
  });

  it('rejects Alur-Dill models instead of approximating them', () => {
    expect(() => new VirtualTfsmSimulator({ ...guardModel, timingProfile: 'alurDill', clocks: [] }))
      .toThrow(/zone\/region/);
  });
});

describe('timed oracle', () => {
  const action: TimedInputAction = { kind: 'input', at: 10, input: 'on', expectedAccepted: true,
    expectedOutput: 'lit', expectedDelay: { lower: 2, lowerInclusive: true, upper: 4, upperInclusive: true } };

  it('classifies pass, early, late, timeout and wrong output', () => {
    expect(evaluateTimedObservation(action, { output: 'lit', observedAt: 13 }).verdict).toBe('pass');
    expect(evaluateTimedObservation(action, { output: 'lit', observedAt: 11 }).verdict).toBe('early');
    expect(evaluateTimedObservation(action, { output: 'lit', observedAt: 15 }).verdict).toBe('late');
    expect(evaluateTimedObservation(action, { output: 'lit', observedAt: null }).verdict).toBe('timeout');
    expect(evaluateTimedObservation(action, { output: 'dark', observedAt: 13 }).verdict).toBe('fail');
  });

  it('computes linear-family output delays from state residence time', () => {
    expect(outputDelayWindow({ kind: 'linearFamily', base: 2, slope: 0.5 }, 6))
      .toEqual({ lower: 5, lowerInclusive: true, upper: 5, upperInclusive: true });
  });

  it('does not classify floating-point roundoff as a timing violation', () => {
    const exact: TimedInputAction = { ...action, at: 59.999,
      expectedDelay: { lower: 30.9995, lowerInclusive: true, upper: 30.9995, upperInclusive: true } };
    expect(evaluateTimedObservation(exact, { output: 'lit', observedAt: 90.9985 }).verdict).toBe('pass');
  });
});

describe('boundary generation and campaign', () => {
  it('generates inside/outside guard probes and passes the reference campaign', () => {
    const cases = generateTimedBoundaryCases(guardModel, 0.1);
    const targetCases = cases.filter((item) => item.id.includes('-t2-'));
    expect(targetCases.length).toBeGreaterThanOrEqual(5);
    expect(targetCases.some((item) => (item.actions.at(-1) as TimedInputAction).expectedAccepted === false)).toBe(true);
    const result = runVirtualTimedCampaign(guardModel, cases);
    expect(result.verdict).toBe('pass');
    expect(result.counts.pass).toBe(cases.length);
  });

  it('creates an executable timeout boundary case', () => {
    const model: TfsmModel = { ...guardModel, timingProfile: 'timeouts',
      states: [{ id: 'closed' }, { id: 'waiting', timeout: { after: 3, to: 'closed' } }, { id: 'opened' }] };
    const cases = generateTimedBoundaryCases(model);
    expect(cases.some((item) => item.target === 'timeout')).toBe(true);
    expect(runVirtualTimedCampaign(model, cases).verdict).toBe('pass');
  });

  it('samples a linear-family delay across state residence time', () => {
    const model: TfsmModel = { ...guardModel, timingProfile: 'timeoutsAndOutputDelays',
      states: [{ id: 'closed' }, { id: 'waiting', timeout: { after: 10, to: 'closed' } }, { id: 'opened' }],
      transitions: [guardModel.transitions[0], {
        id: 'linear', from: 'waiting', to: 'opened', input: 'badge', output: 'open',
        outputDelay: { kind: 'linearFamily', base: 1, slope: 0.5 },
      }] };
    const samples = generateTimedBoundaryCases(model, 0.1).filter((item) => item.id.includes('-linear-'));
    expect(samples).toHaveLength(3);
    expect(samples.map((item) => (item.actions.at(-1) as TimedInputAction).expectedDelay?.lower))
      .toEqual([1, 3.5, 5.95]);
  });
});
