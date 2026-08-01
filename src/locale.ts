import type { OnboardingTemplate } from './onboarding';

export type AppLocale = 'ru' | 'en';
export const LOCALE_STORAGE_KEY = 'automata-studio:locale:v1';
export type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readLocale(storage: LocaleStorage, fallback: AppLocale = 'ru'): AppLocale {
  try {
    const value = storage.getItem(LOCALE_STORAGE_KEY);
    return value === 'ru' || value === 'en' ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocale(storage: LocaleStorage, locale: AppLocale): void {
  try { storage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Language switching still works in-memory. */ }
}

type TemplateCopy = Pick<OnboardingTemplate,
  'subtitle' | 'description' | 'target' | 'strategy' | 'what' | 'states' | 'inputs' | 'outputs' | 'adapter'>;

export const templateEnglish: Record<OnboardingTemplate['id'], TemplateCopy> = {
  game: {
    subtitle: 'Game session: menu, play, pause and victory',
    description: 'Checks valid game-flow and NPC behaviour transitions.',
    target: 'Game logic, NPC controller or HTTP game server.',
    strategy: 'Transition cover followed by seeded random walks for long sessions.',
    what: 'Correct transitions between menu, gameplay, pause and victory.',
    states: 'menu, playing, paused, victory', inputs: 'start, pause, resume, win',
    outputs: 'playing, paused, victory',
    adapter: 'IN-MEMORY in the browser; the same plan can run through HTTP against a game server.',
  },
  'rest-api': {
    subtitle: 'Web API order lifecycle',
    description: 'Models an order lifecycle and HTTP operation results.',
    target: 'REST API, microservice or staging endpoint.',
    strategy: 'Transition cover for the workflow; HTTP adapter for a real run.',
    what: 'An order can be created, paid, shipped or cancelled only in the correct order.',
    states: 'empty, created, paid, shipped, cancelled (RestOrderWorkflow)',
    inputs: 'create, pay, ship, cancel mapped to HTTP requests',
    outputs: 'created_201, paid_200, shipped_200, cancelled_200',
    adapter: 'HTTP/REST Node runner with same-origin policy, no redirects and bounded responses.',
  },
  modbus: {
    subtitle: 'Device or simulator over Modbus TCP',
    description: 'Models motor start, stop, trip and controller reset.',
    target: 'PLC, Modbus simulator or industrial controller.',
    strategy: 'Transition cover in simulation; writes only with allowWrites.',
    what: 'Motor-controller start, stop, trip and reset behaviour through FC1–FC6 registers.',
    states: 'ready, running, fault (ModbusMotorController)',
    inputs: 'start, stop, trip, reset mapped to typed Modbus operations',
    outputs: 'running, stopped, fault, ready predicates over register values',
    adapter: 'Modbus TCP Node runner with MBAP correlation and explicitly enabled safe writes.',
  },
  'ml-inference': {
    subtitle: 'ML inference service behaviour',
    description: 'Checks request validation and inference-result contracts.',
    target: 'HTTP inference endpoint or local model server.',
    strategy: 'Transition cover for the contract plus dataset campaigns for examples.',
    what: 'Validation, inference execution and result delivery through a behavioural contract.',
    states: 'idle, validating, inferencing, completed, rejected (MlInferencePipeline)',
    inputs: 'submit_valid, submit_invalid, validation_ok, inference_ok',
    outputs: 'accepted, rejected, running, prediction from JSON responses',
    adapter: 'HTTP/REST Node runner; this tests behaviour, not statistical model quality.',
  },
  timed: {
    subtitle: 'Door controller with timing boundaries',
    description: 'Checks open and closed boundaries of the permitted opening interval.',
    target: 'Door controller, traffic-light timer or virtual-time simulation.',
    strategy: 'Boundary tests immediately before, on and after every timing boundary.',
    what: 'The open command is accepted only inside its configured timed guard.',
    states: 'closed, open', inputs: 'open, close plus virtual time', outputs: 'opened, closed',
    adapter: 'Browser Timed Testing Workbench using deterministic virtual time.',
  },
  cli: {
    subtitle: 'External program over stdin/stdout',
    description: 'Tests a process as a black box through a safe JSON Lines protocol.',
    target: 'CLI tool, controller process or executable fixture.',
    strategy: 'Transition cover through the process adapter with a deadline per step.',
    what: 'A console turnstile responds to coin and push inputs over JSON Lines.',
    states: 'locked, unlocked', inputs: 'coin, push', outputs: 'unlock, lock, none',
    adapter: 'CLI-process Node runner: direct spawn without a shell and an environment allowlist.',
  },
};

export const journeyEnglish = [
  'Choose a template and inspect its state graph',
  'Build a transition-cover test campaign',
  'Run the simulator or connect a SUT adapter',
  'Review traces, verdicts, JUnit or HTML evidence',
] as const;
