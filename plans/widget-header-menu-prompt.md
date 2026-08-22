> **Written 2026-08-22, against widget `2.10.0` / `BUILT_AGAINST` `1.7.0`.** Not implemented,
> not designed — this is the brief plus the findings a scoping pass turned up, so the session
> that picks it up does not rediscover them. Line numbers are deliberately omitted and will
> drift anyway; **function names and the section banners in `nest-chatbot.js` are the durable
> reference.** Two decisions are stated as given because the owner settled them; everything in
> "Open decisions" is genuinely open and is the first task.

# Task — a ⋯ menu in the panel header, carrying "Start a new chat"

## Where you are

`nest-chatbot-ai` is Nest Hostels' branded guest chat widget: one drop-in `<script>` tag that
gives a host website the Germán bubble, talking to the wSuite chatbot API. Vanilla JS, **no
build step, no dependencies** — `nest-chatbot.js` is a single classic-script IIFE shipped
exactly as written, styled by `css/nest-chatbot.css`, demoed at `demo/index.html`.

**Read `CLAUDE.md` first, all of it.** It is short and every rule in it has cost this repo
something. The ones this task walks straight into are named below, but read the file — do not
work from this summary.

## The ask

A three-dots button in the panel header, beside the existing ⤢ (expand) and × (close), opening
a small menu whose one item is **"Start a new chat"**.

```
   ┌─────────────────────────────────────────────┐
   │  ◉  Germán  [AI ASSISTANT]      ⋯   ⤢   ✕  │   ← the header
   │     Nests Hostels · replies in seconds      │
   ├─────────────────────────────────────────────┤
   │                       ┌───────────────────┐ │
   │                       │ Start a new chat  │ │   ← the menu
   │                       └───────────────────┘ │
```

## Why now: the idle window went from a day to a week

This is the whole reason the task exists, and it is worth understanding before designing
anything.

Until release 2.10.0 the widget expired its stored conversation after a hardcoded 24 hours. A
guest who abandoned a thread got a clean slate by morning, so "start over" was never something
they had to ask for. 2.10.0 adopted contract 1.7.0's `idle_hours`, and **the deployment's real
window is 168 hours — seven days**. A conversation now survives a week: it is replayed in full
on the next visit, and the server's side of it still holds the working memory `data-property`
seeded.

So **waiting no longer works**, and there is no guest-initiated way to start over. The only
"start a new chat" affordance in the widget today is the `nc-restart` button that
`endConversation()` paints when the **server** kills the conversation at its turn cap. That is
a dead-end recovery, not a control.

## The finding that makes this small

**`restartConversation()` already exists and is complete.** It is in the `flow` section, right
after `endConversation()`. It:

- emits `wchat:restart` **before** the wipe, while `transcript.length` still says how much the
  guest was carrying;
- `clearStore()`s and resets `conversationUuid`, `started`, `ended`, `guestTurned`;
- wipes `transcript` and `pollEntries`, bumps `chatEpoch` so any poll still backing off for the
  dead conversation is orphaned;
- clears `lastDayKey` (or the next real day separator gets swallowed), the anchor pad, and
  re-syncs the scroll cue;
