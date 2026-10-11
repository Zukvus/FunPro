import { z } from 'zod';

/**
 * Settings live in `browser.storage.local` (small, synchronous-feeling preferences).
 * Secrets (API keys, bot tokens) are NOT stored here — see `core/security/secrets.ts`.
 *
 * Every field has a default so that partial/legacy objects always parse.
 */

export const AutomationStateSchema = z.enum(['running', 'paused', 'stopped']);
export type AutomationState = z.infer<typeof AutomationStateSchema>;

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  general: z
    .object({
      language: z.enum(['auto', 'ru', 'en', 'uk']).default('auto'),
      /** Local-only mode: disables every external integration regardless of other settings. */
      localOnly: z.boolean().default(true),
      onboardingCompleted: z.boolean().default(false),
      lastSeenVersion: z.string().default(''),
    })
    .prefault({}),
  automation: z
    .object({
      /** Global switch. `stopped` is the emergency stop: nothing automated runs until resumed. */
      state: AutomationStateSchema.default('paused'),
      stoppedAt: z.number().nullable().default(null),
      /** The user acknowledged that live FunPay actions rely on reverse-engineered, unverified integrations. */
      liveActionsAcknowledged: z.boolean().default(false),
      autoBump: z.boolean().default(false),
      autoReply: z.boolean().default(false),
      welcomeMessage: z.boolean().default(false),
      postOrderMessage: z.boolean().default(false),
      autoReviewReply: z.boolean().default(false),
      autoDelivery: z.boolean().default(false),
      repricing: z.boolean().default(false),
      workflows: z.boolean().default(false),
    })
    .prefault({}),
  bump: z
    .object({
      /** Floor between automatic bump attempts per category, minutes. FunPay enforces its own cooldown. */
      minIntervalMinutes: z.number().int().min(30).max(24 * 60).default(60),
      /** Category (node) ids the seller chose to auto-bump. Empty = all detected categories. */
      nodeIds: z.array(z.string()).default([]),
      notifyOnSuccess: z.boolean().default(false),
      notifyOnFailure: z.boolean().default(true),
    })
    .prefault({}),
  sync: z
    .object({
      /** Polling interval for background syncs through an open FunPay tab. */
      intervalMinutes: z.number().int().min(1).max(60).default(2),
      /** Global minimum delay between FunPay requests made by FunPro. */
      minRequestGapMs: z.number().int().min(1000).max(60000).default(2500),
    })
    .prefault({}),
  messages: z
    .object({
      welcomeText: z.string().max(2000).default(''),
      postOrderText: z.string().max(2000).default(''),
      perCustomerCooldownSec: z.number().int().min(0).max(86400).default(900),
      quietHours: z
        .object({ enabled: z.boolean().default(false), start: timeHHMM.default('23:00'), end: timeHHMM.default('08:00') })
        .prefault({}),
      /** During quiet hours auto-replies are queued (true) or skipped (false). */
      queueDuringQuietHours: z.boolean().default(true),
      recentEmojis: z.array(z.string()).max(32).default([]),
    })
    .prefault({}),
  notifications: z
    .object({
      desktop: z.boolean().default(true),
      onMessage: z.boolean().default(true),
      onOrder: z.boolean().default(true),
      onReview: z.boolean().default(true),
      onFailure: z.boolean().default(true),
      sound: z.boolean().default(true),
      volume: z.number().min(0).max(1).default(0.6),
      /** Built-in sound id or `custom:<assetId>` for user-uploaded audio stored in IndexedDB. */
      messageSound: z.string().default('chime'),
      orderSound: z.string().default('register'),
    })
    .prefault({}),
  appearance: z
    .object({
      theme: z.enum(['system', 'light', 'dark', 'midnight', 'forest', 'sunset', 'mono']).default('system'),
      density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
      fontScale: z.number().min(0.8).max(1.5).default(1),
      reducedMotion: z.boolean().default(false),
      highContrast: z.boolean().default(false),
      /** Apply FunPro theming on funpay.com pages (content script). */
      themeFunPay: z.boolean().default(false),
      backgroundImageAssetId: z.string().nullable().default(null),
      backgroundOpacity: z.number().min(0).max(1).default(0.15),
      nickname: z
        .object({
          enabled: z.boolean().default(false),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7c5cff'),
          gradientTo: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .nullable()
            .default(null),
          font: z.enum(['inherit', 'serif', 'mono', 'rounded']).default('inherit'),
          bold: z.boolean().default(true),
        })
        .prefault({}),
      hideOthersNicknameStyles: z.boolean().default(false),
      profileBadge: z.string().max(40).default(''),
    })
    .prefault({}),
  privacy: z
    .object({
      hideBalances: z.boolean().default(false),
      /** Blur names, chat previews, order ids and balances (screenshots / streaming). */
      privacyMode: z.boolean().default(false),
      /** Retain chat message bodies locally for this many days (0 = do not store bodies). */
      messageRetentionDays: z.number().int().min(0).max(3650).default(90),
    })
    .prefault({}),
  ai: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(['none', 'openai', 'anthropic', 'openrouter', 'openai_compatible']).default('none'),
      model: z.string().max(100).default(''),
      baseUrl: z.string().max(300).default(''),
      /** User explicitly consented to sending selected text to the provider. */
      consentAt: z.number().nullable().default(null),
      /** Strip names / order ids before sending to the provider. */
      redactPersonalData: z.boolean().default(true),
      temperature: z.number().min(0).max(1.5).default(0.4),
    })
    .prefault({}),
  telegram: z
    .object({
      enabled: z.boolean().default(false),
      chatId: z.string().max(64).default(''),
      consentAt: z.number().nullable().default(null),
      notifyOrders: z.boolean().default(true),
      notifyMessages: z.boolean().default(true),
      notifyInventory: z.boolean().default(true),
      notifyFailures: z.boolean().default(true),
      notifyBumps: z.boolean().default(false),
      notifyPrices: z.boolean().default(false),
      dailySummary: z.boolean().default(false),
      dailySummaryTime: timeHHMM.default('21:00'),
      /** Include message previews in Telegram notifications (off by default for privacy). */
      includePreviews: z.boolean().default(false),
    })
    .prefault({}),
  fees: z
    .object({
      /** Seller-entered commission percentages per category name (FunPay shows these per category). */
      categoryCommissionPct: z.record(z.string(), z.number().min(0).max(100)).default({}),
      /** Fallback when a category has no entry. Null = unknown (net price not shown as exact). */
      defaultCommissionPct: z.number().min(0).max(100).nullable().default(null),
    })
    .prefault({}),
  flags: z.record(z.string(), z.boolean()).default({}),
  shortcuts: z
    .object({
      commandPalette: z.string().default('Ctrl+K'),
    })
    .prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}

/** Parse untrusted/legacy settings, falling back to defaults section-by-section. */
export function parseSettings(raw: unknown): Settings {
  const res = SettingsSchema.safeParse(raw ?? {});
  if (res.success) return res.data;
  const base = defaultSettings();
  if (raw && typeof raw === 'object') {
    const out: Record<string, unknown> = { ...base };
    for (const key of Object.keys(base) as (keyof Settings)[]) {
      const candidate = { ...base, [key]: (raw as Record<string, unknown>)[key] };
      const r = SettingsSchema.safeParse(candidate);
      if (r.success) out[key] = r.data[key];
    }
    return SettingsSchema.parse(out);
  }
  return base;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
export type SettingsPatch = DeepPartial<Settings>;

export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return b;
  };
  return SettingsSchema.parse(merge(current, patch));
}
