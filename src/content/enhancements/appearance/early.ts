import { browser } from 'wxt/browser';
import { mirrorPrivacy, readPageMirror } from '@/core/settings/page-mirror';
import { privacyStylesheet, PRIVACY_STYLE_ID, ROOT_ATTR } from '@/features/appearance/funpay-css';

/**
 * Right after a browser restart the session mirror may not exist yet (the background writes it as
 * it starts). Ask the background directly then, with a raw RPC envelope (no client code, so this
 * script stays tiny). `cs.getPageConfig` answers with the same `privacy` shape as the mirror.
 */
async function askBackground(timeoutMs = 1500): Promise<Record<string, unknown> | null> {
  try {
    const res = (await Promise.race([
      browser.runtime.sendMessage({ __funpro: 1, method: 'cs.getPageConfig', params: {} }),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ])) as { ok?: unknown; data?: unknown } | null | undefined;
    return res?.ok === true && res.data && typeof res.data === 'object'
      ? (res.data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Privacy blur before FunPay renders anything. Meant for a tiny content script registered with
 * `runAt: 'document_start'` (the main FunPro content script runs at document_idle, after the first
 * paint, so names/balances could flash unblurred during a stream). Reads the page mirror directly
 * (fast, no service-worker wake-up; see core/settings/page-mirror). The main appearance controller
 * later takes over the same <style> element and attributes and keeps them in sync with settings.
 */
export async function primeFunPayPrivacy(doc: Document = document): Promise<boolean> {
  const { privacy, balances } = mirrorPrivacy((await readPageMirror()) ?? (await askBackground()));
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
