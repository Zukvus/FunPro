import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { deleteRule, parsePatterns, RuleError, saveRule, setRuleEnabled } from '@/features/messages/rules';

beforeEach(() => {
  resetDbForTests();
});

describe('auto-reply rule CRUD', () => {
  it('creates rules with safe defaults (approval required) and updates them', async () => {
    const r = await saveRule({ name: 'Price', patterns: ['price', 'price', 'цена'], reply: 'See the listing, {buyer}.' });
    expect(r).toMatchObject({ enabled: true, requireApproval: true, matchMode: 'contains', cooldownSec: 600, patterns: ['price', 'цена'] });
    expect(r.id).toMatch(/^arr_/);
    const u = await saveRule({ name: 'Price 2', patterns: ['cost'], reply: 'x', requireApproval: false }, r.id);
    expect(u).toMatchObject({ id: r.id, createdAt: r.createdAt, name: 'Price 2', requireApproval: false });
    await setRuleEnabled(r.id, false);
    expect((await getDb().autoReplyRules.get(r.id))!.enabled).toBe(false);
    await deleteRule(r.id);
    expect(await getDb().autoReplyRules.count()).toBe(0);
  });

  it('refuses unsafe regexes and invalid input', async () => {
    await expect(saveRule({ name: 'Bad', matchMode: 'regex', patterns: ['ok', '(a+)+$'], reply: 'x' })).rejects.toMatchObject({
      code: 'unsafe_pattern',
      detail: { pattern: '(a+)+$', reason: 'nested_quantifier' },
    });
    await expect(saveRule({ name: 'Empty', patterns: [], reply: 'x' })).rejects.toBeInstanceOf(RuleError);
    await expect(saveRule({ name: 'Long', patterns: ['a'], reply: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveRule({ name: 'X', patterns: ['a'], reply: 'x' }, 'missing')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('parses one pattern per line', () => {
    expect(parsePatterns(' price \n\nцена\nprice\n')).toEqual(['price', 'цена']);
  });
});
