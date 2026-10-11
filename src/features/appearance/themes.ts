import type { ThemeId } from '@/core/settings/schema';

/**
 * Theme registry. The CSS in `src/ui/styles.css` is what renders extension pages; this module mirrors
 * the palettes so that non-CSS consumers (theme picker metadata, the funpay.com theme, contrast
 * checks) use the same values. `tests/unit/ui/themes.test.ts` fails if the two drift apart and
 * enforces WCAG contrast minimums for every palette.
 */
export type ConcreteThemeId = Exclude<ThemeId, 'system'>;

export const PALETTE_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'border',
  'fg',
  'muted',
  'accent',
  'accent-fg',
  'accent-soft',
  'teal',
  'success',
  'warning',
  'danger',
  'info',
] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type Palette = Record<PaletteToken, string>;

export interface ThemeDef {
  id: ConcreteThemeId;
  scheme: 'light' | 'dark';
  /** i18n key of the display name (src/ui/i18n/locales/settings.ts). */
  labelKey: string;
  palette: Palette;
}

export const THEMES: Record<ConcreteThemeId, ThemeDef> = {
  light: {
    id: 'light',
    scheme: 'light',
    labelKey: 'appearance.theme.light',
    palette: {
      bg: '#f6f7fb',
      surface: '#ffffff',
      'surface-2': '#f0f1f7',
      border: '#e1e3ee',
      fg: '#171a2b',
      muted: '#5d6385',
      accent: '#6845f7',
      'accent-fg': '#ffffff',
      'accent-soft': '#f1edff',
      teal: '#0b7d71',
      success: '#15803d',
      warning: '#a15c07',
      danger: '#d23b4c',
      info: '#2563eb',
    },
  },
  dark: {
    id: 'dark',
    scheme: 'dark',
    labelKey: 'appearance.theme.dark',
    palette: {
      bg: '#0f1120',
      surface: '#171a2e',
      'surface-2': '#1f2340',
      border: '#2c3156',
      fg: '#e9ebff',
      muted: '#9aa0c7',
      accent: '#9b85ff',
      'accent-fg': '#0f1120',
      'accent-soft': '#231d4a',
      teal: '#2cc8b5',
      success: '#3ccf86',
      warning: '#f0b450',
      danger: '#ff6b7d',
      info: '#6ea3ff',
    },
  },
  midnight: {
    id: 'midnight',
    scheme: 'dark',
    labelKey: 'appearance.theme.midnight',
    palette: {
      bg: '#05070d',
      surface: '#0c111c',
      'surface-2': '#121a2a',
      border: '#1e2a40',
      fg: '#dfe8ff',
      muted: '#8496b8',
      accent: '#3fa9ff',
      'accent-fg': '#04121f',
      'accent-soft': '#0f2a44',
      teal: '#39d0c0',
      success: '#39d38b',
      warning: '#ffc261',
      danger: '#ff6f7f',
      info: '#7ab8ff',
    },
  },
  forest: {
    id: 'forest',
    scheme: 'dark',
    labelKey: 'appearance.theme.forest',
    palette: {
      bg: '#0f1713',
      surface: '#16211b',
      'surface-2': '#1d2c24',
      border: '#2a3d32',
      fg: '#e4f2e9',
      muted: '#94b3a1',
      accent: '#5fd68f',
      'accent-fg': '#0b140f',
      'accent-soft': '#1f3a2a',
      teal: '#49c6b2',
      success: '#5fd68f',
      warning: '#e8c15a',
      danger: '#ff7a7a',
      info: '#79b6ff',
    },
  },
  sunset: {
    id: 'sunset',
    scheme: 'light',
    labelKey: 'appearance.theme.sunset',
    palette: {
      bg: '#fff7f1',
      surface: '#ffffff',
      'surface-2': '#fdeee4',
      border: '#f3d9c8',
      fg: '#2b1a14',
      muted: '#7f5d50',
      accent: '#c2410c',
      'accent-fg': '#ffffff',
      'accent-soft': '#fff1e9',
      teal: '#0c7a70',
      success: '#237a42',
      warning: '#9a5b00',
      danger: '#c92a3a',
      info: '#1f63c7',
    },
  },
  mono: {
    id: 'mono',
    scheme: 'light',
    labelKey: 'appearance.theme.mono',
    palette: {
      bg: '#fafafa',
      surface: '#ffffff',
      'surface-2': '#f2f2f2',
      border: '#d9d9d9',
      fg: '#111111',
      muted: '#555555',
      accent: '#111111',
      'accent-fg': '#ffffff',
      'accent-soft': '#e8e8e8',
      teal: '#333333',
      success: '#1d7a3e',
      warning: '#8a5a00',
      danger: '#b3261e',
      info: '#1a4fb3',
    },
  },
  aurora: {
    id: 'aurora',
    scheme: 'dark',
    labelKey: 'appearance.theme.aurora',
    palette: {
      bg: '#0b1416',
      surface: '#111d21',
      'surface-2': '#172a2f',
      border: '#24404a',
      fg: '#e3f6f3',
      muted: '#8fb3b0',
      accent: '#5eead4',
      'accent-fg': '#062421',
      'accent-soft': '#123a38',
      teal: '#b39dff',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#fb7185',
      info: '#7dd3fc',
    },
  },
  contrast: {
    id: 'contrast',
    scheme: 'dark',
    labelKey: 'appearance.theme.contrast',
    palette: {
      bg: '#000000',
      surface: '#000000',
      'surface-2': '#0d0d0d',
      border: '#ffffff',
      fg: '#ffffff',
      muted: '#e6e6e6',
      accent: '#ffd60a',
      'accent-fg': '#000000',
      'accent-soft': '#332b00',
      teal: '#00e5ff',
      success: '#3dff8a',
      warning: '#ffd60a',
      danger: '#ff6b6b',
      info: '#6cb6ff',
    },
  },
};

export const CONCRETE_THEME_IDS = Object.keys(THEMES) as ConcreteThemeId[];

export function resolveTheme(theme: ThemeId, prefersDark: boolean): ConcreteThemeId {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return THEMES[theme] ? theme : 'light';
}

// ---- colour maths (WCAG 2.x) ---------------------------------------------------------------

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = HEX.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(m[1]!, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on `background`. */
export function readableTextOn(background: string): '#000000' | '#ffffff' {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff') ? '#000000' : '#ffffff';
}

/** Mix two colours (0 = a, 1 = b) in sRGB. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(HEX.exec(a)?.[1] ?? '000000', 16);
  const pb = Number.parseInt(HEX.exec(b)?.[1] ?? '000000', 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * Math.min(1, Math.max(0, t)));
  };
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * CSS variable overrides for a custom accent colour on top of a theme. The foreground on the accent
 * is chosen for legibility, and the soft variant is mixed with the theme surface.
 */
export function accentOverrides(accent: string, themeId: ConcreteThemeId): Partial<Palette> {
  if (!isHexColor(accent)) return {};
  const base = THEMES[themeId].palette;
  return {
    accent: accent.toLowerCase(),
    'accent-fg': readableTextOn(accent),
    'accent-soft': mixHex(base.surface, accent, base.surface === '#000000' || THEMES[themeId].scheme === 'dark' ? 0.22 : 0.12),
  };
}

/** Contrast of a custom accent against the theme surface (UI components need ≥ 3:1, text ≥ 4.5:1). */
export function accentContrast(accent: string, themeId: ConcreteThemeId): number {
  return isHexColor(accent) ? contrastRatio(accent, THEMES[themeId].palette.surface) : 0;
}
