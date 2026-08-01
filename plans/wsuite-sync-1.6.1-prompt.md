> **Provenance: copied verbatim from the wSuite platform repo**, `modules/chatbot/docs/consumer-sync.md`
> §4 ("The sync prompt"), at contract **1.6.1**. The platform authors and renders this prompt per
> consumer from its own registry — it is *their* document, reproduced here so the sync's input sits
> beside this repo's other plans. **Do not edit it to reflect local opinion**; if it is wrong, that is a
> correction to send upstream. Re-copy it at the next sync rather than patching this file.
>
> **This is revision 2, re-copied 2026-07-31 after the platform rewrote §4.** An earlier copy is
> superseded — they asked explicitly that the current version be used. What changed: a new **Step 1b**
> listing five defects their own browser pass found in the reference renderer, the §1 registry row
> corrected to this repo's real numbers (`2.4.2` / `BUILT_AGAINST` `1.4.1`), and Step 0 now *asks* for
> `BUILT_AGAINST` rather than asserting it.
>
> **Step 1b defect 1 is the one to check first.** The `410`/`404` re-init drawing the replacement
> conversation's greeting and chips is 1.5.0-era behaviour, so it may be live in this build; it is
> invisible until a `410` is forced, and the mock's `!410` does **not** reach it (the fixture returns
> `410` to the retry as well, so it exercises the give-up branch, not recovery).
>
> **Packet provenance, recorded in their §2 and easy to get wrong:** the two docs come from tag
> `chatbot-contract-v1.6.1`, but `chatbot.reference.js` comes from **main** — a widget bugfix does not
> bump the contract, so the renderer is ~86 lines ahead of the tag while the docs are byte-identical to
> it. Taking all three from the tag ships the buggy renderer. The built packet is at
> `C:\Users\artur\Herd\nest-packet-1.6.1\`; vendoring it into `docs/wsuite/` is step one of the sync.

# Task — sync this widget to wSuite chatbot response contract 1.6.1

You are working in `nest-chatbot-ai`: Nest Hostels' branded guest chat widget and an
external, separately-versioned consumer of the wSuite chatbot public API. It is a
plain-JS, no-build IIFE (`nest-chatbot.js`, exposing `window.NestChatbot`, styled by
`css/nest-chatbot.css`, demoed at `demo/index.html`). It talks to the API with a
public-scoped `ws_live_<prefix>.<secret>` embed key that is visible in page source by
design.

This repo is built against contract **1.5.0**; the server is at **1.6.1** — **one MINOR
behind, and 1.6.0 exists because of your own conformance report.** The fields you found
missing while building the card, promo and chip renderers are now in the contract, so
most of this sync is adopting fields you already asked for, plus finishing the two
things your report listed as scheduled for this release.

**This is a small sync. Do not treat it like the last one.** Nothing is broken, nothing
is a migration, and there is no new element vocabulary to design UI for. If you find
yourself rewriting a renderer, stop — you have misread the scope.

## Inputs — read in this order before touching code

The integration packet is already vendored in this repo at `docs/wsuite/` and has just
been refreshed to 1.6.1:

1. `docs/wsuite/response-contract.md` — the frozen envelope, every element type, and the
   `## Changelog`, whose rows carry a **Breaking** and a **Consumer action** cell. **This
   is the authority.** The `1.6.0` and `1.6.1` rows are both `Breaking: No`, and 1.6.0's Consumer action cell is
   deliberately split into "adoptable fields" and "pure documentation" — read that split
   first, it is the whole work plan. Upstream tags each version as
   `chatbot-contract-v<X.Y.Z>`, so `git diff chatbot-contract-v1.5.0..chatbot-contract-v1.6.1`
   is available if you want the raw delta.
2. `docs/wsuite/integration-guide.md` — transport, auth, the three endpoints, errors,
   rate limits, CORS/origins.
3. `docs/wsuite/chatbot.reference.js` — the platform's canonical, security-reviewed
   reference implementation at 1.6.1. **When any detail below is ambiguous, do exactly
   what this file does** — then adapt it to this repo's UI.

