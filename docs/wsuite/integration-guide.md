# wChatbot — External integration guide (public API)

|                  |                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Version**      | matches `response-contract.md` 1.4.1 (the server reports the live version as `contract_version` — see §3.1)                                                                                                            |
| **Audience**     | Any external website embedding a **custom** chat UI on top of the wSuite chatbot API — e.g. the branded `nest-chatbot-ai` microsite.                                                                                   |
| **Scope**        | The **transport + auth** layer: base URL, the three endpoints, the API-key model, the request/response flow, errors, rate limits, and CORS.                                                                            |
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
- **Binding** — a key is bound to exactly **one tenant + one site**. All conversations it opens belong to that site. (The _property_ within the site is chosen per-conversation, see §3.)
- **Minting a key** — in the admin panel: **Tenancy → Manage API Keys → Create**, choose the site and **scope = `public`**; copy the plaintext from the one-time notification. (Dev shortcut: the owner-only **Widget Preview** Filament page mints a public key automatically when `WSUITE_CHATBOT_DEV_WIDGET_PREVIEW=true`.)

> **Security posture (be honest with yourself).** A public key is a scope-limited _secret that is meant to be seen_, not a cryptographically distinct "publishable" key. A site can now be locked to an **origin allow-list** (§7) so a copied key is refused from unlisted origins — but `Origin` is **browser-asserted**, so the allow-list narrows a leak's blast radius in real browsers; it is **not authentication**. Your real controls remain the key's `public` scope, the per-key rate limits (§6), and `chatbot.enabled`. Don't treat a public key as per-user or private. Empty allow-list = allow-all (the default), so nothing here changes until you configure it.

---

## 3. The three endpoints and the turn flow

| Step     | Method + path                                           | Route name                                | Success |
| -------- | ------------------------------------------------------- | ----------------------------------------- | ------- |
| **Init** | `POST /api/v1/chatbot/conversations`                    | `chatbot.v1.conversations.store`          | `201`   |
| **Turn** | `POST /api/v1/chatbot/conversations/{uuid}/messages`    | `chatbot.v1.conversations.messages.store` | `200`   |
| **Poll** | `GET /api/v1/chatbot/conversations/{uuid}/turns/{turn}` | `chatbot.v1.conversations.turns.show`     | `200`   |

All three require the `Authorization` header from §2. `{uuid}` is the conversation's public identifier (sequential DB ids never leave the API).

### 3.1 Init — start a conversation

```
POST /api/v1/chatbot/conversations
Authorization: Bearer ws_live_...
Content-Type: application/json

{ "locale": "es-ES", "property": "Las Eras Nest Hostel" }
```

