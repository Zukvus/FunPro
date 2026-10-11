import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { PageSession } from '@/adapters/funpay';

/**
 * On-page helpers mounted into funpay.com. Each enhancement is isolated, cleans up on context
 * invalidation (extension update/reload) and never blocks page rendering.
 */
export async function mountEnhancements(_ctx: ContentScriptContext, _getSession: () => PageSession): Promise<void> {
  // Enhancements are registered here (see src/content/enhancements/*).
}
