/**
 * Notification fan-out. `notify()` records an entry in the notification center and forwards it to
 * registered sinks (desktop notifications, sounds, Telegram). Sinks are registered by background
 * modules; failures in one sink never affect the others.
 */
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import type { NotificationItem } from '@/shared/models';

export type NotificationKind = NotificationItem['kind'];

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  url?: string | null;
  /** Dedupe key: the same key within 24h is not notified twice. */
  dedupeKey?: string;
  /** Suppress sinks (only record in the notification center). */
  silent?: boolean;
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

export async function notify(input: NotifyInput): Promise<NotificationItem | null> {
  const db = getDb();
  if (input.dedupeKey) {
    const key = `notif:${input.dedupeKey}`;
    const seen = await db.kv.get(key);
    if (seen && typeof seen.value === 'number' && Date.now() - seen.value < 24 * 3600_000) return null;
    await db.kv.put({ key, value: Date.now() });
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
    const old = await db.notifications.orderBy('at').limit(count - MAX_CENTER_ITEMS).primaryKeys();
    await db.notifications.bulkDelete(old);
  }
  if (!input.silent) {
    for (const [name, sink] of sinks) {
      try {
        await sink(item, input);
      } catch (e) {
        console.warn('[FunPro] notification sink failed', name, e instanceof Error ? e.message : e);
      }
    }
  }
  return item;
}
