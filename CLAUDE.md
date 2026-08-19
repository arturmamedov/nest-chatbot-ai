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
| `storage` | `{uuid, ts, actions, turns, guestTurned, ended}` in `localStorage`, 24h idle window — the init `actions[]` and the display-only transcript ride along so a resume replays the conversation, not just the welcome; `ts` is last activity |
| **`events`** | **the host-page seam** — `emit()`, `snapshot()`, the `wchat:` vocabulary |
| **`api`** | **the seam** — `init` / `send` / `poll` plus the mock fixtures |
| `dom` | `el()`, `attrs()`, `svgNode()`, the icon and flag constants, `build()` |
| `render` | bubbles, thinking dots, `renderAction()`, `safeHttpUrl()` |
| `typing` | the character-by-character reveal |
| `intro` | the circular-progress loader sequence |
| `flow` | open/close, submit, status handling, teardown, the async poll |
| `boot` | listeners, `window.NestChatbot`, entry |

**Why a classic IIFE and not ES modules.** `document.currentScript` — how the widget reads its
`data-*` config and finds its own asset base — is `null` inside `type="module"`. A module build
would also mean a module graph waterfall and MIME/CORS gotchas on customer servers. One
cacheable file is simpler for everyone. The sibling reference widget made the same call.

**Assets resolve against the script's own URL**, never the host page. `new URL('./', script.src)`
is what lets the widget be served from a CDN while the host page lives anywhere.

## The API

`docs/wsuite/` is the authority — do not re-derive or duplicate its rules here:

- **`response-contract.md`** — the versioned reply envelope (currently 1.6.1 — see its
  Changelog and Versioning policy) and every element type.
- **`integration-guide.md`** — transport, auth, endpoints, errors, rate limits, CORS.
- **`chatbot.reference.js`** — the platform's own security-reviewed widget. When a transport or
  contract detail is unclear, read how this does it. Pinned copy; may drift from upstream.

**Contract sync.** `docs/wsuite/` is a vendored, read-only packet: at a sync it is replaced
wholesale from the upstream tag (`chatbot-contract-v<X.Y.Z>`), never hand-edited.
`BUILT_AGAINST` (api section) moves **only** during a sync — it is a claim about what this
code implements, not a mirror of the docs. `VERSION` is the widget's own independent release
line; it and `window.NestChatbot.version` are the only version sites (no package.json —
rule 1). Releases are recorded in `CHANGELOG.md`. Current packet: synced 2026-08-02 as
`docs @ chatbot-contract-v1.6.1 (90f3cfd) · widget @ e66fe4f` — the widget SHA is part of the
packet's identity, because the reference renderer legitimately moves between contract tags.
`BUILT_AGAINST` is `'1.6.1'`, in lockstep since release 2.5.0 closed the sync.

Three endpoints: init a conversation, post a turn, poll an async turn.

```
POST {apiBase}/api/v1/chatbot/conversations               → 201 {conversation:{uuid}, greeting,
                                                                 contract_version}
POST {apiBase}/api/v1/chatbot/conversations/{uuid}/messages → 200 {reply, actions[], turn}
GET  {apiBase}{async_result.url}                          → 200 {status, reply?, actions?, turn}
```

### Things that will bite you

- **A turn always returns `200`.** Provider, budget and LLM failures degrade server-side to a
  localized "busy" reply. A 5xx is a bug, not a business outcome. The non-200s are resolution
  failures only: `401` bad key, `403` disabled/revoked or the request `Origin` is not on the
  site's allow-list (body `{"message":"Origin not allowed."}` — guide §7), `404` unknown uuid,
  `410` idled out, `422` config, `429` throttled.
- **`410` is normal.** Conversations idle out after 24h. Re-init transparently and resend the
  message once — the guest should never see it happen. Already implemented in `sendMessage`.
  On the **turn** endpoint a `404` rides the same branch (guide §5.1: the stored uuid is
  dead — re-init, or this browser retries it for the full 24h retention window). On the
  **poll** endpoint a `404` is **transient** instead: back off exactly as for `pending` and
  stop only at the give-up deadline — re-initing there would abandon an answer still being
  generated. A poll **`410`** stops the poll and nothing more (guide §5.1): keep the interim
  reply, re-init **nothing** — the guest's next message re-inits on the turn endpoint, where
  a fresh conversation actually has a message to carry.
