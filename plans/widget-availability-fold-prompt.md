> **Written 2026-08-27, against widget `2.11.0` / `BUILT_AGAINST` `1.9.0`.** Not implemented —
> this is the brief plus the findings a scoping pass turned up, so the session that picks it up
> does not rediscover them. Line numbers are deliberately omitted and will drift anyway;
> **function names and the section banners in `nest-chatbot.js` are the durable reference**
> (`renderAvailability()` in `render`, the `Mock` fixtures in `api`, `STRINGS` in `i18n`). The
> shape below is stated as settled because the owner chose it; everything under "Open decisions"
> is genuinely open and is the first task. The last section is for the *other* repo — hand it to
> a session opened at `~/Herd/nest-mind`; nothing in it is done from here.

# Task — the availability card: one line per option, beds and rooms grouped, three per group and a fold

## Where you are

`nest-chatbot-ai` is Nest Hostels' branded guest chat widget: one drop-in `<script>` tag that
gives a host website the Germán bubble, talking to the wSuite chatbot API. Vanilla JS, **no
build step, no dependencies** — `nest-chatbot.js` is a single classic-script IIFE shipped
exactly as written, styled by `css/nest-chatbot.css`, demoed at `demo/index.html`.

**Read `CLAUDE.md` first, all of it.** Every rule in it has cost this repo something. The ones this
task walks straight into: never `innerHTML`; every user-visible string through `t()`/`tf()`; every
CSS rule scoped under `#nest-chatbot` with the `nc-` prefix and **no `font-family`** (the two-custom-
property typography seam), only 400 and 600 faces ship; **the focus rule** — anything that hides or
removes a node checks `document.activeElement` first; `afterRender()` after a render path, **never a
scroll**; no new listener outside `#nest-chatbot`; comments explain *why*.

## The ask

The `availability` element's options, rendered as a card the guest can actually read.

```
   ┌ bot bubble ────────────────────────────────────────┐
   │ Here is what we have for those dates …             │
   └────────────────────────────────────────────────────┘
        ┌──────────────────────────────────────────────┐
        │ BEDS IN SHARED ROOMS                         │   ← .nc-options-heading (from `basis`)
        │ Edinburgh (3 Bed Male)             44.00 EUR │   ← .nc-option: name | figure
        │ Mixed Dorm                         50.00 EUR │
        │ Mixed Dorm (Nest Pass - Weekly)    44.00 EUR │
        │   · · · 5 rows in the DOM, .nc-hidden · · ·  │
        │ PRIVATE ROOMS                                │
        │ Cartagena (Private Room)          102.00 EUR │
        │ Berlin (Private - Double Bed)     102.00 EUR │
        │ Tokyo (Private - Double Bed)      102.00 EUR │
        │ ( Show 5 more )                              │   ← button.nc-prompt.nc-options-more
        └──────────────────────────────────────────────┘
        [ Book now ]                                        ← the existing tail, untouched
```

Pressed, the five rows appear in place, the button reads `( Show less )` and its `aria-expanded`
flips; nothing scrolls. Pressed again, back to the picture above. A party of two gets the figure
the party pays and a line under the name saying how it is made:

```
        │ BEDS IN SHARED ROOMS                         │
        │ Mixed dorm                        200.00 EUR │   ← figure is `total` (units > 1)
        │ 2 beds · 100.00 EUR per bed                  │   ← .nc-option-sub
        │ Mixed Dorm (Nest Pass - Weekly)   176.00 EUR │
        │ 2 beds · 88.00 EUR per bed                   │
```

An option with no `basis`/`units`/`total` (a pre-1.8.0 server, or a room type the PMS snapshot
cannot say how it sells) renders as the pre-1.8.0 line — name and `price` — in an unlabelled group
exactly where the server put it. `available === false` is unchanged: the card says
`t('noAvailability')` and the Book button follows if there is a `url`.

On a 360px phone the figure stays on the name's **first** line and the name wraps under itself:

```
        │ Bed in Room 4 (Female    192.00 EUR│
        │ with 4 beds)                       │
        │ 2 beds · 96.00 EUR per bed         │
```

## Why now: eleven options, twenty-two lines, and the second line said the first again

Observed live on 2026-08-27 on nestshostels.com (widget 2.11.0, Italian locale): a Las Palmas Nest
booking turn for a solo guest returned an `availability` element with **eleven** `options[]`. That
is the designed output of the server — one option per room type × rate plan, and `StayResolver`
never caps, collapses or price-sorts (its only ordering is "the basis the guest asked for first",
stable, snapshot order otherwise). 2.11.0's renderer, adopting contract 1.8.0, printed two lines per
option: `Edinburgh (3 Bed Male) — 44.00 EUR per letto` and under it `1 letto · 44.00 EUR in totale`.
For `units = 1` the second line repeats the first — `total` is `price × 1`, the same string — so the
guest read twenty-two lines to learn eleven numbers, under a reply whose prose had already listed
most of them.

The prose is the backend's half (last section). The twenty-two lines are ours, and the owner chose
all four of the changes below.

## Findings that will bite

### 1. The server's order is a preference, not an accident — keep it inside each group

`StayResolver::prefer()` puts the options of the basis the guest asked for **first** and leaves the
rest in snapshot order; it never sorts by price (that is O-59 upstream, unowned). So the groups
must appear in **first-appearance order**, never "beds then rooms" by our choice, and rows keep
server order inside a group. Reordering here would make the card disagree with the reply, which was
written from the same list in the same order.

