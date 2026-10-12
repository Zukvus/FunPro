import { browser } from 'wxt/browser';
import { storage } from 'wxt/utils/storage';
import { CONTENT_COMMAND_TAG, type ContentCommand } from '@/core/messaging/protocol';
import type { SessionInfo } from '@/shared/session';

/**
 * FunPay tab registry. Stored in `storage.session` so it survives service-worker restarts (but not
 * browser restarts, when tabs are gone anyway). Contains no credentials. On Chrome FunPro's content
 * scripts can read storage.session (see core/settings/page-mirror): keep it to what FunPay shows.
 */
export interface TrackedTab {
  tabId: number;
  url: string;
  session: SessionInfo;
  lastSeen: number;
}

const tabsItem = storage.defineItem<Record<string, TrackedTab>>('session:funpayTabs', { fallback: {} });
const lastSessionItem = storage.defineItem<SessionInfo | null>('local:lastSession', { fallback: null });

export async function registerTab(tabId: number, url: string, session: SessionInfo): Promise<void> {
  const tabs = await tabsItem.getValue();
  tabs[String(tabId)] = { tabId, url, session, lastSeen: Date.now() };
  await tabsItem.setValue(tabs);
  await lastSessionItem.setValue(session);
}

export async function forgetTab(tabId: number): Promise<void> {
  const tabs = await tabsItem.getValue();
  if (tabs[String(tabId)]) {
    delete tabs[String(tabId)];
    await tabsItem.setValue(tabs);
  }
}

export async function listTabs(): Promise<TrackedTab[]> {
  return Object.values(await tabsItem.getValue());
}

export async function getLastSession(): Promise<SessionInfo | null> {
  return lastSessionItem.getValue();
}

/** Pick the most recently active logged-in FunPay tab that still exists. */
export async function pickExecutionTab(): Promise<TrackedTab | null> {
  const tabs = (await listTabs())
    .filter((t) => t.session.status === 'logged_in')
    .sort((a, b) => b.lastSeen - a.lastSeen);
  for (const t of tabs) {
    try {
      const tab = await browser.tabs.get(t.tabId);
      if (tab && tab.url && /^https:\/\/funpay\.com\//.test(tab.url)) return t;
    } catch {
      /* closed */
    }
    await forgetTab(t.tabId);
  }
  return null;
}

export class NoFunPayTabError extends Error {
  constructor() {
    super('No logged-in FunPay tab is open. Open funpay.com to let FunPro act.');
    this.name = 'NoFunPayTabError';
  }
}

/** Execute a command in a FunPay tab's content script and return its (already-validated) result. */
export async function execInFunPayTab<T = unknown>(cmd: ContentCommand): Promise<T> {
  const tab = await pickExecutionTab();
  if (!tab) throw new NoFunPayTabError();
  const res = (await browser.tabs.sendMessage(tab.tabId, { tag: CONTENT_COMMAND_TAG, cmd })) as
    { ok: true; data: T } | { ok: false; error: string; code?: string } | undefined;
  if (!res) throw new Error('FunPay tab did not respond (reload the tab)');
  if (!res.ok) {
    const err = new Error(res.error);
    (err as Error & { code?: string }).code = res.code;
    throw err;
  }
  return res.data;
}
