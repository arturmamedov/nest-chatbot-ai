# Widget 2.4.0 rich elements — `property_cards`, `promo_card`, `quick_replies`, init `actions[]`

**For:** the wSuite platform team.
**From:** the Nest Chatbot drop-in widget (`nest-chatbot.js`), release 2.4.0, 2026-07-29.

These are the wire shapes **widget 2.4.0 implements**, as agreed with the platform team ahead
of the contract sync. This is a record, not a request: it states exactly what the widget puts
on screen for each field so the two implementations can be diffed rather than guessed at, and
it collects the questions the shapes left open.

## Status

Upstream tagged `chatbot-contract-v1.5.0`, and as of 2026-07-31 the packet in `docs/wsuite/` is
vendored from it. **The widget has not yet been reconciled field-by-field against the shipped
spec**, so `BUILT_AGAINST` in the api section is deliberately still `'1.4.1'` — it records what
the *code* implements, not what the docs say.

That has one visible consequence: a server reporting `contract_version: "1.5.0"` at init trips
the widget's one-time contract-drift `console.warn` **by design** until the sync lands. Per
integration guide §3.1 that warn never gates and never hard-fails — the ignore-unknown rule
keeps the widget fully functional against a newer server, and the warn is the sole exception to
the `data-debug` logging gate.

**Release 2.5.0 closes the sync.** It reconciles the three renderers below field-by-field
against the shipped spec, resolves whatever the open points at the foot of this document turn
into, and moves `BUILT_AGAINST`. Two gaps are already known and named there: Book-button dedupe
against a card CTA (open point 6) and one-shot mid-transcript chip rows (open point 7). Anything
in this document that the shipped 1.5.0 text contradicts is this widget's bug, not the
contract's.

Since this document was written, **release 2.4.2** reverted the init-`quick_replies` precedence
to what 1.5.0 specifies — server chips replace the widget's own prompt block rather than joining
it. The Precedence section below and open point 9 carry the current state.

## Envelope

Every shape below is an element inside the existing `actions[]` array of the frozen
`{reply, actions[], turn}` envelope. No new top-level arrays, no new endpoints, no change to
the turn body (`{message}` plus the per-turn `locale` from 1.3.0). Optional fields are
**omitted when absent** rather than sent as `null`, matching the existing `array_filter` house
style. `actions[]` is always an array, and elements render in payload order.

## `property_cards`

A horizontally scrolling strip of bookable properties.

```json
{
  "type": "property_cards",
  "items": [
    {
      "key": "duque",
      "name": "Duque Nest",
      "location": "Costa Adeje, Tenerife",
      "image": "https://…/duque.jpg",
      "price_from": { "amount": "25.00", "currency": "EUR" },
      "badge": "Nest Pass",
      "url": "https://hotels.cloudbeds.com/…"
    }
  ]
}
```

Per item: `key`, `name` and `url` are required; `location`, `image`, `price_from` and `badge`
are optional-omitted.

- **`url` is the CTA and it is mandatory.** A card exists to be booked. An item whose `url`
  does not survive `safeHttpUrl()` (http/https only) is dropped whole — a card that merely
  looks tappable is worse than no card.
- **`name` is the card.** A nameless item is dropped for the same reason: a photo over a price
  is not a property.
- **`amount` is a string**, matching `availability.options[].price`. The widget formats only
  the *number*, through `Intl.NumberFormat(locale, {style:'currency', currency})`; the words
  around it ("from …") come from the widget's own string packs, so no localized prose is
  needed on the wire.
- **`badge` and `location` are tenant-authored and server-localized.** They reach the DOM via
  `textContent` and are never translated widget-side.
- `location` being optional matters in practice — the platform genuinely has properties
  without one, and the card simply skips the line.
- The widget renders at most **8 items** and does not paginate. See the open points.

## `promo_card`

A tenant-authored upsell. The content is site settings (D-028) — "Nest Pass" is tenant #1's
instance content; the element itself is generic.

```json
{
  "type": "promo_card",
  "title": "One booking. All Hostels.",
  "body": "7 nights for €140 — the Nest Pass moves with you between our islands.",
  "image": "https://…",
  "cta": { "label": "Get Your Nest Pass", "url": "https://…" },
  "style": "highlight"
}
```

`title`, `body` and `cta{label,url}` are required; `image` and `style` are optional-omitted.

- A payload missing any of the three required pieces — including a `cta.url` that fails
  `safeHttpUrl()` — renders nothing at all. The CTA is the point of the card.
- `style: "highlight"` gets the emphasised gradient treatment. An absent or **unrecognised**
  `style` falls through to a bordered plain card; no value can throw, so the platform can add
  variants without waiting for a widget release.
- **`image` is a widget interpretation worth confirming:** 2.4.0 renders it as a full-width
  cover band above the title. The shape says only "an image", so if the platform intends
  something else (a thumbnail, a background), say so and the widget follows.

