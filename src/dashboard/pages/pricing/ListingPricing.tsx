import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, FlaskConical, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { recommendPrice } from '@/features/pricing/engine';
import { commissionFor, loadListingMarket } from '@/features/pricing/context';
import { classifyOffers, historySeries } from '@/features/pricing/market';
import {
  defaultRule,
  getChangeLog,
  getEvalMark,
  getFetchMark,
  getSimulation,
  markSimulated,
  saveRule,
  type PriceRuleExt,
} from '@/features/pricing/model';
import { simulateRepricing, type SimulationResult } from '@/features/pricing/simulate';
import { useSettings } from '@/ui/hooks/useSettings';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Select,
  Spinner,
  StatCard,
  Switch,
  toast,
} from '@/ui/components';
import { useT } from '@/ui/i18n';
import {
  dateTime,
  errorText,
  FeatureStatusPill,
  money,
  parseAmountInput,
  useFeatureStatus,
  useLocaleTag,
} from '../inventory/common';
import { PositionChart, TimeLines } from './charts';
import { RuleForm } from './RuleForm';

const DAY = 86400_000;

export function ListingPricing({ listingId }: { listingId: string }) {
  const t = useT();
  const locale = useLocaleTag();
  const [settings] = useSettings();
  const repricing = useFeatureStatus('repricing');
  const market = useLiveQuery(() => loadListingMarket(listingId), [listingId]);
  const changeLog = useLiveQuery(() => getChangeLog(listingId), [listingId], []);
  const simMark = useLiveQuery(() => getSimulation(listingId), [listingId]);
  const evalMark = useLiveQuery(() => getEvalMark(listingId), [listingId]);
  const nodeId = market?.listing.nodeId ?? null;
  const fetchMark = useLiveQuery(async () => (nodeId ? getFetchMark(nodeId) : null), [nodeId]);
  const [draft, setDraft] = useState<PriceRuleExt | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [simDays, setSimDays] = useState(14);
  const [sim, setSim] = useState<SimulationResult | null>(null);

  const fallbackRule = useMemo(
    () => (market ? defaultRule(listingId, market.current.minor) : null),
    [market, listingId],
  );
  const rule = draft ?? market?.rule ?? fallbackRule;
  const costText =
    cost ?? (market?.listing.costMinor != null ? (market.listing.costMinor / 100).toFixed(2) : '');
  const costMinor = costText.trim() === '' ? null : parseAmountInput(costText);
  const commission = market ? commissionFor(settings, market.listing) : null;
  const currency = market?.listing.price.currency ?? 'UNKNOWN';
  const now = Date.now();

  const rec = useMemo(() => {
    if (!market || !rule) return null;
    const applied = changeLog.filter((e) => e.mode === 'auto').map((e) => e.at);
    return recommendPrice({
      rule,
      listing: { id: market.listing.id, title: market.listing.title },
      currentPriceMinor: market.current.minor,
      currency,
      costMinor,
      commissionPct: commission,
      offers: market.offers,
      own: market.own,
      appliedAt: applied,
      now,
    });
    // `now` changes every render by design; recomputation is cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, rule, changeLog, costMinor, commission, currency]);

  const classified = useMemo(() => {
    if (!market || !rule) return [];
    return classifyOffers(market.offers, {
      title: market.listing.title,
      currency,
      currentPriceMinor: market.current.minor,
      own: market.own,
      ignoreSellers: rule.ignoreSellers,
      minSimilarity: rule.minSimilarity,
      priceBandPct: rule.priceBandPct,
    });
  }, [market, rule, currency]);

  const history = useMemo(() => {
    if (!market || !rule) return [];
    return historySeries(market.history, {
      title: market.listing.title,
      currency,
      own: market.own,
      ignoreSellers: rule.ignoreSellers,
      minSimilarity: rule.minSimilarity,
      priceBandPct: rule.priceBandPct,
      listingId,
      fallbackPriceMinor: market.current.minor,
    }).map((p) => ({ at: p.at, own: p.ownMinor, lowest: p.lowestMinor, median: p.medianMinor }));
  }, [market, rule, currency, listingId]);

  if (market === undefined) return <Spinner />;
  if (market === null || !rule) return <p className="text-sm text-muted">{t('ops.price.notFound')}</p>;
  const l = market.listing;
  const comparable = classified.filter((c) => c.excluded === null);
  const positionRows = [
    ...comparable.map((c) => ({
      id: c.offer.offerId,
      seller: c.offer.sellerName,
      priceMinor: c.offer.price.amountMinor,
      mine: false,
    })),
    { id: l.id, seller: '', priceMinor: market.current.minor, mine: true },
  ]
    .sort((a, b) => a.priceMinor - b.priceMinor)
    .slice(0, 40);
  const stale =
    market.observedAt !== null && now - market.observedAt > settings.pricing.maxDataAgeMinutes * 60_000;

  const refresh = async () => {
    if (!nodeId) return;
    setBusy('fetch');
    try {
      const res = await rpc<{ offers: number; changes: number }>('ui.fetchCompetitors', { nodeId });
      toast.success(t('ops.price.fetched', { n: res.offers }));
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(null);
    }
  };

  const save = async (enabled = rule.enabled) => {
    setBusy('save');
    try {
      if (costText.trim() !== '' && costMinor === null) throw new Error(t('ops.common.invalidNumber'));
      await saveRule({ ...rule, enabled });
      if (costMinor !== l.costMinor) await getDb().listings.update(l.id, { costMinor });
      setDraft(null);
      setCost(null);
      toast.success(t('ops.price.rule.saved'));
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(null);
    }
  };

  const runSimulation = async () => {
    const res = simulateRepricing({
      rule,
      listing: { id: l.id, title: l.title, priceMinor: market.current.minor, currency, costMinor },
      snapshots: market.snapshots,
      own: market.own,
      commissionPct: commission,
      from: now - simDays * DAY,
      to: now,
    });
    setSim(res);
    await markSimulated(l.id, { at: Date.now(), days: simDays, changes: res.changes.length });
  };

  const apply = async () => {
    if (rec?.targetMinor == null) return;
    setBusy('apply');
    try {
      const res = await rpc<{ changed: boolean; formFrom: string; formTo: string }>('ui.pricing.apply', {
        listingId: l.id,
        targetMinor: rec.targetMinor,
        confirm: true,
      });
      toast.success(
        res.changed
          ? t('ops.price.applied', { from: res.formFrom, to: res.formTo })
          : t('ops.price.unchanged'),
      );
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(null);
      setConfirmApply(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={l.title}
        description={`${l.categoryName}${nodeId ? ` · ${t('ops.price.nodeLabel', { id: nodeId })}` : ''}`}
        actions={
          <>
            {nodeId && (
              <a
                className="inline-flex items-center gap-1 text-xs text-accent"
                href={`https://funpay.com/lots/${encodeURIComponent(nodeId)}/`}
                target="_blank"
                rel="noreferrer"
              >
                {t('ops.price.openCategory')} <ExternalLink size={12} />
              </a>
            )}
            <Button
              size="sm"
              icon={<RefreshCw size={14} />}
              onClick={refresh}
              loading={busy === 'fetch'}
              disabled={!nodeId}
            >
              {t('ops.price.refresh')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-xs text-muted">
          {market.observedAt
            ? t('ops.price.observed', { at: dateTime(market.observedAt, locale) })
            : t('ops.price.neverObserved')}
          {fetchMark &&
            !fetchMark.ok &&
            ` · ${t('ops.price.lastFetchFailed', { error: fetchMark.error ?? '' })}`}
        </p>
        {stale && <Callout tone="warning">{t('ops.price.stale')}</Callout>}
        <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard
            label={t('ops.price.stat.yours')}
            value={money(market.current.minor, currency, locale)}
            hint={t(`ops.price.source.${market.current.source}`)}
          />
          <StatCard
            label={t('ops.price.stat.lowest')}
            value={money(rec?.stats.lowestMinor, currency, locale)}
          />
          <StatCard
            label={t('ops.price.stat.median')}
            value={money(rec?.stats.medianMinor, currency, locale)}
          />
          <StatCard
            label={t('ops.price.stat.rank')}
            value={rec ? `${rec.stats.rank} / ${rec.stats.total}` : '—'}
          />
          <StatCard
            label={t('ops.price.stat.comparable')}
            value={comparable.length}
            hint={t('ops.price.stat.ofOffers', { n: classified.length })}
          />
        </div>
      </Card>

      {market.offers.length === 0 ? (
        <Callout tone="info" title={t('ops.price.noData')}>
          {t('ops.price.noDataBody')}
        </Callout>
      ) : (
        <Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <PositionChart rows={positionRows} currency={currency} locale={locale} />
            <TimeLines
              title={t('ops.price.chart.history')}
              caption={t('ops.price.chart.historyCaption')}
              data={history}
              series={[
                { key: 'own', label: t('ops.price.chart.you') },
                { key: 'lowest', label: t('ops.price.chart.lowest') },
                { key: 'median', label: t('ops.price.chart.median') },
              ]}
              currency={currency}
              locale={locale}
            />
          </div>
        </Card>
      )}

      {classified.length > 0 && (
        <Card title={t('ops.price.table.title')} description={t('ops.price.table.description')}>
          <div className="max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left">{t('ops.price.table.seller')}</th>
                  <th className="px-2 py-1.5 text-left">{t('ops.price.table.offer')}</th>
                  <th className="px-2 py-1.5 text-right">{t('ops.price.chart.price')}</th>
                  <th className="px-2 py-1.5 text-right">{t('ops.price.table.similarity')}</th>
                  <th className="px-2 py-1.5 text-left">{t('ops.price.table.status')}</th>
                </tr>
              </thead>
              <tbody>
                {classified.map((c) => (
                  <tr key={c.offer.offerId} className={c.excluded ? 'text-muted' : ''}>
                    <td className="px-2 py-1">
                      {c.offer.sellerName || '—'}
                      {c.offer.online && <span className="ml-1 text-success">●</span>}
                      {c.offer.promoted && <Badge className="ml-1">{t('ops.price.table.promoted')}</Badge>}
                    </td>
                    <td className="max-w-[320px] truncate px-2 py-1" title={c.offer.title}>
                      <a
                        className="hover:underline"
                        href={`https://funpay.com/lots/offer?id=${encodeURIComponent(c.offer.offerId)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {c.offer.title || `#${c.offer.offerId}`}
                      </a>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {money(c.offer.price.amountMinor, c.offer.price.currency, locale)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{Math.round(c.similarity * 100)}%</td>
                    <td className="px-2 py-1">
                      {c.excluded ? (
                        t(`ops.price.excl.${c.excluded}`)
                      ) : (
                        <Badge tone="success">{t('ops.price.table.comparable')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title={t('ops.price.rule.title')}
        description={t('ops.price.rule.description')}
        actions={
          <Button size="sm" variant="primary" onClick={() => void save()} loading={busy === 'save'}>
            {t('ops.price.rule.save')}
          </Button>
        }
      >
        <RuleForm
          key={`${listingId}:${market.rule ? 'saved' : 'new'}`}
          rule={rule}
          onChange={setDraft}
          currency={currency}
          cost={costText}
          onCost={setCost}
        />
        <p className="mt-3 text-xs text-muted">
          {commission === null
            ? t('ops.price.commissionUnknown')
            : t('ops.price.commissionKnown', { pct: commission })}
        </p>
      </Card>

      {rec && (
        <Card title={t('ops.price.rec.title')} description={t('ops.price.rec.description')}>
          <div className="flex flex-wrap items-center gap-3">
            {rec.targetMinor !== null && rec.targetMinor !== rec.currentMinor ? (
              <p className="text-sm">
                {t('ops.price.rec.target', {
                  from: money(rec.currentMinor, currency, locale),
                  to: money(rec.targetMinor, currency, locale),
                })}
              </p>
            ) : (
              <p className="text-sm">
                {t('ops.price.rec.keep', { price: money(rec.currentMinor, currency, locale) })}
              </p>
            )}
            {rec.hold && (
              <Badge tone={rec.hold === 'already_optimal' ? 'success' : 'warning'}>
                {t(`ops.price.hold.${rec.hold}`)}
              </Badge>
            )}
            {rec.notes.map((n) => (
              <Badge key={n} tone="info">
                {t(`ops.price.note.${n}`)}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">
            {t('ops.price.rec.bounds', {
              floor: money(rec.floorMinor, currency, locale),
              ceiling: money(rec.ceilingMinor, currency, locale),
              margin: money(rec.marginFloorMinor, currency, locale),
            })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={rec.targetMinor === null || rec.targetMinor === rec.currentMinor || !!draft}
              onClick={() => setConfirmApply(true)}
              loading={busy === 'apply'}
            >
              {t('ops.price.rec.apply')}
            </Button>
            {draft && <span className="text-xs text-muted">{t('ops.price.rec.saveFirst')}</span>}
            <Badge tone="info">{t('ops.common.requiresLiveVerification')}</Badge>
          </div>
        </Card>
      )}

      <Card
        title={
          <span className="flex items-center gap-2">
            <FlaskConical size={14} /> {t('ops.price.sim.title')}
          </span>
        }
        description={t('ops.price.sim.description')}
        actions={
          <>
            <Select
              value={simDays}
              onChange={(e) => setSimDays(Number(e.target.value))}
              className="w-32"
              aria-label={t('ops.price.sim.period')}
            >
              {[7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {t('ops.price.sim.days', { n: d })}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={() => void runSimulation()}>
              {t('ops.price.sim.run')}
            </Button>
          </>
        }
      >
        {simMark && !sim && (
          <p className="text-xs text-muted">
            {t('ops.price.sim.lastRun', {
              at: dateTime(simMark.at, locale),
              n: simMark.changes,
              days: simMark.days,
            })}
          </p>
        )}
        {sim && (
          <div className="flex flex-col gap-3">
            {sim.evaluations === 0 ? (
              <Callout tone="info">{t('ops.price.sim.noHistory')}</Callout>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatCard
                    label={t('ops.price.sim.changes')}
                    value={sim.changes.length}
                    hint={t('ops.price.sim.evaluations', { n: sim.evaluations })}
                  />
                  <StatCard
                    label={t('ops.price.sim.start')}
                    value={money(sim.startMinor, currency, locale)}
                  />
                  <StatCard label={t('ops.price.sim.end')} value={money(sim.endMinor, currency, locale)} />
                  <StatCard
                    label={t('ops.price.sim.range')}
                    value={`${money(sim.minMinor, currency, locale)} – ${money(sim.maxMinor, currency, locale)}`}
                  />
                </div>
                {Object.keys(sim.holds).length > 0 && (
                  <p className="text-xs text-muted">
                    {t('ops.price.sim.holds')}{' '}
                    {Object.entries(sim.holds)
                      .map(([k, v]) => `${t(`ops.price.hold.${k}`)}: ${v}`)
                      .join(' · ')}
                  </p>
                )}
                <TimeLines
                  title={t('ops.price.sim.chart')}
                  caption={t('ops.price.sim.caveat')}
                  data={sim.points.map((p) => ({
                    at: p.at,
                    simulated: p.simulatedMinor,
                    lowest: p.lowestMinor,
                    actual: p.actualMinor,
                  }))}
                  series={[
                    { key: 'simulated', label: t('ops.price.sim.simulated') },
                    { key: 'lowest', label: t('ops.price.chart.lowest') },
                    { key: 'actual', label: t('ops.price.sim.actual') },
                  ]}
                  currency={currency}
                  locale={locale}
                />
              </>
            )}
          </div>
        )}
      </Card>

      <Card title={t('ops.price.auto.title')} actions={<FeatureStatusPill feature="repricing" />}>
        <Switch
          checked={market.rule?.enabled ?? false}
          disabled={!simMark || !market.rule || busy === 'save'}
          onChange={(v) => void save(v)}
          label={t('ops.price.auto.enable')}
          description={
            !market.rule
              ? t('ops.price.auto.saveFirst')
              : !simMark
                ? t('ops.price.auto.simulateFirst')
                : t('ops.price.auto.enableHelp')
          }
        />
        {repricing && repricing.status !== 'running' && (
          <p className="text-xs text-muted">
            {t('ops.price.auto.featureStatus', { reason: repricing.reason })}
          </p>
        )}
        {evalMark && (
          <p className="mt-1 text-xs text-muted">
            {t('ops.price.auto.lastEval', {
              at: dateTime(evalMark.at, locale),
              outcome: t(`ops.price.outcome.${evalMark.outcome}`),
              detail: evalMark.detail ?? '',
            })}
          </p>
        )}
        {changeLog.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold text-muted">{t('ops.price.auto.log')}</p>
            <ul className="flex flex-col gap-1 text-xs">
              {changeLog.slice(0, 20).map((e) => (
                <li key={e.at} className="flex flex-wrap gap-2">
                  <span className="text-muted">{dateTime(e.at, locale)}</span>
                  <Badge tone={e.mode === 'auto' ? 'accent' : 'neutral'}>
                    {t(`ops.price.mode.${e.mode}`)}
                  </Badge>
                  <span>
                    {t('ops.price.auto.logEntry', {
                      from: e.formFrom,
                      to: e.formTo,
                      buyer: money(e.toMinor, currency, locale),
                      pct: e.commissionPct,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmApply}
        title={t('ops.price.rec.confirmTitle')}
        confirmLabel={t('ops.price.rec.apply')}
        busy={busy === 'apply'}
        onCancel={() => setConfirmApply(false)}
        onConfirm={() => void apply()}
      >
        {rec?.targetMinor != null &&
          t('ops.price.rec.confirmBody', { to: money(rec.targetMinor, currency, locale), title: l.title })}
      </ConfirmDialog>
    </div>
  );
}
