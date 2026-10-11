import { browser } from 'wxt/browser';
import { backgroundForFunPay } from '@/features/appearance/background';
import { wipeAllLocalData } from '@/features/backup/wipe';
import { getLastSession, listTabs } from '../tabs';
import { handle, registeredMethods } from '../router';
import type { BackgroundModule } from './index';

const startedAt = Date.now();

/** Background module: settings (appearance assets for funpay.com, wipe, diagnostics). */
export const settingsModule: BackgroundModule = {
  name: 'settings',
  register() {
    // Content scripts run in the funpay.com origin and cannot read extension IndexedDB.
    handle('cs.getBackgroundImage', async () => backgroundForFunPay());

    handle('ui.wipeAllData', async () => {
      const result = await wipeAllLocalData();
      await browser.action?.setBadgeText?.({ text: '' });
      return result;
    });

    handle('ui.diagnostics', async () => {
      const [alarms, tabs, session] = await Promise.all([
        browser.alarms.getAll().catch(() => []),
        listTabs().catch(() => []),
        getLastSession().catch(() => null),
      ]);
      return {
        workerStartedAt: startedAt,
        registeredRpcMethods: registeredMethods().length,
        alarms: alarms.map((a) => ({ name: a.name, periodInMinutes: a.periodInMinutes ?? null, scheduledTime: a.scheduledTime })),
        trackedFunPayTabs: tabs.length,
        loggedInTabs: tabs.filter((t) => t.session.status === 'logged_in').length,
        // Session status only — never the user name or id.
        lastSession: session ? { status: session.status, adapterVersion: session.adapterVersion, observedAt: session.observedAt } : null,
      };
    });
  },
};
