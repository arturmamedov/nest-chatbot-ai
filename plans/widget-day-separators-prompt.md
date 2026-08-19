> **Written 2026-08-19, against widget `2.8.0` / `BUILT_AGAINST` `1.6.1`.** Not implemented,
> not designed — this is the brief plus the findings a scoping pass turned up, so the session
> that picks it up does not rediscover them. Line numbers are from 2.8.0 and will drift;
> **the function names are the durable reference.** Nothing here is decided: the "Open
> decisions" section is the actual first task.

# Task — day separators in the chat transcript

## Where you are

`nest-chatbot-ai` is Nest Hostels' branded guest chat widget: one drop-in `<script>` tag that
gives a host website the Germán bubble, talking to the wSuite chatbot API. Vanilla JS, **no
build step, no dependencies** — `nest-chatbot.js` is a single classic-script IIFE shipped
exactly as written, styled by `css/nest-chatbot.css`, demoed at `demo/index.html`.

**Read `CLAUDE.md` first, all of it.** It is short and every rule in it has cost this repo
something. The ones this task walks straight into are named below, but read the file — do not
work from this summary.

## The ask

A centred pill between messages when the day changes, the way mobile chat apps do it:

```
                  ┌──────────────┐
                  │    Today     │
                  └──────────────┘
```

"Today", "Yesterday", or a date like `18/08/2026` for anything older. Nothing more — no
per-message clock is being asked for, though whether to add one is an open decision below.

**Why it matters now:** since 2.8.0 the widget replays a stored transcript when a guest
returns within the 24h idle window (`CHANGELOG.md` 2.8.0). So a guest can now open the panel
and see a conversation from yesterday evening with no indication that any time passed at all —
the replay is seamless by design, and that is exactly the problem. Before 2.8.0 there was
never a transcript old enough for the question to arise.

## The finding that shapes everything: there is no timestamp

**Nothing in this system records when a message happened.**

- A stored transcript entry is `{r, t, a, n}` — role, text, paint-only actions, turn number.
  See `validTurns()` (`nest-chatbot.js:382`, storage section).
- **The response contract has no time field at all** — no `timestamp`, no `created_at`, no
  `sent_at`. Verify this yourself against `docs/wsuite/response-contract.md` before designing
  around it; that packet is the authority and it may have moved. If a later contract adds one,
  that changes this task completely and for the better.
- The record carries a single record-level `ts` (`persist()`, `nest-chatbot.js:438`), and
  since 2.8.0 it means **last activity**, not creation — it is rewritten on every turn.

So the clock has to be the **client's**, with the honest consequence that a replayed
transcript shows the *sending browser's* time, and a guest who crosses a timezone between
visits sees separators computed in the new zone. That is acceptable for a "Today / Yesterday"
pill and would not be for a per-message clock claiming precision. Say so in the code comment —
the next reader will wonder.

## The trap: three rebuild sites will silently eat a new field

This is the part that will cost a day if it is missed, because the failure is invisible until
a reload — and one variant of it is invisible until a *long* conversation reloads.

**Four creation sites** put entries into `transcript`, and all four need the new field:

| Site (2.8.0 line) | What it creates |
|---|---|
| `nest-chatbot.js:2731` — `introMaybeFinish()` | the greeting, `unshift`ed |
| `nest-chatbot.js:3453` — `restartConversation()`'s callback | the greeting again, after a restart |
| `nest-chatbot.js:3233` — `sendGuestText()` | the guest's own turn |
| `nest-chatbot.js:3280-3286` — `sendMessage()`'s response handler | the bot reply, built on payload **arrival** |

**Three rebuild sites** reconstruct entries field-by-field and will drop anything you did not
add to them:

1. **`validTurns()` (`nest-chatbot.js:382`)** — rebuilds every entry on read, *deliberately*:
   the comment above it says entries are rebuilt rather than passed through so a tampered
   record cannot smuggle extra keys back into the next `persist()`. That defence is correct;
   it just means a new field is opt-in. **Miss this one and timestamps vanish on every reload.**
