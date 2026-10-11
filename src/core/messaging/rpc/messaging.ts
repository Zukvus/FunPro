import { z } from 'zod';

/** FunPay chat ids FunPro accepts (same shape as the transport allow-list: `users-1-2`, …). */
const ChatIdSchema = z.string().regex(/^[\w-]{1,64}$/);

/** RPC methods owned by the messaging area (chat sync, quick replies, CRM). */
export const MESSAGING_RPC = {
  /** Load one chat's history now through an open FunPay tab (dashboard "Load history"). */
  'ui.messaging.fetchHistory': { from: 'extension', params: z.object({ chatId: ChatIdSchema }) },
  /** Run a chat sync now (chat list + queued histories); returns the sync status. */
  'ui.messaging.syncChats': { from: 'extension', params: z.object({}) },
  /**
   * Template variables for quick replies on the FunPay chat page, from local data only
   * (buyer, latest order with that buyer, seller name, chat link).
   */
  'cs.messaging.chatContext': {
    from: 'content',
    params: z.object({ chatId: ChatIdSchema, partnerName: z.string().max(100).optional() }),
  },
} as const;
