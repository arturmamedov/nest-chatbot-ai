# Phase 3 — "Nest Concierge": photography-led shell refactor

> Validated against the repo on 2026-07-30. **Phase 2 was implemented 2026-07-29 as 2.4.0 on
> branch `phase-2-panel-redesign` (off `main` @ 630c299) — deliberately left unmerged and
> unpushed at the owner's choice.** Check where it stands first
> (`git log --oneline main..phase-2-panel-redesign`) and build Phase 3 on top of that branch
> (or after it merges) — never on `main` without it. Phase 2 provides: self-hosted
> `nc-Poppins`/`nc-Montserrat`, the `--nc-surface-sunken` / `--nc-dur-slow` /
> `--nc-text-subtle` / `--nc-shadow-card` tokens, the `Hide ⌄` + `⤢` controls, prompt pills,
> `prompt_button` chips and the carousel. Where this file and the design docs disagree,
> **this file wins**; between design docs, **the mock (`Germán Widget.dc.html`) wins** over
> `NEST_CHATBOT_DESIGN_SYSTEM.md`. Phase 2's implementation overruled its own plan four
> times (announcer design, sheet width, carousel resync, closed-panel tab order) — expect
> this file to carry defects too; overrule it when the code disagrees, and note it.

Same repo and constraints: `nest-chatbot-ai` — one classic-script IIFE (strict ES5 syntax),
one scoped stylesheet, **no build step, no new origin, never `innerHTML`**. CLAUDE.md's hard
rules apply. This phase changes **the shell only** — every Phase 2 component (prompt
machinery, hostel carousel, Nest Pass block, contact pills, getting-here row, composer,
sizing/expand behaviour) is reused as is.

Read first: option **1D** in `Germán Widget.dc.html`, plus `NEST_CHATBOT_DESIGN_SYSTEM.md`
§4.2, §4.3, §4.12, §5 — then the shipped header/panel code in `nest-chatbot.js` (`build()`)
and `css/nest-chatbot.css`.

## Prerequisite — photography (user input needed)

The repo ships no photos. Before implementing, the hero images must be supplied: either the
user provides them, or approved hero shots are taken from nestshostels.com and committed as
optimized copies (~1200px wide, ≤120KB JPG each) under `img/`. At minimum one shipped
default (`img/hero-default.jpg`); optionally one per island. Do not hotlink — assets ship
from our origin and resolve via `assetBase`, like every other image.

## The idea

The teal header bar is replaced by real photography, the way every hero on nestshostels.com
works: a hostel photo under a 50% black overlay with white text. On welcome it is a 190px
hero; on the first guest message it collapses to a 54px photo strip, so no vertical space is
wasted. (Phase 2 §0 froze the `#53CED1` header *for Phase 2* — this phase is the deliberate
change to it. The 15px panel radius and the footer strip stay.)

## 1. Hero (welcome state)

- 190px tall (150px below 640px). Layered so a missing photo degrades silently:
  `background: var(--nc-secondary)` always, the photo via `background-image` +
  `background-size: cover`, the overlay `rgba(0,0,0,.5)` on top. No gradient, no grain. A
  404'd photo simply leaves deep teal behind the white text — no JS error handling, and
  contrast holds in both states.
- **Photo source order**: (1) a new `data-hero` script attribute (host-supplied URL — accept
  it only through `safeHttpUrl()` and escape quotes before it enters the `url("…")`
  string); (2) a new optional `data-island` attribute (`tenerife` | `gran-canaria` |
  `ibiza`) mapping to a shipped island hero, if island photos were supplied; (3) the shipped
  default. Both attributes are documented in CLAUDE.md's config table. Only the chosen
  image is ever referenced, so only one downloads; the panel open animation never waits on
  it.
- Top row over the photo: a pill holding a 24px avatar circle (white disc, the teal mark
  `img/logotipo-nests-tenerife.png`) + `Germán` (Poppins 600 13px white) + an `AI` badge
  (update Phase 2's badge key — and retire Phase 2's header subline key from **all five
  packs** if nothing renders it; packs stay in sync). On the right: the language control and
  `Hide ⌄` / `⤢` (see §1a).
- Bottom of the hero, white text with `text-shadow: 3px 3px 0 rgba(0,0,0,.35)` (the brand's
  hero treatment):
  - Title, Poppins 700 21px, two lines: "Your travel community in the Canaries & Ibiza"
  - Subline, 12.5px `rgba(255,255,255,.85)`: "14 hostels · 3 islands · 1 Nest Pass"
  - Both are user-visible → `t()` keys in all five packs ("Nests" / "Nest Pass" and the
    island names untranslated; FR spacing rules). **Poppins 700 is a new font file** —
    Phase 2 only ships the 600 weight; add `fonts/poppins-700.woff2` (latin subset, OFL) to
    the existing `@font-face` block under the `nc-Poppins` family. If the mock reads fine at
    600, using 600 and skipping the file is an acceptable deviation — note it either way.
  - Title/subline live in tags the scoped reset already covers, or the new tag is added to
    the reset block (`css/nest-chatbot.css` top comment says exactly this) — a host theme's
    bare `p`/`h3` rule must not restyle the hero.

### 1a. Language control moves onto the photo — flagged decision

Option 1D and design-system §4.3 put the language control in the header; §4.11 and Phase 2
§0 say it stays in the footer. **Mock wins: it moves onto the photo** — same `.nc-lang`
machinery and flag-row behaviour, repositioned (DOM move in `build()`, restyle as a
`rgba(0,0,0,.35)` pill with a `rgba(255,255,255,.22)` border). Consequences to handle:

- The footer loses the flag circle → the composer gets its full width back (Phase 2's
  4s row-collapse tweak stays; it is harmless and still useful in the hero).
