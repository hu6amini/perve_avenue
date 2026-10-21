/* ============================================================
   EditorModule – Modern editor for forum post / reply / fast-edit
   Replaces:  body#topic .fast.send
              body#send  .send
              any .post  .fastedit  (dynamic)

   Relies on ForumCoreObserver for dynamic fast-edit detection.
   Mirrors the editor internals of messenger.js (toolbar, TipTap,
   preview, modals, converters) without the messenger-specific
   sections. Uses the same wrapper (.modern-forum-wrapper) as the
   rest of the modern stack for placement.

   Content parity with the messenger:
     · lite YouTube / Vimeo embeds (nodes, paste detection, OG captions)
     · link previews (OG card on URL paste)
     · @-mentions (autocomplete popup, searchMentions)
     · inline-code paste handler (collapses whitespace)
     · transformPastedHTML (nbsp cleanup)
     · live preview auto-refresh on typing

   The legacy editor shells are hidden via CSS (section 27 in
   modern-forum.css), not by JS, so this module makes no attempt
   to set display: none anywhere.
   ============================================================ */
'use strict';

var EditorModule = (function (Utils, EventBus) {
    'use strict';

    // ========================================================================
    // STATE
    // ========================================================================
    var isInitialized = false;
    var _boundHandlers = [];
    var _dropdownBackdrop = null;
    var _uploadRegistry = new Map();
    var _currentUserCache = null;
    var _activeFastEdits = new Map();
    var _observerIds = [];
    var _mentionSearchAbort = null;

    // ========================================================================
    // CONFIG
    // ========================================================================
    var CONFIG = {
        OG_FETCH_TIMEOUT: 8000,
        UPLOAD_WORKER_URL: 'https://imgbb-upload-proxy.nhristakiev.workers.dev/',
        OG_WORKER_URL: 'https://og-worker.nhristakiev.workers.dev/?url=',
        TWEMOJI_BASE: 'https://twemoji.maxcdn.com/v/latest/svg/',
        MAX_UPLOAD_BYTES: 32 * 1024 * 1024,
        IMAGE_URL_EXTENSIONS: /\.(?:jpe?g|png|gif|webp|svg|bmp|avif|ico)(?:[?#]|$)/i,
        IMAGE_URL_HOSTS: [
            'i.imgur.com', 'i.ibb.co', 'i.postimg.cc',
            'cdn.discordapp.com', 'media.discordapp.net',
            'pbs.twimg.com', 'i.redd.it', 'lh3.googleusercontent.com'
        ],
        MAX_MESSAGE_LENGTH: 0,
        FAST_EDIT_REMOVAL_POLL_MS: 100,
        FAST_EDIT_REMOVAL_TIMEOUT_MS: 5000,
        LIVE_PREVIEW_DEBOUNCE_MS: 800
    };

    var MAX_MESSAGE_LENGTH   = CONFIG.MAX_MESSAGE_LENGTH;
    var OG_FETCH_TIMEOUT     = CONFIG.OG_FETCH_TIMEOUT;
    var UPLOAD_WORKER_URL    = CONFIG.UPLOAD_WORKER_URL;
    var OG_WORKER_URL        = CONFIG.OG_WORKER_URL;
    var TWEMOJI_BASE         = CONFIG.TWEMOJI_BASE;
    var MAX_UPLOAD_BYTES     = CONFIG.MAX_UPLOAD_BYTES;
    var IMAGE_URL_EXTENSIONS = CONFIG.IMAGE_URL_EXTENSIONS;
    var IMAGE_URL_HOSTS      = CONFIG.IMAGE_URL_HOSTS;

    // ========================================================================
    // UTILITIES
    // ========================================================================
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    function decodeHtmlEntities(str) {
        if (!str || typeof str !== 'string') return str;
        if (str.indexOf('&') === -1) return str;
        var txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
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

    function addGlobalListener(el, type, handler, opts) {
        el.addEventListener(type, handler, opts);
        _boundHandlers.push({ el: el, type: type, handler: handler, opts: opts });
    }

    function fetchWithTimeout(url, opts, timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        var merged = Object.assign({}, opts || {}, { signal: controller.signal });
        return fetch(url, merged).finally(function () { clearTimeout(timer); });
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
        return (parseInt(m[1] || '0', 10) * 3600) +
               (parseInt(m[2] || '0', 10) * 60) +
               parseInt(m[3] || '0', 10);
    }

    function formatBytes(bytes) {
        if (!bytes || bytes < 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = 0;
        var n = bytes;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return n.toFixed(n >= 10 || i === 0 ? 0 : 2) + ' ' + units[i];
    }

    function getInitialFromName(name) {
        if (!name || typeof name !== 'string') return '?';
        var match = name.match(/[\p{L}\p{N}]/u);
        if (!match) return '?';
        return match[0].toUpperCase();
    }

    // ========================================================================
    // LITE-EMBED URL PARSERS
    // ========================================================================
    function parseYouTubeUrl(url) {
        if (!url || typeof url !== 'string') return null;
        var m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
        if (!m) return null;
        var videoid = m[1];
        var start = null;
        var end = null;
        var qIndex = url.indexOf('?');
        if (qIndex >= 0) {
            var hashIndex = url.indexOf('#', qIndex);
            var queryStr = url.slice(qIndex + 1, hashIndex >= 0 ? hashIndex : undefined);
            try {
                var params = new URLSearchParams(queryStr);
                var t = params.get('t') || params.get('start');
                if (t) {
                    var parsed = parseTimeString(t);
                    if (parsed != null) start = parsed;
                }
                var e = params.get('end');
                if (e) {
                    var parsedEnd = parseInt(e, 10);
                    if (!isNaN(parsedEnd) && parsedEnd > 0) end = parsedEnd;
                }
            } catch (err) {}
        }
        return { videoid: videoid, start: start, end: end };
    }

    function parseVimeoUrl(url) {
        if (!url || typeof url !== 'string') return null;
        var m = url.match(/vimeo\.com\/(?:[^\/\s]+\/)*?(\d+)/);
        if (!m) return null;
        var videoid = m[1];
        var start = null;
        try {
            var hashIndex = url.indexOf('#');
            if (hashIndex >= 0) {
                var frag = url.slice(hashIndex + 1);
                var fragMatch = frag.match(/^t=(.+)$/);
                if (fragMatch) {
                    var parsed = parseTimeString(fragMatch[1]);
                    if (parsed != null) start = parsed;
                }
            }
            if (start == null) {
                var qIndex = url.indexOf('?');
                if (qIndex >= 0) {
                    var hashIndex2 = url.indexOf('#', qIndex);
                    var queryStr = url.slice(qIndex + 1, hashIndex2 >= 0 ? hashIndex2 : undefined);
                    var params = new URLSearchParams(queryStr);
                    var t = params.get('t');
                    if (t) {
                        var parsed2 = parseTimeString(t);
                        if (parsed2 != null) start = parsed2;
                    }
                }
            }
        } catch (err) {}
        return { videoid: videoid, start: start };
    }

    // ========================================================================
    // MENTION SEARCH
    // ========================================================================
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
            console.warn('[EditorModule] Search failed:', err);
            return [];
        });
    }

    // ========================================================================
    // AVATAR COLOURS / HELPERS
    // ========================================================================
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
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function optimizeAvatarUrl(url, width, height) {
        if (!url || typeof url !== 'string') return null;
        var trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return null;
        if (trimmed === 'http' || trimmed === 'https' || trimmed === '//') return null;
        if (trimmed.indexOf('weserv.nl') !== -1 || trimmed.indexOf('data:') === 0) return trimmed;
        if (trimmed.charAt(0) === '/' && trimmed.charAt(1) === '/') trimmed = 'https:' + trimmed;
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
        return lower.indexOf('img.forumfree.net') !== -1 ||
               lower.indexOf('style_images/default_avatar.png') !== -1 ||
               lower.indexOf('default_avatar') !== -1;
    }

    function sanitizeGroupName(name) {
        if (!name) return 'member';
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'member';
    }

    function getGroupClass(user) {
        if (!user || !user.group) return 'group-member';
        var groupName  = (user.group.name || '').toLowerCase();
        var groupClass = (user.group.class || '').toLowerCase();
        var groupBody  = (user.group.bodyclass || '').toLowerCase();
        var groupId    = user.group.id;

        if (groupClass.indexOf('founder') !== -1 || groupBody.indexOf('founder') !== -1 || groupName === 'founder') {
            return 'group-founder';
        }
        if (groupName === 'administrator' || groupClass.indexOf('admin') !== -1 || groupId === 1) {
            return 'group-administrator';
        }
        if (groupName === 'global moderator' || groupClass.indexOf('global_mod') !== -1) {
            return 'group-global-moderator';
        }
        if (groupName === 'moderator' || groupClass.indexOf('mod') !== -1) {
            return 'group-moderator';
        }
        if (groupName === 'developer' || groupClass.indexOf('developer') !== -1) {
            return 'group-developer';
        }
        if (groupName === 'game dev' || groupClass.indexOf('game_dev') !== -1) {
            return 'group-game-dev';
        }
        if (groupName === 'fan') return 'group-fan';
        return 'group-' + sanitizeGroupName(user.group.name || 'member');
    }

    // ========================================================================
    // CURRENT USER
    // ========================================================================
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
        return { mid: mid, nickname: username || null, avatar: avatarUrl || null };
    }

    function fetchCurrentUserData() {
        if (_currentUserCache) return Promise.resolve(_currentUserCache);
        var mid = getCurrentUserId();
        if (!mid) return Promise.resolve(null);
        return fetch('/api.php?mid=' + mid)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                var user = data && (data['m' + mid] || data.info);
                if (user) {
                    user.mid = mid;
                    if (typeof user.nickname === 'string') user.nickname = decodeHtmlEntities(user.nickname);
                    if (typeof user.name === 'string') user.name = decodeHtmlEntities(user.name);
                    _currentUserCache = user;
                }
                return user || null;
            })
            .catch(function () { return null; });
    }

    function buildUserHeader(user, label) {
        if (!user) return null;
        var username = decodeHtmlEntities(user.nickname) || 'You';
        var mid = user.mid;
        var profileUrl = '/?act=Profile&MID=' + mid;
        var avatarUrl = optimizeAvatarUrl(user.avatar, 36, 36);
        var groupClass = getGroupClass(user);

        var header = document.createElement('div');
        header.className = 'modern-replying-as ' + groupClass;

        var avatarHtml;
        if (avatarUrl) {
            avatarHtml = '<img class="modern-replying-avatar" src="' + escapeHtml(avatarUrl) +
                '" alt="" width="36" height="36" loading="lazy" decoding="async">';
        } else {
            avatarHtml = '<span class="modern-replying-avatar modern-replying-avatar--initial" ' +
                'style="background-color:#' + getColorFromNickname(username, mid) + ';">' +
                escapeHtml(getInitialFromName(username)) + '</span>';
        }

        header.innerHTML =
            '<span class="modern-replying-label">' + escapeHtml(label || 'Replying as:') + '</span>' +
            '<a href="' + escapeHtml(profileUrl) + '" class="modern-replying-user" rel="nofollow">' +
                avatarHtml +
                '<span class="modern-replying-name">' + escapeHtml(username) + '</span>' +
            '</a>';
        return header;
    }

    function attachProfileTip(header, user) {
        if (!header || !user) return;
        var tryAttach = function () {
            if (!window.ForumPostsModule ||
                typeof window.ForumPostsModule.attachProfileTip !== 'function') {
                return false;
            }
            var username = decodeHtmlEntities(user.nickname) || 'You';
            var data = {
                mid: user.mid,
                username: username,
                apiUser: user,
                groupText: (user.group && user.group.name) || 'Member',
                postCount: user.messages != null ? user.messages : 0,
                reputation: user.reputation != null ? user.reputation : 0,
                isOnline: user.status === 'online'
            };
            var userLink = header.querySelector('.modern-replying-user');
            if (userLink) window.ForumPostsModule.attachProfileTip(userLink, data);
            return true;
        };
        if (tryAttach()) return;
        setTimeout(tryAttach, 200);
    }

    // ========================================================================
    // HTML → LEGACY CONVERTERS
    // ========================================================================
        function paragraphizeLegacyHtml(html) {
        if (!html || typeof html !== 'string') return html;
        try {
            const BLOCK_TAGS = new Set([
                'H1','H2','H3','H4','H5','H6','DIV','P','UL','OL','LI',
                'BLOCKQUOTE','PRE','TABLE','HR','SECTION','ARTICLE','FIGURE',
                'HEADER','FOOTER','ASIDE','NAV','DL','DT','DD','FORM'
            ]);

            const container = document.createElement('div');
            container.innerHTML = html;
            const newChildren = [];
            let inlineBuffer = [];
            let pendingBreaks = 0;

            function hasVisibleContent(nodes) {
                return nodes.some(n => {
                    if (n.nodeType === 3) return n.nodeValue.trim().length > 0;
                    if (n.nodeType === 1) return n.tagName !== 'BR';
                    return false;
                });
            }

            function flushBuffer() {
                // Strip leading <br>
                while (inlineBuffer.length > 0 && inlineBuffer[0].nodeType === 1 && inlineBuffer[0].tagName === 'BR') {
                    inlineBuffer.shift();
                }
                // Strip trailing <br>
                while (inlineBuffer.length > 0 && inlineBuffer[inlineBuffer.length - 1].nodeType === 1 && inlineBuffer[inlineBuffer.length - 1].tagName === 'BR') {
                    inlineBuffer.pop();
                }
                if (!hasVisibleContent(inlineBuffer)) {
                    inlineBuffer = [];
                    return;
                }
                const p = document.createElement('p');
                inlineBuffer.forEach(n => p.appendChild(n));
                newChildren.push(p);
                inlineBuffer = [];
            }

            Array.from(container.childNodes).forEach(child => {
                // Check for <br>
                if (child.nodeType === 1 && child.tagName === 'BR') {
                    pendingBreaks++;
                    if (pendingBreaks >= 2) {
                        flushBuffer();
                        pendingBreaks = 0;
                    }
                    return;
                }

                // Check for whitespace text nodes between <br>s
                if (child.nodeType === 3 && !child.nodeValue.trim() && pendingBreaks > 0) {
                    return;
                }

                // If we had a single <br> pending, it was just a line break.
                if (pendingBreaks === 1) {
                    inlineBuffer.push(document.createElement('br'));
                }
                pendingBreaks = 0;

                // Block tags
                if (child.nodeType === 1 && BLOCK_TAGS.has(child.tagName)) {
                    flushBuffer();
                    newChildren.push(child);
                    return;
                }

                inlineBuffer.push(child);
            });

            // Handle any remaining single <br>
            if (pendingBreaks === 1) {
                inlineBuffer.push(document.createElement('br'));
            }

            flushBuffer();

            container.innerHTML = '';
            newChildren.forEach(n => container.appendChild(n));

            // Recurse into quotes and spoilers
            Array.from(container.querySelectorAll('blockquote, .quote-content, .spoiler-content-inner')).forEach(el => {
                el.innerHTML = paragraphizeLegacyHtml(el.innerHTML);
            });

            return container.innerHTML;
        } catch (e) {
            console.warn('[EditorModule] paragraphizeLegacyHtml failed:', e);
            return html;
        }
    }
   
    function legacyToHtml(legacy) {
        if (!legacy) return '';
        var html = legacy;

        html = html.replace(
            /<span[^>]*\bff-spoiler-title\b[^>]*>([\s\S]*?)<\/span>\s*(?:<br\s*\/?>)*\s*\[spoiler\]([\s\S]*?)\[\/spoiler\]/gis,
            function (_, title, body) {
                var decoded = decodeHtmlEntities(title.replace(/<[^>]*>/g, '')).trim();
                return '<div class="spoiler" data-title="' + escapeHtml(decoded) + '">' + body + '</div>';
            }
        );

        html = html.replace(
            /<span[^>]*\bff-code-lang\b[^>]*>([\s\S]*?)<\/span>\s*(?:<br\s*\/?>)*\s*\[code\]([\s\S]*?)\[\/code\]/gis,
            function (_, lang, body) {
                var decoded = decodeHtmlEntities(lang.replace(/<[^>]*>/g, '')).trim();
                return '<pre data-language="' + escapeHtml(decoded) + '"><code>' + body + '</code></pre>';
            }
        );

        html = html.replace(
            /<span\b[^>]*\bff-lite-youtube\b[^>]*>([\s\S]*?)<\/span>/gis,
            function (match) {
                var idMatch = match.match(/data-videoid="([^"]*)"/);
                var videoid = idMatch ? decodeHtmlEntities(idMatch[1]) : '';
                if (!videoid) return '';
                var t = match.match(/data-title="([^"]*)"/);
                var a = match.match(/data-author="([^"]*)"/);
                var s = match.match(/data-start="([^"]*)"/);
                var e = match.match(/data-end="([^"]*)"/);
                var attrs = 'videoid="' + escapeHtml(videoid) + '"';
                if (t) attrs += ' data-title="' + escapeHtml(decodeHtmlEntities(t[1])) + '"';
                if (a) attrs += ' data-author="' + escapeHtml(decodeHtmlEntities(a[1])) + '"';
                if (s) attrs += ' start="' + escapeHtml(s[1]) + '"';
                if (e) attrs += ' end="' + escapeHtml(e[1]) + '"';
                return '<lite-youtube ' + attrs + '></lite-youtube>';
            }
        );
        html = html.replace(
            /<span\b[^>]*\bff-lite-vimeo\b[^>]*>([\s\S]*?)<\/span>/gis,
            function (match) {
                var idMatch = match.match(/data-videoid="([^"]*)"/);
                var videoid = idMatch ? decodeHtmlEntities(idMatch[1]) : '';
                if (!videoid) return '';
                var t = match.match(/data-title="([^"]*)"/);
                var a = match.match(/data-author="([^"]*)"/);
                var s = match.match(/data-start="([^"]*)"/);
                var attrs = 'videoid="' + escapeHtml(videoid) + '"';
                if (t) attrs += ' data-title="' + escapeHtml(decodeHtmlEntities(t[1])) + '"';
                if (a) attrs += ' data-author="' + escapeHtml(decodeHtmlEntities(a[1])) + '"';
                if (s) attrs += ' start="' + escapeHtml(s[1]) + '"';
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
                // Replace the old [quote] rule with one that extracts the author
        html = html.replace(/\[QUOTE(?:=([^\]]+))?\]([\s\S]*?)\[\/QUOTE\]/gi, function(match, params, body) {
            var author = '';
            if (params) {
                // Params look like: "-JuNioR-,5/22/2026, 07:44 AM ?t=62378406..."
                var parts = params.split(',');
                if (parts.length > 0 && parts[0].trim()) {
                    author = parts[0].trim();
                }
            }
            
            // If there's an author, prepend the "Author said:" header
            var header = author ? '<p><strong>' + escapeHtml(author) + ' said:</strong></p>' : '';
            
            return '<blockquote>' + header + body + '</blockquote>';
        });
        html = html.replace(/\[code\](.*?)\[\/code\]/gis, '<pre><code>$1</code></pre>');
        html = html.replace(/\[spoiler\](.*?)\[\/spoiler\]/gis, '<div class="spoiler">$1</div>');
        html = html.replace(/\[CENTER\](.*?)\[\/CENTER\]/gis, '<div style="text-align:center">$1</div>');
        html = html.replace(/\[font=([^\]]+)\](.*?)\[\/font\]/gis, '$2');

        html = html.replace(/\[size=([^\]]+)\](.*?)\[\/size\]/gis, function (_, sz, content) {
            var n = parseInt(sz, 10);
            if (isNaN(n)) n = 14;
            n = Math.max(10, Math.min(30, n));
            return '<span style="font-size:' + n + 'px">' + content + '</span>';
        });

        html = html.replace(
            /<span[^>]*\bff-inline-code\b[^>]*>([\s\S]*?)<\/span>/gis,
            function (_, content) {
                var decoded = decodeHtmlEntities(content);
                return '<code>' + escapeHtml(decoded) + '</code>';
            }
        );

        html = html.replace(/\[EMAIL\](.*?)\[\/EMAIL\]/gi, '<a href="mailto:$1">$1</a>');
        return html;
    }

       // ========================================================================
    // ASYNC LEGACY → HTML CONVERTER
    //
    // legacyToHtml is synchronous and handles the plain [img]url[/img]
    // form. Some forum versions emit [IMG=format]url[/IMG] (format =
    // png / jpg / gif / webp / svg / bmp), which the [img]…[/img] rule
    // doesn't match because of the =format suffix. Left unconverted,
    // that raw BBCode reaches the editor as a text node.
    //
    // This wrapper expands the =format variants into the plain form so
    // legacyToHtml produces a real <img> element, then fetches natural
    // dimensions for any image that still lacks width/height. The
    // dimensions make the editor reserve layout space (no CLS while
    // typing) and end up in the saved payload, so the reader side
    // doesn't have to re-fetch them either.
    // ========================================================================
        async function legacyToHtmlAsync(legacy) {
        if (!legacy) return '';

        var expanded = legacy.replace(/\[IMG=([^\]]+)\]([^\[]+?)\[\/IMG\]/gi, function (_, altText, url) {
            var safeAlt = escapeHtml(altText.trim());
            return '<img src="' + url.trim() + '" alt="' + safeAlt + '" loading="lazy" decoding="async">';
        });

        // If the text has raw newlines (\n) but no <br> tags, convert newlines to <br>
        if (!/<br\s*\/?>/i.test(expanded) && /\n/.test(expanded)) {
            // Protect code blocks so we don't inject <br> inside them
            var codeBlocks = [];
            expanded = expanded.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, function(match) {
                var id = '\uE000CODE' + codeBlocks.length + 'Z\uE001';
                codeBlocks.push(match);
                return id;
            });
            
            expanded = expanded.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
            
            expanded = expanded.replace(/\uE000CODE(\d+)Z\uE001/g, function(m, idx) {
                return codeBlocks[parseInt(idx, 10)];
            });
        }

        var html = legacyToHtml(expanded);
        
        // Convert double <br> tags into proper <p> paragraphs
        html = paragraphizeLegacyHtml(html);
        
        return await enrichImageDimensions(html);
    }

    async function enrichImageDimensions(html) {
        if (!html || html.indexOf('<img') === -1) return html;

        var temp = document.createElement('div');
        temp.innerHTML = html;

        var promises = [];

        temp.querySelectorAll('img').forEach(function (img) {
            var w = img.getAttribute('width');
            var h = img.getAttribute('height');
            if (w && h && parseInt(w, 10) > 0 && parseInt(h, 10) > 0) return;

            if (img.classList.contains('twemoji')) return;
            var alt = img.getAttribute('alt') || '';
            if (alt.startsWith(':') && alt.endsWith(':')) return;

            var src = img.getAttribute('src') || '';
            if (!src) return;
            // Already proxied — dimensions are baked into the URL; the
            // natural-size fetch would just echo them back.
            if (src.indexOf('weserv.nl') !== -1 || src.indexOf('wsrv.nl') !== -1) return;

            if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
            if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');

            promises.push(new Promise(function (resolve) {
                var probe = new Image();
                var done = false;
                // 4s per-image cap so a hung request can't block editor
                // construction. Images that fail or time out just keep
                // the no-dimensions state — the reader-side
                // fixMissingImageDimensions still gets a shot at them.
                var timer = setTimeout(function () {
                    if (!done) { done = true; resolve(); }
                }, 4000);
                probe.onload = function () {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
                        img.setAttribute('width', probe.naturalWidth);
                        img.setAttribute('height', probe.naturalHeight);
                    }
                    resolve();
                };
                probe.onerror = function () {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve();
                };
                probe.src = src;
            }));
        });

        if (promises.length === 0) return temp.innerHTML;
        await Promise.all(promises);
        return temp.innerHTML;
    }

    function htmlToLegacy(html) {
        if (!html || typeof html !== 'string') return html;
        var result = html;
        for (var i = 0; i < 10; i++) {
            var before = result;

            result = result.replace(
                /<span[^>]*\bff-upload-placeholder-marker\b[^>]*>\s*<\/span>/gi, ''
            );

            result = result.replace(
                /<lite-youtube\b[^>]*\bvideoid="([^"]*)"[^>]*>\s*<\/lite-youtube>/gi,
                function (match, videoid) {
                    var s = match.match(/\bstart="([^"]*)"/);
                    var e = match.match(/\bend="([^"]*)"/);
                    var span = '<span class="ff-lite-youtube" data-videoid="' + escapeHtml(videoid) + '"';
                    if (s) span += ' data-start="' + escapeHtml(s[1]) + '"';
                    if (e) span += ' data-end="' + escapeHtml(e[1]) + '"';
                    return span + '></span>';
                }
            );
            result = result.replace(
                /<lite-vimeo\b[^>]*\bvideoid="([^"]*)"[^>]*>\s*<\/lite-vimeo>/gi,
                function (match, videoid) {
                    var s = match.match(/\bstart="([^"]*)"/);
                    var span = '<span class="ff-lite-vimeo" data-videoid="' + escapeHtml(videoid) + '"';
                    if (s) span += ' data-start="' + escapeHtml(s[1]) + '"';
                    return span + '></span>';
                }
            );

                        result = result.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function(match, inner) {
                var cleaned = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>\s*/gi, '\n');
                cleaned = cleaned.replace(/\n+$/, '');
                
                // Check if the quote starts with our injected "Author said:" header
                var authorMatch = cleaned.match(/^<strong>([^<]+) said:<\/strong>\n?/i);
                if (authorMatch) {
                    var author = authorMatch[1];
                    var rest = cleaned.substring(authorMatch[0].length);
                    return '[QUOTE=' + author + ']' + rest + '[/QUOTE]';
                }
                
                return '[QUOTE]' + cleaned + '[/QUOTE]';
            });

            result = result.replace(/<div\b([^>]*\bclass="[^"]*\bspoiler\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi, function (_, attrs, inner) {
                var cleaned = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>\s*/gi, '\n').replace(/\n+$/, '');
                var t = attrs.match(/data-title="([^"]*)"/);
                var title = t ? decodeHtmlEntities(t[1]).trim() : '';
                var prefix = title ? '<span class="ff-spoiler-title">' + escapeHtml(title) + '</span>' : '';
                return prefix + '[SPOILER]' + cleaned + '[/SPOILER]';
            });

            result = result.replace(/<pre([^>]*)>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, function (_, preAttrs, inner) {
                var decoded = inner.replace(/<[^>]*>/g, '')
                    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
                var l = preAttrs.match(/data-language="([^"]*)"/);
                var lang = l ? decodeHtmlEntities(l[1]).trim() : '';
                var prefix = lang ? '<span class="ff-code-lang">' + escapeHtml(lang) + '</span>' : '';
                return prefix + '[CODE]' + decoded + '[/CODE]';
            });

            result = result.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, function (_, inner) {
                return '<span class="ff-inline-code">' + inner + '</span>';
            });

            if (result === before) break;
        }
        return result;
    }

    // ========================================================================
    // SYNTAX HIGHLIGHTING (PREVIEW / READER)
    // ========================================================================
    function highlightCode(codeText) {
        if (codeText == null) return '';
        var html = String(codeText)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var stash = [];
        function keep(htmlStr) {
            var key = '\uE000A' + stash.length.toString(36) + 'Z\uE001';
            stash.push(htmlStr);
            return key;
        }
        html = html.replace(/\/\*[\s\S]*?\*\//g, function (m) { return keep('<span class="code-comment">' + m + '</span>'); });
        html = html.replace(/(^|[^:\w])(\/\/[^\n]*)/g, function (m, p, c) { return p + keep('<span class="code-comment">' + c + '</span>'); });
        html = html.replace(/^(\s*)(#[^\n]*)/gm, function (m, ws, c) {
            if (/^#[0-9a-fA-F]{3,8}$/.test(c.trim())) return m;
            return ws + keep('<span class="code-comment">' + c + '</span>');
        });
        html = html.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, function (m) {
            return keep('<span class="code-string">' + m + '</span>');
        });
        html = html.replace(/\b\d+(?:\.\d+)?\b/g, '<span class="code-number">$&</span>');
        var KW = ['abstract','as','assert','async','await','bool','break','case','catch','class','const','continue','def','default','del','delete','do','elif','else','enum','except','export','extends','False','false','final','finally','float','for','from','func','function','global','goto','if','import','in','int','interface','is','lambda','let','match','module','new','None','null','not','or','pass','print','private','protected','public','raise','return','self','static','str','super','switch','this','throw','True','true','try','typeof','var','void','while','with','yield'].join('|');
        html = html.replace(new RegExp('\\b(' + KW + ')\\b', 'g'), '<span class="code-keyword">$1</span>');
        html = html.replace(/\uE000A([0-9a-z]+)Z\uE001/g, function (m, idx) { return stash[parseInt(idx, 36)]; });
        return html;
    }

    // ========================================================================
    // PREVIEW TRANSFORM
    // ========================================================================
    function transformPreviewHtml(html) {
        if (!html || typeof html !== 'string') return html;
        var temp = document.createElement('div');
        temp.innerHTML = html;

        Array.from(temp.querySelectorAll('blockquote')).forEach(function (bq) {
            var innerHtml = bq.innerHTML;
            var modernHtml =
                '<div class="modern-quote long-quote">' +
                    '<div class="quote-header"><div class="quote-meta">' +
                        '<div class="quote-icon"><i class="fa-regular fa-quote-left" aria-hidden="true"></i></div>' +
                        '<div class="quote-info"><span class="quote-author">Quote</span></div>' +
                    '</div></div>' +
                    '<div class="quote-content">' + innerHtml + '</div>' +
                    '<button class="quote-expand-btn" type="button" aria-expanded="false" aria-label="Show full quote">' +
                        '<i class="fa-regular fa-angle-down" aria-hidden="true"></i> <span class="expand-text">Show more</span>' +
                    '</button>' +
                '</div>';
            var wrapper = document.createElement('div');
            wrapper.innerHTML = modernHtml;
            if (bq.parentNode) bq.parentNode.replaceChild(wrapper.firstElementChild, bq);
        });

        Array.from(temp.querySelectorAll('div.spoiler')).forEach(function (sp) {
            var innerHtml = sp.innerHTML;
            var title = sp.getAttribute('data-title') || 'Spoiler';
            var spoilerId = 'preview-spoiler-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
            var modernHtml =
                '<div class="modern-spoiler">' +
                    '<div class="spoiler-header" role="button" tabindex="0" aria-expanded="false">' +
                        '<div class="spoiler-icon"><i class="fa-regular fa-square-caret-down" aria-hidden="true"></i></div>' +
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

        Array.from(temp.querySelectorAll('pre')).forEach(function (pre) {
            if (pre.closest('.modern-code')) return;
            var code = pre.querySelector('code');
            var rawText = code ? (code.textContent || '') : (pre.textContent || '');
            var codeContent = highlightCode(rawText);
            var lang = (pre.getAttribute('data-language') || '').trim() || 'Code';
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

        Array.from(temp.querySelectorAll('span.ff-nsfw')).forEach(function (sp) {
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

        Array.from(temp.querySelectorAll('img[data-nsfw="true"]')).forEach(function (img) {
            if (img.closest('.nsfw-image')) return;
            var wrapper = document.createElement('span');
            wrapper.className = 'nsfw-image';
            wrapper.setAttribute('role', 'button');
            wrapper.setAttribute('tabindex', '0');
            wrapper.setAttribute('aria-pressed', 'false');
            wrapper.setAttribute('aria-label', 'Hidden image, click to reveal');
            var w = img.getAttribute('width');
            var h = img.getAttribute('height');
            if (w && h) { wrapper.style.width = w + 'px'; wrapper.style.aspectRatio = w + '/' + h; wrapper.style.maxWidth = '100%'; }
            var ds = img.getAttribute('data-size');
            if (ds === 'small') wrapper.style.maxWidth = '25%';
            else if (ds === 'medium') wrapper.style.maxWidth = '50%';
            else if (ds === 'large') wrapper.style.maxWidth = '75%';
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
        });

        return temp.innerHTML;
    }

    // ========================================================================
    // PREVIEW HANDLERS
    // ========================================================================
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
                if (quote.classList.contains('expanded')) content.style.maxHeight = '';
            };
            content.addEventListener('transitionend', cleanup);
        }
        btn.setAttribute('aria-expanded', String(!isExpanded));
        var t = btn.querySelector('.expand-text');
        if (t) t.textContent = isExpanded ? 'Show more' : 'Show less';
    }

    function handlePreviewCodeExpand(btn) {
        var block = btn.closest('.modern-code');
        if (!block) return;
        var content = block.querySelector('.code-content');
        if (!content) return;
        var isExpanded = block.classList.contains('expanded');
        if (isExpanded) {
            content.style.maxHeight = content.scrollHeight + 'px';
            void content.offsetHeight;
            content.style.maxHeight = '';
            block.classList.remove('expanded');
        } else {
            content.style.maxHeight = content.scrollHeight + 'px';
            block.classList.add('expanded');
            var cleanup = function (e) {
                if (e.propertyName !== 'max-height') return;
                content.removeEventListener('transitionend', cleanup);
                if (block.classList.contains('expanded')) content.style.maxHeight = '';
            };
            content.addEventListener('transitionend', cleanup);
        }
        btn.setAttribute('aria-expanded', String(!isExpanded));
        var t = btn.querySelector('.expand-text');
        if (t) t.textContent = isExpanded ? 'Show more' : 'Show less';
    }

    function handlePreviewCodeCopy(btn) {
        var block = btn.closest('.modern-code');
        if (!block) return;
        var codeEl = block.querySelector('.code-content code');
        if (!codeEl) return;
        var text = codeEl.textContent;
        var flash = function () {
            var icon = btn.querySelector('i');
            if (!icon) return;
            var orig = icon.className;
            icon.className = 'fa-regular fa-check';
            setTimeout(function () { icon.className = orig; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(flash).catch(function () {});
        } else {
            var ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); flash(); } catch (e) {}
            document.body.removeChild(ta);
        }
    }

    function handlePreviewSpoilerToggle(trigger) {
        var header = trigger.closest('.spoiler-header');
        if (!header) return;
        var spoiler = header.closest('.modern-spoiler');
        if (!spoiler) return;
        var content = spoiler.querySelector('.spoiler-content');
        var btn = header.querySelector('.spoiler-toggle');
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
        if (btn) btn.setAttribute('aria-expanded', String(!isExpanded));
        header.setAttribute('aria-expanded', String(!isExpanded));
        content.setAttribute('aria-hidden', String(isExpanded));
    }

    function handlePreviewNSFWToggle(el) {
        var isRevealed = el.classList.toggle('revealed');
        el.setAttribute('aria-pressed', String(isRevealed));
    }

    function attachPreviewHandlers(previewArea) {
        previewArea.addEventListener('click', function (e) {
            var nsfwImg = e.target.closest('.nsfw-image');
            if (nsfwImg && previewArea.contains(nsfwImg)) {
                e.preventDefault(); e.stopPropagation();
                var r = nsfwImg.classList.toggle('revealed');
                nsfwImg.setAttribute('aria-pressed', String(r));
                return;
            }
            var nsfwTag = e.target.closest('.nsfw-tag');
            if (nsfwTag && previewArea.contains(nsfwTag)) {
                e.preventDefault(); e.stopPropagation();
                handlePreviewNSFWToggle(nsfwTag);
                return;
            }
            var qe = e.target.closest('.quote-expand-btn');
            if (qe && previewArea.contains(qe)) { e.preventDefault(); handlePreviewQuoteExpand(qe); return; }
            var ce = e.target.closest('.code-expand-btn');
            if (ce && previewArea.contains(ce)) { e.preventDefault(); handlePreviewCodeExpand(ce); return; }
            var cc = e.target.closest('.code-copy-btn');
            if (cc && previewArea.contains(cc)) { e.preventDefault(); handlePreviewCodeCopy(cc); return; }
            var sh = e.target.closest('.spoiler-header');
            if (sh && previewArea.contains(sh)) { e.preventDefault(); handlePreviewSpoilerToggle(sh); return; }
        });
        previewArea.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            var nsfwImg = e.target.closest('.nsfw-image');
            if (nsfwImg && previewArea.contains(nsfwImg)) {
                e.preventDefault();
                var r = nsfwImg.classList.toggle('revealed');
                nsfwImg.setAttribute('aria-pressed', String(r));
                return;
            }
            var nsfwTag = e.target.closest('.nsfw-tag');
            if (nsfwTag && previewArea.contains(nsfwTag)) {
                e.preventDefault();
                handlePreviewNSFWToggle(nsfwTag);
                return;
            }
            var sh = e.target.closest('.spoiler-header');
            if (sh && previewArea.contains(sh)) { e.preventDefault(); handlePreviewSpoilerToggle(sh); }
        });
    }

    function initPreviewQuotesAndSpoilers(previewArea) {
        var checkQuoteOverflow = function (quote) {
            var content = quote.querySelector('.quote-content');
            var expandBtn = quote.querySelector('.quote-expand-btn');
            if (!content || !expandBtn) return;
            var maxH = parseFloat(getComputedStyle(content).maxHeight);
            if (isNaN(maxH)) return;
            var actualH = content.getBoundingClientRect().height;
            var tallImg = false;
            content.querySelectorAll('img').forEach(function (img) {
                if (img.getBoundingClientRect().height > maxH + 2) tallImg = true;
            });
            var overflows = (content.scrollHeight > maxH + 2) || (actualH > maxH + 2) || tallImg;
            if (!overflows) {
                expandBtn.remove();
                quote.classList.remove('long-quote');
            }
        };
        previewArea.querySelectorAll('.modern-quote.long-quote').forEach(function (quote) {
            var content = quote.querySelector('.quote-content');
            if (!content) return;
            var imgs = content.querySelectorAll('img');
            if (imgs.length === 0) {
                checkQuoteOverflow(quote);
            } else {
                var pending = imgs.length;
                var onLoadOrError = function () {
                    pending--;
                    if (pending === 0) requestAnimationFrame(function () { setTimeout(function () { checkQuoteOverflow(quote); }, 50); });
                };
                imgs.forEach(function (img) {
                    if (img.complete && img.naturalHeight !== 0) onLoadOrError();
                    else { img.addEventListener('load', onLoadOrError); img.addEventListener('error', onLoadOrError); }
                });
            }
        });
        requestAnimationFrame(function () {
            previewArea.querySelectorAll('.modern-code').forEach(function (block) {
                var content = block.querySelector('.code-content.collapsible-content');
                var expandBtn = block.querySelector('.code-expand-btn');
                if (!content || !expandBtn) return;
                var maxH = parseFloat(getComputedStyle(content).maxHeight);
                if (isNaN(maxH)) return;
                if (content.scrollHeight <= maxH + 2) {
                    content.classList.remove('collapsible-content');
                    expandBtn.remove();
                }
            });
        });
    }

    // ========================================================================
    // MODALS
    // ========================================================================
    function makeModalShell(width) {
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
        var box = document.createElement('div');
        box.className = 'modern-modal-box';
        box.style.cssText = 'background:var(--surface-color);border-radius:var(--radius-lg);padding:var(--space-lg);width:' + (width || 360) + 'px;max-width:90%;box-shadow:var(--shadow-lg);';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        return { overlay: overlay, box: box };
    }

    function showInputModal(title, placeholder, icon, callback, editorRef) {
        var m = makeModalShell(340);
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-md) 0;"><i class="fa-regular ' + escapeHtml(icon || 'fa-image') + '" aria-hidden="true"></i> ' + escapeHtml(title) + '</h3>' +
            '<input type="url" id="modal-input" class="modern-input" placeholder="' + escapeHtml(placeholder) + '" style="width:100%;">' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">Insert</button>' +
            '</div>';
        var input = m.box.querySelector('#modal-input');
        input.focus();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = function () { var v = input.value.trim(); if (v) callback(v); close(); };
        input.addEventListener('keypress', function (e) { if (e.key === 'Enter') m.box.querySelector('#modal-submit').click(); });
    }

    function showSpoilerTitleModal(initial, callback, editorRef) {
        var m = makeModalShell(360);
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-eye-slash"></i> Spoiler title</h3>' +
            '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Optional. Leave empty for a plain spoiler.</p>' +
            '<input type="text" id="m-sp" class="modern-input" placeholder="e.g. Route: Lily - Chapter 5" maxlength="80" style="width:100%;" value="' + escapeHtml(initial || '') + '">' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">Save</button>' +
            '</div>';
        var input = m.box.querySelector('#m-sp');
        input.focus(); input.select();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        function submit() { var v = input.value.trim().replace(/[{}]/g, '').replace(/[\r\n]+/g, ' ').trim(); callback(v); close(); }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = submit;
        input.addEventListener('keypress', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }

    var CODE_LANG_SUGGESTIONS = [
        "Ren'Py", 'Python', 'JavaScript', 'TypeScript', 'Lua', 'HTML', 'CSS', 'JSON', 'XML', 'YAML',
        'SQL', 'Bash', 'Shell', 'PowerShell', 'C', 'C++', 'C#', 'Java', 'Kotlin', 'Rust', 'Go',
        'Ruby', 'PHP', 'Swift', 'Markdown', 'Plain text'
    ];

    function showCodeLangModal(initial, callback, editorRef) {
        var m = makeModalShell(360);
        var opts = CODE_LANG_SUGGESTIONS.map(function (l) { return '<option value="' + escapeHtml(l) + '"></option>'; }).join('');
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-code"></i> Code language</h3>' +
            '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Optional. Shown on the code block header.</p>' +
            '<input type="text" id="m-cl" class="modern-input" list="m-cl-l" placeholder="e.g. Python, Ren\'Py" maxlength="40" style="width:100%;" value="' + escapeHtml(initial || '') + '">' +
            '<datalist id="m-cl-l">' + opts + '</datalist>' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">Save</button>' +
            '</div>';
        var input = m.box.querySelector('#m-cl');
        input.focus(); input.select();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        function submit() { var v = input.value.trim().replace(/[\r\n]+/g, ' ').trim(); callback(v); close(); }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = submit;
        input.addEventListener('keypress', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }

    function showLinkModal(initialHref, callback, editorRef) {
        var m = makeModalShell(360);
        var isEdit = initialHref != null;
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-md) 0;"><i class="fa-regular fa-link"></i> ' + (isEdit ? 'Edit link' : 'Insert link') + '</h3>' +
            (isEdit ? '' : '<div style="margin-bottom:var(--space-md);"><label style="display:block;margin-bottom:var(--space-xs);color:var(--text-secondary);">Link text (optional)</label><input type="text" id="m-lt" class="modern-input" placeholder="Enter text to display" style="width:100%;"></div>') +
            '<div style="margin-bottom:var(--space-md);"><label style="display:block;margin-bottom:var(--space-xs);color:var(--text-secondary);">URL</label><input type="url" id="m-lu" class="modern-input" placeholder="https://example.com" style="width:100%;" value="' + escapeHtml(initialHref || '') + '"></div>' +
            '<div style="display:flex;gap:var(--space-sm);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">' + (isEdit ? 'Save' : 'Insert link') + '</button>' +
            '</div>';
        var textInput = m.box.querySelector('#m-lt');
        var urlInput = m.box.querySelector('#m-lu');
        urlInput.focus(); if (isEdit) urlInput.select();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = function () {
            var lt = textInput ? textInput.value.trim() : '';
            var lu = urlInput.value.trim();
            if (lu) callback(lu, lt || null);
            close();
        };
        if (textInput) textInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') m.box.querySelector('#modal-submit').click(); });
        urlInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') m.box.querySelector('#modal-submit').click(); });
    }

    function showImageEditModal(initialAlt, initialSize, callback, editorRef) {
        var m = makeModalShell(380);
        var sizes = [
            { value: 'small', label: 'Small (25%)' },
            { value: 'medium', label: 'Medium (50%)' },
            { value: 'large', label: 'Large (75%)' },
            { value: '', label: 'Full width' }
        ];
        var sizeHtml = sizes.map(function (s) {
            var checked = (initialSize || '') === s.value ? ' checked' : '';
            return '<label class="modern-radio" style="margin-right:var(--space-md);margin-bottom:var(--space-xs);"><input type="radio" name="m-size" value="' + s.value + '"' + checked + '><span>' + s.label + '</span></label>';
        }).join('');
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-image"></i> Edit image</h3>' +
            '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Describe the image for accessibility, and optionally resize it.</p>' +
            '<div style="margin-bottom:var(--space-md);"><label style="display:block;font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-xs);">Alt text</label><input type="text" id="m-alt" class="modern-input" placeholder="Describe this image" maxlength="200" style="width:100%;" value="' + escapeHtml(initialAlt || '') + '"></div>' +
            '<div style="margin-bottom:var(--space-md);"><label style="display:block;font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-xs);">Display size</label><div style="display:flex;flex-wrap:wrap;gap:var(--space-sm);">' + sizeHtml + '</div></div>' +
            '<div style="display:flex;gap:var(--space-sm);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">Save</button>' +
            '</div>';
        var altInput = m.box.querySelector('#m-alt');
        altInput.focus(); altInput.select();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = function () {
            var c = m.box.querySelector('input[name="m-size"]:checked');
            var size = c ? c.value : '';
            callback(altInput.value.trim(), size || null);
            close();
        };
    }

    // ========================================================================
    // EMOJI DATA
    // ========================================================================
    var EMOJI_GROUPS = [
        { name: 'Emojis', emojis: [
            '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','🥲','😏','😋','😛',
            '😜','🤪','😝','🤗','🤭','🤫','🤔','🤤','🥳','😎','🤓','🧐','🙃','🤐','🤨','😒','🙄','😬','😌','😔',
            '😪','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','😕','😟','🙁','😮','😲','😳','🥺','😨',
            '😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👋',
            '👌','👍','👎','✊','👏','🙏','💪','👀','🤦','🤷','🎉','❤️','💔','🔥','💯','💥'
        ] }
    ];

    var EMOJI_NAME_MAP = {
        smile:'🙂', joy:'😂', lol:'😆', wink:'😉', thinking:'🤔', cry:'😢', sweat:'😅',
        eyeroll:'🙄', eyebrow:'🤨', facepalm:'🤦', hearteyes:'😍', party:'🥳', frown:'🙁',
        heart:'❤️', fire:'🔥', hundred:'💯', eyes:'👀', skull:'💀', thumbsup:'👍',
        thumbsdown:'👎', clap:'👏', wave:'👋', pray:'🙏'
    };

    var EMOJI_RECENTS_KEY = 'editor-emoji-recents-v1';
    var EMOJI_RECENTS_MAX = 16;

    function loadEmojiRecents() {
        try { var r = localStorage.getItem(EMOJI_RECENTS_KEY); if (!r) return []; var a = JSON.parse(r); return Array.isArray(a) ? a : []; }
        catch (e) { return []; }
    }

    function saveEmojiRecents(arr) {
        try { localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(arr.slice(0, EMOJI_RECENTS_MAX))); } catch (e) {}
    }

    function pushEmojiRecent(e) {
        var r = loadEmojiRecents(); var i = r.indexOf(e);
        if (i !== -1) r.splice(i, 1);
        r.unshift(e); saveEmojiRecents(r);
    }

    function emojiToCodePoint(emoji) {
        var cps = Array.from(emoji).map(function (ch) { return ch.codePointAt(0).toString(16); });
        return cps.filter(function (c) { return c !== 'fe0f'; }).join('-');
    }

    // ========================================================================
    // ASCII EMOTICON MAP
    // ========================================================================
    var ASCII_EMOTICON_MAP = {
        '*\\0/*':'1f646','*\\O/*':'1f646','-___-':'1f611',":'-)":'1f602',"':-)":'1f605',"':-D":'1f605',
        ':-D':'1f603',":')":'1f602',":-)":'1f642',"(:":'1f643',";)":'1f609',':P':'1f61b',':D':'1f603',
        ':)':'1f642',':(':'1f61e','<3':'2764','(y)':'1f44d',"B-)":'1f60e','-_-':'1f611'
    };

    // ========================================================================
    // TIPTAP DEPS
    // ========================================================================
    async function loadTipTapDeps() {
        const core = await import('https://esm.sh/@tiptap/core@2.5.2');
        const Editor = core.Editor || (core.default && core.default.Editor);
        const Node = core.Node || (core.default && core.default.Node);
        const Mark = core.Mark || (core.default && core.default.Mark);
        const Extension = core.Extension || (core.default && core.default.Extension);
        const InputRule = core.InputRule || (core.default && core.default.InputRule);
        if (!Editor || !Node || !Mark || !Extension || !InputRule) throw new Error('TipTap core missing');

        const { Plugin, PluginKey, TextSelection, NodeSelection } = await import('https://esm.sh/prosemirror-state@1.4.3');
        const { Decoration, DecorationSet } = await import('https://esm.sh/prosemirror-view@1.33.0');

        const sk = await import('https://esm.sh/@tiptap/starter-kit@2.5.2');
        const ph = await import('https://esm.sh/@tiptap/extension-placeholder@2.5.2');
        const ul = await import('https://esm.sh/@tiptap/extension-underline@2.5.2');
        const im = await import('https://esm.sh/@tiptap/extension-image@2.5.2');
        const lk = await import('https://esm.sh/@tiptap/extension-link@2.5.2');
        const mn = await import('https://esm.sh/@tiptap/extension-mention@2.5.2');
        const cbl = await import('https://esm.sh/@tiptap/extension-code-block-lowlight@2.5.2');
        const lh = await import('https://esm.sh/lowlight@3');
        const ccl = await import('https://esm.sh/@tiptap/extension-character-count@2.5.2');
        const typo = await import('https://esm.sh/@tiptap/extension-typography@2.5.2');

        return {
            Editor, Node, Mark, Extension, InputRule,
            Plugin, PluginKey, TextSelection, NodeSelection,
            Decoration, DecorationSet,
            StarterKit: sk.StarterKit || (sk.default && sk.default.StarterKit),
            Placeholder: ph.Placeholder || (ph.default && ph.default.Placeholder),
            Underline: ul.Underline || (ul.default && ul.default.Underline),
            BaseImage: im.Image || (im.default && im.default.Image),
            Link: lk.Link || (lk.default && lk.default.Link),
            Mention: mn.Mention || (mn.default && mn.default.Mention),
            CodeBlockLowlight: cbl.CodeBlockLowlight || (cbl.default && cbl.default.CodeBlockLowlight),
            createLowlight: lh.createLowlight,
            common: lh.common,
            CharacterCount: ccl.CharacterCount || (ccl.default && ccl.default.CharacterCount),
            Typography: typo.Typography || (typo.default && typo.default.Typography)
        };
    }

    // ========================================================================
    // EDITOR FACTORY
    // ========================================================================
    async function buildEditorInto(host, opts) {
        var editorRef = { current: null };
        var deps = await loadTipTapDeps();
        var {
            Editor, Node, Extension, Mark,
            Plugin, PluginKey, TextSelection, NodeSelection,
            Decoration, DecorationSet,
            StarterKit, Placeholder, Underline, BaseImage, Link,
            Mention, CodeBlockLowlight, createLowlight, common,
            CharacterCount, Typography, InputRule
        } = deps;

        var lowlight = createLowlight(common);

        // ---- Replying-as header ----
        var syncUser = getCurrentUserSync();
        var currentHeader = null;
        if (syncUser) {
            currentHeader = buildUserHeader(syncUser, opts.headerLabel || 'Replying as:');
            if (currentHeader) host.appendChild(currentHeader);
        }

        fetchCurrentUserData().then(function (user) {
            if (!user) return;
            var newHeader = buildUserHeader(user, opts.headerLabel || 'Replying as:');
            if (!newHeader) return;

            if (currentHeader && currentHeader.parentNode) {
                currentHeader.parentNode.replaceChild(newHeader, currentHeader);
            } else if (host.firstChild) {
                host.insertBefore(newHeader, host.firstChild);
            } else {
                host.appendChild(newHeader);
            }
            currentHeader = newHeader;
            attachProfileTip(currentHeader, user);
        });

        // ---- Toolbar ----
        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Formatting');
        host.appendChild(toolbar);

        // ---- Editor mount ----
        var editorEl = document.createElement('div');
        editorEl.id = 'tiptap-editor-' + Math.random().toString(36).slice(2, 9);
        editorEl.className = 'modern-wysiwyg';
        host.appendChild(editorEl);

        // ---- Preview ----
        var previewArea = document.createElement('div');
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<h3 class="modern-preview-title"><i class="fa-regular fa-eye"></i> Preview</h3><div class="preview-content"></div>';
        host.appendChild(previewArea);
        attachPreviewHandlers(previewArea);

        // ---- Actions ----
        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        var cancelBtnHtml = opts.onCancel ? '<button type="button" class="modern-btn modern-btn-secondary modern-editor-cancel"><i class="fa-regular fa-xmark"></i> Cancel</button>' : '';
        actions.innerHTML = cancelBtnHtml +
            '<button type="button" class="modern-btn modern-btn-secondary modern-editor-preview-btn"><i class="fa-regular fa-eye"></i> Preview</button>' +
            '<button type="button" class="modern-btn modern-btn-primary modern-editor-submit-btn" aria-keyshortcuts="Control+Enter"><i class="fa-regular fa-floppy-disk"></i> ' + escapeHtml(opts.submitLabel || 'Submit') + '</button>';
        host.appendChild(actions);

        var submitBtn = actions.querySelector('.modern-editor-submit-btn');
        var previewBtn = actions.querySelector('.modern-editor-preview-btn');
        var cancelBtn = actions.querySelector('.modern-editor-cancel');

        var livePreviewTimer = null;

        // ---- Helpers ----
        function addSep() {
            var s = document.createElement('span');
            s.className = 'toolbar-separator';
            s.setAttribute('aria-hidden', 'true');
            s.style.cssText = 'width:1px;height:1.5rem;background:var(--border-color);margin:0 var(--space-sm);display:inline-block;vertical-align:middle;';
            toolbar.appendChild(s);
        }

        function mkBtn(icon, label, shortcut) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'modern-editor-btn';
            b.innerHTML = '<i class="' + icon + '"></i>';
            b.title = label;
            b.setAttribute('aria-label', label);
            if (shortcut) b.setAttribute('aria-keyshortcuts', shortcut);
            toolbar.appendChild(b);
            return b;
        }

        function exec(cmd) { if (!editorRef.current) return; cmd(); editorRef.current.commands.focus(); }

        var _backdrop = null;
        var _mobileMode = window.matchMedia('(max-width: 680px)').matches;

        function isMobile() { return window.matchMedia('(max-width: 680px)').matches; }

        function ensureBackdrop() {
            if (!_backdrop) {
                _backdrop = document.createElement('div');
                _backdrop.className = 'modern-dropdown-backdrop';
                _backdrop.addEventListener('click', closeAllPopovers);
                document.body.appendChild(_backdrop);
            }
            return _backdrop;
        }

        function positionMenu(btn, menu) {
            menu.style.left = ''; menu.style.right = ''; menu.style.top = ''; menu.style.bottom = '';
            menu.style.maxWidth = ''; menu.style.maxHeight = ''; menu.style.overflowY = '';
            var br = btn.getBoundingClientRect();
            var mr = menu.getBoundingClientRect();
            var vw = window.innerWidth, vh = window.innerHeight, m = 8;
            var sr = vw - br.left - m, sl = br.right - m;
            if (mr.width <= sr) { menu.style.left = '0'; menu.style.right = 'auto'; }
            else if (mr.width <= sl) { menu.style.left = 'auto'; menu.style.right = '0'; }
            else { menu.style.left = '0'; menu.style.right = 'auto'; menu.style.maxWidth = Math.max(120, sr) + 'px'; }
            var sb = vh - br.bottom - m, sa = br.top - m;
            if (mr.height <= sb) { menu.style.top = '100%'; menu.style.bottom = 'auto'; }
            else if (mr.height <= sa) { menu.style.top = 'auto'; menu.style.bottom = '100%'; }
            else { menu.style.top = '100%'; menu.style.bottom = 'auto'; menu.style.maxHeight = Math.max(120, sb) + 'px'; menu.style.overflowY = 'auto'; }
        }

        function openMenu(btn, menu) {
            if (isMobile()) {
                menu.classList.add('is-open', 'is-sheet'); menu.style.display = 'block';
                if (btn) btn.setAttribute('aria-expanded', 'true');
                ensureBackdrop().classList.add('is-active');
                document.body.classList.add('dropdown-sheet-open');
                return;
            }
            menu.classList.remove('is-sheet'); menu.classList.add('is-open'); menu.style.display = 'block';
            if (btn) btn.setAttribute('aria-expanded', 'true');
            positionMenu(btn, menu);
        }

        function closeMenu(btn, menu) {
            if (!menu) return;
            menu.classList.remove('is-open', 'is-sheet');
            menu.style.display = 'none';
            menu.style.left = ''; menu.style.right = ''; menu.style.top = ''; menu.style.bottom = '';
            menu.style.maxWidth = ''; menu.style.maxHeight = ''; menu.style.overflowY = '';
            if (btn) btn.setAttribute('aria-expanded', 'false');
            if (_backdrop) _backdrop.classList.remove('is-active');
            document.body.classList.remove('dropdown-sheet-open');
        }

        function closeAllPopovers() {
            document.querySelectorAll('.modern-dropdown-menu').forEach(function (m) {
                m.classList.remove('is-open', 'is-sheet'); m.style.display = 'none';
            });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
            if (emojiPanel) { emojiPanel.classList.remove('is-open', 'is-sheet'); emojiPanel.style.display = 'none'; }
            if (_backdrop) _backdrop.classList.remove('is-active');
            document.body.classList.remove('dropdown-sheet-open');
        }

        addGlobalListener(document, 'click', closeAllPopovers);
        addGlobalListener(document, 'keydown', function (e) { if (e.key === 'Escape') closeAllPopovers(); });
        addGlobalListener(window, 'resize', function () {
            var nowMobile = isMobile();
            if (nowMobile !== _mobileMode) { _mobileMode = nowMobile; closeAllPopovers(); }
        });

        // ---- Lite-embed helpers ----
        function focusTrailingEmbedParagraph() {
            if (!editorRef.current) return;
            var doc = editorRef.current.state.doc;
            if (doc.childCount < 2) return;
            var last = doc.child(doc.childCount - 1);
            var secondLast = doc.child(doc.childCount - 2);
            if (last.type.name !== 'paragraph' || last.content.size !== 0) return;
            var atomName = secondLast.type.name;
            if (atomName !== 'liteYouTube' && atomName !== 'liteVimeo' && atomName !== 'imageUploadPlaceholder') return;
            editorRef.current.chain().focus().setTextSelection(doc.content.size - 1).run();
        }

        function fetchEmbedMetadata(kind, videoid) {
            if (!editorRef.current || !videoid) return;
            var canonicalUrl = kind === 'liteYouTube'
                ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoid)
                : 'https://vimeo.com/' + encodeURIComponent(videoid);

            fetchWithTimeout(OG_WORKER_URL + encodeURIComponent(canonicalUrl), {}, OG_FETCH_TIMEOUT)
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    if (!data || data.error || !data.title) return;
                    if (!editorRef.current) return;
                    var positions = [];
                    editorRef.current.state.doc.descendants(function (node, pos) {
                        if (node.type.name === kind && node.attrs.videoid === videoid && !node.attrs.title) {
                            positions.push(pos);
                        }
                        return true;
                    });
                    if (positions.length === 0) return;
                    var tr = editorRef.current.state.tr;
                    for (var i = 0; i < positions.length; i++) {
                        var pos = positions[i];
                        var node = tr.doc.nodeAt(pos);
                        if (!node) continue;
                        tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, {
                            title: data.title || '',
                            author: data.author || '',
                        }));
                    }
                    editorRef.current.view.dispatch(tr);
                })
                .catch(function () {});
        }

        function insertLiteEmbed(kind, videoid, embedOpts) {
            if (!editorRef.current) return;
            embedOpts = embedOpts || {};
            var attrs = { videoid: videoid };
            if (embedOpts.start != null) attrs.start = String(embedOpts.start);
            if (embedOpts.end != null) attrs.end = String(embedOpts.end);
            editorRef.current.chain().focus().insertContent({ type: kind, attrs: attrs }).run();
            focusTrailingEmbedParagraph();
            fetchEmbedMetadata(kind, videoid);
        }

        // ---- Live preview ----
        function updateLivePreview() {
            if (!editorRef.current || editorContentIsEmpty(editorRef.current.getHTML())) return;

            var hasPlaceholder = false;
            editorRef.current.state.doc.content.content.some(function (child) {
                if (child.type.name === 'imageUploadPlaceholder') {
                    hasPlaceholder = true;
                    return true;
                }
                return false;
            });
            if (hasPlaceholder) return;

            if (!previewArea || previewArea.style.display === 'none') return;

            var previewHtml = transformPreviewHtml(editorRef.current.getHTML());
            var previewContent = previewArea.querySelector('.preview-content');
            if (previewContent) {
                previewContent.innerHTML = previewHtml;
                if (window.twemoji) {
                    window.twemoji.parse(previewContent, { base: TWEMOJI_BASE, ext: '.svg' });
                }
            }
            initPreviewQuotesAndSpoilers(previewArea);
        }

        function scheduleLivePreviewRefresh() {
            if (!previewArea || previewArea.style.display === 'none') return;
            if (livePreviewTimer) clearTimeout(livePreviewTimer);
            livePreviewTimer = setTimeout(function () {
                livePreviewTimer = null;
                updateLivePreview();
            }, CONFIG.LIVE_PREVIEW_DEBOUNCE_MS);
        }

        // ---- Toolbar buttons ----
        var undoBtn = mkBtn('fa-regular fa-undo', 'Undo', 'Control+Z');
        var redoBtn = mkBtn('fa-regular fa-redo', 'Redo', 'Control+Shift+Z');
        undoBtn.disabled = true; redoBtn.disabled = true;
        addSep();

        var boldBtn      = mkBtn('fa-regular fa-bold', 'Bold', 'Control+B');
        var italicBtn    = mkBtn('fa-regular fa-italic', 'Italic', 'Control+I');
        var underlineBtn = mkBtn('fa-regular fa-underline', 'Underline', 'Control+U');
        var strikeBtn    = mkBtn('fa-regular fa-strikethrough', 'Strikethrough');

        // Color dropdown
        var colorDrop = document.createElement('div');
        colorDrop.className = 'modern-dropdown';
        colorDrop.style.cssText = 'position:relative;display:inline-block';
        var colorBtn = document.createElement('button');
        colorBtn.type = 'button'; colorBtn.className = 'modern-editor-btn';
        colorBtn.innerHTML = '<i class="fa-regular fa-palette"></i>';
        colorBtn.title = 'Text color'; colorBtn.setAttribute('aria-label', 'Text color');
        colorBtn.setAttribute('aria-haspopup', 'menu'); colorBtn.setAttribute('aria-expanded', 'false');
        var colorMenu = document.createElement('div');
        colorMenu.className = 'modern-dropdown-menu'; colorMenu.setAttribute('role', 'menu');
        colorMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:180px;display:none;';
        colorMenu.innerHTML =
            '<button class="modern-dropdown-item" role="menuitem" data-color="primary"><span class="color-swatch color-swatch--primary"></span> Primary</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="info"><span class="color-swatch color-swatch--info"></span> Info</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="accent"><span class="color-swatch color-swatch--accent"></span> Accent</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="warning"><span class="color-swatch color-swatch--warning"></span> Warning</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="danger"><span class="color-swatch color-swatch--danger"></span> Danger</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="muted"><span class="color-swatch color-swatch--muted"></span> Muted</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="remove"><i class="fa-regular fa-eraser" aria-hidden="true"></i> Remove color</button>';
        colorDrop.appendChild(colorBtn); colorDrop.appendChild(colorMenu);
        toolbar.appendChild(colorDrop);
        colorBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = colorMenu.classList.contains('is-open');
            closeAllPopovers();
            if (!wasOpen) openMenu(colorBtn, colorMenu);
        };
        colorMenu.addEventListener('click', function (e) { e.stopPropagation(); });
        colorMenu.querySelectorAll('[data-color]').forEach(function (b) {
            b.onclick = function () {
                if (!editorRef.current) return;
                var v = b.getAttribute('data-color');
                if (v === 'remove') editorRef.current.chain().focus().unsetMark('semanticColor').run();
                else editorRef.current.chain().focus().setMark('semanticColor', { variant: v }).run();
                closeMenu(colorBtn, colorMenu);
            };
        });

        var clearFormatBtn = mkBtn('fa-regular fa-remove-format', 'Clear formatting');
        addSep();

        // Heading dropdown
        var headDrop = document.createElement('div');
        headDrop.className = 'modern-dropdown'; headDrop.style.cssText = 'position:relative;display:inline-block';
        var headBtn = document.createElement('button');
        headBtn.type = 'button'; headBtn.className = 'modern-editor-btn';
        headBtn.innerHTML = '<i class="fa-regular fa-heading"></i>';
        headBtn.title = 'Heading'; headBtn.setAttribute('aria-label', 'Heading');
        headBtn.setAttribute('aria-haspopup', 'menu'); headBtn.setAttribute('aria-expanded', 'false');
        var headMenu = document.createElement('div');
        headMenu.className = 'modern-dropdown-menu'; headMenu.setAttribute('role', 'menu');
        headMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        headMenu.innerHTML =
            '<button class="modern-dropdown-item" role="menuitem" data-level="1">Heading 1</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-level="2">Heading 2</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-level="3">Heading 3</button>';
        headDrop.appendChild(headBtn); headDrop.appendChild(headMenu);
        toolbar.appendChild(headDrop);
        headBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = headMenu.classList.contains('is-open');
            closeAllPopovers();
            if (!wasOpen) openMenu(headBtn, headMenu);
        };
        headMenu.addEventListener('click', function (e) { e.stopPropagation(); });
        var headingButtons = { h1: headMenu.querySelector('[data-level="1"]'), h2: headMenu.querySelector('[data-level="2"]'), h3: headMenu.querySelector('[data-level="3"]') };

        // List dropdown
        var listDrop = document.createElement('div');
        listDrop.className = 'modern-dropdown'; listDrop.style.cssText = 'position:relative;display:inline-block';
        var listBtn = document.createElement('button');
        listBtn.type = 'button'; listBtn.className = 'modern-editor-btn';
        listBtn.innerHTML = '<i class="fa-regular fa-list"></i>';
        listBtn.title = 'Insert list'; listBtn.setAttribute('aria-label', 'Insert list');
        listBtn.setAttribute('aria-haspopup', 'menu'); listBtn.setAttribute('aria-expanded', 'false');
        var listMenu = document.createElement('div');
        listMenu.className = 'modern-dropdown-menu'; listMenu.setAttribute('role', 'menu');
        listMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        listMenu.innerHTML =
            '<button class="modern-dropdown-item" role="menuitem" id="bullet-list-option"><i class="fa-regular fa-list"></i> Bullet list</button>' +
            '<button class="modern-dropdown-item" role="menuitem" id="ordered-list-option"><i class="fa-regular fa-list-ol"></i> Ordered list</button>';
        listDrop.appendChild(listBtn); listDrop.appendChild(listMenu);
        toolbar.appendChild(listDrop);
        listBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = listMenu.classList.contains('is-open');
            closeAllPopovers();
            if (!wasOpen) openMenu(listBtn, listMenu);
        };
        listMenu.addEventListener('click', function (e) { e.stopPropagation(); });

        var blockquoteBtn = mkBtn('fa-regular fa-quote-left', 'Blockquote');

        // Code dropdown
        var codeDrop = document.createElement('div');
        codeDrop.className = 'modern-dropdown'; codeDrop.style.cssText = 'position:relative;display:inline-block';
        var codeBtn = document.createElement('button');
        codeBtn.type = 'button'; codeBtn.className = 'modern-editor-btn';
        codeBtn.innerHTML = '<i class="fa-regular fa-code"></i>';
        codeBtn.title = 'Code'; codeBtn.setAttribute('aria-label', 'Code');
        codeBtn.setAttribute('aria-haspopup', 'menu'); codeBtn.setAttribute('aria-expanded', 'false');
        var codeMenu = document.createElement('div');
        codeMenu.className = 'modern-dropdown-menu'; codeMenu.setAttribute('role', 'menu');
        codeMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:180px;display:none;';
        codeMenu.innerHTML =
            '<button class="modern-dropdown-item" role="menuitem" id="inline-code-option"><i class="fa-regular fa-code" aria-hidden="true"></i> Inline code</button>' +
            '<button class="modern-dropdown-item" role="menuitem" id="block-code-option"><i class="fa-regular fa-file-code" aria-hidden="true"></i> Code block</button>';
        codeDrop.appendChild(codeBtn); codeDrop.appendChild(codeMenu);
        toolbar.appendChild(codeDrop);
        codeBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = codeMenu.classList.contains('is-open');
            closeAllPopovers();
            if (!wasOpen) openMenu(codeBtn, codeMenu);
        };
        codeMenu.addEventListener('click', function (e) { e.stopPropagation(); });

        codeMenu.querySelector('#inline-code-option').onclick = function () {
            if (!editorRef.current) return;
            exec(function () { editorRef.current.chain().focus().toggleCode().run(); });
            closeMenu(codeBtn, codeMenu);
        };
        codeMenu.querySelector('#block-code-option').onclick = function () {
            if (!editorRef.current) return;
            closeMenu(codeBtn, codeMenu);
            if (editorRef.current.isActive('codeBlock')) {
                var lang = editorRef.current.getAttributes('codeBlock').language || '';
                showCodeLangModal(lang, function (l) {
                    editorRef.current.chain().focus().updateAttributes('codeBlock', { language: l || null }).run();
                }, editorRef.current);
                return;
            }
            showCodeLangModal('', function (l) {
                var chain = editorRef.current.chain().focus();
                if (l) chain.setCodeBlock({ language: l }).run();
                else chain.setCodeBlock().run();
            }, editorRef.current);
        };

        addSep();
        var linkBtn = mkBtn('fa-regular fa-link', 'Insert link', 'Control+K');
        var imageBtn = mkBtn('fa-regular fa-image', 'Insert image');
        addSep();
        var spoilerBtn = mkBtn('fa-regular fa-square-caret-down', 'Spoiler', 'Control+Shift+S');
        var nsfwBtn = mkBtn('fa-regular fa-eye-slash', 'NSFW (hidden content)', 'Control+Shift+N');

        // Emoji picker
        var emojiBtn = mkBtn('fa-regular fa-face-smile', 'Insert emoji');
        var emojiPanel = document.createElement('div');
        emojiPanel.className = 'modern-emoji-picker';
        emojiPanel.setAttribute('role', 'dialog');
        emojiPanel.setAttribute('aria-label', 'Emoji picker');
        emojiPanel.style.cssText = 'position:absolute;bottom:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius);padding:var(--space-sm);z-index:1000;display:none;grid-template-columns:repeat(8,1fr);gap:var(--space-xs);width:min(340px, calc(100vw - 2rem));max-height:280px;overflow-y:auto;';
        toolbar.style.position = 'relative';
        toolbar.appendChild(emojiPanel);

        function renderEmojiPicker() {
            emojiPanel.innerHTML = '';
            var recents = loadEmojiRecents();
            var allGroups = recents.length ? [{ name: 'Recently used', emojis: recents }].concat(EMOJI_GROUPS) : EMOJI_GROUPS;
            allGroups.forEach(function (group, gi) {
                if (gi > 0) {
                    var sep = document.createElement('div');
                    sep.className = 'emoji-group-separator';
                    emojiPanel.appendChild(sep);
                }
                var lbl = document.createElement('div');
                lbl.className = 'emoji-group-label';
                lbl.textContent = group.name;
                emojiPanel.appendChild(lbl);
                group.emojis.forEach(function (emoji) {
                    var item = document.createElement('button');
                    item.type = 'button'; item.className = 'modern-emoji-item';
                    item.setAttribute('data-emoji', emoji);
                    item.setAttribute('aria-label', emoji); item.title = emoji;
                    var img = document.createElement('img');
                    img.src = TWEMOJI_BASE + emojiToCodePoint(emoji) + '.svg';
                    img.alt = emoji;
                    img.style.width = '1.5rem'; img.style.height = '1.5rem';
                    img.onerror = function () { item.innerHTML = ''; item.textContent = emoji; item.style.fontSize = '1.5rem'; };
                    item.appendChild(img);
                    item.onclick = function (e) {
                        e.stopPropagation();
                        if (editorRef.current) {
                            editorRef.current.chain().focus().insertContent({
                                type: 'emoji',
                                attrs: { src: TWEMOJI_BASE + emojiToCodePoint(emoji) + '.svg', alt: emoji, loading: 'lazy', decoding: 'async', width: 24, height: 24 }
                            }).run();
                            pushEmojiRecent(emoji);
                        }
                        closeAllPopovers();
                    };
                    emojiPanel.appendChild(item);
                });
            });
        }

        emojiBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = emojiPanel.classList.contains('is-open');
            closeAllPopovers();
            if (wasOpen) return;
            renderEmojiPicker();
            if (isMobile()) {
                emojiPanel.classList.add('is-open', 'is-sheet');
                emojiPanel.style.display = 'grid';
                ensureBackdrop().classList.add('is-active');
                document.body.classList.add('dropdown-sheet-open');
            } else {
                emojiPanel.classList.add('is-open');
                emojiPanel.style.display = 'grid';
            }
        };
        emojiPanel.addEventListener('click', function (e) { e.stopPropagation(); });

        // Upload placeholder
        var _uploadRegistryLocal = new Map();
        function uploadImageToWorker(file) {
            if (!file || !editorRef.current) return;
            var id = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
            _uploadRegistryLocal.set(id, { file: file });
            editorRef.current.chain().focus().insertContent({
                type: 'imageUploadPlaceholder',
                attrs: { uploadId: id, filename: file.name || 'image', filesize: file.size || 0, progress: 0, status: 'uploading' }
            }).run();
        }

        imageBtn.onclick = function () {
            if (!editorRef.current) return;
            editorRef.current.chain().focus().insertContent({ type: 'imageUploadPlaceholder', attrs: { status: 'idle' } }).run();
        };

        linkBtn.onclick = function () {
            if (!editorRef.current) return;
            if (editorRef.current.isActive('link')) {
                var h = editorRef.current.getAttributes('link').href || '';
                showLinkModal(h, function (url) {
                    if (url) editorRef.current.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                }, editorRef.current);
                return;
            }
            var from = editorRef.current.state.selection.from;
            var to = editorRef.current.state.selection.to;
            var selText = editorRef.current.state.doc.textBetween(from, to, '');
            showLinkModal(null, function (url, custom) {
                if (selText) {
                    editorRef.current.chain().focus().setLink({ href: url }).run();
                } else {
                    var display = custom || url;
                    editorRef.current.chain().focus().insertContent(display).run();
                    var p = editorRef.current.state.selection.from;
                    var tl = display.length;
                    editorRef.current.chain().focus()
                        .setTextSelection({ from: p - tl, to: p })
                        .setLink({ href: url })
                        .setTextSelection(p).run();
                }
            }, editorRef.current);
        };

        spoilerBtn.onclick = function () {
            if (!editorRef.current) return;
            if (editorRef.current.isActive('spoiler')) {
                var t = editorRef.current.getAttributes('spoiler').title || '';
                showSpoilerTitleModal(t, function (title) {
                    editorRef.current.chain().focus().updateAttributes('spoiler', { title: title || null }).run();
                }, editorRef.current);
                return;
            }
            showSpoilerTitleModal('', function (title) {
                var chain = editorRef.current.chain().focus();
                if (title) chain.wrapIn('spoiler', { title: title }).run();
                else chain.wrapIn('spoiler').run();
            }, editorRef.current);
        };

        nsfwBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleNSFW().run(); }); };

        // Basic formatting
        undoBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().undo().run(); }); };
        redoBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().redo().run(); }); };
        clearFormatBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().unsetAllMarks().clearNodes().run(); }); };
        boldBtn.onclick      = function () { exec(function () { editorRef.current.chain().focus().toggleBold().run(); }); };
        italicBtn.onclick    = function () { exec(function () { editorRef.current.chain().focus().toggleItalic().run(); }); };
        underlineBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleUnderline().run(); }); };
        strikeBtn.onclick    = function () { exec(function () { editorRef.current.chain().focus().toggleStrike().run(); }); };
        headingButtons.h1.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleHeading({ level: 1 }).run(); }); closeMenu(headBtn, headMenu); };
        headingButtons.h2.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleHeading({ level: 2 }).run(); }); closeMenu(headBtn, headMenu); };
        headingButtons.h3.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleHeading({ level: 3 }).run(); }); closeMenu(headBtn, headMenu); };
        listMenu.querySelector('#bullet-list-option').onclick = function () { exec(function () { editorRef.current.chain().focus().toggleBulletList().run(); }); closeMenu(listBtn, listMenu); };
        listMenu.querySelector('#ordered-list-option').onclick = function () { exec(function () { editorRef.current.chain().focus().toggleOrderedList().run(); }); closeMenu(listBtn, listMenu); };
        blockquoteBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleBlockquote().run(); }); };

        // ---- Node definitions ----
        const ImageUploadPlaceholder = Node.create({
            name: 'imageUploadPlaceholder',
            group: 'block', atom: true, draggable: false, selectable: true,
            addAttributes() {
                return {
                    uploadId:     { default: null },
                    filename:     { default: '' },
                    filesize:     { default: 0 },
                    progress:     { default: 0 },
                    status:       { default: 'idle' },
                    errorMessage: { default: '' },
                };
            },
            parseHTML() { return []; },
            renderHTML({ node }) {
                return ['span', { class: 'ff-upload-placeholder-marker', 'data-upload-id': node.attrs.uploadId || '' }];
            },
            addNodeView() {
                return ({ node, editor, getPos }) => {
                    const dom = document.createElement('div');
                    dom.className = 'ff-upload-placeholder';
                    dom.setAttribute('contenteditable', 'false');

                    const dropzone = document.createElement('div');
                    dropzone.className = 'ff-upload-dropzone';
                    dropzone.innerHTML =
                        '<div class="ff-upload-dropzone-icon"><i class="fa-regular fa-cloud-arrow-up" aria-hidden="true"></i></div>' +
                        '<div class="ff-upload-dropzone-text">' +
                            '<div class="ff-upload-dropzone-primary"><em>Click to upload</em> or drag and drop</div>' +
                            '<div class="ff-upload-dropzone-secondary">or <button type="button" class="ff-upload-by-url">insert by URL</button></div>' +
                            '<div class="ff-upload-dropzone-hint">Max 32 MB per image</div>' +
                        '</div>' +
                        '<button type="button" class="ff-upload-btn is-danger ff-upload-dismiss-btn" aria-label="Remove"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button>';

                    const progress = document.createElement('div');
                    progress.className = 'ff-upload-progress';
                    progress.innerHTML =
                        '<div class="ff-upload-progress-track"><div class="ff-upload-progress-fill"></div></div>' +
                        '<div class="ff-upload-icon"><i class="fa-regular fa-cloud-arrow-up" aria-hidden="true"></i></div>' +
                        '<div class="ff-upload-info"><div class="ff-upload-filename"></div><div class="ff-upload-meta"></div></div>' +
                        '<div class="ff-upload-actions">' +
                            '<span class="ff-upload-percent">0%</span>' +
                            '<button type="button" class="ff-upload-btn ff-upload-retry-btn" hidden aria-label="Retry upload"><i class="fa-regular fa-arrow-rotate-right" aria-hidden="true"></i></button>' +
                            '<button type="button" class="ff-upload-btn is-danger ff-upload-cancel-btn" aria-label="Cancel upload"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button>' +
                        '</div>';

                    dom.appendChild(dropzone); dom.appendChild(progress);

                    const dismissBtn = dropzone.querySelector('.ff-upload-dismiss-btn');
                    const urlBtn = dropzone.querySelector('.ff-upload-by-url');
                    const filenameEl = progress.querySelector('.ff-upload-filename');
                    const metaEl = progress.querySelector('.ff-upload-meta');
                    const percentEl = progress.querySelector('.ff-upload-percent');
                    const fillEl = progress.querySelector('.ff-upload-progress-fill');
                    const retryBtn = progress.querySelector('.ff-upload-retry-btn');
                    const cancelBtn = progress.querySelector('.ff-upload-cancel-btn');
                    const cancelIcon = cancelBtn.querySelector('i');

                    let currentXhr = null;

                    function findSelf() {
                        const pos = getPos();
                        if (typeof pos !== 'number') return null;
                        const n = editor.state.doc.nodeAt(pos);
                        if (!n || n.type.name !== 'imageUploadPlaceholder') return null;
                        return { pos, node: n };
                    }
                    function patch(p) {
                        const s = findSelf(); if (!s) return;
                        editor.view.dispatch(editor.state.tr.setNodeMarkup(s.pos, undefined, Object.assign({}, s.node.attrs, p)));
                    }
                    function deleteSelf() {
                        const s = findSelf(); if (!s) return;
                        if (s.node.attrs.uploadId) _uploadRegistryLocal.delete(s.node.attrs.uploadId);
                        editor.view.dispatch(editor.state.tr.delete(s.pos, s.pos + s.node.nodeSize));
                    }
                    function replaceWithImage(attrs) {
                        const s = findSelf(); if (!s) return;
                        if (s.node.attrs.uploadId) _uploadRegistryLocal.delete(s.node.attrs.uploadId);
                        const img = editor.schema.nodes.image.create(attrs);
                        const p = editor.schema.nodes.paragraph.create(null, img);
                        const tr = editor.state.tr.replaceWith(s.pos, s.pos + s.node.nodeSize, p);
                        let np = s.pos;
                        while (np > 0) {
                            const prev = tr.doc.resolve(np).nodeBefore;
                            if (prev && prev.type.name === 'paragraph' && prev.content.size === 0) { tr.delete(np - prev.nodeSize, np); np -= prev.nodeSize; }
                            else break;
                        }
                        tr.setSelection(TextSelection.create(tr.doc, np + 2));
                        editor.view.dispatch(tr); editor.view.focus();
                    }

                    function render(n) {
                        const idle = n.attrs.status === 'idle';
                        dropzone.style.display = idle ? '' : 'none';
                        progress.style.display = idle ? 'none' : '';
                        dom.classList.toggle('is-idle', idle);
                        if (idle) return;
                        const failed = n.attrs.status === 'failed';
                        dom.classList.toggle('is-failed', failed);
                        filenameEl.textContent = n.attrs.filename || 'image';
                        metaEl.textContent = failed ? (n.attrs.errorMessage || 'Upload failed') : (formatBytes(n.attrs.filesize) + ' · Uploading…');
                        percentEl.textContent = failed ? '!' : n.attrs.progress + '%';
                        fillEl.style.width = (failed ? 100 : n.attrs.progress) + '%';
                        retryBtn.hidden = !failed || !n.attrs.uploadId;
                        cancelIcon.className = failed ? 'fa-regular fa-trash-can' : 'fa-regular fa-xmark';
                        cancelBtn.title = failed ? 'Remove' : 'Cancel upload';
                        cancelBtn.setAttribute('aria-label', failed ? 'Remove' : 'Cancel upload');
                    }

                    function startUpload() {
                        if (currentXhr) { try { currentXhr.abort(); } catch (e) {} currentXhr = null; }
                        const s = findSelf(); if (!s) return;
                        const uid = s.node.attrs.uploadId; if (!uid) return;
                        const entry = _uploadRegistryLocal.get(uid);
                        if (!entry || !entry.file) { patch({ status: 'failed', errorMessage: 'File no longer available' }); return; }

                        const xhr = new XMLHttpRequest();
                        currentXhr = xhr;
                        xhr.open('POST', UPLOAD_WORKER_URL);
                        xhr.upload.addEventListener('progress', function (e) {
                            if (!e.lengthComputable) return;
                            patch({ progress: Math.round(e.loaded / e.total * 100) });
                        });
                        xhr.addEventListener('load', function () {
                            currentXhr = null;
                            if (xhr.status < 200 || xhr.status >= 300) { patch({ status: 'failed', errorMessage: 'Server error (' + xhr.status + ')' }); return; }
                            let d;
                            try { d = JSON.parse(xhr.responseText); } catch (e) { patch({ status: 'failed', errorMessage: 'Invalid response' }); return; }
                            if (!d.url) { patch({ status: 'failed', errorMessage: 'No URL in response' }); return; }
                            replaceWithImage({ src: d.url, alt: entry.file.name || 'Uploaded image', loading: 'lazy', decoding: 'async', width: d.width ? parseInt(d.width, 10) : null, height: d.height ? parseInt(d.height, 10) : null });
                            showToast('Image uploaded', 'success');
                        });
                        xhr.addEventListener('error', function () { currentXhr = null; patch({ status: 'failed', errorMessage: 'Network error' }); });
                        const fd = new FormData(); fd.append('image', entry.file); xhr.send(fd);
                    }

                    function handleFile(file) {
                        if (file.size > MAX_UPLOAD_BYTES) {
                            patch({ status: 'failed', filename: file.name || 'image', filesize: file.size || 0, progress: 0, errorMessage: 'File exceeds 32 MB limit' });
                            return;
                        }
                        const uid = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
                        _uploadRegistryLocal.set(uid, { file: file });
                        patch({ uploadId: uid, filename: file.name || 'image', filesize: file.size || 0, progress: 0, status: 'uploading', errorMessage: '' });
                        startUpload();
                    }

                    function openPicker() {
                        const input = document.createElement('input');
                        input.type = 'file'; input.accept = 'image/*';
                        input.onchange = function () { if (input.files && input.files[0]) handleFile(input.files[0]); };
                        input.click();
                    }

                    dropzone.addEventListener('click', function (e) {
                        if (e.target.closest('.ff-upload-by-url')) return;
                        if (e.target.closest('.ff-upload-dismiss-btn')) return;
                        e.preventDefault(); e.stopPropagation(); openPicker();
                    });
                    urlBtn.addEventListener('click', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        showInputModal('Insert image URL', 'https://example.com/image.jpg', 'fa-image', function (url) {
                            const img = new Image();
                            img.onload = function () { replaceWithImage({ src: url, alt: 'image', loading: 'lazy', decoding: 'async', width: this.naturalWidth, height: this.naturalHeight }); };
                            img.onerror = function () { replaceWithImage({ src: url, alt: 'image', loading: 'lazy', decoding: 'async' }); };
                            img.src = url;
                        }, editorRef.current);
                    });
                    dismissBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); deleteSelf(); });
                    dropzone.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('is-dragover'); });
                    dropzone.addEventListener('dragleave', function (e) { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('is-dragover'); });
                    dropzone.addEventListener('drop', function (e) {
                        e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('is-dragover');
                        const files = e.dataTransfer && e.dataTransfer.files;
                        if (!files || !files.length) return;
                        const f = files[0];
                        if (!f.type || f.type.indexOf('image/') !== 0) return;
                        handleFile(f);
                    });
                    cancelBtn.addEventListener('click', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        if (currentXhr) { try { currentXhr.abort(); } catch (err) {} currentXhr = null; }
                        deleteSelf();
                    });
                    retryBtn.addEventListener('click', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        if (currentXhr) { try { currentXhr.abort(); } catch (err) {} currentXhr = null; }
                        patch({ status: 'uploading', progress: 0, errorMessage: '' }); startUpload();
                    });

                    render(node);
                    if (node.attrs.status === 'uploading') startUpload();

                    return {
                        dom,
                        update(u) { if (u.type.name !== 'imageUploadPlaceholder') return false; render(u); return true; },
                        destroy() {
                            if (currentXhr) { try { currentXhr.abort(); } catch (e) {} currentXhr = null; }
                            const s = findSelf();
                            if (s && s.node.attrs.uploadId) _uploadRegistryLocal.delete(s.node.attrs.uploadId);
                        },
                        stopEvent(e) {
                            const t = e.target;
                            if (!t || !t.closest) return false;
                            return !!t.closest('.ff-upload-dropzone, .ff-upload-progress, .ff-upload-btn, .ff-upload-by-url');
                        },
                        ignoreMutation() { return true; }
                    };
                };
            }
        });

        const Emoji = Node.create({
            name: 'emoji', inline: true, group: 'inline', atom: true,
            addAttributes() { return { src: { default: null }, alt: { default: '' }, loading: { default: 'lazy' }, decoding: { default: 'async' }, width: { default: 24 }, height: { default: 24 } }; },
            parseHTML() { return [{ tag: 'img[src*="twemoji"]' }]; },
            renderHTML({ node, HTMLAttributes }) {
                return ['img', Object.assign({}, HTMLAttributes, {
                    src: node.attrs.src, alt: node.attrs.alt,
                    loading: node.attrs.loading, decoding: node.attrs.decoding,
                    width: node.attrs.width, height: node.attrs.height,
                    class: 'twemoji'
                })];
            }
        });

        const CustomImage = BaseImage.extend({
            inline: true, group: 'inline', draggable: true, selectable: true,
            addAttributes() {
                return Object.assign({}, this.parent && this.parent(), {
                    src: { default: null },
                    alt: { default: 'image' },
                    width: { default: null }, height: { default: null },
                    loading: { default: 'lazy' }, decoding: { default: 'async' },
                    nsfw: {
                        default: false,
                        parseHTML: el => el.getAttribute('data-nsfw') === 'true',
                        renderHTML: a => a.nsfw ? { 'data-nsfw': 'true' } : {}
                    },
                    size: {
                        default: null,
                        parseHTML: el => el.getAttribute('data-size') || null,
                        renderHTML: a => a.size ? { 'data-size': a.size } : {}
                    }
                });
            },
            renderHTML({ node, HTMLAttributes }) {
                return ['img', Object.assign({}, HTMLAttributes, {
                    src: node.attrs.src, alt: node.attrs.alt,
                    loading: node.attrs.loading, decoding: node.attrs.decoding,
                    width: node.attrs.width, height: node.attrs.height
                })];
            }
        });

        const CustomCodeBlock = CodeBlockLowlight.extend({
            addAttributes() {
                return Object.assign({}, this.parent && this.parent(), {
                    language: {
                        default: null,
                        parseHTML: el => el.getAttribute('data-language') || null,
                        renderHTML: a => a.language ? { 'data-language': a.language } : {}
                    }
                });
            }
        }).configure({ lowlight });

        const emoticonPattern = Object.keys(ASCII_EMOTICON_MAP)
            .sort(function (a, b) { return b.length - a.length; })
            .map(function (e) { return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
            .join('|');
        const emoticonRegex = new RegExp('(?:^|\\s)(' + emoticonPattern + ')$');

        const EmoticonRule = Extension.create({
            name: 'emoticonRule',
            addInputRules() {
                return [new InputRule({
                    find: emoticonRegex,
                    handler: function ({ state, range, match }) {
                        const emo = match[1];
                        const cp = ASCII_EMOTICON_MAP[emo];
                        if (!cp) return;
                        const uni = String.fromCodePoint(parseInt(cp, 16));
                        state.tr.replaceWith(range.to - emo.length, range.to, state.schema.nodes.emoji.create({
                            src: TWEMOJI_BASE + cp + '.svg', alt: uni, loading: 'lazy', decoding: 'async', width: 24, height: 24
                        }));
                    }
                })];
            }
        });

        // ---- Lite YouTube / Vimeo nodes ----
        const LiteYouTube = Node.create({
            name: 'liteYouTube',
            group: 'block', atom: true, draggable: true, selectable: true,
            addAttributes() {
                return {
                    videoid: {
                        default: null,
                        parseHTML: el => el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                        renderHTML: attrs => attrs.videoid ? { videoid: attrs.videoid } : {},
                    },
                    title:  { default: '' },
                    author: { default: '' },
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
            group: 'block', atom: true, draggable: true, selectable: true,
            addAttributes() {
                return {
                    videoid: {
                        default: null,
                        parseHTML: el => el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                        renderHTML: attrs => attrs.videoid ? { videoid: attrs.videoid } : {},
                    },
                    title:  { default: '' },
                    author: { default: '' },
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

        // ---- Link preview node ----
        const LinkPreview = Node.create({
            name: 'linkPreview',
            inline: true, group: 'inline', atom: true, draggable: true, selectable: true,
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
                    return generic.some(function (term) { return lower.indexOf(term) !== -1; });
                }
                function needsProxy(url) {
                    if (!url) return false;
                    var blocked = ['discordapp.com', 'cdn.discordapp.com', 'media.discordapp.net', 'github.com', 'raw.githubusercontent.com', 'redd.it', 'reddit.com', 'twimg.com', 'pbs.twimg.com'];
                    try {
                        var host = new URL(url).hostname;
                        return blocked.some(function (d) { return host.includes(d); });
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

        const Spoiler = Node.create({
            name: 'spoiler', group: 'block', content: 'block+', defining: true,
            addAttributes() {
                return { title: { default: null, parseHTML: el => el.getAttribute('data-title') || null, renderHTML: a => a.title ? { 'data-title': a.title } : {} } };
            },
            parseHTML: () => [{ tag: 'div.spoiler' }],
            renderHTML({ HTMLAttributes }) { return ['div', { class: 'spoiler', ...HTMLAttributes }, 0]; }
        });

        const NSFW = Mark.create({
            name: 'nsfw', inclusive: false,
            parseHTML() { return [{ tag: 'span', getAttrs: el => el.classList.contains('ff-nsfw') ? {} : false }]; },
            renderHTML() { return ['span', { class: 'ff-nsfw' }, 0]; }
        });

        // ---- Mention node ----
        const CustomMention = Mention.extend({
            addAttributes() {
                return {
                    id: {
                        default: null,
                        parseHTML: function (el) { return el.getAttribute('data-uid'); },
                        renderHTML: function (attrs) {
                            return attrs.id != null ? { 'data-uid': attrs.id } : {};
                        },
                    },
                    label: {
                        default: null,
                        parseHTML: function (el) {
                            var v = el.getAttribute('data-username') || el.textContent || '';
                            return decodeHtmlEntities(v).replace(/^@/, '');
                        },
                        renderHTML: function (attrs) {
                            return attrs.label ? { 'data-username': attrs.label } : {};
                        },
                    },
                };
            },
            renderHTML: function ({ node }) {
                return ['mark', {
                    'data-uid': node.attrs.id,
                    'data-username': node.attrs.label || '',
                }, node.attrs.label || ''];
            },
            parseHTML: function () {
                return [{
                    tag: 'mark[data-uid]',
                    getAttrs: function (el) {
                        var raw = el.getAttribute('data-username') || el.textContent || '';
                        raw = decodeHtmlEntities(raw).replace(/^@/, '');
                        return { id: el.getAttribute('data-uid'), label: raw };
                    },
                }];
            },
        }).configure({
            HTMLAttributes: { class: 'user-tag' },
            renderText: function ({ node }) {
                return '@' + (node.attrs.label || '');
            },
            suggestion: {
                char: '@',
                allowSpaces: false,
                allow: function ({ state, range }) {
                    try {
                        var $from = state.doc.resolve(range.from);
                        return $from.parent.type.name !== 'codeBlock';
                    } catch (e) { return true; }
                },
                items: function ({ query }) { return searchMentions(query); },
                render: function () {
                    var popup = null;
                    var items = [];
                    var selectedIndex = 0;
                    var itemEls = [];
                    var lastProps = null;

                    function updateSelected() {
                        itemEls.forEach(function (el, i) {
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
                        items = items.filter(function (u) {
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
                        items.forEach(function (user) {
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
                                img.width = 28; img.height = 28; img.loading = 'lazy';
                                img.onerror = function () { this.replaceWith(makeInitialAvatar(userName, user.id)); };
                                img.onload = function () {
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

                            el.addEventListener('mousedown', function (e) {
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
                        onStart: function (props) {
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
                        onUpdate: function (props) {
                            lastProps = props;
                            if (!popup) return;
                            buildList(props);
                            positionPopup(props);
                        },
                        onKeyDown: function (props) {
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
                        onExit: function () {
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
                return [{ tag: 'span[data-color]', getAttrs: el => {
                    var v = el.getAttribute('data-color');
                    if (v === 'success') v = 'primary';
                    return v ? { variant: v } : false;
                }}];
            },
            renderHTML({ HTMLAttributes }) {
                var v = HTMLAttributes.variant || 'primary';
                return ['span', { class: 'text-' + v, 'data-color': v }, 0];
            }
        });

        // ---- Link preview paste plugin ----
        const linkPreviewPlugin = new Plugin({
            key: new PluginKey('linkPreview'),
            props: {
                handlePaste: function (view, event) {
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
                        view.state.doc.descendants(function (node, pos) {
                            if (node.type.name === 'linkPreview' && node.attrs.href === url && node.attrs.loading) {
                                foundPos = pos;
                                return false;
                            }
                            return true;
                        });
                        if (foundPos === -1) return;
                        view.dispatch(view.state.tr.replaceWith(foundPos, foundPos + 1, view.state.schema.text(url)));
                    }

                    fetchWithTimeout(OG_WORKER_URL + encodeURIComponent(url), {}, OG_FETCH_TIMEOUT)
                        .then(function (res) { return res.json(); })
                        .then(function (data) {
                            var foundPos = -1;
                            view.state.doc.descendants(function (node, pos) {
                                if (node.type.name === 'linkPreview' && node.attrs.href === url && node.attrs.loading) {
                                    foundPos = pos;
                                    return false;
                                }
                                return true;
                            });
                            if (foundPos === -1) return;
                            if (data.error || (!data.imageSrc && (!data.title || data.title === url))) {
                                view.dispatch(view.state.tr.replaceWith(foundPos, foundPos + 1, view.state.schema.text(url)));
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
                            view.dispatch(view.state.tr.replaceWith(foundPos, foundPos + 1, newNode));
                        })
                        .catch(function (err) {
                            if (err && err.name === 'AbortError') { replaceSkeletonWithText(); return; }
                            replaceSkeletonWithText();
                        });
                    return true;
                },
            },
        });

        const NormalizeEmptyDoc = Extension.create({
            name: 'normalizeEmptyDoc',
            addProseMirrorPlugins() {
                return [new Plugin({
                    key: new PluginKey('normalizeEmptyDoc'),
                    appendTransaction(trs, old, nw) {
                        if (!trs.some(t => t.docChanged)) return null;
                        const doc = nw.doc;
                        if (doc.childCount === 0) return null;
                        const allEmpty = doc.content.content.every(c => c.type.name === 'paragraph' && c.content.size === 0);
                        if (!allEmpty || doc.childCount === 1) return null;
                        const p = nw.schema.nodes.paragraph.create();
                        const tr = nw.tr; tr.replaceWith(0, doc.content.size, p);
                        tr.setSelection(TextSelection.near(tr.doc.resolve(1)));
                        return tr;
                    }
                })];
            }
        });

        const DeleteAdjacentAtom = Extension.create({
            name: 'deleteAdjacentAtom',
            addProseMirrorPlugins() {
                const BLOCK = new Set(['liteYouTube', 'liteVimeo', 'horizontalRule', 'imageUploadPlaceholder']);
                const INLINE = new Set(['image', 'emoji', 'linkPreview']);
                const isBlock = n => n && !n.isText && !n.isInline && BLOCK.has(n.type.name);
                return [new Plugin({
                    key: new PluginKey('deleteAdjacentAtom'),
                    props: {
                        handleKeyDown(view, event) {
                            const key = event.key;
                            if (key !== 'Backspace' && key !== 'Delete') return false;
                            const st = view.state;
                            const sel = st.selection;
                            if (!sel.empty) {
                                let hit = false;
                                st.doc.nodesBetween(sel.from, sel.to, n => {
                                    if (INLINE.has(n.type.name)) { hit = true; return false; }
                                    return true;
                                });
                                if (hit) { view.dispatch(st.tr.deleteSelection()); return true; }
                                return false;
                            }
                            if (sel instanceof NodeSelection) {
                                view.dispatch(st.tr.delete(sel.from, sel.to));
                                return true;
                            }
                            const $f = sel.$from;
                            if (key === 'Backspace') {
                                if ($f.parentOffset > 0) {
                                    const nb = $f.nodeBefore;
                                    if (nb && INLINE.has(nb.type.name)) {
                                        view.dispatch(st.tr.delete($f.pos - nb.nodeSize, $f.pos));
                                        return true;
                                    }
                                }
                                if ($f.parentOffset !== 0 || $f.depth === 0) return false;
                                const bs = $f.before($f.depth);
                                const nbBlock = st.doc.resolve(bs).nodeBefore;
                                if (!isBlock(nbBlock)) return false;
                                view.dispatch(st.tr.delete(bs - nbBlock.nodeSize, bs));
                                return true;
                            }
                            if ($f.parentOffset < $f.parent.content.size) {
                                const na = $f.nodeAfter;
                                if (na && INLINE.has(na.type.name)) {
                                    view.dispatch(st.tr.delete($f.pos, $f.pos + na.nodeSize));
                                    return true;
                                }
                            }
                            if ($f.parentOffset !== $f.parent.content.size) return false;
                            const be = $f.after($f.depth);
                            const naBlock = st.doc.resolve(be).nodeAfter;
                            if (!isBlock(naBlock)) return false;
                            view.dispatch(st.tr.delete(be, be + naBlock.nodeSize));
                            return true;
                        }
                    }
                })];
            }
        });

        const TrailingEmbedParagraph = Extension.create({
            name: 'trailingEmbedParagraph',
            addProseMirrorPlugins() {
                return [new Plugin({
                    key: new PluginKey('trailingEmbedParagraph'),
                    appendTransaction(trs, old, nw) {
                        if (!trs.some(t => t.docChanged)) return null;
                        const last = nw.doc.lastChild;
                        if (!last) return null;
                        const name = last.type.name;
                        if (name !== 'liteYouTube' && name !== 'liteVimeo' && name !== 'imageUploadPlaceholder') return null;
                        const p = nw.schema.nodes.paragraph.create();
                        const tr = nw.tr.insert(nw.doc.content.size, p);
                        tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
                        return tr;
                    }
                })];
            }
        });

        const BlockAtomSelection = Extension.create({
            name: 'blockAtomSelection',
            addProseMirrorPlugins() {
                return [new Plugin({
                    key: new PluginKey('blockAtomSelection'),
                    props: {
                        decorations(state) {
                            const { from, to, empty } = state.selection;
                            if (empty) return null;
                            const decos = [];
                            state.doc.nodesBetween(from, to, (node, pos) => {
                                const n = node.type.name;
                                if (n === 'liteYouTube' || n === 'liteVimeo') {
                                    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'lite-embed-in-selection' }));
                                } else if (n === 'image' || n === 'linkPreview' || n === 'horizontalRule' || n === 'imageUploadPlaceholder') {
                                    decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'atom-in-selection' }));
                                }
                            });
                            return DecorationSet.create(state.doc, decos);
                        }
                    }
                })];
            }
        });

        // ---- Editor instance ----
        var initialHtml = ensureTrailingParagraphInHtml(opts.initialHtml || '');

        var editor = new Editor({
            element: editorEl,
            extensions: [
                StarterKit.configure({ codeBlock: false }),
                CustomCodeBlock,
                Placeholder.configure({
                    placeholder: ({ node }) => {
                        if (node.type.name === 'heading') return 'Heading…';
                        if (node.type.name === 'codeBlock') return '';
                        return opts.placeholder || 'Write your message…';
                    }
                }),
                Underline, CustomImage, ImageUploadPlaceholder, Emoji,
                Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
                LiteYouTube, LiteVimeo, Spoiler, NSFW, LinkPreview, SemanticColor, CustomMention,
                EmoticonRule,
                TrailingEmbedParagraph, NormalizeEmptyDoc, DeleteAdjacentAtom, BlockAtomSelection,
                CharacterCount.configure({ limit: MAX_MESSAGE_LENGTH > 0 ? MAX_MESSAGE_LENGTH : null }),
                Typography
            ],
            content: initialHtml,
            editorProps: {
                attributes: { class: 'modern-wysiwyg-content', 'aria-label': 'Message body' },
                plugins: [linkPreviewPlugin],
                transformPastedHTML: function (html) {
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
                handlePaste: function (view, event) {
                    // 1. File paste (images)
                    var files = event.clipboardData ? event.clipboardData.files : null;
                    if (files && files.length) {
                        var imgs = Array.prototype.slice.call(files).filter(function (f) { return f.type && f.type.indexOf('image/') === 0; });
                        if (imgs.length) { event.preventDefault(); imgs.forEach(function (f) { uploadImageToWorker(f); }); return true; }
                    }

                    // 2. Inline-code paste (collapse whitespace)
                    if (view.state.selection.empty) {
                        var $from = view.state.selection.$from;
                        var codeMarkType = view.state.schema.marks.code;
                        var hasCode = codeMarkType && codeMarkType.isInSet($from.marks());
                        if (hasCode) {
                            var pasteText = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                            if (pasteText && pasteText.length > 0) {
                                event.preventDefault();
                                var collapsed = pasteText.replace(/\s+/g, ' ').trim();
                                if (collapsed) view.dispatch(view.state.tr.insertText(collapsed));
                                return true;
                            }
                        }
                    }

                    // 3. Shift+paste (plain text override)
                    if (event.shiftKey) {
                        var t = event.clipboardData.getData('text/plain');
                        if (t) { event.preventDefault(); view.dispatch(view.state.tr.insertText(t)); return true; }
                    }

                    // 4. Image URL paste (before the link preview pipeline)
                    if (view.state.selection.empty) {
                        var txt = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                        if (txt) {
                            var url = txt.trim();
                            if (/^https?:\/\/\S+$/.test(url) && isImageUrl(url)) {
                                event.preventDefault();
                                var img = new Image();
                                img.onload = function () {
                                    editorRef.current.chain().focus().insertContent({
                                        type: 'image', attrs: { src: url, alt: 'image', loading: 'lazy', decoding: 'async', width: this.naturalWidth, height: this.naturalHeight }
                                    }).run();
                                };
                                img.onerror = function () {
                                    editorRef.current.chain().focus().insertContent({
                                        type: 'image', attrs: { src: url, alt: 'image', loading: 'lazy', decoding: 'async' }
                                    }).run();
                                };
                                img.src = url;
                                return true;
                            }
                        }
                    }

                    // 5. Lite embeds (iframe or URL paste)
                    var clipboard = event.clipboardData;
                    if (clipboard) {
                        var htmlData = clipboard.getData('text/html');
                        if (htmlData && htmlData.indexOf('<iframe') !== -1) {
                            var srcMatch = htmlData.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                            var iframeSrc = srcMatch ? srcMatch[1].replace(/&amp;/g, '&') : '';
                            if (iframeSrc) {
                                var ytFromIframe = parseYouTubeUrl(iframeSrc);
                                if (ytFromIframe) {
                                    event.preventDefault();
                                    insertLiteEmbed('liteYouTube', ytFromIframe.videoid, { start: ytFromIframe.start, end: ytFromIframe.end });
                                    return true;
                                }
                                var vmFromIframe = parseVimeoUrl(iframeSrc);
                                if (vmFromIframe) {
                                    event.preventDefault();
                                    insertLiteEmbed('liteVimeo', vmFromIframe.videoid, { start: vmFromIframe.start });
                                    return true;
                                }
                            }
                        }

                        var textData = clipboard.getData('text/plain');
                        if (textData) {
                            var candidate = textData.trim();
                            if (/^https?:\/\/\S+$/.test(candidate)) {
                                var yt = parseYouTubeUrl(candidate);
                                if (yt) {
                                    event.preventDefault();
                                    insertLiteEmbed('liteYouTube', yt.videoid, { start: yt.start, end: yt.end });
                                    return true;
                                }
                                var vm = parseVimeoUrl(candidate);
                                if (vm) {
                                    event.preventDefault();
                                    insertLiteEmbed('liteVimeo', vm.videoid, { start: vm.start });
                                    return true;
                                }
                            }
                        }
                    }

                    // 6. Fall through to default handler
                    return false;
                }
            },
                        onCreate: function ({ editor }) {
                // Keep the trailing paragraph logic
                (function ensureTrailingParagraph() {
                    var doc = editor.state.doc;
                    var last = doc.lastChild;
                    if (!last) return;
                    var n = last.type.name;
                    if (n !== 'liteYouTube' && n !== 'liteVimeo' && n !== 'imageUploadPlaceholder') return;
                    var p = editor.schema.nodes.paragraph.create();
                    var tr = editor.state.tr.insert(doc.content.size, p);
                    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
                    editor.view.dispatch(tr);
                })();

                // 'reply' → skip. Most visits are to read, not reply.
                if (opts.mode === 'reply') return;

                // 'fastedit' → The user explicitly clicked the Edit button. 
                // Don't check activeElement because the button IS the activeElement.
                // Give the DOM a tick to finish layout, then focus.
                if (opts.mode === 'fastedit') {
                    setTimeout(function () {
                        if (editor && !editor.isDestroyed && !editor.isFocused) {
                            editor.commands.focus('end');
                        }
                    }, 50);
                    return;
                }

                // 'full' → Don't steal focus if they are already typing elsewhere
                if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
                var a = document.activeElement;
                if (a && a !== document.body && a !== document.documentElement) return;
                editor.commands.focus('end');
            },
           
            onUpdate: function ({ editor }) {
                var html = editor.getHTML();
                var legacy = editorContentIsEmpty(html) ? '' : htmlToLegacy(html);
                if (opts.onSync) opts.onSync(legacy);
                updateSendState();
                scheduleLivePreviewRefresh();
            }
        });

        editorRef.current = editor;

        function updateActive() {
            undoBtn.disabled = !editor.can().undo();
            redoBtn.disabled = !editor.can().redo();
            boldBtn.classList.toggle('active', editor.isActive('bold'));
            italicBtn.classList.toggle('active', editor.isActive('italic'));
            underlineBtn.classList.toggle('active', editor.isActive('underline'));
            strikeBtn.classList.toggle('active', editor.isActive('strike'));
            blockquoteBtn.classList.toggle('active', editor.isActive('blockquote'));
            codeBtn.classList.toggle('active', editor.isActive('code') || editor.isActive('codeBlock'));
            spoilerBtn.classList.toggle('active', editor.isActive('spoiler'));
            nsfwBtn.classList.toggle('active', editor.isActive('nsfw'));
            linkBtn.classList.toggle('active', editor.isActive('link'));
            var hOn = editor.isActive('heading', { level: 1 }) || editor.isActive('heading', { level: 2 }) || editor.isActive('heading', { level: 3 });
            headBtn.style.backgroundColor = hOn ? 'var(--primary-color)' : '';
            headBtn.style.color = hOn ? 'white' : '';
        }
        editor.on('selectionUpdate', updateActive);
        editor.on('transaction', updateActive);
        updateActive();

        var editorRoot = editorEl.querySelector('.ProseMirror');
        if (editorRoot) {
            editorRoot.setAttribute('dropzone', 'copy');
            editorRoot.addEventListener('dragover', function (e) { e.preventDefault(); });
            editorRoot.addEventListener('drop', function (e) {
                e.preventDefault();
                var f = e.dataTransfer.files[0];
                if (f && f.type.startsWith('image/')) uploadImageToWorker(f);
            });
            setupImageToolbar(editorRoot, editor);
            setupSpoilerTitleEdit(editorRoot, editor);
            setupEmoticonAutocomplete(editor, editorRoot);
        }

        editor.setOptions({
            editorProps: {
                handleDOMEvents: {
                    keydown: function (view, event) {
                        var mod = event.ctrlKey || event.metaKey;
                        if (mod && event.key === 'Enter') {
                            event.preventDefault();
                            if (submitBtn && !submitBtn.disabled) submitBtn.click();
                            return true;
                        }
                        if (mod && !event.shiftKey && (event.key === 'k' || event.key === 'K')) { event.preventDefault(); linkBtn.click(); return true; }
                        if (mod && !event.shiftKey && (event.key === 'e' || event.key === 'E')) { event.preventDefault(); editor.chain().focus().toggleCode().run(); return true; }
                        if (event.ctrlKey && event.shiftKey && (event.key === 's' || event.key === 'S')) { event.preventDefault(); spoilerBtn.click(); return true; }
                        if (event.ctrlKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) { event.preventDefault(); nsfwBtn.click(); return true; }
                        return false;
                    }
                }
            }
        });

        // Helper: image hover toolbar
                // Helper: image hover toolbar
        function setupImageToolbar(root, ed) {
            var scrollContainer = root.parentNode; // This is the .modern-wysiwyg wrapper
            
            var toolbarEl = document.createElement('div');
            toolbarEl.className = 'editor-image-toolbar';
            toolbarEl.style.display = 'none';
            
            var nsfwB = document.createElement('button');
            nsfwB.type = 'button'; nsfwB.className = 'editor-image-nsfw-btn';
            nsfwB.innerHTML = '<i class="fa-regular fa-eye-slash" aria-hidden="true"></i>';
            nsfwB.title = 'Mark as NSFW'; nsfwB.setAttribute('aria-label', 'Toggle NSFW');
            
            var editB = document.createElement('button');
            editB.type = 'button'; editB.className = 'editor-image-edit-btn';
            editB.innerHTML = '<i class="fa-regular fa-pen" aria-hidden="true"></i>';
            editB.title = 'Edit image'; editB.setAttribute('aria-label', 'Edit image');
            
            var delB = document.createElement('button');
            delB.type = 'button'; delB.className = 'editor-image-delete-btn';
            delB.innerHTML = '<i class="fa-regular fa-trash-can" aria-hidden="true"></i>';
            delB.title = 'Delete image'; delB.setAttribute('aria-label', 'Delete image');
            
            toolbarEl.appendChild(nsfwB); toolbarEl.appendChild(editB); toolbarEl.appendChild(delB);
            
            // Mount to the scroll container, NOT .ProseMirror
            scrollContainer.appendChild(toolbarEl); 

            [nsfwB, editB, delB].forEach(function (b) { b.addEventListener('mousedown', function (e) { e.preventDefault(); }); });

            var hovered = null;
            var hideTimer = null;

            function isEligible(img) {
                if (!img) return false;
                if (img.classList.contains('twemoji')) return false;
                var alt = img.getAttribute('alt') || '';
                if (alt.startsWith(':') && alt.endsWith(':')) return false;
                if (img.closest('.link-preview-card, .simple-link, .modern-embedded-link')) return false;
                if (img.closest('.ff-upload-placeholder')) return false;
                return true;
            }

            function position(img) {
                var r = img.getBoundingClientRect();
                var rootRect = scrollContainer.getBoundingClientRect();
                var w = toolbarEl.offsetWidth || 108;
                var h = toolbarEl.offsetHeight || 32;
                
                // Calculate position relative to the scroll container (.modern-wysiwyg)
                var top = (r.top - rootRect.top) + scrollContainer.scrollTop + 6;
                var left = (r.right - rootRect.left) + scrollContainer.scrollLeft - w - 8;
                
                toolbarEl.style.top = Math.max(4, top) + 'px';
                toolbarEl.style.left = Math.max(4, left) + 'px';
            }

            function show(img) {
                if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
                hovered = img;
                var isN = img.getAttribute('data-nsfw') === 'true';
                nsfwB.classList.toggle('is-active', isN);
                toolbarEl.style.display = 'flex';
                position(img);
            }

            function hide() {
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(function () { toolbarEl.style.display = 'none'; hovered = null; }, 120);
            }

            function resolve(img) {
                if (!img) return null;
                var view = ed.view;
                var pos;
                try { pos = view.posAtDOM(img, 0); } catch (e) { return null; }
                var $pos = view.state.doc.resolve(pos);
                if ($pos.nodeAfter && $pos.nodeAfter.type.name === 'image') return { node: $pos.nodeAfter, pos: pos };
                if ($pos.nodeBefore && $pos.nodeBefore.type.name === 'image') return { node: $pos.nodeBefore, pos: pos - $pos.nodeBefore.nodeSize };
                return null;
            }

            root.addEventListener('mouseover', function (e) {
                var img = e.target.closest('img');
                if (isEligible(img)) show(img);
            });
            root.addEventListener('click', function (e) {
                var img = e.target.closest('img');
                if (!isEligible(img)) return;
                show(img);
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(function () { if (!toolbarEl.matches(':hover')) { toolbarEl.style.display = 'none'; hovered = null; } }, 4000);
            });
            root.addEventListener('mouseout', function (e) {
                var img = e.target.closest('img');
                if (!img || img !== hovered) return;
                if (toolbarEl.contains(e.relatedTarget)) return;
                var next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('img');
                if (next === img) return;
                hide();
            });
            toolbarEl.addEventListener('mouseenter', function () { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
            toolbarEl.addEventListener('mouseleave', function () { if (hovered) hide(); });

            nsfwB.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (!hovered) return;
                var r = resolve(hovered); if (!r) return;
                ed.view.dispatch(ed.view.state.tr.setNodeMarkup(r.pos, undefined, Object.assign({}, r.node.attrs, { nsfw: !r.node.attrs.nsfw })));
                toolbarEl.style.display = 'none'; hovered = null;
            });
            editB.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (!hovered) return;
                var r = resolve(hovered); if (!r) return;
                showImageEditModal(r.node.attrs.alt || '', r.node.attrs.size || null, function (alt, size) {
                    ed.view.dispatch(ed.view.state.tr.setNodeMarkup(r.pos, undefined, Object.assign({}, r.node.attrs, { alt: alt || 'image', size: size })));
                }, ed);
                toolbarEl.style.display = 'none'; hovered = null;
            });
            delB.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (!hovered) return;
                var r = resolve(hovered); if (!r) return;
                ed.view.dispatch(ed.view.state.tr.delete(r.pos, r.pos + r.node.nodeSize));
                toolbarEl.style.display = 'none'; hovered = null;
            });

            ed.on('transaction', function () {
                if (!hovered) return;
                if (!document.body.contains(hovered)) { if (hideTimer) clearTimeout(hideTimer); toolbarEl.style.display = 'none'; hovered = null; }
            });
            ed.on('blur', function () { toolbarEl.style.display = 'none'; hovered = null; });
        }

        // Helper: spoiler title edit
        function setupSpoilerTitleEdit(root, ed) {
            root.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                var spoiler = e.target.closest('div.spoiler');
                if (!spoiler) return;
                var rect = spoiler.getBoundingClientRect();
                if ((e.clientY - rect.top) > 60) return;
                e.preventDefault(); e.stopPropagation();
                var pos;
                try { pos = ed.view.posAtDOM(spoiler, 0); } catch (err) { return; }
                var $pos = ed.state.doc.resolve(pos);
                var spPos = null;
                for (var d = $pos.depth; d > 0; d--) {
                    if ($pos.node(d).type.name === 'spoiler') { spPos = $pos.before(d); break; }
                }
                if (spPos === null) return;
                var node = ed.state.doc.nodeAt(spPos);
                if (!node) return;
                showSpoilerTitleModal(node.attrs.title || '', function (title) {
                    ed.view.dispatch(ed.state.tr.setNodeMarkup(spPos, undefined, Object.assign({}, node.attrs, { title: title || null })));
                }, ed);
            }, true);
        }

        // Helper: emoticon autocomplete
        function setupEmoticonAutocomplete(ed, root) {
            var popup = null, items = [], sel = 0, itemEls = [], query = '';

            function close() {
                if (popup) { popup.remove(); popup = null; }
                items = []; itemEls = []; sel = 0; query = '';
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
                    var c = ed.view.coordsAtPos(ed.state.selection.from);
                    popup.style.left = (c.left + window.pageXOffset) + 'px';
                    popup.style.top = (c.bottom + window.pageYOffset + 4) + 'px';
                } catch (e) {}
            }
            function updateSel() { itemEls.forEach(function (el, i) { el.classList.toggle('is-selected', i === sel); }); }
            function build() {
                if (!popup) return;
                popup.innerHTML = '';
                itemEls = [];
                items.forEach(function (item) {
                    var el = document.createElement('button');
                    el.type = 'button'; el.className = 'mention-suggestion-item'; el.setAttribute('role', 'option');
                    var img = document.createElement('img');
                    img.className = 'emoticon-suggestion-icon';
                    img.src = TWEMOJI_BASE + emojiToCodePoint(item.emoji) + '.svg';
                    img.alt = item.emoji; img.loading = 'lazy';
                    img.onerror = function () { var s = document.createElement('span'); s.className = 'emoticon-suggestion-icon'; s.textContent = item.emoji; this.replaceWith(s); };
                    el.appendChild(img);
                    var lbl = document.createElement('span');
                    lbl.className = 'mention-suggestion-name';
                    lbl.textContent = ':' + item.name;
                    el.appendChild(lbl);
                    el.addEventListener('mousedown', function (e) { e.preventDefault(); commit(item); });
                    itemEls.push(el); popup.appendChild(el);
                });
                popup.style.display = 'block';
                updateSel();
            }
            function trigger() {
                var s = ed.state.selection;
                if (!s || !s.empty) return null;
                var from = s.from;
                var start = Math.max(0, from - 80);
                var text = ed.state.doc.textBetween(start, from, '\n', '\uFFFC');
                var m = text.match(/(^|\s):([a-zA-Z0-9_+\-]*)$/);
                return m ? { query: m[2] } : null;
            }
            function refresh() {
                var t = trigger();
                if (!t) { close(); return; }
                var q = t.query.toLowerCase();
                var matches = [];
                Object.keys(EMOJI_NAME_MAP).forEach(function (n) {
                    if (n.indexOf(q) === 0) matches.push({ name: n, emoji: EMOJI_NAME_MAP[n] });
                });
                if (matches.length === 0) { close(); return; }
                matches.sort(function (a, b) {
                    var ae = a.name === q ? 0 : 1;
                    var be = b.name === q ? 0 : 1;
                    if (ae !== be) return ae - be;
                    return a.name.localeCompare(b.name);
                });
                items = matches.slice(0, 25); sel = 0; query = t.query;
                ensurePopup(); build(); positionPopup();
            }
            function commit(item) {
                if (!item) return;
                var from = ed.state.selection.from;
                var triggerStart = from - query.length - 1;
                var cp = emojiToCodePoint(item.emoji);
                ed.chain().focus().deleteRange({ from: triggerStart, to: from }).insertContent({
                    type: 'emoji',
                    attrs: { src: TWEMOJI_BASE + cp + '.svg', alt: item.emoji, loading: 'lazy', decoding: 'async', width: 24, height: 24 }
                }).run();
                pushEmojiRecent(item.emoji);
                close();
            }
            root.addEventListener('keydown', function (e) {
                if (!popup) return;
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
                if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); sel = (sel + 1) % items.length; updateSel(); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); sel = (sel - 1 + items.length) % items.length; updateSel(); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); commit(items[sel]); return; }
                if (e.key === ' ') close();
            }, true);
            ed.on('update', refresh);
            ed.on('selectionUpdate', refresh);
            ed.on('blur', function () {
                setTimeout(function () {
                    if (document.activeElement !== root && !(popup && popup.contains(document.activeElement))) close();
                }, 0);
            });
        }

        // Send-state
        function updateSendState() {
            if (!submitBtn) return;
            var empty = editorContentIsEmpty(editor.getHTML());
            var hasPlaceholder = false;
            editor.state.doc.descendants(function (n) {
                if (n.type.name === 'imageUploadPlaceholder') { hasPlaceholder = true; return false; }
                return true;
            });
            var ready = !empty && !hasPlaceholder;
            submitBtn.disabled = !ready;
            submitBtn.setAttribute('aria-disabled', String(!ready));
            if (ready) submitBtn.removeAttribute('title');
            else submitBtn.setAttribute('title', hasPlaceholder ? 'Finish or remove the image placeholder' : 'Write something before submitting');
        }

        // Preview button
        previewBtn.onclick = function () {
            if (!editorRef.current || editorContentIsEmpty(editorRef.current.getHTML())) return;
            previewArea.style.display = 'block';
            updateLivePreview();
            previewArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };

        // Submit
        submitBtn.onclick = function (e) {
            e.preventDefault();
            if (!editorRef.current) return;
            if (editorContentIsEmpty(editorRef.current.getHTML())) return;
            var legacy = htmlToLegacy(editorRef.current.getHTML());
            if (opts.onSync) opts.onSync(legacy);
            var sig = document.getElementById('enablesig');
            var trk = document.getElementById('track_topic');
            if (sig) sig.checked = true;
            if (trk) trk.checked = true;
            if (opts.onSubmit) opts.onSubmit();
        };

        if (cancelBtn) {
            cancelBtn.onclick = function (e) {
                e.preventDefault();
                if (editorRef.current) {
                    editorRef.current.destroy();
                    editorRef.current = null;
                }
                if (opts.onCancel) opts.onCancel();
            };
        }

        updateSendState();

        host.__editorInstance = editor;
        host.__editorSync = function () {
            if (editor) {
                var legacy = htmlToLegacy(editor.getHTML());
                if (opts.onSync) opts.onSync(legacy);
            }
        };
        host.__editorDestroy = function () {
            if (editor) {
                try { editor.destroy(); } catch (e) {}
            }
        };
    }

    // ========================================================================
    // TOAST
    // ========================================================================
    function ensureToastContainer() {
        var c = document.getElementById('editor-toasts');
        if (!c) {
            c = document.createElement('div');
            c.id = 'editor-toasts';
            c.setAttribute('aria-live', 'polite');
            c.style.cssText = 'position:fixed;bottom:var(--space-lg);right:var(--space-lg);z-index:100000;display:flex;flex-direction:column;gap:var(--space-xs);pointer-events:none;';
            document.body.appendChild(c);
        }
        return c;
    }

    function showToast(msg, type) {
        type = type || 'info';
        var color = 'var(--success-color)';
        var icon = 'fa-regular fa-circle-check';
        if (type === 'error') { color = 'var(--danger-color)'; icon = 'fa-regular fa-circle-exclamation'; }
        else if (type === 'warning') { color = 'var(--warning-color)'; icon = 'fa-regular fa-triangle-exclamation'; }

        var t = document.createElement('div');
        t.setAttribute('role', 'status');
        t.style.cssText = 'display:flex;align-items:center;gap:var(--space-sm);padding:var(--pad-3) var(--pad-5);background:var(--surface-color);color:var(--text-primary);border:1px solid var(--border-color);border-left-width:3px;border-left-color:' + color + ';border-radius:var(--radius);box-shadow:var(--shadow-lg);font-family:var(--font-primary);font-size:var(--text-sm);max-width:360px;pointer-events:auto;opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;';
        t.innerHTML = '<i class="' + icon + '" aria-hidden="true" style="color:' + color + ';"></i><span style="flex:1;">' + escapeHtml(msg) + '</span>';
        ensureToastContainer().appendChild(t);
        requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
        setTimeout(function () {
            t.style.opacity = '0'; t.style.transform = 'translateY(8px)';
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
        }, 3000);
    }

    // ========================================================================
    // FAST REPLY BUILDER (body#topic)
    // ========================================================================
    async function buildFastReplyEditor() {
        var legacySend = document.querySelector('.fast.send');
        if (!legacySend) return;
        if (document.getElementById('modern-editor-fastreply')) return;

        var legacyPost = document.getElementById('Post');
        var legacyForm = window.REPLIER || (legacyPost ? legacyPost.form : null);
        var legacySubmit = document.querySelector('input[name="sub-mit"]');

        var legacyHtml = legacyPost ? legacyPost.value : '';

        var draftKey = null;
        if (legacyPost) {
            var onkeyup = legacyPost.getAttribute('onkeyup') || '';
            var dm = onkeyup.match(/localStorage\.setItem\(['"]([^'"]+)['"]/);
            if (dm) draftKey = dm[1];
        }

        function persistDraft(legacy) {
            if (!draftKey) return;
            try {
                var trimmed = (legacy || '').trim();
                if (trimmed) localStorage.setItem(draftKey, trimmed);
                else localStorage.removeItem(draftKey);
            } catch (e) {}
        }

        var container = document.createElement('div');
        container.id = 'modern-editor-fastreply';
        container.className = 'modern-editor-container modern-editor-container--reply';

        var insertAfter = document.getElementById('modern-pagination');
        var wrapper = document.getElementById('modern-forum-wrapper');

        if (insertAfter && insertAfter.parentNode) {
            insertAfter.parentNode.insertBefore(container, insertAfter.nextSibling);
        } else if (wrapper) {
            wrapper.appendChild(container);
        } else {
            document.body.appendChild(container);
        }

        var anchorEl = document.getElementById('fastreply');
        if (anchorEl) {
            var anchorNode = (anchorEl.parentElement && anchorEl.parentElement.classList.contains('anchor'))
                ? anchorEl.parentElement
                : anchorEl;
            container.parentNode.insertBefore(anchorNode, container);
        }

        try {
            await buildEditorInto(container, {
                mode: 'reply',
                initialHtml: await legacyToHtmlAsync(legacyHtml),
                placeholder: 'Write your reply…',
                headerLabel: 'Replying as:',
                submitLabel: 'Post reply',
                onSync: function (legacy) {
                    if (legacyPost) legacyPost.value = legacy;
                    persistDraft(legacy);
                },
                onSubmit: function () {
                    var sig = document.getElementById('enablesig');
                    var trk = document.getElementById('track_topic');
                    if (sig) sig.checked = true;
                    if (trk) trk.checked = true;
                    if (legacySubmit) legacySubmit.disabled = false;
                    if (legacyForm && legacyForm instanceof HTMLFormElement) {
                        try { HTMLFormElement.prototype.submit.call(legacyForm); }
                        catch (e) { legacyForm.submit(); }
                    } else if (legacySubmit) {
                        legacySubmit.click();
                    }
                }
            });

            if (window.location.hash === '#fastreply') {
                setTimeout(function () {
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }

            console.log('[EditorModule] Fast reply editor built');
        } catch (err) {
            console.error('[EditorModule] Fast reply build failed:', err);
            container.innerHTML = '<div style="color:red;padding:1rem;">Editor failed to load. <button onclick="location.reload()">Reload</button></div>';
        }
    }

    // ========================================================================
    // FULL EDITOR BUILDER (body#send)
    // ========================================================================
    async function buildFullEditor() {
        var legacySend = document.querySelector('.send');
        if (!legacySend) return;
        if (document.getElementById('modern-editor-full')) return;

        var legacyPost = document.getElementById('Post');
        var legacyForm = window.REPLIER || (legacyPost ? legacyPost.form : null);
        var legacySubmit = document.querySelector('input[name="submit_post"]');

        var legacyHtml = legacyPost ? legacyPost.value : '';

        var container = document.createElement('div');
        container.id = 'modern-editor-full';
        container.className = 'modern-editor-container modern-editor-container--full';

        var summary = document.getElementById('modern-summary-container');
        var wrapper = document.getElementById('modern-forum-wrapper');

        if (summary && summary.parentNode) {
            summary.parentNode.insertBefore(container, summary);
        } else if (wrapper) {
            wrapper.appendChild(container);
        } else {
            document.body.appendChild(container);
        }

        var sig = document.getElementById('enablesig');
        var trk = document.getElementById('track_topic');
        if (sig) sig.checked = true;
        if (trk) trk.checked = true;

        try {
            await buildEditorInto(container, {
                mode: 'full',
                initialHtml: await legacyToHtmlAsync(legacyHtml),
                placeholder: 'Write your post…',
                headerLabel: 'Writing as:',
                submitLabel: 'Submit post',
                onSync: function (legacy) { if (legacyPost) legacyPost.value = legacy; },
                onSubmit: function () {
                    var s2 = document.getElementById('enablesig');
                    var t2 = document.getElementById('track_topic');
                    if (s2) s2.checked = true;
                    if (t2) t2.checked = true;
                    if (legacySubmit) legacySubmit.disabled = false;
                    if (legacyForm && legacyForm instanceof HTMLFormElement) {
                        try { HTMLFormElement.prototype.submit.call(legacyForm); }
                        catch (e) { legacyForm.submit(); }
                    } else if (legacySubmit) {
                        legacySubmit.click();
                    }
                }
            });
            console.log('[EditorModule] Full editor built');
        } catch (err) {
            console.error('[EditorModule] Full editor build failed:', err);
            container.innerHTML = '<div style="color:red;padding:1rem;">Editor failed to load. <button onclick="location.reload()">Reload</button></div>';
        }
    }

    // ========================================================================
    // FAST EDIT BUILDER (per-post)
    // ========================================================================
        async function buildFastEdit(fasteditEl) {
        if (!fasteditEl || _activeFastEdits.has(fasteditEl)) return;
        console.log('[EditorModule] buildFastEdit fired for:', fasteditEl.className || fasteditEl.tagName);
        _activeFastEdits.set(fasteditEl, 'pending');

        var legacyTextarea = fasteditEl.querySelector('.fastedit_text');
        var legacySaveBtn = fasteditEl.querySelector('.fastedit_send');
        var legacyCancelBtn = fasteditEl.querySelector('.fastedit_canc');
        var legacyHidden = fasteditEl.querySelector('input[type="hidden"]');

        if (!legacyTextarea) {
            _activeFastEdits.delete(fasteditEl);
            return;
        }

        var initialHtml = '';
        var textareaVal = legacyTextarea.value ? legacyTextarea.value.trim() : '';
        if (textareaVal) {
            initialHtml = await legacyToHtmlAsync(textareaVal);
        } else if (legacyHidden && legacyHidden.value) {
            initialHtml = await legacyToHtmlAsync(extractFastEditBody(legacyHidden.value));
        } else {
            var postEl = fasteditEl.closest('.post');
            if (postEl) {
                var contentTable = postEl.querySelector('.right.Item table.color') || postEl.querySelector('td.Item table.color');
                if (contentTable) {
                    var clone = contentTable.cloneNode(true);
                    clone.querySelectorAll('.edit, .bottomborder, .signature').forEach(function (el) { el.remove(); });
                    initialHtml = await legacyToHtmlAsync(clone.innerHTML);
                }
            }
        }

        var legacyPost = fasteditEl.closest('.post');
        var legacyPostId = legacyPost ? legacyPost.getAttribute('id') : null;
        var modernCard = legacyPostId
            ? document.querySelector('.post-card[data-original-id="' + legacyPostId + '"]')
            : null;

        var container = document.createElement('div');
        container.className = 'modern-editor-container modern-editor-container--fastedit';

                var cardWasHidden = false;
        if (modernCard && modernCard.parentNode) {
            modernCard.classList.add('is-being-edited');
            cardWasHidden = true;
            modernCard.parentNode.insertBefore(container, modernCard.nextSibling);
            console.log('[EditorModule] fast edit: inserted after modern card (modernCard found)');
        } else {
            fasteditEl.appendChild(container);
            console.log('[EditorModule] fast edit: inserted inside .fastedit (modernCard NOT found)');
        }

        function restoreCard() {
            if (cardWasHidden && modernCard) {
                modernCard.classList.remove('is-being-edited');
            }
        }

        try {
            await buildEditorInto(container, {
                mode: 'fastedit',
                initialHtml: initialHtml,
                placeholder: 'Edit your post…',
                headerLabel: 'Editing as:',
                submitLabel: 'Save changes',
                onSync: function (legacy) { if (legacyTextarea) legacyTextarea.value = legacy; },
                onCancel: function () {
    _activeFastEdits.delete(fasteditEl);
    restoreCard();

    // Remove our container explicitly. It's a sibling of the modern card,
    // not a child of .fastedit, so the legacy cancel handler doesn't touch
    // it — without this the editor stays visible below the post after
    // cancel.
    if (container.parentNode) container.remove();

    // Dispatch the legacy cancel so the forum's own handler can run its
    // teardown (removes/hides .fastedit, resets any internal state).
    if (legacyCancelBtn) legacyCancelBtn.click();

    // Some forum builds hide .fastedit on cancel rather than removing it.
    // handleEdit in posts.js uses .fastedit presence as its "already open"
    // signal, so a leftover hidden div would block the next Edit click.
    // Deferred one tick so a synchronous legacy removal can win the race
    // cleanly; if it already removed the div, the check below is a no-op.
    setTimeout(function () {
        if (fasteditEl && fasteditEl.parentNode) {
            fasteditEl.remove();
        }
    }, 50);
},
                onSubmit: function () {
                    if (!legacyTextarea) { showToast('Save failed — textarea missing', 'error'); return; }
                    if (legacySaveBtn) {
                        legacySaveBtn.click();
                    } else {
                        showToast('Save button missing', 'error');
                        return;
                    }
                    waitForFastEditRemoval(fasteditEl, function () {
                        _activeFastEdits.delete(fasteditEl);
                        triggerPostReconversion();
                    });
                }
            });
            _activeFastEdits.set(fasteditEl, 'active');
            console.log('[EditorModule] Fast edit editor built for post');
        } catch (err) {
            console.error('[EditorModule] Fast edit build failed:', err);
            _activeFastEdits.delete(fasteditEl);
            restoreCard();
            container.innerHTML = '<div style="color:red;padding:1rem;">Editor failed to load.</div>';
        }
    }

    function extractFastEditBody(html) {
        if (!html) return '';
        var temp = document.createElement('div');
        temp.innerHTML = html;
        var td = temp.querySelector('td');
        var src = td || temp;
        src.querySelectorAll('.edit, .signature, .bottomborder').forEach(function (el) { el.remove(); });
        src.querySelectorAll('td:empty').forEach(function (el) { el.remove(); });
        return src.innerHTML.trim();
    }

    function waitForFastEditRemoval(fasteditEl, callback) {
        var start = Date.now();
        var poll = setInterval(function () {
            if (!document.body.contains(fasteditEl)) {
                clearInterval(poll);
                callback();
                return;
            }
            if (Date.now() - start > CONFIG.FAST_EDIT_REMOVAL_TIMEOUT_MS) {
                clearInterval(poll);
                callback();
            }
        }, CONFIG.FAST_EDIT_REMOVAL_POLL_MS);
    }

    function triggerPostReconversion() {
        if (typeof window.ForumPostsModule === 'undefined') return;
        try {
            window.ForumPostsModule.reset();
            window.ForumPostsModule.initialize();
            console.log('[EditorModule] Post re-conversion triggered');
        } catch (e) {
            console.warn('[EditorModule] Post re-conversion failed:', e);
        }
    }

    // ========================================================================
    // OBSERVER REGISTRATION
    // ========================================================================
    function registerObservers() {
        if (!globalThis.forumObserver || typeof globalThis.forumObserver.register !== 'function') return;

        try {
            var id = globalThis.forumObserver.register({
                id: 'editor-module-fastreply',
                selector: '.fast.send',
                priority: 'high',
                pageTypes: ['topic'],
                callback: function () { buildFastReplyEditor(); }
            });
            if (id) _observerIds.push(id);
        } catch (e) { console.error('[EditorModule] observer (fastreply) failed:', e); }

        try {
            var id2 = globalThis.forumObserver.register({
                id: 'editor-module-full',
                selector: '.send',
                priority: 'high',
                pageTypes: ['send'],
                callback: function () { buildFullEditor(); }
            });
            if (id2) _observerIds.push(id2);
        } catch (e) { console.error('[EditorModule] observer (full) failed:', e); }

        try {
            var id3 = globalThis.forumObserver.register({
                id: 'editor-module-fastedit',
                selector: '.fastedit',
                priority: 'high',
                callback: function (node) { if (node) buildFastEdit(node); }
            });
            if (id3) _observerIds.push(id3);
        } catch (e) { console.error('[EditorModule] observer (fastedit) failed:', e); }

               // Belt-and-braces: also react to .fastedit_button clicks. The
        // observer registration above should catch .fastedit being added
        // to the DOM, but if it ever misses (mid-batch, in-editor filter,
        // observerOrigin marker on the .post during a posts-module run),
        // this fallback catches it. The _activeFastEdits guard makes the
        // build idempotent — safe to call twice.
        addGlobalListener(document, 'click', function (e) {
            var btn = e.target.closest('.fastedit_button');
            if (!btn) return;
            setTimeout(function () {
                document.querySelectorAll('.post .fastedit').forEach(function (fe) {
                    if (_activeFastEdits.has(fe)) return;
                    if (fe.querySelector('.modern-editor-container--fastedit')) return;
                    buildFastEdit(fe);
                });
            }, 50);
        });
    }

    // ========================================================================
    // INITIALIZE / RESET
    // ========================================================================
    function initialize() {
        if (isInitialized) return Promise.resolve();
        if (!globalThis.forumObserver) {
            console.error('[EditorModule] forumObserver not available');
            return Promise.reject(new Error('forumObserver missing'));
        }
        isInitialized = true;

        if (document.body.id === 'topic' || document.body.id === 'send') {
            fetchCurrentUserData();
        }

        var promises = [];
        if (document.body.id === 'topic' && document.querySelector('.fast.send')) {
            promises.push(buildFastReplyEditor());
        }
        if (document.body.id === 'send' && document.querySelector('.send')) {
            promises.push(buildFullEditor());
        }

        registerObservers();

        return Promise.all(promises).then(function () {
            console.log('[EditorModule] Initialized');
        }).catch(function (err) {
            console.error('[EditorModule] Initialization error:', err);
        });
    }

    function reset() {
        isInitialized = false;
        _activeFastEdits.forEach(function (state, el) {
            var host = el.querySelector('.modern-editor-container--fastedit');
            if (host && host.__editorDestroy) host.__editorDestroy();
        });
        _activeFastEdits.clear();
        _observerIds.forEach(function (id) {
            if (globalThis.forumObserver && typeof globalThis.forumObserver.unregister === 'function') {
                try { globalThis.forumObserver.unregister(id); } catch (e) {}
            }
        });
        _observerIds = [];
        _boundHandlers.forEach(function (h) {
            try { h.el.removeEventListener(h.type, h.handler, h.opts); } catch (e) {}
        });
        _boundHandlers = [];
        if (_dropdownBackdrop && _dropdownBackdrop.parentNode) {
            _dropdownBackdrop.parentNode.removeChild(_dropdownBackdrop);
        }
        _dropdownBackdrop = null;
        _uploadRegistry.clear();
        _currentUserCache = null;
    }

    return {
        initialize: initialize,
        reset: reset
    };
})(
    typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
    typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus
);

if (typeof window !== 'undefined') {
    window.EditorModule = EditorModule;
    window.dispatchEvent(new CustomEvent('editor-module-ready'));
}