### 2. A card-wide cap hides exactly what the grouping exists to surface

With eight dorm plans first and three privates after them, any card-wide cap shows dorms and zero
privates. The cap is therefore **per group**: three visible in each, one button for the whole card.
And the cut is skipped when it would hide a single row — a group of exactly `OPTIONS_MAX + 1`
renders whole, because the button is taller than the row it would replace. That rule has a side
effect worth keeping: the hidden count is never `1`, so `showMore` needs no singular form. Drop the
slack and you owe five packs a `showMoreOne`.

### 3. A wrapping flex row puts the price under the wrong edge

"Bed in Room 4 (Female with 4 beds)" is a real vendor name. In a `flex-wrap` row the *figure* is
what drops to the next line, left-aligned under the name. The row is a **grid** —
`minmax(0, 1fr) auto` — so the name column shrinks below its content width and wraps its own text
while the figure keeps the right edge on the name's first line. `minmax(0, …)` is the load-bearing
half: a bare `1fr` never shrinks below `min-content`.

### 4. The focus rule, for the seventh time — and why this control is the easy case

`CLAUDE.md` § Conventions records six rediscoveries of the same bug. Here the hidden nodes are rows
with **no focusable element** in them, and the one control is never removed or replaced: its label
changes through `textContent` on the same node (the `armMenuConfirm()` rule — a guest is standing
on the button when it changes). So the rule's precondition cannot be true today. Say so in the
comment, and leave the recipe (`retireChipRows()` samples `document.activeElement` before removal)
for the day a row grows a link.

### 5. `.nc-hidden`, not a transition

Hidden rows stay in the DOM in server order wearing `.nc-hidden` (`display: none !important`):
out of the tab order and the accessibility tree, and **nothing animates**, so `afterRender()`
measures a settled layout. A `max-height` reveal would repeat the failure `resyncCarousels()` works
around with a timer, and the language row's own comment explains why an invisible-but-present node
is worse than a removed one.

### 6. `--nc-text-subtle` is the tempting wrong colour

"Muted" is the brief for the sub-line and the heading, and subtle is the token that sounds right.
On the card's `--nc-surface` grey it measures about 2.7:1 (the `.nc-day` rule records the
measurement) — under the 4.5:1 a 12px string that is meant to be read needs. Both new text rules
use `--nc-text`; size and weight carry the hierarchy.

### 7. The heading is load-bearing for a lone group

A single-unit row no longer says "per bed": the label moved into the heading. So a card with one
labelled group still gets its heading, or a solo guest's card no longer says whether 44.00 buys a
bed or a room.

### 8. The collapse can look like a scroll

When content shrinks the browser clamps `scrollTop` to the new maximum. Nothing was written, but a
test that asserts `scrollTop` unchanged across the collapse fails on correct behaviour. Assert
`scrollTop === min(before, scrollHeight − clientHeight)`.

### 9. The harness helper clicks the wrong `[aria-expanded]`

The scratchpad suites open the panel with `#nest-chatbot [aria-expanded]` — the first one, the
launcher. The fold adds a third such button inside the root. Target `.nc-toggler`.

### 10. Do not touch the reply text

The duplicate list in the prose is the backend's to fix. Never parse, trim or fold reply prose in
the widget — the text is rendered verbatim through `pre-wrap` by contract.

---

## The code

Goes in the `render` section, replacing `renderAvailability()`; the constant and the three helpers
sit directly above it the way `CARD_MAX` sits above the carousel code. The tail — the 1.6.0 dedupe
comment, `linkButton(t('book'), action.url, 'primary', null, rendered, 'availability')`,
`afterRender()`, `return row` — is **byte-for-byte untouched**.

