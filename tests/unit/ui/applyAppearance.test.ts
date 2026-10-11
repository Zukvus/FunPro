import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '@/core/settings/schema';
import { applyAppearance, computeAppearance, primeAppearanceFromCache } from '@/ui/theme/applyAppearance';
import { clearAppearanceCache, readAppearanceCache } from '@/ui/theme/cache';

function settings(mut: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  mut(s);
  return s;
}

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('html');
  clearAppearanceCache();
});

describe('applyAppearance', () => {
  it('writes theme, density, motion, contrast, privacy and font scale attributes', () => {
    applyAppearance(
      root,
      settings((s) => {
        s.appearance.theme = 'forest';
        s.appearance.density = 'compact';
        s.appearance.reducedMotion = true;
        s.appearance.highContrast = true;
        s.appearance.fontScale = 1.25;
        s.privacy.privacyMode = true;
        s.general.language = 'uk';
      }),
      false,
    );
    expect(root.dataset).toMatchObject({
      theme: 'forest',
      scheme: 'dark',
      density: 'compact',
      reducedMotion: 'true',
      contrast: 'high',
      privacy: 'true',
      hideBalances: 'true',
    });
    expect(root.style.getPropertyValue('--fp-font-scale')).toBe('1.25');
    expect(root.lang).toBe('uk');
  });

  it('resolves the system theme from the OS preference', () => {
    applyAppearance(root, settings(), true);
    expect(root.dataset.theme).toBe('dark');
    applyAppearance(root, settings(), false);
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.privacy).toBe('false');
    expect(root.dataset.hideBalances).toBe('false');
  });

  it('hides balances on their own without enabling full privacy mode', () => {
    applyAppearance(root, settings((s) => (s.privacy.hideBalances = true)), false);
    expect(root.dataset.privacy).toBe('false');
    expect(root.dataset.hideBalances).toBe('true');
  });

  it('sets and clears custom accent variables', () => {
    applyAppearance(root, settings((s) => (s.appearance.accentColor = '#0f766e')), false);
    expect(root.style.getPropertyValue('--fp-accent')).toBe('#0f766e');
    expect(root.style.getPropertyValue('--fp-accent-fg')).toBe('#ffffff');
    applyAppearance(root, settings(), false);
    expect(root.style.getPropertyValue('--fp-accent')).toBe('');
  });

  it('computes attributes without touching the DOM', () => {
    expect(computeAppearance(settings((s) => (s.appearance.theme = 'contrast')), false)).toMatchObject({ theme: 'contrast', scheme: 'dark' });
  });
});

describe('appearance cache (no flash on load)', () => {
  it('primes a fresh page from the last applied settings', () => {
    expect(primeAppearanceFromCache(root)).toBe(false);
    applyAppearance(
      document.createElement('html'),
      settings((s) => {
        s.appearance.theme = 'midnight';
        s.privacy.privacyMode = true;
      }),
      false,
    );
    expect(readAppearanceCache()?.appearance?.theme).toBe('midnight');
    const fresh = document.createElement('html');
    expect(primeAppearanceFromCache(fresh)).toBe(true);
    expect(fresh.dataset.theme).toBe('midnight');
    expect(fresh.dataset.privacy).toBe('true');
  });

  it('ignores a corrupted cache', () => {
    localStorage.setItem('funpro:appearance-cache:v1', '{not json');
    expect(primeAppearanceFromCache(root)).toBe(false);
  });
});
