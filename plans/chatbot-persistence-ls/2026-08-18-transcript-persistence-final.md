# Transcript Persistence (widget-side, Phase 1) — Merged Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the chat transcript in the existing localStorage record so a returning guest (within the 24h idle window) lands where they left off — no intro replay, no lost server greeting, no re-rendered welcome block.

**Architecture:** Extend the existing `{uuid, ts, actions}` record with `turns[]`, `guestTurned`, `ended`. A module-level `transcript` array is the in-session source of truth; `persist()` (replacing `writeStore`) serializes it at every state-changing moment; `playIntro()` grows a replay branch that paints stored turns through the **existing** renderers with no loader, no typing, no announcements. Everything stays inside the single classic-script IIFE in `nest-chatbot.js`.

**Tech Stack:** Vanilla ES5-safe JS, no build step, no test runner — verification is browser-based against the mock fixtures (`demo/index.html`, `data-mock="true"`), optionally driven via Playwright MCP.

**Spec:** `plans/chatbot-persistence-ls/claudecode-wsuite-plan.md` + `plans/chatbot-persistence-ls/claudeai-revised-plan.md` (this plan supersedes both; §"What this merge corrects" records why), constrained by `CLAUDE.md`.

## Global Constraints (from CLAUDE.md — verbatim rules)

