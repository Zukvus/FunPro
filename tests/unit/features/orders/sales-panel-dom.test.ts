import { describe, expect, it, vi } from 'vitest';
import { SEL } from '@/adapters/funpay';
import {
  mountSalesPanel,
  salesPanelAnchor,
  type SalesPanelApi,
} from '@/content/enhancements/orders/sales-panel';
import { SALES_PANEL_STRINGS } from '@/content/enhancements/orders/strings';
import type { SalesPanelPeriod } from '@/core/settings/schema';
import { computeSalesPanel } from '@/features/orders/sales-panel';
import type { SalesPanelResponse } from '@/features/orders/sales-panel-schema';
import { formatMoney } from '@/shared/models/money';
import { loadFixture } from '../../../fixtures';
import { mkOrder, money } from '../analytics/dataset';

const NOW = Date.now();
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const ORDERS = [
  mkOrder({
    id: 'A0000001',
    createdAt: at(1),
    status: 'closed',
    price: money(40000),
    counterpartyId: '1',
    counterpartyName: 'BuyerAlpha',
    description: 'Steam key',
  }),
  mkOrder({
    id: 'A0000002',
    createdAt: at(3),
    status: 'closed',
    price: money(5000, 'USD'),
    counterpartyId: '2',
    counterpartyName: 'BuyerBeta',
    description: 'Gold',
  }),
  mkOrder({
    id: 'A0000003',
    createdAt: at(3),
    status: 'paid',
    price: money(1500),
    counterpartyId: '1',
    counterpartyName: 'BuyerAlpha',
    description: 'Steam key',
  }),
  mkOrder({
    id: 'A0000004',
    createdAt: at(8),
    status: 'refunded',
    price: money(700),
    counterpartyId: '3',
    counterpartyName: 'BuyerGamma',
  }),
];

function response(
  period: SalesPanelPeriod = '30d',
  over: Partial<SalesPanelResponse> = {},
): SalesPanelResponse {
  return {
    prefs: { enabled: true, collapsed: false, period },
    data: computeSalesPanel(ORDERS, period, NOW),
    importStatus: null,
    ...over,
  };
}

