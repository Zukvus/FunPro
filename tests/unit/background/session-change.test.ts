import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, onEvent } from '@/core/events/bus';
import type { SessionInfo } from '@/shared/session';

vi.mock('@/background/tabs', () => ({
  getLastSession: async () => null,
  listTabs: async () => [],
  pickExecutionTab: async () => null,
  registerTab: async () => undefined,
}));
const { emitSessionChange } = await import('@/background/core-handlers');

function session(status: SessionInfo['status'], userId: string | null): SessionInfo {
  return {
    status,
    userId,
    username: userId ? `u${userId}` : null,
    locale: 'ru',
    activeSales: null,
    activePurchases: null,
    unreadChats: null,
    balanceText: null,
    adapterVersion: 'v1',
    observedAt: 0,
  };
}

describe('SESSION_CHANGED', () => {
  const seen: unknown[] = [];
  beforeEach(() => {
    resetDbForTests();
    clearEventHandlersForTests();
    seen.length = 0;
    onEvent('SESSION_CHANGED', (e) => {
      seen.push(e.payload);
    });
  });

  it('fires on login, logout and account switch, not on repeats or unknown pages', async () => {
    const t = Date.parse('2024-11-05T12:00:00Z');
    expect(await emitSessionChange(null, session('logged_in', '1'), t)).toBe(true);
    expect(await emitSessionChange(session('logged_in', '1'), session('logged_in', '1'), t + 60_000)).toBe(
      false,
    );
    expect(await emitSessionChange(session('logged_in', '1'), session('unknown', null), t + 120_000)).toBe(
      false,
    );
    expect(await emitSessionChange(session('logged_in', '1'), session('logged_out', null), t + 180_000)).toBe(
      true,
    );
    expect(await emitSessionChange(session('logged_out', null), session('logged_in', '2'), t + 240_000)).toBe(
      true,
    );
    expect(seen).toMatchObject([
      { status: 'logged_in', previousStatus: null, userId: '1' },
      { status: 'logged_out', previousStatus: 'logged_in' },
      { status: 'logged_in', previousStatus: 'logged_out', userId: '2' },
    ]);
  });
});
