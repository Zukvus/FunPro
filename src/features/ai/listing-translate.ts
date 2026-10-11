/**
 * Bridges the AI copilot's translator into the listings translation flow
 * (src/features/listings/translate.ts). Chrome's on-device translator is always preferred by that
 * module; this provider is only used when it is unavailable, and only while the AI integration is
 * fully set up (enabled, consented for this provider/endpoint, key present, permission granted,
 * not in local-only mode). Text is redacted before it is sent (see copilot.translate).
 */
import type { Settings } from '@/core/settings/schema';
import { registerTranslateProvider, type TranslateProvider } from '@/features/listings/translate';
import { aiAvailability } from './availability';
import { translate } from './copilot';

export const AI_TRANSLATE_PROVIDER_ID = 'ai';

export function aiTranslateProvider(providerName: string): TranslateProvider {
  return {
    id: AI_TRANSLATE_PROVIDER_ID,
    label: `AI provider (${providerName})`,
    external: true,
    translate: async (text, from, to) => {
      const res = await translate(text, to, { from, useAi: true });
      if (res.status !== 'ok') throw new Error(res.message);
      return res.text;
    },
  };
}

/** Register or remove the AI translate provider according to the current settings. */
export async function syncAiTranslateProvider(
  settings: Settings,
  check: typeof aiAvailability = aiAvailability,
): Promise<boolean> {
  const ready = settings.ai.enabled && (await check(settings)).ok;
  registerTranslateProvider(ready ? aiTranslateProvider(settings.ai.provider) : null);
  return ready;
}
