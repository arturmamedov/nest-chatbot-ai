# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

**One drop-in chat widget.** A host website adds a single `<script>` tag and gets the branded
Nests chat bubble, talking to the wSuite chatbot API. Vanilla JS, no dependencies, no build step.
(The assistant's *name* is not ours: since contract 1.15.0 the site owner sets it in the wSuite
panel and it arrives with init — see "The assistant's name is data" under Things that will bite
you.)

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

Icons are inline SVG constants in `nest-chatbot.js` — never FontAwesome, never an image host
(the language flags, removed in 2.13.1, were the flagsapi.com case), never a webfont. A host
should have to trust exactly one extra origin: ours.
Text fonts follow the same rule the other way round: Poppins and Montserrat are self-hosted
`nc-`-prefixed WOFF2 files in `fonts/`, declared by `@font-face` in `css/nest-chatbot.css` and
resolved against `assetBase` — never `fonts.googleapis.com`, so the origin count stays at one.
Since 2.7.0 that is the **default**, not the only mode: `data-fonts` / `data-font-*` let a host
drop to their own or the system stack (`applyFonts()`). The escape hatch does not weaken the
rule — the alternative to shipping the files was always a second origin, never a lighter one.

### 2. Never `innerHTML`

Every guest, LLM and element-supplied string reaches the DOM via `textContent`,
`setAttribute`, or a created node. This is the response contract's explicit security rule
(`docs/wsuite/response-contract.md` §Security rule), not a stylistic preference. Form **values**
are the one other way in, and they are still never markup: the 1.14.0 `prefill` preview —
`preview.value = text` on a read-only textarea, the rule's own first option for the guest's quoted
words — and, since 1.16.0, a `form`'s pre-fills and option keys, set through DOM properties
(`input.value`, `option.value`) while every label, title and option text goes in through
`textContent` (`renderForm()` and its per-kind `*Field()` helpers).

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
`!important` and never more specificity than the attacker's own shape demands; ours already
outranks theirs on every property it states. The one measured exception to "1,1,0 is enough" is
the 1.16.0 form's `<input>`s: themes qualify input rules by type — `#top input[type="text"]`,
Enfold's `<body id="top">`, is 1,1,1 — so those controls are matched through their form
(`.nc-fill .nc-fill-control`, 1,2,0) and the demo page carries that trap too. `demo/index.html` carries the counterpart traps (a global `h2`, `textarea:focus` and
`a` rule copied from a real customer's Tailwind theme, and since 2.13.4 a caricature of
`@tailwindcss/forms` plus a theme's `label` and `fieldset` rules for the 1.16.0 form — `input`,
`select`, `[type="checkbox"]`, `label`, `fieldset`, and `fieldset textarea`, which reaches the
form's textarea and never the composer's), so a regression shows up on the demo page rather than
in production.

## Architecture

`nest-chatbot.js` is a single classic-script IIFE, organised in banner-delimited sections:

| Section | What lives there |
|---|---|
| `config` | reads `data-*`, derives `assetBase` from `script.src`, and resolves two locales: `locale`, the UI's, clamped to the five packs, and `requestLocale`, the preference the init and turn bodies carry — any two-letter primary subtag (contract 1.13.0); `redactForLog()` sits beside `log()` |
| `i18n` | UI strings per locale (`en es it de fr`); `tn()` picks the named or the name-free variant of the four keys that say who the guest is talking to |
| `storage` | `{uuid, ts, actions, turns, guestTurned, ended, idleHours, clockOffset, assistantName}` in `localStorage` — the init `actions[]` and the display-only transcript ride along so a resume replays the conversation, not just the welcome; `ts` is last activity. Since 2.10.0 the idle window and the server clock offset are the **server's**, carried in the record because the resume path never calls init; `IDLE_MS` is only the fallback. Since 2.13.2 the assistant's name (contract 1.15.0) rides the same way, validated by `cleanName()` |
| **`events`** | **the host-page seam** — `emit()`, `snapshot()`, the `wchat:` vocabulary |
| **`api`** | **the seam** — `init` / `send` / `poll` plus the mock fixtures |
| `dom` | `el()`, `attrs()`, `svgNode()`, the icon constants, `build()`, and `paintAssistant()` — the one writer of the header title, the dialog label, the placeholder and the launcher label |
| `render` | bubbles, thinking dots, `renderAction()`, `safeHttpUrl()`; since 2.13.4 the 1.16.0 `form` (`renderForm()`, one `*Field()` helper per kind, `retireForms()`) beside the chip rows it shares the one-shot rule with |
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

- **`response-contract.md`** — the versioned reply envelope (currently 1.16.1 — see its
  Changelog and Versioning policy) and every element type.
- **`integration-guide.md`** — transport, auth, endpoints, errors, rate limits, CORS.
- **`chatbot.reference.js`** — the platform's own security-reviewed widget. When a transport or
  contract detail is unclear, read how this does it. Pinned copy; may drift from upstream.

**Contract sync.** `docs/wsuite/` is a vendored, read-only packet: at a sync it is replaced
wholesale from the upstream tag (`chatbot-contract-v<X.Y.Z>`), never hand-edited.
`BUILT_AGAINST` (api section) moves **only** during a sync — it is a claim about what this
code implements, not a mirror of the docs. `VERSION` is the widget's own independent release
line; it and `window.NestChatbot.version` are the only version sites (no package.json —
rule 1). Releases are recorded in `CHANGELOG.md`. Current packet: synced 2026-10-27 as
`docs @ chatbot-contract-v1.16.1 (bfdecf5) · widget @ 7cbfdd0` — the widget SHA is part of the
packet's identity, because the reference renderer legitimately moves between contract tags
(here the two halves differ, as they did at 1.12.0 — `43101a6` against `cb8005b` — where 1.15.1,
1.15.0, 1.14.0 and 1.10.0 shared one sha because the bump commit moved the reference's
`BUILT_AGAINST` too). `BUILT_AGAINST` is `'1.16.1'`, in lockstep since release 2.13.4 adopted
D-109, D-111, D-112 and D-114 (D-113's click counting deliberately not — since accepted with
conditions, and building in 2.13.5; see "The widget never phones home").

