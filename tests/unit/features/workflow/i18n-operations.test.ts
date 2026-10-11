import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import locale from '@/ui/i18n/locales/operations';
import { ALL_DELIVERY_STATUSES, DeliveryChannelSchema } from '@/features/inventory/model';
import { ActionSchema, ConditionSchema, EventTypeSchema, InventoryItemStatusSchema } from '@/shared/models';

const ROOT = join(__dirname, '..', '..', '..', '..');
const UI_FILES = [
  'src/dashboard/pages/InventoryPage.tsx',
  'src/dashboard/pages/PricingPage.tsx',
  'src/dashboard/pages/RulesPage.tsx',
  'src/dashboard/pages/inventory',
  'src/dashboard/pages/pricing',
  'src/dashboard/pages/rules',
];

function sources(): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    const full = join(ROOT, p);
    if (statSync(full).isDirectory()) for (const f of readdirSync(full)) walk(join(p, f));
    else if (/\.tsx?$/.test(p)) out.push(readFileSync(full, 'utf8'));
  };
  UI_FILES.forEach(walk);
  return out;
}

describe('operations locale', () => {
  it('has the same keys in en, ru and uk', () => {
    const en = Object.keys(locale.en).sort();
    expect(Object.keys(locale.ru).sort()).toEqual(en);
    expect(Object.keys(locale.uk).sort()).toEqual(en);
    for (const lang of ['en', 'ru', 'uk'] as const)
      for (const [k, v] of Object.entries(locale[lang])) expect(v.trim(), `${lang}:${k}`).not.toBe('');
  });

  it('keeps placeholders consistent across languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(locale.en)) {
      expect(vars(locale.ru[k]!), `ru:${k}`).toBe(vars(locale.en[k]!));
      expect(vars(locale.uk[k]!), `uk:${k}`).toBe(vars(locale.en[k]!));
    }
  });

  it('defines every static key used by the pages', () => {
    const missing: string[] = [];
    for (const src of sources()) {
      for (const m of src.matchAll(/t\(['`](ops\.[\w.]+)['`]/g))
        if (!(m[1]! in locale.en)) missing.push(m[1]!);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('defines every dynamic key family', () => {
    const families: [string, readonly string[]][] = [
      ['ops.inv.status', ALL_DELIVERY_STATUSES],
      ['ops.inv.channel', DeliveryChannelSchema.options],
      ['ops.inv.itemStatus', InventoryItemStatusSchema.options],
      ['ops.inv.pushStatus', ['pending', 'done', 'failed', 'uncertain', 'restored']],
      [
        'ops.inv.reason',
        [
          'chat_unknown',
          'out_of_stock',
          'message_too_long',
          'items_missing',
          'draft_dismissed',
          'draft_deleted',
          'auto_not_running',
          'send_failed',
          'outcome_uncertain',
          'task_missing',
          'cancelled_by_stop',
          'refunded',
          'released_by_user',
        ],
      ],
      ['ops.inv.await.via', ['listing', 'title', 'keyword']],
      ['ops.price.excl', ['own', 'ignored', 'currency', 'band', 'similarity']],
      [
        'ops.price.hold',
        [
          'currency_unknown',
          'invalid_bounds',
          'no_competitors',
          'fewer_than_n',
          'already_optimal',
          'cooldown',
          'daily_limit',
          'oscillation',
        ],
      ],
      ['ops.price.note', ['clamped_floor', 'clamped_ceiling', 'margin_floor', 'commission_unknown', 'raise']],
      ['ops.price.strategy', ['match_lowest', 'undercut_lowest', 'stay_in_top_n']],
      ['ops.price.source', ['public_page', 'pending_change', 'listing']],
      ['ops.price.mode', ['auto', 'manual']],
      [
        'ops.price.outcome',
        [
          'not_simulated',
          'listing_missing',
          'stale_data',
          'commission_unknown',
          'applied',
          'already_optimal',
          'error',
          'no_rule',
          'currency_unknown',
          'invalid_bounds',
          'no_competitors',
          'fewer_than_n',
          'cooldown',
          'daily_limit',
          'oscillation',
        ],
      ],
      ['ops.wf.trigger', EventTypeSchema.options],
      ['ops.wf.triggerHelp', EventTypeSchema.options],
      ['ops.wf.cond', ConditionSchema.options.map((o) => o.shape.kind.value)],
      ['ops.wf.action', ActionSchema.options.map((o) => o.shape.kind.value)],
      ['ops.wf.astatus', ['done', 'dry_run', 'skipped', 'failed']],
      ['ops.wf.conflict', ['double_reply', 'different_drafts', 'reply_and_draft']],
    ];
    const missing = families
      .flatMap(([prefix, values]) => values.map((v) => `${prefix}.${v}`))
      .filter((k) => !(k in locale.en));
    expect(missing).toEqual([]);
  });
});
