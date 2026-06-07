// Forum Modernizer - Posts Module v2.2 (fixed author extraction from full text)
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

    const escapeHtml = (str) => {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

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

    function isValidPage() {
        const bodyId = document.body.id;
        if (bodyId === 'topic' || bodyId === 'send' || bodyId === 'blog' || bodyId === 'msg') return true;
        if (bodyId === 'search') return document.querySelector('.topic.member_posts') !== null;
        return false;
    }

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

    // --------------------------------------------------------------------------
    // DATA EXTRACTION (topics, messages, blogs) - same as v2.1 (unchanged)
    // --------------------------------------------------------------------------
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

    function generateBlogPost(data, apiUser) {
        // unchanged from v2.1 (keep as is)
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
    // EMBEDDED LINK TRANSFORMATION (unchanged)
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
    // POST-PROCESSING (image-aware, same as v2.1)
    // ============================================================================
    function initQuotesAndSpoilers() {
        const quotes = document.querySelectorAll('.modern-quote.long-quote');
        const checkQuote = (quote) => {
            const content = quote.querySelector('.quote-content');
            const expandBtn = quote.querySelector('.quote-expand-btn');
            if (!content || !expandBtn) return;
            const maxHeight = parseFloat(getComputedStyle(content).maxHeight);
            if (isNaN(maxHeight)) return;
            if (content.scrollHeight <= maxHeight + 2) {
                expandBtn.remove();
                quote.classList.remove('long-quote');
            } else {
                expandBtn.innerHTML = '<i class="fa-regular fa-chevron-down"></i> Show more';
                quote.classList.remove('expanded');
            }
        };
        quotes.forEach(quote => {
            const content = quote.querySelector('.quote-content');
            if (!content) return;
            const images = content.querySelectorAll('img');
            if (images.length === 0) {
                checkQuote(quote);
            } else {
                let pending = images.length;
                const onLoadOrError = () => {
                    pending--;
                    if (pending === 0) {
                        requestAnimationFrame(() => checkQuote(quote));
                    }
                };
                images.forEach(img => {
                    if (img.complete) onLoadOrError();
                    else {
                        img.addEventListener('load', onLoadOrError);
                        img.addEventListener('error', onLoadOrError);
                    }
                });
            }
        });
        document.querySelectorAll('.modern-spoiler .spoiler-content').forEach(content => {
            if (!content.hasAttribute('hidden')) content.setAttribute('hidden', '');
        });
    }

    // ============================================================================
    // REACTION POPUP (shortened – include all from v2.1)
    // ============================================================================
    function getAvailableReactions(postId) { /* unchanged – keep full version from v2.1 */ }
    function getDefaultEmojis() { return [{ name: 'kekw', alt: ':kekw:', src: '', rid: '10' }, { name: 'rofl', alt: ':rofl:', src: '', rid: '1' }]; }
    function createCustomReactionPopup(buttonElement, postId) { /* unchanged – keep full from v2.1 */ }
    function activePopupClickHandler(e) { /* unchanged */ }
    function handleReactionCountClick(pid) { /* unchanged */ }
    function generateReactionButtons(data) { /* unchanged */ }
    function sanitizeGroupName(groupName) { return groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
    function formatNumber(num) { return (num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

    function generateModernPost(data) { /* unchanged – keep full from v2.1 */ }
    function applyFaviconsToMessageLinks(container) { /* unchanged */ }
    function refreshLikeDisplay(postId) { /* unchanged */ }
    function refreshReactionDisplay(postId) { /* unchanged */ }

    // ============================================================================
    // EVENT HANDLERS (unchanged)
    // ============================================================================
    function handleQuote(pid) { /* unchanged */ }
    function handleEdit(pid) { /* unchanged */ }
    function handleDelete(pid) { /* unchanged */ }
    function handleShare(pid, buttonElement) { /* unchanged */ }
    function handleReport(pid) { /* unchanged */ }
    function handleLike(pid, isCountClick) { /* unchanged */ }
    function handleReact(pid, buttonElement) { /* unchanged */ }
    function handleMessageReply(msid) { /* unchanged */ }
    function handleMessageDelete(msid) { /* unchanged */ }
    function handleMessageFriend(msid) { /* unchanged */ }
    function handleMessageBlock(msid) { /* unchanged */ }
    function findOriginalMessagePost(msid) { /* unchanged */ }
    function handleQuoteExpand(btn) { /* unchanged */ }
    function handleQuoteJump(btn) { /* unchanged */ }
    function handleSpoilerToggle(trigger) { /* unchanged */ }
    function attachEventHandlers() { /* unchanged – keep full from v2.1 */ }

    // ============================================================================
    // CONVERSION FUNCTIONS (unchanged, but call initQuotesAndSpoilers)
    // ============================================================================
    async function convertMessages() { /* same as v2.1 */ }
    async function convertAllPosts() { /* same as v2.1 */ }
    async function convertSummaryPosts() { /* same as v2.1 */ }

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
