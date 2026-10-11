import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, LineChart, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import {
  computeSalesTrendSummary,
  explainSalesTrend,
  rewriteListingDescription,
  suggestListingImprovements,
  type CopilotText,
  type ListingTip,
  type AiFallbackInfo,
} from '@/features/ai';
import { Button, Card, Field, Select, Textarea, toast } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { AiErrorNote, SourceBadge, useAbortable, WarningList, type AiStatus } from './shared';

export function ListingTools({ status }: { status: AiStatus }) {
  const t = useT();
  const lang = useLang();
  const aiReady = status?.ok === true;
  const listings = useLiveQuery(() => getDb().listings.orderBy('sortIndex').limit(1000).toArray(), []);
  const [listingId, setListingId] = useState('');
  const [tips, setTips] = useState<{
    tips: ListingTip[];
    aiTips: string[];
    source: 'rules' | 'ai';
    aiError?: AiFallbackInfo;
  } | null>(null);
  const [rewrite, setRewrite] = useState<CopilotText | null>(null);
  const [rewriteText, setRewriteText] = useState('');
  const [trend, setTrend] = useState<CopilotText | null>(null);
  const job = useAbortable();
  const listing = listings?.find((l) => l.id === listingId) ?? null;

  const wrap = async (fn: (signal: AbortSignal) => Promise<void>) => {
    const signal = job.start();
    try {
      await fn(signal);
    } catch (e) {
      if (!signal.aborted) toast.error((e as Error).message);
    } finally {
      job.finish(signal);
    }
  };

  const suggest = () =>
    wrap(async (signal) => {
      if (!listing) return;
      setTips(await suggestListingImprovements(listing, { signal, lang, useAi: aiReady }));
    });

  const rewriteDescription = () =>
    wrap(async (signal) => {
      if (!listing?.description) return;
      const r = await rewriteListingDescription(listing.description, { signal, lang, useAi: aiReady });
      setRewrite(r);
      setRewriteText(r.text);
    });

  const explain = () =>
    wrap(async (signal) => {
      const orders = await getDb().orders.where('direction').equals('sale').toArray();
      const summary = computeSalesTrendSummary(orders, Date.now(), 7, t('aiPage.tools.last7'));
      if (!summary) {
        toast.info(t('aiPage.tools.noSales'));
        return;
      }
      setTrend(await explainSalesTrend(summary, { signal, lang, useAi: aiReady }));
    });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('aiPage.play.copyFailed'));
    }
  };

  return (
    <Card title={t('aiPage.tools.title')} description={t('aiPage.tools.description')}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label={t('aiPage.tools.listing')}>
            <Select
              value={listingId}
              onChange={(e) => {
                setListingId(e.target.value);
                setTips(null);
                setRewrite(null);
              }}
            >
              <option value="">{t('aiPage.tools.pickListing')}</option>
              {(listings ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title.slice(0, 80) || l.id}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={<Wand2 size={14} />}
              onClick={() => void suggest()}
              disabled={!listing || job.running}
            >
              {t('aiPage.tools.suggest')}
            </Button>
            <Button
              size="sm"
              onClick={() => void rewriteDescription()}
              disabled={!listing?.description || job.running}
              title={listing && !listing.description ? t('aiPage.tools.noDescription') : undefined}
            >
              {t('aiPage.tools.rewrite')}
            </Button>
          </div>
          {tips && (
            <div className="space-y-2 text-sm">
              <SourceBadge source={tips.source} />
              <AiErrorNote error={tips.aiError} />
              {tips.tips.length === 0 && tips.aiTips.length === 0 ? (
                <p className="text-xs text-muted">{t('aiPage.tools.noTips')}</p>
              ) : (
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  {tips.tips.map((tip) => (
                    <li key={tip.id}>{tip.text}</li>
                  ))}
                  {tips.aiTips.map((tip, i) => (
                    <li key={`ai-${i}`} className="text-accent">
                      {tip}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {rewrite && (
            <div className="space-y-2">
              <SourceBadge source={rewrite.source} />
              <AiErrorNote error={rewrite.aiError} />
              <Textarea
                rows={8}
                value={rewriteText}
                onChange={(e) => setRewriteText(e.target.value)}
                aria-label={t('aiPage.tools.rewrite')}
              />
              <WarningList warnings={rewrite.warnings} />
              <Button size="sm" icon={<Copy size={14} />} onClick={() => void copy(rewriteText)}>
                {t('common.copy')}
              </Button>
              <p className="text-[11px] text-muted">{t('aiPage.tools.copyNote')}</p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium">{t('aiPage.tools.trendTitle')}</p>
          <p className="text-xs text-muted">{t('aiPage.tools.trendHelp')}</p>
          <Button
            size="sm"
            icon={<LineChart size={14} />}
            onClick={() => void explain()}
            disabled={job.running}
          >
            {t('aiPage.tools.explain')}
          </Button>
          {trend && (
            <div className="space-y-2">
              <SourceBadge source={trend.source} />
              <AiErrorNote error={trend.aiError} />
              <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{trend.text}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
