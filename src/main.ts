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
import { validateModel, type MealyModel, type TfsmModel, type TfsmTransition, type TimeInterval } from './model-ir.ts';
import {
  generateTimedBoundaryCases,
  runVirtualTimedCampaign,
  serializeTimedTestCases,
  type TimedCampaignResult,
  type TimedTestCase,
} from './timed-testing.ts';
import {
  onboardingJourney,
  onboardingTemplates,
  dismissOnboarding,
  isOnboardingDismissed,
  reopenOnboarding,
  resolveTemplateAction,
  templateLinkUrl,
} from './onboarding.ts';
import { journeyEnglish, readLocale, templateEnglish, writeLocale, type AppLocale } from './locale.ts';
import timedGuardExample from '../examples/models/valid/tfsm-timed-guards-door.json';
import timeoutExample from '../examples/models/valid/tfsm-password-timeout.json';
import outputDelayExample from '../examples/models/valid/tfsm-lamp-output-delay.json';
import combinedTimedExample from '../examples/models/valid/tfsm-timeout-and-linear-delay.json';
import alurDillExample from '../examples/models/valid/tfsm-alur-dill-two-clocks.json';

type TestCase = { inputs: string[]; outputs?: string[]; target?: string };

const timedExamples = new Map<string, TfsmModel>([
  ['guards', timedGuardExample as TfsmModel],
  ['timeouts', timeoutExample as TfsmModel],
  ['delays', outputDelayExample as TfsmModel],
  ['combined', combinedTimedExample as TfsmModel],
  ['alur-dill', alurDillExample as TfsmModel],
]);

const example = `# Turnstile: input / output
machine Turnstile
state Locked
state Unlocked
initial Locked

Locked --coin / unlock--> Unlocked
Locked --push / alarm--> Locked
Unlocked --push / lock--> Locked
Unlocked --coin / return--> Unlocked`;

function escapeXml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

let appLocale: AppLocale = readLocale(localStorage, navigator.language.toLowerCase().startsWith('en') ? 'en' : 'ru');
document.documentElement.dataset.locale = appLocale;
document.documentElement.lang = appLocale;

function bi(ru: string, en: string): string {
  return `<span data-lang="ru">${escapeXml(ru)}</span><span data-lang="en">${escapeXml(en)}</span>`;
}

function localText(ru: string, en: string): string {
  return appLocale === 'ru' ? ru : en;
}

