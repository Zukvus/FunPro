import type { Settings } from '@/core/settings/schema';

export function resolveTheme(theme: Settings['appearance']['theme'], prefersDark: boolean): string {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

/** Applies appearance & privacy settings as data-attributes on <html>; CSS does the rest. */
export function applyAppearance(root: HTMLElement, settings: Settings, prefersDark: boolean): void {
  const a = settings.appearance;
  root.dataset.theme = resolveTheme(a.theme, prefersDark);
  root.dataset.density = a.density;
  root.dataset.reducedMotion = String(a.reducedMotion);
  root.dataset.contrast = a.highContrast ? 'high' : 'normal';
  root.dataset.privacy = String(settings.privacy.privacyMode);
  root.dataset.hideBalances = String(settings.privacy.hideBalances || settings.privacy.privacyMode);
  root.style.setProperty('--fp-font-scale', String(a.fontScale));
  const lang = settings.general.language;
  if (lang !== 'auto') root.lang = lang;
}
