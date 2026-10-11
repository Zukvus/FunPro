import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import messaging from '@/ui/i18n/locales/messaging';
import { pageT, resolvePageLang } from '@/content/enhancements/messaging/strings';
import { TEMPLATE_VARIABLES } from '@/features/messages/engine';

const ROOT = join(__dirname, '../../../..');
const UI_DIRS = ['src/dashboard/pages/messages', 'src/dashboard/pages/customers'];
const UI_FILES = ['src/dashboard/pages/MessagesPage.tsx', 'src/dashboard/pages/CustomersPage.tsx'];
const MY_DIRS = ['src/features/messages', 'src/features/crm', 'src/content/enhancements/messaging', ...UI_DIRS];
const MY_FILES = [...UI_FILES, 'src/ui/i18n/locales/messaging.ts', 'src/content/enhancements/messaging.ts', 'src/background/modules/messaging.ts', 'src/core/messaging/rpc/messaging.ts'];

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? files(p) : [p];
  });
}

/** Keys built at runtime from known value sets. */
const DYNAMIC: string[] = [
  ...['telegram', 'discord', 'phone', 'email', 'vk', 'external_link', 'confirm_pressure', 'review_incentive', 'unknown_variable', 'too_long'].map((x) => `msg.lint.${x}`),
  ...TEMPLATE_VARIABLES.map((v) => `msg.var.${v}`),
  ...['off', 'stopped', 'paused', 'unsupported', 'ack', 'noTab', 'login', 'active', 'unknown'].map((x) => `msg.reason.${x}`),
  ...['pending', 'running', 'done', 'failed', 'cancelled', 'awaiting_tab', 'blocked'].map((x) => `msg.task.${x}`),
  ...['manual', 'auto_reply', 'welcome', 'post_order', 'delivery', 'workflow', 'scheduled', 'ai'].map((x) => `msg.source.${x}`),
  ...['invalid_command', 'duplicate_command', 'invalid_input', 'not_found'].map((x) => `msg.templates.error.${x}`),
  ...['contains', 'exact', 'word', 'regex'].flatMap((x) => [`msg.rules.mode.${x}`, `msg.rules.mode.${x}.help`]),
  ...['empty', 'too_long', 'invalid', 'backreference', 'nested_quantifier', 'too_many_quantifiers', 'too_many_groups'].map((x) => `msg.regex.${x}`),
  ...['invalid_input', 'unsafe_pattern', 'not_found'].map((x) => `msg.rules.error.${x}`),
  ...['ok', 'blocked', 'error', 'disabled'].map((x) => `msg.sync.state.${x}`),
  ...['auto_reply', 'welcome', 'post_order', 'ai', 'workflow', 'scheduled', 'review', 'delivery'].map((x) => `msg.draftKind.${x}`),
  ...['approval_required', 'lint', 'missing_variables', 'unaddressable'].map((x) => `msg.draftReason.${x}`),
  ...['invalid_chat', 'invalid_text', 'in_past', 'too_far', 'not_found', 'not_editable'].map((x) => `msg.scheduled.error.${x}`),
  ...['scheduled', 'inOutbox', 'sent', 'failed', 'dismissed'].map((x) => `msg.scheduled.status.${x}`),
  ...['inbox', 'templates', 'autoReplies', 'welcome', 'limits', 'drafts'].map((x) => `msg.tab.${x}`),
  ...['paid', 'closed', 'refunded', 'unknown'].map((x) => `crm.orderStatus.${x}`),
];

describe('messaging translations', () => {
  it('has the same keys in en, ru and uk with non-empty values', () => {
    const en = Object.keys(messaging.en).sort();
    expect(Object.keys(messaging.ru).sort()).toEqual(en);
    expect(Object.keys(messaging.uk).sort()).toEqual(en);
    for (const dict of [messaging.en, messaging.ru, messaging.uk]) for (const v of Object.values(dict)) expect(v.trim()).not.toBe('');
  });

  it('keeps {placeholders} consistent between languages', () => {
    const vars = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(messaging.en)) {
      expect(vars(messaging.ru[key]!), key).toEqual(vars(messaging.en[key]!));
      expect(vars(messaging.uk[key]!), key).toEqual(vars(messaging.en[key]!));
    }
  });

  it('defines every key the Messages and Customers pages use', () => {
    const used = new Set(DYNAMIC);
    for (const f of [...UI_DIRS.flatMap(files), ...UI_FILES]) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'((?:msg|crm)\.[\w.]+)'/g)) used.add(m[1]!);
      for (const m of src.matchAll(/'((?:msg|crm)\.reason\.\w+)'/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in messaging.en));
    expect(missing).toEqual([]);
  });

  it('content-script strings resolve the page language', () => {
    expect(resolvePageLang('auto', 'uk')).toBe('uk');
    expect(resolvePageLang('en', 'ru')).toBe('en');
    expect(resolvePageLang('auto', null, 'ru-RU')).toBe('ru');
    expect(pageT('ru')('templatesCount', { count: 3 })).toContain('3');
  });

  it('source files contain no literal invisible or control characters', () => {
    // Code-point ranges (not regex escapes, which some tools turn into the characters themselves).
    const ranges: [number, number][] = [
      [0x0, 0x8],
      [0xb, 0xc],
      [0xe, 0x1f],
      [0x7f, 0x7f],
      [0x200b, 0x200f],
      [0x2028, 0x202e],
      [0x2060, 0x2064],
      [0xfe00, 0xfe0f],
      [0xfeff, 0xfeff],
    ];
    const invisible = (text: string) => [...text].some((ch) => ranges.some(([a, b]) => ch.codePointAt(0)! >= a && ch.codePointAt(0)! <= b));
    for (const f of [...MY_DIRS.flatMap(files), ...MY_FILES, ...files('tests/unit/features/messages'), ...files('tests/unit/features/crm')]) {
      expect(invisible(readFileSync(join(ROOT, f), 'utf8')), f).toBe(false);
    }
  });
});
