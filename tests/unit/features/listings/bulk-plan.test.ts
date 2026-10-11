import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@/core/settings/schema';
import {
  applyPct,
  BulkPlanSchema,
  buildBulkPlan,
  deleteConfirmationPhrase,
  EN_DESC,
  EN_SUMMARY,
  MAX_EXECUTABLE_ITEMS,
  priceMatches,
  summarizePlan,
  type BulkOperation,
  type EnText,
} from '@/features/listings/bulk-plan';
import { makeListing } from './helpers';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const fees = defaultSettings().fees;
const ctx = { fees, now: NOW };

function plan(op: BulkOperation, listings = [makeListing('1'), makeListing('2', { active: false })], c: Partial<typeof ctx> & { enTexts?: Map<string, EnText> } = {}) {
  return buildBulkPlan(listings, op, { ...ctx, ...c });
}

describe('applyPct rounding modes', () => {
  it.each([
    ['minor', 19_999, 10, 21_999], // 21998.9 → 21999
    ['unit_nearest', 19_999, 10, 22_000],
    ['unit_up', 19_999, 10, 22_000],
    ['unit_down', 19_999, 10, 21_900],
    ['ten_nearest', 19_999, 10, 22_000],
    ['end_99', 19_999, 10, 21_999],
    ['unit_up', 10_000, 10, 11_000], // exact: no float drift to 111.00
    ['end_99', 10_000, 10, 10_999],
    ['minor', 10_000, -15, 8_500],
    ['unit_down', 12_345, -50, 6_100],
    ['minor', 101, 0.5, 102], // 101.505 → 102 (half up)
    ['minor', 333, 33.33, 444], // 443.99 → 444
  ] as const)('%s: %i %+d%% → %i', (mode, before, pct, after) => {
    expect(applyPct(before, pct, mode)).toBe(after);
  });
});

