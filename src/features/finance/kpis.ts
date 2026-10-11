/**
 * The four money figures the Finance page keeps strictly apart (per currency, never mixed):
 *
 *  1. Gross revenue  — sum of SALE order prices (buyer-facing) created in the period, refunds excluded.
 *  2. Net receipts   — income operations actually credited to the FunPay balance in the period.
 *  3. Cash flow      — income − expenses − withdrawals in the period (see breakdown.ts).
 *  4. Est. profit    — net receipts − cost of goods of the orders those receipts belong to
 *                      (seller-entered listing costs). An ESTIMATE: costs are user input and only
 *                      orders FunPro can match to a listing with a cost are covered.
 *
 * Also reports the fee FunPay effectively kept on orders where both the order price and the
 * credited amount are known (informative; not used to change any number above).
 */
import type { Currency, FinanceOperation, Listing, Order } from '@/shared/models';
import { createdTs, normalizeTitle, splitQuantity } from '@/features/orders/model';
import { sortCurrencies } from '@/features/orders/query';
import { uniqueTitleIndex } from '@/features/analytics/products';
import type { DateRange } from '@/features/analytics/time';
import { financeBreakdown, opState, opTime } from './breakdown';

export interface FinanceKpis {
  currency: Currency;
  grossRevenue: number;
  grossOrders: number;
  netReceipts: number;
  receiptOps: number;
  cashFlow: number;
  /** Cost of goods for receipts matched to an order + listing with a cost (same currency). */
  cogs: number;
  cogsKnownOps: number;
  cogsUnknownOps: number;
  /** netReceipts − cogs; null when there are no receipts at all. */
  estimatedProfit: number | null;
  observedFee: { orders: number; gross: number; net: number; pct: number | null };
}

export interface FinanceKpiInput {
  orders: readonly Order[];
  ops: readonly FinanceOperation[];
  listings: readonly Pick<Listing, 'id' | 'title' | 'costMinor' | 'price'>[];
  range: DateRange;
}

function empty(currency: Currency): FinanceKpis {
  return {
    currency,
    grossRevenue: 0,
    grossOrders: 0,
    netReceipts: 0,
    receiptOps: 0,
    cashFlow: 0,
    cogs: 0,
    cogsKnownOps: 0,
    cogsUnknownOps: 0,
    estimatedProfit: null,
    observedFee: { orders: 0, gross: 0, net: 0, pct: null },
  };
}

export function financeKpis(input: FinanceKpiInput): {
  currencies: Currency[];
  byCurrency: Partial<Record<Currency, FinanceKpis>>;
} {
  const { range } = input;
  const out: Partial<Record<Currency, FinanceKpis>> = {};
  const get = (c: Currency) => (out[c] ??= empty(c));

  for (const o of input.orders) {
    if (o.direction !== 'sale' || o.status === 'refunded') continue;
    const ts = createdTs(o);
    if (ts === null || ts < range.from || ts >= range.to) continue;
    const k = get(o.price.currency);
    k.grossRevenue += o.price.amountMinor;
    k.grossOrders++;
  }

  const breakdown = financeBreakdown(input.ops, range);
  for (const c of breakdown.currencies) get(c).cashFlow = breakdown.byCurrency[c]!.cashFlow;

  const salesById = new Map<string, Order>();
  for (const o of input.orders) if (o.direction === 'sale') salesById.set(o.id, o);
  const titleIndex = uniqueTitleIndex(input.listings);
  const listingsById = new Map(input.listings.map((l) => [l.id, l]));

  for (const op of input.ops) {
    if (op.kind !== 'income' || opState(op) === 'cancelled') continue;
    const t = opTime(op);
    if (t === null || t < range.from || t >= range.to) continue;
    const cur = op.amount.currency;
    const k = get(cur);
    k.netReceipts += op.amount.amountMinor;
    k.receiptOps++;
    const order = op.orderId ? salesById.get(op.orderId) : undefined;
    if (order && order.price.currency === cur && order.status !== 'refunded') {
      k.observedFee.orders++;
      k.observedFee.gross += order.price.amountMinor;
      k.observedFee.net += op.amount.amountMinor;
    }
    let costed = false;
    if (order && order.price.currency === cur) {
      const { title, quantity } = splitQuantity(order.description);
      const listingId = order.listingId ?? titleIndex.get(normalizeTitle(title)) ?? null;
      const listing = listingId ? listingsById.get(listingId) : undefined;
      if (
        listing &&
        listing.costMinor !== null &&
        listing.costMinor !== undefined &&
        listing.price.currency === cur
      ) {
        k.cogs += listing.costMinor * quantity;
        costed = true;
      }
    }
    if (costed) k.cogsKnownOps++;
    else k.cogsUnknownOps++;
  }

  for (const k of Object.values(out)) {
    if (!k) continue;
    k.estimatedProfit = k.receiptOps > 0 ? k.netReceipts - k.cogs : null;
    const f = k.observedFee;
    f.pct = f.gross > 0 ? 1 - f.net / f.gross : null;
  }
  return { currencies: sortCurrencies(Object.keys(out) as Currency[]), byCurrency: out };
}
