import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { defaultSettings } from '@/core/settings/schema';
import { writeXlsx } from '@/features/export/xlsx';
import {
  applyImportLocal,
  detectImportFormat,
  diffImport,
  importToBulkPlan,
  LISTINGS_IMPORT_MAX_BYTES,
  listingsToCsv,
  listingsToJson,
  listingsToXlsx,
  parseListingsImport,
} from '@/features/listings/import-export';
import type { Listing } from '@/shared/models';
import { makeListing } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);

/** Realistic, tricky data: Cyrillic, quotes, separators, newlines, formula-like text, nulls, zero cost. */
function sample(): Listing[] {
  return [
    makeListing(
      '9000001',
      {
        title: 'Аккаунт «Старт», уровень 10; "лучший"',
        titleEn: 'Starter account',
        description: 'Строка 1\nСтрока 2\r\nСтрока 3',
        costMinor: 7_550,
        sortIndex: 1,
      },
      19_999,
    ),
    makeListing(
      '9000002',
      { title: '=SUM(A1:A2)', active: false, amount: null, costMinor: 0, sortIndex: 2, promoted: true },
      149_900,
    ),
    makeListing(
      '9000003',
      {
        title: '-50% sale',
        nodeId: null,
        gameId: null,
        categoryName: 'Game C, Boosting',
        autoDelivery: true,
        descriptionEn: '  spaced  ',
        sortIndex: 2.5,
      },
      550,
      'USD',
    ),
    makeListing('9000004', { title: '@mention +plus', categoryName: '', amount: 0, sortIndex: -1 }, 1, 'EUR'),
  ];
}

beforeEach(() => {
  resetDbForTests();
});

describe('round trips', () => {
  it('JSON export → import is identical', () => {
    const data = sample();
    const parsed = parseListingsImport(enc(listingsToJson(data)), 'json');
    expect(parsed.errors).toEqual([]);
    expect(parsed.listings).toEqual(data);
  });

  it('XLSX export → import is identical', () => {
    const data = sample();
    const parsed = parseListingsImport(listingsToXlsx(data), 'xlsx');
    expect(parsed.errors).toEqual([]);
    expect(parsed.listings).toEqual(data);
  });

  it('CSV export → import is identical (formula guard is undone)', () => {
    const data = sample();
    const csv = listingsToCsv(data);
    expect(csv).toContain("'=SUM(A1:A2)"); // exported safely
    const parsed = parseListingsImport(enc(csv), 'csv');
    expect(parsed.errors).toEqual([]);
    expect(parsed.listings).toEqual(data);
  });

  it('detects formats by extension and content', () => {
    expect(detectImportFormat('a.JSON', enc('x'))).toBe('json');
    expect(detectImportFormat('a.csv', enc('x'))).toBe('csv');
    expect(detectImportFormat('noext', listingsToXlsx(sample()))).toBe('xlsx');
    expect(detectImportFormat('noext', enc('  {"a":1}'))).toBe('json');
    expect(detectImportFormat('noext', enc('id,price'))).toBeNull();
  });
});

