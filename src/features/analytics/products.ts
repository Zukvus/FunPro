/**
 * Product-level performance. FunPay order rows carry the offer's short description (plus a
 * ", N шт." quantity suffix) and the category — not the offer id — so products are grouped by
 * normalised description + category. A listing link is attached when the order carries a listing
 * id, or when exactly one of the seller's listings has the same title.
 *
 * Conversion rates are NOT computable: FunPay does not expose impressions/views to sellers.
 */
import type { Currency, Listing, Order, OrderDirection } from '@/shared/models';
import { createdTs, normalizeTitle, splitQuantity } from '@/features/orders/model';
import type { DateRange } from './time';

export interface ProductRow {
  key: string;
  title: string;
  category: string;
  /** Non-refunded orders. */
  orders: number;
  refunded: number;
  /** Units sold (quantity suffix), non-refunded. */
  units: number;
  grossByCurrency: Partial<Record<Currency, number>>;
  listingId: string | null;
  listingMatch: 'order' | 'title' | null;
}

export function productKey(title: string, category: string): string {
  return `${normalizeTitle(title)}|${normalizeTitle(category)}`;
}

/** Map normalised listing title → listing id, only for titles that are unique among the seller's listings. */
export function uniqueTitleIndex(listings: readonly Pick<Listing, 'id' | 'title'>[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const l of listings) {
    const k = normalizeTitle(l.title);
    if (!k) continue;
    seen.set(k, seen.has(k) ? null : l.id);
  }
  const out = new Map<string, string>();
  for (const [k, v] of seen) if (v) out.set(k, v);
  return out;
}

export interface ProductOptions {
  range: DateRange;
  direction?: OrderDirection;
}

export function productPerformance(
  orders: readonly Order[],
  listings: readonly Pick<Listing, 'id' | 'title'>[],
  opts: ProductOptions,
): ProductRow[] {
  const direction = opts.direction ?? 'sale';
  const titleIndex = uniqueTitleIndex(listings);
  const rows = new Map<string, ProductRow>();
  for (const o of orders) {
    if (o.direction !== direction) continue;
    const ts = createdTs(o);
    if (ts === null || ts < opts.range.from || ts >= opts.range.to) continue;
    const { title, quantity } = splitQuantity(o.description);
    const key = productKey(title, o.categoryName);
    let row = rows.get(key);
    if (!row) {
      const byTitle = titleIndex.get(normalizeTitle(title)) ?? null;
      row = {
        key,
        title,
        category: o.categoryName,
        orders: 0,
        refunded: 0,
        units: 0,
        grossByCurrency: {},
        listingId: o.listingId ?? byTitle,
        listingMatch: o.listingId ? 'order' : byTitle ? 'title' : null,
      };
      rows.set(key, row);
    } else if (!row.listingId && o.listingId) {
      row.listingId = o.listingId;
      row.listingMatch = 'order';
    }
    if (o.status === 'refunded') {
      row.refunded++;
      continue;
    }
    row.orders++;
    row.units += quantity;
    row.grossByCurrency[o.price.currency] =
      (row.grossByCurrency[o.price.currency] ?? 0) + o.price.amountMinor;
  }
  return [...rows.values()];
}

export type RankBy = 'orders' | 'revenue';

export interface RankOptions {
  by: RankBy;
  /** Required for revenue ranking: revenue is only comparable within one currency. */
  currency?: Currency;
  order: 'best' | 'worst';
  limit: number;
}

/**
 * Best/worst products. Revenue rankings only consider products sold in `currency`; count rankings
 * consider every product that had at least one order (refunded-only products rank last).
 */
export function rankProducts(rows: readonly ProductRow[], opts: RankOptions): ProductRow[] {
  let pool: ProductRow[];
  let value: (r: ProductRow) => number;
  if (opts.by === 'revenue') {
    const cur = opts.currency;
    if (!cur) return [];
    pool = rows.filter((r) => (r.grossByCurrency[cur] ?? 0) > 0);
    value = (r) => r.grossByCurrency[cur] ?? 0;
  } else {
    pool = rows.filter((r) => r.orders + r.refunded > 0);
    value = (r) => r.orders;
  }
  const dir = opts.order === 'best' ? -1 : 1;
  return [...pool]
    .sort(
      (a, b) =>
        dir * (value(a) - value(b)) ||
        (opts.order === 'best' ? a.refunded - b.refunded : b.refunded - a.refunded) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, Math.max(0, opts.limit));
}

/** Active listings that had no (non-refunded) order in the period — matched by title. */
export function listingsWithoutSales<L extends Pick<Listing, 'id' | 'title' | 'active'>>(
  listings: readonly L[],
  rows: readonly ProductRow[],
): L[] {
  const sold = new Set<string>();
  for (const r of rows) if (r.orders > 0) sold.add(normalizeTitle(r.title));
  const soldIds = new Set(rows.filter((r) => r.orders > 0 && r.listingId).map((r) => r.listingId!));
  return listings.filter((l) => l.active && !soldIds.has(l.id) && !sold.has(normalizeTitle(l.title)));
}
