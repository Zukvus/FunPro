import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AutomationFeature, FeatureStatus } from '@/core/automation/policy';
import { renderTemplate, sampleVariables, TEMPLATE_VARIABLES } from '@/features/messages/engine';
import { lintText, type LintIssue } from '@/features/messages/lint';
import { MAX_MESSAGE_LENGTH } from '@/features/messages/outbox';
import { Button, Callout, ConfirmDialog, Field, StatusPill, Switch, Textarea, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useLang, useT, type TFunction } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { useDashboard } from '../../context';

// ---------------------------------------------------------------------------------------------
// Hash parameters: #/messages?tab=drafts&chat=users-1-2&q=text
// ---------------------------------------------------------------------------------------------

function readHashParams(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(window.location.hash.split('?')[1] ?? ''));
}

export function useHashParams(): [Record<string, string>, (patch: Record<string, string | null>) => void] {
  const [params, setParams] = useState(readHashParams);
  useEffect(() => {
    const onHash = () => setParams(readHashParams());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const update = useCallback((patch: Record<string, string | null>) => {
    const [path = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
    const next = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    window.location.hash = `/${path}${qs ? `?${qs}` : ''}`;
  }, []);
  return [params, update];
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

export function useLocale(): string {
  const lang = useLang();
  return lang === 'ru' ? 'ru-RU' : lang === 'uk' ? 'uk-UA' : 'en-GB';
}

export function fmtDateTime(value: string | number | null | undefined, locale: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

export function fmtTime(value: string | number | null | undefined, locale: string): string {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function funpayChatUrl(chatId: string): string {
  return `https://funpay.com/chat/?node=${encodeURIComponent(chatId)}`;
}

// ---------------------------------------------------------------------------------------------
// Automation status
// ---------------------------------------------------------------------------------------------

const REASON_KEYS: Record<string, string> = {
  'Turned off in settings': 'msg.reason.off',
  'Emergency stop is active': 'msg.reason.stopped',
  'Automation is paused': 'msg.reason.paused',
  'Not supported by the FunPay integration': 'msg.reason.unsupported',
  'Confirm live FunPay actions in Settings → Automation': 'msg.reason.ack',
  'Open funpay.com in a browser tab': 'msg.reason.noTab',
  'Log in to FunPay': 'msg.reason.login',
  Active: 'msg.reason.active',
};

export function reasonText(t: TFunction, st: FeatureStatus | undefined): string {
  if (!st) return t('msg.reason.unknown');
  const key = REASON_KEYS[st.reason];
  return key ? t(key) : st.reason;
}

export function useFeatureStatus(feature: AutomationFeature): FeatureStatus | undefined {
  const { status } = useDashboard();
  return status?.statuses.find((s) => s.feature === feature);
}

/**
 * Status pill + enable switch for a messaging automation. Turning it on requires the global
 * "live FunPay actions" acknowledgement (made on the Automation page) and an explicit confirmation
 * that summarises what will be sent.
 */
export function FeatureToggle({
  feature,
  title,
  description,
  confirmTitle,
  confirmBody,
}: {
  feature: Extract<AutomationFeature, 'autoReply' | 'welcomeMessage' | 'postOrderMessage'>;
  title: string;
  description: string;
  confirmTitle: string;
  confirmBody: ReactNode;
}) {
  const t = useT();
  const [settings, update] = useSettings();
  const { refreshStatus, navigate } = useDashboard();
  const st = useFeatureStatus(feature);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const acknowledged = settings.automation.liveActionsAcknowledged;
  const enabled = settings.automation[feature];

  const apply = async (on: boolean) => {
    setBusy(true);
    try {
      await update({ automation: { [feature]: on } });
      refreshStatus();
      toast.success(on ? t('msg.feature.enabled') : t('msg.feature.disabled'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div className="space-y-3">
      <Switch checked={enabled} disabled={busy || (!acknowledged && !enabled)} onChange={(on) => (on ? setConfirm(true) : void apply(false))} label={title} description={description} />
      {st && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted" role="status">
          <span>{t('msg.feature.status')}</span>
          <StatusPill status={st.status} reason={reasonText(t, st)} />
          <span className={enabled && st.status !== 'running' ? 'text-warning' : undefined}>{reasonText(t, st)}</span>
        </p>
      )}
      {!acknowledged && (
        <Callout tone="info" title={t('msg.feature.ackTitle')}>
          <p>{t('msg.feature.ackBody')}</p>
          <Button className="mt-2" size="sm" variant="outline" icon={<ArrowRight size={14} />} onClick={() => navigate('automation')}>
            {t('msg.feature.ackCta')}
          </Button>
        </Callout>
      )}
      <ConfirmDialog open={confirm} title={confirmTitle} confirmLabel={t('msg.feature.confirmEnable')} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void apply(true)}>
        {confirmBody}
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Template editing helpers
// ---------------------------------------------------------------------------------------------

export function LintList({ issues, className }: { issues: readonly LintIssue[]; className?: string }) {
  const t = useT();
  if (issues.length === 0) return null;
  return (
    <ul className={cn('space-y-1', className)} aria-label={t('msg.lint.title')}>
      {issues.map((i) => (
        <li key={i.id} className={cn('flex items-start gap-1.5 text-xs', i.severity === 'error' ? 'text-danger' : 'text-warning')}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>{t(`msg.lint.${i.id}`, { detail: i.detail ?? '' })}</span>
        </li>
      ))}
    </ul>
  );
}

export function TemplatePreview({ body }: { body: string }) {
  const t = useT();
  const { status } = useDashboard();
  const text = useMemo(() => renderTemplate(body, sampleVariables(new Date(), status?.session?.username)).text, [body, status?.session?.username]);
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/50 p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('msg.preview.title')}</p>
      <p className="whitespace-pre-wrap break-words text-sm text-fg">{text}</p>
      <p className="mt-1 text-[11px] text-muted">{t('msg.preview.note')}</p>
    </div>
  );
}

/** Textarea with variable buttons, live lint warnings and a sample-value preview. */
export function TemplateField({
  label,
  value,
  onChange,
  help,
  rows = 4,
  placeholder,
  showPreview = true,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode;
  rows?: number;
  placeholder?: string;
  showPreview?: boolean;
}) {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const issues = useMemo(() => (value.trim() ? lintText(value) : []), [value]);
  const insert = (token: string) => {
    const ta = ref.current;
    const s = ta?.selectionStart ?? value.length;
    const e = ta?.selectionEnd ?? s;
    onChange(value.slice(0, s) + token + value.slice(e));
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(s + token.length, s + token.length);
    });
  };
  return (
    <div className="space-y-2">
      <Field label={label} htmlFor={id} help={help}>
        <Textarea id={id} ref={ref} value={value} rows={rows} placeholder={placeholder} maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-muted">{t('msg.vars.insert')}</span>
        {TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => insert(`{${v}}`)}
            title={t(`msg.var.${v}`)}
            className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-fg"
          >
            {`{${v}}`}
          </button>
        ))}
        <span className={cn('ml-auto text-[11px] tabular-nums', value.length > MAX_MESSAGE_LENGTH * 0.9 ? 'text-warning' : 'text-muted')}>
          {value.length}/{MAX_MESSAGE_LENGTH}
        </span>
      </div>
      <LintList issues={issues} />
      {showPreview && value.trim() && <TemplatePreview body={value} />}
    </div>
  );
}
