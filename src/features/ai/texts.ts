/**
 * Deterministic fallback texts for the copilot (used when AI is off, unavailable or fails).
 * They follow the same rules as the AI prompts: no refund promises, no binding commitments,
 * no off-platform contacts, never ask to confirm an order before delivery, never ask for reviews.
 */
import type { CopilotLang, QuestionCategory } from './heuristics';

type Localized = Record<CopilotLang, string>;

export const GENERIC_REPLIES: Record<QuestionCategory, Localized> = {
  pre_sale: {
    ru: 'Здравствуйте! Подскажу. Уточните, пожалуйста, что именно вас интересует, и я отвечу как можно скорее.',
    en: 'Hello! Happy to help. Could you tell me exactly what you need? I will answer as soon as possible.',
    uk: 'Вітаю! Підкажу. Уточніть, будь ласка, що саме вас цікавить, і я відповім якнайшвидше.',
  },
  delivery: {
    ru: 'Здравствуйте! Вижу ваш заказ — сейчас проверю и вернусь с ответом в ближайшее время.',
    en: 'Hello! I can see your order — I am checking it now and will get back to you shortly.',
    uk: 'Вітаю! Бачу ваше замовлення — зараз перевірю і незабаром повернуся з відповіддю.',
  },
  problem: {
    ru: 'Здравствуйте! Жаль, что возникла проблема. Опишите, пожалуйста, подробнее, что происходит (можно со скриншотом), — я разберусь.',
    en: 'Hello! Sorry to hear there is a problem. Please describe what happens in more detail (a screenshot helps) and I will look into it.',
    uk: 'Вітаю! Шкода, що виникла проблема. Опишіть, будь ласка, детальніше, що відбувається (можна зі скриншотом), — я розберуся.',
  },
  refund_request: {
    ru: 'Здравствуйте! Сообщение получено. Опишите, пожалуйста, что пошло не так, — я проверю заказ и отвечу здесь.',
    en: 'Hello! Your message is received. Please tell me what went wrong — I will check the order and reply here.',
    uk: 'Вітаю! Повідомлення отримано. Опишіть, будь ласка, що пішло не так, — я перевірю замовлення і відповім тут.',
  },
  review: {
    ru: 'Спасибо, что написали! Если по заказу что-то нужно уточнить или исправить, напишите — помогу.',
    en: 'Thanks for writing! If anything about the order needs clarifying or fixing, just let me know.',
    uk: 'Дякую, що написали! Якщо щодо замовлення щось потрібно уточнити чи виправити, напишіть — допоможу.',
  },
  spam_scam: {
    ru: 'Здравствуйте! Всё общение и оплата — только через FunPay. Чем могу помочь по заказу?',
    en: 'Hello! All communication and payments stay on FunPay. How can I help with your order?',
    uk: 'Вітаю! Усе спілкування та оплата — лише через FunPay. Чим можу допомогти щодо замовлення?',
  },
  other: {
    ru: 'Здравствуйте! Спасибо за сообщение, отвечу в ближайшее время.',
    en: 'Hello! Thanks for your message, I will reply shortly.',
    uk: 'Вітаю! Дякую за повідомлення, відповім найближчим часом.',
  },
};

export const COMPLAINT_REPLY: Localized = {
  ru: 'Здравствуйте! Мне жаль, что так вышло. Опишите, пожалуйста, подробно, что произошло (при необходимости приложите скриншот), — я проверю заказ и отвечу здесь как можно скорее.',
  en: 'Hello! I am sorry this happened. Please describe in detail what went wrong (a screenshot helps) — I will check the order and reply here as soon as I can.',
  uk: 'Вітаю! Мені шкода, що так сталося. Опишіть, будь ласка, детально, що сталося (за потреби додайте скриншот), — я перевірю замовлення і відповім тут якнайшвидше.',
};

const CATEGORY_LABELS: Record<QuestionCategory, Localized> = {
  pre_sale: { en: 'pre-sale question', ru: 'вопрос до покупки', uk: 'питання до покупки' },
  delivery: { en: 'delivery question', ru: 'вопрос о доставке', uk: 'питання про доставку' },
  problem: { en: 'problem report', ru: 'сообщение о проблеме', uk: 'повідомлення про проблему' },
  refund_request: { en: 'refund request', ru: 'запрос возврата', uk: 'запит повернення' },
  review: { en: 'about a review', ru: 'про отзыв', uk: 'про відгук' },
  spam_scam: { en: 'possible spam / scam', ru: 'возможный спам / мошенничество', uk: 'можливий спам / шахрайство' },
  other: { en: 'other', ru: 'другое', uk: 'інше' },
};

