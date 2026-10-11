import type {
  ChatMessage,
  ChatSummary,
  CompetitorOffer,
  FinanceOperation,
  Listing,
  Order,
  OrderDirection,
  Review,
} from '@/shared/models';
import type { SessionInfo } from '@/shared/session';

/** Session info plus the CSRF token, which never leaves the content script. */
export interface PageSession extends SessionInfo {
  csrfToken: string | null;
}

export type ParsedListing = Omit<Listing, 'costMinor' | 'sortIndex' | 'seenAt' | 'updatedAt'>;
export type ParsedOrder = Omit<Order, 'firstSeenAt' | 'updatedAt' | 'history'>;
export type ParsedReview = Omit<Review, 'firstSeenAt'>;
export type ParsedFinanceOp = Omit<FinanceOperation, 'firstSeenAt'>;

export interface RaiseTarget {
  gameId: string;
  nodeId: string;
}

export type RaiseOutcome =
  | { kind: 'raised'; message: string; waitSec: number | null }
  | { kind: 'cooldown'; message: string; waitSec: number }
  | { kind: 'needs_selection'; nodeIds: string[] }
  | { kind: 'rejected'; message: string; waitSec: number }
  | { kind: 'error'; message: string; waitSec: number };

export interface OfferForm {
  offerId: string;
  nodeId: string | null;
  currencyText: string;
  /** Ordered list of form fields as the browser would submit them. */
  fields: [string, string][];
  buyerPrices: { method: string; priceText: string }[];
}

export type SystemMessageType =
  | 'order_paid'
  | 'order_confirmed'
  | 'review_new'
  | 'review_changed'
  | 'review_deleted'
  | 'review_replied'
  | 'order_reopened'
  | 'refund'
  | 'partial_refund'
  | 'admin'
  | 'safety_notice'
  | 'confirm_reminder'
  | 'other';

export interface SystemMessageInfo {
  type: SystemMessageType;
  orderId: string | null;
  /** Buyer username mentioned in the system text, if any. */
  buyerName: string | null;
}

/**
 * The parsing half of the adapter: pure functions from FunPay markup to FunPro models.
 * They run in the content script (DOMParser available) and in tests (fixtures).
 */
export interface FunPayParser {
  readonly version: string;
  parseSession(doc: Document, now?: number): PageSession;
  parseOwnLotsPage(doc: ParentNode, nodeId: string): { listings: ParsedListing[]; raise: RaiseTarget | null };
  parseProfileOffers(doc: ParentNode): ParsedListing[];
  parsePublicOffers(doc: ParentNode, nodeId: string): CompetitorOffer[];
  parseOrders(
    doc: ParentNode,
    direction: OrderDirection,
    now?: Date,
  ): { orders: ParsedOrder[]; continueToken: string | null };
  parseChatList(doc: ParentNode, now?: Date): Omit<ChatSummary, 'pinned' | 'updatedAt'>[];
  parseChatMessages(doc: ParentNode, chatId: string, selfUserId: string | null, now?: Date): ChatMessage[];
  parseChatHistoryJson(json: unknown, chatId: string, selfUserId: string | null): ChatMessage[];
  parseReviews(doc: ParentNode, now?: Date): ParsedReview[];
  parseFinance(doc: ParentNode, now?: Date): ParsedFinanceOp[];
  parseOfferForm(doc: ParentNode): OfferForm | null;
  parseRaiseModal(html: string): string[];
  parseRaiseResponse(status: number, json: unknown): RaiseOutcome;
  classifySystemMessage(text: string): SystemMessageInfo | null;
}
