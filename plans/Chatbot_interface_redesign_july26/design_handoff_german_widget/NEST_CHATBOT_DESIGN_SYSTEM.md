# Germán Chat Widget — Design System

Self-contained design system for the `nest-chatbot-ai` widget (plain JS + plain CSS, **no third-party libraries**).
It is a subset of the Nests Hostels brand system, tuned for a 420px surface that floats over any page.

Source of truth for the current implementation: `css/nest-chatbot.css`, `index.html`, `javascript/nest-chatbot.js`.
Reference mock: `Germán Widget.dc.html` (options 1A current, 1B/1C/1D directions).

---

## 1. Principles

1. **The widget is a guest on the page.** It never shouts: one accent action per view, no gradient noise, no bouncing.
2. **Labelled AI.** "AI assistant" is always visible in the header, and every panel carries one disclaimer line.
3. **Answers are objects, not paragraphs.** A hostel, a price, a route, a phone number each has a component. Prose only glues them.
4. **Nests type or it isn't Nests.** Poppins for names/headings, Montserrat for everything readable, Archivo Black only for a slogan.
5. **Chrome shrinks, content grows.** Header ≤ 62px, footer ≤ 78px, all remaining height belongs to the conversation.
6. **Every control is reachable.** 44px minimum hit target on mobile, 30px minimum on desktop chrome.

---

## 2. Tokens

Drop into `css/nest-chatbot.css`, prefixed `--nc-` so they can never collide with the host page.

```css
:root {
  /* Brand */
  --nc-primary:        #53CED1;  /* bright teal  */
  --nc-secondary:      #0D6F82;  /* deep teal — widget chrome, user bubble */
  --nc-deep:           #083344;  /* cyan-950 — end of focus gradient */
  --nc-accent:         #EA580C;  /* orange — Book now ONLY */
  --nc-focus-surface:  linear-gradient(150deg, #53CED1 -10%, #0D6F82 45%, #083344 100%);

  /* Semantic (from tailwind.config.js) */
  --nc-green:  #53D195;
  --nc-yellow: #FFDE59;
  --nc-red:    #D15653;

  /* Neutrals */
  --nc-surface:        #FFFFFF;
  --nc-surface-sunken: #F1F6F7;  /* bot bubble, input well */
  --nc-border:         #E6EDEE;
  --nc-text:           #12333C;
  --nc-text-muted:     #5D7C85;
  --nc-text-subtle:    #7B939A;
  --nc-on-dark:        #FFFFFF;
  --nc-on-dark-muted:  rgba(255,255,255,.78);
  --nc-on-dark-line:   rgba(255,255,255,.14);

  /* Type */
  --nc-font-heading: "Poppins", system-ui, sans-serif;   /* 600/700 */
  --nc-font-body:    "Montserrat", system-ui, sans-serif;/* 400/500/600 */
  --nc-font-display: "Archivo Black", sans-serif;        /* slogans only */

  --nc-fs-name:    16px;  /* "Germán"          */
  --nc-fs-meta:    11.5px;/* header subline    */
  --nc-fs-body:    14px;  /* message text      */
  --nc-fs-chip:    13px;  /* prompts, actions  */
  --nc-fs-legal:   10.5px;/* AI disclaimer     */
  --nc-lh-body:    1.5;

  /* Radius */
  --nc-r-panel:  18px;
  --nc-r-card:   14px;
  --nc-r-bubble: 16px;   /* tail corner: 4px */
  --nc-r-input:  26px;   /* becomes 14px when the textarea grows past 1 line */
  --nc-r-ctrl:   8px;    /* header buttons */
  --nc-r-pill:   999px;

  /* Space (4pt) */
  --nc-s-1: 4px;  --nc-s-2: 8px;  --nc-s-3: 12px;
  --nc-s-4: 16px; --nc-s-5: 20px; --nc-s-6: 24px;

  /* Elevation */
  --nc-shadow-panel: 0 24px 60px -30px rgba(13,111,130,.55), 0 0 0 1px rgba(13,111,130,.08);
  --nc-shadow-card:  0 6px 18px -8px rgba(13,111,130,.35), 0 0 0 1px #E6EDEE;
  --nc-shadow-fab:   0 10px 26px -8px rgba(13,111,130,.6);

  /* Motion */
  --nc-dur-fast: 200ms;  /* hovers, chips        */
  --nc-dur:      300ms;  /* panel open, buttons  */
  --nc-dur-slow: 500ms;  /* language row, expand */
  --nc-ease:     cubic-bezier(.4,0,.2,1);

  /* Geometry */
  --nc-w-compact:      420px;  /* desktop default            */
  --nc-w-expanded-side: 640px; /* desktop right-side sheet   */
  --nc-h-header:   62px;
  --nc-h-input:    46px;
  --nc-z:          100040;  /* under the site's topmost modal (100050) */
}
@media (prefers-reduced-motion: reduce) { :root { --nc-dur-fast:0ms; --nc-dur:0ms; --nc-dur-slow:0ms; } }
```

