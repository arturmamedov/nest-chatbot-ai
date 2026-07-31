# Task — widget 2.4.1: fix the collapsed promo card and rebuild the welcome state

You are working in `nest-chatbot-ai`, a drop-in guest chat widget for Nests Hostels. It is
**one classic-script IIFE (`nest-chatbot.js`) plus one stylesheet (`css/nest-chatbot.css`),
shipped exactly as written.** Read `CLAUDE.md` first — its four hard rules bind everything
below.

Branch: `phase-2-panel-redesign` (HEAD `e5079b3`, release 2.4.0). Work there.

**Non-negotiable:** no build step, no npm, no bundler, no `package.json`, **no test
framework** — adding any is a spec violation, not diligence. ES5 syntax only (`var`/`function`;
runtime APIs like `Intl`, `matchMedia`, `ResizeObserver` are fine). Never `innerHTML`. Every
selector nested under `#nest-chatbot`, every class `nc-`-prefixed, no new `!important`. Every
user-visible *chrome* string via `t()`/`tf()` in all five packs; *payload* strings reach the DOM
via `textContent` and are never translated. Comments explain **why**, in English, matching the
file's existing density and voice.

Verification is **Playwright MCP against `demo/index.html` served locally** — load tool schemas
via `ToolSearch`. Port 5501 may be held by VS Code Live Server; check with
`netstat -ano | findstr :5501` and use it if so (it serves the same workspace root), otherwise
serve with `python -m http.server 5501`. Clear `localStorage` and `sessionStorage` before every
run.

**Staging:** `docs/wsuite/` is a vendored read-only packet, currently modified on disk out of
band — **never stage it**. `plans/` is untracked. Stage explicit paths by name; never
`git add -A` or `git add .`. Trailer:
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## Problem 1 — the promo card collapses to a 26px sliver

### Root cause (established empirically; not in dispute)

`#nest-chatbot .nc-promo { overflow: hidden }` makes the card a **scroll container**. Per the
flexbox spec, a flex item that is a scroll container has an automatic minimum size of **zero**
instead of a content-based one. `.nc-body` is `display: flex; flex-direction: column;
flex: 1 1 auto; min-height: 0` with a definite height smaller than its content **by design** —
so negative free space is its normal state, and every child has the default `flex-shrink: 1`.
The text siblings survive only by accident of not being scroll containers. The promo is the one
item that can be crushed, and it is crushed to exactly its own `padding: 13px 14px` top and
bottom: a 26px strip with a 0px content box, which is why a sliver of the title shows and the
body and CTA do not.

Measured: `offsetHeight` **26** vs natural **114**, at both the 420px floating panel and the
670px expanded sheet.

### The fix — two parts, both required

**(a) Paired-fallback clip on `.nc-promo`.** Replace the single `overflow: hidden;` with:

```css
    overflow: hidden;
    overflow: clip;
```

`clip` clips at the same padding edge and honours `border-radius` identically, but a clip
container is **not** a scroll container, so the zero-minimum rule never applies. The paired
shape matches the file's own `100dvh` precedent. Extend the existing comment to explain the
mechanism — the next reader must not "tidy" it back to one line.

**(b) The structural guard.** Add immediately after the `#nest-chatbot .nc-body` rule:

```css
#nest-chatbot .nc-body > * {
    flex-shrink: 0;
}
```

`clip` cures this instance; the guard closes the class. `.nc-carousel` is one `overflow: hidden`
away from the identical collapse, and nothing in the transcript is shrink-protected by design.
It also makes the fix work on engines without `clip`.

> **Critical: `flex-shrink: 0` alone — never `flex: none` or `flex: 0 0 auto`.** The shorthand
> would reset `.nc-loader`'s `flex-grow: 1`, which is the only thing centring the intro progress
> ring. Verify the ring is still vertically centred.

**(c) Companion consistency.** Add `flex-shrink: 0` to `.nc-promo-image`, matching
`.nc-card-photo`. Say in the comment that this is consistency, not a defect fix — it is inert
today. Do not claim it in the changelog as a bug.

Commit this on its own so it stays independently revertable.

---

