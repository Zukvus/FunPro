import type { FunPayActions} from '@/adapters/funpay';
import { FunPayHttpError, funpayParser, type PageSession } from '@/adapters/funpay';
import { ContentCommandSchema, type ContentCommand } from '@/core/messaging/protocol';

/**
 * Executes background commands inside the FunPay page context. The CSRF token is read from the
 * live page each time and never sent to the background.
 */
export function createExecutor(getSession: () => PageSession, actions: FunPayActions) {
  async function run(cmd: ContentCommand): Promise<unknown> {
    switch (cmd.action) {
      case 'ping':
        return { session: stripCsrf(getSession()) };
      case 'raise':
        return actions.raise({ gameId: cmd.gameId, nodeId: cmd.nodeId }, cmd.nodeIds);
      case 'discoverRaise':
        return actions.discoverRaise(cmd.nodeId);
      case 'sendMessage':
        return actions.sendMessage(cmd.chatId, cmd.text);
      case 'fetchMoreOrders':
        return actions.fetchMoreOrders(cmd.direction, cmd.continueToken);
      case 'getOfferForm':
        return actions.getOfferForm(cmd.offerId);
      case 'saveOffer':
        return actions.saveOffer(cmd.offerId, cmd.changes);
      case 'calc':
        return actions.calc(cmd.nodeId, cmd.price);
      case 'replyReview':
        return actions.replyReview(cmd.orderId, cmd.text);
      case 'fetchPage':
        return fetchPage(cmd.kind, cmd.path);
    }
  }

  async function fetchPage(kind: Extract<ContentCommand, { action: 'fetchPage' }>['kind'], path: string): Promise<unknown> {
    const userId = getSession().userId;
    switch (kind) {
      case 'orders':
        return actions.fetchOrders('sale');
      case 'purchases':
        return actions.fetchOrders('purchase');
      case 'chats':
        return actions.fetchChats();
      case 'chat': {
        const chatId = new URLSearchParams(path.split('?')[1] ?? '').get('node');
        if (!chatId) throw new Error('chat id missing');
        return actions.fetchChatHistory(chatId);
      }
      case 'listings_node': {
        const nodeId = path.match(/\/lots\/(\d+)\//)?.[1];
        if (!nodeId) throw new Error('node id missing');
        return actions.discoverRaise(nodeId);
      }
      case 'profile':
      case 'reviews':
        if (!userId) throw new FunPayHttpError('Not logged in', 401, 'logged_out');
        return actions.fetchProfileListings(userId);
      case 'finance':
        return actions.fetchFinance();
      case 'public_node': {
        const nodeId = path.match(/\/lots\/(\d+)\//)?.[1];
        if (!nodeId) throw new Error('node id missing');
        return actions.fetchPublicOffers(nodeId);
      }
      case 'home':
        return { session: stripCsrf(getSession()) };
    }
  }

  return {
    async handle(raw: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string; code?: string }> {
      const parsed = ContentCommandSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: 'Invalid command', code: 'invalid' };
      try {
        return { ok: true, data: (await run(parsed.data)) ?? null };
      } catch (e) {
        if (e instanceof FunPayHttpError) return { ok: false, error: e.message, code: e.code };
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

export function stripCsrf(s: PageSession) {
  const { csrfToken: _csrf, ...rest } = s;
  return rest;
}

export { funpayParser };
