import { describe, expect, it } from 'vitest';
import {
  applyOfferChanges,
  deriveCommissionPct,
  funpayParser as p,
  isAllowedPath,
  parseWaitSeconds,
} from '@/adapters/funpay';
import { fixtureDoc } from '../../fixtures';

const NOW = new Date('2024-11-05T12:00:00Z');

describe('session detection', () => {
  it('reads logged-in session from data-app-data and header', () => {
    const s = p.parseSession(fixtureDoc('sales.html'), 1);
    expect(s.status).toBe('logged_in');
    expect(s.userId).toBe('1000001');
    expect(s.username).toBe('SellerOne');
    expect(s.locale).toBe('ru');
    expect(s.csrfToken).toBe('TESTCSRF0000');
    expect(s.activeSales).toBe(2);
    expect(s.balanceText).toContain('1 520.40');
  });

  it('treats userId 0 as logged out', () => {
    const s = p.parseSession(fixtureDoc('public-node.html'));
    expect(s.status).toBe('logged_out');
    expect(s.userId).toBeNull();
  });

  it('returns unknown when the page has no app data', () => {
    const doc = new DOMParser().parseFromString('<body><p>maintenance</p></body>', 'text/html');
    expect(p.parseSession(doc).status).toBe('unknown');
  });

  it('survives malformed app data', () => {
    const doc = new DOMParser().parseFromString('<body data-app-data="{not json"></body>', 'text/html');
    expect(p.parseSession(doc).status).toBe('unknown');
  });
});

describe('orders', () => {
  it('parses sales rows with status, buyer, price and pagination token', () => {
    const { orders, continueToken } = p.parseOrders(fixtureDoc('sales.html'), 'sale', NOW);
    expect(continueToken).toBe('NEXTPAGE01');
    expect(orders.map((o) => [o.id, o.status])).toEqual([
      ['AAAA1111', 'paid'],
      ['BBBB2222', 'refunded'],
      ['CCCC3333', 'closed'],
    ]);
    const a = orders[0]!;
    expect(a.counterpartyName).toBe('BuyerAlpha');
    expect(a.counterpartyId).toBe('2000001');
    expect(a.description).toBe('Test item alpha, 1 шт.');
    expect(a.categoryName).toBe('Game A, Accounts');
    expect(a.price).toEqual({ amountMinor: 125050, currency: 'RUB' });
    // "сегодня, 10:15" Moscow time → 07:15 UTC
    expect(a.createdAt).toBe('2024-11-05T07:15:00.000Z');
    expect(orders[2]!.price).toEqual({ amountMinor: 4000, currency: 'USD' });
    // "20 января" without year in November → January of the same year
    expect(orders[2]!.createdAt).toBe('2024-01-20T20:11:00.000Z');
  });
});

describe('listings', () => {
  it('parses own lots page with raise target, activity, stock and auto-delivery', () => {
    const { listings, raise } = p.parseOwnLotsPage(fixtureDoc('own-lots.html'), '501');
    expect(raise).toEqual({ gameId: '41', nodeId: '501' });
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      id: '9000001',
      nodeId: '501',
      gameId: '41',
      active: true,
      amount: 5,
      autoDelivery: true,
      price: { amountMinor: 19999, currency: 'RUB' },
    });
    expect(listings[1]).toMatchObject({
      id: '9000002',
      active: false,
      amount: 1,
      price: { amountMinor: 149900 },
    });
  });

  it('parses profile offers grouped by category with promo flag', () => {
    const l = p.parseProfileOffers(fixtureDoc('profile.html'));
    expect(l.map((x) => [x.id, x.nodeId, x.categoryName])).toEqual([
      ['9000001', '501', 'Game A Accounts'],
      ['9000003', '777', 'Game C Boosting'],
    ]);
    expect(l[1]!.promoted).toBe(true);
    expect(l[1]!.price).toEqual({ amountMinor: 550, currency: 'USD' });
  });

  it('parses public competitor offers', () => {
    const offers = p.parsePublicOffers(fixtureDoc('public-node.html'), '501');
    expect(offers).toHaveLength(3);
    expect(offers[0]).toMatchObject({
      offerId: '7000001',
      sellerName: 'CompOne',
      sellerId: '3000001',
      online: true,
      promoted: true,
      rating: 4,
      reviewCount: 1204,
      amount: 100,
    });
    expect(offers[1]).toMatchObject({ offerId: '7000002', online: null, price: { amountMinor: 20500 } });
  });
});

describe('reviews', () => {
  it('parses stars, order, author, text and seller reply; skips anonymous', () => {
    const r = p.parseReviews(fixtureDoc('profile.html'), NOW);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      orderId: 'CCCC3333',
      stars: 5,
      authorName: 'BuyerAlpha',
      text: 'Fast and smooth, thanks!',
      sellerReply: null,
    });
    expect(r[0]!.at).toBe('2024-08-11T15:12:00.000Z');
    expect(r[1]).toMatchObject({ orderId: 'BBBB2222', stars: 2, sellerReply: 'Sorry for the delay!' });
  });
});

