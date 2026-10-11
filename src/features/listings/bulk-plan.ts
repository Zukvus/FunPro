/**
 * Bulk editing — plan model and the pure plan builder.
 *
 * A plan is a dry run: for every selected listing it records the value FunPro believes FunPay has
 * (`before`, from the last sync), the value the seller asked for (`after`), the exact offer-editor
 * field changes (`changes`) and warnings. Nothing touches FunPay until the plan is executed
 * (see bulk-exec.ts), and execution re-checks every item against the LIVE offer editor:
 *
 *  - price changes that depend on the old price (± %, ± amount, import) carry `expectPriceMinor`:
 *    if FunPay's editor shows a different price the item is skipped as a conflict
 *    (optimistic concurrency — the seller re-plans with fresh data instead of FunPro guessing);
 *  - "fill English" items carry `onlyIfEmpty`: text is written only when the live field is empty;
 *  - fields that already have the target value are not re-submitted.
 *
 * Prices are integer minor units. Percent adjustments use 0.01 % precision and exact integer
 * rounding (see `applyPct`).
 */
import { z } from 'zod';
import type { Settings } from '@/core/settings/schema';
import { CurrencySchema, type Listing } from '@/shared/models';
import { newId } from '@/core/util/id';
import { divCeil, divFloor, divRound, formatPriceField, netFromBuyerPrice, resolveCommission } from './commission';

/** Execution is refused above this many actionable items (FunPay requests are spaced ~2.5 s apart). */
export const MAX_EXECUTABLE_ITEMS = 2000;
/** Changes larger than this fraction of the old price are flagged. */
export const LARGE_CHANGE_RATIO = 0.5;
/** Upper bound for any price FunPro will submit (10 million currency units). */
export const MAX_PRICE_MINOR = 1_000_000_000;

export const EN_SUMMARY = 'fields[summary][en]';
export const EN_DESC = 'fields[desc][en]';
export const RU_SUMMARY = 'fields[summary][ru]';
export const RU_DESC = 'fields[desc][ru]';

/** The only offer-editor fields a bulk plan may change. `deleted` is accepted only for delete plans. */
export const CHANGE_KEYS = ['price', 'amount', 'active', EN_SUMMARY, EN_DESC, 'deleted'] as const;
export const ChangeKeySchema = z.enum(CHANGE_KEYS);
export type ChangeKey = z.infer<typeof ChangeKeySchema>;
export const ChangesSchema = z.partialRecord(ChangeKeySchema, z.string().max(20000));
export type Changes = z.infer<typeof ChangesSchema>;

export const RoundingModeSchema = z.enum(['minor', 'unit_nearest', 'unit_up', 'unit_down', 'ten_nearest', 'end_99']);
export type RoundingMode = z.infer<typeof RoundingModeSchema>;

export const BulkOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enable') }),
  z.object({ kind: z.literal('disable') }),
  z.object({ kind: z.literal('set_price'), priceMinor: z.number().int() }),
  z.object({ kind: z.literal('adjust_pct'), pct: z.number().min(-99.99).max(1000), rounding: RoundingModeSchema }),
  z.object({ kind: z.literal('adjust_fixed'), deltaMinor: z.number().int() }),
  z.object({ kind: z.literal('set_stock'), amount: z.number().int().min(0).max(1_000_000) }),
  z.object({ kind: z.literal('delete') }),
  z.object({ kind: z.literal('fill_en'), overwrite: z.boolean() }),
  z.object({ kind: z.literal('restore'), fromPlanId: z.string().max(100).nullable(), backupId: z.string().max(100).nullable() }),
  z.object({ kind: z.literal('import') }),
]);
export type BulkOperation = z.infer<typeof BulkOperationSchema>;
export type BulkOpKind = BulkOperation['kind'];

export const WarningCodeSchema = z.enum([
  'below_cost',
  'price_non_positive',
  'large_change',
  'unknown_currency',
  'mixed_currency',
  'auto_delivery_stock',
  'irreversible',
  'already_in_state',
  'stale_snapshot',
]);
export type WarningCode = z.infer<typeof WarningCodeSchema>;

