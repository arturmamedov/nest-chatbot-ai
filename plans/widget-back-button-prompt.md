> **Written 2026-08-23, against widget `2.10.2` / `BUILT_AGAINST` `1.7.0`.** Not implemented,
> not designed — this is the brief plus the findings a scoping pass turned up, so the session
> that picks it up does not rediscover them. Line numbers are deliberately omitted and will
> drift anyway; **function names and the section banners in `nest-chatbot.js` are the durable
> reference.** Three decisions are stated as given because the owner settled them; everything in
> "Open decisions" is genuinely open and is the first task.

# Task — the device Back button closes the panel

## Where you are

`nest-chatbot-ai` is Nest Hostels' branded guest chat widget: one drop-in `<script>` tag that
gives a host website the Germán bubble, talking to the wSuite chatbot API. Vanilla JS, **no
build step, no dependencies** — `nest-chatbot.js` is a single classic-script IIFE shipped
exactly as written, styled by `css/nest-chatbot.css`, demoed at `demo/index.html`.

**Read `CLAUDE.md` first, all of it.** It is short and every rule in it has cost this repo
something. This task walks into **two** of them head-on — they are named below — but read the
file; do not work from this summary.

## The ask

Pressing the device Back button while the chat panel is open should **close the panel**, not
navigate away from the customer's website.

```
   guest on a hostel's booking page
   → taps the bubble, panel opens fullscreen
   → reads a reply, taps Back
   ✗ today:  leaves the customer's site entirely, mid-conversation
   ✓ wanted: the panel closes, the guest is back on the booking page they were reading
```

This is a phone problem above all — the panel is fullscreen below 1024px, so it *looks* like a
screen, and Back is what dismisses a screen. iOS Safari's edge-swipe gesture fires the same
event, so it comes along for free.

## Why this is not a five-line change

**Nothing in this widget has ever touched `history`, and neither does the reference widget.**
`grep -n "history\.\|popstate\|pushState" nest-chatbot.js docs/wsuite/chatbot.reference.js`
returns nothing. There is no in-repo precedent and no upstream one to copy — this is the first
time the widget reaches for browser navigation state, and that is exactly why the rules below
bite.

The mechanism itself is standard and small:

```js
open()      → history.pushState({ ncPanel: true }, '')   // no URL argument — see finding 2
popstate    → if (isOpen()) close('back')
close()     → if (our entry is on top) history.back()     // keep the stack balanced
```

Everything hard is in the four findings.

---

## The findings that will bite

### 1. It breaks `teardown()`'s "exactly two listeners" claim — and that claim is load-bearing

`teardown()` says, and its comment insists on:

```js
// The only two listeners the widget ever attaches outside #nest-chatbot —
// a destroyed widget must leave the document untouched.
document.removeEventListener('click', onDocumentClick);
document.removeEventListener('keydown', onDocumentKeydown);
```

**`popstate` fires on `window` and nowhere else.** It does not bubble to `document` in any
usable way, there is no delegation trick, and the widget currently attaches **zero** `window`
listeners — both existing ones are on `document`. So this is not merely "a third listener", it
is **the first `window` listener the widget has ever had**. Say that plainly in the code.

The claim is repeated in four live places and **every one has to move together**:

| Where | What it says |
|---|---|
| `nest-chatbot.js`, `teardown()` | the comment above |
| `nest-chatbot.js`, `events` section | "*teardown()'s claim that the widget attaches exactly two listeners outside #nest-chatbot stays true — dispatching attaches none*" |
| `CLAUDE.md` § the events seam | the same sentence, as one of the four rules the section states |
| `CLAUDE.md` § the transcript scrolls itself | "*There is deliberately **no** window resize listener (`teardown()` claims the widget attaches exactly two listeners outside `#nest-chatbot`, and that claim stays true)*" |

**The last one is not a number bump and you must not treat it as one.** The scroll cue's
justification for having no resize listener partly *rests* on "we do not add window listeners".
Once one exists, that argument is weaker and the comment becomes quietly dishonest. Rewrite it
to stand on its own reason — the stale-cue gap is an accepted cost, the same one the carousel
arrows have — rather than on a listener count that no longer supports it.

**Do not touch `CHANGELOG.md`'s historical entries.** Three of them assert "exactly two". They
were true when written; released changelog entries are immutable history.

### 2. `pushState` mutates the HOST page's session history — the rule this repo states most bluntly

`CLAUDE.md` § Conventions: *"Never touch `document.documentElement.lang`, the host's `<body>`,
or anything outside `#nest-chatbot`. The host page is not ours."*

Session history is about as far outside `#nest-chatbot` as it is possible to get. It is
**shared, global, mutable state that the host may already own**: a customer running Next.js,
Vue Router, Turbo or Barba.js pushes and pops entries and listens to `popstate` themselves. Our
entry sits in their stack.

This does not make the task wrong — it makes the escape hatch mandatory (settled below) and it
makes three implementation details non-negotiable:

- **Never pass a URL to `pushState`.** The signature is `pushState(state, unused, url)`; omit
  the third argument entirely and the address bar does not change. Changing the URL would show
  in the address bar, break hosts that route on it, and turn a dismissible panel into a
  navigable page. It is the difference between a small imposition and a serious one.
