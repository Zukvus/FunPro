/**
 * Background module: reviews, AI copilot, Telegram, notifications & sounds.
 *
 * - Notification sinks: desktop (browser.notifications + storage.session click targets), sound
 *   (Chrome offscreen document / Firefox Audio), Telegram (rate-limited, sanitised).
 * - Domain events → notify(): ORDER_PAID, MESSAGE_RECEIVED, REVIEW_RECEIVED, AUTOMATION_FAILED,
 *   INVENTORY_LOW, PRICE_CHANGE_DETECTED (only when some sink wants price alerts).
 * - Auto review replies on REVIEW_RECEIVED (policy-gated; drafts by default).
 * - Telegram: /status and /stop polling in the 1-minute tick, daily summary alarm.
 * - RPC: ui.replyReview, ui.testNotification, ui.telegramTest, ui.telegramSummaryNow, cs.playSound.
 */
import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { TELEGRAM_PERMISSION_ORIGIN, TelegramApi, TelegramError, RateLimitedSender } from '@/adapters/telegram/api';
import { bold, escapeTelegramHtml } from '@/adapters/telegram/format';
import { getDb } from '@/core/db/db';
import { onEvent } from '@/core/events/bus';
import { log } from '@/core/log/logger';
import { getSecret } from '@/core/security/secrets';
import { getSettings, watchSettings } from '@/core/settings/store';
import type { DomainEvent, EventType } from '@/shared/models';
import {
  createAudioElementPlayer,
  createClickTargetStore,
  createDesktopSink,
  createOffscreenPlayer,
  createSoundSink,
  createThrottledPlayer,
  desktopEnabledFor,
  extensionUrl,
  handleDesktopClick,
  notificationForEvent,
  notify,
  nt,
  pruneNotificationDedupe,
  registerSink,
  resolveNotifyLang,
  resolveSoundRef,
  soundEnabledFor,
  soundIdFor,
  wantsPriceNotifications,
  type ClickTarget,
  type DesktopNotificationsApi,
  type OffscreenApi,
  type SoundPlayer,
} from '@/features/notifications';
import { handleReviewForAutoReply, markReviewReplied, prepareReviewReply } from '@/features/reviews';
import {
  buildLocalSummary,
  clearTelegramError,
  createTelegramSink,
  formatStatusHtml,
  formatSummaryHtml,
  isSummaryDue,
  KV_LAST_ERROR,
  KV_STOP_REQUEST,
  KV_SUMMARY_DAY,
  KV_UPDATE_OFFSET,
  localDayKey,
  nextSummaryAt,
  processTelegramUpdates,
  recordTelegramError,
  telegramReady,
} from '@/features/telegram';
import { onAlarm } from '../alarms';
import { automationContext, emergencyStop } from '../core-handlers';
import { handle, UserFacingError } from '../router';
import { execInFunPayTab, NoFunPayTabError } from '../tabs';
import type { BackgroundModule } from './index';

const SUMMARY_ALARM = 'funpro:tg-summary';
const NOTIFY_EVENTS: EventType[] = ['ORDER_PAID', 'MESSAGE_RECEIVED', 'REVIEW_RECEIVED', 'AUTOMATION_FAILED', 'INVENTORY_LOW', 'PRICE_CHANGE_DETECTED'];

const clickTargetsItem = storage.defineItem<Record<string, ClickTarget>>('session:notificationTargets', { fallback: {} });
const clickStore = createClickTargetStore(clickTargetsItem);
/** ≤ 1 message per ~1.1 s, honours 429 retry_after, bounded queue. */
const telegramSender = new RateLimitedSender({ minGapMs: 1100, maxQueue: 30 });

function extensionOrigin(): string {
  return browser.runtime.getURL('/').replace(/\/$/, '');
}

function offscreenApi(): OffscreenApi | null {
  const api = (browser as unknown as { offscreen?: OffscreenApi }).offscreen;
  return api && typeof api.createDocument === 'function' ? api : null;
}

