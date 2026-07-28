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
styles, and it never modifies your `<html>`, `<body>` or anything outside its own container.

## Options

| Attribute | Default | Description |
|---|---|---|
| `data-api-base` | — | The chatbot API origin. |
| `data-key` | — | Your public-scoped `ws_live_…` API key. Safe to expose — it is scoped to the guest chat routes of one site. |
| `data-property` | — | Which property the conversation is about. A matched name seeds the conversation's working memory, so answers are scoped to that property from the first message. Unknown names are not an error. |
| `data-locale` | `auto` | `auto` picks from the visitor's browser languages. Or force one of `en` `es` `it` `de` `fr`. |
| `data-position` | `right` | `right` or `left`. |
| `data-color` | `#0D6F82` | Accent colour for the launcher, buttons and focus ring. |
| `data-z-index` | `2147483000` | Raise or lower it if it fights with your own overlays. |
| `data-auto-open` | `false` | Open the panel on load instead of waiting for a click. |
| `data-debug` | `false` | Verbose console logging. Leave off in production. |
| `data-mock` | `false` | Serve replies from the built-in local fixtures instead of the API — the dev harness the demo page uses. Never on a production page. |

The key must be **public**-scoped — never embed a `full`-scope key or any provider key.

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
NestChatbot.version;   // '2.1.1'
```

## What the visitor gets

- A branded launcher that expands into a chat panel, full-screen on phones.
- Replies typed out character by character, with a thinking indicator while the API works.
- Booking buttons, contact links (phone, WhatsApp, email) and live availability, rendered from
  the API's structured response — never parsed out of the reply text.
- Language switching mid-conversation across English, Spanish, Italian, German and French,
  without losing the thread.
- Conversations that survive a page reload for 24 hours.
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
