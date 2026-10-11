import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@/core/settings/schema';
import { collectRows, removePriceBadges, renderPriceBadges, STYLE_ID } from '@/content/enhancements/listings/badges';
import { csLang, tr } from '@/content/enhancements/listings/i18n';
import { HELPER_HOST_ID, mountOfferHelper } from '@/content/enhancements/listings/offer-helper';
import { ownPageOf } from '@/content/enhancements/listings';
import { RoundingModeSchema, SkipReasonSchema, WarningCodeSchema, PlanStatusSchema, PlanSourceSchema, ItemResultStatusSchema, BulkOperationSchema } from '@/features/listings/bulk-plan';
import { TEMPLATE_FIELD_KEYS } from '@/features/listings/clone';
import dict from '@/ui/i18n/locales/listings';
import { fixtureDoc } from '../../../fixtures';

const ROOT = join(__dirname, '..', '..', '..', '..');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('listings i18n', () => {
  const en = dict.en as Record<string, string>;
  const ru = dict.ru as Record<string, string>;
  const uk = dict.uk as Record<string, string>;

  it('has the same keys and placeholders in en, ru and uk', () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(ru).sort()).toEqual(keys);
    expect(Object.keys(uk).sort()).toEqual(keys);
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      expect(vars(ru[k]!), `ru ${k}`).toEqual(vars(en[k]!));
      expect(vars(uk[k]!), `uk ${k}`).toEqual(vars(en[k]!));
    }
  });

  it('defines every static key used by the listings UI and on-page helpers', () => {
    const files = [
      ...filesUnder(join(ROOT, 'src/dashboard/pages/listings')),
      join(ROOT, 'src/dashboard/pages/ListingsPage.tsx'),
      ...filesUnder(join(ROOT, 'src/content/enhancements/listings')),
      join(ROOT, 'src/content/enhancements/listings.ts'),
    ];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/['"`](listings\.[\w.]+)['"`]/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(200);
    const missing = [...used].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it('defines every dynamically built key', () => {
    const dyn: string[] = [
      ...['idle', 'waiting', 'raised', 'error', 'needs_selection'].map((s) => `listings.bump.state.${s}`),
      ...BulkOperationSchema.options.map((o) => `listings.op.${o.shape.kind.value}`),
      ...RoundingModeSchema.options.map((r) => `listings.rounding.${r}`),
      ...SkipReasonSchema.options.map((s) => `listings.skip.${s}`),
      ...WarningCodeSchema.options.flatMap((w) => [`listings.warn.${w}`, `listings.warn.${w}.hint`]),
      ...PlanStatusSchema.options.map((s) => `listings.planStatus.${s}`),
      ...PlanSourceSchema.options.map((s) => `listings.source.${s}`),
      ...ItemResultStatusSchema.options.map((s) => `listings.result.${s}`),
      ...['bulk_edit', 'import', 'manual', 'reorder'].map((k) => `listings.backupKind.${k}`),
      ...['update', 'unchanged', 'unknown'].map((k) => `listings.io.row.${k}`),
      ...['calc', 'manual_node', 'category', 'default'].map((k) => `listings.fee.source.${k}`),
      ...['secrets_not_copied', 'auto_delivery_off', 'inactive_copy', 'multi_value_skipped', 'template_applied'].map((k) => `listings.clone.warn.${k}`),
      ...TEMPLATE_FIELD_KEYS.map((k) => `listings.field.${k.replace(/[[\]]+/g, '.').replace(/\.+$/, '').replace(/^fields\./, '')}`),
      ...['emergency_stop', 'awaiting_authorization', 'no_tab', 'unavailable_in_build', 'no_targets'].map((k) => `listings.err.${k}`),
    ];
    expect(dyn.filter((k) => !(k in en))).toEqual([]);
  });

  it('contains no invisible or control characters', () => {
    // Code-point ranges (no escapes in source): C0 controls except tab/LF/CR, NBSP, zero-width and bidi marks, word joiners, BOM.
    const ranges: [number, number][] = [[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0xa0, 0xa0], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff]];
    const isBad = (s: string) => [...s].some((ch) => ranges.some(([a, b]) => ch.codePointAt(0)! >= a && ch.codePointAt(0)! <= b));
    for (const lang of [en, ru, uk]) for (const [k, v] of Object.entries(lang)) expect(isBad(v), k).toBe(false);
  });

  it('translates on-page texts with the page locale as fallback', () => {
    expect(csLang('auto', 'uk')).toBe('uk');
    expect(csLang('en', 'ru')).toBe('en');
    expect(tr('ru', 'listings.cs.profit', { value: '10 ₽' })).toBe('прибыль 10 ₽');
    expect(tr('en', 'listings.missing.key')).toBe('listings.missing.key');
  });
});

