import { describe, expect, it } from 'vitest';
import { allKeys, hasTranslation, translate } from '@/ui/i18n';

/**
 * Generic completeness checks over EVERY locale namespace file (src/ui/i18n/locales/*.ts), including
 * files added by other feature areas. Failures list the exact file and keys to fix.
 */
type Dict = Record<string, string>;
type LocaleModule = { default: Partial<Record<'en' | 'ru' | 'uk', Dict>> };

const modules = import.meta.glob<LocaleModule>('../../../src/ui/i18n/locales/*.ts', { eager: true });
const files = Object.entries(modules).map(([path, mod]) => ({
  name: path.split('/').pop()!,
  dicts: mod.default,
}));
const OTHER = ['ru', 'uk'] as const;

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n locale files', () => {
  it('are discovered', () => {
    expect(files.map((f) => f.name)).toContain('common.ts');
    expect(files.map((f) => f.name)).toContain('settings.ts');
  });

  it('every file has a non-empty English dictionary', () => {
    const bad = files.filter((f) => !f.dicts.en || Object.keys(f.dicts.en).length === 0).map((f) => f.name);
    expect(bad).toEqual([]);
  });

  it('every English key exists in ru and uk (per file)', () => {
    const missing: string[] = [];
    for (const f of files) {
      const en = f.dicts.en ?? {};
      for (const lang of OTHER) {
        const dict = f.dicts[lang] ?? {};
        for (const key of Object.keys(en)) if (!(key in dict)) missing.push(`${f.name} [${lang}] ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('ru and uk have no keys that English lacks (stale translations)', () => {
    const extra: string[] = [];
    for (const f of files) {
      const en = f.dicts.en ?? {};
      for (const lang of OTHER)
        for (const key of Object.keys(f.dicts[lang] ?? {}))
          if (!(key in en)) extra.push(`${f.name} [${lang}] ${key}`);
    }
    expect(extra).toEqual([]);
  });

  it('translations keep the same {placeholders} and are not empty', () => {
    const problems: string[] = [];
    for (const f of files) {
      const en = f.dicts.en ?? {};
      for (const [key, value] of Object.entries(en)) {
        if (!value.trim()) problems.push(`${f.name} [en] ${key}: empty`);
        for (const lang of OTHER) {
          const t = f.dicts[lang]?.[key];
          if (t === undefined) continue;
          if (!t.trim()) problems.push(`${f.name} [${lang}] ${key}: empty`);
          else if (placeholders(t).join() !== placeholders(value).join())
            problems.push(
              `${f.name} [${lang}] ${key}: placeholders ${placeholders(t).join() || '-'} ≠ ${placeholders(value).join() || '-'}`,
            );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('no key is defined by two different files (later files would silently override)', () => {
    const owner = new Map<string, string>();
    const dupes: string[] = [];
    for (const f of files) {
      for (const key of Object.keys(f.dicts.en ?? {})) {
        const prev = owner.get(key);
        if (prev && prev !== f.name) dupes.push(`${key}: ${prev} and ${f.name}`);
        else owner.set(key, f.name);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('the runtime merges every file for every language', () => {
    expect(allKeys('en').length).toBeGreaterThan(0);
    for (const key of allKeys('en'))
      for (const lang of OTHER) expect(hasTranslation(lang, key), `${lang}: ${key}`).toBe(true);
    expect(translate('ru', 'nav.appearance')).toBe('Оформление');
    expect(translate('en', 'session.logged_in', { name: 'Seller' })).toBe('Connected as Seller');
  });
});