**The widget is one step AHEAD of the deployment, and that is the quiet direction.** Measured
2026-10-27 15:32 UTC off a real init `201` against `nest-mind.laravel.cloud`: `contract_version:
1.15.1` (and `X-Chatbot-Contract: 1.15.1`), `idle_hours: 168`, `Access-Control-Expose-Headers:
X-Chatbot-Contract, Retry-After`, and an `assistant` object naming "Nesti". So 1.15.x is deployed,
and the name path built in 2.13.2 now has a name to paint: the header, the dialog label, the
placeholder and the launcher say the owner's name rather than the name-free wording. 1.16.1 is
tagged in `nest-mind` and runs only on the owner's local checkout (`https://nest-mind.test`, Herd,
which reads and writes the production database) — against the deployment 2.13.4 is never sent a
`form`, because the server sends one only to a turn carrying an `action` and a 1.15.1 server
ignores the field. Not a defect in either direction: the drift warn fires only when the **server**
is ahead. The rollout is both halves together, with `?v=2.13.4` on the embed tag — nestshostels.com
serves the theme copy with `cache-control: max-age=86400`, so without the query a browser can hold
the previous release for a day after the upload. Since 2.13.4 the query reaches the stylesheet
too: `injectStyles()` appends `?v=<VERSION>` itself, because `assetBase` drops the script's query
and a release that adds a renderer would otherwise draw it unstyled until the host's cache ran out. Send nothing that asks for a person from a test
page (a real handoff emails staff). Re-read `contract_version` **and** the expose header off a `201`
before concluding anything, exactly as the idle-window entry under Open items insists.

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

Three of the four endpoints: init a conversation, post a turn, poll an async turn. The fourth,
`POST …/{uuid}/events` (1.16.0, D-113, click counting), is **not called yet**: it was accepted on
2026-10-27 as the one bounded exception to "The widget never phones home" and lands in 2.13.5 —
read that section's bounds before building it. Until then the init's `analytics` flag is not read.

```
POST {apiBase}/api/v1/chatbot/conversations               → 201 {conversation:{uuid}, greeting,
                                                                 assistant?, analytics?, contract_version}
POST {apiBase}/api/v1/chatbot/conversations/{uuid}/messages → 200 {reply, actions[], turn}
     body {message, locale, action?}
GET  {apiBase}{async_result.url}                          → 200 {status, reply?, actions?, turn}
```

**Which of the things a guest sees comes down the wire, and which the widget makes up, is
`docs/rendering-ownership.md`** — a per-element table plus the rule behind it. Read it before
changing a renderer or adding an element type. The short version: the server sends display text when
the text is **tenant-authored content** (a promo, a chip, a property's name or CTA label) or the
guest's own words quoted back (since 1.14.0, `contact_channels.prefill`, whose `hint` caption this
widget replaces with its own pack string), and the widget composes it when it is **chrome around
structured data** the server deliberately sent as data — which is why `promo_card` uses no pack
string at all and `availability` uses nothing but. A 1.16.0 `form` is the first case: every string
in it is the server's, and the widget composes only structure, ids, native controls and the filled
message. Two traps live there too: "from the server"
and "in the guest's language" are different questions (a card's `name` is raw catalog, its
`cta_label` is localized), and the split is exactly the rule for what `setLocale()` may repaint.

### Things that will bite you

