import { describe, expect, it } from 'vitest';
import type { Machine } from './fsm';
import { generateSequenceDataset, sequenceDatasetToJsonLines } from './dataset';

const machine = (): Machine => ({
  name: 'Game', initialState: 'menu',
  states: [
    { id: 'menu', final: false, sourceLine: 1 },
    { id: 'playing', final: false, sourceLine: 2 },
    { id: 'victory', final: true, sourceLine: 3 },
  ],
  transitions: [
    { from: 'menu', to: 'playing', input: 'start', output: 'playing', sourceLine: 4 },
    { from: 'playing', to: 'playing', input: 'tick', output: 'playing', sourceLine: 5 },
    { from: 'playing', to: 'victory', input: 'win', output: 'victory', sourceLine: 6 },
  ],
});

describe('sequence dataset generator', () => {
  it('is reproducible and emits supervised state-transition records', () => {
    const first = generateSequenceDataset(machine(), { episodes: 4, maxSteps: 5, seed: 'training-2026' });
    const second = generateSequenceDataset(machine(), { episodes: 4, maxSteps: 5, seed: 'training-2026' });
    expect(first).toEqual(second);
    expect(first[0]).toEqual({ episode: 0, step: 0, state: 'menu', input: 'start', output: 'playing', nextState: 'playing', terminal: false });
    expect(JSON.parse(sequenceDatasetToJsonLines(first).split('\n')[0])).toEqual(first[0]);
  });

  it('rejects nondeterministic machines and invalid limits', () => {
    const nondeterministic = machine();
    nondeterministic.transitions.push({ from: 'menu', to: 'victory', input: 'start', output: 'victory', sourceLine: 7 });
    expect(() => generateSequenceDataset(nondeterministic, { episodes: 1, maxSteps: 1, seed: 1 })).toThrow('deterministic');
    expect(() => generateSequenceDataset(machine(), { episodes: 0, maxSteps: 1, seed: 1 })).toThrow('episodes');
  });
});
