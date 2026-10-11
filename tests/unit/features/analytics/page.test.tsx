import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { defaultSettings } from '@/core/settings/schema';
import { DashboardContext } from '@/dashboard/context';
import AnalyticsPage from '@/dashboard/pages/AnalyticsPage';
import { useSettingsStore } from '@/ui/hooks/useSettings';
import { mkOrder, money } from './dataset';

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function renderPage() {
  return render(
    <DashboardContext.Provider value={{ status: null, refreshStatus: () => undefined, navigate: vi.fn() }}>
      <AnalyticsPage />
    </DashboardContext.Provider>,
  );
}

beforeEach(() => {
  resetDbForTests();
  useSettingsStore.setState({ settings: defaultSettings(), loaded: true });
});
afterEach(() => cleanup());

describe('AnalyticsPage', () => {
  it('shows an informative empty state instead of numbers when nothing is stored', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('No orders stored yet')).toBeTruthy());
    expect(screen.queryByText(/Revenue ·/)).toBeNull();
  });

  it('shows per-currency KPIs, charts with table views, products, profit estimate and the conversion notice', async () => {
    await getDb().orders.bulkAdd([
      mkOrder({ id: 'K1000001', createdAt: iso(2 * HOUR), price: money(125050), description: 'Alpha key, 2 шт.' }),
      mkOrder({ id: 'K2000002', createdAt: iso(26 * HOUR), price: money(4000, 'USD'), description: 'Beta boost', status: 'paid' }),
      mkOrder({ id: 'K3000003', createdAt: iso(50 * HOUR), price: money(5000), description: 'Alpha key', status: 'refunded' }),
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Revenue · RUB')).toBeTruthy());
    expect(screen.getByText('Revenue · USD')).toBeTruthy();
    expect(screen.getByText('Revenue over time · RUB')).toBeTruthy();
    expect(screen.getByText('Revenue over time · USD')).toBeTruthy();
    expect(screen.getByText('Product conversion')).toBeTruthy();
    expect(screen.getByText(/FunPay does not show sellers how many buyers viewed an offer/)).toBeTruthy();
    expect(screen.getAllByText('Profit by product').length).toBeGreaterThan(0);
    expect(screen.getAllByText('estimate').length).toBeGreaterThan(0);

    // Every chart has a table twin.
    const figure = screen.getByText('Revenue over time · RUB').closest('figure')!;
    fireEvent.click(within(figure).getByRole('button', { name: /Table/ }));
    const table = within(figure).getByRole('table');
    expect(table.textContent).toContain('Revenue');

    // Purchases switch re-scopes everything below the filter row.
    fireEvent.click(screen.getByRole('radio', { name: 'Purchases' }));
    await waitFor(() => expect(screen.queryByText('Revenue · RUB')).toBeNull());
    expect(screen.queryAllByText('Profit by product')).toHaveLength(0);
  });
});
