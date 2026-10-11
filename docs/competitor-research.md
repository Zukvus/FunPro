# Competitor research

Collected 2026-10-11. Raw notes with file/line citations: [`research-notes-raw.md`](research-notes-raw.md).

## How this was researched, and what could not be checked

| Source                                         | Accessed?                         | How                                                                                                                               |
| ---------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| https://funpaylitebot.com/en, `/changelog`     | **No** (egress proxy/DNS refused) | Search-engine summaries only. Details marked _unverified_.                                                                        |
| https://github.com/sibamor/Wingman             | Yes                               | Shallow clone of v0.18.1 (GPL-3.0): README, source and test fixtures read.                                                        |
| https://github.com/XaviersDev/FunPay-Tools     | Yes                               | Shallow clone of manifest 2.9.9 (MIT): README and source read.                                                                    |
| https://funpay.tools/                          | **No**                            | Only the GitHub repo above.                                                                                                       |
| https://funpay.com/trade/info (rules)          | **No**                            | Rule statements come from FunPay's own system-message texts found in open-source code, plus secondary sources. See _Rules_ below. |
| `sidor0912/FunPayCardinal` (bundles FunPayAPI) | Yes                               | Read for **facts only**. It has no license file, so no code was copied.                                                           |
| Chrome Web Store / AMO reviews                 | **No**                            | Blocked. No store reviews were collected.                                                                                         |

No proprietary code, branding, artwork or UI assets were copied. FunPro re-implements the documented _capabilities_ independently.

## Legend

- **Support**: ✅ supported · 🟡 supported in an advisory/manual form, or needs live verification · ⛔ deliberately not supported (rules, safety or platform limits) · ❌ not planned.
- **Priority**: P0 core parity · P1 high value · P2 useful · P3 nice to have.
- The current implementation status of each FunPro feature is tracked in [`FEATURES.md`](FEATURES.md).

## 1. FunPay Lite Bot (closed source; features from public summaries, unverified)

| Feature                                             | Purpose / workflow                                                | Support | Priority | Notes                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Auto-bump (auto-raise) per category                 | Keep offers at the top. Raises again when FunPay's cooldown ends. | ✅      | P0       | The cooldown comes from FunPay's own reply, never a fixed timer. Needs an open FunPay tab.                        |
| Manual one-click bump                               | Raise now.                                                        | ✅      | P0       |                                                                                                                   |
| Bump success/failure notifications                  | Show the seller what happened.                                    | ✅      | P0       |                                                                                                                   |
| Promo-lot indicators / promo lots view              | See which lots are promoted.                                      | ✅      | P1       | Uses the `offer-promo` class.                                                                                     |
| "Exact pricing" (buyer/seller price to the cent)    | Enter the exact buyer-facing price.                               | 🟡      | P0       | Buyer⇄seller conversion uses the commission FunPay's own calculator reports.                                      |
| Auto-translation of lots into English               | Fill the EN fields.                                               | ✅/🟡   | P1       | Uses the browser's built-in Translator API or the user's AI provider. Writes go through preview → backup → queue. |
| Keyword auto-replies                                | Answer frequent questions.                                        | ✅      | P0       | Loop prevention, cooldowns, quiet hours, approval mode.                                                           |
| Fast messages / quick replies                       | Insert templates fast.                                            | ✅      | P0       | Slash commands in FunPay's chat box. FunPro never auto-sends from the page.                                       |
| Sales statistics (daily/weekly/per game)            | Understand revenue.                                               | ✅      | P0       | Per-currency only. Currencies are never mixed.                                                                    |
| Purchase statistics                                 | Track own purchases.                                              | ✅      | P1       |                                                                                                                   |
| Sales/purchase export (Excel)                       | Accounting.                                                       | ✅      | P0       | CSV, JSON and XLSX (own XLSX writer, no vulnerable SheetJS).                                                      |
| Dark theme, named themes, theme editor              | Comfort.                                                          | ✅      | P1       | Original themes only.                                                                                             |
| Custom background image                             | Personalisation.                                                  | ✅      | P2       | Stored locally as a Blob.                                                                                         |
| Custom notification sounds (sales/messages/reviews) | Audible alerts.                                                   | ✅      | P1       | Original sounds plus user uploads. Uses an offscreen document on Chrome.                                          |
| Nickname styling visible to other users             | Social.                                                           | ⛔      | P3       | Needs an opt-in sync service, which does not exist. Local-only styling is supported.                              |
| Paid tiers (Community/Pro/Premium)                  | Monetisation.                                                     | ❌      | —        | FunPro is GPL-3.0 and free.                                                                                       |

## 2. Wingman (GPL-3.0, browser extension, closest analogue)

