import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { funpayParser } from '@/adapters/funpay';
import type { ParsedOrder } from '@/adapters/funpay/types';
import { registerCoreHandlers } from '@/background/core-handlers';
import { dispatch } from '@/background/router';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests } from '@/core/events/bus';
import { ingestOrders } from '@/features/sync/ingest';
import { loadFixture } from '../../fixtures';

const NOW = new Date('2024-11-05T12:00:00Z');
const URL_FILTERED = 'https://funpay.com/orders/trade?state=closed';

function orders(name: string): ParsedOrder[] {
  const doc = new DOMParser().parseFromString(loadFixture(name), 'text/html');
  return funpayParser.parseOrders(doc, 'sale', NOW).orders;
}

/** `cs.ingest` from FunPro's content script on a FunPay sales page (filtered = silent). */
const ingest = (items: ParsedOrder[], silent: boolean) =>
  dispatch(
    {
      __funpro: 1,
      method: 'cs.ingest',
      params: { kind: 'orders', url: URL_FILTERED, items, context: { direction: 'sale', silent } },
    },
    { id: browser.runtime.id, url: URL_FILTERED, tab: { id: 7, url: URL_FILTERED } },
  );

const newsEvents = async () => (await getDb().events.toArray()).filter((e) => e.payload['baseline'] !== true);

beforeAll(() => registerCoreHandlers());
beforeEach(async () => {
  resetDbForTests();
  clearEventHandlersForTests();
  await ingestOrders([], 'sale', NOW.getTime() - 1000); // baseline from an earlier sync
});

describe('order pages opened with filters or paging (cs.ingest, silent)', () => {
  it('stores orders FunPro has never seen without treating them as new', async () => {
    const [closed, paid] = orders('orders-sales-page2.html'); // DDDD4444 closed, EEEE5555 paid
    expect(await ingest([closed!, paid!], true)).toMatchObject({ ok: true });
    expect(await getDb().orders.count()).toBe(2);
    expect(await newsEvents()).toEqual([]);
  });

  it('still reports status changes of orders FunPro already knows', async () => {
    const paid = orders('orders-sales-page2.html')[1]!;
    await ingest([paid], true);
    await ingest([{ ...paid, status: 'closed' }], true);
    const events = await newsEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.payload['orderId'] === paid.id)).toBe(true);
    expect(events.map((e) => e.type)).not.toContain('ORDER_PAID');
  });

  it('treats an unknown paid order on the unfiltered list as new', async () => {
    const paid = orders('orders-sales-page2.html')[1]!;
    await ingest([{ ...paid, id: 'HHHH8888' }], false);
    expect((await newsEvents()).map((e) => e.type)).toContain('ORDER_PAID');
  });
});
