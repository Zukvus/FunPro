/**
 * Service metrics computed ONLY from chat history stored locally by FunPro (so they cover the
 * retention window and the chats FunPro has synced, not the seller's whole FunPay history).
 *
 * Definitions (FunPay system messages are ignored everywhere):
 *  - customer turn: one or more consecutive customer messages;
 *  - a turn is answered by the next seller message; first-response time = time of that seller
 *    message − time of the turn's first customer message (only when both timestamps are known);
 *  - reply rate = answered turns / turns, where an unanswered turn younger than `openGraceMs`
 *    is still "open" and not counted against the seller;
 *  - unanswered chat: the latest non-system message of the chat is from the customer.
 */
import type { ChatMessage } from '@/shared/models';
import { compareIds } from '@/features/sync/ingest';

export interface ServiceMetrics {
  chatsAnalyzed: number;
  messagesAnalyzed: number;
  customerTurns: number;
  answeredTurns: number;
  openTurns: number;
  /** 0..1, null when there is nothing to measure. */
  replyRate: number | null;
  responseSamples: number;
  medianFirstResponseMs: number | null;
  unansweredChats: number;
  unansweredChatIds: string[];
}

export const DEFAULT_OPEN_GRACE_MS = 3600_000;

function timeOf(m: ChatMessage): number | null {
  if (!m.at) return null;
  const t = Date.parse(m.at);
  return Number.isFinite(t) ? t : null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function computeServiceMetrics(messages: Iterable<ChatMessage>, now: number, opts: { openGraceMs?: number } = {}): ServiceMetrics {
  const grace = opts.openGraceMs ?? DEFAULT_OPEN_GRACE_MS;
  const byChat = new Map<string, ChatMessage[]>();
  let total = 0;
  for (const m of messages) {
    total++;
    const list = byChat.get(m.chatId);
    if (list) list.push(m);
    else byChat.set(m.chatId, [m]);
  }
  const samples: number[] = [];
  const unanswered: string[] = [];
  let turns = 0;
  let answered = 0;
  let open = 0;
  for (const [chatId, list] of byChat) {
    list.sort((a, b) => compareIds(a.id, b.id));
    let turnStart: ChatMessage | null = null;
    for (const m of list) {
      if (m.kind === 'system') continue;
      if (m.kind === 'customer') {
        turnStart ??= m;
        continue;
      }
      if (turnStart) {
        turns++;
        answered++;
        const t0 = timeOf(turnStart);
        const t1 = timeOf(m);
        if (t0 !== null && t1 !== null && t1 >= t0) samples.push(t1 - t0);
        turnStart = null;
      }
    }
    if (turnStart) {
      unanswered.push(chatId);
      const t0 = timeOf(turnStart);
      if (t0 !== null && now - t0 < grace) open++;
      else turns++;
    }
  }
  return {
    chatsAnalyzed: byChat.size,
    messagesAnalyzed: total,
    customerTurns: turns,
    answeredTurns: answered,
    openTurns: open,
    replyRate: turns > 0 ? answered / turns : null,
    responseSamples: samples.length,
    medianFirstResponseMs: median(samples),
    unansweredChats: unanswered.length,
    unansweredChatIds: unanswered,
  };
}

/** "45 s", "12 min", "3 h 20 min", "2 d 4 h" — compact and language-neutral units are added by the UI. */
export function splitDuration(ms: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.round(ms / 1000));
  return { d: Math.floor(total / 86400), h: Math.floor((total % 86400) / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}
