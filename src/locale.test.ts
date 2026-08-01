import { describe, expect, it } from 'vitest';
import { onboardingTemplates } from './onboarding';
import { journeyEnglish, LOCALE_STORAGE_KEY, readLocale, templateEnglish, writeLocale } from './locale';

describe('product locale', () => {
  it('has complete English copy for every template and journey step', () => {
    expect(Object.keys(templateEnglish).sort()).toEqual(onboardingTemplates.map((item) => item.id).sort());
    for (const copy of Object.values(templateEnglish)) {
      for (const value of Object.values(copy)) expect(value.trim()).not.toBe('');
    }
    expect(journeyEnglish).toHaveLength(4);
  });

  it('persists RU/EN and fails open when storage is unavailable', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    expect(readLocale(storage)).toBe('ru');
    writeLocale(storage, 'en');
    expect(values.get(LOCALE_STORAGE_KEY)).toBe('en');
    expect(readLocale(storage)).toBe('en');
    expect(readLocale({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined }, 'en')).toBe('en');
  });
});
