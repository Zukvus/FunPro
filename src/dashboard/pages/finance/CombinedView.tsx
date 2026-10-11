import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { combineAmounts, validateRate } from '@/features/finance/exchange';
import type { Currency } from '@/shared/models';
import { Badge, Button, Callout, Card, Field, Input, Select } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useLang, useT } from '@/ui/i18n';
import { fmtDateTime, fmtMoney } from '@/dashboard/components/charts';

const CURRENCIES: Exclude<Currency, 'UNKNOWN'>[] = ['RUB', 'USD', 'EUR', 'UAH'];

function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Optional combined view of per-currency amounts. Requires manual exchange rates with a source and
 * a timestamp; every rate used is displayed next to the total, and currencies without a rate are
 * listed as excluded. FunPro never fetches or guesses rates.
 */
export interface CombinedMetric {
  key: string;
  label: string;
  amounts: Partial<Record<Currency, number>>;
}

export function CombinedView({ metrics }: { metrics: CombinedMetric[] }) {
  const t = useT();
  const lang = useLang();
  const [settings, update] = useSettings();
  const { exchangeRates: rates, combinedCurrency } = settings.analytics;
  const [form, setForm] = useState({ from: 'USD', to: 'RUB', rate: '', source: '', at: nowLocalInput() });
  const [error, setError] = useState<string | null>(null);
  const combined = useMemo(
    () =>
      combinedCurrency
        ? metrics.map((m) => ({ metric: m, result: combineAmounts(m.amounts, combinedCurrency, rates) }))
        : null,
    [metrics, combinedCurrency, rates],
  );
  // Every rate that is actually used, shown once next to the totals.
  const used = useMemo(() => {
    const out = new Map<string, NonNullable<ReturnType<typeof combineAmounts>['parts'][number]['rate']>>();
    for (const c of combined ?? []) for (const p of c.result.parts) if (p.rate) out.set(p.currency, p.rate);
    return [...out.entries()];
  }, [combined]);
  const missing = useMemo(() => [...new Set((combined ?? []).flatMap((c) => c.result.missing))], [combined]);

  const addRate = async () => {
    const res = validateRate({
      from: form.from,
      to: form.to,
      rate: Number(form.rate.replace(',', '.')),
      source: form.source,
      at: form.at ? new Date(form.at).toISOString() : '',
    });
    if (!res.ok) {
      setError(t(`finance.rates.error.${res.error}`));
      return;
    }
    setError(null);
    await update({ analytics: { exchangeRates: [...rates, res.rate].slice(-20) } });
    setForm({ ...form, rate: '', source: '' });
  };
  const removeRate = (i: number) =>
    void update({ analytics: { exchangeRates: rates.filter((_, j) => j !== i) } });

  return (
    <Card title={t('finance.combined.title')} description={t('finance.combined.description')}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('finance.combined.target')} htmlFor="combined-target">
          <Select
            id="combined-target"
            value={combinedCurrency ?? ''}
            onChange={(e) =>
              void update({ analytics: { combinedCurrency: (e.target.value || null) as Currency | null } })
            }
            className="w-auto"
          >
            <option value="">{t('finance.combined.off')}</option>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {combined && combinedCurrency && (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <table className="w-full text-xs">
            <caption className="sr-only">{t('finance.combined.title')}</caption>
            <tbody>
              {combined.map(({ metric, result }) => (
                <tr key={metric.key} className="border-t border-border/60 first:border-t-0">
                  <th scope="row" className="py-1.5 text-left font-normal text-muted">
                    {metric.label}
                  </th>
                  <td className="py-1.5 text-right text-sm font-semibold">
                    <span className="fp-balance">{fmtMoney(result.total, combinedCurrency, lang)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted">
            <Badge tone="warning">{t('finance.combined.converted')}</Badge>
            {used.length === 0 ? t('finance.combined.noConversion') : null}
          </p>
          {used.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {used.map(([cur, r]) => (
                <li key={cur}>
                  {t('finance.combined.rateUsed', {
                    rate: `1 ${r.inverse ? r.rate.to : r.rate.from} = ${r.rate.rate} ${r.inverse ? r.rate.from : r.rate.to}`,
                    source: r.rate.source,
                    at: fmtDateTime(r.rate.at, lang),
                  })}
                  {r.inverse && ` (${t('finance.combined.inverse')})`}
                </li>
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <p className="mt-1 text-xs text-warning">
              {t('finance.combined.missing', { list: missing.join(', ') })}
            </p>
          )}
        </div>
      )}

      <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
        {t('finance.rates.title')}
      </h3>
      {rates.length === 0 ? (
        <p className="text-xs text-muted">{t('finance.rates.none')}</p>
      ) : (
        <ul className="mb-3 space-y-1 text-xs">
          {rates.map((r, i) => (
            <li
              key={`${r.from}${r.to}${r.at}${i}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5"
            >
              <span>
                <span className="font-medium">
                  1 {r.from} = {r.rate} {r.to}
                </span>
                <span className="text-muted">
                  {' '}
                  · {r.source} · {fmtDateTime(r.at, lang)}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={12} />}
                onClick={() => removeRate(i)}
                aria-label={t('finance.rates.remove')}
              >
                {t('common.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-6">
        <Field label={t('finance.rates.from')} htmlFor="rate-from">
          <Select
            id="rate-from"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('finance.rates.to')} htmlFor="rate-to">
          <Select id="rate-to" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('finance.rates.rate')} htmlFor="rate-value">
          <Input
            id="rate-value"
            inputMode="decimal"
            value={form.rate}
            onChange={(e) => setForm({ ...form, rate: e.target.value })}
            placeholder="92.5"
          />
        </Field>
        <Field label={t('finance.rates.source')} htmlFor="rate-source">
          <Input
            id="rate-source"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            placeholder={t('finance.rates.sourcePlaceholder')}
            maxLength={120}
          />
        </Field>
        <Field label={t('finance.rates.at')} htmlFor="rate-at">
          <Input
            id="rate-at"
            type="datetime-local"
            value={form.at}
            onChange={(e) => setForm({ ...form, at: e.target.value })}
          />
        </Field>
        <div className="self-end">
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => void addRate()}
            disabled={!form.rate || !form.source.trim() || rates.length >= 20}
          >
            {t('finance.rates.add')}
          </Button>
        </div>
      </div>
      {error && (
        <div className="mt-2">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">{t('finance.rates.note')}</p>
    </Card>
  );
}
