# FunPro: raw research notes

Collected 2026-10-11. These are raw notes, not a spec. Every technical fact cites the open-source file it came from. Items marked **[UNVERIFIED]** come from secondary sources (search-engine summaries, blogs) or are my inference, and must be checked against the live site before we rely on them.

Sources actually read (shallow `git clone --depth 1`):

| Repo | Commit / date | License | Notes |
|---|---|---|---|
| `sibamor/Wingman` | `9cd49f1` 2026-09-30 (v0.18.1) | GPL-3.0 | TypeScript MV3 extension built on WXT. It is the closest analogue to FunPro. |
| `XaviersDev/FunPay-Tools` | `da96adf` 2026-08-19 (manifest v2.9.9) | MIT | JavaScript MV3 extension (FP Tools). |
| `sidor0912/FunPayCardinal` | `c09dd13` 2026-09-24 | **No LICENSE file in repo** (treat as all rights reserved; read only for facts, never copy) | Python bot that bundles the `FunPayAPI` package (`FunPayAPI/…`). |

`FunPayCardinal/FunPayAPI` as a standalone repo needed authentication to clone. The copy of `FunPayAPI` bundled inside `sidor0912/FunPayCardinal` is the one quoted here.

Licensing note: FunPro is GPL-3.0 (`/home/user/FunPro/LICENSE`). That makes Wingman's GPL-3.0 code and FP Tools' MIT code legally compatible to reuse with attribution. Even so, the facts below are meant to be re-implemented, not copied. FunPayCardinal has no license, so none of its code may be copied.

---

## (A) FunPay Lite Bot: features

None of funpaylitebot.com, `/changelog`, `/en/pricing`, the Chrome Web Store, AMO or chrome-stats could be fetched directly: DNS and the egress proxy both refused. Everything here comes from web-search result summaries and is **[UNVERIFIED]** in detail.

- **Distribution:** browser extension for Chrome and Firefox. Chrome Web Store id `amicfiagmpbgfiiopieeemlkblfeeeip`. The listing title seen on chrome-stats is "FunPay Lite Bot - Dark Theme & Auto-Boost" and the publisher is shown as "Lenvio Software". The site claims "60k+ monthly active sellers"; store counts were reported as ~50-60K users.
- **Versions:** sources disagree. Chrome listing snapshots show 2.1.2 (2026-07-31) and AMO shows 2.2.0 (2026-08-15). chrome-stats shows 2.3.5 (2026-10-08), with a permission change in 2.3.3 → 2.3.4 (2026-10-04) that added an optional host permission for `sfunpay.com`, FunPay's static/CDN domain for avatars and images. Permissions are reported as `storage`, `unlimitedStorage` and host access to funpay.com.
- **Features (from site and store summaries):**
  - **Auto-bump** (auto-raise) of offers on a schedule, with a per-category cadence. The site lists this under Basic (free); the pricing intro text also ties auto-bump to Pro/Premium, which is inconsistent.
  - **Themes:** dark, "Firewatch", "Red Moon", plus a custom theme editor.
  - **Sales analytics:** daily, weekly and per-game revenue summaries.
  - **Custom notification sounds** for sales, messages and reviews.
  - **"Exact pricing":** prices to the cent, with no step constraints or auto-rounding.
  - **Promo lots view:** all promoted listings in a category shown in one place.
  - From an older third-party listing (v2.1.2): auto-translation of lots into English, keyword auto-replies, and Excel export of sales and purchases.
- **Pricing tiers** (from the pricing page snippet):
  - **Basic:** free forever. Auto-bump, sales statistics, dark/custom themes, custom sounds, exact pricing, promo lots.
  - **Community:** free for active community members. Adds fast messages (quick replies), a custom background image and purchase statistics.
  - **Pro:** 159 ₽/month. Adds sales and purchase exports, plus "more features in active development".
  - **Premium:** mentioned in the intro text but not visible in the snippet, so its existence is unconfirmed.
- **Related open-source project:** `NightStrang6r/FunPayServer` (GitHub) is a separate CLI bot from the same author family, and its README promotes the extension.
- **User-visible behaviour mentioned elsewhere:** in FP Tools issue #1, a user says LiteBot "shows one badge per lot" on promo lots. The FP Tools owner states that LiteBot does not poll for incoming messages, which would explain why it triggers fewer 429s.

## (B) Wingman: features and technical facts

**Positioning (README.md):** "Помощник продавца FunPay прямо в браузере. Открытый код, без серверов и без сбора данных." The extension is on the Chrome Web Store (id `bbakbcjajkhepmflnpdgbokkbipmcjdk`) and has a Firefox build (gecko id `wingman@wingmanfp.com`). Site: wingmanfp.com.

### B.1 Documented features (README.md "Что умеет")

- **Lots**
  - Auto-raise on FunPay's own timer, separately per section.
  - Bulk edit: set a price, or raise/lower it by % or ₽; set amount; enable or disable many lots at once.
  - Buyer price vs. seller income using the section commission, plus cost price and profit.
  - The lot's price rank within its section, with a notification when a competitor undercuts it.
  - One-click lot copy, and the English description filled via the browser's built-in translator.
- **Sales and finance**
  - Instant sales and purchase filters: status, section, period, buyer/item search, CSV export.
  - Analytics on your own profile: earnings by day, best sections, reviews by rating.
  - Withdraw helper: labels for saved cards and wallets, SBP bank logos, repeat a recent withdrawal.
  - Reminder about orders not yet delivered, and a daily summary sent to Telegram.
- **Chat**
  - Reply templates with buyer-nick and order-number substitution, and Alt+1…9 hotkeys.
  - Full-text search across conversations.
  - Buyer notes and tags, pinned dialogs, and a buyer card with order history.
  - Buyer blacklist.
  - Warning on messages that impersonate FunPay administration.
  - Screenshot caption sent together with the image.
- **Auto-replies and notifications**
  - Greeting, keyword replies, thanks after order confirmation, replies to reviews, and an "away" mode.
  - Safeguards: a message limit, a pause after the seller's own reply, and a pause on flood.
  - Notifications for orders, messages and money credited; quiet hours; mirroring to the user's own Telegram bot.
- **Convenience**
  - Ctrl+K quick navigation (`entrypoints/palette.content.ts`).
  - Favourite and recent sections, and a seller bar under the header.
  - Dark themes, and a privacy mode for streams and screenshots.
  - A confirmation step before irreversible actions (`lib/confirm.ts`).
