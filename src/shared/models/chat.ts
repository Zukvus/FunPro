import { z } from 'zod';

export const ChatSummarySchema = z.object({
  id: z.string().min(1),
  partnerName: z.string(),
  partnerId: z.string().nullable().default(null),
  lastMessageText: z.string().default(''),
  lastMessageAt: z.string().nullable().default(null),
  unread: z.boolean().default(false),
  pinned: z.boolean().default(false),
  updatedAt: z.string(),
});
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

/**
 * Who authored a message. Distinguishing these is critical for loop prevention:
 * auto-replies must only ever react to `customer` messages.
 */
export const MessageAuthorKindSchema = z.enum(['customer', 'self', 'system']);
export type MessageAuthorKind = z.infer<typeof MessageAuthorKindSchema>;

export const ChatMessageSchema = z.object({
  /** FunPay message id (unique per chat). */
  id: z.string().min(1),
  chatId: z.string().min(1),
  authorId: z.string().nullable(),
  authorName: z.string(),
  kind: MessageAuthorKindSchema,
  text: z.string(),
  at: z.string().nullable(),
  /** Message produced by FunPro itself (used to break reply loops). */
  sentByExtension: z.boolean().default(false),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
