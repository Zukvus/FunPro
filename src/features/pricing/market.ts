/**
 * Market reconstruction from competitor snapshots (pure functions).
 *
 * `ingestCompetitors` stores a snapshot when an offer's price changes or the previous snapshot is
 * older than 6 h. An offer is therefore considered present at time t when its latest snapshot at or
 * before t is at most STALE_MS old. Offers that left the page linger up to that window — a
 * documented approximation.
 */
import type { CompetitorSnapshot, Currency, Money } from '@/shared/models';
import { titleSimilarity } from './similarity';

export const STALE_MS = 24 * 3600_000;

export interface MarketOffer {
  offerId: string;
  sellerId: string | null;
  sellerName: string;
  title: string;
  price: Money;
  /** Epoch ms of the snapshot this state comes from. */
  at: number;
  promoted: boolean;
  online: boolean | null;
  rating: number | null;
  reviewCount: number | null;
  /** Epoch ms of every observed price change of this offer up to `at`. */
  changeTimes: number[];
}

export interface OfferHistory {
  /** Snapshots per offer, ascending by time. */
  byOffer: Map<string, { at: number; snap: CompetitorSnapshot }[]>;
  /** Distinct observation times (page views), ascending. */
  times: number[];
}

export function buildHistory(snapshots: readonly CompetitorSnapshot[]): OfferHistory {
  const byOffer = new Map<string, { at: number; snap: CompetitorSnapshot }[]>();
  const times = new Set<number>();
  for (const s of snapshots) {
    const at = Date.parse(s.at);
    if (!Number.isFinite(at)) continue;
    times.add(at);
    let list = byOffer.get(s.offerId);
    if (!list) byOffer.set(s.offerId, (list = []));
    list.push({ at, snap: s });
  }
  for (const list of byOffer.values()) list.sort((a, b) => a.at - b.at);
  return { byOffer, times: [...times].sort((a, b) => a - b) };
}

/** Latest known state of every offer at time t (inclusive), ignoring entries older than staleMs. */
export function stateAt(history: OfferHistory, t: number, staleMs = STALE_MS): MarketOffer[] {
  const out: MarketOffer[] = [];
  for (const [offerId, list] of history.byOffer) {
    let idx = -1;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.at <= t) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (idx < 0) continue;
    const cur = list[idx]!;
    if (t - cur.at > staleMs) continue;
    const changeTimes: number[] = [];
    for (let i = 1; i <= idx; i++) {
      const a = list[i - 1]!.snap.price;
      const b = list[i]!.snap.price;
      if (a.amountMinor !== b.amountMinor || a.currency !== b.currency) changeTimes.push(list[i]!.at);
    }
    const s = cur.snap;
    out.push({
      offerId,
      sellerId: s.sellerId,
      sellerName: s.sellerName,
      title: s.title,
      price: s.price,
      at: cur.at,
      promoted: s.promoted,
      online: s.online,
      rating: s.rating,
      reviewCount: s.reviewCount,
      changeTimes,
    });
  }
  return out.sort((a, b) => a.price.amountMinor - b.price.amountMinor || a.offerId.localeCompare(b.offerId));
}

export type Exclusion = 'own' | 'ignored' | 'currency' | 'band' | 'similarity';

export interface Classified {
  offer: MarketOffer;
  similarity: number;
  excluded: Exclusion | null;
}

export interface OwnIdentity {
  /** Every listing id of the seller (own offers are never competitors). */
  listingIds: readonly string[];
  sellerId: string | null;
  sellerName: string | null;
}

export interface ComparableOptions {
  title: string;
  currency: Currency;
  currentPriceMinor: number;
  own: OwnIdentity;
  ignoreSellers?: readonly string[];
  minSimilarity?: number;
  /** ±% around the current price; null disables the band. */
  priceBandPct?: number | null;
}

