import { SEL } from '@/adapters/funpay/v1/selectors';

/**
 * The ONE place that lists which funpay.com elements the appearance/privacy enhancements touch.
 * Selectors come from the adapter's `SEL` map wherever it has them; the few it lacks are listed in
 * `EXTRA_SELECTORS` with their evidence and should move into `adapters/funpay/v1/selectors.ts`.
 *
 * `tests/unit/features/appearance/privacy-coverage.test.ts` checks every privacy selector against the
 * sanitized fixtures in tests/fixtures/funpay and that every known sensitive value in those
 * fixtures is covered.
 */
export const EXTRA_SELECTORS = {
  /** Profile owner name: `<div class="profile"><h1><span class="mr4">NAME` (research §B.2 profile DOM, §D.6). */
  profileName: '.profile h1 .mr4',
  /** Header of an open chat (research §D.3 "Chat page: .chat-header .media-user-name a"). */
  chatHeaderName: '.chat-header .media-user-name',
} as const;

export type PrivacyCategory = 'usernames' | 'chatPreviews' | 'orderIds' | 'balances';

/** What privacy mode blurs on funpay.com (balances are also blurred by "hide balances" alone). */
export const PRIVACY_TARGETS: Record<PrivacyCategory, readonly string[]> = {
  usernames: [SEL.userName, SEL.mediaUserName, SEL.chatMsgAuthorLink, EXTRA_SELECTORS.profileName, EXTRA_SELECTORS.chatHeaderName],
  chatPreviews: [SEL.contactMessage, SEL.chatMsgText],
  orderIds: [SEL.rowOrder, SEL.reviewOrderLink, `${SEL.financeRow} ${SEL.rowTitle}`],
  balances: [SEL.badgeBalance, `${SEL.financeRow} ${SEL.rowPrice}`],
};

/** Elements whose text is the seller's own nickname (styled by the nickname customisation). */
export const OWN_NAME_TARGETS = {
  /** Header name — always the logged-in user. */
  header: SEL.userName,
  /** Profile title — only on the user's own profile page. */
  profile: EXTRA_SELECTORS.profileName,
  /** Links to a user, filtered by the own user id at runtime. */
  chatAuthorLink: SEL.chatMsgAuthorLink,
  mediaUserName: SEL.mediaUserName,
} as const;

/**
 * Conservative colour-only targets for the experimental funpay.com dark theme. Mostly generic
 * Bootstrap 3 class names FunPay's markup is built on plus documented FunPay containers. Only
 * colours are changed (never sizes, positions or display), so layout cannot break.
 */
export const THEME_TARGETS = {
  surfaces: [
    '.tc',
    SEL.row,
    SEL.contactItem,
    '.chat',
    '.chat-contacts',
    '.chat-message-list',
    SEL.review,
    SEL.offerSection,
    '.profile',
    '.dyn-table',
    '.panel',
    '.well',
    '.dropdown-menu',
    '.modal-content',
    '.list-group-item',
    '.table',
    '.param-item',
  ],
  muted: ['.text-muted', SEL.contactTime, SEL.chatMsgDate, SEL.reviewDate, '.tc-date-left'],
  fields: ['input', 'textarea', 'select', '.form-control'],
  buttons: ['.btn-default'],
  rules: ['hr', SEL.pageHeader, '.page-header'],
  /** Order/finance rows FunPay highlights by status (paid = info, refunded/inactive = warning). */
  highlightedRows: { info: '.tc-item.info', warning: '.tc-item.warning' },
} as const;

/** Split a selector list on top-level commas (ignores commas inside (), [] and quotes). */
export function splitSelectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Prefix every selector of every list with `scope` (descendant combinator). */
export function scopeSelectors(scope: string, lists: readonly string[]): string {
  return lists
    .flatMap(splitSelectorList)
    .map((s) => `${scope} ${s}`)
    .join(',\n');
}

export function privacySelectorList(categories: readonly PrivacyCategory[]): string[] {
  return categories.flatMap((c) => PRIVACY_TARGETS[c].flatMap(splitSelectorList));
}
