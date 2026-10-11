import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '@/features/export/csv';
import { ordersExport, ORDER_EXPORT_HEADERS } from '@/features/orders/export';
import {
  chatUrl,
  gameOf,
  idsText,
  isValidOrderId,
  orderTime,
  orderUrl,
  privateChatId,
  splitQuantity,
  userUrl,
} from '@/features/orders/model';
import {
  distinctCategories,
  distinctCurrencies,
  emptyFilter,
  filterOrders,
  topCounterparties,
  totalsOf,
} from '@/features/orders/query';
import { agingBucket, agingSummary, splitAge, unconfirmedOrders } from '@/features/orders/unconfirmed';
import { mkOrder, money } from '../analytics/dataset';

const H = 3_600_000;
const NOW = Date.parse('2024-11-05T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('order helpers', () => {
  it('builds FunPay links only for plausible ids', () => {
    expect(orderUrl('AAAA1111')).toBe('https://funpay.com/orders/AAAA1111/');
    expect(orderUrl('../evil')).toBeNull();
    expect(isValidOrderId('abc')).toBe(false);
    expect(userUrl('2000001')).toBe('https://funpay.com/users/2000001/');
    expect(userUrl('x')).toBeNull();
  });

  it('builds private chat ids as users-{min}-{max}', () => {
    expect(privateChatId('1000001', '2000001')).toBe('users-1000001-2000001');
    expect(privateChatId('2000001', '1000001')).toBe('users-1000001-2000001');
    expect(privateChatId('99', '100')).toBe('users-99-100'); // numeric, not lexicographic
    expect(privateChatId(null, '1')).toBeNull();
    expect(privateChatId('5', '5')).toBeNull();
    expect(chatUrl('users-1-2')).toBe('https://funpay.com/chat/?node=users-1-2');
  });

  it('splits FunPay quantity suffixes', () => {
    expect(splitQuantity('Test item alpha, 1 шт.')).toEqual({ title: 'Test item alpha', quantity: 1 });
    expect(splitQuantity('Gold, 500 pcs.')).toEqual({ title: 'Gold', quantity: 500 });
    expect(splitQuantity('Account, level 10')).toEqual({ title: 'Account, level 10', quantity: 1 });
    expect(gameOf('Game A, Accounts')).toBe('Game A');
    expect(gameOf('Solo')).toBe('Solo');
  });

  it('falls back to first-seen time when FunPay’s date is unknown', () => {
    expect(
      orderTime(mkOrder({ id: 'X1', createdAt: null, firstSeenAt: '2024-11-01T00:00:00.000Z' })),
    ).toEqual({ ts: Date.parse('2024-11-01T00:00:00.000Z'), approximate: true });
    expect(orderTime(mkOrder({ id: 'X2', createdAt: '2024-11-02T00:00:00.000Z' })).approximate).toBe(false);
  });
});

describe('unconfirmed-order aging', () => {
  it('uses half-open buckets <24h, 1–3d, 3–7d, >7d', () => {
    expect(agingBucket(0)).toBe('lt24h');
    expect(agingBucket(24 * H - 1)).toBe('lt24h');
    expect(agingBucket(24 * H)).toBe('d1to3');
    expect(agingBucket(72 * H - 1)).toBe('d1to3');
    expect(agingBucket(72 * H)).toBe('d3to7');
    expect(agingBucket(7 * 24 * H - 1)).toBe('d3to7');
    expect(agingBucket(7 * 24 * H)).toBe('gt7d');
  });

  const orders = [
    mkOrder({ id: 'U1000001', status: 'paid', createdAt: ago(1 * H), price: money(100) }),
    mkOrder({ id: 'U2000002', status: 'paid', createdAt: ago(30 * H), price: money(200) }),
    mkOrder({ id: 'U3000003', status: 'paid', createdAt: ago(80 * H), price: money(300, 'USD') }),
    mkOrder({ id: 'U4000004', status: 'paid', createdAt: ago(200 * H), price: money(400) }),
    mkOrder({ id: 'U5000005', status: 'paid', createdAt: null, firstSeenAt: ago(10 * H), price: money(500) }),
    mkOrder({ id: 'U6000006', status: 'closed', createdAt: ago(300 * H) }),
    mkOrder({ id: 'U7000007', status: 'paid', direction: 'purchase', createdAt: ago(300 * H) }),
  ];

  it('lists only paid sales at least N hours old, oldest first', () => {
    const list = unconfirmedOrders(orders, { now: NOW, minAgeHours: 2 });
    expect(list.map((u) => [u.order.id, u.bucket, u.approximate])).toEqual([
      ['U4000004', 'gt7d', false],
      ['U3000003', 'd3to7', false],
      ['U2000002', 'd1to3', false],
      ['U5000005', 'lt24h', true],
    ]);
    expect(unconfirmedOrders(orders, { now: NOW, minAgeHours: 0 })).toHaveLength(5);
  });

  it('summarises buckets per currency and copies ids newline-separated', () => {
    const list = unconfirmedOrders(orders, { now: NOW, minAgeHours: 0 });
    const s = agingSummary(list);
    expect(s.total).toBe(5);
    expect(s.buckets.lt24h).toEqual({ count: 2, amountByCurrency: { RUB: 600 } });
    expect(s.buckets.d3to7.amountByCurrency).toEqual({ USD: 300 });
    expect(s.amountByCurrency).toEqual({ RUB: 1200, USD: 300 });
    expect(s.oldest!.order.id).toBe('U4000004');
    expect(idsText(list.map((u) => u.order))).toBe('U4000004\nU3000003\nU2000002\nU5000005\nU1000001');
    expect(splitAge(26 * H + 5 * 60_000)).toEqual({ days: 1, hours: 2, minutes: 5 });
  });
});

