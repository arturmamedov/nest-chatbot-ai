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
in `2.10.0` (D-050), to **1.9.0** in `2.11.0` (D-067, D-071, 2026-08-27), to **1.10.0** in
`2.12.0` (D-072, D-073, 2026-08-28), to **1.12.0** in `2.13.0` (D-078, D-079, 2026-09-15;
`wchat:error` gained `retryAfter`), to **1.14.0** in `2.13.1` (D-083, D-084, 2026-09-23), to
**1.15.0** in `2.13.2` (D-090, 2026-10-07), to **1.15.1** in `2.13.3` (D-106, 2026-10-23) and to
**1.16.1** in `2.13.4` (D-109, D-111, D-112, D-114, 2026-10-27; `wchat:action` gained `cta`,
`wchat:message` gained the `source` value `form`) — none of which changes the event surface: no
name moved, no payload lost a field. 1.10.0 is
worth a line here because it looked like it might: a booking turn may now carry a
`property_cards` beside its `availability`, so `wchat:reply.elements` can list the pair, and the
Book button the dedupe suppresses emits nothing — the information turn's existing behaviour, not a
new rule. One payload *value* changed shape: since 1.9.0 `wchat:action.url` carries the
server-composed booking url, language segment and stay query string included, exactly as the
anchor's `href`. 2.13.1 changed no payload but moved two things under it: `wchat:locale` keeps
its name and `{from, to}` and now fires only for a host's `setLocale()` — the on-screen switcher
is gone — and the WhatsApp and email links, which since 1.14.0 can carry the guest's pre-written
message, keep `url: null`, so that message never reaches a `wchat:*` event. It does sit in the
anchor's `href`, where a host's own link-click tracking can read it; README § Measuring it tells
hosts to exclude those links. 2.13.4 added two things, both additive. `wchat:action.cta` names
**which** button was clicked in the platform's own click vocabulary (guide §3.4) — `book`,
`website`, `directions`, `more`, `promo`, `phone`, `whatsapp`, `email`, or `null` for a
`link_button` with no `id` or one the widget does not know — every `link_button` from a server
before 1.16.0, the deployment's 1.15.1 included — from fixed values written at render, never a
payload string. And a 1.16.0 `form` submit is a guest message like any other, so it fires `wchat:message`
with `source: 'form'` and its `length`; what the guest filled in — dates and a party today, an
email or a phone on a later form — never enters a payload.

