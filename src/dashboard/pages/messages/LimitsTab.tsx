import { useLiveQuery } from 'dexie-react-hooks';
import { Moon, RefreshCw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { getDb } from '@/core/db/db';
import { RpcError, rpc } from '@/core/messaging/client';
import { quietHoursState } from '@/features/messages/automation';
import { SYNC_STATUS_KEY, type ChatSyncStatus } from '@/features/messages/chatSync';
import { AUTO_SEND_LIMIT } from '@/features/messages/outbox';
import { Badge, Button, Card, Field, Input, Switch, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { fmtDateTime, useLocale } from './shared';

/** Number input that saves on blur / Enter, clamped to [min, max]. */
function NumberSetting({
  label,
  help,
  value,
  min,
  max,
  onSave,
}: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  onSave: (v: number) => Promise<unknown>;
}) {
  const id = useId();
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => {
    const n = Math.min(max, Math.max(min, Math.round(Number(local))));
    if (!Number.isFinite(n)) return setLocal(String(value));
    setLocal(String(n));
    if (n !== value) void onSave(n);
  };
  return (
    <Field label={label} htmlFor={id} help={help}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="w-32"
      />
    </Field>
  );
}

const STATE_TONE: Record<ChatSyncStatus['state'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  blocked: 'warning',
  error: 'danger',
  disabled: 'neutral',
};

export function LimitsTab() {
  const t = useT();
  const locale = useLocale();
  const [settings, update] = useSettings();
  const m = settings.messages;
  const q = m.quietHours;
  const sync = useLiveQuery(
    async () => (await getDb().kv.get(SYNC_STATUS_KEY))?.value as ChatSyncStatus | undefined,
    [],
  );
  const [syncing, setSyncing] = useState(false);
  const quietNow = quietHoursState(settings, new Date());
  const save = (patch: Parameters<typeof update>[0]) =>
    update(patch).then(
      () => toast.success(t('msg.limits.saved')),
      (e: Error) => toast.error(e.message),
    );

  const syncNow = async () => {
    setSyncing(true);
    try {
      await rpc('ui.messaging.syncChats', {});
    } catch (e) {
      toast.error(e instanceof RpcError ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={t('msg.quiet.title')} description={t('msg.quiet.description')}>
        <Switch
          checked={q.enabled}
          onChange={(v) => void save({ messages: { quietHours: { enabled: v } } })}
          label={t('msg.quiet.enabled')}
        />
        <div className="mt-2 flex flex-wrap gap-3">
          <Field label={t('msg.quiet.start')} htmlFor="quiet-start">
            <Input
              id="quiet-start"
              type="time"
              value={q.start}
              disabled={!q.enabled}
              onChange={(e) =>
                e.target.value && void save({ messages: { quietHours: { start: e.target.value } } })
              }
              className="w-32"
            />
          </Field>
          <Field label={t('msg.quiet.end')} htmlFor="quiet-end">
            <Input
              id="quiet-end"
              type="time"
              value={q.end}
              disabled={!q.enabled}
              onChange={(e) =>
                e.target.value && void save({ messages: { quietHours: { end: e.target.value } } })
              }
              className="w-32"
            />
          </Field>
        </div>
        <Switch
          checked={m.queueDuringQuietHours}
          disabled={!q.enabled}
          onChange={(v) => void save({ messages: { queueDuringQuietHours: v } })}
          label={t('msg.quiet.queue')}
          description={m.queueDuringQuietHours ? t('msg.quiet.queueOn') : t('msg.quiet.queueOff')}
        />
        {q.enabled && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted" role="status">
            <Moon size={13} aria-hidden />
            {quietNow.active
              ? t('msg.quiet.activeUntil', { time: fmtDateTime(quietNow.endsAt, locale) })
              : t('msg.quiet.inactive')}
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted">{t('msg.quiet.localTime')}</p>
      </Card>

      <Card title={t('msg.limits.title')} description={t('msg.limits.description')}>
        <div className="space-y-3">
          <NumberSetting
            label={t('msg.limits.perHour')}
            help={t('msg.limits.perHourHelp')}
            value={m.maxAutoRepliesPerChatPerHour}
            min={1}
            max={20}
            onSave={(v) => save({ messages: { maxAutoRepliesPerChatPerHour: v } })}
          />
          <NumberSetting
            label={t('msg.limits.customerCooldown')}
            help={t('msg.limits.customerCooldownHelp')}
            value={Math.round(m.perCustomerCooldownSec / 60)}
            min={0}
            max={1440}
            onSave={(v) => save({ messages: { perCustomerCooldownSec: v * 60 } })}
          />
          <NumberSetting
            label={t('msg.limits.manualPause')}
            help={t('msg.limits.manualPauseHelp')}
            value={m.pauseAfterManualReplyMin}
            min={0}
            max={1440}
            onSave={(v) => save({ messages: { pauseAfterManualReplyMin: v } })}
          />
        </div>
        <div className="mt-4 rounded-lg bg-surface-2 p-3 text-xs text-muted">
          <p className="mb-1 font-semibold text-fg">{t('msg.limits.fixedTitle')}</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              {t('msg.limits.fixed1', {
                max: AUTO_SEND_LIMIT.max,
                minutes: AUTO_SEND_LIMIT.windowMs / 60_000,
              })}
            </li>
            <li>{t('msg.limits.fixed2', { seconds: AUTO_SEND_LIMIT.gapMs / 1000 })}</li>
            <li>{t('msg.limits.fixed3')}</li>
            <li>{t('msg.limits.fixed4')}</li>
          </ul>
        </div>
      </Card>

      <Card
        className="lg:col-span-2"
        title={t('msg.sync.title')}
        description={t('msg.sync.description', { minutes: settings.sync.intervalMinutes })}
        actions={
          <Button
            size="sm"
            variant="outline"
            icon={<RefreshCw size={14} />}
            loading={syncing}
            onClick={() => void syncNow()}
          >
            {t('msg.sync.now')}
          </Button>
        }
      >
        <Switch
          checked={m.backgroundChatSync}
          onChange={(v) => void save({ messages: { backgroundChatSync: v } })}
          label={t('msg.sync.background')}
          description={t('msg.sync.backgroundHelp')}
        />
        <div
          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
          role="status"
          aria-live="polite"
        >
          {sync ? (
            <>
              <Badge tone={STATE_TONE[sync.state]}>{t(`msg.sync.state.${sync.state}`)}</Badge>
              {sync.state === 'error' && sync.message && <span className="text-danger">{sync.message}</span>}
              <span>{t('msg.sync.lastRun', { time: fmtDateTime(sync.at, locale) })}</span>
              <span>
                {t('msg.sync.lastOk', {
                  time: sync.lastOkAt ? fmtDateTime(sync.lastOkAt, locale) : t('common.never'),
                })}
              </span>
              <span>
                {t('msg.sync.counts', {
                  chats: sync.chats,
                  histories: sync.historiesFetched,
                  pending: sync.pending,
                })}
              </span>
            </>
          ) : (
            <span>{t('msg.sync.never')}</span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted">{t('msg.sync.readOnlyNote')}</p>
      </Card>
    </div>
  );
}
