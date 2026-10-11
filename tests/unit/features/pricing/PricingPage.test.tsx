import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests } from '@/core/events/bus';
import PricingPage from '@/dashboard/pages/PricingPage';
import { getSimulation } from '@/features/pricing/model';
import { ingestCompetitors } from '@/features/sync/ingest';
import type { CompetitorOffer } from '@/shared/models';

function competitor(offerId: string, price: number): CompetitorOffer {
  return { offerId, nodeId: '1', sellerName: `seller-${offerId}`, sellerId: null, title: 'Gems 100', price: { amountMinor: price, currency: 'RUB' }, amount: null, online: true, promoted: false, rating: null, reviewCount: null };
}

beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => cleanup());

describe('PricingPage (smoke)', () => {
  it('shows market stats, comparable offers, a recommendation and runs a simulation', async () => {
    await getDb().listings.add({ id: 'L1', nodeId: '1', gameId: '9', categoryName: 'Gems', title: 'Gems 100', price: { amountMinor: 10000, currency: 'RUB' }, amount: null, active: true, promoted: false, autoDelivery: false, costMinor: null, sortIndex: 0, seenAt: '', updatedAt: '' });
    const t = Date.now() - 3600_000;
    await ingestCompetitors('1', [competitor('a', 9500), competitor('b', 11000), competitor('L1', 10000)], t - 3600_000);
    await ingestCompetitors('1', [competitor('a', 9000), competitor('b', 11000), competitor('L1', 10000)], t);

    render(<PricingPage />);
    expect(await screen.findByText('Price position')).toBeTruthy();
    expect(screen.getByText('Offers in this category')).toBeTruthy();
    expect(screen.getAllByText('seller-a').length).toBeGreaterThan(0);
    expect(await screen.findByText(/Suggested:/)).toBeTruthy();

    fireEvent.click(screen.getByText('Run simulation'));
    expect(await screen.findByText('Simulated price')).toBeTruthy();
    expect(await getSimulation('L1')).not.toBeNull();

    // Table view twin of the charts.
    fireEvent.click(screen.getAllByText('Show table')[0]!);
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
  });

  it('explains how to get data when there are no listings', async () => {
    render(<PricingPage />);
    expect(await screen.findByText('No listings yet')).toBeTruthy();
  });
});
