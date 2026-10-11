import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCopy, Copy, FileText, MessageSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { chatUrl, idsText, privateChatId } from '@/features/orders/model';
import {
  AGING_BUCKETS,
  agingSummary,
  splitAge,
  unconfirmedOrders,
  type AgingBucket,
  type UnconfirmedOrder,
} from '@/features/orders/unconfirmed';
import type { Order } from '@/shared/models';
import {
  Badge,
  Button,
  Callout,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Input,
  type Column,
} from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT, type TFunction } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { Amount, MoneyList } from '@/dashboard/components/charts';
import { useDashboard } from '@/dashboard/context';
import { useCopy } from './shared';

const BUCKET_TONE: Record<AgingBucket, 'neutral' | 'info' | 'warning' | 'danger'> = {
  lt24h: 'neutral',
  d1to3: 'info',
  d3to7: 'warning',
  gt7d: 'danger',
};

export function formatAge(ageMs: number, t: TFunction): string {
  const { days, hours, minutes } = splitAge(ageMs);
  if (days > 0) return t('orders.age.dh', { d: days, h: hours });
  if (hours > 0) return t('orders.age.hm', { h: hours, m: minutes });
  return t('orders.age.m', { m: minutes });
}

/** Ticks once a minute so ages stay current while the page is open. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function UnconfirmedTab({
  onOpen,
  onDraftTicket,
}: {
  onOpen: (o: Order) => void;
  onDraftTicket: (orders: Order[]) => void;
}) {
  const t = useT();
  const copy = useCopy();
  const now = useMinuteClock();
  const [settings, update] = useSettings();
  const { status } = useDashboard();
  const selfId = status?.session?.userId ?? null;
  const paid = useLiveQuery(
    () => getDb().orders.where('[direction+status]').equals(['sale', 'paid']).toArray(),
    [],
  );
  const minAgeHours = settings.analytics.unconfirmedAfterHours;
  const list = useMemo(
    () => (paid ? unconfirmedOrders(paid, { now, minAgeHours }) : []),
    [paid, now, minAgeHours],
  );
  const summary = useMemo(() => agingSummary(list), [list]);
  const [bucket, setBucket] = useState<AgingBucket | null>(null);
  const visible = useMemo(() => (bucket ? list.filter((u) => u.bucket === bucket) : list), [list, bucket]);
  const ticketCandidates = visible.map((u) => u.order);

  const columns: Column<UnconfirmedOrder>[] = [
    {
      key: 'age',
      header: t('orders.col.age'),
      width: '7rem',
      render: (u) => (
        <span
          className={cn('text-xs tabular-nums', u.approximate && 'text-muted')}
          title={u.approximate ? t('orders.col.dateApprox') : undefined}
        >
          {u.approximate ? '≥ ' : ''}
          {formatAge(u.ageMs, t)}
        </span>
      ),
    },
    {
      key: 'id',
      header: t('orders.col.order'),
      width: '8.5rem',
      render: (u) => (
        <span className="inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(u.order);
            }}
            aria-label={t('orders.action.detailsOf', { id: u.order.id })}
            className="rounded font-mono text-xs text-fg hover:underline fp-sensitive"
          >
            #{u.order.id}
          </button>
          <IconButton
            label={t('orders.action.copyIdOf', { id: u.order.id })}
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              void copy(u.order.id, t('orders.copy.idCopied', { id: u.order.id }));
            }}
          >
            <Copy size={12} />
          </IconButton>
        </span>
      ),
    },
    {
      key: 'buyer',
      header: t('orders.col.buyer'),
      width: 'minmax(6rem,0.7fr)',
      render: (u) => <span className="fp-sensitive">{u.order.counterpartyName || '—'}</span>,
    },
    {
      key: 'desc',
      header: t('orders.col.description'),
      width: 'minmax(10rem,2fr)',
      render: (u) => (
        <span className="truncate" title={u.order.description}>
          {u.order.description || '—'}
        </span>
      ),
    },
    {
      key: 'bucket',
      header: t('orders.col.aging'),
      width: '6.5rem',
      render: (u) => <Badge tone={BUCKET_TONE[u.bucket]}>{t(`orders.aging.${u.bucket}`)}</Badge>,
    },
    {
      key: 'amount',
      header: t('orders.col.amount'),
      width: '7.5rem',
      align: 'right',
      render: (u) => <Amount minor={u.order.price.amountMinor} currency={u.order.price.currency} />,
    },
    {
      key: 'chat',
      header: <span className="sr-only">{t('orders.action.openChat')}</span>,
      width: '2.25rem',
      render: (u) => {
        const url = chatUrl(privateChatId(selfId, u.order.counterpartyId));
        return url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={t('orders.action.openChatWith', { name: u.order.counterpartyName })}
            title={t('orders.action.openChat')}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
          >
            <MessageSquare size={13} />
          </a>
        ) : null;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Callout tone="info">{t('orders.unconfirmed.explain')}</Callout>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t('orders.unconfirmed.threshold')}
          htmlFor="unconfirmed-threshold"
          help={t('orders.unconfirmed.thresholdHelp')}
        >
          <Input
            id="unconfirmed-threshold"
            type="number"
            min={0}
            max={720}
            value={minAgeHours}
            className="w-28"
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (Number.isFinite(v) && v >= 0 && v <= 720)
                void update({ analytics: { unconfirmedAfterHours: v } });
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('orders.unconfirmed.buckets')}>
          {AGING_BUCKETS.map((b) => {
            const s = summary.buckets[b];
            return (
              <button
                key={b}
                type="button"
                aria-pressed={bucket === b}
                onClick={() => setBucket(bucket === b ? null : b)}
                className={cn(
                  'flex min-w-[7.5rem] flex-col items-start rounded-xl border px-3 py-2 text-left',
                  bucket === b
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <span className="flex items-center gap-1 text-xs text-muted">
                  <Badge tone={BUCKET_TONE[b]}>{t(`orders.aging.${b}`)}</Badge>
                </span>
                <span className="mt-1 text-lg font-semibold">{s.count}</span>
                <span className="text-[11px] text-muted">
                  <MoneyList amounts={s.amountByCurrency} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          icon={<ClipboardCopy size={14} />}
          disabled={visible.length === 0}
          onClick={() =>
            void copy(
              idsText(visible.map((u) => u.order)),
              t('orders.copy.idsCopied', { count: visible.length }),
            )
          }
        >
          {t('orders.unconfirmed.copyAll', { count: visible.length })}
        </Button>
        <Button
          variant="outline"
          icon={<FileText size={14} />}
          disabled={visible.length === 0}
          onClick={() => onDraftTicket(ticketCandidates)}
        >
          {t('orders.unconfirmed.draftTicket')}
        </Button>
        <span className="text-xs text-muted">
          {t('orders.unconfirmed.ticketHint', { hours: settings.analytics.supportTicketAfterHours })}
        </span>
      </div>
      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(u) => u.order.id}
        rowHeight={44}
        height={480}
        onRowClick={(u) => onOpen(u.order)}
        empty={
          <EmptyState title={paid === undefined ? t('common.loading') : t('orders.unconfirmed.emptyTitle')}>
            {paid !== undefined ? t('orders.unconfirmed.emptyBody', { hours: minAgeHours }) : null}
          </EmptyState>
        }
      />
    </div>
  );
}
