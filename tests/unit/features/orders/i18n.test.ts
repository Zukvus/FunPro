import { describe, expect, it } from 'vitest';
import ordersLocale from '@/ui/i18n/locales/orders';
import { ORDERS_PAGE_STRINGS } from '@/content/enhancements/orders/strings';
import { hasTranslation, translate } from '@/ui/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('orders / analytics / finance / overview translations', () => {
  const en = ordersLocale.en as Record<string, string>;
  const ru = ordersLocale.ru as Record<string, string>;
  const uk = ordersLocale.uk as Record<string, string>;

  it('has the same keys in en, ru and uk', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(uk).sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps the same {placeholders} in every language and has no empty strings', () => {
    for (const key of Object.keys(en)) {
      for (const dict of [ru, uk]) {
        expect(dict[key], key).toBeTruthy();
        expect(placeholders(dict[key]!), key).toEqual(placeholders(en[key]!));
      }
    }
  });

  it('is registered in the global dictionary', () => {
    expect(hasTranslation('ru', 'orders.tab.unconfirmed')).toBe(true);
    expect(translate('uk', 'orders.copy.idCopied', { id: 'AAAA1111' })).toBe('Номер #AAAA1111 скопійовано');
  });

  it('on-page strings exist in every language with the same placeholders', () => {
    const keys = Object.keys(ORDERS_PAGE_STRINGS.en) as (keyof typeof ORDERS_PAGE_STRINGS.en)[];
    for (const lang of ['ru', 'uk'] as const) {
      expect(Object.keys(ORDERS_PAGE_STRINGS[lang]).sort()).toEqual([...keys].sort());
      for (const k of keys) expect(placeholders(ORDERS_PAGE_STRINGS[lang][k])).toEqual(placeholders(ORDERS_PAGE_STRINGS.en[k]));
    }
  });
});
