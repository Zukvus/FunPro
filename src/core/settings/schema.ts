import { z } from 'zod';
import { CurrencySchema, ExchangeRateSchema } from '@/shared/models/money';

/**
 * Settings live in `browser.storage.local` (small, synchronous-feeling preferences).
 * Secrets (API keys, bot tokens) are NOT stored here — see `core/security/secrets.ts`.
 *
 * Every field has a default so that partial/legacy objects always parse.
 */

export const AutomationStateSchema = z.enum(['running', 'paused', 'stopped']);
export type AutomationState = z.infer<typeof AutomationStateSchema>;

const timeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Dashboard/popup themes. `system` follows the OS; palettes live in src/ui/styles.css (mirrored in features/appearance/themes.ts). */
export const ThemeIdSchema = z.enum([
  'system',
  'light',
  'dark',
  'midnight',
  'forest',
  'sunset',
  'mono',
  'aurora',
  'contrast',
]);
export type ThemeId = z.infer<typeof ThemeIdSchema>;

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  general: z
    .object({
      language: z.enum(['auto', 'ru', 'en', 'uk']).default('auto'),
      /** Local-only mode: disables every external integration regardless of other settings. */
      localOnly: z.boolean().default(true),
      onboardingCompleted: z.boolean().default(false),
      lastSeenVersion: z.string().default(''),
      /** Extension version whose changelog the user last opened (drives the "what's new" badge). */
      changelogSeenVersion: z.string().max(40).default(''),
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
      minIntervalMinutes: z
        .number()
        .int()
        .min(30)
        .max(24 * 60)
        .default(60),
      /** Category (node) ids the seller chose to auto-bump. Empty = all detected categories. */
      nodeIds: z.array(z.string()).default([]),
      notifyOnSuccess: z.boolean().default(false),
      notifyOnFailure: z.boolean().default(true),
      /** Automatic bumping of a game stops after this many consecutive failed attempts (manual "Raise now" resumes it). */
      maxConsecutiveFailures: z.number().int().min(1).max(20).default(5),
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
        .object({
          enabled: z.boolean().default(false),
          start: timeHHMM.default('23:00'),
          end: timeHHMM.default('08:00'),
        })
        .prefault({}),
      /** During quiet hours auto-replies are queued (true) or skipped (false). */
      queueDuringQuietHours: z.boolean().default(true),
      recentEmojis: z.array(z.string()).max(32).default([]),
      /** Loop protection: at most this many automatic replies per chat per hour. */
      maxAutoRepliesPerChatPerHour: z.number().int().min(1).max(20).default(3),
      /** Auto-replies pause in a chat for this many minutes after the seller writes there manually (0 = off). */
      pauseAfterManualReplyMin: z.number().int().min(0).max(1440).default(30),
      /** Poll the chat list (and changed chats' history) in the background through an open FunPay tab. */
      backgroundChatSync: z.boolean().default(true),
    })
    .prefault({}),
  notifications: z
    .object({
      /** Master switch for desktop (OS) notifications; the `on*` flags select kinds. */
      desktop: z.boolean().default(true),
      onMessage: z.boolean().default(true),
      onOrder: z.boolean().default(true),
      onReview: z.boolean().default(true),
      onFailure: z.boolean().default(true),
      onInventory: z.boolean().default(true),
      /** Competitor price changes can be frequent, so they are opt-in. */
      onPrice: z.boolean().default(false),
      /** Bump results (the bump module decides which results are reported). */
      onBump: z.boolean().default(true),
      /** Master switch for sounds; `soundKinds` selects which kinds play one. */
      sound: z.boolean().default(true),
      volume: z.number().min(0).max(1).default(0.6),
      /** Built-in sound id or `custom:<assetId>` for user-uploaded audio stored in IndexedDB. */
      messageSound: z.string().default('chime'),
      orderSound: z.string().default('register'),
      reviewSound: z.string().default('bell'),
      /** Sound for failures, low stock, price and bump alerts. */
      alertSound: z.string().default('alert'),
      soundKinds: z
        .object({
          order: z.boolean().default(true),
          message: z.boolean().default(true),
          review: z.boolean().default(true),
          failure: z.boolean().default(false),
          inventory: z.boolean().default(false),
          price: z.boolean().default(false),
          bump: z.boolean().default(false),
          system: z.boolean().default(false),
        })
        .prefault({}),
    })
    .prefault({}),
  appearance: z
    .object({
      theme: ThemeIdSchema.default('system'),
      /** Optional accent colour override (custom theme); null = use the theme's own accent. */
      accentColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable()
        .default(null),
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
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .default('#7c5cff'),
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
      /**
       * Provider + endpoint the consent was given for (`provider|origin`). Consent is void when the
       * user switches provider or endpoint, because the disclosure named a specific recipient.
       */
      consentScope: z.string().max(400).default(''),
      /** Strip buyer names before sending to the provider (order ids, links, emails, phones are always stripped). */
      redactPersonalData: z.boolean().default(true),
      temperature: z.number().min(0).max(1.5).default(0.4),
      /** Prepare AI drafts automatically for new reviews (sends each new review's text to the provider). */
      autoDraftReviews: z.boolean().default(false),
      /**
       * Post star-template replies to new reviews without approval. Only user-defined templates are
       * ever posted automatically; AI-written text always waits for approval.
       */
      autoPostReviewReplies: z.boolean().default(false),
    })
    .prefault({}),
  telegram: z
    .object({
      enabled: z.boolean().default(false),
      chatId: z.string().max(64).default(''),
      consentAt: z.number().nullable().default(null),
      /** Bot @username from getMe (display only). */
      botUsername: z.string().max(64).default(''),
      /** Telegram username / first name of the authorized chat, confirmed by the user (display only). */
      chatLabel: z.string().max(128).default(''),
      notifyOrders: z.boolean().default(true),
      notifyMessages: z.boolean().default(true),
      notifyReviews: z.boolean().default(false),
      notifyInventory: z.boolean().default(true),
      notifyFailures: z.boolean().default(true),
      notifyBumps: z.boolean().default(false),
      notifyPrices: z.boolean().default(false),
      dailySummary: z.boolean().default(false),
      dailySummaryTime: timeHHMM.default('21:00'),
      /** Include message previews and buyer names in Telegram notifications (off by default for privacy). */
      includePreviews: z.boolean().default(false),
      /** Accept /status and /stop (with confirmation) from the authorized chat; polled once a minute. */
      remoteCommands: z.boolean().default(false),
    })
    .prefault({}),
  fees: z
    .object({
      /** Seller-entered commission percentages per category name (FunPay shows these per category). */
      categoryCommissionPct: z.record(z.string(), z.number().min(0).max(100)).default({}),
      /** Fallback when a category has no entry. Null = unknown (net price not shown as exact). */
      defaultCommissionPct: z.number().min(0).max(100).nullable().default(null),
      /**
       * Commission per FunPay subcategory (node id) — preferred over the category-name map because
       * category names differ between pages. `source: 'calc'` means the % was derived from FunPay's
       * own /lots/calc answer for that node; everything else is labelled as an estimate.
       */
      nodeCommission: z
        .record(
          z.string(),
          z.object({ pct: z.number().min(0).max(100), source: z.enum(['calc', 'manual']), at: z.number() }),
        )
        .default({}),
    })
    .prefault({}),
  analytics: z
    .object({
      /** Paid sales older than this many hours are listed as "unconfirmed" (aging panel, on-page helper). */
      unconfirmedAfterHours: z.number().int().min(0).max(720).default(2),
      /** Unconfirmed sales older than this are offered for a support-ticket draft (never submitted by FunPro). */
      supportTicketAfterHours: z
        .number()
        .int()
        .min(24)
        .max(24 * 60)
        .default(72),
      /** Manual exchange rates (with source + timestamp) for the optional combined-currency view. Never fetched. */
      exchangeRates: z.array(ExchangeRateSchema).max(20).default([]),
      /** Target currency of the combined view; null = combined view off (amounts stay per currency). */
      combinedCurrency: CurrencySchema.nullable().default(null),
    })
    .prefault({}),
  inventory: z
    .object({
      /** Reserve stock automatically when a new (non-baseline) paid sale matches a pool. */
      autoReserve: z.boolean().default(true),
      /** When automatic delivery is not running, prepare a delivery draft for the seller to review. */
      prepareDrafts: z.boolean().default(true),
      notifyLowStock: z.boolean().default(true),
    })
    .prefault({}),
  pricing: z
    .object({
      /** Notify when a comparable competitor offer drops below the seller's price. */
      alertOnUndercut: z.boolean().default(true),
      /** Periodically read public category pages of the seller's own listings (off by default). */
      autoFetch: z.boolean().default(false),
      autoFetchIntervalMinutes: z
        .number()
        .int()
        .min(60)
        .max(24 * 60)
        .default(180),
      /** Automatic repricing never acts on competitor data older than this. */
      maxDataAgeMinutes: z
        .number()
        .int()
        .min(15)
        .max(24 * 60)
        .default(180),
    })
    .prefault({}),
  workflow: z
    .object({
      /** Global cap on live workflow actions per minute (loop / storm protection). */
      maxActionsPerMinute: z.number().int().min(1).max(120).default(20),
    })
    .prefault({}),
  dashboard: z
    .object({
      /** Overview section order (ids from features/dashboard/layout.ts; unknown ids are ignored). */
      overviewOrder: z
        .array(z.string().max(32))
        .max(20)
        .default(['kpis', 'automation', 'unconfirmed', 'recent', 'freshness']),
      /** Overview sections the seller chose to hide. */
      overviewHidden: z.array(z.string().max(32)).max(20).default([]),
    })
    .prefault({}),
  flags: z.record(z.string(), z.boolean()).default({}),
  shortcuts: z
    .object({
      /** Dashboard command palette shortcut, e.g. "Ctrl+K" ("Ctrl" also matches ⌘ on macOS). */
      commandPalette: z.string().max(40).default('Ctrl+K'),
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

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};
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
