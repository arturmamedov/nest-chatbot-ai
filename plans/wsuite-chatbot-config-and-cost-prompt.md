# Task — wChatbot: configure the Nest welcome, close three field questions, and cost the LLM path

You are working in the **wSuite backend** repo, which owns the guest chatbot API, the site
settings behind its guest-facing content, and the vendored contract packet
(`response-contract.md`, `integration-guide.md`, `chatbot.reference.js`) that consumers
integrate against.

This is a request from the **`nest-chatbot-ai` consumer** — Nest Hostels' branded drop-in
widget, at its own release `2.4.2` with `BUILT_AGAINST` `1.4.1`. It is **not** a contract-change
request and nothing here is a bug report: contract `1.6.1` is sound and this consumer is the one
behind.

**Revision 2.** An earlier version of this document went over and you answered most of it, and
found four defects in it. This revision deletes what you answered, applies all four fixes, and
narrows to what is genuinely still open. Your answers are recorded inline where they land — they
are the input to this consumer's own `2.5.0` sync, so they are kept rather than dropped.

Three parts, and only the first asks for code.

1. **Configuration** — put a specific welcome on screen for the Nest sites, and make that
   configuration reachable by a human. Today it is not.
2. **Three residual field questions** — down from a full emission table, because you answered
   the rest.
3. **An investigation** — what a turn costs and what of it can be avoided. Written answers, no
   implementation. **Nothing in this part may be built without a version conversation first.**

---

## Read first

- `modules/chatbot/docs/response-contract.md` — the envelope, the element types, the Changelog.
- `modules/chatbot/src/Services/SiteContentElements.php` — the parser/validator for
  `chatbot.quick_prompts`, `chatbot.promo` and `chatbot.cards`.
- `modules/chatbot/database/seeders/NestChatbotContentSeeder.php` — the worked example of all
  three settings for this exact tenant.
- `modules/chatbot/src/Services/ChatOrchestrator.php` — the turn lifecycle, for Part 3.
- `modules/chatbot/docs/execution-plan.md` — the AI-module design notes referenced in Part 3.
- `modules/tenancy/src/Filament/Resources/Sites/SiteResource.php` — the site admin form, and the
  reason Part 1.2 must *not* land there.

---

## Part 0 — consumer state (context; no work here)

- Widget `2.4.2`, `BUILT_AGAINST` `1.4.1`, packet vendored at `1.5.0`.
- **Version conflict, now resolved — noted so the history is clear.** Your registry read
  `2.4.0` / `BUILT_AGAINST 1.5.0`; the real state is `2.4.2` / `1.4.1`, and your §1 row is now
  corrected. The consequence is ours and worth stating plainly: this widget has been **rendering
  1.5.0 elements without ever moving the constant that drives the drift warning**, so that warn
  fires by design against any current server. It is fixed as part of the consumer's own sync,
  not here.
- **It knows it owes you the 1.5.0 → 1.6.1 sync** and has your updated `consumer-sync.md` §4,
  including the five Step 1b defects. Its two self-declared SHOULD gaps — the D-043(c)
  Book-button dedupe and one-shot chip rows — are scheduled for that same `2.5.0`. Do not
  re-report them.
- Since `2.4.2` an init `quick_replies` row **replaces** the widget's own built-in prompt pills
  rather than rendering beside them, per the contract's definition of what that row is.
  Consequence when you set the value in Part 1: **whatever `chatbot.quick_prompts` contains is
  the entire welcome affordance for that site.** There is no widget-side fallback behind it.
- The widget renders a chip row **bare** — no heading. It has no way to label a server row: the
  element carries no text field and the init envelope's `greeting` is spent introducing the
  assistant. A standing request, not part of this task.

---

## Part 1 — configure the Nest welcome, and make it configurable

### 1.1 The desired end state

One chip row at greeting time, five chips: two questions and the three islands.

| # | `label` (what the guest sees) | `message` (what the tap sends) |
|---|---|---|
| 1 | Find my hostel | Which hostel fits me best? |
| 2 | Nest Pass | How does the Nest Pass work? |
| 3 | Tenerife | Hostels in Tenerife |
| 4 | Gran Canaria | Hostels in Gran Canaria |
| 5 | Ibiza | Hostels in Ibiza |

**The island messages are sentences because you told us to make them sentences.** We asked
whether a bare `"Tenerife"` routes acceptably; you answered that your own `island_choice` row
sends `Hostels in :island` (`resources/lang/en/chat.php` → `island_prompt`), so the platform had
already made this call. Matching it also keeps a tapped *welcome* chip consistent with a tapped
*clarification* chip — the same guest intent should not reach the pipeline as two different
strings. Adopted verbatim.

