# Task — wChatbot: configure the Nest welcome, confirm the 1.6.1 field sync, and cost the LLM path

You are working in the **wSuite backend** repo, which owns the guest chatbot API, the site
settings behind its guest-facing content, and the vendored contract packet
(`response-contract.md`, `integration-guide.md`, `chatbot.reference.js`) that consumers
integrate against.

This is a request from the **`nest-chatbot-ai` consumer** — Nest Hostels' branded drop-in
widget, currently at its own release `2.4.2` with `BUILT_AGAINST` `1.4.1`. It is **not** a
contract-change request and nothing here is a bug report: contract `1.6.1` is sound and this
consumer is the one behind. It has three parts, and only the first two ask for code.

1. **Configuration** — put a specific welcome on screen for the Nest sites, and make that
   configuration reachable by a human. Today it is not.
2. **A sync confirmation** — a field-by-field statement of what the server actually emits at
   1.6.1, so the consumer's upcoming sync adopts real fields rather than documented ones.
3. **An investigation** — what a guest turn costs in LLM calls and tokens, and what of it can
   be avoided. No implementation asked for in this part; a written answer is the deliverable.

---

## Read first

- `modules/chatbot/docs/response-contract.md` — the envelope, the element types, the Changelog.
- `modules/chatbot/src/Services/SiteContentElements.php` — the single parser/validator for
  `chatbot.quick_prompts`, `chatbot.promo` and `chatbot.cards`.
- `modules/chatbot/database/seeders/NestChatbotContentSeeder.php` — the working example of all
  three settings for this exact tenant.
- `modules/chatbot/src/Services/ChatOrchestrator.php` — the turn lifecycle, for Part 3.
- `modules/tenancy/src/Filament/Resources/Sites/SiteResource.php` — the site admin form, for
  Part 1's second half.

---

## Part 0 — consumer state (context; no work here)

So you know who is asking and what they already do:

- Widget `2.4.2`, `BUILT_AGAINST` `1.4.1`, packet vendored at `1.5.0` in its `docs/wsuite/`.
  It renders `property_cards`, `promo_card`, `quick_replies` and init `actions[]`, sends
  per-turn `locale`, and splits turn `404` (terminal) from poll `404` (transient).
- **It knows it owes you the 1.5.0 → 1.6.1 sync** and has your `consumer-sync.md` §4 prompt.
  The two SHOULDs it still owes — the D-043(c) Book-button dedupe and one-shot chip rows — are
  scheduled for its `2.5.0` alongside that sync. Do not re-report them.
- Since `2.4.2` an init `quick_replies` row **replaces** the widget's own built-in prompt
  pills rather than rendering beside them, per the contract's definition of what that row is.
  Consequence worth knowing when you configure the setting in Part 1: **whatever
  `chatbot.quick_prompts` contains is the entire welcome affordance for that site.** Configure
  one chip and the guest sees one chip. There is no widget-side fallback behind it any more.
- The widget renders a chip row **bare** — no heading above it. It has no way to label a
  server row, because the element carries no text field and the init envelope's `greeting` is
  spent introducing the assistant. That is a standing request, not part of this task.

---

## Part 1 — configure the Nest welcome, and make it configurable

### 1.1 The desired end state

One chip row at greeting time, five chips: two questions and the three islands.

| # | `label` (what the guest sees) | `message` (what the tap sends) |
|---|---|---|
| 1 | Find my hostel | Which hostel fits me best? |
| 2 | Nest Pass | How does the Nest Pass work? |
| 3 | Tenerife | Tenerife |
| 4 | Gran Canaria | Gran Canaria |
| 5 | Ibiza | Ibiza |

The short-label / full-question split is deliberate and is the reason the two fields exist: a
chip reading "Nest Pass" fits a 420px panel, while the message that reaches the understanding
pipeline is a whole question it can route on. Please keep them distinct rather than collapsing
both to the same string.

Five chips is within `SiteContentElements::MAX_CHIPS` (6). Written in the 1.6.0 keyed shape so
the row declares its language:

