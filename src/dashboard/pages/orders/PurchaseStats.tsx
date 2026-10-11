import { useMemo } from 'react';
import { topCounterparties, totalsOf } from '@/features/orders/query';
import type { Order } from '@/shared/models';
import { Card } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { fmtInt, MoneyList } from '@/dashboard/components/charts';

/** Purchase statistics for the current (filtered) purchases. */
export function PurchaseStats({ orders }: { orders: readonly Order[] }) {
  const t = useT();
  const lang = useLang();
  const totals = useMemo(() => totalsOf(orders), [orders]);
  const sellers = useMemo(() => topCounterparties(orders, 5), [orders]);
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) if (o.status !== 'refunded') m.set(o.categoryName || '—', (m.get(o.categoryName || '—') ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [orders]);
  return (
    <Card title={t('orders.purchases.statsTitle')} description={t('orders.purchases.statsDescription')}>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-xs text-muted">{t('orders.purchases.count')}</p>
          <p className="text-xl font-semibold">{fmtInt(totals.count - totals.byStatus.refunded, lang)}</p>
          <p className="mt-1 text-xs text-muted">{t('orders.purchases.spent')}</p>
          <p className="text-sm font-medium">
            <MoneyList amounts={totals.amountByCurrency} />
          </p>
          {totals.byStatus.refunded > 0 && (
            <p className="mt-1 text-xs text-muted">
              {t('orders.purchases.refunded', { count: totals.byStatus.refunded })} <MoneyList amounts={totals.refundedByCurrency} />
            </p>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">{t('orders.purchases.topSellers')}</p>
          <ol className="space-y-0.5 text-sm">
            {sellers.length === 0 && <li className="text-muted">—</li>}
            {sellers.map((s) => (
              <li key={s.key} className="flex justify-between gap-2">
                <span className="truncate fp-sensitive">{s.name || '—'}</span>
                <span className="shrink-0 text-xs text-muted">
                  {t('orders.purchases.ordersN', { count: s.orders })} · <MoneyList amounts={s.amountByCurrency} />
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">{t('orders.purchases.topCategories')}</p>
          <ol className="space-y-0.5 text-sm">
            {categories.length === 0 && <li className="text-muted">—</li>}
            {categories.map(([c, n]) => (
              <li key={c} className="flex justify-between gap-2">
                <span className="truncate">{c}</span>
                <span className="shrink-0 text-xs text-muted">{fmtInt(n, lang)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}
