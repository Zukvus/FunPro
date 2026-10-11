import { evaluateFeature, type AutomationFeature } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import { claimDueTasks, completeTask, deferTask, failTask } from '@/core/queue/queue';
import { getSettings } from '@/core/settings/store';
import { newId } from '@/core/util/id';
import { AUTO_SEND_LIMIT, countRecentAutoSends, type OutboxSource } from '@/features/messages/outbox';
import { notify } from '@/features/notifications/notify';
import type { SendResult } from '@/adapters/funpay';
import type { Task } from '@/shared/models';
import { onAlarm } from '../alarms';
import { automationContext } from '../core-handlers';
import { handle } from '../router';
import { execInFunPayTab, NoFunPayTabError } from '../tabs';
import type { BackgroundModule } from './index';

const SOURCE_FEATURE: Partial<Record<OutboxSource, AutomationFeature>> = {
  auto_reply: 'autoReply',
  welcome: 'welcomeMessage',
  post_order: 'postOrderMessage',
  delivery: 'autoDelivery',
  workflow: 'workflows',
};

/** Sources that are automation (subject to emergency stop, policy and rate limits). */
export function isAutomatedSource(source: OutboxSource): boolean {
  return source !== 'manual' && source !== 'ai';
}

let lastAutoSendAt = 0;

async function processTask(task: Task): Promise<void> {
  const p = task.payload as { chatId: string; text: string; source: OutboxSource; ruleId: string | null; triggerMessageId: string | null; draftId: string | null };
  const settings = await getSettings();
  const automated = isAutomatedSource(p.source);
  if (automated) {
    if (settings.automation.state === 'stopped') {
      await failTask(task.id, 'Blocked: emergency stop is active', { retryable: false });
      return;
    }
    if (settings.automation.state === 'paused') {
      await deferTask(task.id, 'blocked', 5 * 60_000, 'Automation is paused');
      return;
    }
    const feature = SOURCE_FEATURE[p.source];
    if (feature) {
      const st = evaluateFeature(settings, feature, await automationContext());
      if (st.status === 'awaiting_authorization' || st.status === 'disabled') {
        await failTask(task.id, `Not sent: ${st.reason}`, { retryable: false });
        return;
      }
    }
    if ((await countRecentAutoSends()) >= AUTO_SEND_LIMIT.max) {
      await deferTask(task.id, 'pending', 60_000, 'Automatic send limit reached (15 per 10 min) — waiting');
      return;
    }
    const gap = Date.now() - lastAutoSendAt;
    if (gap < AUTO_SEND_LIMIT.gapMs) {
      await deferTask(task.id, 'pending', AUTO_SEND_LIMIT.gapMs - gap, 'Spacing automatic sends');
      return;
    }
  }

  let result: SendResult;
  try {
    result = await execInFunPayTab<SendResult>({ action: 'sendMessage', chatId: p.chatId, text: p.text });
  } catch (e) {
    if (e instanceof NoFunPayTabError) {
      await deferTask(task.id, 'awaiting_tab', 2 * 60_000, e.message);
      return;
    }
    // The request may or may not have reached FunPay: never retry automatically.
    await failTask(task.id, `Outcome uncertain: ${(e as Error).message}`, { retryable: false });
    await markDraft(p.draftId, 'failed');
    await notify({ kind: 'failure', title: 'Message may not have been sent', body: `Chat ${p.chatId}: ${(e as Error).message}`, url: `https://funpay.com/chat/?node=${encodeURIComponent(p.chatId)}` });
    return;
  }
  if (automated) lastAutoSendAt = Date.now();
  if (result.ok) {
    await completeTask(task.id);
    await markDraft(p.draftId, 'sent');
    if (automated) {
      await getDb().replyLedger.put({ id: `${p.chatId}:${p.triggerMessageId ?? newId('x')}:${p.ruleId ?? p.source}`, chatId: p.chatId, ruleId: p.ruleId ?? p.source, at: Date.now(), text: p.text.slice(0, 200) });
    }
    await log.info({ source: 'outbox', message: `Message sent (${p.source}) to chat ${p.chatId}` });
  } else if (result.flood) {
    await deferTask(task.id, 'pending', 5 * 60_000, `FunPay flood protection: ${result.error}`);
    await log.warn({ source: 'outbox', message: 'FunPay reported sending too frequently; pausing sends for 5 minutes' });
  } else {
    await failTask(task.id, result.error, { retryable: false });
    await markDraft(p.draftId, 'failed');
    await notify({ kind: 'failure', title: 'Message not sent', body: result.error, url: `https://funpay.com/chat/?node=${encodeURIComponent(p.chatId)}` });
  }
}

async function markDraft(id: string | null, status: 'sent' | 'failed'): Promise<void> {
  if (id) await getDb().drafts.update(id, { status, updatedAt: Date.now() });
}

export async function processOutbox(): Promise<number> {
  const tasks = await claimDueTasks(Date.now(), 5, ['send_message']);
  for (const t of tasks) await processTask(t);
  return tasks.length;
}

export const outboxModule: BackgroundModule = {
  name: 'outbox',
  register() {
    onAlarm('funpro:tick', async () => {
      await processOutbox();
    });
    handle('ui.sendMessage', async ({ chatId, text, draftId }) => {
      const { queueMessage } = await import('@/features/messages/outbox');
      const { task } = await queueMessage({ chatId, text, source: 'manual', idempotencyKey: `manual:${draftId ?? newId('m')}`, draftId });
      await processOutbox();
      const fresh = await getDb().tasks.get(task.id);
      return { taskId: task.id, status: fresh?.status ?? 'pending', error: fresh?.lastError ?? null };
    });
    handle('ui.processQueueNow', async () => ({ processed: await processOutbox() }));
  },
};
