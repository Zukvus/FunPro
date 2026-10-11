import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, type Settings } from '@/core/settings/schema';
import {
  configFromPageConfig,
  configFromSettings,
  FunPayAppearanceController,
  isOwnProfilePath,
  type BackgroundImagePayload,
  type ControllerDeps,
} from '@/content/enhancements/appearance/controller';
import { BACKGROUND_LAYER_ID, PROFILE_BADGE_CLASS, ROOT_ATTR } from '@/features/appearance/funpay-css';
import { loadFixture } from '../../../fixtures';

function settings(mut: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  mut(s);
  return s;
}

let doc: Document;
let path: string;
let loadBackground: ReturnType<typeof vi.fn<() => Promise<BackgroundImagePayload | null>>>;

function controller(): FunPayAppearanceController {
  const deps: ControllerDeps = { getUserId: () => '1000001', getPath: () => path, prefersDark: () => false, loadBackground };
  return new FunPayAppearanceController(doc, deps);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  doc = new DOMParser().parseFromString(`<html><head></head>${loadFixture('profile.html')}</html>`, 'text/html');
  path = '/users/1000001/';
  loadBackground = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', opacity: 0.2, assetId: 'bg_1' }));
});

describe('own profile detection', () => {
  it('matches only the logged-in user profile, with or without a locale prefix', () => {
    expect(isOwnProfilePath('/users/1000001/', '1000001')).toBe(true);
    expect(isOwnProfilePath('/en/users/1000001/', '1000001')).toBe(true);
    expect(isOwnProfilePath('/users/2000001/', '1000001')).toBe(false);
    expect(isOwnProfilePath('/users/1000001/', null)).toBe(false);
    expect(isOwnProfilePath('/orders/1000001/', '1000001')).toBe(false);
  });
});

describe('page config parsing', () => {
  it('validates the RPC answer through the settings schema', () => {
    const cfg = configFromPageConfig({ appearance: { theme: 'forest', nickname: { enabled: true, color: '#00ff00' } }, privacy: { privacyMode: true } });
    expect(cfg).toMatchObject({ theme: 'forest', privacyMode: true, hideBalances: false });
    expect(cfg!.nickname.color).toBe('#00ff00');
    expect(configFromPageConfig(null)).toBeNull();
    // Invalid values fall back to defaults instead of reaching the page.
    expect(configFromPageConfig({ appearance: { nickname: { color: 'red;}' } }, privacy: {} })!.nickname.color).toBe('#7c5cff');
  });
});