- **Never `replaceState`.** That destroys the host's entry rather than adding to it.
- **Identify our state by the panel, not by reading `history.state`.** A host's router is free
  to `replaceState` over our entry and wipe the `{ ncPanel: true }` marker. The popstate handler
  should branch on `isOpen()`, which is ours and cannot be clobbered. Keep the marker anyway —
  it is what finding 3 needs — but do not make correctness depend on it surviving.

### 3. Keeping the stack balanced is the whole problem, and `history.back()` is a loaded gun

If `open()` pushes and the guest closes with ✕, Escape or the launcher, our entry is still on
the stack. Leave it and the next Back press is silently swallowed — the guest presses Back,
nothing happens, they press again. Two opens leave two dead entries. So a manual close has to
pop its own entry with `history.back()`.

**The re-entrancy looks like it needs a flag and does not.** `history.back()` fires `popstate`
asynchronously, on a later task, so a synchronous "I am closing" flag set and cleared inside
`close()` is already gone by the time the handler runs. The ordering solves it for free instead:

- `close()` removes `nc-open` **synchronously**, then calls `history.back()`.
- The `popstate` that follows runs `if (isOpen())` → already false → no-op.

No flag, no double-close, no loop. Write the comment explaining *why* there is no flag, or the
next reader will add one.

**The genuine hazard is that our entry may not be on top.** If the host's router pushed entries
while our panel was open, `history.back()` walks **their** app backwards instead of popping us —
a widget navigating a customer's site is far worse than a stale entry. So guard it:

```js
// Only pop what is demonstrably ours. If the host's router has pushed over us,
// leave the entry: one dead history entry is a small cost, and navigating the
// customer's app backwards is not a cost we get to impose.
if (history.state && history.state.ncPanel) { history.back(); }
```

Same reasoning in `teardown()`: **remove the `popstate` listener, and do not call
`history.back()`.** A widget being destroyed must not navigate the page on its way out.

Also guard the push itself against double-firing — `open()` already early-returns on
`isOpen()`, so one flag (`pushedEntry`) tracking whether *we* have an entry outstanding is
enough, and it must be cleared in exactly the same places the entry is consumed.

### 4. Chrome skips history entries pushed without a user gesture — so `data-auto-open` may not work

Chrome's history-manipulation intervention marks entries created **without user activation** as
skippable, and Back walks straight past them. A panel opened by `data-auto-open` at boot, or by
a host calling `NestChatbot.open()` from a timer, pushes exactly such an entry — so Back may
leave the site anyway, which is the behaviour this task exists to remove.

There is no clean fix; the browser is deliberately defending against exactly the pattern we are
using. **Do not fight it.** Verify the behaviour, then state it as a known limitation in the
changelog and in `README.md`'s attribute row: Back-closes-the-panel is reliable for a panel the
guest opened themselves, best-effort otherwise. Silently shipping a feature that works for most
guests and not the auto-open ones is how this becomes a bug report nobody can reproduce.

---

## The surface this touches

| Where | What |
|---|---|
| `config` section | `backButton: data.backButton !== 'false'` — note the shape: **default on**, so it is `!== 'false'`, not `=== 'true'` like `autoOpen` and `debug`. That asymmetry is deliberate and deserves a comment, because every other boolean in `cfg` reads the other way. |
| `events` section | `CLOSE_SOURCES` gains `'back'`. Additive, so a patch — the same move `RESTART_SOURCES` made in 2.10.2. |
| `flow` — `open()` | push the entry, once, when the panel opens |
| `flow` — `close()` | pop our own entry if it is on top |
| `flow` — `teardown()` | remove the listener; do **not** navigate |
| `boot` — `wire()` | the `popstate` registration, beside the two `document` ones, with a comment saying why it cannot live on `document` |
| `README.md` | a `data-back-button` row in the config table; `'back'` in the `wchat:close` source enum; the version line; the auto-open caveat from finding 4 |
| `docs/proposals/visitor-measurement-and-events.md` | `'back'` in the `source` enums line under the events table |
| `demo/index.html` | worth exercising — the demo is the only place this gets driven by hand |
| `CLAUDE.md` | the two "exactly two" sites (finding 1), the config table, the version-numbering note |

**No CSS.** This task adds no rule to `css/nest-chatbot.css`.

---

## Three decisions already settled — implement these, do not re-litigate

### Every viewport, not just fullscreen widths

The counterargument was considered and rejected: on desktop the panel is a 420px floating card
with a ✕ right there, so swallowing Back is more surprising than helpful. It loses to two
things. Scoping it would need a `matchMedia` read in JS, and `CLAUDE.md` warns about exactly
that in `boot()` — *"a gate here would be a second source of truth, free to disagree with the
stylesheet"* — and unlike the expanded sheet, **behaviour cannot live in a media query**, so
there would be no stylesheet half to agree with. One rule, every width, no gate.

### `data-back-button`, defaulting to **on**

