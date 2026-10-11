/**
 * Welcome message: sent once to a chat that FunPro first saw AFTER its chat baseline, when the
 * buyer wrote first and the seller has not written in that chat yet.
 *
 * Idempotency: queue key `welcome:<chatId>` (plus a deterministic draft id). The chat-list
 * baseline guarantees that installing FunPro never greets existing conversations. A chat that a
 * keyword auto-reply already answered is not greeted as well (one bot message is enough).
 */
import { evaluateFeature } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import {
  automationDraftId,
  createAutomationDraft,
  hasQueuedMessage,
  logSkip,
  quietHoursState,
  skipped,
  type AutomationOutcome,
  type DraftReason,
  type MessagingDeps,
} from './automation';
import { chatMessages, chatVariables } from './context';
import { hasBlockingIssue, lintText } from './lint';
import { queueMessage } from './outbox';
import { getFireLog } from './state';
import { renderTemplate } from './templates';

/** The buyer's first message must be at most this old for a greeting to make sense. */
export const WELCOME_MAX_AGE_MS = 24 * 3600_000;

export function welcomeKey(chatId: string): string {
  return `welcome:${chatId}`;
}

export async function maybeSendWelcome(chatId: string, deps: MessagingDeps): Promise<AutomationOutcome> {
  const out = await decideWelcome(chatId, deps);
  await logSkip('welcome', out, { chat: chatId });
  return out;
}

async function decideWelcome(chatId: string, deps: MessagingDeps): Promise<AutomationOutcome> {
  const { settings, now } = deps;
  const status = evaluateFeature(settings, 'welcomeMessage', deps.ctx);
  if (status.status !== 'running') return skipped('not_running', status.reason);
  const body = settings.messages.welcomeText.trim();
  if (!body) return skipped('no_text');

  const key = welcomeKey(chatId);
  const draftId = automationDraftId('welcome', chatId);
  if ((await hasQueuedMessage(key)) || (await getDb().drafts.get(draftId))) return skipped('duplicate');

  const history = await chatMessages(chatId);
  const firstCustomer = history.find((m) => m.kind === 'customer');
  if (!firstCustomer) return skipped('no_customer_message');
  if (history.some((m) => m.kind === 'self')) return skipped('seller_replied');
  // A keyword auto-reply already answered (or drafted an answer to) this chat: no second bot message.
  if ((await getFireLog(chatId)).length > 0) return skipped('auto_replied');
  const firstAt = firstCustomer.at ? Date.parse(firstCustomer.at) : NaN;
  if (Number.isFinite(firstAt) && now - firstAt > WELCOME_MAX_AGE_MS) return skipped('stale');

  const { vars } = await chatVariables({
    chatId,
    selfUserId: deps.selfUserId,
    sellerName: deps.sellerName,
    buyerName: firstCustomer.authorName || null,
    buyerId: firstCustomer.authorId,
    now: new Date(now),
  });
  const rendered = renderTemplate(body, vars);
  const text = rendered.text.trim();
  if (!text) return skipped('empty_reply');
  const lint = lintText(text, { checkVariables: false });
  const draftReason: DraftReason | null = rendered.missing.length
    ? 'missing_variables'
    : hasBlockingIssue(lint)
      ? 'lint'
      : null;
  if (draftReason) {
    const draftText =
      draftReason === 'missing_variables'
        ? renderTemplate(body, vars, { missing: 'keep' }).text.trim()
        : text;
    const { created } = await createAutomationDraft({
      id: draftId,
      chatId,
      triggerMessageId: firstCustomer.id,
      text: draftText,
      now,
      meta: {
        kind: 'welcome',
        reason: draftReason,
        buyer: firstCustomer.authorName || null,
        lint: lint.map((i) => i.id),
        missing: rendered.missing,
      },
    });
    return created ? { action: 'draft', draftId, reason: draftReason } : skipped('duplicate');
  }

  const quiet = quietHoursState(settings, new Date(now));
  if (quiet.active && !settings.messages.queueDuringQuietHours) return skipped('quiet_hours');
  const runAt = quiet.active ? quiet.endsAt : null;
  const { task, created } = await queueMessage({
    chatId,
    text,
    source: 'welcome',
    idempotencyKey: key,
    triggerMessageId: firstCustomer.id,
    ...(runAt ? { runAt } : {}),
  });
  if (!created) return skipped('duplicate');
  await log.info({ source: 'welcome', message: `Welcome message queued for new chat ${chatId}` });
  return { action: 'queued', taskId: task.id, runAt };
}