```js
    /* ---------------------------------------------------------- availability */

    /*
     * The per-GROUP cap on option rows. A bed group and a room group each show
     * this many; everything past it is folded behind ONE "Show N more" button
     * at the foot of the card. Per group rather than per card, and that is the
     * whole point: the server orders "preferred basis first", never collapses
     * and never price-sorts (observed live 2026-08-27 — Las Palmas Nest, eleven
     * room-type × rate-plan options for a solo guest), so a card-wide cap of
     * any size would show eight dorm plans and zero privates, hiding exactly
     * the alternative the grouping exists to surface.
     *
     * Three is one screen's worth: two capped groups, two headings, the button
     * and the Book row fit under the reply bubble, so a guest sees the cheapest
     * of each kind without scrolling — the same two the reply prose is asked to
     * name. The cut is skipped when it would hide ONE row (a group of exactly
     * OPTIONS_MAX + 1 renders whole): the button is taller than the row it
     * would replace. A side effect worth keeping: the hidden count is never 1,
     * so `showMore` needs no singular form.
     */
    var OPTIONS_MAX = 3;

    /*
     * Options bucketed by `basis`, in order of FIRST APPEARANCE — never
     * beds-first or rooms-first by our choice. The server puts the basis the
     * guest asked for first, and keeping that is what keeps the card agreeing
     * with the reply. Three buckets at most: per_person, per_unit, and "no
     * basis" — absent, or a value this build does not know, which renders as
     * the pre-1.8.0 option because that is what ignoring what you do not
     * recognise means for a field VALUE. The null-item skip is the 2.11.0
     * hardening, kept.
     */
    function groupOptions(options) {
        var groups = [];
        var byBasis = Object.create(null);
        for (var i = 0; i < options.length; i++) {
            var option = options[i];
            if (!option) { continue; }
            var basis = (option.basis === 'per_person' || option.basis === 'per_unit') ? option.basis : '';
            if (!byBasis[basis]) {
                byBasis[basis] = { basis: basis, items: [] };
                groups.push(byBasis[basis]);
            }
            byBasis[basis].items.push(option);
        }
        return groups;
    }

    /*
     * One option, two columns: the vendor's name and the figure the guest pays.
     * `price` is, as it always was, the stay total for ONE bed or room; `total`
     * (1.8.0) is what the PARTY pays, and it is the server's string VERBATIM —
     * never price × units computed here: a bed price times a guessed party size
     * is a wrong quote on a link that will not honour it (response-contract.md,
     * `options[]`). So the figure is `total` exactly when there is a party to
     * pay it — units above one, with a basis this build knows to name the unit
     * — and `price` otherwise: for units = 1 the contract makes that the same
     * string, and for a pre-1.8.0 option it is the only one there is. A party
     * row adds the unit line under the name ("2 beds · 44.00 EUR per bed"):
     * count noun and unit label from the pack, both figures from the wire, the
     * middle dot punctuation the way the em dash was in the old line. No unit
     * label on a single-unit row — the group heading says it, once.
     */
    function optionRow(option) {
        var row = el('div', 'nc-option');
        row.appendChild(el('div', 'nc-option-name', option.room || ''));
        var unitKey = option.basis === 'per_person' ? 'perBed'
            : (option.basis === 'per_unit' ? 'perRoom' : null);
        var party = !!unitKey && option.units > 1 && option.total != null && option.price != null;
        var figure = party ? option.total : option.price;
        if (figure != null) {
            row.appendChild(el('div', 'nc-option-figure', (figure + ' ' + (option.currency || '')).trim()));
        }
        if (party) {
            var each = (option.price + ' ' + (option.currency || '')).trim() + ' ' + t(unitKey);
            row.appendChild(el('div', 'nc-option-sub',
                tf(option.basis === 'per_person' ? 'bedsMany' : 'roomsMany', option.units) + ' · ' + each));
        }
        return row;
    }

    /*
     * The fold's one control, closed over the rows it hides. A closure per
     * CARD, not per anchor: a transcript carries a handful of these where it
     * carries dozens of CTAs, which is why linkButton() delegates and this does
     * not. Reveals in place and folds again. textContent on the SAME node for
     * the label, never a replacement (armMenuConfirm()'s rule): the guest is
     * standing on this button when it changes, and swapping the node would drop
     * them to <body>. The rows themselves hold no focusable node, so hiding
     * them cannot strand focus — if a row ever gains one, the collapse branch
     * must sample document.activeElement against each row first and move focus
     * here before the class lands. afterRender() and nothing that scrolls: the
     * fold is the guest's own act, and the anchor pad and the cue are what a
     * height change has to re-measure. No emit(): no UI toggle in this widget
     * reports itself, and this button carries no `data-wchat-el`, so the
     * delegated CTA listener in wire() never sees it either.
     */
    function optionsToggle(hidden) {
        var more = el('button', 'nc-prompt nc-options-more', tf('showMore', hidden.length));
        attrs(more, { type: 'button', 'aria-expanded': 'false' });
        more.addEventListener('click', function () {
            var expanding = more.getAttribute('aria-expanded') !== 'true';
            for (var i = 0; i < hidden.length; i++) {
                hidden[i].classList.toggle('nc-hidden', !expanding);
            }
            more.setAttribute('aria-expanded', expanding ? 'true' : 'false');
            // Read from the pack at press time, so a guest who switched language
            // gets the next label in the new one — the same "handlers read their
            // label fresh" line setLocale() draws for the prompt pills.
            more.textContent = expanding ? t('showLess') : tf('showMore', hidden.length);
            afterRender();
        });
        return more;
    }

    // The options card closes any open CTA group; the trailing booking button opens a
    // fresh row, which is returned for whatever follows.
    function renderAvailability(action, rendered) {
        if (action.available === false) {
            els.body.appendChild(el('div', 'nc-options', t('noAvailability')));
        } else if (action.options && action.options.length) {
            var list = el('div', 'nc-options');
            var hidden = [];
            var groups = groupOptions(action.options);
            for (var g = 0; g < groups.length; g++) {
                var group = groups[g];
                // A heading for every group WITH a basis, even a lone one: the
                // single-unit row no longer says "per bed", so the heading is
                // the only place the card says whether 44.00 buys a bed or a
                // room. No basis, no heading — the pre-1.8.0 card, rendered
                // where the server put it.
                if (group.basis) {
                    list.appendChild(el('div', 'nc-options-heading',
                        t(group.basis === 'per_person' ? 'bedsHeading' : 'roomsHeading')));
                }
                var shown = group.items.length > OPTIONS_MAX + 1 ? OPTIONS_MAX : group.items.length;
                for (var i = 0; i < group.items.length; i++) {
                    var row = optionRow(group.items[i]);
                    // Hidden rows stay IN the DOM, in server order, so revealing
                    // them is a class flip and a replay paints the same card.
                    // .nc-hidden is display: none — out of the tab order and the
                    // accessibility tree, and nothing transitions, so the pad
                    // and the cue measure a settled layout on the next line.
                    if (i >= shown) { row.classList.add('nc-hidden'); hidden.push(row); }
                    list.appendChild(row);
                }
            }
            // One button per card, at the foot, only when something is hidden:
            // a card with nothing to reveal must not grow a control that does
            // nothing — the `available` poll fixture's single option.
            if (hidden.length) { list.appendChild(optionsToggle(hidden)); }
            els.body.appendChild(list);
        }
        // … the existing 1.6.0/1.9.0 dedupe comment, linkButton(t('book'), …),
        // afterRender() and `return row` — unchanged.
    }
```