The short-label / full-message split is deliberate and is why the two fields exist: "Tenerife"
fits a 420px panel, while the message that reaches understanding is unambiguous. Please keep
them distinct rather than collapsing both to one string.

Five chips is within `SiteContentElements::MAX_CHIPS` (6). In the 1.6.0 keyed shape so the row
declares its language:

```php
$settings->put($siteId, 'chatbot.quick_prompts', [
    'locale' => 'en',
    'items' => [
        ['label' => 'Find my hostel', 'message' => 'Which hostel fits me best?'],
        ['label' => 'Nest Pass',      'message' => 'How does the Nest Pass work?'],
        ['label' => 'Tenerife',       'message' => 'Hostels in Tenerife'],
        ['label' => 'Gran Canaria',   'message' => 'Hostels in Gran Canaria'],
        ['label' => 'Ibiza',          'message' => 'Hostels in Ibiza'],
    ],
]);
```

**Overwrite the existing value — explicitly.** You seeded `chatbot.quick_prompts` on the Nest
site, so it is present, and the seeder's only-when-absent rule means "apply this value" and
"respect the non-destructive convention" cannot both happen: the write would silently no-op.
This is an intentional replacement of a seeded default with the owner's chosen copy. Use a
direct `put()` on every chatbot-enabled site of tenant `nest-hostels`, not the seeder. The
only-when-absent rule still belongs where it is — in the seeder, for a fresh site.

**One merged row is deliberate.** The islands sit in the same row as the questions rather than
in a row of their own, and we are not asking for a second init row. `island_choice` stays
exactly as it is, as a clarification row on a turn. Part 1.1 should require no code change at
all.

**Decision taken: set `chatbot.promo.show_at_init` to `true`.** You confirmed the two gates are
independent in code — only the booking path records `promoShown` — so a site with both set
genuinely shows the Nest Pass card at the greeting **and** again on a qualifying 7+ night
booking turn, and that is D-044's intended reading. The owner has accepted the double-show:
maximum exposure for the Nest Pass is worth one repeat inside a booking conversation. Please set
it alongside the chips above. If you think the repeat is a mistake, say so — but implement the
decision rather than pausing on it.

**Still open from the last round:** are `chatbot.cards.price_period` / `price_basis` backfilled
**per property**? 1.6.1 made them per-item and the Nest catalog is genuinely mixed — dorm beds
quote `per_person`, a property whose cheapest bookable thing is a private double quotes
`per_unit`. The site-level seed (`night` + `per_person`) is right for most of the estate and
wrong for the rest. Report which properties carry their own values and which fall back, because
a wrong basis is a guest-facing pricing error, not a cosmetic one.

### 1.2 The real ask — there is no admin surface, and it cannot go where we suggested

`SiteResource::form()` renders exactly one setting: the origin allow-list. There is **no form
field anywhere** for `chatbot.enabled`, `chatbot.greeting`, `chatbot.quick_prompts`,
`chatbot.promo` or `chatbot.cards`. So the only routes in are the seeder or a `SiteSettings::put()`
in tinker — and since the seeder writes only-when-absent by design, **after the first write there
is no supported way for an owner to change their own welcome copy.**

**Correction to the previous revision, per your review: this must NOT go on `SiteResource`.**
That resource is L1 tenancy and `chatbot.*` is L3, so adding those fields there makes L1 depend
on L3 and fails `tests/Arch/ModuleBoundariesTest.php`. What the last revision offered as a
parenthetical fallback — "or a dedicated chatbot settings page" — is therefore **the
requirement**, not an alternative. The existing origin field is not a counter-example: it is
tenancy-owned (`EnsureOriginAllowed`), so it belongs exactly where it is.

Please add a chatbot-owned settings page (your Filament plugin already contributes pages and
resources, so the seam exists) exposing:

- `chatbot.enabled` — toggle.
- `chatbot.greeting` — text, with the `chatbot::chat.greeting` lang fallback as the placeholder
  so an empty field visibly means "use the default".
- `chatbot.quick_prompts` — a repeater over `items` with `label` + `message`, **max 6 enforced
  in the form**. Today the cap is a `break` in `chipItems()`, so a 7th chip an owner typed
  simply never appears, with nothing on screen explaining why.
- `chatbot.promo` — `title` / `body` / `cta{label,url}` plus `min_nights` and `show_at_init`.
  `body` needs a textarea: the contract allows `\n` and you confirmed newlines reach the wire.
- `chatbot.cards` — `price_period` and `price_basis` selects over the legal value sets, and
  `more_url`.

Two constraints worth designing to. Validation should mirror `SiteContentElements` exactly
rather than approximate it, so a value that saves cleanly cannot then be silently discarded at
render — that failure mode is invisible from the admin side. And the `locales` map both settings
accept is where per-language copy lives; whether that belongs on this page or behind a
translations affordance is your call, but the form must not make an existing `locales` key
impossible to preserve.

