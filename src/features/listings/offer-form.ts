/**
 * Helpers around FunPay's offer editor form (as serialised by the adapter's `parseOfferForm`).
 * Data arriving from the content script is validated here before the background trusts it.
 */
import { z } from 'zod';
import type { OfferForm } from '@/adapters/funpay/types';
import { parsePriceInput } from './commission';
import { EN_DESC, EN_SUMMARY, RU_DESC, RU_SUMMARY, type ChangeKey } from './bulk-plan';

export const OfferFormSchema = z.object({
  offerId: z.string().max(32),
  nodeId: z.string().max(32).nullable(),
  currencyText: z.string().max(50),
  fields: z.array(z.tuple([z.string().max(200), z.string().max(100_000)])).max(2000),
  buyerPrices: z.array(z.object({ method: z.string().max(200), priceText: z.string().max(100) })).max(100),
  secretsInfo: z
    .object({ count: z.number().int().min(0), chars: z.number().int().min(0) })
    .nullable()
    .optional(),
});

/** Fields never returned to extension pages or persisted: the CSRF token and auto-delivery goods. */
export const SENSITIVE_FORM_FIELDS = new Set(['csrf_token', 'secrets']);

export interface SanitizedOfferForm extends OfferForm {
  /** The offer has auto-delivery goods (their content is never exposed). */
  hasSecrets: boolean;
}

export function sanitizeOfferForm(form: OfferForm): SanitizedOfferForm {
  // Forms from the content script already carry only the size of the goods list (secretsInfo).
  let hasSecrets = (form.secretsInfo?.count ?? 0) > 0;
  const fields: [string, string][] = [];
  for (const [k, v] of form.fields) {
    if (k === 'secrets') {
      if (v.trim()) hasSecrets = true;
      continue;
    }
    if (SENSITIVE_FORM_FIELDS.has(k)) continue;
    fields.push([k, v]);
  }
  return { ...form, fields, hasSecrets };
}

export function fieldValue(fields: readonly (readonly [string, string])[], name: string): string | null {
  for (const [k, v] of fields) if (k === name) return v;
  return null;
}

export function fieldCount(fields: readonly (readonly [string, string])[], name: string): number {
  let n = 0;
  for (const [k] of fields) if (k === name) n++;
  return n;
}

export interface LiveOfferValues {
  priceMinor: number | null;
  active: boolean;
  amount: number | null;
  autoDelivery: boolean;
  summaryRu: string;
  summaryEn: string;
  descRu: string;
  descEn: string;
}

export function readLiveValues(fields: readonly (readonly [string, string])[]): LiveOfferValues {
  const amountText = fieldValue(fields, 'amount');
  const amount =
    amountText !== null && /^\s*\d+\s*$/.test(amountText) ? Number.parseInt(amountText, 10) : null;
  return {
    priceMinor: parsePriceInput(fieldValue(fields, 'price')),
    active: fieldValue(fields, 'active') !== null,
    amount,
    autoDelivery: fieldValue(fields, 'auto_delivery') !== null,
    summaryRu: fieldValue(fields, RU_SUMMARY) ?? '',
    summaryEn: fieldValue(fields, EN_SUMMARY) ?? '',
    descRu: fieldValue(fields, RU_DESC) ?? '',
    descEn: fieldValue(fields, EN_DESC) ?? '',
  };
}

/** The live value of a change key, in the same representation a plan uses for `changes`. */
export function liveChangeValue(fields: readonly (readonly [string, string])[], key: ChangeKey): string {
  if (key === 'active') return fieldValue(fields, 'active') !== null ? 'on' : '';
  if (key === 'deleted') return '';
  return fieldValue(fields, key) ?? '';
}

/** True when submitting `value` for `key` would not change anything on FunPay. */
export function isNoopChange(
  fields: readonly (readonly [string, string])[],
  key: ChangeKey,
  value: string,
): boolean {
  const live = liveChangeValue(fields, key);
  switch (key) {
    case 'price': {
      const a = parsePriceInput(live);
      const b = parsePriceInput(value);
      return a !== null && a === b;
    }
    case 'amount':
      return live.trim() === value.trim();
    case 'active':
      return (live === 'on') === (value !== '');
    case 'deleted':
      return false;
    default:
      return live.trim() === value.trim();
  }
}
