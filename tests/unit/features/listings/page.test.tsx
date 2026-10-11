import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import ListingsPage from '@/dashboard/pages/ListingsPage';
import { buildBulkPlan } from '@/features/listings/bulk-plan';
import { savePlan } from '@/features/listings/bulk-store';
import { defaultSettings } from '@/core/settings/schema';
import { makeListing } from './helpers';

beforeEach(() => {
  resetDbForTests();
  window.location.hash = '#/listings';
});
afterEach(() => cleanup());

describe('ListingsPage (smoke)', () => {
  it('explains how data arrives when there is none (no fake data)', async () => {
    render(<ListingsPage />);
    expect(await screen.findByText('No offers yet')).toBeTruthy();
    expect(await screen.findByText('No categories discovered yet')).toBeTruthy();
    expect(screen.getAllByText(/Sales → My offers/).length).toBeGreaterThan(0);
  });

  it('renders the table, bump panel and every tab', async () => {
    await getDb().listings.bulkAdd([
      makeListing('9000001', { title: 'Starter account', costMinor: 5_000 }),
      makeListing('9000002', { title: 'Premium account', active: false, promoted: true }),
      makeListing('9000003', { title: 'Rank boost', nodeId: '777', categoryName: 'Game C Boosting' }, 550, 'USD'),
    ]);
    await getDb().bumpState.add({ gameId: '41', nodeIds: ['501'], categoryName: 'Game A', status: 'waiting', lastAttemptAt: Date.now() - 60_000, lastSuccessAt: null, nextEligibleAt: Date.now() + 3600_000, lastMessage: 'Подождите 1 час.', consecutiveFailures: 0 });
    const plan = buildBulkPlan([makeListing('9000001')], { kind: 'disable' }, { fees: defaultSettings().fees, now: Date.now(), label: 'Disable test' });
    await savePlan({ ...plan, status: 'done', queuedAt: Date.now(), finishedAt: Date.now(), report: { total: 1, done: 1, failed: 0, skipped: 0, conflict: 0, cancelled: 0 } });

    render(<ListingsPage />);
    expect(await screen.findByText('Showing 3 of 3')).toBeTruthy();
    expect(await screen.findByText('Game A')).toBeTruthy();
    expect(screen.getByText('Cooldown')).toBeTruthy();
    expect(screen.getByText(/Подождите 1 час/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search title, id or category…'), { target: { value: 'premium' } });
    expect(await screen.findByText('Showing 1 of 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Bulk operations' }));
    expect(await screen.findByText('Disable test')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Display order' }));
    expect(await screen.findByText('Reordering on FunPay: blocked by a platform limitation')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Commission' }));
    expect(await screen.findByText('Per subcategory')).toBeTruthy();
    expect(screen.getAllByText('Ask FunPay').length).toBe(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Import / export' }));
    expect(await screen.findByText('Export (3)')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }));
    expect(await screen.findByText('No templates')).toBeTruthy();
  });
});
