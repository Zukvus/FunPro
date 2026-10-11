import { isFlagEnabled } from '@/core/flags/flags';
import { Callout, PageHeader } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { OverviewCard } from './integrations/OverviewCard';
import { TelegramCard } from './integrations/TelegramCard';

export default function IntegrationsPage() {
  const t = useT();
  const [settings] = useSettings();
  return (
    <div className="space-y-5">
      <PageHeader title={t('integrations.title')} description={t('integrations.description')} />
      <OverviewCard />
      {isFlagEnabled('telegram', settings.flags) ? (
        <TelegramCard />
      ) : (
        <Callout tone="warning">{t('integrations.telegramFlagOff')}</Callout>
      )}
    </div>
  );
}
