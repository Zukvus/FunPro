import { browser } from 'wxt/browser';
import { log } from '@/core/log/logger';
import { pruneEvents } from '@/core/events/bus';
import { pruneTasks, recoverStaleTasks } from '@/core/queue/queue';
import { restrictStorageAccess, writePageMirror } from '@/core/settings/page-mirror';
import { getSettings, updateSettings, watchSettings } from '@/core/settings/store';
import { getDb } from '@/core/db/db';
import { dispatchAlarm, ensurePeriodicAlarm, onAlarm } from './alarms';
import { emergencyStop, registerCoreHandlers } from './core-handlers';
import { MODULES } from './modules';
import { dispatch } from './router';
import { forgetTab } from './tabs';

export const ALARM_TICK = 'funpro:tick';
export const ALARM_MAINTENANCE = 'funpro:maintenance';

/**
 * Background entry. MV3 requirement: every event listener is registered synchronously during the
 * first turn of the worker script so that events which woke the worker are delivered.
 */
export function startBackground(): void {
  registerCoreHandlers();
  for (const m of MODULES) {
    try {
      void m.register();
    } catch (e) {
      console.warn('[FunPro] module failed to register', m.name, e);
    }
  }

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!message || typeof message !== 'object' || (message as { __funpro?: unknown }).__funpro !== 1)
      return false;
    void dispatch(message, sender).then((res) => sendResponse(res));
    return true;
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    void dispatchAlarm(alarm.name);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId);
  });

  // Content scripts never read the settings themselves, only this non-sensitive mirror.
  watchSettings((s) => {
    void writePageMirror(s);
  });

  browser.commands?.onCommand.addListener((command) => {
    if (command === 'emergency-stop') void emergencyStop('keyboard shortcut');
    if (command === 'open-dashboard')
      void browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
  });

  browser.runtime.onInstalled.addListener((details) => {
    void (async () => {
      const settings = await getSettings();
      if (details.reason === 'install') {
        await log.info({
          source: 'lifecycle',
          message: 'FunPro installed. Automation is paused until you enable it.',
        });
        if (!settings.general.onboardingCompleted)
          await browser.tabs.create({ url: browser.runtime.getURL('/options.html#/welcome') });
      } else if (details.reason === 'update') {
        await log.info({
          source: 'lifecycle',
          message: `Updated to ${browser.runtime.getManifest().version}`,
        });
      }
    })();
  });

  onAlarm(ALARM_TICK, async () => {
    const { requeued, uncertain } = await recoverStaleTasks();
    if (requeued || uncertain)
      await log.warn({
        source: 'queue',
        message: `Recovered tasks after restart: ${requeued} re-queued, ${uncertain} need manual check`,
      });
  });

  onAlarm(ALARM_MAINTENANCE, async () => {
    const settings = await getSettings();
    await pruneEvents();
    await pruneTasks();
    // The reply ledger only needs recent history (cooldowns, rate limits, loop detection).
    await getDb()
      .replyLedger.where('at')
      .below(Date.now() - 30 * 86400_000)
      .delete();
    const days = settings.privacy.messageRetentionDays;
    if (days > 0) {
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      await getDb().messages.where('at').below(cutoff).delete();
    }
  });

  void (async () => {
    // Chrome: storage.local (all settings) becomes unreadable for content scripts; see page-mirror.
    if ((await restrictStorageAccess()) === 'failed')
      await log.warn({
        source: 'lifecycle',
        message: 'Could not restrict settings storage to extension pages; content scripts can still read it',
      });
    await writePageMirror(await getSettings());
    await ensurePeriodicAlarm(ALARM_TICK, 1);
    await ensurePeriodicAlarm(ALARM_MAINTENANCE, 60, 5);
    const settings = await getSettings();
    if (settings.automation.state === 'stopped') {
      await browser.action?.setBadgeText?.({ text: 'STOP' });
      await browser.action?.setBadgeBackgroundColor?.({ color: '#d23b4c' });
    }
    const version = browser.runtime.getManifest().version;
    if (settings.general.lastSeenVersion !== version)
      await updateSettings({ general: { lastSeenVersion: version } });
  })();
}
