# Message timestamps — nothing in the guest API records when a message happened

**From:** the Nest Chatbot drop-in widget (`nest-chatbot.js`), release 2.8.2, 2026-08-19.
**For:** the wSuite platform team, and whoever next touches the widget's dating of history.

Widget 2.8.1 shipped day separators in the transcript, and had to invent a clock to do it. This
is a design record as much as a request: it states exactly what the widget now does so the two
implementations can be diffed rather than guessed at, and it asks for the smallest thing that
would make those dates authoritative rather than merely plausible.

**Nothing here blocks anything and nothing here is urgent.** The widget works today and
degrades safely; adopting any of this would be a feature we may take, never a migration we must
perform. It is filed now because the reasoning is cheap to write while it is fresh and
expensive to reconstruct later.

## Status

**The ask was granted.** Contract **1.7.0** (D-050(b)) added `server_time` to the init `201`,
and the widget adopted it in **2.10.0**: `serverOffset = Date.parse(server_time) - Date.now()`,
computed once per conversation, persisted with the record because the resume path never calls
init, and applied through `nowMs()` to everything that becomes a date. **This document is now
the design record for what the widget does**, not a request — with two things below still
correctly open.

**What `server_time` fixed:** device-clock *skew*. A phone whose clock is days out now dates its
own transcript by the server's instant rather than its own.

**What it did not, and what is still true below:** the **timezone** case — a guest who changes
zone between visits still sees their days recomputed, because `dayKey()` deliberately takes
local midnight in the *device's* zone and `server_time` corrects the instant, never the zone —
and the absence of a **per-turn** timestamp, which is still not asked for and still not needed
at day granularity. Do **not** ask for a top-level `created_at`: contract §Envelope states the
three top-level keys are the whole surface and always will be.

Current release **2.11.0**; the surface described here landed in **2.8.1** and was corrected in
**2.10.0**. `BUILT_AGAINST` is **1.9.0**, and **no transport changed** — the turn body is still
`{message, locale}` and init is still `{locale, property}`. The widget's stored transcript is
display-only, lives in `localStorage`, and never enters a request body.

## The gap — half of it closed in 1.7.0

**As it stood through 1.6.2:** there was **no time field anywhere in the guest API surface** —
not on the turn envelope, not on an element, not on the init response. `timestamp`,
`created_at`, `sent_at` and `server_time` each returned zero matches across the vendored packet
(re-run at the 2.9.0 sync — D-047 added no time field).

**Since 1.7.0** the init `201` carries **`server_time`**
([`integration-guide.md`](../wsuite/integration-guide.md) §3.1). The **turn** envelope still
carries none, and `created_at` / `sent_at` / `timestamp` still return zero matches: what a
consumer gets is one instant per *conversation*, not per *message*. Everything below about what
that leaves unanswered is still current.

The nearest thing is `turn`, the 1-based exchange number — an **order**, not an instant. It
says turn 4 came after turn 3, and nothing about whether an hour or a week passed between them.

This was invisible until 2.8.0. Before it the widget painted a fresh greeting on every page
load, and there was never a transcript old enough for the question to arise. Since 2.8.0 a
returning guest inside the idle window has their conversation replayed — which is when "when
did this happen" became something the widget has to answer and cannot.

## What 2.8.1 does instead

