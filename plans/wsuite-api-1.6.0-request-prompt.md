# Task — wSuite chatbot contract 1.6.0: fields the shipped rich elements still need

You are working in the **wSuite backend** repo, which owns the guest chatbot API and the
vendored contract packet (`response-contract.md`, `integration-guide.md`,
`chatbot.reference.js`) that consumers integrate against.

Contract **1.5.0** shipped on 2026-07-28 with three new guest elements — `property_cards`,
`promo_card`, `quick_replies` — plus an `actions` array on the init response. A first-party
consumer, the Nest Hostels widget (`nest-chatbot-ai`, release 2.4.0), has now built full
renderers for all three against those exact shapes and driven them through a browser
verification pass.

**This task is the feedback loop from that build.** Everything below is a gap the consumer hit
while rendering real UI against the shipped spec. Nothing here is a bug report about 1.5.0 —
the envelope is sound, the field names are right, and the security rules are correct and were
adopted verbatim. These are fields and statements the contract does not yet carry that a rich
UI needs in order to render these elements *well* rather than merely safely.

**Scope discipline: this is a 1.6.0 MINOR, additive only.** Every item below must be an
optional field, an optional element-level key, or a documentation statement. Nothing renames,
retypes, or removes anything. A consumer that adopts none of it keeps working, per the
contract's own breaking-change guarantee. If you find yourself wanting to change an existing
field's type or requiredness, stop — that is a MAJOR and the envelope is frozen.

---

## Read first

- `response-contract.md` — the envelope, the eight element types, the Changelog and Versioning
  policy. This is the file most of the work lands in.
- `integration-guide.md` — transport, auth, errors, rate limits, CORS/origins.
- `chatbot.reference.js` — the platform's own reference widget. Several items below note where
  it already diverges from the contract; those divergences are part of the problem, because a
  consumer that "does exactly what the reference does" ends up non-compliant.

---

## Part 0 — Consumer conformance report (context; no work here)

Confirmed by direct code inspection of widget 2.4.0. Recorded so you know what the field
already does correctly and do not re-specify it:

- All three new element types are implemented as ordinary `renderAction` branches. Unknown
  types are still ignored silently.
- Every payload string reaches the DOM via `textContent` / created nodes. No `innerHTML`
  anywhere. The single `DOMParser` call takes module-local SVG constants only.
- `url` **and `image`** on `property_cards` items, and `image` + `cta.url` on `promo_card`, all
  pass an `http(s)`-only gate — i.e. the widget adopted RC:245's widened rule, including the
  part `integration-guide.md` §4 rule 3 was never updated to mention (see item 3.4 below).
- `quick_replies` items carry no URLs and are rendered as `<button>`, never `<a>`. An item's
  `url` key, if one ever appeared, is never read.
- `promo_card.style` is matched by strict equality against a known literal before it becomes a
  class — stricter than the `/^[a-z-]+$/` whitelist the contract requires.
- A `property_cards` item with no non-empty `name`, or whose `url` fails the scheme gate, is
  dropped entirely — the contract's "a property without a `booking_url` yields no card"
  enforced client-side too.
- Init `actions[]` is rendered after the greeting and its absence is tolerated.
- `locale` is sent on every turn as a 2-letter primary subtag; `property` is sent at init.
- Turn `404` is terminal (clear uuid → re-init → resend once); poll `404` is transient
  (back off to the give-up deadline). Both match integration-guide §5.1.

**Two places the consumer is knowingly non-conformant today**, both scheduled for its own 2.5.0
sync and listed here only so you do not report them back as contract bugs:

- The D-043(c) Book-button dedupe is not implemented yet.
- `quick_replies` rows are not one-shot yet.

---

## Part 1 — `property_cards`: the fields a card UI actually needs

### 1.1 `price_from` has no period, and the contract's own example implies one