describe('order filters', () => {
  const orders = [
    mkOrder({
      id: 'F1000001',
      status: 'paid',
      categoryName: 'Game A, Keys',
      price: money(100),
      createdAt: '2024-11-01T10:00:00.000Z',
      counterpartyName: 'Alice',
      counterpartyId: '3000001',
      description: 'Red key',
    }),
    mkOrder({
      id: 'F2000002',
      status: 'closed',
      categoryName: 'Game B, Gold',
      price: money(200, 'USD'),
      createdAt: '2024-11-03T10:00:00.000Z',
      counterpartyName: 'Bob',
      counterpartyId: '3000002',
      description: 'Gold',
    }),
    mkOrder({
      id: 'F3000003',
      status: 'refunded',
      categoryName: 'Game A, Keys',
      price: money(300),
      createdAt: '2024-11-04T10:00:00.000Z',
      counterpartyName: 'Alice',
      counterpartyId: '3000001',
      description: 'Blue key',
    }),
    mkOrder({
      id: 'F4000004',
      direction: 'purchase',
      price: money(400),
      createdAt: '2024-11-02T10:00:00.000Z',
    }),
  ];

  it('filters by direction, status, category, currency, date and text; newest first', () => {
    expect(filterOrders(orders, emptyFilter('sale')).map((o) => o.id)).toEqual([
      'F3000003',
      'F2000002',
      'F1000001',
    ]);
    expect(
      filterOrders(orders, { ...emptyFilter('sale'), statuses: ['paid', 'refunded'] }).map((o) => o.id),
    ).toEqual(['F3000003', 'F1000001']);
    expect(
      filterOrders(orders, { ...emptyFilter('sale'), category: 'Game B, Gold' }).map((o) => o.id),
    ).toEqual(['F2000002']);
    expect(filterOrders(orders, { ...emptyFilter('sale'), currency: 'USD' }).map((o) => o.id)).toEqual([
      'F2000002',
    ]);
    const range = {
      from: Date.parse('2024-11-02T00:00:00.000Z'),
      to: Date.parse('2024-11-04T00:00:00.000Z'),
    };
    expect(filterOrders(orders, { ...emptyFilter('sale'), range }).map((o) => o.id)).toEqual(['F2000002']);
    expect(filterOrders(orders, { ...emptyFilter('sale'), text: 'alice' }).map((o) => o.id)).toEqual([
      'F3000003',
      'F1000001',
    ]);
    expect(filterOrders(orders, { ...emptyFilter('sale'), text: '#f2000002' }).map((o) => o.id)).toEqual([
      'F2000002',
    ]);
    expect(filterOrders(orders, { ...emptyFilter('sale'), text: 'blue' }).map((o) => o.id)).toEqual([
      'F3000003',
    ]);
    expect(filterOrders(orders, emptyFilter('purchase')).map((o) => o.id)).toEqual(['F4000004']);
  });

  it('totals per currency, never mixing, refunds separate', () => {
    const t = totalsOf(filterOrders(orders, emptyFilter('sale')));
    expect(t.count).toBe(3);
    expect(t.amountByCurrency).toEqual({ RUB: 100, USD: 200 });
    expect(t.refundedByCurrency).toEqual({ RUB: 300 });
    expect(t.byStatus).toEqual({ paid: 1, closed: 1, refunded: 1, unknown: 0 });
  });

  it('lists categories, currencies and top counterparties', () => {
    expect(distinctCategories(orders, 'sale')).toEqual(['Game A, Keys', 'Game B, Gold']);
    expect(distinctCurrencies(orders, 'sale')).toEqual(['RUB', 'USD']);
    const top = topCounterparties(filterOrders(orders, emptyFilter('sale')));
    expect(top.map((c) => [c.name, c.orders, c.refunded])).toEqual([
      ['Alice', 1, 1],
      ['Bob', 1, 0],
    ]);
  });
});

describe('order export', () => {
  it('produces stable rows with decimal amounts and an explicit currency', () => {
    const o = mkOrder({
      id: 'E1000001',
      description: 'Item, 2 шт.',
      price: money(125050),
      createdAt: '2024-11-05T07:15:00.000Z',
      history: [{ status: 'paid', at: '2024-11-05T07:20:00.000Z', source: 'observed' }],
      status: 'paid',
    });
    const t = ordersExport([o], 'sale');
    expect(t.name).toBe('funpro-sales');
    expect(t.headers).toEqual([...ORDER_EXPORT_HEADERS]);
    expect(t.rows[0]).toEqual([
      'E1000001',
      'sale',
      'paid',
      '2024-11-05T07:15:00.000Z',
      '05.11.2024 10:15',
      'Buyer',
      '2000001',
      'Item, 2 шт.',
      'Game A, Accounts',
      2,
      1250.5,
      'RUB',
      'https://funpay.com/orders/E1000001/',
      '2024-11-05T00:00:00.000Z',
      'paid@2024-11-05T07:20:00.000Z',
    ]);
    expect((t.json as { url: string }[])[0]!.url).toBe('https://funpay.com/orders/E1000001/');
  });

  it('neutralises spreadsheet formulas coming from FunPay text', () => {
    const o = mkOrder({ id: 'E2000002', counterpartyName: '=HYPERLINK("http://x")', description: '+cmd' });
    const t = ordersExport([o], 'purchase');
    const parsed = parseCsv(toCsv(t.headers, t.rows));
    expect(parsed[1]![5]).toBe(`'=HYPERLINK("http://x")`);
    expect(parsed[1]![7]).toBe(`'+cmd`);
    expect(t.name).toBe('funpro-purchases');
  });
});
