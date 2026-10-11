import { z } from 'zod';

const offerId = z.string().regex(/^\d{1,12}$/);
const nodeId = z.string().regex(/^\d{1,10}$/);
/** Form-field overrides as accepted by `applyOfferChanges` (identity fields are refused there). */
const fieldChanges = z.record(z.string().min(1).max(64), z.string().max(20000));

/** RPC methods owned by the listings & bump area. */
export const LISTINGS_RPC = {
  // ---- bump ----------------------------------------------------------------------------------
  /** One-click raise: all selected games, or a single game. Allowed while paused, never during emergency stop. */
  'ui.bumpNow': { from: 'extension', params: z.object({ gameId: z.string().max(32).optional() }) },
  /** Profile → own lots pages → raise buttons; caches games in db.bumpState. Read-only on FunPay. */
  'ui.discoverBumpTargets': { from: 'extension', params: z.object({}) },
  /** Reset the failure streak of one game (or all) so automatic bumping resumes. Never bypasses cooldowns. */
  'ui.bump.resume': { from: 'extension', params: z.object({ gameId: z.string().max(32).optional() }) },
  // ---- bulk editing --------------------------------------------------------------------------
  /** Execute a plan previously stored by the dashboard in db.kv under `bulkplan:<planId>`. */
  'ui.bulkEdit.execute': { from: 'extension', params: z.object({ planId: z.string().min(1).max(80) }) },
  'ui.bulkEdit.cancel': { from: 'extension', params: z.object({ planId: z.string().min(1).max(80) }) },
  // ---- offers ----------------------------------------------------------------------------------
  /** Read an own offer's edit form (CSRF token and auto-delivery secrets are stripped). */
  'ui.fetchOfferForm': { from: 'extension', params: z.object({ offerId: z.string().min(1).max(32) }) },
  'ui.calcCommission': {
    from: 'extension',
    params: z.object({ nodeId: z.string().min(1).max(32), priceMinor: z.number().int().positive() }),
  },
  /** Create a copy of an own offer as a NEW offer (blank form offer_id=0 + offerSave). Explicit confirmation required. */
  'ui.clone.create': {
    from: 'extension',
    params: z.object({ sourceOfferId: offerId, nodeId, changes: fieldChanges, confirm: z.literal(true) }),
  },
  // ---- content script → background -----------------------------------------------------------
  /** Open the dashboard listing editor (e.g. for translation) from the FunPay offer editor. */
  'cs.openListingInDashboard': { from: 'content', params: z.object({ offerId }) },
} as const;

/**
 * Content-script commands owned by this area that are NOT yet part of `ContentCommandSchema`
 * (src/core/messaging/protocol.ts). Until they are merged into that discriminated union and
 * dispatched by src/content/executor.ts (see `runListingsContentCommand` in
 * src/content/enhancements/listings/commands.ts), the content script answers "Invalid command"
 * and the background reports that cloning/deletion is unavailable in this build — nothing is
 * ever changed on FunPay by accident.
 */
export const CreateOfferCommandSchema = z.object({
  action: z.literal('createOffer'),
  nodeId,
  changes: fieldChanges,
});
export const DeleteOfferCommandSchema = z.object({ action: z.literal('deleteOffer'), offerId });
export const LISTINGS_CONTENT_COMMANDS = [CreateOfferCommandSchema, DeleteOfferCommandSchema] as const;
export type ListingsContentCommand =
  z.infer<typeof CreateOfferCommandSchema> | z.infer<typeof DeleteOfferCommandSchema>;
