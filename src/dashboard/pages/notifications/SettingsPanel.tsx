import { useLiveQuery } from 'dexie-react-hooks';
import { BellRing, Play, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { rpc } from '@/core/messaging/client';
import type { Settings, SettingsPatch } from '@/core/settings/schema';
import {
  addCustomSound,
  BUILTIN_SOUNDS,
  CUSTOM_SOUND_PREFIX,
  deleteCustomSound,
  listCustomSounds,
  MAX_SOUND_BYTES,
  NOTIFICATION_KINDS,
  playInPage,
  resolveSoundRef,
  validateSoundFile,
  type NotificationKind,
  type PlayHandle,
} from '@/features/notifications';
import { Button, Callout, Card, Field, IconButton, Select, Switch, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';

type DesktopKey = 'onOrder' | 'onMessage' | 'onReview' | 'onFailure' | 'onInventory' | 'onPrice' | 'onBump';
const DESKTOP_KEY: Record<NotificationKind, DesktopKey | null> = {
  order: 'onOrder',
  message: 'onMessage',
  review: 'onReview',
  failure: 'onFailure',
  inventory: 'onInventory',
  price: 'onPrice',
  bump: 'onBump',
  system: null,
};

type SoundSettingKey = 'messageSound' | 'orderSound' | 'reviewSound' | 'alertSound';
const SOUND_SLOTS: SoundSettingKey[] = ['orderSound', 'messageSound', 'reviewSound', 'alertSound'];

/** Reset any sound setting that points at a deleted custom sound. */
function resetReferences(settings: Settings, soundId: string): SettingsPatch {
  const defaults: Record<SoundSettingKey, string> = {
    messageSound: 'chime',
    orderSound: 'register',
    reviewSound: 'bell',
    alertSound: 'alert',
  };
  const patch: Partial<Record<SoundSettingKey, string>> = {};
  for (const slot of SOUND_SLOTS) if (settings.notifications[slot] === soundId) patch[slot] = defaults[slot];
  return { notifications: patch };
}

export function SettingsPanel() {
  const t = useT();
  const [settings, update] = useSettings();
  const n = settings.notifications;
  const customSounds = useLiveQuery(() => listCustomSounds(), []) ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const playing = useRef<PlayHandle | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => () => playing.current?.stop(), []);

  const preview = async (soundId: string) => {
    const ref = resolveSoundRef(soundId);
    if (!ref) return;
    playing.current?.stop();
    try {
      playing.current = await playInPage(ref, n.volume);
    } catch (e) {
      toast.error(t('notifPage.sound.previewFailed', { error: (e as Error).message }));
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const check = validateSoundFile(file);
    if (!check.ok) {
      toast.error(t(`notifPage.sound.error.${check.error}`, { max: Math.round(MAX_SOUND_BYTES / 1024) }));
      return;
    }
    setUploading(true);
    try {
      const rec = await addCustomSound(file, file.name);
      toast.success(t('notifPage.sound.uploaded', { name: rec.name }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (assetId: string) => {
    const id = `${CUSTOM_SOUND_PREFIX}${assetId}`;
    await update(resetReferences(settings, id));
    await deleteCustomSound(assetId);
  };

  const test = async (kind: NotificationKind) => {
    try {
      const res = await rpc<{ desktop: boolean; sound: boolean }>('ui.testNotification', { kind });
      if (!res.desktop && !res.sound) toast.info(t('notifPage.test.allOff'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const soundOptions = (
    <>
      <optgroup label={t('notifPage.sound.builtin')}>
        {BUILTIN_SOUNDS.map((s) => (
          <option key={s.id} value={s.id}>
            {t(`notifPage.sound.name.${s.id}`)}
          </option>
        ))}
      </optgroup>
      {customSounds.length > 0 && (
        <optgroup label={t('notifPage.sound.custom')}>
          {customSounds.map((s) => (
            <option key={s.id} value={`${CUSTOM_SOUND_PREFIX}${s.id}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <Card title={t('notifPage.kinds.title')} description={t('notifPage.kinds.description')}>
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <Switch
            checked={n.desktop}
            onChange={(v) => void update({ notifications: { desktop: v } })}
            label={t('notifPage.desktop.master')}
            description={t('notifPage.desktop.help')}
          />
          <Switch
            checked={n.sound}
            onChange={(v) => void update({ notifications: { sound: v } })}
            label={t('notifPage.sound.master')}
            description={t('notifPage.sound.help')}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t('notifPage.kinds.kind')}
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t('notifPage.kinds.desktop')}
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  {t('notifPage.kinds.sound')}
                </th>
                <th scope="col" className="py-2 font-semibold">
                  <span className="sr-only">{t('notifPage.test.button')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_KINDS.map((kind) => {
                const key = DESKTOP_KEY[kind];
                return (
                  <tr key={kind} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="py-1.5 pr-3 font-medium">
                      {t(`notifPage.kind.${kind}`)}
                    </th>
                    <td className="py-1.5 pr-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label={`${t(`notifPage.kind.${kind}`)} — ${t('notifPage.kinds.desktop')}`}
                        checked={key ? n[key] : true}
                        disabled={!key || !n.desktop}
                        onChange={(e) => key && void update({ notifications: { [key]: e.target.checked } })}
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label={`${t(`notifPage.kind.${kind}`)} — ${t('notifPage.kinds.sound')}`}
                        checked={n.soundKinds[kind]}
                        disabled={!n.sound}
                        onChange={(e) =>
                          void update({ notifications: { soundKinds: { [kind]: e.target.checked } } })
                        }
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<BellRing size={14} />}
                        onClick={() => void test(kind)}
                      >
                        {t('notifPage.test.button')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">{t('notifPage.kinds.privacyNote')}</p>
      </Card>

      <Card title={t('notifPage.sound.title')} description={t('notifPage.sound.description')}>
        <div className="grid gap-4 md:grid-cols-2">
          {SOUND_SLOTS.map((slot) => (
            <Field key={slot} label={t(`notifPage.sound.slot.${slot}`)}>
              <div className="flex gap-2">
                <Select
                  value={n[slot]}
                  onChange={(e) => void update({ notifications: { [slot]: e.target.value } })}
                >
                  {soundOptions}
                </Select>
                <IconButton label={t('notifPage.sound.preview')} onClick={() => void preview(n[slot])}>
                  <Play size={14} />
                </IconButton>
              </div>
            </Field>
          ))}
          <Field label={t('notifPage.sound.volume', { pct: Math.round(n.volume * 100) })}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={n.volume}
              aria-valuetext={`${Math.round(n.volume * 100)}%`}
              onChange={(e) => void update({ notifications: { volume: Number(e.target.value) } })}
              className="w-full accent-[var(--fp-accent)]"
            />
          </Field>
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-sm font-medium">{t('notifPage.sound.custom')}</p>
          <p className="text-xs text-muted">
            {t('notifPage.sound.uploadHelp', { max: Math.round(MAX_SOUND_BYTES / 1024) })}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <Button
            size="sm"
            icon={<Upload size={14} />}
            loading={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {t('notifPage.sound.upload')}
          </Button>
          {customSounds.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border" role="list">
              {customSounds.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="truncate">
                    {s.name} <span className="text-xs text-muted">({Math.round(s.blob.size / 1024)} KB)</span>
                  </span>
                  <span className="flex gap-1">
                    <IconButton
                      label={t('notifPage.sound.preview')}
                      onClick={() => void preview(`${CUSTOM_SOUND_PREFIX}${s.id}`)}
                    >
                      <Play size={14} />
                    </IconButton>
                    <IconButton label={t('common.delete')} onClick={() => void remove(s.id)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Callout tone="neutral">{t('notifPage.sound.contentNote')}</Callout>
      </Card>
    </div>
  );
}