export const SkipReasonSchema = z.enum(['no_change', 'invalid_price', 'no_price', 'nothing_to_fill', 'not_restorable', 'not_applied', 'unknown_listing']);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

const ValuesSchema = z.object({
  priceMinor: z.number().int().nullable().optional(),
  active: z.boolean().nullable().optional(),
  amount: z.number().int().nullable().optional(),
  summaryEn: z.string().max(20000).nullable().optional(),
  descEn: z.string().max(20000).nullable().optional(),
  deleted: z.boolean().optional(),
});
export type PlanValues = z.infer<typeof ValuesSchema>;

export const PlanItemSchema = z.object({
  listingId: z.string().regex(/^\d{1,12}$/),
  title: z.string().max(2000),
  categoryName: z.string().max(500),
  nodeId: z.string().max(32).nullable(),
  currency: CurrencySchema,
  costMinor: z.number().int().nullable(),
  before: ValuesSchema,
  after: ValuesSchema,
  changes: ChangesSchema,
  /** Optimistic-concurrency check: the live editor price must match this (± tolerance). */
  expectPriceMinor: z.number().int().nullable(),
  /** Fields written only when the live editor field is empty. */
  onlyIfEmpty: z.array(ChangeKeySchema),
  warnings: z.array(WarningCodeSchema),
  skip: SkipReasonSchema.nullable(),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const PlanStatusSchema = z.enum(['draft', 'queued', 'running', 'cancelling', 'cancelled', 'done', 'partial', 'failed']);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export const PlanSourceSchema = z.enum(['bulk', 'restore', 'import', 'translate', 'editor']);
export type PlanSource = z.infer<typeof PlanSourceSchema>;

export const PlanReportSchema = z.object({
  total: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  conflict: z.number().int(),
  cancelled: z.number().int(),
});
export type PlanReport = z.infer<typeof PlanReportSchema>;

export const BulkPlanSchema = z.object({
  id: z.string().regex(/^[\w-]{1,100}$/),
  createdAt: z.number(),
  label: z.string().max(300),
  source: PlanSourceSchema,
  op: BulkOperationSchema,
  items: z.array(PlanItemSchema).max(20_000),
  status: PlanStatusSchema,
  /** Typed confirmation phrase (required for delete plans). */
  confirmation: z.string().max(100).nullable(),
  backupId: z.string().max(100).nullable(),
  queuedAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  /** Final report, written when the plan finishes (tasks are pruned after a week). */
  report: PlanReportSchema.nullable(),
});
export type BulkPlan = z.infer<typeof BulkPlanSchema>;

export const ItemResultStatusSchema = z.enum(['done', 'failed', 'skipped', 'conflict', 'cancelled', 'blocked']);
export type ItemResultStatus = z.infer<typeof ItemResultStatusSchema>;

export const ItemResultSchema = z.object({
  planId: z.string(),
  listingId: z.string(),
  status: ItemResultStatusSchema,
  at: z.number(),
  message: z.string().max(2000),
  /** Values of the changed fields exactly as FunPay's editor showed them right before the change. */
  liveBefore: ChangesSchema.nullable(),
  /** Field values that were submitted. */
  applied: ChangesSchema.nullable(),
  /** The request may or may not have reached FunPay (worker/tab died mid-request). */
  uncertain: z.boolean(),
});
export type ItemResult = z.infer<typeof ItemResultSchema>;

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/**
 * Apply a percentage to a price (minor units) with the chosen rounding:
 *  - minor: nearest kopeck/cent (half up);
 *  - unit_nearest / unit_up / unit_down: whole currency units;
 *  - ten_nearest: nearest 10 currency units;
 *  - end_99: round up to a whole unit, then subtract one minor unit (x.99 price points).
 */
export function applyPct(beforeMinor: number, pct: number, mode: RoundingMode): number {
  const bp = Math.round(pct * 100);
  const num = beforeMinor * (10_000 + bp);
  const den = 10_000;
  switch (mode) {
    case 'minor':
      return divRound(num, den);
    case 'unit_nearest':
      return divRound(num, den * 100) * 100;
    case 'unit_up':
      return divCeil(num, den * 100) * 100;
    case 'unit_down':
      return divFloor(num, den * 100) * 100;
    case 'ten_nearest':
      return divRound(num, den * 1000) * 1000;
    case 'end_99':
      return divCeil(num, den * 100) * 100 - 1;
  }
}

export function isRelativePriceOp(op: BulkOperation): boolean {
  return op.kind === 'adjust_pct' || op.kind === 'adjust_fixed' || op.kind === 'import';
}

/** Typed confirmation required before deleting offers. Language-independent on purpose. */
export function deleteConfirmationPhrase(count: number): string {
  return `DELETE ${count}`;
}

/** Tolerance for comparing a planned price with the live editor price (rounding of unrounded `data-s`). */
export function priceMatches(liveMinor: number | null, expectedMinor: number): boolean {
  if (liveMinor === null) return false;
  return Math.abs(liveMinor - expectedMinor) <= Math.max(1, Math.round(expectedMinor * 0.001));
}

export interface PlanContext {
  fees: Settings['fees'];
  now: number;
  id?: string;
  label?: string;
  source?: PlanSource;
  /** For `fill_en`: English texts per listing plus the live EN values seen when they were prepared. */
  enTexts?: ReadonlyMap<string, EnText>;
}

export interface EnText {
  summaryEn?: string;
  descEn?: string;
  /** Live EN values at preparation time (null = unknown). */
  summaryEnBefore?: string | null;
  descEnBefore?: string | null;
}

export function baseItem(l: Listing): PlanItem {
  return {
    listingId: l.id,
    title: l.title,
    categoryName: l.categoryName,
    nodeId: l.nodeId,
    currency: l.price.currency,
    costMinor: l.costMinor,
    before: { priceMinor: l.price.amountMinor, active: l.active, amount: l.amount },
    after: {},
    changes: {},
    expectPriceMinor: null,
    onlyIfEmpty: [],
    warnings: [],
    skip: null,
  };
}

function warn(item: PlanItem, code: WarningCode): void {
  if (!item.warnings.includes(code)) item.warnings.push(code);
}

/**
 * Fill in a price change on `item` with validation and warnings. `relative` = the new price was
 * derived from the old one (adds the optimistic-concurrency expectation).
 */
export function setPriceChange(item: PlanItem, l: Pick<Listing, 'nodeId' | 'categoryName' | 'price' | 'costMinor'>, after: number, fees: Settings['fees'], relative: boolean): void {
  const before = l.price.amountMinor;
  item.after.priceMinor = after;
  if (l.price.currency === 'UNKNOWN') warn(item, 'unknown_currency');
  if (!Number.isSafeInteger(after) || after <= 0) {
    warn(item, 'price_non_positive');
    item.skip = 'invalid_price';
    return;
  }
  if (after > MAX_PRICE_MINOR) {
    item.skip = 'invalid_price';
    return;
  }
  if (relative && after === before) {
    item.skip = 'no_change';
    return;
  }
  if (!relative && after === before) warn(item, 'already_in_state');
  if (before > 0 && Math.abs(after - before) > before * LARGE_CHANGE_RATIO) warn(item, 'large_change');
  if (l.costMinor !== null) {
    // Conservative: when a commission is known compare the estimated net income, else the price itself.
    const c = resolveCommission(l, fees);
    const net = c ? netFromBuyerPrice(after, c.pct) : after;
    if (net < l.costMinor) warn(item, 'below_cost');
  }
  item.changes.price = formatPriceField(after);
  item.expectPriceMinor = relative ? before : null;
}

function planItem(l: Listing, op: BulkOperation, ctx: PlanContext, mixedCurrency: boolean): PlanItem {
  const item = baseItem(l);
  const before = l.price.amountMinor;
  switch (op.kind) {
    case 'enable':
    case 'disable': {
      const on = op.kind === 'enable';
      item.after.active = on;
      item.changes.active = on ? 'on' : '';
      if (l.active === on) warn(item, 'already_in_state');
      break;
    }
    case 'set_price':
      setPriceChange(item, l, op.priceMinor, ctx.fees, false);
      break;
    case 'adjust_pct':
    case 'adjust_fixed': {
      if (!(before > 0)) {
        item.skip = 'no_price';
        break;
      }
      const after = op.kind === 'adjust_pct' ? applyPct(before, op.pct, op.rounding) : before + op.deltaMinor;
      if (op.kind === 'adjust_fixed' && mixedCurrency) warn(item, 'mixed_currency');
      setPriceChange(item, l, after, ctx.fees, true);
      break;
    }
    case 'set_stock':
      item.after.amount = op.amount;
      item.changes.amount = String(op.amount);
      if (l.amount === op.amount) warn(item, 'already_in_state');
      if (l.autoDelivery) warn(item, 'auto_delivery_stock');
      break;
    case 'delete':
      item.after.deleted = true;
      item.changes.deleted = '1';
      warn(item, 'irreversible');
      break;
    case 'fill_en': {
      const t = ctx.enTexts?.get(l.id);
      item.before.summaryEn = t?.summaryEnBefore ?? null;
      item.before.descEn = t?.descEnBefore ?? null;
      const add = (key: typeof EN_SUMMARY | typeof EN_DESC, text: string | undefined, liveBefore: string | null | undefined) => {
        const v = text?.trim();
        if (!v) return;
        if (!op.overwrite && liveBefore) return; // already filled on FunPay
        if (op.overwrite && liveBefore === v) return;
        item.changes[key] = v;
        if (key === EN_SUMMARY) item.after.summaryEn = v;
        else item.after.descEn = v;
        if (!op.overwrite) item.onlyIfEmpty.push(key);
      };
      add(EN_SUMMARY, t?.summaryEn, t?.summaryEnBefore);
      add(EN_DESC, t?.descEn, t?.descEnBefore);
      if (Object.keys(item.changes).length === 0) item.skip = 'nothing_to_fill';
      break;
    }
    case 'restore':
    case 'import':
      // Built by buildRestorePlan / importToBulkPlan, which construct items explicitly.
      item.skip = 'no_change';
      break;
  }
  return item;
}

export function newPlanId(): string {
  return newId('plan');
}

export function emptyPlan(op: BulkOperation, ctx: Pick<PlanContext, 'now' | 'id' | 'label' | 'source'>, items: PlanItem[]): BulkPlan {
  return {
    id: ctx.id ?? newPlanId(),
    createdAt: ctx.now,
    label: ctx.label ?? op.kind,
    source: ctx.source ?? 'bulk',
    op,
    items,
    status: 'draft',
    confirmation: null,
    backupId: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    report: null,
  };
}

/** Build a dry-run plan. Pure: the same inputs always produce the same plan (except the random id). */
export function buildBulkPlan(listings: readonly Listing[], op: BulkOperation, ctx: PlanContext): BulkPlan {
  const currencies = new Set<string>();
  for (const l of listings) currencies.add(l.price.currency);
  const mixed = currencies.size > 1;
  const items = listings.map((l) => planItem(l, op, ctx, mixed));
  return emptyPlan(op, ctx, items);
}

export interface PlanSummary {
  total: number;
  actionable: number;
  skipped: number;
  skipReasons: Partial<Record<SkipReason, number>>;
  warnings: Partial<Record<WarningCode, number>>;
  tooLarge: boolean;
}

export function summarizePlan(plan: Pick<BulkPlan, 'items'>): PlanSummary {
  const s: PlanSummary = { total: plan.items.length, actionable: 0, skipped: 0, skipReasons: {}, warnings: {}, tooLarge: false };
  for (const it of plan.items) {
    if (it.skip) {
      s.skipped++;
      s.skipReasons[it.skip] = (s.skipReasons[it.skip] ?? 0) + 1;
      continue;
    }
    s.actionable++;
    for (const w of it.warnings) s.warnings[w] = (s.warnings[w] ?? 0) + 1;
  }
  s.tooLarge = s.actionable > MAX_EXECUTABLE_ITEMS;
  return s;
}

export function actionableItems(plan: Pick<BulkPlan, 'items'>): PlanItem[] {
  return plan.items.filter((i) => !i.skip);
}
