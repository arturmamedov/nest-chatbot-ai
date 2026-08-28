# Changelog

The widget's own release line. `VERSION` in `nest-chatbot.js` and `window.NestChatbot.version`
are the only version sites — there is no package.json (CLAUDE.md rule 1). Contract syncs track
the vendored packet in `docs/wsuite/`; `BUILT_AGAINST` records which contract each release
implements.

## 2.12.0 — 2026-08-28

**Contract sync: `BUILT_AGAINST` 1.9.0 → 1.10.0 (D-072, D-073).** A **MINOR**, the case reserved
for one: a fresh `docs/wsuite/` packet and a `BUILT_AGAINST` move. Packet:
`docs @ chatbot-contract-v1.10.0 (31ff82b) · widget @ 31ff82b` — the two halves share a sha because
1.10.0 was a real renderer change in the tag commit.

Two contract rows and **no renderer change**. Nothing on screen moved; what moved is the constant,
two comments that had become false, and the harness that can now prove the claim. Yesterday's 2.11.1
entry closed with "**Not asked:** `property_cards` on booking turns. D-069 and D-009 keep it off
deliberately and the dedupe logic assumes it." D-073 landed the next day and removed both halves of
that assumption — which is the whole reason this release is a verification rather than a shrug.

### 1.9.1 — the reply stopped re-listing the options (D-072)

A PATCH with no wire effect. On a Ready turn where every option carries a `total`, the reply now
names at most the cheapest bed and the cheapest whole room and points the guest at the list, instead
of enumerating three-to-six options the widget was already drawing underneath. It asks nothing of a
consumer that draws `options[]` — but it changes what happens to one that does not, and that is the
half worth recording: **the rows are now the guest's only complete view**. This widget has drawn
them since 1.2.0 and grouped and folded them since 2.11.1, so the row is adopted by changing
nothing. It is also why the suppression below had to be re-read rather than assumed.

### 1.10.0 — the hostel card beside the booking element (D-073)

No element and no field is added. A **known** element appears on a turn it never appeared on: the
Ready booking turn may now carry the resolved property's `property_cards` — exactly one item,
**first** in `actions[]` — beside the `availability` or `booking_link` it shares a Book url with.
D-069 had routed every "is it free / price for these dates" question onto the booking path, where
no card had ever been emitted, so the hostel's image, location and from-price had gone missing from
exactly the turns guests ask that on. Per site and off by default (`chatbot.cards.on_booking`):
nothing reaches the wire until a tenant switches it on.

**All three rules the contract asks for already held here, and each was read back out of the code
rather than assumed:**

- **One Book affordance.** `renderActions()` walks `actions[]` in payload order, so
  `renderPropertyCards()` runs first and enters every card that *actually reached the DOM* into the
  per-turn `rendered` set — the D-043(c) rule, enforced by the `renderableCardUrl()` gate the
  pre-scan and the card renderer share. `renderAvailability()` then guards **only** its trailing
  button against that set. The card's CTA survives; the availability button never renders.
- **`booking_link` is deduped the same way, through the other set.** Its branch tests the
  order-independent `cardUrls` pre-scan, identical to `link_button`'s. So both booking elements
  suppress against a rendered card CTA — they simply arrive by different routes, `cardUrls` for
  `booking_link` and `rendered` for `availability`. **That `booking_link` check had never once
  fired in this repo's history**; it was written for reference parity in 2.5.0 and documented as
  dormant. It is live now, and there is a fixture for it.
- **The rows always render.** The options list is built before any dedupe test and nothing returns
  early past it. The reference widget was not so lucky: its `availability` branch returned early
  behind an already-anchored url and lost the rows along with the button — which it had *already*
  been doing on the async poll — and 1.10.0 is the release that fixed it there. This widget put the
  check on the button in 1.6.0 and never had the defect.

**Nothing was normalised, then or now.** `safeHttpUrl()` applies `trim()` and an anchored
`^https?://` test and nothing else. Both dedupes stay raw-string comparisons, which is exactly what
makes them exact: since 1.9.0 the server composes both sides of every pair from the same inputs, so
parsing, lowercasing or stripping a query on either side is the thing that would break them.

### Two comments that 1.10.0 made false

Both were true when written and are the only prose in the file that had to move:

- **`booking_link`'s check was documented as dormant** — "cannot co-occur with cards today (one
  handler per turn, D-009)". D-073 ends that: the booking handler emits the card itself. The comment
  now says what the branch catches and why it uses `cardUrls` rather than `rendered`.
- **`renderAvailability()` called its guard "the ONE contract-scoped interim→poll suppression".**
  There are two cases riding that one `rendered` test now — the poll repeating the interim's Book
  url (1.6.0), and the same-list card CTA that `renderPropertyCards()` entered moments earlier. The
  comment states both, states that the same-list case needs no `cardUrls` pass *because the contract
  puts the card first* (the pre-scan exists for a button that **precedes** its card, which the
  server does not emit), and states why the rows sit outside the guard at all.

**No `cardUrls` argument was added to `renderAvailability()`.** It would change nothing observable
on any conformant payload, and the behaviour is already correct; the reason is now written down
where the next reader will find it instead of being encoded in a parameter list.

### Two fixtures — the pair, both arms

The keyword table gains `cardstay` and `cardbook`, modelled on the reference's lab scenario
`booking-card`. Two and not one, because the suppression travels two different code paths and only
one of them had ever executed:

- **`cardstay`** → `[property_cards (one item), availability]`, card first, the card CTA and
  `availability.url` one byte-identical composed string with a query. Three option groups of one row
  each — a party row (`units: 2`, total as the figure and the per-bed price beneath), a single-unit
  row, and one option the snapshot cannot place (no `basis`/`units`/`total`) in its own unlabelled
  group. Nothing hidden, so no fold button. Exercises `rendered`.
- **`cardbook`** → `[property_cards, booking_link]`, equal urls, and **no `cta_label`** on purpose:
  the card falls back to the pack's "Book now", the same words the suppressed `booking_link` would
  have used, so a regression shows up as two identical buttons rather than something subtle.
  Exercises `cardUrls`.

Both are tested above the `book` keyword, because these are `indexOf` matches and `cardbook`
contains `book`.

### Verified

Headless Chrome over CDP, served from a **fresh port** so nothing was cached, and the running source
asserted for the new keywords before anything was measured — the habit CLAUDE.md records costing a
verification pass once already.

- **`cardstay`**: `wchat:reply` reports `elements: ['property_cards','availability']`; the turn
  contributes exactly **one** `[data-wchat-el]` anchor, `property_card`, carrying
  `…/reservation/Lp7RtQ?checkin=2026-09-14&checkout=2026-09-17&adults=2`. Zero `availability`
  anchors. All three option rows present, two headings, no fold button.
- **`cardbook`**: `elements: ['property_cards','booking_link']`; one anchor, `property_card`, label
  "Prenota ora" from the pack. Zero `booking_link` anchors. **First execution of that branch.**
- **No regressions**: `rooms` still draws eleven rows with one fold and its own Book button (no card
  in that payload); `tenerife` still drops the name-less card, suppresses the "Book now" matching a
  rendered card and keeps "Visit our website" sharing the dropped card's url (the D-043(c)
  isolator); `available` still resolves its poll into exactly one Book affordance; `link` unchanged.
- **Drift warn**: silent with the mock reporting 1.10.0 against `BUILT_AGAINST 1.10.0`. **Positive
  control** — the mock temporarily set to 1.11.0 fired it once, reading "built against 1.10.0",
  which is also how the constant move was confirmed from the outside. Reverted and diffed byte-for-
  byte afterwards.

**Live, off `demo/demo.html` against `nest-mind.laravel.cloud` (2026-08-28 17:28 UTC): the 1.10.0
deploy has NOT landed.** A real init `201` reports `contract_version: 1.9.0`, `idle_hours: 168`,
`server_time` present. A booking turn ("Las Palmas Nest, 14 to 17 September, 1 person") returned
`actions: ['availability']` with thirteen options and **no** `property_cards` — expected twice over,
since neither the deploy nor the per-site toggle is in place. The widget rendered them grouped into
beds and private rooms with one fold button, `La Paz (Private - Double Bed)` correctly showing its
name alone (`price` and `total` both null), and one Book button on the 1.9.0 composed url
`…/it/reservation/AhkCX3?checkin=2026-09-14&checkout=2026-09-17&adults=1`. No console warn, which is
correct: the warn fires only when the **server** is ahead, and after this release the widget is the
one in front. **The pair itself is therefore unverified live and stays that way until the deploy
lands and the owner switches the card on** — the same "deliberately unverified" state the upstream
1.10.0 commit records on its own side.

### Not changed

