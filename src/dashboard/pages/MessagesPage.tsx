import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/core/db/db';
import { isChatDraft } from '@/features/messages/drafts';
import { PageHeader, Tabs } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { AutoRepliesTab } from './messages/AutoRepliesTab';
import { DraftsTab } from './messages/DraftsTab';
import { InboxTab } from './messages/InboxTab';
import { LimitsTab } from './messages/LimitsTab';
import { TemplatesTab } from './messages/TemplatesTab';
import { WelcomeTab } from './messages/WelcomeTab';
import { useHashParams } from './messages/shared';

const TABS = ['inbox', 'templates', 'autoReplies', 'welcome', 'limits', 'drafts'] as const;
type TabId = (typeof TABS)[number];

/**
 * Messages: conversations stored locally, templates (slash commands on funpay.com), keyword
 * auto-replies, welcome / post-order messages, quiet hours & limits, drafts and scheduled messages.
 * Deep links: #/messages?tab=<id>&chat=<chatId>&q=<search>.
 */
export default function MessagesPage() {
  const t = useT();
  const [params, setParams] = useHashParams();
  const tab: TabId = (TABS as readonly string[]).includes(params['tab'] ?? '') ? (params['tab'] as TabId) : 'inbox';
  const pendingDrafts = useLiveQuery(
    () =>
      getDb()
        .drafts.where('status')
        .equals('pending')
        .filter((d) => isChatDraft(d) && d.source !== 'scheduled')
        .count(),
    [],
  );

  const label = (id: TabId) => (id === 'drafts' && pendingDrafts ? `${t('msg.tab.drafts')} (${pendingDrafts})` : t(`msg.tab.${id}`));

  return (
    <div>
      <PageHeader title={t('nav.messages')} description={t('msg.page.description')} />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v === 'inbox' ? null : v })} items={TABS.map((id) => ({ value: id, label: label(id) }))} />
      <div role="tabpanel" aria-label={t(`msg.tab.${tab}`)}>
        {tab === 'inbox' && <InboxTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'autoReplies' && <AutoRepliesTab />}
        {tab === 'welcome' && <WelcomeTab />}
        {tab === 'limits' && <LimitsTab />}
        {tab === 'drafts' && <DraftsTab />}
      </div>
    </div>
  );
}
