import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { profitSheet, sheetToTable } from '@/features/analytics/report';
import type { ProfitRow, ProfitTotals } from '@/features/analytics/profit';
import { exportTable } from '@/features/export/table';
import { Badge, Button, Callout, Card, Input } from '@/ui/components';
import { getSettings, replaceSettings } from '@/core/settings/store';
import { useSettings } from '@/ui/hooks/useSettings';
import { useLang, useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { Amount, fmtInt } from '@/dashboard/components/charts';
import { CsvButton } from './Charts';

function pctInput(v: string): number | null | 'invalid' {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : 'invalid';
}

/** Seller-entered commission percentages (settings.fees) for the categories in the current period. */
function CommissionEditor({ categories }: { categories: string[] }) {
  const t = useT();
  const [settings, update] = useSettings();
  const fees = settings.fees;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = (k: string) =>
    draft[k] ??
    (k === '*'
      ? fees.defaultCommissionPct === null
        ? ''
        : String(fees.defaultCommissionPct)
      : fees.categoryCommissionPct[k] === undefined
        ? ''
        : String(fees.categoryCommissionPct[k]));
  const invalid = Object.values(draft).some((v) => pctInput(v) === 'invalid');
  const save = async () => {
    const set: Record<string, number> = {};
    const removed: string[] = [];
    let def = fees.defaultCommissionPct;
    for (const [k, v] of Object.entries(draft)) {
      const n = pctInput(v);
      if (n === 'invalid') return;
      if (k === '*') def = n;
      else if (n === null) removed.push(k);
      else set[k] = n;
    }
    if (removed.length === 0) {
      await update({ fees: { categoryCommissionPct: set, defaultCommissionPct: def } });
    } else {
      // Settings patches merge records key by key, so removing a key needs a full replace.
      const current = await getSettings();
      const table = { ...current.fees.categoryCommissionPct, ...set };
      for (const k of removed) delete table[k];
      await replaceSettings({
        ...current,
        fees: { ...current.fees, categoryCommissionPct: table, defaultCommissionPct: def },
      });
    }
    setDraft({});
  };
  return (
    <details className="mt-3 rounded-lg border border-border px-3 py-2 text-xs">
      <summary className="cursor-pointer text-muted">{t('analytics.profit.commissionEditor')}</summary>
      <p className="mt-2 text-muted">{t('analytics.profit.commissionHelp')}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {['*', ...categories].map((k) => (
          <label key={k} className="flex items-center justify-between gap-2">
            <span className="truncate">{k === '*' ? t('analytics.profit.defaultCommission') : k}</span>
            <span className="flex items-center gap-1">
              <Input
                inputMode="decimal"
                value={value(k)}
                placeholder="—"
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                aria-invalid={pctInput(value(k)) === 'invalid'}
                className={cn('h-8 w-20 text-right', pctInput(value(k)) === 'invalid' && 'border-danger')}
              />
              %
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={invalid || Object.keys(draft).length === 0}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
      </div>
    </details>
  );
}

export function ProfitCard({ rows, totals }: { rows: ProfitRow[]; totals: ProfitTotals[] }) {
  const t = useT();
  const lang = useLang();
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const top = rows.slice(0, 25);
  const anyGross = rows.some((r) => r.netGrossOrders > 0);
  const anyNoCost = rows.some((r) => r.costUnknownOrders > 0 || r.costCurrencyMismatch > 0);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {t('analytics.profit.title')} <Badge tone="warning">{t('common.estimate')}</Badge>
        </span>
      }
      description={t('analytics.profit.description')}
      actions={
        <CsvButton
          onClick={() => exportTable(sheetToTable(profitSheet(rows), 'funpro-profit-estimate'), 'csv')}
        />
      }
    >
      {totals.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {totals.map((tt) => (
            <div key={tt.currency} className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
              <p className="text-muted">{t('analytics.profit.totalIn', { currency: tt.currency })}</p>
              <p className="text-base font-semibold">
                <Amount minor={tt.profit} currency={tt.currency} />
              </p>
              <p className="text-muted">
                {t('analytics.profit.totalBreakdown', { orders: tt.orders })}{' '}
                <Amount minor={tt.net} currency={tt.currency} /> −{' '}
                <Amount minor={tt.cost} currency={tt.currency} />
              </p>
              {!tt.complete && <p className="mt-0.5 text-warning">{t('analytics.profit.incomplete')}</p>}
            </div>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">{t('analytics.empty.period')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">{t('analytics.profit.title')}</caption>
            <thead>
              <tr className="text-left text-muted">
                <th scope="col" className="pb-1 font-medium">
                  {t('analytics.col.product')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.orders')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.gross')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.net')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.cost')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.profit')}
                </th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.key} className="border-t border-border/60 align-top">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    <span className="block max-w-[24rem] truncate" title={r.title}>
                      {r.title || '—'}
                    </span>
                    <span className="text-[11px] text-muted">
                      {r.category} · {r.currency}
                    </span>
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{fmtInt(r.orders, lang)}</td>
                  <td className="py-1.5 text-right">
                    <Amount minor={r.gross} currency={r.currency} />
                  </td>
                  <td className="py-1.5 text-right">
                    <Amount minor={r.net} currency={r.currency} />
                    <span className="block text-[10px] text-muted">
                      {r.netActualOrders > 0 &&
                        t('analytics.profit.basis.actual', { count: r.netActualOrders })}
                      {r.netActualOrders > 0 && (r.netEstimatedOrders > 0 || r.netGrossOrders > 0) && ' · '}
                      {r.netEstimatedOrders > 0 &&
                        t('analytics.profit.basis.estimated', {
                          count: r.netEstimatedOrders,
                          pct: r.commissionPct ?? '?',
                        })}
                      {r.netEstimatedOrders > 0 && r.netGrossOrders > 0 && ' · '}
                      {r.netGrossOrders > 0 && (
                        <span className="text-warning">
                          {t('analytics.profit.basis.gross', { count: r.netGrossOrders })}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">
                    {r.costKnownOrders > 0 ? (
                      <Amount minor={r.cost} currency={r.currency} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {(r.costUnknownOrders > 0 || r.costCurrencyMismatch > 0) && (
                      <span className="block text-[10px] text-warning">
                        {r.costUnknownOrders > 0 &&
                          t('analytics.profit.costUnknown', { count: r.costUnknownOrders })}
                        {r.costCurrencyMismatch > 0 &&
                          ` ${t('analytics.profit.costMismatch', { count: r.costCurrencyMismatch })}`}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-semibold">
                    <Amount minor={r.profit} currency={r.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > top.length && (
            <p className="mt-1 text-[11px] text-muted">
              {t('analytics.profit.more', { count: rows.length - top.length })}
            </p>
          )}
        </div>
      )}
      {(anyGross || anyNoCost) && (
        <div className="mt-3">
          <Callout tone="info">
            <span className="inline-flex items-start gap-1.5">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {anyGross && t('analytics.profit.hintCommission')}{' '}
                {anyNoCost && t('analytics.profit.hintCost')}
              </span>
            </span>
          </Callout>
        </div>
      )}
      <CommissionEditor categories={categories} />
    </Card>
  );
}
