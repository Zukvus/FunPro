# Security

This document covers FunPro's threat model, the controls it relies on, and the residual risks. Report vulnerabilities privately through the repository's security advisories. Do not open public issues for them.

## Threat model

| Asset                                                                  | Threats                                                                                | Controls                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FunPay session (`golden_key`, `PHPSESSID`)                             | Exfiltration by the extension or a compromised dependency; leakage through logs.       | No `cookies` permission. Cookies are never read. Requests use the browser's own same-origin credentials from the content script. The logger redacts cookie-like strings.                                                                                                                                                                                                                        |
| CSRF token                                                             | Leakage to other contexts.                                                             | Read from the live page each time. It never leaves the content script, and `stripCsrf()` removes it before session info is sent to the background.                                                                                                                                                                                                                                              |
| Seller data: orders, chats, finance                                    | Unwanted transmission, XSS.                                                            | Local-first: no backend and no telemetry. External integrations are opt-in and disabled while local-only mode is on. Site-derived text is rendered only as React text or `textContent`. ESLint forbids `innerHTML`/`outerHTML` assignment.                                                                                                                                                      |
| Digital inventory (keys, codes)                                        | Disclosure, double delivery.                                                           | AES-GCM encryption with a non-extractable per-device key. A SHA-256 fingerprint gives uniqueness. Items are reserved in a single transaction (one delivery record per order). Uncertain sends are never retried. Automatic delivery only for fresh orders and never for offers FunPay delivers itself. Items never appear in notifications, Telegram, backups (unless opted in) or AI requests. |
| FunPro settings (templates, rules, Telegram chat id, AI configuration) | Read through the content script's storage access by a compromised funpay.com renderer. | Chrome: `storage.local` is restricted to extension pages and the service worker. Content scripts see only a page mirror (privacy flags, appearance, request spacing). Firefox has no equivalent API (residual risk below).                                                                                                                                                                      |
| API keys (AI, Telegram)                                                | Theft by page scripts or logs.                                                         | Encrypted with the device key and stored in the extension-origin IndexedDB, which content scripts cannot read. Never in `storage.local`, never sent to content scripts, redacted in logs and diagnostics.                                                                                                                                                                                       |
| Seller's FunPay account standing                                       | Rate limiting or bans through aggressive automation.                                   | Automation is off by default. A live-actions acknowledgement is required. Server cooldowns are respected. Requests are serialized 2.5 s apart by default (never under 1 s), with backoff on 429 and server errors. Automatic messages are capped at 15 per 10 min with a 3 s gap and a flood pause. Emergency stop is always available.                                                         |
| Money                                                                  | Accidental financial actions.                                                          | Refund, withdrawal, currency-switch and wallet endpoints are absent from the transport allow-list, so they are unreachable by construction.                                                                                                                                                                                                                                                     |

## Controls

### Least privilege

- Required permissions:
  - `storage`, `unlimitedStorage`: local data.
  - `alarms`: MV3 scheduling.
  - `notifications`
  - `offscreen` (Chrome only): audio.
- Host permission: `https://funpay.com/*` only.
- Optional host permissions, requested only when the user enables the integration:
  - `api.telegram.org`
  - `api.openai.com`, `api.anthropic.com`, `openrouter.ai`
  - `localhost` / `127.0.0.1` (local LLMs)
- Not requested: `cookies`, `tabs`, `webRequest`, `scripting` or `<all_urls>`. The e2e suite asserts this.

### Storage areas

| Area                | Holds                                                                                       | Who can read it                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension IndexedDB | All seller data, encrypted inventory, encrypted API keys, the device key (non-extractable). | Extension pages and the service worker. Content scripts run in the funpay.com origin and cannot open it.                                                  |
| `storage.local`     | Settings, the last FunPay session badge, a copy of the page mirror.                         | Chrome: extension pages and the service worker only (`setAccessLevel('TRUSTED_CONTEXTS')`, applied on every worker start). Firefox: also content scripts. |
| `storage.session`   | Page mirror, FunPay tab registry, notification click URLs.                                  | Chrome: also FunPro's content scripts. A test keeps this area to these keys.                                                                              |

