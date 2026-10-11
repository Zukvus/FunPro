import { browser } from 'wxt/browser';
import { onEvent } from '@/core/events/bus';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import { getSettings } from '@/core/settings/store';
import { processFollowUps } from '@/features/crm/followUps';
import { handleMessageReceived } from '@/features/messages/autoReply';
import type { MessagingDeps } from '@/features/messages/automation';
import {
  drainHistoryQueue,
  enqueueHistories,
  fetchChatHistory,
  readSyncStatus,
  recordSyncDisabled,
  syncChats,
  type ChatSyncDeps,
  type ChatSyncStatus,
} from '@/features/messages/chatSync';
import { chatVariables } from '@/features/messages/context';
import { afterHistoryIngest } from '@/features/messages/pipeline';
import { handleOrderCompleted } from '@/features/messages/postOrder';
import { processDueScheduled } from '@/features/messages/scheduled';
import { notify } from '@/features/notifications/notify';
import { getDb } from '@/core/db/db';
import { clearAlarm, ensurePeriodicAlarm, onAlarm } from '../alarms';
import { automationContext, ingestHooks, registerSyncTask } from '../core-handlers';
import { handle, UserFacingError } from '../router';
import { execInFunPayTab, getLastSession, NoFunPayTabError } from '../tabs';
import type { BackgroundModule } from './index';

/** Periodic chat sync (period = settings.sync.intervalMinutes). */
export const ALARM_CHAT_SYNC = 'funpro:messaging:sync';

async function messagingDeps(settings?: Settings): Promise<MessagingDeps> {
  const [s, ctx, session] = await Promise.all([settings ?? getSettings(), automationContext(), getLastSession()]);
  return { settings: s, ctx, now: Date.now(), selfUserId: session?.userId ?? null, sellerName: session?.username ?? null };
}

async function chatSyncDeps(): Promise<ChatSyncDeps> {
  const settings = await getSettings();
  return {
    exec: (cmd) => execInFunPayTab(cmd),
    isNoTab: (e) => e instanceof NoFunPayTabError,
    settings,
    now: () => Date.now(),
    afterHistory: async (chatId, result, isNew) => {
      await afterHistoryIngest(chatId, result, isNew, await messagingDeps(settings));
    },
  };
}

let lastAlarmSyncAt = 0;
let alarmPeriod: number | null = null;

/**
 * Reading chats never depends on the automation state (only sending does). The alarm path honours
 * `messages.backgroundChatSync` and never runs more often than half the configured interval, so a
 * second scheduler calling it cannot double the request rate.
 */
async function runChatSync(trigger: 'alarm' | 'manual'): Promise<ChatSyncStatus | null> {
  const settings = await getSettings();
  const now = Date.now();
  if (trigger === 'alarm') {
    if (!settings.messages.backgroundChatSync) return recordSyncDisabled(now);
    if (now - lastAlarmSyncAt < settings.sync.intervalMinutes * 30_000) return readSyncStatus();
    lastAlarmSyncAt = now;
  }
  const previous = await readSyncStatus();
  const status = await syncChats(await chatSyncDeps());
  // Logged on the transition only, so a closed FunPay tab does not flood the activity log.
  if (status.state === 'blocked' && previous?.state !== 'blocked') {
    await log.info({ source: 'chat-sync', message: 'Chat sync paused: no logged-in FunPay tab is open', hint: 'Open funpay.com and log in; syncing resumes automatically.' });
  }
  return status;
}

async function ensureChatSyncAlarm(settings: Settings): Promise<void> {
  if (!settings.messages.backgroundChatSync) {
    if (alarmPeriod !== 0) {
      await clearAlarm(ALARM_CHAT_SYNC);
      alarmPeriod = 0;
    }
    return;
  }
  if (alarmPeriod === settings.sync.intervalMinutes) return;
  await ensurePeriodicAlarm(ALARM_CHAT_SYNC, settings.sync.intervalMinutes, 1);
  alarmPeriod = settings.sync.intervalMinutes;
}

function dashboardUrl(hash: string): string {
  return browser.runtime.getURL(`/options.html#/${hash}`);
}

/** Background module: chat sync, auto-replies, welcome / post-order / scheduled messages, CRM reminders. */
export const messagingModule: BackgroundModule = {
  name: 'messaging',
  register() {
    // ---- reading --------------------------------------------------------------------------------
    registerSyncTask('chats', async () => {
      const status = await runChatSync('manual');
      if (status?.state === 'blocked') throw new Error('blocked: open FunPay');
      if (status?.state === 'error') throw new Error(status.message);
      return status;
    });
    onAlarm(ALARM_CHAT_SYNC, async () => {
      await runChatSync('alarm');
    });
    // Passive ingestion (the seller browsing /chat/) reports changed chats: load their histories
    // without delaying the page's own ingestion call.
    ingestHooks.onChatsChanged = async (changed, newChats) => {
      await enqueueHistories(changed, newChats, Date.now());
      void chatSyncDeps()
        .then((d) => drainHistoryQueue(d))
        .catch((e: unknown) => log.warn({ source: 'chat-sync', message: `History fetch failed: ${e instanceof Error ? e.message : String(e)}` }));
    };

    // ---- automations ----------------------------------------------------------------------------
    onEvent('MESSAGE_RECEIVED', async (e) => {
      await handleMessageReceived(e, await messagingDeps());
    });
    onEvent('ORDER_COMPLETED', async (e) => {
      await handleOrderCompleted(e, await messagingDeps());
    });
    onAlarm('funpro:tick', async () => {
      const settings = await getSettings();
      const now = Date.now();
      await processDueScheduled({ settings, now });
      await processFollowUps({ now, notify, urlFor: (id) => dashboardUrl(`customers?id=${encodeURIComponent(id)}`) });
      await ensureChatSyncAlarm(settings);
    });

    // ---- RPC ------------------------------------------------------------------------------------
    handle('ui.messaging.syncChats', async () => runChatSync('manual'));

    handle('ui.messaging.fetchHistory', async ({ chatId }) => {
      try {
        const res = await fetchChatHistory(chatId, await chatSyncDeps());
        return { stored: await getDb().messages.where('chatId').equals(chatId).count(), firstHistory: res.firstHistoryForChat };
      } catch (e) {
        if (e instanceof NoFunPayTabError) throw new UserFacingError(e.message, 'no_tab');
        throw e;
      }
    });

    handle('cs.messaging.chatContext', async ({ chatId, partnerName }) => {
      const session = await getLastSession();
      const { vars } = await chatVariables({
        chatId,
        selfUserId: session?.userId ?? null,
        sellerName: session?.username ?? null,
        buyerName: partnerName ?? null,
        now: new Date(),
      });
      return { buyer: vars.buyer ?? null, seller: vars.seller ?? null, order_id: vars.order_id ?? null, product: vars.product ?? null, price: vars.price ?? null, chat_url: vars.chat_url ?? null };
    });

    void getSettings()
      .then((s) => ensureChatSyncAlarm(s))
      .catch(() => undefined);
  },
};
