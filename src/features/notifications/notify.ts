/**
 * Notification fan-out. `notify()` records an entry in the notification center and forwards it to
 * registered sinks (desktop notifications, sounds, Telegram). Sinks are registered by background
 * modules; failures in one sink never affect the others.
 */
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import type { NotificationItem } from '@/shared/models';

export type NotificationKind = NotificationItem['kind'];

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'order',
  'message',
  'review',
  'bump',
  'inventory',
  'price',
  'failure',
  'system',
];

/**
 * Optional structured details for sinks that format their own text (e.g. Telegram). Only these
 * whitelisted fields exist; sinks decide what to show based on the user's privacy settings.
 */
export interface NotificationMeta {
  orderId?: string;
  chatId?: string;
  /** Buyer / counterparty display name. */
  buyer?: string | null;
  item?: string | null;
  /** Already formatted price, e.g. "1 250 ₽". */
  price?: string | null;
  stars?: number | null;
  /** Customer-written text (message preview / review text). */
  preview?: string | null;
  /** Test notification fired from the settings page. */
  test?: boolean;
}

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string | null;
  /** Dedupe key: the same key within 24h is not notified twice. */
  dedupeKey?: string;
  /** Suppress sinks (only record in the notification center). */
  silent?: boolean;
  meta?: NotificationMeta;
  /** Deliver only to these sinks (registered names); all sinks when omitted. */
  sinks?: readonly string[];
}

export type NotificationSink = (item: NotificationItem, input: NotifyInput) => Promise<void> | void;

const sinks = new Map<string, NotificationSink>();

export function registerSink(name: string, sink: NotificationSink): void {
  sinks.set(name, sink);
}

export function clearSinksForTests(): void {
  sinks.clear();
}

const MAX_CENTER_ITEMS = 1000;
const DEDUPE_WINDOW_MS = 24 * 3600_000;
const DEDUPE_PREFIX = 'notif:';

export async function notify(input: NotifyInput): Promise<NotificationItem | null> {
  const db = getDb();
  if (input.dedupeKey) {
    const key = `${DEDUPE_PREFIX}${input.dedupeKey}`;
    // Check-and-set in one transaction so two contexts cannot both pass the dedupe check.
    const fresh = await db.transaction('rw', db.kv, async () => {
      const seen = await db.kv.get(key);
      if (seen && typeof seen.value === 'number' && Date.now() - seen.value < DEDUPE_WINDOW_MS) return false;
      await db.kv.put({ key, value: Date.now() });
      return true;
    });
    if (!fresh) return null;
  }
  const item: NotificationItem = {
    id: newId('n'),
    at: Date.now(),
    kind: input.kind,
    title: input.title.slice(0, 200),
    body: input.body.slice(0, 1000),
    url: input.url ?? null,
    read: false,
  };
  await db.notifications.add(item);
  const count = await db.notifications.count();
  if (count > MAX_CENTER_ITEMS) {
    const old = await db.notifications
      .orderBy('at')
      .limit(count - MAX_CENTER_ITEMS)
      .primaryKeys();
    await db.notifications.bulkDelete(old);
  }
  if (!input.silent) {
    for (const [name, sink] of sinks) {
      if (input.sinks && !input.sinks.includes(name)) continue;
      try {
        await sink(item, input);
      } catch (e) {
        console.warn('[FunPro] notification sink failed', name, e instanceof Error ? e.message : e);
      }
    }
  }
  return item;
}

/** Drops expired dedupe markers so db.kv does not grow without bound. */
export async function pruneNotificationDedupe(now = Date.now()): Promise<number> {
  const db = getDb();
  const keys = await db.kv
    .where('key')
    .startsWith(DEDUPE_PREFIX)
    .filter((r) => typeof r.value !== 'number' || now - r.value >= DEDUPE_WINDOW_MS)
    .primaryKeys();
  await db.kv.bulkDelete(keys);
  return keys.length;
}
