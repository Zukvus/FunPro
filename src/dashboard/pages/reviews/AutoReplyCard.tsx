import { useState } from 'react';
import { hasValidConsent } from '@/features/ai';
import { Callout, Card, ConfirmDialog, StatusPill, Switch } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';

export function AutoReplyCard({ enabledTemplates }: { enabledTemplates: number }) {
  const t = useT();
  const [settings, update] = useSettings();
  const { status, refreshStatus, navigate } = useDashboard();
  const [confirmPost, setConfirmPost] = useState(false);
  const feature = status?.statuses.find((s) => s.feature === 'autoReviewReply');
  const aiConsented = settings.ai.enabled && hasValidConsent(settings.ai) && !settings.general.localOnly;

  return (
    <Card
      title={t('reviews.auto.title')}
      description={t('reviews.auto.description')}
      actions={feature ? <StatusPill status={feature.status} reason={feature.reason} /> : null}
    >
      <Switch
        checked={settings.automation.autoReviewReply}
        onChange={(v) => void update({ automation: { autoReviewReply: v } }).then(refreshStatus)}
        label={t('reviews.auto.enable')}
        description={t('reviews.auto.enableHelp')}
      />
      <Switch
        checked={settings.ai.autoDraftReviews}
        disabled={!aiConsented}
        onChange={(v) => void update({ ai: { autoDraftReviews: v } })}
        label={t('reviews.auto.aiDrafts')}
        description={aiConsented ? t('reviews.auto.aiDraftsHelp') : t('reviews.auto.aiDraftsOff')}
      />
      <Switch
        checked={settings.ai.autoPostReviewReplies}
        onChange={(v) => (v ? setConfirmPost(true) : void update({ ai: { autoPostReviewReplies: false } }))}
        label={t('reviews.auto.post')}
        description={t('reviews.auto.postHelp')}
      />
      {settings.ai.autoPostReviewReplies && enabledTemplates === 0 && <Callout tone="warning">{t('reviews.auto.noTemplates')}</Callout>}
      {feature && feature.status !== 'running' && feature.status !== 'disabled' && (
        <p className="mt-2 text-xs text-muted">
          {feature.reason}.{' '}
          <button type="button" className="text-accent underline" onClick={() => navigate('automation')}>
            {t('reviews.auto.openAutomation')}
          </button>
        </p>
      )}
      <p className="mt-2 text-xs text-muted">{t('reviews.auto.policy')}</p>

      <ConfirmDialog
        open={confirmPost}
        title={t('reviews.auto.confirmTitle')}
        confirmLabel={t('reviews.auto.confirmButton')}
        onCancel={() => setConfirmPost(false)}
        onConfirm={() => {
          void update({ ai: { autoPostReviewReplies: true } });
          setConfirmPost(false);
        }}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{t('reviews.auto.confirm1')}</li>
          <li>{t('reviews.auto.confirm2')}</li>
          <li>{t('reviews.auto.confirm3')}</li>
        </ul>
      </ConfirmDialog>
    </Card>
  );
}
