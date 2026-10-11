import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const EXT_PATH = resolve(HERE, '..', '.output', 'chrome-mv3');
const FIXTURES = resolve(HERE, '..', 'tests', 'fixtures', 'funpay');

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** Route every funpay.com request to fixtures; anything unknown gets a 404 (never the real site). */
export async function mockFunPay(context: BrowserContext, routes: Record<string, string>): Promise<string[]> {
  const hits: string[] = [];
  await context.route('https://funpay.com/**', async (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname}`;
    hits.push(key);
    const body = routes[key] ?? routes[url.pathname];
    if (body === undefined) return route.fulfill({ status: 404, body: 'not mocked' });
    const isJson = body.trimStart().startsWith('{');
    return route.fulfill({
      status: 200,
      contentType: isJson ? 'application/json' : 'text/html; charset=utf-8',
      body,
    });
  });
  return hits;
}

export const test = base.extend<{ context: BrowserContext; extensionId: string; page: Page }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!existsSync(join(EXT_PATH, 'manifest.json')))
      throw new Error('Build the extension first: pnpm build');
    // Set PW_CHROMIUM_PATH to use a preinstalled Chromium whose revision differs from Playwright's.
    const executablePath = process.env.PW_CHROMIUM_PATH;
    const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'funpro-e2e-')), {
      headless: true,
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent('serviceworker');
    await use(new URL(sw.url()).host);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },
});

export const expect = test.expect;