- re-enables the composer, wipes `els.body` down to but not including `els.loader` (which is the
  greeting's insertion anchor);
- calls `startConversation()` and paints the new greeting itself — deliberately not a replay of
  the intro, whose latches stay spent.

**This task is exposure, not new logic.** Read that function before you write anything; most of
what looks like it needs building is already there and already commented.

---

## The four findings that will bite

### 1. The focus rule, for the sixth time

`CLAUDE.md` § Conventions: *anything that removes or hides a node checks `document.activeElement`
first*, and it records that this repo has rediscovered the same bug five times — the teaser, the
carousel arrows, the prompt pills, the language row, the scroll cue.

`restartConversation()` already carries a rescue:

```js
if (els.body.contains(document.activeElement)) { els.input.focus(); }
```

That is correct **for the caller it has today**: the `nc-restart` button lives in `els.body`, so
the test is true and focus moves to the composer before the wipe takes the button. A menu item
lives in the **header**, so `els.body.contains(...)` is **false**, the rescue does not fire, and
the guest who confirmed with the keyboard is left standing on a button inside a menu that is
about to be hidden. Their next Tab restarts at the top of the *customer's* page.

Worse than that: the language popover's own comment explains why a *hidden but present* node is
harder to recover from than a removed one — the guest is stranded on a control they cannot see.
A menu closed by a class swap does exactly that.

**So: close the menu and rescue focus explicitly, before the wipe.** Do not widen the existing
test into something vague like "anywhere in the panel" without thinking about what it now covers.

### 2. No new listener outside `#nest-chatbot`

`teardown()` states, and its comment insists on, **the only two listeners the widget ever
attaches outside `#nest-chatbot`**:

```js
document.removeEventListener('click', onDocumentClick);
document.removeEventListener('keydown', onDocumentKeydown);
```

That claim is load-bearing and is repeated in the `emit()` comment in the `events` section as
part of why DOM events cost a host nothing. **Do not add a third.** You do not need one:

- **`onDocumentClick`** already closes the language popover on any click outside it. The header
  menu joins the same function.
- **`onDocumentKeydown`** already handles Escape — and here it **needs an ordering change**.
  Today Escape closes the whole panel (`close('escape')` then `els.toggler.focus()`). With a
  menu open, Escape must close the **menu** first, return focus to the ⋯ button, and return —
  the panel stays open. That is what every menu does and what a guest will expect; it is also a
  change to existing behaviour, so state it in the changelog.

Note the companion detail in `wire()`: the language toggle's click handler calls
`e.stopPropagation()` so the document handler does not immediately re-close the thing the click
just opened. The ⋯ toggle needs the same.

### 3. `.nc-panel` is `overflow: hidden`

A dropdown under the header is **not** clipped by it — the menu falls *inside* the panel, over
the transcript — but it does need to sit above `.nc-body` in the stacking order.

**Do not reach for `overflow: visible` on `.nc-panel`.** That `overflow: hidden` is what keeps
the 15px rounded corners honest and stops the transcript bleeding past them. If the menu appears
clipped, the cause is a stacking or positioning mistake inside the panel, not the panel's
overflow.

### 4. An in-flight turn will land in the new conversation — verified, not hypothetical

This is the one place where "exposure, not new logic" does **not** hold, and it is the reason to
read `sendMessage()` before touching anything.

`restartConversation()` touches neither `busy` nor `sendQueue`. That is safe today because of
where it is called from: `endConversation()` clears `sendQueue` explicitly (its comment says
queued turns "must NOT survive into the next conversation through a restart") and by then the
capped reply has already returned, so `busy` is false. **From the menu, mid-conversation,
neither holds.**

Now trace a turn that is in flight when the guest confirms. `API.send`'s callback guards on
**`removed` only**:

```js
API.send(conversationUuid, text, function (status, body) {
    if (removed) { return; }
    busy = false;
    …
    transcript.push(entry);
```

So the old conversation's reply arrives, sets `busy = false`, pushes itself into the **new**
`transcript`, paints a bot bubble under the fresh greeting and persists it — an answer to a
question the new conversation has no record of, and which the server's side of it never saw.
Then `sendQueue` drains any further old turns into it behind that.

**The file already has the vocabulary for this and applies it one layer down.** `chatEpoch` is
bumped by `restartConversation()` precisely so a stale **poll** cannot do this, and `pollResult()`
re-checks `epoch !== chatEpoch` at three separate points. The turn callback simply never needed
the same guard, because no caller could create the situation. Now one can.

Handle it deliberately — the shape is not prescribed here, but "the same epoch guard the poll
already uses, plus clearing `sendQueue` the way `endConversation()` does" is the obvious
candidate and costs almost nothing.

---

## The pattern to copy, not invent

**The language popover is the reviewed precedent for all of this.** It is in the `flow` section
(`closeLanguageMenu()`, `toggleLanguageMenu()`), wired in `wire()`, and styled by the `.nc-lang`
block in `css/nest-chatbot.css`. Copy its shape:

- `aria-expanded` on the toggle button, flipped on both open and close;
- an open-state class on a container (`nc-lang-open` on `els.controls`), not inline styles;
- `e.stopPropagation()` on the toggle's click;
- delegated click handling on the options container, resolving the target with `closest()`;
- a close path that is safe to call when already closed.

Two things **not** to copy:

- **The auto-close timer.** The language row squeezes the composer to make room for five flags,
  so it has to be transient; the header menu takes room from nothing and should stay open until
  dismissed. Its timer comment is still worth reading — it is the clearest statement in the file
  of why hiding a focused node is worse than removing one.
- **The `max-width: 0` clipping.** That is a squeeze-in-place animation for a row inside a flex
  bar. A header dropdown is an ordinary absolutely-positioned panel.

---

## The rest of the surface this touches

| Where | What |
|---|---|
| `build()` (`dom` section) | `headerControls` appends `expandBtn` then `closeBtn` today. The ⋯ button and its menu go here. Order matters for tab order — decide where ⋯ sits relative to ⤢ and ✕ and say why. |
| the `els` map | New nodes get handles there. The file keeps that surface in one place deliberately, and the map's own comment says so. |
| `ICONS` (`dom` section) | One new inline SVG constant for the three dots, same 16×16 `class="nc-icon"` `aria-hidden="true"` shape as `x` / `expand` / `chevron`. **Never** FontAwesome, never a webfont, never a remote URL — rule 1. Reached through `svgNode()`, which must only ever see module-local constants (rule 2). |
| i18n (`STRINGS`) | `newChat` **already exists in all five locales** — reuse it verbatim. New keys needed: the ⋯ button's `aria-label`, and the confirm-state label. `en es it de fr`, all through `t()`, never a hardcoded string. |
| `setLocale()` | The menu item is a **live control**, not frozen transcript, so it joins the repaint block beside `els.restart` — along with the ⋯ `aria-label`. The comment there draws the line: what stays frozen is *payload*. |
| `css/nest-chatbot.css` | New classes, every selector under `#nest-chatbot`, every class `nc-`-prefixed, no exceptions (rule 4). |

### CSS specifics worth stating

- The toggle should match `.nc-expand` / `.nc-close`: 30×30, `border-radius: 8px`,
  `background: rgba(255, 255, 255, .22)`, white glyph.
- **The focus ring is white, not teal.** Those two buttons carry an explicit
  `:focus-visible { outline: 2px solid #fff }` because they sit on the light-teal header bar and
  the scoped reset zeroes the default. The ⋯ button needs the same, or its ring vanishes into
  the header.
- **`.nc-expand` is `display: none` below 1024px** — there is no room for a side sheet, so
  nothing to expand into. **The ⋯ button must NOT follow it.** A phone guest needs the new-chat
  route more than anyone: the panel is fullscreen and there is no other affordance anywhere.
- Menu item text goes through `el()`'s `textContent`. Never `innerHTML` (rule 2).
- Theme through the existing custom properties on `#nest-chatbot`; do not introduce a hardcoded
  colour where a token exists.

---

## Two decisions already settled — implement these, do not re-litigate

### A two-step confirm, inside the menu

From the header this is reachable **mid-conversation**, which the existing `nc-restart` button
never was. `restartConversation()` calls `clearStore()` and wipes the body: a guest eight turns
into a booking question who taps the wrong item loses the thread with **no undo and no warning**.

The confirm is a state change on the one menu item, not a dialog:

1. First activation swaps that item's label to the confirm string and leaves the menu open.
2. Second activation runs the restart.
3. **Any dismissal reverts it** — Escape, a click outside, closing and reopening the menu. A
   guest who backs out and comes back must not find a primed "Yes".

No modal, no overlay, no focus trap, no scrim, no new listener. It reuses a menu that already
handles its own dismissal, which is the entire reason this shape was chosen over a dialog.

**The `nc-restart` button in the ended state is untouched and stays one-tap.** The conversation
is already dead there; there is nothing to protect.

Watch the swap itself against the focus rule: the item is a live control whose accessible name
changes under the guest. Changing `textContent` on a focused button is safe (the node stays);
replacing the node is not.

### One item

The menu is the container that makes a second item a patch rather than a redesign. Today it
holds exactly one.

**The language switcher stays in the footer.** Its placement beside the composer was deliberate
— switching language is about what you are *about to type* — and moving it would mean rewriting
`.nc-lang` / `.nc-lang-options` / `closeLanguageMenu()` / the auto-close timer / the
`nc-lang-open` squeeze, changing the footer layout, and making a guest who knows where the flag
is hunt for it. Duplicating it into both places is worse: the `showWelcome()` comment argues at
length against putting one affordance on screen twice, and two toggles sharing one open/close
state is a new class of bug.

---

## Open decisions — settle these first, they are the actual first task

1. **Does `wchat:restart` gain a `source`?** The event fires today with `{turns}` only. Adding
   `source: 'menu' | 'ended'` is **additive**, so a patch by `CLAUDE.md`'s rule — renaming or
   removing an event or a payload field would be a MAJOR, but adding one is free, and the
   umbrella `wchat` dispatch means a host wired once sees it without editing their page. It
   answers a question the event cannot answer today: *are guests choosing to start over, or are
   they hitting the turn cap?* Those call for opposite responses. **Recommended: yes.** If you
   take it, `README.md` § Measuring it and
   `docs/proposals/visitor-measurement-and-events.md` both document the payload and both need
   the field.
2. **Is the ⋯ button visible before the guest has said anything?** A menu offering to reset a
   panel that shows only the greeting resets nothing. `guestTurned` already latches exactly this
   distinction and is already restored across a resume. **Recommended: always visible** — a
   control that appears partway through a conversation is its own confusion, and the confirm
   step already covers the case the hiding would protect. State whichever you choose and why.
3. **Where does ⋯ sit, and what is the tab order?** Left of ⤢, or between ⤢ and ✕? The header
   controls are a flex row and tab order follows DOM order. There is no established convention
   here to inherit — pick one and say what it optimises for.
4. **Does the menu open on hover, or click only?** Click only is almost certainly right (touch
   has no hover, and this widget is mostly used on phones), but state it rather than leaving it
   implicit.
5. **How the in-flight turn is guarded** — finding 4 above establishes *that* it must be, and
   that the poll already solves the same problem with `chatEpoch`. What is open is whether the
   turn callback takes that epoch guard, whether `restartConversation()` clears `sendQueue`, or
   both, and whether a turn already on the wire should also be reflected anywhere the guest can
   see. Decide it explicitly and comment it — this is the only correctness change in the task.

---

## Version

**Patch → `2.10.1`.**

`CLAUDE.md` § Conventions: *"Everything non-breaking is a patch — a bug fix, new UI behaviour, a
new `data-*` attribute, a new runtime-API method, a whole new stored surface."* This is new UI
behaviour and nothing else: no `data-*` attribute, no `window.NestChatbot` method, nothing a
host's `<script>` tag has to say, no stylesheet a host depends on. **Minor is reserved for a
contract sync** (a fresh `docs/wsuite/` packet and a `BUILT_AGAINST` move) and this is not one —
2.9.0 and 2.10.0 were both syncs; this is the first patch since 2.8.2.

Add a `CHANGELOG.md` entry in the existing style. If the Escape-ordering change lands, say so
explicitly — it is the one thing here a returning guest could notice as *different* rather than
*new*.

---

## Verification

Mock only. Nothing here touches the API, so no live run and no real conversations are needed.

**Assert the served source before trusting any result.** `python -m http.server` sends no
`Cache-Control`, so Chromium will happily serve your last edit's predecessor — `CLAUDE.md`
records this costing a full verification pass. Serve on a **fresh port** (a new origin has no
cache entries and no `localStorage`, which is usually what you wanted anyway) and check the
served text contains a string you just added.

Then:

- The menu opens on the ⋯ button, closes on a second tap, on a click outside, and on Escape.
- **Escape with the menu open closes the MENU, not the panel** — and focus lands back on ⋯.
- **The focus rule, tested explicitly and with the keyboard, not the mouse.** Tab to the menu
  item, confirm, restart — then read `document.activeElement`. It must be a visible node inside
  `#nest-chatbot`. `<body>` is a failure. So is a node inside the now-hidden menu.
- Restart mid-conversation, with several turns on screen: the transcript wipes, the store is
  cleared, a fresh greeting is typed, the composer is live, and the welcome block returns
  (`guestTurned` reset means first-contact affordances come back).
- Restart from the **ended** state (`!cap` in the demo composer) still works through the
  existing `nc-restart` button, one tap, unchanged.
- The confirm state reverts on every dismissal path. Open, tap once, press Escape, reopen — the
  item must read "Start a new chat" again.
- `setLocale()` repaints both the item label and the ⋯ `aria-label`. Switch language with the
  menu open and with it closed.
- Below 1024px: ⋯ is present and usable; ⤢ is still absent.
- **The demo page's own appearance is unchanged with the widget stylesheet on and off.**
  `demo/index.html` carries deliberate `.hidden` / `.message` / `.chat-header` traps plus a
  global `h2` / `textarea:focus` / `a` rule copied from a real customer's theme. A header change
  is exactly the kind that reaches for a bare element selector.
- `node --check nest-chatbot.js`.

There is an existing CDP-driven test harness in this session's scratchpad convention (`t1`…`t9`,
no dependencies, Node's built-in WebSocket) covering the eleven `wchat:*` event names and
payloads and the CSS-scoping check. **Re-run it**: a header change must disturb neither. If it
is gone, the checks above are the ones that matter and are worth rebuilding.
