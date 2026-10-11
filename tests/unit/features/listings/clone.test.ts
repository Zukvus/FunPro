import { beforeEach, describe, expect, it } from 'vitest';
import { FunPayActions, FunPayTransport, funpayParser, isAllowedPath } from '@/adapters/funpay';
import { offerSaveResult } from '@/adapters/funpay/v1/actions';
import { resetDbForTests } from '@/core/db/db';
import {
  buildCloneChanges,
  deleteTemplate,
  isClonableChangeKey,
  listTemplates,
  saveTemplate,
} from '@/features/listings/clone';
import { sanitizeOfferForm } from '@/features/listings/offer-form';
import { fixtureDoc, loadFixture } from '../../../fixtures';

interface Req {
  method: string;
  path: string;
  body: URLSearchParams | null;
}

function harness(routes: Record<string, () => Response>) {
  const requests: Req[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = String(url).replace('https://funpay.com', '');
    const method = init?.method ?? 'GET';
    requests.push({
      method,
      path,
      body: typeof init?.body === 'string' ? new URLSearchParams(init.body) : null,
    });
    const route = routes[`${method} ${path}`];
    return route ? route() : new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const transport = new FunPayTransport({ fetchImpl, minGapMs: 0, sleepImpl: async () => undefined });
  return {
    requests,
    actions: new FunPayActions(
      transport,
      () => 'TESTCSRF0000',
      () => '1000001',
    ),
  };
}

const html = (name: string) => () => new Response(loadFixture(name), { status: 200 });
const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetDbForTests();
});

describe('blank offer form (offer_id=0)', () => {
  it('is allow-listed precisely', () => {
    expect(isAllowedPath('GET', '/lots/offerEdit?node=501')).toBe(true);
    expect(isAllowedPath('GET', '/en/lots/offerEdit?node=501')).toBe(true);
    expect(isAllowedPath('GET', '/lots/offerEdit?node=501&x=1')).toBe(false);
    expect(isAllowedPath('GET', '/lots/offerEdit?node=abc')).toBe(false);
  });

  it('parses the fixture as a blank form for its node', () => {
    const f = funpayParser.parseOfferForm(fixtureDoc('listings-offer-new.html'))!;
    expect(f).toMatchObject({ offerId: '0', nodeId: '501', currencyText: '₽' });
    expect(f.fields.find(([k]) => k === 'active')).toEqual(['active', 'on']);
  });
});