async function hasOrigin(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------------------------

let player: SoundPlayer | null = null;

function getPlayer(): SoundPlayer {
  if (player) return player;
  const offscreen = offscreenApi();
  if (offscreen) {
    const documentUrl = extensionUrl('/offscreen.html');
    let created = false;
    player = createThrottledPlayer(
      createOffscreenPlayer({
        offscreen: {
          createDocument: async (p) => {
            await offscreen.createDocument(p);
            created = true;
          },
          closeDocument: async () => {
            await offscreen.closeDocument();
            created = false;
          },
        },
        async hasDocument() {
          const getContexts = (browser.runtime as unknown as { getContexts?: (f: object) => Promise<unknown[]> }).getContexts;
          if (typeof getContexts !== 'function') return created;
          const contexts = await getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [documentUrl] });
          return contexts.length > 0;
        },
        sendMessage: (message) => browser.runtime.sendMessage(message),
      }),
    );
  } else if (typeof Audio !== 'undefined') {
    player = createThrottledPlayer(createAudioElementPlayer());
  } else {
    player = { play: async () => undefined };
  }
  return player;
}

// ---------------------------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------------------------

async function telegramSend(chatId: string, html: string): Promise<void> {
  const token = await getSecret('telegram.botToken');
  if (!token) throw new TelegramError('The Telegram bot token is missing', 'config');
  if (!(await hasOrigin(TELEGRAM_PERMISSION_ORIGIN))) throw new TelegramError('Access to api.telegram.org was not granted', 'config');
  const api = new TelegramApi(token);
  try {
    await telegramSender.enqueue(() => api.sendMessage(chatId, html));
    if (await getDb().kv.get(KV_LAST_ERROR)) await clearTelegramError();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordTelegramError(message);
    void log.warn({ source: 'telegram', message: `Telegram send failed: ${message}` });
    throw e;
  }
}

async function knownSecrets(): Promise<string[]> {
  const [token, aiKey] = await Promise.all([getSecret('telegram.botToken'), getSecret('ai.apiKey')]);
  return [token, aiKey].filter((s): s is string => !!s);
}

let pollRunning = false;

async function pollTelegramCommands(): Promise<void> {
  if (pollRunning) return;
  pollRunning = true;
  try {
    const settings = await getSettings();
    if (!telegramReady(settings) || !settings.telegram.remoteCommands) return;
    if (!(await hasOrigin(TELEGRAM_PERMISSION_ORIGIN))) return;
    const token = await getSecret('telegram.botToken');
    if (!token) return;
    const db = getDb();
    const offsetRec = await db.kv.get(KV_UPDATE_OFFSET);
    const offset = typeof offsetRec?.value === 'number' ? offsetRec.value : undefined;
    const updates = await new TelegramApi(token).getUpdates({ offset, limit: 50 });
    if (updates.length === 0) return;
    // Acknowledge first (at-most-once): a crash mid-way must never execute a command twice.
    await db.kv.put({ key: KV_UPDATE_OFFSET, value: Math.max(...updates.map((u) => u.update_id)) + 1 });
    const lang = resolveNotifyLang(settings.general.language);
    const chatId = settings.telegram.chatId;
    const res = await processTelegramUpdates(updates, {
      settings,
      reply: (html) => telegramSend(chatId, html).catch(() => undefined),
      emergencyStop: (reason) => emergencyStop(reason),
      statusHtml: async () => formatStatusHtml(await buildLocalSummary(), (await getSettings()).automation.state, lang),
      texts: {
        stopAsk: escapeTelegramHtml(nt(lang, 'tg.stopAsk')),
        stopDone: escapeTelegramHtml(nt(lang, 'tg.stopDone')),
        stopExpired: escapeTelegramHtml(nt(lang, 'tg.stopExpired')),
      },
      getStopRequestedAt: async () => {
        const v = (await db.kv.get(KV_STOP_REQUEST))?.value;
        return typeof v === 'number' ? v : null;
      },
      setStopRequestedAt: async (at) => {
        if (at === null) await db.kv.delete(KV_STOP_REQUEST);
        else await db.kv.put({ key: KV_STOP_REQUEST, value: at });
      },
      nowSec: () => Math.floor(Date.now() / 1000),
    });
    if (res.handled.length) await log.info({ source: 'telegram', message: `Telegram commands: ${res.handled.join(', ')}` });
    if (res.ignored) await log.debug({ source: 'telegram', message: `Ignored ${res.ignored} Telegram update(s) (not an accepted command from the authorised chat)` });
  } catch (e) {
    const message = e instanceof TelegramError && e.code === 'conflict' ? 'The bot has a webhook configured; remove it so FunPro can read /status and /stop' : e instanceof Error ? e.message : String(e);
    await recordTelegramError(message);
    void log.warn({ source: 'telegram', message: `Telegram polling failed: ${message}` });
  } finally {
    pollRunning = false;
  }
}

