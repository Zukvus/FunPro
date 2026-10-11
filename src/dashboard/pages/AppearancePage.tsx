import { FlaskConical, Palette } from 'lucide-react';
import { useId, useState } from 'react';
import type { Settings } from '@/core/settings/schema';
import { accentContrast, resolveTheme } from '@/features/appearance/themes';
import { Badge, Button, Callout, Card, Input, PageHeader, StatusPill, Switch } from '@/ui/components';
import { Segmented, Slider } from '@/ui/components/FormControls';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { BackgroundCard } from './appearance/BackgroundCard';
import { NicknameCard } from './appearance/NicknameCard';
import { ShortcutsCard } from './appearance/ShortcutsCard';
import { ThemePicker } from './appearance/ThemePicker';
import { useLocalValue } from './appearance/useLocalValue';

type Density = Settings['appearance']['density'];

function prefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** A sample of real components so every appearance change can be judged immediately. */
function LivePreview() {
  const t = useT();
  const [on, setOn] = useState(true);
  return (
    <Card title={t('appearance.preview.title')} description={t('appearance.preview.description')}>
      <div className="space-y-3">
        <div>
          <p className="text-base font-semibold text-fg">{t('appearance.preview.heading')}</p>
          <p className="text-sm text-fg">{t('appearance.preview.body')}</p>
          <p className="text-xs text-muted">{t('appearance.preview.muted')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary">
            {t('appearance.preview.primary')}
          </Button>
          <Button size="sm">{t('appearance.preview.secondary')}</Button>
          <Button size="sm" variant="outline">
            {t('appearance.preview.outline')}
          </Button>
          <Button size="sm" variant="danger">
            {t('automation.emergencyStop')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill status="running" />
          <StatusPill status="paused" />
          <StatusPill status="awaiting_authorization" />
          <StatusPill status="blocked" />
          <Badge tone="accent">{t('appearance.preview.badge')}</Badge>
        </div>
        <Switch checked={on} onChange={setOn} label={t('appearance.preview.switch')} />
        <Input aria-label={t('appearance.preview.input')} placeholder={t('appearance.preview.input')} />
        <p className="text-xs text-muted">
          {t('appearance.preview.privacy')} <span className="fp-sensitive font-medium text-fg">BuyerName · #A1B2C3D4</span>{' '}
          <span className="fp-balance font-medium text-fg">1 520,40 ₽</span>
        </p>
      </div>
    </Card>
  );
}

export default function AppearancePage() {
  const t = useT();
  const [settings, update] = useSettings();
  const a = settings.appearance;
  const accentId = useId();
  const [fontScale, setFontScale] = useLocalValue(a.fontScale, (v: number) => update({ appearance: { fontScale: v } }), 150);
  const [accent, setAccent] = useLocalValue(a.accentColor, (v: string | null) => update({ appearance: { accentColor: v } }), 150);
  const resolved = resolveTheme(a.theme, prefersDark());
  const accentRatio = accent ? accentContrast(accent, resolved) : null;

  return (
    <div className="space-y-5">
      <PageHeader title={t('appearance.page.title')} description={t('appearance.page.description')} />

      <Card title={t('appearance.theme.title')} description={t('appearance.theme.description')}>
        <ThemePicker value={a.theme} onChange={(theme) => void update({ appearance: { theme } })} />
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <Palette size={16} className="text-muted" aria-hidden />
          <label htmlFor={accentId} className="text-sm font-medium text-fg">
            {t('appearance.accent.label')}
          </label>
          <input id={accentId} type="color" value={accent ?? '#6845f7'} onChange={(e) => setAccent(e.target.value)} className="h-8 w-14 cursor-pointer rounded-md border border-border bg-surface p-0.5" />
          {accent ? (
            <Button size="sm" variant="ghost" onClick={() => setAccent(null)}>
              {t('appearance.accent.reset')}
            </Button>
          ) : (
            <span className="text-xs text-muted">{t('appearance.accent.themeDefault')}</span>
          )}
        </div>
        {accentRatio !== null && accentRatio < 3 && (
          <div className="mt-2">
            <Callout tone="warning">{t('appearance.accent.lowContrast', { ratio: accentRatio.toFixed(1) })}</Callout>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('appearance.layout.title')} description={t('appearance.layout.description')}>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-sm font-medium text-fg">{t('appearance.density.label')}</p>
              <Segmented<Density>
                label={t('appearance.density.label')}
                value={a.density}
                onChange={(density) => void update({ appearance: { density } })}
                options={(['compact', 'comfortable', 'spacious'] as const).map((d) => ({ value: d, label: t(`appearance.density.${d}`) }))}
              />
            </div>
            <Slider
              label={t('appearance.fontScale.label')}
              value={fontScale}
              min={0.8}
              max={1.5}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setFontScale(Math.round(v * 100) / 100)}
            />
            <Switch
              checked={a.reducedMotion}
              onChange={(v) => void update({ appearance: { reducedMotion: v } })}
              label={t('appearance.motion.label')}
              description={t('appearance.motion.help')}
            />
            <Switch
              checked={a.highContrast}
              onChange={(v) => void update({ appearance: { highContrast: v } })}
              label={t('appearance.contrast.label')}
              description={t('appearance.contrast.help')}
            />
          </div>
        </Card>
        <LivePreview />
      </div>

      <BackgroundCard />

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            {t('appearance.funpay.title')} <Badge tone="warning">{t('appearance.experimental')}</Badge>
          </span>
        }
        description={t('appearance.funpay.description')}
      >
        <Switch
          checked={a.themeFunPay}
          onChange={(v) => void update({ appearance: { themeFunPay: v } })}
          label={
            <span className="inline-flex items-center gap-1.5">
              <FlaskConical size={14} aria-hidden /> {t('appearance.funpay.enable')}
            </span>
          }
          description={t('appearance.funpay.help')}
        />
        <p className="mt-1 text-xs text-muted">{t('appearance.funpay.privacyNote')}</p>
      </Card>

      <NicknameCard />
      <ShortcutsCard />
    </div>
  );
}
