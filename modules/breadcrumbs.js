/* =============================================
   Breadcrumbs, Pagination & Topic Header Module – Emerald Theme
   Modernises legacy .nav, .navsub.*.Justify,
   h2.mtitle and .title.bottom.Item.Justify
   into accessible breadcrumb, pagination and topic header.
   Also handles member-posts pages on body#search.

   API-first as of this revision: breadcrumb, topic header, and
   pagination are built from /api.php?t= / ?f= / ?p= / ?mid= when
   possible. DOM scraping remains as fallback for blog / msg /
   search-results / member-posts pages (no API equivalent), and
   for cases where the API request fails.
   ============================================= */
'use strict';

const BreadcrumbsModule = (function () {
    console.log('🔥 BreadcrumbsModule loaded (breadcrumbs + pagination + topic header + member posts)');

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        LEGACY_NAV_SELECTOR: 'ul.nav',
        MODERN_BREADCRUMB_ID: 'modern-breadcrumbs',
        LEGACY_PAGINATION_SELECTOR_TOP: '.navsub.top.Justify',
        LEGACY_PAGINATION_SELECTOR_BOTTOM: '.navsub.bottom.Justify',
        LEGACY_PAGINATION_PLAIN_TOP: '.navsub.top:not(.Justify)',
        LEGACY_PAGINATION_PLAIN_BOTTOM: '.navsub.bottom:not(.Justify)',
        MODERN_PAGINATION_ID: 'modern-pagination',
        WRAPPER_ID: 'modern-forum-wrapper',
        INSERT_AFTER_SELECTOR: '.carousel-wrapper',
        BOARD_LIST_ID: 'modern-board-list',
        TOPIC_LIST_ID: 'modern-topic-list',
        POSTS_CONTAINER_ID: 'posts-container',
        LEGACY_TITLE_SELECTOR: 'div.mtitle h1, h1.mtitle, h2.mtitle',
        LEGACY_STATS_SELECTOR: '.title.bottom.Item.Justify',
        MODERN_TOPIC_HEADER_ID: 'modern-topic-header',
        MEMBER_POSTS_SELECTOR: '.topic.member_posts',
        SKIP_TOPIC_HEADER_BODY_IDS: ['board', 'forum'],

        // Page size for API-driven pagination. TOPIC_PAGE_SIZE matches
        // the 15 messages per page the API returns on ?t=; SECTION_PAGE_SIZE
        // is the section-view default (30 topics per page).
        TOPIC_PAGE_SIZE: 15,
        SECTION_PAGE_SIZE: 30
    });

    // =========================================================================
    // MODULE STATE (API layer)
    // =========================================================================
    const _apiCache     = new Map();
    let _contextPromise = null;
    let _renderedUrl    = { breadcrumb: null, topicHeader: null, pagination: null };

    // =========================================================================
    // UTILITIES
    // =========================================================================
    const escapeHtml = (str) => {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    function decodeHtmlEntities(str) {
        if (!str || typeof str !== 'string') return str || '';
        if (str.indexOf('&') === -1) return str;
        const ta = document.createElement('textarea');
        ta.innerHTML = str;
        return ta.value;
    }

   function applyEmojiReplacer(container, retries) {
    if (!container) return;

    // Preferred path: the emojiReplacer helper from twemoji.js
    if (window.emojiReplacer) {
        try {
            if (typeof window.emojiReplacer.replaceSync === 'function') {
                window.emojiReplacer.replaceSync(container);
            } else if (typeof window.emojiReplacer.replace === 'function') {
                window.emojiReplacer.replace(container);
            }
        } catch (e) { console.warn('[BreadcrumbsModule] emoji replacer failed:', e); }
        return;
    }

    // Fallback: twemoji is loaded but emojiReplacer hasn't been wired yet
    // (emojiReplacer is only published after ForumObserver is ready).
    if (window.twemoji && typeof window.twemoji.parse === 'function') {
        try {
            window.twemoji.parse(container, {
                folder: 'svg',
                ext: '.svg',
                base: 'https://twemoji.maxcdn.com/v/latest/',
                className: 'twemoji',
                size: 'svg'
            });
        } catch (e) { console.warn('[BreadcrumbsModule] twemoji.parse failed:', e); }
        return;
    }

    // Neither ready yet: keep retrying for up to 5 s
    if (retries > 0) {
        setTimeout(function () { applyEmojiReplacer(container, retries - 1); }, 100);
    }
}

    function extractPageJumpParams(hrefOrOnclick) {
        if (!hrefOrOnclick) return null;
        var match = hrefOrOnclick.match(/page_jump\('([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\)/);
        if (match) {
            return {
                baseUrl: match[1],
                totalPages: parseInt(match[2], 10),
                entriesPerPage: parseInt(match[3], 10)
            };
        }
        return null;
    }

    function toSentenceCase(text) {
        if (!text) return '';
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    }

       function getRelativeTimeString(date) {
        if (!date || isNaN(date.getTime())) return 'Unknown';
        const now = new Date();
        const diff = date - now;
        const absDiff = Math.abs(diff) / 1000;
        const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'en', { numeric: 'auto' });
        if (absDiff < 60)       return rtf.format(Math.trunc(diff / 1000), 'second');
        if (absDiff < 3600)     return rtf.format(Math.trunc(diff / 60000), 'minute');
        if (absDiff < 86400)    return rtf.format(Math.trunc(diff / 3600000), 'hour');
        if (absDiff < 2592000)  return rtf.format(Math.trunc(diff / 86400000), 'day');
        if (absDiff < 31536000) return rtf.format(Math.trunc(diff / 2592000000), 'month');
        return rtf.format(Math.trunc(diff / 31536000000), 'year');
    }

       function extractTitleContent(titleEl) {
    if (!titleEl) return { text: '', html: '' };
    var text = '';
    var html = '';
    var nodes = titleEl.childNodes;
    for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node.nodeType === Node.TEXT_NODE) {
            var t = node.textContent;
            text += t;
            html += escapeHtml(t);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'IMG') {
                var src        = node.getAttribute('src')        || '';
                var alt        = node.getAttribute('alt')        || '';
                var cls        = node.getAttribute('class')      || '';
                var style      = node.getAttribute('style');
                var w          = node.getAttribute('width');
                var h          = node.getAttribute('height');
                var ariaHidden = node.getAttribute('aria-hidden');

                if (alt) text += alt;

                html += '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '"';
                if (cls)              html += ' class="' + escapeHtml(cls) + '"';
                if (style)            html += ' style="' + escapeHtml(style) + '"';
                if (w != null)        html += ' width="'  + escapeHtml(String(w)) + '"';
                if (h != null)        html += ' height="' + escapeHtml(String(h)) + '"';
                if (ariaHidden)       html += ' aria-hidden="' + escapeHtml(ariaHidden) + '"';
                html += '>';
            } else if (node.tagName === 'BR') {
                text += ' ';
                html += '<br>';
            } else {
                // Recurse into wrappers (spans, etc.) so nested imgs survive.
                var sub = extractTitleContent(node);
                text += sub.text;
                html += sub.html;
            }
        }
    }
    return { text: text.trim(), html: html.trim() };
}

    // =========================================================================
    // CONTAINER HELPERS
    // =========================================================================
    function getWrapper() {
        return document.getElementById(CONFIG.WRAPPER_ID);
    }

    function getOrCreateContainer(id, tagName, className, insertAfterSelector, appendToWrapper) {
        const wrapper = getWrapper();
        if (!wrapper) return null;

        let container = document.getElementById(id);
        if (container) return container;

        container = document.createElement(tagName || 'div');
        container.id = id;
        container.className = className || id;

        if (appendToWrapper) {
            wrapper.appendChild(container);
        } else if (insertAfterSelector) {
            const referenceNode = wrapper.querySelector(insertAfterSelector);
            if (referenceNode) {
                const nextSibling = referenceNode.nextElementSibling;
                if (nextSibling && nextSibling !== container) {
                    wrapper.insertBefore(container, nextSibling);
                } else {
                    referenceNode.insertAdjacentElement('afterend', container);
                }
            } else {
                wrapper.appendChild(container);
            }
        } else {
            wrapper.appendChild(container);
        }
        return container;
    }

    // ============================================================================
    // API INFRASTRUCTURE
    // ============================================================================
    // Shared by breadcrumb, topic header and pagination.
    //
    //   apiFetch(qs)     — cached fetch for one api.php query string
    //   getPageContext() — resolves every API call the current URL
    //                      warrants, once, and caches the promise
    //   _crumb(...)      — build one breadcrumb item in the same shape
    //                      extractBreadcrumbItems produces
    //
    // _renderedUrl tracks the last URL each component rendered for, so
    // observer re-fires and manual re-invocations don't rebuild markup.
    // ============================================================================
    function apiFetch(qs) {
        if (_apiCache.has(qs)) return _apiCache.get(qs);
        const p = (async () => {
            try {
                const r = await fetch('/api.php?' + qs, { credentials: 'same-origin' });
                if (!r.ok) return null;
                return await r.json();
            } catch (e) {
                return null;
            }
        })();
        _apiCache.set(qs, p);
        return p;
    }

    function getPageContext() {
        if (_contextPromise) return _contextPromise;
        _contextPromise = (async () => {
            const params    = new URLSearchParams(window.location.search);
            const topicId   = params.get('t');
            const sectionId = params.get('f');
            const postId    = params.get('p');
            const userId    = params.get('MID');
            const st        = params.get('st') || '0';

            const topicData   = topicId
                ? await apiFetch('t='   + encodeURIComponent(topicId)   + '&st=' + st)
                : null;
            const sectionData = sectionId
                ? await apiFetch('f='   + encodeURIComponent(sectionId) + '&st=' + st)
                : null;
            const postData    = postId
                ? await apiFetch('p='   + encodeURIComponent(postId))
                : null;
            const userData    = userId
                ? await apiFetch('mid=' + encodeURIComponent(userId))
                : null;

            return {
                topicId, sectionId, postId, userId, st,
                topicData, sectionData, postData, userData
            };
        })();
        return _contextPromise;
    }

    function _crumb(text, url) {
        return {
            text: text || '',
            html: escapeHtml(text || ''),
            url: url || null
        };
    }

    // =========================================================================
    // BREADCRUMB
    // =========================================================================
    function extractBreadcrumbItems(legacyNav) {
    const items = [];
    const listItems = legacyNav.querySelectorAll('li');

    for (var i = 0; i < listItems.length; i++) {
        var li = listItems[i];
        var link = li.querySelector('a');
        var target = link || li;
        var content = extractTitleContent(target);

        // Strip leading zero-width space that FF injects on the current item
        content.text = content.text.replace(/^\u200B+/, '');
        content.html = content.html.replace(/^\u200B+/, '');

        if (!content.text) continue;

        items.push({
            text: content.text,
            html: content.html,
            url: link ? link.getAttribute('href') : null,
            isCurrent: !link
        });
    }
    return items;
}

    function buildBreadcrumbHtml(items) {
    if (items.length === 0) return '';
    var html = '<ol class="modern-breadcrumb-list">';
    items.forEach(function (item, index) {
        var isLast = index === items.length - 1;
        var isCurrent = !item.url;
        var labelHtml = item.html || escapeHtml(item.text);
        html += '<li class="modern-breadcrumb-item' + (isCurrent ? ' modern-breadcrumb-item--current' : '') + '">';
        if (item.url) {
            html += '<a href="' + escapeHtml(item.url) + '" class="modern-breadcrumb-link">' + labelHtml + '</a>';
        } else {
            html += '<span class="modern-breadcrumb-text" aria-current="page">' + labelHtml + '</span>';
        }
        if (!isLast) html += '<i class="fa-regular fa-angle-right modern-breadcrumb-separator" aria-hidden="true"></i>';
        html += '</li>';
    });
    html += '</ol>';
    return html;
}

    async function tryBuildBreadcrumbFromApi() {
        const ctx = await getPageContext();
        const bodyId = document.body.id;

        // ── Topic page: ?t= ──────────────────────────────────────
        if (ctx.topicData && ctx.topicData.info) {
            const info = ctx.topicData.info;
            const trail = [
                _crumb('Home', '/'),
                _crumb(decodeHtmlEntities(info.section_name), '?f=' + info.section_id),
                _crumb(decodeHtmlEntities(info.title),
                    bodyId === 'send' ? '?t=' + info.id : null)
            ];
            if (bodyId === 'send' && ctx.postId) {
                trail.push(_crumb('Editing a post', null));
            }
            return trail;
        }

        // ── Forum / section page: ?f= (no ?t=) ───────────────────
        if (ctx.sectionData && ctx.sectionData.info && !ctx.topicId) {
            const info = ctx.sectionData.info;
            const trail = [
                _crumb('Home', '/'),
                _crumb(decodeHtmlEntities(info.name),
                    bodyId === 'send' ? '?f=' + info.id : null)
            ];
            if (bodyId === 'send') trail.push(_crumb('New topic', null));
            return trail;
        }

        // ── Post page: ?p= (some forums link directly to a post) ─
        if (ctx.postData && ctx.postId) {
            const post = ctx.postData['p' + ctx.postId];
            if (post && post.info && post.info.topic_id) {
                return [
                    _crumb('Home', '/'),
                    _crumb(decodeHtmlEntities(post.info.section_name),
                        '?f=' + post.info.section_id),
                    _crumb(decodeHtmlEntities(post.info.topic_title),
                        '?t=' + post.info.topic_id)
                ];
            }
        }

        // ── Member posts / search results: ?MID= ─────────────────
        if (ctx.userData && ctx.userId) {
            const user = ctx.userData['m' + ctx.userId] || ctx.userData.info;
            if (user && user.nickname) {
                return [
                    _crumb('Home', '/'),
                    _crumb('Posts by ' + decodeHtmlEntities(user.nickname), null)
                ];
            }
        }

        // ── Index / home: no params, no topic context ────────────
        if (bodyId === 'index' && !ctx.topicId && !ctx.sectionId) {
            return [_crumb('Home', null)];
        }

        return null;
    }

    async function convertBreadcrumb() {
        const currentUrl = location.pathname + location.search + location.hash;
        if (_renderedUrl.breadcrumb === currentUrl) return;

        const container = getOrCreateContainer(
            CONFIG.MODERN_BREADCRUMB_ID,
            'nav',
            'modern-breadcrumbs',
            CONFIG.INSERT_AFTER_SELECTOR
        );
        if (!container) return;

        // ── 1. Try the API first ─────────────────────────────────
        let items = null;
        try {
            items = await tryBuildBreadcrumbFromApi();
        } catch (e) {
            console.warn('[BreadcrumbsModule] API breadcrumb failed:', e);
        }

        if (items && items.length > 0) {
            container.innerHTML = buildBreadcrumbHtml(items);
            applyEmojiReplacer(container, 50);
            _renderedUrl.breadcrumb = currentUrl;
            console.log('[BreadcrumbsModule] Breadcrumb modernised via API (' +
                items.length + ' items)');
            return;
        }

        // ── 2. Fall back to the legacy DOM ───────────────────────
        const legacyNav = document.querySelector(CONFIG.LEGACY_NAV_SELECTOR);
        if (!legacyNav) {
            // Neither API nor legacy yielded a trail. Leave the container
            // empty so CSS :empty hides it. Don't set the render guard —
            // a later observer fire (or a retry) may still succeed.
            container.innerHTML = '';
            return;
        }

        container.innerHTML = buildBreadcrumbHtml(extractBreadcrumbItems(legacyNav));
        applyEmojiReplacer(container, 50);
        _renderedUrl.breadcrumb = currentUrl;
        console.log('[BreadcrumbsModule] Breadcrumb modernised via DOM');
    }

    // =========================================================================
    // TOPIC HEADER
    // =========================================================================

        // =========================================================================
    // TOPIC HEADER — English eyebrow normalisation
    //
    // Forumfree renders the .mtitle verb phrase in the user's chosen
    // language, e.g. "Modifica messaggio:" (IT), "Ändere Nachricht:" (DE),
    // "Postar um novo tópico em" (PT).  The modern header is a design
    // decision and should stay in English, so we ignore the raw text and
    // rebuild it from a canonical label chosen by context.
    // =========================================================================

    function detectSendMode() {
        // 1. Hidden mode field (most reliable — language-independent)
        var modeInputs = document.querySelectorAll('input[name="mode"], input[name="action"]');
        for (var i = 0; i < modeInputs.length; i++) {
            var v = (modeInputs[i].value || '').toLowerCase();
            if (!v) continue;
            if (v.indexOf('edit') !== -1) return 'edit';
            if (v.indexOf('new') !== -1 || v.indexOf('topic') !== -1) return 'newtopic';
            if (v.indexOf('quote') !== -1 || v.indexOf('reply') !== -1) return 'reply';
        }

        // 2. URL query / hash
        var url = (window.location.search || '') + (window.location.hash || '');
        if (/([?&](?:mode|action)=(?:edit|editpost|edit_post|edit-post))/i.test(url)) return 'edit';
        if (/([?&](?:mode|action)=(?:newtopic|new_topic|new-topic|post))/i.test(url)) return 'newtopic';
        if (/([?&](?:mode|action)=(?:quote|reply))/i.test(url)) return 'reply';
        if (/editpost|edit_post|edit-post/i.test(url)) return 'edit';
        if (/newtopic|new_topic|new-topic/i.test(url)) return 'newtopic';

        // 3. Form action
        var form = document.querySelector('form[action]');
        if (form) {
            var action = (form.getAttribute('action') || '').toLowerCase();
            if (action.indexOf('edit') !== -1) return 'edit';
            if (action.indexOf('newtopic') !== -1 || action.indexOf('new_topic') !== -1) return 'newtopic';
            if (action.indexOf('quote') !== -1) return 'reply';
            if (action.indexOf('reply') !== -1) return 'reply';
        }

        // 4. Presence of a post ID — only edit pages carry one
        var pid = document.querySelector(
            'input[name="pid"], input[name="post_id"], input[name="postid"]'
        );
        if (pid && pid.value && pid.value !== '0') return 'edit';

        return null;
    }

        function classifyEyebrowByText(text) {
        if (!text) return null;
        var t = text.toLowerCase().trim();

        // ---- Anchored: the verb always leads the eyebrow phrase ----
        // No \b here — \b relies on ASCII \w and silently fails for
        // accented/non-ASCII first letters (ä, é, é, ñ, etc).

        // Edit — includes DE "Ändere", FR "Modifie", ES "Editar",
        // IT "Modifica", PT "Editando", plus PL/NL/TR/SV/RU stems.
        if (/^(?:edit|modif|änder|bearbeit|edita|editar|editando|edytuj|rediger|cambiar|bewerk|muokkaa|breyta|riscrivi|измен|редакт|zmień|wijzig|düzenle|redigera)/i.test(t)) {
            return 'edit';
        }

        // Reply
        if (/^(?:quot|repl|risp|antw|répond|respond|responder|antworten|vastaa|vastaus|ответ|odpowiedz|antwoorden|yanıtla|svara)/i.test(t)) {
            return 'reply';
        }

        // New topic — "post"/"new"/"create" verbs. "cr[eé]e?" covers
        // both FR "Crée" and "Créer" without requiring an accent match
        // on the e (i-flag does not fold accents).
        if (/^(?:post|new|nuev|nouve|nuov|nov|neu|yeni|нов|создать|erstell|erschaff|crea|cr[eé]e?|utwórz|nowy|nieuw|uusi|nytt|oluştur)/i.test(t)) {
            return 'newtopic';
        }

        // ---- Fallback: for cases where the verb is not the very
        //      first word (e.g. "Erschaffe eine neue Diskussion"
        //      is already anchored above, but future variants may
        //      lead with a noun). ASCII-only to keep \b reliable.
        if (/\bneu[e]?[snr]?\b|\bnuev[oa]\b|\bnouve(?:au|lle)\b|\bnuov[oa]\b|\bnov[oa]\b/i.test(t)) {
            return 'newtopic';
        }

        return null;
    }

    function englishEyebrowForMode(mode) {
        switch (mode) {
            case 'edit':     return 'Editing a post in';
            case 'newtopic': return 'Post a new topic in';
            case 'reply':    return 'Replying to';
            default:         return null;
        }
    }
   
       function extractTopicHeaderSplit(titleEl) {
        if (!titleEl) return { eyebrow: '', eyebrowHtml: '', title: '', titleHtml: '' };

        // FF's "send" / "edit" markup wraps the verb phrase in
        //   <span style="font-weight:normal">…</span>
        // followed by the entity in  <b>…</b> / <strong>…</strong>.
        // A bold *inside* a normal topic title must NOT be treated as the
        // entity name, so we only split when that font-weight:normal span
        // exists as a direct child.
        var eyebrowSpan = null;
        var directSpans = titleEl.querySelectorAll(':scope > span');
        for (var s = 0; s < directSpans.length; s++) {
            var styleAttr = (directSpans[s].getAttribute('style') || '').replace(/\s+/g, '');
            if (styleAttr.indexOf('font-weight:normal') !== -1) {
                eyebrowSpan = directSpans[s];
                break;
            }
        }

        // No eyebrow span → whole .mtitle is the title (topic view / normal case).
        if (!eyebrowSpan) {
            var whole = extractTitleContent(titleEl);
            return {
                eyebrow:     '',
                eyebrowHtml: '',
                title:       whole.text,
                titleHtml:   whole.html
            };
        }

        // Locate the entity: the next <b>/<strong> sibling after the eyebrow span.
        var entityEl = null;
        var walker = eyebrowSpan.nextSibling;
        while (walker) {
            if (walker.nodeType === Node.ELEMENT_NODE &&
                (walker.tagName === 'B' || walker.tagName === 'STRONG')) {
                entityEl = walker;
                break;
            }
            walker = walker.nextSibling;
        }

        // Eyebrow present but no bold entity that follows it — treat eyebrow
        // as the whole thing (rare; safer than losing text).
        if (!entityEl) {
            var eb = extractTitleContent(eyebrowSpan);
            return {
                eyebrow:     eb.text,
                eyebrowHtml: eb.html,
                title:       '',
                titleHtml:   ''
            };
        }

        // Eyebrow = everything before the entity element.
        var temp = document.createElement('div');
        var node = titleEl.firstChild;
        while (node && node !== entityEl) {
            temp.appendChild(node.cloneNode(true));
            node = node.nextSibling;
        }
        var eyebrowContent = extractTitleContent(temp);
        var titleContent   = extractTitleContent(entityEl);

        return {
            eyebrow:     eyebrowContent.text,
            eyebrowHtml: eyebrowContent.html,
            title:       titleContent.text,
            titleHtml:   titleContent.html
        };
    }     
   
           function extractTopicHeaderData() {
        var titleEl = document.querySelector(CONFIG.LEGACY_TITLE_SELECTOR);
        var split = extractTopicHeaderSplit(titleEl);

        // English normalisation — the eyebrow is FF's own UI string,
        // so ignore its actual language and rebuild it from context.
        if (split.eyebrow) {
            var mode    = detectSendMode() || classifyEyebrowByText(split.eyebrow);
            var english = englishEyebrowForMode(mode);
            if (english) {
                split.eyebrow     = english;
                split.eyebrowHtml = escapeHtml(english);
            }
        }

        var statsEl = document.querySelector(CONFIG.LEGACY_STATS_SELECTOR);
        var replyCount = '', viewCount = '';
        if (statsEl) {
            var leftSub = statsEl.querySelector('.left.Sub');
            if (leftSub) {
                var text = leftSub.textContent || '';
                var replyMatch = text.match(/(\d+)\s*repl(?:y|ies)/i);
                if (replyMatch) replyCount = replyMatch[1];
                var viewsSpan = leftSub.querySelector('.views');
                if (viewsSpan) {
                    var viewMatch = viewsSpan.textContent.match(/([\d,]+)/);
                    if (viewMatch) viewCount = viewMatch[1];
                }
            }
        }
        var shareLink = statsEl ? statsEl.querySelector('a.a2a_dd') : null;

        return {
            eyebrow:        split.eyebrow,
            eyebrowHtml:    split.eyebrowHtml,
            topicTitle:     split.title,
            topicTitleHtml: split.titleHtml,
            replyCount:     replyCount,
            viewCount:      viewCount,
            shareLink:      shareLink
        };
    }

            function buildTopicHeaderHtml(data) {
        if (!data.topicTitle) return '';

        var titleHtml   = data.topicTitleHtml || escapeHtml(data.topicTitle);
        var eyebrowHtml = data.eyebrowHtml   || (data.eyebrow ? escapeHtml(data.eyebrow) : '');
        var eyebrowBlock = eyebrowHtml
            ? '<p class="topic-eyebrow">' + eyebrowHtml + '</p>'
            : '';

        var html = '<div class="topic-header">'
                 + '<div class="topic-title-content">'
                 + eyebrowBlock
                 + '<h1 class="topic-title">' + titleHtml + '</h1>';

        if (data.starter || data.viewCount || data.replyCount) {
    html += '<div class="topic-meta">';

    // NEW — starter chip
    if (data.starter) {
        const profileUrl = '/?act=Profile&MID=' + data.starter.mid;
        const groupClass = 'group-' + (data.starter.groupClass || 'member')
            .split(/\s+/)[0]
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        let avatarHtml;
        if (data.starter.avatar && /^(https?:)?\/\//i.test(data.starter.avatar)) {
            // Use the raw URL — the forum serves avatars ~60px, downscaled
            // to 20px here. Not weserv-proxied to keep breadcrumbs.js free
            // of image-optimisation dependencies; the browser downscale is
            // adequate for a 20px chip.
            avatarHtml = '<img class="topic-starter-avatar" src="' +
                escapeHtml(data.starter.avatar) + '" alt="" width="20" height="20" loading="lazy">';
        } else {
            const initial = (data.starter.username || '?').charAt(0).toUpperCase();
            avatarHtml = '<span class="topic-starter-avatar topic-starter-avatar--initial">' +
                escapeHtml(initial) + '</span>';
        }

        let startedTimeHtml = '';
        if (data.startedDate) {
            const iso = data.startedDate.toISOString();
            const rel = getRelativeTimeString(data.startedDate);
            const abs = data.startedDate.toLocaleString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            startedTimeHtml = ' <span class="topic-starter-sep">·</span> ' +
                '<time class="topic-starter-date" datetime="' + iso + '" title="' +
                escapeHtml(abs) + '">' + escapeHtml(rel) + '</time>';
        }

        html += '<span class="topic-starter ' + groupClass + '">' +
            avatarHtml +
            '<span class="topic-starter-label">Started by</span> ' +
            '<a class="topic-starter-link" href="' + escapeHtml(profileUrl) + '" rel="nofollow">' +
                escapeHtml(data.starter.username) +
            '</a>' +
            startedTimeHtml +
        '</span>';
    }

    if (data.viewCount)  html += '<span class="topic-stats"><i class="fa-regular fa-eye" aria-hidden="true"></i><span>Views: '   + escapeHtml(data.viewCount)  + '</span></span>';
    if (data.replyCount) html += '<span class="topic-stats"><i class="fa-regular fa-comment" aria-hidden="true"></i><span>Replies: ' + escapeHtml(data.replyCount) + '</span></span>';
    html += '</div>';
}
        html += '</div>';
        if (data.shareLink) {
            html += '<div class="topic-actions"><button class="btn btn-icon modern-share-topic-btn" data-action="share-topic" title="Share topic" aria-label="Share topic"><i class="fa-regular fa-share-nodes" aria-hidden="true"></i></button></div>';
        }
        html += '</div>';
        return html;
    }

    async function tryBuildTopicHeaderFromApi() {
    const bodyId = document.body.id;
    if (CONFIG.SKIP_TOPIC_HEADER_BODY_IDS.indexOf(bodyId) !== -1) return null;

    const ctx = await getPageContext();

    if (ctx.topicData && ctx.topicData.info) {
        const info = ctx.topicData.info;
        const titleText = decodeHtmlEntities(info.title || '').trim();
        if (!titleText) return null;

        let eyebrow = '';
        let eyebrowHtml = '';
        if (bodyId === 'send') {
            const mode = detectSendMode();
            const english = englishEyebrowForMode(mode);
            if (english) {
                eyebrow = english;
                eyebrowHtml = escapeHtml(english);
            }
        }

        let shareLink = null;
        if (bodyId === 'topic') {
            const pageUrl    = window.location.origin + window.location.pathname + window.location.search;
            const shareTitle = titleText +
                (info.section_name ? ' - ' + decodeHtmlEntities(info.section_name) : '');
            const shareHref  = 'https://www.addtoany.com/share#url=' +
                encodeURIComponent(pageUrl) + '&title=' + encodeURIComponent(shareTitle);
            shareLink = {
                click: function () {
                    window.open(shareHref, '_blank', 'noopener,noreferrer');
                }
            };
        }

        // NEW — topic starter, from messages[0].user (has avatar) or the
        // top-level `starter` field (has id + nickname). Prefer messages[0].user
        // because it carries the avatar and group class without an extra fetch.
        let starter = null;
        const firstMessage = ctx.topicData.messages && ctx.topicData.messages[0];
        if (firstMessage && firstMessage.user && firstMessage.user.id) {
            starter = {
                mid: String(firstMessage.user.id),
                username: decodeHtmlEntities(firstMessage.user.nickname || ''),
                avatar: firstMessage.user.avatar || '',
                groupClass: firstMessage.user.group && firstMessage.user.group.class
                    ? firstMessage.user.group.class
                    : '',
                status: firstMessage.user.status || ''
            };
        } else if (ctx.topicData.starter && ctx.topicData.starter.id) {
            // Fallback: no messages array, but starter field is present
            starter = {
                mid: String(ctx.topicData.starter.id),
                username: decodeHtmlEntities(ctx.topicData.starter.nickname || ''),
                avatar: '',
                groupClass: '',
                status: ''
            };
        }

        let startedDate = null;
        if (info.first_post_time) {
            const d = new Date(info.first_post_time);
            if (!isNaN(d.getTime())) startedDate = d;
        } else if (firstMessage && firstMessage.info && firstMessage.info.date) {
            const d = new Date(firstMessage.info.date);
            if (!isNaN(d.getTime())) startedDate = d;
        }

        return {
            eyebrow:        eyebrow,
            eyebrowHtml:    eyebrowHtml,
            topicTitle:     titleText,
            topicTitleHtml: escapeHtml(titleText),
            replyCount:     info.replies || '',
            viewCount:      info.views || '',
            shareLink:      shareLink,
            starter:        starter,      // NEW
            startedDate:    startedDate   // NEW
        };
    }
       
        // ── New-topic send page: title is the section name from ?f= ──
        if (bodyId === 'send' && ctx.sectionData && ctx.sectionData.info) {
            const info = ctx.sectionData.info;
            const sectionName = decodeHtmlEntities(info.name || '').trim();
            if (!sectionName) return null;

            const mode = detectSendMode() || 'newtopic';
            const english = englishEyebrowForMode(mode);
            if (!english) return null;

            return {
                eyebrow:        english,
                eyebrowHtml:    escapeHtml(english),
                topicTitle:     sectionName,
                topicTitleHtml: escapeHtml(sectionName),
                replyCount:     '',
                viewCount:      '',
                shareLink:      null
            };
        }

        return null;
    }

    async function convertTopicHeader() {
        if (CONFIG.SKIP_TOPIC_HEADER_BODY_IDS.indexOf(document.body.id) !== -1) return;

        const currentUrl = location.pathname + location.search + location.hash;
        if (_renderedUrl.topicHeader === currentUrl) return;

        // ── 1. API path ──────────────────────────────────────────
        let apiData = null;
        try {
            apiData = await tryBuildTopicHeaderFromApi();
        } catch (e) {
            console.warn('[BreadcrumbsModule] API topic header failed:', e);
        }

        if (apiData && apiData.topicTitle) {
            renderTopicHeader(apiData);
            _renderedUrl.topicHeader = currentUrl;
            console.log('[BreadcrumbsModule] Topic header rendered via API');
            return;
        }

        // ── 2. DOM fallback (blog / msg / member-posts / unresolved) ──
        var titleEl = document.querySelector(CONFIG.LEGACY_TITLE_SELECTOR);
        if (!titleEl) return;

        var data = extractTopicHeaderData();
        if (!data.topicTitle) {
            setTimeout(function () {
                if (CONFIG.SKIP_TOPIC_HEADER_BODY_IDS.indexOf(document.body.id) !== -1) return;
                if (_renderedUrl.topicHeader === currentUrl) return;
                var retryEl = document.querySelector(CONFIG.LEGACY_TITLE_SELECTOR);
                if (!retryEl) return;
                var retryData = extractTopicHeaderData();
                if (!retryData.topicTitle) {
                    var breadcrumb = document.getElementById(CONFIG.MODERN_BREADCRUMB_ID);
                    if (breadcrumb) {
                        var currentEl = breadcrumb.querySelector(
                            '.modern-breadcrumb-item--current .modern-breadcrumb-text'
                        );
                        if (currentEl) {
                            retryData.topicTitle     = currentEl.textContent.trim();
                            retryData.topicTitleHtml = currentEl.innerHTML;
                        }
                    }
                }
                if (retryData.topicTitle) {
                    renderTopicHeader(retryData);
                    _renderedUrl.topicHeader = currentUrl;
                }
            }, 100);
            return;
        }
        renderTopicHeader(data);
        _renderedUrl.topicHeader = currentUrl;
    }

    function renderTopicHeader(data) {
    if (!data.topicTitle) return;
    var container = getOrCreateContainer(
        CONFIG.MODERN_TOPIC_HEADER_ID, 'div', 'modern-topic-header',
        '#' + CONFIG.MODERN_BREADCRUMB_ID
    );
    if (!container) return;

    container.innerHTML = buildTopicHeaderHtml(data);

    if (data.starter && data.starter.mid) {
    const starterLink = container.querySelector('.topic-starter-link');
    if (starterLink) {
        var attempts = 0;
        function tryAttach() {
            var PM = window.ForumPostsModule;
            if (PM && typeof PM.attachProfileTip === 'function') {
                PM.attachProfileTip(starterLink, {
                    mid: data.starter.mid,
                    username: data.starter.username,
                    apiUser: null,              // will populate from PM's cache if available
                    groupText: 'Member',
                    postCount: 0,
                    reputation: 0,
                    isOnline: data.starter.status === 'online'
                });
                return;
            }
            if (++attempts < 25) setTimeout(tryAttach, 200);
        }
        tryAttach();
    }
}

    // NEW: normalise unicode emoji that survived from the legacy title
    applyEmojiReplacer(container, 50);

    if (data.shareLink) {
        var shareBtn = container.querySelector('.modern-share-topic-btn');
        if (shareBtn) shareBtn.addEventListener('click', function () { data.shareLink.click(); });
    }
    console.log('[BreadcrumbsModule] Topic header rendered');
}

    // =========================================================================
    // MEMBER POSTS HEADER
    // =========================================================================
    function extractMemberPostsHeaderData(container) {
        var mtitleEl = container.querySelector('.mback .mtitle');
        var rawText = mtitleEl ? mtitleEl.textContent.trim() : '';
        var memberName = '';
        var match = rawText.match(/Posts written by\s+(.+)/i);
        if (match) memberName = match[1].trim();
        var statsEl = container.querySelector('.title.bottom.Item.Justify .left.Sub');
        var postCount = '';
        if (statsEl) {
            var countMatch = statsEl.textContent.match(/(\d+)\s*repl(?:y|ies)/i);
            if (countMatch) postCount = countMatch[1];
        }
        return { memberName, postCount };
    }

    function buildMemberPostsHeaderHtml(data) {
        if (!data.memberName) return '';
        var html = '<div class="topic-header"><div class="topic-title-content"><h1 class="topic-title">Posts by ' + escapeHtml(data.memberName) + '</h1>';
        if (data.postCount) html += '<div class="topic-meta"><span class="topic-stats"><i class="fa-regular fa-comment" aria-hidden="true"></i><span>Replies: ' + escapeHtml(data.postCount) + '</span></span></div>';
        html += '</div></div>';
        return html;
    }

    function convertMemberPostsHeader() {
    var container = document.querySelector(CONFIG.MEMBER_POSTS_SELECTOR);
    if (!container) return;
    var data = extractMemberPostsHeaderData(container);
    if (!data.memberName) return;

    var headerContainer = getOrCreateContainer(
        CONFIG.MODERN_TOPIC_HEADER_ID, 'div', 'modern-topic-header',
        '#' + CONFIG.MODERN_BREADCRUMB_ID
    );
    if (!headerContainer) return;

    headerContainer.innerHTML = buildMemberPostsHeaderHtml(data);
    applyEmojiReplacer(headerContainer, 50);

    console.log('[BreadcrumbsModule] Member posts header rendered');
}

    // =========================================================================
    // PAGINATION & ACTION BAR
    // =========================================================================
   
