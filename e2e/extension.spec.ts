import { expect, fixture, mockFunPay, test } from './fixtures';

/** Minimal typing for the extension APIs used inside page/service-worker evaluations. */
declare const chrome: {
  runtime: { getManifest(): { manifest_version: number; host_permissions?: string[]; permissions?: string[] } };
  storage: { local: { get(key: string): Promise<Record<string, { automation?: { state?: string } } | undefined>> } };
};

test.describe('extension startup', () => {
  test('service worker starts and the manifest is least-privilege', async ({ context, extensionId }) => {
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const [sw] = context.serviceWorkers();
    const manifest = await sw!.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.host_permissions).toEqual(['https://funpay.com/*']);
    expect(manifest.permissions).not.toContain('cookies');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('webRequest');
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
    await page.getByRole('button', { name: /emergency stop/i }).first().click();
    await expect(page.getByText(/Emergency stop active/i).first()).toBeVisible();
    const state = await page.evaluate(async () => (await chrome.storage.local.get('settings'))['settings']?.automation?.state);
    expect(state).toBe('stopped');
  });
});

test.describe('FunPay integration (mocked network)', () => {
  test('detects the session and ingests sales from the page the seller opens', async ({ context, page, extensionId }) => {
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
    const hits = await mockFunPay(context, { '/orders/trade': fixture('sales.html'), '/': fixture('sales.html') });
    await page.goto('https://funpay.com/orders/trade');
    await page.waitForTimeout(2000);
    expect(hits.some((h) => /withdraw|refund|switchCurrency|logout/.test(h))).toBe(false);
  });
});
