import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { PageSession } from '@/adapters/funpay';
import { rpc } from '@/core/messaging/client';
import { getSettings, watchSettings } from '@/core/settings/store';
import {
  configFromPageConfig,
  configFromSettings,
  FunPayAppearanceController,
  type BackgroundImagePayload,
  type FunPayAppearanceConfig,
} from './appearance/controller';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * funpay.com enhancements for appearance & privacy: privacy mode / hidden balances (blur with
 * hover/focus reveal), own-nickname styling, the extension-only profile badge, the experimental
 * dark theme and the optional background image. Settings changes apply live; everything is
 * removed when the content script context is invalidated.
 */
export async function mountAppearanceEnhancements(
  ctx: ContentScriptContext,
  getSession: () => PageSession,
): Promise<void> {
  const controller = new FunPayAppearanceController(document, {
    getUserId: () => getSession().userId,
    getUsername: () => getSession().username,
    getPath: () => location.pathname,
    prefersDark: () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
    loadBackground: () => rpc<BackgroundImagePayload | null>('cs.getBackgroundImage', {}),
  });

  let initial: FunPayAppearanceConfig | null = null;
  try {
    initial = configFromPageConfig(await withTimeout(rpc('cs.getPageConfig', {}), 1500));
  } catch {
    // Background asleep or unreachable: the same settings are readable from storage.local.
  }
  initial ??= configFromSettings(await getSettings());
  controller.apply(initial);

  const unwatch = watchSettings((s) => controller.apply(configFromSettings(s)));
  ctx.onInvalidated(() => {
    unwatch();
    controller.destroy();
  });
}
