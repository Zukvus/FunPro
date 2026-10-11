import { useState } from 'react';
import type { PriceRuleExt } from '@/features/pricing/model';
import type { Currency } from '@/shared/models/money';
import { Field, Input, Select, Textarea } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { minorToInput, parseAmountInput } from '../inventory/common';

/** Controlled editor for a repricing rule. Money fields are edited as decimal text. */
export function RuleForm({ rule, onChange, currency, cost, onCost }: { rule: PriceRuleExt; onChange: (r: PriceRuleExt) => void; currency: Currency; cost: string; onCost: (v: string) => void }) {
  const t = useT();
  const [money, setMoney] = useState({ min: minorToInput(rule.minMinor), max: minorToInput(rule.maxMinor), step: minorToInput(rule.stepMinor) });
  const [ignore, setIgnore] = useState(rule.ignoreSellers.join('\n'));
  const setMoneyField = (k: 'min' | 'max' | 'step', v: string) => {
    setMoney((m) => ({ ...m, [k]: v }));
    const minor = parseAmountInput(v);
    if (minor !== null && minor > 0) onChange({ ...rule, [k === 'min' ? 'minMinor' : k === 'max' ? 'maxMinor' : 'stepMinor']: minor });
  };
  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const unit = currency === 'UNKNOWN' ? '' : ` (${currency})`;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={t('ops.price.rule.strategy')} htmlFor="r-strategy">
        <Select id="r-strategy" value={rule.strategy} onChange={(e) => onChange({ ...rule, strategy: e.target.value as PriceRuleExt['strategy'] })}>
          {(['undercut_lowest', 'match_lowest', 'stay_in_top_n'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`ops.price.strategy.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`${t('ops.price.rule.step')}${unit}`} help={t('ops.price.rule.stepHelp')} htmlFor="r-step" error={parseAmountInput(money.step) === null || parseAmountInput(money.step) === 0 ? t('ops.common.invalidNumber') : undefined}>
        <Input id="r-step" inputMode="decimal" value={money.step} onChange={(e) => setMoneyField('step', e.target.value)} />
      </Field>
      {rule.strategy === 'stay_in_top_n' && (
        <Field label={t('ops.price.rule.topN')} htmlFor="r-topn">
          <Input id="r-topn" type="number" min={1} max={50} value={rule.topN} onChange={(e) => onChange({ ...rule, topN: Math.max(1, Math.trunc(num(e.target.value, rule.topN))) })} />
        </Field>
      )}
      <Field label={`${t('ops.price.rule.min')}${unit}`} help={t('ops.price.rule.minHelp')} htmlFor="r-min" error={parseAmountInput(money.min) === null ? t('ops.common.invalidNumber') : undefined}>
        <Input id="r-min" inputMode="decimal" value={money.min} onChange={(e) => setMoneyField('min', e.target.value)} />
      </Field>
      <Field label={`${t('ops.price.rule.max')}${unit}`} htmlFor="r-max" error={parseAmountInput(money.max) === null || rule.maxMinor < rule.minMinor ? t('ops.price.rule.maxError') : undefined}>
        <Input id="r-max" inputMode="decimal" value={money.max} onChange={(e) => setMoneyField('max', e.target.value)} />
      </Field>
      <Field label={`${t('ops.price.rule.cost')}${unit}`} help={t('ops.price.rule.costHelp')} htmlFor="r-cost" error={cost && parseAmountInput(cost) === null ? t('ops.common.invalidNumber') : undefined}>
        <Input id="r-cost" inputMode="decimal" value={cost} onChange={(e) => onCost(e.target.value)} placeholder="—" />
      </Field>
      <Field label={t('ops.price.rule.margin')} help={t('ops.price.rule.marginHelp')} htmlFor="r-margin">
        <Input id="r-margin" type="number" min={0} max={1000} value={rule.minMarginPct} onChange={(e) => onChange({ ...rule, minMarginPct: Math.min(1000, Math.max(0, num(e.target.value, rule.minMarginPct))) })} />
      </Field>
      <Field label={t('ops.price.rule.cooldown')} help={t('ops.price.rule.cooldownHelp')} htmlFor="r-cool">
        <Input id="r-cool" type="number" min={30} value={rule.cooldownMinutes} onChange={(e) => onChange({ ...rule, cooldownMinutes: Math.max(30, Math.trunc(num(e.target.value, rule.cooldownMinutes))) })} />
      </Field>
      <Field label={t('ops.price.rule.maxPerDay')} htmlFor="r-perday">
        <Input id="r-perday" type="number" min={1} max={24} value={rule.maxChangesPerDay} onChange={(e) => onChange({ ...rule, maxChangesPerDay: Math.min(24, Math.max(1, Math.trunc(num(e.target.value, rule.maxChangesPerDay)))) })} />
      </Field>
      <Field label={t('ops.price.rule.oscChanges')} help={t('ops.price.rule.oscHelp')} htmlFor="r-osc">
        <Input id="r-osc" type="number" min={1} max={50} value={rule.oscillationMaxChanges} onChange={(e) => onChange({ ...rule, oscillationMaxChanges: Math.min(50, Math.max(1, Math.trunc(num(e.target.value, rule.oscillationMaxChanges)))) })} />
      </Field>
      <Field label={t('ops.price.rule.oscWindow')} htmlFor="r-oscw">
        <Input id="r-oscw" type="number" min={5} max={1440} value={rule.oscillationWindowMin} onChange={(e) => onChange({ ...rule, oscillationWindowMin: Math.min(1440, Math.max(5, Math.trunc(num(e.target.value, rule.oscillationWindowMin)))) })} />
      </Field>
      <Field label={t('ops.price.rule.similarity')} help={t('ops.price.rule.similarityHelp')} htmlFor="r-sim">
        <Input id="r-sim" type="number" min={0} max={100} value={Math.round(rule.minSimilarity * 100)} onChange={(e) => onChange({ ...rule, minSimilarity: Math.min(1, Math.max(0, num(e.target.value, 0) / 100)) })} />
      </Field>
      <Field label={t('ops.price.rule.band')} help={t('ops.price.rule.bandHelp')} htmlFor="r-band">
        <Input id="r-band" type="number" min={5} max={1000} value={rule.priceBandPct} onChange={(e) => onChange({ ...rule, priceBandPct: Math.min(1000, Math.max(5, Math.trunc(num(e.target.value, rule.priceBandPct)))) })} />
      </Field>
      <div className="sm:col-span-2 lg:col-span-4">
        <Field label={t('ops.price.rule.ignore')} help={t('ops.price.rule.ignoreHelp')} htmlFor="r-ignore">
          <Textarea
            id="r-ignore"
            rows={2}
            value={ignore}
            onChange={(e) => {
              setIgnore(e.target.value);
              onChange({ ...rule, ignoreSellers: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 100) });
            }}
          />
        </Field>
      </div>
    </div>
  );
}
