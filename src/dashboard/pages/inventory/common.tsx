/** Small helpers shared by the Inventory, Pricing and Rules pages. */
import type { AutomationFeature, FeatureStatus } from '@/core/automation/policy';
import { RpcError } from '@/core/messaging/client';
import { useDashboard } from '@/dashboard/context';
import { formatMoney, type Currency } from '@/shared/models/money';
import { StatusPill } from '@/ui/components';
import { useLang, type TFunction } from '@/ui/i18n';

export function useFeatureStatus(feature: AutomationFeature): FeatureStatus | null {
  const { status } = useDashboard();
  return status?.statuses.find((s) => s.feature === feature) ?? null;
}

export function FeatureStatusPill({ feature }: { feature: AutomationFeature }) {
  const s = useFeatureStatus(feature);
  return s ? <StatusPill status={s.status} reason={s.reason} /> : null;
}

const LOCALES = { en: 'en-US', ru: 'ru-RU', uk: 'uk-UA' } as const;

export function useLocaleTag(): string {
  return LOCALES[useLang()];
}

export function money(minor: number | null | undefined, currency: Currency, locale: string): string {
  if (minor === null || minor === undefined) return '—';
  return formatMoney({ amountMinor: minor, currency }, locale);
}

export function dateTime(v: number | string | null | undefined, locale: string): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

/** Error text for toasts; maps well-known RPC codes to translated hints. */
export function errorText(e: unknown, t: TFunction): string {
  if (e instanceof RpcError && e.code === 'no_tab') return t('ops.common.noTab');
  if (e instanceof RpcError && e.code === 'unavailable') return t('ops.common.backgroundUnavailable');
  if (e instanceof RpcError && e.code?.startsWith('manual:'))
    return t(`ops.inv.reason.${e.code.slice('manual:'.length)}`);
  return e instanceof Error ? e.message : String(e);
}

/** Parse a decimal amount typed by the seller into minor units (null when invalid). */
export function parseAmountInput(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const v = Math.round(Number.parseFloat(cleaned) * 100);
  return Number.isFinite(v) ? v : null;
}

export function minorToInput(minor: number | null | undefined): string {
  return minor === null || minor === undefined ? '' : (minor / 100).toFixed(2);
}