`docs/rendering-ownership.md` is untouched, and that is a decision rather than an oversight: 1.10.0
moves no text ownership at all. `property_cards` keeps its split (raw catalog `name`/`location`,
server-localized `cta_label`, widget-composed price suffix) and `availability` keeps its ("no display
text" in, every word out). Which elements may share a turn is not a question that file answers.

No `wchat:*` name was renamed, removed or given a new payload field, and `NestChatbot.state` is
untouched — the surface 2.8.2 made public is a **major** to disturb. `wchat:action` fires for the
card CTA and not for the suppressed button, which is the existing information-turn behaviour arriving
unchanged on the booking turn.

## 2.11.1 — 2026-08-27

**The availability card folds: one line per option, beds and rooms grouped, three per group.** A
**PATCH** — new UI behaviour and nothing a host's `<script>` tag has to say: no `data-*` attribute,
no `window.NestChatbot` method, `BUILT_AGAINST` still `1.9.0` and `docs/wsuite/` untouched.

A live booking turn on nestshostels.com (2.11.0, Italian, Las Palmas Nest, **solo** guest,
2026-08-27) came back with **eleven** `options[]` — one per room type × rate plan, which is the
designed output: `StayResolver` puts the basis the guest asked for first and otherwise never caps,
collapses or price-sorts. 2.11.0 printed **two** lines per option, and for `units: 1` the contract
makes `total` equal `price`, so the second line said the first again: `Edinburgh (3 Bed Male) —
44.00 EUR per letto`, then `1 letto · 44.00 EUR in totale`. Twenty-two lines to learn eleven
numbers, under prose that had already named most of them. Re-measured during this release the same
property returned **thirteen** — eight beds and five private rooms — so the count is not an outlier
to design around, it is the shape.

### One line per option, and the figure is the party's

Each option is now a two-column row: the vendor's name, and the one number the guest is asking for.
That figure is `total` when there is a party to pay it — `units` above one, with a `basis` this
build knows — and `price` otherwise, which the contract makes the same string at `units: 1` and the
only one there is without the trio. Still the server's string through `textContent`: no `Intl`, no
arithmetic, and the suites still pin the "never" statically (no `units *`, no `price *` anywhere in
the source).

A party row keeps the composition, once, under the name: `2 beds · 100.00 EUR per bed`. A
single-unit row gets no second line and no unit label at all — the group heading above it says
whether 44.00 buys a bed or a room, which is why a lone labelled group still gets its heading. And
because the contract makes `total` null exactly when `price` is, an option with no rate renders its
name alone rather than half a quote — seen live this release on `La Paz (Private - Double Bed)`.

### Beds and rooms, grouped in the server's order

Options are bucketed by `basis` in **first-appearance** order — never beds-first or rooms-first by
our choice. The server's order is a preference, not an accident, and keeping it is what keeps the
card agreeing with the reply, which was written from the same list. Rows keep server order inside
each group. An option with no `basis`, or a value this build does not know, forms an unlabelled
group rendered exactly where the server put it, as the pre-1.8.0 line — which is what ignoring what
you do not recognise means for a field *value*.

### Three per group, the rest behind one button

`OPTIONS_MAX = 3`, applied **per group**, with one `Show N more` at the foot of the card. Per group
and not per card, and that is the whole point: with eight dorm plans ahead of five privates, a
card-wide cap of any size shows dorms and zero privates — hiding exactly the alternative the
grouping exists to surface.

- **The cut is skipped when it would hide one row.** A group of exactly `OPTIONS_MAX + 1` renders
  whole, because the button is taller than the row it would replace. A side effect worth keeping:
  the hidden count is then never `1`, so `showMore` needs no singular form in five packs.
- **Hidden rows stay in the DOM**, in server order, wearing `.nc-hidden` (`display: none`) — out of
  the tab order and the accessibility tree. Revealing them is a class flip, nothing transitions, so
  `afterRender()` measures a settled layout, and a replay repaints the same card.
- **`afterRender()`, never a scroll.** The fold is the guest's own act; the anchor pad and the ⌄ cue
  are what a height change has to re-measure. No `emit()` either — no UI toggle in this widget
  reports itself, and the button carries no `data-wchat-el`, so the delegated CTA listener never
  sees it. Listener counts outside the root are unchanged: 1 `window`, 3 `document`.
- **`aria-expanded` on the button, and the label changes by `textContent` on the same node** —
  `armMenuConfirm()`'s rule: the guest is standing on it when it changes, and swapping the node
  would drop their focus to `<body>`. The hidden rows hold no focusable node, so hiding them cannot
  strand focus; the day a row grows a link, the collapse branch owes `retireChipRows()`'s recipe.
- **No `aria-controls`**: it would need ids on scattered rows, and the header ⋯ menu ships
  `aria-expanded` alone as the reviewed precedent.
- **Replay comes back collapsed for free.** `persistableActions()` keeps the element verbatim and
  the renderer rebuilds the hidden set per render — no fold state joins the stored record.

### The row is two columns

`.nc-option` is a grid, `minmax(0, 1fr) auto`, baseline-aligned. A wrapping flex row whose first
item is a long vendor name ("Bed in Room 4 (Female with 4 beds)") drops the **figure** onto a second
line, left-aligned under the name — the price under the wrong edge. Two tracks fix the outcome: the
name column takes what is left and wraps its own text while the figure holds the right edge on the
name's first line. `minmax(0, …)` is the load-bearing half — a bare `1fr` never shrinks below
`min-content`. Verified at 360px and at 320px, where this name actually runs out of room.

`.nc-options` now states `max-width: 100%`, which is not tidiness: the card hugs its content,
`.nc-body > *` is `flex-shrink: 0` and `.nc-body` is `overflow-x: hidden`, so without a ceiling a
long name sizes the card past the panel and the figure is clipped rather than reachable.

The figure is 600 / `nowrap` / right-aligned / `tabular-nums`; the sub-line and the group heading
are **`--nc-text`**, not `--nc-text-subtle` — subtle measures ~2.7:1 on the card's `--nc-surface`
grey (the `.nc-day` rule records it), under the 4.5:1 a 12px string meant to be read needs. Size and
weight carry the hierarchy. Seven rules, every one scoped under `#nest-chatbot` and `nc-`-prefixed,
**no `font-family`** — the two-custom-property typography seam still has exactly ten sites.

### The card follows the language switcher

Its headings, count nouns, unit labels and fold label all repaint on `setLocale()`, on cards already
on screen. That is not a new principle, it is the existing one applied: what stays frozen is
**payload** — reply text, server-localized `quick_replies` labels, `promo_card` copy — and for this
element the contract sends no display text at all, only `basis` as a bare enum, with the explicit
instruction to map it to "a localized suffix of your own". So every word on the card is the widget's
own and follows the switcher like the close button; `room` (the PMS's vendor name) and the figures
do not. Three `data-nc-*` stamps carry the payload values the repaint re-derives from, following the
`data-nc-at` precedent, and one `afterRender()` covers the height a relabelled heading can change.

### Packs: four keys in, three out

**In:** `bedsHeading`, `roomsHeading`, `showMore`, `showLess`. **Kept:** `perBed`, `perRoom`,
`bedsMany`, `roomsMany`. **Out:** `stayTotal`, `bedsOne`, `roomsOne` — the singular count keys have
no caller left, because the sub-line exists only for a party above one, and dead keys ship to every
page. Removing a pack key is not a breaking change: packs are internal, and the embed contract is
what a host's `<script>` tag has to say. Still no plural helper — the table is the rule, and German's
plural of Zimmer is invariant, which a rule would have to special-case.

### Fixtures

`rooms` is now the Las Palmas shape: **eleven** options in the server's own order — four `per_unit`
first (the `OPTIONS_MAX + 1` slack path, shown whole), six `per_person` (cut to three), and one type
with no trio last, rendered as the pre-1.8.0 line in an unlabelled group. One keyword now exercises
grouping, first-appearance order, the slack, the cut, the fold, the party figure, the sub-line and
the pre-1.8.0 fallback at once. `available`'s poll fixture is unchanged and becomes the counterpart
proof: one `units: 1` option is a heading, one line and **no** button, because a card with nothing
hidden must not grow a control that does nothing.

### Verified

**Mock — 387 assertions across 13 CDP suites, 0 failures**, served from a fresh port with the HTTP
cache disabled and the source asserted before any result (CLAUDE.md § "The browser will run your
last edit's predecessor"). The harness's `openPanel()` now targets `.nc-toggler`: the widget already
had three `[aria-expanded]` buttons and the fold adds one per card. A new `t14-options.mjs` (90
assertions) covers grouping, heading order, the per-group cut, the slack, expand ⇄ collapse with
focus held on the same node and `wchatLog` unchanged, Enter on the focused button, the 360/320px
grid proof, replay-collapses, the locale repaint of an already-rendered card, and six injected
payloads the fixture cannot reach — an unlabelled group first, no-basis-only cards at six and at
four, five-and-five, `price`/`total` both null, and an unknown `basis` value. The collapse asserts
`scrollTop === min(before, scrollHeight − clientHeight)`: the browser clamps when content shrinks,
so asserting equality would fail on correct behaviour. `t6-scoping.mjs` still passes — the demo
page's own `.hidden` / `.message` / `.chat-header` do not move.

**Live — 89 assertions, 0 failures**, against the deployed tenant through `demo/demo.html`. Init
`201`: `contract_version: 1.9.0`, `idle_hours: 168`, `server_time` present, no drift warn. Las Palmas
Nest, 14–17 September 2026, answered **thirteen** options both times — eight `per_person`, five
`per_unit`. Solo (EN): every row single-line, seven hidden, one `Show 7 more`, and the null-rate
`La Paz` row rendered as its name alone. Party of two (ES): `120.00 EUR` over
`2 camas · 60.00 EUR por cama`, `CAMAS EN DORMITORIO COMPARTIDO` before `HABITACIONES PRIVADAS` in
the server's order, `Ver 7 más`, and the Book href equal to `availability.url` byte-for-byte with
`/es/reservation/`, both dates and `adults=2`.

### Handed upstream

Three items for a `~/Herd/nest-mind` session, written from here and done there
(`plans/widget-availability-fold-prompt.md` § The other half). Nothing moves in the consumer-sync
registry: no contract version changes and `BUILT_AGAINST` stays `1.9.0`.

- **An instruction, not a filter.** `TurnPromptRenderer::modeInstruction()` bounds only the stay
  summary; nothing tells the model the option list is already on screen beside its reply. Ask it to
  name at most the cheapest bed and the cheapest room by `total` and point at the list for the rest
  — keeping the option lines in the context, changing what it is told to do with them. **Worth
  noting from this release's live runs:** both replies already did roughly that, naming only the
  cheapest of each kind. So the ask is to make it *deterministic*, not to stop a duplication that
  fires every time — the 2026-08-27 turn that triggered this listed all eleven, and nothing in the
  prompt currently prevents that.
- **O-59** (order `options[]` by `total` within each `basis`) now has a stated trigger: thirteen
  unsorted plans is where "cheapest first" stops being cosmetic. The widget keeps server order
  inside each group by design, so the day O-59 ships the card sorts itself with no widget change.
- **Not asked:** `property_cards` on booking turns. D-069 and D-009 keep it off deliberately and the
  dedupe logic assumes it.

## 2.11.0 — 2026-08-27

**Contract sync: `BUILT_AGAINST` 1.7.0 → 1.9.0 (D-067, D-071).** A **MINOR**, the case reserved
for one: a fresh `docs/wsuite/` packet and a `BUILT_AGAINST` move. Packet:
`docs @ chatbot-contract-v1.9.0 (6a2c085) · widget @ 6a2c085` — the two halves share a sha because
1.8.0 was a real renderer change in the tag commit.

Three contract rows, one renderer line. **1.7.1** asks nothing: an emission rule — the
`availability` element now also fires on the deterministic Ready turn — and the branch that renders
it has been here since the element existed. **1.8.0** is the line. **1.9.0** is adopted by changing
nothing and stripping nothing, and the audit that proves it is below.

### `basis` / `units` / `total` — the number the guest actually asked for

An availability option may now say what the whole PARTY pays. `price` did not change — it is, as it
always was, the stay total for ONE bed or room — and `total` is `price × units` as the server
computed it, in the same currency; `basis` says what one unit is (`per_person`, a bed in a shared
room; `per_unit`, a whole room) and `units` how many of them the party needs. The three come
together or not at all, and are absent when the PMS snapshot does not know how the room type is
sold.

- **Rendered verbatim, never computed.** The total line is the server's string plus the bare
  currency code, through `textContent` — no `Intl`, no arithmetic. A bed price times a guessed
  party size is a wrong quote on a link that will not honour it, so absent means exactly the
  pre-1.8.0 line. The mock suite pins the "never" statically: no `units *` and no `price *`
  anywhere in the source.
- **A second line under each option, inside the card — not the reference's loose line.** The
  reference renderer draws "2 beds · Mixed Dorm — 200.00 EUR total" as a free-standing line above
  the Book button because it renders no options list at all. This widget already prints one line
  per option, so repeating the room name would state every room twice and float the figure away
  from the price it belongs to. Each option is now a `div.nc-option` block: the price line, which
  gains a `basis`-derived "per bed" / "per room" label (only when `basis` is present — strict
  matches, exactly as `cardPrice()` treats `price_from.basis`), and under it "2 beds · 200.00 EUR
  total" at weight 600. The wrapper is what lets the total sit 2px under *its* price while the
  card's 4px column gap stays "between options".
- **Strict on `basis`.** The guard is the reference's (`total` and `units` present) plus a known
  `basis`: a count with no noun to give it ("2 · 200.00 EUR total") tells the guest nothing, and
  the reply text already carries the same numbers. An unknown value renders the pre-1.8.0 line,
  which is what ignoring what you do not recognise means for a field *value*.
- **Seven pack keys in five packs, no plural helper.** `perBed`, `perRoom`, `bedsOne`, `bedsMany`,
  `roomsOne`, `roomsMany`, `stayTotal` — two nouns × two forms is the whole table, and a helper
  would be a third thing to get wrong for one caller. German's plural of Zimmer is invariant; the
  table says so rather than a rule.
- **One CSS rule**, `#nest-chatbot .nc-option-total`, scoped like every other; `.nc-option` has no
  rule of its own. Nothing interactive was added or removed, so the focus rule has nothing to say.
- **One-line hardening on the way past:** a `null` item in `options[]` used to throw on
  `option.room` and take the whole reply down with it; it is skipped now.

### The booking url carries the stay — adopted by leaving it alone

Since 1.9.0 every booking `url` — `booking_link.url`, `availability.url`, the Book
`link_button.url`, `property_cards[].url` — is composed server-side from the catalog's CloudBeds
code and the collected stay: `https://hotels.cloudbeds.com/{lang}/reservation/{code}?checkin=…&checkout=…&adults=N`,
the language from the turn's locale, dates only when both are known, `adults` only when the guest
stated it. The contract's one instruction is not to parse, normalise or strip it.

- **The audit.** The only transformation this file applies to any url is `safeHttpUrl()`'s `trim()`
  plus the anchored `^https?://` test. The three dedupe comparisons — Book `link_button` vs card
  CTA, `booking_link` vs card CTA, and the async `availability` vs the interim `booking_link` —
  compare raw `action.url` against those trimmed hrefs by plain equality; `wchat:action.url` reads
  the anchor's `href` *attribute*, not the resolved property; the persisted transcript stores the
  action objects verbatim. Nothing splits on `?`, lowercases, or rebuilds a url. The comments at
  those sites now say why raw-string equality is what keeps the dedupes working: the server
  composes both sides from the same inputs, so normalising either side is the thing that would
  break them.
- **`wchat:action.url` now carries the query string.** It is the same string as the anchor's
  `href`, and it reaches a host's analytics with `checkin`, `checkout` and, when the visitor stated
  it, `adults` attached. Contract-correct — element urls are the one string the payload rule lets
  travel — documented in README, and deliberately not "cleaned": stripping it would be exactly the
  normalisation D-071 forbids, and would break a host correlating the click url with the card url.
  No `wchat:*` event was renamed or removed; no payload lost a field.

### Fixtures

`Mock.init` reports `contract_version: '1.9.0'`. `rooms` is the 1.8.0 showcase in one card: a
dorm sold per bed (2 beds, `total` twice the bed price), a private room sold per room (1 room —
the singular path), and a type with no `basis`/`units`/`total` that must render exactly as before.
`available`'s interim `booking_link` and the poll's final `availability` share one composed url
with **no** `adults` — the party was never stated, so the server assumed one (D-068(b)) and the
final's option is `units: 1`, `total == price`; the dedupe must still leave exactly one Book
button. `book` composes from its own summary; `link`'s Book button is the language-only shape a
turn with no stay gets; the tenerife rail's three cards and its matching Book button are composed
strings with a query, so the D-043(c) dedupe is now proven through `?` and `&`. The fixture codes
are the real Nest ones (`uudLs6` Las Eras, `4VPKYG` Médano, `VKSq5o` Ashavana, `R5Sn9T` Duque),
so the demo's Book buttons open the right pages, pre-filled.

### Verified

**Mock**, served on a fresh port with the source asserted first and the harness now bypassing the
HTTP cache — the cache trap bit once more before that: a reload served the pre-edit file and every
new assertion "failed" against code that was never loaded. **277 checks across twelve suites, zero
failures** — the new `t12-contract190` (55) plus the eleven from 2.10.3 re-run unchanged but for
the version literals, the fixture-dependent checks included. The drift `console.warn` stays silent
at 1.9.0, and a **positive control** confirmed it still fires when the mock was temporarily made to
report 1.9.1.

**Live**, against the deployed API at `nest-mind.laravel.cloud` through the gitignored
`demo/demo.html`, every value read off the wire: the init `201` reports `contract_version: 1.9.0`
and `idle_hours: 168`. "I'd like to book Puerto Nest for 2 adults from 14 to 17 September 2026"
answered on the Ready turn with an `availability` element whose three options each carried
`basis: per_person`, `units: 2` and a `total` (`148.00` / `130.00` / `112.00` EUR against bed
prices of `74.00` / `65.00` / `56.00`); the widget rendered "2 beds · 148.00 EUR total" under "Bed
in Room 4 (Female with 4 beds) — 74.00 EUR per bed" — the payload's string — and the Book button's
href equalled `availability.url` byte-for-byte:
`https://hotels.cloudbeds.com/en/reservation/iOPQ1Z?checkin=2026-09-14&checkout=2026-09-17&adults=2`.
No option in that payload lacked the trio, so the absent path is covered by the mock alone. No
contract-drift warn. The same stay in Spanish came back as
`https://hotels.cloudbeds.com/es/reservation/iOPQ1Z?checkin=2026-09-14&checkout=2026-09-17&adults=2`
under "2 camas · 148.00 EUR en total", and opening it showed CloudBeds in Spanish with "Check-in
14 sep 2026", "Check-out 17 sep 2026" and "Resultados de búsqueda para 2 adultos". **26 checks,
zero failures.** One harness lesson worth keeping: `data-locale="auto"` follows the *browser*, and
the first run's "English" turn came back with `/it/` because the headless profile is Italian —
correct behaviour, wrong expectation; the suite now pins the locale it tests.

## 2.10.3 — 2026-08-23

**The device Back button closes the panel instead of leaving the customer's site.** New UI
behaviour, one additive `data-*` attribute and one additive `wchat:close` enum value — all three
named as patch-shaped in CLAUDE.md § Conventions, and additive is never breaking. A **patch**:
minor stays reserved for a contract sync, `BUILT_AGAINST` does not move from `1.7.0` and
`docs/wsuite/` is untouched.

### Why: below 1024px the panel is a screen, and Back is what dismisses a screen

A guest on a hostel's booking page taps the bubble, the panel opens fullscreen, they read a
reply and press Back — and until now that left the customer's site entirely, mid-conversation,
taking the answer they were reading with it. The panel *looks* like a screen at those widths, so
Back is what a phone guest reaches for to put it away. iOS Safari's edge-swipe gesture fires the
same event, so it comes along for free.

It applies at **every** width. Behaviour cannot live in a media query, so a `matchMedia` gate
would be a second source of truth with no stylesheet half to agree with — the same argument
`boot()` already makes about the expanded sheet. On desktop the ✕ is right there and Back is a
redundancy rather than the only route out; that is a smaller cost than two rules.

### This is the widget's first `window` listener, and its only reach outside `#nest-chatbot`

`popstate` fires on `window` and nowhere else. It does not bubble to `document`, there is no
delegation trick, so the standing promise of two listeners outside the root could not be kept.
`teardown()` now unregisters three, and **all five places that vouched for the old count moved
with it** — three comments in `nest-chatbot.js` (the events banner, `teardown()` itself, and
`wire()`'s conversion-event note, which the scoping pass had missed) and two in CLAUDE.md.

**The scroll cue's paragraph was not a number bump.** Its case for having no resize listener
partly rested on "the widget adds no `window` listener at all"; once one exists that argument
is dishonest rather than merely stale. It now stands on the cost/benefit it always actually
rested on — a resize handler earns its keep only by re-measuring every frame of a drag, and the
stale-cue window it would close is the gap the carousel arrows already live with.

Session history is shared, global state the host may already own — about as far outside
`#nest-chatbot` as it is possible to reach. Hence three commitments:

- **`data-back-button`, defaulting to on.** The first opt-OUT boolean in `cfg` (`!== 'false'`,
  where every other flag reads `=== 'true'`), and the asymmetry is deliberate: every other flag
  is a feature a host asks for, this is behaviour a guest already expects. A host whose router
  fights us writes `data-back-button="false"` and gets the pre-2.10.3 behaviour back, with no
  `window` listener attached at all rather than one that no-ops.
- **`pushState` never takes a third argument, and `replaceState` is never called.** The URL does
  not change — no fragment, nothing in the address bar. A fragment would break hosts that route
  on it and turn a dismissible panel into a navigable page; `replaceState` would destroy a host
  entry instead of adding one.
- **`history.back()` fires only when the current entry is demonstrably ours.** If the host's
  router pushed over us the entry is simply left behind: one dead entry is a small cost, and
  walking a customer's app backwards is not a cost we get to impose.

### Two host-framework hazards, and the one guard that closes both

Neither was in the scoping brief. Both were found before shipping, and both are answered by the
same two decisions rather than by special-casing anyone's framework.

- **single-spa patches `pushState` to dispatch a synthetic `popstate`.** The obvious handler —
  `popstate → if (isOpen()) close('back')` — would have slammed the panel shut on the very click
  that opened it, on every single-spa host. `onPopState()` returns early when it is standing on
  our own entry, which is also the right answer for the ordinary case: a host router pushing
  over us and the guest backing onto our entry is the same shape, and that press is not ours to
  eat. Reading the marker as a reason **not** to act is the safe direction — a host who
  `replaceState`s over it drops through to closing, which is exactly the behaviour we would have
  had with no check at all, so nothing rests on the marker surviving.
- **Next.js's App Router hard-reloads the page on a `popstate` whose state lacks `__NA`.** A
  bare `{ ncPanel: true }` marker would have turned "close the chat" into "reload the customer's
  site" the moment one of their routes sat above ours. The pushed state now **clones** the
  host's `history.state` and adds `ncPanel` to it. Our entry is the same URL, so to their router
  it reads as the same route — a no-op — and every host key rides along untouched.

### Three things that look like bugs and are not

- **There is no re-entrancy flag, and none is needed.** Both directions are closed by ordering:
  `close()` removes `nc-open` synchronously before popping, so the `popstate` that follows finds
  `isOpen()` false; and `onPopState()` clears `pushedEntry` *before* calling `close()`, so
  `close()`'s own pop is a no-op and cannot navigate the host backwards. A flag set and cleared
  inside `close()` would be long gone by the time an async `popstate` ran. The code says so, at
  length, because the next reader will otherwise add one.
- **`history.length` neither grows nor shrinks across a cycle.** A push at a non-tip position
  truncates the forward entry, so length stays flat while the cursor moves. Measured: fresh tip
  `len 1 / idx 0` → open `2 / 1` → close `2 / 0` → re-open `2 / 1`. The cursor is what proves
  the entry is real; length alone cannot.
- **`teardown()` removes the listener and deliberately does not pop.** It is reached from a live
  `403`, not from `close()`, so the panel can still be open — and a widget being destroyed must
  not navigate the page on its way out. The entry is orphaned, and the cost is stated rather
  than hidden: one Back press then appears to do nothing before the next one leaves.

### Back closes the whole panel; Escape, since 2.10.2, closes only the ⋯ menu

The divergence is deliberate and the reason is mechanical rather than aesthetic. Closing just
the menu would consume the history entry backing the panel, leaving the panel open with nothing
behind it — so the guest's *next* Back press would leave the customer's site. Correcting that
needs a re-push, and a widget pushing history entries to keep a one-item dropdown alive is not a
trade worth making. `close()` already takes the menu and its primed confirm with it.

### The one known limitation, and it is the browser's rule rather than ours

Chromium marks a history entry skippable **by the back/forward UI** when the document has
received no user activation. A panel opened by `data-auto-open` pushes exactly such an entry, so
Back may step over it and leave the page — the behaviour this release exists to remove.

It is far narrower than it sounds, and both halves of the rule are worth stating because each
was assumed wrong at some point in this work. Activation counts whether it arrives **before or
after** the push, so any tap anywhere on the page — including the one that opens the panel —
retires the caveat for that document. And the intervention applies **only** to the back/forward
UI, never to the `history.back()/forward()` APIs, so the widget's own stack-balancing pop is
never affected by it. The only losing case is `data-auto-open` with a guest who taps nothing at
all and then presses Back.

**Stated from Chromium's own documentation, not measured.** CDP cannot press the browser's Back
button, and `Page.navigateToHistoryEntry` is a programmatic call the intervention explicitly
does not apply to — so the harness confirms the auto-opened entry is pushed and behaves
correctly, but cannot exercise the skip. README and CLAUDE.md carry it as a caveat, not a claim.

### Verified

**Mock only** — nothing here touches the API. Served on a fresh port with the source asserted
first. **222 assertions across eleven suites, all passing**, including the five that need the
documented temporary fixture edits (`Mock.init`'s `actions: []` for the fallback pills, a bumped
`contract_version` for the drift-warn positive control). 53 of them are new, in `t11-back.mjs`.

The cache trap bit once and the source assertion caught it: a warm cache kept serving the
pre-edit file after those two fixtures were changed, making two documented fixture-dependent
tests look like regressions from this release. A fresh port cleared it, and both passed.

Of the new checks, the ones worth naming: the stack stays balanced across ✕, Escape, the
launcher, `NestChatbot.close()` and Back itself, and across ten mixed cycles; a `popstate`
landing on our own entry leaves the panel open, both synthetically and via a real host entry
pushed above ours; the pushed state carries the host's `__NA` and every other host key alongside
our own marker; the URL is unchanged by the push; Back with the panel **closed** navigates the
host page normally, so a press that is not ours is never swallowed; focus after a Back-close is
on a visible node inside `#nest-chatbot`, never `<body>`; the ⋯ menu goes with the panel and its
primed confirm resets; `data-back-button="false"` pushes nothing, writes no marker and pops
nothing; and `destroy()` with the panel open neither navigates nor pops, with a later Back press
hitting no live handler. The other ten suites are unchanged, `t10-menu` included.

The demo page gained a `?nc-back=off` knob, and its first placement was wrong in a way worth
recording: an inline script placed **above** the widget tag cannot reach it, because
`nextElementSibling` is null while the parser is still sitting on the knob — the attribute was
never set and the opt-out silently did nothing, which the suite caught. It sits below the tag
now, which still runs first because `defer` executes after parsing, and the comment says why.

## 2.10.2 — 2026-08-23

**A ⋯ menu in the panel header, carrying "Start a new chat".** New UI behaviour and nothing
else: no `data-*` attribute, no `window.NestChatbot` method, nothing a host's `<script>` tag has
to say. A **patch** by the rule in CLAUDE.md § Conventions — minor stays reserved for a contract
sync, and `BUILT_AGAINST` does not move from `1.7.0`.

### Why now: waiting was never a reliable reset, and is about to stop being one at all

Until 2.10.0 the widget expired its stored conversation after a hardcoded 24 hours, so a guest
who abandoned a thread got a clean slate by morning and "start over" was never something they
had to ask for. 2.10.0 handed that window to the server, and `nest-mind`'s config carries
`WSUITE_CHATBOT_IDLE_HOURS=168` — **seven days**. When the platform deploys 1.7.0 the widget
will follow it, and a week-old thread will replay in full on the next visit.

**Not yet, and the distinction is the one 2.10.1 exists to correct.** Measured against the live
deployment on 2026-08-23, `nest-mind.laravel.cloud` still reports `contract_version: 1.6.2` and
sends no `idle_hours` at all, so today the widget degrades to its 24h fallback exactly as
designed. Do not re-derive the window from `nest-mind`'s env — that is the *local* repo's
config, not the deployed instance's.

The gap is what makes this release worth shipping now rather than after that deploy. Today the
two windows agree at 24h, so a guest's record and the server's conversation lapse together and
the reset is real if slow. **After the deploy they stop agreeing for anyone still on an older
widget**: the server's conversation stays live for a week — still holding the working memory
`data-property` seeded — while the guest's own record has expired, and the guest cannot tell. So waiting has never been a reliable reset, it is about to stop
being one entirely, and there has never been a guest-initiated way to ask for a fresh thread.
The only restart affordance was the button `endConversation()` paints after the *server* kills
the conversation at its turn cap — a dead-end recovery, not a control.

> **Resolved later the same day; the whole section above is left as written because it was true
> when measured.** The platform deployed 1.7.0 — measured 2026-08-23 20:56 UTC the init `201`
> returns `contract_version: 1.7.0` and `idle_hours: 168`. The forecast held in its main claim
> (the widget followed the server without changing, so a week-old thread now replays in full) and
> **missed in its worry**: "after the deploy they stop agreeing for anyone still on an older
> widget" needed an older widget in the field, and there was none — `nestshostels.com` serves
> `2.10.3`. What the deploy actually left behind is narrower: records written *before* it carry
> `idleHours: null` and are judged at the 24h fallback for up to a day. The standing statement of
> the live window is CLAUDE.md § Open items, anchored to a `201` rather than to an env file.

- **The button is leftmost of the three**, so ✕ keeps the corner every guest reaches for and ⤴
  keeps its position relative to it. Below 1024px ⤴ is still absent and the header reads ⋯ ✕ —
  which is where the menu matters most: the panel is fullscreen there and a phone guest has no
  other route. It is a 44px thumb target at those widths, like the ✕ beside it.
- **Two-step confirm, inside the menu.** From the header this is reachable *mid-conversation*,
  which the ended-state button never was: `restartConversation()` clears the store and wipes the
  body, so a mis-tap eight turns into a booking question has no undo. The first activation swaps
  the item's label and leaves the menu open; the second restarts. **Every dismissal reverts it**
  — Escape, a click outside, a second tap on ⋯, the panel closing — so nobody comes back to a
  primed "Yes". A state change on one item rather than a dialog, which is why it needs no modal,
  no scrim, no focus trap and no third document listener. The ended-state button stays one-tap:
  that conversation is already dead.
- **`wchat:restart` gained `source`** — `menu` | `ended`. Additive. It separates a guest
  *choosing* a fresh thread from one who ran into the turn cap, and those call for opposite
  responses. `README.md` § Measuring it and the events proposal both carry it.
- **One item.** The language switcher stays beside the composer, where the choice is about what
  you are *about to type*. The menu is the container that makes a second item a patch later.

### Escape now closes the menu, not the panel

**The one thing here a returning guest could notice as *different* rather than new.** With the
menu open, Escape dismisses the menu and returns focus to ⋯; the panel stays open. With no menu
open it closes the panel exactly as before. The language popover deliberately keeps the old
behaviour — changing it is a second behaviour change nobody asked for.

No new listener outside `#nest-chatbot`: the menu joins `onDocumentClick` and
`onDocumentKeydown`, so `teardown()`'s claim that the widget attaches exactly **two** stays
literally true.

### Three restart races the menu made reachable

`restartConversation()` already did all the wipe-and-reset work, so most of this release is
exposure. These are not. All three were unreachable while the ended-state button was the only
caller — by then the conversation was over, the queue was empty and the intro was long spent —
and every one of them is silent rather than loud.

- **An in-flight turn landed in the new conversation.** `API.send`'s callback guarded on
  `removed` only, so the old conversation's reply cleared `busy`, pushed itself into the **new**
  transcript, painted a bot bubble under the fresh greeting and persisted it: an answer to a
  question the new conversation has no record of and the server's side of it never saw. The turn
  callback now takes the same `chatEpoch` guard `pollResult()` has always used, **before**
  `busy` — clearing it there would release a turn the guest had since sent. `restartConversation()`
  releases `busy` and empties `sendQueue` itself.
- **A restart during init adopted the abandoned conversation's uuid.** `startConversation()`
  queues behind an in-flight init rather than firing a new one, so "start a new chat" silently
  continued the old chat, with two greetings on screen. The init callback takes the epoch guard
  too — checked *before* it takes the waiter list, or a stale callback would null the new init's
  waiters and the restart's greeting would never paint — and the restart releases `initWaiters`.
  The cost is one abandoned server-side conversation per restart-during-init, which is the right
  trade.
- **A restart mid-intro painted a second greeting.** `restartConversation()`'s own comment says
  it deliberately does not replay the intro because the latches "stay spent" — true by luck, not
  by construction: mid-intro `intro.settled` is still false, and the animation's deferred
  `introMaybeFinish()` lands after the restart's callback and paints a greeting beside it. The
  latches are spent explicitly now, and the loader is taken out if it never got its exit.

### Verified

**Mock only** — nothing here touches the API. Served on a fresh port with the source asserted
first (CLAUDE.md's cache trap has already cost this repo a pass). **164 assertions across eight
suites, all passing**, plus the five that need the documented temporary fixture edits
(`Mock.init`'s `actions: []` for the fallback pills, a bumped `contract_version` for the
drift-warn positive control).

Of the 56 new checks, the ones worth naming: Escape closes the menu and leaves the panel open
with focus back on ⋯; the confirm reverts on all four dismissal paths; a **keyboard** restart
leaves `document.activeElement` on a visible node inside `#nest-chatbot`, never `<body>` and
never stranded in the hidden menu; priming swaps `textContent` without moving focus; `setLocale`
repaints both the ⋯ label and the item **while primed**; a restart with a turn on the wire
produces no reply, no stale bubble and no wedged composer; a restart during init paints exactly
one greeting and the stored uuid is the live one. The scoping suite re-confirms the demo page's
appearance is byte-identical with the widget stylesheet on and off — a header change is exactly
the kind that reaches for a bare element selector.

## 2.10.1 — 2026-08-23

**The close-out of the 1.7.0 sync.** No contract surface moved: `BUILT_AGAINST` stays `1.7.0`
(it moves only during a sync), the vendored packet is untouched, and the eleven `wchat:*` events
and `window.NestChatbot`'s methods are byte-identical. A patch by the rule in CLAUDE.md
§ Conventions.

### Documentation 2.10.0 falsified and did not update

A release that changes what is true has to change everything that says otherwise. 2.10.0 updated
CLAUDE.md, this file and `message-timestamps.md`, and missed three places:

- **The day-separators banner in `nest-chatbot.js` still said the opposite of the code.** It
  asserted *"THE CLOCK IS THIS BROWSER'S"*, that *"the response contract carries no time field
  of any kind"*, and that *"a replay shows the SENDING browser's clock"* — all three falsified by
  the same commit that vendored `server_time` and routed every stamp through `nowMs()`. It sat
  ~1450 lines below `nowMs()`'s own header, which says the reverse, and it is the first thing
  read before touching day separators. Rewritten to state what survives: not device-clock skew,
  which `server_time` removed, but the **timezone** case alone — `dayKey()` takes local midnight
  in the device's zone, and `server_time` corrects the instant, never the zone.
- **`CLAUDE.md` dated the 1.7.0 packet to the 1.6.2 sync.** *"Current packet: synced
  2026-08-19"* survived as context while the SHA pair beside it moved. A packet whose contract
  header reads 2026-08-21 cannot have been synced on 08-19.
- **`visitor-measurement-and-events.md` § The ask upstream still opened** *"Neither item below is
  implemented; both are requests"* — two lines above a heading reading **SENT, AND GRANTED**.

Also: the `410`/`404` re-init comment still measured the wedge it warns about in a fixed 24h
(the record's own window now, so a week on the current deployment); a paragraph break lost in
CLAUDE.md's demo section had welded the `?nc-idle` note onto an unrelated sentence; and the
`?nc-idle` worked example disagreed with CLAUDE.md's (`0.0005`/2 s vs `0.005`/18 s — now 18 s in
both).

### Two hardening fixes

- **`restartConversation()` carried the dead conversation's clock offset into the new one.** It
  resets an explicitly-enumerated list of per-conversation state and `serverOffset` was not on
  it. `serverIdleHours` self-heals because init reassigns it unconditionally; the offset does
  not, because it is only written when a `201` actually carries `server_time` — so a restart
  whose re-init omits the field, or fails outright, kept stamping on the old correction. That
  contradicted 2.10.0's own "one offset per conversation". One line, in the reset block where it
  belongs.
- **A whitespace-only `quick_replies.heading` is now read as absent.** `"   "` is truthy, so it
  painted a blank full-width row *and* — the part that matters — became the chip group's
  `aria-label`, replacing a meaningful generic accessible name with an empty one. The reference
  renderer has the same hole; a tenant-authored string is exactly where a stray space arrives.
  Guarded with `.trim()`, which fixes both in one place.

### Verified

**Mock**, on a fresh port with the served source asserted first (the cache trap in CLAUDE.md
has already cost this repo a pass). The headed welcome row carries the heading as a **child**
at `flex-basis: 100%`, `aria-hidden` on the visible copy and the heading string as the row's
`aria-label`; the unheaded row keeps the generic name. Tapping a chip took **both** rows and
the heading with them — zero `.nc-chip-head` left anywhere in the document — and focus landed
on the composer, never `<body>`. A whitespace-only heading now renders **no** head node and
leaves the generic `aria-label` intact; a heading with zero valid chips mounts **nothing**.
The stored-window rule was exercised three ways through the replay path: 30 h old with a
stored 168 h window **resumes** (the exact case 2.9.0 got wrong), the *same* age with no
stored window **drops** on the 24 h fallback, and 200 h old against a stored 168 h window
**drops**. Restart still wipes cleanly, re-inits, and writes a fresh offset.

**Live**, against the wSuite deployment — and the finding matters more than the checks:
**the server is still on `contract_version: 1.6.2` and sends neither `idle_hours` nor
`server_time`.** So this release's absent-tolerance is what actually got exercised, and it is
exact: a real conversation, a real turn and a real reply, with `idleHours: null` and
`clockOffset: 0` written at init and **still** null/0 after a turn on a resumed session —
pre-1.7.0 behaviour byte-for-byte, with no drift `console.warn` (correctly: a server *behind*
the widget is not a drift condition, guide §3.1). A positive control built outside the repo,
with `BUILT_AGAINST` forced to `1.5.0`, fired the warn on cue. **`idle_hours` cannot be
confirmed on the wire until the platform deploys 1.7.0** — see CLAUDE.md § Open items.

> **Confirmed 2026-08-23 20:56 UTC**, after the platform deployed: the init `201` carries
> `contract_version: 1.7.0`, `idle_hours: 168` and `server_time`. This release's absent-tolerance
> was the right thing to have shipped — it is what carried the widget across the deploy — but it
> is no longer the path being exercised in production.

## 2.10.0 — 2026-08-22

**Contract sync: `BUILT_AGAINST` 1.6.2 → 1.7.0 (D-050).** A **MINOR**, the case reserved for
one: a fresh `docs/wsuite/` packet and a `BUILT_AGAINST` move. Packet:
`docs @ chatbot-contract-v1.7.0 (2b9da82) · widget @ 2b9da82`.

**All three fields this repo asked for upstream, delivered in one contract release** — and
unlike 2.9.0 this one is not a constant move. Two of the three change behaviour, and one was a
**live defect**.

### `idle_hours` — the widget stops guessing the window

`IDLE_MS` was a hardcoded 24h whose comment claimed it "mirrors the API's conversation idle
window". It mirrored nothing: it was a constant that had to be moved by hand every time a
deployment changed its config, and it could not see that happen. **It was already wrong.**
`nest-mind` carries `WSUITE_CHATBOT_IDLE_HOURS=168`, and the live init `201` returns
`idle_hours: 168` — a seven-day window. Under 2.9.0 a guest returning at hour 30 lost their
transcript on screen **and opened a second conversation while the server's original was still
live**, still holding the working memory `data-property` seeded. Nothing errored; the widget
answered as a stranger.

- **The window now comes from the server and rides the stored record.** Reading it at init is
  not enough and the half-fix looks finished: `readStore()` runs at **boot**, and a guest inside
  the window resumes *without ever calling init* — so the one visit that needs the server's
  number is the visit that never receives it. `storedIdleMs()` judges each record by the window
  it was written under.
- **The resume branch restores it into state, and that is load-bearing.** `persist()` is the
  single writer and serializes current state with no arguments, so a resumed session that did
  not restore the window would write `null` over it on its **first turn** — reverting to 24h on
  the next boot, the same defect one turn later.
- **Absence stays normal in both directions.** An older server sends no `idle_hours`; a record
  written before this release has no field. Both fall back to `IDLE_MS`, which survives as the
  fallback and nothing else.

### `server_time` — one clock correction per conversation

The day separators (2.8.1) stamp each entry client-side because nothing in the guest API dates
a message. `server_time` gives one offset per conversation, `Date.parse(server_time) -
Date.now()`, applied through a new `nowMs()`.

- **The offset is persisted too**, for the identical reason as the window: without it a resumed
  session writes *uncorrected* stamps into a transcript whose earlier entries are corrected,
  which is worse than being consistently skewed.
- **Corrected time for dates, raw time for durations.** `nowMs()` stamps the transcript's `at`,
  the day separators and `dayLabel()`'s "today". `latencyMs`, the poll give-up deadline, the
  teaser timers and the record's own `ts` stay on raw `Date.now()` — they measure one device
  against itself, where skew cancels.
- **What it does not fix, unchanged:** the timezone case (a guest who changes zone still sees
  days recomputed) and the absence of a per-turn timestamp. `docs/proposals/message-timestamps.md`
  is now the design record for what the widget does rather than an open request.

### `quick_replies.heading` — open point 9, delivered

A chip row can finally say what it is asking. Rendered via `textContent`, like every payload
string.

- **Inside the row, never a sibling**, and that is structural rather than tidy:
  `retireChipRows()` removes the row element and nothing else, so a detached heading would
  outlive its chips and strand a question over a transcript that has moved on. One CSS rule
  (`flex: 0 0 100%` on `.nc-chip-head`) buys it its own line inside the flex row.
- **The empty-row guard had to change with it.** `row.childNodes.length` stopped meaning "has
  chips" the moment the heading became a child — a row whose every item was malformed would
  have mounted as a lone question with nothing to tap. Chips are counted now.
- **The heading is the row's accessible name** when present; the visible copy is `aria-hidden`
  so it is not announced twice. Absent still means bare, and substituting a label of our own is
  still wrong — the 2.4.2 decision stands, and this field is what replaces the gap rather than
  what licenses filling it.

### Fixtures

`Mock.init` now serves `idle_hours`, `server_time` and `contract_version: '1.7.0'`, and the
island-chips fixture carries a heading — shared by the welcome row and the `hostel` reply, so
one fixture exercises both mount paths. **`?nc-idle=<hours>` on the demo URL overrides the
fixture's window**, which is the only way to get one short enough to cross on purpose: a real
server's smallest step is an hour.

Verified — mock, 106 checks across seven suites, zero failures, including the eleven `wchat:*`
event names and payloads (untouched by this release) and the demo-page CSS-scoping check. The
drift `console.warn` stays silent at 1.7.0, and a **positive control** confirmed the detector
still fires when the mock was temporarily made to report 1.7.1.

Verified — **live**, against the wSuite app on the real API, 21 checks, zero failures: the init
`201` carries `idle_hours: 168` and `server_time`; the record stores both; a real turn and then
a **resumed** session's turn both leave the window intact; the server's own `heading` renders
inside the row with the right accessible name. And the bug itself, three ways: a record last
touched **30 hours ago survives** on the server's window, **is dropped** when the stored window
is removed (the 24h fallback, intact), and **is dropped at hour 200**, past the server's.

## 2.9.0 — 2026-08-19

**Contract sync: `BUILT_AGAINST` 1.6.1 → 1.6.2 (D-047).** A **MINOR**, and the only case
reserved for one: a fresh `docs/wsuite/` packet and a `BUILT_AGAINST` move. Packet:
`docs @ chatbot-contract-v1.6.2 (d01382b) · widget @ 712c2c5`.

**No renderer changed, and that is the correct outcome.** 1.6.2 is a PATCH with **no wire
effect** — no new element, no new field, no new request parameter. What changed is *when the
server emits* `property_cards`: a card now requires a **this-turn** signal (the guest named the
hostel, referred to one, asked by island, or is on a `data-property`-seeded page). A property
the server merely *remembered* from an earlier turn no longer emits one — which is the bug it
fixes: a hostel named on turn 4 kept its card under every later answer, including questions
about other islands, masking the island carousel the guest had actually asked for.

- **The one thing the sync did change is a comment, and it was worth the sync on its own.**
  `renderActions()`'s dedupe pre-scan deliberately ignores `CARD_MAX`, and its stated reason was
  that "the only payload where the dedupe can fire is the resolved-property turn, whose card set
  is **always exactly one**". D-047's second half ends that: a turn naming several hostels now
  emits one card each. The code is unchanged and still correct, but its justification is now a
  **bound rather than an impossibility** — divergence needs a payload with more than `CARD_MAX`
  cards *and* a `link_button` matching one past the cap, i.e. a guest naming nine hostels in one
  message. Stated in the comment, including what would make it real, because the next contract
  that widens what can emit a rail is the one that has to cap that scan.
- **The rail itself needed nothing**, confirmed rather than assumed. `renderPropertyCards()`
  loops to `CARD_MAX` and gates the dots on `count > 1`; the CSS is `display: flex` with
  `flex-shrink: 0` cards and carries no `:only-child` or nth-child rule. A named-property turn
  carrying two cards renders as a two-card rail with two dots, which is what it should do.
- **The mock now reports `contract_version: '1.6.2'`**, mirroring a real server rather than
  freezing at the version the fixtures were written against.

Verified: the drift `console.warn` no longer fires — and, because absence proves nothing on its
own, a **positive control** confirmed the detector still works, emitting "server response
contract 1.6.3 is newer than this widget (built against 1.6.2)" when the mock was temporarily
made to report ahead. The 2.8.2 event suite re-ran green (78 checks) against 2.9.0, so the sync
disturbed nothing. **Not verified here:** the four emission-behaviour checks in the upstream
sync prompt's Step 2 need a live server — the local fixtures cannot exercise a server-side
emission rule, by definition.

## 2.8.2 — 2026-08-19

**The widget can now be measured, and still never phones home.** Eleven named DOM events on
the widget's own root — `wchat:ready`, `open`, `close`, `message`, `reply`, `action`, `error`,
`ended`, `restart`, `locale`, `teaser` — plus `NestChatbot.state`. A host's existing GA4 /
Plausible / Matomo listens and decides what to keep. Additive, so a **patch**: no `data-*`
attribute, nothing new for a host's `<script>` tag to say, and a page that listens to nothing
pays nothing. No transport change, so `BUILT_AGAINST` stays **1.6.1**.

The question was "returning guests vs new ones", and the finding that shaped the answer is
that **the server cannot tell**. Init takes exactly two optional fields, `locale` and
`property` (guide §3.1) — there is nowhere to put a visitor identity. The only per-visitor
signal on the platform is key + client IP (§6), and §6 names "a hotel's own wifi" as a case
where strangers collapse into one bucket; our guests are mostly on property wifi. A `410`
re-init creates an unrelated conversation. The platform sees conversations, not people — so
anything counting people has to start in the browser, which already knew the answer and had
no way to say it.

- **The returning-guest signal is two facts, not one, and they answer different questions.**
  `wchat:ready` carries `returning` — this browser arrived with a live conversation — read at
  boot from its own `readStore()`, so it is true even for a guest who never opens the panel.
  `wchat:open` carries `resumed`, latched inside `playIntro()`'s replay branch, so it reports
  the branch **actually taken** and cannot disagree with what the guest saw. Collapsing them
  would have lost the denominator, which is the half the question was really about.
- **Nothing the guest or the assistant wrote ever leaves.** Payloads are counts, enums and
  booleans: `length` is a character count, `elements[]` lists element *types*. Element urls
  are the one string that travels — a server-supplied href the guest is navigating to,
  already in the DOM — and `contact_channels` is excluded even from that, because its href
  **is** the property's phone number or email. Verified against the `!xss` fixture: the
  hostile reply, the `javascript:` url and the guest's own text appear in no payload.
- **Two dispatches per event**, `wchat:<name>` and a bare `wchat` carrying `name`. The
  umbrella is what makes "add an event later" free for a host who wired one listener; a host
  who wires both counts everything twice, and README says so. Every name is a commitment —
  adding one is a patch, renaming one is a major, which is why the list was settled before
  the first one shipped.
- **The namespace is `wchat:` and the rest of the vocabulary deliberately did not move.**
  These events are new surface, so they took the vendor-neutral name this widget is heading
  towards, for free. `window.NestChatbot`, `#nest-chatbot`, `nc-` and `STORE_KEY` stay put:
  that rename is a 3.0.0 with real host cost — breaking by this repo's own rule, and a
  `STORE_KEY` change would drop every guest's live conversation at deploy. One sentence in
  README explains the mixed vocabulary until then.
- **The trap this change could have shipped silently.** `open()`, `close()` and `toggle()`
  now take a `source`, and three `wire()` listeners passed them **bare** to
  `addEventListener` — which hands a handler a `MouseEvent` as its first argument. So does a
  host writing `btn.addEventListener('click', NestChatbot.open)`. Every source would have
  reported as an object while everything on screen kept working perfectly. Fixed on both
  sides: the listeners and the runtime-API methods are wrapped, and `oneOf()` validates
  against an enum regardless. Tested by doing exactly what a host would do.
- **`wchat:error` reports what was previously invisible** — 401/403/429/5xx and transport
  failures, none of which reach the screen as anything but a generic bubble. `retrying: true`
  marks the `410`/`404` re-init, which is normal and not a guest-visible failure; a *spike* in
  it is the signal that the server extended its idle window and `IDLE_MS` did not follow. The
  403 fires **before** `teardown()`, since `emit()` is a no-op once the widget is removed —
  otherwise the one error a host most needs (a revoked key, an unregistered origin) would be
  the one they never see. Poll `404`s during backoff emit nothing: that is the backoff
  working, and reporting each would drown the real errors.
- **An async turn fires `wchat:reply` twice**, truthfully — the guest saw two answers land.
  `resolved` separates them and carries the full poll latency, which is the number worth
  having for gated booking turns.
- **One delegated click listener, not one closure per anchor.** The four CTA renderers tag
  their anchor with `data-wchat-el` and `wire()` reads it back from `els.body`; a replayed
  40-turn transcript can carry dozens of them, re-created on every replay. It lives inside
  `#nest-chatbot`, so `teardown()`'s two-listener claim is untouched — and dispatching from
  `els.root` rather than `window` is what keeps that claim honest for the events themselves.
- **What this cannot answer, recorded rather than discovered later.** Cross-device is
  permanently two visitors. Cleared storage is invisible. The data lands in each host's
  analytics, not in wSuite's panel. And "came back after the window" is bounded by `IDLE_MS`
  — 24h today, and the ask that fixes it is `idle_hours` in the init response, not a
  persistent visitor token (CLAUDE.md § Open items has both, and why the token is deferred).

The design record — why route A won over an upstream visitor token, what each event can and
**cannot** answer, and the unsent `idle_hours` ask — is
`docs/proposals/visitor-measurement-and-events.md`. README carries the host-facing reference.

Verified in headless Chrome on a fresh port with the source asserted first: 78 checks across
boot, the return path, every `source` enum, the four CTA types, the error branches, the cap
and restart, the teaser, `!xss`, and `destroy()` silence. The network tab shows no request the
widget did not already make — and the diff adds no `fetch`, `XMLHttpRequest`, `sendBeacon` or
`Image` at all, which is the stronger form of that claim. `css/nest-chatbot.css` is not in the
diff, and the demo page's computed styles are identical with the widget stylesheet on and off.

## 2.8.1 — 2026-08-19

**When the day turns, the transcript says so.** A centred pill lands between two turns whenever
the calendar day changes — `Today`, `Yesterday`, `Monday, Aug 17` inside the last week, then a
plain `18/08/2026` — and every bubble carries its full date and time as a `title`. New UI
behaviour and a new stored field, which is a **patch**: no `data-*` attribute, no
`window.NestChatbot` method, nothing new for a host's `<script>` tag to say. No transport
change either, so `BUILT_AGAINST` stays **1.6.1**.

2.8.0 gave a returning guest their conversation back; this is the half that was missing. That
replay is seamless by design, so the panel could open on yesterday evening's conversation with
nothing on screen saying any time had passed. The gap grows with the idle window — 24h today,
heading for a week or more, at which point "some earlier day" stops being the edge case.

- **Nothing in this system records when a message happened.** The response contract carries no
  time field of any kind, and the record's own `ts` has meant *last activity* since 2.8.0 —
  rewritten on every turn, so it cannot date one. Entries are stamped client-side instead, as
  `at` (epoch ms), at the four sites where an entry is born. Two consequences worth stating
  rather than hiding: a replay shows the **sending** browser's clock, and a guest who crosses a
  timezone between visits sees the days recomputed in the new zone. Day granularity is what
  makes that acceptable — minutes of skew never move a date, and only a timezone hop does. It
  would not survive a visible per-message clock, which is the main reason there isn't one. The
  stored value would support one tomorrow.
- **`at`, deliberately not a second `ts`.** The record already has a `ts` one level up meaning
  something else entirely, and two fields answering to one name across a single nesting level
  is a trap rather than a convenience.
- **No pill above the first message, ever.** Pills mark transitions; the day of the first
  message is set silently. A fresh conversation would otherwise open under a "Today" telling
  the guest what they already assume. What pays for the omission is the `title` on every
  bubble — the exact date is on that first one either way, which is why the two shipped
  together rather than separately.
- **The weekday tier carries a short month for word ORDER, not for information.** Inside a
  seven-day tier the month can only be this one or last. But ask `Intl.DateTimeFormat` for
  weekday+day alone and bare `'en'` resolves to the en-US skeleton, which emits **"17 Monday"**.
  Every other shipped locale is fine, and so is `en-GB` — which is exactly what makes it easy
  to ship without noticing. Adding `month: 'short'` makes CLDR compose a real pattern instead:
  "Monday, Aug 17", "lunes, 17 ago", "lunedì 17 ago", "Montag, 17. Aug.", "lundi 17 août".
- **A record written before this has no `at`, and paints nothing from it** — no pill, no title,
  and it does not advance the day being compared against. Inventing a day from the record's
  last-activity `ts` would put a guest-facing claim on screen with no evidence behind it; the
  silence costs one pill and heals itself on the next real turn. Same posture 2.8.0 took: old
  records lack the new field and degrade, there is nothing to migrate.
- **An async turn keeps the time its interim reply arrived.** `pollResult` replaces that turn's
  text and actions in place and leaves `at` alone — which is both the zero-code default and the
  right answer. A poll resolving after midnight would otherwise walk its turn's day forward
  past a pill already painted above it, and the record would disagree with the screen on the
  next reload.
- **The pill is what a send anchors, not the bubble.** When the guest's own message opens a new
  day, `anchorSend()` takes the separator, so pill and message ride to the top of the panel
  together — measured at 19px and 57px from the top, against a 506px body. A pill painted and
  scrolled out of view in the same tick would announce the day to nobody. It costs the reply
  ~26px of room, once per day, and the transcript still moves exactly once per turn: scrollTop
  held at 2553 across the whole reveal and every card that followed it.
- **Three rebuild sites had to learn the field or lose it.** `validTurns()` rebuilds every entry
  on read — deliberately, so a tampered record cannot smuggle keys back into the next
  `persist()` — which makes a new field opt-in; miss it and timestamps die on every reload.
  `boundedRecord()` rebuilds twice more when it sheds an old turn's payload, and missing those
  loses timestamps only past 64KB, which the mock cannot reach. Both branches verified against
  the shipped function: 9 turns thinned, `at` intact on all 40 kept.
- **Date arithmetic through `Date`, never through milliseconds.** Subtracting 86400000 is wrong
  on both DST days a year and says nothing about month ends; `setDate()` normalises all of it.
- **`--nc-text` on the pill, not `--nc-text-subtle`.** Subtle is the token for text that is
  present but not being read — the disclaimer, the try-asking label — and it measures 2.7:1
  against the grey the pill sits on, under the 4.5:1 that 11px needs. A day separator is the
  opposite kind of string: small, but the whole point is that it gets read. The shipped pairing
  is 11.4:1.
- **`setLocale` repaints pills and titles**, against the same line it already drew: what stays
  frozen is *payload* — reply text and server chip labels, localized upstream and not ours to
  touch. These are the widget's own strings derived from a stored epoch, so re-deriving them is
  the only way they can be right. The epoch rides on the node as `data-nc-at` rather than in a
  registry there would be nothing to keep in step with.
- **Accepted gap:** a tab left open across midnight keeps a "Today" pill that now means
  yesterday. Re-labelling it needs a timer or a third document listener, and `teardown()`'s
  claim that the widget attaches exactly two outside `#nest-chatbot` is worth more than the
  edge case — the same trade the carousel arrows and the scroll cue already make on resize.

## 2.8.0 — 2026-08-18

**The conversation now survives a page change.** The store record grows a display-only
transcript (`turns`, plus the `guestTurned` and `ended` latches), and a returning guest inside
the 24h idle window lands where they left off: no intro replay, no lost server greeting, no
welcome block re-rendered over a live conversation. New stored surface and a new UI behaviour,
hence minor. No transport change — the turn body is still `{message, locale}` and the transcript
never enters a request — no contract change, `BUILT_AGAINST` stays **1.6.1**.

Until now the record held `{uuid, ts, actions}`: a returning guest kept the *conversation* and
the site's welcome elements, and lost every word of it. The server still had the transcript,
keyed by that uuid, so "what did I just ask you?" worked while the screen showed an empty panel
and a fresh greeting. The gap was only ever on our side of the wire.

- **Persisted on payload arrival, not on settle.** `typeText` is presentation; a guest who
  navigates mid-reveal must not lose a turn the server already has. Measured on the demo page:
  at the moment the entry lands, the store holds all 46 characters of the reply while the bubble
  shows 10. The guest's own turn is written in `sendGuestText` and deliberately **never** in
  `sendMessage` — the 410/404 branch re-enters `sendMessage` with the same text, and a write
  point there would store the turn twice.
- **The greeting entry is born where its bubble is born** — in `introMaybeFinish()` and
  `restartConversation()`'s callback, and *unshifted*, because both insert that bubble before an
  impatient guest's already-sent message and the array has to read like the screen. Not in the
  init callback, which also fires on the 410 re-init, where nothing is painted and the entry
  would be a phantom.
- **The paint-only rule.** `async_result` and `conversation_ended` are stripped at persist time,
  so they never sit in the record at all. A replayed `async_result` passes every epoch guard —
  the epoch is current — and would restart a poll for a turn that resolved hours ago, on every
  page load. Verified with `data-debug` on: after reloading a completed async turn, the console
  carries no `poll` line at all. `ended` comes back instead as state, through `endConversation()`
  — one seam, not two — and travels via `intro.ended` rather than the boolean, because
  `endConversation()` uses `ended` as its own idempotence guard and restoring it first would
  no-op the call and leave a live composer on a dead conversation.
- **A poll's final replaces its interim in place**, found through a map keyed on the poll path.
  The interim is not necessarily the last entry when its poll resolves — the guest can send
  again while it is pending — and threading a handle through `renderActions` is what that seam's
  comments forbid. One entry either way: interim text with its fallback `booking_link`, then the
  final text with its `availability`.
- **A 410/404 re-init carries the transcript across**, with `n` nulled on every carried turn.
  Wiping it would orphan the message the guest is looking at — they would reload into a question
  with no answer. Their numbers belong to a conversation that no longer exists, so null is the
  honest value; `clearStore()` stays exactly where it was.
- **`n` is stored unused** — the server's turn number, kept so a future `?since={turn}`
  reconciliation is a drop-in with no stored-data migration. Old records simply lack the new
  fields and degrade to the previous behaviour; there is nothing to migrate.
- **`ts` now means last activity**, which is what the server's `idle_hours` has always measured.
  Before this it was written once at init, so a guest still chatting at hour 25 was reset
  client-side under a conversation the server considered live. A fix that came for free with
  writing on every turn, not a regression.
- **Bounds: 40 turns / 64K chars**, oldest first, payload before text — a turn's rich elements
  are the bulk of its bytes and a card-less old turn still reads. Never the newest turn, whose
  `a` goes last; entries are copied before they are thinned, so the live transcript never loses
  cards to a size check on its serialized twin. On quota the record retries once with `turns: []`
  — the uuid must never be the casualty of its own history. Verified by filling the origin's
  storage until a 3KB write throws: the widget's record came back at 477 bytes with the uuid
  intact and the panel fully usable. A `data-debug` line reports any shed — `thinnedActions`,
  `droppedTurns`, `keptTurns`, `chars` — because shedding is otherwise invisible: the guest sees
  the whole transcript on screen and only the *next* reload reveals what the record dropped.
  Observed firing from the 41st entry on, silent below it.
- **How the 64K limb was actually tested, and what that is worth.** It has never been reached in
  a browser: the turn cap binds first, at ~37KB for 40 card-heavy turns. So it was exercised by
  running `boundedRecord`, extracted from this file, against synthetic 4KB / 60KB / 200KB
  payloads under node. Every case landed under the cap, shed the oldest `a` first, kept the
  newest turn's `a` longest, never dropped the newest turn itself, and never mutated the live
  in-memory array. Read that for what it is: **a point-in-time check of copied source, not
  standing coverage.** There is no test runner here (rule 1), nothing re-runs it, and an edit to
  `boundedRecord` tomorrow is not covered by it — the debug line above exists because the real
  signal has to come from production.
- **The replay is silent.** `addBubble` announces every bot bubble; without a guard, twenty
  stored replies would bury the live region at every page load. A five-turn replay produced no
  announcer mutation at all, and the first live reply after it announced once, as ever. It also
  never touches `replyCount` — that feeds `maybeAutoExpand()`, and a replay that counted would
  throw the panel wide the instant a returning guest opened it.
- **Chip rows stay one-shot across a reload.** Every send retires every row, so rows can be live
  only on the final turn: the replay retires what it has painted before painting that turn.
  Retire means *remove*, so a stale row comes back absent, not greyed.
- **Accepted:** two tabs on one conversation are last-write-wins on the record — a lost stored
  turn costs replay fidelity only, never the server's transcript. A reply that completes after
  the tab closes is not in the store (the tail gap a future reconciliation exists to close). And
  a guest turn persisted before its POST resolves can replay as a question with no answer, for
  the sub-2s window before the reply lands.

**Verified in-browser** (mock, Chromium; fresh, returning, throwing-storage and cross-origin):
the record's shape and turn numbers after `book`/`rooms`; an `available` turn stripped of its
`async_result` and updated in place by its poll; `!cap` restoring a closed composer with a
focusable restart button that resets the record; `!410` carrying four turns across a new uuid
with every `n` null; a `tenerife` turn replaying byte-identical to its live render for six of
seven nodes — the seventh is the greeting, which correctly loses `nc-greeting` (that class is
the intro's held-back `opacity: 0`, and keeping it would paint the greeting invisible); chips
live on a final turn and absent on a superseded one; the full first-visit path after
`localStorage.clear()` (loader animating at 300ms, greeting mid-reveal at 4.8s, welcome block);
a greeting-only return showing the *stored* greeting and its welcome block; a 40-turn, 60-card
record replaying complete and scrolled to the end in ~1s; and a hostile `!xss` payload
round-tripped through storage still inert — `<img src=x onerror=…>` as literal text, the
`javascript:` url dropped, the unknown element type ignored while its sibling still rendered.
Console clean apart from the known font-CORS errors a plain `python -m http.server` produces
cross-origin.

**Verified against the real backend**, which is the half the mock cannot answer: conversation
uuid `4d103506…` byte-identical across a page refresh with `ts` advancing 1787122804144 →
1787122983145, and the reply *after* the reload referencing content from before it — server-side
continuity under a replayed uuid, confirmed rather than assumed. `guestTurned: true` restored on
resume with the welcome block correctly absent; `n` progressive against real turns (greeting
`null`, then 1, 2, 3, 4…); and the per-key `STORE_KEY` suffixing holding, with
`nest-chatbot:default` and `nest-chatbot:ws_live_…` coexisting on one origin without collision.

**Two measurements the rest of this entry rests on, run rather than reasoned.** The announcer:
a MutationObserver attached to the live region *before* the panel opens recorded **zero**
mutations across a replay of 6 bot turns / 11 messages, zero more through the 3s clear-timer
window, then exactly **one added node** — the reply text — when a live turn landed. The
cross-origin embed, host page and script on genuinely different ports: at 120ms every message
was already painted at full length with no `nc-typing` and the loader hidden, identical at
520ms, so nothing was revealing; welcome absent, scrolled to the end, uuid stable across the
reload, and `assetBase` plus the stylesheet resolving to the *script's* origin, not the host's.

## 2.7.0 — 2026-08-04

**A host can tell the widget to use their fonts, and one weight stops shipping.** Three new
config attributes, hence minor. No transport change, no contract change, `BUILT_AGAINST` stays
**1.6.1**. The shipped font payload drops from 64KB across four WOFF2 files to 45.5KB across
three, and a host that opts out fetches none of them.

**The fonts load on every page view, whether or not anyone opens the chat.** This was checked
rather than assumed, and the first answer was wrong. `@font-face` is lazy — a file is fetched
only when text actually paints in that family — and the launcher paints none (it is an `<img>`
plus a CSS dot), so the widget looks like it should cost nothing until a guest engages. It does
not: **the closed panel is `visibility: hidden`, not `display: none`**, so its header, greeting
and composer are laid out at boot and pull every font with them. Measured on the demo page,
cold cache: three files, 45.5KB, starting at 35ms — one millisecond after `DOMContentLoaded`,
with the panel still hidden and the teaser still eight seconds away. `font-display: swap` keeps
that off the critical path for *painting*, but the bytes are spent on every visit regardless.

That makes the two costs below real rather than theoretical:

- On a theme already serving the same families, the widget downloaded a **second copy** —
  `--nc-font-body` listed `"nc-Montserrat"` ahead of the host's own `Montserrat`, and HTTP cache
  is keyed per-URL, so byte-identical files are not shared.
- 45.5KB is the same order as the stylesheet (18KB gzipped) and a good fraction of the script
  (53KB gzipped). It is not a rounding error on a hostel's mobile connection.

- **`data-fonts` = `nest` | `host` | `system`.** `nest` is the default and unchanged — the
  shipped Poppins/Montserrat, one look across every hostel site, which is what 2.4.0 bought and
  is not being given back. `host` matches the embedding page; `system` uses the visitor's system
  stack. Both fetch **nothing**: no font file, no second stylesheet, no build step. Unknown
  values fall through to `nest`, the same ignore-and-carry-on the other attributes use.
  Verified as a matched cold-cache pair on identical URLs — default transferred 46,368 bytes
  with all three faces `loaded`; `host` transferred **0**, made no request, and left every face
  `unloaded`. Worth knowing for anyone re-running it: on a warm cache the opt-out modes still
  show resource-timing entries for the fonts, with `transferSize: 0` and the faces `unloaded`.
  Those are cache reads of something the engine never used — count bytes and `document.fonts`
  status, not the length of the network list.
- **`data-font-heading` / `data-font-body` take an explicit family list** and beat `data-fonts`,
  so the two mix — a host can take body text from their theme and keep Germán's Poppins headings.
  Naming a family the page already serves is the efficient form of the default: the widget uses
  the copy already loaded instead of fetching its own.
- **Why it costs nothing to implement: the seam was already there.** Every `font-family` in
  `css/nest-chatbot.css` is `var(--nc-font-heading)`, `var(--nc-font-body)` or `inherit` — ten
  sites, no exceptions — so overriding the two vars covers 100% of the widget's typography, and
  an `@font-face` whose family goes unmatched is never requested. `applyFonts()` writes the vars
  and that is the entire mechanism. The invariant is now stated in both the stylesheet and
  CLAUDE.md, because one hardcoded family name in one rule would break it while the attribute
  still appeared to work everywhere else.
- **`data-fonts="host"` reads `getComputedStyle(document.body).fontFamily`, once.** The obvious
  implementation — `--nc-font-body: inherit` — does not work: a CSS-wide keyword as a custom
  property's value applies to the property itself, not to the `var()` substitution. So the mode
  resolves a real stack instead. This is the one place the widget looks outside `#nest-chatbot`;
  it is a read, and nothing on the host page is written.
- **Values are validated, and the guard is honest about what it is.** `FONT_OK` accepts names,
  quotes, commas and spaces and rejects `( ) ; { } : / \`, which rules out `url()`, `var()` and
  anything shaped like a second declaration. This is a typo guard, not a security boundary:
  `setProperty()` parses the value, so a stray `;` cannot open a new declaration, and the host
  wrote their own script tag. A host wanting `var()` or `calc()` overrides the custom property in
  CSS — the same no-CSS/CSS split `data-offset-x` already draws.

**Verified in-browser** (mock, same-origin and a cross-origin host page on another port): the
cold-cache pair above; `host` resolving to the host page's Georgia on both vars and on the
widget's own `h2`, cross-origin included, so it reads the *embedding* page and not the widget's
origin; `system` resolving to the system stack with no request; `data-font-body` alone leaving
`--nc-font-heading` on Poppins, so the two mix; `data-font-body="x; background: url(…); color:
red"` rejected whole — var untouched, no background, no colour change, no request to the bogus
origin — while a quoted `"Ok Name", sans-serif` was accepted; the fallback pills rendering at
computed weight 600 against a registry holding only 400 and 600 (`Mock.init`'s `actions: []`,
per the note in the fixture); no request for `nc-montserrat-500.woff2` and no 404 for it; and
the demo page's own Georgia `h1`/`h2` at its 72px line-height, `.chat-header` and `.hidden`
identical in every mode. Console clean.
- **Montserrat 500 is gone — 18.7KB, 29% of the shipped font payload, for one rule.**
  `.nc-prompt`, the fallback "try asking" pills, was its only consumer in the file. Unlike the
  other three faces this one did **not** load at boot: the pills do not exist until
  `showPrompts()` runs, so the file cost a site with configured `quick_prompts` nothing at
  runtime and every other site 18.7KB shortly after init. The rule now states `600`, and stating
  it is required rather than tidy: left at `500` with no 500 face registered, CSS font matching
  searches weights **below** the target before above, so the pills would have rendered at 400 —
  quietly lighter, while reading as if they had asked for heavier.

## 2.6.0 — 2026-08-03

**A reply can be read from its first line again.** The transcript was pinned to the bottom from
a dozen places, including *every eighth character of the typing reveal*. Any answer taller than
the panel therefore scrolled its own opening line off the top while the guest was still reading
it — and because sitting at the bottom is the transcript's default state, that fired on
essentially every substantial reply, worst on the small mobile panel. The widget dragged the
guest to the tail of a sentence that was still being written. A minor, per the repo's own rule:
a new guest-visible control is new surface.

**The new shape.** The transcript moves itself exactly once per turn — when the guest sends —
and never again. A ⌄ cue in the bottom-right of the panel is the way to the latest content.

- **`scrollDown()` is gone, replaced by a named seam.** `anchorSend()` is the turn's one
  deliberate move; `scrollToLatest()` is the ⌄ press and the followed stream; `syncScrollCue()`
  measures and repaints the cue without moving anything; `afterRender()` is what the twelve
  former call sites now call. The typer's `if (i % 8 === 0)` line — the defect itself — repaints
  the cue instead of jamming the scroll.
- **`anchorSend()` brings the guest's own message to the top of the view**, so the reply has the
  whole panel to grow into and its first line stays where the eye left it. `getBoundingClientRect`
  deltas, never `offsetTop` (`.nc-body` sets no `position`, so a child's offsetParent is
  `.nc-panel` and offsetTop measures the wrong box) and never `scrollIntoView()`, which walks
  every ancestor scroller including the host page's own.
- **A self-melting pad is what makes that promise keepable.** `scrollTop` cannot exceed
  `scrollHeight - clientHeight`, so on a real transcript the anchor just clamped: measured at
  408px down a 467px panel, leaving a reply about two lines before it ran past the fold, every
  turn. `anchorFloor` records the height the turn needs and `applyAnchorPad()` makes up the
  shortfall as `padding-bottom`, recomputed after every render. Content grows, the shortfall
  shrinks, the pad melts to nothing on its own — and because content + pad never drops below the
  floor, `scrollTop` is never corrected and the view cannot shift under a reading guest. Padding
  on the container rather than a spacer node: a spacer would have to be re-appended after every
  render to stay last, and `.nc-body`'s last child is load-bearing — `followsBotMessage()` reads
  it to decide whether a reply keeps its avatar. An engine that ignored the padding clamps as
  before, which is degradation rather than breakage.
- **The cue shows whenever the transcript is not at its bottom** — one positional rule, no
  "new content" state to keep in step with reality. Pressing it jumps to the bottom **and arms
  the follow** until the reply ends or the guest scrolls up; without that the typer grows past
  the fold again within eight characters and watching one answer costs a press a second.
- **Follow is cancelled by comparing against the scrollTop we last wrote, not against "am I at
  the bottom".** The typer appends characters between our write and the browser's asynchronous
  scroll event, so a bottom test reads a `scrollHeight` that has already grown and the reply
  cancels its own follow within a frame. Content growing never changes `scrollTop`; only the
  guest scrolling up can lower it.
- **The cue hides itself the way the panel does** — `visibility: hidden` with a delayed step, not
  `.nc-hidden`'s `display: none`: it leaves the tab order and the accessibility tree while still
  leaving a fade to watch. Hiding it is the **main** path, not an edge case — pressing ⌄ scrolls
  to the bottom, which hides ⌄, which blurs the button the guest just pressed and drops focus to
  `<body>`, i.e. the top of the customer's page. That is the fifth time this repo has met that
  bug. `syncScrollCue()` rescues to the composer, or to the restart button once
  `endConversation()` has disabled it.
- **Anchored to the footer's top edge** (`bottom: 100%`), not to the panel: the textarea grows to
  180px and a panel-relative offset drifts under it. Verified holding its 34px puck, 10px gap and
  15px inset at 420px, in the expanded sheet, at 390px fullscreen, and against a composer grown
  to eight lines. `.nc-footer` gains `position: relative` and deliberately no `z-index` — with
  `z-index: auto` it is not a stacking context, so the cue competes at panel level and lands over
  the transcript instead of under it.
- **No new icon**: the cue is the carousel's own `ICONS.chevron` turned a quarter turn, the same
  way the back arrow is that glyph turned around. New i18n key `scrollLatest` in all five
  locales, carried on **both** `aria-label` and `title` (the owner asked for the tooltip) and
  repainted by `setLocale()`.
- **No new listener outside `#nest-chatbot`.** `teardown()`'s standing claim that the widget
  attaches exactly two is intact: the scroll listener lives on `.nc-body` and leaves with it,
  rAF-coalesced like `wireCarousel()`'s. The cue re-syncs at `open()`, `resyncCarousels()`'s
  existing post-transition beat, `adjustInputHeight()` and the restart wipe. **Known limit,
  matching the carousel's:** a viewport resize fires no scroll event and no sync, so the cue can
  be briefly stale until the next scroll or message.

**Verified in-browser** (mock + a cross-origin host page on another port): `scrollTop` constant
for the whole of a long reply where it previously climbed; guest message anchored 10px from the
body top with the pad melting 356px → 0 as the reply arrived; ⌄ riding the stream at `gap: 0`;
scrolling up killing the follow permanently; focus landing on `.nc-input` and — after `!cap` — on
`.nc-restart`, never on `<body>`; one Book button through the `available` poll; `!xss` inert;
reduced motion landing the reply whole and jumping instantly; the host page's own scroll position,
`h2`, `.hidden` and `.message` untouched.

## 2.5.0 — 2026-08-02

**Synced to wSuite chatbot contract 1.6.1** — the sync CLAUDE.md and the proposals doc reserved
this number for. `BUILT_AGAINST` moves `1.4.1` → `1.6.1` in one step: 2.4.x already rendered the
1.5.0 shapes but was never reconciled field-by-field, and this release reconciles against the
whole 1.5.0→1.6.1 span at once. Packet pair: `docs @ chatbot-contract-v1.6.1 (90f3cfd) ·
widget @ e66fe4f`, committed alongside this release. A minor, per the repo's own rule: a
contract sync is genuinely new surface. Contract 1.6.0 exists because of this widget's own
conformance report — most fields adopted below are ones this repo asked for (proposals doc open
points 1, 2, 6, 7).

**Adopted, behaviour:**

- **Book-button dedupe (D-043(c)) — the first of the two gaps this sync owned.** A new
  `renderableCardUrl()` is the ONE card-item gate (name, then http(s) url), shared by
  `propertyCard()` and a pre-scan in `renderActions()` so the comparison set can only ever
  hold urls of cards that actually render — recording a rejected item's url would silently
  suppress the guest's only Book button, which the contract calls out as strictly worse than
  the duplicate. Raw-string equality, no normalization (the co-occurring urls are the same
  catalog value byte-for-byte; ours compares against the post-`trim()` href — exact for clean
  strings, and a padded near-duplicate renders both, which is the contract's "redundant, never
  harmful"). Suppression sits at the top of the `link_button` **and** `booking_link` branches
  (the second is reference parity — one handler per turn means it cannot co-occur with cards
  today) and passes the CTA `row` through untouched, so a suppressed button cannot close its
  siblings' group. The set is `Object.create(null)`: a payload url of `constructor` must not
  phantom-match.
- **The poll's `actions[]` is additive (1.6.0), so turns now carry a rendered-url set.** A
  fresh `Object.create(null)` per turn 200 in `sendMessage`, threaded
  `renderActions → renderAction → linkButton/renderPropertyCards → pollResult → renderActions`;
  every href a turn puts on screen is recorded, and the ONE contract-scoped suppression reads
  it: an `availability` whose `url` fell back to the property's `booking_url` duplicates the
  interim `booking_link`, so only its trailing Book button is skipped — the options list is new
  content and always renders. Deliberately availability-only (the reference's asymmetry):
  `link_button`s in a poll result dedupe against cards, not against the interim. The
  init/welcome/resume paths pass no set — welcome elements render outside any turn.
- **One-shot chip rows, both halves (the second owned gap).** Mid-transcript `quick_replies`
  rows now register in a module `chipRows[]` (welcome rows deliberately do not — they retire
  with the wrapper `removeWelcome()` sweeps, and two owners racing over one node means two
  focus rescues). `retireChipRows()` removes every registered row on ANY send — chip tap in any
  row, typed message, pack pill — with one call site in `sendGuestText()`, the documented send
  seam, plus `endConversation()`. Focus is sampled per row BEFORE removal and handed to the
  composer, the same rescue `removeWelcome()` carries. Not restored after a failed turn (the
  contract's MAY): the message is in the transcript and can be retyped; a restored row invites
  a double send.
- **`conversation_ended` (1.6.0) — the turn cap finally has a branch.** `endConversation()`:
  idempotent via the new `ended` flag (the server re-emits the element on every further capped
  POST), clears `sendQueue` (queued turns would each buy the same canned refusal — and must not
  leak into the next conversation), retires chip rows BEFORE the composer closes (the rescue
  needs an enabled input), appends a localized "Start a new chat" `<button>` in a normal CTA
  row, hands it focus when the guest was standing in the composer (disabling a focused control
  drops focus to `<body>` — the four-times-rediscovered bug), then disables input and send.
  `restartConversation()` wipes the transcript (keeping the hidden loader node — it is the
  greeting's insertion anchor), clears the store, resets the conversation-scoped latches
  (`guestTurned` now documents that a restart begins a new conversation's life), re-enables the
  composer, and re-inits through the normal `startConversation()` — so `initWaiters`
  serialization, the failed-init pack-greeting fallback and the 403 teardown all apply — then
  renders the new greeting + welcome itself, the same shape `introMaybeFinish()` draws minus
  the loader dance. The intro latches stay spent on purpose: the branded loader is a
  first-open experience, not a restart one. `ended` also gates `sendGuestText` and `drainSend`.
- **A stale poll cannot haunt the restart.** New `chatEpoch` counter, bumped per restart and
  captured per `pollResult` — a poll from the dead conversation (up to 120s of back-off, its
  request possibly in flight during the restart) re-checks the epoch at the timer, the tick AND
  the response callback, and silently stops rather than typing into a detached bubble or
  rendering actions into the new conversation's transcript. The reference has this hole; we do
  not copy it.

**Adopted, fields:**

- **`price_from.period`/`basis`** — a localized suffix of the widget's own (the contract's
  instruction; the reference hardcodes English, a deliberate divergence for a five-locale
  widget), composed period-then-basis from four new pack keys ×5 locales, resolved **per card**
  (1.6.1: two cards in one rail may differ, and the mock proves it with `/night per person`
  beside `/night per unit`). Absent means a **bare price** — never an inferred "/night"; the
  contract calls that a guest-facing pricing error, and CLAUDE.md now carries it as a gotcha.
- **`cta_label`** — server-localized Book text, preferred over the pack's `book` string per
  card; empty or non-string falls back.
- **`total` + `more`** — the overflow affordance this repo requested (open point 1). After the
  rail: a gated `more` (`safeHttpUrl` + non-empty label, server-localized, never `t()`) renders
  as a trailing link button and feeds the rendered set; otherwise a `total` greater than the
  cards *shown* renders a quiet localized count line (`showingOf`, the file's first two-slot
  string — `tf()` is now sequential-replace varargs, one-slot callers untouched). `CARD_MAX`
  stays 8 as OUR layout cap; the comment now records that the server's cap is a deployment
  setting the widget must not hardcode.
- **`locale` → `lang`** on `promo_card` and `quick_replies` containers, validated
  `/^[a-z]{2}$/`; absent means unknown and sets nothing — the island rows omit it on purpose
  (proper nouns claim no language).
- **`image_alt`** — future-proofed as `typeof item.image_alt === 'string' ? item.image_alt : ''`
  (reserved, unemitted at 1.6.x; absent = decorative `alt=""`, which was already this widget's
  behaviour and is now the contract's stated rule). The promo image stays hardcoded `alt=""`.

**Declined, with reasons (also going in the upstream report):**

- **`id`-keyed promo frequency capping / dismissal memory** — the widget has no dismissal UI
  and the server caps per conversation; the reference ignores `id` too. The field flows through
  untouched.
- **Restoring a chip row after a failed turn** — contract MAY; see the one-shot entry above.
- **Per-element `aria-live="off"`** — not needed here, an architectural difference worth
  recording: the contract's rule exists for a widget whose transcript is the polite live
  region, and `.nc-body` is `role="log"` + `aria-live="off"` with a sibling announcer as the
  single live region fed only by reply text. Elements have never announced over the reply in
  this widget. Same outcome, different mechanism.

**Accessibility (the contract's new section, matched or deliberately differed):** the card
track is now `role="list"` with `role="listitem"` cards inside the labelled carousel group
(`aria-label` from the new `properties` key, roledescription unchanged — arrows, fades and
dots are wrapper children, siblings of the track, so the list's children stay pure listitems);
the promo is a `role="region"` named by its `title` string (`aria-label`, not
`aria-labelledby` — nothing in this widget emits element ids) with `lang` when declared; chip
rows are a `role="group"` named from the new `quickReplies` key (screen-reader only — the
visible row stays bare by the owner's decision) — chips were already real
`<button type="button">`s.

**Mock:** the island branch is now the 1.6.x showcase (per-card suffixes, a `cta_label`, the
D-043(c) isolator — a name-less item sharing the website button's url, dropped without
suppressing it, exactly the case a `javascript:` url could never isolate — a Book button
matching a rendered card's url, and the `total`/`more` split: ibiza total-only → count line,
the others both → `more` wins). The promo factory is Spanish with `locale: 'es'`, a `\n` in
the body and a content-derived `id`; the chip factories carry their provenance `id`s. New
`!cap` trigger: canned cap reply + `contact_channels` + `conversation_ended` last. `Mock.poll`'s
ready payload is now an `availability` sharing the interim url — the poll-dedupe demo. Init
reports `contract_version: '1.6.1'`.

**CSS:** two new rules, both `#nest-chatbot`-scoped and `nc-`-prefixed — `.nc-restart` (button
chrome reset + the house focus ring over the `.nc-action` pill) and `.nc-car-count`. A
stylesheet walk in the browser confirms **zero** selectors outside `#nest-chatbot`.

**Verified** (Playwright against the mock demo, it-locale browser): welcome = two chip rows
with roles/langs (`lang="en"` on the tenant row only), no pack pills; tenerife → 3 cards
(name-less dropped), `da 22 €/notte a persona` + `da 24 €/notte per unità` + bare `da 26 €` in
one rail, "Book a bed" CTA beside two pack CTAs, Book-now suppressed while the website button
survives, "See all our properties" below the rail and no count line; ibiza → `Mostrati 3 di 5`;
`available` → exactly one las-eras Book button across interim and poll, options rendered,
bubble replaced in place; `rooms` unchanged; chip rows retired by tap AND by typed send with
keyboard focus landing in the composer; `!cap` → chips retired, channels rendered, composer
closed, Enter-submitted cap hands focus to the restart button, language switch repaints it,
restart wipes to a fresh greeting + welcome on a new uuid and a normal turn follows; `!410` →
transparent re-init (no second greeting, no welcome, uuid replaced); `!xss` and `!unknown`
inert; `!403` teardown; resume replays the stored welcome through the new signatures; drift
warn silent at 1.6.1 and firing once against a forced 1.7.0. Cross-origin (:8080 host page →
:5501 widget): boots, renders, dedupes; the only console noise is the documented fonts-CORS
open item (the bare dev server sends no ACAO on `fonts/`) plus the host page's own favicon.
**Not run:** the live pass — `http://nest-mind.test/` did not resolve at release time; the
mock and cross-origin passes stand in, limitation stated in the sync report.

## 2.4.2 — 2026-07-31

A patch: two defects and one revert to contract-specified behaviour. No new config attribute,
no new i18n key, no new element type, no transport change. The new `localStorage` key is an
implementation detail of the size fix, not new config surface, so under the repo's own rule
this stays a patch — which also keeps **2.5.0 reserved for the contract sync** that CLAUDE.md
and the proposals doc both promise. `BUILT_AGAINST` stays **1.4.1**.

- **A returning guest gets the site's welcome elements back.** `startConversation()` returns
  early whenever `readStore()` finds a conversation uuid, so `API.init` was never called on a
  resume and `intro.actions` stayed `null`. On a live site that meant every repeat visitor
  inside the 24h idle window silently lost the site's configured `chatbot.quick_prompts` **and**
  its `show_at_init` promo card, while still getting the widget's fallback pills — so the
  fallback was the only welcome a repeat visitor ever saw. Present since 2.4.0. What hid it is
  worth recording: every browser check to date cleared `localStorage` first, which is exactly
  the condition that masks the bug. The store now holds `{uuid, ts, actions}`, `readStore()`
  returns the **object** rather than a bare uuid, and the resume branch seeds `intro.actions`
  from it the same way it already defaults `intro.greeting`; `writeStore()` moved below the
  assignment in the init callback so it persists the value that load renders. Replay is safe on
  the renderers' existing terms — everything goes back through `textContent` / `safeHttpUrl` /
  created nodes, so a tampered store can only produce what a hostile server could already
  produce, which is the threat model those renderers are written against. A non-array `actions`
  is dropped rather than trusted: a malformed record degrades to "no welcome elements" instead
  of throwing and taking the conversation with it. Accepted cost, stated rather than hidden:
  welcome elements can be up to `IDLE_MS` (24h) stale — they are site settings, not
  conversation state. Verified: uuid **and** `ts` byte-identical across a reload with storage
  intact (so no second init ran) and both chip rows still on screen; a hand-written
  `{uuid, ts, actions: "garbage"}` boots with no page error and falls back to the pills.
- **The expanded panel survives a reload.** `.nc-expanded` was runtime-only.
  `nest-chatbot:user-shrank` recorded a *shrink* so auto-expand would not nag, but nothing
  recorded that the panel **is** expanded, so every reload dropped a guest reading the wide
  sheet back into the 420px floating card. New `localStorage` flag `nest-chatbot:expanded`,
  written by `expandPanel()` and cleared by `shrinkPanel()` on **any** expand or shrink,
  whoever caused it — it records the panel's last state rather than an intent, which is what
  lets `boot()` restore it. `user-shrank` keeps its narrower meaning (only the guest, only
  shrinking) and both flags are still needed: a guest who shrank once and later expanded by
  hand now gets their expanded panel back on reload while auto-expand stays suppressed.
  `clearFlag()` joins `readFlag`/`writeFlag` with the same try/catch, so `readFlag`'s
  `'1'`-or-absent semantics stay the only ones in the file rather than gaining a `'0'` every
  reader has to learn. Restore runs after `wire()` and **before** the `cfg.autoOpen` check, so
  an auto-opened panel is already the right size when it appears. Deliberately **not** gated on
  `matchMedia('(min-width: 1024px)')`: every expanded rule lives inside that media query, so
  below 1024px the class simply stops matching — a gate here would be a second source of truth,
  free to disagree with the stylesheet. Measured: expand → 670px, reload → still 670px with the
  control reading "shrink"; shrink → 420px, reload → still 420px; and at a 900px viewport the
  panel's box is **identical** with and without the class (885×800 at 0,0 both ways), so the
  restored class is genuinely inert rather than coincidentally similar.
- **Init `quick_replies` replace the widget's pills again, they do not join them.** 2.4.1's
  "render both" decision was taken against the 1.4.1 packet. The packet on disk has since moved
  to 1.5.0 and states what an init chip row *is*: *"Emitted on the init response from the site's
  `chatbot.quick_prompts` setting (the "try asking" chips)"*. Rendering both therefore puts the
  same affordance on screen twice — the site's version and ours. `showWelcome()` now calls
  `showPrompts()` only when **no server chip row actually rendered**. The branch is on what was
  rendered, never on what the payload contained: `renderQuickReplies()` returns early when every
  item is malformed, and reading the element instead would answer a broken payload with an empty
  welcome and no fallback at all — the 2.4.0 truthiness bug in a new place. It returns the row
  node when it appends one and nothing when it does not; `renderAction()`'s branch ignores the
  return and still `return null`s, so the extension seam's contract is unchanged. The partition
  itself is untouched: `quick_replies` into the one-shot `.nc-welcome` wrapper, everything else
  (a `show_at_init` promo) into `.nc-body` as transcript content. `els.promptsLabel` /
  `els.promptButtons` therefore stay `null` whenever the server supplied chips, which is exactly
  what `setLocale`'s existing guard needs — payload chips must never be repainted from a string
  pack. Rows render **bare**, with no "TRY ASKING" label borrowed from the block above them: a
  label reading "try asking" over "Tenerife" would assert an island name is a thing to try
  asking, when it is the answer to a question. 1.5.0 gives a row no way to say what it is
  asking, and an optional element-level `heading` is the live request upstream (proposals doc,
  open point 9).
- **The mock init sends two chip rows.** A new `promptChips()` factory beside `islandChips()`
  carries the tenant-authored "try asking" row, and `Mock.init` returns
  `actions: [promptChips(), islandChips()]` — mirroring the payload a real 1.5.0 server sends,
  since reusing `quick_replies` twice in one `actions[]` is contract-legal and each row is
  handled independently. English literals, because payload is server-localized and the widget
  never translates it. Both messages chain into existing fixtures rather than dead-ending in the
  catch-all: "Which hostel should I pick?" reaches the island-chips branch and "What is the Nest
  Pass?" the word-bounded promo branch, and both are worded apart from the pack's own
  `prompt1`/`prompt2` so the demo shows at a glance which block is on screen.
  **Accepted coverage loss, recorded not hidden:** with init always sending chips the demo no
  longer reaches `showPrompts()` or `setLocale`'s pill-repaint branch at all. Exercising the
  fallback means temporarily setting `Mock.init`'s `actions: []` — CLAUDE.md says so too.
- **No CSS changed** — `css/nest-chatbot.css` is untouched, so no new selector and no new
  `!important` (the file's single pre-existing one is unchanged). Host-page computed styles are
  byte-identical with and without the widget across `h2`, `textarea`, `a`, `.hidden`,
  `.message`, `.chat-header`, `body`, `p`, `button` and `input` on the demo page, and every
  selector in the stylesheet is still `#nest-chatbot`-scoped.
- **Regression gate re-run** — `book contact rooms link available hostel tenerife pass offer
  !unknown !xss !410 !429`, then `!403`: every branch renders its own elements, `tel:`/`wa.me`/
  `mailto:` hrefs are still constructed, the `!xss` reply stays text and its `javascript:` url
  is dropped, the unknown type is ignored with its sibling still rendering, `!403` tears the
  widget down, and no page errors fire throughout. Keyboard: tabbing to a chip in the **second**
  welcome row and pressing Enter lands `document.activeElement` on `TEXTAREA.nc-input` — two
  rows in one wrapper is a new shape for `removeWelcome()`'s focus rescue and it holds. 2.4.1's
  promo numbers re-asserted since `.nc-body`'s children change shape here: `offsetHeight ===
  scrollHeight` (113px at the 670px sheet), `overflow: clip`, `flex-shrink: 0`, CTA inside the
  card.

## 2.4.1 — 2026-07-30

A patch: one rendering defect and one restructure of the welcome state. No new config
attribute, no new i18n key, no new element type, no transport change — per the repo's own rule
little changes stay a patch even when they touch behaviour. `BUILT_AGAINST` stays **1.4.1**.
**No expand/shrink behaviour changed**: `expandPanel`, `shrinkPanel`, `maybeAutoExpand`,
`resyncCarousels`, both size flags, the ⤢ wiring and every rule inside
`@media (min-width: 1024px)` are untouched.

- **The promo card stopped collapsing to a 26px sliver.** `overflow: hidden` made `.nc-promo` a
  **scroll container**, and per the flexbox spec a scroll container's automatic minimum size is
  **0** rather than its content. `.nc-body` is a column flex box with a definite height smaller
  than its content — that is what makes it scroll — so negative free space is its *normal*
  state and every child sits at the default `flex-shrink: 1`. The text rows survive only
  because their automatic minimum is content-based; the promo was the one item that could
  absorb the whole shortfall, and it did, down to 26px of its own padding around a **0px
  content box**. That is why a sliver of the title showed and the body and CTA did not. Two
  parts, both required. `overflow: clip` clips at the same padding edge and honours
  `border-radius` identically but is **not** a scroll container, so the zero-minimum rule never
  applies; it is paired with the `hidden` line it replaces, the same shape the `100dvh`
  fallbacks use, and the comment says so because the pair reads like something to tidy. A
  `#nest-chatbot .nc-body > * { flex-shrink: 0 }` guard closes the *class* rather than the
  instance — `.nc-carousel` is one `overflow: hidden` away from the identical bug — and covers
  engines without `clip`. **It is `flex-shrink` alone and never the `flex` shorthand**:
  `flex: none` would reset `.nc-loader`'s `flex-grow: 1`, the only thing centring the intro
  progress ring. Measured after: 132px at the 420px floating panel, 114px at the 670px sheet,
  132px at 390×844, `offsetHeight === scrollHeight` and the CTA inside the card at all three,
  with the loader still at `flex-grow: 1` and its ring 0px off the body's centre.
  `.nc-promo-image` also gained the `flex-shrink: 0` its `.nc-card-photo` counterpart already
  states — consistency, not a defect fix; it is inert today.
- **The welcome state renders both blocks, sooner, and leaves as one.** It used to hang off
  `typeText`'s `done` callback, which arrived ~1.7s after the greeting finished typing on top
  of an already ~4.2s branded intro, and which made the whole block depend on one callback
  firing identically down two motion paths. It now renders as the greeting *starts* typing —
  the precedent `sendMessage()` has always set, where a reply's `actions[]` appear under a
  bubble still being typed. Measured: **4243ms from the launcher click against a 5809ms
  baseline, with the greeting 1 character long** at that moment; the character count is the
  real proof, since a lower time alone could just mean a faster typer. Server init `actions[]`
  no longer **replace** the widget's prompts — both render, into one `.nc-welcome` wrapper
  inserted after the greeting as a sibling inside `.nc-body`, never nested in the greeting
  bubble (`followsBotMessage()` reads `els.body.lastElementChild`, and nesting would cost the
  next reply its avatar). `showWelcome()` partitions the server's elements by type: a
  `quick_replies` row joins the wrapper, everything else goes into `.nc-body` through the
  ordinary `renderActions()` seam, where the first-turn sweep structurally cannot reach it —
  a tenant's init promo must not vanish the moment the guest types, and the contract makes only
  the chip row one-shot. `renderQuickReplies()` takes an optional `parent` passed by that one
  caller and deliberately **not** threaded through `renderActions()`/`renderAction()`, which is
  the file's documented extension seam. `removePrompts()` became `removeWelcome()` and removes
  the single wrapper, so both blocks go together under the existing focus rescue — which now
  covers the chips, where before a welcome chip row had no handle at all and would have stood
  above the transcript for the rest of the conversation. `typeText`'s `done` parameter had zero
  callers left and is gone.
- **The mock carries the island chips at init.** `Mock.init` returns `actions: [islandChips()]`
  — the configured-site case an empty array could never reach — from a factory the `hostel`
  fixture now shares, so that keyword regression-tests a byte-identical payload. Order in the
  wrapper is server chips first, pack block second: a "TRY ASKING" label above "Tenerife" would
  assert an island name is a thing to try asking, when it is an answer to a question the server
  asked. A judgement call, and one line to swap.
- **Known gap: a `quick_replies` row cannot say what it is asking.** The element carries only
  `items[]`, the init envelope carries only `greeting`, and there is no text element type — so
  the demo now reads greeting → bare `Tenerife` / `Gran Canaria` / `Ibiza` → `TRY ASKING` + two
  pills, with nothing on screen saying what the chips answer. That is the direct, intended cost
  of server-driven chips with no text element; an optional element-level `heading` is requested
  in `docs/proposals/response-contract-phase2-elements.md`. Two related consequences worth
  knowing: on a real 1.5.0 server a site that configures `chatbot.quick_prompts` gets its
  prompts **plus** the widget's two hardcoded pills (harmless today, no site is configured, and
  the demo cannot reveal it because its chips are island names rather than prompts); and a
  language switch now visibly relabels the pack pills while leaving the server chip labels in
  the init language — correct, since the widget must never translate payload, but newly visible
  with both blocks on screen at once.
- **`CLAUDE.md` documents the two panel-size flags.** No behaviour changed — `⤢` then `⤡` still
  writes `nest-chatbot:user-shrank` to `localStorage` and nothing ever clears it, so expanding
  the sheet once to look at it and collapsing it again disables auto-expand in that browser for
  good. That is working as specified and surprising rather than wrong, so the local-development
  section now names both keys, what sets and clears each, and the one-liner that resets them.

## 2.4.0 — 2026-07-29

Phase 2 of the redesign (options 2B/2C/2D in the design handoff under `plans/`): the panel
itself — typography, header, message list, welcome state, three new element renderers and a
wide expanded sheet. Genuinely new surface — twelve new i18n keys, two new storage flags and a
`fonts/` directory — hence minor. No transport change: the turn body, the storage shape, the
poll cadence and the three endpoints are untouched, and `BUILT_AGAINST` stays **1.4.1**. The
three renderers ship ahead of the contract sync, so a server reporting 1.5.0 fires the
one-time drift warn **by design** — release 2.5.0 is the sync that re-vendors `docs/wsuite/`
and moves the constant. `docs/proposals/response-contract-phase2-elements.md` records the wire
shapes 2.4.0 implements and the open points left for the platform team.

- **Poppins and Montserrat ship with the widget.** Four WOFF2 latin subsets in `fonts/`
  (`nc-poppins-600`, `nc-montserrat-400/500/600`), declared by `@font-face` at the top of
  `css/nest-chatbot.css` and resolved against `assetBase` like every other asset — never
  `fonts.googleapis.com`, so a host still trusts exactly one extra origin (rule 1). They are
  registered under `nc-`-prefixed family names because `@font-face` cannot be scoped under
  `#nest-chatbot` — at-rules take no selector — so the prefix is the isolation mechanism: a
  host page's own Poppins registration can never merge with ours, and ours can never repaint
  theirs. `--nc-font-heading` / `--nc-font-body` carry them with the previous system stack
  still behind them, and the SIL OFL texts ship beside the files. **Deployment requirement:**
  a cross-origin `@font-face` fetch is CORS-mode, so the CDN must send
  `Access-Control-Allow-Origin` on `fonts/`. Without it every host page keeps the fallback
  stack — the widget still works, nothing on screen says otherwise, and the only trace is the
  browser's own CORS error in devtools.
- **The header says who is answering.** A 44px avatar, "Germán" in Poppins beside an "AI
  assistant" badge and a "Nests Hostels · replies in seconds" subline, with the controls
  restyled as chips on the teal ground. A second control joins the first: ⤢ docks the panel as
  the wide sheet below. Per the plan review the minimise control is **✕ at every breakpoint** —
  no labelled `Hide ⌄`, no chevron — keeping the 30px chip on desktop, the 44×44 target below
  640px and the accessible name "Minimise the chat". The i18n key `subtitle` was renamed
  `assistantRole` (values unchanged in all five packs) now that it serves only the panel's
  `aria-label`, while the new `subline` carries the visible line.
- **A message list from the mock, and one announcement per reply.** Bot bubbles sit on
  `--nc-surface-sunken` (#F1F6F7) at a 16/16/16/4 radius, guest bubbles mirror it, text is
  14px/1.5 at 82% width, the avatar drops 45px → 32px, and consecutive bot replies lose the
  avatar and indent so their bubbles hold one left edge. The screen-reader fix does **not**
  match what was planned: marking the visible bubble `aria-hidden` buys a single clean
  announcement by removing every reply from the accessibility tree for good, which kills
  VoiceOver and TalkBack touch exploration. Instead the widget gained one live region,
  `.nc-announcer` — a **sibling of the panel**, never a child, because a closed panel is
  `opacity: 0` and `scale(0.2)` and a live region inside hidden furniture is unreliable.
  `.nc-body` states `aria-live="off"` (the implicit polite that rides on `role="log"` has to
  be overridden, not merely left unstated), and `typeText` announces the finished string once,
  on the streaming and the reduced-motion path alike. It speaks by *adding* a span, so two
  replies carrying the same string are two announcements, and clears itself after 3s so the
  text does not linger as an invisible second copy of the bubble. **Guest bubbles are no
  longer announced** — a deliberate change from 2.3.0: the guest just typed that text, and the
  bubble stays reachable by browsing and by touch.
- **A welcome state, not a bare greeting.** The approved 2B greeting in all five packs, a "Try
  asking" label with two suggested openers under it, and the AI disclosure under the composer.
  The prompts are **pack strings cached in the widget** rather than fetched: the welcome state
  is the one moment the guest is watching a spinner and it must not cost a second round trip.
  Their labels resolve at click time, so a guest who switches language between reading a pill
  and tapping it sends the sentence they could read. The init response now also carries
  `actions[]` (same request, zero extra network): a site that has configured welcome elements
  gets those rendered after the greeting *instead of* the widget's block — the server owns the
  welcome when it has one — and they are transcript content, so the first guest turn never
  sweeps them away. Everything that puts a guest turn on the wire now goes through a single
  `sendGuestText()` seam.
- **Three new element renderers**, the contract 1.5.0 shapes. `quick_replies` — tap-to-send
  chips reusing the prompt pill; chips carry **no urls**, an item `url` is ignored rather than
  honoured, so the link surface stays `link_button` / `contact_channels`. `property_cards` — a
  horizontally snapping strip of 190px cards over a photo band, with an optional badge, an
  optional location line, a locale-formatted "from €25" price and a mandatory book CTA; the
  arrows, edge fades and position dots ride one rAF-throttled scroll listener, the end
  comparisons carry a 2px epsilon because `scrollLeft` is fractional while `scrollWidth` and
  `clientWidth` are integers, and `overscroll-behavior-x: contain` keeps an over-scroll at
  either edge from chaining into the mobile back gesture on a page we do not control.
  `promo_card` — a tenant-authored upsell in a gradient `highlight` variant or a bordered
  plain one. All three keep the existing posture: every string reaches the DOM via
  `textContent`, every `url`/`image` passes `safeHttpUrl`, and anything that would render a
  dead end (an item with no booking url or no name, a chip with no message, a promo missing
  title, body or CTA) is dropped silently rather than shown broken. The strip stops at eight
  cards — the wire carries no `more` link and no `total`, and inventing a count would put an
  unverified number on screen. `Intl.NumberFormat` runs inside a try/catch: a currency code it
  rejects costs the price line and nothing else.
- **Fullscreen to 1023px, and a 670px sheet above it.** A tablet-width window has no more room
  for a 420px card floating over the host page than a phone does. Above 1024px the header's ⤢
  docks the panel to the right edge at **670px — not the 640 the plan called for**: three
  200px cards need 3 × 200 + 2 × 10 = 620px of track, and the track is the panel less the
  body's 2 × 15px padding and up to ~10px of scrollbar, so 660 clips the third card. Every
  expanded rule lives inside `@media (min-width: 1024px)` rather than on a bare `.nc-expanded`
  selector, and that is the whole trick: a class selector would out-specify the fullscreen
  block and win at every width, stranding a guest who expanded on a desktop with a 670px sheet
  after they narrow the window. Scoped this way the class simply stops matching, so a resize
  costs no JavaScript, no rebuild and no re-render — which is why the transcript and the
  scroll position survive it. Height interpolates through `interpolate-size: allow-keywords`
  where Chromium supports it and snaps elsewhere, with `interpolate-size: numeric-only` on
  `.nc-controls` so that property cannot wake a dormant `transition: width` inside the
  protected Phase-1 composer. After the third assistant reply on a wide screen the panel
  offers itself as the sheet once per session — and never again once the guest has pulled it
  back in themselves.
- **Three small behaviours.** The language row auto-collapses 4s after opening, and on the
  next keystroke in the composer, since it holds the composer at two thirds width while it is
  open. Esc now hides the teaser while the panel is closed — hide only, never the
  dismiss-forever flag, which stays the teaser's own ✕. Expanding or shrinking re-runs every
  rendered carousel's measurement, because its arrows and dots derive from the track's current
  width and a resize fires no scroll event.
- **`shrink` no longer collides with `close` in Italian and French.** Both keys carried
  "Riduci la chat" and "Réduire le chat" respectively, so the two adjacent header buttons
  announced one accessible name between them. The new key moved — `shrink` is now
  "Rimpicciolisci la chat" / "Rétrécir le chat" — and `close` was left alone: it has shipped
  since 2.3.0 and "minimise" is what it means. No two keys used as an accessible name share a
  value in any of the five packs.

## 2.3.0 — 2026-07-28

Phase 1 of the launcher redesign (option 2A in the design handoff under `plans/`): the closed
state only — launcher restyle, a per-session unread dot, a self-dismissing teaser. New UI
surface, four new or changed i18n keys and three new storage flags, hence minor. No transport
or contract change; `BUILT_AGAINST` stays 1.4.1.

- **The launcher is a white puck carrying the teal mark.** The 50px solid `--nc-secondary`
  circle became a 60px (56px below 640px) white circle with a 2px `--nc-primary` ring and
  `--nc-shadow-fab`, holding `logotipo-nests-tenerife.png` at 34×34 — launcher, message avatar
  and loader now show one mark in one colour. Hover scales to 1.05 over the new motion tokens
  (`--nc-dur`/`--nc-ease`, the Phase-1 subset of the design system's sheet — never import that
  sheet wholesale, its `--nc-surface` and `--nc-z` collide with ours); the open state keeps
  the 0.92 shrink, and the equal-specificity hover rule sits before it in source order so a
  hovered open launcher stays shrunk. Default edges moved 35/30 → 24/22, the 640px breakpoint
  now owns the 20/20 mobile edges (`data-offset-*` still outranks every width), and the
  panel's derived bottom follows the taller launcher (`+ 70px`). `img/avatar-header.png` is no
  longer referenced but stays for cached copies of older builds.
- **A quiet unread dot until the first open.** 14px `--nc-accent` circle at the launcher's
  top-right — no count, no animation, `aria-hidden`. While it shows, the launcher's accessible
  name is "Open Germán — 1 new message" (`openUnread`, all five packs); the first open of the
  session removes it (`sessionStorage`) and the label reverts to the new "Open Germán, the
  Nests AI assistant".
- **A self-dismissing teaser.** "Need a hand picking your Nest?" in a white bubble 12px above
  the launcher — once per session, 8s after boot with the panel still closed, gone by itself
  6s later. The copy and the ✕ are real buttons: the copy opens the panel, the ✕ dismisses
  permanently (`localStorage`); opening the panel by any path dismisses it too, and an
  auto-opened session never arms the timer. Timers follow the teardown contract (nothing is
  cleared; callbacks early-return on `removed`), the hidden bubble is `pointer-events: none`
  so its exit fade cannot swallow host clicks, and under `prefers-reduced-motion` the zeroed
  duration tokens make it appear and vanish instantly while the 8s/6s timing stays identical.

## 2.2.0 — 2026-07-28

Adds config surface (`data-offset-x` / `data-offset-y`), hence minor. No transport or contract
change; `BUILT_AGAINST` stays 1.4.1. Both fixes below were measured on the live widget at
nestshostels.com, which was running 2.1.0.

- **Host CSS resets no longer reach inside the widget.** Scoping every selector under
  `#nest-chatbot` keeps us out of a customer's page, but it does nothing about the reverse: host
  CSS wins wherever this stylesheet is *silent*. A theme's bare `h2` or `textarea` rule matches
  our own element directly, and a direct match beats inheritance from `#nest-chatbot` however
  specific that ancestor selector is. Two things were getting through on nestshostels.com's
  Tailwind theme: `@tailwindcss/forms` painted a `#2563eb` focus ring *inside* the composer pill
  (through `box-shadow`, which is why our own `:focus-within` outline survived alongside it — the
  guest saw a double ring), and the theme's `h2` rules put the header title in Poppins at a 72px
  line-height, making the panel header 114px instead of 77px. The old `#nest-chatbot button`
  font reset is now a block declaring `font-family`, `line-height`, `letter-spacing`,
  `box-shadow` and `outline-offset` across `h2, a, form, button, textarea` — the widget's whole
  inventory of tags a framework reset targets. No `!important` and no added specificity: ours
  already outranks theirs on every property it states, so the fix is only to state them. Every
  value matches what the widget already computed on a clean page, so nothing changes locally.
  `demo/index.html` gains the counterpart traps — a global `h2`, `textarea:focus` and `a` rule
  copied from that theme — alongside the `.hidden` / `.message` / `.chat-header` collision traps
  it already had. They are why the demo page's own headings now look loosely spaced.
- **The launcher offset is configurable.** `data-offset-x` / `data-offset-y` take a bare px
  number and set `--nc-edge-x` / `--nc-edge-y` inline, the same shape as `data-color` and
  `data-z-index`; a non-numeric value is ignored. The two custom properties already existed but
  could not actually be moved: `.nc-panel` hardcoded `bottom: 90px` so the panel stayed put when
  the launcher moved, and the `max-width: 520px` block hardcoded `right: 20px; bottom: 20px` on
  the launcher, so an override died silently on phones. The panel now derives
  `calc(var(--nc-edge-y) + 60px)` and the responsive block sets the two vars instead — one knob
  moves launcher and panel together, at every width. Because the attributes write an inline
  style, they also outrank the mobile block and hold across breakpoints.

## 2.1.1 — 2026-07-28

Presentation only — no transport, contract or API surface change. `BUILT_AGAINST` stays 1.4.1.

- **Flags fill their circle.** `.nc-flag` relied on `object-fit: cover`, which does nothing on an
  inline `<svg>` — the property only applies to replaced elements, so every flag letterboxed
  inside its 35px button. The crop now comes from `preserveAspectRatio="xMidYMid slice"` in the
  markup, applied through one `FLAG_FIT` constant so it cannot drift between flags. The button's
  hairline moved from `outline` into the `box-shadow` ring: it follows the border-radius on every
  engine, and freeing `outline` restores the keyboard focus ring the permanent one was masking.
- **One brand mark in two colour variants.** The launcher, the header and the bot avatar were
  three different pictures. All three are now the Nests wing — `avatar-header.png` (white) on the
  coloured launcher and header, `logotipo-nests-tenerife.png` (teal) on the white message body,
  matching the intro loader. The avatar sits on a faint `color-mix()` tint of `--nc-primary`, so
  the disc follows a host's colour override instead of hardcoding teal. `object-fit: contain` on
  the launcher icon and header logo stops the 300×325 mark being stretched ~8% by their square
  boxes. The three duplicated avatar call sites collapsed into one `avatarNode()`. The launcher no
  longer rotates 90° on open — a logo should not spin — it scales to 0.92. `germanavatar.png` and
  `nest-chatbot_white.png` are no longer referenced.
- **A reply's CTAs share one wrapping row.** Every `actions[]` renderable was appended straight
  into the column-flex `.nc-body`, so contract 1.4.0's three deterministic buttons each took their
  own line and stacked into a column of bars. Consecutive CTAs now collect into one
  `.nc-action-row` (flex, wrap, 6px), the open row travelling through the render pass as a return
  value so DOM order still follows payload order: `contact_channels` and an availability card close
  the group, `async_result` and unknown types pass it through, and a rejected non-http url leaves
  no empty row. This replaces the `.nc-action + .nc-action { margin-top: -12px }` grouping shipped
  in 2.1.0, which was a workaround for the missing container and was pinned to the 20px body gap
  (now 15px). Dropping `margin-left: 56px` is what makes the row wide enough for all three; the
  indent went from `.nc-channels` and `.nc-options` too, so every renderable under a reply shares
  one left edge, and the contact channels became the same wrapping row.

## 2.1.0 — 2026-07-28

Synced to wSuite chatbot response contract **1.4.1** (upstream tag `chatbot-contract-v1.4.1`,
packet pinned 2026-07-28). `BUILT_AGAINST` 1.2.0 → 1.4.1.

Adopted:

- **1.3.0 — per-turn `locale`.** Already sent on every turn as a then-additive field; verified
  conformant now that it is contractual (always a 2-letter code from `en es it de fr`, safely
  under the 5-character cap, resent on every turn exactly as guide §3.2 requires). No code
  change — the widget deliberately diverges from the reference here because it owns a
  language switcher.
- **1.4.0 — third deterministic `link_button`** ("Get directions", the property's `map_url`).
  The renderer was already generic — no button count assumed, no switching on label text.
  Added the third button to the `link` mock fixture and the one allowed CSS fix: consecutive
  CTAs now group at 8px apart instead of the full 20px message gap, and long server-localized
  labels wrap instead of clipping. All touched rules stay under `#nest-chatbot` / `nc-`.
- **1.4.1 — documentation only.** No wire effect; packet re-vendored.

Declined:

- **Turn-cap "start a new chat" affordance.** The capped reply carries no distinguishing
  field — client-side detection would mean matching localized canned text, which is fragile
  and violates the rule that behaviour keys on typed fields, never on reply or label text.
  The capped reply already renders correctly like any `200 {reply, actions, turn}`, including
  its optional `contact_channels`. Needs a typed signal upstream (e.g. a `meta` field) first.

Also verified during the sync, no change needed:

- Poll-endpoint `404` was already transient — it backs off like `pending` until the give-up
  deadline (comment aligned with guide §5.1).
- Turn-endpoint `404` already clears the stored uuid, re-inits and resends once (guide §5.1).
- Poll cadence (2s → ×1.5 → 5s cap, give up 120s), in-place interim replacement,
  `async_result.url` relative-only guard, `safeHttpUrl` http(s) allow-list,
  `tel:`/`mailto:`/`wa.me` construction, `property` at init, `{uuid, ts}` persistence,
  one-time contract-drift warn.

## 2.0.0 — 2026-07-23

The drop-in rewrite: single classic-script IIFE, live wSuite transport behind an explicit
`data-mock` switch, every CSS rule scoped under `#nest-chatbot`, no build step. Built against
contract 1.2.0.
