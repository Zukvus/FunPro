# Development guide

## Commands

```bash
pnpm install          # install dependencies (runs `wxt prepare`)
pnpm dev              # Chrome dev build with HMR (opens a browser profile)
pnpm dev:firefox      # Firefox dev build
pnpm build            # production build → .output/chrome-mv3
pnpm build:firefox    # Firefox MV3 build → .output/firefox-mv3
pnpm zip              # distributable zip for Chrome Web Store / Edge Add-ons
pnpm zip:firefox      # zip + sources zip for AMO
pnpm typecheck        # tsc --noEmit (strict)
pnpm lint             # eslint
pnpm test             # vitest (unit + integration, fake IndexedDB + fake browser)
pnpm test:e2e         # playwright (loads the built extension in Chromium)
pnpm check            # typecheck + lint + test
```

## Source layout

| Path                                         | Purpose                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/entrypoints/`                           | WXT entrypoints only (background, content script, popup, options/dashboard). Thin wrappers.                                                             |
| `src/shared/models/`                         | zod schemas + types shared everywhere. Money is integer minor units.                                                                                    |
| `src/core/`                                  | Infrastructure: Dexie DB, settings, logging (redacted), crypto/secrets, sanitisation, event bus, durable queue, automation policy, RPC protocol, flags. |
| `src/adapters/funpay/`                       | The ONLY place that knows FunPay markup/endpoints. Versioned (`v1/`). Selectors in `v1/selectors.ts`.                                                   |
| `src/adapters/ai/`, `src/adapters/telegram/` | Third-party integration adapters (opt-in).                                                                                                              |
| `src/features/<area>/`                       | Feature logic (pure functions + Dexie access). No `browser.*` UI calls; testable with fake-indexeddb.                                                   |
| `src/background/`                            | Service-worker runtime: RPC router, tab registry, alarms, `modules/<area>.ts` wiring features to events/alarms/RPC.                                     |
| `src/content/`                               | Content script runtime (executor for background commands, passive page ingestion, `enhancements/<area>.ts`).                                            |
| `src/dashboard/`                             | Options/dashboard React app; `pages/<Name>Page.tsx` are lazy-loaded.                                                                                    |
| `src/popup/`                                 | Popup React app (must stay light: no charts).                                                                                                           |
| `src/ui/`                                    | Design system (components, theme tokens, i18n).                                                                                                         |
| `tests/`                                     | Vitest tests (`tests/unit/**`), sanitized FunPay fixtures (`tests/fixtures/funpay`).                                                                    |
| `e2e/`                                       | Playwright extension tests.                                                                                                                             |

## Conventions

- **Never** read cookies, `golden_key`, or log credentials. FunPay requests happen only in the content
  script via `FunPayTransport` (same-origin, allow-listed paths, rate-limited).
- Background → FunPay: `execInFunPayTab(cmd)` (`src/background/tabs.ts`). If no tab, defer with
  status `awaiting_tab` — never fail silently.
- Every outgoing chat message goes through `queueMessage()` (`src/features/messages/outbox.ts`) with a
  deterministic idempotency key. Automated sources are subject to emergency stop, policy and rate limits.
- Every automated feature checks `evaluateFeature()` (`src/core/automation/policy.ts`) and shows its
  status with `<StatusPill>` (`disabled | running | paused | awaiting_authorization | blocked`).
- Events are emitted with `emitEvent(type, dedupeKey, payload)`; handlers must ignore `payload.baseline === true`
  for anything that contacts buyers.
- New RPC methods: add to `src/core/messaging/rpc/<area>.ts` (zod params + `from`), handle in
  `src/background/modules/<area>.ts` via `handle()`.
- UI text: use `useT()`; add keys in `src/ui/i18n/locales/<area>.ts` for `en`, `ru`, `uk`.
- Render site-derived text only as React text / `textContent` (lint forbids `innerHTML` assignment).
- Dashboard pages read/write Dexie directly (`getDb()`, `useLiveQuery`) — same extension origin.
- Do not put `\uXXXX` escapes through tools that might convert them; verify with a grep for literal
  control/zero-width characters.
