import { z } from 'zod';
import { SalesPanelPeriodSchema } from '@/core/settings/schema';
import { CurrencySchema } from '@/shared/models/money';

/**
 * What the background hands to the statistics panel on FunPay's sales page (`cs.salesPanel.stats`).
 * Aggregates only: counts and per-currency sums, plus the names in the top lists (which FunPay
 * itself shows on the same page). The content script validates the answer with this schema.
 */
const minor = z.number().int();
const count = z.number().int().min(0);

export const PanelMoneySchema = z.object({ currency: CurrencySchema, amountMinor: minor });

export const SalesPanelCurrencySchema = z.object({
  currency: CurrencySchema,
  /** Sum of closed (buyer-confirmed) orders, as FunPay lists them (not necessarily the payout). */
  earned: minor,
  closedOrders: count,
  /** Sum of paid orders still awaiting the buyer's confirmation. */
  pending: minor,
  pendingOrders: count,
  refunded: minor,
  refundedOrders: count,
  /** earned / closedOrders; null without closed orders. */
  average: minor.nullable(),
  /** Largest closed order. */
  biggest: minor.nullable(),
});

export const SalesPanelTopRowSchema = z.object({
  name: z.string().max(300),
  /** Non-refunded orders. */
  orders: count,
  /** Non-refunded order sums, per currency. */
  amounts: z.array(PanelMoneySchema).max(10),
});

export const SalesPanelDataSchema = z.object({
  period: SalesPanelPeriodSchema,
  from: z.number(),
  to: z.number(),
  granularity: z.enum(['day', 'week', 'month']),
  /** Orders created in the period, any status. */
  orders: count,
  closed: count,
  pending: count,
  refunded: count,
  unknownStatus: count,
  uniqueBuyers: count,
  currencies: z.array(SalesPanelCurrencySchema).max(10),
  topBuyers: z.array(SalesPanelTopRowSchema).max(10),
  topProducts: z.array(SalesPanelTopRowSchema).max(10),
  topCategories: z.array(SalesPanelTopRowSchema).max(10),
  /** Orders per day/week/month (currency-neutral), gap-filled. */
  series: z.array(z.object({ key: z.string().max(20), start: z.number(), orders: count })).max(400),
  /** Everything FunPro has stored for sales: count, oldest creation time, orders without a date. */
  coverage: z.object({ stored: count, oldest: z.number().nullable(), undated: count }),
});

export const ImportProgressSchema = z.object({
  state: z.string().max(40),
  pages: count,
  orders: count,
  created: count,
});

export const SalesPanelResponseSchema = z.object({
  prefs: z.object({ enabled: z.boolean(), collapsed: z.boolean(), period: SalesPanelPeriodSchema }),
  data: SalesPanelDataSchema.nullable(),
  /** Latest history import of the sales list, if any. */
  importStatus: ImportProgressSchema.nullable(),
});

export type PanelMoney = z.infer<typeof PanelMoneySchema>;
export type SalesPanelCurrency = z.infer<typeof SalesPanelCurrencySchema>;
export type SalesPanelTopRow = z.infer<typeof SalesPanelTopRowSchema>;
export type SalesPanelData = z.infer<typeof SalesPanelDataSchema>;
export type SalesPanelResponse = z.infer<typeof SalesPanelResponseSchema>;
