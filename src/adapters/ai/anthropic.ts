/**
 * Anthropic Messages API adapter (plain REST, no SDK dependency).
 *
 * Model-specific request rules (current as of the Claude API docs bundled with the `claude-api`
 * skill, 2026-10):
 *  - Claude Opus 4.7+ / Sonnet 5+ / Haiku 5.5 / Fable reject sampling parameters (`temperature`)
 *    with a 400, so `temperature` is only sent to models known to accept it (3.x, 4.0-4.6).
 *  - Current models think adaptively (Opus 5.5 always does); thinking counts toward `max_tokens`,
 *    so we add headroom and steer depth with `output_config.effort` ('low' for short copilot tasks).
 *  - `stop_reason: "refusal"` arrives as HTTP 200 and must be checked before reading content.
 *  - Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`)
 *    is enabled for the models that support it, so a classifier false positive is retried on
 *    Anthropic's recommended fallback model instead of failing the draft.
 * Browser calls need `anthropic-dangerous-direct-browser-access: true`.
 */
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, postJson, type HttpDeps } from './http';
import { AiError, type AiProvider, type AiRequest, type AiResponse } from './types';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
/** Suggested default; the user can pick any model id in settings. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
export const ANTHROPIC_SUGGESTED_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicModelTraits {
  /** Accepts `temperature`. */
  sampling: boolean;
  /** Accepts `output_config.effort`. */
  effort: boolean;
  /** Supports `fallbacks: "default"` on the Claude API. */
  serverFallback: boolean;
  /** Thinks unless told otherwise, so `max_tokens` needs headroom. */
  thinksByDefault: boolean;
}

/** Claude 3.x and the 4.0-4.6 generation (optionally with a date suffix) still take sampling params. */
const LEGACY_MODEL = /^claude-(?:3|2|instant|(?:opus|sonnet|haiku)-4(?:-[0-6])?(?:-\d{8})?$)/;
/** Legacy models that already support `output_config.effort`. */
const LEGACY_WITH_EFFORT = /^claude-(?:opus-4-[56]|sonnet-4-6)(?:-\d{8})?$/;
const SERVER_FALLBACK_MODELS: ReadonlySet<string> = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export function anthropicModelTraits(model: string): AnthropicModelTraits {
  const m = model.trim().toLowerCase();
  const legacy = LEGACY_MODEL.test(m);
  return {
    sampling: legacy,
    effort: !legacy || LEGACY_WITH_EFFORT.test(m),
    serverFallback: SERVER_FALLBACK_MODELS.has(m),
    // Opus 4.7/4.8 run without thinking unless it is requested.
    thinksByDefault: !legacy && !/^claude-opus-4-[78]/.test(m),
  };
}

export interface AnthropicProviderConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  deps?: HttpDeps;
}

export function buildAnthropicRequest(cfg: AnthropicProviderConfig, req: AiRequest): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const traits = anthropicModelTraits(cfg.model);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: traits.thinksByDefault ? req.maxTokens + 4000 : req.maxTokens,
    system: req.system,
    // Plain string contents only: no thinking blocks are ever replayed, and the conversation
    // always ends with a user turn (assistant prefill is rejected by current models).
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (traits.sampling) body['temperature'] = Math.min(1, req.temperature);
  if (traits.effort) body['output_config'] = { effort: req.effort ?? 'low' };
  if (traits.serverFallback) {
    body['fallbacks'] = 'default';
    headers['anthropic-beta'] = ANTHROPIC_FALLBACK_BETA;
  }
  return { url: ANTHROPIC_MESSAGES_URL, headers, body };
}

interface MessagesBody {
  model?: unknown;
  content?: { type?: unknown; text?: unknown }[];
  stop_reason?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseAnthropicResponse(json: unknown): AiResponse {
  const body = json as MessagesBody;
  // Check the stop reason before reading content: a declined request is a 200 with no usable text.
  if (body?.stop_reason === 'refusal') throw new AiError('The model declined to answer this request', 'refused');
  const blocks = Array.isArray(body?.content) ? body.content : [];
  const text = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();
  if (!text) {
    throw new AiError(body?.stop_reason === 'max_tokens' ? 'The answer was cut off before any text was produced' : 'The provider returned an empty answer', 'invalid_response');
  }
  return {
    text,
    model: typeof body.model === 'string' ? body.model : undefined,
    truncated: body.stop_reason === 'max_tokens',
    usage: { inputTokens: num(body.usage?.input_tokens), outputTokens: num(body.usage?.output_tokens) },
  };
}

export function createAnthropicProvider(cfg: AnthropicProviderConfig): AiProvider {
  return {
    id: 'anthropic',
    model: cfg.model,
    async complete(req, signal) {
      if (req.messages.length === 0 || req.messages[0]!.role !== 'user' || req.messages.at(-1)!.role !== 'user') {
        throw new AiError('Conversation must start and end with a user message', 'config');
      }
      const { url, headers, body } = buildAnthropicRequest(cfg, req);
      const json = await postJson({
        url,
        headers,
        body,
        signal,
        timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: cfg.maxRetries ?? DEFAULT_MAX_RETRIES,
        deps: cfg.deps,
        secrets: [cfg.apiKey],
      });
      return parseAnthropicResponse(json);
    },
  };
}
