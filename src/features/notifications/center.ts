/** Notification center operations (db.notifications) used by the Notifications page. */
import { getDb } from '@/core/db/db';
import type { NotificationItem } from '@/shared/models';
import type { NotificationKind } from './notify';

export interface CenterFilter {
  query: string;
  kind: NotificationKind | 'all';
  unreadOnly: boolean;
}

export function filterNotifications(items: readonly NotificationItem[], f: CenterFilter): NotificationItem[] {
  const q = f.query.trim().toLowerCase();
  return items.filter((n) => {
    if (f.kind !== 'all' && n.kind !== f.kind) return false;
    if (f.unreadOnly && n.read) return false;
    if (q && !`${n.title}\n${n.body}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export async function markNotificationRead(id: string, read = true): Promise<void> {
  await getDb().notifications.update(id, { read });
}

/** Booleans are not valid IndexedDB keys (the `read` index stays empty), so this is a bounded scan (≤ 1000 rows). */
export async function markAllNotificationsRead(): Promise<number> {
  return getDb()
    .notifications.filter((n) => !n.read)
    .modify({ read: true });
}

export async function clearNotifications(kind: NotificationKind | 'all' = 'all'): Promise<number> {
  const db = getDb();
  if (kind === 'all') {
    const n = await db.notifications.count();
    await db.notifications.clear();
    return n;
  }
  return db.notifications.where('kind').equals(kind).delete();
}

export async function unreadCount(): Promise<number> {
  return getDb().notifications.filter((n) => !n.read).count();
}
