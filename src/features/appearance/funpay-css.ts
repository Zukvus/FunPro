import type { Settings, ThemeId } from '@/core/settings/schema';
import {
  OWN_NAME_TARGETS,
  privacySelectorList,
  scopeSelectors,
  splitSelectorList,
  THEME_TARGETS,
  type PrivacyCategory,
} from './funpay-selectors';
import { accentOverrides, isHexColor, resolveTheme, THEMES, type Palette } from './themes';

/**
 * CSS text injected into funpay.com by the appearance content enhancement. Everything is scoped to
 * `data-fp-*` attributes on <html>, so turning a feature off is just removing an attribute, and the
 * generated text only ever contains values validated here (hex colours, digit-only user ids,
 * fixed font stacks) — never free text.
 */

/** Attribute names on document.documentElement. */
export const ROOT_ATTR = {
  privacy: 'data-fp-privacy',
  balances: 'data-fp-hide-balances',
  nickname: 'data-fp-nick',
  ownProfile: 'data-fp-own-profile',
  theme: 'data-fp-theme',
  background: 'data-fp-bg',
} as const;

const PRIVACY_CATEGORIES: PrivacyCategory[] = ['usernames', 'chatPreviews', 'orderIds', 'balances'];

/** id of the injected privacy <style> (shared by the early document_start helper and the controller). */
export const PRIVACY_STYLE_ID = 'funpro-privacy-style';

function rule(selectors: string, body: string): string {
  return `${selectors} {\n  ${body}\n}`;
}

/** Hover / keyboard-focus reveal for every scoped selector (+ its focusable descendants). */
function revealRule(scoped: string): string {
  const reveal = scoped
    .split(',\n')
    .flatMap((s) => [`${s}:hover`, `${s}:focus`, `${s}:focus-within`])
    .join(',\n');
  return rule(reveal, 'filter: none !important;');
}

/** Static stylesheet: privacy mode blurs every target; "hide balances" blurs balances only. */
export function privacyStylesheet(): string {
  const all = scopeSelectors(`html[${ROOT_ATTR.privacy}='on']`, privacySelectorList(PRIVACY_CATEGORIES));
  const balances = scopeSelectors(`html[${ROOT_ATTR.balances}='on']`, privacySelectorList(['balances']));
  const blur = 'filter: blur(6px) !important; transition: filter 0.15s ease;';
  return [
    '/* FunPro privacy mode — hover or focus an element to reveal it. */',
    rule(all, blur),
    rule(balances, blur),
    revealRule(all),
    revealRule(balances),
  ].join('\n');
}

const FONT_STACKS: Record<Settings['appearance']['nickname']['font'], string | null> = {
  inherit: null,
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  rounded: "'Nunito', 'Varela Round', ui-rounded, 'Segoe UI', system-ui, sans-serif",
};

/** Own-nickname styling (colour / gradient / font / weight) as seen by the seller only. */
export function nicknameStylesheet(
  nick: Settings['appearance']['nickname'],
  ownUserId: string | null,
): string {
  if (!nick.enabled || !isHexColor(nick.color)) return '';
  const scope = `html[${ROOT_ATTR.nickname}='on']`;
  const selectors = [
    `${scope} ${OWN_NAME_TARGETS.header}`,
    `${scope}[${ROOT_ATTR.ownProfile}='1'] ${OWN_NAME_TARGETS.profile}`,
  ];
  // User ids are digits only (validated) so they are safe inside attribute selectors.
  if (ownUserId && /^\d{1,12}$/.test(ownUserId)) {
    for (const link of splitSelectorList(OWN_NAME_TARGETS.chatAuthorLink))
      selectors.push(`${scope} ${link}[href*="/users/${ownUserId}/"]`);
    for (const name of splitSelectorList(OWN_NAME_TARGETS.mediaUserName)) {
      selectors.push(
        `${scope} ${name} [data-href*="/users/${ownUserId}/"]`,
        `${scope} ${name} a[href*="/users/${ownUserId}/"]`,
      );
    }
  }
  const decl: string[] = [];
  const gradient = nick.gradientTo && isHexColor(nick.gradientTo) ? nick.gradientTo : null;
  if (gradient) {
    decl.push(
      `background-image: linear-gradient(90deg, ${nick.color}, ${gradient}) !important;`,
      '-webkit-background-clip: text !important;',
      'background-clip: text !important;',
      'color: transparent !important;',
      '-webkit-text-fill-color: transparent !important;',
    );
  } else {
    decl.push(`color: ${nick.color} !important;`, `-webkit-text-fill-color: ${nick.color} !important;`);
  }
  if (nick.bold) decl.push('font-weight: 700 !important;');
  const font = FONT_STACKS[nick.font];
  if (font) decl.push(`font-family: ${font} !important;`);
  return `/* FunPro nickname style (visible only in your browser) */\n${rule(selectors.join(',\n'), decl.join('\n  '))}`;
}