describe('validation', () => {
  it('rejects oversized files before parsing', () => {
    const big = new Uint8Array(LISTINGS_IMPORT_MAX_BYTES + 1);
    const r = parseListingsImport(big, 'json');
    expect(r.listings).toEqual([]);
    expect(r.errors[0]!.message).toMatch(/too large/);
  });

  it('reports invalid JSON and foreign documents', () => {
    expect(parseListingsImport(enc('{nope'), 'json').errors[0]!.message).toBe('Not valid JSON');
    expect(
      parseListingsImport(enc('{"format":"other","version":1,"listings":[]}'), 'json').errors[0]!.message,
    ).toMatch(/Not a FunPro listings export/);
  });

  it('reports bad rows with their row number and keeps the good ones', () => {
    const rows = [
      ['id', 'title', 'price', 'currency', 'active', 'sortIndex', 'seenAt', 'updatedAt', 'cost'],
      ['9000001', 'Ok', 10, 'RUB', true, 1, 'a', 'b', ''],
      ['abc', 'Bad id', 10, 'RUB', true, 1, 'a', 'b', ''],
      ['9000002', 'Bad currency', 10, 'XYZ', true, 1, 'a', 'b', ''],
      ['9000003', 'Bad price', 'n/a', 'RUB', true, 1, 'a', 'b', ''],
      ['9000001', 'Duplicate', 10, 'RUB', true, 1, 'a', 'b', ''],
      ['9000004', 'Bad bool', 10, 'RUB', 'maybe', 1, 'a', 'b', ''],
    ];
    const bytes = writeXlsx([{ name: 'x', headers: rows[0] as string[], rows: rows.slice(1) }]);
    const r = parseListingsImport(bytes, 'xlsx');
    expect(r.listings.map((l) => l.id)).toEqual(['9000001']);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(r.errors[0]!.message).toMatch(/^id:/);
  });

  it('requires a header with id and price', () => {
    expect(parseListingsImport(enc('a,b\n1,2'), 'csv').errors[0]!.message).toMatch(/header/);
  });
});

describe('diff and apply', () => {
  it('separates local fields (applied) from FunPay fields (never applied directly)', async () => {
    const current = [makeListing('1', { costMinor: 100 }), makeListing('2'), makeListing('3')];
    await getDb().listings.bulkAdd(current);
    const imported = [
      {
        ...current[0]!,
        costMinor: 250,
        titleEn: 'New EN',
        price: { amountMinor: 12_000, currency: 'RUB' as const },
        active: false,
      },
      { ...current[1]! },
      makeListing('99'),
    ];
    const diff = diffImport(new Map(current.map((l) => [l.id, l])), imported);
    expect(diff).toMatchObject({ updates: 1, unchanged: 1, unknown: 1, remoteChanges: 1 });
    expect(diff.rows[0]).toMatchObject({
      status: 'update',
      local: { costMinor: 250, titleEn: 'New EN' },
      remote: { priceMinor: { from: 10_000, to: 12_000 }, active: { from: true, to: false } },
    });

    const res = await applyImportLocal(diff, 'import test', 1);
    expect(res.updated).toBe(1);
    const l1 = (await getDb().listings.get('1'))!;
    expect(l1).toMatchObject({ costMinor: 250, titleEn: 'New EN', active: true });
    expect(l1.price.amountMinor).toBe(10_000); // FunPay-side field untouched
    const backup = (await getDb().backups.get(res.backupId!))!;
    expect(backup).toMatchObject({ kind: 'import' });
    expect(backup.listings[0]!.costMinor).toBe(100);
  });

  it('turns FunPay-side differences into a bulk-edit plan with a concurrency check', () => {
    const current = [makeListing('1'), makeListing('2', { autoDelivery: true })];
    const imported = [
      { ...current[0]!, price: { amountMinor: 12_000, currency: 'RUB' as const } },
      { ...current[1]!, amount: 9, price: { amountMinor: 0, currency: 'RUB' as const } },
    ];
    const existing = new Map(current.map((l) => [l.id, l]));
    const plan = importToBulkPlan(diffImport(existing, imported), existing, defaultSettings().fees, {
      now: 1,
      label: 'from file',
    });
    expect(plan).toMatchObject({ source: 'import', op: { kind: 'import' }, status: 'draft' });
    expect(plan.items[0]).toMatchObject({
      changes: { price: '120.00' },
      expectPriceMinor: 10_000,
      skip: null,
    });
    // an invalid price does not block the other changes of the row
    expect(plan.items[1]).toMatchObject({
      changes: { amount: '9' },
      skip: null,
      warnings: ['auto_delivery_stock', 'price_non_positive'],
    });
    expect(plan.items[1]!.changes.price).toBeUndefined();
  });
});