---

## Part 2 — three residual field questions

You answered the emission table, which saved a session. Recorded below rather than re-asked,
because this consumer's `2.5.0` sync depends on them.

**Answers received — no action needed:**

- **`async_result` in init `actions[]` is impossible** — `initActions()` returns only `PromoCard`
  and `QuickReplies`. That closes the consumer's worry about a stray second bubble at init.
- **`image_alt` is never emitted** — no catalog column behind it. The consumer will implement
  `alt = item.image_alt || ''` for the contract's stated default and build no UI for it.
- **`conversation_ended`** — emitted; `reason` is `turn_cap` only; the cap is the default **50**
  on this deployment, no env override.
- **Item order** — catalog order, ascending by name (observed: Adeje → Aguere → Arena → Ashavana
  → Duque → Los Amigos → Médano → Puerto). The consumer will not label it a ranking.
- **`promo_card.id`** — `'promo:' . substr(sha1(title|cta.url), 0, 8)`, derived from the base
  copy so it is stable across locales. That stability is exactly what makes client-side
  frequency capping safe, which is what the consumer wanted it for.
- **Promo `body` newlines survive to the wire** — verified. The consumer already renders with
  `white-space: pre-wrap`.

**The D-043(c) collision payload — the most useful thing you sent.** You confirmed the case is
real and gave the instance: a resolved-property info turn for **Duque** emits both a
`property_cards` item CTA and a `link_button`, both carrying
`https://hotels.cloudbeds.com/en/reservation/R5Sn9T`, and it is the only path that emits both
(one handler per turn, D-009). The consumer's mock has never been able to produce this — its
fixture CTAs are three different URLs — so it had no regression test for the dedupe it owes.
This payload is that test. Nothing further needed from you; it is recorded here so it reaches
the sync.

**Still open — three fields, same three questions each: emitted today, under what trigger, from
which setting or column?**

1. `property_cards` element-level **`total`**.
2. `property_cards` element-level **`more{label,url}`**. (The seeder leaves `more_url` unseeded
   deliberately, so "configured nowhere yet, therefore never emitted for Nest" is a perfectly
   good answer — we would rather be told than infer it.)
3. `property_cards` item **`cta_label`**.

---

## Part 3 — what does a turn cost, and what of it can be avoided?

An **investigation**: numbers and an architectural answer. **Nothing in this part is a licence to
implement** — see the rule at the foot of this section.

### 3.1 What we read in your code, and what you confirmed

You verified all of this, so it is common ground:

- **Init is free.** `ConversationController` reads `chatbot.greeting` (or the lang fallback) and
  calls `SiteContentElements::initActions()` — two settings reads. No agent, no embedding. You
  confirmed this live.
- **Element content is free.** Cards from the catalog, promo and chips from settings. "Never
  LLM-composed" is literally true in the code.
- **A turn always costs at least one LLM call.** `ChatOrchestrator.php:179` computes
  `$chatCalls = 1 + ($generated ? 1 : 0) + ($summarizeTokens > 0 ? 1 : 0)`. The leading `1` is
  `UnderstandingService` → `gateway->structured(UnderstandTurnAgent)`, running
  **unconditionally, before handler dispatch**. Add `TieredRetriever`'s `gateway->embed()`.
- **The respond call is already skippable and you already skip it.**
  `HandlerResult::$responseText` short-circuits generation, and `InformationHandler::islandChoiceChips()`
  uses that path.
- **`->cache(` appears nowhere in `modules/ai/src` or `modules/chatbot/src`**, although
  `ModelPricing` prices `cacheWriteInputTokens` / `cacheReadInputTokens` at 1.25× / 0.1×.

A guest tapping "Nest Pass" pays understanding + embedding + respond, and the next guest tapping
the same chip pays it again. A chip row is a **fixed, finite, server-authored** set of strings —
the most cacheable traffic the system has.

### 3.2 The numbers, and the one they raise

You reported: 133 turns over 8 days; `InformationHandler` at **n=100** (the only handler with
enough volume for a p95, Comparison being n=1); averages of **~4,207 tokens** and **2.82 LLM
calls** per info turn. That is enough to work with — thank you.

**One question those numbers raise, and it may be worth more than every caching idea below.**
The floor for an info turn is **2** calls: understanding, then respond. The average is **2.82**.
So either `SummarizeConversationAgent` is tripping on roughly four turns in five, or something
else is reaching the gateway on the info path. At ~4,200 tokens a turn that third call is a
material share of the bill, and it is being spent on conversation bookkeeping rather than on
answering the guest. **Please explain the 0.82 before optimising anything else** — if the
summarize threshold is simply set too low, that is a config change with no contract surface, no
consumer coordination and no risk, and it may be the largest single saving available.

