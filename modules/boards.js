/* =============================================
   Forum Boards & Topics Modernizer – Emerald Theme
   Converts legacy board list AND topic list into
   modern, card‑based layouts with author avatars.
   ============================================= */
'use strict';

const ForumBoardsModule = (function () {
    console.log('🔥 ForumBoardsModule loaded (boards + topics + avatars)');

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

        // Avatar
        AVATAR_SIZE: 24,
        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 80
    });

    // =========================================================================
    // AVATAR COLOUR PALETTE (same as Posts module)
    // =========================================================================
    const AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

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
        for (const cls of row.classList) {
            if (cls.startsWith('t') && /^t\d+$/.test(cls)) {
                return cls.substring(1);
            }
        }
        return '';
    }

    function extractMidFromUrl(url) {
        if (!url) return null;
        const match = url.match(/MID=(\d+)/);
        return match ? match[1] : null;
    }

    // =========================================================================
    // AVATAR HELPERS (same as Posts module)
    // =========================================================================
    const userDataCache = new Map();

    async function fetchUserData(mid) {
        if (userDataCache.has(mid)) return userDataCache.get(mid);
        try {
            const response = await fetch('/api.php?mid=' + mid);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            const user = data['m' + mid] || data.info;
            if (user && user.id) {
                userDataCache.set(mid, user);
                return user;
            }
            return null;
        } catch (e) {
            console.warn('[BoardsModule] API error for MID', mid, e);
            return null;
        }
    }

    function getColorFromNickname(nickname, userId) {
        let hash = 0;
        const str = nickname || userId || 'user';
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function isValidAvatarUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        return /^(https?:)?\/\//i.test(trimmed) && trimmed.length > 3;
    }

    function optimizeImageUrl(url, width, height) {
        if (!isValidAvatarUrl(url)) return null;
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.indexOf('weserv.nl') !== -1 || lowerUrl.indexOf('data:') === 0) return url;
        const encodedUrl = encodeURIComponent(url);
        return CONFIG.WESERV_CDN + '?url=' + encodedUrl +
            '&output=webp&maxage=' + CONFIG.CACHE + '&q=' + CONFIG.QUALITY +
            '&w=' + width + '&h=' + height + '&fit=cover&a=attention&il';
    }

    function getUserAvatarData(user, username, userId) {
        function isDefaultAvatarUrl(url) {
            return url && url.includes('style_images/default_avatar.png');
        }
        if (user && user.avatar && isValidAvatarUrl(user.avatar) && !isDefaultAvatarUrl(user.avatar)) {
            let avatarUrl = user.avatar;
            if (avatarUrl.startsWith('//')) avatarUrl = 'https:' + avatarUrl;
            if (avatarUrl.startsWith('http://') && window.location.protocol === 'https:') {
                avatarUrl = avatarUrl.replace('http://', 'https://');
            }
            const optimized = optimizeImageUrl(avatarUrl, CONFIG.AVATAR_SIZE, CONFIG.AVATAR_SIZE);
            if (optimized) return { type: 'img', url: optimized };
        }
        const initial = username ? username.charAt(0).toUpperCase() : '?';
        const safeInitial = (/[A-Z0-9]/i.test(initial)) ? initial : '?';
        const bgColor = getColorFromNickname(username, userId);
        return { type: 'initial', initial: safeInitial, bgColor: bgColor };
    }

    function generateAvatarHtml(user, username, userId) {
        const avatarData = getUserAvatarData(user, username, userId);
        if (avatarData.type === 'img') {
            return '<img class="mini-avatar" src="' + escapeHtml(avatarData.url) +
                '" alt="' + escapeHtml(username) + '" width="' + CONFIG.AVATAR_SIZE +
                '" height="' + CONFIG.AVATAR_SIZE + '" loading="lazy">';
        } else {
            return '<span class="mini-avatar mini-avatar--initial" style="background-color:#' +
                avatarData.bgColor + ';">' + escapeHtml(avatarData.initial) + '</span>';
        }
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
        const lastPostAuthorMid = extractMidFromUrl(lastPostAuthorUrl);

        const iconEl = row.querySelector('.aa i');
        const iconClass = iconEl ? iconEl.className : 'fa-regular fa-folder';

        return {
            forumId, forumName, forumUrl, topicsCount, repliesCount,
            lastPostRelative, lastPostDateStr, lastTopicUrl, lastTopicHTML,
            subForumUrl, subForumName, lastPostAuthor, lastPostAuthorUrl,
            lastPostAuthorMid, iconClass
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
        var avatarHtml = '';
        if (data.lastPostAuthorMid && data.lastPostAuthor) {
            const user = userDataCache.get(data.lastPostAuthorMid);
            avatarHtml = generateAvatarHtml(user, data.lastPostAuthor, data.lastPostAuthorMid);
        }

        var lastPostHtml = '';
        if (data.lastTopicUrl) {
            var subText = ' ';
            if (data.subForumName) {
                var subLink = data.subForumUrl
                    ? '<a href="' + escapeHtml(data.subForumUrl) + '">' + escapeHtml(data.subForumName) + '</a>'
                    : escapeHtml(data.subForumName);
                subText = ' <span class="last-post-in">in</span> ' + subLink + ' \u2192 ';
            }
            var authorHtml = data.lastPostAuthor
                ? '<span class="last-post-author">' + avatarHtml +
                    '<a href="' + escapeHtml(data.lastPostAuthorUrl) + '">' + escapeHtml(data.lastPostAuthor) + '</a></span>'
                : '';

            lastPostHtml =
                '<div class="board-last-post">' +
                    '<div class="last-post-topic">' +
                        subText + '<a href="' + escapeHtml(data.lastTopicUrl) + '">' + data.lastTopicHTML + '</a>' +
                    '</div>' +
                    '<div class="last-post-meta">' +
                        '<span class="last-post-date">' + escapeHtml(data.lastPostRelative) + '</span>' +
                        authorHtml +
                    '</div>' +
                '</div>';
        } else {
            lastPostHtml = '<div class="board-last-post board-last-post--empty">No posts yet</div>';
        }

        return (
            '<article class="board-card" data-forum-id="' + data.forumId + '" data-original-id="f' + data.forumId + '">' +
                '<a href="' + escapeHtml(data.forumUrl) + '" class="board-card-main-link" aria-label="Go to ' + escapeHtml(data.forumName) + '">' +
                    '<div class="board-icon">' +
                        '<i class="' + escapeHtml(data.iconClass) + '" aria-hidden="true"></i>' +
                    '</div>' +
                    '<div class="board-info">' +
                        '<h3 class="board-name">' + escapeHtml(data.forumName) + '</h3>' +
                        '<div class="board-stats">' +
                            '<span class="stat"><i class="fa-regular fa-message"></i> ' + formatNumber(data.topicsCount) + ' topics</span>' +
                            '<span class="stat"><i class="fa-regular fa-reply"></i> ' + formatNumber(data.repliesCount) + ' replies</span>' +
                        '</div>' +
                    '</div>' +
                '</a>' +
                lastPostHtml +
            '</article>'
        );
    }

    // =========================================================================
    // TOPIC LIST EXTRACTION & GENERATION
    // =========================================================================
    function extractTopicData(row) {
        const topicId = extractTopicIdFromClass(row);
        const isUnread = row.classList.contains('on');
        const statusIconEl = row.querySelector('.aa i');
        const statusIconClass = statusIconEl ? statusIconEl.className : 'fa-regular fa-folder';

        const titleEl = row.querySelector('h3.web a');
        const topicTitle = titleEl ? titleEl.textContent.trim() : 'Unknown Topic';
        const topicUrl = titleEl ? titleEl.getAttribute('href') : '#';
        const topicTitleHTML = titleEl ? titleEl.innerHTML : escapeHtml(topicTitle);

        const thumbImg = row.querySelector('h4.desc a.a_desc img.tmb');
        const thumbnailUrl = thumbImg ? thumbImg.getAttribute('src') : null;

        const starterEl = row.querySelector('.xx a');
        const starterName = starterEl ? starterEl.textContent.trim() : 'Unknown';
        const starterUrl = starterEl ? starterEl.getAttribute('href') : '#';
        const starterMid = extractMidFromUrl(starterUrl);

        const repliesEl = row.querySelector('.yy .replies em');
        const viewsEl = row.querySelector('.yy .views em');
        const replyCount = repliesEl ? parseInt(repliesEl.textContent, 10) || 0 : 0;
        const viewCount = viewsEl ? parseInt(viewsEl.textContent, 10) || 0 : 0;

        const lastPostDateEl = row.querySelector('.zz .when a');
        const lastPostDateStr = lastPostDateEl ? lastPostDateEl.textContent.trim() : '';
        const lastPostDate = parseDateFromTitle(lastPostDateStr);
        const lastPostRelative = lastPostDate ? getRelativeTimeString(lastPostDate) : '';
        const lastPostUrl = lastPostDateEl ? lastPostDateEl.getAttribute('href') : topicUrl + '#newpost';

        const lastPosterEl = row.querySelector('.zz .who a');
        const lastPosterName = lastPosterEl ? lastPosterEl.textContent.trim() : starterName;
        const lastPosterUrl = lastPosterEl ? lastPosterEl.getAttribute('href') : starterUrl;
        const lastPosterMid = extractMidFromUrl(lastPosterUrl);

        return {
            topicId, isUnread, statusIconClass,
            topicTitle, topicUrl, topicTitleHTML,
            thumbnailUrl,
            starterName, starterUrl, starterMid,
            replyCount, viewCount,
            lastPostRelative, lastPostUrl,
            lastPosterName, lastPosterUrl, lastPosterMid
        };
    }

    function generateTopicCard(data) {
        var imageHtml;
        if (data.thumbnailUrl) {
            imageHtml =
                '<div class="topic-thumbnail">' +
                    '<a href="' + escapeHtml(data.topicUrl) + '" aria-label="View topic: ' + escapeHtml(data.topicTitle) + '">' +
                        '<img src="' + escapeHtml(data.thumbnailUrl) + '" alt="" loading="lazy">' +
                    '</a>' +
                '</div>';
        } else {
            imageHtml =
                '<div class="topic-thumbnail topic-thumbnail--placeholder">' +
                    '<a href="' + escapeHtml(data.topicUrl) + '" aria-label="View topic: ' + escapeHtml(data.topicTitle) + '">' +
                        '<i class="fa-regular fa-comments"></i>' +
                    '</a>' +
                '</div>';
        }

        var statusIconTitle = data.isUnread ? 'New replies' : 'No new replies';
        var statusIconHtml =
            '<span class="topic-status-icon" title="' + escapeHtml(statusIconTitle) + '">' +
                '<i class="' + escapeHtml(data.statusIconClass) + '" aria-hidden="true"></i>' +
            '</span>';

        var unreadBadge = data.isUnread
            ? '<span class="topic-unread-badge" title="New replies"><i class="fa-regular fa-circle"></i></span>'
            : '';

        var lastPosterAvatarHtml = '';
        if (data.lastPosterMid && data.lastPosterName) {
            const user = userDataCache.get(data.lastPosterMid);
            lastPosterAvatarHtml = generateAvatarHtml(user, data.lastPosterName, data.lastPosterMid);
        }

        var lastPosterHtml =
            '<span class="last-post-author">' + lastPosterAvatarHtml +
                '<a href="' + escapeHtml(data.lastPosterUrl) + '">' + escapeHtml(data.lastPosterName) + '</a></span>';

        return (
            '<article class="topic-card" data-topic-id="' + data.topicId + '" data-original-id="t' + data.topicId + '">' +
                imageHtml +
                '<div class="topic-info">' +
                    '<h3 class="topic-title">' +
                        statusIconHtml + unreadBadge +
                        '<a href="' + escapeHtml(data.topicUrl) + '">' + data.topicTitleHTML + '</a>' +
                    '</h3>' +
                    '<div class="topic-meta">' +
                        '<span class="topic-starter">by <a href="' + escapeHtml(data.starterUrl) + '">' + escapeHtml(data.starterName) + '</a></span>' +
                        '<span class="topic-stats">' +
                            '<span><i class="fa-regular fa-reply"></i> ' + formatNumber(data.replyCount) + ' replies</span>' +
                            '<span><i class="fa-regular fa-eye"></i> ' + formatNumber(data.viewCount) + ' views</span>' +
                        '</span>' +
                    '</div>' +
                    '<div class="topic-last-post">' +
                        '<a href="' + escapeHtml(data.lastPostUrl) + '" class="last-post-date-link">' +
                            '<i class="fa-regular fa-clock"></i> ' + escapeHtml(data.lastPostRelative) +
                        '</a>' +
                        lastPosterHtml +
                    '</div>' +
                '</div>' +
            '</article>'
        );
    }

    // =========================================================================
    // DATA FETCHING & RENDERING
    // =========================================================================
    async function fetchAllRelevantUsers(boardRows, topicRows) {
        const mids = new Set();
        // Collect MIDs from board rows (last post author)
        boardRows.forEach(function (row) {
            const whoLink = row.querySelector('.zz .who a');
            if (whoLink) {
                const mid = extractMidFromUrl(whoLink.getAttribute('href'));
                if (mid) mids.add(mid);
            }
        });
        // Collect MIDs from topic rows (last post author)
        topicRows.forEach(function (row) {
            const whoLink = row.querySelector('.zz .who a');
            if (whoLink) {
                const mid = extractMidFromUrl(whoLink.getAttribute('href'));
                if (mid) mids.add(mid);
            }
        });
        // Fetch all in parallel
        await Promise.all(Array.from(mids).map(function (mid) {
            return fetchUserData(mid);
        }));
    }

    // =========================================================================
    // BUILD MODERN LISTS
    // =========================================================================
    function buildModernBoardList(categories) {
        var html = '';
        categories.forEach(function (cat) {
            const catData = extractCategoryData(cat);
            const forumRows = cat.querySelectorAll(CONFIG.FORUM_ROW_SELECTOR);
            if (forumRows.length === 0) return;

            html +=
                '<section class="board-category" data-category-id="' + catData.categoryId + '">' +
                    '<header class="board-category-header">' +
                        '<h2 class="board-category-title">' + escapeHtml(catData.categoryName) + '</h2>' +
                    '</header>' +
                    '<div class="board-category-grid">';

            forumRows.forEach(function (row) {
                const data = extractForumData(row);
                html += generateForumCard(data);
            });

            html += '</div></section>';
        });
        return html;
    }

    function buildModernTopicList(forumWrapper) {
        const topicList = forumWrapper.querySelector(CONFIG.TOPIC_LIST_SELECTOR);
        if (!topicList) return '';

        const rows = topicList.querySelectorAll(CONFIG.TOPIC_ROW_SELECTOR);
        if (rows.length === 0) return '';

        const forumTitleEl = forumWrapper.querySelector('.mtitle h1');
        const forumTitle = forumTitleEl ? forumTitleEl.textContent.trim() : 'Forum';

        var html =
            '<section class="topic-list-section">' +
                '<header class="topic-list-header">' +
                    '<h2 class="topic-list-title">' + escapeHtml(forumTitle) + '</h2>' +
                '</header>' +
                '<div class="topic-cards-grid">';

        rows.forEach(function (row) {
            const data = extractTopicData(row);
            html += generateTopicCard(data);
        });

        html += '</div></section>';
        return html;
    }

    // =========================================================================
    // CONVERSION FUNCTIONS (async)
    // =========================================================================
    async function convertBoards() {
        const container = getOrCreateContainer(CONFIG.BOARD_CONTAINER_ID);
        if (!container) return;

        const legacyList = document.querySelector(CONFIG.BOARD_LIST_SELECTOR);
        if (!legacyList) return;

        const categories = legacyList.querySelectorAll(CONFIG.CATEGORY_SELECTOR);
        if (categories.length === 0) return;

        // Collect all forum rows (to extract MID later, but we'll do it in fetchAllRelevantUsers)
        const allForumRows = [];
        categories.forEach(function (cat) {
            const rows = cat.querySelectorAll(CONFIG.FORUM_ROW_SELECTOR);
            rows.forEach(function (row) { allForumRows.push(row); });
        });

        // No topic rows for board page, pass empty
        await fetchAllRelevantUsers(allForumRows, []);

        const modernHtml = buildModernBoardList(categories);
        container.innerHTML = modernHtml || '';
        console.log('[BoardsModule] Board list modernized');
    }

    async function convertTopics() {
        const container = getOrCreateContainer(CONFIG.TOPIC_CONTAINER_ID);
        if (!container) return;

        const forumWrapper = document.querySelector(CONFIG.FORUM_WRAPPER_SELECTOR);
        if (!forumWrapper) return;

        const topicList = forumWrapper.querySelector(CONFIG.TOPIC_LIST_SELECTOR);
        if (!topicList) return;

        const topicRows = topicList.querySelectorAll(CONFIG.TOPIC_ROW_SELECTOR);
        if (topicRows.length === 0) return;

        // No board rows for topic page
        await fetchAllRelevantUsers([], Array.from(topicRows));

        const modernHtml = buildModernTopicList(forumWrapper);
        container.innerHTML = modernHtml || '';
        console.log('[BoardsModule] Topic list modernized');
    }

    // =========================================================================
    // INITIALIZATION (async)
    // =========================================================================
    async function initialize() {
        if (document.querySelector(CONFIG.BOARD_LIST_SELECTOR)) {
            await convertBoards();
        }
        if (document.querySelector(CONFIG.FORUM_WRAPPER_SELECTOR)) {
            await convertTopics();
        }
        console.log('[BoardsModule] Initialized');
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    return {
        initialize: initialize,
        refresh: async function () {
            userDataCache.clear();
            await initialize();
        }
    };
})();

// Auto‑initialize when DOM is ready
if (document.readyState === 'interactive' || document.readyState === 'complete') {
    setTimeout(function () { ForumBoardsModule.initialize(); }, 0);
} else {
    document.addEventListener('DOMContentLoaded', function () { ForumBoardsModule.initialize(); });
}

// Expose globally
if (typeof window !== 'undefined') {
    window.ForumBoardsModule = ForumBoardsModule;
    window.dispatchEvent(new CustomEvent('boards-module-ready'));
}
