/**
 * Pricing-area extensions of the shared PriceRule model (stored on the same `priceRules` records)
 * and small kv-backed state. All prices here are BUYER-FACING minor units (what the public
 * category page shows), so they compare like-for-like with competitor snapshots.
 */
import { z } from 'zod';
import { getDb } from '@/core/db/db';
import { PriceRuleSchema } from '@/shared/models';

export const PriceRuleExtSchema = PriceRuleSchema.extend({
  /** Oscillation guard: hold when the reference competitor changed price more than N times… */
  oscillationMaxChanges: z.number().int().min(1).max(50).default(2),
  /** …within this many minutes. */
  oscillationWindowMin: z.number().int().min(5).max(24 * 60).default(60),
  /** Comparable offers: minimum title-token similarity (0 = every offer of the node). */
  minSimilarity: z.number().min(0).max(1).default(0),
  /** Comparable offers: price within ±this % of the seller's current price (outlier guard). */
  priceBandPct: z.number().int().min(5).max(1000).default(50),
});
export type PriceRuleExt = z.infer<typeof PriceRuleExtSchema>;

export function toRule(raw: unknown): PriceRuleExt {
  return PriceRuleExtSchema.parse(raw);
}

export function defaultRule(listingId: string, currentMinor: number): PriceRuleExt {
  const base = Math.max(1, currentMinor);
  return PriceRuleExtSchema.parse({
    listingId,
    enabled: false,
    minMinor: Math.max(1, Math.round(base * 0.8)),
    maxMinor: Math.max(2, Math.round(base * 1.5)),
  });
}

export async function getRule(listingId: string): Promise<PriceRuleExt | null> {
  const raw = await getDb().priceRules.get(listingId);
  return raw ? toRule(raw) : null;
}

export async function saveRule(rule: PriceRuleExt): Promise<PriceRuleExt> {
  const parsed = PriceRuleExtSchema.parse(rule);
  if (parsed.minMinor > parsed.maxMinor) throw new Error('Minimum price must not exceed the maximum price');
  if (parsed.enabled && !(await getSimulation(parsed.listingId))) throw new Error('Run the simulation at least once before enabling automatic repricing');
  await getDb().priceRules.put(parsed);
  return parsed;
}

// ---------------------------------------------------------------------------------------------
// kv state
// ---------------------------------------------------------------------------------------------

export interface SimulationMark {
  at: number;
  days: number;
  changes: number;
}

export async function getSimulation(listingId: string): Promise<SimulationMark | null> {
  const rec = await getDb().kv.get(`pricing:sim:${listingId}`);
  return (rec?.value as SimulationMark | undefined) ?? null;
}

export async function markSimulated(listingId: string, mark: SimulationMark): Promise<void> {
  await getDb().kv.put({ key: `pricing:sim:${listingId}`, value: mark });
}

export interface PriceChangeLog {
  at: number;
  mode: 'auto' | 'manual';
  fromMinor: number;
  toMinor: number;
  /** Values written to / read from the offer form (seller price, excludes commission). */
  formFrom: string;
  formTo: string;
  commissionPct: number;
}

export async function getChangeLog(listingId: string): Promise<PriceChangeLog[]> {
  const rec = await getDb().kv.get(`pricing:log:${listingId}`);
  return Array.isArray(rec?.value) ? (rec.value as PriceChangeLog[]) : [];
}

export async function appendChangeLog(listingId: string, entry: PriceChangeLog): Promise<void> {
  const log = await getChangeLog(listingId);
  await getDb().kv.put({ key: `pricing:log:${listingId}`, value: [entry, ...log].slice(0, 200) });
}

/** Price FunPro just set (until a fresh public snapshot confirms it). */
export interface PendingOwnPrice {
  minor: number;
  at: number;
}

export async function getPendingOwnPrice(listingId: string): Promise<PendingOwnPrice | null> {
  const rec = await getDb().kv.get(`pricing:own:${listingId}`);
  return (rec?.value as PendingOwnPrice | undefined) ?? null;
}

export async function setPendingOwnPrice(listingId: string, value: PendingOwnPrice): Promise<void> {
  await getDb().kv.put({ key: `pricing:own:${listingId}`, value });
}

export interface EvalMark {
  at: number;
  outcome: string;
  detail?: string;
}

export async function getEvalMark(listingId: string): Promise<EvalMark | null> {
  const rec = await getDb().kv.get(`pricing:eval:${listingId}`);
  return (rec?.value as EvalMark | undefined) ?? null;
}

export async function setEvalMark(listingId: string, mark: EvalMark): Promise<void> {
  await getDb().kv.put({ key: `pricing:eval:${listingId}`, value: mark });
}

export interface FetchMark {
  at: number;
  ok: boolean;
  offers: number;
  error?: string;
}

export async function getFetchMark(nodeId: string): Promise<FetchMark | null> {
  const rec = await getDb().kv.get(`pricing:fetch:${nodeId}`);
  return (rec?.value as FetchMark | undefined) ?? null;
}

export async function setFetchMark(nodeId: string, mark: FetchMark): Promise<void> {
  await getDb().kv.put({ key: `pricing:fetch:${nodeId}`, value: mark });
}
