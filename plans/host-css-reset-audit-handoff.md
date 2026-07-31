# Audit: host-page CSS resets reaching inside our embedded widget

> **What this file is.** A standalone prompt to paste into a Claude Code session in the
> **React/TypeScript booking widget** repository. It is written to be self-contained — it carries
> no assumptions from the `nest-chatbot-ai` repo it was authored in, and the receiving repo's own
> CLAUDE.md governs how the work is done there.
>
> Written 2026-07-28, from the investigation behind `nest-chatbot` 2.2.0 (commit `99f997d`).
> Nothing below this line refers to this repo; copy from the heading onward.

---

## Why you're getting this

A sibling project — a vanilla-JS chat widget embedded on the same company's WordPress + Tailwind
site — shipped a defect to production that was **completely invisible in local development**.
It's a class of bug, not a one-off. This repo is a React/TypeScript booking widget that also gets
embedded into host pages we don't control, so it's exposed to the same thing, and probably worse:
a booking widget renders far more form controls than a chat widget does.

Nothing about the other repo's code matters here. What transfers is the mechanism, the audit
method, and the fix principle. Follow this repo's own CLAUDE.md conventions — this is a request
for an audit and a fix, not a prescription of implementation.

## The mechanism

The widget's CSS was rigorously scoped: every selector nested under a single `#widget-root` ID,
every class name prefixed. That scoping did its job — the widget never touched the host page.

**But scoping only protects the host from you. It does nothing to protect you from the host.**

Host CSS wins wherever your stylesheet is **silent**. A host theme's bare `h2` or `textarea` rule
matches *your* element directly, and a direct match always beats inheritance from an ancestor, no
matter how specific that ancestor selector is. Setting `font-family` on `#widget-root` does not
protect a `<textarea>` inside it from a host rule that names `textarea`.

This is **not** a specificity failure. `#widget-root .composer-input` is specificity (1,1,0) and
beats `textarea:focus` (0,1,1) on every property it declares. The bug is that it declared none of
the properties in question. It's a *completeness* failure, and the cure is to **declare**, never
`!important` and never more specificity.

## What we actually found

### 1. A double focus ring on the composer

The widget drew its own focus ring via `outline` on the input's wrapper, and explicitly set
`outline: none` on the input itself — which felt airtight. In production the user saw **two
concentric rings**: the widget's teal one, and a blue one inside it.

The culprit was `@tailwindcss/forms`:

```css
[type='text']:focus, [type='email']:focus, …, select:focus, textarea:focus {
  outline: 2px solid transparent;      /* deliberately invisible */
  outline-offset: 2px;
  --tw-ring-color: #2563eb;
  --tw-ring-shadow: 0 0 0 calc(1px + 0px) #2563eb;
  box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);
  border-color: #2563eb;
}
```

The plugin **paints its ring through `box-shadow`, not `outline`.** The widget's `outline: none`
was irrelevant, and because the two properties are independent, both rings rendered
simultaneously. The widget's stylesheet never mentioned `box-shadow` on that input, so nothing
contested it.

Measured on the focused element in production:

```
box-shadow:  rgb(255,255,255) 0 0 0 0, rgb(37,99,235) 0 0 0 1px, rgba(0,0,0,0) 0 0 0 0
--tw-ring-color: #2563eb
outline-offset: 2px          ← also leaked; harmless only because outline was none
```

### 2. Heading typography — same mechanism, different property

The panel title was an `<h2>`. The widget declared `font-size`, `font-weight` and `color` on it,
but not `font-family` or `line-height`. The host theme's `h2` rules landed **Poppins at a 72px
line-height**, inflating the panel header from 77px to **114px**. Nobody had noticed; it was
found only by auditing.

### 3. Red herring

Tailwind's preflight (`*, ::before, ::after { border: 0 solid #e5e7eb }`) *does* match elements
inside the widget and shows up prominently in DevTools. It's harmless at `0px` width, and it will
waste your time if you assume it's the cause.

## Why none of this appeared in development

Four independent reasons, all of which apply here too:

- The ring only exists on `:focus`. Idle inspection shows `box-shadow: none`.
- The offending CSS is the **host's**, present only on the production site — not in Storybook,
  not in the dev harness, not in any local fixture.
- It's a *paint* difference, not a layout difference, so nothing broke, errored or warned.
- The widget's own reset looked complete to a reader, because the properties it *did* declare
  were all correct.

