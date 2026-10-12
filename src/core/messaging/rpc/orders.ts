import { z } from 'zod';
import { SalesPanelPeriodSchema } from '../../settings/schema';

const Direction = z.enum(['sale', 'purchase']);

/** RPC methods owned by the orders area. */
export const ORDERS_RPC = {
  /**
   * Start a deep history import (FunPay `continue`-token paging). Returns immediately; progress is
   * written to Dexie `kv` (`orders:import:<direction>`). `missing` stops after two pages with
   * nothing new; `full` walks to the end (bounded by `maxPages`).
   */
  'ui.orders.importHistory': {
    from: 'extension',
    params: z.object({
      direction: Direction,
      mode: z.enum(['full', 'missing']).default('full'),
      maxPages: z.number().int().min(1).max(2000).default(500),
    }),
  },
  'ui.orders.cancelImport': { from: 'extension', params: z.object({ direction: Direction }) },
  // ---- content script: statistics panel on FunPay's sales page ---------------------------------
  /**
   * Aggregated statistics of the stored sales for a period (the saved period when omitted), the
   * panel preferences and the sales history import progress. Read-only; no FunPay request.
   */
  'cs.salesPanel.stats': {
    from: 'content',
    params: z.object({ period: SalesPanelPeriodSchema.optional() }),
  },
  /** Remember the panel's period / collapsed state, or hide the panel (`enabled: false`). */
  'cs.salesPanel.setPrefs': {
    from: 'content',
    params: z.object({
      period: SalesPanelPeriodSchema.optional(),
      collapsed: z.boolean().optional(),
      enabled: z.literal(false).optional(),
    }),
  },
  /** Start loading the sales history (same job as the dashboard's import). Seller-initiated. */
  'cs.salesPanel.importHistory': { from: 'content', params: z.object({}) },
  /** Open a FunPro dashboard page in a new tab (content scripts cannot open extension pages). */
  'cs.openDashboard': {
    from: 'content',
    params: z.object({ page: z.enum(['orders', 'analytics']) }),
  },
} as const;