/** Palette used on funpay.com: the selected theme if it is dark, otherwise FunPro Dark. */
export function funpayPalette(theme: ThemeId, accentColor: string | null, prefersDark: boolean): Palette {
  const resolved = resolveTheme(theme, prefersDark);
  const id = THEMES[resolved].scheme === 'dark' ? resolved : 'dark';
  return { ...THEMES[id].palette, ...(accentColor ? accentOverrides(accentColor, id) : {}) };
}

/** Experimental dark theme for funpay.com: colours only, conservative selectors, fully scoped. */
export function funpayThemeStylesheet(palette: Palette): string {
  const vars = Object.entries(palette)
    .filter(([, v]) => isHexColor(v))
    .map(([k, v]) => `--fpx-${k}: ${v};`)
    .join('\n  ');
  const on = `html[${ROOT_ATTR.theme}='dark']`;
  const t = THEME_TARGETS;
  return [
    '/* FunPro experimental funpay.com theme (colours only). */',
    rule(on, `${vars}\n  color-scheme: dark;\n  background-color: var(--fpx-bg) !important;`),
    rule(`${on} body`, 'background-color: var(--fpx-bg) !important;\n  color: var(--fpx-fg) !important;'),
    rule(
      scopeSelectors(on, t.surfaces),
      'background-color: var(--fpx-surface) !important;\n  color: var(--fpx-fg) !important;\n  border-color: var(--fpx-border) !important;',
    ),
    rule(
      scopeSelectors(on, [t.highlightedRows.info]),
      'background-color: color-mix(in srgb, var(--fpx-info) 16%, var(--fpx-surface)) !important;',
    ),
    rule(
      scopeSelectors(on, [t.highlightedRows.warning]),
      'background-color: color-mix(in srgb, var(--fpx-warning) 14%, var(--fpx-surface)) !important;',
    ),
    rule(scopeSelectors(on, t.muted), 'color: var(--fpx-muted) !important;'),
    rule(
      scopeSelectors(on, t.fields),
      'background-color: var(--fpx-surface-2) !important;\n  color: var(--fpx-fg) !important;\n  border-color: var(--fpx-border) !important;',
    ),
    rule(
      scopeSelectors(on, t.buttons),
      'background-color: var(--fpx-surface-2) !important;\n  color: var(--fpx-fg) !important;\n  border-color: var(--fpx-border) !important;',
    ),
    rule(scopeSelectors(on, t.rules), 'border-color: var(--fpx-border) !important;'),
    rule(`${on} a:not(.btn):not(.tc-item):not(.contact-item)`, 'color: var(--fpx-accent) !important;'),
    // With a background image, let it show through the page canvas.
    rule(`html[${ROOT_ATTR.background}='on'] body`, 'background-color: transparent !important;'),
  ].join('\n');
}

export const BACKGROUND_LAYER_ID = 'funpro-bg-layer';

export function backgroundLayerStylesheet(): string {
  return rule(
    `#${BACKGROUND_LAYER_ID}`,
    'position: fixed !important;\n  inset: 0 !important;\n  z-index: -1 !important;\n  pointer-events: none !important;\n  background-size: cover !important;\n  background-position: center !important;\n  background-repeat: no-repeat !important;',
  );
}

export const PROFILE_BADGE_CLASS = 'funpro-profile-badge';

export function profileBadgeStylesheet(): string {
  return rule(
    `.${PROFILE_BADGE_CLASS}`,
    [
      'display: inline-block;',
      'margin-left: 8px;',
      'padding: 1px 8px;',
      'border-radius: 999px;',
      'font-size: 12px;',
      'line-height: 18px;',
      'font-weight: 600;',
      'vertical-align: middle;',
      'background: #ece7ff;',
      'color: #3b1fb8;',
      'border: 1px solid #c9bcff;',
    ].join('\n  '),
  );
}

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Only data URLs of allowed image types may reach a CSS `url()` (prevents CSS injection). */
export function isSafeImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 5_000_000 && DATA_URL.test(value);
}
