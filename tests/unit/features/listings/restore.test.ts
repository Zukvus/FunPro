import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { buildBulkPlan, EN_SUMMARY, type ItemResult } from '@/features/listings/bulk-plan';
import {
  executeBulkPlan,
  processBulkQueue,
  resetBulkProcessorForTests,
  type BulkExecDeps,
} from '@/features/listings/bulk-exec';
import { loadPlan, loadResults, savePlan } from '@/features/listings/bulk-store';
import { buildRestorePlan, restoreLocalBackup } from '@/features/listings/restore';
import { liveSettings, makeListing, offerForm } from './helpers';

const T0 = Date.parse('2026-10-11T12:00:00Z');
const settings = liveSettings();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  resetDbForTests();
  resetBulkProcessorForTests();
});
afterEach(() => vi.useRealTimers());

function result(listingId: string, over: Partial<ItemResult>): ItemResult {
  return {
    planId: 'p',
    listingId,
    status: 'done',
    at: T0,
    message: '',
    liveBefore: null,
    applied: null,
    uncertain: false,
    ...over,
  };
}

describe('buildRestorePlan', () => {
  it('reverses applied changes using the live values recorded before each change', () => {
    const ls = [makeListing('1'), makeListing('2'), makeListing('3'), makeListing('4')];
    const source = buildBulkPlan(
      ls,
      { kind: 'adjust_pct', pct: 10, rounding: 'minor' },
      { fees: settings.fees, now: T0 },
    );
    const results = [
      result('1', { liveBefore: { price: '100.00' }, applied: { price: '110.00' } }),
      result('2', { status: 'failed', liveBefore: { price: '100.00' } }),
      result('3', { status: 'conflict', liveBefore: { price: '95.00' } }),
      result('4', {
        status: 'failed',
        uncertain: true,
        liveBefore: { price: '100.00' },
        applied: { price: '110.00' },
      }),
    ];
    const r = buildRestorePlan(source, results, null, { now: T0, label: 'restore' });
    expect(r.op).toEqual({ kind: 'restore', fromPlanId: source.id, backupId: null });
    expect(r.source).toBe('restore');
    expect(r.items.map((i) => [i.listingId, i.skip, i.changes.price ?? null])).toEqual([
      ['1', null, '100.00'],
      ['2', 'not_applied', null],
      ['3', 'not_applied', null],
      ['4', null, '100.00'], // uncertain: restoring the old value is correct either way
    ]);
    expect(r.items[0]).toMatchObject({
      before: { priceMinor: 11_000 },
      after: { priceMinor: 10_000 },
      expectPriceMinor: null,
    });
  });

  it('falls back to the backup snapshot (flagged) when no result was recorded', () => {
    const ls = [makeListing('1', { active: false, titleEn: 'Old EN' })];
    const source = buildBulkPlan(ls, { kind: 'enable' }, { fees: settings.fees, now: T0 });
    const r = buildRestorePlan(source, [], { id: 'bak_1', listings: ls }, { now: T0, label: 'restore' });
    expect(r.items[0]).toMatchObject({
      changes: { active: '' },
      after: { active: false },
      warnings: ['stale_snapshot'],
      skip: null,
    });
    expect(r.op).toMatchObject({ backupId: 'bak_1' });
  });

  it('never pretends deleted offers can be restored', () => {
    const ls = [makeListing('1'), makeListing('2')];
    const source = buildBulkPlan(ls, { kind: 'delete' }, { fees: settings.fees, now: T0 });
    const r = buildRestorePlan(source, [result('1', {}), result('2', { status: 'failed' })], null, {
      now: T0,
      label: 'x',
    });
    expect(r.items.map((i) => i.skip)).toEqual(['not_restorable', 'not_applied']);
  });

  it('restores English texts to their previous (empty) values', () => {
    const ls = [makeListing('1')];
    const source = buildBulkPlan(
      ls,
      { kind: 'fill_en', overwrite: false },
      { fees: settings.fees, now: T0, enTexts: new Map([['1', { summaryEn: 'New', summaryEnBefore: '' }]]) },
    );
    const r = buildRestorePlan(
      source,
      [result('1', { liveBefore: { [EN_SUMMARY]: '' }, applied: { [EN_SUMMARY]: 'New' } })],
      null,
      { now: T0, label: 'x' },
    );
    expect(r.items[0]).toMatchObject({ changes: { [EN_SUMMARY]: '' }, after: { summaryEn: '' }, skip: null });
  });

  it('end-to-end: execute, then restore through the same queue path', async () => {
    const ls = [makeListing('1'), makeListing('2', {}, 30_000)];
    await getDb().listings.bulkAdd(ls);
    const live = new Map(
      ls.map((l) => [l.id, offerForm(l.id, { price: (l.price.amountMinor / 100).toFixed(2) })]),
    );
    const deps: BulkExecDeps = {
      exec: async (cmd) => {
        if (cmd.action === 'getOfferForm') return structuredClone(live.get(cmd.offerId));
        if (cmd.action === 'saveOffer') {
          const f = live.get(cmd.offerId)!;
          f.fields = f.fields.map(([k, v]) => [k, cmd.changes[k] ?? v]);
          return { ok: true, errors: [] };
        }
        return { ok: false, errors: ['unexpected'] };
      },
      getSettings: async () => settings,
      now: () => Date.now(),
      sleep: async () => undefined,
      gapMs: 0,
    };
    const plan = buildBulkPlan(
      ls,
      { kind: 'adjust_pct', pct: -50, rounding: 'unit_down' },
      { fees: settings.fees, now: T0, label: 'halve' },
    );
    await savePlan(plan);
    await executeBulkPlan(plan.id, deps);
    await processBulkQueue(deps);
    expect(live.get('2')!.fields.find(([k]) => k === 'price')![1]).toBe('150.00');

    const executed = (await loadPlan(plan.id))!;
    const backup = (await getDb().backups.get(executed.backupId!))!;
    const restore = buildRestorePlan(executed, await loadResults(plan.id), backup, {
      now: Date.now(),
      label: 'undo',
    });
    await savePlan(restore);
    await executeBulkPlan(restore.id, deps);
    await processBulkQueue(deps);
    expect(live.get('1')!.fields.find(([k]) => k === 'price')![1]).toBe('100.00');
    expect(live.get('2')!.fields.find(([k]) => k === 'price')![1]).toBe('300.00');
    expect((await getDb().listings.get('2'))!.price.amountMinor).toBe(30_000);
    expect(await getDb().backups.count()).toBe(2); // the restore itself is reversible
  });
});

describe('restoreLocalBackup', () => {
  it('restores local fields only and writes a safety backup first', async () => {
    const before = makeListing('1', { costMinor: 5_000, sortIndex: 3, titleEn: 'Draft' });
    await getDb().listings.add({
      ...before,
      costMinor: 9_000,
      sortIndex: 7,
      titleEn: 'Changed',
      price: { amountMinor: 55_500, currency: 'RUB' },
    });
    await getDb().backups.add({
      id: 'bak_import',
      kind: 'import',
      createdAt: T0,
      label: 'import',
      listings: [before, makeListing('2')],
    });
    const res = await restoreLocalBackup('bak_import', T0);
    expect(res).toMatchObject({ restored: 1, missing: 1 });
    const l = (await getDb().listings.get('1'))!;
    expect(l).toMatchObject({ costMinor: 5_000, sortIndex: 3, titleEn: 'Draft' });
    expect(l.price.amountMinor).toBe(55_500); // FunPay-side data untouched
    const safety = (await getDb().backups.get(res.safetyBackupId))!;
    expect(safety).toMatchObject({ kind: 'manual' });
    expect(safety.listings[0]).toMatchObject({ costMinor: 9_000, sortIndex: 7 });
  });
});