- The expanded flag row must fit the hero pill at 420px and inside the 54px strip — if it
  cannot, opening downward over the body or capping flag size is implementer latitude; the
  interaction (toggle → row → pick → collapse) must not change.
- Focus rings: the shipped `outline: 2px solid var(--nc-secondary)` is invisible on a dark
  photo — hero controls get a white `:focus-visible` ring instead.
- **Two focus defects are already open against the language row** from Phase 2's review:
  the collapsed flag row is still tabbable, and `closeLanguageMenu()` does no focus check.
  Fix both while moving the control — CLAUDE.md's Conventions state the rule (keyboard
  focus must never escape `#nest-chatbot` when a node vanishes or collapses); this bug
  class has recurred four times in this codebase.

If this placement proves wrong in testing, fall back to leaving the switcher in the footer
and note the deviation — that is §4.11's own position, so it needs no new approval.

## 2. Collapse behaviour

- On the **first guest message of the page load**, the hero animates 190px → 54px over
  `var(--nc-dur-slow)` (`height` + `background-position`), keeping the pill and controls;
  the title/subline fade out over 200ms first. Sequencing timers follow the teardown
  contract (`teardown()` clears nothing; callbacks early-return on `removed`).
- Collapsed strip: 54px, same photo at `background-position: center 40%`, same overlay,
  28px avatar, 14.5px name.
- "Reset" defined concretely: hero state is **per page load** — it collapses once and stays
  collapsed; a fresh page load renders the full hero again (the widget does not replay
  transcripts on reload, so welcome state and hero always reappear together). The `⤢`
  panel expand does not re-expand the hero.
- Under `prefers-reduced-motion`, heights switch instantly (the zeroed motion tokens should
  cover this — verify, don't assume).

## 3. Welcome body — 2×2 shortcut grid

Replace Phase 2's vertical `TRY ASKING` prompt pills with option 1D's grid (the pill
styling itself stays — `prompt_button` follow-up chips keep using it; retire the
`tryAsking` key from all packs if nothing renders it):

- Cards: real `<button>`s, 1px `var(--nc-border)`, radius 12px, padding `11px 12px`,
  Poppins 600 12.5px title + 11px `var(--nc-text-subtle)` hint, hover `scale(1.02)` +
  `var(--nc-surface-sunken)` fill, visible focus ring.
- Four cards (title / hint — 8 new `t()` keys × 5 packs):
  `Find my Nest` / *Surf, city or party* · `Nest Pass` / *How it works* ·
  `Check dates` / *Beds & prices* · `Getting here` / *Airport & shuttle*
- Each card sends its prompt as a normal guest turn (the Phase 2 prompt-click path). The
  first two reuse Phase 2's `prompt1`/`prompt2` messages; `Check dates` and `Getting here`
  get new prompt strings **worded so the mock fixtures answer them** (e.g. containing
  "rooms" to hit the availability fixture) — extend the `Mock` trigger table if a card has
  no meaningful route, and sync the fixture comment, demo-page prose and CLAUDE.md table.
- The greeting bubble stays above the grid; the grid disappears with the welcome state
  (first guest message), same as Phase 2's pills — and its removal must apply the same
  focus rule Phase 2's pill removal already solves (a card can hold keyboard focus when it
  vanishes; reuse that pattern, don't reinvent it).

## 4. Composer

Same as Phase 2, one change: the send button becomes `var(--nc-accent)` in this direction —
the only accent element in the welcome view (the hero has no CTA). The moment any renderer
draws an orange element (the carousel's `Book now`), flip a class on the root and the send
button reverts to `var(--nc-secondary)` for the rest of the page load — a one-way flag set
at render time, **not** DOM-scanning for "is a Book now on screen". Never two orange
elements at once.

## 5. Definition of done

- Welcome and in-conversation views match option **1D**; every Phase 2 component renders
  unchanged inside the new shell; all pre-existing mock triggers
  (`book contact rooms link available !unknown !xss !410 !403 !429` + Phase 2's) still pass.
- Hero photo causes no layout shift and never delays the open animation; the missing-image
  fallback shows `var(--nc-secondary)`; contrast of every white-on-photo string checked
  with the overlay applied (and against the plain-teal fallback).
- Mobile (<640px): hero 150px, collapsed strip 54px, `✕` at 44×44; the expanded side sheet
  (**670px** — Phase 2 widened it from the design doc's 640px to fit the 200px cards;
  verify the value in the branch's CSS) and the compact 420px panel both carry the hero
  correctly.
- Keyboard focus never escapes `#nest-chatbot` when the grid, the language row or any hero
  control vanishes or collapses — including the two pre-existing language-row defects
  fixed in §1a.
- No build step, no new origin (photos and fonts ship from `assetBase`), no `innerHTML`,
  every new selector under `#nest-chatbot` with the `nc-` prefix; demo-page traps
  unchanged; a cross-origin pass (:8080 host page → :5501 widget) resolves the hero images.
- `prefers-reduced-motion` honoured; new timers follow the teardown contract; no console
  output without `data-debug`; all new/changed/retired i18n keys consistent across the five
  packs and live-patched by `setLocale()`.
- Before/after screenshots (Playwright MCP, mock mode): welcome + conversation, desktop
  compact, desktop expanded, mobile — plus a note of any deviation from the mock and why
  (the Poppins 600-vs-700 and language-placement calls from §1/§1a explicitly included).
- `VERSION` → next minor (2.5.0 if Phase 2 shipped as 2.4.0 — new UI surface and new
  `data-hero`/`data-island` config attributes), CHANGELOG entry in house style, CLAUDE.md
  config + trigger tables synced. `BUILT_AGAINST` untouched — no contract change in this
  phase.

This is the last phase of the redesign packet.
