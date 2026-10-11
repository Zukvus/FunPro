import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@/core/settings/schema';
import {
  buyerFromSellerPrice,
  divCeil,
  divFloor,
  divRound,
  formatPriceField,
  listingEconomics,
  netFromBuyerPrice,
  parsePriceInput,
  pctFromBuyerPrices,
  pctToBp,
  profit,
  resolveCommission,
  sellerFromBuyerPrice,
} from '@/features/listings/commission';

describe('exact integer division', () => {
  it.each([
    [7, 2, 3, 4, 4],
    [-7, 2, -4, -3, -3],
    [6, 3, 2, 2, 2],
    [5, 10, 0, 1, 1],
    [4, 10, 0, 1, 0],
  ])('%i / %i → floor %i, ceil %i, round %i', (n, d, f, c, r) => {
    expect(divFloor(n, d)).toBe(f);
    expect(divCeil(n, d)).toBe(c);
    expect(divRound(n, d)).toBe(r);
  });

  it('stays exact for large safe integers', () => {
    expect(divFloor(999_999_999 * 10_000, 10_800)).toBe(925_925_925);
  });
});

describe('commission math (markup model, minor units)', () => {
  it('derives net income from a buyer price, rounding down', () => {
    expect(netFromBuyerPrice(10_800, 8)).toBe(10_000);
    expect(netFromBuyerPrice(10_799, 8)).toBe(9_999); // 9999.07 → 9999
    expect(netFromBuyerPrice(0, 8)).toBe(0);
    expect(netFromBuyerPrice(12_345, 0)).toBe(12_345);
  });

  it('derives the buyer price from a seller price, rounding up', () => {
    expect(buyerFromSellerPrice(10_000, 8)).toBe(10_800);
    expect(buyerFromSellerPrice(19_999, 8)).toBe(21_599); // 21598.92 → 21599
    expect(buyerFromSellerPrice(19_999, 0)).toBe(19_999);
  });

  it('round-trips seller → buyer → seller exactly for every price', () => {
    for (const pct of [0, 3.5, 8, 8.33, 12.5, 25]) {
      for (let s = 1; s < 50_000; s += 37) {
        expect(sellerFromBuyerPrice(buyerFromSellerPrice(s, pct), pct)).toBe(s);
        // and never makes the buyer pay more than a target buyer price
        expect(buyerFromSellerPrice(sellerFromBuyerPrice(s, pct), pct)).toBeLessThanOrEqual(s);
      }
    }
  });

  it('uses 0.01 % precision and rejects invalid percentages', () => {
    expect(pctToBp(8.333)).toBe(833);
    expect(pctToBp(0)).toBe(0);
    expect(() => pctToBp(-1)).toThrow(RangeError);
    expect(() => pctToBp(Number.NaN)).toThrow(RangeError);
    expect(() => netFromBuyerPrice(1.5, 8)).toThrow(RangeError);
  });

  it('computes profit exactly (may be negative)', () => {
    expect(profit(10_000, 7_550)).toBe(2_450);
    expect(profit(5_000, 7_550)).toBe(-2_550);
  });

  it('derives the % from FunPay buyer-price rows (cheapest method)', () => {
    expect(pctFromBuyerPrices(19_999, [21_599, 21_099])).toBe(5.5);
    expect(pctFromBuyerPrices(10_000, [10_800])).toBe(8);
    expect(pctFromBuyerPrices(0, [10_800])).toBeNull();
    expect(pctFromBuyerPrices(10_000, [])).toBeNull();
    expect(pctFromBuyerPrices(10_000, [9_000])).toBeNull(); // below the seller price: not a markup
  });
});

describe('price fields', () => {
  it('formats minor units for the offer editor', () => {
    expect(formatPriceField(19_999)).toBe('199.99');
    expect(formatPriceField(5)).toBe('0.05');
    expect(formatPriceField(100_000)).toBe('1000.00');
    expect(formatPriceField(-150)).toBe('-1.50');
  });

  it('parses user input', () => {
    expect(parsePriceInput('1 234,5')).toBe(123_450);
    expect(parsePriceInput('199.99')).toBe(19_999);
    expect(parsePriceInput('  ')).toBeNull();
    expect(parsePriceInput('abc')).toBeNull();
    expect(parsePriceInput(null)).toBeNull();
  });
});

describe('commission lookup and economics', () => {
  const fees = () => {
    const f = defaultSettings().fees;
    f.categoryCommissionPct = { 'Game A Accounts': 10 };
    f.defaultCommissionPct = 12;
    f.nodeCommission = { '501': { pct: 8, source: 'calc', at: 1 }, '502': { pct: 9, source: 'manual', at: 1 } };
    return f;
  };

  it('prefers node → category name → default', () => {
    expect(resolveCommission({ nodeId: '501', categoryName: 'x' }, fees())).toEqual({ pct: 8, source: 'calc', fromFunPay: true });
    expect(resolveCommission({ nodeId: '502', categoryName: 'x' }, fees())).toEqual({ pct: 9, source: 'manual_node', fromFunPay: false });
    expect(resolveCommission({ nodeId: '999', categoryName: 'Game A Accounts' }, fees())).toMatchObject({ pct: 10, source: 'category' });
    expect(resolveCommission({ nodeId: null, categoryName: 'other' }, fees())).toMatchObject({ pct: 12, source: 'default' });
    expect(resolveCommission({ nodeId: null, categoryName: 'other' }, defaultSettings().fees)).toBeNull();
  });

  it('labels values as estimates unless the % came from FunPay calc', () => {
    const exact = listingEconomics({ nodeId: '501', categoryName: '', price: { amountMinor: 10_800 }, costMinor: 6_000 }, fees());
    expect(exact).toMatchObject({ netMinor: 10_000, profitMinor: 4_000, estimate: false });
    const est = listingEconomics({ nodeId: '502', categoryName: '', price: { amountMinor: 10_900 }, costMinor: null }, fees());
    expect(est).toMatchObject({ netMinor: 10_000, profitMinor: null, estimate: true });
    const unknown = listingEconomics({ nodeId: null, categoryName: '', price: { amountMinor: 10_900 }, costMinor: 100 }, defaultSettings().fees);
    expect(unknown).toMatchObject({ commission: null, netMinor: null, profitMinor: null, estimate: true });
  });
});
