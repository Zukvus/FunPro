import { describe, expect, it } from 'vitest';
import { hasBlockingIssue, hasConfirmPressure, hasReviewIncentive, lintText } from '@/features/messages/lint';

const ids = (text: string) => lintText(text).map((i) => i.id);

describe('contact / off-platform linter', () => {
  it.each([
    ['Write me in telegram @seller_shop', 'telegram'],
    ['Join discord.gg/abcdef', 'discord'],
    ['Call +7 912 345 67 89', 'phone'],
    ['mail me: seller@example.com', 'email'],
    ['My vk.com/seller', 'vk'],
    ['See https://example.com/offer', 'external_link'],
  ])('%s → %s', (text, id) => {
    expect(ids(text)).toContain(id);
  });

  it('allows funpay.com links and plain text', () => {
    expect(ids('Your chat: https://funpay.com/chat/?node=users-1-2')).toEqual([]);
    expect(ids('Thanks for your purchase, {buyer}!')).toEqual([]);
  });
});

describe('confirmation pressure', () => {
  it.each([
    'Подтвердите заказ, пожалуйста',
    'Сначала подтвердите заказ, потом отправлю',
    'Please confirm the order right away',
    'Confirm the order first and I will send the key',
    'Нажмите кнопку «Подтвердить выполнение заказа» сразу',
    'Підтвердіть замовлення, будь ласка',
    'Please confirm the order before I send it',
  ])('warns: %s', (text) => {
    expect(hasConfirmPressure(text)).toBe(true);
  });

  it.each([
    'После получения товара, пожалуйста, подтвердите заказ',
    'Когда всё проверите, подтвердите выполнение заказа',
    'Please confirm the order after you have received the item',
    'Once you received everything, press confirm',
    'Пожалуйста, подтвердите заказ сразу после получения',
    'Після отримання підтвердіть замовлення',
    'Thanks for the purchase! Can you confirm your server name?',
  ])('accepts: %s', (text) => {
    expect(hasConfirmPressure(text)).toBe(false);
  });
});

describe('review incentives and other checks', () => {
  it('flags bonuses for reviews', () => {
    expect(hasReviewIncentive('Бонус за отзыв 5 звезд!')).toBe(true);
    expect(hasReviewIncentive('Leave a 5 stars review and get a discount')).toBe(true);
    expect(hasReviewIncentive('Thanks for the review!')).toBe(false);
  });

  it('reports unknown variables and over-long text', () => {
    expect(lintText('Hi {buyername}')).toEqual([
      { id: 'unknown_variable', severity: 'warning', detail: '{buyername}' },
    ]);
    expect(lintText('Hi {buyername}', { checkVariables: false })).toEqual([]);
    expect(ids('x'.repeat(2001))).toContain('too_long');
  });

  it('only blocks automatic sending for risky content', () => {
    expect(hasBlockingIssue(lintText('Hi {buyername}'))).toBe(false);
    expect(hasBlockingIssue(lintText('t.me/shop'))).toBe(true);
    expect(hasBlockingIssue(lintText('Подтвердите заказ'))).toBe(true);
    expect(hasBlockingIssue(lintText('x'.repeat(2001)))).toBe(true);
  });
});