describe('FunPayAppearanceController', () => {
  it('toggles privacy mode and hidden balances live via root attributes', () => {
    const c = controller();
    c.apply(configFromSettings(settings()));
    const root = doc.documentElement;
    expect(doc.getElementById('funpro-privacy-style')).not.toBeNull();
    expect(root.hasAttribute(ROOT_ATTR.privacy)).toBe(false);

    c.apply(configFromSettings(settings((s) => (s.privacy.hideBalances = true))));
    expect(root.getAttribute(ROOT_ATTR.balances)).toBe('on');
    expect(root.hasAttribute(ROOT_ATTR.privacy)).toBe(false);

    c.apply(configFromSettings(settings((s) => (s.privacy.privacyMode = true))));
    expect(root.getAttribute(ROOT_ATTR.privacy)).toBe('on');
    expect(root.getAttribute(ROOT_ATTR.balances)).toBe('on');

    c.apply(configFromSettings(settings()));
    expect(root.hasAttribute(ROOT_ATTR.privacy)).toBe(false);
    expect(root.hasAttribute(ROOT_ATTR.balances)).toBe(false);
    expect(doc.querySelectorAll('#funpro-privacy-style')).toHaveLength(1);
  });

  it('shows the profile badge (as text) only on the own profile page', () => {
    const c = controller();
    const cfg = configFromSettings(settings((s) => (s.appearance.profileBadge = '<b>Top seller</b>')));
    c.apply(cfg);
    const badge = doc.querySelector(`.${PROFILE_BADGE_CLASS}`)!;
    expect(badge.textContent).toBe('<b>Top seller</b>');
    expect(badge.querySelector('b')).toBeNull();
    expect(badge.previousElementSibling?.textContent).toBe('SellerOne');
    expect(doc.documentElement.getAttribute(ROOT_ATTR.ownProfile)).toBe('1');

    c.apply(configFromSettings(settings((s) => (s.appearance.profileBadge = 'Online 24/7'))));
    expect(doc.querySelectorAll(`.${PROFILE_BADGE_CLASS}`)).toHaveLength(1);
    expect(doc.querySelector(`.${PROFILE_BADGE_CLASS}`)!.textContent).toBe('Online 24/7');

    path = '/users/2000001/';
    c.apply(cfg);
    expect(doc.querySelector(`.${PROFILE_BADGE_CLASS}`)).toBeNull();
    expect(doc.documentElement.hasAttribute(ROOT_ATTR.ownProfile)).toBe(false);
  });

  it('applies nickname and experimental theme styles and removes them when disabled', () => {
    const c = controller();
    c.apply(
      configFromSettings(
        settings((s) => {
          s.appearance.nickname.enabled = true;
          s.appearance.themeFunPay = true;
        }),
      ),
    );
    expect(doc.getElementById('funpro-nickname-style')?.textContent).toContain('.user-link-name');
    expect(doc.documentElement.getAttribute(ROOT_ATTR.theme)).toBe('dark');
    c.apply(configFromSettings(settings()));
    expect(doc.getElementById('funpro-nickname-style')).toBeNull();
    expect(doc.getElementById('funpro-theme-style')).toBeNull();
    expect(doc.documentElement.hasAttribute(ROOT_ATTR.theme)).toBe(false);
  });

  it('loads the background image once per asset and updates opacity without reloading', async () => {
    const c = controller();
    const on = (opacity: number) =>
      configFromSettings(
        settings((s) => {
          s.appearance.themeFunPay = true;
          s.appearance.backgroundImageAssetId = 'bg_1';
          s.appearance.backgroundOpacity = opacity;
        }),
      );
    c.apply(on(0.2));
    await flush();
    const layer = doc.getElementById(BACKGROUND_LAYER_ID)!;
    expect(layer.style.backgroundImage).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(doc.documentElement.getAttribute(ROOT_ATTR.background)).toBe('on');
    c.apply(on(0.5));
    await flush();
    expect(loadBackground).toHaveBeenCalledTimes(1);
    expect(doc.getElementById(BACKGROUND_LAYER_ID)!.style.opacity).toBe('0.5');

    c.apply(configFromSettings(settings()));
    expect(doc.getElementById(BACKGROUND_LAYER_ID)).toBeNull();
    expect(doc.documentElement.hasAttribute(ROOT_ATTR.background)).toBe(false);
  });

  it('ignores unsafe or stale background answers', async () => {
    loadBackground.mockResolvedValueOnce({ dataUrl: 'javascript:alert(1)', opacity: 1, assetId: 'bg_1' });
    const c = controller();
    c.apply(
      configFromSettings(
        settings((s) => {
          s.appearance.themeFunPay = true;
          s.appearance.backgroundImageAssetId = 'bg_1';
        }),
      ),
    );
    await flush();
    expect(doc.getElementById(BACKGROUND_LAYER_ID)).toBeNull();
  });

  it('destroy removes every injected element and attribute', async () => {
    const c = controller();
    c.apply(
      configFromSettings(
        settings((s) => {
          s.privacy.privacyMode = true;
          s.appearance.nickname.enabled = true;
          s.appearance.themeFunPay = true;
          s.appearance.profileBadge = 'Hi';
          s.appearance.backgroundImageAssetId = 'bg_1';
        }),
      ),
    );
    await flush();
    c.destroy();
    expect(doc.querySelectorAll('[data-funpro]')).toHaveLength(0);
    expect(Array.from(doc.documentElement.attributes).filter((a) => a.name.startsWith('data-fp-'))).toEqual([]);
  });
});

describe('early privacy (document_start helper)', () => {
  it('blurs before the page renders when privacy mode is on, and the controller takes over', async () => {
    const { updateSettings } = await import('@/core/settings/store');
    const { primeFunPayPrivacy } = await import('@/content/enhancements/appearance/early');
    const early = new DOMParser().parseFromString('<html><head></head><body></body></html>', 'text/html');
    expect(await primeFunPayPrivacy(early)).toBe(false);
    expect(early.getElementById('funpro-privacy-style')).toBeNull();

    await updateSettings({ privacy: { privacyMode: true } });
    expect(await primeFunPayPrivacy(early)).toBe(true);
    expect(early.documentElement.getAttribute(ROOT_ATTR.privacy)).toBe('on');
    expect(early.documentElement.getAttribute(ROOT_ATTR.balances)).toBe('on');

    // The controller reuses the same <style> and clears attributes when privacy mode is switched off.
    const c = new FunPayAppearanceController(early, { getUserId: () => null, getPath: () => '/', prefersDark: () => false, loadBackground: async () => null });
    c.apply(configFromSettings(settings()));
    expect(early.querySelectorAll('#funpro-privacy-style')).toHaveLength(1);
    expect(early.documentElement.hasAttribute(ROOT_ATTR.privacy)).toBe(false);
  });
});

describe('own profile fallback by username', () => {
  it('recognises the own profile from the header username when the user id is unknown', () => {
    const page = new DOMParser().parseFromString(`<html><head></head>${loadFixture('profile.html')}</html>`, 'text/html');
    const make = (username: string | null) =>
      new FunPayAppearanceController(page, { getUserId: () => null, getUsername: () => username, getPath: () => '/users/1000001/', prefersDark: () => false, loadBackground: async () => null });
    const cfg = configFromSettings(settings((s) => (s.appearance.profileBadge = 'Hi')));
    make('SomeoneElse').apply(cfg);
    expect(page.querySelector(`.${PROFILE_BADGE_CLASS}`)).toBeNull();
    make('SellerOne').apply(cfg);
    expect(page.querySelector(`.${PROFILE_BADGE_CLASS}`)?.textContent).toBe('Hi');
  });
});
