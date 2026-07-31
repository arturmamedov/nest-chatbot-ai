/*!
 * wSuite (wChatbot) embeddable guest chat widget — plain JS, no dependencies,
 * no build step (D-004/MD-45). Drop-in:
 *
 *   <script src="https://<host>/chatbot/widget.js"
 *           data-key="ws_live_<prefix>.<secret>"
 *           data-locale="" data-color="#4f46e5" data-title="Chat with us"
 *           data-property="Duque Nest"
 *           defer></script>
 *
 * data-property (optional): the property name of the page embedding the widget —
 * seeds the conversation so turn-1 answers are scoped to that property.
 *
 * ES5-safe. Every guest/LLM string is rendered via textContent / created DOM
 * nodes — NEVER innerHTML — so a hostile reply cannot inject markup (XSS). The
 * API is reached with the public ws_live embed key; the conversation uuid is the
 * only identifier that ever leaves the server.
 */
(function () {
    'use strict';

    var script = document.currentScript;
    if (!script) { return; }

    var cfg = script.dataset || {};
    var apiKey = cfg.key;
    if (!apiKey) { return; }

    var base = '';
    try { base = new URL(script.src).origin; } catch (e) { base = ''; }

    var locale = (cfg.locale ? cfg.locale.slice(0, 2) : '') || (navigator.language || 'en').slice(0, 2);
    var color = cfg.color || '#4f46e5';
    var title = cfg.title || 'Chat with us';
    var property = cfg.property || null;

    var STORE_KEY = 'wsuite-chatbot:' + apiKey;
    var IDLE_MS = 24 * 60 * 60 * 1000; // O-9 — mirrors conversation.idle_hours

    // Async tool-turn poll cadence (D-037(f)) — hardcoded JS: a static, no-build,
    // ETag'd asset cannot read PHP config, and async_result carries only {type,url}.
    // 2s → 3s → 4.5s → 5s flat (≈ ≤14 polls/min steady-state); give up at 120s
    // (covers one full first job attempt incl. a 60s middleware release).
    var POLL_START_MS = 2000;
    var POLL_FACTOR = 1.5;
    var POLL_MAX_MS = 5000;
    var POLL_GIVE_UP_MS = 120000;

    // The response-contract version this widget was built against (O-40). The init
    // response reports the server's live `contract_version`; if it is higher, the
    // server ships an element/field we don't render yet — we warn ONCE and carry on
    // (the ignore-unknown rule keeps us fully functional; NEVER hard-fail). This is
    // the exact pattern the external nest-chatbot-ai widget copies.
    var BUILT_AGAINST = '1.5.0';

    // ---- state ---------------------------------------------------------------
    var conversationUuid = null;
    var started = false;   // a conversation exists this session
    var busy = false;      // a request is in flight
    var removed = false;   // widget torn down (403)
    var contractWarned = false; // contract-drift warning emitted once (O-40)
    var els = {};

    // ---- localStorage helpers -----------------------------------------------
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
        try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ uuid: uuid, ts: Date.now() })); } catch (e) { }
    }

    function clearStore() {
        try { window.localStorage.removeItem(STORE_KEY); } catch (e) { }
    }

    // ---- contract-version drift check (O-40) ---------------------------------
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

    // Warn ONCE when the server's contract_version is newer than BUILT_AGAINST: a
    // new element/field exists that this widget does not render yet. Forward-compat
    // still holds (unknown types are ignored), so this is advisory — never a fault.
    function checkContractVersion(serverVersion) {
        if (contractWarned || !serverVersion) { return; }
        if (compareVersions(serverVersion, BUILT_AGAINST) > 0) {
            contractWarned = true;
            if (window.console && console.warn) {
                console.warn('wSuite chatbot widget: server response contract ' + serverVersion +
                    ' is newer than this widget (built against ' + BUILT_AGAINST + '). ' +
                    'Unrecognised elements are ignored safely; update the widget to render them. ' +
                    'See the response-contract Changelog in your integration packet.');
            }
        }
    }

    // ---- transport (XHR — no Promise dependency) -----------------------------
    function post(path, body, done) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', base + path, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) { return; }
            var data = null;
            try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
            done(xhr.status, data);
        };
        try { xhr.send(JSON.stringify(body)); } catch (e) { done(0, null); }
    }

    // GET twin of post() for the async tool-turn poll — same Bearer header.
    function get(path, done) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', base + path, true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + apiKey);
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) { return; }
            var data = null;
            try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
            done(xhr.status, data);
        };
        try { xhr.send(); } catch (e) { done(0, null); }
    }

    // ---- DOM construction ----------------------------------------------------
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text != null) { node.textContent = text; }
        return node;
    }

    function injectStyles() {
        var css = [
            '.wsc-launcher{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;',
            'border:none;cursor:pointer;color:#fff;font-size:24px;line-height:56px;text-align:center;',
            'box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2147483000;background:' + color + '}',
            '.wsc-panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 40px);',
            'height:520px;max-height:calc(100vh - 120px);display:none;flex-direction:column;background:#fff;',
            'border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.28);z-index:2147483000;',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
            '.wsc-open{display:flex}',
            '.wsc-head{padding:14px 16px;color:#fff;font-weight:600;font-size:15px;display:flex;',
            'align-items:center;justify-content:space-between;background:' + color + '}',
            '.wsc-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}',
            '.wsc-body{flex:1;overflow-y:auto;padding:14px;background:#f6f7f9}',
            '.wsc-msg{max-width:80%;margin:6px 0;padding:9px 12px;border-radius:14px;font-size:14px;',
            'line-height:1.4;word-wrap:break-word;white-space:pre-wrap}',
            '.wsc-bot{background:#fff;color:#1f2430;border:1px solid #e6e8ec;border-bottom-left-radius:4px}',
            '.wsc-guest{background:' + color + ';color:#fff;margin-left:auto;border-bottom-right-radius:4px}',
            '.wsc-act{display:inline-block;margin:6px 0;padding:9px 14px;border-radius:10px;font-size:14px;',
            'font-weight:600;text-decoration:none;color:#fff;background:' + color + '}',
            '.wsc-chan{display:block;margin:4px 0;font-size:14px;color:' + color + ';text-decoration:none}',
            '.wsc-foot{display:flex;border-top:1px solid #e6e8ec;background:#fff}',
            '.wsc-in{flex:1;border:none;padding:12px 14px;font-size:14px;outline:none;resize:none;font-family:inherit}',
            '.wsc-send{border:none;background:none;color:' + color + ';font-weight:600;padding:0 16px;cursor:pointer;font-size:14px}',
            '.wsc-send:disabled{opacity:.4;cursor:default}',
            '.wsc-typing{display:inline-block}',
            '.wsc-typing span{display:inline-block;width:6px;height:6px;margin:0 1px;border-radius:50%;',
            'background:#b3b8c2;animation:wsc-blink 1.2s infinite}',
            '.wsc-typing span:nth-child(2){animation-delay:.2s}.wsc-typing span:nth-child(3){animation-delay:.4s}',
            '@keyframes wsc-blink{0%,60%,100%{opacity:.3}30%{opacity:1}}',
            '.wsc-cards{display:flex;gap:8px;overflow-x:auto;margin:6px 0;padding-bottom:4px}',
            '.wsc-card{flex:0 0 220px;background:#fff;border:1px solid #e6e8ec;border-radius:12px;overflow:hidden}',
            '.wsc-card img{display:block;width:100%;height:110px;object-fit:cover}',
            '.wsc-card-body{padding:10px 12px}',
            '.wsc-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;',
            'color:#fff;background:' + color + ';margin-bottom:6px}',
            '.wsc-card-name{font-size:14px;font-weight:600;color:#1f2430}',
            '.wsc-card-loc{font-size:12px;color:#6b7280;margin-top:2px}',
            '.wsc-card-price{font-size:13px;font-weight:600;color:#1f2430;margin-top:4px}',
            '.wsc-card-cta{display:block;text-align:center;margin-top:8px}',
            '.wsc-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',
            '.wsc-chip{padding:7px 12px;border-radius:999px;border:1px solid ' + color + ';background:none;',
            'color:' + color + ';font-size:13px;cursor:pointer;font-family:inherit}',
            '.wsc-promo{background:#fff;border:1px solid #e6e8ec;border-radius:12px;overflow:hidden;margin:6px 0;max-width:88%}',
            '.wsc-promo img{display:block;width:100%;height:100px;object-fit:cover}',
            '.wsc-promo-title{font-size:14px;font-weight:700;color:#1f2430;padding:10px 12px 0}',
            '.wsc-promo-body{font-size:13px;color:#3b4252;padding:4px 12px 0;line-height:1.4}',
            '.wsc-promo .wsc-act{margin:10px 12px 12px}'
        ].join('');
        var style = document.createElement('style');
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }

    function build() {
        var launcher = el('button', 'wsc-launcher', '💬'); // 💬
        launcher.setAttribute('type', 'button');
        launcher.setAttribute('aria-label', title);

        var panel = el('div', 'wsc-panel');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', title);

        var head = el('div', 'wsc-head');
        head.appendChild(el('span', null, title));
        var close = el('button', 'wsc-close', '×'); // ×
        close.setAttribute('type', 'button');
        close.setAttribute('aria-label', 'Close chat');
        head.appendChild(close);

        var body = el('div', 'wsc-body');
        body.setAttribute('aria-live', 'polite');

        var foot = el('div', 'wsc-foot');
        var input = el('input', 'wsc-in');
        input.setAttribute('type', 'text');
        input.setAttribute('aria-label', 'Type your message');
        input.setAttribute('placeholder', 'Type your message…');
        var send = el('button', 'wsc-send', 'Send');
        send.setAttribute('type', 'button');
        foot.appendChild(input);
        foot.appendChild(send);

        panel.appendChild(head);
        panel.appendChild(body);
        panel.appendChild(foot);

        document.body.appendChild(launcher);
        document.body.appendChild(panel);

        els = { launcher: launcher, panel: panel, body: body, input: input, send: send };

        launcher.addEventListener('click', toggle);
        close.addEventListener('click', toggle);
        send.addEventListener('click', submit);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
        });
    }

    // ---- rendering -----------------------------------------------------------
    function scrollDown() { els.body.scrollTop = els.body.scrollHeight; }

    function addBubble(role, text) {
        var node = el('div', 'wsc-msg ' + (role === 'guest' ? 'wsc-guest' : 'wsc-bot'), text);
        els.body.appendChild(node);
        scrollDown();
        return node;
    }

    function showTyping() {
        var wrap = el('div', 'wsc-msg wsc-bot');
        var dots = el('span', 'wsc-typing');
        dots.appendChild(el('span')); dots.appendChild(el('span')); dots.appendChild(el('span'));
        wrap.appendChild(dots);
        els.body.appendChild(wrap);
        scrollDown();
        return wrap;
    }

    function digits(value) { return (value || '').replace(/[^0-9]/g, ''); }

    // Element-supplied link urls (booking_url / website / availability deep-link)
    // are honoured ONLY for http(s); anything else -- javascript:/data:, or a scheme
    // hidden behind leading whitespace/control chars -- fails the test and is dropped.
    // Defence in depth (the urls are code-emitted from the DB, never the LLM);
    // tel:/mailto:/wa.me hrefs are built by the widget, so they stay safe.
    function safeHttpUrl(url) {
        if (typeof url !== 'string') { return null; }
        return /^\s*https?:\/\//i.test(url) ? url : null;
    }

    // The versioned response contract (modules/chatbot/docs/response-contract.md):
    // iterate the typed actions[] list, one renderer branch per element `type`.
    // A new rich type = one new branch here + one Element class server-side + a
    // server-side contract version bump and Changelog row (see response-contract.md).
    // The pre-scan collects every property_cards item url so the Book-button
    // branches can dedupe against a card CTA in the same list (D-043(c)).
    function renderActions(actions, botBubble) {
        if (!actions || !actions.length) { return; }
        var cardUrls = Object.create(null);
        for (var i = 0; i < actions.length; i++) {
            var a = actions[i];
            if (a && a.type === 'property_cards' && a.items && a.items.length) {
                for (var j = 0; j < a.items.length; j++) {
                    if (a.items[j] && typeof a.items[j].url === 'string') { cardUrls[a.items[j].url] = true; }
                }
            }
        }
        for (var k = 0; k < actions.length; k++) { renderAction(actions[k], botBubble, cardUrls); }
    }

    function renderAction(action, botBubble, cardUrls) {
        if (!action || !action.type) { return; }

        // Async tool turn (D-037(f)): the final reply is generated off-request;
        // poll for it. `botBubble` is the interim reply node to replace in place.
        if (action.type === 'async_result' && action.url) {
            pollResult(action.url, botBubble);
            return;
        }

        if (action.type === 'link_button') {
            if (cardUrls && cardUrls[action.url]) { return; } // a card in this list carries the same CTA (D-043(c))
            linkButton(action.label, action.url);
            return;
        }

        if (action.type === 'booking_link') {
            if (cardUrls && cardUrls[action.url]) { return; } // same dedupe rule
            linkButton('Book now →', action.url);
            return;
        }

        if (action.type === 'availability' && action.url) {
            linkButton('Book now →', action.url);
            return;
        }

        if (action.type === 'property_cards') {
            propertyCards(action);
            return;
        }

        if (action.type === 'promo_card') {
            promoCard(action);
            return;
        }

        if (action.type === 'quick_replies') {
            quickReplies(action);
            return;
        }

        if (action.type === 'contact_channels') {
            if (action.phone) { channelLink('Call ' + action.phone, 'tel:' + digits(action.phone)); }
            if (action.whatsapp) { channelLink('WhatsApp', 'https://wa.me/' + digits(action.whatsapp)); }
            if (action.email) { channelLink('Email ' + action.email, 'mailto:' + action.email); }
        }
    }

    // property_cards (contract 1.5.0): a horizontally scrollable rail of catalog
    // cards. Every string lands via textContent; image/CTA urls pass safeHttpUrl
    // or the card part is dropped (no url → no card at all: the CTA is mandatory).
    function propertyCards(action) {
        if (!action.items || !action.items.length) { return; }
        var rail = el('div', 'wsc-cards');
        for (var i = 0; i < action.items.length; i++) {
            var item = action.items[i];
            if (!item || typeof item.name !== 'string' || !item.name) { continue; }
            var href = safeHttpUrl(item.url);
            if (!href) { continue; }
            var card = el('div', 'wsc-card');
            var img = safeHttpUrl(item.image);
            if (img) {
                var image = el('img');
                image.setAttribute('src', img);
                image.setAttribute('alt', item.name);
                image.setAttribute('loading', 'lazy');
                image.setAttribute('referrerpolicy', 'no-referrer');
                card.appendChild(image);
            }
            var body = el('div', 'wsc-card-body');
            if (typeof item.badge === 'string' && item.badge) { body.appendChild(el('span', 'wsc-badge', item.badge)); }
            body.appendChild(el('div', 'wsc-card-name', item.name));
            if (typeof item.location === 'string' && item.location) { body.appendChild(el('div', 'wsc-card-loc', item.location)); }
            if (item.price_from && item.price_from.amount) {
                body.appendChild(el('div', 'wsc-card-price',
                    'From ' + item.price_from.amount + (item.price_from.currency ? ' ' + item.price_from.currency : '')));
            }
            var cta = el('a', 'wsc-act wsc-card-cta', 'Book now →');
            cta.setAttribute('href', href);
            cta.setAttribute('target', '_blank');
            cta.setAttribute('rel', 'noopener noreferrer');
            body.appendChild(cta);
            card.appendChild(body);
            rail.appendChild(card);
        }
        if (rail.firstChild) { els.body.appendChild(rail); scrollDown(); }
    }

    // promo_card (contract 1.5.0): a tenant-authored promotional block. The
    // `style` hint is honoured only as a whitelisted class suffix — never raw.
    function promoCard(action) {
        if (typeof action.title !== 'string' || !action.title) { return; }
        var box = el('div', 'wsc-promo');
        if (typeof action.style === 'string' && /^[a-z-]+$/.test(action.style)) {
            box.className += ' wsc-promo-' + action.style;
        }
        var img = safeHttpUrl(action.image);
        if (img) {
            var image = el('img');
            image.setAttribute('src', img);
            image.setAttribute('alt', action.title);
            image.setAttribute('loading', 'lazy');
            image.setAttribute('referrerpolicy', 'no-referrer');
            box.appendChild(image);
        }
        box.appendChild(el('div', 'wsc-promo-title', action.title));
        if (typeof action.body === 'string' && action.body) { box.appendChild(el('div', 'wsc-promo-body', action.body)); }
        if (action.cta && typeof action.cta.label === 'string' && action.cta.label) {
            var href = safeHttpUrl(action.cta.url);
            if (href) {
                var cta = el('a', 'wsc-act', action.cta.label);
                cta.setAttribute('href', href);
                cta.setAttribute('target', '_blank');
                cta.setAttribute('rel', 'noopener noreferrer');
                box.appendChild(cta);
            }
        }
        els.body.appendChild(box);
        scrollDown();
    }

    // quick_replies (contract 1.5.0): tap-to-send chips. A chip carries NO url —
    // tapping sends its `message` down the exact normal-turn path (the sent text
    // shows as a guest bubble: honest transcript). The row is one-shot.
    function quickReplies(action) {
        if (!action.items || !action.items.length) { return; }
        var row = el('div', 'wsc-chips');
        for (var i = 0; i < action.items.length; i++) {
            (function (item) {
                if (!item || typeof item.label !== 'string' || !item.label
                    || typeof item.message !== 'string' || !item.message) { return; }
                var chip = el('button', 'wsc-chip', item.label);
                chip.setAttribute('type', 'button');
                chip.addEventListener('click', function () {
                    if (busy || removed) { return; }
                    if (row.parentNode) { row.parentNode.removeChild(row); }
                    addBubble('guest', item.message);
                    ensureConversation(function () { sendMessage(item.message, false); });
                });
                row.appendChild(chip);
            })(action.items[i]);
        }
        if (row.firstChild) { els.body.appendChild(row); scrollDown(); }
    }

    function linkButton(label, url) {
        var href = safeHttpUrl(url);
        if (!href) { return; }
        var link = el('a', 'wsc-act', label || 'Open'); // label via textContent — never markup
        link.setAttribute('href', href); // set as attribute — never interpolated into markup
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        els.body.appendChild(link);
        scrollDown();
    }

    function channelLink(label, href) {
        var a = el('a', 'wsc-chan', label);
        a.setAttribute('href', href);
        a.setAttribute('rel', 'noopener noreferrer');
        els.body.appendChild(a);
        scrollDown();
    }

    // ---- flow ----------------------------------------------------------------
    function toggle() {
        if (removed) { return; }
        var open = els.panel.className.indexOf('wsc-open') === -1;
        els.panel.className = open ? 'wsc-panel wsc-open' : 'wsc-panel';
        if (open) {
            ensureConversation(function () { els.input.focus(); });
        }
    }

    function ensureConversation(cb) {
        if (started && conversationUuid) { cb(); return; }
        var stored = readStore();
        if (stored) { conversationUuid = stored; started = true; cb(); return; }
        startConversation(cb);
    }

    function startConversation(cb) {
        if (busy) { return; }
        busy = true;
        post('/api/v1/chatbot/conversations', { locale: locale, property: property }, function (status, data) {
            busy = false;
            if (status === 403) { teardown(); return; }
            if (status === 429) { addBubble('bot', retryText()); return; }
            if (status !== 201 || !data || !data.conversation) { addBubble('bot', errorText()); return; }

            conversationUuid = data.conversation.uuid;
            started = true;
            writeStore(conversationUuid);
            checkContractVersion(data.contract_version);
            if (data.greeting) { addBubble('bot', data.greeting); }
            renderActions(data.actions); // init actions since 1.5.0 (quick prompts / promo); absent on older servers
            cb();
        });
    }

    function submit() {
        if (busy || removed) { return; }
        var text = (els.input.value || '').trim();
        if (!text) { return; }
        els.input.value = '';
        addBubble('guest', text);
        ensureConversation(function () { sendMessage(text, false); });
    }

    function sendMessage(text, isRetry) {
        if (!conversationUuid) { return; }
        busy = true;
        els.send.disabled = true;
        var typing = showTyping();

        post('/api/v1/chatbot/conversations/' + encodeURIComponent(conversationUuid) + '/messages',
            { message: text },
            function (status, data) {
                busy = false;
                els.send.disabled = false;
                if (typing.parentNode) { typing.parentNode.removeChild(typing); }

                if (status === 200 && data) {
                    var botBubble = data.reply ? addBubble('bot', data.reply) : null;
                    renderActions(data.actions, botBubble);
                    return;
                }
                // 410 = idled out, 404 = the conversation is gone (pruned, or a uuid
                // this deployment no longer knows). Both mean "this stored uuid is
                // dead" on the TURN endpoint, so both re-init transparently and
                // resend once — without clearing the store, a stale uuid would wedge
                // this browser for the full 24h retention window. (On the POLL
                // endpoint a 404 is transient instead — see pollResult.)
                if ((status === 410 || status === 404) && !isRetry) {
                    clearStore();
                    conversationUuid = null;
                    started = false;
                    startConversation(function () { sendMessage(text, true); });
                    return;
                }
                if (status === 403) { teardown(); return; }
                if (status === 429) { addBubble('bot', retryText()); return; }
                addBubble('bot', errorText());
            });
    }

    function teardown() {
        removed = true;
        if (els.panel && els.panel.parentNode) { els.panel.parentNode.removeChild(els.panel); }
        if (els.launcher && els.launcher.parentNode) { els.launcher.parentNode.removeChild(els.launcher); }
    }

    function retryText() { return 'We’re getting a lot of messages right now — please try again in a moment.'; }
    function errorText() { return 'Sorry, something went wrong. Please try again, or reach us directly and we’ll be glad to help.'; }
    function timeoutText() { return 'This is taking longer than expected — please use the booking link above, or ask me again in a moment.'; }

    // ---- async tool-turn poll (D-037(f)) -------------------------------------
    // Poll the relative turn-result path (resolved against the widget's OWN
    // origin — the Bearer key never leaves it) until the final reply is ready,
    // then replace the interim bubble in place. Accepts ONLY a relative path.
    function pollResult(path, botBubble) {
        if (typeof path !== 'string' || path.charAt(0) !== '/') { return; }

        var started = Date.now();
        var delay = POLL_START_MS;

        function schedule() {
            if ((Date.now() - started) >= POLL_GIVE_UP_MS) {
                // The interim's fallbacks are already rendered — the guest is never
                // stranded; just note the delay.
                addBubble('bot', timeoutText());
                return;
            }
            setTimeout(tick, delay);
            delay = Math.min(POLL_MAX_MS, Math.round(delay * POLL_FACTOR));
        }

        function tick() {
            if (removed) { return; }
            get(path, function (status, data) {
                if (status === 403) { teardown(); return; }
                if (status === 410) { return; } // conversation gone — stop

                if (status === 200 && data && (data.status === 'ready' || data.status === 'failed')) {
                    // Replace the interim bubble's text in place (the server
                    // overwrote the same transcript row), then render final actions.
                    if (botBubble) { botBubble.textContent = data.reply || ''; }
                    else { addBubble('bot', data.reply || ''); }
                    renderActions(data.actions);
                    scrollDown();
                    return;
                }

                // pending / 404 / 429 / network / unparseable body → transient: back off.
                schedule();
            });
        }

        schedule();
    }

    // ---- boot ----------------------------------------------------------------
    function boot() { injectStyles(); build(); }

    if (document.body) { boot(); }
    else { document.addEventListener('DOMContentLoaded', boot); }
})();