## Problem 2 — the welcome state: both blocks, and sooner

### What it does today

The greeting is inserted, typed character by character, and **only when typing finishes** does
its `done` callback run:

```js
typeText(text, intro.greeting, function () {
    if (removed || guestTurned) { return; }
    if (intro.actions) { renderActions(intro.actions, text); }
    else { showPrompts(wrap); }
});
```

Three things are wrong with that. The whole welcome depends on `done` firing identically across
two motion paths. Server init actions **replace** the widget's prompts instead of joining them.
And the block arrives ~1.7s later than it needs to, on top of a ~4.2s branded intro.

### Decisions already made — implement these, do not relitigate

- **Both blocks render.** The `if/else` becomes "render both". Its comment currently *asserts*
  the opposite invariant and must be rewritten, not left contradicting the code.
- **The island chips are server payload**, arriving as a `quick_replies` element on the init
  response — exactly what the vendored contract says that field is for. **Do not invent
  `islandQuestion` or island i18n keys.** Chip labels are payload: `textContent`, never `t()`,
  never repainted by `setLocale`.
- **The welcome renders when the greeting starts typing**, with a fade-in. The loader animation
  is untouched.

### The work

**Mock.** Add an `islandChips()` factory beside the existing `promoCard()` factory returning
`{ type: 'quick_replies', items: [{label:'Tenerife',message:'Tenerife'}, {label:'Gran Canaria',
message:'Gran Canaria'}, {label:'Ibiza',message:'Ibiza'}] }`. `Mock.init` returns
`actions: [islandChips()]` — rewrite its comment, which currently explains why `[]` makes the
pack block the fallback. Point `Mock.send`'s `hostel` branch at the same factory so the
regression keyword provably tests an identical payload. `contract_version` stays `'1.4.1'`.

**`renderQuickReplies(action, parent)`.** One signature change; `els.body.appendChild(row)`
becomes `(parent || els.body).appendChild(row)`. Document that `parent` is passed only by the
welcome, and that a mid-conversation row belongs to `.nc-body` where the welcome sweep
structurally cannot reach it. **Do not** thread a parent through `renderActions`/`renderAction`
— that switch is the file's documented extension seam and the whole regression gate runs
through it.

**`showWelcome(after)`** — new, replacing the old `showPrompts` entry point:

- Build one `div.nc-welcome` and insert it after the greeting wrap, as a child of `.nc-body`
  (**not** nested in the greeting bubble — `followsBotMessage()` reads
  `els.body.lastElementChild`, and nesting would cost the next reply its avatar).
- Partition `intro.actions`: every `quick_replies` element renders into the wrapper via
  `renderQuickReplies(action, welcome)`; everything else goes through
  `renderActions(rest, null)` into `.nc-body`, where it survives the first guest turn (a
  tenant's init promo must not vanish the moment the guest types; the contract makes only the
  chip row one-shot).
- Pass `null` as the `bubble` argument, **never the greeting's `.nc-text`** — an init
  `async_result` handed the greeting node would retype the poll's answer *over the greeting*.
  With `null`, `pollResult` opens a new bubble.
- Then call `showPrompts(welcome)` to append the pack block.
- Store one handle: `els.welcome`. Rename `els.prompts` → `els.welcome` (it no longer points at
  `.nc-prompts`); keep `els.promptsLabel` and `els.promptButtons`, which `setLocale`
  dereferences.
- **Order:** server chips first, pack block second. Putting chips *under* a "TRY ASKING" label
  would assert that "Tenerife" is a thing to try asking. This is a judgement call and one line
  to flip — say so in the commit message.
- The wrapper carries **no** `padding-left`; `.nc-prompts` and `.nc-chip-row` each already state
  the 41px indent, so a chip row renders identically inside the welcome and in the transcript.

**`removeWelcome()`** — replacing `removePrompts()`, called from `sendGuestText`. Removes the
one wrapper, so both blocks go together, and keeps the existing focus rescue
(`contains(document.activeElement)` → `els.input.focus()`) which now covers the chips too.
Before this change a welcome chip row had **no handle at all** and would sit permanently above
the transcript, contrary to the contract's one-shot rule.