**First, check the packet is actually current:** the header of
`docs/wsuite/response-contract.md` must read `1.6.1`. If it still says `1.5.0`, the files
were not refreshed — stop and ask for the current packet. Do not guess, and do not edit
the vendored files to make them look current.

## Step 0 — establish where you actually are. Report before editing.

Read `nest-chatbot.js` end to end, then report:

- `BUILT_AGAINST` — **read the literal value and report it.** Upstream's registry recorded
  `1.5.0`; your last report said `1.4.1`. Do not assume either — whichever it says, state it,
  then state which 1.5.0 elements you actually render (`property_cards`, `promo_card`,
  `quick_replies`, init `actions[]`). If the constant is behind what the code does, say so:
  that gap is the reason this drifted, and it gets corrected in Step 4, not papered over.
- `var VERSION` — this repo's **own** release number, a separate thing (currently
  `2.4.2`). Confirm you can tell the two apart before you change either.
- your `property_cards` renderer — does it read `item.url` before or after your scheme
  gate, and does it record a dropped item's url anywhere? (Step 1, item 1.)
- your `promo_card` renderer — what does it do when `body` or `cta` is absent?
- your `quick_replies` renderer — is a row retired on tap? On a typed message? Neither?
- your item cap on the card rail — what number, and is anything shown when items are cut?

Post a short findings list. Then proceed.

## Step 1 — MUST fix. These two are the ones with real consequences.

1. **The Book-button dedupe, and the trap in it.** Your report lists D-043(c) as not yet
   implemented. Implement it — suppress a `link_button` whose `url` exactly equals a card
   item's `url` in the same `actions[]` list — but build the comparison set **only from
   items you will actually render**, after your `name` and `http(s)` gates. Recording the
   url of an item you rejected would silently remove the guest's only Book button, which
   is strictly worse than the duplicate you are removing. The reference's
   `renderableCardUrl()` + `renderActions()` pre-scan is exactly this; copy that shape.
   Compare **raw strings** and do not normalize: within one payload the server guarantees
   both urls are the same `booking_url` value from the same row, so plain equality is
   exact, and normalizing only risks over-suppressing.
2. **Never `innerHTML`, and gate `image` as well as `url`.** §4 rule 3 of the guide now
   names `image` explicitly (it did not at 1.5.0, though the contract's security rule
   did — you already gate both, so this is a confirmation, not a change). The full gated
   set is: `link_button`, `booking_link`, `availability`, `property_cards` item `url` +
   `image` **and the new element-level `more.url`**, and `promo_card` `image` + `cta.url`.

## Step 1b — five defects the reference renderer's own browser pass found (2026-07-31)

The platform ran the browser pass it owed on `chatbot.js` and found five real defects. **None is
a contract change** — the contract was right, the reference renderer was wrong — but every one of
them is a bug you can have too, because they are all in code paths you copied or mirrored. Check
each against your renderer and fix what applies. The refreshed `chatbot.reference.js` in your
packet already has all five.

1. **The `410`/`404` re-init was not actually transparent.** The recovery path called the same
   `startConversation()` the launcher does, so it drew the *replacement* conversation's greeting
   — and, on a configured site, its `promo_card` and a fresh `quick_replies` row — **after** the
   message the guest had already sent. The chip row is stale on arrival by the one-shot rule.
   Fix: the silent recovery path must establish the new conversation (uuid, storage, version
   check) and render **nothing**. This is the highest-value one for you: it is 1.5.0-era
   behaviour, so it is probably present in your build today, and it is invisible until you
   force a `410`.
2. **`promo_card.style` must match your OWN known list.** The reference accepted any
   `/^[a-z-]+$/` value and emitted `wsc-promo-<that value>`, so tenant-authored text reached the
   DOM as a class name — and it had no rule for `highlight`, the one value the contract
   documents, so the whitelist was decorative anyway. The contract requires matching against a
   list you control and degrading anything unrecognised to default styling.