export function categoryLabel(c: QuestionCategory, lang: CopilotLang): string {
  return CATEGORY_LABELS[c][lang];
}

const SUMMARY: Record<CopilotLang, { messages: string; buyerLast: string; sellerLast: string; noCustomer: string; topic: string; attention: string; none: string }> = {
  en: { messages: '{n} messages ({c} from the buyer).', buyerLast: 'Buyer last wrote: “{text}”', sellerLast: 'The seller replied last.', noCustomer: 'No buyer messages yet.', topic: 'Topic: {topic}.', attention: 'Needs attention: {reasons}.', none: 'No warning signs found.' },
  ru: { messages: 'Сообщений: {n} (от покупателя: {c}).', buyerLast: 'Последнее сообщение покупателя: «{text}»', sellerLast: 'Последним ответил продавец.', noCustomer: 'Сообщений от покупателя пока нет.', topic: 'Тема: {topic}.', attention: 'Требует внимания: {reasons}.', none: 'Тревожных признаков не найдено.' },
  uk: { messages: 'Повідомлень: {n} (від покупця: {c}).', buyerLast: 'Останнє повідомлення покупця: «{text}»', sellerLast: 'Останнім відповів продавець.', noCustomer: 'Повідомлень від покупця ще немає.', topic: 'Тема: {topic}.', attention: 'Потребує уваги: {reasons}.', none: 'Тривожних ознак не знайдено.' },
};

