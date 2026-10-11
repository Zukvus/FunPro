import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { PageSession } from '@/adapters/funpay';
import { mountAppearanceEnhancements } from './appearance';
import { mountListingsEnhancements } from './listings';
import { mountMessagingEnhancements } from './messaging';
import { mountOrdersEnhancements } from './orders';

/**
 * On-page helpers mounted into funpay.com. Each enhancement is isolated (a failure in one never
 * breaks the others), cleans up on context invalidation and never blocks page rendering.
 */
export async function mountEnhancements(ctx: ContentScriptContext, getSession: () => PageSession): Promise<void> {
  const mounts = [mountAppearanceEnhancements, mountListingsEnhancements, mountMessagingEnhancements, mountOrdersEnhancements];
  await Promise.all(
    mounts.map((m) =>
      m(ctx, getSession).catch((e: unknown) => {
        console.warn('[FunPro] enhancement failed', e instanceof Error ? e.message : e);
      }),
    ),
  );
}
