import { Copy, RotateCcw, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildSupportTicketDraft, type TicketLang } from '@/features/orders/ticket';
import type { Order } from '@/shared/models';
import { Button, Callout, Field, Input, Modal, Switch, Textarea } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useLang, useT } from '@/ui/i18n';
import { useCopy } from './shared';

/**
 * Support-ticket DRAFT assistant. Generates text only; FunPro never submits anything to FunPay.
 */
export function SupportTicketModal({ open, onClose, orders }: { open: boolean; onClose: () => void; orders: readonly Order[] }) {
  const t = useT();
  const uiLang = useLang();
  const copy = useCopy();
  const [settings, update] = useSettings();
  const minAgeHours = settings.analytics.supportTicketAfterHours;
  const [lang, setLang] = useState<TicketLang>(uiLang === 'en' ? 'en' : 'ru');
  const [includeBuyers, setIncludeBuyers] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const draft = useMemo(() => buildSupportTicketDraft({ orders, now, minAgeHours, lang, includeBuyerNames: includeBuyers }), [orders, now, minAgeHours, lang, includeBuyers]);
  const [text, setText] = useState(draft.body);
  const [subject, setSubject] = useState(draft.subject);

  useEffect(() => {
    setText(draft.body);
    setSubject(draft.subject);
  }, [draft]);
  useEffect(() => {
    if (open) setNow(Date.now());
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t('orders.ticket.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button icon={<Copy size={14} />} disabled={!subject} onClick={() => void copy(subject, t('orders.ticket.subjectCopied'))}>
            {t('orders.ticket.copySubject')}
          </Button>
          <Button variant="primary" icon={<Copy size={14} />} disabled={!text} onClick={() => void copy(text, t('orders.ticket.textCopied'))}>
            {t('orders.ticket.copyText')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Callout tone="warning" title={t('orders.ticket.manualTitle')}>
          <span className="inline-flex items-start gap-1.5">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            {t('orders.ticket.manualBody')}
          </span>
        </Callout>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('orders.ticket.language')} htmlFor="ticket-lang">
            <select id="ticket-lang" value={lang} onChange={(e) => setLang(e.target.value as TicketLang)} className="h-9 rounded-lg border border-border bg-surface px-3 text-sm text-fg">
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label={t('orders.ticket.threshold')} htmlFor="ticket-threshold" help={t('orders.ticket.thresholdHelp')}>
            <Input
              id="ticket-threshold"
              type="number"
              min={24}
              max={1440}
              value={minAgeHours}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (Number.isFinite(v) && v >= 24 && v <= 1440) void update({ analytics: { supportTicketAfterHours: v } });
              }}
            />
          </Field>
          <div className="self-end">
            <Switch checked={includeBuyers} onChange={setIncludeBuyers} label={t('orders.ticket.includeBuyers')} />
          </div>
        </div>

        {draft.orderIds.length === 0 ? (
          <Callout tone="info">{t('orders.ticket.noneEligible', { hours: minAgeHours })}</Callout>
        ) : (
          <>
            <Field label={t('orders.ticket.subject')} htmlFor="ticket-subject">
              <Input id="ticket-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label={t('orders.ticket.body', { count: draft.orderIds.length })} htmlFor="ticket-body" help={t('orders.ticket.bodyHelp')}>
              <Textarea id="ticket-body" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[260px] font-mono text-xs" />
            </Field>
            <div>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw size={12} />}
                onClick={() => {
                  setText(draft.body);
                  setSubject(draft.subject);
                }}
              >
                {t('orders.ticket.reset')}
              </Button>
            </div>
          </>
        )}

        {draft.excluded.length > 0 && (
          <details className="rounded-lg border border-border px-3 py-2 text-xs">
            <summary className="cursor-pointer text-muted">{t('orders.ticket.excluded', { count: draft.excluded.length })}</summary>
            <ul className="mt-2 space-y-0.5">
              {draft.excluded.map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span className="font-mono fp-sensitive">#{e.id}</span>
                  <span className="text-muted">{t(`orders.ticket.reason.${e.reason}`, { hours: minAgeHours })}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Modal>
  );
}
