import { describe, expect, it } from 'vitest';
import assistant from '@/ui/i18n/locales/assistant';

describe('assistant locale', () => {
  it('has the same keys in en, ru and uk with non-empty values', () => {
    const en = Object.keys(assistant.en).sort();
    expect(Object.keys(assistant.ru).sort()).toEqual(en);
    expect(Object.keys(assistant.uk).sort()).toEqual(en);
    for (const lang of ['en', 'ru', 'uk'] as const) {
      for (const [k, v] of Object.entries(assistant[lang])) expect(v.trim(), `${lang}:${k}`).not.toBe('');
    }
  });

  it('keeps the same {placeholders} in every language', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [k, v] of Object.entries(assistant.en)) {
      expect(vars(assistant.ru[k as keyof typeof assistant.ru]), `ru:${k}`).toBe(vars(v));
      expect(vars(assistant.uk[k as keyof typeof assistant.uk]), `uk:${k}`).toBe(vars(v));
    }
  });
});
