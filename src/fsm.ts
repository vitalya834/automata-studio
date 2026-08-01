export type State = {
  id: string;
  final: boolean;
  sourceLine: number;
};

export type Transition = {
  from: string;
  to: string;
  input: string;
  output?: string;
  sourceLine: number;
};

export type Machine = {
  name: string;
  initialState: string;
  states: State[];
  transitions: Transition[];
  /** Optional declared alphabets; text DSL machines infer them from transitions. */
  inputs?: string[];
  outputs?: string[];
};

export type Diagnostic = {
  severity: 'error' | 'warning';
  line: number;
  message: string;
};

export type ParseResult = {
  machine?: Machine;
  diagnostics: Diagnostic[];
};

export type MachineAnalysis = {
  inputs: string[];
  outputs: string[];
  deterministic: boolean;
  complete: boolean;
  reachableStates: string[];
  unreachableStates: string[];
  transitionCount: number;
};

export type GenerateMachineOptions = {
  name: string;
  stateCount: number;
  inputCount: number;
  outputCount: number;
  deterministic: boolean;
  complete: boolean;
  seed: number | string;
};

export type CoveredTransition = {
  index: number;
  sourceLine: number;
};

export type TransitionCoverTest = {
  /** The transition this test was created to cover. */
  targetTransition: CoveredTransition;
  inputTrace: string[];
  outputTrace: Array<string | undefined>;
  stateTrace: string[];
  /** Includes the access sequence and the target transition. */
  coveredTransitions: CoveredTransition[];
};

export type TransitionCoverResult = {
  tests: TransitionCoverTest[];
  diagnostics: Diagnostic[];
};

const identifier = /^[\p{L}\p{N}_-]+$/u;

