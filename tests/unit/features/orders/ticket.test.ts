import { describe, expect, it } from 'vitest';
import { buildSupportTicketDraft, ticketEligibility } from '@/features/orders/ticket';
import { mkOrder, money } from '../analytics/dataset';

const NOW = Date.parse('2024-11-05T12:00:00.000Z');

const ORDERS = [
  mkOrder({ id: 'T1000001', status: 'paid', createdAt: '2024-11-01T07:15:00.000Z', price: money(125050), counterpartyName: 'BuyerAlpha' }),
  mkOrder({ id: 'T2000002', status: 'paid', createdAt: '2024-11-04T10:00:00.000Z', price: money(999) }), // 26 h — too recent for 72 h
  mkOrder({ id: 'T3000003', status: 'closed', createdAt: '2024-10-01T10:00:00.000Z' }),
  mkOrder({ id: 'T4000004', status: 'paid', direction: 'purchase', createdAt: '2024-10-01T10:00:00.000Z' }),
  mkOrder({ id: 'T5000005', status: 'paid', createdAt: '2024-10-30T00:00:00.000Z', price: money(4000, 'USD'), counterpartyName: 'BuyerBeta' }),
];

describe('support-ticket draft', () => {
  it('includes only paid sales older than the threshold, oldest first, and explains exclusions', () => {
    const d = buildSupportTicketDraft({ orders: ORDERS, now: NOW, minAgeHours: 72, lang: 'ru' });
    expect(d.orderIds).toEqual(['T5000005', 'T1000001']);
    expect(d.excluded).toEqual([
      { id: 'T2000002', reason: 'too_recent' },
      { id: 'T3000003', reason: 'not_paid' },
      { id: 'T4000004', reason: 'not_sale' },
    ]);
    expect(d.totalByCurrency).toEqual({ USD: 4000, RUB: 125050 });
  });

  it('renders a Russian draft with ids, Moscow dates, amounts, totals and a placeholder to complete', () => {
    const d = buildSupportTicketDraft({ orders: ORDERS, now: NOW, minAgeHours: 72, lang: 'ru' });
    expect(d.subject).toBe('Заказы не подтверждены покупателями');
    const lines = d.body.split('\n');
    expect(lines[0]).toBe('Здравствуйте!');
    expect(d.body).toContain('1. Заказ #T5000005 — оплачен 30.10.2024 03:00 (МСК), сумма 40,00 $, покупатель BuyerBeta');
    expect(d.body).toContain('2. Заказ #T1000001 — оплачен 01.11.2024 10:15 (МСК), сумма 1 250,50 ₽, покупатель BuyerAlpha');
    expect(d.body).toContain('Итого: 1 250,50 ₽ · 40,00 $');
    expect(d.body).toContain('[Опишите, когда и как был передан товар');
    expect(d.body).not.toContain('T2000002');
    // Plain text only: no invisible characters that could sneak into the support form.
    const invisible = [...d.body].some((ch) => {
      const c = ch.codePointAt(0)!;
      return c === 0xa0 || (c >= 0x200b && c <= 0x200f) || (c >= 0x2060 && c <= 0x2064);
    });
    expect(invisible).toBe(false);
  });

  it('renders an English draft and can omit buyer names', () => {
    const d = buildSupportTicketDraft({ orders: [ORDERS[0]!], now: NOW, minAgeHours: 72, lang: 'en', includeBuyerNames: false });
    expect(d.subject).toBe('Order not confirmed by the buyer');
    expect(d.body).toContain('1. Order #T1000001 — paid 01.11.2024 10:15 (Moscow time), amount 1,250.50 RUB');
    expect(d.body).not.toContain('BuyerAlpha');
    expect(d.body).toContain('Total: 1,250.50 RUB');
    expect(d.body).toContain('Could you please close the order');
  });

  it('produces nothing when no order is eligible', () => {
    const d = buildSupportTicketDraft({ orders: [ORDERS[1]!], now: NOW, minAgeHours: 72, lang: 'en' });
    expect(d).toMatchObject({ subject: '', body: '', orderIds: [] });
    expect(ticketEligibility(mkOrder({ id: 'bad id', status: 'paid' }), NOW, 1)).toBe('invalid_id');
  });
});
