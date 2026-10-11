import { Lock } from 'lucide-react';
import { useCallback, useId, type CSSProperties } from 'react';
import type { Settings } from '@/core/settings/schema';
import { Badge, Callout, Card, Field, Input, Select, Switch } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';
import { useLocalValue } from './useLocalValue';

type Nick = Settings['appearance']['nickname'];

const FONT_PREVIEW: Record<Nick['font'], string | undefined> = {
  inherit: undefined,
  serif: "Georgia, 'Times New Roman', serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  rounded: "'Nunito', 'Varela Round', ui-rounded, 'Segoe UI', system-ui, sans-serif",
};

function nicknamePreviewStyle(n: Nick): CSSProperties {
  const base: CSSProperties = { fontWeight: n.bold ? 700 : 400, fontFamily: FONT_PREVIEW[n.font] };
  if (n.gradientTo) {
    return { ...base, backgroundImage: `linear-gradient(90deg, ${n.color}, ${n.gradientTo})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' };
  }
  return { ...base, color: n.color };
}

/** Own nickname style + profile badge on funpay.com (items 51, 53), and the blocked/limited items 52 and 54. */
export function NicknameCard() {
  const t = useT();
  const [settings, update] = useSettings();
  const { status } = useDashboard();
  const stored = settings.appearance.nickname;
  const colorId = useId();
  const gradientId = useId();
  const fontId = useId();
  const badgeId = useId();
  const setNick = useCallback((patch: Partial<Nick>) => update({ appearance: { nickname: patch } }), [update]);
  const [color, setColor] = useLocalValue(stored.color, (v: string) => setNick({ color: v }), 150);
  const [gradientTo, setGradientTo] = useLocalValue(stored.gradientTo, (v: string | null) => setNick({ gradientTo: v }), 150);
  const [badge, setBadge] = useLocalValue(settings.appearance.profileBadge, (v: string) => update({ appearance: { profileBadge: v } }), 400);
  const n: Nick = { ...stored, color, gradientTo };
  const name = status?.session?.username ?? t('appearance.nick.sampleName');

  return (
    <Card title={t('appearance.nick.title')} description={t('appearance.nick.description')}>
      <Switch checked={n.enabled} onChange={(v) => void setNick({ enabled: v })} label={t('appearance.nick.enable')} description={t('appearance.nick.enableHelp')} />
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <Field label={t('appearance.nick.color')} htmlFor={colorId}>
          <input
            id={colorId}
            type="color"
            value={n.color}
            disabled={!n.enabled}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-lg border border-border bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </Field>
        <Field label={t('appearance.nick.gradient')} htmlFor={gradientId} help={t('appearance.nick.gradientHelp')}>
          <div className="flex items-center gap-2">
            <input
              id={gradientId}
              type="color"
              value={n.gradientTo ?? n.color}
              disabled={!n.enabled || !n.gradientTo}
              onChange={(e) => setGradientTo(e.target.value)}
              className="h-9 min-w-0 flex-1 cursor-pointer rounded-lg border border-border bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-fg">
              <input type="checkbox" checked={!!n.gradientTo} disabled={!n.enabled} onChange={(e) => setGradientTo(e.target.checked ? '#2cc8b5' : null)} />
              {t('appearance.nick.useGradient')}
            </label>
          </div>
        </Field>
        <Field label={t('appearance.nick.font')} htmlFor={fontId}>
          <Select id={fontId} value={n.font} disabled={!n.enabled} onChange={(e) => void setNick({ font: e.target.value as Nick['font'] })}>
            {(['inherit', 'serif', 'mono', 'rounded'] as const).map((f) => (
              <option key={f} value={f}>
                {t(`appearance.nick.font.${f}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Switch checked={n.bold} disabled={!n.enabled} onChange={(v) => void setNick({ bold: v })} label={t('appearance.nick.bold')} />
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-border bg-surface-2 px-4 py-3" aria-live="polite">
        <p className="text-[11px] uppercase tracking-wide text-muted">{t('appearance.nick.preview')}</p>
        <p className="mt-1 text-lg">
          <span className="fp-sensitive" style={n.enabled ? nicknamePreviewStyle(n) : undefined}>
            {name}
          </span>
          {badge && <span className="ml-2 inline-block rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 align-middle text-xs font-semibold text-accent">{badge}</span>}
        </p>
      </div>

      <div className="mt-4">
        <Field label={t('appearance.badge.label')} htmlFor={badgeId} help={t('appearance.badge.help', { count: 40 - badge.length })}>
          <Input id={badgeId} maxLength={40} value={badge} placeholder={t('appearance.badge.placeholder')} onChange={(e) => setBadge(e.target.value.slice(0, 40))} />
        </Field>
      </div>

      <div className="mt-4 space-y-3 border-t border-border pt-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {t('appearance.nick.shareTitle')} <Badge tone="danger">{t('status.blocked')}</Badge>
            </p>
            <p className="mt-0.5 text-xs text-muted">{t('appearance.nick.shareBlocked')}</p>
          </div>
          <Lock size={16} className="mt-1 shrink-0 text-muted" aria-hidden />
        </div>
        <Switch
          checked={settings.appearance.hideOthersNicknameStyles}
          onChange={(v) => void update({ appearance: { hideOthersNicknameStyles: v } })}
          label={t('appearance.nick.hideOthers')}
          description={t('appearance.nick.hideOthersHelp')}
        />
        <Callout tone="info">{t('appearance.nick.onlyYou')}</Callout>
      </div>
    </Card>
  );
}