function uniqueInOrder(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

export function analyzeMachine(machine: Machine): MachineAnalysis {
  const inputs = uniqueInOrder(machine.inputs ?? machine.transitions.map((transition) => transition.input));
  const outputs = uniqueInOrder(machine.outputs ??
    machine.transitions.flatMap((transition) => transition.output === undefined ? [] : [transition.output]));
  const counts = new Map<string, number>();
  for (const transition of machine.transitions) {
    const key = `${transition.from}\0${transition.input}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const deterministic = [...counts.values()].every((count) => count <= 1);
  const complete = machine.states.every((state) =>
    inputs.every((input) => (counts.get(`${state.id}\0${input}`) ?? 0) > 0),
  );

  const reachable = new Set<string>();
  if (machine.states.some((state) => state.id === machine.initialState)) {
    reachable.add(machine.initialState);
  }
  const queue = [...reachable];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    for (const transition of machine.transitions) {
      if (transition.from === state && !reachable.has(transition.to)) {
        reachable.add(transition.to);
        queue.push(transition.to);
      }
    }
  }

  return {
    inputs,
    outputs,
    deterministic,
    complete,
    reachableStates: machine.states.filter((state) => reachable.has(state.id)).map((state) => state.id),
    unreachableStates: machine.states.filter((state) => !reachable.has(state.id)).map((state) => state.id),
    transitionCount: machine.transitions.length,
  };
}

function hashSeed(seed: number | string): number {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number | string): () => number {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function requireCount(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

export function generateMachine(options: GenerateMachineOptions): Machine {
  requireCount('stateCount', options.stateCount);
  requireCount('inputCount', options.inputCount);
  requireCount('outputCount', options.outputCount);
  if (!options.name.trim()) throw new RangeError('name must not be empty.');
  if (options.stateCount > 1 && options.inputCount === 0) {
    throw new RangeError('inputCount must be positive to make multiple states reachable.');
  }
  if (!options.deterministic && options.stateCount * options.inputCount === 0) {
    throw new RangeError('A nondeterministic machine requires at least one state and one input.');
  }
  if (!options.deterministic && options.stateCount < 2 && options.outputCount < 2) {
    throw new RangeError('Nondeterminism requires at least two possible target states or output symbols.');
  }
  if (!options.complete && options.stateCount * options.inputCount === 0) {
    throw new RangeError('An incomplete machine requires at least one state and one input.');
  }
  if (!options.deterministic && !options.complete && options.stateCount * options.inputCount < 2) {
    throw new RangeError('Nondeterministic and incomplete constraints require at least two state/input pairs.');
  }

  const random = seededRandom(options.seed);
  const states: State[] = Array.from({ length: options.stateCount }, (_, index) => ({
    id: `q${index}`,
    final: random() < 0.3,
    sourceLine: index + 1,
  }));
  const inputs = Array.from({ length: options.inputCount }, (_, index) => `i${index}`);
  const outputs = Array.from({ length: options.outputCount }, (_, index) => `o${index}`);
  const transitions: Transition[] = [];
  const occupied = new Set<string>();
  const allPairs = states.flatMap((state) => inputs.map((input) => ({ state: state.id, input })));
  const outputFor = (): string | undefined => outputs.length === 0
    ? undefined
    : outputs[Math.floor(random() * outputs.length)];
  const add = (from: string, input: string, to: string, output = outputFor()): void => {
    transitions.push({ from, to, input, output, sourceLine: transitions.length + 1 });
    occupied.add(`${from}\0${input}`);
  };

  // A seeded chain is a spanning arborescence, so every generated state is reachable.
  for (let index = 1; index < states.length; index += 1) {
    const input = inputs[Math.floor(random() * inputs.length)];
    add(states[index - 1].id, input, states[index].id);
  }

  if (options.complete) {
    for (const pair of allPairs) {
      if (!occupied.has(`${pair.state}\0${pair.input}`)) {
        add(pair.state, pair.input, states[Math.floor(random() * states.length)].id);
      }
    }
  } else {
    // Leave at least one pair absent. Other pairs are selected by the seed.
    const missingCandidates = allPairs.filter((pair) => !occupied.has(`${pair.state}\0${pair.input}`));
    const reservedMissing = missingCandidates[Math.floor(random() * missingCandidates.length)];
    for (const pair of allPairs) {
      const key = `${pair.state}\0${pair.input}`;
      if (occupied.has(key) || pair === reservedMissing) continue;
      if (random() < 0.45) add(pair.state, pair.input, states[Math.floor(random() * states.length)].id);
    }
  }

  if (!options.deterministic) {
    const occupiedPairs = allPairs.filter((pair) => occupied.has(`${pair.state}\0${pair.input}`));
    let pair = occupiedPairs[Math.floor(random() * occupiedPairs.length)];
    if (!pair) {
      // Only possible for a one-state incomplete machine with at least two inputs.
      pair = allPairs.find((candidate) => candidate !== allPairs[allPairs.length - 1])!;
      add(pair.state, pair.input, states[0].id);
    }
    const original = transitions.find((transition) => transition.from === pair.state && transition.input === pair.input)!;
    if (states.length > 1) {
      const alternatives = states.filter((state) => state.id !== original.to);
      add(pair.state, pair.input, alternatives[Math.floor(random() * alternatives.length)].id, original.output);
    } else {
      const alternatives = outputs.filter((output) => output !== original.output);
      add(pair.state, pair.input, original.to, alternatives[Math.floor(random() * alternatives.length)]);
    }
  }

  return {
    name: options.name,
    initialState: states[0]?.id ?? '',
    states,
    transitions,
    inputs,
    outputs,
  };
}

export function generateTransitionCover(machine: Machine): TransitionCoverResult {
  const diagnostics: Diagnostic[] = [];
  if (!analyzeMachine(machine).deterministic) {
    return {
      tests: [],
      diagnostics: [{
        severity: 'error',
        line: 1,
        message: 'Transition cover requires a deterministic FSM.',
      }],
    };
  }

  const outgoing = new Map<string, Array<{ transition: Transition; index: number }>>();
  machine.transitions.forEach((transition, index) => {
    const list = outgoing.get(transition.from) ?? [];
    list.push({ transition, index });
    outgoing.set(transition.from, list);
  });

  // BFS stores one shortest access sequence for each reachable state.
  const paths = new Map<string, number[]>();
  if (machine.states.some((state) => state.id === machine.initialState)) {
    paths.set(machine.initialState, []);
  }
  const queue = [...paths.keys()];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    for (const edge of outgoing.get(state) ?? []) {
      if (!paths.has(edge.transition.to)) {
        paths.set(edge.transition.to, [...paths.get(state)!, edge.index]);
        queue.push(edge.transition.to);
      }
    }
  }

  const tests: TransitionCoverTest[] = [];
  machine.transitions.forEach((transition, targetIndex) => {
    const access = paths.get(transition.from);
    if (!access) {
      diagnostics.push({
        severity: 'warning',
        line: transition.sourceLine,
        message: `Transition ${targetIndex} is unreachable from the initial state.`,
      });
      return;
    }
    const indices = [...access, targetIndex];
    const trace = indices.map((index) => machine.transitions[index]);
    const stateTrace = [machine.initialState, ...trace.map((item) => item.to)];
    tests.push({
      targetTransition: { index: targetIndex, sourceLine: transition.sourceLine },
      inputTrace: trace.map((item) => item.input),
      outputTrace: trace.map((item) => item.output),
      stateTrace,
      coveredTransitions: indices.map((index) => ({
        index,
        sourceLine: machine.transitions[index].sourceLine,
      })),
    });
  });

  return { tests, diagnostics };
}

export function parseLegacyFsm(source: string, name = 'LegacyFSM'): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const declarations = new Map<string, { value: number; line: number }>();
  const rows: Array<{ values: number[]; line: number }> = [];

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const declaration = line.match(/^(F|s|i|o|n0|p)\s+(-?\d+)$/i);
    if (declaration) {
      const key = declaration[1].toLowerCase();
      if (declarations.has(key)) {
        diagnostics.push({ severity: 'error', line: lineNumber, message: `Duplicate ${declaration[1]} declaration.` });
      } else {
        declarations.set(key, { value: Number(declaration[2]), line: lineNumber });
      }
      return;
    }
    const transition = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/);
    if (transition) {
      rows.push({ values: transition.slice(1).map(Number), line: lineNumber });
      return;
    }
    diagnostics.push({ severity: 'error', line: lineNumber, message: 'Expected a legacy declaration or: from input next output.' });
  });

  for (const key of ['f', 's', 'i', 'o', 'n0', 'p']) {
    if (!declarations.has(key)) diagnostics.push({ severity: 'error', line: 1, message: `Missing ${key === 'f' ? 'F' : key} declaration.` });
  }
  const get = (key: string): number | undefined => declarations.get(key)?.value;
  const stateCount = get('s');
  const inputCount = get('i');
  const outputCount = get('o');
  const initial = get('n0');
  const expectedTransitions = get('p');
  for (const [key, item] of declarations) {
    if (key !== 'f' && item.value < 0) diagnostics.push({ severity: 'error', line: item.line, message: `${key} must not be negative.` });
  }
  if (expectedTransitions !== undefined && expectedTransitions !== rows.length) {
    diagnostics.push({ severity: 'error', line: declarations.get('p')!.line, message: `p declares ${expectedTransitions} transitions, but ${rows.length} were found.` });
  }

  if (stateCount !== undefined && inputCount !== undefined && outputCount !== undefined) {
    for (const row of rows) {
      const [from, input, to, output] = row.values;
      if (from >= stateCount || to >= stateCount) diagnostics.push({ severity: 'error', line: row.line, message: 'State index is outside the declared s range.' });
      if (input >= inputCount) diagnostics.push({ severity: 'error', line: row.line, message: 'Input index is outside the declared i range.' });
      if (output >= outputCount) diagnostics.push({ severity: 'error', line: row.line, message: 'Output index is outside the declared o range.' });
    }
  }
  if (stateCount !== undefined && initial !== undefined && initial >= stateCount) {
    diagnostics.push({ severity: 'error', line: declarations.get('n0')!.line, message: 'Initial state is outside the declared s range.' });
  }

  if (diagnostics.some((item) => item.severity === 'error') || stateCount === undefined || initial === undefined) {
    return { diagnostics };
  }
  const machine: Machine = {
    name,
    initialState: String(initial),
    states: Array.from({ length: stateCount }, (_, id) => ({ id: String(id), final: false, sourceLine: declarations.get('s')!.line })),
    inputs: Array.from({ length: inputCount! }, (_, id) => String(id)),
    outputs: Array.from({ length: outputCount! }, (_, id) => String(id)),
    transitions: rows.map((row) => ({
      from: String(row.values[0]),
      input: String(row.values[1]),
      to: String(row.values[2]),
      output: String(row.values[3]),
      sourceLine: row.line,
    })),
  };
  diagnostics.push(...validateMachine(machine));
  return { machine, diagnostics };
}

export function parseMachine(source: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const states = new Map<string, State>();
  const transitions: Transition[] = [];
  let name = '';
  let initialState = '';

  const addState = (id: string, line: number, final = false) => {
    const current = states.get(id);
    if (current) {
      current.final ||= final;
      return;
    }
    states.set(id, { id, final, sourceLine: line });
  };

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;

    const declaration = line.match(/^(machine|state|initial|final)\s+(.+)$/i);
    if (declaration) {
      const keyword = declaration[1].toLowerCase();
      const value = declaration[2].trim();
      if (!identifier.test(value)) {
        diagnostics.push({ severity: 'error', line: lineNumber, message: `Invalid name “${value}”. Use letters, digits, _ or -.` });
        return;
      }
      if (keyword === 'machine') name = value;
      if (keyword === 'state') addState(value, lineNumber);
      if (keyword === 'initial') {
        initialState = value;
        addState(value, lineNumber);
      }
      if (keyword === 'final') addState(value, lineNumber, true);
      return;
    }

    const transition = line.match(/^([\p{L}\p{N}_-]+)\s*--\s*([^/]+?)(?:\s*\/\s*(.+?))?\s*-->\s*([\p{L}\p{N}_-]+)$/u);
    if (transition) {
      const [, from, input, output, to] = transition;
      addState(from, lineNumber);
      addState(to, lineNumber);
      transitions.push({ from, to, input: input.trim(), output: output?.trim(), sourceLine: lineNumber });
      return;
    }

    diagnostics.push({ severity: 'error', line: lineNumber, message: 'Unrecognized line. Expected a declaration or transition A --input--> B.' });
  });

  if (!name) diagnostics.push({ severity: 'error', line: 1, message: 'Add a name: machine Name.' });
  if (!initialState) diagnostics.push({ severity: 'error', line: 1, message: 'Add an initial state: initial State.' });

  const machine = name && initialState
    ? { name, initialState, states: [...states.values()], transitions }
    : undefined;

  if (machine) diagnostics.push(...validateMachine(machine));
  return { machine, diagnostics };
}

export function validateMachine(machine: Machine): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const stateIds = new Set(machine.states.map((state) => state.id));
  if (!stateIds.has(machine.initialState)) {
    diagnostics.push({ severity: 'error', line: 1, message: `Initial state “${machine.initialState}” does not exist.` });
  }
  const seen = new Map<string, Transition>();
  for (const transition of machine.transitions) {
    if (!stateIds.has(transition.from) || !stateIds.has(transition.to)) {
      diagnostics.push({ severity: 'error', line: transition.sourceLine, message: 'Transition refers to an unknown state.' });
    }
    const key = `${transition.from}\0${transition.input}`;
    const previous = seen.get(key);
    if (previous) {
      const sameTarget = previous.to === transition.to && previous.output === transition.output;
      diagnostics.push({
        severity: sameTarget ? 'warning' : 'error',
        line: transition.sourceLine,
        message: sameTarget
          ? `Duplicate transition from ${transition.from} on input “${transition.input}”.`
          : `Nondeterminism: ${transition.from} has multiple transitions on input “${transition.input}”.`,
      });
    } else {
      seen.set(key, transition);
    }
  }
  for (const state of machine.states) {
    if (analyzeMachine(machine).unreachableStates.includes(state.id)) {
      diagnostics.push({ severity: 'warning', line: state.sourceLine, message: `State “${state.id}” is unreachable from the initial state.` });
    }
  }
  return diagnostics;
}
