/* =============================================
   Forum Boards & Topics Modernizer – Emerald Theme
   Converts legacy board list AND topic list into
   modern, card‑based layouts.
   ============================================= */
'use strict';

const ForumBoardsModule = (function () {
    console.log('🔥 ForumBoardsModule loaded (boards + topics)');

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        // Board list
        BOARD_LIST_SELECTOR: 'ul.board.List',
        CATEGORY_SELECTOR: 'li.skin_tbl',
        FORUM_ROW_SELECTOR: 'ul.big_list > li',
        BOARD_CONTAINER_ID: 'modern-board-list',

        // Topic list
        FORUM_WRAPPER_SELECTOR: 'div.forum',
        TOPIC_LIST_SELECTOR: 'ol.big_list',
        TOPIC_ROW_SELECTOR: 'li[id^="t"]',
        TOPIC_CONTAINER_ID: 'modern-topic-list',

        // Shared
        WRAPPER_ID: 'modern-forum-wrapper',
        INSERT_AFTER_SELECTOR: '.carousel-wrapper',
    });

    // =========================================================================
    // UTILITIES (self‑contained)
    // =========================================================================
    const escapeHtml = (str) => {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    function parseDateFromTitle(title) {
        if (!title) return null;
        title = title.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)?:(\d+)/i, '$1:$2 $3');
        const hasMeridiem = /[ap]m/i.test(title);
        const nums = title.match(/\d+/g);
        if (!nums || nums.length < 3) return null;
        let year, month, day, hour, minute, second;
        if (hasMeridiem) {
            month = parseInt(nums[0], 10) - 1;
            day = parseInt(nums[1], 10);
            year = parseInt(nums[2], 10);
            hour = parseInt(nums[3] || 0, 10);
            minute = parseInt(nums[4] || 0, 10);
            second = parseInt(nums[5] || 0, 10);
            const isPM = /pm/i.test(title);
            if (isPM && hour < 12) hour += 12;
            if (!isPM && hour === 12) hour = 0;
        } else {
            day = parseInt(nums[0], 10);
            month = parseInt(nums[1], 10) - 1;
            year = parseInt(nums[2], 10);
            hour = parseInt(nums[3] || 0, 10);
            minute = parseInt(nums[4] || 0, 10);
            second = parseInt(nums[5] || 0, 10);
        }
        return new Date(year, month, day, hour, minute, second);
    }

    function getRelativeTimeString(date) {
        if (!date || isNaN(date.getTime())) return 'Unknown';
        const now = new Date();
        const diff = date - now;
        const absDiff = Math.abs(diff) / 1000;
        const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'en', { numeric: 'auto' });
        if (absDiff < 60) return rtf.format(Math.floor(diff / 1000), 'second');
        if (absDiff < 3600) return rtf.format(Math.floor(diff / 60000), 'minute');
        if (absDiff < 86400) return rtf.format(Math.floor(diff / 3600000), 'hour');
        if (absDiff < 2592000) return rtf.format(-Math.floor(absDiff / 86400), 'day');
        if (absDiff < 31536000) return rtf.format(-Math.floor(absDiff / 2592000), 'month');
        return rtf.format(-Math.floor(absDiff / 31536000), 'year');
    }

    function formatNumber(num) {
        return (num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function extractTopicIdFromClass(row) {
        // classList like "on thumb t63480267 m12252299 g4"
        for (const cls of row.classList) {
            if (cls.startsWith('t') && /^t\d+$/.test(cls)) {
                return cls.substring(1);
            }
        }
        return '';
    }

    // =========================================================================
    // CONTAINER HELPERS
    // =========================================================================
    function getWrapper() {
        return document.getElementById(CONFIG.WRAPPER_ID);
    }

    function getOrCreateContainer(containerId) {
        const wrapper = getWrapper();
        if (!wrapper) return null;
        let container = document.getElementById(containerId);
        if (container) return container;

        const afterEl = wrapper.querySelector(CONFIG.INSERT_AFTER_SELECTOR);
        container = document.createElement('div');
        container.id = containerId;
        container.className = containerId === CONFIG.BOARD_CONTAINER_ID ? 'modern-board-list' : 'modern-topic-list';
        if (afterEl) {
            afterEl.insertAdjacentElement('afterend', container);
        } else {
            wrapper.appendChild(container);
        }
        return container;
    }

    // =========================================================================
    // BOARD LIST EXTRACTION & GENERATION
    // =========================================================================
    function extractForumData(row) {
        const id = row.id;
        const forumId = id ? id.replace('f', '') : '';

        const nameEl = row.querySelector('.bb h3 a');
        const forumName = nameEl ? nameEl.textContent.trim() : 'Unknown Forum';
        const forumUrl = nameEl ? nameEl.getAttribute('href') : '#';

        const topicsEm = row.querySelector('.yy .topics em');
        const repliesEm = row.querySelector('.yy .replies em');
        const topicsCount = topicsEm ? parseInt(topicsEm.textContent, 10) || 0 : 0;
        const repliesCount = repliesEm ? parseInt(repliesEm.textContent, 10) || 0 : 0;

        const whenEl = row.querySelector('.zz .when');
        const lastPostDateStr = whenEl ? whenEl.textContent.trim() : '';
        const lastPostDate = parseDateFromTitle(lastPostDateStr);
        const lastPostRelative = lastPostDate ? getRelativeTimeString(lastPostDate) : '';

        const whereEl = row.querySelector('.zz .where');
        let lastTopicUrl = '';
        let lastTopicHTML = '';
        let subForumUrl = '';
        let subForumName = '';
        if (whereEl) {
            const links = whereEl.querySelectorAll('a');
            if (links.length === 1) {
                lastTopicUrl = links[0].getAttribute('href') || '';
                lastTopicHTML = links[0].innerHTML;
            } else if (links.length >= 2) {
                subForumUrl = links[0].getAttribute('href') || '';
                subForumName = links[0].textContent.trim();
                lastTopicUrl = links[1].getAttribute('href') || '';
                lastTopicHTML = links[1].innerHTML;
            }
        }

        const whoLink = row.querySelector('.zz .who a');
        const lastPostAuthor = whoLink ? whoLink.textContent.trim() : '';
        const lastPostAuthorUrl = whoLink ? whoLink.getAttribute('href') : '';

        const iconEl = row.querySelector('.aa i');
        const iconClass = iconEl ? iconEl.className : 'fa-regular fa-folder';

        return {
            forumId, forumName, forumUrl, topicsCount, repliesCount,
            lastPostRelative, lastPostDateStr, lastTopicUrl, lastTopicHTML,
            subForumUrl, subForumName, lastPostAuthor, lastPostAuthorUrl, iconClass
        };
    }

    function extractCategoryData(catLi) {
        const id = catLi.id;
        const categoryId = id ? id.replace('c', '') : '';
        const titleEl = catLi.querySelector('h2.mtitle');
        const categoryName = titleEl ? titleEl.textContent.trim() : 'Category';
        return { categoryId, categoryName };
    }

    function generateForumCard(data) {
        let lastPostHtml = '';
        if (data.lastTopicUrl) {
            let subText = data.subForumName
                ? ` <span class="last-post-in">in</span> ${data.subForumUrl ? `<a href="${escapeHtml(data.subForumUrl)}">${escapeHtml(data.subForumName)}</a>` : escapeHtml(data.subForumName)} → `
                : ' ';
            lastPostHtml = `
                <div class="board-last-post">
                    <div class="last-post-topic">
                        ${subText}<a href="${escapeHtml(data.lastTopicUrl)}">${data.lastTopicHTML}</a>
                    </div>
                    <div class="last-post-meta">
                        <span class="last-post-date">${escapeHtml(data.lastPostRelative)}</span>
                        ${data.lastPostAuthor ? `<span class="last-post-author">by <a href="${escapeHtml(data.lastPostAuthorUrl)}">${escapeHtml(data.lastPostAuthor)}</a></span>` : ''}
                    </div>
                </div>`;
        } else {
            lastPostHtml = '<div class="board-last-post board-last-post--empty">No posts yet</div>';
        }

        return `
            <article class="board-card" data-forum-id="${data.forumId}" data-original-id="f${data.forumId}">
                <a href="${escapeHtml(data.forumUrl)}" class="board-card-main-link" aria-label="Go to ${escapeHtml(data.forumName)}">
                    <div class="board-icon">
                        <i class="${escapeHtml(data.iconClass)}" aria-hidden="true"></i>
                    </div>
                    <div class="board-info">
                        <h3 class="board-name">${escapeHtml(data.forumName)}</h3>
                        <div class="board-stats">
                            <span class="stat"><i class="fa-regular fa-message"></i> ${formatNumber(data.topicsCount)} topics</span>
                            <span class="stat"><i class="fa-regular fa-reply"></i> ${formatNumber(data.repliesCount)} replies</span>
                        </div>
                    </div>
                </a>
                ${lastPostHtml}
            </article>`;
    }

    // =========================================================================
    // TOPIC LIST EXTRACTION & GENERATION
    // =========================================================================
    function extractTopicData(row) {
        const topicId = extractTopicIdFromClass(row);
        const isUnread = row.classList.contains('on');   // new replies
        const statusIconEl = row.querySelector('.aa i');
        const statusIconClass = statusIconEl ? statusIconEl.className : 'fa-regular fa-folder';

        // Title
        const titleEl = row.querySelector('h3.web a');
        const topicTitle = titleEl ? titleEl.textContent.trim() : 'Unknown Topic';
        const topicUrl = titleEl ? titleEl.getAttribute('href') : '#';
        const topicTitleHTML = titleEl ? titleEl.innerHTML : escapeHtml(topicTitle); // preserve emoji

        // Thumbnail
        const thumbImg = row.querySelector('h4.desc a.a_desc img.tmb');
        const thumbnailUrl = thumbImg ? thumbImg.getAttribute('src') : null;

        // Starter
        const starterEl = row.querySelector('.xx a');
        const starterName = starterEl ? starterEl.textContent.trim() : 'Unknown';
        const starterUrl = starterEl ? starterEl.getAttribute('href') : '#';

        // Stats
        const repliesEl = row.querySelector('.yy .replies em');
        const viewsEl = row.querySelector('.yy .views em');
        const replyCount = repliesEl ? parseInt(repliesEl.textContent, 10) || 0 : 0;
        const viewCount = viewsEl ? parseInt(viewsEl.textContent, 10) || 0 : 0;

        // Last post
        const lastPostDateEl = row.querySelector('.zz .when a');
        const lastPostDateStr = lastPostDateEl ? lastPostDateEl.textContent.trim() : '';
        const lastPostDate = parseDateFromTitle(lastPostDateStr);
        const lastPostRelative = lastPostDate ? getRelativeTimeString(lastPostDate) : '';
        const lastPostUrl = lastPostDateEl ? lastPostDateEl.getAttribute('href') : topicUrl + '#newpost';

        const lastPosterEl = row.querySelector('.zz .who a');
        const lastPosterName = lastPosterEl ? lastPosterEl.textContent.trim() : starterName;
        const lastPosterUrl = lastPosterEl ? lastPosterEl.getAttribute('href') : starterUrl;

        return {
            topicId, isUnread, statusIconClass,
            topicTitle, topicUrl, topicTitleHTML,
            thumbnailUrl,
            starterName, starterUrl,
            replyCount, viewCount,
            lastPostRelative, lastPostUrl,
            lastPosterName, lastPosterUrl
        };
    }

function generateTopicCard(data) {
    // Thumbnail – now a standalone link
    let imageHtml;
    if (data.thumbnailUrl) {
        imageHtml = `<a href="${escapeHtml(data.topicUrl)}" class="topic-thumbnail" aria-hidden="true" tabindex="-1">
            <img src="${escapeHtml(data.thumbnailUrl)}" alt="" loading="lazy">
        </a>`;
    } else {
        imageHtml = `<a href="${escapeHtml(data.topicUrl)}" class="topic-thumbnail topic-thumbnail--placeholder" aria-hidden="true" tabindex="-1">
            <i class="fa-regular fa-comments"></i>
        </a>`;
    }

    const unreadBadge = data.isUnread
        ? '<span class="topic-unread-badge" title="New replies"><i class="fa-regular fa-circle"></i></span>'
        : '';

    // The whole card is now a container (<article>) without a single wrapper link
    return `
        <article class="topic-card" data-topic-id="${data.topicId}" data-original-id="t${data.topicId}">
            ${imageHtml}
            <div class="topic-info">
                <h3 class="topic-title"><a href="${escapeHtml(data.topicUrl)}">${unreadBadge}${data.topicTitleHTML}</a></h3>
                <div class="topic-meta">
                    <span class="topic-starter">by <a href="${escapeHtml(data.starterUrl)}">${escapeHtml(data.starterName)}</a></span>
                    <span class="topic-stats">
                        <span><i class="fa-regular fa-reply"></i> ${formatNumber(data.replyCount)} replies</span>
                        <span><i class="fa-regular fa-eye"></i> ${formatNumber(data.viewCount)} views</span>
                    </span>
                </div>
                <div class="topic-last-post">
                    <span class="last-post-date">${escapeHtml(data.lastPostRelative)}</span>
                    ${data.lastPosterName !== data.starterName ? `<span class="last-post-author">by <a href="${escapeHtml(data.lastPosterUrl)}">${escapeHtml(data.lastPosterName)}</a></span>` : ''}
                </div>
            </div>
        </article>`;
}

    // =========================================================================
    // BUILD MODERN LISTS
    // =========================================================================
    function buildModernBoardList() {
        const legacyList = document.querySelector(CONFIG.BOARD_LIST_SELECTOR);
        if (!legacyList) return '';

        const categories = legacyList.querySelectorAll(CONFIG.CATEGORY_SELECTOR);
        if (categories.length === 0) return '';

        let html = '';
        categories.forEach(cat => {
            const catData = extractCategoryData(cat);
            const forumRows = cat.querySelectorAll(CONFIG.FORUM_ROW_SELECTOR);
            if (forumRows.length === 0) return;

            html += `<section class="board-category" data-category-id="${catData.categoryId}">
                <header class="board-category-header">
                    <h2 class="board-category-title">${escapeHtml(catData.categoryName)}</h2>
                </header>
                <div class="board-category-grid">`;

            forumRows.forEach(row => {
                const data = extractForumData(row);
                html += generateForumCard(data);
            });

            html += `</div></section>`;
        });
        return html;
    }

    function buildModernTopicList() {
        const forumWrapper = document.querySelector(CONFIG.FORUM_WRAPPER_SELECTOR);
        if (!forumWrapper) return '';

        const topicList = forumWrapper.querySelector(CONFIG.TOPIC_LIST_SELECTOR);
        if (!topicList) return '';

        const rows = topicList.querySelectorAll(CONFIG.TOPIC_ROW_SELECTOR);
        if (rows.length === 0) return '';

        // Get the forum title from the header
        const forumTitleEl = forumWrapper.querySelector('.mtitle h1');
        const forumTitle = forumTitleEl ? forumTitleEl.textContent.trim() : 'Forum';

        let html = `<section class="topic-list-section">
            <header class="topic-list-header">
                <h2 class="topic-list-title">${escapeHtml(forumTitle)}</h2>
            </header>
            <div class="topic-cards-grid">`;

        rows.forEach(row => {
            const data = extractTopicData(row);
            html += generateTopicCard(data);
        });

        html += `</div></section>`;
        return html;
    }

    // =========================================================================
    // CONVERSION FUNCTIONS
    // =========================================================================
    function convertBoards() {
        const container = getOrCreateContainer(CONFIG.BOARD_CONTAINER_ID);
        if (!container) return;
        const modernHtml = buildModernBoardList();
        if (!modernHtml) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = modernHtml;
        console.log('[BoardsModule] Board list modernized');
    }

    function convertTopics() {
        const container = getOrCreateContainer(CONFIG.TOPIC_CONTAINER_ID);
        if (!container) return;
        const modernHtml = buildModernTopicList();
        if (!modernHtml) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = modernHtml;
        console.log('[BoardsModule] Topic list modernized');
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    function initialize() {
        // Board index
        if (document.querySelector(CONFIG.BOARD_LIST_SELECTOR)) {
            convertBoards();
        }
        // Forum view (topic list)
        if (document.querySelector(CONFIG.FORUM_WRAPPER_SELECTOR)) {
            convertTopics();
        }
        console.log('[BoardsModule] Initialized');
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    return {
        initialize,
        refresh: function () {
            convertBoards();
            convertTopics();
        }
    };
})();

// Auto‑initialize when DOM is ready
if (document.readyState === 'interactive' || document.readyState === 'complete') {
    setTimeout(() => ForumBoardsModule.initialize(), 0);
} else {
    document.addEventListener('DOMContentLoaded', () => ForumBoardsModule.initialize());
}

// Expose globally
if (typeof window !== 'undefined') {
    window.ForumBoardsModule = ForumBoardsModule;
    window.dispatchEvent(new CustomEvent('boards-module-ready'));
}