function englishLinkLabel(label: string): string {
  const labels: Record<string, string> = {
    'Модель game-session.fsm': 'game-session.fsm model',
    'Генерация тестов': 'Test generation',
    'HTTP-адаптер': 'HTTP adapter',
    'План http-game.json': 'http-game.json plan',
    'Modbus-адаптер': 'Modbus adapter',
    'Конфигурация modbus-lamp.json': 'modbus-lamp.json config',
    'JSONL-датасеты': 'JSONL datasets',
    'Конфигурация http-ml-classifier.json': 'http-ml-classifier.json config',
    'Временное тестирование': 'Timed testing',
    'Модель tfsm-timed-guards-door.json': 'tfsm-timed-guards-door.json model',
    'CLI-адаптер': 'CLI adapter',
    'Эталонный SUT turnstile.cjs': 'Reference SUT turnstile.cjs',
  };
  return labels[label] ?? label;
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">A</span><div><span class="eyebrow">AUTOMATA ENGINEERING WORKBENCH</span><h1>Automata Studio</h1></div></div>
    <div class="header-actions"><span class="version">CORE 1.0 / UI 1.2</span><div class="locale-switch segmented" role="group" aria-label="Language"><button data-locale="ru">RU</button><button data-locale="en">EN</button></div><button id="reopen-tour" class="quiet tour-reopen">${bi('Обзор', 'Tour')}</button><button id="build" class="primary">${bi('Анализировать', 'Analyze')} <kbd>Ctrl↵</kbd></button></div>
  </header>

  <nav class="workspace-nav panel" aria-label="Workspace sections">
    <button data-scroll-target="onboarding-title"><span>00</span>${bi('Старт', 'Start')}</button>
    <button data-scroll-target="generator-section"><span>01</span>${bi('Модель', 'Model')}</button>
    <button data-scroll-target="timed-section"><span>T</span>${bi('Время', 'Timed')}</button>
    <button data-scroll-target="model-section"><span>02</span>${bi('Редактор', 'Editor')}</button>
    <button data-scroll-target="tests-section"><span>05</span>${bi('Тесты', 'Tests')}</button>
    <button data-scroll-target="run-section"><span>06</span>${bi('Запуск', 'Run')}</button>
  </nav>

  <main>
    ${renderOnboardingSection()}

    <section id="generator-section" class="generator panel" aria-labelledby="generator-title">
      <div class="section-heading"><div><span class="step">01</span><h2 id="generator-title">${bi('Генератор модели', 'Model generator')}</h2></div><p>${bi('Синтез автомата по воспроизводимым параметрам', 'Reproducible finite-state machine synthesis')}</p></div>
      <div class="generator-grid">
        <label><span>${bi('Состояния', 'States')}</span><input id="state-count" type="number" min="1" max="64" value="5"></label>
        <label><span>${bi('Входы', 'Inputs')}</span><input id="input-count" type="number" min="1" max="32" value="2"></label>
        <label><span>${bi('Выходы', 'Outputs')}</span><input id="output-count" type="number" min="1" max="32" value="2"></label>
        <label><span>Seed</span><input id="seed" type="number" value="2025"></label>
        <label class="switch-row"><input id="deterministic" type="checkbox" checked><span class="switch"></span><span>${bi('Детерминированный', 'Deterministic')}</span></label>
        <label class="switch-row"><input id="complete" type="checkbox" checked><span class="switch"></span><span>${bi('Полный', 'Complete')}</span></label>
        <button id="generate" class="generate-button">${bi('Сгенерировать', 'Generate')} <span>→</span></button>
      </div>
      <aside class="context-help"><strong>Generate</strong><span>${bi('Не знаете параметры? Выберите шаблон выше: он сразу построит модель и transition-cover кампанию.', 'Not sure about the parameters? Choose a template above to build a model and campaign immediately.')}</span></aside>
    </section>

    <section id="timed-section" class="panel timed-panel" aria-labelledby="timed-title">
      <div class="section-heading timed-heading">
        <div><span class="step">T</span><h2 id="timed-title">Timed Testing Workbench</h2><span class="adapter-status"><i></i> VIRTUAL TIME</span></div>
        <div class="timed-actions">
          <select id="timed-example" aria-label="Пример временного автомата">
            <option value="guards">Timed guards · Door</option>
            <option value="timeouts">Timeouts · Password</option>
            <option value="delays">Output delays · Lamp</option>
            <option value="combined">Timeout + linear delay · Session</option>
            <option value="alur-dill">Alur–Dill · Two clocks</option>
          </select>
          <button id="export-timed" class="quiet action-button">${bi('Экспорт timed-тестов', 'Export timed tests')}</button>
          <button id="run-timed" class="primary action-button">${bi('Запустить граничные тесты', 'Run boundary tests')}</button>
        </div>
      </div>
      <div class="timed-layout">
        <div class="timed-model">
          <div id="timed-metrics" class="timed-metrics"></div>
          <svg id="timed-graph" viewBox="0 0 760 360" role="img" aria-label="Граф временного автомата"></svg>
        </div>
        <div class="timed-results">
          <div id="timed-message" class="execution-message">${bi('Выберите TFSM и запустите виртуальные граничные тесты.', 'Choose a TFSM and run virtual boundary tests.')}</div>
          <div id="timed-summary" class="execution-summary" hidden>
            <div class="result-card pass"><span>PASS</span><strong id="timed-pass">0</strong></div>
            <div class="result-card fail"><span>FAIL</span><strong id="timed-fail">0</strong></div>
            <div class="result-card timeout"><span>EARLY/LATE</span><strong id="timed-violations">0</strong></div>
            <div class="result-card duration"><span>CASES</span><strong id="timed-total">0</strong></div>
          </div>
          <div id="timed-cases" class="timed-cases"></div>
        </div>
      </div>
    </section>

    <section id="model-section" class="workspace">
      <article class="panel editor-panel">
        <div class="panel-title"><div><span class="step">02</span><span>${bi('Спецификация', 'Specification')}</span></div><div class="editor-actions"><span id="format-badge" class="badge">DSL</span><button id="import-model" class="quiet">${bi('Импорт Model IR', 'Import Model IR')}</button><button id="export-model" class="quiet" disabled>${bi('Экспорт Model IR', 'Export Model IR')}</button><button id="legacy" class="quiet">${bi('Импорт .fsm', 'Import .fsm')}</button><input id="model-file" type="file" accept="application/json,.json" hidden></div></div>
        <textarea id="source" spellcheck="false" aria-label="Описание конечного автомата"></textarea>
        <div id="diagnostics" class="diagnostics" aria-live="polite"></div>
      </article>

      <article class="panel graph-panel">
        <div class="panel-title"><div><span class="step">03</span><span id="machine-name">${bi('Граф состояний', 'State graph')}</span></div><div class="segmented"><button id="view-graph" class="active">${bi('Граф', 'Graph')}</button><button id="view-json">JSON</button></div></div>
        <div class="graph-stage"><svg id="graph" viewBox="0 0 760 520" role="img" aria-label="Граф конечного автомата"></svg><pre id="json-output" hidden></pre></div>
      </article>
    </section>

    <section id="tests-section" class="results-grid">
      <article class="panel analysis-panel">
        <div class="panel-title"><div><span class="step">04</span><span>${bi('Свойства модели', 'Model properties')}</span></div><span id="analysis-summary" class="badge neutral">—</span></div>
        <div id="analysis" class="property-grid"><div class="empty-state">${bi('Запустите анализ модели', 'Analyze a model to see its properties')}</div></div>
      </article>
      <article class="panel tests-panel">
        <div class="panel-title"><div><span class="step">05</span><span>Transition cover</span></div><span id="test-count" class="badge neutral">0 TESTS</span></div>
        <div class="test-head"><span>#</span><span>${bi('Входная последовательность', 'Input sequence')}</span><span>${bi('Ожидаемые выходы', 'Expected outputs')}</span></div>
        <div id="tests" class="test-list"><div class="empty-state"><strong>${bi('Тестовая кампания пока пуста', 'The test campaign is empty')}</strong><span>${bi('Выберите шаблон или нажмите «Анализировать», чтобы построить transition cover.', 'Choose a template or click Analyze to build a transition cover.')}</span></div></div>
        <aside class="context-help compact"><strong>Generate tests</strong><span>${bi('Transition cover проходит каждый достижимый переход хотя бы один раз; random walk доступен в CLI.', 'Transition cover visits every reachable transition at least once; seeded random walk is available in the CLI.')}</span></aside>
      </article>
    </section>
    <section id="run-section" class="panel execution-panel" aria-labelledby="execution-title">
      <div class="panel-title execution-title">
        <div><span class="step">06</span><span id="execution-title">Execution</span><span class="adapter-status"><i></i> IN-MEMORY</span></div>
        <div class="execution-actions">
          <button id="export-tests" class="quiet action-button" disabled>${bi('Экспорт JSON', 'Export JSON')}</button>
          <button id="run-tests" class="primary action-button" disabled>${bi('Запустить в симуляторе', 'Run in simulator')}</button>
        </div>
      </div>
      <div id="execution-message" class="execution-message">${bi('Постройте детерминированную модель, чтобы подготовить запуск.', 'Build a deterministic model to prepare a run.')}</div>
      <div class="adapter-catalog" aria-label="Доступные SUT-адаптеры">
        <div><strong>IN-MEMORY</strong><span>${bi('Браузер · эталонная FSM', 'Browser · reference FSM')}</span></div>
        <div><strong>CLI PROCESS</strong><span>${bi('Node runner · внешние программы', 'Node runner · external programs')}</span></div>
        <div><strong>MODBUS TCP</strong><span>Node runner · FC1–FC6 · SAFE WRITES</span></div>
        <div><strong>HTTP / REST</strong><span>API · GAME SERVERS · ML INFERENCE</span></div>
      </div>
      <div id="execution-summary" class="execution-summary" hidden>
        <div class="result-card pass"><span>PASS</span><strong id="pass-count">0</strong></div>
        <div class="result-card fail"><span>FAIL</span><strong id="fail-count">0</strong></div>
        <div class="result-card timeout"><span>TIMEOUT</span><strong id="timeout-count">0</strong></div>
        <div class="result-card duration"><span>DURATION</span><strong id="run-duration">0 ms</strong></div>
      </div>
      <div class="trace-head"><span>#</span><span>${bi('Вход', 'Input')}</span><span>${bi('Ожидалось', 'Expected')}</span><span>${bi('Получено', 'Observed')}</span><span>${bi('Время', 'Time')}</span><span>Verdict</span></div>
      <div id="execution-trace" class="execution-trace"><div class="empty-state"><strong>${bi('Запуск ещё не выполнен', 'No run has been performed')}</strong><span>${bi('Загрузите шаблон, затем запустите подготовленную кампанию в симуляторе.', 'Load a template, then run the prepared campaign in the simulator.')}</span></div></div>
      <aside class="context-help report-help"><strong>Run → Report</strong><span>${bi('Браузер показывает трассу и verdict. Для реального CLI, HTTP или Modbus SUT используйте указанную в карточке команду; runner создаёт JSON, JUnit XML и автономный HTML-отчёт.', 'The browser shows a trace and verdict. For a real CLI, HTTP or Modbus SUT, use the command from its template; the runner produces JSON, JUnit XML and standalone HTML evidence.')}</span><code>npm run cli -- run plan.json --adapter … --report reports</code></aside>
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
const timedGraph = $<SVGSVGElement>('#timed-graph');
const timedMetrics = $<HTMLDivElement>('#timed-metrics');
const timedMessage = $<HTMLDivElement>('#timed-message');
const timedCasesNode = $<HTMLDivElement>('#timed-cases');
const runTimedButton = $<HTMLButtonElement>('#run-timed');
const exportTimedButton = $<HTMLButtonElement>('#export-timed');
let executableMachine: Machine | undefined;
let executablePlan: TestPlan | undefined;
let canonicalModel: MealyModel | undefined;
let currentTimedModel: TfsmModel = timedExamples.get('guards')!;
let currentTimedCases: TimedTestCase[] = [];
source.value = example;

function renderOnboardingSection(): string {
  const journey = onboardingJourney.map((step, index) => `
    <li><span class="journey-index">${index + 1}</span><div><strong>${escapeXml(step.title)}</strong><small>${bi(step.detail, journeyEnglish[index])}</small></div></li>`).join('');
  const cards = onboardingTemplates.map((template, templateIndex) => {
    const english = templateEnglish[template.id];
    const rowLabels = [['Описание', 'Description'], ['Цель', 'Target'], ['Стратегия', 'Strategy'], ['Адаптер', 'Adapter']] as const;
    const englishValues = [english.description, english.target, english.strategy, english.adapter];
    const rows = [
      ['Описание', template.description],
      ['Цель / Target', template.target],
      ['Стратегия', template.strategy],
      ['Адаптер', template.adapter],
    ].map(([, value], rowIndex) => `<div><dt>${bi(rowLabels[rowIndex][0], rowLabels[rowIndex][1])}</dt><dd>${bi(value, englishValues[rowIndex])}</dd></div>`).join('');
    const openButton = `<button class="primary open-example" data-template="${escapeXml(template.id)}">${bi('Открыть шаблон', 'Use template')}</button>`;
    const links = template.links.map((link) =>
      `<a href="${escapeXml(templateLinkUrl(link))}" target="_blank" rel="noreferrer noopener">${bi(link.label, englishLinkLabel(link.label))} ↗</a>`).join('');
    return `
    <article class="template-card" data-template-card="${escapeXml(template.id)}" aria-labelledby="template-${escapeXml(template.id)}"${templateIndex === 0 ? '' : ' hidden'}>
      <header><h3 id="template-${escapeXml(template.id)}">${escapeXml(template.title)}</h3><span class="badge neutral">${escapeXml(template.adapterBadge)}</span></header>
      <p class="template-subtitle">${bi(template.subtitle, english.subtitle)}</p>
      <dl class="template-facts">${rows}</dl>
      <div class="template-command"><code>${escapeXml(template.command)}</code><button class="quiet copy-command" data-command="${escapeXml(template.command)}">${bi('Копировать', 'Copy')}</button></div>
      <div class="template-actions">${openButton}<nav class="template-links" aria-label="Документация для ${escapeXml(template.title)}">${links}</nav></div>
    </article>`;
  }).join('');
  return `
    <section class="panel onboarding" aria-labelledby="onboarding-title">
      <div id="first-run-tour" class="tour-card" role="dialog" aria-labelledby="tour-title" hidden>
        <div><span id="tour-progress" class="badge">1 / ${onboardingJourney.length}</span><h3 id="tour-title"></h3><p id="tour-detail"></p></div>
        <div class="tour-actions"><button id="skip-tour" class="quiet">${bi('Пропустить', 'Skip')}</button><button id="next-tour" class="primary"></button></div>
      </div>
      <div class="section-heading"><div><span class="step">00</span><h2 id="onboarding-title">${bi('Начать тестирование', 'Start testing')}</h2></div><p>${bi('Шесть моделей — один клик до готовой тестовой кампании', 'Six models — one click to a ready test campaign')}</p></div>
      <ol class="journey" aria-label="Путь пользователя">${journey}</ol>
      <div class="template-picker" role="tablist" aria-label="Testing scenarios">${onboardingTemplates.map((template, index) => `<button role="tab" data-template-select="${escapeXml(template.id)}" aria-selected="${index === 0}" class="${index === 0 ? 'active' : ''}"><strong>${escapeXml(template.title)}</strong><small>${bi(template.subtitle, templateEnglish[template.id].subtitle)}</small></button>`).join('')}</div>
      <div class="template-grid">${cards}</div>
    </section>`;
}

function formatInterval(interval: TimeInterval): string {
  const left = interval.lower.inclusive ? '[' : '(';
  const right = 'value' in interval.upper ? (interval.upper.inclusive ? ']' : ')') : ')';
  const upper = 'value' in interval.upper ? interval.upper.value : '∞';
  return `${left}${interval.lower.value}, ${upper}${right}`;
}

function formatTimedTransition(transition: TfsmModel['transitions'][number]): string {
  if (!('output' in transition)) {
    const guard = transition.guard?.map((item) => `${item.clock}${item.op}${item.value}`).join(' ∧ ');
    return `${transition.input}${guard ? ` · ${guard}` : ''}${transition.resets.length ? ` · reset ${transition.resets.join(',')}` : ''}`;
  }
  const regular = transition as TfsmTransition;
  const guard = regular.timedGuard ? ` · t∈${formatInterval(regular.timedGuard)}` : '';
  const delay = regular.outputDelay?.kind === 'constant' ? ` · Δ=${regular.outputDelay.value}`
    : regular.outputDelay?.kind === 'interval' ? ` · Δ∈${formatInterval(regular.outputDelay.interval)}`
      : regular.outputDelay?.kind === 'linearFamily' ? ` · Δ=${regular.outputDelay.base}+${regular.outputDelay.slope}t` : '';
  return `${regular.input} / ${regular.output}${guard}${delay}`;
}

function renderTimedGraph(model: TfsmModel): void {
  const centerX = 380;
  const centerY = 180;
  const radius = Math.min(132, 62 + model.states.length * 18);
  const points = new Map(model.states.map((state, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / model.states.length;
    return [state.id, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }];
  }));
  const edges = model.transitions.map((transition) => {
    const from = points.get(transition.from);
    const to = points.get(transition.to);
    if (!from || !to) return '';
    const label = escapeXml(formatTimedTransition(transition));
    if (transition.from === transition.to) {
      return `<path class="edge timed-edge" d="M ${from.x - 18} ${from.y - 35} C ${from.x - 60} ${from.y - 90}, ${from.x + 60} ${from.y - 90}, ${from.x + 18} ${from.y - 35}" marker-end="url(#timed-arrow)"/><text class="edge-label timed-label" x="${from.x}" y="${from.y - 76}">${label}</text>`;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const sx = from.x + (dx / length) * 39;
    const sy = from.y + (dy / length) * 39;
    const ex = to.x - (dx / length) * 45;
    const ey = to.y - (dy / length) * 45;
    return `<line class="edge timed-edge" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" marker-end="url(#timed-arrow)"/><text class="edge-label timed-label" x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 8}">${label}</text>`;
  }).join('');
  const nodes = model.states.map((state) => {
    const point = points.get(state.id)!;
    const timeout = 'timeout' in state && state.timeout ? `timeout ${state.timeout.after}→${state.timeout.to}` : '';
    const invariant = 'invariant' in state && state.invariant?.length
      ? state.invariant.map((item) => `${item.clock}${item.op}${item.value}`).join(' ∧ ') : '';
    return `<g class="node timed-node${state.id === model.initial.stateId ? ' initial' : ''}"><circle cx="${point.x}" cy="${point.y}" r="36"/><text x="${point.x}" y="${point.y + 4}">${escapeXml(state.id)}</text>${timeout || invariant ? `<text class="state-timing" x="${point.x}" y="${point.y + 54}">${escapeXml(timeout || invariant)}</text>` : ''}</g>`;
  }).join('');
  timedGraph.innerHTML = `<defs><marker id="timed-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>${edges}${nodes}`;
}

function renderTimedCases(cases: TimedTestCase[], result?: TimedCampaignResult): void {
  const resultById = new Map(result?.cases.map((item) => [item.caseId, item]));
  timedCasesNode.innerHTML = cases.length ? cases.map((testCase, index) => {
    const caseResult = resultById.get(testCase.id);
    const last = testCase.actions.at(-1);
    const timing = last?.kind === 'input' ? `t=${last.at}` : last ? `wait→${last.until}` : '—';
    const verdict = caseResult?.verdict ?? 'pending';
    return `<div class="timed-case"><span class="test-index">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeXml(testCase.name)}</strong><small>${escapeXml(testCase.target)} · ${escapeXml(timing)} ${escapeXml(currentTimedModel.timeUnit)}</small></div><span class="verdict ${escapeXml(verdict)}">${escapeXml(verdict.toUpperCase())}</span></div>`;
  }).join('') : `<div class="empty-state">${escapeXml(localText('Для этого профиля нужен специализированный zone/region engine', 'This profile requires a dedicated zone/region engine'))}</div>`;
}

function loadTimedModel(model: TfsmModel): void {
  currentTimedModel = model;
  currentTimedCases = generateTimedBoundaryCases(model);
  renderTimedGraph(model);
  timedMetrics.innerHTML = [
    ['PROFILE', model.timingProfile], ['UNIT', model.timeUnit], ['STATES', model.states.length],
    ['EDGES', model.transitions.length], ['BOUNDARY TESTS', currentTimedCases.length],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${escapeXml(value)}</strong></div>`).join('');
  renderTimedCases(currentTimedCases);
  $<HTMLDivElement>('#timed-summary').hidden = true;
  const alurDill = model.timingProfile === 'alurDill';
  runTimedButton.disabled = alurDill;
  exportTimedButton.disabled = alurDill;
  timedMessage.className = `execution-message${alurDill ? ' error' : ' success'}`;
  timedMessage.textContent = alurDill
    ? localText('Alur–Dill модель отображена, но для исполнения требуется zone/region engine. Аппроксимация запрещена.', 'The Alur–Dill model is displayed, but execution requires a zone/region engine. Approximation is disabled.')
    : localText(`TFSM ${model.name}: подготовлено ${currentTimedCases.length} граничных тестов в ${model.timeUnit}.`, `TFSM ${model.name}: ${currentTimedCases.length} boundary tests prepared in ${model.timeUnit}.`);
}

function renderGraph(machine: Machine): void {
  if (!machine.states.length) {
    graph.innerHTML = `<text class="empty" x="380" y="260">${escapeXml(localText('В модели нет состояний', 'The model has no states'))}</text>`;
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
  const labels: Record<string, string> = appLocale === 'ru' ? {
    deterministic: 'Детерминированность', complete: 'Полнота', connected: 'Связность', reachable: 'Достижимость',
    minimal: 'Минимальность', observable: 'Наблюдаемость', states: 'Состояния', stateCount: 'Состояния', transitions: 'Переходы', transitionCount: 'Переходы',
    inputs: 'Входной алфавит', outputs: 'Выходной алфавит', reachableStates: 'Достижимые состояния', unreachableStates: 'Недостижимые состояния',
  } : {
    deterministic: 'Deterministic', complete: 'Complete', connected: 'Connected', reachable: 'Reachable',
    minimal: 'Minimal', observable: 'Observable', states: 'States', stateCount: 'States', transitions: 'Transitions', transitionCount: 'Transitions',
    inputs: 'Input alphabet', outputs: 'Output alphabet', reachableStates: 'Reachable states', unreachableStates: 'Unreachable states',
  };
  const entries = Object.entries(data).filter(([, value]) => typeof value !== 'object' || Array.isArray(value));
  analysisNode.innerHTML = entries.length ? entries.map(([key, value]) => {
    const boolean = typeof value === 'boolean';
    const display = boolean ? (value ? 'YES' : 'NO') : Array.isArray(value) ? value.join(', ') || '—' : String(value);
    return `<div class="property ${boolean ? (value ? 'positive' : 'negative') : ''}"><span>${escapeXml(labels[key] ?? key.replace(/([A-Z])/g, ' $1'))}</span><strong>${escapeXml(display)}</strong><i></i></div>`;
  }).join('') : `<div class="empty-state">${escapeXml(localText('Нет доступных метрик', 'No metrics are available'))}</div>`;
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
    <code class="outputs">${test.outputs?.length ? test.outputs.map(escapeXml).join('<b>→</b>') : '<em>—</em>'}</code></div>`).join('') : `<div class="empty-state">${escapeXml(localText('Transition cover не сформирован', 'Transition cover was not generated'))}</div>`;
  testsNode.innerHTML = notices + rows;
}

function setExecutionMessage(message: string, state: 'neutral' | 'error' | 'success' | 'running' = 'neutral'): void {
  executionMessage.textContent = message;
  executionMessage.className = `execution-message${state === 'neutral' ? '' : ` ${state}`}`;
}

function resetExecution(message?: string, error = false): void {
  executableMachine = undefined;
  executablePlan = undefined;
  runTestsButton.disabled = true;
  exportTestsButton.disabled = true;
  executionSummary.hidden = true;
  executionTrace.innerHTML = `<div class="empty-state">${escapeXml(localText('Тесты запускаются только вручную', 'Tests run only when started manually'))}</div>`;
  setExecutionMessage(message ?? localText('Модель изменилась. Выполните анализ, чтобы подготовить новый запуск.', 'The model changed. Analyze it to prepare a new run.'), error ? 'error' : 'neutral');
}

function prepareExecution(machine: Machine): void {
  const analysis = analyzeMachine(machine);
  if (!analysis.deterministic) {
    resetExecution(localText('Симулятор пока запускает только детерминированные FSM: устраните неоднозначные переходы.', 'The simulator currently runs deterministic FSMs only; remove ambiguous transitions.'), true);
    return;
  }
  const cover = generateTransitionCover(machine);
  if (!cover.tests.length) {
    resetExecution(localText('В модели нет достижимых переходов для выполнения.', 'The model has no reachable transitions to execute.'), true);
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
  executionTrace.innerHTML = `<div class="empty-state">${escapeXml(localText('Готово к ручному запуску', 'Ready for a manual run'))}</div>`;
  setExecutionMessage(localText(`Подготовлено тестов: ${executablePlan.cases.length}. Адаптер не запущен.`, `${executablePlan.cases.length} tests prepared. The adapter has not started.`), 'success');
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
  executionTrace.innerHTML = rows.length ? rows.join('') : `<div class="empty-state">${escapeXml(localText('Выполнение не создало трассу шагов', 'The run did not produce a step trace'))}</div>`;
  const problemCount = result.counts.fail + result.counts.timeout + result.counts.invalid + result.counts.inconclusive;
  setExecutionMessage(
    problemCount === 0
      ? localText(`Запуск завершён: ${result.counts.pass} тестов пройдено.`, `Run complete: ${result.counts.pass} tests passed.`)
      : localText(`Запуск завершён с проблемами: ${problemCount}. Общий verdict: ${result.verdict.toUpperCase()}.`, `Run completed with ${problemCount} problems. Overall verdict: ${result.verdict.toUpperCase()}.`),
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
    ? result.diagnostics.map((item) => `<div class="diagnostic ${item.severity}"><strong>${escapeXml(item.severity === 'error' ? localText('Ошибка', 'Error') : localText('Внимание', 'Warning'))} · ${escapeXml(localText('строка', 'line'))} ${item.line}</strong><span>${escapeXml(item.message)}</span></div>`).join('')
    : `<div class="diagnostic success"><strong>${escapeXml(localText('Модель корректна', 'Model is valid'))}</strong><span>${escapeXml(localText('Синтаксических и структурных ошибок не найдено.', 'No syntax or structural errors were found.'))}</span></div>`;
  if (!result.machine) {
    graph.innerHTML = `<text class="empty" x="380" y="260">${escapeXml(localText('Исправьте ошибки, чтобы построить граф', 'Fix the errors to build the graph'))}</text>`;
    analysisNode.innerHTML = `<div class="empty-state">${escapeXml(localText('Анализ недоступен', 'Analysis is unavailable'))}</div>`;
    testsNode.innerHTML = `<div class="empty-state">${escapeXml(localText('Тесты недоступны', 'Tests are unavailable'))}</div>`;
    canonicalModel = undefined;
    $<HTMLButtonElement>('#export-model').disabled = true;
    resetExecution(localText('Исправьте ошибки модели — запуск и экспорт сейчас недоступны.', 'Fix the model errors; run and export are currently unavailable.'), true);
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
    resetExecution(localText('Симулятор пока запускает только детерминированные FSM: устраните неоднозначные переходы.', 'The simulator currently runs deterministic FSMs only; remove ambiguous transitions.'), true);
  } else if (result.diagnostics.some((item) => item.severity === 'error')) {
    resetExecution(localText('Модель содержит ошибки. Исправьте их перед запуском симулятора.', 'The model contains errors. Fix them before running the simulator.'), true);
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
  setExecutionMessage(localText(`Canonical Model IR экспортирован: ${canonicalModel.id}.model.json`, `Canonical Model IR exported: ${canonicalModel.id}.model.json`), 'success');
});
$<HTMLInputElement>('#model-file').addEventListener('change', async (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const document = JSON.parse(await file.text()) as unknown;
    const canonical = validateModel(document);
    if (canonical.ok && canonical.model.modelKind === 'tfsm') {
      loadTimedModel(canonical.model);
      $<HTMLSelectElement>('#timed-example').value = '';
      diagnostics.innerHTML = `<div class="diagnostic success"><strong>${escapeXml(localText('TFSM импортирован', 'TFSM imported'))}</strong><span>${escapeXml(localText('Временная модель загружена в Timed Testing Workbench.', 'The timed model was loaded into the Timed Testing Workbench.'))}</span></div>`;
      return;
    }
    const imported = modelIrToMachine(document);
    if (!imported.ok) {
      canonicalModel = undefined;
      $<HTMLButtonElement>('#export-model').disabled = true;
      diagnostics.innerHTML = imported.diagnostics.map((item) =>
        `<div class="diagnostic error"><strong>Model IR · ${escapeXml(item.path || '/')}</strong><span>${escapeXml(item.message)}</span></div>`).join('');
      resetExecution(localText('Model IR не импортирован: исправьте ошибки в canonical JSON.', 'Model IR was not imported; fix the canonical JSON errors.'), true);
      return;
    }
    source.value = machineToDsl(imported.machine);
    build(false, imported.model);
    $('#format-badge').textContent = 'MODEL IR 1.0';
  } catch (error) {
    canonicalModel = undefined;
    $<HTMLButtonElement>('#export-model').disabled = true;
    diagnostics.innerHTML = `<div class="diagnostic error"><strong>${escapeXml(localText('Некорректный JSON', 'Invalid JSON'))}</strong><span>${escapeXml(error instanceof Error ? error.message : String(error))}</span></div>`;
    resetExecution(localText('Не удалось прочитать файл Model IR.', 'Could not read the Model IR file.'), true);
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
    diagnostics.innerHTML = `<div class="diagnostic error"><strong>${escapeXml(localText('Не удалось сгенерировать модель', 'Could not generate the model'))}</strong><span>${escapeXml(error instanceof Error ? error.message : error)}</span></div>`;
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
  executionTrace.innerHTML = `<div class="empty-state">${escapeXml(localText('Выполнение тестов…', 'Running tests…'))}</div>`;
  setExecutionMessage(localText('IN-MEMORY адаптер выполняет тест-план…', 'The IN-MEMORY adapter is executing the test plan…'), 'running');
  try {
    const result = await runTestPlan(executablePlan, new InMemoryFsmAdapter(executableMachine));
    renderExecutionResult(result);
  } catch (error) {
    executionTrace.innerHTML = `<div class="empty-state">${escapeXml(localText('Трасса недоступна', 'Trace is unavailable'))}</div>`;
    setExecutionMessage(localText(`Не удалось выполнить тесты: ${error instanceof Error ? error.message : String(error)}`, `Could not run tests: ${error instanceof Error ? error.message : String(error)}`), 'error');
  } finally {
    runTestsButton.disabled = !executablePlan;
    exportTestsButton.disabled = !executablePlan;
  }
});
exportTestsButton.addEventListener('click', () => {
  if (!executablePlan) return;
  const filename = `${executablePlan.id}.json`;
  downloadJson(filename, serializeTestPlan(executablePlan));
  setExecutionMessage(localText(`Тест-план экспортирован: ${filename}`, `Test plan exported: ${filename}`), 'success');
});
$<HTMLSelectElement>('#timed-example').addEventListener('change', (event) => {
  const model = timedExamples.get((event.currentTarget as HTMLSelectElement).value);
  if (model) loadTimedModel(model);
});
runTimedButton.addEventListener('click', () => {
  const result = runVirtualTimedCampaign(currentTimedModel, currentTimedCases);
  $('#timed-pass').textContent = String(result.counts.pass);
  $('#timed-fail').textContent = String(result.counts.fail + result.counts.invalid + result.counts.timeout);
  $('#timed-violations').textContent = String(result.counts.early + result.counts.late);
  $('#timed-total').textContent = String(result.cases.length);
  $<HTMLDivElement>('#timed-summary').hidden = false;
  renderTimedCases(currentTimedCases, result);
  timedMessage.className = `execution-message ${result.verdict === 'pass' ? 'success' : 'error'}`;
  timedMessage.textContent = result.verdict === 'pass'
    ? `Virtual-time campaign: ${result.counts.pass}/${result.cases.length} boundary tests passed.`
    : localText(`Timed campaign завершён с verdict ${result.verdict.toUpperCase()}.`, `Timed campaign completed with verdict ${result.verdict.toUpperCase()}.`);
});
exportTimedButton.addEventListener('click', () => {
  const filename = `${currentTimedModel.id}.timed-tests.json`;
  downloadJson(filename, serializeTimedTestCases(currentTimedModel, currentTimedCases));
  timedMessage.className = 'execution-message success';
  timedMessage.textContent = localText(`Timed boundary tests экспортированы: ${filename}`, `Timed boundary tests exported: ${filename}`);
});
$<HTMLElement>('.onboarding').addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target : undefined;
  const selectButton = target?.closest<HTMLButtonElement>('[data-template-select]');
  if (selectButton?.dataset.templateSelect) {
    document.querySelectorAll<HTMLButtonElement>('[data-template-select]').forEach((button) => {
      const active = button === selectButton;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll<HTMLElement>('[data-template-card]').forEach((card) => {
      card.hidden = card.dataset.templateCard !== selectButton.dataset.templateSelect;
    });
    return;
  }
  const openButton = target?.closest<HTMLButtonElement>('.open-example');
  if (openButton?.dataset.template) {
    const action = resolveTemplateAction(openButton.dataset.template);
    if (!action) return;
    if (action.model.modelKind === 'tfsm') {
      loadTimedModel(action.model);
      $<HTMLSelectElement>('#timed-example').value = '';
      $<HTMLElement>('.timed-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (action.model.modelKind === 'mealy') {
      const imported = modelIrToMachine(action.model);
      if (!imported.ok) return;
      source.value = machineToDsl(imported.machine);
      build(false, imported.model);
      $('#format-badge').textContent = 'TEMPLATE · MODEL IR 1.0';
      $<HTMLElement>('.editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
  const copyButton = target?.closest<HTMLButtonElement>('.copy-command');
  if (copyButton?.dataset.command) {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.command);
      copyButton.textContent = appLocale === 'ru' ? 'Скопировано' : 'Copied';
    } catch {
      copyButton.textContent = 'Ctrl+C';
    }
    window.setTimeout(() => { copyButton.textContent = appLocale === 'ru' ? 'Копировать' : 'Copy'; }, 1_500);
  }
});

let tourStep = 0;
const tour = $<HTMLElement>('#first-run-tour');
const tourTitle = $<HTMLElement>('#tour-title');
const tourDetail = $<HTMLElement>('#tour-detail');
const tourProgress = $<HTMLElement>('#tour-progress');
const nextTourButton = $<HTMLButtonElement>('#next-tour');

function setAppLocale(locale: AppLocale): void {
  appLocale = locale;
  document.documentElement.dataset.locale = locale;
  document.documentElement.lang = locale;
  writeLocale(localStorage, locale);
  document.querySelectorAll<HTMLButtonElement>('[data-locale]').forEach((button) => {
    button.classList.toggle('active', button.dataset.locale === locale);
    button.setAttribute('aria-pressed', String(button.dataset.locale === locale));
  });
  $<HTMLSelectElement>('#timed-example').setAttribute('aria-label', localText('Пример временного автомата', 'Timed automaton example'));
  timedGraph.setAttribute('aria-label', localText('Граф временного автомата', 'Timed automaton graph'));
  source.setAttribute('aria-label', localText('Описание конечного автомата', 'Finite-state machine specification'));
  graph.setAttribute('aria-label', localText('Граф конечного автомата', 'Finite-state machine graph'));
  $<HTMLOListElement>('.journey').setAttribute('aria-label', localText('Путь пользователя', 'User journey'));
  $<HTMLDivElement>('.adapter-catalog').setAttribute('aria-label', localText('Доступные SUT-адаптеры', 'Available SUT adapters'));
  document.querySelectorAll<HTMLElement>('.template-links').forEach((links) => {
    const templateTitle = links.closest<HTMLElement>('[data-template-card]')?.querySelector('h3')?.textContent ?? '';
    links.setAttribute('aria-label', localText(`Документация для ${templateTitle}`, `Documentation for ${templateTitle}`));
  });
  loadTimedModel(currentTimedModel);
  build();
  renderTourStep();
}

function renderTourStep(): void {
  const step = onboardingJourney[tourStep];
  tourTitle.textContent = `${step.title}: ${appLocale === 'ru' ? step.detail : journeyEnglish[tourStep]}`;
  const tourDetailsEn = [
    'Start with one of six validated models — no manual JSON is required.',
    'Automata Studio builds transition-cover tests and expected outputs automatically.',
    'Run in the browser or connect CLI, HTTP and Modbus systems through the Node runner.',
    'Review the trace and verdict, then export JSON, JUnit XML or standalone HTML evidence.',
  ];
  tourDetail.textContent = tourStep === 0
    ? 'Начните с одной из шести проверенных моделей ниже — писать JSON вручную не нужно.'
    : tourStep === 1
      ? 'Automata Studio автоматически строит transition-cover тесты и ожидаемые выходы.'
      : tourStep === 2
        ? 'Запустите модель в браузере или подключите CLI, HTTP и Modbus через Node runner.'
        : 'Изучите трассу и verdict; для CI экспортируйте JSON, JUnit XML или HTML evidence.';
  if (appLocale === 'en') tourDetail.textContent = tourDetailsEn[tourStep];
  tourProgress.textContent = `${tourStep + 1} / ${onboardingJourney.length}`;
  nextTourButton.textContent = tourStep === onboardingJourney.length - 1
    ? (appLocale === 'ru' ? 'Начать' : 'Start')
    : (appLocale === 'ru' ? 'Далее' : 'Next');
}

function setTourVisible(visible: boolean): void {
  tour.hidden = !visible;
  if (visible) {
    tourStep = 0;
    renderTourStep();
    tour.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

nextTourButton.addEventListener('click', () => {
  if (tourStep < onboardingJourney.length - 1) {
    tourStep += 1;
    renderTourStep();
    return;
  }
  dismissOnboarding(window.localStorage);
  setTourVisible(false);
});
$<HTMLButtonElement>('#skip-tour').addEventListener('click', () => {
  dismissOnboarding(window.localStorage);
  setTourVisible(false);
});
$<HTMLButtonElement>('#reopen-tour').addEventListener('click', () => {
  reopenOnboarding(window.localStorage);
  setTourVisible(true);
});
document.querySelectorAll<HTMLButtonElement>('[data-locale]').forEach((button) => {
  button.addEventListener('click', () => setAppLocale(button.dataset.locale as AppLocale));
});
document.querySelectorAll<HTMLButtonElement>('[data-scroll-target]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.scrollTarget!)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
});
source.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') build(); });
source.addEventListener('input', () => {
  canonicalModel = undefined;
  $<HTMLButtonElement>('#export-model').disabled = true;
  resetExecution();
});
setAppLocale(appLocale);
setTourVisible(!isOnboardingDismissed(window.localStorage));
