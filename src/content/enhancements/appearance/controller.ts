import { parseSettings, type Settings, type ThemeId } from '@/core/settings/schema';
import { cleanText } from '@/core/security/sanitize';
import {
  BACKGROUND_LAYER_ID,
  backgroundLayerStylesheet,
  funpayPalette,
  funpayThemeStylesheet,
  isSafeImageDataUrl,
  nicknameStylesheet,
  privacyStylesheet,
  PRIVACY_STYLE_ID,
  PROFILE_BADGE_CLASS,
  profileBadgeStylesheet,
  ROOT_ATTR,
} from '@/features/appearance/funpay-css';
import { OWN_NAME_TARGETS } from '@/features/appearance/funpay-selectors';

/** Everything the funpay.com appearance enhancement needs (no secrets). */
export interface FunPayAppearanceConfig {
  privacyMode: boolean;
  hideBalances: boolean;
  themeFunPay: boolean;
  theme: ThemeId;
  accentColor: string | null;
  nickname: Settings['appearance']['nickname'];
  profileBadge: string;
  backgroundImageAssetId: string | null;
  backgroundOpacity: number;
}

export function configFromSettings(s: Settings): FunPayAppearanceConfig {
  return {
    privacyMode: s.privacy.privacyMode,
    hideBalances: s.privacy.hideBalances,
    themeFunPay: s.appearance.themeFunPay,
    theme: s.appearance.theme,
    accentColor: s.appearance.accentColor,
    nickname: s.appearance.nickname,
    profileBadge: s.appearance.profileBadge,
    backgroundImageAssetId: s.appearance.backgroundImageAssetId,
    backgroundOpacity: s.appearance.backgroundOpacity,
  };
}

/** Validate the (untrusted-shape) `cs.getPageConfig` answer through the settings schema. */
export function configFromPageConfig(raw: unknown): FunPayAppearanceConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { appearance?: unknown; privacy?: unknown };
  if (!r.appearance || !r.privacy) return null;
  return configFromSettings(parseSettings({ appearance: r.appearance, privacy: r.privacy }));
}

const PROFILE_PATH = /^(?:\/(?:en|uk|ru))?\/users\/(\d+)\/?$/;

export function isOwnProfilePath(pathname: string, userId: string | null): boolean {
  if (!userId) return false;
  const m = PROFILE_PATH.exec(pathname);
  return !!m && m[1] === userId;
}

export interface BackgroundImagePayload {
  dataUrl: string;
  opacity: number;
  assetId: string;
}

export interface ControllerDeps {
  getUserId: () => string | null;
  /** Logged-in username from the page header (session.username), if known. */
  getUsername?: () => string | null;
  getPath: () => string;
  prefersDark: () => boolean;
  loadBackground: () => Promise<BackgroundImagePayload | null>;
}

const STYLE_IDS = {
  privacy: PRIVACY_STYLE_ID,
  nickname: 'funpro-nickname-style',
  theme: 'funpro-theme-style',
  layer: 'funpro-bg-style',
  badge: 'funpro-badge-style',
} as const;

/**
 * Applies appearance/privacy settings to a funpay.com document. `apply()` is idempotent and cheap
 * (it only updates <style> text and <html> data attributes), so it can be called on every settings
 * change. Only CSS and two FunPro-owned elements (profile badge, background layer) are added; page
 * content is never rewritten. `destroy()` removes every trace.
 */
export class FunPayAppearanceController {
  private bgToken = 0;
  private bgLoadedFor: string | null = null;

  constructor(
    private readonly doc: Document,
    private readonly deps: ControllerDeps,
  ) {}

  private get root(): HTMLElement {
    return this.doc.documentElement;
  }

  private setAttr(name: string, value: string | null): void {
    if (value === null) this.root.removeAttribute(name);
    else if (this.root.getAttribute(name) !== value) this.root.setAttribute(name, value);
  }