**Contract today:** `price_from: {amount, currency}`, with the note "an admin-maintained static
from-price (D-043(d)); `amount` is a decimal **string**, the renderer formats it (e.g. 'From
€25')".

**What the consumer hit:** the design called for **"from €22/night"**. There is no field
carrying "/night", so the widget renders "from €22" and the per-night meaning is lost. That is
not a cosmetic loss — a from-price with no period is ambiguous between per night, per person
per night, and per stay, and for a hostel with dorm beds those differ by a lot. A guest reading
"from €22" against a 7-night stay can be wrong by a factor of seven.

**Please add**, optional, omitted when absent:

```json
"price_from": {
  "amount": "25.00",
  "currency": "EUR",
  "period": "night",
  "basis": "per_person"
}
```

- `period` — `string`, optional. Enumerate the legal values in the contract (`night` | `stay` |
  `person_night` is a plausible minimum; you own the domain). A consumer maps the value to a
  localized suffix; **do not send pre-localized display text**, because the consumer already
  formats the number with `Intl.NumberFormat` in the guest's locale and needs to compose the
  whole string itself.
- `basis` — `string`, optional, if occupancy basis is a real distinction in your catalog.

**Also please state explicitly** (documentation only, no wire change):

- whether `amount` is tax- and fee-inclusive;
- what window "from" is computed over (next 30 days? all-time floor? admin-entered static?) —
  D-043(d) says admin-maintained, so say that in the field's Notes cell too;
- that `currency` is ISO 4217, and whether it is optional when `amount` is present;
- the decimal convention (`"25.00"` — always two places? trailing zeros guaranteed? no
  thousands separators? always `.` as the decimal mark regardless of tenant locale?). The
  consumer parses this with `parseFloat`, so a locale-dependent decimal mark would silently
  produce a wrong price.

### 1.2 There is no cap on `items`, and no overflow affordance

**Contract today:** "one card per matching active property", with no stated maximum, no
ordering guarantee, and no `total` / `has_more` / `more_url`.

**What the consumer hit:** a horizontal carousel has to bound itself. Widget 2.4.0 caps at the
first **8 renderable items** and renders nothing to indicate that more exist — because there is
no field to drive a "See all" affordance. For a tenant with 14 properties, an island query that
matches more than 8 silently loses the rest.

**Please add**, optional:

- an element-level **`more`** object: `{ "label": "See all 14 hostels", "url": "https://…" }` —
  `label` server-localized like every other label, `url` under the same `http(s)` rule. A
  consumer renders it as a terminal card or a trailing link; one that ignores it is unchanged.
- or, if a link target does not exist, an element-level **`total`** integer so a consumer can at
  least say "showing 8 of 14".

**And please state**, whichever you choose:

- a **maximum `items` length** the server will ever emit, so consumers can size their cap to it
  rather than guessing;
- whether **`items` order is meaningful** (relevance? price? name? catalog order?). `actions[]`
  order is explicitly meaningful; item order inside an element is never mentioned, so a consumer
  cannot know whether it may re-sort.

### 1.3 Cards carry a `url` but no CTA label

**Contract today:** the item has `url` and no label for it. `link_button.label` is explicitly
"Localized server-side to the guest language", but the card's Book button has no such field, so
every consumer hardcodes and localizes its own text.

**What the consumer hit:** widget 2.4.0 reuses its own `book` string in five locales. The
reference widget hardcodes English `'Book now →'`. Two consumers, two different behaviours, and
a tenant who wants "Check rates" or "See availability" has no way to say so.

**Please add** an optional item-level **`cta_label`** (`string`, server-localized, same
treatment as `link_button.label`). A consumer that does not find it keeps its own default —
fully backward compatible.

### 1.4 Images have no alt text, no dimensions, and no stated aspect ratio

**Contract today:** `image` is a bare URL string.

**What the consumer hit:** widget 2.4.0 renders the image into an 88px-tall cover band on a
190-200px card and sets `alt=""` (decorative — the card title carries the meaning). The
reference widget instead reuses `item.name` as `alt`. Neither is wrong, but the contract should
decide.

**Please add / state:**

- an optional item-level **`image_alt`** (`string`, server-localized) — if a catalog image ever
  carries meaning the title does not, this is the only way a consumer can expose it;
- the **expected aspect ratio** or at least whether images are pre-cropped and to what;
- whether the URL is **CDN-stable and cacheable**, and whether a **placeholder** is served for a
  property with no image (or whether the field is simply omitted — the consumer currently
  assumes omitted).

### 1.5 `location` and `badge`: localized or not?

**Contract today:** both are "from the catalog locality columns" / "Short pill label". Neither
says whether it is localized to the guest's language, unlike `link_button.label` which says so
explicitly.

**Please state it either way.** A consumer that assumes catalog text renders "Costa Adeje,
Tenerife" to a German guest and is correct if the field is not localized, wrong if it is.
Also worth stating: a **max length** for `badge` ("Short pill label" is the only hint, and a
pill that wraps to three lines breaks a card layout), and whether either may contain newlines.

### 1.6 `key` is required but has no documented consumer use

**Contract today:** `key` is `Required: yes`. The reference widget never reads it. Widget 2.4.0
never reads it.

**Please either** document what a consumer should do with it (dedupe across turns? analytics?
deep-link construction?) **or** relax it to optional. A field that every consumer is required to
receive and no consumer is told to use invites divergent guesses.

### 1.7 The D-043(c) dedupe rule needs one clarification

**Contract today:** "A card-aware renderer SHOULD suppress a `link_button`/`booking_link` whose
`url` exactly equals a card item's `url` in the same `actions[]` list."

Three things a consumer cannot answer from that sentence:

- **Raw string equality, or normalized?** The reference compares raw strings. Two URLs differing
  only by a trailing slash or an added tracking parameter would not match. If the server
  guarantees byte-identical URLs for the same property in one payload, **say so** — that turns a
  fragile heuristic into a safe rule.
- **What if the card was dropped?** A card item whose `url` fails the scheme gate is never
  rendered, but the reference still records its URL in the dedupe map and suppresses the matching
  `link_button` — so a hostile or malformed card URL can silently remove the guest's only Book
  button. State the intended behaviour: a dropped card should probably **not** suppress anything.
- **Is `availability.url` in scope?** The rule names `link_button` and `booking_link` only.
  Confirm that is deliberate.

---

## Part 2 — `promo_card`: the multilingual problem

### 2.1 The promo is single-language and the widget is not

**Contract today:** RC:201 — "Content is tenant-authored, **single-language** (the greeting
precedent), and validated server-side."

