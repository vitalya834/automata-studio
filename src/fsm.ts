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

const identifier = /^[\p{L}\p{N}_-]+$/u;

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
        diagnostics.push({ severity: 'error', line: lineNumber, message: `Недопустимое имя «${value}». Используйте буквы, цифры, _ или -.` });
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

    diagnostics.push({ severity: 'error', line: lineNumber, message: 'Строка не распознана. Ожидается объявление или переход A --input--> B.' });
  });

  if (!name) diagnostics.push({ severity: 'error', line: 1, message: 'Добавьте имя: machine Name.' });
  if (!initialState) diagnostics.push({ severity: 'error', line: 1, message: 'Добавьте начальное состояние: initial State.' });

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
    diagnostics.push({ severity: 'error', line: 1, message: `Начальное состояние «${machine.initialState}» не существует.` });
  }

  const seen = new Map<string, Transition>();
  for (const transition of machine.transitions) {
    const key = `${transition.from}\0${transition.input}`;
    const previous = seen.get(key);
    if (previous) {
      const sameTarget = previous.to === transition.to && previous.output === transition.output;
      diagnostics.push({
        severity: sameTarget ? 'warning' : 'error',
        line: transition.sourceLine,
        message: sameTarget
          ? `Повтор перехода ${transition.from} по входу «${transition.input}».`
          : `Недетерминированность: из ${transition.from} по входу «${transition.input}» есть несколько переходов.`,
      });
    } else {
      seen.set(key, transition);
    }
  }

  const reachable = new Set<string>([machine.initialState]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of machine.transitions) {
      if (reachable.has(transition.from) && !reachable.has(transition.to)) {
        reachable.add(transition.to);
        changed = true;
      }
    }
  }
  for (const state of machine.states) {
    if (!reachable.has(state.id)) {
      diagnostics.push({ severity: 'warning', line: state.sourceLine, message: `Состояние «${state.id}» недостижимо из начального.` });
    }
  }
  return diagnostics;
}
