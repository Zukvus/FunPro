/**
 * Whether the AI copilot may contact the configured provider right now, and why not.
 *
 * Gates, in order: feature flag → local-only mode → provider configured → base URL valid → model →
 * enabled → explicit consent for exactly this provider/endpoint → API key → host permission.
 */
import { browser } from 'wxt/browser';
import { createAiProvider, effectiveModel, providerHost, providerPermissionOrigin, validateBaseUrl, type AiProvider } from '@/adapters/ai';
import type { HttpDeps } from '@/adapters/ai/http';
import { isFlagEnabled } from '@/core/flags/flags';
import { getSecret } from '@/core/security/secrets';
import type { Settings } from '@/core/settings/schema';

export type AiUnavailableReason =
  | 'flag_off'
  | 'local_only'
  | 'no_provider'
  | 'invalid_base_url'
  | 'no_model'
  | 'disabled'
  | 'no_consent'
  | 'no_key'
  | 'no_permission';

type AiSettings = Settings['ai'];

/** `provider|host` — the recipient named in the consent disclosure. */
export function consentScopeFor(ai: AiSettings): string {
  if (ai.provider === 'none') return '';
  return `${ai.provider}|${providerHost(ai) ?? ''}`;
}

export function hasValidConsent(ai: AiSettings): boolean {
  return ai.consentAt !== null && ai.consentScope !== '' && ai.consentScope === consentScopeFor(ai);
}

export interface StaticCheckOptions {
  /** The "test connection" button works before consent/enable (it sends a fixed test text only). */
  forTest?: boolean;
}

export function staticAiCheck(settings: Settings, opts: StaticCheckOptions = {}): { ok: true } | { ok: false; reason: AiUnavailableReason } {
  if (!isFlagEnabled('aiCopilot', settings.flags)) return { ok: false, reason: 'flag_off' };
  if (settings.general.localOnly) return { ok: false, reason: 'local_only' };
  const ai = settings.ai;
  if (ai.provider === 'none') return { ok: false, reason: 'no_provider' };
  if (ai.provider === 'openai_compatible' && !validateBaseUrl(ai.baseUrl).ok) return { ok: false, reason: 'invalid_base_url' };
  if (!effectiveModel(ai)) return { ok: false, reason: 'no_model' };
  if (!opts.forTest) {
    if (!ai.enabled) return { ok: false, reason: 'disabled' };
    if (!hasValidConsent(ai)) return { ok: false, reason: 'no_consent' };
  }
  return { ok: true };
}

export interface AiRuntimeDeps {
  getApiKey(): Promise<string | null>;
  hasPermission(origin: string): Promise<boolean>;
  http?: HttpDeps;
  timeoutMs?: number;
}

export function defaultAiDeps(): AiRuntimeDeps {
  return {
    getApiKey: () => getSecret('ai.apiKey'),
    async hasPermission(origin) {
      try {
        return await browser.permissions.contains({ origins: [origin] });
      } catch {
        return false;
      }
    },
  };
}

export type ResolvedAi = { ok: true; provider: AiProvider; host: string } | { ok: false; reason: AiUnavailableReason };

export async function resolveAiProvider(settings: Settings, deps: AiRuntimeDeps, opts: StaticCheckOptions = {}): Promise<ResolvedAi> {
  const check = staticAiCheck(settings, opts);
  if (!check.ok) return check;
  const ai = settings.ai;
  const key = (await deps.getApiKey())?.trim() || null;
  if (ai.provider !== 'openai_compatible' && !key) return { ok: false, reason: 'no_key' };
  const origin = providerPermissionOrigin(ai);
  if (!origin || !(await deps.hasPermission(origin))) return { ok: false, reason: 'no_permission' };
  const provider = createAiProvider(ai, { apiKey: key, deps: deps.http, timeoutMs: deps.timeoutMs });
  return { ok: true, provider, host: providerHost(ai) ?? '' };
}

/** Cheap check for UIs: everything except the network call. */
export async function aiAvailability(settings: Settings, deps: AiRuntimeDeps = defaultAiDeps()): Promise<{ ok: true } | { ok: false; reason: AiUnavailableReason }> {
  const res = await resolveAiProvider(settings, deps);
  return res.ok ? { ok: true } : res;
}