Still useful alongside it: currency cost per 1,000 conversations at today's model settings, and
the share of turns whose `responseText` short-circuit fired (the current deterministic-path hit
rate).

### 3.3 The proposal: make a server-authored chip a zero-LLM turn

**This is a contract change — 1.7.0 — not a patch.** Per your review: an optional field on
`quick_replies` items is a guest-surface addition, which means four version sites, a tag, and a
consumer-sync row. Treat this section as a request for a **written yes/no/how**, and if the
answer is yes, as the opening of a 1.7.0 conversation. Do not ship it inside this task.

The idea: a chip the **server itself generated** is the one case where intent is known before
the guest acts — the server wrote both the label and the message. Yet the tap round-trips as an
anonymous free-text turn and pays for an understanding call to rediscover what the server
already knew.

Proposal: let a `quick_replies` item optionally carry an **opaque, server-issued intent token**
that the turn endpoint validates to skip understanding and dispatch straight to the handler.
Combined with the `responseText` short-circuit you already have, an island tap becomes a
**zero-LLM-call turn**.

Properties it must have, and why each:

- **Additive and optional.** Chips still send `message` as an ordinary turn; a consumer that
  ignores the field is unaffected. That is what keeps it a MINOR.
- **Server-issued and server-validated, never guest-authored.** This is the entire security
  surface: an unvalidated intent field is injection straight past understanding. Sign it, scope
  it to the conversation, or keep it server-side and have the chip carry only an opaque handle —
  your call, but say which.
- **Not a URL.** Chips carry no URLs and that rule holds.
- **Degrades to today's path.** Absent, expired or invalid means "run understanding as usual",
  never an error.

If it does not fit the architecture, say so and why — the transcript-honesty requirement (the
tap must still show as a normal guest bubble) is the constraint we would guess at first.

### 3.4 The cheaper wins to answer alongside it

- **Turn on provider prompt caching for `chatbot.respond` and `chatbot.understand`.** The system
  prompt is identical across every guest of a site and is the large, stable part of the input. At
  0.1× on cache reads this is the best saving-to-effort ratio available, and nothing calls
  `->cache()` today. Is it off for a reason, or simply not wired?
- **Is there an embedding cache?** `modules/chatbot/docs/execution-plan.md` MD-6 defers
  `ai.caching.embeddings`, and we found no cache on the `TieredRetriever` path. Chip taps send a
  fixed set of strings, so their embeddings are the same handful of vectors forever.
- **Would a canned-answer path fit?** For "How does the Nest Pass work?" the honest answer is
  tenant copy that already exists in settings. Returning it via `responseText` with the
  `promo_card` attached costs nothing. Handler, a `chatbot.faq` setting, or nowhere — and what
  does it cost in answer quality when the guest's phrasing drifts from the chip's?
- **Is understanding skippable more narrowly?** If a turn's message is byte-identical to a chip
  message the server emitted earlier in the same conversation, intent is known with **no new
  field on the wire** — and therefore no contract change at all. Cheaper to ship than §3.3 and
  narrower in what it catches. Worth costing as the fallback.

---

## Deliverable

1. **The `chatbot.quick_prompts` value from §1.1 written** (overwriting the seeded value) on
   tenant `nest-hostels`' chatbot-enabled sites, **plus `chatbot.promo.show_at_init` set to
   `true`**, plus a written answer on the per-property price basis backfill.
2. **A chatbot-owned settings page** (§1.2 — not on `SiteResource`) for the five settings,
   validating exactly as `SiteContentElements` does, with the 6-chip cap enforced where the owner
   can see it.
3. **Three short answers** for Part 2's `total`, `more` and `cta_label`.
4. **A written answer to Part 3**: the 0.82-call explanation first, then cost per 1,000
   conversations and the short-circuit hit rate, then yes/no/why on the intent token, then
   decisions on prompt caching, the embedding cache, the canned-answer path and the
   byte-identical-message shortcut.
5. **If anything in Parts 1, 2 or 3 turns out to need a contract change, say so rather than
   doing it.** This now explicitly includes Part 3 — §3.3 is already known to be a 1.7.0
   surface. This consumer would rather be told than surprised by a version bump.

## Hard rules

- No breaking changes. The envelope is frozen; anything new is optional and omitted when absent.
- **No contract bump inside this task**, in any part. A bump is its own commit, tag, consumer-sync
  row and consumer prompt.
- Chips carry no URLs. Do not add one.
- Any intent token is server-issued and server-validated, or it does not ship.
- Chatbot settings stay out of L1 tenancy resources — see §1.2.
- Do not hand-edit a consumer's vendored packet copy; consumers re-vendor from your tags.
