/** Per-kind delivery preferences (desktop popups and sounds). */
import type { Settings } from '@/core/settings/schema';
import type { NotificationKind } from './notify';

export function desktopEnabledFor(settings: Settings, kind: NotificationKind): boolean {
  const n = settings.notifications;
  if (!n.desktop) return false;
  switch (kind) {
    case 'order':
      return n.onOrder;
    case 'message':
      return n.onMessage;
    case 'review':
      return n.onReview;
    case 'failure':
      return n.onFailure;
    case 'inventory':
      return n.onInventory;
    case 'price':
      return n.onPrice;
    case 'bump':
      return n.onBump;
    case 'system':
      return true;
  }
}

export function soundEnabledFor(settings: Settings, kind: NotificationKind): boolean {
  const n = settings.notifications;
  return n.sound && n.volume > 0 && n.soundKinds[kind];
}

/** Sound id configured for a kind: orders, messages and reviews have their own; the rest share one. */
export function soundIdFor(settings: Settings, kind: NotificationKind): string {
  const n = settings.notifications;
  switch (kind) {
    case 'order':
      return n.orderSound;
    case 'message':
      return n.messageSound;
    case 'review':
      return n.reviewSound;
    default:
      return n.alertSound;
  }
}