## `quick_replies`

Tap-to-send suggestion chips.

```json
{ "type": "quick_replies", "items": [ { "label": "Nest Pass", "message": "What is the Nest Pass?" } ] }
```

- Tapping a chip sends `message` as a **normal guest turn** — the same code path the composer
  uses. Nothing about the transport changes.
- **No urls in chips**, and the widget enforces it rather than trusting it: an item `url` is
  ignored outright. The URL security surface is unchanged — links stay `link_button` and
  `contact_channels`.
- `message` is required (a chip with nothing to send is a dead end and is skipped);
  `label` falls back to `message` when absent.

## Init response `actions[]`

```
POST /api/v1/chatbot/conversations → 201 { conversation:{uuid}, greeting, actions[], contract_version }
```

The init response carries `actions[]`, so a site can configure its own welcome elements at no
extra network cost — the widget already makes this request and has nowhere else to put them.
The server always emits the key (`[]` when the site has configured nothing); the contract
documents it as optional, because older servers omit it entirely.

**Precedence, as implemented in 2.4.0:** a non-empty `actions[]` is rendered after the greeting
and the widget **skips** its own cached suggestion block — the server owns the welcome when it
has one. The widget's built-in prompts are the fallback only (unconfigured sites, older
servers, mock mode, and any `actions: []`). Server-supplied welcome elements are transcript
content: they behave exactly like elements on any other reply and survive the first guest turn.

**Changed in 2.4.1, reverted in 2.4.2 — server chips replace the widget's block.** 2.4.1 briefly
rendered both, on the reasoning that the blocks are not substitutes and that an unlabelled chip
row is not a complete welcome. That decision was taken against the 1.4.1 packet, before the
shipped 1.5.0 text was on disk. 1.5.0 says what an init chip row *is* — *"Emitted on the init
response from the site's `chatbot.quick_prompts` setting (the "try asking" chips)"* — so
rendering both puts the same affordance on screen twice, the site's version and the widget's.
2.4.2 restores server-replaces-ours: the widget's pills are the fallback only (unconfigured
sites, older servers, mock mode, `actions: []`). The branch is on what actually **rendered**, not
on what the payload contained, so a `quick_replies` element whose every item is malformed still
falls back to the pills rather than leaving an empty welcome.

The **partition** introduced in 2.4.1 is unchanged: a `quick_replies` row joins the one-shot
`.nc-welcome` wrapper and goes on the first guest turn, while every other element (a
`show_at_init` promo) stays transcript content in `.nc-body` and survives it — exactly as this
section originally described.

Reusing `quick_replies` more than once in one init `actions[]` is correct and the widget handles
each row independently — the intended payload is **two** rows, the site's "try asking" prompts
and (when the turn calls for one) a clarification row. What 1.5.0 still cannot do is let a row
say what it is asking; see open point 9, which is now the live request rather than a
nice-to-have.

## Widget-side degradation rules (2.4.0, all three types)

Stated so the platform knows precisely what a partial payload costs on screen:

- Every string reaches the DOM via `textContent`. Never `innerHTML` — the contract's own
  security rule, and non-negotiable here.
- Every `url` and `image` passes `safeHttpUrl()`. A rejected **image** drops the picture only;
  a rejected **CTA url** drops the whole card, because the CTA is mandatory.
- Skipped silently, never with a visible placeholder and never with an uncaught throw: an item
  with no non-empty `name`, an item with no usable booking `url`, a promo missing `title`,
  `body` or a valid `cta`, a chip with no non-empty `message`.
- Unknown keys inside a known element are ignored. Unknown element **types** are ignored
  silently and their siblings still render — unchanged from 1.4.1.
- `price_from` renders only when `parseFloat(amount)` is finite **and** `Intl.NumberFormat`
  accepts the currency; a `RangeError` from a tenant-configured code costs the price line and
  nothing else.
- An element that renders nothing leaves no empty container behind — no phantom gap, no
  floating arrows over a blank strip.

## Open points

These are the live questions. None of them blocks 2.4.0; each one changes what 2.5.0
implements.

1. **Overflow on `property_cards`.** The widget caps the strip at 8 items and shows no count,
   because the wire carries neither a `more` link nor a `total` and inventing a number would
   put something unverified on screen. An optional `more: { "label": "…", "url": "…" }` on the
   element would let a >8-item answer end in a real "see all" affordance. Requested; not
   assumed.
2. **A per-unit hint for `price_from`.** The design mock reads "from €22/night"; the wire
   carries no unit, so 2.4.0 renders **"from €25"**. Per-night is not a safe widget-side
   assumption — the same element will serve businesses priced per stay, per person or per
   item. An optional server-localized `price_from.unit` string (or a typed enum the widget
   maps to its own packs) would close the gap.
