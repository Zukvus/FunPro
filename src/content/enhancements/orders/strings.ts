/**
 * On-page strings for the orders helper. Kept tiny and separate from the dashboard locale file so
 * the content script (loaded on every funpay.com page) stays small.
 */
export type PageLang = 'ru' | 'en' | 'uk';

export const ORDERS_PAGE_STRINGS = {
  ru: {
    copyId: 'Скопировать номер заказа {id}',
    copied: 'Скопировано',
    copyFailed: 'Не удалось скопировать',
    copyUnconfirmed: 'Скопировать неподтверждённые ({count})',
    copiedUnconfirmed: 'Скопировано номеров: {count}',
    noUnconfirmed: 'Неподтверждённых заказов на странице нет',
    toolbarLabel: 'FunPro: заказы',
  },
  uk: {
    copyId: 'Скопіювати номер замовлення {id}',
    copied: 'Скопійовано',
    copyFailed: 'Не вдалося скопіювати',
    copyUnconfirmed: 'Скопіювати непідтверджені ({count})',
    copiedUnconfirmed: 'Скопійовано номерів: {count}',
    noUnconfirmed: 'Непідтверджених замовлень на сторінці немає',
    toolbarLabel: 'FunPro: замовлення',
  },
  en: {
    copyId: 'Copy order number {id}',
    copied: 'Copied',
    copyFailed: 'Could not copy',
    copyUnconfirmed: 'Copy unconfirmed IDs ({count})',
    copiedUnconfirmed: 'Copied {count} order number(s)',
    noUnconfirmed: 'No unconfirmed orders on this page',
    toolbarLabel: 'FunPro: orders',
  },
} as const satisfies Record<PageLang, Record<string, string>>;

export type PageStringKey = keyof (typeof ORDERS_PAGE_STRINGS)['en'];

export function pageText(lang: PageLang, key: PageStringKey, vars: Record<string, string | number> = {}): string {
  return ORDERS_PAGE_STRINGS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
