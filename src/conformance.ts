import { analyzeMachine, type Diagnostic, type Machine, type Transition } from './fsm';
import type { JsonObject, TestPlan } from './testing';

export type ConformanceMethod = 'w' | 'wp' | 'hsi';

export type ConformanceOptions = {
  method: ConformanceMethod;
  /** Upper bound on the number of states in the implementation under test. */
  maxImplementationStates?: number;
  /** Guard against accidentally materialising an exponential test suite. */
  maxCases?: number;
};

export type ConformanceTrace = {
  inputs: string[];
  outputs: Array<string | undefined>;
  states: string[];
};

export type ConformanceSuite = {
  method: ConformanceMethod;
  traces: ConformanceTrace[];
  characterizationSet: string[][];
  stateIdentifiers: Record<string, string[][]>;
  diagnostics: Diagnostic[];
};

type Edge = { transition: Transition; index: number };

function key(from: string, input: string): string {
  return `${from}\0${input}`;
}

function wordKey(word: readonly string[]): string {
  return JSON.stringify(word);
}

function uniqueWords(words: readonly string[][]): string[][] {
  const seen = new Set<string>();
  return words.filter((word) => {
    const encoded = wordKey(word);
    if (seen.has(encoded)) return false;
    seen.add(encoded);
    return true;
  });
}

function deterministicTable(machine: Machine): Map<string, Edge> {
  const table = new Map<string, Edge>();
  machine.transitions.forEach((transition, index) => table.set(key(transition.from, transition.input), { transition, index }));
  return table;
}

function stateCover(machine: Machine, table: ReadonlyMap<string, Edge>, inputs: readonly string[]): Map<string, string[]> {
  const paths = new Map<string, string[]>();
  if (!machine.states.some((state) => state.id === machine.initialState)) return paths;
  paths.set(machine.initialState, []);
  const queue = [machine.initialState];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    for (const input of inputs) {
      const edge = table.get(key(state, input));
      if (edge && !paths.has(edge.transition.to)) {
        paths.set(edge.transition.to, [...paths.get(state)!, input]);
        queue.push(edge.transition.to);
      }
    }
  }
  return paths;
}

function shortestDistinguisher(
  left: string,
  right: string,
  inputs: readonly string[],
  table: ReadonlyMap<string, Edge>,
): string[] | undefined {
  const queue: Array<{ left: string; right: string; word: string[] }> = [{ left, right, word: [] }];
  const seen = new Set([left < right ? `${left}\0${right}` : `${right}\0${left}`]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const input of inputs) {
      const leftEdge = table.get(key(current.left, input));
      const rightEdge = table.get(key(current.right, input));
      if (!leftEdge || !rightEdge) continue;
      const word = [...current.word, input];
      if (leftEdge.transition.output !== rightEdge.transition.output) return word;
      const nextLeft = leftEdge.transition.to;
      const nextRight = rightEdge.transition.to;
      if (nextLeft === nextRight) continue;
      const pair = nextLeft < nextRight ? `${nextLeft}\0${nextRight}` : `${nextRight}\0${nextLeft}`;
      if (!seen.has(pair)) {
        seen.add(pair);
        queue.push({ left: nextLeft, right: nextRight, word });
      }
    }
  }
  return undefined;
}

function wordsUpTo(alphabet: readonly string[], depth: number): string[][] {
  const result: string[][] = [[]];
  let frontier: string[][] = [[]];
  for (let length = 1; length <= depth; length += 1) {
    frontier = frontier.flatMap((prefix) => alphabet.map((symbol) => [...prefix, symbol]));
    result.push(...frontier);
  }
  return result;
}

function execute(machine: Machine, table: ReadonlyMap<string, Edge>, inputs: readonly string[]): ConformanceTrace | undefined {
  let state = machine.initialState;
  const outputs: Array<string | undefined> = [];
  const states = [state];
  for (const input of inputs) {
    const edge = table.get(key(state, input));
    if (!edge) return undefined;
    outputs.push(edge.transition.output);
    state = edge.transition.to;
    states.push(state);
  }
  return { inputs: [...inputs], outputs, states };
}

