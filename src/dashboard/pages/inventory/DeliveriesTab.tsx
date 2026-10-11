import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { renderForSeller } from '@/features/inventory/delivery';
import { ACTIVE_DELIVERY_STATUSES, toDelivery, type DeliveryRecord } from '@/features/inventory/model';
import { listPools } from '@/features/inventory/pools';
import type { DeliveryStatus } from '@/shared/models';
import { useDashboard } from '@/dashboard/context';
import { Badge, Button, Callout, ConfirmDialog, DataTable, EmptyState, Modal, Select, Spinner, toast, type Column } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { dateTime, errorText, useLocaleTag } from './common';

export const DELIVERY_TONE: Record<DeliveryStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'> = {
  reserved: 'accent',
  sending: 'info',
  sent: 'success',
  uncertain: 'warning',
  failed: 'danger',
  manual: 'warning',
  cancelled: 'neutral',
};

type Filter = 'active' | 'all' | DeliveryStatus;

export function DeliveriesTab() {
  const t = useT();
  const locale = useLocaleTag();
  const [filter, setFilter] = useState<Filter>('active');
  const [selected, setSelected] = useState<string | null>(null);
  const data = useLiveQuery(async () => {
    const all = (await getDb().deliveries.orderBy('updatedAt').reverse().limit(2000).toArray()).map(toDelivery);
    const pools = new Map((await listPools()).map((p) => [p.id, p.name]));
    return { all, pools };
  }, []);
  if (!data) return <Spinner />;
  const rows = data.all.filter((d) => (filter === 'all' ? true : filter === 'active' ? ACTIVE_DELIVERY_STATUSES.includes(d.status) : d.status === filter));
  const current = selected ? data.all.find((d) => d.orderId === selected) ?? null : null;

  const columns: Column<DeliveryRecord>[] = [
    { key: 'order', header: t('ops.inv.del.order'), width: '110px', render: (d) => <span className="fp-sensitive font-mono">#{d.orderId}</span> },
    { key: 'buyer', header: t('ops.inv.del.buyer'), width: 'minmax(0,1fr)', render: (d) => <span className="fp-sensitive">{d.buyerName || '—'}</span> },
    { key: 'pool', header: t('ops.inv.del.pool'), render: (d) => data.pools.get(d.poolId) ?? '—' },
    { key: 'items', header: t('ops.inv.del.items'), width: '70px', align: 'right', render: (d) => d.itemIds.length },
    { key: 'status', header: t('ops.inv.del.status'), width: '130px', render: (d) => <Badge tone={DELIVERY_TONE[d.status]}>{t(`ops.inv.status.${d.status}`)}</Badge> },
    { key: 'reason', header: t('ops.inv.del.reason'), width: 'minmax(0,1.4fr)', render: (d) => <span className="text-xs text-muted">{d.reason ? t(`ops.inv.reason.${d.reason}`) : ''}</span> },
    { key: 'updated', header: t('ops.inv.del.updated'), width: '130px', render: (d) => <span className="text-xs">{dateTime(d.updatedAt, locale)}</span> },
    {
      key: 'manage',
      header: '',
      width: '90px',
      align: 'right',
      render: (d) => (
        <Button size="sm" variant="outline" onClick={() => setSelected(d.orderId)}>
          {t('ops.inv.del.manage')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{t('ops.inv.del.help')}</p>
        <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="w-48" aria-label={t('ops.inv.del.status')}>
          <option value="active">{t('ops.inv.del.filterActive')}</option>
          <option value="all">{t('common.all')}</option>
          {(['reserved', 'sending', 'sent', 'uncertain', 'failed', 'manual', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`ops.inv.status.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(d) => d.orderId} empty={<EmptyState title={t('ops.inv.del.empty')}>{t('ops.inv.del.emptyHelp')}</EmptyState>} />
      {current && <DeliveryModal delivery={current} poolName={data.pools.get(current.poolId) ?? '—'} onClose={() => setSelected(null)} />}
    </div>
  );
}

type Pending = null | 'send' | 'resend' | 'release' | 'releaseUncertain' | 'mark';

function DeliveryModal({ delivery: d, poolName, onClose }: { delivery: DeliveryRecord; poolName: string; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleTag();
  const { navigate } = useDashboard();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const chatUrl = d.chatId ? `https://funpay.com/chat/?node=${encodeURIComponent(d.chatId)}` : null;
  const orderUrl = `https://funpay.com/orders/${encodeURIComponent(d.orderId)}/`;
  const draftPending = useLiveQuery(async () => (d.draftId ? (await getDb().drafts.get(d.draftId))?.status === 'pending' : false), [d.draftId], false);

  const call = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const reveal = async () => {
    try {
      setRevealed(await renderForSeller(d.orderId));
      window.setTimeout(() => setRevealed(null), 60_000);
    } catch (e) {
      toast.error(errorText(e, t));
    }
  };

  const canPrepare = ['reserved', 'manual', 'failed', 'uncertain'].includes(d.status) && d.itemIds.length > 0;
  const canSend = ['reserved', 'manual', 'failed'].includes(d.status) && d.itemIds.length > 0;
  const canMark = ['reserved', 'manual', 'failed', 'uncertain'].includes(d.status) && d.itemIds.length > 0;
  const canRelease = ['reserved', 'manual', 'failed'].includes(d.status);

  return (
    <Modal open wide onClose={onClose} title={t('ops.inv.del.title', { order: d.orderId })}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={DELIVERY_TONE[d.status]}>{t(`ops.inv.status.${d.status}`)}</Badge>
          <span className="text-xs text-muted">{t('ops.inv.del.meta', { pool: poolName, n: d.itemIds.length, q: d.quantity })}</span>
          <span className="text-xs text-muted">· {t(`ops.inv.channel.${d.channel}`)}</span>
          <a className="inline-flex items-center gap-1 text-xs text-accent" href={orderUrl} target="_blank" rel="noreferrer">
            {t('ops.inv.del.openOrder')} <ExternalLink size={12} />
          </a>
          {chatUrl && (
            <a className="inline-flex items-center gap-1 text-xs text-accent" href={chatUrl} target="_blank" rel="noreferrer">
              {t('ops.inv.del.openChat')} <ExternalLink size={12} />
            </a>
          )}
        </div>
        {d.status === 'uncertain' && (
          <Callout tone="warning" title={t('ops.inv.del.uncertainTitle')}>
            {t('ops.inv.del.uncertainBody')}
          </Callout>
        )}
        {d.status === 'failed' && (
          <Callout tone="danger" title={t('ops.inv.del.failedTitle')}>
            {t('ops.inv.del.failedBody')}
          </Callout>
        )}
        {d.reason && d.status !== 'uncertain' && d.status !== 'failed' && <Callout tone="info">{t(`ops.inv.reason.${d.reason}`)}</Callout>}
        {d.lastError && <p className="text-xs text-muted">{t('ops.inv.del.lastError', { error: d.lastError })}</p>}
        {d.refundedAt && <p className="text-xs text-warning">{t('ops.inv.del.refunded', { at: dateTime(d.refundedAt, locale) })}</p>}
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t('ops.inv.del.message')}</p>
          <pre className={revealed ? 'fp-sensitive whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs' : 'whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-muted'}>{revealed ?? (d.messagePreview || t('ops.inv.del.noPreview'))}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            {d.itemIds.length > 0 && d.status !== 'sent' && d.status !== 'cancelled' && !revealed && (
              <Button size="sm" variant="outline" onClick={() => void reveal()}>
                {t('ops.inv.del.reveal')}
              </Button>
            )}
            {revealed && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(revealed).then(() => toast.success(t('common.copied')))
                }
              >
                {t('common.copy')}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {draftPending && (
            <Button variant="primary" onClick={() => navigate('messages')}>
              {t('ops.inv.del.openDraft')}
            </Button>
          )}
          {canPrepare && !draftPending && (
            <Button onClick={() => void call(() => rpc('ui.deliverOrder', { orderId: d.orderId, mode: 'draft' }), t('ops.inv.del.draftReady'))} loading={busy}>
              {t('ops.inv.del.prepareDraft')}
            </Button>
          )}
          {canSend && (
            <Button variant={draftPending ? 'secondary' : 'primary'} onClick={() => setPending('send')} disabled={busy}>
              {d.status === 'failed' ? t('ops.inv.del.retry') : t('ops.inv.del.sendNow')}
            </Button>
          )}
          {d.status === 'uncertain' && (
            <Button variant="outline" onClick={() => setPending('resend')} disabled={busy}>
              {t('ops.inv.del.resendAnyway')}
            </Button>
          )}
          {canMark && (
            <Button variant="outline" onClick={() => setPending('mark')} disabled={busy}>
              {t('ops.inv.del.markSent')}
            </Button>
          )}
          {d.status === 'manual' && d.itemIds.length === 0 && (
            <Button onClick={() => void call(() => rpc('ui.inventory.reserve', { orderId: d.orderId, poolId: d.poolId, refill: true }), t('ops.inv.del.reserved'))} loading={busy}>
              {t('ops.inv.del.reserveAgain')}
            </Button>
          )}
          {canRelease && (
            <Button variant="ghost" onClick={() => setPending('release')} disabled={busy}>
              {t('ops.inv.del.release')}
            </Button>
          )}
          {d.status === 'uncertain' && (
            <Button variant="ghost" onClick={() => setPending('releaseUncertain')} disabled={busy}>
              {t('ops.inv.del.releaseUncertain')}
            </Button>
          )}
          {d.status === 'sending' && (
            <span className="inline-flex items-center gap-2 text-xs text-muted">
              <Spinner size={14} /> {t('ops.inv.del.sending')}
            </span>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={pending === 'send' || pending === 'resend'}
        title={pending === 'resend' ? t('ops.inv.del.resendTitle') : t('ops.inv.del.sendTitle')}
        confirmLabel={t('ops.inv.del.sendConfirm')}
        danger={pending === 'resend'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void call(() => rpc('ui.deliverOrder', { orderId: d.orderId, mode: 'send', confirmUncertain: pending === 'resend' }), t('ops.inv.del.queued'))}
      >
        {pending === 'resend' ? t('ops.inv.del.resendBody') : t('ops.inv.del.sendBody', { chat: d.chatId ?? '—' })}
      </ConfirmDialog>
      <ConfirmDialog open={pending === 'mark'} title={t('ops.inv.del.markTitle')} confirmLabel={t('ops.inv.del.markSent')} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void call(() => rpc('ui.inventory.markDelivered', { orderId: d.orderId, confirm: true }), t('ops.inv.del.marked'))}>
        {t('ops.inv.del.markBody')}
      </ConfirmDialog>
      <ConfirmDialog
        open={pending === 'release' || pending === 'releaseUncertain'}
        title={t('ops.inv.del.releaseTitle')}
        confirmLabel={t('ops.inv.del.release')}
        danger
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => void call(() => rpc('ui.inventory.release', { orderId: d.orderId, confirm: true, confirmUncertain: pending === 'releaseUncertain' }), t('ops.inv.del.released'))}
      >
        {pending === 'releaseUncertain' ? t('ops.inv.del.releaseUncertainBody') : t('ops.inv.del.releaseBody')}
      </ConfirmDialog>
    </Modal>
  );
}
