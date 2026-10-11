import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbForTests } from '@/core/db/db';
import { defaultSettings } from '@/core/settings/schema';
import { BulkDialog } from '@/dashboard/pages/listings/BulkDialog';
import { loadPlan } from '@/features/listings/bulk-store';
import { useSettingsStore } from '@/ui/hooks/useSettings';
import { makeListing } from './helpers';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/core/messaging/client', () => ({ rpc: rpcMock, RpcError: class RpcError extends Error {} }));

function setSettings(mut: (s: ReturnType<typeof defaultSettings>) => void) {
  const s = defaultSettings();
  mut(s);
  useSettingsStore.setState({ settings: s, loaded: true });
}

beforeEach(() => {
  resetDbForTests();
  rpcMock.mockReset();
  setSettings(() => undefined);
});
afterEach(() => cleanup());

const listings = [makeListing('9000001', { costMinor: 9_500 }), makeListing('9000002', {}, 20_000)];

describe('BulkDialog', () => {
  it('validates parameters, previews before → after with warnings and blocks execution until live actions are confirmed', async () => {
    const onExecuted = vi.fn();
    render(<BulkDialog input={{ kind: 'configure', op: 'adjust_pct', listings }} onClose={() => undefined} onExecuted={onExecuted} />);
    fireEvent.click(screen.getByText('Preview changes'));
    expect(await screen.findByText('Enter a non-zero percentage between -99.99 and 1000.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('+10 / -5'), { target: { value: '-10' } });
    fireEvent.click(screen.getByText('Preview changes'));
    expect(await screen.findByText('Will change: 2')).toBeTruthy();
    // 100.00 − 10 % = 90.00 < cost 95.00
    expect(screen.getAllByText(/Below cost/).length).toBeGreaterThan(0);
    expect(screen.getByText('Confirm live FunPay actions first')).toBeTruthy();
    expect((screen.getByText('Execute (2)').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();

    setSettings((s) => (s.automation.liveActionsAcknowledged = true));
    rpcMock.mockResolvedValue({ planId: 'x', queued: 2, skipped: 0, backupId: 'b', alreadyQueued: false });
    const button = (await screen.findByText('Execute (2)')).closest('button') as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(onExecuted).toHaveBeenCalledTimes(1));
    const planId = onExecuted.mock.calls[0]![0] as string;
    expect(rpcMock).toHaveBeenCalledWith('ui.bulkEdit.execute', { planId });
    const stored = (await loadPlan(planId))!;
    expect(stored.items.map((i) => i.changes.price)).toEqual(['90.00', '180.00']);
    expect(stored.items[0]!.expectPriceMinor).toBe(10_000);
  });

  it('requires the typed phrase for deletions and drops the draft when execution is refused', async () => {
    setSettings((s) => (s.automation.liveActionsAcknowledged = true));
    rpcMock.mockRejectedValue(Object.assign(new Error('Emergency stop is active'), { code: 'emergency_stop' }));
    const onExecuted = vi.fn();
    render(<BulkDialog input={{ kind: 'configure', op: 'delete', listings }} onClose={() => undefined} onExecuted={onExecuted} />);
    expect(await screen.findByText('Deleting offers cannot be undone')).toBeTruthy();
    const button = screen.getByText('Delete offers (2)').closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type DELETE 2 to confirm'), { target: { value: 'DELETE 1' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type DELETE 2 to confirm'), { target: { value: 'DELETE 2' } });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const planId = (rpcMock.mock.calls[0]![1] as { planId: string }).planId;
    await waitFor(async () => expect(await loadPlan(planId)).toBeNull());
    expect(onExecuted).not.toHaveBeenCalled();
  });

  it('is blocked during the emergency stop', async () => {
    setSettings((s) => {
      s.automation.liveActionsAcknowledged = true;
      s.automation.state = 'stopped';
    });
    render(<BulkDialog input={{ kind: 'configure', op: 'enable', listings }} onClose={() => undefined} onExecuted={() => undefined} />);
    expect(await screen.findByText('Emergency stop is active')).toBeTruthy();
    expect((screen.getByText('Execute (2)').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