Three things the code buys without extra state:

- **Replay is collapsed for free.** `persistableActions()` keeps the element verbatim,
  `replayTranscript()` goes through `renderActions()` into this function, and `hidden` is rebuilt
  per render. Nothing joins the stored record.
- **The static gates still pass.** No `units *` / `price *` on a code line (the comments say `×`),
  no `innerHTML`, no listener outside `#nest-chatbot` — the button's listener is on a node the
  widget owns, inside `els.body`.
- **`option.units > 1`** — the contract says int; a string `"2"` coerces and prints "2 beds";
  `0` or a negative falls to the single-line path.

## The CSS

Replace the 2.11.0 `#nest-chatbot .nc-option-total` rule with the block below; keep `.nc-options`
and add `max-width: 100%` to it (the body is `overflow-x: hidden` — a card that ran past it would
be clipped, not scrolled; stating the ceiling in the rule beats leaving it implied by
`align-self`). Every selector under `#nest-chatbot`, every class `nc-`-prefixed, **no
`font-family`**, only 400/600, `--nc-accent` untouched — it is the card Book CTA's orange, spent
once per card.

```css
/* One option is a two-column row — the vendor's name, then the figure the guest
   pays — with, for a party, a third line under both. Grid rather than a
   wrapping flex row, and the phone is why: a wrapping row whose first item is a
   long vendor name ("Bed in Room 4 (Female with 4 beds)") drops the FIGURE onto
   a second line instead of wrapping the name, which puts the price under the
   wrong edge. Two tracks fix the outcome — the name column takes what is left
   and wraps its own text, and minmax(0, 1fr) is what lets it shrink below its
   content width at all. Baseline-aligned so a two-line name shares its first
   line with the figure. Rows stretch to the card (a column flex child's
   default), which is what puts every figure on one right edge. */
#nest-chatbot .nc-option {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 12px;
    align-items: baseline;
}

/* Vendor-authored, so an unbroken token must break rather than be clipped by
   the body's overflow-x: hidden — the same reason .nc-card-title declares it. */
#nest-chatbot .nc-option-name {
    overflow-wrap: break-word;
}

/* The number the guest asked for: 600 (only 400 and 600 ship), nowrap so a
   figure never splits from its currency code (ISO 4217 is three letters, so
   "12345.00 EUR" is as wide as this gets), right-aligned so every figure in the
   card shares one edge, and tabular numerals so the digits line up down that
   edge — the difference between a list and a table of prices. The string is the
   server's, via textContent; nothing here formats, rounds or derives it. No
   font-family: a div inherits from #nest-chatbot, so this adds no eleventh site
   to the two-custom-property typography seam. */
#nest-chatbot .nc-option-figure {
    font-weight: 600;
    white-space: nowrap;
    text-align: right;
    font-variant-numeric: tabular-nums;
}

/* The unit line under a party's total ("2 beds · 44.00 EUR per bed"). Spans
   both tracks so it sits under the name AND the figure rather than squeezing in
   beside the figure. Smaller and 400 is what makes it read as the footnote to
   the 600 figure above it. --nc-text, NOT --nc-text-subtle, even though "muted"
   is the brief: this line sits on the card's --nc-surface grey, where subtle
   measures 2.7:1 (the .nc-day rule records the measurement) — under the 4.5:1
   a 12px string that is meant to be read needs. Size and weight carry the
   hierarchy; colour is not asked to. */
#nest-chatbot .nc-option-sub {
    grid-column: 1 / -1;
    font-size: 12px;
    color: var(--nc-text);
}

/* The group label ("Beds in shared rooms" / "Private rooms") in the voice the
   welcome block's TRY ASKING label already uses — uppercased here, not in the
   pack, so a screen reader says the words. It carries the unit a single-unit
   row no longer states, so it is content, not decoration: --nc-text for the
   same contrast reason as the line above, on the same grey. Room above every
   heading but the card's first: the column's 4px gap is "between rows", and a
   heading has to read as the start of something. */
#nest-chatbot .nc-options-heading {
    margin-top: 6px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--nc-text);
}

#nest-chatbot .nc-options-heading:first-child {
    margin-top: 0;
}

/* The fold's one control. .nc-prompt supplies the outlined pill — the family
   var, 600, border, cursor, hover, focus ring — so this states only what
   differs inside a card: it must not stretch into a full-width bar (a column
   flex child would), it is a secondary control and sits a size under a prompt,
   and it wants a little room from the row above. A <button>, so the reset
   block's font-family: inherit is already in force under the .nc-prompt var. */
#nest-chatbot .nc-options-more {
    align-self: flex-start;
    margin-top: 4px;
    padding: 6px 12px;
    font-size: 12px;
}
```

**Width on phones, for the record:** below 1024px the panel is fullscreen and the body's content
width is `100vw − 30px`. The figure column is `auto` (nowrap, bounded by the three-letter code) and
the name column `minmax(0, 1fr)`; at 320px the name keeps roughly 175px and wraps. `.nc-prompt`'s
hover `transform: scale(1.02)` is inherited by the button and harmless in a column.

