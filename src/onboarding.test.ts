import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeMachine, parseMachine } from './fsm.ts';
import {
  getTemplate,
  onboardingJourney,
  onboardingTemplates,
  resolveTemplateAction,
  templateLinkUrl,
  type TimedExampleId,
} from './onboarding.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Timed example ids offered by the workbench dropdown in src/main.ts. */
const TIMED_EXAMPLE_IDS: readonly TimedExampleId[] = ['guards', 'timeouts', 'delays', 'combined', 'alur-dill'];

describe('template catalog', () => {
  it('contains the six onboarding scenarios', () => {
    expect(onboardingTemplates.map((template) => template.id)).toEqual([
      'game', 'rest-api', 'modbus', 'ml-inference', 'timed', 'cli',
    ]);
  });

  it('fills every explanatory field on every card', () => {
    for (const template of onboardingTemplates) {
      for (const field of ['title', 'subtitle', 'what', 'states', 'inputs', 'outputs', 'adapter', 'adapterBadge', 'command'] as const) {
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

  it('game action loads a valid deterministic DSL model', () => {
    const action = resolveTemplateAction('game');
    expect(action?.kind).toBe('load-dsl');
    if (action?.kind !== 'load-dsl') return;
    const parsed = parseMachine(action.source);
    expect(parsed.machine).toBeDefined();
    expect(parsed.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(parsed.machine!.name).toBe('GameSession');
    expect(analyzeMachine(parsed.machine!).deterministic).toBe(true);
  });

  it('game DSL source stays in sync with examples/game-session.fsm', () => {
    const action = resolveTemplateAction('game');
    if (action?.kind !== 'load-dsl') throw new Error('game must be load-dsl');
    const file = readFileSync(join(repoRoot, 'examples', 'game-session.fsm'), 'utf8');
    expect(action.source.replace(/\r\n/g, '\n')).toBe(file.replace(/\r\n/g, '\n'));
  });

  it('timed action targets a bundled workbench example', () => {
    const action = resolveTemplateAction('timed');
    expect(action?.kind).toBe('load-timed');
    if (action?.kind !== 'load-timed') return;
    expect(TIMED_EXAMPLE_IDS).toContain(action.exampleId);
  });

  it('runner-only scenarios expose commands instead of imitating execution', () => {
    for (const id of ['rest-api', 'modbus', 'ml-inference', 'cli'] as const) {
      expect(resolveTemplateAction(id)?.kind, id).toBe('commands-only');
    }
  });
});

describe('user journey', () => {
  it('describes the five-step path from template to report', () => {
    expect(onboardingJourney.map((step) => step.title)).toEqual([
      'Choose template', 'Inspect graph', 'Generate tests', 'Run adapter', 'Inspect report',
    ]);
    for (const step of onboardingJourney) expect(step.detail.trim()).not.toBe('');
  });
});
