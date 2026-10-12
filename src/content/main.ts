import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { FunPayActions, FunPayTransport, funpayParser, type PageSession } from '@/adapters/funpay';
import { rpc } from '@/core/messaging/client';
import { CONTENT_COMMAND_TAG } from '@/core/messaging/protocol';
import { mirrorMinGap, readPageMirror } from '@/core/settings/page-mirror';
import { createExecutor, stripCsrf } from './executor';
import { ingestCurrentPage } from './page-ingest';
import { mountEnhancements } from './enhancements';

export async function startContent(ctx: ContentScriptContext): Promise<void> {
  let session: PageSession = funpayParser.parseSession(document);
  // The request spacing is user-configurable (Settings → Automation); never below the 1 s floor
  // enforced by the settings schema. A changed value applies to tabs opened/reloaded afterwards.
  // Read from the page mirror: content scripts have no access to the full settings.
  const minGapMs = mirrorMinGap(await readPageMirror().catch(() => null));
  const transport = new FunPayTransport({ minGapMs });
  const actions = new FunPayActions(
    transport,
    () => session.csrfToken,
    () => session.userId,
  );
  const executor = createExecutor(() => session, actions);

  // Commands from the background (validated: must come from our own extension, not a tab).
  const onMessage = (
    message: unknown,
    sender: { id?: string; tab?: unknown },
    sendResponse: (r: unknown) => void,
  ) => {
    if (sender.id !== browser.runtime.id || sender.tab) return false;
    const m = message as { tag?: unknown; cmd?: unknown } | null;
    if (!m || m.tag !== CONTENT_COMMAND_TAG) return false;
    void executor.handle(m.cmd).then(sendResponse);
    return true;
  };
  browser.runtime.onMessage.addListener(onMessage);
  ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));

  const hello = async () => {
    session = funpayParser.parseSession(document);
    await rpc('cs.hello', { url: location.href, session: stripCsrf(session) }).catch(() => undefined);
  };
  await hello();
  // Re-announce periodically so the background knows this tab is alive (cheap: no network).
  ctx.setInterval(() => void hello(), 60_000);

  // Defer passive parsing until the browser is idle to avoid competing with FunPay's rendering.
  const idle = (cb: () => void) =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(cb, { timeout: 3000 })
      : setTimeout(cb, 500);
  idle(() => void ingestCurrentPage(document, location, session.userId));

  await mountEnhancements(ctx, () => session);
}