## Why this repo is likely worse exposed

A chat widget renders one `<textarea>`. `@tailwindcss/forms` also restyles:

- **`select`** — injects a chevron `background-image`, `background-position: right .5rem center`,
  `background-size: 1.5em 1.5em`, and `padding-right: 2.5rem`. On a custom-styled select this
  produces a **double chevron** and mysterious right padding.
- **`[type=checkbox]` / `[type=radio]`** — `appearance: none`, `height/width: 1rem`,
  `color: #2563eb`, `border-color: #6b7280`, and on `:checked` a `background-image` checkmark
  plus `background-color: currentColor`. Custom checkboxes get a second checkmark or a wrong
  accent colour.
- **`[type=date]`, `[type=number]`, `[type=email]`, `[type=tel]`, `[multiple]`** — base
  `border-width: 1px`, `border-radius: 0`, `padding: .5rem .75rem`, `font-size: 1rem`,
  `line-height: 1.5rem`. Note **`border-radius: 0`**: a rounded input can be squared off by the
  host.

A booking widget plausibly renders every one of those — date pickers, guest steppers, room
selects, promo-code fields, consent checkboxes.

## Cascade layers — check this first, it can flip the whole answer

- **Tailwind v3** emits `@tailwind base` as plain **unlayered** CSS. Everything above applies.
- **Tailwind v4** wraps its output in real `@layer theme, base, components, utilities`. Unlayered
  CSS beats layered CSS **regardless of specificity**, so an unlayered widget stylesheet
  automatically wins against a v4 host — the problem largely evaporates.
- **But this cuts both ways.** If *our* widget's styles are themselves inside an `@layer` (likely
  if we use Tailwind v4, CSS Modules with layers, or a component library that layers), we lose to
  the host's *unlayered* styles even where we declare the property, and even at higher
  specificity.

Determine which situation applies before designing the fix — it changes the correct answer.

## How to audit — runnable, in this order

Run these in a real browser console on a page that reproduces the host environment. If we have no
such page, build one: a static HTML file that loads a real customer theme's stylesheet (or at
minimum `@tailwindcss/forms`) and then mounts the widget.

**1. Enumerate every host rule that can reach inside the widget.** Strip state pseudo-classes, or
`:focus` rules will never match and you'll get a clean bill of health for a broken widget.

```js
const root = document.querySelector('#widget-root');   // adjust
const strip = s => s.replace(/:(focus-within|focus-visible|focus|hover|active|checked|disabled|valid|invalid|placeholder-shown)\b/g, '')
                    .replace(/::(placeholder|before|after|selection|-webkit-[\w-]+)/g, '');
const hits = [];
Array.prototype.forEach.call(document.styleSheets, sh => {
  const name = sh.href ? sh.href.split('/').pop() : 'inline';
  if (/our-widget/.test(name)) return;                 // exclude our own sheet
  let rules; try { rules = sh.cssRules; } catch (e) { return; }   // cross-origin
  const walk = list => Array.prototype.forEach.call(list || [], r => {
    if (r.selectorText) {
      const sel = strip(r.selectorText);
      if (sel.trim() && !/^\s*\*/.test(r.selectorText)) {
        let m = null; try { m = root.querySelector(sel); } catch (e) { return; }
        if (m) hits.push({ sheet: name, sel: r.selectorText.slice(0,110),
                           on: m.className || m.tagName, css: r.style.cssText.slice(0,240) });
      }
    }
    if (r.cssRules && r.cssRules.length) walk(r.cssRules);
  });
  walk(rules);
});
console.table(hits);
```

**2. Read computed styles *while focused*.** This is the step that catches the ring. Reading an
unfocused input reports `box-shadow: none` and you'll conclude, wrongly, that nothing is leaking.

```js
const el = root.querySelector('textarea, input');
el.focus();
console.log(getComputedStyle(el).boxShadow, getComputedStyle(el).outlineOffset, getComputedStyle(el).borderColor);
el.blur();
```

**3. Probe elements that aren't rendered yet.** Availability results, error states, confirmation
screens — create throwaway nodes carrying the same classes, measure, remove.

**4. The differential snapshot — the highest-value technique.** Requires no baseline file and no
git stash. Snapshot computed styles, disable the host's stylesheet, snapshot again. **Any
difference is a leak, by definition.**

