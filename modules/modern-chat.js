/* ============================================================
   modern-chat.js — Modern chat overlay for ForumFree HelloBox
   - FAB + slide-over panel (bottom-right)
   - Reads messages from the HelloBox React fiber (no scraping)
   - Composer: TipTap (lazy) or contenteditable fallback → BBCode
   - Send path: native value setter on hidden textarea + click
   - Per-message actions: quote / edit / delete (delegated)
   - Presence chip, unread badge, dark mode, mobile sheet
   - Icons: Font Awesome (Regular where available, Solid for
     bold / italic / underline / strikethrough — FA does not ship
     Regular variants of those four glyphs)
   ============================================================ */
'use strict';

var ModernChat = (function () {
    'use strict';

    // ─── CONFIG ───────────────────────────────────────────────────────────
    var CONFIG = {
        ROOT_SELECTOR: 'hello-box',
        MSG_CONTAINER: '.hb-messages',
        MSG_SELECTOR: '.hb-message',
        TEXTAREA_SELECTOR: '.hb-textarea',
        SEND_BTN_SELECTOR: '.hb-send-btn',
        ONLINE_SELECTOR: '.hb-online-user',
        POLL_MS: 1500,
        MOUNT_TIMEOUT_MS: 12000,
        FIBER_MAX_DEPTH: 30,
        HISTORY_LIMIT: 400,
        STORAGE: {
            LAST_SEEN: 'modern-chat:lastSeen',
            PREFS: 'modern-chat:prefs'
        },
        TIPTAP_VERSION: '2.5.2',
        TIPTAP_TIMEOUT_MS: 8000
    };

    // ─── STATE ────────────────────────────────────────────────────────────
    var state = {
        mounted: false,
        ready: false,
        open: false,
        messages: [],
        dom: new Map(),
        lastSeenAt: 0,
        unread: 0,
        editor: null,
        editorMode: null,
        tipTapDeps: null,
        mutationObserver: null,
        pollTimer: null,
        composeDebounce: null
    };

    // ─── SMALL HELPERS ────────────────────────────────────────────────────
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function debug() {
        if (window.location.search.indexOf('mc-debug') === -1) return;
        var args = Array.prototype.slice.call(arguments);
        console.log.apply(console, ['[ModernChat]'].concat(args));
    }
    function warn() {
        var args = Array.prototype.slice.call(arguments);
        console.warn.apply(console, ['[ModernChat]'].concat(args));
    }
    function toast(msg, kind) {
        try {
            if (window.Commons && Commons.toast && Commons.toast.show) {
                Commons.toast.show({ class: ['cs-toast-' + (kind || 'info')], content: msg, ttl: 3000 });
                return;
            }
        } catch (e) {}
        if (kind === 'error') warn(msg); else debug(msg);
    }
    function throttle(fn, ms) {
        var t = 0, timer = null, lastArgs = null;
        return function () {
            lastArgs = arguments;
            var now = Date.now();
            var remaining = ms - (now - t);
            if (remaining <= 0) {
                t = now;
                fn.apply(null, lastArgs);
            } else if (!timer) {
                timer = setTimeout(function () {
                    t = Date.now();
                    timer = null;
                    fn.apply(null, lastArgs);
                }, remaining);
            }
        };
    }

    // ─── FIBER ACCESS ─────────────────────────────────────────────────────
    function getHelloBoxRoot() {
        return document.querySelector(CONFIG.ROOT_SELECTOR);
    }
    function fiberKeyOf(el) {
        if (!el) return null;
        var ks = Object.keys(el);
        for (var i = 0; i < ks.length; i++) {
            if (ks[i].indexOf('__reactFiber$') === 0) return ks[i];
        }
        return null;
    }
    function readMessageObject(msgEl) {
        if (!msgEl) return null;
        var start = msgEl.querySelector('.hb-time') || msgEl;
        var key = fiberKeyOf(start) || fiberKeyOf(msgEl);
        if (!key) return null;
        var fiber = (msgEl.querySelector('.hb-time') || msgEl)[key];
        var depth = 0;
        while (fiber && depth < CONFIG.FIBER_MAX_DEPTH) {
            var p = fiber.memoizedProps;
            if (p && p.message && p.message.id && typeof p.message.content === 'string') {
                return p.message;
            }
            fiber = fiber.return;
            depth++;
        }
        return null;
    }
        function readAllMessages() {
        var root = getHelloBoxRoot();
        if (!root) return [];
        var container = root.querySelector(CONFIG.MSG_CONTAINER);
        if (!container) return [];

        var firstMsg = container.querySelector(CONFIG.MSG_SELECTOR);
        if (firstMsg) {
            var key = fiberKeyOf(firstMsg);
            if (key) {
                var fiber = firstMsg[key];
                var depth = 0;
                while (fiber && depth < CONFIG.FIBER_MAX_DEPTH) {
                    var p = fiber.memoizedProps;
                    if (p && Array.isArray(p.messages) && p.messages.length > 0) {
                        // React provides Newest -> Oldest. 
                        // We reverse it for chat (Oldest -> Newest at bottom).
                        return p.messages.slice().reverse();
                    }
                    fiber = fiber.return;
                    depth++;
                }
            }
        }

        var nodes = container.querySelectorAll(CONFIG.MSG_SELECTOR);
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
            var m = readMessageObject(nodes[i]);
            if (m) out.push(m);
        }
        return out.reverse(); // Reverse DOM fallback too
    }
    function readOnlineUsers() {
        var root = getHelloBoxRoot();
        if (!root) return [];
        var nodes = root.querySelectorAll(CONFIG.ONLINE_SELECTOR);
        var out = [];
        for (var i = 0; i < nodes.length; i++) {
            var a = nodes[i].querySelector('a');
            var img = nodes[i].querySelector('img');
            out.push({
                name: a ? a.textContent.trim() : '',
                href: a ? a.getAttribute('href') : null,
                avatar: img ? (img.getAttribute('data-original') || img.getAttribute('src')) : null
            });
        }
        return out;
    }
    function findSourceNodeById(msgId) {
        var root = getHelloBoxRoot();
        if (!root) return null;
        var nodes = root.querySelectorAll(CONFIG.MSG_SELECTOR);
        for (var i = 0; i < nodes.length; i++) {
            var m = readMessageObject(nodes[i]);
            if (m && m.id === msgId) return nodes[i];
        }
        return null;
    }

    // ─── BBCode ↔ HTML (minimal; only used for the composer) ─────────────
    function htmlToBB(html) {
        if (!html) return '';
        var div = document.createElement('div');
        div.innerHTML = html;
        function walk(node) {
            if (node.nodeType === 3) return node.nodeValue;
            if (node.nodeType !== 1) return '';
            var tag = node.tagName.toLowerCase();
            if (tag === 'img') {
                if (node.classList.contains('twemoji')) return node.getAttribute('alt') || '';
                var src = node.getAttribute('src');
                return src ? '[img]' + src + '[/img]' : '';
            }
            if (tag === 'br') return '\n';
            var inner = '';
            for (var i = 0; i < node.childNodes.length; i++) inner += walk(node.childNodes[i]);
            switch (tag) {
                case 'strong': case 'b': return '[b]' + inner + '[/b]';
                case 'em': case 'i': return '[i]' + inner + '[/i]';
                case 'u': return '[u]' + inner + '[/u]';
                case 's': case 'strike': case 'del': return '[s]' + inner + '[/s]';
                case 'code': return '[code]' + inner + '[/code]';
                case 'a': return '[url=' + (node.getAttribute('href') || '') + ']' + inner + '[/url]';
                case 'blockquote': return '[quote]' + inner + '[/quote]';
                case 'p': return inner + (node.nextSibling ? '\n' : '');
                case 'div': return inner + (node.nextSibling ? '\n' : '');
                default: return inner;
            }
        }
        var out = '';
        for (var i = 0; i < div.childNodes.length; i++) out += walk(div.childNodes[i]);
        return out.replace(/\n{3,}/g, '\n\n').trim();
    }
    function bbToHTML(bb) {
        if (!bb) return '';
        var html = escapeHtml(bb);
        html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
        html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
        html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
        html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>');
        html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, '<code>$1</code>');
        html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener">$2</a>');
        html = html.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '<img src="$1" alt="" loading="lazy" decoding="async">');
        html = html.replace(/\r?\n/g, '<br>');
        return html;
    }

    // ─── TIME HELPERS ─────────────────────────────────────────────────────
    function relativeTime(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) return '';
        var diff = date.getTime() - Date.now();
        var absDiff = Math.abs(diff) / 1000;
        var locale = document.documentElement.lang || 'en';
        var rtf;
        try {
            rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        } catch (e) {
            rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        }
        if (absDiff < 60)       return rtf.format(Math.round(diff / 1000), 'second');
        if (absDiff < 3600)     return rtf.format(Math.round(diff / 60000), 'minute');
        if (absDiff < 86400)    return rtf.format(Math.round(diff / 3600000), 'hour');
        if (absDiff < 2592000)  return rtf.format(Math.round(diff / 86400000), 'day');
        if (absDiff < 31536000) return rtf.format(Math.round(diff / 2592000000), 'month');
        return rtf.format(Math.round(diff / 31536000000), 'year');
    }
    function formatFullDate(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) return '';
        return date.toLocaleString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long',
            day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }
    function formatCompactAbsolute(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) return '';
        return date.toLocaleString(undefined, {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }
    function destroyMessageTippy(clone) {
        if (!clone) return;
        var nodes = clone.querySelectorAll('*');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i]._tippy && typeof nodes[i]._tippy.destroy === 'function') {
                try { nodes[i]._tippy.destroy(); } catch (e) {}
            }
        }
        if (clone._tippy && typeof clone._tippy.destroy === 'function') {
            try { clone._tippy.destroy(); } catch (e) {}
        }
    }

    // ─── STORAGE ──────────────────────────────────────────────────────────
    function getPrefs() {
        try {
            var raw = localStorage.getItem(CONFIG.STORAGE.PREFS);
            var d = raw ? JSON.parse(raw) : {};
            return {
                sound: !!d.sound,
                notifications: !!d.notifications,
                enterToSend: d.enterToSend !== false
            };
        } catch (e) {
            return { sound: false, notifications: false, enterToSend: true };
        }
    }
    function savePrefs(p) {
        try { localStorage.setItem(CONFIG.STORAGE.PREFS, JSON.stringify(p)); } catch (e) {}
    }
    function loadLastSeen() {
        try {
            var v = localStorage.getItem(CONFIG.STORAGE.LAST_SEEN);
            return v ? parseInt(v, 10) || 0 : 0;
        } catch (e) { return 0; }
    }
    function saveLastSeen(ts) {
        try { localStorage.setItem(CONFIG.STORAGE.LAST_SEEN, String(ts)); } catch (e) {}
    }

       // ─── USER DATA (role badges) ──────────────────────────────────────────
    // Posts.js already fetches /api.php?mid=<id> for the same purpose; we
    // reuse the endpoint and cache results aggressively. A cached `null`
    // marks a failed fetch so we don't retry on every poll cycle.
    var userDataCache = new Map();
    var USER_FETCH_TIMEOUT = 8000;

        function fetchUserData(mid) {
        if (mid == null) return Promise.resolve(null);
        
        // HelloBox uses "fc11517378", but the API expects just "11517378"
        var numericId = String(mid).replace(/\D/g, '');
        if (!numericId) return Promise.resolve(null);

        if (userDataCache.has(numericId)) return Promise.resolve(userDataCache.get(numericId));

        return new Promise(function (resolve) {
            var controller = new AbortController();
            var timer = setTimeout(function () { controller.abort(); }, USER_FETCH_TIMEOUT);
            
            fetch('/api.php?mid=' + encodeURIComponent(numericId), {
                credentials: 'include',
                signal: controller.signal
            })
            .then(function (r) {
                clearTimeout(timer);
                if (!r.ok) return null;
                return r.text(); // Get text first to prevent JSON parse crash on 404 HTML
            })
            .then(function (text) {
                if (!text) return null;
                try {
                    var data = JSON.parse(text);
                    var user = data['m' + numericId] || data.info || null;
                    userDataCache.set(numericId, user);
                    resolve(user);
                } catch (e) {
                    resolve(null);
                }
            })
            .catch(function () {
                clearTimeout(timer);
                userDataCache.set(numericId, null);
                resolve(null);
            });
        });
    }

    // Mirrors posts.js resolveGroupBadge. Returns null for regular members
    // and unknown custom groups so the chat isn't plastered with "Member"
    // badges on every line — only elevated roles earn a pill.
    function resolveRole(user) {
        if (!user || !user.group) return null;
        var name = String(user.group.name || '').toLowerCase();
        var cls  = String(user.group.class || '').toLowerCase();
        var body = String(user.group.bodyclass || '').toLowerCase();
        var all  = name + ' ' + cls + ' ' + body;

        if (all.indexOf('founder') !== -1)
            return { className: 'group-founder',    label: 'Founder' };
        if (all.indexOf('administrator') !== -1 || all.indexOf('amministrat') !== -1)
            return { className: 'group-admin',      label: 'Admin' };
        if (all.indexOf('global') !== -1 && all.indexOf('mod') !== -1)
            return { className: 'group-global-mod', label: 'Global Mod' };
        if (all.indexOf('moderator') !== -1 || /\bmod\b/.test(all))
            return { className: 'group-mod',        label: 'Mod' };
        if (all.indexOf('developer') !== -1)
            return { className: 'group-developer',  label: 'Developer' };
        if (all.indexOf('game dev') !== -1 || all.indexOf('game_dev') !== -1)
            return { className: 'group-game-dev',   label: 'Game Dev' };
        if (all.indexOf('fan') !== -1)
            return { className: 'group-fan',        label: 'Fan' };
        return null;
    }

    // Renders the badge into `nicknameEl` and stamps a role class onto
    // `avatarEl` (for the tinted ring). Both happen from the same cached
    // user object. If we already have the user cached, this is synchronous
    // — no flash. Otherwise the badge appears a few hundred ms later.
        function applyRoleIdentity(nicknameEl, avatarEl, msg) {
        if (!msg.user) return;
        var mid = msg.user.id ? String(msg.user.id) : null;

        function paint(user) {
            var role = resolveRole(user);
            if (!role) return;
            if (nicknameEl && nicknameEl.parentNode && !nicknameEl.parentNode.querySelector('.mc-role-badge')) {
                var badge = document.createElement('span');
                badge.className = 'mc-role-badge ' + role.className;
                badge.textContent = role.label;
                nicknameEl.insertAdjacentElement('afterend', badge);
            }
            if (avatarEl) {
                avatarEl.setAttribute('data-role', role.className.replace('group-', ''));
            }
        }

        // 1. Check if HelloBox's React fiber already gave us the group
        if (msg.user.group) {
            paint(msg.user);
            return;
        }

        // 2. Fallback to API
        if (!mid) return;
        if (userDataCache.has(mid)) {
            paint(userDataCache.get(mid));
            return;
        }
        fetchUserData(mid).then(function (user) {
            if (!nicknameEl || !nicknameEl.isConnected) return;
            paint(user);
        });
    }

    // ─── DOM CONSTRUCTION ─────────────────────────────────────────────────
    var els = {};

    function buildFab() {
        var fab = document.createElement('button');
        fab.type = 'button';
        fab.className = 'mc-fab';
        fab.setAttribute('aria-label', 'Open chat');
        fab.innerHTML =
            '<i class="fa-regular fa-comment-dots" aria-hidden="true"></i>' +
            '<span class="mc-fab-badge" hidden></span>';
        fab.addEventListener('click', toggle);
        return fab;
    }
    function buildPanel() {
        var panel = document.createElement('div');
        panel.className = 'mc-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Modern chat');
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = [
            '<div class="mc-header">',
            '  <div class="mc-header-left">',
            '    <div class="mc-title">ShoutBox</div>',
            '    <button type="button" class="mc-presence-chip" aria-label="Online users">',
            '      <span class="mc-presence-dot"></span>',
            '      <span class="mc-presence-count">0 online</span>',
            '    </button>',
            '  </div>',
            '  <div class="mc-header-right">',
            '    <button type="button" class="mc-header-btn mc-btn-settings" aria-label="Settings">',
            '      <i class="fa-regular fa-gear" aria-hidden="true"></i>',
            '    </button>',
            '    <button type="button" class="mc-header-btn mc-btn-close" aria-label="Close">',
            '      <i class="fa-regular fa-xmark" aria-hidden="true"></i>',
            '    </button>',
            '  </div>',
            '</div>',
            '<div class="mc-messages" role="log" aria-live="polite"></div>',
            '<div class="mc-presence-list" hidden></div>',
            '<div class="mc-composer">',
            '  <div class="mc-toolbar" hidden>',
            // Bold / Italic / Underline / Strikethrough are Solid-only in FA
            // (across every tier, including Pro). Code exists in Regular too.
            '    <button type="button" data-cmd="bold" aria-label="Bold"><i class="fa-regular fa-bold" aria-hidden="true"></i></button>',
            '    <button type="button" data-cmd="italic" aria-label="Italic"><i class="fa-regular fa-italic" aria-hidden="true"></i></button>',
            '    <button type="button" data-cmd="underline" aria-label="Underline"><i class="fa-regular fa-underline" aria-hidden="true"></i></button>',
            '    <button type="button" data-cmd="strike" aria-label="Strikethrough"><i class="fa-regular fa-strikethrough" aria-hidden="true"></i></button>',
            '    <button type="button" data-cmd="code" aria-label="Inline code"><i class="fa-regular fa-code" aria-hidden="true"></i></button>',
            '  </div>',
            '  <div class="mc-composer-row">',
            '    <button type="button" class="mc-composer-btn mc-btn-toggle-toolbar" aria-label="Formatting">',
            '      <i class="fa-regular fa-align-left" aria-hidden="true"></i>',
            '    </button>',
            '    <button type="button" class="mc-composer-btn mc-btn-emoji" aria-label="Emoji">',
            '      <i class="fa-regular fa-face-smile" aria-hidden="true"></i>',
            '    </button>',
            '    <div class="mc-editor-wrap">',
            '      <div class="mc-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Write a message..."></div>',
            '    </div>',
            '    <button type="button" class="mc-composer-btn mc-btn-send" aria-label="Send" disabled>',
            '      <i class="fa-regular fa-paper-plane-top" aria-hidden="true"></i>',
            '    </button>',
            '  </div>',
            '  <div class="mc-emoji-picker" hidden></div>',
            '</div>'
        ].join('');

        els.messages = panel.querySelector('.mc-messages');
        els.presenceList = panel.querySelector('.mc-presence-list');
        els.presenceChip = panel.querySelector('.mc-presence-chip');
        els.presenceCount = panel.querySelector('.mc-presence-count');
        els.composer = panel.querySelector('.mc-composer');
        els.toolbar = panel.querySelector('.mc-toolbar');
        els.editorWrap = panel.querySelector('.mc-editor-wrap');
        els.editor = panel.querySelector('.mc-editor');
        els.sendBtn = panel.querySelector('.mc-btn-send');
        els.emojiBtn = panel.querySelector('.mc-btn-emoji');
        els.emojiPicker = panel.querySelector('.mc-emoji-picker');
        els.toggleToolbarBtn = panel.querySelector('.mc-btn-toggle-toolbar');
        els.closeBtn = panel.querySelector('.mc-btn-close');
        els.settingsBtn = panel.querySelector('.mc-btn-settings');

        els.closeBtn.addEventListener('click', close);
        els.settingsBtn.addEventListener('click', showSettings);
        els.presenceChip.addEventListener('click', togglePresenceList);
        els.toggleToolbarBtn.addEventListener('click', function () {
            els.toolbar.hidden = !els.toolbar.hidden;
            els.toggleToolbarBtn.classList.toggle('is-active', !els.toolbar.hidden);
        });
        els.emojiBtn.addEventListener('click', toggleEmojiPicker);
        els.sendBtn.addEventListener('click', function () { submitComposer(); });

        els.toolbar.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-cmd]');
            if (!btn) return;
            e.preventDefault();
            applyFormat(btn.dataset.cmd);
        });

        document.addEventListener('click', function (e) {
            if (!state.open) return;
            if (els.emojiPicker.hidden) return;
            if (els.emojiPicker.contains(e.target) || els.emojiBtn.contains(e.target)) return;
            els.emojiPicker.hidden = true;
        });

        return panel;
    }
    function buildEmojiPicker() {
        var groups = [
            { name: 'Faces', items: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😎','🤔','🤨','🙄','😏','😢','😭','😡','🤯','🥳','😴','🤤','🤗','🤫','🙃'] },
            { name: 'Gestures', items: ['👍','👎','👌','✌️','🤞','🤝','👏','🙌','🙏','💪','👋','✋','🖐️','👊','🤛','🤜','🫶','🤟','🤘','🖖'] },
            { name: 'Hearts', items: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💓','💗','💖','💘','💝'] },
            { name: 'Objects', items: ['🔥','✨','⭐','🌟','💯','🎉','🎊','🎈','🎁','🏆','🥇','💎','👑','🚀','⚡','💡','📌','🔔','🎵','🎶'] }
        ];
        var html = '';
        groups.forEach(function (g) {
            html += '<div class="mc-emoji-group">';
            html += '<div class="mc-emoji-group-title">' + escapeHtml(g.name) + '</div>';
            html += '<div class="mc-emoji-grid">';
            g.items.forEach(function (e) {
                html += '<button type="button" class="mc-emoji-item" data-emoji="' + escapeHtml(e) + '">' + escapeHtml(e) + '</button>';
            });
            html += '</div></div>';
        });
        els.emojiPicker.innerHTML = html;
        els.emojiPicker.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-emoji]');
            if (!btn) return;
            e.preventDefault();
            insertIntoComposer(btn.dataset.emoji);
        });
    }

    // ─── MESSAGE RENDERING ────────────────────────────────────────────────
    function msgHash(srcNode) {
        return srcNode ? srcNode.textContent : '';
    }
    function renderClone(srcNode, msg) {
        if (!srcNode || !msg) return null;
        var clone = srcNode.cloneNode(true);
        clone.classList.add('mc-message');
        clone.setAttribute('data-mc-id', msg.id);
        clone.setAttribute('data-mc-uid', String(msg.user && msg.user.id || clone.getAttribute('data-uid') || ''));

        var nativeActions = clone.querySelector('.hb-actions');
        if (nativeActions) nativeActions.remove();

        var actions = document.createElement('div');
        actions.className = 'mc-message-actions';
        var acts = [];
        if (msg.isQuotable) acts.push({ key: 'quote',  label: 'Quote',  icon: 'fa-regular fa-quote-left' });
        if (msg.isEditable)  acts.push({ key: 'edit',   label: 'Edit',   icon: 'fa-regular fa-pen-to-square' });
        if (msg.isDeletable) acts.push({ key: 'delete', label: 'Delete', icon: 'fa-regular fa-trash-can' });
        acts.forEach(function (a) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'mc-message-action';
            b.setAttribute('data-mc-act', a.key);
            b.setAttribute('aria-label', a.label);
            b.innerHTML = '<i class="' + a.icon + '" aria-hidden="true"></i>';
            actions.appendChild(b);
        });
        if (acts.length) clone.appendChild(actions);

               // Role badge + avatar tint. Cached data → synchronous, uncached →
        // async paint. Safe to fire-and-forget; the clone may be replaced
        // by a fresher one before the fetch resolves, in which case the
        // isConnected check in applyRoleIdentity drops the update.
        applyRoleIdentity(
            clone.querySelector('.hb-nickname'),
            clone.querySelector('.hb-avatar'),
            msg
        );

        // Modern timestamp: <time datetime="ISO"> + rich tooltip.
        var timeEl = clone.querySelector('.hb-time');
        if (timeEl) {
            var date = msg.date instanceof Date ? msg.date : new Date(msg.date);

            var timeNode = document.createElement('time');
            timeNode.className = 'hb-time mc-time';
            if (!isNaN(date.getTime())) {
                timeNode.setAttribute('datetime', date.toISOString());
            }
            timeNode.textContent = relativeTime(date);

            var fullDate = formatFullDate(date);

            if (typeof window.tippy === 'function' && !document.body.classList.contains('guest')) {
                var tipHtml =
                    '<div class="tip-info">' +
                        '<div class="tip-info-title">' +
                            '<i class="fa-regular fa-calendar" aria-hidden="true"></i>' +
                            escapeHtml(fullDate) +
                        '</div>' +
                        '<div class="tip-info-text">Posted ' + escapeHtml(relativeTime(date)) + '</div>' +
                    '</div>';
                timeNode.setAttribute('data-tippy-content', tipHtml);
                try {
                    window.tippy(timeNode, {
                        allowHTML: true,
                        theme: 'emerald',
                        animation: 'fade',
                        placement: 'bottom',
                        offset: [0, 8],
                        arrow: true,
                        appendTo: document.body,
                        delay: [200, 80],
                        touch: false
                    });
                } catch (e) { /* fall through to native title */ }
            } else {
                timeNode.setAttribute('title', formatCompactAbsolute(date));
            }

            timeEl.parentNode.replaceChild(timeNode, timeEl);
        }

        clone.querySelectorAll('.hb-quote-ref').forEach(function (ref) {
            ref.addEventListener('click', function (ev) {
                ev.preventDefault();
                var target = ref.getAttribute('data-msg-id');
                if (target) scrollToMessage(target, true);
            });
        });

        clone.querySelectorAll('.hb-spoiler').forEach(function (sp) {
            sp.addEventListener('click', function () {
                sp.classList.toggle('mc-revealed');
            });
        });

        return clone;
    }
    function syncMessages(canonical) {
        if (canonical.length > CONFIG.HISTORY_LIMIT) {
            canonical = canonical.slice(-CONFIG.HISTORY_LIMIT);
        }
        state.messages = canonical;

        var seen = new Set();
        var lastInserted = null;
        var wasAtBottom = isNearBottom();

        state.dom.forEach(function (entry, id) {
            if (!canonical.some(function (m) { return m.id === id; })) {
                destroyMessageTippy(entry.clone);
                entry.clone.remove();
                state.dom.delete(id);
            }
        });

        canonical.forEach(function (msg, idx) {
            seen.add(msg.id);
            var srcNode = findSourceNodeById(msg.id);
            if (!srcNode) return;
            var hash = msgHash(srcNode);
            var existing = state.dom.get(msg.id);
            if (existing) {
                if (existing.hash !== hash) {
                    var fresh = renderClone(srcNode, msg);
                    if (fresh) {
                        destroyMessageTippy(existing.clone);
                        existing.clone.replaceWith(fresh);
                        state.dom.set(msg.id, { clone: fresh, srcNode: srcNode, hash: hash });
                        lastInserted = fresh;
                    }
                } else {
                    existing.srcNode = srcNode;
                }
            } else {
                var fresh = renderClone(srcNode, msg);
                if (fresh) {
                    els.messages.appendChild(fresh);
                    state.dom.set(msg.id, { clone: fresh, srcNode: srcNode, hash: hash });
                    lastInserted = fresh;
                }
            }
        });

        if (typeof ForumEventBus !== 'undefined' && state.lastSeenAt > 0) {
            var prevLastSeen = state.lastSeenAt;
            var newlyArrived = canonical.filter(function (m) {
                var ts = m.date instanceof Date ? m.date.getTime() : new Date(m.date).getTime();
                return ts > prevLastSeen;
            });
            if (newlyArrived.length) {
                ForumEventBus.trigger('chat:messages', {
                    messages: newlyArrived,
                    unread: state.unread
                });
            }
        }

                updateUnread(wasAtBottom);
        // Only auto-scroll if the user was ALREADY at the bottom.
        // If they scrolled up to read history, leave them there.
        if (wasAtBottom) scheduleScrollToBottom();
    }

    function isNearBottom() {
        if (!els.messages) return true;
        return els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 80;
    }
    function scheduleScrollToBottom() {
        requestAnimationFrame(function () {
            if (!els.messages) return;
            els.messages.scrollTop = els.messages.scrollHeight;
        });
    }
    function scrollToMessage(msgId, flash) {
        var entry = state.dom.get(msgId);
        if (!entry) {
            toast('Message not visible (older than history)', 'warning');
            return;
        }
        entry.clone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (flash) {
            entry.clone.classList.add('mc-flash');
            setTimeout(function () { entry.clone.classList.remove('mc-flash'); }, 1200);
        }
    }

    // ─── UNREAD ───────────────────────────────────────────────────────────
    function updateUnread(wasAtBottom) {
        var latest = state.messages[state.messages.length - 1];
        if (!latest) return;
        var latestTs = latest.date instanceof Date ? latest.date.getTime() : new Date(latest.date).getTime();

        if (state.open && wasAtBottom) {
            state.lastSeenAt = latestTs;
            state.unread = 0;
            saveLastSeen(latestTs);
        } else {
            var newCount = state.messages.filter(function (m) {
                var ts = m.date instanceof Date ? m.date.getTime() : new Date(m.date).getTime();
                return ts > state.lastSeenAt;
            }).length;
            if (newCount > state.unread && state.mounted) {
                maybeNotify(latest);
            }
            state.unread = newCount;
        }
        renderUnreadBadge();
    }
    function renderUnreadBadge() {
        var badge = els.fab && els.fab.querySelector('.mc-fab-badge');
        if (!badge) return;
        if (state.unread > 0 && !state.open) {
            badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
            badge.hidden = false;
        } else {
            badge.hidden = true;
        }
    }
    function maybeNotify(msg) {
        var prefs = getPrefs();
        if (!prefs.notifications) return;
        if (document.visibilityState === 'visible' && state.open) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        var nick = (msg.user && (msg.user.nickname || msg.user.name)) || 'Someone';
        try {
            new Notification(nick, { body: msg.content.replace(/\[[^\]]+\]/g, '').slice(0, 120), tag: 'modern-chat-' + msg.id });
        } catch (e) {}
        if (prefs.sound) playPing();
    }
    function playPing() {
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            var o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = 880;
            g.gain.value = 0.03;
            o.connect(g); g.connect(ctx.destination);
            o.start();
            o.stop(ctx.currentTime + 0.06);
        } catch (e) {}
    }

    // ─── PRESENCE ─────────────────────────────────────────────────────────
    function syncPresence() {
        var users = readOnlineUsers();
        var n = users.length;
        if (els.presenceCount) {
            els.presenceCount.textContent = n === 1 ? '1 online' : n + ' online';
        }
        if (els.presenceList && !els.presenceList.hidden) {
            renderPresenceList(users);
        }
    }
    function renderPresenceList(users) {
        if (!els.presenceList) return;
        if (!users.length) {
            els.presenceList.innerHTML = '<div class="mc-presence-empty">No users online</div>';
            return;
        }
        els.presenceList.innerHTML = users.map(function (u) {
            return '<a class="mc-presence-user" href="' + escapeHtml(u.href || '#') + '" target="_blank" rel="noopener">' +
                (u.avatar ? '<img src="' + escapeHtml(u.avatar) + '" alt="" loading="lazy" decoding="async">' : '<span class="mc-presence-initial">?</span>') +
                '<span>' + escapeHtml(u.name) + '</span>' +
            '</a>';
        }).join('');
    }
    function togglePresenceList() {
        if (!els.presenceList) return;
        var willShow = els.presenceList.hidden;
        els.presenceList.hidden = !willShow;
        if (willShow) renderPresenceList(readOnlineUsers());
    }

    // ─── COMPOSER ─────────────────────────────────────────────────────────
    async function loadTipTap() {
        if (state.tipTapDeps) return state.tipTapDeps;
        var v = '@' + CONFIG.TIPTAP_VERSION;
        var base = 'https://esm.sh/@tiptap/';
        var timeout = new Promise(function (_, rej) {
            setTimeout(function () { rej(new Error('TipTap load timeout')); }, CONFIG.TIPTAP_TIMEOUT_MS);
        });
        var load = Promise.all([
            import(base + 'core' + v),
            import(base + 'starter-kit' + v),
            import(base + 'extension-placeholder' + v),
            import(base + 'extension-underline' + v)
        ]).then(function (mods) {
            return {
                Editor: mods[0].Editor || (mods[0].default && mods[0].default.Editor),
                StarterKit: mods[1].StarterKit || mods[1].default,
                Placeholder: mods[2].Placeholder || mods[2].default,
                Underline: mods[3].Underline || mods[3].default
            };
        });
        state.tipTapDeps = await Promise.race([load, timeout]);
        return state.tipTapDeps;
    }
    async function initComposer() {
        if (state.editor || state.editorMode) return;
        var wrap = els.editorWrap;
        try {
            var deps = await loadTipTap();
            els.editor.textContent = '';
            els.editor.contentEditable = 'false';
            var mount = document.createElement('div');
            wrap.innerHTML = '';
            wrap.appendChild(mount);
            var placeholderExt = deps.Placeholder.configure({ placeholder: 'Write a message...' });
            state.editor = new deps.Editor({
                element: mount,
                extensions: [
                    deps.StarterKit.configure({ heading: false, codeBlock: false, bulletList: false, orderedList: false, blockquote: false, horizontalRule: false }),
                    deps.Underline,
                    placeholderExt
                ],
                content: '',
                editorProps: {
                    attributes: { class: 'mc-tiptap', role: 'textbox', 'aria-multiline': 'true' }
                },
                onUpdate: onComposerUpdate,
                onKeyDown: onComposerKeyDown
            });
            state.editorMode = 'tiptap';
            debug('TipTap composer ready');
        } catch (e) {
            warn('TipTap failed, falling back to contenteditable:', e);
            wrap.innerHTML = '';
            wrap.appendChild(els.editor);
            els.editor.contentEditable = 'true';
            els.editor.addEventListener('input', onComposerUpdate);
            els.editor.addEventListener('keydown', onComposerKeyDown);
            state.editorMode = 'fallback';
        }
    }
    function getComposerHtml() {
        if (state.editorMode === 'tiptap' && state.editor) return state.editor.getHTML();
        if (state.editorMode === 'fallback') return els.editor.innerHTML;
        return '';
    }
    function getComposerText() {
        if (state.editorMode === 'tiptap' && state.editor) return state.editor.getText();
        if (state.editorMode === 'fallback') return els.editor.textContent || '';
        return '';
    }
    function clearComposer() {
        if (state.editorMode === 'tiptap' && state.editor) state.editor.commands.clearContent();
        else if (state.editorMode === 'fallback') els.editor.innerHTML = '';
        updateSendBtn();
    }
    function insertIntoComposer(text) {
        if (state.editorMode === 'tiptap' && state.editor) state.editor.commands.insertContent(text);
        else if (state.editorMode === 'fallback') {
            els.editor.focus();
            document.execCommand('insertText', false, text);
        }
    }
    function applyFormat(cmd) {
        if (state.editorMode === 'tiptap' && state.editor) {
            var c = state.editor.chain().focus();
            switch (cmd) {
                case 'bold':      c.toggleBold().run(); break;
                case 'italic':    c.toggleItalic().run(); break;
                case 'underline': c.toggleUnderline().run(); break;
                case 'strike':    c.toggleStrike().run(); break;
                case 'code':      c.toggleCode().run(); break;
            }
        } else if (state.editorMode === 'fallback') {
            var map = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikeThrough' };
            if (map[cmd]) document.execCommand(map[cmd]);
        }
    }
    function onComposerUpdate() {
        updateSendBtn();
    }
    function onComposerKeyDown(e) {
        if (e.key !== 'Enter') return;
        var prefs = getPrefs();
        if (e.shiftKey) return;
        if (prefs.enterToSend) {
            e.preventDefault();
            submitComposer();
        } else if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            submitComposer();
        }
    }
    function updateSendBtn() {
        var text = getComposerText();
        els.sendBtn.disabled = !text || !text.trim();
    }
    function toggleEmojiPicker() {
        if (!els.emojiPicker) return;
        if (!els.emojiPicker.innerHTML) buildEmojiPicker();
        els.emojiPicker.hidden = !els.emojiPicker.hidden;
    }

    // ─── SEND ─────────────────────────────────────────────────────────────
    function fillHiddenTextarea(text) {
        var root = getHelloBoxRoot();
        if (!root) return false;
        var ta = root.querySelector(CONFIG.TEXTAREA_SELECTOR);
        if (!ta) return false;

        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        if (!nativeSetter || !nativeSetter.set) return false;
        nativeSetter.set.call(ta, text);

        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }
    async function triggerSend() {
        var root = getHelloBoxRoot();
        if (!root) return false;

        await new Promise(function (r) { setTimeout(r, 60); });
        var btn = root.querySelector(CONFIG.SEND_BTN_SELECTOR);
        if (btn && !btn.disabled) {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
        }
        var ta = root.querySelector(CONFIG.TEXTAREA_SELECTOR);
        if (ta) {
            ta.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
            }));
            return true;
        }
        return false;
    }
    async function submitComposer() {
        var html = getComposerHtml();
        var text = getComposerText();
        if (!text || !text.trim()) return;
        var bb = htmlToBB(html);
        if (!bb) { toast('Nothing to send', 'warning'); return; }

        els.sendBtn.disabled = true;
        try {
            var filled = fillHiddenTextarea(bb);
            if (!filled) {
                toast('Cannot reach HelloBox input', 'error');
                return;
            }
            var sent = await triggerSend();
            if (!sent) {
                toast('Send failed', 'error');
                return;
            }
            clearComposer();
            scheduleScrollToBottom();
            if (typeof ForumEventBus !== 'undefined') {
                ForumEventBus.trigger('chat:sent', { bbcode: bb });
            }
            debug('sent:', bb);
        } catch (e) {
            warn('Send error:', e);
            toast('Send failed', 'error');
        } finally {
            updateSendBtn();
        }
    }

    // ─── MESSAGE ACTIONS ──────────────────────────────────────────────────
    function triggerHiddenAction(msgId, actionKey) {
        var srcNode = findSourceNodeById(msgId);
        if (!srcNode) return false;
        var labels = {
            quote: /quota|quote/i,
            edit: /modifica|edit/i,
            delete: /elimina|delete/i
        };
        var target = labels[actionKey];
        if (!target) return false;
        var btns = srcNode.querySelectorAll('.hb-action-btn');
        for (var i = 0; i < btns.length; i++) {
            var tip = btns[i].getAttribute('data-tippy-content') || '';
            if (target.test(tip)) {
                btns[i].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return true;
            }
        }
        warn('No native ' + actionKey + ' button for msg', msgId);
        return false;
    }
    async function doQuote(msgId) {
        var msg = state.messages.find(function (m) { return m.id === msgId; });
        if (!msg) return;
        var nick = (msg.user && (msg.user.nickname || msg.user.name)) || 'user';
        var date = msg.date instanceof Date ? msg.date : new Date(msg.date);
        var quoteLine = '[quote=' + nick + ', ' + formatCompactAbsolute(date) + ']' + msg.content + '[/quote]\n';
        await initComposer();
        insertIntoComposer(quoteLine);
        focusComposer();
    }
    async function doEdit(msgId) {
        triggerHiddenAction(msgId, 'edit');
    }
    function doDelete(msgId) {
        if (!confirm('Delete this message?')) return;
        triggerHiddenAction(msgId, 'delete');
    }
    function onMessageActionsClick(e) {
        var btn = e.target.closest('button[data-mc-act]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var container = btn.closest('.mc-message');
        if (!container) return;
        var msgId = container.getAttribute('data-mc-id');
        var act = btn.getAttribute('data-mc-act');
        if (!msgId || !act) return;
        if (act === 'quote') doQuote(msgId);
        else if (act === 'edit') doEdit(msgId);
        else if (act === 'delete') doDelete(msgId);
    }
    function focusComposer() {
        if (state.editorMode === 'tiptap' && state.editor) state.editor.commands.focus();
        else if (els.editor) els.editor.focus();
    }

    // ─── SETTINGS ─────────────────────────────────────────────────────────
    function showSettings() {
        var prefs = getPrefs();
        var m = document.createElement('div');
        m.className = 'mc-modal-backdrop';
        m.innerHTML =
            '<div class="mc-modal" role="dialog" aria-label="Chat settings">' +
                '<h3>Settings</h3>' +
                '<label class="mc-setting"><input type="checkbox" data-pref="notifications"' + (prefs.notifications ? ' checked' : '') + '> Desktop notifications</label>' +
                '<label class="mc-setting"><input type="checkbox" data-pref="sound"' + (prefs.sound ? ' checked' : '') + '> Play a sound on new message</label>' +
                '<label class="mc-setting"><input type="checkbox" data-pref="enterToSend"' + (prefs.enterToSend ? ' checked' : '') + '> Send on Enter (Shift+Enter for a newline)</label>' +
                '<div class="mc-modal-actions">' +
                    '<button type="button" class="mc-btn-secondary" data-close>Close</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(m);

        m.addEventListener('click', function (e) {
            if (e.target === m || e.target.closest('[data-close]')) {
                m.remove();
            }
        });
        m.querySelectorAll('input[data-pref]').forEach(function (input) {
            input.addEventListener('change', function () {
                var p = getPrefs();
                p[input.dataset.pref] = input.checked;
                savePrefs(p);
                if (input.dataset.pref === 'notifications' && input.checked && 'Notification' in window) {
                    if (Notification.permission === 'default') Notification.requestPermission();
                }
            });
        });
    }

    // ─── LIFECYCLE ────────────────────────────────────────────────────────
    function open() {
        if (state.open || !state.mounted) return;
        state.open = true;
        document.body.setAttribute('data-mc-open', '1');
        els.panel.classList.add('mc-panel-open');
        els.panel.setAttribute('aria-hidden', 'false');
        els.fab.classList.add('mc-fab-hidden');
        requestAnimationFrame(function () {
            scheduleScrollToBottom();
            initComposer();
            focusComposer();
        });
        var latest = state.messages[state.messages.length - 1];
        if (latest) {
            var ts = latest.date instanceof Date ? latest.date.getTime() : new Date(latest.date).getTime();
            state.lastSeenAt = ts;
            state.unread = 0;
            saveLastSeen(ts);
            renderUnreadBadge();
        }
        if (typeof ForumEventBus !== 'undefined') {
            ForumEventBus.trigger('chat:opened', { unreadCleared: state.unread === 0 });
        }
    }
    function close() {
        if (!state.open) return;
        state.open = false;
        document.body.removeAttribute('data-mc-open');
        els.panel.classList.remove('mc-panel-open');
        els.panel.setAttribute('aria-hidden', 'true');
        els.fab.classList.remove('mc-fab-hidden');
        els.emojiPicker.hidden = true;
        if (typeof ForumEventBus !== 'undefined') {
            ForumEventBus.trigger('chat:closed', {});
        }
    }
    function toggle() { state.open ? close() : open(); }

    // ─── POLLING ──────────────────────────────────────────────────────────
    function syncNow() {
        if (!getHelloBoxRoot()) return;
        var canonical = readAllMessages();
        if (!canonical.length) return;
        syncMessages(canonical);
        syncPresence();
    }
    var syncThrottled = throttle(syncNow, 250);

    function startPolling() {
        if (state.pollTimer) return;
        syncNow();
        state.pollTimer = setInterval(syncNow, CONFIG.POLL_MS);

        var root = getHelloBoxRoot();
        if (root && window.MutationObserver) {
            state.mutationObserver = new MutationObserver(syncThrottled);
            var target = root.querySelector(CONFIG.MSG_CONTAINER) || root;
            state.mutationObserver.observe(target, { childList: true, subtree: true, characterData: true });
        }
    }
    function stopPolling() {
        if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
        if (state.mutationObserver) { state.mutationObserver.disconnect(); state.mutationObserver = null; }
    }

    // ─── MOUNT ────────────────────────────────────────────────────────────
    function mount() {
        if (state.mounted) return true;
        if (!getHelloBoxRoot()) return false;
        if (document.querySelector('.mc-fab')) { state.mounted = true; return true; }

        injectNativeHideStyle();

        els.fab = buildFab();
        document.body.appendChild(els.fab);

        els.panel = buildPanel();
        document.body.appendChild(els.panel);

        els.messages.addEventListener('click', onMessageActionsClick);
        els.panel.addEventListener('click', function (e) { e.stopPropagation(); });

        state.lastSeenAt = loadLastSeen();
        state.mounted = true;
        startPolling();

        setTimeout(syncNow, 200);
        debug('mounted');
        return true;
    }

    function injectNativeHideStyle() {
        if (document.getElementById('mc-native-hide')) return;
        var style = document.createElement('style');
        style.id = 'mc-native-hide';
        style.textContent = [
            'hello-box.hb-root {',
            '  position: absolute !important;',
            '  left: -99999px !important;',
            '  top: 0 !important;',
            '  width: 1px !important;',
            '  height: 1px !important;',
            '  overflow: hidden !important;',
            '  visibility: hidden !important;',
            '  pointer-events: none !important;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function boot() {
        var start = Date.now();
        function attempt() {
            if (getHelloBoxRoot()) {
                var ok = mount();
                if (ok) { state.ready = true; return; }
            }
            if (Date.now() - start > CONFIG.MOUNT_TIMEOUT_MS) {
                debug('hello-box not found, chat not mounted');
                return;
            }
            setTimeout(attempt, 400);
        }
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(attempt, 0);
        } else {
            document.addEventListener('DOMContentLoaded', attempt, { once: true });
        }
    }

    // ─── PUBLIC API ───────────────────────────────────────────────────────
    var API = {
        boot: boot,
        mount: mount,
        open: open,
        close: close,
        toggle: toggle,
        openToMessage: function (id) { open(); setTimeout(function () { scrollToMessage(id, true); }, 250); },
        send: function (text) { return initComposer().then(function () { insertIntoComposer(text); return submitComposer(); }); },
        state: state,
        _debug: {
            readAllMessages: readAllMessages,
            getHelloBoxRoot: getHelloBoxRoot,
            syncNow: syncNow,
            htmlToBB: htmlToBB
        }
    };

    API.initialize = function () {
        if (state.mounted) return Promise.resolve(true);
        boot();
        return Promise.resolve(true);
    };

    API.destroy = function () {
        stopPolling();
        if (state.mutationObserver) {
            state.mutationObserver.disconnect();
            state.mutationObserver = null;
        }
        if (els.fab && els.fab.parentNode) els.fab.parentNode.removeChild(els.fab);
        if (els.panel && els.panel.parentNode) els.panel.parentNode.removeChild(els.panel);
        var hideStyle = document.getElementById('mc-native-hide');
        if (hideStyle) hideStyle.remove();
        state.dom.forEach(function (entry) {
            destroyMessageTippy(entry.clone);
        });
                state.mounted = false;
        state.open = false;
        state.messages = [];
        state.dom.clear();
        userDataCache.clear();
    };

    return API;
})();

if (!window.ForumEnhancer) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(function () { ModernChat.boot(); }, 0);
    } else {
        document.addEventListener('DOMContentLoaded', function () { ModernChat.boot(); }, { once: true });
    }
}
