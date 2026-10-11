/**
 * Minimal translator for on-page helpers. Reads the same `listings` locale namespace as the
 * dashboard, without pulling React / the settings store into the content-script bundle.
 */
import dict from '@/ui/i18n/locales/listings';

export type CsLang = 'en' | 'ru' | 'uk';

export function csLang(setting: string | null | undefined, pageLocale: string | null | undefined): CsLang {
  if (setting === 'ru' || setting === 'en' || setting === 'uk') return setting;
  if (pageLocale === 'ru' || pageLocale === 'en' || pageLocale === 'uk') return pageLocale;
  const nav = (globalThis.navigator?.language ?? 'en').toLowerCase();
  return nav.startsWith('ru') ? 'ru' : nav.startsWith('uk') ? 'uk' : 'en';
}

export function tr(lang: CsLang, key: string, vars?: Record<string, string | number>): string {
  const d = dict as Partial<Record<CsLang, Record<string, string>>>;
  const raw = d[lang]?.[key] ?? d.en?.[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`)) : raw;
}
