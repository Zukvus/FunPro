/**
 * Loads everything the engine / UI need for one listing from IndexedDB and storage.
 * Works in the background and in the dashboard (same extension origin).
 */
import { storage } from 'wxt/utils/storage';
import { getDb } from '@/core/db/db';
import type { Settings } from '@/core/settings/schema';
import type { CompetitorSnapshot, Listing } from '@/shared/models';
import type { SessionInfo } from '@/shared/session';
import {
  buildHistory,
  ownPriceAt,
  stateAt,
  type MarketOffer,
  type OfferHistory,
  type OwnIdentity,
} from './market';
import { getPendingOwnPrice, getRule, type PriceRuleExt } from './model';

/** Same storage item the background tab registry writes (`src/background/tabs.ts`). */
export async function readLastSession(): Promise<SessionInfo | null> {
  return (await storage.getItem<SessionInfo>('local:lastSession')) ?? null;
}

/** Commission % for a listing: per-node setting, then category name, then the default; null = unknown. */
export function commissionFor(
  settings: Settings,
  listing: Pick<Listing, 'nodeId' | 'categoryName'>,
): number | null {
  const fees = settings.fees as Settings['fees'] & { nodeCommission?: Record<string, { pct: number }> };
  const node = listing.nodeId ? fees.nodeCommission?.[listing.nodeId]?.pct : undefined;
  if (typeof node === 'number') return node;
  const cat = fees.categoryCommissionPct[listing.categoryName];
  if (typeof cat === 'number') return cat;
  return fees.defaultCommissionPct ?? null;
}

export const HISTORY_DAYS = 30;

export interface ListingMarket {
  listing: Listing;
  rule: PriceRuleExt | null;
  history: OfferHistory;
  snapshots: CompetitorSnapshot[];
  /** Latest observation time for the node (epoch ms) or null when never observed. */
  observedAt: number | null;
  offers: MarketOffer[];
  own: OwnIdentity;
  /** Seller's current buyer-facing price and where it came from. */
  current: { minor: number; source: 'public_page' | 'pending_change' | 'listing' };
}

export async function loadListingMarket(
  listingId: string,
  now = Date.now(),
  days = HISTORY_DAYS,
): Promise<ListingMarket | null> {
  const db = getDb();
  const listing = await db.listings.get(listingId);
  if (!listing) return null;
  const rule = await getRule(listingId);
  const since = new Date(now - days * 86400_000).toISOString();
  const snapshots = listing.nodeId
    ? await db.competitorSnapshots
        .where('[nodeId+at]')
        .between([listing.nodeId, since], [listing.nodeId, '\uffff'])
        .toArray()
    : [];
  const history = buildHistory(snapshots);
  const observedAt = history.times.at(-1) ?? null;
  const offers = observedAt === null ? [] : stateAt(history, observedAt);
  const session = await readLastSession();
  const allIds = (await db.listings.toCollection().primaryKeys()) as string[];
  const own: OwnIdentity = {
    listingIds: allIds,
    sellerId: session?.userId ?? null,
    sellerName: session?.username ?? null,
  };
  const fromPage = observedAt === null ? null : ownPriceAt(history, listingId, observedAt);
  const pending = await getPendingOwnPrice(listingId);
  let current: ListingMarket['current'] = { minor: listing.price.amountMinor, source: 'listing' };
  if (fromPage && fromPage.currency === listing.price.currency)
    current = { minor: fromPage.amountMinor, source: 'public_page' };
  const pageAt = observedAt ?? 0;
  if (pending && pending.at > pageAt) current = { minor: pending.minor, source: 'pending_change' };
  return { listing, rule, history, snapshots, observedAt, offers, own, current };
}
