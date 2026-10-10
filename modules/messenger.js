// Messenger Module – TipTap based, modern preview, relies solely on forumObserver
// v16: editor UX overhaul.
//   - Images are inline nodes: the caret can sit left / right of an image,
//     images can share a line with text, Backspace / Delete / arrow keys
//     behave natively.
//   - Gap cursor is visible (TipTap's default was black-on-dark).
//   - Block-boundary scaffolding covers nested containers and runs once on
//     load; when a deletion leaves only empty scaffolding the document
//     collapses to ONE empty paragraph so the placeholder returns at once.
//   - Image-by-URL inserts instantly (dimensions probed in background).
//   - Image uploads use an id-tracked placeholder node (robust against
//     typing / undo during upload); Send is disabled while uploading;
//     multiple files and drop-position are supported.
//   - Paste an image URL -> image; paste URL over a selection -> link;
//     Ctrl+Shift+V -> plain text.
//   - Fixed: emoticon rule ate the preceding space; syntax highlighter
//     corrupted markup when numbers were present; searches shared one
//     AbortController (recipient / mention / avatar lookups cancelled each
//     other); duplicate Gapcursor extension; foreign selection handling on
//     Escape; toolbar buttons stealing editor focus / hiding before click;
//     nested quote / spoiler serialization; link URL validation
//     (javascript: etc.); preview toggle + preserved expanded state; draft
//     is only cleared once the message is confirmed sent.
var MessengerModule = (function(Utils, EventBus) {
    'use strict';

    var isInitialized = false;
    var isBuilding = false;
    var observerCallbacks = [];
    var cleanupFns = [];
    var _originalEmoticon = null;

    var MAX_MESSAGE_LENGTH = 0;
    var OG_FETCH_TIMEOUT = 8000;
    var UPLOAD_TIMEOUT = 60000;
    var UPLOAD_WORKER_URL = 'https://imgbb-upload-proxy.nhristakiev.workers.dev/';
    var OG_WORKER_URL = 'https://og-worker.nhristakiev.workers.dev/?url=';
    var TWEMOJI_BASE = 'https://twemoji.maxcdn.com/v/latest/svg/';

    var currentUrl = window.location.href;
    var currentSection = 'compose';
    if (currentUrl.indexOf('CODE=01') !== -1) {
        currentSection = 'messages';
    } else if (currentUrl.indexOf('CODE=02') !== -1) {
        currentSection = 'contacts';
    }

    // ------------------------------------------------------------------------
    // SHARED AVATAR COLOR PALETTE
    // ------------------------------------------------------------------------
    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        var colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
        return AVATAR_COLORS[colorIndex];
    }

    function getInitialFromName(name) {
        if (!name || typeof name !== 'string') return '?';
        var match = name.match(/[\p{L}\p{N}]/u);
        if (!match) return '?';
        return match[0].toUpperCase();
    }

    // ------------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------------
    function decodeHtmlEntities(str) {
        if (!str || typeof str !== 'string') return str;
        if (str.indexOf('&') === -1) return str;
        var txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
    }

    function parseTimeString(t) {
        if (t == null) return null;
        var s = String(t).trim().toLowerCase();
        if (!s) return null;
        if (/^\d+$/.test(s)) {
            var n = parseInt(s, 10);
            return n > 0 ? n : null;
        }
        var m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
        if (!m || (!m[1] && !m[2] && !m[3])) return null;
        var h  = parseInt(m[1] || '0', 10);
        var mn = parseInt(m[2] || '0', 10);
        var sc = parseInt(m[3] || '0', 10);
        var total = h * 3600 + mn * 60 + sc;
        return total > 0 ? total : null;
    }

    function ensureTrailingParagraphInHtml(html) {
        if (!html || typeof html !== 'string') return html;
        var d = document.createElement('div');
        d.innerHTML = html;
        var last = d.lastElementChild;
        if (!last) return html;
        if (last.tagName === 'P') return html;
        d.appendChild(document.createElement('p'));
        return d.innerHTML;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    function decodeTextNodesInPlace(node) {
        if (!node) return;
        if (node.nodeType === 3) {
            node.nodeValue = decodeHtmlEntities(node.nodeValue || '');
            return;
        }
        if (node.nodeType === 1) {
            Array.from(node.childNodes).forEach(decodeTextNodesInPlace);
        }
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch(e) { return dateStr; }
    }

    // Validate + normalise a user-typed URL. Returns an absolute href or null.
    function normalizeUrl(raw, allowed) {
        var v = String(raw == null ? '' : raw).trim();
        if (!v || /\s/.test(v)) return null;
        if (/^\/\//.test(v)) v = 'https:' + v;
        if (!/^[a-z][a-z0-9+.\-]*:/i.test(v)) {
            if (/^[^\s\/?#]+\.[^\s\/?#]{2,}/.test(v)) v = 'https://' + v;
            else return null;
        }
        var u;
        try { u = new URL(v); } catch (e) { return null; }
        if (allowed.indexOf(u.protocol) === -1) return null;
        return u.href;
    }

    var IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?[^#]*)?(#.*)?$/i;

    function docIsBlank(doc) {
        var blank = true;
        doc.descendants(function(node) {
            if (!blank) return false;
            if (node.isText) {
                if (/\S/.test(node.text || '')) blank = false;
                return false;
            }
            if (node.isLeaf && node.type.name !== 'hardBreak') blank = false;
            return blank;
        });
        return blank;
    }

    function unwrapLiteEmbedWrappers(html) {
        if (!html || html.indexOf('lite-embed-wrapper') === -1) return html;
        var temp = document.createElement('div');
        temp.innerHTML = html;
        temp.querySelectorAll('div.lite-embed-wrapper').forEach(function(wrapper) {
            var lite = wrapper.querySelector('lite-youtube, lite-vimeo');
            if (!lite) return;
            var videoid = lite.getAttribute('videoid') || wrapper.getAttribute('data-videoid') || '';
            if (!videoid) { wrapper.remove(); return; }
            var title  = wrapper.getAttribute('data-title')  || '';
            var author = wrapper.getAttribute('data-author') || '';
            var start  = wrapper.getAttribute('data-start')  || lite.getAttribute('start') || '';
            var end    = wrapper.getAttribute('data-end')    || lite.getAttribute('end')   || '';
            var kind = lite.tagName.toLowerCase() === 'lite-youtube'
                ? 'ff-lite-youtube'
                : 'ff-lite-vimeo';
            var span = document.createElement('span');
            span.className = kind;
            span.setAttribute('data-videoid', videoid);
            if (title)  span.setAttribute('data-title', title);
            if (author) span.setAttribute('data-author', author);
            if (start)  span.setAttribute('data-start', start);
            if (end)    span.setAttribute('data-end', end);
            wrapper.parentNode.replaceChild(span, wrapper);
        });
        return temp.innerHTML;
    }

    // ------------------------------------------------------------------------
    // SYNTAX HIGHLIGHTING
    // ------------------------------------------------------------------------
    var CODE_HIGHLIGHT_KEYWORDS = [
        'abstract','as','assert','async','await','bool','break','case','catch','class','const','continue',
        'def','default','del','delete','do','elif','else','enum','except','export','extends','False','false',
        'final','finally','float','for','from','func','function','global','goto','if','import','in',
        'int','interface','is','lambda','let','match','module','new','None','null','not','or','pass','print',
        'private','protected','public','raise','return','self','static','str','super','switch','this','throw',
        'True','true','try','typeof','var','void','while','with','yield'
    ].join('|');

    var HIGHLIGHT_TOKEN_RE = new RegExp('\\b(\\d+(?:\\.\\d+)?)\\b|\\b(' + CODE_HIGHLIGHT_KEYWORDS + ')\\b', 'g');
    var NO_HASH_COMMENT_LANGS = /^(c|c\+\+|c#|java|javascript|typescript|css|html|json|xml|sql|rust|go|php|swift|kotlin|lua)$/i;
    var DASH_COMMENT_LANGS = /^(lua|sql)$/i;

    function highlightCode(codeText, lang) {
        if (codeText == null) return '';
        lang = (lang || '').trim();
        var html = String(codeText)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        var stash = [];
        function keep(htmlStr) {
            var key = '\uE000A' + stash.length.toString(36) + 'Z\uE001';
            stash.push(htmlStr);
            return key;
        }

        html = html.replace(/\/\*[\s\S]*?\*\//g, function(m) {
            return keep('<span class="code-comment">' + m + '</span>');
        });

        html = html.replace(/(^|[^:\w])(\/\/[^\n]*)/g, function(m, pre, com) {
            return pre + keep('<span class="code-comment">' + com + '</span>');
        });

        if (DASH_COMMENT_LANGS.test(lang)) {
            html = html.replace(/(--[^\n]*)/g, function(m) {
                return keep('<span class="code-comment">' + m + '</span>');
            });
        }

        if (!NO_HASH_COMMENT_LANGS.test(lang)) {
            html = html.replace(/^(\s*)(#[^\n]*)/gm, function(m, ws, com) {
                if (/^#[0-9a-fA-F]{3,8}$/.test(com.trim())) return m;
                return ws + keep('<span class="code-comment">' + com + '</span>');
            });
        }

        html = html.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, function(m) {
            return keep('<span class="code-string">' + m + '</span>');
        });

        html = html.replace(HIGHLIGHT_TOKEN_RE, function(m, num, kw) {
            if (num != null) return '<span class="code-number">' + num + '</span>';
            return '<span class="code-keyword">' + kw + '</span>';
        });

        html = html.replace(/\uE000A([0-9a-z]+)Z\uE001/g, function(m, idx) {
            return stash[parseInt(idx, 36)];
        });

        return html;
    }

    // ------------------------------------------------------------------------
    // SEND CONFIRMATION
    // ------------------------------------------------------------------------
    var LAST_SEND_KEY = 'messenger-last-send-v1';
    var LAST_SEND_TTL = 60000;

    function stashLastSentMessage(data) {
        try {
            sessionStorage.setItem(
                LAST_SEND_KEY,
                JSON.stringify(Object.assign({}, data, { ts: Date.now() }))
            );
        } catch (e) {}
    }

    function loadLastSentMessage() {
        try {
            var raw = sessionStorage.getItem(LAST_SEND_KEY);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (!data || typeof data !== 'object') return null;
            if (typeof data.ts !== 'number' || Date.now() - data.ts > LAST_SEND_TTL) {
                sessionStorage.removeItem(LAST_SEND_KEY);
                return null;
            }
            return data;
        } catch (e) {
            return null;
        }
    }

    function clearLastSentMessage() {
        try { sessionStorage.removeItem(LAST_SEND_KEY); } catch (e) {}
    }

    function goToSentFolder() {
        var folderSelect = document.querySelector('select[name="VID"]');
        var folderForm = folderSelect ? folderSelect.form : null;
        if (!folderSelect || !folderForm) return;

        for (var i = 0; i < folderSelect.options.length; i++) {
            var opt = folderSelect.options[i];
            var val = String(opt.value || '').toLowerCase();
            var lbl = (opt.textContent || '').trim();
            if (val === 'sent' || /sent|inviat|envoy|gesendet/i.test(lbl)) {
                folderSelect.value = opt.value;
                HTMLFormElement.prototype.submit.call(folderForm);
                return;
            }
        }
    }

    function buildSentBanner(data) {
        var banner = document.createElement('div');
        banner.className = 'modern-send-confirmation';
        banner.setAttribute('role', 'status');

        var nameText = (data && data.name) ? decodeHtmlEntities(data.name) : '';

        var avatarHtml = '';
        if (data && data.id && nameText) {
            var profileUrl = '/?act=Profile&MID=' + encodeURIComponent(data.id);

            if (data.avatar) {
                var avatarUrl = optimizeAvatarUrl(data.avatar, 22, 22) || data.avatar;
                avatarHtml =
                    '<a href="' + escapeHtml(profileUrl) + '" class="modern-send-confirmation-avatar modern-send-confirmation-avatar--image" aria-hidden="true" tabindex="-1">' +
                        '<img src="' + escapeHtml(avatarUrl) + '" alt="" loading="lazy" decoding="async">' +
                    '</a>';
            } else {
                var bgColor = getColorFromNickname(nameText, data.id);
                var initial = getInitialFromName(nameText);
                avatarHtml =
                    '<a href="' + escapeHtml(profileUrl) + '" class="modern-send-confirmation-avatar" ' +
                    'style="background-color:#' + bgColor + ';" aria-hidden="true" tabindex="-1">' +
                        escapeHtml(initial) +
                    '</a>';
            }
        }

        var titleHtml = nameText
            ? 'Message sent to ' + avatarHtml + escapeHtml(nameText)
            : 'Message sent';

        var subjectHtml = (data && data.subject)
            ? '<div class="modern-send-confirmation-subject">' + escapeHtml(data.subject) + '</div>'
            : '';

        banner.innerHTML = ''
            + '<div class="modern-send-confirmation-icon"><i class="fa-regular fa-circle-check" aria-hidden="true"></i></div>'
            + '<div class="modern-send-confirmation-body">'
            +   '<div class="modern-send-confirmation-title">' + titleHtml + '</div>'
            +   subjectHtml
            + '</div>'
            + '<div class="modern-send-confirmation-actions">'
            +   '<button type="button" class="modern-btn modern-btn-secondary modern-send-confirmation-action" data-action="view-sent">View in Sent</button>'
            +   '<button type="button" class="modern-send-confirmation-dismiss" aria-label="Dismiss"><i class="fa-regular fa-xmark"></i></button>'
            + '</div>';

        var viewSentBtn = banner.querySelector('[data-action="view-sent"]');
        if (viewSentBtn) {
            viewSentBtn.addEventListener('click', function(e) {
                e.preventDefault();
                goToSentFolder();
            });
        }

        var dismissBtn = banner.querySelector('.modern-send-confirmation-dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', function() {
                banner.remove();
            });
        }

        return banner;
    }

    // ------------------------------------------------------------------------
    // RECENTS + PER-RECIPIENT DRAFTS
    // ------------------------------------------------------------------------
    var RECENTS_KEY = 'messenger-recents-v1';
    var RECENTS_MAX = 8;

    var DRAFTS_KEY = 'messenger-drafts-v1';
    var DRAFT_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
    var DRAFT_DEBOUNCE_MS = 600;
    var NO_RECIPIENT_KEY = '__no_recipient__';

    function loadRecents() {
        try {
            var raw = localStorage.getItem(RECENTS_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            return arr.filter(function(u) {
                return u && u.id != null && typeof u.name === 'string' && u.name;
            });
        } catch (e) { return []; }
    }

    function pushRecent(user) {
        if (!user || user.id == null || !user.name) return;
        var recents = loadRecents();
        recents = recents.filter(function(u) {
            return String(u.id) !== String(user.id);
        });
        recents.unshift({
            id: String(user.id),
            name: user.name,
            avatar: typeof user.avatar === 'string' ? user.avatar : null,
            ts: Date.now()
        });
        recents = recents.slice(0, RECENTS_MAX);
        try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch (e) {}
    }

    function loadAllDrafts() {
        try {
            var raw = localStorage.getItem(DRAFTS_KEY);
            if (!raw) return {};
            var data = JSON.parse(raw);
            if (!data || typeof data !== 'object') return {};
            var now = Date.now();
            var pruned = {};
            Object.keys(data).forEach(function(k) {
                var d = data[k];
                if (d && typeof d.ts === 'number' && (now - d.ts) < DRAFT_MAX_AGE) {
                    pruned[k] = d;
                }
            });
            return pruned;
        } catch (e) { return {}; }
    }

    function saveAllDrafts(drafts) {
        try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); } catch (e) {}
    }

    function saveDraft(key, draft) {
        var drafts = loadAllDrafts();
        if (draft && (draft.subject || draft.bodyHtml)) {
            drafts[key] = Object.assign({}, draft, { ts: Date.now() });
        } else {
            delete drafts[key];
        }
        saveAllDrafts(drafts);
    }

    function getDraft(key) {
        var drafts = loadAllDrafts();
        return drafts[key] || null;
    }

    function clearDraft(key) {
        var drafts = loadAllDrafts();
        if (drafts[key]) {
            delete drafts[key];
            saveAllDrafts(drafts);
        }
    }

    // ------------------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------------------
    function initialize() {
        if (isInitialized) return Promise.resolve();
        if (document.body.id !== 'msg') return Promise.resolve();
        if (document.getElementById('modern-messenger')) {
            isInitialized = true;
            return Promise.resolve();
        }

        if (!globalThis.forumObserver || typeof globalThis.forumObserver.register !== 'function') {
            console.error('[MessengerModule] forumObserver not available – cannot initialize');
            return Promise.reject(new Error('forumObserver missing'));
        }

        if (currentSection === 'compose') {
            fetchCurrentUserData();
        }

        return new Promise(function(resolve, reject) {
            var wrapperReady = false;
            var targetReady = false;

            function tryBuild() {
                if (wrapperReady && targetReady && !isInitialized && !isBuilding && !document.getElementById('modern-messenger')) {
                    isBuilding = true;
                    waitForGlobalFunctions()
                        .then(function() {
                            try {
                                buildModernMessenger();
                                isInitialized = true;
                                isBuilding = false;
                                if (EventBus) EventBus.trigger('messenger:ready');
                                resolve();
                            } catch (err) {
                                isBuilding = false;
                                console.error('[MessengerModule] Build failed:', err);
                                reject(err);
                            }
                        })
                        .catch(function(err) { isBuilding = false; reject(err); });
                }
            }

            var wrapperObserverId = globalThis.forumObserver.register({
                id: 'messenger-wrapper',
                selector: '#modern-forum-wrapper',
                priority: 'critical',
                callback: function() {
                    wrapperReady = true;
                    if (wrapperObserverId) globalThis.forumObserver.unregister(wrapperObserverId);
                    tryBuild();
                }
            });
            if (wrapperObserverId) observerCallbacks.push(wrapperObserverId);

            var targetSelector = '';
            if (currentSection === 'messages') {
                targetSelector = '.big_list .row-mp';
            } else if (currentSection === 'contacts') {
                targetSelector = 'textarea[name="can_contact"]';
            } else {
                targetSelector = '.cp.send, #Post';
            }

            var targetObserverId = globalThis.forumObserver.register({
                id: 'messenger-target',
                selector: targetSelector,
                priority: 'critical',
                callback: function() {
                    targetReady = true;
                    if (targetObserverId) globalThis.forumObserver.unregister(targetObserverId);
                    tryBuild();
                }
            });
            if (targetObserverId) observerCallbacks.push(targetObserverId);

            setTimeout(function() {
                if (!wrapperReady) wrapperReady = true;
                if (!targetReady) targetReady = true;
                tryBuild();
            }, 1000);
        });
    }

    function reset() {
        isInitialized = false;
        isBuilding = false;
        if (_originalEmoticon !== null) {
            window.emoticon = _originalEmoticon;
            _originalEmoticon = null;
        }
        observerCallbacks.forEach(function(id) {
            if (globalThis.forumObserver && typeof globalThis.forumObserver.unregister === 'function') {
                globalThis.forumObserver.unregister(id);
            }
        });
        observerCallbacks = [];
        cleanupFns.forEach(function(fn) { try { fn(); } catch (e) {} });
        cleanupFns = [];
    }

    function waitForGlobalFunctions() {
        if (currentSection !== 'compose') return Promise.resolve();
        return new Promise(function(resolve) {
            if (typeof tag !== 'undefined' && typeof ajaxRequest !== 'undefined') {
                resolve();
            } else {
                setTimeout(resolve, 300);
            }
        });
    }

    // ------------------------------------------------------------------------
    // TOAST NOTIFICATIONS
    // ------------------------------------------------------------------------
    function ensureToastContainer() {
        var c = document.getElementById('messenger-toasts');
        if (!c) {
            c = document.createElement('div');
            c.id = 'messenger-toasts';
            c.setAttribute('aria-live', 'polite');
            c.setAttribute('aria-atomic', 'true');
            c.style.cssText = 'position:fixed;bottom:var(--space-lg);right:var(--space-lg);z-index:100000;display:flex;flex-direction:column;gap:var(--space-xs);pointer-events:none;';
            document.body.appendChild(c);
        }
        return c;
    }

    function showToast(message, opts) {
        opts = opts || {};
        var type = opts.type || 'info';
        var duration = opts.duration || 3000;

        var bg = 'var(--surface-color)';
        var fg = 'var(--text-primary)';
        var icon = 'fa-regular fa-circle-info';
        var borderColor = 'var(--border-color)';

        if (type === 'success') {
            icon = 'fa-regular fa-circle-check';
            borderColor = 'var(--success-color)';
        } else if (type === 'error') {
            icon = 'fa-regular fa-circle-exclamation';
            borderColor = 'var(--danger-color)';
        } else if (type === 'warning') {
            icon = 'fa-regular fa-triangle-exclamation';
            borderColor = 'var(--warning-color)';
        }

        var toast = document.createElement('div');
        toast.setAttribute('role', 'status');
        toast.style.cssText =
            'display:flex;align-items:center;gap:var(--space-sm);' +
            'padding:var(--pad-3) var(--pad-5);' +
            'background:' + bg + ';color:' + fg + ';' +
            'border:1px solid ' + borderColor + ';border-left-width:3px;' +
            'border-radius:var(--radius);' +
            'box-shadow:var(--shadow-lg);' +
            'font-family:var(--font-primary);font-size:var(--text-sm);' +
            'max-width:360px;pointer-events:auto;' +
            'opacity:0;transform:translateY(8px);' +
            'transition:opacity .2s ease,transform .2s ease;';
        toast.innerHTML =
            '<i class="' + icon + '" aria-hidden="true" style="color:' + borderColor + ';"></i>' +
            '<span style="flex:1;">' + escapeHtml(message) + '</span>';

        var container = ensureToastContainer();
        container.appendChild(toast);

        requestAnimationFrame(function() {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
        }, duration);
    }

    // ------------------------------------------------------------------------
    // CURRENT USER RESOLUTION
    // ------------------------------------------------------------------------
    var _currentUserCache = null;

    function getCurrentUserId() {
        var match = document.body.className.match(/\ba(\d{5,})\b/);
        if (match) return match[1];

        var menuLink = document.querySelector('.menuwrap a[href*="MID="]');
        if (menuLink) {
            var m = menuLink.getAttribute('href').match(/MID=(\d+)/);
            if (m) return m[1];
        }
        return null;
    }

    function getCurrentUserSync() {
        var mid = getCurrentUserId();
        if (!mid) return null;

        var username = null;
        var avatarUrl = null;

        var menu = document.querySelector('.menuwrap');
        if (menu) {
            var nick = menu.querySelector('.nick');
            if (nick) username = decodeHtmlEntities(nick.textContent.trim());

            var img = menu.querySelector('.avatar img');
            if (img && img.src) avatarUrl = img.src;
        }

        return {
            mid: mid,
            nickname: username || null,
            avatar: avatarUrl || null
        };
    }

    function fetchCurrentUserData() {
        if (_currentUserCache) return Promise.resolve(_currentUserCache);
        var mid = getCurrentUserId();
        if (!mid) return Promise.resolve(null);

        return fetch('/api.php?mid=' + mid)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var user = data['m' + mid] || data.info;
                if (user) {
                    user.mid = mid;
                    if (typeof user.nickname === 'string') {
                        user.nickname = decodeHtmlEntities(user.nickname);
                    }
                    if (typeof user.name === 'string') {
                        user.name = decodeHtmlEntities(user.name);
                    }
                    _currentUserCache = user;
                }
                return user || null;
            })
            .catch(function (err) {
                console.warn('[MessengerModule] User fetch failed:', err);
                return null;
            });
    }

    function optimizeAvatarUrl(url, width, height) {
        if (!url || typeof url !== 'string') return null;
        var trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return null;
        if (trimmed === 'http' || trimmed === 'https' || trimmed === '//') return null;
        if (trimmed.indexOf('weserv.nl') !== -1 || trimmed.indexOf('data:') === 0) return trimmed;

        if (trimmed.charAt(0) === '/' && trimmed.charAt(1) === '/') {
            trimmed = 'https:' + trimmed;
        }
        if (trimmed.indexOf('http://') === 0 && window.location.protocol === 'https:') {
            trimmed = trimmed.replace('http://', 'https://');
        }

        return 'https://images.weserv.nl/?url=' + encodeURIComponent(trimmed) +
            '&output=webp&maxage=1y&q=85&w=' + width + '&h=' + height +
            '&fit=cover&a=attention&il';
    }

    function shouldUseInitialAvatar(avatarUrl) {
        if (!avatarUrl || typeof avatarUrl !== 'string') return true;
        var lower = avatarUrl.toLowerCase();
        if (lower.indexOf('img.forumfree.net') !== -1) return true;
        if (lower.indexOf('style_images/default_avatar.png') !== -1) return true;
        if (lower.indexOf('default_avatar') !== -1) return true;
        return false;
    }

    function buildReplyingAsHeader(user) {
        if (!user) return null;

        var username = decodeHtmlEntities(user.nickname) || 'You';
        var mid = user.mid;
        var profileUrl = '/?act=Profile&MID=' + mid;
        var avatarUrl = optimizeAvatarUrl(user.avatar, 36, 36);

        var header = document.createElement('div');
        header.className = 'modern-replying-as';

        var avatarHtml;
        if (avatarUrl) {
            avatarHtml = '<img class="modern-replying-avatar" ' +
                'src="' + escapeHtml(avatarUrl) + '" ' +
                'alt="Avatar of ' + escapeHtml(username) + '" ' +
                'width="36" height="36" loading="lazy" decoding="async">';
        } else {
            var initial = getInitialFromName(username);
            var bgColor = getColorFromNickname(username, mid);
            avatarHtml = '<span class="modern-replying-avatar modern-replying-avatar--initial" ' +
                'style="background-color:#' + bgColor + ';">' +
                escapeHtml(initial) + '</span>';
        }

        header.innerHTML =
            '<span class="modern-replying-label">Replying as:</span>' +
            '<a href="' + escapeHtml(profileUrl) + '" class="modern-replying-user" rel="nofollow">' +
                avatarHtml +
                '<span class="modern-replying-name">' + escapeHtml(username) + '</span>' +
            '</a>';

        return header;
    }

    // ------------------------------------------------------------------------
    // MENTION / USER SEARCH
    // ------------------------------------------------------------------------
    var _searchAborts = {};

    function searchMentions(query, channel) {
        channel = channel || 'default';
        if (!query || query.length < 1) return Promise.resolve([]);

        if (_searchAborts[channel]) {
            try { _searchAborts[channel].abort(); } catch (e) {}
        }
        var controller = new AbortController();
        _searchAborts[channel] = controller;

        var url = '/api.php?search&name=' + encodeURIComponent(query) + '&n=10&cookie=1';

        return fetch(url, {
            credentials: 'include',
            signal: controller.signal
        })
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(function (data) {
            var users = (data && Array.isArray(data.users)) ? data.users : [];
            return users.slice(0, 8).map(function (u) {
                if (u && typeof u.name === 'string') {
                    u = Object.assign({}, u, { name: decodeHtmlEntities(u.name) });
                }
                return u;
            });
        })
        .catch(function (err) {
            if (err && err.name === 'AbortError') return null;
            console.warn('[MessengerModule] Search failed:', err);
            return [];
        });
    }

    // ------------------------------------------------------------------------
    // RECIPIENT AUTOCOMPLETE
    // ------------------------------------------------------------------------
    function attachRecipientAutocomplete(inputEl, onCommit) {
        if (!inputEl) return;

        var popup = null;
        var items = [];
        var selectedIndex = 0;
        var itemEls = [];
        var debounceTimer = null;
        var lastQuery = '';
        var blurCloseTimer = null;

        function reposition() {
            if (!popup || !popup.parentNode) return;
            var rect = inputEl.getBoundingClientRect();
            popup.style.left = (rect.left + window.pageXOffset) + 'px';
            popup.style.top = (rect.bottom + window.pageYOffset + 4) + 'px';
            popup.style.minWidth = Math.max(rect.width, 220) + 'px';
        }

        function closePopup() {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
            if (popup) { popup.remove(); popup = null; }
            items = []; itemEls = []; selectedIndex = 0;
            lastQuery = '';
        }

        function ensurePopup() {
            if (!popup) {
                popup = document.createElement('div');
                popup.className = 'mention-suggestions';
                popup.setAttribute('role', 'listbox');
                document.body.appendChild(popup);
                window.addEventListener('scroll', reposition, true);
                window.addEventListener('resize', reposition);
            }
            return popup;
        }

        function updateSelected() {
            itemEls.forEach(function(el, i) {
                el.classList.toggle('is-selected', i === selectedIndex);
            });
        }

        function makeInitial(name, id) {
            var span = document.createElement('span');
            span.className = 'mention-suggestion-avatar mention-suggestion-avatar--initial';
            span.style.backgroundColor = '#' + getColorFromNickname(name, id);
            span.textContent = getInitialFromName(name);
            return span;
        }

        function commitUser(user) {
            if (!onCommit) return;
            onCommit({
                id: user.id != null ? String(user.id) : null,
                name: decodeHtmlEntities(user.name || ''),
                avatar: typeof user.avatar === 'string' ? user.avatar : null
            });
        }

        function commitFreeText(text) {
            if (!onCommit || !text) return;
            onCommit({ id: null, name: text, avatar: null });
        }

        function buildPopup(users, opts) {
            opts = opts || {};
            if (!popup) return;
            popup.innerHTML = '';
            itemEls = [];
            items = users;
            selectedIndex = 0;

            if (opts.headerText) {
                var header = document.createElement('div');
                header.className = 'mention-suggestions-header';
                header.textContent = opts.headerText;
                popup.appendChild(header);
            }

            if (users.length === 0) {
                if (opts.isRecents) {
                    closePopup();
                    return;
                }
                var empty = document.createElement('div');
                empty.style.cssText = 'padding:var(--pad-2) var(--pad-3);color:var(--text-tertiary);font-size:var(--text-xs);font-style:italic;';
                empty.textContent = 'No users found — press Enter to use "' + inputEl.value.trim() + '"';
                popup.appendChild(empty);
                popup.style.display = 'block';
                return;
            }

            users.forEach(function(user) {
                var el = document.createElement('button');
                el.type = 'button';
                el.className = 'mention-suggestion-item';
                el.setAttribute('role', 'option');

                var rawAvatar = user.avatar;
                var avatarUrl = (rawAvatar && !shouldUseInitialAvatar(rawAvatar))
                    ? (optimizeAvatarUrl(rawAvatar, 28, 28) || rawAvatar)
                    : null;

                if (avatarUrl) {
                    var img = document.createElement('img');
                    img.className = 'mention-suggestion-avatar';
                    img.src = avatarUrl; img.alt = ''; img.width = 28; img.height = 28; img.loading = 'lazy';
                    img.onerror = function() { this.replaceWith(makeInitial(user.name, user.id)); };
                    img.onload = function() {
                        if (this.naturalWidth <= 1 || this.naturalHeight <= 1) {
                            this.replaceWith(makeInitial(user.name, user.id));
                        }
                    };
                    el.appendChild(img);
                } else {
                    el.appendChild(makeInitial(user.name, user.id));
                }

                var name = document.createElement('span');
                name.className = 'mention-suggestion-name';
                name.textContent = decodeHtmlEntities(user.name || '');
                el.appendChild(name);

                el.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    commitUser(user);
                    closePopup();
                });

                itemEls.push(el);
                popup.appendChild(el);
            });

            popup.style.display = 'block';
            updateSelected();
        }

        function showRecents() {
            var recents = loadRecents();
            if (recents.length === 0) { closePopup(); return; }
            ensurePopup();
            buildPopup(recents, { isRecents: true, headerText: 'Recent' });
            reposition();
        }

        function runSearch(query) {
            searchMentions(query, 'recipient').then(function(users) {
                if (users === null) return;
                if (inputEl.value.trim() !== query) return;
                ensurePopup();
                buildPopup(users, {
                    headerText: users.length > 0 ? 'Search results' : null
                });
                reposition();
            });
        }

        inputEl.addEventListener('input', function() {
            var query = inputEl.value.trim();
            if (debounceTimer) clearTimeout(debounceTimer);

            if (!query) {
                lastQuery = '';
                showRecents();
                return;
            }
            if (query === lastQuery) return;
            lastQuery = query;
            debounceTimer = setTimeout(function() { runSearch(query); }, 180);
        });

        inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { closePopup(); return; }

            if (popup && popup.style.display !== 'none' && items.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedIndex = (selectedIndex + 1) % items.length;
                    updateSelected();
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                    updateSelected();
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    commitUser(items[selectedIndex]);
                    closePopup();
                    return;
                }
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                var text = inputEl.value.trim();
                if (text) {
                    commitFreeText(text);
                    closePopup();
                }
            }
        });

        inputEl.addEventListener('focus', function() {
            if (blurCloseTimer) { clearTimeout(blurCloseTimer); blurCloseTimer = null; }
            if (!inputEl.value.trim()) {
                showRecents();
            }
        });

        inputEl.addEventListener('blur', function() {
            blurCloseTimer = setTimeout(closePopup, 150);
        });
    }

    // ------------------------------------------------------------------------
    // SEMANTIC COLOR PALETTE
    // ------------------------------------------------------------------------
    var LEGACY_COLOR_MAP = {
        green: 'primary', darkgreen: 'primary', limegreen: 'primary',
        blue: 'info', darkblue: 'info', navy: 'info', dodgerblue: 'info', cyan: 'info', teal: 'info',
        purple: 'accent', violet: 'accent', magenta: 'accent', fuchsia: 'accent',
        orange: 'warning', gold: 'warning', yellow: 'warning', darkorange: 'warning',
        red: 'danger', darkred: 'danger', crimson: 'danger',
        gray: 'muted', grey: 'muted', silver: 'muted',
        '#008000': 'primary', '#10b981': 'primary', '#059669': 'primary',
        '#0000ff': 'info', '#3b82f6': 'info', '#0ea5e9': 'info', '#0369a1': 'info',
        '#800080': 'accent', '#7c3aed': 'accent', '#6d28d9': 'accent',
        '#ffa500': 'warning', '#f59e0b': 'warning', '#d97706': 'warning',
        '#ff0000': 'danger', '#dc2626': 'danger', '#b91c1c': 'danger',
        '#808080': 'muted', '#6b7280': 'muted'
    };

    function normalizeLegacyColor(raw) {
        if (!raw) return null;
        var key = String(raw).trim().toLowerCase();
        if (/^#[0-9a-f]{3}$/i.test(key)) {
            key = '#' + key[1] + key[1] + key[2] + key[2] + key[3] + key[3];
        }
        return LEGACY_COLOR_MAP[key] || null;
    }

    // ------------------------------------------------------------------------
    // CONVERTERS
    // ------------------------------------------------------------------------
    function legacyToHtml(legacy) {
        if (!legacy) return '';
        var html = legacy;

        html = html.replace(
            /<span[^>]*\bff-spoiler-title\b[^>]*>([\s\S]*?)<\/span>\s*(?:<br\s*\/?>)*\s*\[spoiler\]([\s\S]*?)\[\/spoiler\]/gis,
            function(_, title, body) {
                var decoded = decodeHtmlEntities(title.replace(/<[^>]*>/g, '')).trim();
                return '<div class="spoiler" data-title="' + escapeHtml(decoded) + '">' + body + '</div>';
            }
        );

        html = html.replace(
            /<span[^>]*\bff-code-lang\b[^>]*>([\s\S]*?)<\/span>\s*(?:<br\s*\/?>)*\s*\[code\]([\s\S]*?)\[\/code\]/gis,
            function(_, lang, body) {
                var decoded = decodeHtmlEntities(lang.replace(/<[^>]*>/g, '')).trim();
                return '<pre data-language="' + escapeHtml(decoded) + '"><code>' + body + '</code></pre>';
            }
        );

        html = html.replace(
            /<span\b[^>]*\bff-lite-youtube\b[^>]*>([\s\S]*?)<\/span>/gis,
            function(match) {
                var idMatch     = match.match(/data-videoid="([^"]*)"/);
                var videoid     = idMatch ? decodeHtmlEntities(idMatch[1]) : '';
                if (!videoid) return '';
                var titleMatch  = match.match(/data-title="([^"]*)"/);
                var authorMatch = match.match(/data-author="([^"]*)"/);
                var startMatch  = match.match(/data-start="([^"]*)"/);
                var endMatch    = match.match(/data-end="([^"]*)"/);
                var title  = titleMatch  ? decodeHtmlEntities(titleMatch[1])  : '';
                var author = authorMatch ? decodeHtmlEntities(authorMatch[1]) : '';
                var start  = startMatch  ? decodeHtmlEntities(startMatch[1])  : '';
                var end    = endMatch    ? decodeHtmlEntities(endMatch[1])    : '';
                var attrs = 'videoid="' + escapeHtml(videoid) + '"';
                if (title)  attrs += ' data-title="'  + escapeHtml(title)  + '"';
                if (author) attrs += ' data-author="' + escapeHtml(author) + '"';
                if (start)  attrs += ' start="'       + escapeHtml(start)  + '"';
                if (end)    attrs += ' end="'         + escapeHtml(end)    + '"';
                return '<lite-youtube ' + attrs + '></lite-youtube>';
            }
        );
        html = html.replace(
            /<span\b[^>]*\bff-lite-vimeo\b[^>]*>([\s\S]*?)<\/span>/gis,
            function(match) {
                var idMatch     = match.match(/data-videoid="([^"]*)"/);
                var videoid     = idMatch ? decodeHtmlEntities(idMatch[1]) : '';
                if (!videoid) return '';
                var titleMatch  = match.match(/data-title="([^"]*)"/);
                var authorMatch = match.match(/data-author="([^"]*)"/);
                var startMatch  = match.match(/data-start="([^"]*)"/);
                var title  = titleMatch  ? decodeHtmlEntities(titleMatch[1])  : '';
                var author = authorMatch ? decodeHtmlEntities(authorMatch[1]) : '';
                var start  = startMatch  ? decodeHtmlEntities(startMatch[1])  : '';
                var attrs = 'videoid="' + escapeHtml(videoid) + '"';
                if (title)  attrs += ' data-title="'  + escapeHtml(title)  + '"';
                if (author) attrs += ' data-author="' + escapeHtml(author) + '"';
                if (start)  attrs += ' start="'       + escapeHtml(start)  + '"';
                return '<lite-vimeo ' + attrs + '></lite-vimeo>';
            }
        );

        html = html.replace(/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>');
        html = html.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');
        html = html.replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>');
        html = html.replace(/\[s\](.*?)\[\/s\]/gi, '<s>$1</s>');
        html = html.replace(/\[list\](.*?)\[\/list\]/gis, '<ul>$1</ul>');
        html = html.replace(/\[\*\](.*?)(?=\n|$)/gi, '<li>$1</li>');
        html = html.replace(/\[list=1\](.*?)\[\/list\]/gis, '<ol>$1</ol>');
        html = html.replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gi, '<a href="$1" target="_blank">$2</a>');
        html = html.replace(/\[img\](.*?)\[\/img\]/gi, '<img src="$1" alt="image" loading="lazy" decoding="async">');
        html = html.replace(/\[quote\](.*?)\[\/quote\]/gis, '<blockquote>$1</blockquote>');
        html = html.replace(/\[code\](.*?)\[\/code\]/gis, '<pre><code>$1</code></pre>');
        html = html.replace(/\[spoiler\](.*?)\[\/spoiler\]/gis, '<div class="spoiler">$1</div>');
        html = html.replace(/\[CENTER\](.*?)\[\/CENTER\]/gis, '<div style="text-align:center">$1</div>');
        html = html.replace(/\[font=([^\]]+)\](.*?)\[\/font\]/gis, '$2');

        html = html.replace(/\[size=([^\]]+)\](.*?)\[\/size\]/gis, function(_, sz, content) {
            var n = parseInt(sz, 10);
            if (isNaN(n)) n = 14;
            n = Math.max(10, Math.min(30, n));
            return '<span style="font-size:' + n + 'px">' + content + '</span>';
        });

        html = html.replace(/\[color=([^\]]+)\](.*?)\[\/color\]/gis, function(_, color, content) {
            var variant = normalizeLegacyColor(color);
            return variant
                ? '<span data-color="' + variant + '" class="text-' + variant + '">' + content + '</span>'
                : content;
        });

        html = html.replace(
            /<span[^>]*\bff-inline-code\b[^>]*>([\s\S]*?)<\/span>/gis,
            function(_, content) {
                var decoded = decodeHtmlEntities(content);
                return '<code>' + escapeHtml(decoded) + '</code>';
            }
        );

        html = html.replace(/\[EMAIL\](.*?)\[\/EMAIL\]/gi, '<a href="mailto:$1">$1</a>');
        return html;
    }

    function htmlToLegacy(html) {
        if (!html || typeof html !== 'string') return html;

        html = html.replace(/<span\b[^>]*\bupload-placeholder\b[^>]*>[\s\S]*?<\/span>/gi, '');
        html = unwrapLiteEmbedWrappers(html);

        var result = html;
        var maxIterations = 10;
        for (var i = 0; i < maxIterations; i++) {
            var before = result;

            result = result.replace(
                /<lite-youtube\b[^>]*\bvideoid="([^"]*)"[^>]*>\s*<\/lite-youtube>/gi,
                function(match, videoid) {
                    var startMatch = match.match(/\bstart="([^"]*)"/);
                    var endMatch   = match.match(/\bend="([^"]*)"/);
                    var span = '<span class="ff-lite-youtube" data-videoid="' + escapeHtml(videoid) + '"';
                    if (startMatch) span += ' data-start="' + escapeHtml(startMatch[1]) + '"';
                    if (endMatch)   span += ' data-end="'   + escapeHtml(endMatch[1])   + '"';
                    return span + '></span>';
                }
            );
            result = result.replace(
                /<lite-vimeo\b[^>]*\bvideoid="([^"]*)"[^>]*>\s*<\/lite-vimeo>/gi,
                function(match, videoid) {
                    var startMatch = match.match(/\bstart="([^"]*)"/);
                    var span = '<span class="ff-lite-vimeo" data-videoid="' + escapeHtml(videoid) + '"';
                    if (startMatch) span += ' data-start="' + escapeHtml(startMatch[1]) + '"';
                    return span + '></span>';
                }
            );

            result = result.replace(/<blockquote[^>]*>((?:(?!<blockquote)[\s\S])*?)<\/blockquote>/gi, function(match, inner) {
                var cleaned = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>\s*/gi, '\n');
                cleaned = cleaned.replace(/\n+$/, '');
                return '[QUOTE]' + cleaned + '[/QUOTE]';
            });

            result = result.replace(/<div\b([^>]*\bclass="[^"]*\bspoiler\b[^"]*"[^>]*)>((?:(?!<div\b)[\s\S])*?)<\/div>/gi, function(match, attrs, inner) {
                var cleaned = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>\s*/gi, '\n');
                cleaned = cleaned.replace(/\n+$/, '');

                var titleMatch = attrs.match(/data-title="([^"]*)"/);
                var title = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : '';

                var prefix = title
                    ? '<span class="ff-spoiler-title">' + escapeHtml(title) + '</span>'
                    : '';
                return prefix + '[SPOILER]' + cleaned + '[/SPOILER]';
            });

            result = result.replace(/<pre([^>]*)>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, function(match, preAttrs, inner) {
                var plain = inner.replace(/<[^>]*>/g, '');
                var decoded = plain
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");

                var langMatch = preAttrs.match(/data-language="([^"]*)"/);
                var lang = langMatch ? decodeHtmlEntities(langMatch[1]).trim() : '';

                var prefix = lang
                    ? '<span class="ff-code-lang">' + escapeHtml(lang) + '</span>'
                    : '';
                return prefix + '[CODE]' + decoded + '[/CODE]';
            });

            result = result.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, function(match, inner) {
                return '<span class="ff-inline-code">' + inner + '</span>';
            });

            if (result === before) break;
        }

        result = result.replace(/<p>\s*<\/p>/g, '');

        return result;
    }

    // ------------------------------------------------------------------------
    // PREVIEW HTML TRANSFORM
    // ------------------------------------------------------------------------
    function transformPreviewHtml(html) {
        if (!html || typeof html !== 'string') return html;

        var temp = document.createElement('div');
        temp.innerHTML = html;

        Array.from(temp.querySelectorAll('blockquote')).reverse().forEach(function(bq) {
            var innerHtml = bq.innerHTML;
            var modernHtml =
                '<div class="modern-quote long-quote">' +
                    '<div class="quote-header">' +
                        '<div class="quote-meta">' +
                            '<div class="quote-icon"><i class="fa-regular fa-quote-left" aria-hidden="true"></i></div>' +
                            '<div class="quote-info">' +
                                '<span class="quote-author">Quote</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="quote-content">' + innerHtml + '</div>' +
                    '<button class="quote-expand-btn" type="button" aria-expanded="false" aria-label="Show full quote">' +
                        '<i class="fa-regular fa-angle-down" aria-hidden="true"></i> <span class="expand-text">Show more</span>' +
                    '</button>' +
                '</div>';
            var wrapper = document.createElement('div');
            wrapper.innerHTML = modernHtml;
            if (bq.parentNode) bq.parentNode.replaceChild(wrapper.firstElementChild, bq);
        });

        Array.from(temp.querySelectorAll('div.spoiler')).reverse().forEach(function(sp) {
            var innerHtml = sp.innerHTML;
            var title = sp.getAttribute('data-title') || 'Spoiler';
            var spoilerId = 'preview-spoiler-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
            var modernHtml =
                '<div class="modern-spoiler">' +
                    '<div class="spoiler-header" role="button" tabindex="0" aria-expanded="false">' +
                        '<div class="spoiler-icon"><i class="fa-regular fa-eye-slash" aria-hidden="true"></i></div>' +
                        '<div class="spoiler-info"><span class="spoiler-title">' + escapeHtml(title) + '</span></div>' +
                        '<button class="spoiler-toggle" type="button" aria-expanded="false" aria-controls="' + spoilerId + '">' +
                            '<i class="fa-regular fa-angle-down" aria-hidden="true"></i>' +
                        '</button>' +
                    '</div>' +
                    '<div id="' + spoilerId + '" class="spoiler-content" aria-hidden="true">' +
                        '<div class="spoiler-content-inner">' + innerHtml + '</div>' +
                    '</div>' +
                '</div>';
            var wrapper = document.createElement('div');
            wrapper.innerHTML = modernHtml;
            if (sp.parentNode) sp.parentNode.replaceChild(wrapper.firstElementChild, sp);
        });

        Array.from(temp.querySelectorAll('pre')).forEach(function(pre) {
            if (pre.closest('.modern-code')) return;
            var code = pre.querySelector('code');
            var rawText = code ? (code.textContent || '') : (pre.textContent || '');
            var langRaw = (pre.getAttribute('data-language') || '').trim();
            var codeContent = highlightCode(rawText, langRaw);
            var lang = langRaw || 'Code';
            var modernHtml =
                '<div class="modern-code">' +
                    '<div class="code-header" style="cursor: default;">' +
                        '<div class="code-icon"><i class="fa-regular fa-code" aria-hidden="true"></i></div>' +
                        '<div class="code-info"><span class="code-title">' + escapeHtml(lang) + '</span></div>' +
                        '<button class="code-copy-btn" type="button" aria-label="Copy code" tabindex="0"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>' +
                    '</div>' +
                    '<div class="code-content collapsible-content"><pre><code>' + codeContent + '</code></pre></div>' +
                    '<button class="code-expand-btn" type="button" aria-expanded="false" aria-label="Show full code">' +
                        '<i class="fa-regular fa-angle-down" aria-hidden="true"></i> <span class="expand-text">Show more</span>' +
                    '</button>' +
                '</div>';
            var wrapper = document.createElement('div');
            wrapper.innerHTML = modernHtml;
            if (pre.parentNode) pre.parentNode.replaceChild(wrapper.firstElementChild, pre);
        });

        Array.from(temp.querySelectorAll('span.ff-nsfw')).forEach(function(sp) {
            var replacement = document.createElement('span');
            replacement.className = 'nsfw-tag';
            replacement.setAttribute('role', 'button');
            replacement.setAttribute('tabindex', '0');
            replacement.setAttribute('aria-pressed', 'false');
            replacement.setAttribute('aria-label', 'Hidden content, click to reveal');
            replacement.innerHTML = sp.innerHTML;
            decodeTextNodesInPlace(replacement);
            if (sp.parentNode) sp.parentNode.replaceChild(replacement, sp);
        });

        Array.from(temp.querySelectorAll('img[data-nsfw="true"]')).forEach(function(img) {
            if (img.closest('.nsfw-image')) return;
            var wrapper = document.createElement('span');
            wrapper.className = 'nsfw-image';
            wrapper.setAttribute('role', 'button');
            wrapper.setAttribute('tabindex', '0');
            wrapper.setAttribute('aria-pressed', 'false');
            wrapper.setAttribute('aria-label', 'Hidden image, click to reveal');
            var w = img.getAttribute('width');
            var h = img.getAttribute('height');
            if (w && h) {
                wrapper.style.width = w + 'px';
                wrapper.style.aspectRatio = w + '/' + h;
                wrapper.style.maxWidth = '100%';
            }
            var dataSize = img.getAttribute('data-size');
            if (dataSize === 'small') wrapper.style.maxWidth = '25%';
            else if (dataSize === 'medium') wrapper.style.maxWidth = '50%';
            else if (dataSize === 'large') wrapper.style.maxWidth = '75%';
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
        });

        return temp.innerHTML;
    }

    // ------------------------------------------------------------------------
    // PREVIEW INTERACTION HANDLERS
    // ------------------------------------------------------------------------
    function handlePreviewQuoteExpand(btn) {
        var quote = btn.closest('.modern-quote');
        if (!quote) return;
        var content = quote.querySelector('.quote-content');
        if (!content) return;

        var isExpanded = quote.classList.contains('expanded');

        if (isExpanded) {
            content.style.maxHeight = content.scrollHeight + 'px';
            void content.offsetHeight;
            content.style.maxHeight = '';
            quote.classList.remove('expanded');
        } else {
            content.style.maxHeight = content.scrollHeight + 'px';
            quote.classList.add('expanded');

            var cleanup = function (e) {
                if (e.propertyName !== 'max-height') return;
                content.removeEventListener('transitionend', cleanup);
                if (quote.classList.contains('expanded')) {
                    content.style.maxHeight = '';
                }
            };
            content.addEventListener('transitionend', cleanup);
        }

        btn.setAttribute('aria-expanded', String(!isExpanded));
        var textSpan = btn.querySelector('.expand-text');
        if (textSpan) {
            textSpan.textContent = isExpanded ? 'Show more' : 'Show less';
        }
    }

    function handlePreviewCodeExpand(btn) {
        var codeBlock = btn.closest('.modern-code');
        if (!codeBlock) return;
        var content = codeBlock.querySelector('.code-content');
        if (!content) return;

        var isExpanded = codeBlock.classList.contains('expanded');

        if (isExpanded) {
            content.style.maxHeight = content.scrollHeight + 'px';
            void content.offsetHeight;
            content.style.maxHeight = '';
            codeBlock.classList.remove('expanded');
        } else {
            content.style.maxHeight = content.scrollHeight + 'px';
            codeBlock.classList.add('expanded');

            var cleanup = function (e) {
                if (e.propertyName !== 'max-height') return;
                content.removeEventListener('transitionend', cleanup);
                if (codeBlock.classList.contains('expanded')) {
                    content.style.maxHeight = '';
                }
            };
            content.addEventListener('transitionend', cleanup);
        }

        btn.setAttribute('aria-expanded', String(!isExpanded));
        var textSpan = btn.querySelector('.expand-text');
        if (textSpan) {
            textSpan.textContent = isExpanded ? 'Show more' : 'Show less';
        }
    }

    function copyTextToClipboard(text, onDone) {
        function fallback() {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
            document.body.appendChild(textarea);
            textarea.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(textarea);
            if (ok && onDone) onDone();
            return ok;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                if (onDone) onDone();
            }).catch(function() { fallback(); });
        } else {
            fallback();
        }
    }

    function handlePreviewCodeCopy(btn) {
        var codeBlock = btn.closest('.modern-code');
        if (!codeBlock) return;
        var codeContent = codeBlock.querySelector('.code-content code');
        if (!codeContent) return;
        var text = codeContent.textContent;

        copyTextToClipboard(text, function() {
            var icon = btn.querySelector('i');
            if (!icon) return;
            var originalClass = icon.className;
            icon.className = 'fa-regular fa-check';
            setTimeout(function() { icon.className = originalClass; }, 1500);
        });
    }

    function handlePreviewSpoilerToggle(trigger) {
        var header = trigger.closest('.spoiler-header');
        if (!header) return;
        var spoiler = header.closest('.modern-spoiler');
        if (!spoiler) return;
        var content = spoiler.querySelector('.spoiler-content');
        var toggleBtn = header.querySelector('.spoiler-toggle');
        if (!content) return;

        var isExpanded = spoiler.classList.contains('expanded');

        if (isExpanded) {
            content.style.maxHeight = content.scrollHeight + 'px';
            void content.offsetHeight;
            content.style.maxHeight = '0';
            spoiler.classList.remove('expanded');
        } else {
            var targetHeight = content.scrollHeight;
            if (targetHeight <= 0) return;
            content.style.maxHeight = targetHeight + 'px';
            spoiler.classList.add('expanded');
        }

        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
        header.setAttribute('aria-expanded', String(!isExpanded));
        content.setAttribute('aria-hidden', String(isExpanded));
    }

    function handlePreviewNSFWToggle(el) {
        var isRevealed = el.classList.toggle('revealed');
        el.setAttribute('aria-pressed', String(isRevealed));
    }

    function attachPreviewHandlers(previewArea) {
        previewArea.addEventListener('click', function(e) {
            var nsfwImage = e.target.closest('.nsfw-image');
            if (nsfwImage && previewArea.contains(nsfwImage)) {
                e.preventDefault();
                e.stopPropagation();
                var isRevealedImg = nsfwImage.classList.toggle('revealed');
                nsfwImage.setAttribute('aria-pressed', String(isRevealedImg));
                return;
            }

            var nsfwTag = e.target.closest('.nsfw-tag');
            if (nsfwTag && previewArea.contains(nsfwTag)) {
                e.preventDefault();
                e.stopPropagation();
                handlePreviewNSFWToggle(nsfwTag);
                return;
            }

            var expandBtn = e.target.closest('.quote-expand-btn');
            if (expandBtn && previewArea.contains(expandBtn)) {
                e.preventDefault();
                e.stopPropagation();
                handlePreviewQuoteExpand(expandBtn);
                return;
            }

            var codeExpandBtn = e.target.closest('.code-expand-btn');
            if (codeExpandBtn && previewArea.contains(codeExpandBtn)) {
                e.preventDefault();
                e.stopPropagation();
                handlePreviewCodeExpand(codeExpandBtn);
                return;
            }

            var codeCopyBtn = e.target.closest('.code-copy-btn');
            if (codeCopyBtn && previewArea.contains(codeCopyBtn)) {
                e.preventDefault();
                e.stopPropagation();
                handlePreviewCodeCopy(codeCopyBtn);
                return;
            }

            var spoilerHeader = e.target.closest('.spoiler-header');
            if (spoilerHeader && previewArea.contains(spoilerHeader)) {
                e.preventDefault();
                e.stopPropagation();
                handlePreviewSpoilerToggle(spoilerHeader);
                return;
            }
        });

        previewArea.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;

            var nsfwImage = e.target.closest('.nsfw-image');
            if (nsfwImage && previewArea.contains(nsfwImage)) {
                e.preventDefault();
                e.stopPropagation();
                var isRevealedImg = nsfwImage.classList.toggle('revealed');
                nsfwImage.setAttribute('aria-pressed', String(isRevealedImg));
                return;
            }

            var nsfwTag = e.target.closest('.nsfw-tag');
            if (nsfwTag && previewArea.contains(nsfwTag)) {
                e.preventDefault();
                e.stopPropagation();
                handlePreviewNSFWToggle(nsfwTag);
                return;
            }

            var spoilerHeader = e.target.closest('.spoiler-header');
            if (spoilerHeader && previewArea.contains(spoilerHeader)) {
                e.preventDefault();
                e.stopPropagation();
                handlePreviewSpoilerToggle(spoilerHeader);
            }
        });
    }

    function initPreviewQuotesAndSpoilers(previewArea) {
        var checkQuoteOverflow = function(quote) {
            var content = quote.querySelector('.quote-content');
            var expandBtn = quote.querySelector('.quote-expand-btn');
            if (!content || !expandBtn) return;

            var maxHeight = parseFloat(getComputedStyle(content).maxHeight);
            if (isNaN(maxHeight)) return;

            var actualHeight = content.getBoundingClientRect().height;
            var anyImageTall = false;
            content.querySelectorAll('img').forEach(function(img) {
                if (img.getBoundingClientRect().height > maxHeight + 2) anyImageTall = true;
            });

            var overflows = (content.scrollHeight > maxHeight + 2)
                || (actualHeight > maxHeight + 2)
                || anyImageTall;

            if (!overflows) {
                expandBtn.remove();
                quote.classList.remove('long-quote');
            }
        };

        previewArea.querySelectorAll('.modern-quote.long-quote').forEach(function(quote) {
            var content = quote.querySelector('.quote-content');
            if (!content) return;

            var images = content.querySelectorAll('img');
            if (images.length === 0) {
                checkQuoteOverflow(quote);
            } else {
                var pending = images.length;
                var onLoadOrError = function() {
                    pending--;
                    if (pending === 0) {
                        requestAnimationFrame(function() {
                            setTimeout(function() { checkQuoteOverflow(quote); }, 50);
                        });
                    }
                };
                images.forEach(function(img) {
                    if (img.complete && img.naturalHeight !== 0) {
                        onLoadOrError();
                    } else {
                        img.addEventListener('load', onLoadOrError);
                        img.addEventListener('error', onLoadOrError);
                    }
                });
            }
        });

        requestAnimationFrame(function() {
            previewArea.querySelectorAll('.modern-code').forEach(function(codeBlock) {
                var content = codeBlock.querySelector('.code-content.collapsible-content');
                var expandBtn = codeBlock.querySelector('.code-expand-btn');
                if (!content || !expandBtn) return;

                var maxHeight = parseFloat(getComputedStyle(content).maxHeight);
                if (isNaN(maxHeight)) return;

                if (content.scrollHeight <= maxHeight + 2) {
                    content.classList.remove('collapsible-content');
                    expandBtn.remove();
                }
            });
        });
    }

    function captureExpandedState(area) {
        function indices(sel) {
            var out = [];
            area.querySelectorAll(sel).forEach(function(el, i) {
                if (el.classList.contains('expanded')) out.push(i);
            });
            return out;
        }
        return {
            quotes: indices('.modern-quote'),
            spoilers: indices('.modern-spoiler'),
            codes: indices('.modern-code')
        };
    }

    function restoreExpandedState(area, st) {
        var quotes = area.querySelectorAll('.modern-quote');
        st.quotes.forEach(function(i) {
            var q = quotes[i];
            if (!q) return;
            q.classList.add('expanded');
            var b = q.querySelector('.quote-expand-btn');
            if (b) {
                b.setAttribute('aria-expanded', 'true');
                var t = b.querySelector('.expand-text');
                if (t) t.textContent = 'Show less';
            }
        });

        var spoilers = area.querySelectorAll('.modern-spoiler');
        st.spoilers.forEach(function(i) {
            var s = spoilers[i];
            if (!s) return;
            var content = s.querySelector('.spoiler-content');
            if (!content) return;
            s.classList.add('expanded');
            content.style.maxHeight = content.scrollHeight + 'px';
            content.setAttribute('aria-hidden', 'false');
            var header = s.querySelector('.spoiler-header');
            var toggle = s.querySelector('.spoiler-toggle');
            if (header) header.setAttribute('aria-expanded', 'true');
            if (toggle) toggle.setAttribute('aria-expanded', 'true');
        });

        var codes = area.querySelectorAll('.modern-code');
        st.codes.forEach(function(i) {
            var c = codes[i];
            if (!c) return;
            c.classList.add('expanded');
            var b = c.querySelector('.code-expand-btn');
            if (b) {
                b.setAttribute('aria-expanded', 'true');
                var t = b.querySelector('.expand-text');
                if (t) t.textContent = 'Show less';
            }
        });
    }

    // ------------------------------------------------------------------------
    // ASCII EMOTICON MAP (Converse.js)
    // ------------------------------------------------------------------------
    var ASCII_EMOTICON_MAP = {
        '*\\0/*':'1f646', '*\\O/*':'1f646', '-___-':'1f611', ':\'-)':'1f602',
        '\':-)':'1f605', '\':-D':'1f605', '>:-)':'1f606', '\':-(':'1f613',
        '>:-(':'1f620', ':\'-(':'1f622', 'O:-)':'1f607', '0:-3':'1f607',
        '0:-)':'1f607', '0;^)':'1f607', 'O;-)':'1f607', '0;-)':'1f607',
        'O:-3':'1f607', '-__-':'1f611', ':-Þ':'1f61b', '</3':'1f494',
        ':\')':'1f602', ':-D':'1f603', '\':)':'1f605', '\'=)':'1f605',
        '\':D':'1f605', '\'=D':'1f605', '>:)':'1f606', '>;)':'1f606',
        '>=)':'1f606', ';-)':'1f609', '*-)':'1f609', ';-]':'1f609',
        ';^)':'1f609', '\':(':'1f613', '\'=(':'1f613', ':-*':'1f618',
        ':^*':'1f618', '>:P':'1f61c', 'X-P':'1f61c', '>:[':'1f61e',
        ':-(':'1f61e', ':-[':'1f61e', '>:(':'1f620', ':\'(':'1f622',
        ';-(':'1f622', '>.<':'1f623', '#-)':'1f635', '%-)':'1f635',
        'X-)':'1f635', '\\0/':'1f646', '\\O/':'1f646', '0:3':'1f607',
        '0:)':'1f607', 'O:)':'1f607', 'O=)':'1f607', 'O:3':'1f607',
        'B-)':'1f60e', '8-)':'1f60e', 'B-D':'1f60e', '8-D':'1f60e',
        '-_-':'1f611', '>:\\':'1f615', '>:/':'1f615', ':-/':'1f615',
        ':-.':'1f615', ':-P':'1f61b', ':Þ':'1f61b', ':-b':'1f61b',
        ':-O':'1f62e', 'O_O':'1f62e', '>:O':'1f62e', ':-X':'1f636',
        ':-#':'1f636', ':-)':'1f642', '(y)':'1f44d', '<3':'2764',
        ':D':'1f603', '=D':'1f603', ';)':'1f609', '*)':'1f609',
        ';]':'1f609', ';D':'1f609', ':*':'1f618', '=*':'1f618',
        ':(':'1f61e', ':[':'1f61e', '=(':'1f61e', ':@':'1f620',
        ';(':'1f622', 'D:':'1f628', ':$':'1f633', '=$':'1f633',
        '#)':'1f635', '%)':'1f635', 'X)':'1f635', 'B)':'1f60e',
        '8)':'1f60e', ':/':'1f615', ':\\':'1f615', '=/':'1f615',
        '=\\':'1f615', ':L':'1f615', '=L':'1f615', ':P':'1f61b',
        '=P':'1f61b', ':b':'1f61b', ':O':'1f62e', ':X':'1f636',
        ':#':'1f636', '=X':'1f636', '=#':'1f636', ':)':'1f642',
        '=]':'1f642', '=)':'1f642', ':]':'1f642'
    };

    // ------------------------------------------------------------------------
    // CODE LANGUAGE SUGGESTIONS
    // ------------------------------------------------------------------------
    var CODE_LANGUAGE_SUGGESTIONS = [
        "Ren'Py", 'Python', 'JavaScript', 'TypeScript', 'Lua',
        'HTML', 'CSS', 'JSON', 'XML', 'YAML',
        'SQL', 'Bash', 'Shell', 'PowerShell',
        'C', 'C++', 'C#', 'Java', 'Kotlin',
        'Rust', 'Go', 'Ruby', 'PHP', 'Swift',
        'Markdown', 'Plain text'
    ];

    // ------------------------------------------------------------------------
    // EMOJI PICKER
    // ------------------------------------------------------------------------
    var EMOJI_GROUPS = [
        { name: 'Emojis', emojis: [
            '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','🥲','😏','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','🤤','🥳','😎','🤓','🧐','🙃','🤐','🤨','😒','🙄','😬','😌','😔','😪','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','😕','😟','🙁','😮','😲','😳','🥺','😨','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👋','👌','👍','👎','✊','👏','🙏','💪','👀','🤦','🤷','🎉','❤️','💔','🔥','💯','💥'
        ] }
    ];

    var EMOJI_NAME_MAP = {
        smile: '🙂',
        joy: '😂',
        lol: '😆',
        wink: '😉',
        thinking: '🤔',
        cry: '😢',
        sweat: '😅',
        eyeroll: '🙄',
        eyebrow: '🤨',
        facepalm: '🤦',
        hearteyes: '😍',
        party: '🥳',
        frown: '🙁',
        heart: '❤️',
        fire: '🔥',
        hundred: '💯',
        eyes: '👀',
        skull: '💀',
        thumbsup: '👍',
        thumbsdown: '👎',
        clap: '👏',
        wave: '👋',
        pray: '🙏',
        pepper: '🌶️',
        banana: '🍌'
    };

    var EMOJI_RECENTS_KEY = 'messenger-emoji-recents-v1';
    var EMOJI_RECENTS_MAX = 16;

    function loadEmojiRecents() {
        try {
            var raw = localStorage.getItem(EMOJI_RECENTS_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    }

    function saveEmojiRecents(arr) {
        try { localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(arr.slice(0, EMOJI_RECENTS_MAX))); } catch (e) {}
    }

    function pushEmojiRecent(emoji) {
        var recents = loadEmojiRecents();
        var idx = recents.indexOf(emoji);
        if (idx !== -1) recents.splice(idx, 1);
        recents.unshift(emoji);
        saveEmojiRecents(recents);
    }

    function emojiToCodePoint(emoji) {
        var codePoints = Array.from(emoji).map(function(ch) {
            return ch.codePointAt(0).toString(16);
        });
        codePoints = codePoints.filter(function(cp) { return cp !== 'fe0f'; });
        return codePoints.join('-');
    }

    // ------------------------------------------------------------------------
    // EDITOR STYLE PATCH
    // ------------------------------------------------------------------------
    function injectEditorStyles() {
        if (document.getElementById('messenger-editor-fixes')) return;
        var css = [
            '.modern-wysiwyg .ProseMirror { caret-color: var(--text-primary); cursor: text; }',
            '.modern-wysiwyg .ProseMirror-gapcursor { pointer-events: none; }',
            '.modern-wysiwyg .ProseMirror-gapcursor:after { border-top: 2px solid var(--primary-light, #34d399) !important; width: 28px !important; top: -1px !important; }',
            '.modern-wysiwyg .ProseMirror-focused .ProseMirror-gapcursor { display: block; }',
            '.modern-wysiwyg .ProseMirror img:not([src*="twemoji"]) { vertical-align: bottom; background: var(--surface-light); min-width: 24px; min-height: 24px; }',
            '.modern-wysiwyg .ProseMirror img[src*="twemoji"] { vertical-align: -0.25em; }',
            '.modern-wysiwyg .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; height: 0; color: var(--text-tertiary); pointer-events: none; }',
            '.modern-wysiwyg .ProseMirror blockquote p.is-editor-empty::before, .modern-wysiwyg .ProseMirror div.spoiler p.is-editor-empty::before { content: none; }',
            '.upload-placeholder { display: inline-flex; align-items: center; gap: .45em; padding: .15em .7em; margin-inline: .15em; border: 1px dashed var(--border-color); border-radius: var(--radius-full, 999px); color: var(--text-tertiary); font-size: .85em; vertical-align: middle; user-select: none; }',
            '.upload-placeholder::before { content: ""; width: .9em; height: .9em; border: 2px solid var(--border-color); border-top-color: var(--primary-color); border-radius: 50%; animation: messengerSpin .8s linear infinite; }',
            '@keyframes messengerSpin { to { transform: rotate(360deg); } }',
            '.modern-input.has-error { border-color: var(--danger-color); box-shadow: 0 0 0 2px rgba(220,38,38,.15); }'
        ].join('\n');
        var style = document.createElement('style');
        style.id = 'messenger-editor-fixes';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ========================================================================
    // COMPOSE SECTION
    // ========================================================================
    function buildComposeSection() {
        var recipientInput   = document.querySelector('input[name="entered_name"]');
        var contactSelect    = document.querySelector('select[name="from_contact"]');
        var titleInput       = document.querySelector('input[name="msg_title"]');
        var originalTextarea = document.getElementById('Post');

        if (!originalTextarea) {
            console.warn('[MessengerModule] Compose textarea (#Post) not found – skipping editor');
            return document.createElement('div');
        }

        injectEditorStyles();

        var addSentCheckbox     = document.getElementById('add_sent');
        var addTrackingCheckbox = document.getElementById('add_tracking');
        var submitButton  = document.querySelector('input[name="sub_mit"]');
        var originalForm  = window.REPLIER;

        if (addSentCheckbox) addSentCheckbox.checked = true;
        if (addTrackingCheckbox) addTrackingCheckbox.checked = true;

        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'compose-section';

        var replyingAsPlaceholder = document.createElement('div');
        replyingAsPlaceholder.className = 'modern-replying-as-placeholder';
        container.appendChild(replyingAsPlaceholder);

        var composeHeader = document.createElement('div');
        composeHeader.className = 'modern-compose-header';
        composeHeader.innerHTML = ''
            + '<div class="modern-compose-field modern-recipient-field">'
            +   '<label class="modern-compose-label" for="modern-recipient">To</label>'
            +   '<div class="modern-compose-control">'
            +     '<input type="text" id="modern-recipient" class="modern-input-bare" placeholder="Search by name…" autocomplete="off" spellcheck="false" aria-label="Recipient">'
            +     '<div class="modern-recipient-chip" hidden>'
            +       '<span class="modern-recipient-chip-avatar" aria-hidden="true"></span>'
            +       '<span class="modern-recipient-chip-name"></span>'
            +       '<button type="button" class="modern-recipient-chip-remove" aria-label="Remove recipient">'
            +         '<i class="fa-regular fa-xmark"></i>'
            +       '</button>'
            +     '</div>'
            +   '</div>'
            + '</div>'
            + '<div class="modern-compose-field modern-subject-field">'
            +   '<label class="modern-compose-label" for="modern-title">Subject</label>'
            +   '<div class="modern-compose-control">'
            +     '<input type="text" id="modern-title" class="modern-input-bare" placeholder="Add a subject" aria-label="Subject">'
            +   '</div>'
            + '</div>';
        container.appendChild(composeHeader);

        var currentRecipient    = null;
        var editor              = null;
        var modernSubmitBtnRef  = null;
        var modernPreviewBtnRef = null;
        var charCounter         = null;
        var draftSaveTimer      = null;
        var livePreviewTimer    = null;
        var syncTimer           = null;
        var pendingUploads      = 0;
        var plainPasteArmed     = false;
        var plainPasteTimer     = null;

        function editorBlank() {
            return !editor || docIsBlank(editor.state.doc);
        }

        function syncTextareaNow() {
            if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
            if (originalTextarea && editor) {
                originalTextarea.value = editorBlank() ? '' : htmlToLegacy(editor.getHTML());
            }
        }
        function syncTextareaDebounced() {
            if (syncTimer) clearTimeout(syncTimer);
            syncTimer = setTimeout(syncTextareaNow, 150);
        }
        if (originalForm && originalForm instanceof HTMLFormElement) {
            originalForm.addEventListener('submit', syncTextareaNow);
        }

        function fetchEmbedMetadata(kind, videoid) {
            if (!editor || !videoid) return;
            var canonicalUrl = kind === 'liteYouTube'
                ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoid)
                : 'https://vimeo.com/' + encodeURIComponent(videoid);

            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, OG_FETCH_TIMEOUT);

            fetch(OG_WORKER_URL + encodeURIComponent(canonicalUrl), { signal: controller.signal })
                .then(function(r) { clearTimeout(timeoutId); return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (!data || data.error || !data.title) return;
                    if (!editor) return;
                    var positions = [];
                    editor.state.doc.descendants(function(node, pos) {
                        if (node.type.name === kind &&
                            node.attrs.videoid === videoid &&
                            !node.attrs.title) {
                            positions.push(pos);
                        }
                        return true;
                    });
                    if (positions.length === 0) return;
                    var tr = editor.state.tr;
                    for (var i = 0; i < positions.length; i++) {
                        var pos = positions[i];
                        var node = tr.doc.nodeAt(pos);
                        if (!node) continue;
                        tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, {
                            title: data.title || '',
                            author: data.author || '',
                        }));
                    }
                    tr.setMeta('addToHistory', false);
                    editor.view.dispatch(tr);
                })
                .catch(function() { clearTimeout(timeoutId); });
        }

        function insertLiteEmbed(kind, videoid, opts) {
            if (!editor) return;
            opts = opts || {};
            var attrs = { videoid: videoid };
            if (opts.start != null) attrs.start = String(opts.start);
            if (opts.end   != null) attrs.end   = String(opts.end);
            editor.chain().focus().insertContent({
                type: kind,
                attrs: attrs
            }).run();
            fetchEmbedMetadata(kind, videoid);
        }

        function probeImageSize(src) {
            var probe = new Image();
            probe.onload = function() {
                if (!editor) return;
                var w = probe.naturalWidth, h = probe.naturalHeight;
                if (!w || !h) return;
                var tr = editor.state.tr;
                var changed = false;
                editor.state.doc.descendants(function(node, pos) {
                    if (node.type.name === 'image' && node.attrs.src === src && !node.attrs.width) {
                        tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, { width: w, height: h }));
                        changed = true;
                    }
                    return true;
                });
                if (changed) {
                    tr.setMeta('addToHistory', false);
                    editor.view.dispatch(tr);
                }
            };
            probe.onerror = function() {
                showToast('That image could not be loaded. Check the URL.', { type: 'warning', duration: 4500 });
            };
            probe.src = src;
        }

        function insertImageFromUrl(url, alt) {
            if (!editor) return false;
            var src = normalizeUrl(url, ['http:', 'https:']);
            if (!src) {
                showToast('Enter a valid http(s) image URL', { type: 'error' });
                return false;
            }
            editor.chain().focus().insertContent({
                type: 'image',
                attrs: { src: src, alt: alt || 'image', loading: 'lazy', decoding: 'async' }
            }).run();
            probeImageSize(src);
            return true;
        }

        function uploadImageToWorker(file) {
            if (!editor || !file) return;

            var id = 'up' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            editor.chain().focus().insertContent({
                type: 'uploadPlaceholder',
                attrs: { id: id }
            }).run();

            pendingUploads++;
            updateSendState();

            function findPlaceholder() {
                var found = null;
                editor.state.doc.descendants(function(node, pos) {
                    if (found) return false;
                    if (node.type.name === 'uploadPlaceholder' && node.attrs.id === id) {
                        found = { pos: pos, size: node.nodeSize };
                        return false;
                    }
                    return true;
                });
                return found;
            }

            function finish(imageAttrs) {
                pendingUploads = Math.max(0, pendingUploads - 1);
                if (editor) {
                    var found = findPlaceholder();
                    if (found) {
                        var tr = editor.state.tr;
                        if (imageAttrs) {
                            tr.replaceWith(found.pos, found.pos + found.size, editor.schema.nodes.image.create(imageAttrs));
                        } else {
                            tr.delete(found.pos, found.pos + found.size);
                        }
                        editor.view.dispatch(tr);
                    }
                }
                updateSendState();
            }

            var formData = new FormData();
            formData.append('image', file);

            var controller = new AbortController();
            var timeoutId = setTimeout(function() { controller.abort(); }, UPLOAD_TIMEOUT);

            fetch(UPLOAD_WORKER_URL, { method: 'POST', body: formData, signal: controller.signal })
                .then(function(response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.json();
                })
                .then(function(data) {
                    clearTimeout(timeoutId);
                    if (data && data.url) {
                        finish({
                            src: data.url,
                            alt: 'Uploaded image',
                            loading: 'lazy',
                            decoding: 'async',
                            width: data.width ? parseInt(data.width, 10) : null,
                            height: data.height ? parseInt(data.height, 10) : null
                        });
                        showToast('Image uploaded', { type: 'success' });
                    } else {
                        finish(null);
                        showToast('Upload failed', { type: 'error' });
                    }
                })
                .catch(function(error) {
                    clearTimeout(timeoutId);
                    console.error('Upload error:', error);
                    finish(null);
                    showToast(error && error.name === 'AbortError' ? 'Upload timed out' : 'Upload error', { type: 'error' });
                });
        }

        var modernRecipient     = container.querySelector('#modern-recipient');
        var modernTitle         = container.querySelector('#modern-title');
        var recipientChip       = container.querySelector('.modern-recipient-chip');
        var recipientChipAvatar = container.querySelector('.modern-recipient-chip-avatar');
        var recipientChipName   = container.querySelector('.modern-recipient-chip-name');
        var recipientChipRemove = container.querySelector('.modern-recipient-chip-remove');

        function getCurrentDraftKey() {
            return (currentRecipient && currentRecipient.id)
                ? String(currentRecipient.id)
                : NO_RECIPIENT_KEY;
        }

        function captureCurrentDraft() {
            if (!editor) return null;
            var subject = modernTitle ? modernTitle.value.trim() : '';
            var bodyHasContent = !editorBlank();
            if (!subject && !bodyHasContent) return null;
            return {
                subject: subject,
                bodyHtml: bodyHasContent ? editor.getHTML() : ''
            };
        }

        function persistCurrentDraft() {
            saveDraft(getCurrentDraftKey(), captureCurrentDraft());
        }

        function persistCurrentDraftDebounced() {
            if (draftSaveTimer) clearTimeout(draftSaveTimer);
            draftSaveTimer = setTimeout(function() {
                draftSaveTimer = null;
                persistCurrentDraft();
            }, DRAFT_DEBOUNCE_MS);
        }

        function flushPendingDraft() {
            if (draftSaveTimer) {
                clearTimeout(draftSaveTimer);
                draftSaveTimer = null;
                persistCurrentDraft();
            }
        }

        function isComposerEmpty() {
            if (editor && !editorBlank()) return false;
            if (modernTitle && modernTitle.value.trim()) return false;
            return true;
        }

        function applyDraftToComposer(draft) {
            if (!draft) return;
            if (modernTitle) {
                modernTitle.value = draft.subject || '';
            }
            if (editor && draft.bodyHtml) {
                editor.commands.setContent(draft.bodyHtml, true);
            }
            syncToOriginal();
            updateSendState();
            updateCharCounter();
        }

        window.addEventListener('beforeunload', flushPendingDraft);
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'hidden') flushPendingDraft();
        });

        function setPreviewOpen(open) {
            var area = container.querySelector('#modern-preview-area');
            var btn = container.querySelector('#modern-preview');
            if (area) area.style.display = open ? 'block' : 'none';
            if (btn) {
                btn.innerHTML = open
                    ? '<i class="fa-regular fa-eye-slash"></i> Hide preview'
                    : '<i class="fa-regular fa-eye"></i> Preview';
                btn.setAttribute('aria-pressed', String(open));
            }
        }

        function updateLivePreview() {
            if (!editor || editorBlank()) return;
            var previewArea = container.querySelector('#modern-preview-area');
            if (!previewArea || previewArea.style.display === 'none') return;

            var expanded = captureExpandedState(previewArea);

            var previewHtml = transformPreviewHtml(editor.getHTML().replace(/<span\b[^>]*\bupload-placeholder\b[^>]*>[\s\S]*?<\/span>/gi, ''));
            var previewContent = previewArea.querySelector('.preview-content');
            if (previewContent) {
                previewContent.innerHTML = previewHtml;
                if (window.twemoji) {
                    window.twemoji.parse(previewContent, { base: TWEMOJI_BASE, ext: '.svg' });
                }
            }
            initPreviewQuotesAndSpoilers(previewArea);
            restoreExpandedState(previewArea, expanded);
        }

        function scheduleLivePreviewRefresh() {
            var previewArea = container.querySelector('#modern-preview-area');
            if (!previewArea || previewArea.style.display === 'none') return;
            if (livePreviewTimer) clearTimeout(livePreviewTimer);
            livePreviewTimer = setTimeout(function() {
                livePreviewTimer = null;
                updateLivePreview();
            }, 800);
        }

        function updateSendState() {
            var hasRecipient = !!currentRecipient;
            var hasSubject   = !!(modernTitle && modernTitle.value.trim().length > 0);
            var hasBody      = !editorBlank();
            var uploading    = pendingUploads > 0;

            if (modernSubmitBtnRef) {
                var sendReady = hasRecipient && hasSubject && hasBody && !uploading;
                modernSubmitBtnRef.disabled = !sendReady;
                modernSubmitBtnRef.setAttribute('aria-disabled', String(!sendReady));

                if (sendReady) {
                    modernSubmitBtnRef.removeAttribute('title');
                } else if (uploading) {
                    modernSubmitBtnRef.setAttribute('title', 'Wait for the image upload to finish');
                } else {
                    var missing = [];
                    if (!hasRecipient) missing.push('a recipient');
                    if (!hasSubject)   missing.push('a subject');
                    if (!hasBody)      missing.push('a message body');
                    modernSubmitBtnRef.setAttribute('title', 'Add ' + missing.join(', ') + ' to send');
                }
            }

            if (modernPreviewBtnRef) {
                modernPreviewBtnRef.disabled = !hasBody;
                modernPreviewBtnRef.setAttribute('aria-disabled', String(!hasBody));

                if (hasBody) {
                    modernPreviewBtnRef.removeAttribute('title');
                } else {
                    modernPreviewBtnRef.setAttribute('title', 'Write a message to preview it');
                }
            }

            if (!hasBody) {
                var previewArea = container.querySelector('#modern-preview-area');
                if (previewArea && previewArea.style.display !== 'none') {
                    setPreviewOpen(false);
                }
            }
        }

        function updateCharCounter() {
            if (!MAX_MESSAGE_LENGTH) return;
            var len = editor ? editor.getText().length : 0;
            if (!charCounter) {
                charCounter = document.createElement('span');
                charCounter.className = 'messenger-char-counter';
                charCounter.style.cssText = 'margin-left:auto;font-size:var(--text-xs);color:var(--text-tertiary);';
                var tb = container.querySelector('.modern-editor-toolbar');
                if (tb) tb.appendChild(charCounter);
            }
            charCounter.textContent = len + ' / ' + MAX_MESSAGE_LENGTH;
            if (len > MAX_MESSAGE_LENGTH) charCounter.style.color = 'var(--danger-color)';
            else if (len > MAX_MESSAGE_LENGTH * 0.9) charCounter.style.color = 'var(--warning-color)';
            else charCounter.style.color = 'var(--text-tertiary)';
            if (modernSubmitBtnRef) {
                modernSubmitBtnRef.disabled = modernSubmitBtnRef.disabled || len > MAX_MESSAGE_LENGTH;
            }
        }

        function setContactSelectValue(mid) {
            if (!contactSelect) return;
            if (!mid) {
                contactSelect.value = '-';
                return;
            }
            var str = String(mid);
            for (var i = 0; i < contactSelect.options.length; i++) {
                if (contactSelect.options[i].value === str) {
                    contactSelect.value = str;
                    return;
                }
            }
            contactSelect.value = '-';
        }

        function syncToOriginal() {
            if (recipientInput) {
                recipientInput.value = currentRecipient ? currentRecipient.name : '';
            }
            if (contactSelect) {
                setContactSelectValue(currentRecipient ? currentRecipient.id : null);
            }
            if (titleInput && modernTitle) {
                titleInput.value = modernTitle.value;
            }
        }

        function renderChipAvatar(recipient) {
            if (!recipientChipAvatar) return;
            recipientChipAvatar.innerHTML = '';
            recipientChipAvatar.style.background = '';
            var name = recipient ? recipient.name : '';
            var initial = getInitialFromName(name);

            if (recipient && recipient.avatar) {
                var img = document.createElement('img');
                img.src = recipient.avatar;
                img.alt = '';
                img.onerror = function() {
                    if (img.parentNode) img.parentNode.removeChild(img);
                    recipientChipAvatar.textContent = initial;
                    recipientChipAvatar.style.background = '#' + getColorFromNickname(name, null);
                };
                recipientChipAvatar.appendChild(img);
            } else {
                recipientChipAvatar.textContent = initial;
                recipientChipAvatar.style.background = '#' + getColorFromNickname(name, null);
            }
        }

        function applyRecipient(recipient) {
            if (!recipient || !recipient.name) return;

            var oldKey = getCurrentDraftKey();
            flushPendingDraft();

            currentRecipient = {
                id: recipient.id || null,
                name: recipient.name,
                avatar: recipient.avatar || null
            };
            pushRecent(currentRecipient);

            if (recipientChipName) recipientChipName.textContent = currentRecipient.name;
            renderChipAvatar(currentRecipient);

            if (recipientChip) recipientChip.hidden = false;
            if (modernRecipient) {
                modernRecipient.hidden = true;
                modernRecipient.value = currentRecipient.name;
            }

            syncToOriginal();

            var newKey = getCurrentDraftKey();
            if (oldKey !== newKey) {
                if (isComposerEmpty()) {
                    var newDraft = getDraft(newKey);
                    if (newDraft) applyDraftToComposer(newDraft);
                } else {
                    saveDraft(newKey, captureCurrentDraft());
                    if (oldKey === NO_RECIPIENT_KEY) clearDraft(oldKey);
                }
            }

            if (modernTitle && !modernTitle.value.trim()) {
                modernTitle.focus();
            }

            updateSendState();
        }

        function clearRecipient() {
            var oldKey = getCurrentDraftKey();
            flushPendingDraft();

            currentRecipient = null;

            if (recipientChip) recipientChip.hidden = true;
            if (modernRecipient) {
                modernRecipient.hidden = false;
                modernRecipient.value = '';
            }
            syncToOriginal();

            var newKey = getCurrentDraftKey();
            if (oldKey !== newKey) {
                if (isComposerEmpty()) {
                    var newDraft = getDraft(newKey);
                    if (newDraft) applyDraftToComposer(newDraft);
                } else {
                    saveDraft(newKey, captureCurrentDraft());
                }
            }

            if (modernRecipient) modernRecipient.focus();
            updateSendState();
        }

        (function initRecipientFromLegacy() {
            var initialName = recipientInput ? (recipientInput.value || '').trim() : '';
            var initialId = null;

            if (contactSelect && contactSelect.value && contactSelect.value !== '-') {
                var opt = contactSelect.options[contactSelect.selectedIndex];
                if (opt) {
                    var optName = (opt.textContent || '').trim();
                    if (!initialName || optName === initialName) {
                        initialId = contactSelect.value;
                        if (!initialName) initialName = optName;
                    }
                }
            }

            if (initialName) {
                currentRecipient = { id: initialId, name: initialName, avatar: null };
                pushRecent(currentRecipient);
                if (recipientChipName) recipientChipName.textContent = initialName;
                renderChipAvatar(currentRecipient);
                if (recipientChip) recipientChip.hidden = false;
                if (modernRecipient) {
                    modernRecipient.hidden = true;
                    modernRecipient.value = initialName;
                }
            } else if (modernRecipient && recipientInput) {
                modernRecipient.value = recipientInput.value || '';
            }

            if (modernTitle && titleInput) {
                modernTitle.value = titleInput.value || '';
            }
        })();

        (function resolveInitialRecipientAvatar() {
            if (!currentRecipient) return;
            var pending = currentRecipient;

            function applyAvatar(avatarUrl) {
                if (!avatarUrl) return;
                if (currentRecipient !== pending) return;
                if (typeof avatarUrl !== 'string') return;
                pending.avatar = avatarUrl;
                renderChipAvatar(pending);
            }

            function fetchById(mid) {
                fetch('/api.php?mid=' + encodeURIComponent(mid))
                    .then(function(r) { return r.ok ? r.json() : null; })
                    .then(function(data) {
                        if (!data) return;
                        var user = data['m' + mid] || data.info;
                        if (user && typeof user.avatar === 'string') {
                            applyAvatar(user.avatar);
                        }
                    })
                    .catch(function() {});
            }

            if (pending.id) {
                fetchById(pending.id);
                return;
            }

            if (pending.name) {
                searchMentions(pending.name, 'avatar').then(function(users) {
                    if (currentRecipient !== pending) return;
                    if (!users || users.length === 0) return;
                    var matches = users.filter(function(u) {
                        return u && u.name === pending.name;
                    });
                    if (matches.length !== 1) return;
                    var match = matches[0];
                    if (match.id && !pending.id) {
                        pending.id = String(match.id);
                        syncToOriginal();
                    }
                    if (typeof match.avatar === 'string' && match.avatar) {
                        applyAvatar(match.avatar);
                    }
                }).catch(function() {});
            }
        })();

        if (recipientChipRemove) {
            recipientChipRemove.addEventListener('click', function(e) {
                e.preventDefault();
                clearRecipient();
            });
        }

        attachRecipientAutocomplete(modernRecipient, applyRecipient);

        if (modernTitle) {
            modernTitle.addEventListener('input', function() {
                syncToOriginal();
                updateSendState();
                persistCurrentDraftDebounced();
            });
            modernTitle.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (modernSubmitBtnRef && !modernSubmitBtnRef.disabled) modernSubmitBtnRef.click();
                }
            });
        }

        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Formatting');
        container.appendChild(toolbar);

        toolbar.addEventListener('mousedown', function(e) {
            if (e.target.closest('.modern-editor-btn, .modern-dropdown-item, .modern-emoji-item')) {
                e.preventDefault();
            }
        });

        var syncUser = getCurrentUserSync();
        var currentHeader = null;
        if (syncUser) {
            currentHeader = buildReplyingAsHeader(syncUser);
            if (currentHeader && replyingAsPlaceholder.parentNode) {
                replyingAsPlaceholder.parentNode.replaceChild(currentHeader, replyingAsPlaceholder);
            }
        }

        fetchCurrentUserData().then(function (user) {
            if (!user) {
                if (!currentHeader && replyingAsPlaceholder.parentNode) {
                    replyingAsPlaceholder.remove();
                }
                return;
            }

            if (!currentHeader) {
                var header = buildReplyingAsHeader(user);
                if (header && replyingAsPlaceholder.parentNode) {
                    replyingAsPlaceholder.parentNode.replaceChild(header, replyingAsPlaceholder);
                } else if (replyingAsPlaceholder.parentNode) {
                    replyingAsPlaceholder.remove();
                }
                return;
            }

            var nameEl = currentHeader.querySelector('.modern-replying-name');
            if (nameEl && user.nickname && nameEl.textContent !== user.nickname) {
                nameEl.textContent = user.nickname;
            }

            var linkEl = currentHeader.querySelector('.modern-replying-user');
            if (linkEl && user.mid) linkEl.href = '/?act=Profile&MID=' + user.mid;

            if (user.avatar) {
                var newUrl = optimizeAvatarUrl(user.avatar, 36, 36);
                if (newUrl) {
                    var avatarEl = currentHeader.querySelector('.modern-replying-avatar');
                    if (avatarEl && avatarEl.tagName === 'IMG') {
                        if (avatarEl.src !== newUrl) avatarEl.src = newUrl;
                    } else if (avatarEl && avatarEl.classList.contains('modern-replying-avatar--initial')) {
                        var img = document.createElement('img');
                        img.className = 'modern-replying-avatar';
                        img.src = newUrl;
                        img.alt = 'Avatar of ' + (user.nickname || 'You');
                        img.width = 36;
                        img.height = 36;
                        img.loading = 'lazy';
                        img.decoding = 'async';
                        avatarEl.parentNode.replaceChild(img, avatarEl);
                    }
                }
            }
        });

        var editorElement = document.createElement('div');
        editorElement.id = 'tiptap-editor';
        editorElement.className = 'modern-wysiwyg';
        container.appendChild(editorElement);

        function addSeparator() {
            var sep = document.createElement('span');
            sep.className = 'toolbar-separator';
            sep.setAttribute('aria-hidden', 'true');
            sep.style.cssText = 'width:1px;height:1.5rem;background:var(--border-color);margin:0 var(--space-sm);display:inline-block;vertical-align:middle;';
            toolbar.appendChild(sep);
        }

        function exec(cmd) {
            if (!editor) return;
            cmd();
        }

        function makeToolbarButton(icon, label, opts) {
            opts = opts || {};
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'modern-editor-btn';
            btn.innerHTML = '<i class="' + icon + '"></i>';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            if (opts.shortcut) btn.setAttribute('aria-keyshortcuts', opts.shortcut);
            toolbar.appendChild(btn);
            return btn;
        }

        function openDropdown(btn, menu) {
            menu.style.display = 'block';
            btn.setAttribute('aria-expanded', 'true');
        }
        function closeDropdown(btn, menu) {
            menu.style.display = 'none';
            btn.setAttribute('aria-expanded', 'false');
        }
        var emojiPickerPanel = null;
        function closeAllMenus() {
            document.querySelectorAll('.modern-dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
            if (emojiPickerPanel) emojiPickerPanel.style.display = 'none';
        }

        function makeDropdown(icon, label, menuHtml, minWidth) {
            var wrap = document.createElement('div');
            wrap.className = 'modern-dropdown';
            wrap.style.cssText = 'position:relative;display:inline-block';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'modern-editor-btn';
            btn.innerHTML = '<i class="' + icon + '"></i>';
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('aria-haspopup', 'menu');
            btn.setAttribute('aria-expanded', 'false');
            var menu = document.createElement('div');
            menu.className = 'modern-dropdown-menu';
            menu.setAttribute('role', 'menu');
            menu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:' + minWidth + 'px;display:none;';
            menu.innerHTML = menuHtml;
            wrap.appendChild(btn);
            wrap.appendChild(menu);
            toolbar.appendChild(wrap);
            btn.onclick = function(e) {
                e.stopPropagation();
                var isOpen = menu.style.display === 'block';
                closeAllMenus();
                if (!isOpen) openDropdown(btn, menu);
            };
            menu.addEventListener('click', function(e) { e.stopPropagation(); });
            return { container: wrap, btn: btn, menu: menu };
        }

        var undoBtn = makeToolbarButton('fa-regular fa-undo', 'Undo', { shortcut: 'Control+Z' });
        undoBtn.disabled = true;
        var redoBtn = makeToolbarButton('fa-regular fa-redo', 'Redo', { shortcut: 'Control+Shift+Z' });
        redoBtn.disabled = true;
        addSeparator();

        var boldBtn      = makeToolbarButton('fa-regular fa-bold', 'Bold', { shortcut: 'Control+B' });
        var italicBtn    = makeToolbarButton('fa-regular fa-italic', 'Italic', { shortcut: 'Control+I' });
        var underlineBtn = makeToolbarButton('fa-regular fa-underline', 'Underline', { shortcut: 'Control+U' });
        var strikeBtn    = makeToolbarButton('fa-regular fa-strikethrough', 'Strikethrough');

        var colorDD = makeDropdown('fa-regular fa-palette', 'Text color', ''
            + '<button class="modern-dropdown-item" role="menuitem" data-color="primary"><span class="color-swatch color-swatch--primary"></span> Primary</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="info"><span class="color-swatch color-swatch--info"></span> Info</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="accent"><span class="color-swatch color-swatch--accent"></span> Accent</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="warning"><span class="color-swatch color-swatch--warning"></span> Warning</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="danger"><span class="color-swatch color-swatch--danger"></span> Danger</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="muted"><span class="color-swatch color-swatch--muted"></span> Muted</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="remove"><i class="fa-regular fa-eraser" aria-hidden="true"></i> Remove color</button>',
            180);
        var colorDropdownBtn = colorDD.btn;
        var colorDropdownMenu = colorDD.menu;

        colorDropdownMenu.querySelectorAll('[data-color]').forEach(function(btn) {
            btn.onclick = function() {
                if (!editor) return;
                var variant = btn.getAttribute('data-color');
                if (variant === 'remove') {
                    editor.chain().focus().unsetMark('semanticColor').run();
                } else {
                    editor.chain().focus().setMark('semanticColor', { variant: variant }).run();
                }
                closeDropdown(colorDropdownBtn, colorDropdownMenu);
            };
        });

        var clearFormatBtn = makeToolbarButton('fa-regular fa-remove-format', 'Clear formatting');
        addSeparator();

        var headingDD = makeDropdown('fa-regular fa-heading', 'Heading', ''
            + '<button class="modern-dropdown-item" role="menuitem" data-level="1">Heading 1</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-level="2">Heading 2</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-level="3">Heading 3</button>',
            160);
        var headingDropdownBtn = headingDD.btn;
        var headingDropdownMenu = headingDD.menu;
        var headingButtons = {
            h1: headingDropdownMenu.querySelector('[data-level="1"]'),
            h2: headingDropdownMenu.querySelector('[data-level="2"]'),
            h3: headingDropdownMenu.querySelector('[data-level="3"]')
        };

        var listDD = makeDropdown('fa-regular fa-list', 'Insert list', ''
            + '<button class="modern-dropdown-item" role="menuitem" id="bullet-list-option"><i class="fa-regular fa-list"></i> Bullet list</button>'
            + '<button class="modern-dropdown-item" role="menuitem" id="ordered-list-option"><i class="fa-regular fa-list-ol"></i> Ordered list</button>',
            160);
        var listDropdownBtn = listDD.btn;
        var listDropdownMenu = listDD.menu;

        var blockquoteBtn = makeToolbarButton('fa-regular fa-quote-left', 'Blockquote');

        var codeDD = makeDropdown('fa-regular fa-code', 'Code', ''
            + '<button class="modern-dropdown-item" role="menuitem" id="inline-code-option"><i class="fa-regular fa-code" aria-hidden="true"></i> Inline code</button>'
            + '<button class="modern-dropdown-item" role="menuitem" id="block-code-option"><i class="fa-regular fa-file-code" aria-hidden="true"></i> Code block</button>',
            180);
        var codeDropdownBtn = codeDD.btn;
        var codeDropdownMenu = codeDD.menu;

        codeDropdownMenu.querySelector('#inline-code-option').onclick = function() {
            if (!editor) return;
            exec(function() { editor.chain().focus().toggleCode().run(); });
            closeDropdown(codeDropdownBtn, codeDropdownMenu);
        };

        codeDropdownMenu.querySelector('#block-code-option').onclick = function() {
            if (!editor) return;
            closeDropdown(codeDropdownBtn, codeDropdownMenu);

            if (editor.isActive('codeBlock')) {
                var currentLang = editor.getAttributes('codeBlock').language || '';
                showCodeLangModal(currentLang, function(lang) {
                    editor.chain().focus().updateAttributes('codeBlock', {
                        language: lang || null
                    }).run();
                });
                return;
            }

            showCodeLangModal('', function(lang) {
                var chain = editor.chain().focus();
                if (lang) {
                    chain.setCodeBlock({ language: lang }).run();
                } else {
                    chain.setCodeBlock().run();
                }
            });
        };

        addSeparator();

        var linkBtn = makeToolbarButton('fa-regular fa-link', 'Insert link', { shortcut: 'Control+K' });

        var imageDD = makeDropdown('fa-regular fa-image', 'Insert image', ''
            + '<button class="modern-dropdown-item" role="menuitem" id="image-url-option"><i class="fa-regular fa-link"></i> By URL</button>'
            + '<button class="modern-dropdown-item" role="menuitem" id="image-upload-option"><i class="fa-regular fa-cloud-arrow-up"></i> Upload from computer</button>',
            200);
        var imageDropdownBtn = imageDD.btn;
        var imageDropdownMenu = imageDD.menu;

        addSeparator();
        var spoilerBtn = makeToolbarButton('fa-regular fa-eye-slash', 'Spoiler', { shortcut: 'Control+Shift+S' });
        var nsfwBtn = makeToolbarButton('fa-regular fa-fire', 'NSFW (hidden content)', { shortcut: 'Control+Shift+N' });

        document.addEventListener('click', closeAllMenus);

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var openMenu = document.querySelector('.modern-dropdown-menu[style*="display: block"]');
                if (openMenu || (emojiPickerPanel && emojiPickerPanel.style.display === 'grid')) closeAllMenus();
            }
        });

        var emojiBtn = makeToolbarButton('fa-regular fa-face-smile', 'Insert emoji');
        emojiPickerPanel = document.createElement('div');
        emojiPickerPanel.className = 'modern-emoji-picker';
        emojiPickerPanel.setAttribute('role', 'dialog');
        emojiPickerPanel.setAttribute('aria-label', 'Emoji picker');
        emojiPickerPanel.style.cssText = 'position:absolute;bottom:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius);padding:var(--space-sm);z-index:1000;display:none;grid-template-columns:repeat(8,1fr);gap:var(--space-xs);width:min(340px, calc(100vw - 2rem));max-height:280px;overflow-y:auto;';
        toolbar.style.position = 'relative';
        toolbar.appendChild(emojiPickerPanel);

        function renderEmojiPicker() {
            emojiPickerPanel.innerHTML = '';
            var recents = loadEmojiRecents();
            var allGroups = [];
            if (recents.length > 0) allGroups.push({ name: 'Recently used', emojis: recents });
            allGroups = allGroups.concat(EMOJI_GROUPS);

            allGroups.forEach(function(group, groupIndex) {
                if (groupIndex > 0) {
                    var separator = document.createElement('div');
                    separator.className = 'emoji-group-separator';
                    separator.setAttribute('aria-hidden', 'true');
                    emojiPickerPanel.appendChild(separator);
                }
                var groupLabel = document.createElement('div');
                groupLabel.className = 'emoji-group-label';
                groupLabel.textContent = group.name;
                emojiPickerPanel.appendChild(groupLabel);

                group.emojis.forEach(function(emoji) {
                    var emojiItem = document.createElement('button');
                    emojiItem.type = 'button';
                    emojiItem.className = 'modern-emoji-item';
                    emojiItem.setAttribute('data-emoji', emoji);
                    emojiItem.setAttribute('aria-label', emoji);
                    emojiItem.title = emoji;

                    var img = document.createElement('img');
                    img.src = TWEMOJI_BASE + emojiToCodePoint(emoji) + '.svg';
                    img.alt = emoji;
                    img.style.width = '1.5rem';
                    img.style.height = '1.5rem';
                    img.onerror = function() {
                        emojiItem.innerHTML = '';
                        emojiItem.textContent = emoji;
                        emojiItem.style.fontSize = '1.5rem';
                    };
                    emojiItem.appendChild(img);

                    emojiItem.onclick = function(e) {
                        e.stopPropagation();
                        if (editor) {
                            var emojiChar = this.getAttribute('data-emoji');
                            editor.chain().focus().insertContent({
                                type: 'emoji',
                                attrs: {
                                    src: TWEMOJI_BASE + emojiToCodePoint(emojiChar) + '.svg',
                                    alt: emojiChar,
                                    loading: 'lazy',
                                    decoding: 'async',
                                    width: 24,
                                    height: 24
                                }
                            }).run();
                            pushEmojiRecent(emojiChar);
                        }
                        emojiPickerPanel.style.display = 'none';
                    };
                    emojiPickerPanel.appendChild(emojiItem);
                });
            });
        }

        emojiBtn.onclick = function(e) {
            e.stopPropagation();
            var isVisible = emojiPickerPanel.style.display === 'grid';
            closeAllMenus();
            if (!isVisible) {
                renderEmojiPicker();
                emojiPickerPanel.style.display = 'grid';
            }
        };
        emojiPickerPanel.addEventListener('click', function(e) { e.stopPropagation(); });

        // ------------------------------------------------------------------
        // MODALS
        // ------------------------------------------------------------------
        function createModal(innerHtml, width) {
            var overlay = document.createElement('div');
            overlay.className = 'modern-modal-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
            var box = document.createElement('div');
            box.className = 'modern-modal-box';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.style.cssText = 'background:var(--surface-color);border-radius:var(--radius-lg);padding:var(--space-lg);width:' + width + 'px;max-width:90%;box-shadow:var(--shadow-lg);';
            box.innerHTML = innerHtml;
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            function onKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                }
            }
            function close() {
                overlay.remove();
                document.removeEventListener('keydown', onKey, true);
                if (editor) editor.commands.focus();
            }
            document.addEventListener('keydown', onKey, true);
            overlay.addEventListener('mousedown', function(e) { if (e.target === overlay) close(); });
            box.addEventListener('keydown', function(e) {
                if (e.key !== 'Tab') return;
                var f = box.querySelectorAll('input:not([type="hidden"]), button, select, textarea');
                if (!f.length) return;
                var first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            });
            return { overlay: overlay, box: box, close: close };
        }

        function onEnter(input, fn) {
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); fn(); }
            });
        }

        function flagInvalid(input) {
            input.classList.add('has-error');
            input.focus();
            setTimeout(function() { input.classList.remove('has-error'); }, 1200);
        }

        function showInputModal(title, placeholder, normalizer, callback) {
            var m = createModal(''
                + '<h3 style="margin:0 0 var(--space-md) 0;">' + escapeHtml(title) + '</h3>'
                + '<input type="text" id="modal-input" class="modern-input" placeholder="' + escapeHtml(placeholder) + '" style="width:100%;" autocomplete="off" spellcheck="false">'
                + '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">'
                + '<button type="button" id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>'
                + '<button type="button" id="modal-submit" class="modern-btn modern-btn-primary">Insert</button>'
                + '</div>', 360);
            var input = m.box.querySelector('#modal-input');
            input.focus();

            function submit() {
                var raw = input.value.trim();
                if (!raw) { flagInvalid(input); return; }
                var val = normalizer ? normalizer(raw) : raw;
                if (!val) { flagInvalid(input); return; }
                callback(val);
                m.close();
            }
            m.box.querySelector('#modal-cancel').onclick = m.close;
            m.box.querySelector('#modal-submit').onclick = submit;
            onEnter(input, submit);
        }

        function showSpoilerTitleModal(initial, callback) {
            var m = createModal(''
                + '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-eye-slash"></i> Spoiler title</h3>'
                + '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Optional. Leave empty for a plain spoiler.</p>'
                + '<input type="text" id="modal-spoiler-title" class="modern-input" placeholder="e.g. Route: Lily - Chapter 5" maxlength="80" style="width:100%;" value="' + escapeHtml(initial || '') + '">'
                + '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">'
                + '<button type="button" id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>'
                + '<button type="button" id="modal-submit" class="modern-btn modern-btn-primary">Save</button>'
                + '</div>', 380);
            var input = m.box.querySelector('#modal-spoiler-title');
            input.focus();
            input.select();

            function submit() {
                var cleaned = input.value.trim()
                    .replace(/[{}]/g, '')
                    .replace(/[\r\n]+/g, ' ')
                    .trim();
                callback(cleaned);
                m.close();
            }
            m.box.querySelector('#modal-cancel').onclick = m.close;
            m.box.querySelector('#modal-submit').onclick = submit;
            onEnter(input, submit);
        }

        function showCodeLangModal(initial, callback) {
            var optionsHtml = CODE_LANGUAGE_SUGGESTIONS.map(function(lang) {
                return '<option value="' + escapeHtml(lang) + '"></option>';
            }).join('');

            var m = createModal(''
                + '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-code"></i> Code language</h3>'
                + '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Optional. Shown on the code block header. Leave empty for a plain "Code" label.</p>'
                + '<input type="text" id="modal-code-lang" class="modern-input" list="modal-code-lang-list" placeholder="e.g. Python, Ren\'Py" maxlength="40" autocomplete="off" style="width:100%;" value="' + escapeHtml(initial || '') + '">'
                + '<datalist id="modal-code-lang-list">' + optionsHtml + '</datalist>'
                + '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">'
                + '<button type="button" id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>'
                + '<button type="button" id="modal-submit" class="modern-btn modern-btn-primary">Save</button>'
                + '</div>', 380);
            var input = m.box.querySelector('#modal-code-lang');
            input.focus();
            input.select();

            function submit() {
                var cleaned = input.value.trim().replace(/[\r\n]+/g, ' ').trim();
                callback(cleaned);
                m.close();
            }
            m.box.querySelector('#modal-cancel').onclick = m.close;
            m.box.querySelector('#modal-submit').onclick = submit;
            onEnter(input, submit);
        }

        function showLinkModal(initialHref, callback, onRemove) {
            var isEdit = initialHref != null;
            var m = createModal(''
                + '<h3 style="margin:0 0 var(--space-md) 0;"><i class="fa-regular fa-link"></i> ' + (isEdit ? 'Edit link' : 'Insert link') + '</h3>'
                + (isEdit ? '' : '<div style="margin-bottom:var(--space-md);">'
                    + '<label style="display:block;margin-bottom:var(--space-xs);color:var(--text-secondary);">Link text (optional)</label>'
                    + '<input type="text" id="modal-link-text" class="modern-input" placeholder="Enter text to display" style="width:100%;">'
                    + '</div>')
                + '<div style="margin-bottom:var(--space-md);">'
                + '<label style="display:block;margin-bottom:var(--space-xs);color:var(--text-secondary);">URL</label>'
                + '<input type="text" id="modal-link-url" class="modern-input" placeholder="https://example.com" style="width:100%;" autocomplete="off" spellcheck="false" value="' + escapeHtml(initialHref || '') + '">'
                + '</div>'
                + '<div style="display:flex;gap:var(--space-sm);justify-content:flex-end;">'
                + (isEdit && onRemove ? '<button type="button" id="modal-remove" class="modern-btn modern-btn-secondary danger" style="margin-right:auto;">Remove link</button>' : '')
                + '<button type="button" id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>'
                + '<button type="button" id="modal-submit" class="modern-btn modern-btn-primary">' + (isEdit ? 'Save' : 'Insert link') + '</button>'
                + '</div>', 380);
            var textInput = m.box.querySelector('#modal-link-text');
            var urlInput = m.box.querySelector('#modal-link-url');
            urlInput.focus();
            if (isEdit) urlInput.select();

            function submit() {
                var linkUrl = normalizeUrl(urlInput.value, ['http:', 'https:', 'mailto:', 'tel:']);
                if (!linkUrl) { flagInvalid(urlInput); return; }
                var linkText = textInput ? textInput.value.trim() : '';
                callback(linkUrl, linkText || null);
                m.close();
            }
            m.box.querySelector('#modal-cancel').onclick = m.close;
            m.box.querySelector('#modal-submit').onclick = submit;
            var removeBtn = m.box.querySelector('#modal-remove');
            if (removeBtn) removeBtn.onclick = function() { onRemove(); m.close(); };
            if (textInput) onEnter(textInput, submit);
            onEnter(urlInput, submit);
        }

        function showImageEditModal(initialAlt, initialSize, callback) {
            var sizes = [
                { value: 'small',  label: 'Small (25%)' },
                { value: 'medium', label: 'Medium (50%)' },
                { value: 'large',  label: 'Large (75%)' },
                { value: '',       label: 'Full width' }
            ];
            var sizeHtml = sizes.map(function(s) {
                var checked = (initialSize || '') === s.value ? ' checked' : '';
                return '<label class="modern-radio" style="margin-right:var(--space-md);margin-bottom:var(--space-xs);">'
                    + '<input type="radio" name="modal-img-size" value="' + s.value + '"' + checked + '>'
                    + '<span>' + s.label + '</span></label>';
            }).join('');

            var m = createModal(''
                + '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-image"></i> Edit image</h3>'
                + '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Describe the image for accessibility, and optionally resize it.</p>'
                + '<div style="margin-bottom:var(--space-md);">'
                + '<label style="display:block;font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-xs);">Alt text</label>'
                + '<input type="text" id="modal-img-alt" class="modern-input" placeholder="Describe this image" maxlength="200" style="width:100%;" value="' + escapeHtml(initialAlt || '') + '">'
                + '</div>'
                + '<div style="margin-bottom:var(--space-md);">'
                + '<label style="display:block;font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-xs);">Display size</label>'
                + '<div style="display:flex;flex-wrap:wrap;gap:var(--space-sm);">' + sizeHtml + '</div>'
                + '</div>'
                + '<div style="display:flex;gap:var(--space-sm);justify-content:flex-end;">'
                + '<button type="button" id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>'
                + '<button type="button" id="modal-submit" class="modern-btn modern-btn-primary">Save</button>'
                + '</div>', 400);

            var altInput = m.box.querySelector('#modal-img-alt');
            altInput.focus();
            altInput.select();

            function submit() {
                var checked = m.box.querySelector('input[name="modal-img-size"]:checked');
                var size = checked ? checked.value : '';
                callback(altInput.value.trim(), size || null);
                m.close();
            }
            m.box.querySelector('#modal-cancel').onclick = m.close;
            m.box.querySelector('#modal-submit').onclick = submit;
            onEnter(altInput, submit);
        }

        function resolveAtomNode(el, editorInstance, atomTypeNames) {
            if (!el || !editorInstance) return null;
            var view = editorInstance.view;
            var pos;
            try { pos = view.posAtDOM(el, 0); } catch (e) { return null; }
            var $pos = view.state.doc.resolve(pos);
            if ($pos.nodeAfter && atomTypeNames.indexOf($pos.nodeAfter.type.name) !== -1) {
                return { node: $pos.nodeAfter, pos: pos };
            }
            if ($pos.nodeBefore && atomTypeNames.indexOf($pos.nodeBefore.type.name) !== -1) {
                return { node: $pos.nodeBefore, pos: pos - $pos.nodeBefore.nodeSize };
            }
            return null;
        }

        function getVisibleImageBox(img) {
            var rect = img.getBoundingClientRect();
            var cs = window.getComputedStyle(img);
            var padTop    = parseFloat(cs.paddingTop)    || 0;
            var padRight  = parseFloat(cs.paddingRight)  || 0;
            var padLeft   = parseFloat(cs.paddingLeft)   || 0;
            var padBottom = parseFloat(cs.paddingBottom) || 0;
            var bTop      = parseFloat(cs.borderTopWidth)    || 0;
            var bRight    = parseFloat(cs.borderRightWidth)  || 0;
            var bBottom   = parseFloat(cs.borderBottomWidth) || 0;
            var bLeft     = parseFloat(cs.borderLeftWidth)   || 0;
            return {
                top:    rect.top    + padTop    + bTop,
                right:  rect.right  - padRight  - bRight,
                bottom: rect.bottom - padBottom - bBottom,
                left:   rect.left   + padLeft   + bLeft,
                width:  rect.width  - padLeft - padRight  - bLeft - bRight,
                height: rect.height - padTop  - padBottom - bTop  - bBottom
            };
        }

        function setupImageToolbar(editorRoot, editorInstance) {
            if (!editorRoot || !editorInstance) return;

            var toolbarEl = document.createElement('div');
            toolbarEl.className = 'editor-image-toolbar';
            toolbarEl.style.display = 'none';
            toolbarEl.addEventListener('mousedown', function(e) { e.preventDefault(); });

            var nsfwImgBtn = document.createElement('button');
            nsfwImgBtn.type = 'button';
            nsfwImgBtn.className = 'editor-image-nsfw-btn';
            nsfwImgBtn.innerHTML = '<i class="fa-regular fa-eye-slash" aria-hidden="true"></i>';
            nsfwImgBtn.title = 'Mark as NSFW (hide on reader side)';
            nsfwImgBtn.setAttribute('aria-label', 'Toggle NSFW for this image');

            var editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'editor-image-edit-btn';
            editBtn.innerHTML = '<i class="fa-regular fa-pen" aria-hidden="true"></i>';
            editBtn.title = 'Edit image (alt text, size)';
            editBtn.setAttribute('aria-label', 'Edit image');

            var deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'editor-image-delete-btn';
            deleteBtn.innerHTML = '<i class="fa-regular fa-trash-can" aria-hidden="true"></i>';
            deleteBtn.title = 'Delete image';
            deleteBtn.setAttribute('aria-label', 'Delete image');

            toolbarEl.appendChild(nsfwImgBtn);
            toolbarEl.appendChild(editBtn);
            toolbarEl.appendChild(deleteBtn);
            document.body.appendChild(toolbarEl);
            cleanupFns.push(function() { toolbarEl.remove(); });

            var hoveredImg = null;
            var hideTimer = null;

            function updateButtonState(img) {
                if (!img) return;
                var isNsfw = img.getAttribute('data-nsfw') === 'true';
                nsfwImgBtn.classList.toggle('is-active', isNsfw);
                var label = isNsfw
                    ? 'Unmark NSFW (make visible on reader side)'
                    : 'Mark as NSFW (hide on reader side)';
                nsfwImgBtn.title = label;
                nsfwImgBtn.setAttribute('aria-label', label);
            }

            function positionToolbar(img) {
                if (!img) return;
                var vis = getVisibleImageBox(img);
                var toolbarWidth = toolbarEl.offsetWidth || 110;
                toolbarEl.style.top  = (vis.top + window.pageYOffset + 6) + 'px';
                toolbarEl.style.left = (vis.right + window.pageXOffset - toolbarWidth - 6) + 'px';
            }

            function hideNow() {
                toolbarEl.style.display = 'none';
                hoveredImg = null;
            }

            function showToolbar(img) {
                if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
                hoveredImg = img;
                updateButtonState(img);
                toolbarEl.style.display = 'flex';
                positionToolbar(img);
            }

            function hideToolbarDelayed() {
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(hideNow, 120);
            }

            function isEligible(img) {
                if (!img) return false;
                if (img.classList.contains('twemoji')) return false;
                var src = img.getAttribute('src') || '';
                if (src.indexOf('twemoji') !== -1) return false;
                if (img.classList.contains('ProseMirror-separator')) return false;
                var alt = img.getAttribute('alt') || '';
                if (alt.startsWith(':') && alt.endsWith(':')) return false;
                if (img.closest('.link-preview-card, .link-preview-simple, .simple-link, .modern-embedded-link')) return false;
                return true;
            }

            editorRoot.addEventListener('mouseover', function(e) {
                var img = e.target.closest && e.target.closest('img');
                if (!isEligible(img)) return;
                showToolbar(img);
            });

            editorRoot.addEventListener('click', function(e) {
                var img = e.target.closest && e.target.closest('img');
                if (!isEligible(img)) return;
                showToolbar(img);
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(function() {
                    if (!toolbarEl.matches(':hover')) hideNow();
                }, 4000);
            });

            editorRoot.addEventListener('mouseout', function(e) {
                var img = e.target.closest && e.target.closest('img');
                if (!img || img !== hoveredImg) return;
                if (toolbarEl.contains(e.relatedTarget)) return;
                var nextImg = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('img');
                if (nextImg === img) return;
                hideToolbarDelayed();
            });

            toolbarEl.addEventListener('mouseenter', function() {
                if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            });
            toolbarEl.addEventListener('mouseleave', function() {
                if (!hoveredImg) return;
                hideToolbarDelayed();
            });

            nsfwImgBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!hoveredImg) return;
                var resolved = resolveAtomNode(hoveredImg, editorInstance, ['image']);
                if (!resolved) return;
                var newAttrs = Object.assign({}, resolved.node.attrs, {
                    nsfw: !resolved.node.attrs.nsfw
                });
                editorInstance.view.dispatch(
                    editorInstance.view.state.tr.setNodeMarkup(resolved.pos, undefined, newAttrs)
                );
                hideNow();
            });

            editBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!hoveredImg) return;
                var resolved = resolveAtomNode(hoveredImg, editorInstance, ['image']);
                if (!resolved) return;

                var currentAlt = resolved.node.attrs.alt || '';
                var currentSize = resolved.node.attrs.size || null;

                showImageEditModal(currentAlt, currentSize, function(newAlt, newSize) {
                    var again = resolveAtomNode(hoveredImg || document.createElement('i'), editorInstance, ['image']);
                    var target = (again && again.node.attrs.src === resolved.node.attrs.src) ? again : resolved;
                    var node = editorInstance.state.doc.nodeAt(target.pos);
                    if (!node || node.type.name !== 'image') return;
                    var newAttrs = Object.assign({}, node.attrs, {
                        alt: newAlt || 'image',
                        size: newSize
                    });
                    editorInstance.view.dispatch(
                        editorInstance.view.state.tr.setNodeMarkup(target.pos, undefined, newAttrs)
                    );
                });

                hideNow();
            });

            deleteBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!hoveredImg) return;
                var resolved = resolveAtomNode(hoveredImg, editorInstance, ['image']);
                if (!resolved) return;
                var view = editorInstance.view;
                view.dispatch(view.state.tr.delete(resolved.pos, resolved.pos + resolved.node.nodeSize));
                hideNow();
                editorInstance.commands.focus();
            });

            window.addEventListener('scroll', function() {
                if (hoveredImg && toolbarEl.style.display === 'flex') positionToolbar(hoveredImg);
            }, true);
            window.addEventListener('resize', function() {
                if (hoveredImg && toolbarEl.style.display === 'flex') positionToolbar(hoveredImg);
            });

            editorInstance.on('blur', hideNow);
            editorInstance.on('update', function() {
                if (hoveredImg && !document.body.contains(hoveredImg)) hideNow();
            });
        }

        function setupLiteEmbedToolbar(editorRoot, editorInstance) {
            if (!editorRoot || !editorInstance) return;

            var toolbarEl = document.createElement('div');
            toolbarEl.className = 'editor-embed-toolbar';
            toolbarEl.style.display = 'none';
            toolbarEl.addEventListener('mousedown', function(e) { e.preventDefault(); });

            var copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'editor-embed-copy-btn';
            copyBtn.innerHTML = '<i class="fa-regular fa-link" aria-hidden="true"></i>';
            copyBtn.title = 'Copy share URL';
            copyBtn.setAttribute('aria-label', 'Copy share URL');

            var deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'editor-embed-delete-btn';
            deleteBtn.innerHTML = '<i class="fa-regular fa-trash-can" aria-hidden="true"></i>';
            deleteBtn.title = 'Delete embed';
            deleteBtn.setAttribute('aria-label', 'Delete embed');

            toolbarEl.appendChild(copyBtn);
            toolbarEl.appendChild(deleteBtn);
            document.body.appendChild(toolbarEl);
            cleanupFns.push(function() { toolbarEl.remove(); });

            var hoveredWrapper = null;
            var hideTimer = null;

            function hideNow() {
                toolbarEl.style.display = 'none';
                hoveredWrapper = null;
            }

            function positionToolbar(wrapper) {
                if (!wrapper) return;
                var rect = wrapper.getBoundingClientRect();
                var toolbarWidth = toolbarEl.offsetWidth || 80;
                toolbarEl.style.top  = (rect.top + window.pageYOffset + 8) + 'px';
                toolbarEl.style.left = (rect.right + window.pageXOffset - toolbarWidth - 8) + 'px';
            }

            function showToolbar(wrapper) {
                if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
                hoveredWrapper = wrapper;
                toolbarEl.style.display = 'flex';
                positionToolbar(wrapper);
            }

            function hideToolbarDelayed() {
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(hideNow, 120);
            }

            editorRoot.addEventListener('mouseover', function(e) {
                var lite = e.target.closest && e.target.closest('lite-youtube, lite-vimeo');
                if (!lite) return;
                var wrapper = lite.closest('.lite-embed-wrapper');
                if (!wrapper) return;
                showToolbar(wrapper);
            });

            editorRoot.addEventListener('click', function(e) {
                var lite = e.target.closest && e.target.closest('lite-youtube, lite-vimeo');
                if (!lite) return;
                var wrapper = lite.closest('.lite-embed-wrapper');
                if (!wrapper) return;
                showToolbar(wrapper);
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(function() {
                    if (!toolbarEl.matches(':hover')) hideNow();
                }, 4000);
            });

            editorRoot.addEventListener('mouseout', function(e) {
                var lite = e.target.closest && e.target.closest('lite-youtube, lite-vimeo');
                if (!lite) return;
                var wrapper = lite.closest('.lite-embed-wrapper');
                if (!wrapper || wrapper !== hoveredWrapper) return;
                if (toolbarEl.contains(e.relatedTarget)) return;
                var next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('lite-youtube, lite-vimeo');
                if (next && next.closest('.lite-embed-wrapper') === wrapper) return;
                hideToolbarDelayed();
            });

            toolbarEl.addEventListener('mouseenter', function() {
                if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            });
            toolbarEl.addEventListener('mouseleave', function() {
                if (!hoveredWrapper) return;
                hideToolbarDelayed();
            });

            copyBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!hoveredWrapper) return;
                var resolved = resolveAtomNode(hoveredWrapper, editorInstance, ['liteYouTube', 'liteVimeo']);
                if (!resolved) return;
                var attrs = resolved.node.attrs;
                var isYouTube = resolved.node.type.name === 'liteYouTube';
                var url;
                if (isYouTube) {
                    url = 'https://youtu.be/' + attrs.videoid;
                    if (attrs.start != null) url += '?t=' + attrs.start;
                } else {
                    url = 'https://vimeo.com/' + attrs.videoid;
                    if (attrs.start != null) url += '#t=' + attrs.start + 's';
                }
                copyTextToClipboard(url, function() {
                    var icon = copyBtn.querySelector('i');
                    if (icon) {
                        var orig = icon.className;
                        icon.className = 'fa-regular fa-check';
                        setTimeout(function() { icon.className = orig; }, 1500);
                    }
                    showToast('Link copied', { type: 'success', duration: 1800 });
                });
            });

            deleteBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (!hoveredWrapper) return;
                var resolved = resolveAtomNode(hoveredWrapper, editorInstance, ['liteYouTube', 'liteVimeo']);
                if (!resolved) return;
                var view = editorInstance.view;
                view.dispatch(view.state.tr.delete(resolved.pos, resolved.pos + resolved.node.nodeSize));
                hideNow();
                editorInstance.commands.focus();
            });

            window.addEventListener('scroll', function() {
                if (hoveredWrapper && toolbarEl.style.display === 'flex') positionToolbar(hoveredWrapper);
            }, true);
            window.addEventListener('resize', function() {
                if (hoveredWrapper && toolbarEl.style.display === 'flex') positionToolbar(hoveredWrapper);
            });

            editorInstance.on('blur', hideNow);
            editorInstance.on('update', function() {
                if (hoveredWrapper && !document.body.contains(hoveredWrapper)) hideNow();
            });
        }

        function setupEmoticonAutocomplete(editorInstance, editorRoot) {
            if (!editorInstance || !editorRoot) return;

            var MIN_QUERY = 2;
            var popup = null;
            var items = [];
            var selectedIndex = 0;
            var itemEls = [];
            var currentQuery = '';

            function closePopup() {
                if (popup) { popup.remove(); popup = null; }
                items = []; itemEls = []; selectedIndex = 0;
                currentQuery = '';
            }

            function ensurePopup() {
                if (!popup) {
                    popup = document.createElement('div');
                    popup.className = 'mention-suggestions emoticon-suggestions';
                    popup.setAttribute('role', 'listbox');
                    document.body.appendChild(popup);
                }
                return popup;
            }

            function positionPopup() {
                if (!popup) return;
                try {
                    var coords = editorInstance.view.coordsAtPos(
                        editorInstance.state.selection.from
                    );
                    popup.style.left = (coords.left + window.pageXOffset) + 'px';
                    popup.style.top = (coords.bottom + window.pageYOffset + 4) + 'px';
                } catch (e) {}
            }

            function updateSelected() {
                itemEls.forEach(function(el, i) {
                    el.classList.toggle('is-selected', i === selectedIndex);
                });
            }

            function buildPopup() {
                if (!popup) return;
                popup.innerHTML = '';
                itemEls = [];

                items.forEach(function(item) {
                    var el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'mention-suggestion-item';
                    el.setAttribute('role', 'option');

                    var img = document.createElement('img');
                    img.className = 'emoticon-suggestion-icon';
                    img.src = TWEMOJI_BASE + emojiToCodePoint(item.emoji) + '.svg';
                    img.alt = item.emoji;
                    img.loading = 'lazy';
                    img.onerror = function() {
                        var span = document.createElement('span');
                        span.className = 'emoticon-suggestion-icon';
                        span.textContent = item.emoji;
                        this.replaceWith(span);
                    };
                    el.appendChild(img);

                    var label = document.createElement('span');
                    label.className = 'mention-suggestion-name';
                    label.textContent = ':' + item.name;
                    el.appendChild(label);

                    el.addEventListener('mousedown', function(e) {
                        e.preventDefault();
                        commit(item);
                    });

                    itemEls.push(el);
                    popup.appendChild(el);
                });

                popup.style.display = 'block';
                updateSelected();
            }

            function detectTrigger() {
                var sel = editorInstance.state.selection;
                if (!sel || !sel.empty) return null;
                if (sel.$from.parent.type.spec.code) return null;
                var from = sel.from;
                var start = Math.max(0, from - 80);
                var textBefore = editorInstance.state.doc.textBetween(
                    start, from, '\n', '\uFFFC'
                );
                var m = textBefore.match(/(^|\s):([a-zA-Z0-9_+\-]*)$/);
                if (!m) return null;
                return { query: m[2] };
            }

            function refresh() {
                var trigger = detectTrigger();
                if (!trigger || trigger.query.length < MIN_QUERY) { closePopup(); return; }

                var query = trigger.query.toLowerCase();
                var matches = [];
                Object.keys(EMOJI_NAME_MAP).forEach(function(name) {
                    if (name.indexOf(query) === 0) {
                        matches.push({ name: name, emoji: EMOJI_NAME_MAP[name] });
                    }
                });

                if (matches.length === 0) { closePopup(); return; }

                matches.sort(function(a, b) {
                    var aExact = a.name === query ? 0 : 1;
                    var bExact = b.name === query ? 0 : 1;
                    if (aExact !== bExact) return aExact - bExact;
                    return a.name.localeCompare(b.name);
                });
                matches = matches.slice(0, 25);

                items = matches;
                selectedIndex = 0;
                currentQuery = trigger.query;
                ensurePopup();
                buildPopup();
                positionPopup();
            }

            function commit(item) {
                if (!item) return;
                var from = editorInstance.state.selection.from;
                var queryLen = currentQuery.length;
                var triggerStart = from - queryLen - 1;

                var cp = emojiToCodePoint(item.emoji);
                editorInstance.chain().focus()
                    .deleteRange({ from: triggerStart, to: from })
                    .insertContent({
                        type: 'emoji',
                        attrs: {
                            src: TWEMOJI_BASE + cp + '.svg',
                            alt: item.emoji,
                            loading: 'lazy',
                            decoding: 'async',
                            width: 24,
                            height: 24
                        }
                    })
                    .run();
                pushEmojiRecent(item.emoji);
                closePopup();
            }

            editorRoot.addEventListener('keydown', function(e) {
                if (!popup) return;
                if (e.ctrlKey || e.metaKey || e.altKey) return;

                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    closePopup();
                    return;
                }

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    e.stopPropagation();
                    selectedIndex = (selectedIndex + 1) % items.length;
                    updateSelected();
                    return;
                }

                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    e.stopPropagation();
                    selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                    updateSelected();
                    return;
                }

                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    e.stopPropagation();
                    commit(items[selectedIndex]);
                    return;
                }

                if (e.key === ' ') {
                    closePopup();
                }
            }, true);

            editorInstance.on('update', refresh);
            editorInstance.on('selectionUpdate', refresh);

            editorInstance.on('blur', function() {
                setTimeout(function() {
                    if (document.activeElement !== editorRoot &&
                        !(popup && popup.contains(document.activeElement))) {
                        closePopup();
                    }
                }, 0);
            });

            cleanupFns.push(closePopup);
        }

        // =================================================================
        // TipTap bootstrap
        // =================================================================
        (async function initTipTap() {
            try {
                var mods = await Promise.all([
                    import('https://esm.sh/@tiptap/core@2.5.2'),
                    import('https://esm.sh/prosemirror-state@1.4.3'),
                    import('https://esm.sh/prosemirror-view@1.33.0'),
                    import('https://esm.sh/@tiptap/starter-kit@2.5.2'),
                    import('https://esm.sh/@tiptap/extension-placeholder@2.5.2'),
                    import('https://esm.sh/@tiptap/extension-underline@2.5.2'),
                    import('https://esm.sh/@tiptap/extension-image@2.5.2'),
                    import('https://esm.sh/@tiptap/extension-link@2.5.2'),
                    import('https://esm.sh/@tiptap/extension-mention@2.5.2'),
                    import('https://esm.sh/@tiptap/extension-code-block@2.5.2')
                ]);
                const core = mods[0];
                const Editor = core.Editor || (core.default && core.default.Editor);
                const Node = core.Node || (core.default && core.default.Node);
                const Mark = core.Mark || (core.default && core.default.Mark);
                const Extension = core.Extension || (core.default && core.default.Extension);
                const InputRule = core.InputRule || (core.default && core.default.InputRule);

                if (!Editor || !Node || !Mark || !Extension || !InputRule) {
                    throw new Error('Editor, Node, Mark, Extension, or InputRule not found in @tiptap/core');
                }

                const { Plugin, PluginKey, TextSelection } = mods[1];
                const { Decoration, DecorationSet } = mods[2];

                const starterKitModule = mods[3];
                const placeholderModule = mods[4];
                const underlineModule = mods[5];
                const imageModule = mods[6];
                const linkModule = mods[7];
                const mentionModule = mods[8];
                const codeBlockModule = mods[9];

                const StarterKit = starterKitModule.StarterKit || (starterKitModule.default && starterKitModule.default.StarterKit);
                const Placeholder = placeholderModule.Placeholder || (placeholderModule.default && placeholderModule.default.Placeholder);
                const Underline = underlineModule.Underline || (underlineModule.default && underlineModule.default.Underline);
                const BaseImage = imageModule.Image || (imageModule.default && imageModule.default.Image);
                const Link = linkModule.Link || (linkModule.default && linkModule.default.Link);
                const Mention = mentionModule.Mention || (mentionModule.default && mentionModule.default.Mention);
                const BaseCodeBlock = codeBlockModule.CodeBlock || (codeBlockModule.default && codeBlockModule.default.CodeBlock);

                if (!Mention) throw new Error('Mention extension not found');
                if (!BaseCodeBlock) throw new Error('CodeBlock extension not found');

                const CustomLink = Link.configure({
                    openOnClick: false,
                    autolink: true,
                    linkOnPaste: true,
                    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
                });

                const CustomImage = BaseImage.extend({
                    inline: true,
                    group: 'inline',
                    draggable: true,
                    parseHTML() {
                        return [
                            {
                                tag: 'img',
                                getAttrs: el => {
                                    const src = el.getAttribute('src') || '';
                                    if (!src) return false;
                                    if (src.indexOf('twemoji') !== -1) return false;
                                    return {};
                                },
                            },
                        ];
                    },
                    addAttributes() {
                        return {
                            ...this.parent?.(),
                            src: { default: null },
                            alt: { default: 'image' },
                            width: { default: null },
                            height: { default: null },
                            loading: { default: 'lazy' },
                            decoding: { default: 'async' },
                            nsfw: {
                                default: false,
                                parseHTML: el => el.getAttribute('data-nsfw') === 'true',
                                renderHTML: attrs => attrs.nsfw ? { 'data-nsfw': 'true' } : {},
                            },
                            size: {
                                default: null,
                                parseHTML: el => el.getAttribute('data-size') || null,
                                renderHTML: attrs => attrs.size ? { 'data-size': attrs.size } : {},
                            },
                        };
                    },
                    renderHTML({ node, HTMLAttributes }) {
                        return [
                            'img',
                            {
                                ...HTMLAttributes,
                                src: node.attrs.src,
                                alt: node.attrs.alt,
                                loading: node.attrs.loading,
                                decoding: node.attrs.decoding,
                                width: node.attrs.width,
                                height: node.attrs.height,
                            },
                        ];
                    },
                });

                const Emoji = Node.create({
                    name: 'emoji',
                    inline: true,
                    group: 'inline',
                    atom: true,
                    addAttributes() {
                        return {
                            src: { default: null },
                            alt: { default: '' },
                            loading: { default: 'lazy' },
                            decoding: { default: 'async' },
                            width: { default: 24 },
                            height: { default: 24 },
                        };
                    },
                    parseHTML() {
                        return [{ tag: 'img[src*="twemoji"]' }];
                    },
                    renderHTML({ node, HTMLAttributes }) {
                        return ['img', {
                            ...HTMLAttributes,
                            src: node.attrs.src,
                            alt: node.attrs.alt,
                            loading: node.attrs.loading,
                            decoding: node.attrs.decoding,
                            width: node.attrs.width,
                            height: node.attrs.height,
                            class: 'twemoji'
                        }];
                    },
                    renderText({ node }) { return node.attrs.alt || ''; },
                });

                const UploadPlaceholder = Node.create({
                    name: 'uploadPlaceholder',
                    inline: true,
                    group: 'inline',
                    atom: true,
                    selectable: false,
                    addAttributes() { return { id: { default: null } }; },
                    parseHTML() { return []; },
                    renderHTML({ node }) {
                        return ['span', { class: 'upload-placeholder', 'data-upload-id': node.attrs.id || '' }, 'Uploading image…'];
                    },
                    renderText() { return ''; },
                });

                const CustomCodeBlock = BaseCodeBlock.extend({
                    addAttributes() {
                        return {
                            ...this.parent?.(),
                            language: {
                                default: null,
                                parseHTML: el => el.getAttribute('data-language') || null,
                                renderHTML: attrs => attrs.language ? { 'data-language': attrs.language } : {},
                            },
                        };
                    },
                });

                const emoticonPattern = Object.keys(ASCII_EMOTICON_MAP)
                    .sort(function(a, b) { return b.length - a.length; })
                    .map(function(e) { return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
                    .join('|');
                const emoticonRegex = new RegExp('(?:^|\\s)(' + emoticonPattern + ')$');

                const EmoticonRule = Extension.create({
                    name: 'emoticonRule',
                    addInputRules() {
                        return [
                            new InputRule({
                                find: emoticonRegex,
                                handler: function({ state, range, match }) {
                                    const emoticon = match[1];
                                    const codepoint = ASCII_EMOTICON_MAP[emoticon];
                                    if (!codepoint) return null;

                                    const codeMark = state.schema.marks.code;
                                    if (codeMark && codeMark.isInSet(state.selection.$from.marks())) return null;

                                    const unicodeEmoji = String.fromCodePoint(parseInt(codepoint, 16));
                                    const emojiUrl = TWEMOJI_BASE + codepoint + '.svg';

                                    const leading = match[0].length - emoticon.length;
                                    const emoticonStart = range.from + leading;

                                    const emojiNode = state.schema.nodes.emoji.create({
                                        src: emojiUrl,
                                        alt: unicodeEmoji,
                                        loading: 'lazy',
                                        decoding: 'async',
                                        width: 24,
                                        height: 24
                                    });
                                    state.tr.replaceWith(emoticonStart, range.to, emojiNode);
                                }
                            })
                        ];
                    }
                });

                function parseYouTubeUrl(url) {
                    if (!url || typeof url !== 'string') return null;
                    const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
                    if (!m) return null;
                    const videoid = m[1];

                    let start = null;
                    let end = null;

                    const qIndex = url.indexOf('?');
                    if (qIndex >= 0) {
                        const hashIndex = url.indexOf('#', qIndex);
                        const queryStr = url.slice(qIndex + 1, hashIndex >= 0 ? hashIndex : undefined);
                        try {
                            const params = new URLSearchParams(queryStr);
                            const t = params.get('t') || params.get('start');
                            if (t) {
                                const parsed = parseTimeString(t);
                                if (parsed != null) start = parsed;
                            }
                            const e = params.get('end');
                            if (e) {
                                const parsed = parseInt(e, 10);
                                if (!isNaN(parsed) && parsed > 0) end = parsed;
                            }
                        } catch (err) {}
                    }

                    return { videoid, start, end };
                }
                function parseVimeoUrl(url) {
                    if (!url || typeof url !== 'string') return null;
                    const m = url.match(/vimeo\.com\/(?:[^\/\s]+\/)*?(\d+)/);
                    if (!m) return null;
                    const videoid = m[1];

                    let start = null;

                    try {
                        const hashIndex = url.indexOf('#');
                        if (hashIndex >= 0) {
                            const frag = url.slice(hashIndex + 1);
                            const fragMatch = frag.match(/^t=(.+)$/);
                            if (fragMatch) {
                                const parsed = parseTimeString(fragMatch[1]);
                                if (parsed != null) start = parsed;
                            }
                        }
                        if (start == null) {
                            const qIndex = url.indexOf('?');
                            if (qIndex >= 0) {
                                const hashIndex2 = url.indexOf('#', qIndex);
                                const queryStr = url.slice(qIndex + 1, hashIndex2 >= 0 ? hashIndex2 : undefined);
                                const params = new URLSearchParams(queryStr);
                                const t = params.get('t');
                                if (t) {
                                    const parsed = parseTimeString(t);
                                    if (parsed != null) start = parsed;
                                }
                            }
                        }
                    } catch (err) {}

                    return { videoid, start };
                }

                const LinkPreview = Node.create({
                    name: 'linkPreview',
                    inline: true,
                    group: 'inline',
                    atom: true,
                    draggable: true,
                    selectable: true,
                    addAttributes() {
                        return {
                            href: { default: '' },
                            title: { default: '' },
                            description: { default: '' },
                            author: { default: '' },
                            imageSrc: { default: '' },
                            loading: { default: false },
                        };
                    },
                    parseHTML() {
                        return [{ tag: 'span[data-type="link-preview"]' }];
                    },
                    renderHTML({ node, HTMLAttributes }) {
                        var href = node.attrs.href;
                        var title = node.attrs.title;
                        var description = node.attrs.description;
                        var imageSrc = node.attrs.imageSrc;
                        var loading = node.attrs.loading;

                        var hostname = '';
                        try {
                            hostname = new URL(href).hostname.replace(/^www\./, '');
                        } catch (e) {
                            hostname = href.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
                        }

                        if (loading) {
                            return [
                                'span',
                                { class: 'link-preview-card link-preview-card--loading', 'data-type': 'link-preview', ...HTMLAttributes },
                                ['span', { class: 'link-preview-skeleton' },
                                    ['span', { class: 'link-preview-skeleton-bar', style: 'width:40%;' }],
                                    ['span', { class: 'link-preview-skeleton-bar', style: 'width:80%;' }],
                                    ['span', { class: 'link-preview-skeleton-bar', style: 'width:60%;' }]
                                ]
                            ];
                        }

                        var finalImageUrl = imageSrc;
                        if (imageSrc && imageSrc.startsWith('/')) {
                            try { finalImageUrl = new URL(href).origin + imageSrc; }
                            catch (e) { finalImageUrl = imageSrc; }
                        }

                        var faviconUrl = 'https://www.google.com/s2/favicons?domain=' + hostname + '&sz=32';
                        var isRich = finalImageUrl && finalImageUrl.trim() !== '';

                        function isGenericTitle(t, h) {
                            if (!t || t === h) return true;
                            var generic = ['just a moment', 'access denied', 'verification required', 'please wait', 'captcha', 'challenge', 'checking your browser'];
                            var lower = t.toLowerCase();
                            return generic.some(function(term) { return lower.indexOf(term) !== -1; });
                        }
                        function needsProxy(url) {
                            if (!url) return false;
                            var blocked = ['discordapp.com', 'cdn.discordapp.com', 'media.discordapp.net', 'github.com', 'raw.githubusercontent.com', 'redd.it', 'reddit.com', 'twimg.com', 'pbs.twimg.com'];
                            try {
                                var host = new URL(url).hostname;
                                return blocked.some(function(d) { return host.includes(d); });
                            } catch (_) { return false; }
                        }

                        if (!isRich) {
                            var showTitle = !isGenericTitle(title, href);
                            var titlePart = showTitle ? (' – ' + title) : '';
                            return [
                                'span',
                                { class: 'link-preview-simple', 'data-type': 'link-preview', ...HTMLAttributes },
                                [
                                    'a',
                                    { href: href, target: '_blank', rel: 'noopener noreferrer', class: 'simple-link' },
                                    ['img', { src: faviconUrl, class: 'simple-favicon', alt: '', loading: 'lazy' }],
                                    ['span', { class: 'simple-hostname' }, hostname],
                                    ['span', { class: 'simple-title' }, titlePart]
                                ]
                            ];
                        }

                        var proxiedImage = finalImageUrl;
                        if (needsProxy(finalImageUrl)) {
                            proxiedImage = 'https://images.weserv.nl/?url=' + encodeURIComponent(finalImageUrl) + '&output=webp&q=85';
                        }

                        return [
                            'span',
                            { class: 'link-preview-card', 'data-type': 'link-preview', ...HTMLAttributes },
                            [
                                'a',
                                { href: href, target: '_blank', rel: 'noopener noreferrer', class: 'link-preview-link' },
                                [
                                    'span',
                                    { class: 'link-preview-content' },
                                    [
                                        'span',
                                        { class: 'embedded-link-image' },
                                        ['img', { src: proxiedImage, class: 'link-preview-image', loading: 'lazy', alt: '' }]
                                    ],
                                    [
                                        'span',
                                        { class: 'link-preview-text' },
                                        ['span', { class: 'link-preview-title' }, title || href],
                                        node.attrs.author
                                            ? ['span', { class: 'link-preview-author' }, node.attrs.author]
                                            : '',
                                        description ? ['span', { class: 'link-preview-description' }, description] : '',
                                        [
                                            'span',
                                            { class: 'link-preview-url-wrapper' },
                                            ['img', { src: faviconUrl, class: 'link-preview-favicon', alt: '' }],
                                            ['span', { class: 'link-preview-hostname' }, hostname]
                                        ]
                                    ]
                                ]
                            ]
                        ];
                    },
                });

                const LiteYouTube = Node.create({
                    name: 'liteYouTube',
                    group: 'block',
                    atom: true,
                    draggable: true,
                    selectable: true,
                    addAttributes() {
                        return {
                            videoid: {
                                default: null,
                                parseHTML: el => el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                                renderHTML: attrs => attrs.videoid ? { videoid: attrs.videoid } : {},
                            },
                            title:  { default: '', renderHTML: () => ({}) },
                            author: { default: '', renderHTML: () => ({}) },
                            start: {
                                default: null,
                                parseHTML: el => el.getAttribute('start') || null,
                                renderHTML: attrs => attrs.start ? { start: String(attrs.start) } : {},
                            },
                            end: {
                                default: null,
                                parseHTML: el => el.getAttribute('end') || null,
                                renderHTML: attrs => attrs.end ? { end: String(attrs.end) } : {},
                            },
                        };
                    },
                    parseHTML() {
                        return [
                            {
                                tag: 'div.lite-embed-wrapper',
                                getAttrs: el => {
                                    const lite = el.querySelector('lite-youtube');
                                    if (!lite) return false;
                                    return {
                                        videoid: lite.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                                        title: el.getAttribute('data-title') || '',
                                        author: el.getAttribute('data-author') || '',
                                        start: el.getAttribute('data-start') || lite.getAttribute('start') || null,
                                        end: el.getAttribute('data-end') || lite.getAttribute('end') || null,
                                    };
                                },
                            },
                            {
                                tag: 'lite-youtube',
                                getAttrs: el => ({
                                    videoid: el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                                    title: el.getAttribute('data-title') || '',
                                    author: el.getAttribute('data-author') || '',
                                    start: el.getAttribute('start') || null,
                                    end: el.getAttribute('end') || null,
                                }),
                            },
                            { tag: 'span.ff-lite-youtube' },
                        ];
                    },
                    renderHTML({ node, HTMLAttributes }) {
                        const title = node.attrs.title || '';
                        const author = node.attrs.author || '';
                        const caption = (title || author)
                            ? ['div', { class: 'lite-embed-caption' },
                                title ? ['span', { class: 'lite-embed-title' }, title] : '',
                                author ? ['span', { class: 'lite-embed-author' }, author] : ''
                              ]
                            : '';
                        return [
                            'div',
                            {
                                class: 'lite-embed-wrapper',
                                'data-videoid': node.attrs.videoid || '',
                                'data-title': title || null,
                                'data-author': author || null,
                                'data-start': node.attrs.start != null ? String(node.attrs.start) : null,
                                'data-end':   node.attrs.end   != null ? String(node.attrs.end)   : null,
                            },
                            ['lite-youtube', HTMLAttributes],
                            caption,
                        ];
                    },
                });

                const LiteVimeo = Node.create({
                    name: 'liteVimeo',
                    group: 'block',
                    atom: true,
                    draggable: true,
                    selectable: true,
                    addAttributes() {
                        return {
                            videoid: {
                                default: null,
                                parseHTML: el => el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                                renderHTML: attrs => attrs.videoid ? { videoid: attrs.videoid } : {},
                            },
                            title:  { default: '', renderHTML: () => ({}) },
                            author: { default: '', renderHTML: () => ({}) },
                            start: {
                                default: null,
                                parseHTML: el => el.getAttribute('start') || null,
                                renderHTML: attrs => attrs.start ? { start: String(attrs.start) } : {},
                            },
                        };
                    },
                    parseHTML() {
                        return [
                            {
                                tag: 'div.lite-embed-wrapper',
                                getAttrs: el => {
                                    const lite = el.querySelector('lite-vimeo');
                                    if (!lite) return false;
                                    return {
                                        videoid: lite.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                                        title: el.getAttribute('data-title') || '',
                                        author: el.getAttribute('data-author') || '',
                                        start: el.getAttribute('data-start') || lite.getAttribute('start') || null,
                                    };
                                },
                            },
                            {
                                tag: 'lite-vimeo',
                                getAttrs: el => ({
                                    videoid: el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                                    title: el.getAttribute('data-title') || '',
                                    author: el.getAttribute('data-author') || '',
                                    start: el.getAttribute('start') || null,
                                }),
                            },
                            { tag: 'span.ff-lite-vimeo' },
                        ];
                    },
                    renderHTML({ node, HTMLAttributes }) {
                        const title = node.attrs.title || '';
                        const author = node.attrs.author || '';
                        const caption = (title || author)
                            ? ['div', { class: 'lite-embed-caption' },
                                title ? ['span', { class: 'lite-embed-title' }, title] : '',
                                author ? ['span', { class: 'lite-embed-author' }, author] : ''
                              ]
                            : '';
                        return [
                            'div',
                            {
                                class: 'lite-embed-wrapper',
                                'data-videoid': node.attrs.videoid || '',
                                'data-title': title || null,
                                'data-author': author || null,
                                'data-start': node.attrs.start != null ? String(node.attrs.start) : null,
                            },
                            ['lite-vimeo', HTMLAttributes],
                            caption,
                        ];
                    },
                });

                const Spoiler = Node.create({
                    name: 'spoiler',
                    group: 'block',
                    content: 'block+',
                    defining: true,
                    addAttributes() {
                        return {
                            title: {
                                default: null,
                                parseHTML: el => el.getAttribute('data-title') || null,
                                renderHTML: attrs => attrs.title ? { 'data-title': attrs.title } : {},
                            },
                        };
                    },
                    parseHTML: () => [{ tag: 'div.spoiler' }],
                    renderHTML({ HTMLAttributes }) {
                        return ['div', { class: 'spoiler', ...HTMLAttributes }, 0];
                    },
                    addCommands() {
                        return {
                            setSpoiler: () => ({ commands }) => commands.wrapIn(this.name),
                            toggleSpoiler: () => ({ commands }) => commands.toggleWrap(this.name),
                            unsetSpoiler: () => ({ commands }) => commands.lift(this.name),
                            setSpoilerTitle: (title) => ({ commands }) => commands.updateAttributes(this.name, { title }),
                        };
                    },
                });

                const NSFW = Mark.create({
                    name: 'nsfw',
                    inclusive: false,
                    parseHTML() {
                        return [{
                            tag: 'span',
                            getAttrs: el => el.classList.contains('ff-nsfw') ? {} : false,
                        }];
                    },
                    renderHTML() {
                        return ['span', { class: 'ff-nsfw' }, 0];
                    },
                    addCommands() {
                        return {
                            setNSFW: () => ({ commands }) => commands.setMark(this.name),
                            toggleNSFW: () => ({ commands }) => commands.toggleMark(this.name),
                            unsetNSFW: () => ({ commands }) => commands.unsetMark(this.name),
                        };
                    },
                });

                var lastMentionItems = [];

                const CustomMention = Mention.extend({
                    addAttributes() {
                        return {
                            id: {
                                default: null,
                                parseHTML: function(el) { return el.getAttribute('data-uid'); },
                                renderHTML: function(attrs) {
                                    return attrs.id != null ? { 'data-uid': attrs.id } : {};
                                },
                            },
                            label: {
                                default: null,
                                parseHTML: function(el) {
                                    var v = el.getAttribute('data-username') || el.textContent || '';
                                    return decodeHtmlEntities(v).replace(/^@/, '');
                                },
                                renderHTML: function(attrs) {
                                    return attrs.label ? { 'data-username': attrs.label } : {};
                                },
                            },
                        };
                    },
                    renderHTML: function({ node }) {
                        return ['mark', {
                            'data-uid': node.attrs.id,
                            'data-username': node.attrs.label || '',
                        }, node.attrs.label || ''];
                    },
                    parseHTML: function() {
                        return [{
                            tag: 'mark[data-uid]',
                            getAttrs: function(el) {
                                var raw = el.getAttribute('data-username') || el.textContent || '';
                                raw = decodeHtmlEntities(raw).replace(/^@/, '');
                                return { id: el.getAttribute('data-uid'), label: raw };
                            },
                        }];
                    },
                }).configure({
                    HTMLAttributes: { class: 'user-tag' },
                    renderText: function({ node }) {
                        return '@' + (node.attrs.label || '');
                    },
                    suggestion: {
                        char: '@',
                        allowSpaces: false,
                        allow: function({ state, range }) {
                            try {
                                var $from = state.doc.resolve(range.from);
                                return $from.parent.type.name !== 'codeBlock';
                            } catch (e) { return true; }
                        },
                        items: function({ query }) {
                            return searchMentions(query, 'mention').then(function(res) {
                                if (res === null) return lastMentionItems;
                                lastMentionItems = res;
                                return res;
                            });
                        },
                        render: function() {
                            var popup = null;
                            var items = [];
                            var selectedIndex = 0;
                            var itemEls = [];
                            var lastProps = null;

                            function updateSelected() {
                                itemEls.forEach(function(el, i) {
                                    el.classList.toggle('is-selected', i === selectedIndex);
                                });
                            }

                            function makeInitialAvatar(name, userId) {
                                var initial = getInitialFromName(name);
                                var span = document.createElement('span');
                                span.className = 'mention-suggestion-avatar mention-suggestion-avatar--initial';
                                span.style.backgroundColor = '#' + getColorFromNickname(name, userId);
                                span.textContent = initial;
                                return span;
                            }

                            function buildList(props) {
                                items = props.items || [];
                                var seen = {};
                                items = items.filter(function(u) {
                                    var k = String(u.id);
                                    if (seen[k]) return false;
                                    seen[k] = true;
                                    return true;
                                });
                                selectedIndex = 0;
                                itemEls = [];

                                if (!popup) return;
                                popup.innerHTML = '';

                                if (items.length === 0) {
                                    var emptyRow = document.createElement('div');
                                    emptyRow.style.cssText = 'padding:var(--pad-2) var(--pad-3);color:var(--text-tertiary);font-size:var(--text-xs);font-style:italic;';
                                    emptyRow.textContent = 'No users found';
                                    popup.appendChild(emptyRow);
                                    popup.style.display = 'block';
                                    return;
                                }

                                items.forEach(function(user) {
                                    var el = document.createElement('button');
                                    el.type = 'button';
                                    el.className = 'mention-suggestion-item';
                                    el.setAttribute('role', 'option');

                                    var rawAvatar = (typeof user.avatar === 'string' && user.avatar) ? user.avatar : null;
                                    var avatarUrl = (rawAvatar && !shouldUseInitialAvatar(rawAvatar))
                                        ? (optimizeAvatarUrl(rawAvatar, 28, 28) || rawAvatar)
                                        : null;

                                    var userName = decodeHtmlEntities(user.name || '');

                                    if (avatarUrl) {
                                        var img = document.createElement('img');
                                        img.className = 'mention-suggestion-avatar';
                                        img.src = avatarUrl;
                                        img.alt = '';
                                        img.width = 28;
                                        img.height = 28;
                                        img.loading = 'lazy';
                                        img.onerror = function() { this.replaceWith(makeInitialAvatar(userName, user.id)); };
                                        img.onload = function() {
                                            if (this.naturalWidth <= 1 || this.naturalHeight <= 1) {
                                                this.replaceWith(makeInitialAvatar(userName, user.id));
                                            }
                                        };
                                        el.appendChild(img);
                                    } else {
                                        el.appendChild(makeInitialAvatar(userName, user.id));
                                    }

                                    var name = document.createElement('span');
                                    name.className = 'mention-suggestion-name';
                                    name.textContent = userName;
                                    el.appendChild(name);

                                    el.addEventListener('mousedown', function(e) {
                                        e.preventDefault();
                                        props.command({ id: String(user.id), label: userName || String(user.id) });
                                    });

                                    itemEls.push(el);
                                    popup.appendChild(el);
                                });

                                popup.style.display = 'block';
                                updateSelected();
                            }

                            function positionPopup(props) {
                                if (!popup) return;
                                var rect = props.clientRect && props.clientRect();
                                if (!rect) return;
                                var scrollX = window.pageXOffset || document.documentElement.scrollLeft;
                                var scrollY = window.pageYOffset || document.documentElement.scrollTop;
                                popup.style.left = (rect.left + scrollX) + 'px';
                                popup.style.top = (rect.bottom + scrollY + 4) + 'px';
                            }

                            function reposition() {
                                if (lastProps && popup) positionPopup(lastProps);
                            }

                            return {
                                onStart: function(props) {
                                    lastProps = props;
                                    popup = document.createElement('div');
                                    popup.className = 'mention-suggestions';
                                    popup.setAttribute('role', 'listbox');
                                    document.body.appendChild(popup);
                                    window.addEventListener('scroll', reposition, true);
                                    window.addEventListener('resize', reposition);
                                    buildList(props);
                                    positionPopup(props);
                                },
                                onUpdate: function(props) {
                                    lastProps = props;
                                    if (!popup) return;
                                    buildList(props);
                                    positionPopup(props);
                                },
                                onKeyDown: function(props) {
                                    if (!popup || popup.style.display === 'none' || items.length === 0) return false;
                                    if (props.event.key === 'ArrowDown') {
                                        selectedIndex = (selectedIndex + 1) % items.length;
                                        updateSelected();
                                        return true;
                                    }
                                    if (props.event.key === 'ArrowUp') {
                                        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                                        updateSelected();
                                        return true;
                                    }
                                    if (props.event.key === 'Enter' || props.event.key === 'Tab') {
                                        var user = items[selectedIndex];
                                        if (user) {
                                            props.command({
                                                id: String(user.id),
                                                label: decodeHtmlEntities(user.name || '') || String(user.id),
                                            });
                                        }
                                        return true;
                                    }
                                    if (props.event.key === 'Escape') {
                                        if (popup) { popup.remove(); popup = null; }
                                        return true;
                                    }
                                    return false;
                                },
                                onExit: function() {
                                    window.removeEventListener('scroll', reposition, true);
                                    window.removeEventListener('resize', reposition);
                                    if (popup) { popup.remove(); popup = null; }
                                    items = [];
                                    itemEls = [];
                                    lastProps = null;
                                },
                            };
                        },
                    },
                });

                const SemanticColor = Mark.create({
                    name: 'semanticColor',
                    addAttributes() { return { variant: { default: 'primary' } }; },
                    parseHTML() {
                        return [{
                            tag: 'span[data-color]',
                            getAttrs: function(el) {
                                var v = el.getAttribute('data-color');
                                if (v === 'success') v = 'primary';
                                if (v && LEGACY_COLOR_MAP[v]) v = LEGACY_COLOR_MAP[v];
                                return v ? { variant: v } : false;
                            }
                        }];
                    },
                    renderHTML({ HTMLAttributes }) {
                        var variant = HTMLAttributes.variant || 'primary';
                        return ['span', { class: 'text-' + variant, 'data-color': variant }, 0];
                    }
                });

                const linkPreviewPlugin = new Plugin({
                    key: new PluginKey('linkPreview'),
                    props: {
                        handlePaste: (view, event) => {
                            var text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                            if (!text) return false;
                            var trimmed = text.trim();
                            var urlRegex = /^(https?:\/\/[^\s]+)$/;
                            if (!urlRegex.test(trimmed)) return false;

                            var sel = view.state.selection;
                            if (!sel.empty) return false;
                            if (sel.$from.parent.type.spec.code) return false;
                            var codeMark = view.state.schema.marks.code;
                            if (codeMark && codeMark.isInSet(sel.$from.marks())) return false;

                            event.preventDefault();

                            var url = trimmed;

                            if (IMAGE_URL_RE.test(url)) {
                                insertImageFromUrl(url);
                                return true;
                            }

                            var state = view.state;
                            var tr = state.tr.replaceWith(
                                state.selection.from, state.selection.to,
                                state.schema.nodes.linkPreview.create({
                                    href: url, title: '', description: '', imageSrc: '', loading: true
                                })
                            );
                            view.dispatch(tr);

                            function findSkeleton() {
                                var foundPos = -1;
                                view.state.doc.descendants(function(node, pos) {
                                    if (node.type.name === 'linkPreview' && node.attrs.href === url && node.attrs.loading) {
                                        foundPos = pos;
                                        return false;
                                    }
                                    return true;
                                });
                                return foundPos;
                            }

                            function replaceSkeletonWithText() {
                                var foundPos = findSkeleton();
                                if (foundPos === -1) return;
                                var trPlain = view.state.tr.replaceWith(
                                    foundPos, foundPos + 1, view.state.schema.text(url)
                                );
                                view.dispatch(trPlain);
                            }

                            var controller = new AbortController();
                            var timeoutId = setTimeout(function() { controller.abort(); }, OG_FETCH_TIMEOUT);

                            fetch(OG_WORKER_URL + encodeURIComponent(url), { signal: controller.signal })
                                .then(function(res) {
                                    clearTimeout(timeoutId);
                                    return res.json();
                                })
                                .then(function(data) {
                                    var foundPos = findSkeleton();
                                    if (foundPos === -1) return;

                                    if (data.error || (!data.imageSrc && (!data.title || data.title === url))) {
                                        replaceSkeletonWithText();
                                        return;
                                    }

                                    var newNode = view.state.schema.nodes.linkPreview.create({
                                        href: data.href || url,
                                        title: data.title || url,
                                        description: data.description || '',
                                        author: data.author || '',
                                        imageSrc: data.imageSrc || '',
                                        loading: false,
                                    });
                                    var tr2 = view.state.tr.replaceWith(foundPos, foundPos + 1, newNode);
                                    view.dispatch(tr2);
                                })
                                .catch(function(err) {
                                    clearTimeout(timeoutId);
                                    if (!(err && err.name === 'AbortError')) {
                                        console.error('Link preview error:', err);
                                    }
                                    replaceSkeletonWithText();
                                });
                            return true;
                        },
                    },
                });

                const BOUNDARY_TYPES = new Set(['liteYouTube', 'liteVimeo', 'spoiler', 'codeBlock', 'blockquote']);
                const CONTAINER_TYPES = new Set(['spoiler', 'blockquote']);

                function collectBoundaryFixes(parent, contentStart, out) {
                    const kids = [];
                    parent.forEach((node, offset) => { kids.push({ node, offset }); });

                    for (let i = 0; i < kids.length; i++) {
                        const { node, offset } = kids[i];
                        if (!BOUNDARY_TYPES.has(node.type.name)) continue;
                        const prev = i > 0 ? kids[i - 1].node : null;
                        const next = i < kids.length - 1 ? kids[i + 1].node : null;
                        if (!prev || BOUNDARY_TYPES.has(prev.type.name)) out.add(contentStart + offset);
                        if (!next || BOUNDARY_TYPES.has(next.type.name)) out.add(contentStart + offset + node.nodeSize);
                    }

                    kids.forEach(({ node, offset }) => {
                        if (CONTAINER_TYPES.has(node.type.name)) {
                            collectBoundaryFixes(node, contentStart + offset + 1, out);
                        }
                    });
                }

                function onlyEmptyParagraphs(doc) {
                    if (doc.childCount < 2) return false;
                    let ok = true;
                    doc.forEach(n => {
                        if (n.type.name !== 'paragraph' || n.content.size > 0) ok = false;
                    });
                    return ok;
                }

                const BlockBoundaryParagraph = Extension.create({
                    name: 'blockBoundaryParagraph',
                    addProseMirrorPlugins() {
                        return [
                            new Plugin({
                                key: new PluginKey('blockBoundaryParagraph'),
                                appendTransaction(transactions, oldState, newState) {
                                    const isInit = transactions.some(tr => tr.getMeta('blockBoundaryInit'));
                                    if (!isInit && !transactions.some(tr => tr.docChanged)) return null;

                                    const doc = newState.doc;
                                    const paragraphType = newState.schema.nodes.paragraph;
                                    if (!doc.firstChild || !paragraphType) return null;

                                    if (!isInit && onlyEmptyParagraphs(doc) && !docIsBlank(oldState.doc)) {
                                        const tr = newState.tr.replaceWith(0, doc.content.size, paragraphType.create());
                                        tr.setSelection(TextSelection.atStart(tr.doc));
                                        return tr;
                                    }

                                    const positions = new Set();
                                    collectBoundaryFixes(doc, 0, positions);
                                    if (positions.size === 0) return null;

                                    const sorted = Array.from(positions).sort((a, b) => b - a);
                                    const tr = newState.tr;
                                    for (let i = 0; i < sorted.length; i++) {
                                        tr.insert(sorted[i], paragraphType.create());
                                    }
                                    if (isInit) tr.setMeta('addToHistory', false);

                                    const sel = tr.selection;
                                    if (sel && sel.empty && sel.$from && !sel.$from.parent.isTextblock) {
                                        try {
                                            const target = Math.min(sel.from, tr.doc.content.size);
                                            tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
                                        } catch (e) {}
                                    }

                                    return tr;
                                },
                            }),
                        ];
                    },
                });

                const AtomSelection = Extension.create({
                    name: 'atomSelection',
                    addProseMirrorPlugins() {
                        return [
                            new Plugin({
                                key: new PluginKey('atomSelection'),
                                props: {
                                    decorations(state) {
                                        const { from, to, empty } = state.selection;
                                        if (empty) return null;
                                        const decorations = [];
                                        state.doc.nodesBetween(from, to, (node, pos) => {
                                            if (node.type.name === 'image' ||
                                                node.type.name === 'liteYouTube' ||
                                                node.type.name === 'liteVimeo') {
                                                decorations.push(
                                                    Decoration.node(pos, pos + node.nodeSize, {
                                                        class: 'atom-in-selection',
                                                    })
                                                );
                                            }
                                        });
                                        return DecorationSet.create(state.doc, decorations);
                                    },
                                },
                            }),
                        ];
                    },
                });

                var textareaRaw = originalTextarea ? (originalTextarea.value || '') : '';
                var initialHtml = textareaRaw ? legacyToHtml(textareaRaw) : '';

                if (!textareaRaw.trim()) {
                    var initDraft = getDraft(getCurrentDraftKey());
                    if (initDraft) {
                        if (initDraft.bodyHtml) {
                            initialHtml = initDraft.bodyHtml;
                        }
                        if (initDraft.subject && modernTitle) {
                            modernTitle.value = initDraft.subject;
                        }
                    }
                }

                initialHtml = ensureTrailingParagraphInHtml(initialHtml);

                editor = new Editor({
                    element: editorElement,
                    extensions: [
                        StarterKit.configure({
                            codeBlock: false,
                            dropcursor: { color: '#10b981', width: 2 }
                        }),
                        CustomCodeBlock,
                        Placeholder.configure({ placeholder: 'Write your message…' }),
                        Underline,
                        CustomImage,
                        Emoji,
                        UploadPlaceholder,
                        CustomLink,
                        LiteYouTube,
                        LiteVimeo,
                        Spoiler,
                        NSFW,
                        LinkPreview,
                        SemanticColor,
                        CustomMention,
                        EmoticonRule,
                        BlockBoundaryParagraph,
                        AtomSelection,
                    ],
                    content: initialHtml,
                    editorProps: {
                        attributes: {
                            class: 'modern-wysiwyg-content',
                            role: 'textbox',
                            'aria-multiline': 'true',
                            'aria-label': 'Message body',
                        },
                        plugins: [linkPreviewPlugin],
                        transformPastedHTML: function(html) {
                            if (!html || typeof html !== 'string') return html;
                            if (html.indexOf('&nbsp') === -1 &&
                                html.indexOf('&#160') === -1 &&
                                html.indexOf('\u00a0') === -1) {
                                return html;
                            }
                            return html
                                .replace(/&nbsp;?|&#160;|&#xA0;/gi, ' ')
                                .replace(/\u00a0/g, ' ')
                                .replace(/ {2,}/g, ' ');
                        },
                        handleDrop: function(view, event, slice, moved) {
                            if (moved) return false;
                            var files = event.dataTransfer ? event.dataTransfer.files : null;
                            if (!files || !files.length) return false;
                            var imgs = Array.prototype.slice.call(files).filter(function(f) {
                                return f.type && f.type.indexOf('image/') === 0;
                            });
                            if (!imgs.length) return false;
                            event.preventDefault();
                            var coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
                            if (coords) {
                                try {
                                    view.dispatch(view.state.tr.setSelection(
                                        TextSelection.near(view.state.doc.resolve(coords.pos))
                                    ));
                                } catch (e) {}
                            }
                            imgs.forEach(function(f) { uploadImageToWorker(f); });
                            return true;
                        },
                        handlePaste: function(view, event) {
                            var clipboard = event.clipboardData;

                            var files = clipboard ? clipboard.files : null;
                            if (files && files.length) {
                                var imgs = Array.prototype.slice.call(files).filter(function(f) {
                                    return f.type && f.type.indexOf('image/') === 0;
                                });
                                if (imgs.length) {
                                    event.preventDefault();
                                    imgs.forEach(function(f) { uploadImageToWorker(f); });
                                    return true;
                                }
                            }

                            if (plainPasteArmed) {
                                plainPasteArmed = false;
                                var plain = clipboard ? clipboard.getData('text/plain') : '';
                                if (plain) {
                                    event.preventDefault();
                                    view.dispatch(view.state.tr.insertText(plain).scrollIntoView());
                                    return true;
                                }
                            }

                            if (view.state.selection.empty) {
                                var $from = view.state.selection.$from;
                                var codeMarkType = view.state.schema.marks.code;
                                var hasCode = codeMarkType && codeMarkType.isInSet($from.marks());
                                if (hasCode) {
                                    var pasteText = clipboard ? clipboard.getData('text/plain') : '';
                                    if (pasteText && pasteText.length > 0) {
                                        event.preventDefault();
                                        var collapsed = pasteText.replace(/\s+/g, ' ').trim();
                                        if (collapsed) {
                                            view.dispatch(view.state.tr.insertText(collapsed));
                                        }
                                        return true;
                                    }
                                }
                            }

                            if (clipboard) {
                                var htmlData = clipboard.getData('text/html');
                                if (htmlData && htmlData.indexOf('<iframe') !== -1) {
                                    var srcMatch = htmlData.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                                    var iframeSrc = srcMatch ? srcMatch[1].replace(/&amp;/g, '&') : '';
                                    if (iframeSrc) {
                                        var ytFromIframe = parseYouTubeUrl(iframeSrc);
                                        if (ytFromIframe) {
                                            event.preventDefault();
                                            insertLiteEmbed('liteYouTube', ytFromIframe.videoid, {
                                                start: ytFromIframe.start,
                                                end: ytFromIframe.end
                                            });
                                            return true;
                                        }
                                        var vmFromIframe = parseVimeoUrl(iframeSrc);
                                        if (vmFromIframe) {
                                            event.preventDefault();
                                            insertLiteEmbed('liteVimeo', vmFromIframe.videoid, {
                                                start: vmFromIframe.start
                                            });
                                            return true;
                                        }
                                    }
                                }

                                var textData = clipboard.getData('text/plain');
                                if (textData) {
                                    var candidate = textData.trim();
                                    if (/^https?:\/\/\S+$/.test(candidate) && view.state.selection.empty) {
                                        var yt = parseYouTubeUrl(candidate);
                                        if (yt) {
                                            event.preventDefault();
                                            insertLiteEmbed('liteYouTube', yt.videoid, {
                                                start: yt.start,
                                                end: yt.end
                                            });
                                            return true;
                                        }
                                        var vm = parseVimeoUrl(candidate);
                                        if (vm) {
                                            event.preventDefault();
                                            insertLiteEmbed('liteVimeo', vm.videoid, {
                                                start: vm.start
                                            });
                                            return true;
                                        }
                                    }
                                }
                            }

                            return false;
                        },
                        handleDOMEvents: {
                            keydown: function(view, event) {
                                var mod = event.ctrlKey || event.metaKey;

                                if (mod && event.shiftKey && (event.key === 'v' || event.key === 'V')) {
                                    plainPasteArmed = true;
                                    if (plainPasteTimer) clearTimeout(plainPasteTimer);
                                    plainPasteTimer = setTimeout(function() { plainPasteArmed = false; }, 1500);
                                    return false;
                                }

                                if (mod && event.key === 'Enter') {
                                    event.preventDefault();
                                    var sendBtn = container.querySelector('#modern-submit');
                                    if (sendBtn && !sendBtn.disabled) sendBtn.click();
                                    return true;
                                }
                                if (mod && !event.shiftKey && (event.key === 'k' || event.key === 'K')) {
                                    event.preventDefault();
                                    linkBtn.click();
                                    return true;
                                }
                                if (mod && !event.shiftKey && (event.key === 'e' || event.key === 'E')) {
                                    event.preventDefault();
                                    if (editor) editor.chain().focus().toggleCode().run();
                                    return true;
                                }
                                if (event.ctrlKey && event.shiftKey && (event.key === 's' || event.key === 'S')) {
                                    event.preventDefault();
                                    spoilerBtn.click();
                                    return true;
                                }
                                if (event.ctrlKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) {
                                    event.preventDefault();
                                    nsfwBtn.click();
                                    return true;
                                }
                                if (event.key === 'Escape') {
                                    var sel = view.state.selection;
                                    if (sel && sel.node) {
                                        event.preventDefault();
                                        try {
                                            var near = TextSelection.near(view.state.doc.resolve(sel.to), 1);
                                            view.dispatch(view.state.tr.setSelection(near).scrollIntoView());
                                        } catch (e) {}
                                        return true;
                                    }
                                }
                                return false;
                            }
                        }
                    },
                    onCreate: function({ editor: ed }) {
                        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
                        var active = document.activeElement;
                        if (active && active !== document.body && active !== document.documentElement) return;
                        ed.commands.focus('end');
                    },
                    onUpdate: function() {
                        syncTextareaDebounced();
                        persistCurrentDraftDebounced();
                        updateSendState();
                        updateCharCounter();
                        scheduleLivePreviewRefresh();
                    }
                });

                cleanupFns.push(function() {
                    try { if (editor) editor.destroy(); } catch (e) {}
                    editor = null;
                });

                try {
                    editor.view.dispatch(
                        editor.state.tr.setMeta('blockBoundaryInit', true).setMeta('addToHistory', false)
                    );
                } catch (e) {}

                modernSubmitBtnRef = container.querySelector('#modern-submit');
                modernPreviewBtnRef = container.querySelector('#modern-preview');

                undoBtn.onclick = function() { exec(function() { editor.chain().focus().undo().run(); }); };
                redoBtn.onclick = function() { exec(function() { editor.chain().focus().redo().run(); }); };
                clearFormatBtn.onclick = function() {
                    exec(function() { editor.chain().focus().unsetAllMarks().clearNodes().run(); });
                };

                boldBtn.onclick      = function() { exec(function() { editor.chain().focus().toggleBold().run(); }); };
                italicBtn.onclick    = function() { exec(function() { editor.chain().focus().toggleItalic().run(); }); };
                underlineBtn.onclick = function() { exec(function() { editor.chain().focus().toggleUnderline().run(); }); };
                strikeBtn.onclick    = function() { exec(function() { editor.chain().focus().toggleStrike().run(); }); };

                [1, 2, 3].forEach(function(level) {
                    headingButtons['h' + level].onclick = function() {
                        exec(function() { editor.chain().focus().toggleHeading({ level: level }).run(); });
                        closeDropdown(headingDropdownBtn, headingDropdownMenu);
                    };
                });

                listDropdownMenu.querySelector('#bullet-list-option').onclick = function() {
                    exec(function() { editor.chain().focus().toggleBulletList().run(); });
                    closeDropdown(listDropdownBtn, listDropdownMenu);
                };
                listDropdownMenu.querySelector('#ordered-list-option').onclick = function() {
                    exec(function() { editor.chain().focus().toggleOrderedList().run(); });
                    closeDropdown(listDropdownBtn, listDropdownMenu);
                };

                blockquoteBtn.onclick = function() { exec(function() { editor.chain().focus().toggleBlockquote().run(); }); };

                spoilerBtn.onclick = function() {
                    if (!editor) return;

                    if (editor.isActive('spoiler')) {
                        var currentTitle = editor.getAttributes('spoiler').title || '';
                        showSpoilerTitleModal(currentTitle, function(title) {
                            editor.chain().focus().updateAttributes('spoiler', {
                                title: title || null
                            }).run();
                        });
                        return;
                    }

                    showSpoilerTitleModal('', function(title) {
                        var chain = editor.chain().focus();
                        if (title) {
                            chain.wrapIn('spoiler', { title: title }).run();
                        } else {
                            chain.wrapIn('spoiler').run();
                        }
                    });
                };

                nsfwBtn.onclick = function() {
                    exec(function() { editor.chain().focus().toggleNSFW().run(); });
                };

                linkBtn.onclick = function() {
                    if (!editor) return;

                    if (editor.isActive('link')) {
                        var currentHref = editor.getAttributes('link').href || '';
                        showLinkModal(currentHref, function(url) {
                            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                        }, function() {
                            editor.chain().focus().extendMarkRange('link').unsetLink().run();
                        });
                        return;
                    }

                    var sel = editor.state.selection;
                    var hasSelection = !sel.empty && editor.state.doc.textBetween(sel.from, sel.to, '').length > 0;
                    showLinkModal(null, function(url, customText) {
                        if (hasSelection) {
                            editor.chain().focus().setLink({ href: url }).run();
                        } else {
                            editor.chain().focus().insertContent({
                                type: 'text',
                                text: customText || url,
                                marks: [{ type: 'link', attrs: { href: url } }]
                            }).run();
                        }
                    });
                };

                imageDropdownMenu.querySelector('#image-url-option').onclick = function() {
                    closeDropdown(imageDropdownBtn, imageDropdownMenu);
                    showInputModal('Insert image URL', 'https://example.com/image.jpg',
                        function(raw) { return normalizeUrl(raw, ['http:', 'https:']); },
                        function(url) { insertImageFromUrl(url); });
                };

                imageDropdownMenu.querySelector('#image-upload-option').onclick = function() {
                    closeDropdown(imageDropdownBtn, imageDropdownMenu);
                    var input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.multiple = true;
                    input.onchange = function() {
                        if (!input.files) return;
                        Array.prototype.slice.call(input.files).forEach(function(f) { uploadImageToWorker(f); });
                    };
                    input.click();
                };

                function updateActiveStates() {
                    undoBtn.disabled = !editor.can().undo();
                    redoBtn.disabled = !editor.can().redo();

                    var isActive = {
                        bold: editor.isActive('bold'),
                        italic: editor.isActive('italic'),
                        underline: editor.isActive('underline'),
                        strike: editor.isActive('strike'),
                        code: editor.isActive('code'),
                        blockquote: editor.isActive('blockquote'),
                        codeBlock: editor.isActive('codeBlock'),
                        spoiler: editor.isActive('spoiler'),
                        nsfw: editor.isActive('nsfw'),
                        link: editor.isActive('link'),
                        heading1: editor.isActive('heading', { level: 1 }),
                        heading2: editor.isActive('heading', { level: 2 }),
                        heading3: editor.isActive('heading', { level: 3 })
                    };
                    boldBtn.classList.toggle('active', isActive.bold);
                    italicBtn.classList.toggle('active', isActive.italic);
                    underlineBtn.classList.toggle('active', isActive.underline);
                    strikeBtn.classList.toggle('active', isActive.strike);
                    blockquoteBtn.classList.toggle('active', isActive.blockquote);
                    codeDropdownBtn.classList.toggle('active', isActive.code || isActive.codeBlock);
                    spoilerBtn.classList.toggle('active', isActive.spoiler);
                    nsfwBtn.classList.toggle('active', isActive.nsfw);
                    linkBtn.classList.toggle('active', isActive.link);
                    if (isActive.heading1 || isActive.heading2 || isActive.heading3) {
                        headingDropdownBtn.style.backgroundColor = 'var(--primary-color)';
                        headingDropdownBtn.style.color = 'white';
                    } else {
                        headingDropdownBtn.style.backgroundColor = '';
                        headingDropdownBtn.style.color = '';
                    }

                    var activeColorVariant = null;
                    var colorVariants = ['primary', 'info', 'accent', 'warning', 'danger', 'muted'];
                    for (var ci = 0; ci < colorVariants.length; ci++) {
                        if (editor.isActive('semanticColor', { variant: colorVariants[ci] })) {
                            activeColorVariant = colorVariants[ci];
                            break;
                        }
                    }
                    colorDropdownMenu.querySelectorAll('[data-color]').forEach(function(item) {
                        var v = item.getAttribute('data-color');
                        item.classList.toggle('active', v === activeColorVariant);
                    });

                    var swatch = colorDropdownBtn.querySelector('.active-color-indicator');
                    if (activeColorVariant) {
                        colorDropdownBtn.classList.add('active');
                        if (!swatch) {
                            swatch = document.createElement('span');
                            swatch.className = 'active-color-indicator';
                            colorDropdownBtn.appendChild(swatch);
                        }
                        var varMap = {
                            primary: 'primary-light',
                            info: 'accent-color',
                            accent: 'secondary-color',
                            warning: 'warning-color',
                            danger: 'danger-color',
                            muted: 'text-tertiary'
                        };
                        swatch.style.background = 'var(--' + (varMap[activeColorVariant] || 'primary-light') + ')';
                    } else {
                        colorDropdownBtn.classList.remove('active');
                        if (swatch) swatch.remove();
                    }
                }
                editor.on('selectionUpdate', updateActiveStates);
                editor.on('transaction', updateActiveStates);
                updateActiveStates();

                var editorRoot = editor.view.dom;
                if (editorRoot) {
                    setupImageToolbar(editorRoot, editor);
                    setupLiteEmbedToolbar(editorRoot, editor);
                    setupEmoticonAutocomplete(editor, editorRoot);
                }

                _originalEmoticon = window.emoticon;
                window.emoticon = function(x) {
                    if (editor) {
                        editor.chain().focus().insertContent(' ' + x + ' ').run();
                    } else if (_originalEmoticon) {
                        _originalEmoticon(x);
                    }
                };

                updateSendState();
                updateCharCounter();
                syncToOriginal();

            } catch (err) {
                console.error('[MessengerModule] TipTap failed to load:', err);
                editorElement.innerHTML = '<div style="color:red;padding:1rem;">Editor failed to load. Please refresh the page.<br>' + escapeHtml(err.message) + '</div>';
            }
        })();

        var previewArea = document.createElement('div');
        previewArea.id = 'modern-preview-area';
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<h3 class="modern-preview-title"><i class="fa-regular fa-eye"></i> Preview</h3><div class="preview-content"></div>';
        container.appendChild(previewArea);

        attachPreviewHandlers(previewArea);

        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        actions.innerHTML = ''
            + '<button type="button" id="modern-preview" class="modern-btn modern-btn-secondary" aria-pressed="false"><i class="fa-regular fa-eye"></i> Preview</button>'
            + '<button type="button" id="modern-submit" class="modern-btn modern-btn-primary" aria-keyshortcuts="Control+Enter"><i class="fa-regular fa-paper-plane"></i> Send message</button>';
        container.appendChild(actions);

        var modernPreviewBtn = container.querySelector('#modern-preview');
        if (modernPreviewBtn) {
            modernPreviewBtn.onclick = function() {
                if (editorBlank()) return;
                var isOpen = previewArea.style.display !== 'none';
                if (isOpen) {
                    setPreviewOpen(false);
                    return;
                }
                setPreviewOpen(true);
                updateLivePreview();
                previewArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            };
        }

        var modernSubmitBtn = container.querySelector('#modern-submit');
        if (modernSubmitBtn) {
            modernSubmitBtn.onclick = function(e) {
                e.preventDefault();

                if (!currentRecipient || !currentRecipient.name) return;
                var subjectValue = modernTitle ? modernTitle.value.trim() : '';
                if (!subjectValue) return;
                if (editorBlank()) return;
                if (pendingUploads > 0) {
                    showToast('Wait for the image upload to finish', { type: 'warning' });
                    return;
                }

                if (MAX_MESSAGE_LENGTH && editor.getText().length > MAX_MESSAGE_LENGTH) {
                    showToast('Message exceeds the maximum length', { type: 'error' });
                    return;
                }

                if (addSentCheckbox) addSentCheckbox.checked = true;
                if (addTrackingCheckbox) addTrackingCheckbox.checked = true;
                syncTextareaNow();
                syncToOriginal();

                var originalLabel = modernSubmitBtn.innerHTML;
                modernSubmitBtn.disabled = true;
                modernSubmitBtn.innerHTML = '<i class="fa-regular fa-spinner fa-spin"></i> Sending…';

                try {
                    if (typeof ValidateForm === 'function' && !ValidateForm(1)) {
                        modernSubmitBtn.disabled = false;
                        modernSubmitBtn.innerHTML = originalLabel;
                        return;
                    }

                    if (submitButton) submitButton.disabled = false;

                    persistCurrentDraft();

                    stashLastSentMessage({
                        id: currentRecipient ? currentRecipient.id : null,
                        name: currentRecipient ? currentRecipient.name : '',
                        avatar: currentRecipient ? currentRecipient.avatar : null,
                        subject: subjectValue,
                        draftKey: getCurrentDraftKey()
                    });

                    if (originalForm && originalForm instanceof HTMLFormElement) {
                        HTMLFormElement.prototype.submit.call(originalForm);
                    } else if (submitButton) {
                        submitButton.click();
                    } else if (originalForm && typeof originalForm.submit === 'function') {
                        originalForm.submit();
                    } else {
                        throw new Error('No form submit handler found');
                    }
                } catch (err) {
                    console.error('[MessengerModule] Submit failed:', err);
                    clearLastSentMessage();
                    modernSubmitBtn.disabled = false;
                    modernSubmitBtn.innerHTML = originalLabel;
                    showToast('Could not send message', { type: 'error' });
                }
            };
        }

        return container;
    }

    // ========================================================================
    // MESSAGES SECTION
    // ========================================================================
    function buildModernMessagesSection() {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'messages-section';

        try {
            var lastSend = loadLastSentMessage();
            if (lastSend) {
                container.appendChild(buildSentBanner(lastSend));
                if (lastSend.draftKey) clearDraft(lastSend.draftKey);
                clearLastSentMessage();
            }
        } catch (e) {}

        try {
            var folderSelect  = document.querySelector('select[name="VID"]');
            var messageRows   = document.querySelectorAll('.big_list .row-mp');
            var dlItems       = document.querySelectorAll('.main_list dl dd');
            var totalMessages = dlItems.length >= 1 ? dlItems[0].innerText.trim() : '0';
            var spaceLeft     = dlItems.length >= 2 ? dlItems[1].innerText.trim() : '0';
            var folderRow = document.createElement('div');
            folderRow.className = 'messages-folder-row';
            folderRow.innerHTML = ''
                + '<div class="messages-stats">'
                + '<span><i class="fa-regular fa-envelope"></i> Total: ' + escapeHtml(totalMessages) + '</span>'
                + '<span><i class="fa-regular fa-database"></i> Space left: ' + escapeHtml(spaceLeft) + '</span>'
                + '</div>'
                + '<div class="messages-folder-selector">'
                + '<label>Folder:</label> '
                + '<select id="modern-folder-select" class="modern-select" aria-label="Message folder">'
                + (folderSelect ? folderSelect.innerHTML : '<option value="in">Inbox</option><option value="sent">Sent Items</option>')
                + '</select>'
                + '</div>';
            container.appendChild(folderRow);
            var listHeader = document.createElement('div');
            listHeader.className = 'messages-list-header';
            listHeader.innerHTML = ''
                + '<div class="msg-status"></div>'
                + '<div class="msg-title">Message Title</div>'
                + '<div class="msg-sender">Sender</div>'
                + '<div class="msg-date">Date</div>'
                + '<div class="msg-select"><input type="checkbox" id="select-all-msgs" class="modern-checkbox-input" aria-label="Select all messages"></div>';
            container.appendChild(listHeader);
            var listContainer = document.createElement('div');
            listContainer.className = 'messages-list';
            for (var i = 0; i < messageRows.length; i++) {
                var row = messageRows[i];
                var isUnread   = row.classList.contains('on');
                var titleLink  = row.querySelector('.bb h4 a');
                var senderLink = row.querySelector('.xx a');
                var dateSpan   = row.querySelector('.zz .when');
                var date       = dateSpan ? (dateSpan.getAttribute('title') || dateSpan.textContent) : '';
                var origCheckbox = row.querySelector('input[type="checkbox"]');
                var msgName = origCheckbox ? origCheckbox.name : '';
                var msgRow = document.createElement('div');
                msgRow.className = 'message-row' + (isUnread ? ' unread' : ' read');
                msgRow.innerHTML = ''
                    + '<div class="msg-status"><i class="fa-regular ' + (isUnread ? 'fa-envelope' : 'fa-envelope-open') + '"></i></div>'
                    + '<div class="msg-title"><a href="' + escapeHtml(titleLink ? titleLink.getAttribute('href') : '#') + '">' + escapeHtml(titleLink ? titleLink.textContent.trim() : '(no title)') + '</a></div>'
                    + '<div class="msg-sender"><a href="' + escapeHtml(senderLink ? senderLink.getAttribute('href') : '#') + '">' + escapeHtml(senderLink ? senderLink.textContent.trim() : 'Unknown') + '</a></div>'
                    + '<div class="msg-date">' + escapeHtml(formatDate(date)) + '</div>'
                    + '<div class="msg-select"><input type="checkbox" class="modern-checkbox-input" name="' + escapeHtml(msgName) + '" id="msg-' + i + '" aria-label="Select message"></div>';
                listContainer.appendChild(msgRow);
            }
            container.appendChild(listContainer);
            var actionBar = document.createElement('div');
            actionBar.className = 'messages-action-bar';
            actionBar.innerHTML = ''
                + '<div class="action-group">'
                + '<button class="modern-btn modern-btn-secondary" id="move-messages"><i class="fa-regular fa-folder-open"></i> Move to</button> '
                + '<select id="move-folder" class="modern-select-sm" aria-label="Destination folder"><option value="in">Inbox</option><option value="sent">Sent Items</option></select>'
                + '</div>'
                + '<div class="action-group">'
                + '<button class="modern-btn modern-btn-secondary danger" id="delete-messages"><i class="fa-regular fa-trash-can"></i> Delete selected</button>'
                + '</div>';
            container.appendChild(actionBar);
            var folderForm   = folderSelect ? folderSelect.form : null;
            var inboxForm    = document.querySelector('form[name="inbox"]');
            var modernFolder = container.querySelector('#modern-folder-select');
            if (modernFolder && folderSelect && folderForm) {
                modernFolder.addEventListener('change', function() {
                    folderSelect.value = this.value;
                    HTMLFormElement.prototype.submit.call(folderForm);
                });
            }
            var selectAll = container.querySelector('#select-all-msgs');
            if (selectAll) {
                selectAll.addEventListener('change', function() {
                    container.querySelectorAll('.message-row .modern-checkbox-input').forEach(function(cb) {
                        cb.checked = selectAll.checked;
                    });
                });
            }
            function syncCheckboxesToForm() {
                if (!inboxForm) return;
                container.querySelectorAll('.message-row .modern-checkbox-input').forEach(function(cb) {
                    var hidden = inboxForm.querySelector('input[name="' + cb.name + '"]');
                    if (hidden) hidden.checked = cb.checked;
                });
            }
            var deleteBtn = container.querySelector('#delete-messages');
            if (deleteBtn && inboxForm) {
                deleteBtn.addEventListener('click', function() {
                    if (!confirm('Delete selected messages?')) return;
                    syncCheckboxesToForm();
                    var delBtn = inboxForm.querySelector('input[name="delete"]');
                    if (delBtn) delBtn.click(); else HTMLFormElement.prototype.submit.call(inboxForm);
                });
            }
            var moveBtn = container.querySelector('#move-messages');
            if (moveBtn && inboxForm) {
                moveBtn.addEventListener('click', function() {
                    syncCheckboxesToForm();
                    var dest = container.querySelector('#move-folder');
                    var vidSelect = inboxForm.querySelector('select[name="VID"]');
                    if (dest && vidSelect) vidSelect.value = dest.value;
                    var moveInput = inboxForm.querySelector('input[name="move"]');
                    if (moveInput) moveInput.click(); else HTMLFormElement.prototype.submit.call(inboxForm);
                });
            }
        } catch (err) {
            console.error('[MessengerModule] Error building messages section:', err);
            var cpEl = document.querySelector('.cp');
            if (cpEl) {
                var clone = cpEl.cloneNode(true);
                var tabs = clone.querySelector('.tabs');
                if (tabs) tabs.remove();
                container.appendChild(clone);
            } else {
                container.innerHTML = '<div class="modern-empty-state"><i class="fa-regular fa-inbox"></i><p>Unable to load messages</p></div>';
            }
        }
        return container;
    }

    // ========================================================================
    // CONTACTS SECTION
    // ========================================================================
    function buildModernContactsSection() {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'contacts-section';
        try {
            var friendsTextarea = document.querySelector('textarea[name="can_contact"]');
            var blockedTextarea = document.querySelector('textarea[name="cannot_contact"]');
            var privacySelect   = document.querySelector('select[name="nobody_can_contact"]');
            var updateButton    = document.querySelector('input[value="Update Contact list"]');
            var friendsCard = document.createElement('div');
            friendsCard.className = 'contacts-card';
            friendsCard.innerHTML = ''
                + '<h3 class="contacts-card-title"><i class="fa-regular fa-user-group"></i> Friends list</h3>'
                + '<textarea id="modern-friends-list" class="modern-textarea-contacts" rows="8" placeholder="One username per line" aria-label="Friends list">' + escapeHtml(friendsTextarea ? friendsTextarea.value : '') + '</textarea>'
                + '<p class="contacts-help">Users you allow to message you when privacy mode is on.</p>';
            container.appendChild(friendsCard);
            var blockedCard = document.createElement('div');
            blockedCard.className = 'contacts-card';
            blockedCard.innerHTML = ''
                + '<h3 class="contacts-card-title"><i class="fa-regular fa-ban"></i> Blocked users</h3>'
                + '<textarea id="modern-blocked-list" class="modern-textarea-contacts" rows="5" placeholder="One username per line" aria-label="Blocked users">' + escapeHtml(blockedTextarea ? blockedTextarea.value : '') + '</textarea>'
                + '<p class="contacts-help">These users cannot send you messages or mention you.</p>';
            container.appendChild(blockedCard);
            var privacyVal = privacySelect ? privacySelect.value : '0';
            var privacyCard = document.createElement('div');
            privacyCard.className = 'contacts-card';
            privacyCard.innerHTML = ''
                + '<h3 class="contacts-card-title"><i class="fa-regular fa-shield"></i> Privacy settings</h3>'
                + '<div class="privacy-option">'
                + '<label class="modern-radio"><input type="radio" name="privacy" value="1" ' + (privacyVal === '1' ? 'checked' : '') + '> <span>Yes — only friends can message me</span></label>'
                + '<label class="modern-radio"><input type="radio" name="privacy" value="0" ' + (privacyVal === '0' ? 'checked' : '') + '> <span>No — everyone can message me (except blocked users)</span></label>'
                + '</div>';
            container.appendChild(privacyCard);
            var actionsDiv = document.createElement('div');
            actionsDiv.className = 'contacts-actions';
            actionsDiv.innerHTML = '<button class="modern-btn modern-btn-primary" id="update-contacts"><i class="fa-regular fa-floppy-disk"></i> Update contact list</button>';
            container.appendChild(actionsDiv);
            var updateContactsBtn = container.querySelector('#update-contacts');
            if (updateContactsBtn && updateButton) {
                updateContactsBtn.addEventListener('click', function() {
                    if (friendsTextarea) friendsTextarea.value = container.querySelector('#modern-friends-list').value;
                    if (blockedTextarea) blockedTextarea.value = container.querySelector('#modern-blocked-list').value;
                    var checkedPrivacy = container.querySelector('input[name="privacy"]:checked');
                    if (privacySelect && checkedPrivacy) privacySelect.value = checkedPrivacy.value;
                    updateButton.click();
                });
            }
        } catch (err) {
            console.error('[MessengerModule] Error building contacts section:', err);
            var cpEl = document.querySelector('.cp');
            if (cpEl) {
                var clone = cpEl.cloneNode(true);
                var tabs = clone.querySelector('.tabs');
                if (tabs) tabs.remove();
                container.appendChild(clone);
            } else {
                container.innerHTML = '<div class="modern-empty-state"><i class="fa-regular fa-address-book"></i><p>Unable to load contacts</p></div>';
            }
        }
        return container;
    }

    // ========================================================================
    // CORE BUILDER
    // ========================================================================
    function buildModernMessenger() {
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (!wrapper) return;
        if (document.getElementById('modern-messenger')) return;

        if (document.querySelector('.post')) {
            console.warn('[MessengerModule] Legacy .post element found – skipping messenger');
            return;
        }

        var carousel = wrapper.querySelector('.carousel-wrapper');
        var breadcrumb = document.getElementById('modern-breadcrumbs');

        var messengerContainer = document.createElement('div');
        messengerContainer.id = 'modern-messenger';
        messengerContainer.className = 'modern-messenger';
        var navContainer = document.createElement('nav');
        navContainer.className = 'modern-messenger-nav';
        navContainer.setAttribute('aria-label', 'Messenger sections');
        var navItems = [
            { text: 'Compose',  icon: 'fa-regular fa-pen-to-square', url: '/?act=Msg&CODE=04&c=660892', section: 'compose' },
            { text: 'Messages', icon: 'fa-regular fa-envelope',       url: '/?act=Msg&CODE=01&c=660892', section: 'messages' },
            { text: 'Contacts', icon: 'fa-regular fa-address-book',   url: '/?act=Msg&CODE=02&c=660892', section: 'contacts' }
        ];
        for (var i = 0; i < navItems.length; i++) {
            var item = navItems[i];
            var link = document.createElement('a');
            link.href = item.url;
            link.className = 'modern-nav-link' + (item.section === currentSection ? ' current' : '');
            if (item.section === currentSection) link.setAttribute('aria-current', 'page');
            link.innerHTML = '<i class="' + item.icon + '" aria-hidden="true"></i><span class="modern-nav-text">' + item.text + '</span>';
            navContainer.appendChild(link);
        }
        var mainContent = document.createElement('div');
        mainContent.className = 'modern-messenger-main';
        if (currentSection === 'compose') {
            mainContent.appendChild(buildComposeSection());
        } else if (currentSection === 'messages') {
            mainContent.appendChild(buildModernMessagesSection());
        } else {
            mainContent.appendChild(buildModernContactsSection());
        }
        messengerContainer.appendChild(navContainer);
        messengerContainer.appendChild(mainContent);

        if (breadcrumb) {
            breadcrumb.insertAdjacentElement('afterend', messengerContainer);
        } else if (carousel) {
            carousel.insertAdjacentElement('afterend', messengerContainer);
        } else {
            wrapper.appendChild(messengerContainer);
        }

        console.log('[MessengerModule] Built for section: ' + currentSection);
    }

    return {
        initialize: initialize,
        reset: reset
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);
