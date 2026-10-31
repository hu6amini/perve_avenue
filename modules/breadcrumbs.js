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
            if (link) {
                items.push({ text: link.textContent.trim(), url: link.getAttribute('href'), isCurrent: false });
            } else {
                var text = li.textContent.trim().replace(/^\u200B/, '');
                if (text) items.push({ text: text, url: null, isCurrent: true });
            }
        }
        return items;
    }

    function buildBreadcrumbHtml(items) {
        if (items.length === 0) return '';
        var html = '<ol class="modern-breadcrumb-list">';
        items.forEach(function (item, index) {
            var isLast = index === items.length - 1;
            var isCurrent = !item.url;
            html += '<li class="modern-breadcrumb-item' + (isCurrent ? ' modern-breadcrumb-item--current' : '') + '">';
            if (item.url) {
                html += '<a href="' + escapeHtml(item.url) + '" class="modern-breadcrumb-link">' + escapeHtml(item.text) + '</a>';
            } else {
                html += '<span class="modern-breadcrumb-text" aria-current="page">' + escapeHtml(item.text) + '</span>';
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
        console.log('[BreadcrumbsModule] Breadcrumb modernised');
    }

    // =========================================================================
    // TOPIC HEADER
    // =========================================================================
    function extractTopicHeaderData() {
        var titleEl = document.querySelector(CONFIG.LEGACY_TITLE_SELECTOR);
        var topicTitle = titleEl ? titleEl.textContent.trim() : '';
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
        return { topicTitle, replyCount, viewCount, shareLink };
    }

    function buildTopicHeaderHtml(data) {
        if (!data.topicTitle) return '';
        var html = '<div class="topic-header"><div class="topic-title-content"><h1 class="topic-title">' + escapeHtml(data.topicTitle) + '</h1>';
        if (data.viewCount || data.replyCount) {
            html += '<div class="topic-meta">';
            if (data.viewCount) html += '<span class="topic-stats"><i class="fa-regular fa-eye" aria-hidden="true"></i><span>Views: ' + escapeHtml(data.viewCount) + '</span></span>';
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
        if (document.body.id !== 'topic') return;
        var data = extractTopicHeaderData();
        if (!data.topicTitle) {
            setTimeout(function () {
                var retryData = extractTopicHeaderData();
                if (!retryData.topicTitle) {
                    var breadcrumb = document.getElementById(CONFIG.MODERN_BREADCRUMB_ID);
                    if (breadcrumb) {
                        var currentEl = breadcrumb.querySelector('.modern-breadcrumb-item--current .modern-breadcrumb-text');
                        if (currentEl) retryData.topicTitle = currentEl.textContent.trim();
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
        var container = getOrCreateContainer(CONFIG.MODERN_TOPIC_HEADER_ID, 'div', 'modern-topic-header', '#' + CONFIG.MODERN_BREADCRUMB_ID);
        if (!container) return;
        container.innerHTML = buildTopicHeaderHtml(data);
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
        if (document.body.id !== 'search') return;
        var container = document.querySelector(CONFIG.MEMBER_POSTS_SELECTOR);
        if (!container) return;
        var data = extractMemberPostsHeaderData(container);
        if (!data.memberName) return;
        var headerContainer = getOrCreateContainer(CONFIG.MODERN_TOPIC_HEADER_ID, 'div', 'modern-topic-header', '#' + CONFIG.MODERN_BREADCRUMB_ID);
        if (!headerContainer) return;
        headerContainer.innerHTML = buildMemberPostsHeaderHtml(data);
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
        try { globalThis.forumObserver.register({ id: 'topic-header-module', selector: CONFIG.LEGACY_TITLE_SELECTOR, priority: 'high', pageTypes: ['topic'], callback: convertTopicHeader }); } catch (e) { console.error(e); }
        try { globalThis.forumObserver.register({ id: 'member-posts-header-module', selector: CONFIG.MEMBER_POSTS_SELECTOR, priority: 'high', callback: convertMemberPostsHeader }); } catch (e) { console.error(e); }
        [CONFIG.LEGACY_PAGINATION_SELECTOR_TOP, CONFIG.LEGACY_PAGINATION_SELECTOR_BOTTOM, CONFIG.LEGACY_PAGINATION_PLAIN_TOP, CONFIG.LEGACY_PAGINATION_PLAIN_BOTTOM].forEach(function (sel, idx) {
            try { globalThis.forumObserver.register({ id: 'pagination-module-' + idx, selector: sel, priority: 'high', callback: convertAllPagination }); } catch (e) { console.error(e); }
        });
        console.log('[BreadcrumbsModule] Registered with ForumCoreObserver');
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    function initialize() {
        if (document.querySelector(CONFIG.LEGACY_NAV_SELECTOR)) convertBreadcrumb();
        if (document.body.id === 'topic' && document.querySelector(CONFIG.LEGACY_TITLE_SELECTOR)) convertTopicHeader();
        if (document.body.id === 'search' && document.querySelector(CONFIG.MEMBER_POSTS_SELECTOR)) convertMemberPostsHeader();
        convertAllPagination();
        registerObserver();
        console.log('[BreadcrumbsModule] Initialised');
    }

    return {
        initialize: initialize,
        refresh: function () {
            convertBreadcrumb();
            if (document.body.id === 'topic') convertTopicHeader();
            if (document.body.id === 'search' && document.querySelector(CONFIG.MEMBER_POSTS_SELECTOR)) convertMemberPostsHeader();
            convertAllPagination();
        }
    };
})();

if (typeof window !== 'undefined') {
    window.BreadcrumbsModule = BreadcrumbsModule;
    window.dispatchEvent(new CustomEvent('breadcrumbs-module-ready'));
}