export function isOwnOffer(
  o: Pick<MarketOffer, 'offerId' | 'sellerId' | 'sellerName'>,
  own: OwnIdentity,
): boolean {
  if (own.listingIds.includes(o.offerId)) return true;
  if (own.sellerId && o.sellerId && o.sellerId === own.sellerId) return true;
  return !!own.sellerName && !!o.sellerName && o.sellerName.toLowerCase() === own.sellerName.toLowerCase();
}

export function classifyOffers(offers: readonly MarketOffer[], opts: ComparableOptions): Classified[] {
  const ignore = new Set((opts.ignoreSellers ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));
  const band = opts.priceBandPct ?? null;
  const lo = band === null ? -Infinity : opts.currentPriceMinor * (1 - band / 100);
  const hi = band === null ? Infinity : opts.currentPriceMinor * (1 + band / 100);
  return offers.map((offer) => {
    const similarity = titleSimilarity(opts.title, offer.title);
    let excluded: Exclusion | null = null;
    if (isOwnOffer(offer, opts.own)) excluded = 'own';
    else if (
      ignore.has(offer.sellerName.toLowerCase()) ||
      (offer.sellerId !== null && ignore.has(offer.sellerId.toLowerCase()))
    )
      excluded = 'ignored';
    else if (
      offer.price.currency === 'UNKNOWN' ||
      offer.price.currency !== opts.currency ||
      offer.price.amountMinor <= 0
    )
      excluded = 'currency';
    else if (opts.currentPriceMinor > 0 && (offer.price.amountMinor < lo || offer.price.amountMinor > hi))
      excluded = 'band';
    else if ((opts.minSimilarity ?? 0) > 0 && similarity < (opts.minSimilarity ?? 0)) excluded = 'similarity';
    return { offer, similarity, excluded };
  });
}

export function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export interface MarketStats {
  count: number;
  lowestMinor: number | null;
  medianMinor: number | null;
  highestMinor: number | null;
  /** 1-based position of the seller among comparable offers + the seller (ties share the better rank). */
  rank: number;
  total: number;
}

export function marketStats(comparablePrices: readonly number[], myPriceMinor: number): MarketStats {
  const sorted = [...comparablePrices].sort((a, b) => a - b);
  return {
    count: sorted.length,
    lowestMinor: sorted[0] ?? null,
    medianMinor: median(sorted),
    highestMinor: sorted.at(-1) ?? null,
    rank: 1 + sorted.filter((p) => p < myPriceMinor).length,
    total: sorted.length + 1,
  };
}

/** Own offer price at time t from the public snapshots (same semantics as competitors). */
export function ownPriceAt(
  history: OfferHistory,
  listingId: string,
  t: number,
  staleMs = STALE_MS,
): Money | null {
  const list = history.byOffer.get(listingId);
  if (!list) return null;
  let found: { at: number; snap: CompetitorSnapshot } | null = null;
  for (const e of list) {
    if (e.at <= t) found = e;
    else break;
  }
  return found && t - found.at <= staleMs ? found.snap.price : null;
}

export interface HistoryPoint {
  at: number;
  lowestMinor: number | null;
  medianMinor: number | null;
  ownMinor: number | null;
  count: number;
}

/** Lowest / median comparable price and the seller's own price at every observation time. */
export function historySeries(
  history: OfferHistory,
  opts: Omit<ComparableOptions, 'currentPriceMinor'> & {
    listingId: string;
    fallbackPriceMinor: number;
    from?: number;
  },
): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const t of history.times) {
    if (opts.from !== undefined && t < opts.from) continue;
    const own = ownPriceAt(history, opts.listingId, t);
    const current = own && own.currency === opts.currency ? own.amountMinor : opts.fallbackPriceMinor;
    const comparable = classifyOffers(stateAt(history, t), { ...opts, currentPriceMinor: current })
      .filter((c) => c.excluded === null)
      .map((c) => c.offer.price.amountMinor)
      .sort((a, b) => a - b);
    out.push({
      at: t,
      lowestMinor: comparable[0] ?? null,
      medianMinor: median(comparable),
      ownMinor: own && own.currency === opts.currency ? own.amountMinor : null,
      count: comparable.length,
    });
  }
  return out;
}
