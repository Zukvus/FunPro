import { useLiveQuery } from 'dexie-react-hooks';
import { TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { isFlagEnabled } from '@/core/flags/flags';
import { readLastSession } from '@/features/pricing/context';
import { buildHistory, classifyOffers, marketStats, ownPriceAt, stateAt } from '@/features/pricing/market';
import { toRule } from '@/features/pricing/model';
import type { Listing } from '@/shared/models';
import { useSettings } from '@/ui/hooks/useSettings';
import { Badge, Callout, Card, EmptyState, Input, PageHeader, Select, Spinner, Switch } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { FeatureStatusPill, money, useLocaleTag } from './inventory/common';
import { ListingPricing } from './pricing/ListingPricing';

interface Summary {
  listing: Listing;
  rank: number | null;
  total: number | null;
  lowestMinor: number | null;
  ruleEnabled: boolean;
}

/** One pass per node: latest market state, then rank / lowest for each own listing. */
async function loadSummaries(): Promise<Summary[]> {
  const db = getDb();
  const listings = (await db.listings.orderBy('sortIndex').toArray()).slice(0, 500);
  const rules = new Map((await db.priceRules.toArray()).map((r) => [r.listingId, toRule(r)]));
  const session = await readLastSession();
  const own = { listingIds: listings.map((l) => l.id), sellerId: session?.userId ?? null, sellerName: session?.username ?? null };
  const since = new Date(Date.now() - 2 * 86400_000).toISOString();
  const byNode = new Map<string, Listing[]>();
  for (const l of listings) if (l.nodeId) byNode.set(l.nodeId, [...(byNode.get(l.nodeId) ?? []), l]);
  const out = new Map<string, Summary>();
  for (const [nodeId, ls] of byNode) {
    const snaps = await db.competitorSnapshots.where('[nodeId+at]').between([nodeId, since], [nodeId, '\uffff']).toArray();
    const history = buildHistory(snaps);
    const at = history.times.at(-1);
    if (at === undefined) continue;
    const state = stateAt(history, at);
    for (const l of ls) {
      const rule = rules.get(l.id);
      const ownPrice = ownPriceAt(history, l.id, at);
      const current = ownPrice && ownPrice.currency === l.price.currency ? ownPrice.amountMinor : l.price.amountMinor;
      const prices = classifyOffers(state, { title: l.title, currency: l.price.currency, currentPriceMinor: current, own, ignoreSellers: rule?.ignoreSellers, minSimilarity: rule?.minSimilarity, priceBandPct: rule?.priceBandPct ?? 50 })
        .filter((c) => c.excluded === null)
        .map((c) => c.offer.price.amountMinor);
      const s = marketStats(prices, current);
      out.set(l.id, { listing: l, rank: prices.length ? s.rank : null, total: prices.length ? s.total : null, lowestMinor: s.lowestMinor, ruleEnabled: !!rule?.enabled });
    }
  }
  return listings.map((l) => out.get(l.id) ?? { listing: l, rank: null, total: null, lowestMinor: null, ruleEnabled: !!rules.get(l.id)?.enabled });
}

export default function PricingPage() {
  const t = useT();
  const locale = useLocaleTag();
  const [settings, update] = useSettings();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const summaries = useLiveQuery(loadSummaries, []);
  const enabled = isFlagEnabled('pricingIntelligence', settings.flags);

  if (!enabled) {
    return (
      <div>
        <PageHeader title={t('ops.price.title')} />
        <EmptyState title={t('ops.common.flagOff')}>{t('ops.common.flagOffBody')}</EmptyState>
      </div>
    );
  }

  const visible = (summaries ?? []).filter((s) => !search || s.listing.title.toLowerCase().includes(search.toLowerCase()));
  const current = selected ?? visible[0]?.listing.id ?? null;
  const p = settings.pricing;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('ops.price.title')}
        description={t('ops.price.description')}
        actions={
          <span className="flex items-center gap-2 text-xs text-muted">
            {t('ops.price.repricing')} <FeatureStatusPill feature="repricing" />
          </span>
        }
      />
      <Callout tone="info" title={t('ops.price.source.title')}>
        {t('ops.price.source.body')}
      </Callout>
      <Card title={t('ops.price.settings.title')}>
        <div className="grid gap-x-6 md:grid-cols-2">
          <Switch checked={p.alertOnUndercut} onChange={(v) => void update({ pricing: { alertOnUndercut: v } })} label={t('ops.price.settings.alert')} description={t('ops.price.settings.alertHelp')} />
          <Switch checked={p.autoFetch} onChange={(v) => void update({ pricing: { autoFetch: v } })} label={t('ops.price.settings.autoFetch')} description={t('ops.price.settings.autoFetchHelp')} />
          <div className="flex items-center justify-between gap-3 py-2">
            <label htmlFor="pf-int" className="text-sm font-medium text-fg">
              {t('ops.price.settings.interval')}
            </label>
            <Select id="pf-int" className="w-40" value={p.autoFetchIntervalMinutes} onChange={(e) => void update({ pricing: { autoFetchIntervalMinutes: Number(e.target.value) } })}>
              {[60, 120, 180, 360, 720, 1440].map((m) => (
                <option key={m} value={m}>
                  {t('ops.price.settings.minutes', { n: m })}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 py-2">
            <label htmlFor="pf-age" className="text-sm font-medium text-fg">
              {t('ops.price.settings.maxAge')}
            </label>
            <Select id="pf-age" className="w-40" value={p.maxDataAgeMinutes} onChange={(e) => void update({ pricing: { maxDataAgeMinutes: Number(e.target.value) } })}>
              {[30, 60, 120, 180, 360, 720].map((m) => (
                <option key={m} value={m}>
                  {t('ops.price.settings.minutes', { n: m })}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>
      {summaries === undefined ? (
        <Spinner />
      ) : summaries.length === 0 ? (
        <EmptyState icon={<TrendingUp size={28} />} title={t('ops.price.noListings')}>
          {t('ops.price.noListingsBody')}
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <nav aria-label={t('ops.price.listings')} className="flex flex-col gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('common.search')} aria-label={t('common.search')} />
            <ul className="flex max-h-[70vh] flex-col gap-1 overflow-auto">
              {visible.map((s) => (
                <li key={s.listing.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.listing.id)}
                    aria-current={current === s.listing.id ? 'true' : undefined}
                    className={cn('w-full rounded-lg border px-3 py-2 text-left', current === s.listing.id ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-surface-2')}
                  >
                    <span className="block truncate text-sm text-fg">{s.listing.title || `#${s.listing.id}`}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      <span className="tabular-nums">{money(s.listing.price.amountMinor, s.listing.price.currency, locale)}</span>
                      {s.rank !== null && <Badge tone={s.rank === 1 ? 'success' : 'neutral'}>{t('ops.price.rankShort', { rank: s.rank, total: s.total ?? 0 })}</Badge>}
                      {s.lowestMinor !== null && <span>{t('ops.price.lowestShort', { price: money(s.lowestMinor, s.listing.price.currency, locale) })}</span>}
                      {s.ruleEnabled && <Badge tone="accent">{t('ops.price.autoBadge')}</Badge>}
                      {!s.listing.active && <Badge>{t('ops.price.inactive')}</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <section className="min-w-0">{current && <ListingPricing key={current} listingId={current} />}</section>
        </div>
      )}
    </div>
  );
}
