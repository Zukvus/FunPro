import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { lintText } from '@/features/messages/lint';
import { Button, Card, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { FeatureToggle, LintList, TemplateField } from './shared';

function TextSetting({
  field,
  label,
  help,
}: {
  field: 'welcomeText' | 'postOrderText';
  label: string;
  help: string;
}) {
  const t = useT();
  const [settings, update, loaded] = useSettings();
  const stored = settings.messages[field];
  const [value, setValue] = useState(stored);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (loaded) setValue(stored);
  }, [stored, loaded]);
  const dirty = value !== stored;
  const save = async () => {
    setSaving(true);
    try {
      await update({ messages: { [field]: value.trim() } });
      toast.success(t('msg.welcome.saved'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2">
      <TemplateField label={label} value={value} onChange={setValue} help={help} rows={4} />
      <div className="flex items-center justify-end gap-2">
        {dirty && <span className="text-[11px] text-warning">{t('msg.welcome.unsaved')}</span>}
        <Button
          size="sm"
          variant="primary"
          icon={<Save size={14} />}
          disabled={!dirty}
          loading={saving}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

export function WelcomeTab() {
  const t = useT();
  const [settings] = useSettings();
  const m = settings.messages;
  return (
    <div className="space-y-4">
      <Card>
        <FeatureToggle
          feature="welcomeMessage"
          title={t('msg.welcome.title')}
          description={t('msg.welcome.description')}
          confirmTitle={t('msg.welcome.confirmTitle')}
          confirmBody={
            <div className="space-y-2">
              <p>{t('msg.welcome.confirmBody')}</p>
              {m.welcomeText ? (
                <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs">{m.welcomeText}</p>
              ) : (
                <p className="text-xs text-warning">{t('msg.welcome.noTextYet')}</p>
              )}
              <LintList issues={m.welcomeText ? lintText(m.welcomeText) : []} />
            </div>
          }
        />
        <div className="mt-4 border-t border-border pt-4">
          <TextSetting field="welcomeText" label={t('msg.welcome.text')} help={t('msg.welcome.textHelp')} />
        </div>
      </Card>

      <Card>
        <FeatureToggle
          feature="postOrderMessage"
          title={t('msg.postOrder.title')}
          description={t('msg.postOrder.description')}
          confirmTitle={t('msg.postOrder.confirmTitle')}
          confirmBody={
            <div className="space-y-2">
              <p>{t('msg.postOrder.confirmBody')}</p>
              {m.postOrderText ? (
                <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs">{m.postOrderText}</p>
              ) : (
                <p className="text-xs text-warning">{t('msg.welcome.noTextYet')}</p>
              )}
              <LintList issues={m.postOrderText ? lintText(m.postOrderText) : []} />
            </div>
          }
        />
        <div className="mt-4 border-t border-border pt-4">
          <TextSetting
            field="postOrderText"
            label={t('msg.postOrder.text')}
            help={t('msg.postOrder.textHelp')}
          />
        </div>
      </Card>

      <Card title={t('msg.welcome.rulesTitle')}>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>{t('msg.welcome.rule1')}</li>
          <li>{t('msg.welcome.rule2')}</li>
          <li>{t('msg.welcome.rule3')}</li>
          <li>{t('msg.welcome.rule4')}</li>
        </ul>
      </Card>
    </div>
  );
}
