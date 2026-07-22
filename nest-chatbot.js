/*!
 * Nest Chatbot AI — drop-in guest chat widget for Nests Hostels.
 * Vanilla JS. No dependencies. No build step. One script tag.
 *
 *   <script src="https://<host>/nest-chatbot/nest-chatbot.js"
 *           data-api-base="https://api.nestshostels.com"
 *           data-key="ws_live_<prefix>.<secret>"
 *           data-property="Las Eras Nest Hostel"
 *           data-locale="auto"
 *           defer></script>
 *
 * The widget builds its own DOM and injects its own stylesheet — a host page adds
 * nothing but the tag above.
 *
 * SECURITY — non-negotiable, see docs/wsuite/response-contract.md §Security rule:
 *   Every guest / LLM / element string reaches the DOM via textContent,
 *   setAttribute or a created node. NEVER innerHTML. The single DOMParser call in
 *   this file (svgNode) is only ever handed module-local constant markup — it is
 *   never reachable from network or guest input.
 *   Element-supplied urls are honoured for http(s) only; tel:/mailto:/wa.me hrefs
 *   are constructed here from channel values, never taken verbatim.
 *
 * Built against response contract 1.2.0 (BUILT_AGAINST, api section) in
 * docs/wsuite/. The server reports its live contract_version at init; the widget
 * warns once — never fails — when the server is ahead. The reference
 * implementation is docs/wsuite/chatbot.reference.js — consult it when a detail of
 * the transport or the element contract is unclear.
 */