  private setStyle(id: string, css: string): void {
    let el = this.doc.getElementById(id) as HTMLStyleElement | null;
    if (!css) {
      el?.remove();
      return;
    }
    if (!el) {
      el = this.doc.createElement('style');
      el.id = id;
      el.setAttribute('data-funpro', 'appearance');
      (this.doc.head ?? this.root).appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  apply(cfg: FunPayAppearanceConfig): void {
    const userId = this.deps.getUserId();

    // Privacy mode / hidden balances: one static stylesheet, toggled by attributes.
    this.setStyle(STYLE_IDS.privacy, privacyStylesheet());
    this.setAttr(ROOT_ATTR.privacy, cfg.privacyMode ? 'on' : null);
    this.setAttr(ROOT_ATTR.balances, cfg.hideBalances || cfg.privacyMode ? 'on' : null);

    // Own nickname styling (only this browser sees it).
    const ownProfile = this.isOwnProfile(userId);
    this.setAttr(ROOT_ATTR.ownProfile, ownProfile ? '1' : null);
    this.setStyle(STYLE_IDS.nickname, nicknameStylesheet(cfg.nickname, userId));
    this.setAttr(ROOT_ATTR.nickname, cfg.nickname.enabled ? 'on' : null);

    // Extension-only profile badge next to the own name on the own profile page.
    this.syncProfileBadge(ownProfile ? cfg.profileBadge : '');

    // Experimental funpay.com theme.
    if (cfg.themeFunPay) {
      this.setStyle(
        STYLE_IDS.theme,
        funpayThemeStylesheet(funpayPalette(cfg.theme, cfg.accentColor, this.deps.prefersDark())),
      );
      this.setAttr(ROOT_ATTR.theme, 'dark');
    } else {
      this.setStyle(STYLE_IDS.theme, '');
      this.setAttr(ROOT_ATTR.theme, null);
    }

    this.syncBackground(cfg);
  }

  /** Own profile = the URL's user id is ours, or (fallback) the profile title equals our header username. */
  private isOwnProfile(userId: string | null): boolean {
    if (isOwnProfilePath(this.deps.getPath(), userId)) return true;
    if (!PROFILE_PATH.test(this.deps.getPath())) return false;
    const username = cleanText(this.deps.getUsername?.() ?? '');
    const title = cleanText(this.doc.querySelector(OWN_NAME_TARGETS.profile)?.textContent ?? '');
    return !!username && title === username;
  }

  private syncProfileBadge(text: string): void {
    const clean = cleanText(text, 40);
    const existing = this.doc.querySelector<HTMLElement>(`.${PROFILE_BADGE_CLASS}`);
    if (!clean) {
      existing?.remove();
      this.setStyle(STYLE_IDS.badge, '');
      return;
    }
    const name = this.doc.querySelector(OWN_NAME_TARGETS.profile);
    if (!name) return;
    this.setStyle(STYLE_IDS.badge, profileBadgeStylesheet());
    const badge = existing ?? this.doc.createElement('span');
    badge.className = PROFILE_BADGE_CLASS;
    badge.setAttribute('data-funpro', 'profile-badge');
    badge.title = 'FunPro: visible only in your browser';
    if (badge.textContent !== clean) badge.textContent = clean;
    if (!existing) name.insertAdjacentElement('afterend', badge);
  }

  private removeBackground(): void {
    this.bgToken++;
    this.bgLoadedFor = null;
    this.doc.getElementById(BACKGROUND_LAYER_ID)?.remove();
    this.setStyle(STYLE_IDS.layer, '');
    this.setAttr(ROOT_ATTR.background, null);
  }

  private showBackground(dataUrl: string, opacity: number): void {
    let layer = this.doc.getElementById(BACKGROUND_LAYER_ID);
    if (!layer) {
      layer = this.doc.createElement('div');
      layer.id = BACKGROUND_LAYER_ID;
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('data-funpro', 'background');
      (this.doc.body ?? this.root).appendChild(layer);
    }
    this.setStyle(STYLE_IDS.layer, backgroundLayerStylesheet());
    layer.style.backgroundImage = `url("${dataUrl}")`;
    layer.style.opacity = String(Math.min(1, Math.max(0, opacity)));
    this.setAttr(ROOT_ATTR.background, 'on');
  }

  private syncBackground(cfg: FunPayAppearanceConfig): void {
    if (!cfg.themeFunPay || !cfg.backgroundImageAssetId) {
      this.removeBackground();
      return;
    }
    const layer = this.doc.getElementById(BACKGROUND_LAYER_ID);
    if (this.bgLoadedFor === cfg.backgroundImageAssetId && layer) {
      layer.style.opacity = String(Math.min(1, Math.max(0, cfg.backgroundOpacity)));
      return;
    }
    const token = ++this.bgToken;
    const wanted = cfg.backgroundImageAssetId;
    void this.deps
      .loadBackground()
      .then((bg) => {
        if (token !== this.bgToken) return; // superseded by a newer settings change
        if (!bg || bg.assetId !== wanted || !isSafeImageDataUrl(bg.dataUrl)) {
          this.removeBackground();
          return;
        }
        this.bgLoadedFor = wanted;
        this.showBackground(bg.dataUrl, cfg.backgroundOpacity);
      })
      .catch(() => {
        if (token === this.bgToken) this.removeBackground();
      });
  }

  destroy(): void {
    this.removeBackground();
    for (const id of Object.values(STYLE_IDS)) this.doc.getElementById(id)?.remove();
    this.doc.querySelector(`.${PROFILE_BADGE_CLASS}`)?.remove();
    for (const attr of Object.values(ROOT_ATTR)) this.root.removeAttribute(attr);
  }
}
