import { AI_PROVIDERS, providerHost } from '@/adapters/ai';
import { Badge, Button, Card } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';
import { useAiStatus } from '../ai/shared';
import { TelegramStatePill, useTelegramStatus } from './TelegramCard';

/** Every external integration, what it sends, when — and that nothing is sent by default. */
export function OverviewCard() {
  const t = useT();
  const [settings] = useSettings();
  const { navigate } = useDashboard();
  const { status: aiStatus } = useAiStatus();
  const tgStatus = useTelegramStatus();
  const local = settings.general.localOnly;
  const aiHost = providerHost(settings.ai);
  const aiLabel = settings.ai.provider === 'none' ? t('integrations.ai.none') : AI_PROVIDERS[settings.ai.provider].label;

  return (
    <Card title={t('integrations.overview.title')} description={t('integrations.overview.description')}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={local ? 'success' : 'warning'}>{local ? t('integrations.localOnly.on') : t('integrations.localOnly.off')}</Badge>
        <span className="text-xs text-muted">{local ? t('integrations.localOnly.onHelp') : t('integrations.localOnly.offHelp')}</span>
        <Button size="sm" variant="ghost" onClick={() => navigate('privacy')}>
          {t('integrations.localOnly.manage')}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t('integrations.col.integration')}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t('integrations.col.status')}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t('integrations.col.destination')}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t('integrations.col.data')}
              </th>
              <th scope="col" className="py-2 font-semibold">
                {t('integrations.col.when')}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60 align-top">
              <th scope="row" className="py-2 pr-3 font-medium text-fg">
                {t('integrations.ai.name')}
                <div className="font-normal text-muted">{aiLabel}</div>
              </th>
              <td className="py-2 pr-3">
                {aiStatus?.ok ? <Badge tone="success">{t('aiPage.status.ready')}</Badge> : <Badge tone="neutral">{aiStatus ? t(`aiPage.reason.${aiStatus.reason}`) : '…'}</Badge>}
              </td>
              <td className="py-2 pr-3 text-muted">{aiHost ?? '—'}</td>
              <td className="py-2 pr-3 text-muted">
                {t('integrations.ai.data')}
                {settings.ai.autoDraftReviews && <div className="mt-1 text-warning">{t('integrations.ai.autoReviews')}</div>}
              </td>
              <td className="py-2 text-muted">{t('integrations.ai.when')}</td>
            </tr>
            <tr className="align-top">
              <th scope="row" className="py-2 pr-3 font-medium text-fg">
                {t('integrations.telegram.name')}
              </th>
              <td className="py-2 pr-3">
                <TelegramStatePill status={tgStatus} />
              </td>
              <td className="py-2 pr-3 text-muted">api.telegram.org</td>
              <td className="py-2 pr-3 text-muted">
                {t('integrations.telegram.data')}
                {settings.telegram.includePreviews && <div className="mt-1 text-warning">{t('integrations.telegram.previews')}</div>}
              </td>
              <td className="py-2 text-muted">
                {t('integrations.telegram.when')}
                {settings.telegram.remoteCommands && <div className="mt-1">{t('integrations.telegram.polling')}</div>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">{t('integrations.overview.never')}</p>
    </Card>
  );
}