3. **`getting_here`-style info rows are deferred, not dropped.** The design phase specified an
   info-row element (map link + directions prose) and the "pass beside the map row" pairing in
   the expanded sheet. Neither is in the agreed shapes, so neither is implemented. If the
   platform wants it, it is a new element type and exactly one new branch in `renderAction()`.
4. **"At most one promotional `promo_card` per conversation" is a server-side guideline.** The
   widget deliberately enforces no such cap: element governance belongs to whoever composes
   the reply, and a widget-side flag would be invisible state the server could not reason
   about. Recording the guideline here so it lives somewhere.
5. **`location` on the wire.** Optional today, and the widget handles its absence cleanly. If
   the platform intends it to become required once property records are backfilled, say so —
   the widget's handling would not change, but the mock fixtures would.
6. **Book-button dedupe is known-missing, and it is ours to close.** The shipped 1.5.0 text
   asks for it — *"A card-aware renderer SHOULD suppress a `link_button`/`booking_link` whose
   `url` exactly equals a card item's `url` in the same `actions[]` list"* — and 2.4.0 does not
   do it: `renderAction()` handles each element in isolation and has no memory of the urls a
   carousel already put on screen. Against a real 1.5.0 server a guest can therefore see a
   "Book now" pill repeating the CTA on the card directly above it. The mock cannot catch this
   and never will by accident: its CTA trio deliberately uses three different urls, so the
   fixture is not a regression test for it. Not a contract change — a widget gap, **owned by
   the 2.5.0 contract sync**, alongside a fixture whose `link_button` url matches a card's.
7. **`quick_replies` is one-shot in the welcome as of 2.4.1; mid-transcript rows still are
   not.** The shipped text calls a chip row *"one-shot by convention: remove (or disable) the
   row once a chip is tapped or the guest types instead"*. 2.4.0 kept every chip row standing,
   treating them as transcript content on the same reasoning that keeps a rendered
   `link_button` in place after it is followed. 2.4.1 closes half of that: a row rendered into
   the **welcome block** now lives inside the single `.nc-welcome` wrapper that
   `removeWelcome()` takes away on the first guest turn, so an init chip row is one-shot and
   leaves under the same focus rescue as the widget's own prompt pills. A row a **reply**
   carries mid-conversation is still not one-shot — it is appended to `.nc-body` and stays.
   Closing that half is **owned by the 2.5.0 contract sync**. The warning stands for whoever
   does: removing a row the guest has just activated with the keyboard removes the node holding
   `document.activeElement`, which resets focus to the host page's `<body>`. It needs the same
   focus rescue `removeWelcome()` carries, for exactly the same reason. Disabling the row
   instead of removing it sidesteps the whole problem and is worth considering.
8. **Not a contract question, recorded so it is not lost: the CDN must send
   `Access-Control-Allow-Origin` on `fonts/`.** Since 2.4.0 the widget self-hosts its WOFF2
   files next to `nest-chatbot.js`, and a cross-origin `@font-face` fetch is CORS-mode even
   though the stylesheet beside it is not. Without the header every host page falls back to
   the system font stack; the widget keeps working and nothing on screen flags it, so the only
   trace is the browser's own CORS error in devtools.
9. **A `quick_replies` row cannot say what it is asking, and at init that is a real gap — this
   is now the live request.** The element carries only `items[]`. The init envelope carries only
   `greeting` and `actions[]`, and there is no text element type in the contract — so a server
   that sends island chips as welcome elements has **no way to send "Which island are you going
   to?" with them**. On a turn the `reply` string supplies that line for free (which is exactly
   why the `hostel` fixture reads correctly); at init the greeting is already spent introducing
   the assistant.

   Per the owner's decision, 2.4.2 renders server rows **bare** rather than borrowing the
   widget's own "Try asking" label for them: a label reading "try asking" over "Tenerife" would
   assert an island name is a thing to try asking, when it is the answer to a question. So a
   welcome built from a site's `chatbot.quick_prompts` is currently unlabelled chips under a
   greeting that does not mention them, and that is the accepted state until this is settled.

   Requested: an optional element-level `heading` on `quick_replies` — server-localized,
   tenant-authored, reaching the DOM via `textContent` like every other payload string, rendered
   above the row and simply absent when omitted. `promo_card` already carries exactly that kind
   of string in its `title`, so this asks for nothing new in kind. A generic `text` element type
   would solve this and more, but it is a much larger ask and the widget does not need it.

   Two related things are already settled and need nothing from the platform. Reusing
   `quick_replies` more than once in one init `actions[]` is correct — the intended payload is
   **two** rows, the site's "try asking" prompts and a clarification row, and the widget handles
   each independently. And since 2.4.2 the widget no longer pairs a server row with its own pill
   block, so the "a site's prompts *plus* the widget's two pills" duplication this point used to
   flag is gone: a `heading` is now about making the row readable, not about suppressing ours.
