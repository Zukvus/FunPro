import { useState } from 'react';
import { PageHeader, Tabs } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { Inbox } from './notifications/Inbox';
import { SettingsPanel } from './notifications/SettingsPanel';

export default function NotificationsPage() {
  const t = useT();
  const [tab, setTab] = useState<'inbox' | 'settings'>('inbox');
  return (
    <div className="space-y-5">
      <PageHeader title={t('notifPage.title')} description={t('notifPage.description')} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'inbox', label: t('notifPage.tab.inbox') },
          { value: 'settings', label: t('notifPage.tab.settings') },
        ]}
      />
      {tab === 'inbox' ? <Inbox /> : <SettingsPanel />}
    </div>
  );
}
