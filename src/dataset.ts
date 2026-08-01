import { analyzeMachine, type Machine } from './fsm';

export type SequenceSample = {
  episode: number;
  step: number;
  state: string;
  input: string;
  output: string | null;
  nextState: string;
  terminal: boolean;
};

export type SequenceDatasetOptions = {
  episodes: number;
  maxSteps: number;
  seed: number | string;
};

function positiveInteger(value: number, name: string): void {
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

export function generateSequenceDataset(machine: Machine, options: SequenceDatasetOptions): SequenceSample[] {
  positiveInteger(options.episodes, 'episodes');
  positiveInteger(options.maxSteps, 'maxSteps');
  if (options.episodes > 100_000 || options.maxSteps > 10_000
    || options.episodes * options.maxSteps > 1_000_000) {
    throw new RangeError('A sequence dataset must not exceed 1000000 requested steps.');
  }
  if (!analyzeMachine(machine).deterministic) throw new TypeError('Sequence dataset generation requires a deterministic machine.');
  if (!machine.states.some((state) => state.id === machine.initialState)) throw new TypeError('The initial state does not exist.');

  const random = seededRandom(options.seed);
  const finalStates = new Set(machine.states.filter((state) => state.final).map((state) => state.id));
  const outgoing = new Map<string, typeof machine.transitions>();
  for (const transition of machine.transitions) {
    const list = outgoing.get(transition.from) ?? [];
    list.push(transition);
    outgoing.set(transition.from, list);
  }

  const samples: SequenceSample[] = [];
  for (let episode = 0; episode < options.episodes; episode += 1) {
    let state = machine.initialState;
    for (let step = 0; step < options.maxSteps; step += 1) {
      const choices = outgoing.get(state) ?? [];
      if (choices.length === 0) break;
      const transition = choices[Math.floor(random() * choices.length)];
      const terminal = finalStates.has(transition.to) || (outgoing.get(transition.to)?.length ?? 0) === 0;
      samples.push({
        episode,
        step,
        state,
        input: transition.input,
        output: transition.output ?? null,
        nextState: transition.to,
        terminal,
      });
      state = transition.to;
      if (terminal) break;
    }
  }
  return samples;
}

export function sequenceDatasetToJsonLines(samples: readonly SequenceSample[]): string {
  return samples.map((sample) => JSON.stringify(sample)).join('\n') + (samples.length === 0 ? '' : '\n');
}
