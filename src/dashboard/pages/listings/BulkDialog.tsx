import { AlertTriangle, ArrowRight, Play } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { rpc } from '@/core/messaging/client';
import {
  buildBulkPlan,
  deleteConfirmationPhrase,
  MAX_EXECUTABLE_ITEMS,
  summarizePlan,
  type BulkOperation,
  type BulkOpKind,
  type BulkPlan,
  type PlanItem,
  type PlanValues,
  type RoundingMode,
  type WarningCode,
} from '@/features/listings/bulk-plan';
import { deletePlan, savePlan } from '@/features/listings/bulk-store';
import { parsePriceInput } from '@/features/listings/commission';
import type { ExecuteResult } from '@/features/listings/bulk-exec';
import type { Currency } from '@/shared/models/money';
import type { Listing } from '@/shared/models';
import {
  Badge,
  Button,
  Callout,
  DataTable,
  Field,
  Input,
  Modal,
  Select,
  toast,
  type Column,
} from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT, type TFunction } from '@/ui/i18n';
import { LiveGateNotice, errorText, truncate, useFormat, useLiveGate, type Formatters } from './shared';

export type BulkDialogInput =
  { kind: 'configure'; op: BulkOpKind; listings: Listing[] } | { kind: 'plan'; plan: BulkPlan };

const NO_PARAMS: BulkOpKind[] = ['enable', 'disable', 'delete'];
const PRICE_OPS: BulkOpKind[] = ['set_price', 'adjust_pct', 'adjust_fixed'];
const ROUNDING: RoundingMode[] = ['minor', 'unit_nearest', 'unit_up', 'unit_down', 'ten_nearest', 'end_99'];
const WARNING_TONE: Record<WarningCode, 'warning' | 'danger' | 'info' | 'neutral'> = {
  below_cost: 'danger',
  price_non_positive: 'danger',
  large_change: 'warning',
  unknown_currency: 'warning',
  mixed_currency: 'warning',
  auto_delivery_stock: 'info',
  irreversible: 'danger',
  already_in_state: 'neutral',
  stale_snapshot: 'warning',
};

export function opLabel(t: TFunction, op: BulkOperation | BulkOpKind): string {
  const kind = typeof op === 'string' ? op : op.kind;
  return t(`listings.op.${kind}`);
}

