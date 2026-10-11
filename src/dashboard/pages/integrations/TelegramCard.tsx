import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart3, ExternalLink, Search, Send, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isValidBotToken, TELEGRAM_PERMISSION_ORIGIN } from '@/adapters/telegram/api';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { hasSecret } from '@/core/security/secrets';
import {
  confirmTelegramChat,
  disconnectTelegram,
  findStartChats,
  KV_LAST_ERROR,
  saveBotToken,
  telegramStatus,
  verifyBotToken,
  type ChatCandidate,
  type TelegramStatus,
} from '@/features/telegram';
import { Badge, Button, Callout, Card, ConfirmDialog, Field, Input, Switch, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { requestOrigin, revokeOrigin, useOriginPermission } from './permissions';

const STATE_TONE: Record<TelegramStatus['state'], 'neutral' | 'success' | 'info' | 'danger'> = {
  disabled: 'neutral',
  connected: 'success',
  awaiting_authorization: 'info',
  error: 'danger',
};

type ToggleKey =
  | 'notifyOrders'
  | 'notifyMessages'
  | 'includePreviews'
  | 'notifyReviews'
  | 'notifyInventory'
  | 'notifyFailures'
  | 'notifyBumps'
  | 'notifyPrices';

export function useTelegramStatus(): TelegramStatus | null {
  const [settings] = useSettings();
  const { granted } = useOriginPermission(TELEGRAM_PERMISSION_ORIGIN);
  const lastError = useLiveQuery(() => getDb().kv.get(KV_LAST_ERROR), []);
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [tokenVersion, setTokenVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void telegramStatus(settings, granted === true).then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [settings, granted, lastError, tokenVersion]);
  useEffect(() => {
    const id = setInterval(() => setTokenVersion((v) => v + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  return status;
}

export function TelegramStatePill({ status }: { status: TelegramStatus | null }) {
  const t = useT();
  if (!status) return null;
  return (
    <Badge tone={STATE_TONE[status.state]} title={t(`telegram.detail.${status.detail}`)}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {t(`telegram.state.${status.state}`)}
    </Badge>
  );
}

export function TelegramCard() {
  const t = useT();
  const [settings, update] = useSettings();
  const tg = settings.telegram;
  const status = useTelegramStatus();
  const [token, setToken] = useState('');
  const [consent, setConsent] = useState(tg.consentAt !== null);
  const [busy, setBusy] = useState<'verify' | 'find' | 'test' | 'summary' | null>(null);
  const [candidates, setCandidates] = useState<{ list: ChatCandidate[]; lastUpdateId: number | null } | null>(
    null,
  );
  const [tokenSaved, setTokenSaved] = useState<boolean | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const localOnly = settings.general.localOnly;

  useEffect(() => {
    void hasSecret('telegram.botToken').then(setTokenSaved);
  }, [status]);

  const verify = () => {
    // Permission prompt first, synchronously inside the click handler.
    const permission = requestOrigin(TELEGRAM_PERMISSION_ORIGIN);
    setBusy('verify');
    void (async () => {
      try {
        if (!(await permission)) {
          toast.error(t('telegram.permissionDenied'));
          return;
        }
        const bot = await verifyBotToken(token);
        await saveBotToken(token, bot);
        setToken('');
        setTokenSaved(true);
        setCandidates(null);
        toast.success(t('telegram.tokenOk', { bot: bot.username ? `@${bot.username}` : bot.first_name }));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(null);
      }
    })();
  };

  const find = () => {
    const permission = requestOrigin(TELEGRAM_PERMISSION_ORIGIN);
    setBusy('find');
    void (async () => {
      try {
        if (!(await permission)) {
          toast.error(t('telegram.permissionDenied'));
          return;
        }
        const res = await findStartChats();
        setCandidates({ list: res.candidates, lastUpdateId: res.lastUpdateId });
        if (res.candidates.length === 0) toast.info(t('telegram.noStart'));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(null);
      }
    })();
  };

  const confirmChat = async (c: ChatCandidate) => {
    await confirmTelegramChat(c, candidates?.lastUpdateId ?? null);
    setCandidates(null);
    toast.success(t('telegram.connected', { chat: c.label }));
  };

  const action = async (kind: 'test' | 'summary') => {
    setBusy(kind);
    try {
      await rpc(kind === 'test' ? 'ui.telegramTest' : 'ui.telegramSummaryNow', {});
      toast.success(t(kind === 'test' ? 'telegram.testSent' : 'telegram.summarySent'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    await disconnectTelegram();
    await revokeOrigin(TELEGRAM_PERMISSION_ORIGIN);
    setConfirmDisconnect(false);
    setTokenSaved(false);
    setConsent(false);
    toast.info(t('telegram.disconnected'));
  };

  const toggles: { key: ToggleKey; help?: string }[] = [
    { key: 'notifyOrders' },
    { key: 'notifyMessages' },
    { key: 'includePreviews', help: t('telegram.toggle.includePreviewsHelp') },
    { key: 'notifyReviews' },
    { key: 'notifyInventory' },
    { key: 'notifyFailures' },
    { key: 'notifyBumps' },
    { key: 'notifyPrices' },
  ];

  const connected = !!tg.chatId && tokenSaved === true;

  return (
    <Card
      title={t('telegram.title')}
      description={t('telegram.description')}
      actions={<TelegramStatePill status={status} />}
    >
      <div className="space-y-4">
        <Callout tone="warning" title={t('telegram.offPlatformTitle')}>
          {t('telegram.offPlatformBody')}
        </Callout>
        {localOnly && <Callout tone="info">{t('telegram.localOnly')}</Callout>}
        {status?.lastError && status.state === 'error' && (
          <Callout tone="danger">{t('telegram.lastError', { error: status.lastError.message })}</Callout>
        )}

        {!connected && (
          <ol className="space-y-4 text-sm">
            <li className="space-y-2">
              <p className="font-medium">1. {t('telegram.step1')}</p>
              <p className="text-xs text-muted">{t('telegram.step1Help')}</p>
              <Field
                label={t('telegram.token')}
                help={
                  tokenSaved
                    ? t('telegram.tokenSaved', { bot: tg.botUsername ? `@${tg.botUsername}` : '' })
                    : t('telegram.tokenHelp')
                }
              >
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="123456789:AA…"
                />
              </Field>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>{t('telegram.consent')}</span>
              </label>
              <p className="text-xs text-muted">{t('telegram.permissionNote')}</p>
              <Button
                variant="primary"
                onClick={verify}
                loading={busy === 'verify'}
                disabled={!consent || localOnly || !isValidBotToken(token)}
              >
                {t('telegram.verify')}
              </Button>
            </li>
            {tokenSaved && (
              <li className="space-y-2">
                <p className="font-medium">2. {t('telegram.step2')}</p>
                {tg.botUsername && (
                  <a
                    className="inline-flex items-center gap-1 text-xs text-accent underline"
                    href={`https://t.me/${encodeURIComponent(tg.botUsername)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t('telegram.openBot', { bot: `@${tg.botUsername}` })}{' '}
                    <ExternalLink size={12} aria-hidden />
                  </a>
                )}
                <div>
                  <Button
                    icon={<Search size={14} />}
                    onClick={find}
                    loading={busy === 'find'}
                    disabled={localOnly || !consent}
                  >
                    {t('telegram.find')}
                  </Button>
                </div>
                {candidates && candidates.list.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted">{t('telegram.confirmHelp')}</p>
                    {candidates.list.map((c) => (
                      <div
                        key={c.chatId}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                      >
                        <span className="font-medium">{c.label}</span>
                        <Button size="sm" variant="primary" onClick={() => void confirmChat(c)}>
                          {t('telegram.thisIsMe')}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            )}
          </ol>
        )}

        {connected && (
          <div className="space-y-3">
            <p className="text-sm">
              {t('telegram.connectedAs', {
                bot: tg.botUsername ? `@${tg.botUsername}` : '—',
                chat: tg.chatLabel || tg.chatId,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<Send size={14} />}
                onClick={() => void action('test')}
                loading={busy === 'test'}
                disabled={status?.state !== 'connected' && status?.state !== 'error'}
              >
                {t('telegram.test')}
              </Button>
              <Button
                icon={<BarChart3 size={14} />}
                onClick={() => void action('summary')}
                loading={busy === 'summary'}
                disabled={status?.state !== 'connected' && status?.state !== 'error'}
              >
                {t('telegram.summaryNow')}
              </Button>
              <Button variant="ghost" icon={<Unplug size={14} />} onClick={() => setConfirmDisconnect(true)}>
                {t('telegram.disconnect')}
              </Button>
            </div>
            <Switch
              checked={tg.enabled}
              onChange={(v) => void update({ telegram: { enabled: v } })}
              label={t('telegram.enabled')}
              description={t('telegram.enabledHelp')}
            />
            <div className="grid gap-x-6 sm:grid-cols-2">
              {toggles.map(({ key, help }) => (
                <Switch
                  key={key}
                  checked={tg[key]}
                  onChange={(v) => void update({ telegram: { [key]: v } })}
                  label={t(`telegram.toggle.${key}`)}
                  description={help}
                />
              ))}
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_140px]">
              <Switch
                checked={tg.dailySummary}
                onChange={(v) => void update({ telegram: { dailySummary: v } })}
                label={t('telegram.toggle.dailySummary')}
                description={t('telegram.toggle.dailySummaryHelp')}
              />
              <Field label={t('telegram.summaryTime')}>
                <Input
                  type="time"
                  value={tg.dailySummaryTime}
                  disabled={!tg.dailySummary}
                  onChange={(e) =>
                    /^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value) &&
                    void update({ telegram: { dailySummaryTime: e.target.value } })
                  }
                />
              </Field>
            </div>
            <div className="rounded-lg border border-border p-3">
              <Switch
                checked={tg.remoteCommands}
                onChange={(v) => void update({ telegram: { remoteCommands: v } })}
                label={t('telegram.toggle.remoteCommands')}
                description={t('telegram.toggle.remoteCommandsHelp')}
              />
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        danger
        title={t('telegram.disconnectTitle')}
        confirmLabel={t('telegram.disconnect')}
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => void disconnect()}
      >
        {t('telegram.disconnectBody')}
      </ConfirmDialog>
    </Card>
  );
}
