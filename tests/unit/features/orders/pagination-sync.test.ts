import { beforeEach, describe, expect, it, vi } from 'vitest';
import { funpayParser } from '@/adapters/funpay';
import type { ParsedOrder } from '@/adapters/funpay/types';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, onEvent } from '@/core/events/bus';
import type { ContentCommand } from '@/core/messaging/protocol';
import { ingestHistoricalOrders } from '@/features/orders/history';
import { paginateOrders, type OrdersPage } from '@/features/orders/pagination';
import {
  markInterruptedImports,
  readImportStatus,
  readSyncStatus,
  writeImportStatus,
  writeSyncStatus,
} from '@/features/orders/status';
import {
  classifySyncError,
  importOrderHistory,
  PagingUnsupportedError,
  parseOrdersPayload,
  syncFinance,
  syncOrderList,
  syncProfile,
  type ExecFn,
} from '@/features/orders/sync';
import { ingestOrders } from '@/features/sync/ingest';
import type { DomainEvent } from '@/shared/models';
import { fixtureDoc, loadFixture } from '../../../fixtures';

const NOW = new Date('2024-11-05T12:00:00Z');

function page(name: string): OrdersPage {
  const doc = new DOMParser().parseFromString(loadFixture(name), 'text/html');
  return funpayParser.parseOrders(doc, 'sale', NOW);
}

const PAGES: Record<string, OrdersPage> = {
  first: page('sales.html'),
  NEXTPAGE01: page('orders-sales-page2.html'),
  NEXTPAGE02: page('orders-sales-page3.html'),
};

/** Fake content-script executor serving the three fixture pages. */
function fakeExec(opts: { supportsPaging?: boolean } = {}): ExecFn & { calls: ContentCommand[] } {
  const calls: ContentCommand[] = [];
  const fn = (async (cmd: ContentCommand) => {
    calls.push(cmd);
    if (cmd.action === 'fetchPage' && cmd.kind === 'orders') return PAGES.first;
    const raw = cmd as unknown as { action: string; continueToken?: string };
    if (raw.action === 'fetchMoreOrders') {
      if (opts.supportsPaging === false)
        throw Object.assign(new Error('Invalid command'), { code: 'invalid' });
      return PAGES[raw.continueToken!];
    }
    throw new Error(`unexpected command ${cmd.action}`);
  }) as ExecFn & { calls: ContentCommand[] };
  fn.calls = calls;
  return fn;
}

let events: DomainEvent[];
beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
  events = [];
  for (const t of [
    'ORDER_DETECTED',
    'ORDER_PAID',
    'ORDER_COMPLETED',
    'ORDER_CANCELLED',
    'REVIEW_RECEIVED',
  ] as const)
    onEvent(t, (e) => void events.push(e));
});

describe('fixture pages', () => {
  it('chain through continue tokens', () => {
    expect(PAGES.first!.continueToken).toBe('NEXTPAGE01');
    expect(PAGES.NEXTPAGE01!.orders.map((o) => [o.id, o.status])).toEqual([
      ['DDDD4444', 'closed'],
      ['EEEE5555', 'paid'],
    ]);
    expect(PAGES.NEXTPAGE01!.continueToken).toBe('NEXTPAGE02');
    expect(PAGES.NEXTPAGE02!.continueToken).toBeNull();
    expect(PAGES.NEXTPAGE02!.orders[0]!.price).toEqual({ amountMinor: 1550, currency: 'EUR' });
  });
});

