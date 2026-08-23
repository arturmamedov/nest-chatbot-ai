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
 * Built against response contract 1.7.0 (BUILT_AGAINST, api section), in
 * lockstep with the packet vendored in docs/wsuite/ — release 2.10.0 is the sync
 * that adopted it. BUILT_AGAINST records what this code implements, not
 * what the docs say. The server reports its live contract_version at init; the
 * widget warns once — never fails — when the server is ahead. The reference
 * implementation is docs/wsuite/chatbot.reference.js — consult it when a detail of
 * the transport or the element contract is unclear.
 */
(function () {
    'use strict';

    var VERSION = '2.10.2';

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
        debug: data.debug === 'true',
        // Typography opt-out — see applyFonts() in the dom section for what each
        // value does and why the default is worth keeping.
        fonts: data.fonts || '',              // '' | 'nest' | 'host' | 'system'
        fontHeading: data.fontHeading || '',
        fontBody: data.fontBody || ''
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
    var replyCount = 0;     // real assistant turn replies this session — see maybeAutoExpand
    var introPlayed = false;
    // The guest has sent at least one turn. Latched for the life of the
    // conversation, never cleared within it: the welcome block is a
    // first-contact affordance, and a conversation that has started must never
    // have it appear on top of it — including the race where the greeting is
    // still typing when the first message goes out. restartConversation() is
    // the one reset: a restart begins a NEW conversation's life.
    var guestTurned = false;
    var chipRows = [];      // live mid-transcript quick_replies rows — retired on ANY send (1.6.0 one-shot rule)
    var ended = false;      // conversation_ended received — composer closed until the guest restarts
    // The DISPLAY-ONLY transcript, oldest first: {r:'bot'|'guest', t:'<final
    // text>', a: actions[]|null, n: <server turn>|null}. Persisted so a reload
    // inside the idle window lands the guest where they left off; it must
    // NEVER enter a request body — the server owns the real transcript, keyed
    // by the conversation uuid (CLAUDE.md, "Do not send chat history").
    var transcript = [];
    // True only while replayTranscript() paints stored turns: the guest has
    // seen all of it, so addBubble() must not announce it — twenty stored
    // replies would bury the live region at every page load. The first LIVE
    // reply after a replay announces as ever.
    var replaying = false;
    // async poll path → its transcript entry, so the final can replace the
    // interim's t/a IN PLACE. Keyed by the poll path (the identity the wire
    // already uses) because the interim turn is not necessarily the LAST
    // entry when its poll resolves — the guest can send more turns meanwhile.
    // Object.create(null): the path is payload-derived, and a key like
    // 'constructor' must not phantom-match (same reason as cardUrls).
    var pollEntries = Object.create(null);
    // Bumped by restartConversation(): a poll from the dead conversation can be
    // backing off for up to 120s, and without this it would type into a detached
    // bubble and render actions into the NEW conversation's transcript.
    var chatEpoch = 0;
    // The two returning-guest facts, reported through the events section and
    // NestChatbot.state. They answer DIFFERENT questions and must not be
    // collapsed: `returning` is "this browser arrived with a live conversation",
    // read at boot and true even if the guest never opens the panel; `resumed`
    // is the branch playIntro() ACTUALLY took, so it can never disagree with
    // what the guest saw on screen.
    var returning = false;
    var resumed = false;
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
            expand: 'Expand the chat', shrink: 'Shrink the chat', menu: 'More options',
            tryAsking: 'Try asking',
            quickReplies: 'Quick replies',
            prompt1: 'Which hostel fits me best?', prompt2: 'How does the Nest Pass work?',
            disclaimer: 'AI answers — double-check important',
            priceFrom: 'from %s',
            priceNight: '/night', priceStay: '/stay',
            pricePerPerson: 'per person', pricePerUnit: 'per unit',
            carousel: 'carousel', carouselPrev: 'Scroll back', carouselNext: 'Scroll forward',
            scrollLatest: 'Scroll down to last message',
            properties: 'Properties', showingOf: 'Showing %s of %s',
            send: 'Send message', input: 'Type your message',
            language: 'Change language', languageOf: 'Switch to %s',
            book: 'Book now', open_link: 'Open',
            newChat: 'Start a new chat', newChatConfirm: 'Yes, clear this chat',
            dayToday: 'Today', dayYesterday: 'Yesterday',
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
            expand: 'Ampliar el chat', shrink: 'Reducir el chat', menu: 'Más opciones',
            tryAsking: 'Prueba a preguntar',
            quickReplies: 'Respuestas rápidas',
            prompt1: '¿Qué hostel me encaja mejor?', prompt2: '¿Cómo funciona el Nest Pass?',
            disclaimer: 'Respuestas de IA — verifica lo importante',
            priceFrom: 'desde %s',
            priceNight: '/noche', priceStay: '/estancia',
            pricePerPerson: 'por persona', pricePerUnit: 'por unidad',
            carousel: 'carrusel', carouselPrev: 'Retroceder', carouselNext: 'Avanzar',
            scrollLatest: 'Bajar al último mensaje',
            properties: 'Alojamientos', showingOf: 'Mostrando %s de %s',
            send: 'Enviar mensaje', input: 'Escribe tu mensaje',
            language: 'Cambiar idioma', languageOf: 'Cambiar a %s',
            book: 'Reservar ahora', open_link: 'Abrir',
            newChat: 'Empezar un chat nuevo', newChatConfirm: 'Sí, borrar este chat',
            dayToday: 'Hoy', dayYesterday: 'Ayer',
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
            // Not 'Riduci la chat': that is already `close` above, and the two
            // controls sit side by side in the header — one accessible name each.
            expand: 'Espandi la chat', shrink: 'Rimpicciolisci la chat', menu: 'Altre opzioni',
            tryAsking: 'Prova a chiedere',
            quickReplies: 'Risposte rapide',
            prompt1: 'Quale hostel fa per me?', prompt2: 'Come funziona il Nest Pass?',
            disclaimer: 'Risposte IA — verifica ciò che è importante',
            priceFrom: 'da %s',
            priceNight: '/notte', priceStay: '/soggiorno',
            pricePerPerson: 'a persona', pricePerUnit: 'per unità',
            carousel: 'carosello', carouselPrev: 'Indietro', carouselNext: 'Avanti',
            scrollLatest: 'Scendi all\'ultimo messaggio',
            properties: 'Strutture', showingOf: 'Mostrati %s di %s',
            send: 'Invia messaggio', input: 'Scrivi il tuo messaggio',
            language: 'Cambia lingua', languageOf: 'Passa a %s',
            book: 'Prenota ora', open_link: 'Apri',
            newChat: 'Inizia una nuova chat', newChatConfirm: 'Sì, cancella questa chat',
            dayToday: 'Oggi', dayYesterday: 'Ieri',
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
            expand: 'Chat vergrößern', shrink: 'Chat verkleinern', menu: 'Weitere Optionen',
            tryAsking: 'Frag zum Beispiel',
            quickReplies: 'Schnellantworten',
            prompt1: 'Welches Hostel passt zu mir?', prompt2: 'Wie funktioniert der Nest Pass?',
            disclaimer: 'KI-Antworten — Wichtiges bitte prüfen',
            priceFrom: 'ab %s',
            priceNight: '/Nacht', priceStay: '/Aufenthalt',
            pricePerPerson: 'pro Person', pricePerUnit: 'pro Einheit',
            carousel: 'Karussell', carouselPrev: 'Zurück', carouselNext: 'Weiter',
            scrollLatest: 'Zur letzten Nachricht springen',
            properties: 'Unterkünfte', showingOf: '%s von %s angezeigt',
            send: 'Nachricht senden', input: 'Schreibe deine Nachricht',
            language: 'Sprache wechseln', languageOf: 'Zu %s wechseln',
            book: 'Jetzt buchen', open_link: 'Öffnen',
            newChat: 'Neuen Chat starten', newChatConfirm: 'Ja, Chat löschen',
            dayToday: 'Heute', dayYesterday: 'Gestern',
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
            // Not 'Réduire le chat': that is already `close` above, and the two
            // controls sit side by side in the header — one accessible name each.
            expand: 'Agrandir le chat', shrink: 'Rétrécir le chat', menu: 'Plus d\'options',
            tryAsking: 'Essayez de demander',
            quickReplies: 'Réponses rapides',
            prompt1: 'Quel hostel me correspond le mieux ?', prompt2: 'Comment fonctionne le Nest Pass ?',
            disclaimer: 'Réponses IA — vérifiez l\'essentiel',
            priceFrom: 'à partir de %s',
            priceNight: '/nuit', priceStay: '/séjour',
            pricePerPerson: 'par personne', pricePerUnit: 'par unité',
            carousel: 'carrousel', carouselPrev: 'Précédent', carouselNext: 'Suivant',
            scrollLatest: 'Aller au dernier message',
            properties: 'Hébergements', showingOf: '%s sur %s affichés',
            send: 'Envoyer le message', input: 'Écris ton message',
            language: 'Changer de langue', languageOf: 'Passer en %s',
            book: 'Réserver', open_link: 'Ouvrir',
            newChat: 'Commencer un nouveau chat', newChatConfirm: 'Oui, effacer ce chat',
            dayToday: 'Aujourd\'hui', dayYesterday: 'Hier',
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

    // Each extra argument fills the NEXT %s in order — String.replace with a
    // string replaces the first match only — so a two-slot key like showingOf
    // needs no second formatter and every one-slot caller is untouched.
    function tf(key) {
        var out = String(t(key));
        for (var i = 1; i < arguments.length; i++) { out = out.replace('%s', arguments[i]); }
        return out;
    }

    /* ========================================================== storage ===== */

    var STORE_KEY = 'nest-chatbot:' + (cfg.key || cfg.apiBase || 'default');
    /*
     * The FALLBACK idle window, not a mirror any more. Until contract 1.7.0 there
     * was no way to learn the server's own `conversation.idle_hours`, so this
     * constant hand-mirrored a deployment config it could not see change — the
     * defect 2.10.0 removes. It is now only what an older server, or a record
     * written by one, degrades to. Keep it at the platform default so that
     * degrading changes nothing.
     */
    var IDLE_MS = 24 * 60 * 60 * 1000;
    var TURNS_MAX = 40;                  // safety rail — observed mean is ~1.3 turns/conversation
    var STORE_MAX_CHARS = 64 * 1024;     // JSON.stringify().length — UTF-16 units, what quota charges

    /*
     * The server's own idle window in hours (1.7.0), and its clock offset in ms.
     * Both are settled at init, both are PERSISTED with the record, and both are
     * restored on the resume branch — see storedIdleMs() and nowMs() for why
     * reading them at init alone is a half-fix that looks finished.
     */
    var serverIdleHours = null;   // null against a server that does not send it
    var serverOffset = 0;         // Date.parse(server_time) - Date.now(), once

    /*
     * The record is {uuid, ts, actions, turns, guestTurned, ended, idleHours,
     * clockOffset} and readStore() hands back the OBJECT,
     * never a bare uuid: a returning guest inside the idle window resumes without
     * ever calling API.init, so the site's welcome elements — its configured
     * quick_prompts, its show_at_init promo — have nowhere else to come from. Up
     * to 2.4.1 a repeat visitor silently lost every one of them and saw only the
     * widget's fallback pills, for the whole 24h. Every browser check cleared
     * localStorage first, which is exactly the condition that hides it.
     *
     * Replaying a payload out of localStorage is safe for the same reason
     * replaying it off the wire is: it goes back through the same renderers, and
     * those treat every payload string as untrusted already (textContent,
     * safeHttpUrl, never innerHTML). A tampered store can only produce what a
     * hostile server could already produce — which is the threat model the
     * renderers are written against, not an additional one.
     *
     * Since 2.8.0 the record also carries the transcript ({r, t, a, n, at}
     * turns, oldest first) plus the guestTurned and ended latches. The same
     * argument covers it: replayed turn text and actions[] go back through the
     * same renderers, which treat every payload string as untrusted already.
     * `n` is the server's 1-based turn number, stored UNUSED so a future
     * ?since={turn} reconciliation endpoint is a drop-in with no stored-data
     * migration. `a` holds paint-only elements — persistableActions() strips
     * anything whose renderer has a side effect (see its comment).
     *
     * `at` (2.8.1) is when the entry was CREATED, epoch ms — the day separators
     * and each bubble's title are computed from it. Not named `ts`: the record
     * has one of those already and it means something else entirely (last
     * activity, rewritten every turn), so two fields answering to the same name
     * across one nesting level would be a trap rather than a convenience.
     * ~18 chars a turn, ~720 bytes at the 40-turn cap — nothing worth encoding.
     *
     * `idleHours` and `clockOffset` (2.10.0) are the server's two 1.7.0 answers,
     * carried here because the resume branch never reaches the server to ask
     * again — see storedIdleMs() and nowMs().
     *
     * Accepted cost: welcome elements can be up to one idle window stale. They
     * are site settings rather than conversation state, so the worst case is a
     * returning guest reading yesterday's promo copy until the conversation
     * expires.
     */
    function readStore() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (!raw) { return null; }
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.uuid || !parsed.ts) { return null; }
            // The RECORD's window, not the constant's — see storedIdleMs().
            if ((Date.now() - parsed.ts) > storedIdleMs(parsed)) { return null; }
            // Anything but a non-empty array is dropped rather than handed on: a
            // malformed store must degrade to "no welcome elements", never throw,
            // and above all never cost the guest the conversation it also holds.
            return {
                uuid: parsed.uuid,
                actions: (Array.isArray(parsed.actions) && parsed.actions.length) ? parsed.actions : null,
                turns: validTurns(parsed.turns),
                guestTurned: parsed.guestTurned === true,
                ended: parsed.ended === true,
                // Handed back so the resume branch can RESTORE them into state.
                // This object is rebuilt field by field, so a field left out of
                // it silently vanishes — the same opt-in note validTurns() carries.
                idleHours: positiveHours(parsed.idleHours),
                clockOffset: (typeof parsed.clockOffset === 'number' && isFinite(parsed.clockOffset))
                    ? parsed.clockOffset : 0
            };
        } catch (e) { return null; }
    }

    // One validator, two callers (the record and the init body): "hours" means a
    // finite number above zero, and anything else means the field is not there.
    function positiveHours(value) {
        return (typeof value === 'number' && isFinite(value) && value > 0) ? value : null;
    }

    /*
     * The idle window to judge a STORED record by (contract 1.7.0).
     *
     * Reading `idle_hours` off the init response is not enough on its own, and
     * the half-implementation looks correct: readStore() runs at BOOT, and a
     * guest inside the window resumes WITHOUT ever calling init — so the one
     * visit that needs the server's number is the visit that never receives it.
     * The record therefore carries the window it was written under, and this
     * reads it back.
     *
     * Absence is normal in both directions: an older server sends no idle_hours,
     * a record written before 2.10.0 has no field, and both fall back to IDLE_MS.
     */
    function storedIdleMs(parsed) {
        var hours = positiveHours(parsed && parsed.idleHours);
        return hours === null ? IDLE_MS : hours * 60 * 60 * 1000;
    }

    /*
     * NOW, corrected by the server's clock (contract 1.7.0) — for CALENDAR
     * stamps only. Nothing in the guest API dates a message, so the day
     * separators and bubble titles are stamped here; a device whose clock is
     * days out was writing those wrong, and a replay showed it.
     *
     * The rule that keeps this coherent, and the easy thing to get wrong:
     * corrected time for anything that becomes a DATE, raw Date.now() for
     * anything that measures a DURATION. So latencyMs, the poll's give-up
     * deadline, the teaser timers and the record's own `ts` all stay raw —
     * they are two readings of one device's clock, where skew cancels.
     *
     * dayKey() still takes local midnight in the DEVICE's timezone: server_time
     * corrects the instant, never the zone, and the guest's own zone is the
     * right one for "today". A guest who changes timezone between visits still
     * sees their days recomputed — see docs/proposals/message-timestamps.md.
     *
     * Two places the offset is legitimately 0 on a broken clock, both narrow and
     * both first-visit only, recorded rather than papered over:
     *   - a guest who types faster than init returns. The composer is live all
     *     through the intro, so their first bubble can be stamped before the
     *     201 lands. Everything after it, greeting included, is corrected.
     *   - entries stored before 2.10.0, which hold device time. They are read
     *     back against a corrected "today" — the same legacy class as the
     *     pre-2.8.1 entries that carry no `at` at all, and it ages out with the
     *     idle window.
     */
    function nowMs() {
        return Date.now() + serverOffset;
    }

    // Per-ENTRY defence, same posture as `actions` above: a malformed entry is
    // dropped, a malformed list degrades to "no transcript" (today's intro), and
    // nothing here can throw past readStore's try. Entries are REBUILT rather
    // than passed through, so a tampered record cannot smuggle extra keys back
    // into the next persist().
    function validTurns(turns) {
        if (!Array.isArray(turns) || !turns.length) { return null; }
        var out = [];
        for (var i = 0; i < turns.length; i++) {
            var e = turns[i];
            if (!e || (e.r !== 'bot' && e.r !== 'guest')) { continue; }
            out.push({
                r: e.r,
                t: typeof e.t === 'string' ? e.t : '',
                a: (Array.isArray(e.a) && e.a.length) ? e.a : null,
                n: (typeof e.n === 'number' && isFinite(e.n)) ? e.n : null,
                // Same posture as `n`, and it has to be REBUILT here like every
                // other field: this loop is deliberately opt-in, so a field left
                // out of it silently vanishes on the next reload. A record
                // written before 2.8.1 simply has none — null, and the render
                // side paints neither a day separator nor a title for it.
                at: (typeof e.at === 'number' && isFinite(e.at)) ? e.at : null
            });
        }
        return out.length ? out : null;
    }

    /*
     * The paint-only rule: `a` may hold only elements whose renderer just
     * paints. Anything with a side effect is stripped AT PERSIST TIME — it
     * never sits in the record at all — and its effect is represented as
     * explicit state instead:
     *   - async_result: renderAction routes it into pollResult, and on a
     *     replay the epoch is CURRENT, so every guard passes and each page
     *     load would restart a poll for a turn that resolved hours ago. When
     *     the live poll resolves, the final payload replaces the turn's t/a
     *     anyway (see pollResult).
     *   - conversation_ended: restored once from the stored `ended` boolean
     *     through endConversation() — one seam, not two.
     * A future element type with a side effect gets its exclusion HERE.
     */
    function persistableActions(actions) {
        if (!actions || !actions.length) { return null; }
        var kept = [];
        for (var i = 0; i < actions.length; i++) {
            var a = actions[i];
            if (a && (a.type === 'async_result' || a.type === 'conversation_ended')) { continue; }
            kept.push(a);
        }
        return kept.length ? kept : null;
    }

    /*
     * The one writer. Serializes CURRENT state — uuid, the init welcome
     * elements, the transcript, the two latches — so every caller is "state
     * changed, record it" with no arguments to get wrong. With this firing on
     * every turn, `ts` now means "last activity", which is what the server's
     * idle_hours has always measured — a guest chatting past hour 24 is no
     * longer reset client-side under a live server conversation.
     */
    function persist() {
        // Never write without a uuid: readStore() rejects a uuid-less record,
        // so a persist racing ahead of init (a guest bubble lands before the
        // 201 arrives) would cost the guest the record it also holds. The
        // in-memory transcript keeps the turn; init's own persist() writes it.
        if (!conversationUuid) { return; }
        var record = {
            // `ts` stays on the RAW clock: it is compared against Date.now() in
            // readStore(), so both readings come from one device and any skew
            // cancels. Correcting it would import the server offset into a
            // duration measurement that never needed it.
            uuid: conversationUuid, ts: Date.now(), actions: intro.actions || null,
            turns: transcript, guestTurned: guestTurned, ended: ended,
            // The 1.7.0 pair. Serialized from CURRENT state with no arguments,
            // which is what makes restoring them on the resume branch load-bearing:
            // a resumed session that did not restore them would write null/0 here
            // on its first turn and silently drop both back to the fallback.
            idleHours: serverIdleHours, clockOffset: serverOffset
        };
        try {
            window.localStorage.setItem(STORE_KEY, boundedRecord(record));
        } catch (e) {
            // Quota, not private mode (that throws above too, and lands here
            // the same): shed the transcript and keep the conversation — the
            // uuid must never be the casualty of its own history.
            try {
                record.turns = [];
                window.localStorage.setItem(STORE_KEY, JSON.stringify(record));
            } catch (e2) { /* private mode — the widget still works, just not across reloads */ }
        }
    }

    /*
     * 40 turns / 64K chars, whichever hits first — a safety rail, not a
     * working limit. Oldest first, payload before text: a turn's rich
     * elements are the bulk of its bytes and a card-less old turn still
     * reads, so shed `a` from the oldest turn that has one, then whole oldest
     * turns — and never the most recent turn, whose `a` goes last. Entries
     * are COPIED before they are thinned: the live transcript must not lose
     * cards to a size check on its serialized twin.
     */
    function boundedRecord(record) {
        var turns = record.turns.slice(-TURNS_MAX);
        var droppedTurns = record.turns.length - turns.length;   // the turn cap, before any byte work
        var thinnedActions = 0;
        record.turns = turns;
        var out = JSON.stringify(record);
        while (out.length > STORE_MAX_CHARS && turns.length) {
            var thinned = false;
            for (var i = 0; i < turns.length - 1; i++) {
                if (turns[i].a) {
                    turns[i] = { r: turns[i].r, t: turns[i].t, a: null, n: turns[i].n, at: turns[i].at };
                    thinned = true;
                    thinnedActions += 1;
                    break;
                }
            }
            if (!thinned) {
                if (turns.length > 1) { turns.shift(); droppedTurns += 1; }
                else if (turns[0].a) {
                    turns[0] = { r: turns[0].r, t: turns[0].t, a: null, n: turns[0].n, at: turns[0].at };
                    thinnedActions += 1;
                }
                else { turns.length = 0; droppedTurns += 1; }
            }
            out = JSON.stringify(record);
        }
        // Shedding is invisible by construction — the guest sees the full transcript
        // on screen either way, and only the NEXT reload shows what the record lost.
        // The byte cap in particular is unreachable from the mock (the turn cap binds
        // first, ~37KB at 40 card turns) but reachable on a guest's device, where a
        // real property_cards rail with long image urls runs several KB a turn. One
        // line, on the existing data-debug gate: the contract-drift warn stays the
        // file's only ungated console output.
        if (thinnedActions || droppedTurns) {
            log('store bounded', { thinnedActions: thinnedActions, droppedTurns: droppedTurns,
                                   keptTurns: turns.length, chars: out.length });
        }
        return out;
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
         once has stated a preference, and it should outlive the tab.
       - EXPANDED is per browser and records the panel's CURRENT size, so a
         reload does not drop a guest reading the wide sheet back into the 420px
         card. It answers a different question from USER_SHRANK and both are
         needed: a guest who shrank once (auto-expand suppressed forever) and
         later expanded by hand still gets their expanded panel back. */
    var FLAG_AUTO_EXPANDED = 'nest-chatbot:auto-expanded';        // sessionStorage
    var FLAG_USER_SHRANK = 'nest-chatbot:user-shrank';            // localStorage
    var FLAG_EXPANDED = 'nest-chatbot:expanded';                  // localStorage

    function readFlag(storeName, key) {
        try { return window[storeName].getItem(key) === '1'; } catch (e) { return false; }
    }

    function writeFlag(storeName, key) {
        try { window[storeName].setItem(key, '1'); } catch (e) { /* private mode — degrade to per-load */ }
    }

    // Removing the key rather than writing '0': readFlag's semantics are
    // '1'-or-absent everywhere, and a second falsy value would be a second thing
    // every reader has to know about.
    function clearFlag(storeName, key) {
        try { window[storeName].removeItem(key); } catch (e) { /* private mode — nothing to clear */ }
    }

    /* =========================================================== events ===== */
    /*
     * THE HOST-PAGE SEAM — how this widget is measured.
     *
     * It NEVER phones home. No analytics request of its own, ever: not to Nest,
     * not to a third party, not a beacon, not an image pixel. Everything the
     * widget can honestly report leaves through a DOM CustomEvent on our OWN
     * root, and the host page decides where it lands — their GA4 / Plausible /
     * Matomo, or nowhere. A host that listens to nothing pays nothing (an event
     * with no listener is free), which is why there is no data-* attribute to
     * switch this off.
     *
     * Dispatched from els.root, never from window: events bubble, so a host
     * listener on window or document hears them either way, and the widget still
     * touches no node it does not own. teardown()'s claim that the widget
     * attaches exactly two listeners outside #nest-chatbot stays true —
     * dispatching attaches none.
     *
     * TWO dispatches per call: 'wchat:<name>' for a host that wants one thing,
     * and a bare 'wchat' carrying the same detail plus `name`, so a host who
     * wires the umbrella once keeps receiving events added in later releases
     * without touching their code. Listening to both double-counts — README
     * says so.
     *
     * The namespace is 'wchat', not 'nest-chatbot', deliberately. These events
     * are the only NEW public surface here, so they adopt the destination
     * convention now, while #nest-chatbot / NestChatbot / nc- / STORE_KEY stay
     * put until one deliberate 3.0.0 moves them together (CLAUDE.md § Open
     * items). Renaming an event later would be a MAJOR, exactly like renaming a
     * runtime-API method — which is why the name is settled before the first one
     * ships.
     *
     * PAYLOAD RULE: counts, enums and booleans. NEVER guest text, NEVER reply
     * text — the transcript is display-only and stays that way. Element urls are
     * the one string that travels: they are server-supplied hrefs the guest is
     * navigating to, already visible in the DOM as an href, and without them the
     * conversion event cannot say WHICH property was booked.
     */
    var EVENT_NS = 'wchat';

    function emit(name, detail) {
        // Nothing before build() (els.root does not exist yet) and nothing after
        // destroy() — teardown() sets `removed` and detaches the root, so a
        // dispatch there would reach no listener anyway. Both guards, because
        // the second is a consequence and the first is a contract.
        if (removed || !els.root) { return; }
        var payload = detail || {};
        payload.name = name;
        // ONE object across both dispatches: a host that mutates detail in the
        // named listener changes what the umbrella listener sees. Copying per
        // dispatch would cost an allocation on every event to defend against a
        // host misbehaving inside their own page.
        try {
            els.root.dispatchEvent(new CustomEvent(EVENT_NS + ':' + name,
                { detail: payload, bubbles: true, composed: true }));
            els.root.dispatchEvent(new CustomEvent(EVENT_NS,
                { detail: payload, bubbles: true, composed: true }));
        } catch (e) {
            // Guards CustomEvent CONSTRUCTION only. A host listener that throws
            // cannot reach us — the DOM reports listener exceptions to the global
            // error handler instead of propagating them back to the dispatcher —
            // so a broken analytics tag can never break a guest's turn.
        }
    }

    /*
     * The same picture the events carry, readable at any moment. A host whose
     * analytics loaded after boot missed 'wchat:ready', and reading a getter is
     * simpler than us keeping a replayable event buffer. A fresh object per
     * read — never a live reference into module state.
     *
     * `conversation` is the uuid, and exposing it is deliberate: it makes
     * support correlation possible ("read me your chat id") and it is not a new
     * exposure — the uuid already sits in localStorage, which any same-origin
     * script on the host page can read.
     */
    function snapshot() {
        return {
            version: VERSION,
            locale: locale,
            open: !!els.root && isOpen(),
            expanded: !!els.root && isExpanded(),
            started: started,
            returning: returning,
            resumed: resumed,
            turns: transcript.length,
            guestTurned: guestTurned,
            ended: ended,
            destroyed: removed,
            conversation: conversationUuid
        };
    }

    /* An enum, never a passed-through argument. Three of the wire() listeners
       hand their handler a MouseEvent as the first argument, and a host is free
       to do `btn.addEventListener('click', NestChatbot.open)` and hand us one
       too — without this, `source` would log as [object MouseEvent] and the
       teaser's conversion rate would quietly become unreadable. */
    /* Element TYPES only, in payload order, and unknown types deliberately
       included: a type this widget silently ignores (the contract's
       ignore-unknown rule) is exactly what a host wants to see in their own
       numbers when the server starts shipping ahead of the widget. */
    function actionTypes(actions) {
        var out = [];
        if (!actions) { return out; }
        for (var i = 0; i < actions.length; i++) {
            if (actions[i] && actions[i].type) { out.push(String(actions[i].type)); }
        }
        return out;
    }

    var OPEN_SOURCES = ['toggler', 'teaser', 'auto', 'api'];
    var CLOSE_SOURCES = ['toggler', 'close', 'escape', 'api'];
    /* No 'api' in this one: there is no NestChatbot.restart(), so the default
       fallback below would name a caller that cannot exist. 'ended' is the
       honest answer — the conversation_ended button is the only restart
       listener a bare reference could regress, which is why endConversation()
       wires it through a wrapper. */
    var RESTART_SOURCES = ['ended', 'menu'];

    /* `fallback` is what an unrecognised value becomes. It defaults to 'api'
       because that is the truthful answer for open/close — a host calling the
       runtime method is the one caller those two cannot name — and restart
       passes its own for the reason above. */
    function oneOf(list, value, fallback) {
        return list.indexOf(value) === -1 ? (fallback || 'api') : value;
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
    var BUILT_AGAINST = '1.7.0';
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
     *   "available" → async_result: interim reply now, final reply after polling.
     *                 The final is an `availability` sharing the interim's url —
     *                 the ONE interim→poll duplicate 1.6.0 documents, so exactly
     *                 one Book button must ever be on screen for this turn
     *   "rooms"     → availability with room options
     *   "tenerife" / "canaria" / "ibiza" → property_cards + promo_card + the CTA
     *                 trio. The rail is also the 1.6.x showcase: per-card
     *                 period/basis (two DIFFERENT suffixes on one rail), a
     *                 cta_label, a name-less item sharing the website button's
     *                 url (the D-043(c) isolator: card dropped, button SURVIVES),
     *                 a "Book now" whose url equals a rendered card's (suppressed),
     *                 and `more` + `total` — ibiza sends total only (count line),
     *                 the other two send both (`more` wins)
     *   "hostel"    → quick_replies: the three island chips — the SAME payload the
     *                 init response carries, so this keyword also regression-tests
     *                 the welcome block's chip row
     *   "pass" / "offer" → promo_card on its own ("pass" is word-bounded, so
     *                 "passport" and "compass" fall through to the plain reply)
     *   "!cap"      → the turn-cap reply: contact_channels + conversation_ended
     *                 (emitted last, per contract) — composer closes, restart
     *                 button appears
     *   "!unknown"  → an unrecognised element type (must be ignored silently)
     *   "!xss"      → a hostile reply and a javascript: url (must both be inert)
     *   "!410" "!403" "!429" "!500" → force that status
     *   anything else → a plain reply
     *
     * The init response carries two chip rows (promptChips + islandChips), and
     * both of promptChips' messages land on a branch above rather than in the
     * catch-all — tapping a welcome chip is meant to demo a real answer.
     */
    var Mock = (function () {
        var pollCounts = {};
        var turn = 0;

        function reply(done, status, body, delay) {
            setTimeout(function () { done(status, body); }, delay == null ? 550 : delay);
        }

        /*
         * The idle window this fixture claims (1.7.0). 24 by default, matching
         * the platform default — but `?nc-idle=<hours>` on the demo page URL
         * overrides it, because the one thing the expiry rule needs to be tested
         * against is a window short enough to actually cross: ?nc-idle=0.005 is
         * 18 seconds. A real server's smallest step is an hour, and the
         * assertion is identical either way.
         *
         * A harness knob, and it can only ever be one: this whole object is
         * unreachable unless data-mock is set, which a production page never does.
         */
        function mockIdleHours() {
            var m = /[?&]nc-idle=([0-9.]+)/.exec(window.location.search);
            var hours = m ? parseFloat(m[1]) : NaN;
            return (isFinite(hours) && hours > 0) ? hours : 24;
        }

        // Two fixtures serve the same promo — the island answer and the
        // "pass"/"offer" answer — and the renderer has to see byte-identical
        // payloads from both. A factory, not a shared literal: each reply gets its
        // own object, so nothing downstream can leak state between turns.
        //
        // Spanish copy with locale: 'es' since the 1.6.1 sync: the demo page is
        // English, so this is the case the field exists for — a screen reader
        // must not read this block with an English voice, and devtools must show
        // lang="es" on .nc-promo. The \n in body exercises the pre-wrap rule
        // (promo bodies may carry newlines), and `id` is the content-derived
        // identity the widget deliberately ignores (no client-side capping).
        function promoCard() {
            return {
                type: 'promo_card',
                id: 'promo:6f3a1c2b',
                locale: 'es',
                title: 'Una reserva. Todos los hostels.',
                body: '7 noches por 140 € — el Nest Pass viaja contigo entre nuestras islas.\nCanjéalo en cualquier Nest.',
                cta: { label: 'Consigue tu Nest Pass', url: 'https://nestshostels.com/nest-pass' },
                style: 'highlight'
            };
        }

        // Same reasoning as promoCard(), and the same shape serves two callers: the
        // welcome elements on the init response and the "hostel" answer. Sharing the
        // factory is what makes the `hostel` regression keyword a real test of the
        // welcome path — both see a byte-identical payload, so a chip that renders
        // one way in the transcript cannot quietly render another way at init.
        function islandChips() {
            // id names the row's provenance (1.6.0); NO locale on purpose — the
            // labels are island proper nouns, and the contract says the server
            // omits the field rather than claim a language for text that has
            // none. The widget must then set no lang attribute.
            return {
                type: 'quick_replies',
                id: 'island_choice',
                // heading (1.7.0), and the contract's own motivating example: at
                // init there is nowhere else for this line to go, so before the
                // field these chips arrived as three bare island names under a
                // greeting that never mentioned them. Sharing the factory means
                // one fixture exercises BOTH mount paths — the welcome row on
                // Mock.init and the mid-transcript row the "hostel" keyword
                // returns — so a heading that retires correctly in one and
                // strands itself in the other cannot hide.
                heading: 'Which island are you going to?',
                items: [
                    { label: 'Tenerife', message: 'Tenerife' },
                    { label: 'Gran Canaria', message: 'Gran Canaria' },
                    { label: 'Ibiza', message: 'Ibiza' }
                ]
            };
        }

        // The tenant-authored "try asking" row — a site's chatbot.quick_prompts
        // setting, which is the other thing contract 1.5.0 says an init
        // quick_replies row carries. English literals on purpose: payload is
        // server-localized and the widget never translates it, so a chip that
        // followed the UI language would be lying about where it came from.
        //
        // Both messages are chosen to CHAIN into existing fixtures rather than
        // dead-end in the catch-all reply: "hostel" reaches the island-chips
        // branch and "Pass" the word-bounded promo branch. Deliberately worded
        // apart from the pack's own prompt1/prompt2, so the demo shows at a
        // glance which block is on screen.
        function promptChips() {
            // locale + id per 1.6.0: tenant-authored text declares its language
            // (→ lang="en" on the row) and quick_prompts is its provenance.
            return {
                type: 'quick_replies',
                id: 'quick_prompts',
                locale: 'en',
                items: [
                    { label: 'Find my hostel', message: 'Which hostel should I pick?' },
                    { label: 'Nest Pass', message: 'What is the Nest Pass?' }
                ]
            };
        }

        return {
            init: function (done) {
                reply(done, 201, {
                    conversation: { uuid: 'mock-' + Math.random().toString(36).slice(2, 10) },
                    greeting: t('greeting'),
                    // A site that HAS configured welcome elements — the interesting
                    // case, and the one [] could not reach. TWO quick_replies rows,
                    // mirroring the payload a real 1.5.0 server sends: the site's
                    // own "try asking" prompts and a clarification row. Reusing the
                    // type twice in one actions[] is contract-legal and each row is
                    // handled independently.
                    //
                    // The cost, recorded rather than hidden: with init always
                    // sending chips the demo no longer reaches showPrompts() or
                    // setLocale's pill-repaint branch. Exercising the fallback means
                    // temporarily setting this to actions: [] (CLAUDE.md says so
                    // too).
                    actions: [promptChips(), islandChips()],
                    // The 1.7.0 pair. `server_time` is built from this machine's
                    // own clock on purpose — a fixture that faked a skew would
                    // make every mock run render dates the demo page cannot
                    // explain. The offset it produces is ~0, which is exactly
                    // what a correct client clock should compute.
                    idle_hours: mockIdleHours(),
                    server_time: new Date().toISOString(),
                    contract_version: '1.7.0'
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

                if (q.indexOf('!cap') === 0) {
                    // The turn-cap reply (1.6.0): canned text, the actionable
                    // contact_channels, then conversation_ended LAST — the order
                    // the contract specifies. The real server would also repeat
                    // the previous exchange's turn number; `turn` here is close
                    // enough, since the widget never reads it on this path.
                    return reply(done, 200, {
                        reply: 'We have reached this conversation’s message limit. Start a new chat to keep talking — or reach the team directly below.',
                        actions: [
                            {
                                type: 'contact_channels',
                                phone: '+34 922 123 456',
                                whatsapp: '+34 600 111 222',
                                email: 'hola@nestshostels.com'
                            },
                            { type: 'conversation_ended', reason: 'turn_cap' }
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
                    var cards = {
                        type: 'property_cards',
                        items: [
                            {
                                key: 'medano',
                                name: 'Medano Nest',
                                location: 'El Médano, Tenerife',
                                image: 'https://nestshostels.com/wp-content/themes/w_neststw/assets/img/gallery/3.jpg',
                                // period + basis together (1.6.0): a dorm bed —
                                // "from €22.00/night per person".
                                price_from: { amount: '22.00', currency: 'EUR', period: 'night', basis: 'per_person' },
                                badge: 'Nest Pass',
                                url: 'https://hotels.cloudbeds.com/reservation/medano-nest',
                                // Server-localized Book text (1.6.0) — must beat
                                // the pack's "Book now" on THIS card only.
                                cta_label: 'Book a bed'
                            },
                            {
                                // No `location` key at all: optional fields are
                                // OMITTED rather than nulled, and the platform
                                // really does have properties without one. The
                                // card must simply skip the line.
                                //
                                // basis differs from medano's on purpose: 1.6.1
                                // states period/basis are PER ITEM, so one rail
                                // must be able to show two different suffixes.
                                key: 'ashavana',
                                name: 'Ashavana Nest',
                                image: 'https://nestshostels.com/wp-content/themes/w_neststw/assets/img/gallery/6.jpg',
                                price_from: { amount: '24.00', currency: 'EUR', period: 'night', basis: 'per_unit' },
                                url: 'https://hotels.cloudbeds.com/reservation/ashavana-nest'
                            },
                            {
                                // No period/basis: the bare price. The widget must
                                // NOT invent "/night" here — absence means the
                                // tenant declared nothing.
                                key: 'duque',
                                name: 'Duque Nest',
                                location: 'Costa Adeje, Tenerife',
                                image: 'https://nestshostels.com/wp-content/themes/w_neststw/assets/img/gallery/1.jpg',
                                price_from: { amount: '26.00', currency: 'EUR' },
                                badge: 'Loooong Stay',
                                url: 'https://hotels.cloudbeds.com/reservation/duque-nest'
                            },
                            {
                                // The D-043(c) isolator (reference browser pass,
                                // 2026-07-31): dropped for a NON-url reason — no
                                // name — while carrying a VALID url the "Visit our
                                // website" button below also carries. The card is
                                // dropped and that button must SURVIVE; a
                                // javascript: url here would drop both and prove
                                // nothing.
                                key: 'no-name',
                                url: 'https://nestshostels.com'
                            }
                        ]
                    };
                    if (q.indexOf('ibiza') !== -1) {
                        // total alone (no more link): "Showing 3 of 5" — the
                        // count line is the else-branch and needs its own path.
                        cards.total = 5;
                    } else {
                        // Both together: `more` must WIN and the count line must
                        // not render.
                        cards.total = 14;
                        cards.more = { label: 'See all our properties', url: 'https://nestshostels.com/hostels' };
                    }
                    return reply(done, 200, {
                        reply: 'Three Nests match — El Médano is the surf one.',
                        actions: [
                            cards,
                            promoCard(),
                            // Equals medano's rendered url → suppressed by the
                            // dedupe pre-scan. The trio used to point at
                            // book.nestshostels.com, which no card carries — that
                            // is why the old fixture could never catch D-043(c).
                            { type: 'link_button', label: 'Book now', url: 'https://hotels.cloudbeds.com/reservation/medano-nest', style: 'primary' },
                            // Shares the NAME-LESS item's url → must render: a
                            // dropped card suppresses nothing.
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
                        actions: [islandChips()],
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
                // An `availability` whose url fell back to the property's
                // booking_url — the same url the interim booking_link already
                // rendered. This is the ONE interim→poll duplicate 1.6.0
                // documents, and the per-turn `rendered` set must suppress the
                // trailing Book button while the options list still renders.
                return reply(done, 200, {
                    status: 'ready',
                    reply: 'Yes! We have 4 beds free in the mixed dorm for those nights, at 25 € per night.',
                    actions: [{
                        type: 'availability',
                        available: true,
                        options: [{ room: 'Mixed dorm', price: '25', currency: 'EUR' }],
                        url: 'https://book.nestshostels.com/las-eras'
                    }],
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
        // Plain chevron, drawn pointing RIGHT. Every other direction is this same
        // node turned in CSS: the carousel's two arrows, and the scroll cue's ⌄.
        chevron: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>',
        // The header menu's toggle. Horizontal, not vertical: it sits in a row
        // of square controls where a vertical triple reads as a drag handle.
        dots: '<svg xmlns="http://www.w3.org/2000/svg" class="nc-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"/></svg>',
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

    // Fallback stack for data-fonts="system" — the tail of --nc-font-body with the
    // nc- families and Montserrat taken off the front.
    var FONT_STACK_SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ' +
        'Helvetica, Arial, sans-serif';

    // A family list is names, quotes, commas and spaces. Rejecting ( ) ; { } : / \
    // blocks url(), var() and anything shaped like a second declaration. This is a
    // typo guard, not a security boundary — setProperty() parses the value, so a
    // stray ';' cannot open a new declaration, and the host wrote their own script
    // tag anyway. A host wanting var() or calc() overrides the custom property in
    // CSS instead; this is the no-CSS path, same as data-offset-x.
    var FONT_OK = /^[\w\s,"'-]{1,200}$/;

    /**
     * --nc-font-heading / --nc-font-body are the widget's ENTIRE typography seam:
     * every font-family in the stylesheet is one of those two vars or `inherit`.
     * So overriding them here means nothing on screen ever matches nc-Poppins or
     * nc-Montserrat, and an @font-face whose family goes unmatched is never
     * fetched — the opt-out costs zero bytes with no second stylesheet and no
     * build step. That only holds while the seam does: if a rule ever hardcodes a
     * family name, these attributes silently stop covering it.
     *
     * The default stays the shipped Poppins/Montserrat — one look across every
     * hostel site is what 2.4.0 bought — but it is not free, and the reason is
     * not obvious: the CLOSED panel is `visibility: hidden`, not `display: none`,
     * so its header, greeting and composer are laid out at boot and pull all
     * three files at ~35ms on every page view, whether or not the guest ever
     * opens the chat. That is what these attributes buy back.
     */
    function applyFonts(root) {
        var heading = '';
        var body = '';

        if (cfg.fonts === 'system') {
            heading = body = FONT_STACK_SYSTEM;
        } else if (cfg.fonts === 'host' && document.body) {
            // Read-only, and the host page is not touched. Resolved to a real
            // stack rather than passing `inherit` through: a CSS-wide keyword in a
            // custom property applies to the property itself, not to the var()
            // substitution, so `--nc-font-body: inherit` would not do this. The
            // root is a child of body, so body's computed family is exactly what
            // the widget would have inherited.
            heading = body = getComputedStyle(document.body).fontFamily || '';
        }

        // Explicit stacks win over the preset, so a host can take the body font
        // from their theme and still keep Germán's Poppins headings.
        if (FONT_OK.test(cfg.fontHeading)) { heading = cfg.fontHeading; }
        if (FONT_OK.test(cfg.fontBody)) { body = cfg.fontBody; }

        if (heading) { root.style.setProperty('--nc-font-heading', heading); }
        if (body) { root.style.setProperty('--nc-font-body', body); }
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
        applyFonts(root);
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

        /* The menu, LEFTMOST of the three. The corner stays the ✕ every guest
           already reaches for and ⤢ keeps its position relative to it, so the
           new control is added at the far end and no muscle memory moves. Below
           1024px ⤢ is display:none and this reads ⋯ ✕ — which is where the menu
           matters MOST: the panel is fullscreen there and a guest has no other
           way to start a conversation over.

           Toggle and dropdown share a wrapper the way .nc-lang wraps its own
           toggle and options. It is the dropdown's positioning context, and it
           puts the item beside ⋯ in the tab order instead of after ✕.

           Deliberately NOT role="menu" / role="menuitem" / aria-haspopup. Those
           roles carry a keyboard contract — roving tabindex, arrow keys,
           Home/End, typeahead — that one item does not need, and half-honouring
           it is worse than never claiming it. aria-expanded alone, exactly as
           .nc-lang-toggle does for the same shape. */
        var menuWrap = el('div', 'nc-menu-wrap');
        var menuToggle = el('button', 'nc-menu-toggle');
        attrs(menuToggle, { type: 'button', 'aria-label': t('menu'), 'aria-expanded': 'false' });
        menuToggle.appendChild(svgNode(ICONS.dots));

        var menu = el('div', 'nc-menu');
        var menuNewChat = el('button', 'nc-menu-item', t('newChat'));
        attrs(menuNewChat, { type: 'button' });
        menu.appendChild(menuNewChat);
        menuWrap.appendChild(menuToggle);
        menuWrap.appendChild(menu);

        var expandBtn = el('button', 'nc-expand');
        attrs(expandBtn, { type: 'button', 'aria-label': t('expand') });
        expandBtn.appendChild(svgNode(ICONS.expand));
        expandBtn.appendChild(svgNode(ICONS.shrink));

        var closeBtn = el('button', 'nc-close');
        attrs(closeBtn, { type: 'button', 'aria-label': t('close') });
        closeBtn.appendChild(svgNode(ICONS.x));

        headerControls.appendChild(menuWrap);
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

        // The scroll cue floats ABOVE the footer, over the transcript — and it is a
        // child of the footer rather than of .nc-body or .nc-panel for two reasons.
        // .nc-body is the scroll container, so an absolutely positioned child of it
        // scrolls away with the content; and the footer's own height moves (the
        // textarea grows to 180px), so a `bottom` measured from the panel would
        // drift under the composer. `bottom: 100%` against the footer tracks it for
        // free. Out of flex flow, so it costs nothing in the footer's `gap`.
        //
        // FIRST child on purpose: it sits above the composer on screen, and the tab
        // order has to read the same way — transcript, cue, language, input, send.
        var cue = el('button', 'nc-scroll-cue nc-cue-hidden');
        // title as well as aria-label: the glyph is a bare chevron, and a pointer
        // guest gets no other chance to learn what it does.
        attrs(cue, { type: 'button', 'aria-label': t('scrollLatest'), title: t('scrollLatest') });
        cue.appendChild(svgNode(ICONS.chevron));
        footer.appendChild(cue);

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
            // The header menu. Its open state is a class on headerControls, the
            // way the language row's is a class on controls — same shape, so the
            // same seam.
            headerControls: headerControls, menuToggle: menuToggle, menu: menu,
            menuNewChat: menuNewChat,
            unread: unread, teaser: teaser, teaserBody: teaserBody, teaserClose: teaserClose,
            announcer: announcer, disclaimer: disclaimer, cue: cue,
            // The welcome wrapper is built later, by the intro, and removed whole
            // on the first guest turn — declared here so every reader of els sees
            // the surface in one place. The two prompt handles are the pack block
            // inside it, which setLocale() repaints; the server chips sharing the
            // wrapper deliberately get no handle, because nothing may repaint them.
            // `restart` is the conversation_ended button (endConversation), the
            // third live control setLocale() repaints.
            welcome: null, promptsLabel: null, promptButtons: null, restart: null
        };
    }

    /* =========================================================== render ===== */

    /* ------------------------------------------------------------- scrolling */
    /*
     * The transcript moves ITSELF exactly once per turn — when the guest sends —
     * and never again.
     *
     * It used to be pinned to the bottom from a dozen places, including every
     * eighth character of the typing reveal. That made a reply longer than the
     * panel scroll its own opening line away while the guest was still reading
     * it: being "at the bottom" is the transcript's default state, so it fired on
     * essentially every substantial answer, and the guest could not read a long
     * one from the beginning. Now anchorSend() frames the turn, the reply grows
     * below a viewport that does not move, and the ⌄ cue is the way to the latest
     * content — the shape claude.ai settled on.
     */

    // Mirrors .nc-body's own padding; the arithmetic below measures border boxes.
    var BODY_PAD = 15;
    // Fractional-DPR displays report scroll metrics in fractions, exactly as they
    // do for the carousel (see CAR_END_EPS). Well under one line of text, so a
    // hidden cue can never be concealing a readable line.
    var CUE_EPS = 8;

    // Per REPLY, not per session: the guest pressing ⌄ mid-stream is saying "take
    // me along", and it lasts until that reply finishes or they scroll back up.
    var followStream = false;
    // The total .nc-body height the anchored turn needs in order to hold its
    // position, and the breathing room currently making up the shortfall. See
    // applyAnchorPad().
    var anchorFloor = 0;
    var anchorPad = 0;
    // The last scrollTop WE wrote. The cancel test compares against this rather
    // than against "am I at the bottom": the typer appends characters between our
    // write and the browser's async scroll event, so scrollHeight has already
    // grown by the time the handler runs and a bottom test would cancel itself.
    var autoTop = 0;

    function atBottom() {
        return els.body.scrollHeight - els.body.scrollTop - els.body.clientHeight <= CUE_EPS;
    }

    // The transcript's REAL height, with any breathing room discounted.
    function contentHeight() {
        return els.body.scrollHeight - anchorPad;
    }

    /**
     * The breathing room that lets an anchored message actually reach the top.
     *
     * Without it anchorSend() is a promise the browser cannot keep: scrollTop
     * cannot exceed scrollHeight - clientHeight, so on a real transcript the write
     * clamps and the guest's message lands wherever the existing content happens
     * to end — measured at 408px down a 467px panel, which leaves a reply about
     * two lines of room before it grows past the fold. Every turn. That is not the
     * behaviour, it is the behaviour failing quietly.
     *
     * anchorFloor is the total height the turn needs; the pad makes up whatever
     * the real content is short by, and is recomputed after every render. As the
     * reply arrives, content grows, the shortfall shrinks, and the pad melts to
     * nothing on its own — no timer, no teardown, no second code path. And because
     * content + pad never drops below anchorFloor, scrollTop never has to be
     * corrected: the guest's view cannot shift out from under them while they read.
     *
     * A short reply leaves some pad standing, so the message stays at the top with
     * space below rather than snapping back down. That is wanted — the eye should
     * stay where the answer is — and it is what the pattern this follows does.
     *
     * Padding on the scroll container rather than a spacer NODE: a spacer would
     * have to be re-appended after every render to stay last, and .nc-body's last
     * child is load-bearing — followsBotMessage() reads it to decide whether a
     * reply keeps its avatar. An engine that ignored the padding would simply clamp
     * as before, which is a graceful degradation rather than a break.
     */
    function applyAnchorPad() {
        var pad = Math.max(0, anchorFloor - contentHeight());
        if (pad === anchorPad) { return; }
        anchorPad = pad;
        // '' restores the stylesheet's own 15px rather than hardcoding it twice.
        els.body.style.paddingBottom = pad ? (BODY_PAD + pad) + 'px' : '';
    }

    // Panel resizes and transcript wipes both invalidate a floor measured against
    // the old clientHeight — give the room back rather than hold a stale gap open.
    function clearAnchorPad() {
        anchorFloor = 0;
        applyAnchorPad();
    }

    function scrollToLatest(smooth) {
        if (!els.body) { return; }
        if (smooth) {
            els.body.scrollTo({ top: els.body.scrollHeight, behavior: 'smooth' });
        } else {
            els.body.scrollTop = els.body.scrollHeight;
        }
        // Read BACK rather than reusing scrollHeight: the browser clamps the write,
        // and a smooth scroll has not arrived yet. Either way this is a floor —
        // the guest scrolling UP from here is what cancels the follow, and a
        // conservative floor can only make that test less trigger-happy.
        autoTop = els.body.scrollTop;
        syncScrollCue();
    }

    /**
     * The one forced move: bring the guest's just-sent bubble to the top of the
     * visible transcript, so the reply that follows has the whole panel to grow
     * into and its first line stays where the eye left it.
     *
     * getBoundingClientRect deltas, NOT offsetTop: .nc-body sets no `position`, so
     * a child's offsetParent is .nc-panel and offsetTop measures the wrong box.
     * And never scrollIntoView() — that walks EVERY ancestor scroller, including
     * the host page's own. The host page is not ours.
     *
     * A short transcript needs no special case: the target comes out at or below
     * zero, nothing moves, and nothing needs to — the reply grows from wherever
     * there was room with its first line already on screen.
     *
     * Instant, never smooth: showThinking() inserts into the same box a moment
     * later, and a smooth scroll racing a DOM insertion jitters.
     */
    function anchorSend(node) {
        if (!els.body || !node) { return; }
        // Last turn's room goes back BEFORE measuring, or the shortfall is
        // computed against a height this turn has not earned.
        clearAnchorPad();
        var delta = node.getBoundingClientRect().top - els.body.getBoundingClientRect().top;
        var target = els.body.scrollTop + delta - BODY_PAD;
        if (target > 0) {
            // scrollTop can never exceed scrollHeight - clientHeight, so this is
            // the height the transcript must reach for `target` to be a position
            // the browser will accept.
            anchorFloor = target + els.body.clientHeight;
            applyAnchorPad();
        }
        els.body.scrollTop = target;
        autoTop = els.body.scrollTop;
        syncScrollCue();
    }

    /**
     * Show the cue whenever there is transcript below the fold — one positional
     * rule, no "new content" state to keep in step with reality.
     *
     * The focus rescue here is the MAIN path, not an edge case: pressing ⌄ scrolls
     * to the bottom, which hides ⌄, which blurs the button the guest just pressed
     * and drops focus to <body> — the top of the customer's page. Fifth time this
     * repo has met that bug (CLAUDE.md § Conventions).
     */
    function syncScrollCue() {
        if (!els.cue || !els.body) { return; }
        var hide = atBottom();
        if (hide && els.cue.contains(document.activeElement)) {
            // els.input is disabled once the turn cap lands (endConversation) and
            // cannot take focus — there, the restart button is the only live
            // control left to hand them.
            var landing = (ended && els.restart) ? els.restart : els.input;
            if (landing) { landing.focus(); }
        }
        els.cue.classList.toggle('nc-cue-hidden', hide);
    }

    /**
     * Everything that renders under a still-typing bubble calls this: it measures
     * and repaints the cue, and moves nothing — unless the guest pressed ⌄ and
     * asked to be taken along, in which case the whole turn's output rides down.
     */
    function afterRender() {
        // First: the new content pays back its share of the anchor's breathing
        // room. Doing it here rather than on a timer is what makes the pad melt
        // in step with the reply that is filling it.
        applyAnchorPad();
        if (followStream) { scrollToLatest(false); } else { syncScrollCue(); }
    }

    /**
     * Scrolling UP is the guest taking the view back, and the only thing that
     * cancels a follow.
     *
     * Tested against autoTop — the position WE last wrote — rather than against
     * "am I still at the bottom". Content growing never changes scrollTop, so this
     * cannot fire on the typer's own output; a bottom test would, because the
     * typer appends more characters between our write and this (asynchronous)
     * event and the reply would cancel its own follow within a frame. Scrolling
     * further DOWN is the direction we were already going and cancels nothing.
     */
    function onBodyScroll() {
        if (followStream && els.body.scrollTop < autoTop - CUE_EPS) { followStream = false; }
        syncScrollCue();
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

    /* ---------------------------------------------------------- day separators */
    /*
     * A centred pill between messages whenever the calendar day changes, the way
     * every phone messenger does it. It exists because of 2.8.0: a returning
     * guest now replays a stored conversation, so without this the panel opens on
     * yesterday evening's transcript with nothing on screen saying that any time
     * passed. The replay is seamless by design, which is exactly the problem —
     * and the window it spans is now the server's whenever it sends one, which
     * the platform config puts at a week — so a replay can cross several days
     * rather than one midnight. Until a deployment actually reports it, the 24h
     * fallback still applies and a transcript spans two days at most.
     *
     * WHOSE CLOCK, AFTER 1.7.0. The contract still dates no MESSAGE — `turn` is
     * an order, not an instant, and the record's own `ts` means last activity,
     * rewritten every turn — so an entry is still stamped where it is created.
     * What changed is the clock that stamps it: `server_time` on the init 201
     * gives one offset per conversation, and every stamp here goes through
     * nowMs() rather than Date.now(). See its header for the rule that keeps
     * that coherent (corrected for dates, raw for durations) and for the two
     * narrow first-visit cases where the offset is legitimately still 0.
     *
     * So device-clock skew is no longer an error source, and ONE consequence
     * survives: a guest who crosses a timezone between visits sees these
     * recomputed in the new zone, because dayKey() takes local midnight in the
     * DEVICE's zone and server_time corrects the instant, never the zone — which
     * is the right call, since the guest's own zone is what "today" means to
     * them. Day granularity is what keeps that acceptable: only a timezone hop
     * moves a date. It would not be acceptable under a visible per-message
     * clock, which is still the main reason there isn't one — the stored value
     * would support one tomorrow, and this comment is why it stays a tooltip
     * instead. docs/proposals/message-timestamps.md is the design record.
     */

    // The day last PAINTED — render state, never stored, never persisted. Held
    // here rather than recomputed per entry so the live path and
    // replayTranscript() share ONE comparison; two copies would disagree at
    // exactly the boundary that matters. restartConversation() resets it.
    var lastDayKey = null;

    // Local midnight for that instant, as an epoch — the identity of a calendar
    // day in the guest's own zone. null for anything that is not a real date,
    // which is also the tampered-store case: `at` reaches here as a finite
    // number (validTurns guarantees that much) and 1e20 is finite.
    function dayKey(ms) {
        var d = new Date(ms);
        d.setHours(0, 0, 0, 0);
        return isFinite(d.getTime()) ? d.getTime() : null;
    }

    /**
     * Today / Yesterday / a weekday with its day number inside the last week /
     * a plain date beyond it. The weekday tier is not decoration: at a week-long
     * idle window "Monday 17" is something a guest can place, where 17/08/2026
     * makes them count back.
     *
     * Date arithmetic through Date, NEVER through milliseconds — subtracting
     * 86400000 is wrong on both DST days a year and says nothing about month
     * ends. setDate() normalises all of it.
     *
     * Intl in try/catch degrading to NO PILL, exactly as cardPrice() degrades to
     * no price: a RangeError from a bad locale or an absurd stored date must not
     * take the reply down, and a wrong day is worse than a missing one. The
     * formats are locale-ORDERED by construction, which is the other reason not
     * to hand-roll dd/mm/yyyy — it is wrong in at least one shipped locale.
     */
    function dayLabel(key) {
        var todayKey = dayKey(nowMs());
        if (todayKey === null) { return null; }
        // At or past today: a clock reading into the future is skew or a tampered
        // store, and "today" is the least surprising thing to call it.
        if (key >= todayKey) { return t('dayToday'); }

        var edge = new Date(todayKey);
        edge.setDate(edge.getDate() - 1);
        if (key === edge.getTime()) { return t('dayYesterday'); }

        // Five more days back — today, yesterday and these make one week, so a
        // weekday name never appears twice in the tier that uses it.
        edge.setDate(edge.getDate() - 5);
        var withinWeek = key >= edge.getTime();

        try {
            return new Intl.DateTimeFormat(locale, withinWeek
                // The short month is carried for WORD ORDER, not for information —
                // inside a seven-day tier it can only ever be this month or last.
                // Ask for weekday+day alone and CLDR resolves bare 'en' to the
                // en-US skeleton, which puts the number first: "17 Monday". (Every
                // other shipped locale is fine, and en-GB is fine, which is exactly
                // what makes it easy to miss.) Adding the month makes CLDR compose
                // a real pattern instead — "Monday, Aug 17", "lunes, 17 ago",
                // "Montag, 17. Aug." — correct in all five. Do not simplify it back.
                ? { weekday: 'long', day: 'numeric', month: 'short' }
                : { day: '2-digit', month: '2-digit', year: 'numeric' }
            ).format(new Date(key));
        } catch (e) {
            log('day separator dropped — date not formattable', key);
            return null;
        }
    }

    /**
     * The full moment, for a bubble's title — and the only place the per-message
     * time surfaces at all. A native tooltip is supplementary by construction:
     * unreachable on touch, inconsistently announced, never the only channel for
     * anything. That is the right weight for a detail this precise sitting on a
     * client clock, and it is what pays for there being no pill above the first
     * message — the exact date is on that bubble either way.
     *
     * A title and NEVER an aria-label on .nc-text: an aria-label would replace
     * the message text for a screen reader with a date.
     */
    function fullStamp(ms) {
        try {
            return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' })
                .format(new Date(ms));
        } catch (e) { return ''; }
    }

    // One place that puts the moment on a bubble, so the two hand-built greeting
    // bubbles carry it identically to every bubble addBubble() makes.
    function stampBubble(node, at) {
        if (!node || !at) { return; }
        var stamp = fullStamp(at);
        if (!stamp) { return; }
        node.setAttribute('title', stamp);
        node.setAttribute('data-nc-at', String(at));   // setLocale re-derives from this
    }

    /**
     * Paint the pill if this entry opens a new day, and hand it back, so a caller
     * that is about to scroll (sendGuestText) can anchor it. Idempotent within a
     * day — which is what lets that caller run it early and addBubble() run it
     * again a line later.
     *
     * NO SEPARATOR AT THE TOP: lastDayKey is assigned BEFORE the first-paint
     * return, so the first message defines the day and announces nothing. Delete
     * that ordering and a fresh conversation opens under a "Today" pill telling
     * the guest what they already assume. Pills mark transitions; the bubble
     * titles carry the absolute dates.
     */
    function maybeDaySeparator(at) {
        // A turn stored before 2.8.1 has no time at all. It paints nothing AND
        // advances nothing: inventing a day for it would be a guest-facing claim
        // with no evidence behind it, where silence costs one pill and heals
        // itself on the next real turn.
        if (!at) { return null; }
        var key = dayKey(at);
        if (key === null) { return null; }

        var prev = lastDayKey;
        lastDayKey = key;
        if (prev === null || key === prev) { return null; }

        var label = dayLabel(key);
        if (!label) { return null; }

        // A plain text div, deliberately: .nc-body is role="log" aria-live="off",
        // so this is silent when it lands and reads in document order for anyone
        // browsing back — which is the behaviour wanted. role="separator" takes
        // its accessible name from aria-label and lets some mappings drop the
        // text content entirely.
        var pill = el('div', 'nc-day', label);
        pill.setAttribute('data-nc-at', String(at));
        els.body.appendChild(pill);
        afterRender();   // a render path calls this and NEVER a scroll
        return pill;
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

    function addBubble(role, text, at) {
        // undefined means a LIVE paint, which is now by definition — that is what
        // keeps the error, retry and timeout bubbles right without an argument of
        // their own. null means a stored entry from before 2.8.1 and has to stay
        // silent; only replayTranscript() ever passes it. The two are not
        // interchangeable, which is the whole legacy story in one expression.
        var when = at === undefined ? nowMs() : at;
        // BEFORE followsBotMessage(): a pill becomes els.body.lastElementChild, so
        // a bot reply that opens a new day gets its avatar back. A new day is a
        // new burst — the right reading, and unreachable in practice anyway, since
        // a day cannot turn between two bot entries with no guest turn between.
        maybeDaySeparator(when);
        var isBot = role !== 'guest';
        var follow = isBot && followsBotMessage();
        var wrap = el('div', 'nc-message nc-message--' + (isBot ? 'bot' : 'guest') +
            (follow ? ' nc-message--follow' : ''));
        if (isBot && !follow) {
            wrap.appendChild(avatarNode());
        }
        var textNode = el('div', 'nc-text', text || '');   // textContent — never innerHTML
        stampBubble(textNode, when);
        wrap.appendChild(textNode);
        els.body.appendChild(wrap);
        // No forced scroll, for the GUEST's bubble either: sendGuestText() anchors
        // it a line later, and that is the turn's one deliberate move.
        afterRender();

        // Bot bubbles that never reach typeText — error, retry, timeout — would go
        // silent now that .nc-body is not live, so they announce from here. The
        // non-empty guard is what keeps a typed reply from announcing twice: it
        // arrives as addBubble('bot', '') and typeText does the talking.
        //
        // A guest bubble is never announced: every one of them is the direct
        // result of the guest's own action a moment earlier — typing and sending,
        // or activating a prompt pill or a tap-to-send chip whose label they had
        // just read. Announcing it would read them their own input back. (Chips
        // send `message`, which can differ from the label they pressed; that is
        // still their own act, and the bubble they can see says so.)
        // …and never during a replay: the guest has read this history, and
        // twenty stored replies would bury the live region at every load.
        if (isBot && text && !replaying) { announce(text); }
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
        // The dots land directly under the message anchorSend() just framed, so
        // they are already on screen — nothing to chase.
        afterRender();
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
     * The ONE card-item gate, shared by propertyCard() and the dedupe pre-scan in
     * renderActions(). The two MUST agree: the pre-scan collects the urls of cards
     * that WILL render, and recording the url of an item propertyCard() would
     * reject — no name, no http(s) url — would silently suppress the guest's only
     * Book button, which is strictly worse than the duplicate the dedupe removes
     * (response-contract.md, D-043(c): "a card you dropped suppresses nothing").
     * Returns the post-gate (trimmed) href, or null when the item drops.
     */
    function renderableCardUrl(item) {
        if (!item || typeof item.name !== 'string' || !item.name) { return null; }
        return safeHttpUrl(item.url);
    }

    /**
     * `row` is the CTA row this button joins — null opens a new one. Returns the row
     * so the caller can hand it to the next button: consecutive CTAs (contract 1.4.0
     * ships three) then share one wrapping row instead of stacking into a column of
     * full-width bars. A dropped url returns `row` untouched, so a rejected link
     * never leaves an empty row behind.
     *
     * `rendered` is the per-turn url set (see sendMessage): every href this turn
     * puts on screen is recorded so the poll's additive actions[] can suppress a
     * repeat. Optional — the init/welcome/resume paths render outside any turn.
     */
    // `kind` is what the events call this button. It is the CALLER's to say —
    // four element types share this one renderer, and "a Book button was
    // clicked" is worth much less than which element put it there.
    function linkButton(label, url, style, row, rendered, kind) {
        var href = safeHttpUrl(url);
        if (!href) { log('dropped a non-http(s) url', url); return row; }
        var link = el('a', 'nc-action' + (style === 'primary' ? ' nc-action--primary' : ''), label || t('open_link'));
        attrs(link, { href: href, target: '_blank', rel: 'noopener noreferrer' });
        // Read back by the one delegated click listener in wire() — see the
        // events section. A data attribute rather than a closure per anchor: a
        // replayed 40-turn transcript can carry dozens of these.
        attrs(link, { 'data-wchat-el': kind || 'link_button' });
        if (style) { attrs(link, { 'data-wchat-style': style }); }
        if (!row) {
            row = el('div', 'nc-action-row');
            els.body.appendChild(row);
        }
        row.appendChild(link);
        if (rendered) { rendered[href] = true; }
        afterRender();
        return row;
    }

    function renderActions(actions, bubble, rendered) {
        if (!actions || !actions.length) { return; }
        // Dedupe pre-scan (contract 1.6.0, D-043(c)): the post-gate urls of every
        // card that WILL render in THIS list, collected before any element renders
        // so a link_button that precedes its card is still suppressed. Local to one
        // actions[] on purpose — the cross-turn case belongs to `rendered`.
        // CARD_MAX is deliberately NOT applied here. Until 1.6.2 the argument was
        // that the only payload where the dedupe can fire is the resolved-property
        // turn, whose card set was ALWAYS exactly one, so pre-scan and rendered
        // rail could not diverge. D-047 ended that: a turn naming several hostels
        // now emits one card each, so a named-property set can exceed one.
        //
        // Still uncapped, but the reason is now a bound rather than an
        // impossibility — divergence needs a payload carrying MORE THAN CARD_MAX
        // cards AND a link_button matching one past the cap, i.e. a guest naming
        // nine hostels in a single message. The other multi-card shape, the island
        // carousel, never carries a matching link_button at all. Worth re-reading
        // if a future contract widens what can emit a rail: the day a payload can
        // hold more than eight cards with a matching button, capping this scan is
        // the fix. The reference builds its set the same uncapped way.
        // Object.create(null): payload urls must never collide with
        // Object.prototype ('constructor' as a url key would phantom-match).
        var cardUrls = Object.create(null);
        for (var i = 0; i < actions.length; i++) {
            var a = actions[i];
            if (a && a.type === 'property_cards' && a.items && a.items.length) {
                for (var j = 0; j < a.items.length; j++) {
                    var url = renderableCardUrl(a.items[j]);
                    if (url) { cardUrls[url] = true; }
                }
            }
        }
        // The open CTA row travels with the pass rather than living module-side, so
        // DOM order still follows payload order and an element that renders something
        // else closes the group.
        var row = null;
        for (var k = 0; k < actions.length; k++) {
            row = renderAction(actions[k], bubble, row, cardUrls, rendered);
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
    function renderAction(action, bubble, row, cardUrls, rendered) {
        if (!action || !action.type) { return row; }

        switch (action.type) {
            case 'async_result':
                if (action.url) { pollResult(action.url, bubble, rendered); }
                return row;

            // Suppression passes `row` through untouched — a suppressed button must
            // not close the CTA group its siblings share. Raw action.url against a
            // set of trimmed hrefs: within one payload both are the same catalog
            // booking_url byte-for-byte (the contract forbids normalizing), so
            // plain equality is exact; a whitespace-padded near-duplicate simply
            // renders both, which the contract calls redundant, never harmful.
            case 'link_button':
                if (cardUrls[action.url]) { return row; } // a card in this list carries the same CTA (D-043(c))
                return linkButton(action.label, action.url, action.style, row, rendered, 'link_button');

            case 'booking_link':
                // Reference parity; cannot co-occur with cards today (one handler
                // per turn, D-009), so this branch of the check is dormant.
                if (cardUrls[action.url]) { return row; }
                return linkButton(t('book'), action.url, 'primary', row, rendered, 'booking_link');

            case 'availability':
                return renderAvailability(action, rendered);

            case 'contact_channels':
                renderChannels(action);
                return null;

            case 'property_cards':
                renderPropertyCards(action, rendered);
                return null;

            case 'quick_replies':
                renderQuickReplies(action);
                return null;

            case 'promo_card':
                renderPromoCard(action);
                return null;

            // The turn cap (1.6.0). No visual payload of its own — the reply
            // text already told the guest — so the branch only flips the widget
            // into its ended state. Passes `row` through: the element is emitted
            // last, after the contact_channels a capped reply may carry.
            case 'conversation_ended':
                endConversation();
                return row;

            default:
                log('ignoring unknown element type', action.type);
                return row;
        }
    }

    // The options card closes any open CTA group; the trailing booking button opens a
    // fresh row, which is returned for whatever follows.
    function renderAvailability(action, rendered) {
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
        // The ONE contract-scoped interim→poll suppression (1.6.0): an availability
        // url that fell back to the property's booking_url duplicates the Book
        // button the interim turn already rendered. Only the trailing button is
        // deduped — the options list is new content and always renders.
        var row = null;
        if (action.url && !(rendered && rendered[action.url])) {
            row = linkButton(t('book'), action.url, 'primary', null, rendered, 'availability');
        }
        afterRender();
        return row;
    }

    function renderChannels(action) {
        var wrap = el('div', 'nc-channels');
        // Every href here is CONSTRUCTED from the channel value — never taken
        // verbatim from the payload.
        if (action.phone) {
            wrap.appendChild(channelLink(tf('call', action.phone), 'tel:+' + digits(action.phone), 'phone'));
        }
        if (action.whatsapp) {
            wrap.appendChild(channelLink(t('whatsapp'), 'https://wa.me/' + digits(action.whatsapp), 'whatsapp'));
        }
        if (action.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(action.email)) {
            wrap.appendChild(channelLink(tf('email', action.email), 'mailto:' + action.email, 'email'));
        }
        if (wrap.childNodes.length) {
            els.body.appendChild(wrap);
            afterRender();
        }
    }

    // `channel` names which of the three this is, for the events. The href
    // cannot be trusted to say — it is constructed here from a payload value and
    // the whole point of the events rule is that it never travels.
    function channelLink(label, href, channel) {
        var link = el('a', 'nc-channel', label);
        attrs(link, { href: href, rel: 'noopener noreferrer' });
        // No url on this one, ever: the href IS the guest-facing phone number or
        // email address of the property, and a tel:/mailto: string in an
        // analytics payload is contact data leaving the page for no gain.
        attrs(link, { 'data-wchat-el': 'contact_channels', 'data-wchat-channel': channel });
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
     *
     * `parent` is passed by ONE caller, showWelcome(), which needs its row inside
     * the single wrapper removeWelcome() takes away on the first guest turn.
     * Everything else arrives through renderAction() with no parent and lands in
     * .nc-body — where the welcome sweep structurally cannot reach it, which is
     * what keeps a mid-conversation chip row standing as transcript content. The
     * argument deliberately stops here rather than being threaded through
     * renderActions()/renderAction(): that switch is the file's documented
     * extension seam and the whole regression gate runs through it.
     *
     * Returns the row node when one was appended, and nothing when the payload
     * produced no chips — showWelcome() branches on THAT rather than on "the
     * array contained a quick_replies element", which would suppress the fallback
     * pills for a row that never made it to the screen. renderAction()'s branch
     * ignores the return and still `return null`s, so its contract is unchanged.
     */
    function renderQuickReplies(action, parent) {
        if (!action.items || !action.items.length) { return; }

        var row = el('div', 'nc-chip-row');
        /*
         * `heading` (contract 1.7.0) is the row saying what it ASKS — tenant
         * authored, server-localized, and the answer to this file's own open
         * point 9. Typed like every other payload string, and it reaches the DOM
         * through el()'s textContent, never innerHTML.
         *
         * Absent means render NONE. Never substitute one of our own: a label
         * reading "try asking" over "Tenerife" asserts that an island name is a
         * thing to try asking, when it is the answer to a question. That was the
         * 2.4.2 decision and this field is what replaces the gap, not what
         * licenses filling it.
         *
         * TRIMMED, so whitespace-only reads as absent. A "   " is truthy, and
         * untrimmed it would both paint a blank full-width line and — worse —
         * become the row's aria-label, replacing a meaningful generic name with
         * an empty one. The reference has the same hole; a tenant-authored
         * string is exactly where a stray space arrives.
         */
        var heading = (typeof action.heading === 'string' && action.heading.trim()) ? action.heading.trim() : null;
        // A group with an accessible name (contract → Accessibility): the chips
        // are real buttons, and the name says what they are before they are read
        // out one by one. When the server supplies a heading, that string IS the
        // row's accessible name — the whole point of the field — and t() falls
        // back to a generic one only when it does not.
        attrs(row, { role: 'group', 'aria-label': heading || t('quickReplies') });
        // Same rule as the promo: locale (1.6.0) marks the labels' language when
        // the server declares one; absent means unknown — set nothing.
        if (typeof action.locale === 'string' && /^[a-z]{2}$/.test(action.locale)) {
            attrs(row, { lang: action.locale });
        }
        if (heading) {
            /*
             * INSIDE the row, never a sibling above it, and that is load-bearing
             * rather than tidy: retireChipRows() removes the row element and
             * nothing else, so a detached heading would outlive the chips it
             * labels and strand a question over a transcript that has moved on.
             * The same holds for the welcome path, where removeWelcome() sweeps
             * the wrapper. Being a full-width flex child costs one CSS rule.
             *
             * aria-hidden because the row already carries this exact string as
             * its accessible name — without it a screen reader announces the
             * question twice. Not focusable, so the file's focus rule (anything
             * that hides a node checks document.activeElement first) is
             * unaffected: retireChipRows() samples the ROW, which still contains
             * every focusable thing it did before.
             */
            var head = el('div', 'nc-chip-head', heading);
            attrs(head, { 'aria-hidden': 'true' });
            row.appendChild(head);
        }
        var chips = 0;
        for (var i = 0; i < action.items.length; i++) {
            var item = action.items[i] || {};
            // The message IS the chip: without one there is nothing to send, so a
            // button would be a dead end. Skip it silently, like every other
            // malformed piece of a payload.
            if (typeof item.message !== 'string' || !item.message) { continue; }
            // Typed, not truthy: `label || message` renders a non-string label as
            // "[object Object]" — el() stringifies whatever it is given. Every
            // other payload string on this branch is guarded the same way, and a
            // malformed label costs the label only, never the chip.
            var label = (typeof item.label === 'string' && item.label) ? item.label : item.message;
            var chip = el('button', 'nc-prompt', label);
            attrs(chip, { type: 'button' });
            // `parent` is passed by showWelcome() and by nothing else (see this
            // function's header), so it already distinguishes the site's welcome
            // row from a mid-transcript one — no new argument to thread through
            // renderAction()'s switch to tell the two apart in the events.
            chip.addEventListener('click',
                makeChipHandler(item.message, parent ? 'welcome-chip' : 'chip'));
            row.appendChild(chip);
            chips++;
        }

        // Every item skipped ⇒ no row: an empty flex box would still eat its gap
        // and leave a phantom indent under the bubble. COUNTED, not
        // row.childNodes.length: since 1.7.0 the heading is itself a child, so
        // the old test would mount a row whose every item was malformed as a
        // lone question with nothing to tap.
        if (!chips) { return; }
        (parent || els.body).appendChild(row);
        // Only mid-transcript rows register for the one-shot retirement (1.6.0):
        // a welcome row already retires with the wrapper removeWelcome() sweeps,
        // and registering it too would put two owners — and two focus rescues —
        // on one node.
        if (!parent) { chipRows.push(row); }
        afterRender();
        return row;
    }

    /**
     * The one-shot rule, made precise at 1.6.0: a chip row belongs to the turn it
     * arrived on, so ANY send — a chip tap in any row, a typed message, a pack
     * pill — retires EVERY registered row on screen, not just the tapped one.
     * sendGuestText() is the single send seam, so this has exactly one call site
     * there, plus endConversation(). Rows are NOT restored after a failed turn
     * (the contract's MAY): the guest's message is in the transcript and can be
     * retyped, whereas a restored row invites a double send.
     */
    function retireChipRows() {
        var hadFocus = false;
        for (var i = 0; i < chipRows.length; i++) {
            var row = chipRows[i];
            // Sampled BEFORE removal — the browser answers a removed
            // activeElement by resetting focus to <body>, and the guest who just
            // activated a chip with the keyboard is standing in this row.
            if (row.contains(document.activeElement)) { hadFocus = true; }
            if (row.parentNode) { row.parentNode.removeChild(row); }
        }
        chipRows = [];
        if (hadFocus && els.input && !els.input.disabled) { els.input.focus(); }
    }

    // A factory, not a closure written inside the loop: `var` is function-scoped,
    // so an inline handler would close over the loop's own `item` and every chip
    // would end up sending the last message.
    function makeChipHandler(message, source) {
        return function () { sendGuestText(message, source); };
    }

    /* --------------------------------------------------- property carousel --- */

    // Eight is where OUR strip stops — a layout cap, deliberately separate from
    // the server's item cap, which is a deployment setting this widget must not
    // hardcode. Since 1.6.0 the wire can say what a cut cost: `total` is the
    // match count before any cap and `more` a "see all" link, and
    // renderPropertyCards() puts one of them under a cut rail instead of
    // inventing a number nothing verified.
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
    function renderPropertyCards(action, rendered) {
        if (!action.items || !action.items.length) { return; }

        var track = el('div', 'nc-car-track');
        var count = 0;
        for (var i = 0; i < action.items.length && count < CARD_MAX; i++) {
            var item = action.items[i] || {};
            // `count`, not `i`: the position the guest actually sees on the
            // rail, so a dropped item never leaves a gap in the numbering.
            var card = propertyCard(item, count);
            if (!card) { continue; }
            track.appendChild(card);
            // Only cards that actually reached the DOM feed the per-turn set —
            // the same will-it-render rule the dedupe pre-scan lives by.
            if (rendered) { rendered[renderableCardUrl(item)] = true; }
            count += 1;
        }

        // Every item dropped ⇒ no carousel at all: an empty track would still
        // paint its fades and float two arrows over a blank strip.
        if (!count) { return; }

        var wrap = el('div', 'nc-carousel');
        // The wrapper stays the labelled group carrying the carousel
        // roledescription (←/→ across the book links is a walk through a strip,
        // not a jump between replies); the TRACK is the labelled list the
        // contract's Accessibility section asks for — cards are peers, not
        // slides. The roles are explicit because these are divs. Arrows, fades
        // and dots are wrapper children, siblings of the track, so the list's
        // children stay pure listitems.
        attrs(wrap, {
            role: 'group',
            'aria-roledescription': t('carousel'),
            'aria-label': t('properties')
        });
        attrs(track, { role: 'list' });
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
        //
        // Only from two cards up. One card is not an edge case on this contract,
        // it is the DEFAULT shape — the server sends one card for a resolved
        // property — and a lone dot reads as "page 1 of 1" under a strip that
        // does not scroll, beside two hidden arrows. A position readout with one
        // position is furniture, so there is none.
        var dots = null;
        if (count > 1) {
            dots = attrs(el('div', 'nc-car-dots'), { 'aria-hidden': 'true' });
            for (var d = 0; d < count; d++) { dots.appendChild(el('span', 'nc-car-dot')); }
            wrap.appendChild(dots);
        }

        // Appended BEFORE wiring: the first sync measures scrollWidth against
        // clientWidth, and a node still outside the document measures 0 against 0
        // — which reads as "already at the end" and would hide the forward arrow
        // for good. A closed panel is only scaled, faded and visibility: hidden,
        // never display: none — all three leave the box in the layout — so the
        // measurement is real even for a reply that arrives unopened.
        els.body.appendChild(wrap);
        wireCarousel(wrap, track, [prev, fadeL], [next, fadeR], dots);

        // The overflow affordance (1.6.0). `more` WINS over `total`: a tappable
        // "see all" answers the question the count line only states. `total` is
        // compared against the cards actually shown — the server's own cap and
        // CARD_MAX both cut, and the guest is told about either the same way.
        var more = action.more || null;
        var moreUrl = more ? safeHttpUrl(more.url) : null;
        if (moreUrl && typeof more.label === 'string' && more.label) {
            // Label is server-localized — textContent via linkButton, never t().
            linkButton(more.label, moreUrl, null, null, rendered, 'property_cards_more');
        } else if (typeof action.total === 'number' && action.total > count) {
            els.body.appendChild(el('div', 'nc-car-count', tf('showingOf', count, action.total)));
        }
        afterRender();
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
    function propertyCard(item, index) {
        // The shared gate — see renderableCardUrl(): the dedupe pre-scan must
        // agree with this drop decision or it suppresses a Book button wrongly.
        var href = renderableCardUrl(item);
        if (!href) { log('property card dropped — no name or usable booking url', item.key); return null; }

        var card = el('div', 'nc-card');
        attrs(card, { role: 'listitem' }); // the track is the labelled list

        var photo = el('div', 'nc-card-photo');
        var image = safeHttpUrl(item.image);
        if (image) {
            var img = el('img');
            // Decorative by default — the title sitting directly under the photo
            // already carries its meaning, so absent image_alt the alt is the
            // empty string (the contract's stated rule since 1.6.0; image_alt is
            // reserved and unemitted today). typeof, not ||: a non-string must
            // not stringify into the attribute.
            attrs(img, {
                src: image,
                alt: typeof item.image_alt === 'string' ? item.image_alt : '',
                loading: 'lazy'
            });
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

        // cta_label (1.6.0) is server-localized Book text — prefer it, and keep
        // the pack's "Book now" as the fallback (empty string falls back too).
        var book = el('a', 'nc-card-book',
            (typeof item.cta_label === 'string' && item.cta_label) ? item.cta_label : t('book'));
        attrs(book, { href: href, target: '_blank', rel: 'noopener noreferrer' });
        attrs(book, { 'data-wchat-el': 'property_card', 'data-wchat-index': String(index) });
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

        // period/basis (1.6.0; PER ITEM since 1.6.1 — two cards in one rail may
        // legitimately differ, so this resolves per card, never once per rail).
        // Strict matches: an unknown value contributes nothing. Absence means a
        // BARE price — the server omits both unless the tenant declared them,
        // and inventing "/night" on a per-stay figure is a guest-facing pricing
        // error, not a cosmetic one (response-contract.md, reading price_from).
        var suffix = '';
        if (price.period === 'night') { suffix += t('priceNight'); }
        else if (price.period === 'stay') { suffix += t('priceStay'); }
        if (price.basis === 'per_person') { suffix += ' ' + t('pricePerPerson'); }
        else if (price.basis === 'per_unit') { suffix += ' ' + t('pricePerUnit'); }
        if (suffix) { line.appendChild(el('span', 'nc-card-per', suffix)); }
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

            // A single-card strip ships no dots row at all, so everything below
            // has nothing to light. The arrows above still run: one card can
            // overflow a narrow panel, and the fades still have to answer for it.
            if (!dots) { return; }

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

        // The VIEWPORT moves the track too, and it does it without passing
        // through expandPanel()/shrinkPanel(): narrowing a desktop window, or
        // rotating a phone, re-flows the panel and fires no scroll event. Widening
        // usually self-heals because clamping scrollLeft happens to fire one;
        // narrowing does not, and the forward arrow stays hidden over 146px of
        // still-scrollable track.
        //
        // An observer rather than a window resize listener, and deliberately: it
        // is owned by a node INSIDE #nest-chatbot, so it is collected with the
        // subtree exactly like every listener above it and teardown() still has
        // nothing to clear. Feature-tested because the file supports browsers
        // that predate it — one un-resyncing carousel is the cost there, which is
        // today's behaviour everywhere.
        //
        // The `removed` re-check is the same one every deferred callback in this
        // file carries. A detached track cannot throw today, but that rests on
        // step() always finding a firstChild and CARD_GAP staying non-zero —
        // guarantees the observer has no reason to depend on. teardown() still
        // clears nothing; this is the contract it clears nothing *because of*.
        if (window.ResizeObserver) {
            new window.ResizeObserver(function () {
                if (removed) { return; }
                sync();
            }).observe(track);
        }

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
        // A region NAMED BY ITS TITLE (contract → Accessibility), not a live one:
        // .nc-body is already non-live and the announcer speaks only replies.
        // aria-label with the title string, not aria-labelledby — nothing in this
        // widget emits element ids. The gates above guarantee title is non-empty.
        attrs(card, { role: 'region', 'aria-label': action.title });
        // locale (1.6.0) names the language of the block's DISPLAYED text — mark
        // it up so a screen reader does not read Spanish copy with an English
        // voice. Absent means unknown: set nothing, never guess (the island rows
        // omit it on purpose — proper nouns have no language to claim).
        if (typeof action.locale === 'string' && /^[a-z]{2}$/.test(action.locale)) {
            attrs(card, { lang: action.locale });
        }

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
        attrs(link, { 'data-wchat-el': 'promo_card' });
        card.appendChild(link);

        els.body.appendChild(card);
        afterRender();
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
    function typeText(node, text) {
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
        // the preference flipped.
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) {
            node.classList.remove('nc-typing');
            node.textContent = full;
            endStream();
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
                endStream();
                return;
            }
            textNode.appendData(chars[i]);
            i += 1;
            // THE line the whole change is about. This used to jam the transcript
            // to the bottom, dragging the reply's opening line off the top of the
            // panel while the guest was still reading it. Now it only repaints the
            // ⌄ cue as the text grows past the fold — unless the guest pressed ⌄
            // and asked to be taken along, which is what afterRender() honours.
            if (i % 8 === 0) { afterRender(); }
            setTimeout(step, 5 + Math.random() * 15);
        })();
    }

    // Follow is per REPLY: the guest asked to ride THIS one down, and the next
    // turn starts from a still viewport again. One last move first, so a followed
    // stream ends at the bottom rather than eight characters short of it.
    function endStream() {
        afterRender();
        followStream = false;
    }

    /* ============================================================ intro ===== */
    /*
     * The branded loader is a join, not a fixed delay: the circular progress runs
     * WHILE the init request is in flight and the greeting appears once both the
     * animation and the network have finished. The animation costs the guest
     * nothing it was not already going to wait for.
     */

    var intro = { animDone: false, greeting: null, actions: null, settled: false, ended: false };

    function playIntro() {
        if (introPlayed) { return; }
        introPlayed = true;

        // A stored transcript makes this a RETURN, not an arrival: skip the
        // loader and the typing entirely — both are first-visit theatre — and
        // paint the conversation where the guest left it. readStore() twice in
        // one tick (here and in startConversation) reads the same record; the
        // empty-transcript fallback only fires if another tab cleared the
        // store between the two reads, and lands on the arrival path.
        var stored = readStore();
        if (stored && stored.turns) {
            // THE returning-guest signal, latched where the branch is actually
            // taken rather than re-derived later — 'wchat:open' reports it, and
            // it is the one value that cannot disagree with what the guest saw.
            resumed = true;
            intro.animDone = true;   // no animation armed — the join must not wait for one
            startConversation(function () {
                if (transcript.length) { replayTranscript(); }
                else { introMaybeFinish(); }
            });
            return;
        }

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
            // Stamped but deliberately NOT run through maybeDaySeparator: the
            // greeting is transcript entry 0 by construction (it is unshifted
            // below), and no pill is ever painted above the first message. It is
            // also inserted BEFORE an impatient guest's already-sent bubble, so a
            // pill computed here would land in the wrong place besides.
            var greetedAt = nowMs();
            stampBubble(text, greetedAt);
            wrap.appendChild(avatar);
            wrap.appendChild(text);

            // Insert directly after the loader, NOT at the end: the composer is
            // live while the intro runs, so an impatient guest can already have
            // sent a message. The greeting still has to read first.
            els.body.insertBefore(wrap, els.loader.nextSibling);

            requestAnimationFrame(function () {
                wrap.classList.add('nc-visible');
                // The welcome renders as the greeting STARTS typing, not when it
                // finishes. Hanging it off the typer's completion cost the guest
                // ~1.7s of dead wait on top of an already ~4.2s branded intro, and
                // put the whole block behind a callback that had to fire identically
                // down two motion paths — streaming and reduced-motion — to exist at
                // all. Showing the options while the greeting is still being read is
                // the precedent sendMessage() has always set: a reply's actions[]
                // render under a bubble that is still typing.
                //
                // Guarded because both states can already be true at this point: the
                // composer is live all through the intro, so an impatient guest may
                // have sent a turn, and a 403 may have torn the widget down.
                if (!removed && !guestTurned) { showWelcome(wrap); }
                // The greeting is transcript turn 0 — UNSHIFTED, because this
                // bubble is inserted BEFORE an impatient guest's already-sent
                // message and the array must read like the screen. Created
                // here, where the bubble is, and never in the init callback:
                // that also fires on the 410 re-init, which paints nothing.
                transcript.unshift({ r: 'bot', t: intro.greeting, a: null, n: null, at: greetedAt });
                persist();
                typeText(text, intro.greeting);
            });
        }, 900);
    }

    /*
     * Paint a stored transcript through the SAME renderers a live payload
     * uses (the threat-model comment above readStore() is the argument for
     * why that is safe). No loader, no typing, no announcements — and
     * deliberately no replyCount: it feeds maybeAutoExpand(), and a replay
     * that counted would auto-expand the panel the instant a returning guest
     * opens it.
     */
    function replayTranscript() {
        intro.settled = true;
        els.loader.classList.add('nc-hidden');

        replaying = true;
        var greetingWrap = null;
        for (var i = 0; i < transcript.length; i++) {
            // The one-shot rule survives the replay through its one owner:
            // every send retires every chip row, so rows can be live only on
            // the FINAL turn — retire everything painted so far before it.
            // (A final guest turn carries no chips, so it needs no case.)
            if (i === transcript.length - 1) { retireChipRows(); }
            var turn = transcript[i];
            // turn.at is null for anything stored before 2.8.1 — that is the
            // signal for "no day pill, no title", and it is why addBubble
            // distinguishes null from an omitted argument.
            var bubble = turn.t ? addBubble(turn.r, turn.t, turn.at) : null;
            // INVARIANT: the replayed greeting is a plain bot bubble and must NOT
            // wear .nc-greeting. That class is ENTRANCE-ONLY — opacity:0, height:0,
            // translateX, undone by .nc-visible the intro adds — so a replay
            // wearing it without running the intro paints an invisible greeting.
            // Which means .nc-greeting must never gain a PAINTED property (spacing,
            // an avatar rule, a colour): the day it does, live and replay diverge
            // and nothing else in this file will explain why.
            if (i === 0 && turn.r === 'bot' && bubble) { greetingWrap = bubble.parentNode; }
            // A fresh per-turn url set, exactly like a live turn's.
            if (turn.a) { renderActions(turn.a, bubble, Object.create(null)); }
        }
        replaying = false;

        // A guest who read the greeting and navigated without typing has a
        // one-turn transcript: no intro animation, but the welcome block and
        // promo still render — first-contact affordances belong to a
        // conversation the guest has not yet joined. A decision, not an
        // emergent behaviour.
        if (!guestTurned && greetingWrap) { showWelcome(greetingWrap); }

        // Restored as STATE through the existing path — persistableActions()
        // stripped the element, so this is the one seam (composer closed,
        // restart button appended, chips retired, focus handled).
        if (intro.ended) { endConversation(); }

        scrollToLatest(false);
    }

    /* ------------------------------------------------------ the welcome block */
    /*
     * What sits under the greeting before the guest has said anything: the
     * welcome elements the site configured on the init response, or — when it
     * configured none that render — two suggested openers of the widget's own.
     * The site's chips win outright: contract 1.5.0 defines an init
     * quick_replies row as the site's own "try asking" chips, so showing the
     * pack block beside one puts the same affordance on screen twice.
     *
     * The pack strings are cached in the widget rather than fetched: the welcome
     * state is the one moment the guest is watching a spinner, and it must not
     * cost a second round trip. Being the fallback is also why they stay cached —
     * they have to exist before any answer does.
     */

    var PROMPT_KEYS = ['prompt1', 'prompt2'];

    /**
     * One wrapper holding the whole welcome, inserted after the greeting as a
     * sibling inside .nc-body — never nested in the greeting bubble. followsBotMessage()
     * reads els.body.lastElementChild, and a welcome tucked inside the greeting
     * would leave that bubble last, costing the next reply its avatar.
     *
     * Inserted after the greeting rather than appended: the composer is live all
     * through the intro, so appending would file the block behind an impatient
     * guest's own bubble.
     *
     * The server's elements are PARTITIONED by type, not rendered wholesale. A
     * quick_replies row is a first-contact affordance and belongs in the wrapper,
     * which goes on the first guest turn — the contract calls a chip row
     * one-shot. Everything else a site configures (a promo, a link) is transcript
     * content and goes into .nc-body through the ordinary seam, where the sweep
     * cannot reach it: a tenant's init promo must not vanish the moment the guest
     * types.
     *
     * Server chips REPLACE the widget's own pack block; they do not join it.
     * Contract 1.5.0 says what an init quick_replies row is — "the site's
     * chatbot.quick_prompts setting (the 'try asking' chips)" — so rendering both
     * puts the same affordance on screen twice, the site's version and ours. Ours
     * is the fallback: unconfigured sites, older servers, mock mode, actions: [].
     *
     * The branch is on what actually RENDERED, never on what the payload
     * contained. renderQuickReplies() returns early when every item is malformed,
     * and a widget that read the element rather than the row would answer a
     * broken payload with an empty welcome and no fallback at all.
     *
     * `null` as renderActions' bubble argument, never the greeting's own .nc-text:
     * an init async_result handed that node would retype the poll's answer OVER
     * the greeting. With null, pollResult opens a bubble of its own.
     */
    function showWelcome(after) {
        var welcome = el('div', 'nc-welcome');

        var actions = intro.actions || [];
        var rest = [];
        var chipped = false;
        for (var i = 0; i < actions.length; i++) {
            if (actions[i] && actions[i].type === 'quick_replies') {
                // Every row, not just the first: a site sends its "try asking"
                // prompts and an island clarification as two elements, and each
                // is handled independently — reusing the type is contract-legal.
                if (renderQuickReplies(actions[i], welcome)) { chipped = true; }
            } else {
                rest.push(actions[i]);
            }
        }

        // Rows still take no "TRY ASKING" label borrowed from the pack above
        // them. A label reading "try asking" over "Tenerife" would assert an
        // island name is a thing to try asking, when it is the answer to a
        // question — and that reasoning is what keeps us from inventing one now
        // that a row CAN be headed. Contract 1.7.0 gives the row an optional
        // `heading` of its own (open point 9, delivered): the tenant writes it,
        // the server localizes it, renderQuickReplies() renders it inside the
        // row, and absent still means bare.
        if (!chipped) { showPrompts(welcome); }

        after.parentNode.insertBefore(welcome, after.nextSibling);
        renderActions(rest, null);
        els.welcome = welcome;
        afterRender();
    }

    /**
     * The widget's own two openers, appended into the welcome wrapper.
     *
     * Labels are resolved at CLICK time, not here. A guest who switches language
     * between reading the pill and tapping it must send the sentence they can
     * read — and setLocale() repaints the visible pills to match.
     *
     * Nothing here announces: this is interactive chrome reached by Tab, and the
     * announcer exists for replies the eye may miss, not for buttons.
     */
    function showPrompts(welcome) {
        var prompts = el('div', 'nc-prompts');
        var label = el('span', 'nc-prompts-label', t('tryAsking'));
        prompts.appendChild(label);

        var buttons = [];
        PROMPT_KEYS.forEach(function (key) {
            var button = el('button', 'nc-prompt', t(key));
            attrs(button, { type: 'button' });
            button.addEventListener('click', function () { sendGuestText(t(key), 'prompt'); });
            prompts.appendChild(button);
            buttons.push(button);
        });

        welcome.appendChild(prompts);
        els.promptsLabel = label;
        els.promptButtons = buttons;
    }

    // Null-safe and idempotent: it runs on every guest turn, and only the first
    // one has anything to remove. ONE wrapper, so the server's chip row leaves
    // with the pack block and a single focus rescue covers both. Before 2.4.1 a
    // welcome chip row had no handle at all: it stood above the transcript for the
    // rest of the conversation, against the contract's one-shot rule for chips.
    function removeWelcome() {
        if (els.welcome && els.welcome.parentNode) {
            // Never strand keyboard focus on a node about to vanish — the same
            // rule hideTeaser() and the carousel's rescueFocus() state. A guest
            // who activates a pill or a chip with the keyboard is standing ON the
            // node this line removes, and the browser answers a removed
            // activeElement by resetting focus to <body>: the next Tab would
            // restart from the top of the HOST page. The composer is where their
            // next turn goes anyway, so it is the landing spot as well as the
            // rescue.
            if (els.welcome.contains(document.activeElement)) { els.input.focus(); }
            els.welcome.parentNode.removeChild(els.welcome);
        }
        els.welcome = null;
        els.promptsLabel = null;
        els.promptButtons = null;
    }

    /* ============================================================= flow ===== */

    function isOpen() { return els.root.classList.contains('nc-open'); }

    function open(source) {
        if (removed || isOpen()) { return; }
        // Read BEFORE markOpened() retires the flag — this is the one moment it
        // still says whether the guest had opened the panel earlier this session.
        var firstOpen = !readFlag('sessionStorage', FLAG_OPENED);
        els.root.classList.add('nc-open');
        els.toggler.setAttribute('aria-expanded', 'true');
        markOpened();
        hideTeaser();
        playIntro();
        // A guest can close the panel mid-turn and reopen it to find the reply
        // finished below the fold. The closed panel is only visibility: hidden and
        // keeps its box in the layout (see .nc-panel), so this measures true.
        syncScrollCue();
        // AFTER playIntro(), which is where `resumed` is decided. That branch
        // runs synchronously — startConversation()'s resume path calls its
        // callback without touching the network — so the value is settled by
        // here and the event can never claim a branch the guest did not see.
        emit('open', {
            source: oneOf(OPEN_SOURCES, source),
            firstOpen: firstOpen,
            resumed: resumed,
            turns: transcript.length
        });
        // Re-checked at fire time, like every other timer here: the panel can be
        // closed again inside these 320ms (Escape, a second press of the
        // launcher), and focusing the composer of a CLOSING panel is the fourth
        // way into the same defect — the delayed visibility step lands a moment
        // later, the browser blurs the now-invisible textarea, and focus falls to
        // <body>, i.e. the top of the host page.
        setTimeout(function () {
            if (removed || !isOpen()) { return; }
            els.input.focus();
        }, 320);
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

    function close(source) {
        if (removed || !isOpen()) { return; }
        // Never strand keyboard focus on a node about to vanish. The closed panel
        // is visibility: hidden, so anything focused inside it — the ✕ the guest
        // just pressed, most obviously — is blurred by the browser and focus falls
        // back to <body>, i.e. the top of the HOST page. The launcher is the
        // widget's remaining control and the way back in, which is also why Esc
        // has always landed there.
        if (els.panel.contains(document.activeElement)) { els.toggler.focus(); }
        els.root.classList.remove('nc-open');
        els.toggler.setAttribute('aria-expanded', 'false');
        closeLanguageMenu();
        closeHeaderMenu();
        emit('close', {
            source: oneOf(CLOSE_SOURCES, source),
            turns: transcript.length
        });
    }

    // The source rides through to whichever half runs — 'toggler' is legal in
    // both enums, and anything else a caller invents falls back to 'api' there.
    function toggle(source) { isOpen() ? close(source) : open(source); }

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

    /* FLAG_EXPANDED is written and cleared on EVERY expand and shrink, whoever
       caused it — it records the panel's last state, not an intent, which is what
       makes boot() able to restore it. USER_SHRANK stays a separate, narrower
       claim: only the guest writes it, and only shrinking. */
    function expandPanel() {
        if (removed || isExpanded()) { return; }
        els.root.classList.add('nc-expanded');
        els.expand.setAttribute('aria-label', t('shrink'));
        writeFlag('localStorage', FLAG_EXPANDED);
        resyncCarousels();
    }

    // byUser distinguishes the guest pulling the sheet back in — a stated
    // preference worth remembering — from any programmatic shrink.
    function shrinkPanel(byUser) {
        if (removed || !isExpanded()) { return; }
        els.root.classList.remove('nc-expanded');
        els.expand.setAttribute('aria-label', t('expand'));
        clearFlag('localStorage', FLAG_EXPANDED);
        if (byUser) { writeFlag('localStorage', FLAG_USER_SHRANK); }
        resyncCarousels();
    }

    // A once-per-session courtesy, not a nag: after three real replies on a wide
    // screen the panel offers itself as the side sheet. isOpen() must run before
    // the flag is written — a panel closed mid-turn must not spend the one
    // auto-expand invisibly, so a guest who reopens still gets offered it.
    function maybeAutoExpand() {
        if (removed || replyCount < 3 || !isOpen() || isExpanded()) { return; }
        if (!window.matchMedia || !window.matchMedia('(min-width: 1024px)').matches) { return; }
        if (readFlag('localStorage', FLAG_USER_SHRANK)) { return; }
        if (readFlag('sessionStorage', FLAG_AUTO_EXPANDED)) { return; }
        writeFlag('sessionStorage', FLAG_AUTO_EXPANDED);
        expandPanel();
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
            // The sheet changes the body's height as well as the track's width,
            // and a resize fires no scroll event — so the cue is stale for exactly
            // the same reason the arrows are, and gets fixed on the same beat. The
            // anchor's floor was measured against the OLD clientHeight and cannot
            // survive the move.
            clearAnchorPad();
            syncScrollCue();
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
        // Shown and dismissed only. The auto-hide is a timer expiring, not
        // something the guest did, and counting it would flatter the dismissal
        // rate with people who simply looked away.
        emit('teaser', { action: 'shown' });
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
        emit('teaser', { action: 'dismissed' });
        hideTeaser();
    }

    function startConversation(cb) {
        var stored = readStore();
        if (stored) {
            conversationUuid = stored.uuid;
            started = true;
            if (intro.greeting === null) { intro.greeting = t('greeting'); }
            // Replayed from the store for the same reason the greeting is
            // defaulted here: this branch never reaches the server, and the
            // welcome elements are the site's, not the conversation's. Without
            // it a returning guest gets the fallback pills and nothing the site
            // configured — see readStore().
            if (intro.actions === null) { intro.actions = stored.actions; }
            // RESTORED, not defaulted — and this is the half of 1.7.0 that looks
            // finished when it isn't. This branch never reaches the server, so
            // the record is the only source for both values, and the first turn
            // of this session is about to write the record back through
            // persist(), which serializes whatever is in these two variables.
            // Skip this and the window silently reverts to the 24h fallback one
            // turn later — the exact defect 2.10.0 exists to remove.
            serverIdleHours = stored.idleHours;
            serverOffset = stored.clockOffset;
            // The transcript and its latches ride the same record. `ended` is
            // handed to replayTranscript via intro rather than restored here:
            // endConversation() uses `ended` as its idempotence guard and must
            // see false, or the restore would no-op and leave a live composer
            // on a dead conversation.
            if (stored.turns) {
                transcript = stored.turns;
                guestTurned = stored.guestTurned;
                intro.ended = stored.ended;
            }
            cb();
            return;
        }

        // One init at a time. The intro fires one, and a fast first submit would
        // fire a second (two conversations created, last uuid wins) — queue
        // behind the in-flight call instead.
        if (initWaiters) { initWaiters.push(cb); return; }
        initWaiters = [cb];
        // Same claim sendMessage() and pollResult() make about their own
        // requests: this init belongs to the conversation live at its start.
        var epoch = chatEpoch;

        API.init(function (status, body) {
            // A restart while this was on the wire released initWaiters and
            // fired its OWN init (see restartConversation). Checked BEFORE the
            // waiters are taken below, and that order is the point: a stale
            // callback grabbing the list would null the NEW init's waiters and
            // the restart's greeting would never paint. Returning also abandons
            // the conversation this 201 created - deliberate, because adopting
            // its uuid is exactly how "start a new chat" would silently continue
            // the old chat. One orphaned server-side conversation per
            // restart-during-init is the price, and it is the right one.
            if (epoch !== chatEpoch) { return; }
            var waiters = initWaiters || [];
            initWaiters = null;
            if (removed) { return; }
            log('init', status, body);
            lastInitStatus = status;

            // Before teardown() — see the same branch in sendMessage() for why.
            if (status === 403) {
                emit('error', { phase: 'init', status: 403, retrying: false });
                teardown();
                return;
            }
            if (status === 201 && body && body.conversation && body.conversation.uuid) {
                conversationUuid = body.conversation.uuid;
                started = true;
                checkContractVersion(body.contract_version);
                intro.greeting = body.greeting || t('greeting');
                // A site can attach welcome elements to the greeting — same request,
                // zero extra network. Absent on older servers, [] when the site has
                // configured none, and neither is a fallback for anything: the empty
                // cases simply contribute nothing and the widget's own prompt block
                // stands in.
                intro.actions = (body.actions && body.actions.length) ? body.actions : null;
                // The 1.7.0 pair, settled BEFORE the persist() below serializes
                // them. Absent on an older server, which leaves the window null
                // and the offset 0 — the pre-1.7.0 behaviour exactly.
                serverIdleHours = positiveHours(body.idle_hours);
                // Parsed once per conversation, and only when it parses: a
                // malformed date must not throw the offset to NaN and date every
                // stamp we write to the Invalid Date. Measured against the raw
                // clock on purpose — this IS the raw clock's correction.
                if (typeof body.server_time === 'string') {
                    var serverMs = Date.parse(body.server_time);
                    if (isFinite(serverMs)) { serverOffset = serverMs - Date.now(); }
                }
                // Stored WITH the uuid, after intro.actions is settled: the resume
                // branch above is the only other reader and it needs the same value
                // this load is about to render. persist() also carries any
                // transcript a 410 re-init brought across — see sendMessage.
                persist();
            } else {
                // Never strand the guest behind a failed init — greet them anyway
                // and let the first real turn retry.
                intro.greeting = t('greeting');
                // Invisible on screen by design (the guest gets a greeting and no
                // error), which is exactly why it is worth reporting: a site whose
                // key is wrong looks fine and answers nothing.
                emit('error', { phase: 'init', status: status, retrying: false });
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
    function sendGuestText(text, source) {
        if (busy || removed || ended) { return; }
        guestTurned = true;
        removeWelcome();
        // ANY send retires every chip row on screen (the 1.6.0 one-shot rule) —
        // this seam is what makes "any" true with one call site. Both rescues
        // land on the composer, and welcome rows are not registered, so the two
        // sweeps never fight over a node.
        retireChipRows();
        // BEFORE the bubble lands, so its own afterRender() cannot ride a follow
        // left armed by the previous reply: every turn starts from a still view.
        followStream = false;
        // One `now` for the bubble, the pill and the stored entry, so the screen
        // and the record can never disagree about which day this turn was.
        var when = nowMs();
        // Painted HERE rather than left to addBubble, so the anchor below has the
        // node: when the guest's own message opens a new day, the PILL is what
        // rides to the top. A pill painted and instantly scrolled out of view
        // would announce the day to nobody. addBubble's own call is then a no-op
        // because lastDayKey has already advanced — that idempotence is what
        // makes calling it twice safe rather than clever.
        var separator = maybeDaySeparator(when);
        var bubble = addBubble('guest', text, when);  // textContent — a typed <img> stays text
        // The turn's ONE deliberate move. Both sweeps above SHRANK the transcript,
        // so this has to measure after them, not before. addBubble returns the
        // .nc-text node; its parent is the whole .nc-message row, which is what
        // has to reach the top — anchoring the text alone would cut the avatar.
        anchorSend(separator || bubble.parentNode);
        // Persisted HERE and never in sendMessage: the 410/404 branch re-enters
        // sendMessage with the same text, and a write point there would store
        // the guest's turn twice. On a first-ever turn the uuid may not exist
        // yet — persist() skips, and init's own persist() carries this entry.
        transcript.push({ r: 'guest', t: text, a: null, n: null, at: when });
        persist();
        // The LENGTH, never the text. This is the seam every guest turn passes
        // through — composer, prompt pill, chip — so `source` is the only place
        // that can say whether the widget's own affordances are earning their
        // space, and it is measurable nowhere else.
        emit('message', {
            source: source || 'composer',
            length: text.length,
            turns: transcript.length,
            locale: locale
        });
        ensureConversation(function () { sendMessage(text, false); });
    }

    function submit(e) {
        if (e) { e.preventDefault(); }
        if (busy || removed) { return; }

        var text = (els.input.value || '').trim();
        if (text.length < 2) { return; }

        els.input.value = '';
        adjustInputHeight();
        sendGuestText(text, 'composer');
    }

    function sendMessage(text, isRetry) {
        if (!conversationUuid) {
            // A failed re-init lands here; a throttled one deserves "try again
            // shortly", not a hard error.
            addBubble('bot', lastInitStatus === 429 ? t('retry') : t('error'));
            // Status 0 — no HTTP exchange happened on the TURN endpoint. The
            // init failure that put us here emitted its own {phase:'init'}
            // event; this one says it cost the guest a turn, which is the part
            // that matters and is not derivable from the other.
            emit('error', { phase: 'turn', status: 0, retrying: false });
            return;
        }

        // One turn in flight at a time. submit() gates on busy, but several
        // messages queued behind one init drain here together — serialize them
        // (their guest bubbles are already on screen, in order).
        if (busy) { sendQueue.push(text); return; }

        busy = true;
        els.send.disabled = true;
        var thinking = showThinking();
        // How long the guest waits, which nothing else in this widget records.
        // Measured around the transport, so the mock reports its own fixture
        // delay rather than pretending to be instant.
        var sentAt = Date.now();
        // This turn belongs to the conversation live at its send - the same
        // claim pollResult() has always made about its poll.
        var epoch = chatEpoch;

        API.send(conversationUuid, text, function (status, body) {
            // BEFORE busy, and the order is load-bearing. A restart (the header
            // menu, mid-conversation) already cleared busy, and a guest who has
            // since sent into the NEW conversation has set it again - clearing
            // it here would let a second send through while the first is still
            // on the wire. The thinking node needs no cleanup on this path
            // either: the restart's body wipe took it. Everything below writes
            // to a transcript, a store and a bubble that are no longer this
            // turn's.
            if (removed || epoch !== chatEpoch) { return; }
            busy = false;
            els.send.disabled = false;
            log('turn', status, body);

            if (thinking.parentNode) { thinking.parentNode.removeChild(thinking); }

            if (status === 200 && body) {
                // On ARRIVAL, not on settle: typeText is presentation, and a
                // guest who navigates mid-reveal must not lose a turn the
                // server already has. `t` is the FINAL text — the reveal is
                // still painting it.
                var entry = {
                    r: 'bot',
                    t: body.reply || '',
                    a: persistableActions(body.actions),
                    n: (typeof body.turn === 'number' && isFinite(body.turn)) ? body.turn : null,
                    // Arrival, like `t` above — and an async turn KEEPS this when
                    // its poll resolves (pollResult mutates t/a/n and leaves this
                    // alone, deliberately). A poll landing after midnight would
                    // otherwise move its turn's day forward past a pill already
                    // painted above it, and the record would disagree with the
                    // screen on the next reload.
                    at: nowMs()
                };
                transcript.push(entry);
                if (body.actions) {
                    for (var pi = 0; pi < body.actions.length; pi++) {
                        var pa = body.actions[pi];
                        if (pa && pa.type === 'async_result' && typeof pa.url === 'string') {
                            pollEntries[pa.url] = entry;   // the poll's final replaces this turn in place
                        }
                    }
                }
                persist();
                var bubble = body.reply ? addBubble('bot', '', entry.at) : null;
                if (bubble) { typeText(bubble, body.reply); }
                // A fresh per-turn url set: an async turn's poll actions[] are
                // additive to what renders now, so the poll must know what this
                // turn already put on screen. Never shared across turns — and the
                // init/welcome/resume paths deliberately pass none.
                renderActions(body.actions, bubble, Object.create(null));
                drainSend();
                // Counts real turn replies only — never the greeting (intro path),
                // an error/retry/timeout bubble (the non-200 branches below), or
                // the poll's in-place replacement (its interim 200 already counted
                // this turn once).
                replyCount += 1;
                maybeAutoExpand();
                // LAST in the branch, after renderActions has run: `ended` is
                // flipped by the conversation_ended renderer, so measuring it
                // any earlier would report false on the very turn that capped.
                var types = actionTypes(body.actions);
                emit('reply', {
                    turn: entry.n,
                    length: entry.t.length,
                    elements: types,
                    async: types.indexOf('async_result') !== -1,
                    resolved: false,
                    ended: ended,
                    latencyMs: Date.now() - sentAt
                });
                return;
            }

            // Idled out (410) or unknown uuid (404). On the TURN endpoint both
            // mean "this stored uuid is dead" (guide §5.1): re-init transparently
            // and resend once — without clearing the store, a stale uuid would
            // wedge this browser for the whole of the record's own idle window
            // — since 2.10.0 the server's when it sends one, the 24h fallback
            // when it does not, rather than the fixed day this used to assume.
            // The guest
            // sees one reply, never a duplicate and never an error. (On the POLL
            // endpoint a 404 is transient instead — see pollResult.)
            if ((status === 410 || status === 404) && !isRetry) {
                clearStore();
                // The transcript SURVIVES the re-init — the guest's message is
                // on screen and must not become a question with no answer after
                // a reload. Its turns now belong to a dead conversation, so
                // their server numbers are unreconcilable by definition: null
                // is the honest value (a future ?since={turn} must not ask the
                // new conversation about the old one's numbers). persist() in
                // the init callback rewrites everything under the new uuid.
                for (var ti = 0; ti < transcript.length; ti++) { transcript[ti].n = null; }
                conversationUuid = null;
                started = false;
                // NOT a guest-visible failure — this path is normal and the
                // guest sees one reply either way. Worth reporting anyway, and
                // `retrying` is what says so: a SPIKE here means guests are
                // coming back past the idle window while this browser still
                // thinks they are inside it. Since 2.10.0 the window comes from
                // the server, so a spike no longer means "the deployment moved
                // and we did not" — it means these browsers are judging by the
                // IDLE_MS fallback: an older server that sends no idle_hours, or
                // records written by one that have not been rewritten since.
                emit('error', { phase: 'turn', status: status, retrying: true });
                startConversation(function () { sendMessage(text, true); });
                return;   // the retry's own callback drains the queue
            }

            // BEFORE teardown(), which sets `removed` and makes emit() a no-op.
            // A 403 is the one error a host most needs to see — a revoked key or
            // an unregistered origin (guide §7) takes the widget off their page
            // silently, and this event is the only trace on the client.
            if (status === 403) {
                emit('error', { phase: 'turn', status: 403, retrying: false });
                teardown();
                return;
            }
            if (status === 429) {
                addBubble('bot', t('retry'));
                emit('error', { phase: 'turn', status: 429, retrying: false });
                drainSend();
                return;
            }

            addBubble('bot', t('error'));
            emit('error', { phase: 'turn', status: status, retrying: false });
            drainSend();
        });
    }

    function drainSend() {
        // `ended` too: a capped conversation answers every queued turn with the
        // same canned refusal — endConversation() already emptied the queue, and
        // this guard keeps a race from re-draining into it.
        if (removed || ended || busy || !sendQueue.length) { return; }
        sendMessage(sendQueue.shift(), false);
    }

    /**
     * conversation_ended (contract 1.6.0, D-044): the turn cap. Every further
     * POST returns the same canned refusal with no LLM call, so close the
     * composer — an open input inviting messages that all buy the same answer is
     * worse than a stated ending — and offer the one thing that still works: a
     * new conversation. The element carries no visual payload; `reply` already
     * told the guest, so the button is all this adds.
     *
     * Idempotent: the server re-emits the element on every further capped POST,
     * and a second button under the first would read as a broken widget.
     */
    function endConversation() {
        if (ended || removed) { return; }
        ended = true;
        // Queued turns would each buy the same refusal — and must NOT survive
        // into the next conversation through a restart.
        sendQueue.length = 0;
        // The 200-branch persist fired before renderActions flipped this — and
        // no further turn can carry it (the composer is closing). Without this
        // write a reload reopens the composer on a dead conversation.
        persist();
        // BEFORE the composer closes: retireChipRows()'s focus rescue lands on
        // els.input, which must still be enabled to take it.
        retireChipRows();

        var restart = el('button', 'nc-action nc-action--primary nc-restart', t('newChat'));
        attrs(restart, { type: 'button' });
        // WRAPPED, not passed by reference - the defence wire() applies to its
        // own three listeners, and now needed here: addEventListener hands its
        // handler a MouseEvent as the first argument, and restartConversation()'s
        // first argument is the `source` that reaches wchat:restart.
        restart.addEventListener('click', function () { restartConversation('ended'); });
        var row = el('div', 'nc-action-row');
        row.appendChild(restart);
        els.body.appendChild(row);
        els.restart = restart;
        // Disabling a focused control drops focus to <body> — the standing rule,
        // rediscovered five times in this repo. The guest who just sent the
        // capped message is standing in the composer; hand them the only
        // control that still does anything.
        //
        // Focusing an off-screen button scrolls it into view, so this is the one
        // place left that can still move the transcript on its own. Deliberate,
        // not a leftover: the composer has just been disabled and the guest MUST
        // be able to reach the only live control — the focus rule outranks the
        // scroll rule.
        if (els.form.contains(document.activeElement)) { restart.focus(); }
        els.input.disabled = true;
        els.send.disabled = true;
        afterRender();
        emit('ended', { turns: transcript.length });
    }

    /**
     * The restart. Deliberately NOT a replay of the intro: its latches
     * (intro.settled, introPlayed) stay spent, and this renders the new greeting
     * itself — the same shape introMaybeFinish() draws, minus the loader dance.
     * The transcript is wiped because the new conversation shares no memory with
     * the old one; keeping the exchange on screen implies a continuity the
     * server does not have.
     */
    function restartConversation(source) {
        if (removed) { return; }
        // BEFORE the wipe below, while transcript.length still says how much
        // conversation the guest was carrying when they chose to start over.
        // `source` separates the two routes, and they call for opposite
        // responses: 'menu' is a guest CHOOSING to start again, 'ended' is one
        // who hit the server's turn cap and had nothing else left to press.
        emit('restart', {
            turns: transcript.length,
            source: oneOf(RESTART_SOURCES, source, 'ended')
        });
        clearStore();
        conversationUuid = null;
        started = false;
        ended = false;
        guestTurned = false;      // a NEW conversation gets first-contact affordances again
        intro.greeting = null;    // the fresh init must re-settle both
        intro.actions = null;
        /*
         * The intro's latches, SPENT — which the header comment above has always
         * assumed and which used to be true only by luck. While the ended-state
         * button was the sole caller the intro had long finished by the time
         * anyone could press it. From the header menu this runs mid-intro too,
         * and there `settled` is still false: the animation's own deferred
         * introMaybeFinish() lands AFTER the callback below has painted the new
         * greeting and paints a SECOND one beside it, because by then the
         * restart's own init has filled intro.greeting back in. Spending them
         * here is what makes "deliberately NOT a replay of the intro" true
         * rather than incidental.
         */
        intro.settled = true;
        intro.animDone = true;
        // And take the loader out if it never got its exit. It stays ATTACHED —
        // nc-hidden is display:none, and the callback below still needs it as
        // the greeting's insertion anchor — but a progress ring left spinning
        // above a finished greeting is the intro half-played.
        els.loader.classList.add('nc-hidden');
        chipRows = [];            // already retired; the wipe below removes any remnant
        transcript = [];                     // a NEW conversation shares no history with the old one
        pollEntries = Object.create(null);   // any orphaned poll handle died with its epoch
        followStream = false;     // a follow armed for the old reply must not ride into the new one
        lastDayKey = null;        // the wipe below takes every pill with it; a stale day here
                                  // would swallow the first real separator of the new conversation
        chatEpoch += 1;           // orphan any poll still backing off for the dead conversation
        // One offset per CONVERSATION, and this starts a new one. Unlike
        // serverIdleHours — which the init below reassigns unconditionally, so it
        // cannot survive — the offset is only written when a 201 actually carries
        // server_time, so a re-init that omits it (older server) or fails outright
        // would otherwise stamp the new conversation on the old one's correction.
        serverOffset = 0;
        /*
         * THE THREE BELOW ARE WHY THIS FUNCTION IS NOT PURE EXPOSURE.
         *
         * Until 2.10.2 the only caller was the conversation_ended button, where
         * `busy` is false (the capped reply has landed) and endConversation()
         * has already emptied the queue. From the header menu neither holds. A
         * turn on the wire when the guest restarts would clear busy, push itself
         * into the NEW transcript, paint a bot bubble under the fresh greeting
         * and persist it - an answer to a question the new conversation has no
         * record of and the server's side of it never saw.
         *
         * chatEpoch above is the guard; sendMessage() and startConversation()
         * re-check it exactly as pollResult() already did. These three release
         * what a guard alone cannot. Without `busy` the new conversation is
         * wedged, because submit() and sendGuestText() both gate on it and the
         * stale callback now returns before clearing it. Without the queue the
         * dead conversation's backlog drains into the new one. And without
         * releasing initWaiters, startConversation() below would queue behind
         * the dead conversation's in-flight init instead of firing its own -
         * adopting the very uuid this function exists to abandon.
         */
        busy = false;
        sendQueue.length = 0;
        initWaiters = null;

        els.input.disabled = false;
        els.send.disabled = false;
        els.restart = null;
        // The activeElement IS the restart button about to be wiped.
        if (els.body.contains(document.activeElement)) { els.input.focus(); }
        // Wipe the transcript but KEEP the (hidden) loader node: els.loader must
        // stay attached — it is the greeting's insertion anchor below, exactly as
        // it is for introMaybeFinish().
        while (els.body.lastChild && els.body.lastChild !== els.loader) {
            els.body.removeChild(els.body.lastChild);
        }
        // The transcript that was below the fold is gone; the cue and the anchor's
        // breathing room must go with it rather than wait out the init round trip
        // holding open a gap under nothing.
        clearAnchorPad();
        syncScrollCue();

        startConversation(function () {
            if (removed) { return; }
            var wrap = el('div', 'nc-message nc-message--bot nc-greeting');
            var text = el('div', 'nc-text');
            var greetedAt = nowMs();   // stamped, never separated — see introMaybeFinish
            stampBubble(text, greetedAt);
            wrap.appendChild(avatarNode());
            wrap.appendChild(text);
            // After the loader, not appended: the composer is live again, so an
            // impatient guest's bubble may already be here — the greeting still
            // reads first.
            els.body.insertBefore(wrap, els.loader.nextSibling);
            requestAnimationFrame(function () {
                wrap.classList.add('nc-visible');
                if (!removed && !guestTurned) { showWelcome(wrap); }
                // Same rule as introMaybeFinish: the greeting entry is born with its bubble.
                transcript.unshift({ r: 'bot', t: intro.greeting, a: null, n: null, at: greetedAt });
                persist();
                typeText(text, intro.greeting);
            });
            if (isOpen() && !guestTurned) { els.input.focus(); }
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

    // `rendered` is the turn's url set: the poll's actions[] are ADDITIVE to what
    // the interim turn drew (contract 1.6.0), so the final render needs to know
    // which hrefs are already on screen to suppress the one duplicate that can
    // arise (see renderAvailability).
    function pollResult(path, bubble, rendered) {
        // Must be relative. Resolving it against the API base ourselves is what
        // keeps the Bearer key on the origin we already POST to.
        if (typeof path !== 'string' || path.charAt(0) !== '/') {
            log('rejected a non-relative async_result url', path);
            return;
        }

        var startedAt = Date.now();
        var delay = POLL_START_MS;
        // This poll belongs to the conversation live at its start. A restart
        // (conversation_ended → new chat) bumps chatEpoch, and a stale poll must
        // then do nothing: its bubble is detached and its actions would render
        // into a transcript that is not its own.
        var epoch = chatEpoch;

        function schedule() {
            // the 120s give-up must not bubble post-teardown or post-restart
            if (removed || epoch !== chatEpoch) { return; }
            if ((Date.now() - startedAt) >= POLL_GIVE_UP_MS) {
                addBubble('bot', t('timeout'));
                // Status 0: nothing failed on the wire, we stopped asking. The
                // interim reply and its fallback links are still on screen, so
                // this is a delay the guest noticed, never a dead end.
                emit('error', { phase: 'poll', status: 0, retrying: false });
                return;
            }
            setTimeout(tick, delay);
            delay = Math.min(POLL_MAX_MS, Math.round(delay * POLL_FACTOR));
        }

        function tick() {
            if (removed || epoch !== chatEpoch) { return; }
            API.poll(path, function (status, body) {
                // Re-checked HERE too: the request was in flight while the guest
                // restarted, and this callback is the last gate before the DOM.
                if (removed || epoch !== chatEpoch) { return; }
                log('poll', status, body);
                if (status === 403) {
                    emit('error', { phase: 'poll', status: 403, retrying: false });
                    teardown();
                    return;
                }
                // Stops the poll and nothing more (guide §5.1) — the interim
                // reply stays and nothing re-inits. The transient statuses
                // (pending / 404 / 429 / network) fall through to schedule() and
                // emit NOTHING: they are the backoff working, not a failure, and
                // reporting each one would drown the real errors.
                if (status === 410) {
                    emit('error', { phase: 'poll', status: 410, retrying: false });
                    return;
                }

                if (status === 200 && body && (body.status === 'ready' || body.status === 'failed')) {
                    // Replace the interim bubble in place — the server overwrote
                    // the same transcript row.
                    if (bubble) { typeText(bubble, body.reply || ''); }
                    // No interim bubble to replace, so this one is born here — but
                    // it belongs to the turn that STARTED back when the guest
                    // asked, and its stored entry already carries that moment. Take
                    // the entry's time rather than the resolution's, or the title
                    // this paints and the title a reload paints would disagree.
                    else { typeText(addBubble('bot', '', pollEntries[path] && pollEntries[path].at), body.reply || ''); }
                    renderActions(body.actions, bubble, rendered);
                    // The server overwrote the same transcript row — so does the
                    // store: the interim's text and (already-stripped) actions
                    // give way to the final payload, found by the poll path
                    // because newer turns may sit after it by now.
                    var final = pollEntries[path];
                    if (final) {
                        delete pollEntries[path];
                        final.t = body.reply || '';
                        final.a = persistableActions(body.actions);
                        if (typeof body.turn === 'number' && isFinite(body.turn)) { final.n = body.turn; }
                        persist();
                    }
                    // The SECOND 'reply' for this turn, and deliberately so: the
                    // guest genuinely saw two answers land. `resolved` is what
                    // separates them — a host counting replies filters on it, and
                    // one counting async wait times reads latencyMs from here,
                    // which is the gated-booking number worth having. Measured
                    // from the poll's start (the interim), not the guest's send.
                    emit('reply', {
                        turn: (final && final.n) || (typeof body.turn === 'number' ? body.turn : null),
                        length: (body.reply || '').length,
                        elements: actionTypes(body.actions),
                        async: true,
                        resolved: true,
                        ended: ended,
                        latencyMs: Date.now() - startedAt
                    });
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
        // A composer growing towards its 180px max eats the transcript's height
        // from below and pushes content past the fold, firing no scroll event.
        syncScrollCue();
    }

    /* ---------------------------------------------------------- header menu */

    /*
     * The three-dots menu. Shaped on the language popover - aria-expanded on the
     * toggle, an open-state class on the container, stopPropagation on the
     * toggle's click, delegated handling resolved with closest(), and a close
     * path safe to call when already closed - with two of its habits dropped:
     *
     *   - NO auto-close timer. The language row squeezes the composer to make
     *     room for five flags, so it has to be transient. This dropdown takes
     *     room from nothing and stays until the guest dismisses it.
     *   - NO max-width clipping. That is a squeeze-in-place animation for a row
     *     inside a flex bar; this is an ordinary absolutely-positioned panel.
     *
     * THE CONFIRM. From the header this is reachable MID-CONVERSATION, which the
     * conversation_ended button never was: restartConversation() calls
     * clearStore() and wipes the body, so a guest eight turns into a booking
     * question who taps the wrong item loses the thread with no undo and no
     * warning. Two activations, and any dismissal reverts. That is the whole
     * reason it is a state change on the one item rather than a dialog - the
     * menu already handles its own dismissal, so there is no modal, no scrim, no
     * focus trap and no third document listener. The ended-state button stays
     * one-tap: that conversation is already dead, and there is nothing to
     * protect.
     */
    var menuConfirm = false;

    function isMenuOpen() { return els.headerControls.classList.contains('nc-menu-open'); }

    function closeHeaderMenu() {
        if (!isMenuOpen()) { return; }
        // The standing focus rule, for the SIXTH time in this repo - the teaser,
        // the carousel arrows, the prompt pills, the language row, the scroll
        // cue, and now this. The menu is display:none when closed, so an item
        // holding focus drops it to <body>, i.e. the top of the customer's page.
        // The toggle is always visible and is the way back in, so it is the
        // landing spot as well as the rescue.
        if (els.menu.contains(document.activeElement)) { els.menuToggle.focus(); }
        els.headerControls.classList.remove('nc-menu-open');
        els.menuToggle.setAttribute('aria-expanded', 'false');
        // EVERY dismissal runs through here - Escape, a click outside, a second
        // tap on the toggle, the panel closing - so a guest who backs out and
        // comes back can never find a primed "Yes" waiting for them.
        resetMenuConfirm();
    }

    function toggleHeaderMenu() {
        if (isMenuOpen()) { closeHeaderMenu(); return; }
        els.headerControls.classList.add('nc-menu-open');
        els.menuToggle.setAttribute('aria-expanded', 'true');
    }

    /*
     * textContent on the SAME node, never a replacement. The guest may be
     * standing on this button: changing an accessible name under focus is safe
     * and screen readers announce it, but swapping the node out would drop their
     * focus to <body> - the very rule closeHeaderMenu() exists to honour.
     */
    function armMenuConfirm() {
        menuConfirm = true;
        els.menuNewChat.textContent = t('newChatConfirm');
        els.menuNewChat.classList.add('nc-menu-item--confirm');
    }

    function resetMenuConfirm() {
        if (!menuConfirm) { return; }
        menuConfirm = false;
        els.menuNewChat.textContent = t('newChat');
        els.menuNewChat.classList.remove('nc-menu-item--confirm');
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
                // Never collapse a row the guest is standing in. The options are
                // clipped to max-width: 0 rather than display: none, so focus is
                // not reset to <body> here — it is stranded on an INVISIBLE
                // button instead, which is harder to recover from than losing it
                // outright.
                //
                // langOptions, not controls: .nc-controls also holds the composer,
                // and open() focuses that 320ms after every open — guarding on the
                // whole row would mean the timer never fires for anyone. The
                // options are the only nodes the collapse actually hides; the flag
                // toggle stays visible and stays focusable throughout, so a guest
                // who merely clicked it still gets the 4s timeout.
                if (els.langOptions.contains(document.activeElement)) { return; }
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
        var from = locale;
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
        // Only while the widget's OWN pack block is on screen — after the first
        // turn there is nothing to repaint, and the click handlers read their label
        // fresh anyway. Guarded on promptsLabel, not els.welcome: those are the
        // fields this branch actually dereferences, and it is null in exactly the
        // case that matters — a welcome built from the server's chips, whose
        // labels are payload strings, already server-localized, and must never be
        // repainted from a pack.
        if (els.promptsLabel) {
            els.promptsLabel.textContent = t('tryAsking');
            PROMPT_KEYS.forEach(function (key, i) {
                els.promptButtons[i].textContent = t(key);
            });
        }
        // The restart button is a live control like the pills, not frozen
        // transcript — its label follows the language switcher.
        if (els.restart) { els.restart.textContent = t('newChat'); }
        // Live controls too. The item reads its PRIMED state rather than the
        // pack alone: a guest who armed the confirm and then switched language
        // must not have it silently un-armed under them, which is what a bare
        // t('newChat') here would do.
        els.menuToggle.setAttribute('aria-label', t('menu'));
        els.menuNewChat.textContent = menuConfirm ? t('newChatConfirm') : t('newChat');
        // Day pills and bubble titles follow too, for the same reason and against
        // the same line: what stays frozen is PAYLOAD — reply text and server chip
        // labels, already localized upstream and not ours to repaint. These are
        // the widget's own strings, derived from a stored epoch, so re-deriving
        // them is the only way they can be right. The epoch travels on the node
        // itself rather than in a registry there would be nothing to keep in step
        // with: restartConversation() wipes the body and the bookkeeping with it.
        var stamped = els.body.querySelectorAll('[data-nc-at]');
        for (var si = 0; si < stamped.length; si++) {
            var node = stamped[si];
            var at = parseInt(node.getAttribute('data-nc-at'), 10);
            if (!isFinite(at)) { continue; }
            if (node.classList.contains('nc-day')) {
                var relabelled = dayLabel(dayKey(at));
                // Keep the old label rather than blanking a pill the guest can
                // see, on the same posture as the Intl guard that produced it.
                if (relabelled) { node.textContent = relabelled; }
            } else {
                stampBubble(node, at);
            }
        }
        els.panel.setAttribute('aria-label', 'Germán — ' + t('assistantRole'));
        // The one control whose label depends on state, not just on locale: it
        // reads "shrink" while the sheet is out.
        els.expand.setAttribute('aria-label', isExpanded() ? t('shrink') : t('expand'));
        // Both attributes: the tooltip is as visible to a pointer guest as the
        // accessible name is to a screen reader, and a stale tooltip in the old
        // language is exactly as wrong.
        els.cue.setAttribute('aria-label', t('scrollLatest'));
        els.cue.setAttribute('title', t('scrollLatest'));

        SUPPORTED.forEach(function (code2) {
            els.optionButtons[code2].classList.toggle('nc-hidden', code2 === locale);
        });

        // Only ever a real change — the guard at the top already returned for an
        // unsupported code or a re-selection of the current one, so a host
        // counting these is counting switches, not clicks.
        emit('locale', { from: from, to: locale });
    }

    /* ============================================================= boot ===== */

    function wire() {
        // WRAPPED, not passed by reference. addEventListener hands its handler a
        // MouseEvent as the first argument, and these three now take a `source`
        // string — pass the function bare and every open/close event reports its
        // source as a MouseEvent object, silently, while everything on screen
        // keeps working. oneOf() is the second half of that defence.
        els.toggler.addEventListener('click', function () { toggle('toggler'); });
        els.close.addEventListener('click', function () { close('close'); });
        // Hidden by CSS below 1024px, so this can never fire there.
        els.expand.addEventListener('click', function () {
            isExpanded() ? shrinkPanel(true) : expandPanel();
        });
        // stopPropagation for the reason .nc-lang-toggle needs it: without it
        // onDocumentClick would close the menu this very click just opened.
        els.menuToggle.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleHeaderMenu();
        });

        // Delegated and closest()-guarded, exactly as the langOptions listener
        // is - a click on the dropdown's padding must resolve to no item.
        els.menu.addEventListener('click', function (e) {
            e.stopPropagation();
            var item = e.target.closest ? e.target.closest('.nc-menu-item') : null;
            if (!item) { return; }
            // First activation primes and leaves the menu open. See the confirm
            // note on the header-menu block for why this is not a dialog.
            if (!menuConfirm) { armMenuConfirm(); return; }
            // Closed BEFORE the wipe, and that is what moves focus off the item
            // the wipe is about to hide. restartConversation()'s own rescue
            // tests els.body, and this item is in the HEADER, so that test is
            // false here and would never fire. Focus rests on the toggle across
            // the init round trip and lands on the composer from the restart's
            // own callback.
            closeHeaderMenu();
            restartConversation('menu');
        });

        els.teaserBody.addEventListener('click', function () { open('teaser'); });
        els.teaserClose.addEventListener('click', dismissTeaserForever);
        els.form.addEventListener('submit', submit);

        /*
         * THE CONVERSION EVENT. One delegated listener rather than a closure per
         * anchor: a replayed 40-turn transcript can carry dozens of CTAs, and
         * they are re-created on every replay. Every tagged anchor lives inside
         * els.body, so this covers link_button / booking_link / availability /
         * property_card / promo_card and any element type that tags one later.
         *
         * Inside #nest-chatbot, so teardown()'s two-listener claim is untouched.
         *
         * Fires on the click, never on a navigation outcome — a blocked popup or
         * a guest who backs out still counts as intent, which is what a CTA
         * measures. `.closest` guarded exactly as the langOptions listener does.
         */
        els.body.addEventListener('click', function (e) {
            var node = e.target && e.target.closest ? e.target.closest('[data-wchat-el]') : null;
            if (!node) { return; }
            var index = node.getAttribute('data-wchat-index');
            emit('action', {
                element: node.getAttribute('data-wchat-el'),
                channel: node.getAttribute('data-wchat-channel') || null,
                style: node.getAttribute('data-wchat-style') || null,
                index: index === null ? null : Number(index),
                // Present for http(s) CTAs and deliberately absent for contact
                // channels, whose href IS the property's phone number or email
                // (see channelLink) — the tag is set there without a url and
                // this reads what the node actually carries.
                url: node.getAttribute('data-wchat-channel') ? null : node.getAttribute('href')
            });
        });

        els.cue.addEventListener('click', function () {
            // Arming the follow is the whole point of the press mid-reply: without
            // it the typer grows past the fold again within eight characters and
            // the guest is pressing a button once a second to watch one answer.
            // It lasts until the reply ends (endStream) or they scroll back up.
            followStream = true;
            // Re-read per press, exactly as scrollByStep() does — the OS preference
            // can flip mid-session.
            var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            scrollToLatest(!reduced);
        });

        // One pending frame at a time, not one per event: a single flick fires
        // scroll dozens of times and each measurement below forces layout — the
        // same reason wireCarousel() coalesces its own.
        var cueFrame = 0;
        els.body.addEventListener('scroll', function () {
            if (cueFrame) { return; }
            cueFrame = window.requestAnimationFrame(function () {
                cueFrame = 0;
                onBodyScroll();
            });
        });

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
        closeHeaderMenu();   // its own guard makes this a no-op when already closed
    }

    function onDocumentKeydown(e) {
        if (e.key !== 'Escape') { return; }
        // The menu takes the key first and the PANEL STAYS OPEN: Escape
        // dismisses the innermost thing, which is what every menu does and what
        // a guest expects. This is the one thing in 2.10.2 a returning guest
        // could notice as different rather than new.
        //
        // focus() is stated rather than left to closeHeaderMenu()'s rescue -
        // that only fires when focus is INSIDE the menu, and a guest who opened
        // it and then pressed Escape from the composer should still land on the
        // control they opened.
        //
        // The language popover deliberately keeps the old behaviour (Escape
        // closes the panel; close() collapses the row on the way out). Changing
        // it is a second behaviour change nobody asked for.
        if (isMenuOpen()) { closeHeaderMenu(); els.menuToggle.focus(); return; }
        if (isOpen()) { close('escape'); els.toggler.focus(); return; }
        // Esc on the teaser means "not now", never "not ever": it hides the nudge
        // for this moment and writes no flag. Dismissing it for good stays the ✕
        // on the teaser itself — a deliberate act, not a reflex keystroke.
        if (teaserVisible) { hideTeaser(); }
    }

    function boot() {
        injectStyles();
        build();
        wire();

        // WRAPPED for the same reason wire() wraps its listeners: a host is free
        // to write `btn.addEventListener('click', NestChatbot.open)`, which would
        // hand `source` a MouseEvent. Exposing the wrapper means the ordinary
        // case reports 'api' instead of relying on oneOf() to catch it.
        window.NestChatbot = {
            version: VERSION,
            open: function () { open('api'); },
            close: function () { close('api'); },
            toggle: function () { toggle('api'); },
            destroy: teardown,
            setLocale: setLocale,
            get locale() { return locale; },
            // The events' picture, readable at any time — for a host whose
            // analytics booted after 'wchat:ready' fired, and for poking the
            // whole surface from the console.
            get state() { return snapshot(); }
        };

        // Before the auto-open check, so an auto-opened panel is already the right
        // size when it appears rather than snapping wider a frame later.
        //
        // Deliberately NOT gated on matchMedia('(min-width: 1024px)'): every
        // expanded rule lives inside that media query, so below 1024px the class
        // simply stops matching and the panel is the fullscreen one either way.
        // That is the same mechanism the shrink-on-narrow comment in
        // css/nest-chatbot.css relies on; a gate here would be a second source of
        // truth, free to disagree with the stylesheet.
        if (readFlag('localStorage', FLAG_EXPANDED)) { expandPanel(); }

        /*
         * THE RETURNING-GUEST SIGNAL, and the widget's denominator.
         *
         * Its own readStore(), because playIntro()'s is reached only when the
         * panel OPENS — a returning guest who never opens it would otherwise be
         * invisible, and "how many arrivals are returning" is the question that
         * started all of this. `resumed` answers the narrower one, from the
         * branch playIntro() actually takes.
         *
         * Emitted SYNCHRONOUSLY and before the auto-open check, not deferred to
         * a task: data-auto-open calls open() on this very tick, so a deferred
         * 'ready' would arrive AFTER its own 'open' and a host reading the stream
         * in order would see the widget open before it existed. The cost is that
         * a host <script> placed after ours misses the event — which is what
         * NestChatbot.state is for, and what any async-loaded tag (GTM, GA4)
         * would need anyway.
         */
        var stored = readStore();
        returning = !!stored;
        emit('ready', {
            version: VERSION,
            locale: locale,
            mock: USE_MOCK,
            returning: returning,
            storedTurns: (stored && stored.turns) ? stored.turns.length : 0,
            expanded: isExpanded()
        });

        if (cfg.autoOpen) { open('auto'); }
        // After the auto-open check: an auto-opened session has already written
        // the opened flag, so the teaser timer never arms.
        scheduleTeaser();
        log('booted', VERSION, { locale: locale, assetBase: assetBase, mock: USE_MOCK });
    }

    if (document.body) { boot(); }
    else { document.addEventListener('DOMContentLoaded', boot); }
})();