```php
$settings->put($siteId, 'chatbot.quick_prompts', [
    'locale' => 'en',
    'items' => [
        ['label' => 'Find my hostel', 'message' => 'Which hostel fits me best?'],
        ['label' => 'Nest Pass',      'message' => 'How does the Nest Pass work?'],
        ['label' => 'Tenerife',       'message' => 'Tenerife'],
        ['label' => 'Gran Canaria',   'message' => 'Gran Canaria'],
        ['label' => 'Ibiza',          'message' => 'Ibiza'],
    ],
]);
```

Apply it to every chatbot-enabled site of tenant `nest-hostels`. Follow the seeder's
idempotent, non-destructive convention — an owner edit must always win.

**One merged row is deliberate, and we are not asking for a second init row.** The islands sit
in the same row as the questions rather than in a row of their own. We know `island_choice` is
a separate, server-generated clarification row on a turn; that stays exactly as it is. This
part is configuration only, and it should require no backend change.

Three things to confirm rather than assume:

- **Does `message: "Tenerife"` route well?** A bare island proper noun is exactly the "short or
  ambiguous message" case the guide warns detection cannot resolve. If a one-word message
  routes worse than a sentence, say so and we will phrase them as questions instead — that is
  a one-line settings change, but only you can see the intent metrics that answer it.
- **Should `chatbot.promo.show_at_init` flip to `true`?** The seeder ships `false`, so the Nest
  Pass card is booking-turn only (`min_nights: 7`). Showing it at greeting time is a product
  decision for the owner; it is flagged here rather than changed. Note the two gates are
  independent, so a site with both set can show it at init **and** again on a qualifying
  booking turn — please confirm that is the intended reading of D-044's clarification.
- **Are `chatbot.cards.price_period` / `price_basis` correct per property?** 1.6.1 made these
  **per item**, and the Nest catalog is genuinely mixed — dorm beds quote `per_person`, an
  Ibiza property whose cheapest bookable thing is a private double quotes `per_unit`. The
  site-level seed (`night` + `per_person`) is right for most of the estate and wrong for the
  rest. Report which properties are backfilled and which still fall back to the site default,
  because a wrong basis is a guest-facing pricing error, not a cosmetic one.

### 1.2 The real ask — there is no admin surface for any of this

`SiteResource::form()` renders exactly one setting: the origin allow-list
(`TagsInput::make('settings.'.EnsureOriginAllowed::SETTING_KEY)`). There is **no form field
anywhere** for `chatbot.enabled`, `chatbot.greeting`, `chatbot.quick_prompts`,
`chatbot.promo` or `chatbot.cards`.

So the only ways to set the values above are `NestChatbotContentSeeder` or a `SiteSettings::put()`
in tinker. That is a gap with a sharp edge: **the seeder writes each key only when absent**, by
design, so it cannot correct a value once one exists. After the first write there is no
supported way for an owner to change their own welcome copy.

Please add the fields to the site admin form (or a dedicated chatbot settings page, if that fits
your Filament conventions better):

- `chatbot.enabled` — toggle.
- `chatbot.greeting` — text, with the `chatbot::chat.greeting` lang fallback shown as the
  placeholder so an empty field visibly means "use the default".
- `chatbot.quick_prompts` — a repeater over `items` with `label` + `message`, **max 6 enforced
  in the form**. Today the cap is applied silently at render, so a 7th chip an owner typed
  simply never appears with nothing explaining why.
- `chatbot.promo` — the `title` / `body` / `cta{label,url}` group plus `min_nights` and
  `show_at_init`. `body` needs a textarea: the contract allows `\n` in it.
- `chatbot.cards` — `price_period` and `price_basis` selects over the legal value sets, and
  `more_url`.

Two constraints worth designing to. Validation should mirror `SiteContentElements` exactly
rather than approximate it, so a value that saves cleanly cannot then be silently discarded at
render — that failure mode is invisible from the admin side. And the `locales` map both
settings accept is where per-language copy lives; whether that belongs in this form or behind a
"translations" affordance is your call, but the form should not make a `locales` key that
already exists impossible to keep.

