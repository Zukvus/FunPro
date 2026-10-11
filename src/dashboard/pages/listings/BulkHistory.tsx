import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronUp, Download, History, RotateCcw, Square, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb, type BackupRecord } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import type { BulkPlan, ItemResult, PlanStatus } from '@/features/listings/bulk-plan';
import {
  computeProgress,
  deletePlan,
  isPlanFinished,
  parsePlanRecords,
  parseResultRecords,
  PLAN_PREFIX,
  RESULT_PREFIX,
  type PlanProgress,
} from '@/features/listings/bulk-store';
import { listingsToJson } from '@/features/listings/import-export';
import { buildRestorePlan, restoreLocalBackup } from '@/features/listings/restore';
import { downloadBlob, MIME, timestampedName } from '@/features/export/download';
import type { Task } from '@/shared/models';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ProgressBar,
  toast,
  type Column,
} from '@/ui/components';
import { useT } from '@/ui/i18n';
import { opLabel } from './BulkDialog';
import { errorText, truncate, useFormat, usePageApi } from './shared';

const STATUS_TONE: Record<PlanStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'> = {
  draft: 'neutral',
  queued: 'info',
  running: 'accent',
  cancelling: 'warning',
  cancelled: 'neutral',
  done: 'success',
  partial: 'warning',
  failed: 'danger',
};

const RESULT_TONE: Record<ItemResult['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  done: 'success',
  failed: 'danger',
  skipped: 'neutral',
  conflict: 'warning',
  cancelled: 'neutral',
  blocked: 'danger',
};