describe('paginateOrders (pure control flow)', () => {
  const deps = (overrides: Partial<Parameters<typeof paginateOrders>[0]> = {}) => ({
    fetchFirst: async () => PAGES.first!,
    fetchMore: async (t: string) => PAGES[t]!,
    ingest: async (p: OrdersPage) => ({ created: p.orders.length, updated: 0 }),
    ...overrides,
  });

  it('walks every page until there is no token and reports progress', async () => {
    const progress: number[] = [];
    const r = await paginateOrders(deps(), { maxPages: 50, onProgress: (p) => void progress.push(p.pages) });
    expect(r).toMatchObject({ stop: 'end', pages: 3, orders: 6, created: 6, nextToken: null });
    expect(progress).toEqual([1, 2, 3]);
  });

  it('stops at the page cap', async () => {
    const r = await paginateOrders(deps(), { maxPages: 2 });
    expect(r).toMatchObject({ stop: 'max_pages', pages: 2, nextToken: 'NEXTPAGE02' });
  });

  it('stops on the first error and keeps the progress so far', async () => {
    const err = new Error('HTTP 429');
    const r = await paginateOrders(deps({ fetchMore: async () => Promise.reject(err) }), { maxPages: 50 });
    expect(r).toMatchObject({ stop: 'error', pages: 1, orders: 3 });
    expect(r.error).toBe(err);
    const r2 = await paginateOrders(deps({ ingest: async () => Promise.reject(new Error('db')) }), {
      maxPages: 50,
    });
    expect(r2).toMatchObject({ stop: 'error', pages: 0 });
  });

  it('detects a token loop', async () => {
    const loop: OrdersPage = { orders: PAGES.first!.orders, continueToken: 'SAME' };
    const r = await paginateOrders(deps({ fetchFirst: async () => loop, fetchMore: async () => loop }), {
      maxPages: 50,
    });
    expect(r).toMatchObject({ stop: 'loop', pages: 2 });
  });

  it('can be cancelled between pages', async () => {
    const ctrl = new AbortController();
    const r = await paginateOrders(
      deps({ ingest: async (p) => (ctrl.abort(), { created: p.orders.length, updated: 0 }) }),
      { maxPages: 50, signal: ctrl.signal },
    );
    expect(r).toMatchObject({ stop: 'cancelled', pages: 1 });
  });

  it('incremental mode stops after N pages with nothing new', async () => {
    const r = await paginateOrders(deps({ ingest: async () => ({ created: 0, updated: 0 }) }), {
      maxPages: 50,
      stopAfterKnownPages: 2,
    });
    expect(r).toMatchObject({ stop: 'known', pages: 2 });
  });

  it('treats an empty page as the end', async () => {
    const r = await paginateOrders(deps({ fetchFirst: async () => ({ orders: [], continueToken: 'X' }) }), {
      maxPages: 50,
    });
    expect(r).toMatchObject({ stop: 'end', pages: 1, orders: 0 });
  });
});

describe('history import', () => {
  it('imports all pages; only the first page goes through regular ingestion (events), older pages are silent', async () => {
    const exec = fakeExec();
    const r = await importOrderHistory(exec, {
      direction: 'sale',
      mode: 'full',
      maxPages: 10,
      now: () => NOW.getTime(),
    });
    expect(r).toMatchObject({ stop: 'end', pages: 3, orders: 6, created: 6 });
    expect(await getDb().orders.count()).toBe(6);
    // Page 1 established the baseline: its events are baseline, and pages 2–3 emitted nothing at all.
    const ids = new Set(events.map((e) => e.payload['orderId']));
    expect([...ids].sort()).toEqual(['AAAA1111', 'BBBB2222', 'CCCC3333']);
    expect(events.every((e) => e.payload['baseline'] === true)).toBe(true);
    const old = await getDb().orders.get('DDDD4444');
    expect(old!.history).toEqual([{ status: 'closed', at: NOW.toISOString(), source: 'import' }]);
    expect(await getDb().customers.get('2000003')).toMatchObject({ name: 'BuyerGamma' });
    expect(
      exec.calls.map((c) => (c as unknown as { continueToken?: string }).continueToken ?? c.action),
    ).toEqual(['fetchPage', 'NEXTPAGE01', 'NEXTPAGE02']);
  });

  it('never emits events for old orders found after the baseline exists', async () => {
    await ingestOrders([], 'sale', NOW.getTime() - 1000); // baseline established by an earlier sync
    events = [];
    await ingestHistoricalOrders(PAGES.NEXTPAGE01!.orders, 'sale', NOW.getTime());
    expect(events).toEqual([]);
    expect(await getDb().orders.count()).toBe(2);
  });

  it('records status changes of known orders silently', async () => {
    const paid: ParsedOrder = { ...PAGES.NEXTPAGE01!.orders[1]! }; // EEEE5555 paid
    await ingestHistoricalOrders([paid], 'sale', 1000);
    const r = await ingestHistoricalOrders([{ ...paid, status: 'closed' }], 'sale', 2000);
    expect(r).toEqual({ created: 0, updated: 1 });
    const o = await getDb().orders.get('EEEE5555');
    expect(o!.status).toBe('closed');
    expect(o!.history.map((h) => [h.status, h.source])).toEqual([
      ['paid', 'import'],
      ['closed', 'import'],
    ]);
    // Impossible transitions are ignored.
    expect(await ingestHistoricalOrders([{ ...paid, status: 'paid' }], 'sale', 3000)).toEqual({
      created: 0,
      updated: 0,
    });
    expect(events).toEqual([]);
  });

  it('"missing" mode stops once pages contain nothing new', async () => {
    await importOrderHistory(fakeExec(), { direction: 'sale', mode: 'full', maxPages: 10 });
    const again = await importOrderHistory(fakeExec(), { direction: 'sale', mode: 'missing', maxPages: 10 });
    expect(again).toMatchObject({ stop: 'known', pages: 2, created: 0 });
  });

  it('reports paging as unsupported when the content command is missing (first page still imported)', async () => {
    const r = await importOrderHistory(fakeExec({ supportsPaging: false }), {
      direction: 'sale',
      mode: 'full',
      maxPages: 10,
    });
    expect(r).toMatchObject({ stop: 'error', pages: 1, created: 3 });
    expect(r.error).toBeInstanceOf(PagingUnsupportedError);
    expect(classifySyncError(r.error).kind).toBe('unsupported');
  });
});

