import { z } from 'zod';

/** RPC methods owned by the inventory / pricing / workflow area. */
export const OPERATIONS_RPC = {
  'ui.deliverOrder': {
    from: 'extension',
    params: z.object({ orderId: z.string().min(1).max(16), mode: z.enum(['send', 'draft']) }),
  },
  'ui.fetchCompetitors': { from: 'extension', params: z.object({ nodeId: z.string().min(1).max(32) }) },
} as const;
