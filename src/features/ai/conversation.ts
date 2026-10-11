/**
 * Conversation model used by the copilot, built from stored chat messages (db.messages/db.chats)
 * or from pasted text, plus the redacted transcript that is sent to an AI provider.
 */
import { redactForAi, type NamePlaceholder } from '@/adapters/ai';
import { getDb } from '@/core/db/db';
import type { ChatMessage } from '@/shared/models';

export interface ConversationMessage {
  author: 'customer' | 'self' | 'system';
  text: string;
  at: string | null;
  /** FunPay message id when the message came from the database. */
  id?: string;
}

export interface Conversation {
  chatId: string | null;
  buyerName: string | null;
  sellerName: string | null;
  messages: ConversationMessage[];
}

function compareMessageIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export async function loadConversation(chatId: string, limit = 40): Promise<Conversation> {
  const db = getDb();
  const [chat, rows] = await Promise.all([
    db.chats.get(chatId),
    db.messages.where('chatId').equals(chatId).toArray(),
  ]);
  rows.sort((a: ChatMessage, b: ChatMessage) => compareMessageIds(a.id, b.id));
  const recent = rows.slice(-limit);
  const buyer = chat?.partnerName || recent.find((m) => m.kind === 'customer')?.authorName || null;
  const seller = recent.find((m) => m.kind === 'self')?.authorName || null;
  return {
    chatId,
    buyerName: buyer,
    sellerName: seller,
    messages: recent
      .filter((m) => m.text.trim())
      .map((m) => ({ author: m.kind, text: m.text, at: m.at, id: m.id })),
  };
}

/** Pasted text is treated as the buyer's latest message(s). */
export function conversationFromText(text: string, buyerName: string | null = null): Conversation {
  const trimmed = text.trim();
  return {
    chatId: null,
    buyerName,
    sellerName: null,
    messages: trimmed ? [{ author: 'customer', text: trimmed, at: null }] : [],
  };
}

export function customerTexts(conv: Conversation): string[] {
  return conv.messages.filter((m) => m.author === 'customer').map((m) => m.text);
}

export function lastCustomerMessage(conv: Conversation): ConversationMessage | null {
  for (let i = conv.messages.length - 1; i >= 0; i--)
    if (conv.messages[i]!.author === 'customer') return conv.messages[i]!;
  return null;
}

export function namePlaceholders(conv: Conversation, redactNames: boolean): NamePlaceholder[] {
  if (!redactNames) return [];
  const out: NamePlaceholder[] = [];
  if (conv.buyerName) out.push({ name: conv.buyerName, placeholder: '[buyer]' });
  if (conv.sellerName) out.push({ name: conv.sellerName, placeholder: '[seller]' });
  return out;
}

const MAX_MESSAGE_CHARS = 600;
const MAX_TRANSCRIPT_CHARS = 6000;

/**
 * Redacted, size-bounded transcript (newest messages are kept when trimming). Each line is labelled
 * Buyer / Seller / FunPay so the model can tell who wrote what.
 */
export function transcriptForAi(conv: Conversation, redactNames: boolean): string {
  const names = namePlaceholders(conv, redactNames);
  const lines: string[] = [];
  let total = 0;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]!;
    const label = m.author === 'customer' ? 'Buyer' : m.author === 'self' ? 'Seller' : 'FunPay';
    let text = m.text.replace(/\s+/g, ' ').trim();
    if (text.length > MAX_MESSAGE_CHARS) text = `${text.slice(0, MAX_MESSAGE_CHARS)}…`;
    const line = `${label}: ${redactForAi(text, { names })}`;
    if (total + line.length > MAX_TRANSCRIPT_CHARS && lines.length > 0) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.reverse().join('\n');
}