**`introMaybeFinish`** — inside the existing `requestAnimationFrame`, after
`wrap.classList.add('nc-visible')`, call `showWelcome(wrap)` guarded by `!removed &&
!guestTurned`, **then** `typeText(text, intro.greeting)`. Comment why: it removes ~1.7s of dead
wait without touching the loader, shows the guest their options while they read, and takes the
welcome off a callback that had to fire identically on two motion paths. Note the precedent —
`sendMessage` has always rendered a reply's `actions[]` under a bubble that is still typing.

**`typeText`** — after the above, its `done` parameter has **zero** callers. Drop the parameter
and both `if (done) { done(); }` branches, and delete the header-comment sentences describing
it. (Keeping it is acceptable; leaving the stale comment claiming "the welcome block hangs off
it" is not.)

**`startConversation`** — behaviour unchanged, but its `intro.actions` comment is now false and
must be rewritten. Note in your report that the old truthiness bug (a non-empty `actions[]` of
unrenderable types silently producing an empty welcome) is **no longer reachable** — nothing
branches on `intro.actions` any more — so no code change is warranted for it.

**CSS** — add a `.nc-welcome` rule near `.nc-chip-row`: `display: flex; flex-direction: column;
gap: 12px;` plus an **animation** (not a transition — it is inserted and animated in the same
frame, and an animation needs no style flush), reusing the existing `nc-msg-in` keyframe with a
short delay and `both` fill so it does not read as arriving before the greeting it belongs to.
Add `#nest-chatbot .nc-welcome` to the existing reduced-motion `animation: none` group.

---

## Problem 3 — auto-expand: DOCUMENTATION ONLY

**Do not change any behaviour.** `expandPanel`, `shrinkPanel`, `maybeAutoExpand`,
`resyncCarousels`, `FLAG_USER_SHRANK`, `FLAG_AUTO_EXPANDED`, the `.nc-expand` click wiring, and
every rule inside `@media (min-width: 1024px)` are **untouched**. The owner was explicit.

It is working as specified. `shrinkPanel(true)` writes `nest-chatbot:user-shrank` to
`localStorage`; nothing ever clears it; `maybeAutoExpand()` reads it as a permanent opt-out. ⤢/⤡
is a single toggle, so expanding the sheet to look at it and collapsing it again disables
auto-expand in that browser for good. The owner's machine has it set from two days of testing.

Add a short table to **`CLAUDE.md` → "Local development"**, after the fixtures table: the two
keys (`nest-chatbot:auto-expanded` in `sessionStorage`, `nest-chatbot:user-shrank` in
`localStorage`), what sets each, what clears each (**nothing, ever**, for the second), why it is
surprising rather than wrong, and the console one-liner:

```js
localStorage.removeItem('nest-chatbot:user-shrank'); sessionStorage.removeItem('nest-chatbot:auto-expanded');
```

---

## Bookkeeping

- **`VERSION` → `'2.4.1'`.** Per the project's own rule, little changes are a patch even when
  they touch behaviour; no new config attribute, no new i18n key, no new element type, no
  contract sync. `BUILT_AGAINST` stays `'1.4.1'`.
- **`CHANGELOG.md`** — a 2.4.1 entry in house style covering: the promo root cause (mechanism,
  not symptom) and both parts of the fix including the `flex`-shorthand trap; the welcome
  rendering both blocks, sooner, in one wrapper removed together with one focus rescue; the mock
  carrying the island chips; the known gap that the chips render with no question above them;
  and the CLAUDE.md flags note. State plainly that no expand/shrink behaviour changed.
- **`docs/proposals/response-contract-phase2-elements.md`** — add an open point: **a
  `quick_replies` row cannot say what it is asking.** The element carries only `items[]`, the
  init envelope carries only `greeting`, and there is no text element type — so a server sending
  island chips at init has no way to send "Which island are you going to?" with them. Request an
  optional element-level `heading` (server-localized, `textContent`); note `promo_card` already
  carries that kind of string. Amend the existing chip open point: the *welcome* row is one-shot
  as of 2.4.1, mid-transcript rows still are not.

---

## Known trade-offs — record these, do not smooth them over

1. **On a real 1.5.0 server, "render both" shows two try-asking blocks.** The contract says init
   `quick_replies` *is* the try-asking row, so a site that configures `chatbot.quick_prompts`
   gets its prompts plus the widget's two hardcoded pills. Harmless today (no site is
   configured); the durable fix is the `heading` field being requested upstream. **The demo will
   not reveal this** — its chips are island names, not prompts.
