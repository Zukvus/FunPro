import { z } from 'zod';
import { MoneySchema } from './money';

/** A public offer observed on a FunPay category page (collected only from pages the user opens). */
export const CompetitorOfferSchema = z.object({
  offerId: z.string(),
  nodeId: z.string(),
  sellerName: z.string(),
  sellerId: z.string().nullable().default(null),
  title: z.string(),
  price: MoneySchema,
  amount: z.number().int().nullable().default(null),
  online: z.boolean().nullable().default(null),
  promoted: z.boolean().default(false),
  rating: z.number().nullable().default(null),
  reviewCount: z.number().int().nullable().default(null),
});
export type CompetitorOffer = z.infer<typeof CompetitorOfferSchema>;

export const CompetitorSnapshotSchema = CompetitorOfferSchema.extend({
  /** `${nodeId}:${offerId}:${at}` */
  id: z.string(),
  at: z.string(),
});
export type CompetitorSnapshot = z.infer<typeof CompetitorSnapshotSchema>;

export const PriceRuleSchema = z.object({
  listingId: z.string(),
  enabled: z.boolean().default(false),
  minMinor: z.number().int().positive(),
  maxMinor: z.number().int().positive(),
  /** Minimum margin over cost in percent (requires listing cost). */
  minMarginPct: z.number().min(0).max(1000).default(0),
  /** Undercut step in minor units. */
  stepMinor: z.number().int().positive().default(1),
  strategy: z.enum(['match_lowest', 'undercut_lowest', 'stay_in_top_n']).default('undercut_lowest'),
  topN: z.number().int().positive().default(3),
  /** Minimum time between automatic changes for this listing (anti price-war). */
  cooldownMinutes: z.number().int().min(30).default(120),
  /** Maximum number of automatic changes per 24h. */
  maxChangesPerDay: z.number().int().min(1).max(24).default(4),
  ignoreSellers: z.array(z.string()).default([]),
  lastAppliedAt: z.string().nullable().default(null),
});
export type PriceRule = z.infer<typeof PriceRuleSchema>;

export const PriceHistoryPointSchema = z.object({ at: z.string(), price: MoneySchema });
