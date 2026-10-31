/**
 * SimilarTopicsModule
 *
 * Finds up to `limit` topics whose title + description share at least
 * `minHits` tokens with the current topic's title, and renders them as
 * modern cards below the topic page (below the fast-reply editor when
 * it exists, below pagination otherwise).
 *
 * Avatars come from /api.php?mid=<starterId> — same endpoint posts.js
 * uses — so they carry correct group classes (border colours come from
 * .mini-avatar.group-* in modern-forum.css). Initial-letter avatars are
 * rendered immediately as placeholders while the API resolves.
 *
 * Read-only, per-page-load operation — no forumObserver registration,
 * no re-runs. Results cached per topic in sessionStorage.
 *
 * Registered with ForumEnhancer via registerModule(), not via the
 * observer.
 */
var SimilarTopicsModule = (function () {
    'use strict';

    /* ---- Config ---------------------------------------------------- */
    var CONFIG = {
        // Widget
        rootId:         'similar-topics',
        styleId:        'similar-topics-style',
        limit:          5,
        maxPages:       20,
        pageSize:       30,
        minHits:        2,
        avatarSize:     40,
        previewMaxChars: 450,

        // Gates
        firstPageOnly:  false,   // true → first page only
        whitelist:      [],      // section IDs to run in (empty = all)
        blacklist:      [],      // section IDs to skip

        // Cache
        enableCache:    true,
        cachePrefix:    'similar-topics:',
        cacheTtlMs:     6 * 60 * 60 * 1000,

        // Debug
        debug:          false
    };

    /* ---- Stop words (English + Italian) --------------------------- */
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

    /* ---- Avatar palette (mirrors posts.js) ------------------------ */
    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    /* ---- State ---------------------------------------------------- */
    var state = {
        initialized:     false,
        topicId:         null,
        sectionId:       null,
        domain:          '',
        queryTokens:     [],
        effectiveMinHits: 0,
        cacheKey:        null,
        userCache:       new Map(),
        candidates:      [],
        seen:            {},
        hadError:        false
    };

    /* ---- Text helpers --------------------------------------------- */
    function stripDiacritics(s) {
        return s.normalize
            ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            : s;
    }

    function tokenize(text) {
        if (!text) return [];
        var s = stripDiacritics(String(text)).toLowerCase();
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
        return s.slice(0, n).replace(/\s+\S*$/, '') + '...';
    }

    function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    /* ---- Avatar helpers (mirrors posts.js behaviour) -------------- */
    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function getInitialFromName(name) {
        if (!name || typeof name !== 'string') return '?';
        var m = name.match(/[\p{L}\p{N}]/u);
        if (!m) return '?';
        return m[0].toUpperCase();
    }

    function isDefaultAvatarUrl(url) {
        if (!url) return true;
        var lower = url.toLowerCase();
        return lower.indexOf('style_images/default_avatar.png') !== -1 ||
               lower.indexOf('default_avatar') !== -1;
    }

    function optimizeAvatarUrl(url, size) {
        if (!url) return null;
        var trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return null;
        if (trimmed.indexOf('weserv.nl') !== -1) return trimmed;
        if (trimmed.charAt(0) === '/' && trimmed.charAt(1) === '/') trimmed = 'https:' + trimmed;
        if (trimmed.indexOf('http://') === 0 && window.location.protocol === 'https:') {
            trimmed = trimmed.replace('http://', 'https://');
        }
        return 'https://images.weserv.nl/?url=' + encodeURIComponent(trimmed) +
            '&output=webp&maxage=1y&q=85&w=' + size + '&h=' + size +
            '&fit=cover&a=attention&il';
    }

    function getGroupClass(user) {
        if (!user || !user.group) return 'group-member';
        var cls  = (user.group.class || '').toLowerCase();
        var name = (user.group.name || '').toLowerCase();
        var body = (user.group.bodyclass || '').toLowerCase();

        if (cls.indexOf('founder') !== -1 || body.indexOf('founder') !== -1 || name === 'founder') return 'group-founder';
        if (cls.indexOf('admin') !== -1 || name === 'administrator') return 'group-administrator';
        if (cls.indexOf('global_mod') !== -1 || name === 'global moderator') return 'group-global-moderator';
        if (cls.indexOf('mod') !== -1 || name === 'moderator') return 'group-moderator';
        if (cls.indexOf('developer') !== -1) return 'group-developer';
        if (cls.indexOf('game_dev') !== -1) return 'group-game-dev';
        if (name === 'fan') return 'group-fan';
        return 'group-member';
    }

    function initialAvatarHtml(username, userId, size) {
        var initial = getInitialFromName(username);
        var color = getColorFromNickname(username, userId);
        return '<span class="mini-avatar mini-avatar--initial group-member" ' +
            'style="background-color: #' + color + ';' +
            'width: ' + size + 'px; height: ' + size + 'px;' +
            'font-size: ' + Math.round(size * 0.5) + 'px; line-height: ' + size + 'px;">' +
            escapeHtml(initial) + '</span>';
    }

    function userAvatarHtml(user, username, userId, size) {
        if (!user || !user.avatar || isDefaultAvatarUrl(user.avatar)) {
            return initialAvatarHtml(username, userId, size);
        }
        var optimized = optimizeAvatarUrl(user.avatar, size);
        if (!optimized) return initialAvatarHtml(username, userId, size);
        var groupClass = getGroupClass(user);
        return '<img class="mini-avatar ' + groupClass + '" ' +
            'src="' + escapeHtml(optimized) + '" ' +
            'alt="" width="' + size + '" height="' + size + '" ' +
            'loading="lazy" decoding="async">';
    }

    function fetchUser(mid) {
        if (!mid) return Promise.resolve(null);
        var key = String(mid);
        if (state.userCache.has(key)) return Promise.resolve(state.userCache.get(key));
        return fetch('/api.php?mid=' + encodeURIComponent(mid), { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return null;
                var user = data['m' + mid] || data.info;
                if (user && user.id) {
                    state.userCache.set(key, user);
                    return user;
                }
                return null;
            })
            .catch(function () { return null; });
    }

    /* ---- Cache ---------------------------------------------------- */
    function readCache() {
        if (!CONFIG.enableCache || !state.cacheKey) return null;
        try {
            var raw = sessionStorage.getItem(state.cacheKey);
            if (!raw) return null;
            var obj = JSON.parse(raw);
            if (!obj || typeof obj.ts !== 'number') return null;
            if (Date.now() - obj.ts > CONFIG.cacheTtlMs) {
                sessionStorage.removeItem(state.cacheKey);
                return null;
            }
            return Array.isArray(obj.items) ? obj.items : null;
        } catch (e) { return null; }
    }

    function writeCache(items) {
        if (!CONFIG.enableCache || !state.cacheKey) return;
        try {
            sessionStorage.setItem(state.cacheKey, JSON.stringify({ ts: Date.now(), items: items }));
        } catch (e) { /* quota — ignore */ }
    }

    /* ---- Context resolution (Commons optional) -------------------- */
    function getTopicContext() {
        if (window.Commons && window.Commons.location && window.Commons.location.topic) {
            var c = window.Commons.location;
            if (c.isTopic && c.topic.id) {
                return { topicId: c.topic.id, sectionId: c.section.id, title: c.topic.title || '' };
            }
        }

        var isTopic = document.body.id === 'topic' ||
                      /(?:^|\s)t\d+(?:\s|$)/.test(document.body.className);
        if (!isTopic) return null;

        var params = new URLSearchParams(window.location.search);

        var topicId = parseInt(params.get('t') || '0', 10);
        if (!topicId) {
            var tm = document.body.className.match(/(?:^|\s)t(\d+)(?:\s|$)/);
            if (tm) topicId = parseInt(tm[1], 10);
        }

        var sectionId = parseInt(params.get('f') || '0', 10);
        if (!sectionId) {
            var fm = document.body.className.match(/(?:^|\s)f(\d+)(?:\s|$)/);
            if (fm) sectionId = parseInt(fm[1], 10);
        }
        if (!sectionId) {
            var navLink = document.querySelector('.nav a[href*="?f="]');
            if (navLink) {
                var fm2 = navLink.href.match(/[?&]f=(\d+)/);
                if (fm2) sectionId = parseInt(fm2[1], 10);
            }
        }

        var title = '';
        var titleEl = document.querySelector('div.mtitle h1, h1.mtitle, h2.mtitle, .topic .mback .mtitle');
        if (titleEl) title = titleEl.textContent.trim();

        return { topicId: topicId, sectionId: sectionId, title: title };
    }

    /* ---- Styles --------------------------------------------------- */
    function injectStyles() {
        if (document.getElementById(CONFIG.styleId)) return;
        var css = '';
        css += '#similar-topics.modern-similar-topics { margin: var(--space-lg) 0; font-family: var(--font-primary); }';
        css += '.modern-similar-topics-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: var(--space-sm); border-bottom: 2px solid var(--primary-color); margin-bottom: var(--space-md); gap: var(--space-md); }';
        css += '.modern-similar-topics-title { display: flex; align-items: center; gap: var(--space-xs); font-family: var(--font-heading); font-size: var(--text-xl); font-weight: 400; color: var(--text-primary); margin: 0; text-align: left; }';
        css += '.modern-similar-topics-title i { color: var(--primary-light); font-size: 0.9em; }';
        css += '.modern-similar-topics-count { display: inline-flex; align-items: center; padding: 2px 10px; background: var(--hover-color); border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: 600; color: var(--text-tertiary); white-space: nowrap; }';
        css += '.modern-similar-topics-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-md); }';
        css += '.modern-similar-topic { display: flex; align-items: flex-start; gap: var(--space-md); padding: var(--pad-4); background: var(--surface-color); border: 1px solid var(--border-color); border-radius: var(--radius); transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease; }';
        css += '.modern-similar-topic:hover { border-color: var(--primary-color); box-shadow: var(--shadow-sm); transform: translateY(-1px); }';
        css += '.modern-similar-topic-avatar-link { flex-shrink: 0; text-decoration: none; display: block; line-height: 0; }';
        css += '.modern-similar-topic .mini-avatar { width: 40px; height: 40px; font-size: 20px; line-height: 40px; margin-right: 0; }';
        css += '.modern-similar-topic-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--space-xs); }';
        css += '.modern-similar-topic-title { margin: 0; font-family: var(--font-primary); font-size: var(--text-base); font-weight: 600; line-height: 1.4; display: flex; text-align: left; }';
        css += '.modern-similar-topic-title a { color: var(--text-primary); text-decoration: none; transition: color 0.2s ease; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }';
        css += '.modern-similar-topic-title a:hover { color: var(--primary-light); text-decoration: underline; }';
        css += '.modern-similar-topic-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-sm); font-size: var(--text-xs); color: var(--text-secondary); }';
        css += '.modern-similar-topic-author { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }';
        css += '.modern-similar-topic-author i { color: var(--primary-light); font-size: 0.85em; flex-shrink: 0; }';
        css += '.modern-similar-topic-author a { color: var(--text-secondary); text-decoration: none; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }';
        css += '.modern-similar-topic-author a:hover { color: var(--primary-light); text-decoration: underline; }';
        css += '.modern-similar-topic-preview-btn { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; background: transparent; border: 1px solid var(--border-color); border-radius: var(--radius-full); color: var(--text-secondary); font-family: inherit; font-size: var(--text-xs); font-weight: 500; cursor: pointer; transition: all 0.2s ease; margin-left: auto; }';
        css += '.modern-similar-topic-preview-btn:hover { background: var(--hover-color); border-color: var(--primary-color); color: var(--text-primary); }';
        css += '.modern-similar-topic-preview-btn i { color: var(--primary-light); font-size: 0.85em; }';
        css += '.modern-similar-topic-preview-btn .preview-icon { transition: transform 0.2s ease; }';
        css += '.modern-similar-topic-preview-btn[aria-expanded="true"] .preview-icon { transform: rotate(180deg); }';
        css += '.modern-similar-topic-preview { margin-top: var(--space-xs); animation: modern-similar-fade-in 0.25s ease; }';
        css += '.modern-similar-topic-preview[hidden] { display: none !important; }';
        css += '.modern-similar-topic-preview-text { margin: 0 0 var(--space-xs) 0; padding: var(--pad-3) var(--pad-4); background: var(--bg-color); border-left: 3px solid var(--primary-color); border-radius: var(--radius-sm); font-size: var(--text-xs); line-height: 1.6; color: var(--text-secondary); text-align: left; }';
        css += '.modern-similar-topic-preview-link { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--primary-color); font-weight: 500; text-decoration: none; transition: color 0.2s ease; }';
        css += '.modern-similar-topic-preview-link:hover { color: var(--primary-light); text-decoration: underline; }';
        css += '.modern-similar-topic-preview-link i { font-size: 0.85em; transition: transform 0.2s ease; }';
        css += '.modern-similar-topic-preview-link:hover i { transform: translateX(2px); }';
        css += '.modern-similar-topics-loading { display: flex; align-items: center; justify-content: center; gap: var(--space-sm); padding: var(--space-lg); color: var(--text-tertiary); font-size: var(--text-sm); }';
        css += '.modern-similar-topics-loading .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border-color); border-top-color: var(--primary-color); border-radius: 50%; animation: modern-similar-spin 0.8s linear infinite; }';
        css += '.modern-similar-topics-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-sm); padding: var(--space-xl) var(--space-md); color: var(--text-tertiary); font-size: var(--text-sm); text-align: center; }';
        css += '.modern-similar-topics-empty i { font-size: 2rem; color: var(--text-muted); }';
        css += '@keyframes modern-similar-spin { to { transform: rotate(360deg); } }';
        css += '@keyframes modern-similar-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }';
        css += '@media (max-width: 680px) { .modern-similar-topics-list { grid-template-columns: 1fr; } .modern-similar-topics-title { font-size: var(--text-lg); } }';

        var style = document.createElement('style');
        style.id = CONFIG.styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    /* ---- Container ------------------------------------------------- */
    function findLastFooter() {
        var all = document.querySelectorAll('.footer');
        return all.length ? all[all.length - 1] : null;
    }

    function findInsertionPoint() {
        var editorEl = document.getElementById('modern-editor-fastreply');
        if (editorEl && editorEl.parentNode) return { el: editorEl, position: 'afterend' };
        var paginationEl = document.getElementById('modern-pagination');
        if (paginationEl && paginationEl.parentNode) return { el: paginationEl, position: 'afterend' };
        var footer = findLastFooter();
        if (footer && footer.parentNode) return { el: footer, position: 'beforebegin' };
        return null;
    }

    function injectContainer() {
        if (document.getElementById(CONFIG.rootId)) return;

        var h = '';
        h += '<section id="' + CONFIG.rootId + '" class="modern-similar-topics" aria-label="Similar topics">';
        h +=   '<header class="modern-similar-topics-header">';
        h +=     '<h2 class="modern-similar-topics-title">';
        h +=       '<i class="fa-regular fa-comments" aria-hidden="true"></i>';
        h +=       '<span>Similar Topics</span>';
        h +=     '</h2>';
        h +=   '</header>';
        h +=   '<div class="modern-similar-topics-loading">';
        h +=     '<span class="spinner" aria-hidden="true"></span>';
        h +=     '<span>Finding similar topics…</span>';
        h +=   '</div>';
        h += '</section>';

        var point = findInsertionPoint();
        if (point) point.el.insertAdjacentHTML(point.position, h);
        else document.body.insertAdjacentHTML('beforeend', h);
    }

    /* ---- Scoring --------------------------------------------------- */
    function scoreCandidate(thread) {
        var titleTokens = tokenize(stripHtml(thread.title || ''));
        var descTokens  = tokenize(stripHtml(thread.desc  || ''));

        var titleSet = {}, descSet = {}, i;
        for (i = 0; i < titleTokens.length; i++) titleSet[titleTokens[i]] = true;
        for (i = 0; i < descTokens.length;  i++) descSet[descTokens[i]]  = true;

        var hits = 0, weighted = 0;
        for (i = 0; i < state.queryTokens.length; i++) {
            var q = state.queryTokens[i];
            if (titleSet[q])      { hits++; weighted += 1.5; }
            else if (descSet[q])  { hits++; weighted += 1;   }
        }

        if (!hits || hits < state.effectiveMinHits) return null;

        var coverage = hits / state.queryTokens.length;
        return {
            thread: thread,
            score:  coverage * (1 + weighted / (state.queryTokens.length * 1.5))
        };
    }

    /* ---- Fetch + scan ---------------------------------------------- */
    function fetchPage(offset) {
        var url = '/api.php?f=' + state.sectionId + '&st=' + offset + '&cookie=1';
        return fetch(url, { credentials: 'include' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    function consumePage(data) {
        var threads = (data.articles && data.articles.length) ? data.articles : (data.threads || []);
        for (var i = 0; i < threads.length; i++) {
            var t = threads[i];
            if (!t || state.seen[t.id]) continue;
            state.seen[t.id] = true;
            var scored = scoreCandidate(t);
            if (scored) state.candidates.push(scored);
        }
    }

    function collect() {
        var page = 0;
        var totalPages = 1;

        function step() {
            if (page >= CONFIG.maxPages) return finish();
            if (page > 0 && page >= totalPages) return finish();
            if (state.candidates.length >= CONFIG.limit * 2) return finish();

            fetchPage(page * CONFIG.pageSize)
                .then(function (data) {
                    if (!data || !data.info) { finish(); return; }
                    totalPages = data.info.pages || 1;
                    consumePage(data);
                    page++;
                    step();
                })
                .catch(function () { state.hadError = true; finish(); });
        }
        step();
    }

    function finish() {
        if (state.candidates.length === 0) {
            renderEmpty(state.hadError);
            return;
        }
        state.candidates.sort(function (a, b) { return b.score - a.score; });
        var threads = state.candidates.slice(0, CONFIG.limit).map(function (e) { return e.thread; });
        writeCache(threads);
        renderList(threads);
    }

    /* ---- Render ---------------------------------------------------- */
    function buildCardHtml(thread) {
        var start       = (thread.info && thread.info.start) ? thread.info.start : {};
        var starterId   = start.id   || 0;
        var starterName = start.name || 'Unknown';
        var title       = thread.title || '(untitled)';
        var topicId     = thread.id;
        var previewId   = 'similar-preview-' + topicId;
        var avatarHtml  = initialAvatarHtml(starterName, starterId, CONFIG.avatarSize);

        var h = '';
        h += '<article class="modern-similar-topic" data-topic-id="' + topicId + '">';
        h +=   '<a class="modern-similar-topic-avatar-link" href="//' + state.domain + '/?act=Profile&MID=' + starterId + '" ' +
        h +=      'aria-label="View ' + escapeHtml(starterName) + '\'s profile">';
        h +=     avatarHtml;
        h +=   '</a>';
        h +=   '<div class="modern-similar-topic-body">';
        h +=     '<h3 class="modern-similar-topic-title">';
        h +=       '<a href="?t=' + topicId + '">' + escapeHtml(title) + '</a>';
        h +=     '</h3>';
        h +=     '<div class="modern-similar-topic-meta">';
        h +=       '<span class="modern-similar-topic-author">';
        h +=         '<i class="fa-regular fa-user" aria-hidden="true"></i>';
        h +=         '<a href="//' + state.domain + '/?act=Profile&MID=' + starterId + '">' + escapeHtml(starterName) + '</a>';
        h +=       '</span>';
        h +=       '<button class="modern-similar-topic-preview-btn" type="button" ' +
        h +=               'aria-expanded="false" aria-controls="' + previewId + '" ' +
        h +=               'data-topic-id="' + topicId + '">';
        h +=         '<i class="fa-regular fa-eye" aria-hidden="true"></i>';
        h +=         '<span class="preview-label">Preview</span>';
        h +=         '<i class="fa-regular fa-angle-down preview-icon" aria-hidden="true"></i>';
        h +=       '</button>';
        h +=     '</div>';
        h +=     '<div class="modern-similar-topic-preview" id="' + previewId + '" hidden></div>';
        h +=   '</div>';
        h += '</article>';
        return h;
    }

    function renderList(threads) {
        var root = document.getElementById(CONFIG.rootId);
        if (!root) return;

        var countText = threads.length === 1 ? '1 result' : threads.length + ' results';

        var h = '';
        h += '<header class="modern-similar-topics-header">';
        h +=   '<h2 class="modern-similar-topics-title">';
        h +=     '<i class="fa-regular fa-comments" aria-hidden="true"></i>';
        h +=     '<span>Similar Topics</span>';
        h +=   '</h2>';
        h +=   '<span class="modern-similar-topics-count">' + countText + '</span>';
        h += '</header>';
        h += '<div class="modern-similar-topics-list">';
        for (var i = 0; i < threads.length; i++) h += buildCardHtml(threads[i]);
        h += '</div>';
        root.innerHTML = h;

        root.querySelectorAll('.modern-similar-topic-preview-btn').forEach(function (btn) {
            btn.addEventListener('click', handlePreviewClick);
        });

        upgradeAvatars(threads, root);
    }

    function renderEmpty(hadError) {
        var root = document.getElementById(CONFIG.rootId);
        if (!root) return;

        var message = hadError ? 'Could not load similar topics.' : 'No similar topics found.';

        var h = '';
        h += '<header class="modern-similar-topics-header">';
        h +=   '<h2 class="modern-similar-topics-title">';
        h +=     '<i class="fa-regular fa-comments" aria-hidden="true"></i>';
        h +=     '<span>Similar Topics</span>';
        h +=   '</h2>';
        h += '</header>';
        h += '<div class="modern-similar-topics-empty">';
        h +=   '<i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>';
        h +=   '<span>' + message + '</span>';
        h += '</div>';
        root.innerHTML = h;
    }

    /* ---- Async avatar upgrade ------------------------------------- */
    function upgradeAvatars(threads, root) {
        var mids = [];
        threads.forEach(function (t) {
            var sid = (t.info && t.info.start && t.info.start.id) || 0;
            if (sid && mids.indexOf(String(sid)) === -1) mids.push(String(sid));
        });
        if (mids.length === 0) return;

        Promise.all(mids.map(fetchUser)).then(function () {
            threads.forEach(function (t) {
                var start = (t.info && t.info.start) ? t.info.start : {};
                var sid   = start.id || 0;
                var name  = start.name || 'Unknown';
                if (!sid) return;
                var user = state.userCache.get(String(sid));
                if (!user) return;
                var card = root.querySelector('.modern-similar-topic[data-topic-id="' + t.id + '"]');
                if (!card) return;
                var link = card.querySelector('.modern-similar-topic-avatar-link');
                if (!link) return;
                link.innerHTML = userAvatarHtml(user, name, sid, CONFIG.avatarSize);
            });
        });
    }

    /* ---- Preview toggle ------------------------------------------- */
    function handlePreviewClick(e) {
        e.preventDefault();
        var btn = e.currentTarget;
        var topicId = btn.getAttribute('data-topic-id');
        if (!topicId) return;

        var card = btn.closest('.modern-similar-topic');
        if (!card) return;
        var preview = card.querySelector('.modern-similar-topic-preview');
        if (!preview) return;

        var isExpanded = btn.getAttribute('aria-expanded') === 'true';
        var label = btn.querySelector('.preview-label');

        if (isExpanded) {
            preview.setAttribute('hidden', '');
            btn.setAttribute('aria-expanded', 'false');
            if (label) label.textContent = 'Preview';
            return;
        }

        if (preview.getAttribute('data-loaded') === '1') {
            preview.removeAttribute('hidden');
            btn.setAttribute('aria-expanded', 'true');
            if (label) label.textContent = 'Hide';
            return;
        }

        preview.innerHTML = '<div class="modern-similar-topics-loading">' +
            '<span class="spinner" aria-hidden="true"></span>' +
            '<span>Loading preview…</span>' +
            '</div>';
        preview.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        if (label) label.textContent = 'Hide';

        fetch('//' + state.domain + '/api.php?t=' + topicId + '&cookie=1', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var first = data && data.messages && data.messages[0];
                if (!first) {
                    preview.innerHTML = '<div class="modern-similar-topic-preview-text">Preview not available.</div>';
                    preview.setAttribute('data-loaded', '1');
                    return;
                }
                var text = stripHtml(first.content || '').replace(/\s+/g, ' ').trim();
                var url = '?t=' + topicId + '#entry' + first.id;
                preview.innerHTML =
                    '<div class="modern-similar-topic-preview-text">' + escapeHtml(truncate(text, CONFIG.previewMaxChars)) + '</div>' +
                    '<a href="' + url + '" class="modern-similar-topic-preview-link">' +
                        'Read more <i class="fa-regular fa-arrow-right" aria-hidden="true"></i>' +
                    '</a>';
                preview.setAttribute('data-loaded', '1');
            })
            .catch(function () {
                preview.innerHTML = '<div class="modern-similar-topic-preview-text">Could not load preview.</div>';
                preview.setAttribute('data-loaded', '1');
            });
    }

    /* ---- Lifecycle ------------------------------------------------- */
    function initialize() {
        if (state.initialized) return Promise.resolve();
        state.initialized = true;

        if (CONFIG.firstPageOnly) {
            var params = new URLSearchParams(window.location.search);
            if (parseInt(params.get('st') || '0', 10) > 0) return Promise.resolve();
        }

        var ctx = getTopicContext();
        if (CONFIG.debug) console.log('[SimilarTopics] context:', ctx);
        if (!ctx || !ctx.topicId || !ctx.sectionId || !ctx.title) return Promise.resolve();

        if (CONFIG.blacklist.length &&
            (CONFIG.blacklist.indexOf(ctx.sectionId) !== -1 ||
             CONFIG.blacklist.indexOf(String(ctx.sectionId)) !== -1)) return Promise.resolve();
        if (CONFIG.whitelist.length &&
            CONFIG.whitelist.indexOf(ctx.sectionId) === -1 &&
            CONFIG.whitelist.indexOf(String(ctx.sectionId)) === -1) return Promise.resolve();

        state.topicId   = ctx.topicId;
        state.sectionId = ctx.sectionId;
        state.domain    = document.domain;

        state.queryTokens = tokenize(ctx.title);
        if (!state.queryTokens.length) return Promise.resolve();

        state.effectiveMinHits = (state.queryTokens.length > CONFIG.minHits)
            ? CONFIG.minHits
            : Math.max(1, state.queryTokens.length - 1);

        state.cacheKey = CONFIG.cachePrefix + state.topicId;
        state.seen = {};
        state.seen[state.topicId] = true;
        state.candidates = [];
        state.hadError = false;

        injectStyles();
        injectContainer();

        var cached = readCache();
        if (cached) {
            renderList(cached);
            return Promise.resolve();
        }

        collect();
        return Promise.resolve();
    }

    function reset() {
        state.initialized = false;
        state.topicId     = null;
        state.sectionId   = null;
        state.domain      = '';
        state.queryTokens = [];
        state.effectiveMinHits = 0;
        state.cacheKey    = null;
        state.candidates  = [];
        state.seen        = {};
        state.hadError    = false;
        state.userCache.clear();

        var root = document.getElementById(CONFIG.rootId);
        if (root) root.remove();
    }

    return {
        initialize:   initialize,
        reset:        reset,
        name:         'similar-topics',
        dependencies: []
    };
})();

if (typeof window !== 'undefined') {
    window.SimilarTopicsModule = SimilarTopicsModule;
    window.dispatchEvent(new CustomEvent('similar-topics-module-ready'));
}