Each stored entry carries `at`: epoch milliseconds, stamped **client-side**, when the entry is
created (the guest's turn as it is sent; a reply on payload arrival). The transcript paints a
centred day separator whenever the calendar day changes between two entries, and every message
bubble carries its full date and time as a `title`.

Two consequences the widget accepts, written into its own source so the next reader does not
have to rediscover them:

- **A replay shows the *sending* browser's clock**, with whatever skew that device carries.
- **A guest who changes timezone between visits** sees the days recomputed in the new zone, so
  a conversation can read as having happened on a different date than it did.

**Day granularity is what makes that acceptable.** Minutes of skew never move a date; only a
timezone hop does, and only for entries near a midnight boundary. It is also why the widget
shows **no per-message clock** — an `HH:MM` under every bubble would claim a precision this
data cannot support. The `title` is deliberately supplementary: unreachable on touch,
inconsistently announced, never the only channel for anything.

## What we are *not* asking for

**A top-level `created_at` on the turn envelope.** The contract is explicit, and we read it:

> These three keys are the **whole** top-level surface and always will be — additive growth
> happens inside `actions[]` via the extension rule, never here.

`reply` / `actions` / `turn` stay frozen. Both requests below are shaped to respect that.

## Requested — and granted

All three asks went upstream together, as one bundle of additive init-response changes, and all
three came back in **contract 1.7.0** (D-050), adopted here in **2.10.0**:

| Ask | Written up in | Outcome |
|---|---|---|
| `idle_hours` in the init `201` | [`visitor-measurement-and-events.md`](visitor-measurement-and-events.md) § The ask upstream | **Delivered** — D-050(a) |
| An element-level `heading` on `quick_replies` | [`response-contract-phase2-elements.md`](response-contract-phase2-elements.md) open point 9 | **Delivered** — D-050(c) |
| `server_time` in the init `201` | this document, below | **Delivered** — D-050(b) |

Bundling worked exactly as intended: one decision instead of three, one contract release
instead of three, one sync instead of three. Worth repeating next time.

The section below is left as written — it is the reasoning the ask was granted on, and the
shape it was granted in.

### 1. `server_time` on the **init** response — the cheap one

The conversation-start endpoint is explicitly *"unaffected by this envelope"*, is not declared
frozen, and has grown fields before (`actions` in 1.5.0, `contract_version` earlier):

```
POST /api/v1/chatbot/conversations
  → {conversation:{uuid}, greeting, actions?, contract_version, server_time?}
```

One value — epoch ms or ISO-8601, whichever is more natural server-side — at conversation
start. The widget computes a server-to-client offset once and applies it to the stamps it
already writes, which removes **device-clock skew** as an error source for every entry in that
conversation. It does not address the timezone case and does not need to: rendering in the
guest's *current* zone is arguably right anyway.

MINOR by the contract's own versioning policy — additive, optional, backwards-compatible. As
with `idle_hours`, **design it so absence is normal**: the widget must keep working unchanged
against a server that never sends it.

### 2. Per-turn timestamps in a `?since={turn}` endpoint, **whenever one is built**

No such endpoint exists upstream — `grep -rn "since=" docs/wsuite/` returns nothing. It is our
own hypothetical, and the widget already stores the server's `turn` number **unused** against
it, so that reconciliation would be a drop-in with no stored-data migration.

Recording the requirement now so it is designed in rather than bolted on: **turns arriving from
the server would carry no local stamp at all.** The widget can only stamp what it painted
itself, so server-sourced history would be *less* dateable than today's locally-stamped
history — a regression hiding inside a feature. A new endpoint is a new response shape and the
frozen envelope does not constrain it, so a per-turn time there costs nothing in contract terms.

## Considered and rejected: a timestamp element inside `actions[]`

The extension rule makes this the one envelope-legal route to a per-turn server time, and it is
the wrong shape. `actions[]` is a list of **renderable elements**; a timestamp is metadata about
the turn, not something to paint. On our side it would also need an explicit exclusion in the
widget's paint-only persist rule, joining `async_result` and `conversation_ended` as an element
whose renderer is not a renderer. Recorded so it is not proposed back to us as the obvious
solution.

## Why the grown idle window sharpens this

**No longer a forecast — the window is live.** The mechanism was built in 2.10.0 (the widget
follows `idle_hours` instead of a 24h constant) and the deploy has now landed: measured
2026-08-23 20:56 UTC the live init `201` reports `contract_version: 1.7.0` and `idle_hours: 168`,
**seven days**. Do not read a live window off `nest-mind`'s env — that is the local repo's
config, an earlier revision of this very section did exactly that, and the correction that
replaced it was itself wrong within a day when the deploy landed. The `201` is the evidence;
re-measure rather than re-reason.

At 24h, client-side dating was close to unfalsifiable: a transcript spans at most two calendar
days, the guest is almost certainly in the timezone they started in, and Today/Yesterday is
right essentially always. At a week — where the widget now sits — the same code dates history
across several days for a traveller, which is precisely who our guests are, moving between
islands and occasionally between zones. The error stopped being theoretical at exactly the point
the window made the feature matter most, and that point has now passed rather than approaching.

That was the argument for `server_time` riding along with `idle_hours` rather than being a
second errand, and it is how it shipped: contract 1.7.0 carried both, and widget 2.10.0 adopted
both in the same release — including persisting both into the stored record, because the resume
path never calls init and would otherwise have neither.
