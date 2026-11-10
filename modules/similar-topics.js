/**
 * SimilarTopicsModule — Modern
 *
 * Scans the current topic's section via /api.php?f=<sectionId>, finds
 * up to `limit` topics whose title + description share at least
 * `minHits` tokens with the current topic's title, then renders them
 * as compact .latest-post-card rows inside a modern section header.
 *
 * Starter avatars are resolved through /api.php?mid=<starterId>, so
 * every card gets the same mini-avatar + group-class border the rest
 * of the theme uses. Expansion previews reuse .modern-quote.
 *
 * Read-only, per-page-load operation — no forumObserver registration,
 * no re-runs.
 *
 * Registered with ForumEnhancer via registerModule(), not via the
 * observer.
 */
var SimilarTopicsModule = (function () {
    'use strict';

    /* ================================================================
       CONFIG
       ================================================================ */
    var CONFIG = {
        containerId: 'modern-similar-topics',

        limit:     5,
        maxPages:  20,
        pageSize:  30,
        minHits:   2,

        // Gates
        firstPageOnly: false,
        whitelist:     [],
        blacklist:     [],

        // Cache
        enableCache: true,
        cachePrefix: 'similar-topics:',
        cacheTtlMs:  6 * 60 * 60 * 1000,

        // Preview
        previewMaxChars: 450,

        // Avatar pipeline
        weservCdn: 'https://images.weserv.nl/',
        weservCache: '1y',
        weservQuality: 80,
        avatarSize: 32,

        // Debug
        debug: false
    };

    /* ================================================================
       STOP WORDS (English + Italian, ASCII-folded)
       ================================================================ */
    var STOP_WORDS = {};
    [
        'a','an','and','are','as','at','be','but','by','for','from','has','have',
        'how','i','in','is','it','its','of','on','or','that','the','this','to',
        'was','were','what','when','where','which','who','will','with','you',
        'ad','al','alla','alle','alli','allo','agli','all','anche','che','chi',
        'ci','come','con','da','dal','dalla','dalle','dallo','dagli','dei','del',
        'della','delle','dello','degli','di','e','ed','era','erano','gli','ha',
        'hai','hanno','ho','il','io','la','le','lei','lo','loro','lui','ma','mi',
        'mio','ne','nei','nel','nella','nelle','nello','negli','noi','non','o',
        'per','perche','piu','puo','qual','quale','quali','quando','se','sei',
        'si','sia','sono','su','sua','sue','sui','sul','sulla','sulle','sullo',
        'sugli','te','ti','tra','tu','tua','tuo','un','una','uno','vi','voi',
        'vostro'
    ].forEach(function (w) { STOP_WORDS[w] = true; });

    /* ================================================================
       AVATAR COLOUR PALETTE — mirrors boards.js / posts.js
       ================================================================ */
    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    /* ================================================================
       STATE
       ================================================================ */
    var initialized = false;
    var topicId     = null;
    var sectionId   = null;
    var domain      = '';
    var queryTokens = [];
    var effectiveMinHits = 0;
    var cacheKey    = null;

    var userDataCache = new Map();

    /* ================================================================
       TEXT HELPERS
       ================================================================ */
    function stripDiacritics(s) {
        return s.normalize
            ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            : s;
    }

    function tokenize(text) {
        if (!text) return [];
    var s = stripDiacritics(stripHtml(String(text))).toLowerCase();
    s = s.replace(/[^a-z0-9\s]/g, ' ');
        var raw = s.split(/\s+/);
        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var w = raw[i];
            if (w.length < 2) continue;
            if (STOP_WORDS[w]) continue;
            out.push(w);
        }
        return out;
    }

    function stripHtml(html) {
        return html ? String(html).replace(/<[^>]*>/g, ' ') : '';
    }

    function truncate(s, n) {
        if (!s || s.length <= n) return s || '';
        return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
    }

    function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return str || '';
    if (str.indexOf('&') === -1) return str;
    var ta = document.createElement('textarea');
    ta.innerHTML = str;
    return ta.value;
}

    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, function (c) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[c];
        });
    }

    /* ================================================================
       AVATAR HELPERS
       ================================================================ */
    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function isValidAvatarUrl(url) {
        if (!url || typeof url !== 'string') return false;
        var trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return false;
        if (trimmed === 'http' || trimmed === 'https' || trimmed === '//') return false;
        return true;
    }

    function optimizeImageUrl(url, width, height) {
        if (!isValidAvatarUrl(url)) return url;
        var lowerUrl = url.toLowerCase();
        if (lowerUrl.indexOf('weserv.nl') !== -1 || lowerUrl.indexOf('data:') === 0) return url;
        var w = width || CONFIG.avatarSize;
        var h = height || CONFIG.avatarSize;
        return CONFIG.weservCdn + '?url=' + encodeURIComponent(url) +
            '&output=webp&maxage=' + CONFIG.weservCache +
            '&q=' + CONFIG.weservQuality +
            '&w=' + w + '&h=' + h +
            '&fit=cover&a=attention&il';
    }

    function sanitizeGroupName(name) {
        if (!name) return 'member';
        return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'member';
    }

    function getGroupClass(user) {
        if (!user || !user.group) return 'group-member';
        var groupName  = (user.group.name  || '').toLowerCase();
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
        return 'group-member';
    }

    function generateAvatarHtml(user, username, userId, size) {
        size = size || CONFIG.avatarSize;
        var avatarUrl = null;

        if (user && user.avatar && isValidAvatarUrl(user.avatar)) {
            var u = String(user.avatar).trim();
            if (u.indexOf('//') === 0) u = 'https:' + u;
            if (u.indexOf('http://') === 0 && window.location.protocol === 'https:') {
                u = u.replace('http://', 'https://');
            }
            if (u.toLowerCase().indexOf('style_images/default_avatar.png') === -1) {
                avatarUrl = u;
            }
        }

        var groupClass = getGroupClass(user);

        if (avatarUrl) {
            var optimized = optimizeImageUrl(avatarUrl, size, size);
            return '<img class="mini-avatar ' + groupClass + '" ' +
                'src="' + escapeHtml(optimized) + '" ' +
                'alt="' + escapeHtml(username) + '" ' +
                'width="' + size + '" height="' + size + '" ' +
                'loading="lazy" decoding="async">';
        }

        var initial = username ? String(username).charAt(0).toUpperCase() : '?';
        if (!/[A-Z0-9]/i.test(initial)) initial = '?';
        var bg = getColorFromNickname(username, userId);
        return '<span class="mini-avatar mini-avatar--initial ' + groupClass + '" ' +
            'style="background-color:#' + bg + ';' +
            'width:' + size + 'px;height:' + size + 'px;' +
            'font-size:' + (size * 0.618) + 'px;line-height:' + size + 'px;">' +
            escapeHtml(initial) + '</span>';
    }

    async function fetchUserData(mid) {
    if (!mid) return null;
    if (userDataCache.has(mid)) return userDataCache.get(mid);
    try {
        var response = await fetch('/api.php?mid=' + encodeURIComponent(mid), {
            cache: 'no-store'
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var data = await response.json();
        var user = data['m' + mid] || data.info;
        if (user && user.id) {
            userDataCache.set(mid, user);
            return user;
        }
        return null;
    } catch (e) {
        if (CONFIG.debug) console.warn('[SimilarTopics] API error for MID ' + mid, e);
        return null;
    }
}

    async function mapWithConcurrencyLimit(items, worker, limit) {
        limit = limit || 6;
        if (items.length === 0) return [];
        var results = new Array(items.length);
        var index = 0;
        var workers = new Array(limit).fill(null).map(async function () {
            while (index < items.length) {
                var current = index++;
                results[current] = await worker(items[current], current);
            }
        });
        await Promise.all(workers);
        return results;
    }

    async function prefetchStarterUsers(threads) {
        var mids = [];
        var seen = {};
        threads.forEach(function (t) {
            var id = t.info && t.info.start ? t.info.start.id : 0;
            if (id && !seen[id]) {
                seen[id] = true;
                mids.push(id);
            }
        });
        if (!mids.length) return;
        await mapWithConcurrencyLimit(mids, fetchUserData, 4);
    }

    /* ================================================================
       CACHE
       ================================================================ */
    function readCache() {
        if (!CONFIG.enableCache || !cacheKey) return null;
        try {
            var raw = sessionStorage.getItem(cacheKey);
            if (!raw) return null;
            var obj = JSON.parse(raw);
            if (!obj || typeof obj.ts !== 'number') return null;
            if (Date.now() - obj.ts > CONFIG.cacheTtlMs) {
                sessionStorage.removeItem(cacheKey);
                return null;
            }
            return Array.isArray(obj.items) ? obj.items : null;
        } catch (e) { return null; }
    }

    function writeCache(items) {
        if (!CONFIG.enableCache || !cacheKey) return;
        try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items: items }));
        } catch (e) { /* quota — ignore */ }
    }

    /* ================================================================
       CONTEXT RESOLUTION
       ================================================================ */
    function getTopicContext() {
        // Fast path: Commons, when available and populated.
        if (window.Commons && window.Commons.location && window.Commons.location.topic) {
    var c = window.Commons.location;
    if (c.isTopic && c.topic.id && c.section && c.section.id && c.topic.title) {
    return {
        topicId:   c.topic.id,
        sectionId: c.section.id,
        title:     stripHtml(c.topic.title || '').trim()
    };
}
    // Fall through to DOM-based extraction rather than returning a
    // half-populated object. If Commons has topic.id but not section.id
    // or title yet, the DOM is usually already in a better state.
}

        var isTopic = document.body.id === 'topic' ||
                      /(?:^|\s)t\d+(?:\s|$)/.test(document.body.className);
        if (!isTopic) return null;

        var params = new URLSearchParams(window.location.search);

        var tId = parseInt(params.get('t') || '0', 10);
        if (!tId) {
            var tMatch = document.body.className.match(/(?:^|\s)t(\d+)(?:\s|$)/);
            if (tMatch) tId = parseInt(tMatch[1], 10);
        }

        var sId = parseInt(params.get('f') || '0', 10);
        if (!sId) {
            var fMatch = document.body.className.match(/(?:^|\s)f(\d+)(?:\s|$)/);
            if (fMatch) sId = parseInt(fMatch[1], 10);
        }
        if (!sId) {
            var navLink = document.querySelector('.nav a[href*="?f="]');
            if (navLink) {
                var fMatch2 = navLink.href.match(/[?&]f=(\d+)/);
                if (fMatch2) sId = parseInt(fMatch2[1], 10);
            }
        }

        var title = '';
        var titleEl = document.querySelector(
            'div.mtitle h1, h1.mtitle, h2.mtitle, .topic .mback .mtitle'
        );
        if (titleEl) title = titleEl.textContent.trim();

        return { topicId: tId, sectionId: sId, title: title };
    }

    /* ================================================================
       SCORING
       ================================================================ */
    function scoreCandidate(thread) {
        var titleTokens = tokenize(stripHtml(thread.title || ''));
        var descTokens  = tokenize(stripHtml(thread.desc  || ''));

        var titleSet = {}, descSet = {}, i;
        for (i = 0; i < titleTokens.length; i++) titleSet[titleTokens[i]] = true;
        for (i = 0; i < descTokens.length;  i++) descSet[descTokens[i]]  = true;

        var hits = 0, weighted = 0;
        for (i = 0; i < queryTokens.length; i++) {
            var q = queryTokens[i];
            if (titleSet[q])      { hits++; weighted += 1.5; }
            else if (descSet[q])  { hits++; weighted += 1;   }
        }

        if (!hits || hits < effectiveMinHits) return null;

        var coverage = hits / queryTokens.length;
        return {
            thread: thread,
            score:  coverage * (1 + weighted / (queryTokens.length * 1.5))
        };
    }

    /* ================================================================
       FETCH
       ================================================================ */
    var candidates = [];
    var seen       = {};
    var hadError   = false;

    function fetchPage(offset) {
        var url = '/api.php?f=' + sectionId + '&st=' + offset + '&cookie=1';
        return fetch(url, { credentials: 'include' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    function consumePage(data) {
        var threads = (data.articles && data.articles.length)
            ? data.articles
            : (data.threads || []);
        for (var i = 0; i < threads.length; i++) {
            var t = threads[i];
            if (!t || seen[t.id]) continue;
            seen[t.id] = true;
            var scored = scoreCandidate(t);
            if (scored) candidates.push(scored);
        }
    }

    function collect(onDone) {
    var page = 0;
    var totalPages = 1;
    var threadsSeen = 0;

    function step() {
        if (page >= CONFIG.maxPages) return onDone(threadsSeen);
        if (page > 0 && page >= totalPages) return onDone(threadsSeen);
        if (candidates.length >= CONFIG.limit * 2) return onDone(threadsSeen);

        fetchPage(page * CONFIG.pageSize)
            .then(function (data) {
                if (!data || !data.info) {
                    // Malformed response — treat as error, not "no matches".
                    hadError = true;
                    return onDone(threadsSeen);
                }
                totalPages = data.info.pages || 1;

                var threads = (data.articles && data.articles.length)
                    ? data.articles
                    : (data.threads || []);
                threadsSeen += threads.length;

                consumePage(data);
                page++;
                step();
            })
            .catch(function () {
                hadError = true;
                onDone(threadsSeen);
            });
    }
    step();
}

    function runCollectWithRetry(attempt) {
    var sectionAtStart = sectionId;

    collect(function (threadsSeen) {
        // Success — render.
        if (candidates.length > 0) {
            finish();
            return;
        }

        // Error path — don't retry a network failure.
        if (hadError) {
            finish();
            return;
        }

        // Empty but no error. Two possibilities:
        //   (a) section was stale — getTopicContext() will now return
        //       a different section id because the DOM has settled;
        //   (b) section was right but genuinely has no similar topics.
        // We can only distinguish (a) from (b) by re-resolving context.
        if (attempt >= 1) {
            finish();   // one retry max — budget is spent
            return;
        }

        var fresh = getTopicContext();
        var sectionChanged = fresh && fresh.sectionId && fresh.sectionId !== sectionAtStart;
        var sectionSuspiciouslyEmpty = threadsSeen < 5;

        if (!sectionChanged && !sectionSuspiciouslyEmpty) {
            finish();
            return;
        }

        if (sectionChanged) {
            sectionId = fresh.sectionId;
            if (CONFIG.debug) {
                console.log('[SimilarTopics] section changed from',
                    sectionAtStart, 'to', sectionId, '— retrying');
            }
        } else if (CONFIG.debug) {
            console.log('[SimilarTopics] section returned', threadsSeen,
                'threads — retrying (possible cold cache)');
        }

        candidates.length = 0;
        seen              = {};
        seen[topicId]     = true;
        hadError          = false;

        setTimeout(function () { runCollectWithRetry(attempt + 1); }, 800);
    });
}

    async function finish() {
        if (candidates.length === 0) {
            renderEmpty(hadError);
            return;
        }
        candidates.sort(function (a, b) { return b.score - a.score; });
        var threads = candidates.slice(0, CONFIG.limit).map(function (e) { return e.thread; });

        // Pre-fetch all starter avatars before building markup so the
        // initial render carries real avatars + group borders.
        await prefetchStarterUsers(threads);

        writeCache(threads);
        renderList(threads);
    }

    /* ================================================================
       CONTAINER
       ================================================================ */
    function findLastFooter() {
        var all = document.querySelectorAll('.footer');
        return all.length ? all[all.length - 1] : null;
    }

    /**
     * Resolve where the widget should go. Returns { el, position } or null.
     *
     * Preferred chain:
     *   1. Immediately after the modern fast-reply editor.
     *   2. Immediately after #modern-pagination (editor disabled / failed).
     *   3. Before the last .footer (breadcrumbs also failed).
     *   4. null → caller falls back to end of <body>.
     */
    function findInsertionPoint() {
        var editorEl = document.getElementById('modern-editor-fastreply');
        if (editorEl && editorEl.parentNode) {
            return { el: editorEl, position: 'afterend' };
        }

        var paginationEl = document.getElementById('modern-pagination');
        if (paginationEl && paginationEl.parentNode) {
            return { el: paginationEl, position: 'afterend' };
        }

        var footer = findLastFooter();
        if (footer && footer.parentNode) {
            return { el: footer, position: 'beforebegin' };
        }

        return null;
    }

    function injectContainer() {
        if (document.getElementById(CONFIG.containerId)) return;

        var html = '' +
            '<section id="' + CONFIG.containerId + '" class="similar-topics-section" aria-labelledby="similar-topics-title">' +
                '<header class="similar-topics-header">' +
                    '<h2 id="similar-topics-title" class="similar-topics-title">' +
                        '<i class="fa-regular fa-sparkles" aria-hidden="true"></i> Similar topics' +
                    '</h2>' +
                '</header>' +
                '<div class="similar-topics-list" role="list">' +
                    '<div class="similar-topics-loading">' +
                        '<i class="fa-regular fa-spinner fa-spin" aria-hidden="true"></i>' +
                        '<span>Finding similar topics…</span>' +
                    '</div>' +
                '</div>' +
            '</section>';

        var point = findInsertionPoint();
        if (point) {
            point.el.insertAdjacentHTML(point.position, html);
        } else {
            document.body.insertAdjacentHTML('beforeend', html);
        }
    }

    /* ================================================================
       RENDERING
       ================================================================ */
    function buildTopicCard(thread) {
    var start       = (thread.info && thread.info.start) ? thread.info.start : {};
    var starterId   = start.id   || 0;
    var starterName = decodeHtmlEntities(start.name || '') || 'Unknown';
    var titleText   = decodeHtmlEntities(thread.title  || '') || '(untitled)';
    var topicId     = thread.id;

    var user       = starterId ? userDataCache.get(starterId) : null;
    var avatarHtml = generateAvatarHtml(user, starterName, starterId, CONFIG.avatarSize);
    var profileUrl = starterId ? '/?act=Profile&MID=' + starterId : '#';
    var topicUrl   = '?t=' + topicId;

    return (
        '<article class="latest-post-card similar-topic-card" data-topic-id="' + topicId + '" role="listitem">' +
            '<div class="latest-post-avatar">' +
                '<a href="' + escapeHtml(profileUrl) + '" aria-label="View ' + escapeHtml(starterName) + '\'s profile" rel="nofollow">' +
                    avatarHtml +
                '</a>' +
            '</div>' +
            '<div class="latest-post-content">' +
                '<div class="latest-post-title">' +
                    '<a href="' + escapeHtml(topicUrl) + '">' + escapeHtml(titleText) + '</a>' +
                '</div>' +
                '<div class="latest-post-meta">' +
                    '<a href="' + escapeHtml(profileUrl) + '" class="latest-post-author" rel="nofollow">' + escapeHtml(starterName) + '</a>' +
                    '<button type="button" class="similar-topic-preview-toggle" ' +
                        'data-topic-id="' + topicId + '" ' +
                        'aria-expanded="false" ' +
                        'aria-controls="similar-topic-preview-' + topicId + '" ' +
                        'title="Show preview" aria-label="Show preview of this topic">' +
                        '<i class="fa-regular fa-eye" aria-hidden="true"></i>' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div id="similar-topic-preview-' + topicId + '" class="similar-topic-preview" aria-hidden="true"></div>' +
        '</article>'
    );
}

    function renderList(threads) {
        var listEl = document.querySelector('#' + CONFIG.containerId + ' .similar-topics-list');
        if (!listEl) return;

        if (threads.length === 0) {
            renderEmpty(false);
            return;
        }

        var html = '';
        for (var i = 0; i < threads.length; i++) {
            html += buildTopicCard(threads[i]);
        }
        listEl.innerHTML = html;

        attachPreviewHandlers(listEl);
    }

    function renderList(threads) {
    var listEl = document.querySelector('#' + CONFIG.containerId + ' .similar-topics-list');
    if (!listEl) return;

    if (threads.length === 0) {
        renderEmpty(false);
        return;
    }

    var html = '';
    for (var i = 0; i < threads.length; i++) {
        html += buildTopicCard(threads[i]);
    }
    listEl.innerHTML = html;

    if (window.emojiReplacer && typeof window.emojiReplacer.replaceSync === 'function') {
        window.emojiReplacer.replaceSync(listEl);
    } else if (window.twemoji && typeof window.twemoji.parse === 'function') {
        window.twemoji.parse(listEl, {
            folder: 'svg',
            ext: '.svg',
            base: 'https://twemoji.maxcdn.com/v/latest/',
            className: 'twemoji',
            size: 'svg'
        });
    }

    attachPreviewHandlers(listEl);
}
    /* ================================================================
       PREVIEW
       ================================================================ */
    function attachPreviewHandlers(root) {
        root.querySelectorAll('.similar-topic-preview-toggle').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                togglePreview(btn);
            });
        });
    }

    async function togglePreview(btn) {
    var topicId   = btn.getAttribute('data-topic-id');
    var previewEl = document.getElementById('similar-topic-preview-' + topicId);
    if (!previewEl) return;

    var isExpanded = btn.getAttribute('aria-expanded') === 'true';

    /* ---------------- COLLAPSE ---------------- */
    if (isExpanded) {
        // Pin current visible height so the transition has a concrete
        // starting value (open state uses max-height: none).
        previewEl.style.maxHeight = previewEl.scrollHeight + 'px';
        void previewEl.offsetHeight;                // force reflow
        previewEl.style.maxHeight = '0px';
        previewEl.setAttribute('aria-hidden', 'true');

        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('title', 'Show preview');
        btn.setAttribute('aria-label', 'Show preview of this topic');
        btn.setAttribute('data-tippy-content', '<div class="tip-plain">Show preview</div>');
        btn.innerHTML = '<i class="fa-regular fa-eye" aria-hidden="true"></i>';

        previewEl.addEventListener('transitionend', function onEnd(e) {
            if (e.propertyName !== 'max-height') return;
            previewEl.removeEventListener('transitionend', onEnd);
            previewEl.style.maxHeight = '';
        });
        return;
    }

    /* ---------------- EXPAND ---------------- */
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('title', 'Hide preview');
    btn.setAttribute('aria-label', 'Hide preview of this topic');
    btn.setAttribute('data-tippy-content', '<div class="tip-plain">Hide preview</div>');
    btn.innerHTML = '<i class="fa-regular fa-eye-slash" aria-hidden="true"></i>';
    previewEl.setAttribute('aria-hidden', 'false');

    // Already loaded → single animate-to-content pass.
    if (previewEl.dataset.loaded === 'true') {
        animateOpen(previewEl);
        return;
    }

    /* -------- First open: loading → content -------- */
    previewEl.innerHTML =
        '<div class="similar-topic-preview-loading">' +
            '<i class="fa-regular fa-spinner fa-spin" aria-hidden="true"></i> Loading preview…' +
        '</div>';
    animateOpen(previewEl);   // grows to the loading-spinner height

    try {
        var url = '/api.php?t=' + encodeURIComponent(topicId) + '&cookie=1';
        var response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var data = await response.json();
        var first = data && data.messages && data.messages[0];

        if (!first || !first.content) {
            previewEl.innerHTML =
                '<div class="similar-topic-preview-empty">' +
                    '<i class="fa-regular fa-circle-info" aria-hidden="true"></i> Preview not available.' +
                '</div>';
            animateOpen(previewEl);
            previewEl.dataset.loaded = 'true';
            return;
        }

        var contentHtml = '';
        if (window.ForumPostsModule &&
            typeof window.ForumPostsModule.transformContentHtml === 'function') {
            contentHtml = window.ForumPostsModule.transformContentHtml(first.content);
        } else {
            var text = stripHtml(first.content).replace(/\s+/g, ' ').trim();
            contentHtml = '<p>' + escapeHtml(truncate(text, CONFIG.previewMaxChars)) + '</p>';
        }

        if (!contentHtml.trim()) {
            previewEl.innerHTML =
                '<div class="similar-topic-preview-empty">' +
                    '<i class="fa-regular fa-circle-info" aria-hidden="true"></i> Preview not available.' +
                '</div>';
            animateOpen(previewEl);
            previewEl.dataset.loaded = 'true';
            return;
        }

        var continueUrl = '?t=' + topicId + '#entry' + first.id;

        previewEl.innerHTML =
            '<div class="modern-quote long-quote similar-topic-preview-quote">' +
                '<div class="quote-header">' +
                    '<div class="quote-meta">' +
                        '<div class="quote-icon"><i class="fa-regular fa-eye" aria-hidden="true"></i></div>' +
                        '<div class="quote-info"><span class="quote-author">Preview</span></div>' +
                    '</div>' +
                '</div>' +
                '<div class="quote-content">' + contentHtml + '</div>' +
                '<button class="quote-expand-btn" type="button" aria-expanded="false" aria-label="Show full preview">' +
                    '<i class="fa-regular fa-angle-down" aria-hidden="true"></i> <span class="expand-text">Show more</span>' +
                '</button>' +
            '</div>' +
            '<a href="' + escapeHtml(continueUrl) + '" class="similar-topic-continue">' +
                'Continue reading <i class="fa-regular fa-arrow-right" aria-hidden="true"></i>' +
            '</a>';

        // Wait for images to settle + initQuotesAndSpoilers to decide
        // whether the inner expand button stays, THEN grow from the
        // loading-spinner height to the real content height.
        if (window.ForumPostsModule &&
            typeof window.ForumPostsModule.postProcessPreviewContent === 'function') {
            await window.ForumPostsModule.postProcessPreviewContent(previewEl);
        }
        animateOpen(previewEl);

        previewEl.dataset.loaded = 'true';
    } catch (e) {
        previewEl.innerHTML =
            '<div class="similar-topic-preview-empty">' +
                '<i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i> Could not load preview.' +
            '</div>';
        animateOpen(previewEl);
    }
}

