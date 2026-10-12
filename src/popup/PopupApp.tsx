import { Compass, ExternalLink, RefreshCw, Rocket, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { rpc } from '@/core/messaging/client';
import { formatMoney, type Currency } from '@/shared/models/money';
import { Badge, Button, StatusPill, Toaster, toast } from '@/ui/components';
import { useApplyAppearance } from '@/ui/hooks/useAppearance';
import { initSettingsSync, useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n/core';
import { AutomationControl } from '@/dashboard/components/AutomationControl';
import { LanguageSwitcher } from '@/dashboard/components/LanguageSwitcher';
import { SessionBadge } from '@/dashboard/components/SessionBadge';
import { useBackgroundStatus } from '@/dashboard/hooks';
import { extensionVersion, hasUnseenChangelog } from '@/dashboard/pages/about/version';
import { primeAppearanceFromCache } from '@/ui/theme/applyAppearance';

// Apply the last known theme/privacy state before the first paint.
primeAppearanceFromCache();

/** The popup stays tiny: it reads one status RPC and never loads charts or heavy modules. */
export function PopupApp() {
  useEffect(() => initSettingsSync(), []);
  useApplyAppearance();
  const t = useT();
  const [settings, , loaded] = useSettings();
  const { status, error, refresh } = useBackgroundStatus(4000);
  const [busy, setBusy] = useState<string | null>(null);

  const action = async (name: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(name);
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openDashboard = (hash = '') =>
    void browser.tabs.create({ url: browser.runtime.getURL(`/options.html${hash}`) });
  const sales = Object.entries(status?.salesToday ?? {});
  const version = extensionVersion();
  const whatsNew = hasUnseenChangelog(settings.general, version);

  return (
    <main className="w-[360px] bg-bg p-3 text-fg">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <img src="/icon/32.png" width={22} height={22} alt="" />
          <h1 className="text-sm font-bold">FunPro</h1>
        </div>
        <LanguageSwitcher compact />
      </header>
      <div className="mb-3 flex justify-end">
        <SessionBadge session={status?.session} openTabs={status?.openTabs ?? 0} />
      </div>
      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-danger/10 p-2 text-xs text-danger">
          {error}
        </p>
      )}
      {loaded && !settings.general.onboardingCompleted && (
        <Button
          size="sm"
          variant="primary"
          className="mb-3 w-full"
          icon={<Compass size={14} aria-hidden />}
          onClick={() => openDashboard('#/welcome')}
        >
          {t('popup.finishSetup')}
        </Button>
      )}
      {whatsNew && (
        <button
          type="button"
          onClick={() => openDashboard('#/about')}
          className="mb-3 flex w-full items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1.5 text-left text-xs font-medium text-success hover:bg-success/15"
        >
          <Sparkles size={13} aria-hidden /> {t('popup.whatsNew', { version })}
        </button>
      )}

      <section className="mb-3 grid grid-cols-3 gap-2">
        <Metric
          label={t('popup.salesToday')}
          value={
            sales.length
              ? sales.map(([c, v]) => formatMoney({ amountMinor: v, currency: c as Currency })).join(' · ')
              : '—'
          }
          balance
        />
        <Metric label={t('popup.activeOrders')} value={String(status?.counts.activeSales ?? '—')} />
        <Metric label={t('popup.unread')} value={String(status?.counts.unreadChats ?? '—')} />
      </section>

      <section className="mb-3 rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold">
            {status ? t(`automation.state.${status.automationState}`) : '…'}
          </span>
          <AutomationControl state={status?.automationState} onChange={refresh} compact />
        </div>
        <ul className="space-y-1">
          {status?.statuses
            .filter((s) => s.status !== 'disabled')
            .map((s) => (
              <li key={s.feature} className="flex items-center justify-between text-xs">
                <span className="text-muted">{t(`feature.${s.feature}`)}</span>
                <StatusPill status={s.status} reason={s.reason} />
              </li>
            ))}
          {status && status.statuses.every((s) => s.status === 'disabled') && (
            <li className="text-xs text-muted">{t('popup.noAutomations')}</li>
          )}
        </ul>
        {status && status.counts.failedTasks > 0 && (
          <Badge tone="danger" className="mt-2">
            {t('popup.failedTasks', { count: status.counts.failedTasks })}
          </Badge>
        )}
      </section>

      <section className="mb-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t('popup.quickActions')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            icon={<Rocket size={14} />}
            loading={busy === 'bump'}
            onClick={() => action('bump', () => rpc('ui.bumpNow', {}), t('popup.bumpNow'))}
          >
            {t('popup.bumpNow')}
          </Button>
          <Button
            size="sm"
            icon={<RefreshCw size={14} />}
            loading={busy === 'sync'}
            onClick={() => action('sync', () => rpc('ui.syncNow', {}), t('common.syncNow'))}
          >
            {t('common.syncNow')}
          </Button>
          <Button
            size="sm"
            icon={<ExternalLink size={14} />}
            onClick={() => void browser.tabs.create({ url: 'https://funpay.com/' })}
          >
            {t('session.openFunPay')}
          </Button>
          <Button size="sm" variant="primary" icon={<Settings2 size={14} />} onClick={() => openDashboard()}>
            {t('common.openDashboard')}
          </Button>
        </div>
      </section>
      {!status?.session && <p className="text-center text-[11px] text-muted">{t('popup.noData')}</p>}
      <Toaster />
    </main>
  );
}

/** `balance` marks money values: blurred by CSS when "hide balances" or privacy mode is on. */
function Metric({ label, value, balance }: { label: string; value: string; balance?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p
        tabIndex={balance ? 0 : undefined}
        className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${balance ? 'fp-balance' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}
