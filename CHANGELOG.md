# Changelog

The widget's own release line. `VERSION` in `nest-chatbot.js` and `window.NestChatbot.version`
are the only version sites — there is no package.json (CLAUDE.md rule 1). Contract syncs track
the vendored packet in `docs/wsuite/`; `BUILT_AGAINST` records which contract each release
implements.

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
