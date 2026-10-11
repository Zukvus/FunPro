import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronUp, ExternalLink, Radar, Rocket, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AutomationStatus } from '@/core/automation/policy';
import { getDb, type BumpState } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import {
  BUMP_DISCOVERY_KEY,
  BUMP_RUNTIME_KEY,
  type BumpRuntime,
  type CycleResult,
  type DiscoveryProgress,
} from '@/features/bump/runner';
import { bumpConfig, isGameSelected, isStopped, plannedAttemptAt } from '@/features/bump/schedule';
import { listingNodes } from '@/features/listings/filters';
import type { Listing } from '@/shared/models';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Input,
  ProgressBar,
  StatusPill,
  Switch,
  toast,
} from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';
import { CheckboxField, errorText, lotsTradeUrl, useFeatureStatus, useFormat, useNow } from './shared';

const STATE_TONE: Record<BumpState['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  idle: 'neutral',
  waiting: 'info',
  raised: 'success',
  error: 'danger',
  needs_selection: 'warning',
};

export function BumpPanel({ listings }: { listings: Listing[] }) {
  const t = useT();
  const fmt = useFormat();
  const now = useNow(30_000);
  const { navigate, refreshStatus } = useDashboard();
  const [settings, update] = useSettings();
  const feature = useFeatureStatus('autoBump');
  const states = useLiveQuery(() => getDb().bumpState.toArray(), []);
  const runtimeRec = useLiveQuery(() => getDb().kv.get(BUMP_RUNTIME_KEY), []);
  const discoveryRec = useLiveQuery(() => getDb().kv.get(BUMP_DISCOVERY_KEY), []);
  const runtime = (runtimeRec?.value ?? null) as BumpRuntime | null;
  const discovery = (discoveryRec?.value ?? null) as DiscoveryProgress | null;
  const [busy, setBusy] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const cfg = bumpConfig(settings);
  const nodeNames = useMemo(() => new Map(listingNodes(listings).map((n) => [n.nodeId, n.name])), [listings]);
  const allNodeIds = useMemo(() => Array.from(new Set((states ?? []).flatMap((s) => s.nodeIds))), [states]);
  const selectMode = settings.bump.nodeIds.length === 0 ? 'all' : 'some';
  const stopped = settings.automation.state === 'stopped';
  const discovering = discovery?.status === 'running' && now - discovery.startedAt < 15 * 60_000;

  const raise = async (gameId?: string) => {
    setBusy(gameId ?? 'all');
    try {
      const res = await rpc<CycleResult>('ui.bumpNow', gameId ? { gameId } : {});
      const raised = res.results.filter((r) => r.result === 'raised').length;
      const cooldown = res.results.filter(
        (r) => r.result === 'cooldown' || r.skipReason === 'cooldown',
      ).length;
      const failed = res.results.filter((r) => r.result === 'failed').length;
      const tooSoon = res.results.filter((r) => r.skipReason === 'too_soon').length;
      const msg = t('listings.bump.result', { raised, cooldown, failed });
      if (failed) toast.error(msg);
      else toast.success(tooSoon && !raised && !cooldown ? t('listings.bump.tooSoon') : msg);
      refreshStatus();
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(null);
    }
  };

  const discover = async () => {
    setBusy('discover');
    try {
      const p = await rpc<DiscoveryProgress>('ui.discoverBumpTargets', {});
      toast.success(t('listings.bump.discover.done', { games: p.games, nodes: p.done }));
      if (p.errors.length) toast.error(t('listings.bump.discover.partial', { count: p.errors.length }));
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(null);
    }
  };

  const resume = async (gameId: string) => {
    setBusy(`resume:${gameId}`);
    try {
      await rpc('ui.bump.resume', { gameId });
      toast.success(t('listings.bump.resumed'));
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(null);
    }
  };

  const setSelectMode = (mode: 'all' | 'some') => {
    if (mode === 'all') void update({ bump: { nodeIds: [] } });
    else if (allNodeIds.length) void update({ bump: { nodeIds: allNodeIds } });
  };

  const toggleNode = (nodeId: string, on: boolean) => {
    const cur = new Set(settings.bump.nodeIds.length ? settings.bump.nodeIds : allNodeIds);
    if (on) cur.add(nodeId);
    else cur.delete(nodeId);
    if (cur.size === 0) {
      toast.info(t('listings.bump.select.noneHint'));
      return;
    }
    void update({ bump: { nodeIds: [...cur] } });
  };

  const gameStatus = (s: BumpState): AutomationStatus => {
    if (!isGameSelected(s, cfg.selectedNodeIds)) return 'disabled';
    if (isStopped(s, cfg)) return 'blocked';
    return feature?.status ?? 'disabled';
  };

  return (
    <Card
      className="mb-5"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {t('listings.bump.title')}
          {feature && <StatusPill status={feature.status} reason={feature.reason} />}
        </span>
      }
      description={t('listings.bump.description')}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            icon={<Radar size={14} aria-hidden />}
            loading={busy === 'discover' || discovering}
            onClick={() => void discover()}
          >
            {t('listings.bump.discover')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<Rocket size={14} aria-hidden />}
            disabled={stopped || !states?.length}
            loading={busy === 'all'}
            onClick={() => void raise()}
          >
            {t('listings.bump.raiseAll')}
          </Button>
        </>
      }
    >
      <Switch
        checked={settings.automation.autoBump}
        onChange={(v) => void update({ automation: { autoBump: v } }).then(refreshStatus)}
        label={t('listings.bump.toggle')}
        description={t('listings.bump.toggle.help')}
      />
      <div className="mt-2 space-y-2">
        {stopped && (
          <Callout tone="danger" title={t('listings.gate.stopped.title')}>
            {t('listings.bump.stoppedBody')}
          </Callout>
        )}
        {!stopped && feature?.status === 'awaiting_authorization' && (
          <Callout tone="info" title={t('listings.gate.ack.title')}>
            <p>{t('listings.bump.ackBody')}</p>
            <Button className="mt-2" size="sm" variant="primary" onClick={() => navigate('automation')}>
              {t('listings.gate.ack.cta')}
            </Button>
          </Callout>
        )}
        {!stopped && feature?.status === 'paused' && (
          <Callout tone="warning">{t('listings.bump.pausedBody')}</Callout>
        )}
        {!stopped && feature?.status === 'blocked' && (
          <Callout tone="warning" title={t('listings.bump.waitingTab')}>
            {feature.reason}
            {runtime?.awaitingTabSince
              ? ` — ${t('listings.bump.waitingSince', { time: fmt.relative(runtime.awaitingTabSince, now) })}`
              : ''}
          </Callout>
        )}
        {feature?.status === 'running' && runtime?.awaitingTabSince && (
          <Callout tone="warning" title={t('listings.bump.waitingTab')}>
            {t('listings.bump.waitingSince', { time: fmt.relative(runtime.awaitingTabSince, now) })}
          </Callout>
        )}
        {feature?.status === 'running' && runtime?.nextAlarmAt && (
          <p className="text-xs text-muted">
            {t('listings.bump.nextCheck', {
              time: `${fmt.dateTime(runtime.nextAlarmAt)} (${fmt.relative(runtime.nextAlarmAt, now)})`,
            })}
          </p>
        )}
        {discovery && (discovering || discovery.status === 'failed') && (
          <div className="rounded-lg bg-surface-2 p-3 text-xs">
            <p className="mb-1 font-medium">
              {discovering
                ? t('listings.bump.discover.running', { done: discovery.done, total: discovery.total })
                : t('listings.bump.discover.failed')}
            </p>
            {discovering && (
              <ProgressBar
                value={discovery.done}
                max={Math.max(1, discovery.total)}
                label={t('listings.bump.discover')}
              />
            )}
            {discovery.errors.slice(0, 3).map((e) => (
              <p key={e} className="mt-1 text-danger">
                {e}
              </p>
            ))}
          </div>
        )}
      </div>

      {!states ? null : states.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title={t('listings.bump.empty.title')}
            action={
              <Button size="sm" onClick={() => void discover()} loading={busy === 'discover'}>
                {t('listings.bump.discover')}
              </Button>
            }
          >
            {t('listings.bump.empty.body')}
          </EmptyState>
        </div>
      ) : (
        <>
          <fieldset className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <legend className="mb-1 text-xs font-medium text-muted">
              {t('listings.bump.select.legend')}
            </legend>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="bump-select"
                checked={selectMode === 'all'}
                onChange={() => setSelectMode('all')}
              />
              {t('listings.bump.select.all')}
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="bump-select"
                checked={selectMode === 'some'}
                onChange={() => setSelectMode('some')}
              />
              {t('listings.bump.select.some')}
            </label>
          </fieldset>
          <ul
            className="mt-3 divide-y divide-border rounded-xl border border-border"
            aria-label={t('listings.bump.games')}
          >
            {states.map((s) => {
              const planned = plannedAttemptAt(s, cfg);
              const stoppedGame = isStopped(s, cfg);
              return (
                <li
                  key={s.gameId}
                  className="flex flex-col gap-2 p-3 md:flex-row md:items-start md:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">
                        {s.categoryName || t('listings.bump.game', { id: s.gameId })}
                      </span>
                      <StatusPill
                        status={gameStatus(s)}
                        reason={
                          stoppedGame
                            ? t('listings.bump.stoppedGame', { count: s.consecutiveFailures })
                            : (feature?.reason ?? '')
                        }
                      />
                      <Badge tone={STATE_TONE[s.status]}>{t(`listings.bump.state.${s.status}`)}</Badge>
                      {s.consecutiveFailures > 0 && (
                        <Badge tone="danger">
                          {t('listings.bump.failures', { count: s.consecutiveFailures })}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {s.nodeIds.map((n) =>
                        selectMode === 'some' ? (
                          <CheckboxField
                            key={n}
                            checked={settings.bump.nodeIds.includes(n)}
                            onChange={(v) => toggleNode(n, v)}
                            label={<span className="text-xs">{nodeNames.get(n) || `#${n}`}</span>}
                          />
                        ) : (
                          <a
                            key={n}
                            href={lotsTradeUrl(n)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
                          >
                            {nodeNames.get(n) || `#${n}`} <ExternalLink size={11} aria-hidden />
                          </a>
                        ),
                      )}
                    </div>
                    <dl className="mt-1 grid grid-cols-1 gap-x-4 text-xs text-muted sm:grid-cols-3">
                      <div>
                        <dt className="inline">{t('listings.bump.nextEligible')}: </dt>
                        <dd className="inline text-fg">
                          {s.nextEligibleAt
                            ? `${fmt.relative(s.nextEligibleAt, now)}`
                            : t('listings.bump.unknown')}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">{t('listings.bump.nextAttempt')}: </dt>
                        <dd className="inline text-fg">
                          {planned === null
                            ? t('listings.bump.stopped')
                            : planned <= now
                              ? t('listings.bump.due')
                              : fmt.relative(planned, now)}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">{t('listings.bump.lastSuccess')}: </dt>
                        <dd className="inline text-fg">
                          {s.lastSuccessAt ? fmt.relative(s.lastSuccessAt, now) : t('common.never')}
                        </dd>
                      </div>
                    </dl>
                    {s.lastMessage && (
                      <p className="mt-1 truncate text-xs text-muted" title={s.lastMessage}>
                        {t('listings.bump.lastMessage')}: {s.lastMessage}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {(stoppedGame || s.status === 'error' || s.status === 'needs_selection') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<RotateCcw size={14} aria-hidden />}
                        loading={busy === `resume:${s.gameId}`}
                        onClick={() => void resume(s.gameId)}
                      >
                        {t('listings.bump.resume')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      icon={<Rocket size={14} aria-hidden />}
                      disabled={stopped}
                      loading={busy === s.gameId}
                      onClick={() => void raise(s.gameId)}
                      aria-label={t('listings.bump.raiseOne', { name: s.categoryName || s.gameId })}
                    >
                      {t('listings.bump.raiseNow')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"
        aria-expanded={showSettings}
        onClick={() => setShowSettings((v) => !v)}
      >
        {showSettings ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        {t('listings.bump.settings')}
      </button>
      {showSettings && <BumpSettings />}
    </Card>
  );
}

function BumpSettings() {
  const t = useT();
  const [settings, update] = useSettings();
  const [interval, setInterval_] = useState(String(settings.bump.minIntervalMinutes));
  const [maxFail, setMaxFail] = useState(String(settings.bump.maxConsecutiveFailures));
  const intervalNum = Number(interval);
  const intervalOk = Number.isInteger(intervalNum) && intervalNum >= 30 && intervalNum <= 1440;
  const maxNum = Number(maxFail);
  const maxOk = Number.isInteger(maxNum) && maxNum >= 1 && maxNum <= 20;
  return (
    <div className="mt-2 grid gap-3 rounded-xl bg-surface-2 p-3 md:grid-cols-2">
      <Field
        label={t('listings.bump.minInterval')}
        help={t('listings.bump.minInterval.help')}
        error={intervalOk ? undefined : t('listings.bump.minInterval.error')}
      >
        <Input
          type="number"
          min={30}
          max={1440}
          value={interval}
          onChange={(e) => setInterval_(e.target.value)}
          onBlur={() =>
            intervalOk &&
            intervalNum !== settings.bump.minIntervalMinutes &&
            void update({ bump: { minIntervalMinutes: intervalNum } })
          }
        />
      </Field>
      <Field
        label={t('listings.bump.maxFailures')}
        help={t('listings.bump.maxFailures.help')}
        error={maxOk ? undefined : t('listings.bump.maxFailures.error')}
      >
        <Input
          type="number"
          min={1}
          max={20}
          value={maxFail}
          onChange={(e) => setMaxFail(e.target.value)}
          onBlur={() =>
            maxOk &&
            maxNum !== settings.bump.maxConsecutiveFailures &&
            void update({ bump: { maxConsecutiveFailures: maxNum } })
          }
        />
      </Field>
      <Switch
        checked={settings.bump.notifyOnSuccess}
        onChange={(v) => void update({ bump: { notifyOnSuccess: v } })}
        label={t('listings.bump.notifySuccess')}
      />
      <Switch
        checked={settings.bump.notifyOnFailure}
        onChange={(v) => void update({ bump: { notifyOnFailure: v } })}
        label={t('listings.bump.notifyFailure')}
      />
      <p className="text-xs text-muted md:col-span-2">{t('listings.bump.cooldownNote')}</p>
    </div>
  );
}
