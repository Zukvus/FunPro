export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Exponential backoff with full jitter, bounded by `maxMs`.
 * attempt is 1-based.
 */
export function backoffDelay(attempt: number, baseMs = 5_000, maxMs = 30 * 60_000, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
