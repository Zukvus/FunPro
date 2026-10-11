/**
 * Message-sender validation. Content scripts are reachable from the page only via the DOM; still,
 * a compromised renderer could forge runtime messages, so we check:
 *  - the message comes from this extension (sender.id),
 *  - "content" methods come from a tab whose URL is on https://funpay.com,
 *  - "extension" methods come from an extension page (no tab, or a tab showing our own origin).
 */
export interface SenderLike {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id?: number; url?: string };
}

export function isFunPayUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'funpay.com' || u.hostname.endsWith('.funpay.com'));
  } catch {
    return false;
  }
}

export function classifySender(
  sender: SenderLike,
  extensionId: string,
  extensionOrigin: string,
): 'extension' | 'content' | 'untrusted' {
  if (sender.id !== extensionId) return 'untrusted';
  const url = sender.url ?? sender.tab?.url;
  if (url && url.startsWith(extensionOrigin)) return 'extension';
  if (sender.tab && isFunPayUrl(sender.url ?? sender.tab.url)) return 'content';
  if (!sender.tab && !url) return 'extension';
  return 'untrusted';
}
