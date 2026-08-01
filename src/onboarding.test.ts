import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateTransitionCover } from './fsm.ts';
import { generateTimedBoundaryCases } from './timed-testing.ts';
import { modelIrToMachine } from './model-ir-adapter.ts';
import { validateModel } from './model-ir.ts';
import {
  dismissOnboarding,
  getTemplate,
  isOnboardingDismissed,
  ONBOARDING_STORAGE_KEY,
  onboardingJourney,
  onboardingTemplates,
  reopenOnboarding,
  resolveTemplateAction,
  templateLinkUrl,
  type OnboardingStorage,
} from './onboarding.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('template catalog', () => {
  it('contains the six onboarding scenarios', () => {
    expect(onboardingTemplates.map((template) => template.id)).toEqual([
      'game', 'rest-api', 'modbus', 'ml-inference', 'timed', 'cli',
    ]);
  });

  it('fills every explanatory field on every card', () => {
    for (const template of onboardingTemplates) {
      for (const field of ['title', 'subtitle', 'description', 'target', 'strategy', 'what', 'states', 'inputs', 'outputs', 'adapter', 'adapterBadge', 'command'] as const) {
        expect(template[field].trim(), `${template.id}.${field}`).not.toBe('');
      }
      expect(template.links.length, `${template.id}.links`).toBeGreaterThan(0);
    }
  });

  it('has unique template ids and link labels per card', () => {
    const ids = onboardingTemplates.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of onboardingTemplates) {
      const labels = template.links.map((link) => link.label);
      expect(new Set(labels).size, template.id).toBe(labels.length);
    }
  });

  it('only links to files that exist in the repository', () => {
    for (const template of onboardingTemplates) {
      for (const link of template.links) {
        expect(existsSync(join(repoRoot, link.path)), `${template.id}: ${link.path}`).toBe(true);
        expect(templateLinkUrl(link)).toBe(`https://github.com/vitalya834/automata-studio/blob/main/${link.path}`);
      }
    }
  });

  it('only advertises npm scripts that exist in package.json', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const template of onboardingTemplates) {
      const match = template.command.match(/^npm run ([a-z:-]+)/);
      expect(match, `${template.id} command must start with "npm run"`).not.toBeNull();
      expect(packageJson.scripts, `${template.id}: script ${match![1]}`).toHaveProperty(match![1]);
    }
  });

  it('references example files that exist inside commands', () => {
    for (const template of onboardingTemplates) {
      for (const path of template.command.match(/examples\/[\w./-]+/g) ?? []) {
        expect(existsSync(join(repoRoot, path)), `${template.id}: ${path}`).toBe(true);
      }
    }
  });
});

describe('template selection', () => {
  it('returns templates by id and undefined for unknown ids', () => {
    expect(getTemplate('game')?.title).toBe('Game state machine');
    expect(getTemplate('nope')).toBeUndefined();
    expect(resolveTemplateAction('nope')).toBeUndefined();
  });

  it('loads a canonical, valid Model IR document for every template', () => {
    for (const template of onboardingTemplates) {
      const action = resolveTemplateAction(template.id);
      expect(action?.kind, template.id).toBe('load-model');
      if (!action) continue;
      const validation = validateModel(action.model);
      expect(validation.ok, `${template.id}: ${validation.ok ? '' : JSON.stringify(validation.diagnostics)}`).toBe(true);
    }
  });

  it('offers five browser-loadable Mealy campaigns and one timed campaign', () => {
    const kinds = onboardingTemplates.map((template) => template.action.model.modelKind);
    expect(kinds.filter((kind) => kind === 'mealy')).toHaveLength(5);
    expect(kinds.filter((kind) => kind === 'tfsm')).toHaveLength(1);
  });

  it('prepares a non-empty campaign from every one-click model', () => {
    for (const template of onboardingTemplates) {
      const model = template.action.model;
      if (model.modelKind === 'tfsm') {
        expect(generateTimedBoundaryCases(model).length, template.id).toBeGreaterThan(0);
        continue;
      }
      const imported = modelIrToMachine(model);
      expect(imported.ok, template.id).toBe(true);
      if (!imported.ok) continue;
      expect(generateTransitionCover(imported.machine).tests.length, template.id).toBeGreaterThan(0);
    }
  });
});

describe('user journey', () => {
  it('describes Model -> Generate -> Run -> Report', () => {
    expect(onboardingJourney.map((step) => step.title)).toEqual([
      'Model', 'Generate', 'Run', 'Report',
    ]);
    for (const step of onboardingJourney) expect(step.detail.trim()).not.toBe('');
  });
});

describe('onboarding persistence', () => {
  function memoryStorage(initial: Record<string, string> = {}): OnboardingStorage {
    const values = new Map(Object.entries(initial));
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    };
  }

  it('persists dismissal and allows reopening the tour', () => {
    const storage = memoryStorage();
    expect(isOnboardingDismissed(storage)).toBe(false);
    dismissOnboarding(storage);
    expect(isOnboardingDismissed(storage)).toBe(true);
    reopenOnboarding(storage);
    expect(isOnboardingDismissed(storage)).toBe(false);
  });

  it('uses only a namespaced boolean preference', () => {
    const storage = memoryStorage({ [ONBOARDING_STORAGE_KEY]: 'false' });
    expect(isOnboardingDismissed(storage)).toBe(false);
    dismissOnboarding(storage);
    expect(isOnboardingDismissed(storage)).toBe(true);
  });

  it('fails open when browser storage is unavailable', () => {
    const unavailable: OnboardingStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(isOnboardingDismissed(unavailable)).toBe(false);
    expect(() => dismissOnboarding(unavailable)).not.toThrow();
    expect(() => reopenOnboarding(unavailable)).not.toThrow();
  });
});
