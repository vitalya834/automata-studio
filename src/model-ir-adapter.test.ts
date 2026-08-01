import { describe, expect, it } from 'vitest';
import type { Machine } from './fsm';
import { machineToModelIr, modelIrToMachine } from './model-ir-adapter';
import { validateModel } from './model-ir';

const machine: Machine = {
  name: 'Door Controller',
  initialState: 'closed',
  inputs: ['open', 'close'],
  outputs: ['opened'],
  states: [
    { id: 'closed', final: false, sourceLine: 2 },
    { id: 'open', final: true, sourceLine: 3 },
  ],
  transitions: [
    { from: 'closed', to: 'open', input: 'open', output: 'opened', sourceLine: 6 },
    { from: 'open', to: 'closed', input: 'close', sourceLine: 7 },
  ],
};

describe('Machine ↔ canonical Model IR', () => {
  it('exports a valid Mealy Model IR with an exact semantic profile', () => {
    const model = machineToModelIr(machine, { timestamp: '2026-08-01T10:00:00Z', seed: 42 });
    expect(model.id).toBe('Door-Controller');
    expect(model.semanticProfile).toBe('deterministic.partial');
    expect(model.provenance.seed).toBe(42);
    expect(validateModel(model).ok).toBe(true);
  });

  it('round-trips silent outputs, final states, alphabets and source lines', () => {
    const model = machineToModelIr(machine, { timestamp: '2026-08-01T10:00:00Z' });
    const imported = modelIrToMachine(JSON.parse(JSON.stringify(model)) as unknown);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.machine).toEqual(machine);
  });

  it('chooses a collision-free reserved silent symbol', () => {
    const model = machineToModelIr({ ...machine, outputs: ['opened', '__silent__'] }, {
      timestamp: '2026-08-01T10:00:00Z',
    });
    expect(model.transitions[1].output).toBe('__silent___2');
    expect(model.outputAlphabet.symbols.map((symbol) => symbol.id)).toContain('__silent___2');
  });

  it('returns validator diagnostics for malformed documents', () => {
    const imported = modelIrToMachine({ schemaVersion: '2.0' });
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.diagnostics.length).toBeGreaterThan(0);
  });

  it('explicitly refuses unsupported canonical model kinds', () => {
    const mealy = machineToModelIr(machine, { timestamp: '2026-08-01T10:00:00Z' });
    const moore = {
      ...mealy,
      modelKind: 'moore',
      states: mealy.states.map((state) => ({ ...state, output: 'opened' })),
      transitions: mealy.transitions.map(({ output: _output, ...transition }) => transition),
    };
    const imported = modelIrToMachine(moore);
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.diagnostics[0].code).toBe('unsupported-model-kind');
  });
});