| Field      | Type            | Required | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | --------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locale`   | `string` (≤5)   | no       | The guest's language hint — send `navigator.language`. Drives the reply language.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `property` | `string` (≤255) | no       | A **soft** property-name lookup within the key's tenant. An unknown name is not an error — it simply yields a conversation with no property pre-scoped. No DB `exists` check; the site/tenant always come from the key, never the body. A **matched** name also seeds the conversation's working memory, so answers — from turn 1 — are scoped to that property until the guest names another one; send it whenever your page is about one specific property (the bundled widget does via `data-property`). |

**`201` response:**

```json
{
  "conversation": { "uuid": "9b2c…" },
  "greeting": "Hi! How can I help?",
  "contract_version": "1.4.1"
}
```

Persist `uuid` (the reference widget keys it to `localStorage` per API key). Render `greeting` as the first bot bubble.

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

| Field     | Type          | Required | Notes                                                                        |
| --------- | ------------- | -------- | ---------------------------------------------------------------------------- |
| `message` | `string`      | yes      | Max length = `wsuite.chatbot.message.max_length` (default **2000**).         |
| `locale`  | `string` (≤5) | no       | **Since 1.3.0.** An explicit reply-language override for **this turn only**. |

#### `locale` — override vs. detection

**You usually do not need this.** The server **detects the guest's language on every turn** and replies in it, so a guest who switches from English to Spanish mid-conversation is already answered in Spanish — the init `locale` (§3.1) is only a hint for the pre-first-message greeting, not a lock.

Send a per-turn `locale` when **your UI owns the language**, i.e. you have a language switcher and the user's choice must win over what the text looks like. It is the fix for the case detection cannot get right: short or ambiguous messages (`ok`, `2`, a date, a property name) where there is nothing to detect from.

- **Stateless / per turn.** It applies to the turn you send it on. If you have a switcher, **resend it on every turn** — dropping it silently hands the next turn back to detection.
- **Format.** Send a full tag if that is what you have — only the 2-letter primary subtag is used (`es-ES` → `es`), and the field is capped at 5 characters (longer → `422`, so truncate a long tag yourself). Validation is by **shape, not by registry**: any two ASCII letters are accepted and passed straight to the model, deliberately — the reply language is not restricted to a fixed list. A value that yields no 2-letter primary subtag (`spa`, `1`, empty) is ignored and the turn falls back to detection rather than erroring. Sending a code that is not a real language (`zz`) is therefore honored, not corrected — send what your switcher actually offers.
- **Scope.** It sets the reply language: the generated prose and the server-localized element labels ("Book now"). It does not translate the guest's own message or re-translate the transcript.
- The reference widget does **not** send it — it has no switcher, and hardcoding one would override the very detection that makes mid-conversation switching work.

**`200` response** — the frozen envelope from [`response-contract.md`](response-contract.md):

```json
{ "reply": "Yes, free wifi throughout.", "actions": [ … ], "turn": 3 }
```

A turn **always returns `200`** on success — the orchestrator degrades any LLM/provider/budget failure to a localized "busy" reply at `200`, never a 5xx. Render `reply`, then render each element of `actions` **in order** (§4). A conversation may also hit a server-side **turn cap**: past it, the turn returns a canned "message limit reached" reply in the same `200 {reply, actions, turn}` shape (no special field, no handling needed — render it like any reply); the guest should start a new conversation to continue. This capped reply **may** include a `contact_channels` element (the property's call/WhatsApp/email), an existing element you already render per §4 — no special handling.

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

---

## 4. Rendering elements

The element types (`link_button`, `contact_channels`, `booking_link`, `availability`, `async_result`) and their fields are the authority of [`response-contract.md`](response-contract.md) — implement against that. Three **MUST** rules a consumer cannot skip (all demonstrated in `chatbot.js` `renderAction` / `safeHttpUrl`):

1. **Ignore unknown `type`s.** New element types ship server-side ahead of any given UI. Skip a type you don't render; never break on it.
2. **`async_result.url` must be treated as relative.** It always begins with `/`. Resolve it against `{API_BASE}` (§1) and **reject any non-relative value.** This structurally keeps the Bearer key on your own origin.
3. **Render as text, links only for `http(s)`.** Put all guest/LLM/element strings into the DOM via `textContent` / `setAttribute` / created nodes — **never `innerHTML`** (XSS). Honor element `url` fields **only** for `http`/`https` schemes; construct `tel:` / `mailto:` / `https://wa.me/<digits>` yourself from `contact_channels` values, never verbatim.

---

## 5. Errors

