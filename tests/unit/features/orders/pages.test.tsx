import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_FEATURES } from '@/core/automation/policy';
import { getDb, resetDbForTests } from '@/core/db/db';
import { defaultSettings } from '@/core/settings/schema';
import { DashboardContext, type DashboardCtx } from '@/dashboard/context';
import type { StatusResponse } from '@/dashboard/hooks';
import OrdersPage from '@/dashboard/pages/OrdersPage';
import OverviewPage from '@/dashboard/pages/OverviewPage';
import { useSettingsStore } from '@/ui/hooks/useSettings';
import { mkOrder, money } from '../analytics/dataset';

const HOUR = 3_600_000;

function status(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    automationState: 'paused',
    liveActionsAcknowledged: false,
    session: {
      status: 'logged_in',
      userId: '1000001',
      username: 'SellerOne',
      locale: 'ru',
      activeSales: 1,
      activePurchases: 0,
      unreadChats: 2,
      balanceText: null,
      adapterVersion: 'x',
      observedAt: 1,
    },
    openTabs: 1,
    statuses: ALL_FEATURES.map((feature) => ({
      feature,
      status: 'disabled' as const,
      reason: 'Turned off in settings',
    })),
    counts: { activeSales: 3, unreadChats: 2, salesTodayCount: 0, failedTasks: 1, pendingDrafts: 4 },
    salesToday: {},
    ...over,
  };
}

function renderWith(node: ReactNode, st: StatusResponse = status()) {
  const ctx: DashboardCtx = { status: st, refreshStatus: () => undefined, navigate: vi.fn() };
  return render(<DashboardContext.Provider value={ctx}>{node}</DashboardContext.Provider>);
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

async function seed() {
  await getDb().orders.bulkAdd([
    mkOrder({
      id: 'S1000001',
      status: 'paid',
      createdAt: iso(100 * HOUR),
      price: money(125050),
      counterpartyName: 'BuyerAlpha',
      counterpartyId: '2000001',
      description: 'Alpha key, 1 шт.',
      history: [{ status: 'paid', at: iso(99 * HOUR), source: 'observed' }],
    }),
    mkOrder({
      id: 'S2000002',
      status: 'closed',
      createdAt: iso(5 * HOUR),
      price: money(4000, 'USD'),
      counterpartyName: 'BuyerBeta',
      counterpartyId: '2000002',
      description: 'Beta boost',
    }),
    mkOrder({
      id: 'S3000003',
      status: 'refunded',
      createdAt: iso(30 * HOUR),
      price: money(5000),
      counterpartyName: 'BuyerGamma',
      categoryName: 'Game B, Gold',
    }),
    mkOrder({
      id: 'P1000001',
      direction: 'purchase',
      status: 'closed',
      createdAt: iso(10 * HOUR),
      price: money(30000),
      counterpartyName: 'SellerX',
      counterpartyId: '3000001',
    }),
  ]);
}

// happy-dom has no layout: give elements a size so the virtualized table renders its rows.
const proto = HTMLElement.prototype;
const sizeDescriptors = {
  h: Object.getOwnPropertyDescriptor(proto, 'offsetHeight'),
  w: Object.getOwnPropertyDescriptor(proto, 'offsetWidth'),
};
beforeEach(() => {
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => 600 });
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 900 });
});
afterEach(() => {
  if (sizeDescriptors.h) Object.defineProperty(proto, 'offsetHeight', sizeDescriptors.h);
  if (sizeDescriptors.w) Object.defineProperty(proto, 'offsetWidth', sizeDescriptors.w);
});

beforeEach(() => {
  resetDbForTests();
  useSettingsStore.setState({ settings: defaultSettings(), loaded: true });
  window.location.hash = '#/orders';
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
});
afterEach(() => cleanup());

describe('OrdersPage', () => {
  it('lists sales with totals per currency and filters by status', async () => {
    await seed();
    renderWith(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('#S1000001')).toBeTruthy());
    expect(screen.getByText('#S2000002')).toBeTruthy();
    expect(screen.queryByText('#P1000001')).toBeNull();
    expect(screen.getByText(/^3 orders/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refunded', pressed: false }));
    await waitFor(() => expect(screen.queryByText('#S1000001')).toBeNull());
    expect(screen.getByText('#S3000003')).toBeTruthy();
  });

  it('copies an order id with one click', async () => {
    await seed();
    renderWith(<OrdersPage />);
    const btn = await screen.findByRole('button', { name: 'Copy order number S1000001' });
    await act(async () => fireEvent.click(btn));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('S1000001');
  });

  it('opens the detail drawer with the status timeline, FunPay link and chat link', async () => {
    await seed();
    renderWith(<OrdersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Details of order #S1000001' }));
    await waitFor(() => expect(screen.getByText('Status history')).toBeTruthy());
    const dialog = document.querySelector('dialog')!;
    expect(within(dialog).getByText('Order created on FunPay')).toBeTruthy();
    expect(dialog.querySelector('a[href="https://funpay.com/orders/S1000001/"]')).not.toBeNull();
    expect(
      dialog.querySelector('a[href="https://funpay.com/chat/?node=users-1000001-2000001"]'),
    ).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Draft support ticket' })).toBeTruthy();
  });

  it('shows purchases with statistics', async () => {
    await seed();
    window.location.hash = '#/orders?tab=purchases';
    renderWith(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('#P1000001')).toBeTruthy());
    expect(screen.getByText('Purchase statistics')).toBeTruthy();
    expect(screen.getAllByText('SellerX').length).toBeGreaterThan(0);
  });

  it('unconfirmed tab: aging buckets, copy all ids and a ticket draft that is never sent', async () => {
    await seed();
    window.location.hash = '#/orders?tab=unconfirmed';
    renderWith(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('#S1000001')).toBeTruthy());
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy 1 ID(s)' })));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('S1000001');
    fireEvent.click(screen.getByRole('button', { name: 'Draft support ticket…' }));
    await waitFor(() =>
      expect(screen.getByText('FunPro never contacts FunPay support for you')).toBeTruthy(),
    );
    const body = document.querySelector<HTMLTextAreaElement>('#ticket-body')!;
    expect(body.value).toContain('#S1000001');
  });
});

describe('OverviewPage', () => {
  it('shows a getting-started checklist and no fabricated numbers when there is no data', async () => {
    renderWith(
      <OverviewPage />,
      status({
        openTabs: 0,
        session: null,
        counts: { activeSales: 0, unreadChats: 0, salesTodayCount: 0, failedTasks: 0, pendingDrafts: 0 },
      }),
    );
    await waitFor(() => expect(screen.getByText('Getting started')).toBeTruthy());
    expect(screen.getByText('1. Open FunPay in a browser tab')).toBeTruthy();
    expect(screen.getAllByText('No sales').length).toBeGreaterThan(0);
  });

  it('shows KPIs from the background status, automation statuses and recent sales', async () => {
    await seed();
    renderWith(<OverviewPage />);
    await waitFor(() => expect(screen.getByText('Recent sales')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Beta boost')).toBeTruthy());
    expect(screen.queryByText('Getting started')).toBeNull();
    expect(screen.getByText('Drafts to review').parentElement!.parentElement!.textContent).toContain('4');
    expect(screen.getByText('Auto-raise offers')).toBeTruthy();
    expect(document.querySelector('a[href="#/automation"]')).not.toBeNull();
    expect(screen.getByText('Awaiting confirmation')).toBeTruthy();
  });
});
