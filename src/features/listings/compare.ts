/**
 * Side-by-side comparison of 2–4 of the seller's own listings: economics (net / profit after the
 * known commission), competitive position from the latest public-category snapshot, and sales of the
 * last 30 days. Everything is computed from locally stored data; nothing is fetched.
 *
 * Sales are attributed to a listing the same way the analytics module does it: by the order's
 * listing id, or by a title that is unique among the seller's listings. Listings whose sales cannot
 * be attributed show `null` (unknown) rather than 0.
 */
import { getDb } from '@/core/db/db';
import type { Settings } from '@/core/settings/schema';
import { productPerformance } from '@/features/analytics/products';
import { normalizeTitle } from '@/features/orders/model';
import { readLastSession } from '@/features/pricing/context';
import {
  buildHistory,
  classifyOffers,
  marketStats,
  ownPriceAt,
  stateAt,
  type OwnIdentity,
} from '@/features/pricing/market';
import type { CompetitorSnapshot, Currency, Listing, Order } from '@/shared/models';
import { listingEconomics, type ListingEconomics } from './commission';

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;
const MARKET_WINDOW_MS = 2 * 86400_000;
const SALES_WINDOW_MS = 30 * 86400_000;

export interface MarketPosition {
  /** Comparable competitor offers in the latest snapshot. */
  count: number;
  lowestMinor: number | null;
  medianMinor: number | null;
  rank: number;
  total: number;
  observedAt: number;
}

export interface SalesSummary {
  orders: number;
  refunded: number;
  grossByCurrency: Partial<Record<Currency, number>>;
}

export interface ComparisonColumn {
  listing: Listing;
  economics: ListingEconomics;
  /** Null when the category has never been observed (open it on FunPay or refresh prices). */
  market: MarketPosition | null;
  /** Null when orders cannot be attributed to this listing (non-unique title, no listing id). */
  sales: SalesSummary | null;
}

export function canCompare(count: number): boolean {
  return count >= MIN_COMPARE && count <= MAX_COMPARE;
}

/** Pure part: market position of one listing given the snapshots of its category. */
export function marketPositionFor(
  listing: Listing,
  snapshots: readonly CompetitorSnapshot[],
  own: OwnIdentity,
): MarketPosition | null {
  const history = buildHistory(snapshots);
  const at = history.times.at(-1);
  if (at === undefined) return null;
  const state = stateAt(history, at);
  const ownPrice = ownPriceAt(history, listing.id, at);
  const current =
    ownPrice && ownPrice.currency === listing.price.currency
      ? ownPrice.amountMinor
      : listing.price.amountMinor;
  const prices = classifyOffers(state, {
    title: listing.title,
    currency: listing.price.currency,
    currentPriceMinor: current,
    own,
    priceBandPct: 50,
  })
    .filter((c) => c.excluded === null)
    .map((c) => c.offer.price.amountMinor);
  const s = marketStats(prices, current);
  return {
    count: s.count,
    lowestMinor: s.lowestMinor,
    medianMinor: s.medianMinor,
    rank: s.rank,
    total: s.total,
    observedAt: at,
  };
}

/** Pure part: 30-day sales per listing (only attributable listings get a summary). */
export function salesFor(
  listings: readonly Listing[],
  allListings: readonly Listing[],
  orders: readonly Order[],
  now: number,
): Map<string, SalesSummary> {
  const rows = productPerformance(orders, allListings, {
    range: { from: now - SALES_WINDOW_MS, to: now + 1 },
  });
  const out = new Map<string, SalesSummary>();
  const wanted = new Set(listings.map((l) => l.id));
  for (const r of rows) {
    if (!r.listingId || !wanted.has(r.listingId)) continue;
    const prev = out.get(r.listingId) ?? { orders: 0, refunded: 0, grossByCurrency: {} };
    const gross = { ...prev.grossByCurrency };
    for (const [cur, v] of Object.entries(r.grossByCurrency) as [Currency, number][])
      gross[cur] = (gross[cur] ?? 0) + v;
    out.set(r.listingId, {
      orders: prev.orders + r.orders,
      refunded: prev.refunded + r.refunded,
      grossByCurrency: gross,
    });
  }
  return out;
}

export async function loadComparison(
  ids: readonly string[],
  settings: Settings,
  now = Date.now(),
): Promise<ComparisonColumn[]> {
  if (!canCompare(ids.length)) throw new Error(`Select ${MIN_COMPARE}–${MAX_COMPARE} listings to compare`);
  const db = getDb();
  const allListings = await db.listings.toArray();
  const listings = ids.map((id) => allListings.find((l) => l.id === id)).filter((l): l is Listing => !!l);
  const session = await readLastSession();
  const own: OwnIdentity = {
    listingIds: allListings.map((l) => l.id),
    sellerId: session?.userId ?? null,
    sellerName: session?.username ?? null,
  };
  const since = new Date(now - MARKET_WINDOW_MS).toISOString();
  const orders = await db.orders.where('direction').equals('sale').toArray();
  const sales = salesFor(listings, allListings, orders, now);
  const snapshotsByNode = new Map<string, CompetitorSnapshot[]>();
  for (const l of listings) {
    if (!l.nodeId || snapshotsByNode.has(l.nodeId)) continue;
    snapshotsByNode.set(
      l.nodeId,
      await db.competitorSnapshots.where('[nodeId+at]').between([l.nodeId, since], [l.nodeId, '￿']).toArray(),
    );
  }
  return listings.map((listing) => ({
    listing,
    economics: listingEconomics(listing, settings.fees),
    market: listing.nodeId
      ? marketPositionFor(listing, snapshotsByNode.get(listing.nodeId) ?? [], own)
      : null,
    // A title shared by several listings cannot be attributed: report unknown rather than zero.
    sales:
      sales.get(listing.id) ??
      (isTitleUnique(listing, allListings) ? { orders: 0, refunded: 0, grossByCurrency: {} } : null),
  }));
}

/** Same normalisation as the analytics product matcher (uniqueTitleIndex). */
export function isTitleUnique(
  listing: Pick<Listing, 'id' | 'title'>,
  all: readonly Pick<Listing, 'id' | 'title'>[],
): boolean {
  const k = normalizeTitle(listing.title);
  return !!k && all.filter((l) => normalizeTitle(l.title) === k).length === 1;
}
