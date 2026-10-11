/**
 * Site-derived content is always treated as untrusted text. FunPro renders it with React (which
 * escapes by default) or `textContent` — never as HTML. These helpers normalise text extracted
 * from FunPay markup and make outgoing text safe.
 */

// Intentionally strips control and bidi/zero-width characters.
const CONTROL_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2060-\u2064\u200b-\u200f\u202a-\u202e]/g;

export function cleanText(input: string | null | undefined, maxLen = 10_000): string {
  if (!input) return '';
  const out = input.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

/** Like cleanText but preserves newlines (for message bodies). */
export function cleanMultiline(input: string | null | undefined, maxLen = 20_000): string {
  if (!input) return '';
  const out = input
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

/** Only allow http(s) URLs pointing at funpay.com for links we render. */
export function safeFunPayUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, 'https://funpay.com/');
    if (u.protocol !== 'https:' || (u.hostname !== 'funpay.com' && !u.hostname.endsWith('.funpay.com')))
      return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * FunPay forbids exchanging contact details / moving conversations off-platform.
 * This linter warns the seller when a template appears to contain contacts or external links.
 */
const CONTACT_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'telegram', re: /(t\.me\/|telegram\.me\/|@[a-z0-9_]{4,}\b|\btg\b|телеграм|telegram)/i },
  { id: 'discord', re: /(discord\.gg|discord\.com\/invite|\bdiscord\b|дискорд)/i },
  { id: 'phone', re: /(\+?\d[\d\s()-]{9,}\d)/ },
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { id: 'vk', re: /(vk\.com\/|\bвк\b|вконтакте|whatsapp|ватсап|viber|вайбер|skype)/i },
  { id: 'external_link', re: /https?:\/\/(?!([a-z0-9-]+\.)*funpay\.com)[^\s]+/i },
];

export function lintOutgoingText(text: string): string[] {
  return CONTACT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
}