function setup(answer: (period?: SalesPanelPeriod) => unknown = (p) => response(p ?? '30d')) {
  const doc = new DOMParser().parseFromString(loadFixture('sales.html'), 'text/html');
  const api = {
    stats: vi.fn(async (p?: SalesPanelPeriod) => answer(p)),
    setPrefs: vi.fn(async () => null),
    importHistory: vi.fn(async () => ({ started: true })),
    openDashboard: vi.fn(async () => null),
  } satisfies SalesPanelApi;
  const anchor = salesPanelAnchor(doc, SEL.row)!;
  return { doc, api, anchor };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('statistics panel on the FunPay sales page', () => {
  it('shows per-currency revenue, counts, a chart and top lists above the order list', async () => {
    const { doc, api, anchor } = setup();
    const panel = mountSalesPanel(doc, anchor, { lang: 'en', api })!;
    await settle();
    expect(anchor.previousElementSibling).toBe(panel.root);
    expect(panel.root.getAttribute('aria-busy')).toBe('false');
    const text = panel.root.textContent!;
    expect(text).toContain('Sales statistics');
    expect(text).toContain(formatMoney({ amountMinor: 40000, currency: 'RUB' }, 'en-US'));
    expect(text).toContain(formatMoney({ amountMinor: 5000, currency: 'USD' }, 'en-US'));
    expect(text).toContain('Closed orders: 2');
    expect(text).toContain('Unique buyers: 3');
    expect(text).toContain('Refund rate: 25%');
    expect(text).toContain('Stored sales: 4');

    // Buyer names and money are marked for privacy mode; product names are not.
    const names = [...panel.root.querySelectorAll('[data-funpro-private="name"]')].map((n) => n.textContent);
    expect(names).toEqual(['BuyerAlpha', 'BuyerBeta']);
    expect(panel.root.querySelectorAll('[data-funpro-private="money"]').length).toBeGreaterThan(4);
    // One bar per day with orders.
    expect(panel.root.querySelectorAll('svg rect')).toHaveLength(3);
    expect(panel.root.querySelector('svg')!.getAttribute('aria-label')).toContain('Total 4');
    expect(api.stats).toHaveBeenCalledWith(undefined);
  });

  it('remembers the period and the collapsed state', async () => {
    const { doc, api, anchor } = setup();
    const panel = mountSalesPanel(doc, anchor, { lang: 'en', api })!;
    await settle();
    const select = panel.root.querySelector('select')!;
    select.value = '7d';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(api.setPrefs).toHaveBeenCalledWith({ period: '7d' });
    expect(api.stats).toHaveBeenLastCalledWith('7d');

    const collapse = [...panel.root.querySelectorAll('button')].find((b) => b.textContent === 'Collapse')!;
    collapse.click();
    expect(panel.root.querySelector<HTMLElement>('.funpro-sales__body')!.hidden).toBe(true);
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    expect(collapse.textContent).toBe('Expand');
    expect(api.setPrefs).toHaveBeenLastCalledWith({ collapsed: true });
  });

  it('starts the history import and follows it until it finishes', async () => {
    let status: SalesPanelResponse['importStatus'] = null;
    const { doc, api, anchor } = setup(() => response('30d', { importStatus: status }));
    const panel = mountSalesPanel(doc, anchor, { lang: 'en', api, pollMs: 20 })!;
    await settle();
    const load = [...panel.root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Load full history',
    )!;
    status = { state: 'running', pages: 1, orders: 20, created: 3 };
    load.click();
    await settle();
    expect(api.importHistory).toHaveBeenCalledTimes(1);
    expect(panel.root.textContent).toContain('Loading history: 1 page(s), 20 order(s)');
    status = { state: 'done', pages: 2, orders: 35, created: 7 };
    await vi.waitFor(() => expect(panel.root.textContent).toContain('History loaded: 7 new order(s)'));
    expect(panel.root.textContent).toContain('Load full history');
    panel.destroy();
  });

  it('says so honestly when FunPro does not answer, and can retry', async () => {
    let fail = true;
    const { doc, api, anchor } = setup(() => {
      if (fail) throw new Error('Receiving end does not exist');
      return response();
    });
    const panel = mountSalesPanel(doc, anchor, { lang: 'en', api })!;
    await settle();
    expect(panel.root.textContent).toContain('Statistics unavailable');
    fail = false;
    [...panel.root.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!.click();
    await settle();
    expect(panel.root.textContent).toContain('Revenue');
  });

  it('rejects a malformed answer instead of showing it', async () => {
    const { doc, api, anchor } = setup(() => ({ prefs: { enabled: true }, data: { orders: -1 } }));
    const panel = mountSalesPanel(doc, anchor, { lang: 'en', api })!;
    await settle();
    expect(panel.root.textContent).toContain('Statistics unavailable');
  });

  it('can be hidden from the page, and is absent when switched off', async () => {
    const { doc, api, anchor } = setup();
    const panel = mountSalesPanel(doc, anchor, { lang: 'en', api })!;
    await settle();
    [...panel.root.querySelectorAll('button')].find((b) => b.textContent === 'Hide panel')!.click();
    await settle();
    expect(api.setPrefs).toHaveBeenCalledWith({ enabled: false });
    expect(panel.root.textContent).toBe('Panel hidden. Turn it back on in FunPro → Orders.');

    const off = setup(() => response('30d', { prefs: { enabled: false, collapsed: false, period: '30d' } }));
    mountSalesPanel(off.doc, off.anchor, { lang: 'en', api: off.api });
    await settle();
    expect(off.doc.querySelector('.funpro-sales')).toBeNull();
    expect(off.doc.getElementById('funpro-sales-style')).toBeNull();
  });

  it('removes everything it added when the extension context goes away', async () => {
    const { doc, api, anchor } = setup();
    const panel = mountSalesPanel(doc, anchor, { lang: 'ru', api })!;
    await settle();
    expect(panel.root.textContent).toContain('Статистика продаж');
    panel.destroy();
    expect(doc.querySelector('[data-funpro]')).toBeNull();
    expect(doc.getElementById('funpro-sales-style')).toBeNull();
  });

  it('has every string in Russian, Ukrainian and English', () => {
    const en = Object.keys(SALES_PANEL_STRINGS.en).sort();
    expect(Object.keys(SALES_PANEL_STRINGS.ru).sort()).toEqual(en);
    expect(Object.keys(SALES_PANEL_STRINGS.uk).sort()).toEqual(en);
  });
});