Guests get the expected behaviour with the host doing nothing; a host whose router fights us
sets `data-back-button="false"`. This is the same shape `data-fonts` used the last time the
widget touched something shared. A new `data-*` attribute is additive, so still a patch.

### Back closes the whole panel, never just the ⋯ menu

2.10.2 made Escape close the header menu first and leave the panel open. **Back deliberately
does not copy that**, and the reason is mechanical rather than aesthetic: closing the menu would
**consume the history entry that was backing the panel**, leaving the panel open with nothing
behind it — so the guest's *next* Back press leaves the customer's site. Correcting that needs a
re-push, and a widget pushing history entries to keep a one-item dropdown alive is not a trade
worth making. `close()` already takes the menu with it. State the divergence from Escape in the
changelog rather than leaving a reader to notice it.

---

## Open decisions — settle these first, they are the actual first task

1. **Does `wchat:close` gaining `'back'` need anything beyond the enum?** A host counting
   dismissals now has a fourth reason. Worth checking whether the proposal's "Answers / Cannot
   answer" column for `wchat:close` should say more — `'back'` is the only close source that
   also means "the guest was about to leave the page", which is a different signal from ✕.
2. **Should `NestChatbot.close()` pop the entry too?** It routes through `close()`, so it will
   by default. Confirm that is right for a host driving the widget programmatically, or whether
   an API-sourced close should leave the stack alone.
3. **What happens on a `403` teardown while the panel is open?** `teardown()` is reached from a
   live request, not from `close()`, so the panel is removed without `close()` ever running and
   our entry is orphaned. Finding 3 says do not navigate on teardown — confirm that is still
   right here, and that the orphan is acceptable.
4. **Does the demo page need a toggle?** Driving both states by hand is the only way to see the
   opt-out work, and the demo is the harness. A second `<script>` tag variant, a query
   parameter, or nothing at all.
5. **How the auto-open limitation (finding 4) is communicated** — a changelog note only, a
   README caveat, or a one-time `log()` when `data-auto-open` and `data-back-button` are both
   on. The last one costs nothing and is gated behind `data-debug` like every other log.

---

## Version

**Patch → `2.10.3`.**

`CLAUDE.md` § Conventions: *"Everything non-breaking is a patch — a bug fix, new UI behaviour, a
new `data-*` attribute, a new runtime-API method, a whole new stored surface."* This is new UI
behaviour plus one additive `data-*` attribute and one additive event enum value. **Minor stays
reserved for a contract sync** and this is not one; `BUILT_AGAINST` does not move from `1.7.0`
and `docs/wsuite/` is untouched.

`CLAUDE.md` currently reads *"The next is **2.10.3** unless it is a sync"* — move it to
**2.10.4** and add the one-line description of this release beside 2.10.1's and 2.10.2's.

---

## Verification

Mock only. Nothing here touches the API, so no live run is needed.

**Assert the served source before trusting any result.** `python -m http.server` sends no
`Cache-Control`, so Chromium will serve your last edit's predecessor — `CLAUDE.md` records this
costing a full verification pass. Serve on a **fresh port** and check the served text contains a
string you just added.

There is a CDP harness in this repo's session scratchpads (`cdp.mjs`, `t1-boot` … `t10-menu`,
no dependencies, Node's built-in `WebSocket`) covering the eleven `wchat:*` events, the CSS
scoping check and the ⋯ menu. **Re-run all of it** — this change must disturb none of it — and
add a `t11-back.mjs`. Two environment traps it already documents: headless Chrome resolves
`data-locale="auto"` to Italian, and its default window is below 1024px, so pin both.

The checks that matter:

- **The stack stays balanced.** Record `history.length`, then open/close the panel ten times
  through every route — ✕, Escape, the launcher, `NestChatbot.close()`, and Back itself. It must
  return to its starting value. This is the assertion that catches finding 3, and it is the one
  most likely to fail.
- **Back with the panel open closes it and does not navigate.** `location.href` unchanged,
  `wchat:close` fired with `source: 'back'`.
- **Back with the panel closed navigates normally** — the widget must not swallow a press that
  is not ours. Build real history first (`Page.navigate` twice), then Back.
- **The URL never changes.** Assert `location.href` before the push and after it. This is the
  cheapest guard against someone "helpfully" adding a `#chat` fragment later.
- **The focus rule.** Closing via Back runs `close()`, which already rescues focus to the
  launcher — confirm `document.activeElement` is not `<body>` after a Back-close.
- **`data-back-button="false"` pushes nothing.** `history.length` unchanged across an
  open/close, and Back navigates away with the panel open.
- **The ⋯ menu goes with the panel** on a Back-close, and the confirm state is reset — the
  settled decision above, and `close()` → `closeHeaderMenu()` should already give it for free.
- **`destroy()` with the panel open** removes the `popstate` listener and does not navigate.
  Then press Back and confirm the page navigates normally rather than hitting a dead handler.
- **The auto-open case (finding 4).** Set `data-auto-open="true"`, press Back, and **record what
  actually happens** in Chromium rather than what the spec implies. Whatever you observe is what
  the changelog says.
- `node --check nest-chatbot.js`.