3. **`conversation_ended` needs a branch** (this is also the 1.6.0 delta item). Without one, a
   capped conversation leaves the composer open and every further message returns the same canned
   reply. The reference now closes the composer and offers a "start a new chat" affordance that
   clears the stored uuid and re-inits.
4. **Four accessibility gaps**, all named in the contract's Accessibility section, which describes
   them as things the reference widget already did — it did not. If your panel body is a single
   `aria-live` region, a card rail, promo and chip row all announce **over** the reply; mark those
   containers `aria-live="off"`. Expose the rail as a labelled list of list items, name the promo
   region by its `title`, and when a chip row retires under focus move focus to the composer
   instead of dropping it to `<body>`.
5. **Verify the dedupe with the case that actually isolates it.** A `javascript:` card URL cannot
   test the D-043(c) trap, because there the card *and* the Book button are both rejected and you
   see the correct result for the wrong reason. The case that isolates it is a card dropped for a
   **non-URL** reason — no `name` — carrying a **valid** url that a `link_button` in the same list
   also carries. Correct behaviour: card dropped, Book button still rendered.

## Step 2 — adopt the contract delta (1.5.0 → 1.6.1)

Open the vendored `## Changelog` and read the `1.6.0` and `1.6.1` rows. Everything below is optional
by construction; the first three are the ones your own design asked for.

- **`price_from.period` / `basis` — the "/night" you needed.** `price_from` may now carry
  `period` (`night` | `stay`) and `basis` (`per_person` | `per_unit`), orthogonally: "per
  person per night" is `night` + `per_person`. Map them to a **localized suffix of your
  own** across your five locales — the server deliberately sends no display text, because
  you are already formatting the number with `Intl.NumberFormat`. Two traps, both
  guest-facing pricing errors rather than cosmetics:
  - **Both are optional and are omitted unless the tenant declared them. When absent,
    render the bare price — never infer "/night".**
  - **They are PER ITEM and two cards in one carousel may differ (1.6.1).** They describe
    the *cheapest bookable thing* a from-price refers to, not the property: a hostel
    selling dorm beds and private doubles quotes `per_person` (its from-price is a bed),
    while an Ibiza property whose cheapest offering is a double room priced for the room
    quotes `per_unit`. Nest Hostels' catalog is genuinely mixed, so **resolve the suffix
    per card** — computing it once for the rail will mislabel real inventory.
- **`cta_label` on a card item — server-localized Book text.** Prefer it over your own
  `book` string; fall back to yours when it is absent. That removes one of the two places
  this widget and the reference disagreed about card CTA wording, and lets a tenant say
  "Check rates" without a widget release.
- **`total` and `more` on the element — your carousel overflow.** `total` is the match
  count **before** the server's cap, so your 8-item rail can finally say "showing 8 of
  14". `more` is `{label, url}` with a **server-localized** label and the usual `http(s)`
  rule — render it as a trailing card or link. Neither is guaranteed present: `more` only
  when the tenant configured a listing URL.
- **`locale` on `promo_card` and `quick_replies`.** A 2-letter primary subtag naming the
  language of the block's displayed text. Set `lang` from it — you ship five locales and a
  language switcher, so this is the field that stops a screen reader reading Spanish promo
  copy with an English voice. **Absent means unknown; do not guess.** Note the server now
  resolves tenant promo/chip content per locale where the tenant supplied translations, so
  a German guest can get German copy — but `locale` always reports what you actually got,
  which is not necessarily what you sent.
- **`id` on `promo_card` and `quick_replies`.** Stable identity, never displayed. On the
  promo it is content-derived (it changes when the tenant rewrites the offer, which is what
  makes client-side frequency capping on it safe — the server caps per *conversation* only,
  never per visitor, and a re-init resets it). On a chip row it names provenance:
  `quick_prompts` (tenant text) vs `island_choice` (server-generated, labels are island
  proper nouns). If you ever want to let a guest dismiss the promo and remember it, `id` is
  the key — the server does not model dismissal and has no `dismissible` flag.