- **Never infer a price period.** `price_from.period`/`basis` are optional and **per item** —
  two cards in one rail may differ, so `cardPrice()` resolves the suffix per card and renders
  the **bare** price when they are absent. An invented "/night" on a per-stay figure is a
  guest-facing pricing error, not a cosmetic one.
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
  Visitors sharing an egress IP (a hostel's own wifi, corporate NAT, carrier CGNAT) share
  **one** visitor bucket — our guests are mostly on property wifi, so budget for that.
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
| `data-auto-open` | `false` | |
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
  `teardown()`'s "exactly two listeners outside `#nest-chatbot`" claim survives — dispatching
  attaches none.
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
and the restart wipe. There is deliberately **no** window resize listener (`teardown()` claims the
widget attaches exactly two listeners outside `#nest-chatbot`, and that claim stays true), so a
viewport resize can leave the cue briefly stale — the same accepted gap the carousel arrows have.

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
| `rooms` | `availability` with room options |
| `link` | three `link_button`s (book / website / directions), one with `style: primary` |
| `available` | `async_result` — interim reply, then the poll replaces it in place; the final is an `availability` sharing the interim url, so the per-turn dedupe must leave exactly **one** Book button |
| `hostel` | `quick_replies` — the three island chips (also matches suggested prompt 1); any send retires every row (one-shot) |
| `tenerife` `canaria` `ibiza` | `property_cards` carousel + `promo_card` + the CTA trio — and the 1.6.x showcase: per-card `period`/`basis` (two different suffixes in one rail), a `cta_label`, the D-043(c) isolator (name-less card sharing the website button's url — card dropped, button survives), a Book button matching a rendered card's url (suppressed), and `total`/`more` (ibiza: `total` only → count line; the others: both → `more` wins) |
| `pass` `offer` | `promo_card` alone (`pass` is word-bounded: "compass" falls through) — Spanish copy with `locale: 'es'` (→ `lang`) and a `\n` in the body (pre-wrap) |
| `!cap` | the turn-cap reply: `contact_channels` + `conversation_ended` last — composer closes, "start a new chat" appears |
| `!unknown` | an unrecognised element type (must be ignored, sibling still renders) |
| `!xss` | a hostile reply and a `javascript:` url (both must be inert) |
| `!410` `!403` `!429` `!500` | forces that status |

`Mock.init` returns **two** `quick_replies` rows — the tenant's "try asking" prompts and the
island chips — mirroring a real welcome payload; both prompt messages chain into the table above
rather than the catch-all reply. Since server chips **replace** the widget's own pack block,
that means the demo never reaches `showPrompts()` or `setLocale`'s pill-repaint branch:
exercising the fallback means temporarily setting `Mock.init`'s `actions: []`.

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
- **The server reports contract 1.6.2; the vendored packet has no row for it.** So the one-time
  drift warn fires today, which is correct and harmless (guide §3.1 — warn, never gate; the
  ignore-unknown rule keeps the widget whole). What the adoption costs **cannot be read from
  this repo**: `docs/wsuite/` is pinned at 1.6.1 and `grep -rn "1\.6\.2" docs/` returns nothing.
  The policy says a PATCH is "a wording/clarification fix with no wire effect" and is never
  breaking, which argues for *bump the constant, change no renderer* — but do not conclude that
  without reading the row, because **1.6.1 was itself a no-wire-effect patch that still required
  a code change** ("resolve the suffix per card, not once per rail"). Ask for the
  `chatbot-contract-v1.6.2` packet and let the normal wholesale sync move `BUILT_AGAINST`.
- **An element-level `heading` on `quick_replies` is still the live request upstream**
  (`docs/proposals/response-contract-phase2-elements.md`, open point 9): 1.6.1 still gives a
  chip row no way to say what it is asking, so a server welcome row renders as bare chips
  under a greeting that does not mention them.
- **Ask for `idle_hours` in the init `201` — the upstream request that matters most now.**
  `IDLE_MS` (storage section) is a hardcoded 24h whose comment says it "mirrors the API's
  conversation idle window", and the contract has no field to drive it: `grep -rn
  "idle_hours" docs/wsuite/` returns nothing. The window is going to a week or more. **The day
  the server moves and this constant does not, a guest returning at hour 30 loses their
  transcript and opens a second conversation while the server's original is still live** —
  still holding the working memory `data-property` seeded. The field costs no privacy, makes
  the window self-correcting forever, and as a side effect stretches how far back
  `wchat:ready`'s `returning` can see. Bundle it with the `heading` request above. A spike in
  `wchat:error {phase:'turn', status:410, retrying:true}` is what this desync looks like from
  the outside — part of why that event reports the transparent retry at all. Written up in
  `docs/proposals/visitor-measurement-and-events.md` § The ask upstream, unsent.
- **Nothing records *when* a message happened, so the widget's clock is the guest's.** The
  contract has no time field anywhere — not on the envelope, not on an element, not on the
  init `201` (`timestamp`, `created_at`, `sent_at`, `server_time` all return nothing across
  `docs/wsuite/`); `turn` is an order, not an instant. So 2.8.1's day separators date entries
  from `at`, stamped client-side, which means a replay shows the **sending** browser's clock
  and a guest who changes timezone between visits sees the days recomputed in the new zone.
  Day granularity absorbs that — minutes of skew never move a date — and it is why there is no
  visible per-message clock. **The growing window is what sharpens it**: at 24h a transcript
  spans two days and Today/Yesterday is right essentially always; at a week the same code
  dates several days for a traveller. Asked for as `server_time` on the init `201` — the same
  shape as the `idle_hours` request above, for the overlapping reason, so **send them
  together**. Written up in `docs/proposals/message-timestamps.md`, unsent. Do **not** ask for
  a top-level `created_at`: contract §Envelope states those three keys are the whole top-level
  surface and always will be.
- **A persistent visitor token at init is deliberately NOT asked for yet.** It is the only way
  to answer "same person, cross-device" or "came back after the window", and the only way to
  put the answer in wSuite's own panel rather than in each host's GA4 — but it is a
  cross-session identifier for a person, on EU properties, and needs consent treatment and a
  retention policy before it can ship. The widget's storage today is functional and
  short-lived, which is much of why it has been uncontroversial. Extending the idle window
  answers most of the same question for free; revisit only if a real question survives that.
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
- Anything user-visible goes through `t()` / `tf()`, never a hardcoded string.
- **Anything that removes or hides a node checks `document.activeElement` first.** If the node
  contains it, move focus somewhere still visible inside `#nest-chatbot` before the node goes.
  A removed or `display: none` element drops focus to `<body>`, so the guest's next Tab
  restarts at the top of the *customer's* page; a merely invisible one is worse, stranding them
  on a control they cannot see. This repo has rediscovered that bug five times — the teaser,
  the carousel arrows, the prompt pills, the language row, and the scroll cue, where hiding a
  focused node is the control's *main* path rather than an edge case: pressing ⌄ scrolls to the
  bottom, which is exactly the condition that hides ⌄. It is a rule, not a case.
- Never touch `document.documentElement.lang`, the host's `<body>`, or anything outside
  `#nest-chatbot`. The host page is not ours.
- Version bumps err small: **patch unless the embed contract changes.** Everything
  non-breaking is a patch — a bug fix, new UI behaviour, a new `data-*` attribute, a new
  runtime-API method, a whole new stored surface. Reserve **minor** for a contract sync (a
  fresh `docs/wsuite/` packet and a `BUILT_AGAINST` move), and **major** for breaking the
  embed contract: renaming or removing a `data-*` attribute, dropping a `window.NestChatbot`
  method, or changing what a host's `<script>` tag has to say. Additive is never breaking.
  Releases through 2.8.0 predate this rule and are **not** renumbered — 2.6.0, 2.7.0 and
  2.8.0 would each be a patch under it. 2.8.1 and 2.8.2 are the first releases numbered by it;
  the next is **2.8.3** unless it is a sync.