- **A turn always returns `200`.** Provider, budget and LLM failures degrade server-side to a
  localized "busy" reply. A 5xx is a bug, not a business outcome. The non-200s are resolution
  failures only: `401` bad key, `403` disabled/revoked or the request `Origin` is not on the
  site's allow-list (body `{"message":"Origin not allowed."}` — guide §7), `404` unknown uuid,
  `410` idled out, `422` config, `429` throttled. Since contract 1.14.0 a busy reply can carry
  `contact_channels` — `prefill` included — when the failure came after a handoff raised its
  request (D-084(h); `!busy` in the mock). `sendMessage()` has no busy branch, so `actions[]`
  renders on every `200`; keep it that way.
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
- **The assistant's name is data, and it has the idle window's problem.** Since contract 1.15.0
  the init `201` may carry `assistant {name?, disclosure}`; `name` is what the site owner typed in
  the wSuite panel and is **omitted** when they set none. No pack holds a name and nothing in this
  file is a default for one: `assistantName` is `null` until a server says otherwise, and `null`
  means name-free wording. Five things to keep true:
  - **One writer.** `paintAssistant()` is the only function that writes the header title, the
    dialog's accessible name, the composer placeholder or the launcher's accessible name. It reads
    three things — the name, the locale, and whether the unread dot is still showing — so it is
    called wherever one of them changes: `build()`, `boot()`, all three branches of
    `startConversation()`, `markOpened()` (the dot) and `setLocale()`. A
    restart and a 410 re-init reach it **through** `startConversation()` and have no call of their
    own — the old name stays up for the round trip rather than flashing name-free.
  - **Persisted, and restored twice.** `build()` paints at boot and a resume never calls init, so
    the name rides the record and the resume branch restores it — skip that and `persist()` writes
    `null` over it one turn later, the `idle_hours` defect exactly. `boot()` restores it **as
    well**, and that half is easy to delete as redundant: the launcher's label is read while the
    panel is closed, and `open()` runs `markOpened()` before the resume branch, so without the boot
    restore `openUnreadNamed` is a pack string that can never paint.
  - **Nowhere else.** No second key, no `sessionStorage`, no cookie to paint it sooner. After an
    owner renames the assistant, anything outliving the record shows the old name over a greeting
    that says the new one. The name-free title a first-time visitor sees for the init round trip
    is the cost of that rule, not a bug to cache around.
  - **A failed init clears the name only when there is no conversation.** The guard
    `if (!conversationUuid)` looks removable and is not: the resume branch runs before the
    `initWaiters` check, so a fast first send can adopt a record another tab wrote while this
    tab's init is still on the wire. A bare `null` there is persisted over that record's name on
    the next turn — reproduced with the guard removed.
  - **The disclosure never depends on the name.** The `aiAssistant` badge, the `disclaimer` under
    the composer and `assistantRole` in the dialog label show with a name and without one (guide
    §3.1, a MUST). The server's `disclosure` string is ignored in favour of our own pack, which is
    byte-identical in all five locales and can follow `setLocale()` — the `prefill.hint`
    precedent. `openUnreadNamed` carries the role too ("Open %s, the AI assistant — 1 new
    message"), which the 2.13.1 string it replaces did not: it is the launcher's label for a
    returning guest's new session, heard while the panel, and the badge in it, are hidden.

  The name is tenant text: `textContent` / `setAttribute` only, and never written into the
  server's `greeting`, which arrives finished. The header **wraps** it (three lines, then a
  clamp) and never truncates a name that fits the server's 24-character guarantee; the row wraps
  too, so a long name sends the badge under it whole. The title is an `h2` a host's reset can
  reach, so everything a multi-line title depends on is **declared** on `.nc-title` —
  `text-transform`, `text-align`, `white-space`, `word-break`, `hyphens` — and
  `demo/index.html`'s `h2` trap carries the first two (not `white-space: nowrap`, which made the
  demo page itself scroll sideways on a phone). Three limits worth knowing rather than
  rediscovering: the heading font's subset stops at U+00FF, so a name like "Łukasz" falls back
  per glyph; an over-long placeholder is cut at the field's edge with no ellipsis —
  `text-overflow` does nothing for a textarea's placeholder in Chromium; and all of this layout
  was measured in Chromium only — the clamp is `-webkit-line-clamp` on a flex item, unverified in
  Safari and Firefox.
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
  `locale` and, since 2.13.4, the optional `action` (below) — built in `API.send()`, and nothing
  else, ever. The `locale` is `requestLocale`, never the UI `locale`: since contract 1.13.0
  (D-083) it is the visitor's *preferred* language, not an override — it answers only until the
  guest writes in their own, and then the server keeps to theirs. It still rides **every** turn,
  where the reference sends it at init only: a resumed conversation never re-inits, and a host's
  `setLocale()` has to reach the server on the next turn. The server owns the transcript,
  keyed by the conversation uuid. The widget keeps a **display-only** transcript copy in
  `localStorage` (since 2.8.0) so a returning guest sees their conversation — it must never
  enter a request body. An earlier version accumulated a `chatHistory` array with no purpose at
  all; the stored transcript is not that: it exists to be replayed, never to be sent.
- **Sending `action` is a declaration, not a detail.** Since contract 1.16.0 the turn body may
  carry `action` beside the `message` — never instead of it: a keyed chip's
  `{type:'reply', payload:{key}}` (`makeChipHandler(message, source, key)`, the key validated once
  by `chipKey()`) or a form's `{type:'form', id, payload:{values}}` (`renderForm()`). The server
  sends a `form` **only** to a turn that carried one (D-109(j)), so sending it tells the server
  this build draws every element up to `BUILT_AGAINST` — which is why `BUILT_AGAINST` may move only
  once every element type of the new contract renders here. The `message` stays the chip's
  `message` (never its label) or the form's filled `submit_message`, so the transcript reads as
  the guest's own words and an older server answers exactly what it always did. `sendGuestText()`
  is still the one seam: `action` and the form's `onFail` ride from it through `sendMessage()`,
  the queue (`{text, action, onFail}` entries) and the 410/404 resend, because the server reads the
  action off the turn that carries it.
- **A form is one-shot like a chip row, but it stays on screen.** `retireForms()` disables every
  live form's `<fieldset>` on ANY send — the submit's own included — and in `endConversation()`;
  the values stay visible as the record of what was sent. Focus moves first, onto the `<form>`
  itself (`tabindex=-1`, `preventScroll`), not the composer: the form is still on screen, and
  focusing the composer after a tap-submit pops a phone's keyboard over the answer. A failed send
  gives the form back through its `onFail` — the no-uuid branch (a failed init or re-init), a 429,
  any other failure, never a 403 or after a restart — but only while `sendSeq` is still the value
  the submit took: a guest who has sent anything since retired it on purpose, and the contract's
  one-shot rule outranks the retry. Forms are kept by `persistableActions()` and replayed by the
  chip-row rule: only the **final** entry's form is drawn, live (`drawForms`); an earlier one is not
  drawn at all, because a redraw would show the server's pre-fill rather than what the guest sent
  and the guest bubble below it is the record. Skipped in `renderAction()`, never filtered out of
  `a`, so a replayed turn groups its buttons exactly as the live one did. This departs from the
  1.16.1 sync prompt's "restore it disabled" — an owner decision.
