/**
 * Provider-neutral AI completion interface. Every provider adapter (OpenAI, Anthropic, OpenRouter,
 * generic OpenAI-compatible) implements `AiProvider`; feature code never talks to a vendor API
 * directly.
 *
 * Security: adapters receive the API key from the caller (extension pages / background only) and
 * never log it. Error messages are scrubbed before they leave the adapter.
 */

export type AiProviderId = 'openai' | 'anthropic' | 'openrouter' | 'openai_compatible';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  /** Upper bound for the visible answer. Providers that think before answering add headroom. */
  maxTokens: number;
  temperature: number;
  /** Reasoning effort hint for providers/models that support it. Copilot tasks are short: 'low'. */
  effort?: 'low' | 'medium' | 'high';
}

export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiResponse {
  text: string;
  usage?: AiUsage;
  /** Model that actually served the request, when the provider reports it. */
  model?: string;
  /** The answer hit the token limit and may be cut off. */
  truncated?: boolean;
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly model: string;
  complete(req: AiRequest, signal?: AbortSignal): Promise<AiResponse>;
}

export type AiErrorCode =
  | 'auth'
  | 'rate_limited'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'not_found'
  | 'refused'
  | 'invalid_response'
  | 'aborted'
  | 'config';

/** Typed error thrown by provider adapters. `message` is safe to show and to log. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly code: AiErrorCode,
    readonly status: number | null = null,
    /** Seconds the provider asked us to wait (429), when known. */
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export function isAiError(e: unknown): e is AiError {
  return e instanceof AiError;
}
