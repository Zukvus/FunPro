import { useCallback } from 'react';
import { useSettingsStore } from '../hooks/useSettings';

export type Lang = 'en' | 'ru' | 'uk';

/**
 * Translations are split into namespace files under ./locales/*.ts. Each file default-exports
 * `{ en: {...}, ru: {...}, uk: {...} }` with flat dotted keys. English is the fallback.
 * New feature modules add a file — no central registry to edit.
 */
type Dict = Record<string, string>;
type LocaleModule = { default: Partial<Record<Lang, Dict>> };

const modules = import.meta.glob<LocaleModule>('./locales/*.ts', { eager: true });

const DICTS: Record<Lang, Dict> = { en: {}, ru: {}, uk: {} };
for (const mod of Object.values(modules)) {
  for (const lang of ['en', 'ru', 'uk'] as const) Object.assign(DICTS[lang], mod.default[lang] ?? {});
}

export function detectBrowserLang(): Lang {
  const nav = (globalThis.navigator?.language ?? 'en').toLowerCase();
  if (nav.startsWith('ru')) return 'ru';
  if (nav.startsWith('uk')) return 'uk';
  return 'en';
}

export function resolveLang(setting: 'auto' | Lang): Lang {
  return setting === 'auto' ? detectBrowserLang() : setting;
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function hasTranslation(lang: Lang, key: string): boolean {
  return key in DICTS[lang];
}

export function allKeys(lang: Lang): string[] {
  return Object.keys(DICTS[lang]);
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

export function useLang(): Lang {
  const setting = useSettingsStore((s) => s.settings.general.language);
  return resolveLang(setting);
}

export function useT(): TFunction {
  const lang = useLang();
  return useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}
