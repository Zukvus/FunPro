import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings, mergeSettings } from '@/core/settings/schema';
import { syncAiTranslateProvider } from '@/features/ai/listing-translate';
import { getTranslateProvider, resetTranslateForTests } from '@/features/listings/translate';

afterEach(() => resetTranslateForTests());

describe('AI translate provider bridge', () => {
  it('registers the AI provider only when the AI integration is ready', async () => {
    const off = defaultSettings();
    expect(await syncAiTranslateProvider(off, async () => ({ ok: true }))).toBe(false);
    expect(await getTranslateProvider('ru', 'en')).toBeNull();

    const on = mergeSettings(off, { ai: { enabled: true, provider: 'openai' } });
    expect(
      await syncAiTranslateProvider(on, async () => ({ ok: false, reason: 'no_consent' as never })),
    ).toBe(false);
    expect(await getTranslateProvider('ru', 'en')).toBeNull();

    expect(await syncAiTranslateProvider(on, async () => ({ ok: true }))).toBe(true);
    const p = await getTranslateProvider('ru', 'en');
    expect(p).toMatchObject({ id: 'ai', external: true });

    // Turning AI off removes it again.
    await syncAiTranslateProvider(off, async () => ({ ok: true }));
    expect(await getTranslateProvider('ru', 'en')).toBeNull();
  });
});
