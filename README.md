# FunPro

**FunPro** is an open-source, local-first browser extension for sellers on [FunPay](https://funpay.com). It covers listings, bumps, orders, chats, reviews, analytics, inventory, pricing intelligence and automation. Automation is safe by default and can be stopped instantly.

> FunPro is **unofficial** and not affiliated with FunPay. FunPay has no public API, so FunPro uses the same requests the website makes. Nothing is automated until you enable it and acknowledge the risks. Read the FunPay rules at https://funpay.com/trade/info before enabling automation.

## Highlights

- **Listings:** searchable manager, auto and manual bumps that respect FunPay's own cooldown, bulk edit with dry-run preview, backup, cancel and partial-failure recovery, net price and profit, import and export (JSON/XLSX), cloning, and RU⇄EN translation.
- **Chats:** slash-command quick replies, an emoji picker, templates with variables, and keyword auto-replies. Auto-replies have loop prevention, cooldowns, quiet hours and approval drafts. Also welcome and post-order messages, and scheduled messages.
- **Orders and finance:** sales and purchase statistics, charts, unconfirmed-order aging, support-ticket drafts, CSV/JSON/XLSX exports, and finance breakdowns that separate gross revenue, net receipts, cash flow and estimated profit. Currencies are never mixed silently.
- **Reviews:** per-star templates, AI drafts with template fallback, and order context.
- **Advanced features:** competitor pricing dashboard with a repricing simulator, encrypted digital inventory with unique reservation per order, opt-in Telegram alerts, a bring-your-own-key AI copilot, a lightweight CRM, and a WHEN → IF → THEN workflow builder with dry-run.
- **Customisation:** light and dark themes plus original custom themes, background images, privacy mode for streaming, nickname styling, and compact or spacious layouts. Localised in Russian, English and Ukrainian.
- **Safety:**
  - least-privilege permissions, with only `https://funpay.com/*` required;
  - no cookie access and no server or telemetry;
  - encrypted secrets;
  - an emergency stop (popup, dashboard, or `Alt+Shift+S`);
  - a durable task queue that never re-sends a message after an uncertain failure.
  - in Chrome, your settings are unreadable by the scripts FunPro runs on funpay.com;
  - an internal security review during development (not a third-party audit), with every finding fixed and tested (see [docs/SECURITY.md](docs/SECURITY.md)).

## Quick start

```bash
pnpm install
pnpm build          # Chrome/Edge → .output/chrome-mv3   (load unpacked in chrome://extensions)
pnpm build:firefox  # Firefox     → .output/firefox-mv3
```

| Command                                      | What it does                                              |
| -------------------------------------------- | --------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:firefox`              | Development build with hot reload                         |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` | Static checks and unit/integration tests                  |
| `pnpm build && pnpm test:e2e`                | Playwright tests on the real extension (FunPay is mocked) |
| `pnpm zip` · `pnpm zip:firefox`              | Store-ready packages                                      |

See [docs/INSTALL.md](docs/INSTALL.md) for Chrome, Edge and Firefox installation, release steps and Firefox notes.

## Documentation

| Document                                                   | Contents                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/FEATURES.md](docs/FEATURES.md)                       | Feature matrix with implementation status and acceptance criteria         |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               | Runtime contexts, adapter design, data flow, MV3 reliability              |
| [docs/SECURITY.md](docs/SECURITY.md)                       | Threat model, controls, residual risks, release security checklist        |
| [docs/PRIVACY.md](docs/PRIVACY.md)                         | What is stored, what is sent and to whom                                  |
| [docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md)     | Platform limitations and the live integration checklist                   |
| [docs/competitor-research.md](docs/competitor-research.md) | Lite Bot / Wingman / FP Tools feature analysis, user requests, rules      |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)                 | Source layout and conventions for contributors                            |
| [docs/research-notes-raw.md](docs/research-notes-raw.md)   | Raw research with source citations for every FunPay endpoint and selector |

## How FunPro talks to FunPay

- All FunPay requests are made **from the content script inside your open FunPay tab**. They are same-origin and authenticated by your browser exactly like the site's own requests. FunPro never reads `golden_key` or other cookies.
- A path allow-list makes refund, withdrawal and currency-switch endpoints unreachable.
- Requests are serialized 2.5 s apart by default (configurable, never under 1 s), with backoff on HTTP 429 and server errors.
- FunPay markup knowledge lives in one versioned adapter (`src/adapters/funpay/v1`). It is tested against sanitized fixtures.
- Each capability is marked _evidenced_: documented by independent open-source clients, but **not yet verified live** by FunPro maintainers. See the [integration checklist](docs/KNOWN-LIMITATIONS.md#integration-checklist).
- Automation needs an open, logged-in FunPay tab, so FunPro does **not** run 24/7 when the browser is closed.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
