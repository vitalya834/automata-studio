import { describe, expect, it } from 'vitest';
import {
  analyzeMachine,
  generateMachine,
  generateTransitionCover,
  parseLegacyFsm,
  parseMachine,
  type Machine,
} from './fsm.ts';

const machine = (overrides: Partial<Machine> = {}): Machine => ({
  name: 'Example',
  initialState: 'A',
  states: [
    { id: 'A', final: false, sourceLine: 1 },
    { id: 'B', final: false, sourceLine: 2 },
  ],
  transitions: [
    { from: 'A', to: 'B', input: 'x', output: 'one', sourceLine: 10 },
    { from: 'A', to: 'A', input: 'y', output: 'two', sourceLine: 11 },
    { from: 'B', to: 'A', input: 'x', output: 'one', sourceLine: 12 },
    { from: 'B', to: 'B', input: 'y', output: 'two', sourceLine: 13 },
  ],
  ...overrides,
});

describe('parseMachine', () => {
  it('parses the text DSL', () => {
    const result = parseMachine('machine Turnstile\ninitial Locked\nLocked --coin / unlock--> Unlocked\nUnlocked --push / lock--> Locked');
    expect(result.machine?.states.map((state) => state.id)).toEqual(['Locked', 'Unlocked']);
    expect(result.machine?.transitions).toHaveLength(2);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports invalid lines, nondeterminism, and unreachable states', () => {
    expect(parseMachine('machine Broken\ninitial A\nnot valid').diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', line: 3 }),
    );
    expect(parseMachine('machine NFA\ninitial A\nA --x--> B\nA --x--> C').diagnostics.some((item) => item.message.includes('Nondeterminism'))).toBe(true);
    expect(parseMachine('machine M\ninitial A\nstate Lost\nA --x--> A').diagnostics.some((item) => item.message.includes('unreachable'))).toBe(true);
  });
});

describe('analyzeMachine', () => {
  it('reports alphabets, determinism, completeness, reachability, and transition count', () => {
    expect(analyzeMachine(machine())).toEqual({
      inputs: ['x', 'y'],
      outputs: ['one', 'two'],
      deterministic: true,
      complete: true,
      reachableStates: ['A', 'B'],
      unreachableStates: [],
      transitionCount: 4,
    });
  });

  it('detects partial, nondeterministic, and unreachable machines', () => {
    const subject = machine({
      states: [...machine().states, { id: 'C', final: false, sourceLine: 3 }],
      transitions: [
        { from: 'A', to: 'B', input: 'x', sourceLine: 10 },
        { from: 'A', to: 'A', input: 'x', sourceLine: 11 },
        { from: 'B', to: 'A', input: 'y', sourceLine: 12 },
      ],
    });
    expect(analyzeMachine(subject)).toMatchObject({
      deterministic: false,
      complete: false,
      reachableStates: ['A', 'B'],
      unreachableStates: ['C'],
      transitionCount: 3,
    });
  });
});

describe('generateMachine', () => {
  const options = {
    name: 'Generated', stateCount: 8, inputCount: 3, outputCount: 2,
    deterministic: true, complete: true, seed: 'repeatable',
  } as const;

  it('is reproducible and satisfies deterministic complete constraints', () => {
    const first = generateMachine(options);
    expect(generateMachine(options)).toEqual(first);
    expect(analyzeMachine(first)).toMatchObject({
      deterministic: true,
      complete: true,
      unreachableStates: [],
      transitionCount: 24,
    });
  });

  it('satisfies incomplete and nondeterministic constraints', () => {
    const generated = generateMachine({ ...options, deterministic: false, complete: false, seed: 42 });
    expect(analyzeMachine(generated)).toMatchObject({
      deterministic: false,
      complete: false,
      unreachableStates: [],
    });
  });

  it('supports empty machines and rejects impossible constraints', () => {
    expect(generateMachine({ ...options, stateCount: 0, inputCount: 0, outputCount: 0 }).states).toEqual([]);
    expect(() => generateMachine({ ...options, stateCount: 2, inputCount: 0 })).toThrow(/reachable/);
    expect(() => generateMachine({ ...options, stateCount: 1, inputCount: 1, deterministic: false, complete: false })).toThrow(/at least two/);
    expect(() => generateMachine({ ...options, stateCount: 1, inputCount: 2, outputCount: 1, deterministic: false })).toThrow(/Nondeterminism/);
  });
});

describe('generateTransitionCover', () => {
  it('uses a shortest access path and identifies every covered transition', () => {
    const result = generateTransitionCover(machine());
    expect(result.diagnostics).toEqual([]);
    expect(result.tests).toHaveLength(4);
    expect(result.tests[3]).toEqual({
      targetTransition: { index: 3, sourceLine: 13 },
      inputTrace: ['x', 'y'],
      outputTrace: ['one', 'two'],
      stateTrace: ['A', 'B', 'B'],
      coveredTransitions: [
        { index: 0, sourceLine: 10 },
        { index: 3, sourceLine: 13 },
      ],
    });
  });

  it('returns an explicit error for nondeterminism', () => {
    const subject = machine({ transitions: [...machine().transitions, { from: 'A', to: 'A', input: 'x', sourceLine: 20 }] });
    const result = generateTransitionCover(subject);
    expect(result.tests).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('deterministic') }));
  });

  it('warns and skips transitions whose source is unreachable', () => {
    const subject = machine({
      states: [...machine().states, { id: 'C', final: false, sourceLine: 3 }],
      transitions: [...machine().transitions, { from: 'C', to: 'C', input: 'x', sourceLine: 30 }],
    });
    const result = generateTransitionCover(subject);
    expect(result.tests).toHaveLength(4);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', line: 30 }));
  });
});

describe('parseLegacyFsm', () => {
  const legacy = `F 1
s 4
i 2
o 2
n0 0
p 9
0 0 1 1
0 1 2 1
1 0 0 0
1 1 3 1
2 0 2 1
2 1 0 0
3 0 2 1
3 1 3 1
3 1 2 1`;

  it('parses the recovered F 1 format and preserves source lines', () => {
    const result = parseLegacyFsm(legacy, 'Recovered');
    expect(result.machine).toMatchObject({ name: 'Recovered', initialState: '0' });
    expect(result.machine?.states).toHaveLength(4);
    expect(result.machine?.transitions).toHaveLength(9);
    expect(result.machine?.transitions[0]).toEqual({ from: '0', input: '0', to: '1', output: '1', sourceLine: 7 });
    expect(result.diagnostics.some((item) => item.message.includes('Nondeterminism'))).toBe(true);
  });

  it('validates counts and indices', () => {
    const result = parseLegacyFsm('F 1\ns 1\ni 1\no 1\nn0 2\np 2\n0 2 3 4');
    expect(result.machine).toBeUndefined();
    expect(result.diagnostics.map((item) => item.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('p declares 2'),
      expect.stringContaining('State index'),
      expect.stringContaining('Input'),
      expect.stringContaining('Output'),
      expect.stringContaining('Initial state'),
    ]));
  });
});
