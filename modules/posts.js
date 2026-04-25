// modules/posts.js
// Forum Modernizer - Posts Module (API‑enhanced, batch fetch, same HTML structure)
var ForumPostsModule = (function(Utils, EventBus) {
    'use strict';

    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    var CONFIG = {
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container',
        REACTION_DELAY: 500
    };

    // Avatar color palette (for fallback)
    var AVATAR_COLORS = [
        '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2',
        '#EF476F', '#FFD166', '#06D6A0', '#073B4C', '#7209B7'
    ];

    // State
    var convertedPostIds = new Set();
    var isInitialized = false;
    var postReactions = new Map();
    var activePopup = null;
    var userCache = new Map();      // userId -> user object from API

    // ============================================================================
    // HELPERS (same as old, plus API fetch)
    // ============================================================================
    function getPostsContainer() {
        var modernContainer = document.getElementById('modern-posts-container');
        if (modernContainer) return modernContainer;
        var originalContainer = document.getElementById(CONFIG.CONTAINER_ID);
        if (originalContainer) return originalContainer;
        var newContainer = document.createElement('div');
        newContainer.id = CONFIG.CONTAINER_ID;
        newContainer.className = 'modern-posts-container';
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (wrapper) wrapper.appendChild(newContainer);
        else document.body.appendChild(newContainer);
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

    // Extract user ID from post (same as modal does from popup)
    function getUserIdFromPost($post) {
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

    // Batch fetch users from API (identical to modal)
    async function fetchUsersBatch(userIds) {
        if (!userIds || userIds.length === 0) return new Map();
        var uniqueIds = [...new Set(userIds)];
        var resultMap = new Map();

        // Split into chunks of 50 to avoid URL length limits
        var chunkSize = 50;
        for (var i = 0; i < uniqueIds.length; i += chunkSize) {
            var chunk = uniqueIds.slice(i, i + chunkSize);
            var url = '/api.php?mid=' + chunk.join(',');
            try {
                var response = await fetch(url);
                var data = await response.json();
                // Data structure: { idForum: ..., m12345: {...}, m67890: {...} }
                for (var j = 0; j < chunk.length; j++) {
                    var uid = chunk[j];
                    var userObj = data['m' + uid] || data.info;
                    if (userObj && userObj.id) {
                        resultMap.set(uid, userObj);
                        userCache.set(uid, userObj);
                    }
                }
            } catch (e) {
                console.warn('[PostsModule] Batch fetch failed for', chunk, e);
            }
        }
        return resultMap;
    }

    // Format join date (e.g., "Mar 21, 2020")
    function formatJoinDate(isoString) {
        if (!isoString) return null;
        var date = new Date(isoString);
        if (isNaN(date.getTime())) return null;
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // ============================================================================
    // AVATAR GENERATION (unchanged, uses AVATAR_COLORS)
    // ============================================================================
    function generateLetterAvatar(username, userId) {
        var displayName = username || 'User';
        var firstLetter = displayName.charAt(0).toUpperCase();
        if (!firstLetter.match(/[A-Z0-9]/i)) firstLetter = '?';

        var colorIndex = 0;
        if (firstLetter >= 'A' && firstLetter <= 'Z') {
            colorIndex = (firstLetter.charCodeAt(0) - 65) % AVATAR_COLORS.length;
        } else if (firstLetter >= '0' && firstLetter <= '9') {
            colorIndex = (parseInt(firstLetter) + 26) % AVATAR_COLORS.length;
        } else if (userId) {
            colorIndex = parseInt(userId) % AVATAR_COLORS.length;
        } else {
            var hash = 0;
            for (var i = 0; i < username.length; i++) {
                hash = ((hash << 5) - hash) + username.charCodeAt(i);
                hash = hash & hash;
            }
            colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
        }

        var backgroundColor = AVATAR_COLORS[colorIndex];
        if (backgroundColor.startsWith('#')) backgroundColor = backgroundColor.substring(1);

        var params = [
            'seed=' + encodeURIComponent(firstLetter),
            'backgroundColor=' + backgroundColor,
            'radius=50',
            'size=70'
        ];
        return 'https://api.dicebear.com/7.x/initials/svg?' + params.join('&');
    }

    // ============================================================================
    // DATA EXTRACTION FROM ORIGINAL POST (same as old, but we keep DOM fallbacks)
    // ============================================================================
    function getUsername($post) {
        var nickLink = $post.querySelector('.nick a');
        return nickLink ? nickLink.textContent.trim() : 'Unknown';
    }

    function getAvatarUrl($post) {
        var avatarImg = $post.querySelector('.avatar img');
        if (!avatarImg) return null;
        var src = avatarImg.getAttribute('src');
        if (src && src.includes('weserv.nl')) {
            var urlParams = new URLSearchParams(src.split('?')[1]);
            return urlParams.get('url') || src;
        }
        return src;
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
        } else {
            iconClass = 'fa-medal fa-regular';
        }
        var rankSpan = uRankSpan.querySelector('span');
        var title = '';
        if (rankSpan) {
            title = rankSpan.textContent.trim();
        } else {
            var textContent = uRankSpan.textContent || '';
            title = textContent.replace(icon ? icon.textContent : '', '').trim();
        }
        if (title === 'Member') {
            var stars = $post.querySelectorAll('.u_rank i.fa-star').length;
            if (stars === 3) title = 'Famous';
            else if (stars === 2) title = 'Senior';
            else if (stars === 1) title = 'Junior';
        }
        return { title: title || 'Member', iconClass: iconClass || 'fa-medal fa-regular' };
    }

    function getCleanContent($post) {
        var contentTable = $post.querySelector('.right.Item table.color');
        if (!contentTable) return '';
        var contentClone = contentTable.cloneNode(true);
        var signatures = contentClone.querySelectorAll('.signature, .edit');
        signatures.forEach(function(el) { if (el && el.remove) el.remove(); });
        var borders = contentClone.querySelectorAll('.bottomborder');
        borders.forEach(function(el) { if (el && el.remove) el.remove(); });
        var breaks = contentClone.querySelectorAll('br');
        breaks.forEach(function(br) {
            if (!br) return;
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
        return editSpan ? editSpan.textContent.trim() : '';
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
        var emojiContainer = $post.querySelector('.st-emoji-container');
        if (emojiContainer) {
            var counters = emojiContainer.querySelectorAll('.st-emoji-counter');
            if (counters.length > 0) {
                hasReactions = true;
                counters.forEach(function(counter) {
                    var count = parseInt(counter.getAttribute('data-count') || counter.textContent || 0);
                    reactionCount += count;
                });
                var previewDiv = emojiContainer.querySelector('.st-emoji-preview');
                if (previewDiv) {
                    var images = previewDiv.querySelectorAll('img');
                    images.forEach(function(img) {
                        var alt = img.getAttribute('alt') || '';
                        var src = img.getAttribute('src') || '';
                        if (src) {
                            reactions.push({ alt: alt, src: src, name: alt.replace(/:/g, '') });
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

    function getPostNumber($post, index) { return index + 1; }

    function getTimeAgo($post) {
        var whenSpan = $post.querySelector('.when');
        if (!whenSpan) return 'Recently';
        var whenTitle = whenSpan.getAttribute('title');
        if (!whenTitle) return 'Recently';
        var postDate = new Date(whenTitle);
        var now = new Date();
        var diffDays = Math.floor((now - postDate) / 86400000);
        if (diffDays >= 1) return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
        var diffHours = Math.floor((now - postDate) / 3600000);
        if (diffHours >= 1) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
        return 'Just now';
    }

    // ============================================================================
    // EMBEDDED LINK TRANSFORMATION (same as old)
    // ============================================================================
    function transformEmbeddedLinks(htmlContent) { /* same as your original, kept for brevity – unchanged */ }
    function convertToModernEmbed(originalContainer) { /* same */ }
    function extractDomain(url) { /* same */ }
    function createElementFromHTML(htmlString) { /* same */ }

    // ============================================================================
    // REACTION POPUP & HANDLERS (identical to old – copy from your working script)
    // ============================================================================
    function getAvailableReactions(postId) { /* unchanged, keep your version */ }
    function getDefaultEmojis() { /* unchanged */ }
    function createCustomReactionPopup(buttonElement, postId) { /* unchanged */ }
    function triggerOriginalReaction(postId, emoji) { /* unchanged */ }
    function handleReactionCountClick(pid) { /* unchanged */ }
    function refreshLikeDisplay(postId) { /* unchanged */ }
    function refreshReactionDisplay(postId) { /* unchanged */ }

    // ============================================================================
    // GENERATE REACTION BUTTONS HTML (same as old)
    // ============================================================================
    function generateReactionButtons(data) {
        if (!data.hasReactions || data.reactionCount === 0) {
            return '<button class="reaction-btn reaction-add-btn" aria-label="Add a reaction" data-pid="' + data.postId + '"><i class="fa-regular fa-face-smile" aria-hidden="true"></i></button>';
        }
        var reactionHtml = '<div class="reactions-container" data-pid="' + data.postId + '">';
        var reactionMap = new Map();
        for (var i = 0; i < data.reactions.length; i++) {
            var reaction = data.reactions[i];
            var src = reaction.src;
            if (reactionMap.has(src)) reactionMap.get(src).count++;
            else reactionMap.set(src, { src: src, alt: reaction.alt, name: reaction.name, count: 1 });
        }
        reactionMap.forEach(function(reaction) {
            reactionHtml += '<button class="reaction-btn reaction-with-image" title="' + Utils.escapeHtml(reaction.name || 'Reaction') + '" data-pid="' + data.postId + '">' +
                '<img src="' + reaction.src + '" alt="' + Utils.escapeHtml(reaction.alt || 'reaction') + '" width="18" height="18" loading="lazy">' +
                '<span class="reaction-count">' + reaction.count + '</span>' + '</button>';
        });
        reactionHtml += '</div>';
        return reactionHtml;
    }

    // ============================================================================
    // GENERATE MODERN CARD (same HTML as old script, plus join date & optional status dot)
    // ============================================================================
    function generateModernPost(data, apiUser) {
        if (!data) return '';

        // Use API data if available, otherwise fall back to DOM-extracted values
        var username = (apiUser && apiUser.nickname) ? apiUser.nickname : data.username;
        var groupText = (apiUser && apiUser.group && apiUser.group.name) ? apiUser.group.name : data.groupText;
        var roleBadgeClass = (groupText === 'Administrator' || (apiUser && apiUser.permission && apiUser.permission.admin)) ? 'admin' : 'member';
        var postCount = (apiUser && apiUser.messages !== undefined) ? apiUser.messages : data.postCount;
        var reputation = (apiUser && apiUser.reputation !== undefined) ? apiUser.reputation : data.reputation;
        var isOnline = (apiUser && apiUser.status === 'online') ? true : data.isOnline;
        var joinDateFormatted = (apiUser && apiUser.registration) ? formatJoinDate(apiUser.registration) : null;
        var userTitle = data.userTitle;  // title from DOM (rank)
        var rankIconClass = data.rankIconClass;

        var statusColor = isOnline ? '#10B981' : '#6B7280';
        var statusText = isOnline ? 'Online' : 'Offline';

        // Like button
        var likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '">' +
            '<i class="fa-regular fa-thumbs-up like-icon" aria-hidden="true"></i>';
        if (data.likes > 0) likeButton += '<span class="like-count like-count-display">' + data.likes + '</span>';
        likeButton += '</button>';

        var reactionsHtml = generateReactionButtons(data);
        var editHtml = data.editInfo ? '<div class="post-edit-info"><small>' + Utils.escapeHtml(data.editInfo) + '</small></div>' : '';
        var signatureHtml = data.signatureHtml ? '<div class="post-signature">' + data.signatureHtml + '</div>' : '';
        var ipHtml = data.ipAddress ? '<div class="post-ip">IP: ' + data.ipAddress + '</div>' : '';

        // Avatar (with optional status dot – requires CSS for .post-avatar-wrapper and .user-status-dot)
        var avatarUrl = (data.originalAvatarUrl && data.originalAvatarUrl.trim() !== '') ? data.originalAvatarUrl : generateLetterAvatar(username, data.postId);
        var avatarHtml = '<div class="post-avatar" data-pid="' + data.postId + '">' +
            '<img class="avatar-circle" src="' + avatarUrl + '" alt="Avatar of ' + Utils.escapeHtml(username) + '" width="70" height="70" loading="lazy" onerror="this.onerror=null; this.src=\'' + generateLetterAvatar(username, data.postId) + '\';">' +
            // Optional status dot – will only appear if CSS defines .user-status-dot
            '<span class="user-status-dot ' + (isOnline ? 'online' : 'offline') + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '" style="position: absolute; bottom: 2px; right: 2px; width: 12px; height: 12px; border-radius: 50%; background: ' + (isOnline ? '#10B981' : '#6B7280') + '; border: 2px solid var(--surface-color);"></span>' +
        '</div>';

        // Stats HTML (including join date if available)
        var statsHtml = '<div class="user-stats">' +
            '<div class="user-rank"><i class="' + rankIconClass + '" aria-hidden="true"></i> ' + userTitle + '</div>' +
            '<div class="user-posts"><i class="fa-regular fa-message" aria-hidden="true"></i> ' + Utils.escapeHtml(String(postCount)) + ' posts</div>' +
            '<div class="user-reputation"><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> ' + Utils.escapeHtml(String(reputation)) + ' rep</div>' +
            '<div class="user-status" style="color: ' + statusColor + '"><i class="fa-regular fa-circle" aria-hidden="true"></i> ' + statusText + '</div>';
        if (joinDateFormatted) {
            statsHtml += '<div class="user-joined"><i class="fa-regular fa-calendar" aria-hidden="true"></i> Joined ' + joinDateFormatted + '</div>';
        }
        statsHtml += '</div>';

        return '<article class="post-card" data-original-id="' + CONFIG.POST_ID_PREFIX + data.postId + '" data-post-id="' + data.postId + '" aria-labelledby="post-title-' + data.postId + '">' +
            '<header class="post-card-header">' +
                '<div class="post-meta">' +
                    '<div class="post-number"><i class="fa-regular fa-hashtag" aria-hidden="true"></i> ' + data.postNumber + '</div>' +
                    '<div class="post-time"><time datetime="' + new Date().toISOString() + '">' + data.timeAgo + '</time></div>' +
                '</div>' +
                '<div class="post-actions">' +
                    '<button class="action-icon" title="Quote" aria-label="Quote this post" data-action="quote" data-pid="' + data.postId + '"><i class="fa-regular fa-quote-left" aria-hidden="true"></i></button>' +
                    '<button class="action-icon" title="Edit" aria-label="Edit this post" data-action="edit" data-pid="' + data.postId + '"><i class="fa-regular fa-pen-to-square" aria-hidden="true"></i></button>' +
                    '<button class="action-icon" title="Share" aria-label="Share this post" data-action="share" data-pid="' + data.postId + '"><i class="fa-regular fa-share-nodes" aria-hidden="true"></i></button>' +
                    '<button class="action-icon report-action" title="Report" aria-label="Report this post" data-action="report" data-pid="' + data.postId + '"><i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i></button>' +
                    '<button class="action-icon delete-action" title="Delete" aria-label="Delete this post" data-action="delete" data-pid="' + data.postId + '"><i class="fa-regular fa-trash-can" aria-hidden="true"></i></button>' +
                '</div>' +
            '</header>' +
            '<div class="post-card-body">' +
                avatarHtml +
                '<div class="post-user-info">' +
                    '<div class="user-name" data-pid="' + data.postId + '">' + Utils.escapeHtml(username) + '</div>' +
                    '<div class="user-group"><span class="role-badge ' + roleBadgeClass + '">' + Utils.escapeHtml(groupText || 'Member') + '</span></div>' +
                    statsHtml +
                '</div>' +
            '</div>' +
            '<div class="post-content">' +
                '<div class="post-message">' + data.contentHtml + editHtml + '</div>' +
                signatureHtml +
            '</div>' +
            '<footer class="post-footer">' +
                '<div class="post-reactions">' + likeButton + reactionsHtml + '</div>' +
                ipHtml +
            '</footer>' +
        '</article>';
    }

    // ============================================================================
    // CONVERT ALL POSTS (batch API, then build cards)
    // ============================================================================
    async function buildAllCards() {
        var container = getPostsContainer();
        if (!container) return;
        container.innerHTML = '';

        var posts = Utils.getAllElements(CONFIG.POST_SELECTOR);
        var validPosts = [];
        for (var i = 0; i < posts.length; i++) {
            if (isValidPost(posts[i])) validPosts.push(posts[i]);
        }

        // Collect user IDs and extract basic post data
        var userIds = [];
        var postsData = [];
        for (var i = 0; i < validPosts.length; i++) {
            var post = validPosts[i];
            var postId = getPostId(post);
            if (!postId || convertedPostIds.has(postId)) continue;

            var uid = getUserIdFromPost(post);
            if (uid) userIds.push(uid);

            var data = extractPostData(post, i);
            if (data) postsData.push({ post: post, data: data, uid: uid });
        }

        // Fetch all user data in batch
        var userMap = await fetchUsersBatch(userIds);

        // Build cards
        for (var i = 0; i < postsData.length; i++) {
            var item = postsData[i];
            var apiUser = item.uid ? userMap.get(item.uid) : null;
            var modernCard = generateModernPost(item.data, apiUser);
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = modernCard;
            var card = tempDiv.firstElementChild;
            if (card) {
                card.setAttribute('data-original-id', item.post.id);
                container.appendChild(card);
                convertedPostIds.add(item.data.postId);
            }
        }

        attachEventHandlers();

        if (EventBus) EventBus.trigger('posts:ready', { count: postsData.length });
        console.log('[PostsModule] Ready – ' + postsData.length + ' posts converted (API enhanced)');
    }

    // ============================================================================
    // EVENT HANDLERS (same as your old script, unchanged)
    // ============================================================================
    function handleAvatarClick(pid) { /* unchanged – copy from old */ }
    function handleUsernameClick(pid) { /* unchanged */ }
    function handleQuote(pid) { /* unchanged */ }
    function handleEdit(pid) { /* unchanged */ }
    function handleDelete(pid) { /* unchanged */ }
    function handleShare(pid, buttonElement) { /* unchanged */ }
    function handleReport(pid) { /* unchanged */ }
    function handleLike(pid, isCountClick) { /* unchanged */ }
    function handleReact(pid, buttonElement) { /* unchanged */ }
    function attachEventHandlers() { /* unchanged – copy from your old script */ }

    // ============================================================================
    // INITIALIZE
    // ============================================================================
    function initialize() {
        if (isInitialized) return;
        console.log('[PostsModule] Initializing (batch API mode)...');
        buildAllCards().then(function() {
            isInitialized = true;
        }).catch(function(e) {
            console.error('[PostsModule] Initialization failed', e);
        });
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================
    return {
        initialize: initialize,
        convertToModernCard: function(postEl, index) { /* kept for compatibility; not used in batch mode */ },
        refreshReactionDisplay: refreshReactionDisplay,
        refreshLikeDisplay: refreshLikeDisplay,
        getPostsContainer: getPostsContainer,
        isValidPost: isValidPost,
        reset: function() {
            convertedPostIds.clear();
            postReactions.clear();
            userCache.clear();
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
}
