/**
 * Filtering/sorting of orders for the Orders page (pure; runs on in-memory arrays).
 */
import type { Currency, Order, OrderDirection, OrderStatus } from '@/shared/models';
import type { DateRange } from '@/features/analytics/time';
import { orderTime } from './model';

export interface OrderFilter {
  direction: OrderDirection;
  /** Empty = every status. */
  statuses: readonly OrderStatus[];
  /** Exact category name ("Game, Section"); null = all. */
  category: string | null;
  currency: Currency | null;
  /** Filters by the order's best-known time (FunPay date, else first-seen time). */
  range: DateRange | null;
  /** Case-insensitive search over id, counterparty, description and category. */
  text: string;
}

export function emptyFilter(direction: OrderDirection): OrderFilter {
  return { direction, statuses: [], category: null, currency: null, range: null, text: '' };
}

export function matchesText(o: Order, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  return (
    o.id.toLowerCase().includes(q) ||
    o.counterpartyName.toLowerCase().includes(q) ||
    o.description.toLowerCase().includes(q) ||
    o.categoryName.toLowerCase().includes(q) ||
    (o.counterpartyId ?? '') === q
  );
}

export function matchesFilter(o: Order, f: OrderFilter): boolean {
  if (o.direction !== f.direction) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(o.status)) return false;
  if (f.category !== null && o.categoryName !== f.category) return false;
  if (f.currency !== null && o.price.currency !== f.currency) return false;
  if (f.range) {
    const { ts } = orderTime(o);
    if (ts < f.range.from || ts >= f.range.to) return false;
  }
  return matchesText(o, f.text);
}

/** Newest first; ties broken by id for a stable order. */
export function sortNewestFirst(orders: Order[]): Order[] {
  const keyed = orders.map((o) => [orderTime(o).ts, o] as const);
  keyed.sort((a, b) => b[0] - a[0] || (a[1].id < b[1].id ? 1 : a[1].id > b[1].id ? -1 : 0));
  return keyed.map(([, o]) => o);
}

export function filterOrders(orders: readonly Order[], f: OrderFilter): Order[] {
  return sortNewestFirst(orders.filter((o) => matchesFilter(o, f)));
}

export function distinctCategories(orders: readonly Order[], direction: OrderDirection): string[] {
  const set = new Set<string>();
  for (const o of orders) if (o.direction === direction && o.categoryName) set.add(o.categoryName);
  return [...set].sort((a, b) => a.localeCompare(b));
}

const CURRENCY_ORDER: readonly Currency[] = ['RUB', 'USD', 'EUR', 'UAH', 'UNKNOWN'];

export function sortCurrencies(list: Iterable<Currency>): Currency[] {
  return [...new Set(list)].sort((a, b) => CURRENCY_ORDER.indexOf(a) - CURRENCY_ORDER.indexOf(b));
}

export function distinctCurrencies(orders: readonly Order[], direction?: OrderDirection): Currency[] {
  const set = new Set<Currency>();
  for (const o of orders) if (!direction || o.direction === direction) set.add(o.price.currency);
  return sortCurrencies(set);
}

export interface OrderSetTotals {
  count: number;
  byStatus: Record<OrderStatus, number>;
  /** Sum of non-refunded order prices, per currency (never mixed). */
  amountByCurrency: Partial<Record<Currency, number>>;
  refundedByCurrency: Partial<Record<Currency, number>>;
}

/** Totals of a (filtered) set of orders, per currency. */
export function totalsOf(orders: readonly Order[]): OrderSetTotals {
  const out: OrderSetTotals = { count: 0, byStatus: { paid: 0, closed: 0, refunded: 0, unknown: 0 }, amountByCurrency: {}, refundedByCurrency: {} };
  for (const o of orders) {
    out.count++;
    out.byStatus[o.status]++;
    const c = o.price.currency;
    if (o.status === 'refunded') out.refundedByCurrency[c] = (out.refundedByCurrency[c] ?? 0) + o.price.amountMinor;
    else out.amountByCurrency[c] = (out.amountByCurrency[c] ?? 0) + o.price.amountMinor;
  }
  return out;
}

export interface CounterpartyStat {
  key: string;
  name: string;
  id: string | null;
  orders: number;
  refunded: number;
  amountByCurrency: Partial<Record<Currency, number>>;
}

/** Purchases: who the seller buys from most (or, for sales, top buyers). Sorted by order count. */
export function topCounterparties(orders: readonly Order[], limit = 10): CounterpartyStat[] {
  const map = new Map<string, CounterpartyStat>();
  for (const o of orders) {
    const key = o.counterpartyId ?? `name:${o.counterpartyName.toLowerCase()}`;
    let s = map.get(key);
    if (!s) {
      s = { key, name: o.counterpartyName, id: o.counterpartyId, orders: 0, refunded: 0, amountByCurrency: {} };
      map.set(key, s);
    }
    if (o.status === 'refunded') {
      s.refunded++;
      continue;
    }
    s.orders++;
    s.amountByCurrency[o.price.currency] = (s.amountByCurrency[o.price.currency] ?? 0) + o.price.amountMinor;
  }
  return [...map.values()].sort((a, b) => b.orders - a.orders || b.refunded - a.refunded || a.name.localeCompare(b.name)).slice(0, limit);
}
