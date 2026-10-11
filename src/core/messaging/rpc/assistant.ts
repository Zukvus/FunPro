import { z } from 'zod';

const NotificationKindSchema = z.enum([
  'order',
  'message',
  'review',
  'bump',
  'inventory',
  'price',
  'failure',
  'system',
]);

/** RPC methods owned by the reviews / AI / Telegram / notifications area. */
export const ASSISTANT_RPC = {
  /** Post a reply to a review through an open FunPay tab (user-confirmed in the dashboard). */
  'ui.replyReview': {
    from: 'extension',
    params: z.object({
      orderId: z.string().regex(/^[A-Za-z0-9]{1,16}$/),
      text: z.string().min(1).max(1000),
      /** Approval draft this reply came from (marked sent on success). */
      draftId: z.string().max(80).optional(),
    }),
  },
  /** Fire a test notification of the given kind through the desktop + sound sinks. */
  'ui.testNotification': { from: 'extension', params: z.object({ kind: NotificationKindSchema }) },
  /** Send a test message to the authorised Telegram chat. */
  'ui.telegramTest': { from: 'extension', params: z.object({}) },
  /** Send today's summary to Telegram now (ignores the schedule, respects all other gates). */
  'ui.telegramSummaryNow': { from: 'extension', params: z.object({}) },
  /** Content script asks the background to play the configured sound for a kind. */
  'cs.playSound': { from: 'content', params: z.object({ kind: z.enum(['message', 'order', 'review']) }) },
} as const;
