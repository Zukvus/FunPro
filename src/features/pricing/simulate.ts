/**
 * "What would have happened": replays the engine over historical competitor snapshots, applying
 * its own recommendations to a simulated price (including cooldowns and daily limits).
 * Competitors' reactions to the simulated price are NOT modelled — the market is replayed as it
 * was observed. Pure and deterministic.
 */
import type { CompetitorSnapshot, Currency } from '@/shared/models';
import { recommendPrice, type HoldReason } from './engine';
import { buildHistory, ownPriceAt, stateAt, STALE_MS, type OwnIdentity } from './market';
import type { PriceRuleExt } from './model';

export interface SimulationInput {
  rule: PriceRuleExt;
  listing: { id: string; title: string; priceMinor: number; currency: Currency; costMinor: number | null };
  snapshots: readonly CompetitorSnapshot[];
  own: OwnIdentity;
  commissionPct: number | null;
  from: number;
  to: number;
}

export interface SimulationPoint {
  at: number;
  simulatedMinor: number;
  lowestMinor: number | null;
  actualMinor: number | null;
}

export interface SimulatedChange {
  at: number;
  fromMinor: number;
  toMinor: number;
  referenceOfferId: string | null;
}

export interface SimulationResult {
  evaluations: number;
  points: SimulationPoint[];
  changes: SimulatedChange[];
  holds: Partial<Record<HoldReason, number>>;
  startMinor: number;
  endMinor: number;
  minMinor: number;
  maxMinor: number;
}

export function simulateRepricing(input: SimulationInput): SimulationResult {
  const history = buildHistory(input.snapshots);
  const times = history.times.filter((t) => t >= input.from && t <= input.to);
  const startOwn = ownPriceAt(history, input.listing.id, input.from);
  let price = startOwn && startOwn.currency === input.listing.currency ? startOwn.amountMinor : input.listing.priceMinor;
  const startMinor = price;
  const applied: number[] = [];
  const points: SimulationPoint[] = [];
  const changes: SimulatedChange[] = [];
  const holds: Partial<Record<HoldReason, number>> = {};
  let minMinor = price;
  let maxMinor = price;
  for (const t of times) {
    const rec = recommendPrice({
      rule: input.rule,
      listing: { id: input.listing.id, title: input.listing.title },
      currentPriceMinor: price,
      currency: input.listing.currency,
      costMinor: input.listing.costMinor,
      commissionPct: input.commissionPct,
      offers: stateAt(history, t, STALE_MS),
      own: input.own,
      appliedAt: applied,
      now: t,
    });
    if (rec.action === 'change' && rec.targetMinor !== null) {
      changes.push({ at: t, fromMinor: price, toMinor: rec.targetMinor, referenceOfferId: rec.referenceOfferId });
      price = rec.targetMinor;
      applied.push(t);
      minMinor = Math.min(minMinor, price);
      maxMinor = Math.max(maxMinor, price);
    } else if (rec.hold) {
      holds[rec.hold] = (holds[rec.hold] ?? 0) + 1;
    }
    const own = ownPriceAt(history, input.listing.id, t);
    points.push({ at: t, simulatedMinor: price, lowestMinor: rec.stats.lowestMinor, actualMinor: own && own.currency === input.listing.currency ? own.amountMinor : null });
  }
  return { evaluations: times.length, points, changes, holds, startMinor, endMinor: price, minMinor, maxMinor };
}
