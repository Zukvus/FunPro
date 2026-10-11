import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NotifyInput } from '@/features/notifications/notify';
import { getDb, resetDbForTests } from '@/core/db/db';
import { cancelPendingTasks } from '@/core/queue/queue';
import type { Settings } from '@/core/settings/schema';
import {
  buildBulkPlan,
  deleteConfirmationPhrase,
  EN_SUMMARY,
  type BulkOperation,
  type BulkPlan,
} from '@/features/listings/bulk-plan';
import {
  cancelBulkPlan,
  executeBulkPlan,
  processBulkQueue,
  resetBulkProcessorForTests,
  type BulkExecCommand,
  type BulkExecDeps,
} from '@/features/listings/bulk-exec';
import {
  computeProgress,
  getActivePlanIds,
  loadPlan,
  loadResults,
  planTasks,
  savePlan,
} from '@/features/listings/bulk-store';
import { ListingsActionError } from '@/features/listings/errors';
import type { Listing } from '@/shared/models';
import { liveSettings, makeListing, NoTabError, offerForm } from './helpers';

const T0 = Date.parse('2026-10-11T12:00:00Z');

let settings: Settings;
let calls: BulkExecCommand[];
/** Live editor state per offer id. */
let live: Map<string, ReturnType<typeof offerForm>>;
let saveImpl: (cmd: Extract<BulkExecCommand, { action: 'saveOffer' }>) => Promise<unknown>;
let notify: Mock<(input: NotifyInput) => Promise<unknown>>;

function deps(over: Partial<BulkExecDeps> = {}): BulkExecDeps {
  return {
    exec: async (cmd) => {
      calls.push(cmd);
      if (cmd.action === 'getOfferForm') {
        const f = live.get(cmd.offerId);
        if (!f) throw new Error('Offer edit form not found');
        return structuredClone(f);
      }
      if (cmd.action === 'saveOffer') return saveImpl(cmd);
      return { ok: true, errors: [] };
    },
    getSettings: async () => settings,
    now: () => Date.now(),
    sleep: async () => undefined,
    notify,
    gapMs: 0,
    ...over,
  };
}

async function seed(listings: Listing[]): Promise<void> {
  await getDb().listings.bulkAdd(listings);
  live = new Map(
    listings.map((l) => [
      l.id,
      offerForm(l.id, {
        price: (l.price.amountMinor / 100).toFixed(2),
        active: l.active,
        amount: String(l.amount ?? ''),
      }),
    ]),
  );
}

async function storedPlan(
  op: BulkOperation,
  listings: Listing[],
  over: Partial<BulkPlan> = {},
): Promise<BulkPlan> {
  const p = { ...buildBulkPlan(listings, op, { fees: settings.fees, now: T0, label: 'test' }), ...over };
  await savePlan(p);
  return p;
}

async function progressOf(planId: string) {
  const plan = (await loadPlan(planId))!;
  return computeProgress(plan, await loadResults(planId), await planTasks(planId));
}

