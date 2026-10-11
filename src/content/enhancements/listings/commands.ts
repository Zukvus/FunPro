/**
 * Content-script side of the listings-owned commands (`LISTINGS_CONTENT_COMMANDS` in
 * src/core/messaging/rpc/listings.ts): explicit offer creation (cloning) and deletion.
 *
 * Wiring (owned by the core executor): add the schemas to `ContentCommandSchema` and dispatch
 * `case 'createOffer': case 'deleteOffer': return runListingsContentCommand(cmd, actions);`
 * in src/content/executor.ts. Until then the executor answers "Invalid command" and the background
 * reports the action as unavailable — nothing is changed on FunPay.
 */
import type { FunPayActions } from '@/adapters/funpay';
import {
  CreateOfferCommandSchema,
  DeleteOfferCommandSchema,
  type ListingsContentCommand,
} from '@/core/messaging/rpc/listings';

export async function runListingsContentCommand(
  cmd: ListingsContentCommand,
  actions: FunPayActions,
): Promise<unknown> {
  switch (cmd.action) {
    case 'createOffer': {
      const c = CreateOfferCommandSchema.parse(cmd);
      return actions.createOffer(c.nodeId, c.changes);
    }
    case 'deleteOffer': {
      const c = DeleteOfferCommandSchema.parse(cmd);
      return actions.deleteOffer(c.offerId);
    }
  }
}
