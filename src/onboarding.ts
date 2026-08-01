/**
 * Onboarding template gallery: a typed catalog of ready-made testing
 * scenarios for people who open the product for the first time.
 *
 * The catalog and selection logic live here, outside src/main.ts, so they can
 * be unit-tested without a DOM. Cards never promise unsupported behaviour:
 * scenarios the browser can execute carry a `load-*` action, scenarios that
 * need the Node runner carry a real command plus links to existing docs.
 */

import gameSessionFsm from '../examples/game-session.fsm?raw';

/** Identifier of a bundled TFSM example in the Timed Testing Workbench. */
export type TimedExampleId = 'guards' | 'timeouts' | 'delays' | 'combined' | 'alur-dill';

/** What the "Open example" button does for a template. */
export type TemplateAction =
  | { kind: 'load-dsl'; source: string; formatBadge: string }
  | { kind: 'load-timed'; exampleId: TimedExampleId }
  | { kind: 'commands-only' };

export type TemplateLink = {
  label: string;
  /** Repository-relative path; must point at an existing file. */
  path: string;
};

export type OnboardingTemplate = {
  id: 'game' | 'rest-api' | 'modbus' | 'ml-inference' | 'timed' | 'cli';
  /** Short English product term, shown as the card title. */
  title: string;
  /** One-line Russian subtitle. */
  subtitle: string;
  /** Что тестируется. */
  what: string;
  /** Какие состояния использует модель. */
  states: string;
  /** Какие входы использует модель. */
  inputs: string;
  /** Какие выходы использует модель. */
  outputs: string;
  /** Какой адаптер нужен. */
  adapter: string;
  /** Короткая метка адаптера для бейджа. */
  adapterBadge: string;
  /** Какую команду выполнить (реальный npm-скрипт или CLI-вызов). */
  command: string;
  /** Ссылки на существующие examples/docs. */
  links: readonly TemplateLink[];
  action: TemplateAction;
};

const REPO_URL = 'https://github.com/vitalya834/automata-studio/blob/main';

/** Absolute URL for a repository-relative documentation/example path. */
export function templateLinkUrl(link: TemplateLink): string {
  return `${REPO_URL}/${link.path}`;
}

