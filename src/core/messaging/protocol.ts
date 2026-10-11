import { z } from 'zod';
import { SessionInfoSchema } from '@/shared/session';
import { AutomationStateSchema } from '../settings/schema';

/**
 * Every runtime message is validated against these schemas before it is acted upon.
 * `from` restricts who may call a method:
 *  - 'extension': only extension pages (popup, dashboard) — never content scripts or web pages;
 *  - 'content':   only FunPro's own content script running in a https://funpay.com tab.
 */
export const IngestKindSchema = z.enum([
  'listings',
  'orders',
  'chats',
  'messages',
  'reviews',
  'finance',
  'balance',
  'competitors',
  'bumpTargets',
]);
export type IngestKind = z.infer<typeof IngestKindSchema>;

export const RPC = {
  // ---- content script → background --------------------------------------------------------
  'cs.hello': {
    from: 'content',
    params: z.object({ url: z.string().max(2048), session: SessionInfoSchema }),
  },
  'cs.ingest': {
    from: 'content',
    params: z.object({
      kind: IngestKindSchema,
      /** Page the data came from (for context such as node id / direction). */
      url: z.string().max(2048),
      /** Validated again per-kind by the ingest handler. */
      items: z.array(z.unknown()).max(5000),
      context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
    }),
  },
  'cs.getPageConfig': {
    from: 'content',
    params: z.object({}),
  },
  'cs.listTemplates': {
    from: 'content',
    params: z.object({}),
  },
  'cs.listingCosts': {
    from: 'content',
    params: z.object({ ids: z.array(z.string().max(32)).max(2000) }),
  },
  'cs.recordEmoji': {
    from: 'content',
    params: z.object({ emoji: z.string().min(1).max(16) }),
  },
  'cs.playSound': {
    from: 'content',
    params: z.object({ kind: z.enum(['message', 'order']) }),
  },
  // ---- extension pages → background --------------------------------------------------------
  'ui.status': { from: 'extension', params: z.object({}) },
  'ui.setAutomationState': { from: 'extension', params: z.object({ state: AutomationStateSchema }) },
  'ui.emergencyStop': { from: 'extension', params: z.object({}) },
  'ui.syncNow': {
    from: 'extension',
    params: z.object({ what: z.array(z.enum(['orders', 'chats', 'listings', 'finance', 'reviews'])).optional() }),
  },
  'ui.bumpNow': { from: 'extension', params: z.object({ gameId: z.string().max(32).optional() }) },
  'ui.discoverBumpTargets': { from: 'extension', params: z.object({}) },
  'ui.sendMessage': {
    from: 'extension',
    params: z.object({ chatId: z.string().min(1).max(64), text: z.string().min(1).max(2000), draftId: z.string().optional() }),
  },
  'ui.bulkEdit.execute': { from: 'extension', params: z.object({ planId: z.string().min(1) }) },
  'ui.bulkEdit.cancel': { from: 'extension', params: z.object({ planId: z.string().min(1) }) },
  'ui.fetchOfferForm': { from: 'extension', params: z.object({ offerId: z.string().min(1).max(32) }) },
  'ui.calcCommission': {
    from: 'extension',
    params: z.object({ nodeId: z.string().min(1).max(32), priceMinor: z.number().int().positive() }),
  },
  'ui.replyReview': {
    from: 'extension',
    params: z.object({ orderId: z.string().min(1).max(16), text: z.string().min(1).max(1000) }),
  },
  'ui.fetchCompetitors': { from: 'extension', params: z.object({ nodeId: z.string().min(1).max(32) }) },
  'ui.testNotification': { from: 'extension', params: z.object({ kind: z.enum(['message', 'order']) }) },
  'ui.telegramTest': { from: 'extension', params: z.object({}) },
  'ui.deliverOrder': {
    from: 'extension',
    params: z.object({ orderId: z.string().min(1).max(16), mode: z.enum(['send', 'draft']) }),
  },
  'ui.processQueueNow': { from: 'extension', params: z.object({}) },
} as const;

export type RpcMethod = keyof typeof RPC;
export type RpcParams<M extends RpcMethod> = z.input<(typeof RPC)[M]['params']>;

export const RpcEnvelopeSchema = z.object({
  __funpro: z.literal(1),
  method: z.string().max(64),
  params: z.unknown(),
});

export type RpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Messages from background to a content script. */
export const ContentCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ping') }),
  z.object({ action: z.literal('raise'), gameId: z.string().max(32), nodeId: z.string().max(32), nodeIds: z.array(z.string().max(32)).max(100).optional() }),
  z.object({ action: z.literal('discoverRaise'), nodeId: z.string().max(32) }),
  z.object({ action: z.literal('sendMessage'), chatId: z.string().max(64), text: z.string().min(1).max(2000) }),
  z.object({
    action: z.literal('fetchPage'),
    /** Path on funpay.com only; validated against an allow-list in the content script. */
    path: z.string().max(512),
    kind: z.enum(['orders', 'purchases', 'chats', 'chat', 'listings_node', 'profile', 'finance', 'reviews', 'public_node', 'home']),
  }),
  z.object({ action: z.literal('getOfferForm'), offerId: z.string().max(32) }),
  z.object({
    action: z.literal('saveOffer'),
    offerId: z.string().max(32),
    /** Field overrides applied to the freshly fetched edit form. */
    changes: z.record(z.string().max(64), z.string().max(20000)),
  }),
  z.object({ action: z.literal('calc'), nodeId: z.string().max(32), price: z.number().positive() }),
  z.object({ action: z.literal('replyReview'), orderId: z.string().max(16), text: z.string().min(1).max(1000) }),
]);
export type ContentCommand = z.infer<typeof ContentCommandSchema>;

export const CONTENT_COMMAND_TAG = 'funpro:cmd';
