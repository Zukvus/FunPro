/**
 * Texts for notifications generated in the background (desktop, notification center, Telegram).
 * Kept here instead of the UI i18n bundle so the service worker does not load UI code.
 */
export type NotifyLang = 'en' | 'ru' | 'uk';

const DICT = {
  en: {
    'order.title': 'New order',
    'message.title': 'New message from {name}',
    'message.titleAnon': 'New message',
    'message.hidden': 'Open the chat to read it.',
    'review.title': 'New review {stars}',
    'review.noText': 'No text',
    'failure.title': 'Automation failed',
    'inventory.title': 'Low stock',
    'inventory.body': '{pool}: {count} left',
    'price.title': 'Competitor price changed',
    'test.title': 'Test notification',
    'test.body': 'This is how FunPro alerts look and sound.',
    'tg.order': 'New order',
    'tg.message': 'New message',
    'tg.review': 'New review',
    'tg.buyer': 'Buyer',
    'tg.openOrder': 'Open order',
    'tg.openChat': 'Open chat',
    'tg.test': 'FunPro is connected. Notifications from your FunPay shop will arrive here.',
    'tg.summary': 'Daily summary',
    'tg.status': 'FunPro status',
    'tg.sales': 'Sales today',
    'tg.revenue': 'Revenue',
    'tg.refunds': 'Refunds',
    'tg.active': 'Active orders',
    'tg.unread': 'Unread chats',
    'tg.drafts': 'Drafts awaiting approval',
    'tg.failed': 'Failed tasks',
    'tg.reviews': 'New reviews',
    'tg.automation': 'Automation',
    'tg.state.running': 'running',
    'tg.state.paused': 'paused',
    'tg.state.stopped': 'emergency stop',
    'tg.stopAsk': 'Emergency stop pauses every FunPro automation. To confirm, send /stop CONFIRM within 2 minutes.',
    'tg.stopDone': 'Emergency stop is active. Resume automation from the FunPro dashboard.',
    'tg.stopExpired': 'Send /stop first, then /stop CONFIRM within 2 minutes.',
    'tg.none': 'none',
  },
  ru: {
    'order.title': 'Новый заказ',
    'message.title': 'Новое сообщение от {name}',
    'message.titleAnon': 'Новое сообщение',
    'message.hidden': 'Откройте чат, чтобы прочитать.',
    'review.title': 'Новый отзыв {stars}',
    'review.noText': 'Без текста',
    'failure.title': 'Ошибка автоматизации',
    'inventory.title': 'Заканчивается товар',
    'inventory.body': '{pool}: осталось {count}',
    'price.title': 'Конкурент изменил цену',
    'test.title': 'Тестовое уведомление',
    'test.body': 'Так выглядят и звучат уведомления FunPro.',
    'tg.order': 'Новый заказ',
    'tg.message': 'Новое сообщение',
    'tg.review': 'Новый отзыв',
    'tg.buyer': 'Покупатель',
    'tg.openOrder': 'Открыть заказ',
    'tg.openChat': 'Открыть чат',
    'tg.test': 'FunPro подключён. Уведомления вашего магазина FunPay будут приходить сюда.',
    'tg.summary': 'Итоги дня',
    'tg.status': 'Статус FunPro',
    'tg.sales': 'Продаж сегодня',
    'tg.revenue': 'Выручка',
    'tg.refunds': 'Возвраты',
    'tg.active': 'Активные заказы',
    'tg.unread': 'Непрочитанные чаты',
    'tg.drafts': 'Черновики на подтверждении',
    'tg.failed': 'Ошибки задач',
    'tg.reviews': 'Новые отзывы',
    'tg.automation': 'Автоматизация',
    'tg.state.running': 'работает',
    'tg.state.paused': 'на паузе',
    'tg.state.stopped': 'аварийная остановка',
    'tg.stopAsk': 'Аварийная остановка приостановит всю автоматизацию FunPro. Для подтверждения отправьте /stop CONFIRM в течение 2 минут.',
    'tg.stopDone': 'Аварийная остановка включена. Возобновить автоматизацию можно в панели FunPro.',
    'tg.stopExpired': 'Сначала отправьте /stop, затем /stop CONFIRM в течение 2 минут.',
    'tg.none': 'нет',
  },
  uk: {
    'order.title': 'Нове замовлення',
    'message.title': 'Нове повідомлення від {name}',
    'message.titleAnon': 'Нове повідомлення',
    'message.hidden': 'Відкрийте чат, щоб прочитати.',
    'review.title': 'Новий відгук {stars}',
    'review.noText': 'Без тексту',
    'failure.title': 'Помилка автоматизації',
    'inventory.title': 'Закінчується товар',
    'inventory.body': '{pool}: залишилось {count}',
    'price.title': 'Конкурент змінив ціну',
    'test.title': 'Тестове сповіщення',
    'test.body': 'Так виглядають і звучать сповіщення FunPro.',
    'tg.order': 'Нове замовлення',
    'tg.message': 'Нове повідомлення',
    'tg.review': 'Новий відгук',
    'tg.buyer': 'Покупець',
    'tg.openOrder': 'Відкрити замовлення',
    'tg.openChat': 'Відкрити чат',
    'tg.test': 'FunPro підключено. Сповіщення вашого магазину FunPay надходитимуть сюди.',
    'tg.summary': 'Підсумки дня',
    'tg.status': 'Статус FunPro',
    'tg.sales': 'Продажів сьогодні',
    'tg.revenue': 'Виторг',
    'tg.refunds': 'Повернення',
    'tg.active': 'Активні замовлення',
    'tg.unread': 'Непрочитані чати',
    'tg.drafts': 'Чернетки на підтвердженні',
    'tg.failed': 'Помилки задач',
    'tg.reviews': 'Нові відгуки',
    'tg.automation': 'Автоматизація',
    'tg.state.running': 'працює',
    'tg.state.paused': 'на паузі',
    'tg.state.stopped': 'аварійна зупинка',
    'tg.stopAsk': 'Аварійна зупинка призупинить усю автоматизацію FunPro. Для підтвердження надішліть /stop CONFIRM протягом 2 хвилин.',
    'tg.stopDone': 'Аварійну зупинку ввімкнено. Відновити автоматизацію можна в панелі FunPro.',
    'tg.stopExpired': 'Спочатку надішліть /stop, потім /stop CONFIRM протягом 2 хвилин.',
    'tg.none': 'немає',
  },
} as const;

export type NotifyTextKey = keyof (typeof DICT)['en'];

export function nt(lang: NotifyLang, key: NotifyTextKey, vars: Record<string, string | number> = {}): string {
  const raw: string = DICT[lang][key] ?? DICT.en[key];
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

/** Resolves the UI language setting ('auto' follows the browser) for background-generated texts. */
export function resolveNotifyLang(setting: string): NotifyLang {
  if (setting === 'en' || setting === 'ru' || setting === 'uk') return setting;
  const nav = (globalThis.navigator?.language ?? 'en').toLowerCase();
  if (nav.startsWith('ru')) return 'ru';
  if (nav.startsWith('uk')) return 'uk';
  return 'en';
}

export function starsText(stars: number | null | undefined): string {
  if (!stars || stars < 1 || stars > 5) return '';
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}
