import { ExternalLink, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { log } from '@/core/log/logger';
import { Badge, Button, Callout, Modal } from '@/ui/components';
import { Checkbox } from '@/ui/components/FormControls';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { FUNPAY_RULES_URL, unverifiedMutatingCapabilities } from './features';

const CHECKS = ['noApi', 'rules', 'browserOpen', 'stop'] as const;
type Check = (typeof CHECKS)[number];

/**
 * Explicit, informed consent for automations that perform live, unverified actions on FunPay.
 * Every statement must be ticked; the acknowledgement is stored in settings and can be revoked.
 */
export function LiveActionsDialog({ open, onClose, onConfirmed }: { open: boolean; onClose: () => void; onConfirmed?: () => void }) {
  const t = useT();
  const [, update] = useSettings();
  const [ticked, setTicked] = useState<Record<Check, boolean>>({ noApi: false, rules: false, browserOpen: false, stop: false });
  const [busy, setBusy] = useState(false);
  const caps = unverifiedMutatingCapabilities();
  const allTicked = CHECKS.every((c) => ticked[c]);

  useEffect(() => {
    if (open) setTicked({ noApi: false, rules: false, browserOpen: false, stop: false });
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    try {
      await update({ automation: { liveActionsAcknowledged: true } });
      await log.info({ source: 'automation', message: 'Live FunPay actions acknowledged by the user' });
      onConfirmed?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldAlert size={16} aria-hidden /> {t('live.title')}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!allTicked} loading={busy} onClick={() => void confirm()}>
            {t('live.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p>{t('live.intro')}</p>
        <section aria-labelledby="live-caps">
          <h3 id="live-caps" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {t('live.capabilities', { count: caps.length })}
          </h3>
          <ul className="space-y-1.5">
            {caps.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
                <Badge tone="warning">{t('live.status.evidenced')}</Badge>
                <span className="font-medium text-fg">{t(`capability.${c.id}`)}</span>
                <span className="text-muted">{c.description}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{t('live.evidencedExplained')}</p>
        </section>
        <Callout tone="warning" title={t('live.risks.title')}>
          <p>
            {t('live.risks.body')}{' '}
            <a href={FUNPAY_RULES_URL} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium underline">
              {t('live.rulesLink')} <ExternalLink size={11} aria-hidden />
            </a>
          </p>
        </Callout>
        <Callout tone="info" title={t('live.noCloud.title')}>
          {t('live.noCloud.body')}
        </Callout>
        <fieldset className="rounded-xl border border-border p-3">
          <legend className="px-1 text-xs font-semibold text-muted">{t('live.checks.legend')}</legend>
          {CHECKS.map((c) => (
            <Checkbox key={c} checked={ticked[c]} onChange={(v) => setTicked((s) => ({ ...s, [c]: v }))} label={t(`live.check.${c}`)} />
          ))}
        </fieldset>
        <p className="text-xs text-muted">{t('live.revocable')}</p>
      </div>
    </Modal>
  );
}
