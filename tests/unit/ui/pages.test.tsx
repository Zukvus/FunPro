import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_FEATURES } from '@/core/automation/policy';
import { getDb, resetDbForTests } from '@/core/db/db';
import { getSettings, updateSettings } from '@/core/settings/store';
import { DashboardContext, type DashboardCtx } from '@/dashboard/context';
import type { StatusResponse } from '@/dashboard/hooks';
import AboutPage from '@/dashboard/pages/AboutPage';
import AppearancePage from '@/dashboard/pages/AppearancePage';
import AutomationPage from '@/dashboard/pages/AutomationPage';
import LogsPage from '@/dashboard/pages/LogsPage';
import PrivacyPage from '@/dashboard/pages/PrivacyPage';
import WelcomePage from '@/dashboard/pages/WelcomePage';
import { useSettingsStore } from '@/ui/hooks/useSettings';
import { defaultSettings } from '@/core/settings/schema';
import { translate } from '@/ui/i18n';

// happy-dom has no layout, so the virtualised table would render no rows: render them all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * estimateSize(), size: estimateSize() })),
    getTotalSize: () => count * estimateSize(),
  }),
}));

const status: StatusResponse = {
  automationState: 'paused',
  liveActionsAcknowledged: false,
  session: null,
  openTabs: 0,
  statuses: ALL_FEATURES.map((feature) => ({ feature, status: 'disabled', reason: 'Turned off in settings' })),
  counts: { activeSales: 0, unreadChats: 0, salesTodayCount: 0, failedTasks: 0, pendingDrafts: 0 },
  salesToday: {},
};

let navigate: ReturnType<typeof vi.fn<(p: string) => void>>;

function renderPage(node: ReactNode) {
  const ctx: DashboardCtx = { status, refreshStatus: () => undefined, navigate };
  return render(<DashboardContext.Provider value={ctx}>{node}</DashboardContext.Provider>);
}

beforeEach(() => {
  resetDbForTests();
  navigate = vi.fn();
  useSettingsStore.setState({ settings: defaultSettings(), loaded: true });
  fakeBrowser.runtime.getManifest = vi.fn(() => ({
    manifest_version: 3,
    name: 'FunPro',
    version: '0.2.0',
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://funpay.com/*'],
    optional_host_permissions: ['https://api.telegram.org/*'],
  })) as never;
  fakeBrowser.permissions.getAll = vi.fn(async () => ({ permissions: ['storage', 'alarms'], origins: ['https://funpay.com/*', 'https://api.telegram.org/*'] })) as never;
});

afterEach(() => cleanup());

describe('AutomationPage', () => {
  it('shows a card with a switch for every automated feature and its reason', () => {
    renderPage(<AutomationPage />);
    for (const f of ALL_FEATURES) expect(screen.getByRole('switch', { name: `Enable: ${translate('en', `feature.${f}`)}` })).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(ALL_FEATURES.length);
    expect(screen.getAllByText('Turned off').length).toBeGreaterThanOrEqual(ALL_FEATURES.length);
    expect(screen.getByText('Automation control center')).toBeTruthy();
  });

  it('enabling a live-action feature asks for the acknowledgement, which needs every checkbox', async () => {
    renderPage(<AutomationPage />);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Enable: Auto-bump offers' }));
    });
    await waitFor(async () => expect((await getSettings()).automation.autoBump).toBe(true));
    const dialog = document.querySelector('dialog')!;
    await waitFor(() => expect(dialog.textContent).toContain('Confirm live FunPay actions'));
    expect(dialog.textContent).toContain('Raise offers');
    expect(dialog.querySelector('a[href="https://funpay.com/trade/info"]')).not.toBeNull();
    const allow = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Allow live actions')!;
    const boxes = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes).toHaveLength(4);
    expect(allow.disabled).toBe(true);
    for (const b of boxes.slice(0, 3)) fireEvent.click(b);
    expect(allow.disabled).toBe(true);
    fireEvent.click(boxes[3]!);
    expect(allow.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(allow);
    });
    await waitFor(async () => expect((await getSettings()).automation.liveActionsAcknowledged).toBe(true));
  });
});

describe('AppearancePage', () => {
  it('lists every theme as a radio and persists the choice', async () => {
    renderPage(<AppearancePage />);
    const radios = screen.getAllByRole('radio').filter((r) => r.closest('[aria-label="Theme"]'));
    expect(radios).toHaveLength(9);
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Forest' }));
    });
    await waitFor(async () => expect((await getSettings()).appearance.theme).toBe('forest'));
    expect(screen.getByRole('radio', { name: 'Forest' }).getAttribute('aria-checked')).toBe('true');
  });

  it('marks the nickname sharing feature as blocked', () => {
    renderPage(<AppearancePage />);
    expect(screen.getByText(/requires an opt-in synchronization service \(not available\)/)).toBeTruthy();
  });
});

describe('PrivacyPage', () => {
  it('requires typing the confirmation word before deleting everything', async () => {
    renderPage(<PrivacyPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete all data…' }));
    const dialog = Array.from(document.querySelectorAll('dialog')).find((d) => d.textContent?.includes('Delete all local data?'))!;
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Delete everything')!;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(dialog.querySelector('input')!, { target: { value: 'delete' } });
    expect(confirm.disabled).toBe(false);
  });

  it('shows optional permissions with their granted state', async () => {
    renderPage(<PrivacyPage />);
    expect(screen.getByText('https://api.telegram.org/*')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy());
  });
});

describe('LogsPage', () => {
  it('lists activity, and offers retry only for safe failed tasks', async () => {
    const db = getDb();
    await db.logs.bulkAdd([
      { at: Date.now(), level: 'info', source: 'bump', message: 'Raised' },
      { at: Date.now(), level: 'error', source: 'outbox', message: 'Failed' },
      { at: Date.now(), level: 'debug', source: 'sync', message: 'Hidden by default' },
    ]);
    const base = { idempotencyKey: '', payload: {}, attempts: 1, maxAttempts: 1, nextRunAt: 0, lastError: 'x', createdAt: 1, updatedAt: 1 };
    await db.tasks.bulkPut([
      { ...base, id: 'a', idempotencyKey: 'a', kind: 'bump', status: 'failed' },
      { ...base, id: 'b', idempotencyKey: 'b', kind: 'send_message', status: 'failed' },
    ]);
    renderPage(<LogsPage />);
    await waitFor(() => expect(screen.getByText('Showing 2 of 3 entries')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Task queue' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1));
    expect(screen.getByText('Check FunPay')).toBeTruthy();
  });
});

describe('AboutPage', () => {
  it('shows the version, the changelog and marks a new version as seen', async () => {
    await updateSettings({ general: { onboardingCompleted: true, changelogSeenVersion: '0.1.0' } });
    useSettingsStore.setState({ settings: await getSettings(), loaded: true });
    renderPage(<AboutPage />);
    expect(screen.getByText('Version 0.2.0')).toBeTruthy();
    expect(screen.getByText('GPL-3.0-or-later')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('New')).toBeTruthy());
    await waitFor(async () => expect((await getSettings()).general.changelogSeenVersion).toBe('0.2.0'));
  });
});

describe('WelcomePage', () => {
  it('walks through the steps and completes onboarding', async () => {
    renderPage(<WelcomePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to FunPro');
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Automation is off');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start using FunPro' }));
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('overview'));
    const s = await getSettings();
    expect(s.general.onboardingCompleted).toBe(true);
    expect(s.general.changelogSeenVersion).toBe('0.2.0');
    expect(s.automation.state).toBe('paused');
  });
});