| Feature                                                                         | Purpose / workflow       | Support | Priority | Notes                                                                               |
| ------------------------------------------------------------------------------- | ------------------------ | ------- | -------- | ----------------------------------------------------------------------------------- |
| Auto-raise on FunPay's timer, per section, with exclusions                      | Bumping.                 | ✅      | P0       |                                                                                     |
| Bulk edit: price set / ±% / ±₽, amount, enable/disable                          | Mass changes.            | ✅      | P0       | FunPro adds dry-run preview, backup, cancel, progress and partial-failure recovery. |
| Buyer price vs seller income using section commission; cost & profit            | Margin awareness.        | ✅      | P0       | Profit is labelled as an _estimate_.                                                |
| Price rank in section, alert when undercut                                      | Competitive awareness.   | ✅      | P1       | Collected only from public category pages.                                          |
| One-click lot copy                                                              | Faster listing creation. | 🟡      | P1       | Own lots only. Needs live verification.                                             |
| EN description via the browser's translator                                     | Localisation.            | ✅      | P1       |                                                                                     |
| Sales/purchase filters, CSV export                                              | Order management.        | ✅      | P0       |                                                                                     |
| Analytics on own profile (earnings by day, best sections, reviews by rating)    | Insights.                | ✅      | P0       |                                                                                     |
| Withdraw helper (wallet labels, repeat withdrawal)                              | Payouts.                 | ⛔      | —        | FunPro never automates money movement. Withdrawals stay manual.                     |
| Reminders about undelivered orders; daily summary to Telegram                   | Prevent disputes.        | ✅      | P1       | Unconfirmed-order aging plus Telegram summary.                                      |
| Reply templates with variables, Alt+1…9 hotkeys                                 | Speed.                   | ✅      | P0       | Slash commands plus the command palette.                                            |
| Full-text search across conversations                                           | Support.                 | ✅      | P2       | Searches locally stored history only.                                               |
| Buyer notes, tags, pinned dialogs, buyer card                                   | CRM.                     | ✅      | P2       |                                                                                     |
| Buyer blacklist                                                                 | Risk management.         | 🟡      | P2       | A CRM tag that auto-replies can exclude.                                            |
| Warning on messages impersonating administration                                | Anti-scam.               | ✅      | P1       | `needsHumanAttention` heuristics.                                                   |
| Greeting, keyword replies, thanks after confirmation, review replies, away mode | Automation.              | ✅      | P0       |                                                                                     |
| Limits: 15 msgs / 10 min, pause after the seller's own reply, flood pause       | Safety.                  | ✅      | P0       | Same limits, enforced centrally in the outbox.                                      |
| Notifications, quiet hours, Telegram mirror                                     | Awareness.               | ✅      | P0/P1    |                                                                                     |
| Ctrl+K navigation                                                               | Speed.                   | ✅      | P2       |                                                                                     |
| Dark themes, privacy mode                                                       | Comfort, streaming.      | ✅      | P1       |                                                                                     |
| Confirmation before irreversible actions                                        | Safety.                  | ✅      | P0       |                                                                                     |

## 3. FP Tools (MIT, browser extension)

| Feature                                                                              | Purpose / workflow     | Support | Priority | Notes                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ---------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AI chat assistant, lot text generator, review replies, translator                    | Writing help.          | ✅      | P1       | Bring-your-own-key, with explicit consent and redaction. FunPro has **no own server**, while FP Tools relays through third-party servers. |
| AI lot image generator                                                               | Visuals.               | ❌      | P3       | Out of scope.                                                                                                                             |
| "AI shop audit", "smart UI tweak"                                                    | Advice.                | 🟡      | P2       | `suggestListingImprovements`. No natural-language CSS injection, for security.                                                            |
| Themes, GIF backgrounds, live CSS styler, Unicode fonts, cursor effects              | Personalisation.       | 🟡      | P3       | Themes and backgrounds only. No arbitrary CSS or script injection.                                                                        |
| Lot export/import to file                                                            | Backup, migration.     | ✅      | P0       | JSON and XLSX round trip.                                                                                                                 |
| Copy **any** lot, including other sellers'                                           | Speed.                 | ⛔      | —        | Only the seller's own listings and their own templates (copyright/ToS).                                                                   |
| Bulk edit with find & replace; inline price edit                                     | Mass changes.          | ✅      | P0       |                                                                                                                                           |
| Bulk delete / duplicate / disable                                                    | Mass changes.          | ✅      | P0       | Delete needs a typed confirmation and a backup first.                                                                                     |
| Mass clone to many categories                                                        | Expansion.             | 🟡      | P2       | One clone at a time, with preview.                                                                                                        |
| Click-to-copy order id                                                               | Speed.                 | ✅      | P0       |                                                                                                                                           |
| Seller search by nick with revenue estimates                                         | Market intel.          | ❌      | P3       | Profiling other users is not offered.                                                                                                     |
| Market analytics per category                                                        | Pricing.               | ✅      | P1       | Pricing intelligence.                                                                                                                     |
| Smart auto-raise reading the server's wait message                                   | Bumping.               | ✅      | P0       |                                                                                                                                           |
| Telegram notifications and bot commands (/bump, /chats)                              | Remote control.        | 🟡      | P1       | Notifications plus `/status` and `/stop` (with confirmation). No remote sending.                                                          |
| Discord webhook                                                                      | Notifications.         | ❌      | P3       |                                                                                                                                           |
| Order timer (red when < 6 h)                                                         | Avoid disputes.        | ✅      | P1       | Unconfirmed-order aging buckets.                                                                                                          |
| Autoresponder: greeting, paid/confirmed triggers, per-star review replies, variables | Automation.            | ✅      | P0       |                                                                                                                                           |
| **"Bonus for 5★ review"**                                                            | Incentivised reviews.  | ⛔      | —        | Rewarding ratings is review manipulation. Not built.                                                                                      |
| Typing imitation                                                                     | Make bots look human.  | ⛔      | —        | Deceptive. Not built.                                                                                                                     |
| Images in templates                                                                  | Rich replies.          | ❌      | P3       | Not evidenced for safe automation.                                                                                                        |
| Auto-deactivate lot when stock runs out                                              | Inventory.             | 🟡      | P2       | FunPro inventory raises low-stock alerts and can push stock to FunPay's **native** auto-delivery.                                         |
| Multi-account manager                                                                | Agencies.              | ⛔      | —        | Would need cookie handling (`golden_key`). FunPro never reads session cookies.                                                            |
| Shared seller chat / friend-or-foe marker (external servers)                         | Community.             | ⛔      | —        | Needs a server that receives user data. Not offered.                                                                                      |
| Support tickets from the menu                                                        | Disputes.              | 🟡      | P1       | Ticket _drafts_ that the seller submits manually.                                                                                         |
| Reads `golden_key`/`PHPSESSID` via `chrome.cookies`                                  | Implementation detail. | ⛔      | —        | FunPro has no `cookies` permission.                                                                                                       |

