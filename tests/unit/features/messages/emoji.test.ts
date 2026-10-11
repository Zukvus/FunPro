import { describe, expect, it } from 'vitest';
import { allEmojis, EMOJI_CATEGORIES, emojiName, resolveRecent, searchEmojis } from '@/features/messages/emoji';

const chars = (q: string, limit = 10) => searchEmojis(q, { limit }).map((e) => e.char);

describe('emoji dataset', () => {
  it('has a few hundred unique emojis in every category with EN and RU keywords', () => {
    const list = allEmojis();
    expect(list.length).toBeGreaterThan(300);
    expect(new Set(list.map((e) => e.char)).size).toBe(list.length);
    for (const c of EMOJI_CATEGORIES) expect(list.some((e) => e.category === c)).toBe(true);
    for (const e of list) {
      expect(e.en.length).toBeGreaterThan(0);
      expect(e.ru.length).toBeGreaterThan(0);
    }
  });

  it('adds the emoji variation selector at runtime only where marked', () => {
    const heart = allEmojis().find((e) => e.en[0] === 'red_heart')!;
    expect([...heart.char].map((c) => c.codePointAt(0))).toEqual([0x2764, 0xfe0f]);
    const thumbs = allEmojis().find((e) => e.en[0] === 'thumbs_up')!;
    expect([...thumbs.char]).toHaveLength(1);
  });

  it('names emojis per language', () => {
    const thumbs = allEmojis().find((e) => e.en[0] === 'thumbs_up')!;
    expect(emojiName(thumbs, 'en')).toBe('thumbs up');
    expect(emojiName(thumbs, 'ru')).toBe('лайк');
  });
});

describe('emoji search', () => {
  it('finds by English and Russian keywords and prefixes', () => {
    expect(chars('thumbs')[0]).toBe('👍');
    expect(chars('лайк')[0]).toBe('👍');
    expect(chars('подар')).toContain('🎁');
    expect(chars('rock')).toContain('🚀');
    expect(chars('спасибо')).toContain('🙏');
  });

  it('requires every query word to match and ranks exact keywords first', () => {
    expect(chars('heart broken')).toEqual(['💔']);
    expect(chars('fire')[0]).toBe('🔥');
    // "ё" folds to "е"; words are matched from their start only ("сделка" is not a "елка").
    expect(chars('елка')).toEqual(['🎄']);
    expect(chars('ёлка')).toEqual(['🎄']);
  });

  it('filters by category, returns everything for an empty query and matches the character itself', () => {
    const food = searchEmojis('', { category: 'food', limit: 500 });
    expect(food.length).toBeGreaterThan(30);
    expect(food.every((e) => e.category === 'food')).toBe(true);
    expect(chars('🎮')).toEqual(['🎮']);
    expect(chars('zzzzqq')).toEqual([]);
  });

  it('resolves recently used characters, keeping unknown ones', () => {
    expect(resolveRecent(['🔥', '★']).map((e) => e.char)).toEqual(['🔥', '★']);
  });
});