describe('finance', () => {
  it('classifies operations and signs', () => {
    const ops = p.parseFinance(fixtureDoc('balance.html'), NOW);
    expect(ops.map((o) => [o.id, o.kind, o.amount.amountMinor, o.status, o.orderId])).toEqual([
      ['50000001', 'income', 112000, 'complete', 'AAAA1111'],
      ['50000002', 'expense', 6852, 'complete', 'DDDD4444'],
      ['50000003', 'withdrawal', 50000, 'waiting', null],
      ['50000004', 'deposit', 5720, 'complete', null],
    ]);
  });
});

describe('chats', () => {
  it('parses chat list with unread state', () => {
    const chats = p.parseChatList(fixtureDoc('chat.html'), NOW);
    expect(chats.map((c) => [c.id, c.partnerName, c.unread])).toEqual([
      ['users-1000001-2000001', 'BuyerAlpha', true],
      ['users-1000001-2000002', 'BuyerBeta', false],
    ]);
  });

  it('distinguishes system, own and customer messages', () => {
    const msgs = p.parseChatMessages(fixtureDoc('chat.html'), 'users-1000001-2000001', '1000001', NOW);
    expect(msgs.map((m) => [m.id, m.kind])).toEqual([
      ['88000001', 'system'],
      ['88000002', 'self'],
      ['88000003', 'customer'],
    ]);
    expect(msgs[2]!.authorId).toBe('2000001');
  });

  it('parses /chat/history JSON with numeric authors (0 = FunPay)', () => {
    const json = {
      chat: {
        node: { id: 1 },
        messages: [
          {
            id: 5,
            author: 0,
            html: '<div class="chat-msg-item"><div class="chat-msg-text">Покупатель X оплатил заказ #ZZZZ9999.</div></div>',
          },
          {
            id: 6,
            author: 2000001,
            html: '<div class="chat-msg-item"><a class="chat-msg-author-link" href="https://funpay.com/users/2000001/">BuyerAlpha</a><div class="chat-msg-text">hi <img src=x onerror=alert(1)></div></div>',
          },
          {
            id: 7,
            author: 1000001,
            html: '<div class="chat-msg-item"><div class="chat-msg-text">hello</div></div>',
          },
          { bogus: true },
        ],
      },
    };
    const msgs = p.parseChatHistoryJson(json, 'c1', '1000001');
    expect(msgs.map((m) => [m.id, m.kind, m.text])).toEqual([
      ['5', 'system', 'Покупатель X оплатил заказ #ZZZZ9999.'],
      ['6', 'customer', 'hi'],
      ['7', 'self', 'hello'],
    ]);
  });

  it('returns nothing for malformed history', () => {
    expect(p.parseChatHistoryJson(null, 'c', null)).toEqual([]);
    expect(p.parseChatHistoryJson({ chat: { messages: 'x' } }, 'c', null)).toEqual([]);
  });
});

describe('system messages', () => {
  it.each([
    ['Покупатель BuyerAlpha оплатил заказ #AAAA1111. Item', 'order_paid', 'AAAA1111'],
    [
      'Покупатель BuyerAlpha подтвердил успешное выполнение заказа #AAAA1111 и отправил деньги продавцу SellerOne.',
      'order_confirmed',
      'AAAA1111',
    ],
    ['Покупатель BuyerAlpha написал отзыв к заказу #AAAA1111.', 'review_new', 'AAAA1111'],
    ['Продавец SellerOne вернул деньги покупателю BuyerAlpha по заказу #AAAA1111.', 'refund', 'AAAA1111'],
    ['Заказ #AAAA1111 открыт повторно.', 'order_reopened', 'AAAA1111'],
  ])('%s → %s', (text, type, orderId) => {
    expect(p.classifySystemMessage(text)).toMatchObject({ type, orderId });
  });

  it('extracts buyer name for paid orders and ignores normal text', () => {
    expect(p.classifySystemMessage('Покупатель BuyerAlpha оплатил заказ #AAAA1111.')?.buyerName).toBe(
      'BuyerAlpha',
    );
    expect(p.classifySystemMessage('hello, what is the price?')).toBeNull();
  });
});

