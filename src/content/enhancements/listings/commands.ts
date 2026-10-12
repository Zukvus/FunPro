/**
 * Content-script side of the listings-owned commands (`LISTINGS_CONTENT_COMMANDS` in
 * src/core/messaging/rpc/listings.ts): explicit offer creation (cloning) and deletion.
 *
 * Dispatched by src/content/executor.ts after `ContentCommandSchema` validation; the schemas are
 * re-checked here so this function is safe on its own.
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