**What the consumer hit:** this widget ships five locales (`en es it de fr`), has a language
switcher in its footer, and sends `locale` on every turn precisely so the server can localize
element labels. A promo card is the one element that will always arrive in whatever language the
tenant typed it in. A German guest gets an English promo sitting between two German bubbles.

This is the single highest-value item in this document. **Options, in the order the consumer
would prefer them:**

1. **Per-locale promo content**, selected server-side using the same `locale` the turn already
   carries — the tenant fills in the locales they have, and the server falls back to a default.
   Zero wire change to the element; it just arrives correct. Best outcome for every consumer.
2. **A `locale` marker on the element** (`"locale": "en"`), so a consumer can at least mark the
   block up with `lang="en"` for screen readers and decide whether to show it at all. Cheap, and
   strictly better than silence.
3. **A documentation statement** that promo content is tenant-language and consumers should not
   expect localization — the status quo, made explicit so nobody assumes otherwise.

Please do at least (2), and treat (1) as the real fix.

### 2.2 `style` is not enumerated, so consumers cannot author for it

**Contract today:** "Presentation hint (e.g. `highlight`)… a renderer that maps it to a CSS class
must whitelist the value."

**What the consumer hit:** widget 2.4.0 implements a gradient `highlight` variant and a bordered
default. It cannot know what other values exist, so any future value degrades to the default —
which is safe, but means a tenant selecting a style in an admin UI may see nothing change.

