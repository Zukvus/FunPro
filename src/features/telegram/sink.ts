/**
 * Telegram notification sink. Sends only when Telegram is fully authorised (not local-only,
 * enabled, consent given, chat confirmed) and the user enabled that kind of alert. Sending is
 * rate-limited by the caller-provided `send` (RateLimitedSender) and never blocks `notify()`.
 */
import { isFlagEnabled } from '@/core/flags/flags';
import type { Settings } from '@/core/settings/schema';
import type { NotificationKind, NotificationSink } from '@/features/notifications/notify';
import { resolveNotifyLang } from '@/features/notifications/texts';
import { buildTelegramAlert, type AlertFields } from './messages';
import { sanitizeForTelegram } from './sanitize';

/** All gates except the token and host permission (checked when sending). */
export function telegramReady(settings: Settings): boolean {
  const t = settings.telegram;
  return (
    isFlagEnabled('telegram', settings.flags) &&
    !settings.general.localOnly &&
    t.enabled &&
    t.consentAt !== null &&
    /^-?\d{1,20}$/.test(t.chatId)
  );
}

export function telegramWantsKind(settings: Settings, kind: NotificationKind): boolean {
  const t = settings.telegram;
  switch (kind) {
    case 'order':
      return t.notifyOrders;
    case 'message':
      return t.notifyMessages;
    case 'review':
      return t.notifyReviews;
    case 'inventory':
      return t.notifyInventory;
    case 'failure':
      return t.notifyFailures;
    case 'bump':
      return t.notifyBumps;
    case 'price':
      return t.notifyPrices;
    case 'system':
      return false;
  }
}

export interface TelegramSinkDeps {
  getSettings(): Promise<Settings>;
  /** Rate-limited send to the authorised chat. */
  send(chatId: string, html: string): Promise<void>;
  /** Secret values that must never be forwarded (bot token, AI key). */
  knownSecrets(): Promise<string[]>;
  onError?(e: unknown): void;
}

const ORDER_ID = /^[A-Z0-9]{6,12}$/;
const CHAT_ID = /^[\w-]{1,64}$/;

export function createTelegramSink(deps: TelegramSinkDeps): NotificationSink {
  return async (item, input) => {
    if (input.meta?.test) return;
    const settings = await deps.getSettings();
    // A notification explicitly addressed to Telegram (e.g. a workflow rule's "send to Telegram"
    // action) is the user's own choice, so the per-kind toggles do not filter it.
    const explicitlyTargeted = input.sinks?.includes('telegram') === true;
    if (!telegramReady(settings) || (!explicitlyTargeted && !telegramWantsKind(settings, item.kind))) return;
    const secrets = await deps.knownSecrets();
    const meta = input.meta ?? {};
    const previews = settings.telegram.includePreviews;
    const fields: AlertFields = {
      title: await sanitizeForTelegram(item.title, secrets),
      body: await sanitizeForTelegram(item.body, secrets),
      item: await sanitizeForTelegram(meta.item, secrets),
      price: meta.price ?? null,
      buyer: previews ? await sanitizeForTelegram(meta.buyer, secrets) : null,
      preview: previews ? await sanitizeForTelegram(meta.preview, secrets) : null,
      stars: meta.stars ?? null,
      orderId: meta.orderId && ORDER_ID.test(meta.orderId) ? meta.orderId : null,
      chatId: meta.chatId && CHAT_ID.test(meta.chatId) ? meta.chatId : null,
    };
    const html = buildTelegramAlert(item.kind, fields, {
      includePreviews: previews,
      lang: resolveNotifyLang(settings.general.language),
    });
    // Do not await delivery: the rate limiter may hold the message for a while.
    deps.send(settings.telegram.chatId, html).catch((e: unknown) => deps.onError?.(e));
  };
}
