import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/core/db/db';
import InventoryPage from '@/dashboard/pages/InventoryPage';
import { importItems } from '@/features/inventory/items';
import { reserveForOrder } from '@/features/inventory/reservation';
import { addOrder, freshDb, makePool } from './helpers';

beforeEach(() => {
  freshDb();
});
afterEach(() => cleanup());

describe('InventoryPage (smoke)', () => {
  it('renders pools with stock counts, deliveries and unassigned orders', async () => {
    await getDb().listings.add({
      id: '777',
      nodeId: '1',
      gameId: '1',
      categoryName: 'Steam',
      title: 'Cyberpunk key',
      price: { amountMinor: 100, currency: 'RUB' },
      amount: null,
      active: true,
      promoted: false,
      autoDelivery: false,
      costMinor: null,
      sortIndex: 0,
      seenAt: '',
      updatedAt: '',
    });
    const pool = await makePool({ name: 'CP keys', listingIds: ['777'], lowStockThreshold: 5 });
    await importItems(pool.id, ['K-1', 'K-2', 'K-3']);
    await addOrder('RES1');
    await reserveForOrder({ orderId: 'RES1', pool, quantity: 1, buyerId: '555', buyerName: 'buyer1' });
    await addOrder('WAIT1', { description: 'Something else' });

    render(<InventoryPage />);
    expect(await screen.findByText('CP keys')).toBeTruthy();
    expect(screen.getByText('Low stock')).toBeTruthy();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0); // available
    // No plaintext goods are ever rendered by default.
    expect(document.body.textContent).not.toContain('K-1');

    fireEvent.click(screen.getByRole('tab', { name: /Deliveries/ }));
    // The table is virtualised (no layout in happy-dom), so assert on its row count.
    await waitFor(() => expect(screen.getByRole('table').getAttribute('aria-rowcount')).toBe('1'));

    fireEvent.click(screen.getByRole('tab', { name: /Unassigned orders/ }));
    expect(await screen.findByText('#WAIT1')).toBeTruthy();
  });

  it('opens the pool editor with the template preview', async () => {
    render(<InventoryPage />);
    fireEvent.click((await screen.findAllByText('New pool'))[0]!);
    expect(await screen.findByText('Preview (goods masked)')).toBeTruthy();
  });
});