- **Privacy claims:** no servers. Data is stored only in the browser (IndexedDB is used in `lib/history.ts`). Network calls go only to `funpay.com` and optionally `api.telegram.org`. There is no telemetry. "Пароль и `golden_key` Wingman не видит и не просит." The source matches this claim: there is no `cookies` permission and every request uses `credentials: 'include'`.
- **Manifest (`wxt.config.ts`):**
  - `permissions: ['storage','alarms','notifications']`
  - `host_permissions: ['https://funpay.com/*']`
  - `optional_host_permissions: ['https://api.telegram.org/*']`
  - The settings UI is drawn by a content script on `https://funpay.com/wingman`, which is FunPay's 404 page (per `store/reviewer-notes.md`).
- **Auto-reply limits** (reviewer notes and `lib/auto.ts` constants):
  - Auto-replies are off by default.
  - Turning them on asks for a confirmation that lists what will be sent.
  - `SEND_LIMIT = 15` messages per `SEND_WINDOW = 10 min`.
  - `KEYWORD_COOLDOWN = 30 min` per rule per chat.
  - `SEND_GAP = 3000 ms` between sends.
  - `FLOOD_PAUSE = 5 min`.
  - A balance check every 15 min (`BALANCE_EVERY`), an orders/deadline check every 10 min (`ORDERS_EVERY`), and a competitor watch every 60 min (`WATCH_EVERY`).
  - The auto loop alarm is `periodInMinutes: 0.5` (`lib/auto.ts` `scheduleAuto`).
- **README disclaimer:** "У FunPay нет официального API. Wingman делает те же запросы, что и сайт, с паузами между ними и не обходит никаких ограничений. Но правила FunPay устанавливает FunPay: автоответы и массовые действия включайте осознанно…"

### B.2 FunPay endpoints and selectors used by Wingman (facts from source)

- **Account bootstrap** (`lib/api.ts` `loadAccount`, `lib/funpay.ts` `parseAppData`):
  - `GET https://funpay.com/` with `credentials:'include'`.
  - Parse `<body data-app-data="…">`, which is HTML-entity-encoded JSON. It may be an array, in which case element `[0]` is used.
  - Fields read: `userId` (0 for a guest), `csrf-token` and `locale`.
  - Username comes from `class="user-link-name"`.
  - "Not logged in" is detected when `response.url` includes `/account/login`, or when `userId` is 0.
- **Lot sections on the profile** (`parseLotSections`): `GET /users/{userId}/`, then regex `<div class="offer-list-title">\s*<h3>\s*<a href=".../lots/(\d+)/">NAME</a>`. Captures the node id and section name.
- **Raise button** (`parseRaiseButton`): `GET /lots/{nodeId}/trade`. The `<button class="… js-lot-raise …" data-game="G" data-node="N">` element supplies `game_id` and `node_id`.
- **Raise** (`lib/api.ts` `postRaise`/`raiseGame`):
  - `POST https://funpay.com/lots/raise`
  - Headers: `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`, `X-Requested-With: XMLHttpRequest`, `X-Csrf-Token: <csrf>`.
  - Body: `game_id`, `node_id`, `csrf_token`, and optionally repeated `node_ids[]`.
  - If the JSON response has `modal` (HTML), read the checkbox values from `<div class="checkbox">…<input value="(\d+)">` and re-POST with all of them as `node_ids[]`.
- **Raise response parsing** (`parseRaiseResponse`):
  - `{error:false, msg?, wait?}` means raised.
  - `{url: …}` without an error means rejected; Wingman waits 7200 s.
  - `{error:true, msg:"Подождите N часов/минут…"}` or HTTP 429 means cooldown. The wait is taken from `wait` (seconds), or else parsed from `msg` (`waitFromMessage`): seconds as given, `(N-1)*60` for minutes, `(N-0.5)*3600` for hours. Units are matched in RU, UK and EN prefixes (с/s, м/m/хв, ч/h/год).
  - Defaults: 3600 s; 600 s on unknown errors.
- **Raise scheduler** (`lib/raise.ts`):
  - One `chrome.alarms` alarm named `raise`, scheduled at the minimum `nextAt` across sections.
  - At least 60 s ahead (`MIN_ALARM_DELAY_MS`), a 2 s gap between requests (`REQUEST_GAP_MS`), and a 10 min retry after an error.
  - Results are de-duplicated per `gameId`, because one raise covers all of a game's nodes.
  - An excluded-sections list is supported.
- **Commission** (`lib/commission.ts`):
  - `POST /lots/calc` with `nodeId` and `price`, or `POST /chips/calc` with `game` and `price` for currency (chips) sections.
  - Headers: `x-requested-with: XMLHttpRequest`, form content-type.
  - Response JSON: `{methods:[{price:"1 234.56", unit:"₽", name, sort}], minPrice?, error?}`.
  - Wingman sends a test price (RUB 100000, USD/EUR 1000) and computes `percent = (min(method prices in same currency)/price - 1)*100`. Then `buyerPrice = seller*(1+p/100)` and `sellerPrice = buyer/(1+p/100)`.
- **Offer edit/save** (`lib/bulk-lots.ts` `applyToOffer`):
  1. `GET /lots/offerEdit?offer={offerId}` (the UI link form is `/lots/offerEdit?node={nodeId}&offer={offerId}`).
  2. Take `form.form-offer-editor` and read it with `new FormData(form)`.
  3. Safety check: `offer_id` equals the requested id and `csrf_token` is present.
  4. Modify `price`, `amount`, `active` (`'on'` or deleted).
  5. `POST /lots/offerSave` as urlencoded with `x-requested-with`.
  6. The response is JSON `{error?, msg?, errors?: [[field, message], …]}`.
- **Offer editor fields** (`entrypoints/offer.content.ts`): `input[name="price"]`, `input[name="node_id"]`, `input[name="offer_id"]`, and `[name^="fields["]`, including `fields[{key}][ru]` and `fields[{key}][en]`. The currency sign is in `.form-control-feedback`.
- **Lot rows** (`entrypoints/lots-bulk.content.ts`):
  - Rows are `a.tc-item`.
  - Offer id comes from the `data-offer` attribute, or from the `href` `?id=` / `?offer=` parameter.
  - Price is `.tc-price[data-s]` (unrounded seller-side number); the displayed price is in `.tc-price > div`.
  - Title is `.tc-desc-text`.
  - Applies on `/users/*` and `/lots/*`, including the `/en/` and `/uk/` prefixes.