describe('on-page price badges', () => {
  const fees = () => {
    const f = defaultSettings().fees;
    f.nodeCommission = { '501': { pct: 8, source: 'calc', at: 1 } };
    return f;
  };

  it('recognises own pages only', () => {
    expect(ownPageOf('/lots/501/trade', null)).toEqual({ kind: 'own_lots', nodeId: '501' });
    expect(ownPageOf('/en/lots/501/trade', null)).toEqual({ kind: 'own_lots', nodeId: '501' });
    expect(ownPageOf('/users/1000001/', '1000001')).toEqual({ kind: 'profile' });
    expect(ownPageOf('/users/2000002/', '1000001')).toBeNull();
    expect(ownPageOf('/uk/lots/offerEdit', null)).toBe('offer_edit');
    expect(ownPageOf('/lots/501/', null)).toBeNull();
  });

  it('adds net/profit badges next to prices on the own lots page, idempotently, and removes them', () => {
    const doc = fixtureDoc('own-lots.html');
    const rows = collectRows(doc, { kind: 'own_lots', nodeId: '501' });
    expect(rows.map((r) => r.listing.id)).toEqual(['9000001', '9000002']);
    const opts = { fees: fees(), costs: { '9000001': 15_000 }, hideProfit: false, lang: 'en' as const };
    expect(renderPriceBadges(doc, rows, opts)).toBe(2);
    renderPriceBadges(doc, rows, opts);
    const boxes = doc.querySelectorAll('.funpro-lst-badges');
    expect(boxes).toHaveLength(2);
    const first = boxes[0]!.textContent!;
    // 199.99 with 8 % (from FunPay calc) → net 185.17; profit 185.17 − 150.00 = 35.17
    expect(first).toContain('185.17');
    expect(first).toContain('net');
    expect(first).not.toContain('≈');
    expect(first).toContain('profit');
    expect(first).toContain('35.17');
    expect(boxes[0]!.closest('.tc-price')).not.toBeNull();
    expect(doc.getElementById(STYLE_ID)).not.toBeNull();
    removePriceBadges(doc);
    expect(doc.querySelectorAll('.funpro-lst-badges')).toHaveLength(0);
    expect(doc.getElementById(STYLE_ID)).toBeNull();
  });

  it('marks estimates, hides profit in privacy mode and shows promo on the own profile', () => {
    const doc = fixtureDoc('profile.html');
    const f = defaultSettings().fees;
    f.defaultCommissionPct = 10;
    const rows = collectRows(doc, { kind: 'profile' });
    expect(rows.map((r) => [r.listing.id, r.listing.nodeId])).toEqual([
      ['9000001', '501'],
      ['9000003', '777'],
    ]);
    renderPriceBadges(doc, rows, { fees: f, costs: { '9000001': 100 }, hideProfit: true, lang: 'ru' });
    const texts = Array.from(doc.querySelectorAll('.funpro-lst-badges')).map((b) => b.textContent ?? '');
    expect(texts[0]).toContain('≈');
    expect(texts[0]).not.toContain('прибыль');
    expect(texts[1]).toContain('промо');
  });
});

describe('offer editor helper', () => {
  function ctx() {
    const cbs: (() => void)[] = [];
    const ac = new AbortController();
    return {
      ctx: { onInvalidated: (cb: () => void) => cbs.push(cb), signal: ac.signal },
      invalidate: () => {
        ac.abort();
        cbs.forEach((c) => c());
      },
    };
  }

  it('converts a buyer price into the editor price using the page\'s own buyer-price table', () => {
    const doc = fixtureDoc('offer-edit.html');
    const { ctx: c, invalidate } = ctx();
    const opened: string[] = [];
    const namedBefore = doc.querySelector('form')!.querySelectorAll('[name]').length;
    const cleanup = mountOfferHelper(doc, c, { fees: defaultSettings().fees, lang: 'en', openInDashboard: (id) => opened.push(id) });
    expect(cleanup).toBeTypeOf('function');
    const host = doc.getElementById(HELPER_HOST_ID)!;
    const root = host.shadowRoot!;
    // commission from the page: cheapest 211.00 vs price 199.99 → 5.51 %
    expect(root.textContent).toContain('5.51%');
    expect(root.textContent).toContain('from this page');
    const input = root.querySelector('input')!;
    input.value = '215.99';
    input.dispatchEvent(new Event('input'));
    // 215.99 / 1.0551 = 204.71 (rounded down)
    expect(root.textContent).toContain('204.71');
    const price = doc.querySelector<HTMLInputElement>('input[name="price"]')!;
    let changed = 0;
    price.addEventListener('input', () => changed++);
    const [useBtn, translateBtn] = Array.from(root.querySelectorAll('button'));
    useBtn!.click();
    expect(price.value).toBe('204.71');
    expect(changed).toBe(1);
    translateBtn!.click();
    expect(opened).toEqual(['9000001']);
    // the helper never becomes part of FunPay's form submission
    expect(doc.querySelector('form')!.querySelectorAll('[name]')).toHaveLength(namedBefore);
    expect(doc.querySelector('form')!.contains(host)).toBe(false);
    invalidate();
    expect(doc.getElementById(HELPER_HOST_ID)).toBeNull();
  });

  it('falls back to the saved commission (estimate) and mounts only once', () => {
    const doc = fixtureDoc('listings-offer-new.html');
    const { ctx: c } = ctx();
    const f = defaultSettings().fees;
    f.nodeCommission = { '501': { pct: 10, source: 'manual', at: 1 } };
    expect(mountOfferHelper(doc, c, { fees: f, lang: 'en' })).not.toBeNull();
    expect(mountOfferHelper(doc, c, { fees: f, lang: 'en' })).toBeNull();
    const root = doc.getElementById(HELPER_HOST_ID)!.shadowRoot!;
    expect(root.textContent).toContain('estimate from FunPro settings');
    expect(root.querySelectorAll('button')).toHaveLength(1); // no translate link for a new offer
  });

  it('does nothing outside the offer editor', () => {
    const { ctx: c } = ctx();
    expect(mountOfferHelper(fixtureDoc('sales.html'), c, { fees: defaultSettings().fees, lang: 'en' })).toBeNull();
  });
});