describe('buildBulkPlan', () => {
  it('enable / disable produce checkbox changes and flag listings already in that state', () => {
    const en = plan({ kind: 'enable' });
    expect(en.items.map((i) => [i.changes.active, i.after.active, i.warnings])).toEqual([
      ['on', true, ['already_in_state']],
      ['on', true, []],
    ]);
    const dis = plan({ kind: 'disable' });
    expect(dis.items.map((i) => [i.changes.active, i.warnings])).toEqual([
      ['', []],
      ['', ['already_in_state']],
    ]);
    expect(en.status).toBe('draft');
    expect(en.items.every((i) => i.expectPriceMinor === null && !i.skip)).toBe(true);
  });

  it('set_price is absolute (no concurrency expectation) and validated', () => {
    const p = plan({ kind: 'set_price', priceMinor: 12_345 });
    expect(p.items[0]).toMatchObject({ changes: { price: '123.45' }, after: { priceMinor: 12_345 }, expectPriceMinor: null, skip: null });
    const zero = plan({ kind: 'set_price', priceMinor: 0 });
    expect(zero.items[0]).toMatchObject({ skip: 'invalid_price', warnings: ['price_non_positive'] });
    expect(zero.items[0]!.changes.price).toBeUndefined();
    const same = plan({ kind: 'set_price', priceMinor: 10_000 });
    expect(same.items[0]!.warnings).toContain('already_in_state');
    expect(same.items[0]!.skip).toBeNull();
  });

  it('relative price changes carry the old price for optimistic concurrency', () => {
    const p = plan({ kind: 'adjust_pct', pct: 10, rounding: 'minor' });
    expect(p.items[0]).toMatchObject({ before: { priceMinor: 10_000 }, after: { priceMinor: 11_000 }, changes: { price: '110.00' }, expectPriceMinor: 10_000 });
    const f = plan({ kind: 'adjust_fixed', deltaMinor: -2_500 });
    expect(f.items[0]).toMatchObject({ after: { priceMinor: 7_500 }, changes: { price: '75.00' }, expectPriceMinor: 10_000 });
  });

  it('skips relative changes that change nothing, have no known price, or go to ≤ 0', () => {
    expect(plan({ kind: 'adjust_pct', pct: 0, rounding: 'minor' }).items[0]!.skip).toBe('no_change');
    expect(plan({ kind: 'adjust_fixed', deltaMinor: 1 }, [makeListing('1', {}, 0, 'UNKNOWN')]).items[0]!.skip).toBe('no_price');
    const neg = plan({ kind: 'adjust_fixed', deltaMinor: -10_000 });
    expect(neg.items[0]).toMatchObject({ skip: 'invalid_price', warnings: ['price_non_positive'] });
  });

  it('warns about large changes, prices below cost, unknown and mixed currencies', () => {
    const l = [makeListing('1', { costMinor: 9_000 }), makeListing('2', {}, 500, 'USD'), makeListing('3', {}, 10_000, 'UNKNOWN')];
    const big = buildBulkPlan(l, { kind: 'adjust_pct', pct: 60, rounding: 'minor' }, ctx);
    expect(big.items[0]!.warnings).toContain('large_change');
    const cheap = buildBulkPlan(l, { kind: 'adjust_pct', pct: -20, rounding: 'minor' }, ctx);
    expect(cheap.items[0]!.warnings).toContain('below_cost'); // 8000 < cost 9000
    expect(cheap.items[2]!.warnings).toContain('unknown_currency');
    const fixed = buildBulkPlan(l, { kind: 'adjust_fixed', deltaMinor: 100 }, ctx);
    expect(fixed.items.every((i) => i.warnings.includes('mixed_currency'))).toBe(true);
  });

  it('compares the estimated net income with the cost when a commission is known', () => {
    const f = defaultSettings().fees;
    f.nodeCommission = { '501': { pct: 10, source: 'calc', at: 1 } };
    // price 9 900 → net 9 000 → equals the cost: fine; 9 800 → net 8 909 < 9 000: below cost
    const l = [makeListing('1', { costMinor: 9_000 })];
    expect(buildBulkPlan(l, { kind: 'set_price', priceMinor: 9_900 }, { fees: f, now: NOW }).items[0]!.warnings).not.toContain('below_cost');
    expect(buildBulkPlan(l, { kind: 'set_price', priceMinor: 9_800 }, { fees: f, now: NOW }).items[0]!.warnings).toContain('below_cost');
  });

  it('set_stock warns for auto-delivery offers and identical stock', () => {
    const p = plan({ kind: 'set_stock', amount: 5 }, [makeListing('1'), makeListing('2', { autoDelivery: true, amount: 1 })]);
    expect(p.items[0]).toMatchObject({ changes: { amount: '5' }, warnings: ['already_in_state'] });
    expect(p.items[1]).toMatchObject({ changes: { amount: '5' }, warnings: ['auto_delivery_stock'] });
  });

  it('delete is explicit and flagged irreversible', () => {
    const p = plan({ kind: 'delete' });
    expect(p.items.every((i) => i.changes.deleted === '1' && i.after.deleted === true && i.warnings.includes('irreversible'))).toBe(true);
    expect(deleteConfirmationPhrase(2)).toBe('DELETE 2');
  });

  it('fill_en writes only empty English fields unless overwriting', () => {
    const en = new Map<string, EnText>([
      ['1', { summaryEn: 'Starter account', descEn: 'Description', summaryEnBefore: '', descEnBefore: 'Existing' }],
      ['2', { summaryEn: '  ', descEn: '' }],
    ]);
    const p = plan({ kind: 'fill_en', overwrite: false }, undefined, { enTexts: en });
    expect(p.items[0]).toMatchObject({ changes: { [EN_SUMMARY]: 'Starter account' }, onlyIfEmpty: [EN_SUMMARY], after: { summaryEn: 'Starter account' } });
    expect(p.items[0]!.changes[EN_DESC]).toBeUndefined();
    expect(p.items[1]!.skip).toBe('nothing_to_fill');
    const o = plan({ kind: 'fill_en', overwrite: true }, undefined, { enTexts: en });
    expect(o.items[0]).toMatchObject({ changes: { [EN_SUMMARY]: 'Starter account', [EN_DESC]: 'Description' }, onlyIfEmpty: [] });
  });

  it('summarises actionable items, skip reasons and warnings; plans validate against the schema', () => {
    const l = [makeListing('1', { costMinor: 20_000 }), makeListing('2'), makeListing('3', {}, 0, 'UNKNOWN')];
    const p = buildBulkPlan(l, { kind: 'adjust_pct', pct: 5, rounding: 'unit_up' }, ctx);
    const s = summarizePlan(p);
    expect(s).toMatchObject({ total: 3, actionable: 2, skipped: 1, skipReasons: { no_price: 1 }, warnings: { below_cost: 1 }, tooLarge: false });
    expect(BulkPlanSchema.safeParse(p).success).toBe(true);
  });

  it('flags plans above the execution limit', () => {
    const many = Array.from({ length: MAX_EXECUTABLE_ITEMS + 1 }, (_, i) => makeListing(String(100 + i)));
    expect(summarizePlan(buildBulkPlan(many, { kind: 'enable' }, ctx)).tooLarge).toBe(true);
  });

  it('matches live prices with a small tolerance only', () => {
    expect(priceMatches(10_000, 10_000)).toBe(true);
    expect(priceMatches(10_010, 10_000)).toBe(true); // 0.1 %
    expect(priceMatches(10_011, 10_000)).toBe(false);
    expect(priceMatches(101, 100)).toBe(true); // at least one minor unit
    expect(priceMatches(null, 100)).toBe(false);
  });
});
