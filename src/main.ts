import './style.css';
import {
  analyzeMachine,
  generateMachine,
  generateTransitionCover,
  parseLegacyFsm,
  parseMachine,
  type GenerateMachineOptions,
  type Machine,
  type ParseResult,
} from './fsm.ts';

type TestCase = { inputs: string[]; outputs?: string[]; target?: string };

const example = `# Turnstile: input / output
machine Turnstile
state Locked
state Unlocked
initial Locked

Locked --coin / unlock--> Unlocked
Locked --push / alarm--> Locked
Unlocked --push / lock--> Locked
Unlocked --coin / return--> Unlocked`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">A</span><div><span class="eyebrow">AUTOMATA ENGINEERING WORKBENCH</span><h1>Automata Studio</h1></div></div>
    <div class="header-actions"><span class="version">CORE / UI 0.2</span><button id="build" class="primary">Анализировать <kbd>Ctrl↵</kbd></button></div>
  </header>

  <main>
    <section class="generator panel" aria-labelledby="generator-title">
      <div class="section-heading"><div><span class="step">01</span><h2 id="generator-title">Генератор модели</h2></div><p>Синтез автомата по воспроизводимым параметрам</p></div>
      <div class="generator-grid">
        <label><span>Состояния</span><input id="state-count" type="number" min="1" max="64" value="5"></label>
        <label><span>Входы</span><input id="input-count" type="number" min="1" max="32" value="2"></label>
        <label><span>Выходы</span><input id="output-count" type="number" min="1" max="32" value="2"></label>
        <label><span>Seed</span><input id="seed" type="number" value="2025"></label>
        <label class="switch-row"><input id="deterministic" type="checkbox" checked><span class="switch"></span><span>Детерминированный</span></label>
        <label class="switch-row"><input id="complete" type="checkbox" checked><span class="switch"></span><span>Полный</span></label>
        <button id="generate" class="generate-button">Сгенерировать <span>→</span></button>
      </div>
    </section>

    <section class="workspace">
      <article class="panel editor-panel">
        <div class="panel-title"><div><span class="step">02</span><span>Спецификация</span></div><div class="editor-actions"><span id="format-badge" class="badge">DSL</span><button id="legacy" class="quiet">Импорт .fsm</button></div></div>
        <textarea id="source" spellcheck="false" aria-label="Описание конечного автомата"></textarea>
        <div id="diagnostics" class="diagnostics" aria-live="polite"></div>
      </article>

      <article class="panel graph-panel">
        <div class="panel-title"><div><span class="step">03</span><span id="machine-name">Граф состояний</span></div><div class="segmented"><button id="view-graph" class="active">Граф</button><button id="view-json">JSON</button></div></div>
        <div class="graph-stage"><svg id="graph" viewBox="0 0 760 520" role="img" aria-label="Граф конечного автомата"></svg><pre id="json-output" hidden></pre></div>
      </article>
    </section>

    <section class="results-grid">
      <article class="panel analysis-panel">
        <div class="panel-title"><div><span class="step">04</span><span>Свойства модели</span></div><span id="analysis-summary" class="badge neutral">—</span></div>
        <div id="analysis" class="property-grid"><div class="empty-state">Запустите анализ модели</div></div>
      </article>
      <article class="panel tests-panel">
        <div class="panel-title"><div><span class="step">05</span><span>Transition cover</span></div><span id="test-count" class="badge neutral">0 TESTS</span></div>
        <div class="test-head"><span>#</span><span>Входная последовательность</span><span>Ожидаемые выходы</span></div>
        <div id="tests" class="test-list"><div class="empty-state">Тесты появятся после построения модели</div></div>
      </article>
    </section>
  </main>
  <footer><span>TEXT</span><i></i><span>MODEL</span><i></i><span>ANALYSIS</span><i></i><span>TESTS</span></footer>`;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const source = $<HTMLTextAreaElement>('#source');
const diagnostics = $<HTMLDivElement>('#diagnostics');
const graph = $<SVGSVGElement>('#graph');
const jsonOutput = $<HTMLPreElement>('#json-output');
const machineName = $<HTMLSpanElement>('#machine-name');
const analysisNode = $<HTMLDivElement>('#analysis');
const testsNode = $<HTMLDivElement>('#tests');
source.value = example;

function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function renderGraph(machine: Machine): void {
  if (!machine.states.length) {
    graph.innerHTML = '<text class="empty" x="380" y="260">В модели нет состояний</text>';
    return;
  }
  const centerX = 380;
  const centerY = 260;
  const radius = Math.min(192, 76 + machine.states.length * 17);
  const points = new Map(machine.states.map((state, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / machine.states.length;
    return [state.id, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }];
  }));
  const edges = machine.transitions.map((transition) => {
    const from = points.get(transition.from);
    const to = points.get(transition.to);
    if (!from || !to) return '';
    const label = escapeXml(`${transition.input}${transition.output ? ` / ${transition.output}` : ''}`);
    if (transition.from === transition.to) {
      return `<path class="edge" d="M ${from.x - 18} ${from.y - 37} C ${from.x - 67} ${from.y - 103}, ${from.x + 67} ${from.y - 103}, ${from.x + 18} ${from.y - 37}" marker-end="url(#arrow)"/><text class="edge-label" x="${from.x}" y="${from.y - 88}">${label}</text>`;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const sx = from.x + (dx / length) * 42;
    const sy = from.y + (dy / length) * 42;
    const ex = to.x - (dx / length) * 48;
    const ey = to.y - (dy / length) * 48;
    return `<line class="edge" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" marker-end="url(#arrow)"/><text class="edge-label" x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 9}">${label}</text>`;
  }).join('');
  const nodes = machine.states.map((state) => {
    const point = points.get(state.id)!;
    return `<g class="node${state.id === machine.initialState ? ' initial' : ''}"><circle cx="${point.x}" cy="${point.y}" r="39"/>${state.final ? `<circle cx="${point.x}" cy="${point.y}" r="33"/>` : ''}<text x="${point.x}" y="${point.y + 5}">${escapeXml(state.id)}</text></g>`;
  }).join('');
  graph.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>${edges}${nodes}`;
}

function machineToDsl(machine: Machine): string {
  const lines = [`machine ${machine.name}`, ...machine.states.map((state) => `${state.final ? 'final' : 'state'} ${state.id}`), `initial ${machine.initialState}`, ''];
  for (const transition of machine.transitions) lines.push(`${transition.from} --${transition.input}${transition.output !== undefined ? ` / ${transition.output}` : ''}--> ${transition.to}`);
  return lines.join('\n');
}

function normalizeTests(raw: unknown): TestCase[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { tests?: unknown }).tests) ? (raw as { tests: unknown[] }).tests : [];
  return list.map((item) => {
    if (Array.isArray(item)) return { inputs: item.map(String) };
    if (typeof item === 'string') return { inputs: item.trim() ? item.trim().split(/\s+/) : [] };
    const value = item as Record<string, unknown>;
    const inputs = value.inputs ?? value.inputTrace ?? value.inputSequence ?? value.sequence ?? [];
    const outputs = value.outputs ?? value.outputTrace ?? value.outputSequence;
    return {
      inputs: Array.isArray(inputs) ? inputs.map(String) : String(inputs).trim().split(/\s+/).filter(Boolean),
      outputs: outputs === undefined
        ? undefined
        : Array.isArray(outputs)
          ? outputs.map((output) => output === undefined ? '∅' : String(output))
          : String(outputs).trim().split(/\s+/).filter(Boolean),
      target: value.target === undefined ? undefined : String(value.target),
    };
  });
}

function renderAnalysis(machine: Machine): void {
  const data = analyzeMachine(machine);
  const labels: Record<string, string> = {
    deterministic: 'Детерминированность', complete: 'Полнота', connected: 'Связность', reachable: 'Достижимость',
    minimal: 'Минимальность', observable: 'Наблюдаемость', states: 'Состояния', stateCount: 'Состояния', transitions: 'Переходы', transitionCount: 'Переходы',
    inputs: 'Входной алфавит', outputs: 'Выходной алфавит', reachableStates: 'Достижимые состояния', unreachableStates: 'Недостижимые состояния',
  };
  const entries = Object.entries(data).filter(([, value]) => typeof value !== 'object' || Array.isArray(value));
  analysisNode.innerHTML = entries.length ? entries.map(([key, value]) => {
    const boolean = typeof value === 'boolean';
    const display = boolean ? (value ? 'YES' : 'NO') : Array.isArray(value) ? value.join(', ') || '—' : String(value);
    return `<div class="property ${boolean ? (value ? 'positive' : 'negative') : ''}"><span>${escapeXml(labels[key] ?? key.replace(/([A-Z])/g, ' $1'))}</span><strong>${escapeXml(display)}</strong><i></i></div>`;
  }).join('') : '<div class="empty-state">Нет доступных метрик</div>';
  $('#analysis-summary').textContent = `${machine.states.length} STATES · ${machine.transitions.length} EDGES`;
}

function renderTests(machine: Machine): void {
  const cover = generateTransitionCover(machine);
  const tests = normalizeTests(cover);
  $('#test-count').textContent = `${tests.length} TEST${tests.length === 1 ? '' : 'S'}`;
  const notices = cover.diagnostics.map((item) => `<div class="test-notice ${item.severity}">${escapeXml(item.message)}</div>`).join('');
  const rows = tests.length ? tests.map((test, index) => `
    <div class="test-row"><span class="test-index">${String(index + 1).padStart(2, '0')}</span>
    <code>${test.inputs.length ? test.inputs.map(escapeXml).join('<b>→</b>') : 'ε'}</code>
    <code class="outputs">${test.outputs?.length ? test.outputs.map(escapeXml).join('<b>→</b>') : '<em>—</em>'}</code></div>`).join('') : '<div class="empty-state">Transition cover не сформирован</div>';
  testsNode.innerHTML = notices + rows;
}

function parseSource(forceLegacy = false): ParseResult {
  if (forceLegacy) return parseLegacyFsm(source.value);
  const result = parseMachine(source.value);
  if (!result.machine) {
    const legacy = parseLegacyFsm(source.value);
    if (legacy.machine) {
      $('#format-badge').textContent = 'LEGACY FSM';
      return legacy;
    }
  }
  $('#format-badge').textContent = 'DSL';
  return result;
}

function build(forceLegacy = false): void {
  const result = parseSource(forceLegacy);
  diagnostics.innerHTML = result.diagnostics.length
    ? result.diagnostics.map((item) => `<div class="diagnostic ${item.severity}"><strong>${item.severity === 'error' ? 'Ошибка' : 'Внимание'} · строка ${item.line}</strong><span>${escapeXml(item.message)}</span></div>`).join('')
    : '<div class="diagnostic success"><strong>Модель корректна</strong><span>Синтаксических и структурных ошибок не найдено.</span></div>';
  if (!result.machine) {
    graph.innerHTML = '<text class="empty" x="380" y="260">Исправьте ошибки, чтобы построить граф</text>';
    analysisNode.innerHTML = '<div class="empty-state">Анализ недоступен</div>';
    testsNode.innerHTML = '<div class="empty-state">Тесты недоступны</div>';
    return;
  }
  machineName.textContent = result.machine.name;
  jsonOutput.textContent = JSON.stringify(result.machine, null, 2);
  renderGraph(result.machine);
  renderAnalysis(result.machine);
  renderTests(result.machine);
}

$('#build').addEventListener('click', () => build());
$('#legacy').addEventListener('click', () => build(true));
$('#generate').addEventListener('click', () => {
  const options: GenerateMachineOptions = {
    name: 'GeneratedFSM', stateCount: Number($<HTMLInputElement>('#state-count').value), inputCount: Number($<HTMLInputElement>('#input-count').value),
    outputCount: Number($<HTMLInputElement>('#output-count').value), seed: Number($<HTMLInputElement>('#seed').value),
    deterministic: $<HTMLInputElement>('#deterministic').checked, complete: $<HTMLInputElement>('#complete').checked,
  };
  try {
    source.value = machineToDsl(generateMachine(options));
    $('#format-badge').textContent = 'GENERATED DSL';
    build();
  } catch (error) {
    diagnostics.innerHTML = `<div class="diagnostic error"><strong>Не удалось сгенерировать модель</strong><span>${escapeXml(error instanceof Error ? error.message : error)}</span></div>`;
  }
});

function setView(showGraph: boolean): void {
  graph.toggleAttribute('hidden', !showGraph);
  jsonOutput.hidden = showGraph;
  $('#view-graph').classList.toggle('active', showGraph);
  $('#view-json').classList.toggle('active', !showGraph);
}
$('#view-graph').addEventListener('click', () => setView(true));
$('#view-json').addEventListener('click', () => setView(false));
source.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') build(); });
build();
