/* =============================================================
   Tagboard Module — Modern chat widget wrapping the legacy
   forumfree tagboard (div#t660892 / ol#tagObject / form[name=tagboard]).
   -------------------------------------------------------------
   • Renders a floating action button (FAB) + right-side drawer.
   • Keeps the legacy tagboard DOM alive but hidden, so its
     polling loop continues to update ol#tagObject.
   • Reads messages by observing ol#tagObject and parsing li items.
   • Writes by writing into #ffmsg and calling the legacy global
     window.ajaxTagRequest536675(1).
   • Deletes by clicking the legacy delete <img onclick="canc(...)">.
   • On pages without #t660892 (anything but index/forum) fetches
     the home page once, extracts the tag block, injects it hidden,
     and re-executes its inline scripts. Cached in sessionStorage.
   ============================================================= */
var TagboardModule = (function (Utils, EventBus) {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================
    var CONFIG = Object.freeze({
        LEGACY_ROOT_ID: 't660892',
        LEGACY_LIST_SELECTOR: '#tagObject',
        LEGACY_FORM_SELECTOR: 'form[name="tagboard"]',
        LEGACY_TEXTAREA_SELECTOR: '#ffmsg',
        LEGACY_HOST_ID: 'chat-legacy-host',

        FAB_ID: 'chat-fab',
        DRAWER_ID: 'chat-drawer',
        BADGE_ID: 'chat-unread-badge',

        MAX_LENGTH: 1000,
        AVATAR_SIZE: 28,

        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 85,

        UPLOAD_WORKER_URL: 'https://imgbb-upload-proxy.nhristakiev.workers.dev/',
        TWEMOJI_BASE: 'https://twemoji.maxcdn.com/v/latest/svg/',

        SS_LEGACY_HTML: 'chat-legacy-html-v1',
        LS_LAST_SEEN: 'chat-last-seen-v1',
        LS_OPEN: 'chat-drawer-open-v1',
        LS_EMOJI_RECENTS: 'chat-emoji-recents-v1',

        FETCH_TIMEOUT: 6000
    });

    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    var LEGACY_COLOR_MAP = {
        green: 'primary', darkgreen: 'primary', limegreen: 'primary',
        blue: 'info', darkblue: 'info', navy: 'info', dodgerblue: 'info',
        cyan: 'info', teal: 'info',
        purple: 'accent', violet: 'accent', magenta: 'accent', fuchsia: 'accent',
        orange: 'warning', gold: 'warning', yellow: 'warning', darkorange: 'warning',
        red: 'danger', darkred: 'danger', crimson: 'danger',
        gray: 'muted', grey: 'muted', silver: 'muted'
    };

    var IMAGE_URL_EXTENSIONS = /\.(?:jpe?g|png|gif|webp|svg|bmp|avif|ico)(?:[?#]|$)/i;
    var IMAGE_URL_HOSTS = [
        'i.imgur.com', 'i.ibb.co', 'i.postimg.cc', 'cdn.discordapp.com',
        'media.discordapp.net', 'pbs.twimg.com', 'i.redd.it', 'lh3.googleusercontent.com'
    ];

    var EMOJI_GROUPS = [
        { name: 'Emojis', emojis: [
            '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘',
            '🥲','😏','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','🤤','🥳','😎','🤓','🧐',
            '🙃','🤐','🤨','😒','🙄','😬','😌','😔','😪','😴','😷','🤒','🤕','🤢','🤮','🤧',
            '🥵','🥶','😵','🤯','😕','😟','🙁','😮','😲','😳','🥺','😨','😥','😢','😭','😱',
            '😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👋',
            '👌','👍','👎','✊','👏','🙏','💪','👀','🤦','🤷','🎉','❤️','💔','🔥','💯','💥'
        ] }
    ];

    // =========================================================================
    // STATE
    // =========================================================================
    var isInitialized = false;
    var state = {
        messages: [],           // display order: oldest → newest
        liveHashes: new Set(),  // hashes currently in the legacy DOM
        unread: 0,
        drawerOpen: false,
        userCache: new Map(),   // mid → api user object
        legacy: { root: null, list: null, form: null, textarea: null, host: null },
        observer: null,
        rafPending: false,
        currentMid: null,
        isSelfAdmin: false,
        pendingFiles: new Map(), // uploadId → File
        uploadAbort: null,
        emojiRecents: []
    };

    // =========================================================================
    // UTILITIES
    // =========================================================================
    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }

    function decodeEntities(str) {
        if (!str || typeof str !== 'string') return str;
        if (str.indexOf('&') === -1) return str;
        var ta = document.createElement('textarea');
        ta.innerHTML = str;
        return ta.value;
    }

    function getBodyLanguage() {
        var cls = (document.body.className || '').split(/\s+/);
        var last = cls[cls.length - 1];
        var eu = ['it','es','fr','de','pt','nl','sv','no','da','fi','pl','hu','cs','ro','bg','el'];
        if (eu.indexOf(last) !== -1) return 'eu';
        return 'us';
    }

    function parseLegacyTagboardTime(text) {
        if (!text) return null;
        var m = text.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
        if (!m) return null;
        var a = parseInt(m[1], 10);
        var b = parseInt(m[2], 10);
        var hh = parseInt(m[3], 10);
        var mm = parseInt(m[4], 10);
        var month, day;
        if (getBodyLanguage() === 'eu') { day = a; month = b; }
        else { month = a; day = b; }
        var now = new Date();
        var year = now.getFullYear();
        var candidate = new Date(year, month - 1, day, hh, mm);
        if (candidate.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
            candidate = new Date(year - 1, month - 1, day, hh, mm);
        }
        return candidate;
    }

    function getRelativeTimeString(date) {
        if (!date || isNaN(date.getTime())) return '';
        var now = new Date();
        var diff = date - now;
        var abs = Math.abs(diff) / 1000;
        var rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'en', { numeric: 'auto' });
        if (abs < 60) return rtf.format(Math.floor(diff / 1000), 'second');
        if (abs < 3600) return rtf.format(Math.floor(diff / 60000), 'minute');
        if (abs < 86400) return rtf.format(Math.floor(diff / 3600000), 'hour');
        if (abs < 2592000) return rtf.format(-Math.floor(abs / 86400), 'day');
        if (abs < 31536000) return rtf.format(-Math.floor(abs / 2592000), 'month');
        return rtf.format(-Math.floor(abs / 31536000), 'year');
    }

    function formatAbsolute(date) {
        if (!date) return '';
        try {
            return date.toLocaleString(undefined, {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return ''; }
    }

    function sameDay(a, b) {
        if (!a || !b) return false;
        return a.getFullYear() === b.getFullYear()
            && a.getMonth() === b.getMonth()
            && a.getDate() === b.getDate();
    }

    function dayLabel(date) {
        if (!date) return '';
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        var diffDays = Math.round((today - target) / 86400000);
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    }

    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function getInitial(name) {
        if (!name) return '?';
        var m = String(name).match(/[\p{L}\p{N}]/u);
        return m ? m[0].toUpperCase() : '?';
    }

    function sanitizeGroupClass(name) {
        if (!name) return 'group-member';
        return 'group-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function isValidUrl(u) {
        if (!u || typeof u !== 'string') return false;
        var t = u.trim();
        if (!/^(https?:)?\/\//i.test(t)) return false;
        if (t === 'http' || t === 'https' || t === '//') return false;
        return true;
    }

    function optimizeAvatar(url, w, h) {
        if (!isValidUrl(url)) return null;
        var low = url.toLowerCase();
        if (low.indexOf('weserv.nl') !== -1 || low.indexOf('data:') === 0) return url;
        var t = url;
        if (t.charAt(0) === '/' && t.charAt(1) === '/') t = 'https:' + t;
        if (t.indexOf('http://') === 0 && window.location.protocol === 'https:') {
            t = t.replace('http://', 'https://');
        }
        return CONFIG.WESERV_CDN + '?url=' + encodeURIComponent(t)
            + '&output=webp&maxage=' + CONFIG.CACHE + '&q=' + CONFIG.QUALITY
            + '&w=' + w + '&h=' + h + '&fit=cover&a=attention&il';
    }

    function isImageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (IMAGE_URL_EXTENSIONS.test(url)) return true;
        try {
            var host = new URL(url).hostname.toLowerCase();
            for (var i = 0; i < IMAGE_URL_HOSTS.length; i++) {
                var known = IMAGE_URL_HOSTS[i];
                if (host === known || host.endsWith('.' + known)) return true;
            }
        } catch (e) {}
        return false;
    }

    function emojiToCodePoint(emoji) {
        var cps = Array.from(emoji).map(function (ch) { return ch.codePointAt(0).toString(16); });
        cps = cps.filter(function (cp) { return cp !== 'fe0f'; });
        return cps.join('-');
    }

    function loadEmojiRecents() {
        try {
            var raw = localStorage.getItem(CONFIG.LS_EMOJI_RECENTS);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }

    function saveEmojiRecents(arr) {
        try { localStorage.setItem(CONFIG.LS_EMOJI_RECENTS, JSON.stringify(arr.slice(0, 16))); } catch (e) {}
    }

    function pushEmojiRecent(e) {
        var arr = loadEmojiRecents();
        var i = arr.indexOf(e);
        if (i !== -1) arr.splice(i, 1);
        arr.unshift(e);
        saveEmojiRecents(arr);
        state.emojiRecents = arr;
    }

    // =========================================================================
    // CURRENT USER
    // =========================================================================
    function getCurrentUserId() {
        var m = (document.body.className || '').match(/\ba(\d{5,})\b/);
        if (m) return m[1];
        var menuLink = document.querySelector('.menuwrap a[href*="MID="]');
        if (menuLink) {
            var mm = menuLink.getAttribute('href').match(/MID=(\d+)/);
            if (mm) return mm[1];
        }
        return null;
    }

    function detectSelfAdmin() {
        var menu = document.querySelector('.menuwrap');
        if (!menu) return false;
        // A rough heuristic: if the account menu contains any link to admin control panel
        return !!menu.querySelector('a[href*="act=Admin"], a[href*="act=admin"]');
    }

    // =========================================================================
    // LEGACY BRIDGE
    // =========================================================================
    function findLegacyRoot() {
        var root = document.getElementById(CONFIG.LEGACY_ROOT_ID);
        if (root) return root;
        // Also try the wrapper
        var wrapper = document.querySelector('.tag > #' + CONFIG.LEGACY_ROOT_ID);
        return wrapper || null;
    }

    function hideLegacyBlock(root) {
        var host = document.getElementById(CONFIG.LEGACY_HOST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = CONFIG.LEGACY_HOST_ID;
            host.setAttribute('aria-hidden', 'true');
            host.style.cssText =
                'position:absolute;left:-9999px;top:-9999px;' +
                'width:1px;height:1px;overflow:hidden;pointer-events:none;';
            document.body.appendChild(host);
        }
        if (root.parentNode !== host) {
            host.appendChild(root);
        }
        state.legacy.host = host;
    }

    function cacheLegacyElements() {
        var root = state.legacy.root;
        if (!root) return false;
        state.legacy.list = root.querySelector(CONFIG.LEGACY_LIST_SELECTOR);
        state.legacy.form = root.querySelector(CONFIG.LEGACY_FORM_SELECTOR);
        state.legacy.textarea = root.querySelector(CONFIG.LEGACY_TEXTAREA_SELECTOR);
        return !!(state.legacy.list && state.legacy.form && state.legacy.textarea);
    }

    async function fetchIndexAndExtract() {
        // Try sessionStorage first
        try {
            var cached = sessionStorage.getItem(CONFIG.SS_LEGACY_HTML);
            if (cached) return cached;
        } catch (e) {}

        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, CONFIG.FETCH_TIMEOUT);
        try {
            var res = await fetch(window.location.origin + '/', {
                credentials: 'same-origin',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) return null;
            var html = await res.text();
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');
            var node = doc.getElementById(CONFIG.LEGACY_ROOT_ID);
            if (!node) return null;
            var blockHtml = node.outerHTML;
            try { sessionStorage.setItem(CONFIG.SS_LEGACY_HTML, blockHtml); } catch (e) {}
            return blockHtml;
        } catch (e) {
            clearTimeout(timeoutId);
            console.warn('[Tagboard] Index fetch failed:', e);
            return null;
        }
    }

    function reinjectScriptsWithin(container) {
        var scripts = Array.prototype.slice.call(container.querySelectorAll('script'));
        scripts.forEach(function (old) {
            var s = document.createElement('script');
            if (old.src) s.src = old.src;
            else s.textContent = old.textContent;
            if (old.type) s.type = old.type;
            // Replace in place — makes the new script execute
            if (old.parentNode) old.parentNode.replaceChild(s, old);
        });
    }

    async function ensureLegacyPresent() {
        var root = findLegacyRoot();
        if (root) {
            state.legacy.root = root;
            hideLegacyBlock(root);
            cacheLegacyElements();
            return true;
        }

        // Not on this page — fetch and inject
        var blockHtml = await fetchIndexAndExtract();
        if (!blockHtml) return false;

        var host = document.getElementById(CONFIG.LEGACY_HOST_ID);
        if (!host) {
            host = document.createElement('div');
            host.id = CONFIG.LEGACY_HOST_ID;
            host.setAttribute('aria-hidden', 'true');
            host.style.cssText =
                'position:absolute;left:-9999px;top:-9999px;' +
                'width:1px;height:1px;overflow:hidden;pointer-events:none;';
            document.body.appendChild(host);
        }
        host.innerHTML = blockHtml;
        state.legacy.host = host;
        state.legacy.root = host.firstElementChild;

        // Scripts must run *after* the DOM is in the live document, so
        // document.tagboard resolves.
        try {
            reinjectScriptsWithin(host);
        } catch (e) {
            console.warn('[Tagboard] Script re-execution failed:', e);
        }

        cacheLegacyElements();
        return !!(state.legacy.list && state.legacy.form && state.legacy.textarea);
    }

    // =========================================================================
    // PARSE / DIFF
    // =========================================================================
    function parseLegacyMessages() {
        var list = state.legacy.list;
        if (!list) return [];

        var lis = list.querySelectorAll('li');
        var out = [];

        for (var i = 0; i < lis.length; i++) {
            var li = lis[i];
            var tmsg = li.querySelector('.tmsg');
            if (!tmsg) continue;

            // Hash
            var hash = null;
            var canDelete = false;
            var delImg = li.querySelector('img[onclick*="canc"]');
            if (delImg) {
                var dm = (delImg.getAttribute('onclick') || '').match(/canc\(this,\s*'([^']+)'\)/);
                if (dm) { hash = dm[1]; canDelete = true; }
            }

            var nickLink = li.querySelector('a.nickname');
            var mid = null;
            var nickname = 'Unknown';
            if (nickLink) {
                var mm = (nickLink.getAttribute('href') || '').match(/MID=(\d+)/);
                if (mm) mid = mm[1];
                var b = nickLink.querySelector('b');
                nickname = (b ? b.textContent : nickLink.textContent).trim();
            }

            var whenEl = li.querySelector('.when');
            var timeText = whenEl ? whenEl.textContent.trim() : '';
            var dateObj = parseLegacyTagboardTime(timeText);

            var body = decodeEntities(tmsg.textContent || '');

            if (!hash) hash = 'nohash_' + mid + '_' + dateObj?.getTime?.() + '_' + body.length;

            out.push({
                hash: hash,
                mid: mid,
                nickname: nickname,
                date: dateObj,
                relative: dateObj ? getRelativeTimeString(dateObj) : timeText,
                absolute: dateObj ? formatAbsolute(dateObj) : timeText,
                body: body,
                canDelete: canDelete
            });
        }

        // Legacy shows newest first; flip so newest is at bottom (chat convention).
        out.reverse();
        return out;
    }

    function onLegacyUpdated() {
        var parsed = parseLegacyMessages();
        var liveHashes = new Set(parsed.map(function (m) { return m.hash; }));

        var survivors = state.messages.filter(function (m) { return liveHashes.has(m.hash); });
        var survivorsChanged = survivors.length !== state.messages.length;

        var existing = new Set(survivors.map(function (m) { return m.hash; }));
        var newMsgs = parsed.filter(function (m) { return !existing.has(m.hash); });

        state.liveHashes = liveHashes;

        if (survivorsChanged) {
            state.messages = survivors;
            renderAllMessages();
        }
        if (newMsgs.length === 0 && !survivorsChanged) return;

        prefetchUsersFor(newMsgs).then(function () {
            state.messages = state.messages.concat(newMsgs);
            appendMessages(newMsgs);
            if (state.drawerOpen) {
                autoScrollOrPill();
            } else {
                state.unread += newMsgs.length;
                updateFabBadge();
            }
        });
    }

    function attachLegacyObserver() {
        if (state.observer) state.observer.disconnect();
        if (!state.legacy.list) return;
        state.observer = new MutationObserver(function () {
            if (state.rafPending) return;
            state.rafPending = true;
            requestAnimationFrame(function () {
                state.rafPending = false;
                try { onLegacyUpdated(); } catch (e) { console.error('[Tagboard] update failed', e); }
            });
        });
        state.observer.observe(state.legacy.list, {
            childList: true, subtree: true, characterData: true
        });
        // Initial pass
        onLegacyUpdated();
    }

    // =========================================================================
    // USER DATA
    // =========================================================================
    async function fetchUser(mid) {
        if (!mid) return null;
        if (state.userCache.has(mid)) return state.userCache.get(mid);
        try {
            var r = await fetch('/api.php?mid=' + encodeURIComponent(mid));
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var data = await r.json();
            var user = data['m' + mid] || data.info;
            if (user && user.id) {
                if (typeof user.nickname === 'string') user.nickname = decodeEntities(user.nickname);
                state.userCache.set(mid, user);
                return user;
            }
        } catch (e) {
            console.warn('[Tagboard] user fetch failed for MID', mid, e);
        }
        state.userCache.set(mid, null);
        return null;
    }

    async function prefetchUsersFor(msgs) {
        var mids = Array.from(new Set(msgs.map(function (m) { return m.mid; }).filter(Boolean)));
        await Promise.all(mids.map(fetchUser));
    }

    function getGroupClassFor(user, fallbackNickname, mid) {
        if (user && user.group && user.group.name) {
            if (user.group.class && user.group.class.indexOf('founder') !== -1) return 'group-founder';
            if (user.group.class && user.group.class.indexOf('admin') !== -1) return 'group-administrator';
            return sanitizeGroupClass(user.group.name);
        }
        return 'group-member';
    }

    // =========================================================================
    // RENDERING
    // =========================================================================
    function renderMessageBody(text) {
        if (!text) return '';
        var html = escapeHtml(text);

        // Simple formatting tags we ourselves produce
        html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>');
        html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>');
        html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>');
        html = html.replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>');
        html = html.replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, function (m, c, inner) {
            var v = LEGACY_COLOR_MAP[String(c).toLowerCase()];
            return v ? '<span class="text-' + v + '">' + inner + '</span>' : inner;
        });
        html = html.replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, function (m, url, label) {
            return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
        });

        // Autolink bare URLs (won't touch already linked ones because those are inside ">...<")
        html = html.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, function (m, pre, url) {
            return pre + '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>';
        });

        // Turn bare image URLs (that became links above) into inline images
        html = html.replace(/<a href="(https?:\/\/[^\s"]+)" target="_blank" rel="noopener noreferrer">\1<\/a>/g, function (m, url) {
            if (!isImageUrl(url)) return m;
            return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="chat-image-link">'
                + '<img src="' + escapeHtml(url) + '" class="chat-image" loading="lazy" decoding="async" alt="">'
                + '</a>';
        });

        return html;
    }

    function buildAvatarHtml(msg, user) {
        var groupClass = getGroupClassFor(user, msg.nickname, msg.mid);
        var avatarUrl = null;
        if (user && user.avatar && isValidUrl(user.avatar)) {
            avatarUrl = optimizeAvatar(user.avatar, CONFIG.AVATAR_SIZE * 2, CONFIG.AVATAR_SIZE * 2);
        }
        if (avatarUrl) {
            return '<img class="chat-msg__avatar ' + groupClass + '" src="' + escapeHtml(avatarUrl) + '" '
                + 'alt="" width="' + CONFIG.AVATAR_SIZE + '" height="' + CONFIG.AVATAR_SIZE + '" loading="lazy">';
        }
        var bg = getColorFromNickname(msg.nickname, msg.mid);
        var init = getInitial(msg.nickname);
        return '<span class="chat-msg__avatar chat-msg__avatar--initial ' + groupClass + '" '
            + 'style="background-color:#' + bg + ';width:' + CONFIG.AVATAR_SIZE + 'px;height:' + CONFIG.AVATAR_SIZE + 'px;font-size:' + Math.round(CONFIG.AVATAR_SIZE * 0.5) + 'px;">'
            + escapeHtml(init) + '</span>';
    }

    function buildMessageHtml(msg) {
        var user = msg.mid ? state.userCache.get(msg.mid) : null;
        var avatarHtml = buildAvatarHtml(msg, user);
        var profileUrl = msg.mid ? ('/?act=Profile&MID=' + encodeURIComponent(msg.mid)) : '#';
        var bodyHtml = renderMessageBody(msg.body);
        var delBtn = msg.canDelete
            ? '<button type="button" class="chat-msg__delete" data-hash="' + escapeHtml(msg.hash) + '" aria-label="Delete message" title="Delete"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>'
            : '';

        return '<article class="chat-msg" data-hash="' + escapeHtml(msg.hash) + '" data-mid="' + escapeHtml(msg.mid || '') + '">'
            + '<div class="chat-msg__gutter">' + avatarHtml + '</div>'
            + '<div class="chat-msg__main">'
            +   '<div class="chat-msg__head">'
            +     '<a class="chat-msg__nickname" href="' + escapeHtml(profileUrl) + '" target="_self" rel="nofollow">' + escapeHtml(msg.nickname) + '</a>'
            +     '<time class="chat-msg__time" datetime="' + (msg.date ? msg.date.toISOString() : '') + '" title="' + escapeHtml(msg.absolute) + '">' + escapeHtml(msg.relative) + '</time>'
            +     delBtn
            +   '</div>'
            +   '<div class="chat-msg__body">' + bodyHtml + '</div>'
            + '</div>'
            + '</article>';
    }

    function buildDayDivider(msg) {
        return '<div class="chat-day-divider"><span>' + escapeHtml(dayLabel(msg.date)) + '</span></div>';
    }

    function getListEl() {
        var list = document.querySelector('#' + CONFIG.DRAWER_ID + ' .chat-drawer__list');
        return list || null;
    }

    function renderAllMessages() {
        var list = getListEl();
        if (!list) return;
        if (state.messages.length === 0) {
            list.innerHTML = '<div class="chat-drawer__empty"><i class="fa-regular fa-comments" aria-hidden="true"></i><p>No messages yet — say hi 👋</p></div>';
            return;
        }
        var html = '';
        var prevDay = null;
        state.messages.forEach(function (m) {
            if (m.date && (!prevDay || !sameDay(prevDay, m.date))) {
                html += buildDayDivider(m);
                prevDay = m.date;
            }
            html += buildMessageHtml(m);
        });
        list.innerHTML = html;
        applyTwemojiToChat(list);
        // Images inside message bodies must not blow up the drawer
        list.querySelectorAll('.chat-image').forEach(function (img) {
            img.addEventListener('load', function () {
                img.classList.add('is-loaded');
            }, { once: true });
            if (img.complete) img.classList.add('is-loaded');
        });
    }

    function appendMessages(msgs) {
        var list = getListEl();
        if (!list) return;
        var empty = list.querySelector('.chat-drawer__empty');
        if (empty) empty.remove();

        var frag = document.createElement('div');
        var prev = state.messages.length > msgs.length ? state.messages[state.messages.length - msgs.length - 1] : null;
        var prevDay = prev && prev.date ? prev.date : null;
        var html = '';
        msgs.forEach(function (m) {
            if (m.date && (!prevDay || !sameDay(prevDay, m.date))) {
                html += buildDayDivider(m);
                prevDay = m.date;
            }
            html += buildMessageHtml(m);
        });
        frag.innerHTML = html;
        while (frag.firstChild) list.appendChild(frag.firstChild);

        applyTwemojiToChat(list);
        list.querySelectorAll('.chat-image').forEach(function (img) {
            if (img.complete) img.classList.add('is-loaded');
            else img.addEventListener('load', function () {
                img.classList.add('is-loaded');
            }, { once: true });
        });
    }

    function applyTwemojiToChat(scope) {
        if (!scope) return;
        if (typeof window.twemoji !== 'undefined' && window.twemoji.parse) {
            try {
                window.twemoji.parse(scope, {
                    base: CONFIG.TWEMOJI_BASE,
                    ext: '.svg',
                    className: 'twemoji'
                });
            } catch (e) {}
        }
    }

    function updateFabBadge() {
        var fab = document.getElementById(CONFIG.FAB_ID);
        if (!fab) return;
        var badge = fab.querySelector('.chat-fab__badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'chat-fab__badge';
            badge.id = CONFIG.BADGE_ID;
            fab.appendChild(badge);
        }
        if (state.unread > 0) {
            badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
            badge.style.display = '';
            fab.classList.add('has-unread');
        } else {
            badge.style.display = 'none';
            fab.classList.remove('has-unread');
        }
    }

    function scrollToBottom(smooth) {
        var list = getListEl();
        if (!list) return;
        list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }

    function isNearBottom(threshold) {
        var list = getListEl();
        if (!list) return true;
        var t = threshold || 40;
        return (list.scrollHeight - list.scrollTop - list.clientHeight) <= t;
    }

    function autoScrollOrPill() {
        var list = getListEl();
        if (!list) return;
        if (isNearBottom(40)) {
            scrollToBottom(true);
            removeJumpPill();
        } else {
            showJumpPill();
        }
    }

    function showJumpPill() {
        var list = getListEl();
        if (!list || list.parentNode.querySelector('.chat-jump-bottom')) return;
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'chat-jump-bottom';
        pill.innerHTML = '<i class="fa-regular fa-arrow-down" aria-hidden="true"></i> New messages';
        pill.addEventListener('click', function () {
            scrollToBottom(true);
            removeJumpPill();
        });
        list.parentNode.appendChild(pill);
    }

    function removeJumpPill() {
        var list = getListEl();
        if (!list) return;
        var p = list.parentNode.querySelector('.chat-jump-bottom');
        if (p) p.remove();
    }

    // =========================================================================
    // LEGACY WRITES
    // =========================================================================
    function legacySend(text) {
        if (!state.legacy.textarea || !state.legacy.form) return false;
        if (typeof window.ajaxTagRequest536675 !== 'function') {
            console.warn('[Tagboard] legacy send helper not available');
            return false;
        }
        var cleaned = String(text || '').replace(/\r?\n/g, ' ').trim();
        if (!cleaned) return false;
        if (cleaned.length > CONFIG.MAX_LENGTH) cleaned = cleaned.slice(0, CONFIG.MAX_LENGTH);
        state.legacy.textarea.value = cleaned;
        try {
            window.ajaxTagRequest536675(1);
            return true;
        } catch (e) {
            console.error('[Tagboard] send failed', e);
            return false;
        }
    }

    function legacyDelete(hash) {
        if (!state.legacy.list) return false;
        var imgs = state.legacy.list.querySelectorAll('img[onclick*="canc"]');
        for (var i = 0; i < imgs.length; i++) {
            var oc = imgs[i].getAttribute('onclick') || '';
            if (oc.indexOf("'" + hash + "'") !== -1) {
                try {
                    imgs[i].click();
                    return true;
                } catch (e) {
                    console.error('[Tagboard] delete failed', e);
                    return false;
                }
            }
        }
        return false;
    }

    // =========================================================================
    // UI — FAB
    // =========================================================================
    function buildFab() {
        var existing = document.getElementById(CONFIG.FAB_ID);
        if (existing) return existing;

        var fab = document.createElement('button');
        fab.id = CONFIG.FAB_ID;
        fab.type = 'button';
        fab.className = 'chat-fab';
        fab.setAttribute('aria-label', 'Open chat');
        fab.setAttribute('aria-expanded', 'false');
        fab.innerHTML = '<i class="fa-regular fa-comments" aria-hidden="true"></i>'
            + '<span class="chat-fab__badge" style="display:none">0</span>';

        fab.addEventListener('click', function () {
            if (state.drawerOpen) closeDrawer();
            else openDrawer();
        });

        document.body.appendChild(fab);
        return fab;
    }

    // =========================================================================
    // UI — DRAWER
    // =========================================================================
    function buildDrawer() {
        var existing = document.getElementById(CONFIG.DRAWER_ID);
        if (existing) return existing;

        var drawer = document.createElement('aside');
        drawer.id = CONFIG.DRAWER_ID;
        drawer.className = 'chat-drawer';
        drawer.setAttribute('role', 'complementary');
        drawer.setAttribute('aria-label', 'Chat');
        drawer.setAttribute('aria-hidden', 'true');
        drawer.innerHTML = ''
            + '<header class="chat-drawer__header">'
            +   '<div class="chat-drawer__title">'
            +     '<i class="fa-regular fa-comments" aria-hidden="true"></i>'
            +     '<h2>Chat</h2>'
            +   '</div>'
            +   '<button type="button" class="chat-drawer__icon-btn" data-chat-action="close" aria-label="Close chat" title="Close">'
            +     '<i class="fa-regular fa-xmark" aria-hidden="true"></i>'
            +   '</button>'
            + '</header>'
            + '<div class="chat-drawer__list" role="log" aria-live="polite" aria-relevant="additions">'
            +   '<div class="chat-drawer__empty">'
            +     '<i class="fa-regular fa-comments" aria-hidden="true"></i>'
            +     '<p>No messages yet — say hi 👋</p>'
            +   '</div>'
            + '</div>';

        var composer = buildComposer();
        drawer.appendChild(composer);

        document.body.appendChild(drawer);

        // List scroll → remove "jump" pill when user reaches bottom
        var listEl = drawer.querySelector('.chat-drawer__list');
        listEl.addEventListener('scroll', function () {
            if (isNearBottom(40)) removeJumpPill();
        }, { passive: true });

        // Close button
        drawer.querySelector('[data-chat-action="close"]').addEventListener('click', closeDrawer);

        // ESC closes
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && state.drawerOpen) {
                closeDrawer();
            }
        });

        return drawer;
    }

    // =========================================================================
    // UI — COMPOSER
    // =========================================================================
    function buildComposer() {
        var wrap = document.createElement('div');
        wrap.className = 'chat-composer';

        // Toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'chat-composer__toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Formatting');

        function makeBtn(icon, label, action, extraClass) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'modern-editor-btn' + (extraClass ? ' ' + extraClass : '');
            b.title = label;
            b.setAttribute('aria-label', label);
            b.innerHTML = '<i class="' + icon + '" aria-hidden="true"></i>';
            b.dataset.chatAction = action;
            toolbar.appendChild(b);
            return b;
        }

        makeBtn('fa-regular fa-bold', 'Bold', 'wrap-bold');
        makeBtn('fa-regular fa-italic', 'Italic', 'wrap-italic');
        makeBtn('fa-regular fa-underline', 'Underline', 'wrap-underline');
        makeBtn('fa-regular fa-strikethrough', 'Strikethrough', 'wrap-strike');

        // Color dropdown
        var colorDrop = document.createElement('div');
        colorDrop.className = 'modern-dropdown';
        var colorBtn = document.createElement('button');
        colorBtn.type = 'button';
        colorBtn.className = 'modern-editor-btn';
        colorBtn.title = 'Text color';
        colorBtn.setAttribute('aria-label', 'Text color');
        colorBtn.setAttribute('aria-haspopup', 'menu');
        colorBtn.setAttribute('aria-expanded', 'false');
        colorBtn.innerHTML = '<i class="fa-regular fa-palette" aria-hidden="true"></i>';
        var colorMenu = document.createElement('div');
        colorMenu.className = 'modern-dropdown-menu';
        colorMenu.setAttribute('role', 'menu');
        colorMenu.innerHTML = ''
            + '<button type="button" class="modern-dropdown-item" data-color="primary"><span class="color-swatch color-swatch--primary"></span> Primary</button>'
            + '<button type="button" class="modern-dropdown-item" data-color="info"><span class="color-swatch color-swatch--info"></span> Info</button>'
            + '<button type="button" class="modern-dropdown-item" data-color="accent"><span class="color-swatch color-swatch--accent"></span> Accent</button>'
            + '<button type="button" class="modern-dropdown-item" data-color="warning"><span class="color-swatch color-swatch--warning"></span> Warning</button>'
            + '<button type="button" class="modern-dropdown-item" data-color="danger"><span class="color-swatch color-swatch--danger"></span> Danger</button>'
            + '<button type="button" class="modern-dropdown-item" data-color="muted"><span class="color-swatch color-swatch--muted"></span> Muted</button>';
        colorDrop.appendChild(colorBtn);
        colorDrop.appendChild(colorMenu);
        toolbar.appendChild(colorDrop);

        makeBtn('fa-regular fa-remove-format', 'Clear formatting', 'clear-format');

        // Separator
        var sep = document.createElement('span');
        sep.className = 'toolbar-separator';
        sep.setAttribute('aria-hidden', 'true');
        toolbar.appendChild(sep);

        var linkBtn = makeBtn('fa-regular fa-link', 'Insert link', 'link');

        // Image dropdown
        var imgDrop = document.createElement('div');
        imgDrop.className = 'modern-dropdown';
        var imgBtn = document.createElement('button');
        imgBtn.type = 'button';
        imgBtn.className = 'modern-editor-btn';
        imgBtn.title = 'Insert image';
        imgBtn.setAttribute('aria-label', 'Insert image');
        imgBtn.setAttribute('aria-haspopup', 'menu');
        imgBtn.setAttribute('aria-expanded', 'false');
        imgBtn.innerHTML = '<i class="fa-regular fa-image" aria-hidden="true"></i>';
        var imgMenu = document.createElement('div');
        imgMenu.className = 'modern-dropdown-menu';
        imgMenu.setAttribute('role', 'menu');
        imgMenu.innerHTML = ''
            + '<button type="button" class="modern-dropdown-item" data-img-action="upload"><i class="fa-regular fa-cloud-arrow-up" aria-hidden="true"></i> Upload from computer</button>'
            + '<button type="button" class="modern-dropdown-item" data-img-action="url"><i class="fa-regular fa-link" aria-hidden="true"></i> Insert by URL</button>';
        imgDrop.appendChild(imgBtn);
        imgDrop.appendChild(imgMenu);
        toolbar.appendChild(imgDrop);

        // Emoji button
        var emojiBtn = makeBtn('fa-regular fa-face-smile', 'Insert emoji', 'emoji');

        // Emoji picker panel
        var emojiPanel = document.createElement('div');
        emojiPanel.className = 'modern-emoji-picker chat-emoji-picker';
        emojiPanel.setAttribute('role', 'dialog');
        emojiPanel.setAttribute('aria-label', 'Emoji picker');
        toolbar.appendChild(emojiPanel);

        // Input + counter
        var inputWrap = document.createElement('div');
        inputWrap.className = 'chat-composer__input-wrap';
        var ta = document.createElement('textarea');
        ta.className = 'chat-composer__input';
        ta.rows = 1;
        ta.maxLength = CONFIG.MAX_LENGTH;
        ta.placeholder = 'Write a message…';
        ta.setAttribute('aria-label', 'Message');
        inputWrap.appendChild(ta);

        // Image preview strip
        var previewStrip = document.createElement('div');
        previewStrip.className = 'chat-image-preview';
        previewStrip.style.display = 'none';
        inputWrap.appendChild(previewStrip);

        // Footer: counter + send
        var footer = document.createElement('div');
        footer.className = 'chat-composer__footer';
        var counter = document.createElement('span');
        counter.className = 'chat-composer__counter';
        counter.textContent = '0 / ' + CONFIG.MAX_LENGTH;
        var sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.className = 'modern-btn modern-btn-primary chat-composer__send';
        sendBtn.innerHTML = '<i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Send';
        sendBtn.disabled = true;
        footer.appendChild(counter);
        footer.appendChild(sendBtn);

        wrap.appendChild(toolbar);
        wrap.appendChild(inputWrap);
        wrap.appendChild(footer);

        // ---- Wire the composer ----
        var hiddenFileInput = document.createElement('input');
        hiddenFileInput.type = 'file';
        hiddenFileInput.accept = 'image/*';
        hiddenFileInput.style.display = 'none';
        wrap.appendChild(hiddenFileInput);

        var autocompleteDropdown = buildEmojiAutocomplete();
        wrap.appendChild(autocompleteDropdown.el);

        attachComposerLogic(wrap, {
            toolbar: toolbar,
            textarea: ta,
            counter: counter,
            sendBtn: sendBtn,
            previewStrip: previewStrip,
            colorBtn: colorBtn,
            colorMenu: colorMenu,
            imgBtn: imgBtn,
            imgMenu: imgMenu,
            emojiBtn: emojiBtn,
            emojiPanel: emojiPanel,
            hiddenFileInput: hiddenFileInput,
            autocomplete: autocompleteDropdown
        });

        return wrap;
    }

    // =========================================================================
    // EMOJI AUTOCOMPLETE (:name)
    // =========================================================================
    function buildEmojiAutocomplete() {
        var EMOJI_NAME_MAP = {
            smile: '🙂', joy: '😂', lol: '😆', wink: '😉', thinking: '🤔',
            cry: '😢', sweat: '😅', eyeroll: '🙄', facepalm: '🤦', hearteyes: '😍',
            party: '🥳', heart: '❤️', fire: '🔥', hundred: '💯', eyes: '👀',
            skull: '💀', thumbsup: '👍', thumbsdown: '👎', clap: '👏', wave: '👋',
            pray: '🙏'
        };

        var el = document.createElement('div');
        el.className = 'mention-suggestions emoticon-suggestions';
        el.style.display = 'none';
        el.setAttribute('role', 'listbox');

        var state = { items: [], idx: 0, query: '', onPick: null };

        function close() {
            el.style.display = 'none';
            state.items = [];
            state.idx = 0;
            state.query = '';
        }

        function build() {
            el.innerHTML = '';
            state.items.forEach(function (item, i) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mention-suggestion-item' + (i === state.idx ? ' is-selected' : '');
                btn.setAttribute('role', 'option');
                var img = document.createElement('img');
                img.className = 'emoticon-suggestion-icon';
                img.src = CONFIG.TWEMOJI_BASE + emojiToCodePoint(item.emoji) + '.svg';
                img.alt = item.emoji;
                img.loading = 'lazy';
                img.onerror = function () {
                    var s = document.createElement('span');
                    s.className = 'emoticon-suggestion-icon';
                    s.textContent = item.emoji;
                    this.replaceWith(s);
                };
                btn.appendChild(img);
                var lbl = document.createElement('span');
                lbl.className = 'mention-suggestion-name';
                lbl.textContent = ':' + item.name;
                btn.appendChild(lbl);
                btn.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    if (state.onPick) state.onPick(item);
                    close();
                });
                el.appendChild(btn);
            });
        }

        function refresh(trigger, textarea) {
            var query = trigger.query.toLowerCase();
            var matches = [];
            Object.keys(EMOJI_NAME_MAP).forEach(function (name) {
                if (name.indexOf(query) === 0) {
                    matches.push({ name: name, emoji: EMOJI_NAME_MAP[name] });
                }
            });
            matches.sort(function (a, b) {
                var aExact = a.name === query ? 0 : 1;
                var bExact = b.name === query ? 0 : 1;
                return aExact - bExact || a.name.localeCompare(b.name);
            });
            if (matches.length === 0) { close(); return; }
            state.items = matches.slice(0, 20);
            state.idx = 0;
            state.query = trigger.query;
            build();

            // Position below the textarea cursor — approximate: above the input
            var rect = textarea.getBoundingClientRect();
            el.style.left = (rect.left + window.pageXOffset) + 'px';
            el.style.top = (rect.bottom + window.pageYOffset - 6) + 'px';
            el.style.transform = 'translateY(-100%)';
            el.style.display = 'block';
        }

        return { el: el, refresh: refresh, close: close, state: state };
    }

    // =========================================================================
    // COMPOSER LOGIC
    // =========================================================================
    function attachComposerLogic(wrap, refs) {
        var ta = refs.textarea;

        function getSelection() {
            return { start: ta.selectionStart, end: ta.selectionEnd };
        }

        function replaceSelection(before, after, placeholder) {
            var sel = getSelection();
            var v = ta.value;
            var selected = v.slice(sel.start, sel.end);
            var inner = selected || placeholder || '';
            var insert = before + inner + after;
            ta.value = v.slice(0, sel.start) + insert + v.slice(sel.end);
            var newStart = sel.start + before.length;
            var newEnd = newStart + inner.length;
            ta.focus();
            ta.setSelectionRange(newStart, newEnd);
            onInput();
        }

        function insertAtCursor(text) {
            var sel = getSelection();
            var v = ta.value;
            ta.value = v.slice(0, sel.start) + text + v.slice(sel.end);
            var newPos = sel.start + text.length;
            ta.focus();
            ta.setSelectionRange(newPos, newPos);
            onInput();
        }

        function updateCounter() {
            var len = ta.value.length;
            refs.counter.textContent = len + ' / ' + CONFIG.MAX_LENGTH;
            if (len > CONFIG.MAX_LENGTH * 0.9) refs.counter.classList.add('is-warn');
            else refs.counter.classList.remove('is-warn');
            if (len >= CONFIG.MAX_LENGTH) refs.counter.classList.add('is-full');
            else refs.counter.classList.remove('is-full');
        }

        function updateSendState() {
            var hasText = ta.value.trim().length > 0;
            var under = ta.value.length <= CONFIG.MAX_LENGTH;
            refs.sendBtn.disabled = !(hasText && under);
        }

        function updateImagePreview() {
            var text = ta.value;
            // Find last image URL in the text
            var m = text.match(/(https?:\/\/[^\s]+)/g);
            var found = null;
            if (m) {
                for (var i = m.length - 1; i >= 0; i--) {
                    if (isImageUrl(m[i])) { found = m[i]; break; }
                }
            }
            if (found) {
                if (refs.previewStrip.dataset.url === found) return;
                refs.previewStrip.dataset.url = found;
                refs.previewStrip.innerHTML = '<img src="' + escapeHtml(found) + '" alt="" loading="lazy">';
                refs.previewStrip.style.display = '';
            } else {
                delete refs.previewStrip.dataset.url;
                refs.previewStrip.innerHTML = '';
                refs.previewStrip.style.display = 'none';
            }
        }

        function autoGrow() {
            ta.style.height = 'auto';
            var max = 6 * 24 + 24; // ~6 rows
            ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
        }

        function onInput() {
            updateCounter();
            updateSendState();
            updateImagePreview();
            autoGrow();
            detectEmoticonTrigger();
        }

        function detectEmoticonTrigger() {
            var sel = getSelection();
            var textBefore = ta.value.slice(0, sel.start);
            var m = textBefore.match(/(?:^|\s):([a-zA-Z0-9_]*)$/);
            if (!m) { refs.autocomplete.close(); return; }
            refs.autocomplete.state.onPick = function (item) {
                var q = refs.autocomplete.state.query;
                var start = sel.start - q.length - 1;
                ta.value = ta.value.slice(0, start) + item.emoji + ta.value.slice(sel.start);
                var pos = start + item.emoji.length;
                ta.focus();
                ta.setSelectionRange(pos, pos);
                pushEmojiRecent(item.emoji);
                onInput();
            };
            refs.autocomplete.refresh({ query: m[1] }, ta);
        }

        // ---- Toolbar actions ----
        refs.toolbar.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-chat-action]');
            if (!btn) return;
            var action = btn.dataset.chatAction;
            switch (action) {
                case 'wrap-bold': replaceSelection('[b]', '[/b]', 'bold'); break;
                case 'wrap-italic': replaceSelection('[i]', '[/i]', 'italic'); break;
                case 'wrap-underline': replaceSelection('[u]', '[/u]', 'underline'); break;
                case 'wrap-strike': replaceSelection('[s]', '[/s]', 'strike'); break;
                case 'clear-format':
                    ta.value = ta.value
                        .replace(/\[b\]|\[\/b\]|\[i\]|\[\/i\]|\[u\]|\[\/u\]|\[s\]|\[\/s\]/gi, '')
                        .replace(/\[color=[^\]]+\]|\[\/color\]/gi, '');
                    onInput();
                    break;
                case 'link': {
                    var url = window.prompt('URL', 'https://');
                    if (!url) break;
                    var sel = getSelection();
                    var label = ta.value.slice(sel.start, sel.end) || url;
                    replaceSelection('[url=' + url + ']', '[/url]', label);
                    break;
                }
                case 'emoji': {
                    var isOpen = refs.emojiPanel.style.display === 'grid';
                    if (isOpen) refs.emojiPanel.style.display = 'none';
                    else {
                        buildEmojiPicker(refs.emojiPanel, function (emoji) {
                            insertAtCursor(emoji);
                            pushEmojiRecent(emoji);
                        });
                        refs.emojiPanel.style.display = 'grid';
                    }
                    break;
                }
            }
        });

        // Color dropdown
        refs.colorBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = refs.colorMenu.style.display === 'block';
            document.querySelectorAll('.modern-dropdown-menu').forEach(function (m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function (b) {
                b.setAttribute('aria-expanded', 'false');
            });
            if (!isOpen) {
                refs.colorMenu.style.display = 'block';
                refs.colorBtn.setAttribute('aria-expanded', 'true');
            }
        });
        refs.colorMenu.addEventListener('click', function (e) {
            var item = e.target.closest('[data-color]');
            if (!item) return;
            var variant = item.dataset.color;
            var variantToLegacy = {
                primary: 'green', info: 'blue', accent: 'purple',
                warning: 'orange', danger: 'red', muted: 'gray'
            };
            var legacy = variantToLegacy[variant] || 'green';
            replaceSelection('[color=' + legacy + ']', '[/color]', 'text');
            refs.colorMenu.style.display = 'none';
            refs.colorBtn.setAttribute('aria-expanded', 'false');
            e.stopPropagation();
        });
        refs.colorMenu.addEventListener('click', function (e) { e.stopPropagation(); });

        // Image dropdown
        refs.imgBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = refs.imgMenu.style.display === 'block';
            document.querySelectorAll('.modern-dropdown-menu').forEach(function (m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function (b) {
                b.setAttribute('aria-expanded', 'false');
            });
            if (!isOpen) {
                refs.imgMenu.style.display = 'block';
                refs.imgBtn.setAttribute('aria-expanded', 'true');
            }
        });
        refs.imgMenu.addEventListener('click', function (e) {
            var item = e.target.closest('[data-img-action]');
            if (!item) return;
            e.stopPropagation();
            refs.imgMenu.style.display = 'none';
            refs.imgBtn.setAttribute('aria-expanded', 'false');
            var action = item.dataset.imgAction;
            if (action === 'url') {
                var url = window.prompt('Image URL', 'https://');
                if (!url) return;
                insertAtCursor(url);
            } else if (action === 'upload') {
                refs.hiddenFileInput.click();
            }
        });
        refs.imgMenu.addEventListener('click', function (e) { e.stopPropagation(); });

        refs.hiddenFileInput.addEventListener('change', function () {
            var f = this.files && this.files[0];
            this.value = '';
            if (!f) return;
            if (!f.type || f.type.indexOf('image/') !== 0) return;
            if (f.size > 32 * 1024 * 1024) {
                alert('Image exceeds the 32 MB limit.');
                return;
            }
            uploadImage(f, function (url) { insertAtCursor(url); });
        });

        // Close dropdowns on outside click
        document.addEventListener('click', function () {
            document.querySelectorAll('.modern-dropdown-menu').forEach(function (m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function (b) {
                b.setAttribute('aria-expanded', 'false');
            });
            if (refs.emojiPanel && refs.emojiPanel.style.display === 'grid') {
                refs.emojiPanel.style.display = 'none';
            }
        });

        // ---- Keyboard ----
        ta.addEventListener('input', onInput);
        ta.addEventListener('keydown', function (e) {
            // Autocomplete capture
            if (refs.autocomplete.el.style.display !== 'none' && refs.autocomplete.state.items.length) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    refs.autocomplete.state.idx = (refs.autocomplete.state.idx + 1) % refs.autocomplete.state.items.length;
                    refs.autocomplete.refresh({ query: refs.autocomplete.state.query }, ta);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    refs.autocomplete.state.idx = (refs.autocomplete.state.idx - 1 + refs.autocomplete.state.items.length) % refs.autocomplete.state.items.length;
                    refs.autocomplete.refresh({ query: refs.autocomplete.state.query }, ta);
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    refs.autocomplete.state.onPick(refs.autocomplete.state.items[refs.autocomplete.state.idx]);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    refs.autocomplete.close();
                    return;
                }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        });

        // Paste: if the pasted content is a single image URL, insert as-is
        ta.addEventListener('paste', function (e) {
            var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
            if (!text) return;
            var trimmed = text.trim();
            if (/^https?:\/\/\S+$/.test(trimmed) && isImageUrl(trimmed)) {
                // Let default paste happen — the URL preview will render
                return;
            }
        });

        // ---- Send ----
        function handleSend() {
            var text = ta.value.trim();
            if (!text) return;
            if (text.length > CONFIG.MAX_LENGTH) {
                alert('Message exceeds ' + CONFIG.MAX_LENGTH + ' characters.');
                return;
            }
            var ok = legacySend(text);
            if (!ok) return;
            // Reset composer optimistically — legacy will send, poll, and
            // re-render with the confirmed message.
            ta.value = '';
            onInput();
            autoGrow();
            refs.sendBtn.disabled = true;
            setTimeout(function () { ta.focus(); }, 0);
        }

        refs.sendBtn.addEventListener('click', handleSend);

        // Initial state
        updateCounter();
        updateSendState();
        autoGrow();
    }

    // =========================================================================
    // EMOJI PICKER
    // =========================================================================
    function buildEmojiPicker(panel, onPick) {
        panel.innerHTML = '';
        var recents = loadEmojiRecents();
        var groups = [];
        if (recents.length) groups.push({ name: 'Recently used', emojis: recents });
        groups = groups.concat(EMOJI_GROUPS);

        groups.forEach(function (group, gi) {
            if (gi > 0) {
                var sep = document.createElement('div');
                sep.className = 'emoji-group-separator';
                sep.setAttribute('aria-hidden', 'true');
                panel.appendChild(sep);
            }
            var lbl = document.createElement('div');
            lbl.className = 'emoji-group-label';
            lbl.textContent = group.name;
            panel.appendChild(lbl);

            group.emojis.forEach(function (emoji) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'modern-emoji-item';
                btn.setAttribute('aria-label', emoji);
                btn.title = emoji;
                var img = document.createElement('img');
                img.src = CONFIG.TWEMOJI_BASE + emojiToCodePoint(emoji) + '.svg';
                img.alt = emoji;
                img.loading = 'lazy';
                img.onerror = function () {
                    btn.innerHTML = '';
                    btn.textContent = emoji;
                    btn.style.fontSize = '1.5rem';
                };
                btn.appendChild(img);
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    onPick(emoji);
                });
                panel.appendChild(btn);
            });
        });
    }

    // =========================================================================
    // IMAGE UPLOAD (shared with messenger pattern)
    // =========================================================================
    function uploadImage(file, onSuccess) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', CONFIG.UPLOAD_WORKER_URL);
        xhr.upload.addEventListener('progress', function (e) {
            // progress feedback optional
        });
        xhr.addEventListener('load', function () {
            if (xhr.status < 200 || xhr.status >= 300) {
                alert('Upload failed: server error (' + xhr.status + ').');
                return;
            }
            try {
                var data = JSON.parse(xhr.responseText);
                if (!data.url) { alert('Upload failed: invalid response.'); return; }
                onSuccess(data.url);
            } catch (e) {
                alert('Upload failed: invalid response.');
            }
        });
        xhr.addEventListener('error', function () { alert('Upload failed: network error.'); });
        var form = new FormData();
        form.append('image', file);
        xhr.send(form);
    }

    // =========================================================================
    // DRAWER OPEN/CLOSE
    // =========================================================================
    function openDrawer() {
        var drawer = document.getElementById(CONFIG.DRAWER_ID);
        var fab = document.getElementById(CONFIG.FAB_ID);
        if (!drawer) return;

        drawer.classList.add('is-open');
        drawer.setAttribute('aria-hidden', 'false');
        state.drawerOpen = true;
        if (fab) {
            fab.classList.add('is-open');
            fab.setAttribute('aria-expanded', 'true');
            fab.setAttribute('aria-label', 'Close chat');
            fab.querySelector('i').className = 'fa-regular fa-xmark';
        }

        // Clear unread
        state.unread = 0;
        updateFabBadge();

        // Persist
        try { localStorage.setItem(CONFIG.LS_OPEN, '1'); } catch (e) {}

        // Focus textarea and scroll to bottom
        requestAnimationFrame(function () {
            var ta = drawer.querySelector('.chat-composer__input');
            if (ta) ta.focus();
            scrollToBottom(false);
        });
    }

    function closeDrawer() {
        var drawer = document.getElementById(CONFIG.DRAWER_ID);
        var fab = document.getElementById(CONFIG.FAB_ID);
        if (!drawer) return;
        drawer.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
        state.drawerOpen = false;
        if (fab) {
            fab.classList.remove('is-open');
            fab.setAttribute('aria-expanded', 'false');
            fab.setAttribute('aria-label', 'Open chat');
            fab.querySelector('i').className = 'fa-regular fa-comments';
        }
        try { localStorage.setItem(CONFIG.LS_OPEN, '0'); } catch (e) {}
    }

    // =========================================================================
    // MESSAGE ACTIONS (delegated)
    // =========================================================================
    function attachDrawerDelegation() {
        document.addEventListener('click', function (e) {
            var del = e.target.closest('.chat-msg__delete');
            if (!del) return;
            e.preventDefault();
            var hash = del.dataset.hash;
            if (!hash) return;
            if (!confirm('Delete this message?')) return;
            del.disabled = true;
            var ok = legacyDelete(hash);
            if (!ok) {
                del.disabled = false;
                alert('Could not delete this message.');
            }
        });
    }

    // =========================================================================
    // INIT
    // =========================================================================
    async function initialize() {
        if (isInitialized) return;
        isInitialized = true;

        state.currentMid = getCurrentUserId();
        state.isSelfAdmin = detectSelfAdmin();
        state.emojiRecents = loadEmojiRecents();

        // 1. FAB + drawer are built regardless of whether the tagboard is
        //    present locally — they will be filled once the legacy block
        //    is available.
        buildFab();
        buildDrawer();
        attachDrawerDelegation();

        // 2. Ensure the legacy tagboard is somewhere in the document
        var ok = await ensureLegacyPresent();
        if (!ok) {
            // Hide FAB; the tagboard is genuinely unavailable
            var fab = document.getElementById(CONFIG.FAB_ID);
            if (fab) fab.style.display = 'none';
            console.warn('[Tagboard] Legacy tagboard not found and could not be injected.');
            return;
        }

        // 3. Observe legacy list changes
        attachLegacyObserver();

        // 4. Restore open state
        try {
            var stored = localStorage.getItem(CONFIG.LS_OPEN);
            if (stored === '1') openDrawer();
        } catch (e) {}

        // 5. Register with forumObserver so it rebuilds after
        //    page transitions inside the SPA-like legacy nav.
        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
            try {
                globalThis.forumObserver.register({
                    id: 'tagboard-rebuild',
                    selector: '.carousel-wrapper',
                    priority: 'low',
                    callback: function () {
                        // Re-resolve legacy references in case the DOM was
                        // rebuilt around us.
                        var root = findLegacyRoot();
                        if (root && root !== state.legacy.root) {
                            state.legacy.root = root;
                            hideLegacyBlock(root);
                            cacheLegacyElements();
                            attachLegacyObserver();
                        }
                    }
                });
            } catch (e) {}
        }

        if (EventBus) EventBus.trigger('tagboard:ready');
        console.log('[Tagboard] Ready');
    }

    function reset() {
        if (state.observer) state.observer.disconnect();
        state.observer = null;
        state.messages = [];
        state.liveHashes = new Set();
        state.userCache.clear();
        state.unread = 0;
        isInitialized = false;
    }

    return {
        initialize: initialize,
        reset: reset,
        name: 'tagboard',
        dependencies: ['forumObserver', 'domUtils', 'eventBus']
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);

if (typeof window !== 'undefined') {
    window.TagboardModule = TagboardModule;
    window.dispatchEvent(new CustomEvent('tagboard-module-ready'));
}