2. **`boundedRecord()`, the thinning copy (`nest-chatbot.js:473`)** — rebuilds an entry as
   `{r, t, a: null, n}` when shedding an old turn's payload.
3. **`boundedRecord()`, the last-turn copy (`nest-chatbot.js:482`)** — same shape, the
   single-turn case.

**Miss the `boundedRecord()` pair and timestamps vanish only on long or heavy conversations** —
the record has to exceed 64KB (`STORE_MAX_CHARS`, `nest-chatbot.js:326`) before either line
runs. That is the harder bug of the two to see, and it will not reproduce on the mock, where
the 40-turn cap binds first (~37KB).

**A fourth site worth a decision, not just a field:** `pollEntries[pa.url] = entry`
(`nest-chatbot.js:3291`) hands a bot entry to `pollResult`, which later replaces that turn's
`t` and `a` **in place** when an async answer resolves. Decide there whether the entry keeps
the time the interim reply arrived or takes the resolution time. Either is defensible; silence
is not.

## Everything else the design has to satisfy

- **Old records have no timestamp.** A guest mid-conversation when this ships reloads into a
  record written by 2.8.0. Decide the fallback — no separator for those turns, or the
  record-level `ts` — and make sure a record simply lacking the field cannot throw or paint
  `Invalid Date`. `validTurns()`'s existing per-field posture (wrong type → a safe default,
  never a throw) is the pattern to copy.
- **Both render paths need it.** The live one is `addBubble()` (`nest-chatbot.js:1677`); the
  replay is `replayTranscript()` (`nest-chatbot.js:2746`). The replay loop already carries two
  invariants documented in its own comments — the `.nc-greeting` entrance-only rule, and
  `retireChipRows()` before the final turn — so read it before adding to it.
- **`Intl` precedent already exists and it is guarded.** `cardPrice()` (`nest-chatbot.js:2268`)
  wraps `new Intl.NumberFormat(locale, …)` in `try/catch` because a bad locale or currency
  throws `RangeError`, and degrades to "drop the price" rather than taking the reply down.
  `Intl.DateTimeFormat` needs the same guard and the same posture: no separator beats a broken
  one. Use it for the older-day format too — do not hand-roll `dd/mm/yyyy`, which is wrong in
  at least one of the five shipped locales.
- **Two new `t()` keys × 5 locales** (`en es it de fr`, i18n table at `nest-chatbot.js:152`).
  Anything user-visible goes through `t()`/`tf()` — CLAUDE.md, no exceptions.
- **The scroll rule.** There is no `scrollDown()` in this file and there must not be one. A new
  render path calls `afterRender()` (`nest-chatbot.js:1592`) and **never** a scroll. Read
  CLAUDE.md § "The transcript scrolls itself exactly once per turn" before writing the insert.
- **`anchorSend()` will move under you.** `anchorSend(bubble.parentNode)`
  (`nest-chatbot.js:1546`, called from `nest-chatbot.js:3228`) is the turn's one deliberate
  scroll: it puts the guest's `.nc-message` row at the top of the panel. A separator inserted
  immediately before that row in the same tick adds height *above* it, so the anchor scrolls
  further and **the separator lands above the fold** — the guest may never see the pill
  announcing the day their own message opened. That is a design decision (is the pill for the
  sender, or only for the reader scrolling back?), not a bug to patch out. Whatever you choose,
  check where it actually lands rather than reasoning about it: the anchor depends on
  `anchorFloor` + `applyAnchorPad()` and will *look* implemented while doing nothing.
- **`followsBotMessage()` reads `els.body.lastElementChild`** (`nest-chatbot.js:1671`) to
  suppress the repeated avatar inside a burst of bot messages. A separator becomes that last
  element, so the next bot bubble **regains its avatar**. Arguably correct — a new day is a new
  burst — but decide it rather than discovering it.
- **CSS scoping.** Every new rule nests under `#nest-chatbot` and every class carries the `nc-`
  prefix. There are no global selectors in this stylesheet and adding the first one repaints a
  customer's page. Theme through the existing custom properties.