- **`image_alt` on a card item — reserved, not emitted yet.** One line future-proofs you:
  `alt = item.image_alt || ''`. **The important half is the default:** absent, the image is
  decorative and `alt=""` is correct — which is already what you do, and is now the
  contract's stated rule. The reference was the one diverging (it reused `name`) and has
  been fixed.
- **`conversation_ended` — a new element on the turn-cap reply.** `{type, reason?}`,
  `reason: "turn_cap"` today, emitted last in `actions[]`. It carries no visual payload —
  the reply text already says the limit was reached — so a branch is optional. But your
  Step 3 note from the last sync flagged wanting a "start a new chat" affordance and
  `destroy()`/re-init already exists on `window.NestChatbot`: this is the signal to show it
  at exactly the right moment instead of guessing. Two edges the contract now documents:
  the capped reply's `turn` repeats the previous exchange's number, and the cap is detected
  on the message *after* the last allowed one.
- **The one-shot chip rule, now precise (still a SHOULD).** Your report lists this as not
  yet implemented. Adopt it: a row stops being tappable after **either** a chip is tapped
  in *any* row, **or** the guest sends a typed message — and both retire **every chip row
  on screen**, not just the most recent. Removal is what the reference does; disabling in
  place is equally conformant. You **may** restore a row after a failed turn; the reference
  does not, on the grounds that a restored row invites a double send. Note the widget's
  bug this closes: without the typed-message trigger, stale chips sit on screen for the rest
  of the conversation.
- **Pure documentation — read, do not build.** The [missing-required-field policy]
  (`Required: yes` is a server guarantee; a payload missing one means drop the whole
  element, fail closed — **your 1.5.0 behaviour was already the correct one**, and the
  reference has been fixed to match you); `price_from` decimal semantics (always two
  decimals, `.` always the decimal mark, `parseFloat`-safe, no tax/fee guarantee, never a
  quote); `currency` is now guaranteed ISO-4217 whenever `price_from` is present; card
  images have no aspect-ratio/placeholder/CDN guarantee; `name`/`location`/`badge` are
  **not** localized (raw tenant-language catalog text) while `cta_label` and `more.label`
  are; `key` is a stable-but-renameable slug — do not persist it as a primary key; the item
  cap is a deployment setting so do not hardcode a maximum; item order is meaningful but is
  **catalog order, not a ranking** — never label it "best match"; advisory text lengths; the
  `style` value set (`highlight` is the only documented value; whitelist and degrade — your
  strict-equality check already exceeds this); promo `body` may contain `\n` (use
  `white-space: pre-wrap`); `reply` has no max length and may contain `\n`; init `actions[]`
  carries content elements only; and where elements sit relative to the reply bubble.
- **Poll `410`.** The guide now carves this out: on `GET …/turns/{turn}` a `410` means
  **stop polling and re-init nothing** — keep the interim reply, and let the guest's next
  message re-init on the turn endpoint. If your `pollResult` re-inits on `410`, fix it; if
  it returns silently, that is already correct.
- **Accessibility.** The contract now has a short a11y section for the three rich types.
  Your choices (labelled carousel arrows, arrow-key traversal between card CTAs, decorative
  dots, a dedicated live region for replies) informed it — read it and report any place you
  deliberately differ, so the next revision can absorb it.

## Step 3 — verify parity (an audit, not a build)

You were feature-complete against the reference at 1.5.0, so **the default outcome of each
item is "confirmed, no change."** Report confirmed / fixed / declined for each:

- **Poll `404` stays transient, turn `404` stays terminal.** You fixed this at 1.5.0 —
  confirm it did not regress, and that `410` now follows Step 2's poll rule.
- **`async_result` poll loop** — cadence ≈2s → ×1.5 → 5s cap, give up ≈120s; `ready`/`failed`
  replaces the interim bubble **in place**.
