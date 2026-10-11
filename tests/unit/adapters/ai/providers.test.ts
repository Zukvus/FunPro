import { describe, expect, it, vi } from 'vitest';
import {
  AiError,
  anthropicModelTraits,
  createAiProvider,
  providerPermissionOrigin,
  validateBaseUrl,
} from '@/adapters/ai';
import { ANTHROPIC_FALLBACK_BETA, ANTHROPIC_VERSION, buildAnthropicRequest } from '@/adapters/ai/anthropic';
import { parseRetryAfter } from '@/adapters/ai/http';
import { buildOpenAiRequest, chatCompletionsUrl, isOpenAiReasoningModel } from '@/adapters/ai/openai';
import type { AiRequest } from '@/adapters/ai';

const REQ: AiRequest = {
  system: 'SYSTEM RULES',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 300,
  temperature: 0.4,
  effort: 'low',
};

const KEY = 'sk-test-SECRETKEY1234567890';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const openAiOk = {
  model: 'gpt-4.1-mini',
  choices: [{ message: { content: ' Hi there ' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 3 },
};
const anthropicOk = {
  model: 'claude-opus-5-5',
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'Hello from Claude' },
  ],
  stop_reason: 'end_turn',
  usage: { input_tokens: 12, output_tokens: 5 },
};

