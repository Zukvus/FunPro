import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ordersModule } from '@/background/modules/orders';
import { dispatch } from '@/background/router';
import { getDb, resetDbForTests } from '@/core/db/db';
import { getSettings, updateSettings } from '@/core/settings/store';
import { privacyStylesheet } from '@/features/appearance/funpay-css';
import type { SalesPanelResponse } from '@/features/orders/sales-panel-schema';
import { mkOrder, money } from '../features/analytics/dataset';

const SALES_URL = 'https://funpay.com/orders/trade';
const contentScript = { id: browser.runtime.id, url: SALES_URL, tab: { id: 7, url: SALES_URL } };
const extensionPage = { id: browser.runtime.id, url: browser.runtime.getURL('/options.html') };
const call = (method: string, params: unknown, sender: object = contentScript) =>
  dispatch({ __funpro: 1, method, params }, sender as never);

type StatsAnswer = { ok: true; data: SalesPanelResponse };

const recent = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

beforeAll(() => ordersModule.register());
beforeEach(async () => {
  resetDbForTests();
  await getDb().orders.bulkAdd([
    mkOrder({ id: 'S0000001', createdAt: recent(1), status: 'closed', price: money(25000) }),
    mkOrder({ id: 'S0000002', createdAt: recent(2), status: 'paid', price: money(1000, 'USD') }),
    mkOrder({ id: 'P0000001', direction: 'purchase', createdAt: recent(1), price: money(99900) }),
  ]);
});

describe('sales statistics panel messages', () => {
  it('answers FunPro’s content script with aggregates of stored sales', async () => {
    const res = (await call('cs.salesPanel.stats', {})) as StatsAnswer;
    expect(res.ok).toBe(true);
    expect(res.data.prefs).toEqual({ enabled: true, collapsed: false, period: '30d' });
    expect(res.data.data).toMatchObject({ orders: 2, closed: 1, pending: 1 });
    expect(res.data.importStatus).toBeNull();
    // A different period for this request only; the saved one stays.
    const week = (await call('cs.salesPanel.stats', { period: '7d' })) as StatsAnswer;
    expect(week.data.prefs.period).toBe('7d');
    expect((await getSettings()).analytics.salesPagePanel.period).toBe('30d');
  });

  it('only accepts calls from the content script', async () => {
    expect(await call('cs.salesPanel.stats', {}, extensionPage)).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });

  it('is off when switched off or when on-page helpers are disabled', async () => {
    await updateSettings({ analytics: { salesPagePanel: { enabled: false } } });
    expect(await call('cs.salesPanel.stats', {})).toMatchObject({
      ok: true,
      data: { prefs: { enabled: false }, data: null },
    });
    await updateSettings({
      analytics: { salesPagePanel: { enabled: true } },
      flags: { funpayEnhancements: false },
    });
    expect(await call('cs.salesPanel.stats', {})).toMatchObject({ data: { prefs: { enabled: false } } });
  });

  it('saves the panel preferences; the page can hide it but never re-enable it', async () => {
    await call('cs.salesPanel.setPrefs', { period: '90d', collapsed: true });
    expect((await getSettings()).analytics.salesPagePanel).toEqual({
      enabled: true,
      collapsed: true,
      period: '90d',
    });
    await call('cs.salesPanel.setPrefs', { enabled: false });
    expect((await getSettings()).analytics.salesPagePanel.enabled).toBe(false);
    expect(await call('cs.salesPanel.setPrefs', { enabled: true })).toMatchObject({
      ok: false,
      code: 'invalid_params',
    });
  });

  it('opens only the dashboard pages it names', async () => {
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    expect(await call('cs.openDashboard', { page: 'analytics' })).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledWith({ url: browser.runtime.getURL('/options.html#/analytics') });
    expect(await call('cs.openDashboard', { page: 'https://evil.example' })).toMatchObject({
      ok: false,
      code: 'invalid_params',
    });
  });

  it('starts the history import only with a logged-in FunPay tab', async () => {
    expect(await call('cs.salesPanel.importHistory', {})).toMatchObject({ ok: false, code: 'awaiting_tab' });
  });
});

describe('privacy mode on FunPro’s own on-page widgets', () => {
  it('blurs names in privacy mode and money also with "hide balances"', () => {
    const css = privacyStylesheet();
    expect(css).toContain("html[data-fp-privacy='on'] [data-funpro-private]");
    expect(css).toContain("html[data-fp-hide-balances='on'] [data-funpro-private='money']");
    expect(css).toContain("html[data-fp-privacy='on'] [data-funpro-private]:hover");
  });
});
