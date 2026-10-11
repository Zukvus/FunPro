/**
 * Copilot output becomes an editable, pending draft — it is never sent by the assistant itself.
 * Sending happens only when the seller approves the draft (messages UI → ui.sendMessage).
 */
import type { DraftReply } from '@/core/db/db';
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import { draftWarnings } from './postprocess';
import { CHAT_MESSAGE_MAX } from './copilot';

export interface SaveAiDraftInput {
  chatId: string;
  text: string;
  triggerMessageId?: string | null;
  meta?: Record<string, unknown>;
}

export async function saveAiDraft(input: SaveAiDraftInput, now = Date.now()): Promise<DraftReply> {
  const chatId = input.chatId.trim();
  if (!chatId) throw new Error('Pick a chat to save the draft to');
  const text = input.text.trim();
  if (!text) throw new Error('The draft is empty');
  if (text.length > CHAT_MESSAGE_MAX) throw new Error(`The draft exceeds ${CHAT_MESSAGE_MAX} characters`);
  const draft: DraftReply = {
    id: newId('draft'),
    chatId,
    triggerMessageId: input.triggerMessageId ?? null,
    source: 'ai',
    text,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    sendAt: null,
    meta: { ...input.meta, warnings: draftWarnings(text) },
  };
  await getDb().drafts.add(draft);
  return draft;
}
