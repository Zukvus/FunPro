/**
 * RU ↔ EN translation for listing titles/descriptions.
 *
 * Providers, in order:
 *  1. Chrome's built-in on-device Translator API (extension pages only; `'Translator' in self`).
 *     Nothing leaves the browser.
 *  2. An external provider registered at runtime via `registerTranslateProvider` (e.g. the AI
 *     assistant adapter, which requires the user's explicit consent). This module never imports
 *     third-party adapters itself.
 * When neither exists the UI explains that translation is unavailable — FunPro never invents text.
 */
export type TranslateLang = 'ru' | 'en';
export type TranslateFn = (text: string, from: TranslateLang, to: TranslateLang, signal?: AbortSignal) => Promise<string>;

export interface TranslateProvider {
  id: string;
  /** Shown to the user, e.g. "Chrome on-device translator". */
  label: string;
  /** True when text is sent to a third party (shown in the UI). */
  external: boolean;
  translate: TranslateFn;
}

/** Minimal typing of the Translator API (Chrome 138+); not relying on lib.dom declarations. */
interface BuiltinTranslator {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy?: () => void;
}
interface BuiltinTranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(opts: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal }): Promise<BuiltinTranslator>;
}

function builtinApi(): BuiltinTranslatorStatic | null {
  const g = globalThis as unknown as { Translator?: BuiltinTranslatorStatic };
  return typeof g.Translator === 'object' || typeof g.Translator === 'function' ? (g.Translator ?? null) : null;
}

let external: TranslateProvider | null = null;

/** Register a provider implemented elsewhere (AI adapter). Pass null to remove it. */
export function registerTranslateProvider(p: TranslateProvider | null): void {
  external = p;
}

export type Availability = 'available' | 'downloadable' | 'unavailable';

export async function builtinAvailability(from: TranslateLang, to: TranslateLang): Promise<Availability> {
  const api = builtinApi();
  if (!api) return 'unavailable';
  try {
    const a = await api.availability({ sourceLanguage: from, targetLanguage: to });
    if (a === 'available') return 'available';
    if (a === 'downloadable' || a === 'downloading') return 'downloadable';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

const cache = new Map<string, Promise<BuiltinTranslator>>();

function builtinProvider(api: BuiltinTranslatorStatic): TranslateProvider {
  return {
    id: 'builtin',
    label: 'Chrome on-device translator',
    external: false,
    translate: async (text, from, to, signal) => {
      if (!text.trim()) return text;
      const key = `${from}>${to}`;
      let t = cache.get(key);
      if (!t) {
        t = api.create({ sourceLanguage: from, targetLanguage: to });
        cache.set(key, t);
        t.catch(() => cache.delete(key));
      }
      const tr = await t;
      return tr.translate(text, signal ? { signal } : undefined);
    },
  };
}

/** The best available provider for a language pair, or null when translation is unavailable. */
export async function getTranslateProvider(from: TranslateLang = 'ru', to: TranslateLang = 'en'): Promise<TranslateProvider | null> {
  const api = builtinApi();
  if (api && (await builtinAvailability(from, to)) !== 'unavailable') return builtinProvider(api);
  return external;
}

/** Translate several fields sequentially (keeps memory and model load low). Empty values stay empty. */
export async function translateTexts<K extends string>(
  texts: Partial<Record<K, string>>,
  translate: TranslateFn,
  from: TranslateLang,
  to: TranslateLang,
  signal?: AbortSignal,
): Promise<Partial<Record<K, string>>> {
  const out: Partial<Record<K, string>> = {};
  for (const [k, v] of Object.entries(texts) as [K, string | undefined][]) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!v || !v.trim()) continue;
    out[k] = (await translate(v, from, to, signal)).trim();
  }
  return out;
}

/** Test helper. */
export function resetTranslateForTests(): void {
  external = null;
  cache.clear();
}
