# Phase 2 — Panel skin, suggested prompts, hostel carousel, Nest Pass, sizing

> Validated against the shipped widget **2.3.0** on 2026-07-28. The original draft of this
> prompt was written against the pre-2.0 codebase; every stale reference (Tailwind,
> Font Awesome, `package.json`, `javascript/modules/`, `:root` tokens, `nc.*` storage keys,
> "the API has no structured results") has been corrected below. Where this file and the
> design docs disagree, **this file wins**; where the design docs disagree with each other,
> **the mock (`Germán Widget.dc.html`) wins** over `NEST_CHATBOT_DESIGN_SYSTEM.md`.

Same repo and constraints as Phase 1: `nest-chatbot-ai` — one classic-script IIFE
(`nest-chatbot.js`, strict ES5 syntax: `var`/`function`, no arrows/`let`/`const`), one scoped
stylesheet (`css/nest-chatbot.css`), **no build step, no new origin, never `innerHTML`**.
CLAUDE.md's hard rules apply to every line of this phase. Phase 1 (white puck launcher,
unread dot, teaser) shipped as **2.3.0** — don't redo or touch it.

Read first: `NEST_CHATBOT_DESIGN_SYSTEM.md` §2–§6 and §9 (approved copy), and the mock
`Germán Widget.dc.html` — options **2B** (welcome), **2C** (carousel answer), **2D**
(sizing). Option 1A is the pre-redesign widget; **1C is parked, do not build it**. Then read
the real code: `nest-chatbot.js` (the banner sections are its table of contents) and
`css/nest-chatbot.css`, plus `docs/wsuite/response-contract.md` for the element envelope.

## 0. What must NOT change

- **The language switcher stays as it is today**: `.nc-lang` flag circle in the footer, left
  of the composer, expanding the horizontal flag row (`.nc-controls.nc-lang-open`). Flags
  are inline SVG constants in `nest-chatbot.js` — already local, nothing to replace. One
  tweak allowed: collapse the open row on the first composer keystroke or after 4s with no
  choice (it squeezes the composer to ~150px). The 4s timer follows the repo's teardown
  contract — nothing is cleared in `teardown()`; the callback early-returns on `removed`.
