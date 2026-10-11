import { useCallback, useEffect, useRef, useState } from 'react';
import { providerPermissionOrigin } from '@/adapters/ai';
import { hasSecret } from '@/core/security/secrets';
import { aiAvailability, type AiFallbackInfo, type AiUnavailableReason, type CopilotSource, type DraftWarning } from '@/features/ai';
import { Badge } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useOriginPermission } from '../integrations/permissions';

export type AiStatus = { ok: true } | { ok: false; reason: AiUnavailableReason } | null;

/** Live availability of the copilot (settings, key, permission) for the dashboard. */
export function useAiStatus(): { status: AiStatus; keySaved: boolean | null; refresh: () => void } {
  const [settings] = useSettings();
  const origin = providerPermissionOrigin(settings.ai);
  const { granted } = useOriginPermission(origin);
  const [status, setStatus] = useState<AiStatus>(null);
  const [keySaved, setKeySaved] = useState<boolean | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    void Promise.all([aiAvailability(settings), hasSecret('ai.apiKey')]).then(([s, k]) => {
      if (!alive) return;
      setStatus(s);
      setKeySaved(k);
    });
    return () => {
      alive = false;
    };
  }, [settings, granted, version]);
  return { status, keySaved, refresh };
}

export function SourceBadge({ source }: { source: CopilotSource | 'rules' | 'ai' }) {
  const t = useT();
  const tone = source === 'ai' ? 'accent' : source === 'local' ? 'info' : 'neutral';
  return <Badge tone={tone}>{t(`aiPage.source.${source}`)}</Badge>;
}

const UNAVAILABLE_REASONS: ReadonlySet<string> = new Set<AiUnavailableReason>([
  'flag_off',
  'local_only',
  'no_provider',
  'invalid_base_url',
  'no_model',
  'disabled',
  'no_consent',
  'no_key',
  'no_permission',
]);

/** Why the AI was not used; provider errors also show the (key-free) provider message. */
export function AiErrorNote({ error }: { error?: AiFallbackInfo }) {
  const t = useT();
  if (!error) return null;
  const providerError = !UNAVAILABLE_REASONS.has(error.reason);
  return (
    <p className="text-xs text-muted">
      {t('aiPage.fallbackUsed', { reason: t(`aiPage.reason.${error.reason}`) })}
      {providerError && error.message ? ` (${error.message})` : ''}
    </p>
  );
}

export function WarningList({ warnings }: { warnings: readonly (DraftWarning | string)[] }) {
  const t = useT();
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg bg-warning/10 px-3 py-2 text-xs text-fg" role="list">
      {warnings.map((w) => (
        <li key={w}>⚠ {t(`aiPage.warning.${w}`)}</li>
      ))}
    </ul>
  );
}

/** One cancellable AI request at a time; aborted on unmount. */
export function useAbortable(): { start: () => AbortSignal; cancel: () => void; finish: () => void; running: boolean } {
  const ref = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => () => ref.current?.abort(), []);
  return {
    start: () => {
      ref.current?.abort();
      ref.current = new AbortController();
      setRunning(true);
      return ref.current.signal;
    },
    cancel: () => {
      ref.current?.abort();
      ref.current = null;
      setRunning(false);
    },
    finish: () => {
      ref.current = null;
      setRunning(false);
    },
    running,
  };
}