/** Check-and-set of the day marker so the tick and the summary alarm never both send. */
async function claimSummaryDay(day: string): Promise<boolean> {
  const db = getDb();
  return db.transaction('rw', db.kv, async () => {
    if ((await db.kv.get(KV_SUMMARY_DAY))?.value === day) return false;
    await db.kv.put({ key: KV_SUMMARY_DAY, value: day });
    return true;
  });
}

async function sendDailySummary(force: boolean): Promise<boolean> {
  const settings = await getSettings();
  if (!telegramReady(settings)) return false;
  const now = new Date();
  if (!force) {
    if (!settings.telegram.dailySummary) return false;
    const last = (await getDb().kv.get(KV_SUMMARY_DAY))?.value;
    if (!isSummaryDue(now, settings.telegram.dailySummaryTime, typeof last === 'string' ? last : null)) return false;
    if (!(await claimSummaryDay(localDayKey(now)))) return false;
  }
  const html = formatSummaryHtml(await buildLocalSummary(now), resolveNotifyLang(settings.general.language), now);
  await telegramSend(settings.telegram.chatId, html);
  return true;
}

async function ensureSummaryAlarm(): Promise<void> {
  const settings = await getSettings();
  if (!telegramReady(settings) || !settings.telegram.dailySummary) {
    await browser.alarms.clear(SUMMARY_ALARM);
    return;
  }
  const when = nextSummaryAt(new Date(), settings.telegram.dailySummaryTime);
  const existing = await browser.alarms.get(SUMMARY_ALARM);
  if (existing && Math.abs(existing.scheduledTime - when) < 60_000) return;
  await browser.alarms.create(SUMMARY_ALARM, { when });
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

async function notifyForEvent(event: DomainEvent): Promise<void> {
  const settings = await getSettings();
  if (event.type === 'PRICE_CHANGE_DETECTED' && !wantsPriceNotifications(settings)) return;
  const input = await notificationForEvent(event, settings, { dashboardUrl: (hash) => extensionUrl(`/options.html${hash}`) });
  if (input) await notify(input);
}

async function autoReplyToReview(event: DomainEvent): Promise<void> {
  const settings = await getSettings();
  const res = await handleReviewForAutoReply(event, {
    getSettings,
    automationContext,
    postReply: (orderId, text) => execInFunPayTab<{ ok: boolean; error?: string }>({ action: 'replyReview', orderId, text }),
    lang: resolveNotifyLang(settings.general.language),
  });
  if (res.outcome === 'post_failed') {
    await notify({
      kind: 'failure',
      title: 'Review reply not posted',
      body: res.detail ?? 'The automatic review reply failed; it is waiting for your approval.',
      url: extensionUrl('/options.html#/reviews'),
      dedupeKey: `review-reply-failed:${String(event.payload['orderId'] ?? event.id)}`,
    });
  }
}

export const assistantModule: BackgroundModule = {
  name: 'assistant',
  register() {
    // ---- sinks ------------------------------------------------------------------------------
    const notificationsApi = browser.notifications as unknown as DesktopNotificationsApi | undefined;
    if (notificationsApi) {
      registerSink(
        'desktop',
        createDesktopSink({
          api: notificationsApi,
          getSettings,
          iconUrl: extensionUrl('/icon/128.png'),
          clickStore,
          extensionOrigin: extensionOrigin(),
          chromeOptions: offscreenApi() !== null,
        }),
      );
      browser.notifications.onClicked.addListener((id) => {
        void handleDesktopClick(id, {
          clickStore,
          api: notificationsApi,
          extensionOrigin: extensionOrigin(),
          openUrl: async (url) => {
            const tab = await browser.tabs.create({ url, active: true });
            if (tab.windowId !== undefined) await browser.windows?.update(tab.windowId, { focused: true }).catch(() => undefined);
          },
        });
      });
      browser.notifications.onClosed.addListener((id) => {
        void clickStore.forget(id);
      });
    }
    registerSink('sound', createSoundSink({ player: { play: (ref, volume) => getPlayer().play(ref, volume) }, getSettings }));
    registerSink(
      'telegram',
      createTelegramSink({
        getSettings,
        send: telegramSend,
        knownSecrets,
        onError: () => undefined, // recorded by telegramSend
      }),
    );

    // ---- events -----------------------------------------------------------------------------
    for (const type of NOTIFY_EVENTS) onEvent(type, notifyForEvent);
    onEvent('REVIEW_RECEIVED', autoReplyToReview);

    // ---- alarms -----------------------------------------------------------------------------
    onAlarm('funpro:tick', async () => {
      await pollTelegramCommands();
      await sendDailySummary(false).catch(() => false);
      await ensureSummaryAlarm();
    });
    onAlarm(SUMMARY_ALARM, async () => {
      await sendDailySummary(false).catch(() => false);
      await ensureSummaryAlarm();
    });
    onAlarm('funpro:maintenance', async () => {
      await pruneNotificationDedupe();
    });
    watchSettings(() => {
      void ensureSummaryAlarm().catch(() => undefined);
    });

    // ---- RPC --------------------------------------------------------------------------------
    handle('ui.replyReview', async ({ orderId, text, draftId }) => {
      const prepared = prepareReviewReply(text);
      if (!prepared.ok) throw new UserFacingError(`Reply not sent: ${prepared.issues.join(', ')}`, 'invalid_reply');
      if (!(await getDb().reviews.get(orderId))) throw new UserFacingError('Review not found — sync your reviews first', 'not_found');
      let res: { ok: boolean; error?: string } | undefined;
      try {
        res = await execInFunPayTab<{ ok: boolean; error?: string }>({ action: 'replyReview', orderId, text: prepared.text });
      } catch (e) {
        if (e instanceof NoFunPayTabError) throw new UserFacingError(e.message, 'no_tab');
        throw new UserFacingError(`The reply may not have been posted (${(e as Error).message}). Check the order page on FunPay before retrying.`, 'uncertain');
      }
      if (!res?.ok) throw new UserFacingError(res?.error ? `FunPay: ${res.error}` : 'FunPay rejected the reply', 'rejected');
      await markReviewReplied(orderId, prepared.text, draftId ?? null);
      await log.info({ source: 'reviews', message: `Replied to the review on order ${orderId}` });
      return { ok: true };
    });

    handle('ui.testNotification', async ({ kind }) => {
      const settings = await getSettings();
      const lang = resolveNotifyLang(settings.general.language);
      const item = await notify({
        kind,
        title: nt(lang, 'test.title'),
        body: nt(lang, 'test.body'),
        url: extensionUrl('/options.html#/notifications'),
        meta: { test: true },
        sinks: ['desktop', 'sound'],
      });
      return { id: item?.id ?? null, desktop: desktopEnabledFor(settings, kind), sound: soundEnabledFor(settings, kind) };
    });

    handle('ui.telegramTest', async () => {
      const settings = await getSettings();
      if (!telegramReady(settings)) throw new UserFacingError('Telegram is not connected (or local-only mode is on)', 'not_ready');
      const lang = resolveNotifyLang(settings.general.language);
      try {
        await telegramSend(settings.telegram.chatId, `🔔 ${bold('FunPro')}\n${escapeTelegramHtml(nt(lang, 'tg.test'))}`);
      } catch (e) {
        throw new UserFacingError(e instanceof Error ? e.message : String(e), 'telegram');
      }
      return { ok: true };
    });

    handle('ui.telegramSummaryNow', async () => {
      try {
        const sent = await sendDailySummary(true);
        if (!sent) throw new UserFacingError('Telegram is not connected (or local-only mode is on)', 'not_ready');
      } catch (e) {
        if (e instanceof UserFacingError) throw e;
        throw new UserFacingError(e instanceof Error ? e.message : String(e), 'telegram');
      }
      return { ok: true };
    });

    handle('cs.playSound', async ({ kind }) => {
      const settings = await getSettings();
      if (!soundEnabledFor(settings, kind)) return { played: false };
      const ref = resolveSoundRef(soundIdFor(settings, kind));
      if (!ref) return { played: false };
      await getPlayer().play(ref, settings.notifications.volume);
      return { played: true };
    });

    void ensureSummaryAlarm().catch(() => undefined);
  },
};