describe('OpenAI request building', () => {
  it('uses max_completion_tokens + temperature for regular models and bearer auth', () => {
    const r = buildOpenAiRequest(
      {
        flavor: 'openai',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: KEY,
        model: 'gpt-4.1-mini',
      },
      REQ,
    );
    expect(r.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(r.headers['Authorization']).toBe(`Bearer ${KEY}`);
    expect(r.body).toMatchObject({
      model: 'gpt-4.1-mini',
      max_completion_tokens: 300,
      temperature: 0.4,
      stream: false,
    });
    expect(r.body['messages']).toEqual([
      { role: 'system', content: 'SYSTEM RULES' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('omits temperature and adds reasoning effort + headroom for reasoning models', () => {
    expect(isOpenAiReasoningModel('gpt-5-mini')).toBe(true);
    expect(isOpenAiReasoningModel('o4-mini')).toBe(true);
    expect(isOpenAiReasoningModel('gpt-5-chat-latest')).toBe(false);
    const r = buildOpenAiRequest({ flavor: 'openai', endpoint: 'x', apiKey: KEY, model: 'gpt-5-mini' }, REQ);
    expect(r.body['temperature']).toBeUndefined();
    expect(r.body['reasoning_effort']).toBe('low');
    expect(r.body['max_completion_tokens']).toBeGreaterThan(REQ.maxTokens);
  });

  it('uses max_tokens for OpenRouter and OpenAI-compatible servers, and no auth header without a key', () => {
    const or = buildOpenAiRequest(
      {
        flavor: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: KEY,
        model: 'some/model',
      },
      REQ,
    );
    expect(or.body).toMatchObject({ max_tokens: 300, temperature: 0.4 });
    expect(or.body['max_completion_tokens']).toBeUndefined();
    const local = buildOpenAiRequest(
      {
        flavor: 'openai_compatible',
        endpoint: chatCompletionsUrl('http://localhost:11434/v1/'),
        apiKey: null,
        model: 'llama3',
      },
      REQ,
    );
    expect(local.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(local.headers['Authorization']).toBeUndefined();
    expect(chatCompletionsUrl('http://127.0.0.1:1234/v1/chat/completions')).toBe(
      'http://127.0.0.1:1234/v1/chat/completions',
    );
  });
});

describe('Anthropic request building', () => {
  it('sends the required headers, a top-level system prompt and no temperature for current models', () => {
    const r = buildAnthropicRequest({ apiKey: KEY, model: 'claude-opus-5-5' }, REQ);
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers).toMatchObject({
      'x-api-key': KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': ANTHROPIC_FALLBACK_BETA,
    });
    expect(r.headers['Authorization']).toBeUndefined();
    expect(r.body['system']).toBe('SYSTEM RULES');
    expect(r.body['messages']).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(r.body['temperature']).toBeUndefined();
    expect(r.body['thinking']).toBeUndefined();
    expect(r.body['output_config']).toEqual({ effort: 'low' });
    expect(r.body['fallbacks']).toBe('default');
    // Thinking counts toward max_tokens, so there is headroom above the visible-answer budget.
    expect(r.body['max_tokens']).toBeGreaterThan(REQ.maxTokens);
  });

  it('keeps sampling for 4.6-and-older models and only enables features each model supports', () => {
    expect(anthropicModelTraits('claude-sonnet-4-6')).toEqual({
      sampling: true,
      effort: true,
      serverFallback: false,
      thinksByDefault: false,
    });
    expect(anthropicModelTraits('claude-haiku-4-5')).toMatchObject({
      sampling: true,
      effort: false,
      serverFallback: false,
    });
    expect(anthropicModelTraits('claude-3-5-sonnet-20241022')).toMatchObject({
      sampling: true,
      effort: false,
    });
    expect(anthropicModelTraits('claude-sonnet-4-20250514')).toMatchObject({ sampling: true });
    expect(anthropicModelTraits('claude-opus-4-8')).toMatchObject({
      sampling: false,
      effort: true,
      serverFallback: false,
      thinksByDefault: false,
    });
    expect(anthropicModelTraits('claude-haiku-5-5')).toMatchObject({
      sampling: false,
      effort: true,
      serverFallback: false,
      thinksByDefault: true,
    });
    expect(anthropicModelTraits('claude-sonnet-5-5')).toMatchObject({
      sampling: false,
      serverFallback: true,
    });

    const legacy = buildAnthropicRequest(
      { apiKey: KEY, model: 'claude-haiku-4-5' },
      { ...REQ, temperature: 1.4 },
    );
    expect(legacy.body['temperature']).toBe(1);
    expect(legacy.body['output_config']).toBeUndefined();
    expect(legacy.body['fallbacks']).toBeUndefined();
    expect(legacy.headers['anthropic-beta']).toBeUndefined();
    expect(legacy.body['max_tokens']).toBe(REQ.maxTokens);
  });
});

describe('provider calls (mock fetch)', () => {
  it('OpenAI: posts the built request and parses the answer', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, openAiOk));
    const p = createAiProvider(
      { provider: 'openai', model: 'gpt-4.1-mini', baseUrl: '' },
      { apiKey: KEY, deps: { fetch: fetchMock as unknown as typeof fetch } },
    );
    const res = await p.complete(REQ);
    expect(res).toMatchObject({
      text: 'Hi there',
      truncated: false,
      usage: { inputTokens: 10, outputTokens: 3 },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'gpt-4.1-mini' });
  });

  it('Anthropic: reads text blocks only and reports refusals as typed errors', async () => {
    const ok = createAiProvider(
      { provider: 'anthropic', model: '', baseUrl: '' },
      {
        apiKey: KEY,
        deps: { fetch: (async () => jsonResponse(200, anthropicOk)) as unknown as typeof fetch },
      },
    );
    expect(ok.model).toBe('claude-opus-5-5');
    await expect(ok.complete(REQ)).resolves.toMatchObject({ text: 'Hello from Claude' });

    const refusing = createAiProvider(
      { provider: 'anthropic', model: 'claude-opus-5-5', baseUrl: '' },
      {
        apiKey: KEY,
        deps: {
          fetch: (async () =>
            jsonResponse(200, {
              content: [],
              stop_reason: 'refusal',
              stop_details: { type: 'refusal', category: null },
            })) as unknown as typeof fetch,
        },
      },
    );
    await expect(refusing.complete(REQ)).rejects.toMatchObject({ code: 'refused' });
  });

  it('Anthropic: refuses to send a conversation that does not end with a user turn', async () => {
    const fetchMock = vi.fn();
    const p = createAiProvider(
      { provider: 'anthropic', model: 'claude-opus-5-5', baseUrl: '' },
      { apiKey: KEY, deps: { fetch: fetchMock as unknown as typeof fetch } },
    );
    await expect(
      p.complete({
        ...REQ,
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'config' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries 429 honouring Retry-After, then succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'slow down' } }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, openAiOk));
    const p = createAiProvider(
      { provider: 'openrouter', model: 'a/b', baseUrl: '' },
      { apiKey: KEY, deps: { fetch: fetchMock as unknown as typeof fetch, sleep } },
    );
    await expect(p.complete(REQ)).resolves.toMatchObject({ text: 'Hi there' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000, undefined);
  });

  it('retries 5xx a bounded number of times, never retries 4xx, and never leaks the key', async () => {
    const sleep = vi.fn(async () => undefined);
    const server = vi.fn(async () => jsonResponse(503, { error: { message: `overloaded for ${KEY}` } }));
    const p1 = createAiProvider(
      { provider: 'openai', model: 'gpt-4.1-mini', baseUrl: '' },
      {
        apiKey: KEY,
        maxRetries: 2,
        deps: { fetch: server as unknown as typeof fetch, sleep, random: () => 0 },
      },
    );
    const err = (await p1.complete(REQ).catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('server');
    expect(err.message).not.toContain('SECRETKEY');
    expect(server).toHaveBeenCalledTimes(3);

    const bad = vi.fn(async () =>
      jsonResponse(401, { error: { message: 'Incorrect API key provided: sk-test-SECR****7890' } }),
    );
    const p2 = createAiProvider(
      { provider: 'openai', model: 'gpt-4.1-mini', baseUrl: '' },
      { apiKey: KEY, deps: { fetch: bad as unknown as typeof fetch, sleep } },
    );
    const err2 = (await p2.complete(REQ).catch((e: unknown) => e)) as AiError;
    expect(err2.code).toBe('auth');
    expect(err2.message).not.toMatch(/sk-test/);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('times out with a typed error (AbortController)', async () => {
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const p = createAiProvider(
      { provider: 'openai', model: 'gpt-4.1-mini', baseUrl: '' },
      { apiKey: KEY, timeoutMs: 20, deps: { fetch: hanging as unknown as typeof fetch } },
    );
    await expect(p.complete(REQ)).rejects.toMatchObject({ code: 'timeout' });
    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it('a caller abort is reported as aborted, not retried', async () => {
    const ctrl = new AbortController();
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          setTimeout(() => ctrl.abort(), 5);
        }),
    );
    const p = createAiProvider(
      { provider: 'openai', model: 'gpt-4.1-mini', baseUrl: '' },
      { apiKey: KEY, deps: { fetch: hanging as unknown as typeof fetch } },
    );
    await expect(p.complete(REQ, ctrl.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it('requires a key for hosted providers and a valid base URL for custom endpoints', () => {
    expect(() => createAiProvider({ provider: 'openai', model: 'x', baseUrl: '' }, { apiKey: null })).toThrow(
      AiError,
    );
    expect(() =>
      createAiProvider(
        { provider: 'openai_compatible', model: 'x', baseUrl: 'http://example.com/v1' },
        { apiKey: null },
      ),
    ).toThrow(/https/);
    expect(() =>
      createAiProvider(
        { provider: 'openai_compatible', model: '', baseUrl: 'http://localhost:11434/v1' },
        { apiKey: null },
      ),
    ).toThrow(/model/);
  });
});

describe('base URL and permission origins', () => {
  it('allows https anywhere and plain http only for localhost / 127.0.0.1', () => {
    expect(validateBaseUrl('http://localhost:11434/v1')).toMatchObject({
      ok: true,
      local: true,
      permissionOrigin: 'http://localhost/*',
    });
    expect(validateBaseUrl('http://127.0.0.1:1234/v1')).toMatchObject({
      ok: true,
      permissionOrigin: 'http://127.0.0.1/*',
    });
    expect(validateBaseUrl('https://llm.example.org/v1')).toMatchObject({
      ok: true,
      local: false,
      permissionOrigin: 'https://llm.example.org/*',
    });
    expect(validateBaseUrl('http://192.168.1.5:8080/v1')).toEqual({ ok: false, error: 'insecure' });
    expect(validateBaseUrl('http://example.com')).toEqual({ ok: false, error: 'insecure' });
    expect(validateBaseUrl('https://user:pass@example.com')).toEqual({ ok: false, error: 'credentials' });
    expect(validateBaseUrl('ftp://example.com')).toEqual({ ok: false, error: 'invalid' });
    expect(validateBaseUrl('not a url')).toEqual({ ok: false, error: 'invalid' });
    expect(validateBaseUrl('  ')).toEqual({ ok: false, error: 'empty' });
  });

  it('maps providers to the optional host permissions declared in the manifest', () => {
    expect(providerPermissionOrigin({ provider: 'openai', model: '', baseUrl: '' })).toBe(
      'https://api.openai.com/*',
    );
    expect(providerPermissionOrigin({ provider: 'anthropic', model: '', baseUrl: '' })).toBe(
      'https://api.anthropic.com/*',
    );
    expect(providerPermissionOrigin({ provider: 'openrouter', model: '', baseUrl: '' })).toBe(
      'https://openrouter.ai/*',
    );
    expect(
      providerPermissionOrigin({
        provider: 'openai_compatible',
        model: '',
        baseUrl: 'http://localhost:8080',
      }),
    ).toBe('http://localhost/*');
    expect(providerPermissionOrigin({ provider: 'none', model: '', baseUrl: '' })).toBeNull();
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '7' }))).toBe(7);
    expect(parseRetryAfter(new Headers({ 'retry-after-ms': '1500' }))).toBe(2);
    expect(parseRetryAfter(new Headers({ 'retry-after': new Date(10_000).toUTCString() }), 4_000)).toBe(6);
    expect(parseRetryAfter(new Headers())).toBeNull();
  });
});
