/**
 * Inbox helpers for the dashboard: ordering, pinning and full-text search over the conversations
 * FunPro stored locally (retention is controlled by Privacy → message retention).
 */
import { getDb } from '@/core/db/db';
import type { ChatMessage, ChatSummary } from '@/shared/models';

const time = (c: ChatSummary) => c.lastMessageAt ?? c.updatedAt;

/** Pinned first, then most recent activity. */
export function sortChats(chats: readonly ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => Number(b.pinned) - Number(a.pinned) || time(b).localeCompare(time(a)));
}

export async function setChatPinned(chatId: string, pinned: boolean): Promise<void> {
  await getDb().chats.update(chatId, { pinned });
}

export type InboxFilter = 'all' | 'unread' | 'pinned';

export function filterChats(chats: readonly ChatSummary[], filter: InboxFilter): ChatSummary[] {
  if (filter === 'unread') return chats.filter((c) => c.unread);
  if (filter === 'pinned') return chats.filter((c) => c.pinned);
  return [...chats];
}

export interface SearchHit {
  chatId: string;
  /** Matching message (null when only the chat name / preview matched). */
  message: ChatMessage | null;
  /** Number of matching stored messages in the chat. */
  count: number;
}

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/**
 * Case-insensitive search over partner names, list previews and stored message bodies.
 * Returns one hit per chat (the most recent matching message), most matches first.
 */
export async function searchConversations(query: string, limit = 100): Promise<SearchHit[]> {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const db = getDb();
  const hits = new Map<string, SearchHit>();
  await db.messages.each((m) => {
    if (!m.text || !fold(m.text).includes(q)) return;
    const hit = hits.get(m.chatId);
    if (!hit) hits.set(m.chatId, { chatId: m.chatId, message: m, count: 1 });
    else {
      hit.count += 1;
      if (!hit.message || Number(m.id) > Number(hit.message.id)) hit.message = m;
    }
  });
  const chats = await db.chats.toArray();
  for (const c of chats) {
    if (hits.has(c.id)) continue;
    if (fold(c.partnerName).includes(q) || fold(c.lastMessageText).includes(q)) hits.set(c.id, { chatId: c.id, message: null, count: 0 });
  }
  return [...hits.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/** A short excerpt around the first match. */
export function snippet(text: string, query: string, radius = 40): string {
  const i = fold(text).indexOf(fold(query.trim()));
  if (i < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + query.trim().length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
