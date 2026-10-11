import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ThemeIdSchema } from '@/core/settings/schema';
import { accentContrast, accentOverrides, CONCRETE_THEME_IDS, contrastRatio, PALETTE_TOKENS, readableTextOn, resolveTheme, THEMES } from '@/features/appearance/themes';

const css = readFileSync(join(__dirname, '../../../src/ui/styles.css'), 'utf8');

/** `[data-theme='x'] { --fp-token: #hex; ... }` blocks from styles.css. */
function cssPalettes(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of css.matchAll(/\[data-theme='([a-z-]+)'\]\s*\{([^}]*)\}/g)) {
    const vars: Record<string, string> = {};
    for (const d of m[2]!.matchAll(/--fp-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[d[1]!] = d[2]!.toLowerCase();
    if (Object.keys(vars).length) out[m[1]!] = vars;
  }
  return out;
}

describe('theme registry', () => {
  it('covers every theme id of the settings schema', () => {
    const ids = ThemeIdSchema.options.filter((t) => t !== 'system');
    expect([...CONCRETE_THEME_IDS].sort()).toEqual([...ids].sort());
    expect(ids.length).toBeGreaterThanOrEqual(8); // light, dark + ≥ 4 original custom themes + high contrast
  });

  it('mirrors styles.css exactly (no drift between CSS and TS palettes)', () => {
    const fromCss = cssPalettes();
    for (const id of CONCRETE_THEME_IDS) {
      expect(fromCss[id], `missing [data-theme='${id}'] block`).toBeDefined();
      for (const token of PALETTE_TOKENS) expect(fromCss[id]![token], `${id} --fp-${token}`).toBe(THEMES[id].palette[token].toLowerCase());
    }
  });

  it('declares color-scheme matching the palette', () => {
    for (const id of CONCRETE_THEME_IDS) {
      const block = new RegExp(`\\[data-theme='${id}'\\]\\s*\\{([^}]*)\\}`).exec(css)![1]!;
      expect(block, id).toContain(`color-scheme: ${THEMES[id].scheme}`);
    }
  });

  it('meets WCAG contrast minimums in every theme', () => {
    const problems: string[] = [];
    const need = (id: string, a: string, b: string, min: number, pa: string, pb: string) => {
      const r = contrastRatio(pa, pb);
      if (r < min) problems.push(`${id}: ${a} on ${b} = ${r.toFixed(2)} < ${min}`);
    };
    for (const id of CONCRETE_THEME_IDS) {
      const p = THEMES[id].palette;
      const strict = id === 'contrast';
      for (const surface of ['bg', 'surface', 'surface-2'] as const) {
        need(id, 'fg', surface, strict ? 15 : 7, p.fg, p[surface]);
        need(id, 'muted', surface, strict ? 7 : 4.5, p.muted, p[surface]);
      }
      need(id, 'accent-fg', 'accent', strict ? 7 : 4.5, p['accent-fg'], p.accent);
      need(id, 'accent', 'surface', 4.5, p.accent, p.surface);
      need(id, 'accent', 'accent-soft', 4.5, p.accent, p['accent-soft']);
      for (const tone of ['success', 'warning', 'danger', 'info'] as const) need(id, tone, 'surface', 4.5, p[tone], p.surface);
      need(id, 'teal', 'surface', 3, p.teal, p.surface);
      if (strict) need(id, 'border', 'surface', 3, p.border, p.surface);
    }
    expect(problems).toEqual([]);
  });
});

describe('resolveTheme', () => {
  it('follows the OS for "system" and passes concrete themes through', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('aurora', false)).toBe('aurora');
    expect(resolveTheme('contrast', false)).toBe('contrast');
  });
});

describe('custom accent', () => {
  it('derives a legible foreground and a soft variant', () => {
    expect(readableTextOn('#ffd60a')).toBe('#000000');
    expect(readableTextOn('#1d4ed8')).toBe('#ffffff');
    const o = accentOverrides('#1D4ED8', 'light');
    expect(o).toMatchObject({ accent: '#1d4ed8', 'accent-fg': '#ffffff' });
    expect(o['accent-soft']).toMatch(/^#[0-9a-f]{6}$/);
    expect(accentOverrides('not-a-colour', 'light')).toEqual({});
    expect(accentContrast('#ffffff', 'light')).toBeLessThan(1.1);
  });
});
