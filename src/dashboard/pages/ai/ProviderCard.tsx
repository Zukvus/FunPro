import { KeyRound, PlugZap, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import {
  AI_PROVIDERS,
  effectiveModel,
  providerHost,
  providerPermissionOrigin,
  validateBaseUrl,
} from '@/adapters/ai';
import type { AiProviderId } from '@/adapters/ai';
import { deleteSecret, setSecret } from '@/core/security/secrets';
import { testAiConnection } from '@/features/ai';
import { Button, Callout, Card, Field, Input, Select, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { isDeclaredOptionalOrigin, requestOrigin } from '../integrations/permissions';

const PROVIDER_IDS: ('none' | AiProviderId)[] = [
  'none',
  'openai',
  'anthropic',
  'openrouter',
  'openai_compatible',
];

export function ProviderCard({ keySaved, onChanged }: { keySaved: boolean | null; onChanged: () => void }) {
  const t = useT();
  const [settings, update] = useSettings();
  const ai = settings.ai;
  const info = ai.provider === 'none' ? null : AI_PROVIDERS[ai.provider];
  const [model, setModel] = useState(ai.model);
  const [baseUrl, setBaseUrl] = useState(ai.baseUrl);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'key' | 'test' | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const listId = useId();

  useEffect(() => setModel(ai.model), [ai.model]);
  useEffect(() => setBaseUrl(ai.baseUrl), [ai.baseUrl]);

  const baseCheck = ai.provider === 'openai_compatible' ? validateBaseUrl(baseUrl) : null;
  const host = providerHost(ai);
  const origin = providerPermissionOrigin(ai);
  const notDeclared =
    ai.provider === 'openai_compatible' && origin !== null && !isDeclaredOptionalOrigin(origin);

  const changeProvider = async (provider: 'none' | AiProviderId) => {
    // A different provider is a different recipient: consent and the "enabled" switch reset.
    await update({ ai: { provider, model: '', enabled: false, consentAt: null, consentScope: '' } });
    setTestResult(null);
    onChanged();
  };

  const saveKey = async () => {
    setBusy('key');
    try {
      await setSecret('ai.apiKey', key.trim());
      setKey('');
      toast.success(t('aiPage.key.saved'));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async () => {
    await deleteSecret('ai.apiKey');
    await update({ ai: { enabled: false } });
    toast.info(t('aiPage.key.removed'));
    onChanged();
  };

  const test = () => {
    if (!origin) return;
    // The permission prompt must be requested synchronously inside the click handler.
    const permission = requestOrigin(origin);
    setBusy('test');
    setTestResult(null);
    void (async () => {
      try {
        if (!(await permission)) {
          setTestResult({ ok: false, text: t('aiPage.reason.no_permission') });
          return;
        }
        onChanged();
        const res = await testAiConnection();
        setTestResult(
          res.ok
            ? { ok: true, text: t('aiPage.test.ok', { model: res.model, ms: res.latencyMs }) }
            : {
                ok: false,
                text: `${t(`aiPage.reason.${res.reason}`)}${res.message ? ` — ${res.message}` : ''}`,
              },
        );
      } finally {
        setBusy(null);
      }
    })();
  };

  return (
    <Card title={t('aiPage.provider.title')} description={t('aiPage.provider.description')}>
      <div className="grid gap-3">
        <Field label={t('aiPage.provider.label')}>
          <Select
            value={ai.provider}
            onChange={(e) => void changeProvider(e.target.value as 'none' | AiProviderId)}
          >
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {id === 'none' ? t('aiPage.provider.none') : AI_PROVIDERS[id].label}
              </option>
            ))}
          </Select>
        </Field>

        {info && (
          <>
            {ai.provider === 'openai_compatible' && (
              <Field
                label={t('aiPage.baseUrl.label')}
                help={t('aiPage.baseUrl.help')}
                error={
                  baseCheck && !baseCheck.ok && baseUrl.trim()
                    ? t(`aiPage.baseUrl.error.${baseCheck.error}`)
                    : undefined
                }
              >
                <Input
                  value={baseUrl}
                  placeholder="http://localhost:11434/v1"
                  spellCheck={false}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  onBlur={() => {
                    if (baseUrl.trim() !== ai.baseUrl)
                      void update({ ai: { baseUrl: baseUrl.trim().slice(0, 300) } }).then(onChanged);
                  }}
                />
              </Field>
            )}
            {notDeclared && (
              <Callout tone="warning">{t('aiPage.baseUrl.notDeclared', { origin: origin ?? '' })}</Callout>
            )}

            <Field
              label={t('aiPage.model.label')}
              help={
                info.defaultModel
                  ? t('aiPage.model.default', { model: info.defaultModel })
                  : t('aiPage.model.required')
              }
            >
              <Input
                value={model}
                list={listId}
                placeholder={info.defaultModel || t('aiPage.model.placeholder')}
                spellCheck={false}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => {
                  if (model.trim() !== ai.model)
                    void update({ ai: { model: model.trim().slice(0, 100) } }).then(onChanged);
                }}
              />
              <datalist id={listId}>
                {info.suggestedModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>

            <Field
              label={t('aiPage.key.label')}
              help={
                keySaved
                  ? t('aiPage.key.stored')
                  : info.keyRequired
                    ? t('aiPage.key.missing')
                    : t('aiPage.key.optional')
              }
            >
              <div className="flex gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  placeholder={keySaved ? '••••••••' : t('aiPage.key.placeholder')}
                  onChange={(e) => setKey(e.target.value)}
                />
                <Button
                  variant="primary"
                  icon={<KeyRound size={14} />}
                  onClick={() => void saveKey()}
                  disabled={!key.trim()}
                  loading={busy === 'key'}
                >
                  {t('common.save')}
                </Button>
                {keySaved && (
                  <Button
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    onClick={() => void removeKey()}
                    aria-label={t('aiPage.key.remove')}
                    title={t('aiPage.key.remove')}
                  />
                )}
              </div>
            </Field>

            <Field label={t('aiPage.temperature.label')} help={t('aiPage.temperature.help')}>
              <Input
                type="number"
                min={0}
                max={1.5}
                step={0.1}
                value={ai.temperature}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0 && v <= 1.5)
                    void update({ ai: { temperature: Math.round(v * 10) / 10 } });
                }}
                className="w-28"
              />
            </Field>

            <Callout tone="warning" title={t('aiPage.security.title')}>
              {t('aiPage.security.body')}
            </Callout>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                icon={<PlugZap size={14} />}
                onClick={test}
                loading={busy === 'test'}
                disabled={
                  !origin ||
                  !effectiveModel(ai) ||
                  settings.general.localOnly ||
                  (info.keyRequired && !keySaved)
                }
              >
                {t('aiPage.test.button')}
              </Button>
              <span className="text-xs text-muted">{host ? t('aiPage.test.note', { host }) : null}</span>
            </div>
            {testResult && <Callout tone={testResult.ok ? 'success' : 'danger'}>{testResult.text}</Callout>}
          </>
        )}
      </div>
    </Card>
  );
}
