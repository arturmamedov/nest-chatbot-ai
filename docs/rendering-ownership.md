# Rendering ownership — what the server supplies, what the widget composes

**About:** the Nest Chatbot drop-in widget (`nest-chatbot.js`), current as of release 2.13.5.
**For:** anyone asking "who writes this string?" — before changing a renderer, adding an element
type, or deciding whether something belongs in a pack or on the wire.

This is a **standing reference**, not a proposal and not a release record. The two other shelves in
`docs/` are neither: `docs/wsuite/` is the vendored, read-only contract packet (theirs, replaced
wholesale at each sync), and `docs/proposals/` holds design records addressed to the platform team
and anchored to the release that produced them. This file is ours, current, and about this renderer.

It answers one question the contract can only answer per-field across its ten element sections,
and that the code can only answer by being read: **for each element type, which of the things a
guest sees comes down the wire, and which does the widget make up?**

---

## The one rule

> The **server** supplies display text when the text is **tenant-authored content** — a promo, a
> chip, a property's name or badge, a CTA label a tenant can override.
>
> The **widget** supplies display text when it is **chrome it invented to describe structured data**
> the server deliberately sent as *data*: labels around numbers, enums and phone numbers.
>
> Since 1.14.0 the **server** also sends back **the guest's own words** —
> `contact_channels.prefill.text`, a server-localized message around their quote — shown verbatim
> as a form value, never re-derived from a pack, never in an event or a log.
>
> Since 1.15.0 the **server** also says **who the guest is talking to**: the init's
> `assistant.name`, typed by the site owner. It is tenant-authored content like a promo title, so
> it is the server's — and until 2.13.2 it was the one tenant string this widget made up.
>
> Since 1.16.0 the **server** also sends **a form**, and every string a guest reads in it — title,
> intro, labels, options, placeholders, the submit label and the `submit_message` template — is
> the server's. The widget composes structure, ids, native controls and the filled message, and
> adds **no** pack string; the validation bubbles are the browser's own, in the browser's language.
>
> Since 1.17.0 the **server** also says **what a stay's prices are for**: `availability.heading`,
> "Prices for 3 nights for 2 guests", written and translated upstream so that a reworded line or a
> language beyond our five packs reaches the guest with no widget release (O-74). The widget draws
> it and composes nothing in its place — not from `summary`, which stays data.

Everything in the table below follows from that, including the case that looks inconsistent at first
glance — `availability` sends almost no display text (one line since 1.17.0, the `heading`), while
`property_cards` sends almost nothing but.

The reason is not an oversight upstream, it is stated policy. `response-contract.md` § Reading
`price_from`:

> Map them to a **localized suffix of your own** — the server deliberately sends neither
> pre-localized display text nor a composed string, because you are already formatting the number
> with `Intl.NumberFormat` in the guest's locale and need to compose the whole label.

The same reasoning governs an `availability` option's `basis`. So *"ask the backend to send those
words instead"* is not an option the contract leaves open, and it should not be: **whoever formats
the number has to own the sentence around it**, or the two drift and the guest reads a Spanish label
on an English figure.

---

## The table

