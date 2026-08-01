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
import {
  InMemoryFsmAdapter,
  runTestPlan,
  serializeTestPlan,
  transitionCoverToTestPlan,
  type TestPlan,
  type TestRunResult,
} from './testing.ts';
import { machineToModelIr, modelIrToMachine } from './model-ir-adapter.ts';
import type { MealyModel } from './model-ir.ts';

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
    <div class="header-actions"><span class="version">CORE / UI 0.4</span><button id="build" class="primary">Анализировать <kbd>Ctrl↵</kbd></button></div>
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
        <div class="panel-title"><div><span class="step">02</span><span>Спецификация</span></div><div class="editor-actions"><span id="format-badge" class="badge">DSL</span><button id="import-model" class="quiet">Импорт Model IR</button><button id="export-model" class="quiet" disabled>Экспорт Model IR</button><button id="legacy" class="quiet">Импорт .fsm</button><input id="model-file" type="file" accept="application/json,.json" hidden></div></div>
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
    <section class="panel execution-panel" aria-labelledby="execution-title">
      <div class="panel-title execution-title">
        <div><span class="step">06</span><span id="execution-title">Execution</span><span class="adapter-status"><i></i> IN-MEMORY</span></div>
        <div class="execution-actions">
          <button id="export-tests" class="quiet action-button" disabled>Экспорт JSON</button>
          <button id="run-tests" class="primary action-button" disabled>Запустить в симуляторе</button>
        </div>
      </div>
      <div id="execution-message" class="execution-message">Постройте детерминированную модель, чтобы подготовить запуск.</div>
      <div id="execution-summary" class="execution-summary" hidden>
        <div class="result-card pass"><span>PASS</span><strong id="pass-count">0</strong></div>
        <div class="result-card fail"><span>FAIL</span><strong id="fail-count">0</strong></div>
        <div class="result-card timeout"><span>TIMEOUT</span><strong id="timeout-count">0</strong></div>
        <div class="result-card duration"><span>DURATION</span><strong id="run-duration">0 ms</strong></div>
      </div>
      <div class="trace-head"><span>#</span><span>Вход</span><span>Ожидалось</span><span>Получено</span><span>Время</span><span>Verdict</span></div>
      <div id="execution-trace" class="execution-trace"><div class="empty-state">Тесты запускаются только вручную</div></div>
    </section>
  </main>
  <footer><span>TEXT</span><i></i><span>MODEL</span><i></i><span>ANALYSIS</span><i></i><span>TESTS</span><i></i><span>EXECUTION</span></footer>`;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const source = $<HTMLTextAreaElement>('#source');
const diagnostics = $<HTMLDivElement>('#diagnostics');
const graph = $<SVGSVGElement>('#graph');
const jsonOutput = $<HTMLPreElement>('#json-output');
const machineName = $<HTMLSpanElement>('#machine-name');
const analysisNode = $<HTMLDivElement>('#analysis');
const testsNode = $<HTMLDivElement>('#tests');
const executionMessage = $<HTMLDivElement>('#execution-message');
const executionSummary = $<HTMLDivElement>('#execution-summary');
const executionTrace = $<HTMLDivElement>('#execution-trace');
const runTestsButton = $<HTMLButtonElement>('#run-tests');
const exportTestsButton = $<HTMLButtonElement>('#export-tests');
let executableMachine: Machine | undefined;
let executablePlan: TestPlan | undefined;
let canonicalModel: MealyModel | undefined;
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

function setExecutionMessage(message: string, state: 'neutral' | 'error' | 'success' | 'running' = 'neutral'): void {
  executionMessage.textContent = message;
  executionMessage.className = `execution-message${state === 'neutral' ? '' : ` ${state}`}`;
}

function resetExecution(message = 'Модель изменилась. Выполните анализ, чтобы подготовить новый запуск.', error = false): void {
  executableMachine = undefined;
  executablePlan = undefined;
  runTestsButton.disabled = true;
  exportTestsButton.disabled = true;
  executionSummary.hidden = true;
  executionTrace.innerHTML = '<div class="empty-state">Тесты запускаются только вручную</div>';
  setExecutionMessage(message, error ? 'error' : 'neutral');
}

function prepareExecution(machine: Machine): void {
  const analysis = analyzeMachine(machine);
  if (!analysis.deterministic) {
    resetExecution('Симулятор пока запускает только детерминированные FSM: устраните неоднозначные переходы.', true);
    return;
  }
  const cover = generateTransitionCover(machine);
  if (!cover.tests.length) {
    resetExecution('В модели нет достижимых переходов для выполнения.', true);
    return;
  }
  const safeId = machine.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'machine';
  executableMachine = machine;
  executablePlan = transitionCoverToTestPlan(cover, {
    id: `${safeId}-transition-cover`,
    name: `${machine.name} transition cover`,
    modelId: machine.name,
    timeoutMs: 1_000,
    metadata: { adapter: 'in-memory', uiVersion: '0.3' },
  });
  runTestsButton.disabled = false;
  exportTestsButton.disabled = false;
  executionSummary.hidden = true;
  executionTrace.innerHTML = '<div class="empty-state">Готово к ручному запуску</div>';
  setExecutionMessage(`Подготовлено тестов: ${executablePlan.cases.length}. Адаптер не запущен.`, 'success');
}

function displayOutput(value: string | null | undefined): string {
  return value === null || value === undefined ? '∅' : value;
}

function downloadJson(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderExecutionResult(result: TestRunResult): void {
  $('#pass-count').textContent = String(result.counts.pass);
  $('#fail-count').textContent = String(result.counts.fail + result.counts.invalid);
  $('#timeout-count').textContent = String(result.counts.timeout);
  $('#run-duration').textContent = `${Math.max(0, result.finishedAt - result.startedAt)} ms`;
  executionSummary.hidden = false;
  const rows = result.cases.flatMap((testCase, caseIndex) => testCase.steps.map((step) => {
    const expected = step.allowedExpectedOutputs.map(displayOutput).join(' | ');
    const actual = displayOutput(step.response?.output);
    const duration = step.response?.durationMs ?? Math.max(0, step.finishedAt - step.startedAt);
    return `<div class="trace-row" title="${escapeXml(step.message ?? testCase.message ?? testCase.name)}">
      <span class="test-index">${String(caseIndex + 1).padStart(2, '0')}.${step.index + 1}</span>
      <code>${escapeXml(step.input)}</code>
      <code>${escapeXml(expected)}</code>
      <code class="actual${step.verdict === 'pass' ? '' : ' mismatch'}">${escapeXml(actual)}</code>
      <code>${duration} ms</code>
      <span class="verdict ${escapeXml(step.verdict)}">${escapeXml(step.verdict.toUpperCase())}</span>
    </div>`;
  }));
  executionTrace.innerHTML = rows.length ? rows.join('') : '<div class="empty-state">Выполнение не создало трассу шагов</div>';
  const problemCount = result.counts.fail + result.counts.timeout + result.counts.invalid + result.counts.inconclusive;
  setExecutionMessage(
    problemCount === 0
      ? `Запуск завершён: ${result.counts.pass} тестов пройдено.`
      : `Запуск завершён с проблемами: ${problemCount}. Общий verdict: ${result.verdict.toUpperCase()}.`,
    problemCount === 0 ? 'success' : 'error',
  );
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

function build(forceLegacy = false, importedCanonical?: MealyModel): void {
  const result = parseSource(forceLegacy);
  diagnostics.innerHTML = result.diagnostics.length
    ? result.diagnostics.map((item) => `<div class="diagnostic ${item.severity}"><strong>${item.severity === 'error' ? 'Ошибка' : 'Внимание'} · строка ${item.line}</strong><span>${escapeXml(item.message)}</span></div>`).join('')
    : '<div class="diagnostic success"><strong>Модель корректна</strong><span>Синтаксических и структурных ошибок не найдено.</span></div>';
  if (!result.machine) {
    graph.innerHTML = '<text class="empty" x="380" y="260">Исправьте ошибки, чтобы построить граф</text>';
    analysisNode.innerHTML = '<div class="empty-state">Анализ недоступен</div>';
    testsNode.innerHTML = '<div class="empty-state">Тесты недоступны</div>';
    canonicalModel = undefined;
    $<HTMLButtonElement>('#export-model').disabled = true;
    resetExecution('Исправьте ошибки модели — запуск и экспорт сейчас недоступны.', true);
    return;
  }
  machineName.textContent = result.machine.name;
  canonicalModel = importedCanonical ?? machineToModelIr(result.machine, {
    createdByVersion: '0.4.0',
    sourceFormat: forceLegacy ? 'legacy-fsm' : 'automata-dsl',
  });
  jsonOutput.textContent = JSON.stringify(canonicalModel, null, 2);
  $<HTMLButtonElement>('#export-model').disabled = false;
  renderGraph(result.machine);
  renderAnalysis(result.machine);
  renderTests(result.machine);
  if (!analyzeMachine(result.machine).deterministic) {
    resetExecution('Симулятор пока запускает только детерминированные FSM: устраните неоднозначные переходы.', true);
  } else if (result.diagnostics.some((item) => item.severity === 'error')) {
    resetExecution('Модель содержит ошибки. Исправьте их перед запуском симулятора.', true);
  } else {
    prepareExecution(result.machine);
  }
}

$('#build').addEventListener('click', () => build());
$('#legacy').addEventListener('click', () => build(true));
$<HTMLButtonElement>('#import-model').addEventListener('click', () => $<HTMLInputElement>('#model-file').click());
$<HTMLButtonElement>('#export-model').addEventListener('click', () => {
  if (!canonicalModel) return;
  downloadJson(`${canonicalModel.id}.model.json`, JSON.stringify(canonicalModel, null, 2));
  setExecutionMessage(`Canonical Model IR экспортирован: ${canonicalModel.id}.model.json`, 'success');
});
$<HTMLInputElement>('#model-file').addEventListener('change', async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const document = JSON.parse(await file.text()) as unknown;
    const imported = modelIrToMachine(document);
    if (!imported.ok) {
      canonicalModel = undefined;
      $<HTMLButtonElement>('#export-model').disabled = true;
      diagnostics.innerHTML = imported.diagnostics.map((item) =>
        `<div class="diagnostic error"><strong>Model IR · ${escapeXml(item.path || '/')}</strong><span>${escapeXml(item.message)}</span></div>`).join('');
      resetExecution('Model IR не импортирован: исправьте ошибки в canonical JSON.', true);
      return;
    }
    source.value = machineToDsl(imported.machine);
    build(false, imported.model);
    $('#format-badge').textContent = 'MODEL IR 1.0';
  } catch (error) {
    canonicalModel = undefined;
    $<HTMLButtonElement>('#export-model').disabled = true;
    diagnostics.innerHTML = `<div class="diagnostic error"><strong>Некорректный JSON</strong><span>${escapeXml(error instanceof Error ? error.message : String(error))}</span></div>`;
    resetExecution('Не удалось прочитать файл Model IR.', true);
  }
});
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
runTestsButton.addEventListener('click', async () => {
  if (!executableMachine || !executablePlan) return;
  runTestsButton.disabled = true;
  exportTestsButton.disabled = true;
  executionSummary.hidden = true;
  executionTrace.innerHTML = '<div class="empty-state">Выполнение тестов…</div>';
  setExecutionMessage('IN-MEMORY адаптер выполняет тест-план…', 'running');
  try {
    const result = await runTestPlan(executablePlan, new InMemoryFsmAdapter(executableMachine));
    renderExecutionResult(result);
  } catch (error) {
    executionTrace.innerHTML = '<div class="empty-state">Трасса недоступна</div>';
    setExecutionMessage(`Не удалось выполнить тесты: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    runTestsButton.disabled = !executablePlan;
    exportTestsButton.disabled = !executablePlan;
  }
});
exportTestsButton.addEventListener('click', () => {
  if (!executablePlan) return;
  const filename = `${executablePlan.id}.json`;
  downloadJson(filename, serializeTestPlan(executablePlan));
  setExecutionMessage(`Тест-план экспортирован: ${filename}`, 'success');
});
source.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') build(); });
source.addEventListener('input', () => {
  canonicalModel = undefined;
  $<HTMLButtonElement>('#export-model').disabled = true;
  resetExecution();
});
build();
