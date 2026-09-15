# wChatbot — Message response contract

| | |
|---|---|
| **Version** | 1.12.0 (see [Versioning](#versioning) · [Changelog](#changelog)) |
| **Date** | 2026-09-15 |
| **Status** | Frozen envelope — the shared artifact the in-repo preview widget and the external `nest-chatbot-ai` widget build against. Governed by `docs/decisions.md` (D-020, D-029, D-036). |
| **Endpoint** | `POST /api/v1/chatbot/conversations/{uuid}/messages` (route `chatbot.v1.conversations.messages.store`) |

This is the response shape of a single guest turn. Element **content is deterministic — code-emitted from the DB catalog or tenant-authored site settings, never chosen by the LLM** — so link/contact correctness is independent of the LLM provider (Mistral-switchable by construction). The conversation-start endpoint (`POST /api/v1/chatbot/conversations` → `{conversation:{uuid}, greeting, actions?, idle_hours?, server_time?, contract_version}`) is unaffected by this envelope; it additionally echoes the current `contract_version` (below) so a consumer can detect it is behind. **Since 1.7.0** it also reports **`idle_hours`** (the conversation idle window as a duration — stop mirroring it as a client-side constant) and **`server_time`** (ISO-8601, for a one-off client-clock offset); both are documented in [`integration-guide.md`](integration-guide.md) §3.1, and both may be absent. **Since 1.5.0** the init response also carries an optional **`actions`** array of the same element vocabulary (greeting-time quick prompts and, when configured, the promo card) — the server always emits it (`[]` when unconfigured), older servers omit it, and a consumer that never reads it loses nothing. **What can appear there:** content elements only — `promo_card` and `quick_replies` today. `async_result` and `availability` are turn-scoped by construction (both are tied to a turn number), so an init response will not carry them; keep ignoring unknown types rather than hard-coding that list.

## Versioning

The contract is versioned **`MAJOR.MINOR.PATCH`** (semver):

- **MINOR** — an **additive** element or field (the common case). By the [extension rule](#extension-rule-the-dry-seam) + "ignore unknown types", adding an element or an optional field is **backwards-compatible**: an existing consumer keeps working untouched, so this is never a breaking change. **This also covers an additive optional *request* field** (e.g. `locale` on the turn endpoint in 1.3.0): a consumer tracks **one** version number for the whole guest API surface, so a new opt-in request field it may want to send bumps the same number. It is likewise backwards-compatible — omitting the field keeps the previous behavior exactly. **It also covers a change to the *value* an existing field carries** when that value stays within the field's documented type and anchor rule — `1.9.0` (every booking `url` gaining the guest's language and stay, D-071) is the precedent: nothing is added or renamed and a consumer that renders the field as before keeps working, but the number moves so a consumer that *inspects* the value finds out. **It also covers a change to transport behaviour a consumer can act on** — `1.11.0` is the precedent: a `429` that can now last up to a day, and its `Retry-After` header made readable cross-origin so a consumer can tell that apart from a one-minute wait. No body changes, and a consumer that ignores the header keeps working.
- **MAJOR** — an **envelope** change (a rename/removal/retype of `reply` / `actions` / `turn`, or a change to how elements are discriminated). This should never happen; the envelope is frozen.
- **PATCH** — a wording/clarification fix with no wire effect.

**Breaking-change guarantee.** **MINOR and PATCH are never breaking** — a consumer that changes nothing keeps working, by the [extension rule](#extension-rule-the-dry-seam) + "ignore unknown types". **Only MAJOR can break a consumer**, and the envelope is frozen, so it should never be issued. Treat a MINOR bump as *features you may adopt*, never as a migration you must perform. Every [Changelog](#changelog) row states this per version in its **Breaking** column.

The version is emitted at runtime as `contract_version` on the **init** response (`POST /api/v1/chatbot/conversations`) and mirrored by the `Wsuite\Chatbot\Responses\ResponseContract::VERSION` constant (the single source of truth in code). A consumer records the version it was built against and **warns — never hard-fails — when the server reports a higher one** (forward-compat still holds). Every version bump gets a [Changelog](#changelog) row.

## Envelope

A turn always returns HTTP `200` (the orchestrator degrades provider/budget failures to a busy reply at `200`, never a 5xx — see `docs/runtime/chatbot.md`). Resolution failures are the only non-200s: `404` (unknown/foreign uuid), `410` (idled-out — the widget re-inits), `403` (site/key revoked), `429` (throttled). A `429` carries `Retry-After`, the seconds until the limit that refused it reopens — about a minute for a per-minute limit, up to 24 hours for a daily cap — readable cross-origin since `1.11.0` (see `integration-guide.md` §6).

```json
{
  "reply": "You have free wifi and a daily breakfast. Ready to book?",
  "actions": [
    { "type": "link_button", "label": "Book now", "url": "https://book.example/las-eras", "style": "primary" },
    { "type": "link_button", "label": "Visit our website", "url": "https://laseras.example" }
  ],
  "turn": 3
}
```

| Field | Type | Notes |
|---|---|---|
| `reply` | `string` | The guest-facing reply text, in the guest's language. **No server-side maximum length** (it is model prose, bounded only by the provider) and it **may contain `\n`** — render with `white-space: pre-wrap`, never collapse it. |
| `actions` | `array` | Ordered list of typed **elements** (below). **Always an array — empty `[]`, never `null`.** Render in order. |
| `turn` | `int` | The 1-based turn number of this exchange. *(One exception: the turn-cap reply repeats the last completed exchange's number — see [`conversation_ended`](#conversation_ended--this-conversation-accepts-no-further-turns).)* |

These three keys are the **whole** top-level surface and always will be — additive growth happens
inside `actions[]` via the [extension rule](#extension-rule-the-dry-seam), never here.

Each element is an object with a discriminating **`type`** key. Optional fields are **omitted when absent** (never sent as `null`). A consumer **must ignore element types it does not recognise** (forward compatibility — see the extension rule).

### Element conventions (all types)

**`id` — optional element identity (since 1.6.0).** Any element may carry an `id`: a short opaque
string naming *what this element is*, never displayed. It is **stable across turns and
conversations**, so a consumer can recognise that the block it is about to render is one it has
rendered before — which is what any client-side frequency capping needs. It is **not** a nonce and
**not** unique per occurrence. Today the server emits `id` on [`promo_card`](#promo_card--a-tenant-authored-promotional-block)
(content-derived, so it changes when the tenant rewrites the offer — that is what makes capping on
it safe) and on [`quick_replies`](#quick_replies--tap-to-send-question-chips) (naming the row's
provenance). Absence is normal; never key required behaviour on it.

**Missing required fields — fail closed.** `Required: yes` is a **server guarantee**, not a hint:
every element is assembled from validated inputs and is **dropped whole** when a required part is
missing or fails validation (a `promo_card` whose `cta.url` is not `http(s)` is not emitted at all;
a property with no `booking_url` yields no card). So a consumer that nevertheless receives an
element missing a required field is looking at a bug or a tampered payload: **drop the whole
element** rather than rendering a degraded form. For an element carrying `items[]` the rule applies
**per item** — drop the offending item and keep the element if any item survives. Optional fields
are the opposite: absence is normal and **must** be tolerated. One element is stated as an
at-least-one-of instead of by required fields — [`contact_channels`](#contact_channels--the-propertys-contact-channels),
whose three channels are individually optional but never all absent; treat a `contact_channels`
with no channel at all as an element to drop.

**Where elements render.** After the `reply` bubble (or, on init, after the `greeting`), as
**siblings of it in `actions[]` order** — never nested inside the bubble. `property_cards` and
`promo_card` are blocks rather than messages, so giving them the panel's full width is expected;
`quick_replies` belongs immediately below the reply it accompanies. Nothing here is normative: the
contract fixes the order and the grouping, not your layout.

## Element types

### `link_button` — a generic call-to-action link
Emitted deterministically by the information path for a resolved property (a Book button for the property's booking URL — since 1.9.0 with the stay the server knows composed onto it, D-071 — a hostel-page button for `website`, and a Get-directions button for `map_url` — D-042(c)), deduped by catalog URL.

```json
{ "type": "link_button", "label": "Book now", "url": "https://…", "style": "primary" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `label` | `string` | yes | Display text. Localized server-side to the guest language. |
| `url` | `string` | yes | Authoritative catalog URL (`website` / `map_url`), or — for the Book button — the property's booking URL with the collected stay composed onto it (**since 1.9.0**, D-071: the guest's language segment, `checkin`/`checkout` when known, `adults` when the guest stated it; a non-CloudBeds catalog URL is unchanged). Consumers **must** render it as a safe anchor, **must** accept only `http`/`https` schemes, and **must not** parse, normalise or strip it. |
| `style` | `string` | no | Presentation hint (`primary`). The renderer may honour or ignore it. |

### `contact_channels` — the property's contact channels
Emitted by a human-handoff turn whose property is known (normalizes the former `handoff_ack`). Each present channel becomes a native link. **Since 1.12.0** (D-079) a handoff turn that has not yet identified the property emits **no** `contact_channels` — its `reply` says staff were notified and asks which property the request is about, over a [`property_choice`](#quick_replies--tap-to-send-question-chips) chip row; the next turn that names one carries that property's channels. Never assume a handoff turn carries this element.

```json
{ "type": "contact_channels", "phone": "+34123456789", "whatsapp": "+34600111222", "email": "hola@laseras.example" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `phone` | `string` | no | Rendered as `tel:` (digits only). |
| `whatsapp` | `string` | no | Rendered as `https://wa.me/<digits>`. |
| `email` | `string` | no | Rendered as `mailto:`. |

At least one channel is present when the element is emitted; all three are individually optional.

### `booking_link` — the booking deep-link (MVP fallback)
Emitted by a booking turn at `Ready` when no PMS availability provider is bound (D-018/D-010). Rendered like a `link_button` ("Book now").

```json
{ "type": "booking_link", "url": "https://book.example/las-eras", "summary": { "property": "Las Eras Nest Hostel", "check_in": "2026-08-01", "check_out": "2026-08-05", "adults": 2 } }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | `string` | yes | The property's booking URL with the collected stay composed onto it (**since 1.9.0**, D-071): the guest's language segment, `checkin`/`checkout`, and `adults` when the guest stated it — an assumed party size is never sent. A non-CloudBeds catalog URL is the stored value unchanged. Same `http`/`https`-only anchor rule as `link_button`; never parse, normalise or strip it. |
| `summary` | `object` | no | The collected stay (`property`, `check_in`, `check_out`, `adults`) for optional display. |

### `availability` — live availability
Emitted from the bound PMS `AvailabilityProvider` (`Wsuite\Contracts\Availability\AvailabilityProvider`) on two paths. **Since 1.7.1, on the deterministic Ready turn** of the booking flow (D-062, Phase 1b): once the D-018 fields are collected the handler queries the provider synchronously and, when it answers, attaches one `availability` element instead of the `booking_link` fallback — `options[].room` is the vendor's room-type name (plus the plan name for a named plan), `price` the stay total for **one** unit — one bed or one room — and, **since 1.8.0**, an option may also carry `basis`, `units` and `total`: what the whole party pays (the `options[]` table below, D-067). **On a completed async tool turn** (D-037(g)): when the gated turn's queued job runs the `CheckAvailability` pilot tool and it returns a result, the job attaches one `availability` element to the poll response's `actions[]` — built from the tool's captured typed result, never parsed from the model's reply text. On either path a provider that cannot answer (no snapshot, a stale one, a failure — `unknown`) emits **no** element and the reply carries the booking link + channels instead; `wsuite/pms` binds the provider process-wide, answering from a snapshot of the PMS rates refreshed every 15 minutes. The widget renders its `url` as a booking button.

```json
{ "type": "availability", "available": true, "options": [ { "room": "Mixed dorm", "price": "100.00", "currency": "EUR", "basis": "per_person", "units": 2, "total": "200.00" } ], "url": "https://…", "summary": { "…": "…" } }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `available` | `bool` | yes | Present even when `false`. |
| `options` | `array` | yes | List of room options (may be empty). Items below. |
| `url` | `string` | no | The booking deep-link — the provider's URL, or the property's booking URL, with the collected stay composed onto it exactly as `booking_link.url` (**since 1.9.0**, D-071). On the async path it is byte-identical to the interim `booking_link.url` for the same stay — the string a consumer dedupes on. Same anchor rule. |
| `summary` | `object` | no | The collected stay. |

`options[]` items:

| Field | Type | Required | Notes |
|---|---|---|---|
| `room` | `string` | yes | The vendor's room-type name, plus the plan name for a named plan ("Mixed Dorm (Nest Pass - Weekly)"). Display-only. |
| `price` | `string` \| `null` | yes | The stay total for **one** unit — one bed or one room — two decimals, `.` decimal mark; `null` when a night has no rate. Never a per-night figure. |
| `currency` | `string` \| `null` | yes | ISO 4217 (`EUR`). |
| `basis` | `string` | no | **Since 1.8.0.** What one unit is: `per_person` (a bed in a shared room) \| `per_unit` (a whole room) — D-044's vocabulary, applied per option. |
| `units` | `int` | no | **Since 1.8.0.** How many units the party needs — beds for `per_person`, rooms for `per_unit`. |
| `total` | `string` \| `null` | no | **Since 1.8.0.** `price × units`, same currency — the price the party pays for the stay; `null` exactly when `price` is. |

`basis`, `units` and `total` come **together or not at all**, and are absent when the PMS snapshot does not know how the room type is sold. A consumer renders `total` when present and **never derives one from `price`** — a bed price times a guessed party size is a wrong quote on a link that will not honour it. Absent means: show `price` exactly as before 1.8.0.

**The reply prose defers to this list (since 1.9.1 — D-072).** When every option carries `total`, the reply no longer enumerates the options: it names at most the cheapest bed and the cheapest whole room by `total` and points the guest to the list for the rest. That makes `options[]` the guest's only complete view of what is offered, so a renderer **must draw it** — one row per option: `room` always, `total` (with `units`/`basis`) when present, `price` otherwise. When any option lacks `total` the prose lists the rows itself, exactly as before 1.9.1 — the case the reference widget draws nothing for. `options`/`available` remain display-only in the 1.2.0 sense (never a booking action); that was never the same as optional to render.

### `async_result` — this turn's final reply is being generated asynchronously
Emitted by a **gated booking tool turn** (D-037(f)): a deterministic code gate (never the LLM's choice) hands the tools-capable respond call to a queued job, so the POST returns immediately with a localized **interim** `reply` (written to read as a complete standalone answer), the deterministic `booking_link`/`contact_channels` fallbacks, **and** this element. A consumer that does not recognise `async_result` simply ignores it and keeps the interim reply + fallbacks — fully functional, no polling. A poll-aware consumer fetches `url` until the final reply is ready.

```json
{ "type": "async_result", "url": "/api/v1/chatbot/conversations/{uuid}/turns/{turn}" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | `string` | yes | The turn-result poll path, **RELATIVE to the API origin** (always begins with `/`). Consumers **must** resolve it against the same origin they POST to and **must** reject a non-relative value — this structurally keeps the Bearer key on the widget's own origin and sidesteps `APP_URL`/proxy/CDN origin mismatches. |

**Poll endpoint** — `GET /api/v1/chatbot/conversations/{uuid}/turns/{turn}` (route `chatbot.v1.conversations.turns.show`, public-key scope, its own lighter `throttle:chatbot-poll`). Same auth header as the message POST. Content responses are always `200`:

```json
{ "status": "pending", "turn": 4 }
{ "status": "ready",   "reply": "…final reply…", "actions": [ … ], "turn": 4 }
{ "status": "failed",  "reply": "…busy-style final…", "actions": [], "turn": 4 }
```

Recommended cadence: poll ~2s → 5s backoff, give up ≈120s (survives one rate-limit `release()` cycle). On `ready`/`failed` the consumer replaces the interim bubble's text with `reply` and renders `actions`. **Accepted edge (documented):** after a client gives up, a late `ready` still lands in the transcript/memory, so the next turn's LLM may reference availability the guest never saw — low-stakes and bounded.

**Poll resolution failures are NOT uniform with the message endpoint** — `403` (revoked) and `429`
(throttled) behave identically, but the two that end a conversation do not:

- **`404` is transient here**, terminal on the message endpoint. Keep backing off exactly as for
  `pending` and stop only at your give-up deadline: you cannot distinguish a permanently unknown
  turn from a row not yet visible to *this* request (replica lag, a request that raced the write),
  and re-initing throws away a live conversation plus an answer still being generated.
- **`410` stops the poll and nothing more.** Keep the interim reply and its fallbacks — they are a
  complete answer — and **do not re-init from a poll**: the conversation that owns this turn is gone,
  so its result is no longer worth fetching, and the guest's *next* message gets its own `410` on
  the message endpoint and re-inits there. Re-initing from the poll would open a conversation the
  guest has not spoken in yet.

See `integration-guide.md` §5.1, which states the message-endpoint side of both.

**The poll's `actions[]` is additive to what the turn already rendered**, not a replacement: the
interim POST's own elements (the deterministic `booking_link` + `contact_channels` fallbacks) stay
on screen, and only the bubble *text* is replaced. So a consumer **SHOULD** suppress a final element
whose `url` it already rendered for that turn. Today exactly one case can arise: an
[`availability`](#availability--live-availability) whose `url` is composed from the same stay as
the interim `booking_link` (byte-identical since 1.9.0 — D-071) duplicates it. Live since 1.7.1 — `wsuite/pms` binds the
provider (D-062); the Ready-turn emission is synchronous and never reaches a poll, so only the
async tool path can produce this pair.

### `property_cards` — a carousel of catalog property cards
Emitted deterministically by the information path (D-043(a)) and, **since 1.10.0, by the booking path when the site switches it on** (rule 5 below — D-073). Every item field comes straight from the tenant's `properties` catalog row (D-020, never RAG, never LLM-composed); a property without a `booking_url` yields no card (the CTA is mandatory).

**When it is emitted (revised in 1.6.2 — D-047).** A card asserts *this turn is about this hostel*, so the turn must carry a this-turn signal for it. In precedence order:

1. **By island/area** — the guest asked by area and the island validates against the catalog: one card per matching active property.
2. **Several hostels named** — the guest's own message names more than one catalog property: one card each, in the order the server ranked them. **This is new in 1.6.2**: before, such a turn collapsed to a single arbitrary card.
3. **One hostel named or referred to** — including a widget conversation seeded with `data-property`, which cards its hostel **once** per conversation: the single card, exactly as before.
4. **Otherwise, no card.** In particular, a property the server merely *remembers* from an earlier turn no longer produces one. Before 1.6.2 it did, so a guest who mentioned one hostel on turn 4 kept seeing its card under unrelated answers for the rest of the conversation.
5. **On a booking turn, when the site switches it on (since 1.10.0 — D-073).** The Ready turn of the booking flow — the one carrying [`availability`](#availability--live-availability) or [`booking_link`](#booking_link--the-booking-deep-link-mvp-fallback) — also carries the resolved property's single card, **first** in `actions[]`, when the tenant has enabled it for the site (off by default). `items[0].url` is **byte-identical** to the `availability.url` / `booking_link.url` beside it — both are composed from the same stay (D-071) — so the [dedupe rule](#compatibility-and-the-book-button-dedupe-d-043c) collapses the two Book affordances into one. The single-card richness gate of rule 3 applies. Before 1.10.0 no booking turn carried a card at all; D-069 had moved every "is it free / price for these dates" question onto that turn, which is where the hostel's image, location and from-price had gone missing.

A renderer needs no change for any of this — it is strictly *when* the element appears, never its shape. Rule 5 asks one thing of a dedupe that only ever compared `link_button` urls: compare `availability.url` and `booking_link.url` the same way.

```json
{ "type": "property_cards", "items": [ { "key": "duque", "name": "Duque Nest", "location": "Costa Adeje, Tenerife", "image": "https://…/duque.jpg", "price_from": { "amount": "25.00", "currency": "EUR", "period": "night", "basis": "per_person" }, "badge": "Nest Pass", "cta_label": "Book now", "url": "https://book.example/duque" } ], "total": 14, "more": { "label": "See all our properties", "url": "https://…/hostels" } }
```

| Element field | Type | Required | Notes |
|---|---|---|---|
| `items` | `array` | yes | The cards, in order (below). Never empty — the element is not emitted with no items. |
| `total` | `int` | no | **Since 1.6.0.** Matching active properties **before** the server's cap, so a renderer bounding its own carousel can say "showing 8 of 14" instead of silently losing the rest. Equals `items.length` when nothing was cut. |
| `more` | `object` | no | **Since 1.6.0.** `{label, url}` — an optional "see all" affordance for the tenant's full property listing. `label` is **localized server-side**; `url` is under the same `http`/`https`-only rule as every element URL. Present only when the tenant has configured a listing URL; a renderer that ignores it is unchanged. |
| `id` | `string` | no | Per the [element conventions](#element-conventions-all-types). Not emitted for this type — items already carry `key`. |

| Item field | Type | Required | Localized | Notes |
|---|---|---|---|---|
| `key` | `string` | yes | no | The property's stable catalog slug — see [using `key`](#using-key) below. |
| `name` | `string` | yes | **no** | Display name, the raw catalog value in the tenant's authoring language. |
| `location` | `string` | no | **no** | Display label, **composed server-side** as `City, Island` from the catalog locality columns. Not localized and not reordered per locale. Single-line. |
| `image` | `string` | no | n/a | Card image URL — see [card images](#card-images) below. Same `http`/`https`-only rule as every element URL. |
| `image_alt` | `string` | no | yes | **Since 1.6.0. Reserved — not emitted at 1.6.0** (the catalog carries no alt column). See [card images](#card-images) for what to do in its absence, which is the normal case. |
| `price_from` | `object` | no | n/a | An admin-maintained static from-price (D-043(d)) — see the sub-table and [reading `price_from`](#reading-price_from) below. |
| `badge` | `string` | no | **no** | Short pill label (e.g. tenant #2's "Nest Pass"), the raw catalog value in the tenant's authoring language. Single-line; keep authoring to ~20 characters, and clamp rather than wrap (see [text lengths](#text-lengths)). |
| `cta_label` | `string` | no | **yes** | **Since 1.6.0.** Display text for the card's Book CTA, localized server-side to the guest language — the same string the deterministic Book `link_button` carries. A consumer that does not find it keeps its own default, so this is purely an upgrade from hardcoding one. |
| `url` | `string` | yes | n/a | The card's Book CTA target — the property's booking URL with the stay this turn knows composed onto it, the same string as the Book `link_button` beside it (**since 1.9.0**, D-071). Same anchor rule as `link_button`. |

**`price_from`:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `amount` | `string` | yes | A decimal **string**, never a number — the renderer formats it. |
| `currency` | `string` | yes | ISO 4217 alpha-3, uppercase. **Always present when `price_from` is present.** |
| `period` | `string` | no | **Since 1.6.0.** What the amount buys: `night` \| `stay`. |
| `basis` | `string` | no | **Since 1.6.0.** Who it is priced for: `per_person` \| `per_unit` (the bookable unit — a private room, an apartment, a whole dorm). |

#### Reading `price_from`

- **`amount` is exact and locale-independent.** Always **exactly two decimal places**, always `.` as
  the decimal mark whatever the tenant's or guest's locale, **no** thousands separators, **no**
  currency symbol, maximum `999999.99`. It is a fixed-precision database value serialized verbatim,
  never formatted server-side, so `parseFloat` is safe on it.
- **`period` and `basis` are orthogonal**, and "per person per night" is `period: "night"` +
  `basis: "per_person"`. Map them to a **localized suffix of your own** — the server deliberately
  sends neither pre-localized display text nor a composed string, because you are already formatting
  the number with `Intl.NumberFormat` in the guest's locale and need to compose the whole label.
- **They are PER ITEM, and two cards in one carousel may differ.** They describe the *cheapest
  bookable thing* — which is what a from-price is — not the property as a whole: a hostel selling
  dorm beds and private doubles quotes `per_person` because its from-price is a bed, while a property
  whose cheapest offering is a double room priced for the room quotes `per_unit`. Both can appear
  side by side in the same element, so **resolve the suffix per card** and never lift one item's
  values to the whole rail.
- **Both are optional and are omitted unless the tenant has declared them.** There is deliberately no
  default: asserting `per_person` for a tenant renting whole apartments would be worse than saying
  nothing. **When they are absent, do not infer a period** — render the bare price. A from-price with
  an invented "/night" is a guest-facing pricing error.
- **"From" is not computed over any window.** It is not a 30-day minimum, not an all-time floor, and
  never a live PMS query — it is a static admin-maintained catalog column (D-043(d)), refreshed by the
  tenant, with staleness accepted by design.
- **No tax or fee guarantee.** The contract makes none: the figure is whatever the tenant entered, so
  its tax and fee treatment follows the tenant's own booking engine. Present it as an **indicative
  from-price** and never as a quote, a total, or a stay price.

#### Card images

- **No aspect ratio, dimensions, or cropping are guaranteed.** The URL is the tenant's own absolute
  image URL, served verbatim — the platform does not crop, resize, re-encode, or proxy it, so its
  cacheability is whatever the tenant's host sends. Design for a fixed-height cover crop
  (`object-fit: cover`) rather than relying on intrinsic proportions.
- **There is no placeholder.** A property with no image simply **omits** `image`.
- **Absent `image_alt`, the image is decorative** — the card's `name` already carries its meaning, so
  set `alt=""`. Reusing `name` as the alt text makes a screen reader announce the same words twice.
  When `image_alt` is present (reserved for a catalog image that carries meaning the title does not),
  use it verbatim.

#### Using `key`

`key` is the property's catalog slug: stable across turns, across conversations, and across locales.
Use it as your render key, to recognise a card you have already shown the guest this session, for
analytics, and to deep-link within your **own** site. Do not display it, and do not treat it as
permanent — it is an editable admin field, so a rename changes it. Never use it to construct a
booking URL; `url` is the only authoritative target.

#### How many, and in what order

- **At most `wsuite.chatbot.cards.max_items` items (default 8)** for an island carousel; the
  single-property card is always exactly one. That cap is a **deployment setting**, so do not
  hardcode a maximum — render what you receive, apply your own cap if your layout needs one, and use
  `total` to tell the guest something was cut.
- **Order is meaningful — render as given and never re-sort.** It is the server's catalog order
  (currently ascending by property name), **not** a ranking: it does not express relevance, price, or
  quality, so never label it "best match" or "recommended".

#### Compatibility and the Book-button dedupe (D-043(c))

The information path keeps emitting its deterministic `link_button` set unchanged, so a renderer that
ignores this element loses nothing. A card-aware renderer **SHOULD** suppress a `link_button` whose
`url` exactly equals a rendered card item's `url` in the same `actions[]` list — rendering both is
redundant, never harmful. Three things that sentence needs to be safe:

- **Compare raw strings, and do not normalize.** Where a card and a Book button co-occur — the
  resolved-property information turn, the **only** path that emits both — both `url`s are composed
  by the same server function from the same catalog row and the same collected stay in the same
  request (D-071), so they are byte-identical and plain equality is exact. Normalizing (trailing
  slashes, the stay's query parameters) only risks suppressing a button that was not a duplicate.
- **A card you dropped suppresses nothing.** Build the comparison set from the items you will
  *actually render*, after your own gates. Recording the `url` of an item you rejected — because its
  scheme failed, or it had no `name` — would silently remove the guest's only Book button.
- **`availability` and `booking_link` are in scope since 1.10.0 — for their Book button only.** Before
  1.10.0 neither could share an `actions[]` list with `property_cards` (one handler runs per turn,
  D-009, and the booking handler emitted no card); a site that switches the booking-turn card on
  (rule 5 under [`property_cards`](#property_cards--a-carousel-of-catalog-property-cards)) now emits
  the pair, card first, with the card CTA and the booking element's `url` byte-identical. Apply the
  same rule: suppress the `availability` / `booking_link` Book button whose `url` equals a rendered
  card's, and **never suppress `options[]`** — the rows are new content and the reply prose points at
  them (1.9.1). The other duplicate, across the interim→poll boundary, is unchanged and covered under
  [the poll endpoint](#async_result--this-turns-final-reply-is-being-generated-asynchronously).

### `promo_card` — a tenant-authored promotional block
Emitted deterministically when configured on the site (`chatbot.promo` setting — D-043(e)) by two **independent** gates: on the init response when `show_at_init` is set, and once per conversation on a booking turn whose collected stay reaches `min_nights` — see [when it repeats](#when-it-repeats). Content is tenant-authored and validated server-side — never LLM text. **Since 1.6.0 it is resolved per guest locale** where the tenant has supplied translations (D-044 amends D-043(e)'s single-language rule).

```json
{ "type": "promo_card", "id": "promo:6f3a1c2b", "title": "One booking. All Hostels.", "body": "7 nights for €140 at any Nest hostel…", "image": "https://…/nest-pass.jpg", "cta": { "label": "Get Your Nest Pass", "url": "https://nestshostels.com/en/nest-pass/" }, "style": "highlight", "locale": "en" }
```

| Field | Type | Required | Localized | Notes |
|---|---|---|---|---|
| `id` | `string` | no | n/a | **Since 1.6.0.** Content-derived, so it is stable while the offer is and **changes when the tenant rewrites it** — which is exactly what makes client-side frequency capping on it safe. See the [element conventions](#element-conventions-all-types). |
| `title` | `string` | yes | see below | Headline. Treat as single-line. |
| `body` | `string` | yes | see below | Supporting text. **May contain `\n`** — render with `white-space: pre-wrap` so a tenant's two-line offer stays two lines. |
| `image` | `string` | no | n/a | Banner image URL. Same `http`/`https`-only rule. Decorative — the `title` carries the meaning, so set `alt=""`. |
| `cta` | `object` | yes | `label` see below | `{label, url}` — the call-to-action anchor. Same anchor rule as `link_button`. |
| `style` | `string` | no | n/a | Presentation hint — see [`style`](#the-style-hint) below. |
| `locale` | `string` | no | n/a | **Since 1.6.0.** The language of this block's displayed text, as a 2-letter primary subtag (`en`, never `en-GB`). **Absent means unknown** — the tenant has declared no language for the content — so do not guess one. Its main use is marking the block up (`lang="es"`) so a screen reader pronounces it correctly, and deciding whether to show it at all. |

#### Language

Promo content is **tenant-authored**, so its language is the tenant's, not automatically the guest's.
Since 1.6.0 a tenant may supply per-locale copy, and the server then resolves it against the same
`locale` the turn already carries. Two things a consumer should know about that resolution:

- **It is all-or-nothing per locale.** A translation is used only when it supplies the whole displayed
  set (`title`, `body`, `cta.label`); an incomplete one falls back to the base copy **entirely**,
  because a Spanish headline over an English body reads as broken rather than as a fallback. The
  optional `cta.url` and `image` do fall back individually, so a tenant with one landing page for
  every language need not repeat it.
- **`locale` always tells you what you actually got** — the translation's language when one was used,
  the tenant's declared base language otherwise, and nothing at all when the tenant declared none.
  Never assume it matches the `locale` you sent.

#### The `style` hint

A free-form lowercase-and-hyphen presentation hint (the server enforces that shape, so it is always
safe to *test*, and never safe to inject raw). **`highlight` is the only value the platform
documents**, and it means "this is the tenant's primary offer — give it more visual weight than an
ordinary message"; how is entirely yours. Because the value is tenant-supplied, a renderer that maps
it to a CSS class **must** match against its own known list and **must** degrade an unrecognised
value to its default styling rather than emitting an unknown class.

#### Text lengths

The server trims and requires non-empty, and otherwise **enforces no maximum** on any
tenant-authored string. So a renderer **must** tolerate arbitrary length — clamp, ellipsize, or
scroll, but never break the layout. These are the **advisory authoring bounds** a tenant should aim
for in a ~420px panel, not guarantees you may rely on:

| Field | Aim for | Also |
|---|---|---|
| `promo_card.title` | ≤ 60 chars | single-line |
| `promo_card.body` | ≤ 300 chars | `\n` allowed |
| `promo_card.cta.label` | ≤ 24 chars | single-line |
| `property_cards` item `badge` | ≤ 20 chars | single-line |
| `quick_replies` item `label` | ≤ 28 chars | single-line |
| `quick_replies` `heading` | ≤ 60 chars | single-line |

#### When it repeats

- **The two triggers are independent.** `show_at_init` places the promo at greeting time;
  `min_nights` fires it on a qualifying booking turn. Only the booking-turn gate is
  once-per-conversation, so **a site with both configured can show the promo twice** in one
  conversation — once at the greeting and once when the stay qualifies. That is the current behaviour,
  not an accident of wording; a tenant who wants only one placement configures only one.
- **A re-init resets it.** A transparent `410`/`404` re-init starts a *new* conversation for the same
  visitor, so the once-per-conversation gate starts over and the promo can appear again.
- **The server governs per conversation, never per visitor.** There is no visitor identity to govern
  by — the embed key is shared by every visitor of a site (`integration-guide.md` §6) — so a returning
  guest sees the promo again.
- **Dismissal is not modelled.** There is no `dismissible` flag and the server neither expects nor
  records a dismissal. A consumer **may** let the guest dismiss the card and **may** remember that
  itself, keyed on `id`; nothing about that is visible to the server.

### `quick_replies` — tap-to-send question chips
Emitted on the init response from the site's `chatbot.quick_prompts` setting (the "try asking" chips) and by deterministic clarification turns (island choice — D-043(f); **since 1.12.0** property choice on a human-handoff turn that has not yet identified the property — D-079). Tapping a chip sends its `message` as an **ordinary guest turn** through the normal message endpoint — nothing new to implement. **Items never carry URLs** (contract rule): chips are buttons that send text, never anchors, so the URL security surface is unchanged.

```json
{ "type": "quick_replies", "id": "quick_prompts", "heading": "Which island are you going to?", "items": [ { "label": "Nest Pass", "message": "What is the Nest Pass?" } ], "locale": "en" }
```

| Element field | Type | Required | Notes |
|---|---|---|---|
| `items` | `array` | yes | The chips, in order (below). Never empty — the element is not emitted with no chips. |
| `id` | `string` | no | **Since 1.6.0.** The row's provenance, and the whole vocabulary is `quick_prompts` (the tenant-authored init row) \| `island_choice` (the deterministic island clarification row) \| `property_choice` (**since 1.12.0** — the deterministic "which property is this about?" row of a handoff turn). This is how you tell tenant text from server text — see [language](#language-1) below. |
| `heading` | `string` | no | **Since 1.7.0.** A short line saying **what the row is asking**, rendered above the chips. Tenant-authored and server-localized like every other payload string — put it in the DOM via `textContent`. Absent is normal and means render no heading; it is **never** a cue to substitute your own label (see below). |
| `locale` | `string` | no | **Since 1.6.0.** The language of the chip **labels**, as a 2-letter primary subtag. Absent means unknown or language-neutral; see [language](#language-1). |

#### `heading` — why it exists, and where it matters

On a **turn**, the `reply` string already introduces the row for free, so a heading is rarely needed
there. At **init** there is nowhere else for that line to go: the envelope carries only `greeting` and
`actions[]`, there is no text element type, and the greeting is already spent introducing the
assistant — so a site's island chips arrived as bare chips under a greeting that never mentioned them.

Two rules for a consumer:

- **Do not invent one.** A widget that substitutes its own label ("Try asking…") over a server row
  will assert something false — "Tenerife" is the *answer to a question*, not a thing to try asking.
  No heading means no heading.
- **Retire it with the row.** The heading belongs to its chips: whatever the [one-shot
  rule](#the-one-shot-rule) does to a row must take its heading too. Rendering it as a detached
  sibling above the row is the easy way to get this wrong — it outlives the chips and strands a
  question over a transcript that has moved on. The reference widget renders it *inside* the row
  element for exactly this reason.

Accessibility: when a row has a heading, that string is the row's accessible name — the reference
widget sets it as the group's `aria-label` and marks the visible copy `aria-hidden` so it is not
announced twice.

| Item field | Type | Required | Localized | Notes |
|---|---|---|---|---|
| `label` | `string` | yes | see below | The chip's display text. Treat as single-line; aim for ≤ 28 characters (advisory — see [text lengths](#text-lengths)). |
| `message` | `string` | yes | see below | The guest message to send when tapped. Render the sent text as a normal guest bubble (honest transcript). **Hard limit: it goes through the message endpoint, so a `message` longer than `wsuite.chatbot.message.max_length` (default 2000) is rejected `422` when the chip is tapped.** |

#### Language

Chip rows come from two sources and `id` tells them apart:

- **`quick_prompts`** — tenant-authored, so its language is the tenant's. Since 1.6.0 a tenant may
  supply per-locale chips, resolved against the turn's `locale` exactly as for `promo_card`; `locale`
  then reports the language actually served, or nothing when the tenant declared none.
- **`island_choice`** — server-generated. Its `message` **is** localized to the guest, but its
  `label` is a catalog island name — a proper noun — so the row **omits `locale`** rather than
  claiming a language for text that has none.
- **`property_choice`** *(since 1.12.0)* — server-generated, on the same terms as `island_choice`:
  each `label` is a catalog property name, each `message` is a localized sentence carrying that
  name verbatim ("It's about Cisne by Nest"), and the row **omits `locale`**. Send the `message`
  exactly as given — the server recognises the answer by the property name inside it.

#### How many, and in what order

- **`quick_prompts` carries at most 6 chips** (server-enforced; a chip row is a hint, not a menu).
- **`island_choice` is not capped** — it emits one chip per distinct island in the tenant's catalog
  (at least two, or the row is not emitted at all). A consumer **must** wrap or scroll the row rather
  than assume it fits one line.
- **`property_choice` is not capped either** — one chip per bookable property, or per property on
  the island the guest named when that island offers at least two (at least two, or the row is not
  emitted). A multi-property tenant's row is long (13 chips for the first live tenant), so the same
  wrap-or-scroll rule applies.
- **Order is meaningful — render as given.** Tenant chips are in authoring order; island and
  property chips are alphabetical.

#### The one-shot rule

A chip row belongs to the turn it arrived on and is stale the moment the conversation moves on. So a
row **SHOULD** stop being tappable after either trigger:

- a chip is tapped — **in any row**, not only this one; or
- the guest **sends a typed message** instead.

Both triggers retire **every chip row currently on screen**. Removing the row is what the reference
widget does and is recommended; disabling it in place is equally conformant — what matters is that it
cannot be tapped again. Supersession therefore needs no rule of its own: any send retires the old
rows, so a later `quick_replies` is always the only live one.

A consumer **may** restore a row after a turn that failed (network error, `429`) — the reference
widget does not, on the grounds that the guest's message is already in the transcript and can be
retyped. This is **RECOMMENDED, not required**: a consumer that never retires a row still satisfies
the contract, which is why the [breaking-change guarantee](#versioning) holds for consumers built
against 1.5.0.

### `conversation_ended` — this conversation accepts no further turns
Emitted on the **turn-cap** reply (D-044): a conversation that reaches `wsuite.chatbot.conversation.max_turns` has its next message refused with a canned localized reply and **no LLM call**, bounding one session's AI spend. The guest must start a new conversation to continue, and this element is how a consumer knows to offer that at the right moment instead of guessing.

```json
{ "type": "conversation_ended", "reason": "turn_cap" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | `string` | no | Why it ended. `turn_cap` is the only value emitted today; it stays optional so a later cause needs no new element type. |

- **It carries no visual payload.** The `reply` already tells the guest the limit was reached, so a
  renderer that ignores this element loses nothing — it is a signal, not content. It is emitted
  **last** in `actions[]`, after the `contact_channels` element the capped reply may also carry
  (that one is the actionable part).
- **The cap is deployment configuration, not a contract guarantee** — 50 turns by default, `0`
  disables it entirely. Never hardcode the number.
- **Two honest edges.** The capped reply's `turn` repeats the last *completed* exchange's number
  (nothing was persisted for the refused message), so every further POST to a capped conversation
  returns the same `turn`. And the cap is detected on the message *after* the last allowed one, so a
  consumer that closes its composer on this element does so having spent one message finding out.

## Security rule (both widgets)
Guest/LLM strings and element fields are rendered via `textContent` / `setAttribute` / created DOM nodes — **never `innerHTML`** — so a hostile reply cannot inject markup (XSS); this includes the tenant-authored `promo_card`/`quick_replies` strings. Element-supplied `url` **and `image`** fields (`link_button`, `booking_link`, `availability`, `property_cards` items **and its element-level `more.url`**, `promo_card`/its `cta`) are honoured **only for `http`/`https`** schemes; everything else is dropped. `quick_replies` items carry no URLs at all — chips send text, never navigate. `tel:`/`mailto:`/`wa.me` hrefs are constructed by the widget from the channel values, not taken verbatim.

Every URL-bearing field the contract ever adds inherits this rule; it is named here so the list stays
the single inventory.

## Accessibility
Guidance, not requirements — but three renderers making three different choices for the same element
is worse for guests than one convention, so this is what the reference widget does and what a
consumer is encouraged to match.

- **The reply is the live region.** Keep one `aria-live="polite"` region for arriving reply text.
  Elements should **not** each announce themselves — a card rail, a promo and a chip row all firing
  live announcements on one turn talk over the answer.
- **`property_cards`** — expose the rail as a labelled list (its cards are peers, not a slideshow),
  keyboard-traversable so a keyboard or switch user reaches every card's CTA; carousel arrows must not
  be the only way to reach a card, and position dots are decorative. Card images are decorative unless
  `image_alt` is present (see [card images](#card-images)).
- **`promo_card`** — a region named by its `title`, not a live region. Mark it up with `lang` when
  `locale` is present, so a screen reader does not read Spanish copy with an English voice. Its banner
  image is decorative.
- **`quick_replies`** — real `<button type="button">` elements (never anchors — chips carry no URLs) in
  a group with an accessible name so their purpose is clear before they are read out one by one. When a
  row retires, do not steal or drop focus; move it somewhere sensible if it was inside the row.

## Extension rule (the DRY seam)
Adding a new rich type (`image`, `map`, `video`, … — 1.5.0's `property_cards`/`promo_card`/`quick_replies` were added exactly this way) is two code edits plus a version bump — **the envelope never changes**:

1. **Server:** one new value object under `modules/chatbot/src/Responses/Elements/` implementing `Element` (a stable `toArray()` returning `{type, …}`), emitted by the relevant handler.
2. **Widget:** one new branch in `renderAction(action)` keyed on the new `type`.
3. **Version:** bump the [version](#versioning) (**MINOR** — additive) and add a [Changelog](#changelog) row **including its Breaking and Consumer action cells**; keep `Wsuite\Chatbot\Responses\ResponseContract::VERSION`, this doc's header, the reference widget's `BUILT_AGAINST` and `integration-guide.md`'s version line in lockstep, then tag the commit `chatbot-contract-v<X.Y.Z>`. The init `contract_version` then signals consumers to adopt it, and `modules/chatbot/docs/consumer-sync.md` records which consumer is still behind. *(Skipping this is the one way an additive change goes unnoticed — guard tests assert every element's `type` appears in the Changelog and that all four version sites agree.)*

Existing consumers ignore the unknown `type` until they add the branch, so the server can ship a new element ahead of any given widget. The in-repo `WidgetPreview` Filament page + `resources/widget/chatbot.js` is the **reference renderer** for this contract; the external `nest-chatbot-ai` repo is versioned separately and consumes this document.

## Changelog

Per [Versioning](#versioning): additive element/field additions are **MINOR** and backwards-compatible by the ignore-unknown rule. Newest first.

**Breaking** answers "does this version break me?" without reading the policy above. It is `No` for every MINOR/PATCH row by the guarantee — a `Yes` can only ever appear on a MAJOR, which should never be issued.

**Consumer action** states what an existing consumer must do to adopt the row. Every row is optional by construction — "none" means a consumer that changes nothing keeps working — so this column is the adoption checklist for a re-vendored integration packet, not a migration mandate.

Each version is tagged in the platform repo as **`chatbot-contract-v<X.Y.Z>`**, so a consumer can be handed an exact packet snapshot and can diff its own version forward (`git diff chatbot-contract-v1.2.0..chatbot-contract-v1.4.0 -- modules/chatbot/docs/`).

| Version | Date | Breaking | Change | Element / field | Consumer action |
|---|---|---|---|---|---|
| `1.12.0` | 2026-09-15 | No | **A handoff that does not know the property asks, instead of guessing** (D-079, closes KI-010's guest and mail halves). Until now a human-handoff turn with no identified property borrowed the tenant's alphabetically-first property: its `contact_channels` went in front of every such guest and, since per-property handoff mail (D-048), its inbox received their request — 15 of 25 live handoffs over 30 days, measured 2026-09-15. Such a turn now emits **no** `contact_channels`; its deterministic `reply` says staff were notified and asks which property the request is about, over a **`quick_replies` row with the new `id` `property_choice`** (one chip per bookable property, labels are catalog names, no `locale`, uncapped). The request is still raised. The next message that names one property — a tapped chip or a typed name — is answered as that handoff: the property's channels appear, and its own inbox is told once. Additive by the ignore-unknown rule: a new value in the documented `id` vocabulary, a known element on a turn it never appeared on, and a known element that a turn can now omit. Reference widget: a constant move plus one comment — it already renders any chip row on any turn and does not switch on `id`. | `quick_replies` (`id: property_choice`; emission on a handoff turn) · `contact_channels` (not emitted while the property is unknown) | **None required.** Two checks: (1) if you switch on `quick_replies.id`, treat `property_choice` like `island_choice` (server text, proper-noun labels, send `message` verbatim); (2) if anything in your widget assumes a handoff turn always carries `contact_channels` — a "call the hostel" affordance keyed on it, say — let it be absent. Rows can be long: wrap or scroll. |
| `1.11.0` | 2026-09-14 | No | **A `429` can last a day, and says so** (D-078). The guest bucket (init + turn) gains two **daily** ceilings beside its per-minute ones — per visitor (key + IP) and per key (the whole site), a rolling 24 hours — so an IP-rotating flood can no longer spend a month's AI budget in minutes. A `429` from a daily cap can therefore last up to 24 hours, and `Retry-After` is now in CORS `exposed_headers` so a browser consumer can read how long. The body is unchanged (`{"message":"Too Many Attempts."}`), no element or field moves, and polls are untouched. Reference widget: a constant move — its soft retry copy is unchanged. | `429` response · `Retry-After` header (newly readable) | **Optional.** Read `Retry-After` on a `429`; when it is more than about a minute, show a "come back later / contact the hostel" message instead of "try again in a moment", and do not retry automatically. A consumer that changes nothing keeps working and shows its existing retry copy. |
| `1.10.0` | 2026-08-28 | No | **The hostel card beside the booking element, per site** (D-073). When a tenant switches it on for a site (`chatbot.cards.on_booking`, off by default), the Ready booking turn carries the resolved property's `property_cards` (one item) **first** in `actions[]`, before its `availability` or `booking_link`; the card's `url` is byte-identical to that element's. D-069 had moved every "is it free / price for these dates" question onto the booking path, where no card had ever been emitted, so the hostel's image, location and from-price vanished from exactly the turns guests ask that on. No element or field is added, removed or renamed — a known element on a turn it never appeared on. Reference widget: the `availability` branch now draws `options[]` unconditionally and dedupes only its Book button — against a card CTA in the same list and against a url already anchored this turn. | `property_cards` (emission) · `availability` / `booking_link` (co-occurrence) | **Extend your Book-button dedupe** to `availability.url` and `booking_link.url` against the card CTAs you actually render (raw string equality, D-043(c)), and keep drawing `options[]` regardless. A renderer that already dedupes every Book affordance against rendered card urls needs only the constant move. Nothing reaches the wire until the tenant switches the card on. |
| `1.9.1` | 2026-08-28 | No | **Prose rule only, no wire effect** (PATCH, D-072). On a Ready turn whose every option carries `total`, the reply names at most the cheapest bed and the cheapest whole room and points the guest to the option list instead of re-typing it — measured on live turns, a three-to-six-option list was being read twice, once as bullets in the reply and once as the widget's rows. The same disclosure closes the async tool result. Shape unchanged. | *(none — prose)* `availability.options[]` | **None if you draw `options[]`** — one row per option, which both registered renderers do. If you skipped the `availability` branch since 1.2.0 on the strength of "the reply lists them anyway", add it: the reply now points at rows only your renderer can show. |
| `1.9.0` | 2026-08-26 | No | **The booking URL carries the stay** (D-071). Every booking `url` the server emits is now composed from the catalog's CloudBeds booking code and the collected stay: the language segment for the guest's locale, `checkin`/`checkout` when both are known, and `adults` only when the guest stated a party size (an assumed one is never sent — D-068(b)). Applies to `booking_link.url`, `availability.url` (sync and async — the async final is byte-identical to the interim `booking_link` for the same stay), the information turn's Book `link_button.url`, and `property_cards[].url` (still the same string as the Book button beside it). A catalog whose booking URL is not a CloudBeds one is unchanged. No element or field is added, removed or renamed; this is the value-change lane §Versioning now names. | `booking_link.url` · `availability.url` · `link_button.url` (Book) · `property_cards[].url` | **None** — render as before. If you parse, normalise or strip a booking `url` anywhere (dedupe, analytics, display), stop: it now carries a language segment and query parameters, and the card-vs-button dedupe compares raw strings. |
| `1.8.0` | 2026-08-26 | No | **Three additive option fields** (D-067, KI-020): `availability.options[]` may carry `basis` (`per_person` \| `per_unit`), `units` and `total` — the price the PARTY pays for the stay, where `price` was and remains the stay total for ONE bed or room. Emitted only when the PMS snapshot knows how the room type is sold (a dorm sells beds, a private room sells rooms — availability contract 2.1.0 §6); absent otherwise, and the three come together or not at all. The reference widget renders "2 beds · Mixed Dorm — 200.00 EUR total" above the Book button; the reply text carries the same numbers. | `availability` → `options[].basis`, `options[].units`, `options[].total` | **None** — optional. Render `total` (with `units` + `basis`) via `textContent` if present; never derive it from `price`; an option without it renders as before. |
| `1.7.1` | 2026-08-26 | No | **Emission rule only, no wire effect** (PATCH, the `1.6.2` lane): the `availability` element is now also emitted on the deterministic **Ready** turn — `wsuite/pms` binds `AvailabilityProvider` process-wide since Phase 1b (D-062), answering from a scheduled snapshot of the PMS rates. Shape unchanged; `options[].room` carries the vendor's room-type name, plus the plan name for a named plan ("Mixed Dorm (Nest Pass - Weekly)"). The "dormant at MVP / until a PMS provider binds" statements in §[`availability`](#availability--live-availability) and the poll section are retired. | `availability` | **None** — the existing `availability` branch (render `url` as a booking button; `options`/`available` display-only) already handles it; a consumer without the branch ignores the element and still gets the reply text. |
| `1.7.0` | 2026-08-21 | No | **Three additive fields, one release** (O-45 · O-46 · O-47). **(a) `idle_hours` on the init `201`** — the conversation idle window, in hours. Every renderer so far hardcoded a 24h mirror of this server config and had no way to see it change, so the day a deployment widened its window, a guest returning after hour 24 would lose their transcript on screen **and open a second conversation while the server's original was still live**. It is sent as a **duration, not an `expires_at` instant**, deliberately: the expiry advances on every turn while init fires once, so a cached instant would be wrong from turn 1. **(b) `server_time` on the init `201`** — ISO-8601. Nothing in the guest API records *when* a message happened (`turn` is an order, not an instant), so a consumer that dates its own stored transcript is using the sending device's clock; this lets it compute a server offset once per conversation. **(c) `quick_replies.heading`** — an optional tenant-authored, server-localized line rendered above a chip row, saying what the row asks. At init there was previously nowhere to put that question, so a site's island chips rendered bare under a greeting that did not mention them. Nothing was removed, retyped or renamed. | *(init)* `idle_hours` · `server_time` · `quick_replies` (`heading`) | **Optional, and independently adoptable.** **(a)** is the one worth taking: drive your stored-conversation expiry from `idle_hours` instead of a constant, **and persist it with the record** — your resume path never calls init, so a widget that only reads it at init still expires early on exactly the visit that matters. **(b)** compute `serverOffset = Date.parse(server_time) - Date.now()` once and apply it to your own stamps. **(c)** render `heading` above the row via `textContent`, **retire it with the row** (a detached sibling outlives its chips), and never substitute a label of your own when it is absent. All three are absent on an older server and must stay absent-tolerant. |
| `1.6.2` | 2026-08-07 | No | **Emission rule only, no wire effect** (D-047). A `property_cards` element now requires a *this-turn* signal: the guest named the hostel(s), referred to one, asked by island, or is on a `data-property`-seeded page (which cards once). A property the server merely **remembers** from an earlier turn no longer emits one — before this, a hostel named on turn 4 kept its card under every later answer, including questions about other islands, and it also masked the island carousel the guest had asked for. Second change in the same rule: a turn naming **several** hostels now emits **one card each** instead of collapsing to one arbitrary card. Field shapes, ordering, `total`/`more` semantics and the Book-button dedupe are untouched. | *(none — emission)* `property_cards` | **None.** Fewer, more relevant cards arrive; every field you already read is unchanged. One thing to sanity-check if you hardcoded it: a **named-property** turn can now legitimately carry more than one item, so a rail sized for exactly one card should flex (`total` already told you this could happen on by-area turns). |
| `1.6.1` | 2026-07-31 | No | **Documentation only, no wire effect** (D-044(j)). `price_from.period`/`basis` are stated to be **per item**, so two cards in one carousel may legitimately differ: they describe the *cheapest bookable thing* a from-price refers to, not the property — a hostel selling dorm beds and private doubles quotes `per_person` (its from-price is a bed) while a property whose cheapest offering is a whole double room quotes `per_unit`. Server-side, the source became finer-grained to match (per-property catalog columns overriding the site-wide declaration), which is invisible on the wire. | *(none — clarifies)* `property_cards` `price_from.period`/`basis` | **None if you have not adopted `period`/`basis` yet.** If you have: **resolve the suffix per card**, not once per rail — lifting one item's values to the whole carousel will mislabel a mixed catalog. Nothing else changed. |
| `1.6.0` | 2026-07-30 | No | **The fields a rich card/promo/chip UI needs, from the first consumer to build all three (D-044).** New optional fields: `property_cards` gains element-level `total` (matches before the cap) and `more` (`{label, url}`, localized label), item `cta_label` (server-localized Book text) and `image_alt` (**reserved, not emitted yet**), and `price_from.period`/`basis` (`night`\|`stay` · `per_person`\|`per_unit` — so "from €22" can finally say "/night"); `promo_card` and `quick_replies` gain `locale` and `id`; **`promo_card`/`quick_replies` content is now resolved per guest locale** where the tenant supplies translations (amends D-043(e)). New element **`conversation_ended`** on the turn-cap reply. Documentation, no wire effect: the [missing-required-field policy](#element-conventions-all-types), per-field localization, `price_from` decimal/tax semantics, image and `key` semantics, the `style` value set, advisory text lengths, item caps and order, promo repeat/dismissal semantics, the clarified [Book-button dedupe](#compatibility-and-the-book-button-dedupe-d-043c) and interim→poll duplicate, the precise [one-shot chip rule](#the-one-shot-rule), poll-side `404`/`410`, init `actions[]` composition, element placement, and an [Accessibility](#accessibility) section. | `property_cards` (`total` · `more` · `cta_label` · `image_alt` · `price_from.period`/`basis`) · `promo_card` (`locale` · `id`) · `quick_replies` (`locale` · `id`) · `conversation_ended` | **Optional, and mostly free.** Adoptable fields: render `cta_label` in place of your hardcoded Book text, append a localized period/basis suffix to the from-price (**and keep rendering the bare price when they are absent — never infer "/night"**), use `total`/`more` for an overflow affordance, set `lang` from `locale`, and add a `conversation_ended` branch for a "start a new chat" affordance. Pure documentation, nothing to build: everything in the second half of the Change cell — though **do re-read the dedupe rule** (a card you dropped must not suppress a Book button) and the one-shot rule (it is still a SHOULD; both triggers retire every row). `image_alt` is reserved — a one-line `alt = image_alt \|\| ''` future-proofs you today. Skippable in full: unknown fields and types are ignored and every 1.5.0 flow keeps working. |
| `1.5.0` | 2026-07-28 | No | Three rich guest elements (D-043): `property_cards` (a deterministic catalog card carousel — key/name/location/image/price_from/badge/Book-CTA per item), `promo_card` (a tenant-authored promo block from site settings), `quick_replies` (tap-to-send chips `{label, message}`; **no URLs in chips**). The **init** `201` additionally gains an optional `actions` array carrying the same element vocabulary (greeting-time quick prompts / promo; always emitted, `[]` when unconfigured). Existing `link_button`/`booking_link` emission is unchanged — a card-aware renderer dedupes a Book button whose URL equals a card CTA (D-043(c)). | `property_cards` · `promo_card` · `quick_replies` · *(init)* `actions` | **Optional** — add three `renderAction` branches (chips send `message` as a normal turn and the row is one-shot), render init `actions[]` after the greeting when present, and dedupe Book buttons by URL against card CTAs. Skippable: unknown types are ignored and the existing buttons keep every flow functional. |
| `1.4.1` | 2026-07-27 | No | **Documentation only, no wire effect** (the first PATCH row — it exercises the lane): the [breaking-change guarantee](#versioning) is stated explicitly, this table gains the **Breaking** column, and each version is now tagged `chatbot-contract-v<X.Y.Z>` so a packet snapshot is reproducible. | *(none)* | **None** — nothing on the wire changed. Re-vendor at your convenience to pick up the clearer docs. |
| `1.4.0` | 2026-07-27 | No | The information path now emits a third deterministic **`link_button`** — a "Get directions" button carrying the property's authoritative `map_url` — alongside the existing Book / Website buttons (D-042(c) / KI-007). No new element type: it is a `link_button` like the others, deduped by URL. | `link_button` | **None** — an existing `link_button` renderer already handles it (label + `url` + optional `style`); it just renders as one more call-to-action. |
| `1.3.0` | 2026-07-23 | No | Added the optional **request** field `locale` on the turn endpoint (`POST …/messages`) — an explicit per-turn reply-language override for a consumer that owns a UI language switcher. Stateless: it applies to that turn only, and omitting it keeps per-turn language detection unchanged. See `integration-guide.md` §3.2. | *(request)* `locale` | **Optional** — send `locale` on every turn **only if** you have a UI language switcher. No renderer change; omit the field and nothing changes. |
| `1.2.0` | 2026-07-22 | No | Added the `availability` element (live PMS availability on a completed async tool turn; dormant until a provider binds — D-037(g)). | `availability` | Add an `availability` branch to `renderAction` (render `url` as a booking button; `options`/`available` are display-only). Skippable — it is ignored until then, and dormant at MVP. |
| `1.1.0` | 2026-07-22 | No | Added the `async_result` element for gated async tool turns (interim reply + poll `url`; ignorable by non-poll-aware consumers — D-037(f)/(h)). | `async_result` | Add an `async_result` branch that polls `url` (relative — resolve against your API base) and replaces the interim bubble. Skippable — the interim reply + fallbacks stand on their own. |
| `1.0.0` | 2026-07-21 | — | Initial frozen envelope (`reply` / `actions[]` / `turn`) + the deterministic call-to-action elements. | `link_button` · `contact_channels` · `booking_link` | Baseline — render `reply`, then each element of `actions[]` in order. |
