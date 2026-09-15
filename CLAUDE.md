# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

**One drop-in chat widget.** A host website adds a single `<script>` tag and gets the branded
Germán bubble, talking to the wSuite chatbot API. Vanilla JS, no dependencies, no build step.

```html
<script src="https://cdn.nestshostels.com/nest-chatbot/nest-chatbot.js"
        data-api-base="https://api.nestshostels.com"
        data-key="ws_live_xxxx.yyyy"
        data-property="Las Eras Nest Hostel"
        data-locale="auto"
        defer></script>
```

**What it is not:** not a website, not an npm package, not a framework component.
`demo/index.html` is a stand-in for a customer site used for manual testing — it is never the
product, and nothing in it ships.

Every decision in this repo answers to one question: *does this make the widget easier to drop
onto a site we do not control?* If a change makes the host page's job harder, it is the wrong
change.

## The hard rules

### 1. No build step

No npm, no bundler, no Tailwind, no preprocessor, no CDN dependencies. `nest-chatbot.js` and
`css/nest-chatbot.css` are shipped exactly as they are written.

This is not nostalgia. The repo previously ran Tailwind to emit a 1266-line `output.css` for
**ten** utility classes, and that stylesheet's preflight reset overwrote host-page styles
wherever the widget was embedded. The build was pure cost. If a change seems to need tooling,
the change is wrong.

Icons and flags are inline SVG constants in `nest-chatbot.js` — never FontAwesome, never
flagsapi.com, never a webfont. A host should have to trust exactly one extra origin: ours.
Text fonts follow the same rule the other way round: Poppins and Montserrat are self-hosted
`nc-`-prefixed WOFF2 files in `fonts/`, declared by `@font-face` in `css/nest-chatbot.css` and
resolved against `assetBase` — never `fonts.googleapis.com`, so the origin count stays at one.
Since 2.7.0 that is the **default**, not the only mode: `data-fonts` / `data-font-*` let a host
drop to their own or the system stack (`applyFonts()`). The escape hatch does not weaken the
rule — the alternative to shipping the files was always a second origin, never a lighter one.

### 2. Never `innerHTML`

Every guest, LLM and element-supplied string reaches the DOM via `textContent`,
`setAttribute`, or a created node. This is the response contract's explicit security rule
(`docs/wsuite/response-contract.md` §Security rule), not a stylistic preference.

The one `DOMParser` call (`svgNode`) exists solely to turn the module-local SVG constants into
nodes. It must never be reachable from network or guest input. If you find yourself wanting to
pass it a variable, stop.

Message bubbles use `white-space: pre-wrap`, so replies keep their newlines with no markup at
all — the rule costs nothing.

### 3. Only public-scoped keys reach the browser

`data-key` takes a `ws_live_<prefix>.<secret>` key with **scope = `public`**. Those are public
by design (integration guide §2) and are meant to be visible in page source. Never a `full`
key, never a provider key (OpenAI, Voiceflow, Mistral…), never anything with write access.

No secret of any kind belongs in this repo. A live Voiceflow Dialog Manager key was committed
here from `219a265` until the 2.0 refactor; it was shipped to every browser that loaded the
page and has to be treated as compromised. A live Google Gemini key (`AIzaSy…`) shipped the
same way even earlier — from `b837cff` until `219a265` merely commented it out — and is
equally compromised, equally in need of rotation.

### 4. Every CSS rule is scoped

Every selector in `css/nest-chatbot.css` is nested under `#nest-chatbot`, and every class
carries the `nc-` prefix. There are **no** global selectors — no `*`, no `body`, no `html`, no
bare element rules, no unprefixed utility classes.

The widget lands on sites with their own `.hidden`, `.message` and `.chat-header`. One
unscoped rule repaints a customer's page. `demo/index.html` deliberately defines all three of
those class names — if the demo page's appearance changes when the widget loads, the scoping
is broken.

Theme through the custom properties on `#nest-chatbot` (`--nc-primary`, `--nc-secondary`,
`--nc-z`, `--nc-edge-x`, `--nc-edge-y`, …), never by editing rules.

