import { Calculator, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { rpc } from '@/core/messaging/client';
import { getSettings, replaceSettings } from '@/core/settings/store';
import { resolveCommission } from '@/features/listings/commission';
import { listingNodes } from '@/features/listings/filters';
import type { Currency } from '@/shared/models/money';
import type { Listing } from '@/shared/models';
import { Badge, Button, Callout, Card, EmptyState, Field, IconButton, Input, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { errorText, useFormat } from './shared';

export interface CalcQuote {
  nodeId: string;
  testedPriceMinor: number;
  methods: { name: string; priceMinor: number; currency: string }[];
  minPriceText: string | null;
  commissionPct: number | null;
}

/** Test price for /lots/calc: large enough for a precise % (Wingman uses the same idea). */
export function calcTestPrice(currency: Currency): number {
  return currency === 'USD' || currency === 'EUR' ? 100_000 : 1_000_000;
}

function parsePct(text: string): number | null {
  const v = Number(text.replace(',', '.').trim());
  return text.trim() !== '' && Number.isFinite(v) && v >= 0 && v < 100 ? Math.round(v * 100) / 100 : null;
}

export function CommissionPanel({ listings }: { listings: Listing[] }) {
  const t = useT();
  const fmt = useFormat();
  const [settings, update] = useSettings();
  const nodes = useMemo(() => listingNodes(listings), [listings]);
  const currencyByNode = useMemo(() => {
    const m = new Map<string, Currency>();
    for (const l of listings) if (l.nodeId && !m.has(l.nodeId) && l.price.currency !== 'UNKNOWN') m.set(l.nodeId, l.price.currency);
    return m;
  }, [listings]);
  const [defaultText, setDefaultText] = useState(settings.fees.defaultCommissionPct === null ? '' : String(settings.fees.defaultCommissionPct));
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [quotes, setQuotes] = useState<Record<string, CalcQuote>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const saveDefault = () => {
    const v = defaultText.trim() === '' ? null : parsePct(defaultText);
    if (defaultText.trim() !== '' && v === null) return toast.error(t('listings.fee.invalid'));
    void update({ fees: { defaultCommissionPct: v } });
  };

  const saveNode = (nodeId: string, pct: number, source: 'calc' | 'manual') => {
    void update({ fees: { nodeCommission: { [nodeId]: { pct, source, at: Date.now() } } } }).then(() => toast.success(t('listings.fee.saved', { pct: fmt.pct(pct) })));
  };

  const removeNode = async (nodeId: string) => {
    // updateSettings deep-merges records (a key cannot be removed by a patch): replace explicitly.
    const cur = await getSettings();
    const next = { ...cur.fees.nodeCommission };
    delete next[nodeId];
    await replaceSettings({ ...cur, fees: { ...cur.fees, nodeCommission: next } });
  };

  const ask = async (nodeId: string) => {
    setBusy(nodeId);
    try {
      const q = await rpc<CalcQuote>('ui.calcCommission', { nodeId, priceMinor: calcTestPrice(currencyByNode.get(nodeId) ?? 'RUB') });
      setQuotes((s) => ({ ...s, [nodeId]: q }));
      if (q.commissionPct === null) toast.info(t('listings.fee.noPct'));
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Callout tone="info" title={t('listings.fee.howTitle')}>
        <p>{t('listings.fee.how')}</p>
        <p className="mt-1">{t('listings.fee.estimateNote')}</p>
      </Callout>
      <Card title={t('listings.fee.default')} description={t('listings.fee.defaultHelp')}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('listings.fee.pct')} htmlFor="fee-default">
            <Input id="fee-default" inputMode="decimal" className="w-32" value={defaultText} placeholder="—" onChange={(e) => setDefaultText(e.target.value)} onBlur={saveDefault} onKeyDown={(e) => e.key === 'Enter' && saveDefault()} />
          </Field>
        </div>
      </Card>
      {nodes.length === 0 ? (
        <EmptyState title={t('listings.fee.empty.title')}>{t('listings.empty.body')}</EmptyState>
      ) : (
        <Card title={t('listings.fee.nodes')} description={t('listings.fee.nodesHelp')}>
          <ul className="divide-y divide-border">
            {nodes.map((n) => {
              const info = resolveCommission({ nodeId: n.nodeId, categoryName: n.name }, settings.fees);
              const entry = settings.fees.nodeCommission[n.nodeId];
              const q = quotes[n.nodeId];
              return (
                <li key={n.nodeId} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{n.name || `#${n.nodeId}`}</p>
                      <p className="text-xs text-muted">
                        #{n.nodeId} · {t('listings.bulk.count', { count: n.count })}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {info ? (
                        <Badge tone={info.fromFunPay ? 'success' : 'warning'} title={entry ? fmt.dateTime(entry.at) : undefined}>
                          {fmt.pct(info.pct)} · {t(`listings.fee.source.${info.source}`)}
                        </Badge>
                      ) : (
                        <Badge>{t('listings.fee.unknown')}</Badge>
                      )}
                      <Input
                        aria-label={t('listings.fee.manualFor', { name: n.name || n.nodeId })}
                        inputMode="decimal"
                        className="h-8 w-24 text-xs"
                        placeholder="%"
                        value={edits[n.nodeId] ?? ''}
                        onChange={(e) => setEdits((s) => ({ ...s, [n.nodeId]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          const v = parsePct(edits[n.nodeId] ?? '');
                          if (v === null) toast.error(t('listings.fee.invalid'));
                          else saveNode(n.nodeId, v, 'manual');
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={parsePct(edits[n.nodeId] ?? '') === null}
                        onClick={() => {
                          const v = parsePct(edits[n.nodeId] ?? '');
                          if (v !== null) saveNode(n.nodeId, v, 'manual');
                        }}
                      >
                        {t('common.save')}
                      </Button>
                      <Button size="sm" icon={<Calculator size={14} aria-hidden />} loading={busy === n.nodeId} onClick={() => void ask(n.nodeId)}>
                        {t('listings.fee.ask')}
                      </Button>
                      {entry && (
                        <IconButton label={t('listings.fee.remove')} onClick={() => void removeNode(n.nodeId)}>
                          <Trash2 size={14} />
                        </IconButton>
                      )}
                    </div>
                  </div>
                  {q && (
                    <div className="mt-2 rounded-lg bg-surface-2 p-2 text-xs">
                      <p className="mb-1 text-muted">{t('listings.fee.quoteFor', { price: fmt.money(q.testedPriceMinor, currencyByNode.get(n.nodeId) ?? 'RUB') })}</p>
                      <ul className="grid gap-x-4 sm:grid-cols-2">
                        {q.methods.map((m) => (
                          <li key={`${m.name}-${m.priceMinor}`} className="flex justify-between gap-2">
                            <span className="truncate">{m.name}</span>
                            <span className="tabular-nums">{fmt.money(m.priceMinor, (m.currency as Currency) ?? 'UNKNOWN')}</span>
                          </li>
                        ))}
                      </ul>
                      {q.minPriceText && <p className="mt-1 text-muted">{t('listings.fee.minPrice', { price: q.minPriceText })}</p>}
                      {q.commissionPct !== null && (
                        <Button className="mt-2" size="sm" variant="primary" onClick={() => saveNode(n.nodeId, q.commissionPct!, 'calc')}>
                          {t('listings.fee.useCalc', { pct: fmt.pct(q.commissionPct) })}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
