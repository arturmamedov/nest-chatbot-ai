# Handoff: Germán chat widget — phased redesign

## Overview
Redesign of the floating AI assistant widget in `arturmamedov/nest-chatbot-ai` (plain HTML + Tailwind build + vanilla JS).
Goal: make it feel premium and unmistakably Nests Hostels, reclaim vertical space, and let structured answers (hostels, Nest Pass, contacts) render as components instead of prose.

Delivered in three phases, each reviewed before the next starts:

| Phase | Scope | Prompt file |
|---|---|---|
| 1 | Launcher: white avatar puck + quiet unread dot + self-dismissing teaser | `PHASE_1_PROMPT.md` |
| 2 | Panel skin, suggested prompts, hostel carousel, Nest Pass block, contact pills, compact → side-panel sizing | `PHASE_2_PROMPT.md` |
| 3 | Refactor the shell to the photography-led "Nest Concierge" layout | `PHASE_3_PROMPT.md` |

## About the design files
`Germán Widget.dc.html` is a **design reference created in HTML** — a static mock of the intended look and behaviour, not production code to copy.
Implement it inside the existing `nest-chatbot-ai` environment: `index.html`, `css/nest-chatbot.css` (compiled Tailwind in `css/output.css`), `javascript/nest-chatbot.js` + `javascript/modules/`. **No new dependencies** — plain JS, plain CSS.

The mock is organised as review options with visible ids:

- **1A** — the widget as it is today, rebuilt from the repo's CSS. Baseline for diffing.
- **1B** — "Nest Light": the approved skin, prompts, cards.
- **1C** — "Nest Focus": dark brand surface. **Parked** for a future dark mode. Do not build.
- **1D** — "Nest Concierge": photography-led. Phase 3 target.
- **2A / 2B / 2C / 2D** — the merged build spec that phases 1–2 must match (launcher, welcome, carousel answer, sizing).

## Fidelity
**High-fidelity.** Colours, type, radii, spacing and copy in the mock are final. Match them. Where the mock and `NEST_CHATBOT_DESIGN_SYSTEM.md` disagree, the design system wins.

## Screens / views
See `NEST_CHATBOT_DESIGN_SYSTEM.md` §4 for every component with exact values, §5 motion, §6 accessibility, §9 approved copy. Summary:

**Launcher (closed)** — 60px white circle, 2px `#53CED1` border, `img/logotipo-nests-tenerife.png` at 34px, shadow `0 10px 26px -8px rgba(13,111,130,.45)`. Unread dot: 14px `#EA580C`, 2px white border, top-right, no number. Teaser: white bubble, max 250px, radius `14px 14px 4px 14px`, 12.5px copy + 18px ✕.

**Panel — welcome** — existing 420px shell (radius 15px, `#53CED1` header, `#ececec` footer) with: 44px avatar, Poppins 600 19px "Germán", `AI ASSISTANT` badge (9.5px, `#0D6F82` fill), 12px subline, labelled `Hide ⌄` control. Body white, 16px padding: greeting bubble (`#F1F6F7`, radius `16px 16px 16px 4px`, 14px Montserrat) → `TRY ASKING` label → 2 prompt pills (13px, `#0D6F82` text, 1.5px `rgba(83,206,209,.55)` border) → island question bubble → 3 island chips. Footer keeps today's flag circle + 32px pill input, plus a centred 10.5px disclaimer.

**Panel — rich answer** — user bubble (`#0D6F82`, white text, radius `16px 16px 4px 16px`) → bot bubble → hostel carousel (190px cards, 88px photo, badge, title with teal "Nest", price, orange `Book now`; arrows + dots) → Nest Pass block (focus-surface gradient, white ghost button) → contact pills in today's 1A style (`#E3F4F5` fill, `#0D6F82` text).

**Sizing** — mobile and tablet: full screen. Desktop: 420px compact → 640px right-side sheet on `⤢` or automatically after the 3rd assistant message; always shrinkable and hideable.

## Interactions & behaviour
Full rules in the phase prompts. Highlights: teaser appears once per session after 8s idle, auto-hides after 6s, never returns after a manual dismiss; unread dot clears on first open; carousel is CSS scroll-snap (no JS drag); auto-expand fires once per session and never after a manual shrink; `Esc` hides and returns focus to the launcher.

## State (all client-side, no backend change in phases 1–2)
`sessionStorage`: `nc.opened`, `nc.unread`, `nc.autoExpanded`, `nc.conversationUuid`, `nc.locale`, `nc.scrollTop`.
`localStorage`: `nc.teaserDismissed`, `nc.userShrank`.

## Design tokens
`NEST_CHATBOT_DESIGN_SYSTEM.md` §2 — copy the `--nc-*` block verbatim into `css/nest-chatbot.css`. Brand values: `#53CED1`, `#0D6F82`, `#083344`, `#EA580C` (Book now only), `#F1F6F7`, `#E6EDEE`, `#12333C`. Type: Poppins 600 headings, Montserrat 400/500 body, Archivo Black slogans only.

## Assets
From the repo, already in this bundle under `img/`:
- `logotipo-nests-tenerife.png` — teal bird, launcher + bot avatar
- `Ibiza-a21caf.png` — purple Nest badge, header avatar today
- `nest-chatbot_white.png` — white bird
- `Group 236.png`, `Group-3.png` — white bird / wordmark variants

Hostel photos in the mock are remote (`nestshostels.com/.../gallery/*.jpg`) and are placeholders — the real ones come from the hostel API/ACF. Flags use `flagsapi.com` today; replace with local files (see design system §8).

## Files in this bundle
- `Germán Widget.dc.html` — the design reference (open in a browser)
- `NEST_CHATBOT_DESIGN_SYSTEM.md` — the widget design system, source of truth
- `PHASE_1_PROMPT.md`, `PHASE_2_PROMPT.md`, `PHASE_3_PROMPT.md` — standalone prompts for Claude Code
- `img/` — widget assets from the repo
