import { describe, expect, it } from 'vitest';
import { generateTransitionCover, type Machine } from './fsm';
import {
  InMemoryFsmAdapter,
  parseTestPlan,
  runTestPlan,
  serializeTestPlan,
  transitionCoverToTestPlan,
  type AdapterResponse,
  type SutAdapter,
  type TestPlan,
} from './testing';

const machine: Machine = {
  name: 'turnstile', initialState: 'locked',
  states: [{ id: 'locked', final: false, sourceLine: 1 }, { id: 'open', final: false, sourceLine: 2 }],
  transitions: [
    { from: 'locked', to: 'open', input: 'coin', output: 'unlock', sourceLine: 3 },
    { from: 'open', to: 'locked', input: 'push', output: 'lock', sourceLine: 4 },
  ],
};

function plan(expected = 'unlock'): TestPlan {
  return { schemaVersion: '1.0', id: 'p1', name: 'Turnstile', modelId: 'turnstile', metadata: {}, cases: [
    { id: 'c1', name: 'Pay', metadata: {}, steps: [
      { input: 'coin', allowedExpectedOutputs: [expected], timeoutMs: 100 },
    ] },
  ] };
}

describe('runTestPlan', () => {
  it('passes against the deterministic in-memory adapter', async () => {
    const result = await runTestPlan(plan(), new InMemoryFsmAdapter(machine));
    expect(result.verdict).toBe('pass');
    expect(result.counts.pass).toBe(1);
    expect(result.cases[0].steps[0].response?.output).toBe('unlock');
  });

  it('reports an output mismatch and continues with the next case', async () => {
    const subject = plan('alarm');
    subject.cases.push({ id: 'c2', name: 'Still runs', metadata: {}, steps: [
      { input: 'coin', allowedExpectedOutputs: ['unlock'], timeoutMs: 100 },
    ] });
    const result = await runTestPlan(subject, new InMemoryFsmAdapter(machine));
    expect(result.cases.map((item) => item.verdict)).toEqual(['fail', 'pass']);
    expect(result.counts).toMatchObject({ pass: 1, fail: 1 });
  });

  it('times out a step and passes the abort signal to the adapter', async () => {
    let aborted = false;
    const adapter: SutAdapter = {
      async reset() {},
      send(_input, signal) {
        return new Promise<AdapterResponse>((_resolve, reject) => signal?.addEventListener('abort', () => {
          aborted = true; reject(signal.reason);
        }, { once: true }));
      },
      async close() {},
    };
    const subject = plan();
    subject.cases[0].steps[0].timeoutMs = 5;
    const result = await runTestPlan(subject, adapter);
    expect(result.verdict).toBe('timeout');
    expect(aborted).toBe(true);
  });

  it('marks reset failures as invalid', async () => {
    const adapter: SutAdapter = {
      async reset() { throw new Error('offline'); },
      async send() { throw new Error('unreachable'); },
      async close() {},
    };
    const result = await runTestPlan(plan(), adapter);
    expect(result.verdict).toBe('invalid');
    expect(result.cases[0].message).toContain('offline');
  });

  it('handles cancellation and marks unstarted cases inconclusive', async () => {
    const controller = new AbortController();
    controller.abort('stop');
    const result = await runTestPlan(plan(), new InMemoryFsmAdapter(machine), { signal: controller.signal });
    expect(result.cancelled).toBe(true);
    expect(result.verdict).toBe('inconclusive');
    expect(result.counts.inconclusive).toBe(1);
  });
});

describe('TestPlan conversion and JSON', () => {
  it('converts transition cover and round-trips stable JSON', () => {
    const subject = transitionCoverToTestPlan(generateTransitionCover(machine), {
      id: 'cover', name: 'Transition cover', modelId: 'turnstile', timeoutMs: 250,
    });
    expect(subject.cases).toHaveLength(2);
    expect(subject.cases[1].steps.map((step) => step.input)).toEqual(['coin', 'push']);
    const json = serializeTestPlan(subject);
    expect(serializeTestPlan(subject)).toBe(json);
    const parsed = parseTestPlan(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(subject);
  });

  it('rejects invalid plans while parsing', () => {
    const parsed = parseTestPlan('{"schemaVersion":"2.0"}');
    expect(parsed.ok).toBe(false);
  });
});