- **A form validates natively, in the browser's language.** No `novalidate`: required, `min`/`max`,
  the integer step and the date order (the check-out's `min` follows the check-in on every input;
  the check-in stops a day short of `max`) are the browser's checks and the browser's messages,
  not pack strings. `reportValidity()` focuses — and so can scroll to — the first invalid field,
  a guest-caused exception to the one-move-per-turn rule (see the transcript section). Two
  refusals are the widget's own, both because the server would 422 every submit: an all-blank
  submit sends nothing (`values` is required), and a form whose `id` is over 64 characters, or a
  text pre-fill over 500, is never drawn or never filled. Fail closed otherwise: a kind this build
  does not know, a field without `name`/`kind`/`label`, two fields sharing a name, or a select with
  no drawable option drops the **whole** form.
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
  would be refused the same way — and since 2.13.4 each dropped entry's `onFail` runs, so a form
  queued behind it is offered back (and declines unless nothing was sent after it).
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
  `http`/`https` (`safeHttpUrl`) — since 1.16.0 that includes a chip's `image` (an image source
  only: dropped when it fails, chip kept) and a form `consent` field's `link.url` (no link when it
  fails). `telNumber()` is the one rule for both numbers, and it mirrors
  the platform's admin rule rather than the reference: strip spaces, dots, hyphens and parentheses
  from the **whole** value, then `+` and the digits for a `+` value, `+` and the digits after `00`
  for a `00` one, bare digits otherwise. So `(+34) 922 123 456` dials `tel:+34922123456` and
  `0034 822 000 000` dials `tel:+34822000000`, while a national `922 123 456` dials
  `tel:922123456`. The reference strips leading whitespace only, so it dials the `(+34)` value as
  `tel:34922…` — a divergence to flag upstream, not to copy. `wa.me` takes `digits(telNumber(v))`, so
  neither `+` nor `00`. A value with no digits renders no link, and the email must pass `EMAIL_OK`
  (no whitespace, one `@`, no `?` `#` `&` `%`). **Since 1.14.0 a `prefill.text` rides only
  `encodeURIComponent`'d**, as the `wa.me` `?text=` or the `mailto:` `?subject=&body=` value,
  composed by `composeOnTap()` from the read-only preview's CURRENT value — at render, on `input`,
  on click — and only for a link whose preview is in the same `.nc-channels` wrap. No preview, no
  prefill. **The preview sits ABOVE the links** — caption, textarea, then Call / WhatsApp / Email —
  departing on purpose from the reference, which puts it under them and then scrolls to it. This
  widget never scrolls new content into view, so only this order makes the MUST ("show the text
  before the guest can leave") hold by construction, and a screen reader hears "message ready"
  before the buttons. Letting the guest edit it is removing `readonly`, nothing else **in the
  renderer** — the decision itself carries two costs the owner has deferred: iOS zooms a focused
  text field under 16px, and an edited message loses the server's 1,800-byte link guarantee.

## Configuration

Set on the `<script>` tag. `document.currentScript.dataset` reads them at boot.

| Attribute | Default | Notes |
|---|---|---|
| `data-api-base` | — | API origin. Required (with `data-key`) unless `data-mock` — the widget does not boot without them. |
| `data-key` | — | Public-scoped `ws_live_…` key. Required unless `data-mock`. |
| `data-property` | — | Property-name hint, sent at init. A matched name seeds the conversation's working memory, so answers are scoped to that property from turn 1. Unknown names are not an error. |
| `data-locale` | `auto` | The UI language: `auto` matches `navigator.languages` against `en es it de fr`, else `en`. Separately, `requestLocale` — the preference the init and turn bodies carry (contract 1.13.0) — is the primary subtag of `data-locale` when it is not `auto`, else of `navigator.language`, lowercased, kept only if it is two ASCII letters, else the UI locale. So `uk-UA` sends `uk` with English chrome. |
| `data-position` | `right` | `right` \| `left` |
| `data-offset-x` | `24` | Bare px number → `--nc-edge-x`. Non-numeric values are ignored. |
| `data-offset-y` | `22` | Bare px number → `--nc-edge-y`. The panel derives its `bottom` from it. |
| `data-color` | `#0D6F82` | Sets `--nc-secondary`. (Defaults live as CSS custom properties in `css/nest-chatbot.css`; the JS default `''` means "don't override".) |
| `data-fonts` | `nest` | `nest` \| `host` \| `system` — see the typography seam below. Unknown values fall through to `nest`. |
| `data-font-heading` `data-font-body` | — | An explicit family list for either var. Beats `data-fonts`, so the two mix. Validated by `FONT_OK`; a rejected value is ignored, same as `data-offset-x`. |
| `data-z-index` | `2147483000` | For hosts with their own stacking conflicts. Same CSS-default mechanism as `data-color`. |
| `data-auto-open` | `false` | See the Back-button caveat below — an auto-opened panel's history entry is skippable until the guest taps something. |
| `data-back-button` | `true` | The device Back button closes the panel. **The only opt-OUT boolean in `cfg`** (`!== 'false'`, not `=== 'true'`) — see the Back-button section. |
| `data-debug` | `false` | Gates **all** `console` output — sole exception: the one-time contract-drift warn (guide §3.1). The three full-body logs (`init`, `turn`, `poll`) print `redactForLog()`'s shallow copy, every `prefill` read as `'[prefill]'` and, since 2.13.4, every field `value` (a form's pre-fills) as `'[value]'`: a debug tag left on in production prints to any visitor's devtools, and the demo sets it. No request body is logged at all. |
| `data-mock` | `false` | Serves replies from the local fixtures instead of the API — the dev harness. The demo page sets it; never a production page. |

Runtime API: `window.NestChatbot` → `{ version, open, close, toggle, destroy, setLocale, locale,
state }`.

