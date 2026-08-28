# Measuring the widget — the `wchat:` event surface, and what it still cannot answer

**From:** the Nest Chatbot drop-in widget (`nest-chatbot.js`), release 2.8.2, 2026-08-19.
**For:** whoever asks "how is the chatbot actually being used?" — and, in the last section
only, the wSuite platform team.

Two documents cover this surface and they are not the same thing. **`README.md` § Measuring it
is the host-facing reference**: the event names, their payloads, the GA4 snippet. **This
document is the design record**: why route A won, what each event can and cannot answer, and
what remains impossible from this repo at any effort. Read README to integrate; read this
before changing the shape of it.

## Status

Shipped in **2.8.2** as a patch — additive, no `data-*` attribute, nothing new for a host's
`<script>` tag to say. `BUILT_AGAINST` was `1.6.1` at that release and no transport changed;
the packet has since moved to **1.6.2** in `2.9.0` (D-047, an emission rule), to **1.7.0**
in `2.10.0` (D-050), to **1.9.0** in `2.11.0` (D-067, D-071, 2026-08-27) and to **1.10.0** in
`2.12.0` (D-072, D-073, 2026-08-28) — none of which
changes the event surface: no name moved, no payload lost a field. 1.10.0 is worth a line here
because it looked like it might: a booking turn may now carry a `property_cards` beside its
`availability`, so `wchat:reply.elements` can list the pair, and the Book button the dedupe
suppresses emits nothing — the information turn's existing behaviour, not a new rule. One payload *value* changed
shape: since 1.9.0 `wchat:action.url` carries the server-composed booking url, language
segment and stay query string included, exactly as the anchor's `href`.

