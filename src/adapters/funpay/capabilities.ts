/**
 * Capability registry: the single source of truth for what FunPro can do on FunPay and how
 * confident we are in each integration.
 *
 *  - `evidenced`: the endpoint/markup is documented by independent open-source FunPay clients
 *    (see docs/research-notes-raw.md) but has NOT been verified by FunPro against the live site.
 *    Automations using these require the user's explicit "live actions" acknowledgement.
 *  - `verified`: tested by FunPro maintainers against the live site (record date + version).
 *  - `unsupported`: deliberately not implemented (policy or safety).
 */
export type CapabilityStatus = 'verified' | 'evidenced' | 'unsupported';

export interface Capability {
  id: string;
  status: CapabilityStatus;
  description: string;
  /** Changes seller data or sends something to another user. */
  mutating: boolean;
  evidence: string;
}

export const CAPABILITIES = {
  session: {
    id: 'session',
    status: 'evidenced',
    mutating: false,
    description: 'Detect login state from <body data-app-data> and header',
    evidence: 'research §D.1',
  },
  readOwnLots: {
    id: 'readOwnLots',
    status: 'evidenced',
    mutating: false,
    description: 'Read own offers from /lots/{node}/trade and profile',
    evidence: 'research §D.5, §D.6',
  },
  readOrders: {
    id: 'readOrders',
    status: 'evidenced',
    mutating: false,
    description: 'Read sales/purchases from /orders/trade and /orders/',
    evidence: 'research §D.4',
  },
  readChats: {
    id: 'readChats',
    status: 'evidenced',
    mutating: false,
    description: 'Read chat list (/chat/) and history (/chat/history)',
    evidence: 'research §D.3',
  },
  readReviews: {
    id: 'readReviews',
    status: 'evidenced',
    mutating: false,
    description: 'Read reviews on profile pages',
    evidence: 'research §D.6',
  },
  readFinance: {
    id: 'readFinance',
    status: 'evidenced',
    mutating: false,
    description: 'Read /account/balance transactions',
    evidence: 'research §D.7',
  },
  readPublicOffers: {
    id: 'readPublicOffers',
    status: 'evidenced',
    mutating: false,
    description: 'Read public offers of a category (competitor prices)',
    evidence: 'research §D.5',
  },
  commissionCalc: {
    id: 'commissionCalc',
    status: 'evidenced',
    mutating: false,
    description: 'Buyer prices per payment method via /lots/calc',
    evidence: 'research §D.5',
  },
  raise: {
    id: 'raise',
    status: 'evidenced',
    mutating: true,
    description: 'Raise offers via POST /lots/raise (server-enforced cooldown)',
    evidence: 'research §D.2',
  },
  sendMessage: {
    id: 'sendMessage',
    status: 'evidenced',
    mutating: true,
    description: 'Send chat messages via POST /runner/ chat_message',
    evidence: 'research §D.3',
  },
  editOffer: {
    id: 'editOffer',
    status: 'evidenced',
    mutating: true,
    description: 'Edit offers via /lots/offerEdit + /lots/offerSave',
    evidence: 'research §D.5',
  },
  replyReview: {
    id: 'replyReview',
    status: 'evidenced',
    mutating: true,
    description: 'Reply to reviews via POST /orders/review',
    evidence: 'research §D.6',
  },
  cloneOffer: {
    id: 'cloneOffer',
    status: 'evidenced',
    mutating: true,
    description:
      'Create a new offer from a blank form (offerEdit?node=N, offer_id=0) + offerSave — used by explicit cloning',
    evidence: 'research §D.5',
  },
  deleteOffer: {
    id: 'deleteOffer',
    status: 'evidenced',
    mutating: true,
    description: 'Delete offers (offerSave deleted=1) — only after explicit confirmation + backup',
    evidence: 'research §D.5',
  },
  refund: {
    id: 'refund',
    status: 'unsupported',
    mutating: true,
    description: 'Refunds are never automated by FunPro',
    evidence: 'policy',
  },
  withdraw: {
    id: 'withdraw',
    status: 'unsupported',
    mutating: true,
    description: 'Withdrawals are never automated by FunPro',
    evidence: 'policy',
  },
  readCookies: {
    id: 'readCookies',
    status: 'unsupported',
    mutating: false,
    description: 'FunPro never reads golden_key/PHPSESSID cookies',
    evidence: 'security policy',
  },
} as const satisfies Record<string, Capability>;

export type CapabilityId = keyof typeof CAPABILITIES;
