/**
 * Onboarding template gallery: a typed catalog of ready-made testing
 * scenarios for people who open the product for the first time.
 *
 * The catalog and selection logic live here, outside src/main.ts, so they can
 * be unit-tested without a DOM. Every card loads a canonical model in the
 * browser; cards that can also target a real SUT expose a runner command and
 * links to the matching adapter documentation.
 */

import type { AutomataModel } from './model-ir.ts';
import gameModel from '../examples/models/valid/template-game-session.json';
import restModel from '../examples/models/valid/template-rest-order.json';
import modbusModel from '../examples/models/valid/template-modbus-controller.json';
import cliModel from '../examples/models/valid/mealy-turnstile.json';
import timedModel from '../examples/models/valid/tfsm-timed-guards-door.json';
import mlModel from '../examples/models/valid/template-ml-inference.json';

/** Identifier of a bundled TFSM example in the Timed Testing Workbench. */
export type TimedExampleId = 'guards' | 'timeouts' | 'delays' | 'combined' | 'alur-dill';

/** Canonical model loaded by the template's one-click action. */
export type TemplateAction = { kind: 'load-model'; model: AutomataModel };

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
  /** Short purpose statement. */
  description: string;
  /** Expected system under test. */
  target: string;
  /** Suggested generation/execution strategy. */
  strategy: string;
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
    description: 'Проверяет допустимые переходы игрового процесса и поведения NPC.',
    target: 'Игровая логика, NPC controller или HTTP game server.',
    strategy: 'Transition cover, затем seeded random walk для длинных сессий.',
    what: 'Логика игровых состояний: корректные переходы между меню, игрой, паузой и победой.',
    states: 'menu, playing, paused, victory',
    inputs: 'start, pause, resume, win',
    outputs: 'playing, paused, victory',
    adapter: 'IN-MEMORY в браузере; тот же план исполняется HTTP-адаптером против реального игрового сервера.',
    adapterBadge: 'IN-MEMORY / HTTP',
    command: 'npm run cli -- generate examples/game-session.fsm --strategy transition-cover --output game-plan.json',
    links: [
      { label: 'Canonical Model IR', path: 'examples/models/valid/template-game-session.json' },
      { label: 'Модель game-session.fsm', path: 'examples/game-session.fsm' },
      { label: 'Генерация тестов', path: 'docs/TEST-GENERATION.md' },
    ],
    action: { kind: 'load-model', model: gameModel as AutomataModel },
  },
  {
    id: 'rest-api',
    title: 'REST API',
    subtitle: 'Веб-API и игровой сервер по HTTP',
    description: 'Моделирует жизненный цикл заказа и HTTP-результаты операций.',
    target: 'REST API, microservice или staging endpoint.',
    strategy: 'Transition cover для workflow; HTTP adapter для реального запуска.',
    what: 'Поведение REST-сервиса: start, pause, resume и victory настоящего loopback-сервера.',
    states: 'menu, playing, paused, victory (модель GameSession)',
    inputs: 'start, pause, resume, win → HTTP-запросы из конфигурации адаптера',
    outputs: 'playing, paused, victory — из JSON-ответов сервиса',
    adapter: 'HTTP/REST-адаптер (Node runner): same-origin, без redirect, ограниченный ответ.',
    adapterBadge: 'HTTP / REST',
    command: 'npm run demo:http',
    links: [
      { label: 'Canonical Model IR', path: 'examples/models/valid/template-rest-order.json' },
      { label: 'HTTP-адаптер', path: 'docs/adapters/HTTP.md' },
      { label: 'План http-game.json', path: 'examples/test-plans/http-game.json' },
    ],
    action: { kind: 'load-model', model: restModel as AutomataModel },
  },
  {
    id: 'modbus',
    title: 'Modbus TCP device',
    subtitle: 'Устройство или симулятор по Modbus TCP',
    description: 'Моделирует запуск, остановку, аварию и сброс контроллера двигателя.',
    target: 'PLC, Modbus simulator или промышленный контроллер.',
    strategy: 'Transition cover на симуляторе; записи только с allowWrites.',
    what: 'Поведение устройства: состояние лампы читается из coil-регистра и сверяется с моделью (FC1–FC6).',
    states: 'lamp_off, lamp_on',
    inputs: 'read_lamp → readCoils, address 10 (типизированная Modbus-операция)',
    outputs: 'lamp_on, lamp_off — предикаты над прочитанными значениями',
    adapter: 'Modbus TCP-адаптер (Node runner): MBAP-корреляция, записи только при явном allowWrites: true.',
    adapterBadge: 'MODBUS TCP',
    command: 'npm run demo:modbus',
    links: [
      { label: 'Canonical Model IR', path: 'examples/models/valid/template-modbus-controller.json' },
      { label: 'Modbus-адаптер', path: 'docs/adapters/MODBUS-TCP.md' },
      { label: 'Конфигурация modbus-lamp.json', path: 'examples/adapters/modbus-lamp.json' },
    ],
    action: { kind: 'load-model', model: modbusModel as AutomataModel },
  },
  {
    id: 'ml-inference',
    title: 'ML inference service',
    subtitle: 'Поведение ML-сервиса инференса',
    description: 'Проверяет контракт валидации запроса и выдачи результата модели.',
    target: 'HTTP inference endpoint или локальный model server.',
    strategy: 'Transition cover для контракта плюс dataset campaign для примеров.',
    what: 'Поведенческий контракт сервиса инференса: эталонные примеры дают ожидаемые метки классов.',
    states: 'serving (контракт BinaryClassifierApi)',
    inputs: 'predict_positive, predict_negative → POST /v1/predict с фиксированными признаками',
    outputs: 'positive, negative — метка из JSON-ответа (JSON Pointer /prediction/label)',
    adapter: 'HTTP/REST-адаптер (Node runner); поведенческий контракт, не статистическое качество модели.',
    adapterBadge: 'HTTP / ML',
    command: 'npm run cli -- run examples/test-plans/http-ml-classifier.json --adapter http --config examples/adapters/http-ml-classifier.json',
    links: [
      { label: 'Canonical Model IR', path: 'examples/models/valid/template-ml-inference.json' },
      { label: 'HTTP-адаптер', path: 'docs/adapters/HTTP.md' },
      { label: 'JSONL-датасеты', path: 'docs/DATASET-GENERATION.md' },
      { label: 'Конфигурация http-ml-classifier.json', path: 'examples/adapters/http-ml-classifier.json' },
    ],
    action: { kind: 'load-model', model: mlModel as AutomataModel },
  },
  {
    id: 'timed',
    title: 'Timed controller',
    subtitle: 'Дверной контроллер с временными границами',
    description: 'Проверяет открытые и закрытые границы допустимого времени открытия двери.',
    target: 'Door controller, traffic-light timer или virtual-time simulation.',
    strategy: 'Boundary tests непосредственно до, на и после каждой временной границы.',
    what: 'Временное поведение: команда open разрешена только внутри заданного временного guard.',
    states: 'closed, open',
    inputs: 'open, close + виртуальное время',
    outputs: 'opened, closed',
    adapter: 'Timed Testing Workbench в браузере: граничные тесты в виртуальном времени.',
    adapterBadge: 'VIRTUAL TIME',
    command: 'npm run dev',
    links: [
      { label: 'Временное тестирование', path: 'docs/TIMED-TESTING.md' },
      { label: 'Модель tfsm-timed-guards-door.json', path: 'examples/models/valid/tfsm-timed-guards-door.json' },
    ],
    action: { kind: 'load-model', model: timedModel as AutomataModel },
  },
  {
    id: 'cli',
    title: 'CLI application',
    subtitle: 'Внешняя программа через stdin/stdout',
    description: 'Проверяет процесс как чёрный ящик через безопасный JSON Lines protocol.',
    target: 'CLI tool, controller process или executable fixture.',
    strategy: 'Transition cover через process adapter с deadline на каждом шаге.',
    what: 'Поведение консольной программы: турникет отвечает на монету и толчок по JSON Lines-протоколу.',
    states: 'locked, unlocked',
    inputs: 'coin, push',
    outputs: 'unlock, lock, none',
    adapter: 'CLI-process-адаптер (Node runner): запуск без shell, environment-allowlist.',
    adapterBadge: 'CLI PROCESS',
    command: 'npm run demo:cli',
    links: [
      { label: 'Canonical Model IR', path: 'examples/models/valid/mealy-turnstile.json' },
      { label: 'CLI-адаптер', path: 'docs/adapters/CLI-PROCESS.md' },
      { label: 'Эталонный SUT turnstile.cjs', path: 'test-fixtures/cli-sut/turnstile.cjs' },
      { label: 'Runner CLI', path: 'docs/RUNNER-CLI.md' },
    ],
    action: { kind: 'load-model', model: cliModel as AutomataModel },
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
  { title: 'Model', detail: 'Выберите шаблон и изучите граф состояний' },
  { title: 'Generate', detail: 'Получите transition-cover тестовую кампанию' },
  { title: 'Run', detail: 'Запустите симулятор или подключите SUT-адаптер' },
  { title: 'Report', detail: 'Проверьте трассу, verdict, JUnit или HTML' },
];

export const ONBOARDING_STORAGE_KEY = 'automata-studio:onboarding:v1.1:dismissed';

export type OnboardingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function isOnboardingDismissed(storage: OnboardingStorage): boolean {
  try {
    return storage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function dismissOnboarding(storage: OnboardingStorage): void {
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, 'true');
  } catch {
    // The tour still closes when storage is unavailable (private mode, quota).
  }
}

export function reopenOnboarding(storage: OnboardingStorage): void {
  try {
    storage.removeItem(ONBOARDING_STORAGE_KEY);
  } catch {
    // Reopening remains useful for this session even without persistence.
  }
}
