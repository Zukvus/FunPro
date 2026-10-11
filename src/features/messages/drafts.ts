/**
 * Drafts inbox helpers. Chat drafts (auto-reply approvals, AI and workflow suggestions, scheduled
 * messages) are approved and sent by the seller through `ui.sendMessage` with the draft id, so the
 * outbox marks the draft `sent` / `failed`. Review-reply and delivery drafts belong to their own
 * pages (they are not plain chat messages) and are excluded here.
 */
import { getDb, type DraftReply } from '@/core/db/db';
import { isValidChatId } from './context';
import { MAX_MESSAGE_LENGTH } from './outbox';

const FOREIGN_SOURCES: ReadonlySet<DraftReply['source']> = new Set(['review', 'delivery']);

/** Drafts that the Messages page manages. */
export function isChatDraft(d: DraftReply): boolean {
  return !FOREIGN_SOURCES.has(d.source);
}

/** A draft can be sent from FunPro only when its chat is known. */
export function isSendable(d: DraftReply): boolean {
  return isValidChatId(d.chatId) && d.text.trim().length > 0 && d.text.trim().length <= MAX_MESSAGE_LENGTH;
}

export class DraftError extends Error {
  constructor(readonly code: 'not_found' | 'not_editable' | 'invalid_text') {
    super(code);
    this.name = 'DraftError';
  }
}

async function editable(id: string): Promise<DraftReply> {
  const d = await getDb().drafts.get(id);
  if (!d) throw new DraftError('not_found');
  if (d.status !== 'pending' && d.status !== 'failed') throw new DraftError('not_editable');
  return d;
}

export async function updateDraftText(id: string, text: string, now = Date.now()): Promise<void> {
  await editable(id);
  const t = text.trim();
  if (!t || t.length > MAX_MESSAGE_LENGTH) throw new DraftError('invalid_text');
  await getDb().drafts.update(id, { text: t, updatedAt: now });
}

/** Mark a draft approved right before it is handed to `ui.sendMessage`; returns the text to send. */
export async function approveDraft(id: string, text?: string, now = Date.now()): Promise<DraftReply> {
  const d = await editable(id);
  const t = (text ?? d.text).trim();
  if (!t || t.length > MAX_MESSAGE_LENGTH) throw new DraftError('invalid_text');
  const next: DraftReply = { ...d, text: t, status: 'approved', updatedAt: now };
  await getDb().drafts.put(next);
  return next;
}

export async function dismissDraft(id: string, now = Date.now()): Promise<void> {
  const d = await getDb().drafts.get(id);
  if (!d) throw new DraftError('not_found');
  if (d.status === 'sent') throw new DraftError('not_editable');
  await getDb().drafts.update(id, { status: 'dismissed', updatedAt: now });
}

/** Revert an approval that could not be handed to the outbox (e.g. the background was unavailable). */
export async function revertApproval(id: string, now = Date.now()): Promise<void> {
  const d = await getDb().drafts.get(id);
  if (d?.status === 'approved') await getDb().drafts.update(id, { status: 'pending', updatedAt: now });
}

/**
 * Pending automatic drafts in a chat become stale once the seller answers there manually: they are
 * dismissed (with a note) so the seller is not offered an outdated reply.
 */
export async function dismissStaleAutoDrafts(chatId: string, now = Date.now()): Promise<number> {
  const db = getDb();
  const stale = await db.drafts
    .where('chatId')
    .equals(chatId)
    .filter((d) => d.status === 'pending' && d.source === 'auto_reply' && (d.meta?.['kind'] === 'auto_reply' || d.meta?.['kind'] === 'welcome'))
    .toArray();
  for (const d of stale) await db.drafts.update(d.id, { status: 'dismissed', updatedAt: now, meta: { ...(d.meta ?? {}), dismissedReason: 'seller_replied' } });
  return stale.length;
}