## Packs

Four keys in, three out, in all five packs (`en es it de fr`, identical key sets — `t()` falls back
per key to `en`, which would mask a missing translation). Keep `perBed`, `perRoom`, `bedsMany`,
`roomsMany` (the sub-line). **Remove** `stayTotal`, `bedsOne`, `roomsOne` — dead keys ship to every
page — and their assertions in `t12-contract190.mjs`. The comment above the block is rewritten;
its "two nouns × two forms" sentence is now false.

```js
            // en — Availability options (contract 1.8.0; grouped and folded since
            // 2.11.1). Two group headings, two unit labels, two count nouns —
            // plural only: the unit line exists only for a party above one —
            // and the fold's pair. No plural helper: the table IS the rule, and
            // German's plural of Zimmer is invariant, which a rule would have to
            // special-case.
            bedsHeading: 'Beds in shared rooms', roomsHeading: 'Private rooms',
            perBed: 'per bed', perRoom: 'per room',
            bedsMany: '%s beds', roomsMany: '%s rooms',
            showMore: 'Show %s more', showLess: 'Show less',
            // es
            bedsHeading: 'Camas en dormitorio compartido', roomsHeading: 'Habitaciones privadas',
            perBed: 'por cama', perRoom: 'por habitación',
            bedsMany: '%s camas', roomsMany: '%s habitaciones',
            showMore: 'Ver %s más', showLess: 'Ver menos',
            // it
            bedsHeading: 'Letti in dormitorio', roomsHeading: 'Camere private',
            perBed: 'per letto', perRoom: 'per camera',
            bedsMany: '%s letti', roomsMany: '%s camere',
            showMore: 'Mostra altri %s', showLess: 'Mostra meno',
            // de
            bedsHeading: 'Betten im Schlafsaal', roomsHeading: 'Privatzimmer',
            perBed: 'pro Bett', perRoom: 'pro Zimmer',
            bedsMany: '%s Betten', roomsMany: '%s Zimmer',
            showMore: '%s weitere anzeigen', showLess: 'Weniger anzeigen',
            // fr
            bedsHeading: 'Lits en dortoir', roomsHeading: 'Chambres privées',
            perBed: 'par lit', perRoom: 'par chambre',
            bedsMany: '%s lits', roomsMany: '%s chambres',
            showMore: 'Voir %s de plus', showLess: 'Voir moins',
```

`showMore`'s `%s` is never `1` — finding 2 — so there is no `showMoreOne`. Say so in the pack
comment, because an implementer who drops the slack rule then owes five singular keys.

## Fixtures and the demo

**`rooms`** (the `Mock.send` branch) becomes the Las Palmas shape for a party of two: eleven
options, `per_unit` first (the guest asked for a room — "preferred basis first"), four privates
(`OPTIONS_MAX + 1`: the slack path, shown whole), six dorm plans (cut to three, three hidden), and
the no-trio type **last**. The composed `url` line is unchanged from 2.11.0.

```js
                if (q.indexOf('rooms') !== -1) {
                    // The Las Palmas shape (observed live 2026-08-27 on 2.11.0):
                    // ELEVEN options, room type × rate plan, in the server's
                    // order — preferred basis first, snapshot order otherwise,
                    // never capped, never price-sorted. Four privates for this
                    // party of two (OPTIONS_MAX + 1: the slack path, shown
                    // whole), six dorm plans (cut to three), and one type the
                    // snapshot cannot say how it sells — no basis, no units, no
                    // total — which renders as the pre-1.8.0 line in an
                    // unlabelled group. `total` is price × units as the SERVER
                    // computed it; the widget prints the string and never does
                    // the multiplication. `price` is the stay total for ONE
                    // unit (three nights), never a per-night figure.
                    return reply(done, 200, {
                        reply: 'Here is what we have for those dates.',
                        actions: [{
                            type: 'availability',
                            available: true,
                            options: [
                                { room: 'Private double', price: '204.00', currency: 'EUR', basis: 'per_unit', units: 1, total: '204.00' },
                                { room: 'Private double (Non-refundable)', price: '183.60', currency: 'EUR', basis: 'per_unit', units: 1, total: '183.60' },
                                { room: 'Private twin', price: '210.00', currency: 'EUR', basis: 'per_unit', units: 1, total: '210.00' },
                                { room: 'Private triple', price: '246.00', currency: 'EUR', basis: 'per_unit', units: 1, total: '246.00' },
                                { room: 'Mixed dorm', price: '100.00', currency: 'EUR', basis: 'per_person', units: 2, total: '200.00' },
                                { room: 'Mixed Dorm (Nest Pass - Weekly)', price: '88.00', currency: 'EUR', basis: 'per_person', units: 2, total: '176.00' },
                                { room: 'Female Dorm', price: '104.00', currency: 'EUR', basis: 'per_person', units: 2, total: '208.00' },
                                { room: 'Bed in Room 4 (Female with 4 beds)', price: '96.00', currency: 'EUR', basis: 'per_person', units: 2, total: '192.00' },
                                { room: 'Edinburgh (3 Bed Male)', price: '92.00', currency: 'EUR', basis: 'per_person', units: 2, total: '184.00' },
                                { room: 'Male Dorm (Non-refundable)', price: '84.00', currency: 'EUR', basis: 'per_person', units: 2, total: '168.00' },
                                { room: 'Family room', price: '270.00', currency: 'EUR' }
                            ],
                            url: 'https://hotels.cloudbeds.com/en/reservation/uudLs6?checkin=2026-10-10&checkout=2026-10-13&adults=2'
                        }],
                        turn: turn
                    });
                }
```