**Click counting (D-113) was decided on 2026-10-27: accepted with conditions, as the one bounded
exception to [the hard constraint](#the-hard-constraint), to be built in 2.13.6.** Nothing in the
table below moves for it — `wchat:action` stays exactly as it is, and the count's own attribute
gates that one request, never the events. The reasoning is
[§ The one exception](#the-one-exception-d-113-click-counting-decided-2026-10-27).

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

## The routes

### A — emit events to the host page. **Chosen.**

The only route shippable from this repo alone, and the only one with no new privacy surface:
the widget stores nothing new and sends nothing new. Nest's sites already run analytics, so
the destination already exists.

### B — an opaque visitor token at init. **Deferred, and replaced by a smaller ask.**

The only route that answers "came back next week", "same person, different device", or that
puts a *visitor* answer in wSuite's own panel rather than in each host's GA4. (Clicks reach the
panel by route D since 2026-10-27; visitors still do not.)

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

### D — count CTA clicks on the platform's own endpoint. **Accepted with conditions (2026-10-27), not yet built — it lands in 2.13.6.**

Contract 1.16.0's `POST …/{uuid}/events` (D-113). Not a visitor route — it counts clicks per
conversation and says nothing about who came back — but the one way a click reaches wSuite's
panel. It is a request of the widget's own, so it was decided under
[the hard constraint](#the-hard-constraint), as its one exception, and the reasoning lives there.

## The hard constraint

**The widget never phones home** — with one bounded exception, below. No analytics request of
its own — not to Nest, not to a third party, not a beacon, not an image pixel. A host trusts
exactly one extra origin, ours, and only for our own assets: the same reasoning that keeps icons
inline and fonts self-hosted. Events go to the host page; the host decides where they land. **A
route that needs its own network call is out of scope for this repo by construction** — the one
exception was decided against this sentence, not around it, and any other has to be decided
here the same way.

A host that listens to nothing pays nothing, which is why there is deliberately no `data-*`
attribute to disable **the events**. (The click count's `data-count-clicks` gates that one
request and nothing else.)

### The one exception: D-113 click counting, decided 2026-10-27

**Asked by** the wSuite platform, as the 1.16.1 packet's APPENDIX-A (nest-mind
`modules/chatbot/docs/consumer-sync.md` §5), sent beside the 2.13.4 sync and deliberately not
inside it. **Decided by** the owner, 2026-10-27. **Outcome: accepted with conditions. Not built**
— it lands in 2.13.6, and until then nothing reads `analytics` or calls the endpoint.

**What was asked.** `POST /api/v1/chatbot/conversations/{uuid}/events`, body
`{type: "cta_click", element, cta, turn?}`, when a guest clicks a call to action — Book, a card,
the promo, a contact channel. Two enums and the turn; never guest text, a url or a prefill. Its
own rate-limit bucket (`chatbot-event`), so a click never spends the guest's turns or daily caps.
Off unless the site switched `chatbot.analytics` on in wSuite (default off), which the init
reports as `analytics: true` (absent otherwise). Always `204`. Integration guide §3.4.

**The facts it was decided against** — measured or read that day, not assumed:

- **nestshostels.com is wSuite site 2, and this widget serves it**, from the WordPress theme.
  Site 2 switches the count on at the deploy (D-113(f)), and D-113(f) itself says only the
  reference widget reports until this repo answers — so a decline would have left the platform's
  click stat empty on the one site that turns it on.
- **nestshostels.com's analytics listened to no `wchat:*` event** (owner). Route A answers "which
  buttons get clicked" by design and, on Nest's own site, by nothing yet.
- **Every CTA opens a new tab or is a `tel:`/`mailto:`.** Every CTA anchor carries
  `target="_blank"` except `channelLink`'s phone and email links, which do not leave the page —
  so no click unloads the page under the request.
- **The vocabulary is already in the DOM, from fixed values**: `data-wchat-el` / `data-wchat-cta`,
  read by the delegated `wchat:action` listener. One difference: the DOM's `property_card` is the
  endpoint's `property_cards`.
- **Retention is D-087's 12 months** (owner). A click is deleted with its conversation. The
  scheduled deletion is upstream's to build, and was not built that day.

**The reasoning.** The constraint rests on three supports, and the route was tested against each.

1. **No new origin — holds.** The request goes where every turn already goes, and the host's
   `connect-src` already allows it. That is the substance of "a host trusts exactly one extra
   origin".
2. **The host decides — holds, with a condition added for it.** Route A leaves every measurement
   decision with the host page, and so with its cookie banner: a CMP that blocks GA4 blocks the
   count. As designed upstream, the POST would move that decision to a wSuite setting and step
   past the banner. C6 below gives it back: nothing is reported unless the host page's tag
   allows it — by default only once the page passes the visitor's cookie consent on, or always
   when the site's privacy policy covers the count on its own basis. The widget never reads a CMP
   to do so, so it still touches nothing outside `#nest-chatbot`. In `consent` mode the wSuite
   count and the host's GA4 count share one denominator, consented visitors, and can be read
   side by side.
3. **Nothing new sent — does not hold, and the margin is small.** A click on a conversation uuid
   is personal data: pseudonymous, never anonymous, because the conversation holds the guest's own
   messages. But it rides a row that already holds every message the guest typed, and is deleted
   with it. Two enums and a turn number add nothing of a new kind to that row.

**What it buys that route A cannot** — more than "the panel instead of GA4", which is how the ask
put it. It buys the **join**: a click counted on the server sits on its conversation, on the turn
and the reply that produced it, beside whether the guest had submitted the Book panel. D-113's own
measure is Book clicks per engaged conversation, and its denominator is a conversation, which
GA4 never sees.

**This repo's own test** — does it make the widget harder to drop onto a site we do not control?
No new origin, no CSP entry, and nothing reported unless the site's owner switched it on in wSuite
**and** the host page allowed it.

**The conditions.** Each bounds the exception; break one and the exception is void.

- **C1. Same origin, same transport.** `apiBase` plus the guide §3.4 path, through the existing
  `request()`. Never `sendBeacon` (it cannot carry `Authorization` anyway), never a pixel, and no
  `keepalive` while every CTA opens a new tab or is a `tel:`/`mailto:`.
- **C2. The site's key, persisted.** Report only while the init carried `analytics === true`. The
  flag rides the stored record and is restored on resume — the `idle_hours` lesson, because a
  resume never calls init and `persist()` writes current state. Every new init replaces it,
  absent included (a restart, a `410`/`404` re-init).
- **C3. Four fields, from fixed values only.** `element` and `cta` mapped from the render-time
  attributes (`property_card` → `property_cards`); `turn` the server's own number, or omitted. A
  `cta: null` — a `link_button` whose id this widget does not know — or a pair the endpoint would
  refuse, sends nothing. Never a url, a label, a chip key, a prefill, a form value, or any guest
  or reply text.
- **C4. Fire and forget.** No response read, no retry, no queue, never a re-init on any status
  (guide §3.4), no `wchat:error`, nothing the guest can see. `busy`, `sendQueue`, `sendSeq` and
  the record's `ts` stay untouched: a click is not activity, just as the server never lets an
  event extend the idle window. Under `data-debug` the enum body may be logged, and nothing else.
- **C5. One source of truth.** Sent from the delegated listener that emits `wchat:action`, so the
  host's count and wSuite's cannot disagree on what a click is. `wchat:action` stays exactly as
  it is: route A is not replaced.
- **C6. Two keys, both required** — the wSuite setting (C2) **and** the host page's attribute
  (owner-confirmed). Names provisional until 2.13.6 ships them:

  | `data-count-clicks` | Reports, while the site's `analytics` is on |
  |---|---|
  | `consent` — **the default** | only after the page calls `NestChatbot.setClickCounting(true)`, from its cookie banner's "analytics accepted" callback or a GTM tag behind Consent Mode's `analytics_storage` — the condition the page's GA4 events already wait for |
  | `true` — forced | always: for a site whose privacy policy covers the count on its own legal basis |
  | `false` — off | never; no runtime call overrides it |

  `setClickCounting(false)` withdraws from the next click. The grant is **never stored** — the
  CMP re-asserts it on every page load, and a stored copy could outlive a withdrawal. A click
  before the grant is dropped, never queued. A host whose call runs before `window.NestChatbot`
  exists grants on `wchat:ready`. This gates the **request only**: the `wchat:*` events stay
  ungated and switch-free, as README § Measuring it promises.
- **C7. Closed.** It covers `cta_click` on this endpoint as 1.16.x specifies it. Another event
  `type`, another origin, a field beyond enums and the turn, or linking conversations to a person
  (route B's visitor token) is a new decision, recorded here first.

**Considered and not made a condition:** waiting for D-087's scheduled deletion to ship. The click
adds nothing to the conversation it rides on (support 3), and the deletion is upstream's to build
either way, so it went into the hand-over instead.

**For site 2, stated so nobody is surprised.** In the default `consent` mode nestshostels.com
counts nothing until its GTM passes the visitor's consent on; with `data-count-clicks="true"`,
backed by its privacy policy, it counts every visitor. The choice is the owner's at the 2.13.6
rollout. Either way the policy should describe the count as it is: which chat buttons are
clicked, and in which reply; no text, no link, no contact detail; stored by wSuite as processor
and deleted with the conversation after 12 months — pseudonymous, never "anonymous". Whether
`true`'s legal basis holds without cookie consent is the controller's call; the widget supports
both answers.

**Numbering.** The build adds one `data-*` attribute and one `window.NestChatbot` method, both
additive, so 2.13.6 is a patch. This decision moved no version. (It was 2.13.5 when decided; the
contract 1.17.0 sync shipped first and took that number, owner decision 2026-10-27.)

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
| `wchat:message` | `sendGuestText()` | `source`, `length`, `turns`, `locale` | **engagement** — read-only vs typed; whether the prompt pills and server chips earn their space; since 2.13.4 **how often the Book panel is submitted** (`source:'form'`) | what they asked, or what they filled in |
| `wchat:reply` | `sendMessage()` 200; again on poll resolution | `turn`, `length`, `elements[]`, `async`, `resolved`, `ended`, `latencyMs` | **how slow the bot is**; which element types actually reach guests | reply quality; whether it was right |
| `wchat:action` | delegated click in `els.body` | `element`, `cta` (since 2.13.4), `url`, `channel`, `style`, `index` | **the conversion** — which Book / WhatsApp / card was clicked, and through `cta` which kind of button, Website and Directions included | whether the booking completed |
| `wchat:error` | every non-200 branch | `phase`, `status`, `retrying`, `retryAfter` (since 2.13.0) | **429s on shared hostel wifi** — and, through `retryAfter`, whether one was a minute's wait or a daily cap (contract 1.11.0) — 403 origin refusals, transport failures — all invisible before this | why the server failed |
| `wchat:ended` | `endConversation()` | `turns` | how often the turn cap bites | whether the guest minded |
| `wchat:restart` | `restartConversation()` | `source`, `turns` | whether "start a new chat" is used, and **whether it was chosen or forced** (`source`) | why they wanted a fresh thread |
| `wchat:locale` | `setLocale()` — since 2.13.1 only a host's `NestChatbot.setLocale()`; the on-screen switcher was removed | `from`, `to` | **how often the host page drives the widget's language** | which language the conversation is actually in — since contract 1.13.0 the server follows what the guest writes |
| `wchat:teaser` | `showTeaser()`, `dismissTeaserForever()` | `action` | whether the teaser earns its 8 seconds | — |

`source` enums: `open` — `toggler` \| `teaser` \| `auto` \| `api`. `close` — `toggler` \|
`close` \| `escape` \| `back` \| `api` (`back` added in 2.10.3 with the device Back button;
additive, so a patch). `message` — `composer` \| `prompt` \| `chip` \| `welcome-chip` \|
`form` (`form` added in 2.13.4 with the 1.16.0 form; additive, so a patch).
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
  that in a host's analytics buys nothing — `channel` says which was used instead. Since 1.14.0
  a WhatsApp or email href can also carry the guest's own pre-written message (`prefill`), which
  the contract bars from analytics events and logs — one more reason the exclusion is absolute.
  It is absolute for **our** events only: the href is on the anchor, and a host's generic
  link-click tag reads it there, which no payload rule can prevent. `cta` (2.13.4) is no
  exception to any of this: it is an enum, so a contact click carries `cta: 'whatsapp'` and still
  `url: null`. A form's consent link is not tagged at all — a privacy notice, not a call to action.
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
  the question to settle before the ask below is sent. **For CTA clicks that requirement was met
  on 2026-10-27, by route D** ([§ The one exception](#the-one-exception-d-113-click-counting-decided-2026-10-27));
  for *visitors* — returning, cross-device — it still holds. Nor is route A automatic: on
  nestshostels.com no `wchat:*` event was wired into analytics when click counting was decided
  (owner, 2026-10-27), so its answers exist only where a host listens.
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