describe('background sync steps', () => {
  it('validates content-script payloads and drops invalid items', () => {
    const p = parseOrdersPayload(
      {
        orders: [PAGES.first!.orders[0], { id: 5 }, { ...PAGES.first!.orders[1], direction: 'purchase' }],
        continueToken: 'x'.repeat(600),
      },
      'sale',
    );
    expect(p.orders.map((o) => o.id)).toEqual(['AAAA1111']);
    expect(p.continueToken).toBeNull();
    expect(parseOrdersPayload(null, 'sale')).toEqual({ orders: [], continueToken: null });
  });

  it('syncs the first page of sales', async () => {
    const r = await syncOrderList(fakeExec(), 'sale', NOW.getTime());
    expect(r.created).toEqual(['AAAA1111', 'BBBB2222', 'CCCC3333']);
    expect(r.baseline).toBe(true);
  });

  it('syncs finance operations idempotently', async () => {
    const ops = funpayParser.parseFinance(fixtureDoc('balance.html'), NOW);
    const exec: ExecFn = vi.fn(async () => ops);
    expect(await syncFinance(exec)).toEqual({ fetched: 4, created: 4 });
    expect(await syncFinance(exec)).toEqual({ fetched: 4, created: 0 });
    expect(exec).toHaveBeenCalledWith({ action: 'fetchPage', kind: 'finance', path: '/account/balance' });
  });

  it('syncs own profile listings and reviews', async () => {
    const doc = fixtureDoc('profile.html');
    const exec: ExecFn = async () => ({
      listings: funpayParser.parseProfileOffers(doc),
      reviews: funpayParser.parseReviews(doc, NOW),
    });
    expect(await syncProfile(exec)).toEqual({ listings: 2, newReviews: 2 });
    expect(await getDb().listings.count()).toBe(2);
    expect(
      events.filter((e) => e.type === 'REVIEW_RECEIVED').every((e) => e.payload['baseline'] === true),
    ).toBe(true);
  });

  it('classifies failures for status reporting', () => {
    expect(classifySyncError(Object.assign(new Error('x'), { name: 'NoFunPayTabError' })).kind).toBe(
      'awaiting_tab',
    );
    expect(classifySyncError(Object.assign(new Error('x'), { code: 'logged_out' })).kind).toBe('logged_out');
    expect(classifySyncError(Object.assign(new Error('x'), { code: 'rate_limited' })).kind).toBe(
      'rate_limited',
    );
    expect(classifySyncError('boom')).toEqual({ kind: 'error', message: 'boom' });
  });
});

describe('sync / import status records', () => {
  it('remembers the last success across failures', async () => {
    await writeSyncStatus('sales', 'ok', '', 1000);
    await writeSyncStatus('sales', 'awaiting_tab', 'No tab', 2000);
    expect(await readSyncStatus('sales')).toEqual({
      area: 'sales',
      state: 'awaiting_tab',
      lastAttemptAt: 2000,
      lastSuccessAt: 1000,
      message: 'No tab',
    });
  });

  it('marks imports that were running before a restart as interrupted', async () => {
    await writeImportStatus({
      direction: 'sale',
      mode: 'full',
      state: 'running',
      startedAt: 1,
      finishedAt: null,
      pages: 3,
      orders: 30,
      created: 30,
      updated: 0,
      stop: null,
      message: '',
    });
    expect(await markInterruptedImports(5)).toBe(1);
    expect(await readImportStatus('sale')).toMatchObject({ state: 'interrupted', finishedAt: 5, pages: 3 });
    expect(await markInterruptedImports(6)).toBe(0);
  });
});