export function generateConformanceSuite(machine: Machine, options: ConformanceOptions): ConformanceSuite {
  const analysis = analyzeMachine(machine);
  const diagnostics: Diagnostic[] = [];
  const empty = (): ConformanceSuite => ({
    method: options.method,
    traces: [],
    characterizationSet: [],
    stateIdentifiers: {},
    diagnostics,
  });
  if (!analysis.deterministic || !analysis.complete) {
    diagnostics.push({ severity: 'error', line: 1, message: `${options.method.toUpperCase()} requires a deterministic complete FSM.` });
    return empty();
  }
  if (analysis.unreachableStates.length > 0) {
    diagnostics.push({ severity: 'error', line: 1, message: `${options.method.toUpperCase()} requires every state to be reachable.` });
    return empty();
  }
  const specificationStates = machine.states.length;
  const upperBound = options.maxImplementationStates ?? specificationStates;
  if (!Number.isSafeInteger(upperBound) || upperBound < specificationStates) {
    diagnostics.push({ severity: 'error', line: 1, message: 'maxImplementationStates must be an integer at least as large as the specification state count.' });
    return empty();
  }
  const maxCases = options.maxCases ?? 10_000;
  if (!Number.isSafeInteger(maxCases) || maxCases <= 0) {
    diagnostics.push({ severity: 'error', line: 1, message: 'maxCases must be a positive integer.' });
    return empty();
  }

  const table = deterministicTable(machine);
  const access = stateCover(machine, table, analysis.inputs);
  const identifiers = new Map<string, string[][]>(machine.states.map((state) => [state.id, []]));
  const characterization: string[][] = [];
  for (let leftIndex = 0; leftIndex < machine.states.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < machine.states.length; rightIndex += 1) {
      const left = machine.states[leftIndex].id;
      const right = machine.states[rightIndex].id;
      const distinguisher = shortestDistinguisher(left, right, analysis.inputs, table);
      if (!distinguisher) {
        diagnostics.push({ severity: 'error', line: machine.states[rightIndex].sourceLine,
          message: `States ${JSON.stringify(left)} and ${JSON.stringify(right)} are behaviourally equivalent.` });
        continue;
      }
      characterization.push(distinguisher);
      identifiers.get(left)!.push(distinguisher);
      identifiers.get(right)!.push(distinguisher);
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return empty();

  const w = uniqueWords(characterization);
  const suffixes = w.length > 0 ? w : [[]];
  const words: string[][] = [];
  if (options.method === 'w') {
    const middle = wordsUpTo(analysis.inputs, upperBound - specificationStates + 1);
    for (const prefix of access.values()) {
      for (const infix of middle) for (const suffix of suffixes) words.push([...prefix, ...infix, ...suffix]);
    }
  } else {
    // State-cover checks retain a global characterisation set.
    for (const prefix of access.values()) for (const suffix of suffixes) words.push([...prefix, ...suffix]);
    // Transition-cover prefixes are followed by identifiers of the reached state.
    for (const state of machine.states.map((item) => item.id)) {
      const prefix = access.get(state)!;
      for (const input of analysis.inputs) {
        const edge = table.get(key(state, input))!;
        const local = uniqueWords(identifiers.get(edge.transition.to) ?? []);
        const selected = options.method === 'hsi' ? (local.length > 0 ? local : [[]]) : (local.length > 0 ? local : suffixes);
        for (const suffix of selected) words.push([...prefix, input, ...suffix]);
      }
    }
  }

  const unique = uniqueWords(words).filter((word) => word.length > 0);
  if (unique.length > maxCases) {
    diagnostics.push({ severity: 'error', line: 1,
      message: `${options.method.toUpperCase()} would generate ${unique.length} cases, exceeding maxCases=${maxCases}.` });
    return empty();
  }
  const traces = unique.flatMap((word) => {
    const trace = execute(machine, table, word);
    return trace ? [trace] : [];
  });
  return {
    method: options.method,
    traces,
    characterizationSet: w,
    stateIdentifiers: Object.fromEntries([...identifiers].map(([state, values]) => [state, uniqueWords(values)])),
    diagnostics,
  };
}

export function conformanceSuiteToTestPlan(
  suite: ConformanceSuite,
  options: { id: string; name: string; modelId: string; timeoutMs?: number; metadata?: JsonObject },
): TestPlan {
  const timeoutMs = options.timeoutMs ?? 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('timeoutMs must be a positive safe integer.');
  if (suite.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new TypeError(suite.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  return {
    schemaVersion: '1.0',
    id: options.id,
    name: options.name,
    modelId: options.modelId,
    metadata: {
      ...(options.metadata ?? {}),
      generator: suite.method,
      characterizationSet: suite.characterizationSet,
      diagnosticCount: suite.diagnostics.length,
    },
    cases: suite.traces.map((trace, caseIndex) => ({
      id: `${options.id}-${suite.method}-${caseIndex + 1}`,
      name: `${suite.method.toUpperCase()} conformance sequence ${caseIndex + 1}`,
      metadata: { stateTrace: trace.states },
      steps: trace.inputs.map((input, stepIndex) => ({
        input,
        allowedExpectedOutputs: [trace.outputs[stepIndex] ?? null],
        timeoutMs,
        metadata: { expectedState: trace.states[stepIndex + 1] },
      })),
    })),
  };
}
