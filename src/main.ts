import './style.css';
import { parseMachine, type Machine } from './fsm.ts';

const example = `# Турникет: вход / выход
machine Turnstile
state Locked
state Unlocked
initial Locked

Locked --coin / unlock--> Unlocked
Locked --push / alarm--> Locked
Unlocked --push / lock--> Locked
Unlocked --coin / return--> Unlocked`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header>
    <div><span class="eyebrow">FINITE STATE LAB</span><h1>FSM Generator</h1></div>
    <button id="build">Построить граф <kbd>Ctrl↵</kbd></button>
  </header>
  <section class="workspace">
    <article class="panel editor-panel">
      <div class="panel-title"><span>Описание автомата</span><span class="status">DSL draft 0.1</span></div>
      <textarea id="source" spellcheck="false" aria-label="Описание FSM"></textarea>
      <div id="diagnostics" class="diagnostics"></div>
    </article>
    <article class="panel graph-panel">
      <div class="panel-title"><span id="machine-name">Граф состояний</span><button id="json" class="quiet">JSON</button></div>
      <svg id="graph" viewBox="0 0 760 520" role="img" aria-label="Граф конечного автомата"></svg>
      <pre id="json-output" hidden></pre>
    </article>
  </section>
  <footer>Текст → модель → проверка → граф</footer>`;

const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const diagnostics = document.querySelector<HTMLDivElement>('#diagnostics')!;
const graph = document.querySelector<SVGSVGElement>('#graph')!;
const jsonOutput = document.querySelector<HTMLPreElement>('#json-output')!;
const machineName = document.querySelector<HTMLSpanElement>('#machine-name')!;
source.value = example;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

function renderGraph(machine: Machine): void {
  const centerX = 380;
  const centerY = 260;
  const radius = Math.min(180, 65 + machine.states.length * 20);
  const points = new Map(machine.states.map((state, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / machine.states.length;
    return [state.id, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }];
  }));

  const edges = machine.transitions.map((transition) => {
    const from = points.get(transition.from)!;
    const to = points.get(transition.to)!;
    const label = escapeXml(`${transition.input}${transition.output ? ` / ${transition.output}` : ''}`);
    if (transition.from === transition.to) {
      return `<path class="edge" d="M ${from.x - 18} ${from.y - 38} C ${from.x - 68} ${from.y - 105}, ${from.x + 68} ${from.y - 105}, ${from.x + 18} ${from.y - 38}" marker-end="url(#arrow)"/><text class="edge-label" x="${from.x}" y="${from.y - 92}">${label}</text>`;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const sx = from.x + (dx / length) * 43;
    const sy = from.y + (dy / length) * 43;
    const ex = to.x - (dx / length) * 48;
    const ey = to.y - (dy / length) * 48;
    return `<line class="edge" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" marker-end="url(#arrow)"/><text class="edge-label" x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 8}">${label}</text>`;
  }).join('');

  const nodes = machine.states.map((state) => {
    const point = points.get(state.id)!;
    const initial = state.id === machine.initialState ? ' initial' : '';
    return `<g class="node${initial}"><circle cx="${point.x}" cy="${point.y}" r="40"/>${state.final ? `<circle cx="${point.x}" cy="${point.y}" r="34"/>` : ''}<text x="${point.x}" y="${point.y + 5}">${escapeXml(state.id)}</text></g>`;
  }).join('');

  graph.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges}${nodes}`;
}

function build(): void {
  const result = parseMachine(source.value);
  diagnostics.innerHTML = result.diagnostics.length
    ? result.diagnostics.map((item) => `<div class="diagnostic ${item.severity}"><strong>${item.severity === 'error' ? 'Ошибка' : 'Внимание'} · строка ${item.line}</strong>${escapeXml(item.message)}</div>`).join('')
    : '<div class="diagnostic success"><strong>Готово</strong>Ошибок не найдено.</div>';
  if (!result.machine) {
    graph.innerHTML = '<text class="empty" x="380" y="260">Исправьте ошибки, чтобы построить граф</text>';
    return;
  }
  machineName.textContent = result.machine.name;
  jsonOutput.textContent = JSON.stringify(result.machine, null, 2);
  renderGraph(result.machine);
}

document.querySelector('#build')!.addEventListener('click', build);
document.querySelector('#json')!.addEventListener('click', () => {
  const showJson = jsonOutput.hidden;
  jsonOutput.hidden = !showJson;
  graph.toggleAttribute('hidden', showJson);
});
source.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === 'Enter') build();
});
build();
