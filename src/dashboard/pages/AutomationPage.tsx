import { ArrowRight, Hand, OctagonX, Pause, Play, ShieldCheck, ShieldQuestion, Timer, Zap } from 'lucide-react';
import { useState } from 'react';
import { ALL_FEATURES, type AutomationFeature, type FeatureStatus } from '@/core/automation/policy';
import { Badge, Button, Callout, Card, ConfirmDialog, Field, Kbd, PageHeader, Select, StatusPill, Switch, toast } from '@/ui/components';
import { Slider } from '@/ui/components/FormControls';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT, type TFunction } from '@/ui/i18n';
import { useLocalValue } from './appearance/useLocalValue';
import { AutomationControl } from '../components/AutomationControl';
import { useDashboard } from '../context';
import { featureCapabilities, FEATURE_ROUTE, reasonKey, unverifiedMutatingCapabilities } from './automation/features';
import { LiveActionsDialog } from './automation/LiveActionsDialog';

const SYNC_INTERVALS = [1, 2, 5, 10, 15, 30, 60];

function reasonText(t: TFunction, status: FeatureStatus | undefined): string {
  if (!status) return t('automation.reason.unknown');
  const key = reasonKey(status.reason);
  return key ? t(key) : status.reason;
}

export default function AutomationPage() {
  const t = useT();
  const [settings, update] = useSettings();
  const { status, refreshStatus } = useDashboard();
  const [liveOpen, setLiveOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const a = settings.automation;
  const state = status?.automationState ?? a.state;
  const statusOf = (f: AutomationFeature) => status?.statuses.find((s) => s.feature === f);
  const unverified = unverifiedMutatingCapabilities();
  const [gap, setGap] = useLocalValue(settings.sync.minRequestGapMs, (v: number) => update({ sync: { minRequestGapMs: v } }), 200);

  const toggle = async (f: AutomationFeature, on: boolean) => {
    try {
      await update({ automation: { [f]: on } });
      refreshStatus();
      const needsLive = featureCapabilities(f).some((c) => c.mutating && c.status !== 'verified');
      if (on && needsLive && !a.liveActionsAcknowledged) setLiveOpen(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const StateIcon = state === 'running' ? Play : state === 'stopped' ? OctagonX : Pause;

  return (
    <div className="space-y-5">
      <PageHeader title={t('automation.page.title')} description={t('automation.page.description')} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl ${state === 'running' ? 'bg-success/15 text-success' : state === 'stopped' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'}`}
            >
              <StateIcon size={20} />
            </span>
            <div>
              <p className="text-base font-semibold text-fg" role="status" aria-live="polite">
                {t(`automation.state.${state}`)}
              </p>
              <p className="mt-0.5 max-w-2xl text-xs text-muted">{t(`automation.stateHelp.${state}`)}</p>
              {state === 'stopped' && a.stoppedAt && <p className="mt-1 text-xs text-muted">{t('automation.stoppedAt', { time: new Date(a.stoppedAt).toLocaleString() })}</p>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <AutomationControl state={state} onChange={refreshStatus} />
            <p className="text-[11px] text-muted">
              {t('automation.stopShortcut')} <Kbd>Alt</Kbd>+<Kbd>Shift</Kbd>+<Kbd>S</Kbd>
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('automation.manualVsAuto.title')}>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <Hand size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <div>
                <p className="font-medium text-fg">{t('automation.manual.title')}</p>
                <p className="text-xs text-muted">{t('automation.manual.body')}</p>
              </div>
            </li>
            <li className="flex gap-3">
              <Zap size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <div>
                <p className="font-medium text-fg">{t('automation.auto.title')}</p>
                <p className="text-xs text-muted">{t('automation.auto.body')}</p>
              </div>
            </li>
          </ul>
        </Card>

        <Card
          title={t('live.card.title')}
          actions={a.liveActionsAcknowledged ? <Badge tone="success">{t('live.card.confirmed')}</Badge> : <Badge tone="info">{t('live.card.notConfirmed')}</Badge>}
        >
          <div className="flex items-start gap-3">
            {a.liveActionsAcknowledged ? <ShieldCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden /> : <ShieldQuestion size={18} className="mt-0.5 shrink-0 text-info" aria-hidden />}
            <div className="space-y-2">
              <p className="text-xs text-muted">{t('live.card.body', { count: unverified.length })}</p>
              {a.liveActionsAcknowledged ? (
                <Button size="sm" variant="outline" onClick={() => setRevokeOpen(true)}>
                  {t('live.revoke')}
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setLiveOpen(true)}>
                  {t('live.review')}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <section aria-labelledby="automation-features">
        <h2 id="automation-features" className="mb-3 text-sm font-semibold text-fg">
          {t('automation.features.title')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ALL_FEATURES.map((f) => {
            const st = statusOf(f);
            const caps = featureCapabilities(f);
            return (
              <Card key={f} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-fg">{t(`feature.${f}`)}</h3>
                    <p className="mt-0.5 text-xs text-muted">{t(`automation.featureHelp.${f}`)}</p>
                  </div>
                  {st && <StatusPill status={st.status} reason={reasonText(t, st)} />}
                </div>
                <Switch
                  checked={a[f]}
                  onChange={(v) => void toggle(f, v)}
                  label={t('automation.enableFeature', { feature: t(`feature.${f}`) })}
                  description={reasonText(t, st)}
                />
                {caps.length > 0 && (
                  <ul className="mb-2 flex flex-wrap gap-1" aria-label={t('automation.usesCapabilities')}>
                    {caps.map((c) => (
                      <li key={c.id}>
                        <Badge tone={c.mutating ? (c.status === 'verified' ? 'success' : 'warning') : 'neutral'} title={c.description}>
                          {t(`capability.${c.id}`)}
                          {c.mutating && c.status !== 'verified' ? ` · ${t('live.status.evidenced')}` : ''}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto pt-1">
                  <a href={`#/${FEATURE_ROUTE[f]}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                    {t('automation.configure', { page: t(`nav.${FEATURE_ROUTE[f]}`) })} <ArrowRight size={12} aria-hidden />
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <Card title={t('automation.sync.title')} description={t('automation.sync.description')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('automation.sync.interval')} htmlFor="sync-interval" help={t('automation.sync.intervalHelp')}>
            <Select id="sync-interval" value={String(settings.sync.intervalMinutes)} onChange={(e) => void update({ sync: { intervalMinutes: Number(e.target.value) } })}>
              {[...new Set([...SYNC_INTERVALS, settings.sync.intervalMinutes])].sort((x, y) => x - y).map((m) => (
                <option key={m} value={m}>
                  {t('automation.sync.everyMinutes', { count: m })}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Slider
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Timer size={14} aria-hidden /> {t('automation.sync.gap')}
                </span>
              }
              value={gap}
              min={1000}
              max={60000}
              step={500}
              format={(v) => t('automation.sync.seconds', { value: (v / 1000).toFixed(1) })}
              onChange={setGap}
              description={t('automation.sync.gapHelp')}
            />
          </div>
        </div>
        {gap < 2000 && (
          <div className="mt-3">
            <Callout tone="warning">{t('automation.sync.fastWarning')}</Callout>
          </div>
        )}
      </Card>

      <LiveActionsDialog open={liveOpen} onClose={() => setLiveOpen(false)} onConfirmed={refreshStatus} />
      <ConfirmDialog
        open={revokeOpen}
        title={t('live.revokeTitle')}
        confirmLabel={t('live.revoke')}
        onCancel={() => setRevokeOpen(false)}
        onConfirm={() => {
          void update({ automation: { liveActionsAcknowledged: false } }).then(() => {
            setRevokeOpen(false);
            refreshStatus();
            toast.info(t('live.revoked'));
          });
        }}
      >
        {t('live.revokeBody')}
      </ConfirmDialog>
    </div>
  );
}