## 4. FunPay's own capabilities that matter

| Capability                                                      | FunPro usage                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Native auto-delivery (`auto_delivery` + `secrets` offer fields) | This is the platform's own, permitted delivery mechanism. FunPro can push stock into it, with explicit confirmation. |
| Server-enforced raise cooldown                                  | FunPro obeys it and never attempts to bypass it.                                                                     |
| Commission calculator `/lots/calc`                              | Source of commission percentages, never hard-coded.                                                                  |
| No public API                                                   | Every integration is evidenced by open-source clients and marked _requires live verification_ until it is verified.  |

## 5. Publicly verifiable user requests

- **FP Tools issue #1 "Пофикси"** (https://github.com/XaviersDev/FunPay-Tools/issues/1). Users asked for:
  - better contrast;
  - links that can be told apart from text;
  - faster chat switching;
  - **fewer requests**: 429 errors appeared when several extensions polled at once;
  - no duplicate promo badge;
  - no buyer price on currency lots.

  FunPro's response: a single serialized, rate-limited transport (≥ 2.5 s between requests), passive parsing of pages the seller already opened, no chat polling faster than the configured interval (default 2 min), and contrast-checked themes.

- **Wingman:** no issues (https://github.com/sibamor/Wingman/issues). Its feedback goes through Telegram and Discord, which were not reachable.
- **Lite Bot / funpay.tools** feedback channels (Telegram, Discord, store reviews) were not reachable. **We do not claim any feature is popular** beyond the fact that all three tools independently implement it.

## 6. Original enhancement ideas (not verified as user requests)

FunPro proposes these itself. They are **not** backed by public requests.

- Baseline-safe automation: the first sync never triggers messages to past buyers.
- Durable task queue with crash-uncertainty handling: a message is never re-sent after an ambiguous failure.
- Capability registry (evidenced/verified/unsupported) shown in the UI, plus a live-actions acknowledgement.
- Repricing simulator over historical snapshots, with anti-price-war guards (cooldown, daily caps, oscillation detection).
- Encrypted local inventory with unique reservation per order, plus a push to FunPay's native auto-delivery.
- WHEN/IF/THEN workflow builder with dry-run, conflict detection and loop prevention.
- Template linter that warns about off-platform contacts (a FunPay rule).
- Diagnostics report that is redacted by construction.

## 7. Rules and technical limitations

**Read the official rules at https://funpay.com/trade/info before enabling automation.** We could not access them from the research environment. Strong evidence (FunPay's own system messages, KB snippets):

1. **Exchanging contact details or moving communication off FunPay is a violation.** FunPro's template linter warns about this. Telegram integration is for the seller's own notifications only and must never be used to move buyers off-platform.
2. Sellers should verify payment in «Мои продажи» before delivering. FunPro reacts to order status from the sales page, not to chat text.

The following are unverified and treated conservatively:

- no early pressure to confirm orders (the linter warns);
- prohibited goods;
- no advertising of other marketplaces;
- automation (auto-raise, auto-replies) is neither explicitly allowed nor forbidden in any text we could read.

FunPro therefore:

- keeps every automation **off by default**;
- requires an explicit acknowledgement before any live action;
- respects the server-side cooldowns;
- rate-limits all requests;
- never bypasses CAPTCHA or anti-abuse measures.

Technical limitations:

- There is no official API; markup can change at any time. That is why the adapter is versioned and fixture-tested.
- Actions require an open, logged-in FunPay tab, so there is **no 24/7 operation** with the browser closed.
- FunPay exposes no impression data, so conversion rates are unavailable.
- There is no reorder endpoint, so FunPay-side reordering is blocked.
- There is no buyer-rating endpoint for sellers.
