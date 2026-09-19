// Messenger Module – TipTap based, modern preview, relies solely on forumObserver
// Includes custom emoji picker with Twemoji images, semantic color palette,
// mention autocomplete, recipient autocomplete, draft persistence, image paste,
// plain-text paste, toast notifications, and link preview skeleton.
var MessengerModule = (function(Utils, EventBus) {
    'use strict';

    var isInitialized = false;
    var observerCallbacks = [];
    var _originalEmoticon = null;

    // Configurable limits — set MAX_MESSAGE_LENGTH to 0 to disable the counter.
    var MAX_MESSAGE_LENGTH = 0;
    var DRAFT_KEY = 'messenger-draft-v1';
    var DRAFT_SAVE_DEBOUNCE = 500;
    var OG_FETCH_TIMEOUT = 8000;
    var UPLOAD_WORKER_URL = 'https://imgbb-upload-proxy.nhristakiev.workers.dev/';
    var OG_WORKER_URL = 'https://og-worker.nhristakiev.workers.dev/?url=';

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

    // ------------------------------------------------------------------------
    // HTML ENTITY DECODER
    // ------------------------------------------------------------------------
    function decodeHtmlEntities(str) {
        if (!str || typeof str !== 'string') return str;
        if (str.indexOf('&') === -1) return str;
        var txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
    }

    // ------------------------------------------------------------------------
    // HTML CONTENT EMPTINESS CHECK
    // ------------------------------------------------------------------------
    function editorContentIsEmpty(html) {
        if (!html || typeof html !== 'string') return true;
        var text = html
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&zeroWidthSpace;/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length > 0) return false;
        if (/<img[^>]+src\s*=/i.test(html)) return false;
        if (/<hr\b/i.test(html)) return false;
        if (/<(video|audio|iframe)\b/i.test(html)) return false;
        return true;
    }

    // ------------------------------------------------------------------------
    // CONTENT FINGERPRINT
    // ------------------------------------------------------------------------
    function contentFingerprint(html) {
        if (!html) return '';
        var d = document.createElement('div');
        d.innerHTML = html;
        var text = (d.textContent || '').replace(/\s+/g, ' ').trim();
        var imgCount = d.querySelectorAll('img').length;
        return text + '||imgs:' + imgCount;
    }

    // ------------------------------------------------------------------------
    // TRAILING PARAGRAPH GUARANTEE (initial content only)
    // ------------------------------------------------------------------------
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
                if (wrapperReady && targetReady && !isInitialized && !document.getElementById('modern-messenger')) {
                    waitForGlobalFunctions()
                        .then(function() {
                            try {
                                buildModernMessenger();
                                isInitialized = true;
                                if (EventBus) EventBus.trigger('messenger:ready');
                                resolve();
                            } catch (err) {
                                console.error('[MessengerModule] Build failed:', err);
                                reject(err);
                            }
                        })
                        .catch(reject);
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

            setTimeout(function() {
                if (!wrapperReady) wrapperReady = true;
                if (!targetReady) targetReady = true;
                tryBuild();
            }, 1000);
        });
    }

    function reset() {
        isInitialized = false;
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
    // HELPERS
    // ------------------------------------------------------------------------
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch(e) { return dateStr; }
    }

    function debounce(fn, delay) {
        var t = null;
        return function() {
            var args = arguments, ctx = this;
            if (t) clearTimeout(t);
            t = setTimeout(function() { t = null; fn.apply(ctx, args); }, delay);
        };
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
    // DRAFT PERSISTENCE
    // ------------------------------------------------------------------------
    function loadDraft() {
        try {
            var raw = localStorage.getItem(DRAFT_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) { return null; }
    }

    function saveDraft(data) {
        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
            return true;
        } catch (e) { return false; }
    }

    function clearDraft() {
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
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
            var initial = (username.charAt(0) || '?').toUpperCase();
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
    // MENTION SEARCH
    // ------------------------------------------------------------------------
    var _mentionSearchAbort = null;

    function searchMentions(query) {
        if (!query || query.length < 1) return Promise.resolve([]);

        if (_mentionSearchAbort) {
            try { _mentionSearchAbort.abort(); } catch (e) {}
        }
        _mentionSearchAbort = new AbortController();

        var url = '/api.php?search&name=' + encodeURIComponent(query) + '&n=10&cookie=1';

        return fetch(url, {
            credentials: 'include',
            signal: _mentionSearchAbort.signal
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
            if (err && err.name === 'AbortError') return [];
            console.warn('[MessengerModule] Mention search failed:', err);
            return [];
        });
    }

    // ------------------------------------------------------------------------
    // RECIPIENT AUTOCOMPLETE
    // ------------------------------------------------------------------------
    function attachRecipientAutocomplete(inputEl) {
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
            popup.style.minWidth = rect.width + 'px';
        }

        function closePopup() {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
            if (popup) { popup.remove(); popup = null; }
            items = []; itemEls = []; selectedIndex = 0;
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
            span.textContent = (name || '?').charAt(0).toUpperCase();
            return span;
        }

        function buildPopup(users) {
            if (!popup) return;
            popup.innerHTML = '';
            itemEls = [];
            items = users;

            if (users.length === 0) {
                var empty = document.createElement('div');
                empty.style.cssText = 'padding:var(--pad-2) var(--pad-3);color:var(--text-tertiary);font-size:var(--text-xs);font-style:italic;';
                empty.textContent = 'No users found';
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
                    inputEl.value = decodeHtmlEntities(user.name || '');
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    closePopup();
                });

                itemEls.push(el);
                popup.appendChild(el);
            });

            popup.style.display = 'block';
            updateSelected();
        }

        inputEl.addEventListener('input', function() {
            var query = inputEl.value.trim();
            if (debounceTimer) clearTimeout(debounceTimer);
            if (!query) { closePopup(); return; }
            if (query === lastQuery) return;
            lastQuery = query;
            debounceTimer = setTimeout(function() {
                searchMentions(query).then(function(users) {
                    if (inputEl.value.trim() !== query) return;
                    if (!popup) {
                        popup = document.createElement('div');
                        popup.className = 'mention-suggestions';
                        popup.setAttribute('role', 'listbox');
                        document.body.appendChild(popup);
                        window.addEventListener('scroll', reposition, true);
                        window.addEventListener('resize', reposition);
                    }
                    buildPopup(users);
                    reposition();
                });
            }, 180);
        });

        inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { closePopup(); return; }
            if (!popup || popup.style.display === 'none' || items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % items.length;
                updateSelected();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                updateSelected();
            } else if (e.key === 'Enter') {
                var user = items[selectedIndex];
                if (user) {
                    e.preventDefault();
                    inputEl.value = decodeHtmlEntities(user.name || '');
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    closePopup();
                }
            }
        });

        inputEl.addEventListener('focus', function() {
            if (blurCloseTimer) { clearTimeout(blurCloseTimer); blurCloseTimer = null; }
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
    // CONVERTERS (Legacy BBCode ↔ HTML)
    // ------------------------------------------------------------------------
    function legacyToHtml(legacy) {
        if (!legacy) return '';
        var html = legacy;
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

        html = html.replace(/\[EMAIL\](.*?)\[\/EMAIL\]/gi, '<a href="mailto:$1">$1</a>');
        return html;
    }

    function htmlToLegacy(html) {
        if (!html || typeof html !== 'string') return html;
        var result = html;
        var maxIterations = 10;
        for (var i = 0; i < maxIterations; i++) {
            var before = result;

            result = result.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function(match, inner) {
                var cleaned = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>\s*/gi, '\n');
                cleaned = cleaned.replace(/\n+$/, '');
                return '[QUOTE]' + cleaned + '[/QUOTE]';
            });

            result = result.replace(/<div class="spoiler"[^>]*>([\s\S]*?)<\/div>/gi, function(match, inner) {
                var cleaned = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>\s*/gi, '\n');
                cleaned = cleaned.replace(/\n+$/, '');
                return '[SPOILER]' + cleaned + '[/SPOILER]';
            });

            result = result.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, function(match, inner) {
                var decoded = inner
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
                return '[CODE]' + decoded + '[/CODE]';
            });

            if (result === before) break;
        }
        return result;
    }

    // ------------------------------------------------------------------------
    // EMOJI PICKER DATA
    // Curated set chosen with a second custom-emoji group in mind. Kept
    // deliberately compact so the native and custom rows sit side by side
    // without the picker feeling overloaded.
    // ------------------------------------------------------------------------
    var EMOJI_GROUPS = [
        { name: 'Emojis', emojis: [
            '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','🥲','😏','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','🤤','🥳','😎','🤓','🧐','🙃','🤐','🤨','😒','🙄','😬','😌','😔','😪','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','😕','😟','🙁','😮','😲','😳','🥺','😨','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👋','👌','👍','👎','✊','👏','🙏','💪','👀','🤦','🤷','🎉','❤️','💔','🔥','💯','💥'
        ] }
    ];

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
    // COMPOSE SECTION
    // ------------------------------------------------------------------------
    function buildComposeSection() {
        var recipientInput   = document.querySelector('input[name="entered_name"]');
        var contactSelect    = document.querySelector('select[name="from_contact"]');
        var titleInput       = document.querySelector('input[name="msg_title"]');
        var originalTextarea = document.getElementById('Post');

        if (!originalTextarea) {
            console.warn('[MessengerModule] Compose textarea (#Post) not found – skipping editor');
            return document.createElement('div');
        }

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

        // Recipient + Subject row
        var recipientRow = document.createElement('div');
        recipientRow.className = 'modern-recipient-row';
        recipientRow.innerHTML = ''
            + '<div class="modern-field">'
            + '<div class="modern-recipient-controls">'
            + '<input type="text" id="modern-recipient" class="modern-input" placeholder="Recipient" autocomplete="off" spellcheck="false" aria-label="Recipient" value="' + escapeHtml(recipientInput ? recipientInput.value : '') + '">'
            + '<select id="modern-contact" class="modern-select" aria-label="Pick from contacts">' + (contactSelect ? contactSelect.innerHTML : '') + '</select>'
            + '</div></div>'
            + '<div class="modern-field">'
            + '<input type="text" id="modern-title" class="modern-input" placeholder="Subject" aria-label="Subject" value="' + escapeHtml(titleInput ? titleInput.value : '') + '">'
            + '</div>';
        container.appendChild(recipientRow);

        // Toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Formatting');
        container.appendChild(toolbar);

        // Replying-as header — sync-render, refine async.
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

        // Draft status indicator (shown briefly after each save)
        var draftStatus = document.createElement('div');
        draftStatus.className = 'messenger-draft-status';
        draftStatus.setAttribute('aria-live', 'polite');
        draftStatus.style.cssText = 'padding:0 var(--pad-6) var(--pad-3);font-size:var(--text-xs);color:var(--text-tertiary);text-align:right;opacity:0;transition:opacity .3s ease;';
        container.appendChild(draftStatus);

        var draftStatusTimer = null;
        function flashDraftStatus(text) {
            draftStatus.innerHTML = '<i class="fa-regular fa-circle-check" aria-hidden="true" style="color:var(--primary-light);"></i> ' + escapeHtml(text);
            draftStatus.style.opacity = '1';
            if (draftStatusTimer) clearTimeout(draftStatusTimer);
            draftStatusTimer = setTimeout(function() { draftStatus.style.opacity = '0'; }, 1800);
        }

        var editor = null;

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
            editor.commands.focus();
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

        // ========== UNDO / REDO ==========
        var undoBtn = makeToolbarButton('fa-regular fa-undo', 'Undo', { shortcut: 'Control+Z' });
        undoBtn.disabled = true;
        var redoBtn = makeToolbarButton('fa-regular fa-redo', 'Redo', { shortcut: 'Control+Shift+Z' });
        redoBtn.disabled = true;
        addSeparator();

        // ----- Inline formatting -----
        var boldBtn      = makeToolbarButton('fa-regular fa-bold', 'Bold', { shortcut: 'Control+B' });
        var italicBtn    = makeToolbarButton('fa-regular fa-italic', 'Italic', { shortcut: 'Control+I' });
        var underlineBtn = makeToolbarButton('fa-regular fa-underline', 'Underline', { shortcut: 'Control+U' });
        var strikeBtn    = makeToolbarButton('fa-regular fa-strikethrough', 'Strikethrough');

        // ========== COLOR DROPDOWN ==========
        var colorDropdownContainer = document.createElement('div');
        colorDropdownContainer.className = 'modern-dropdown';
        colorDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var colorDropdownBtn = document.createElement('button');
        colorDropdownBtn.type = 'button';
        colorDropdownBtn.className = 'modern-editor-btn';
        colorDropdownBtn.innerHTML = '<i class="fa-regular fa-palette"></i>';
        colorDropdownBtn.title = 'Text color';
        colorDropdownBtn.setAttribute('aria-label', 'Text color');
        colorDropdownBtn.setAttribute('aria-haspopup', 'menu');
        colorDropdownBtn.setAttribute('aria-expanded', 'false');
        var colorDropdownMenu = document.createElement('div');
        colorDropdownMenu.className = 'modern-dropdown-menu';
        colorDropdownMenu.setAttribute('role', 'menu');
        colorDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:180px;display:none;';
        colorDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" role="menuitem" data-color="primary"><span class="color-swatch color-swatch--primary"></span> Primary</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="info"><span class="color-swatch color-swatch--info"></span> Info</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="accent"><span class="color-swatch color-swatch--accent"></span> Accent</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="warning"><span class="color-swatch color-swatch--warning"></span> Warning</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="danger"><span class="color-swatch color-swatch--danger"></span> Danger</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="muted"><span class="color-swatch color-swatch--muted"></span> Muted</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-color="remove"><i class="fa-regular fa-eraser" aria-hidden="true"></i> Remove color</button>';
        colorDropdownContainer.appendChild(colorDropdownBtn);
        colorDropdownContainer.appendChild(colorDropdownMenu);
        toolbar.appendChild(colorDropdownContainer);

        function openDropdown(btn, menu) {
            menu.style.display = 'block';
            btn.setAttribute('aria-expanded', 'true');
        }
        function closeDropdown(btn, menu) {
            menu.style.display = 'none';
            btn.setAttribute('aria-expanded', 'false');
        }

        colorDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            var isOpen = colorDropdownMenu.style.display === 'block';
            document.querySelectorAll('.modern-dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
            if (!isOpen) openDropdown(colorDropdownBtn, colorDropdownMenu);
        };
        colorDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

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

        // ----- Clear formatting -----
        var clearFormatBtn = makeToolbarButton('fa-regular fa-remove-format', 'Clear formatting');

        addSeparator();

        // ========== HEADING DROPDOWN ==========
        var headingDropdownContainer = document.createElement('div');
        headingDropdownContainer.className = 'modern-dropdown';
        headingDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var headingDropdownBtn = document.createElement('button');
        headingDropdownBtn.type = 'button';
        headingDropdownBtn.className = 'modern-editor-btn';
        headingDropdownBtn.innerHTML = '<i class="fa-regular fa-heading"></i>';
        headingDropdownBtn.title = 'Heading';
        headingDropdownBtn.setAttribute('aria-label', 'Heading');
        headingDropdownBtn.setAttribute('aria-haspopup', 'menu');
        headingDropdownBtn.setAttribute('aria-expanded', 'false');
        var headingDropdownMenu = document.createElement('div');
        headingDropdownMenu.className = 'modern-dropdown-menu';
        headingDropdownMenu.setAttribute('role', 'menu');
        headingDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        headingDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" role="menuitem" data-level="1">Heading 1</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-level="2">Heading 2</button>'
            + '<button class="modern-dropdown-item" role="menuitem" data-level="3">Heading 3</button>';
        headingDropdownContainer.appendChild(headingDropdownBtn);
        headingDropdownContainer.appendChild(headingDropdownMenu);
        toolbar.appendChild(headingDropdownContainer);
        headingDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            var isOpen = headingDropdownMenu.style.display === 'block';
            document.querySelectorAll('.modern-dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
            if (!isOpen) openDropdown(headingDropdownBtn, headingDropdownMenu);
        };
        headingDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

        var headingButtons = {
            h1: headingDropdownMenu.querySelector('[data-level="1"]'),
            h2: headingDropdownMenu.querySelector('[data-level="2"]'),
            h3: headingDropdownMenu.querySelector('[data-level="3"]')
        };

        // List dropdown
        var listDropdownContainer = document.createElement('div');
        listDropdownContainer.className = 'modern-dropdown';
        listDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var listDropdownBtn = document.createElement('button');
        listDropdownBtn.type = 'button';
        listDropdownBtn.className = 'modern-editor-btn';
        listDropdownBtn.innerHTML = '<i class="fa-regular fa-list"></i>';
        listDropdownBtn.title = 'Insert list';
        listDropdownBtn.setAttribute('aria-label', 'Insert list');
        listDropdownBtn.setAttribute('aria-haspopup', 'menu');
        listDropdownBtn.setAttribute('aria-expanded', 'false');
        var listDropdownMenu = document.createElement('div');
        listDropdownMenu.className = 'modern-dropdown-menu';
        listDropdownMenu.setAttribute('role', 'menu');
        listDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        listDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" role="menuitem" id="bullet-list-option"><i class="fa-regular fa-list"></i> Bullet list</button>'
            + '<button class="modern-dropdown-item" role="menuitem" id="ordered-list-option"><i class="fa-regular fa-list-ol"></i> Ordered list</button>';
        listDropdownContainer.appendChild(listDropdownBtn);
        listDropdownContainer.appendChild(listDropdownMenu);
        toolbar.appendChild(listDropdownContainer);
        listDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            var isOpen = listDropdownMenu.style.display === 'block';
            document.querySelectorAll('.modern-dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
            if (!isOpen) openDropdown(listDropdownBtn, listDropdownMenu);
        };
        listDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

        var blockquoteBtn = makeToolbarButton('fa-regular fa-quote-left', 'Blockquote');
        var codeBtn       = makeToolbarButton('fa-regular fa-code', 'Code block');

        addSeparator();

        var linkBtn = makeToolbarButton('fa-regular fa-link', 'Insert link', { shortcut: 'Control+K' });

        var imageDropdownContainer = document.createElement('div');
        imageDropdownContainer.className = 'modern-dropdown';
        imageDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var imageDropdownBtn = document.createElement('button');
        imageDropdownBtn.type = 'button';
        imageDropdownBtn.className = 'modern-editor-btn';
        imageDropdownBtn.innerHTML = '<i class="fa-regular fa-image"></i>';
        imageDropdownBtn.title = 'Insert image';
        imageDropdownBtn.setAttribute('aria-label', 'Insert image');
        imageDropdownBtn.setAttribute('aria-haspopup', 'menu');
        imageDropdownBtn.setAttribute('aria-expanded', 'false');
        var imageDropdownMenu = document.createElement('div');
        imageDropdownMenu.className = 'modern-dropdown-menu';
        imageDropdownMenu.setAttribute('role', 'menu');
        imageDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:200px;display:none;';
        imageDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" role="menuitem" id="image-url-option"><i class="fa-regular fa-link"></i> By URL</button>'
            + '<button class="modern-dropdown-item" role="menuitem" id="image-upload-option"><i class="fa-regular fa-cloud-arrow-up"></i> Upload from computer</button>';
        imageDropdownContainer.appendChild(imageDropdownBtn);
        imageDropdownContainer.appendChild(imageDropdownMenu);
        toolbar.appendChild(imageDropdownContainer);
        imageDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            var isOpen = imageDropdownMenu.style.display === 'block';
            document.querySelectorAll('.modern-dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
            if (!isOpen) openDropdown(imageDropdownBtn, imageDropdownMenu);
        };
        imageDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

        addSeparator();

        var spoilerBtn = makeToolbarButton('fa-regular fa-eye-slash', 'Spoiler', { shortcut: 'Control+Shift+S' });

        // Global click closes any open dropdown.
        document.addEventListener('click', function() {
            document.querySelectorAll('.modern-dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
        });

        // Global Escape closes any open dropdown.
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var openMenu = document.querySelector('.modern-dropdown-menu[style*="display: block"]');
                if (openMenu) {
                    document.querySelectorAll('.modern-dropdown-menu').forEach(function(m) { m.style.display = 'none'; });
                    document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function(b) { b.setAttribute('aria-expanded', 'false'); });
                }
            }
        });

        // ---- Emoji button & picker ----
        var emojiBtn = makeToolbarButton('fa-regular fa-face-smile', 'Insert emoji');

        var emojiPickerPanel = document.createElement('div');
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
            if (recents.length > 0) {
                allGroups.push({ name: 'Recently used', emojis: recents });
            }
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

                    var codePoint = emojiToCodePoint(emoji);
                    var imgUrl = 'https://twemoji.maxcdn.com/v/latest/svg/' + codePoint + '.svg';
                    var img = document.createElement('img');
                    img.src = imgUrl;
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
                            var emojiUrl = 'https://twemoji.maxcdn.com/v/latest/svg/' + emojiToCodePoint(emojiChar) + '.svg';
                            editor.chain().focus().insertContent({
                                type: 'image',
                                attrs: {
                                    src: emojiUrl,
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
            if (!isVisible) {
                renderEmojiPicker();
                emojiPickerPanel.style.display = 'grid';
            } else {
                emojiPickerPanel.style.display = 'none';
            }
        };

        document.addEventListener('click', function(e) {
            if (emojiPickerPanel && emojiPickerPanel.style.display === 'grid' && !emojiPickerPanel.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
                emojiPickerPanel.style.display = 'none';
            }
        });

        // -----------------------------------------------------------------
        // UPLOAD
        // -----------------------------------------------------------------
        function uploadImageToWorker(file, editorInstance) {
            var formData = new FormData();
            formData.append('image', file);
            var currentPos = editorInstance.state.selection.from;
            var placeholderText = '⬆️ Uploading…';
            editorInstance.chain().focus().insertContent(placeholderText).run();
            var placeholderStart = currentPos;
            var placeholderEnd = currentPos + placeholderText.length;

            fetch(UPLOAD_WORKER_URL, { method: 'POST', body: formData })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    editorInstance.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run();
                    if (data.url) {
                        editorInstance.chain().focus().insertContent({
                            type: 'image',
                            attrs: {
                                src: data.url,
                                alt: 'Uploaded image',
                                loading: 'lazy',
                                decoding: 'async',
                                width: data.width ? parseInt(data.width) : null,
                                height: data.height ? parseInt(data.height) : null
                            }
                        }).run();
                        showToast('Image uploaded', { type: 'success' });
                    } else {
                        editorInstance.chain().focus().insertContent('[Upload failed]').run();
                        showToast('Upload failed', { type: 'error' });
                    }
                })
                .catch(function(error) {
                    console.error('Upload error:', error);
                    editorInstance.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run();
                    editorInstance.chain().focus().insertContent('[Upload error]').run();
                    showToast('Upload error', { type: 'error' });
                });
        }

        // Modal helpers — both close on Escape and restore editor focus on exit.
        function showInputModal(title, placeholder, callback) {
            var modalOverlay = document.createElement('div');
            modalOverlay.className = 'modern-modal-overlay';
            modalOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
            var modalBox = document.createElement('div');
            modalBox.className = 'modern-modal-box';
            modalBox.style.cssText = 'background:var(--surface-color);border-radius:var(--radius-lg);padding:var(--space-lg);width:340px;max-width:90%;box-shadow:var(--shadow-lg);';
            modalBox.innerHTML = ''
                + '<h3 style="margin:0 0 var(--space-md) 0;">' + escapeHtml(title) + '</h3>'
                + '<input type="text" id="modal-input" class="modern-input" placeholder="' + escapeHtml(placeholder) + '" style="width:100%;">'
                + '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">'
                + '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>'
                + '<button id="modal-submit" class="modern-btn modern-btn-primary">Insert</button>'
                + '</div>';
            modalOverlay.appendChild(modalBox);
            document.body.appendChild(modalOverlay);
            var input = modalBox.querySelector('#modal-input');
            input.focus();

            function close() {
                modalOverlay.remove();
                document.removeEventListener('keydown', onEscape);
                if (editor) editor.commands.focus();
            }
            function onEscape(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

            document.addEventListener('keydown', onEscape);
            modalBox.querySelector('#modal-cancel').onclick = close;
            modalBox.querySelector('#modal-submit').onclick = function() {
                var val = input.value.trim();
                if (val) callback(val);
                close();
            };
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') modalBox.querySelector('#modal-submit').click();
            });
        }

        function showLinkModal(callback) {
            var modalOverlay = document.createElement('div');
            modalOverlay.className = 'modern-modal-overlay';
            modalOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
            var modalBox = document.createElement('div');
            modalBox.className = 'modern-modal-box';
            modalBox.style.cssText = 'background:var(--surface-color);border-radius:var(--radius-lg);padding:var(--space-lg);width:360px;max-width:90%;box-shadow:var(--shadow-lg);';
            modalBox.innerHTML = ''
                + '<h3 style="margin:0 0 var(--space-md) 0;"><i class="fa-regular fa-link"></i> Insert link</h3>'
                + '<div style="margin-bottom:var(--space-md);">'
                + '<label style="display:block;margin-bottom:var(--space-xs);color:var(--text-secondary);">Link text (optional)</label>'
                + '<input type="text" id="modal-link-text" class="modern-input" placeholder="Enter text to display" style="width:100%;">'
                + '</div>'
                + '<div style="margin-bottom:var(--space-md);">'
                + '<label style="display:block;margin-bottom:var(--space-xs);color:var(--text-secondary);">URL</label>'
                + '<input type="url" id="modal-link-url" class="modern-input" placeholder="https://example.com" style="width:100%;">'
                + '</div>'
                + '<div style="display:flex;gap:var(--space-sm);justify-content:flex-end;">'
                + '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>'
                + '<button id="modal-submit" class="modern-btn modern-btn-primary">Insert link</button>'
                + '</div>';
            modalOverlay.appendChild(modalBox);
            document.body.appendChild(modalOverlay);
            var textInput = modalBox.querySelector('#modal-link-text');
            var urlInput = modalBox.querySelector('#modal-link-url');
            urlInput.focus();

            function close() {
                modalOverlay.remove();
                document.removeEventListener('keydown', onEscape);
                if (editor) editor.commands.focus();
            }
            function onEscape(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }

            document.addEventListener('keydown', onEscape);
            modalBox.querySelector('#modal-cancel').onclick = close;
            modalBox.querySelector('#modal-submit').onclick = function() {
                var linkText = textInput.value.trim();
                var linkUrl = urlInput.value.trim();
                if (linkUrl) callback(linkUrl, linkText || null);
                close();
            };
            textInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') modalBox.querySelector('#modal-submit').click(); });
            urlInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') modalBox.querySelector('#modal-submit').click(); });
        }

        // -----------------------------------------------------------------
        // Load TipTap ES modules
        // -----------------------------------------------------------------
        (async function initTipTap() {
            try {
                const core = await import('https://esm.sh/@tiptap/core@2.5.2');
                const Editor = core.Editor || (core.default && core.default.Editor);
                const Node = core.Node || (core.default && core.default.Node);
                const Mark = core.Mark || (core.default && core.default.Mark);

                if (!Editor || !Node || !Mark) {
                    throw new Error('Editor, Node, or Mark not found in @tiptap/core');
                }

                const { Plugin, PluginKey } = await import('https://esm.sh/prosemirror-state@1.4.3');

                const starterKitModule = await import('https://esm.sh/@tiptap/starter-kit@2.5.2');
                const placeholderModule = await import('https://esm.sh/@tiptap/extension-placeholder@2.5.2');
                const underlineModule = await import('https://esm.sh/@tiptap/extension-underline@2.5.2');
                const imageModule = await import('https://esm.sh/@tiptap/extension-image@2.5.2');
                const linkModule = await import('https://esm.sh/@tiptap/extension-link@2.5.2');
                const mentionModule = await import('https://esm.sh/@tiptap/extension-mention@2.5.2');

                const StarterKit = starterKitModule.StarterKit || (starterKitModule.default && starterKitModule.default.StarterKit);
                const Placeholder = placeholderModule.Placeholder || (placeholderModule.default && placeholderModule.default.Placeholder);
                const Underline = underlineModule.Underline || (underlineModule.default && underlineModule.default.Underline);
                const BaseImage = imageModule.Image || (imageModule.default && imageModule.default.Image);
                const Link = linkModule.Link || (linkModule.default && linkModule.default.Link);
                const Mention = mentionModule.Mention || (mentionModule.default && mentionModule.default.Mention);

                if (!Mention) throw new Error('Mention extension not found');

                const CustomLink = Link.configure({
                    openOnClick: true,
                    autolink: true,
                    linkOnPaste: true,
                    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
                });

                const CustomImage = BaseImage.extend({
                    inline: true,
                    group: 'inline',
                    addAttributes() {
                        return {
                            ...this.parent?.(),
                            src: { default: null },
                            alt: { default: 'image' },
                            width: { default: null },
                            height: { default: null },
                            loading: { default: 'lazy' },
                            decoding: { default: 'async' },
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

                const Spoiler = Node.create({
                    name: 'spoiler',
                    group: 'block',
                    content: 'block+',
                    defining: true,
                    parseHTML: () => [{ tag: 'div.spoiler' }],
                    renderHTML: () => ['div', { class: 'spoiler' }, 0],
                    addCommands() {
                        return {
                            setSpoiler: () => ({ commands }) => commands.wrapIn(this.name),
                            toggleSpoiler: () => ({ commands }) => commands.toggleWrap(this.name),
                            unsetSpoiler: () => ({ commands }) => commands.lift(this.name),
                        };
                    },
                });

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
                        items: function({ query }) { return searchMentions(query); },
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
                                var initial = (name || '?').charAt(0).toUpperCase();
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
                                    if (props.event.key === 'Enter') {
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

                // -------------------------------------------------------------
                // LINK PREVIEW PASTE PLUGIN (skeleton + 8s timeout)
                // -------------------------------------------------------------
                const linkPreviewPlugin = new Plugin({
                    key: new PluginKey('linkPreview'),
                    props: {
                        handlePaste: (view, event) => {
                            var text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                            if (!text) return false;
                            var trimmed = text.trim();
                            var urlRegex = /^(https?:\/\/[^\s]+)$/;
                            if (!urlRegex.test(trimmed)) return false;
                            event.preventDefault();

                            var url = trimmed;
                            var state = view.state;
                            var tr = state.tr.replaceWith(
                                state.selection.from, state.selection.to,
                                state.schema.nodes.linkPreview.create({
                                    href: url, title: '', description: '', imageSrc: '', loading: true
                                })
                            );
                            view.dispatch(tr);

                            function replaceSkeletonWithText() {
                                var foundPos = -1;
                                view.state.doc.descendants(function(node, pos) {
                                    if (node.type.name === 'linkPreview' && node.attrs.href === url && node.attrs.loading) {
                                        foundPos = pos;
                                        return false;
                                    }
                                    return true;
                                });
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
                                    var foundPos = -1;
                                    view.state.doc.descendants(function(node, pos) {
                                        if (node.type.name === 'linkPreview' && node.attrs.href === url && node.attrs.loading) {
                                            foundPos = pos;
                                            return false;
                                        }
                                        return true;
                                    });
                                    if (foundPos === -1) return;

                                    if (data.error || (!data.imageSrc && (!data.title || data.title === url))) {
                                        var trPlain = view.state.tr.replaceWith(
                                            foundPos, foundPos + 1, view.state.schema.text(url)
                                        );
                                        view.dispatch(trPlain);
                                        return;
                                    }

                                    var newNode = view.state.schema.nodes.linkPreview.create({
                                        href: data.href || url,
                                        title: data.title || url,
                                        description: data.description || '',
                                        imageSrc: data.imageSrc || '',
                                        loading: false,
                                    });
                                    var tr2 = view.state.tr.replaceWith(foundPos, foundPos + 1, newNode);
                                    view.dispatch(tr2);
                                })
                                .catch(function(err) {
                                    clearTimeout(timeoutId);
                                    if (err && err.name === 'AbortError') {
                                        replaceSkeletonWithText();
                                        return;
                                    }
                                    console.error('Link preview error:', err);
                                    replaceSkeletonWithText();
                                });
                            return true;
                        },
                    },
                });

                // -----------------------------------------------------------------
                // INITIAL CONTENT
                // -----------------------------------------------------------------
                var draft = loadDraft();
                var modernRecipientEl = container.querySelector('#modern-recipient');
                var modernTitleEl = container.querySelector('#modern-title');

                var textareaRaw = originalTextarea ? (originalTextarea.value || '') : '';
                var textareaHtmlConverted = textareaRaw ? legacyToHtml(textareaRaw) : '';
                var textareaHasContent = textareaRaw.trim().length > 0 &&
                                         !editorContentIsEmpty(textareaHtmlConverted);
                var textareaHtml = textareaHasContent ? textareaHtmlConverted : '';

                var draftHasContent = !!(draft &&
                                         typeof draft.body === 'string' &&
                                         !editorContentIsEmpty(draft.body));

                if (draftHasContent && textareaHasContent &&
                    contentFingerprint(draft.body) === contentFingerprint(textareaHtml)) {
                    clearDraft();
                    draft = null;
                    draftHasContent = false;
                }

                var initialHtml = '';
                var draftWasUsed = false;

                if (textareaHasContent && draftHasContent) {
                    initialHtml = textareaHtml + '<p></p>' + draft.body;
                    draftWasUsed = true;
                } else if (textareaHasContent) {
                    initialHtml = textareaHtml;
                } else if (draftHasContent) {
                    initialHtml = draft.body;
                    draftWasUsed = true;
                }

                if (draft) {
                    if (draft.recipient && modernRecipientEl && !modernRecipientEl.value.trim()) {
                        modernRecipientEl.value = draft.recipient;
                    }
                    if (draft.subject && modernTitleEl && !modernTitleEl.value.trim()) {
                        modernTitleEl.value = draft.subject;
                    }
                }

                // Only apply the trailing-paragraph guarantee when the initial
                // content came from the server (existing quote) or from a
                // restored draft. Toolbar-inserted blocks are handled directly
                // by their handlers and deliberately leave the caret inside.
                initialHtml = ensureTrailingParagraphInHtml(initialHtml);

                editor = new Editor({
                    element: editorElement,
                    extensions: [
                        StarterKit,
                        Placeholder.configure({ placeholder: 'Write your message…' }),
                        Underline,
                        CustomImage,
                        CustomLink,
                        Spoiler,
                        LinkPreview,
                        SemanticColor,
                        CustomMention,
                    ],
                    content: initialHtml,
                    editorProps: {
                        attributes: {
                            class: 'modern-wysiwyg-content',
                            'aria-label': 'Message body',
                        },
                        plugins: [linkPreviewPlugin],
                        handlePaste: function(view, event) {
                            var files = event.clipboardData ? event.clipboardData.files : null;
                            if (files && files.length) {
                                var imgs = Array.prototype.slice.call(files).filter(function(f) {
                                    return f.type && f.type.indexOf('image/') === 0;
                                });
                                if (imgs.length) {
                                    event.preventDefault();
                                    imgs.forEach(function(f) { uploadImageToWorker(f, editor); });
                                    return true;
                                }
                            }
                            if (event.shiftKey) {
                                var text = event.clipboardData.getData('text/plain');
                                if (text) {
                                    event.preventDefault();
                                    view.dispatch(view.state.tr.insertText(text));
                                    return true;
                                }
                            }
                            return false;
                        },
                    },
                    onCreate: function({ editor }) {
                        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
                        var active = document.activeElement;
                        if (active && active !== document.body && active !== document.documentElement) return;
                        editor.commands.focus('end');
                    },
                    onUpdate: function({ editor }) {
                        if (originalTextarea) {
                            originalTextarea.value = htmlToLegacy(editor.getHTML());
                        }
                        var previewContent = document.querySelector('#modern-preview-area .preview-content');
                        if (previewContent && window.twemoji) {
                            window.twemoji.parse(previewContent, { base: 'https://twemoji.maxcdn.com/v/latest/svg/', ext: '.svg' });
                        }
                        scheduleDraftSave();
                        updateSendState();
                        updateCharCounter();
                    }
                });

                // -----------------------------------------------------------------
                // TOOLBAR ACTIONS
                // -----------------------------------------------------------------
                undoBtn.onclick = function() { exec(function() { editor.chain().focus().undo().run(); }); };
                redoBtn.onclick = function() { exec(function() { editor.chain().focus().redo().run(); }); };
                clearFormatBtn.onclick = function() {
                    exec(function() { editor.chain().focus().unsetAllMarks().clearNodes().run(); });
                };

                boldBtn.onclick      = function() { exec(function() { editor.chain().focus().toggleBold().run(); }); };
                italicBtn.onclick    = function() { exec(function() { editor.chain().focus().toggleItalic().run(); }); };
                underlineBtn.onclick = function() { exec(function() { editor.chain().focus().toggleUnderline().run(); }); };
                strikeBtn.onclick    = function() { exec(function() { editor.chain().focus().toggleStrike().run(); }); };

                headingButtons.h1.onclick = function() {
                    exec(function() { editor.chain().focus().toggleHeading({ level: 1 }).run(); });
                    closeDropdown(headingDropdownBtn, headingDropdownMenu);
                };
                headingButtons.h2.onclick = function() {
                    exec(function() { editor.chain().focus().toggleHeading({ level: 2 }).run(); });
                    closeDropdown(headingDropdownBtn, headingDropdownMenu);
                };
                headingButtons.h3.onclick = function() {
                    exec(function() { editor.chain().focus().toggleHeading({ level: 3 }).run(); });
                    closeDropdown(headingDropdownBtn, headingDropdownMenu);
                };

                listDropdownMenu.querySelector('#bullet-list-option').onclick = function() {
                    exec(function() { editor.chain().focus().toggleBulletList().run(); });
                    closeDropdown(listDropdownBtn, listDropdownMenu);
                };
                listDropdownMenu.querySelector('#ordered-list-option').onclick = function() {
                    exec(function() { editor.chain().focus().toggleOrderedList().run(); });
                    closeDropdown(listDropdownBtn, listDropdownMenu);
                };

                blockquoteBtn.onclick = function() { exec(function() { editor.chain().focus().toggleBlockquote().run(); }); };
                codeBtn.onclick       = function() { exec(function() { editor.chain().focus().toggleCodeBlock().run(); }); };
                spoilerBtn.onclick    = function() { exec(function() { editor.chain().focus().toggleSpoiler().run(); }); };

                linkBtn.onclick = function() {
                    if (!editor) return;
                    var from = editor.state.selection.from;
                    var to = editor.state.selection.to;
                    var selectedText = editor.state.doc.textBetween(from, to, '');
                    showLinkModal(function(url, customText) {
                        if (selectedText) {
                            editor.chain().focus().setLink({ href: url }).run();
                        } else {
                            var displayText = customText || url;
                            editor.chain().focus().insertContent(displayText).run();
                            var newPos = editor.state.selection.from;
                            var textLength = displayText.length;
                            editor.chain().focus()
                                .setTextSelection({ from: newPos - textLength, to: newPos })
                                .setLink({ href: url })
                                .setTextSelection(newPos)
                                .run();
                        }
                    });
                };

                imageDropdownMenu.querySelector('#image-url-option').onclick = function() {
                    closeDropdown(imageDropdownBtn, imageDropdownMenu);
                    showInputModal('Insert image URL', 'https://example.com/image.jpg', function(url) {
                        var img = new Image();
                        img.onload = function() {
                            editor.chain().focus().insertContent({
                                type: 'image',
                                attrs: {
                                    src: url, alt: 'image', loading: 'lazy', decoding: 'async',
                                    width: this.width, height: this.height
                                }
                            }).run();
                        };
                        img.onerror = function() {
                            editor.chain().focus().insertContent({
                                type: 'image', attrs: { src: url, alt: 'image', loading: 'lazy', decoding: 'async' }
                            }).run();
                        };
                        img.src = url;
                    });
                };

                imageDropdownMenu.querySelector('#image-upload-option').onclick = function() {
                    closeDropdown(imageDropdownBtn, imageDropdownMenu);
                    var input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = function() {
                        if (input.files && input.files[0]) uploadImageToWorker(input.files[0], editor);
                    };
                    input.click();
                };

                // -----------------------------------------------------------------
                // ACTIVE STATES
                // -----------------------------------------------------------------
                function updateActiveStates() {
                    undoBtn.disabled = !editor.can().undo();
                    redoBtn.disabled = !editor.can().redo();

                    var isActive = {
                        bold: editor.isActive('bold'),
                        italic: editor.isActive('italic'),
                        underline: editor.isActive('underline'),
                        strike: editor.isActive('strike'),
                        bulletList: editor.isActive('bulletList'),
                        orderedList: editor.isActive('orderedList'),
                        blockquote: editor.isActive('blockquote'),
                        codeBlock: editor.isActive('codeBlock'),
                        spoiler: editor.isActive('spoiler'),
                        heading1: editor.isActive('heading', { level: 1 }),
                        heading2: editor.isActive('heading', { level: 2 }),
                        heading3: editor.isActive('heading', { level: 3 })
                    };
                    boldBtn.classList.toggle('active', isActive.bold);
                    italicBtn.classList.toggle('active', isActive.italic);
                    underlineBtn.classList.toggle('active', isActive.underline);
                    strikeBtn.classList.toggle('active', isActive.strike);
                    blockquoteBtn.classList.toggle('active', isActive.blockquote);
                    codeBtn.classList.toggle('active', isActive.codeBlock);
                    spoilerBtn.classList.toggle('active', isActive.spoiler);
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

                // -----------------------------------------------------------------
                // DRAG-DROP IMAGES
                // -----------------------------------------------------------------
                var editorRoot = editorElement.querySelector('.ProseMirror');
                if (editorRoot) {
                    editorRoot.setAttribute('dropzone', 'copy');
                    editorRoot.addEventListener('dragover', function(e) { e.preventDefault(); });
                    editorRoot.addEventListener('drop', function(e) {
                        e.preventDefault();
                        var file = e.dataTransfer.files[0];
                        if (file && file.type.startsWith('image/')) uploadImageToWorker(file, editor);
                    });
                }

                // -----------------------------------------------------------------
                // KEYBOARD SHORTCUTS
                // -----------------------------------------------------------------
                editor.setOptions({
                    editorProps: {
                        handleDOMEvents: {
                            keydown: function(view, event) {
                                var mod = event.ctrlKey || event.metaKey;

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
                                if (event.ctrlKey && event.shiftKey && (event.key === 's' || event.key === 'S')) {
                                    event.preventDefault();
                                    editor.chain().focus().toggleSpoiler().run();
                                    return true;
                                }
                                return false;
                            }
                        }
                    }
                });

                // -----------------------------------------------------------------
                // LEGACY EMOTICON BRIDGE
                // -----------------------------------------------------------------
                _originalEmoticon = window.emoticon;
                window.emoticon = function(x) {
                    if (editor) {
                        editor.chain().focus().insertContent(' ' + x + ' ').run();
                    } else if (_originalEmoticon) {
                        _originalEmoticon(x);
                    }
                };

                // -----------------------------------------------------------------
                // DRAFT AUTOSAVE + SEND STATE + CHAR COUNTER
                // -----------------------------------------------------------------
                var _saveTimer = null;
                function scheduleDraftSave() {
                    if (_saveTimer) clearTimeout(_saveTimer);
                    _saveTimer = setTimeout(function() {
                        _saveTimer = null;
                        var currentBody = editor ? editor.getHTML() : '';
                        var pristine = textareaHasContent &&
                                       !editorContentIsEmpty(currentBody) &&
                                       contentFingerprint(currentBody) === contentFingerprint(textareaHtml);
                        if (pristine) return;
                        var modernRecipient = container.querySelector('#modern-recipient');
                        var modernTitle = container.querySelector('#modern-title');
                        var ok = saveDraft({
                            recipient: modernRecipient ? modernRecipient.value : '',
                            subject: modernTitle ? modernTitle.value : '',
                            body: currentBody,
                            savedAt: Date.now()
                        });
                        if (ok) flashDraftStatus('Draft saved');
                    }, DRAFT_SAVE_DEBOUNCE);
                }

                var modernSubmitBtnRef = container.querySelector('#modern-submit');
                function updateSendState() {
                    if (!modernSubmitBtnRef) return;
                    var r = container.querySelector('#modern-recipient');
                    var t = container.querySelector('#modern-title');
                    var hasRecipient = r && r.value.trim().length > 0;
                    var hasSubject = t && t.value.trim().length > 0;
                    var hasBody = editor && !editor.isEmpty;
                    var ready = hasRecipient && hasSubject && hasBody;
                    modernSubmitBtnRef.disabled = !ready;
                    modernSubmitBtnRef.setAttribute('aria-disabled', String(!ready));
                }

                var charCounter = null;
                function updateCharCounter() {
                    if (!MAX_MESSAGE_LENGTH) return;
                    var len = editor ? editor.getText().length : 0;
                    if (!charCounter) {
                        charCounter = document.createElement('span');
                        charCounter.className = 'messenger-char-counter';
                        charCounter.style.cssText = 'margin-left:auto;font-size:var(--text-xs);color:var(--text-tertiary);';
                        toolbar.appendChild(charCounter);
                    }
                    charCounter.textContent = len + ' / ' + MAX_MESSAGE_LENGTH;
                    if (len > MAX_MESSAGE_LENGTH) charCounter.style.color = 'var(--danger-color)';
                    else if (len > MAX_MESSAGE_LENGTH * 0.9) charCounter.style.color = 'var(--warning-color)';
                    else charCounter.style.color = 'var(--text-tertiary)';
                    if (modernSubmitBtnRef) {
                        modernSubmitBtnRef.disabled = modernSubmitBtnRef.disabled || len > MAX_MESSAGE_LENGTH;
                    }
                }

                var modernRecipientInput = container.querySelector('#modern-recipient');
                var modernTitleInput = container.querySelector('#modern-title');
                if (modernRecipientInput) modernRecipientInput.addEventListener('input', updateSendState);
                if (modernTitleInput) modernTitleInput.addEventListener('input', updateSendState);

                [modernRecipientInput, modernTitleInput].forEach(function(el) {
                    if (!el) return;
                    el.addEventListener('keydown', function(e) {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault();
                            if (modernSubmitBtnRef && !modernSubmitBtnRef.disabled) modernSubmitBtnRef.click();
                        }
                    });
                });

                container._updateSendState = updateSendState;
                container._scheduleDraftSave = scheduleDraftSave;
                container._flashDraftStatus = flashDraftStatus;

                updateSendState();
                updateCharCounter();
                if (draftWasUsed) flashDraftStatus('Draft restored');

            } catch (err) {
                console.error('[MessengerModule] TipTap failed to load:', err);
                editorElement.innerHTML = '<div style="color:red;padding:1rem;">Editor failed to load. Please refresh the page.<br>' + escapeHtml(err.message) + '</div>';
            }
        })();

        // ----- Modern preview area -----
        var previewArea = document.createElement('div');
        previewArea.id = 'modern-preview-area';
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<h3 class="modern-preview-title"><i class="fa-regular fa-eye"></i> Preview</h3><div class="preview-content"></div>';
        container.appendChild(previewArea);

        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        actions.innerHTML = ''
            + '<button type="button" id="modern-preview" class="modern-btn modern-btn-secondary"><i class="fa-regular fa-eye"></i> Preview</button>'
            + '<button type="button" id="modern-submit" class="modern-btn modern-btn-primary" aria-keyshortcuts="Control+Enter"><i class="fa-regular fa-paper-plane"></i> Send message</button>';
        container.appendChild(actions);

        var modernRecipient   = container.querySelector('#modern-recipient');
        var modernContact     = container.querySelector('#modern-contact');
        var modernTitle       = container.querySelector('#modern-title');

        attachRecipientAutocomplete(modernRecipient);

        // INLINE VALIDATION — Subject field
        var titleField = modernTitle ? modernTitle.closest('.modern-field') : null;
        var titleError = null;

        if (titleField && modernTitle) {
            titleError = document.createElement('span');
            titleError.className = 'modern-field-error';
            titleError.id = 'modern-title-error';
            titleError.setAttribute('role', 'alert');
            titleError.textContent = 'Please enter a subject before sending';
            titleField.appendChild(titleError);

            modernTitle.addEventListener('input', function() {
                if (this.value.trim()) clearTitleError();
            });
        }

        function showTitleError() {
            if (!modernTitle || !titleError) return;
            modernTitle.classList.add('has-error');
            modernTitle.setAttribute('aria-invalid', 'true');
            modernTitle.setAttribute('aria-describedby', 'modern-title-error');
            titleError.classList.add('visible');
            modernTitle.classList.remove('shake');
            void modernTitle.offsetWidth;
            modernTitle.classList.add('shake');
            modernTitle.focus();
            setTimeout(function() {
                if (modernTitle) modernTitle.classList.remove('shake');
            }, 400);
        }

        function clearTitleError() {
            if (!modernTitle || !titleError) return;
            modernTitle.classList.remove('has-error', 'shake');
            modernTitle.removeAttribute('aria-invalid');
            modernTitle.removeAttribute('aria-describedby');
            titleError.classList.remove('visible');
        }

        function syncToOriginal() {
            if (recipientInput && modernRecipient) recipientInput.value = modernRecipient.value;
            if (contactSelect && modernContact) contactSelect.value = modernContact.value;
            if (titleInput && modernTitle) titleInput.value = modernTitle.value;
        }
        function syncFromOriginal() {
            if (recipientInput && modernRecipient) modernRecipient.value = recipientInput.value;
            if (contactSelect && modernContact) modernContact.value = contactSelect.value;
            if (titleInput && modernTitle) modernTitle.value = titleInput.value;
        }

        if (modernRecipient)   modernRecipient.addEventListener('input', syncToOriginal);
        if (modernContact)     modernContact.addEventListener('change', syncToOriginal);
        if (modernTitle)       modernTitle.addEventListener('input', syncToOriginal);
        syncFromOriginal();

        // PREVIEW
        var modernPreviewBtn = container.querySelector('#modern-preview');
        if (modernPreviewBtn) {
            modernPreviewBtn.onclick = function() {
                syncToOriginal();
                if (!editor) return;
                var previewHtml = editor.getHTML();
                var previewContent = previewArea.querySelector('.preview-content');
                if (previewContent) {
                    previewContent.innerHTML = previewHtml;
                    if (window.twemoji) {
                        window.twemoji.parse(previewContent, { base: 'https://twemoji.maxcdn.com/v/latest/svg/', ext: '.svg' });
                    }
                }
                previewArea.style.display = 'block';
                previewArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            };
        }

        // SUBMIT
        var modernSubmitBtn = container.querySelector('#modern-submit');
        if (modernSubmitBtn) {
            modernSubmitBtn.onclick = function(e) {
                e.preventDefault();
                syncToOriginal();

                var recipientValue = modernRecipient ? modernRecipient.value.trim() : '';
                if (!recipientValue) {
                    showToast('Please enter a recipient', { type: 'warning' });
                    if (modernRecipient) modernRecipient.focus();
                    return;
                }

                var subjectValue = modernTitle ? modernTitle.value.trim() : '';
                if (!subjectValue) {
                    showTitleError();
                    showToast('Please enter a subject', { type: 'warning' });
                    return;
                }
                clearTitleError();

                if (!editor || editor.isEmpty) {
                    showToast('Message body is empty', { type: 'warning' });
                    return;
                }

                if (MAX_MESSAGE_LENGTH && editor.getText().length > MAX_MESSAGE_LENGTH) {
                    showToast('Message exceeds the maximum length', { type: 'error' });
                    return;
                }

                if (addSentCheckbox) addSentCheckbox.checked = true;
                if (addTrackingCheckbox) addTrackingCheckbox.checked = true;
                if (originalTextarea && editor) originalTextarea.value = htmlToLegacy(editor.getHTML());

                var originalLabel = modernSubmitBtn.innerHTML;
                modernSubmitBtn.disabled = true;
                modernSubmitBtn.innerHTML = '<i class="fa-regular fa-spinner fa-spin"></i> Sending…';

                clearDraft();

                try {
                    if (typeof ValidateForm === 'function' && !ValidateForm(1)) {
                        modernSubmitBtn.disabled = false;
                        modernSubmitBtn.innerHTML = originalLabel;
                        return;
                    }

                    if (submitButton) submitButton.disabled = false;

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
                    modernSubmitBtn.disabled = false;
                    modernSubmitBtn.innerHTML = originalLabel;
                    showToast('Could not send message', { type: 'error' });
                }
            };
        }

        return container;
    }

    // ------------------------------------------------------------------------
    // MESSAGES SECTION
    // ------------------------------------------------------------------------
    function buildModernMessagesSection() {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'messages-section';
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
                    folderForm.submit();
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
                    if (delBtn) delBtn.click(); else inboxForm.submit();
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
                    if (moveInput) moveInput.click(); else inboxForm.submit();
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

    // ------------------------------------------------------------------------
    // CONTACTS SECTION
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // CORE BUILDER
    // ------------------------------------------------------------------------
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
