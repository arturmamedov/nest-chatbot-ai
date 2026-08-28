# Rendering ownership — what the server supplies, what the widget composes

**About:** the Nest Chatbot drop-in widget (`nest-chatbot.js`), current as of release 2.11.1.
**For:** anyone asking "who writes this string?" — before changing a renderer, adding an element
type, or deciding whether something belongs in a pack or on the wire.

This is a **standing reference**, not a proposal and not a release record. The two other shelves in
`docs/` are neither: `docs/wsuite/` is the vendored, read-only contract packet (theirs, replaced
wholesale at each sync), and `docs/proposals/` holds design records addressed to the platform team
and anchored to the release that produced them. This file is ours, current, and about this renderer.

It answers one question the contract can only answer per-field across its nine element sections,
and that the code can only answer by being read: **for each element type, which of the things a
guest sees comes down the wire, and which does the widget make up?**

---

## The one rule

> The **server** supplies display text when the text is **tenant-authored content** — a promo, a
> chip, a property's name or badge, a CTA label a tenant can override.
>
> The **widget** supplies display text when it is **chrome it invented to describe structured data**
> the server deliberately sent as *data*: labels around numbers, enums and phone numbers.

Everything in the table below follows from that, including the case that looks inconsistent at first
glance — `availability` sends no display text at all, while `property_cards` sends almost nothing
but.

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
| **`property_cards`** | `name`, `location`, `badge` — raw catalog values, **not** localized. `cta_label` and `more.label` — **localized server-side**. `image`, `url`, and `price_from` (`amount`, `currency`, `period`, `basis`) as data. `total` as an int. | The price *number*, formatted by `Intl.NumberFormat` in the guest's locale (`cardPrice()`); `t('priceFrom')`'s wrapper around it; the `period`/`basis` suffix (`/night`, `per person`); `t('book')` **only** when `cta_label` is absent; `tf('showingOf', n, total)` when there is no `more`; and the carousel's a11y strings (`t('carousel')`, `t('properties')`, the arrow labels). |
| **`promo_card`** | Everything displayed: `title`, `body`, `cta.label` — tenant-authored, resolved per guest locale **all-or-nothing**. Plus `image`, `cta.url`, `style`, `locale`. | **Nothing.** Not one pack string. The widget adds only the `lang` attribute (from `locale`), the `role="region"` named by the payload's own `title`, and layout. A card missing `title`, `body`, `cta.label` or a usable `cta.url` is dropped rather than patched with a default. |
| **`quick_replies`** | Chip `label` and `heading` — tenant-authored, server-localized. Plus `id`, `locale`. | Only the row's `aria-label` fallback, `t('quickReplies')`, and **only** when there is no `heading`. Never a visible label: substituting our own line over a server row is explicitly forbidden by the contract. |
| **`link_button`** | `label`, localized server-side. Plus `url` and the `style` hint. | Nothing. The `style` hint is honoured, not composed. |
| **`booking_link`** | `url` only — **no label on the wire at all**. Plus the optional `summary` object. | `t('book')`. |
| **`contact_channels`** | The raw `phone` / `whatsapp` / `email` **values**. Nothing else — no labels, no hrefs. | Both the label (`tf('call', …)`, `t('whatsapp')`, `tf('email', …)`) **and** the href: `tel:`, `https://wa.me/`, `mailto:` are constructed here from the values, never taken verbatim from the payload. |
| **`availability`** | **No display text.** `room` (the PMS's raw vendor name), `price` / `total` / `currency` as decimal strings and an ISO 4217 code, `basis` as a bare enum (`per_person` \| `per_unit`), `units` as an int, `url`, and the `available` boolean. | **Every word.** The group headings ("Beds in shared rooms" / "Private rooms"), the count nouns ("2 beds"), the unit labels ("per bed"), the fold button ("Show 3 more" / "Show less"), `t('noAvailability')`, and `t('book')` on the trailing CTA. |
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

The one place the widget *does* build a href is `contact_channels` — and there it must, because the
payload carries a phone number, not a link.

### 3. What it means for `setLocale()`

The split above is exactly the rule for what repaints when the guest switches language:

- **Payload text is frozen** once rendered. Repainting a server string from a pack would be
  inventing a translation the tenant did not write. So `promo_card` copy, `quick_replies` labels and
  headings, `link_button` labels, card names and badges all stay as they arrived.
- **Widget text re-derives** on every switch, because re-deriving is the only way it can be right.

The 2.11.1 availability card is the worked example — its headings, count nouns, unit labels and
fold label all repaint, while `room` and the figures do not — and the day-separator pills are the
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
  § `property_cards`, § `promo_card`, § `quick_replies`, § `conversation_ended`).
- **Widget side** — `nest-chatbot.js` § `render`: `renderAction()` (which caller passes which
  label), `propertyCard()`, `cardTitle()`, `cardPrice()`, `renderPropertyCards()`,
  `renderPromoCard()`, `renderQuickReplies()`, `renderChannels()` / `channelLink()`,
  `renderAvailability()` and its helpers, and `linkButton()`.
- **The repaint rule** — `setLocale()` in § `flow`, and `CHANGELOG.md` 2.11.1 § "The card follows
  the language switcher".