---

## Part 2 — confirm what 1.6.1 actually emits

The consumer is about to adopt the 1.5.0 → 1.6.1 delta, and the contract documents the shape of
each field without always stating whether it is **emitted yet**. `image_alt` is the clear case —
documented and explicitly reserved — and building UI for a field that never arrives is wasted
work that then rots.

**Deliverable for this part: a table, not a code change.** For each field below: emitted today
yes/no, the trigger or path that emits it, and the setting or catalog column it reads from.

- `property_cards` — `total`, `more{label,url}`, item `cta_label`, `image_alt`,
  `price_from.period`, `price_from.basis`, and whether item order is catalog order in practice.
- `promo_card` — `locale`, `id` (and what it is derived from, since the consumer may key
  client-side frequency capping on it), and whether `body` newlines survive to the wire.
- `quick_replies` — `locale`, `id` (`quick_prompts` vs `island_choice`), and the resolution
  order when a `locales` block is partial.
- `conversation_ended` — the turn-cap element: emitted today? What is the cap number on this
  deployment, and is `reason` ever anything but `turn_cap`?

Two the consumer specifically needs, because they change what it renders:

- **Does the info path emit a `link_button` whose `url` equals a card CTA in the same
  `actions[]`?** The dedupe is a renderer SHOULD, and the consumer is implementing it — but its
  mock cannot reproduce the case (its fixture CTAs are three different URLs) so it has no test
  for it. A real payload where the collision occurs, or confirmation that it cannot, closes that.
- **What does init `actions[]` contain, exactly?** The contract says content elements only.
  Confirm `async_result` can never appear there — the consumer has no interim bubble to replace
  at init, and would render a stray second one.

---

## Part 3 — what does a turn cost, and what of it can be avoided?

This is the part with real money attached, and it is an **investigation**: we are asking for
numbers and an architectural answer, not a patch.

### 3.1 What we already read in your code

Stated so the question cannot be answered in generalities, and so you can correct us if any of
it is wrong:

- **Init is free.** `ConversationController` reads `chatbot.greeting` (or the lang fallback) and
  calls `SiteContentElements::initActions()`, which is two settings reads. No agent, no
  embedding. A site can be loaded a million times for zero tokens.
- **Element content is free.** Cards come from the properties catalog, promo and chips from site
  settings. The contract's "never LLM-composed" is literally true in the code.
- **But a turn always costs at least one LLM call.** `ChatOrchestrator::run()` computes
  `$chatCalls = 1 + ($generated ? 1 : 0) + ($summarizeTokens > 0 ? 1 : 0)`. That leading `1` is
  `UnderstandingService` → `gateway->structured(UnderstandTurnAgent)`, which runs
  **unconditionally, before handler dispatch**. Add `TieredRetriever`'s `gateway->embed()`.
- **The respond call is already skippable and you already skip it.**
  `HandlerResult::$responseText` "short-circuits generation (formulaic clarifications, no LLM
  call)", and `InformationHandler::islandChoiceChips()` uses exactly that path.
- **`->cache(` does not appear anywhere in `modules/ai/src` or `modules/chatbot/src`**, although
  `ModelPricing` prices `cacheWriteInputTokens` / `cacheReadInputTokens` at 1.25× / 0.1× and the
  builder exposes the option.

The consequence: a guest tapping "Nest Pass" pays understanding + embedding + respond, and the
next guest tapping the same chip pays it all again. A chip row is a **fixed, finite, server-authored
set of strings**, which is the most cacheable traffic the system has.

### 3.2 Publish the numbers

`chatbot_turn_metrics` already carries `llm_calls`, `total_tokens`, `handler`, `major_intent`
and `response_time_ms`, indexed on `(tenant_id, created_at)`, and `ModelPricing::cost()` can
price them. Please report, for a representative period:

- median and p95 `total_tokens` and `llm_calls` per turn, **split by `handler`**;
- the same per conversation;
- the share of turns whose `responseText` short-circuit fired (i.e. `llm_calls` without a
  respond call), which is the current deterministic-path hit rate;