export const onboardingTemplates: readonly OnboardingTemplate[] = [
  {
    id: 'game',
    title: 'Game state machine',
    subtitle: 'Игровая сессия: меню, игра, пауза, победа',
    what: 'Логика игровых состояний: корректные переходы между меню, игрой, паузой и победой.',
    states: 'menu, playing, paused, victory',
    inputs: 'start, pause, resume, win',
    outputs: 'playing, paused, victory',
    adapter: 'IN-MEMORY в браузере; тот же план исполняется HTTP-адаптером против реального игрового сервера.',
    adapterBadge: 'IN-MEMORY / HTTP',
    command: 'npm run cli -- generate examples/game-session.fsm --strategy transition-cover --output game-plan.json',
    links: [
      { label: 'Модель game-session.fsm', path: 'examples/game-session.fsm' },
      { label: 'Генерация тестов', path: 'docs/TEST-GENERATION.md' },
    ],
    action: { kind: 'load-dsl', source: gameSessionFsm, formatBadge: 'DSL' },
  },
  {
    id: 'rest-api',
    title: 'REST API',
    subtitle: 'Веб-API и игровой сервер по HTTP',
    what: 'Поведение REST-сервиса: start, pause, resume и victory настоящего loopback-сервера.',
    states: 'menu, playing, paused, victory (модель GameSession)',
    inputs: 'start, pause, resume, win → HTTP-запросы из конфигурации адаптера',
    outputs: 'playing, paused, victory — из JSON-ответов сервиса',
    adapter: 'HTTP/REST-адаптер (Node runner): same-origin, без redirect, ограниченный ответ.',
    adapterBadge: 'HTTP / REST',
    command: 'npm run demo:http',
    links: [
      { label: 'HTTP-адаптер', path: 'docs/adapters/HTTP.md' },
      { label: 'План http-game.json', path: 'examples/test-plans/http-game.json' },
    ],
    action: { kind: 'commands-only' },
  },
  {
    id: 'modbus',
    title: 'Modbus TCP device',
    subtitle: 'Устройство или симулятор по Modbus TCP',
    what: 'Поведение устройства: состояние лампы читается из coil-регистра и сверяется с моделью (FC1–FC6).',
    states: 'lamp_off, lamp_on',
    inputs: 'read_lamp → readCoils, address 10 (типизированная Modbus-операция)',
    outputs: 'lamp_on, lamp_off — предикаты над прочитанными значениями',
    adapter: 'Modbus TCP-адаптер (Node runner): MBAP-корреляция, записи только при явном allowWrites: true.',
    adapterBadge: 'MODBUS TCP',
    command: 'npm run demo:modbus',
    links: [
      { label: 'Modbus-адаптер', path: 'docs/adapters/MODBUS-TCP.md' },
      { label: 'Конфигурация modbus-lamp.json', path: 'examples/adapters/modbus-lamp.json' },
    ],
    action: { kind: 'commands-only' },
  },
  {
    id: 'ml-inference',
    title: 'ML inference service',
    subtitle: 'Поведение ML-сервиса инференса',
    what: 'Поведенческий контракт сервиса инференса: эталонные примеры дают ожидаемые метки классов.',
    states: 'serving (контракт BinaryClassifierApi)',
    inputs: 'predict_positive, predict_negative → POST /v1/predict с фиксированными признаками',
    outputs: 'positive, negative — метка из JSON-ответа (JSON Pointer /prediction/label)',
    adapter: 'HTTP/REST-адаптер (Node runner); поведенческий контракт, не статистическое качество модели.',
    adapterBadge: 'HTTP / ML',
    command: 'npm run cli -- run examples/test-plans/http-ml-classifier.json --adapter http --config examples/adapters/http-ml-classifier.json',
    links: [
      { label: 'HTTP-адаптер', path: 'docs/adapters/HTTP.md' },
      { label: 'JSONL-датасеты', path: 'docs/DATASET-GENERATION.md' },
      { label: 'Конфигурация http-ml-classifier.json', path: 'examples/adapters/http-ml-classifier.json' },
    ],
    action: { kind: 'commands-only' },
  },
  {
    id: 'timed',
    title: 'Timed controller',
    subtitle: 'Контроллер с таймаутом ввода пароля',
    what: 'Временное поведение: приглашение к вводу пароля возвращается в idle после 30 с тишины.',
    states: 'idle, waiting (timeout 30 → idle), authorized',
    inputs: 'request, password + виртуальное время',
    outputs: 'prompt, granted',
    adapter: 'Timed Testing Workbench в браузере: граничные тесты в виртуальном времени.',
    adapterBadge: 'VIRTUAL TIME',
    command: 'npm run dev',
    links: [
      { label: 'Временное тестирование', path: 'docs/TIMED-TESTING.md' },
      { label: 'Модель tfsm-password-timeout.json', path: 'examples/models/valid/tfsm-password-timeout.json' },
    ],
    action: { kind: 'load-timed', exampleId: 'timeouts' },
  },
  {
    id: 'cli',
    title: 'CLI application',
    subtitle: 'Внешняя программа через stdin/stdout',
    what: 'Поведение консольной программы: турникет отвечает на монету и толчок по JSON Lines-протоколу.',
    states: 'locked, unlocked',
    inputs: 'coin, push',
    outputs: 'unlock, lock, none',
    adapter: 'CLI-process-адаптер (Node runner): запуск без shell, environment-allowlist.',
    adapterBadge: 'CLI PROCESS',
    command: 'npm run demo:cli',
    links: [
      { label: 'CLI-адаптер', path: 'docs/adapters/CLI-PROCESS.md' },
      { label: 'Эталонный SUT turnstile.cjs', path: 'test-fixtures/cli-sut/turnstile.cjs' },
      { label: 'Runner CLI', path: 'docs/RUNNER-CLI.md' },
    ],
    action: { kind: 'commands-only' },
  },
];

export function getTemplate(id: string): OnboardingTemplate | undefined {
  return onboardingTemplates.find((template) => template.id === id);
}

/**
 * Resolve the action for a template id. Unknown ids resolve to undefined so
 * the UI can ignore stray clicks instead of crashing.
 */
export function resolveTemplateAction(id: string): TemplateAction | undefined {
  return getTemplate(id)?.action;
}

export type JourneyStep = {
  title: string;
  detail: string;
};

/** Короткий путь пользователя от шаблона до отчёта. */
export const onboardingJourney: readonly JourneyStep[] = [
  { title: 'Choose template', detail: 'Выберите готовый сценарий' },
  { title: 'Inspect graph', detail: 'Проверьте граф и свойства модели' },
  { title: 'Generate tests', detail: 'Постройте transition cover или random walk' },
  { title: 'Run adapter', detail: 'Запустите план в симуляторе или через Node runner' },
  { title: 'Inspect report', detail: 'Изучите трассу, JUnit и HTML-отчёты' },
];