- **Existing `actions[]` pills keep today's shipped styling** — `.nc-action` /
  `.nc-action--primary` / `.nc-channel` / `.nc-action-row` as they are in
  `css/nest-chatbot.css` (the original draft quoted `#E3F4F5` / `--nc-r-pill` values from the
  pre-2.0 widget; today's values are the truth). Restyle them only if mock 2C explicitly
  shows them changed.
- **The panel shell keeps** `border-radius: 15px`, the `var(--nc-primary)` (#53CED1) header
  and the `var(--nc-surface)` (#ececec) footer strip. (The composer *well* inside the footer
  may move to the new `--nc-surface-sunken` if that is what mock 2B shows.)
- **Everything Phase 1 shipped**: launcher, `.nc-unread`, `.nc-teaser`, their flags and
  timings, the `data-offset-*` / `--nc-edge-*` mechanics.
- The transport, the storage of the conversation uuid, and the response-contract handling.
  `BUILT_AGAINST` stays `1.4.1` — it moves only at a contract sync, and this phase is not
  one.

## 1. Typography + header (chrome)

- **Fonts — self-hosted, never a fonts CDN.** A host must trust exactly one extra origin:
  ours (CLAUDE.md rule 1). No Google Fonts link. Add a `fonts/` directory with WOFF2 latin
  subsets (all SIL OFL): Poppins 600, Montserrat 400/500/600. Declare `@font-face` at the top
  of `css/nest-chatbot.css` with **prefixed family names** (`"nc-Poppins"`,
  `"nc-Montserrat"`) — `@font-face` is an at-rule and cannot be nested under `#nest-chatbot`,
  and a prefixed name is what guarantees our files can never merge with a host page's own
  Poppins/Montserrat registration. `src: url("../fonts/…woff2")` resolves against the CSS
  file's URL, i.e. our asset base, from any CDN path. `font-display: swap`. New tokens with
  their consumers: `--nc-font-heading: "nc-Poppins", Poppins, system-ui, sans-serif;`
  `--nc-font-body: "nc-Montserrat", Montserrat, …` (the root's current hardcoded Montserrat
  stack becomes `var(--nc-font-body)`).
- **Header** (~62px): keep the teal bar. Avatar is `img/germanavatar.png` — the file the
  header uses today (the draft's `Ibiza-a21caf.png` does not exist in this repo) — down from
  50px to 44px. Name "Germán" Poppins 600 19px white; next to it an `AI ASSISTANT` badge
  (9.5px, 600, `.06em`, white on `var(--nc-secondary)`, radius 4px). Subline 12px `#0A5766`:
  "Nests Hostels · replies in seconds". **No white body text on `#53CED1`** — it fails
  contrast; that is why the subline is deep teal (the white 19px name is the mock's one
  deliberate exception). Badge and subline are user-visible → `t()` keys in all five packs;
  today's `subtitle` key and `els.subtitle` get replaced/renamed accordingly, including the
  panel `aria-label` and the `setLocale()` live-patch list.
- **Minimise control**: replace the bare `−` icon with a labelled `Hide ⌄` control — 30px
  tall, radius 8px, `rgba(255,255,255,.22)`, visible text through `t('hide')`, keep an
  aria-label (today's `close` key). Below 640px it renders as `✕` at 44×44 instead. Add an
  `⤢` expand control left of it (§5). New glyphs (chevron, expand, ✕) are new module-local
  constants in `ICONS`, parsed only through `svgNode()` — that is the only sanctioned
  DOMParser path.
- ~~Drop the Font Awesome CDN~~ — already gone since 2.0. Icons are inline SVG constants;
  nothing to do.

## 2. Message list

- Add token `--nc-surface-sunken: #F1F6F7` **with its consumers** (bot bubble, and the
  composer well if mock 2B shows it). Do **not** rename or repoint `--nc-surface` — the
  footer strip and today's pills depend on #ececec, and the design system's token sheet is
  still forbidden to import wholesale (its `--nc-surface` is white, its `--nc-z` would break
  `data-z-index` — same trap Phase 1 documented).
- Bot bubble: `var(--nc-surface-sunken)`, radius `16px 16px 16px 4px`, padding `12px 15px`,
  max-width 82%, 14px/1.5 `var(--nc-font-body)`, `var(--nc-text)`, `text-wrap: pretty`.
- Avatar: `avatarNode()` shrinks from 45px to 32px — an `#E3F4F5` circle with the teal mark
  at ~21px, aligned to the bubble's bottom edge, 9px gap (today's `color-mix` tint may stay
  if it reads the same). Consecutive bot messages: avatar on the first only — `addBubble()`
  checks whether the previous sibling is already a bot message.
- User bubble: `var(--nc-secondary)`, white, radius `16px 16px 4px 16px`.
- Keep the thinking dots and the per-character typer, but **skip the typer under
  `prefers-reduced-motion`** (set the full text at once, then call `done`). Announce a
  finished message **once**: today `.nc-body` is `role="log" aria-live="polite"
  aria-relevant="additions text"`, and `typeText()`'s per-character `appendData` re-announces
  on some screen readers — restructure so assistive tech hears the completed message a
  single time, never the stream.
- Message enter: 240ms fade + `translateY(6px)`, covered by the reduced-motion block.

## 3. Suggested prompts (welcome state only)

- **The greeting is server-owned.** The init response carries `greeting`
  (contract §init); the widget's `STRINGS.*.greeting` is only the fallback and what the mock
  serves. Update the fallback packs and the mock to the approved welcome line — EN verbatim
  from design system §9: *"Hi! I'm Germán, the Nests AI assistant. Your travel community in
  the Canaries & Ibiza — 14 hostels · 3 islands · 1 Nest Pass."* — and note in the §4
  proposal doc that the production greeting is configured platform-side.
- Under the greeting, indented to the bubble text (32px avatar + 9px gap = 41px): label
  `t('tryAsking')` ("Try asking", uppercased via CSS `text-transform`, 10.5px, 600, `.08em`,
  new token `--nc-text-subtle: #7B939A` with this consumer), then pill buttons — real
  `<button>`s, 13px `var(--nc-font-body)` 500, `var(--nc-secondary)` text, `1.5px solid
  rgba(83,206,209,.55)`, white fill, radius `999px` (add `--nc-r-pill` with this consumer),
  padding `9px 14px`, hover `scale(1.02)` + `var(--nc-surface-sunken)` fill.
- Two prompts, `t('prompt1')` "Which hostel fits me best?" and `t('prompt2')` "How does the
  Nest Pass work?". Clicking one sends it as a normal guest turn (same path as `submit()`),
  and the prompt block is removed after the first guest message of the page load.
- Composer placeholder changes to "Ask Germán anything…" (**update** the existing
  `placeholder` key). Disclaimer centred under the composer, 10.5px
  `var(--nc-text-subtle)`: `t('disclaimer')` "AI answers — double-check important".
- **Every string above lands in all five packs (`en es it de fr`) in the same commit** —
  repo convention, not "locales later". Voice rules: sentence case, "Germán" / "Nests" /
  "Nest" / "Nest Pass" never translated, FR keeps its space before `?` / `!` / `…`.
- The follow-up ("Which island are you going to?" + island chips) is **conversation
  content, not widget chrome** — it comes from the server in production and from the mock
  fixtures here (§4). The widget must never fabricate assistant turns client-side.

## 4. Rich answers — new `actions[]` element types

**Correction to the draft:** the API *does* return structured results — contract 1.4.1 ships
typed elements in `actions[]` (`booking_link`, `contact_channels`, `availability`,
`link_button`, `async_result`), and the repo rule says a new rich type is **exactly one new
branch in `renderAction()`**. So Phase 2's cards are not a parallel system:

1. **No new files, no URL flags.** Not `javascript/modules/nest-chatbot-cards.js`, not
   `javascript/db/demo-cards.json`, not `?demo=cards` — that was the pre-2.0 layout. The
   renderers are functions in the render section of `nest-chatbot.js`; the demo data lives
   in the `Mock` object shaped exactly like the real envelope; the triggers are composer
   keywords like the existing `book` / `rooms` / `link` table.
2. **New element types**, proposed in the contract's style and rendered as new
   `renderAction()` branches (each returns `null` to close the open CTA row, or passes
   `row` through — see the existing branches):

   ```json
   { "type": "hostel_carousel", "hostels": [
       { "id": "medano", "name": "Medano Nest", "island": "Tenerife", "area": "El Médano",
         "image": "https://…", "from": 22, "currency": "EUR",
         "badges": ["Nest Pass", "Loooong Stay"], "url": "https://nestshostels.com/…" } ],
     "more_url": "https://nestshostels.com/hostels", "total": 14 }

   { "type": "nest_pass", "title": "Staying 7+ nights?",
     "body": "The Nest Pass moves with you between Tenerife and Gran Canaria — up to 30% off.",
     "cta": { "label": "See Nest Pass →", "url": "https://…" } }

   { "type": "getting_here", "title": "Getting here",
     "line": "TFS airport → El Médano, bus 111, ~20 min", "map_url": "https://…" }

   { "type": "prompt_button", "label": "Tenerife", "message": "Tenerife" }
   ```

   `prompt_button` is the one genuinely new action kind (sends its `message` as the guest's
   next turn); `url` / `tel` / `whatsapp` / `mail` actions from the design system already
   exist as `link_button` and `contact_channels` — do not duplicate them.
3. **Security is the contract's, unchanged**: every payload string reaches the DOM via
   `textContent` / created nodes; every `url` / `image` / `map_url` passes `safeHttpUrl()`
   (http/https only) or is dropped; missing/malformed fields degrade to skipping that
   element, never to an error; unknown keys are ignored. Prices render from `from` +
   `currency` via `Intl.NumberFormat` (runtime ES6+ APIs are fine; it's the *syntax* that
   stays ES5), through a `tf('fromPerNight', …)` string.
4. **Document the proposal** in a new `docs/proposals/response-contract-phase2-elements.md`
   addressed to the wSuite platform team: the shapes above, ordering within `actions[]`, the
   max-one-`nest_pass`-per-conversation rule, and the greeting note from §3.
   `docs/wsuite/` is vendored read-only — never edit it, and `BUILT_AGAINST` does not move.
   When upstream adopts (possibly with changed shapes), a normal contract sync reconciles.
5. **Mock triggers** (extend the fixture table in the api section, the fixtures comment, the
   demo page prose, and CLAUDE.md's trigger table):
   - `hostel` (matches prompt 1's text) → island question + three `prompt_button` chips
     (Tenerife · Gran Canaria · Ibiza)
   - `tenerife` → carousel answer: text + `hostel_carousel` (3 fixture cards + `more_url`)
     + `getting_here` + the standard CTA trio
   - `pass` (matches prompt 2's text) → text + `nest_pass`
   - existing triggers (`book contact rooms link available !unknown !xss !4xx`) keep working
     untouched — that is the regression gate.

### 4a. Hostel carousel

14 hostels never stack. A horizontal scroll-snap track inside the bot message column:

- Track: `display:flex; gap:10px; overflow-x:auto; scroll-snap-type:x mandatory;
  scrollbar-width:none` + hidden webkit scrollbar; cards `scroll-snap-align:start;
  flex-shrink:0`. Native touch/trackpad swipe — no JS drag.
- Card 190px (200px in the expanded sheet): 88px `object-fit:cover` photo, badge pill
  top-left (9.5px, 600, `rgba(255,255,255,.92)` fill, `var(--nc-secondary)` text), title
  Poppins 600 13.5px with the word "Nest" in `var(--nc-primary)` (safe: split the *known
  constant* "Nest" out of the payload name via created spans — still no innerHTML), 11px
  location, `from €22/night` (price Poppins 600 14px), full-width `Book now` button (34px,
  radius 10px, `var(--nc-accent)`, uppercase Poppins 600 11.5px, reuses `t('book')`).
- **`Book now` is the only orange element in the panel** — one per card is fine, no second
  filled button anywhere else.
- Edges: 44px white fade + 30px white circular `›` / `‹` buttons (new token
  `--nc-shadow-card` with this consumer), each hidden at its track end (scroll listener on
  the track — inside the widget, allowed). Dots below: active `16×5px var(--nc-secondary)`,
  inactive `5×5px #CBD9DC`.
- Max 8 cards, then a final `See all 14 hostels →` card from `more_url` + `total`
  (`tf('seeAllHostels', total)`).
- A11y: `role="group"`, localized `aria-roledescription`, arrows are real buttons with
  `t()` labels, `←`/`→` move focus between cards, every card link keyboard-reachable with
  the visible focus ring.

### 4b. Nest Pass block and getting-here row

- Nest Pass: full-width card on `--nc-focus-surface` (add the token — the design system's
  teal gradient — with this consumer), Poppins 600 13.5px white title, 12.5px
  `rgba(255,255,255,.82)` body, white ghost CTA. **Max one per conversation** — a
  module-level flag per page load; the proposal doc asks the server to enforce it too.
- Getting-here: bordered row (`--nc-border`), 54px thumb (optional `image`, else skip), title
  Poppins 600, 11.5px route line, `Open map →` link from `map_url` via `safeHttpUrl` and
  `t('openMap')`.

## 5. Sizes and the side sheet

| Viewport | Behaviour |
|---|---|
| < 640px | Full-screen sheet, radius 0, `100dvh`, safe-area bottom padding, `✕` at 44×44 |
| 640–1023px | Full-screen sheet, same |
| ≥ 1024px | Compact 420px floating panel ↔ expanded 640px right-side sheet, full height minus 24px margins, left corners rounded 15px |

- Today's fullscreen breakpoint is the `@media (max-width: 520px)` block — it widens to
  1023px. Keep the Phase-1 `639px` block (edges/launcher/teaser) and the var-based
  mechanics: `data-offset-*` writes inline styles that must keep outranking every
  breakpoint.
- Expand on `⤢`, shrink on `⤡`, `Hide ⌄` minimises. `Esc` already closes and refocuses the
  launcher (`onDocumentKeydown`) — keep it. Expanded state is a class on the root
  (e.g. `nc-expanded`), width/height transition over `--nc-dur-slow: 500ms` (add the token —
  this is its first consumer, which is why Phase 1 deliberately left it out).
- **Auto-expand once per session after the 3rd assistant reply** (greeting excluded). Flags
  via the Phase-1 helpers `readFlag`/`writeFlag`, repo-style keys, deliberately unsuffixed
  like the launcher flags: sessionStorage `nest-chatbot:auto-expanded`, localStorage
  `nest-chatbot:user-shrank` — a visitor who has manually shrunk it is never auto-expanded
  again.
- Resizing is CSS-only: scroll position and all messages survive; nothing is rebuilt.
- In the 640px sheet: the carousel shows 3 cards and the Nest Pass block sits beside the
  getting-here row (style off the `nc-expanded` class).

## 6. Definition of done

- Welcome, prompt-click flow, carousel answer, expanded sheet, and mobile full-screen match
  mocks **2B / 2C / 2D**; screenshots of all five states (Playwright MCP against
  `python -m http.server 5501` → `demo/index.html`, mock mode), plus a note of any
  deliberate deviation and why.
- Plain-text replies and every pre-existing trigger render exactly as 2.3.0 does —
  `book contact rooms link available !unknown !xss !410 !403 !429` is the regression gate;
  `!xss` stays inert through every new renderer.
- No new origin, no build step, no `package.json`, no `innerHTML`; every new selector under
  `#nest-chatbot` with the `nc-` prefix; the demo page's collision/reset/furniture traps
  unchanged when the widget loads; a cross-origin pass (host page on :8080, widget on
  :5501) still resolves fonts, images and styles via `assetBase`.
- Focus ring visible on every new control; contrast checked (no white *body* text on
  `#53CED1`); `prefers-reduced-motion` honoured everywhere new motion or the typer is
  involved; all new timers follow the teardown contract (`teardown()` clears nothing;
  callbacks early-return on `removed`).
- No console output without `data-debug` (the contract-drift warn stays the sole exception).
- All new/changed i18n keys present in all five packs; `setLocale()` live-patches every new
  label; section banners kept; comments explain *why*, in English.
- `VERSION` → **2.4.0** (genuinely new surface → minor, per CLAUDE.md's versioning
  convention), CHANGELOG entry in house style, CLAUDE.md trigger table synced,
  `docs/proposals/response-contract-phase2-elements.md` written. `BUILT_AGAINST` untouched.

Do not start Phase 3.
