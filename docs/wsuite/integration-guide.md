# wChatbot — External integration guide (public API)

| | |
|---|---|
| **Version** | matches `response-contract.md` 1.16.1 (the server reports the live version as `contract_version` — see §3.1) |
| **Audience** | Any external website embedding a **custom** chat UI on top of the wSuite chatbot API — e.g. the branded `nest-chatbot-ai` microsite. |
| **Scope** | The **transport + auth** layer: base URL, the four endpoints, the API-key model, the request/response flow, errors, rate limits, and CORS. |
| **Not in scope** | The **response envelope** (`reply` / typed `actions[]` / element types). That is fully specified in [`response-contract.md`](response-contract.md) — read it alongside this document; do not duplicate its rules here. |

This platform ships its own drop-in bubble widget at [`../resources/widget/chatbot.js`](../resources/widget/chatbot.js). It is the **canonical, security-reviewed reference implementation** of everything below — when in doubt about a detail, read how `chatbot.js` does it. A custom UI (a different form factor: full-page, branded, multi-page) is a first-class alternative consumer of the exact same API and contract; both coexist.

---

## 1. Base URL

All endpoints are under the API origin you POST to:

```
{API_BASE}/api/v1/chatbot/...
```

`{API_BASE}` is the deployment origin (local Herd dev: `https://nest-mind.test`; production: the platform's public domain). A consumer should derive it once from config and resolve every path — including the async-poll `url` — against it. **Never hardcode a cross-origin poll URL** (see §4).

---

## 2. Authentication

Every request carries a **public-scoped** API key as a Bearer token:

```
Authorization: Bearer ws_live_<prefix>.<secret>
```

- **Key format** — `ws_live_<prefix>.<secret>`. The server stores only a SHA-256 hash of `<secret>`; the plaintext is shown exactly once at creation.
- **Scope** — keys carry a `scope` of `public` or `full`. Use a **`public`** key in a browser-embedded UI: it is admissible **only** on the chatbot guest routes below and is **public by design** (D-032) — it is meant to be visible in page source. Never ship a `full` key to the browser.
- **Binding** — a key is bound to exactly **one tenant + one site**. All conversations it opens belong to that site. (The *property* within the site is chosen per-conversation, see §3.)
- **Minting a key** — in the admin panel: **Tenancy → Manage API Keys → Create**, choose the site and **scope = `public`**; copy the plaintext from the one-time notification. (Dev shortcut: the owner-only **Widget Preview** Filament page mints a public key automatically when `WSUITE_CHATBOT_DEV_WIDGET_PREVIEW=true`.)

> **Security posture (be honest with yourself).** A public key is a scope-limited *secret that is meant to be seen*, not a cryptographically distinct "publishable" key. A site can now be locked to an **origin allow-list** (§7) so a copied key is refused from unlisted origins — but `Origin` is **browser-asserted**, so the allow-list narrows a leak's blast radius in real browsers; it is **not authentication**. Your real controls remain the key's `public` scope, the per-key rate limits (§6), and `chatbot.enabled`. Don't treat a public key as per-user or private. Empty allow-list = allow-all (the default), so nothing here changes until you configure it.

---

## 3. The four endpoints and the turn flow

| Step | Method + path | Route name | Success |
|---|---|---|---|
| **Init** | `POST /api/v1/chatbot/conversations` | `chatbot.v1.conversations.store` | `201` |
| **Turn** | `POST /api/v1/chatbot/conversations/{uuid}/messages` | `chatbot.v1.conversations.messages.store` | `200` |
| **Poll** | `GET /api/v1/chatbot/conversations/{uuid}/turns/{turn}` | `chatbot.v1.conversations.turns.show` | `200` |
| **Event** *(since 1.16.0)* | `POST /api/v1/chatbot/conversations/{uuid}/events` | `chatbot.v1.conversations.events.store` | `204` |

All four require the `Authorization` header from §2. `{uuid}` is the conversation's public identifier (sequential DB ids never leave the API).

### 3.1 Init — start a conversation

```
POST /api/v1/chatbot/conversations
Authorization: Bearer ws_live_...
Content-Type: application/json

{ "locale": "es-ES", "property": "Las Eras Nest Hostel" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `locale` | `string` (≤5) | no | The guest's language hint — send `navigator.language`. Drives the greeting's language, and **since 1.6.0** also selects per-locale tenant content (the init promo card and quick-prompt chips) where the tenant has supplied translations. **Since 1.13.0** it is also the visitor's preferred language for every turn that sends no `locale` of its own, until the guest writes theirs (§3.2). |
| `property` | `string` (≤255) | no | A **soft** property-name lookup within the key's tenant. An unknown name is not an error — it simply yields a conversation with no property pre-scoped. No DB `exists` check; the site/tenant always come from the key, never the body. A **matched** name also seeds the conversation's working memory, so answers — from turn 1 — are scoped to that property until the guest names another one; send it whenever your page is about one specific property (the bundled widget does via `data-property`). |

**`201` response:**

```json
{ "conversation": { "uuid": "9b2c…" }, "greeting": "Hi! How can I help?", "assistant": { "name": "Nesti", "disclosure": "AI assistant" }, "actions": [], "idle_hours": 24, "server_time": "2026-10-07T09:46:12+00:00", "contract_version": "1.15.0" }
```

| Response field | Type | Since | Notes |
|---|---|---|---|
| `conversation.uuid` | `string` | 1.0.0 | The conversation's only public identifier. Persist it. |
| `greeting` | `string` | 1.0.0 | Render as the first bot bubble. Always a finished string: where a site's greeting says the assistant's name, the server has already written it in. |
| `assistant` | `object` | **1.15.0** | Who the guest is talking to: `name`, the display name the site owner set for the assistant (omitted when they set none), and `disclosure`, the server's statement that this is an AI (always sent). **Persist it with the conversation record** — see below. Absent on older servers. |
| `actions` | `array` | 1.5.0 | The same element vocabulary as a turn (greeting-time quick prompts / promo). Render after the greeting like any turn's `actions[]`; always sent (`[]` when unconfigured), absent on pre-1.5.0 servers. |
| `idle_hours` | `int` | **1.7.0** | The conversation idle window (§5, `410`). **Drive your stored-conversation expiry from this**, not from a constant — see below. |
| `server_time` | `string` | **1.7.0** | ISO-8601 with offset, at the instant the conversation was created. For a one-off client-clock correction — see below. |
| `analytics` | `bool` | **1.16.0** | `true` when this site counts button clicks; **absent otherwise** — never `false`. Report clicks (§3.4) only while it is `true`, and **persist it with the conversation record**: your resume path never calls init. Absent on older servers, which is the same as "do not report". |
| `contract_version` | `string` | 1.2.0 | The live contract version; also in the `X-Chatbot-Contract` header. |

Persist `uuid` (the reference widget keys it to `localStorage` per API key). Render `greeting` as the first bot bubble.

You **may** also persist the transcript and replay it when you resume, instead of re-greeting. Worth knowing what the minimal version costs: a consumer that stores only the uuid keeps the conversation alive across a page change but shows none of it, and — because the resume path never calls init — silently replaces the *server's* greeting and welcome elements with its own fallback for the rest of the window. Store `greeting` and `actions` alongside the uuid if you want the resume to look like the visit it continues.

#### `idle_hours` — stop mirroring the window as a constant

**Since 1.7.0.** A conversation `410`s after this many hours of inactivity (§5). Before 1.7.0 there was no way to learn it, so every renderer hardcoded 24 — which is correct only until a deployment changes its config. When that happens, a widget still expiring at hour 24 drops the guest's transcript **and opens a second conversation while the server's original is still live**, still holding whatever `property` seeded. It looks fine and answers as a stranger.

Two rules:

- **Persist it with the conversation record, not just in memory.** Your resume path does not call init, so a value read only at init is not available on the one visit that needs it.
- **Absence is normal** — an older server sends nothing and an older stored record has no field. Fall back to your existing constant in both cases.

It is sent as a **duration, not an expiry instant**, on purpose: the expiry moves forward on every turn while init happens once, so a cached `expires_at` would be wrong from turn 1.

#### `server_time` — one clock correction per conversation

**Since 1.7.0.** ISO-8601. Nothing in the guest API dates a message — `turn` is an ordering, not an instant — so a consumer that timestamps its own stored transcript is recording the *sending device's* clock, skew included. Compute `offset = Date.parse(server_time) - Date.now()` once at init and apply it to the stamps you write. It does not address a guest who changes timezone between visits, and it is not a per-turn timestamp. Absent on older servers.

#### `assistant` — the assistant's name, and the AI disclosure

**Since 1.15.0.** `{ "name": "Nesti", "disclosure": "AI assistant" }`.

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | The display name the site owner set for the assistant. **Omitted when they set none** — never `null`, never empty. Plain text: a letter first, then letters of any script, digits, spaces, hyphens or apostrophes, at most 24 characters (a server guarantee, so you can size a header against it). Not localized — a name is the same in every language. |
| `disclosure` | `string` | A short statement that the guest is talking to an AI: `AI assistant`, in the conversation's language (en/es/it/de/fr, English otherwise). Code-emitted and **always sent**. It is not a site setting, so an owner can rename the assistant but cannot remove it. |

Four rules:

- **Show the name wherever you name the assistant** — the header, the input hint, the launcher's label — in place of any name of your own. **Keep a name-free fallback:** `name` is absent for a site that set none, and the whole object is absent on an older server.
- **A disclosure beside the name — MUST.** A renderer that shows `name` must also show that the assistant is an AI, using `disclosure` or its own translation of it, and must show it **whether or not a name arrives**. The name never stands in for it.
- **Persist it with the conversation record, and no longer.** Most renderers paint their header before init and never call init on a resume, so a name read only off the init response is missing on exactly the visits that return to a conversation — the `idle_hours` lesson again. Do not cache it beyond the conversation either: after an owner renames the assistant, a longer-lived cache shows the old name over a greeting that says the new one. A resumed conversation keeps the name it started under; that is expected.
- **Never write the name into `greeting` yourself.** A site's greeting can already say it — the server resolves the owner's placeholder before sending — so `greeting` always arrives finished.

Treat `name` as tenant-authored text: `textContent`, never `innerHTML` ([Security rule](response-contract.md#security-rule-both-widgets)). Whether the assistant also *answers* to its name is the site owner's switch, and nothing a renderer reads: asked who it is, it always says it is an AI, with or without the name.

#### `contract_version` — detecting you're behind

The init response carries `contract_version` (`MAJOR.MINOR.PATCH`), the live version of the [`response-contract.md`](response-contract.md) envelope your UI renders — and, since 1.3.0, of the guest API's request fields too (a consumer tracks one number for the whole surface). The same value is echoed in an **`X-Chatbot-Contract`** response header, which is **CORS-exposed**, so a browser can read either channel; the **body field stays the documented primary** (one less thing to get wrong behind a proxy that strips headers).

Use it for **drift visibility, never for gating**:

- Record the version your UI was **built against** (a constant).
- On init, compare. If the server reports a **higher** version, `console.warn` once — a new element type or field exists that you don't render yet — then carry on. You **stay fully functional**: the [ignore-unknown rule](response-contract.md#extension-rule-the-dry-seam) (§4) means unrecognised element types are simply skipped. **Never hard-fail on a version mismatch.**
- A **lower** server version than yours cannot happen in practice (the server only moves forward) and is likewise not an error.
- **A higher version is never a migration.** By the contract's [breaking-change guarantee](response-contract.md#versioning), **MINOR and PATCH can never break you** — only a MAJOR could, and the envelope is frozen so one should never be issued. Read the Changelog's **Breaking** column to confirm per row. Each version is tagged upstream as `chatbot-contract-v<X.Y.Z>`, so you can ask for an exact packet snapshot or a diff from the version you are on.

The reference widget ([`chatbot.js`](../resources/widget/chatbot.js), `BUILT_AGAINST`) implements exactly this one-time warn; copy that pattern.

### 3.2 Turn — send a guest message

```
POST /api/v1/chatbot/conversations/{uuid}/messages
Authorization: Bearer ws_live_...
Content-Type: application/json

{ "message": "do you have wifi?", "locale": "es" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | `string` | yes | Max length = `wsuite.chatbot.message.max_length` (default **2000**). |
| `locale` | `string` (≤5) | no | **Since 1.3.0; its meaning changed in 1.13.0.** The visitor's **preferred** language — it answers until the guest writes theirs. See below. |
| `action` | `object` | no | **Since 1.16.0.** What the guest's tap or submit means, beside the `message` — never instead of it. See below. |

#### `action` — a keyed chip, or a form submit

**Since 1.16.0** (D-111(a)). One shape, `{type, id?, payload?}`, and two kinds:

```json
{ "message": "I would like to book a bed", "action": { "type": "reply", "payload": { "key": "book-a-bed" } } }
{ "message": "Prices for Duque Nest, 2026-11-03 → 2026-11-06",
  "action": { "type": "form", "id": "book", "payload": { "values": { "place": "duque-nest", "dates": { "from": "2026-11-03", "to": "2026-11-06" } } } } }
```

| Field | Notes |
|---|---|
| `type` | `reply` — a tap on a `quick_replies` item that carries a `key`; `form` — a [`form`](response-contract.md#form--a-form-the-guest-fills-in-the-chat) submit. Anything else is `422`. |
| `id` | `form` only, required: the form's `id`, ≤ 64 characters. |
| `payload.key` | `reply` only, required: the chip's `key`, ≤ 64 characters. |
| `payload.values` | `form` only, required: at most 20 values — a string ≤ 500 characters, an integer, `true`, or a date range `{from, to}` of two `Y-m-d` strings. Leave a blank optional field out. |

Three things to know:

- **`message` is always what the guest sees** — the chip's `message`, or the form's filled
  `submit_message` — so the transcript stays readable, and a server older than 1.16.0, which does not
  read `action`, answers the message exactly as before.
- **Sending `action` declares that you render every element up to your `BUILT_AGAINST`.** The server
  sends a `form` only to a turn that carried one; the same chip's message sent alone is answered as an
  ordinary turn. Send it only once you draw `form`.
- **Only the shape is a `422`.** A key the tenant no longer publishes, or a form value the server no
  longer offers (a hostel closed since the form was sent), is not an error: the turn falls back to the
  message's text, or the reply asks again.

#### Prices in a date picker — optional, from the price API

The Book form sends no per-night prices. A renderer that wants them in its date picker reads them
itself, with the same embed key and origin: `GET /api/v1/pms/prices/nights?properties=<slug>&from=<first>&to=<last>&summary=1`,
the slug being a hostel option's `key` in the form (an `area:` option has none). Written against
**price contract 0.4.0** (`docs/price-contract.md`, §4 and §4.1), which is pre-1.0 and may change — so
treat the read as a decoration: when it fails, draw the picker without prices. The answer to a submit
never depends on it; the server reads its own live prices.

#### `locale` — the visitor's preference vs. the guest's own language

**The server answers in the language the guest writes** (since 1.13.0 — D-083). It detects the language of every message; once a message *shows* one — 12 or more letters once hostel, island and town names are removed, or any non-Latin letter — that language is used and remembered for the conversation. A message that shows none (`ok`, `2`, a date, a hostel name, or a chip the bot just offered, sent back) keeps the remembered language, and a later sentence in another language switches it.

`locale` is the visitor's **preferred** language, and it answers only where the guest has not yet shown theirs: the turns before their first message that does. Sending the browser's language on every turn is fine and is what it is for — its primary subtag (`navigator.language.split('-')[0]`), since a full tag can exceed 5 characters (`es-419`, see Format); it no longer overrides what the guest writes, as it did from 1.3.0 until 1.13.0. When a turn carries none, the conversation's stored locale (the init `locale`, §3.1) is the preference.

- **Any language.** The reply language is not restricted to a fixed list: a guest who writes Ukrainian is answered in Ukrainian. Server-localized strings (canned lines, chip messages, "Book now") exist in en/es/it/de/fr and fall back to English for any other language, and tenant content falls back to its base locale — except, **since 1.16.1** (D-114), an answer the server gives without the model to a tapped chip, which with the chips under it is translated once from the tenant's English into the guest's language. You may therefore send the browser's primary language unclamped (`uk`) rather than the nearest language your UI supports — the server records it and answers the pre-writing turns in it.
- **A UI language switcher** no longer forces the reply language once the guest has written in another one. If you keep one, it sets the preference: the first turns' language and your own chrome.
- **Format.** Send a full tag if that is what you have — only the 2-letter primary subtag is used (`es-ES` → `es`), and the field is capped at 5 characters (longer → `422`, so truncate a long tag yourself). Validation is by **shape, not by registry**: any two ASCII letters are accepted and passed straight to the model, deliberately — the reply language is not restricted to a fixed list. A value that yields no 2-letter primary subtag (`spa`, `1`, empty) is ignored rather than erroring, and the conversation's stored locale serves as the preference instead. Sending a code that is not a real language (`zz`) is therefore honored as a preference, not corrected — send what the browser actually reports.
- **Scope.** The turn's resolved language — the preference, or the guest's own — sets the generated prose and the server-localized element labels ("Book now") together. It does not translate the guest's own message or re-translate the transcript.
- The reference widget sends `locale` only at init; the server uses the conversation's stored locale as the preference on every turn that carries none.

**`200` response** — the frozen envelope from [`response-contract.md`](response-contract.md):

```json
{ "reply": "Yes, free wifi throughout.", "actions": [ … ], "turn": 3 }
```

A turn **always returns `200`** on success — the orchestrator degrades any LLM/provider/budget failure to a localized "busy" reply at `200`, never a 5xx. Render `reply`, then render each element of `actions` **in order** (§4). A conversation may also hit a server-side **turn cap**: past it, the turn returns a canned "message limit reached" reply in the same `200 {reply, actions, turn}` shape — the envelope never changes — and the guest should start a new conversation to continue. That reply carries two elements you already handle per §4: **since 1.6.0** a `conversation_ended` element (read it if you want to offer "start a new chat" at exactly the right moment; ignore it and the reply text still says so), and **optionally** a `contact_channels` element with the property's call/WhatsApp/email. **Since 1.14.0** a busy reply can carry `contact_channels` too — when the failure came after a handoff request was already raised — so render `actions[]` on every `200`, busy or not.

### 3.3 Poll — resolve an async turn

Only needed when a turn's `actions[]` contains an **`async_result`** element (a gated booking/tool turn whose final reply is generated by a queued job). The turn response already carries a complete **interim** reply plus deterministic fallbacks, so **polling is optional** — a consumer that ignores `async_result` is still fully functional. A poll-aware consumer fetches the element's `url`:

```
GET {resolved async_result.url}
Authorization: Bearer ws_live_...
```

**`200` responses:**

```json
{ "status": "pending", "turn": 4 }
{ "status": "ready",   "reply": "…final reply…", "actions": [ … ], "turn": 4 }
{ "status": "failed",  "reply": "…busy-style final…", "actions": [], "turn": 4 }
```

Recommended cadence: **~2s → 5s backoff, give up ≈120s**. On `ready`/`failed`, replace the interim bubble's text with `reply` and render `actions`. This endpoint has its **own lighter rate limit** (§6) so polling never eats the turn budget.

### 3.4 Event — report a click on a call to action

**Since 1.16.0** (D-113), and **only while the init's `analytics` is `true`**. When the guest clicks
a call to action the chat drew, report which one:

```
POST /api/v1/chatbot/conversations/{uuid}/events
Authorization: Bearer ws_live_...
Content-Type: application/json

{ "type": "cta_click", "element": "availability", "cta": "book", "turn": 3 }
```

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `cta_click`. |
| `element` | yes | The element the button belongs to: `link_button` · `booking_link` · `availability` · `property_cards` · `promo_card` · `contact_channels`. |
| `cta` | yes | Which button, and it must be one the element carries: `link_button` → its `id` (`book` · `website` · `directions`); `booking_link`, `availability` → `book`; `property_cards` → `book` (a card's button) or `more` (the "see all" link); `promo_card` → `promo`; `contact_channels` → `phone` · `whatsapp` · `email`. |
| `turn` | no | The `turn` of the reply the button came with; leave it out for the welcome's elements. |

- **Never send a URL, a label, a `prefill` or anything the guest typed.** The server reads these
  four fields only and stores two enums and the turn; an unknown value is `422`, an unknown key is
  ignored.
- **Always `204`, and fire and forget.** A site that does not count clicks, or a conversation past
  its cap, stores nothing and still answers `204`. Resolution is the turn endpoint's (`404`, `410`),
  but **never re-init on an event's `404`/`410`** — a lost click is not a dead conversation, and an
  event never extends the conversation's idle window.
- **Do not hold the click.** Send it as the link opens. If your links open in a new tab, a plain request
  survives the click (the reference widget uses its ordinary XHR); if one can unload your page, use
  `fetch(…, {keepalive: true})`. `navigator.sendBeacon` cannot carry the `Authorization` header.
- It has its **own rate limit** (§6), so reporting never spends the guest's turns.

---

## 4. Rendering elements

The element types (`link_button`, `contact_channels`, `booking_link`, `availability`, `async_result`, `property_cards`, `promo_card`, `quick_replies`, `form`, `conversation_ended`) and their fields are the authority of [`response-contract.md`](response-contract.md) — implement against that. Three **MUST** rules a consumer cannot skip (all demonstrated in `chatbot.js` `renderAction` / `safeHttpUrl`):

1. **Ignore unknown `type`s.** New element types ship server-side ahead of any given UI. Skip a type you don't render; never break on it.
2. **`async_result.url` must be treated as relative.** It always begins with `/`. Resolve it against `{API_BASE}` (§1) and **reject any non-relative value.** This structurally keeps the Bearer key on your own origin.
3. **Render as text, links and images only for `http(s)`.** Put all guest/LLM/element strings into the DOM via `textContent` / `setAttribute` / created nodes — **never `innerHTML`** (XSS). Honor element **`url` *and* `image`** fields only for `http`/`https` schemes — that means `link_button`, `booking_link`, `availability`, `property_cards` items (`url` **and** `image`) and its element-level `more.url`, and `promo_card` (`image` **and** `cta.url`, which is tenant-authored). Anything else is dropped. Construct `tel:` / `mailto:` / `https://wa.me/<digits>` yourself from `contact_channels` values, never verbatim — and **since 1.14.0**, if you append `contact_channels.prefill` (the handoff's pre-written message) to those links, show its text before the guest can leave the page, percent-encode it into the `text` / `subject` / `body` query value only, and keep it out of analytics and logs (the contract's `prefill` rules). `quick_replies` items carry no navigation URL — since 1.16.0 an item's `image` is an image source under the same rule, as is a `form` `consent` field's `link.url`. The authoritative inventory is [`response-contract.md`](response-contract.md)'s security rule — every URL-bearing field it adds inherits this.

---

## 5. Errors

| Status | When | Consumer action |
|---|---|---|
| `401` | Missing/invalid/revoked key, or token not prefixed `ws_live_`. | Fatal — bad key. Stop. |
| `403` | Init: `chatbot.enabled` is off for the site. Or: key scope not admitted. Or: the request `Origin` is not on the site's allow-list (§7) — body `{"message":"Origin not allowed."}`. | Hide the widget silently (register your origin — §7 — if the allow-list is the cause). |
| `404` | **Endpoint-specific — see below.** Turn: unknown/foreign `uuid`. Poll: the turn row is not visible to this request (or is not an async turn). Event: unknown/foreign `uuid`. | Turn: treat the conversation as gone → **re-init** (as for `410`). Poll: treat as **transient** → keep backing off until give-up. Event: drop the click and **never re-init** (§3.4). |
| `410` | Conversation idled out (24h since last activity). **Endpoint-specific — see below.** | Turn: **re-init transparently** (open a new conversation, optionally resend the last message once) — the reference widget does this automatically. Poll: **stop polling and do not re-init** — keep the interim reply. Event: drop the click and **never re-init** (§3.4). |
| `422` | Init: no site resolved for the key. Turn: a malformed `message`, `locale` or `action` (§3.2). Event: an unknown `type`, `element` or `cta`, or a `cta` the element does not carry (§3.4). | Configuration error, or a renderer bug: fix the request. A turn's `422` stores nothing. |
| `429` | Rate limit exceeded (§6). | Read `Retry-After`: about a minute → back off, show a soft "one moment" message and retry; much longer (a daily cap, up to 24h) → say "come back later" and do not retry. |

Note: turn/poll **content** is always `200`; the non-200s above are resolution/auth failures only.

### 5.1 `404` and `410` mean different things on the turn and the poll endpoint

These are the two errors whose handling is **not** uniform — get either wrong and you can wedge a browser, abandon a live answer, or open a conversation the guest never spoke in.

- **Turn `404`** (`POST …/messages`) — the stored `uuid` no longer resolves for your key. It is **terminal for that conversation**: clear the stored uuid, re-init, and resend the message once (exactly your `410` path). If you instead show a generic error **without clearing your stored uuid**, that browser retries the same dead uuid on every message until your retention window expires — up to 24h of a permanently broken widget for that visitor.
- **Poll `404`** (`GET …/turns/{turn}`) — **transient**: keep backing off exactly as for `pending`, and stop only at your give-up deadline (~120s). You cannot tell a permanently unknown turn from a row that is simply not visible to *this* request yet (replica lag, a request that raced the write), and the costs are asymmetric — backing off just ends at give-up, whereas re-initing throws away a conversation that is perfectly alive and abandons an answer that is still being generated.
- **Turn `410`** — re-init transparently, as the error table says.
- **Poll `410`** — **stop polling, and re-init nothing.** The conversation that owns this turn is gone, so its result is no longer worth fetching; keep the interim reply and its fallbacks, which are already a complete answer. The guest's *next* message hits the turn endpoint, gets its own `410`, and re-inits there — where a fresh conversation actually has a message to carry. Re-initing from a poll opens a conversation the guest has not spoken in yet.

The reference widget implements all four: `sendMessage` treats `404` like `410` (clear, re-init, resend once); `pollResult` folds `404` into its transient/back-off branch and returns silently on `410`.

---

## 6. Rate limits

Three independent buckets (turns, polls and click events never eat each other's budget). **Each enforces a per-visitor budget and a per-key site ceiling**, and the guest bucket also enforces both **per day** — a `429` means whichever limit tripped:

| Bucket | Per visitor (key + IP) | Per key (whole site) | Route |
|---|---|---|---|
| `chatbot-guest` | **20 / min** and **100 / day** | **300 / min** and **300 / day** | init + turn |
| `chatbot-poll` | **60 / min** | **900 / min** | poll |
| `chatbot-event` | **20 / min** | **300 / min** | event (since 1.16.0) |

Tunable per deployment via `WSUITE_CHATBOT_THROTTLE_PER_MINUTE` / `WSUITE_CHATBOT_POLL_PER_MINUTE` / `WSUITE_CHATBOT_EVENT_PER_MINUTE`, `WSUITE_CHATBOT_SITE_THROTTLE_PER_MINUTE` / `WSUITE_CHATBOT_SITE_POLL_PER_MINUTE` / `WSUITE_CHATBOT_SITE_EVENT_PER_MINUTE`, and `WSUITE_CHATBOT_THROTTLE_PER_DAY` / `WSUITE_CHATBOT_SITE_THROTTLE_PER_DAY`.

**A daily `429` is long — read `Retry-After` (since 1.11.0).** The daily windows are a rolling 24 hours from the first counted request, not a calendar day. Every `429` carries `Retry-After` (seconds until the limit that refused it reopens), readable cross-origin: about a minute means a per-minute limit — back off and retry; hours mean a daily cap — tell the guest to come back later (or offer the hostel's contact channels) instead of "try again in a moment", and stop retrying. A refused request is never counted against any limit. The site daily ceiling exists to stop an automated flood spending the tenant's AI budget; reaching it alerts the platform operator, and real traffic sits far below it. These HTTP throttles are the abuse layer; the real per-provider AI cost limiting lives inside the platform gateway and is invisible to consumers.

**What "per visitor" honestly means.** The embed key is public and identical for every visitor, so the per-visitor bucket is keyed on **key + client IP** — the only visitor signal available at throttle time. Consequences worth designing around:

- Visitors sharing an egress IP (corporate NAT, a hotel's own wifi, a mobile carrier CGNAT, a proxy) share **one** bucket. On a site whose guests are mostly on the property's wifi, budget for that.
- A client that rotates IPs gets a fresh bucket each time — which is exactly why the **per-key site ceiling** exists as the backstop, and why it also caps the AI spend a copied key can drive.
- **Per-site *configurable* limits are not available**, by construction: the throttle runs before the API key is resolved, so no site is known yet. The numbers above are deployment-wide config, not per-site settings. (Per-*key* isolation you do get — a separate key gets a separate ceiling, which is the argument for a separate staging key in §7.)

---

## 7. CORS / origins

Two independent layers apply to `api/v1/chatbot/*`:

**CORS (transport).** Static and permanent: `allowed_origins: ['*']`, methods `POST, GET, OPTIONS`, request headers `Content-Type, Authorization`, **exposed response headers `X-Chatbot-Contract`** (so a browser can read the contract version off the header as well as the init body — §3.1) **and `Retry-After`** (how long a `429` lasts — §6, since 1.11.0), `supports_credentials: false`. It stays `*` because CORS preflights are unauthenticated (no key ⇒ the platform can't know which site, so it can't pick a per-site policy). CORS is **not** the access control — the origin lockdown below is.

**Origin allow-list (per-site access control).** A server-side `Origin` check (the `EnsureOriginAllowed` middleware), opt-in per site:

- **Default = allow-all.** A site with no configured list accepts the widget from **any** origin — so you develop and test with **no registration step**.
- **Register in admin:** **Tenancy → Manage Sites → edit the site → Allowed origins**, one entry per origin. An unset/empty list keeps allow-all.
- **Entry format:** full origins only — `scheme://host[:port]`, no path or trailing slash (e.g. `https://www.example.com`, `http://localhost:5173`). Comparison is case-insensitive. Scheme **and** explicit port must match (`https://x.com` ≠ `http://x.com`, `…:8443` ≠ no port).
- **Wildcards:** `https://*.example.com` matches any subdomain depth (`shop.` , `a.b.`) but **never the apex** `https://example.com` — list the apex separately if you need it.
- **Always allowed:** a request with **no `Origin` header** (same-origin / non-browser) passes, and the platform's own origin (`APP_URL`, e.g. the admin panel's Widget Preview) is implicitly allowed.
- **Rejection:** a configured site refuses an unlisted origin with `403 {"message":"Origin not allowed."}` (logged server-side).
- **Register before a public launch:** once you set a list, add every production/staging origin that embeds the widget, or it will be refused. `Origin` is browser-asserted (see §2) — this is a leak-blast-radius control, not authentication.

### 7.1 Staging vs production: use a separate site + key

**Recommended: give staging its own site and its own public key**, rather than adding staging origins to the production site's allow-list.

The decisive reason is §6: **the rate-limit ceiling is per key.** Share one key and a staging load test, a crawl, or a runaway retry loop eats the production site's budget and 429s real guests. A separate key can't. It also separates what you almost certainly want separated anyway — conversations and metrics (staging noise stays out of the production panel), `chatbot.enabled`, the greeting, the handoff email — and a leaked/committed staging key exposes nothing production.

Same-site is workable if you accept that coupling (one shared bucket, one shared transcript history). If you go that way:

- `https://*.example.com` covers preview deploys at any subdomain depth — but **never the apex**; list `https://example.com` separately.
- `http://localhost:5173` must match **scheme and explicit port exactly**; add one entry per port you actually serve from.
- The platform's own origin (`APP_URL`) is implicitly allowed, so the admin panel's Widget Preview keeps working without an entry.

---

## 8. Minimal reference flow

Illustrative only — [`../resources/widget/chatbot.js`](../resources/widget/chatbot.js) is the hardened version (410/404 re-init, poll backoff, XSS-safe rendering, scheme checks):

```js
const BASE = "https://nest-mind.test";
const KEY  = "ws_live_xxxxxxxxxxxx.xxxxxxxx…";      // public-scoped
const H    = { "Content-Type": "application/json", "Authorization": `Bearer ${KEY}` };

// 1. init
let r = await fetch(`${BASE}/api/v1/chatbot/conversations`, {
  method: "POST", headers: H,
  body: JSON.stringify({ locale: navigator.language, property: "Las Eras Nest Hostel" }),
});
const { conversation: { uuid }, greeting } = await r.json();

// 2. turn
r = await fetch(`${BASE}/api/v1/chatbot/conversations/${uuid}/messages`, {
  method: "POST", headers: H, body: JSON.stringify({ message: "do you have wifi?" }),
});
if (r.status === 410 || r.status === 404) { /* conversation gone: clear uuid, re-init, resend once (§5.1) */ }
const turn = await r.json();               // { reply, actions, turn }

// 3. poll (only if an async_result element is present)
const async = turn.actions.find(a => a.type === "async_result");
if (async && async.url.startsWith("/")) {
  const res = await fetch(BASE + async.url, { headers: H });   // resolve relative → BASE
  const final = await res.json();          // { status, reply?, actions?, turn }
}
```

---

## 9. Testing as a real external site

1. Mint a **public** key for the target site (§2).
2. Point your custom UI's `{API_BASE}` at the platform origin and drop the key in.
3. Serve the UI from a **different origin** — a local static server on another port, or a deployed static host. (Different origin is the point: it exercises the CORS + public-key path a real customer hits.)
4. Run a full turn; if you can reach the booking/tool path, confirm the **async poll** resolves `pending → ready`.
5. Confirm **`410` re-init** (let a conversation idle out, or hit an unknown `uuid`) and **`429`** backoff behave as in §5–§6.

**Step 0 (only if the site has an origin allow-list configured):** register your test origin on the site first (§7), or the request is refused with `403 "Origin not allowed."`. A site with no list configured needs no such step — it is allow-all.
