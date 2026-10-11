/**
 * OpenAI Chat Completions adapter. Also serves OpenRouter and any OpenAI-compatible server
 * (Ollama, LM Studio, llama.cpp, vLLM, ...) — they share the request/response shape.
 */
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, postJson, type HttpDeps } from './http';
import { AiError, type AiProvider, type AiRequest, type AiResponse } from './types';

export const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type OpenAiFlavor = 'openai' | 'openrouter' | 'openai_compatible';

export interface OpenAiProviderConfig {
  flavor: OpenAiFlavor;
  /** Full chat-completions URL. */
  endpoint: string;
  /** Local OpenAI-compatible servers may not need a key. */
  apiKey: string | null;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  deps?: HttpDeps;
}

/**
 * OpenAI reasoning models (o-series, GPT-5 family) only accept the default temperature and count
 * hidden reasoning tokens against `max_completion_tokens`.
 */
export function isOpenAiReasoningModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (/^gpt-5[\w.-]*chat/.test(m)) return false;
  return /^(o\d|gpt-5)/.test(m);
}

/** `${baseUrl}/chat/completions`, unless the user already entered the full endpoint. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

export function buildOpenAiRequest(
  cfg: OpenAiProviderConfig,
  req: AiRequest,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  const messages = [
    { role: 'system', content: req.system },
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const body: Record<string, unknown> = { model: cfg.model, messages, stream: false };
  if (cfg.flavor === 'openai') {
    if (isOpenAiReasoningModel(cfg.model)) {
      // Reasoning tokens are billed against this cap too, so leave room for them.
      body['max_completion_tokens'] = req.maxTokens + 4000;
      body['reasoning_effort'] = req.effort ?? 'low';
    } else {
      body['max_completion_tokens'] = req.maxTokens;
      body['temperature'] = req.temperature;
    }
  } else {
    // OpenRouter and local servers use the widely supported legacy parameter name.
    body['max_tokens'] = req.maxTokens;
    body['temperature'] = req.temperature;
  }
  return { url: cfg.endpoint, headers, body };
}

interface ChatCompletionBody {
  model?: unknown;
  choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
          ? (p as { text: string }).text
          : '',
      )
      .join('');
  }
  return '';
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseOpenAiResponse(json: unknown): AiResponse {
  const body = json as ChatCompletionBody;
  const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined;
  if (!choice) throw new AiError('The provider returned no answer', 'invalid_response');
  const finish = typeof choice.finish_reason === 'string' ? choice.finish_reason : '';
  const refusal = choice.message?.refusal;
  if (finish === 'content_filter' || (typeof refusal === 'string' && refusal.trim())) {
    throw new AiError('The provider declined to answer this request', 'refused');
  }
  const text = contentText(choice.message?.content).trim();
  if (!text) {
    throw new AiError(
      finish === 'length'
        ? 'The answer was cut off before any text was produced'
        : 'The provider returned an empty answer',
      'invalid_response',
    );
  }
  return {
    text,
    model: typeof body.model === 'string' ? body.model : undefined,
    truncated: finish === 'length',
    usage: { inputTokens: num(body.usage?.prompt_tokens), outputTokens: num(body.usage?.completion_tokens) },
  };
}

export function createOpenAiProvider(cfg: OpenAiProviderConfig): AiProvider {
  return {
    id: cfg.flavor,
    model: cfg.model,
    async complete(req, signal) {
      const { url, headers, body } = buildOpenAiRequest(cfg, req);
      const json = await postJson({
        url,
        headers,
        body,
        signal,
        timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: cfg.maxRetries ?? DEFAULT_MAX_RETRIES,
        deps: cfg.deps,
        secrets: cfg.apiKey ? [cfg.apiKey] : [],
      });
      return parseOpenAiResponse(json);
    },
  };
}
