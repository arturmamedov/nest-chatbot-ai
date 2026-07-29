# Changelog

The widget's own release line. `VERSION` in `nest-chatbot.js` and `window.NestChatbot.version`
are the only version sites — there is no package.json (CLAUDE.md rule 1). Contract syncs track
the vendored packet in `docs/wsuite/`; `BUILT_AGAINST` records which contract each release
implements.

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
  horizontally snapping strip of 200px cards over a photo band, with an optional badge, an
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
