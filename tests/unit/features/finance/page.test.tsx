import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { defaultSettings } from '@/core/settings/schema';
import { getSettings } from '@/core/settings/store';
import { DashboardContext } from '@/dashboard/context';
import FinancePage from '@/dashboard/pages/FinancePage';
import { useSettingsStore } from '@/ui/hooks/useSettings';
import { mkOp, mkOrder, money } from '../analytics/dataset';

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function renderPage() {
  return render(
    <DashboardContext.Provider value={{ status: null, refreshStatus: () => undefined, navigate: vi.fn() }}>
      <FinancePage />
    </DashboardContext.Provider>,
  );
}

beforeEach(() => {
  resetDbForTests();
  useSettingsStore.setState({ settings: defaultSettings(), loaded: true });
});
afterEach(() => cleanup());

describe('FinancePage', () => {
  it('shows an empty state without data', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('No finance data yet')).toBeTruthy());
  });

  it('keeps gross revenue, net receipts, cash flow and estimated profit apart, per currency', async () => {
    await getDb().orders.bulkAdd([mkOrder({ id: 'AAAA1111', createdAt: iso(48 * HOUR), price: money(125050) })]);
    await getDb().financeOps.bulkAdd([
      mkOp({ id: '1', kind: 'income', orderId: 'AAAA1111', amount: money(112000), at: iso(24 * HOUR), description: 'Заказ #AAAA1111' }),
      mkOp({ id: '2', kind: 'withdrawal', amount: money(50000), at: iso(20 * HOUR), status: 'waiting', description: 'Вывод денег' }),
      mkOp({ id: '3', kind: 'income', amount: money(1500, 'USD'), at: iso(10 * HOUR) }),
    ]);
    await getDb().balances.bulkAdd([
      { balances: [money(100000)], at: iso(30 * HOUR) },
      { balances: [money(162000)], at: iso(5 * HOUR) },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Gross revenue · RUB')).toBeTruthy());
    expect(screen.getByText('Net receipts · RUB')).toBeTruthy();
    expect(screen.getByText('Cash flow · RUB')).toBeTruthy();
    expect(screen.getByText('Estimated profit · RUB')).toBeTruthy();
    expect(screen.getByText('Net receipts · USD')).toBeTruthy();
    expect(screen.getByText('Balance · RUB')).toBeTruthy();
    expect(screen.getByText(/FunPay kept 10\.4\s?% on 1 matched order/)).toBeTruthy();
    expect(screen.getByText('Net cash flow · RUB')).toBeTruthy();
    expect(screen.getByText('Balance history · RUB')).toBeTruthy();
    expect(screen.getByText('3 operation(s) in this period')).toBeTruthy();
    // Balances are marked for the "hide balances" privacy option.
    expect(document.querySelectorAll('.fp-balance').length).toBeGreaterThan(3);
  });

  it('toggles "hide balances" in settings', async () => {
    await getDb().balances.add({ balances: [money(100)], at: iso(HOUR) });
    renderPage();
    const sw = await screen.findByRole('switch', { name: 'Hide balances' });
    await act(async () => fireEvent.click(sw));
    await waitFor(async () => expect((await getSettings()).privacy.hideBalances).toBe(true));
  });

  it('combined view only uses manual rates with a source and shows them', async () => {
    await getDb().financeOps.bulkAdd([mkOp({ id: '1', kind: 'income', amount: money(10000), at: iso(HOUR) }), mkOp({ id: '2', kind: 'income', amount: money(200, 'USD'), at: iso(HOUR) })]);
    renderPage();
    await screen.findByText('Combined view (optional)');
    await act(async () => fireEvent.change(screen.getByLabelText('Combine into'), { target: { value: 'RUB' } }));
    await waitFor(() => expect(screen.getByText('Not included (no rate): USD')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '92.5' } });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Bank site' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add rate' })));
    await waitFor(async () => expect((await getSettings()).analytics.exchangeRates).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/Rate 1 USD = 92\.5 RUB · source: Bank site/)).toBeTruthy());
  });
});
