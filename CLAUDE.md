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
page and has to be treated as compromised.

### 4. Every CSS rule is scoped

Every selector in `css/nest-chatbot.css` is nested under `#nest-chatbot`, and every class
carries the `nc-` prefix. There are **no** global selectors — no `*`, no `body`, no `html`, no
bare element rules, no unprefixed utility classes.

The widget lands on sites with their own `.hidden`, `.message` and `.chat-header`. One
unscoped rule repaints a customer's page. `demo/index.html` deliberately defines all three of
those class names — if the demo page's appearance changes when the widget loads, the scoping
is broken.

Theme through the custom properties on `#nest-chatbot` (`--nc-primary`, `--nc-secondary`,
`--nc-z`, …), never by editing rules.

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

- **`response-contract.md`** — the frozen v1 reply envelope and every element type.
- **`integration-guide.md`** — transport, auth, endpoints, errors, rate limits, CORS.
- **`chatbot.reference.js`** — the platform's own security-reviewed widget. When a transport or
  contract detail is unclear, read how this does it. Pinned copy; may drift from upstream.

Three endpoints: init a conversation, post a turn, poll an async turn.

```
POST {apiBase}/api/v1/chatbot/conversations               → 201 {conversation:{uuid}, greeting}
POST {apiBase}/api/v1/chatbot/conversations/{uuid}/messages → 200 {reply, actions[], turn}
GET  {apiBase}{async_result.url}                          → 200 {status, reply?, actions?, turn}
```

### Things that will bite you

- **A turn always returns `200`.** Provider, budget and LLM failures degrade server-side to a
  localized "busy" reply. A 5xx is a bug, not a business outcome. The non-200s are resolution
  failures only: `401` bad key, `403` disabled/revoked, `404` unknown uuid, `410` idled out,
  `422` config, `429` throttled.
- **`410` is normal.** Conversations idle out after 24h. Re-init transparently and resend the
  message once — the guest should never see it happen. Already implemented in `sendMessage`.
- **Do not send chat history.** The turn body is `{message}`. The server owns the transcript,
  keyed by the conversation uuid. An earlier version of this widget accumulated a `chatHistory`
  array and never sent it; do not resurrect it.
- **Rate limit is 20/min per API key, shared by every visitor of a site** — not per user. Poll
  has its own lighter 60/min bucket.
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
| `data-api-base` | — | API origin. Required once the transport is live. |
| `data-key` | — | Public-scoped `ws_live_…` key. |
| `data-property` | — | Soft property-name hint, sent at init. Unknown names are not an error. |
| `data-locale` | `auto` | `auto` matches `navigator.languages` against `en es it de fr`. |
| `data-position` | `right` | `right` \| `left` |
| `data-color` | `#0D6F82` | Sets `--nc-secondary`. |
| `data-z-index` | `2147483000` | For hosts with their own stacking conflicts. |
| `data-auto-open` | `false` | |
| `data-debug` | `false` | Gates **all** `console` output. Nothing logs in production. |

Runtime API: `window.NestChatbot` → `{ version, open, close, toggle, destroy, setLocale, locale }`.

## Local development

```bash
python -m http.server 5501        # from the repo root
# then open http://127.0.0.1:5501/demo/index.html
```

`.vscode/settings.json` already pins Live Server to 5501.

The transport is currently **stubbed** (`USE_MOCK = true`). Fixtures live in the `Mock` object
and are shaped exactly like the real envelope. Drive them from the composer:

| Type this | Exercises |
|---|---|
| `book` | `booking_link` with a stay summary |
| `contact` | `contact_channels` (phone + whatsapp + email) |
| `rooms` | `availability` with room options |
| `link` | two `link_button`s, one with `style: primary` |
| `available` | `async_result` — interim reply, then the poll replaces it in place |
| `!unknown` | an unrecognised element type (must be ignored, sibling still renders) |
| `!xss` | a hostile reply and a `javascript:` url (both must be inert) |
| `!410` `!403` `!429` `!500` | forces that status |

The realistic test is serving the widget and the host page from **different origins** — that is
what a customer hits. Run a second static server on another port with a page that points its
`src` at 5501.

## Open items

- **Wire the real transport.** Flip `USE_MOCK` to `false` and fill the three `TODO(api-session)`
  blocks in the `api` section. The status-code handling around them is already complete, so this
  is roughly 40 lines mirroring `chatbot.reference.js:72-98`. Nothing else should need to change.
- **Per-turn `locale` is not in the frozen contract.** The turn body in v1 is `{message}` only.
  The widget sends `locale` alongside it as an additive field so a guest can switch language
  mid-conversation; a v1 server ignores it harmlessly. To make that switch authoritative, the
  contract needs `locale` added to `POST /conversations/{uuid}/messages`. Raise it when the
  contract is next revisited.
- **Rotate the leaked Voiceflow key** if it has not been done (see rule 3).
- **Origin allow-listing** is planned platform-side; today CORS allows all origins, so a copied
  public key works from anywhere. When it ships, production origins must be registered per site.

## Conventions

- Comments explain **why**, not what. The code says what.
- Comments and identifiers in English. The old codebase mixed Italian and Spanish comments.
- Keep the section banners in `nest-chatbot.js` — they are the file's table of contents.
- Anything user-visible goes through `t()` / `tf()`, never a hardcoded string.
- Never touch `document.documentElement.lang`, the host's `<body>`, or anything outside
  `#nest-chatbot`. The host page is not ours.
