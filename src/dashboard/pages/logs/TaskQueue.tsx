import { useLiveQuery } from 'dexie-react-hooks';
import { RotateCcw, XCircle } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { canCancelTask, canRetryTask, cancelQueuedTask, NON_RETRYABLE_TASK_KINDS, retryTask, TaskActionError } from '@/features/diagnostics/tasks';
import { TaskKindSchema, TaskStatusSchema, type Task, type TaskStatus } from '@/shared/models';
import { Badge, Button, Callout, ConfirmDialog, DataTable, EmptyState, Select, toast, type Column } from '@/ui/components';
import { useT } from '@/ui/i18n';

const STATUS_TONE: Record<TaskStatus, 'neutral' | 'info' | 'accent' | 'warning' | 'danger' | 'success'> = {
  pending: 'info',
  running: 'accent',
  awaiting_tab: 'warning',
  blocked: 'warning',
  failed: 'danger',
  done: 'success',
  cancelled: 'neutral',
};

type Pending = { action: 'retry' | 'cancel'; task: Task } | null;

/** Durable task queue (db.tasks): status/kind filters, manual retry of safe kinds, cancel of queued tasks. */
export function TaskQueue() {
  const t = useT();
  const statusId = useId();
  const kindId = useId();
  const [status, setStatus] = useState<'all' | TaskStatus>('all');
  const [kind, setKind] = useState('all');
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const tasks = useLiveQuery(() => getDb().tasks.toArray(), []);

  const filtered = useMemo(
    () => (tasks ?? []).filter((x) => (status === 'all' || x.status === status) && (kind === 'all' || x.kind === kind)).sort((a, b) => b.updatedAt - a.updatedAt),
    [tasks, status, kind],
  );
  const counts = useMemo(() => {
    const c: Partial<Record<TaskStatus, number>> = {};
    for (const x of tasks ?? []) c[x.status] = (c[x.status] ?? 0) + 1;
    return c;
  }, [tasks]);

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === 'retry') {
        await retryTask(pending.task.id);
        toast.success(t('tasks.retried'));
      } else {
        await cancelQueuedTask(pending.task.id);
        toast.info(t('tasks.cancelled'));
      }
    } catch (e) {
      toast.error(e instanceof TaskActionError ? t(`tasks.error.${e.code}`) : (e as Error).message);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const columns: Column<Task>[] = [
    { key: 'updated', header: t('tasks.col.updated'), width: '150px', render: (x) => <span className="text-xs tabular-nums text-muted">{new Date(x.updatedAt).toLocaleString()}</span> },
    { key: 'kind', header: t('tasks.col.kind'), width: '120px', render: (x) => <span className="text-xs">{t(`tasks.kind.${x.kind}`)}</span> },
    { key: 'status', header: t('tasks.col.status'), width: '120px', render: (x) => <Badge tone={STATUS_TONE[x.status]}>{t(`tasks.status.${x.status}`)}</Badge> },
    { key: 'attempts', header: t('tasks.col.attempts'), width: '80px', align: 'right', render: (x) => `${x.attempts}/${x.maxAttempts}` },
    {
      key: 'next',
      header: t('tasks.col.next'),
      width: '150px',
      render: (x) => <span className="text-xs tabular-nums text-muted">{x.status === 'pending' || x.status === 'awaiting_tab' || x.status === 'blocked' ? new Date(x.nextRunAt).toLocaleString() : '—'}</span>,
    },
    {
      key: 'error',
      header: t('tasks.col.error'),
      render: (x) => (
        <span className="fp-sensitive block truncate text-xs text-muted" title={x.lastError ?? undefined}>
          {x.lastError ?? '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('tasks.col.actions')}</span>,
      width: '200px',
      align: 'right',
      render: (x) => (
        <div className="flex justify-end gap-1">
          {canRetryTask(x) && (
            <Button size="sm" variant="outline" icon={<RotateCcw size={12} aria-hidden />} onClick={() => setPending({ action: 'retry', task: x })}>
              {t('tasks.retry')}
            </Button>
          )}
          {x.status === 'failed' && NON_RETRYABLE_TASK_KINDS.has(x.kind) && (
            <span className="text-[11px] text-warning" title={t('tasks.manualCheckHelp')}>
              {t('tasks.manualCheck')}
            </span>
          )}
          {canCancelTask(x) && (
            <Button size="sm" variant="ghost" icon={<XCircle size={12} aria-hidden />} onClick={() => setPending({ action: 'cancel', task: x })}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <Callout tone="info">{t('tasks.explainer')}</Callout>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={statusId} className="text-xs font-medium text-muted">
            {t('tasks.col.status')}
          </label>
          <Select id={statusId} value={status} onChange={(e) => setStatus(e.target.value as 'all' | TaskStatus)}>
            <option value="all">{t('common.all')}</option>
            {TaskStatusSchema.options.map((s) => (
              <option key={s} value={s}>
                {t(`tasks.status.${s}`)} ({counts[s] ?? 0})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={kindId} className="text-xs font-medium text-muted">
            {t('tasks.col.kind')}
          </label>
          <Select id={kindId} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">{t('common.all')}</option>
            {TaskKindSchema.options.map((k) => (
              <option key={k} value={k}>
                {t(`tasks.kind.${k}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <DataTable rows={filtered} columns={columns} rowKey={(x) => x.id} height={520} empty={<EmptyState title={tasks ? t('tasks.empty') : t('common.loading')}>{t('tasks.emptyHelp')}</EmptyState>} />
      <ConfirmDialog
        open={!!pending}
        busy={busy}
        danger={pending?.action === 'cancel'}
        title={pending?.action === 'retry' ? t('tasks.retryTitle') : t('tasks.cancelTitle')}
        confirmLabel={pending?.action === 'retry' ? t('tasks.retry') : t('tasks.cancelTask')}
        onCancel={() => setPending(null)}
        onConfirm={() => void run()}
      >
        {pending && (pending.action === 'retry' ? t('tasks.retryBody', { kind: t(`tasks.kind.${pending.task.kind}`) }) : t('tasks.cancelBody', { kind: t(`tasks.kind.${pending.task.kind}`) }))}
      </ConfirmDialog>
    </div>
  );
}