**Colour rules**

| Use | Token |
|---|---|
| Panel chrome, user bubble, send button | `--nc-secondary` |
| Highlights, "Nest" in names, focus ring, dark-mode send | `--nc-primary` |
| Book now / Reserve — max **one** per view | `--nc-accent` |
| Bot bubble, input well | `--nc-surface-sunken` |
| Availability yes / no | `--nc-green` / `--nc-red` |

Never: a second orange element, a decorative gradient, pure black text, or a colour not listed above.

---

## 3. Type scale

| Role | Font / weight | Size | Notes |
|---|---|---|---|
| Assistant name | Poppins 600 | 16px | header only |
| Header subline | Montserrat 400 | 11.5px | `--nc-on-dark-muted` |
| Message text | Montserrat 400 | 14px / 1.5 | `text-wrap: pretty` |
| Card title | Poppins 600 | 15.5px | "Medano **Nest**" — second word `--nc-primary` |
| Card meta | Montserrat 400 | 12.5px | `--nc-text-muted` |
| Price | Poppins 600 | 15px | inline with 12px "from … /night" |
| Chip / quick action | Montserrat 500 | 13px | |
| CTA label | Poppins 600 | 12.5px | uppercase, `letter-spacing:.04em` |
| Slogan | Archivo Black | 19–21px | one per panel, welcome only |
| Disclaimer | Montserrat 400 | 10.5px | `--nc-text-subtle` |

Minimum readable size in the widget is **10.5px** and only for the disclaimer; nothing else below 11px.

---

## 4. Components

### 4.1 Launcher (FAB)
- 56px circle, `--nc-secondary` (or white puck + 2px `--nc-primary` ring, direction 1D), white bird logo 32px, `--nc-shadow-fab`.
- Hover `scale(1.05)`, `--nc-dur`. No rotation.
- **Unread dot:** 18px pill, `--nc-accent`, 2px page-coloured border, top-right, count only if > 0. Clears on open, persists in `sessionStorage`.
- **Teaser bubble:** max 250px, `--nc-r-bubble` with 4px bottom-right tail, white, `--nc-shadow-card`, one short sentence + ✕.
  Appears once per session after 8s idle, **auto-dismisses after 6s**, never again after a manual dismiss (`localStorage`).

### 4.2 Panel — three sizes
| Viewport | Behaviour |
|---|---|
| < 640px (mobile) | Full-screen sheet, radius 0, `100dvh`, safe-area bottom padding |
| 640–1023px (tablet) | Full-screen sheet, same as mobile |
| ≥ 1024px (desktop) | **Compact** `--nc-w-compact` floating panel → **expanded** `--nc-w-expanded-side` right-side sheet, full height minus 24px margins |

- Compact → expanded: width + height animate over `--nc-dur-slow`; the side sheet docks to the right edge, `--nc-r-panel` on the left corners only.
- Triggers: the `⤢` control, **or automatically after the 3rd assistant message** (once per session; never auto-expand again if the visitor has shrunk it manually — persist `nc.userShrank`).
- Always reversible: `⤡` shrinks, `Hide ⌄` minimises, `Esc` hides. No state is destroyed by resizing.
- At `--nc-w-expanded-side` the hostel carousel shows 3 cards and the Nest Pass block sits beside the getting-here row.
- Open: `opacity 0→1` + `scale(.96→1)` from `transform-origin: bottom right`, `--nc-dur`. Anchor 24px from the right, 22px above the launcher.

### 4.3 Header (≤ 62px)
Left: 38px avatar → name (Poppins 600) + `AI ASSISTANT` badge → 11.5px subline.
Right, in this order: language `🇬🇧 EN` → expand `⤢` → **`Hide ⌄`** (a labelled control, not a bare `−`).
Controls: 30px tall, `--nc-r-ctrl`, `rgba(255,255,255,.12)`; hover `.2` + `scale(1.05)`. Mobile: `✕ Close`, 44px.