**`available`'s poll fixture is unchanged** (one `per_person` option, `units: 1`): it now renders
as one row under a "Beds in shared rooms" heading with **no** button — the proof that a card with
nothing hidden grows no control. Its comment's "the singular '1 bed' path" phrase becomes "the
one-row card — nothing hidden, so no fold button".

Also: the keyword doc block above `Mock` (the `"rooms"` and `"available"` lines, matching the two
comments above); `demo/index.html`'s "Try the widget with…" paragraph (replace "`rooms` shows the
1.8.0 party totals" with "`rooms` shows eleven options the way a real Las Palmas turn returns them —
grouped into private rooms and beds, three per group with the rest behind *Show 3 more*, the
party's total as the figure and the per-bed price under the name"); `CLAUDE.md`'s harness table
rows `rooms` and `available` to the same effect. The "**Never derive `total`**" bullet in
`CLAUDE.md` stays as it is — the code still prints the server's string; if anything, add one
clause: the figure a party row shows *is* `total`, and a single-unit row shows `price`, which the
contract makes the same string.

---

## Settled — implement these, do not re-litigate

1. **One line when `units = 1`.** The sub-line exists only for a party above one; `total` and
   `price` are the same string otherwise, and the card said it twice.
2. **Groups from `basis`, first-appearance order.** A heading for **every** labelled group, even a
   lone one (finding 7); options with no `basis` — or a value this build does not know — form an
   unlabelled group rendered where the server put it, as the pre-1.8.0 line.
3. **`OPTIONS_MAX = 3`, per group, with the `+1` slack** (finding 2). One button per card, at its
   foot, only when something is hidden; expand ⇄ collapse; label via `textContent` on the same
   node; `aria-expanded`; `.nc-hidden`; `afterRender()`; **no scroll, no `emit()`**; replay renders
   collapsed.
4. **Two-column grid rows** (finding 3). The figure is `total` for a party and `price` otherwise;
   the bare currency code follows the figure, as today.
5. **`--nc-text`** for the heading and the sub-line (finding 6); `--nc-accent` untouched.
6. **`stayTotal`, `bedsOne`, `roomsOne` removed**, with their assertions.
7. **Patch → `2.11.1`.** New UI behaviour only: no `data-*` attribute, no `window.NestChatbot`
   method, nothing a host's `<script>` tag has to say; `BUILT_AGAINST` stays `1.9.0` and
   `docs/wsuite/` is untouched — `CLAUDE.md` § Conventions reserves minor for a contract sync.

## Open decisions — settle these first, they are the actual first task

1. **Does the fold button follow `setLocale()`?** `els.restart` does ("a live control, not frozen
   transcript"); the 2.11.0 strings inside the card do not (payload stays frozen). **Recommended:
   yes for the button** — stamp `data-nc-more="<count>"` on it and, in `setLocale()`'s repaint
   block, `querySelectorAll('.nc-options-more')` and re-derive the label from `aria-expanded` and
   the stamp (about six lines); headings and sub-lines stay frozen like the rest of the card. State
   whichever is chosen in the changelog.
2. **`aria-controls`** on the button needs ids on scattered rows; the ⋯ menu ships `aria-expanded`
   only and is the reviewed precedent. **Recommended: no.**
3. **Heading voice** — the uppercase 10.5px TRY-ASKING treatment (recommended: a category label) or
   the sentence-case 13px `.nc-chip-head` treatment (a question). Pick one and say why.
4. **`text-align: right` vs `end`** — identical for all five LTR locales; `end` is the zero-cost
   future-proofing. Either.
5. **One commit or two** — `chore(release): Fold the availability card as 2.11.1` alone, or a `fix:`
   for the renderer plus the release commit. The 2.10.x releases were single commits.
6. **The live suite** — edit `t13-live190.mjs` in place or add `t15`; the `2.11.0` literals in
   `t1`/`t12`/`t13` move either way.

## Version

**Patch → `2.11.1`.** See Settled 7. Add the `CHANGELOG.md` entry in the existing style: a
bold lede with the version class and why (the Las Palmas turn, eleven options, twenty-two lines,
`units = 1` repeating itself); then `### One line per option, and the figure is the party's`,
`### Beds and rooms, grouped in the server's order`, `### Three per group, the rest behind one
button`, `### The row is two columns`, `### Packs: four keys in, three out`, `### Fixtures`,
`### Verified` (mock and live, with counts and the quoted labels), and `### Handed upstream` (the
three items of the last section, one line each). `README.md` § What the visitor gets: "Booking
buttons, contact links (phone, WhatsApp, email) and live availability — beds and private rooms
grouped, three of each with the rest one tap away, and what the whole party pays when the server
knows it — rendered from the API's structured response, never parsed out of the reply text."

## Verification

**Assert the served source before trusting any result** — `python -m http.server` sends no
`Cache-Control` and Chromium serves your last edit's predecessor (`CLAUDE.md` § "The browser will
run your last edit's predecessor"). The dependency-free CDP harness from the 2.11.0 session lives
in that session's scratchpad (`%LOCALAPPDATA%\Temp\claude\c--Users-artur-Herd-nest-chatbot-ai-nest-chatbot-ai\8c646c3c-64b4-4a0e-baa8-95b9eec85fc6\scratchpad\`:
`cdp.mjs` with the HTTP cache bypassed and a `CDP_PORT` override, `t1-boot` … `t13-live190`); copy
it, serve on a **fresh port**, run headless Chrome with `--remote-debugging-port`, and pin
`NestChatbot.setLocale()` in every suite that asserts text — `data-locale="auto"` follows the
browser and the profile there is Italian. Make `openPanel()` click `.nc-toggler` (finding 9).

