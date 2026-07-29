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
 * Built against response contract 1.4.1 (BUILT_AGAINST, api section) in
 * docs/wsuite/. The server reports its live contract_version at init; the widget
 * warns once — never fails — when the server is ahead. The reference
 * implementation is docs/wsuite/chatbot.reference.js — consult it when a detail of
 * the transport or the element contract is unclear.
 */
(function () {
    'use strict';

    var VERSION = '2.3.0';

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
        offsetX: data.offsetX || '',
        offsetY: data.offsetY || '',
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
    var sendQueue = [];     // turns queued behind an in-flight turn — one at a time
    var introPlayed = false;
    // The guest has sent at least one turn. Latched, never cleared: the welcome
    // block is a first-contact affordance, and a conversation that has started
    // must never have it appear on top of it — including the race where the
    // greeting is still typing when the first message goes out.
    var guestTurned = false;
    var els = {};

    /* ============================================================= i18n ===== */

    var STRINGS = {
        en: {
            assistantRole: 'Nests Hostels AI assistant',
            placeholder: 'Ask Germán anything…',
            greeting: 'Hi! I\'m Germán, the Nests AI assistant. Your travel community in the Canaries & Ibiza — 14 hostels · 3 islands · 1 Nest Pass.',
            open: 'Open Germán, the Nests AI assistant', close: 'Minimise the chat',
            openUnread: 'Open Germán — 1 new message',
            teaser: 'Need a hand picking your Nest?', teaserDismiss: 'Dismiss',
            subline: 'Nests Hostels · replies in seconds', aiAssistant: 'AI assistant',
            expand: 'Expand the chat', shrink: 'Shrink the chat',
            tryAsking: 'Try asking',
            prompt1: 'Which hostel fits me best?', prompt2: 'How does the Nest Pass work?',
            disclaimer: 'AI answers — double-check important',
            priceFrom: 'from %s',
            carousel: 'carousel', carouselPrev: 'Scroll back', carouselNext: 'Scroll forward',
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
            assistantRole: 'Asistente IA de Nests Hostels',
            placeholder: 'Pregunta lo que quieras a Germán…',
            greeting: '¡Hola! Soy Germán, el asistente de IA de Nests. Tu comunidad viajera en Canarias e Ibiza — 14 hostels · 3 islas · 1 Nest Pass.',
            open: 'Abrir Germán, el asistente IA de Nests', close: 'Minimizar el chat',
            openUnread: 'Abrir Germán — 1 mensaje nuevo',
            teaser: '¿Te ayudo a elegir tu Nest?', teaserDismiss: 'Descartar',
            subline: 'Nests Hostels · responde en segundos', aiAssistant: 'Asistente IA',
            expand: 'Ampliar el chat', shrink: 'Reducir el chat',
            tryAsking: 'Prueba a preguntar',
            prompt1: '¿Qué hostel me encaja mejor?', prompt2: '¿Cómo funciona el Nest Pass?',
            disclaimer: 'Respuestas de IA — verifica lo importante',
            priceFrom: 'desde %s',
            carousel: 'carrusel', carouselPrev: 'Retroceder', carouselNext: 'Avanzar',
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
            assistantRole: 'Assistente IA di Nests Hostels',
            placeholder: 'Chiedi qualsiasi cosa a Germán…',
            greeting: 'Ciao! Sono Germán, l\'assistente IA di Nests. La tua community di viaggio tra Canarie e Ibiza — 14 hostel · 3 isole · 1 Nest Pass.',
            open: 'Apri Germán, l\'assistente IA di Nests', close: 'Riduci la chat',
            openUnread: 'Apri Germán — 1 nuovo messaggio',
            teaser: 'Ti aiuto a scegliere il tuo Nest?', teaserDismiss: 'Chiudi',
            subline: 'Nests Hostels · risponde in pochi secondi', aiAssistant: 'Assistente IA',
            expand: 'Espandi la chat', shrink: 'Riduci la chat',
            tryAsking: 'Prova a chiedere',
            prompt1: 'Quale hostel fa per me?', prompt2: 'Come funziona il Nest Pass?',
            disclaimer: 'Risposte IA — verifica ciò che è importante',
            priceFrom: 'da %s',
            carousel: 'carosello', carouselPrev: 'Indietro', carouselNext: 'Avanti',
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
            assistantRole: 'KI-Assistent von Nests Hostels',
            placeholder: 'Frag Germán einfach alles…',
            greeting: 'Hi! Ich bin Germán, der KI-Assistent von Nests. Deine Reise-Community auf den Kanaren & Ibiza — 14 Hostels · 3 Inseln · 1 Nest Pass.',
            open: 'Germán öffnen, den KI-Assistenten von Nests', close: 'Chat minimieren',
            openUnread: 'Germán öffnen — 1 neue Nachricht',
            teaser: 'Soll ich dir helfen, dein Nest zu finden?', teaserDismiss: 'Schließen',
            subline: 'Nests Hostels · antwortet in Sekunden', aiAssistant: 'KI-Assistent',
            expand: 'Chat vergrößern', shrink: 'Chat verkleinern',
            tryAsking: 'Frag zum Beispiel',
            prompt1: 'Welches Hostel passt zu mir?', prompt2: 'Wie funktioniert der Nest Pass?',
            disclaimer: 'KI-Antworten — Wichtiges bitte prüfen',
            priceFrom: 'ab %s',
            carousel: 'Karussell', carouselPrev: 'Zurück', carouselNext: 'Weiter',
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
            assistantRole: 'Assistant IA de Nests Hostels',
            placeholder: 'Demandez tout à Germán…',
            greeting: 'Salut ! Je suis Germán, l\'assistant IA de Nests. Ta communauté de voyage aux Canaries et à Ibiza — 14 hostels · 3 îles · 1 Nest Pass.',
            open: 'Ouvrir Germán, l\'assistant IA de Nests', close: 'Réduire le chat',
            openUnread: 'Ouvrir Germán — 1 nouveau message',
            teaser: 'Besoin d\'aide pour choisir ton Nest ?', teaserDismiss: 'Fermer',
            subline: 'Nests Hostels · répond en quelques secondes', aiAssistant: 'Assistant IA',
            expand: 'Agrandir le chat', shrink: 'Réduire le chat',
            tryAsking: 'Essayez de demander',
            prompt1: 'Quel hostel me correspond le mieux ?', prompt2: 'Comment fonctionne le Nest Pass ?',
            disclaimer: 'Réponses IA — vérifiez l\'essentiel',
            priceFrom: 'à partir de %s',
            carousel: 'carrousel', carouselPrev: 'Précédent', carouselNext: 'Suivant',
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
        try { window.localStorage.removeItem(STORE_KEY); } catch (e) { }
    }

    /* Launcher-attention flags. Deliberately NOT suffixed with the site key the
       way STORE_KEY is: they describe this visitor's relationship with the widget
       on this origin — has it ever been opened, did they wave the teaser away —
       not a conversation, and a key rotation must not resurrect the teaser for a
       returning guest. */
    var FLAG_OPENED = 'nest-chatbot:opened';                      // sessionStorage
    var FLAG_TEASER_SHOWN = 'nest-chatbot:teaser-shown';          // sessionStorage
    var FLAG_TEASER_DISMISSED = 'nest-chatbot:teaser-dismissed';  // localStorage

    /* Panel-size flags, same unsuffixed convention and the same reasoning: they
       describe how this visitor likes the panel, not a conversation.
       - AUTO_EXPANDED is per session, so the widget offers the wider sheet once
         per visit rather than on every reply.
       - USER_SHRANK is per browser: a guest who has pulled the sheet back in
         once has stated a preference, and it should outlive the tab. */
    var FLAG_AUTO_EXPANDED = 'nest-chatbot:auto-expanded';        // sessionStorage
    var FLAG_USER_SHRANK = 'nest-chatbot:user-shrank';            // localStorage

    function readFlag(storeName, key) {
        try { return window[storeName].getItem(key) === '1'; } catch (e) { return false; }
    }

    function writeFlag(storeName, key) {
        try { window[storeName].setItem(key, '1'); } catch (e) { /* private mode — degrade to per-load */ }
    }

    /* ============================================================== api ===== */
    /*
     * THE SEAM. The only section that talks to the network.
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
     * NOTE: `locale` in the turn body is contractual since 1.3.0 (guide §3.2) —
     * a stateless per-turn reply-language override for a UI that owns a language
     * switcher, which this widget does. Resend it on EVERY turn: dropping it
     * hands the next turn back to server-side detection.
     */

    // The response-contract version this widget was built against. The init
    // response reports the server's live contract_version; if it is higher, the
    // server ships an element or field we do not render yet — warn ONCE and carry
    // on (the ignore-unknown rule keeps the widget fully functional; NEVER
    // hard-fail).
    var BUILT_AGAINST = '1.4.1';
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
        // The whole setup is guarded, not just send(): open() throws
        // synchronously on an unparseable data-api-base (stray space, bare
        // scheme…), and an uncaught throw here would wedge the initWaiters
        // queue. done() cannot fire twice — a sync throw means the request
        // never reached readyState 4.
        try {
            xhr.open(method, cfg.apiBase + path, true);
            xhr.setRequestHeader('Authorization', 'Bearer ' + cfg.key);
            if (body != null) { xhr.setRequestHeader('Content-Type', 'application/json'); }
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) { return; }
                var parsed = null;
                try { parsed = JSON.parse(xhr.responseText); } catch (e) { parsed = null; }
                done(xhr.status, parsed);
            };
            xhr.send(body == null ? null : JSON.stringify(body));
        } catch (e) {
            done(0, null);
        }
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
     *   "link"      → three link_buttons (book / website / directions)
     *   "available" → async_result: interim reply now, final reply after polling
     *   "rooms"     → availability with room options
     *   "tenerife" / "canaria" / "ibiza" → property_cards + promo_card + the CTA trio
     *   "hostel"    → quick_replies: the three island chips
     *   "pass" / "offer" → promo_card on its own ("pass" is word-bounded, so
     *                 "passport" and "compass" fall through to the plain reply)
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

        // Two fixtures serve the same promo — the island answer and the
        // "pass"/"offer" answer — and the renderer has to see byte-identical
        // payloads from both. A factory, not a shared literal: each reply gets its
        // own object, so nothing downstream can leak state between turns.
        function promoCard() {
            return {
                type: 'promo_card',
                title: 'One booking. All Hostels.',
                body: '7 nights for €140 — the Nest Pass moves with you between our islands.',
                cta: { label: 'Get Your Nest Pass', url: 'https://nestshostels.com/nest-pass' },
                style: 'highlight'
            };
        }

        return {
            init: function (done) {
                reply(done, 201, {
                    conversation: { uuid: 'mock-' + Math.random().toString(36).slice(2, 10) },
                    greeting: t('greeting'),
                    // The server always emits the key; [] means "this site has not
                    // configured welcome elements", which is what makes the widget's
                    // own TRY ASKING block the visible fallback on the demo page.
                    actions: [],
                    contract_version: '1.4.1'
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
                    // Since contract 1.4.0 the information path emits three
                    // deterministic link_buttons (booking_url / website / map_url),
                    // deduped by URL — the fixture mirrors that.
                    return reply(done, 200, {
                        reply: 'Here is everything for Las Eras — booking, the website, and how to find us.',
                        actions: [
                            { type: 'link_button', label: 'Book now', url: 'https://book.nestshostels.com', style: 'primary' },
                            { type: 'link_button', label: 'Visit our website', url: 'https://nestshostels.com' },
                            { type: 'link_button', label: 'Get directions', url: 'https://maps.google.com/?q=Las+Eras+Nest+Hostel' }
                        ],
                        turn: turn
                    });
                }

                /* -- Phase 2 element types ----------------------------------------
                 * Deliberately AFTER every check above: none of the branches that
                 * existed in 2.3.0 can now be reached by a different keyword, so the
                 * regression gate is provably testing the same matcher it always did.
                 */

                // All three island chips land here on purpose — in production any
                // reply can carry any element and the server decides which.
                if (q.indexOf('tenerife') !== -1 || q.indexOf('canaria') !== -1 || q.indexOf('ibiza') !== -1) {
                    return reply(done, 200, {
                        reply: 'Three Nests match — El Médano is the surf one.',
                        actions: [
                            {
                                type: 'property_cards',
                                items: [
                                    {
                                        key: 'medano',
                                        name: 'Medano Nest',
                                        location: 'El Médano, Tenerife',
                                        image: 'https://nestshostels.com/wp-content/themes/w_neststw/assets/img/gallery/3.jpg',
                                        price_from: { amount: '22.00', currency: 'EUR' },
                                        badge: 'Nest Pass',
                                        url: 'https://hotels.cloudbeds.com/reservation/medano-nest'
                                    },
                                    {
                                        // No `location` key at all: optional fields are
                                        // OMITTED rather than nulled, and the platform
                                        // really does have properties without one. The
                                        // card must simply skip the line.
                                        key: 'ashavana',
                                        name: 'Ashavana Nest',
                                        image: 'https://nestshostels.com/wp-content/themes/w_neststw/assets/img/gallery/6.jpg',
                                        price_from: { amount: '24.00', currency: 'EUR' },
                                        url: 'https://hotels.cloudbeds.com/reservation/ashavana-nest'
                                    },
                                    {
                                        key: 'duque',
                                        name: 'Duque Nest',
                                        location: 'Costa Adeje, Tenerife',
                                        image: 'https://nestshostels.com/wp-content/themes/w_neststw/assets/img/gallery/1.jpg',
                                        price_from: { amount: '26.00', currency: 'EUR' },
                                        badge: 'Loooong Stay',
                                        url: 'https://hotels.cloudbeds.com/reservation/duque-nest'
                                    }
                                ]
                            },
                            promoCard(),
                            { type: 'link_button', label: 'Book now', url: 'https://book.nestshostels.com', style: 'primary' },
                            { type: 'link_button', label: 'Visit our website', url: 'https://nestshostels.com' },
                            { type: 'link_button', label: 'Get directions', url: 'https://maps.google.com/?q=Las+Eras+Nest+Hostel' }
                        ],
                        turn: turn
                    });
                }

                // Matches suggested prompt 1 in every pack ("Which hostel fits me
                // best?", "Welches Hostel passt zu mir?", …).
                if (q.indexOf('hostel') !== -1) {
                    return reply(done, 200, {
                        reply: 'Which island are you going to?',
                        actions: [{
                            type: 'quick_replies',
                            items: [
                                { label: 'Tenerife', message: 'Tenerife' },
                                { label: 'Gran Canaria', message: 'Gran Canaria' },
                                { label: 'Ibiza', message: 'Ibiza' }
                            ]
                        }],
                        turn: turn
                    });
                }

                // Word-bounded on purpose: "passport" and "compass" must not reach the
                // promo, and neither must the German prompt 1 ("… passt zu mir?"),
                // which belongs to the `hostel` branch above.
                if (/\bpass\b/.test(q) || q.indexOf('offer') !== -1) {
                    return reply(done, 200, {
                        reply: 'One pass, every Nest — here is how it works.',
                        actions: [promoCard()],
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
        x: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>',
        // Arrows-out (expand) / arrows-in (shrink): the CSS swaps which one is
        // visible in .nc-expand — both markup so the toggle is instant, no re-render.
        expand: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon nc-icon--expand" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M5.828 10.172a.5.5 0 0 0-.707 0l-4.096 4.096V11.5a.5.5 0 0 0-1 0v3.975a.5.5 0 0 0 .5.5H4.5a.5.5 0 0 0 0-1H1.732l4.096-4.096a.5.5 0 0 0 0-.707m4.344-4.344a.5.5 0 0 0 .707 0l4.096-4.096V4.5a.5.5 0 1 0 1 0V.525a.5.5 0 0 0-.5-.5H11.5a.5.5 0 0 0 0 1h2.768l-4.096 4.096a.5.5 0 0 0 0 .707"/></svg>',
        shrink: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon nc-icon--shrink" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M.172 15.828a.5.5 0 0 0 .707 0l4.096-4.096V14.5a.5.5 0 1 0 1 0v-3.975a.5.5 0 0 0-.5-.5H1.5a.5.5 0 0 0 0 1h2.768L.172 15.121a.5.5 0 0 0 0 .707M15.828.172a.5.5 0 0 0-.707 0l-4.096 4.096V1.5a.5.5 0 1 0-1 0v3.975a.5.5 0 0 0 .5.5H14.5a.5.5 0 0 0 0-1h-2.768L15.828.879a.5.5 0 0 0 0-.707"/></svg>',
        // Plain chevron — unused until Task 6 wires the carousel arrows.
        chevron: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>',
        send: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon" viewBox="0 0 512 512" aria-hidden="true"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480v-83.6c0-4 1.5-7.8 4.2-10.8L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3.2 300.7 0 288.9s6.2-22.6 16.6-28.3l448-243.4c10.8-5.9 24-5 33.9 2.1z"/></svg>'
    };

    // Simplified national flags, painted full-bleed into the 35px circle: `slice`
    // scales each one to cover its square button and crops the overflow from the
    // centre, so no fine detail is needed. It has to be the SVG attribute and NOT
    // object-fit — that property only applies to replaced elements, and an inline
    // <svg> is not one, so object-fit:cover here silently does nothing and the flag
    // letterboxes instead.
    // The GB clip-path ids are uniquified per instance so two Union Jacks on the
    // same page cannot cross-reference each other's defs.
    var flagUid = 0;
    var FLAG_FIT = ' preserveAspectRatio="xMidYMid slice" class="nc-flag">';

    function flagMarkup(code) {
        var id = 'nc-uk-' + (++flagUid);
        switch (code) {
            case 'en':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"' + FLAG_FIT +
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
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"' + FLAG_FIT +
                    '<rect width="3" height="2" fill="#AA151B"/>' +
                    '<rect width="3" height="1" y="0.5" fill="#F1BF00"/></svg>';
            case 'it':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"' + FLAG_FIT +
                    '<rect width="1" height="2" x="0" fill="#008C45"/>' +
                    '<rect width="1" height="2" x="1" fill="#F4F5F0"/>' +
                    '<rect width="1" height="2" x="2" fill="#CD212A"/></svg>';
            case 'de':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 3"' + FLAG_FIT +
                    '<rect width="5" height="1" y="0" fill="#000"/>' +
                    '<rect width="5" height="1" y="1" fill="#D00"/>' +
                    '<rect width="5" height="1" y="2" fill="#FFCE00"/></svg>';
            case 'fr':
                return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"' + FLAG_FIT +
                    '<rect width="1" height="2" x="0" fill="#002395"/>' +
                    '<rect width="1" height="2" x="1" fill="#fff"/>' +
                    '<rect width="1" height="2" x="2" fill="#ED2939"/></svg>';
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"' + FLAG_FIT + '</svg>';
    }

    function flagNode(code) { return svgNode(flagMarkup(code)); }

    /**
     * The bot's avatar, in one place because three call sites need it (a reply, the
     * thinking dots, the intro greeting). Same mark as the launcher and the header —
     * the teal variant, which is the one that reads on the white message body.
     * Decorative: the bubble's text carries the meaning, so alt stays empty.
     */
    function avatarNode() {
        var avatar = el('img', 'nc-avatar');
        attrs(avatar, {
            src: assetBase + 'img/logotipo-nests-tenerife.png', alt: '', width: '32', height: '32'
        });
        return avatar;
    }

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
        // Bare numbers only, read as px — enough to line the launcher up with a
        // host's own floating furniture. A host wanting rem/vh/calc overrides
        // --nc-edge-x / --nc-edge-y in CSS instead; this is the no-CSS path.
        if (/^\d+$/.test(cfg.offsetX)) { root.style.setProperty('--nc-edge-x', cfg.offsetX + 'px'); }
        if (/^\d+$/.test(cfg.offsetY)) { root.style.setProperty('--nc-edge-y', cfg.offsetY + 'px'); }
        root.style.setProperty('--nc-loader-logo', 'url("' + assetBase + 'img/logotipo-nests-tenerife.png")');

        /* launcher */
        var toggler = el('button', 'nc-toggler');
        // The unread affordance lasts until the first open of the session; while
        // it shows, the accessible name carries the "1 new message" the visual
        // dot only hints at.
        var hasUnread = !readFlag('sessionStorage', FLAG_OPENED);
        attrs(toggler, {
            type: 'button',
            'aria-label': hasUnread ? t('openUnread') : t('open'),
            'aria-expanded': 'false'
        });
        // The same teal mark as the message avatar and the loader — one logo in
        // one colour rather than three different pictures.
        var togglerIcon = el('img', 'nc-toggler-icon');
        attrs(togglerIcon, {
            src: assetBase + 'img/logotipo-nests-tenerife.png', alt: '', width: '34', height: '34'
        });
        toggler.appendChild(togglerIcon);

        var unread = null;
        if (hasUnread) {
            unread = el('div', 'nc-unread');
            attrs(unread, { 'aria-hidden': 'true' });
            toggler.appendChild(unread);
        }

        /* teaser — built hidden; the flow section's timers decide if it shows */
        var teaser = el('div', 'nc-teaser nc-hidden');
        attrs(teaser, { role: 'status' });
        var teaserBody = el('button', 'nc-teaser-body', t('teaser'));
        attrs(teaserBody, { type: 'button' });
        var teaserClose = el('button', 'nc-teaser-close', '✕');
        attrs(teaserClose, { type: 'button', 'aria-label': t('teaserDismiss') });
        teaser.appendChild(teaserBody);
        teaser.appendChild(teaserClose);

        /* panel */
        var panel = el('div', 'nc-panel');
        attrs(panel, { role: 'dialog', 'aria-label': 'Germán — ' + t('assistantRole'), 'aria-modal': 'false' });

        /* header */
        var header = el('div', 'nc-header');
        var headerInfo = el('div', 'nc-header-info');
        var headerLogo = el('img', 'nc-header-logo');
        attrs(headerLogo, { src: assetBase + 'img/germanavatar.png', alt: '', width: '44', height: '44' });
        var headerText = el('div', 'nc-header-text');
        var nameRow = el('div', 'nc-name-row');
        nameRow.appendChild(el('h2', 'nc-title', 'Germán'));
        var badge = el('span', 'nc-badge', t('aiAssistant'));
        nameRow.appendChild(badge);
        headerText.appendChild(nameRow);
        var subline = el('span', 'nc-subline', t('subline'));
        headerText.appendChild(subline);
        headerInfo.appendChild(headerLogo);
        headerInfo.appendChild(headerText);

        // .nc-expand: display:none below 1024px — there is no room for a side
        // sheet at those widths and the panel is already fullscreen. Both glyphs
        // ship in the button so the toggle is a class swap, never a re-render.
        var headerControls = el('div', 'nc-header-controls');
        var expandBtn = el('button', 'nc-expand');
        attrs(expandBtn, { type: 'button', 'aria-label': t('expand') });
        expandBtn.appendChild(svgNode(ICONS.expand));
        expandBtn.appendChild(svgNode(ICONS.shrink));

        var closeBtn = el('button', 'nc-close');
        attrs(closeBtn, { type: 'button', 'aria-label': t('close') });
        closeBtn.appendChild(svgNode(ICONS.x));

        headerControls.appendChild(expandBtn);
        headerControls.appendChild(closeBtn);

        header.appendChild(headerInfo);
        header.appendChild(headerControls);

        /* body */
        var body = el('div', 'nc-body');
        // log is the right structural role, but the transcript must not be LIVE:
        // the typer streams character by character into a Text node, and a live
        // .nc-body re-announces the growing string on every keystroke. Announcing
        // happens through els.announcer instead (see announce()). aria-live must
        // be stated, not omitted — role="log" carries an implicit polite.
        attrs(body, { role: 'log', 'aria-live': 'off' });

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

        // The AI disclosure sits under the composer, not in the header: it is
        // about the answers, and this is the last thing read before sending one.
        var disclaimer = el('div', 'nc-disclaimer', t('disclaimer'));
        footer.appendChild(disclaimer);

        /* announcer — the widget's only live region.
           A SIBLING of the panel, never a child: a closed panel is opacity:0 and
           scale(0.2), and a live region inside hidden furniture is unreliable. It
           reuses .nc-sr-only so there is exactly one visually-hidden recipe in the
           stylesheet. */
        var announcer = el('div', 'nc-sr-only nc-announcer');
        attrs(announcer, { 'aria-live': 'polite', 'aria-relevant': 'additions' });

        panel.appendChild(header);
        panel.appendChild(body);
        panel.appendChild(footer);
        root.appendChild(toggler);
        root.appendChild(teaser);
        root.appendChild(panel);
        root.appendChild(announcer);
        document.body.appendChild(root);

        els = {
            root: root, toggler: toggler, panel: panel, body: body, loader: loader,
            progress: progress, form: form, input: input, send: send, close: closeBtn,
            controls: controls, langToggle: langToggle, langOptions: langOptions,
            optionButtons: optionButtons, badge: badge, subline: subline, expand: expandBtn,
            unread: unread, teaser: teaser, teaserBody: teaserBody, teaserClose: teaserClose,
            announcer: announcer, disclaimer: disclaimer,
            // The welcome block is built later, by the intro, and removed for good
            // on the first guest turn — declared here so every reader of els sees
            // the whole surface in one place.
            prompts: null, promptsLabel: null, promptButtons: null
        };
    }

    /* =========================================================== render ===== */

    function scrollDown() {
        if (els.body) { els.body.scrollTop = els.body.scrollHeight; }
    }

    /* ------------------------------------------------------------- announcing */
    /*
     * One reply, one announcement — and the visible bubble stays in the
     * accessibility tree, so a VoiceOver/TalkBack guest can still explore it by
     * touch. Hiding the bubble instead (the shape this started as) bought the
     * single announcement at the cost of making replies unreachable by pointer.
     */

    // Long enough for a polite queue to drain behind an interrupting one, short
    // enough that the text is gone before anyone browses back to it.
    var ANNOUNCE_CLEAR_MS = 3000;
    var announceToken = 0;

    function emptyNode(node) {
        while (node.firstChild) { node.removeChild(node.firstChild); }
    }

    /**
     * Announce by ADDING a node, not by writing textContent: two consecutive
     * replies carrying the identical string (two t('error') in a row) are two
     * additions and are both spoken, where a textContent write of the same value
     * changes nothing and is silently skipped.
     *
     * The text is cleared afterwards or it sits there as a second, invisible copy
     * of the bubble for anyone reading the page linearly — the very duplication
     * this design exists to avoid. The token makes a stale clear a no-op, so a
     * newer announcement is never wiped by an older timer.
     */
    function announce(text) {
        if (!els.announcer || !text) { return; }
        announceToken += 1;
        var token = announceToken;

        emptyNode(els.announcer);
        els.announcer.appendChild(el('span', null, text));

        setTimeout(function () {
            if (removed || token !== announceToken) { return; }
            emptyNode(els.announcer);
        }, ANNOUNCE_CLEAR_MS);
    }

    /**
     * True when the bot message about to be appended lands directly on another
     * bot message. One avatar per burst reads as one speaker; repeating it down
     * a run of replies just adds noise (mock 2B).
     *
     * Two deliberate exclusions:
     *  - `nc-thinking` never counts. It is removed from the DOM before the reply
     *    bubble is added, so counting it would strip the avatar off the first
     *    reply of every turn.
     *  - renderActions() appends its rows to els.body as siblings, so a reply
     *    that shipped CTAs is followed by a row, not a message — the next reply
     *    correctly gets its avatar back. That is the intended reading, not a bug.
     */
    function followsBotMessage() {
        var last = els.body.lastElementChild;
        if (!last || !last.classList) { return false; }
        return last.classList.contains('nc-message--bot') && !last.classList.contains('nc-thinking');
    }

    function addBubble(role, text) {
        var isBot = role !== 'guest';
        var follow = isBot && followsBotMessage();
        var wrap = el('div', 'nc-message nc-message--' + (isBot ? 'bot' : 'guest') +
            (follow ? ' nc-message--follow' : ''));
        if (isBot && !follow) {
            wrap.appendChild(avatarNode());
        }
        var textNode = el('div', 'nc-text', text || '');   // textContent — never innerHTML
        wrap.appendChild(textNode);
        els.body.appendChild(wrap);
        scrollDown();

        // Bot bubbles that never reach typeText — error, retry, timeout — would go
        // silent now that .nc-body is not live, so they announce from here. The
        // non-empty guard is what keeps a typed reply from announcing twice: it
        // arrives as addBubble('bot', '') and typeText does the talking. A guest
        // bubble is never announced; the guest just typed that text.
        if (isBot && text) { announce(text); }
        return textNode;
    }

    function showThinking() {
        var follow = followsBotMessage();
        var wrap = el('div', 'nc-message nc-message--bot nc-thinking' + (follow ? ' nc-message--follow' : ''));
        var text = el('div', 'nc-text');
        var dots = el('div', 'nc-dots');
        dots.appendChild(el('div', 'nc-dot'));
        dots.appendChild(el('div', 'nc-dot'));
        dots.appendChild(el('div', 'nc-dot'));
        text.appendChild(dots);
        if (!follow) { wrap.appendChild(avatarNode()); }
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

    /**
     * `row` is the CTA row this button joins — null opens a new one. Returns the row
     * so the caller can hand it to the next button: consecutive CTAs (contract 1.4.0
     * ships three) then share one wrapping row instead of stacking into a column of
     * full-width bars. A dropped url returns `row` untouched, so a rejected link
     * never leaves an empty row behind.
     */
    function linkButton(label, url, style, row) {
        var href = safeHttpUrl(url);
        if (!href) { log('dropped a non-http(s) url', url); return row; }
        var link = el('a', 'nc-action' + (style === 'primary' ? ' nc-action--primary' : ''), label || t('open_link'));
        attrs(link, { href: href, target: '_blank', rel: 'noopener noreferrer' });
        if (!row) {
            row = el('div', 'nc-action-row');
            els.body.appendChild(row);
        }
        row.appendChild(link);
        scrollDown();
        return row;
    }

    function renderActions(actions, bubble) {
        if (!actions || !actions.length) { return; }
        // The open CTA row travels with the pass rather than living module-side, so
        // DOM order still follows payload order and an element that renders something
        // else closes the group.
        var row = null;
        for (var i = 0; i < actions.length; i++) {
            row = renderAction(actions[i], bubble, row);
        }
    }

    /**
     * One branch per element `type` from the v1 contract. Adding a new rich type
     * is exactly one new branch here.
     *
     * Unknown types are ignored silently and deliberately — the server ships new
     * element types ahead of any given widget, and breaking on one would take the
     * whole reply down with it.
     *
     * Returns the CTA row left open for the next element: carrying it is what groups
     * consecutive buttons. An element that renders something of its own returns null
     * and closes the group; one that renders nothing passes `row` straight through.
     */
    function renderAction(action, bubble, row) {
        if (!action || !action.type) { return row; }

        switch (action.type) {
            case 'async_result':
                if (action.url) { pollResult(action.url, bubble); }
                return row;

            case 'link_button':
                return linkButton(action.label, action.url, action.style, row);

            case 'booking_link':
                return linkButton(t('book'), action.url, 'primary', row);

            case 'availability':
                return renderAvailability(action);

            case 'contact_channels':
                renderChannels(action);
                return null;

            case 'property_cards':
                renderPropertyCards(action);
                return null;

            case 'quick_replies':
                renderQuickReplies(action);
                return null;

            case 'promo_card':
                renderPromoCard(action);
                return null;

            default:
                log('ignoring unknown element type', action.type);
                return row;
        }
    }

    // The options card closes any open CTA group; the trailing booking button opens a
    // fresh row, which is returned for whatever follows.
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
        var row = action.url ? linkButton(t('book'), action.url, 'primary', null) : null;
        scrollDown();
        return row;
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

    /**
     * Tap-to-send chips. A chip is a shortcut for typing: it sends its `message`
     * as an ordinary guest turn through the same seam the composer uses, so the
     * transcript reads exactly as if the guest had written it.
     *
     * Chips carry NO urls, by contract — the widget's link surface stays
     * link_button / contact_channels. An item that arrives with a `url` key is
     * still rendered as a chip and the key is ignored; honouring it here would
     * quietly widen the surface that safeHttpUrl() exists to keep narrow.
     *
     * Labels are payload strings — server-authored and already server-localized —
     * so they go through el()/textContent and never through t().
     */
    function renderQuickReplies(action) {
        if (!action.items || !action.items.length) { return; }

        var row = el('div', 'nc-chip-row');
        for (var i = 0; i < action.items.length; i++) {
            var item = action.items[i] || {};
            // The message IS the chip: without one there is nothing to send, so a
            // button would be a dead end. Skip it silently, like every other
            // malformed piece of a payload.
            if (typeof item.message !== 'string' || !item.message) { continue; }
            var chip = el('button', 'nc-prompt', item.label || item.message);
            attrs(chip, { type: 'button' });
            chip.addEventListener('click', makeChipHandler(item.message));
            row.appendChild(chip);
        }

        // Every item skipped ⇒ no row: an empty flex box would still eat its gap
        // and leave a phantom indent under the bubble.
        if (!row.childNodes.length) { return; }
        els.body.appendChild(row);
        scrollDown();
    }

    // A factory, not a closure written inside the loop: `var` is function-scoped,
    // so an inline handler would close over the loop's own `item` and every chip
    // would end up sending the last message.
    function makeChipHandler(message) {
        return function () { sendGuestText(message); };
    }

    /* --------------------------------------------------- property carousel --- */

    // No "see all" card and no page counter: the wire carries neither a `more`
    // link nor a `total`, and inventing one would put a number on screen that
    // nothing verified. Eight is simply where the strip stops.
    var CARD_MAX = 8;

    // Mirrors the .nc-car-track gap. The scroll step is one card plus one gap, and
    // the gap is the one number the JS cannot read off a card.
    var CARD_GAP = 10;

    // Fractional-DPR displays (a 125%-scaled Windows desktop, most retina Macs)
    // report scrollLeft/scrollWidth/clientWidth in fractions, so the track's real
    // maximum scrollLeft lands up to a pixel short of scrollWidth - clientWidth
    // and an exact comparison NEVER hides the forward arrow at the right end.
    // Two pixels is far below one card of travel and far above the rounding.
    var CAR_END_EPS = 2;

    /**
     * A horizontally snapping strip of property cards (contract 1.5.0
     * `property_cards`).
     *
     * The TRACK is what scrolls, not the wrapper: .nc-body is overflow-x: hidden,
     * so a card that ran past the panel edge would be clipped rather than
     * reachable. The wrapper stays put and owns the positioning context the fades
     * and arrows place against.
     *
     * Closes any open CTA group (renderAction returns null for it), so the
     * link_buttons a reply carries after the carousel still group into one
     * wrapping row of their own.
     */
    function renderPropertyCards(action) {
        if (!action.items || !action.items.length) { return; }

        var track = el('div', 'nc-car-track');
        var count = 0;
        for (var i = 0; i < action.items.length && count < CARD_MAX; i++) {
            var card = propertyCard(action.items[i] || {});
            if (!card) { continue; }
            track.appendChild(card);
            count += 1;
        }

        // Every item dropped ⇒ no carousel at all: an empty track would still
        // paint its fades and float two arrows over a blank strip.
        if (!count) { return; }

        var wrap = el('div', 'nc-carousel');
        // A group rather than a list: the cards are peers of one another, and the
        // roledescription is what tells a screen-reader guest that ←/→ across the
        // book links is a walk through a strip and not a jump between replies.
        attrs(wrap, { role: 'group', 'aria-roledescription': t('carousel') });
        wrap.appendChild(track);

        var fadeL = attrs(el('div', 'nc-car-fade nc-car-fade--l'), { 'aria-hidden': 'true' });
        var fadeR = attrs(el('div', 'nc-car-fade nc-car-fade--r'), { 'aria-hidden': 'true' });
        wrap.appendChild(fadeL);
        wrap.appendChild(fadeR);

        var prev = carouselArrow('nc-car-prev', t('carouselPrev'));
        var next = carouselArrow('nc-car-next', t('carouselNext'));
        wrap.appendChild(prev);
        wrap.appendChild(next);

        // Position readout, not a control — the dots are unreachable and unspoken
        // on purpose; the arrows carry the labels and the book links carry the
        // keyboard path.
        var dots = attrs(el('div', 'nc-car-dots'), { 'aria-hidden': 'true' });
        for (var d = 0; d < count; d++) { dots.appendChild(el('span', 'nc-car-dot')); }
        wrap.appendChild(dots);

        // Appended BEFORE wiring: the first sync measures scrollWidth against
        // clientWidth, and a node still outside the document measures 0 against 0
        // — which reads as "already at the end" and would hide the forward arrow
        // for good. A closed panel is only scaled and faded, never display: none,
        // so the measurement is real even for a reply that arrives unopened.
        els.body.appendChild(wrap);
        wireCarousel(wrap, track, [prev, fadeL], [next, fadeR], dots);
        scrollDown();
    }

    /**
     * One card. The booking CTA is MANDATORY: an item whose url does not survive
     * safeHttpUrl has nothing to tap, and a card that merely looks tappable is
     * worse than no card — so the whole item is dropped, silently, exactly the way
     * a malformed chip is. A nameless item goes the same way: the title IS the
     * card, and a photo over a price is not a property.
     *
     * image / location / badge / price_from are optional-omitted on the wire (the
     * platform really does have properties without a location). A missing one
     * renders nothing at all rather than an empty line.
     */
    function propertyCard(item) {
        var href = safeHttpUrl(item.url);
        if (!href) { log('property card dropped — no usable booking url', item.key); return null; }
        if (typeof item.name !== 'string' || !item.name) {
            log('property card dropped — no name', item.key);
            return null;
        }

        var card = el('div', 'nc-card');

        var photo = el('div', 'nc-card-photo');
        var image = safeHttpUrl(item.image);
        if (image) {
            var img = el('img');
            // alt="" on purpose: the photo restates the title sitting directly
            // under it, so announcing it twice is noise. Everything the card
            // means is in its text.
            attrs(img, { src: image, alt: '', loading: 'lazy' });
            photo.appendChild(img);
        }
        if (typeof item.badge === 'string' && item.badge) {
            // Tenant-authored and already server-localized — textContent, never t().
            photo.appendChild(el('span', 'nc-card-badge', item.badge));
        }
        card.appendChild(photo);

        var body = el('div', 'nc-card-body');
        body.appendChild(cardTitle(item.name));
        if (typeof item.location === 'string' && item.location) {
            body.appendChild(el('div', 'nc-card-loc', item.location));
        }
        var price = cardPrice(item.price_from);
        if (price) { body.appendChild(price); }

        // The wire sends no label for this one — it is the same "Book now" the
        // booking_link element uses, so it comes from the same pack key.
        var book = el('a', 'nc-card-book', t('book'));
        attrs(book, { href: href, target: '_blank', rel: 'noopener noreferrer' });
        body.appendChild(book);

        card.appendChild(body);
        return card;
    }

    // Presentational, and deliberately generic: this widget serves any wSuite
    // business, so the rule is mechanical — a title that happens to contain this
    // standalone word gets it in its own span, and every other tenant's titles
    // fall through the same code path as plain text. No brand is special-cased.
    // No /g flag: exec() on a global regex advances lastIndex between calls, and
    // this constant is shared by every card in every reply.
    var TITLE_HIGHLIGHT = /\bNest\b/;

    function cardTitle(name) {
        var match = TITLE_HIGHLIGHT.exec(name);
        if (!match) { return el('div', 'nc-card-title', name); }

        // Split into created nodes, never assembled markup: `name` is payload, and
        // the never-innerHTML rule does not bend for a highlight.
        var title = el('div', 'nc-card-title');
        var head = name.slice(0, match.index);
        var tail = name.slice(match.index + match[0].length);
        if (head) { title.appendChild(document.createTextNode(head)); }
        title.appendChild(el('span', 'nc-card-nest', match[0]));
        if (tail) { title.appendChild(document.createTextNode(tail)); }
        return title;
    }

    /**
     * `amount` is a STRING on the wire (matching availability.options[].price) and
     * `currency` is whatever the tenant configured, so both have to be treated as
     * untrusted: a non-numeric amount or a currency code Intl rejects (RangeError)
     * costs the price LINE and nothing else — never the card, never a throw that
     * would take the whole reply down.
     *
     * Only the number is formatted widget-side; the words around it come from the
     * pack, which is why "from %s" is one key with one placeholder rather than a
     * concatenation the renderer invents.
     */
    function cardPrice(price) {
        if (!price) { return null; }

        var n = parseFloat(price.amount);
        if (!isFinite(n)) { return null; }

        // "25.00" is a round price and reads as €25; a real 25.50 keeps its cents.
        // BOTH bounds move together on purpose: minimumFractionDigits pinned at 0
        // would render 25.5 as "$25.5", which is not how money is written.
        var cents = (n % 1) ? 2 : 0;

        var fmt;
        try {
            fmt = new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: price.currency,
                minimumFractionDigits: cents,
                maximumFractionDigits: cents
            }).format(n);
        } catch (e) {
            log('price dropped — currency not formattable', price.currency);
            return null;
        }

        var line = el('div', 'nc-card-price-line');
        var parts = String(t('priceFrom')).split('%s');
        if (parts[0]) { line.appendChild(document.createTextNode(parts[0])); }
        line.appendChild(el('span', 'nc-card-price', fmt));
        if (parts[1]) { line.appendChild(document.createTextNode(parts[1])); }
        return line;
    }

    // One chevron constant serves both directions — the previous arrow is the same
    // node turned around in CSS.
    function carouselArrow(className, label) {
        var btn = el('button', className);
        attrs(btn, { type: 'button', 'aria-label': label });
        btn.appendChild(svgNode(ICONS.chevron));
        return btn;
    }

    /**
     * Everything this attaches lives on nodes inside #nest-chatbot and dies with
     * the subtree, so teardown() has nothing to clear — which is exactly why there
     * are no timers in here.
     */
    function wireCarousel(wrap, track, back, forward, dots) {
        var prev = back[0];
        var next = forward[0];

        // Measured at click time, never cached at build: the card widens inside an
        // expanded panel, and a step captured once would then scroll to the wrong
        // card for the rest of the conversation.
        //
        // firstChild is always a card — renderPropertyCards returns before it
        // wires anything when no item survived, and nothing ever removes one — so
        // there is deliberately no width fallback here. A literal would be a
        // second copy of the card width that lives in CSS, and the two would
        // disagree the moment a breakpoint changes it.
        function step() {
            return track.firstChild.offsetWidth + CARD_GAP;
        }

        /**
         * Never strand keyboard focus on a node about to vanish — the same rule
         * hideTeaser() states. `.nc-hidden` is display: none, and the browser
         * answers that by resetting document.activeElement to <body>: the next Tab
         * would restart from the top of the HOST page, outside the widget
         * entirely. A guest holding Enter on "Scroll forward" hits this on the
         * press that reaches the end.
         */
        function rescueFocus(vanishing, partner) {
            if (!vanishing.contains(document.activeElement)) { return; }

            // The partner arrow first: arriving at one end is exactly when the
            // other direction becomes the only one left.
            partner.focus();
            if (!vanishing.contains(document.activeElement)) { return; }

            // The partner was hidden too (a track short enough to need neither
            // arrow), and focus() on a display: none node silently does nothing.
            // Land on the card at this edge instead — one exists for as long as
            // the carousel does.
            var links = track.querySelectorAll('.nc-card-book');
            if (links.length) {
                links[vanishing === next ? links.length - 1 : 0].focus();
            }
        }

        // The arrow AND its fade go together: the fade means "there is more this
        // way", so left up at the end of the travel it just bleaches the first
        // card's badge and the first letters of its title for no information.
        function setEnd(pair, partner, atEnd) {
            if (atEnd) { rescueFocus(pair[0], partner); }
            pair[0].classList.toggle('nc-hidden', atEnd);
            pair[1].classList.toggle('nc-hidden', atEnd);
        }

        function sync() {
            var max = track.scrollWidth - track.clientWidth;
            var atEnd = track.scrollLeft >= max - CAR_END_EPS;
            setEnd(back, next, track.scrollLeft <= CAR_END_EPS);
            setEnd(forward, prev, atEnd);

            var last = dots.childNodes.length - 1;
            // At the far end the LAST dot lights, whatever the division says. The
            // track stops with the final cards sharing the viewport, so its
            // maximum scrollLeft is short of the last card's own offset — by the
            // division alone that dot would never light at any width.
            //
            // Unless there is nothing to scroll: a track that fits is at its start
            // and its end at once, and the shortcut would light the last dot for a
            // strip the guest can already see in full. Both arrows are still right
            // to hide. Reachable since the expanded sheet grew wide enough to hold
            // three cards outright — at 420px every carousel overflowed.
            var scrollable = max > CAR_END_EPS;
            var index = (atEnd && scrollable) ? last : Math.round(track.scrollLeft / step());
            if (index < 0) { index = 0; }
            if (index > last) { index = last; }
            for (var i = 0; i <= last; i++) {
                dots.childNodes[i].classList.toggle('nc-car-dot--on', i === index);
            }
        }

        // One pending frame at a time, not one queued per event: a single swipe
        // fires scroll dozens of times, and each of those measurements forces
        // layout for a paint that has not happened yet.
        var frame = 0;
        track.addEventListener('scroll', function () {
            if (frame) { return; }
            frame = window.requestAnimationFrame(function () {
                frame = 0;
                sync();
            });
        });

        prev.addEventListener('click', function () { scrollByStep(track, -step()); });
        next.addEventListener('click', function () { scrollByStep(track, step()); });

        // ←/→ walk the book links and let the browser's scroll-into-view follow
        // focus. THAT is the keyboard path through the strip — the arrows are a
        // pointer affordance, and a keyboard guest never has to reach them.
        wrap.addEventListener('keydown', function (event) {
            // Alt+←/→ is Back/Forward on Windows and Linux, Cmd+←/→ on macOS.
            // Claiming those would take the guest's browser navigation away for as
            // long as their focus happens to sit on a card — Shift and Ctrl are in
            // the list for the same reason, they belong to the host page's own
            // shortcuts, never to us.
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) { return; }

            var delta = event.key === 'ArrowRight' ? 1 : (event.key === 'ArrowLeft' ? -1 : 0);
            if (!delta) { return; }

            var links = wrap.querySelectorAll('.nc-card-book');
            var at = -1;
            for (var i = 0; i < links.length; i++) {
                if (links[i] === document.activeElement) { at = i; break; }
            }
            // Focus is on an arrow or nowhere in particular: leave the key alone,
            // so the track still scrolls the way any scroll container does.
            if (at === -1) { return; }

            var target = at + delta;
            if (target < 0 || target >= links.length) { return; }
            event.preventDefault();
            links[target].focus();
        });

        // The arrows, fades and dots are recomputed from a scroll event, and
        // nothing else moves them — but the panel's own width does, and changing
        // it fires no scroll. Anything that resizes the panel has to re-run this,
        // so the handle hangs off the node the way typeText() hangs its
        // cancellation token off a bubble:
        //     wrap.ncSync()   for every .nc-carousel in els.body
        wrap.ncSync = sync;
        sync();
    }

    function scrollByStep(track, amount) {
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // Read per click, not at build: the OS preference can flip mid-session.
        track.scrollBy({ left: amount, behavior: reduced ? 'auto' : 'smooth' });
    }

    /* -------------------------------------------------------------- promo card */

    /**
     * A tenant-authored upsell card (contract 1.5.0 `promo_card`). `title`,
     * `body` and `cta` are all wire-required — the CTA is the point of the
     * card, so a payload missing any of the three renders nothing at all
     * rather than a promo with a dead end, exactly the property card's rule
     * for its booking url.
     *
     * `image` and `style` are optional-omitted: a missing/rejected image means
     * no cover band, and an absent or unrecognised `style` simply falls
     * through to the base bordered-white rule below — there is no branch that
     * can throw on an unknown value.
     *
     * Closes any open CTA group (renderAction returns null for it), so the
     * link_buttons a reply carries after the promo still group into their own
     * wrapping row — the same contract renderPropertyCards follows.
     */
    function renderPromoCard(action) {
        if (typeof action.title !== 'string' || !action.title ||
            typeof action.body !== 'string' || !action.body) {
            log('promo card dropped — missing title or body');
            return;
        }

        var cta = action.cta || {};
        var href = safeHttpUrl(cta.url);
        if (typeof cta.label !== 'string' || !cta.label || !href) {
            log('promo card dropped — no usable cta', action.title);
            return;
        }

        var card = el('div', 'nc-promo' + (action.style === 'highlight' ? ' nc-promo--highlight' : ''));

        var image = safeHttpUrl(action.image);
        if (image) {
            var img = el('img', 'nc-promo-image');
            // alt="" on purpose: the image sits over the title/body that follow
            // it, so announcing it too would be noise — same call as the
            // property card's photo.
            attrs(img, { src: image, alt: '', loading: 'lazy' });
            card.appendChild(img);
        }

        card.appendChild(el('div', 'nc-promo-title', action.title));
        card.appendChild(el('div', 'nc-promo-body', action.body));

        var link = el('a', 'nc-promo-cta', cta.label);
        attrs(link, { href: href, target: '_blank', rel: 'noopener noreferrer' });
        card.appendChild(link);

        els.body.appendChild(card);
        scrollDown();
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
     *
     * Screen readers hear the reply ONCE, whole, the moment typing starts — never
     * the stream. That is entirely announce()'s job: .nc-body is not a live region
     * (build()), so streaming into it says nothing, and nothing here has to hide
     * the bubble to keep it quiet. The bubble therefore stays in the accessibility
     * tree and stays explorable by touch.
     *
     * The poll re-typing a bubble announces the final text again, superseding the
     * interim announcement — wanted, and free, since the announcer holds one node.
     */
    function typeText(node, text, done) {
        var token = (node.ncTypeToken || 0) + 1;
        node.ncTypeToken = token;

        var full = String(text == null ? '' : text);

        // Before streaming, on BOTH paths below: the guest hears the whole reply
        // while the eye is still watching it arrive.
        announce(full);

        // A guest who asked the OS for less motion gets the reply at once. The
        // return sits above the nc-typing class on purpose: the caret is a solid
        // block that only its animation reads as a caret, and the reduced-motion
        // rule stops that animation — the class on a node that never streams
        // would park a rectangle after the text forever. Removing it as well
        // covers the poll re-typing a bubble whose first pass was mid-stream when
        // the preference flipped. `done` still fires: the welcome block hangs off
        // it, and a reduced-motion guest must not lose it.
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) {
            node.classList.remove('nc-typing');
            node.textContent = full;
            scrollDown();
            if (done) { done(); }
            return;
        }

        var chars = Array.from(full);
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

    var intro = { animDone: false, greeting: null, actions: null, settled: false };

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
            var avatar = avatarNode();
            var text = el('div', 'nc-text');
            wrap.appendChild(avatar);
            wrap.appendChild(text);

            // Insert directly after the loader, NOT at the end: the composer is
            // live while the intro runs, so an impatient guest can already have
            // sent a message. The greeting still has to read first.
            els.body.insertBefore(wrap, els.loader.nextSibling);

            requestAnimationFrame(function () {
                wrap.classList.add('nc-visible');
                // The welcome block hangs off the typer's completion so it lands
                // under a finished greeting, never beside a half-typed one.
                // typeText fires `done` on both of its paths — a reduced-motion
                // guest gets this callback synchronously, from inside the call
                // below, which is why it reads only `wrap` and module state and
                // nothing assigned after this line.
                typeText(text, intro.greeting, function () {
                    if (removed || guestTurned) { return; }
                    if (intro.actions) {
                        // The server owns the welcome when it configured one, so its
                        // elements REPLACE the pack-string block rather than joining it.
                        // They are also transcript content — elements on the greeting
                        // behave like elements on any other reply — so removePrompts()
                        // must never reach them: els.prompts stays null here.
                        renderActions(intro.actions, text);
                    } else {
                        showPrompts(wrap);
                    }
                });
            });
        }, 900);
    }

    /* ------------------------------------------------------ the welcome block */
    /*
     * Two suggested openers under the greeting. They are PACK STRINGS, cached in
     * the widget rather than fetched: the welcome state is the one moment the
     * guest is watching a spinner, and it must not cost a second round trip.
     */

    var PROMPT_KEYS = ['prompt1', 'prompt2'];

    /**
     * Inserted after the greeting, never appended to .nc-body: the composer is
     * live all through the intro, so appending would file the block behind an
     * impatient guest's own bubble.
     *
     * Labels are resolved at CLICK time, not here. A guest who switches language
     * between reading the pill and tapping it must send the sentence they can
     * read — and setLocale() repaints the visible pills to match.
     *
     * Nothing here announces: this is interactive chrome reached by Tab, and the
     * announcer exists for replies the eye may miss, not for buttons.
     */
    function showPrompts(after) {
        var prompts = el('div', 'nc-prompts');
        var label = el('span', 'nc-prompts-label', t('tryAsking'));
        prompts.appendChild(label);

        var buttons = [];
        PROMPT_KEYS.forEach(function (key) {
            var button = el('button', 'nc-prompt', t(key));
            attrs(button, { type: 'button' });
            button.addEventListener('click', function () { sendGuestText(t(key)); });
            prompts.appendChild(button);
            buttons.push(button);
        });

        after.parentNode.insertBefore(prompts, after.nextSibling);
        els.prompts = prompts;
        els.promptsLabel = label;
        els.promptButtons = buttons;
        scrollDown();
    }

    // Null-safe and idempotent: it runs on every guest turn, and only the first
    // one has anything to remove.
    function removePrompts() {
        if (els.prompts && els.prompts.parentNode) {
            els.prompts.parentNode.removeChild(els.prompts);
        }
        els.prompts = null;
        els.promptsLabel = null;
        els.promptButtons = null;
    }

    /* ============================================================= flow ===== */

    function isOpen() { return els.root.classList.contains('nc-open'); }

    function open() {
        if (removed || isOpen()) { return; }
        els.root.classList.add('nc-open');
        els.toggler.setAttribute('aria-expanded', 'true');
        markOpened();
        hideTeaser();
        playIntro();
        setTimeout(function () { els.input.focus(); }, 320);
    }

    // The first open of the session retires the unread affordance for good:
    // flag, dot, and the launcher's label drops its "1 new message". Every open
    // path lands here — toggler, teaser body, NestChatbot.open(), auto-open.
    function markOpened() {
        writeFlag('sessionStorage', FLAG_OPENED);
        if (els.unread) {
            if (els.unread.parentNode) { els.unread.parentNode.removeChild(els.unread); }
            els.unread = null;
            els.toggler.setAttribute('aria-label', t('open'));
        }
    }

    function close() {
        if (removed || !isOpen()) { return; }
        els.root.classList.remove('nc-open');
        els.toggler.setAttribute('aria-expanded', 'false');
        closeLanguageMenu();
    }

    function toggle() { isOpen() ? close() : open(); }

    /* --------------------------------------------------------- expanded ----- */

    /*
     * The wide side sheet. All of the sizing is CSS, inside a
     * @media (min-width: 1024px) block — this pair of functions only owns the
     * class and the control's label. That is deliberate: a guest who expands on
     * a desktop and then narrows the window falls back to fullscreen with no
     * resize listener, no rebuild and no re-render, which is exactly why the
     * transcript and the scroll position survive a resize. Narrowing does not
     * clear the class; the class simply stops matching.
     *
     * Esc is unaffected — it still means close/minimise, never "shrink".
     */
    function isExpanded() { return els.root.classList.contains('nc-expanded'); }

    function expandPanel() {
        if (removed || isExpanded()) { return; }
        els.root.classList.add('nc-expanded');
        els.expand.setAttribute('aria-label', t('shrink'));
        resyncCarousels();
    }

    // byUser distinguishes the guest pulling the sheet back in — a stated
    // preference worth remembering — from any programmatic shrink.
    function shrinkPanel(byUser) {
        if (removed || !isExpanded()) { return; }
        els.root.classList.remove('nc-expanded');
        els.expand.setAttribute('aria-label', t('expand'));
        if (byUser) { writeFlag('localStorage', FLAG_USER_SHRANK); }
        resyncCarousels();
    }

    /*
     * A carousel's arrows, fades and dots are derived from the track's CURRENT
     * width, and only a scroll event recomputes them. Going 420px → 670px can
     * stop the track overflowing altogether, and fires no scroll — so without
     * this the forward arrow stays on screen, pointing at nothing, until the
     * guest happens to swipe. renderPropertyCards() hangs each wrapper's own
     * sync on the node as ncSync for exactly this call.
     *
     * Measured AFTER the panel has moved, never beside the class toggle: the
     * width is transitioned, so a measurement taken there reads the width the
     * sheet is LEAVING and is as wrong as no sync at all — and nothing else ever
     * corrects it, because a resize fires no scroll event.
     *
     * Reduced motion needs a beat too, just not the whole transition: the panel's
     * duration collapses to ~0 there, but the new width still only lands on the
     * next frame, so a synchronous read after the toggle measures 420px either
     * way. It gets its own short delay rather than the full 560ms — a guest who
     * asked for less motion should not be looking at a dead arrow for half a
     * second.
     */
    var CAR_RESYNC_MS = 560;        // just past the 500ms --nc-dur-slow transition
    var CAR_RESYNC_FAST_MS = 60;    // reduced motion: a frame or two, no more

    function resyncCarousels() {
        // Read per toggle, not at build — the OS preference can flip mid-session,
        // the same reason scrollByStep() re-reads it per click.
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(function () {
            // teardown() clears no timers, by contract — every callback re-checks.
            if (removed) { return; }
            syncCarousels();
        }, reduced ? CAR_RESYNC_FAST_MS : CAR_RESYNC_MS);
    }

    function syncCarousels() {
        var wraps = els.body.querySelectorAll('.nc-carousel');
        for (var i = 0; i < wraps.length; i++) {
            if (wraps[i].ncSync) { wraps[i].ncSync(); }
        }
    }

    /* ----------------------------------------------------------- teaser ----- */

    // One nudge per session: armed at boot, fires after 8s of the panel staying
    // closed, gone by itself 6s later. Timers follow the teardown contract —
    // teardown() clears nothing, so every callback early-returns on `removed`
    // and re-checks its guards: state can change while a timer waits.
    var TEASER_SHOW_MS = 8000;
    var TEASER_HIDE_MS = 6000;
    var TEASER_EXIT_MS = 320;   // just past the 300ms exit transition
    var teaserVisible = false;

    function scheduleTeaser() {
        if (readFlag('localStorage', FLAG_TEASER_DISMISSED)) { return; }
        if (readFlag('sessionStorage', FLAG_OPENED)) { return; }
        if (readFlag('sessionStorage', FLAG_TEASER_SHOWN)) { return; }
        setTimeout(showTeaser, TEASER_SHOW_MS);
    }

    function showTeaser() {
        if (removed || teaserVisible || isOpen()) { return; }
        // Re-checked at fire time: the guest can open the panel, or another tab
        // can dismiss forever, inside the 8s window.
        if (readFlag('sessionStorage', FLAG_OPENED)) { return; }
        if (readFlag('localStorage', FLAG_TEASER_DISMISSED)) { return; }
        teaserVisible = true;
        writeFlag('sessionStorage', FLAG_TEASER_SHOWN);
        // Re-set rather than just unhide: a role="status" region announces
        // changed content far more reliably than un-hidden content.
        els.teaserBody.textContent = t('teaser');
        els.teaser.classList.remove('nc-hidden');
        // Force a style flush between display and the transition class, or the
        // browser may paint the final state directly and skip the rise.
        void els.teaser.offsetWidth;
        els.teaser.classList.add('nc-teaser--in');
        setTimeout(hideTeaser, TEASER_HIDE_MS);
    }

    function hideTeaser() {
        if (removed || !teaserVisible) { return; }
        teaserVisible = false;
        // Never strand keyboard focus on a node about to vanish.
        if (els.teaser.contains(document.activeElement)) { els.toggler.focus(); }
        els.teaser.classList.remove('nc-teaser--in');
        // A fixed timer, not transitionend: reduced-motion zeroes --nc-dur, and
        // a 0ms transition never fires the event.
        setTimeout(function () {
            if (removed || teaserVisible) { return; }
            els.teaser.classList.add('nc-hidden');
        }, TEASER_EXIT_MS);
    }

    function dismissTeaserForever() {
        writeFlag('localStorage', FLAG_TEASER_DISMISSED);
        hideTeaser();
    }

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
                // A site can attach welcome elements to the greeting — same request,
                // zero extra network. Absent on older servers and [] when the site has
                // not configured any, and both mean the same thing here: fall back to
                // the widget's own prompt block.
                intro.actions = (body.actions && body.actions.length) ? body.actions : null;
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

    /**
     * THE SEND SEAM. Everything that puts a guest turn on the wire goes through
     * here — the composer, the suggested prompts, and any tap-to-send chip a
     * reply carries — so "the guest sent something" means exactly one thing:
     * the welcome block goes, the bubble lands, the turn is queued.
     *
     * Deliberately takes only the text: it is called straight from click
     * handlers that have no form event and nothing to do with the composer, so
     * it never touches els.input and never preventDefault()s anything.
     */
    function sendGuestText(text) {
        if (busy || removed) { return; }
        guestTurned = true;
        removePrompts();
        addBubble('guest', text);                     // textContent — a typed <img> stays text
        ensureConversation(function () { sendMessage(text, false); });
    }

    function submit(e) {
        if (e) { e.preventDefault(); }
        if (busy || removed) { return; }

        var text = (els.input.value || '').trim();
        if (text.length < 2) { return; }

        els.input.value = '';
        adjustInputHeight();
        sendGuestText(text);
    }

    function sendMessage(text, isRetry) {
        if (!conversationUuid) {
            // A failed re-init lands here; a throttled one deserves "try again
            // shortly", not a hard error.
            addBubble('bot', lastInitStatus === 429 ? t('retry') : t('error'));
            return;
        }

        // One turn in flight at a time. submit() gates on busy, but several
        // messages queued behind one init drain here together — serialize them
        // (their guest bubbles are already on screen, in order).
        if (busy) { sendQueue.push(text); return; }

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
                drainSend();
                return;
            }

            // Idled out (410) or unknown uuid (404). On the TURN endpoint both
            // mean "this stored uuid is dead" (guide §5.1): re-init transparently
            // and resend once — without clearing the store, a stale uuid would
            // wedge this browser for the full 24h retention window. The guest
            // sees one reply, never a duplicate and never an error. (On the POLL
            // endpoint a 404 is transient instead — see pollResult.)
            if ((status === 410 || status === 404) && !isRetry) {
                clearStore();
                conversationUuid = null;
                started = false;
                startConversation(function () { sendMessage(text, true); });
                return;   // the retry's own callback drains the queue
            }

            if (status === 403) { teardown(); return; }
            if (status === 429) { addBubble('bot', t('retry')); drainSend(); return; }

            addBubble('bot', t('error'));
            drainSend();
        });
    }

    function drainSend() {
        if (removed || busy || !sendQueue.length) { return; }
        sendMessage(sendQueue.shift(), false);
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

                // pending / 404 / 429 / network / unparseable body → transient:
                // back off (guide §5.1 — a poll 404 may be a row not yet visible
                // to this request; re-initing would abandon a live answer).
                schedule();
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

    // The open row squeezes the composer to make space for five flags, so it is a
    // transient menu, not a mode: it times out on its own. The token is what stops
    // an earlier timer collapsing a row the guest has since reopened — the timer
    // follows the teardown contract (teardown() clears nothing), so its callback
    // re-checks `removed` and its own token instead of trusting the state it was
    // scheduled in.
    var LANG_AUTO_CLOSE_MS = 4000;
    var langOpenToken = 0;

    function closeLanguageMenu() {
        langOpenToken += 1;   // any auto-collapse still in flight is now stale
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
            var tok = ++langOpenToken;
            setTimeout(function () {
                if (removed || tok !== langOpenToken) { return; }
                closeLanguageMenu();
            }, LANG_AUTO_CLOSE_MS);
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
        els.toggler.setAttribute('aria-label', els.unread ? t('openUnread') : t('open'));
        els.teaserBody.textContent = t('teaser');
        els.teaserClose.setAttribute('aria-label', t('teaserDismiss'));
        els.badge.textContent = t('aiAssistant');
        els.subline.textContent = t('subline');
        els.disclaimer.textContent = t('disclaimer');
        // Only while the widget's OWN welcome block is on screen — after the first
        // turn there is nothing to repaint, and the click handlers read their label
        // fresh anyway. Guarded on promptsLabel, not prompts: those are the fields
        // this branch actually dereferences, and server-rendered welcome chips are
        // payload strings that must never be repainted from a pack.
        if (els.promptsLabel) {
            els.promptsLabel.textContent = t('tryAsking');
            PROMPT_KEYS.forEach(function (key, i) {
                els.promptButtons[i].textContent = t(key);
            });
        }
        els.panel.setAttribute('aria-label', 'Germán — ' + t('assistantRole'));
        // The one control whose label depends on state, not just on locale: it
        // reads "shrink" while the sheet is out.
        els.expand.setAttribute('aria-label', isExpanded() ? t('shrink') : t('expand'));

        SUPPORTED.forEach(function (code2) {
            els.optionButtons[code2].classList.toggle('nc-hidden', code2 === locale);
        });
    }

    /* ============================================================= boot ===== */

    function wire() {
        els.toggler.addEventListener('click', toggle);
        els.close.addEventListener('click', close);
        // Hidden by CSS below 1024px, so this can never fire there.
        els.expand.addEventListener('click', function () {
            isExpanded() ? shrinkPanel(true) : expandPanel();
        });
        els.teaserBody.addEventListener('click', open);
        els.teaserClose.addEventListener('click', dismissTeaserForever);
        els.form.addEventListener('submit', submit);

        els.input.addEventListener('input', adjustInputHeight);
        els.input.addEventListener('keydown', function (e) {
            // Typing IS the guest telling us they are done with the language row:
            // it is holding the composer at two thirds width while they write in
            // it. Collapse on the first keystroke rather than making them wait
            // out the 4s timer or aim at the flag again.
            if (els.controls.classList.contains('nc-lang-open')) { closeLanguageMenu(); }
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
        if (e.key !== 'Escape') { return; }
        if (isOpen()) { close(); els.toggler.focus(); return; }
        // Esc on the teaser means "not now", never "not ever": it hides the nudge
        // for this moment and writes no flag. Dismissing it for good stays the ✕
        // on the teaser itself — a deliberate act, not a reflex keystroke.
        if (teaserVisible) { hideTeaser(); }
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
        // After the auto-open check: an auto-opened session has already written
        // the opened flag, so the teaser timer never arms.
        scheduleTeaser();
        log('booted', VERSION, { locale: locale, assetBase: assetBase, mock: USE_MOCK });
    }

    if (document.body) { boot(); }
    else { document.addEventListener('DOMContentLoaded', boot); }
})();
