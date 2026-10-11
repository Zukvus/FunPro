import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { findPoolForOrder, listPools, type PoolMatch } from '@/features/inventory/pools';
import type { Order } from '@/shared/models';
import { Button, EmptyState, Select, Spinner, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { dateTime, errorText, money, useLocaleTag } from './common';

async function unassignedPaidSales(): Promise<Order[]> {
  const paid = await getDb().orders.where('[direction+status]').equals(['sale', 'paid']).toArray();
  const deliveries = await getDb().deliveries.bulkGet(paid.map((o) => o.id));
  return paid.filter((_, i) => !deliveries[i]);
}

/** Number of paid sales without a delivery record (cheap: no pool matching). */
export async function countAwaiting(): Promise<number> {
  return (await unassignedPaidSales()).length;
}

/** Paid sales without a delivery record (e.g. orders from before FunPro, or with no matching pool). */
export async function loadAwaiting(limit = 100): Promise<{ order: Order; match: PoolMatch }[]> {
  const waiting = (await unassignedPaidSales())
    .sort((a, b) => (b.createdAt ?? b.firstSeenAt).localeCompare(a.createdAt ?? a.firstSeenAt))
    .slice(0, limit);
  return Promise.all(waiting.map(async (order) => ({ order, match: await findPoolForOrder(order) })));
}

export function AwaitingTab() {
  const t = useT();
  const locale = useLocaleTag();
  const data = useLiveQuery(async () => ({ rows: await loadAwaiting(), pools: await listPools() }), []);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Spinner />;
  if (data.rows.length === 0)
    return <EmptyState title={t('ops.inv.await.empty')}>{t('ops.inv.await.emptyHelp')}</EmptyState>;

  const reserve = async (orderId: string, poolId: string) => {
    setBusy(orderId);
    try {
      const res = await rpc<{ kind: string }>('ui.inventory.reserve', { orderId, poolId });
      if (res.kind === 'reserved' || res.kind === 'existing')
        toast.success(t('ops.inv.await.reserved', { order: orderId }));
      else if (res.kind === 'out_of_stock') toast.error(t('ops.inv.await.oos'));
      else toast.error(t('ops.inv.await.notReserved'));
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">{t('ops.inv.await.help')}</p>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
        {data.rows.map(({ order, match }) => {
          const suggested = match.kind === 'match' ? match.pool.id : '';
          const poolId = choice[order.id] ?? suggested;
          return (
            <li key={order.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="fp-sensitive w-24 font-mono">#{order.id}</span>
              <span className="min-w-0 flex-1 truncate" title={order.description}>
                {order.description || '—'}
              </span>
              <span className="fp-sensitive text-xs text-muted">{order.counterpartyName}</span>
              <span className="text-xs tabular-nums text-muted">
                {money(order.price.amountMinor, order.price.currency, locale)}
              </span>
              <span className="text-xs text-muted">
                {dateTime(order.createdAt ?? order.firstSeenAt, locale)}
              </span>
              <span className="text-xs text-muted">
                {match.kind === 'match'
                  ? t(`ops.inv.await.via.${match.via}`)
                  : match.kind === 'ambiguous'
                    ? t('ops.inv.await.ambiguous')
                    : t('ops.inv.await.noMatch')}
              </span>
              <Select
                value={poolId}
                onChange={(e) => setChoice((c) => ({ ...c, [order.id]: e.target.value }))}
                className="w-44"
                aria-label={t('ops.inv.del.pool')}
              >
                <option value="">{t('ops.inv.await.choosePool')}</option>
                {data.pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={!poolId}
                loading={busy === order.id}
                onClick={() => void reserve(order.id, poolId)}
              >
                {t('ops.inv.await.reserve')}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
