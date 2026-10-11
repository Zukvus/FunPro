import { FEATURE_FLAGS, type FeatureFlag } from '@/core/flags/flags';
import { ALL_FLAGS, effectiveFlags, flagPatch, isOverridden, LOCKED_FLAGS } from '@/features/diagnostics/flags';
import { Badge, Button, Card, Switch } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { hasTranslation, useLang, useT } from '@/ui/i18n';

/** Feature flag editor: compiled defaults with per-user overrides stored in settings.flags. */
export function FlagsCard() {
  const t = useT();
  const lang = useLang();
  const [settings, update] = useSettings();
  const effective = effectiveFlags(settings.flags);
  const set = (f: FeatureFlag, v: boolean) => void update({ flags: flagPatch(f, v) });
  const describe = (f: FeatureFlag) => (hasTranslation(lang, `flags.${f}`) || hasTranslation('en', `flags.${f}`) ? t(`flags.${f}`) : FEATURE_FLAGS[f].description);

  return (
    <Card title={t('flags.title')} description={t('flags.description')}>
      <ul className="divide-y divide-border">
        {ALL_FLAGS.map((f) => {
          const locked = LOCKED_FLAGS[f];
          const overridden = isOverridden(f, settings.flags);
          return (
            <li key={f} className="py-1">
              <Switch
                checked={effective[f]}
                disabled={!!locked}
                onChange={(v) => set(f, v)}
                label={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs">{f}</code>
                    {locked ? (
                      <Badge tone="danger">{t('status.blocked')}</Badge>
                    ) : overridden ? (
                      <Badge tone="warning">{t('flags.overridden')}</Badge>
                    ) : (
                      <Badge tone="neutral">{t('flags.default', { value: FEATURE_FLAGS[f].default ? t('common.enabled') : t('common.disabled') })}</Badge>
                    )}
                  </span>
                }
                description={locked ? `${describe(f)} — ${t('flags.locked.requires_sync_service')}` : describe(f)}
              />
              {overridden && !locked && (
                <Button size="sm" variant="ghost" className="mb-1" onClick={() => set(f, FEATURE_FLAGS[f].default)}>
                  {t('flags.reset')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
