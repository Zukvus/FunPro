/**
 * Deterministic repricing engine (pure). Given the seller's rule, the current price and the market,
 * it proposes a buyer-facing price and says whether an automatic change is allowed right now.
 *
 * Safety rules:
 *  - own offers, ignored sellers, other/unknown currencies and price-band outliers are never
 *    reacted to;
 *  - the result is clamped to [max(min, margin floor), max] and is an integer number of minor units;
 *  - anti price-war: per-listing cooldown, max automatic changes per 24 h, and an oscillation
 *    guard (the reference competitor changed price more than K times within X minutes).
 */
import type { Currency } from '@/shared/models';
import {
  classifyOffers,
  marketStats,
  type Exclusion,
  type MarketOffer,
  type MarketStats,
  type OwnIdentity,
} from './market';
import type { PriceRuleExt } from './model';

export type HoldReason =
  | 'currency_unknown'
  | 'invalid_bounds'
  | 'no_competitors'
  | 'fewer_than_n'
  | 'already_optimal'
  | 'cooldown'
  | 'daily_limit'
  | 'oscillation';

export type EngineNote =
  'clamped_floor' | 'clamped_ceiling' | 'margin_floor' | 'commission_unknown' | 'raise';

export interface RepriceInput {
  rule: PriceRuleExt;
  listing: { id: string; title: string };
  /** Seller's current buyer-facing price. */
  currentPriceMinor: number;
  currency: Currency;
  costMinor: number | null;
  /** FunPay commission % for this category (buyer pays price × (1 + pct)); null = unknown. */
  commissionPct: number | null;
  /** Market state (latest snapshot per offer), unfiltered. */
  offers: readonly MarketOffer[];
  own: OwnIdentity;
  /** Epoch ms of previous AUTOMATIC changes of this listing. */
  appliedAt: readonly number[];
  now: number;
}

export interface Recommendation {
  action: 'change' | 'hold';
  hold: HoldReason | null;
  currentMinor: number;
  /** Strategy target before clamping (null when not computable). */
  idealMinor: number | null;
  /** Proposed price after clamping (null when not computable). */
  targetMinor: number | null;
  floorMinor: number;
  ceilingMinor: number;
  marginFloorMinor: number | null;
  notes: EngineNote[];
  stats: MarketStats;
  excluded: Record<Exclusion, number>;
  referenceOfferId: string | null;
}

const DAY_MS = 24 * 3600_000;

/** Lowest buyer price that keeps `minMarginPct` over cost after FunPay's commission. */
export function marginFloor(
  costMinor: number | null,
  minMarginPct: number,
  commissionPct: number | null,
): number | null {
  if (costMinor === null || costMinor <= 0) return null;
  return Math.ceil(costMinor * (1 + minMarginPct / 100) * (1 + (commissionPct ?? 0) / 100) - 1e-9);
}

export function recommendPrice(input: RepriceInput): Recommendation {
  const { rule, now } = input;
  const notes: EngineNote[] = [];
  const classified = classifyOffers(input.offers, {
    title: input.listing.title,
    currency: input.currency,
    currentPriceMinor: input.currentPriceMinor,
    own: input.own,
    ignoreSellers: rule.ignoreSellers,
    minSimilarity: rule.minSimilarity,
    priceBandPct: rule.priceBandPct,
  });
  const excluded: Record<Exclusion, number> = { own: 0, ignored: 0, currency: 0, band: 0, similarity: 0 };
  for (const c of classified) if (c.excluded) excluded[c.excluded]++;
  const comparable = classified
    .filter((c) => c.excluded === null)
    .map((c) => c.offer)
    .sort((a, b) => a.price.amountMinor - b.price.amountMinor || a.offerId.localeCompare(b.offerId));
  const stats = marketStats(
    comparable.map((o) => o.price.amountMinor),
    input.currentPriceMinor,
  );

  const mFloor = marginFloor(input.costMinor, rule.minMarginPct, input.commissionPct);
  if (mFloor !== null && input.commissionPct === null) notes.push('commission_unknown');
  const floorMinor = Math.max(rule.minMinor, mFloor ?? 0);
  const ceilingMinor = rule.maxMinor;
  const base = {
    currentMinor: input.currentPriceMinor,
    floorMinor,
    ceilingMinor,
    marginFloorMinor: mFloor,
    notes,
    stats,
    excluded,
  };
  const hold = (reason: HoldReason, extra: Partial<Recommendation> = {}): Recommendation => ({
    action: 'hold',
    hold: reason,
    idealMinor: null,
    targetMinor: null,
    referenceOfferId: null,
    ...base,
    ...extra,
  });

  if (input.currency === 'UNKNOWN') return hold('currency_unknown');
  if (floorMinor > ceilingMinor) return hold('invalid_bounds');
  if (comparable.length === 0) return hold('no_competitors');

  let reference: MarketOffer;
  let ideal: number;
  switch (rule.strategy) {
    case 'match_lowest':
      reference = comparable[0]!;
      ideal = reference.price.amountMinor;
      break;
    case 'undercut_lowest':
      reference = comparable[0]!;
      ideal = reference.price.amountMinor - rule.stepMinor;
      break;
    case 'stay_in_top_n': {
      if (comparable.length < rule.topN) return hold('fewer_than_n');
      reference = comparable[rule.topN - 1]!;
      ideal = reference.price.amountMinor - rule.stepMinor;
      break;
    }
  }
  ideal = Math.round(ideal);
  let target = ideal;
  if (target < floorMinor) {
    target = floorMinor;
    notes.push(mFloor !== null && mFloor >= rule.minMinor ? 'margin_floor' : 'clamped_floor');
  }
  if (target > ceilingMinor) {
    target = ceilingMinor;
    notes.push('clamped_ceiling');
  }
  if (target > input.currentPriceMinor) notes.push('raise');
  const computed = { idealMinor: ideal, targetMinor: target, referenceOfferId: reference.offerId };
  if (target === input.currentPriceMinor) return hold('already_optimal', computed);

  // Anti price-war gates (affect only whether an automatic change may happen now).
  const lastApplied = input.appliedAt.length ? Math.max(...input.appliedAt) : null;
  if (lastApplied !== null && now - lastApplied < rule.cooldownMinutes * 60_000)
    return hold('cooldown', computed);
  if (input.appliedAt.filter((t) => now - t < DAY_MS).length >= rule.maxChangesPerDay)
    return hold('daily_limit', computed);
  const windowStart = now - rule.oscillationWindowMin * 60_000;
  const recentChanges = reference.changeTimes.filter((t) => t >= windowStart && t <= now).length;
  if (recentChanges > rule.oscillationMaxChanges) return hold('oscillation', computed);

  return { action: 'change', hold: null, ...base, ...computed };
}
