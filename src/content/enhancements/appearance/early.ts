import { getSettings } from '@/core/settings/store';
import { privacyStylesheet, PRIVACY_STYLE_ID, ROOT_ATTR } from '@/features/appearance/funpay-css';

/**
 * Privacy blur before FunPay renders anything. Meant for a tiny content script registered with
 * `runAt: 'document_start'` (the main FunPro content script runs at document_idle, after the first
 * paint, so names/balances could flash unblurred during a stream). Reads storage.local directly
 * (fast, no service-worker wake-up). The main appearance controller later takes over the same
 * <style> element and attributes and keeps them in sync with settings.
 */
export async function primeFunPayPrivacy(doc: Document = document): Promise<boolean> {
  const s = await getSettings();
  const privacy = s.privacy.privacyMode;
  const balances = s.privacy.hideBalances || privacy;
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
