import { browser } from 'wxt/browser';
import { funpayParser } from '@/adapters/funpay';
import type { RaiseTarget } from '@/adapters/funpay/types';
import { ALL_FEATURES, evaluateFeature, type AutomationContext, type FeatureStatus } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import { cancelPendingTasks } from '@/core/queue/queue';
import { getSettings, updateSettings } from '@/core/settings/store';
import {
  ChatMessageSchema,
  ChatSummarySchema,
  CompetitorOfferSchema,
  FinanceOperationSchema,
  ListingSchema,
  OrderSchema,
  ReviewSchema,
} from '@/shared/models';
import type { SessionInfo } from '@/shared/session';
import {
  ingestBalance,
  ingestBumpTarget,
  ingestChatList,
  ingestCompetitors,
  ingestFinance,
  ingestListings,
  ingestMessages,
  ingestOrders,
  ingestReviews,
} from '@/features/sync/ingest';
import { handle } from './router';
import { getLastSession, listTabs, pickExecutionTab, registerTab } from './tabs';
import type { z } from 'zod';

export async function automationContext(): Promise<AutomationContext> {
  const tab = await pickExecutionTab();
  return { funpayTabAvailable: !!tab, sessionLoggedIn: tab?.session.status === 'logged_in' };
}

export async function automationStatuses(): Promise<FeatureStatus[]> {
  const [settings, ctx] = await Promise.all([getSettings(), automationContext()]);
  return ALL_FEATURES.map((f) => evaluateFeature(settings, f, ctx));
}

/** Hooks other background modules use to react to ingested data (e.g. fetch changed chat histories). */
export const ingestHooks = {
  onChatsChanged: async (_chatIds: string[], _newChats: string[]): Promise<void> => {},
  onSession: async (_session: SessionInfo): Promise<void> => {},
};

export type SyncArea = 'orders' | 'chats' | 'listings' | 'finance' | 'reviews';
const syncTasks = new Map<SyncArea, () => Promise<unknown>>();

/** Feature modules register how to sync their data through an open FunPay tab. */
export function registerSyncTask(area: SyncArea, fn: () => Promise<unknown>): void {
  syncTasks.set(area, fn);
}

export async function runSync(areas?: SyncArea[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [area, fn] of syncTasks) {
    if (areas && !areas.includes(area)) continue;
    try {
      await fn();
      out[area] = 'ok';
    } catch (e) {
      out[area] = e instanceof Error ? e.message : String(e);
    }
  }
  return out;
}

export async function emergencyStop(reason: string): Promise<void> {
  await updateSettings({ automation: { state: 'stopped', stoppedAt: Date.now() } });
  const cancelled = await cancelPendingTasks();
  await log.warn({ source: 'automation', message: `Emergency stop: ${reason}. ${cancelled} pending task(s) cancelled.` });
  await browser.action?.setBadgeText?.({ text: 'STOP' });
  await browser.action?.setBadgeBackgroundColor?.({ color: '#d23b4c' });
}

const ParsedOrderSchema = OrderSchema.omit({ firstSeenAt: true, updatedAt: true, history: true });
const ParsedListingSchema = ListingSchema.omit({ costMinor: true, sortIndex: true, seenAt: true, updatedAt: true });
const ParsedReviewSchema = ReviewSchema.omit({ firstSeenAt: true });
const ParsedFinanceSchema = FinanceOperationSchema.omit({ firstSeenAt: true });

