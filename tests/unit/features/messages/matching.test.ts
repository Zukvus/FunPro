import { describe, expect, it } from 'vitest';
import { checkRegexSafety, compileRule, findMatchingRule, REGEX_LIMITS } from '@/features/messages/matching';
import { rule } from './helpers';

describe('match modes', () => {
  it('contains: case-insensitive by default, ё folds to е', () => {
    const r = compileRule(rule({ matchMode: 'contains', patterns: ['цена', 'всё ок'] }));
    expect(r.match('Какая ЦЕНА?')).toBe('цена');
    expect(r.match('все ок, спасибо')).toBe('всё ок');
    expect(r.match('сколько стоит')).toBeNull();
  });

  it('contains: case-sensitive when requested', () => {
    const r = compileRule(rule({ matchMode: 'contains', patterns: ['VIP'], caseSensitive: true }));
    expect(r.match('need VIP')).toBe('VIP');
    expect(r.match('need vip')).toBeNull();
  });

  it('exact: the whole message, ignoring whitespace and edge punctuation', () => {
    const r = compileRule(rule({ matchMode: 'exact', patterns: ['привет'] }));
    expect(r.match('  Привет!  ')).toBe('привет');
    expect(r.match('привет, есть товар?')).toBeNull();
  });

  it('word: whole words only, Unicode-aware, phrases across whitespace', () => {
    const r = compileRule(rule({ matchMode: 'word', patterns: ['цена', 'in stock'] }));
    expect(r.match('Цена?')).toBe('цена');
    expect(r.match('уценка')).toBeNull();
    expect(r.match('ценами')).toBeNull();
    expect(r.match('is it in   stock')).toBe('in stock');
    expect(r.match('instock')).toBeNull();
  });

  it('regex: user patterns with the i flag unless case-sensitive', () => {
    const r = compileRule(rule({ matchMode: 'regex', patterns: ['^(?:hi|hello)\\b', '\\d+\\s*(?:шт|pcs)'] }));
    expect(r.match('Hello there')).toBe('^(?:hi|hello)\\b');
    expect(r.match('нужно 5 шт')).toBe('\\d+\\s*(?:шт|pcs)');
    expect(r.match('whatever')).toBeNull();
  });

  it('regex: only the first maxInput characters are tested', () => {
    const r = compileRule(rule({ matchMode: 'regex', patterns: ['needle'] }));
    expect(r.match(`${'x'.repeat(REGEX_LIMITS.maxInput)} needle`)).toBeNull();
    expect(r.match(`needle ${'x'.repeat(1000)}`)).toBe('needle');
  });
});

describe('regex safety', () => {
  it.each([
    ['(a+)+$', 'nested_quantifier'],
    ['(a|aa)*b', 'nested_quantifier'],
    ['^(\\w+\\s?)*$', 'nested_quantifier'],
    ['(x+x+)+y', 'nested_quantifier'],
    ['(?:a{1,5}){2,}', 'nested_quantifier'],
    ['.*.*.*x', 'too_many_quantifiers'],
    ['(a)\\1', 'backreference'],
    ['(?<n>a)\\k<n>', 'backreference'],
    ['x'.repeat(201), 'too_long'],
    ['(unclosed', 'invalid'],
    ['[abc', 'invalid'],
    ['a{', 'invalid'],
    ['', 'empty'],
  ])('rejects %s (%s)', (src, reason) => {
    expect(checkRegexSafety(src)).toEqual({ ok: false, reason });
  });

  it.each(['цена|стоимость|price', '^\\s*(?:hi|hello)', '\\d{3,}', '[a-z]{1,5}\\s*!', '(?:buy|купить)\\s+\\d+', '\\p{L}+', 'colou?r'])('accepts %s', (src) => {
    expect(checkRegexSafety(src)).toEqual({ ok: true });
  });

  it('accepted patterns stay fast on hostile input', () => {
    const r = compileRule(rule({ matchMode: 'regex', patterns: ['.*.*x'] }));
    const start = performance.now();
    expect(r.match('a'.repeat(10_000))).toBeNull();
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('a rule with an unsafe pattern reports it and never matches through it', () => {
    const r = compileRule(rule({ matchMode: 'regex', patterns: ['(a+)+$', 'ok'] }));
    expect(r.errors).toEqual([{ pattern: '(a+)+$', reason: 'nested_quantifier' }]);
    expect(r.match('aaaa')).toBeNull();
    expect(r.match('ok')).toBe('ok');
  });
});

describe('rule selection', () => {
  it('uses the highest-priority enabled rule only', () => {
    const general = rule({ id: 'a', name: 'General', patterns: ['?'], priority: 0 });
    const price = rule({ id: 'b', name: 'Price', patterns: ['price'], priority: 10 });
    const off = rule({ id: 'c', name: 'Off', patterns: ['price'], priority: 99, enabled: false });
    expect(findMatchingRule([general, price, off], 'price?')?.rule.id).toBe('b');
    expect(findMatchingRule([general, price, off], 'what?')?.rule.id).toBe('a');
    expect(findMatchingRule([off], 'price')).toBeNull();
  });

  it('breaks priority ties deterministically by creation time', () => {
    const older = rule({ id: 'old', patterns: ['hi'], createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = rule({ id: 'new', patterns: ['hi'], createdAt: '2026-02-01T00:00:00.000Z' });
    expect(findMatchingRule([newer, older], 'hi')?.rule.id).toBe('old');
  });
});
