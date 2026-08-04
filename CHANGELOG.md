# Changelog

The widget's own release line. `VERSION` in `nest-chatbot.js` and `window.NestChatbot.version`
are the only version sites — there is no package.json (CLAUDE.md rule 1). Contract syncs track
the vendored packet in `docs/wsuite/`; `BUILT_AGAINST` records which contract each release
implements.

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
