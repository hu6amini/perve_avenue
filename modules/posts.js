// Forum Modernizer - Posts Module (API-enhanced, all original functionality preserved)
// Transforms .post elements into modern card layout with API user data (avatar, join date, online dot)
// ADDED: Relative timestamps for post time and edit info
// ADDED: Group-specific CSS class on post card (e.g., group-fan, group-admin, group-moderator)
// ADDED: Intelligent action buttons – only show quote/edit/delete if available in original post
// ADDED: Support for "member_posts" page – extract global user info, hide reputation, disable reactions, add topic/forum buttons inside container
// ADDED: Page restrictions – only runs on #topic, #send, #blog, and #search (with .topic.member_posts)
// FIXED: Timestamp parsing on member_posts when title attribute is missing
// CHANGED: Fallback avatars use real DOM initial letter (Quicksand font) instead of SVG data-URI
// NEW: Summary conversion on body#send – transforms .summary into modern post cards (no actions, no footer) with a modern header
// IMPROVED: Semantic HTML – username and avatar are anchor tags for better accessibility & SEO
// NEW: Favicons added to text-only links inside .post-message
// NEW: Blog article conversion – body#topic articles (.blog .article) become modern blog cards with absolute date

var ForumPostsModule = (function(Utils, EventBus) {
    'use strict';

    // ===== USER TIMING: mark script start =====
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('posts-module-start');
    }
    // ==========================================

    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    var CONFIG = {
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container',
        REACTION_DELAY: 500,
        AVATAR_SIZE: 60,
        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 80
    };

    // Avatar colour palette (for initial fallback)
    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    // Track converted posts
    var convertedPostIds = new Set();
    var isInitialized = false;
    var postReactions = new Map();
    var activePopup = null;
    var conversionInProgress = false;
    var conversionPending = false;

    // Cache for user API data (MID -> user object)
    var userDataCache = new Map();

    // ============================================================================
    // PAGE VALIDATION
    // ============================================================================
    function isValidPage() {
        var bodyId = document.body.id;
        if (bodyId === 'topic' || bodyId === 'send' || bodyId === 'blog') {
            return true;
        }
        if (bodyId === 'search') {
            return document.querySelector('.topic.member_posts') !== null;
        }
        return false;
    }

    // ============================================================================
    // RELATIVE TIME & DATE PARSING
    // ============================================================================
    function parseDateFromTitle(title) {
        if (!title) return null;
        title = title.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)?:(\d+)/i, '$1:$2 $3');
        var hasMeridiem = /[ap]m/i.test(title);
        var nums = title.match(/\d+/g);
        if (!nums || nums.length < 3) return null;
        var year, month, day, hour, minute, second;
        if (hasMeridiem) {
            month = parseInt(nums[0], 10) - 1;
            day   = parseInt(nums[1], 10);
            year  = parseInt(nums[2], 10);
            hour  = parseInt(nums[3] || 0, 10);
            minute = parseInt(nums[4] || 0, 10);
            second = parseInt(nums[5] || 0, 10);
            var isPM = /pm/i.test(title);
            if (isPM && hour < 12) hour += 12;
            if (!isPM && hour === 12) hour = 0;
        } else {
            day   = parseInt(nums[0], 10);
            month = parseInt(nums[1], 10) - 1;
            year  = parseInt(nums[2], 10);
            hour  = parseInt(nums[3] || 0, 10);
            minute = parseInt(nums[4] || 0, 10);
            second = parseInt(nums[5] || 0, 10);
        }
        return new Date(year, month, day, hour, minute, second);
    }

    function getRelativeTimeString(date) {
        if (!date || isNaN(date.getTime())) return 'Unknown';
        var now = new Date();
        var diff = (date - now);
        var absDiff = Math.abs(diff) / 1000;
        var rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'en', { numeric: 'auto' });
        if (absDiff < 60) return rtf.format(Math.floor(diff / 1000), 'second');
        if (absDiff < 3600) return rtf.format(Math.floor(diff / 60000), 'minute');
        if (absDiff < 86400) return rtf.format(Math.floor(diff / 3600000), 'hour');
        if (absDiff < 2592000) {
            var days = Math.floor(absDiff / 86400);
            return rtf.format(-days, 'day');
        }
        if (absDiff < 31536000) {
            var months = Math.floor(absDiff / 2592000);
            return rtf.format(-months, 'month');
        }
        var years = Math.floor(absDiff / 31536000);
        return rtf.format(-years, 'year');
    }

    // ============================================================================
    // API USER DATA FETCHING
    // ============================================================================
    async function fetchUserData(mid) {
        if (userDataCache.has(mid)) return userDataCache.get(mid);
        try {
            var response = await fetch('/api.php?mid=' + mid);
            var data = await response.json();
            var user = data['m' + mid] || data.info;
            if (user && user.id) {
                userDataCache.set(mid, user);
                return user;
            }
            return null;
        } catch (e) {
            console.error('[PostsModule] API error for MID', mid, e);
            return null;
        }
    }

    async function fetchMultipleUsers(midList) {
        var uniqueMids = [...new Set(midList.filter(Boolean))];
        await Promise.all(uniqueMids.map(mid => fetchUserData(mid)));
    }

    // ============================================================================
    // AVATAR HANDLING
    // ============================================================================
    function isValidAvatarUrl(url) {
        if (!url || typeof url !== 'string') return false;
        var trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return false;
        if (trimmed === 'http' || trimmed === 'https' || trimmed === '//') return false;
        return true;
    }

    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        var colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
        return AVATAR_COLORS[colorIndex];
    }

    function optimizeImageUrl(url, width, height) {
        if (!isValidAvatarUrl(url)) return null;
        var lowerUrl = url.toLowerCase();
        if (lowerUrl.indexOf('weserv.nl') !== -1 || lowerUrl.indexOf('data:') === 0) {
            return url;
        }
        var targetWidth = width || CONFIG.AVATAR_SIZE;
        var targetHeight = height || CONFIG.AVATAR_SIZE;
        var isGif = (lowerUrl.indexOf('.gif') !== -1 || /\.gif($|\?|#)/i.test(lowerUrl));
        var outputFormat = 'webp';
        var quality = CONFIG.QUALITY;
        var encodedUrl = encodeURIComponent(url);
        var optimizedUrl = CONFIG.WESERV_CDN + '?url=' + encodedUrl +
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
        if (user && user.avatar && isValidAvatarUrl(user.avatar) && !isDefaultAvatarUrl(user.avatar)) {
            var avatarUrl = user.avatar;
            if (avatarUrl.startsWith('//')) avatarUrl = 'https:' + avatarUrl;
            if (avatarUrl.startsWith('http://') && window.location.protocol === 'https:')
                avatarUrl = avatarUrl.replace('http://', 'https://');
            var optimized = optimizeImageUrl(avatarUrl, CONFIG.AVATAR_SIZE, CONFIG.AVATAR_SIZE);
            if (optimized) return { type: 'img', url: optimized };
        }
        var initial = username ? username.charAt(0).toUpperCase() : '?';
        if (!initial.match(/[A-Z0-9]/i)) initial = '?';
        var bgColor = getColorFromNickname(username, userId);
        return { type: 'initial', initial: initial, bgColor: bgColor };
    }

    // ============================================================================
    // HELPERS
    // ============================================================================
function getPostsContainer() {
    var modernContainer = document.getElementById('modern-posts-container');

    // 1. Ensure the wrapper is positioned after .carousel-wrapper (only if the
    //    carousel is NOT already inside the wrapper – i.e., they are siblings)
    var wrapper = document.getElementById('modern-forum-wrapper');
    var carouselWrapper = document.querySelector('.carousel-wrapper');

    if (wrapper && carouselWrapper) {
        // If the carousel is already a descendant of the wrapper, do nothing
        if (!wrapper.contains(carouselWrapper)) {
            // Carousel is outside the wrapper (sibling situation)
            if (wrapper.compareDocumentPosition(carouselWrapper) & Node.DOCUMENT_POSITION_FOLLOWING) {
                carouselWrapper.parentNode.insertBefore(wrapper, carouselWrapper.nextSibling);
            }
        }
        // else: carousel is inside wrapper – perfect, no repositioning needed
    } else if (!wrapper && carouselWrapper) {
        // Wrapper doesn't exist yet – create it and insert after the carousel
        wrapper = document.createElement('div');
        wrapper.id = 'modern-forum-wrapper';
        wrapper.className = 'modern-forum-wrapper';
        carouselWrapper.parentNode.insertBefore(wrapper, carouselWrapper.nextSibling);
    }

    // 2. Return or create the posts container inside the wrapper
    if (modernContainer) {
        return modernContainer;
    }

    var originalContainer = document.getElementById(CONFIG.CONTAINER_ID);
    if (originalContainer) return originalContainer;

    var newContainer = document.createElement('div');
    newContainer.id = CONFIG.CONTAINER_ID;
    newContainer.className = 'modern-posts-container';

    if (wrapper) {
        wrapper.appendChild(newContainer);
    } else {
        // Fallback – no carousel, no wrapper yet
        var enhancerWrapper = document.getElementById('modern-forum-wrapper');
        if (enhancerWrapper) {
            enhancerWrapper.appendChild(newContainer);
        } else {
            document.body.appendChild(newContainer);
        }
    }

    return newContainer;
}

    function isValidPost(postEl) {
        if (!postEl) return false;
        var id = postEl.getAttribute('id');
        return id && id.startsWith(CONFIG.POST_ID_PREFIX) && postEl.tagName !== 'BODY';
    }

    function getPostId($post) {
        var fullId = $post.getAttribute('id');
        if (!fullId) return null;
        if (!fullId.startsWith(CONFIG.POST_ID_PREFIX)) return null;
        return fullId.replace(CONFIG.POST_ID_PREFIX, '');
    }

    function getMidFromPost($post) {
        var nickLink = $post.querySelector('.nick a');
        if (nickLink) {
            var match = nickLink.href.match(/MID=(\d+)/);
            if (match) return match[1];
        }
        var avatarLink = $post.querySelector('.avatar a');
        if (avatarLink) {
            var match = avatarLink.href.match(/MID=(\d+)/);
            if (match) return match[1];
        }
        return null;
    }

    // ============================================================================
    // DATA EXTRACTION (same as before, unchanged)
    // ============================================================================
    function getUsername($post) {
        var nickLink = $post.querySelector('.nick a');
        return nickLink ? nickLink.textContent.trim() : 'Unknown';
    }

    function getGroupText($post) {
        var groupDd = $post.querySelector('.u_group dd');
        return groupDd ? groupDd.textContent.trim() : '';
    }

    function getPostCount($post) {
        var postsLink = $post.querySelector('.u_posts dd a');
        return postsLink ? postsLink.textContent.trim() : '0';
    }

    function getReputation($post) {
        var repLink = $post.querySelector('.u_reputation dd a');
        if (!repLink) return '0';
        return repLink.textContent.trim().replace('+', '');
    }

    function getIsOnline($post) {
        var statusTitle = $post.querySelector('.u_status');
        if (!statusTitle) return false;
        var title = statusTitle.getAttribute('title') || '';
        return title.toLowerCase().includes('online');
    }

    function getUserTitleAndIcon($post) {
        var uRankSpan = $post.querySelector('.u_rank');
        if (!uRankSpan) return { title: 'Member', iconClass: 'fa-medal fa-regular' };
        var icon = uRankSpan.querySelector('i');
        var iconClass = '';
        if (icon) {
            var classAttr = icon.getAttribute('class') || '';
            if (classAttr.includes('fa-solid')) classAttr = classAttr.replace('fa-solid', 'fa-regular');
            iconClass = classAttr;
        } else iconClass = 'fa-medal fa-regular';
        var rankSpan = uRankSpan.querySelector('span');
        var title = rankSpan ? rankSpan.textContent.trim() : uRankSpan.textContent.trim();
        if (title === 'Member') {
            var stars = $post.querySelectorAll('.u_rank i.fa-star').length;
            if (stars === 3) title = 'Famous';
            else if (stars === 2) title = 'Senior';
            else if (stars === 1) title = 'Junior';
        }
        return { title: title || 'Member', iconClass: iconClass };
    }

    function getCleanContent($post) {
        var contentTable = $post.querySelector('.right.Item table.color');
        if (!contentTable) {
            contentTable = $post.querySelector('td.Item table.color');
        }
        if (!contentTable) return '';
        var contentClone = contentTable.cloneNode(true);
        var editSpans = contentClone.querySelectorAll('.edit');
        for (var i = 0; i < editSpans.length; i++) {
            var edit = editSpans[i];
            var prev = edit.previousSibling;
            while (prev && prev.nodeType === Node.ELEMENT_NODE && prev.tagName === 'BR') {
                var toRemove = prev;
                prev = prev.previousSibling;
                toRemove.remove();
            }
        }
        var signatures = contentClone.querySelectorAll('.signature, .edit');
        signatures.forEach(function(el) { if (el && el.remove) el.remove(); });
        var borders = contentClone.querySelectorAll('.bottomborder');
        borders.forEach(function(el) { if (el && el.remove) el.remove(); });
        var breaks = contentClone.querySelectorAll('br');
        breaks.forEach(function(br) {
            var prev = br.previousElementSibling;
            var next = br.nextElementSibling;
            if ((next && next.classList && next.classList.contains('bottomborder')) ||
                (prev && prev.classList && prev.classList.contains('bottomborder'))) {
                if (br.remove) br.remove();
            }
        });
        var html = contentClone.innerHTML || '';
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.trim();
        html = transformEmbeddedLinks(html);
        return html;
    }

    function getSignatureHtml($post) {
        var signature = $post.querySelector('.signature');
        if (!signature) return '';
        var sigClone = signature.cloneNode(true);
        return sigClone.innerHTML;
    }

    function getEditInfo($post) {
        var editSpan = $post.querySelector('.edit');
        if (!editSpan) return null;
        var fullText = editSpan.textContent.trim();
        var parts = fullText.split(' - ');
        if (parts.length < 2) return null;
        var editorPart = parts.slice(0, -1).join(' - ');
        var dateStr = parts[parts.length - 1].trim();
        var date = parseDateFromTitle(dateStr);
        if (!date || isNaN(date.getTime())) return null;
        var relative = getRelativeTimeString(date);
        return {
            editor: editorPart,
            relative: relative,
            rawDate: date
        };
    }

    function getLikes($post) {
        var pointsPos = $post.querySelector('.points .points_pos');
        if (!pointsPos) return 0;
        return parseInt(pointsPos.textContent) || 0;
    }

function getReactionData($post) {
    var hasReactions = false;
    var reactionCount = 0;
    var reactions = [];

    // Aggregates total counter from ALL containers (top preview + bottom widget)
    var allContainers = $post.querySelectorAll('.st-emoji-container');
    allContainers.forEach(function (container) {
        var counters = container.querySelectorAll('.st-emoji-counter');
        counters.forEach(function (counter) {
            var count = parseInt(counter.getAttribute('data-count') || counter.textContent || 0);
            if (count > 0) {
                hasReactions = true;
                reactionCount += count;
            }
        });
    });

    // Extract individual reaction images
    // Prefer the widget (detailed list) if present
    var widgetContainer = null;
    var widget = $post.querySelector('.st-emoji-widget');
    if (widget) {
        widgetContainer = widget.querySelector('.st-emoji-container');
    }

    if (widgetContainer) {
        // Widget format: each .st-emoji-info has its own counter
        var items = widgetContainer.querySelectorAll('.st-emoji-info');
        items.forEach(function (item) {
            var counterEl = item.querySelector('.st-emoji-counter');
            if (!counterEl) return;
            var count = parseInt(counterEl.getAttribute('data-count') || counterEl.textContent || 0);
            if (count <= 0) return;
            var contentEl = item.querySelector('.st-emoji-content');
            if (!contentEl) return;
            var img = contentEl.querySelector('img');
            if (!img) return;
            var src = img.getAttribute('src') || '';
            var alt = img.getAttribute('alt') || '';
            if (src) {
                reactions.push({
                    name: alt.replace(/:/g, ''),
                    alt: alt,
                    src: src,
                    rid: contentEl.getAttribute('data-rid'),
                    count: count
                });
            }
        });
    } else {
        // Fallback to preview container (regular posts)
        var previewContainer = $post.querySelector('.st-emoji-container');
        if (previewContainer) {
            var previewDiv = previewContainer.querySelector('.st-emoji-preview');
            if (previewDiv) {
                var images = previewDiv.querySelectorAll('img');
                images.forEach(function (img) {
                    var src = img.getAttribute('src') || '';
                    var alt = img.getAttribute('alt') || '';
                    if (src) {
                        reactions.push({
                            name: alt.replace(/:/g, ''),
                            alt: alt,
                            src: src,
                            count: reactionCount  // all points belong to this one image
                        });
                    }
                });
            }
        }
    }

    return { hasReactions: hasReactions, reactionCount: reactionCount, reactions: reactions };
}
    
    function getMaskedIp($post) {
        var ipLink = $post.querySelector('.ip_address dd a');
        if (!ipLink) return '';
        var ip = ipLink.textContent.trim();
        var parts = ip.split('.');
        if (parts.length === 4) return parts[0] + '.' + parts[1] + '.' + parts[2] + '.xxx';
        return ip;
    }

    function getAvailableActions($post, postId) {
        var actions = { quote: false, edit: false, delete: false, report: true, share: true };
        var quoteLink = $post.querySelector('a[href*="CODE=02"]');
        if (quoteLink) actions.quote = true;
        var editLink = $post.querySelector('a[href*="CODE=08"]');
        if (editLink) actions.edit = true;
        var deleteEl = $post.querySelector('a[onclick*="delete_post"], a[href*="delete_post"], .deletepost, a[href*="CODE=09"]');
        if (deleteEl) actions.delete = true;
        return actions;
    }

    function getMemberPostLinks($post) {
        var rtSub = $post.querySelector('.rt.Sub');
        if (!rtSub) return { topicLink: null, topicTitle: null, forumLink: null, forumName: null };
        var links = rtSub.querySelectorAll('a');
        var topicLink = null, forumLink = null;
        var topicTitle = '', forumName = '';
        if (links.length >= 1) {
            topicLink = links[0].getAttribute('href');
            topicTitle = links[0].textContent.trim();
        }
        if (links.length >= 2) {
            forumLink = links[1].getAttribute('href');
            forumName = links[1].textContent.trim();
        }
        return { topicLink: topicLink, topicTitle: topicTitle, forumLink: forumLink, forumName: forumName };
    }

    // ============================================================================
    // BLOG ARTICLE DATA EXTRACTION (NEW)
    // ============================================================================
function getBlogArticleData(articleLi) {
    var postId = getPostId(articleLi);
    var mid = null;
    var userLink = articleLi.querySelector('.who a[href*="MID="]');
    if (userLink) {
        var match = userLink.href.match(/MID=(\d+)/);
        if (match) mid = match[1];
    }
    var username = userLink ? userLink.textContent.trim() : 'Unknown';
    
    var titleLink = articleLi.querySelector('.btitle a');
    var title = titleLink ? titleLink.textContent.trim() : '';
    var permalink = titleLink ? titleLink.getAttribute('href') : '';
    
    var whenSpan = articleLi.querySelector('.when');
    var rawDate = null;
    if (whenSpan) {
        rawDate = whenSpan.getAttribute('title');
    }
    var postDate = parseDateFromTitle(rawDate);
    var absoluteDate = postDate ? postDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
    
    var editInfo = getEditInfo(articleLi);
    
    // ==========================================================================
    // CONTENT EXTRACTION WITH <br> CLEANUP (NEW)
    // ==========================================================================
    var contentDiv = articleLi.querySelector('.center .color');
    var contentHtml = '';
    if (contentDiv) {
        var clone = contentDiv.cloneNode(true);

        // 1. Remove reaction widget and its preceding <br> tags
        var reactionWidget = clone.querySelector('.st-emoji-widget');
        if (reactionWidget) {
            var prev = reactionWidget.previousSibling;
            while (prev) {
                if (prev.nodeType === Node.ELEMENT_NODE && prev.tagName === 'BR') {
                    var toRemove = prev;
                    prev = prev.previousSibling;
                    toRemove.remove();
                } else {
                    break;
                }
            }
            reactionWidget.remove();
        }

        // 2. Remove edit span and its preceding <br> tags
        var editSpan = clone.querySelector('.edit');
        if (editSpan) {
            var prev2 = editSpan.previousSibling;
            while (prev2) {
                if (prev2.nodeType === Node.ELEMENT_NODE && prev2.tagName === 'BR') {
                    var toRemove2 = prev2;
                    prev2 = prev2.previousSibling;
                    toRemove2.remove();
                } else {
                    break;
                }
            }
            editSpan.remove();
        }

        // 3. Remove any trailing <br> at the very end of the clone
        while (clone.lastChild && clone.lastChild.nodeType === Node.ELEMENT_NODE && clone.lastChild.tagName === 'BR') {
            clone.removeChild(clone.lastChild);
        }

        contentHtml = clone.innerHTML.trim();
        contentHtml = transformEmbeddedLinks(contentHtml);
    }
    // ==========================================================================

    // Likes (points)
    var pointsPos = articleLi.querySelector('.points_pos');
    var likes = 0;
    if (pointsPos) {
        likes = parseInt(pointsPos.textContent.replace(/[^0-9]/g,'')) || 0;
    }

    // Reactions preview (top)
    var reactionData = getReactionData(articleLi);
    
    // Comments & views
    var commentsEm = articleLi.querySelector('.replies em');
    var commentsCount = commentsEm ? parseInt(commentsEm.textContent) || 0 : 0;
    var viewsEm = articleLi.querySelector('.views em');
    var viewsCount = viewsEm ? parseInt(viewsEm.textContent) || 0 : 0;
    
    // Available actions
    var availableActions = getAvailableActions(articleLi, postId);
    
    return {
        postId: postId,
        mid: mid,
        username: username,
        title: title,
        permalink: permalink,
        postDate: postDate,
        absoluteDate: absoluteDate,
        contentHtml: contentHtml,
        editInfo: editInfo,
        likes: likes,
        hasReactions: reactionData.hasReactions,
        reactionCount: reactionData.reactionCount,
        reactions: reactionData.reactions,
        commentsCount: commentsCount,
        viewsCount: viewsCount,
        availableActions: availableActions,
        originalPost: articleLi
    };
}

    // ============================================================================
    // GENERATE MODERN BLOG CARD (NEW)
    // ============================================================================
    function generateBlogPost(data, apiUser) {
        var user = apiUser || {};
        var username = data.username;
        var userId = data.mid;
        var isOnline = (user.status === 'online') || false;
        var statusClass = isOnline ? 'online' : 'offline';
        var statusText = isOnline ? 'Online' : 'Offline';
        var profileUrl = userId ? '/?act=Profile&MID=' + userId : '#';
        
        var avatarData = getUserAvatarData(user, username, userId);
        var avatarHtml = '';
        if (avatarData.type === 'img') {
            avatarHtml = '<div class="post-avatar-wrapper">' +
                '<a href="' + profileUrl + '" class="avatar-link" aria-label="Profile of ' + Utils.escapeHtml(username) + '">' +
                '<img class="avatar-circle" src="' + avatarData.url + '" alt="Avatar of ' + Utils.escapeHtml(username) + '" width="' + CONFIG.AVATAR_SIZE + '" height="' + CONFIG.AVATAR_SIZE + '" loading="lazy">' +
                '</a>' +
                '<span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span>' +
                '</div>';
        } else {
            avatarHtml = '<div class="post-avatar-wrapper">' +
                '<a href="' + profileUrl + '" class="avatar-link" aria-label="Profile of ' + Utils.escapeHtml(username) + '">' +
                '<div class="initial-avatar" style="background-color: #' + avatarData.bgColor + ';" data-initial="' + Utils.escapeHtml(avatarData.initial) + '">' + Utils.escapeHtml(avatarData.initial) + '</div>' +
                '</a>' +
                '<span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span>' +
                '</div>';
        }
        
        var groupName = (user.group && user.group.name) ? user.group.name : 'Member';
        var roleClass = 'role-badge';
        var isFounder = user && user.group && (
            (user.group.class && user.group.class.includes('founder')) ||
            (user.group.bodyclass && user.group.bodyclass.includes('founder'))
        );
        if (isFounder) {
            roleClass += ' founder';
            groupName = 'Founder';
        } else if (groupName.toLowerCase() === 'administrator') {
            roleClass += ' admin';
        } else if (groupName.toLowerCase() === 'moderator') {
            roleClass += ' moderator';
        } else if (groupName.toLowerCase() === 'developer') {
            roleClass += ' developer';
        } else {
            roleClass += ' member';
        }
        var groupCssClass = 'group-' + sanitizeGroupName(groupName);
        
        var postCount = (user.messages !== undefined) ? user.messages : 0;
        var reputation = (user.reputation !== undefined) ? user.reputation : 0;
        var joinDateFormatted = '';
        if (user.registration) {
            var joinDate = new Date(user.registration);
            joinDateFormatted = joinDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } else {
            joinDateFormatted = 'Unknown join date';
        }
        
        var editHtml = '';
        if (data.editInfo && data.editInfo.relative) {
            var editDate = data.editInfo.rawDate;
            var isoEdit = editDate ? editDate.toISOString() : '';
            var titleEdit = editDate ? editDate.toLocaleString() : '';
            editHtml = '<div class="post-edit-info">' +
                '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ' +
                'Edited ' +
                '<time datetime="' + isoEdit + '" title="' + Utils.escapeHtml(titleEdit) + '">' +
                    Utils.escapeHtml(data.editInfo.relative) +
                '</time>' +
            '</div>';
        }
        
        var likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '">' +
            '<i class="fa-regular fa-thumbs-up like-icon" aria-hidden="true"></i>';
        if (data.likes > 0) likeButton += '<span class="like-count like-count-display">' + data.likes + '</span>';
        likeButton += '</button>';
        
        var reactionsHtml = generateReactionButtons({
            postId: data.postId,
            hasReactions: data.hasReactions,
            reactionCount: data.reactionCount,
            reactions: data.reactions
        });
        
        var actionsHtml = '';
        if (data.availableActions.quote) {
            actionsHtml += '<button class="action-icon" title="Quote" aria-label="Quote this post" data-action="quote" data-pid="' + data.postId + '"><i class="fa-regular fa-quote-left"></i></button>';
        }
        if (data.availableActions.edit) {
            actionsHtml += '<button class="action-icon" title="Edit" aria-label="Edit this post" data-action="edit" data-pid="' + data.postId + '"><i class="fa-regular fa-pen-to-square"></i></button>';
        }
        if (data.availableActions.share) {
            actionsHtml += '<button class="action-icon" title="Share" aria-label="Share this post" data-action="share" data-pid="' + data.postId + '"><i class="fa-regular fa-share-nodes"></i></button>';
        }
        if (data.availableActions.delete) {
            actionsHtml += '<button class="action-icon delete-action" title="Delete" aria-label="Delete this post" data-action="delete" data-pid="' + data.postId + '"><i class="fa-regular fa-trash-can"></i></button>';
        }
        
        return '<article class="post-card post-card--blog ' + groupCssClass + '" data-original-id="' + CONFIG.POST_ID_PREFIX + data.postId + '" data-post-id="' + data.postId + '">' +
            '<header class="blog-card-header">' +
                '<h1 class="blog-title"><a href="' + Utils.escapeHtml(data.permalink) + '">' + Utils.escapeHtml(data.title) + '</a></h1>' +
                '<div class="blog-meta">' +
                    '<span class="blog-date">' + data.absoluteDate + '</span>' +
                    (actionsHtml ? '<div class="blog-actions top-actions">' + actionsHtml + '</div>' : '') +
                '</div>' +
            '</header>' +
            '<div class="post-card-body">' +
                '<div class="avatar-modern">' + avatarHtml + '</div>' +
                '<div class="post-user-info">' +
                    '<div class="user-name"><a href="' + profileUrl + '" class="user-profile-link">' + Utils.escapeHtml(username) + '</a></div>' +
                    '<div class="user-group"><span class="' + roleClass + '">' + Utils.escapeHtml(groupName) + '</span></div>' +
'<div class="user-stats">' +
    '<div class="user-rank"><i class="fa-regular fa-medal"></i> ' + Utils.escapeHtml(data.userTitle || 'Member') + '</div>' +
    '<div class="user-posts"><i class="fa-regular fa-message"></i> ' + formatNumber(postCount) + ' posts</div>' +
    '<div class="user-reputation"><i class="fa-regular fa-thumbs-up"></i> ' + formatNumber(reputation) + ' rep</div>' +
    '<div class="user-joined"><i class="fa-regular fa-user-plus"></i> ' + joinDateFormatted + '</div>' +
'</div>' +
                '</div>' +
            '</div>' +
            '<div class="post-content">' +
                '<div class="post-message">' + data.contentHtml + editHtml + '</div>' +
            '</div>' +
            '<footer class="post-footer">' +
                '<div class="post-reactions">' + likeButton + reactionsHtml + '</div>' +
            '</footer>' +
        '</article>';
    }

    // ============================================================================
    // EMBEDDED LINK TRANSFORMATION (unchanged)
    // ============================================================================
    function transformEmbeddedLinks(htmlContent) {
        if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        var embedContainers = tempDiv.querySelectorAll('.ffb_embedlink');
        for (var i = 0; i < embedContainers.length; i++) {
            var container = embedContainers[i];
            var modernEmbed = convertToModernEmbed(container);
            if (modernEmbed) container.parentNode.replaceChild(modernEmbed, container);
        }
        return tempDiv.innerHTML;
    }

function convertToModernEmbed(originalContainer) {
    try {
        // 1. Extract favicon from the hidden div (if available)
        var hiddenDiv = originalContainer.querySelector('div[style="display:none"]');
        var faviconUrl = null;
        if (hiddenDiv) {
            var favImg = hiddenDiv.querySelector('img');
            if (favImg && favImg.getAttribute('src')) {
                faviconUrl = favImg.getAttribute('src');
            }
        }

        // 2. The visible part is the second child (index 1)
        var visiblePart = originalContainer.children[1];
        if (!visiblePart) return null;

        // 3. Inside it, the second child is the content div with the title, description, and links
        var contentDiv = visiblePart.children[1];
        if (!contentDiv) contentDiv = visiblePart.children[0]; // fallback

        // 4. Extract preview image (from the first child of visiblePart)
        var previewDiv = visiblePart.children[0];
        var imageUrl = null;
        if (previewDiv) {
            var previewImg = previewDiv.querySelector('img');
            if (previewImg && previewImg.getAttribute('src')) {
                imageUrl = previewImg.getAttribute('src');
            }
        }

        // 5. Title: first <a> inside contentDiv
        var titleLink = contentDiv.querySelector('a');
        var title = titleLink ? titleLink.textContent.trim() : '';
        var mainUrl = titleLink ? titleLink.getAttribute('href') : '';

        // 6. Description: clone content, remove all links, then clean up boilerplate
        var clone = contentDiv.cloneNode(true);
        var allCloneLinks = clone.querySelectorAll('a');
        for (var r = 0; r < allCloneLinks.length; r++) {
            allCloneLinks[r].remove();
        }
        var rawDescription = clone.textContent.trim();
        rawDescription = rawDescription
            .replace(/\s*Leggi altro su\s*/gi, '')
            .replace(/\s*[>›]\s*$/, '')
            .trim();

        // 7. Domain link: the last <a> inside the original contentDiv
        var allLinksInContent = contentDiv.querySelectorAll('a');
        var domainLink = allLinksInContent.length >= 2 ? allLinksInContent[allLinksInContent.length - 1] : null;
        var domainText = '';
        if (domainLink) {
            domainText = domainLink.textContent.trim();
            if (!domainText) domainText = extractDomain(domainLink.getAttribute('href') || '');
        } else {
            domainText = extractDomain(mainUrl); // fallback
        }

        // 8. Ensure we always have a favicon – fallback to Google Favicons API
        if (!faviconUrl) {
            var fallbackDomain = domainLink ? extractDomain(domainLink.getAttribute('href') || '') : extractDomain(mainUrl);
            if (fallbackDomain) {
                faviconUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(fallbackDomain) + '&sz=32';
            }
        }

        // Extract site name: remove "www." and everything after the first dot
        var siteName = domainText.replace(/^www\./i, '').split('.')[0];

        // 9. Build modern embed HTML
        var modernHtml = '<div class="modern-embedded-link">' +
            '<a href="' + Utils.escapeHtml(mainUrl) + '" class="embedded-link-container" target="_blank" rel="noopener noreferrer" title="' + Utils.escapeHtml(title) + '">';

        if (imageUrl) {
            modernHtml += '<div class="embedded-link-image"><img src="' + imageUrl + '" alt="' + Utils.escapeHtml(title) + '" loading="lazy" decoding="async" style="max-width:100%;object-fit:cover;display:block;"></div>';
        }

        modernHtml += '<div class="embedded-link-content">';
        modernHtml += '<h3 class="embedded-link-title">' + Utils.escapeHtml(title) + '</h3>';

        if (rawDescription) {
            modernHtml += '<p class="embedded-link-description">' + Utils.escapeHtml(rawDescription) + '</p>';
        }

        // "Read more" line – always show favicon as background + site name
        modernHtml += '<div class="embedded-link-meta"><span class="embedded-link-read-more" style="';
        modernHtml += 'background-image:url(' + faviconUrl + ');background-repeat:no-repeat;background-position:left center;background-size:16px 16px;padding-left:22px;display:inline;';
        modernHtml += '">' + Utils.escapeHtml(siteName) + '</span></div>';

        modernHtml += '</div></a></div>';

        return createElementFromHTML(modernHtml);
    } catch(e) { return null; }
}
    
    function extractDomain(url) {
        try {
            var a = document.createElement('a');
            a.href = url;
            var hostname = a.hostname;
            if (hostname.startsWith('www.')) hostname = hostname.substring(4);
            return hostname;
        } catch(e) { return url.split('/')[2] || url; }
    }

    function createElementFromHTML(htmlString) {
        var div = document.createElement('div');
        div.innerHTML = htmlString.trim();
        return div.firstChild;
    }

    // ============================================================================
    // REACTION POPUP (unchanged)
    // ============================================================================
    function getAvailableReactions(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return Promise.resolve([]);
        var emojiContainer = originalPost.querySelector('.st-emoji-container');
        if (!emojiContainer) return Promise.resolve([]);
        var previewTrigger = emojiContainer.querySelector('.st-emoji-preview');
        if (!previewTrigger) return Promise.resolve([]);
        var originalDisplay = previewTrigger.style.display;
        previewTrigger.style.display = 'block';
        previewTrigger.click();
        previewTrigger.style.display = originalDisplay;
        return new Promise(function(resolve) {
            setTimeout(function() {
                var originalPopup = document.querySelector('.st-emoji-pop');
                var emojis = [];
                if (originalPopup) {
                    var reactionElements = originalPopup.querySelectorAll('.st-emoji-content');
                    for (var i = 0; i < reactionElements.length; i++) {
                        var el = reactionElements[i];
                        var dataFui = el.getAttribute('data-fui');
                        var img = el.querySelector('img');
                        var imgSrc = img ? img.getAttribute('src') : '';
                        var imgAlt = img ? img.getAttribute('alt') : '';
                        var name = dataFui ? dataFui.replace(/:/g, '') : '';
                        if (!name && imgAlt) name = imgAlt.replace(/:/g, '');
                        emojis.push({
                            name: name,
                            alt: dataFui || imgAlt,
                            src: imgSrc,
                            rid: el.getAttribute('data-rid')
                        });
                    }
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
        if (activePopup) { activePopup.remove(); activePopup = null; }
        var buttonRect = buttonElement.getBoundingClientRect();
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (originalPost) {
            var emojiContainer = originalPost.querySelector('.st-emoji-container');
            if (emojiContainer) {
                var previewTrigger = emojiContainer.querySelector('.st-emoji-preview');
                if (previewTrigger) {
                    var originalDisplay = previewTrigger.style.display;
                    previewTrigger.style.display = 'block';
                    previewTrigger.click();
                    previewTrigger.style.display = originalDisplay;
                }
            }
        }
        var loadingPopup = document.createElement('div');
        loadingPopup.className = 'custom-reaction-popup loading';
        loadingPopup.style.cssText = 'position:fixed;z-index:100000;background:#1a1a1a;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);padding:20px;border:1px solid #333;left:' + (buttonRect.left - 50) + 'px;top:' + (buttonRect.bottom + 10) + 'px;color:white;font-size:14px;';
        loadingPopup.textContent = 'Loading reactions...';
        document.body.appendChild(loadingPopup);
        setTimeout(function() {
            var originalPopup = document.querySelector('.st-emoji-pop');
            var emojis = [];
            if (originalPopup) {
                var reactionElements = originalPopup.querySelectorAll('.st-emoji-content');
                for (var i = 0; i < reactionElements.length; i++) {
                    var el = reactionElements[i];
                    var dataFui = el.getAttribute('data-fui');
                    var img = el.querySelector('img');
                    var imgSrc = img ? img.getAttribute('src') : '';
                    var imgAlt = img ? img.getAttribute('alt') : '';
                    var name = dataFui ? dataFui.replace(/:/g, '') : '';
                    if (!name && imgAlt) name = imgAlt.replace(/:/g, '');
                    emojis.push({ name: name, alt: dataFui || imgAlt, src: imgSrc, rid: el.getAttribute('data-rid') });
                }
            }
            loadingPopup.remove();
            if (emojis.length === 0) emojis = getDefaultEmojis();
            var popup = document.createElement('div');
            popup.className = 'custom-reaction-popup';
            popup.style.cssText = 'position:fixed;z-index:100001;background:#1a1a1a;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);padding:12px;border:1px solid #333;left:' + (buttonRect.left - 100) + 'px;top:' + (buttonRect.bottom + 10) + 'px;';
            var emojiGrid = document.createElement('div');
            emojiGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px;';
            emojis.forEach(function(emoji) {
                var emojiItem = document.createElement('div');
                emojiItem.className = 'custom-emoji-item';
                emojiItem.style.cssText = 'cursor:pointer;padding:8px;text-align:center;border-radius:8px;transition:background 0.2s;';
                var img = document.createElement('img');
                if (emoji.src) img.src = emoji.src;
                else img.src = 'https://images.weserv.nl/?url=https://upload.forumfree.net/i/fc11517378/emojis/' + encodeURIComponent(emoji.name) + '.png&output=webp&maxage=1y&q=90&il&af&l=9';
                img.alt = emoji.alt || ':' + emoji.name + ':';
                img.style.cssText = 'width:32px;height:32px;object-fit:contain;';
                img.loading = 'lazy';
                img.onerror = function() { if (!this.src.includes('twemoji')) this.src = 'https://twemoji.maxcdn.com/v/latest/svg/1f606.svg'; };
                emojiItem.appendChild(img);
                emojiItem.addEventListener('mouseenter', function() { this.style.backgroundColor = '#333'; });
                emojiItem.addEventListener('mouseleave', function() { this.style.backgroundColor = 'transparent'; });
                emojiItem.addEventListener('click', function() {
                    var originalPopup = document.querySelector('.st-emoji-pop');
                    if (originalPopup) {
                        var reactionElements = originalPopup.querySelectorAll('.st-emoji-content');
                        var found = false;
                        for (var i = 0; i < reactionElements.length; i++) {
                            var el = reactionElements[i];
                            var dataFui = el.getAttribute('data-fui');
                            var img = el.querySelector('img');
                            var imgAlt = img ? img.getAttribute('alt') : '';
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
                    setTimeout(function() { refreshReactionDisplay(postId); }, CONFIG.REACTION_DELAY);
                });
                emojiGrid.appendChild(emojiItem);
            });
            popup.appendChild(emojiGrid);
            var closeHandler = function(e) { if (!popup.contains(e.target) && !e.target.closest('.reaction-btn')) { popup.remove(); activePopup = null; document.removeEventListener('click', closeHandler); } };
            setTimeout(function() { document.addEventListener('click', closeHandler); }, 100);
            document.body.appendChild(popup);
            activePopup = popup;
        }, 200);
    }

    function handleReactionCountClick(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var emojiContainer = originalPost.querySelector('.st-emoji-container');
        if (!emojiContainer) return;
        var counter = emojiContainer.querySelector('.st-emoji-counter');
        if (!counter) return;
        var originalVisibility = counter.style.visibility;
        var originalOpacity = counter.style.opacity;
        var originalPosition = counter.style.position;
        counter.style.visibility = 'visible';
        counter.style.opacity = '1';
        counter.style.position = 'relative';
        counter.style.zIndex = '9999';
        counter.click();
        setTimeout(function() {
            counter.style.visibility = originalVisibility;
            counter.style.opacity = originalOpacity;
            counter.style.position = originalPosition;
        }, 500);
    }

    // ============================================================================
    // REACTION BUTTONS HTML
    // ============================================================================
    function generateReactionButtons(data) {
        if (!data.hasReactions || data.reactionCount === 0) {
            return '<button class="reaction-btn reaction-add-btn" aria-label="Add a reaction" data-pid="' + data.postId + '">' +
                '<i class="fa-regular fa-face-smile" aria-hidden="true"></i></button>';
        }
        var reactionMap = new Map();
        for (var i = 0; i < data.reactions.length; i++) {
            var r = data.reactions[i];
            var src = r.src;
            if (reactionMap.has(src)) reactionMap.get(src).count++;
            else reactionMap.set(src, { src: src, alt: r.alt, name: r.name, count: 1 });
        }
        var html = '<div class="reactions-container" data-pid="' + data.postId + '">';
        reactionMap.forEach(function(r) {
            html += '<button class="reaction-btn reaction-with-image" title="' + Utils.escapeHtml(r.name || 'Reaction') + '" data-pid="' + data.postId + '">' +
                '<img src="' + r.src + '" alt="' + Utils.escapeHtml(r.alt || 'reaction') + '" width="18" height="18" loading="lazy">' +
                '<span class="reaction-count">' + r.count + '</span></button>';
        });
        html += '</div>';
        return html;
    }

    function sanitizeGroupName(groupName) {
        if (!groupName) return 'unknown';
        return groupName.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    // ============================================================================
    // GENERATE MODERN CARD (regular post, unchanged)
    // ============================================================================
    function formatNumber(num) {
        if (!num && num !== 0) return '0';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function generateModernPost(data) {
        if (!data) return '';
        var user = data.apiUser;
        var username = data.username;
        var userId = data.mid;
        var isOnline = (user && user.status === 'online') || data.isOnline || false;
        var statusClass = isOnline ? 'online' : 'offline';
        var statusText = isOnline ? 'Online' : 'Offline';
        
        // Profile URL
        var profileUrl = userId ? '/?act=Profile&MID=' + userId : '#';
        
        var avatarData = getUserAvatarData(user, username, userId);
        var avatarHtml = '';
        if (avatarData.type === 'img') {
            avatarHtml = '<div class="post-avatar-wrapper">' +
                '<a href="' + profileUrl + '" class="avatar-link" aria-label="Profile of ' + Utils.escapeHtml(username) + '">' +
                '<img class="avatar-circle" src="' + avatarData.url + '" alt="Avatar of ' + Utils.escapeHtml(username) + '" width="' + CONFIG.AVATAR_SIZE + '" height="' + CONFIG.AVATAR_SIZE + '" loading="lazy">' +
                '</a>' +
                '<span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span>' +
                '</div>';
        } else {
            avatarHtml = '<div class="post-avatar-wrapper">' +
                '<a href="' + profileUrl + '" class="avatar-link" aria-label="Profile of ' + Utils.escapeHtml(username) + '">' +
                '<div class="initial-avatar" style="background-color: #' + avatarData.bgColor + ';" data-initial="' + Utils.escapeHtml(avatarData.initial) + '">' + Utils.escapeHtml(avatarData.initial) + '</div>' +
                '</a>' +
                '<span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span>' +
                '</div>';
        }
        
        var groupName = (user && user.group && user.group.name) ? user.group.name : (data.groupText || 'Member');
        var roleClass = 'role-badge';
        var isFounder = user && user.group && (
            (user.group.class && user.group.class.includes('founder')) ||
            (user.group.bodyclass && user.group.bodyclass.includes('founder'))
        );
        if (isFounder) {
            roleClass += ' founder';
            groupName = 'Founder';
        } else if (groupName.toLowerCase() === 'administrator') {
            roleClass += ' admin';
        } else if (groupName.toLowerCase() === 'moderator') {
            roleClass += ' moderator';
        } else if (groupName.toLowerCase() === 'developer') {
            roleClass += ' developer';
        } else {
            roleClass += ' member';
        }
        
        var groupCssClass = 'group-' + sanitizeGroupName(groupName);
        
        var postCount = (user && typeof user.messages !== 'undefined') ? user.messages : data.postCount;
        var reputation = (user && typeof user.reputation !== 'undefined') ? user.reputation : data.reputation;
        var joinDateFormatted = '';
        if (user && user.registration) {
            var date = new Date(user.registration);
            joinDateFormatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } else {
            joinDateFormatted = 'Unknown join date';
        }
        
        var likeButton = '';
        if (!data.hideFooter) {
            likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '">' +
                '<i class="fa-regular fa-thumbs-up like-icon" aria-hidden="true"></i>';
            if (data.likes > 0) likeButton += '<span class="like-count like-count-display">' + data.likes + '</span>';
            likeButton += '</button>';
        }
        
        var reactionsHtml = '';
        if (!data.isMemberPostsPage && !data.hideFooter) {
            reactionsHtml = generateReactionButtons({
                postId: data.postId,
                hasReactions: data.hasReactions,
                reactionCount: data.reactionCount,
                reactions: data.reactions
            });
        }
        
        var editHtml = '';
        if (data.editInfo && data.editInfo.relative) {
            var editDate = data.editInfo.rawDate;
            var isoEdit = editDate ? editDate.toISOString() : '';
            var titleEdit = editDate ? editDate.toLocaleString() : '';
            editHtml = '<div class="post-edit-info">' +
                '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ' +
                    'Edited ' +
                    '<time datetime="' + isoEdit + '" title="' + Utils.escapeHtml(titleEdit) + '">' +
                        Utils.escapeHtml(data.editInfo.relative) +
                    '</time>' +
            '</div>';
        }
        
        var signatureHtml = data.signatureHtml ? '<div class="post-signature">' + data.signatureHtml + '</div>' : '';
        var ipHtml = data.ipAddress ? '<div class="post-ip">IP: ' + data.ipAddress + '</div>' : '';
        
        var postTimeHtml = '<div class="post-time">' +
            '<time datetime="' + (data.postDate ? data.postDate.toISOString() : '') + '">' +
            Utils.escapeHtml(data.relativeTime) +
            '</time>' +
            '</div>';
        
        var actionsHtml = '';
        if (!data.hideActions && !data.isMemberPostsPage) {
            if (data.availableActions && data.availableActions.quote) {
                actionsHtml += '<button class="action-icon" title="Quote" aria-label="Quote this post" data-action="quote" data-pid="' + data.postId + '"><i class="fa-regular fa-quote-left"></i></button>';
            }
            if (data.availableActions && data.availableActions.edit) {
                actionsHtml += '<button class="action-icon" title="Edit" aria-label="Edit this post" data-action="edit" data-pid="' + data.postId + '"><i class="fa-regular fa-pen-to-square"></i></button>';
            }
            if (data.availableActions && data.availableActions.share) {
                actionsHtml += '<button class="action-icon" title="Share" aria-label="Share this post" data-action="share" data-pid="' + data.postId + '"><i class="fa-regular fa-share-nodes"></i></button>';
            }
            if (data.availableActions && data.availableActions.report) {
                actionsHtml += '<button class="action-icon report-action" title="Report" aria-label="Report this post" data-action="report" data-pid="' + data.postId + '"><i class="fa-regular fa-circle-exclamation"></i></button>';
            }
            if (data.availableActions && data.availableActions.delete) {
                actionsHtml += '<button class="action-icon delete-action" title="Delete" aria-label="Delete this post" data-action="delete" data-pid="' + data.postId + '"><i class="fa-regular fa-trash-can"></i></button>';
            }
        }
        
        var memberActionsHtml = '';
        if (data.isMemberPostsPage && (data.topicLink || data.forumLink)) {
            memberActionsHtml = '<div class="post-member-actions">';
            if (data.topicLink) {
                memberActionsHtml += '<button class="action-icon member-topic-link" title="Go to topic" aria-label="Go to topic" data-topic-url="' + Utils.escapeHtml(data.topicLink) + '">' +
                    '<i class="fa-regular fa-message" aria-hidden="true"></i>' +
                    '</button>';
            }
            if (data.forumLink) {
                memberActionsHtml += '<button class="action-icon member-forum-link" title="Go to forum" aria-label="Go to forum" data-forum-url="' + Utils.escapeHtml(data.forumLink) + '">' +
                    '<i class="fa-regular fa-folder" aria-hidden="true"></i>' +
                    '</button>';
            }
            memberActionsHtml += '</div>';
        }
        
        var statsHtml = '<div class="user-rank"><i class="' + (data.rankIconClass || 'fa-medal fa-regular') + '" aria-hidden="true"></i> ' + (data.userTitle || 'Member') + '</div>' +
            '<div class="user-posts"><i class="fa-regular fa-message"></i> ' + formatNumber(postCount) + ' posts</div>';
        if (!data.isMemberPostsPage) {
            statsHtml += '<div class="user-reputation"><i class="fa-regular fa-thumbs-up"></i> ' + formatNumber(reputation) + ' rep</div>';
        }
        statsHtml += '<div class="user-joined"><i class="fa-regular fa-user-plus"></i> ' + joinDateFormatted + '</div>';
        
        var headerActionsHtml = (actionsHtml !== '') ? '<div class="post-actions">' + actionsHtml + '</div>' : '';
        
        var footerHtml = '';
        if (!data.hideFooter) {
            footerHtml = '<footer class="post-footer">' +
                '<div class="post-reactions">' + likeButton + reactionsHtml + '</div>' +
                memberActionsHtml +
                ipHtml +
            '</footer>';
        }
        
        return '<article class="post-card ' + groupCssClass + '" data-original-id="' + CONFIG.POST_ID_PREFIX + data.postId + '" data-post-id="' + data.postId + '" aria-labelledby="post-title-' + data.postId + '">' +
            '<header class="post-card-header">' +
                '<div class="post-meta">' +
                    '<div class="post-number"><i class="fa-regular fa-hashtag" aria-hidden="true"></i> ' + data.postNumber + '</div>' +
                    postTimeHtml +
                '</div>' +
                headerActionsHtml +
            '</header>' +
            '<div class="post-card-body">' +
                '<div class="avatar-modern">' + avatarHtml + '</div>' +
                '<div class="post-user-info">' +
                    '<div class="user-name"><a href="' + profileUrl + '" class="user-profile-link">' + Utils.escapeHtml(username) + '</a></div>' +
                    '<div class="user-group"><span class="' + roleClass + '">' + Utils.escapeHtml(groupName) + '</span></div>' +
                    '<div class="user-stats">' + statsHtml + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="post-content">' +
                '<div class="post-message">' + data.contentHtml + editHtml + '</div>' +
                signatureHtml +
            '</div>' +
            footerHtml +
        '</article>';
    }

    // ============================================================================
    // FAVICON INJECTION FOR TEXT-ONLY LINKS IN POST-MESSAGE
    // ============================================================================
    function applyFaviconsToMessageLinks(container) {
        if (!container) return;
        // select all links inside .post-message that don't already have a favicon
        var links = container.querySelectorAll('.post-message a[href]:not(.has-favicon)');
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            // skip if link contains an image (e.g., thumbnail)
            if (link.querySelector('img')) continue;
            try {
                var urlObj = new URL(link.href);
                var domain = urlObj.hostname;
                var faviconUrl = 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=32';

                link.style.backgroundImage = 'url(' + faviconUrl + ')';
                link.style.backgroundRepeat = 'no-repeat';
                link.style.backgroundPosition = 'left center';
                link.style.backgroundSize = '16px 16px';
                link.style.paddingLeft = '22px';   // 16px icon + 6px gap
                link.style.display = 'inline';      // ensure inline flow
                link.classList.add('has-favicon');
            } catch (e) {
                // invalid href – skip
            }
        }
    }

    // ============================================================================
    // REFRESH FUNCTIONS (unchanged)
    // ============================================================================
    function refreshLikeDisplay(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return;
        var pointsPos = originalPost.querySelector('.points .points_pos');
        var newLikeCount = pointsPos ? parseInt(pointsPos.textContent) || 0 : 0;
        var modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) return;
        var likeBtn = modernCard.querySelector('.like-btn');
        if (!likeBtn) return;
        var likeCountSpan = likeBtn.querySelector('.like-count-display');
        if (newLikeCount > 0) {
            if (likeCountSpan) likeCountSpan.textContent = newLikeCount;
            else {
                var newSpan = document.createElement('span');
                newSpan.className = 'like-count like-count-display';
                newSpan.textContent = newLikeCount;
                likeBtn.appendChild(newSpan);
            }
        } else {
            if (likeCountSpan) likeCountSpan.remove();
        }
    }

    function refreshReactionDisplay(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return;
        var reactionData = getReactionData(originalPost);
        var modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) return;
        var postReactionsDiv = modernCard.querySelector('.post-reactions');
        if (!postReactionsDiv) return;
        if (reactionData.reactions.length > 0) postReactions.set(postId, reactionData.reactions);
        var likeButton = postReactionsDiv.querySelector('.like-btn');
        var likeButtonHtml = likeButton ? likeButton.outerHTML : '';
        var newReactionsHtml = generateReactionButtons({
            postId: postId,
            hasReactions: reactionData.hasReactions,
            reactionCount: reactionData.reactionCount,
            reactions: reactionData.reactions
        });
        if (likeButtonHtml) postReactionsDiv.innerHTML = likeButtonHtml + newReactionsHtml;
        else postReactionsDiv.innerHTML = newReactionsHtml;
    }

    // ============================================================================
    // EVENT HANDLERS – unchanged
    // ============================================================================
    function handleQuote(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var quoteLink = originalPost.querySelector('a[href*="CODE=02"]');
        if (quoteLink) window.location.href = quoteLink.getAttribute('href');
    }

    function handleEdit(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var editLink = originalPost.querySelector('a[href*="CODE=08"]');
        if (editLink) window.location.href = editLink.getAttribute('href');
    }

    function handleDelete(pid) {
        if (confirm('Are you sure you want to delete this post?')) {
            if (typeof window.delete_post === 'function') window.delete_post(pid);
            else {
                var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
                if (originalPost) {
                    var deleteLink = originalPost.querySelector('a[onclick*="delete_post"], .deletepost, a[href*="CODE=09"]');
                    if (deleteLink) deleteLink.click();
                }
            }
        }
    }

    function handleShare(pid, buttonElement) {
        var url = window.location.href.split('#')[0] + '#entry' + pid;
        navigator.clipboard.writeText(url).then(function() {
            var originalHtml = buttonElement.innerHTML;
            buttonElement.innerHTML = '<i class="fa-regular fa-check" aria-hidden="true"></i>';
            setTimeout(function() { buttonElement.innerHTML = originalHtml; }, 1500);
        }).catch(function(err) { console.error('Copy failed:', err); });
    }

    function handleReport(pid) {
        var reportBtn = document.getElementById(CONFIG.POST_ID_PREFIX + pid + ' .report_button');
        if (!reportBtn) reportBtn = document.querySelector('.report_button[data-pid="' + pid + '"]');
        if (reportBtn) reportBtn.click();
    }

    function handleLike(pid, isCountClick) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var pointsContainer = originalPost.querySelector('.points');
        if (!pointsContainer) return;
        if (isCountClick) {
            var pointsPos = pointsContainer.querySelector('.points_pos');
            if (pointsPos) {
                var overlayLink = pointsPos.closest('a[rel="#overlay"]');
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
                        var mouseoverEvent = new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true });
                        overlayLink.dispatchEvent(mouseoverEvent);
                        setTimeout(function() {
                            var clickEvent = new MouseEvent('click', { view: window, bubbles: true, cancelable: true });
                            overlayLink.dispatchEvent(clickEvent);
                        }, 50);
                        return;
                    }
                }
            }
            var pointsPosDirect = pointsContainer.querySelector('.points_pos');
            if (pointsPosDirect) { pointsPosDirect.click(); return; }
            var anyLink = pointsContainer.querySelector('a[href*="votes"]');
            if (anyLink) { anyLink.click(); return; }
            return;
        }
        var undoButton = pointsContainer.querySelector('.bullet_delete');
        if (undoButton) {
            var undoOnclick = undoButton.getAttribute('onclick');
            if (undoOnclick) eval(undoOnclick);
            else undoButton.click();
        } else {
            var likeBtn = pointsContainer.querySelector('.points_up');
            if (likeBtn) {
                if (likeBtn.tagName === 'A') {
                    var likeOnclick = likeBtn.getAttribute('onclick');
                    if (likeOnclick) eval(likeOnclick);
                    else likeBtn.click();
                } else {
                    var onclickAttr = likeBtn.getAttribute('onclick');
                    if (onclickAttr) eval(onclickAttr);
                    else likeBtn.click();
                }
            } else {
                var pointsUpLink = pointsContainer.querySelector('a[href*="points_up"], a[onclick*="points_up"]');
                if (pointsUpLink) {
                    var upOnclick = pointsUpLink.getAttribute('onclick');
                    if (upOnclick) eval(upOnclick);
                    else pointsUpLink.click();
                }
            }
        }
        setTimeout(function() { refreshLikeDisplay(pid); refreshReactionDisplay(pid); }, CONFIG.REACTION_DELAY);
    }

    function handleReact(pid, buttonElement) {
        createCustomReactionPopup(buttonElement, pid);
    }

    function attachEventHandlers() {
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="quote"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleQuote(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="edit"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleEdit(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="delete"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleDelete(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="share"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleShare(pid, btn); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="report"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleReport(pid); }
        });
        document.addEventListener('click', function(e) {
            var topicBtn = e.target.closest('.member-topic-link');
            if (topicBtn) {
                e.preventDefault();
                var url = topicBtn.getAttribute('data-topic-url');
                if (url) window.location.href = url;
            }
        });
        document.addEventListener('click', function(e) {
            var forumBtn = e.target.closest('.member-forum-link');
            if (forumBtn) {
                e.preventDefault();
                var url = forumBtn.getAttribute('data-forum-url');
                if (url) window.location.href = url;
            }
        });
        document.addEventListener('click', function(e) {
            var likeBtn = e.target.closest('.like-btn');
            if (likeBtn) { e.preventDefault(); var pid = likeBtn.getAttribute('data-pid'); if (pid) handleLike(pid, e.target.classList && e.target.classList.contains('like-count-display')); }
        });
        document.addEventListener('click', function(e) {
            var reactionCount = e.target.closest('.reaction-count');
            if (reactionCount) {
                e.preventDefault(); e.stopPropagation();
                var reactionBtn = reactionCount.closest('.reaction-btn');
                if (reactionBtn) { var pid = reactionBtn.getAttribute('data-pid'); if (pid) handleReactionCountClick(pid); }
            }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.reaction-btn:not(.like-btn)');
            if (btn && !e.target.classList.contains('reaction-count')) {
                e.preventDefault(); e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleReact(pid, btn);
            }
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && activePopup) { activePopup.remove(); activePopup = null; }
        });
    }

    // ============================================================================
    // MAIN CONVERSION PIPELINE (blog article + regular posts)
    // ============================================================================
async function convertAllPosts() {
    if (conversionInProgress) {
        conversionPending = true;
        return;
    }

    conversionInProgress = true;
    conversionPending = false;

    try {
        var container = getPostsContainer();
        if (container) container.innerHTML = '';
        convertedPostIds.clear();
        postReactions.clear();

        // Convert ALL blog articles (there may be more than one)
        var blogArticles = document.querySelectorAll('.blog .article');
        var blogCount = 0;
        var allMids = [];

        if (blogArticles.length > 0) {
            for (var a = 0; a < blogArticles.length; a++) {
                var articleLi = blogArticles[a];
                var blogData = getBlogArticleData(articleLi);
                if (blogData.postId && convertedPostIds.has(blogData.postId)) continue;

                if (blogData.mid) allMids.push(blogData.mid);
                var apiUser = null;
                if (blogData.mid) {
                    await fetchUserData(blogData.mid);
                    apiUser = userDataCache.get(blogData.mid);
                }

                var blogCardHtml = generateBlogPost(blogData, apiUser);
                var temp = document.createElement('div');
                temp.innerHTML = blogCardHtml;
                var blogCard = temp.firstElementChild;
                container.appendChild(blogCard);
                applyFaviconsToMessageLinks(blogCard);

                if (blogData.postId) convertedPostIds.add(blogData.postId);
                blogCount++;
            }
        }

        // Collect regular posts (comments)
        var posts = Utils.getAllElements(CONFIG.POST_SELECTOR);
        var validPosts = [];
        for (var i = 0; i < posts.length; i++) {
            if (isValidPost(posts[i])) validPosts.push(posts[i]);
        }

        var globalMid = null;
        var globalUsername = null;
        var isMemberPostsPage = false;
        var memberPostsHeader = document.querySelector('.topic.member_posts .mtitle b');
        if (memberPostsHeader) {
            isMemberPostsPage = true;
            var classNames = memberPostsHeader.className;
            var match = classNames.match(/user(\d+)/);
            if (match) {
                globalMid = match[1];
            } else {
                var onclickAttr = memberPostsHeader.getAttribute('onclick');
                if (onclickAttr) {
                    var midMatch = onclickAttr.match(/MID=(\d+)/);
                    if (midMatch) globalMid = midMatch[1];
                }
            }
            globalUsername = memberPostsHeader.textContent.trim();
        }

        var mids = [];
        var postsData = [];
        for (var i = 0; i < validPosts.length; i++) {
            var $post = validPosts[i];
            var postId = getPostId($post);
            if (!postId || convertedPostIds.has(postId)) continue;
            var mid = getMidFromPost($post);
            if (!mid && globalMid) mid = globalMid;
            mids.push(mid);
            var reactionData = getReactionData($post);
            var userTitleData = getUserTitleAndIcon($post);
            if (reactionData.hasReactions) postReactions.set(postId, reactionData.reactions);
            var whenSpan = $post.querySelector('.when');
            var postPermalink = null;
            var postDate = null;
            if (whenSpan) {
                var anchor = whenSpan.closest('a');
                if (anchor && anchor.getAttribute('href')) postPermalink = anchor.getAttribute('href');
                var title = whenSpan.getAttribute('title');
                if (title) postDate = parseDateFromTitle(title);
                else {
                    var text = whenSpan.textContent.trim();
                    text = text.replace(/^Posted:\s*/i, '');
                    if (text) postDate = parseDateFromTitle(text);
                }
            }
            var relativeTime = postDate ? getRelativeTimeString(postDate) : 'Recently';
            var editInfo = getEditInfo($post);
            var availableActions = getAvailableActions($post, postId);
            if (isMemberPostsPage) {
                availableActions.quote = false;
                availableActions.edit = false;
                availableActions.delete = false;
                availableActions.report = false;
                availableActions.share = false;
            }
            var memberLinks = isMemberPostsPage ? getMemberPostLinks($post) : { topicLink: null, topicTitle: null, forumLink: null, forumName: null };
            var username = getUsername($post);
            if (username === 'Unknown' && globalUsername) username = globalUsername;
            postsData.push({
                postId: postId,
                mid: mid,
                originalPost: $post,
                index: i,
                username: username,
                groupText: getGroupText($post),
                postCount: getPostCount($post),
                reputation: getReputation($post),
                isOnline: getIsOnline($post),
                userTitle: userTitleData.title,
                rankIconClass: userTitleData.iconClass,
                contentHtml: getCleanContent($post),
                signatureHtml: getSignatureHtml($post),
                editInfo: editInfo,
                likes: getLikes($post),
                hasReactions: reactionData.hasReactions,
                reactionCount: reactionData.reactionCount,
                reactions: reactionData.reactions,
                ipAddress: getMaskedIp($post),
                relativeTime: relativeTime,
                postDate: postDate,
                postPermalink: postPermalink,
                availableActions: availableActions,
                isMemberPostsPage: isMemberPostsPage,
                topicLink: memberLinks.topicLink,
                topicTitle: memberLinks.topicTitle,
                forumLink: memberLinks.forumLink,
                forumName: memberLinks.forumName,
                hideActions: false,
                hideFooter: false
            });
            convertedPostIds.add(postId);
        }
        await fetchMultipleUsers(mids);
        for (var i = 0; i < postsData.length; i++) {
            var data = postsData[i];
            var apiUser = data.mid ? userDataCache.get(data.mid) : null;
            var completeData = Object.assign({}, data, { apiUser: apiUser, postNumber: i + 1 + blogCount });
            var cardHtml = generateModernPost(completeData);
            var temp = document.createElement('div');
            temp.innerHTML = cardHtml;
            var card = temp.firstElementChild;
            container.appendChild(card);
            applyFaviconsToMessageLinks(card);
        }
        attachEventHandlers();
        if (EventBus) EventBus.trigger('posts:ready', { count: postsData.length + blogCount });
        console.log('[PostsModule] Ready - ' + (postsData.length + blogCount) + ' posts converted');
    } catch (err) {
        console.error('[PostsModule] Conversion error:', err);
    } finally {
        conversionInProgress = false;
        if (conversionPending) {
            convertAllPosts();
        }
    }
}

    // ============================================================================
    // SUMMARY CONVERSION (unchanged)
    // ============================================================================
    async function convertSummaryPosts() {
        if (document.body.id !== 'send') return;
        var summaryEl = document.querySelector('.summary');
        if (!summaryEl) return;
        var container = document.getElementById('modern-summary-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'modern-summary-container';
            container.className = 'modern-posts-container';
            var wrapper = document.getElementById('modern-forum-wrapper');
            if (wrapper) wrapper.appendChild(container);
            else document.body.appendChild(container);
        } else {
            container.innerHTML = '';
        }
        var header = document.createElement('div');
        header.className = 'summary-header modern-section-header';
        header.innerHTML = `
            <div class="summary-header-content">
                <i class="fa-regular fa-clock" aria-hidden="true"></i>
                <h3>Latest posts <span class="summary-subtitle">(last 10, newest first)</span></h3>
            </div>
        `;
        container.appendChild(header);
        var listItems = summaryEl.querySelectorAll('.list > li');
        if (!listItems.length) return;
        var mids = [];
        var postsData = [];
        for (var i = 0; i < listItems.length; i++) {
            var li = listItems[i];
            var nickLink = li.querySelector('.nick a');
            if (!nickLink) continue;
            var username = nickLink.textContent.trim();
            var midMatch = nickLink.href.match(/MID=(\d+)/);
            var mid = midMatch ? midMatch[1] : null;
            mids.push(mid);
            var groupName = 'Member';
            var classNames = li.className;
            if (classNames.includes('box_founder')) groupName = 'Founder';
            else if (classNames.includes('box_amministratore')) groupName = 'Administrator';
            else if (classNames.includes('box_moderatore')) groupName = 'Moderator';
            var whenSpan = li.querySelector('.when');
            var postDate = null;
            if (whenSpan) {
                var title = whenSpan.getAttribute('title');
                if (title) postDate = parseDateFromTitle(title);
                else {
                    var text = whenSpan.textContent.trim();
                    text = text.replace(/^Posted\s*/i, '');
                    postDate = parseDateFromTitle(text);
                }
            }
            var relativeTime = postDate ? getRelativeTimeString(postDate) : 'Recently';
            var contentDiv = li.querySelector('.color.Item');
            var contentHtml = '';
            if (contentDiv) {
                var clone = contentDiv.cloneNode(true);
                var sig = clone.querySelector('.signature');
                if (sig) sig.remove();
                var editSpan = clone.querySelector('.edit');
                if (editSpan) editSpan.remove();
                var tempHtml = clone.innerHTML;
                tempHtml = transformEmbeddedLinks(tempHtml);
                contentHtml = tempHtml;
            }
            postsData.push({
                postId: 'summary_' + i,
                mid: mid,
                username: username,
                groupText: groupName,
                contentHtml: contentHtml,
                relativeTime: relativeTime,
                postDate: postDate,
                isSummary: true,
                hideActions: true,
                hideFooter: true,
                postNumber: i + 1,
                postCount: '0',
                reputation: '0',
                isOnline: false,
                userTitle: 'Member',
                rankIconClass: 'fa-medal fa-regular',
                likes: 0,
                hasReactions: false,
                reactionCount: 0,
                reactions: [],
                availableActions: {}
            });
        }
        if (!mids.length) return;
        await fetchMultipleUsers(mids);
        for (var i = 0; i < postsData.length; i++) {
            var data = postsData[i];
            var apiUser = data.mid ? userDataCache.get(data.mid) : null;
            var completeData = Object.assign({}, data, { apiUser: apiUser });
            var cardHtml = generateModernPost(completeData);
            var temp = document.createElement('div');
            temp.innerHTML = cardHtml;
            var card = temp.firstElementChild;
            container.appendChild(card);
            applyFaviconsToMessageLinks(card);
        }
        console.log('[PostsModule] Summary conversion ready - ' + postsData.length + ' posts displayed with favicons');
    }

    // ============================================================================
    // INITIALIZE
    // ============================================================================
function initialize() {
    if (isInitialized) { return Promise.resolve(); }  // already done

    // ---- Wait for dependencies if they aren't loaded yet ----
    var depsReady = new Promise(function(resolve) {
        var ready = { Utils: false, EventBus: false };
        function check() {
            if (ready.Utils && ready.EventBus) {
                resolve();
            }
        }
        if (typeof ForumDOMUtils !== 'undefined') {
            ready.Utils = true;
        } else {
            window.addEventListener('dom-utils-ready', function() {
                ready.Utils = true;
                check();
            });
        }
        if (typeof ForumEventBus !== 'undefined') {
            ready.EventBus = true;
        } else {
            window.addEventListener('event-bus-ready', function() {
                ready.EventBus = true;
                check();
            });
        }
        check();
        setTimeout(resolve, 5000); // safety timeout
    });

    // RETURN THE PROMISE – this is the crucial fix
    return depsReady.then(function() {
        if (isInitialized) return;
        isInitialized = true;

        // Refresh references in case they were set after the module defined
        Utils = typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils;
        EventBus = typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus;

        if (!isValidPage()) {
            if (document.body.id === 'send' && document.querySelector('.summary')) {
                convertSummaryPosts().catch(err => console.error('[PostsModule] Summary conversion error', err));
            }
            return;
        }

        if (document.body.id === 'send' && document.querySelector('.summary')) {
            convertSummaryPosts().catch(err => console.error('[PostsModule] Summary conversion error', err));
        } else {
            convertAllPosts().catch(err => console.error('[PostsModule] Init error', err));
        }

        // Register observer callbacks
        if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
            globalThis.forumObserver.register({
                id: 'posts-module',
                selector: CONFIG.POST_SELECTOR,
                priority: 'high',
                callback: function(node) {
                    if (!isValidPost(node)) return;
                    var postId = getPostId(node);
                    if (!postId || convertedPostIds.has(postId)) return;
                    convertAllPosts();
                }
            });
            globalThis.forumObserver.register({
                id: 'posts-module-reactions',
                selector: '.st-emoji-container',
                priority: 'medium',
                callback: function(node) {
                    var postEl = node.closest('.post');
                    if (postEl && isValidPost(postEl)) {
                        var postId = getPostId(postEl);
                        if (postId) {
                            setTimeout(function() { refreshReactionDisplay(postId); }, 100);
                        }
                        return;
                    }
                    var articleEl = node.closest('.article');
                    if (articleEl) {
                        var pid = getPostId(articleEl);
                        if (pid) {
                            setTimeout(function() { refreshReactionDisplay(pid); }, 100);
                        }
                    }
                }
            });
            globalThis.forumObserver.register({
                id: 'posts-module-reaction-images',
                selector: '.st-emoji-preview img',
                priority: 'low',
                callback: function(node) {
                    var postEl = node.closest('.post');
                    if (postEl && isValidPost(postEl)) {
                        var postId = getPostId(postEl);
                        if (postId) refreshReactionDisplay(postId);
                    }
                }
            });
        }
    }).catch(function(err) {
        console.error('[PostsModule] Dependency wait failed:', err);
    });
}

    // ============================================================================
    // PUBLIC API
    // ============================================================================
    return {
        initialize: initialize,
        refreshReactionDisplay: refreshReactionDisplay,
        refreshLikeDisplay: refreshLikeDisplay,
        getPostsContainer: getPostsContainer,
        isValidPost: isValidPost,
        reset: function() {
            convertedPostIds.clear();
            postReactions.clear();
            userDataCache.clear();
            isInitialized = false;
            if (activePopup) activePopup.remove();
            activePopup = null;
        },
        CONFIG: CONFIG
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);

if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('posts-module-ready'));

    // ===== USER TIMING: mark ready and measure =====
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('posts-module-ready');
        try {
            performance.measure('posts-module-load-time', 'posts-module-start', 'posts-module-ready');
        } catch (e) {
            // Ignore if marks missing
        }
    }
    // ================================================
}