- **NEW — the poll's `actions[]` is additive.** The contract now states that the interim
  turn's elements stay on screen and only the bubble *text* is replaced, so a final element
  whose `url` you already rendered for that turn **SHOULD** be suppressed. Exactly one case
  can arise: an `availability` whose `url` falls back to the property's `booking_url`,
  duplicating the interim `booking_link`. It is dormant until a PMS provider binds, so you
  will not have seen it. The reference threads a per-turn rendered-url set; copy that.
- **`property` at init, conversation persistence, `403`/`429`/`401` handling, the one-time
  drift warn** — all confirmed present at 1.5.0. Confirm, do not rebuild.

## Step 4 — repo bookkeeping (do not skip)

- Set `BUILT_AGAINST` to `'1.6.1'` — **last**, only after every row above is implemented or
  consciously declined. It is a claim about this code, not a label. Update the file's header
  comment too.
- **Bump `var VERSION` and keep the two numbers separate.** This sync adds features →
  `2.4.0` → **`2.5.0`**. Never collapse the two.
- Commit the refreshed `docs/wsuite/` packet and record the sync date **and the upstream tag**
  (`chatbot-contract-v1.6.1`). **Never hand-edit those three files** — they are replaced
  wholesale at the next sync.
- Add a `CHANGELOG.md` entry under `2.5.0`: "synced to wSuite chatbot contract 1.6.1",
  listing each row adopted and each declined, with reasons.
- **Update `CLAUDE.md`:** the contract version (`1.5.0` → `1.6.1`), and delete the two
  "scheduled for 2.5.0" open items this sync closes (the Book-button dedupe and one-shot
  chips). Add the poll-`410` rule and the "never infer a price period" rule if you keep a
  gotchas list — the second one is a guest-facing correctness trap, not a style note.
- **Add mock fixtures** for the new fields so `data-mock` exercises them with no backend: a
  card with `price_from.period`/`basis` + `cta_label`, a rail whose `total` exceeds its
  items (plus a `more`), a promo with a non-`en` `locale` and a `\n` in its `body`, and a
  capped reply carrying `conversation_ended`.

## Step 5 — verify against a real deployment

0. **Mock pass first** (`data-mock="true"`): the new fixtures render; a from-price with no
   `period` shows **no** suffix; **a rail whose two cards carry different `basis` values
   shows two different suffixes**; a tapped chip retires **every** row and so does typing;
   a card whose url fails the scheme gate is dropped **and its Book button survives**;
   `!xss` and `!unknown` stay inert.
1. Serve `demo/index.html` from an origin **different** from the API origin.
2. Full turn against a real deployment: confirm the card CTA uses the server's `cta_label`,
   that the from-price suffix matches the site's declared basis, and that no duplicate Book
   button appears.
3. Switch the language switcher to Spanish and confirm the promo arrives with `locale` set
   and `lang` applied (Spanish copy if the tenant has authored it, the base language if not).
4. Confirm no contract-drift `console.warn` after the `BUILT_AGAINST` bump.

## Hard rules

- Never ship a `full`-scope key to the browser. Public scope only.
- Never hardcode a cross-origin poll URL. Resolve `async_result.url` against the base you
  POST to.
- Never break on an unrecognised element `type` or an unrecognised field — skip it.
- Chips carry no URLs. Never render one as an anchor.
- Do not modify the request/response envelope or invent fields. If something you need is
  missing, that is a contract-change request upstream — and 1.6.0 is proof that route works.

## Deliverable

A single commit (or PR) containing: `nest-chatbot.js` (`VERSION` → `2.5.0`, `BUILT_AGAINST`
→ `1.6.1`), the Step 1 dedupe and one-shot chip fixes, the Step 2 field adoptions with any
`nc-`-scoped CSS they need, the new mock fixtures, the refreshed `docs/wsuite/` packet, the
`CHANGELOG.md` entry and the `CLAUDE.md` corrections — plus a short report of what you
adopted, what you declined, and why. That report is what gets recorded in the upstream
consumer registry.
