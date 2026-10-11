/**
 * Competitor data collection — ONLY from public category pages (`/lots/{node}/`) of nodes where the
 * seller has own listings: on explicit request, or (opt-in, ≥ 60 min per node) periodically.
 */
import { getDb } from '@/core/db/db';
import type { Settings } from '@/core/settings/schema';
import { ingestCompetitors } from '@/features/sync/ingest';
import { CompetitorOfferSchema, type CompetitorOffer } from '@/shared/models';
import { getFetchMark, setFetchMark } from './model';

/** Repeated manual fetches of the same node are refused within this gap. */
export const MANUAL_FETCH_GAP_MS = 60_000;

export async function ownNodeIds(): Promise<string[]> {
  const listings = await getDb().listings.toArray();
  return Array.from(new Set(listings.map((l) => l.nodeId).filter((n): n is string => !!n && /^\d{1,10}$/.test(n)))).sort();
}

export type FetchPublicNode = (nodeId: string) => Promise<unknown>;

export function validOffers(raw: unknown, nodeId: string): CompetitorOffer[] {
  if (!Array.isArray(raw)) return [];
  const out: CompetitorOffer[] = [];
  for (const item of raw.slice(0, 2000)) {
    const r = CompetitorOfferSchema.safeParse(item);
    if (r.success && r.data.nodeId === nodeId) out.push(r.data);
  }
  return out;
}

export async function fetchCompetitorsForNode(nodeId: string, fetchNode: FetchPublicNode, opts: { manual: boolean; now?: number }): Promise<{ offers: number; changes: number }> {
  const now = opts.now ?? Date.now();
  if (!(await ownNodeIds()).includes(nodeId)) throw new Error('Competitor data is collected only for categories of your own listings');
  const last = await getFetchMark(nodeId);
  if (opts.manual && last && now - last.at < MANUAL_FETCH_GAP_MS) throw new Error('This category was just refreshed — try again in a minute');
  try {
    const offers = validOffers(await fetchNode(nodeId), nodeId);
    const changes = await ingestCompetitors(nodeId, offers, now);
    await setFetchMark(nodeId, { at: now, ok: true, offers: offers.length });
    return { offers: offers.length, changes };
  } catch (e) {
    await setFetchMark(nodeId, { at: now, ok: false, offers: 0, error: (e as Error).message.slice(0, 200) });
    throw e;
  }
}

/** Next node due for the periodic job (one node per call to spread requests), or null. */
export async function nextNodeDue(settings: Settings, now = Date.now()): Promise<string | null> {
  if (!settings.pricing.autoFetch) return null;
  const interval = Math.max(60, settings.pricing.autoFetchIntervalMinutes) * 60_000;
  let best: { nodeId: string; at: number } | null = null;
  for (const nodeId of await ownNodeIds()) {
    const mark = await getFetchMark(nodeId);
    const at = mark?.at ?? 0;
    if (now - at < interval) continue;
    if (!best || at < best.at) best = { nodeId, at };
  }
  return best?.nodeId ?? null;
}
