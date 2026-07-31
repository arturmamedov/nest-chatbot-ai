# Phase 1 — Launcher: avatar puck, quiet unread dot, self-dismissing teaser

You are working in the `nest-chatbot-ai` repo: a standalone HTML/CSS/JS chat widget for Nests Hostels
(`index.html`, `css/nest-chatbot.css` → compiled `css/output.css`, `javascript/nest-chatbot.js`, `javascript/modules/`).
Constraints: **plain JS and plain CSS only — no new libraries, no framework, no build step beyond the existing Tailwind CLI.**

Read first: `NEST_CHATBOT_DESIGN_SYSTEM.md` (§2 tokens, §4.1 launcher, §5 motion, §6 accessibility) and the design
reference `Germán Widget.dc.html` — option **2A** shows the three launcher states, option **1A** is the current widget.

Scope of this phase: **the closed state only.** Do not touch the panel, header, footer, language row or messages.

## 1. Tokens
Add the `--nc-*` custom property block from design system §2 at the top of `css/nest-chatbot.css`, including the
`prefers-reduced-motion` override. Replace the hard-coded `#0D6F82` / `#53CED1` / `#ececec` values in the launcher rules
with those tokens. Leave the rest of the file's hard-coded values alone for now.

## 2. Launcher visual
Replace the current 50px `#0D6F82` circle with:

- 60px circle, `background: var(--nc-surface)`, `border: 2px solid var(--nc-primary)`, `box-shadow: var(--nc-shadow-fab)`.
- Inside: `img/logotipo-nests-tenerife.png` (teal bird) at 34×34.
- Position: `right: 24px; bottom: 22px` (mobile: `right: 20px; bottom: 20px`).
- Hover: `transform: scale(1.05)`, `transition: transform var(--nc-dur) var(--nc-ease)`. **Remove the current
  `rotate(90deg)` on open** — the brand system forbids rotate entrances.
- `aria-label="Open Germán, the Nests AI assistant"`, `aria-expanded` kept in sync.
- Keep the existing two-`<span>` swap mechanism if it is convenient, but the open state must not rotate.

## 3. Unread dot
- 14px circle, `background: var(--nc-accent)`, `border: 2px solid var(--nc-surface)`, absolutely positioned at the
  top-right of the launcher. No number, no animation, no pulse.
- Shown when `sessionStorage.getItem('nc.opened') !== '1'`; removed the first time the panel opens.
- Hidden from assistive tech (`aria-hidden="true"`); the unread meaning is carried by text in the `aria-label`
  (e.g. `"Open Germán — 1 new message"`).

## 4. Teaser bubble
Markup: a sibling of the launcher, `<div id="chatbot-teaser" role="status">` containing a short line and a real
`<button aria-label="Dismiss">✕</button>`.

- Copy: **`Need a hand picking your Nest?`** (exact string; keep it in one place so locales can be added later).
- Style: `background: var(--nc-surface)`, `border-radius: 14px 14px 4px 14px`, padding `10px 12px`, `max-width: 250px`,
  `box-shadow: 0 10px 24px -12px rgba(13,111,130,.5), 0 0 0 1px var(--nc-border)`, 12.5px Montserrat, `var(--nc-text)`.
  Positioned above the launcher, right-aligned to it, 12px gap.
- Enter: fade + `translateY(6px) → 0` over 300ms `var(--nc-ease)`. Exit: the reverse.
- Timing rules (all in JS, no library):
  1. Show once per session, after **8s** with the panel closed and no prior open.
  2. **Auto-dismiss 6s** after it appears.
  3. `✕`, opening the panel, or any click elsewhere on the teaser dismisses it immediately.
  4. A manual dismiss writes `localStorage['nc.teaserDismissed'] = '1'` and it **never shows again** on that device.
  5. Never show it if `sessionStorage['nc.opened'] === '1'`.
  6. Skip the animation (show/hide instantly, or not at all) under `prefers-reduced-motion: reduce`.
- Clicking the teaser body opens the panel.

## 5. Mobile
Below 640px: same launcher at 56px, teaser max-width `calc(100vw - 88px)`, never overlapping the page's cookie banner
(the site shows one bottom-left) — keep the teaser right-aligned.

## 6. Definition of done
- No layout shift on the host page; the launcher and teaser are `position: fixed` under `z-index: var(--nc-z)`.
- Dot state survives a page reload within the session and clears permanently after the first open.
- Teaser respects all five timing rules; verify by reloading with `sessionStorage`/`localStorage` cleared.
- Keyboard: launcher and teaser ✕ are focusable, visible focus ring, `Enter`/`Space` activate.
- No console errors. Tailwind rebuild (`npm run …`) still succeeds.
- Screenshot the three states (idle+dot, teaser visible, after open) and compare against option **2A** of the mock.

Do not start Phase 2. Stop after this and report what changed, with the diff summary and the three screenshots.
