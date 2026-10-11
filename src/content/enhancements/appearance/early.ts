import { browser } from 'wxt/browser';
import { privacyStylesheet, PRIVACY_STYLE_ID, ROOT_ATTR } from '@/features/appearance/funpay-css';

/**
 * Reads only the two privacy booleans straight from storage.local (key `settings`, written by
 * core/settings/store.ts). Deliberately avoids the zod settings schema so this document_start
 * script stays tiny; anything that is not literally `true` counts as off.
 */
async function readPrivacyFlags(): Promise<{ privacy: boolean; balances: boolean }> {
  const raw = (await browser.storage.local.get('settings'))['settings'] as
    { privacy?: { privacyMode?: unknown; hideBalances?: unknown } } | null | undefined;
  const privacy = raw?.privacy?.privacyMode === true;
  return { privacy, balances: privacy || raw?.privacy?.hideBalances === true };
}

/**
 * Privacy blur before FunPay renders anything. Meant for a tiny content script registered with
 * `runAt: 'document_start'` (the main FunPro content script runs at document_idle, after the first
 * paint, so names/balances could flash unblurred during a stream). Reads storage.local directly
 * (fast, no service-worker wake-up). The main appearance controller later takes over the same
 * <style> element and attributes and keeps them in sync with settings.
 */
export async function primeFunPayPrivacy(doc: Document = document): Promise<boolean> {
  const { privacy, balances } = await readPrivacyFlags();
  if (!privacy && !balances) return false;
  const root = doc.documentElement;
  if (!doc.getElementById(PRIVACY_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = PRIVACY_STYLE_ID;
    style.setAttribute('data-funpro', 'appearance');
    style.textContent = privacyStylesheet();
    (doc.head ?? root).appendChild(style);
  }
  if (privacy) root.setAttribute(ROOT_ATTR.privacy, 'on');
  if (balances) root.setAttribute(ROOT_ATTR.balances, 'on');
  return true;
}