- **Public listing parsing** (`lib/fp-pages.ts` `parseListing`):
  - Rows are `<a href="https://funpay.com/lots/offer?id=N" class="tc-item [offer-promo offer-promoted]" data-online="1" data-user="UID" data-f-<filter>="value">`.
  - `.tc-price[data-s]` holds the price, `.media-user-name` the seller name, `.tc-desc-text` the title.
  - Seller id comes from `data-href=".../users/(\d+)/"`.
  - Offers are grouped by their `data-f-*` filters to compute a price rank (`ownPlaces`).
- **Sales list** (`lib/rows.ts` `parseSales`, `lib/fp-pages.ts` `parseSalesHtml`, fixture `tests/fixtures/sales.html`):
  - Page: `GET /orders/trade` (sales) or `/orders/` (purchases).
  - Row: `a.tc-item` with `href="https://funpay.com/orders/{ID}/"`.
  - Row class `info` = paid (`Оплачен`, `.tc-status.text-primary`).
  - Row class `warning` = refunded (`Возврат`, `.tc-status.text-warning`).
  - No class = closed (`Закрыт`, `.tc-status.text-success`).
  - Children: `.tc-date-time` (e.g. "сегодня, 09:05" or "вчера, 13:33"), `.tc-date-left`, `.tc-order` ("#ABCDEFGH"), `.order-desc > div` (title) plus `.order-desc .text-muted` ("Category, Subcategory"), `.media-user-name span[data-href=".../users/ID/"]` (buyer), and `.tc-price` (e.g. `1 250.50 <span class="unit">₽</span>`, class `tc-buyer-sum`).
  - Pagination: the last `input[name="continue"]` value, then `POST` the same URL with form `continue=<value>`.
  - Wingman uses its own query params, such as `?wm_status=paid` and `?wm_q=`, which FunPay ignores. FunPay's own filter is `?state=paid` (used in `lib/auto.ts`).
- **Dates** (`lib/fpdate.ts`): dates are Moscow time (UTC+3). Formats include "сегодня/today/сьогодні, HH:MM", "вчера/yesterday/вчора", and "D <month genitive> [YYYY], HH:MM". Month names are matched in RU, EN and UK.
- **Money** (`lib/money.ts`): signs ₽/$/€ map to RUB/USD/EUR. Thousands are separated by spaces or NBSP. A negative amount is written `&minus;` / `−`.
- **Runner polling** (`lib/fp-chat.ts` `pollRunner`):
  - `POST /runner/` as urlencoded with `objects=<JSON>`, `request=false` and `csrf_token`.
  - Objects: `{type:'chat_bookmarks', id:userId, tag:'00000000', data:false}` and `{type:'orders_counters', id:userId, tag:'00000000', data:false}`.
  - Response `{objects:[{type, id, tag, data}], response}`.
  - `chat_bookmarks.data.html` contains `a.contact-item[data-id][data-node-msg][data-user-msg]` (class `unread` when unread), `.media-user-name` and `.contact-item-message` (preview).
  - `orders_counters.data` is `{buyer, seller}`: counts of active purchases and sales.
- **Send chat message** (`sendChatMessage`):
  - `POST /runner/` with `objects=[{type:'chat_node', id:node, tag:'00000000', data:{node, last_message:-1, content:''}}]` and `request={action:'chat_message', data:{node, last_message:-1, content:TEXT}}`.
  - `response.error` holds the error text, or is null on success.
- **Chat history:** `GET /chat/history?node={node}&last_message={id}` with `x-requested-with`. Returns JSON `{chat:{node:{id,silent,…}, messages:[{id, author, html}]}}`. The text is in `.chat-msg-text` inside `html`.
- **Chat node ids:** a private chat can be addressed as `users-{minId}-{maxId}` (`entrypoints/palette.content.ts`: `/chat/?node=users-a-b`). Chat page: `/chat/?node={id}`.
- **Chat DOM** (`entrypoints/chat.content.ts`): `.chat-contacts .contact-list a.contact-item`, `.chat-message-list .chat-msg-item`, `a.chat-msg-author-link` (missing, or with `.chat-msg-author-label`, for system messages) and `.chat` (container).
- **System message detection** (`lib/fp-chat.ts` `systemEvent`) is regex on the preview text: "оплатил / paid for / оплатив" (paid), "подтвердил успешное выполнение" (confirmed), "(написал|изменил) отзыв" (review), "вернул деньги / refunded" (refund). Order ids match `#([A-Z0-9]{6,12})`; real ones are 8 chars.
- **Order page / review:** `GET /orders/{orderId}/`. Rating comes from `review-container[data-rating]` or `class="rating(\d)"`. The existing reply is in `.review-compiled-reply > div`. The buyer comes from the `<h5>Покупатель</h5>` block.
- **Review reply** (`replyToReview`): `POST /orders/review` with `authorId=<my userId>`, `orderId`, `text`, `rating=''` (empty for a seller reply) and `csrf_token`. HTTP 200 means OK; otherwise the JSON `msg` holds the error.
- **Reviews list** (`parseReviews`, fixture `reviews.html`):
  - Container: `.review-container`.
  - Inside: `.review-item-photo a[href=/users/ID/]`, `.rating .ratingN` (N = 1-5), `.review-item-user .media-user-name a`, `.review-item-order a[href=/orders/ID/]`, `.review-item-date` ("11 августа 2022 в 18:12, 2 года назад"), `.review-item-detail` ("Dota 2, 100 ₽"), `.review-item-text`, and `.review-compiled-reply` (seller reply).
  - More reviews: `POST /users/reviews` with `user_id`, `continue` and `filter=''`.
- **Balance / finance** (`lib/rows.ts` `parseTransactions`, `lib/fp-chat.ts` `parseBalanceRows`, fixture `transactions.html`):
  - Page: `GET /account/balance`. List: `.tc.tc-finance.dyn-table.transactions`.
  - Row: `.tc-item.transaction-status-{complete|waiting|cancel}[data-transaction=ID]`.
  - Row children: `.tc-date-time`, `.tc-title` ("Заказ #NZF6TSZG", "Пополнение баланса #…", withdrawal, refund), `.tc-status`, `.tc-price` ("&minus; 68.52 ₽" / "+ 57.20 ₽"), `.payment-logo.payment-method-{n}` and `.tc-payment-number` (wallet).
  - More rows: `POST /users/transactions` with `user_id`, `continue` and `filter=''`.
  - Withdraw form (`entrypoints/balance.content.ts`): `.withdraw-box form` with `[name=currency_id]`, `[name=ext_currency_id]`, `[name=wallet]`, `[name=amount_int]` and `.form-group-fps-bank` (SBP bank).