| Element | The server supplies | The widget composes |
|---|---|---|
| ***(init)* `assistant`** — not an element; it rides the init `201` once per conversation | `name` — the assistant's display name, **tenant-authored and not localized** (a name is the same in every language), plain text, at most 24 characters, and **omitted** when the site set none. `disclosure` — the server's own "AI assistant" label, localized, always sent. And `greeting`, which arrives finished: where a site's greeting says the name, the server has already written it in. | **Never a name.** With one: the sentence around it — `placeholderNamed`, `openNamed`, `openUnreadNamed`, and `greetingNamed` only where the server sent no greeting — and the role in the dialog label (`name — t('assistantRole')`). Without one: the name-free strings under the same four keys and `t('title')`, the role, as the header title. In both cases the disclosure itself: the `aiAssistant` badge, `t('disclaimer')` and `assistantRole` come from our own pack — `disclosure` is ignored, being byte-identical in all five locales, so that it can follow `setLocale()`. |
| **`property_cards`** | `name`, `location`, `badge` — raw catalog values, **not** localized. `cta_label`, `more.label` and, since 1.16.0, `reason` ("Fully booked for these dates") — **localized server-side**. `image`, `url`, and `price_from` (`amount`, `currency`, `period`, `basis`) as data. `total` as an int. Since 1.16.0: `stay_total` (`amount`, `currency`, `basis?`) as data, on a stay result only, and the element's `ordering` as a bare enum (`catalog` \| `cheapest` \| `ranked`). | The price *number*, formatted by `Intl.NumberFormat` in the guest's locale (`cardPrice()`); `t('priceFrom')`'s wrapper around it; the `period`/`basis` suffix (`/night`, `per person`); `t('book')` **only** when `cta_label` is absent; `tf('showingOf', n, total)` when there is no `more`; and the carousel's a11y strings (`t('carousel')`, `t('properties')`, the arrow labels). Since 1.16.0: the stay total's words — `tf('stayTotal', '<amount> <currency>')` ("60.00 EUR total"), the figure **verbatim** and never computed from `price_from`, labelled by the availability card's own `t('bedsHeading')` / `t('roomsHeading')` for its `basis` (`cardStay()`, `stayText()`); and the order caption above a rail of two or more, `t('orderCheapest')` / `t('orderRanked')`, **only** for `cheapest` / `ranked` — never for `catalog` or an absent `ordering`, which is not a ranking (`orderText()`). Never a re-sort. |
| **`promo_card`** | Everything displayed: `title`, `body`, `cta.label` — tenant-authored, resolved per guest locale **all-or-nothing**. Plus `image`, `cta.url`, `style`, `locale`. | **Nothing.** Not one pack string. The widget adds only the `lang` attribute (from `locale`), the `role="region"` named by the payload's own `title`, and layout. A card missing `title`, `body`, `cta.label` or a usable `cta.url` is dropped rather than patched with a default. |
| **`quick_replies`** | Chip `label` and `heading` — tenant-authored, server-localized. Plus `id`, `locale` — since 1.16.1 (D-114) any two-letter language a tenant row was translated into (`uk`), taken as given into `lang`, never checked against our five packs. Since 1.16.0 an item may also carry `key` (never displayed — sent back as `action {type:'reply', payload:{key}}` beside the chip's `message`), `image` (an image source, `http`/`https` only) and `image_alt` (what the picture shows). | Only the row's `aria-label` fallback, `t('quickReplies')`, and **only** when there is no `heading`. Never a visible label: substituting our own line over a server row is explicitly forbidden by the contract. A chip `image` becomes a picture tile above the label, `alt` = `image_alt` or `""` (decorative); a picture that fails `safeHttpUrl()` is dropped and the chip kept. |
| **`link_button`** | `label`, localized server-side. Plus `url`, the `style` hint and, since 1.16.0, `id` (`book` \| `website` \| `directions`). | Nothing. The `style` hint is honoured, not composed, and `id` is never displayed: it is read only into `wchat:action`'s `cta` (`linkCta()`), `null` for an id this build does not know. |
| **`booking_link`** | `url` only — **no label on the wire at all**. Plus the optional `summary` object. | `t('book')`. |
| **`contact_channels`** | The raw `phone` / `whatsapp` / `email` **values** and, since 1.14.0, an optional `prefill`: `text` (a server-localized message in the guest's voice around their own words, verbatim), `subject`, and `hint` (a server-localized caption). No labels, no hrefs. | The labels (`tf('call', …)`, `t('whatsapp')`, `tf('email', …)`), the preview's caption and accessible name (`t('prefillCaption')` — `hint` is ignored; the pack carries the server's own translations), **and** every href: `tel:` (separators stripped, then `+` kept, a leading `00` turned into `+`, bare digits otherwise), `https://wa.me/<digits>` (neither `+` nor `00`), `mailto:` — constructed here from the values, never taken verbatim, and since 1.14.0 with `?text=` / `?subject=&body=` appended percent-encoded from what the preview shows at tap time. `prefill.text` itself is payload: the read-only textarea's value, above the links, never repainted, never in an event or a log. |
| **`availability`** | **One display line, since 1.17.0:** `heading` — what the options are priced for ("Prices for 3 nights for 2 guests", or "Prices for 3 nights" when the guest stated no party), **localized server-side**, sent on a synchronous answer with options and never on the async tool path. Otherwise data: `room` (the PMS's raw vendor name), `price` / `total` / `currency` as decimal strings and an ISO 4217 code, `basis` as a bare enum (`per_person` \| `per_unit`), `units` as an int, `url`, the `available` boolean, and `summary` (`property`, `check_in`, `check_out`, `adults` — `null` for an unstated party), which this widget does not read. | **Every other word.** The group headings ("Beds in shared rooms" / "Private rooms"), the count nouns ("2 beds"), the unit labels ("per bed"), the fold button ("Show 3 more" / "Show less"), `t('noAvailability')`, and `t('book')` on the trailing CTA. `heading` is drawn verbatim at the top of the card (`optionsTitle()`, `dir="auto"`), and when it is absent **nothing** stands in for it: never a stay label composed from `summary`, from `units` (a room count, not a party) or from the booking url's `adults`. Layout is the widget's too: since 2.13.5 a one-card `property_cards` followed by its `availability` share one `.nc-stay` wrapper, side by side wherever the transcript has room for both and stacked otherwise, by `flex-wrap` (`renderStayPair()`). |
| **`form`** *(since 1.16.0)* | **Every displayed string**: `title`, `intro`, each field's `label`, a `date_range`'s `labels.from` / `labels.to`, a select's option `label`s, `placeholder`s, a `consent` field's `link.label`, the `submit_label` — all localized server-side — and the `submit_message` template. Plus as data: `id`, each field's `name`, `kind`, `required`, `min` / `max`, pre-filled `value`, a select's option `key`s and the consent `link.url`. | **No pack string.** Structure and native controls — a `<form>` named by its `title` (else `submit_label`), a `<label for>` per input with `nc-f-*` ids, two date inputs whose ends are named by `labels` or else by the field's own `label` (never by words this widget would invent), a select's blank first option, `dir="auto"` on free text — and the guest's message: `submit_message` with each `{name}` filled by the chosen option's **label**, a range's `from → to`, or the value typed, shown as their bubble. The validation messages are the browser's, in the browser's language. A form this build cannot draw is dropped whole rather than patched. |
| **`conversation_ended`** | Nothing displayed — it is a state signal. | `t('newChat')` and the restart affordance around it. |
| **`async_result`** | Nothing displayed — `url` only. | Nothing; the interim reply is ordinary `reply` text. |

Reply text itself is always the server's, rendered verbatim through `white-space: pre-wrap`. The
widget never parses, trims or folds it.

---

## Three things that surprise people

### 1. "From the server" and "in the guest's language" are different questions

They have **different answers on the same property card**. `name`, `location` and `badge` are raw
catalog values in the *tenant's* authoring language and are not localized at all; `cta_label` and
`more.label` *are* localized server-side to the guest. The contract's item table carries a
**Localized** column precisely because of this, and it is worth reading before assuming a payload
string is in the guest's language.

The practical consequence: a Spanish guest sees a Spanish "Reservar ahora" on a card whose title
still reads "Las Eras Nest Hostel" and whose badge still reads "Nest Pass". That is correct — those
are names, not sentences.

### 2. Urls are server-composed and very nearly untouchable

Since contract 1.9.0 (D-071) every booking `url` arrives with the stay already on it —
`https://hotels.cloudbeds.com/{lang}/reservation/{code}?checkin=…&checkout=…&adults=N`. The only
transformation this file may apply to one is `safeHttpUrl()`'s `trim()` plus the anchored
`^https?://` test. Not parsing, not lowercasing, not stripping a query.

That is load-bearing beyond tidiness: the two Book-button dedupes are **raw-string comparisons**, and
they work only because the server composes both sides from the same inputs. Normalise either side
and the dedupe is what breaks.

Since 1.16.0 two more payload strings fall under the same `safeHttpUrl()` rule without being booking
links: a chip's `image`, which is only ever an image source, and a form `consent` field's
`link.url`, the privacy notice beside the box. Either one that fails the test is dropped and its
chip or checkbox kept.

The one place the widget *does* build a href is `contact_channels` — and there it must, because the
payload carries a phone number, not a link, and since 1.14.0 a pre-written message sent deliberately
as text, never as a URL. The message enters the link only percent-encoded, as a query value, from
what the preview shows at the moment of the tap.

### 3. What it means for `setLocale()`

The split above is exactly the rule for what repaints when `setLocale()` changes the language — a
host's call since 2.13.1; there is no on-screen switcher:

- **Payload text is frozen** once rendered. Repainting a server string from a pack would be
  inventing a translation the tenant did not write. So `promo_card` copy, `quick_replies` labels and
  headings, `link_button` labels, card names, badges and (1.16.0) reasons, every string in a `form`,
  the `prefill` preview's text and (1.17.0) an availability card's `heading` all stay as they
  arrived — the heading carries its own class, `.nc-options-title`, so the card's repaint, which
  matches `.nc-options-heading`, cannot reach it. So does the assistant's **name** (1.15.0): `setLocale('es')` turns "Ask Nesti
  anything…" into "Pregunta lo que quieras a Nesti…", and the only thing that did not move is the
  name. `paintAssistant()` is that repaint — one function for the header title, the dialog label,
  the placeholder and the launcher label, reading the name it was given and the pack it is in.
- **Widget text re-derives** on every switch, because re-deriving is the only way it can be right —
  since 2.13.1 that includes the `prefill` caption and the preview's accessible name, and since
  2.13.4 a card's stay-total line and the rail's order caption, re-read from the `data-nc-each` /
  `data-nc-basis` / `data-nc-order` stamps on `.nc-card-stay` and `.nc-card-order`. (Not yet
  everything: some widget text is painted from packs at render and never repainted — among it the
  `contact_channels` link labels, `t('book')` and `linkButton()`'s `t('open_link')` fallback,
  `t('noAvailability')`, a card's price line (`t('priceFrom')` and its period/basis suffixes — so
  on a 1.16.0 stay result the from-price stays in the old language while the total beside it moves), the
  rail's `tf('showingOf', …)` count line, and the carousel's and chip row's accessible names. A known
  gap, not a rule.)

The 2.11.1 availability card is the worked example — its headings, count nouns, unit labels and
fold label all repaint, while `room`, the figures and (since 2.13.5) the server's `heading` above
them do not — and the day-separator pills are the
older one. Both carry what they re-derive *from* as a `data-nc-*` stamp on the node itself: the
card's `basis` / `units` / joined price, the pill's stored epoch. A repaint with nothing to read
back would have to keep a registry there is nothing to keep in step with.

---

## Adding an element type

When a new type arrives, the branch in `renderAction()` is one half of the work and this table is the
other. Ask of every field the guest will see:

1. **Is it text a tenant or the catalog authored?** → payload, `textContent`, frozen at `setLocale()`,
   and check the contract's **Localized** column before assuming its language.
2. **Is it a label the widget invented around a number, an enum or a value?** → a pack key in all
   five locales, `t()` / `tf()`, re-derived at `setLocale()` from a `data-nc-*` stamp.
3. **Is it a url?** → `safeHttpUrl()` and nothing else, unless it is a contact value, in which case
   the widget constructs the scheme itself.

Then add the row here. The cost of not adding it is the question this file exists to answer being
asked again.

---

## Where each claim comes from

Every cell is traceable, and should be re-checked against these rather than against this file if the
two ever disagree:

- **Server side** — `docs/wsuite/response-contract.md`, the per-element field tables and their
  **Localized** column (§ `link_button`, § `contact_channels`, § `booking_link`, § `availability`,
  § `property_cards` with "Reading `stay_total`", § `promo_card`, § `quick_replies` with "Keyed chips
  and images", § `form` with "Submitting a form", § `conversation_ended`), and for the `action` a
  keyed chip or a submit sends back, `docs/wsuite/integration-guide.md` §3.2. For the init
  `assistant`: `docs/wsuite/integration-guide.md` §3.1 ("`assistant` — the assistant's name, and
  the AI disclosure") and the `assistant` paragraphs of the contract's Security rule and
  Accessibility sections.
- **The assistant seam** — `nest-chatbot.js`: `assistantNameOf()` / `cleanName()` (§ `storage`),
  `tn()` (§ `i18n`) and `paintAssistant()` (§ `dom`).
- **Widget side** — `nest-chatbot.js` § `render`: `renderAction()` (which caller passes which
  label), `propertyCard()`, `cardTitle()`, `cardPrice()`, `renderPropertyCards()`,
  `renderPromoCard()`, `renderQuickReplies()`, `renderChannels()` / `channelLink()` (with
  `telNumber()`, `prefillOf()` and `composeOnTap()` since 2.13.1), `renderAvailability()` and its
  helpers, and `linkButton()`. Since 2.13.4: `cardStay()` / `stayText()` / `orderText()`,
  `chipKey()` / `makeChipHandler()`, `linkCta()`, and the form — `renderForm()`, `formField()` with
  `textField()` / `selectField()` / `rangeField()` / `consentField()`, and `retireForms()`. Since
  2.13.5: `optionsTitle()` (the 1.17.0 `heading`) and `isStayPair()` / `renderStayPair()` (layout
  only — no string).
- **The repaint rule** — `setLocale()` in § `flow`, and `CHANGELOG.md` 2.11.1 § "The card follows
  the language switcher".
