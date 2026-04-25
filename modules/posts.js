// modules/posts.js
// Forum Modernizer - Posts Module (API‑powered version)
// Transforms .post elements into modern card layout using forum API for user data
var ForumPostsModule = (function(Utils, EventBus) {
    'use strict';

    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    var CONFIG = {
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container',
        REACTION_DELAY: 500,
        AVATAR_SIZE: 60,            // px
        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 90
    };

    // Avatar colour palette (fallback for dicebear)
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
    var postReactions = new Map();      // store reaction data per post
    var activePopup = null;             // custom reaction popup reference

    // Cache for user API data (MID -> user object)
    var userDataCache = new Map();

    // Store original DOM posts for delayed data updates
    var pendingUserFetch = new Map();    // postId -> { originalPost, index, resolve }

    // ============================================================================
    // HELPER FUNCTIONS (unchanged)
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

    // Extract MID from user profile link
    function getMidFromPost($post) {
        var nickLink = $post.querySelector('.nick a');
        if (!nickLink) return null;
        var match = nickLink.href.match(/MID=(\d+)/);
        if (match && match[1]) return match[1];
        // also try from avatar link
        var avatarLink = $post.querySelector('.avatar a');
        if (avatarLink) {
            match = avatarLink.href.match(/MID=(\d+)/);
            if (match && match[1]) return match[1];
        }
        return null;
    }

    // ============================================================================
    // API USER DATA FETCHING (cached)
    // ============================================================================
    async function fetchUserData(mid) {
        if (userDataCache.has(mid)) return userDataCache.get(mid);
        try {
            var response = await fetch('/api.php?mid=' + mid);
            var data = await response.json();
            // the API returns { idForum, mXXXXXX: {...} } or { idForum, info: {...} } for 'me'
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

    // Batch fetch for multiple MIDs
    async function fetchMultipleUsers(midList) {
        var uniqueMids = [...new Set(midList.filter(Boolean))];
        var promises = uniqueMids.map(mid => fetchUserData(mid));
        await Promise.all(promises);
    }

    // ============================================================================
    // AVATAR OPTIMIZATION (identical to modal script)
    // ============================================================================
    function optimizeImageUrl(url, width, height) {
        if (!url) return null;
        var lowerUrl = url.toLowerCase();
        if (lowerUrl.indexOf('weserv.nl') !== -1 ||
            lowerUrl.indexOf('dicebear.com') !== -1 ||
            lowerUrl.indexOf('api.dicebear.com') !== -1 ||
            url.indexOf('data:') === 0) {
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

    function generateDiceBearAvatar(username, userId) {
        var displayName = username || 'User';
        var firstLetter = displayName.charAt(0).toUpperCase();
        if (!firstLetter.match(/[A-Z0-9]/i)) firstLetter = '?';
        var backgroundColor = getColorFromNickname(username, userId);
        return 'https://api.dicebear.com/7.x/initials/svg?' +
            'seed=' + encodeURIComponent(firstLetter) +
            '&backgroundColor=' + backgroundColor +
            '&size=' + CONFIG.AVATAR_SIZE +
            '&fontSize=32&fontWeight=600&radius=50';
    }

    function getUserAvatarUrl(user, username, userId) {
        if (user && user.avatar && user.avatar.trim()) {
            var avatarUrl = user.avatar;
            if (avatarUrl.startsWith('//')) avatarUrl = 'https:' + avatarUrl;
            if (avatarUrl.startsWith('http://') && window.location.protocol === 'https:')
                avatarUrl = avatarUrl.replace('http://', 'https://');
            var optimized = optimizeImageUrl(avatarUrl, CONFIG.AVATAR_SIZE, CONFIG.AVATAR_SIZE);
            if (optimized) return optimized;
        }
        return generateDiceBearAvatar(username, userId);
    }

    // ============================================================================
    // DATA EXTRACTION FROM ORIGINAL POST (sync parts)
    // ============================================================================
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

    function getCleanContent($post) {
        var contentTable = $post.querySelector('.right.Item table.color');
        if (!contentTable) return '';
        var contentClone = contentTable.cloneNode(true);
        // remove signature and edit footers
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
                        if (src) reactions.push({ alt: alt, src: src, name: alt.replace(/:/g, '') });
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
            var stars = uRankSpan.querySelectorAll('i.fa-star').length;
            if (stars === 3) title = 'Famous';
            else if (stars === 2) title = 'Senior';
            else if (stars === 1) title = 'Junior';
        }
        return { title: title || 'Member', iconClass: iconClass };
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
            var allLinks = originalContainer.querySelectorAll('a');
            var mainLink = null, titleLink = null, description = '', imageUrl = null, faviconUrl = null;
            for (var i = 0; i < allLinks.length; i++) {
                var link = allLinks[i];
                var text = link.textContent.trim();
                var href = link.getAttribute('href');
                if (!href) continue;
                if (!mainLink) mainLink = href;
                if (text && text.length > 10 && !text.includes('Leggi altro') && !text.includes('Read more') && text !== extractDomain(href)) {
                    titleLink = link;
                    break;
                }
            }
            if (!titleLink) {
                for (var i = allLinks.length-1; i >=0; i--) {
                    var link = allLinks[i];
                    var text = link.textContent.trim();
                    var href = link.getAttribute('href');
                    if (href && text && !text.includes('Leggi altro') && !text.includes('Read more')) {
                        titleLink = link;
                        break;
                    }
                }
            }
            var url = mainLink || (titleLink ? titleLink.getAttribute('href') : null);
            if (!url) return null;
            var domain = extractDomain(url);
            var title = titleLink ? titleLink.textContent.trim() : domain;
            var paragraphs = originalContainer.querySelectorAll('div:not([style]) p');
            if (paragraphs.length > 0) description = paragraphs[0].textContent.trim();
            var imgElement = originalContainer.querySelector('.ffb_embedlink_preview img');
            if (imgElement && imgElement.getAttribute('src')) imageUrl = imgElement.getAttribute('src');
            var hiddenDiv = originalContainer.querySelector('div[style="display:none"]');
            if (hiddenDiv) {
                var faviconImg = hiddenDiv.querySelector('img');
                if (faviconImg && faviconImg.getAttribute('src')) faviconUrl = faviconImg.getAttribute('src');
            }
            var modernHtml = '<div class="modern-embedded-link">' +
                '<a href="' + Utils.escapeHtml(url) + '" class="embedded-link-container" target="_blank" rel="noopener noreferrer" title="' + Utils.escapeHtml(title) + '">';
            if (imageUrl) {
                modernHtml += '<div class="embedded-link-image"><img src="' + imageUrl + '" alt="' + Utils.escapeHtml(title) + '" loading="lazy" decoding="async" style="max-width:100%;object-fit:cover;display:block;"></div>';
            }
            modernHtml += '<div class="embedded-link-content">';
            if (faviconUrl || domain) {
                modernHtml += '<div class="embedded-link-domain">';
                if (faviconUrl) modernHtml += '<img src="' + faviconUrl + '" alt="" class="embedded-link-favicon" loading="lazy" width="16" height="16">';
                modernHtml += '<span>' + Utils.escapeHtml(domain) + '</span></div>';
            }
            modernHtml += '<h3 class="embedded-link-title">' + Utils.escapeHtml(title) + '</h3>';
            if (description) modernHtml += '<p class="embedded-link-description">' + Utils.escapeHtml(description.substring(0,200)) + (description.length>200?'…':'') + '</p>';
            modernHtml += '<div class="embedded-link-meta"><span class="embedded-link-read-more">Read more on ' + Utils.escapeHtml(domain) + ' ›</span></div></div></a></div>';
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
    // REACTION POPUP (unchanged from your working version)
    // ============================================================================
    function getAvailableReactions(postId) { /* keep original */ }
    function getDefaultEmojis() { /* keep original */ }
    function createCustomReactionPopup(buttonElement, postId) { /* keep original */ }
    function triggerOriginalReaction(postId, emoji) { /* keep original */ }
    function handleReactionCountClick(pid) { /* keep original */ }

    // ============================================================================
    // GENERATE REACTION BUTTONS HTML (unchanged)
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

    // ============================================================================
    // GENERATE MODERN CARD (uses API user data)
    // ============================================================================
    function generateModernPost(data) {
        if (!data) return '';
        // data.user contains API user object (or null)
        var user = data.user;
        var username = data.username;
        var userId = data.mid;
        var isOnline = (user && user.status === 'online') || false;
        var statusClass = isOnline ? 'online' : 'offline';
        var statusText = isOnline ? 'Online' : 'Offline';

        // Avatar with online dot
        var avatarUrl = getUserAvatarUrl(user, username, userId);
        var avatarHtml = '<div class="post-avatar-wrapper">' +
            '<img class="avatar-circle" src="' + avatarUrl + '" alt="Avatar of ' + Utils.escapeHtml(username) + '" width="' + CONFIG.AVATAR_SIZE + '" height="' + CONFIG.AVATAR_SIZE + '" loading="lazy" onerror="this.onerror=null; this.src=\'' + generateDiceBearAvatar(username, userId) + '\';">' +
            '<span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span>' +
            '</div>';

        // Group / role badge
        var groupName = (user && user.group && user.group.name) ? user.group.name : (data.groupText || 'Member');
        var roleClass = 'role-badge';
        if (groupName.toLowerCase() === 'administrator') roleClass += ' admin';
        else if (groupName.toLowerCase() === 'moderator') roleClass += ' moderator';
        else if (groupName.toLowerCase() === 'developer') roleClass += ' developer';
        else roleClass += ' member';

        // Post count & reputation from API (if available)
        var postCount = (user && typeof user.messages !== 'undefined') ? user.messages : data.postCount;
        var reputation = (user && typeof user.reputation !== 'undefined') ? user.reputation : data.reputation;

        // Join date from API
        var joinDateFormatted = '';
        if (user && user.registration) {
            var date = new Date(user.registration);
            joinDateFormatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } else {
            joinDateFormatted = 'Unknown join date';
        }

        // User rank title & icon (still from DOM)
        var rank = data.userTitle || 'Member';
        var rankIcon = data.rankIconClass || 'fa-medal fa-regular';

        var likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '">' +
            '<i class="fa-regular fa-thumbs-up like-icon" aria-hidden="true"></i>';
        if (data.likes > 0) likeButton += '<span class="like-count like-count-display">' + data.likes + '</span>';
        likeButton += '</button>';

        var reactionsHtml = generateReactionButtons(data);

        var editHtml = data.editInfo ? '<div class="post-edit-info"><small>' + Utils.escapeHtml(data.editInfo) + '</small></div>' : '';
        var signatureHtml = data.signatureHtml ? '<div class="post-signature">' + data.signatureHtml + '</div>' : '';
        var ipHtml = data.ipAddress ? '<div class="post-ip">IP: ' + data.ipAddress + '</div>' : '';

        return '<article class="post-card" data-original-id="' + CONFIG.POST_ID_PREFIX + data.postId + '" data-post-id="' + data.postId + '" aria-labelledby="post-title-' + data.postId + '">' +
            '<header class="post-card-header">' +
                '<div class="post-meta">' +
                    '<div class="post-number"><i class="fa-regular fa-hashtag" aria-hidden="true"></i> ' + data.postNumber + '</div>' +
                    '<div class="post-time"><time datetime="' + new Date().toISOString() + '">' + data.timeAgo + '</time></div>' +
                '</div>' +
                '<div class="post-actions">' +
                    '<button class="action-icon" title="Quote" aria-label="Quote this post" data-action="quote" data-pid="' + data.postId + '"><i class="fa-regular fa-quote-left"></i></button>' +
                    '<button class="action-icon" title="Edit" aria-label="Edit this post" data-action="edit" data-pid="' + data.postId + '"><i class="fa-regular fa-pen-to-square"></i></button>' +
                    '<button class="action-icon" title="Share" aria-label="Share this post" data-action="share" data-pid="' + data.postId + '"><i class="fa-regular fa-share-nodes"></i></button>' +
                    '<button class="action-icon report-action" title="Report" aria-label="Report this post" data-action="report" data-pid="' + data.postId + '"><i class="fa-regular fa-circle-exclamation"></i></button>' +
                    '<button class="action-icon delete-action" title="Delete" aria-label="Delete this post" data-action="delete" data-pid="' + data.postId + '"><i class="fa-regular fa-trash-can"></i></button>' +
                '</div>' +
            '</header>' +
            '<div class="post-card-body">' +
                '<div class="avatar-modern" data-pid="' + data.postId + '">' + avatarHtml + '</div>' +
                '<div class="post-user-info">' +
                    '<div class="user-name" data-pid="' + data.postId + '">' + Utils.escapeHtml(username) + '</div>' +
                    '<div class="user-group"><span class="' + roleClass + '">' + Utils.escapeHtml(groupName) + '</span></div>' +
                    '<div class="user-stats">' +
                        '<div class="user-rank"><i class="' + rankIcon + '" aria-hidden="true"></i> ' + rank + '</div>' +
                        '<div class="user-posts"><i class="fa-regular fa-message"></i> ' + formatNumber(postCount) + ' posts</div>' +
                        '<div class="user-reputation"><i class="fa-regular fa-thumbs-up"></i> ' + formatNumber(reputation) + ' rep</div>' +
                        '<div class="user-joined"><i class="fa-regular fa-calendar"></i> Joined ' + joinDateFormatted + '</div>' +
                    '</div>' +
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

    function formatNumber(num) {
        if (!num && num !== 0) return '0';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // ============================================================================
    // REFRESH FUNCTIONS (reactions & likes - mostly unchanged)
    // ============================================================================
    function refreshLikeDisplay(postId) { /* keep original version */ }
    function refreshReactionDisplay(postId) { /* keep original version */ }

    // ============================================================================
    // EVENT HANDLERS (unchanged)
    // ============================================================================
    function handleAvatarClick(pid) { /* original */ }
    function handleUsernameClick(pid) { /* original */ }
    function handleQuote(pid) { /* original */ }
    function handleEdit(pid) { /* original */ }
    function handleDelete(pid) { /* original */ }
    function handleShare(pid, buttonElement) { /* original */ }
    function handleReport(pid) { /* original */ }
    function handleLike(pid, isCountClick) { /* original */ }
    function handleReact(pid, buttonElement) { /* original */ }

    function attachEventHandlers() {
        document.addEventListener('click', function(e) {
            var avatarDiv = e.target.closest('.avatar-modern');
            if (avatarDiv) { e.preventDefault(); var pid = avatarDiv.getAttribute('data-pid'); if (pid) handleAvatarClick(pid); }
        });
        document.addEventListener('click', function(e) {
            var nameDiv = e.target.closest('.user-name');
            if (nameDiv) { e.preventDefault(); var pid = nameDiv.getAttribute('data-pid'); if (pid) handleUsernameClick(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-action="quote"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleQuote(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-action="edit"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleEdit(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-action="delete"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleDelete(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-action="share"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleShare(pid, btn); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('[data-action="report"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleReport(pid); }
        });
        document.addEventListener('click', function(e) {
            var likeBtn = e.target.closest('.like-btn');
            if (likeBtn) { e.preventDefault(); var pid = likeBtn.getAttribute('data-pid'); if (pid) handleLike(pid, e.target.classList && e.target.classList.contains('like-count-display')); }
        });
        document.addEventListener('click', function(e) {
            var countSpan = e.target.closest('.reaction-count');
            if (countSpan) {
                e.preventDefault(); e.stopPropagation();
                var btn = countSpan.closest('.reaction-btn');
                if (btn) { var pid = btn.getAttribute('data-pid'); if (pid) handleReactionCountClick(pid); }
            }
        });
        document.addEventListener('click', function(e) {
            var reactBtn = e.target.closest('.reaction-btn:not(.like-btn)');
            if (reactBtn && !e.target.classList.contains('reaction-count')) {
                e.preventDefault(); e.stopPropagation();
                var pid = reactBtn.getAttribute('data-pid');
                if (pid) handleReact(pid, reactBtn);
            }
        });
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && activePopup) { activePopup.remove(); activePopup = null; }
        });
    }

    // ============================================================================
    // MAIN CONVERSION PIPELINE (API‑driven)
    // ============================================================================
    async function convertAllPosts() {
        var container = getPostsContainer();
        if (container) container.innerHTML = '';

        convertedPostIds.clear();
        postReactions.clear();

        var posts = Utils.getAllElements(CONFIG.POST_SELECTOR);
        var validPosts = [];
        for (var i = 0; i < posts.length; i++) {
            if (isValidPost(posts[i])) validPosts.push(posts[i]);
        }

        // Collect MIDs
        var mids = [];
        var postDataSync = [];
        for (var i = 0; i < validPosts.length; i++) {
            var $post = validPosts[i];
            var postId = getPostId($post);
            if (!postId || convertedPostIds.has(postId)) continue;
            var mid = getMidFromPost($post);
            mids.push(mid);
            // Extract sync data (content, etc.)
            var syncData = {
                postId: postId,
                mid: mid,
                originalPost: $post,
                index: i,
                username: $post.querySelector('.nick a') ? $post.querySelector('.nick a').textContent.trim() : 'Unknown',
                groupText: (function() { var g = $post.querySelector('.u_group dd'); return g ? g.textContent.trim() : ''; })(),
                postCount: (function() { var pc = $post.querySelector('.u_posts dd a'); return pc ? pc.textContent.trim() : '0'; })(),
                reputation: (function() { var r = $post.querySelector('.u_reputation dd a'); return r ? r.textContent.trim().replace('+','') : '0'; })(),
                likes: getLikes($post),
                contentHtml: getCleanContent($post),
                signatureHtml: getSignatureHtml($post),
                editInfo: getEditInfo($post),
                ipAddress: getMaskedIp($post),
                timeAgo: getTimeAgo($post),
                userTitle: getUserTitleAndIcon($post).title,
                rankIconClass: getUserTitleAndIcon($post).iconClass,
                reactionsData: getReactionData($post)
            };
            postDataSync.push(syncData);
            convertedPostIds.add(postId);
        }

        // Fetch all users in batch
        await fetchMultipleUsers(mids);

        // Build HTML for each post
        for (var i = 0; i < postDataSync.length; i++) {
            var data = postDataSync[i];
            var user = data.mid ? userDataCache.get(data.mid) : null;
            var postData = {
                postId: data.postId,
                mid: data.mid,
                username: data.username,
                groupText: data.groupText,
                postCount: data.postCount,
                reputation: data.reputation,
                likes: data.likes,
                contentHtml: data.contentHtml,
                signatureHtml: data.signatureHtml,
                editInfo: data.editInfo,
                ipAddress: data.ipAddress,
                postNumber: i+1,
                timeAgo: data.timeAgo,
                userTitle: data.userTitle,
                rankIconClass: data.rankIconClass,
                hasReactions: data.reactionsData.hasReactions,
                reactionCount: data.reactionsData.reactionCount,
                reactions: data.reactionsData.reactions,
                user: user
            };
            var cardHtml = generateModernPost(postData);
            var temp = document.createElement('div');
            temp.innerHTML = cardHtml;
            var card = temp.firstElementChild;
            container.appendChild(card);
        }

        attachEventHandlers();

        if (EventBus) EventBus.trigger('posts:ready', { count: postDataSync.length });
        console.log('[PostsModule] Ready - ' + postDataSync.length + ' posts converted (API powered)');
    }

    // ============================================================================
    // INITIALIZE
    // ============================================================================
    function initialize() {
        if (isInitialized) {
            console.log('[PostsModule] Already initialized');
            return;
        }
        console.log('[PostsModule] Initializing API‑powered version...');
        convertAllPosts().catch(err => console.error('[PostsModule] Initialization error', err));
        isInitialized = true;
        // Register observer for dynamic content (if ForumCoreObserver exists)
        if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
            globalThis.forumObserver.register({
                id: 'posts-module',
                selector: CONFIG.POST_SELECTOR,
                priority: 'high',
                callback: function(node) {
                    if (!isValidPost(node)) return;
                    var postId = getPostId(node);
                    if (!postId || convertedPostIds.has(postId)) return;
                    // For simplicity, re-run full conversion (or implement incremental)
                    convertAllPosts();
                }
            });
            console.log('[PostsModule] Registered with ForumCoreObserver');
        }
    }

    // ============================================================================
    // PUBLIC API
    // ============================================================================
    return {
        initialize: initialize,
        refreshReactionDisplay: refreshReactionDisplay,
        refreshLikeDisplay: refreshLikeDisplay,
        getPostsContainer: getPostsContainer,
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

// Signal ready
if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('posts-module-ready'));
}
