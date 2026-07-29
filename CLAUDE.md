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
| `storage` | the conversation uuid in `localStorage`, 24h idle window |
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

- **`response-contract.md`** — the versioned reply envelope (currently 1.4.1 — see its
  Changelog and Versioning policy) and every element type.
- **`integration-guide.md`** — transport, auth, endpoints, errors, rate limits, CORS.
- **`chatbot.reference.js`** — the platform's own security-reviewed widget. When a transport or
  contract detail is unclear, read how this does it. Pinned copy; may drift from upstream.

**Contract sync.** `docs/wsuite/` is a vendored, read-only packet: at a sync it is replaced
wholesale from the upstream tag (`chatbot-contract-v<X.Y.Z>`), never hand-edited.
`BUILT_AGAINST` (api section) moves **only** during a sync — it is a claim about what this
code implements, not a mirror of the docs. `VERSION` is the widget's own independent release
line; it and `window.NestChatbot.version` are the only version sites (no package.json —
rule 1). Releases are recorded in `CHANGELOG.md`. Current packet: pinned 2026-07-28 from
upstream tag `chatbot-contract-v1.4.1`.

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
  generated.
- **The init response reports `contract_version`.** Compare it to `BUILT_AGAINST` (api
  section) and `console.warn` once when the server is ahead — never gate, never hard-fail
  (guide §3.1); the ignore-unknown rule keeps the widget functional. That warn is the sole
  exception to the `data-debug` logging gate.
- **Do not send chat history.** The turn body is `{message}` plus the optional per-turn
  `locale` (contract 1.3.0). The server owns the transcript,
  keyed by the conversation uuid. An earlier version of this widget accumulated a `chatHistory`
  array and never sent it; do not resurrect it.
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
| `data-z-index` | `2147483000` | For hosts with their own stacking conflicts. Same CSS-default mechanism as `data-color`. |
| `data-auto-open` | `false` | |
| `data-debug` | `false` | Gates **all** `console` output — sole exception: the one-time contract-drift warn (guide §3.1). |
| `data-mock` | `false` | Serves replies from the local fixtures instead of the API — the dev harness. The demo page sets it; never a production page. |

Runtime API: `window.NestChatbot` → `{ version, open, close, toggle, destroy, setLocale, locale }`.

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
| `available` | `async_result` — interim reply, then the poll replaces it in place |
| `hostel` | `quick_replies` — the three island chips (also matches suggested prompt 1) |
| `tenerife` `canaria` `ibiza` | `property_cards` carousel + `promo_card` + the CTA trio |
| `pass` `offer` | `promo_card` alone (`pass` is word-bounded: "compass" falls through) |
| `!unknown` | an unrecognised element type (must be ignored, sibling still renders) |
| `!xss` | a hostile reply and a `javascript:` url (both must be inert) |
| `!410` `!403` `!429` `!500` | forces that status |

The realistic test is serving the widget and the host page from **different origins** — that is
what a customer hits. Run a second static server on another port with a page that points its
`src` at 5501.

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
  never from the CDN's own domain.
- **The 1.5.0 contract sync is pending.** `BUILT_AGAINST` is `'1.4.1'` while 2.4.0 already
  renders `property_cards` / `promo_card` / `quick_replies` and reads the init `actions[]`, so
  a server reporting 1.5.0 fires the one-time drift warn **by design**. Release **2.5.0** is
  the sync: re-vendor `docs/wsuite/` from tag `chatbot-contract-v1.5.0`, reconcile the three
  renderers against the shipped spec, then move `BUILT_AGAINST`.
  `docs/proposals/response-contract-phase2-elements.md` records what 2.4.0 implements and the
  open points to settle with the platform team.
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
  on a control they cannot see. This repo has rediscovered that bug four times — the teaser,
  the carousel arrows, the prompt pills, the language row. It is a rule, not a case.
- Never touch `document.documentElement.lang`, the host's `<body>`, or anything outside
  `#nest-chatbot`. The host page is not ours.
- Version bumps err small: little changes are a **patch**, even when they touch behaviour.
  Reserve minor for genuinely new surface (a config attribute, a UI feature, a contract
  sync), major for breaking the embed contract.
