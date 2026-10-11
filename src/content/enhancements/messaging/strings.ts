/**
 * Strings for the funpay.com chat helpers (kept here, not in the dashboard locale, so the content
 * script bundle stays small). Language: FunPro's setting, or FunPay's page locale when "auto".
 */
export type PageLang = 'en' | 'ru' | 'uk';

const EN = {
  toolbar: 'FunPro chat tools',
  slashHint: 'Type / for templates',
  notSentHint: 'FunPro only inserts text — you press Send.',
  templates: 'FunPro templates',
  templatesLoading: 'Loading templates…',
  templatesNone: 'No matching templates. Create them in FunPro → Messages → Templates.',
  templatesError: 'Templates are unavailable (reload the page).',
  templatesKeys: 'Enter/Tab insert · Esc close',
  templatesCount: '{count} templates. Up and down arrows to choose, Enter to insert.',
  inserted: 'Template inserted. Check the text, then press Send.',
  emojiButton: 'Emoji',
  emojiDialog: 'Emoji picker',
  emojiSearch: 'Search emoji (English or Russian)',
  emojiNone: 'No emoji found',
  emojiRecent: 'Recently used',
  'cat.smileys': 'Smileys',
  'cat.gestures': 'People & gestures',
  'cat.hearts': 'Hearts',
  'cat.nature': 'Animals & nature',
  'cat.food': 'Food & drink',
  'cat.activities': 'Games & activities',
  'cat.travel': 'Travel',
  'cat.objects': 'Objects',
  'cat.symbols': 'Symbols',
  close: 'Close',
} as const;

export type StringKey = keyof typeof EN;

const RU: Record<StringKey, string> = {
  toolbar: 'Инструменты чата FunPro',
  slashHint: 'Введите / для шаблонов',
  notSentHint: 'FunPro только вставляет текст — отправляете вы.',
  templates: 'Шаблоны FunPro',
  templatesLoading: 'Загрузка шаблонов…',
  templatesNone: 'Подходящих шаблонов нет. Создайте их в FunPro → Сообщения → Шаблоны.',
  templatesError: 'Шаблоны недоступны (перезагрузите страницу).',
  templatesKeys: 'Enter/Tab — вставить · Esc — закрыть',
  templatesCount: 'Шаблонов: {count}. Стрелки вверх и вниз — выбор, Enter — вставить.',
  inserted: 'Шаблон вставлен. Проверьте текст и нажмите «Отправить».',
  emojiButton: 'Эмодзи',
  emojiDialog: 'Выбор эмодзи',
  emojiSearch: 'Поиск эмодзи (по-русски или по-английски)',
  emojiNone: 'Ничего не найдено',
  emojiRecent: 'Недавние',
  'cat.smileys': 'Смайлы',
  'cat.gestures': 'Люди и жесты',
  'cat.hearts': 'Сердечки',
  'cat.nature': 'Животные и природа',
  'cat.food': 'Еда и напитки',
  'cat.activities': 'Игры и занятия',
  'cat.travel': 'Путешествия',
  'cat.objects': 'Предметы',
  'cat.symbols': 'Символы',
  close: 'Закрыть',
};

const UK: Record<StringKey, string> = {
  toolbar: 'Інструменти чату FunPro',
  slashHint: 'Введіть / для шаблонів',
  notSentHint: 'FunPro лише вставляє текст — надсилаєте ви.',
  templates: 'Шаблони FunPro',
  templatesLoading: 'Завантаження шаблонів…',
  templatesNone: 'Відповідних шаблонів немає. Створіть їх у FunPro → Повідомлення → Шаблони.',
  templatesError: 'Шаблони недоступні (перезавантажте сторінку).',
  templatesKeys: 'Enter/Tab — вставити · Esc — закрити',
  templatesCount: 'Шаблонів: {count}. Стрілки вгору й униз — вибір, Enter — вставити.',
  inserted: 'Шаблон вставлено. Перевірте текст і натисніть «Надіслати».',
  emojiButton: 'Емодзі',
  emojiDialog: 'Вибір емодзі',
  emojiSearch: 'Пошук емодзі (російською чи англійською)',
  emojiNone: 'Нічого не знайдено',
  emojiRecent: 'Нещодавні',
  'cat.smileys': 'Смайли',
  'cat.gestures': 'Люди й жести',
  'cat.hearts': 'Сердечка',
  'cat.nature': 'Тварини й природа',
  'cat.food': 'Їжа й напої',
  'cat.activities': 'Ігри та заняття',
  'cat.travel': 'Подорожі',
  'cat.objects': 'Предмети',
  'cat.symbols': 'Символи',
  close: 'Закрити',
};

const DICTS: Record<PageLang, Record<StringKey, string>> = { en: EN, ru: RU, uk: UK };

export type PageT = (key: StringKey, vars?: Record<string, string | number>) => string;

export function resolvePageLang(setting: string | undefined, pageLocale: string | null | undefined, navLang = globalThis.navigator?.language ?? 'en'): PageLang {
  if (setting === 'en' || setting === 'ru' || setting === 'uk') return setting;
  if (pageLocale === 'en' || pageLocale === 'ru' || pageLocale === 'uk') return pageLocale;
  const n = navLang.toLowerCase();
  return n.startsWith('ru') ? 'ru' : n.startsWith('uk') ? 'uk' : 'en';
}

export function pageT(lang: PageLang): PageT {
  return (key, vars) => {
    const raw = DICTS[lang][key] ?? EN[key];
    return vars ? raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`)) : raw;
  };
}