**The upstream ask at the foot of this document was sent, and granted.** `idle_hours` landed in
contract 1.7.0 and the widget adopted it in 2.10.0, which changes one thing described here for
the better: see [What route A cannot answer](#what-route-a-cannot-answer-at-any-idle-window-length).

---

## The question, and the finding that reframed it

Nest wanted to know how the chatbot is used, starting with **returning guests vs new ones**.

The finding that decided the design: **the server cannot tell, and the guide says why.**

- **Init accepts exactly two optional fields**, `locale` and `property`
  (`docs/wsuite/integration-guide.md` §3.1). There is nowhere to put a visitor identity, and
  the site/tenant always come from the key, never the body.
- **The only per-visitor signal on the platform is key + client IP** (§6). The guide is
  explicit that the embed key is "public and identical for every visitor", so key + IP is "the
  only visitor signal available at throttle time".
- **That signal collapses exactly our population.** §6 names corporate NAT, "a hotel's own
  wifi", carrier CGNAT and proxies as sharing **one** bucket. A hostel's guests are mostly on
  the property's wifi. It is a rate-limiting device, not an identity.
- **A `410` re-init creates an unrelated conversation.** The new uuid has no link to the old.

So the platform sees **conversations, not people**. Anything that counts people has to start
where the person is: the browser — which already knew the answer and had no way to say it.

## The three routes

### A — emit events to the host page. **Chosen.**

The only route shippable from this repo alone, and the only one with no new privacy surface:
the widget stores nothing new and sends nothing new. Nest's sites already run analytics, so
the destination already exists.

### B — an opaque visitor token at init. **Deferred, and replaced by a smaller ask.**

The only route that answers "came back next week", "same person, different device", or that
puts the answer in wSuite's own panel rather than in each host's GA4.

It is deferred because **the returning-guest ceiling is the idle window, and the window has now
moved**. That was written when `IDLE_MS` was a hardcoded 24h and the widening was a plan; since
2.10.0 the widget reads the window from the init response instead of guessing, and the deploy has
landed — measured 2026-08-23 20:56 UTC the live init `201` reports `contract_version: 1.7.0` and
`idle_hours: 168`, **seven days**. So "came back next week" *is* answerable from route A today,
without building anything, which is what the deferral was waiting on. Building a cross-session
identifier to answer a question route A already answers is the wrong order. The thing to chase is
no longer the deploy: it is whether a real question **survives** a week-long window, because that
is the only kind that now justifies a cross-session identifier. Do not re-derive the window from
`nest-mind`'s env — read it off a `201`; this section has been wrong in both directions by
reasoning from config instead of measuring.

It also carries a real decision that should be made deliberately rather than discovered at
review: a persistent visitor id is **categorically different** from a conversation uuid that
expires with the server's idle window — a week today, and a number that moves. It
is a cross-session identifier for a person, on properties in the EU, and needs consent
treatment and a retention policy before it can ship. The widget's storage today is functional
and short-lived, which is much of why it has been uncontroversial.

### C — infer server-side from IP + user-agent. **Rejected.**

§6's NAT warning kills it for our population specifically: guests share the property wifi, so
it merges strangers and splits one guest across their phone and the lobby machine. Recorded
here so it is not re-proposed.

## The hard constraint

**The widget never phones home.** No analytics request of its own — not to Nest, not to a third
party, not a beacon, not an image pixel. A host trusts exactly one extra origin, ours, and only
for our own assets: the same reasoning that keeps icons inline and fonts self-hosted. Events go
to the host page; the host decides where they land. **A route that needs its own network call
is out of scope for this repo by construction.**

A host that listens to nothing pays nothing, which is why there is deliberately no `data-*`
attribute to disable it.

---

## The event surface

Eleven names. Every `emit()` dispatches **twice** — `wchat:<name>` and a bare `wchat` carrying
the same detail plus `name` — so a host who wires the umbrella once keeps receiving events
added in later releases without editing their page. Every payload also carries `name`.

Dispatched from `els.root`, never `window`: events bubble, so a host listener on `window` or
`document` hears them either way, and the widget still touches no node it does not own.

| Event | Emitted in | Payload (besides `name`) | Answers | Cannot answer |
|---|---|---|---|---|
| `wchat:ready` | `boot()` | `version`, `locale`, `mock`, `returning`, `storedTurns`, `expanded` | the denominator; **how many arrivals are returning guests** | whether they ever open it |
| `wchat:open` | `open()`, after `playIntro()` | `source`, `firstOpen`, `resumed`, `turns` | open rate; **whether the teaser converts** (`source:'teaser'`) | why they opened |
| `wchat:close` | `close()` | `source`, `turns` | dwell time, paired with `open`; **whether the guest was leaving the page or putting the chat away** (`source:'back'` vs `'close'`) | whether they got what they came for |
| `wchat:message` | `sendGuestText()` | `source`, `length`, `turns`, `locale` | **engagement** — read-only vs typed; whether the prompt pills and server chips earn their space | what they asked |
| `wchat:reply` | `sendMessage()` 200; again on poll resolution | `turn`, `length`, `elements[]`, `async`, `resolved`, `ended`, `latencyMs` | **how slow the bot is**; which element types actually reach guests | reply quality; whether it was right |
| `wchat:action` | delegated click in `els.body` | `element`, `url`, `channel`, `style`, `index` | **the conversion** — which Book / WhatsApp / card was clicked | whether the booking completed |
| `wchat:error` | every non-200 branch | `phase`, `status`, `retrying` | **429s on shared hostel wifi**, 403 origin refusals, transport failures — all invisible before this | why the server failed |
| `wchat:ended` | `endConversation()` | `turns` | how often the turn cap bites | whether the guest minded |
| `wchat:restart` | `restartConversation()` | `source`, `turns` | whether "start a new chat" is used, and **whether it was chosen or forced** (`source`) | why they wanted a fresh thread |
| `wchat:locale` | `setLocale()` | `from`, `to` | **whether the language switcher earns its space** | whether detection would have got it right |
| `wchat:teaser` | `showTeaser()`, `dismissTeaserForever()` | `action` | whether the teaser earns its 8 seconds | — |

`source` enums: `open` — `toggler` \| `teaser` \| `auto` \| `api`. `close` — `toggler` \|
`close` \| `escape` \| `back` \| `api` (`back` added in 2.10.3 with the device Back button;
additive, so a patch). `message` — `composer` \| `prompt` \| `chip` \| `welcome-chip`.
`restart` — `menu` \| `ended` (added in 2.10.2 with the header menu; additive, so a patch).
There is deliberately no `api` in that last one: nothing on `window.NestChatbot` restarts a
conversation, so the enum's fallback is `ended` — the one listener a bare function reference
could ever regress.

**`close` now carries one source the others cannot substitute for.** `'back'` is the only value
that also says *the guest reached for the control that leaves the page* — they pressed Back, and
the widget spent that press on the panel instead of the navigation. `'close'` and `'escape'` are
a guest putting the chat away while staying put. Summed they are all dismissals; read apart, a
rise in `'back'` is a fact about that page's exit pressure rather than about the chat. It is also
the one close source that is **not** evidence the guest was finished — which is worth knowing
before it is used as a proxy for satisfaction.

### Seven decisions inside that table

- **`returning` and `resumed` are two facts, not one.** `ready.returning` comes from its own
  `readStore()` at boot, so it is true for a guest who never opens the panel — which is the
  denominator the original question was really about. `resumed` is latched inside
  `playIntro()`'s replay branch, so it reports the branch **actually taken** and cannot
  disagree with what the guest saw. Collapsing them loses the denominator; deriving `returning`
  from `playIntro()` alone would only ever count guests who opened the panel.
- **Payloads are counts, enums and booleans. Never guest text, never reply text.** `length` is
  a character count; `elements[]` lists element *types*, unknown ones included on purpose — a
  type this widget silently ignores is exactly what a host wants to see when the server ships
  ahead of the widget.
- **Element urls are the one string that travels**, and `contact_channels` is excluded even
  from that. A booking url is a server-supplied href the guest is navigating to and is already
  in the DOM; a `tel:`/`mailto:` href **is** the property's phone number or email, and putting
  that in a host's analytics buys nothing — `channel` says which was used instead.
- **`wchat:reply` fires twice for an async turn**, truthfully: the guest saw two answers land.
  `resolved` separates them, and the resolved one's `latencyMs` is the full poll wait, which is
  the number worth having for gated booking turns.
- **`wchat:error` with `retrying: true` is not a guest-visible failure.** The `410`/`404`
  re-init is normal. A *spike* in it is the signal that the server extended its idle window and
  `IDLE_MS` did not follow — see the ask below. Transient poll `404`s during backoff emit
  nothing: that is the backoff working, and reporting each would drown the real errors.
- **The `403` fires before `teardown()`.** `emit()` is a no-op once the widget is removed, so
  the order is load-bearing: otherwise the single error a host most needs — a revoked key or an
  unregistered origin (guide §7) — would be the one they never see.
- **`wchat:ended` arrives before its turn's `wchat:reply`.** The reply event is emitted last so
  it can report `ended: true` accurately, which is the more useful of the two orderings.

### Naming is the expensive part

Adding an event is a **patch**; renaming or removing one is a **major**, exactly like a
runtime-API method — a host writes listeners against these names. The list was settled before
the first one shipped, and the umbrella event is what makes "add event #12" free for a host who
wired one listener.

**The namespace is `wchat:`, not `nest-chatbot:`, deliberately.** The widget should be able to
go vendor-neutral one day; these events were new surface, so they took the destination name for
free. `window.NestChatbot`, `#nest-chatbot`, the `nc-` prefix, `STORE_KEY` and the file names
did **not** move — that is a 3.0.0 with real host cost, and CLAUDE.md § Open items records what
it has to carry (including a read-old/write-new `STORE_KEY` so no guest loses a conversation
to it).

### Rejected: `NestChatbot.on()` / `off()`

A second subscription mechanism to maintain, plus a registry `teardown()` would have to clear.
DOM events plus `NestChatbot.state` cover the same ground. `state` exists for the case the
events cannot serve: a host whose analytics loaded after boot and missed `wchat:ready`.

### The trap worth remembering

`open()`, `close()` and `toggle()` take a `source`, and `addEventListener` hands its handler a
`MouseEvent` as the first argument — as does a host writing
`btn.addEventListener('click', NestChatbot.open)`. Passed bare, every source would report as an
object while everything on screen kept working. Three `wire()` listeners and three
`window.NestChatbot` methods are therefore **wrapped**, and `oneOf()` validates against the
enum regardless. Any future function that takes a parameter *and* is used as a listener has the
same hazard.

---

## What route A cannot answer, at any idle-window length

Recorded so it is not rediscovered as a surprise:

- **Cross-device.** A guest who browses on their phone and books on the lobby machine is two
  visitors, permanently.
- **Cleared storage and private mode.** Invisible by design.
- **Anything inside wSuite's own panel.** Route A's data lands in each host's GA4. Nest reads
  it there, not in the chatbot admin. **If having the answer inside wSuite is the actual
  requirement, no amount of route A gets there** and route B becomes the only option — this is
  the question to settle before the ask below is sent.
- **Consent-gated guests.** The events fire regardless, but a host CMP that blocks GA4 before
  consent records nothing. The numbers are "consented guests", not all guests.
- **Anything after the window expires** — but the window is no longer this widget's guess.
  Since 2.10.0 it comes from the init `201` (`idle_hours`) and rides the stored record, so
  `ready.returning` automatically sees as far back as the deployment allows. That is 24h while
  the server is pre-1.7.0, and the configured seven days once it is deployed — at which point
  it covers most of what route B was wanted for.

---

## The ask upstream

**For: the wSuite platform team.** Item 1 was sent, granted and adopted — it is kept here as
the record of what was asked and why, not as a live request. Item 2 remains deliberately
unasked; the reasoning under it is why.

### 1. `idle_hours` in the init `201` — **SENT, AND GRANTED**

Delivered as **D-050(a)** in contract 1.7.0 and adopted in widget **2.10.0**, in the shape asked
for below: a duration rather than an `expires_at` instant (the expiry advances every turn while
init fires once), optional, absence normal. One thing the ask did not foresee and the adoption
had to solve: reading it at init is **not enough**, because the resume path never calls init —
so the window is persisted into the stored record and restored on resume. The section below is
kept as the reasoning it was granted on.

*(as written)*

The widget's `IDLE_MS` is a hardcoded 24h whose comment says it "mirrors the API's conversation
idle window". The contract has no field to drive it — `grep -rn "idle_hours" docs/wsuite/`
returns nothing, and §3.1's `201` is `{conversation:{uuid}, greeting, actions,
contract_version}`.

The window is planned to move to a week or more. **The day the server moves and this constant
does not, a guest returning at hour 30 loses their transcript on screen and opens a second
conversation — while the server's original is still live, still holding the working memory
`data-property` seeded.** The widget would look fine and answer as a stranger.

The field costs no privacy, makes the widget's window self-correcting forever rather than a
constant needing a coordinated release, and as a side effect stretches how far back
`wchat:ready`'s `returning` can see. Bundle it with the request already open (the element-level
`heading` on `quick_replies`, `response-contract-phase2-elements.md` open point 9). Precedent
is good: contract 1.6.0 exists because of this widget's own conformance report.

Design it so absence is normal — the widget must keep working against a server that never sends
it.

### 2. An opaque visitor token at init — **still not requested, and now less needed**

The shape would be: the widget generates a random token, stores it, sends it at init; the
platform correlates conversations by it. It is the only route to cross-device, to "came back
after the window", and to the answer living in wSuite's panel.

It is not being requested because (a) extending the idle window answers most of the same
question for free and should land first, and (b) it carries the consent and retention decision
described under route B above, which belongs in the ask rather than in a review comment. If it
is ever built, the field must be **optional** and the platform must tolerate its absence — a
guest who clears storage, or a consent refusal, must not break init.
