# Installation, build and release

## Prerequisites

- Node.js ≥ 20.19 (CI uses 22)
- pnpm 10 (`corepack enable` or `npm i -g pnpm@10`)

```bash
git clone https://github.com/Zukvus/FunPro.git
cd FunPro
pnpm install
```

## Chrome / Edge / Chromium

### Development (hot reload)

```bash
pnpm dev
```

WXT starts a Chromium instance with the extension loaded. Code changes reload automatically.

### Load an unpacked production build

1. Build the extension:

   ```bash
   pnpm build            # → .output/chrome-mv3
   ```

2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select `.output/chrome-mv3`.
5. Pin FunPro, open https://funpay.com, log in, then open the FunPro popup.

Minimum Chrome version: 116.

### Package for the Chrome Web Store / Edge Add-ons

```bash
pnpm zip              # → .output/funpro-<version>-chrome.zip
```

## Firefox

```bash
pnpm build:firefox    # → .output/firefox-mv3
pnpm zip:firefox      # → .output/funpro-<version>-firefox.zip (+ sources zip for AMO review)
```

To load the build temporarily:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `.output/firefox-mv3/manifest.json`.

### Firefox compatibility notes

- Firefox 128 or newer is required (`browser_specific_settings.gecko.strict_min_version`).
- The background runs as an MV3 *event page* rather than a service worker. The same code works in both, because every listener is registered synchronously and all state is persisted.
- There is no `offscreen` API. Notification sounds play with `Audio` in the background page instead, so the `offscreen` permission is omitted from the Firefox manifest.
- Firefox ≥ 127 shows the `https://funpay.com/*` host permission at install time and grants it. If the user later revokes it in *about:addons → FunPro → Permissions*, the content script stops running. The popup then shows *No FunPay tab detected*.
- `optional_host_permissions` (Telegram, AI providers) are requested at runtime as in Chrome. In Firefox, host permissions can also be revoked from the add-on's *Permissions* tab.
- The built-in **Translator API** is Chrome-only. On Firefox, listing translation needs an AI provider or manual input.
- Keyboard commands may need re-binding in `about:addons → ⚙ → Manage Extension Shortcuts`.

Firefox status: the build is produced in CI. The core flows (popup, dashboard, content script) use only cross-browser APIs. **Manual verification on Firefox is part of the release checklist and has not been automated.**

## Tests

```bash
pnpm test                         # unit + integration (Vitest, fake IndexedDB, fake browser APIs)
pnpm build && pnpm test:e2e       # Playwright: loads the built extension in headless Chromium
# If the preinstalled Chromium revision differs from Playwright's:
PW_CHROMIUM_PATH=/path/to/chrome pnpm test:e2e
```

The E2E tests intercept every `https://funpay.com/**` request and serve sanitized fixtures. They never contact FunPay, make purchases, or send messages.

## Release process

1. Update `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. Run `pnpm check && pnpm build && pnpm test:e2e && pnpm build:firefox`.
3. Work through the release checklist in [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md#integration-checklist), including the live verification steps on a test seller account.
4. Tag the commit with `git tag vX.Y.Z && git push --tags`. CI then builds, tests and attaches the zips to a GitHub release.
5. Upload `*-chrome.zip` to the Chrome Web Store and Edge Add-ons, and `*-firefox.zip` (plus the sources zip) to AMO.
