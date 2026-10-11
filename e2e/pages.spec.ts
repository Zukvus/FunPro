import { mkdirSync } from 'node:fs';
import { expect, fixture, mockFunPay, test } from './fixtures';

/**
 * Smoke test: every dashboard page renders in a real extension page without uncaught errors.
 * Screenshots are written to test-results/pages/ for visual review (not compared).
 */
const PAGES = [
  'overview',
  'listings',
  'orders',
  'messages',
  'reviews',
  'customers',
  'inventory',
  'analytics',
  'finance',
  'pricing',
  'ai',
  'automation',
  'rules',
  'notifications',
  'integrations',
  'appearance',
  'privacy',
  'logs',
  'about',
  'welcome',
];

test('every dashboard page renders without runtime errors', async ({ context, page, extensionId }) => {
  mkdirSync('test-results/pages', { recursive: true });
  // Seed local data the way a seller would: by opening their FunPay pages (network mocked).
  await mockFunPay(context, {
    '/orders/trade': fixture('sales.html'),
    '/lots/501/trade': fixture('own-lots.html'),
    '/users/1000001/': fixture('profile.html'),
    '/account/balance': fixture('balance.html'),
    '/lots/501/': fixture('public-node.html'),
  });
  const fp = await context.newPage();
  for (const path of [
    '/orders/trade',
    '/lots/501/trade',
    '/users/1000001/',
    '/account/balance',
    '/lots/501/',
  ]) {
    await fp.goto(`https://funpay.com${path}`);
    await fp.waitForTimeout(700);
  }
  await fp.close();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${page.url()}: console: ${m.text()}`);
  });
  await page.setViewportSize({ width: 1360, height: 900 });
  for (const p of PAGES) {
    await page.goto(`chrome-extension://${extensionId}/options.html#/${p}`);
    await expect(page.locator('main h1, main [role="heading"], main h2').first()).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/pages/${p}.png` });
  }
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.setViewportSize({ width: 380, height: 600 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/pages/popup.png' });
  expect(errors).toEqual([]);
});
