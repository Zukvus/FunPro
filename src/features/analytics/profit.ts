/**
 * ESTIMATED net profit per product (and listing).
 *
 *   net    = what the seller receives for an order:
 *            1. the amount actually credited ("Заказ #ID" income operation on /account/balance),
 *               when FunPro has seen it in the same currency;
 *            2. otherwise the order price reduced by the commission % from Settings → fees
 *               (seller price = buyer price / (1 + pct/100), the same convention as FunPay's
 *               calculator); category-specific pct first, then the default;
 *            3. otherwise the gross price (flagged: commission unknown).
 *   cost   = listing cost of goods (seller-entered `costMinor`, listing currency) × units — only
 *            when the listing currency equals the order currency (no silent conversion).
 *   profit = net − known costs.  Always labelled an estimate.
 */
import type { Currency, FinanceOperation, Listing, Order } from '@/shared/models';
import { createdTs, gameOf, normalizeTitle, splitQuantity } from '@/features/orders/model';
import { productKey, uniqueTitleIndex } from './products';
import type { DateRange } from './time';

export interface FeeSettings {
  categoryCommissionPct: Record<string, number>;
  defaultCommissionPct: number | null;
}

export function netFromBuyerPrice(buyerMinor: number, commissionPct: number): number {
  return Math.round(buyerMinor / (1 + commissionPct / 100));
}

/** Commission lookup: exact order category, listing category, game, then the default. */
export function commissionFor(fees: FeeSettings, categoryName: string, listingCategory?: string | null): number | null {
  const table = fees.categoryCommissionPct;
  for (const k of [categoryName, listingCategory ?? '', gameOf(categoryName)]) {
    if (k && typeof table[k] === 'number') return table[k];
  }
  return fees.defaultCommissionPct;
}

export function isCancelledOp(op: Pick<FinanceOperation, 'status'>): boolean {
  return /cancel|отмен|скасов/i.test(op.status);
}

/** Credited amount per order id (income operations, not cancelled), by currency. */
export function creditsByOrder(ops: readonly FinanceOperation[]): Map<string, Partial<Record<Currency, number>>> {
  const out = new Map<string, Partial<Record<Currency, number>>>();
  for (const op of ops) {
    if (op.kind !== 'income' || !op.orderId || isCancelledOp(op)) continue;
    const rec = out.get(op.orderId) ?? {};
    rec[op.amount.currency] = (rec[op.amount.currency] ?? 0) + op.amount.amountMinor;
    out.set(op.orderId, rec);
  }
  return out;
}

export type NetBasis = 'actual' | 'estimated' | 'gross';

export interface OrderNet {
  net: number;
  basis: NetBasis;
  commissionPct: number | null;
}

export function orderNet(o: Order, credits: Map<string, Partial<Record<Currency, number>>>, fees: FeeSettings, listingCategory?: string | null): OrderNet {
  const credited = credits.get(o.id)?.[o.price.currency];
  const pct = commissionFor(fees, o.categoryName, listingCategory);
  if (typeof credited === 'number' && credited > 0) return { net: credited, basis: 'actual', commissionPct: pct };
  if (pct !== null) return { net: netFromBuyerPrice(o.price.amountMinor, pct), basis: 'estimated', commissionPct: pct };
  return { net: o.price.amountMinor, basis: 'gross', commissionPct: null };
}

export interface ProfitRow {
  key: string;
  title: string;
  category: string;
  currency: Currency;
  listingId: string | null;
  orders: number;
  units: number;
  gross: number;
  net: number;
  netActualOrders: number;
  netEstimatedOrders: number;
  /** Orders where neither a credited amount nor a commission % was known (net = gross). */
  netGrossOrders: number;
  /** Commission % used for estimates (null when none configured for this category). */
  commissionPct: number | null;
  cost: number;
  costKnownOrders: number;
  costUnknownOrders: number;
  /** Orders whose listing cost is in another currency (not converted). */
  costCurrencyMismatch: number;
  profit: number;
  /** True when every order had a net amount (actual/estimated) and a known cost. */
  complete: boolean;
}

export interface ProfitOptions {
  range: DateRange;
  fees: FeeSettings;
}

export function profitByProduct(
  orders: readonly Order[],
  listings: readonly Pick<Listing, 'id' | 'title' | 'costMinor' | 'price' | 'categoryName'>[],
  financeOps: readonly FinanceOperation[],
  opts: ProfitOptions,
): ProfitRow[] {
  const titleIndex = uniqueTitleIndex(listings);
  const byId = new Map(listings.map((l) => [l.id, l]));
  const credits = creditsByOrder(financeOps);
  const rows = new Map<string, ProfitRow>();

  for (const o of orders) {
    if (o.direction !== 'sale' || o.status === 'refunded') continue;
    const ts = createdTs(o);
    if (ts === null || ts < opts.range.from || ts >= opts.range.to) continue;
    const { title, quantity } = splitQuantity(o.description);
    const listingId = o.listingId ?? titleIndex.get(normalizeTitle(title)) ?? null;
    const listing = listingId ? byId.get(listingId) : undefined;
    const cur = o.price.currency;
    const key = `${productKey(title, o.categoryName)}|${cur}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        title,
        category: o.categoryName,
        currency: cur,
        listingId,
        orders: 0,
        units: 0,
        gross: 0,
        net: 0,
        netActualOrders: 0,
        netEstimatedOrders: 0,
        netGrossOrders: 0,
        commissionPct: null,
        cost: 0,
        costKnownOrders: 0,
        costUnknownOrders: 0,
        costCurrencyMismatch: 0,
        profit: 0,
        complete: true,
      };
      rows.set(key, row);
    }
    const n = orderNet(o, credits, opts.fees, listing?.categoryName);
    row.orders++;
    row.units += quantity;
    row.gross += o.price.amountMinor;
    row.net += n.net;
    if (n.basis === 'actual') row.netActualOrders++;
    else if (n.basis === 'estimated') row.netEstimatedOrders++;
    else row.netGrossOrders++;
    if (n.commissionPct !== null) row.commissionPct = n.commissionPct;

    if (listing && listing.costMinor !== null && listing.costMinor !== undefined) {
      if (listing.price.currency === cur) {
        row.cost += listing.costMinor * quantity;
        row.costKnownOrders++;
      } else {
        row.costCurrencyMismatch++;
      }
    } else {
      row.costUnknownOrders++;
    }
  }

  for (const r of rows.values()) {
    r.profit = r.net - r.cost;
    r.complete = r.netGrossOrders === 0 && r.costUnknownOrders === 0 && r.costCurrencyMismatch === 0;
  }
  return [...rows.values()].sort((a, b) => (a.currency === b.currency ? b.profit - a.profit : a.currency.localeCompare(b.currency)));
}

export interface ProfitTotals {
  currency: Currency;
  orders: number;
  gross: number;
  net: number;
  cost: number;
  profit: number;
  complete: boolean;
}

export function profitTotals(rows: readonly ProfitRow[]): ProfitTotals[] {
  const map = new Map<Currency, ProfitTotals>();
  for (const r of rows) {
    const t = map.get(r.currency) ?? { currency: r.currency, orders: 0, gross: 0, net: 0, cost: 0, profit: 0, complete: true };
    t.orders += r.orders;
    t.gross += r.gross;
    t.net += r.net;
    t.cost += r.cost;
    t.profit += r.profit;
    t.complete &&= r.complete;
    map.set(r.currency, t);
  }
  return [...map.values()];
}
