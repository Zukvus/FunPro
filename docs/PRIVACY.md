# Privacy policy

FunPro is a local-first browser extension for FunPay sellers. It is unofficial and not affiliated with FunPay.

## What FunPro stores, and where

Everything is stored **only in your browser profile**:

- Extension IndexedDB:
  - your listings, sales and purchases;
  - chat summaries and messages (subject to the retention setting);
  - reviews, finance operations and customer notes;
  - inventory (encrypted), rules, logs and notifications.
- `browser.storage.local`: preferences.

FunPro has **no server**. It sends no analytics, telemetry or crash reports.

You control retention:

- *Privacy & security → message retention* (0 days means message bodies are not stored at all).
- Delete or export everything at any time from *Privacy & security*.

## What FunPro sends, and to whom

| Recipient | When | What |
|---|---|---|
| **funpay.com** | Always, while you use FunPay. | The same requests the FunPay website makes (page loads, raise offers, send messages you approved, edit offers you approved). Your browser's existing FunPay session authenticates them. |
| **AI provider** (OpenAI, Anthropic, OpenRouter or your own endpoint) | Only after you enable it, enter your own API key and give explicit consent. | The text you ask the assistant to work on: a conversation, a review, or a listing description. Order ids, user ids, links, emails and phone numbers are removed by default, and names too if enabled. |
| **Telegram Bot API** | Only after you connect your own bot and authorise your chat. | Notification texts you enabled: new order, new message (previews off by default), low stock, failures, summaries. Inventory items, tokens and secrets are **never** sent. |

**Local-only mode** is on by default. While it is enabled, FunPro makes no requests to any service other than funpay.com, regardless of other settings.

## What FunPro never does

- Read or transmit your FunPay login cookies (`golden_key`, `PHPSESSID`) or password.
- Sell, share or upload your data.
- Contact buyers automatically unless you enable a specific automation, acknowledge the risks, and the automation is running.

## Your rights

You can:

- inspect your data (dashboard);
- export it as a JSON backup (optionally passphrase-encrypted);
- delete it (*Privacy & security → Delete all data*).

Uninstalling the extension removes all of its stored data.