- No build step; `nest-chatbot.js` ships as written. No new files except docs.
- **Never `innerHTML`.** Every stored/replayed string reaches the DOM via `textContent`, `setAttribute`, or a created node — the replay goes through the existing renderers only.
- Every user-visible string goes through `t()` / `tf()` — the replay adds none.
- **Anything that removes or hides a node checks `document.activeElement` first** — the replay reuses `retireChipRows()` / `endConversation()`, which already do.
- `teardown()`'s claim stays true: exactly two listeners outside `#nest-chatbot`. **No `pagehide`/`visibilitychange`/`beforeunload` listener** — write points cover persistence.
- Comments explain **why**; keep the section banners.
- `BUILT_AGAINST` stays `'1.6.1'`. `VERSION` `'2.7.0'` → `'2.8.0'` (new UI surface = minor, per CLAUDE.md's own rule).
- Do not send the transcript anywhere: the turn body stays `{message, locale}`. Display-only.
- No server history endpoint, no multi-device framing (out of scope by decision).

## What this merge corrects in the two source plans

Verified against `nest-chatbot.js` @ `feat/host-font-override` (3491 lines, VERSION 2.7.0):

**`claudecode-wsuite-plan.md` (superseded on):**
1. "Three callers write through it" — **false**: `writeStore` has exactly one caller ([nest-chatbot.js:2950](nest-chatbot.js#L2950)).
2. Missed the `async_result` replay bug: `renderAction` routes it into `pollResult` (:1678) and the epoch guard passes on replay → every page load would restart a dead poll. Revised plan's paint-only rule adopted.
3. Missed `ended`: a replayed capped conversation would reopen the composer on a dead conversation.
4. Kept "clearStore on 410 wipes the transcript" as deliberate — that orphans the guest's just-sent message. Revised plan's Decision 1 (transcript survives re-init, `n` nulled) adopted.
5. "Persist after the reply settles" — settle = `typeText` finished = presentation; a mid-reveal navigation loses a turn the server has. Persist on payload arrival adopted.
6. Missed the announcer flood: `addBubble` announces every non-empty bot bubble (:1553) → N stored turns = N queued announcements per page load.
7. Missed the CLAUDE.md contradiction (the "do not resurrect `chatHistory`" bullet) and the storage-table row.

**`claudeai-revised-plan.md` (kept, with these fixes):**
1. **Greeting write point is wrong.** It says "in the init callback where writeStore already fires" — but that callback also fires on the 410/404 re-init (where **no** greeting is painted; the old one is still on screen) and would store a phantom second greeting. The entry must be created where the greeting **bubble** is created: `introMaybeFinish()` (:2532) and `restartConversation()`'s callback (:3165) — and **unshifted**, not pushed, because both insert the bubble *before* an impatient guest's already-sent bubble (`insertBefore(wrap, els.loader.nextSibling)`).
2. **Missing write point: `endConversation()`.** With persist-on-arrival, the 200-branch persist fires *before* `renderActions` flips `ended` — the flag would never reach storage (no further turn can persist it: the composer is closed). Verification #6 of that plan fails as written. Fix: `persist()` inside `endConversation()` after `ended = true`.
3. **The poll's in-place update needs a mechanism.** The interim turn is *not* necessarily the last transcript entry when its poll resolves (the guest can send more turns while a poll is pending), and threading a handle through `renderActions`→`renderAction` is exactly what that seam's comments forbid (see `renderQuickReplies`'s `parent` note :1799). Fix: a module map `pollEntries` keyed by the poll path — the identity the wire already uses (`Mock.pollCounts` keys on it too).
4. **The `ended` restore trap.** Restoring the boolean *before* calling `endConversation()` makes it a no-op (`if (ended || removed) return;` :3093) — composer would stay open with no restart button. The stored flag must travel via `intro.ended` and `endConversation()` must set `ended` itself.
5. **"Retire" means "remove".** `retireChipRows()` removes rows from the DOM (:1867) — so "stale chip rows come back retired" means *absent*, not greyed. The paint-then-retire replay loop is still correct (all synchronous, no flicker) and keeps one owner for the rule.
6. Adds: CLAUDE.md architecture-table `storage` row update; multi-tab last-write-wins as a documented accepted limitation; explicit reason the guest write point lives in `sendGuestText` and never `sendMessage` (the 410 resend re-enters `sendMessage` and would double the entry).

**Settled decisions carried over unchanged (do not relitigate):** transcript survives 410/404 re-init with `n` nulled; persist on payload arrival; paint-only rule for `a` (strip `async_result` + `conversation_ended` at persist time); `guestTurned`/`ended` stored, not derived; greeting is `turns[0]` with `a: null` (welcome elements stay in `actions`, never duplicated); error/retry/timeout bubbles are not transcript; caps 40 turns / 64K chars with drop-`a`-before-drop-turn and never-drop-the-newest; `ts` becomes last-activity (documented as fixing a latent divergence, matching the server's `idle_hours` semantics); CLAUDE.md bullet narrowed in the same commit; 24h TTL, `chatEpoch`, every renderer, `clearStore()` call sites unchanged.

**Accepted edges (document, don't solve):**
- A guest turn persisted before its POST resolves can replay as a question with no answer (rare: sub-2s window; self-heals when the guest re-asks; matches "storage mirrors screen").
- Two tabs on one conversation: last `persist()` wins; a lost stored turn costs replay fidelity only, never the server transcript. Phase 2 reconciliation would heal it.
- A reply that completes after the tab closes is lost to the store (the tail gap — Phase 2's reason to exist).
- The one-round-trip window between `clearStore()` (410 branch) and the re-init's `persist()` can lose the record to a navigation — same window that loses the uuid today.

## File map

- **Modify:** `nest-chatbot.js` (state, storage, render [one guard], intro, flow sections)
- **Modify:** `CLAUDE.md` (storage table row; "Do not send chat history" bullet)
- **Modify:** `CHANGELOG.md` (2.8.0 entry)
- **No new files.** No CSS change.

---

### Task 0: Branch and record the plan

**Files:** none (git only)

- [ ] **Step 1: Create the working branch** (current branch is `feat/host-font-override`, already released):

```bash
git -C "c:/Users/artur/Herd/nest-chatbot-ai/nest-chatbot-ai" checkout -b feat/transcript-persistence
```

- [ ] **Step 2: Save this plan into the repo's plan folder** as `plans/chatbot-persistence-ls/2026-08-18-transcript-persistence-final.md` (copy of this document — the user keeps plans there; the two source plans stay untouched as records).

- [ ] **Step 3: Commit**

```bash
git add plans/chatbot-persistence-ls/2026-08-18-transcript-persistence-final.md
git commit -m "Record the merged transcript-persistence plan"
```

---

### Task 1: Store layer — record shape, validation, bounded persist

**Files:**
- Modify: `nest-chatbot.js` — state section (~:123), storage section (:303–:355), api/flow caller (:2950)

**Interfaces:**
- Produces: module var `transcript` (array of `{r,t,a,n}`), `replaying` (bool), `pollEntries` (map); `persist()` (no args, replaces `writeStore(uuid, actions)`); `persistableActions(actions) → array|null`; `readStore() → {uuid, actions, turns, guestTurned, ended} | null`.
- Consumes: existing `STORE_KEY`, `IDLE_MS`, `conversationUuid`, `intro`, `guestTurned`, `ended`.

- [ ] **Step 1: Add module state** in the state section, after `var chipRows = [];` / `var ended = false;` (:123–:124):

```js
    // The DISPLAY-ONLY transcript, oldest first: {r:'bot'|'guest', t:'<final
    // text>', a: actions[]|null, n: <server turn>|null}. Persisted so a reload
    // inside the idle window lands the guest where they left off; it must
    // NEVER enter a request body — the server owns the real transcript, keyed
    // by the conversation uuid (CLAUDE.md, "Do not send chat history").
    var transcript = [];
    // True only while replayTranscript() paints stored turns: the guest has
    // seen all of it, so addBubble() must not announce it — twenty stored
    // replies would bury the live region at every page load. The first LIVE
    // reply after a replay announces as ever.
    var replaying = false;
    // async poll path → its transcript entry, so the final can replace the
    // interim's t/a IN PLACE. Keyed by the poll path (the identity the wire
    // already uses) because the interim turn is not necessarily the LAST
    // entry when its poll resolves — the guest can send more turns meanwhile.
    // Object.create(null): the path is payload-derived, and a key like
    // 'constructor' must not phantom-match (same reason as cardUrls).
    var pollEntries = Object.create(null);
```

- [ ] **Step 2: Extend the threat-model comment above `readStore`** (:308–:327). Extend, don't duplicate — append one paragraph before the "Accepted cost" paragraph:

```js
     * Since 2.8.0 the record also carries the transcript ({r, t, a, n} turns,
     * oldest first) plus the guestTurned and ended latches. The same argument
     * covers it: replayed turn text and actions[] go back through the same
     * renderers, which treat every payload string as untrusted already. `n` is
     * the server's 1-based turn number, stored UNUSED so a future
     * ?since={turn} reconciliation endpoint is a drop-in with no stored-data
     * migration. `a` holds paint-only elements — persistableActions() strips
     * anything whose renderer has a side effect (see its comment).
```

- [ ] **Step 3: Extend `readStore()`** (:328–:343) — return the new fields, validated as defensively as `actions`; add `validTurns` below it:

```js
    function readStore() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (!raw) { return null; }
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.uuid || !parsed.ts) { return null; }
            if ((Date.now() - parsed.ts) > IDLE_MS) { return null; }
            // Anything but a non-empty array is dropped rather than handed on: a
            // malformed store must degrade to "no welcome elements", never throw,
            // and above all never cost the guest the conversation it also holds.
            return {
                uuid: parsed.uuid,
                actions: (Array.isArray(parsed.actions) && parsed.actions.length) ? parsed.actions : null,
                turns: validTurns(parsed.turns),
                guestTurned: parsed.guestTurned === true,
                ended: parsed.ended === true
            };
        } catch (e) { return null; }
    }

    // Per-ENTRY defence, same posture as `actions` above: a malformed entry is
    // dropped, a malformed list degrades to "no transcript" (today's intro), and
    // nothing here can throw past readStore's try. Entries are REBUILT rather
    // than passed through, so a tampered record cannot smuggle extra keys back
    // into the next persist().
    function validTurns(turns) {
        if (!Array.isArray(turns) || !turns.length) { return null; }
        var out = [];
        for (var i = 0; i < turns.length; i++) {
            var e = turns[i];
            if (!e || (e.r !== 'bot' && e.r !== 'guest')) { continue; }
            out.push({
                r: e.r,
                t: typeof e.t === 'string' ? e.t : '',
                a: (Array.isArray(e.a) && e.a.length) ? e.a : null,
                n: (typeof e.n === 'number' && isFinite(e.n)) ? e.n : null
            });
        }
        return out.length ? out : null;
    }
```

- [ ] **Step 4: Replace `writeStore` with `persist()` + bounds** (:345–:351). Constants go beside `IDLE_MS`:

```js
    var TURNS_MAX = 40;               // safety rail — observed mean is ~1.3 turns/conversation
    var STORE_MAX_CHARS = 64 * 1024;  // JSON.stringify().length — UTF-16 units, what quota charges
```

```js
    /*
     * The paint-only rule: `a` may hold only elements whose renderer just
     * paints. Anything with a side effect is stripped AT PERSIST TIME — it
     * never sits in the record at all — and its effect is represented as
     * explicit state instead:
     *   - async_result: renderAction routes it into pollResult, and on a
     *     replay the epoch is CURRENT, so every guard passes and each page
     *     load would restart a poll for a turn that resolved hours ago. When
     *     the live poll resolves, the final payload replaces the turn's t/a
     *     anyway (see pollResult).
     *   - conversation_ended: restored once from the stored `ended` boolean
     *     through endConversation() — one seam, not two.
     * A future element type with a side effect gets its exclusion HERE.
     */
    function persistableActions(actions) {
        if (!actions || !actions.length) { return null; }
        var kept = [];
        for (var i = 0; i < actions.length; i++) {
            var a = actions[i];
            if (a && (a.type === 'async_result' || a.type === 'conversation_ended')) { continue; }
            kept.push(a);
        }
        return kept.length ? kept : null;
    }

    /*
     * The one writer. Serializes CURRENT state — uuid, the init welcome
     * elements, the transcript, the two latches — so every caller is "state
     * changed, record it" with no arguments to get wrong. With this firing on
     * every turn, `ts` now means "last activity", which is what the server's
     * idle_hours has always measured — a guest chatting past hour 24 is no
     * longer reset client-side under a live server conversation.
     */
    function persist() {
        // Never write without a uuid: readStore() rejects a uuid-less record,
        // so a persist racing ahead of init (a guest bubble lands before the
        // 201 arrives) would cost the guest the record it also holds. The
        // in-memory transcript keeps the turn; init's own persist() writes it.
        if (!conversationUuid) { return; }
        var record = {
            uuid: conversationUuid, ts: Date.now(), actions: intro.actions || null,
            turns: transcript, guestTurned: guestTurned, ended: ended
        };
        try {
            window.localStorage.setItem(STORE_KEY, boundedRecord(record));
        } catch (e) {
            // Quota, not private mode (that throws above too, and lands here
            // the same): shed the transcript and keep the conversation — the
            // uuid must never be the casualty of its own history.
            try {
                record.turns = [];
                window.localStorage.setItem(STORE_KEY, JSON.stringify(record));
            } catch (e2) { /* private mode — the widget still works, just not across reloads */ }
        }
    }

    /*
     * 40 turns / 64K chars, whichever hits first — a safety rail, not a
     * working limit. Oldest first, payload before text: a turn's rich
     * elements are the bulk of its bytes and a card-less old turn still
     * reads, so shed `a` from the oldest turn that has one, then whole oldest
     * turns — and never the most recent turn, whose `a` goes last. Entries
     * are COPIED before they are thinned: the live transcript must not lose
     * cards to a size check on its serialized twin.
     */
    function boundedRecord(record) {
        var turns = record.turns.slice(-TURNS_MAX);
        record.turns = turns;
        var out = JSON.stringify(record);
        while (out.length > STORE_MAX_CHARS && turns.length) {
            var thinned = false;
            for (var i = 0; i < turns.length - 1; i++) {
                if (turns[i].a) {
                    turns[i] = { r: turns[i].r, t: turns[i].t, a: null, n: turns[i].n };
                    thinned = true;
                    break;
                }
            }
            if (!thinned) {
                if (turns.length > 1) { turns.shift(); }
                else if (turns[0].a) { turns[0] = { r: turns[0].r, t: turns[0].t, a: null, n: turns[0].n }; }
                else { turns.length = 0; }
            }
            out = JSON.stringify(record);
        }
        return out;
    }
```

- [ ] **Step 5: Update the one caller** — `startConversation`'s init callback (:2950): replace `writeStore(conversationUuid, intro.actions);` with `persist();` and adjust the comment above it ("Stored WITH the uuid…" still reads true; add: "persist() also carries any transcript a 410 re-init brought across — see sendMessage.").

- [ ] **Step 6: Verify in the browser.** `python -m http.server 5501` from the repo root; open `http://127.0.0.1:5501/demo/index.html`; clear the three panel flags + the store (`localStorage.clear()`); open the widget; then in the console:

```js
JSON.parse(localStorage.getItem('nest-chatbot:default'))
```

Expected: record has `uuid`, `ts`, `actions` (two chip rows), `turns: []`, `guestTurned: false`, `ended: false`. Reload → widget resumes exactly as today (old behaviour preserved: loader + typed fallback greeting, welcome block). No console errors.
*(Note: with `data-mock` and no key, `STORE_KEY` is `nest-chatbot:default`.)*

- [ ] **Step 7: Commit**

```bash
git add nest-chatbot.js
git commit -m "Extend the store record with a validated, bounded transcript"
```

---

### Task 2: Write points — every state change reaches the record

**Files:**
- Modify: `nest-chatbot.js` — flow section (`sendGuestText` :2975, `sendMessage` :3033 + :3057, `endConversation` :3092, `restartConversation` :3133, `pollResult` :3238), intro section (`introMaybeFinish` :2543-2559)

**Interfaces:**
- Consumes: `transcript`, `pollEntries`, `persist()`, `persistableActions()` from Task 1.
- Produces: a record whose `turns` mirror the screen at every moment a payload is known.

- [ ] **Step 1: Guest turn** — in `sendGuestText` (:2975), after `anchorSend(bubble.parentNode);` and before `ensureConversation(...)`:

```js
        // Persisted HERE and never in sendMessage: the 410/404 branch re-enters
        // sendMessage with the same text, and a write point there would store
        // the guest's turn twice. On a first-ever turn the uuid may not exist
        // yet — persist() skips, and init's own persist() carries this entry.
        transcript.push({ r: 'guest', t: text, a: null, n: null });
        persist();
```

- [ ] **Step 2: Bot reply, on payload arrival** — in `sendMessage`'s 200 branch (:3033), insert directly after `if (status === 200 && body) {` and before the `addBubble`/`typeText` lines:

```js
                // On ARRIVAL, not on settle: typeText is presentation, and a
                // guest who navigates mid-reveal must not lose a turn the
                // server already has. `t` is the FINAL text — the reveal is
                // still painting it.
                var entry = {
                    r: 'bot',
                    t: body.reply || '',
                    a: persistableActions(body.actions),
                    n: (typeof body.turn === 'number' && isFinite(body.turn)) ? body.turn : null
                };
                transcript.push(entry);
                if (body.actions) {
                    for (var pi = 0; pi < body.actions.length; pi++) {
                        var pa = body.actions[pi];
                        if (pa && pa.type === 'async_result' && typeof pa.url === 'string') {
                            pollEntries[pa.url] = entry;   // the poll's final replaces this turn in place
                        }
                    }
                }
                persist();
```

*(Note: `renderAction` hands `pollResult` the raw `action.url`, so the raw url is the exact map key it will look up.)*

- [ ] **Step 3: Poll final, in place** — in `pollResult`'s ready/failed branch (:3238–3244), after `renderActions(body.actions, bubble, rendered);`:

```js
                    // The server overwrote the same transcript row — so does the
                    // store: the interim's text and (already-stripped) actions
                    // give way to the final payload, found by the poll path
                    // because newer turns may sit after it by now.
                    var final = pollEntries[path];
                    if (final) {
                        delete pollEntries[path];
                        final.t = body.reply || '';
                        final.a = persistableActions(body.actions);
                        if (typeof body.turn === 'number' && isFinite(body.turn)) { final.n = body.turn; }
                        persist();
                    }
```

- [ ] **Step 4: The greeting, where its bubble is born.** In `introMaybeFinish`, inside the `requestAnimationFrame` callback (:2543), directly before `typeText(text, intro.greeting);`:

```js
                // The greeting is transcript turn 0 — UNSHIFTED, because this
                // bubble is inserted BEFORE an impatient guest's already-sent
                // message and the array must read like the screen. Created
                // here, where the bubble is, and never in the init callback:
                // that also fires on the 410 re-init, which paints nothing.
                transcript.unshift({ r: 'bot', t: intro.greeting, a: null, n: null });
                persist();
```

And the same two lines (same comment, one line: `// Same rule as introMaybeFinish: the greeting entry is born with its bubble.`) in `restartConversation`'s callback (:3173), inside its `requestAnimationFrame`, before its `typeText(text, intro.greeting);`.

- [ ] **Step 5: The ended latch** — in `endConversation` (:3092), after `ended = true;` and `sendQueue.length = 0;`:

```js
        // The 200-branch persist fired before renderActions flipped this — and
        // no further turn can carry it (the composer is closing). Without this
        // write a reload reopens the composer on a dead conversation.
        persist();
```

- [ ] **Step 6: The 410/404 carry** — in `sendMessage`'s re-init branch (:3057), after `clearStore();`:

```js
                // The transcript SURVIVES the re-init — the guest's message is
                // on screen and must not become a question with no answer after
                // a reload. Its turns now belong to a dead conversation, so
                // their server numbers are unreconcilable by definition: null
                // is the honest value (a future ?since={turn} must not ask the
                // new conversation about the old one's numbers). persist() in
                // the init callback rewrites everything under the new uuid.
                for (var ti = 0; ti < transcript.length; ti++) { transcript[ti].n = null; }
```

- [ ] **Step 7: Restart wipes memory too** — in `restartConversation` (:3142), beside `chipRows = [];`:

```js
        transcript = [];                     // a NEW conversation shares no history with the old one
        pollEntries = Object.create(null);   // any orphaned poll handle died with its epoch
```

- [ ] **Step 8: Verify in the browser** (mock, fresh storage):
  1. Open widget, send `book`, then `rooms`. Console: record `turns` = `[greeting(bot,n:null), guest, bot(n:1,a:[booking_link]), guest, bot(n:2,a:[availability])]` — roles/order/ns exactly so.
  2. Send `available`; **before** the poll resolves the record's last bot turn has interim text and `a:[{booking_link}]` (no `async_result` — stripped); after ~3 polls it has the final text and `a:[availability]`. Exactly one entry either way.
  3. Send `!cap` → record `ended: true`.
  4. New conversation via the restart button → record has fresh uuid, `turns:[greeting]`, `guestTurned:false`, `ended:false`.
  5. Send `!410` → record has a **new** uuid, prior turns carried with every `n: null`, and the `!410` guest turn present (its reply is the error bubble, correctly absent).
  6. Send a plain message; while thinking, note record already lacks the reply; when the reply lands, the record has it even though typing is still revealing (pause JS via debugger to observe, or just confirm post-reveal).

- [ ] **Step 9: Commit**

```bash
git add nest-chatbot.js
git commit -m "Persist every turn on payload arrival, carry the transcript across a 410 re-init"
```

---

### Task 3: Replay — the returning guest lands where they left off

**Files:**
- Modify: `nest-chatbot.js` — intro object (:2490), `playIntro` (:2492), new `replayTranscript()` beside it, `startConversation` resume branch (:2907), `addBubble` announce guard (:1553)

**Interfaces:**
- Consumes: `transcript`, `replaying`, `readStore()`, and existing `addBubble`, `renderActions`, `retireChipRows`, `showWelcome`, `endConversation`, `scrollToLatest`.
- Produces: `replayTranscript()`; `intro.ended` handoff.

- [ ] **Step 1: Extend the intro bag** (:2490):

```js
    var intro = { animDone: false, greeting: null, actions: null, settled: false, ended: false };
```

- [ ] **Step 2: Restore state in the resume branch** — in `startConversation` (:2907), inside `if (stored) {`, after `if (intro.actions === null) { intro.actions = stored.actions; }`:

```js
            // The transcript and its latches ride the same record. `ended` is
            // handed to replayTranscript via intro rather than restored here:
            // endConversation() uses `ended` as its idempotence guard and must
            // see false, or the restore would no-op and leave a live composer
            // on a dead conversation.
            if (stored.turns) {
                transcript = stored.turns;
                guestTurned = stored.guestTurned;
                intro.ended = stored.ended;
            }
```

- [ ] **Step 3: The replay branch in `playIntro`** (:2492) — insert after `introPlayed = true;`:

```js
        // A stored transcript makes this a RETURN, not an arrival: skip the
        // loader and the typing entirely — both are first-visit theatre — and
        // paint the conversation where the guest left it. readStore() twice in
        // one tick (here and in startConversation) reads the same record; the
        // empty-transcript fallback only fires if another tab cleared the
        // store between the two reads, and lands on the arrival path.
        var stored = readStore();
        if (stored && stored.turns) {
            intro.animDone = true;   // no animation armed — the join must not wait for one
            startConversation(function () {
                if (transcript.length) { replayTranscript(); }
                else { introMaybeFinish(); }
            });
            return;
        }
```

- [ ] **Step 4: `replayTranscript()`** — new function directly after `introMaybeFinish`:

```js
    /*
     * Paint a stored transcript through the SAME renderers a live payload
     * uses (the threat-model comment above readStore() is the argument for
     * why that is safe). No loader, no typing, no announcements — and
     * deliberately no replyCount: it feeds maybeAutoExpand(), and a replay
     * that counted would auto-expand the panel the instant a returning guest
     * opens it.
     */
    function replayTranscript() {
        intro.settled = true;
        els.loader.classList.add('nc-hidden');

        replaying = true;
        var greetingWrap = null;
        for (var i = 0; i < transcript.length; i++) {
            // The one-shot rule survives the replay through its one owner:
            // every send retires every chip row, so rows can be live only on
            // the FINAL turn — retire everything painted so far before it.
            // (A final guest turn carries no chips, so it needs no case.)
            if (i === transcript.length - 1) { retireChipRows(); }
            var turn = transcript[i];
            var bubble = turn.t ? addBubble(turn.r, turn.t) : null;
            if (i === 0 && turn.r === 'bot' && bubble) { greetingWrap = bubble.parentNode; }
            // A fresh per-turn url set, exactly like a live turn's.
            if (turn.a) { renderActions(turn.a, bubble, Object.create(null)); }
        }
        replaying = false;

        // A guest who read the greeting and navigated without typing has a
        // one-turn transcript: no intro animation, but the welcome block and
        // promo still render — first-contact affordances belong to a
        // conversation the guest has not yet joined. A decision, not an
        // emergent behaviour.
        if (!guestTurned && greetingWrap) { showWelcome(greetingWrap); }

        // Restored as STATE through the existing path — persistableActions()
        // stripped the element, so this is the one seam (composer closed,
        // restart button appended, chips retired, focus handled).
        if (intro.ended) { endConversation(); }

        scrollToLatest(false);
    }
```

- [ ] **Step 5: Silence the replay** — in `addBubble` (:1553), change:

```js
        if (isBot && text) { announce(text); }
```

to:

```js
        // …and never during a replay: the guest has read this history, and
        // twenty stored replies would bury the live region at every load.
        if (isBot && text && !replaying) { announce(text); }
```

- [ ] **Step 6: Verify in the browser** (mock; reset the store and the panel flags first — `localStorage.clear(); sessionStorage.clear()`):
  1. Send two turns (`book`, then a plain message), reload the page, open → both exchanges present instantly, **no** loader animation, **no** typing reveal, view scrolled to the end, welcome chips + promo **absent**, record uuid unchanged across the reload.
  2. `tenerife` turn (cards + promo + CTAs), reload → carousel, promo, buttons render identically (arrows work); the exactly-one-Book-button rule holds.
  3. `hostel` turn (island chips), then reload **without** tapping → chips on the final turn are **live**; then send anything → they retire. Now build: `hostel`, tap a chip (guest turn follows), reload → the old chip row is **absent** (retired by the replay), only final-turn rows live.
  4. `available` to completion, reload with DevTools Network open → **no** poll request fires; record has no `async_result` anywhere.
  5. `!cap`, reload → composer disabled, "Start a new chat" button present and focusable; pressing it starts a fresh conversation (record: new uuid, `turns:[greeting]`).
  6. Open, let the greeting finish, navigate away (reload), reopen → greeting only + welcome block + promo (the `!guestTurned` one-turn case), no intro animation, and the greeting text is the **stored** one.
  7. `localStorage.clear()`, reload → the full first-visit path is intact: loader animation, typed greeting, welcome chips, promo.
  8. Private window → widget fully functional, nothing persists, console clean.
  9. Screen-reader spot check (or inspect `els.announcer` mutations via MutationObserver in console): during a replay the announcer stays empty; the first live reply after the replay announces once.

- [ ] **Step 7: Commit**

```bash
git add nest-chatbot.js
git commit -m "Replay the stored transcript on return: no intro, no typing, chips one-shot, ended restored"
```

---

### Task 4: Version, changelog, CLAUDE.md — same release, same truth

**Files:**
- Modify: `nest-chatbot.js:34` (`VERSION`)
- Modify: `CHANGELOG.md` (new top entry)
- Modify: `CLAUDE.md` (two places)

- [ ] **Step 1:** `var VERSION = '2.7.0';` → `var VERSION = '2.8.0';`

- [ ] **Step 2: CHANGELOG entry** — insert under the header block, above `## 2.7.0`, in the established narrative style (lede states the guest-visible change + version reasoning; bullets carry the why; a "Verified in-browser" close). Skeleton to fill with **actual** verification results from Tasks 2–3:

```markdown
## 2.8.0 — 2026-08-18

**The conversation now survives a page change.** The store record grows a display-only
transcript (`turns`, plus the `guestTurned` and `ended` latches), and a returning guest inside
the 24h idle window lands where they left off: no intro replay, no lost server greeting, no
welcome block re-rendered over a live conversation. New stored surface and a new UI behaviour,
hence minor. No transport change — the turn body is still `{message, locale}` and the transcript
never enters a request — no contract change, `BUILT_AGAINST` stays **1.6.1**.

- **Persisted on payload arrival, not on settle.** …
- **The paint-only rule.** `async_result` and `conversation_ended` are stripped at persist time…
- **A 410/404 re-init carries the transcript across**, with `n` nulled…
- **`n` is stored unused** — a future `?since={turn}` reconciliation endpoint becomes a drop-in…
- **`ts` now means last activity**, which is what the server's `idle_hours` always measured —
  fixes the latent divergence where a guest chatting past hour 24 was reset client-side…
- **Bounds: 40 turns / 64K chars**, oldest first, payload before text, never the newest turn…
- **Accepted:** two tabs are last-write-wins on the record (server transcript unharmed); a reply
  finishing after the tab closes is not in the store (the Phase 2 tail gap).

**Verified in-browser** (mock, fresh + returning + private window): …
```

- [ ] **Step 3: CLAUDE.md — the architecture table's `storage` row.** Replace:

> `{uuid, ts, actions}` in `localStorage`, 24h idle window — the init `actions[]` ride along so a resume can replay the site's welcome elements

with:

> `{uuid, ts, actions, turns, guestTurned, ended}` in `localStorage`, 24h idle window — the init `actions[]` and the display-only transcript ride along so a resume replays the conversation, not just the welcome; `ts` is last activity

- [ ] **Step 4: CLAUDE.md — narrow the "Do not send chat history" bullet.** Replace its last sentence ("An earlier version of this widget accumulated a `chatHistory` array and never sent it; do not resurrect it.") with:

> The widget keeps a **display-only** transcript copy in `localStorage` (since 2.8.0) so a
> returning guest sees their conversation — it must never enter a request body. An earlier
> version accumulated a `chatHistory` array with no purpose at all; the stored transcript is
> not that: it exists to be replayed, never to be sent.

- [ ] **Step 5: Commit**

```bash
git add nest-chatbot.js CHANGELOG.md CLAUDE.md
git commit -m "Release 2.8.0: the conversation survives a page change"
```

---

### Task 5: Full verification matrix and report

Browser, mock-first (`demo/index.html` on :5501), Playwright MCP optional for the DOM checks. **Report anything not verified rather than assuming it works** — items 11–12 in particular.

- [ ] 1. Two turns → navigate → reopen: both present, no intro animation, scrolled to end, welcome chips/promo absent.
- [ ] 2. Record uuid unchanged across that reload (DevTools → Application). *Real-backend only, if available:* "what did I just ask you?" answered correctly (mock cannot).
- [ ] 3. `property_cards` / `promo_card` / `link_button` turn survives reload rendered identically; stale chip rows come back retired (absent), final-turn rows live.
- [ ] 4. `async_result` to completion → reload → **no poll request** in the Network tab; no `async_result` in any stored `a`.
- [ ] 5. `!410` mid-conversation → guest message not orphaned; reload shows the full exchange; carried turns have `n: null`; new uuid.
- [ ] 6. `!cap` → reload → composer closed, restart present; restart works and resets the record.
- [ ] 7. `localStorage.clear()` → full first-visit path (loader, typed greeting, welcome chips, promo).
- [ ] 8. Record shape in DevTools: `turns` with `n` values, `guestTurned`, `ended`.
- [ ] 9. Private window: fully functional, console clean.
- [ ] 10. Quota distinct from private mode: fill the origin's storage (loop `localStorage.setItem('x'+i, 'y'.repeat(1e6))` until throw), then send a turn → uuid intact (fallback record written or old record preserved), widget functional.
- [ ] 11. Announcer: replay silent, first live reply announces (MutationObserver on `.nc-announcer` or a screen reader).
- [ ] 12. Cross-origin host page (second static server, page pointing its `src` at :5501) — the realistic embed — replay works identically.
- [ ] Final: `git log --oneline` shows the task commits; working tree clean.

---

## Deliberately unchanged (verify, don't re-add)

`clearStore()` call sites (:3058, :3135) stay; the 24h `ts` check stays; `chatEpoch` guards stay; every renderer stays; `BUILT_AGAINST` stays `'1.6.1'` (the server's 1.6.2 drift warning is known, separate, and **not** folded in — mention in the final report only); no `xhr.timeout`; no new listeners outside `#nest-chatbot`; the panel-size flags; the teaser.

## Self-review (done during planning)

- Spec coverage: all 7 touch points + both settled decisions + all 3 consequences mapped to Tasks 1–3; docs to Task 4; every verification item from both source plans lands in Task 2/3/5.
- Type consistency: `persist()` no-args everywhere; `persistableActions(actions)→array|null` consumed in Task 2 steps 2–3; entry shape `{r,t,a,n}` identical across Tasks 1–3; `intro.ended` produced in Task 3 step 2, consumed in step 4.
- No placeholders: the CHANGELOG skeleton's `…` are execution-time fill-ins of *measured results*, flagged as such — the one deliberate exception.