- **Profile DOM** (`entrypoints/profile.content.ts`, fixture `profile.html`):
  - Containers: `.profile-data-container`, `.offer`, `.offer-list-title-container`, `.offer-list-title h3 a[href=/lots/NODE/]`, `.offer-tc-container`, `.tc.showcase-table[data-section-type="lot"]`.
  - Rating count: `.rating-full-count`.
  - Own-profile check: `#header a.menu-item-trade` is present. The profile name is `<div class="profile"><h1><span class="mr4">NAME`.
- **Fixture `profile.html` line 1** confirms the `data-app-data` shape: `{"locale":"ru","csrf-token":"…","userId":0,"runnerCoordId":"g"}`. So `runnerCoordId` also exists.
- **Retry policy** (`lib/history.ts` `load`): on 429 or ≥500, retry up to 6 times. The wait is `Retry-After` or `2000*2^attempt`, capped at 30 s. Page fetches are spaced `PAGE_GAP = 1500 ms`.
- **Scam heuristics** (`lib/scam.ts`): a regex for "администрация/поддержка/арбитраж … funpay" combined with pressure words, plus look-alike host detection (`f[uyv]n+-?p[aeо]y|funpau|funpai|fumpay`, excluding `funpay.com` and `sfunpay.com`).

### B.3 Wingman issues / PRs

