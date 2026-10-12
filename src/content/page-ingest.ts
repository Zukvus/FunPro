import { funpayParser } from '@/adapters/funpay';
import { rpc } from '@/core/messaging/client';
import type { IngestKind } from '@/core/messaging/protocol';

/**
 * Passive ingestion of the page the seller is looking at. This costs FunPay nothing (no extra
 * requests) and keeps FunPro's local data fresh while the seller works normally.
 */
export async function ingestCurrentPage(
  doc: Document,
  loc: Location,
  selfUserId: string | null,
): Promise<void> {
  const path = loc.pathname.replace(/^\/(en|uk)(?=\/)/, '');
  const url = loc.href;
  const send = (
    kind: IngestKind,
    items: unknown[],
    context: Record<string, string | number | boolean | null> = {},
  ) => rpc('cs.ingest', { kind, url, items, context }).catch(() => undefined);

  // A filtered or paged order list (?state=paid, ?id=…) can show old orders FunPro has not seen yet:
  // those are history, not news, so they are stored silently (no events, no automation).
  const filtered = loc.search.length > 1;
  if (path === '/orders/trade') {
    await send('orders', funpayParser.parseOrders(doc, 'sale').orders, {
      direction: 'sale',
      silent: filtered,
    });
  } else if (path === '/orders/') {
    await send('orders', funpayParser.parseOrders(doc, 'purchase').orders, {
      direction: 'purchase',
      silent: filtered,
    });
  } else if (/^\/lots\/\d+\/trade$/.test(path)) {
    const nodeId = path.match(/\/lots\/(\d+)\//)![1]!;
    const { listings, raise } = funpayParser.parseOwnLotsPage(doc, nodeId);
    await send('listings', listings);
    if (raise) await send('bumpTargets', [raise], { categoryName: listings[0]?.categoryName ?? '' });
  } else if (/^\/lots\/\d+\/$/.test(path)) {
    const nodeId = path.match(/\/lots\/(\d+)\//)![1]!;
    await send('competitors', funpayParser.parsePublicOffers(doc, nodeId), { nodeId });
  } else if (selfUserId && path === `/users/${selfUserId}/`) {
    await send('listings', funpayParser.parseProfileOffers(doc));
    await send('reviews', funpayParser.parseReviews(doc));
  } else if (path === '/account/balance') {
    await send('finance', funpayParser.parseFinance(doc));
  } else if (path === '/chat/') {
    await send('chats', funpayParser.parseChatList(doc));
    const chatId = new URLSearchParams(loc.search).get('node');
    if (chatId) await send('messages', funpayParser.parseChatMessages(doc, chatId, selfUserId), { chatId });
  }
}
