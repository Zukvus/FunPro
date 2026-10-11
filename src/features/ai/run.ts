/**
 * Single entry point for copilot calls to a provider. Resolves availability (flag, local-only,
 * consent, key, permission), runs one completion and returns a typed outcome. Logs only metadata
 * (task, provider, model, token counts) — never prompts, answers or keys.
 */
import { AiError, type AiErrorCode, type AiProviderId } from '@/adapters/ai';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import { getSettings } from '@/core/settings/store';
import { defaultAiDeps, resolveAiProvider, type AiRuntimeDeps, type AiUnavailableReason } from './availability';

export type AiTask =
  | 'draft_reply'
  | 'complaint'
  | 'summarize'
  | 'classify'
  | 'attention'
  | 'rank_templates'
  | 'translate'
  | 'rewrite_listing'
  | 'listing_tips'
  | 'sales_trend'
  | 'review_reply'
  | 'test';

export interface AiTextPrompt {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

export interface AiRunOptions {
  settings?: Settings;
  deps?: AiRuntimeDeps;
  signal?: AbortSignal;
}

export type AiFailureReason = AiUnavailableReason | AiErrorCode;

export type AiRunResult =
  | { ok: true; text: string; truncated: boolean; provider: AiProviderId; model: string }
  | { ok: false; reason: AiFailureReason; message: string };

const REASON_MESSAGES: Record<AiUnavailableReason, string> = {
  flag_off: 'The AI copilot is turned off in diagnostics flags',
  local_only: 'Local-only mode is on: external services are disabled',
  no_provider: 'No AI provider is configured',
  invalid_base_url: 'The custom endpoint URL is not valid',
  no_model: 'No model is configured',
  disabled: 'The AI copilot is disabled',
  no_consent: 'Consent for this AI provider is missing',
  no_key: 'The API key is missing',
  no_permission: 'Access to the provider was not granted in the browser',
};

export function unavailableMessage(reason: AiFailureReason): string {
  return (REASON_MESSAGES as Record<string, string>)[reason] ?? reason;
}

export async function runAiText(task: AiTask, prompt: AiTextPrompt, opts: AiRunOptions = {}): Promise<AiRunResult> {
  const settings = opts.settings ?? (await getSettings());
  let resolved: Awaited<ReturnType<typeof resolveAiProvider>>;
  try {
    resolved = await resolveAiProvider(settings, opts.deps ?? defaultAiDeps(), { forTest: task === 'test' });
  } catch (e) {
    return { ok: false, reason: 'config', message: e instanceof Error ? e.message : String(e) };
  }
  if (!resolved.ok) return { ok: false, reason: resolved.reason, message: unavailableMessage(resolved.reason) };
  const { provider } = resolved;
  const started = Date.now();
  try {
    const res = await provider.complete(
      {
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: prompt.maxTokens,
        temperature: prompt.temperature ?? settings.ai.temperature,
        effort: 'low',
      },
      opts.signal,
    );
    const inTok = res.usage?.inputTokens ?? '?';
    const outTok = res.usage?.outputTokens ?? '?';
    void log.info({
      source: 'ai',
      message: `AI ${task} via ${provider.id} (${res.model ?? provider.model}) in ${Date.now() - started} ms, ${inTok} in / ${outTok} out`,
    });
    return { ok: true, text: res.text, truncated: !!res.truncated, provider: provider.id, model: res.model ?? provider.model };
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('Unexpected error while calling the AI provider', 'invalid_response');
    if (err.code !== 'aborted') void log.warn({ source: 'ai', message: `AI ${task} via ${provider.id} failed (${err.code}): ${err.message}` });
    return { ok: false, reason: err.code, message: err.message };
  }
}
