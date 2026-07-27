# wChatbot — Message response contract

|              |                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Version**  | 1.4.1 (see [Versioning](#versioning) · [Changelog](#changelog))                                                                                                                  |
| **Date**     | 2026-07-27                                                                                                                                                                       |
| **Status**   | Frozen envelope — the shared artifact the in-repo preview widget and the external `nest-chatbot-ai` widget build against. Governed by `docs/decisions.md` (D-020, D-029, D-036). |
| **Endpoint** | `POST /api/v1/chatbot/conversations/{uuid}/messages` (route `chatbot.v1.conversations.messages.store`)                                                                           |

This is the response shape of a single guest turn. Element **content is deterministic — code-emitted from the DB catalog, never chosen by the LLM** — so link/contact correctness is independent of the LLM provider (Mistral-switchable by construction). The conversation-start endpoint (`POST /api/v1/chatbot/conversations` → `{conversation:{uuid}, greeting, contract_version}`) is unaffected by this envelope; it additionally echoes the current `contract_version` (below) so a consumer can detect it is behind.

## Versioning

The contract is versioned **`MAJOR.MINOR.PATCH`** (semver):

- **MINOR** — an **additive** element or field (the common case). By the [extension rule](#extension-rule-the-dry-seam) + "ignore unknown types", adding an element or an optional field is **backwards-compatible**: an existing consumer keeps working untouched, so this is never a breaking change. **This also covers an additive optional _request_ field** (e.g. `locale` on the turn endpoint in 1.3.0): a consumer tracks **one** version number for the whole guest API surface, so a new opt-in request field it may want to send bumps the same number. It is likewise backwards-compatible — omitting the field keeps the previous behavior exactly.
- **MAJOR** — an **envelope** change (a rename/removal/retype of `reply` / `actions` / `turn`, or a change to how elements are discriminated). This should never happen; the envelope is frozen.
- **PATCH** — a wording/clarification fix with no wire effect.

**Breaking-change guarantee.** **MINOR and PATCH are never breaking** — a consumer that changes nothing keeps working, by the [extension rule](#extension-rule-the-dry-seam) + "ignore unknown types". **Only MAJOR can break a consumer**, and the envelope is frozen, so it should never be issued. Treat a MINOR bump as _features you may adopt_, never as a migration you must perform. Every [Changelog](#changelog) row states this per version in its **Breaking** column.

The version is emitted at runtime as `contract_version` on the **init** response (`POST /api/v1/chatbot/conversations`) and mirrored by the `Wsuite\Chatbot\Responses\ResponseContract::VERSION` constant (the single source of truth in code). A consumer records the version it was built against and **warns — never hard-fails — when the server reports a higher one** (forward-compat still holds). Every version bump gets a [Changelog](#changelog) row.

## Envelope

A turn always returns HTTP `200` (the orchestrator degrades provider/budget failures to a busy reply at `200`, never a 5xx — see `docs/runtime/chatbot.md`). Resolution failures are the only non-200s: `404` (unknown/foreign uuid), `410` (idled-out — the widget re-inits), `403` (site/key revoked), `429` (throttled).

```json
{
  "reply": "You have free wifi and a daily breakfast. Ready to book?",
  "actions": [
    {
      "type": "link_button",
      "label": "Book now",
      "url": "https://book.example/las-eras",
      "style": "primary"
    },
    {
      "type": "link_button",
      "label": "Visit our website",
      "url": "https://laseras.example"
    }
  ],
  "turn": 3
}
```

| Field     | Type     | Notes                                                                                                        |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `reply`   | `string` | The guest-facing reply text, in the guest's language.                                                        |
| `actions` | `array`  | Ordered list of typed **elements** (below). **Always an array — empty `[]`, never `null`.** Render in order. |
| `turn`    | `int`    | The 1-based turn number of this exchange.                                                                    |

Each element is an object with a discriminating **`type`** key. Optional fields are **omitted when absent** (never sent as `null`). A consumer **must ignore element types it does not recognise** (forward compatibility — see the extension rule).

## Element types

### `link_button` — a generic call-to-action link

Emitted deterministically by the information path for a resolved property (a Book button for `booking_url`, a hostel-page button for `website`, and a Get-directions button for `map_url` — D-042(c)), deduped by URL.

```json
{
  "type": "link_button",
  "label": "Book now",
  "url": "https://…",
  "style": "primary"
}
```

| Field   | Type     | Required | Notes                                                                                                                                                 |
| ------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label` | `string` | yes      | Display text. Localized server-side to the guest language.                                                                                            |
| `url`   | `string` | yes      | Authoritative catalog URL (`booking_url` / `website`). Consumers **must** render it as a safe anchor and **must** accept only `http`/`https` schemes. |
| `style` | `string` | no       | Presentation hint (`primary`). The renderer may honour or ignore it.                                                                                  |

### `contact_channels` — the property's contact channels

Emitted by a human-handoff turn (normalizes the former `handoff_ack`). Each present channel becomes a native link.

```json
{
  "type": "contact_channels",
  "phone": "+34123456789",
  "whatsapp": "+34600111222",
  "email": "hola@laseras.example"
}
```

| Field      | Type     | Required | Notes                                 |
| ---------- | -------- | -------- | ------------------------------------- |
| `phone`    | `string` | no       | Rendered as `tel:` (digits only).     |
| `whatsapp` | `string` | no       | Rendered as `https://wa.me/<digits>`. |
| `email`    | `string` | no       | Rendered as `mailto:`.                |

At least one channel is present when the element is emitted; all three are individually optional.

### `booking_link` — the booking deep-link (MVP fallback)

Emitted by a booking turn at `Ready` when no PMS availability provider is bound (D-018/D-010). Rendered like a `link_button` ("Book now").

```json
{
  "type": "booking_link",
  "url": "https://book.example/las-eras",
  "summary": {
    "property": "Las Eras Nest Hostel",
    "check_in": "2026-08-01",
    "check_out": "2026-08-05",
    "adults": 2
  }
}
```

| Field     | Type     | Required | Notes                                                                                              |
| --------- | -------- | -------- | -------------------------------------------------------------------------------------------------- |
| `url`     | `string` | yes      | The property's authoritative `booking_url`. Same `http`/`https`-only anchor rule as `link_button`. |
| `summary` | `object` | no       | The collected stay (`property`, `check_in`, `check_out`, `adults`) for optional display.           |

### `availability` — live availability

Emitted for a bound PMS `AvailabilityProvider` (`Wsuite\Contracts\Availability\AvailabilityProvider`) on a **completed async tool turn** (D-037(g)): when the gated turn's queued job runs the `CheckAvailability` pilot tool and it returns a result, the job attaches one `availability` element to the poll response's `actions[]` — built from the tool's captured typed result, never parsed from the model's reply text. **Nothing binds the provider at MVP (D-036(k))**, so it stays dormant until a PMS connector binds one; when a check fails (`TOOL_ERROR`) no element is emitted and the reply carries the booking link + channels instead. The widget renders its `url` as a booking button.

```json
{
  "type": "availability",
  "available": true,
  "options": [{ "room": "Mixed dorm", "price": "25", "currency": "EUR" }],
  "url": "https://…",
  "summary": { "…": "…" }
}
```

| Field       | Type     | Required | Notes                                                      |
| ----------- | -------- | -------- | ---------------------------------------------------------- |
| `available` | `bool`   | yes      | Present even when `false`.                                 |
| `options`   | `array`  | yes      | List of room options (may be empty).                       |
| `url`       | `string` | no       | Deep-link (falls back to `booking_url`). Same anchor rule. |
| `summary`   | `object` | no       | The collected stay.                                        |

### `async_result` — this turn's final reply is being generated asynchronously

Emitted by a **gated booking tool turn** (D-037(f)): a deterministic code gate (never the LLM's choice) hands the tools-capable respond call to a queued job, so the POST returns immediately with a localized **interim** `reply` (written to read as a complete standalone answer), the deterministic `booking_link`/`contact_channels` fallbacks, **and** this element. A consumer that does not recognise `async_result` simply ignores it and keeps the interim reply + fallbacks — fully functional, no polling. A poll-aware consumer fetches `url` until the final reply is ready.

```json
{
  "type": "async_result",
  "url": "/api/v1/chatbot/conversations/{uuid}/turns/{turn}"
}
```

| Field | Type     | Required | Notes                                                                                                                                                                                                                                                                                                                    |
| ----- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url` | `string` | yes      | The turn-result poll path, **RELATIVE to the API origin** (always begins with `/`). Consumers **must** resolve it against the same origin they POST to and **must** reject a non-relative value — this structurally keeps the Bearer key on the widget's own origin and sidesteps `APP_URL`/proxy/CDN origin mismatches. |

**Poll endpoint** — `GET /api/v1/chatbot/conversations/{uuid}/turns/{turn}` (route `chatbot.v1.conversations.turns.show`, public-key scope, its own lighter `throttle:chatbot-poll`). Same auth header as the message POST. Resolution failures mirror the message endpoint (`404` unknown/foreign uuid or non-async turn, `410` idled-out, `403` revoked, `429` throttled); content responses are always `200`:

```json
{ "status": "pending", "turn": 4 }
{ "status": "ready",   "reply": "…final reply…", "actions": [ … ], "turn": 4 }
{ "status": "failed",  "reply": "…busy-style final…", "actions": [], "turn": 4 }
```

Recommended cadence: poll ~2s → 5s backoff, give up ≈120s (survives one rate-limit `release()` cycle). On `ready`/`failed` the consumer replaces the interim bubble's text with `reply` and renders `actions`. **Accepted edge (documented):** after a client gives up, a late `ready` still lands in the transcript/memory, so the next turn's LLM may reference availability the guest never saw — low-stakes and bounded.

## Security rule (both widgets)

Guest/LLM strings and element fields are rendered via `textContent` / `setAttribute` / created DOM nodes — **never `innerHTML`** — so a hostile reply cannot inject markup (XSS). Element-supplied `url` fields (`link_button`, `booking_link`, `availability`) are honoured **only for `http`/`https`** schemes; everything else is dropped. `tel:`/`mailto:`/`wa.me` hrefs are constructed by the widget from the channel values, not taken verbatim.

## Extension rule (the DRY seam)

Adding a new rich type (`card`, `image`, `map`, `quick_reply`, …) is two code edits plus a version bump — **the envelope never changes**:

1. **Server:** one new value object under `modules/chatbot/src/Responses/Elements/` implementing `Element` (a stable `toArray()` returning `{type, …}`), emitted by the relevant handler.
2. **Widget:** one new branch in `renderAction(action)` keyed on the new `type`.
3. **Version:** bump the [version](#versioning) (**MINOR** — additive) and add a [Changelog](#changelog) row **including its Breaking and Consumer action cells**; keep `Wsuite\Chatbot\Responses\ResponseContract::VERSION`, this doc's header, the reference widget's `BUILT_AGAINST` and `integration-guide.md`'s version line in lockstep, then tag the commit `chatbot-contract-v<X.Y.Z>`. The init `contract_version` then signals consumers to adopt it, and `modules/chatbot/docs/consumer-sync.md` records which consumer is still behind. _(Skipping this is the one way an additive change goes unnoticed — guard tests assert every element's `type` appears in the Changelog and that all four version sites agree.)_

Existing consumers ignore the unknown `type` until they add the branch, so the server can ship a new element ahead of any given widget. The in-repo `WidgetPreview` Filament page + `resources/widget/chatbot.js` is the **reference renderer** for this contract; the external `nest-chatbot-ai` repo is versioned separately and consumes this document.

## Changelog

Per [Versioning](#versioning): additive element/field additions are **MINOR** and backwards-compatible by the ignore-unknown rule. Newest first.

**Breaking** answers "does this version break me?" without reading the policy above. It is `No` for every MINOR/PATCH row by the guarantee — a `Yes` can only ever appear on a MAJOR, which should never be issued.

**Consumer action** states what an existing consumer must do to adopt the row. Every row is optional by construction — "none" means a consumer that changes nothing keeps working — so this column is the adoption checklist for a re-vendored integration packet, not a migration mandate.

Each version is tagged in the platform repo as **`chatbot-contract-v<X.Y.Z>`**, so a consumer can be handed an exact packet snapshot and can diff its own version forward (`git diff chatbot-contract-v1.2.0..chatbot-contract-v1.4.0 -- modules/chatbot/docs/`).

| Version | Date       | Breaking | Change                                                                                                                                                                                                                                                                                                                        | Element / field                                     | Consumer action                                                                                                                                                                         |
| ------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1.4.1` | 2026-07-27 | No       | **Documentation only, no wire effect** (the first PATCH row — it exercises the lane): the [breaking-change guarantee](#versioning) is stated explicitly, this table gains the **Breaking** column, and each version is now tagged `chatbot-contract-v<X.Y.Z>` so a packet snapshot is reproducible.                           | _(none)_                                            | **None** — nothing on the wire changed. Re-vendor at your convenience to pick up the clearer docs.                                                                                      |
| `1.4.0` | 2026-07-27 | No       | The information path now emits a third deterministic **`link_button`** — a "Get directions" button carrying the property's authoritative `map_url` — alongside the existing Book / Website buttons (D-042(c) / KI-007). No new element type: it is a `link_button` like the others, deduped by URL.                           | `link_button`                                       | **None** — an existing `link_button` renderer already handles it (label + `url` + optional `style`); it just renders as one more call-to-action.                                        |
| `1.3.0` | 2026-07-23 | No       | Added the optional **request** field `locale` on the turn endpoint (`POST …/messages`) — an explicit per-turn reply-language override for a consumer that owns a UI language switcher. Stateless: it applies to that turn only, and omitting it keeps per-turn language detection unchanged. See `integration-guide.md` §3.2. | _(request)_ `locale`                                | **Optional** — send `locale` on every turn **only if** you have a UI language switcher. No renderer change; omit the field and nothing changes.                                         |
| `1.2.0` | 2026-07-22 | No       | Added the `availability` element (live PMS availability on a completed async tool turn; dormant until a provider binds — D-037(g)).                                                                                                                                                                                           | `availability`                                      | Add an `availability` branch to `renderAction` (render `url` as a booking button; `options`/`available` are display-only). Skippable — it is ignored until then, and dormant at MVP.    |
| `1.1.0` | 2026-07-22 | No       | Added the `async_result` element for gated async tool turns (interim reply + poll `url`; ignorable by non-poll-aware consumers — D-037(f)/(h)).                                                                                                                                                                               | `async_result`                                      | Add an `async_result` branch that polls `url` (relative — resolve against your API base) and replaces the interim bubble. Skippable — the interim reply + fallbacks stand on their own. |
| `1.0.0` | 2026-07-21 | —        | Initial frozen envelope (`reply` / `actions[]` / `turn`) + the deterministic call-to-action elements.                                                                                                                                                                                                                         | `link_button` · `contact_channels` · `booking_link` | Baseline — render `reply`, then each element of `actions[]` in order.                                                                                                                   |
