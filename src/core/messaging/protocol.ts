import { z } from 'zod';
import { SessionInfoSchema } from '@/shared/session';
import { AutomationStateSchema } from '../settings/schema';
import { ASSISTANT_RPC } from './rpc/assistant';
import { LISTINGS_CONTENT_COMMANDS, LISTINGS_RPC } from './rpc/listings';
import { MESSAGING_RPC } from './rpc/messaging';
import { OPERATIONS_RPC } from './rpc/operations';
import { ORDERS_RPC } from './rpc/orders';
import { SETTINGS_RPC } from './rpc/settings';

/** Bounds of one `appendOfferSecrets` command: characters per goods line, lines per command. */
export const OFFER_GOODS_LINE_MAX = 1000;
export const OFFER_GOODS_MAX_LINES = 2000;

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

export interface RpcDef {
  from: 'extension' | 'content';
  params: z.ZodType;
}

const CORE_RPC = {
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
  'cs.getPageConfig': { from: 'content', params: z.object({}) },
  'cs.listTemplates': { from: 'content', params: z.object({}) },
  'cs.listingCosts': { from: 'content', params: z.object({ ids: z.array(z.string().max(32)).max(2000) }) },
  'cs.recordEmoji': { from: 'content', params: z.object({ emoji: z.string().min(1).max(16) }) },
  // ---- extension pages → background --------------------------------------------------------
  'ui.status': { from: 'extension', params: z.object({}) },
  'ui.setAutomationState': { from: 'extension', params: z.object({ state: AutomationStateSchema }) },
  'ui.emergencyStop': { from: 'extension', params: z.object({}) },
  'ui.syncNow': {
    from: 'extension',
    params: z.object({
      what: z.array(z.enum(['orders', 'chats', 'listings', 'finance', 'reviews'])).optional(),
    }),
  },
  'ui.sendMessage': {
    from: 'extension',
    params: z.object({
      chatId: z.string().min(1).max(64),
      text: z.string().min(1).max(2000),
      draftId: z.string().max(200).optional(),
      /** Required to re-send a draft whose previous attempt has an uncertain outcome. */
      confirmResend: z.boolean().optional(),
    }),
  },
  'ui.processQueueNow': { from: 'extension', params: z.object({}) },
} as const satisfies Record<string, RpcDef>;

/**
 * Feature areas declare their own RPC methods in ./rpc/<area>.ts; they are merged here so every
 * method is validated by the same router.
 */
export const RPC = {
  ...CORE_RPC,
  ...LISTINGS_RPC,
  ...MESSAGING_RPC,
  ...ORDERS_RPC,
  ...ASSISTANT_RPC,
  ...OPERATIONS_RPC,
  ...SETTINGS_RPC,
} as const satisfies Record<string, RpcDef>;

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
  z.object({
    action: z.literal('raise'),
    gameId: z.string().max(32),
    nodeId: z.string().max(32),
    nodeIds: z.array(z.string().max(32)).max(100).optional(),
  }),
  z.object({ action: z.literal('discoverRaise'), nodeId: z.string().max(32) }),
  z.object({
    action: z.literal('sendMessage'),
    chatId: z.string().max(64),
    text: z.string().min(1).max(2000),
  }),
  z.object({
    action: z.literal('fetchPage'),
    /** Path on funpay.com only; validated against an allow-list in the content script. */
    path: z.string().max(512),
    kind: z.enum([
      'orders',
      'purchases',
      'chats',
      'chat',
      'listings_node',
      'profile',
      'finance',
      'reviews',
      'public_node',
      'home',
    ]),
  }),
  z.object({
    action: z.literal('fetchMoreOrders'),
    direction: z.enum(['sale', 'purchase']),
    /** Opaque pagination token from the previous page's hidden `continue` input. */
    continueToken: z.string().min(1).max(512),
  }),
  z.object({ action: z.literal('getOfferForm'), offerId: z.string().max(32) }),
  z.object({
    action: z.literal('appendOfferSecrets'),
    offerId: z.string().regex(/^\d{1,12}$/),
    /** Goods to append to the offer's native auto-delivery list (explicit, confirmed push). */
    lines: z.array(z.string().min(1).max(OFFER_GOODS_LINE_MAX)).min(1).max(OFFER_GOODS_MAX_LINES),
  }),
  z.object({
    action: z.literal('saveOffer'),
    offerId: z.string().max(32),
    /**
     * Field overrides applied to the freshly fetched edit form. The goods list can only grow through
     * `appendOfferSecrets`; it is never overwritten from the background.
     */
    changes: z
      .record(z.string().max(64), z.string().max(20000))
      .refine((c) => !Object.hasOwn(c, 'secrets') && !Object.hasOwn(c, 'csrf_token'), {
        message: 'The goods list and CSRF token cannot be set through saveOffer',
      }),
  }),
  z.object({ action: z.literal('calc'), nodeId: z.string().max(32), price: z.number().positive() }),
  z.object({
    action: z.literal('replyReview'),
    orderId: z.string().max(16),
    text: z.string().min(1).max(1000),
  }),
  // Explicit, user-confirmed offer creation (cloning) and deletion — see rpc/listings.ts.
  ...LISTINGS_CONTENT_COMMANDS,
]);
export type ContentCommand = z.infer<typeof ContentCommandSchema>;

export const CONTENT_COMMAND_TAG = 'funpro:cmd';
