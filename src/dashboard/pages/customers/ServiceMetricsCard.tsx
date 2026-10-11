import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { getDb } from '@/core/db/db';
import { computeServiceMetrics, splitDuration, type ServiceMetrics } from '@/features/crm/metrics';
import { Button, Card, StatCard } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT, type TFunction } from '@/ui/i18n';

export function formatDuration(ms: number | null, t: TFunction): string {
  if (ms === null) return '—';
  const { d, h, m, s } = splitDuration(ms);
  if (d > 0) return t('crm.duration.dh', { d, h });
  if (h > 0) return t('crm.duration.hm', { h, m });
  if (m > 0) return t('crm.duration.m', { m });
  return t('crm.duration.s', { s });
}

/** Median first response, reply rate and unanswered chats — from locally stored history only. */
export function ServiceMetricsCard() {
  const t = useT();
  const [settings] = useSettings();
  const [metrics, setMetrics] = useState<ServiceMetrics | null>(null);
  const [busy, setBusy] = useState(false);

  const compute = useCallback(async () => {
    setBusy(true);
    try {
      setMetrics(computeServiceMetrics(await getDb().messages.toArray(), Date.now()));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void compute();
  }, [compute]);

  return (
    <Card
      title={t('crm.metrics.title')}
      description={t('crm.metrics.description')}
      actions={
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} loading={busy} onClick={() => void compute()}>
          {t('crm.metrics.recompute')}
        </Button>
      }
    >
      {metrics === null ? (
        <p className="text-xs text-muted">{t('common.loading')}</p>
      ) : metrics.messagesAnalyzed === 0 ? (
        <p className="text-xs text-muted">{t('crm.metrics.empty')}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label={t('crm.metrics.medianResponse')}
              value={formatDuration(metrics.medianFirstResponseMs, t)}
              hint={t('crm.metrics.medianHint', { count: metrics.responseSamples })}
            />
            <StatCard
              label={t('crm.metrics.replyRate')}
              value={metrics.replyRate === null ? '—' : `${Math.round(metrics.replyRate * 100)}%`}
              hint={t('crm.metrics.replyRateHint', { answered: metrics.answeredTurns, total: metrics.customerTurns, open: metrics.openTurns })}
            />
            <StatCard
              label={t('crm.metrics.unanswered')}
              value={metrics.unansweredChats}
              tone={metrics.unansweredChats > 0 ? 'warning' : undefined}
              hint={
                metrics.unansweredChatIds.length > 0 ? (
                  <a href={`#/messages?chat=${encodeURIComponent(metrics.unansweredChatIds[0]!)}`} className="text-accent hover:underline">
                    {t('crm.metrics.openFirst')}
                  </a>
                ) : (
                  t('crm.metrics.allAnswered')
                )
              }
            />
          </div>
          <p className="mt-3 text-[11px] text-muted">
            {t('crm.metrics.scope', { messages: metrics.messagesAnalyzed, chats: metrics.chatsAnalyzed, days: settings.privacy.messageRetentionDays })}
          </p>
        </>
      )}
    </Card>
  );
}
