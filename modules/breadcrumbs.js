/* =============================================
   Breadcrumbs, Pagination & Topic Header Module – Emerald Theme
   Modernises legacy .nav, .navsub.*.Justify,
   h2.mtitle and .title.bottom.Item.Justify
   into accessible breadcrumb, pagination and topic header.
   Also handles member-posts pages on body#search.
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
        MEMBER_POSTS_SELECTOR: '.topic.member_posts'
    });

    // =========================================================================
    // UTILITIES
    // =========================================================================
    const escapeHtml = (str) => {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

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

    function convertBreadcrumb() {
    var legacyNav = document.querySelector(CONFIG.LEGACY_NAV_SELECTOR);
    if (!legacyNav) return;
    var container = getOrCreateContainer(CONFIG.MODERN_BREADCRUMB_ID, 'nav', 'modern-breadcrumbs', CONFIG.INSERT_AFTER_SELECTOR);
    if (!container) return;
    container.innerHTML = buildBreadcrumbHtml(extractBreadcrumbItems(legacyNav));
    applyEmojiReplacer(container, 50);            // <— NEW
    console.log('[BreadcrumbsModule] Breadcrumb modernised');
}

    // =========================================================================
    // TOPIC HEADER
    // =========================================================================
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

        if (data.viewCount || data.replyCount) {
            html += '<div class="topic-meta">';
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

    function convertTopicHeader() {
    var titleEl = document.querySelector(CONFIG.LEGACY_TITLE_SELECTOR);
    if (!titleEl) return;                       // no .mtitle on this page → nothing to do

    var data = extractTopicHeaderData();
    if (!data.topicTitle) {
        setTimeout(function () {
            var retryEl = document.querySelector(CONFIG.LEGACY_TITLE_SELECTOR);
            if (!retryEl) return;               // removed in the meantime
            var retryData = extractTopicHeaderData();
            if (!retryData.topicTitle) {
                var breadcrumb = document.getElementById(CONFIG.MODERN_BREADCRUMB_ID);
                if (breadcrumb) {
                    var currentEl = breadcrumb.querySelector(
                        '.modern-breadcrumb-item--current .modern-breadcrumb-text'
                    );
                    if (currentEl) {
                        retryData.topicTitle     = currentEl.textContent.trim();
                        retryData.topicTitleHtml = currentEl.innerHTML;   // preserves any <img>
                    }
                }
            }
            if (retryData.topicTitle) renderTopicHeader(retryData);
        }, 100);
        return;
    }
    renderTopicHeader(data);
}

    function renderTopicHeader(data) {
    if (!data.topicTitle) return;
    var container = getOrCreateContainer(
        CONFIG.MODERN_TOPIC_HEADER_ID, 'div', 'modern-topic-header',
        '#' + CONFIG.MODERN_BREADCRUMB_ID
    );
    if (!container) return;

    container.innerHTML = buildTopicHeaderHtml(data);

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

    function convertPagination(legacyBar) {
        if (!legacyBar) return;
        var insertAfter = null;
        var postsContainer = document.getElementById(CONFIG.POSTS_CONTAINER_ID);
        if (postsContainer) insertAfter = '#' + CONFIG.POSTS_CONTAINER_ID;
        else {
            var topicList = document.getElementById(CONFIG.TOPIC_LIST_ID);
            var boardList = document.getElementById(CONFIG.BOARD_LIST_ID);
            if (topicList) insertAfter = '#' + CONFIG.TOPIC_LIST_ID;
            else if (boardList) insertAfter = '#' + CONFIG.BOARD_LIST_ID;
            else insertAfter = CONFIG.INSERT_AFTER_SELECTOR;
        }
        var container = getOrCreateContainer(CONFIG.MODERN_PAGINATION_ID, 'div', 'modern-pagination', insertAfter);
        if (!container) return;
        var data = extractPaginationData(legacyBar);
        container.innerHTML = buildPaginationHtml(data);
        var jumpForm = container.querySelector('.modern-jump-form');
        if (jumpForm) {
            var jumpInput = jumpForm.querySelector('.modern-jump-input');
            var jumpBtn = jumpForm.querySelector('.modern-jump-btn');
            var jumpParams = null;
            data.pageItems.forEach(function (item) { if (item.type === 'jump') jumpParams = item; });
            if (jumpParams) {
                jumpBtn.addEventListener('click', function () {
                    var page = parseInt(jumpInput.value, 10);
                    if (isNaN(page) || page < 1) page = 1;
                    if (page > jumpParams.totalPages) page = jumpParams.totalPages;
                    window.location.href = jumpParams.baseUrl + '&st=' + (page - 1) * jumpParams.entriesPerPage;
                });
            }
        }
        console.log('[BreadcrumbsModule] Pagination modernised');
    }

    function convertAllPagination() {
        var topBar = document.querySelector(CONFIG.LEGACY_PAGINATION_SELECTOR_TOP) ||
                     document.querySelector(CONFIG.LEGACY_PAGINATION_PLAIN_TOP + ' .pages')?.closest('.navsub');
        var bottomBar = document.querySelector(CONFIG.LEGACY_PAGINATION_SELECTOR_BOTTOM) ||
                        document.querySelector(CONFIG.LEGACY_PAGINATION_PLAIN_BOTTOM + ' .pages')?.closest('.navsub');
        if (bottomBar || topBar) convertPagination(bottomBar || topBar);
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

    // Emoji normalisation for the modern topic title — now fires on every page
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
    function initialize() {
    if (document.querySelector(CONFIG.LEGACY_NAV_SELECTOR))      convertBreadcrumb();
    if (document.querySelector(CONFIG.LEGACY_TITLE_SELECTOR))    convertTopicHeader();
    if (document.querySelector(CONFIG.MEMBER_POSTS_SELECTOR))    convertMemberPostsHeader();
    convertAllPagination();
    registerObserver();
    console.log('[BreadcrumbsModule] Initialised');
}

    return {
        initialize: initialize,
        refresh: function () {
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