/** Validate every untrusted item; invalid items are dropped (never partially trusted). */
function validItems<S extends z.ZodType>(schema: S, items: unknown[]): z.output<S>[] {
  const out: z.output<S>[] = [];
  for (const i of items) {
    const r = schema.safeParse(i);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function registerCoreHandlers(): void {
  handle('cs.hello', async ({ url, session }, { tabId }) => {
    if (tabId === null) return null;
    await registerTab(tabId, url, session);
    await ingestBalance(session.balanceText);
    await ingestHooks.onSession(session);
    return { ok: true };
  });

  handle('cs.ingest', async ({ kind, items, context }) => {
    const settings = await getSettings();
    switch (kind) {
      case 'orders': {
        const direction = context['direction'] === 'purchase' ? 'purchase' : 'sale';
        return ingestOrders(validItems(ParsedOrderSchema, items), direction);
      }
      case 'listings': {
        return ingestListings(validItems(ParsedListingSchema, items));
      }
      case 'chats': {
        const res = await ingestChatList(validItems(ChatSummarySchema.omit({ pinned: true, updatedAt: true }), items));
        if (res.changed.length) await ingestHooks.onChatsChanged(res.changed, res.newChats);
        return res;
      }
      case 'messages': {
        const chatId = String(context['chatId'] ?? '');
        if (!chatId) return null;
        const res = await ingestMessages(chatId, validItems(ChatMessageSchema, items), { retentionDays: settings.privacy.messageRetentionDays });
        return { newCustomerMessages: res.newCustomerMessages.length };
      }
      case 'reviews':
        return ingestReviews(validItems(ParsedReviewSchema, items));
      case 'finance':
        return ingestFinance(validItems(ParsedFinanceSchema, items));
      case 'competitors': {
        const nodeId = String(context['nodeId'] ?? '');
        return nodeId ? ingestCompetitors(nodeId, validItems(CompetitorOfferSchema, items)) : 0;
      }
      case 'bumpTargets': {
        for (const t of items as RaiseTarget[]) {
          if (t && typeof t.gameId === 'string' && typeof t.nodeId === 'string') await ingestBumpTarget(t, String(context['categoryName'] ?? ''));
        }
        return null;
      }
      case 'balance':
        return null;
    }
  });

  handle('cs.getPageConfig', async () => {
    const s = await getSettings();
    // Only non-secret, presentation-relevant settings are exposed to content scripts.
    return {
      language: s.general.language,
      appearance: s.appearance,
      privacy: { privacyMode: s.privacy.privacyMode, hideBalances: s.privacy.hideBalances },
      fees: s.fees,
      flags: s.flags,
      recentEmojis: s.messages.recentEmojis,
      notifications: { sound: s.notifications.sound },
    };
  });

  handle('cs.listTemplates', async () => {
    const list = await getDb().templates.toArray();
    return list.map((t) => ({ id: t.id, name: t.name, command: t.command, body: t.body }));
  });

  handle('cs.listingCosts', async ({ ids }) => {
    const rows = await getDb().listings.bulkGet(ids);
    const out: Record<string, number | null> = {};
    rows.forEach((r, i) => {
      if (r) out[ids[i]!] = r.costMinor;
    });
    return out;
  });

  handle('cs.recordEmoji', async ({ emoji }) => {
    const s = await getSettings();
    const recent = [emoji, ...s.messages.recentEmojis.filter((e) => e !== emoji)].slice(0, 24);
    await updateSettings({ messages: { recentEmojis: recent } });
    return recent;
  });

  handle('ui.status', async () => {
    const [settings, session, tabs, statuses] = await Promise.all([getSettings(), getLastSession(), listTabs(), automationStatuses()]);
    const db = getDb();
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [activeSales, unreadChats, todaysSales, failedTasks, pendingDrafts] = await Promise.all([
      db.orders.where('[direction+status]').equals(['sale', 'paid']).count(),
      db.chats.filter((c) => c.unread).count(),
      db.orders.where('direction').equals('sale').filter((o) => !!o.createdAt && o.createdAt >= since.toISOString()).toArray(),
      db.tasks.where('status').equals('failed').count(),
      db.drafts.where('status').equals('pending').count(),
    ]);
    const salesToday: Record<string, number> = {};
    for (const o of todaysSales) if (o.status !== 'refunded') salesToday[o.price.currency] = (salesToday[o.price.currency] ?? 0) + o.price.amountMinor;
    return {
      automationState: settings.automation.state,
      liveActionsAcknowledged: settings.automation.liveActionsAcknowledged,
      session,
      openTabs: tabs.length,
      statuses,
      counts: { activeSales, unreadChats, salesTodayCount: todaysSales.length, failedTasks, pendingDrafts },
      salesToday,
    };
  });

  handle('ui.setAutomationState', async ({ state }) => {
    if (state === 'stopped') {
      await emergencyStop('requested from UI');
    } else {
      await updateSettings({ automation: { state, stoppedAt: null } });
      await browser.action?.setBadgeText?.({ text: '' });
      await log.info({ source: 'automation', message: `Automation ${state}` });
    }
    return null;
  });

  handle('ui.syncNow', async ({ what }) => runSync(what));

  handle('ui.emergencyStop', async () => {
    await emergencyStop('requested from UI');
    return null;
  });
}

/** Parser helper exposed for tests/diagnostics. */
export const parserVersion = funpayParser.version;