describe('raise', () => {
  it('parses success, cooldown, modal, redirect, http errors', () => {
    expect(p.parseRaiseResponse(200, { error: false, msg: 'Предложения подняты' })).toMatchObject({
      kind: 'raised',
    });
    expect(p.parseRaiseResponse(200, { error: true, msg: 'Подождите 3 часа.' })).toEqual({
      kind: 'cooldown',
      message: 'Подождите 3 часа.',
      waitSec: 9000,
    });
    expect(
      p.parseRaiseResponse(200, { error: true, msg: 'Please wait 20 minutes.', wait: 1180 }),
    ).toMatchObject({ kind: 'cooldown', waitSec: 1180 });
    expect(
      p.parseRaiseResponse(200, {
        modal:
          '<div class="checkbox"><label><input type="checkbox" value="501" checked></label></div><div class="checkbox"><input type="checkbox" value="502"></div>',
      }),
    ).toEqual({
      kind: 'needs_selection',
      nodeIds: ['501', '502'],
    });
    expect(p.parseRaiseResponse(200, { url: 'https://funpay.com/' })).toMatchObject({
      kind: 'rejected',
      waitSec: 7200,
    });
    expect(p.parseRaiseResponse(429, null)).toMatchObject({ kind: 'cooldown' });
    expect(p.parseRaiseResponse(403, null)).toMatchObject({ kind: 'error' });
    expect(p.parseRaiseResponse(200, 'garbage')).toMatchObject({ kind: 'error' });
  });

  it('parses wait times conservatively', () => {
    expect(parseWaitSeconds('Подождите 30 секунд')).toBe(30);
    expect(parseWaitSeconds('Подождите 5 минут')).toBe(240);
    expect(parseWaitSeconds('Please wait 1 hour')).toBe(1800);
    expect(parseWaitSeconds('Зачекайте 2 години')).toBe(5400);
    expect(parseWaitSeconds('no digits')).toBeNull();
  });
});

describe('offer form', () => {
  it('serialises like a browser (checked boxes only, no files/disabled)', () => {
    const form = p.parseOfferForm(fixtureDoc('offer-edit.html'))!;
    expect(form.offerId).toBe('9000001');
    expect(form.nodeId).toBe('501');
    expect(form.currencyText).toBe('₽');
    const names = form.fields.map(([k]) => k);
    expect(names).toContain('active');
    expect(names).not.toContain('auto_delivery');
    expect(names).not.toContain('ignored_file');
    expect(names).not.toContain('disabled_field');
    expect(form.fields.find(([k]) => k === 'fields[server]')![1]).toBe('2');
    expect(form.fields.find(([k]) => k === 'fields[desc][ru]')![1]).toBe('Описание лота');
    expect(form.buyerPrices).toEqual([
      { method: 'Карта', priceText: '215.99 ₽' },
      { method: 'СБП', priceText: '211.00 ₽' },
    ]);
  });

  it('applies changes, unchecks checkboxes and protects identity fields', () => {
    const form = p.parseOfferForm(fixtureDoc('offer-edit.html'))!;
    const out = applyOfferChanges(form, {
      price: '249.00',
      active: '',
      'fields[summary][en]': 'Starter account',
    });
    expect(out.find(([k]) => k === 'price')![1]).toBe('249.00');
    expect(out.some(([k]) => k === 'active')).toBe(false);
    expect(out.find(([k]) => k === 'fields[summary][en]')![1]).toBe('Starter account');
    expect(out.find(([k]) => k === 'offer_id')![1]).toBe('9000001');
    expect(() => applyOfferChanges(form, { offer_id: '1' })).toThrow();
    expect(() => applyOfferChanges(form, { deleted: '1' })).toThrow();
    expect(
      applyOfferChanges(form, { deleted: '1' }, true).some(([k, v]) => k === 'deleted' && v === '1'),
    ).toBe(true);
  });

  it('returns null without an editor form', () => {
    expect(p.parseOfferForm(fixtureDoc('sales.html'))).toBeNull();
  });
});

describe('commission', () => {
  it('derives commission from the cheapest same-currency method', () => {
    expect(
      deriveCommissionPct(
        100,
        [
          { name: 'card', priceMinor: 11000, currency: 'RUB' },
          { name: 'sbp', priceMinor: 10800, currency: 'RUB' },
          { name: 'usd', priceMinor: 120, currency: 'USD' },
        ],
        'RUB',
      ),
    ).toBe(8);
    expect(deriveCommissionPct(100, [])).toBeNull();
    expect(deriveCommissionPct(0, [{ name: 'x', priceMinor: 1, currency: 'RUB' }])).toBeNull();
  });
});

describe('transport allow-list', () => {
  it('allows only known read/write endpoints', () => {
    expect(isAllowedPath('GET', '/orders/trade')).toBe(true);
    expect(isAllowedPath('GET', '/chat/history?node=users-1-2&last_message=-1')).toBe(true);
    expect(isAllowedPath('POST', '/lots/raise')).toBe(true);
    expect(isAllowedPath('POST', '/orders/refund')).toBe(false);
    expect(isAllowedPath('POST', '/withdraw/withdraw')).toBe(false);
    expect(isAllowedPath('POST', '/account/switchCurrency')).toBe(false);
    expect(isAllowedPath('GET', '//evil.com/x')).toBe(false);
    expect(isAllowedPath('GET', 'https://evil.com/')).toBe(false);
    expect(isAllowedPath('GET', '/account/logout')).toBe(false);
    // Researched pagination endpoints FunPro does not use stay closed (least privilege).
    expect(isAllowedPath('POST', '/users/transactions')).toBe(false);
    expect(isAllowedPath('POST', '/users/reviews')).toBe(false);
  });
});
