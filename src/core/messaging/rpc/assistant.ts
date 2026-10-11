import { z } from 'zod';

/** RPC methods owned by the reviews / AI / Telegram / notifications area. */
export const ASSISTANT_RPC = {
  'ui.replyReview': {
    from: 'extension',
    params: z.object({ orderId: z.string().min(1).max(16), text: z.string().min(1).max(1000) }),
  },
  'ui.testNotification': { from: 'extension', params: z.object({ kind: z.enum(['message', 'order']) }) },
  'ui.telegramTest': { from: 'extension', params: z.object({}) },
  'cs.playSound': { from: 'content', params: z.object({ kind: z.enum(['message', 'order']) }) },
} as const;