**`t12-contract190.mjs`** stays the "verbatim figures, untouched urls" suite: version `2.11.1`;
`nc-option-figure` and `nc-options-more` present in the served source and `nc-option-total`
absent from both the JS and the stylesheet; the key set above (`stayTotal`/`bedsOne`/`roomsOne`
× 0); `lastCard()` reads name / figure / sub / `hidden` per row; `rooms` → 11 rows, `Mixed dorm`
figure `200.00 EUR` + sub `2 beds · 100.00 EUR per bed`, `Private double` `204.00 EUR` no sub,
`Family room` `270.00 EUR` no sub; the locales' sub-lines; `available` → one figure, one heading,
**no** button, the anchor dedupe unchanged; replay compares figures.

**New `t14-options.mjs`** (grouping, cap, fold — EN unless noted):

1. Source: `var OPTIONS_MAX = 3`; no `innerHTML`; no `units *` / `price *`; listener counts still
   1 `window` / 3 `document`.
2. `rooms`: 11 `.nc-option` rows, names in fixture order.
3. Exactly two `.nc-options-heading`, texts `['Private rooms', 'Beds in shared rooms']` — server
   order, not beds-first.
4. Card child sequence: heading, 4 rows, heading, 6 rows, 1 row, button (14 children); `Family
   room`'s previous sibling is a `.nc-option` (no heading before the unlabelled group).
5. `.nc-hidden` rows: exactly 3, the last three dorm plans, computed `display === 'none'`.
6. Slack: all four private rows visible (a group of `OPTIONS_MAX + 1` is not cut).
7. Toggle: one `button.nc-options-more`, the card's last child, `type="button"`,
   `aria-expanded="false"`, text `Show 3 more`, has class `nc-prompt`, `alignSelf === 'flex-start'`.
8. Row styles: `.nc-option` `display === 'grid'`; figure `fontWeight 600`, `whiteSpace nowrap`,
   `textAlign right`, `fontVariantNumeric tabular-nums`; sub-line and heading `color ===
   'rgb(18, 51, 60)'` (`--nc-text`), never `rgb(123, 147, 154)`.
9. Expand: stash the node, `focus()`, `click()` → `aria-expanded 'true'`, text `Show less`, 0
   hidden, `document.activeElement` is the same node, `els.body.scrollTop` unchanged,
   `wchatLog.length` unchanged.
10. Collapse: click again → `aria-expanded 'false'`, `Show 3 more`, 3 hidden, same node, focus
    still on it, no `wchat` entry, `scrollTop === Math.min(before, scrollHeight − clientHeight)`
    (finding 8).
11. Keyboard: `Input.dispatchKeyEvent` Enter on the focused button toggles.
12. 360px viewport (`Emulation.setDeviceMetricsOverride`), expanded: the card's right edge is
    within the body; for `Bed in Room 4 (Female with 4 beds)` the figure's `top` equals the
    name's first-line `top`, and the name spans two lines.
13. `available`: one row, heading `Beds in shared rooms`, figure `100.00 EUR`, no sub, **no**
    button; exactly one anchor with the composed url.
14. Locales, `rooms` after `setLocale`: es headings `['Habitaciones privadas', 'Camas en
    dormitorio compartido']`, button `Ver 3 más` ⇄ `Ver menos`; it `Mostra altri 3` ⇄ `Mostra
    meno`; de `['Privatzimmer', 'Betten im Schlafsaal']`, `3 weitere anzeigen` ⇄ `Weniger
    anzeigen`; fr `Voir 3 de plus` ⇄ `Voir moins`.
15. Replay: expand the last card, `location.reload()`, open → the replayed card has
    `aria-expanded="false"`, 3 hidden, a label matching `/3/` (the boot locale is `it`).
16. Injected records (write `localStorage['nest-chatbot:default']` from a template captured after
    one `rooms` turn — read `readStore()` for the acceptance rules first — then reload): (a) a
    no-basis option **first**, then `per_unit`: the card's first child is a `.nc-option` and the
    `Private rooms` heading follows — first-appearance, not "unlabelled last"; (b) six no-basis
    options only: no headings, 3 visible + 3 hidden, `Show 3 more`; (c) four no-basis: no button;
    (d) 5 `per_person` + 5 `per_unit`: 4 hidden, `Show 4 more`; (e) `units: 2, price: null, total:
    null`: name only, no figure, no sub; (f) `basis: 'per_night', units: 2, total: '…'`: unlabelled
    group, figure is `price`, no sub.
17. Re-run `t6-scoping.mjs` (the demo page's own `.hidden` / `.message` / `.chat-header` must not
    move) and `node --check nest-chatbot.js`.

