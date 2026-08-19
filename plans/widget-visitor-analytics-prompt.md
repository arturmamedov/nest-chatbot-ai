> **Written 2026-08-19, against widget `2.8.0` / `BUILT_AGAINST` `1.6.1`.** This is a
> **design question first and an implementation second** — the honest answer may be "route A,
> six events" or "this belongs upstream, not here". Do not start writing code. Line numbers
> are from 2.8.0 and will drift; the function names are the durable reference.

# Task — how do we measure this? Returning guests, and what else the widget can honestly report

## Where you are

`nest-chatbot-ai` is Nest Hostels' branded guest chat widget: one drop-in `<script>` tag that
gives a host website the Germán bubble, talking to the wSuite chatbot API. Vanilla JS, **no
build step, no dependencies** — `nest-chatbot.js` is a single classic-script IIFE shipped
exactly as written. It is an external, separately-versioned **consumer** of the wSuite chatbot
public API; the platform lives in another repo and its contract is vendored here, read-only,
at `docs/wsuite/`.

**Read `CLAUDE.md` first, all of it**, and `docs/wsuite/integration-guide.md` §3.1 and §6.

## The question

Nest wants to know how the chatbot is actually being used — starting with **returning guests
vs new ones**, and then whatever else the widget can report without inventing data.

## The finding that reframes it: the server cannot tell today

Do not design on the assumption that wSuite's own panel can answer this. It cannot, and the
guide says why:

- **Init accepts exactly two optional fields**, `locale` and `property`
  (`docs/wsuite/integration-guide.md` §3.1). There is nowhere to put a visitor identity, and
  the site/tenant always come from the key, never the body.
- **The only per-visitor signal on the platform is key + client IP** (§6). The guide states it
  plainly: the embed key is "public and identical for every visitor", so key + IP is "the only
  visitor signal available at throttle time".
- **That signal collapses exactly our guests.** §6 calls out corporate NAT, "a hotel's own
  wifi", carrier CGNAT and proxies as sharing **one** bucket — and a hostel's guests are mostly
  on the property's wifi. It is a rate-limiting device, not an identity.
- **A `410` re-init creates an unrelated conversation.** Conversations idle out after 24h and
  the widget re-inits transparently; the new uuid has no link to the old one.

So the platform sees **conversations, not people**. Anything that counts people has to start
where the person actually is: the browser.

## What the widget already knows — the returning-guest signal exists

None of this needs new state. It is all already computed:

| Signal | Where | Meaning |
|---|---|---|
| **the replay branch** | `playIntro()`, `nest-chatbot.js:2654-2662` | `stored && stored.turns` → skip the loader and the typing, repaint the conversation. **This branch *is* "returning guest with a live conversation".** |
| `FLAG_OPENED` | `sessionStorage`, `nest-chatbot.js:512` | the panel has been opened this tab session |
| `FLAG_TEASER_DISMISSED` | `localStorage`, `nest-chatbot.js:514` | the guest dismissed the teaser, ever |
| `guestTurned` | the store record | the guest actually typed, vs only read the greeting |
| `ended` | the store record | the turn cap was reached |
| turn count | `transcript.length`, and each bot entry's `n` | conversation depth |
| `locale` | config / the language switcher | which language, and whether they switched mid-conversation |
| the panel-size flags | `nest-chatbot:expanded`, `:user-shrank`, `:auto-expanded` | see CLAUDE.md — two of these outlive the tab and one is never cleared |

Note the ceiling on all of it: a returning guest is only detectable **inside the 24h idle
window**, because that is how long the record lives. "Came back next week" is not answerable
without new persistent state — which is route B's whole point, and route B's whole problem.

## Three routes — weigh them, recommend one

### A — emit events to the host page

The only route shippable from this repo alone. The widget dispatches a small set of named
events; the host's existing GA4 / Plausible / Matomo picks them up and decides what to keep.
Nest's own sites already run analytics, so the destination exists.

Points to settle:

- **Dispatch from the widget's own root, not from `window`.** Events bubble, so a host
  listener on `window` hears them either way, while the widget never touches a node it does not
  own (CLAUDE.md: never touch the host's `<body>` or anything outside `#nest-chatbot`). It also
  keeps `teardown()`'s claim true — that claim is about *listeners*, and dispatching adds none,
  but the boundary is the point.
- **Naming is a commitment.** This is new public surface: a host writes listeners against these
  names. Under CLAUDE.md's versioning rule, adding events is a **patch**; renaming or removing
  one later is a **major**. Choose names you can live with, and document them in `README.md`
  beside the `window.NestChatbot` runtime API.
- **Payload: counts and booleans only. Never message text**, never the reply, never anything a
  guest typed. The transcript is display-only and stays that way.
- **`destroy()` must stop emitting**, and nothing may emit before the widget has booted.
- Consider whether the same events should be readable as state on `window.NestChatbot` for a
  host that missed the event — cheap, and it makes the surface testable from the console.

### B — an upstream contract ask: an opaque visitor token at init

The widget generates a random token, stores it, and sends it in the init body; the platform
correlates conversations by it. This is the only route that answers "came back next week" and
the only one that puts the answer in wSuite's own panel rather than in each host's analytics.

- It is a **contract change**, so it is a request to the platform repo, not work in this one.
  Bundle it with the request already open (the element-level `heading` on `quick_replies` —
  CLAUDE.md § Open items, `docs/proposals/response-contract-phase2-elements.md` open point 9).
  Precedent is good: contract 1.6.0 exists because of this widget's own conformance report.
- **It carries a real privacy decision.** A persistent visitor id is a categorically different
  thing from a 24h conversation uuid: it is a cross-session identifier for a person, on
  properties in the EU, and may need consent treatment and a retention policy before it can
  ship. Say this out loud in the ask rather than letting it be discovered at review. Note that
  the widget's own storage today is functional and short-lived, which is part of why it has
  been uncontroversial.
- If it ships, the widget's side is small: generate, store, send. Design the ask so the field
  is **optional** and the platform tolerates its absence — a guest who clears storage, or a
  consent refusal, must not break init.

### C — infer server-side from IP + user-agent

Weak on its own, and the guide's NAT warning kills it for exactly our population: a hostel's
guests share the property wifi, so IP + UA merges strangers and splits one guest across their
phone and the lobby machine. Record why it was rejected; do not spend time on it.

## The hard constraint, whichever route wins

**The widget must never phone home.** No analytics request of its own, ever — not to a Nest
endpoint, not to a third party, not a beacon, not an image pixel. A host should have to trust
exactly one extra origin: ours, and only for the widget's own assets (CLAUDE.md rule 1, and the
same reasoning that keeps icons inline and fonts self-hosted). Events go to the host page; the
host decides where they land. A route that needs its own network call is out of scope for this
repo by construction.

Two more, from the same file: no third-party script, and nothing that makes the host page's job
harder.

## What to produce

A short written recommendation, not an implementation:

1. Which route, and why — with C explicitly dismissed and B's privacy question stated.
2. If A: the exact event list with payloads, the naming scheme, and where they are emitted
   (name the functions). Flag which questions each event answers and which it cannot.
3. What remains unanswerable in this repo and therefore belongs in the B ask.
4. The version impact — additive events are a **patch** under CLAUDE.md § Conventions; the
   naming commitment is the part that is expensive to change.

Then stop and get the recommendation agreed before writing code.

## Verification, once something is built

- The demo page (`demo/index.html`, `data-mock="true"`) is the harness: attach a console
  listener and drive a full conversation, a reload-and-return, a teaser dismissal, a language
  switch and a `!cap` turn cap from the mock's fixture table (CLAUDE.md § Local development).
- **Test the return path deliberately**: reload with a stored transcript and confirm the
  returning-guest signal fires exactly once and matches the replay branch actually taken.
- Confirm nothing emits after `destroy()`, and that no event carries guest or reply text.
- Confirm the network tab shows **no request the widget did not already make** — that is the
  hard constraint, and it is one glance.
- The demo page's own appearance must not change, and `node --check nest-chatbot.js`.