(function () {
    'use strict';

    var VERSION = '2.0.0';

    /* =========================================================== config ===== */

    var script = document.currentScript;
    if (!script) { return; }              // classic script only — see CLAUDE.md
    if (window.NestChatbot) { return; }   // already booted on this page

    var data = script.dataset || {};

    // Asset base = the directory this script was served from, NOT the host page.
    // Without this every image and the stylesheet 404 the moment the widget is
    // served from a CDN or any path other than the host's root.
    var assetBase;
    try {
        assetBase = new URL('./', script.src).href;
    } catch (e) {
        assetBase = './';
    }

    var SUPPORTED = ['en', 'es', 'it', 'de', 'fr'];

    var cfg = {
        apiBase: (data.apiBase || '').replace(/\/+$/, ''),
        key: data.key || '',
        property: data.property || '',
        locale: data.locale || 'auto',
        position: data.position === 'left' ? 'left' : 'right',
        color: data.color || '',
        zIndex: data.zIndex || '',
        autoOpen: data.autoOpen === 'true',
        debug: data.debug === 'true'
    };

    function log() {
        if (!cfg.debug || !window.console) { return; }
        console.info.apply(console, ['[nest-chatbot]'].concat([].slice.call(arguments)));
    }

    // The fixtures in the api section are the dev harness, and reaching them is
    // an explicit opt-in (the demo page sets data-mock="true"). A production tag
    // that forgot its config must fail loudly — no widget at all — never silently
    // serve a convincing fake chatbot, and never boot into a widget that errors
    // on every turn.
    var USE_MOCK = data.mock === 'true';
    if (!USE_MOCK && (!cfg.apiBase || !cfg.key)) {
        log('missing data-api-base or data-key — not booting');
        return;
    }

    function resolveLocale(pref) {
        if (pref && pref !== 'auto') {
            var explicit = String(pref).split('-')[0].toLowerCase();
            if (SUPPORTED.indexOf(explicit) !== -1) { return explicit; }
        }
        var prefs = navigator.languages || [navigator.language || 'en'];
        for (var i = 0; i < prefs.length; i++) {
            var primary = String(prefs[i]).split('-')[0].toLowerCase();
            if (SUPPORTED.indexOf(primary) !== -1) { return primary; }
        }
        return 'en';
    }

    /* ============================================================ state ===== */

    var locale = resolveLocale(cfg.locale);
    var conversationUuid = null;
    var started = false;    // a conversation exists
    var busy = false;       // a request is in flight
    var removed = false;    // torn down (403)
    var lastInitStatus = 0; // most recent init outcome — 429 turns "error" into "retry"
    var initWaiters = null; // callbacks queued behind an in-flight init
    var introPlayed = false;
    var els = {};

    /* ============================================================= i18n ===== */

    var STRINGS = {
        en: {
            subtitle: 'Nests Hostels AI assistant',
            placeholder: 'Message...',
            greeting: '¡Hola! Ciao, Hallo, Salut, Привiт... 👋\nHi, I\'m Germán, your AI assistant for everything about Nests Hostels!\nHow can I help you today?',
            open: 'Open the chat', close: 'Minimise the chat',
            send: 'Send message', input: 'Type your message',
            language: 'Change language', languageOf: 'Switch to %s',
            book: 'Book now', open_link: 'Open',
            call: 'Call %s', whatsapp: 'WhatsApp', email: 'Email %s',
            noAvailability: 'No availability for those dates.',
            error: 'Sorry, something went wrong. Please try again, or reach us directly and we\'ll be glad to help.',
            retry: 'We\'re getting a lot of messages right now — please try again in a moment.',
            timeout: 'This is taking longer than expected — please use the booking link above, or ask me again in a moment.'
        },
        es: {
            subtitle: 'Asistente IA de Nests Hostels',
            placeholder: 'Mensaje...',
            greeting: '¡Hola! Ciao, Hallo, Salut, Привiт... 👋\n¡Soy Germán, tu asistente IA para todo lo relacionado con Nests Hostels!\n¿En qué puedo ayudarte?',
            open: 'Abrir el chat', close: 'Minimizar el chat',
            send: 'Enviar mensaje', input: 'Escribe tu mensaje',
            language: 'Cambiar idioma', languageOf: 'Cambiar a %s',
            book: 'Reservar ahora', open_link: 'Abrir',
            call: 'Llamar %s', whatsapp: 'WhatsApp', email: 'Escribir a %s',
            noAvailability: 'No hay disponibilidad para esas fechas.',
            error: 'Lo siento, algo ha ido mal. Inténtalo de nuevo o escríbenos directamente y te ayudamos encantados.',
            retry: 'Estamos recibiendo muchos mensajes ahora mismo — inténtalo de nuevo en un momento.',
            timeout: 'Esto está tardando más de lo esperado — usa el enlace de reserva de arriba o pregúntame de nuevo en un momento.'
        },
        it: {
            subtitle: 'Assistente IA di Nests Hostels',
            placeholder: 'Messaggio...',
            greeting: '¡Hola! Ciao, Hallo, Salut, Привiт... 👋\nSono Germán, il tuo assistente IA per tutto ciò che riguarda Nests Hostels!\nCome posso aiutarti?',
            open: 'Apri la chat', close: 'Riduci la chat',
            send: 'Invia messaggio', input: 'Scrivi il tuo messaggio',
            language: 'Cambia lingua', languageOf: 'Passa a %s',
            book: 'Prenota ora', open_link: 'Apri',
            call: 'Chiama %s', whatsapp: 'WhatsApp', email: 'Scrivi a %s',
            noAvailability: 'Nessuna disponibilità per quelle date.',
            error: 'Mi dispiace, qualcosa è andato storto. Riprova o scrivici direttamente, saremo felici di aiutarti.',
            retry: 'Stiamo ricevendo molti messaggi in questo momento — riprova tra poco.',
            timeout: 'Ci sta mettendo più del previsto — usa il link di prenotazione qui sopra, o richiedimelo tra poco.'
        },
        de: {
            subtitle: 'KI-Assistent von Nests Hostels',
            placeholder: 'Nachricht...',
            greeting: '¡Hola! Ciao, Hallo, Salut, Привiт... 👋\nIch bin Germán, dein KI-Assistent für alles rund um Nests Hostels!\nWie kann ich dir helfen?',
            open: 'Chat öffnen', close: 'Chat minimieren',
            send: 'Nachricht senden', input: 'Schreibe deine Nachricht',
            language: 'Sprache wechseln', languageOf: 'Zu %s wechseln',
            book: 'Jetzt buchen', open_link: 'Öffnen',
            call: '%s anrufen', whatsapp: 'WhatsApp', email: 'E-Mail an %s',
            noAvailability: 'Keine Verfügbarkeit für diese Daten.',
            error: 'Entschuldigung, da ist etwas schiefgelaufen. Bitte versuche es erneut oder kontaktiere uns direkt.',
            retry: 'Wir bekommen gerade sehr viele Nachrichten — bitte versuche es gleich noch einmal.',
            timeout: 'Das dauert länger als erwartet — nutze bitte den Buchungslink oben oder frag mich gleich noch einmal.'
        },
        fr: {
            subtitle: 'Assistant IA de Nests Hostels',
            placeholder: 'Message...',
            greeting: '¡Hola! Ciao, Hallo, Salut, Привiт... 👋\nJe suis Germán, ton assistant IA pour tout ce qui concerne Nests Hostels !\nComment puis-je t\'aider ?',
            open: 'Ouvrir le chat', close: 'Réduire le chat',
            send: 'Envoyer le message', input: 'Écris ton message',
            language: 'Changer de langue', languageOf: 'Passer en %s',
            book: 'Réserver', open_link: 'Ouvrir',
            call: 'Appeler %s', whatsapp: 'WhatsApp', email: 'Écrire à %s',
            noAvailability: 'Aucune disponibilité pour ces dates.',
            error: 'Désolé, une erreur est survenue. Réessaie ou contacte-nous directement, nous serons ravis de t\'aider.',
            retry: 'Nous recevons beaucoup de messages en ce moment — réessaie dans un instant.',
            timeout: 'Cela prend plus de temps que prévu — utilise le lien de réservation ci-dessus, ou redemande-moi dans un instant.'
        }
    };

    var LANGUAGE_NAMES = {
        en: 'English', es: 'Español', it: 'Italiano', de: 'Deutsch', fr: 'Français'
    };

    function t(key) {
        var pack = STRINGS[locale] || STRINGS.en;
        return pack[key] != null ? pack[key] : STRINGS.en[key];
    }

    function tf(key, value) {
        return String(t(key)).replace('%s', value);
    }

    /* ========================================================== storage ===== */

    var STORE_KEY = 'nest-chatbot:' + (cfg.key || cfg.apiBase || 'default');
    var IDLE_MS = 24 * 60 * 60 * 1000;   // mirrors the API's conversation idle window

    function readStore() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (!raw) { return null; }
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.uuid || !parsed.ts) { return null; }
            if ((Date.now() - parsed.ts) > IDLE_MS) { return null; }
            return parsed.uuid;
        } catch (e) { return null; }
    }

    function writeStore(uuid) {
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify({ uuid: uuid, ts: Date.now() }));
        } catch (e) { /* private mode — the widget still works, just not across reloads */ }
    }

    function clearStore() {
        try { window.localStorage.removeItem(STORE_KEY); } catch (e) {}
    }

    /* ============================================================== api ===== */
    /*
     * THE SEAM. This is the only section that talks to the network, and the only
     * section the API session needs to touch.
     *
     * Contract (docs/wsuite/integration-guide.md §3):
     *   init  POST {apiBase}/api/v1/chatbot/conversations
     *         body {locale, property?}            → 201 {conversation:{uuid}, greeting,
     *                                                    contract_version}
     *   turn  POST {apiBase}/api/v1/chatbot/conversations/{uuid}/messages
     *         body {message, locale}              → 200 {reply, actions[], turn}
     *   poll  GET  {apiBase}{relative async_result.url}
     *                                             → 200 {status, reply?, actions?, turn}
     *   All three: Authorization: Bearer <public ws_live_ key>.
     *
     * Every callback is done(status, data) — the flow section below maps status
     * codes to behaviour.
     *
     * NOTE (open item, see CLAUDE.md): `locale` in the turn body is an additive
     * field not present in the frozen v1 spec — a v1 server ignores it. It exists
     * so a guest can switch language mid-conversation. Confirm it server-side when
     * the contract is revisited.
     */

    // The response-contract version this widget was built against. The init
    // response reports the server's live contract_version; if it is higher, the
    // server ships an element or field we do not render yet — warn ONCE and carry
    // on (the ignore-unknown rule keeps the widget fully functional; NEVER
    // hard-fail).
    var BUILT_AGAINST = '1.2.0';
    var contractWarned = false;

    // Compare dotted numeric versions a vs b: >0 if a is newer, <0 if older, 0 equal.
    function compareVersions(a, b) {
        var pa = String(a || '0').split('.');
        var pb = String(b || '0').split('.');
        for (var i = 0; i < 3; i++) {
            var na = parseInt(pa[i], 10) || 0;
            var nb = parseInt(pb[i], 10) || 0;
            if (na !== nb) { return na - nb; }
        }
        return 0;
    }

    // Deliberately NOT gated by data-debug — the sole production log. It fires at
    // most once per page load, only on real drift, and exists precisely for sites
    // where nobody sets data-debug (integration-guide §3.1).
    function checkContractVersion(serverVersion) {
        if (contractWarned || !serverVersion) { return; }
        if (compareVersions(serverVersion, BUILT_AGAINST) > 0) {
            contractWarned = true;
            if (window.console && console.warn) {
                console.warn('nest-chatbot: server response contract ' + serverVersion +
                    ' is newer than this widget (built against ' + BUILT_AGAINST + '). ' +
                    'Unrecognised elements are ignored safely; update the widget to render them. ' +
                    'See docs/wsuite/response-contract.md (Changelog).');
            }
        }
    }

    /* Transport — XHR, mirroring the reference widget's post()/get() (no Promise
     * dependency, ES5-safe). A network or CORS failure surfaces as done(0, null),
     * and an unparseable body parses to null — the flow section handles both. No
     * timeout, matching the reference: a stalled connection pins `busy` until the
     * browser gives up; adding xhr.timeout needs a double-callback guard, so it
     * stays a documented follow-up rather than a quick add. */
    function request(method, path, body, done) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, cfg.apiBase + path, true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.key);
        if (body != null) { xhr.setRequestHeader('Content-Type', 'application/json'); }
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) { return; }
            var parsed = null;
            try { parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = null; }
            done(xhr.status, parsed);
        };
        try { xhr.send(body == null ? null : JSON.stringify(body)); } catch (e) { done(0, null); }
    }

    var API = {
        init: function (done) {
            if (USE_MOCK) { return Mock.init(done); }
            request('POST', '/api/v1/chatbot/conversations',
                { locale: locale, property: cfg.property || undefined }, done);
        },

        send: function (uuid, text, done) {
            if (USE_MOCK) { return Mock.send(uuid, text, done); }
            request('POST', '/api/v1/chatbot/conversations/' + encodeURIComponent(uuid) + '/messages',
                { message: text, locale: locale }, done);
        },

        poll: function (path, done) {
            if (USE_MOCK) { return Mock.poll(path, done); }
            request('GET', path, null, done);
        }
    };

    /* -- fixtures -------------------------------------------------------------
     * Shaped exactly like the real envelope so the renderer below is fully
     * exercisable with no backend. Type a keyword to reach a branch:
     *
     *   "book"      → booking_link with a stay summary
     *   "contact"   → contact_channels (phone + whatsapp + email)
     *   "link"      → two link_buttons
     *   "available" → async_result: interim reply now, final reply after polling
     *   "rooms"     → availability with room options
     *   "!unknown"  → an unrecognised element type (must be ignored silently)
     *   "!xss"      → a hostile reply and a javascript: url (must both be inert)
     *   "!410" "!403" "!429" "!500" → force that status
     *   anything else → a plain reply
     */
    var Mock = (function () {
        var pollCounts = {};
        var turn = 0;

        function reply(done, status, body, delay) {
            setTimeout(function () { done(status, body); }, delay == null ? 550 : delay);
        }

        return {
            init: function (done) {
                reply(done, 201, {
                    conversation: { uuid: 'mock-' + Math.random().toString(36).slice(2, 10) },
                    greeting: t('greeting'),
                    contract_version: '1.2.0'
                }, 700);
            },

            send: function (uuid, text, done) {
                var q = text.toLowerCase();
                turn += 1;

                var forced = q.match(/^!(\d{3})$/);
                if (forced) { return reply(done, parseInt(forced[1], 10), null); }

                if (q.indexOf('!xss') === 0) {
                    return reply(done, 200, {
                        reply: '<img src=x onerror=alert(1)> <b>bold?</b>',
                        actions: [{ type: 'link_button', label: '<b>click</b>', url: 'javascript:alert(1)' }],
                        turn: turn
                    });
                }

                if (q.indexOf('!unknown') === 0) {
                    return reply(done, 200, {
                        reply: 'This reply carries an element type this widget has never heard of.',
                        actions: [
                            { type: 'totally_new_thing', payload: { a: 1 } },
                            { type: 'link_button', label: 'But this one still renders', url: 'https://nestshostels.com' }
                        ],
                        turn: turn
                    });
                }

                if (q.indexOf('contact') !== -1) {
                    return reply(done, 200, {
                        reply: 'Of course — here is how you can reach the team directly.',
                        actions: [{
                            type: 'contact_channels',
                            phone: '+34 922 123 456',
                            whatsapp: '+34 600 111 222',
                            email: 'hola@nestshostels.com'
                        }],
                        turn: turn
                    });
                }

                if (q.indexOf('available') !== -1) {
                    return reply(done, 200, {
                        reply: 'Let me check that for you — one moment.\nIn the meantime you can book directly here.',
                        actions: [
                            { type: 'booking_link', url: 'https://book.nestshostels.com/las-eras' },
                            { type: 'async_result', url: '/api/v1/chatbot/conversations/' + uuid + '/turns/' + turn }
                        ],
                        turn: turn
                    });
                }

                if (q.indexOf('rooms') !== -1) {
                    return reply(done, 200, {
                        reply: 'Here is what we have for those dates.',
                        actions: [{
                            type: 'availability',
                            available: true,
                            options: [
                                { room: 'Mixed dorm', price: '25', currency: 'EUR' },
                                { room: 'Private double', price: '68', currency: 'EUR' }
                            ],
                            url: 'https://book.nestshostels.com/las-eras'
                        }],
                        turn: turn
                    });
                }

                if (q.indexOf('book') !== -1) {
                    return reply(done, 200, {
                        reply: 'Great — Las Eras Nest Hostel has space for those nights.',
                        actions: [{
                            type: 'booking_link',
                            url: 'https://book.nestshostels.com/las-eras',
                            summary: { property: 'Las Eras Nest Hostel', check_in: '2026-08-01', check_out: '2026-08-05', adults: 2 }
                        }],
                        turn: turn
                    });
                }

                if (q.indexOf('link') !== -1) {
                    return reply(done, 200, {
                        reply: 'Here are the two places to look.',
                        actions: [
                            { type: 'link_button', label: 'Book now', url: 'https://book.nestshostels.com', style: 'primary' },
                            { type: 'link_button', label: 'Visit our website', url: 'https://nestshostels.com' }
                        ],
                        turn: turn
                    });
                }

                return reply(done, 200, {
                    reply: 'Yes — all our hostels have free wifi throughout, and breakfast is included every morning. Anything else you would like to know?',
                    actions: [],
                    turn: turn
                });
            },

            poll: function (path, done) {
                pollCounts[path] = (pollCounts[path] || 0) + 1;
                if (pollCounts[path] < 3) {
                    return reply(done, 200, { status: 'pending', turn: turn }, 60);
                }
                return reply(done, 200, {
                    status: 'ready',
                    reply: 'Yes! We have 4 beds free in the mixed dorm for those nights, at 25 € per night.',
                    actions: [{ type: 'booking_link', url: 'https://book.nestshostels.com/las-eras' }],
                    turn: turn
                }, 60);
            }
        };
    })();

    /* ============================================================== dom ===== */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text != null) { node.textContent = text; }
        return node;
    }

    function attrs(node, map) {
        for (var k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k) && map[k] != null) {
                node.setAttribute(k, map[k]);
            }
        }
        return node;
    }

    /**
     * Parse trusted, module-local SVG markup into a node.
     * Only ever called with the constants below — never with network or guest
     * data. This keeps the file free of innerHTML entirely.
     */
    function svgNode(markup) {
        var doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
        return document.importNode(doc.documentElement, true);
    }

    var ICONS = {
        minus: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon" viewBox="0 0 448 512" aria-hidden="true"><path d="M432 256c0 13.3-10.7 24-24 24H40c-13.3 0-24-10.7-24-24s10.7-24 24-24h368c13.3 0 24 10.7 24 24z"/></svg>',
        send: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon" viewBox="0 0 512 512" aria-hidden="true"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480v-83.6c0-4 1.5-7.8 4.2-10.8L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3.2 300.7 0 288.9s6.2-22.6 16.6-28.3l448-243.4c10.8-5.9 24-5 33.9 2.1z"/></svg>'
    };

    // Simplified national flags. Rendered into a 35px circle with object-fit:cover,
    // so the aspect ratio is cropped from the centre — no fine detail is needed.
    // The GB clip-path ids are uniquified per instance so two Union Jacks on the
    // same page cannot cross-reference each other's defs.
    var flagUid = 0;

    function flagMarkup(code) {
        var id = 'nc-uk-' + (++flagUid);
        switch (code) {
            case 'en':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" class="nc-flag">' +
                    '<clipPath id="' + id + 'a"><path d="M0,0 v30 h60 v-30 z"/></clipPath>' +
                    '<clipPath id="' + id + 'b"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>' +
                    '<g clip-path="url(#' + id + 'a)">' +
                    '<path d="M0,0 v30 h60 v-30 z" fill="#012169"/>' +
                    '<path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/>' +
                    '<path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#' + id + 'b)" stroke="#C8102E" stroke-width="4"/>' +
                    '<path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/>' +
                    '<path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/>' +
                    '</g></svg>';
            case 'es':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2" class="nc-flag">' +
                    '<rect width="3" height="2" fill="#AA151B"/>' +
                    '<rect width="3" height="1" y="0.5" fill="#F1BF00"/></svg>';
            case 'it':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2" class="nc-flag">' +
                    '<rect width="1" height="2" x="0" fill="#008C45"/>' +
                    '<rect width="1" height="2" x="1" fill="#F4F5F0"/>' +
                    '<rect width="1" height="2" x="2" fill="#CD212A"/></svg>';
            case 'de':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 3" class="nc-flag">' +
                    '<rect width="5" height="1" y="0" fill="#000"/>' +
                    '<rect width="5" height="1" y="1" fill="#D00"/>' +
                    '<rect width="5" height="1" y="2" fill="#FFCE00"/></svg>';
            case 'fr':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2" class="nc-flag">' +
                    '<rect width="1" height="2" x="0" fill="#002395"/>' +
                    '<rect width="1" height="2" x="1" fill="#fff"/>' +
                    '<rect width="1" height="2" x="2" fill="#ED2939"/></svg>';
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2" class="nc-flag"></svg>';
    }

    function flagNode(code) { return svgNode(flagMarkup(code)); }

    function injectStyles() {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = assetBase + 'css/nest-chatbot.css';
        document.head.appendChild(link);
    }

    function build() {
        var root = el('div');
        root.id = 'nest-chatbot';
        root.setAttribute('data-position', cfg.position);
        if (cfg.color) { root.style.setProperty('--nc-secondary', cfg.color); }
        if (cfg.zIndex) { root.style.setProperty('--nc-z', cfg.zIndex); }
        root.style.setProperty('--nc-loader-logo', 'url("' + assetBase + 'img/logotipo-nests-tenerife.png")');

        /* launcher */
        var toggler = el('button', 'nc-toggler');
        attrs(toggler, { type: 'button', 'aria-label': t('open'), 'aria-expanded': 'false' });
        var togglerIcon = el('img', 'nc-toggler-icon');
        attrs(togglerIcon, {
            src: assetBase + 'img/nest-chatbot_white.png', alt: '', width: '33', height: '33'
        });
        toggler.appendChild(togglerIcon);

        /* panel */
        var panel = el('div', 'nc-panel');
        attrs(panel, { role: 'dialog', 'aria-label': 'Germán — ' + t('subtitle'), 'aria-modal': 'false' });

        /* header */
        var header = el('div', 'nc-header');
        var headerInfo = el('div', 'nc-header-info');
        var headerLogo = el('img', 'nc-header-logo');
        attrs(headerLogo, { src: assetBase + 'img/avatar-header.png', alt: '', width: '55', height: '55' });
        var headerText = el('div', 'nc-header-text');
        headerText.appendChild(el('h2', 'nc-title', 'Germán'));
        var subtitle = el('span', 'nc-subtitle', t('subtitle'));
        headerText.appendChild(subtitle);
        headerInfo.appendChild(headerLogo);
        headerInfo.appendChild(headerText);

        var closeBtn = el('button', 'nc-close');
        attrs(closeBtn, { type: 'button', 'aria-label': t('close') });
        closeBtn.appendChild(svgNode(ICONS.minus));

        header.appendChild(headerInfo);
        header.appendChild(closeBtn);

        /* body */
        var body = el('div', 'nc-body');
        attrs(body, { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions text' });

        var loader = el('div', 'nc-loader');
        var progress = svgNode(
            '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" class="nc-progress" aria-hidden="true">' +
            '<circle class="nc-progress-bg" cx="90" cy="90" r="85"></circle>' +
            '<circle class="nc-progress-fg" cx="90" cy="90" r="85"></circle>' +
            '</svg>'
        );
        loader.appendChild(progress);
        body.appendChild(loader);

        /* footer */
        var footer = el('div', 'nc-footer');
        var controls = el('div', 'nc-controls');

        var lang = el('div', 'nc-lang');
        var langToggle = el('button', 'nc-lang-toggle');
        attrs(langToggle, { type: 'button', 'aria-label': t('language'), 'aria-expanded': 'false' });
        langToggle.appendChild(flagNode(locale));

        var langOptions = el('div', 'nc-lang-options');
        var optionButtons = {};
        SUPPORTED.forEach(function (code) {
            var option = el('button', 'nc-lang-option');
            attrs(option, { type: 'button', 'data-lang': code, 'aria-label': tf('languageOf', LANGUAGE_NAMES[code]) });
            option.appendChild(flagNode(code));
            option.appendChild(el('span', 'nc-sr-only', LANGUAGE_NAMES[code]));
            if (code === locale) { option.classList.add('nc-hidden'); }
            langOptions.appendChild(option);
            optionButtons[code] = option;
        });

        lang.appendChild(langToggle);
        lang.appendChild(langOptions);

        // novalidate: we validate in submit() and show no browser tooltips, but the
        // required/minlength constraints stay so :valid can light the send button.
        var form = el('form', 'nc-form');
        attrs(form, { novalidate: 'novalidate' });
        var input = el('textarea', 'nc-input');
        attrs(input, {
            rows: '1', minlength: '2', maxlength: '2000', required: 'required',
            placeholder: t('placeholder'), 'aria-label': t('input')
        });
        var send = el('button', 'nc-send');
        attrs(send, { type: 'submit', 'aria-label': t('send') });
        send.appendChild(svgNode(ICONS.send));

        form.appendChild(input);
        form.appendChild(send);
        controls.appendChild(lang);
        controls.appendChild(form);
        footer.appendChild(controls);

        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(footer);
        root.appendChild(toggler);
        root.appendChild(panel);
        document.body.appendChild(root);

        els = {
            root: root, toggler: toggler, panel: panel, body: body, loader: loader,
            progress: progress, form: form, input: input, send: send, close: closeBtn,
            controls: controls, langToggle: langToggle, langOptions: langOptions,
            optionButtons: optionButtons, subtitle: subtitle
        };
    }

    /* =========================================================== render ===== */

    function scrollDown() {
        if (els.body) { els.body.scrollTop = els.body.scrollHeight; }
    }

    function addBubble(role, text) {
        var wrap = el('div', 'nc-message nc-message--' + (role === 'guest' ? 'guest' : 'bot'));
        if (role !== 'guest') {
            var avatar = el('img', 'nc-avatar');
            attrs(avatar, { src: assetBase + 'img/germanavatar.png', alt: '', width: '45', height: '45' });
            wrap.appendChild(avatar);
        }
        var textNode = el('div', 'nc-text', text || '');   // textContent — never innerHTML
        wrap.appendChild(textNode);
        els.body.appendChild(wrap);
        scrollDown();
        return textNode;
    }

    function showThinking() {
        var wrap = el('div', 'nc-message nc-message--bot nc-thinking');
        var avatar = el('img', 'nc-avatar');
        attrs(avatar, { src: assetBase + 'img/germanavatar.png', alt: '', width: '45', height: '45' });
        var text = el('div', 'nc-text');
        var dots = el('div', 'nc-dots');
        dots.appendChild(el('div', 'nc-dot'));
        dots.appendChild(el('div', 'nc-dot'));
        dots.appendChild(el('div', 'nc-dot'));
        text.appendChild(dots);
        wrap.appendChild(avatar);
        wrap.appendChild(text);
        els.body.appendChild(wrap);
        scrollDown();
        return wrap;
    }

    function digits(value) { return String(value || '').replace(/[^0-9]/g, ''); }

    /**
     * Element-supplied urls are honoured ONLY for http(s). Innocent surrounding
     * whitespace is trimmed off the returned href; javascript:, data: and
     * anything hidden behind control characters fails the anchored test and is
     * dropped. Defence in depth — these urls are code-emitted server-side from
     * the catalog, never chosen by the model.
     */
    function safeHttpUrl(url) {
        if (typeof url !== 'string') { return null; }
        var trimmed = url.trim();
        return /^https?:\/\//i.test(trimmed) ? trimmed : null;
    }

    function linkButton(label, url, style) {
        var href = safeHttpUrl(url);
        if (!href) { log('dropped a non-http(s) url', url); return; }
        var link = el('a', 'nc-action' + (style === 'primary' ? ' nc-action--primary' : ''), label || t('open_link'));
        attrs(link, { href: href, target: '_blank', rel: 'noopener noreferrer' });
        els.body.appendChild(link);
        scrollDown();
    }

    function renderActions(actions, bubble) {
        if (!actions || !actions.length) { return; }
        for (var i = 0; i < actions.length; i++) { renderAction(actions[i], bubble); }
    }

    /**
     * One branch per element `type` from the v1 contract. Adding a new rich type
     * is exactly one new branch here.
     *
     * Unknown types are ignored silently and deliberately — the server ships new
     * element types ahead of any given widget, and breaking on one would take the
     * whole reply down with it.
     */
    function renderAction(action, bubble) {
        if (!action || !action.type) { return; }

        switch (action.type) {
            case 'async_result':
                if (action.url) { pollResult(action.url, bubble); }
                return;

            case 'link_button':
                linkButton(action.label, action.url, action.style);
                return;

            case 'booking_link':
                linkButton(t('book'), action.url, 'primary');
                return;

            case 'availability':
                renderAvailability(action);
                return;

            case 'contact_channels':
                renderChannels(action);
                return;

            default:
                log('ignoring unknown element type', action.type);
        }
    }

    function renderAvailability(action) {
        if (action.available === false) {
            els.body.appendChild(el('div', 'nc-options', t('noAvailability')));
        } else if (action.options && action.options.length) {
            var list = el('div', 'nc-options');
            action.options.forEach(function (option) {
                var line = (option.room || '') +
                    (option.price ? ' — ' + option.price + ' ' + (option.currency || '') : '');
                list.appendChild(el('div', null, line.trim()));
            });
            els.body.appendChild(list);
        }
        if (action.url) { linkButton(t('book'), action.url, 'primary'); }
        scrollDown();
    }

    function renderChannels(action) {
        var wrap = el('div', 'nc-channels');
        // Every href here is CONSTRUCTED from the channel value — never taken
        // verbatim from the payload.
        if (action.phone) {
            wrap.appendChild(channelLink(tf('call', action.phone), 'tel:+' + digits(action.phone)));
        }
        if (action.whatsapp) {
            wrap.appendChild(channelLink(t('whatsapp'), 'https://wa.me/' + digits(action.whatsapp)));
        }
        if (action.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(action.email)) {
            wrap.appendChild(channelLink(tf('email', action.email), 'mailto:' + action.email));
        }
        if (wrap.childNodes.length) {
            els.body.appendChild(wrap);
            scrollDown();
        }
    }

    function channelLink(label, href) {
        var link = el('a', 'nc-channel', label);
        attrs(link, { href: href, rel: 'noopener noreferrer' });
        // Only the wa.me channel navigates — open it in a new tab so the guest
        // keeps the host page (deliberate divergence from the reference, which
        // lets it navigate away). tel:/mailto: hand off to external handlers.
        if (/^https:/.test(href)) { attrs(link, { target: '_blank' }); }
        return link;
    }

    /* =========================================================== typing ===== */

    /**
     * Character-by-character reveal, built on a single Text node.
     *
     * The old implementation did `node.innerHTML += char` per character: it
     * re-parsed the whole bubble on every keystroke, and split emoji down the
     * middle because `.split('')` cuts surrogate pairs. Array.from + appendData
     * fixes both, and keeps the never-innerHTML rule intact.
     *
     * The cancellation token is PER NODE, not global: re-typing the same bubble
     * (the async poll replacing an interim reply) supersedes the run in flight,
     * while a bubble that is still typing elsewhere finishes undisturbed. A single
     * shared token truncated the greeting the moment the guest sent a message.
     */
    function typeText(node, text, done) {
        var token = (node.ncTypeToken || 0) + 1;
        node.ncTypeToken = token;

        var chars = Array.from(String(text == null ? '' : text));
        var textNode = document.createTextNode('');

        node.textContent = '';
        node.classList.add('nc-typing');
        node.appendChild(textNode);

        var i = 0;
        (function step() {
            if (token !== node.ncTypeToken || removed) { return; }
            if (i >= chars.length) {
                node.classList.remove('nc-typing');
                scrollDown();
                if (done) { done(); }
                return;
            }
            textNode.appendData(chars[i]);
            i += 1;
            if (i % 8 === 0) { scrollDown(); }
            setTimeout(step, 5 + Math.random() * 15);
        })();
    }

    /* ============================================================ intro ===== */
    /*
     * The branded loader is a join, not a fixed delay: the circular progress runs
     * WHILE the init request is in flight and the greeting appears once both the
     * animation and the network have finished. The animation costs the guest
     * nothing it was not already going to wait for.
     */

    var intro = { animDone: false, greeting: null, settled: false };

    function playIntro() {
        if (introPlayed) { return; }
        introPlayed = true;

        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduced) {
            intro.animDone = true;
        } else {
            els.progress.classList.add('nc-animate', 'nc-pulse');

            // Listen on the foreground circle, not the svg: only nc-progress
            // animates it, so `once` cannot be consumed by the pulse animation
            // running on the parent.
            var fg = els.progress.querySelector('.nc-progress-fg');
            fg.addEventListener('animationend', function (e) {
                if (e.animationName !== 'nc-progress') { return; }
                els.progress.classList.add('nc-logo-grow');
                setTimeout(function () { intro.animDone = true; introMaybeFinish(); }, 800);
            }, { once: true });

            // If animations are disabled at the browser or OS level, animationend
            // never fires — never leave the guest staring at a spinner.
            setTimeout(function () {
                if (!intro.animDone) { intro.animDone = true; introMaybeFinish(); }
            }, 5000);
        }

        startConversation(function () { introMaybeFinish(); });
        introMaybeFinish();
    }

    function introMaybeFinish() {
        if (intro.settled || !intro.animDone || intro.greeting === null) { return; }
        intro.settled = true;

        els.loader.classList.add('nc-loader--out');
        setTimeout(function () {
            els.loader.classList.add('nc-hidden');

            var wrap = el('div', 'nc-message nc-message--bot nc-greeting');
            var avatar = el('img', 'nc-avatar');
            attrs(avatar, { src: assetBase + 'img/germanavatar.png', alt: '', width: '45', height: '45' });
            var text = el('div', 'nc-text');
            wrap.appendChild(avatar);
            wrap.appendChild(text);

            // Insert directly after the loader, NOT at the end: the composer is
            // live while the intro runs, so an impatient guest can already have
            // sent a message. The greeting still has to read first.
            els.body.insertBefore(wrap, els.loader.nextSibling);

            requestAnimationFrame(function () {
                wrap.classList.add('nc-visible');
                typeText(text, intro.greeting);
            });
        }, 900);
    }

    /* ============================================================= flow ===== */

    function isOpen() { return els.root.classList.contains('nc-open'); }

    function open() {
        if (removed || isOpen()) { return; }
        els.root.classList.add('nc-open');
        els.toggler.setAttribute('aria-expanded', 'true');
        playIntro();
        setTimeout(function () { els.input.focus(); }, 320);
    }

    function close() {
        if (removed || !isOpen()) { return; }
        els.root.classList.remove('nc-open');
        els.toggler.setAttribute('aria-expanded', 'false');
        closeLanguageMenu();
    }

    function toggle() { isOpen() ? close() : open(); }

    function startConversation(cb) {
        var stored = readStore();
        if (stored) {
            conversationUuid = stored;
            started = true;
            if (intro.greeting === null) { intro.greeting = t('greeting'); }
            cb();
            return;
        }

        // One init at a time. The intro fires one, and a fast first submit would
        // fire a second (two conversations created, last uuid wins) — queue
        // behind the in-flight call instead.
        if (initWaiters) { initWaiters.push(cb); return; }
        initWaiters = [cb];

        API.init(function (status, body) {
            var waiters = initWaiters || [];
            initWaiters = null;
            if (removed) { return; }
            log('init', status, body);
            lastInitStatus = status;

            if (status === 403) { teardown(); return; }
            if (status === 201 && body && body.conversation && body.conversation.uuid) {
                conversationUuid = body.conversation.uuid;
                started = true;
                writeStore(conversationUuid);
                checkContractVersion(body.contract_version);
                intro.greeting = body.greeting || t('greeting');
            } else {
                // Never strand the guest behind a failed init — greet them anyway
                // and let the first real turn retry.
                intro.greeting = t('greeting');
            }
            for (var i = 0; i < waiters.length; i++) { waiters[i](); }
        });
    }

    function ensureConversation(cb) {
        if (started && conversationUuid) { cb(); return; }
        startConversation(cb);
    }

    function submit(e) {
        if (e) { e.preventDefault(); }
        if (busy || removed) { return; }

        var text = (els.input.value || '').trim();
        if (text.length < 2) { return; }

        els.input.value = '';
        adjustInputHeight();
        addBubble('guest', text);                     // textContent — a typed <img> stays text
        ensureConversation(function () { sendMessage(text, false); });
    }

    function sendMessage(text, isRetry) {
        if (!conversationUuid) {
            // A failed re-init lands here; a throttled one deserves "try again
            // shortly", not a hard error.
            addBubble('bot', lastInitStatus === 429 ? t('retry') : t('error'));
            return;
        }

        busy = true;
        els.send.disabled = true;
        var thinking = showThinking();

        API.send(conversationUuid, text, function (status, body) {
            if (removed) { return; }
            busy = false;
            els.send.disabled = false;
            log('turn', status, body);

            if (thinking.parentNode) { thinking.parentNode.removeChild(thinking); }

            if (status === 200 && body) {
                var bubble = body.reply ? addBubble('bot', '') : null;
                if (bubble) { typeText(bubble, body.reply); }
                renderActions(body.actions, bubble);
                return;
            }

            // Idled out (410) or unknown uuid (404 — guide §5: "treat the
            // conversation as gone; re-init"): re-init transparently and resend
            // once. The guest sees one reply, never a duplicate and never an
            // error. The reference re-inits on 410 only; §5 says 404 too.
            if ((status === 410 || status === 404) && !isRetry) {
                clearStore();
                conversationUuid = null;
                started = false;
                startConversation(function () { sendMessage(text, true); });
                return;
            }

            if (status === 403) { teardown(); return; }
            if (status === 429) { addBubble('bot', t('retry')); return; }

            addBubble('bot', t('error'));
        });
    }

    function teardown() {
        removed = true;
        // The only two listeners the widget ever attaches outside #nest-chatbot —
        // a destroyed widget must leave the document untouched.
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('keydown', onDocumentKeydown);
        if (els.root && els.root.parentNode) { els.root.parentNode.removeChild(els.root); }
    }

    /* ------------------------------------------------------------ async poll */
    // 2s → ×1.5 → 5s cap, give up at 120s. The interim reply and its fallback
    // links are already on screen, so a give-up is a delay, never a dead end.

    var POLL_START_MS = 2000, POLL_FACTOR = 1.5, POLL_MAX_MS = 5000, POLL_GIVE_UP_MS = 120000;

    function pollResult(path, bubble) {
        // Must be relative. Resolving it against the API base ourselves is what
        // keeps the Bearer key on the origin we already POST to.
        if (typeof path !== 'string' || path.charAt(0) !== '/') {
            log('rejected a non-relative async_result url', path);
            return;
        }

        var startedAt = Date.now();
        var delay = POLL_START_MS;

        function schedule() {
            if (removed) { return; }   // the 120s give-up must not bubble post-teardown
            if ((Date.now() - startedAt) >= POLL_GIVE_UP_MS) {
                addBubble('bot', t('timeout'));
                return;
            }
            setTimeout(tick, delay);
            delay = Math.min(POLL_MAX_MS, Math.round(delay * POLL_FACTOR));
        }

        function tick() {
            if (removed) { return; }
            API.poll(path, function (status, body) {
                log('poll', status, body);
                if (status === 403) { teardown(); return; }
                if (status === 410) { return; }

                if (status === 200 && body && (body.status === 'ready' || body.status === 'failed')) {
                    // Replace the interim bubble in place — the server overwrote
                    // the same transcript row.
                    if (bubble) { typeText(bubble, body.reply || ''); }
                    else { typeText(addBubble('bot', ''), body.reply || ''); }
                    renderActions(body.actions, bubble);
                    return;
                }

                schedule();   // pending / 429 / network / unparseable → back off
            });
        }

        schedule();
    }

    /* ------------------------------------------------------------- composer */

    var INITIAL_INPUT_HEIGHT = 49;

    function adjustInputHeight() {
        els.input.style.height = 'auto';
        var next = Math.max(INITIAL_INPUT_HEIGHT, els.input.scrollHeight);
        els.input.style.height = next + 'px';
        els.form.style.borderRadius = next > INITIAL_INPUT_HEIGHT ? '15px' : '32px';
    }

    /* ------------------------------------------------------------- language */

    function closeLanguageMenu() {
        els.controls.classList.remove('nc-lang-open');
        els.langToggle.setAttribute('aria-expanded', 'false');
    }

    function toggleLanguageMenu() {
        var opening = !els.controls.classList.contains('nc-lang-open');
        els.controls.classList.toggle('nc-lang-open');
        els.langToggle.setAttribute('aria-expanded', opening ? 'true' : 'false');

        if (opening) {
            SUPPORTED.forEach(function (code) {
                els.optionButtons[code].classList.toggle('nc-hidden', code === locale);
            });
        }
    }

    /**
     * Switching language never discards the conversation. The new locale travels
     * with the next turn so the model can follow it; until it does, the guest just
     * keeps being answered in whatever language they are writing.
     */
    function setLocale(code) {
        if (SUPPORTED.indexOf(code) === -1 || code === locale) { return; }
        locale = code;

        // NOT document.documentElement.lang — the host page's language is theirs,
        // not ours.
        els.langToggle.replaceChild(flagNode(locale), els.langToggle.firstChild);
        els.langToggle.setAttribute('aria-label', t('language'));
        els.input.setAttribute('placeholder', t('placeholder'));
        els.input.setAttribute('aria-label', t('input'));
        els.send.setAttribute('aria-label', t('send'));
        els.close.setAttribute('aria-label', t('close'));
        els.toggler.setAttribute('aria-label', t('open'));
        els.subtitle.textContent = t('subtitle');
        els.panel.setAttribute('aria-label', 'Germán — ' + t('subtitle'));

        SUPPORTED.forEach(function (code2) {
            els.optionButtons[code2].classList.toggle('nc-hidden', code2 === locale);
        });
    }

    /* ============================================================= boot ===== */

    function wire() {
        els.toggler.addEventListener('click', toggle);
        els.close.addEventListener('click', close);
        els.form.addEventListener('submit', submit);

        els.input.addEventListener('input', adjustInputHeight);
        els.input.addEventListener('keydown', function (e) {
            // Enter sends on desktop; on touch it should insert a newline.
            if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) {
                submit(e);
            }
        });

        els.langToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleLanguageMenu();
        });

        els.langOptions.addEventListener('click', function (e) {
            e.stopPropagation();
            var button = e.target.closest ? e.target.closest('.nc-lang-option') : null;
            if (!button) { return; }
            setLocale(button.getAttribute('data-lang'));
            closeLanguageMenu();
        });

        document.addEventListener('click', onDocumentClick);
        document.addEventListener('keydown', onDocumentKeydown);

        adjustInputHeight();   // run once for any prefilled content
    }

    // Named so teardown() can unregister them — everything else the widget wires
    // lives inside #nest-chatbot and leaves with it.
    function onDocumentClick() {
        if (els.controls.classList.contains('nc-lang-open')) { closeLanguageMenu(); }
    }

    function onDocumentKeydown(e) {
        if (e.key === 'Escape' && isOpen()) { close(); els.toggler.focus(); }
    }

    function boot() {
        injectStyles();
        build();
        wire();

        window.NestChatbot = {
            version: VERSION,
            open: open,
            close: close,
            toggle: toggle,
            destroy: teardown,
            setLocale: setLocale,
            get locale() { return locale; }
        };

        if (cfg.autoOpen) { open(); }
        log('booted', VERSION, { locale: locale, assetBase: assetBase, mock: USE_MOCK });
    }

    if (document.body) { boot(); }
    else { document.addEventListener('DOMContentLoaded', boot); }
})();
