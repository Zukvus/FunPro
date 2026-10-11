import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  builtinAvailability,
  getTranslateProvider,
  registerTranslateProvider,
  resetTranslateForTests,
  translateTexts,
  type TranslateFn,
} from '@/features/listings/translate';

const g = globalThis as unknown as { Translator?: unknown };

beforeEach(() => {
  resetTranslateForTests();
  delete g.Translator;
});
afterEach(() => {
  delete g.Translator;
});

describe('translation providers', () => {
  it('is unavailable without the built-in API or a registered provider', async () => {
    expect(await builtinAvailability('ru', 'en')).toBe('unavailable');
    expect(await getTranslateProvider('ru', 'en')).toBeNull();
  });

  it("uses Chrome's on-device Translator API when present (one translator per language pair)", async () => {
    const create = vi.fn(
      async ({ sourceLanguage, targetLanguage }: { sourceLanguage: string; targetLanguage: string }) => ({
        translate: async (text: string) => `[${sourceLanguage}>${targetLanguage}] ${text}`,
      }),
    );
    g.Translator = { availability: vi.fn(async () => 'downloadable'), create };
    expect(await builtinAvailability('ru', 'en')).toBe('downloadable');
    const p = (await getTranslateProvider('ru', 'en'))!;
    expect(p).toMatchObject({ id: 'builtin', external: false });
    expect(await p.translate('Привет', 'ru', 'en')).toBe('[ru>en] Привет');
    expect(await p.translate('Мир', 'ru', 'en')).toBe('[ru>en] Мир');
    expect(await p.translate('   ', 'ru', 'en')).toBe('   ');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('falls back to a registered provider when the built-in one cannot translate the pair', async () => {
    g.Translator = {
      availability: async () => 'unavailable',
      create: async () => ({ translate: async () => 'x' }),
    };
    const ai: TranslateFn = async (t) => `AI:${t}`;
    registerTranslateProvider({ id: 'ai', label: 'AI', external: true, translate: ai });
    const p = (await getTranslateProvider('ru', 'en'))!;
    expect(p.id).toBe('ai');
    expect(p.external).toBe(true);
  });

  it('translates only non-empty fields and honours abort signals', async () => {
    const fn = vi.fn<TranslateFn>(async (t) => ` ${t.toUpperCase()} `);
    expect(await translateTexts({ a: 'one', b: '', c: '  ', d: 'two' }, fn, 'ru', 'en')).toEqual({
      a: 'ONE',
      d: 'TWO',
    });
    expect(fn).toHaveBeenCalledTimes(2);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(translateTexts({ a: 'one' }, fn, 'ru', 'en', ctrl.signal)).rejects.toThrow(/Aborted/);
  });
});
