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
 * data-title: the header title until the server names the assistant (contract
 * 1.15.0), and for as long as the site has set no name. It stays the launcher's
 * label either way.
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
    // O-9 — the FALLBACK idle window, used only until a server tells us otherwise.
    // Since contract 1.7.0 the init 201 carries `idle_hours` (O-45), so this
    // constant no longer has to stay in step with the deployment's config by hand;
    // it is what an older server, or a record written by one, degrades to.
    var IDLE_MS = 24 * 60 * 60 * 1000;

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
    var BUILT_AGAINST = '1.16.1';

    // Upper bound on each `assistant` string this widget will paint (1.15.0). The
    // server already guarantees a short name; this only stops a malformed or
    // hostile value from blowing the header up.
    var ASSISTANT_TEXT_MAX = 60;

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
    // The server's own idle window in hours (1.7.0 — O-45), or null against a
    // server that does not send it. Persisted with the record, because the resume
    // path never reaches the server to ask again — see storedIdleMs().
    var serverIdleHours = null;
    // Who the guest is talking to (1.15.0): `{name, disclosure}`, either of which
    // may be null, or null against a server that sends neither. Persisted with
    // the record for the idle window's reason — see cleanAssistant().
    var assistant = null;
    // Whether this site counts button clicks (1.16.0 — D-113): the init's
    // `analytics`, absent meaning no. Persisted with the record like the idle
    // window, because the resume path never asks init again.
    var analyticsOn = false;
    // The turn whose elements are being drawn, for a click's `turn` — null for
    // the welcome. Read synchronously when an anchor is built.
    var currentTurn = null;
    var liveForms = [];    // form elements still submittable — retired on any send (1.16.0)
    var fieldSeq = 0;      // unique ids for form inputs and their labels
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
    //
    // The window this checks against is the RECORD's, not the constant's — see
    // storedIdleMs() below.
    function readStore() {
        try {
            var raw = window.localStorage.getItem(STORE_KEY);
            if (!raw) { return null; }
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.uuid || !parsed.ts) { return null; }
            if ((Date.now() - parsed.ts) > storedIdleMs(parsed)) { return null; }
            // Anything malformed degrades to "no welcome", never throws, and above
            // all never costs the guest the conversation the record also holds.
            return {
                uuid: parsed.uuid,
                greeting: typeof parsed.greeting === 'string' ? parsed.greeting : null,
                actions: (Array.isArray(parsed.actions) && parsed.actions.length) ? parsed.actions : null,
                // Handed back so the resume branch can restore it into state. Every
                // turn re-stamps the record, and writeStore() serializes whatever is
                // in `serverIdleHours` — so a resumed session that did not restore it
                // would write `null` on its first turn and silently drop the window
                // back to the 24h fallback on the NEXT boot.
                idleHours: (typeof parsed.idleHours === 'number' && parsed.idleHours > 0) ? parsed.idleHours : null,
                // Re-validated on the way out, like everything else in the record:
                // localStorage is as untrusted as the wire.
                assistant: cleanAssistant(parsed.assistant),
                // 1.16.0: only a literal true counts, so a malformed record reports
                // nothing — fail-closed, like an absent init flag.
                analytics: parsed.analytics === true
            };
        } catch (e) { return null; }
    }

    // The init `assistant` object (contract 1.15.0), reduced to the two strings
    // this widget shows: `name`, the site owner's display name for the assistant
    // (absent when they set none), and `disclosure`, the server's own statement
    // that this is an AI (always sent, in the guest's language).
    //
    // It has the idle window's problem, so it gets the idle window's answer:
    // build() paints the header at BOOT and the resume branch never calls init,
    // so a name read only off the init response would be missing on exactly the
    // visits that return to a conversation. It is therefore stored with the
    // record and repainted from it. It is deliberately NOT cached any longer than
    // that: after an owner renames the assistant, a longer-lived cache would
    // flash the old name over a conversation the new one greets.
    //
    // Absence is normal in both directions — an older server sends no object and
    // an older record has no field — and both leave the header as build() drew it.
    function cleanAssistant(raw) {
        if (!raw || typeof raw !== 'object') { return null; }
        var name = cleanAssistantText(raw.name);
        var disclosure = cleanAssistantText(raw.disclosure);
        return (name || disclosure) ? { name: name, disclosure: disclosure } : null;
    }

    function cleanAssistantText(value) {
        if (typeof value !== 'string') { return null; }
        var text = value.replace(/\s+/g, ' ').trim();
        return text ? text.slice(0, ASSISTANT_TEXT_MAX) : null;
    }

    // The idle window to judge a STORED record by (contract 1.7.0 — O-45).
    //
    // Reading `idle_hours` off the init response is not enough on its own, and a
    // half-implementation looks correct: readStore() runs at BOOT, and a guest
    // inside the window resumes without ever calling init — so the one visit that
    // needs the server's number is the visit that never receives it. The record
    // therefore carries the window it was written under, and this reads it back.
    //
    // Absence is normal in both directions: an older server sends no idle_hours,
    // an older record has no field, and both fall back to the 24h constant.
    function storedIdleMs(parsed) {
        var hours = parsed && parsed.idleHours;
        return (typeof hours === 'number' && isFinite(hours) && hours > 0)
            ? hours * 60 * 60 * 1000
            : IDLE_MS;
    }

    // `ts` means LAST ACTIVITY, which is what the server's conversation.idle_hours
    // measures (O-9). Written once at init it would expire a still-active chat
    // client-side at hour 25 under a conversation the server considers live, so
    // every turn re-stamps it.
    function writeStore(uuid) {
        try {
            window.localStorage.setItem(STORE_KEY, JSON.stringify({
                uuid: uuid, ts: Date.now(), greeting: introGreeting, actions: introActions,
                idleHours: serverIdleHours, assistant: assistant, analytics: analyticsOn
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
            // 1.15.0 — the assistant's name and the AI disclosure beside it. A long
            // title WRAPS, as a long `data-title` always has. The disclosure is
            // capped at half the heading, which the server's own strings never
            // reach: the cap is there so a malformed one cannot push the name out
            // or cover the close button.
            '.wsc-heading{display:flex;align-items:center;flex:1 1 auto;min-width:0;margin-right:10px}',
            '.wsc-title{flex:0 1 auto;min-width:0;overflow-wrap:anywhere}',
            '.wsc-ai{flex:0 0 auto;max-width:50%;overflow:hidden;text-overflow:ellipsis;margin-left:8px;',
            'padding:1px 7px;border:1px solid rgba(255,255,255,.6);border-radius:999px;font-size:11px;',
            'font-weight:500;white-space:nowrap}',
            '.wsc-close{flex:none;background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1}',
            '.wsc-body{flex:1;overflow-y:auto;padding:14px;background:#f6f7f9}',
            '.wsc-msg{max-width:80%;margin:6px 0;padding:9px 12px;border-radius:14px;font-size:14px;',
            'line-height:1.4;word-wrap:break-word;white-space:pre-wrap}',
            '.wsc-bot{background:#fff;color:#1f2430;border:1px solid #e6e8ec;border-bottom-left-radius:4px}',
            '.wsc-guest{background:' + color + ';color:#fff;margin-left:auto;border-bottom-right-radius:4px}',
            '.wsc-act{display:inline-block;margin:6px 0;padding:9px 14px;border-radius:10px;font-size:14px;',
            'font-weight:600;text-decoration:none;color:#fff;background:' + color + '}',
            '.wsc-chan{display:block;margin:4px 0;font-size:14px;color:' + color + ';text-decoration:none}',
            // 1.14.0 prefill preview -- read-only for now, styled as a field so
            // enabling edits later needs no restyle.
            '.wsc-prefill-hint{font-size:12px;color:#6b7280;margin:8px 0 4px}',
            '.wsc-prefill{display:block;width:100%;box-sizing:border-box;margin:0 0 6px;padding:8px 10px;',
            'border:1px solid #e6e8ec;border-radius:10px;background:#fff;color:#1f2430;font-size:13px;',
            'line-height:1.4;font-family:inherit;resize:vertical}',
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
            '.wsc-avail{font-size:13px;color:#1f2430;margin:4px 0}',
            '.wsc-card-cta{display:block;text-align:center;margin-top:8px}',
            '.wsc-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}',
            // 1.7.0 quick_replies heading. `flex:0 0 100%` is what lets it live
            // INSIDE the flex row (so it retires with the chips) while still
            // occupying its own line above them.
            '.wsc-chips-head{flex:0 0 100%;margin:0;font-size:13px;font-weight:600;color:#1f2430}',
            '.wsc-chip{padding:7px 12px;border-radius:999px;border:1px solid ' + color + ';background:none;',
            'color:' + color + ';font-size:13px;cursor:pointer;font-family:inherit}',
            // 1.16.0 chip picture: a chip that has one becomes a small tile.
            '.wsc-chip-img{display:block;width:96px;height:60px;object-fit:cover;border-radius:8px;margin:0 auto 4px}',
            '.wsc-chip:has(.wsc-chip-img){border-radius:12px;padding:6px}',
            '.wsc-card-stay{font-size:13px;font-weight:700;color:#1f2430;margin-top:2px}',
            '.wsc-card-reason{font-size:12px;color:#6b7280;margin-top:2px}',
            '.wsc-card-order{font-size:12px;font-weight:600;color:#6b7280;margin:6px 0 0}',
            // 1.16.0 form. Long labels wrap rather than widen the panel.
            '.wsc-form{background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:10px 12px;margin:6px 0;max-width:92%}',
            '.wsc-form-set{border:none;margin:0;padding:0;min-width:0}',
            '.wsc-form-set:disabled{opacity:.6}',
            '.wsc-form-title{font-size:14px;font-weight:700;color:#1f2430;overflow-wrap:anywhere}',
            '.wsc-form-intro{font-size:13px;color:#3b4252;margin-top:2px;overflow-wrap:anywhere}',
            '.wsc-form-label{display:block;font-size:12px;color:#6b7280;margin:8px 0 3px;overflow-wrap:anywhere}',
            '.wsc-form-input{display:block;width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #d6d9de;',
            'border-radius:8px;font-size:14px;font-family:inherit;background:#fff;color:#1f2430}',
            '.wsc-form-range{display:flex;gap:6px}.wsc-form-range>div{flex:1 1 0;min-width:0}',
            '.wsc-form-check{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin-top:8px}',
            '.wsc-form-check .wsc-form-label{margin:0}',
            '.wsc-form-link{font-size:12px;color:' + color + '}',
            '.wsc-form-submit{border:none;cursor:pointer;font-family:inherit;margin-top:10px}',
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
        var heading = el('span', 'wsc-heading');
        var titleEl = el('span', 'wsc-title', title);
        // Empty, and hidden, until an init or a stored record says who the guest
        // is talking to (1.15.0) — see applyAssistant().
        var ai = el('span', 'wsc-ai');
        ai.style.display = 'none';
        heading.appendChild(titleEl);
        heading.appendChild(ai);
        head.appendChild(heading);
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

        els = { launcher: launcher, panel: panel, body: body, input: input, send: send, title: titleEl, ai: ai };

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
            // `id` (1.16.0) says which button it is; one this widget does not know
            // is drawn and simply not reported.
            linkButton(action.label, action.url, rendered, 'link_button', LINK_IDS[action.id] === true ? action.id : null);
            return;
        }

        if (action.type === 'booking_link') {
            if (cardUrls && cardUrls[action.url]) { return; } // same dedupe rule
            linkButton('Book now →', action.url, rendered, 'booking_link', 'book');
            return;
        }

        // The option rows ALWAYS render -- they are new content, and since 1.9.1
        // the reply text points at them instead of listing them. Only the trailing
        // Book button is deduped: against a card in THIS list carrying the same
        // CTA (1.10.0 -- the booking-turn card, D-073), and against a url this
        // turn already anchored -- a poll's availability url repeats the interim
        // booking_link (1.6.0). Before 1.10.0 the whole branch returned early on
        // the second case and lost the rows with it.
        if (action.type === 'availability') {
            availabilityTotals(action.options); // 1.8.0 -- renders nothing for a pre-1.8.0 option
            if (!action.url) { return; }
            if (cardUrls && cardUrls[action.url]) { return; }
            if (rendered && rendered[action.url]) { return; }
            linkButton('Book now →', action.url, rendered, 'availability', 'book');
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

        if (action.type === 'form') {
            form(action);
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
            contactChannels(action);
        }
    }

    // contact_channels. Every href is built HERE from the channel value, never
    // taken from the payload (the contract's security rule).
    //
    // 1.14.0 `prefill` (D-084): the message a handoff pre-writes for the guest's
    // WhatsApp or email. The contract's MUST: a renderer that appends it shows it
    // before the guest leaves the page -- here, a preview ABOVE the buttons,
    // captioned by the server-localized `hint`, so it is on screen before any
    // button is and a screen reader reaches the caption first (nest-chatbot-ai
    // 2.13.1 found the reference had it under them). The WhatsApp and email links are
    // composed from the preview's CURRENT value when tapped, not once at render.
    // So letting the guest edit the message (a MAY, deferred by the owner) means
    // removing the `readonly` attribute below and nothing else. An edited message
    // is the guest's own: it never goes back to the server.
    function contactChannels(action) {
        var prefill = action.prefill && typeof action.prefill.text === 'string' && action.prefill.text ? action.prefill : null;
        var preview = null;
        if (prefill && (action.whatsapp || action.email)) {
            preview = el('textarea', 'wsc-prefill');
            preview.value = prefill.text; // a form value -- never markup
            preview.setAttribute('readonly', 'readonly'); // remove to let the guest edit it
            preview.setAttribute('rows', '4');
            preview.setAttribute('dir', 'auto'); // a quote may be right-to-left
            preview.setAttribute('aria-label', typeof prefill.hint === 'string' && prefill.hint ? prefill.hint : 'Message to send');
            if (typeof prefill.hint === 'string' && prefill.hint) { els.body.appendChild(el('div', 'wsc-prefill-hint', prefill.hint)); }
            els.body.appendChild(preview);
        }

        if (action.phone) { channelLink('Call ' + action.phone, 'tel:' + telNumber(action.phone), 'phone'); }
        if (action.whatsapp) {
            var wa = 'https://wa.me/' + digits(telNumber(action.whatsapp));
            var waLink = channelLink('WhatsApp', wa, 'whatsapp');
            if (preview) { composeOnTap(waLink, function () { return wa + '?text=' + encodeURIComponent(preview.value); }); }
        }
        if (action.email) {
            var mail = 'mailto:' + action.email;
            var mailLink = channelLink('Email ' + action.email, mail, 'email');
            if (preview) {
                composeOnTap(mailLink, function () {
                    var subject = typeof prefill.subject === 'string' && prefill.subject ? 'subject=' + encodeURIComponent(prefill.subject) + '&' : '';
                    return mail + '?' + subject + 'body=' + encodeURIComponent(preview.value);
                });
            }
        }
    }

    // Rebuild a link's href from the preview at tap time (and once now, so a
    // long-press or "copy link" carries the message too).
    function composeOnTap(link, build) {
        var refresh = function () { link.setAttribute('href', build()); };
        refresh();
        link.addEventListener('click', refresh);
    }

    // A dialable number: `+` and the digits when the value is international
    // (`+34 …` or `0034 …`), else the bare digits. `tel:` needs the `+` to dial
    // abroad; `wa.me` takes the same digits without it. The admin form's own
    // separators go first, so `(+34) 922 …` -- which that form accepts -- still
    // reads as international.
    function telNumber(value) {
        var raw = String(value || '').replace(/[\s.\-()]/g, '');
        var d = digits(raw);
        if (raw.charAt(0) === '+') { return '+' + d; }
        if (raw.slice(0, 2) === '00') { return '+' + d.slice(2); }
        return d;
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
            // 1.16.0: on a stay result, what the stay costs — the cheapest option,
            // from live prices — beside the static from-price, and why a card sits
            // where it does (a sold-out hostel says so).
            if (item.stay_total && typeof item.stay_total.amount === 'string' && item.stay_total.amount) {
                body.appendChild(el('div', 'wsc-card-stay', item.stay_total.amount
                    + (typeof item.stay_total.currency === 'string' ? ' ' + item.stay_total.currency : '') + ' total'
                    + (item.stay_total.basis === 'per_person' ? ' · beds' : item.stay_total.basis === 'per_unit' ? ' · room' : '')));
            }
            if (typeof item.reason === 'string' && item.reason) { body.appendChild(el('div', 'wsc-card-reason', item.reason)); }
            // cta_label is server-localized (1.6.0) — prefer it over our English default.
            var cta = el('a', 'wsc-act wsc-card-cta',
                (typeof item.cta_label === 'string' && item.cta_label) ? item.cta_label : 'Book now →');
            cta.setAttribute('href', href);
            cta.setAttribute('target', '_blank');
            cta.setAttribute('rel', 'noopener noreferrer');
            reportClicks(cta, 'property_cards', 'book');
            body.appendChild(cta);
            card.appendChild(body);
            rail.appendChild(card);
            if (rendered) { rendered[href] = true; }
            shown++;
        }
        if (!rail.firstChild) { return; }
        // 1.16.0: say how the cards are ordered only when the server says so.
        if (ORDERING_LABELS[action.ordering]) { els.body.appendChild(el('div', 'wsc-card-order', ORDERING_LABELS[action.ordering])); }
        els.body.appendChild(rail);

        var moreUrl = action.more ? safeHttpUrl(action.more.url) : null;
        if (moreUrl && typeof action.more.label === 'string' && action.more.label) {
            linkButton(action.more.label, moreUrl, rendered, 'property_cards', 'more');   // label is server-localized
        } else if (typeof action.total === 'number' && action.total > shown) {
            els.body.appendChild(el('div', 'wsc-card-loc', 'Showing ' + shown + ' of ' + action.total + '.'));
        }
        scrollDown();
    }

    // `property_cards.ordering` (1.16.0) — a label only for the orders that are one.
    var ORDERING_LABELS = { cheapest: 'Cheapest first', ranked: 'Best match first' };

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
        reportClicks(cta, 'promo_card', 'promo');
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
    //
    // `heading` (1.7.0 — O-47) renders INSIDE the row, not as a sibling above it.
    // That is load-bearing: retireChipRows() removes the row element and nothing
    // else, so a sibling heading would outlive the chips it labels and sit over
    // the transcript forever. Being a full-width flex child costs one CSS rule.
    function quickReplies(action) {
        if (!action.items || !action.items.length) { return; }
        var row = el('div', 'wsc-chips');
        row.setAttribute('role', 'group');
        var heading = (typeof action.heading === 'string' && action.heading) ? action.heading : null;
        // The heading IS the group's accessible name when there is one — that is the
        // whole point of the field. The visible copy is then aria-hidden so it is not
        // announced twice.
        row.setAttribute('aria-label', heading || 'Suggested questions');
        row.setAttribute('aria-live', 'off'); // announced by the reply, not by itself
        // Tenant-authored labels may be in the tenant's language, not the guest's;
        // the island_choice and property_choice rows omit `locale` because their
        // labels are proper nouns.
        if (typeof action.locale === 'string' && /^[a-z]{2}$/.test(action.locale)) {
            row.setAttribute('lang', action.locale);
        }
        if (heading) {
            var head = el('div', 'wsc-chips-head', heading);
            head.setAttribute('aria-hidden', 'true');
            row.appendChild(head);
        }
        var chips = 0;
        for (var i = 0; i < action.items.length; i++) {
            (function (item) {
                if (!item || typeof item.label !== 'string' || !item.label
                    || typeof item.message !== 'string' || !item.message) { return; }
                var chip = el('button', 'wsc-chip');
                chip.setAttribute('type', 'button');
                // 1.16.0: an optional picture above the label — an image source
                // under the http(s) rule, decorative unless `image_alt` says more.
                var img = safeHttpUrl(item.image);
                if (img) {
                    var picture = el('img', 'wsc-chip-img');
                    picture.setAttribute('src', img);
                    picture.setAttribute('alt', typeof item.image_alt === 'string' ? item.image_alt : '');
                    picture.setAttribute('loading', 'lazy');
                    picture.setAttribute('referrerpolicy', 'no-referrer');
                    chip.appendChild(picture);
                }
                chip.appendChild(el('span', null, item.label));
                // A keyed chip sends its key beside its message (1.16.0): that is
                // how this widget says it can draw what the chip answers with — a
                // form — while an older server still sees the message it always did.
                var key = (typeof item.key === 'string' && item.key && item.key.length <= 64) ? item.key : null;
                chip.addEventListener('click', function () {
                    if (busy || removed || ended) { return; }
                    retireChipRows();
                    retireForms();
                    addBubble('guest', item.message);
                    ensureConversation(function () {
                        sendMessage(item.message, false, key ? { type: 'reply', payload: { key: key } } : null);
                    });
                });
                row.appendChild(chip);
                chips++;
            })(action.items[i]);
        }
        // Counted, NOT `row.firstChild`: since 1.7.0 the heading is itself a child,
        // so a row whose every item failed validation would otherwise mount as a
        // lone question with nothing to tap.
        if (chips) { els.body.appendChild(row); chipRows.push(row); scrollDown(); }
    }

    function linkButton(label, url, rendered, element, cta) {
        var href = safeHttpUrl(url);
        if (!href) { return; }
        var link = el('a', 'wsc-act', label || 'Open'); // label via textContent — never markup
        link.setAttribute('href', href); // set as attribute — never interpolated into markup
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        reportClicks(link, element, cta);
        els.body.appendChild(link);
        if (rendered) { rendered[href] = true; }
        scrollDown();
    }

    // 1.8.0: an availability option MAY carry `units`/`basis`/`total` -- the price
    // the PARTY pays; `price` is always for ONE bed or room. Render the total when
    // present, via textContent, and NEVER compute one from `price`: the server's
    // number is the honest one. An option without it renders nothing here, exactly
    // as before 1.8.0 -- and since 1.9.1 the reply text lists the options ONLY
    // when one of them lacks a total, which is exactly that case (D-072); on a
    // list where every option carries one, these lines are the guest's list.
    function availabilityTotals(options) {
        if (!options || !options.length) { return; }
        for (var i = 0; i < options.length; i++) {
            var o = options[i];
            if (!o || o.total == null || o.units == null) { continue; }
            var unit = o.basis === 'per_person' ? 'bed' : 'room';
            var text = o.units + ' ' + (o.units === 1 ? unit : unit + 's') + ' · ' + (o.room || '')
                + ' — ' + o.total + (o.currency ? ' ' + o.currency : '') + ' total';
            els.body.appendChild(el('div', 'wsc-avail', text));
        }
        scrollDown();
    }

    // wa.me opens in a new tab: navigating the HOST page away would drop the
    // guest's chat mid-handoff. tel:/mailto: hand off to an app and stay put.
    function channelLink(label, href, cta) {
        var a = el('a', 'wsc-chan', label);
        a.setAttribute('href', href);
        a.setAttribute('rel', 'noopener noreferrer');
        if (/^https:/.test(href)) { a.setAttribute('target', '_blank'); }
        reportClicks(a, 'contact_channels', cta);
        els.body.appendChild(a);
        scrollDown();
        return a;
    }

    // ---- CTA-click events (1.16.0 — D-113) ------------------------------------
    // The `link_button` ids this widget reports; another one is drawn, not counted.
    var LINK_IDS = { book: true, website: true, directions: true };

    // Report a click on this anchor when the site counts clicks: two enums and
    // the turn, never the url, a label or a prefill (the contract's security
    // rule). Through post(), not a beacon — sendBeacon cannot carry the key —
    // and not keepalive: every CTA here opens a new tab, and tel:/mailto: keep
    // the page. Fire and forget: a 404/410 here is not the conversation's death,
    // so nothing is read back and nothing re-inits.
    function reportClicks(anchor, element, cta) {
        if (!element || !cta) { return; }
        // The conversation that drew the button, not whichever is current when
        // it is clicked: after a re-init the old turn means nothing to the new one.
        var turn = currentTurn;
        var uuid = conversationUuid;
        anchor.addEventListener('click', function () {
            var target = uuid || conversationUuid;
            if (!analyticsOn || !target) { return; }
            var body = { type: 'cta_click', element: element, cta: cta };
            if (typeof turn === 'number') { body.turn = turn; }
            post('/api/v1/chatbot/conversations/' + encodeURIComponent(target) + '/events', body, function () {});
        });
    }

    // ---- form (1.16.0 — D-111(b)) -------------------------------------------
    // A form belongs to its turn like a chip row: any send retires every live one.
    // Retired forms stay on screen, disabled, as the record of what was sent.
    function retireForms() {
        for (var i = 0; i < liveForms.length; i++) { liveForms[i].disabled = true; }
        liveForms = [];
    }

    var FORM_KINDS = { text: 'text', textarea: true, email: 'email', phone: 'tel', select: true, date_range: true, guests: true, consent: true };

    function isDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value); }

    // `Y-m-d` one day on, read and written in UTC so no timezone shifts it.
    function nextDay(value) {
        var day = new Date(value + 'T00:00:00Z');
        day.setUTCDate(day.getUTCDate() + 1);
        return day.toISOString().slice(0, 10);
    }

    function fieldLabel(text, id) {
        var label = el('label', 'wsc-form-label', text);
        label.setAttribute('for', id);
        return label;
    }

    // One field: draws its control into `set` and returns its reader, which
    // answers `{name, value, display}`, null for a blank optional field, or
    // false when what is there cannot be sent. Null here drops the whole form
    // (the contract's fail-closed rule): a field this widget cannot draw is one
    // the guest cannot fill.
    function formField(set, field) {
        if (!field || typeof field.name !== 'string' || !field.name || typeof field.label !== 'string' || !field.label
            || !FORM_KINDS[field.kind]) { return null; }
        var id = 'wsc-f-' + (++fieldSeq);
        var required = field.required === true;
        var name = field.name;

        if (field.kind === 'select') {
            if (!Array.isArray(field.options) || !field.options.length) { return null; }
            set.appendChild(fieldLabel(field.label, id));
            var select = el('select', 'wsc-form-input');
            select.id = id;
            select.required = required;
            var blank = el('option', null, typeof field.placeholder === 'string' ? field.placeholder : '');
            blank.value = '';
            select.appendChild(blank);
            var labels = {};
            for (var i = 0; i < field.options.length; i++) {
                var o = field.options[i];
                if (!o || typeof o.key !== 'string' || !o.key || typeof o.label !== 'string' || !o.label) { continue; }
                var option = el('option', null, o.label);
                option.value = o.key;
                if (field.value === o.key) { option.selected = true; }
                labels[o.key] = o.label;
                select.appendChild(option);
            }
            set.appendChild(select);
            return function () {
                return select.value ? { name: name, value: select.value, display: labels[select.value] || '' } : null;
            };
        }

        if (field.kind === 'date_range') {
            var group = el('div', 'wsc-form-group');
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', field.label);
            group.appendChild(el('div', 'wsc-form-label', field.label));
            var range = el('div', 'wsc-form-range');
            var ends = field.labels || {};
            var value = field.value || {};
            var inputs = [];
            ['from', 'to'].forEach(function (end) {
                var cell = el('div');
                var endId = id + '-' + end;
                var input = el('input', 'wsc-form-input');
                input.id = endId;
                input.type = 'date';
                input.required = required;
                if (isDate(field.min)) { input.min = field.min; }
                if (isDate(field.max)) { input.max = field.max; }
                if (isDate(value[end])) { input.value = value[end]; }
                // The ends' names are the server's; without them the field's own
                // label names both, rather than words this widget would invent.
                if (typeof ends[end] === 'string' && ends[end]) { cell.appendChild(fieldLabel(ends[end], endId)); }
                else { input.setAttribute('aria-label', field.label); }
                cell.appendChild(input);
                range.appendChild(cell);
                inputs.push(input);
            });
            // The check-out comes at least a night after the check-in.
            inputs[0].addEventListener('change', function () { if (inputs[0].value) { inputs[1].min = nextDay(inputs[0].value); } });
            group.appendChild(range);
            set.appendChild(group);
            return function () {
                var from = inputs[0].value;
                var to = inputs[1].value;
                if (!from && !to) { return required ? false : null; }
                if (!isDate(from) || !isDate(to) || to <= from) { return false; }
                return { name: name, value: { from: from, to: to }, display: from + ' → ' + to };
            };
        }

        if (field.kind === 'consent') {
            var line = el('div', 'wsc-form-check');
            var box = el('input');
            box.id = id;
            box.type = 'checkbox';
            box.required = required;
            line.appendChild(box);
            line.appendChild(fieldLabel(field.label, id));
            var href = field.link ? safeHttpUrl(field.link.url) : null;
            if (href && typeof field.link.label === 'string' && field.link.label) {
                var notice = el('a', 'wsc-form-link', field.link.label);
                notice.setAttribute('href', href);
                notice.setAttribute('target', '_blank');
                notice.setAttribute('rel', 'noopener noreferrer');
                line.appendChild(notice);
            }
            set.appendChild(line);
            return function () { return box.checked ? { name: name, value: true, display: '' } : null; };
        }

        set.appendChild(fieldLabel(field.label, id));
        var input = el(field.kind === 'textarea' ? 'textarea' : 'input', 'wsc-form-input');
        input.id = id;
        input.required = required;
        input.setAttribute('dir', 'auto'); // the guest may write right-to-left
        if (typeof field.placeholder === 'string') { input.placeholder = field.placeholder; }
        if (field.kind === 'guests') {
            input.type = 'number';
            input.step = '1';
            input.setAttribute('inputmode', 'numeric');
            if (typeof field.min === 'number') { input.min = String(field.min); }
            if (typeof field.max === 'number') { input.max = String(field.max); }
            if (typeof field.value === 'number') { input.value = String(field.value); }
        } else {
            if (field.kind !== 'textarea') { input.type = FORM_KINDS[field.kind]; }
            else { input.rows = 3; }
            input.maxLength = 500;
            if (typeof field.value === 'string') { input.value = field.value; }
        }
        set.appendChild(input);
        return function () {
            var raw = String(input.value || '').trim();
            if (!raw) { return null; }
            if (field.kind !== 'guests') { return { name: name, value: raw, display: raw }; }
            var count = parseInt(raw, 10);
            return isFinite(count) ? { name: name, value: count, display: String(count) } : false;
        };
    }

    // form (1.16.0): native inputs per field kind; every label, option and
    // value lands via textContent or a property, never markup. Submitting sends
    // the values as an action AND the server's `submit_message` filled with what
    // was chosen — a select's label, a range as `from → to`, anything else raw —
    // as the guest bubble, so the transcript reads as the guest's own words and
    // this widget invents none. The values stay in the form until the server
    // answers; a failed send gives the form back.
    function form(action) {
        if (typeof action.id !== 'string' || !action.id || !Array.isArray(action.fields) || !action.fields.length
            || typeof action.submit_label !== 'string' || !action.submit_label
            || typeof action.submit_message !== 'string' || !action.submit_message) { return; }

        var box = el('form', 'wsc-form');
        box.setAttribute('aria-label', typeof action.title === 'string' && action.title ? action.title : action.submit_label);
        box.setAttribute('aria-live', 'off'); // announced by the reply, not by itself
        var set = el('fieldset', 'wsc-form-set');
        if (typeof action.title === 'string' && action.title) { set.appendChild(el('div', 'wsc-form-title', action.title)); }
        if (typeof action.intro === 'string' && action.intro) { set.appendChild(el('div', 'wsc-form-intro', action.intro)); }

        var readers = [];
        for (var i = 0; i < action.fields.length; i++) {
            var reader = formField(set, action.fields[i]);
            if (!reader) { return; }
            readers.push(reader);
        }

        var send = el('button', 'wsc-act wsc-form-submit', action.submit_label);
        send.setAttribute('type', 'submit');
        set.appendChild(send);
        box.appendChild(set);

        box.addEventListener('submit', function (event) {
            event.preventDefault();
            if (busy || removed || ended || set.disabled) { return; }
            if (box.reportValidity && !box.reportValidity()) { return; }
            var values = {};
            var shown = {};
            for (var r = 0; r < readers.length; r++) {
                var answer = readers[r]();
                if (answer === false) { return; }
                if (answer) { values[answer.name] = answer.value; shown[answer.name] = answer.display; }
            }
            var message = action.submit_message.replace(/\{([A-Za-z0-9_]+)\}/g, function (match, key) {
                return Object.prototype.hasOwnProperty.call(shown, key) ? shown[key] : '';
            }).trim();
            if (!message) { return; }
            retireChipRows();
            retireForms();
            addBubble('guest', message);
            ensureConversation(function () {
                sendMessage(message, false, { type: 'form', id: action.id, payload: { values: values } }, function () {
                    set.disabled = false;
                    liveForms.push(set);
                });
            });
        });

        els.body.appendChild(box);
        liveForms.push(set);
        scrollDown();
    }

    // Paints the header from `assistant` (contract 1.15.0). Called wherever a
    // conversation is established — after init, on resume, after a restart —
    // because build() ran at boot, before any of them had a name.
    //
    // The name takes `data-title`'s place in the header. The disclosure sits
    // beside it and does NOT wait for a name: a site that named nothing is still
    // an AI. Both go in through textContent / setAttribute, never innerHTML — the
    // name is tenant-authored. With neither, the header is what build() drew.
    function applyAssistant() {
        var name = (assistant && assistant.name) || null;
        var disclosure = (assistant && assistant.disclosure) || null;
        var heading = name || title;

        els.title.textContent = heading;
        els.ai.textContent = disclosure || '';
        els.ai.style.display = disclosure ? '' : 'none';
        els.panel.setAttribute('aria-label', disclosure ? heading + ' — ' + disclosure : heading);
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
            // Restored, not defaulted — see readStore(). This branch never reaches
            // the server, so the record is the only source for the window, and the
            // first turn of this session is about to write the record back.
            serverIdleHours = stored.idleHours;
            // Likewise (1.15.0): the header was painted at boot with no name.
            assistant = stored.assistant;
            applyAssistant();
            analyticsOn = stored.analytics; // 1.16.0, for the same reason
            // Paint the welcome only onto an empty transcript. This branch is
            // reached from panel-open, but submit() draws the guest bubble BEFORE
            // it calls us, and a welcome block under a message the guest has
            // already sent is not a first-contact affordance any more.
            if (!els.body.firstChild) {
                if (introGreeting) { addBubble('bot', introGreeting); }
                currentTurn = null;
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
    // `onFail` (1.16.0) runs when no conversation could be opened, so a form
    // whose send waited on this re-init is given back.
    function startConversation(cb, silent, onFail) {
        if (busy) { return; }
        busy = true;
        post('/api/v1/chatbot/conversations', { locale: locale, property: property }, function (status, data) {
            busy = false;
            if (status === 403) { teardown(); return; }
            if (status === 429) { addBubble('bot', retryText()); if (onFail) { onFail(); } return; }
            if (status !== 201 || !data || !data.conversation) { addBubble('bot', errorText()); if (onFail) { onFail(); } return; }

            conversationUuid = data.conversation.uuid;
            started = true;
            // Settled BEFORE writeStore, which serializes them: the resume branch is
            // the only other reader and it needs the same values this load renders.
            // Stored even when `silent` — the guest is not shown them now, but the
            // replacement conversation is theirs for the rest of the idle window
            // and its next page load should open with its welcome, not with nothing.
            introGreeting = data.greeting || null;
            introActions = (data.actions && data.actions.length) ? data.actions : null;
            // 1.7.0 (O-45). Absent on an older server, which leaves it null and
            // falls the record back to IDLE_MS — the pre-1.7.0 behaviour exactly.
            serverIdleHours = (typeof data.idle_hours === 'number' && isFinite(data.idle_hours) && data.idle_hours > 0)
                ? data.idle_hours
                : null;
            // 1.15.0. Absent on an older server, which leaves it null and the
            // header on `data-title`. Applied even when `silent`: the header names
            // the conversation the guest is now in, it is not part of the welcome.
            assistant = cleanAssistant(data.assistant);
            applyAssistant();
            // 1.16.0 (D-113): report clicks only when the site says so. Absent —
            // an older server, a site that never opted in — means never.
            analyticsOn = data.analytics === true;
            writeStore(conversationUuid);
            checkContractVersion(data.contract_version);
            if (!silent) {
                if (introGreeting) { addBubble('bot', introGreeting); }
                currentTurn = null;
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
        retireForms();
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
        retireForms();      // and any form still open (1.16.0)
        addBubble('guest', text);
        ensureConversation(function () { sendMessage(text, false); });
    }

    // `action` (1.16.0) rides beside the message — a keyed chip's or a form's —
    // and `onFail` gives a form back when the send does not land.
    function sendMessage(text, isRetry, action, onFail) {
        if (!conversationUuid) { return; }
        busy = true;
        els.send.disabled = true;
        var typing = showTyping();
        var body = { message: text };
        if (action) { body.action = action; }

        post('/api/v1/chatbot/conversations/' + encodeURIComponent(conversationUuid) + '/messages',
            body,
            function (status, data) {
                busy = false;
                els.send.disabled = false;
                if (typing.parentNode) { typing.parentNode.removeChild(typing); }

                if (status === 200 && data) {
                    writeStore(conversationUuid);   // re-stamp ts — see writeStore()
                    var botBubble = data.reply ? addBubble('bot', data.reply) : null;
                    currentTurn = typeof data.turn === 'number' ? data.turn : null;
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
                    startConversation(function () { sendMessage(text, true, action, onFail); }, true, onFail);
                    return;
                }
                if (status === 403) { teardown(); return; }
                if (onFail) { onFail(); }
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
                    currentTurn = typeof data.turn === 'number' ? data.turn : null;
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