beforeEach(() => {
  // Only Date is faked: the queue uses Date.now() internally, IndexedDB keeps real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  resetDbForTests();
  resetBulkProcessorForTests();
  settings = liveSettings();
  calls = [];
  notify = vi.fn<(input: NotifyInput) => Promise<unknown>>(async () => null);
  saveImpl = async () => ({ ok: true, errors: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('executeBulkPlan', () => {
  it('backs up affected listings, enqueues one idempotent task per listing and reports skipped items', async () => {
    const ls = [makeListing('1'), makeListing('2'), makeListing('3', {}, 0, 'UNKNOWN')];
    await seed(ls);
    const p = await storedPlan({ kind: 'adjust_pct', pct: 10, rounding: 'minor' }, ls);
    const res = await executeBulkPlan(p.id, deps());
    expect(res).toMatchObject({ queued: 2, skipped: 1, alreadyQueued: false });
    const backup = await getDb().backups.get(res.backupId!);
    expect(backup).toMatchObject({ kind: 'bulk_edit', label: 'test' });
    expect(backup!.listings.map((l) => l.id).sort()).toEqual(['1', '2']);
    const tasks = await planTasks(p.id);
    expect(tasks.map((t) => [t.kind, t.idempotencyKey, t.maxAttempts]).sort()).toEqual([
      ['bulk_edit', `${p.id}:1`, 1],
      ['bulk_edit', `${p.id}:2`, 1],
    ]);
    expect((await loadPlan(p.id))!.status).toBe('queued');
    expect(await getActivePlanIds()).toEqual([p.id]);
    expect((await loadResults(p.id)).map((r) => [r.listingId, r.status])).toEqual([['3', 'skipped']]);

    // executing again is idempotent: no duplicate tasks
    const again = await executeBulkPlan(p.id, deps());
    expect(again.alreadyQueued).toBe(true);
    expect(await planTasks(p.id)).toHaveLength(2);
    expect(calls).toEqual([]); // nothing was sent to FunPay yet
  });

  it('refuses during the emergency stop and without the live-actions acknowledgement', async () => {
    const ls = [makeListing('1')];
    await seed(ls);
    const p = await storedPlan({ kind: 'enable' }, ls);
    settings = liveSettings((s) => (s.automation.state = 'stopped'));
    await expect(executeBulkPlan(p.id, deps())).rejects.toMatchObject({ code: 'emergency_stop' });
    settings = liveSettings((s) => (s.automation.liveActionsAcknowledged = false));
    await expect(executeBulkPlan(p.id, deps())).rejects.toMatchObject({ code: 'awaiting_authorization' });
    expect(await getDb().backups.count()).toBe(0);
    expect(await planTasks(p.id)).toHaveLength(0);
  });

  it('requires the typed confirmation for deletions and rejects smuggled deletes', async () => {
    const ls = [makeListing('1'), makeListing('2')];
    await seed(ls);
    const p = await storedPlan({ kind: 'delete' }, ls);
    await expect(executeBulkPlan(p.id, deps())).rejects.toMatchObject({ code: 'confirmation_required' });
    const wrong = await storedPlan({ kind: 'delete' }, ls, { confirmation: 'DELETE 1' });
    await expect(executeBulkPlan(wrong.id, deps())).rejects.toMatchObject({ code: 'confirmation_required' });
    const smuggled = buildBulkPlan(ls, { kind: 'enable' }, { fees: settings.fees, now: T0 });
    smuggled.items[0]!.changes.deleted = '1';
    await savePlan(smuggled);
    await expect(executeBulkPlan(smuggled.id, deps())).rejects.toBeInstanceOf(ListingsActionError);
  });

  it('rejects unknown listings and missing plans', async () => {
    const p = await storedPlan({ kind: 'enable' }, [makeListing('77')]);
    await expect(executeBulkPlan(p.id, deps())).rejects.toMatchObject({ code: 'invalid_plan' });
    await expect(executeBulkPlan('plan_missing', deps())).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('processBulkQueue', () => {
  it('applies every change sequentially, records live "before" values, updates local data and finishes', async () => {
    const ls = [makeListing('1'), makeListing('2', {}, 20_000)];
    await seed(ls);
    const p = await storedPlan({ kind: 'adjust_pct', pct: 10, rounding: 'minor' }, ls);
    await executeBulkPlan(p.id, deps());
    const r = await processBulkQueue(deps());
    expect(r.processed).toBe(2);
    expect(calls.map((c) => `${c.action}:${'offerId' in c ? c.offerId : ''}`)).toEqual([
      'getOfferForm:1',
      'saveOffer:1',
      'getOfferForm:2',
      'saveOffer:2',
    ]);
    expect(calls[1]).toMatchObject({ changes: { price: '110.00' } });
    const results = await loadResults(p.id);
    expect(results.map((x) => [x.listingId, x.status, x.liveBefore?.price, x.applied?.price])).toEqual([
      ['1', 'done', '100.00', '110.00'],
      ['2', 'done', '200.00', '220.00'],
    ]);
    expect((await getDb().listings.get('1'))!.price.amountMinor).toBe(11_000);
    const done = (await loadPlan(p.id))!;
    expect(done).toMatchObject({ status: 'done', report: { total: 2, done: 2, failed: 0 } });
    expect(await getActivePlanIds()).toEqual([]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'system', title: 'Bulk edit finished' }),
    );
  });

  it('reports partial failures and continues with the remaining listings', async () => {
    const ls = [makeListing('1'), makeListing('2'), makeListing('3')];
    await seed(ls);
    saveImpl = async (cmd) =>
      cmd.offerId === '2' ? { ok: false, errors: ['price: Price is too low'] } : { ok: true, errors: [] };
    const p = await storedPlan({ kind: 'set_price', priceMinor: 5_000 }, ls);
    await executeBulkPlan(p.id, deps());
    await processBulkQueue(deps());
    const results = await loadResults(p.id);
    expect(results.map((x) => [x.listingId, x.status])).toEqual([
      ['1', 'done'],
      ['2', 'failed'],
      ['3', 'done'],
    ]);
    expect(results[1]!.message).toContain('Price is too low');
    const plan = (await loadPlan(p.id))!;
    expect(plan).toMatchObject({ status: 'partial', report: { done: 2, failed: 1 } });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'failure' }));
    // the failed task is never retried
    expect((await planTasks(p.id)).find((t) => t.payload['listingId'] === '2')!.status).toBe('failed');
  });

  it('skips with a conflict when FunPay shows another price than the preview assumed', async () => {
    const ls = [makeListing('1')];
    await seed(ls);
    live.set('1', offerForm('1', { price: '95.00' }));
    const p = await storedPlan({ kind: 'adjust_fixed', deltaMinor: 500 }, ls);
    await executeBulkPlan(p.id, deps());
    await processBulkQueue(deps());
    expect(calls.map((c) => c.action)).toEqual(['getOfferForm']);
    const [res] = await loadResults(p.id);
    expect(res).toMatchObject({ status: 'conflict', liveBefore: { price: '95.00' } });
    expect((await loadPlan(p.id))!.status).toBe('failed');
    expect((await getDb().listings.get('1'))!.price.amountMinor).toBe(10_000);
  });

  it('does not resubmit values FunPay already has and never overwrites filled English text', async () => {
    const ls = [makeListing('1'), makeListing('2')];
    await seed(ls);
    live.set('2', offerForm('2', { summaryEn: 'Already translated' }));
    const p = buildBulkPlan(
      ls,
      { kind: 'fill_en', overwrite: false },
      {
        fees: settings.fees,
        now: T0,
        enTexts: new Map([
          ['1', { summaryEn: 'Offer one', summaryEnBefore: '' }],
          ['2', { summaryEn: 'Offer two', summaryEnBefore: '' }],
        ]),
      },
    );
    await savePlan(p);
    await executeBulkPlan(p.id, deps());
    await processBulkQueue(deps());
    expect(calls.filter((c) => c.action === 'saveOffer')).toEqual([
      { action: 'saveOffer', offerId: '1', changes: { [EN_SUMMARY]: 'Offer one' } },
    ]);
    const results = await loadResults(p.id);
    expect(results.map((r) => [r.listingId, r.status])).toEqual([
      ['1', 'done'],
      ['2', 'skipped'],
    ]);
    expect((await getDb().listings.get('1'))!.titleEn).toBe('Offer one');
  });

  it('cancels the remaining work while a change is in flight', async () => {
    const ls = [makeListing('1'), makeListing('2'), makeListing('3')];
    await seed(ls);
    const p = await storedPlan({ kind: 'disable' }, ls);
    await executeBulkPlan(p.id, deps());
    saveImpl = async (cmd) => {
      if (cmd.offerId === '1') await cancelBulkPlan(p.id, deps());
      return { ok: true, errors: [] };
    };
    await processBulkQueue(deps());
    expect(
      calls.filter((c) => c.action === 'saveOffer').map((c) => (c as { offerId: string }).offerId),
    ).toEqual(['1']);
    const results = await loadResults(p.id);
    expect(results.map((r) => [r.listingId, r.status])).toEqual([
      ['1', 'done'],
      ['2', 'cancelled'],
      ['3', 'cancelled'],
    ]);
    expect((await loadPlan(p.id))!).toMatchObject({ status: 'cancelled', report: { done: 1, cancelled: 2 } });
  });

  it('waits for a FunPay tab without consuming the attempt, then continues', async () => {
    const ls = [makeListing('1')];
    await seed(ls);
    const p = await storedPlan({ kind: 'disable' }, ls);
    await executeBulkPlan(p.id, deps());
    const noTab = deps({
      exec: async () => {
        throw new NoTabError();
      },
    });
    const r = await processBulkQueue(noTab);
    expect(r.stoppedReason).toBe('no_tab');
    const [task] = await planTasks(p.id);
    expect(task).toMatchObject({ status: 'awaiting_tab', attempts: 0 });
    expect(await progressOf(p.id)).toMatchObject({ awaitingTab: 1, finished: 0 });
    // tab is back after the retry delay
    vi.setSystemTime(T0 + 3 * 60_000);
    await processBulkQueue(deps());
    expect((await loadPlan(p.id))!.status).toBe('done');
  });

  it('never retries a change whose outcome is uncertain', async () => {
    const ls = [makeListing('1')];
    await seed(ls);
    saveImpl = async () => {
      throw new Error('Network error');
    };
    const p = await storedPlan({ kind: 'set_stock', amount: 9 }, ls);
    await executeBulkPlan(p.id, deps());
    await processBulkQueue(deps());
    const [res] = await loadResults(p.id);
    expect(res).toMatchObject({
      status: 'failed',
      uncertain: true,
      applied: { amount: '9' },
      liveBefore: { amount: '5' },
    });
    expect((await planTasks(p.id))[0]!.status).toBe('failed');
    expect(calls.filter((c) => c.action === 'saveOffer')).toHaveLength(1);
  });

  it('deletes through the dedicated path and reports when this build lacks it', async () => {
    const ls = [makeListing('1'), makeListing('2')];
    await seed(ls);
    const p = await storedPlan({ kind: 'delete' }, ls, { confirmation: deleteConfirmationPhrase(2) });
    await executeBulkPlan(p.id, deps());
    let n = 0;
    await processBulkQueue(
      deps({
        exec: async (cmd) => {
          calls.push(cmd);
          if (cmd.action === 'getOfferForm') return live.get(cmd.offerId);
          if (cmd.action === 'deleteOffer' && n++ === 1)
            throw Object.assign(new Error('Invalid command'), { code: 'invalid' });
          return { ok: true, errors: [] };
        },
      }),
    );
    expect(calls.filter((c) => c.action === 'saveOffer')).toEqual([]);
    expect(calls.filter((c) => c.action === 'deleteOffer')).toHaveLength(2);
    const results = await loadResults(p.id);
    expect(results.map((r) => [r.listingId, r.status])).toEqual([
      ['1', 'done'],
      ['2', 'failed'],
    ]);
    expect(results[1]!.message).toContain('cannot perform');
    expect(await getDb().listings.get('1')).toBeUndefined();
    expect(await getDb().listings.get('2')).toBeDefined();
  });

  it('stops at the emergency stop; cancelled tasks finish the plan as cancelled', async () => {
    const ls = [makeListing('1'), makeListing('2')];
    await seed(ls);
    const p = await storedPlan(
      { kind: 'enable' },
      ls.map((l) => ({ ...l, active: false })),
    );
    live = new Map(ls.map((l) => [l.id, offerForm(l.id, { active: false })]));
    await executeBulkPlan(p.id, deps());
    saveImpl = async () => {
      settings = liveSettings((s) => (s.automation.state = 'stopped'));
      await cancelPendingTasks(); // what emergencyStop() does
      return { ok: true, errors: [] };
    };
    const r = await processBulkQueue(deps());
    expect(r).toMatchObject({ processed: 1, stoppedReason: 'emergency_stop' });
    expect((await loadPlan(p.id))!).toMatchObject({ status: 'cancelled', report: { done: 1, cancelled: 1 } });
  });

  it('blocks queued work when the live-actions acknowledgement is withdrawn', async () => {
    const ls = [makeListing('1')];
    await seed(ls);
    const p = await storedPlan({ kind: 'disable' }, ls);
    await executeBulkPlan(p.id, deps());
    settings = liveSettings((s) => (s.automation.liveActionsAcknowledged = false));
    await processBulkQueue(deps());
    expect(calls).toEqual([]);
    expect((await loadResults(p.id))[0]).toMatchObject({ status: 'blocked' });
  });

  it('is not re-entrant', async () => {
    const ls = [makeListing('1')];
    await seed(ls);
    const p = await storedPlan({ kind: 'disable' }, ls);
    await executeBulkPlan(p.id, deps());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = deps({
      exec: async (cmd) => {
        if (cmd.action === 'getOfferForm') await gate;
        return cmd.action === 'getOfferForm' ? live.get(cmd.offerId) : { ok: true, errors: [] };
      },
    });
    const first = processBulkQueue(slow);
    expect(await processBulkQueue(slow)).toMatchObject({ busy: true, processed: 0 });
    release();
    expect((await first).processed).toBe(1);
  });
});
