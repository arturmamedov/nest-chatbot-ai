# Widget 2.4.2 — returning-guest welcome, persisted panel size, contract-aligned init chips

## Context

Three things surfaced after 2.4.1 shipped, two of them defects the 2.4.1 verification actively
hid.

**1. The island chips never appear.** `startConversation()`
([nest-chatbot.js:2199-2207](nest-chatbot.js#L2199-L2207)) returns early whenever `readStore()`
finds a conversation uuid, so `API.init` is never called and `intro.actions` stays `null`. Every
2.4.1 browser check cleared `localStorage` first, which is exactly the condition that masks it.
This is pre-existing (2.4.0 had it) but it is a real product bug, not a demo annoyance: on a live
site any returning guest inside the 24h idle window silently loses the site's configured
`chatbot.quick_prompts` **and** its `show_at_init` promo card, while still getting the widget's
fallback pills — so the fallback is the only welcome a repeat visitor ever sees.

**2. The panel size is not remembered.** `.nc-expanded` is runtime-only. `nest-chatbot:user-shrank`
records a shrink to suppress auto-expand, but nothing records that the panel *is* expanded, so
every reload drops the guest back to the 420px floating card.

**3. Init `quick_replies` should replace the widget's pills, not join them.** The vendored packet
on disk has moved to **1.5.0** and states it directly: `quick_replies` is *"Emitted on the init
response from the site's `chatbot.quick_prompts` setting (the "try asking" chips) and by
deterministic clarification turns (e.g. island choice — D-043(f))"*. 2.4.1's "render both"
decision was taken against the 1.4.1 packet and now double-renders on a real server. Reverting to
server-replaces-ours is the contract-aligned behaviour.

**The question behind all this, answered.** No new element type is needed — reusing `quick_replies`
more than once in `actions[]` is correct and the widget handles each independently. What 1.5.0
cannot do is let a row say what it is asking: `quick_replies` carries only `items[{label,message}]`,
and the init envelope carries only `greeting`. On a *turn* the `reply` string supplies that line for
free (this is why the `hostel` fixture reads correctly); at init there is nowhere to put it. Per the
owner's decision, server rows render **bare** for now and the missing `heading` field stays an open
request upstream.

## Decisions taken

| Question | Decision |
|---|---|
| Returning guest loses welcome elements | Cache init `actions[]` alongside the uuid; replay on resume |
| Panel size persistence | New `localStorage` flag, restored on load (survives closing the tab) |
| Init chips vs. our pills | Server chips **replace** the widget's pack block; pills are the fallback only |
| Labels on server rows | **Bare** — no `heading` rendering, no borrowed `tryAsking` label |
| Demo init fixture | **Two** `quick_replies` rows: standard questions + islands, mirroring the intended server payload |

## Work

### 1. Cache init actions with the conversation uuid

`css` untouched. All in `nest-chatbot.js`, storage section
([nest-chatbot.js:258-277](nest-chatbot.js#L258-L277)).

- `writeStore(uuid, actions)` — persist `{uuid, ts, actions}`. One call site,
  [nest-chatbot.js:2226](nest-chatbot.js#L2226); pass `intro.actions`.
- `readStore()` — return the parsed **object** `{uuid, actions}` instead of a bare uuid string.
  Validate `actions` with `Array.isArray` and drop it if it is anything else; a malformed store must
  degrade to "no welcome elements", never throw.
- `startConversation()` resume branch — set `intro.actions` from the cached value the same way it
  already defaults `intro.greeting`.

Comment must state **why this is safe**: everything replayed goes back through the same renderers,
which already treat every payload string as untrusted (`textContent`, `safeHttpUrl`), so a tampered
store can only produce what a hostile server could already produce. It must also state the accepted
cost: welcome elements can be up to `IDLE_MS` (24h) stale, which is fine because they are site
settings, not conversation state.

### 2. Persist the panel size

- Add `FLAG_EXPANDED = 'nest-chatbot:expanded'` (localStorage) beside the existing size flags at
  [nest-chatbot.js:294-295](nest-chatbot.js#L294-L295).
- Add `clearFlag(storeName, key)` next to `readFlag`/`writeFlag`
  ([nest-chatbot.js:297-303](nest-chatbot.js#L297-L303)) — `removeItem`, wrapped in the same
  try/catch. This keeps `readFlag`'s existing `'1'` / absent semantics rather than inventing a
  `'0'` value.
- `expandPanel()` writes the flag; `shrinkPanel()` clears it — for **any** expand/shrink, so the
  flag records the panel's last state rather than who caused it. `shrinkPanel(byUser)` keeps
  writing `FLAG_USER_SHRANK` on top, unchanged.
- `boot()` ([nest-chatbot.js:2573](nest-chatbot.js#L2573)) restores by calling `expandPanel()` when
  the flag is set, after `wire()` and **before** the `cfg.autoOpen` check, so the panel is already
  the right size when it opens and there is no visible jump.

Restore is deliberately **not** gated on `matchMedia('(min-width: 1024px)')`: every expanded rule
lives inside that media query, so below 1024px the class simply stops matching. That is the same
mechanism the existing comment at
[css/nest-chatbot.css:1566-1572](css/nest-chatbot.css#L1566-L1572) relies on, and gating here would
be a second, disagreeing source of truth.

Note the welcome side effect worth recording: a guest who shrank once (so `user-shrank` suppresses
auto-expand forever) and later expanded by hand now gets their expanded panel back on reload. The
two flags answer different questions and both are still needed.

### 3. Server chips replace the pack block

In `showWelcome()` ([nest-chatbot.js:1929](nest-chatbot.js#L1929)): call `showPrompts(welcome)` only
when **no server chip row actually rendered**.

The trap — this is the 2.4.0 truthiness bug reappearing in a new place. `renderQuickReplies` returns
early when every item is malformed, so branching on "the payload contained a `quick_replies`
element" would produce an empty welcome with no fallback. Branch on what was **rendered**:

- `renderQuickReplies()` returns the row node when it appends one, and nothing when it does not
  ([nest-chatbot.js:1274](nest-chatbot.js#L1274) area). `renderAction()`'s `quick_replies` branch
  already `return null`s explicitly, so its contract is unchanged.
- `showWelcome` sets a flag from that truthy return and calls `showPrompts` only if it stayed false.

`els.promptsLabel` / `els.promptButtons` therefore stay `null` whenever the server supplied chips —
which is already what `setLocale`'s guard ([nest-chatbot.js:2487](nest-chatbot.js#L2487) area)
requires, since payload chips must never be repainted from a pack.

The partition itself is unchanged: `quick_replies` into the one-shot `.nc-welcome` wrapper,
everything else (the `show_at_init` promo) into `.nc-body` as transcript content.

### 4. Mock fixture: two init rows

Beside `islandChips()` ([nest-chatbot.js:454](nest-chatbot.js#L454) area), add a `promptChips()`
factory returning the tenant-authored "try asking" row — English literals, because payload is never
translated. `Mock.init` returns `actions: [promptChips(), islandChips()]`.

Pick the two labels so they chain into existing fixtures rather than dead-ending: a "…hostel…"
prompt reaches the `hostel` branch (island chips, with the reply text asking the question — the
shape a real clarification turn has), and a "…Nest Pass…" prompt reaches the word-bounded `\bpass\b`
branch (promo card). Verify against the matcher order at
[nest-chatbot.js:485-660](nest-chatbot.js#L485-L660) before settling the wording.

**Accepted coverage loss, to be documented not hidden:** with init always sending chips, the demo no
longer reaches `showPrompts()` or `setLocale`'s pill-repaint branch at all. Record in CLAUDE.md that
exercising the fallback means temporarily setting `Mock.init`'s `actions: []`.

### 5. Docs

- **`VERSION` → `2.4.2`**, `BUILT_AGAINST` stays `'1.4.1'` (no contract sync here).
  Judgement, flag it for override: two of these are bug fixes and the third is a revert to
  contract-specified behaviour; the new storage key is an implementation detail of the size fix, not
  new config surface. Under the repo's own rule that is a patch — and it keeps **2.5.0 reserved for
  the contract sync**, which CLAUDE.md and the proposals doc both promise.
- **`CHANGELOG.md`** — 2.4.2 entry: the returning-guest root cause (the resume fast path skips init)
  and that 2.4.1's storage-clearing verification is what hid it; the persisted size flag and how it
  relates to `user-shrank`; the revert to server-replaces-ours with the 1.5.0 quotation as the
  reason; the two-row fixture; and the coverage loss above.
- **`CLAUDE.md`** — extend the panel-size flags table with `nest-chatbot:expanded`, and update the
  storage line to the new `{uuid, ts, actions}` shape.
- **`docs/proposals/response-contract-phase2-elements.md`** — correct the Precedence section again
  (server chips now replace the widget's block; the partition is unchanged) and sharpen open point 9:
  rows render bare by decision, so an optional element-level `heading` is the live request, and the
  intended payload is two `quick_replies` rows at init.
- **`docs/wsuite/` is never staged** — vendored read-only packet, modified on disk out of band.

## Verification

Playwright MCP against `demo/index.html` on the existing `:5501` server. The 2.4.1 round proved
these fixes need a test that does **not** start from a clean slate.

1. **Returning guest — the case that was missed.** Load, open, let the welcome render, then reload
   **without clearing storage**. Both chip rows must still be present, and `NestChatbot` must not
   have issued a second init (assert the stored uuid is unchanged across the reload).
2. **First visit** — clear both stores, reload: two chip rows, no `TRY ASKING` label, no pack pills.
3. **Fallback path** — with `Mock.init` temporarily returning `actions: []`, assert `TRY ASKING` +
   two pills return, and that `setLocale('de')` repaints them.
4. **Malformed cache** — write `{uuid, ts, actions: "garbage"}` into `localStorage` by hand and
   reload: widget boots, no throw, welcome falls back to the pills.
5. **Panel size** — expand, reload: still expanded, `aria-label` reads "shrink". Shrink, reload:
   still collapsed. Repeat with the window under 1024px to confirm the class is inert rather than
   breaking the fullscreen panel.
6. **Regression gate** — `book contact rooms link available hostel tenerife pass !unknown !xss !410
   !429`, then `!403`. Re-assert the 2.4.1 promo numbers (`offsetHeight === scrollHeight`,
   `overflow: "clip"`) since `.nc-body`'s children change shape here.
7. **Focus rescue** — Tab to a chip in the *second* row, Enter, assert `document.activeElement` is
   `TEXTAREA.nc-input`. Two rows in one wrapper is a new shape for `removeWelcome()`.
8. **Scoping** — host-page computed styles identical with and without the widget; no new
   `!important`; any new selector `#nest-chatbot`-scoped.

## Commits

Three, each independently revertable:

1. Cache init `actions[]` with the conversation uuid (fixes the returning-guest welcome loss).
2. Persist the expanded panel across reloads.
3. Init chips replace the pack block + two-row fixture + `VERSION`/`CHANGELOG`/`CLAUDE.md`/proposals.

Branch `phase-2-panel-redesign`, explicit paths only, trailer
`Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