export function BulkHistory() {
  const t = useT();
  const records = useLiveQuery(() => getDb().kv.where('key').startsWith(PLAN_PREFIX).toArray(), []);
  const plans = useMemo(() => parsePlanRecords(records ?? []).filter((p) => p.status !== 'draft'), [records]);
  const backups = useLiveQuery(() => getDb().backups.orderBy('createdAt').reverse().limit(50).toArray(), []);

  return (
    <div className="space-y-5">
      <section aria-labelledby="bulk-plans-h">
        <h2 id="bulk-plans-h" className="mb-2 text-sm font-semibold text-fg">
          {t('listings.history.plans')}
        </h2>
        {records === undefined ? null : plans.length === 0 ? (
          <EmptyState icon={<History size={24} aria-hidden />} title={t('listings.history.empty.title')}>
            {t('listings.history.empty.body')}
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <PlanCard key={p.id} plan={p} backup={backups?.find((b) => b.id === p.backupId) ?? null} />
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="bulk-backups-h">
        <h2 id="bulk-backups-h" className="mb-1 text-sm font-semibold text-fg">
          {t('listings.history.backups')}
        </h2>
        <p className="mb-2 text-xs text-muted">{t('listings.history.backups.help')}</p>
        {backups && backups.length === 0 ? (
          <p className="text-xs text-muted">{t('listings.history.backups.empty')}</p>
        ) : null}
        <div className="space-y-2">
          {backups?.map((b) => (
            <BackupRow key={b.id} backup={b} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanCard({ plan, backup }: { plan: BulkPlan; backup: BackupRecord | null }) {
  const t = useT();
  const fmt = useFormat();
  const api = usePageApi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const finished = isPlanFinished(plan);
  const data = useLiveQuery(async () => {
    const db = getDb();
    const [res, tasks] = await Promise.all([
      db.kv.where('key').startsWith(`${RESULT_PREFIX}${plan.id}:`).toArray(),
      finished
        ? Promise.resolve([] as Task[])
        : db.tasks
            .where('kind')
            .equals('bulk_edit')
            .filter((x) => x.payload['planId'] === plan.id)
            .toArray(),
    ]);
    return { results: parseResultRecords(res), tasks };
  }, [plan.id, finished]);
  const progress: PlanProgress | null = data ? computeProgress(plan, data.results, data.tasks) : null;
  const report = plan.report;
  const doneCount = report?.done ?? progress?.done ?? 0;

  const cancel = async () => {
    setBusy('cancel');
    try {
      const r = await rpc<{ cancelled: number }>('ui.bulkEdit.cancel', { planId: plan.id });
      toast.success(t('listings.history.cancelled', { count: r.cancelled }));
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(null);
    }
  };

  const restore = () => {
    if (!data) return;
    const r = buildRestorePlan(plan, data.results, backup, {
      now: Date.now(),
      label: t('listings.history.restoreLabel', { label: truncate(plan.label, 120) }),
    });
    if (r.items.every((i) => i.skip)) {
      toast.info(t('listings.history.nothingToRestore'));
      return;
    }
    api.openPreview(r);
  };

  return (
    <Card
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {plan.label}
          <Badge tone={STATUS_TONE[plan.status]}>{t(`listings.planStatus.${plan.status}`)}</Badge>
        </span>
      }
      description={`${fmt.dateTime(plan.queuedAt ?? plan.createdAt)} · ${opLabel(t, plan.op)}${plan.source !== 'bulk' ? ` · ${t(`listings.source.${plan.source}`)}` : ''}`}
      actions={
        <>
          {!finished && (
            <Button
              size="sm"
              variant="outline"
              icon={<Square size={14} aria-hidden />}
              loading={busy === 'cancel'}
              onClick={() => void cancel()}
            >
              {t('listings.history.cancel')}
            </Button>
          )}
          {finished && plan.op.kind !== 'delete' && doneCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              icon={<Undo2 size={14} aria-hidden />}
              onClick={restore}
              disabled={!data}
            >
              {t('listings.history.restore')}
            </Button>
          )}
          {finished && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={14} aria-hidden />}
              aria-label={t('listings.history.forget')}
              onClick={() => void deletePlan(plan.id)}
            >
              <span className="sr-only">{t('listings.history.forget')}</span>
            </Button>
          )}
        </>
      }
    >
      {progress && (
        <>
          <ProgressBar
            value={progress.finished}
            max={Math.max(1, progress.total)}
            label={t('listings.history.progress')}
          />
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-live="polite">
            <span>
              {t('listings.history.progressText', { done: progress.finished, total: progress.total })}
            </span>
            <span className="text-success">{t('listings.history.n.done', { count: progress.done })}</span>
            {progress.failed > 0 && (
              <span className="text-danger">
                {t('listings.history.n.failed', { count: progress.failed })}
              </span>
            )}
            {progress.conflict > 0 && (
              <span className="text-warning">
                {t('listings.history.n.conflict', { count: progress.conflict })}
              </span>
            )}
            {progress.skipped > 0 && (
              <span>{t('listings.history.n.skipped', { count: progress.skipped })}</span>
            )}
            {progress.cancelled > 0 && (
              <span>{t('listings.history.n.cancelled', { count: progress.cancelled })}</span>
            )}
            {progress.awaitingTab > 0 && (
              <span className="text-warning">
                {t('listings.history.n.awaitingTab', { count: progress.awaitingTab })}
              </span>
            )}
          </p>
        </>
      )}
      {progress && progress.awaitingTab > 0 && (
        <p className="mt-1 text-xs text-warning">{t('listings.history.awaitingTabHint')}</p>
      )}
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        {t('listings.history.details')}
      </button>
      {open && data && <PlanReportTable plan={plan} results={data.results} />}
    </Card>
  );
}

function PlanReportTable({ plan, results }: { plan: BulkPlan; results: ItemResult[] }) {
  const t = useT();
  const byId = useMemo(() => new Map(results.map((r) => [r.listingId, r])), [results]);
  const rows = plan.items;
  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'title',
      header: t('listings.col.title'),
      width: 'minmax(0,2fr)',
      render: (i) => (
        <span className="truncate" title={i.title}>
          {i.title || `#${i.listingId}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('listings.col.status'),
      width: '120px',
      render: (i) => {
        const r = byId.get(i.listingId);
        if (!r) return <Badge tone="info">{t('listings.result.pending')}</Badge>;
        return <Badge tone={RESULT_TONE[r.status]}>{t(`listings.result.${r.status}`)}</Badge>;
      },
    },
    {
      key: 'msg',
      header: t('listings.history.message'),
      width: 'minmax(0,3fr)',
      render: (i) => {
        const r = byId.get(i.listingId);
        const msg = r?.message.startsWith('skip:')
          ? t(`listings.skip.${r.message.slice(5)}`)
          : (r?.message ?? '');
        return (
          <span className="truncate text-xs text-muted" title={msg}>
            {r?.uncertain ? `⚠ ${msg}` : msg}
          </span>
        );
      },
    },
  ];
  return (
    <div className="mt-2">
      <DataTable rows={rows} columns={columns} rowKey={(i) => i.listingId} height={300} rowHeight={36} />
    </div>
  );
}

function BackupRow({ backup }: { backup: BackupRecord }) {
  const t = useT();
  const fmt = useFormat();
  const [confirm, setConfirm] = useState<'restore' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const localRestore = backup.kind !== 'bulk_edit';
  const run = async () => {
    setBusy(true);
    try {
      if (confirm === 'restore') {
        const r = await restoreLocalBackup(backup.id);
        toast.success(t('listings.history.backup.restored', { count: r.restored }));
      } else if (confirm === 'delete') {
        await getDb().backups.delete(backup.id);
      }
      setConfirm(null);
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{backup.label || backup.id}</span>
        <span className="ml-2 text-xs text-muted">
          <Badge>{t(`listings.backupKind.${backup.kind}`)}</Badge> {fmt.dateTime(backup.createdAt)} ·{' '}
          {t('listings.bulk.count', { count: backup.listings.length })}
        </span>
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          icon={<Download size={14} aria-hidden />}
          onClick={() =>
            downloadBlob(
              listingsToJson(backup.listings),
              timestampedName('funpro-backup', 'json', new Date(backup.createdAt)),
              MIME.json,
            )
          }
        >
          {t('listings.history.backup.download')}
        </Button>
        {localRestore && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={14} aria-hidden />}
            onClick={() => setConfirm('restore')}
          >
            {t('listings.history.backup.restoreLocal')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={14} aria-hidden />}
          onClick={() => setConfirm('delete')}
          aria-label={t('common.delete')}
        >
          <span className="sr-only">{t('common.delete')}</span>
        </Button>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'restore'
            ? t('listings.history.backup.restoreLocal')
            : t('listings.history.backup.deleteTitle')
        }
        confirmLabel={confirm === 'restore' ? t('listings.history.backup.restoreLocal') : t('common.delete')}
        danger={confirm === 'delete'}
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setConfirm(null)}
      >
        {confirm === 'restore'
          ? t('listings.history.backup.restoreBody')
          : t('listings.history.backup.deleteBody')}
      </ConfirmDialog>
    </div>
  );
}