### 4.4 Message bubbles
- Bot: `--nc-surface-sunken`, `16px 16px 16px 4px`, max-width 82%, 30px avatar aligned to the bubble's bottom edge, 9px gap.
- User: `--nc-secondary`, white text, `16px 16px 4px 16px`, right aligned, no avatar.
- Consecutive bot messages: avatar on the first only, 8px gap between.
- Typing: three 7px `--nc-secondary` dots, `dotPulse 1.8s` staggered 0.2/0.3/0.4s.
- Streaming text: keep the existing per-character typer at 5–30ms; skip it entirely under `prefers-reduced-motion`.

### 4.5 Suggested prompts
Welcome state only, indented to the bubble text (39px). Label `TRY ASKING` (10.5px, `.08em`, `--nc-text-subtle`).
Pills: 13px Montserrat 500, `--nc-secondary` text, 1.5px `rgba(83,206,209,.55)` border, white fill, `--nc-r-pill`, 9px/14px padding.
Max 4, one line each, phrased as the visitor would type. Hover: fill `--nc-surface-sunken` + `scale(1.02)`.
Grid variant (2×2 cards, title + 11px hint) for direction 1D.

### 4.6 Hostel card
`--nc-r-card`, `--nc-shadow-card`, photo 120px `object-fit:cover` (78px in the two-up grid).
Badge stack top-left: 10px Poppins 600, white 92% pill — `Nest Pass`, `Loooong Stay`, `New`.
Body: title (`Name` + teal `Nest`) with price right-aligned → 12.5px location line → actions.
Actions: `Book now` (`--nc-accent`, flex:1, 38px, uppercase) + `Details` (outline teal). Never two filled buttons.

### 4.6b Hostel carousel
14 hostels never stack. Horizontal scroller inside the bot message column:
- Track: `display:flex; gap:10px; overflow-x:auto; scroll-snap-type:x mandatory; scrollbar-width:none`; each card `scroll-snap-align:start`.
- Card width 190px compact / 200px in the side sheet; the next card peeks ~30px behind a 44px white fade on the right edge.
- Next/prev: 30px white circles, `--nc-shadow-card`, vertically centred on the photo; hidden at the ends. Dots below: active 16×5px `--nc-secondary`, inactive 5×5px `#CBD9DC`.
- Card body is the §4.6 card, condensed: 88px photo, 13.5px title, 11px location, price, full-width `Book now`. No `Details` button in carousel mode — the whole card is the link.
- Keyboard: `←/→` move focus between cards; the track is `role="group" aria-roledescription="carousel"`; trackpad/touch swipe works natively (no JS drag).
- Max 8 cards per answer, then a final `See all 14 hostels →` card.

### 4.7 Nest Pass block
Full-width `--nc-r-card` on `--nc-focus-surface` (light panels) or a translucent well (dark panels).
Poppins 600 title ≤ 4 words, 12.5px body ≤ 2 lines, white ghost button `See Nest Pass →`. Max one per conversation.

### 4.8 Quick actions / contact handoff
**Keep today's treatment** (option 1A): wrapping pills, 12.5px Montserrat 500, fill `#E3F4F5`, text `--nc-secondary`, `--nc-r-pill`, 7px/12px padding, no border. Hover: `scale(1.05)` + fill `--nc-primary-20`.
Contact pills carry the real value (`Call +34 822 090 344`, `WhatsApp`, `Email arena@…`) and map to `tel:` / `wa.me` / `mailto:`.
Standard trio after a hostel answer: `Getting here` · `WhatsApp us` · `Open map`.
Backend contract: `{ "actions": [ { "label": "...", "type": "url|tel|whatsapp|mail|prompt", "value": "..." } ] }` — the widget styles them, never the model.

### 4.9 Getting-here row
`--nc-r-card`, 1px border, 54px island-map thumb + Poppins 600 title + 11.5px route line + `Open map →`.

### 4.10 Composer
Well: `--nc-surface-sunken`, `--nc-r-input`, 46px, 16px left padding; textarea grows to 180px then the radius drops to 14px (existing behaviour — keep).
Send: 34px circle, `--nc-secondary` when valid, `--nc-border` + `--nc-text-subtle` when empty, hover `--nc-primary`.
Focus: `outline:2px solid var(--nc-secondary); outline-offset:2px` on the well — never remove focus rings.
Disclaimer line centred under the well, `--nc-fs-legal`.

### 4.11 Language
**Unchanged from today** — the flag circle stays in the footer, left of the composer, and expands the horizontal flag row on click (35px circles, existing `.language-menu-open` transition).
Flags are always `<img>`, never emoji glyphs. One fix only: while the row is open the composer shrinks to ~150px, so collapse the row on the first keystroke or after 4s of no choice.
Revisit a header language menu only if the row proves to be a problem in analytics.

