/**
 * Redaction for anything that may end up in logs, diagnostics or notifications.
 * We redact by key name (credentials) and by value shape (cookie-like secrets).
 */
const SENSITIVE_KEY =
  /(token|secret|password|passwd|cookie|golden|phpsessid|csrf|authorization|api[-_]?key|apikey|session|inventory|item|cipher|plaintext)/i;
const LONG_HEX_OR_ALNUM = /\b[a-z0-9]{32,}\b/gi;
const BOT_TOKEN = /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SK_KEY = /\bsk-[A-Za-z0-9_-]{10,}\b/g;

export function redactString(value: string, maxLen = 500): string {
  let out = value
    .replace(BOT_TOKEN, '[redacted-token]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(SK_KEY, '[redacted-key]')
    .replace(LONG_HEX_OR_ALNUM, '[redacted]')
    .replace(/golden_key=[^;\s]*/gi, 'golden_key=[redacted]')
    .replace(/PHPSESSID=[^;\s]*/gi, 'PHPSESSID=[redacted]');
  if (out.length > maxLen) out = `${out.slice(0, maxLen)}…`;
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
