/**
 * Title similarity for "comparable offer" detection. FunPay's data-f filters are not available to
 * FunPro, so offers of the same node are compared by title-token overlap (Jaccard).
 */
const STOPWORDS = new Set([
  'и',
  'в',
  'на',
  'с',
  'для',
  'по',
  'из',
  'от',
  'до',
  'за',
  'или',
  'без',
  'шт',
  'the',
  'and',
  'for',
  'of',
  'with',
  'to',
  'in',
  'on',
  'or',
  'pcs',
  'a',
  'an',
  'та',
  'з',
  'у',
  'від',
  'або',
]);

export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    if (raw.length < 2 && !/\d/.test(raw)) continue;
    out.add(raw);
  }
  return out;
}

/** Jaccard similarity of title tokens in [0, 1]; two empty titles are considered identical. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}