**Scoping keeps us out of their page; it does not keep them out of ours.** Host CSS wins
wherever this stylesheet is *silent*: a theme's bare `h2` or `textarea` rule matches our own
element directly, and a direct match beats inheritance from `#nest-chatbot` however specific
that ancestor selector is. So anything a framework reset touches has to be **declared** on
our side — see the reset block at the top of `css/nest-chatbot.css`. The cure is never
`!important` and never more specificity; ours already outranks theirs on every property it
states. `demo/index.html` carries the counterpart traps (a global `h2`, `textarea:focus` and
`a` rule copied from a real customer's Tailwind theme), so a regression shows up on the demo
page rather than in production.

## Architecture

`nest-chatbot.js` is a single classic-script IIFE, organised in banner-delimited sections:

| Section | What lives there |
|---|---|
| `config` | reads `data-*`, derives `assetBase` from `script.src`, resolves the locale |
| `i18n` | UI strings per locale (`en es it de fr`) |
| `storage` | `{uuid, ts, actions, turns, guestTurned, ended, idleHours, clockOffset}` in `localStorage` — the init `actions[]` and the display-only transcript ride along so a resume replays the conversation, not just the welcome; `ts` is last activity. Since 2.10.0 the idle window and the server clock offset are the **server's**, carried in the record because the resume path never calls init; `IDLE_MS` is only the fallback |
| **`events`** | **the host-page seam** — `emit()`, `snapshot()`, the `wchat:` vocabulary |
| **`api`** | **the seam** — `init` / `send` / `poll` plus the mock fixtures |
| `dom` | `el()`, `attrs()`, `svgNode()`, the icon and flag constants, `build()` |
| `render` | bubbles, thinking dots, `renderAction()`, `safeHttpUrl()` |
| `typing` | the character-by-character reveal |
| `intro` | the circular-progress loader sequence |
| `flow` | open/close, submit, status handling, teardown, the async poll, the header ⋯ menu, the Back-button history entry |
| `boot` | listeners (two on `document`, `popstate` on `window`), `window.NestChatbot`, entry |

**Why a classic IIFE and not ES modules.** `document.currentScript` — how the widget reads its
`data-*` config and finds its own asset base — is `null` inside `type="module"`. A module build
would also mean a module graph waterfall and MIME/CORS gotchas on customer servers. One
cacheable file is simpler for everyone. The sibling reference widget made the same call.

**Assets resolve against the script's own URL**, never the host page. `new URL('./', script.src)`
is what lets the widget be served from a CDN while the host page lives anywhere.

## The API

`docs/wsuite/` is the authority — do not re-derive or duplicate its rules here:

- **`response-contract.md`** — the versioned reply envelope (currently 1.12.0 — see its
  Changelog and Versioning policy) and every element type.
- **`integration-guide.md`** — transport, auth, endpoints, errors, rate limits, CORS.
- **`chatbot.reference.js`** — the platform's own security-reviewed widget. When a transport or
  contract detail is unclear, read how this does it. Pinned copy; may drift from upstream.

**Contract sync.** `docs/wsuite/` is a vendored, read-only packet: at a sync it is replaced
wholesale from the upstream tag (`chatbot-contract-v<X.Y.Z>`), never hand-edited.
`BUILT_AGAINST` (api section) moves **only** during a sync — it is a claim about what this
code implements, not a mirror of the docs. `VERSION` is the widget's own independent release
line; it and `window.NestChatbot.version` are the only version sites (no package.json —
rule 1). Releases are recorded in `CHANGELOG.md`. Current packet: synced 2026-09-15 as
`docs @ chatbot-contract-v1.12.0 (43101a6) · widget @ cb8005b` — the widget SHA is part of the
packet's identity, because the reference renderer legitimately moves between contract tags
(here the halves differ: the renderer last moved in `cb8005b`, the 1.12.0 feature commit, and the
tag sits on `43101a6`, a later fix that touched one line of the contract and none of the renderer).
`BUILT_AGAINST` is `'1.12.0'`, in lockstep since release 2.13.0 adopted D-078 and D-079.

**The widget is currently AHEAD of the deployment, and that is the quiet direction.** Measured
2026-09-15 15:15 UTC off a real init `201` against `nest-mind.laravel.cloud`:
`contract_version: 1.10.0`, `idle_hours: 168`, and `Access-Control-Expose-Headers: X-Chatbot-Contract`
— **no `Retry-After`**. Both 1.11.0 and 1.12.0 are tagged locally in `nest-mind` and neither has
shipped. Nothing is wrong — the drift warn fires only when the **server** is ahead, and the
ignore-unknown rule covers the other direction — but it means neither thing 2.13.0 adopted can be
seen live yet: every live `429` still reads `retryAfter: null` and shows the old "in a moment" copy
(correct for a header the browser cannot read), and no handoff turn carries `property_choice`. Do
not read either as a defect. Re-read `contract_version` **and** the expose header off a `201` before
concluding anything, exactly as the idle-window entry under Open items insists.

**The upstream repo drives the sync, and it is local.** The platform is `nest-mind`
(`modules/chatbot/`). Its `docs/consumer-sync.md` is the operational half: §1 is a registry of
which consumer sits on which contract — **this repo has a row in it** — §2 records that our
vendor path is `docs/wsuite/` and that `chatbot.js` is renamed to `chatbot.reference.js` here,
and §4 carries a ready-rendered sync prompt naming this repo. Read §4 before a sync rather than
improvising one. Their rule, worth honouring because their own file records it slipping twice:
**the registry row moves in the same commit as the sync, whichever repo the work happened in.**

**That row is the only thing this repo edits in `nest-mind`.** It crosses because their file makes
it an obligation — the follow-up commit is "not optional" — and nothing else does. Their
dev-guide, their decision log, their audit registers, their design docs: research the change from
here, then hand it over as a prompt for a session opened at `~/Herd/nest-mind`, which is the
direction §4 already works in the other. The reason is not tidiness. A session rooted here carries
*this* file's conventions, cannot run their tests, and reasons about their server from the
outside — which on 2026-08-23 put a false claim about the deployment's idle window into their
registry, and a corrected gate condition into a doc whose own header reads "Design only — nothing
here is built" while their authoritative `decisions.md` kept the incomplete one. Both reached
origin before anyone noticed.

Three endpoints: init a conversation, post a turn, poll an async turn.

```
POST {apiBase}/api/v1/chatbot/conversations               → 201 {conversation:{uuid}, greeting,
                                                                 contract_version}
POST {apiBase}/api/v1/chatbot/conversations/{uuid}/messages → 200 {reply, actions[], turn}
GET  {apiBase}{async_result.url}                          → 200 {status, reply?, actions?, turn}
```

**Which of the things a guest sees comes down the wire, and which the widget makes up, is
`docs/rendering-ownership.md`** — a per-element table plus the rule behind it. Read it before
changing a renderer or adding an element type. The short version: the server sends display text when
the text is **tenant-authored content** (a promo, a chip, a property's name or CTA label), and the
widget composes it when it is **chrome around structured data** the server deliberately sent as data
— which is why `promo_card` uses no pack string at all and `availability` uses nothing but. Two
traps live there too: "from the server" and "in the guest's language" are different questions (a
card's `name` is raw catalog, its `cta_label` is localized), and the split is exactly the rule for
what `setLocale()` may repaint.

### Things that will bite you

- **A turn always returns `200`.** Provider, budget and LLM failures degrade server-side to a
  localized "busy" reply. A 5xx is a bug, not a business outcome. The non-200s are resolution
  failures only: `401` bad key, `403` disabled/revoked or the request `Origin` is not on the
  site's allow-list (body `{"message":"Origin not allowed."}` — guide §7), `404` unknown uuid,
  `410` idled out, `422` config, `429` throttled.
- **`410` is normal.** Conversations idle out after the server's window — **not a constant
  any more**: since 2.10.0 the widget takes the window from `idle_hours` on the init `201`
  and stores it with the record (see the persist trap below), falling back to 24h against a
  server that does not send it — which is every server until 1.7.0 is deployed. Re-init transparently and resend the message once —
  the guest should never see it happen. Already implemented in `sendMessage`.
  On the **turn** endpoint a `404` rides the same branch (guide §5.1: the stored uuid is
  dead — re-init, or this browser retries it for the full retention window). On the
  **poll** endpoint a `404` is **transient** instead: back off exactly as for `pending` and
  stop only at the give-up deadline — re-initing there would abandon an answer still being
  generated. A poll **`410`** stops the poll and nothing more (guide §5.1): keep the interim
  reply, re-init **nothing** — the guest's next message re-inits on the turn endpoint, where
  a fresh conversation actually has a message to carry.
- **The 1.7.0 init fields are read at init and *persisted* — and the second half is what looks
  finished when it isn't.** `readStore()` runs at **boot**, and a guest inside the window
  resumes **without ever calling init**, so the one visit that needs the server's numbers is
  the visit that never receives them. Both `idle_hours` and the `server_time` offset therefore
  live in the stored record, judged by `storedIdleMs()`. And because `persist()` is the single
  writer and serializes **current state with no arguments**, the resume branch in
  `startConversation()` must **restore** them into `serverIdleHours` / `serverOffset`: skip
  that and the first turn of a resumed session writes `null` over the window, reverting to 24h
  on the next boot — the same defect, one turn later. Absence stays normal in both directions
  (an older server, an older record) and falls back to `IDLE_MS`.
- **Corrected clock for dates, raw clock for durations.** `nowMs()` (`Date.now() +
  serverOffset`) stamps anything that becomes a **date** — the transcript's `at`, the day
  separators, `dayLabel()`'s "today". Anything measuring a **duration** stays on raw
  `Date.now()`: `latencyMs`, the poll give-up deadline, the teaser timers, and the record's own
  `ts` (compared against `Date.now()` in `readStore()`, so device skew cancels). Mixing the two
  is how this goes wrong quietly.
- **Never infer a price period.** `price_from.period`/`basis` are optional and **per item** —
  two cards in one rail may differ, so `cardPrice()` resolves the suffix per card and renders
  the **bare** price when they are absent. An invented "/night" on a per-stay figure is a
  guest-facing pricing error, not a cosmetic one.
- **Never derive `total`, never normalise a booking url.** An `availability` option's `total`
  (contract 1.8.0) is the server's string, printed verbatim; `price × units` computed here is a
  wrong quote on a link that will not honour it, so absent means the pre-1.8.0 line. Since 2.11.1
  it is the **figure** on a party row — units above one, with a known `basis` — and `price` is the
  figure otherwise, which the contract makes the same string at `units: 1` and the only one there
  is without the trio; the unit label a single-unit row used to carry now lives once in the group
  heading. The contract also makes `total` null exactly when `price` is, so an option with no rate
  renders its name alone rather than half a quote. And since 1.9.0 (D-071) every booking `url`
  is server-composed —
  `https://hotels.cloudbeds.com/{lang}/reservation/{code}?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=N`
  — so the only thing this file may do to one is `safeHttpUrl()`'s `trim()`. The two dedupes
  (card CTA vs Book button; interim `booking_link` vs async `availability`) are raw-string
  comparisons that work *because* the server composes both sides from the same inputs: parse,
  lowercase or strip a query on either side and they stop.
- **A card can now sit on the booking turn, and the dedupe takes the BUTTON — never the rows.**
  Since 1.10.0 (D-073) the Ready booking turn of a site with `chatbot.cards.on_booking` switched
  on sends `[property_cards (one item), availability | booking_link, promo_card?]`, card
  **first**, the card's `items[0].url` byte-identical to the booking element's. That kills the old
  guarantee that one handler per turn (D-009) keeps the two apart — the `booking_link` branch's
  `cardUrls` check was dormant for five releases and is live now. Two things must stay true.
  **One Book affordance:** the card's CTA, which the guest sees; the booking element's trailing
  button is the one that goes. **Every option row, always:** since 1.9.1 (D-072) the reply prose
  names the two cheapest and *points at the rows* instead of listing them, so a card that
  swallowed them leaves the guest no list at all. That is precisely the bug 1.10.0 fixed in the
  reference, whose `availability` branch used to `return` early behind an anchored url. Here the
  guard has always been on the button alone — keep it there. The same-list case needs no
  `cardUrls` pass in `renderAvailability()` because the card renders first and enters `rendered`
  before the branch runs; the pre-scan exists for a button that **precedes** its card, which the
  server does not emit. `cardstay` and `cardbook` in the mock are the two arms.
- **The init response reports `contract_version`.** Compare it to `BUILT_AGAINST` (api
  section) and `console.warn` once when the server is ahead — never gate, never hard-fail
  (guide §3.1); the ignore-unknown rule keeps the widget functional. That warn is the sole
  exception to the `data-debug` logging gate.
- **Do not send chat history.** The turn body is `{message}` plus the optional per-turn
  `locale` (contract 1.3.0). The server owns the transcript,
  keyed by the conversation uuid. The widget keeps a **display-only** transcript copy in
  `localStorage` (since 2.8.0) so a returning guest sees their conversation — it must never
  enter a request body. An earlier version accumulated a `chatHistory` array with no purpose at
  all; the stored transcript is not that: it exists to be replayed, never to be sent.
- **Every request faces two rate limits** (guide §6), on two independent buckets: a
  per-**visitor** budget keyed on key + client IP (20/min turn, 60/min poll) and a
  per-**key** site ceiling (300/min turn, 900/min poll); a `429` means whichever tripped.
  Since contract 1.11.0 (D-078) the **turn** bucket (init + turn, never poll) also caps **per
  day** — 100/day per visitor, 300/day per site, a rolling 24 hours from the first counted
  request. Visitors sharing an egress IP (a hostel's own wifi, corporate NAT, carrier CGNAT) share
  **one** visitor bucket — our guests are mostly on property wifi, so budget for that, and note
  it is the **daily** visitor cap such a building trips, not the per-minute one.
- **A `429` can last a day, and only `Retry-After` says so** (1.11.0). The body is identical for a
  minute's wait and a daily cap. `request()` hands a 429's `Retry-After` seconds to the init and
  turn callbacks; above `RETRY_LATER_S` (120) the guest sees `t('retryLater')` instead of
  `t('retry')`, and `wchat:error` carries the number as `retryAfter`. Three things to keep:
  **read it through `getAllResponseHeaders()`, never `getResponseHeader('Retry-After')`** —
  asked by name for a header the response does not expose cross-origin, Chromium logs a red
  `Refused to get unsafe header "Retry-After"` on the host's console (measured 2.13.0; the full list
  is filtered silently), which `data-debug` cannot gate. **Absent, unexposed or a date form is
  `null` and keeps the old copy** — unknown never becomes "come back later". And **nothing retries
  a 429 automatically**, then or now; a long one also empties `sendQueue`, since every queued turn
  would be refused the same way.
- **`actions[]` is always an array**, never null. Render elements in order.
- **Ignore unknown element types silently.** The server ships new types ahead of any given
  widget. Throwing on one would take the whole reply down. Adding support for a new type is
  exactly one new branch in `renderAction()`.
- **`async_result.url` is relative and must stay that way.** Reject anything not starting with
  `/`, and resolve it against `apiBase`. Polling is optional by design — the interim reply and
  its fallback links are already rendered, so a consumer that ignores `async_result` still
  works.
- **Construct `tel:` / `mailto:` / `wa.me` hrefs yourself** from `contact_channels` values.
  Never use a payload string verbatim as an href. Element `url` fields are honoured only for
  `http`/`https` (`safeHttpUrl`).

## Configuration

Set on the `<script>` tag. `document.currentScript.dataset` reads them at boot.

| Attribute | Default | Notes |
|---|---|---|
| `data-api-base` | — | API origin. Required (with `data-key`) unless `data-mock` — the widget does not boot without them. |
| `data-key` | — | Public-scoped `ws_live_…` key. Required unless `data-mock`. |
| `data-property` | — | Property-name hint, sent at init. A matched name seeds the conversation's working memory, so answers are scoped to that property from turn 1. Unknown names are not an error. |
| `data-locale` | `auto` | `auto` matches `navigator.languages` against `en es it de fr`. |
| `data-position` | `right` | `right` \| `left` |
| `data-offset-x` | `24` | Bare px number → `--nc-edge-x`. Non-numeric values are ignored. |
| `data-offset-y` | `22` | Bare px number → `--nc-edge-y`. The panel derives its `bottom` from it. |
| `data-color` | `#0D6F82` | Sets `--nc-secondary`. (Defaults live as CSS custom properties in `css/nest-chatbot.css`; the JS default `''` means "don't override".) |
| `data-fonts` | `nest` | `nest` \| `host` \| `system` — see the typography seam below. Unknown values fall through to `nest`. |
| `data-font-heading` `data-font-body` | — | An explicit family list for either var. Beats `data-fonts`, so the two mix. Validated by `FONT_OK`; a rejected value is ignored, same as `data-offset-x`. |
| `data-z-index` | `2147483000` | For hosts with their own stacking conflicts. Same CSS-default mechanism as `data-color`. |
| `data-auto-open` | `false` | See the Back-button caveat below — an auto-opened panel's history entry is skippable until the guest taps something. |
| `data-back-button` | `true` | The device Back button closes the panel. **The only opt-OUT boolean in `cfg`** (`!== 'false'`, not `=== 'true'`) — see the Back-button section. |
| `data-debug` | `false` | Gates **all** `console` output — sole exception: the one-time contract-drift warn (guide §3.1). |
| `data-mock` | `false` | Serves replies from the local fixtures instead of the API — the dev harness. The demo page sets it; never a production page. |

Runtime API: `window.NestChatbot` → `{ version, open, close, toggle, destroy, setLocale, locale,
state }`.

### The widget never phones home — measurement leaves as host-page events

Since 2.8.2 the widget reports itself through DOM `CustomEvent`s dispatched on `els.root`
(the `events` section), and that is the **only** channel it will ever have. No analytics
request of its own, no beacon, no pixel, no third-party script — same reasoning that keeps
icons inline and fonts self-hosted: a host trusts exactly one extra origin, ours, and only for
our own assets. The host page decides where the events land. A host that listens to nothing
pays nothing, which is why there is deliberately **no** `data-*` attribute to disable it.

Four rules the section states and the code has to keep true:

- **Dispatch from `els.root`, never `window`.** Events bubble, so a host listener on `window`
  or `document` hears them either way, and the widget still touches no node it does not own.
  The measurement seam attaches **no listener at all** — whatever the widget's outside-the-root
  count is, this section adds nothing to it. (It was two, both on `document`, until 2.10.3 put
  `popstate` on `window` for the Back button. Dispatching still attaches none.)
- **Counts, enums and booleans. Never guest text, never reply text.** `length` is a character
  count; `elements[]` lists element *types*. Element urls are the one string that travels
  (a server-supplied href the guest is navigating to, already in the DOM) — and
  `contact_channels` is excluded even from that, because its href **is** the property's phone
  number or email.
- **`emit()` is a no-op before `build()` and after `teardown()`.** Both guards, deliberately:
  the second is a consequence of detaching the root, the first is a contract.
- **Every name is a commitment.** Adding an event is a patch; renaming or removing one is a
  **major**, exactly like a runtime-API method. Each `emit()` fires twice — `wchat:<name>` and
  a bare `wchat` carrying `name` — so a host wiring the umbrella once keeps receiving events
  added later without editing their page.

**The namespace is `wchat:`, not `nest-chatbot:`, on purpose** — see Open items.

**The design record is `docs/proposals/visitor-measurement-and-events.md`**: why route A won,
what each event can and *cannot* answer, and the upstream ask. `README.md` § Measuring it is
the host-facing reference — names and payloads. Read the proposal before changing the shape of
this surface; read README to integrate against it.

A `source` enum reaches `open()` / `close()` / `sendGuestText()`, and **three `wire()`
listeners and three `window.NestChatbot` methods are wrapped rather than passed by
reference**: `addEventListener` hands its handler a `MouseEvent` as the first argument, and a
host is free to write `btn.addEventListener('click', NestChatbot.open)`. Pass any of them bare
and the source silently becomes an object while everything on screen keeps working. `oneOf()`
is the second half of that defence and the reason the enum can be trusted.

### The typography seam is exactly two custom properties

Every `font-family` in `css/nest-chatbot.css` is `var(--nc-font-heading)`, `var(--nc-font-body)`
or `inherit` — ten sites, no exceptions. That invariant is the whole reason `data-fonts` is free:
override the two vars and nothing on screen matches `nc-Poppins` / `nc-Montserrat`, an
`@font-face` whose family goes unmatched is **never fetched**, and the host pays zero font bytes
with no second stylesheet and no build step. **Hardcode a family name in one rule and that
silently stops being true** — the attribute keeps appearing to work everywhere else.

Two things that look like they should work and do not:

- **`--nc-font-body: inherit` does nothing useful.** A CSS-wide keyword as a custom property's
  value applies to the *property*, not to the `var()` substitution. That is why
  `data-fonts="host"` resolves a real stack through `getComputedStyle(document.body).fontFamily`
  instead. Reading is not touching — nothing is written to the host page — but it is the one
  place this widget looks outside `#nest-chatbot` at all.
- **A weight with no face registered resolves *down*.** Only 400 and 600 ship. `font-weight: 500`
  searches weights below the target before above, so it renders 400 while reading as if it asked
  for something heavier. State 400 or 600.

**The default mode's fonts load at boot, on every page view.** It is easy to convince yourself
otherwise — `@font-face` is lazy, and the launcher paints no text (an `<img>` plus a CSS dot), so
nothing *visible* should be asking for a font before the guest clicks. The panel is what asks:
closed, it is `visibility: hidden`, **not** `display: none`, so its header, greeting and composer
are laid out and pull all three files. Measured cold, 45.5KB starting at 35ms — one millisecond
after `DOMContentLoaded`, panel hidden, teaser still 8s away. `font-display: swap` keeps it off
the *painting* critical path; the bytes are spent either way. So `data-fonts="host"`/`"system"`
is a genuine page-weight saving, not only a de-duplication.

Measuring it again needs one precaution: **on a warm cache the opt-out modes still show
resource-timing entries for the fonts.** They carry `transferSize: 0` and their `document.fonts`
status stays `unloaded` — cache reads of something the engine never used. Judge by transferred
bytes and face status, never by the length of the network list, or you will "reproduce" a
regression that is not there.

## The transcript scrolls itself exactly once per turn

Since 2.6.0 there is no `scrollDown()`. **`anchorSend()` is the only thing that moves the view on
its own**, once, when the guest sends: their message goes to the top so the reply has the whole
panel to grow into. Nothing after that scrolls — not the thinking dots, not the typer, not the
cards. The ⌄ cue (`.nc-scroll-cue`) is the way to the latest content.

That is a rule with a reason. It used to pin the bottom from a dozen sites including every eighth
character of the reveal, so any reply taller than the panel scrolled its own opening line away
while the guest read it. **If you are adding a render path, call `afterRender()`, never a scroll.**

Three things are easy to get wrong here:

- **The anchor cannot work without the pad.** `scrollTop` can never exceed
  `scrollHeight - clientHeight`, so on a real transcript the anchor just clamps and the message
  lands wherever the content happens to end. `anchorFloor` + `applyAnchorPad()` make up the
  shortfall as `padding-bottom` and melt it as the reply fills the room. Delete the pad and the
  anchor silently stops working — it will still *look* implemented.
- **Follow is cancelled against `autoTop`, the scrollTop we last wrote — never against "am I at
  the bottom".** The typer appends between our write and the browser's async scroll event, so a
  bottom test reads an already-grown `scrollHeight` and the reply cancels its own follow.
- **The cue's focus rescue is the main path, not an edge case** — see the focus rule under
  Conventions.

The cue re-syncs at `open()`, `resyncCarousels()`'s post-transition beat, `adjustInputHeight()`
and the restart wipe. There is deliberately **no** resize listener, and the reason is the trade
rather than the listener count: a resize handler earns its keep only by re-measuring on every
frame of a drag, and what it would buy is closing a gap the carousel arrows already live with —
a viewport resize can leave the cue briefly stale until the next scroll or the next message.
(Until 2.10.3 this paragraph also leant on "the widget attaches no `window` listener at all".
It does now — `popstate`, for the Back button — so the argument stands on its own cost/benefit,
which is where it always actually rested.)

## The Back button is the one thing that reaches outside `#nest-chatbot`

Since 2.10.3 `open()` pushes a session-history entry and `close()` pops it, so the device Back
button dismisses the panel instead of leaving the customer's site. Below 1024px the panel is
fullscreen — it *looks* like a screen, and Back is what dismisses a screen. iOS Safari's
edge-swipe rides the same event. It applies at **every** width: behaviour cannot live in a media
query, so a `matchMedia` gate would be a second source of truth with no stylesheet half to agree
with (the same argument `boot()` makes about the expanded sheet).

This is the widget's only exception to *"the host page is not ours"*, and the four things that
keep it defensible are all easy to undo by accident:

- **`pushState` never gets a third argument.** The URL must not change. A fragment would show in
  the address bar, break hosts that route on it, and turn a dismissible panel into a navigable
  page. `replaceState` is likewise never used — it destroys a host entry instead of adding one.
- **`history.back()` fires only when `history.state.ncPanel` is on the *current* entry.** If the
  host's router pushed over us, one dead entry is a small cost; walking a customer's app
  backwards is not a cost we get to impose.
- **The pushed state CLONES the host's `history.state`** and adds `ncPanel` to it, rather than
  replacing it with a bare marker. Next.js's App Router hard-**reloads** the page on a `popstate`
  whose state lacks `__NA`, so a bare marker turns "close the chat" into "reload the customer's
  site" the moment one of their routes sits above ours. Our entry is the same URL, so to their
  router it reads as the same route — a no-op.
- **`onPopState()` returns early when it is standing on our own entry.** This is not belt and
  braces, it is load-bearing twice over: single-spa patches `pushState` to dispatch a
  **synthetic `popstate`**, so the naive `if (isOpen()) close()` would slam the panel shut on the
  very click that opened it; and a host router pushing over us would otherwise have its Back
  press eaten by our panel. Reading the marker as a reason **not** to act is the safe direction —
  a host who `replaceState`s over it drops through to closing, which is the behaviour we would
  have had with no check at all.

Three more things that will bite:

- **There is no re-entrancy flag and none is needed.** Do not add one. `close()` removes
  `nc-open` synchronously and then pops, so the `popstate` that follows finds `isOpen()` false;
  `onPopState()` clears `pushedEntry` **before** calling `close()`, so `close()`'s own pop is a
  no-op and cannot navigate the host backwards. A flag set and cleared inside `close()` would be
  long gone by the time an async `popstate` ran.
- **`history.length` is the wrong thing to assert on.** A push at a non-tip position truncates
  the forward entry, so after one open/close cycle the length stays flat while the cursor still
  moves. Measured: fresh tip `len 1 / idx 0` → open `2 / 1` → close `2 / 0` → re-open `2 / 1`.
  The stack never grows; the **cursor** is what proves the entry is real.
- **`teardown()` removes the listener and deliberately does not pop.** It is reached from a live
  `403`, not from `close()`, so the panel can still be open — and a widget being destroyed must
  not navigate the page on its way out. The entry is orphaned: one Back press appears to do
  nothing before the next one leaves. A dead widget's dead entry is the cheaper failure.

**The auto-open caveat is a browser rule, not ours.** Chromium marks a history entry skippable
by the back/forward **UI** if the document has received no user activation — but activation
counts whether it arrives *before or after* the push, and it explicitly does **not** apply to the
`history.back()/forward()` APIs, so our own pop always lands. So the only losing case is
`data-auto-open` with a guest who taps nothing at all and then presses Back. Any tap anywhere,
including the one that opens the panel, retires it. Do not try to fight the intervention; the
browser is defending against exactly the pattern we are using.

## Local development

```bash
python -m http.server 5501        # from the repo root
# then open http://127.0.0.1:5501/demo/index.html
```

`.vscode/settings.json` already pins Live Server to 5501.

The demo page runs on the local fixtures via `data-mock="true"`; drop the attribute (and add
`data-api-base` + `data-key`) to hit a real backend. Fixtures live in the `Mock` object and
are shaped exactly like the real envelope. Drive them from the composer:

| Type this | Exercises |
|---|---|
| `book` | `booking_link` with a stay summary |
| `contact` | `contact_channels` (phone + whatsapp + email) |
| `rooms` | `availability` — the 1.8.0 showcase: a per-bed and a per-room option carrying `basis`/`units`/`total`, rendered verbatim as "2 beds · 200.00 EUR total", plus one option without the trio that must render exactly as before |
| `link` | three `link_button`s (book / website / directions), one with `style: primary` |
| `cardstay` | the 1.10.0 pair (D-073): `[property_cards (one item), availability]` on one turn, card **first**, CTA url == `availability.url`. Exactly **one** Book affordance may render — the card's — and all three option rows must survive it (a party row, a single-unit row, one option with no `basis`/`units`/`total`; three groups of one, so no fold button). Suppression path: the per-turn `rendered` set |
| `cardbook` | the other arm: `[property_cards, booking_link]`, equal urls, and **no** `cta_label` so both would have said "Book now". Suppression path: the `cardUrls` pre-scan — the branch that was dormant from 2.5.0 until 1.10.0. Tested **above** `book`: these are `indexOf` matches and `cardbook` contains `book` |
| `available` | `async_result` — interim reply, then the poll replaces it in place; the final is an `availability` sharing the interim's **server-composed** url byte-for-byte (1.9.0, no `adults` — unstated party), so the per-turn dedupe must leave exactly **one** Book button; the final's option is the singular "1 bed" total path |
| `hostel` | `quick_replies` — the three island chips, carrying the 1.7.0 `heading` (also matches suggested prompt 1); any send retires every row **and its heading** (one-shot) |
| `tenerife` `canaria` `ibiza` | `property_cards` carousel + `promo_card` + the CTA trio — and the 1.6.x showcase: per-card `period`/`basis` (two different suffixes in one rail), a `cta_label`, the D-043(c) isolator (name-less card sharing the website button's url — card dropped, button survives), a Book button matching a rendered card's url (suppressed) — both 1.9.0 composed strings with a query, so the dedupe is proven through `?`/`&` — and `total`/`more` (ibiza: `total` only → count line; the others: both → `more` wins) |
| `pass` `offer` | `promo_card` alone (`pass` is word-bounded: "compass" falls through) — Spanish copy with `locale: 'es'` (→ `lang`) and a `\n` in the body (pre-wrap) |
| `human` | the 1.12.0 unbound handoff (D-079): the reply asks which hostel, over a `quick_replies` row with `id: 'property_choice'` and **thirteen** chips (catalog names, alphabetical, no `locale`, no `heading`) — and **no** `contact_channels`. The row must wrap whole inside a 400px panel. A chip sends `It's about <name>` verbatim, which answers with that hostel's `contact_channels`; that answer branch sits **above** every content keyword, because a hostel name inside it must never be caught by an `indexOf` test |
| `!cap` | the turn-cap reply: `contact_channels` + `conversation_ended` last — composer closes, "start a new chat" appears |
| `!unknown` | an unrecognised element type (must be ignored, sibling still renders) |
| `!xss` | a hostile reply and a `javascript:` url (both must be inert) |
| `!410` `!403` `!429` `!500` | forces that status |
| `!429 60` `!429 80000` | a `429` carrying that `Retry-After` (1.11.0): 60 keeps "try again in a moment", 80000 shows "come back later". Bare `!429` is the header-less control and must read as `60` does, with `retryAfter: null` |

`Mock.init` returns **two** `quick_replies` rows — the tenant's "try asking" prompts and the
island chips — mirroring a real welcome payload; both prompt messages chain into the table above
rather than the catch-all reply. Only the island row carries a `heading`, on purpose: one page
load then shows a headed row and a bare one side by side. It also serves the 1.7.0 init pair,
`idle_hours` and `server_time`. Since server chips **replace** the widget's own pack block, that
means the demo never reaches `showPrompts()` or `setLocale`'s pill-repaint branch: exercising
the fallback means temporarily setting `Mock.init`'s `actions: []`.

**`?nc-idle=<hours>` on the demo URL overrides the fixture's `idle_hours`** — the only way to
get a window short enough to actually cross (`?nc-idle=0.005` is 18 seconds, where a real
server's smallest step is an hour). A harness knob and only ever that: the whole `Mock` object
is unreachable without `data-mock`, which a production page never sets.

**`?nc-init-429=<seconds>` makes every mock init answer `429` with that `Retry-After`** — the
other half of the throttle copy, unreachable from the composer because every keyword runs on the
turn endpoint after init has already succeeded. Open the panel (the `init` `wchat:error` carries
`retryAfter`), then send anything: the re-init is refused again and the guest sees the copy the
number earns. Same knob rules as `?nc-idle`. **The mock never exercises `request()`** — the
header-reading line itself is only proven over a real XHR, so a change there wants a
cross-origin fake that sends `Retry-After` both exposed and **un**exposed.

The demo page also carries the host-side half of the events seam — one listener on the
umbrella `wchat` event, logging to the console and to `window.wchatLog`. Driving the table
above with that open is how the event payloads get checked. It sits **below** the widget's own
`<script>` and still catches `wchat:ready`, because that tag is `defer` and an ordinary inline
script runs during parsing: only an async-loaded tag (GTM, a third-party snippet) can miss
ready, which is what `NestChatbot.state` is for.

### The panel-size flags will confuse you before they confuse a guest

Three flags decide how the panel is sized. Two of them outlive the tab and only one is ever
cleared by the widget — so a machine that has been used to *test* the expanded sheet has
auto-expand switched off, permanently, and nothing on screen says so.

| Key | Store | Written by | Cleared by |
|---|---|---|---|
| `nest-chatbot:auto-expanded` | `sessionStorage` | `maybeAutoExpand()`, the once-per-session auto-expand | closing the tab — nothing else |
| `nest-chatbot:user-shrank` | `localStorage` | `shrinkPanel(true)`, i.e. the guest pressing ⤡ | **nothing, ever** |
| `nest-chatbot:expanded` | `localStorage` | `expandPanel()` — **any** expand, guest or auto | `shrinkPanel()` — any shrink |

The last one is the panel's *current* size, restored by `boot()` so a reload does not drop a
guest out of the wide sheet. It answers a different question from `user-shrank` and both are
needed: a guest who shrank once (auto-expand suppressed forever) and later expanded by hand
gets their expanded panel back. It is not gated on `matchMedia('(min-width: 1024px)')` — every
expanded rule lives inside that media query, so below 1024px the class is simply inert.

⤢/⤡ is a single toggle, so expanding the sheet to look at it and collapsing it again *is*
`shrinkPanel(true)` and writes the permanent flag. `maybeAutoExpand()` then reads it as a
stated preference and never auto-expands in that browser again. This is working as specified —
a guest who has pulled the sheet back in once has said something — it is just far easier to
trip during development than in a guest's session. Reset all three from the console:

```js
localStorage.removeItem('nest-chatbot:user-shrank'); localStorage.removeItem('nest-chatbot:expanded'); sessionStorage.removeItem('nest-chatbot:auto-expanded');
```

The realistic test is serving the widget and the host page from **different origins** — that is
what a customer hits. Run a second static server on another port with a page that points its
`src` at 5501.

### The browser will run your last edit's predecessor

`python -m http.server` sends no `Cache-Control`, so Chromium is free to reuse `nest-chatbot.js`
from its own cache across ordinary navigations — including the reload you do to check a change.
The page still boots, still reports the current `VERSION` (which you did not bump for a one-line
fix), and behaves *almost* right, so the natural conclusion is that the new code is broken. It
was never loaded. This cost a verification pass here: a freshly added debug line "did not fire"
because the browser held a 197,501-byte copy while the file on disk was 199,168.

The cheap habit that removes it: **assert the source before trusting the result.**

```js
// in the page, before you measure anything
const src = await (await fetch(document.querySelector('script[src*="nest-chatbot"]').src)).text();
src.indexOf('the string you just added') !== -1;   // must be true
```

A hard reload works when a human is driving. It is not reliably available to an automation
harness, so the robust move there is to **serve the repo on a fresh port** — a new origin has no
cache entries, and no `localStorage` either, which is usually what you wanted anyway.

## Open items

- **No transport timeout.** `request()` sets no `xhr.timeout`, matching the reference — a
  stalled connection pins `busy` until the browser gives up. Adding one needs a
  double-callback guard (`ontimeout` and `onreadystatechange` both fire); do it deliberately
  or not at all.
- **Rotate the leaked Voiceflow key** if it has not been done, and the Google Gemini key
  that shipped live from `b837cff` and was only commented out in `219a265` (see rule 3).
- **The CDN must send `Access-Control-Allow-Origin` on `fonts/`.** Since 2.4.0 the widget
  self-hosts its WOFF2 files, and a cross-origin `@font-face` fetch is CORS-gated even when
  the stylesheet next to it is not. Serve the header (`*` is enough — the files are public
  and the licences ship beside them) on `fonts/*.woff2`, or every host page drops to the
  system stack. Nothing on screen says so and the widget keeps working — the only trace is
  the browser's own CORS error in devtools — so verify from a page on a **different** origin,
  never from the CDN's own domain. `data-fonts="host"` / `"system"` are immune rather than a
  fix: they fetch nothing, so there is nothing left to block. The default path still needs
  the header.
- **All three upstream asks were delivered in contract 1.7.0 (D-050) and adopted in 2.10.0** —
  `idle_hours`, `server_time` and `quick_replies.heading`. What is left of each:
  - **`idle_hours`** closed the one that mattered. The window now comes from the server on
    every init and rides the stored record. `IDLE_MS` survives only as the fallback for an
    older server or an older record — **do not go back to treating it as the number**.
  - **`server_time`** fixes device-clock *skew*, not the *timezone* case: a guest who changes
    zone between visits still sees their days recomputed, and there is still no per-turn
    timestamp. Both remain correctly described in `docs/proposals/message-timestamps.md`,
    which is now the design record for what the widget does rather than a request. Do **not**
    ask for a top-level `created_at`: contract §Envelope states those three keys are the whole
    top-level surface and always will be.
  - **`heading`** closed open point 9 of `docs/proposals/response-contract-phase2-elements.md`.
    A chip row can say what it asks; absent still means bare, and substituting our own label
    is still wrong.
- **Both halves are deployed, and the window is a live seven days.** Measured 2026-08-23 20:56 UTC
  off a real init `201` against `nest-mind.laravel.cloud`: `contract_version: 1.7.0`,
  `idle_hours: 168`, `server_time` present. So 2.10.x now learns the window from the server on
  every init and carries it in the record, exactly as designed. Re-measured 2026-08-27 00:41 UTC
  at the 2.11.0 sync, same origin: `contract_version: 1.9.0`, `idle_hours: 168`.
  **The condition this bullet used to warn about was not met.** The bug needed the deploy to land
  while a **pre-1.7.0** widget was still in the field; the widget serving
  `nestshostels.com` is `2.10.3` / `BUILT_AGAINST 1.7.0`, so server and widget agree at 168h.
  What remains is a smaller, self-draining version: a record written **before** the deploy has
  `idleHours: null` and `storedIdleMs()` judges it at the 24h `IDLE_MS` fallback while the server
  holds it for a week. Such a record is unreadable 24h after its own last activity, so the cohort
  drains within a day of the deploy — with one long tail, because a guest who keeps returning
  inside 24h never re-inits, so the resume branch restores `serverIdleHours = null` and `persist()`
  writes `null` back. That record stays on the 24h judgment until the guest gaps past it once,
  which is exactly when it costs them their transcript and opens a second conversation against one
  still holding the working memory `data-property` seeded. Degraded, not broken; once per guest;
  self-healing.
- **The signal for that desync is NOT a `410` — this doc said so for two releases and was wrong on
  the mechanics, not merely out of date.** A `410` means the *server* expired first, which is the
  opposite desync. When the widget's window is the **shorter** one, nothing ever 410s: a guest
  returning inside it resumes and the server still has the conversation (`200`), and a guest
  returning outside it hits `readStore()`'s expiry check, which returns `null` and drops the record
  — so the dead uuid is **never sent** and no request exists that could fail. Watching for a `410`
  spike here is watching for something that cannot fire. The observable signal is on the events
  surface: **`wchat:ready` arriving with `returning: false` where it should be `true`** — a fall in
  the returning rate and a rise in conversations per visitor.
- **Anchor this fact to a `201`; it has now flipped twice, both times from reading an env file.**
  `65b0742` corrected the docs *from* "a live seven days" *to* "24h, latent" because the `168` in
  `nest-mind`'s env could not be read by the deployed 1.6.2 build; this entry corrects that back,
  because the deploy landed. Neither error was about the number — both were about deriving it from
  configuration instead of from a response. **Read `contract_version` and `idle_hours` off a real
  init `201` before asserting anything here, and never re-derive the window from `nest-mind`'s
  env** — that is the *local* repo's config, not the deployed instance's, and even the deployed
  instance's env is not evidence of what the running build does with it. `demo/demo.html`
  (gitignored) holds a real public key and the live `apiBase` for exactly this check.
- **A persistent visitor token at init is deliberately NOT asked for yet.** It is the only way
  to answer "same person, cross-device" or "came back after the window", and the only way to
  put the answer in wSuite's own panel rather than in each host's GA4 — but it is a
  cross-session identifier for a person, on EU properties, and needs consent treatment and a
  retention policy before it can ship. The widget's storage today is functional and
  short-lived, which is much of why it has been uncontroversial. Extending the idle window
  answers most of the same question for free — and as of 2026-08-23 that extension is **live**:
  the deploy landed and the window is a measured 168h (see above). The deferral said "revisit if a
  real question survives the deploy", and the deploy has now happened, so that condition is
  discharged: the next move is to ask whether a question actually survives a week-long window
  before reaching for a cross-session identifier, not to treat the token as pending.
  Inferring visitors server-side from IP + user-agent was considered and **rejected**: guide
  §6 names "a hotel's own wifi" as a case where strangers share one bucket, and our guests are
  mostly on property wifi — it would merge strangers and split one guest across their phone
  and the lobby machine.
- **`wchat` is the destination namespace; the rest of the vocabulary has not moved.** The
  2.8.2 events are `wchat:*` because this widget should be able to go Nest-independent one
  day, and they were new surface — free to name, and expensive to rename later (a MAJOR).
  `window.NestChatbot`, `#nest-chatbot`, the `nc-` prefix, `STORE_KEY` and the file names
  deliberately did **not** change: that is a **3.0.0** with real host cost — renaming a
  `window.NestChatbot` method is breaking by this file's own rule, README documents hosts
  writing `#nest-chatbot { --nc-edge-x: 2rem }` in their own stylesheets, and a `STORE_KEY`
  change drops every guest's live conversation at deploy. When it happens it should be one
  deliberate release with a host migration note, and worth designing a read-old/write-new
  `STORE_KEY` so no guest pays for it. Until then README carries one sentence explaining the
  mixed vocabulary.
- **Origin allow-listing shipped platform-side (D-039)** — opt-in per site, default
  allow-all. Once a site configures a list, every embedding origin must be registered
  (guide §7, exact `scheme://host[:port]`) or requests are refused with
  `403 {"message":"Origin not allowed."}`. Register production and staging origins before a
  public launch. Prefer giving staging its **own site + key** (guide §7.1): the rate ceiling
  is per key, so a shared key lets a staging load test or retry loop 429 real production
  guests.

## Conventions

- Comments explain **why**, not what. The code says what.
- Comments and identifiers in English. The old codebase mixed Italian and Spanish comments.
- Keep the section banners in `nest-chatbot.js` — they are the file's table of contents.
- Anything user-visible goes through `t()` / `tf()`, never a hardcoded string. **The converse is
  equally a rule and is the half that gets forgotten:** anything **payload**-supplied reaches the DOM
  through `textContent` and is never re-derived from a pack — repainting a tenant's string from our
  own table is inventing a translation they did not write. Which is which, per element, is
  `docs/rendering-ownership.md`.
- **Anything that removes or hides a node checks `document.activeElement` first.** If the node
  contains it, move focus somewhere still visible inside `#nest-chatbot` before the node goes.
  A removed or `display: none` element drops focus to `<body>`, so the guest's next Tab
  restarts at the top of the *customer's* page; a merely invisible one is worse, stranding them
  on a control they cannot see. This repo has rediscovered that bug six times — the teaser,
  the carousel arrows, the prompt pills, the language row, the scroll cue, and the header ⋯
  menu. In the last two, hiding a focused node is the control's *main* path rather than an edge
  case: pressing ⌄ scrolls to the bottom, which is exactly the condition that hides ⌄, and
  every way of dismissing the menu hides an item the guest may be standing on. It is a rule,
  not a case.
- Never touch `document.documentElement.lang`, the host's `<body>`, or anything outside
  `#nest-chatbot`. The host page is not ours. **Session history is the one deliberate
  exception** (2.10.3, the Back button) — which is exactly why it is the only behaviour in the
  widget carrying a `data-*` opt-out, why the URL is never touched, and why `history.back()`
  fires only when the top entry is demonstrably ours. See the Back-button section.
- **Commit subjects follow Conventional Commits** (adopted 2026-08-23): `type(scope)?: Subject`,
  imperative, **capitalised** after the colon, no trailing period. That casing matches this repo's
  own history and `nest-mind`'s existing practice, so one habit covers both. Types in use: `docs`,
  `feat`, `fix`, `refactor`, `chore`. **Scope is usually omitted** — this repo is one widget, so
  there is rarely a second surface to name. A release is `chore(release):` carrying the version,
  which keeps the version-bump rule below and the subject line answering the same question. The
  body is where this repo does its real work: say *why*, name the precedent commits, and record
  what was measured rather than assumed.
- Version bumps err small: **patch unless the embed contract changes.** Everything
  non-breaking is a patch — a bug fix, new UI behaviour, a new `data-*` attribute, a new
  runtime-API method, a whole new stored surface. Reserve **minor** for a contract sync (a
  fresh `docs/wsuite/` packet and a `BUILT_AGAINST` move), and **major** for breaking the
  embed contract: renaming or removing a `data-*` attribute, dropping a `window.NestChatbot`
  method, or changing what a host's `<script>` tag has to say. Additive is never breaking.
  Releases through 2.8.0 predate this rule and are **not** renumbered — 2.6.0, 2.7.0 and
  2.8.0 would each be a patch under it.
  2.8.1 and 2.8.2 are the first releases numbered by it, and 2.9.0 / 2.10.0 are both syncs.
  2.10.1 is the close-out patch that followed the 1.7.0 sync — documentation the sync had
  falsified, plus two hardening fixes, and **no** `BUILT_AGAINST` move (it moves only during a
  sync). 2.10.2 is the header ⋯ menu: new UI behaviour and three restart-race fixes, no
  `data-*` attribute, no runtime-API method, so a patch by this rule and not a minor.
  2.10.3 is the device Back button closing the panel: new UI behaviour, one additive `data-*`
  attribute (`data-back-button`) and one additive `wchat:close` enum value — all three named in
  this rule as patch-shaped, and additive is never breaking.
  2.11.0 is the 1.9.0 sync (D-067, D-071): a fresh packet and a `BUILT_AGAINST` move — the minor
  case — plus the one renderer line 1.8.0 asks for, seven pack keys and one CSS rule, all
  patch-shaped on their own.
  2.11.1 is the folded availability card: new UI behaviour, seven CSS rules, four pack keys in and
  three **out**, and no `data-*` attribute, no `window.NestChatbot` method and no `BUILT_AGAINST`
  move — a patch by this rule. Removing a **pack key** is not breaking: packs are internal, and
  the embed contract is what a host's `<script>` tag has to say.
  2.12.0 is the 1.10.0 sync (D-072, D-073): a fresh packet and a `BUILT_AGAINST` move — the minor
  case — and **nothing else that would have earned a number**. No renderer changed, no `wchat:*`
  name moved; what moved besides the constant was two comments the contract falsified and two mock
  fixtures. That is the shape a sync is allowed to be: the rule keys on the packet and the
  constant, not on how much code the row happened to ask for.
  2.13.0 is the 1.11.0 + 1.12.0 sync (D-078, D-079): a fresh packet and a `BUILT_AGAINST` move —
  the minor case once more. It is also the first sync to **adopt an optional row** rather than
  only move the constant: the `Retry-After` copy (one pack key, `retryLater`) and one additive
  `wchat:error` field, `retryAfter`. Neither would have earned more than a patch on its own, and
  neither changes the number: the packet and the constant already made it a minor. 1.12.0 asked
  for nothing and got nothing but a fixture.
  The next is **2.13.1** unless it is a sync.
