// modules/posts.js
// Forum Modernizer - Posts Module (API-enhanced, all original functionality preserved)
// Transforms .post elements into modern card layout with API user data (avatar, join date, online dot)
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
        AVATAR_SIZE: 60,
        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 90
    };

    // Avatar colour palette (for dicebear fallback)
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
    // AVATAR OPTIMISATION (weserv, 60×60)
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
    // HELPER FUNCTIONS (unchanged from original)
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
    // DATA EXTRACTION (original, unchanged)
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
        if (!contentTable) return '';
        var contentClone = contentTable.cloneNode(true);
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
    // EMBEDDED LINK TRANSFORMATION (original)
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
    // CUSTOM REACTION POPUP (original, unchanged)
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

    function triggerOriginalReaction(postId, emoji) { /* not used directly */ }

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
    // GENERATE REACTION BUTTONS HTML (original)
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
    // GENERATE MODERN CARD (updated: avatar wrapper + status dot, join date)
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
        var avatarUrl = getUserAvatarUrl(user, username, userId);
        var avatarHtml = '<div class="post-avatar-wrapper">' +
            '<img class="avatar-circle" src="' + avatarUrl + '" alt="Avatar of ' + Utils.escapeHtml(username) + '" width="' + CONFIG.AVATAR_SIZE + '" height="' + CONFIG.AVATAR_SIZE + '" loading="lazy" onerror="this.onerror=null; this.src=\'' + generateDiceBearAvatar(username, userId) + '\';">' +
            '<span class="status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span>' +
            '</div>';
        var groupName = (user && user.group && user.group.name) ? user.group.name : (data.groupText || 'Member');
        var roleClass = 'role-badge';
        if (groupName.toLowerCase() === 'administrator') roleClass += ' admin';
        else if (groupName.toLowerCase() === 'moderator') roleClass += ' moderator';
        else if (groupName.toLowerCase() === 'developer') roleClass += ' developer';
        else roleClass += ' member';
        var postCount = (user && typeof user.messages !== 'undefined') ? user.messages : data.postCount;
        var reputation = (user && typeof user.reputation !== 'undefined') ? user.reputation : data.reputation;
        var joinDateFormatted = '';
        if (user && user.registration) {
            var date = new Date(user.registration);
            joinDateFormatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } else {
            joinDateFormatted = 'Unknown join date';
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
                        '<div class="user-rank"><i class="' + (data.rankIconClass || 'fa-medal fa-regular') + '" aria-hidden="true"></i> ' + (data.userTitle || 'Member') + '</div>' +
                        '<div class="user-posts"><i class="fa-regular fa-message"></i> ' + formatNumber(postCount) + ' posts</div>' +
                        '<div class="user-reputation"><i class="fa-regular fa-thumbs-up"></i> ' + formatNumber(reputation) + ' rep</div>' +
                        '<div class="user-joined"><i class="fa-regular fa-arrow-right-to-bracket"></i> ' + joinDateFormatted + '</div>' +
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
    // REFRESH FUNCTIONS (original, unchanged)
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
    // EVENT HANDLERS (original, unchanged)
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
            var avatarDiv = e.target.closest('.avatar-modern');
            if (avatarDiv) { e.preventDefault(); var pid = avatarDiv.getAttribute('data-pid'); if (pid) handleAvatarClick(pid); }
        });
        document.addEventListener('click', function(e) {
            var userNameDiv = e.target.closest('.user-name');
            if (userNameDiv) { e.preventDefault(); var pid = userNameDiv.getAttribute('data-pid'); if (pid) handleUsernameClick(pid); }
        });
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
    // MAIN CONVERSION PIPELINE (API-enhanced)
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

        var mids = [];
        var postsData = [];
        for (var i = 0; i < validPosts.length; i++) {
            var $post = validPosts[i];
            var postId = getPostId($post);
            if (!postId || convertedPostIds.has(postId)) continue;
            var mid = getMidFromPost($post);
            mids.push(mid);
            var reactionData = getReactionData($post);
            var userTitleData = getUserTitleAndIcon($post);
            if (reactionData.hasReactions) postReactions.set(postId, reactionData.reactions);
            postsData.push({
                postId: postId,
                mid: mid,
                originalPost: $post,
                index: i,
                username: getUsername($post),
                groupText: getGroupText($post),
                postCount: getPostCount($post),
                reputation: getReputation($post),
                isOnline: getIsOnline($post),
                userTitle: userTitleData.title,
                rankIconClass: userTitleData.iconClass,
                contentHtml: getCleanContent($post),
                signatureHtml: getSignatureHtml($post),
                editInfo: getEditInfo($post),
                likes: getLikes($post),
                hasReactions: reactionData.hasReactions,
                reactionCount: reactionData.reactionCount,
                reactions: reactionData.reactions,
                ipAddress: getMaskedIp($post),
                timeAgo: getTimeAgo($post)
            });
            convertedPostIds.add(postId);
        }

        await fetchMultipleUsers(mids);

        for (var i = 0; i < postsData.length; i++) {
            var data = postsData[i];
            var apiUser = data.mid ? userDataCache.get(data.mid) : null;
            var completeData = Object.assign({}, data, {
                apiUser: apiUser,
                postNumber: i + 1
            });
            var cardHtml = generateModernPost(completeData);
            var temp = document.createElement('div');
            temp.innerHTML = cardHtml;
            var card = temp.firstElementChild;
            container.appendChild(card);
        }

        attachEventHandlers();

        if (EventBus) EventBus.trigger('posts:ready', { count: postsData.length });
        console.log('[PostsModule] Ready - ' + postsData.length + ' posts converted (API-enhanced)');
    }

    // ============================================================================
    // INITIALIZE (fixed – added missing reaction observer registrations)
    // ============================================================================
    function initialize() {
        if (isInitialized) { console.log('[PostsModule] Already initialized'); return; }
        console.log('[PostsModule] Initializing API-enhanced version...');
        convertAllPosts().catch(err => console.error('[PostsModule] Init error', err));
        isInitialized = true;
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
            // This registration is crucial for displaying reactions
            globalThis.forumObserver.register({
                id: 'posts-module-reactions',
                selector: '.st-emoji-container',
                priority: 'medium',
                callback: function(node) {
                    var postEl = node.closest('.post');
                    if (postEl && isValidPost(postEl)) {
                        var postId = getPostId(postEl);
                        if (postId) {
                            setTimeout(function() {
                                refreshReactionDisplay(postId);
                            }, 100);
                        }
                    }
                }
            });
            // Also refresh when reaction images load
            globalThis.forumObserver.register({
                id: 'posts-module-reaction-images',
                selector: '.st-emoji-preview img',
                priority: 'low',
                callback: function(node) {
                    var postEl = node.closest('.post');
                    if (postEl && isValidPost(postEl)) {
                        var postId = getPostId(postEl);
                        if (postId) {
                            refreshReactionDisplay(postId);
                        }
                    }
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

// Signal that posts module is ready
if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('posts-module-ready'));
}
