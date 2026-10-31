/**
 * SimilarTopicsModule
 *
 * Scans the current topic's section via /api.php?f=<sectionId> and
 * finds up to `limit` topics whose title + description share at least
 * `minHits` tokens with the current topic's title.
 *
 * Renders the list into a `#ds_rt` element injected before the last
 * .footer on the page.
 *
 * Read-only, per-page-load operation — no forumObserver registration,
 * no re-runs. Results cached per topic in sessionStorage (optional;
 * only used when firstPageOnly is false).
 *
 * Registered with ForumEnhancer via registerModule(), not via the
 * observer.
 */
var SimilarTopicsModule = (function () {
    'use strict';

    /* ---- Config ---------------------------------------------------- */
    var CONFIG = {
        // Widget
        rootId:    'ds_rt',
        styleId:   'similar-topics-style',
        limit:     5,
        maxPages:  20,
        pageSize:  30,
        minHits:   2,

        // Gates
        firstPageOnly: true,     // set false to run on every topic page
        whitelist:     [],       // section IDs to run in (empty = all)
        blacklist:     [],       // section IDs to skip

        // Cache (only relevant when firstPageOnly === false)
        enableCache: true,
        cachePrefix: 'similar-topics:',
        cacheTtlMs:  6 * 60 * 60 * 1000,

        // Fast preview
        fastPreview:    true,
        previewMaxChars: 450,
        // Debug (set true to log context resolution)
    debug: false
    };

    /* ---- Stop words (English + Italian, ASCII-folded) ------------- */
    var STOP_WORDS = {};
    [
        // English
        'a','an','and','are','as','at','be','but','by','for','from','has','have',
        'how','i','in','is','it','its','of','on','or','that','the','this','to',
        'was','were','what','when','where','which','who','will','with','you',
        // Italian
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

    /* ---- State ----------------------------------------------------- */
    var initialized = false;
    var topicId     = null;
    var sectionId   = null;
    var domain      = '';
    var queryTokens = [];
    var effectiveMinHits = 0;
    var cacheKey    = null;

    /* ---- Text helpers ---------------------------------------------- */
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

    /* ---- Cache ----------------------------------------------------- */
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

    /* ---- Context resolution (Commons optional) ---------------------- */
function getTopicContext() {
    // Fast path: Commons, when available and populated.
    if (window.Commons && window.Commons.location && window.Commons.location.topic) {
        var c = window.Commons.location;
        if (c.isTopic && c.topic.id) {
            return {
                topicId:   c.topic.id,
                sectionId: c.section.id,
                title:     c.topic.title || ''
            };
        }
    }

    // Slow path: read the DOM directly. Same logic the standalone used.
    var isTopic = document.body.id === 'topic' ||
                  /(?:^|\s)t\d+(?:\s|$)/.test(document.body.className);
    if (!isTopic) return null;

    var params = new URLSearchParams(window.location.search);

    var topicId = parseInt(params.get('t') || '0', 10);
    if (!topicId) {
        var tMatch = document.body.className.match(/(?:^|\s)t(\d+)(?:\s|$)/);
        if (tMatch) topicId = parseInt(tMatch[1], 10);
    }

    var sectionId = parseInt(params.get('f') || '0', 10);
    if (!sectionId) {
        var fMatch = document.body.className.match(/(?:^|\s)f(\d+)(?:\s|$)/);
        if (fMatch) sectionId = parseInt(fMatch[1], 10);
    }
    if (!sectionId) {
        var navLink = document.querySelector('.nav a[href*="?f="]');
        if (navLink) {
            var fMatch2 = navLink.href.match(/[?&]f=(\d+)/);
            if (fMatch2) sectionId = parseInt(fMatch2[1], 10);
        }
    }

    var title = '';
    var titleEl = document.querySelector(
        'div.mtitle h1, h1.mtitle, h2.mtitle, .topic .mback .mtitle'
    );
    if (titleEl) title = titleEl.textContent.trim();

    return { topicId: topicId, sectionId: sectionId, title: title };
}

    /* ---- Styles ---------------------------------------------------- */
    function injectStyles() {
        if (document.getElementById(CONFIG.styleId)) return;
        var css = '';
        css += '#ds_rt.info { list-style-type: none; margin: 20px 0; padding: 0; }';
        css += '#ds_rt.info .ds_rt_toptitle, #ds_rt.info .ds_rt_nick { font-weight: bold; }';
        css += '#ds_rt.info > li { padding: 3px 0; }';
        css += '#ds_rt.info .ds_rt_nick:after { content: ": "; }';
        css += '#ds_rt.info .ds_rt_avatar img { vertical-align: middle; margin-right: 5px; width: 30px; height: 30px; }';
        css += '#ds_rt.info img { max-height: 30px; max-width: 30px; }';
        css += '.ds_rt_fp { height: 0; overflow: hidden; }';
        css += '.ds_rt_fp.clicked { height: auto; }';
        css += '.ds_rt_fp_open { background: url(//i.imgur.com/BzDhcHL.png) no-repeat top; }';
        css += '.ds_rt_fp_close { background: url(//i.imgur.com/BzDhcHL.png) no-repeat bottom; }';
        css += '.ds_rt_fp_open, .ds_rt_fp_close { margin-left: 10px; width: 16px; height: 16px; display: none; float: right; cursor: pointer; }';
        css += '.ds_rt_fp_open.clicked, .ds_rt_fp_close.clicked { display: block; }';
        css += '.ds_rt_loadimg { text-align: center; }';

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

/**
 * Resolve where the widget should go. Returns { el, position } or null.
 *
 * Preferred chain:
 *   1. Immediately after the modern fast-reply editor (the user's request).
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
    if (document.getElementById(CONFIG.rootId)) return;
    var h = '';
    h += '<ul id="' + CONFIG.rootId + '" class="info">';
    h +=   '<li class="ds_rt_toptitle">Similar Topics</li>';
    h +=   '<li class="ds_rt_loadimg"><img src="//img.forumfree.net/index_file/load.gif" alt="Loading"></li>';
    h += '</ul>';

    var point = findInsertionPoint();
    if (point) {
        point.el.insertAdjacentHTML(point.position, h);
    } else {
        document.body.insertAdjacentHTML('beforeend', h);
    }
}

    /* ---- Scoring --------------------------------------------------- */
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

    /* ---- Fetch ----------------------------------------------------- */
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

    function collect() {
        var page = 0;
        var totalPages = 1;

        function step() {
            if (page >= CONFIG.maxPages) return finish();
            if (page > 0 && page >= totalPages) return finish();
            if (candidates.length >= CONFIG.limit * 2) return finish();

            fetchPage(page * CONFIG.pageSize)
                .then(function (data) {
                    if (!data || !data.info) { finish(); return; }
                    totalPages = data.info.pages || 1;
                    consumePage(data);
                    page++;
                    step();
                })
                .catch(function () { hadError = true; finish(); });
        }
        step();

        // Returns a promise that resolves once the scan is done — used
        // only by the initialize wrapper to schedule cache + render.
        return new Promise(function (resolve) {
            var poll = setInterval(function () {
                if (page >= CONFIG.maxPages ||
                    (page > 0 && page >= totalPages) ||
                    candidates.length >= CONFIG.limit * 2) {
                    clearInterval(poll);
                    resolve();
                }
            }, 100);
        });
    }

    function finish() {
        if (candidates.length === 0) {
            if (hadError) renderError();
            else          renderList([]);
            return;
        }
        candidates.sort(function (a, b) { return b.score - a.score; });
        var threads = candidates.slice(0, CONFIG.limit).map(function (e) { return e.thread; });
        writeCache(threads);
        renderList(threads);
    }

    /* ---- Render ---------------------------------------------------- */
    function buildRow(thread) {
        var start       = (thread.info && thread.info.start) ? thread.info.start : {};
        var starterId   = start.id   || 0;
        var starterName = start.name || 'Unknown';
        var titleText   = thread.title || '(untitled)';
        var titleId     = thread.id;

        var h = '';
        h += '<li class="ds_rt_topic">';
        h +=   '<a class="ds_rt_avatar" href="//' + domain + '/?act=Profile&MID=' + starterId + '">';
        h +=     '<img src="https://script.' + domain + ':8443/i/avatar-redirect?mid=' + starterId + '" ';
        h +=          'alt="" loading="lazy" ';
        h +=          'onerror="this.src=\'https://img.forumfree.net/style_images/default_avatar.png\'">';
        h +=   '</a>';
        h +=   '<a class="ds_rt_nick" href="//' + domain + '/?act=Profile&MID=' + starterId + '">' + starterName + '</a>';
        h +=   '<a class="ds_rt_title" href="?t=' + titleId + '">' + titleText + '</a>';
        if (CONFIG.fastPreview) {
            h += '<span class="ds_rt_fp_close" data-dsrt-close="1"></span>';
            h += '<span class="ds_rt_fp_open clicked" data-dsrt-open="' + titleId + '"></span>';
            h += '<div class="ds_rt_fp"></div>';
        }
        h += '</li>';
        return h;
    }

    function renderList(threads) {
        var ul = document.getElementById(CONFIG.rootId);
        if (!ul) return;

        var h = '<li class="ds_rt_toptitle">Similar Topics</li>';
        for (var i = 0; i < threads.length; i++) h += buildRow(threads[i]);
        if (threads.length === 0) {
            h += '<li class="ds_rt_404">No similar topics found.</li>';
        }
        ul.innerHTML = h;

        if (CONFIG.fastPreview) {
            ul.querySelectorAll('[data-dsrt-open]').forEach(function (el) {
                el.addEventListener('click', function () { openPreview(this); });
            });
            ul.querySelectorAll('[data-dsrt-close]').forEach(function (el) {
                el.addEventListener('click', function () { closePreview(this); });
            });
        }
    }

    function renderError() {
        var ul = document.getElementById(CONFIG.rootId);
        if (!ul) return;
        ul.innerHTML =
            '<li class="ds_rt_toptitle">Similar Topics</li>' +
            '<li class="ds_rt_404">Could not load similar topics.</li>';
    }

    /* ---- Fast preview --------------------------------------------- */
    function openPreview(el) {
        var id = parseInt(el.getAttribute('data-dsrt-open'), 10);
        if (!id) return;
        var box = el.parentNode.querySelector('.ds_rt_fp');
        if (!box) return;

        box.innerHTML = '<div class="ds_rt_loadimg"><img src="//img.forumfree.net/index_file/load.gif" alt="Loading"></div>';
        box.className += ' clicked';
        el.className = 'ds_rt_fp_open';
        var closeEl = el.parentNode.querySelector('.ds_rt_fp_close');
        if (closeEl) closeEl.className += ' clicked';

        fetch('//' + domain + '/api.php?t=' + id + '&cookie=1', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var first = data && data.messages && data.messages[0];
                if (!first) {
                    box.innerHTML = '<div>Preview not available.</div>';
                    return;
                }
                var text = stripHtml(first.content || '').replace(/\s+/g, ' ').trim();
                box.innerHTML =
                    '<div>' + truncate(text, CONFIG.previewMaxChars) + '</div><br>' +
                    '<a href="//' + domain + '/?t=' + id + '#entry' + first.id + '">Continue reading &raquo;</a>';
            })
            .catch(function () {
                box.innerHTML = '<div>Could not load preview.</div>';
            });
    }

    function closePreview(el) {
        el.className = 'ds_rt_fp_close';
        var openEl = el.parentNode.querySelector('.ds_rt_fp_open');
        if (openEl) openEl.className += ' clicked';
        var box = el.parentNode.querySelector('.ds_rt_fp');
        if (box) box.className = 'ds_rt_fp';
    }

    /* ---- Lifecycle ------------------------------------------------- */
    function initialize() {
    if (initialized) return Promise.resolve();
    initialized = true;

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

    topicId   = ctx.topicId;
    sectionId = ctx.sectionId;
    domain    = document.domain;

    queryTokens = tokenize(ctx.title);
    if (!queryTokens.length) return Promise.resolve();

    effectiveMinHits = (queryTokens.length > CONFIG.minHits)
        ? CONFIG.minHits
        : Math.max(1, queryTokens.length - 1);

    cacheKey = CONFIG.cachePrefix + topicId;
    seen[topicId] = true;

    injectStyles();
    injectContainer();

    var cached = readCache();
    if (cached) {
        renderList(cached);
        return Promise.resolve();
    }

    candidates.length = 0;
    seen             = {};
    seen[topicId]    = true;
    hadError         = false;

    collect();

    return Promise.resolve();
}

    function reset() {
        initialized = false;
        topicId     = null;
        sectionId   = null;
        domain      = '';
        queryTokens = [];
        effectiveMinHits = 0;
        cacheKey    = null;
        candidates  = [];
        seen        = {};
        hadError    = false;

        var root = document.getElementById(CONFIG.rootId);
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
    window.SimilarTopicsModule = SimilarTopicsModule;
    window.dispatchEvent(new CustomEvent('similar-topics-module-ready'));
}