```js
const PROPS = ['font-family','font-size','line-height','letter-spacing','color','background-color',
               'box-shadow','outline-offset','border-width','border-color','border-radius',
               'padding','text-decoration-line','appearance','background-image'];
const snap = () => [...root.querySelectorAll('*')].map(e =>
  PROPS.map(p => getComputedStyle(e).getPropertyValue(p)).join('|'));

const hostSheets = Array.prototype.filter.call(document.styleSheets, s => !/our-widget/.test(s.href || ''));
const before = snap();
hostSheets.forEach(s => s.disabled = true);
const clean = snap();
hostSheets.forEach(s => s.disabled = false);

const leaks = [...root.querySelectorAll('*')]
  .map((e, i) => ({ e, i })).filter(({ i }) => before[i] !== clean[i]);
console.log(leaks.length ? leaks : 'no leaks');
```

Run step 4 for **each interactive state** — idle, `:focus`, `:checked`, `:disabled`, open
dropdown, invalid field — not just the default render.

## Gotchas that produce a false "all clean"

I hit three of these during the original investigation; each one silently reported success:

- **`for…of` over a `CSSRuleList` iterates nothing** in some engines, without throwing. Use
  `Array.prototype.forEach.call`.
- **A `CSSStyleRule` exposes a truthy but empty `.cssRules`** (CSS nesting support). If you write
  `if (r.cssRules) return walk(r.cssRules)` before checking `selectorText`, you recurse past
  every style rule and report "0 rules checked, all clean". **Test `selectorText` first.**
- **Cross-origin stylesheets throw `SecurityError` on `.cssRules`.** If the widget's CSS is
  served from a CDN on another origin, you cannot enumerate it from the host page — run
  rule-level audits same-origin, and use computed styles (which always work) for cross-origin
  verification.
- **Transitions defeat synchronous reads.** If a property is under `transition`, reading
  `getComputedStyle` right after changing it returns the *pre-change* value. Wait past the
  transition duration before asserting.

## The fix principle

**Declare, don't shout.** For every tag the widget actually renders, declare every property a
framework reset is known to set. Our stylesheet already outranks the host's on specificity; it
just has to *state* the properties.

- **No `!important`.** It doesn't address the cause and it makes the widget unthemeable by
  legitimate host overrides.
- **No specificity escalation.** Already sufficient.
- Enumerate the tags from what the components genuinely render — not a speculative list. Include
  at minimum every form control plus `h1`–`h6`, `a`, `button`, `img`, `svg`, `p`, `ul`/`ol`/`li`,
  `table`.
- Property set worth declaring on form controls: `font-family`, `font-size`, `line-height`,
  `letter-spacing`, `color`, `background-color`, `background-image`, `border-*`, `border-radius`,
  `padding`, `box-shadow`, `outline-offset`, `appearance`.
- Prefer values equal to what the widget already computes on a clean page, so the change is
  provably a no-op locally and only alters behaviour on hostile hosts.

**Also consider shadow DOM.** A React widget can mount into a shadow root, which solves this
class of bug wholesale rather than property by property. It has real costs — portals, focus
management, third-party component libraries that inject styles into `document.head`, and any
`position: fixed` overlay behaviour — so evaluate rather than assume. If shadow DOM is viable
here, say so explicitly; it may be a better answer than a hand-maintained reset list.

**Audit the reverse direction too.** If this widget ships its own Tailwind build that includes
preflight, that preflight is **global and unscoped**, and it will trample the host page — the
exact mirror-image bug, and a more serious one, since it damages a customer's site rather than
ours.

## What to report back

1. **A table of every confirmed leak**: element, property, host rule responsible, current vs
   intended value, and visual consequence. Distinguish confirmed (measured) from suspected
   (reasoned).
2. **Whether cascade layers change the analysis** here, and what Tailwind version the widget and
   the target hosts are on.
3. **A recommendation on shadow DOM vs. a declared reset**, with the reasoning.
4. **The fix**, following this repo's conventions.
5. **A standing regression probe** — add the hostile rules (`textarea:focus` with a `box-shadow`
   ring, a bare `h2` with a distinctive `font-family` and a large `line-height`, a `select` and a
   `[type=checkbox]` rule) to the dev harness or a Storybook decorator, permanently, with a
   comment explaining that they are deliberate. The original bug existed because no local
   environment ever contained hostile CSS. Ideally back it with an automated check that fails if
   a differential snapshot shows any leak.

Do not assume any specific leak listed above exists in this codebase — verify each one against
the actual components before acting on it.
