/**
 * AI provider catalog and factory. Knows each provider's endpoint, the optional host permission it
 * needs (declared in wxt.config.ts `optional_host_permissions`) and the suggested default model.
 */
import { ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_SUGGESTED_MODELS, createAnthropicProvider } from './anthropic';
import type { HttpDeps } from './http';
import { chatCompletionsUrl, createOpenAiProvider, OPENAI_CHAT_URL, OPENROUTER_CHAT_URL } from './openai';
import { AiError, type AiProvider, type AiProviderId } from './types';

export * from './types';
export { redactForAi, redactForAiReversible, restorePlaceholder, type NamePlaceholder } from './redact';
export { anthropicModelTraits, ANTHROPIC_DEFAULT_MODEL } from './anthropic';
export { isOpenAiReasoningModel } from './openai';

export interface ProviderInfo {
  id: AiProviderId;
  label: string;
  /** Host shown in the consent disclosure; null when it depends on the user's base URL. */
  host: string | null;
  /** Optional host permission pattern; null when derived from the base URL. */
  permissionOrigin: string | null;
  defaultModel: string;
  suggestedModels: readonly string[];
  keyRequired: boolean;
  privacyUrl: string | null;
}

export const AI_PROVIDERS: Record<AiProviderId, ProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    host: 'api.openai.com',
    permissionOrigin: 'https://api.openai.com/*',
    defaultModel: 'gpt-5-mini',
    suggestedModels: ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini'],
    keyRequired: true,
    privacyUrl: 'https://openai.com/policies/privacy-policy/',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    host: 'api.anthropic.com',
    permissionOrigin: 'https://api.anthropic.com/*',
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    suggestedModels: ANTHROPIC_SUGGESTED_MODELS,
    keyRequired: true,
    privacyUrl: 'https://www.anthropic.com/legal/privacy',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    host: 'openrouter.ai',
    permissionOrigin: 'https://openrouter.ai/*',
    defaultModel: '',
    suggestedModels: [],
    keyRequired: true,
    privacyUrl: 'https://openrouter.ai/privacy',
  },
  openai_compatible: {
    id: 'openai_compatible',
    label: 'OpenAI-compatible (local model or custom endpoint)',
    host: null,
    permissionOrigin: null,
    defaultModel: '',
    suggestedModels: [],
    keyRequired: false,
    privacyUrl: null,
  },
};

export function isProviderId(v: string): v is AiProviderId {
  return v in AI_PROVIDERS;
}

export type BaseUrlCheck =
  | { ok: true; url: URL; host: string; permissionOrigin: string; local: boolean }
  | { ok: false; error: 'empty' | 'invalid' | 'insecure' | 'credentials' };

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/**
 * Custom endpoints must use HTTPS. Plain HTTP is accepted only for local model servers on
 * localhost / 127.0.0.1 (the only http origins FunPro may request access to).
 */
export function validateBaseUrl(raw: string): BaseUrlCheck {
  const v = raw.trim();
  if (!v) return { ok: false, error: 'empty' };
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (url.username || url.password) return { ok: false, error: 'credentials' };
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'https:') {
    // Arbitrary https hosts are only reachable if the manifest's optional_host_permissions cover them.
    return {
      ok: true,
      url,
      host: url.host,
      permissionOrigin: `https://${host}/*`,
      local: LOCAL_HOSTS.has(host),
    };
  }
  if (url.protocol === 'http:') {
    if (!LOCAL_HOSTS.has(host)) return { ok: false, error: 'insecure' };
    return { ok: true, url, host: url.host, permissionOrigin: `http://${host}/*`, local: true };
  }
  return { ok: false, error: 'invalid' };
}

export interface AiConnectionConfig {
  provider: 'none' | AiProviderId;
  model: string;
  baseUrl: string;
}

/** Host permission pattern the configured provider needs, or null when not configured / invalid. */
export function providerPermissionOrigin(cfg: AiConnectionConfig): string | null {
  if (cfg.provider === 'none') return null;
  if (cfg.provider === 'openai_compatible') {
    const check = validateBaseUrl(cfg.baseUrl);
    return check.ok ? check.permissionOrigin : null;
  }
  return AI_PROVIDERS[cfg.provider].permissionOrigin;
}

/** Host that receives the data (for the consent disclosure), or null when not configured. */
export function providerHost(cfg: AiConnectionConfig): string | null {
  if (cfg.provider === 'none') return null;
  if (cfg.provider === 'openai_compatible') {
    const check = validateBaseUrl(cfg.baseUrl);
    return check.ok ? check.host : null;
  }
  return AI_PROVIDERS[cfg.provider].host;
}

/** Model to use: the configured one, or the provider's suggested default. */
export function effectiveModel(cfg: AiConnectionConfig): string {
  if (cfg.provider === 'none') return '';
  return cfg.model.trim() || AI_PROVIDERS[cfg.provider].defaultModel;
}

export interface CreateProviderOptions {
  apiKey: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  deps?: HttpDeps;
}

export function createAiProvider(cfg: AiConnectionConfig, opts: CreateProviderOptions): AiProvider {
  if (cfg.provider === 'none') throw new AiError('No AI provider selected', 'config');
  const model = effectiveModel(cfg);
  if (!model) throw new AiError('Enter a model name for this provider', 'config');
  const info = AI_PROVIDERS[cfg.provider];
  if (info.keyRequired && !opts.apiKey) throw new AiError('API key is missing', 'config');
  const common = { model, timeoutMs: opts.timeoutMs, maxRetries: opts.maxRetries, deps: opts.deps };
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropicProvider({ ...common, apiKey: opts.apiKey! });
    case 'openai':
      return createOpenAiProvider({
        ...common,
        flavor: 'openai',
        endpoint: OPENAI_CHAT_URL,
        apiKey: opts.apiKey,
      });
    case 'openrouter':
      return createOpenAiProvider({
        ...common,
        flavor: 'openrouter',
        endpoint: OPENROUTER_CHAT_URL,
        apiKey: opts.apiKey,
      });
    case 'openai_compatible': {
      const check = validateBaseUrl(cfg.baseUrl);
      if (!check.ok)
        throw new AiError('The base URL must be https://… or http://localhost / http://127.0.0.1', 'config');
      return createOpenAiProvider({
        ...common,
        flavor: 'openai_compatible',
        endpoint: chatCompletionsUrl(check.url.toString()),
        apiKey: opts.apiKey,
      });
    }
  }
}
