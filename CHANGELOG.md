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

### Appearance & customization

- Themes: System, Light, Dark, Midnight, Forest, Sunset, Mono, Aurora and High contrast, plus an optional custom accent colour. All palettes are checked for WCAG contrast.
- Density, font size, reduced motion and high-contrast options with a live preview.
- Your own background image (PNG, JPEG, WebP or GIF up to 3 MB), stored only in your browser, with adjustable opacity.
- Experimental dark theme for funpay.com (colours only; switch it off if anything looks wrong).
- Custom colour, gradient, font and weight for your own nickname on funpay.com, plus a profile badge. Both are visible only in your browser.
- Configurable command palette shortcut (`Ctrl+K` by default; works with any keyboard layout).

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
