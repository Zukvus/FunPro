import { expect, type BrowserContext, type CDPSession, type Page, type Worker } from '@playwright/test';
import { fixture, mockFunPay, test } from './fixtures';

declare const chrome: {
  storage: {
    local: { set(v: object): Promise<void>; get(k: string | null): Promise<Record<string, unknown>> };
    session: { get(k: string): Promise<Record<string, unknown>> };
  };
};

async function serviceWorker(context: BrowserContext): Promise<Worker> {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  await expect.poll(() => sw.evaluate(() => typeof chrome?.storage?.local?.get)).toBe('function');
  return sw;
}

/** Runs an expression in FunPro's content-script world on the page (Chrome DevTools Protocol). */
async function contentWorld(context: BrowserContext, page: Page) {
  const cdp: CDPSession = await context.newCDPSession(page);
  const worlds: { id: number; name: string; auxData?: { type?: string } }[] = [];
  cdp.on('Runtime.executionContextCreated', (e: { context: (typeof worlds)[number] }) =>
    worlds.push(e.context),
  );
  await cdp.send('Runtime.enable');
  return async (expression: string): Promise<unknown> => {
    const world = worlds.filter((w) => w.auxData?.type === 'isolated' && w.name.startsWith('FunPro')).at(-1);
    if (!world) return 'no content script world';
    const res = (await cdp.send('Runtime.evaluate', {
      contextId: world.id,
      awaitPromise: true,
      expression,
    })) as {
      result?: { value?: unknown };
    };
    return res.result?.value;
  };
}

test('content scripts cannot read settings storage; the page mirror reaches them live', async ({
  context,
  page,
}) => {
  const sw = await serviceWorker(context);
  await sw.evaluate(() =>
    chrome.storage.local.set({
      settings: { privacy: { privacyMode: true }, telegram: { chatId: 'CANARY-CHAT' } },
    }),
  );
  await expect
    .poll(() =>
      sw.evaluate(async () => {
        const m = (await chrome.storage.session.get('pageMirror'))['pageMirror'] as
          { privacy?: { privacyMode?: boolean } } | undefined;
        return m?.privacy?.privacyMode;
      }),
    )
    .toBe(true);

  const evaluate = await contentWorld(context, page);
  await mockFunPay(context, { '/': fixture('profile.html') });
  await page.goto('https://funpay.com/');

  // storage.local (all settings, incl. the Telegram chat id canary) is closed to the content script…
  await expect
    .poll(() =>
      evaluate(
        `chrome.storage.local.get(null).then((v) => JSON.stringify(v), (e) => 'denied: ' + e.message)`,
      ),
    )
    .toMatch(/^denied: /);
  // …which reads only the page mirror from storage.session.
  const mirror = await evaluate(`chrome.storage.session.get('pageMirror').then((v) => JSON.stringify(v))`);
  expect(mirror).toContain('"privacyMode":true');
  expect(mirror).not.toContain('CANARY-CHAT');

  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-fp-privacy')))
    .toBe('on');
  // A settings change reaches the open page through the mirror.
  await sw.evaluate(() => chrome.storage.local.set({ settings: { privacy: { privacyMode: false } } }));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-fp-privacy')))
    .toBe(false);
});
