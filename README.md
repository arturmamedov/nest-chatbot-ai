# Nest Chatbot AI

Germán, the Nests Hostels AI assistant, as a drop-in chat bubble for any website.

Vanilla JavaScript. No dependencies, no build step, no framework. One script tag.

## Embed it

```html
<script src="https://cdn.nestshostels.com/nest-chatbot/nest-chatbot.js"
        data-api-base="https://api.nestshostels.com"
        data-key="ws_live_xxxx.yyyy"
        data-property="Las Eras Nest Hostel"
        data-locale="auto"
        defer></script>
```

That is the entire integration. The widget builds its own DOM and loads its own stylesheet —
there is no markup to paste and no CSS to link. Assets resolve against the script's own URL, so
it works from a CDN, a subdirectory, or any origin. (If the site has an origin allow-list
configured on the chatbot API, the embedding page's origin must be registered — see
[Origins](#origins) below.)

It will not touch your page: all of its CSS is scoped to `#nest-chatbot`, it defines no global
styles, and it never modifies your `<html>`, `<body>` or anything outside its own container. It
also declares its own typography and form styling outright, so a CSS framework's `h2` or
`textarea:focus` reset — Tailwind's preflight, `@tailwindcss/forms`, Bootstrap — does not reach
inside it either.

## Options

| Attribute | Default | Description |
|---|---|---|
| `data-api-base` | — | The chatbot API origin. |
| `data-key` | — | Your public-scoped `ws_live_…` API key. Safe to expose — it is scoped to the guest chat routes of one site. |
| `data-property` | — | Which property the conversation is about. A matched name seeds the conversation's working memory, so answers are scoped to that property from the first message. Unknown names are not an error. |
| `data-locale` | `auto` | `auto` picks from the visitor's browser languages. Or force one of `en` `es` `it` `de` `fr`. |
| `data-position` | `right` | `right` or `left`. |
| `data-offset-x` | `35` | Distance in px from the side of the window. Bare number, no unit. |
| `data-offset-y` | `30` | Distance in px from the bottom. The panel follows the launcher. |
| `data-color` | `#0D6F82` | Accent colour for the launcher, buttons and focus ring. |
| `data-fonts` | `nest` | `nest` ships our Poppins/Montserrat. `host` matches your page's font. `system` uses the visitor's system font. The last two fetch no font files at all. |
| `data-font-heading` | — | An explicit stack for the header title and card names, e.g. `"Poppins, sans-serif"`. Overrides `data-fonts`. |
| `data-font-body` | — | An explicit stack for everything else. Overrides `data-fonts`. |
| `data-z-index` | `2147483000` | Raise or lower it if it fights with your own overlays. |
| `data-auto-open` | `false` | Open the panel on load instead of waiting for a click. |
| `data-debug` | `false` | Verbose console logging. Leave off in production. |
| `data-mock` | `false` | Serve replies from the built-in local fixtures instead of the API — the dev harness the demo page uses. Never on a production page. |

The key must be **public**-scoped — never embed a `full`-scope key or any provider key.

### Positioning

If the launcher lands on top of your own floating furniture — a cookie bar, a back-to-top arrow,
a toast — nudge it with `data-offset-x` / `data-offset-y`. Both take a bare number of pixels, and
the panel is positioned from the same values, so it stays 10px above the launcher wherever you
put it. Below 520px the widget tightens to 20px on both axes by itself; setting either attribute
overrides that at every width.

For anything the two attributes cannot express — `rem`, `vh`, `calc()`, a breakpoint of your own —
override the custom properties instead:

```css
#nest-chatbot { --nc-edge-x: 2rem; --nc-edge-y: calc(env(safe-area-inset-bottom) + 24px); }
```

The widget injects its stylesheet into `<head>`, so put that rule in a sheet or `<style>` that
loads after it — or use `html #nest-chatbot { … }` and stop caring about order.

### Fonts

By default the widget brings its own Poppins and Montserrat (37KB of WOFF2, served from the same
origin as the script — never Google Fonts), so Germán looks the same on every site he lands on.

Those three files are fetched when the page loads, not when the chat opens — the panel exists
from the start, just hidden. They never delay a paint (`font-display: swap`), but they are 45KB
on every visit.

If your theme already serves the same families, or you would rather the widget simply looked
like the rest of your site, say so and it stops fetching fonts entirely:

```html
data-fonts="host"      <!-- inherit your page's font -->
data-fonts="system"    <!-- the visitor's system font -->
```

`host` reads your `<body>`'s computed font once at load and nothing else — it never writes to
your page. For a specific stack, name it, and mix freely with `data-fonts`:

```html
data-font-heading="Poppins, sans-serif"
data-font-body="Montserrat, sans-serif"
```

Naming a family your page already serves is the efficient version of `data-fonts="nest"`: the
widget uses the copy you have loaded rather than fetching a second one. Values are plain family
lists — anything with brackets, semicolons or `var()` is ignored, so use the custom properties
for those:

```css
#nest-chatbot { --nc-font-heading: var(--my-display); --nc-font-body: var(--my-text); }
```

Those two custom properties cover every piece of text in the widget.

### Origins

By default the chatbot API accepts the widget from any origin, so local development needs no
registration step. If the site has an origin allow-list configured, the exact origin of every
page that embeds the widget (`scheme://host[:port]`) must be registered on it, or requests are
refused with `403 {"message":"Origin not allowed."}`.

## Controlling it from your own code

```js
NestChatbot.open();
NestChatbot.close();
NestChatbot.toggle();
NestChatbot.setLocale('es');
NestChatbot.destroy();
NestChatbot.locale;    // 'es'
NestChatbot.version;   // '2.10.0'
NestChatbot.state;     // a snapshot — see Measuring it, below
```

## Measuring it

The widget reports what it is doing as ordinary DOM events, so your existing analytics can pick
them up. **It never sends anything anywhere itself** — no request of its own, no beacon, no
pixel, no third-party script. The events reach your page and you decide what to do with them.
A page that listens to nothing pays nothing, so there is no attribute to switch this off.

Every event fires twice: once under its own name, and once under a bare `wchat` carrying the
same payload plus a `name` field. Use whichever suits — the umbrella means one listener also
receives events added in later releases. **Don't listen to both, or you will count everything
twice.**

```js
document.addEventListener('wchat', function (e) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(Object.assign({ event: 'wchat_' + e.detail.name }, e.detail));
});
```

Events bubble from the widget's own container, so a listener on `document` or `window` works.

| Event | Fires when | Payload |
|---|---|---|
| `wchat:ready` | the widget has booted | `version`, `locale`, `mock`, `returning`, `storedTurns`, `expanded` |
| `wchat:open` | the panel opens | `source` (`toggler` \| `teaser` \| `auto` \| `api`), `firstOpen`, `resumed`, `turns` |
| `wchat:close` | the panel closes | `source` (`toggler` \| `close` \| `escape` \| `api`), `turns` |
| `wchat:message` | the visitor sends a message | `source` (`composer` \| `prompt` \| `chip` \| `welcome-chip`), `length`, `turns`, `locale` |
| `wchat:reply` | a reply arrives | `turn`, `length`, `elements[]`, `async`, `resolved`, `ended`, `latencyMs` |
| `wchat:action` | a booking / contact / card button is clicked | `element`, `url`, `channel`, `style`, `index` |
| `wchat:error` | a request fails | `phase` (`init` \| `turn` \| `poll`), `status`, `retrying` |
| `wchat:ended` | the conversation hits its turn cap | `turns` |
| `wchat:restart` | the visitor starts a new chat | `turns` |
| `wchat:locale` | the language is switched | `from`, `to` |
| `wchat:teaser` | the nudge appears or is dismissed | `action` (`shown` \| `dismissed`) |

**Returning visitors.** `wchat:ready` carries `returning: true` when this browser arrived with a
conversation still in progress, whether or not they open the panel; `wchat:open` carries
`resumed: true` when the panel actually reopened onto it. The window is how long a conversation
survives, and the **server** sets it — the widget reads it at the start of each conversation
and follows it, so if the window is widened you will see `returning: true` reach further back
without changing anything on your page.

**No message text ever leaves.** Payloads carry counts, enums and booleans: `length` is a
character count, `elements[]` lists element types. What the visitor wrote and what the assistant
replied stay in the widget. `wchat:action` carries the `url` of the button that was clicked so
you can attribute a booking, and deliberately carries **no** `url` for phone and email links —
`channel` tells you which was used without putting contact details in your analytics.

**Three counting notes.** On the turn that hits the cap, `wchat:ended` arrives *before* that
turn's `wchat:reply` — the reply event is emitted last so it can report `ended: true`
accurately, which is the more useful of the two orderings. An async turn (a gated availability lookup) fires `wchat:reply` twice —
once for the interim answer, once when the final one lands with `resolved: true`; filter on it if
you are counting replies. And `wchat:error` with `retrying: true` is not a visitor-visible
failure: the widget is transparently reopening an expired conversation and the visitor still gets
their answer.

**Consent is yours to handle.** These are DOM events on your page, so gate the listener behind
your own consent tooling like any other tag. Nothing is recorded until you record it.

The reasoning behind this surface — and what it deliberately cannot tell you — is in
[`docs/proposals/visitor-measurement-and-events.md`](docs/proposals/visitor-measurement-and-events.md).

**Why `wchat:` and not `nest-chatbot:`.** The events are new surface and already use the
vendor-neutral name this widget is heading towards; the script tag, the container id and
`window.NestChatbot` keep their current names until a major release moves them together.

`NestChatbot.state` returns the same picture at any moment — useful when your analytics loads
after the widget and misses `wchat:ready`:

```js
NestChatbot.state;
// { version, locale, open, expanded, started, returning, resumed,
//   turns, guestTurned, ended, destroyed, conversation }
```

## What the visitor gets

- A branded launcher that expands into a chat panel, full-screen on phones.
- Replies typed out character by character, with a thinking indicator while the API works.
- Booking buttons, contact links (phone, WhatsApp, email) and live availability, rendered from
  the API's structured response — never parsed out of the reply text.
- Language switching mid-conversation across English, Spanish, Italian, German and French,
  without losing the thread.
- Conversations that survive a page reload, for as long as the server keeps them alive.
- Keyboard accessible: `Enter` to send, `Esc` to close, focus moves into the composer on open,
  new replies announced to screen readers.

## Development

```bash
python -m http.server 5501
open http://127.0.0.1:5501/demo/index.html
```

`demo/index.html` is a stand-in for a customer site. The live transport is the default; the
demo opts into the built-in fixtures with `data-mock="true"` — see [CLAUDE.md](CLAUDE.md) for
the keywords that drive each mock response type, the architecture, and the rules any change to
this repo has to respect.

The API contract lives in [`docs/wsuite/`](docs/wsuite/).
