/**
 * Desktop (OS) notification sink. Browser APIs are injected so the logic is testable; the
 * background module wires `browser.notifications` and a `storage.session` click-target store
 * (notification id → URL), which survives service-worker restarts but not browser restarts.
 */
import type { Settings } from '@/core/settings/schema';
import { safeFunPayUrl } from '@/core/security/sanitize';
import type { NotificationSink } from './notify';
import { desktopEnabledFor } from './prefs';

export interface DesktopNotificationOptions {
  type: 'basic';
  iconUrl: string;
  title: string;
  message: string;
  priority?: number;
  silent?: boolean;
}

export interface DesktopNotificationsApi {
  create(id: string, options: DesktopNotificationOptions): Promise<string>;
  clear(id: string): Promise<boolean>;
}

export interface ClickTarget {
  url: string;
  at: number;
}

export interface ClickTargetStorage {
  getValue(): Promise<Record<string, ClickTarget>>;
  setValue(value: Record<string, ClickTarget>): Promise<void>;
}

export interface ClickTargetStore {
  remember(id: string, url: string, now?: number): Promise<void>;
  take(id: string): Promise<string | null>;
  forget(id: string): Promise<void>;
}

/** Bounded (newest `max` entries, `maxAgeMs`) and serialised so concurrent writes are not lost. */
export function createClickTargetStore(
  storage: ClickTargetStorage,
  max = 50,
  maxAgeMs = 24 * 3600_000,
): ClickTargetStore {
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
  return {
    remember: (id, url, now = Date.now()) =>
      run(async () => {
        const map = { ...(await storage.getValue()) };
        map[id] = { url, at: now };
        const kept = Object.entries(map)
          .filter(([, v]) => now - v.at < maxAgeMs)
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, max);
        await storage.setValue(Object.fromEntries(kept));
      }),
    take: (id) =>
      run(async () => {
        const map = { ...(await storage.getValue()) };
        const hit = map[id];
        if (!hit) return null;
        delete map[id];
        await storage.setValue(map);
        return hit.url;
      }),
    forget: (id) =>
      run(async () => {
        const map = { ...(await storage.getValue()) };
        if (!(id in map)) return;
        delete map[id];
        await storage.setValue(map);
      }),
  };
}

/** Only absolute https://funpay.com URLs and FunPro's own pages may be opened from a notification. */
export function openableUrl(url: string | null | undefined, extensionOrigin: string): string | null {
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return safeFunPayUrl(url);
  if (extensionOrigin && url.startsWith(`${extensionOrigin}/`)) return url;
  return null;
}

export interface DesktopSinkDeps {
  api: DesktopNotificationsApi;
  getSettings(): Promise<Settings>;
  iconUrl: string;
  clickStore: ClickTargetStore;
  extensionOrigin: string;
  /** Chrome supports `silent`/`priority`; Firefox rejects unknown notification options. */
  chromeOptions: boolean;
}

export function createDesktopSink(deps: DesktopSinkDeps): NotificationSink {
  return async (item) => {
    const settings = await deps.getSettings();
    if (!desktopEnabledFor(settings, item.kind)) return;
    const options: DesktopNotificationOptions = {
      type: 'basic',
      iconUrl: deps.iconUrl,
      title: item.title.slice(0, 120) || 'FunPro',
      message: item.body.slice(0, 300),
    };
    if (deps.chromeOptions) {
      // FunPro plays its own sounds (separately configurable), so the OS sound is muted.
      options.silent = true;
      options.priority = item.kind === 'order' || item.kind === 'failure' ? 2 : 0;
    }
    const target = openableUrl(item.url, deps.extensionOrigin);
    if (target) await deps.clickStore.remember(item.id, target);
    await deps.api.create(item.id, options);
  };
}

export interface DesktopClickDeps {
  clickStore: ClickTargetStore;
  api: Pick<DesktopNotificationsApi, 'clear'>;
  openUrl(url: string): Promise<void>;
  extensionOrigin: string;
}

/** notifications.onClicked: open the mapped URL (validated again) and dismiss the notification. */
export async function handleDesktopClick(id: string, deps: DesktopClickDeps): Promise<boolean> {
  const url = openableUrl(await deps.clickStore.take(id), deps.extensionOrigin);
  await deps.api.clear(id).catch(() => false);
  if (!url) return false;
  await deps.openUrl(url);
  return true;
}
