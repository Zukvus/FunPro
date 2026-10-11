import { useState } from 'react';
import { PageHeader, Tabs } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { ActivityLog } from './logs/ActivityLog';
import { DiagnosticsCard } from './logs/DiagnosticsCard';
import { FlagsCard } from './logs/FlagsCard';
import { TaskQueue } from './logs/TaskQueue';

type Tab = 'activity' | 'tasks' | 'diagnostics' | 'flags';

export default function LogsPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('activity');
  return (
    <div>
      <PageHeader title={t('logs.page.title')} description={t('logs.page.description')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'activity', label: t('logs.tab.activity') },
          { value: 'tasks', label: t('logs.tab.tasks') },
          { value: 'diagnostics', label: t('logs.tab.diagnostics') },
          { value: 'flags', label: t('logs.tab.flags') },
        ]}
      />
      <div role="tabpanel" aria-label={t(`logs.tab.${tab}`)}>
        {tab === 'activity' && <ActivityLog />}
        {tab === 'tasks' && <TaskQueue />}
        {tab === 'diagnostics' && <DiagnosticsCard />}
        {tab === 'flags' && <FlagsCard />}
      </div>
    </div>
  );
}