**Live** (`t13-live190.mjs`, or `t15`): per option, `units > 1` → figure ends with `total + ' ' +
currency` and the sub starts with `units + ' '`; `units === 1` or no trio → figure `=== price + ' ' +
currency`, sub `null`; `rows.length === options.length`; heading order equals first-appearance
order of `basis` in the payload; hidden count `=== Σ over groups of (n > 4 ? n − 3 : 0)`; the
button's text contains that number, and the button is absent when it is 0. Two turns: **Las Palmas
Nest, 1 adult** ("I'd like to book Las Palmas Nest for 1 adult from 14 to 17 September 2026" —
inside 90 days of the run) → grouped and capped, every row single-line; **a party of 2** (Puerto
Nest answered with a fresh snapshot on 2026-08-27) → totals as figures, sub-lines. Capture both
cards (`Page.captureScreenshot`) for the changelog, and **log the reply prose** — it is the
"before" evidence for the backend handoff. Real conversations are created on the real tenant;
`demo/demo.html` (gitignored) carries the public key and the live api base.

---

## Risks worth naming before you start

- **Mobile widths** are handled by the grid (`minmax(0, 1fr) auto`); test 12 proves the figure
  stays on the name's first line at 360px. If it drops under the name, the row is not a grid or a
  `min-width` crept in.
- **`white-space: nowrap` on the figure** is bounded by ISO 4217 (three letters). A non-ISO
  `currency` from a misbehaving server would widen the figure and, past the body width, be clipped
  rather than wrapped. Contract-compliant input cannot reach it; note it, do not defend against it.
- **A card with only no-basis options** (a pre-1.8.0 server): no headings, still one group, the cap
  still applies (tests 16b/16c).
- **The unlabelled group first** looks like a bare row above a heading — correct by the
  first-appearance rule, and rare (test 16a).
- **The replay path**: same function, fresh `hidden`, always collapsed; one closure per card, not
  per anchor — bounded.
- **The collapse can look like a scroll** (finding 8).
- **`--nc-text-subtle` is the tempting wrong colour** (finding 6).
- **The heading is load-bearing for a lone group** (finding 7).
- **The slack rule and the singular** (finding 2).
- **`[aria-expanded]` in the harness helper** (finding 9).
- **The static gates** — `no units *`, listener counts, no `innerHTML` — must keep passing; write
  `×` in comments, never `*`.
- **The version rule** — UI-only → `2.11.1`; `VERSION` is the single literal (`window.NestChatbot.version`
  reads it); `BUILT_AGAINST` untouched; every scratchpad suite's `2.11.0` literal moves.
- **Never touch the reply text** (finding 10).

---

## The other half — hand this to a `~/Herd/nest-mind` session

Nothing below is done from this repo (`CLAUDE.md` § The API: research it here, hand it over as a
prompt; the only thing this repo edits in `nest-mind` is the consumer-registry row, and this asks
for no row move). Copy the block verbatim.

```text
Hand this to a session opened at ~/Herd/nest-mind. Written from the widget repo
(nest-chatbot-ai) after a scoping pass on 2026-08-27; it names your files by class
and method because those are the durable reference — find them with grep, and
read docs/consumer-sync.md §4 and docs/decisions.md before changing anything.
Three items: one ask, one citation, one thing deliberately NOT asked.

CONTEXT. A live booking turn on nestshostels.com (widget 2.11.0, Italian locale,
Las Palmas Nest, solo guest, 2026-08-27) returned an `availability` element with
ELEVEN options[] (room type × rate plan). The widget now groups them by `basis`,
caps three per group behind a "Show N more" button and renders one line per
option (widget release 2.11.1). What the widget cannot fix is that the REPLY
PROSE enumerated the same eleven options beside the card, so the guest read the
list twice.

1. THE ASK — an instruction, not a filter. BookingHandler::viaProvider() writes
   one AvailabilityLines::option() line per option into the context block, and
   TurnPromptRenderer::modeInstruction() bounds only the stay summary ("present
   the booking option and summarise the stay in one or two sentences…"). No
   instruction tells the model that the list is already on screen. Add one in
   the same mode instruction, to the effect of:
     "The guest sees the full option list beside your reply. Do not repeat it.
      Name at most the cheapest bed and the cheapest room by `total`, in one
      sentence each, and point the guest to the list for the rest."
   Keep the option lines in the context (the model needs them to pick the two);
   change what it is told to do with them. Guard-test the rendered instruction
   byte-for-byte the way UnderstandTurnAgentInstructionsTest pins its prompt
   (TurnPromptRendererTest is where the mode instruction itself is covered),
   in every locale the renderer emits. Then verify LIVE against the deployed
   tenant: repeat the Las Palmas solo turn and paste the reply text into the
   commit body — the widget side's live log has the "before" for comparison.
   Do not solve this by trimming options[] on the wire: the widget, and any
   consumer, needs the full list; the contract says options are display-only
   and the widget's card is what shows them.

2. O-59 — order options[] by `total` within each `basis` (availability contract
   2.2.0, a MINOR, owned by wPms). Not asked for here; record the Las Palmas turn
   above as O-59's stated trigger in its entry: eleven unsorted plans is the
   case where "cheapest first" stops being cosmetic. The widget keeps server
   order inside each group by design, so the day O-59 ships the card sorts
   itself with no widget change.

3. NOT ASKED — property_cards on booking turns. D-069 and D-009 (one handler
   per turn) keep the card off the booking turn on purpose, and the widget's
   dedupe logic assumes it. If the owner wants the property card back beside
   availability, that is a design question for you, raised separately; nothing
   in this handoff depends on it.

Consumer-sync registry: nothing moves — no contract version changes here, and
the widget stays on BUILT_AGAINST 1.9.0.
```