export function summaryText(lang: CopilotLang, key: keyof (typeof SUMMARY)['en'], vars: Record<string, string | number> = {}): string {
  return SUMMARY[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

const ATTENTION_LABELS: Record<string, Localized> = {
  refund: { en: 'refund request', ru: 'запрос возврата', uk: 'запит повернення' },
  dispute: { en: 'dispute / complaint', ru: 'спор / жалоба', uk: 'спір / скарга' },
  scam: { en: 'possible scam', ru: 'возможное мошенничество', uk: 'можливе шахрайство' },
  admin_impersonation: { en: 'claims to be FunPay staff', ru: 'выдаёт себя за администрацию FunPay', uk: 'видає себе за адміністрацію FunPay' },
  off_platform: { en: 'contacts / off-platform', ru: 'контакты вне FunPay', uk: 'контакти поза FunPay' },
  angry: { en: 'upset buyer', ru: 'покупатель расстроен', uk: 'покупець засмучений' },
};

export function attentionLabel(reason: string, lang: CopilotLang): string {
  return ATTENTION_LABELS[reason]?.[lang] ?? reason;
}

const TREND: Record<CopilotLang, Record<string, string>> = {
  en: {
    up: '{metric} grew by {pct}% ({from} → {to}).',
    down: '{metric} fell by {pct}% ({from} → {to}).',
    flat: '{metric} stayed about the same ({to}).',
    newly: '{metric}: {to} (nothing in the previous period).',
    revenue: 'Revenue',
    orders: 'Orders',
    avg: 'Average order: {value}.',
    top: 'Top category: {name} ({orders} orders).',
    refunds: 'Refunds: {n}.',
    best: 'Best day: {date} ({orders} orders).',
    period: 'Period: {label}.',
  },
  ru: {
    up: '{metric}: рост на {pct}% ({from} → {to}).',
    down: '{metric}: снижение на {pct}% ({from} → {to}).',
    flat: '{metric}: без заметных изменений ({to}).',
    newly: '{metric}: {to} (в прошлом периоде не было).',
    revenue: 'Выручка',
    orders: 'Заказы',
    avg: 'Средний чек: {value}.',
    top: 'Лучшая категория: {name} (заказов: {orders}).',
    refunds: 'Возвратов: {n}.',
    best: 'Лучший день: {date} (заказов: {orders}).',
    period: 'Период: {label}.',
  },
  uk: {
    up: '{metric}: зростання на {pct}% ({from} → {to}).',
    down: '{metric}: зниження на {pct}% ({from} → {to}).',
    flat: '{metric}: без помітних змін ({to}).',
    newly: '{metric}: {to} (у попередньому періоді не було).',
    revenue: 'Виторг',
    orders: 'Замовлення',
    avg: 'Середній чек: {value}.',
    top: 'Найкраща категорія: {name} (замовлень: {orders}).',
    refunds: 'Повернень: {n}.',
    best: 'Найкращий день: {date} (замовлень: {orders}).',
    period: 'Період: {label}.',
  },
};

export function trendText(lang: CopilotLang, key: string, vars: Record<string, string | number> = {}): string {
  const raw = TREND[lang][key] ?? TREND.en[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export type ListingTipId =
  | 'title_short'
  | 'title_caps'
  | 'title_punctuation'
  | 'no_english_title'
  | 'description_short'
  | 'description_contacts'
  | 'no_auto_delivery'
  | 'out_of_stock'
  | 'inactive'
  | 'price_above_market'
  | 'price_below_market';

export const LISTING_TIPS: Record<ListingTipId, Localized> = {
  title_short: {
    en: 'The title is short — add what exactly the buyer gets (edition, region/server, quantity, delivery speed).',
    ru: 'Короткий заголовок — добавьте, что именно получает покупатель (издание, регион/сервер, количество, скорость выдачи).',
    uk: 'Короткий заголовок — додайте, що саме отримує покупець (видання, регіон/сервер, кількість, швидкість видачі).',
  },
  title_caps: {
    en: 'Avoid writing the title in capital letters — it reads as shouting and is harder to scan.',
    ru: 'Не пишите заголовок заглавными буквами — он выглядит как крик и хуже читается.',
    uk: 'Не пишіть заголовок великими літерами — він виглядає як крик і гірше читається.',
  },
  title_punctuation: {
    en: 'Remove repeated punctuation and emoji runs from the title.',
    ru: 'Уберите повторяющиеся знаки препинания и цепочки эмодзи из заголовка.',
    uk: 'Приберіть повторювані розділові знаки та ланцюжки емодзі із заголовка.',
  },
  no_english_title: {
    en: 'Add an English title and description to reach buyers who browse FunPay in English.',
    ru: 'Добавьте английский заголовок и описание, чтобы лот видели покупатели англоязычной версии FunPay.',
    uk: 'Додайте англійський заголовок і опис, щоб лот бачили покупці англомовної версії FunPay.',
  },
  description_short: {
    en: 'Describe what the buyer receives, how and how fast it is delivered, and any requirements.',
    ru: 'Опишите, что получает покупатель, как и как быстро происходит выдача и какие есть требования.',
    uk: 'Опишіть, що отримує покупець, як і як швидко відбувається видача та які є вимоги.',
  },
  description_contacts: {
    en: 'Remove contact details and external links from the description — FunPay rules forbid moving buyers off the platform.',
    ru: 'Уберите контакты и внешние ссылки из описания — правила FunPay запрещают уводить покупателей с площадки.',
    uk: 'Приберіть контакти й зовнішні посилання з опису — правила FunPay забороняють виводити покупців з майданчика.',
  },
  no_auto_delivery: {
    en: 'Auto-delivery is off. For digital goods, instant delivery usually converts better.',
    ru: 'Автовыдача выключена. Для цифровых товаров мгновенная выдача обычно продаёт лучше.',
    uk: 'Автовидача вимкнена. Для цифрових товарів миттєва видача зазвичай продає краще.',
  },
  out_of_stock: {
    en: 'The listing shows zero stock — restock it or deactivate it.',
    ru: 'У лота нулевой остаток — пополните его или отключите лот.',
    uk: 'У лота нульовий залишок — поповніть його або вимкніть лот.',
  },
  inactive: {
    en: 'The listing is inactive and not visible to buyers.',
    ru: 'Лот неактивен и не виден покупателям.',
    uk: 'Лот неактивний і не видимий покупцям.',
  },
  price_above_market: {
    en: 'Your price is {pct}% above the median of comparable offers.',
    ru: 'Ваша цена на {pct}% выше медианы похожих предложений.',
    uk: 'Ваша ціна на {pct}% вища за медіану схожих пропозицій.',
  },
  price_below_market: {
    en: 'Your price is {pct}% below the median of comparable offers — check that the margin is intended.',
    ru: 'Ваша цена на {pct}% ниже медианы похожих предложений — проверьте, что такая маржа задумана.',
    uk: 'Ваша ціна на {pct}% нижча за медіану схожих пропозицій — перевірте, що така маржа запланована.',
  },
};

export function listingTipText(id: ListingTipId, lang: CopilotLang, vars: Record<string, string | number> = {}): string {
  return LISTING_TIPS[id][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
