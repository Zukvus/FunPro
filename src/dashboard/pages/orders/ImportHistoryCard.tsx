import { useLiveQuery } from 'dexie-react-hooks';
import { DownloadCloud, Square } from 'lucide-react';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { importStatusKey, type ImportJobStatus } from '@/features/orders/status';
import type { OrderDirection } from '@/shared/models';
import { Badge, Button, Callout, Card, Field, Input, Select, toast } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { fmtDateTime, fmtInt } from '@/dashboard/components/charts';

const STATE_TONE: Record<ImportJobStatus['state'], 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  running: 'info',
  done: 'success',
  cancelled: 'neutral',
  interrupted: 'warning',
  awaiting_tab: 'warning',
  logged_out: 'warning',
  rate_limited: 'warning',
  unsupported: 'warning',
  error: 'danger',
};

/** "Load full history": pages through FunPay's order list with continue tokens (background job). */
export function ImportHistoryCard({ direction }: { direction: OrderDirection }) {
  const t = useT();
  const lang = useLang();
  const job = useLiveQuery(async () => (await getDb().kv.get(importStatusKey(direction)))?.value as ImportJobStatus | undefined, [direction]);
  const [mode, setMode] = useState<'full' | 'missing'>('missing');
  const [maxPages, setMaxPages] = useState(500);
  const [busy, setBusy] = useState(false);
  const running = job?.state === 'running';

  const start = async () => {
    setBusy(true);
    try {
      await rpc('ui.orders.importHistory', { direction, mode, maxPages });
      toast.info(t('orders.import.started'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    try {
      await rpc('ui.orders.cancelImport', { direction });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card title={t('orders.import.title')} description={t(`orders.import.description.${direction}`)}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('orders.import.mode')} htmlFor={`import-mode-${direction}`}>
          <Select id={`import-mode-${direction}`} value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'missing')} disabled={running}>
            <option value="missing">{t('orders.import.mode.missing')}</option>
            <option value="full">{t('orders.import.mode.full')}</option>
          </Select>
        </Field>
        <Field label={t('orders.import.maxPages')} htmlFor={`import-max-${direction}`}>
          <Input
            id={`import-max-${direction}`}
            type="number"
            min={1}
            max={2000}
            value={maxPages}
            disabled={running}
            onChange={(e) => setMaxPages(Math.min(2000, Math.max(1, Math.round(Number(e.target.value) || 1))))}
            className="w-28"
          />
        </Field>
        {running ? (
          <Button variant="outline" icon={<Square size={14} />} onClick={() => void cancel()}>
            {t('orders.import.cancel')}
          </Button>
        ) : (
          <Button variant="primary" icon={<DownloadCloud size={14} />} loading={busy} onClick={() => void start()}>
            {t('orders.import.start')}
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{t('orders.import.note')}</p>
      {job && (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATE_TONE[job.state]}>{t(`orders.import.state.${job.state}`)}</Badge>
            <span className="text-muted">{fmtDateTime(job.startedAt, lang)}</span>
          </div>
          <p className="mt-1 tabular-nums text-fg">
            {t('orders.import.progress', { pages: fmtInt(job.pages, lang), orders: fmtInt(job.orders, lang), created: fmtInt(job.created, lang), updated: fmtInt(job.updated, lang) })}
          </p>
          {job.stop && job.state === 'done' && <p className="mt-0.5 text-muted">{t(`orders.import.stop.${job.stop}`)}</p>}
          {job.message && job.state !== 'unsupported' && <p className="mt-0.5 text-muted">{job.message}</p>}
        </div>
      )}
      {job?.state === 'unsupported' && (
        <div className="mt-3">
          <Callout tone="warning" title={t('orders.import.unsupportedTitle')}>
            {t('orders.import.unsupported')}
          </Callout>
        </div>
      )}
    </Card>
  );
}
