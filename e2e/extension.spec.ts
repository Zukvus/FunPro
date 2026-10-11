import type { Page } from '@playwright/test';
import { expect, fixture, mockFunPay, test } from './fixtures';

/** Minimal typing for the extension APIs used inside page/service-worker evaluations. */
declare const chrome: {
  runtime?: {
    getManifest(): { manifest_version: number; host_permissions?: string[]; permissions?: string[] };
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, { automation?: { state?: string } } | undefined>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

test.describe('extension startup', () => {
  test('service worker starts and the manifest is least-privilege', async ({ context, extensionId }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const sw = context
      .serviceWorkers()
      .find((w) => w.url().startsWith(`chrome-extension://${extensionId}/`))!;
    // Extension bindings are attached shortly after the worker script starts; wait for them.
    await expect
      .poll(() => sw.evaluate(() => typeof chrome.runtime?.getManifest === 'function'), { timeout: 10_000 })
      .toBe(true);
    const manifest = await sw.evaluate(() => chrome.runtime!.getManifest());
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toEqual(['https://funpay.com/*']);
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('webRequest');
    expect(manifest.permissions).not.toContain('scripting');
  });

  test('popup renders with honest empty state', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.getByText('FunPro').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /emergency stop/i })).toBeVisible();
  });

  test('dashboard renders and navigates', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html#/overview`);
    await expect(page.getByLabel('Main navigation')).toBeVisible();
    await page.getByRole('link', { name: 'Listings' }).click();
    await expect(page).toHaveURL(/#\/listings/);
  });

  test('emergency stop halts automation from the dashboard', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html#/overview`);
    await page
      .getByRole('button', { name: /emergency stop/i })
      .first()
      .click();
    await expect(page.getByText(/Emergency stop active/i).first()).toBeVisible();
    const state = await page.evaluate(
      async () => (await chrome.storage.local.get('settings'))['settings']?.automation?.state,
    );
    expect(state).toBe('stopped');
  });
});

test.describe('FunPay integration (mocked network)', () => {
  test('detects the session and ingests sales from the page the seller opens', async ({
    context,
    page,
    extensionId,
  }) => {
    await mockFunPay(context, { '/orders/trade': fixture('sales.html') });
    await page.goto('https://funpay.com/orders/trade');
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/options.html#/overview`);
    await expect(dash.getByText(/SellerOne/).first()).toBeVisible({ timeout: 15_000 });
    // Orders were stored in the extension's IndexedDB.
    await expect
      .poll(
        () =>
          dash.evaluate(
            () =>
              new Promise<number>((resolve) => {
                const req = indexedDB.open('funpro');
                req.onsuccess = () => {
                  const tx = req.result.transaction('orders', 'readonly');
                  const c = tx.objectStore('orders').count();
                  c.onsuccess = () => resolve(c.result);
                };
                req.onerror = () => resolve(-1);
              }),
          ),
        { timeout: 15_000 },
      )
      .toBe(3);
  });

  test('never requests money-moving endpoints', async ({ context, page }) => {
    const hits = await mockFunPay(context, {
      '/orders/trade': fixture('sales.html'),
      '/': fixture('sales.html'),
    });
    await page.goto('https://funpay.com/orders/trade');
    await page.waitForTimeout(2000);
    expect(hits.some((h) => /withdraw|refund|switchCurrency|logout/.test(h))).toBe(false);
  });
});

test.describe('on-page features (mocked network)', () => {
  async function idbCount(page: Page, store: string): Promise<number> {
    return page.evaluate(
      (name) =>
        new Promise<number>((resolve) => {
          const req = indexedDB.open('funpro');
          req.onsuccess = () => {
            const c = req.result.transaction(name, 'readonly').objectStore(name).count();
            c.onsuccess = () => resolve(c.result);
          };
          req.onerror = () => resolve(-1);
        }),
      store,
    );
  }

  test('privacy mode blurs buyer names and balances on funpay.com from the first paint', async ({
    context,
    page,
    extensionId,
  }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html#/privacy`);
    await page.evaluate(async () => {
      const cur = ((await chrome.storage.local.get('settings'))['settings'] ?? {}) as Record<string, unknown>;
      await chrome.storage.local.set({ settings: { ...cur, privacy: { privacyMode: true } } });
    });
    await mockFunPay(context, { '/orders/trade': fixture('sales.html') });
    const fp = await context.newPage();
    await fp.goto('https://funpay.com/orders/trade');
    await expect(fp.locator('#funpro-privacy-style')).toHaveCount(1);
    await expect
      .poll(() => fp.evaluate(() => document.documentElement.getAttribute('data-fp-privacy')))
      .toBe('on');
    const filter = await fp
      .locator('.tc-order')
      .first()
      .evaluate((el) => getComputedStyle(el).filter);
    expect(filter).toContain('blur');
  });

  test('discovers the raise target when the seller opens their own lots page', async ({
    context,
    page,
    extensionId,
  }) => {
    await mockFunPay(context, { '/lots/501/trade': fixture('own-lots.html') });
    await page.goto('https://funpay.com/lots/501/trade');
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/options.html#/listings`);
    await expect.poll(() => idbCount(dash, 'listings'), { timeout: 15_000 }).toBe(2);
    await expect.poll(() => idbCount(dash, 'bumpState'), { timeout: 15_000 }).toBe(1);
  });
});
