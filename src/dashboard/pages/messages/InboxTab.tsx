import { useLiveQuery } from 'dexie-react-hooks';
import { Inbox, Pin, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { RpcError, rpc } from '@/core/messaging/client';
import {
  filterChats,
  searchConversations,
  snippet,
  sortChats,
  type InboxFilter,
  type SearchHit,
} from '@/features/messages/inbox';
import type { ChatSummary } from '@/shared/models';
import { Badge, Button, Card, EmptyState, Input, Select, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { ConversationView } from './ConversationView';
import { fmtTime, useHashParams, useLocale } from './shared';

interface Row {
  chat: ChatSummary;
  hit?: SearchHit;
}

export function InboxTab() {
  const t = useT();
  const locale = useLocale();
  const [settings] = useSettings();
  const [params, setParams] = useHashParams();
  const chatId = params['chat'] ?? null;
  const [query, setQuery] = useState(params['q'] ?? '');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const chats = useLiveQuery(() => getDb().chats.toArray(), []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchConversations(q).then((res) => {
        if (!cancelled) {
          setHits(res);
          setSearching(false);
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const all = chats ?? [];
    if (hits) {
      const byId = new Map(all.map((c) => [c.id, c]));
      return hits.map((hit) => ({
        hit,
        chat: byId.get(hit.chatId) ?? {
          id: hit.chatId,
          partnerName: hit.chatId,
          partnerId: null,
          lastMessageText: '',
          lastMessageAt: null,
          unread: false,
          pinned: false,
          updatedAt: '',
        },
      }));
    }
    return filterChats(sortChats(all), filter).map((chat) => ({ chat }));
  }, [chats, hits, filter]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const s = await rpc<{ state: string } | null>('ui.messaging.syncChats', {});
      if (s?.state === 'blocked') toast.info(t('msg.sync.blocked'));
      else if (s?.state === 'error') toast.error(t('msg.sync.error'));
      else toast.success(t('msg.sync.done'));
    } catch (e) {
      toast.error(e instanceof RpcError ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const select = (id: string) => setParams({ chat: id });

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="flex min-h-0 flex-col">
        <div className="space-y-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('msg.inbox.searchPlaceholder')}
              aria-label={t('msg.inbox.searchPlaceholder')}
              className="pl-8"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value as InboxFilter)}
              aria-label={t('msg.inbox.filter')}
              disabled={!!hits}
              className="flex-1"
            >
              <option value="all">{t('msg.inbox.filter.all')}</option>
              <option value="unread">{t('msg.inbox.filter.unread')}</option>
              <option value="pinned">{t('msg.inbox.filter.pinned')}</option>
            </Select>
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshCw size={14} />}
              loading={syncing}
              onClick={() => void syncNow()}
              title={t('msg.sync.now')}
            >
              {t('msg.sync.short')}
            </Button>
          </div>
          {hits && (
            <p className="text-[11px] text-muted" role="status">
              {searching ? t('common.loading') : t('msg.inbox.searchResults', { count: hits.length })}
            </p>
          )}
        </div>
        <div className="-mx-2 mt-3 max-h-[640px] min-h-[200px] flex-1 overflow-y-auto">
          {chats === undefined ? (
            <p className="px-2 text-xs text-muted">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            <div className="px-2">
              <EmptyState
                icon={<Inbox size={22} />}
                title={hits ? t('msg.inbox.noResults') : t('msg.inbox.emptyTitle')}
              >
                {hits
                  ? t('msg.inbox.noResultsHelp')
                  : t('msg.inbox.emptyHelp', { minutes: settings.sync.intervalMinutes })}
              </EmptyState>
            </div>
          ) : (
            <ul aria-label={t('msg.inbox.listLabel')} className="space-y-0.5">
              {rows.map(({ chat, hit }) => {
                const active = chat.id === chatId;
                return (
                  <li key={chat.id}>
                    <button
                      type="button"
                      onClick={() => select(chat.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'w-full rounded-lg px-2 py-2 text-left',
                        active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {chat.unread && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-accent"
                            aria-label={t('msg.inbox.unread')}
                          />
                        )}
                        <span
                          className={cn(
                            'fp-sensitive min-w-0 flex-1 truncate text-sm',
                            chat.unread ? 'font-semibold text-fg' : 'text-fg',
                          )}
                        >
                          {chat.partnerName || chat.id}
                        </span>
                        {chat.pinned && (
                          <Pin
                            size={12}
                            className="shrink-0 text-accent"
                            aria-label={t('msg.inbox.pinned')}
                          />
                        )}
                        <span className="shrink-0 text-[11px] text-muted">
                          {fmtTime(hit?.message?.at ?? chat.lastMessageAt, locale)}
                        </span>
                      </div>
                      <p className="fp-sensitive mt-0.5 truncate text-xs text-muted">
                        {hit?.message ? snippet(hit.message.text, query) : chat.lastMessageText || '—'}
                      </p>
                      {hit && hit.count > 1 && (
                        <Badge tone="neutral" className="mt-1">
                          {t('msg.inbox.matches', { count: hit.count })}
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted">
          {t('msg.inbox.localNote', { days: settings.privacy.messageRetentionDays })}
        </p>
      </Card>
      <div className="min-w-0">
        {chatId ? (
          <ConversationView key={chatId} chatId={chatId} />
        ) : (
          <EmptyState icon={<Inbox size={22} />} title={t('msg.inbox.selectTitle')}>
            {t('msg.inbox.selectHelp')}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