| Status | When                                                                                                                                                                               | Consumer action                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`  | Missing/invalid/revoked key, or token not prefixed `ws_live_`.                                                                                                                     | Fatal — bad key. Stop.                                                                                                                       |
| `403`  | Init: `chatbot.enabled` is off for the site. Or: key scope not admitted. Or: the request `Origin` is not on the site's allow-list (§7) — body `{"message":"Origin not allowed."}`. | Hide the widget silently (register your origin — §7 — if the allow-list is the cause).                                                       |
| `404`  | **Endpoint-specific — see below.** Turn: unknown/foreign `uuid`. Poll: the turn row is not visible to this request (or is not an async turn).                                      | Turn: treat the conversation as gone → **re-init** (as for `410`). Poll: treat as **transient** → keep backing off until give-up.            |
| `410`  | Conversation idled out (24h since last activity).                                                                                                                                  | **Re-init transparently** (open a new conversation, optionally resend the last message once) — the reference widget does this automatically. |
| `422`  | Init: no site resolved for the key.                                                                                                                                                | Configuration error.                                                                                                                         |
| `429`  | Rate limit exceeded (§6).                                                                                                                                                          | Back off; show a soft "one moment" message and retry.                                                                                        |

Note: turn/poll **content** is always `200`; the non-200s above are resolution/auth failures only.

### 5.1 `404` means different things on the turn and the poll endpoint

This is the one error whose handling is **not** uniform — get it wrong in either direction and you either wedge a browser or abandon a live answer.

- **Turn** (`POST …/messages`) — a `404` means the stored `uuid` no longer resolves for your key. It is **terminal for that conversation**: clear the stored uuid, re-init, and resend the message once (exactly your `410` path). If you instead show a generic error **without clearing your stored uuid**, that browser retries the same dead uuid on every message until your retention window expires — up to 24h of a permanently broken widget for that visitor.
- **Poll** (`GET …/turns/{turn}`) — treat a `404` as **transient**: keep backing off exactly as for `pending`, and stop only at your give-up deadline (~120s). You cannot tell a permanently unknown turn from a row that is simply not visible to _this_ request yet (replica lag, a request that raced the write), and the costs are asymmetric — backing off just ends at give-up, whereas re-initing throws away a conversation that is perfectly alive and abandons an answer that is still being generated.

The reference widget implements both: `sendMessage` treats `404` like `410`; `pollResult` folds `404` into its transient/back-off branch.

---

## 6. Rate limits

Two independent buckets (turns and polls never eat each other's budget). **Each enforces two limits per request** — a **per-visitor** budget and a **per-key site ceiling** — and a `429` means whichever one tripped:

| Bucket          | Per visitor (key + IP) | Per key (whole site) | Route       |
| --------------- | ---------------------- | -------------------- | ----------- |
| `chatbot-guest` | **20 / min**           | **300 / min**        | init + turn |
| `chatbot-poll`  | **60 / min**           | **900 / min**        | poll        |

Tunable per deployment via `WSUITE_CHATBOT_THROTTLE_PER_MINUTE` / `WSUITE_CHATBOT_POLL_PER_MINUTE` and `WSUITE_CHATBOT_SITE_THROTTLE_PER_MINUTE` / `WSUITE_CHATBOT_SITE_POLL_PER_MINUTE`. These HTTP throttles are the abuse layer; the real per-provider AI cost limiting lives inside the platform gateway and is invisible to consumers.

**What "per visitor" honestly means.** The embed key is public and identical for every visitor, so the per-visitor bucket is keyed on **key + client IP** — the only visitor signal available at throttle time. Consequences worth designing around:

- Visitors sharing an egress IP (corporate NAT, a hotel's own wifi, a mobile carrier CGNAT, a proxy) share **one** bucket. On a site whose guests are mostly on the property's wifi, budget for that.
- A client that rotates IPs gets a fresh bucket each time — which is exactly why the **per-key site ceiling** exists as the backstop, and why it also caps the AI spend a copied key can drive.
- **Per-site _configurable_ limits are not available**, by construction: the throttle runs before the API key is resolved, so no site is known yet. The numbers above are deployment-wide config, not per-site settings. (Per-_key_ isolation you do get — a separate key gets a separate ceiling, which is the argument for a separate staging key in §7.)

---

## 7. CORS / origins

Two independent layers apply to `api/v1/chatbot/*`:

**CORS (transport).** Static and permanent: `allowed_origins: ['*']`, methods `POST, GET, OPTIONS`, headers `Content-Type, Authorization`, `supports_credentials: false`. It stays `*` because CORS preflights are unauthenticated (no key ⇒ the platform can't know which site, so it can't pick a per-site policy). CORS is **not** the access control — the origin lockdown below is.

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
const KEY = "ws_live_xxxxxxxxxxxx.xxxxxxxx…"; // public-scoped
const H = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${KEY}`,
};

// 1. init
let r = await fetch(`${BASE}/api/v1/chatbot/conversations`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    locale: navigator.language,
    property: "Las Eras Nest Hostel",
  }),
});
const {
  conversation: { uuid },
  greeting,
} = await r.json();

// 2. turn
r = await fetch(`${BASE}/api/v1/chatbot/conversations/${uuid}/messages`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ message: "do you have wifi?" }),
});
if (r.status === 410 || r.status === 404) {
  /* conversation gone: clear uuid, re-init, resend once (§5.1) */
}
const turn = await r.json(); // { reply, actions, turn }

// 3. poll (only if an async_result element is present)
const async = turn.actions.find((a) => a.type === "async_result");
if (async && async.url.startsWith("/")) {
  const res = await fetch(BASE + async.url, { headers: H }); // resolve relative → BASE
  const final = await res.json(); // { status, reply?, actions?, turn }
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
