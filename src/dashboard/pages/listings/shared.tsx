import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { RpcError } from '@/core/messaging/client';
import type { AutomationFeature, FeatureStatus } from '@/core/automation/policy';
import type { BulkOpKind, BulkPlan } from '@/features/listings/bulk-plan';
import { formatMoney, type Currency } from '@/shared/models/money';
import type { Listing } from '@/shared/models';
import { Button, Callout } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useLang, useT, type Lang, type TFunction } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { useDashboard } from '../../context';

export const LOCALES: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU', uk: 'uk-UA' };

export type ListingsTab = 'table' | 'history' | 'import' | 'templates' | 'order' | 'commission';
export const LISTINGS_TABS: ListingsTab[] = ['table', 'history', 'import', 'templates', 'order', 'commission'];

/** Page-level actions shared by the tabs and dialogs. */
export interface ListingsPageApi {
  openPreview: (plan: BulkPlan) => void;
  openBulk: (op: BulkOpKind, listings: Listing[]) => void;
  openClone: (listing: Listing) => void;
  openDetail: (listing: Listing) => void;
  openFillEnglish: (listings: Listing[]) => void;
  goTab: (tab: ListingsTab) => void;
}

export const ListingsPageContext = createContext<ListingsPageApi | null>(null);

export function usePageApi(): ListingsPageApi {
  const api = useContext(ListingsPageContext);
  if (!api) throw new Error('ListingsPageContext missing');
  return api;
}

export interface Formatters {
  locale: string;
  money: (minor: number | null | undefined, currency: Currency) => string;
  dateTime: (ms: number | string | null | undefined) => string;
  relative: (ms: number, now?: number) => string;
  pct: (n: number) => string;
  num: (n: number) => string;
}

export function useFormat(): Formatters {
  const lang = useLang();
  return useMemo(() => {
    const locale = LOCALES[lang];
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const dtf = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' });
    return {
      locale,
      money: (minor, currency) => (minor === null || minor === undefined ? '—' : formatMoney({ amountMinor: minor, currency }, locale)),
      dateTime: (ms) => {
        if (ms === null || ms === undefined || ms === '') return '—';
        const d = typeof ms === 'string' ? Date.parse(ms) : ms;
        return Number.isFinite(d) ? dtf.format(d) : '—';
      },
      relative: (ms, now = Date.now()) => {
        const diff = ms - now;
        const abs = Math.abs(diff);
        if (abs < 45_000) return rtf.format(Math.round(diff / 1000), 'second');
        if (abs < 45 * 60_000) return rtf.format(Math.round(diff / 60_000), 'minute');
        if (abs < 36 * 3600_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
        return rtf.format(Math.round(diff / 86_400_000), 'day');
      },
      pct: (n) => `${n.toLocaleString(locale, { maximumFractionDigits: 2 })} %`,
      num: (n) => n.toLocaleString(locale),
    };
  }, [lang]);
}

/** Re-render periodically so relative times stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Translated text for an RPC/feature error code, falling back to the message. */
export function errorText(t: TFunction, e: unknown): string {
  const code = e instanceof RpcError ? e.code : (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    const key = `listings.err.${code}`;
    const tr = t(key);
    if (tr !== key) return tr;
  }
  return e instanceof Error ? e.message : String(e);
}

export function useFeatureStatus(feature: AutomationFeature): FeatureStatus | null {
  const { status } = useDashboard();
  return status?.statuses.find((s) => s.feature === feature) ?? null;
}

export type LiveGateReason = 'emergency_stop' | 'awaiting_authorization' | null;

/** Changing offers on FunPay requires: no emergency stop, and the live-actions acknowledgement. */
export function useLiveGate(): { ok: boolean; reason: LiveGateReason } {
  const [settings] = useSettings();
  if (settings.automation.state === 'stopped') return { ok: false, reason: 'emergency_stop' };
  if (!settings.automation.liveActionsAcknowledged) return { ok: false, reason: 'awaiting_authorization' };
  return { ok: true, reason: null };
}

/** Clear call to action when live FunPay changes are not allowed right now. */
export function LiveGateNotice({ reason }: { reason: LiveGateReason }) {
  const t = useT();
  const { navigate } = useDashboard();
  if (!reason) return null;
  if (reason === 'emergency_stop') {
    return (
      <Callout tone="danger" title={t('listings.gate.stopped.title')}>
        {t('listings.gate.stopped.body')}
      </Callout>
    );
  }
  return (
    <Callout tone="info" title={t('listings.gate.ack.title')}>
      <p>{t('listings.gate.ack.body')}</p>
      <Button className="mt-2" size="sm" variant="primary" icon={<ShieldAlert size={14} aria-hidden />} onClick={() => navigate('automation')}>
        {t('listings.gate.ack.cta')}
      </Button>
    </Callout>
  );
}

/** Labelled native checkbox. */
export function CheckboxField({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 py-1">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={description ? `${id}-d` : undefined} />
      <div className="min-w-0">
        <label htmlFor={id} className={cn('text-sm text-fg', disabled && 'opacity-60')}>
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-xs text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** Small "≈ estimate" marker with an explanation tooltip. */
export function EstimateMark({ estimate }: { estimate: boolean }) {
  const t = useT();
  return estimate ? (
    <span className="ml-1 text-[10px] text-muted" title={t('listings.net.estimateHint')}>
      {t('common.estimate')}
    </span>
  ) : (
    <span className="ml-1 text-[10px] text-success" title={t('listings.net.calcHint')}>
      FunPay
    </span>
  );
}

export function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export const FUNPAY_ORIGIN = 'https://funpay.com';
export function offerUrl(id: string): string {
  return `${FUNPAY_ORIGIN}/lots/offer?id=${encodeURIComponent(id)}`;
}
export function offerEditUrl(id: string, nodeId: string | null): string {
  return `${FUNPAY_ORIGIN}/lots/offerEdit?${nodeId ? `node=${encodeURIComponent(nodeId)}&` : ''}offer=${encodeURIComponent(id)}`;
}
export function lotsTradeUrl(nodeId: string): string {
  return `${FUNPAY_ORIGIN}/lots/${encodeURIComponent(nodeId)}/trade`;
}
