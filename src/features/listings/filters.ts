/**
 * Listing table filtering and sorting. Pure, allocation-light functions designed for 10k+ rows
 * (a single pass per filter, no per-row regex compilation).
 */
import type { Currency, Listing } from '@/shared/models';

export type TriState = 'all' | 'yes' | 'no';

export interface ListingFilter {
  query: string;
  /** Exact category name, or null for every category. */
  category: string | null;
  status: 'all' | 'active' | 'inactive';
  promoted: TriState;
  autoDelivery: TriState;
  /** Inclusive price bounds in minor units (null = unbounded). */
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  currency: Currency | 'all';
}

export const EMPTY_FILTER: ListingFilter = {
  query: '',
  category: null,
  status: 'all',
  promoted: 'all',
  autoDelivery: 'all',
  priceMinMinor: null,
  priceMaxMinor: null,
  currency: 'all',
};

export function isFilterActive(f: ListingFilter): boolean {
  return (
    f.query.trim() !== '' ||
    f.category !== null ||
    f.status !== 'all' ||
    f.promoted !== 'all' ||
    f.autoDelivery !== 'all' ||
    f.priceMinMinor !== null ||
    f.priceMaxMinor !== null ||
    f.currency !== 'all'
  );
}

function tri(want: TriState, value: boolean): boolean {
  return want === 'all' || (want === 'yes') === value;
}

/** Case-insensitive search over id, title (RU and EN draft) and category. Space-separated terms are ANDed. */
export function filterListings(listings: readonly Listing[], f: ListingFilter): Listing[] {
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: Listing[] = [];
  for (const l of listings) {
    if (f.category !== null && l.categoryName !== f.category) continue;
    if (f.status === 'active' && !l.active) continue;
    if (f.status === 'inactive' && l.active) continue;
    if (!tri(f.promoted, l.promoted)) continue;
    if (!tri(f.autoDelivery, l.autoDelivery)) continue;
    if (f.currency !== 'all' && l.price.currency !== f.currency) continue;
    if (f.priceMinMinor !== null && l.price.amountMinor < f.priceMinMinor) continue;
    if (f.priceMaxMinor !== null && l.price.amountMinor > f.priceMaxMinor) continue;
    if (terms.length) {
      const hay = `${l.id} ${l.title} ${l.titleEn ?? ''} ${l.categoryName}`.toLowerCase();
      let ok = true;
      for (const t of terms) {
        if (!hay.includes(t)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    out.push(l);
  }
  return out;
}

export type ListingSortKey = 'order' | 'title' | 'category' | 'price' | 'net' | 'profit' | 'stock' | 'updated';
export type SortDir = 'asc' | 'desc';

/**
 * Stable sort. `metrics` supplies derived numbers (net/profit) without recomputing them per
 * comparison; unknown values always sort last regardless of direction.
 */
export function sortListings(
  listings: readonly Listing[],
  key: ListingSortKey,
  dir: SortDir,
  metrics?: ReadonlyMap<string, { netMinor: number | null; profitMinor: number | null }>,
): Listing[] {
  const sign = dir === 'asc' ? 1 : -1;
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const num = (l: Listing): number | null => {
    switch (key) {
      case 'order':
        return l.sortIndex;
      case 'price':
        return l.price.amountMinor;
      case 'net':
        return metrics?.get(l.id)?.netMinor ?? null;
      case 'profit':
        return metrics?.get(l.id)?.profitMinor ?? null;
      case 'stock':
        return l.amount;
      case 'updated':
        return Date.parse(l.updatedAt) || 0;
      default:
        return null;
    }
  };
  const indexed = listings.map((l, i) => ({ l, i, n: num(l) }));
  const compare = (a: (typeof indexed)[number], b: (typeof indexed)[number]): number => {
    if (key === 'title') return collator.compare(a.l.title, b.l.title) * sign;
    if (key === 'category') return collator.compare(a.l.categoryName, b.l.categoryName) * sign;
    if (a.n === null || b.n === null) return a.n === null ? (b.n === null ? 0 : 1) : -1;
    return (a.n - b.n) * sign;
  };
  indexed.sort((a, b) => compare(a, b) || a.i - b.i);
  return indexed.map((x) => x.l);
}

export interface CategorySummary {
  name: string;
  count: number;
  nodeIds: string[];
}

export function listingCategories(listings: readonly Listing[]): CategorySummary[] {
  const map = new Map<string, CategorySummary>();
  for (const l of listings) {
    const key = l.categoryName || '';
    let c = map.get(key);
    if (!c) map.set(key, (c = { name: key, count: 0, nodeIds: [] }));
    c.count++;
    if (l.nodeId && !c.nodeIds.includes(l.nodeId)) c.nodeIds.push(l.nodeId);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Distinct subcategories (node ids) with the most common category name observed for each. */
export function listingNodes(listings: readonly Listing[]): { nodeId: string; name: string; count: number; gameId: string | null }[] {
  const map = new Map<string, { names: Map<string, number>; count: number; gameId: string | null }>();
  for (const l of listings) {
    if (!l.nodeId) continue;
    let n = map.get(l.nodeId);
    if (!n) map.set(l.nodeId, (n = { names: new Map(), count: 0, gameId: null }));
    n.count++;
    n.gameId ??= l.gameId;
    if (l.categoryName) n.names.set(l.categoryName, (n.names.get(l.categoryName) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([nodeId, n]) => ({
      nodeId,
      name: [...n.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
      count: n.count,
      gameId: n.gameId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.nodeId.localeCompare(b.nodeId));
}

export function listingCurrencies(listings: readonly Listing[]): Currency[] {
  return [...new Set(listings.map((l) => l.price.currency))].sort();
}
