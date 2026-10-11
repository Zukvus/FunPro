import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { PageSession } from '@/adapters/funpay';
import { isFlagEnabled } from '@/core/flags/flags';
import { rpc } from '@/core/messaging/client';
import { ChatComposerEnhancer, type ComposerConfig } from './messaging/composer';
import { findComposer, h, isChatPath } from './messaging/dom';
import { resolvePageLang } from './messaging/strings';
import { CLS, STYLE } from './messaging/styles';

const RETRY_DELAYS_MS = [300, 700, 1500, 3000, 6000, 12000];

interface PageConfig {
  language?: string;
  flags?: Record<string, boolean>;
  recentEmojis?: string[];
}

/**
 * funpay.com chat helpers: slash-command templates and an emoji picker next to the chat box.
 * FunPro never sends from the page — it only edits the text box; the seller presses Send.
 *
 * Lifecycle: mounted on /chat/ pages only; the only observers watch the chat form and its
 * container (to re-bind when FunPay re-renders the form); everything is removed when the
 * content-script context is invalidated.
 */
export async function mountMessagingEnhancements(ctx: ContentScriptContext, getSession: () => PageSession): Promise<void> {
  const doc = document;
  let current: ChatComposerEnhancer | null = null;
  let observers: MutationObserver[] = [];
  let config: (ComposerConfig & { enabled: boolean }) | null = null;
  let style: HTMLStyleElement | null = null;
  let attempt = 0;
  let mounting = false;

  const teardown = () => {
    for (const o of observers) o.disconnect();
    observers = [];
    current?.unmount();
    current = null;
  };

  const loadConfig = async () => {
    const cfg = await rpc<PageConfig>('cs.getPageConfig', {}).catch(() => null);
    return {
      enabled: isFlagEnabled('funpayEnhancements', cfg?.flags ?? {}),
      lang: resolvePageLang(cfg?.language, getSession().locale),
      recentEmojis: Array.isArray(cfg?.recentEmojis) ? cfg.recentEmojis.filter((e) => typeof e === 'string') : [],
    };
  };

  const watch = (target: Node, options: MutationObserverInit) => {
    const o = new MutationObserver(() => {
      if (current && !current.connected) void tryMount();
    });
    o.observe(target, options);
    observers.push(o);
  };

  async function tryMount(): Promise<void> {
    if (ctx.isInvalid || mounting) return;
    if (!isChatPath(location.pathname)) {
      teardown();
      return;
    }
    if (current?.connected) return;
    teardown();
    const found = findComposer(doc);
    if (!found) {
      // The chat box may render after the page (or not at all on the bare chat list).
      const delay = RETRY_DELAYS_MS[attempt++];
      if (delay !== undefined) ctx.setTimeout(() => void tryMount(), delay);
      return;
    }
    attempt = 0;
    mounting = true;
    try {
      config ??= await loadConfig();
    } finally {
      mounting = false;
    }
    if (!config.enabled || ctx.isInvalid || !found.textarea.isConnected) return;
    if (!style?.isConnected) {
      style = h(doc, 'style', { id: CLS.style });
      style.textContent = STYLE;
      (doc.head ?? doc.documentElement).append(style);
    }
    current = new ChatComposerEnhancer(ctx, found, getSession, config);
    current.mount();
    if (found.form.parentElement) watch(found.form.parentElement, { childList: true });
    watch(found.form, { childList: true, subtree: true });
  }

  ctx.addEventListener(window, 'wxt:locationchange', () => {
    attempt = 0;
    void tryMount();
  });
  // Cheap safety net if FunPay swaps a whole ancestor of the chat box (no observer sees that).
  ctx.setInterval(() => {
    if (current && !current.connected) void tryMount();
  }, 5000);
  ctx.onInvalidated(() => {
    teardown();
    style?.remove();
    style = null;
  });
  await tryMount();
}
