/**
 * ALL FunPay DOM selectors used by FunPro live in this file.
 *
 * Evidence: every selector is documented in docs/research-notes-raw.md §B.2/§D with the open-source
 * project it was observed in (Wingman, FunPayAPI). None has been verified by us against the live
 * site; when FunPay changes markup, add a new adapter version (v2) instead of patching features.
 */
export const SEL = {
  appDataAttr: 'data-app-data',
  userName: '.user-link-name',
  logoutLink: 'a.menu-item-logout',
  badgeTrade: '.badge.badge-trade',
  badgeOrders: '.badge.badge-orders',
  badgeBalance: '.badge.badge-balance',
  badgeChat: '.badge.badge-chat',

  // Tables (lots, orders, finance)
  row: 'a.tc-item, div.tc-item',
  rowDescText: '.tc-desc-text',
  rowPrice: '.tc-price',
  rowAmount: '.tc-amount',
  rowAutoDelivery: 'i.auto-dlv-icon',
  rowDate: '.tc-date-time',
  rowOrder: '.tc-order',
  rowStatus: '.tc-status',
  rowTitle: '.tc-title',
  orderDesc: '.order-desc',
  orderDescMuted: '.order-desc .text-muted',
  mediaUserName: '.media-user-name',
  userHrefAttr: '[data-href*="/users/"]',
  continueInput: 'input[name="continue"]',
  pageHeader: 'h1.page-header',

  // Profile owner name: <div class="profile"><h1><span class="mr4">NAME (research §B.2, §D.6)
  profileName: '.profile h1 .mr4',

  // Offer sections on a profile
  offerSection: '.offer',
  offerSectionTitleLink: '.offer-list-title h3 a',

  // Own lots page /lots/{node}/trade
  raiseButton: 'button.js-lot-raise',
  raiseModalCheckbox: '.checkbox input[type="checkbox"], input[type="checkbox"][value]',

  // Offer edit form
  offerForm: 'form.form-offer-editor',
  offerCurrency: '.form-control-feedback',
  buyerPricesRow: 'table.table-buyers-prices tr',

  // Chat
  contactItem: 'a.contact-item',
  contactMessage: '.contact-item-message',
  contactTime: '.contact-item-time',
  chatMsgItem: '.chat-msg-item',
  chatMsgText: '.chat-msg-text',
  chatMsgAuthorLink: 'a.chat-msg-author-link',
  chatMsgAuthorLabel: '.chat-msg-author-label',
  chatMsgDate: '.chat-msg-date',
  /** Partner name in the header of an open chat (research §D.3). */
  chatHeaderName: '.chat-header .media-user-name',
  chatForm: '.chat-form, form.chat-form',
  chatInput: '.chat-form-input textarea, textarea[name="content"]',

  // Reviews
  review: '.review-container',
  reviewRating: '.rating > div',
  reviewAuthor: '.review-item-user .media-user-name a, .media-user-name a',
  reviewOrderLink: '.review-item-order a',
  reviewDate: '.review-item-date',
  reviewDetail: '.review-item-detail',
  reviewText: '.review-item-text',
  reviewReply: '.review-compiled-reply',

  // Finance
  financeRow: '.tc-item[data-transaction]',
} as const;

export const ADAPTER_VERSION = 'funpay-dom-v1';
