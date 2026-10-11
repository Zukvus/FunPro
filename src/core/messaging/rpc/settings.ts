import { z } from 'zod';

/** Literal the wipe RPC requires, so that no stray/forged call can delete data. */
export const WIPE_CONFIRMATION = 'DELETE_ALL_LOCAL_DATA';

/** RPC methods owned by the settings area (appearance, privacy, backup, diagnostics). */
export const SETTINGS_RPC = {
  /**
   * funpay.com content script → background: the user's background image as a data URL (≤ 3 MB
   * image), only when "theme funpay.com" is on. Content scripts cannot read extension IndexedDB.
   * Returns `{ dataUrl, opacity, assetId } | null`.
   */
  'cs.getBackgroundImage': { from: 'content', params: z.object({}) },
  /** Delete ALL local data (IndexedDB incl. secrets/keys/assets, storage.local, storage.session). */
  'ui.wipeAllData': { from: 'extension', params: z.object({ confirm: z.literal(WIPE_CONFIRMATION) }) },
  /** Background-side diagnostics (alarms, tracked tabs, session status) — no personal data. */
  'ui.diagnostics': { from: 'extension', params: z.object({}) },
} as const;
