import { analyzeMachine, type Machine } from './fsm';
import {
  validateModel,
  type AutomataModel,
  type JsonValue,
  type MealyModel,
  type SemanticProfile,
  type ValidationDiagnostic,
} from './model-ir';

export const DEFAULT_SILENT_OUTPUT = '__silent__';

type LegacyExtension = {
  silentOutput?: string;
  finalStates?: string[];
  stateSourceLines?: Record<string, number>;
  transitionSourceLines?: Record<string, number>;
};

export type MachineToModelIrOptions = {
  id?: string;
  description?: string;
  createdBy?: string;
  createdByVersion?: string;
  sourceFormat?: string;
  seed?: number | string;
  timestamp?: string;
};

export type ModelIrImportResult =
  | { ok: true; machine: Machine; model: MealyModel; diagnostics: [] }
  | { ok: false; diagnostics: Array<ValidationDiagnostic | {
      code: 'unsupported-model-kind'; path: '/modelKind'; message: string;
    }> };

function slug(value: string): string {
  const normalized = value.trim().replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^[.-]+|[.-]+$/g, '');
  return normalized || 'machine';
}

function semanticProfile(machine: Machine): SemanticProfile {
  const analysis = analyzeMachine(machine);
  return `${analysis.deterministic ? 'deterministic' : 'nondeterministic'}.${analysis.complete ? 'complete' : 'partial'}`;
}

function selectSilentOutput(machine: Machine): string {
  const used = new Set(machine.outputs ?? machine.transitions.flatMap((transition) =>
    transition.output === undefined ? [] : [transition.output]));
  let candidate = DEFAULT_SILENT_OUTPUT;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${DEFAULT_SILENT_OUTPUT}_${suffix++}`;
  return candidate;
}

export function machineToModelIr(machine: Machine, options: MachineToModelIrOptions = {}): MealyModel {
  const analysis = analyzeMachine(machine);
  const hasSilentTransitions = machine.transitions.some((transition) => transition.output === undefined);
  const silentOutput = hasSilentTransitions ? selectSilentOutput(machine) : undefined;
  const finalStates = machine.states.filter((state) => state.final).map((state) => state.id);
  const stateSourceLines = Object.fromEntries(machine.states.map((state) => [state.id, state.sourceLine]));
  const transitionSourceLines: Record<string, number> = {};
  const transitions = machine.transitions.map((transition, index) => {
    const id = `t${index + 1}`;
    transitionSourceLines[id] = transition.sourceLine;
    return {
      id,
      from: transition.from,
      to: transition.to,
      input: transition.input,
      output: transition.output ?? silentOutput!,
    };
  });
  const legacy: LegacyExtension = { finalStates, stateSourceLines, transitionSourceLines };
  if (silentOutput) legacy.silentOutput = silentOutput;

  return {
    schemaVersion: '1.0',
    id: options.id ?? slug(machine.name),
    name: machine.name,
    ...(options.description && { description: options.description }),
    modelKind: 'mealy',
    semanticProfile: semanticProfile(machine),
    inputAlphabet: { symbols: analysis.inputs.map((id) => ({ id })) },
    outputAlphabet: {
      symbols: [...analysis.outputs, ...(silentOutput ? [silentOutput] : [])].map((id) => ({ id })),
    },
    states: machine.states.map((state) => ({ id: state.id })),
    transitions,
    initial: { stateId: machine.initialState },
    provenance: {
      createdBy: options.createdBy ?? 'automata-studio',
      ...(options.createdByVersion && { createdByVersion: options.createdByVersion }),
      sourceFormat: options.sourceFormat ?? 'automata-studio-machine',
      ...(options.seed !== undefined && { seed: options.seed }),
      timestamp: options.timestamp ?? new Date().toISOString(),
    },
    extensions: { 'x-legacy': legacy as unknown as JsonValue },
  };
}

function readLegacyExtension(model: MealyModel): LegacyExtension {
  const value = model.extensions?.['x-legacy'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, JsonValue>;
  const finalStates = Array.isArray(record.finalStates)
    ? record.finalStates.filter((item): item is string => typeof item === 'string') : undefined;
  const numericRecord = (candidate: JsonValue | undefined): Record<string, number> | undefined => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    return Object.fromEntries(Object.entries(candidate).filter((entry): entry is [string, number] =>
      typeof entry[1] === 'number' && Number.isSafeInteger(entry[1])));
  };
  return {
    ...(typeof record.silentOutput === 'string' && { silentOutput: record.silentOutput }),
    ...(finalStates && { finalStates }),
    ...(numericRecord(record.stateSourceLines) && { stateSourceLines: numericRecord(record.stateSourceLines) }),
    ...(numericRecord(record.transitionSourceLines) && { transitionSourceLines: numericRecord(record.transitionSourceLines) }),
  };
}

export function modelIrToMachine(value: unknown): ModelIrImportResult {
  const validation = validateModel(value);
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };
  const model: AutomataModel = validation.model;
  if (model.modelKind !== 'mealy') {
    return { ok: false, diagnostics: [{
      code: 'unsupported-model-kind',
      path: '/modelKind',
      message: `The current DSL and simulator support canonical Mealy models; received ${model.modelKind}.`,
    }] };
  }
  const legacy = readLegacyExtension(model);
  const finalStates = new Set(legacy.finalStates ?? []);
  return {
    ok: true,
    model,
    diagnostics: [],
    machine: {
      name: model.name,
      initialState: model.initial.stateId,
      inputs: model.inputAlphabet.symbols.map((symbol) => symbol.id),
      outputs: model.outputAlphabet.symbols.map((symbol) => symbol.id)
        .filter((output) => output !== legacy.silentOutput),
      states: model.states.map((state) => ({
        id: state.id,
        final: finalStates.has(state.id),
        sourceLine: legacy.stateSourceLines?.[state.id] ?? 0,
      })),
      transitions: model.transitions.map((transition) => ({
        from: transition.from,
        to: transition.to,
        input: transition.input,
        ...(transition.output !== legacy.silentOutput && { output: transition.output }),
        sourceLine: legacy.transitionSourceLines?.[transition.id] ?? 0,
      })),
    },
  };
}
