import { isFlagEnabled } from '@/core/flags/flags';
import { Button, Callout, PageHeader } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../context';
import { ConsentCard } from './ai/ConsentCard';
import { ListingTools } from './ai/ListingTools';
import { Playground } from './ai/Playground';
import { ProviderCard } from './ai/ProviderCard';
import { useAiStatus } from './ai/shared';

export default function AiPage() {
  const t = useT();
  const [settings] = useSettings();
  const { navigate } = useDashboard();
  const { status, keySaved, refresh } = useAiStatus();

  return (
    <div className="space-y-5">
      <PageHeader title={t('aiPage.title')} description={t('aiPage.description')} />

      {!isFlagEnabled('aiCopilot', settings.flags) && <Callout tone="warning">{t('aiPage.flagOff')}</Callout>}
      {settings.general.localOnly && (
        <Callout tone="info" title={t('aiPage.localOnly.title')}>
          <p>{t('aiPage.localOnly.body')}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate('privacy')}>
            {t('aiPage.localOnly.open')}
          </Button>
        </Callout>
      )}
      <Callout tone="neutral">{t('aiPage.assistOnly')}</Callout>

      <div className="grid gap-5 lg:grid-cols-2">
        <ProviderCard keySaved={keySaved} onChanged={refresh} />
        <ConsentCard status={status} keySaved={keySaved} onChanged={refresh} />
      </div>
      <Playground status={status} />
      <ListingTools status={status} />
    </div>
  );
}