Content scripts never read the settings themselves. The background writes the page mirror (`src/core/settings/page-mirror.ts`) whenever settings change. Right after a browser restart, before the background has written the mirror, the document_start privacy script asks the background directly. If `storage.session` cannot be opened to content scripts, `storage.local` is reopened so the privacy blur keeps working, and a warning is logged. Diagnostics report the outcome (`settingsStorageAccess`).

### Content Security Policy

Extension pages use `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. FunPro does not load remote code, does not use `eval`/`new Function` (forbidden by lint), and loads no third-party fonts or CDN assets.

### Message passing

- Every runtime message is validated with zod.
- Senders are classified as extension page, own content script on `https://funpay.com`, or untrusted, and each RPC method declares which senders may call it.
- Content scripts accept commands only from the extension background.
- What a content script may ask the background for is limited: page settings, aggregates for the sales statistics panel (the buyer names in its top lists are also on the page), panel preferences (it can hide the panel but never turn it back on), opening two fixed dashboard pages, and starting the sales history import (requests a funpay.com page could make anyway, through the same rate-limited transport).
- Unknown and invalid messages are rejected and logged without their payload.

### Untrusted input

- Ingested data is re-validated in the background.
- `cleanText` strips control, zero-width and bidi characters.
- Links are rendered only when `safeFunPayUrl` accepts them.
- Imports (JSON/XLSX/CSV) are size-limited and schema-validated. The XLSX reader has zip-bomb protection.
- CSV export escapes formula injection.
- User regexes in rules are length- and complexity-limited.

### Logging

The logger redacts by key name (`token`, `secret`, `cookie`, `golden`, `csrf`, `apiKey`, `inventory` and others) and by value shape (bot tokens, bearer tokens, `sk-` keys, long hex strings, cookie assignments). It also truncates long values. Diagnostic reports are generated from already-redacted data and are tested for absence of secrets.

### Exports and backups

- Backups exclude secrets and keys.
- Inventory is included only on explicit opt-in.
- Backups can be encrypted with a passphrase: PBKDF2-SHA256 (310k iterations) and AES-GCM. Tampering or a wrong passphrase fails closed.

### Automation safety

- Baseline guard: historical data never triggers buyer-facing actions. Order pages opened with filters or paging store unknown orders silently.
- Idempotency keys on every outgoing action.
- Loop prevention: FunPro reacts only to `customer` messages, never to its own or system messages, and pauses after the seller replies manually.
- Workflow actions cannot retrigger workflows. Workflow replies use the auto-reply guards (seller replied, manual pause, per-chat hourly cap, quiet hours) and become drafts when blocked.
- Every unattended send (auto-replies, welcome, post-order, delivery, workflows, scheduled messages) needs the live-actions confirmation. The outbox checks this centrally.
- Automatic delivery only for orders with a known time, at most 30 minutes old and newer than the sales baseline. It never runs for offers covered by FunPay's native auto-delivery. A multi-unit order, or a seller message in the chat after the order, turns the delivery into a draft.
- The emergency stop cancels queued tasks and halts every request FunPro would make on its own: sends, raises, background chat polling and history fetches, competitor fetches and repricing. Offer changes (bulk edits, cloning, price apply, goods push) are refused while it is active.
- Restoring a backup never restores consent: AI and Telegram consent, Telegram remote commands and previews, and automatic review posting are reset.

## Residual risks and limitations

- **Device compromise.** Anyone with access to the unlocked browser profile can use the extension and decrypt data, because the device key lives in the same profile. Passphrase-encrypted exports protect files at rest only.
- **Unverified integrations.** FunPay endpoints and markup are documented by open-source clients but have not been live-verified by FunPro maintainers. Markup changes may break parsing. Parsers fail closed: unknown structures yield no data rather than wrong data.
- **Platform rules.** Automation legality on FunPay is not explicitly documented anywhere we could access. The user is responsible for complying with https://funpay.com/trade/info.
- **AI providers.** Text the seller chooses to send to an AI provider leaves the device and is governed by that provider's policy. FunPro asks for consent first and minimises what it sends (redaction).
- **Firefox storage access.** Firefox has no `storage.local.setAccessLevel`, so FunPro's content scripts there can still read the settings (not the encrypted inventory or API keys, which live in IndexedDB). A compromised funpay.com renderer could read templates, rules and the Telegram chat id.
- **Offer saves resubmit the goods list.** FunPay's offer editor saves the whole form. Price edits, bulk edits and goods pushes load the form in the FunPay tab and save it one request gap later (2.5 s by default). A good FunPay hands out in that window could be written back. FunPay's own editor has the same window, only longer. See [known limitations](KNOWN-LIMITATIONS.md).