### 4.12 States
| State | Treatment |
|---|---|
| Boot | Skeleton bubble, no spinner. Keep the circular logo animation only on first ever open, capped at 1.2s. |
| Thinking | Dot indicator in a bot bubble. |
| Empty result | Bot bubble + `Talk to a human` + `WhatsApp` pills. |
| Error / offline | `--nc-red` 1px border on a `--nc-surface-sunken` bubble, plain-language line, `Retry` outline button. |
| Rate limited | Same, with a countdown in the disclaimer slot. |

---

## 5. Motion

| What | Duration | Easing |
|---|---|---|
| Panel open/close | `--nc-dur` | `--nc-ease` |
| Compact ↔ expanded | `--nc-dur-slow` | `--nc-ease` |
| Hover / chip press | `--nc-dur-fast` | `--nc-ease` |
| Message enter | 240ms, `translateY(6px)` + fade | `--nc-ease` |
| Teaser in / out | 300ms fade + 6px rise; out after 6s | `--nc-ease` |

Hover discipline (brand rule): every interactive element gets `scale(1.05)`, micro controls `scale(1.10)`. No spring, no rotate, no bounce.

---

## 6. Accessibility

- Panel: `role="dialog" aria-label="Germán, Nests Hostels AI assistant"`, focus trapped while open, `Esc` closes and returns focus to the launcher.
- Message list: `aria-live="polite"`, one region, additions only. Don't announce each streamed character — announce the finished message.
- Every icon control has a visible label or `aria-label`; the minimise control reads "Hide chat".
- Contrast: white on `--nc-secondary` = 5.2:1 ✅. White on `--nc-primary` fails — **never** white text on bright teal; use `--nc-secondary` text on `--nc-primary`.
- Keyboard: `Enter` sends, `Shift+Enter` newline, prompts and pills are real `<button>`s in tab order.
- Respect `prefers-reduced-motion` (see tokens) and `prefers-contrast: more` (drop translucency to solid `--nc-secondary`).

---

## 7. Do / Don't

**Do** — one accent action per view · label the AI · shrink chrome when the conversation starts · return components for structured facts · keep photography real and overlaid at 50% black · use `•` as the list marker on dark surfaces.

**Don't** — white text on bright teal · a bare `−` as the only close affordance · flags in the footer · two orange buttons · emoji clusters · decorative SVG illustration · walls of prose where a card exists · a second font family.

---

## 8. Implementation notes (no libraries)

- Ship one `nest-chatbot.css` with the `--nc-*` block at the top; all component rules use tokens only.
- Scope everything under `.nc-widget` so host-page CSS can't leak in, and set `all: initial` on the root wrapper if the widget is embedded on third-party pages.
- Flags: keep **images**, not glyphs — Unicode regional-indicator emoji (🇬🇧) render as bare letter pairs on Windows/Chrome, which is most of the traffic. Replace the `flagsapi.com` dependency and its `40×57`-in-a-35px-circle hack with five local PNG/SVG flags (or one sprite) sized to the box, served from the theme.
- Font Awesome is loaded for four glyphs (`minus`, `paper-plane`, `archive`, `times`). Inline those four SVGs and drop the CDN stylesheet.
- Persist per session: `conversation_uuid`, locale, unread count, teaser-dismissed flag, scroll position.
- `z-index: var(--nc-z)` = 100040, i.e. above the navbar, below the site's topmost modal.

---

## 9. Approved copy (EN)

Use these strings verbatim; other locales follow later.

| Slot | String |
|---|---|
| Welcome line | Hi! I'm Germán, the Nests AI assistant. Your travel community in the Canaries & Ibiza — 14 hostels · 3 islands · 1 Nest Pass. |
| Prompt 1 | Which hostel fits me best? |
| Prompt 2 | How does the Nest Pass work? |
| Island question | Which island are you going to? |
| Island chips | Tenerife · Gran Canaria · Ibiza |
| Action trio | Getting here · WhatsApp us · Open map |
| Composer placeholder | Ask Germán anything… |
| Disclaimer | AI answers — double-check important |
| Teaser | Need a hand picking your Nest? |
| Nest Pass block | Staying 7+ nights? / The Nest Pass moves with you between Tenerife and Gran Canaria — up to 30% off. / See Nest Pass → |
| Hero (phase 3) | Your travel community in the Canaries & Ibiza / 14 hostels · 3 islands · 1 Nest Pass |

Voice rules: sentence case, one exclamation per paragraph max, `·` as separator, "Nest" / "Nest Pass" never translated, no enterprise words.
