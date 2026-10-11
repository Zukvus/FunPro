import { defineConfig } from '@playwright/test';

/**
 * E2E tests load the production build from .output/chrome-mv3 (run `pnpm build` first).
 * FunPay is never contacted: every https://funpay.com request is intercepted and served from
 * sanitized fixtures (tests/fixtures/funpay).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
});
