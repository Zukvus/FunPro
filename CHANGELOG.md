# Changelog

All notable changes to FunPro are documented in this file. FunPro follows [Semantic Versioning](https://semver.org/). FunPro is an unofficial extension and is not affiliated with FunPay.

## 0.1.0 — first preview

### Foundation

- Local-first architecture: all data lives in your browser (IndexedDB and extension storage). No FunPro servers, no analytics, no telemetry.
- Works through your own logged-in FunPay tab. FunPro never reads cookies, `golden_key` or your password.
- Capability registry that labels every FunPay integration as _verified_, _evidenced_ (documented by independent open-source tools, not yet verified live) or _unsupported_.
- Durable task queue that survives browser restarts. Messages, deliveries and bulk edits whose outcome is uncertain are never retried automatically.
- Seller workspace pages for listings, orders, messages, reviews, customers, inventory, analytics, finance, pricing, AI assistant, workflow rules, notifications and integrations.

### Automation control center

- Global state (running, paused, emergency stop) with the `Alt+Shift+S` emergency stop shortcut.
- One card per automated feature with its live status, the reason it is (not) running, an on/off switch and a link to where it is configured.
- Explicit live-actions confirmation that lists every unverified action, links FunPay's rules and explains the risks. It can be revoked at any time.
- Sync interval and minimum pause between FunPay requests.

### Seller workspace

- Listings: searchable manager, cost and estimated profit, commission from FunPay's own calculator, automatic raises that follow FunPay's reported cooldown, manual raise, bulk edit (dry-run preview, backup, cancel, partial-failure report, typed confirmation for deletion), JSON/XLSX import and export, cloning (inactive copy, goods never copied), RU⇄EN translation and side-by-side comparison of 2–4 offers.
- Chats and reviews: slash-command quick replies, emoji picker, templates with variables, keyword auto-replies with loop prevention, cooldowns, quiet hours and approval drafts, welcome, post-order and scheduled messages, per-star review templates.
- Orders, finance and analytics: sales and purchase statistics, unconfirmed-order aging, exports, finance breakdowns (gross, net, cash flow, estimated profit; currencies never mixed) and a customisable Overview (show, hide and reorder sections).
- Statistics on FunPay's own "My sales" page: a FunPro panel above the order list with earnings, average order and biggest sale per currency, orders, unique buyers, awaiting confirmation, refunds, an orders chart and top buyers, products and categories for today, 7, 30, 90 days or all time. It shows how many stored sales the numbers are based on and can load the full history. Buyer names and money are blurred in privacy mode; the panel can be collapsed, hidden, or switched off in FunPro → Orders.
- Inventory: encrypted goods with unique reservation per paid order, delivery drafts, optional automatic delivery for fresh orders, and pushing stock to FunPay's own auto-delivery.
- Pricing intelligence: competitor snapshots, a repricing simulator and opt-in repricing within your limits.
- Integrations (opt-in): Telegram alerts with remote `/status` and `/stop`, a bring-your-own-key AI copilot with consent and redaction, a lightweight CRM, and WHEN → IF → THEN workflows with dry-run. Automation failures and login changes are available as notification and workflow triggers.

### Appearance & customization

- Themes: System, Light, Dark, Midnight, Forest, Sunset, Mono, Aurora and High contrast, plus an optional custom accent colour. All palettes are checked for WCAG contrast.
- Density, font size, reduced motion and high-contrast options with a live preview.
- Your own background image (PNG, JPEG, WebP or GIF up to 3 MB), stored only in your browser, with adjustable opacity.
- Experimental dark theme for funpay.com (colours only; switch it off if anything looks wrong).
- Custom colour, gradient, font and weight for your own nickname on funpay.com, plus a profile badge. Both are visible only in your browser.
- Configurable command palette shortcut (`Ctrl+K` by default; works with any keyboard layout).
- Language switcher at the top of the dashboard and the popup: Auto, Русский, English or Українська.

### Privacy & security

- Privacy mode blurs names, chat previews, order numbers and balances in FunPro and on funpay.com. Hover or focus reveals a value. Balances can also be hidden on their own.
- Local-only mode blocks every external integration.
- Overview of each permission and why it is needed. Optional permissions can be revoked.
- Data inventory per table and chat-message retention.
- Backup and restore: JSON export of settings and business data, optionally encrypted with a passphrase (AES-GCM, PBKDF2). Restore shows a preview, can merge or replace, and is applied in a single transaction. Secrets and keys are never exported.
- Delete all local data, with a typed confirmation.

### Logs & diagnostics

- Activity log with level, source and time filters and search.
- Task queue view with safe manual retry and cancel.
- Redacted diagnostic report (no secrets, no customer data) to download or copy.
- Feature flags editor.

### Onboarding

- First-run welcome guide: what FunPro does, privacy, connecting FunPay, language and theme. Automation is off by default.

### Security hardening

Fixes from an internal security review during development, not a third-party audit (details in [docs/SECURITY.md](docs/SECURITY.md#security-review-october-2026)):

- Automatic delivery runs only for fresh orders (known time, at most 30 minutes old, newer than the sales baseline). It never runs for offers FunPay delivers itself, and turns into a draft when you already wrote in the chat or the order is for several units. Orders found on filtered or paged order lists are stored without triggering anything.
- Every automatic message, including workflow replies, needs the live-actions confirmation, and workflow replies follow the auto-reply guards.
- Goods never leave the encrypted store by accident: delivery drafts are not backed up, the reply log keeps no delivery text, and inventory items are replaced in AI requests.
- Only FunPay's trailing "N pcs." suffix counts as the order quantity.
- Pushing stock to FunPay's auto-delivery appends to a freshly loaded goods list inside the FunPay tab; offer forms reach the rest of the extension without the goods list or the CSRF token.
- The emergency stop also halts chat polling, history and competitor fetches, and blocks price applies and goods pushes.
- In Chrome, the scripts FunPro runs on funpay.com can no longer read your settings; they get only the display settings they need.
- Restoring a backup no longer restores AI or Telegram consent, remote commands or automatic review posting.
- Two unused FunPay endpoints were removed from the request allow-list.
