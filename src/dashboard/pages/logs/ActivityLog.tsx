import { useLiveQuery } from 'dexie-react-hooks';
import { Info, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import type { ActivityLogEntry, LogLevel } from '@/shared/models';
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, IconButton, Input, Modal, Select, type Column } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LEVEL_TONE: Record<LogLevel, 'neutral' | 'info' | 'warning' | 'danger'> = { debug: 'neutral', info: 'info', warn: 'warning', error: 'danger' };
const RANGES = { '1h': 3600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, all: Number.POSITIVE_INFINITY } as const;
type Range = keyof typeof RANGES;

/** Virtualised activity log (db.logs) with level/source/time filters and full-text search. */
export function ActivityLog() {
  const t = useT();
  const searchId = useId();
  const sourceId = useId();
  const rangeId = useId();
  const [levels, setLevels] = useState<ReadonlySet<LogLevel>>(new Set(['info', 'warn', 'error']));
  const [source, setSource] = useState('all');
  const [range, setRange] = useState<Range>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<ActivityLogEntry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const logs = useLiveQuery(() => getDb().logs.orderBy('id').reverse().limit(5000).toArray(), []);

  const sources = useMemo(() => [...new Set((logs ?? []).map((l) => l.source))].sort(), [logs]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const since = Date.now() - RANGES[range];
    return (logs ?? []).filter(
      (l) =>
        levels.has(l.level) &&
        (source === 'all' || l.source === source) &&
        l.at >= since &&
        (!needle || `${l.message} ${l.hint ?? ''} ${l.source}`.toLowerCase().includes(needle)),
    );
  }, [logs, levels, source, range, q]);

  const toggleLevel = (l: LogLevel) =>
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  const columns: Column<ActivityLogEntry>[] = [
    { key: 'at', header: t('logs.col.time'), width: '150px', render: (l) => <time dateTime={new Date(l.at).toISOString()} className="text-xs text-muted tabular-nums">{new Date(l.at).toLocaleString()}</time> },
    { key: 'level', header: t('logs.col.level'), width: '80px', render: (l) => <Badge tone={LEVEL_TONE[l.level]}>{t(`logs.level.${l.level}`)}</Badge> },
    { key: 'source', header: t('logs.col.source'), width: '110px', render: (l) => <span className="font-mono text-xs text-muted">{l.source}</span> },
    {
      key: 'message',
      header: t('logs.col.message'),
      render: (l) => (
        <span className="fp-sensitive block truncate" title={l.message}>
          {l.message}
          {l.hint && <span className="ml-2 text-xs text-muted">· {l.hint}</span>}
        </span>
      ),
    },
    {
      key: 'details',
      header: <span className="sr-only">{t('logs.details')}</span>,
      width: '40px',
      align: 'center',
      render: (l) => (
        <IconButton label={t('logs.details')} onClick={() => setSelected(l)}>
          <Info size={14} />
        </IconButton>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label htmlFor={searchId} className="text-xs font-medium text-muted">
            {t('logs.search')}
          </label>
          <Input id={searchId} type="search" value={q} placeholder={t('common.search')} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label htmlFor={sourceId} className="text-xs font-medium text-muted">
            {t('logs.col.source')}
          </label>
          <Select id={sourceId} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">{t('common.all')}</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={rangeId} className="text-xs font-medium text-muted">
            {t('logs.range')}
          </label>
          <Select id={rangeId} value={range} onChange={(e) => setRange(e.target.value as Range)}>
            {(Object.keys(RANGES) as Range[]).map((r) => (
              <option key={r} value={r}>
                {t(`logs.range.${r}`)}
              </option>
            ))}
          </Select>
        </div>
        <fieldset className="flex flex-wrap items-center gap-1">
          <legend className="sr-only">{t('logs.col.level')}</legend>
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={levels.has(l)}
              onClick={() => toggleLevel(l)}
              className={cn('h-9 rounded-lg border px-2.5 text-xs font-medium', levels.has(l) ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-fg')}
            >
              {t(`logs.level.${l}`)}
            </button>
          ))}
        </fieldset>
        <Button variant="ghost" icon={<Trash2 size={14} aria-hidden />} disabled={!logs?.length} onClick={() => setConfirmClear(true)}>
          {t('logs.clear')}
        </Button>
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {t('logs.showing', { shown: filtered.length.toLocaleString(), total: (logs?.length ?? 0).toLocaleString() })}
      </p>
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(l) => String(l.id ?? `${l.at}-${l.source}`)}
        height={560}
        empty={<EmptyState title={logs ? t('logs.empty') : t('common.loading')}>{t('logs.emptyHelp')}</EmptyState>}
      />

      <Modal open={!!selected} onClose={() => setSelected(null)} title={t('logs.details')} wide>
        {selected && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">{t('logs.col.time')}</dt>
            <dd>{new Date(selected.at).toLocaleString()}</dd>
            <dt className="text-muted">{t('logs.col.level')}</dt>
            <dd>
              <Badge tone={LEVEL_TONE[selected.level]}>{t(`logs.level.${selected.level}`)}</Badge>
            </dd>
            <dt className="text-muted">{t('logs.col.source')}</dt>
            <dd className="font-mono text-xs">{selected.source}</dd>
            <dt className="text-muted">{t('logs.col.message')}</dt>
            <dd className="fp-sensitive whitespace-pre-wrap break-words">{selected.message}</dd>
            {selected.hint && (
              <>
                <dt className="text-muted">{t('logs.hint')}</dt>
                <dd className="whitespace-pre-wrap">{selected.hint}</dd>
              </>
            )}
            {selected.details && (
              <>
                <dt className="text-muted">{t('logs.detailsData')}</dt>
                <dd>
                  <pre className="fp-sensitive max-h-72 overflow-auto rounded-lg bg-surface-2 p-2 font-mono text-[11px]">{JSON.stringify(selected.details, null, 2)}</pre>
                </dd>
              </>
            )}
          </dl>
        )}
      </Modal>
      <ConfirmDialog
        open={confirmClear}
        danger
        title={t('logs.clearTitle')}
        confirmLabel={t('logs.clear')}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void getDb().logs.clear().then(() => setConfirmClear(false))}
      >
        {t('logs.clearBody')}
      </ConfirmDialog>
    </div>
  );
}
