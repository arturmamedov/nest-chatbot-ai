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
    var BUILT_AGAINST = '1.6.2';

    // ---- state ---------------------------------------------------------------
    var conversationUuid = null;
    var started = false;   // a conversation exists this session
    var busy = false;      // a request is in flight
    var removed = false;   // widget torn down (403)
    var contractWarned = false; // contract-drift warning emitted once (O-40)
    var chipRows = [];     // live quick_replies rows — retired on any send (1.6.0)
    var ended = false;     // conversation_ended received — composer closed (1.6.0)
    // The welcome the server sent when THIS conversation began. Held in state
    // because the resume path below never reaches the server and has nowhere
    // else to get it from — see readStore().
    var introGreeting = null;
    var introActions = null;
    var els = {};

    // ---- localStorage helpers -----------------------------------------------
    // Hands back the OBJECT, never a bare uuid. A guest returning inside the idle
    // window resumes without ever calling the init endpoint, so the greeting and
    // the site's welcome elements — its configured quick_prompts, its show_at_init
    // promo — have nowhere else to come from; before this they were simply lost for
    // the rest of the window, and the panel came back empty. Replaying a stored
    // payload is safe for the same reason replaying one off the wire is: it goes
    // back through the same renderers, and those treat every payload string as
    // untrusted already (textContent, safeHttpUrl, never innerHTML).
    //
    // Accepted cost: the welcome can be up to IDLE_MS stale. These are site
    // settings rather than conversation state, so the worst case is a returning
    // guest reading yesterday's promo copy until the conversation expires.
    function readStore() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (!raw) { return null; }
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.uuid || !parsed.ts) { return null; }
            if ((Date.now() - parsed.ts) > IDLE_MS) { return null; }
            // Anything malformed degrades to "no welcome", never throws, and above
            // all never costs the guest the conversation the record also holds.
            return {
                uuid: parsed.uuid,
                greeting: typeof parsed.greeting === 'string' ? parsed.greeting : null,
                actions: (Array.isArray(parsed.actions) && parsed.actions.length) ? parsed.actions : null
            };
        } catch (e) { return null; }
    }

    // `ts` means LAST ACTIVITY, which is what the server's conversation.idle_hours
    // measures (O-9). Written once at init it would expire a still-active chat
    // client-side at hour 25 under a conversation the server considers live, so
    // every turn re-stamps it.
    function writeStore(uuid) {
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify({
                uuid: uuid, ts: Date.now(), greeting: introGreeting, actions: introActions
            }));
        } catch (e) {}
    }

    function clearStore() {
        try { window.localStorage.removeItem(STORE_KEY); } catch (e) {}
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
            // pre-wrap: promo body MAY carry newlines (contract 1.6.0) — a tenant's
            // two-line offer must stay two lines, as the reply bubble already does.
            '.wsc-promo-body{font-size:13px;color:#3b4252;padding:4px 12px 0;line-height:1.4;white-space:pre-wrap}',
            '.wsc-promo .wsc-act{margin:10px 12px 12px}',
            // `highlight` is the ONLY style value the contract documents, and it
            // means "the tenant's primary offer — give it more visual weight".
            '.wsc-promo-highlight{border-color:' + color + ';border-left-width:3px}',
            '.wsc-restart{border:none;cursor:pointer;font-family:inherit}'
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

    // EVERY element-supplied url and image is honoured ONLY for http(s): the
    // catalog links (booking_url / website / map_url / availability deep-link),
    // property_cards item url + image + the element-level more.url, and the
    // TENANT-AUTHORED promo_card image + cta.url. Anything else -- javascript:,
    // data:, or a scheme hidden behind leading whitespace/control chars -- fails
    // the test and is dropped. Most of these are code-emitted from the DB (defence
    // in depth), but the promo pair is authored in site settings and is the reason
    // this gate is a requirement rather than a belt-and-braces check.
    // tel:/mailto:/wa.me hrefs are built by the widget, so they stay safe.
    function safeHttpUrl(url) {
        if (typeof url !== 'string') { return null; }
        return /^\s*https?:\/\//i.test(url) ? url : null;
    }

    // A card item renders only when it has a name AND an http(s) url — the same
    // gate propertyCards() applies. Returns that url, or null when the item will
    // be dropped: the dedupe pre-scan MUST agree with what actually reaches the
    // DOM, or a card rejected here would silently suppress the guest's only Book
    // button (response-contract.md, the D-043(c) dedupe rule).
    function renderableCardUrl(item) {
        if (!item || typeof item.name !== 'string' || !item.name) { return null; }
        return safeHttpUrl(item.url);
    }

    // The versioned response contract (modules/chatbot/docs/response-contract.md):
    // iterate the typed actions[] list, one renderer branch per element `type`.
    // A new rich type = one new branch here + one Element class server-side + a
    // server-side contract version bump and Changelog row (see response-contract.md).
    // The pre-scan collects the url of every RENDERABLE property_cards item so the
    // Book-button branch can dedupe against a card CTA in the same list (D-043(c)).
    // `rendered` (optional) accumulates every url this turn actually anchored, so a
    // later poll resolution can skip one it already showed (1.6.0).
    function renderActions(actions, botBubble, rendered) {
        if (!actions || !actions.length) { return; }
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
        for (var k = 0; k < actions.length; k++) { renderAction(actions[k], botBubble, cardUrls, rendered); }
    }

    function renderAction(action, botBubble, cardUrls, rendered) {
        if (!action || !action.type) { return; }

        // Async tool turn (D-037(f)): the final reply is generated off-request;
        // poll for it. `botBubble` is the interim reply node to replace in place,
        // and `rendered` carries this turn's already-anchored urls so the final
        // actions[] -- which is ADDITIVE to what we drew here -- can skip a repeat.
        if (action.type === 'async_result' && action.url) {
            pollResult(action.url, botBubble, rendered);
            return;
        }

        if (action.type === 'link_button') {
            if (cardUrls && cardUrls[action.url]) { return; } // a card in this list carries the same CTA (D-043(c))
            linkButton(action.label, action.url, rendered);
            return;
        }

        if (action.type === 'booking_link') {
            if (cardUrls && cardUrls[action.url]) { return; } // same dedupe rule
            linkButton('Book now →', action.url, rendered);
            return;
        }

        // A poll's availability url falls back to the property's booking_url, which
        // the interim turn already anchored as booking_link -- so without this check
        // the guest ends up with two identical Book buttons (1.6.0).
        if (action.type === 'availability' && action.url) {
            if (rendered && rendered[action.url]) { return; }
            linkButton('Book now →', action.url, rendered);
            return;
        }

        if (action.type === 'property_cards') {
            propertyCards(action, rendered);
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

        // The turn cap (1.6.0): this conversation accepts no further turns. The
        // element carries no visual payload — `reply` already told the guest —
        // so all we add is the one thing that still works: a new conversation.
        if (action.type === 'conversation_ended') {
            endConversation();
            return;
        }

        if (action.type === 'contact_channels') {
            if (action.phone) { channelLink('Call ' + action.phone, 'tel:' + digits(action.phone)); }
            if (action.whatsapp) { channelLink('WhatsApp', 'https://wa.me/' + digits(action.whatsapp)); }
            if (action.email) { channelLink('Email ' + action.email, 'mailto:' + action.email); }
        }
    }

    // The from-price line. `period`/`basis` (1.6.0) are OPTIONAL and absent unless
    // the tenant declared them -- when they are, never invent a period: a bare
    // "From €22" is honest, "From €22/night" on a per-stay price is not.
    function priceLine(price) {
        var text = 'From ' + price.amount + (price.currency ? ' ' + price.currency : '');
        if (price.period === 'night') { text += ' / night'; }
        else if (price.period === 'stay') { text += ' / stay'; }
        if (price.basis === 'per_person') { text += ' per person'; }
        else if (price.basis === 'per_unit') { text += ' per unit'; }
        return text;
    }

    // property_cards (contract 1.5.0, extended 1.6.0): a horizontally scrollable
    // rail of catalog cards. Every string lands via textContent; image/CTA urls
    // pass safeHttpUrl or the card part is dropped (no url → no card at all: the
    // CTA is mandatory). `total`/`more` drive the overflow affordance so a capped
    // rail no longer silently loses the rest of the catalog.
    function propertyCards(action, rendered) {
        if (!action.items || !action.items.length) { return; }
        var rail = el('div', 'wsc-cards');
        // A labelled LIST, not a slideshow: the cards are peers and every CTA is
        // reachable by keyboard in order. `aria-live="off"` because the whole
        // .wsc-body is a polite live region — without this the rail announces
        // itself over the reply it accompanies (contract → Accessibility).
        rail.setAttribute('role', 'list');
        rail.setAttribute('aria-label', 'Properties');
        rail.setAttribute('aria-live', 'off');
        var shown = 0;
        for (var i = 0; i < action.items.length; i++) {
            var item = action.items[i];
            var href = renderableCardUrl(item);
            if (!href) { continue; }
            var card = el('div', 'wsc-card');
            card.setAttribute('role', 'listitem');
            var img = safeHttpUrl(item.image);
            if (img) {
                var image = el('img');
                image.setAttribute('src', img);
                // Decorative by default: the card name below already carries the
                // meaning, so reusing it here makes a screen reader say it twice.
                // image_alt is only set when the catalog image means something more.
                image.setAttribute('alt', typeof item.image_alt === 'string' ? item.image_alt : '');
                image.setAttribute('loading', 'lazy');
                image.setAttribute('referrerpolicy', 'no-referrer');
                card.appendChild(image);
            }
            var body = el('div', 'wsc-card-body');
            if (typeof item.badge === 'string' && item.badge) { body.appendChild(el('span', 'wsc-badge', item.badge)); }
            body.appendChild(el('div', 'wsc-card-name', item.name));
            if (typeof item.location === 'string' && item.location) { body.appendChild(el('div', 'wsc-card-loc', item.location)); }
            if (item.price_from && item.price_from.amount) {
                body.appendChild(el('div', 'wsc-card-price', priceLine(item.price_from)));
            }
            // cta_label is server-localized (1.6.0) — prefer it over our English default.
            var cta = el('a', 'wsc-act wsc-card-cta',
                (typeof item.cta_label === 'string' && item.cta_label) ? item.cta_label : 'Book now →');
            cta.setAttribute('href', href);
            cta.setAttribute('target', '_blank');
            cta.setAttribute('rel', 'noopener noreferrer');
            body.appendChild(cta);
            card.appendChild(body);
            rail.appendChild(card);
            if (rendered) { rendered[href] = true; }
            shown++;
        }
        if (!rail.firstChild) { return; }
        els.body.appendChild(rail);

        var moreUrl = action.more ? safeHttpUrl(action.more.url) : null;
        if (moreUrl && typeof action.more.label === 'string' && action.more.label) {
            linkButton(action.more.label, moreUrl, rendered);   // label is server-localized
        } else if (typeof action.total === 'number' && action.total > shown) {
            els.body.appendChild(el('div', 'wsc-card-loc', 'Showing ' + shown + ' of ' + action.total + '.'));
        }
        scrollDown();
    }

    // The `style` values this renderer knows how to present. `highlight` is the
    // only one the platform documents; an unrecognised value must fall back to
    // default styling rather than reach the DOM as a class we have no rule for.
    var PROMO_STYLES = { highlight: true };

    // promo_card (contract 1.5.0, extended 1.6.0): a tenant-authored promotional
    // block. `style` is honoured only as a whitelisted class suffix — never raw.
    //
    // title / body / cta{label,url} are all REQUIRED, so a payload missing any of
    // them gets the whole element dropped (the contract's fail-closed rule): a
    // promo whose CTA we cannot anchor is an advert with no way to act on it.
    // SiteContentElements already rejects such a promo server-side, so this is
    // defence in depth against a non-reference producer, not a live bug.
    function promoCard(action) {
        var href = action.cta ? safeHttpUrl(action.cta.url) : null;
        if (typeof action.title !== 'string' || !action.title
            || typeof action.body !== 'string' || !action.body
            || !action.cta || typeof action.cta.label !== 'string' || !action.cta.label
            || !href) { return; }

        var box = el('div', 'wsc-promo');
        // A region named by its title, and NOT a live region: the reply bubble is
        // the one thing that announces (contract → Accessibility).
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', action.title);
        box.setAttribute('aria-live', 'off');
        // `style` is tenant-supplied, so match it against OUR OWN known list and
        // degrade anything else to default styling — never emit an unknown class
        // (contract → "The style hint"). `=== true` keeps inherited Object
        // members (`constructor`, `toString`) from passing the lookup.
        if (typeof action.style === 'string' && PROMO_STYLES[action.style] === true) {
            box.className += ' wsc-promo-' + action.style;
        }
        // Tenant copy is not necessarily in the guest's language (contract 1.6.0
        // reports which one it IS), so mark it up or a screen reader reads Spanish
        // with an English voice.
        if (typeof action.locale === 'string' && /^[a-z]{2}$/.test(action.locale)) {
            box.setAttribute('lang', action.locale);
        }
        var img = safeHttpUrl(action.image);
        if (img) {
            var image = el('img');
            image.setAttribute('src', img);
            image.setAttribute('alt', ''); // decorative — the title below carries the meaning
            image.setAttribute('loading', 'lazy');
            image.setAttribute('referrerpolicy', 'no-referrer');
            box.appendChild(image);
        }
        box.appendChild(el('div', 'wsc-promo-title', action.title));
        box.appendChild(el('div', 'wsc-promo-body', action.body));
        var cta = el('a', 'wsc-act', action.cta.label);
        cta.setAttribute('href', href);
        cta.setAttribute('target', '_blank');
        cta.setAttribute('rel', 'noopener noreferrer');
        box.appendChild(cta);
        els.body.appendChild(box);
        scrollDown();
    }

    // A chip row belongs to the turn it arrived on, so ANY send — a chip tap or a
    // typed message — retires EVERY row on screen, not just the tapped one (the
    // contract's one-shot rule, made precise at 1.6.0). Not restored on a failed
    // turn: the guest's message is already in the transcript and can be retyped,
    // whereas a restored row invites a double send.
    function retireChipRows() {
        var hadFocus = false;
        for (var i = 0; i < chipRows.length; i++) {
            var row = chipRows[i];
            // Checked BEFORE removal: tearing out the row a keyboard or switch
            // user is standing in would drop focus to <body>. Move it somewhere
            // sensible instead (contract → Accessibility).
            if (row.contains(document.activeElement)) { hadFocus = true; }
            if (row.parentNode) { row.parentNode.removeChild(row); }
        }
        chipRows = [];
        if (hadFocus && els.input && !els.input.disabled) { els.input.focus(); }
    }

    // quick_replies (contract 1.5.0): tap-to-send chips. A chip carries NO url —
    // tapping sends its `message` down the exact normal-turn path (the sent text
    // shows as a guest bubble: honest transcript).
    function quickReplies(action) {
        if (!action.items || !action.items.length) { return; }
        var row = el('div', 'wsc-chips');
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', 'Suggested questions');
        row.setAttribute('aria-live', 'off'); // announced by the reply, not by itself
        // Tenant-authored labels may be in the tenant's language, not the guest's;
        // the island_choice row omits `locale` because its labels are proper nouns.
        if (typeof action.locale === 'string' && /^[a-z]{2}$/.test(action.locale)) {
            row.setAttribute('lang', action.locale);
        }
        for (var i = 0; i < action.items.length; i++) {
            (function (item) {
                if (!item || typeof item.label !== 'string' || !item.label
                    || typeof item.message !== 'string' || !item.message) { return; }
                var chip = el('button', 'wsc-chip', item.label);
                chip.setAttribute('type', 'button');
                chip.addEventListener('click', function () {
                    if (busy || removed || ended) { return; }
                    retireChipRows();
                    addBubble('guest', item.message);
                    ensureConversation(function () { sendMessage(item.message, false); });
                });
                row.appendChild(chip);
            })(action.items[i]);
        }
        if (row.firstChild) { els.body.appendChild(row); chipRows.push(row); scrollDown(); }
    }

    function linkButton(label, url, rendered) {
        var href = safeHttpUrl(url);
        if (!href) { return; }
        var link = el('a', 'wsc-act', label || 'Open'); // label via textContent — never markup
        link.setAttribute('href', href); // set as attribute — never interpolated into markup
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        els.body.appendChild(link);
        if (rendered) { rendered[href] = true; }
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
        if (stored) {
            conversationUuid = stored.uuid;
            started = true;
            introGreeting = stored.greeting;
            introActions = stored.actions;
            // Paint the welcome only onto an empty transcript. This branch is
            // reached from panel-open, but submit() draws the guest bubble BEFORE
            // it calls us, and a welcome block under a message the guest has
            // already sent is not a first-contact affordance any more.
            if (!els.body.firstChild) {
                if (introGreeting) { addBubble('bot', introGreeting); }
                renderActions(introActions);
            }
            cb();
            return;
        }
        startConversation(cb);
    }

    // `silent` suppresses the greeting + init actions: the 410/404 recovery path
    // opens a replacement conversation MID-SEND, and drawing a second greeting
    // (plus a promo and a chip row the guest has already moved past) after the
    // message they just sent is not the "transparent re-init" the guide promises.
    // The new conversation is still fully established — uuid, store, version check.
    function startConversation(cb, silent) {
        if (busy) { return; }
        busy = true;
        post('/api/v1/chatbot/conversations', { locale: locale, property: property }, function (status, data) {
            busy = false;
            if (status === 403) { teardown(); return; }
            if (status === 429) { addBubble('bot', retryText()); return; }
            if (status !== 201 || !data || !data.conversation) { addBubble('bot', errorText()); return; }

            conversationUuid = data.conversation.uuid;
            started = true;
            // Settled BEFORE writeStore, which serializes them: the resume branch is
            // the only other reader and it needs the same values this load renders.
            // Stored even when `silent` — the guest is not shown them now, but the
            // replacement conversation is theirs for the next 24h and its next page
            // load should open with its welcome, not with nothing.
            introGreeting = data.greeting || null;
            introActions = (data.actions && data.actions.length) ? data.actions : null;
            writeStore(conversationUuid);
            checkContractVersion(data.contract_version);
            if (!silent) {
                if (introGreeting) { addBubble('bot', introGreeting); }
                renderActions(introActions); // init actions since 1.5.0 (quick prompts / promo); absent on older servers
            }
            cb();
        });
    }

    // conversation_ended (contract 1.6.0): the turn cap is reached, so close the
    // composer — every further message would return the same canned reply — and
    // offer the only thing that still works. The transcript is cleared on restart
    // because the new conversation shares no memory with the old one; keeping the
    // old exchange on screen implies a continuity the server does not have.
    function endConversation() {
        if (ended || removed) { return; }
        ended = true;
        retireChipRows();
        els.input.disabled = true;
        els.send.disabled = true;

        var restart = el('button', 'wsc-act wsc-restart', 'Start a new chat');
        restart.setAttribute('type', 'button');
        restart.addEventListener('click', function () {
            clearStore();
            conversationUuid = null;
            started = false;
            ended = false;
            chipRows = [];
            els.body.textContent = '';          // drops every child node — never innerHTML
            els.input.disabled = false;
            els.send.disabled = false;
            startConversation(function () { els.input.focus(); });
        });
        els.body.appendChild(restart);
        scrollDown();
    }

    function submit() {
        if (busy || removed || ended) { return; }
        var text = (els.input.value || '').trim();
        if (!text) { return; }
        els.input.value = '';
        retireChipRows();   // typing instead of tapping retires the chips too (1.6.0)
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
                    writeStore(conversationUuid);   // re-stamp ts — see writeStore()
                    var botBubble = data.reply ? addBubble('bot', data.reply) : null;
                    // Per-turn url set: an async turn's poll actions[] is additive to
                    // what we draw now, so it needs to know what is already on screen.
                    renderActions(data.actions, botBubble, Object.create(null));
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
                    startConversation(function () { sendMessage(text, true); }, true);
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
    function pollResult(path, botBubble, rendered) {
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
                // 410 = the conversation that owns this turn is gone, so its result
                // is no longer worth fetching. Stop, keep the interim reply and its
                // fallbacks, and re-init NOTHING: the guest's next message hits the
                // turn endpoint, gets its own 410 and re-inits there, where a fresh
                // conversation actually has a message to carry (guide §5.1).
                if (status === 410) { return; }

                if (status === 200 && data && (data.status === 'ready' || data.status === 'failed')) {
                    // Replace the interim bubble's text in place (the server
                    // overwrote the same transcript row), then render final actions —
                    // ADDITIVE to the interim's, so `rendered` suppresses a repeat.
                    if (botBubble) { botBubble.textContent = data.reply || ''; }
                    else { addBubble('bot', data.reply || ''); }
                    renderActions(data.actions, null, rendered);
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