- **A separator is a node, so the focus rule applies.** If anything can remove or hide one (the
  restart wipe already clears the transcript), check `document.activeElement` first — CLAUDE.md
  § Conventions, the bug this repo has rediscovered five times. A pill is not focusable today,
  so this is likely a no-op; confirm it rather than assuming.
- **Accessibility.** The panel body is `role="log"` with `aria-live="off"`
  (`nest-chatbot.js:1312`), and replies announce through a dedicated visually-hidden region
  instead (`announce()`, `nest-chatbot.js:1644`) — so anything painted into the body is silent
  by construction and a separator gets that for free. Decide whether silent is right, or
  whether the pill should be `aria-hidden` outright, or exposed as a separator with a readable
  label.
- **A long session crossing midnight needs a mid-conversation separator**, so compare against
  the **last day painted** rather than "is this the first turn". Hold that as render state, and
  make sure the replay and the live path share one comparison — two copies will disagree at
  exactly the boundary that matters.
- **Cost is negligible**: ~15 chars × 40 turns ≈ 600 bytes against a 64KB cap. Storage is not a
  reason to compress the field, and a readable epoch integer beats a clever encoding.

## Open decisions — brainstorm these first, do not just pick

1. **Day separators only, or per-message times too?** The ask is separators. A per-message
   clock is a bigger surface and rests on a client timestamp that may not be the sender's
   (see above) — weigh it, and say why if you decline it.
2. **The no-timestamp fallback** for records written before this ships: nothing, or the
   record-level `ts` for every legacy turn (which paints one separator for a conversation that
   may have spanned two days).
3. **Does the greeting get a separator above it?** It is the first thing in the transcript; a
   pill above it may read as chrome rather than as information.
4. **Where the pill lands relative to `anchorSend()`** — above the fold, or deliberately kept
   in view.
5. **The avatar-burst interaction** — does a new day break a bot burst?
6. **Timezone honesty** — is anything shown to the guest, or is the client clock silently
   authoritative?

## Version

**Patch** — `2.8.1` unless a contract sync lands first. CLAUDE.md § Conventions: patch unless
the embed contract changes, and new UI behaviour is explicitly a patch. No `data-*` attribute,
no `window.NestChatbot` method, no change to what a host's `<script>` tag says. Add a
`CHANGELOG.md` entry.

## Verification

- **Mock first** (`demo/index.html` runs on `data-mock="true"`; the fixture table is in
  CLAUDE.md § Local development). Send a few turns: exactly one "Today" pill, and none
  appearing mid-run.
- **The reload path is the one that actually tests this.** Send turns, reload, confirm the
  replayed transcript still carries its separators — that is `validTurns()` proving it kept the
  field.
- **Force the thinning path** to prove `boundedRecord()` kept it too: the byte cap is
  unreachable from the mock, so lower `STORE_MAX_CHARS` temporarily (it is one constant) or
  hand-write an oversized record into `localStorage`. Do not skip this — it is the invisible
  half of the trap. `data-debug="true"` prints a `store bounded` line when either path runs.
- **Fake the clock** to test "Yesterday" and an older date, and to cross midnight
  mid-conversation: hand-edit the stored record's timestamps in devtools and reload. There is
  no need to add a debug hook for it.
- **All five locales**, including the older-date format, and confirm a garbage locale cannot
  throw past the `Intl` guard.
- Check the scroll behaviour on a turn whose reply is taller than the panel — the transcript
  must still move exactly once.
- `node --check nest-chatbot.js`, and the demo page's own appearance must not change (its
  global `h2`, `textarea:focus` and `a` traps exist to catch scoping regressions).

## Deliverable

`nest-chatbot.js` (`VERSION` bump, the field on four creation sites, the three rebuild sites,
the render path, two `t()` keys × 5 locales), the `nc-`-scoped CSS for the pill, a
`CHANGELOG.md` entry, and a short note recording which open decisions you resolved and why.
`BUILT_AGAINST` does not move — this touches no contract.