export function BulkDialog({
  input,
  onClose,
  onExecuted,
}: {
  input: BulkDialogInput;
  onClose: () => void;
  onExecuted: (planId: string) => void;
}) {
  const t = useT();
  const [settings] = useSettings();
  const initialOp = input.kind === 'configure' ? input.op : input.plan.op.kind;
  const [opKind, setOpKind] = useState<BulkOpKind>(initialOp);
  const [plan, setPlan] = useState<BulkPlan | null>(() => {
    if (input.kind === 'plan') return input.plan;
    if (NO_PARAMS.includes(input.op)) return build(input.listings, { kind: input.op } as BulkOperation);
    return null;
  });
  // Parameters
  const [priceText, setPriceText] = useState('');
  const [pctText, setPctText] = useState('');
  const [rounding, setRounding] = useState<RoundingMode>('minor');
  const [deltaText, setDeltaText] = useState('');
  const [stockText, setStockText] = useState('');
  const [paramError, setParamError] = useState<string | null>(null);

  function build(listings: Listing[], op: BulkOperation): BulkPlan {
    const label = `${opLabel(t, op)} · ${t('listings.bulk.count', { count: listings.length })}`;
    return buildBulkPlan(listings, op, { fees: settings.fees, now: Date.now(), label, source: 'bulk' });
  }

  const configure = () => {
    if (input.kind !== 'configure') return;
    let op: BulkOperation;
    if (opKind === 'set_price') {
      const v = parsePriceInput(priceText);
      if (v === null || v <= 0) return setParamError(t('listings.bulk.err.price'));
      op = { kind: 'set_price', priceMinor: v };
    } else if (opKind === 'adjust_pct') {
      const v = Number(pctText.replace(',', '.').replace(/\s/g, ''));
      if (!pctText.trim() || !Number.isFinite(v) || v === 0 || v < -99.99 || v > 1000)
        return setParamError(t('listings.bulk.err.pct'));
      op = { kind: 'adjust_pct', pct: Math.round(v * 100) / 100, rounding };
    } else if (opKind === 'adjust_fixed') {
      const neg = deltaText.trim().startsWith('-');
      const v = parsePriceInput(deltaText.replace(/^[+-]/, ''));
      if (v === null || v === 0) return setParamError(t('listings.bulk.err.delta'));
      op = { kind: 'adjust_fixed', deltaMinor: neg ? -v : v };
    } else if (opKind === 'set_stock') {
      const v = Number(stockText);
      if (!/^\d+$/.test(stockText.trim()) || v > 1_000_000)
        return setParamError(t('listings.bulk.err.stock'));
      op = { kind: 'set_stock', amount: v };
    } else {
      op = { kind: opKind } as BulkOperation;
    }
    setParamError(null);
    setPlan(build(input.listings, op));
  };

  const title = plan
    ? `${t('listings.bulk.previewTitle')}: ${plan.label}`
    : `${opLabel(t, opKind)} — ${t('listings.bulk.configureTitle')}`;

  return (
    <Modal open onClose={onClose} wide title={title}>
      {plan ? (
        <PlanPreview
          plan={plan}
          onBack={
            input.kind === 'configure' && !NO_PARAMS.includes(input.op) ? () => setPlan(null) : undefined
          }
          onClose={onClose}
          onExecuted={onExecuted}
        />
      ) : input.kind === 'configure' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {t('listings.bulk.configureIntro', { count: input.listings.length })}
          </p>
          {PRICE_OPS.includes(opKind) && (
            <Field label={t('listings.bulk.priceOp')}>
              <Select value={opKind} onChange={(e) => setOpKind(e.target.value as BulkOpKind)}>
                {PRICE_OPS.map((k) => (
                  <option key={k} value={k}>
                    {opLabel(t, k)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {opKind === 'set_price' && (
            <Field
              label={t('listings.bulk.newPrice')}
              help={t('listings.bulk.newPrice.help')}
              error={paramError ?? undefined}
            >
              <Input
                inputMode="decimal"
                autoFocus
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder="199.99"
              />
            </Field>
          )}
          {opKind === 'adjust_pct' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('listings.bulk.pct')}
                help={t('listings.bulk.pct.help')}
                error={paramError ?? undefined}
              >
                <Input
                  inputMode="decimal"
                  autoFocus
                  value={pctText}
                  onChange={(e) => setPctText(e.target.value)}
                  placeholder="+10 / -5"
                />
              </Field>
              <Field label={t('listings.bulk.rounding')}>
                <Select value={rounding} onChange={(e) => setRounding(e.target.value as RoundingMode)}>
                  {ROUNDING.map((r) => (
                    <option key={r} value={r}>
                      {t(`listings.rounding.${r}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {opKind === 'adjust_fixed' && (
            <Field
              label={t('listings.bulk.delta')}
              help={t('listings.bulk.delta.help')}
              error={paramError ?? undefined}
            >
              <Input
                inputMode="decimal"
                autoFocus
                value={deltaText}
                onChange={(e) => setDeltaText(e.target.value)}
                placeholder="+50 / -25.5"
              />
            </Field>
          )}
          {opKind === 'set_stock' && (
            <Field
              label={t('listings.bulk.stockValue')}
              help={t('listings.bulk.stockValue.help')}
              error={paramError ?? undefined}
            >
              <Input
                inputMode="numeric"
                autoFocus
                value={stockText}
                onChange={(e) => setStockText(e.target.value)}
                placeholder="10"
              />
            </Field>
          )}
          <Callout tone="info">{t('listings.bulk.dryRunNote')}</Callout>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" icon={<ArrowRight size={14} aria-hidden />} onClick={configure}>
              {t('listings.bulk.preview')}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function valueText(t: TFunction, fmt: Formatters, v: PlanValues, currency: Currency): string {
  const parts: string[] = [];
  if (v.deleted) parts.push(t('listings.value.deleted'));
  if (v.priceMinor !== undefined) parts.push(v.priceMinor === null ? '—' : fmt.money(v.priceMinor, currency));
  if (v.active !== undefined && v.active !== null)
    parts.push(v.active ? t('listings.active') : t('listings.inactive'));
  if (v.amount !== undefined) parts.push(`${t('listings.col.stock')}: ${v.amount === null ? '∞' : v.amount}`);
  if (v.summaryEn !== undefined && v.summaryEn !== null)
    parts.push(`EN: ${v.summaryEn ? truncate(v.summaryEn, 50) : t('listings.value.empty')}`);
  if (v.descEn !== undefined && v.descEn !== null)
    parts.push(
      `EN ${t('listings.value.desc')}: ${v.descEn ? truncate(v.descEn, 40) : t('listings.value.empty')}`,
    );
  return parts.join(' · ') || '—';
}

/** Restrict the "before" text to the fields this item changes. */
function relevantBefore(item: PlanItem): PlanValues {
  const keys = Object.keys(item.after) as (keyof PlanValues)[];
  const out: PlanValues = {};
  for (const k of keys) {
    if (k === 'deleted') continue;
    (out as Record<string, unknown>)[k] = item.before[k] ?? null;
  }
  return out;
}

export function PlanPreview({
  plan,
  onBack,
  onClose,
  onExecuted,
}: {
  plan: BulkPlan;
  onBack?: () => void;
  onClose: () => void;
  onExecuted: (planId: string) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const gate = useLiveGate();
  const summary = useMemo(() => summarizePlan(plan), [plan]);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const isDelete = plan.op.kind === 'delete';
  const expected = deleteConfirmationPhrase(summary.actionable);
  const phraseOk = !isDelete || phrase.trim() === expected;
  const canExecute = gate.ok && summary.actionable > 0 && !summary.tooLarge && phraseOk && !busy;
  const relative = plan.items.some((i) => i.expectPriceMinor !== null && !i.skip);

  const execute = async () => {
    setBusy(true);
    const toSave: BulkPlan = { ...plan, status: 'draft', confirmation: isDelete ? phrase.trim() : null };
    try {
      await savePlan(toSave);
      const res = await rpc<ExecuteResult>('ui.bulkEdit.execute', { planId: toSave.id });
      toast.success(t('listings.bulk.queued', { count: res.queued }));
      onExecuted(toSave.id);
    } catch (e) {
      await deletePlan(toSave.id).catch(() => undefined);
      toast.error(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<PlanItem>[] = [
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
      key: 'before',
      header: t('listings.bulk.before'),
      width: 'minmax(0,1.3fr)',
      render: (i) => (
        <span className="truncate text-muted">{valueText(t, fmt, relevantBefore(i), i.currency)}</span>
      ),
    },
    {
      key: 'after',
      header: t('listings.bulk.after'),
      width: 'minmax(0,1.3fr)',
      render: (i) => (
        <span className="truncate font-medium">{i.skip ? '—' : valueText(t, fmt, i.after, i.currency)}</span>
      ),
    },
    {
      key: 'notes',
      header: t('listings.bulk.notes'),
      width: 'minmax(0,1.6fr)',
      render: (i) => (
        <span className="flex flex-wrap gap-1 overflow-hidden">
          {i.skip && <Badge tone="neutral">{t(`listings.skip.${i.skip}`)}</Badge>}
          {i.warnings.map((w) => (
            <Badge key={w} tone={WARNING_TONE[w]} title={t(`listings.warn.${w}.hint`)}>
              {t(`listings.warn.${w}`)}
            </Badge>
          ))}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="accent">{t('listings.bulk.sum.change', { count: summary.actionable })}</Badge>
        {summary.skipped > 0 && <Badge>{t('listings.bulk.sum.skip', { count: summary.skipped })}</Badge>}
        {(Object.entries(summary.warnings) as [WarningCode, number][]).map(([w, n]) => (
          <Badge key={w} tone={WARNING_TONE[w]}>
            {t(`listings.warn.${w}`)}: {n}
          </Badge>
        ))}
      </div>
      <Callout tone="info">{t('listings.bulk.previewNote')}</Callout>
      {relative && <Callout tone="info">{t('listings.bulk.conflictNote')}</Callout>}
      {(summary.warnings.below_cost ?? 0) > 0 && (
        <Callout tone="danger" title={t('listings.warn.below_cost')}>
          {t('listings.warn.below_cost.hint')}
        </Callout>
      )}
      {(summary.warnings.large_change ?? 0) > 0 && (
        <Callout tone="warning">{t('listings.warn.large_change.hint')}</Callout>
      )}
      {summary.tooLarge && (
        <Callout tone="danger">{t('listings.bulk.tooLarge', { max: MAX_EXECUTABLE_ITEMS })}</Callout>
      )}
      <DataTable
        rows={plan.items}
        columns={columns}
        rowKey={(i) => i.listingId}
        height={360}
        rowHeight={40}
      />
      {isDelete && summary.actionable > 0 && (
        <Callout tone="danger" title={t('listings.bulk.delete.title')}>
          <p>{t('listings.bulk.delete.body', { count: summary.actionable })}</p>
          <Field label={t('listings.bulk.delete.type', { phrase: expected })} htmlFor="bulk-delete-phrase">
            <Input
              id="bulk-delete-phrase"
              autoComplete="off"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={expected}
            />
          </Field>
        </Callout>
      )}
      <LiveGateNotice reason={gate.reason} />
      <Footer>
        {onBack && (
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            {t('listings.bulk.back')}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant={isDelete ? 'danger' : 'primary'}
          icon={isDelete ? <AlertTriangle size={14} aria-hidden /> : <Play size={14} aria-hidden />}
          disabled={!canExecute}
          loading={busy}
          onClick={() => void execute()}
        >
          {isDelete
            ? t('listings.bulk.executeDelete', { count: summary.actionable })
            : t('listings.bulk.execute', { count: summary.actionable })}
        </Button>
      </Footer>
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">{children}</div>;
}
