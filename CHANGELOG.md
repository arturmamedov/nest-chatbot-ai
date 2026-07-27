# Changelog

The widget's own release line. `VERSION` in `nest-chatbot.js` and `window.NestChatbot.version`
are the only version sites — there is no package.json (CLAUDE.md rule 1). Contract syncs track
the vendored packet in `docs/wsuite/`; `BUILT_AGAINST` records which contract each release
implements.

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
