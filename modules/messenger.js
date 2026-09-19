// Messenger Module – TipTap based, modern preview, relies solely on forumObserver
// Includes custom emoji picker with Twemoji images (grouped), semantic color
// palette, and mention autocomplete.
var MessengerModule = (function(Utils, EventBus) {
    'use strict';

    var isInitialized = false;
    var observerCallbacks = [];
    var _originalEmoticon = null;

    var currentUrl = window.location.href;
    var currentSection = 'compose';
    if (currentUrl.indexOf('CODE=01') !== -1) {
        currentSection = 'messages';
    } else if (currentUrl.indexOf('CODE=02') !== -1) {
        currentSection = 'contacts';
    }

    // ------------------------------------------------------------------------
    // SHARED AVATAR COLOR PALETTE
    // Mirrors ForumPostsModule so the same user gets the same initial-avatar
    // colour across posts, the messenger header, and the mention dropdown.
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

    // ------------------------------------------------------------------------
    // CURRENT USER RESOLUTION (module-level, reusable by posts editor later)
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
            if (nick) username = nick.textContent.trim();

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

        var username = user.nickname || 'You';
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
            // Consistent colour, same palette + hash as the Posts module.
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
    // MENTION SEARCH (module-level, so it can be reused by the posts editor)
    // Calls the same endpoint the legacy mention picker uses.
    // Response shape: { users: [{ name, id, avatar }, ...] }
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
            return users.slice(0, 8);
        })
        .catch(function (err) {
            if (err && err.name === 'AbortError') return [];
            console.warn('[MessengerModule] Mention search failed:', err);
            return [];
        });
    }

    // ------------------------------------------------------------------------
    // SEMANTIC COLOR PALETTE
    // Maps legacy [color=X] values to semantic classes. Unknown colors are
    // stripped (safer than carrying an unreadable inline style forward).
    // ------------------------------------------------------------------------
    var LEGACY_COLOR_MAP = {
        // Named colors
        green: 'primary', darkgreen: 'primary', limegreen: 'primary',
        blue: 'info', darkblue: 'info', navy: 'info', dodgerblue: 'info', cyan: 'info', teal: 'info',
        purple: 'accent', violet: 'accent', magenta: 'accent', fuchsia: 'accent',
        orange: 'warning', gold: 'warning', yellow: 'warning', darkorange: 'warning',
        red: 'danger', darkred: 'danger', crimson: 'danger',
        gray: 'muted', grey: 'muted', silver: 'muted',
        // Hex (lowercased)
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

        // Expand #abc → #aabbcc shorthand
        if (/^#[0-9a-f]{3}$/i.test(key)) {
            key = '#' + key[1] + key[1] + key[2] + key[2] + key[3] + key[3];
        }

        return LEGACY_COLOR_MAP[key] || null;
    }

    // ------------------------------------------------------------------------
    // CONVERTERS (Legacy BBCode ↔ HTML) – keep for loading existing messages
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

        // Font: strip entirely (legacy font families are inconsistent and don't theme well)
        html = html.replace(/\[font=([^\]]+)\](.*?)\[\/font\]/gis, '$2');

        // Size: clamp to a safe range (10–30px)
        html = html.replace(/\[size=([^\]]+)\](.*?)\[\/size\]/gis, function(_, sz, content) {
            var n = parseInt(sz, 10);
            if (isNaN(n)) n = 14;
            n = Math.max(10, Math.min(30, n));
            return '<span style="font-size:' + n + 'px">' + content + '</span>';
        });

        // Color: map to semantic classes, strip unknowns
        html = html.replace(/\[color=([^\]]+)\](.*?)\[\/color\]/gis, function(_, color, content) {
            var variant = normalizeLegacyColor(color);
            return variant
                ? '<span data-color="' + variant + '" class="text-' + variant + '">' + content + '</span>'
                : content;
        });

        html = html.replace(/\[EMAIL\](.*?)\[\/EMAIL\]/gi, '<a href="mailto:$1">$1</a>');
        return html;
    }

    // ------------------------------------------------------------------------
    // HTML → legacy BBCode (outbound only)
    // Converts <blockquote>, <div class="spoiler">, and <pre><code> to their
    // BBCode equivalents. Mentions (<mark data-uid>) are passed through
    // unchanged — ForumFree stores them verbatim.
    // ------------------------------------------------------------------------
    function htmlToLegacy(html) {
        if (!html || typeof html !== 'string') return html;

        var result = html;

        var maxIterations = 10;
        for (var i = 0; i < maxIterations; i++) {
            var before = result;

            result = result.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function(match, inner) {
                var cleaned = inner
                    .replace(/<p[^>]*>/gi, '')
                    .replace(/<\/p>\s*/gi, '\n');
                cleaned = cleaned.replace(/\n+$/, '');
                return '[QUOTE]' + cleaned + '[/QUOTE]';
            });

            result = result.replace(/<div class="spoiler"[^>]*>([\s\S]*?)<\/div>/gi, function(match, inner) {
                var cleaned = inner
                    .replace(/<p[^>]*>/gi, '')
                    .replace(/<\/p>\s*/gi, '\n');
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
        var previewButton = document.querySelector('button[name="preview"]');
        var originalForm  = window.REPLIER;

        // Force both legacy options on.
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
            + '<input type="text" id="modern-recipient" class="modern-input" placeholder="Recipient" value="' + escapeHtml(recipientInput ? recipientInput.value : '') + '">'
            + '<select id="modern-contact" class="modern-select">' + (contactSelect ? contactSelect.innerHTML : '') + '</select>'
            + '</div></div>'
            + '<div class="modern-field">'
            + '<input type="text" id="modern-title" class="modern-input" placeholder="Subject" value="' + escapeHtml(titleInput ? titleInput.value : '') + '">'
            + '</div>';
        container.appendChild(recipientRow);

        // Toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';
        container.appendChild(toolbar);

        // Replying-as header — sync-render immediately, refine async.
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

        var editor = null;
        var activeButtonElements = [];

        function addSeparator() {
            var sep = document.createElement('span');
            sep.className = 'toolbar-separator';
            sep.style.cssText = 'width:1px;height:1.5rem;background:var(--border-color);margin:0 var(--space-sm);display:inline-block;vertical-align:middle;';
            toolbar.appendChild(sep);
        }

        function exec(cmd) {
            if (!editor) return;
            cmd();
            editor.commands.focus();
        }

        // ========== UNDO / REDO ==========
        var undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'modern-editor-btn';
        undoBtn.innerHTML = '<i class="fa-regular fa-undo"></i>';
        undoBtn.title = 'Undo';
        undoBtn.disabled = true;
        toolbar.appendChild(undoBtn);

        var redoBtn = document.createElement('button');
        redoBtn.type = 'button';
        redoBtn.className = 'modern-editor-btn';
        redoBtn.innerHTML = '<i class="fa-regular fa-redo"></i>';
        redoBtn.title = 'Redo';
        redoBtn.disabled = true;
        toolbar.appendChild(redoBtn);

        addSeparator();
        // ========== END UNDO / REDO ==========

        // ----- Build toolbar UI -----
        var group1 = [
            { title: 'Bold',           icon: 'fa-regular fa-bold',          btn: null },
            { title: 'Italic',         icon: 'fa-regular fa-italic',        btn: null },
            { title: 'Underline',      icon: 'fa-regular fa-underline',     btn: null },
            { title: 'Strikethrough',  icon: 'fa-regular fa-strikethrough', btn: null }
        ];
        for (var i = 0; i < group1.length; i++) {
            var g = group1[i];
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'modern-editor-btn';
            button.innerHTML = '<i class="' + g.icon + '"></i>';
            button.title = g.title;
            toolbar.appendChild(button);
            g.btn = button;
            activeButtonElements.push(button);
        }

        // ========== COLOR DROPDOWN ==========
        var colorDropdownContainer = document.createElement('div');
        colorDropdownContainer.className = 'modern-dropdown';
        colorDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var colorDropdownBtn = document.createElement('button');
        colorDropdownBtn.type = 'button';
        colorDropdownBtn.className = 'modern-editor-btn';
        colorDropdownBtn.innerHTML = '<i class="fa-regular fa-palette"></i>';
        colorDropdownBtn.title = 'Text color';
        var colorDropdownMenu = document.createElement('div');
        colorDropdownMenu.className = 'modern-dropdown-menu';
        colorDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:180px;display:none;';
        colorDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" data-color="primary"><span class="color-swatch color-swatch--primary"></span> Primary</button>'
            + '<button class="modern-dropdown-item" data-color="info"><span class="color-swatch color-swatch--info"></span> Info</button>'
            + '<button class="modern-dropdown-item" data-color="accent"><span class="color-swatch color-swatch--accent"></span> Accent</button>'
            + '<button class="modern-dropdown-item" data-color="warning"><span class="color-swatch color-swatch--warning"></span> Warning</button>'
            + '<button class="modern-dropdown-item" data-color="danger"><span class="color-swatch color-swatch--danger"></span> Danger</button>'
            + '<button class="modern-dropdown-item" data-color="muted"><span class="color-swatch color-swatch--muted"></span> Muted</button>'
            + '<button class="modern-dropdown-item" data-color="remove"><i class="fa-regular fa-eraser" aria-hidden="true"></i> Remove color</button>';
        colorDropdownContainer.appendChild(colorDropdownBtn);
        colorDropdownContainer.appendChild(colorDropdownMenu);
        toolbar.appendChild(colorDropdownContainer);
        colorDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            colorDropdownMenu.style.display = colorDropdownMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', function() { colorDropdownMenu.style.display = 'none'; });
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
                colorDropdownMenu.style.display = 'none';
            };
        });
        // ========== END COLOR DROPDOWN ==========

        // ---- Clear formatting button ----
        var clearFormatBtn = document.createElement('button');
        clearFormatBtn.type = 'button';
        clearFormatBtn.className = 'modern-editor-btn';
        clearFormatBtn.innerHTML = '<i class="fa-regular fa-remove-format"></i>';
        clearFormatBtn.title = 'Clear formatting';
        toolbar.appendChild(clearFormatBtn);
        activeButtonElements.push(clearFormatBtn);

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
        var headingDropdownMenu = document.createElement('div');
        headingDropdownMenu.className = 'modern-dropdown-menu';
        headingDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        headingDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" data-level="1">Heading 1</button>'
            + '<button class="modern-dropdown-item" data-level="2">Heading 2</button>'
            + '<button class="modern-dropdown-item" data-level="3">Heading 3</button>';
        headingDropdownContainer.appendChild(headingDropdownBtn);
        headingDropdownContainer.appendChild(headingDropdownMenu);
        toolbar.appendChild(headingDropdownContainer);
        headingDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            headingDropdownMenu.style.display = headingDropdownMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', function() { headingDropdownMenu.style.display = 'none'; });
        headingDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

        var headingButtons = {
            h1: headingDropdownMenu.querySelector('[data-level="1"]'),
            h2: headingDropdownMenu.querySelector('[data-level="2"]'),
            h3: headingDropdownMenu.querySelector('[data-level="3"]')
        };
        // ========== END HEADING DROPDOWN ==========

        // List dropdown
        var listDropdownContainer = document.createElement('div');
        listDropdownContainer.className = 'modern-dropdown';
        listDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var listDropdownBtn = document.createElement('button');
        listDropdownBtn.type = 'button';
        listDropdownBtn.className = 'modern-editor-btn';
        listDropdownBtn.innerHTML = '<i class="fa-regular fa-list"></i>';
        listDropdownBtn.title = 'Insert list';
        var listDropdownMenu = document.createElement('div');
        listDropdownMenu.className = 'modern-dropdown-menu';
        listDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        listDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" id="bullet-list-option"><i class="fa-regular fa-list"></i> Bullet list</button>'
            + '<button class="modern-dropdown-item" id="ordered-list-option"><i class="fa-regular fa-list-ol"></i> Ordered list</button>';
        listDropdownContainer.appendChild(listDropdownBtn);
        listDropdownContainer.appendChild(listDropdownMenu);
        toolbar.appendChild(listDropdownContainer);
        listDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            listDropdownMenu.style.display = listDropdownMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', function() { listDropdownMenu.style.display = 'none'; });
        listDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

        var blockquoteBtn = document.createElement('button');
        blockquoteBtn.type = 'button';
        blockquoteBtn.className = 'modern-editor-btn';
        blockquoteBtn.innerHTML = '<i class="fa-regular fa-quote-left"></i>';
        blockquoteBtn.title = 'Blockquote';
        toolbar.appendChild(blockquoteBtn);
        activeButtonElements.push(blockquoteBtn);

        var codeBtn = document.createElement('button');
        codeBtn.type = 'button';
        codeBtn.className = 'modern-editor-btn';
        codeBtn.innerHTML = '<i class="fa-regular fa-code"></i>';
        codeBtn.title = 'Code block';
        toolbar.appendChild(codeBtn);
        activeButtonElements.push(codeBtn);

        addSeparator();

        var linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'modern-editor-btn';
        linkBtn.innerHTML = '<i class="fa-regular fa-link"></i>';
        linkBtn.title = 'Insert link';
        toolbar.appendChild(linkBtn);
        activeButtonElements.push(linkBtn);

        var imageDropdownContainer = document.createElement('div');
        imageDropdownContainer.className = 'modern-dropdown';
        imageDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var imageDropdownBtn = document.createElement('button');
        imageDropdownBtn.type = 'button';
        imageDropdownBtn.className = 'modern-editor-btn';
        imageDropdownBtn.innerHTML = '<i class="fa-regular fa-image"></i>';
        imageDropdownBtn.title = 'Insert image';
        var imageDropdownMenu = document.createElement('div');
        imageDropdownMenu.className = 'modern-dropdown-menu';
        imageDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        imageDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" id="image-url-option"><i class="fa-regular fa-link"></i> By URL</button>'
            + '<button class="modern-dropdown-item" id="image-upload-option"><i class="fa-regular fa-cloud-arrow-up"></i> Upload from computer</button>';
        imageDropdownContainer.appendChild(imageDropdownBtn);
        imageDropdownContainer.appendChild(imageDropdownMenu);
        toolbar.appendChild(imageDropdownContainer);
        imageDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            imageDropdownMenu.style.display = imageDropdownMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', function() { imageDropdownMenu.style.display = 'none'; });
        imageDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });
        addSeparator();

        // ---- Spoiler button ----
        var spoilerBtn = document.createElement('button');
        spoilerBtn.type = 'button';
        spoilerBtn.className = 'modern-editor-btn';
        spoilerBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
        spoilerBtn.title = 'Spoiler';
        toolbar.appendChild(spoilerBtn);
        activeButtonElements.push(spoilerBtn);

        // ---- Emoji button & custom picker ----
        var emojiBtn = document.createElement('button');
        emojiBtn.type = 'button';
        emojiBtn.className = 'modern-editor-btn';
        emojiBtn.innerHTML = '<i class="fa-regular fa-face-smile"></i>';
        emojiBtn.title = 'Insert emoji';
        toolbar.appendChild(emojiBtn);
        activeButtonElements.push(emojiBtn);

        var emojiPickerPanel = document.createElement('div');
        emojiPickerPanel.className = 'modern-emoji-picker';
        emojiPickerPanel.style.cssText = 'position:absolute;bottom:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius);padding:var(--space-sm);z-index:1000;display:none;grid-template-columns:repeat(8,1fr);gap:var(--space-xs);width:320px;max-height:200px;overflow-y:auto;';

        function emojiToCodePoint(emoji) {
            var codePoints = Array.from(emoji).map(function(ch) {
                return ch.codePointAt(0).toString(16);
            });
            codePoints = codePoints.filter(function(cp) {
                return cp !== 'fe0f';
            });
            return codePoints.join('-');
        }

        var emojiGroups = [
            { name: 'Emojis', emojis: [
                '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','🥲','😏','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','🤤','🥳','😎','🤓','🧐','🙃','🤐','🤨','😒','🙄','😬','😌','😔','😪','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','😕','😟','🙁','😮','😲','😳','🥺','😨','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👋','👌','👍','👎','✊','👏','🙏','💪','👀','🤦','🤷','🎉','❤️','💔','🔥','💯','💥'
            ] }
        ];

        emojiGroups.forEach(function(group, groupIndex) {
            if (groupIndex > 0) {
                var separator = document.createElement('div');
                separator.className = 'emoji-group-separator';
                separator.style.cssText = 'grid-column:1/-1;height:1px;background:var(--border-color);margin:var(--space-xs) 0;';
                emojiPickerPanel.appendChild(separator);
                
                var groupLabel = document.createElement('div');
                groupLabel.className = 'emoji-group-label';
                groupLabel.textContent = group.name;
                groupLabel.style.cssText = 'grid-column:1/-1;font-size:var(--text-xs);color:var(--text-tertiary);margin-top:var(--space-xs);font-weight:500;';
                emojiPickerPanel.appendChild(groupLabel);
            }
            
            group.emojis.forEach(function(emoji) {
                var emojiItem = document.createElement('button');
                emojiItem.type = 'button';
                emojiItem.className = 'modern-emoji-item';
                emojiItem.setAttribute('data-emoji', emoji);
                
                var codePoint = emojiToCodePoint(emoji);
                var imgUrl = 'https://twemoji.maxcdn.com/v/latest/svg/' + codePoint + '.svg';
                var img = document.createElement('img');
                img.src = imgUrl;
                img.alt = emoji;
                img.style.width = '1.5rem';
                img.style.height = '1.5rem';
                img.onerror = function() {
                    emojiItem.innerHTML = emoji;
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
                    }
                    emojiPickerPanel.style.display = 'none';
                };
                emojiPickerPanel.appendChild(emojiItem);
            });
        });

        toolbar.style.position = 'relative';
        toolbar.appendChild(emojiPickerPanel);

        emojiBtn.onclick = function(e) {
            e.stopPropagation();
            var isVisible = emojiPickerPanel.style.display === 'grid';
            emojiPickerPanel.style.display = isVisible ? 'none' : 'grid';
        };

        document.addEventListener('click', function(e) {
            if (emojiPickerPanel && !emojiPickerPanel.contains(e.target) && e.target !== emojiBtn) {
                emojiPickerPanel.style.display = 'none';
            }
        });

        // -----------------------------------------------------------------
        // UPLOAD FUNCTION
        // -----------------------------------------------------------------
        function uploadImageToWorker(file, editorInstance) {
            var formData = new FormData();
            formData.append('image', file);
            var currentPos = editorInstance.state.selection.from;
            editorInstance.chain().focus().insertContent('⬆️ Uploading...').run();
            var placeholderStart = currentPos;
            var placeholderEnd = currentPos + '⬆️ Uploading...'.length;

            fetch('https://imgbb-upload-proxy.nhristakiev.workers.dev/', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
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
                } else {
                    editorInstance.chain().focus().insertContent('[Upload failed]').run();
                }
            })
            .catch(error => {
                console.error('Upload error:', error);
                editorInstance.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run();
                editorInstance.chain().focus().insertContent('[Upload error]').run();
            });
        }

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
            function close() { modalOverlay.remove(); }
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
            function close() { modalOverlay.remove(); }
            modalBox.querySelector('#modal-cancel').onclick = close;
            modalBox.querySelector('#modal-submit').onclick = function() {
                var linkText = textInput.value.trim();
                var linkUrl = urlInput.value.trim();
                if (linkUrl) {
                    callback(linkUrl, linkText || null);
                }
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

                if (!Mention) {
                    throw new Error('Mention extension not found');
                }

                const CustomLink = Link.configure({
                    openOnClick: true,
                    autolink: true,
                    linkOnPaste: true,
                    HTMLAttributes: {
                        target: '_blank',
                        rel: 'noopener noreferrer',
                    },
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

                        var finalImageUrl = imageSrc;
                        if (imageSrc && imageSrc.startsWith('/')) {
                            try {
                                var urlObj = new URL(href);
                                finalImageUrl = urlObj.origin + imageSrc;
                            } catch (e) {
                                finalImageUrl = imageSrc;
                            }
                        }

                        var hostname = '';
                        try {
                            var urlObj = new URL(href);
                            hostname = urlObj.hostname.replace(/^www\./, '');
                        } catch (e) {
                            hostname = href.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
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
                            setSpoiler: () => ({ commands }) => {
                                return commands.wrapIn(this.name);
                            },
                            toggleSpoiler: () => ({ commands }) => {
                                return commands.toggleWrap(this.name);
                            },
                            unsetSpoiler: () => ({ commands }) => {
                                return commands.lift(this.name);
                            },
                        };
                    },
                });

                // -------------------------------------------------------------
                // MENTION
                // Outputs <mark data-uid="..." data-username="...">name</mark>.
                // The mark content is JUST the name (no leading @) so the
                // reader's transformUserTags can prepend @ without duplicating
                // it. The editor renders the leading @ via CSS ::before so the
                // user sees @name while typing — matching what the reader shows.
                // -------------------------------------------------------------
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
                                    return v.replace(/^@/, '');
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
                                return {
                                    id: el.getAttribute('data-uid'),
                                    label: raw.replace(/^@/, ''),
                                };
                            },
                        }];
                    },
                }).configure({
                    HTMLAttributes: { class: 'user-tag' },
                    renderText: function({ node }) {
                        // When serialized via getText(), still produce @name
                        // for legacy compatibility even if anything ever
                        // reads the plain-text version.
                        return '@' + (node.attrs.label || '');
                    },
                    suggestion: {
                        char: '@',
                        allowSpaces: false,
                        // Don't fire inside code blocks — @ appears in code
                        // for email addresses, decorators, etc.
                        allow: function({ state, range }) {
                            try {
                                var $from = state.doc.resolve(range.from);
                                return $from.parent.type.name !== 'codeBlock';
                            } catch (e) { return true; }
                        },
                        items: function({ query }) {
                            return searchMentions(query);
                        },
                        render: function() {
                            var popup = null;
                            var items = [];
                            var selectedIndex = 0;
                            var itemEls = [];

                            function updateSelected() {
                                itemEls.forEach(function(el, i) {
                                    el.classList.toggle('is-selected', i === selectedIndex);
                                });
                            }

                            function makeInitialAvatar(name, userId) {
                                var initial = (name || '?').charAt(0).toUpperCase();
                                var span = document.createElement('span');
                                span.className = 'mention-suggestion-avatar mention-suggestion-avatar--initial';
                                // Consistent colour, same palette + hash as the Posts module.
                                var bgColor = getColorFromNickname(name, userId);
                                span.style.backgroundColor = '#' + bgColor;
                                span.textContent = initial;
                                return span;
                            }

function buildList(props) {
    items = props.items || [];
    selectedIndex = 0;
    itemEls = [];

    if (!popup) return;
    popup.innerHTML = '';

    if (items.length === 0) {
        popup.style.display = 'none';
        return;
    }

    items.forEach(function(user) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'mention-suggestion-item';

        var rawAvatar = (typeof user.avatar === 'string' && user.avatar) ? user.avatar : null;
        var avatarUrl = (rawAvatar && !shouldUseInitialAvatar(rawAvatar))
            ? (optimizeAvatarUrl(rawAvatar, 28, 28) || rawAvatar)
            : null;

        if (avatarUrl) {
            var img = document.createElement('img');
            img.className = 'mention-suggestion-avatar';
            img.src = avatarUrl;
            img.alt = '';
            img.width = 28;
            img.height = 28;
            img.loading = 'lazy';

            // Broken image (network error, 404, CORS-blocked): fall back to initials.
            img.onerror = function() {
                this.replaceWith(makeInitialAvatar(user.name, user.id));
            };

            // Some CDNs return a 1×1 transparent placeholder with a 200 status
            // instead of a proper 404 — onerror never fires, but the visible
            // result is an empty circle. Catch that case after load.
            img.onload = function() {
                if (this.naturalWidth <= 1 || this.naturalHeight <= 1) {
                    this.replaceWith(makeInitialAvatar(user.name, user.id));
                }
            };

            el.appendChild(img);
        } else {
            el.appendChild(makeInitialAvatar(user.name, user.id));
        }

        var name = document.createElement('span');
        name.className = 'mention-suggestion-name';
        name.textContent = user.name || '';
        el.appendChild(name);

        // mousedown fires before blur, so the editor
        // doesn't lose focus before the command runs
        el.addEventListener('mousedown', function(e) {
            e.preventDefault();
            props.command({
                id: String(user.id),
                label: user.name || String(user.id),
            });
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

                            return {
                                onStart: function(props) {
                                    popup = document.createElement('div');
                                    popup.className = 'mention-suggestions';
                                    document.body.appendChild(popup);
                                    buildList(props);
                                    positionPopup(props);
                                },
                                onUpdate: function(props) {
                                    if (!popup) return;
                                    buildList(props);
                                    positionPopup(props);
                                },
                                onKeyDown: function(props) {
                                    if (!popup || popup.style.display === 'none' || items.length === 0) {
                                        return false;
                                    }
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
                                                label: user.name || String(user.id),
                                            });
                                        }
                                        return true;
                                    }
                                    if (props.event.key === 'Escape') {
                                        if (popup) {
                                            popup.remove();
                                            popup = null;
                                        }
                                        return true;
                                    }
                                    return false;
                                },
                                onExit: function() {
                                    if (popup) {
                                        popup.remove();
                                        popup = null;
                                    }
                                    items = [];
                                    itemEls = [];
                                },
                            };
                        },
                    },
                });

                // -------------------------------------------------------------
                // SEMANTIC COLOR MARK
                // -------------------------------------------------------------
                const SemanticColor = Mark.create({
                    name: 'semanticColor',
                    addAttributes() {
                        return {
                            variant: { default: 'primary' }
                        };
                    },
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
                        return ['span', {
                            class: 'text-' + variant,
                            'data-color': variant
                        }, 0];
                    }
                });

                const linkPreviewPlugin = new Plugin({
                    key: new PluginKey('linkPreview'),
                    props: {
                        handlePaste: (view, event) => {
                            var text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                            if (!text) return false;
                            var urlRegex = /(https?:\/\/[^\s]+)/g;
                            var match = urlRegex.exec(text);
                            if (!match) return false;
                            var url = match[0];
                            fetch('https://og-worker.nhristakiev.workers.dev/?url=' + encodeURIComponent(url))
                                .then(function(res) { return res.json(); })
                                .then(function(data) {
                                    if (data.error || (!data.imageSrc && (!data.title || data.title === url))) {
                                        var state = view.state;
                                        var tr = state.tr.replaceWith(state.selection.from, state.selection.to, state.schema.text(url));
                                        view.dispatch(tr);
                                        return;
                                    }
                                    var title = data.title || url;
                                    var description = data.description || '';
                                    var imageSrc = data.imageSrc || '';
                                    var href = data.href || url;
                                    var state = view.state;
                                    var tr = state.tr.replaceWith(
                                        state.selection.from, state.selection.to,
                                        state.schema.nodes.linkPreview.create({
                                            href: href, title: title, description: description, imageSrc: imageSrc
                                        })
                                    );
                                    view.dispatch(tr);
                                })
                                .catch(function(err) {
                                    console.error('Link preview error:', err);
                                    var state = view.state;
                                    var tr = state.tr.replaceWith(state.selection.from, state.selection.to, state.schema.text(url));
                                    view.dispatch(tr);
                                });
                            return true;
                        },
                    },
                });

                var initialHtml = legacyToHtml(originalTextarea ? originalTextarea.value : '');
                editor = new Editor({
                    element: editorElement,
                    extensions: [
                        StarterKit,
                        Placeholder.configure({ placeholder: 'Write your message...' }),
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
                        attributes: { class: 'modern-wysiwyg-content' },
                        plugins: [linkPreviewPlugin],
                    },
                    onCreate: function({ editor }) {
                        // Conditional auto-focus. The `autofocus` option only
                        // accepts static values in TipTap 2.x — a function
                        // gets misinterpreted as a focus position and crashes
                        // with "Position NaN out of range", so we do it here.
                        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
                            return; // touch device — don't pop the soft keyboard
                        }
                        var active = document.activeElement;
                        if (active && active !== document.body && active !== document.documentElement) {
                            return; // user already focused something else
                        }
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
                    }
                });

                // -----------------------------------------------------------------
                // Assign toolbar actions
                // -----------------------------------------------------------------
                undoBtn.onclick = function() { exec(function() { editor.chain().focus().undo().run(); }); };
                redoBtn.onclick = function() { exec(function() { editor.chain().focus().redo().run(); }); };
                clearFormatBtn.onclick = function() {
                    exec(function() {
                        editor.chain().focus().unsetAllMarks().clearNodes().run();
                    });
                };

                group1[0].btn.onclick = function() { exec(function() { editor.chain().focus().toggleBold().run(); }); };
                group1[1].btn.onclick = function() { exec(function() { editor.chain().focus().toggleItalic().run(); }); };
                group1[2].btn.onclick = function() { exec(function() { editor.chain().focus().toggleUnderline().run(); }); };
                group1[3].btn.onclick = function() { exec(function() { editor.chain().focus().toggleStrike().run(); }); };

                headingButtons.h1.onclick = function() {
                    exec(function() { editor.chain().focus().toggleHeading({ level: 1 }).run(); });
                    headingDropdownMenu.style.display = 'none';
                };
                headingButtons.h2.onclick = function() {
                    exec(function() { editor.chain().focus().toggleHeading({ level: 2 }).run(); });
                    headingDropdownMenu.style.display = 'none';
                };
                headingButtons.h3.onclick = function() {
                    exec(function() { editor.chain().focus().toggleHeading({ level: 3 }).run(); });
                    headingDropdownMenu.style.display = 'none';
                };

                listDropdownMenu.querySelector('#bullet-list-option').onclick = function() {
                    exec(function() { editor.chain().focus().toggleBulletList().run(); });
                    listDropdownMenu.style.display = 'none';
                };
                listDropdownMenu.querySelector('#ordered-list-option').onclick = function() {
                    exec(function() { editor.chain().focus().toggleOrderedList().run(); });
                    listDropdownMenu.style.display = 'none';
                };
                blockquoteBtn.onclick = function() { exec(function() { editor.chain().focus().toggleBlockquote().run(); }); };
                codeBtn.onclick = function() { exec(function() { editor.chain().focus().toggleCodeBlock().run(); }); };

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
                    imageDropdownMenu.style.display = 'none';
                };

                imageDropdownMenu.querySelector('#image-upload-option').onclick = function() {
                    var input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = function() {
                        if (input.files && input.files[0]) {
                            uploadImageToWorker(input.files[0], editor);
                        }
                    };
                    input.click();
                    imageDropdownMenu.style.display = 'none';
                };

                spoilerBtn.onclick = function() { exec(function() { editor.chain().focus().toggleSpoiler().run(); }); };

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
                    group1[0].btn.classList.toggle('active', isActive.bold);
                    group1[1].btn.classList.toggle('active', isActive.italic);
                    group1[2].btn.classList.toggle('active', isActive.underline);
                    group1[3].btn.classList.toggle('active', isActive.strike);
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

                var editorRoot = editorElement.querySelector('.ProseMirror');
                if (editorRoot) {
                    editorRoot.setAttribute('dropzone', 'copy');
                    editorRoot.addEventListener('dragover', function(e) { e.preventDefault(); });
                    editorRoot.addEventListener('drop', function(e) {
                        e.preventDefault();
                        var file = e.dataTransfer.files[0];
                        if (file && file.type.startsWith('image/')) {
                            uploadImageToWorker(file, editor);
                        }
                    });
                }

                editor.setOptions({
                    editorProps: {
                        handleDOMEvents: {
                            keydown: function(view, event) {
                                if (event.ctrlKey && event.shiftKey && event.key === 'S') {
                                    event.preventDefault();
                                    editor.chain().focus().toggleSpoiler().run();
                                    return true;
                                }
                                return false;
                            }
                        }
                    }
                });

                _originalEmoticon = window.emoticon;
                window.emoticon = function(x) {
                    if (editor) {
                        editor.chain().focus().insertContent(' ' + x + ' ').run();
                    } else if (_originalEmoticon) {
                        _originalEmoticon(x);
                    }
                };
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
            + '<button type="button" id="modern-submit"  class="modern-btn modern-btn-primary"><i class="fa-regular fa-paper-plane"></i> Send message</button>';
        container.appendChild(actions);

        var modernRecipient   = container.querySelector('#modern-recipient');
        var modernContact     = container.querySelector('#modern-contact');
        var modernTitle       = container.querySelector('#modern-title');

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

        // MODERN PREVIEW
        var modernPreviewBtn = container.querySelector('#modern-preview');
        if (modernPreviewBtn) {
            modernPreviewBtn.onclick = function() {
                syncToOriginal();
                if (originalTextarea && editor) {
                    var previewHtml = editor.getHTML();
                    var previewContent = previewArea.querySelector('.preview-content');
                    if (previewContent) {
                        previewContent.innerHTML = previewHtml;
                        if (window.twemoji) {
                            window.twemoji.parse(previewContent, { base: 'https://twemoji.maxcdn.com/v/latest/svg/', ext: '.svg' });
                        }
                    }
                    previewArea.style.display = 'block';
                }
            };
        }

        var modernSubmitBtn = container.querySelector('#modern-submit');
        if (modernSubmitBtn) {
            modernSubmitBtn.onclick = function(e) {
                e.preventDefault();
                syncToOriginal();

                var subjectValue = modernTitle ? modernTitle.value.trim() : '';
                if (!subjectValue) {
                    showTitleError();
                    return;
                }
                clearTitleError();

                if (addSentCheckbox) addSentCheckbox.checked = true;
                if (addTrackingCheckbox) addTrackingCheckbox.checked = true;
                if (originalTextarea && editor) originalTextarea.value = htmlToLegacy(editor.getHTML());
                if (originalForm && typeof originalForm.submit === 'function') {
                    if (typeof ValidateForm === 'function' && !ValidateForm(1)) return;
                    originalForm.submit();
                } else if (submitButton) {
                    submitButton.click();
                }
            };
        }

        return container;
    }

    // ------------------------------------------------------------------------
    // MESSAGES SECTION (unchanged)
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
                + '<select id="modern-folder-select" class="modern-select">'
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
                + '<div class="msg-select"><input type="checkbox" id="select-all-msgs" class="modern-checkbox-input"></div>';
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
                    + '<div class="msg-select"><input type="checkbox" class="modern-checkbox-input" name="' + escapeHtml(msgName) + '" id="msg-' + i + '"></div>';
                listContainer.appendChild(msgRow);
            }
            container.appendChild(listContainer);
            var actionBar = document.createElement('div');
            actionBar.className = 'messages-action-bar';
            actionBar.innerHTML = ''
                + '<div class="action-group">'
                + '<button class="modern-btn modern-btn-secondary" id="move-messages"><i class="fa-regular fa-folder-open"></i> Move to</button> '
                + '<select id="move-folder" class="modern-select-sm"><option value="in">Inbox</option><option value="sent">Sent Items</option></select>'
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
    // CONTACTS SECTION (unchanged)
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
                + '<textarea id="modern-friends-list" class="modern-textarea-contacts" rows="8" placeholder="One username per line">' + escapeHtml(friendsTextarea ? friendsTextarea.value : '') + '</textarea>'
                + '<p class="contacts-help">Users you allow to message you when privacy mode is on.</p>';
            container.appendChild(friendsCard);
            var blockedCard = document.createElement('div');
            blockedCard.className = 'contacts-card';
            blockedCard.innerHTML = ''
                + '<h3 class="contacts-card-title"><i class="fa-regular fa-ban"></i> Blocked users</h3>'
                + '<textarea id="modern-blocked-list" class="modern-textarea-contacts" rows="5" placeholder="One username per line">' + escapeHtml(blockedTextarea ? blockedTextarea.value : '') + '</textarea>'
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
