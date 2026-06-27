/* =============================================
   Forum Boards, Topics, Latest Posts & Stats Modernizer
   Emerald Theme – all lists in one module
   ============================================= */
'use strict';

const ForumBoardsModule = (function () {
    console.log('🔥 ForumBoardsModule loaded (boards + topics + latest posts + stats + role avatars)');

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        // Board list
        BOARD_LIST_SELECTOR: 'ul.board.List',
        CATEGORY_SELECTOR: 'li.skin_tbl',
        FORUM_ROW_SELECTOR: 'ul.big_list > li',
        BOARD_CONTAINER_ID: 'modern-board-list',

        // Topic list (forum view & subscriptions)
        FORUM_WRAPPER_SELECTOR: 'div.forum',
        TOPIC_LIST_SELECTOR: 'ol.big_list',
        TOPIC_ROW_SELECTOR: 'li[id^="t"]',
        TOPIC_CONTAINER_ID: 'modern-topic-list',

        // Latest posts
        LATEST_POSTS_SELECTOR: 'div.side_topics',
        LATEST_POST_ITEM_SELECTOR: 'div.topic',
        LATEST_POSTS_CONTAINER_ID: 'modern-latest-posts',

        // Stats (who's online + forum statistics)
        STATS_SELECTOR: 'ul.stats.List',
        STATS_CONTAINER_ID: 'modern-stats',

        // Shared
        WRAPPER_ID: 'modern-forum-wrapper',
        INSERT_AFTER_SELECTOR: '.carousel-wrapper',

        // Avatar
        AVATAR_SIZE_MINI: 20,   // for last‑post author icons
        AVATAR_SIZE_SMALL: 32,  // for latest‑posts thumbnails
        AVATAR_SIZE_ONLINE: 32, // for online users
        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 80,

        // Collapse (board categories)
        COLLAPSE_STORAGE_PREFIX: 'board-cat-',

        // Container order
        ORDERED_CONTAINERS: [
            'modern-latest-posts',
            'modern-board-list',
            'modern-topic-list',
            'modern-stats'
        ]
    });

    // =========================================================================
    // AVATAR COLOUR PALETTE
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
    // UTILITIES
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

    function getLastSundayOfMonth(year, monthIndex) {
        var lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
        var dayOfWeek = lastDay.getUTCDay();
        lastDay.setUTCDate(lastDay.getUTCDate() - dayOfWeek);
        lastDay.setUTCHours(0, 0, 0, 0);
        return lastDay.getTime();
    }

    function isItalianDST(day, month, year) {
        var dstStart = getLastSundayOfMonth(year, 2);
        var dstEnd   = getLastSundayOfMonth(year, 9);
        var target = Date.UTC(year, month - 1, day);
        return target >= dstStart && target < dstEnd;
    }

    function parseItalianDate(dateStr) {
        if (!dateStr) return null;
        var parts = dateStr.trim().split(/[\s,]+/);
        if (parts.length < 2) return null;
        var dateNums = parts[0].split('/');
        var timeNums = parts[1].split(':');
        if (dateNums.length < 3 || timeNums.length < 2) return null;
        var day   = parseInt(dateNums[0], 10);
        var month = parseInt(dateNums[1], 10);
        var year  = parseInt(dateNums[2], 10);
        var hour  = parseInt(timeNums[0], 10);
        var min   = parseInt(timeNums[1], 10);
        var offsetMinutes = isItalianDST(day, month, year) ? 120 : 60;
        var utcMs = Date.UTC(year, month - 1, day, hour, min) - offsetMinutes * 60000;
        return new Date(utcMs);
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
            if (cls.startsWith('t') && /^t\d+$/.test(cls)) return cls.substring(1);
        }
        return '';
    }

    function extractMidFromUrl(url) {
        if (!url) return null;
        const match = url.match(/MID=(\d+)/);
        return match ? match[1] : null;
    }

    // =========================================================================
    // AVATAR HELPERS
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
            const optimized = optimizeImageUrl(avatarUrl, CONFIG.AVATAR_SIZE_ONLINE, CONFIG.AVATAR_SIZE_ONLINE);
            if (optimized) return { type: 'img', url: optimized };
        }
        const initial = username ? username.charAt(0).toUpperCase() : '?';
        const safeInitial = (/[A-Z0-9]/i.test(initial)) ? initial : '?';
        const bgColor = getColorFromNickname(username, userId);
        return { type: 'initial', initial: safeInitial, bgColor: bgColor };
    }

    function sanitizeGroupName(groupName) {
        if (!groupName) return 'member';
        return groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function getGroupClass(user) {
        if (!user || !user.group || !user.group.name) return 'group-member';
        const groupName = user.group.name;
        if (user.group.class && user.group.class.includes('founder')) return 'group-founder';
        const sanitized = sanitizeGroupName(groupName);
        return 'group-' + sanitized;
    }

    function generateAvatarHtml(user, username, userId, size) {
        const effectiveSize = size || CONFIG.AVATAR_SIZE_MINI;
        const avatarData = getUserAvatarData(user, username, userId);
        const groupClass = getGroupClass(user);
        if (avatarData.type === 'img') {
            let url = avatarData.url;
            if (effectiveSize !== CONFIG.AVATAR_SIZE_MINI && effectiveSize !== CONFIG.AVATAR_SIZE_SMALL && effectiveSize !== CONFIG.AVATAR_SIZE_ONLINE) {
                url = optimizeImageUrl(user.avatar, effectiveSize, effectiveSize) || url;
            }
            return '<img class="mini-avatar ' + groupClass + '" src="' + escapeHtml(url) +
                '" alt="' + escapeHtml(username) + '" width="' + effectiveSize +
                '" height="' + effectiveSize + '" loading="lazy">';
        } else {
            return '<span class="mini-avatar mini-avatar--initial ' + groupClass + '" style="background-color:#' +
                avatarData.bgColor + ';width:' + effectiveSize + 'px;height:' + effectiveSize + 'px;font-size:' + (effectiveSize * 0.618) + 'px;line-height:' + effectiveSize + 'px;">' +
                escapeHtml(avatarData.initial) + '</span>';
        }
    }

    // =========================================================================
    // CONTAINER HELPERS
    // =========================================================================
    function getWrapper() { return document.getElementById(CONFIG.WRAPPER_ID); }

    function getOrCreateContainer(containerId) {
        const wrapper = getWrapper();
        if (!wrapper) return null;
        let container = document.getElementById(containerId);
        if (container) return container;

        container = document.createElement('div');
        container.id = containerId;
        container.className = containerId;
        const afterEl = wrapper.querySelector(CONFIG.INSERT_AFTER_SELECTOR);
        if (afterEl) {
            afterEl.insertAdjacentElement('afterend', container);
        } else {
            wrapper.appendChild(container);
        }
        return container;
    }

    function reorderContainers() {
        const wrapper = getWrapper();
        if (!wrapper) return;
        CONFIG.ORDERED_CONTAINERS.forEach(function (id) {
            const el = document.getElementById(id);
            if (el && el.parentNode === wrapper) {
                wrapper.appendChild(el);
            }
        });
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

        const thumbImg = row.querySelector('.bb img');
        var thumbnailUrl = null;
        if (thumbImg) {
            const style = thumbImg.getAttribute('style') || '';
            const bgMatch = style.match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
            if (bgMatch && bgMatch[1]) thumbnailUrl = bgMatch[1];
        }

        const topicsEm = row.querySelector('.yy .topics em');
        const repliesEm = row.querySelector('.yy .replies em');
        const topicsCount = topicsEm ? parseInt(topicsEm.textContent, 10) || 0 : 0;
        const repliesCount = repliesEm ? parseInt(repliesEm.textContent, 10) || 0 : 0;

        const whenEl = row.querySelector('.zz .when');
        const lastPostDateStr = whenEl ? whenEl.textContent.trim() : '';
        const lastPostDate = parseDateFromTitle(lastPostDateStr);
        const lastPostRelative = lastPostDate ? getRelativeTimeString(lastPostDate) : '';

        const whereEl = row.querySelector('.zz .where');
        let lastTopicUrl = '', lastTopicHTML = '', subForumUrl = '', subForumName = '';
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
        const isUnread = row.classList.contains('on');

        return {
            forumId, forumName, forumUrl,
            thumbnailUrl, topicsCount, repliesCount,
            lastPostRelative, lastPostDateStr,
            lastTopicUrl, lastTopicHTML,
            subForumUrl, subForumName,
            lastPostAuthor, lastPostAuthorUrl, lastPostAuthorMid,
            iconClass, isUnread
        };
    }

    function extractCategoryData(catLi) {
        const id = catLi.id;
        const categoryId = id ? id.replace('c', '') : '';
        const titleEl = catLi.querySelector('h2.mtitle');
        const categoryName = titleEl ? titleEl.textContent.trim() : 'Category';
        return { categoryId, categoryName };
    }

    function buildThumbnailDiv(linkUrl, label, bgUrl) {
        if (bgUrl) {
            return '<div class="modern-thumbnail modern-thumbnail--bg" style="background-image: url(\'' + escapeHtml(bgUrl) + '\');">' +
                       '<a href="' + escapeHtml(linkUrl) + '" aria-label="' + escapeHtml(label) + '" class="modern-thumbnail-cover-link"></a>' +
                   '</div>';
        } else {
            return '<div class="modern-thumbnail modern-thumbnail--placeholder">' +
                       '<a href="' + escapeHtml(linkUrl) + '" aria-label="' + escapeHtml(label) + '">' +
                           '<i class="fa-regular fa-comments"></i>' +
                       '</a>' +
                   '</div>';
        }
    }

    function generateForumCard(data) {
        var imageHtml = buildThumbnailDiv(data.forumUrl, 'Go to ' + data.forumName, data.thumbnailUrl);

        var statusIconTitle = data.isUnread ? 'New posts' : 'No new posts';
        var statusIconHtml =
            '<span class="topic-status-icon" title="' + escapeHtml(statusIconTitle) + '">' +
                '<i class="' + escapeHtml(data.iconClass) + '" aria-hidden="true"></i>' +
            '</span>';

        var lastPostHtml = '';
        if (data.lastTopicUrl) {
            var subText = ' ';
            if (data.subForumName) {
                var subLink = data.subForumUrl
                    ? '<a href="' + escapeHtml(data.subForumUrl) + '">' + escapeHtml(data.subForumName) + '</a>'
                    : escapeHtml(data.subForumName);
                subText = ' <span class="last-post-in">in</span> ' + subLink + ' \u2192 ';
            }

            var avatarHtml = '';
            if (data.lastPostAuthorMid && data.lastPostAuthor) {
                const user = userDataCache.get(data.lastPostAuthorMid);
                avatarHtml = generateAvatarHtml(user, data.lastPostAuthor, data.lastPostAuthorMid, CONFIG.AVATAR_SIZE_MINI);
            }
            var authorHtml = data.lastPostAuthor
                ? '<span class="last-post-author">' + avatarHtml +
                    '<a href="' + escapeHtml(data.lastPostAuthorUrl) + '">' + escapeHtml(data.lastPostAuthor) + '</a></span>'
                : '';

            lastPostHtml =
                '<div class="modern-last-post">' +
                    '<div class="last-post-topic">' +
                        subText + '<a href="' + escapeHtml(data.lastTopicUrl) + '">' + data.lastTopicHTML + '</a>' +
                    '</div>' +
                    '<div class="last-post-meta">' +
                        '<span class="last-post-date">' + escapeHtml(data.lastPostRelative) + '</span>' +
                        authorHtml +
                    '</div>' +
                '</div>';
        } else {
            lastPostHtml = '<div class="modern-last-post modern-last-post--empty">No posts yet</div>';
        }

        return (
            '<article class="modern-card" data-forum-id="' + data.forumId + '" data-original-id="f' + data.forumId + '">' +
                imageHtml +
                '<div class="modern-info">' +
                    '<h3 class="modern-title">' +
                        statusIconHtml +
                        '<a href="' + escapeHtml(data.forumUrl) + '">' + escapeHtml(data.forumName) + '</a>' +
                    '</h3>' +
                    '<div class="modern-meta">' +
                        '<span class="modern-stats">' +
                            '<span><i class="fa-regular fa-message"></i> ' + formatNumber(data.topicsCount) + ' topics</span>' +
                            '<span><i class="fa-regular fa-reply"></i> ' + formatNumber(data.repliesCount) + ' replies</span>' +
                        '</span>' +
                    '</div>' +
                    lastPostHtml +
                '</div>' +
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

        const thumbImg = row.querySelector('h4.desc img');
        const thumbnailUrl = thumbImg ? thumbImg.getAttribute('src') : null;

        const starterEl = row.querySelector('.xx a');
        const starterName = starterEl ? starterEl.textContent.trim() : '';
        const starterUrl = starterEl ? starterEl.getAttribute('href') : '#';
        const starterMid = starterEl ? extractMidFromUrl(starterUrl) : null;

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
        var imageHtml = buildThumbnailDiv(data.topicUrl, 'View topic: ' + data.topicTitle, data.thumbnailUrl);

        var statusIconTitle = data.isUnread ? 'New replies' : 'No new replies';
        var statusIconHtml =
            '<span class="topic-status-icon" title="' + escapeHtml(statusIconTitle) + '">' +
                '<i class="' + escapeHtml(data.statusIconClass) + '" aria-hidden="true"></i>' +
            '</span>';

        var unreadBadge = data.isUnread
            ? '<span class="topic-unread-badge" title="New replies"><i class="fa-regular fa-circle"></i></span>'
            : '';

        var starterHtml = '';
        if (data.starterName) {
            starterHtml = '<span class="topic-starter">by <a href="' + escapeHtml(data.starterUrl) + '">' + escapeHtml(data.starterName) + '</a></span>';
        }

        var lastPosterAvatarHtml = '';
        if (data.lastPosterMid && data.lastPosterName) {
            const user = userDataCache.get(data.lastPosterMid);
            lastPosterAvatarHtml = generateAvatarHtml(user, data.lastPosterName, data.lastPosterMid, CONFIG.AVATAR_SIZE_MINI);
        }
        var lastPosterHtml =
            '<span class="last-post-author">' + lastPosterAvatarHtml +
                '<a href="' + escapeHtml(data.lastPosterUrl) + '">' + escapeHtml(data.lastPosterName) + '</a></span>';

        return (
            '<article class="modern-card" data-topic-id="' + data.topicId + '" data-original-id="t' + data.topicId + '">' +
                imageHtml +
                '<div class="modern-info">' +
                    '<h3 class="modern-title">' +
                        statusIconHtml + unreadBadge +
                        '<a href="' + escapeHtml(data.topicUrl) + '">' + data.topicTitleHTML + '</a>' +
                    '</h3>' +
                    '<div class="modern-meta">' +
                        starterHtml +
                        '<span class="modern-stats">' +
                            '<span><i class="fa-regular fa-reply"></i> ' + formatNumber(data.replyCount) + ' replies</span>' +
                            '<span><i class="fa-regular fa-eye"></i> ' + formatNumber(data.viewCount) + ' views</span>' +
                        '</span>' +
                    '</div>' +
                    '<div class="modern-last-post">' +
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
    // LATEST POSTS EXTRACTION & GENERATION
    // =========================================================================
    function extractLatestPostData(topicDiv) {
        const avatarImg = topicDiv.querySelector('.thumbs img');
        const avatarSrc = avatarImg ? avatarImg.getAttribute('src') : null;

        const whoLink = topicDiv.querySelector('.who a');
        const authorName = whoLink ? whoLink.textContent.trim() : 'Unknown';
        const authorProfileUrl = whoLink ? whoLink.getAttribute('href') : '#';
        const authorMid = extractMidFromUrl(authorProfileUrl);

        const topicLink = topicDiv.querySelector('a[href*="#lastpost"]');
        const topicUrl = topicLink ? topicLink.getAttribute('href') : '#';

        const boldEl = topicLink ? topicLink.querySelector('b') : null;
        const replyIcon = boldEl ? boldEl.querySelector('i.reply') : null;
        const isReply = !!replyIcon;

        var topicTitleHTML = boldEl ? boldEl.innerHTML : (topicLink ? topicLink.textContent : 'Untitled');
        if (replyIcon) {
            topicTitleHTML = topicTitleHTML.replace(/<i class="reply"[^>]*>[^<]*<\/i>\s*/i, '');
        }

        const whenSpan = topicDiv.querySelector('.when');
        var dateStr = '';
        if (whenSpan) {
            const text = whenSpan.textContent || '';
            const match = text.match(/on:\s*(.+)/);
            dateStr = match ? match[1].trim() : text.trim();
        }
        const postDate = parseItalianDate(dateStr);
        const relativeTime = postDate ? getRelativeTimeString(postDate) : '';

        const isNew = topicDiv.classList.contains('new');

        return {
            avatarSrc,
            authorName, authorProfileUrl, authorMid,
            topicUrl, topicTitleHTML,
            relativeTime, isNew,
            isReply
        };
    }

    function generateLatestPostCard(data) {
        var avatarHtml = '';
        if (data.authorMid) {
            const user = userDataCache.get(data.authorMid);
            avatarHtml = generateAvatarHtml(user, data.authorName, data.authorMid, CONFIG.AVATAR_SIZE_SMALL);
        } else if (data.avatarSrc) {
            avatarHtml = '<img class="mini-avatar group-member" src="' + escapeHtml(data.avatarSrc) +
                '" alt="' + escapeHtml(data.authorName) + '" width="' + CONFIG.AVATAR_SIZE_SMALL +
                '" height="' + CONFIG.AVATAR_SIZE_SMALL + '" loading="lazy">';
        } else {
            avatarHtml = '<span class="mini-avatar mini-avatar--initial group-member" style="background-color:#059669;width:' +
                CONFIG.AVATAR_SIZE_SMALL + 'px;height:' + CONFIG.AVATAR_SIZE_SMALL + 'px;font-size:' + (CONFIG.AVATAR_SIZE_SMALL * 0.618) + 'px;line-height:' + CONFIG.AVATAR_SIZE_SMALL + 'px;">?</span>';
        }

        var titlePrefix = '';
        if (data.isReply) {
            titlePrefix = '<i class="fa-regular fa-reply latest-reply-icon" aria-hidden="true"></i> ';
        }

        var titleLink = '<a href="' + escapeHtml(data.topicUrl) + '">' + titlePrefix + data.topicTitleHTML + '</a>';

        return '<article class="latest-post-card' + (data.isNew ? ' is-new' : '') + '">' +
            '<div class="latest-post-avatar">' + avatarHtml + '</div>' +
            '<div class="latest-post-content">' +
                '<div class="latest-post-title">' + titleLink + '</div>' +
                '<div class="latest-post-meta">' +
                    '<a href="' + escapeHtml(data.authorProfileUrl) + '" class="latest-post-author">' + escapeHtml(data.authorName) + '</a>' +
                    '<span class="latest-post-time">' + escapeHtml(data.relativeTime) + '</span>' +
                '</div>' +
            '</div>' +
        '</article>';
    }

    // =========================================================================
    // STATS EXTRACTION & GENERATION
    // =========================================================================
    function extractOnlineUsers(statsContainer) {
        var topSection = statsContainer.querySelector('li.skin_tbl.top');
        if (!topSection) return { users: [], counts: { guests: 0, members: 0, anon: 0 } };

        // Counts
        var guestEl = topSection.querySelector('.online_guests b');
        var memberEl = topSection.querySelector('.online_members b');
        var anonEl = topSection.querySelector('.online_anon b');
        var counts = {
            guests: guestEl ? parseInt(guestEl.textContent, 10) || 0 : 0,
            members: memberEl ? parseInt(memberEl.textContent, 10) || 0 : 0,
            anon: anonEl ? parseInt(anonEl.textContent, 10) || 0 : 0
        };

        // Users list
        var userEls = topSection.querySelectorAll('ol.users li');
        var users = [];
        for (var i = 0; i < userEls.length; i++) {
            var li = userEls[i];
            var link = li.querySelector('a');
            if (!link) continue;
            var username = link.textContent.trim();
            var profileUrl = link.getAttribute('href');
            var mid = extractMidFromUrl(profileUrl);
            // Get group class from the link's classList, e.g. "amministratore founder male"
            var groupClass = '';
            var classList = link.className.split(/\s+/);
            // Map known legacy classes to our group classes
            if (classList.indexOf('amministratore') !== -1) groupClass = 'group-administrator';
            else if (classList.indexOf('founder') !== -1) groupClass = 'group-founder';
            else if (classList.indexOf('globalmod') !== -1 || classList.indexOf('gruppo1') !== -1) groupClass = 'group-global-moderator';
            else if (classList.indexOf('gamdev') !== -1 || classList.indexOf('gruppo2') !== -1) groupClass = 'group-game-dev';
            else if (classList.indexOf('fan') !== -1 || classList.indexOf('gruppo3') !== -1) groupClass = 'group-fan';
            else groupClass = 'group-member';

            users.push({
                username: username,
                profileUrl: profileUrl,
                mid: mid,
                groupClass: groupClass
            });
        }

        return { users: users, counts: counts };
    }

function extractForumStatistics(statsContainer) {
    var bottomSection = statsContainer.querySelector('li.skin_tbl.bottom');
    if (!bottomSection) return {};

    var html = bottomSection.innerHTML;
    var stats = {};

    // posts
    var postMatch = html.match(/<b>([\d,]+)<\/b>\s*<span>posts<\/span>/i);
    stats.posts = postMatch ? postMatch[1] : '0';

    // topics
    var topicMatch = html.match(/<b>([\d,]+)<\/b>\s*<span>topics<\/span>/i);
    stats.topics = topicMatch ? topicMatch[1] : '0';

    // members
    var memberMatch = html.match(/<b>([\d,]+)<\/b>\s*<span>members<\/span>/i);
    stats.members = memberMatch ? memberMatch[1] : '0';

    // total visits
    var totalVisitMatch = html.match(/<b>([\d,]+)<\/b>\s*<span>total visits<\/span>/i);
    stats.totalVisits = totalVisitMatch ? totalVisitMatch[1] : '0';

    // monthly visits
    var monthlyVisitMatch = html.match(/<b>([\d,]+)<\/b>\s*<span>monthly visits<\/span>/i);
    stats.monthlyVisits = monthlyVisitMatch ? monthlyVisitMatch[1] : '0';

    // top forum rank
    var topForumMatch = html.match(/<b>(\d+º)<\/b>\s*<span>in Top Forum<\/span>/i);
    stats.topForum = topForumMatch ? topForumMatch[1] : '';

    // newest member
    var newestMemberLink = bottomSection.querySelector('.lastreg dd a');
    if (newestMemberLink) {
        stats.newestMember = {
            name: newestMemberLink.textContent.trim(),
            url: newestMemberLink.getAttribute('href'),
            mid: extractMidFromUrl(newestMemberLink.getAttribute('href'))
        };
    }

    // Most users ever online – hidden span "users record" must be removed first
    var recordSpan = bottomSection.querySelector('.usersrecord');
    if (recordSpan) {
        var recordText = recordSpan.textContent || '';
        // Remove the hidden text that breaks the regex
        recordText = recordText.replace(/users record/i, '');
        var recordMatch = recordText.match(/Most users ever online was\s*(\d+)\s*on\s*(.*)/i);
        if (recordMatch) {
            stats.mostOnline = {
                count: recordMatch[1],
                date: recordMatch[2].trim()
            };
        }
    }

    return stats;
}
   
function buildModernStats(onlineData, statsData) {
    // Online users avatars
    var usersHtml = '';
    if (onlineData.users.length > 0) {
        var avatarItems = onlineData.users.map(function (u) {
            var avatarHtml;
            if (u.mid) {
                const user = userDataCache.get(u.mid);
                avatarHtml = generateAvatarHtml(user, u.username, u.mid, CONFIG.AVATAR_SIZE_ONLINE);
            } else {
                var initial = u.username.charAt(0).toUpperCase();
                avatarHtml = '<span class="mini-avatar mini-avatar--initial ' + u.groupClass + '" style="width:' + CONFIG.AVATAR_SIZE_ONLINE + 'px;height:' + CONFIG.AVATAR_SIZE_ONLINE + 'px;line-height:' + CONFIG.AVATAR_SIZE_ONLINE + 'px;">' + initial + '</span>';
            }
            return '<a href="' + escapeHtml(u.profileUrl) + '" class="online-user-avatar" title="' + escapeHtml(u.username) + '">' + avatarHtml + '</a>';
        }).join('');
        usersHtml = '<div class="online-users-avatars">' + avatarItems + '</div>';
    }

    var countsHtml = '<div class="online-counts">' +
        '<span><i class="fa-regular fa-user"></i> ' + onlineData.counts.members + ' members</span>' +
        '<span><i class="fa-regular fa-eye"></i> ' + onlineData.counts.guests + ' guests</span>' +
        (onlineData.counts.anon ? '<span><i class="fa-regular fa-user-secret"></i> ' + onlineData.counts.anon + ' anonymous</span>' : '') +
        '</div>';

    // Statistics grid
    var statsHtml = '<div class="stats-grid">';
    statsHtml += '<div class="stat-item"><i class="fa-regular fa-message"></i><span class="stat-value">' + statsData.posts + '</span><span class="stat-label">posts</span></div>';
    statsHtml += '<div class="stat-item"><i class="fa-regular fa-comments"></i><span class="stat-value">' + statsData.topics + '</span><span class="stat-label">topics</span></div>';
    statsHtml += '<div class="stat-item"><i class="fa-regular fa-users"></i><span class="stat-value">' + statsData.members + '</span><span class="stat-label">members</span></div>';
    statsHtml += '<div class="stat-item"><i class="fa-regular fa-eye"></i><span class="stat-value">' + statsData.totalVisits + '</span><span class="stat-label">total visits</span></div>';
    if (statsData.monthlyVisits) {
        statsHtml += '<div class="stat-item"><i class="fa-regular fa-calendar"></i><span class="stat-value">' + statsData.monthlyVisits + '</span><span class="stat-label">monthly visits</span></div>';
    }
    if (statsData.topForum) {
        statsHtml += '<div class="stat-item"><i class="fa-regular fa-trophy"></i><span class="stat-value">' + statsData.topForum + '</span><span class="stat-label">top forum</span></div>';
    }
    if (statsData.newestMember) {
        statsHtml += '<div class="stat-item"><i class="fa-regular fa-user-plus"></i><span class="stat-value"><a href="' + escapeHtml(statsData.newestMember.url) + '">' + escapeHtml(statsData.newestMember.name) + '</a></span><span class="stat-label">newest member</span></div>';
    }
    if (statsData.mostOnline) {
        statsHtml += '<div class="stat-item"><i class="fa-regular fa-chart-line"></i><span class="stat-value">' + statsData.mostOnline.count + '</span><span class="stat-label">most online (' + escapeHtml(statsData.mostOnline.date) + ')</span></div>';
    }
    statsHtml += '</div>';

    return '<section class="modern-stats">' +
        '<header class="stats-header"><h2 class="stats-title">Community Stats</h2></header>' +
        '<div class="stats-card">' +
            '<div class="stats-section online-section">' +
                '<h3 class="stats-section-title"><i class="fa-regular fa-bolt"></i> Who\'s Online</h3>' +
                usersHtml +
                countsHtml +
            '</div>' +
            '<div class="stats-section forum-stats-section">' +
                '<h3 class="stats-section-title"><i class="fa-regular fa-chart-simple"></i> Forum Statistics</h3>' +
                statsHtml +
            '</div>' +
        '</div>' +
    '</section>';
}

    // =========================================================================
    // DATA FETCHING
    // =========================================================================
    async function fetchAllRelevantUsers(boardRows, topicRows) {
        const mids = new Set();
        boardRows.forEach(function (row) {
            const whoLink = row.querySelector('.zz .who a');
            if (whoLink) {
                const mid = extractMidFromUrl(whoLink.getAttribute('href'));
                if (mid) mids.add(mid);
            }
        });
        topicRows.forEach(function (row) {
            const whoLink = row.querySelector('.zz .who a');
            if (whoLink) {
                const mid = extractMidFromUrl(whoLink.getAttribute('href'));
                if (mid) mids.add(mid);
            }
        });
        await Promise.all(Array.from(mids).map(function (mid) { return fetchUserData(mid); }));
    }

    async function fetchLatestPostAuthors(latestPostElements) {
        const mids = new Set();
        latestPostElements.forEach(function (div) {
            const whoLink = div.querySelector('.who a');
            if (whoLink) {
                const mid = extractMidFromUrl(whoLink.getAttribute('href'));
                if (mid) mids.add(mid);
            }
        });
        await Promise.all(Array.from(mids).map(function (mid) { return fetchUserData(mid); }));
    }

    async function fetchOnlineUsers(onlineUsers) {
        const mids = new Set();
        onlineUsers.forEach(function (u) {
            if (u.mid) mids.add(u.mid);
        });
        await Promise.all(Array.from(mids).map(function (mid) { return fetchUserData(mid); }));
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
                        '<button class="category-toggle-btn" aria-label="Toggle category" title="Collapse / expand" data-category-id="' + catData.categoryId + '">' +
                            '<i class="fa-regular fa-angle-down"></i>' +
                        '</button>' +
                    '</header>' +
                    '<div class="modern-cards-grid">';

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

        const forumTitleEl = forumWrapper.querySelector('.mtitle h1') || forumWrapper.querySelector('.mtitle h2');
        const forumTitle = forumTitleEl ? forumTitleEl.textContent.trim() : 'Forum';

        var html =
            '<section class="topic-list-section">' +
                '<header class="topic-list-header">' +
                    '<h2 class="topic-list-title">' + escapeHtml(forumTitle) + '</h2>' +
                '</header>' +
                '<div class="modern-cards-grid">';

        rows.forEach(function (row) {
            const data = extractTopicData(row);
            html += generateTopicCard(data);
        });

        html += '</div></section>';
        return html;
    }

    function buildLatestPostsList(latestDivs) {
        if (latestDivs.length === 0) return '';
        var html =
            '<section class="latest-posts-section">' +
                '<header class="latest-posts-header">' +
                    '<h2 class="latest-posts-title"><i class="fa-regular fa-clock"></i> Latest posts</h2>' +
                '</header>' +
                '<div class="latest-posts-grid">';

        latestDivs.forEach(function (div) {
            const data = extractLatestPostData(div);
            html += generateLatestPostCard(data);
        });

        html += '</div></section>';
        return html;
    }

    // =========================================================================
    // COLLAPSIBLE CATEGORY TOGGLE
    // =========================================================================
    function attachCategoryToggleEvents() {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.category-toggle-btn');
            if (!btn) return;
            const categoryId = btn.getAttribute('data-category-id');
            const section = document.querySelector('.board-category[data-category-id="' + categoryId + '"]');
            if (!section) return;
            section.classList.toggle('collapsed');
            const collapsed = section.classList.contains('collapsed');
            try {
                localStorage.setItem(CONFIG.COLLAPSE_STORAGE_PREFIX + categoryId, collapsed ? '1' : '0');
            } catch (ignore) {}
        });
    }

    function restoreCategoryStates() {
        document.querySelectorAll('.board-category').forEach(function (section) {
            const id = section.getAttribute('data-category-id');
            if (!id) return;
            try {
                if (localStorage.getItem(CONFIG.COLLAPSE_STORAGE_PREFIX + id) === '1') section.classList.add('collapsed');
            } catch (ignore) {}
        });
    }

    // =========================================================================
    // CONVERSION FUNCTIONS
    // =========================================================================
    async function convertBoards() {
        const container = getOrCreateContainer(CONFIG.BOARD_CONTAINER_ID);
        if (!container) return;

        const legacyList = document.querySelector(CONFIG.BOARD_LIST_SELECTOR);
        if (!legacyList) return;

        const categories = legacyList.querySelectorAll(CONFIG.CATEGORY_SELECTOR);
        if (categories.length === 0) return;

        const allForumRows = [];
        categories.forEach(function (cat) {
            const rows = cat.querySelectorAll(CONFIG.FORUM_ROW_SELECTOR);
            rows.forEach(function (row) { allForumRows.push(row); });
        });

        await fetchAllRelevantUsers(allForumRows, []);

        const modernHtml = buildModernBoardList(categories);
        container.innerHTML = modernHtml || '';

        attachCategoryToggleEvents();
        restoreCategoryStates();

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

        await fetchAllRelevantUsers([], Array.from(topicRows));

        const modernHtml = buildModernTopicList(forumWrapper);
        container.innerHTML = modernHtml || '';
        console.log('[BoardsModule] Topic list modernized');
    }

    async function convertLatestPosts() {
        const container = getOrCreateContainer(CONFIG.LATEST_POSTS_CONTAINER_ID);
        if (!container) return;

        const legacyLatest = document.querySelector(CONFIG.LATEST_POSTS_SELECTOR);
        if (!legacyLatest) return;

        const allTopicDivs = legacyLatest.querySelectorAll(CONFIG.LATEST_POST_ITEM_SELECTOR);
        if (allTopicDivs.length === 0) return;

        const limitedDivs = Array.from(allTopicDivs).slice(0, 12);

        await fetchLatestPostAuthors(limitedDivs);

        const modernHtml = buildLatestPostsList(limitedDivs);
        container.innerHTML = modernHtml || '';
        console.log('[BoardsModule] Latest posts modernized (12 shown)');
    }

    async function convertStats() {
        const container = getOrCreateContainer(CONFIG.STATS_CONTAINER_ID);
        if (!container) return;

        const legacyStats = document.querySelector(CONFIG.STATS_SELECTOR);
        if (!legacyStats) return;

        var onlineData = extractOnlineUsers(legacyStats);
        var statsData = extractForumStatistics(legacyStats);

        // Fetch avatars for online users
        await fetchOnlineUsers(onlineData.users);

        var modernHtml = buildModernStats(onlineData, statsData);
        container.innerHTML = modernHtml || '';
        console.log('[BoardsModule] Stats modernized');
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    async function initialize() {
        var hasLatest = !!document.querySelector(CONFIG.LATEST_POSTS_SELECTOR);
        var hasBoard = !!document.querySelector(CONFIG.BOARD_LIST_SELECTOR);
        var hasForum = !!document.querySelector(CONFIG.FORUM_WRAPPER_SELECTOR);
        var hasStats = !!document.querySelector(CONFIG.STATS_SELECTOR);

        if (hasLatest) await convertLatestPosts();
        if (hasBoard) await convertBoards();
        if (hasForum) await convertTopics();
        if (hasStats) await convertStats();

        reorderContainers();

        console.log('[BoardsModule] All lists modernized');
    }

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