/**
 * Grow previewEl to its natural content height. Assumes the element is
 * already in the open state (aria-hidden="false", visibility: visible).
 * Leaves max-height: none at the end so later inner-quote expand/
 * collapse keeps pushing the outer container height naturally.
 */
function animateOpen(previewEl) {
    var target = previewEl.scrollHeight;

    // If we're already mid-transition (loading → content), the browser
    // has an in-flight max-height value on the element. Capture it so
    // the second animation starts from where the first one is now,
    // not from a stale inline value.
    var current = parseFloat(previewEl.style.maxHeight) || 0;

    if (Math.abs(current - target) < 1) {
        previewEl.style.maxHeight = 'none';
        return;
    }

    previewEl.style.maxHeight = target + 'px';

    var onEnd = function (e) {
        if (e.propertyName !== 'max-height') return;
        previewEl.removeEventListener('transitionend', onEnd);
        previewEl.style.maxHeight = 'none';
    };
    previewEl.addEventListener('transitionend', onEnd);
}
    /* ================================================================
       LIFECYCLE
       ================================================================ */
    var _initRetryTimer = null;

function initialize() {
    if (initialized) return Promise.resolve();

    if (CONFIG.firstPageOnly) {
        var params = new URLSearchParams(window.location.search);
        if (parseInt(params.get('st') || '0', 10) > 0) {
            initialized = true;
            return Promise.resolve();
        }
    }

    var ctx = getTopicContext();
    if (CONFIG.debug) console.log('[SimilarTopics] context:', ctx);

    var missing =
        !ctx ||
        !ctx.topicId ||
        !ctx.sectionId ||
        !ctx.title;

    if (missing) {
        // Retry a bounded number of times. Timing matters: the module can
        // be invoked before the title element is parsed or before
        // Commons finishes populating, especially on direct external
        // navigation to a topic page ≥ 2. Marking `initialized = true`
        // here would lock the module into a permanently failed state,
        // so the flag stays false until we have a valid context.
        if (!_initRetryTimer) {
            _initRetryTimer = setTimeout(function () {
                _initRetryTimer = null;
                initialize();
            }, 250);
        }
        return Promise.resolve();
    }

    // ── Commit point ─────────────────────────────────────────────
    // Context is valid. Every failure past this line is a permanent
    // verdict for this page load (blacklist, all-stop-word title,
    // etc.), not a timing issue, so retrying would be pointless.
    initialized = true;
    if (_initRetryTimer) {
        clearTimeout(_initRetryTimer);
        _initRetryTimer = null;
    }

    // Blacklist / whitelist. Section is now known to be valid, so
    // these verdicts are final — no retry needed.
    if (CONFIG.blacklist.length &&
        (CONFIG.blacklist.indexOf(ctx.sectionId) !== -1 ||
         CONFIG.blacklist.indexOf(String(ctx.sectionId)) !== -1)) return Promise.resolve();
    if (CONFIG.whitelist.length &&
        CONFIG.whitelist.indexOf(ctx.sectionId) === -1 &&
        CONFIG.whitelist.indexOf(String(ctx.sectionId)) === -1) return Promise.resolve();

    topicId   = ctx.topicId;
    sectionId = ctx.sectionId;
    domain    = document.domain;

    queryTokens = tokenize(ctx.title);
    if (!queryTokens.length) return Promise.resolve();

    effectiveMinHits = (queryTokens.length > CONFIG.minHits)
        ? CONFIG.minHits
        : Math.max(1, queryTokens.length - 1);

    cacheKey = CONFIG.cachePrefix + topicId;

    injectContainer();

var cached = readCache();
if (cached) {
    prefetchStarterUsers(cached).then(function () {
        renderList(cached);
    });
    return Promise.resolve();
}

candidates.length = 0;
seen              = {};
seen[topicId]     = true;
hadError          = false;

runCollectWithRetry(0);
return Promise.resolve();
}

    function reset() {
    initialized = false;
    if (_initRetryTimer) {
        clearTimeout(_initRetryTimer);
        _initRetryTimer = null;
    }
    topicId     = null;
    sectionId   = null;
    domain      = '';
    queryTokens = [];
    effectiveMinHits = 0;
    cacheKey    = null;
    candidates  = [];
    seen        = {};
    hadError    = false;
    userDataCache.clear();
    var root = document.getElementById(CONFIG.containerId);
    if (root) root.remove();
}

    return {
        initialize: initialize,
        reset:      reset,
        name:       'similar-topics',
        dependencies: []
    };
})();

if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', function (e) {
        if (!e.persisted) return;
        if (document.body.id !== 'topic') return;
        SimilarTopicsModule.reset();
        SimilarTopicsModule.initialize();
    });
}