2. **Three unlabelled chips.** The demo will read: greeting → bare `Tenerife` / `Gran Canaria` /
   `Ibiza` → `TRY ASKING` + two pills, with nothing saying what the chips answer. The direct,
   intended cost of server-driven-with-no-text-element.
3. **Two chip-row lifetimes, one visual component.** A `.nc-chip-row` in the welcome vanishes on
   the first guest turn; an identical-looking one in the transcript does not.
4. **`setLocale` asymmetry becomes visible.** A language switch relabels the pack pills and
   leaves server chip labels in the init language. Correct — the widget must never translate
   payload — but newly visible.

---

## Verification — evidence, not assertion

Capture the **baseline first**, before editing: `.nc-promo` `offsetHeight` after sending `pass`
(expect **26**), and ms from launcher click to the welcome appearing (expect **~5900**).

Then prove each fix with actual returned values pasted into your report:

1. **Promo** — after `pass`: `offsetHeight` ≈ **114**, `offsetHeight === scrollHeight`,
   computed `overflow: "clip"`, `flexShrink: "0"`, and the CTA's rect inside the card's. Repeat
   at the 670px sheet and at 390×844.
2. **The guard did not break the loader** — computed `flexGrow` on `.nc-loader` is still `"1"`,
   and a screenshot in the first 2s of a fresh open shows the ring still vertically centred.
   This is the single most important negative check.
3. **Welcome timing** — a `MutationObserver` from the launcher click to `.nc-welcome` appearing:
   report both `msToWelcome` (expect ≈ 4200) **and** the greeting's character count at that
   moment (expect single digits). The second number is the actual proof; a lower time alone
   could just mean a faster typer.
4. **Structure** — `.nc-welcome`'s parent is `.nc-body`; children are the chip row then the
   prompts; three island chips; two pack pills; chip indent `41px`; `flexShrink: "0"`.
5. **Removal, and the row that must NOT be removed** — send any message: welcome gone. Then a
   fresh reload, send `hostel` to get a mid-transcript chip row, send another message, and
   assert that row is **still there** while `.nc-welcome` is gone.
6. **Focus rescue** — Tab to a welcome chip, press Enter, assert `document.activeElement` is
   `TEXTAREA.nc-input`. `BODY` is a failure. Repeat for a pack pill.
7. **Reduced motion** — emulate it: `.nc-welcome` computed `animationName: "none"`, greeting at
   full length immediately, no `.nc-typing` node, welcome present. This is the path that used to
   depend on `done()`.
8. **One click proving both fixes** — fresh reload, click the `Tenerife` welcome chip: guest
   bubble reads "Tenerife", welcome is gone, and the reply carries a full-height promo card.
9. **Regression gate** — `book contact rooms link available hostel tenerife pass !unknown !xss
   !410 !429`, then `!403` last (it tears the widget down). `!xss` evidence: the reply's
   `textContent` holds the literal markup, no new `img` node exists, no `.nc-action` was created
   for the `javascript:` url, no dialog fired. Check `.nc-welcome` contains no `img` and no `a`.
10. **Scoping** — every new selector begins `#nest-chatbot `, no `!important` added, and the
    demo page's own `h2` / `textarea:focus` / `a` traps and `.hidden` / `.message` /
    `.chat-header` classes look identical with and without the widget.

Anything you could not exercise from the fixtures — the init `async_result` guard is the known
one — say so plainly rather than claiming it tested.

## Commits

Three, in order, so the promo fix stays independently revertable: (1) the CSS collapse fix,
guard and companion hardening; (2) the welcome restructure, mock and `.nc-welcome` CSS;
(3) `VERSION`, `CHANGELOG.md`, `CLAUDE.md`, the proposals doc. Ask before committing.
