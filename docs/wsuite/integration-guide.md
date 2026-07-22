# wChatbot — External integration guide (public API)

| | |
|---|---|
| **Version** | v1 (matches `response-contract.md` 1.0.0) |
| **Audience** | Any external website embedding a **custom** chat UI on top of the wSuite chatbot API — e.g. the branded `nest-chatbot-ai` microsite. |
| **Scope** | The **transport + auth** layer: base URL, the three endpoints, the API-key model, the request/response flow, errors, rate limits, and CORS. |
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

> **Security posture (be honest with yourself).** A public key is a scope-limited *secret that is meant to be seen*, not a cryptographically distinct "publishable" key. Today CORS allows all origins (§7), so a copied public key works from any site. That is acceptable for MVP/testing; the **per-site origin allow-list is a planned hardening** before a truly public launch. Don't treat a public key as per-user or private.

---

## 3. The three endpoints and the turn flow

| Step | Method + path | Route name | Success |
|---|---|---|---|
| **Init** | `POST /api/v1/chatbot/conversations` | `chatbot.v1.conversations.store` | `201` |
| **Turn** | `POST /api/v1/chatbot/conversations/{uuid}/messages` | `chatbot.v1.conversations.messages.store` | `200` |
| **Poll** | `GET /api/v1/chatbot/conversations/{uuid}/turns/{turn}` | `chatbot.v1.conversations.turns.show` | `200` |

All three require the `Authorization` header from §2. `{uuid}` is the conversation's public identifier (sequential DB ids never leave the API).

### 3.1 Init — start a conversation

```
POST /api/v1/chatbot/conversations
Authorization: Bearer ws_live_...
Content-Type: application/json

{ "locale": "es-ES", "property": "Las Eras Nest Hostel" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `locale` | `string` (≤5) | no | The guest's language hint — send `navigator.language`. Drives the reply language. |
| `property` | `string` (≤255) | no | A **soft** property-name lookup within the key's tenant. An unknown name is not an error — it simply yields a conversation with no property pre-scoped. No DB `exists` check; the site/tenant always come from the key, never the body. |

**`201` response:**

```json
{ "conversation": { "uuid": "9b2c…" }, "greeting": "Hi! How can I help?" }
```

Persist `uuid` (the reference widget keys it to `localStorage` per API key). Render `greeting` as the first bot bubble.

### 3.2 Turn — send a guest message

```
POST /api/v1/chatbot/conversations/{uuid}/messages
Authorization: Bearer ws_live_...
Content-Type: application/json

{ "message": "do you have wifi?" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | `string` | yes | Max length = `wsuite.chatbot.message.max_length` (default **2000**). |

**`200` response** — the frozen envelope from [`response-contract.md`](response-contract.md):

```json
{ "reply": "Yes, free wifi throughout.", "actions": [ … ], "turn": 3 }
```

A turn **always returns `200`** on success — the orchestrator degrades any LLM/provider/budget failure to a localized "busy" reply at `200`, never a 5xx. Render `reply`, then render each element of `actions` **in order** (§4).

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

| Status | When | Consumer action |
|---|---|---|
| `401` | Missing/invalid/revoked key, or token not prefixed `ws_live_`. | Fatal — bad key. Stop. |
| `403` | Init: `chatbot.enabled` is off for the site. Or: key scope not admitted. | Hide the widget silently. |
| `404` | Unknown/foreign `uuid`, or a non-async/unknown turn on poll. | Treat the conversation as gone; re-init. |
| `410` | Conversation idled out (24h since last activity). | **Re-init transparently** (open a new conversation, optionally resend the last message once) — the reference widget does this automatically. |
| `422` | Init: no site resolved for the key. | Configuration error. |
| `429` | Rate limit exceeded (§6). | Back off; show a soft "one moment" message and retry. |

Note: turn/poll **content** is always `200`; the non-200s above are resolution/auth failures only.

---

## 6. Rate limits

Two independent per-minute buckets, **keyed per API key** (so all visitors of a site embedding the same public key share them):

| Bucket | Default | Route |
|---|---|---|
| `chatbot-guest` | **20 / min** | init + turn |
| `chatbot-poll` | **60 / min** | poll |

Tunable via `WSUITE_CHATBOT_THROTTLE_PER_MINUTE` / `WSUITE_CHATBOT_POLL_PER_MINUTE`. These HTTP throttles are the abuse layer; the real per-provider AI cost limiting lives inside the platform gateway and is invisible to consumers.

---

## 7. CORS / origins

Cross-origin is enabled on `api/v1/chatbot/*` only:

- **Today:** `allowed_origins: ['*']`, methods `POST, OPTIONS`, headers `Content-Type, Authorization`, `supports_credentials: false`. **A custom UI on any origin works right now** — no allow-list registration needed to develop or test.
- **Planned hardening:** a per-site origin allow-list (bind the site's domain → CORS + a server-side `Origin` check) so a leaked public key can't be used from arbitrary origins. When that lands, your production origin must be registered on the site.

---

## 8. Minimal reference flow

Illustrative only — [`../resources/widget/chatbot.js`](../resources/widget/chatbot.js) is the hardened version (410 re-init, poll backoff, XSS-safe rendering, scheme checks):

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
if (r.status === 410) { /* re-init and resend once */ }
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

No allow-list step is required today (§7). When the allow-list ships, add step 0: register the test/prod origin on the site.
