import { EyeOff, HardDrive } from 'lucide-react';
import { Callout, Card, PageHeader, Switch } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { BackupCard } from './privacy/BackupCard';
import { DataInventoryCard } from './privacy/DataInventoryCard';
import { DeleteAllCard } from './privacy/DeleteAllCard';
import { PermissionsCard } from './privacy/PermissionsCard';
import { ThirdPartyCard } from './privacy/ThirdPartyCard';

export default function PrivacyPage() {
  const t = useT();
  const [settings, update] = useSettings();
  const p = settings.privacy;

  return (
    <div className="space-y-5">
      <PageHeader title={t('privacy.page.title')} description={t('privacy.page.description')} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <EyeOff size={15} aria-hidden /> {t('privacy.mode.title')}
            </span>
          }
          description={t('privacy.mode.description')}
        >
          <Switch
            checked={p.privacyMode}
            onChange={(v) => void update({ privacy: { privacyMode: v } })}
            label={t('privacy.mode.enable')}
            description={t('privacy.mode.help')}
          />
          <Switch
            checked={p.hideBalances || p.privacyMode}
            disabled={p.privacyMode}
            onChange={(v) => void update({ privacy: { hideBalances: v } })}
            label={t('privacy.balances.enable')}
            description={p.privacyMode ? t('privacy.balances.impliedByMode') : t('privacy.balances.help')}
          />
          <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            {t('privacy.mode.sample')} <span className="fp-sensitive font-medium text-fg">BuyerName</span> ·{' '}
            <span className="fp-sensitive font-medium text-fg">#A1B2C3D4</span> ·{' '}
            <span className="fp-balance font-medium text-fg">1 520,40 ₽</span>
          </p>
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <HardDrive size={15} aria-hidden /> {t('privacy.local.title')}
            </span>
          }
          description={t('privacy.local.description')}
        >
          <Switch
            checked={settings.general.localOnly}
            onChange={(v) => void update({ general: { localOnly: v } })}
            label={t('privacy.local.enable')}
            description={t('privacy.local.help')}
          />
          {!settings.general.localOnly && <Callout tone="info">{t('privacy.local.offNote')}</Callout>}
        </Card>
      </div>

      <ThirdPartyCard />
      <PermissionsCard />
      <DataInventoryCard />
      <BackupCard />
      <DeleteAllCard />
    </div>
  );
}