function extractPaginationData(legacyBar) {
    var pageItems = [];
    var pagesList = legacyBar.querySelector('.left.Sub ul.pages') || legacyBar.querySelector('ul.pages');
    if (pagesList) {
        var lis = pagesList.querySelectorAll('li');
        for (var i = 0; i < lis.length; i++) {
            var li = lis[i];
            var link = li.querySelector('a');
            var isCurrent = li.classList.contains('current');
            var isFirst = li.classList.contains('first');
            var isLastPost = li.classList.contains('lastpost');
            var isBreak = li.classList.contains('break');
            if (isBreak) { pageItems.push({ type: 'ellipsis' }); continue; }
            if (link) {
                var href = link.getAttribute('href') || '';
                var jumpParams = extractPageJumpParams(href);
                if (jumpParams) {
                    pageItems.push({ type: 'jump', totalPages: jumpParams.totalPages, entriesPerPage: jumpParams.entriesPerPage, baseUrl: jumpParams.baseUrl });
                } else if (isFirst) {
                    pageItems.push({ type: 'first', url: href, text: 'First page' });
                } else if (isLastPost) {
                    pageItems.push({ type: 'lastpost', url: href, text: 'First unread post' });
                } else {
                    pageItems.push({ type: 'page', url: href, text: link.textContent.trim(), isCurrent: isCurrent });
                }
            } else {
                pageItems.push({ type: 'current', text: li.textContent.trim(), isCurrent: true });
            }
        }
    }

    // ---- Action buttons ----
    var actionButtons = legacyBar.querySelectorAll('.right.Sub .buttons a');
    var actionsHtml = '';
    for (var j = 0; j < actionButtons.length; j++) {
        var actionBtn = actionButtons[j];
        var actionSpan = actionBtn.querySelector('span');
        var spanClass = actionSpan ? actionSpan.className : '';
        var actionIcon = actionSpan ? actionSpan.querySelector('i') : null;
        var iconClass = actionIcon ? actionIcon.className : '';

        // ---- Determine button class and fixed English text ----
        var extraClass = 'modern-pagination-action';
        var buttonBaseClass = 'modern-btn ';
        var actionText = '';

        if (spanClass.indexOf('reply') !== -1) {
            buttonBaseClass += 'modern-btn-secondary';
            extraClass += ' modern-pagination-action--reply';
            actionText = 'Reply';
        } else if (spanClass.indexOf('newpost') !== -1) {
            buttonBaseClass += 'modern-btn-primary';
            extraClass += ' modern-pagination-action--new-topic';
            actionText = 'New topic';
        } else {
            // Fallback: use original text and capitalise
            buttonBaseClass += 'modern-btn-primary';
            var rawText = actionSpan ? actionSpan.textContent.trim() : actionBtn.textContent.trim();
            actionText = toSentenceCase(rawText);
        }

        var actionHref = actionBtn.getAttribute('href');
        actionsHtml += '<a href="' + escapeHtml(actionHref) + '" class="' + buttonBaseClass + ' ' + extraClass + '">';
        if (iconClass) actionsHtml += '<i class="' + escapeHtml(iconClass) + '" aria-hidden="true"></i> ';
        actionsHtml += escapeHtml(actionText) + '</a>';
    }

    return { pageItems, actionsHtml };
}
   
    function buildPaginationHtml(data) {
        var html = '<div class="modern-pagination-bar">';
        if (data.pageItems.length > 0) {
            html += '<nav class="modern-pagination-pages" aria-label="pagination"><ol class="modern-page-list">';
            data.pageItems.forEach(function (item) {
                if (item.type === 'ellipsis') {
                    html += '<li class="modern-page-item modern-page-ellipsis"><span>…</span></li>';
                } else if (item.type === 'jump') {
                    html += '<li class="modern-page-item modern-page-jump">' +
                        '<form class="modern-jump-form" onsubmit="return false;">' +
                        '<input type="number" class="modern-jump-input" min="1" max="' + item.totalPages + '" value="" placeholder="Pg" aria-label="Jump to page">' +
                        '<button type="submit" class="modern-jump-btn modern-btn modern-btn-secondary">Go</button>' +
                        '</form></li>';
                } else if (item.type === 'first') {
                    html += '<li class="modern-page-item modern-page-first">' +
                        '<a href="' + escapeHtml(item.url) + '" class="modern-page-link modern-page-icon-link" title="' + escapeHtml(item.text) + '" aria-label="' + escapeHtml(item.text) + '">' +
                        '<i class="fa-regular fa-arrow-left-to-line" aria-hidden="true"></i></a></li>';
                } else if (item.type === 'lastpost') {
                    html += '<li class="modern-page-item modern-page-lastpost">' +
                        '<a href="' + escapeHtml(item.url) + '" class="modern-page-link modern-page-icon-link" title="' + escapeHtml(item.text) + '" aria-label="' + escapeHtml(item.text) + '">' +
                        '<i class="fa-regular fa-arrow-right-to-line" aria-hidden="true"></i></a></li>';
                } else if (item.type === 'current') {
                    html += '<li class="modern-page-item modern-page-current"><span aria-current="page">' + escapeHtml(item.text) + '</span></li>';
                } else {
                    var cls = item.isCurrent ? ' modern-page-current' : '';
                    html += '<li class="modern-page-item' + cls + '">';
                    if (item.isCurrent) html += '<span aria-current="page">' + escapeHtml(item.text) + '</span>';
                    else html += '<a href="' + escapeHtml(item.url) + '" class="modern-page-link">' + escapeHtml(item.text) + '</a>';
                    html += '</li>';
                }
            });
            html += '</ol></nav>';
        }
        if (data.actionsHtml) html += '<div class="modern-pagination-action-wrap">' + data.actionsHtml + '</div>';
        html += '</div>';
        return html;
    }

    function pickPaginationInsertTarget() {
        if (document.getElementById(CONFIG.POSTS_CONTAINER_ID)) return '#' + CONFIG.POSTS_CONTAINER_ID;
        if (document.getElementById(CONFIG.TOPIC_LIST_ID))      return '#' + CONFIG.TOPIC_LIST_ID;
        if (document.getElementById(CONFIG.BOARD_LIST_ID))      return '#' + CONFIG.BOARD_LIST_ID;
        return CONFIG.INSERT_AFTER_SELECTOR;
    }

    function wireJumpForm(container, data) {
        const jumpForm = container.querySelector('.modern-jump-form');
        if (!jumpForm) return;
        const jumpInput = jumpForm.querySelector('.modern-jump-input');
        const jumpBtn   = jumpForm.querySelector('.modern-jump-btn');
        let jumpParams = null;
        data.pageItems.forEach(function (item) { if (item.type === 'jump') jumpParams = item; });
        if (!jumpParams) return;
        jumpBtn.addEventListener('click', function () {
            let page = parseInt(jumpInput.value, 10);
            if (isNaN(page) || page < 1) page = 1;
            if (page > jumpParams.totalPages) page = jumpParams.totalPages;
            window.location.href = jumpParams.baseUrl + '&st=' +
                ((page - 1) * jumpParams.entriesPerPage);
        });
    }

    function convertPagination(legacyBar) {
        if (!legacyBar) return;
        var container = getOrCreateContainer(
            CONFIG.MODERN_PAGINATION_ID, 'div', 'modern-pagination',
            pickPaginationInsertTarget()
        );
        if (!container) return;
        var data = extractPaginationData(legacyBar);
        container.innerHTML = buildPaginationHtml(data);
        wireJumpForm(container, data);
        console.log('[BreadcrumbsModule] Pagination modernised (DOM)');
    }

    async function tryBuildPaginationFromApi() {
        const ctx = await getPageContext();

        let info = null, pageSize = 0, baseUrl = null;
        if (ctx.topicData && ctx.topicData.info) {
            info     = ctx.topicData.info;
            pageSize = CONFIG.TOPIC_PAGE_SIZE;
            baseUrl  = '?t=' + ctx.topicId;
        } else if (ctx.sectionData && ctx.sectionData.info) {
            info     = ctx.sectionData.info;
            pageSize = CONFIG.SECTION_PAGE_SIZE;
            baseUrl  = '?f=' + ctx.sectionId;
        }

        if (!info || !info.pages || info.pages <= 1) return null;

        const totalPages  = info.pages;
        const currentPage = info.currentPage || 1;
        const pageItems   = [];

        if (totalPages <= 7) {
            for (let p = 1; p <= totalPages; p++) {
                pageItems.push({
                    type: 'page',
                    url: baseUrl + '&st=' + ((p - 1) * pageSize),
                    text: String(p),
                    isCurrent: p === currentPage
                });
            }
        } else {
            pageItems.push({
                type: 'page', url: baseUrl + '&st=0', text: '1',
                isCurrent: currentPage === 1
            });
            const win = 2;
            if (currentPage - win > 2) pageItems.push({ type: 'ellipsis' });
            for (let p = Math.max(2, currentPage - win);
                     p <= Math.min(totalPages - 1, currentPage + win); p++) {
                pageItems.push({
                    type: 'page',
                    url: baseUrl + '&st=' + ((p - 1) * pageSize),
                    text: String(p),
                    isCurrent: p === currentPage
                });
            }
            if (currentPage + win < totalPages - 1) pageItems.push({ type: 'ellipsis' });
            if (currentPage + win < totalPages) {
                pageItems.push({
                    type: 'page',
                    url: baseUrl + '&st=' + ((totalPages - 1) * pageSize),
                    text: String(totalPages),
                    isCurrent: currentPage === totalPages
                });
            }
        }
        pageItems.push({ type: 'jump', totalPages, entriesPerPage: pageSize, baseUrl });

        let actionsHtml = '';
        if (ctx.topicData && ctx.topicData.info) {
            const t = ctx.topicData.info;
            actionsHtml += '<a href="/?act=Post&CODE=02&f=' + t.section_id + '&t=' + t.id +
                '" class="modern-btn modern-btn-secondary modern-pagination-action modern-pagination-action--reply">' +
                '<i class="fa-regular fa-reply" aria-hidden="true"></i> Reply</a>';
            actionsHtml += '<a href="/?act=Post&CODE=00&f=' + t.section_id +
                '" class="modern-btn modern-btn-primary modern-pagination-action modern-pagination-action--new-topic">' +
                '<i class="fa-regular fa-plus" aria-hidden="true"></i> New topic</a>';
        } else if (ctx.sectionData && ctx.sectionData.info) {
            const s = ctx.sectionData.info;
            actionsHtml += '<a href="/?act=Post&CODE=00&f=' + s.id +
                '" class="modern-btn modern-btn-primary modern-pagination-action modern-pagination-action--new-topic">' +
                '<i class="fa-regular fa-plus" aria-hidden="true"></i> New topic</a>';
        }

        return { pageItems, actionsHtml };
    }

    async function convertAllPagination() {
        const currentUrl = location.pathname + location.search + location.hash;
        if (_renderedUrl.pagination === currentUrl) return;

        // ── 1. API path ──────────────────────────────────────────
        let data = null;
        try {
            data = await tryBuildPaginationFromApi();
        } catch (e) {
            console.warn('[BreadcrumbsModule] API pagination failed:', e);
        }

        if (data) {
            const container = getOrCreateContainer(
                CONFIG.MODERN_PAGINATION_ID, 'div', 'modern-pagination',
                pickPaginationInsertTarget()
            );
            if (container) {
                container.innerHTML = buildPaginationHtml(data);
                wireJumpForm(container, data);
                _renderedUrl.pagination = currentUrl;
                console.log('[BreadcrumbsModule] Pagination modernised via API');
                return;
            }
        }

        // ── 2. DOM fallback (blog / msg / unknown) ───────────────
        const topBar = document.querySelector(CONFIG.LEGACY_PAGINATION_SELECTOR_TOP) ||
                       document.querySelector(CONFIG.LEGACY_PAGINATION_PLAIN_TOP + ' .pages')?.closest('.navsub');
        const bottomBar = document.querySelector(CONFIG.LEGACY_PAGINATION_SELECTOR_BOTTOM) ||
                          document.querySelector(CONFIG.LEGACY_PAGINATION_PLAIN_BOTTOM + ' .pages')?.closest('.navsub');
        if (bottomBar || topBar) {
            convertPagination(bottomBar || topBar);
            _renderedUrl.pagination = currentUrl;
        }
    }

    // =========================================================================
    // OBSERVER INTEGRATION
    // =========================================================================
    function registerObserver() {
    if (!globalThis.forumObserver) return;

    try { globalThis.forumObserver.register({ id: 'breadcrumbs-module', selector: CONFIG.LEGACY_NAV_SELECTOR, priority: 'high', callback: convertBreadcrumb }); } catch (e) { console.error(e); }
    try { globalThis.forumObserver.register({ id: 'topic-header-module', selector: CONFIG.LEGACY_TITLE_SELECTOR, priority: 'high', callback: convertTopicHeader }); } catch (e) { console.error(e); }
    try { globalThis.forumObserver.register({ id: 'member-posts-header-module', selector: CONFIG.MEMBER_POSTS_SELECTOR, priority: 'high', callback: convertMemberPostsHeader }); } catch (e) { console.error(e); }

    [CONFIG.LEGACY_PAGINATION_SELECTOR_TOP, CONFIG.LEGACY_PAGINATION_SELECTOR_BOTTOM, CONFIG.LEGACY_PAGINATION_PLAIN_TOP, CONFIG.LEGACY_PAGINATION_PLAIN_BOTTOM].forEach(function (sel, idx) {
        try { globalThis.forumObserver.register({ id: 'pagination-module-' + idx, selector: sel, priority: 'high', callback: convertAllPagination }); } catch (e) { console.error(e); }
    });

    // Emoji normalisation for the modern topic title — fires on every page
    // where .topic-title exists, not just topic/search/send.
    try {
        globalThis.forumObserver.register({
            id: 'topic-title-emoji-refresh',
            selector: '.topic-title',
            priority: 'high',
            callback: function (node) {
                if (window.emojiReplacer) {
                    try { window.emojiReplacer.replace(node); } catch (e) {}
                }
            }
        });
    } catch (e) { console.error(e); }

    console.log('[BreadcrumbsModule] Registered with ForumCoreObserver');
}

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    async function initialize() {
        // Ordered so breadcrumb renders first — topic header and pagination
        // both anchor their container relative to #modern-breadcrumbs or
        // #posts-container, which must exist by the time they render.
        // The API path in convertBreadcrumb settles independently of any
        // legacy DOM, so nothing here blocks on .nav / .mtitle / .navsub.
        await convertBreadcrumb();
        await convertTopicHeader();
        if (document.querySelector(CONFIG.MEMBER_POSTS_SELECTOR)) convertMemberPostsHeader();
        await convertAllPagination();
        registerObserver();
        console.log('[BreadcrumbsModule] Initialised');
    }

    return {
        initialize: initialize,
        refresh: function () {
            // Force a clean re-render on the current URL: drop cached
            // API responses, the memoised context promise, and the
            // per-URL render guards, then rebuild everything.
            _apiCache.clear();
            _contextPromise = null;
            _renderedUrl = { breadcrumb: null, topicHeader: null, pagination: null };
            convertBreadcrumb();
            convertTopicHeader();
            convertMemberPostsHeader();
            convertAllPagination();
        }
    };
})();

if (typeof window !== 'undefined') {
    window.BreadcrumbsModule = BreadcrumbsModule;
    window.dispatchEvent(new CustomEvent('breadcrumbs-module-ready'));
}