**Please publish the legal values** and what each is intended to convey (not how it should look —
that is the consumer's). Even "`highlight` is the only value at 1.6.0; more may be added" is
enough to build against.

### 2.3 `body` newlines are unspecified, and both widgets currently collapse them

**Contract today:** silent. The reference's `.wsc-promo-body` sets no `white-space`; widget
2.4.0's `.nc-promo-body` likewise. So a tenant who types a two-line offer gets one line in both.

**Please state** whether `body` may contain `\n`. If yes, say so and both consumers will set
`white-space: pre-wrap` (the reply text already relies on exactly that convention). If no,
validate it server-side and say that too.

Also please add **max lengths** for `title`, `body` and `cta.label` — tenant-authored free text
with no bound is a layout hazard in a 420px panel.

### 2.4 Required-vs-reference mismatch on `body` and `cta`

**Contract today:** both are `Required: yes`. **The reference widget treats both as optional** —
it renders a promo with no CTA when `cta` is missing or `cta.url` fails the scheme gate, and
skips `body` when absent.

Widget 2.4.0 took the contract literally: no `title`, no `body`, or no `cta{label,url}` ⇒ the
whole element is skipped silently, on the reasoning that a promo card whose CTA was dropped is
an advert with no way to act on it.

**These are three different behaviours for the same payload.** Please decide and document what a
consumer should do when a field marked required is absent — drop the element, drop the field, or
render a degraded form — and then either fix the reference or relax the contract. This applies
beyond `promo_card`; the contract currently has no general statement about missing required
fields anywhere.

### 2.5 Repeat and dismissal semantics

**Contract today:** "once per conversation on a booking turn whose collected stay reaches
`min_nights`", plus `show_at_init`.

Unanswered: can the init promo and the booking-turn promo **both** fire in one conversation? Does
a transparent 410/404 re-init — which starts a *new* conversation for the same visitor — re-show
the promo? Is a consumer allowed to let the guest **dismiss** the card, and should that be
remembered? There is no `dismissible` flag and no guidance.

A per-visitor frequency statement would let consumers stop worrying about it; right now the
widget deliberately implements no client-side suppression at all and trusts the server, which is
the right default only if the server actually governs it.

---

## Part 3 — `quick_replies`, and cross-cutting items

### 3.1 The one-shot rule is "by convention" and names a trigger nobody implements

**Contract today (RC:241):** "A chip row is one-shot by convention: remove (or disable) the row
once a chip is tapped **or the guest types instead**."

The reference implements the tap trigger only — `submit()` never touches a chip row, so a typed
message leaves stale chips on screen. Widget 2.4.0 currently implements neither (it is adopting
the tap trigger in its 2.5.0 sync).

**Please make this normative and precise:** remove or disable? Does the "guest types instead"
trigger apply to every chip row on screen or only the most recent? What happens to a chip row
whose turn then fails — is it restored? And is it legal for a later `quick_replies` element to
coexist with an earlier row, or does it supersede it?

### 3.2 A consumer cannot tell tenant-authored chips from server-generated ones

**Contract today:** chips come from two sources — the site's `chatbot.quick_prompts` setting
(tenant text, presumably single-language like the promo) and deterministic clarification turns
(server-generated, presumably localized to the guest). **Nothing on the wire distinguishes
them.**

Same problem as 2.1, and the same fix would do: either localize the tenant-authored ones, or mark
them. A consumer that wants to set `lang` correctly, or to decide whether a chip is safe to show
to a French guest, currently cannot.

Also please state a **max item count** (a chip row that wraps to four lines is a UI failure) and
whether **item order is meaningful**.

### 3.3 Elements have no identity, so consumers cannot detect a repeat

Other than `property_cards` item `key` — which has no documented use — no element carries an
`id` or idempotency token. A consumer cannot tell that the promo it is about to render is the
same one it rendered two turns ago, which is exactly what it would need to implement any
client-side frequency capping. Consider an optional element-level `id`.

### 3.4 `integration-guide.md` §4 rule 3 was not updated for `image`

`response-contract.md`'s Security rule was correctly widened at 1.5.0 to cover `image` fields:
"Element-supplied `url` **and `image`** fields … are honoured **only for `http`/`https`**".

**`integration-guide.md` §4 rule 3 still reads "Honor element `url` fields only for
`http`/`https` schemes"** and never mentions `image`. A consumer that integrates from the guide —
which is the file that presents itself as the integration instructions — will not gate image
URLs. That is a live security gap in the docs, not in the code. Please sync the sentence.

### 3.5 Two poll-endpoint error semantics contradict across the packet

- **`404`:** `response-contract.md` says poll resolution failures "mirror the message endpoint";
  `integration-guide.md` §5.1 says explicitly "This is the one error whose handling is **not**
  uniform" and splits them. The guide and the reference are right; the contract sentence is the
  one a reader hits first when looking up poll behaviour. Please carve out the split in the
  contract too, or cross-reference §5.1 from it.
- **`410`:** the guide's error table prescribes a single uniform action, "Re-init transparently".
  The reference widget's `pollResult` just stops polling silently — no re-init. Neither document
  carves the poll endpoint out for `410` the way it does for `404`. Please state the intended
  poll-side `410` behaviour; both consumers currently do what the reference does, not what the
  table says.

### 3.6 Smaller documentation gaps worth closing in the same pass

- **Init `actions[]` composition is unbounded.** "the same element vocabulary" leaves nothing
  ruling out an `async_result` on init — which the reference would poll with no interim bubble to
  replace, adding a stray second bubble on `ready`. Please state which types may appear on init.
- **Where elements sit relative to the reply bubble** is never stated (inside it? below it?
  full-width?). Rich UIs have to answer this; a sentence of guidance would align them.
- **The turn cap has no published number and no programmatic marker.** The guide says "no special
  field, no handling needed" — which is fine for rendering, but a consumer that wants to offer
  "start a new chat" at exactly the right moment has to guess. Consider an optional
  `conversation_ended: true` or similar on the capped reply.
- **No `reply` max length**, and no statement about newlines in it — both widgets rely on
  `white-space: pre-wrap` by convention rather than by contract.
- **`X-Chatbot-Contract`** is documented as CORS-exposed but does not appear in §7's CORS
  inventory, which lists only `allowed_origins`, methods and *request* headers. Please add it to
  `Access-Control-Expose-Headers` in the inventory (or confirm it is already there in code).
- **No accessibility guidance** exists for the three new types — roles, focus order, whether a
  card rail should be keyboard-traversable, whether chips should be announced. The widget made its
  own choices (labelled carousel arrows, arrow-key traversal between card CTAs, decorative dots,
  a dedicated live region for replies). A short a11y note in the contract would keep consumers
  consistent.

---

## Deliverable

1. **`response-contract.md` at 1.6.0**, with: the new optional fields (`price_from.period` and
   `basis`; element-level `more` and/or `total` on `property_cards`; item `cta_label` and
   `image_alt`; whatever you choose for promo localization; optional element `id`), the
   enumerations and max lengths, the localization statements, the missing-required-field policy,
   and the clarified dedupe / one-shot / poll-error wording.
2. **A Changelog row** in the established format, with **Breaking = No** and a **Consumer action**
   cell that is honest about which items are pure documentation and which are adoptable fields.
3. **`integration-guide.md`**: the §4 rule 3 `image` fix (do this even if nothing else ships), and
   any cross-reference the poll-error clarification needs.
4. **`chatbot.reference.js`** updated to match whatever the contract now says — in particular the
   `promo_card` required-field behaviour, the `quick_replies` "guest types instead" trigger, and
   the stale `safeHttpUrl` comment block, which still enumerates only "booking_url / website /
   availability deep-link" while the function now also gates tenant-authored `promo_card` URLs.
5. **Tag it** `chatbot-contract-v1.6.0` so consumers can diff `1.5.0..1.6.0`.

## Hard rules

- Additive only. Optional fields, omitted when absent, never `null`. No renames, no retypes, no
  requiredness changes on existing fields.
- Every new string field that a consumer displays must state whether it is server-localized.
- Every new URL field inherits the `http`/`https`-only rule, and the Security rule must name it.
- Chips still carry no URLs. Do not add one.
- If any item above would require a breaking change to do properly, say so and propose the
  additive approximation instead — the envelope is frozen and a MAJOR should never be issued.
