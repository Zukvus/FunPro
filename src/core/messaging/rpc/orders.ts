import { z } from 'zod';

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
} as const;