- GitHub Issues: **0 issues** (open or closed) as of 2026-10-11 (https://github.com/sibamor/Wingman/issues). The repo has an issue template with `bug_report.yml` and `feature_request.yml`.
- PRs: 9, all Dependabot dependency bumps (https://github.com/sibamor/Wingman/pulls). Feedback mostly goes through Discord and Telegram (`t.me/wingman_funpay`), which are not accessible to us.

## (C) FP Tools (FunPay Tools, XaviersDev): features

funpay.tools could not be fetched (proxy and DNS denial). The features below come from the GitHub README (v2.8 badge; manifest 2.9.9) and the source. Chrome Web Store id `pibmnjjfpojnakckilflcboodkndkibb`; Telegram @FPTools. An unofficial Firefox port, "Foxen" (SanoSenpay/Foxen), also exists. A separate Android app is published as `XaviersDev/FunPay-Tools-Android`; it advertises "XD Dumper", automatic price lowering and raising to stay at the top, plus "вечный онлайн" (eternal online status).

### C.1 Documented features (README)

- **AI** (via external servers `fptools-ai-server.vercel.app` and `fptools.onrender.com`):
  - Chat assistant that rewrites drafts politely.
  - Lot title and description generator.
  - AI review reply (a button next to the review on the order page).
  - Translator.
  - Lot image generator.
  - "AI shop audit" (~40 questions, then recommendations).
  - "Smart UI tweak" in natural language.
- **UI:** new menu, themes and GIF backgrounds, dark theme with a flash fix, "Magic wand" live CSS styler, Unicode fonts, cursor effects, theme import/export.
- **Lots:**
  - Export/import of all lots to a file, with a 24 h deferral when FunPay rate-limits.
  - Copy any lot, including other sellers' lots.
  - Bulk edit of title, description and buyer message, with find & replace.
  - Inline quick price edit with preview.
  - Click-to-copy order id.
  - Right-click lot menu.
  - Bulk delete, duplicate and disable; select a whole category.
  - Mass clone to many categories or servers.
  - Instant lot search.
  - Seller search by nick (revenue, reviews, average check, top-3 categories).
  - User notes and tags in chat.
  - Cardinal → FP Tools lot converter.
- **Finance / analytics:**
  - "Копилки" (savings goals).
  - Market analytics per category (lot count, sellers, average price, competitors online).
  - **Smart auto-raise:** "reads the server's answer ('подождите ещё 12 минут') and sets the timer exactly", with category filter and an "only auto-delivery lots" filter.
  - Telegram notifications plus Telegram bot commands (`/chats`, orders, `/bump`).
  - Discord webhook notifications.
  - Sales statistics with 5 modes.
  - **Order timer:** countdown per paid order, turning red when less than 6 h remain.
  - Order type tags: 🟢 "Сделка" vs 🟣 "Обычный".
  - Custom sounds, settings export (`.fpconfig`), currency calculator.
- **Autoresponder** (background):
  - Auto-greeting for new buyers, with a cooldown and an "only brand-new chats" option.
  - Triggers on order paid and order confirmed.
  - Auto review replies per star rating (1-5).
  - **"Bonus for 5★ review"**, which automatically sends a bonus (text, promo code or image) for a five-star rating. **Rule risk, see section E.**
  - Command triggers (`!реквизиты`).
  - Variables `{buyername}`, `{lotname}`, `{orderid}`, `{orderlink}` and `{ai:…}`.
  - Images in templates.
  - **Typing imitation**.
  - Understands RU and EN system messages.
  - Anti-spam: does not answer itself, avoids duplicate replies, ignores FunPay "Уважаемые продавцы" broadcasts.
  - Blacklist integration.
- **Auto-delivery:** auto-deactivate a lot when stock runs out, and auto-activate it when restocked.
- **Chat:** multi-photo attach with caption, photo editor, mosaic albums, lightbox, in-chat search, drafts, purchase history per buyer, auto-translation of incoming messages, export chat to `.txt`, quoted replies, slash commands, a notepad, and "read all".
- **Accounts and community:**
  - **Account manager** (switch between multiple FunPay accounts).
  - **Support tickets in the menu** (via `funpay.com/support/sso` → support.funpay.com).
  - Blacklist with per-person toggles.
  - **Shared seller chat** between extension users (external Cloudflare worker `fpt-chat.starobinskiy01.workers.dev`).
  - "Свой-Чужой" (friend-or-foe) marker when the other party also uses FP Tools.

### C.2 Technical facts from FP Tools source (for comparison; FunPro will NOT do these)

- **Manifest** (`manifest.json`): `permissions: storage, tabs, cookies, alarms, offscreen, notifications, background`. Host permissions cover funpay.com, sfunpay.com, support.funpay.com, api.telegram.org, two AI servers, two Cloudflare workers, jsdelivr, raw.githubusercontent, Google fonts and translate.
- **It reads `golden_key` and `PHPSESSID` via `chrome.cookies.get`** (`background/autobump.js:43-48`, `background/autoresponder.js:80-136`) and sends them in a manual `cookie:` header. Code comments claim the runner silently drops messages without PHPSESSID (`autoresponder.js:132-133`). FunPro must not do this; the page's own credentials (`credentials:'include'`) suffice, as Wingman shows.
- **Raise** (`background/autobump.js` `raiseCategory`): the same flow as Wingman. `POST /lots/raise` with `X-Csrf-Token`, `game_id` and `node_id`; when the response has `modal`, re-POST with `node_ids[]` taken from `<div class="checkbox">…<input value>`. A 429 response is treated as a limit with `parsed.wait`. Success is detected by `error === false` or by the text containing "подняты"/"raised". The default next attempt is 4 h.
- **Other endpoints referenced:**
  - `/lots/offer/add` (new lot page)
  - `/file/addChatImage` and `/file/addOfferImage` (image upload)
  - `/games/promoFilter`
  - `/users/transactions`
  - `/support/sso?return_to=…`
  - `/lots/calc` (`content/features/section_commission.js`, `buyer_price_field.js`)
- **DOM hooks:** `.js-lot-raise` (`content/features/lot_management.js:139`) and `[data-node]` for the chat node id (`content/features/chat_image_attach.js:42`).

### C.3 FP Tools issues

- Only one issue exists: **#1 "Пофикси"** (closed 2026-08-24, 21 comments), https://github.com/XaviersDev/FunPay-Tools/issues/1. Points raised:
  - The left chat list text is too dark (contrast).
  - Links can't be told apart from text without hover.
  - Laggy chat switching.
  - Odd spacing.
  - **HTTP 429 when opening or quickly switching between 5+ chats**; the owner blamed several extensions polling in the background.
  - Duplicate badge on promo lots.
  - 429s during purchases needing about 10 retries (another user).
  - A request to remove the buyer price on currency lots.
  - Conflicts with other extensions.
  - Takeaway for FunPro: keep request volume low, and coordinate polling with any other open FunPay tabs.

## (D) FunPay platform: technical facts (with evidence)

Notation: **[FPAPI]** = `sidor0912/FunPayCardinal/FunPayAPI/…`, **[WM]** = `sibamor/Wingman/…`, **[FPT]** = `XaviersDev/FunPay-Tools/…`. Line numbers refer to the commits listed at the top.

### D.1 Auth/session

- **Session cookies:** `golden_key` (long-lived login key) and `PHPSESSID` (session). [FPAPI] `account.py` `method()` ~L187-200 sends both; ~L146-151 ignores server-set `PHPSESSID`/`fav_games`. The `get()` docstring says it should be called every 40-60 min to refresh PHPSESSID. `cookie_prefs=1` is also sent. **FunPro will never read these cookies**; requests from content scripts and background use `credentials:'include'` [WM `lib/api.ts`].
- **`<body data-app-data>`** JSON contains `locale`, `csrf-token`, `userId` and `runnerCoordId` ([WM] `tests/fixtures/profile.html` L1). [FPAPI] `account.py` `get()` ~L270-273 reads `data-app-data`, `locale`, `userId` and `csrf-token`. [FPT] `autoresponder.js:97` also reads `userName`.
- **Header elements** ([FPAPI] `get()` ~L266-287):
  - `div.user-link-name` = username; its absence means not logged in.
  - `a.menu-item-logout[href]` = logout link (a GET to it resets `golden_key`).
  - `span.badge.badge-trade` = number of active sales.
  - `span.badge.badge-balance` = "1 234 ₽".
  - `span.badge.badge-orders` = active purchases.
- **Login redirect:** a 3xx redirect to `…/account/login` means unauthorized; a 403 also means unauthorized ([FPAPI] `method()` ~L234-242). A 429 gets exponential backoff (2^i s, max 30) ([FPAPI] ~L222-230).
- **Locale:** paths may be prefixed `/en/` or `/uk/` (RU has no prefix). The locale can be switched with a `?setlocale=en` query param ([FPAPI] ~L210-211, `normalize_url` ~L2365-2388).
- **XHR conventions:** POSTs are `application/x-www-form-urlencoded; charset=UTF-8` with `x-requested-with: XMLHttpRequest`. The CSRF token goes in the body as `csrf_token`; Wingman and FP Tools also send an `X-Csrf-Token` header on `/lots/raise`.

### D.2 Raise ("Поднять предложения")

- `POST https://funpay.com/lots/raise` with form `game_id=<categoryId>`, `node_id=<one subcategory id>` and optionally `node_ids[]=<id>` repeated ([FPAPI] `account.py` `get_raise_modal` ~L1131-1158 and `raise_lots` ~L1160-1220; [WM] `lib/api.ts` L63-90; [FPT] `background/autobump.js` `raiseCategory`).
- `game_id`/`node_id` come from the `button.js-lot-raise[data-game][data-node]` on `/lots/{nodeId}/trade` ([WM] `lib/funpay.ts` `parseRaiseButton`).
- **Raising is per game (category):** one call raises the selected subcategories of that game. If the seller has more than one subcategory in the game and `node_ids[]` is omitted, FunPay returns `{modal: "<html with checkboxes>"}` ([FPAPI] `get_raise_modal` docstring; [WM] and [FPT] parse the checkbox inputs).
- **Responses:**
  - `{error: false, msg: "Предложения подняты", wait?: seconds}` = success. The exact success text is **[UNVERIFIED]**; FP Tools matches "подняты" or "raised".
  - `{error: true, msg: "Подождите N час(а/ов)." / "Please wait N hours." / "Зачекайте …", wait?: seconds}` = cooldown ([FPAPI] `raise_lots` ~L1212-1218 checks for `"Подождите "`, `"Please wait "` and `"Зачекайте "`).
  - `{url: "…"}` = rejected/redirect ([FPAPI] raises `RaiseError` with wait 7200).
  - HTTP 429 is possible.
- **Wait parsing** ([FPAPI] `common/utils.py` `parse_wait_time` L72-88): digits from the message; "секунд/second" → N; "минут/хвилин/minute" → (N-1)*60; "час/годин/hour" → (N-0.5)*3600; otherwise 10 s. Wingman mirrors this.
- **Cooldown length:** none of the sources hard-code an official interval. The bots read it from FunPay's response. FP Tools uses 4 h as a fallback/default and Wingman uses 1 h. The commonly cited "every 4 hours" is **[UNVERIFIED]**.
- Cardinal raises every game with a ≥2 s sleep between games and backs off 60 s on 503/403/429 ([FPAPI-adjacent] `cardinal.py` `raise_lots` L301-360).

### D.3 Runner (`/runner/`): polling and sending

- `POST /runner/` with form fields `objects=<JSON array>`, `request=<JSON or "false">` and `csrf_token` ([FPAPI] `account.py` `runner_request` ~L292-317; [WM] `lib/fp-chat.ts` `postRunner`).
- **Object types** ([FPAPI] `get_payload_data` ~L319-362):
  - `{"type":"orders_counters","id":<userId>,"tag":<lastTag>,"data":false}` → `data: {buyer: n, seller: n}` ([FPAPI] `updater/runner.py` ~L539; [WM]).
  - `{"type":"chat_bookmarks","id":<userId>,"tag":<lastTag>,"data":false}` → `data: {html: "<a class='contact-item' data-id data-node-msg data-user-msg>…", order: [chat ids]}` ([FPAPI] `runner.py` ~L150, L346-360).
  - `{"type":"chat_node","id":<chatId or "users-a-b">,"tag":<tag or "00000000">,"data":{"node":…,"last_message":<id or -1>,"content":""}}` → new messages for that chat.
  - `{"type":"c-p-u","id":"<buyerId>","tag":"00000000","data":false}` = "Покупатель смотрит" (what the buyer is viewing) ([FPAPI] `get_buyer_viewing` ~L1912-1925).
- The `tag` is an 8-char change marker; send the last one received and FunPay returns new data only when it has changed. Start with `"00000000"` ([WM]).
- Cardinal caps a runner request at `runner_len = 10` objects ([FPAPI] `runner.py` L91).
- **Send message:** `request={"action":"chat_message","data":{"node":<chatId>,"last_message":-1,"content":"<text>"}}` (plus `image_id` for images) ([FPAPI] `send_message` ~L858-870; [WM] `sendChatMessage`). The response `response.error` holds the error text.
- **Known flood errors** ([FPAPI] ~L879-888):
  - "Нельзя отправлять сообщения слишком часто." / "You cannot send messages too frequently."
  - "Нельзя слишком часто отправлять сообщения разным пользователям." / "You cannot message multiple users too frequently."
- **Bot marker:** Cardinal prefixes bot-sent messages with an invisible U+2061 character ([FPAPI] `account.py` L127; the old marker U+2064 is on L129), so it can recognise its own messages. Its `send_review` appends the same marker. (Mentioned only as a fact; FunPro should not need invisible markers.)
- **Chat history:** `GET /chat/history?node={id}&last_message={id}` with `x-requested-with` returns JSON `chat.node.{id,silent,name}` and `chat.messages[{id, author, html}]` ([FPAPI] `get_chat_history` ~L640-680; [WM]).
- **Chat page:** `GET /chat/?node={id}`. Header: `.chat-header .media-user-name a`. The order/lot context panel is `div.param-item.chat-panel a` ([FPAPI] `get_chat` ~L1322-1341).
- **Private chat id convention:** `users-{min(userId, otherId)}-{max(…)}` ([FPAPI] `get_sales` ~L1575-1576; [WM] palette).
- **Image upload:** `POST /file/addChatImage` or `/file/addOfferImage` ([FPAPI] ~L805 `f"file/add{type_.title()}Image"`; [FPT]).
- **System chat messages (FunPay bot texts)** are recognisable by regex ([FPAPI] `common/utils.py` L138-262). Examples:
  - "Покупатель X оплатил заказ #XXXXXXXX."
  - "X, не забудьте потом нажать кнопку «Подтвердить выполнение заказа»."
  - "Покупатель X подтвердил успешное выполнение заказа #… и отправил деньги продавцу Y."
  - "…написал/изменил/удалил отзыв к заказу #…"
  - "Продавец X ответил на отзыв…"
  - "Заказ #… открыт повторно."
  - "Продавец X вернул деньги покупателю Y по заказу #…"
  - "Часть средств по заказу #… возвращена покупателю."
  - "Администратор X …"
  - The first FunPay message: "Уважаемые продавцы, не доверяйте сообщениям в чате! Перед выполнением заказа всегда проверяйте наличие оплаты в разделе «Мои продажи»."
  - The Discord warning: "Вы можете перейти в Discord. Внимание: общение за пределами сервера FunPay считается нарушением правил."
  - Order ids match `#[A-Z0-9]{8}`.
  - Quantity is shown as ", N шт." or "pcs.".

### D.4 Orders

- **Sales list:** `GET /orders/trade` with optional filters `id`, `buyer`, `state` (`paid` | `closed` | `refunded`), `game`, `section` (`lot-<id>` or `chip-<id>`), `server` and `side` ([FPAPI] `get_sales` ~L1420-1497).
- **Pagination:** read the hidden `input[name="continue"]` value, then POST the same URL with `continue=<value>` ([FPAPI] ~L1494-1516; [WM] `lib/history.ts`).
- **Purchases:** `/orders/` ([WM]).
- **Page check:** `h1.page-header.page-header-no-hr` text is "Мои продажи" / "My sales" / "Мої продажі".
- **Section filter:** the `select[name=game] option[data-data]` holds a JSON list of `["lot-123", "Section name"]` pairs, mapping section names to ids ([FPAPI] ~L1521-1533).
- **Row parsing** ([FPAPI] ~L1539-1580; [WM] fixture `tests/fixtures/sales.html`):
  - Row: `a.tc-item`.
  - Status from class: `info` = paid (Оплачен), `warning` = refunded (Возврат), neither = closed (Закрыт).
  - `.tc-order` = "#ID".
  - `.order-desc > div` = description; `.order-desc .text-muted` = "Game, Section".
  - `.tc-price` = "1 250.50 ₽" (class `tc-buyer-sum`).
  - Buyer: `.media-user-name span[data-href="https://funpay.com/users/ID/"]`.
  - `.tc-date-time` and `.tc-date-left`.
  - `.tc-status` (`text-primary` / `text-warning` / `text-success`).
- **Order statuses enum** ([FPAPI] `common/enums.py` L88-101): PAID, CLOSED, REFUNDED, PARTIALLY_REFUNDED, UNPAID.
- **Order page:** `GET /orders/{ID}/` ([WM] `orderReview`; [FPT]).
- **Newer JSON endpoint (Cardinal):** `POST https://funpay.com/api/orders/get` with `Content-Type: application/json`, `Accept-Language: <locale>` and body `{"order_uids": [...1-10 ids], "include": ["details","users","review"]}`. It returns `{status: "SUCCESS", data: {id: {...}}}` ([FPAPI] `get_orders_by_ids` ~L1358-1392). Not used by Wingman. Its exact response schema is **[UNVERIFIED]** beyond this.
- **Refund:** `POST /orders/refund` with `id` and `csrf_token`; the JSON may contain `error`/`msg` ([FPAPI] ~L1060-1079). Listed for completeness only; FunPro should not automate refunds.

### D.5 Offers (lots)

- **Public section:** `GET /lots/{nodeId}/` (common) or `/chips/{nodeId}/` (currency) ([FPAPI] ~L417-420).
- **Own lots in a section:** `GET /lots/{nodeId}/trade` ([FPAPI] `get_my_subcategory_lots` ~L500-555). Rows are `a.tc-item[data-offer=<id>]`; class `warning` means inactive. `.tc-price[data-s]` is the price; `i.auto-dlv-icon` inside `.tc-price` means auto-delivery; `.tc-amount` is stock; `.tc-server` / `.tc-side` hold server and side.
- **Public row** ([FPAPI] ~L433-490; [WM] `parseListing`): `a.tc-item[href*="offer?id="]`.
  - Class `offer-promo` (and `offer-promoted`) marks a promoted lot.
  - Attributes: `data-online="1"`, `data-auto="1"` (auto-delivery), `data-user`, `data-f-*` (filters).
  - Seller block `div.tc-user .media-body`: `.media-user-name`, `.rating-stars i.fas` (star count), `.media-user-reviews`, `span.pseudo-a[data-href=/users/ID/]`.
  - `.tc-price span.unit` = currency sign.
- **Lot page:** `GET /lots/offer?id={id}`. Contains `h1.page-header` ("Предложение не найдено" when missing), `a.js-back-link[href=/lots/NODE/]`, `.param-item h5` = "Краткое описание" / "Подробное описание" / "Картинки", and `a.attachments-thumb` ([FPAPI] `get_lot_page` ~L560-600).
- **Balance on the lot page** ([FPAPI] `get_balance` ~L613-633): `select[name=method]` carries `data-balance-total-rub`, `data-balance-rub`, `data-balance-total-usd`, `data-balance-usd`, `data-balance-total-eur` and `data-balance-eur`. This is a quick way to read available vs. total balance.
- **Edit form:** `GET /lots/offerEdit?offer={id}[&node={nodeId}]` (or `?node=` alone for a new lot). `form.form-offer-editor` holds `input`, `textarea` and `select` fields plus checked checkboxes (`on`).
  - `p.lead` on the page means an error.
  - `span.form-control-feedback` = currency.
  - `table.table-buyers-prices tr` (`th` method, `td` price) = buyer prices per payment method.
  - The form attribute `data-offer` is an HTML-escaped JSON containing `amount`.
  - Source: [FPAPI] `get_lot_fields` ~L1767-1810.
- **Field names** ([FPAPI] `types.py` `LotFields` L841-965):
  - `offer_id` (0 = new), `node_id`, `csrf_token`
  - `fields[summary][ru]`, `fields[summary][en]` (title)
  - `fields[desc][ru]`, `fields[desc][en]` (description)
  - `fields[payment_msg][ru]`, `fields[payment_msg][en]` (message to buyer after payment)
  - `fields[images]` (comma-separated image ids)
  - `price`, `amount`
  - `active` (`"on"` or empty)
  - `auto_delivery` (`"on"`/empty), `secrets` (newline-separated auto-delivery goods)
  - `deactivate_after_sale` (`"on"`/empty)
  - `deleted=1` (deletes the lot, [FPAPI] `delete_lot` ~L1874-1882)
  - Other `fields[...]` vary by category (server, side and other filters).
- **Save:** `POST /lots/offerSave` (urlencoded, XHR). Response JSON `{error?, errors?: [[field, msg], …], msg?}` ([FPAPI] `save_offer` ~L1830-1862; [WM] `bulk-lots.ts`).
- **Currency (chips):** `GET /chips/{subcatId}/trade` returns the form, saved with `POST /chips/saveOffers`. Fields: `game`, `chip`, `options[chip_min_sum]` and per-offer `…[amount]`, `…[price]`, `…[active]` ([FPAPI] ~L1814-1825; `types.py` L1023-1032).
- **Commission / buyer price:** `POST /lots/calc` with `nodeId` and `price`, or `POST /chips/calc` with `game` and `price`. Response `{methods:[{name, price:"1 234.56", unit:"₽", sort}], minPrice?: "10 ₽", error?}` ([FPAPI] `calc` ~L1723-1765; [WM] `lib/commission.ts`; [FPT] `section_commission.js`). The commission percentage is not published per section; it is derived from `methods`. Commission rates are **[UNVERIFIED]**.
- **Currency switch:** `POST /account/switchCurrency` with `cy`, `csrf_token` and `confirmed=false`. The modal text gives the exchange rate ([FPAPI] ~L1887-1910). This changes account state; read only, never automate.
- **Categories:** parsed from the home page on init ([FPAPI] `__setup_categories`). Section links look like `/lots/{id}/` (common) and `/chips/{id}/` (currency).

### D.6 Profile and reviews

- **Profile:** `GET /users/{id}/` ([FPAPI] `get_user` ~L1230-1300).
  - Name: `span.mr4`. Status: `span.media-user-status` (contains "Онлайн"/"Online").
  - Avatar: `div.avatar-photo[style=background-image:url(...)]`.
  - Banned: `span.label.label-danger`.
  - Offer sections: `div.offer-list-title-container h3 a[href=/lots/ID/ or /chips/ID/]`. Their parent contains `a.tc-item` rows (`.tc-desc-text`, `.tc-price[data-s]`, `.tc-amount`, `i.auto-dlv-icon`).
- **Reviews:** shown on the profile in `.review-container` (structure in B.2). More via `POST /users/reviews` with `user_id`, `continue` and `filter` ([WM] `lib/history.ts`).
- **Review / reply** ([FPAPI] `send_review` ~L985-1020; [WM] `replyToReview`):
  - `POST /orders/review` with `authorId`, `text`, `rating` (`""` for a seller reply), `csrf_token` and `orderId`.
  - The response JSON `content` is the new review block HTML. HTTP 400 returns `{msg}`.
  - Delete: `POST /orders/reviewDelete` with `authorId`, `csrf_token` and `orderId`.

### D.7 Finance

- **Balance page:** `GET /account/balance`. List `.tc-finance`; rows `.tc-item.transaction-status-(complete|waiting|cancel)[data-transaction]`; more via `POST /users/transactions` (see B.2).
- **Withdraw** (do not automate): `POST /withdraw/withdraw` with `csrf_token`, `currency_id`, `ext_currency_id` (`fps`, `card_rub`, `usdt_trc`…), `wallet` and `amount_int`. The response contains `amount_ext` ([FPAPI] ~L1082-1125).
- **Saved wallets:** `GET /account/wallets` (`form.details-editor`), saved with `POST /account/details` ([FPAPI] ~L1927-1980).

### D.8 Rate limiting and etiquette (observed)

- 429 responses happen. FunPayAPI and Wingman back off exponentially (capped at 30 s). FP Tools issue #1 reports 429s when several extensions poll. Wingman spaces calls 1.5-3 s apart. Cardinal waits 60 s after a 403/429/503 on raise.
- FunPay rejects too-frequent messages with explicit errors (D.3).

### D.9 Static domain

- Avatars and images are served from `sfunpay.com`, e.g. `https://sfunpay.com/s/avatar/…` ([WM] `tests/fixtures/listing.html`).

## (E) FunPay rules relevant to automation

**Access problem:** `funpay.com` (including `/trade/info` and `/en/trade/info`) and `funpay.freshdesk.com` could not be fetched: the egress proxy denied CONNECT and WebFetch DNS failed. The official rule text was **not** read. Everything below is either FunPay's own system message text found in open-source regexes (strong evidence), or secondary sources (**[UNVERIFIED]**). Before release, someone must read https://funpay.com/trade/info (RU) / https://funpay.com/en/trade/info and the support KB at funpay.freshdesk.com / support.funpay.com, and update this section.

1. **Off-platform contact is a violation (strong evidence).**
   - FunPay's own system message, captured in [FPAPI] `common/utils.py` `DISCORD` regex: "Вы можете перейти в Discord. Внимание: общение за пределами сервера FunPay считается нарушением правил." / "However, note that friending someone is considered a violation [of the] rules."
   - The FunPay support KB article "Связь с другими продавцами для совместного выполнения заказов покупателей" (search snippet) says: "Согласно нашим правилам для продавцов, обмен контактными данными между любыми пользователями строго запрещен." Exceptions are possible only via a support request. https://funpay.freshdesk.com/support/solutions/articles/103000275666
   - A KB article "Передача контактных данных" exists: https://funpay.freshdesk.com/support/solutions/articles/103000275672. Search summaries say passing contacts is the most common violation, often by accident in chat. **[UNVERIFIED wording]**
   - Implication for FunPro: templates and auto-replies must never insert Telegram/Discord/phone/VK handles or external links. Consider a warning linter on templates.
2. **Payment and delivery must go through FunPay.** Secondary sources report that delivering goods outside FunPay payment leads to an immediate ban **[UNVERIFIED]**. FunPay's first chat message tells sellers to check payment in «Мои продажи» before fulfilling (FPAPI `DEAR_VENDORS` regex).
3. **Do not ask buyers to confirm the order before it is fulfilled.** Listed by a 2026 blog summary of `/trade/info` **[UNVERIFIED]**. Implication: auto-messages must not push confirmation early. Only "please confirm after you've received it" wording is safe.
4. **Prohibited goods** (secondary summary **[UNVERIFIED]**): illegally obtained goods, personal data, malware, social-network accounts, and mass-sale of accounts not created by the seller. A forum mention references point 3.3 (account transfer), and the rules reportedly end with a note that each dispute is decided individually.
5. **Selling on other exchanges / discussing commission:** seller reports (Pikabu, otzovik) claim the rules forbid advertising other marketplaces and discussing FunPay's commission or a different price with buyers **[UNVERIFIED]**.
6. **Bots, automation, auto-raise, auto-delivery, auto-replies:** no official text was found. Search-engine summaries found no explicit ban. One mail.ru answer claims FunPay "не одобряет" auto-raise; a LiveJournal blog claims accounts get blocked "за использование ботов". Both are low-quality and **[UNVERIFIED]**.
   - FunPay itself provides auto-delivery (the `auto_delivery`/`secrets` fields in the offer editor) and a manual raise button with a server-enforced cooldown. Using the site's own raise endpoint only when FunPay reports it is allowed is the approach Wingman declares to store reviewers (`store/reviewer-notes.md`).
   - Wingman README: "Но правила FunPay устанавливает FunPay: автоответы и массовые действия включайте осознанно".
7. **Reviews:** FP Tools offers "Бонус за 5★ отзыв". Whether FunPay rules forbid rewarding or soliciting positive reviews was **not confirmed**; search found nothing **[UNVERIFIED]**. This is a common marketplace prohibition, so treat it as high-risk and do not build it.
8. **Impersonation / scams:** FunPay warns users not to trust chat messages (system message above). Wingman flags messages that impersonate administration (`lib/scam.ts`).

## (F) Public user requests / issues (with links)

- **Wingman:** 0 issues. Issue templates exist (`.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`). https://github.com/sibamor/Wingman/issues
- **FP Tools #1 "Пофикси"** (closed, 21 comments): https://github.com/XaviersDev/FunPay-Tools/issues/1
  - Requests: better contrast in the chat list; distinguishable links; faster chat switching (lag); fewer requests, because 429s appear when switching chats or buying; no duplicate promo badge; no buyer price on currency lots; fix conflicts with other extensions.
  - Users compared it to LiteBot, which "shows one badge per lot" and caused no 429s together with "FP Extension".
- **Implied demand** from feature lists across tools: auto-raise (all three), auto-replies/greeting, review replies, sales analytics and CSV/Excel export, commission/buyer-price calculator, bulk lot edit, lot copy/clone, order timers and undelivered-order reminders, Telegram notifications, chat templates, blacklist, notes/tags, dark themes, privacy mode, translation of lots into English.
- LiteBot and funpay.tools feedback channels (Telegram, Discord, store reviews) were not reachable.

## (G) What could not be accessed

- **funpaylitebot.com** (`/en`, `/changelog`, `/en/pricing`, `/en/terms`, `/en/privacy`): DNS/proxy blocked. Only search snippets were used.
- **funpay.tools:** blocked. Only the GitHub repo was used.
- **funpay.com** (all pages, including `/trade/info` and `/en/trade/info`) and **funpay.freshdesk.com:** blocked. No official rule text was read.
- **Chrome Web Store, addons.mozilla.org, chrome-stats.com, extpose.com:** blocked (no store reviews).
- **web.archive.org:** WebFetch refused.
- **GitHub API** (`gh api …/issues`) for Wingman and FP Tools: 403, because the session is scoped to zukvus/funpro. Fell back to WebFetch of github.com HTML pages (worked).
- **`FunPayCardinal/FunPayAPI`** standalone repo: clone needed auth. Used the copy bundled in `sidor0912/FunPayCardinal` instead.
- Not verified on the live site, so treat as possibly drifted: the exact success message of `/lots/raise`; the official raise cooldown length; the `api/orders/get` schema; commission percentages; current CSS class names (FunPay changes markup periodically, per the Wingman README).
