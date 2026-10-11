import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { AI_PROVIDERS, providerHost, providerPermissionOrigin } from '@/adapters/ai';
import { consentScopeFor, hasValidConsent } from '@/features/ai';
import { Badge, Button, Callout, Card, Modal, Switch, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { requestOrigin, revokeOrigin } from '../integrations/permissions';
import type { AiStatus } from './shared';

export function ConsentCard({ status, keySaved, onChanged }: { status: AiStatus; keySaved: boolean | null; onChanged: () => void }) {
  const t = useT();
  const [settings, update] = useSettings();
  const ai = settings.ai;
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const info = ai.provider === 'none' ? null : AI_PROVIDERS[ai.provider];
  const host = providerHost(ai);
  const origin = providerPermissionOrigin(ai);
  const consented = hasValidConsent(ai);
  const canEnable = !!info && !!host && !!origin && !settings.general.localOnly && (!info.keyRequired || keySaved === true);

  const enable = () => {
    if (!origin) return;
    // Ask for the host permission first, synchronously in the click (user gesture).
    const permission = requestOrigin(origin);
    setBusy(true);
    void (async () => {
      try {
        if (!(await permission)) {
          toast.error(t('aiPage.reason.no_permission'));
          return;
        }
        await update({ ai: { enabled: true, consentAt: Date.now(), consentScope: consentScopeFor(ai) } });
        toast.success(t('aiPage.consent.enabled', { provider: info?.label ?? '' }));
        setOpen(false);
        setAgree(false);
        onChanged();
      } finally {
        setBusy(false);
      }
    })();
  };

  const disable = async () => {
    await update({ ai: { enabled: false, consentAt: null, consentScope: '', autoDraftReviews: false } });
    if (origin) await revokeOrigin(origin);
    toast.info(t('aiPage.consent.withdrawn'));
    onChanged();
  };

  const badge =
    status?.ok === true ? (
      <Badge tone="success">{t('aiPage.status.ready')}</Badge>
    ) : status ? (
      <Badge tone={status.reason === 'local_only' || status.reason === 'flag_off' ? 'neutral' : 'warning'}>{t(`aiPage.reason.${status.reason}`)}</Badge>
    ) : null;

  return (
    <Card title={t('aiPage.consent.title')} description={t('aiPage.consent.description')} actions={badge}>
      <div className="space-y-3 text-sm">
        {info && host ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg">{t('aiPage.consent.disclosure', { provider: info.label, host })}</p>
        ) : (
          <p className="text-xs text-muted">{t('aiPage.consent.pickProvider')}</p>
        )}
        <div className="grid gap-2 text-xs text-muted sm:grid-cols-2">
          <div>
            <p className="mb-1 font-semibold text-fg">{t('aiPage.consent.sentTitle')}</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('aiPage.consent.sent1')}</li>
              <li>{t('aiPage.consent.sent2')}</li>
              <li>{t('aiPage.consent.sent3')}</li>
            </ul>
          </div>
          <div>
            <p className="mb-1 font-semibold text-fg">{t('aiPage.consent.neverTitle')}</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('aiPage.consent.never1')}</li>
              <li>{t('aiPage.consent.never2')}</li>
              <li>{t('aiPage.consent.never3')}</li>
            </ul>
          </div>
        </div>

        {ai.enabled && consented ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">
              <ShieldCheck size={12} aria-hidden /> {t('aiPage.consent.givenAt', { date: new Date(ai.consentAt!).toLocaleString() })}
            </Badge>
            <Button variant="outline" size="sm" onClick={() => void disable()}>
              {t('aiPage.consent.withdraw')}
            </Button>
          </div>
        ) : (
          <Button variant="primary" disabled={!canEnable} onClick={() => setOpen(true)}>
            {t('aiPage.consent.enable')}
          </Button>
        )}

        <div className="border-t border-border pt-2">
          <Switch
            checked={ai.redactPersonalData}
            onChange={(v) => void update({ ai: { redactPersonalData: v } })}
            label={t('aiPage.privacy.redactNames')}
            description={t('aiPage.privacy.redactNamesHelp')}
          />
          <Switch
            checked={ai.autoDraftReviews}
            disabled={!(ai.enabled && consented)}
            onChange={(v) => void update({ ai: { autoDraftReviews: v } })}
            label={t('aiPage.privacy.autoDraftReviews')}
            description={t('aiPage.privacy.autoDraftReviewsHelp', { host: host ?? '—' })}
          />
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('aiPage.consent.dialogTitle', { provider: info?.label ?? '' })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" disabled={!agree} loading={busy} onClick={enable}>
              {t('aiPage.consent.agreeButton')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="font-medium">{t('aiPage.consent.disclosure', { provider: info?.label ?? '', host: host ?? '' })}</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>{t('aiPage.consent.dialog1')}</li>
            <li>{t(ai.redactPersonalData ? 'aiPage.consent.dialog2names' : 'aiPage.consent.dialog2')}</li>
            <li>{t('aiPage.consent.dialog3', { provider: info?.label ?? '' })}</li>
            <li>{t('aiPage.consent.dialog4')}</li>
            <li>{t('aiPage.consent.dialog5')}</li>
          </ul>
          {info?.privacyUrl && (
            <p className="text-xs">
              <a className="text-accent underline" href={info.privacyUrl} target="_blank" rel="noreferrer noopener">
                {t('aiPage.consent.privacyPolicy', { provider: info.label })}
              </a>
            </p>
          )}
          <Callout tone="info">{t('aiPage.consent.permissionNote', { host: host ?? '' })}</Callout>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{t('aiPage.consent.checkbox', { provider: info?.label ?? '' })}</span>
          </label>
        </div>
      </Modal>
    </Card>
  );
}