describe('cloning', () => {
  it('copies an own offer into a new, inactive offer without auto-delivery goods', async () => {
    const { actions, requests } = harness({
      'GET /lots/offerEdit?offer=9000005': html('listings-offer-autodelivery.html'),
      'GET /lots/offerEdit?node=501': html('listings-offer-new.html'),
      'POST /lots/offerSave': json({ error: false, url: 'https://funpay.com/lots/offer?id=9000099' }),
    });
    const source = sanitizeOfferForm(await actions.getOfferForm('9000005'));
    expect(source.hasSecrets).toBe(true);
    expect(source.fields.some(([k]) => k === 'csrf_token' || k === 'secrets')).toBe(false);

    const plan = buildCloneChanges(source.fields, { activate: false }, source.hasSecrets);
    expect(plan.changes).toMatchObject({
      'fields[summary][ru]': 'Ключ активации',
      'fields[desc][en]': 'Instant delivery',
      'fields[server]': '2',
      price: '349.50',
      amount: '3',
      active: '',
      auto_delivery: '',
      deactivate_after_sale: 'on',
    });
    expect(Object.keys(plan.changes).some((k) => !isClonableChangeKey(k))).toBe(false);
    expect(plan.excluded.sort()).toEqual(['fields[platform][]', 'secrets']);
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        'inactive_copy',
        'auto_delivery_off',
        'secrets_not_copied',
        'multi_value_skipped',
      ]),
    );

    const res = await actions.createOffer('501', plan.changes);
    expect(res).toEqual({ ok: true, errors: [], offerId: '9000099' });
    const post = requests.find((r) => r.method === 'POST')!;
    expect(post.path).toBe('/lots/offerSave');
    const body = post.body!;
    expect(body.get('offer_id')).toBe('0');
    expect(body.get('node_id')).toBe('501');
    expect(body.get('csrf_token')).toBe('TESTCSRF0000');
    expect(body.get('fields[summary][ru]')).toBe('Ключ активации');
    expect(body.get('price')).toBe('349.50');
    expect(body.has('active')).toBe(false); // unchecked → inactive copy
    expect(body.has('auto_delivery')).toBe(false);
    expect(body.get('deactivate_after_sale')).toBe('on');
    expect(body.get('secrets')).toBe(''); // the blank form's empty goods list, never the source's
    expect(body.toString()).not.toContain('KEY-AAAA');
  });

  it('activates the copy only on request and applies templates and overrides last', () => {
    const source = sanitizeOfferForm(funpayParser.parseOfferForm(fixtureDoc('offer-edit.html'))!);
    const tpl = {
      id: 'tpl_1',
      name: 'EN',
      createdAt: 1,
      updatedAt: 1,
      fields: { 'fields[summary][en]': 'Template title', price: '10.00' },
    };
    const plan = buildCloneChanges(source.fields, {
      activate: true,
      template: tpl,
      overrides: { price: '12.00' },
    });
    expect(plan.changes).toMatchObject({
      active: 'on',
      'fields[summary][en]': 'Template title',
      price: '12.00',
    });
    expect(plan.warnings).toEqual(['template_applied']);
  });

  it('refuses anything that is not a blank form for exactly that node', async () => {
    const { actions, requests } = harness({
      'GET /lots/offerEdit?node=777': html('offer-edit.html'),
      'GET /lots/offerEdit?node=502': html('listings-offer-new.html'),
    });
    await expect(actions.createOffer('777', {})).rejects.toThrow(/blank offer form/);
    await expect(actions.createOffer('502', {})).rejects.toThrow(/mismatch/);
    await expect(actions.createOffer('1; DROP', {})).rejects.toThrow(/Invalid node id/);
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('never lets a copy override identity fields', async () => {
    const { actions } = harness({ 'GET /lots/offerEdit?node=501': html('listings-offer-new.html') });
    await expect(actions.createOffer('501', { offer_id: '9000001' })).rejects.toThrow(/cannot be changed/);
    await expect(actions.createOffer('501', { deleted: '1' })).rejects.toThrow(/cannot be changed/);
    expect(isClonableChangeKey('secrets')).toBe(false);
    expect(isClonableChangeKey('fields[summary][ru]')).toBe(true);
  });

  it('reports FunPay validation errors', async () => {
    const { actions } = harness({
      'GET /lots/offerEdit?node=501': html('listings-offer-new.html'),
      'POST /lots/offerSave': json({ error: true, errors: [['price', 'Укажите цену']] }),
    });
    expect(await actions.createOffer('501', {})).toEqual({
      ok: false,
      errors: ['price: Укажите цену'],
      offerId: null,
    });
    expect(offerSaveResult(500, null)).toEqual({ ok: false, errors: ['HTTP 500'] });
    expect(offerSaveResult(200, { error: true, msg: 'Bad' })).toEqual({ ok: false, errors: ['Bad'] });
    expect(offerSaveResult(200, { error: true })).toEqual({
      ok: false,
      errors: ['FunPay rejected the offer'],
    });
  });
});

describe('deletion path', () => {
  it('posts deleted=1 for the requested own offer only', async () => {
    const { actions, requests } = harness({
      'GET /lots/offerEdit?offer=9000001': html('offer-edit.html'),
      'POST /lots/offerSave': json({ error: false }),
    });
    expect(await actions.deleteOffer('9000001')).toEqual({ ok: true, errors: [] });
    const body = requests.find((r) => r.method === 'POST')!.body!;
    expect(body.get('deleted')).toBe('1');
    expect(body.get('offer_id')).toBe('9000001');
  });
});

describe('listing templates', () => {
  it('saves, lists and deletes templates in kv', async () => {
    const t = await saveTemplate(
      { name: '  Steam keys  ', fields: { 'fields[summary][en]': 'Key', price: '', amount: '1' } },
      5,
    );
    expect(t).toMatchObject({
      name: 'Steam keys',
      createdAt: 5,
      fields: { 'fields[summary][en]': 'Key', amount: '1' },
    });
    expect(t.fields.price).toBeUndefined();
    const updated = await saveTemplate({ id: t.id, name: 'Keys', fields: {} }, 9);
    expect(updated).toMatchObject({ createdAt: 5, updatedAt: 9 });
    expect((await listTemplates()).map((x) => x.name)).toEqual(['Keys']);
    await deleteTemplate(t.id);
    expect(await listTemplates()).toEqual([]);
    await expect(saveTemplate({ name: ' ', fields: {} })).rejects.toThrow();
  });
});
