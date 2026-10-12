/**
 * Last line of defence before text leaves for Telegram. Removes:
 *  - known secret values (bot token, AI key) verbatim;
 *  - secret/credential/contact shapes (keys, tokens, login:password, e-mails, phones, card numbers);
 *  - any fragment whose SHA-256 equals a stored inventory item fingerprint — inventory items
 *    (delivered goods) must never be forwarded, even if another module put one into a notification.
 */
import { redactForAi } from '@/adapters/ai';
import { HIDDEN, redactInventoryItems } from '@/features/inventory/redact';

export { HIDDEN, redactInventoryItems };

export function stripSensitive(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const s of knownSecrets) if (s && s.length >= 6) out = out.split(s).join(HIDDEN);
  return redactForAi(out);
}

export async function sanitizeForTelegram(
  text: string | null | undefined,
  knownSecrets: readonly string[] = [],
): Promise<string> {
  if (!text) return '';
  // Inventory matching runs on the original text: pattern redaction could otherwise alter a
  // multi-word item just enough that its fingerprint no longer matches.
  const withoutItems = await redactInventoryItems(text);
  return stripSensitive(withoutItems, knownSecrets).replace(/\s+\n/g, '\n').trim();
}