- currency cost per 1,000 conversations at today's model settings.

Without these, every proposal below is guesswork on both sides.

### 3.3 The proposal: make a server-authored chip a zero-LLM turn

The specific ask. A chip the **server itself generated** is the one case where intent is known
before the guest acts — the server wrote both the label and the message. Yet the tap round-trips
as an anonymous free-text turn and pays for an understanding call to rediscover what the server
already knew.

Proposal: let a `quick_replies` item optionally carry an **opaque, server-issued intent token**,
which the turn endpoint accepts and validates to skip understanding and dispatch straight to the
handler. Combined with the `responseText` short-circuit you already have, an island tap becomes a
**zero-LLM-call turn**.

Properties this must have, and the reason each is non-negotiable:

- **Additive and optional.** Chips still send `message` as an ordinary guest turn. A consumer
  that ignores the field is unaffected, so it is a MINOR under your own versioning rules.
- **Server-issued and server-validated, never guest-authored.** This is the whole security
  surface: an unvalidated intent field is an intent-injection vector straight past understanding.
  Sign it, scope it to the conversation, or keep it server-side entirely and have the chip carry
  only an opaque handle — your call, but say which.
- **It must not become a URL.** Chips carry no URLs today and that rule should hold.
- **Degrade to the current path.** An absent, expired or invalid token means "run understanding
  as usual", never an error.

If this does not fit the architecture, say so and say why — the transcript honesty requirement
(the tap shows as a normal guest bubble) is the constraint we would guess at first.

### 3.4 The cheaper wins to answer alongside it

- **Turn on provider prompt caching for `chatbot.respond` and `chatbot.understand`.** The system
  prompt is identical across every guest of a site and is the large, stable part of the input.
  At 0.1× on cache reads this is the highest ratio of saving to effort available, and nothing
  currently calls `->cache()`. Is there a reason it is off, or has it simply not been wired?
- **Is there an embedding cache?** `execution-plan.md` MD-6 reads as though `ai.caching.embeddings`
  was deferred, and we found no cache on the `TieredRetriever` path. Chip taps send a fixed set of
  strings, so their embeddings are the same handful of vectors forever.
- **Would a canned-answer path fit?** For a chip like "How does the Nest Pass work?" the honest
  answer is tenant-authored copy that already exists in site settings. Returning it via
  `responseText` with the `promo_card` attached would cost nothing at all. Does that belong as a
  handler, as a `chatbot.faq` setting, or nowhere — and what does it cost in answer quality when
  the guest's phrasing drifts from the chip's?
- **Is understanding skippable more broadly?** If a turn's message is byte-identical to a chip
  message the server emitted earlier in the same conversation, the intent is known without any
  new field on the wire. Cheaper to ship than 3.3, narrower in what it catches — worth costing
  as the fallback option.

---

## Deliverable

1. **The `chatbot.quick_prompts` value from §1.1 applied** to tenant `nest-hostels`' chatbot-enabled
   sites, plus written answers on `show_at_init`, the per-property price basis backfill, and whether
   a bare island name routes acceptably.
2. **Admin form fields** for the five chatbot settings (§1.2), validating exactly as
   `SiteContentElements` does, with the 6-chip cap enforced where the owner can see it.
3. **The Part 2 emission table** — emitted / trigger / source column, per field, including what is
   reserved-but-not-emitted.
4. **A written answer to Part 3**: the measured numbers from §3.2, a yes/no/why on the intent-token
   proposal, and a decision on prompt caching, embedding caching and the canned-answer path.
5. If anything in Parts 1–2 turns out to need a contract change, **say so rather than doing it** —
   that is a separate 1.7.0 conversation, and this consumer would rather be told than surprised.

## Hard rules

- No breaking changes. The envelope is frozen; anything new is optional and omitted when absent.
- Chips carry no URLs. Do not add one.
- Any intent token is server-issued and server-validated, or it does not ship.
- Settings changes stay non-destructive — an owner edit always wins over a seed.
- Do not hand-edit a consumer's vendored packet copy; consumers re-vendor from your tags.
