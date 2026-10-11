import { z } from 'zod';

/** RPC methods owned by the listings & bump area. */
export const LISTINGS_RPC = {
  'ui.bumpNow': { from: 'extension', params: z.object({ gameId: z.string().max(32).optional() }) },
  'ui.discoverBumpTargets': { from: 'extension', params: z.object({}) },
  'ui.bulkEdit.execute': { from: 'extension', params: z.object({ planId: z.string().min(1) }) },
  'ui.bulkEdit.cancel': { from: 'extension', params: z.object({ planId: z.string().min(1) }) },
  'ui.fetchOfferForm': { from: 'extension', params: z.object({ offerId: z.string().min(1).max(32) }) },
  'ui.calcCommission': {
    from: 'extension',
    params: z.object({ nodeId: z.string().min(1).max(32), priceMinor: z.number().int().positive() }),
  },
} as const;
