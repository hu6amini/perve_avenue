// modules/posts.js
// Forum Modernizer - Posts Module (API‑driven user data, avatar status dot, join date)
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
        AVATAR_WIDTH: 60,
        AVATAR_HEIGHT: 60
    };

    // Avatar colors (same as modal)
    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    var WESERV_CONFIG = {
        cdn: 'https://images.weserv.nl/',
        cache: '1y',
        quality: 90,
        avatarWidth: CONFIG.AVATAR_WIDTH,
        avatarHeight: CONFIG.AVATAR_HEIGHT
    };

    // State
    var convertedPostIds = new Set();
    var isInitialized = false;
    var postReactions = new Map();
    var activePopup = null;
    var userCache = new Map();   // userId -> user object

    // ============================================================================
    // USER API & AVATAR HELPERS (same as modal)
    // ============================================================================
    function optimizeImageUrl(url, width, height) {
        if (!url) return { url: url, quality: null, format: null, isGif: false };
        var lowerUrl = url.toLowerCase();
        if (lowerUrl.indexOf('weserv.nl') !== -1 ||
            lowerUrl.indexOf('dicebear.com') !== -1 ||
            lowerUrl.indexOf('api.dicebear.com') !== -1) {
            return { url: url, quality: null, format: null, isGif: false };
        }
        if (url.indexOf('data:') === 0) return { url: url, quality: null, format: null, isGif: false };

        var targetWidth = width || WESERV_CONFIG.avatarWidth;
        var targetHeight = height || WESERV_CONFIG.avatarHeight;
        var isGif = (lowerUrl.indexOf('.gif') !== -1 ||
                     lowerUrl.indexOf('.gif?') !== -1 ||
                     lowerUrl.indexOf('.gif#') !== -1 ||
                     /\.gif($|\?|#)/i.test(lowerUrl));

        var outputFormat = 'webp';
        var quality = WESERV_CONFIG.quality;
        var encodedUrl = encodeURIComponent(url);
        var optimizedUrl = WESERV_CONFIG.cdn + '?url=' + encodedUrl +
                           '&output=' + outputFormat +
                           '&maxage=' + WESERV_CONFIG.cache +
                           '&q=' + quality +
                           '&w=' + targetWidth +
                           '&h=' + targetHeight +
                           '&fit=cover' +
                           '&a=attention' +
                           '&il';
        if (isGif) optimizedUrl += '&n=-1&lossless=true';
        return {
            url: optimizedUrl,
            quality: quality,
            format: outputFormat,
            isGif: isGif,
            width: targetWidth,
            height: targetHeight
        };
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
        var params = [
            'seed=' + encodeURIComponent(firstLetter),
            'backgroundColor=' + backgroundColor,
            'radius=50',
            'size=' + (CONFIG.AVATAR_WIDTH + 10),
            'fontSize=32',
            'fontWeight=600'
        ];
        return 'https://api.dicebear.com/7.x/initials/svg?' + params.join('&');
    }

    function isValidAvatar(avatarUrl) {
        if (!avatarUrl || typeof avatarUrl !== 'string') return false;
        var lowerUrl = avatarUrl.toLowerCase();
        if (lowerUrl === 'http' || lowerUrl === 'http:' || lowerUrl === 'https' || lowerUrl === 'https:') return false;
        if (lowerUrl === '' || lowerUrl === 'null' || lowerUrl === 'undefined') return false;
        if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://') && !lowerUrl.startsWith('//')) return false;
        return true;
    }

    function getUserAvatarSync(user) {
        var avatarUrl = user.avatar;
        if (!isValidAvatar(avatarUrl)) {
            var dicebearUrl = generateDiceBearAvatar(user.nickname, user.id);
            return { url: dicebearUrl, quality: null, format: 'svg', isGif: false, width: CONFIG.AVATAR_WIDTH, height: CONFIG.AVATAR_HEIGHT };
        }
        if (avatarUrl.startsWith('//')) avatarUrl = 'https:' + avatarUrl;
        if (avatarUrl.startsWith('http://') && window.location.protocol === 'https:') {
            avatarUrl = avatarUrl.replace('http://', 'https://');
        }
        return optimizeImageUrl(avatarUrl, CONFIG.AVATAR_WIDTH, CONFIG.AVATAR_HEIGHT);
    }

    function getUserRoleInfo(user) {
        if (user.banned === 1) return { class: 'role-banned', text: 'Banned' };
        if (user.group) {
            var groupName = (user.group.name || '').toLowerCase();
            var groupClass = (user.group.class || '').toLowerCase();
            var groupId = user.group.id;
            if (groupClass.indexOf('founder') !== -1 || groupName === 'founder') return { class: 'role-founder', text: 'Founder' };
            if (groupName === 'administrator' || groupClass.indexOf('admin') !== -1 || groupId === 1) return { class: 'role-administrator', text: 'Administrator' };
            if (groupName === 'global moderator' || groupClass.indexOf('global_mod') !== -1) return { class: 'role-global-mod', text: 'Global Mod' };
            if (groupName === 'moderator' || groupClass.indexOf('mod') !== -1) return { class: 'role-moderator', text: 'Moderator' };
            if (groupName === 'developer' || groupClass.indexOf('developer') !== -1) return { class: 'role-developer', text: 'Developer' };
            if (groupName === 'premium' || groupClass.indexOf('premium') !== -1) return { class: 'role-premium', text: 'Premium' };
            if (groupName === 'vip' || groupClass.indexOf('vip') !== -1) return { class: 'role-vip', text: 'VIP' };
        }
        if (user.permission) {
            if (user.permission.founder === 1) return { class: 'role-founder', text: 'Founder' };
            if (user.permission.admin === 1) return { class: 'role-administrator', text: 'Administrator' };
            if (user.permission.global_mod === 1) return { class: 'role-global-mod', text: 'Global Mod' };
            if (user.permission.mod_sez === 1) return { class: 'role-moderator', text: 'Moderator' };
        }
        if (user.group && user.group.name && user.group.name !== 'Members' && user.group.name !== 'member') {
            return { class: 'role-member', text: user.group.name };
        }
        return { class: 'role-member', text: 'Member' };
    }

    function formatNumber(num) {
        if (!num && num !== 0) return '0';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function formatJoinDate(isoString) {
        if (!isoString) return 'Unknown';
        var date = new Date(isoString);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    async function fetchUsers(userIds) {
        var uniqueIds = [...new Set(userIds)];
        var result = [];
        for (var i = 0; i < uniqueIds.length; i++) {
            var uid = uniqueIds[i];
            if (userCache.has(uid)) {
                result.push(userCache.get(uid));
                continue;
            }
            try {
                var response = await fetch('/api.php?mid=' + uid);
                var data = await response.json();
                var user = data['m' + uid] || data.info;
                if (user && user.id) {
                    userCache.set(uid, user);
                    result.push(user);
                }
            } catch (e) {
                console.warn('[PostsModule] Failed to fetch user', uid, e);
            }
        }
        return result;
    }

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

    // ============================================================================
    // DOM HELPERS (unchanged from original)
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

    // ============================================================================
    // POST DATA EXTRACTION (only post‑specific, not user data)
    // ============================================================================
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
                            reactions.push({
                                alt: alt,
                                src: src,
                                name: alt.replace(/:/g, '')
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
        if (parts.length === 4) {
            return parts[0] + '.' + parts[1] + '.' + parts[2] + '.xxx';
        }
        return ip;
    }

    function getPostNumber($post, index) {
        return index + 1;
    }

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

    function extractPostData($post, index) {
        var postId = getPostId($post);
        if (!postId) return null;
        var reactionData = getReactionData($post);
        if (reactionData.hasReactions) postReactions.set(postId, reactionData.reactions);
        return {
            postId: postId,
            contentHtml: getCleanContent($post),
            signatureHtml: getSignatureHtml($post),
            editInfo: getEditInfo($post),
            likes: getLikes($post),
            hasReactions: reactionData.hasReactions,
            reactionCount: reactionData.reactionCount,
            reactions: reactionData.reactions,
            ipAddress: getMaskedIp($post),
            postNumber: getPostNumber($post, index),
            timeAgo: getTimeAgo($post)
        };
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
                if (text && text.length > 10 && !text.includes('Leggi altro') && !text.includes('Read more') && !text.includes('F24.MY') && text !== extractDomain(href)) {
                    titleLink = link;
                    break;
                }
            }
            if (!titleLink) {
                for (var i = allLinks.length - 1; i >= 0; i--) {
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
                var width = imgElement ? (imgElement.getAttribute('width') || '600') : '600';
                var height = imgElement ? (imgElement.getAttribute('height') || '400') : '400';
                modernHtml += '<div class="embedded-link-image">' +
                    '<img src="' + imageUrl + '" alt="' + Utils.escapeHtml(title) + '" loading="lazy" decoding="async" style="max-width: 100%; object-fit: cover; display: block; aspect-ratio: ' + width + ' / ' + height + ';" width="600" height="400">' +
                    '</div>';
            }
            modernHtml += '<div class="embedded-link-content">';
            if (faviconUrl || domain) {
                modernHtml += '<div class="embedded-link-domain">';
                if (faviconUrl) modernHtml += '<img src="' + faviconUrl + '" alt="" class="embedded-link-favicon" loading="lazy" decoding="async" width="16" height="16" style="width: 16px; height: 16px; object-fit: contain; display: inline-block; vertical-align: middle;">';
                modernHtml += '<span>' + Utils.escapeHtml(domain) + '</span></div>';
            }
            modernHtml += '<h3 class="embedded-link-title">' + Utils.escapeHtml(title) + '</h3>';
            if (description) modernHtml += '<p class="embedded-link-description">' + Utils.escapeHtml(description.substring(0, 200)) + (description.length > 200 ? '…' : '') + '</p>';
            modernHtml += '<div class="embedded-link-meta">' +
                '<span class="embedded-link-read-more">Read more on ' + Utils.escapeHtml(domain) + ' ›</span>' +
                '</div></div></a></div>';
            return createElementFromHTML(modernHtml);
        } catch (error) {
            console.warn('[PostsModule] Failed to convert embedded link:', error);
            return null;
        }
    }

    function extractDomain(url) {
        try {
            var a = document.createElement('a');
            a.href = url;
            var hostname = a.hostname;
            if (hostname.startsWith('www.')) hostname = hostname.substring(4);
            return hostname;
        } catch (e) {
            return url.split('/')[2] || url;
        }
    }

    function createElementFromHTML(htmlString) {
        var div = document.createElement('div');
        div.innerHTML = htmlString.trim();
        return div.firstChild;
    }

    // ============================================================================
    // REACTION POPUP & HANDLERS (same as original, but using existing helpers)
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
                        emojis.push({ name: name, alt: dataFui || imgAlt, src: imgSrc, rid: el.getAttribute('data-rid') });
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
            var closeHandler = function(e) {
                if (!popup.contains(e.target) && !e.target.closest('.reaction-btn')) {
                    popup.remove();
                    activePopup = null;
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(function() { document.addEventListener('click', closeHandler); }, 100);
            document.body.appendChild(popup);
            activePopup = popup;
        }, 200);
    }

    function triggerOriginalReaction(postId, emoji) { /* kept for compatibility, not used directly */ }

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

    function refreshLikeDisplay(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return;
        var pointsPos = originalPost.querySelector('.points .points_pos');
        var newLikeCount = pointsPos ? (parseInt(pointsPos.textContent) || 0) : 0;
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
    // GENERATE REACTION BUTTONS HTML
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
                '<span class="reaction-count">' + reaction.count + '</span>' +
                '</button>';
        });
        reactionHtml += '</div>';
        return reactionHtml;
    }

    // ============================================================================
    // GENERATE MODERN POST CARD (API‑driven)
    // ============================================================================
    function generateModernPost(data, user) {
        if (!data || !user) return '';
        var avatarData = getUserAvatarSync(user);
        var avatarUrl = avatarData.url;
        var dicebearFallback = generateDiceBearAvatar(user.nickname, user.id);
        var optimizedFallback = optimizeImageUrl(dicebearFallback, CONFIG.AVATAR_WIDTH, CONFIG.AVATAR_HEIGHT);
        var statusClass = (user.status === 'online') ? 'online' : (user.status === 'idle' ? 'idle' : (user.status === 'dnd' ? 'dnd' : 'offline'));
        var statusText = user.status === 'online' ? 'Online' : (user.status === 'idle' ? 'Idle' : (user.status === 'dnd' ? 'Do Not Disturb' : 'Offline'));
        var joinDateFormatted = formatJoinDate(user.registration);
        var roleInfo = getUserRoleInfo(user);
        var likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '">' +
            '<i class="fa-regular fa-thumbs-up like-icon" aria-hidden="true"></i>';
        if (data.likes > 0) likeButton += '<span class="like-count like-count-display">' + data.likes + '</span>';
        likeButton += '</button>';
        var reactionsHtml = generateReactionButtons(data);
        var editHtml = data.editInfo ? '<div class="post-edit-info"><small>' + Utils.escapeHtml(data.editInfo) + '</small></div>' : '';
        var signatureHtml = data.signatureHtml ? '<div class="post-signature">' + data.signatureHtml + '</div>' : '';
        var ipHtml = data.ipAddress ? '<div class="post-ip">IP: ' + data.ipAddress + '</div>' : '';
        var avatarHtml = '<div class="post-avatar-wrapper" data-pid="' + data.postId + '">' +
            '<img class="avatar-circle" src="' + avatarUrl + '" alt="Avatar of ' + Utils.escapeHtml(user.nickname) + '" width="' + CONFIG.AVATAR_WIDTH + '" height="' + CONFIG.AVATAR_HEIGHT + '" loading="lazy" onerror="this.onerror=null; this.src=\'' + optimizedFallback.url + '\';">' +
            '<span class="user-status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span>' +
            '</div>';
        var rankIcon = user.group && user.group.class ? (user.group.class.includes('admin') ? 'fa-crown' : (user.group.class.includes('mod') ? 'fa-shield' : 'fa-medal')) : 'fa-medal';
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
                    '<div class="user-name" data-pid="' + data.postId + '">' + Utils.escapeHtml(user.nickname) + '</div>' +
                    '<div class="user-group"><span class="role-badge ' + roleInfo.class + '">' + Utils.escapeHtml(roleInfo.text) + '</span></div>' +
                    '<div class="user-stats">' +
                        '<div class="user-rank"><i class="fa-regular ' + rankIcon + '" aria-hidden="true"></i> ' + (user.userTitle || 'Member') + '</div>' +
                        '<div class="user-posts"><i class="fa-regular fa-message" aria-hidden="true"></i> ' + formatNumber(user.messages) + ' posts</div>' +
                        '<div class="user-reputation"><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> ' + formatNumber(user.reputation) + ' rep</div>' +
                        '<div class="user-joined"><i class="fa-regular fa-calendar" aria-hidden="true"></i> Joined ' + joinDateFormatted + '</div>' +
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

    // ============================================================================
    // EVENT HANDLERS (using original DOM actions)
    // ============================================================================
    function handleAvatarClick(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var avatarLink = originalPost.querySelector('.avatar');
        if (avatarLink && avatarLink.tagName === 'A') avatarLink.click();
    }

    function handleUsernameClick(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var nickLink = originalPost.querySelector('.nick a');
        if (nickLink) nickLink.click();
    }

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
                            $(overlayLink).overlay({ onBeforeLoad: function() {
                                var wrap = this.getOverlay();
                                var content = wrap.find('div');
                                content.html('<p><img src="https://img.forumfree.net/index_file/loads3.gif"></p>').load(href + '&popup=1');
                            }});
                            overlayLink.setAttribute('data-overlay-init', 'true');
                        }
                        $(overlayLink).trigger('click');
                        return;
                    } else {
                        var mouseoverEvent = new MouseEvent('mouseover', { view: window, bubbles: true, cancelable: true });
                        overlayLink.dispatchEvent(mouseoverEvent);
                        setTimeout(function() { overlayLink.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true })); }, 50);
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
        setTimeout(function() {
            refreshLikeDisplay(pid);
            refreshReactionDisplay(pid);
        }, CONFIG.REACTION_DELAY);
    }

    function handleReact(pid, buttonElement) {
        createCustomReactionPopup(buttonElement, pid);
    }

    function attachEventHandlers() {
        document.addEventListener('click', function(e) {
            var avatarWrapper = e.target.closest('.post-avatar-wrapper');
            if (avatarWrapper) { e.preventDefault(); var pid = avatarWrapper.getAttribute('data-pid'); if (pid) handleAvatarClick(pid); }
        });
        document.addEventListener('click', function(e) {
            var userNameDiv = e.target.closest('.user-name');
            if (userNameDiv) { e.preventDefault(); var pid = userNameDiv.getAttribute('data-pid'); if (pid) handleUsernameClick(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="quote"], .action-icon[title="Quote"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleQuote(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="edit"], .action-icon[title="Edit"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleEdit(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="delete"], .action-icon[title="Delete"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleDelete(pid); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="share"], .action-icon[title="Share"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleShare(pid, btn); }
        });
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="report"], .action-icon[title="Report"]');
            if (btn) { e.preventDefault(); var pid = btn.getAttribute('data-pid'); if (pid) handleReport(pid); }
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
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && activePopup) { activePopup.remove(); activePopup = null; } });
    }

    // ============================================================================
    // CONVERT ALL POSTS (async with API)
    // ============================================================================
    async function convertAllPosts() {
        var container = getPostsContainer();
        if (!container) return;
        container.innerHTML = '';
        var posts = Utils.getAllElements(CONFIG.POST_SELECTOR);
        var validPosts = [];
        for (var i = 0; i < posts.length; i++) {
            if (isValidPost(posts[i])) validPosts.push(posts[i]);
        }
        var userIds = [];
        for (var i = 0; i < validPosts.length; i++) {
            var uid = getUserIdFromPost(validPosts[i]);
            if (uid) userIds.push(uid);
        }
        var users = await fetchUsers(userIds);
        var userMap = new Map();
        for (var i = 0; i < users.length; i++) userMap.set(users[i].id, users[i]);
        for (var i = 0; i < validPosts.length; i++) {
            var post = validPosts[i];
            var postId = getPostId(post);
            if (convertedPostIds.has(postId)) continue;
            var postData = extractPostData(post, i);
            if (!postData) continue;
            var uid = getUserIdFromPost(post);
            var user = userMap.get(uid);
            if (!user) continue;
            var modernCard = generateModernPost(postData, user);
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = modernCard;
            var card = tempDiv.firstElementChild;
            if (card) {
                card.setAttribute('data-original-id', post.id);
                container.appendChild(card);
                convertedPostIds.add(postId);
            }
        }
        attachEventHandlers();
        if (EventBus) EventBus.trigger('posts:ready', { count: validPosts.length });
        console.log('[PostsModule] Ready – ' + validPosts.length + ' posts converted with API data');
    }

    // ============================================================================
    // INITIALIZE
    // ============================================================================
    function initialize() {
        if (isInitialized) return;
        console.log('[PostsModule] Initializing (API mode)...');
        convertAllPosts().then(function() {
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
        refreshReactionDisplay: refreshReactionDisplay,
        refreshLikeDisplay: refreshLikeDisplay,
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

// Signal that posts module is ready
if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('posts-module-ready'));
}