## Security review (October 2026)

A separate review pass over the integrated build, done during development (not a third-party audit), found no critical issues. All findings are fixed and covered by tests:

| ID  | Severity | Finding                                                                                                                                         | Fix                                                                                                                                                                                                                                    | Tests                                                                                                                |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| H1  | High     | Automatic delivery could fire for old orders (filtered or paged order lists, unknown order time) and for offers FunPay already delivers itself. | Freshness gate (known time, ≤ 30 min, after the baseline). Skip offers with native auto-delivery and pools pushed to FunPay. Draft when the seller wrote after the order or for multi-unit orders. Silent ingestion of filtered views. | `features/inventory/delivery.test.ts`, `background/ingest-silent.test.ts`, `features/orders/pagination-sync.test.ts` |
| M1  | Medium   | Workflow replies bypassed the live-actions confirmation and the auto-reply guards.                                                              | Central confirmation check in the outbox for every unattended source. Workflow `send_reply` uses the auto-reply guards and prepares a draft when blocked.                                                                              | `background/outbox.test.ts`, `features/workflow/engine.test.ts`                                                      |
| M2  | Medium   | Goods could leave the encrypted store through backups (delivery drafts), the reply ledger and AI transcripts.                                   | Delivery drafts are excluded from backups. The reply ledger keeps no delivery text and is pruned after 30 days. Stored items are replaced in AI transcripts.                                                                           | `features/backup/backup.test.ts`, `features/ai/inventory-redaction.test.ts`                                          |
| M3  | Medium   | Order quantity was read from any number in the title, which could over-deliver.                                                                 | Only FunPay's trailing `, N шт.` / `, N pcs.` suffix counts (shared parser with the orders module).                                                                                                                                    | `features/orders/orders-core.test.ts`, `features/inventory/reservation.test.ts`                                      |
| L1  | Low      | Pushing stock to FunPay's auto-delivery wrote back a goods list read earlier, and the background received the goods list and the CSRF token.    | The FunPay tab appends to a freshly loaded list and saves it in one step. Offer forms reach the background without the token and goods (size only). `saveOffer` cannot set either.                                                     | `adapters/offer-secrets.test.ts`, `features/inventory/push.test.ts`                                                  |
| L2  | Low      | Goods push and manual price apply ignored the emergency stop and the live-actions confirmation.                                                 | Both are refused like bulk edits and cloning.                                                                                                                                                                                          | `background/stop-guards.test.ts`                                                                                     |
| L3  | Low      | Content scripts could read all settings from `storage.local`.                                                                                   | Chrome: access levels plus a page mirror (see _Storage areas_). Firefox: residual risk.                                                                                                                                                | `core/page-mirror.test.ts`, `e2e/storage-access.spec.ts`                                                             |
| L4  | Low      | The emergency stop did not halt background chat polling, history fetches or competitor fetches.                                                 | All three check the stop.                                                                                                                                                                                                              | `background/stop-guards.test.ts`                                                                                     |
| L5  | Low      | Restoring a backup restored AI/Telegram consent, remote commands and automatic review posting.                                                  | Restore resets them; the seller opts in again.                                                                                                                                                                                         | `features/backup/backup.test.ts`                                                                                     |
| I1  | Info     | Unused POST endpoints were on the transport allow-list.                                                                                         | Removed (`/users/transactions`, `/users/reviews`).                                                                                                                                                                                     | `adapters/parser.test.ts`                                                                                            |

## Security review checklist (release gate)

- [ ] `pnpm lint` passes with the `innerHTML`/`eval` rules.
- [ ] The e2e manifest permission assertions pass.
- [ ] The transport allow-list tests pass (no money-moving endpoints).
- [ ] The diagnostics/backup "no secrets" tests pass.
- [ ] `e2e/storage-access.spec.ts` passes (content scripts are denied `storage.local` in Chromium).
- [ ] The `storage.session` key guard in `core/page-mirror.test.ts` passes.
- [ ] `grep -r "cookies" src` shows no use of the cookies API.
- [ ] Dependencies were reviewed (`pnpm audit`) and no remote code is loaded.
