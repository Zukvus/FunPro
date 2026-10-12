import { describe, expect, it } from 'vitest';
import { FunPayActions, FunPayTransport, sanitizeOfferForm, funpayParser } from '@/adapters/funpay';
import { ContentCommandSchema } from '@/core/messaging/protocol';
import { loadFixture } from '../../fixtures';

/** Offer editor fixture with an auto-delivery goods list. */
function editorHtml(secrets: string): string {
  const html = loadFixture('offer-edit.html');
  if (!html.includes('</form>')) throw new Error('offer-edit fixture has no </form>');
  return html.replace('</form>', `<textarea name="secrets">${secrets}</textarea></form>`);
}

function fakeTransport(html: string) {
  const posts: URLSearchParams[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(new URLSearchParams(String(init.body)));
      return new Response(JSON.stringify({ error: false }), { status: 200 });
    }
    return new Response(html, { status: 200 });
  }) as unknown as typeof fetch;
  const t = new FunPayTransport({ minGapMs: 0, fetchImpl, sleepImpl: async () => undefined });
  return { t, posts };
}

describe('offer goods list (native auto-delivery)', () => {
  it('sanitizes forms for the background: no CSRF token, no goods, only their size', () => {
    const form = funpayParser.parseOfferForm(
      new DOMParser().parseFromString(editorHtml('KEY-1\nKEY-2'), 'text/html'),
    )!;
    const safe = sanitizeOfferForm(form);
    expect(safe.fields.some(([k]) => k === 'csrf_token' || k === 'secrets')).toBe(false);
    expect(safe.secretsInfo).toEqual({ count: 2, chars: 11 });
    expect(JSON.stringify(safe)).not.toContain('KEY-1');
  });

  it('appends on a fresh form, skips goods already present and enables auto-delivery', async () => {
    const { t, posts } = fakeTransport(editorHtml('KEY-1'));
    const actions = new FunPayActions(
      t,
      () => 'TESTCSRF0000',
      () => '1',
    );
    const res = await actions.appendOfferSecrets('9000001', ['KEY-1', 'KEY-2', 'KEY-3']);
    expect(res).toEqual({ ok: true, errors: [], appended: 2, duplicates: 1 });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.get('secrets')).toBe('KEY-1\nKEY-2\nKEY-3');
    expect(posts[0]!.get('auto_delivery')).toBe('on');
    expect(posts[0]!.get('offer_id')).toBe('9000001');
  });

  it('refuses offers without a goods field and oversize lists without saving', async () => {
    const { t, posts } = fakeTransport(loadFixture('offer-edit.html'));
    const actions = new FunPayActions(
      t,
      () => 'TESTCSRF0000',
      () => '1',
    );
    expect((await actions.appendOfferSecrets('9000001', ['A'])).ok).toBe(false);
    const big = fakeTransport(editorHtml('x'));
    const a2 = new FunPayActions(
      big.t,
      () => 'TESTCSRF0000',
      () => '1',
    );
    expect(
      (
        await a2.appendOfferSecrets(
          '9000001',
          ['y'.repeat(900)].concat(Array.from({ length: 30 }, (_, i) => `${i}`.padEnd(900, 'z'))),
        )
      ).ok,
    ).toBe(false);
    expect(posts).toHaveLength(0);
    expect(big.posts).toHaveLength(0);
  });

  it('the generic saveOffer command can never overwrite the goods list or the CSRF token', () => {
    const base = { action: 'saveOffer', offerId: '9000001' } as const;
    expect(ContentCommandSchema.safeParse({ ...base, changes: { price: '10' } }).success).toBe(true);
    expect(ContentCommandSchema.safeParse({ ...base, changes: { secrets: 'X' } }).success).toBe(false);
    expect(ContentCommandSchema.safeParse({ ...base, changes: { csrf_token: 'X' } }).success).toBe(false);
  });
});
