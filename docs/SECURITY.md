# Security

This document covers FunPro's threat model, the controls it relies on, and the residual risks. Report vulnerabilities privately through the repository's security advisories. Do not open public issues for them.

## Threat model

| Asset                                      | Threats                                                                          | Controls                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FunPay session (`golden_key`, `PHPSESSID`) | Exfiltration by the extension or a compromised dependency; leakage through logs. | No `cookies` permission. Cookies are never read. Requests use the browser's own same-origin credentials from the content script. The logger redacts cookie-like strings.                                                                                                                  |
| CSRF token                                 | Leakage to other contexts.                                                       | Read from the live page each time. It never leaves the content script, and `stripCsrf()` removes it before session info is sent to the background.                                                                                                                                        |
| Seller data: orders, chats, finance        | Unwanted transmission, XSS.                                                      | Local-first: no backend and no telemetry. External integrations are opt-in and disabled while local-only mode is on. Site-derived text is rendered only as React text or `textContent`. ESLint forbids `innerHTML`/`outerHTML` assignment.                                                |
| Digital inventory (keys, codes)            | Disclosure, double delivery.                                                     | AES-GCM encryption with a non-extractable per-device key. A SHA-256 fingerprint gives uniqueness. Items are reserved in a single transaction (one delivery record per order). Uncertain sends are never retried. Items never appear in notifications or Telegram.                         |
| API keys (AI, Telegram)                    | Theft by page scripts or logs.                                                   | Encrypted with the device key and stored in the extension-origin IndexedDB, which content scripts cannot read. Never in `storage.local`, never sent to content scripts, redacted in logs and diagnostics.                                                                                 |
| Seller's FunPay account standing           | Rate limiting or bans through aggressive automation.                             | Automation is off by default. A live-actions acknowledgement is required. Server cooldowns are respected. Requests are serialized at ≥ 2.5 s apart with 429 backoff. Automatic messages are capped at 15 per 10 min with a 3 s gap and a flood pause. Emergency stop is always available. |
| Money                                      | Accidental financial actions.                                                    | Refund, withdrawal, currency-switch and wallet endpoints are absent from the transport allow-list, so they are unreachable by construction.                                                                                                                                               |

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

### Content Security Policy

Extension pages use `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. FunPro does not load remote code, does not use `eval`/`new Function` (forbidden by lint), and loads no third-party fonts or CDN assets.

### Message passing

- Every runtime message is validated with zod.
- Senders are classified as extension page, own content script on `https://funpay.com`, or untrusted, and each RPC method declares which senders may call it.
- Content scripts accept commands only from the extension background.
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

- Baseline guard: historical data never triggers buyer-facing actions.
- Idempotency keys on every outgoing action.
- Loop prevention: FunPro reacts only to `customer` messages, never to its own or system messages, and pauses after the seller replies manually.
- Workflow actions cannot retrigger workflows.

## Residual risks and limitations

- **Device compromise.** Anyone with access to the unlocked browser profile can use the extension and decrypt data, because the device key lives in the same profile. Passphrase-encrypted exports protect files at rest only.
- **Unverified integrations.** FunPay endpoints and markup are documented by open-source clients but have not been live-verified by FunPro maintainers. Markup changes may break parsing. Parsers fail closed: unknown structures yield no data rather than wrong data.
- **Platform rules.** Automation legality on FunPay is not explicitly documented anywhere we could access. The user is responsible for complying with https://funpay.com/trade/info.
- **AI providers.** Text the seller chooses to send to an AI provider leaves the device and is governed by that provider's policy. FunPro asks for consent first and minimises what it sends (redaction).

## Security review checklist (release gate)

- [ ] `pnpm lint` passes with the `innerHTML`/`eval` rules.
- [ ] The e2e manifest permission assertions pass.
- [ ] The transport allow-list tests pass (no money-moving endpoints).
- [ ] The diagnostics/backup "no secrets" tests pass.
- [ ] `grep -r "cookies" src` shows no use of the cookies API.
- [ ] Dependencies were reviewed (`pnpm audit`) and no remote code is loaded.
