import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { PageSession } from '@/adapters/funpay';

/** funpay.com page enhancements for: messaging. Must clean up via ctx (observers, listeners, DOM). */
export async function mountMessagingEnhancements(_ctx: ContentScriptContext, _getSession: () => PageSession): Promise<void> {
  // Implemented in its feature area.
}
