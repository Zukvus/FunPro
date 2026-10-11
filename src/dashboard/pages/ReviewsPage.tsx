import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw, Star } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@/core/messaging/client';
import { getDb } from '@/core/db/db';
import { DEFAULT_REVIEW_FILTER, loadReviewRows, reviewStats, type ReviewFilter } from '@/features/reviews';
import {
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  StatCard,
  Switch,
  Tabs,
  toast,
} from '@/ui/components';
import { useT } from '@/ui/i18n';
import { useAiStatus } from './ai/shared';
import { AutoReplyCard } from './reviews/AutoReplyCard';
import { FeedbackPanel } from './reviews/FeedbackPanel';
import { ReviewCard } from './reviews/ReviewCard';
import { TemplatesPanel } from './reviews/TemplatesPanel';

const PAGE = 30;

export default function ReviewsPage() {
  const t = useT();
  const [tab, setTab] = useState<'reviews' | 'templates' | 'feedback'>('reviews');
  const [filter, setFilter] = useState<ReviewFilter>(DEFAULT_REVIEW_FILTER);
  const [limit, setLimit] = useState(PAGE);
  const [syncing, setSyncing] = useState(false);
  const { status: aiStatus } = useAiStatus();

  const rows = useLiveQuery(() => loadReviewRows(filter, 2000), [filter]);
  const stats = useLiveQuery(() => reviewStats(), []);
  const templates = useLiveQuery(() => getDb().reviewTemplates.toArray(), []) ?? [];

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await rpc<Record<string, string>>('ui.syncNow', { what: ['reviews'] });
      const outcome = res['reviews'];
      if (outcome === undefined) toast.info(t('reviews.syncPassive'));
      else if (outcome !== 'ok') toast.error(outcome);
      else toast.success(t('reviews.synced'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('reviews.title')}
        description={t('reviews.description')}
        actions={
          <Button icon={<RefreshCw size={14} />} onClick={() => void sync()} loading={syncing}>
            {t('common.syncNow')}
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'reviews', label: t('reviews.tab.reviews') },
          { value: 'templates', label: t('reviews.tab.templates') },
          { value: 'feedback', label: t('reviews.tab.feedback') },
        ]}
      />

      {tab === 'reviews' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('reviews.stats.total')} value={stats?.total ?? '—'} />
            <StatCard
              label={t('reviews.stats.unanswered')}
              value={stats?.unanswered ?? '—'}
              tone={stats && stats.unanswered > 0 ? 'warning' : undefined}
            />
            <StatCard
              label={t('reviews.stats.average')}
              value={stats?.average != null ? `★ ${stats.average.toFixed(2)}` : '—'}
            />
            <StatCard
              label={t('reviews.stats.distribution')}
              value={
                <span className="text-sm">
                  {stats
                    ? ([5, 4, 3, 2, 1] as const).map((s) => `${s}★ ${stats.byStars[s]}`).join(' · ')
                    : '—'}
                </span>
              }
            />
          </div>
          <AutoReplyCard enabledTemplates={templates.filter((x) => x.enabled).length} />
          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label={t('reviews.filter.stars')}
              value={filter.stars ?? ''}
              onChange={(e) => {
                setFilter({ ...filter, stars: e.target.value ? Number(e.target.value) : null });
                setLimit(PAGE);
              }}
              className="w-36"
            >
              <option value="">{t('reviews.filter.allStars')}</option>
              {[5, 4, 3, 2, 1].map((s) => (
                <option key={s} value={s}>
                  {'★'.repeat(s)}
                </option>
              ))}
            </Select>
            <div className="min-w-[220px] flex-1">
              <Input
                type="search"
                placeholder={t('reviews.filter.search')}
                value={filter.query}
                onChange={(e) => {
                  setFilter({ ...filter, query: e.target.value });
                  setLimit(PAGE);
                }}
              />
            </div>
            <Switch
              checked={filter.unansweredOnly}
              onChange={(v) => {
                setFilter({ ...filter, unansweredOnly: v });
                setLimit(PAGE);
              }}
              label={t('reviews.filter.unanswered')}
            />
          </div>
          {rows === undefined ? null : rows.length === 0 ? (
            <EmptyState icon={<Star size={22} />} title={t('reviews.empty.title')}>
              {t('reviews.empty.body')}
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {rows.slice(0, limit).map((row) => (
                <ReviewCard key={row.review.orderId} row={row} templates={templates} aiStatus={aiStatus} />
              ))}
              {rows.length > limit && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                    {t('reviews.more', { n: rows.length - limit })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {tab === 'templates' && <TemplatesPanel templates={templates} />}
      {tab === 'feedback' && <FeedbackPanel />}
    </div>
  );
}
