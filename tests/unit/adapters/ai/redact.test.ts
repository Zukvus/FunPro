import { describe, expect, it } from 'vitest';
import { redactForAi, redactForAiReversible, restorePlaceholder } from '@/adapters/ai';

describe('redactForAi', () => {
  it('removes order ids and FunPay links', () => {
    const out = redactForAi(
      'Заказ #ABCD1234 тут https://funpay.com/orders/ABCD1234/ и https://funpay.com/users/123456/ и /chat/?node=users-1-2',
    );
    expect(out).not.toMatch(/ABCD1234|123456|users-1-2/);
    expect(out).toContain('#[order]');
    expect(out).toContain('[order-link]');
    expect(out).toContain('[user-link]');
  });

  it('removes chat node ids, labelled user ids, e-mails, phones and card numbers', () => {
    const out = redactForAi(
      'chat users-111-222, my id: 7654321, mail me at john.doe+x@mail.example.com, call +7 (999) 123-45-67, card 4276 1234 5678 9012',
    );
    expect(out).toContain('[chat]');
    expect(out).toContain('[user-id]');
    expect(out).toContain('[email]');
    expect(out).toContain('[phone]');
    expect(out).toContain('[number]');
    expect(out).not.toMatch(/7654321|john\.doe|999|4276/);
  });

  it('keeps prices, dates and times intact', () => {
    const text = 'Цена 1 250.50 ₽, заказ от 12.03.2024 14:05, буду в 10:00-12:00';
    expect(redactForAi(text)).toBe(text);
  });

  it('removes credentials, activation keys and tokens', () => {
    const out = redactForAi(
      'login: buyer_acc pass steamuser:hunter2pass key ABCD1-EFGH2-IJKL3 token 123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKKl sk-proj-abcdefghijklmnop',
    );
    expect(out).toContain('[credentials]');
    expect(out).toContain('[key]');
    expect(out).not.toMatch(/hunter2pass|ABCD1-EFGH2|AAAbbbCCC|abcdefghijklmnop/);
  });

  it('replaces names only when asked, as whole words, in any script', () => {
    const text = 'Привет, Ivan_Petrov! Иван, ваш заказ готов. Ivan_Petrovich и Иванов не трогаем.';
    const names = [
      { name: 'Ivan_Petrov', placeholder: '[buyer]' },
      { name: 'Иван', placeholder: '[buyer]' },
    ];
    const out = redactForAi(text, { names });
    expect(out).toBe('Привет, [buyer]! [buyer], ваш заказ готов. Ivan_Petrovich и Иванов не трогаем.');
    expect(redactForAi(text)).toBe(text);
    expect(restorePlaceholder('Hi [buyer]!', '[buyer]', 'Ivan')).toBe('Hi Ivan!');
  });

  it('reversible redaction restores references locally but never credentials', () => {
    const { text, restore } = redactForAiReversible('Order #QWER1234 — write to a@b.co, steam:secretpass');
    expect(text).not.toMatch(/QWER1234|a@b\.co|secretpass/);
    expect(text).toMatch(/\[ref1\].*\[ref2\]/);
    const translated = text.replace('Order', 'Заказ');
    expect(restore(translated)).toBe('Заказ #QWER1234 — write to a@b.co, [credentials]');
  });
});