There is no in-panel language control since 2.13.1 — the footer flag switcher went because, after
contract 1.13.0, it could no longer force the reply language. `setLocale(code)` (one of the five;
anything else, `uk` and `es-ES` included, is a no-op) is the one way in: it sets `requestLocale`
first, **even when `code` already is the UI language**, then repaints and emits `wchat:locale` only
on a real UI change. `locale`, `state.locale` and every `wchat:*` `locale` are the UI language,
never `requestLocale`. Removing `setLocale`, `locale` or `wchat:locale` would be a major.

### The widget never phones home — measurement leaves as host-page events

Since 2.8.2 the widget reports itself through DOM `CustomEvent`s dispatched on `els.root`
(the `events` section), and that is the **only** channel a host's measurement will ever get.
Beside it the widget makes exactly one request of its own for measurement, the bounded click
count below, and nothing else: no other analytics request, no beacon, no pixel, no third-party
script. The reasoning is the one that keeps icons inline and fonts self-hosted: a host trusts
exactly one extra origin, ours, and only for our own assets. The host page decides where the
events land. A host that listens to nothing pays nothing, which is why there is deliberately
**no** `data-*` attribute to disable **the events**; the click count's attribute gates that one
request and nothing else.

**Contract 1.16.0's click counting is the one exception — accepted with conditions on 2026-10-27,
not yet built** (D-113, the 1.16.1 packet's APPENDIX-A; it lands in 2.13.5). `POST …/{uuid}/events`,
body `{type: 'cta_click', element, cta, turn?}`, counts CTA clicks in the wSuite panel. It keeps
the rule's substance — the same origin every turn already goes to, so a host trusts nothing new —
and buys what the events cannot: a click joined, on the server, to the conversation and turn that
produced it. On nestshostels.com, which this widget serves and whose analytics listened to no
`wchat:*` event when this was decided, it is the only click measure there is. The reasoning and
the facts it was measured against are `docs/proposals/visitor-measurement-and-events.md`
§ The one exception. The bounds — break one and the exception is void:

- **Same origin, same transport.** `apiBase` plus the guide §3.4 path, through `request()`.
  Never `sendBeacon`, never a pixel, and no `keepalive` while every CTA opens a new tab or is a
  `tel:`/`mailto:`.
- **Two keys, both required.** The **site's**: report only while the init carried
  `analytics === true` — persisted in the record and restored on resume exactly as `idle_hours`
  is, and replaced (absent included) by every new init. The **page's**: `data-count-clicks`.
  `consent`, the **default**, reports only after the host passes the visitor's cookie consent on
  with `NestChatbot.setClickCounting(true)`; `true` reports whenever the site has it on, for a host
  whose privacy policy covers the count on its own basis; `false` never, and no runtime call
  overrides it. `setClickCounting(false)` withdraws from the next click. The grant is **never
  stored** — the host's CMP re-asserts it on every load — a click before it is dropped, never
  queued, and the widget never reads a CMP, `gtag` or `dataLayer` itself. Both names are
  provisional until 2.13.5 ships them.
- **Four fields, from fixed values only.** `element` and `cta` mapped from the render-time
  `data-wchat-el` / `data-wchat-cta` (`property_card` → `property_cards`); `turn` the server's own
  number, or omitted. A `cta: null`, or a pair the endpoint would refuse, sends nothing. Never a
  url, a label, a chip key, a prefill, a form value or any text.
- **Fire and forget.** No response read, no retry, no queue, no re-init on any status (guide
  §3.4), no `wchat:error`, nothing the guest sees. `busy`, `sendQueue`, `sendSeq` and the
  record's `ts` stay untouched: a click is not activity.
- **One source of truth.** Sent from the delegated listener that emits `wchat:action`, which stays
  exactly as it is.
- **Closed.** `cta_click` on this endpoint as 1.16.x specifies it. Another `type`, another origin,
  a field beyond enums and the turn, or linking conversations to a person (route B's visitor
  token) is a new decision, recorded here first.

The count is **pseudonymous personal data, not anonymous**: it sits on a conversation that holds
the guest's messages, and is deleted with it after D-087's 12 months.

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
  number or email, and since 1.14.0 a WhatsApp or email href may carry `prefill`, the guest's own
  words, which the contract bars from every event **and every log** (the three body logs print
  `redactForLog()`'s copy). The links keep `data-wchat-channel`, and the delegated listener also
  nulls `url` for anything tagged `contact_channels`. That is a promise about **our** `wchat:*`
  events and our logs, never about the host's: the composed href sits on the anchor from the
  moment it renders, so a host's own link-click tracking (GTM's Click URL, GA4's outbound clicks)
  reads it whatever we emit — README § Measuring it tells hosts to exclude `a.nc-channel`.
  Since 2.13.4 two more things hold. **A form's values never travel**: a submit is a guest message,
  reported as one (`wchat:message`, `source: 'form'`, its `length`), and a later form will carry an
  email or a phone; nor does a chip's `key`. And **`wchat:action` says which button** through `cta`
  — guide §3.4's click vocabulary (`book` · `website` · `directions` · `more` · `promo` · `phone` ·
  `whatsapp` · `email`, `null` for a `link_button` with no `id` or one this build does not know —
  which is every `link_button` until the server is on 1.16.0: the deployment's 1.15.1 names none), written at render
  into `data-wchat-cta` from fixed values only (`linkCta()` vets a payload `id` against
  `LINK_CTAS`), never a payload string. A form's consent link carries no `data-wchat-el`: it is a
  privacy notice, not a call to action.
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
or `inherit` — thirteen sites, no exceptions (the thirteenth, since 2.13.4, is the form's
`.nc-fill .nc-fill-control, .nc-fill-label`, `inherit` for the reason `.nc-prefill` gives: a host's
`#top input[type="text"]` would otherwise outrank the reset). That invariant is the whole reason `data-fonts` is free:
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

Two exceptions move the view, and both are the guest's doing or the focus rule's, never a
render's: `endConversation()` focusing the restart button (the composer has just closed), and,
since 2.13.4, a form's `reportValidity()`, which focuses — and the browser scrolls to — the first
invalid field when the guest presses submit. A form never focuses or scrolls on arrival, and the
focus `retireForms()` moves uses `preventScroll`.

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
| `contact` | `contact_channels` (phone + whatsapp + email) with a 1.14.0 `prefill` (text + subject + hint — the contract's own example): the caption and a read-only preview **above** the links, inside `.nc-channels`. The WhatsApp and email hrefs compose from the preview's current value at render, on `input` and on click; remove `readonly` in devtools, edit, and the tap sends the edited text |
| `rooms` | `availability` — the 1.8.0 showcase: a per-bed and a per-room option carrying `basis`/`units`/`total`, rendered verbatim as "2 beds · 200.00 EUR total", plus one option without the trio that must render exactly as before |
| `link` | three `link_button`s (book / website / directions), one with `style: primary`, each carrying its 1.16.0 `id` — a click reports `cta` `book` / `website` / `directions` on `wchat:action` |
| `cardstay` | the 1.10.0 pair (D-073): `[property_cards (one item), availability]` on one turn, card **first**, CTA url == `availability.url`. Exactly **one** Book affordance may render — the card's — and all three option rows must survive it (a party row, a single-unit row, one option with no `basis`/`units`/`total`; three groups of one, so no fold button). Suppression path: the per-turn `rendered` set |
| `cardbook` | the other arm: `[property_cards, booking_link]`, equal urls, and **no** `cta_label` so both would have said "Book now". Suppression path: the `cardUrls` pre-scan — the branch that was dormant from 2.5.0 until 1.10.0. Tested **above** `book`: these are `indexOf` matches and `cardbook` contains `book` |
| `available` | `async_result` — interim reply, then the poll replaces it in place; the final is an `availability` sharing the interim's **server-composed** url byte-for-byte (1.9.0, no `adults` — unstated party), so the per-turn dedupe must leave exactly **one** Book button; the final's option is the singular "1 bed" total path |
| `hostel` | `quick_replies` — the three island chips, carrying the 1.7.0 `heading` (also matches suggested prompt 1); any send retires every row **and its heading** (one-shot) |
| `tenerife` `canaria` `ibiza` | `property_cards` carousel + `promo_card` + the CTA trio — and the 1.6.x showcase: per-card `period`/`basis` (two different suffixes in one rail), a `cta_label`, the D-043(c) isolator (name-less card sharing the website button's url — card dropped, button survives), a Book button matching a rendered card's url (suppressed) — both 1.9.0 composed strings with a query, so the dedupe is proven through `?`/`&` — and `total`/`more` (ibiza: `total` only → count line; the others: both → `more` wins) |
| `pass` `offer` | `promo_card` alone (`pass` is word-bounded: "compass" falls through) — Spanish copy with `locale: 'es'` (→ `lang`) and a `\n` in the body (pre-wrap) |
| `human` | the 1.12.0 unbound handoff (D-079): the reply asks which hostel and offers that team's contact (1.14.0 wording — it no longer says staff were told), over a `quick_replies` row with `id: 'property_choice'` and **thirteen** chips (catalog names, alphabetical, no `locale`, no `heading`) — and **no** `contact_channels`. The row must wrap whole inside a 400px panel. A chip sends `It's about <name>` verbatim, which answers as a bound handoff does since 1.14.0 — a reply pointing at the buttons plus the server's contact-offer line, and that hostel's `contact_channels` with a `prefill` quoting the `human` message; that answer branch sits **above** every content keyword, because a hostel name inside it must never be caught by an `indexOf` test |
| `!cap` | the turn-cap reply: `contact_channels` + `conversation_ended` last — composer closes, "start a new chat" appears — and **no** `prefill` (the contract never puts one on the turn-cap reply), so it is the plain-links control |
| `!unknown` | an unrecognised element type (must be ignored, sibling still renders); the sibling `link_button` carries `id: 'brochure'`, an id this build does not know — drawn the same, `cta: null` |
| `!xss` | a hostile reply and a `javascript:` url (both must be inert) |
| `!prefill` | a hostile `prefill` — markup (an `onerror` img and a `script`, both setting the `window.__ncXss` sentinel), both quotes, `&amp;`/`&`, `?text=x#frag`, `%20`, `+`, a skin tone and a ZWJ family, an Arabic paragraph (the RTL branch of `dir="auto"`), a newline, ~500 characters — with `whatsapp` written `0034 600 111 222` and a subject carrying `& # ?`. The preview shows it as text, nothing runs, the decoded `text`/`body`/`subject` round-trip byte-for-byte, and wa.me gets `34600111222`. Not named `!xss…`: that test is a startsWith |
| `!nowhatsapp` | `phone` `0034 822 000 000` + `email` + `prefill`, no `whatsapp`: `tel:+34822000000`, and the email link still carries the message — the preview waits for a WhatsApp **or** email link that renders |
| `!busy` | the server's busy reply keeping a raised handoff's `contact_channels`, `prefill` included (1.14.0, D-084(h)) — `actions[]` renders on a busy `200` like on any other |
| `!410` `!403` `!429` `!500` | forces that status |
| `!429 60` `!429 80000` | a `429` carrying that `Retry-After` (1.11.0): 60 keeps "try again in a moment", 80000 shows "come back later". Bare `!429` is the header-less control and must read as `60` does, with `retryAfter: null` |
| *tap* **Book a bed** | the 1.16.0 Book panel (D-111, D-112), from the welcome row's keyed chip: the tap carries `action {type:'reply', payload:{key:'book-a-bed'}}` beside its message, and the mock — like the server — answers that with the contract's own `form` (a hostel or an island, the dates with computed bounds, an optional party). Submit *Every hostel in Tenerife*: the guest bubble reads "Prices for Every hostel in Tenerife, *from* → *to*", the form stays on screen disabled, and the answer is `property_cards` with `ordering: 'cheapest'` — two cards with a `stay_total` (one per bed, one per room) under their `price_from`, a third with `reason: 'Fully booked for these dates'` and no total, a "Cheapest first" caption, never re-sorted. Submit *Duque Nest*: that hostel's `availability`, its party totals computed from the same party as the island cards' — beds at 78 a head, doubles at 165 for every two guests, so the bed card is cheaper for any party and the fixed order really is cheapest first. The action is answered **first**, above every keyword (`actionReply()`, the "it's about" precedent: "I would like to **book** a bed" and "Prices for Every **hostel** in **Tenerife**" both hold keywords); typing the chip's text without the action reaches `book` instead, exactly as the server answers a message sent alone |
| `!kinds` | a `form` with every kind — `text`, `textarea`, `email`, `phone`, `select`, two `date_range`s, `guests`, `consent` — required and optional, pre-filled and not: an optional range pre-filled at one end (both ends turn required), a range with no `labels` (named by the field's label), two malformed options (skipped), a consent with a privacy link. Its submit is answered with the **keys** received, so a blank optional field visibly stays out and the answer itself carries no value (the guest bubble above it is the filled `submit_message`, values and all, by design). `room` is required: the contract promises every `{name}` in a template names a required field |
| `!badform` | two forms. The first is hostile in every string — markup setting the `window.__ncXss` sentinel, a 120-character unbroken label, Arabic (`dir="auto"`), a `javascript:` consent link, bounds and values that are not dates or numbers, `null` where objects belong, `{constructor}` / `{__proto__}` tokens — and must render inertly: no script runs, the label wraps inside the panel, the link is gone. The second has a `kind` this build does not know and must not render at all |
| `!pictures` | a `quick_replies` row of picture chips (1.16.0 `image`): one with `image_alt`, one without (`alt=""`), one `javascript:` image (dropped, chip kept), the keyed **Book a bed** as a tile (answers with the form), and one chip with no key (sends no `action`) |
| `!ukchips` | a tenant `quick_prompts` row under a **turn's** reply (1.15.2) with `locale: 'uk'` (1.16.1, D-114): drawn like any row, `lang="uk"` — nothing checks a row's `locale` against the five packs |

`Mock.init` returns **two** `quick_replies` rows — the tenant's "try asking" prompts and the
island chips — mirroring a real welcome payload; both prompt messages chain into the table above
rather than the catch-all reply, and since 2.13.4 the prompts row's third chip, **Book a bed**,
carries a `key` and opens the Book panel. Only the island row carries a `heading`, on purpose: one page
load then shows a headed row and a bare one side by side. It also serves the 1.7.0 init pair,
`idle_hours` and `server_time`, and since 2.13.2 the 1.15.0 `assistant` — by default
`{ name: 'Nesti', … }` with a greeting that says the name, as a server would have written it.
Since server chips **replace** the widget's own pack block, that
means the demo never reaches `showPrompts()` or `setLocale`'s pill-repaint branch: exercising
the fallback means temporarily setting `Mock.init`'s `actions: []`.

**`?nc-idle=<hours>` on the demo URL overrides the fixture's `idle_hours`** — the only way to
get a window short enough to actually cross (`?nc-idle=0.005` is 18 seconds, where a real
server's smallest step is an hour). A harness knob and only ever that: the whole `Mock` object
is unreachable without `data-mock`, which a production page never sets.

**`?nc-assistant=<mode>` picks the mock init's `assistant`** (contract 1.15.0). With no knob the
fixture names the assistant "Nesti". The modes:

| Mode | The init carries | Must end as |
|---|---|---|
| *(none)* | `assistant: { name: 'Nesti', disclosure }`, greeting says the name | "Nesti" in the title, dialog label, placeholder and launcher label |
| `none` | no `assistant` key — an older server, or a site with no name | name-free wording in all four; badge and disclaimer still showing |
| `markup` | a name that would run if parsed (`window.__ncXss`, the `!prefill` sentinel) | shown as text; `window.__ncXss` stays `undefined` |
| `long` | a 500-character name | capped at 60, wrapped and clamped; ⋯ and ✕ still in the panel |
| `string` · `array` | `assistant` as a bare string · as an array | no name at all |

The knob is read at **every** init, and that is how a repaint is proven rather than assumed: load
one mode, reload on another with the conversation still stored (the resume makes no init, so the
old name stays — before the panel is even opened, which is the boot restore), then press "Start a
new chat" and watch the title change once. A constant fixture would pass that test without
repainting anything. The mock's greeting is built from its own constant and never through `tn()`:
the mock plays the server, which writes the name in before the widget has learned it.

**`?nc-init-429=<seconds>` makes every mock init answer `429` with that `Retry-After`** — the
other half of the throttle copy, unreachable from the composer because every keyword runs on the
turn endpoint after init has already succeeded. Open the panel (the `init` `wchat:error` carries
`retryAfter`), then send anything: the re-init is refused again and the guest sees the copy the
number earns. Same knob rules as `?nc-idle`. **The mock never exercises `request()`** — the
header-reading line itself is only proven over a real XHR, so a change there wants a
cross-origin fake that sends `Retry-After` both exposed and **un**exposed. Request **bodies** are
half-covered since 2.13.4: `API.send` builds `{message, locale, action?}` **before** its mock
branch and hands that same object to `Mock.send(uuid, body, done)`, so a fixture answers what the
wire would carry — it is how the keyed chip earns its form. `API.init` still returns to the mock
before building its body. Either way the serialized bytes exist only on the real transport.
Observe them with Playwright's `page.route()` against a fake `data-api-base` on the host page's
own origin — same-origin, so no preflight — reading `request.postDataJSON()`, with CDP `Fetch`
interception, or with the 2.13.0 cross-origin fake.

**`?nc-action-fail=<status>` answers every turn that carries an `action` with that status** — a
keyed tap, a form submit. It is the mock-only way to watch a form come back after a failed send
(`onFail`): `!500` is typed text, and typing retires the form before it can fail. Same knob rules
as `?nc-idle`.

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
- Anything user-visible goes through `t()` / `tf()`, never a hardcoded string — and anything that
  says who the guest is talking to goes through `tn()`, which is the only place the named and
  name-free variants are chosen between. **The converse is
  equally a rule and is the half that gets forgotten:** anything **payload**-supplied reaches the DOM
  through `textContent` and is never re-derived from a pack — repainting a tenant's string from our
  own table is inventing a translation they did not write. Which is which, per element, is
  `docs/rendering-ownership.md`.
- **Anything that removes or hides a node checks `document.activeElement` first.** If the node
  contains it, move focus somewhere still visible inside `#nest-chatbot` before the node goes.
  A removed or `display: none` element drops focus to `<body>`, so the guest's next Tab
  restarts at the top of the *customer's* page; a merely invisible one is worse, stranding them
  on a control they cannot see. This repo has rediscovered that bug six times — the teaser,
  the carousel arrows, the prompt pills, the language row (removed in 2.13.1), the scroll cue,
  and the header ⋯ menu. In the last two, hiding a focused node is the control's *main* path
  rather than an edge case: pressing ⌄ scrolls to the bottom, which is exactly the condition
  that hides ⌄, and every way of dismissing the menu hides an item the guest may be standing
  on. It is a rule, not a case. **Disabling counts too**: a disabled focused control drops focus
  to `<body>` exactly like a removed one, which is why `retireForms()` (2.13.4) moves focus onto
  the retiring form *before* it disables the fieldset — the main path again, since the guest
  pressing submit is standing in the form the send retires.
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
- Version bumps err small: **patch unless a host has to act.** Everything non-breaking is a
  patch: a bug fix, new UI behaviour, a new `data-*` attribute, a new runtime-API method, a whole
  new stored surface, **and a contract sync** (a fresh `docs/wsuite/` packet and a
  `BUILT_AGAINST` move; see the 2026-09-15 note at the end of this bullet). Reserve **minor**
  for a release that asks a host to change something on their side without breaking them yet,
  such as deprecating a `data-*` attribute ahead of its removal. Use **major** for breaking the
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
  **Since 2026-09-15 a contract sync is a patch too** (asked for right after 2.13.0). The
  widget's line had been gaining a minor with every sync, yet a sync asks no host to do anything:
  `BUILT_AGAINST` is a claim about this file, not about their page. The syncs 2.9.0 through
  2.13.0 keep their numbers. An upstream sync prompt that asks for a minor is overruled by this
  rule, so say so in the report.
  2.13.1 is the 1.13.0 + 1.14.0 sync (D-083, D-084), the first numbered by this rule: a fresh
  packet and a `BUILT_AGAINST` move, the flag switcher removed with `setLocale`, `locale` and
  `wchat:locale` kept, the unclamped `requestLocale`, the `prefill` preview and the `00` fix — a
  patch. Removing a visible control and two pack keys while every runtime-API method, getter and
  event name stays asks nothing of a host, and the upstream prompt asked for 2.13.1 too, so nothing
  was overruled.
  2.13.2 is the 1.15.0 sync (D-090): a fresh packet and a `BUILT_AGAINST` move, the hardcoded
  assistant name gone from the file, eight pack keys reworded or added in five locales plus
  `title`, one new stored field, a header that wraps — and no `data-*` attribute, no
  `window.NestChatbot` member and no `wchat:*` payload touched. A patch, and the upstream prompt
  asked for 2.13.2 too. What a guest sees does change (the name is the owner's now, and the header
  can wrap), but a host's `<script>` tag has nothing new to say; the one thing a host is asked to
  do — add `?v=2.13.2` so a day-old cached copy cannot keep its old name — is about their cache,
  not about this file's contract.
  2.13.3 is the 1.15.1 sync (D-106), a wording row that moved no renderer line, plus the
  built-in greeting's "· 1 Community" in five locales — a patch on both counts.
  2.13.4 is the 1.15.2 + 1.16.0 + 1.16.1 sync (D-109, D-111, D-112, D-114): a fresh packet and a
  `BUILT_AGAINST` move, the Book panel's `form`, keyed and picture chips, stay totals, reasons and
  an order caption on cards, three pack keys in five locales, one additive `wchat:action` field
  (`cta`) and one additive `wchat:message` `source` value (`form`) — and no `data-*` attribute and
  no `window.NestChatbot` member. A patch: the upstream prompt asked for a minor, 2.14.0, "since a
  guest-visible feature lands", and was overruled by this rule — new UI behaviour is patch-shaped
  here, and a host is asked only to move the embed tag's query to `?v=2.13.4`, which is about their
  cache. The next release is **2.13.5** unless a host has to act.
