import { parseSettings, type Settings, type ThemeId } from '@/core/settings/schema';
import {
  accentOverrides,
  resolveTheme as resolveThemeId,
  THEMES,
  type ConcreteThemeId,
  type PaletteToken,
} from '@/features/appearance/themes';
import { resolveLang, type Lang } from '../i18n/core';
import { readAppearanceCache, writeAppearanceCache } from './cache';

export function resolveTheme(theme: ThemeId, prefersDark: boolean): ConcreteThemeId {
  return resolveThemeId(theme, prefersDark);
}

/** Everything `applyAppearance` writes to the document root, computed without touching the DOM. */
export interface AppearanceAttributes {
  theme: ConcreteThemeId;
  scheme: 'light' | 'dark';
  density: Settings['appearance']['density'];
  reducedMotion: boolean;
  highContrast: boolean;
  privacy: boolean;
  hideBalances: boolean;
  fontScale: number;
  lang: Lang;
  /** CSS custom properties overriding the theme palette (custom accent colour). */
  vars: Partial<Record<PaletteToken, string>>;
}

export function computeAppearance(settings: Settings, prefersDark: boolean): AppearanceAttributes {
  const a = settings.appearance;
  const theme = resolveTheme(a.theme, prefersDark);
  return {
    theme,
    scheme: THEMES[theme].scheme,
    density: a.density,
    reducedMotion: a.reducedMotion,
    highContrast: a.highContrast,
    privacy: settings.privacy.privacyMode,
    // Privacy mode implies hidden balances.
    hideBalances: settings.privacy.hideBalances || settings.privacy.privacyMode,
    fontScale: a.fontScale,
    lang: resolveLang(settings.general.language),
    vars: a.accentColor ? accentOverrides(a.accentColor, theme) : {},
  };
}

const OVERRIDABLE: PaletteToken[] = ['accent', 'accent-fg', 'accent-soft'];

/** Writes computed attributes as data-attributes / CSS variables on `root`; CSS does the rest. */
export function applyAttributes(root: HTMLElement, attrs: AppearanceAttributes): void {
  root.dataset.theme = attrs.theme;
  root.dataset.scheme = attrs.scheme;
  root.dataset.density = attrs.density;
  root.dataset.reducedMotion = String(attrs.reducedMotion);
  root.dataset.contrast = attrs.highContrast ? 'high' : 'normal';
  root.dataset.privacy = String(attrs.privacy);
  root.dataset.hideBalances = String(attrs.hideBalances);
  root.style.setProperty('--fp-font-scale', String(attrs.fontScale));
  for (const token of OVERRIDABLE) {
    const v = attrs.vars[token];
    if (v) root.style.setProperty(`--fp-${token}`, v);
    else root.style.removeProperty(`--fp-${token}`);
  }
  root.lang = attrs.lang;
}

/** Applies appearance & privacy settings to the document root and remembers them for the next page load. */
export function applyAppearance(root: HTMLElement, settings: Settings, prefersDark: boolean): void {
  applyAttributes(root, computeAppearance(settings, prefersDark));
  writeAppearanceCache(settings);
}

function systemPrefersDark(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Synchronously applies the last known appearance before React renders, avoiding a light flash for
 * dark-theme users and an unblurred flash in privacy mode. Safe to call at module load.
 */
export function primeAppearanceFromCache(
  root: HTMLElement | null = globalThis.document?.documentElement ?? null,
): boolean {
  if (!root) return false;
  const cached = readAppearanceCache();
  if (!cached) return false;
  applyAttributes(root, computeAppearance(parseSettings(cached), systemPrefersDark()));
  return true;
}
