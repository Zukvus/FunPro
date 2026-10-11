import type { Settings } from '@/core/settings/schema';

/**
 * Per-page convenience cache of the appearance-relevant settings in the extension origin's
 * localStorage. It lets the dashboard/popup paint in the right theme (and with privacy blur already
 * active) before the async settings read finishes. Never authoritative; failures are ignored.
 */
const KEY = 'funpro:appearance-cache:v1';

export interface CachedAppearance {
  appearance: Settings['appearance'];
  privacy: Pick<Settings['privacy'], 'privacyMode' | 'hideBalances'>;
  general: Pick<Settings['general'], 'language'>;
}

export function writeAppearanceCache(settings: Settings): void {
  const value: CachedAppearance = {
    appearance: settings.appearance,
    privacy: { privacyMode: settings.privacy.privacyMode, hideBalances: settings.privacy.hideBalances },
    general: { language: settings.general.language },
  };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota) — the cache is optional */
  }
}

export function readAppearanceCache(): Partial<CachedAppearance> | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<CachedAppearance>) : null;
  } catch {
    return null;
  }
}

export function clearAppearanceCache(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
