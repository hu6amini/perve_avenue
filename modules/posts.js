// Forum Modernizer - Posts Module v2.2 (full, with author extraction fix)
'use strict';

const ForumPostsModule = (function () {
    console.log('🔥 ForumPostsModule v2.2 loaded');

    // ===== USER TIMING: mark script start =====
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('posts-module-start');
    }
    // ==========================================

    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    const CONFIG = Object.freeze({
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container',
        REACTION_DELAY: 500,
        AVATAR_SIZE: 60,
        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 80
    });

    const AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    let convertedPostIds = new Set();
    let isInitialized = false;
    const postReactions = new Map();
    let activePopup = null;
    let conversionInProgress = false;
    let conversionPending = false;
    const userDataCache = new Map();
    let currentAbortController = null;

    // ============================================================================
    // BASIC HTML ESCAPE
    // ============================================================================
    const escapeHtml = (str) => {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    // ============================================================================
    // HTML SANITIZER
    // ============================================================================
    const sanitizeHTML = (dirty) => {
        if (!dirty || typeof dirty !== 'string') return '';
        const template = document.createElement('template');
        template.innerHTML = dirty;
        const doc = template.content;
        const walker = document.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT, null);
        const toRemove = [];
        let node;
        while ((node = walker.nextNode())) {
            if (node.tagName === 'SCRIPT' || node.tagName === 'IFRAME') {
                toRemove.push(node);
                continue;
            }
            const attrs = node.attributes;
            for (let i = attrs.length - 1; i >= 0; i--) {
                const attr = attrs[i];
                if (attr.name.startsWith('on') || (attr.name === 'href' && /^\s*javascript\s*:/i.test(attr.value))) {
                    node.removeAttribute(attr.name);
                }
            }
        }
        toRemove.forEach(el => el.remove());
        return template.innerHTML;
    };

    const setSanitizedHTML = (element, htmlString) => {
        element.innerHTML = sanitizeHTML(htmlString);
    };

    const createElementFromHTML = (htmlString) => {
        const div = document.createElement('div');
        setSanitizedHTML(div, htmlString);
        return div.firstElementChild;
    };

    // ============================================================================
    // PAGE VALIDATION
    // ============================================================================
    function isValidPage() {
        const bodyId = document.body.id;
        if (bodyId === 'topic' || bodyId === 'send' || bodyId === 'blog' || bodyId === 'msg') return true;
        if (bodyId === 'search') return document.querySelector('.topic.member_posts') !== null;
        return false;
    }

    // ============================================================================
    // RELATIVE TIME & DATE PARSING
    // ============================================================================
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

    // ============================================================================
    // API USER DATA FETCHING
    // ============================================================================
    async function fetchUserData(mid, signal) {
        if (userDataCache.has(mid)) return userDataCache.get(mid);
        try {
            const response = await fetch('/api.php?mid=' + mid, { signal });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const data = await response.json();
            const user = data['m' + mid] || data.info;
            if (user && user.id) {
                userDataCache.set(mid, user);
                return user;
            }
            return null;
        } catch (e) {
            if (e.name !== 'AbortError') console.error('[PostsModule] API error for MID', mid, e);
            return null;
        }
    }

    async function fetchMultipleUsers(midList) {
        const uniqueMids = [...new Set(midList.filter(Boolean))];
        if (uniqueMids.length === 0) return;
        currentAbortController?.abort();
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;
        try {
            await Promise.all(uniqueMids.map(mid => fetchUserData(mid, signal)));
        } catch (e) {}
    }

    // ============================================================================
    // AVATAR HANDLING
    // ============================================================================
    function isValidAvatarUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return false;
        if (trimmed === 'http' || trimmed === 'https' || trimmed === '//') return false;
        return true;
    }

    function getColorFromNickname(nickname, userId) {
        let hash = 0;
        const str = nickname || userId || 'user';
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        const colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
        return AVATAR_COLORS[colorIndex];
    }

    function optimizeImageUrl(url, width, height) {
        if (!isValidAvatarUrl(url)) return null;
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.indexOf('weserv.nl') !== -1 || lowerUrl.indexOf('data:') === 0) return url;
        const targetWidth = width || CONFIG.AVATAR_SIZE;
        const targetHeight = height || CONFIG.AVATAR_SIZE;
        const isGif = (lowerUrl.indexOf('.gif') !== -1 || /\.gif($|\?|#)/i.test(lowerUrl));
        const outputFormat = 'webp';
        const quality = CONFIG.QUALITY;
        const encodedUrl = encodeURIComponent(url);
        let optimizedUrl = CONFIG.WESERV_CDN + '?url=' + encodedUrl +
            '&output=' + outputFormat +
            '&maxage=' + CONFIG.CACHE +
            '&q=' + quality +
            '&w=' + targetWidth +
            '&h=' + targetHeight +
            '&fit=cover' +
            '&a=attention' +
            '&il';
        if (isGif) optimizedUrl += '&n=-1&lossless=true';
        return optimizedUrl;
    }

    function getUserAvatarData(user, username, userId) {
        function isDefaultAvatarUrl(url) {
            if (!url) return false;
            return url.includes('style_images/default_avatar.png');
        }
        if (user?.avatar && isValidAvatarUrl(user.avatar) && !isDefaultAvatarUrl(user.avatar)) {
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

    // ============================================================================
    // HELPERS
    // ============================================================================
    function getPostsContainer() {
        let wrapper = document.getElementById('modern-forum-wrapper');
        const carouselWrapper = document.querySelector('.carousel-wrapper');

        if (wrapper && carouselWrapper && !wrapper.contains(carouselWrapper)) {
            if (wrapper.compareDocumentPosition(carouselWrapper) & Node.DOCUMENT_POSITION_FOLLOWING) {
                carouselWrapper.parentNode.insertBefore(wrapper, carouselWrapper.nextSibling);
            }
        } else if (!wrapper && carouselWrapper) {
            wrapper = document.createElement('div');
            wrapper.id = 'modern-forum-wrapper';
            wrapper.className = 'modern-forum-wrapper';
            carouselWrapper.parentNode.insertBefore(wrapper, carouselWrapper.nextSibling);
        } else if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = 'modern-forum-wrapper';
            wrapper.className = 'modern-forum-wrapper';
            document.body.appendChild(wrapper);
        }

        let container = document.getElementById('modern-posts-container');
        if (container) return container;

        const originalContainer = document.getElementById(CONFIG.CONTAINER_ID);
        if (originalContainer) return originalContainer;

        container = document.createElement('div');
        container.id = CONFIG.CONTAINER_ID;
        container.className = 'modern-posts-container';
        wrapper.appendChild(container);
        return container;
    }

    function isValidPost(postEl) {
        if (!postEl) return false;
        const id = postEl.getAttribute('id');
        if (id && id.startsWith(CONFIG.POST_ID_PREFIX)) return true;
        if (document.body.id === 'msg') return getMsidFromPost(postEl) !== null;
        return false;
    }

    function getPostId($post) {
        const fullId = $post.getAttribute('id');
        if (fullId && fullId.startsWith(CONFIG.POST_ID_PREFIX)) return fullId.replace(CONFIG.POST_ID_PREFIX, '');
        if (document.body.id === 'msg') return getMsidFromPost($post);
        return null;
    }

    function getMsidFromPost($post) {
        const deleteLink = $post.querySelector('a[onclick*="CODE=05"]');
        if (deleteLink) {
            const match = deleteLink.getAttribute('onclick').match(/MSID=(\d+)/);
            if (match) return match[1];
        }
        const replyLink = $post.querySelector('a[href*="CODE=04"]');
        if (replyLink) {
            const match = replyLink.href.match(/MSID=(\d+)/);
            if (match) return match[1];
        }
        return null;
    }

    function getMidFromPost($post) {
        const nickLink = $post.querySelector('.nick a');
        if (nickLink) {
            const match = nickLink.href.match(/MID=(\d+)/);
            if (match) return match[1];
        }
        const avatarLink = $post.querySelector('.avatar a');
        if (avatarLink) {
            const match = avatarLink.href.match(/MID=(\d+)/);
            if (match) return match[1];
        }
        return null;
    }

    // ============================================================================
    // DATA EXTRACTION (topics)
    // ============================================================================
    function getUsername($post) {
        const nickLink = $post.querySelector('.nick a');
        return nickLink ? nickLink.textContent.trim() : 'Unknown';
    }

    function getGroupText($post) {
        const groupDd = $post.querySelector('.u_group dd');
        return groupDd ? groupDd.textContent.trim() : '';
    }

    function getPostCount($post) {
        const postsLink = $post.querySelector('.u_posts dd a');
        return postsLink ? postsLink.textContent.trim() : '0';
    }

    function getReputation($post) {
        const repLink = $post.querySelector('.u_reputation dd a');
        if (!repLink) return '0';
        return repLink.textContent.trim().replace('+', '');
    }

    function getIsOnline($post) {
        const statusTitle = $post.querySelector('.u_status');
        if (!statusTitle) return false;
        const title = statusTitle.getAttribute('title') || '';
        return title.toLowerCase().includes('online');
    }

    function getUserTitleAndIcon($post) {
        const uRankSpan = $post.querySelector('.u_rank');
        if (!uRankSpan) return { title: 'Member', iconClass: 'fa-medal fa-regular' };
        const icon = uRankSpan.querySelector('i');
        let iconClass = '';
        if (icon) {
            let classAttr = icon.getAttribute('class') || '';
            if (classAttr.includes('fa-solid')) classAttr = classAttr.replace('fa-solid', 'fa-regular');
            iconClass = classAttr;
        } else {
            iconClass = 'fa-medal fa-regular';
        }
        const rankSpan = uRankSpan.querySelector('span');
        let title = rankSpan ? rankSpan.textContent.trim() : uRankSpan.textContent.trim();
        if (title === 'Member') {
            const stars = $post.querySelectorAll('.u_rank i.fa-star').length;
            if (stars === 3) title = 'Famous';
            else if (stars === 2) title = 'Senior';
            else if (stars === 1) title = 'Junior';
        }
        return { title: title || 'Member', iconClass: iconClass };
    }

    function getCleanContent($post) {
        let contentTable = $post.querySelector('.right.Item table.color');
        if (!contentTable) contentTable = $post.querySelector('td.Item table.color');
        if (!contentTable) return '';
        const contentClone = contentTable.cloneNode(true);
        const editSpans = contentClone.querySelectorAll('.edit');
        editSpans.forEach(edit => {
            let prev = edit.previousSibling;
            while (prev && prev.nodeType === Node.ELEMENT_NODE && prev.tagName === 'BR') {
                const toRemove = prev;
                prev = prev.previousSibling;
                toRemove.remove();
            }
        });
        contentClone.querySelectorAll('.signature, .edit').forEach(el => el.remove());
        contentClone.querySelectorAll('.bottomborder').forEach(el => el.remove());
        contentClone.querySelectorAll('br').forEach(br => {
            const prev = br.previousElementSibling;
            const next = br.nextElementSibling;
            if ((next?.classList?.contains('bottomborder')) || (prev?.classList?.contains('bottomborder'))) br.remove();
        });
        let html = contentClone.innerHTML || '';
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.trim();
        html = transformEmbeddedLinks(html);
        html = transformLegacyQuotesAndSpoilers(html);
        return html;
    }

    function getSignatureHtml($post) {
        const signature = $post.querySelector('.signature');
        return signature ? signature.innerHTML : '';
    }

    function getEditInfo($post) {
        const editSpan = $post.querySelector('.edit');
        if (!editSpan) return null;
        const fullText = editSpan.textContent.trim();
        const parts = fullText.split(' - ');
        if (parts.length < 2) return null;
        const editorPart = parts.slice(0, -1).join(' - ');
        const dateStr = parts[parts.length - 1].trim();
        const date = parseDateFromTitle(dateStr);
        if (!date || isNaN(date.getTime())) return null;
        return { editor: editorPart, relative: getRelativeTimeString(date), rawDate: date };
    }

    function getLikes($post) {
        const pointsPos = $post.querySelector('.points .points_pos');
        return pointsPos ? parseInt(pointsPos.textContent) || 0 : 0;
    }

    function getReactionData($post) {
        let hasReactions = false, reactionCount = 0, reactions = [];
        const allContainers = $post.querySelectorAll('.st-emoji-container');
        allContainers.forEach(container => {
            const counters = container.querySelectorAll('.st-emoji-counter');
            counters.forEach(counter => {
                const count = parseInt(counter.getAttribute('data-count') || counter.textContent || 0);
                if (count > 0) { hasReactions = true; reactionCount += count; }
            });
        });
        let widgetContainer = null;
        const widget = $post.querySelector('.st-emoji-widget');
        if (widget) widgetContainer = widget.querySelector('.st-emoji-container');
        if (widgetContainer) {
            const items = widgetContainer.querySelectorAll('.st-emoji-info');
            items.forEach(item => {
                const counterEl = item.querySelector('.st-emoji-counter');
                if (!counterEl) return;
                const count = parseInt(counterEl.getAttribute('data-count') || counterEl.textContent || 0);
                if (count <= 0) return;
                const contentEl = item.querySelector('.st-emoji-content');
                if (!contentEl) return;
                const img = contentEl.querySelector('img');
                if (!img) return;
                const src = img.getAttribute('src') || '';
                const alt = img.getAttribute('alt') || '';
                if (src) reactions.push({ name: alt.replace(/:/g, ''), alt, src, rid: contentEl.getAttribute('data-rid'), count });
            });
        } else {
            const previewContainer = $post.querySelector('.st-emoji-container');
            if (previewContainer) {
                const previewDiv = previewContainer.querySelector('.st-emoji-preview');
                if (previewDiv) {
                    const images = previewDiv.querySelectorAll('img');
                    images.forEach(img => {
                        const src = img.getAttribute('src') || '';
                        const alt = img.getAttribute('alt') || '';
                        if (src) reactions.push({ name: alt.replace(/:/g, ''), alt, src, count: reactionCount });
                    });
                }
            }
        }
        return { hasReactions, reactionCount, reactions };
    }

    function getMaskedIp($post) {
        const ipLink = $post.querySelector('.ip_address dd a');
        if (!ipLink) return '';
        const ip = ipLink.textContent.trim();
        const parts = ip.split('.');
        if (parts.length === 4) return parts[0] + '.' + parts[1] + '.' + parts[2] + '.xxx';
        return ip;
    }

    function getAvailableActions($post, postId) {
        const actions = { quote: false, edit: false, delete: false, report: true, share: true };
        if ($post.querySelector('a[href*="CODE=02"]')) actions.quote = true;
        if ($post.querySelector('a[href*="CODE=08"]')) actions.edit = true;
        if ($post.querySelector('a[onclick*="delete_post"], a[href*="delete_post"], .deletepost, a[href*="CODE=09"]')) actions.delete = true;
        return actions;
    }

    function getMemberPostLinks($post) {
        const rtSub = $post.querySelector('.rt.Sub');
        if (!rtSub) return { topicLink: null, topicTitle: null, forumLink: null, forumName: null };
        const links = rtSub.querySelectorAll('a');
        let topicLink = null, forumLink = null, topicTitle = '', forumName = '';
        if (links.length >= 1) { topicLink = links[0].getAttribute('href'); topicTitle = links[0].textContent.trim(); }
        if (links.length >= 2) { forumLink = links[1].getAttribute('href'); forumName = links[1].textContent.trim(); }
        return { topicLink, topicTitle, forumLink, forumName };
    }

    // ============================================================================
    // MESSAGE DATA EXTRACTION
    // ============================================================================
    function getMessageUsername($post) {
        const nickLink = $post.querySelector('.nick a');
        return nickLink ? nickLink.textContent.trim() : 'Unknown';
    }
    function getMessageGroup($post) {
        const groupDd = $post.querySelector('.u_group dd');
        return groupDd ? groupDd.textContent.trim() : 'Member';
    }
    function getMessagePostCount($post) {
        const dd = $post.querySelector('.u_posts dd');
        if (!dd) return '0';
        const text = dd.textContent.trim();
        return text.replace(/[^0-9]/g, '') || '0';
    }
    function getMessageJoinDate($post) {
        const dd = $post.querySelector('.u_joined dd');
        return dd ? dd.textContent.trim() : 'Unknown';
    }
    function getMessageContent($post) {
        const contentTable = $post.querySelector('td.right.Item table.color');
        if (!contentTable) return '';
        const clone = contentTable.cloneNode(true);
        const allBolds = clone.querySelectorAll('b');
        for (const bold of allBolds) {
            if (bold.textContent.includes('Original message sent on')) {
                bold.remove();
                const nextBr = bold.nextElementSibling;
                if (nextBr && nextBr.tagName === 'BR') nextBr.remove();
                break;
            }
        }
        let html = clone.innerHTML || '';
        html = html.trim();
        html = transformEmbeddedLinks(html);
        html = transformLegacyQuotesAndSpoilers(html);
        return html;
    }
    function getMessagePostDate($post) {
        const whenSpan = $post.querySelector('.when');
        if (!whenSpan) return null;
        let dateText = whenSpan.textContent.trim();
        dateText = dateText.replace(/^Sent\s+on\s*/i, '');
        return parseDateFromTitle(dateText);
    }

    // ============================================================================
    // BLOG DATA EXTRACTION
    // ============================================================================
    function getBlogArticleData(articleLi) {
        const postId = getPostId(articleLi);
        let mid = null;
        const userLink = articleLi.querySelector('.who a[href*="MID="]');
        if (userLink) {
            const match = userLink.href.match(/MID=(\d+)/);
            if (match) mid = match[1];
        }
        const username = userLink ? userLink.textContent.trim() : 'Unknown';
        const titleLink = articleLi.querySelector('.btitle a');
        const title = titleLink ? titleLink.textContent.trim() : '';
        const permalink = titleLink ? titleLink.getAttribute('href') : '';
        const whenSpan = articleLi.querySelector('.when');
        const rawDate = whenSpan ? whenSpan.getAttribute('title') : null;
        const postDate = parseDateFromTitle(rawDate);
        const absoluteDate = postDate ? postDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
        const editInfo = getEditInfo(articleLi);
        const contentDiv = articleLi.querySelector('.center .color');
        let contentHtml = '';
        if (contentDiv) {
            const clone = contentDiv.cloneNode(true);
            const reactionWidget = clone.querySelector('.st-emoji-widget');
            if (reactionWidget) {
                let prev = reactionWidget.previousSibling;
                while (prev && prev.nodeType === Node.ELEMENT_NODE && prev.tagName === 'BR') {
                    const toRemove = prev;
                    prev = prev.previousSibling;
                    toRemove.remove();
                }
                reactionWidget.remove();
            }
            const editSpan = clone.querySelector('.edit');
            if (editSpan) {
                let prev = editSpan.previousSibling;
                while (prev && prev.nodeType === Node.ELEMENT_NODE && prev.tagName === 'BR') {
                    const toRemove = prev;
                    prev = prev.previousSibling;
                    toRemove.remove();
                }
                editSpan.remove();
            }
            while (clone.lastChild && clone.lastChild.nodeType === Node.ELEMENT_NODE && clone.lastChild.tagName === 'BR') clone.removeChild(clone.lastChild);
            contentHtml = clone.innerHTML.trim();
            contentHtml = transformEmbeddedLinks(contentHtml);
            contentHtml = transformLegacyQuotesAndSpoilers(contentHtml);
        }
        const pointsPos = articleLi.querySelector('.points_pos');
        const likes = pointsPos ? parseInt(pointsPos.textContent.replace(/[^0-9]/g, '')) || 0 : 0;
        const reactionData = getReactionData(articleLi);
        const commentsEm = articleLi.querySelector('.replies em');
        const commentsCount = commentsEm ? parseInt(commentsEm.textContent) || 0 : 0;
        const viewsEm = articleLi.querySelector('.views em');
        const viewsCount = viewsEm ? parseInt(viewsEm.textContent) || 0 : 0;
        const availableActions = getAvailableActions(articleLi, postId);
        return {
            postId, mid, username, title, permalink, postDate, absoluteDate,
            contentHtml, editInfo, likes,
            hasReactions: reactionData.hasReactions,
            reactionCount: reactionData.reactionCount,
            reactions: reactionData.reactions,
            commentsCount, viewsCount, availableActions,
            originalPost: articleLi
        };
    }

    // ============================================================================
    // GENERATE MODERN BLOG CARD
    // ============================================================================
    function generateBlogPost(data, apiUser) {
        const user = apiUser || {};
        const username = data.username;
        const userId = data.mid;
        const isOnline = (user.status === 'online');
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'Online' : 'Offline';
        const profileUrl = userId ? '/?act=Profile&MID=' + userId : '#';
        const avatarData = getUserAvatarData(user, username, userId);
        let avatarHtml = '';
        if (avatarData.type === 'img') {
            avatarHtml = '<div class="post-avatar-wrapper"><a href="' + escapeHtml(profileUrl) + '" class="avatar-link" aria-label="Profile of ' + escapeHtml(username) + '"><img class="avatar-circle" src="' + escapeHtml(avatarData.url) + '" alt="Avatar of ' + escapeHtml(username) + '" width="' + CONFIG.AVATAR_SIZE + '" height="' + CONFIG.AVATAR_SIZE + '" loading="lazy"></a><span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span></div>';
        } else {
            avatarHtml = '<div class="post-avatar-wrapper"><a href="' + escapeHtml(profileUrl) + '" class="avatar-link" aria-label="Profile of ' + escapeHtml(username) + '"><div class="initial-avatar" style="background-color: #' + avatarData.bgColor + ';" data-initial="' + escapeHtml(avatarData.initial) + '">' + escapeHtml(avatarData.initial) + '</div></a><span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span></div>';
        }

        let groupName = user?.group?.name || 'Member';
        let roleClass = 'role-badge';
        const isFounder = user?.group && ((user.group.class?.includes('founder')) || (user.group.bodyclass?.includes('founder')));
        if (isFounder) { roleClass += ' founder'; groupName = 'Founder'; }
        else if (groupName.toLowerCase() === 'administrator') roleClass += ' admin';
        else if (groupName.toLowerCase() === 'moderator') roleClass += ' moderator';
        else if (groupName.toLowerCase() === 'developer') roleClass += ' developer';
        else roleClass += ' member';
        const groupCssClass = 'group-' + sanitizeGroupName(groupName);

        const postCount = (user.messages !== undefined) ? user.messages : 0;
        const reputation = (user.reputation !== undefined) ? user.reputation : 0;
        let joinDateFormatted = 'Unknown join date';
        if (user.registration) {
            const joinDate = new Date(user.registration);
            joinDateFormatted = joinDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        let editHtml = '';
        if (data.editInfo?.relative) {
            const editDate = data.editInfo.rawDate;
            const isoEdit = editDate ? editDate.toISOString() : '';
            const titleEdit = editDate ? editDate.toLocaleString() : '';
            editHtml = '<div class="post-edit-info"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edited <time datetime="' + isoEdit + '" title="' + escapeHtml(titleEdit) + '">' + escapeHtml(data.editInfo.relative) + '</time></div>';
        }

        let likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '"><i class="fa-regular fa-thumbs-up like-icon" aria-hidden="true"></i>';
        if (data.likes > 0) likeButton += '<span class="like-count like-count-display">' + data.likes + '</span>';
        likeButton += '</button>';
        const reactionsHtml = generateReactionButtons({ postId: data.postId, hasReactions: data.hasReactions, reactionCount: data.reactionCount, reactions: data.reactions });

        let actionsHtml = '';
        if (data.availableActions.quote) actionsHtml += '<button class="action-icon" title="Quote" aria-label="Quote this post" data-action="quote" data-pid="' + data.postId + '"><i class="fa-regular fa-quote-left"></i></button>';
        if (data.availableActions.edit) actionsHtml += '<button class="action-icon" title="Edit" aria-label="Edit this post" data-action="edit" data-pid="' + data.postId + '"><i class="fa-regular fa-pen-to-square"></i></button>';
        if (data.availableActions.share) actionsHtml += '<button class="action-icon" title="Share" aria-label="Share this post" data-action="share" data-pid="' + data.postId + '"><i class="fa-regular fa-share-nodes"></i></button>';
        if (data.availableActions.delete) actionsHtml += '<button class="action-icon delete-action" title="Delete" aria-label="Delete this post" data-action="delete" data-pid="' + data.postId + '"><i class="fa-regular fa-trash-can"></i></button>';

        return '<article class="post-card post-card--blog ' + groupCssClass + '" data-original-id="' + CONFIG.POST_ID_PREFIX + data.postId + '" data-post-id="' + data.postId + '">' +
            '<header class="blog-card-header"><h1 class="blog-title"><a href="' + escapeHtml(data.permalink) + '">' + escapeHtml(data.title) + '</a></h1><div class="blog-meta"><span class="blog-date">' + data.absoluteDate + '</span>' + (actionsHtml ? '<div class="blog-actions top-actions">' + actionsHtml + '</div>' : '') + '</div></header>' +
            '<div class="post-card-body"><div class="avatar-modern">' + avatarHtml + '</div>' +
            '<div class="post-user-info"><div class="user-name"><a href="' + profileUrl + '" class="user-profile-link">' + escapeHtml(username) + '</a></div>' +
            '<div class="user-group"><span class="' + roleClass + '">' + escapeHtml(groupName) + '</span></div>' +
            '<div class="user-stats"><div class="user-rank"><i class="fa-regular fa-medal"></i> ' + escapeHtml(data.userTitle || 'Member') + '</div>' +
            '<div class="user-posts"><i class="fa-regular fa-message"></i> ' + formatNumber(postCount) + ' posts</div>' +
            '<div class="user-reputation"><i class="fa-regular fa-thumbs-up"></i> ' + formatNumber(reputation) + ' rep</div>' +
            '<div class="user-joined"><i class="fa-regular fa-user-plus"></i> ' + joinDateFormatted + '</div></div>' +
            '</div></div>' +
            '<div class="post-content"><div class="post-message">' + data.contentHtml + editHtml + '</div></div>' +
            '<footer class="post-footer"><div class="post-reactions">' + likeButton + reactionsHtml + '</div></footer></article>';
    }

    // ============================================================================
    // EMBEDDED LINK TRANSFORMATION
    // ============================================================================
    function transformEmbeddedLinks(htmlContent) {
        if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        const embedContainers = tempDiv.querySelectorAll('.ffb_embedlink');
        for (const container of embedContainers) {
            const modernEmbed = convertToModernEmbed(container);
            if (modernEmbed) container.parentNode.replaceChild(modernEmbed, container);
        }
        return tempDiv.innerHTML;
    }

    function convertToModernEmbed(originalContainer) {
        try {
            const hiddenDiv = originalContainer.querySelector('div[style="display:none"]');
            let faviconUrl = null;
            if (hiddenDiv) {
                const favImg = hiddenDiv.querySelector('img');
                if (favImg) faviconUrl = favImg.getAttribute('src');
            }
            const visiblePart = originalContainer.children[1];
            if (!visiblePart) return null;
            const contentDiv = visiblePart.children[1] || visiblePart.children[0];
            if (!contentDiv) return null;
            const previewDiv = visiblePart.children[0];
            let imageUrl = null;
            if (previewDiv) {
                const previewImg = previewDiv.querySelector('img');
                if (previewImg) imageUrl = previewImg.getAttribute('src');
            }
            const titleLink = contentDiv.querySelector('a');
            const title = titleLink ? titleLink.textContent.trim() : '';
            const mainUrl = titleLink ? titleLink.getAttribute('href') : '';
            const clone = contentDiv.cloneNode(true);
            clone.querySelectorAll('a').forEach(a => a.remove());
            let rawDescription = clone.textContent.trim()
                .replace(/\s*Leggi altro su\s*/gi, '')
                .replace(/\s*[>›]\s*$/, '')
                .trim();
            const allLinksInContent = contentDiv.querySelectorAll('a');
            const domainLink = allLinksInContent.length >= 2 ? allLinksInContent[allLinksInContent.length - 1] : null;
            let domainText = '';
            if (domainLink) {
                domainText = domainLink.textContent.trim();
                if (!domainText) domainText = extractDomain(domainLink.getAttribute('href') || '');
            } else {
                domainText = extractDomain(mainUrl);
            }
            if (!faviconUrl) {
                const fallbackDomain = domainLink ? extractDomain(domainLink.getAttribute('href') || '') : extractDomain(mainUrl);
                if (fallbackDomain) faviconUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(fallbackDomain) + '&sz=32';
            }
            const siteName = domainText.replace(/^www\./i, '').split('.')[0];
            let modernHtml = '<div class="modern-embedded-link"><a href="' + escapeHtml(mainUrl) + '" class="embedded-link-container" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(title) + '">';
            if (imageUrl) modernHtml += '<div class="embedded-link-image"><img src="' + imageUrl + '" alt="' + escapeHtml(title) + '" loading="lazy" decoding="async" style="max-width:100%;object-fit:cover;display:block;"></div>';
            modernHtml += '<div class="embedded-link-content"><h3 class="embedded-link-title">' + escapeHtml(title) + '</h3>';
            if (rawDescription) modernHtml += '<p class="embedded-link-description">' + escapeHtml(rawDescription) + '</p>';
            modernHtml += '<div class="embedded-link-meta"><span class="embedded-link-read-more" style="background-image:url(' + faviconUrl + ');background-repeat:no-repeat;background-position:left center;background-size:16px 16px;padding-left:22px;display:inline;">' + escapeHtml(siteName) + '</span></div>';
            modernHtml += '</div></a></div>';
            return createElementFromHTML(modernHtml);
        } catch (e) { return null; }
    }

    function extractDomain(url) {
        try {
            const a = document.createElement('a');
            a.href = url;
            let hostname = a.hostname;
            if (hostname.startsWith('www.')) hostname = hostname.substring(4);
            return hostname;
        } catch (e) { return url.split('/')[2] || url; }
    }

    // ============================================================================
    // LEGACY QUOTE & SPOILER CONVERSION (FIXED AUTHOR EXTRACTION)
    // ============================================================================
    function transformLegacyQuotesAndSpoilers(htmlContent) {
        if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        const quoteWrappers = tempDiv.querySelectorAll('div[align="center"]:has(> .quote_top)');
        quoteWrappers.forEach(wrapper => {
            const quoteTop = wrapper.querySelector('.quote_top');
            const quoteBody = wrapper.querySelector('.quote');
            if (!quoteTop || !quoteBody) return;
            const modernQuote = convertLegacyQuote(quoteTop, quoteBody);
            if (modernQuote) wrapper.parentNode.replaceChild(modernQuote, wrapper);
        });
        const spoilerDivs = tempDiv.querySelectorAll('div.spoiler[align="center"]');
        spoilerDivs.forEach(spoiler => {
            const codeTop = spoiler.querySelector('.code_top');
            const codeBody = spoiler.querySelector('.code');
            if (!codeTop || !codeBody) return;
            const modernSpoiler = convertLegacySpoiler(codeTop, codeBody);
            if (modernSpoiler) spoiler.parentNode.replaceChild(modernSpoiler, spoiler);
        });
        return tempDiv.innerHTML;
    }

    function convertLegacyQuote(quoteTopElem, quoteBodyElem) {
        try {
            // Get the full text content of the quote_top div (includes everything)
            const fullText = quoteTopElem.textContent || '';
            let author = 'Unknown';
            
            // Try to extract from pattern: (-Username @ ...)
            const match = fullText.match(/\(([^@]+?)@/);
            if (match && match[1]) {
                author = match[1].trim();
            } else {
                // Fallback: QUOTE (Username ...)
                const fallbackMatch = fullText.match(/QUOTE\s*\(([^)]+)/i);
                if (fallbackMatch && fallbackMatch[1]) {
                    author = fallbackMatch[1].trim();
                } else {
                    // Last resort: take everything before the first ' @' or ' said:'
                    const simpleMatch = fullText.match(/^[^(]*\(?([^@(]+?)(?:\s+@|\s+said:|$)/i);
                    if (simpleMatch && simpleMatch[1]) {
                        author = simpleMatch[1].trim();
                    }
                }
            }
            // Clean up any leftover "QUOTE" prefix
            author = author.replace(/^QUOTE\s*/i, '').trim();
            if (author === '') author = 'Unknown';

            const jumpLink = quoteTopElem.querySelector('a');
            const targetUrl = jumpLink ? jumpLink.getAttribute('href') : '';
            let anchorId = '';
            if (targetUrl) {
                const match = targetUrl.match(/#entry(\d+)/);
                if (match) anchorId = match[1];
            }
            const contentClone = quoteBodyElem.cloneNode(true);
            contentClone.querySelectorAll('div[align="center"], .quote_top, .quote').forEach(el => el.remove());
            const innerHtml = contentClone.innerHTML;
            let quoteHtml = `<div class="modern-quote long-quote">
                <div class="quote-header">
                    <div class="quote-meta">
                        <div class="quote-icon"><i class="fa-regular fa-quote-left"></i></div>
                        <div class="quote-info">
                            <span class="quote-author">${escapeHtml(author)} <span class="quote-said">said:</span></span>
                        </div>
                    </div>`;
            if (targetUrl && anchorId) {
                quoteHtml += `<button class="quote-jump-btn" data-anchor-id="${anchorId}" data-is-cross-page="false" data-target-url="${escapeHtml(targetUrl)}" title="Jump to quoted post" aria-label="Jump to quoted post" type="button"><i class="fa-regular fa-chevron-up"></i></button>`;
            }
            quoteHtml += `</div><div class="quote-content">${innerHtml}</div>`;
            quoteHtml += `<button class="quote-expand-btn" type="button" aria-label="Show full quote"><i class="fa-regular fa-chevron-down"></i> Show more</button>`;
            quoteHtml += `</div>`;
            return createElementFromHTML(quoteHtml);
        } catch (e) { return null; }
    }

    function convertLegacySpoiler(codeTopElem, codeBodyElem) {
        try {
            const title = codeTopElem.querySelector('b')?.textContent || 'SPOILER';
            const contentClone = codeBodyElem.cloneNode(true);
            contentClone.querySelectorAll('.code_top, .code').forEach(el => el.remove());
            const innerHtml = contentClone.innerHTML;
            const spoilerId = 'spoiler-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
            const spoilerHtml = `<div class="modern-spoiler">
                <div class="spoiler-header" role="button" tabindex="0">
                    <div class="spoiler-icon"><i class="fa-regular fa-eye-slash"></i></div>
                    <div class="spoiler-info"><span class="spoiler-title">${escapeHtml(title)}</span></div>
                    <button class="spoiler-toggle" type="button" aria-expanded="false" aria-controls="${spoilerId}">
                        <i class="fa-regular fa-chevron-down"></i>
                    </button>
                </div>
                <div id="${spoilerId}" class="spoiler-content" hidden>${innerHtml}</div>
            </div>`;
            return createElementFromHTML(spoilerHtml);
        } catch (e) { return null; }
    }

    // ============================================================================
    // POST-PROCESSING: remove expand button if content fits (image-aware)
    // ============================================================================
function initQuotesAndSpoilers() {
    // Process each quote that has the "long-quote" class
    const quotes = document.querySelectorAll('.modern-quote.long-quote');
    
    const checkQuote = (quote) => {
        const content = quote.querySelector('.quote-content');
        const expandBtn = quote.querySelector('.quote-expand-btn');
        if (!content || !expandBtn) return;
        
        const maxHeight = parseFloat(getComputedStyle(content).maxHeight);
        if (isNaN(maxHeight)) return;
        
        // If the full content height is less than or equal to the max height,
        // we don't need the expand button.
        if (content.scrollHeight <= maxHeight + 2) {
            expandBtn.remove();
            quote.classList.remove('long-quote');
        } else {
            // Ensure button shows "Show more" and quote is collapsed
            expandBtn.innerHTML = '<i class="fa-regular fa-chevron-down"></i> Show more';
            quote.classList.remove('expanded');
        }
    };
    
    quotes.forEach(quote => {
        const content = quote.querySelector('.quote-content');
        if (!content) return;
        
        const images = content.querySelectorAll('img');
        
        // No images – check immediately
        if (images.length === 0) {
            checkQuote(quote);
            return;
        }
        
        // Has images – wait for all to load (handles lazy loading)
        let pending = images.length;
        const onLoadOrError = () => {
            pending--;
            if (pending === 0) {
                // After images are ready, allow layout to settle
                requestAnimationFrame(() => checkQuote(quote));
            }
        };
        images.forEach(img => {
            if (img.complete) {
                onLoadOrError();
            } else {
                img.addEventListener('load', onLoadOrError);
                img.addEventListener('error', onLoadOrError);
            }
        });
    });
    
    // Initialize spoilers (hidden by default)
    document.querySelectorAll('.modern-spoiler .spoiler-content').forEach(content => {
        if (!content.hasAttribute('hidden')) content.setAttribute('hidden', '');
    });
}
    
    // ============================================================================
    // REACTION POPUP (unchanged from v2.1 – include full implementation)
    // ============================================================================
    function getAvailableReactions(postId) {
        const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return Promise.resolve([]);
        const emojiContainer = originalPost.querySelector('.st-emoji-container');
        if (!emojiContainer) return Promise.resolve([]);
        const previewTrigger = emojiContainer.querySelector('.st-emoji-preview');
        if (!previewTrigger) return Promise.resolve([]);
        previewTrigger.style.display = 'block';
        previewTrigger.click();
        previewTrigger.style.display = '';
        return new Promise(resolve => {
            setTimeout(() => {
                const originalPopup = document.querySelector('.st-emoji-pop');
                const emojis = [];
                if (originalPopup) {
                    originalPopup.querySelectorAll('.st-emoji-content').forEach(el => {
                        const dataFui = el.getAttribute('data-fui');
                        const img = el.querySelector('img');
                        const imgSrc = img ? img.getAttribute('src') : '';
                        const imgAlt = img ? img.getAttribute('alt') : '';
                        let name = dataFui ? dataFui.replace(/:/g, '') : '';
                        if (!name && imgAlt) name = imgAlt.replace(/:/g, '');
                        emojis.push({ name, alt: dataFui || imgAlt, src: imgSrc, rid: el.getAttribute('data-rid') });
                    });
                }
                if (originalPopup) originalPopup.remove();
                resolve(emojis);
            }, 150);
        });
    }

    function getDefaultEmojis() {
        return [
            { name: 'kekw', alt: ':kekw:', src: '', rid: '10' },
            { name: 'rofl', alt: ':rofl:', src: '', rid: '1' }
        ];
    }

    function createCustomReactionPopup(buttonElement, postId) {
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
            document.removeEventListener('click', activePopupClickHandler);
        }
        const buttonRect = buttonElement.getBoundingClientRect();
        const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (originalPost) {
            const emojiContainer = originalPost.querySelector('.st-emoji-container');
            if (emojiContainer) {
                const previewTrigger = emojiContainer.querySelector('.st-emoji-preview');
                if (previewTrigger) {
                    previewTrigger.style.display = 'block';
                    previewTrigger.click();
                    previewTrigger.style.display = '';
                }
            }
        }
        let loadingPopup = document.createElement('div');
        loadingPopup.className = 'custom-reaction-popup loading';
        loadingPopup.style.cssText = 'position:fixed;z-index:100000;background:#1a1a1a;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);padding:20px;border:1px solid #333;left:' + (buttonRect.left - 50) + 'px;top:' + (buttonRect.bottom + 10) + 'px;color:white;font-size:14px;';
        loadingPopup.textContent = 'Loading reactions...';
        document.body.appendChild(loadingPopup);
        setTimeout(() => {
            const originalPopup = document.querySelector('.st-emoji-pop');
            let emojis = [];
            if (originalPopup) {
                originalPopup.querySelectorAll('.st-emoji-content').forEach(el => {
                    const dataFui = el.getAttribute('data-fui');
                    const img = el.querySelector('img');
                    const imgSrc = img ? img.getAttribute('src') : '';
                    const imgAlt = img ? img.getAttribute('alt') : '';
                    let name = dataFui ? dataFui.replace(/:/g, '') : '';
                    if (!name && imgAlt) name = imgAlt.replace(/:/g, '');
                    emojis.push({ name, alt: dataFui || imgAlt, src: imgSrc, rid: el.getAttribute('data-rid') });
                });
            }
            loadingPopup.remove();
            if (emojis.length === 0) emojis = getDefaultEmojis();
            const popup = document.createElement('div');
            popup.className = 'custom-reaction-popup';
            popup.style.cssText = 'position:fixed;z-index:100001;background:#1a1a1a;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);padding:12px;border:1px solid #333;left:' + (buttonRect.left - 100) + 'px;top:' + (buttonRect.bottom + 10) + 'px;';
            const emojiGrid = document.createElement('div');
            emojiGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;';
            emojis.forEach(emoji => {
                const emojiItem = document.createElement('div');
                emojiItem.className = 'custom-emoji-item';
                emojiItem.style.cssText = 'cursor:pointer;padding:8px;text-align:center;border-radius:8px;transition:background 0.2s;';
                const img = document.createElement('img');
                img.src = emoji.src || 'https://images.weserv.nl/?url=https://upload.forumfree.net/i/fc11517378/emojis/' + encodeURIComponent(emoji.name) + '.png&output=webp&maxage=1y&q=90&il&af&l=9';
                img.alt = emoji.alt || ':' + emoji.name + ':';
                img.style.cssText = 'width:32px;height:32px;object-fit:contain;';
                img.loading = 'lazy';
                img.onerror = function () { if (!this.src.includes('twemoji')) this.src = 'https://twemoji.maxcdn.com/v/latest/svg/1f606.svg'; };
                emojiItem.appendChild(img);
                emojiItem.addEventListener('mouseenter', function () { this.style.backgroundColor = '#333'; });
                emojiItem.addEventListener('mouseleave', function () { this.style.backgroundColor = 'transparent'; });
                emojiItem.addEventListener('click', function () {
                    const originalPopup = document.querySelector('.st-emoji-pop');
                    if (originalPopup) {
                        const reactionElements = originalPopup.querySelectorAll('.st-emoji-content');
                        let found = false;
                        for (const el of reactionElements) {
                            const dataFui = el.getAttribute('data-fui');
                            const imgEl = el.querySelector('img');
                            const imgAlt = imgEl ? imgEl.getAttribute('alt') : '';
                            if (dataFui === emoji.alt || imgAlt === emoji.alt || dataFui === ':' + emoji.name + ':' || (emoji.rid && el.getAttribute('data-rid') === emoji.rid)) {
                                el.click();
                                found = true;
                                break;
                            }
                        }
                        if (!found && reactionElements.length > 0) reactionElements[0].click();
                    }
                    popup.remove();
                    activePopup = null;
                    setTimeout(() => refreshReactionDisplay(postId), CONFIG.REACTION_DELAY);
                });
                emojiGrid.appendChild(emojiItem);
            });
            popup.appendChild(emojiGrid);
            document.body.appendChild(popup);
            activePopup = popup;
            document.addEventListener('click', activePopupClickHandler);
        }, 200);
    }

    function activePopupClickHandler(e) {
        if (activePopup && !activePopup.contains(e.target) && !e.target.closest('.reaction-btn')) {
            activePopup.remove();
            activePopup = null;
            document.removeEventListener('click', activePopupClickHandler);
        }
    }

    function handleReactionCountClick(pid) {
        const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        const emojiContainer = originalPost.querySelector('.st-emoji-container');
        if (!emojiContainer) return;
        const counter = emojiContainer.querySelector('.st-emoji-counter');
        if (!counter) return;
        counter.style.visibility = 'visible';
        counter.style.opacity = '1';
        counter.style.position = 'relative';
        counter.style.zIndex = '9999';
        counter.click();
        setTimeout(() => {
            counter.style.visibility = '';
            counter.style.opacity = '';
            counter.style.position = '';
        }, 500);
    }

    function generateReactionButtons(data) {
        if (!data.hasReactions || data.reactionCount === 0) {
            return '<button class="reaction-btn reaction-add-btn" aria-label="Add a reaction" data-pid="' + data.postId + '"><i class="fa-regular fa-face-smile" aria-hidden="true"></i></button>';
        }
        const reactionMap = new Map();
        for (const r of data.reactions) {
            if (reactionMap.has(r.src)) {
                reactionMap.get(r.src).count++;
            } else {
                reactionMap.set(r.src, { src: r.src, alt: r.alt, name: r.name, count: 1 });
            }
        }
        let html = '<div class="reactions-container" data-pid="' + data.postId + '">';
        reactionMap.forEach(r => {
            html += '<button class="reaction-btn reaction-with-image" title="' + escapeHtml(r.name || 'Reaction') + '" data-pid="' + data.postId + '"><img src="' + r.src + '" alt="' + escapeHtml(r.alt || 'reaction') + '" width="18" height="18" loading="lazy"><span class="reaction-count">' + r.count + '</span></button>';
        });
        html += '</div>';
        return html;
    }

    function sanitizeGroupName(groupName) {
        if (!groupName) return 'unknown';
        return groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function formatNumber(num) {
        return (num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // ============================================================================
    // GENERATE MODERN CARD (full from v2.1)
    // ============================================================================
    function generateModernPost(data) {
        if (!data) return '';
        const user = data.apiUser;
        const username = data.username;
        const userId = data.mid;
        const isOnline = (user?.status === 'online') || data.isOnline;
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'Online' : 'Offline';
        const profileUrl = userId ? '/?act=Profile&MID=' + userId : '#';
        const avatarData = getUserAvatarData(user, username, userId);
        let avatarHtml = '';
        if (avatarData.type === 'img') {
            avatarHtml = '<div class="post-avatar-wrapper"><a href="' + escapeHtml(profileUrl) + '" class="avatar-link" aria-label="Profile of ' + escapeHtml(username) + '"><img class="avatar-circle" src="' + escapeHtml(avatarData.url) + '" alt="Avatar of ' + escapeHtml(username) + '" width="' + CONFIG.AVATAR_SIZE + '" height="' + CONFIG.AVATAR_SIZE + '" loading="lazy"></a><span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span></div>';
        } else {
            avatarHtml = '<div class="post-avatar-wrapper"><a href="' + escapeHtml(profileUrl) + '" class="avatar-link" aria-label="Profile of ' + escapeHtml(username) + '"><div class="initial-avatar" style="background-color: #' + avatarData.bgColor + ';" data-initial="' + escapeHtml(avatarData.initial) + '">' + escapeHtml(avatarData.initial) + '</div></a><span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span></div>';
        }

        let groupName = user?.group?.name || data.groupText || 'Member';
        let roleClass = 'role-badge';
        const isFounder = user?.group && ((user.group.class?.includes('founder')) || (user.group.bodyclass?.includes('founder')));
        if (isFounder) { roleClass += ' founder'; groupName = 'Founder'; }
        else if (groupName.toLowerCase() === 'administrator') roleClass += ' admin';
        else if (groupName.toLowerCase() === 'moderator') roleClass += ' moderator';
        else if (groupName.toLowerCase() === 'developer') roleClass += ' developer';
        else roleClass += ' member';
        const groupCssClass = 'group-' + sanitizeGroupName(groupName);

        const postCount = user?.messages ?? data.postCount;
        const reputation = user?.reputation ?? data.reputation;
        let joinDateFormatted = 'Unknown join date';
        if (user?.registration) {
            const date = new Date(user.registration);
            joinDateFormatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } else if (data.joinDate) {
            joinDateFormatted = data.joinDate;
        }

        let likeButton = '';
        if (!data.hideFooter && !data.isMessage) {
            likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '"><i class="fa-regular fa-thumbs-up like-icon" aria-hidden="true"></i>';
            if (data.likes > 0) likeButton += '<span class="like-count like-count-display">' + data.likes + '</span>';
            likeButton += '</button>';
        }

        let reactionsHtml = '';
        if (!data.isMemberPostsPage && !data.hideFooter && !data.isMessage) {
            reactionsHtml = generateReactionButtons({
                postId: data.postId,
                hasReactions: data.hasReactions,
                reactionCount: data.reactionCount,
                reactions: data.reactions
            });
        }

        let editHtml = '';
        if (data.editInfo?.relative) {
            const editDate = data.editInfo.rawDate;
            const isoEdit = editDate ? editDate.toISOString() : '';
            const titleEdit = editDate ? editDate.toLocaleString() : '';
            editHtml = '<div class="post-edit-info"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edited <time datetime="' + isoEdit + '" title="' + escapeHtml(titleEdit) + '">' + escapeHtml(data.editInfo.relative) + '</time></div>';
        }

        const signatureHtml = data.signatureHtml ? '<div class="post-signature">' + data.signatureHtml + '</div>' : '';
        const ipHtml = data.ipAddress ? '<div class="post-ip">IP: ' + data.ipAddress + '</div>' : '';
        const postTimeHtml = '<div class="post-time"><time datetime="' + (data.postDate ? data.postDate.toISOString() : '') + '">' + escapeHtml(data.relativeTime) + '</time></div>';

        let actionsHtml = '';
        if (!data.hideActions && !data.isMemberPostsPage) {
            if (data.availableActions?.quote) actionsHtml += '<button class="action-icon" title="Quote" aria-label="Quote this post" data-action="quote" data-pid="' + data.postId + '"><i class="fa-regular fa-quote-left"></i></button>';
            if (data.availableActions?.edit) actionsHtml += '<button class="action-icon" title="Edit" aria-label="Edit this post" data-action="edit" data-pid="' + data.postId + '"><i class="fa-regular fa-pen-to-square"></i></button>';
            if (data.availableActions?.share) actionsHtml += '<button class="action-icon" title="Share" aria-label="Share this post" data-action="share" data-pid="' + data.postId + '"><i class="fa-regular fa-share-nodes"></i></button>';
            if (data.availableActions?.report) actionsHtml += '<button class="action-icon report-action" title="Report" aria-label="Report this post" data-action="report" data-pid="' + data.postId + '"><i class="fa-regular fa-circle-exclamation"></i></button>';
            if (data.availableActions?.delete) actionsHtml += '<button class="action-icon delete-action" title="Delete" aria-label="Delete this post" data-action="delete" data-pid="' + data.postId + '"><i class="fa-regular fa-trash-can"></i></button>';
            if (data.isMessage && data.availableActions?.reply) actionsHtml += '<button class="action-icon" title="Reply" aria-label="Reply" data-action="reply" data-pid="' + data.postId + '"><i class="fa-regular fa-reply"></i></button>';
        }

        let memberActionsHtml = '';
        if (data.isMemberPostsPage && (data.topicLink || data.forumLink)) {
            memberActionsHtml = '<div class="post-member-actions">';
            if (data.topicLink) memberActionsHtml += '<button class="action-icon member-topic-link" title="Go to topic" aria-label="Go to topic" data-topic-url="' + escapeHtml(data.topicLink) + '"><i class="fa-regular fa-message" aria-hidden="true"></i></button>';
            if (data.forumLink) memberActionsHtml += '<button class="action-icon member-forum-link" title="Go to forum" aria-label="Go to forum" data-forum-url="' + escapeHtml(data.forumLink) + '"><i class="fa-regular fa-folder" aria-hidden="true"></i></button>';
            memberActionsHtml += '</div>';
        }

        const statsHtml = '<div class="user-rank"><i class="' + (data.rankIconClass || 'fa-medal fa-regular') + '" aria-hidden="true"></i> ' + (data.userTitle || 'Member') + '</div>' +
            '<div class="user-posts"><i class="fa-regular fa-message"></i> ' + formatNumber(postCount) + ' posts</div>' +
            (!data.isMemberPostsPage && !data.isMessage ? '<div class="user-reputation"><i class="fa-regular fa-thumbs-up"></i> ' + formatNumber(reputation) + ' rep</div>' : '') +
            '<div class="user-joined"><i class="fa-regular fa-user-plus"></i> ' + joinDateFormatted + '</div>';

        const headerActionsHtml = actionsHtml ? '<div class="post-actions">' + actionsHtml + '</div>' : '';

        let footerHtml = '';
        if (!data.hideFooter) {
            let messageActionsHtml = '';
            if (data.isMessage && (data.availableActions?.friend || data.availableActions?.block)) {
                messageActionsHtml = '<div class="post-message-actions">';
                if (data.availableActions.friend) messageActionsHtml += '<button class="action-icon" title="Add as Friend" aria-label="Add as Friend" data-action="friend" data-pid="' + data.postId + '"><i class="fa-regular fa-user-plus"></i></button>';
                if (data.availableActions.block) messageActionsHtml += '<button class="action-icon" title="Block User" aria-label="Block User" data-action="block" data-pid="' + data.postId + '"><i class="fa-regular fa-ban"></i></button>';
                messageActionsHtml += '</div>';
            }
            footerHtml = '<footer class="post-footer"><div class="post-reactions">' + likeButton + reactionsHtml + '</div>' + memberActionsHtml + messageActionsHtml + ipHtml + '</footer>';
        }

        return '<article class="post-card ' + groupCssClass + '" data-original-id="' + (data.originalIdPrefix || CONFIG.POST_ID_PREFIX) + data.postId + '" data-post-id="' + data.postId + '" aria-labelledby="post-title-' + data.postId + '">' +
            '<header class="post-card-header"><div class="post-meta"><div class="post-number"><i class="fa-regular fa-hashtag" aria-hidden="true"></i> ' + data.postNumber + '</div>' + postTimeHtml + '</div>' + headerActionsHtml + '</header>' +
            '<div class="post-card-body"><div class="avatar-modern">' + avatarHtml + '</div>' +
            '<div class="post-user-info"><div class="user-name"><a href="' + profileUrl + '" class="user-profile-link">' + escapeHtml(username) + '</a></div>' +
            '<div class="user-group"><span class="' + roleClass + '">' + escapeHtml(groupName) + '</span></div>' +
            '<div class="user-stats">' + statsHtml + '</div></div></div>' +
            '<div class="post-content"><div class="post-message">' + data.contentHtml + editHtml + '</div>' + signatureHtml + '</div>' +
            footerHtml + '</article>';
    }

    // ============================================================================
    // FAVICON INJECTION
    // ============================================================================
    function applyFaviconsToMessageLinks(container) {
        if (!container) return;
        const links = container.querySelectorAll('.post-message a[href]:not(.has-favicon)');
        for (const link of links) {
            if (link.querySelector('img')) continue;
            try {
                const urlObj = new URL(link.href);
                const domain = urlObj.hostname;
                const faviconUrl = 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=32';
                link.style.backgroundImage = 'url(' + faviconUrl + ')';
                link.style.backgroundRepeat = 'no-repeat';
                link.style.backgroundPosition = 'left center';
                link.style.backgroundSize = '16px 16px';
                link.style.paddingLeft = '22px';
                link.style.display = 'inline';
                link.classList.add('has-favicon');
            } catch (e) {}
        }
    }

    // ============================================================================
    // REFRESH FUNCTIONS
    // ============================================================================
    function refreshLikeDisplay(postId) {
        const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return;
        const pointsPos = originalPost.querySelector('.points .points_pos');
        const newLikeCount = pointsPos ? parseInt(pointsPos.textContent) || 0 : 0;
        const modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) return;
        const likeBtn = modernCard.querySelector('.like-btn');
        if (!likeBtn) return;
        const likeCountSpan = likeBtn.querySelector('.like-count-display');
        if (newLikeCount > 0) {
            if (likeCountSpan) {
                likeCountSpan.textContent = newLikeCount;
            } else {
                const newSpan = document.createElement('span');
                newSpan.className = 'like-count like-count-display';
                newSpan.textContent = newLikeCount;
                likeBtn.appendChild(newSpan);
            }
        } else if (likeCountSpan) {
            likeCountSpan.remove();
        }
    }

    function refreshReactionDisplay(postId) {
        const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return;
        const reactionData = getReactionData(originalPost);
        const modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) return;
        const postReactionsDiv = modernCard.querySelector('.post-reactions');
        if (!postReactionsDiv) return;
        if (reactionData.reactions.length > 0) postReactions.set(postId, reactionData.reactions);
        const likeButton = postReactionsDiv.querySelector('.like-btn');
        const likeButtonHtml = likeButton ? likeButton.outerHTML : '';
        const newReactionsHtml = generateReactionButtons({
            postId,
            hasReactions: reactionData.hasReactions,
            reactionCount: reactionData.reactionCount,
            reactions: reactionData.reactions
        });
        setSanitizedHTML(postReactionsDiv, likeButtonHtml + newReactionsHtml);
    }

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    function handleQuote(pid) {
        const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        const quoteLink = originalPost.querySelector('a[href*="CODE=02"]');
        if (quoteLink) window.location.href = quoteLink.getAttribute('href');
    }
    function handleEdit(pid) {
        const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        const editLink = originalPost.querySelector('a[href*="CODE=08"]');
        if (editLink) window.location.href = editLink.getAttribute('href');
    }
    function handleDelete(pid) {
        if (document.body.id === 'msg') {
            handleMessageDelete(pid);
            return;
        }
        if (confirm('Are you sure you want to delete this post?')) {
            if (typeof window.delete_post === 'function') {
                window.delete_post(pid);
            } else {
                const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
                if (originalPost) {
                    const deleteLink = originalPost.querySelector('a[onclick*="delete_post"], .deletepost, a[href*="CODE=09"]');
                    if (deleteLink) deleteLink.click();
                }
            }
        }
    }
    function handleShare(pid, buttonElement) {
        const url = window.location.href.split('#')[0] + '#entry' + pid;
        navigator.clipboard.writeText(url).then(() => {
            const originalHtml = buttonElement.innerHTML;
            buttonElement.innerHTML = '<i class="fa-regular fa-check" aria-hidden="true"></i>';
            setTimeout(() => { buttonElement.innerHTML = originalHtml; }, 1500);
        }).catch(err => console.error('Copy failed:', err));
    }
    function handleReport(pid) {
        const reportBtn = document.getElementById(CONFIG.POST_ID_PREFIX + pid + ' .report_button') ||
            document.querySelector('.report_button[data-pid="' + pid + '"]');
        if (reportBtn) reportBtn.click();
    }
    function handleLike(pid, isCountClick) {
        const originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        const pointsContainer = originalPost.querySelector('.points');
        if (!pointsContainer) return;
        if (isCountClick) {
            const pointsPos = pointsContainer.querySelector('.points_pos');
            if (pointsPos) {
                const overlayLink = pointsPos.closest('a[rel="#overlay"]');
                if (overlayLink) {
                    if (typeof $ !== 'undefined' && $.fn.overlay) {
                        if (!overlayLink.hasAttribute('data-overlay-init')) {
                            $(overlayLink).overlay({
                                onBeforeLoad: function() {
                                    var wrap = this.getOverlay();
                                    var content = wrap.find('div');
                                    content.html('<p><img src="https://img.forumfree.net/index_file/loads3.gif"></p>').load(overlayLink.getAttribute('href') + '&popup=1');
                                }
                            });
                            overlayLink.setAttribute('data-overlay-init', 'true');
                        }
                        $(overlayLink).trigger('click');
                        return;
                    } else {
                        overlayLink.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                        setTimeout(() => overlayLink.dispatchEvent(new MouseEvent('click', { bubbles: true })), 50);
                        return;
                    }
                }
            }
            pointsContainer.querySelector('.points_pos')?.click();
            return;
        }
        const undoButton = pointsContainer.querySelector('.bullet_delete');
        if (undoButton) {
            undoButton.click();
        } else {
            const likeBtn = pointsContainer.querySelector('.points_up');
            if (likeBtn) {
                likeBtn.click();
            } else {
                const pointsUpLink = pointsContainer.querySelector('a[href*="points_up"], a[onclick*="points_up"]');
                if (pointsUpLink) pointsUpLink.click();
            }
        }
        setTimeout(() => { refreshLikeDisplay(pid); refreshReactionDisplay(pid); }, CONFIG.REACTION_DELAY);
    }
    function handleReact(pid, buttonElement) {
        createCustomReactionPopup(buttonElement, pid);
    }
    function handleMessageReply(msid) {
        const originalPost = findOriginalMessagePost(msid);
        if (!originalPost) return;
        const replyLink = originalPost.querySelector('a[href*="CODE=04"]');
        if (replyLink) window.location.href = replyLink.getAttribute('href');
    }
    function handleMessageDelete(msid) {
        if (!confirm('Are you sure you want to delete this message?')) return;
        const originalPost = findOriginalMessagePost(msid);
        if (!originalPost) return;
        const deleteLink = originalPost.querySelector('a[onclick*="CODE=05"]');
        if (deleteLink) {
            const onclick = deleteLink.getAttribute('onclick');
            const match = onclick.match(/window\.location='([^']+)'/);
            if (match) window.location.href = match[1];
            else deleteLink.click();
        }
    }
    function handleMessageFriend(msid) {
        const originalPost = findOriginalMessagePost(msid);
        if (!originalPost) return;
        const form = originalPost.querySelector('form[name="addmem"]');
        if (form) {
            const bInput = form.querySelector('input[name="b"]');
            if (bInput) bInput.value = '0';
            form.submit();
        }
    }
    function handleMessageBlock(msid) {
        const originalPost = findOriginalMessagePost(msid);
        if (!originalPost) return;
        const form = originalPost.querySelector('form[name="addmem"]');
        if (form) {
            const bInput = form.querySelector('input[name="b"]');
            if (bInput) bInput.value = '1';
            form.submit();
        }
    }
    function findOriginalMessagePost(msid) {
        const linkWithMsid = document.querySelector(`a[href*="MSID=${msid}"], a[onclick*="MSID=${msid}"]`);
        if (linkWithMsid) return linkWithMsid.closest('.post');
        return null;
    }
    function handleQuoteExpand(btn) {
        const quote = btn.closest('.modern-quote');
        if (quote) {
            quote.classList.toggle('expanded');
            const isExpanded = quote.classList.contains('expanded');
            btn.innerHTML = isExpanded ? '<i class="fa-regular fa-chevron-up"></i> Show less' : '<i class="fa-regular fa-chevron-down"></i> Show more';
        }
    }
    function handleQuoteJump(btn) {
        const targetUrl = btn.getAttribute('data-target-url');
        if (targetUrl) window.location.href = targetUrl;
    }
    function handleSpoilerToggle(trigger) {
        const header = trigger.closest('.spoiler-header');
        if (!header) return;
        const spoiler = header.closest('.modern-spoiler');
        const content = spoiler.querySelector('.spoiler-content');
        const toggleBtn = header.querySelector('.spoiler-toggle');
        if (content && content.hidden !== undefined) {
            const isExpanded = !content.hidden;
            content.hidden = isExpanded;
            if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
            header.setAttribute('aria-expanded', String(!isExpanded));
        } else {
            spoiler.classList.toggle('open');
        }
    }

    function attachEventHandlers() {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.action-icon[data-action="quote"]');
            if (btn) { e.preventDefault(); handleQuote(btn.getAttribute('data-pid')); }
        });
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.action-icon[data-action="edit"]');
            if (btn) { e.preventDefault(); handleEdit(btn.getAttribute('data-pid')); }
        });
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.action-icon[data-action="delete"]');
            if (btn) { e.preventDefault(); handleDelete(btn.getAttribute('data-pid')); }
        });
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.action-icon[data-action="share"]');
            if (btn) { e.preventDefault(); handleShare(btn.getAttribute('data-pid'), btn); }
        });
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.action-icon[data-action="report"]');
            if (btn) { e.preventDefault(); handleReport(btn.getAttribute('data-pid')); }
        });
        document.addEventListener('click', function (e) {
            const topicBtn = e.target.closest('.member-topic-link');
            if (topicBtn) {
                e.preventDefault();
                const url = topicBtn.getAttribute('data-topic-url');
                if (url) window.location.href = url;
            }
        });
        document.addEventListener('click', function (e) {
            const forumBtn = e.target.closest('.member-forum-link');
            if (forumBtn) {
                e.preventDefault();
                const url = forumBtn.getAttribute('data-forum-url');
                if (url) window.location.href = url;
            }
        });
        document.addEventListener('click', function (e) {
            const likeBtn = e.target.closest('.like-btn');
            if (likeBtn) {
                e.preventDefault();
                handleLike(likeBtn.getAttribute('data-pid'), e.target.classList.contains('like-count-display'));
            }
        });
        document.addEventListener('click', function (e) {
            const reactionCount = e.target.closest('.reaction-count');
            if (reactionCount) {
                e.preventDefault(); e.stopPropagation();
                const reactionBtn = reactionCount.closest('.reaction-btn');
                if (reactionBtn) handleReactionCountClick(reactionBtn.getAttribute('data-pid'));
            }
        });
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.reaction-btn:not(.like-btn)');
            if (btn && !e.target.classList.contains('reaction-count')) {
                e.preventDefault(); e.stopPropagation();
                handleReact(btn.getAttribute('data-pid'), btn);
            }
        });
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.action-icon[data-action="reply"]');
            if (btn) { e.preventDefault(); handleMessageReply(btn.getAttribute('data-pid')); }
        });
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.action-icon[data-action="friend"]');
            if (btn) { e.preventDefault(); handleMessageFriend(btn.getAttribute('data-pid')); }
        });
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('.action-icon[data-action="block"]');
            if (btn) { e.preventDefault(); handleMessageBlock(btn.getAttribute('data-pid')); }
        });
        document.addEventListener('click', function (e) {
            const expandBtn = e.target.closest('.quote-expand-btn');
            if (expandBtn) { e.preventDefault(); handleQuoteExpand(expandBtn); }
        });
        document.addEventListener('click', function (e) {
            const jumpBtn = e.target.closest('.quote-jump-btn');
            if (jumpBtn) { e.preventDefault(); handleQuoteJump(jumpBtn); }
        });
        document.addEventListener('click', function (e) {
            const spoilerHeader = e.target.closest('.spoiler-header');
            if (spoilerHeader) { e.preventDefault(); handleSpoilerToggle(spoilerHeader); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && activePopup) {
                activePopup.remove();
                activePopup = null;
            }
        });
    }

    // ============================================================================
    // CONVERSION FUNCTIONS
    // ============================================================================
    async function convertMessages() {
        if (conversionInProgress) { conversionPending = true; return; }
        conversionInProgress = true;
        conversionPending = false;
        try {
            const container = getPostsContainer();
            setSanitizedHTML(container, '');
            convertedPostIds.clear();
            const posts = document.querySelectorAll(CONFIG.POST_SELECTOR);
            const validPosts = Array.from(posts).filter(isValidPost);
            if (validPosts.length === 0) return;
            const mids = [];
            const postsData = [];
            for (let i = 0; i < validPosts.length; i++) {
                const $post = validPosts[i];
                const msid = getMsidFromPost($post);
                if (!msid || convertedPostIds.has(msid)) continue;
                const mid = getMidFromPost($post);
                mids.push(mid);
                const postDate = getMessagePostDate($post);
                const relativeTime = postDate ? getRelativeTimeString(postDate) : 'Recently';
                postsData.push({
                    postId: msid, mid, originalPost: $post, username: getMessageUsername($post),
                    groupText: getMessageGroup($post), postCount: getMessagePostCount($post),
                    joinDate: getMessageJoinDate($post), contentHtml: getMessageContent($post),
                    relativeTime, postDate, isMessage: true, hideFooter: false, hideActions: false,
                    availableActions: { reply: true, delete: true, friend: true, block: true },
                    postNumber: i + 1
                });
                convertedPostIds.add(msid);
            }
            await fetchMultipleUsers(mids);
            for (const data of postsData) {
                const apiUser = data.mid ? userDataCache.get(data.mid) : null;
                const completeData = { ...data, apiUser, originalIdPrefix: '' };
                const cardHtml = generateModernPost(completeData);
                const card = createElementFromHTML(cardHtml);
                container.appendChild(card);
                applyFaviconsToMessageLinks(card);
            }
            attachEventHandlers();
            initQuotesAndSpoilers();
            console.log('[PostsModule] Messages ready - ' + postsData.length + ' messages converted');
        } catch (err) { console.error('[PostsModule] Messages conversion error:', err); }
        finally { conversionInProgress = false; if (conversionPending) convertMessages(); }
    }

    async function convertAllPosts() {
        if (conversionInProgress) { conversionPending = true; return; }
        conversionInProgress = true;
        conversionPending = false;
        try {
            const container = getPostsContainer();
            setSanitizedHTML(container, '');
            convertedPostIds.clear();
            postReactions.clear();
            const blogArticles = document.querySelectorAll('.blog .article');
            let blogCount = 0;
            const allMids = [];
            for (const articleLi of blogArticles) {
                const blogData = getBlogArticleData(articleLi);
                if (blogData.postId && convertedPostIds.has(blogData.postId)) continue;
                if (blogData.mid) allMids.push(blogData.mid);
                await fetchMultipleUsers(allMids);
                const apiUser = blogData.mid ? userDataCache.get(blogData.mid) : null;
                const blogCardHtml = generateBlogPost(blogData, apiUser);
                const blogCard = createElementFromHTML(blogCardHtml);
                container.appendChild(blogCard);
                applyFaviconsToMessageLinks(blogCard);
                if (blogData.postId) convertedPostIds.add(blogData.postId);
                blogCount++;
            }
            const posts = document.querySelectorAll(CONFIG.POST_SELECTOR);
            const validPosts = Array.from(posts).filter(isValidPost);
            let globalMid = null, globalUsername = null, isMemberPostsPage = false;
            const memberPostsHeader = document.querySelector('.topic.member_posts .mtitle b');
            if (memberPostsHeader) {
                isMemberPostsPage = true;
                const match = memberPostsHeader.className.match(/user(\d+)/);
                if (match) globalMid = match[1];
                else {
                    const onclickAttr = memberPostsHeader.getAttribute('onclick');
                    if (onclickAttr) {
                        const midMatch = onclickAttr.match(/MID=(\d+)/);
                        if (midMatch) globalMid = midMatch[1];
                    }
                }
                globalUsername = memberPostsHeader.textContent.trim();
            }
            const mids = [];
            const postsData = [];
            for (const $post of validPosts) {
                const postId = getPostId($post);
                if (!postId || convertedPostIds.has(postId)) continue;
                let mid = getMidFromPost($post) || globalMid;
                mids.push(mid);
                const reactionData = getReactionData($post);
                const userTitleData = getUserTitleAndIcon($post);
                if (reactionData.hasReactions) postReactions.set(postId, reactionData.reactions);
                const whenSpan = $post.querySelector('.when');
                let postDate = null;
                if (whenSpan) {
                    const title = whenSpan.getAttribute('title') || whenSpan.textContent.replace(/^Posted:\s*/i, '');
                    postDate = parseDateFromTitle(title);
                }
                const relativeTime = postDate ? getRelativeTimeString(postDate) : 'Recently';
                const editInfo = getEditInfo($post);
                let availableActions = getAvailableActions($post, postId);
                if (isMemberPostsPage) availableActions = { quote: false, edit: false, delete: false, report: false, share: false };
                const memberLinks = isMemberPostsPage ? getMemberPostLinks($post) : {};
                const username = getUsername($post) === 'Unknown' ? globalUsername : getUsername($post);
                postsData.push({
                    postId, mid, originalPost: $post, username, groupText: getGroupText($post),
                    postCount: getPostCount($post), reputation: getReputation($post),
                    isOnline: getIsOnline($post), userTitle: userTitleData.title,
                    rankIconClass: userTitleData.iconClass, contentHtml: getCleanContent($post),
                    signatureHtml: getSignatureHtml($post), editInfo, likes: getLikes($post),
                    hasReactions: reactionData.hasReactions, reactionCount: reactionData.reactionCount,
                    reactions: reactionData.reactions, ipAddress: getMaskedIp($post),
                    relativeTime, postDate, availableActions, isMemberPostsPage,
                    topicLink: memberLinks.topicLink, topicTitle: memberLinks.topicTitle,
                    forumLink: memberLinks.forumLink, forumName: memberLinks.forumName,
                    hideActions: false, hideFooter: false
                });
                convertedPostIds.add(postId);
            }
            await fetchMultipleUsers(mids);
            for (let i = 0; i < postsData.length; i++) {
                const data = postsData[i];
                const apiUser = data.mid ? userDataCache.get(data.mid) : null;
                const completeData = { ...data, apiUser, postNumber: i + 1 + blogCount };
                const cardHtml = generateModernPost(completeData);
                const card = createElementFromHTML(cardHtml);
                container.appendChild(card);
                applyFaviconsToMessageLinks(card);
            }
            attachEventHandlers();
            initQuotesAndSpoilers();
            console.log('[PostsModule] Ready - ' + (postsData.length + blogCount) + ' posts converted');
        } catch (err) { console.error('[PostsModule] Conversion error:', err); }
        finally { conversionInProgress = false; if (conversionPending) convertAllPosts(); }
    }

    async function convertSummaryPosts() {
        if (document.body.id !== 'send') return;
        const summaryEl = document.querySelector('.summary');
        if (!summaryEl) return;
        let container = document.getElementById('modern-summary-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'modern-summary-container';
            container.className = 'modern-posts-container';
            const wrapper = document.getElementById('modern-forum-wrapper') || document.body;
            wrapper.appendChild(container);
        } else setSanitizedHTML(container, '');
        const header = document.createElement('div');
        header.className = 'summary-header modern-section-header';
        setSanitizedHTML(header, '<div class="summary-header-content"><i class="fa-regular fa-clock" aria-hidden="true"></i><h3>Latest posts <span class="summary-subtitle">(last 10, newest first)</span></h3></div>');
        container.appendChild(header);
        const listItems = summaryEl.querySelectorAll('.list > li');
        if (!listItems.length) return;
        const mids = [], postsData = [];
        for (let i = 0; i < listItems.length; i++) {
            const li = listItems[i];
            const nickLink = li.querySelector('.nick a');
            if (!nickLink) continue;
            const username = nickLink.textContent.trim();
            const midMatch = nickLink.href.match(/MID=(\d+)/);
            const mid = midMatch ? midMatch[1] : null;
            mids.push(mid);
            let groupName = 'Member';
            if (li.className.includes('box_founder')) groupName = 'Founder';
            else if (li.className.includes('box_amministratore')) groupName = 'Administrator';
            else if (li.className.includes('box_moderatore')) groupName = 'Moderator';
            const whenSpan = li.querySelector('.when');
            let postDate = null;
            if (whenSpan) {
                const title = whenSpan.getAttribute('title') || whenSpan.textContent.replace(/^Posted\s*/i, '');
                postDate = parseDateFromTitle(title);
            }
            const relativeTime = postDate ? getRelativeTimeString(postDate) : 'Recently';
            const contentDiv = li.querySelector('.color.Item');
            let contentHtml = '';
            if (contentDiv) {
                const clone = contentDiv.cloneNode(true);
                clone.querySelector('.signature')?.remove();
                clone.querySelector('.edit')?.remove();
                contentHtml = transformEmbeddedLinks(clone.innerHTML);
                contentHtml = transformLegacyQuotesAndSpoilers(contentHtml);
            }
            postsData.push({
                postId: 'summary_' + i, mid, username, groupText: groupName, contentHtml,
                relativeTime, postDate, isSummary: true, hideActions: true, hideFooter: true,
                postNumber: i + 1, postCount: '0', reputation: '0', isOnline: false,
                userTitle: 'Member', rankIconClass: 'fa-medal fa-regular',
                likes: 0, hasReactions: false, reactionCount: 0, reactions: [], availableActions: {}
            });
        }
        if (!mids.length) return;
        await fetchMultipleUsers(mids);
        for (const data of postsData) {
            const apiUser = data.mid ? userDataCache.get(data.mid) : null;
            const completeData = { ...data, apiUser };
            const cardHtml = generateModernPost(completeData);
            const card = createElementFromHTML(cardHtml);
            container.appendChild(card);
            applyFaviconsToMessageLinks(card);
        }
        initQuotesAndSpoilers();
        console.log('[PostsModule] Summary conversion ready - ' + postsData.length + ' posts');
    }

    // ============================================================================
    // INITIALIZE
    // ============================================================================
    function initialize() {
        if (isInitialized) return Promise.resolve();
        const depsReady = new Promise(resolve => {
            let readyUtils = false, readyBus = false;
            function check() { if (readyUtils && readyBus) resolve(); }
            if (typeof ForumDOMUtils !== 'undefined') readyUtils = true;
            else window.addEventListener('dom-utils-ready', () => { readyUtils = true; check(); });
            if (typeof ForumEventBus !== 'undefined') readyBus = true;
            else window.addEventListener('event-bus-ready', () => { readyBus = true; check(); });
            check();
            setTimeout(resolve, 5000);
        });
        return depsReady.then(() => {
            if (isInitialized) return;
            isInitialized = true;
            if (!isValidPage()) {
                if (document.body.id === 'send' && document.querySelector('.summary')) convertSummaryPosts().catch(err => console.error('[PostsModule] Summary conversion error', err));
                return;
            }
            if (document.body.id === 'msg') convertMessages().catch(err => console.error('[PostsModule] Messages conversion error', err));
            else if (document.body.id === 'send' && document.querySelector('.summary')) convertSummaryPosts().catch(err => console.error('[PostsModule] Summary conversion error', err));
            else convertAllPosts().catch(err => console.error('[PostsModule] Init error', err));
            if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
                globalThis.forumObserver.register({
                    id: 'posts-module', selector: CONFIG.POST_SELECTOR, priority: 'high',
                    callback: (node) => {
                        if (!isValidPost(node)) return;
                        const postId = getPostId(node);
                        if (!postId || convertedPostIds.has(postId)) return;
                        if (document.body.id === 'msg') convertMessages();
                        else convertAllPosts();
                    }
                });
                globalThis.forumObserver.register({
                    id: 'posts-module-reactions', selector: '.st-emoji-container', priority: 'medium',
                    callback: (node) => {
                        const postEl = node.closest('.post');
                        if (postEl && isValidPost(postEl)) {
                            const postId = getPostId(postEl);
                            if (postId) setTimeout(() => refreshReactionDisplay(postId), 100);
                            return;
                        }
                        const articleEl = node.closest('.article');
                        if (articleEl) {
                            const pid = getPostId(articleEl);
                            if (pid) setTimeout(() => refreshReactionDisplay(pid), 100);
                        }
                    }
                });
                globalThis.forumObserver.register({
                    id: 'posts-module-reaction-images', selector: '.st-emoji-preview img', priority: 'low',
                    callback: (node) => {
                        const postEl = node.closest('.post');
                        if (postEl && isValidPost(postEl)) {
                            const postId = getPostId(postEl);
                            if (postId) refreshReactionDisplay(postId);
                        }
                    }
                });
            }
        }).catch(err => console.error('[PostsModule] Dependency wait failed:', err));
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================
    return {
        initialize,
        refreshReactionDisplay,
        refreshLikeDisplay,
        getPostsContainer,
        isValidPost,
        reset: function () {
            convertedPostIds.clear();
            postReactions.clear();
            userDataCache.clear();
            isInitialized = false;
            if (activePopup) {
                activePopup.remove();
                activePopup = null;
                document.removeEventListener('click', activePopupClickHandler);
            }
        },
        CONFIG
    };
})();

if (typeof window !== 'undefined') {
    window.ForumPostsModule = ForumPostsModule;
    window.dispatchEvent(new CustomEvent('posts-module-ready'));
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('posts-module-ready');
        try { performance.measure('posts-module-load-time', 'posts-module-start', 'posts-module-ready'); } catch (e) {}
    }
}
