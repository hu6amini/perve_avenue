// modules/posts.js
// Forum Modernizer - Posts Module
// Transforms .post elements into modern card layout and renders into wrapper container
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
    
    // Avatar color palette
    var AVATAR_COLORS = [
        '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2',
        '#EF476F', '#FFD166', '#06D6A0', '#073B4C', '#7209B7'
    ];
    
    // Track converted posts to prevent duplicates
    var convertedPostIds = new Set();
    var isInitialized = false;
    // Store reaction data for each post
    var postReactions = new Map();
    
    // Store active popup reference
    var activePopup = null;
    
    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    function getPostsContainer() {
        // First try to get the modern wrapper container
        var modernContainer = document.getElementById('modern-posts-container');
        if (modernContainer) {
            return modernContainer;
        }
       
        // Fallback to original container
        var originalContainer = document.getElementById(CONFIG.CONTAINER_ID);
        if (originalContainer) {
            return originalContainer;
        }
       
        // Create container if neither exists
        var newContainer = document.createElement('div');
        newContainer.id = CONFIG.CONTAINER_ID;
        newContainer.className = 'modern-posts-container';
       
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (wrapper) {
            wrapper.appendChild(newContainer);
        } else {
            document.body.appendChild(newContainer);
        }
       
        return newContainer;
    }
    
    function isValidPost(postEl) {
        if (!postEl) return false;
        var id = postEl.getAttribute('id');
        // Must have an ID that starts with 'ee' and is not the body or other elements
        return id && id.startsWith(CONFIG.POST_ID_PREFIX) && postEl.tagName !== 'BODY';
    }
    
    function getPostId($post) {
        var fullId = $post.getAttribute('id');
        if (!fullId) return null;
        if (!fullId.startsWith(CONFIG.POST_ID_PREFIX)) return null;
        return fullId.replace(CONFIG.POST_ID_PREFIX, '');
    }
    
    // ============================================================================
    // AVATAR GENERATION
    // ============================================================================
    function generateLetterAvatar(username, userId) {
        var displayName = username || 'User';
        var firstLetter = displayName.charAt(0).toUpperCase();
        
        if (!firstLetter.match(/[A-Z0-9]/i)) {
            firstLetter = '?';
        }
        
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
        if (backgroundColor.startsWith('#')) {
            backgroundColor = backgroundColor.substring(1);
        }
        
        var params = [
            'seed=' + encodeURIComponent(firstLetter),
            'backgroundColor=' + backgroundColor,
            'radius=50',
            'size=70'
        ];
        
        return 'https://api.dicebear.com/7.x/initials/svg?' + params.join('&');
    }
    
    // ============================================================================
    // CUSTOM REACTION POPUP
    // ============================================================================
    function getAvailableReactions(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return Promise.resolve([]);
        
        // Find the emoji container
        var emojiContainer = originalPost.querySelector('.st-emoji-container');
        if (!emojiContainer) return Promise.resolve([]);
        
        var previewTrigger = emojiContainer.querySelector('.st-emoji-preview');
        if (!previewTrigger) return Promise.resolve([]);
        
        // Temporarily make it visible and trigger click
        var originalDisplay = previewTrigger.style.display;
        previewTrigger.style.display = 'block';
        previewTrigger.click();
        previewTrigger.style.display = originalDisplay;
        
        // Wait for popup to appear and extract emojis
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
                        
                        // Extract emoji name from data-fui or alt
                        var name = dataFui ? dataFui.replace(/:/g, '') : '';
                        if (!name && imgAlt) {
                            name = imgAlt.replace(/:/g, '');
                        }
                        
                        emojis.push({
                            name: name,
                            alt: dataFui || imgAlt,
                            src: imgSrc,
                            rid: el.getAttribute('data-rid')
                        });
                    }
                }
                
                // Close the original popup
                if (originalPopup) {
                    originalPopup.remove();
                }
                
                resolve(emojis);
            }, 150);
        });
    }
    
    function getDefaultEmojis() {
        // Fallback emojis in case the original popup can't be read
        return [
            { name: 'kekw', alt: ':kekw:', src: '', rid: '10' },
            { name: 'rofl', alt: ':rofl:', src: '', rid: '1' }
        ];
    }
    
    function createCustomReactionPopup(buttonElement, postId) {
        // Remove existing popup
        if (activePopup) {
            activePopup.remove();
            activePopup = null;
        }
        
        var buttonRect = buttonElement.getBoundingClientRect();
        
        // Show loading state
        var loadingPopup = document.createElement('div');
        loadingPopup.className = 'custom-reaction-popup loading';
        loadingPopup.style.cssText = `
            position: fixed;
            z-index: 100000;
            background: #1a1a1a;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            padding: 20px;
            border: 1px solid #333;
            left: ${buttonRect.left - 50}px;
            top: ${buttonRect.bottom + 10}px;
            color: white;
            font-size: 14px;
        `;
        loadingPopup.textContent = 'Loading reactions...';
        document.body.appendChild(loadingPopup);
        
        // Fetch available reactions
        getAvailableReactions(postId).then(function(emojis) {
            // Remove loading popup
            loadingPopup.remove();
            
            if (emojis.length === 0) {
                // Fallback to default emojis if none found
                emojis = getDefaultEmojis();
            }
            
            // Create popup container
            var popup = document.createElement('div');
            popup.className = 'custom-reaction-popup';
            popup.style.cssText = `
                position: fixed;
                z-index: 100000;
                background: #1a1a1a;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                padding: 12px;
                border: 1px solid #333;
                left: ${buttonRect.left - 100}px;
                top: ${buttonRect.bottom + 10}px;
            `;
            
            // Create emoji grid
            var emojiGrid = document.createElement('div');
            emojiGrid.style.cssText = `
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 8px;
            `;
            
            // Add emojis
            emojis.forEach(function(emoji) {
                var emojiItem = document.createElement('div');
                emojiItem.className = 'custom-emoji-item';
                emojiItem.style.cssText = `
                    cursor: pointer;
                    padding: 8px;
                    text-align: center;
                    border-radius: 8px;
                    transition: background 0.2s;
                `;
                
                var img = document.createElement('img');
                // Use the original image source or construct from name
                if (emoji.src) {
                    img.src = emoji.src;
                } else {
                    // Fallback to constructed URL
                    img.src = 'https://images.weserv.nl/?url=https://upload.forumfree.net/i/fc11517378/emojis/' + encodeURIComponent(emoji.name) + '.png&output=webp&maxage=1y&q=90&il&af&l=9';
                }
                img.alt = emoji.alt || ':' + emoji.name + ':';
                img.style.cssText = `
                    width: 32px;
                    height: 32px;
                    object-fit: contain;
                `;
                img.loading = 'lazy';
                
                // Handle image loading errors
                img.onerror = function() {
                    // Try twemoji as fallback
                    if (!this.src.includes('twemoji')) {
                        this.src = 'https://twemoji.maxcdn.com/v/latest/svg/1f606.svg';
                    }
                };
                
                emojiItem.appendChild(img);
                
                // Hover effects
                emojiItem.addEventListener('mouseenter', function() {
                    this.style.backgroundColor = '#333';
                });
                emojiItem.addEventListener('mouseleave', function() {
                    this.style.backgroundColor = 'transparent';
                });
                
                // Click handler - trigger original reaction
                emojiItem.addEventListener('click', function() {
                    triggerOriginalReaction(postId, emoji);
                    popup.remove();
                    activePopup = null;
                });
                
                emojiGrid.appendChild(emojiItem);
            });
            
            popup.appendChild(emojiGrid);
            
            // Close popup when clicking outside
            var closeHandler = function(e) {
                if (!popup.contains(e.target) && !e.target.closest('.reaction-btn')) {
                    popup.remove();
                    activePopup = null;
                    document.removeEventListener('click', closeHandler);
                }
            };
            
            // Delay adding the listener to avoid immediate closure
            setTimeout(function() {
                document.addEventListener('click', closeHandler);
            }, 100);
            
            document.body.appendChild(popup);
            activePopup = popup;
        }).catch(function(error) {
            console.error('[PostsModule] Failed to load reactions:', error);
            loadingPopup.textContent = 'Failed to load reactions. Please try again.';
            setTimeout(function() {
                loadingPopup.remove();
            }, 1500);
        });
    }
    
function triggerOriginalReaction(postId, emoji) {
    var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
    if (!originalPost) return;
    
    // Find the emoji container
    var emojiContainer = originalPost.querySelector('.st-emoji-container');
    if (!emojiContainer) return;
    
    // Trigger the preview click to open the original popup
    var previewTrigger = emojiContainer.querySelector('.st-emoji-preview');
    if (!previewTrigger) return;
    
    // Temporarily make the preview trigger visible and click it
    var originalDisplay = previewTrigger.style.display;
    previewTrigger.style.display = 'block';
    previewTrigger.click();
    previewTrigger.style.display = originalDisplay;
    
    // Find and click the original reaction element
    setTimeout(function() {
        var originalPopup = document.querySelector('.st-emoji-pop');
        if (originalPopup) {
            // Make sure the popup is visible
            originalPopup.style.visibility = 'visible';
            originalPopup.style.display = 'block';
            
            var reactionElements = originalPopup.querySelectorAll('.st-emoji-content');
            var found = false;
            
            for (var i = 0; i < reactionElements.length; i++) {
                var el = reactionElements[i];
                var dataFui = el.getAttribute('data-fui');
                var img = el.querySelector('img');
                var imgAlt = img ? img.getAttribute('alt') : '';
                
                // Match by data-fui, alt text, or name
                if (dataFui === emoji.alt || 
                    imgAlt === emoji.alt || 
                    dataFui === ':' + emoji.name + ':' ||
                    (emoji.rid && el.getAttribute('data-rid') === emoji.rid)) {
                    console.log('[PostsModule] Triggering reaction:', emoji.alt || emoji.name);
                    // Trigger both mousedown and click for better compatibility
                    var clickEvent = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    el.dispatchEvent(clickEvent);
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                console.warn('[PostsModule] Could not find reaction:', emoji);
                // Try clicking the first reaction as fallback
                if (reactionElements.length > 0) {
                    console.log('[PostsModule] Falling back to first reaction');
                    var clickEvent = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    reactionElements[0].dispatchEvent(clickEvent);
                }
            }
            
            // Don't close the original popup immediately - let the reaction register
            // The popup will close naturally after the reaction is applied
            setTimeout(function() {
                // Check if popup still exists and close it
                var stillOpen = document.querySelector('.st-emoji-pop');
                if (stillOpen && stillOpen.parentNode) {
                    stillOpen.remove();
                }
            }, 500);
        }
        
        // Refresh the reaction display
        setTimeout(function() {
            refreshReactionDisplay(postId);
        }, CONFIG.REACTION_DELAY);
    }, 200);
}
    
    // ============================================================================
    // EMBEDDED LINK TRANSFORMATION
    // ============================================================================
    function transformEmbeddedLinks(htmlContent) {
        if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;
        
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        
        var embedContainers = tempDiv.querySelectorAll('.ffb_embedlink');
        
        for (var i = 0; i < embedContainers.length; i++) {
            var container = embedContainers[i];
            var modernEmbed = convertToModernEmbed(container);
            if (modernEmbed) {
                container.parentNode.replaceChild(modernEmbed, container);
            }
        }
        
        return tempDiv.innerHTML;
    }
    
    function convertToModernEmbed(originalContainer) {
        try {
            var allLinks = originalContainer.querySelectorAll('a');
            var mainLink = null;
            var titleLink = null;
            var description = '';
            var imageUrl = null;
            var faviconUrl = null;
            
            for (var i = 0; i < allLinks.length; i++) {
                var link = allLinks[i];
                var text = link.textContent.trim();
                var href = link.getAttribute('href');
                
                if (!href) continue;
                
                if (!mainLink) {
                    mainLink = href;
                }
                
                if (text && text.length > 10 && 
                    !text.includes('Leggi altro') && 
                    !text.includes('Read more') &&
                    !text.includes('F24.MY') &&
                    text !== extractDomain(href)) {
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
            if (paragraphs.length > 0) {
                description = paragraphs[0].textContent.trim();
            }
            
            var imgElement = originalContainer.querySelector('.ffb_embedlink_preview img');
            if (imgElement && imgElement.getAttribute('src')) {
                imageUrl = imgElement.getAttribute('src');
            }
            
            var hiddenDiv = originalContainer.querySelector('div[style="display:none"]');
            if (hiddenDiv) {
                var faviconImg = hiddenDiv.querySelector('img');
                if (faviconImg && faviconImg.getAttribute('src')) {
                    faviconUrl = faviconImg.getAttribute('src');
                }
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
                if (faviconUrl) {
                    modernHtml += '<img src="' + faviconUrl + '" alt="" class="embedded-link-favicon" loading="lazy" decoding="async" width="16" height="16" style="width: 16px; height: 16px; object-fit: contain; display: inline-block; vertical-align: middle;">';
                }
                modernHtml += '<span>' + Utils.escapeHtml(domain) + '</span></div>';
            }
            
            modernHtml += '<h3 class="embedded-link-title">' + Utils.escapeHtml(title) + '</h3>';
            
            if (description) {
                modernHtml += '<p class="embedded-link-description">' + Utils.escapeHtml(description.substring(0, 200)) + (description.length > 200 ? '…' : '') + '</p>';
            }
            
            modernHtml += '<div class="embedded-link-meta">' +
                '<span class="embedded-link-read-more">Read more on ' + Utils.escapeHtml(domain) + ' ›</span>' +
                '</div>' +
                '</div>' +
                '</a>' +
                '</div>';
            
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
            if (hostname.startsWith('www.')) {
                hostname = hostname.substring(4);
            }
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
    // DATA EXTRACTION
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
            if (classAttr.includes('fa-solid')) {
                classAttr = classAttr.replace('fa-solid', 'fa-regular');
            }
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
        
        return { 
            hasReactions: hasReactions, 
            reactionCount: reactionCount,
            reactions: reactions
        };
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
        if (diffDays >= 1) {
            return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
        }
        var diffHours = Math.floor((now - postDate) / 3600000);
        if (diffHours >= 1) {
            return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
        }
        return 'Just now';
    }
    
    function extractPostData($post, index) {
        var postId = getPostId($post);
        if (!postId) return null;
        var reactionData = getReactionData($post);
        var userTitleData = getUserTitleAndIcon($post);
        
        if (reactionData.hasReactions) {
            postReactions.set(postId, reactionData.reactions);
        }
        
        return {
            postId: postId,
            username: getUsername($post),
            originalAvatarUrl: getAvatarUrl($post),
            groupText: getGroupText($post),
            roleBadgeClass: getGroupText($post) === 'Administrator' ? 'admin' : 'member',
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
            postNumber: getPostNumber($post, index),
            timeAgo: getTimeAgo($post)
        };
    }
    
    // ============================================================================
    // GENERATE REACTION BUTTONS HTML
    // ============================================================================
    function generateReactionButtons(data) {
        if (!data.hasReactions || data.reactionCount === 0) {
            return '<button class="reaction-btn reaction-add-btn" aria-label="Add a reaction" data-pid="' + data.postId + '">' +
                '<i class="fa-regular fa-face-smile" aria-hidden="true"></i>' +
                '</button>';
        }
        
        var reactionHtml = '<div class="reactions-container" data-pid="' + data.postId + '">';
        
        var reactionMap = new Map();
        
        for (var i = 0; i < data.reactions.length; i++) {
            var reaction = data.reactions[i];
            var src = reaction.src;
            if (reactionMap.has(src)) {
                var existing = reactionMap.get(src);
                existing.count++;
            } else {
                reactionMap.set(src, {
                    src: src,
                    alt: reaction.alt,
                    name: reaction.name,
                    count: 1
                });
            }
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
    // GENERATE MODERN CARD
    // ============================================================================
    function generateModernPost(data) {
        if (!data) return '';
        var statusColor = data.isOnline ? '#10B981' : '#6B7280';
        var statusText = data.isOnline ? 'Online' : 'Offline';
        
        var likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '">' +
            '<i class="fa-regular fa-thumbs-up like-icon" aria-hidden="true"></i>';
        if (data.likes > 0) {
            likeButton += '<span class="like-count like-count-display">' + data.likes + '</span>';
        }
        likeButton += '</button>';
        
        var reactionsHtml = generateReactionButtons(data);
        
        var editHtml = '';
        if (data.editInfo) {
            editHtml = '<div class="post-edit-info">' +
                ' <small>' + Utils.escapeHtml(data.editInfo) + '</small>' +
                '</div>';
        }
        
        var signatureHtml = '';
        if (data.signatureHtml) {
            signatureHtml = '<div class="post-signature">' + data.signatureHtml + '</div>';
        }
        
        var ipHtml = '';
        if (data.ipAddress) {
            ipHtml = '<div class="post-ip">' +
                ' IP: ' + data.ipAddress +
                '</div>';
        }
        
        var avatarUrl;
        if (data.originalAvatarUrl && data.originalAvatarUrl.trim() !== '') {
            avatarUrl = data.originalAvatarUrl;
        } else {
            avatarUrl = generateLetterAvatar(data.username, data.postId);
        }
        
        var avatarHtml = '<div class="post-avatar" data-pid="' + data.postId + '">' +
            '<img class="avatar-circle" src="' + avatarUrl + '" alt="Avatar of ' + Utils.escapeHtml(data.username) + '" width="70" height="70" loading="lazy" onerror="this.onerror=null; this.src=\'' + generateLetterAvatar(data.username, data.postId) + '\';">' +
        '</div>';
        
        return '<article class="post-card" data-original-id="' + CONFIG.POST_ID_PREFIX + data.postId + '" data-post-id="' + data.postId + '" aria-labelledby="post-title-' + data.postId + '">' +
            '<header class="post-card-header">' +
                '<div class="post-meta">' +
                    '<div class="post-number">' +
                        '<i class="fa-regular fa-hashtag" aria-hidden="true"></i> ' + data.postNumber +
                    '</div>' +
                    '<div class="post-time">' +
                        '<time datetime="' + new Date().toISOString() + '">' + data.timeAgo + '</time>' +
                    '</div>' +
                '</div>' +
                '<div class="post-actions">' +
                    '<button class="action-icon" title="Quote" aria-label="Quote this post" data-action="quote" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-quote-left" aria-hidden="true"></i>' +
                    '</button>' +
                    '<button class="action-icon" title="Edit" aria-label="Edit this post" data-action="edit" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>' +
                    '</button>' +
                    '<button class="action-icon" title="Share" aria-label="Share this post" data-action="share" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>' +
                    '</button>' +
                    '<button class="action-icon report-action" title="Report" aria-label="Report this post" data-action="report" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i>' +
                    '</button>' +
                    '<button class="action-icon delete-action" title="Delete" aria-label="Delete this post" data-action="delete" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-trash-can" aria-hidden="true"></i>' +
                    '</button>' +
                '</div>' +
            '</header>' +
            '<div class="post-card-body">' +
                avatarHtml +
                '<div class="post-user-info">' +
                    '<div class="user-name" data-pid="' + data.postId + '">' +
                        Utils.escapeHtml(data.username) +
                    '</div>' +
                    '<div class="user-group">' +
                        '<span class="role-badge ' + data.roleBadgeClass + '">' +
                            Utils.escapeHtml(data.groupText || 'Member') +
                        '</span>' +
                    '</div>' +
                    '<div class="user-stats">' +
                        '<div class="user-rank">' +
                            '<i class="' + data.rankIconClass + '" aria-hidden="true"></i> ' + data.userTitle +
                        '</div>' +
                        '<div class="user-posts">' +
                            '<i class="fa-regular fa-message" aria-hidden="true"></i> ' + data.postCount + ' posts' +
                        '</div>' +
                        '<div class="user-reputation">' +
                            '<i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> ' + data.reputation + ' rep' +
                        '</div>' +
                        '<div class="user-status" style="color: ' + statusColor + '">' +
                            '<i class="fa-regular fa-circle" aria-hidden="true"></i> ' + statusText +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="post-content">' +
                '<div class="post-message">' +
                    data.contentHtml +
                    editHtml +
                '</div>' +
                signatureHtml +
            '</div>' +
            '<footer class="post-footer">' +
                '<div class="post-reactions">' +
                    likeButton +
                    reactionsHtml +
                '</div>' +
                ipHtml +
            '</footer>' +
        '</article>';
    }
    
    // ============================================================================
    // LIKE DISPLAY REFRESH
    // ============================================================================
    function refreshLikeDisplay(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return;
        
        var pointsPos = originalPost.querySelector('.points .points_pos');
        var newLikeCount = 0;
        if (pointsPos) {
            newLikeCount = parseInt(pointsPos.textContent) || 0;
        }
        
        var modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) return;
        
        var likeBtn = modernCard.querySelector('.like-btn');
        if (!likeBtn) return;
        
        var likeCountSpan = likeBtn.querySelector('.like-count-display');
        if (newLikeCount > 0) {
            if (likeCountSpan) {
                likeCountSpan.textContent = newLikeCount;
            } else {
                var newSpan = document.createElement('span');
                newSpan.className = 'like-count like-count-display';
                newSpan.textContent = newLikeCount;
                likeBtn.appendChild(newSpan);
            }
        } else {
            if (likeCountSpan) {
                likeCountSpan.remove();
            }
        }
    }
    
    // ============================================================================
    // REACTION DISPLAY REFRESH
    // ============================================================================
    function refreshReactionDisplay(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) {
            return;
        }
        
        var reactionData = getReactionData(originalPost);
        
        var modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) {
            return;
        }
        
        var postReactionsDiv = modernCard.querySelector('.post-reactions');
        if (!postReactionsDiv) return;
        
        if (reactionData.reactions.length > 0) {
            postReactions.set(postId, reactionData.reactions);
        }
        
        var likeButton = postReactionsDiv.querySelector('.like-btn');
        var likeButtonHtml = likeButton ? likeButton.outerHTML : '';
        
        var newReactionsHtml = generateReactionButtons({
            postId: postId,
            hasReactions: reactionData.hasReactions,
            reactionCount: reactionData.reactionCount,
            reactions: reactionData.reactions
        });
        
        if (likeButtonHtml) {
            postReactionsDiv.innerHTML = likeButtonHtml + newReactionsHtml;
        } else {
            postReactionsDiv.innerHTML = newReactionsHtml;
        }
    }
    
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    function handleAvatarClick(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        
        var avatarLink = originalPost.querySelector('.avatar');
        if (avatarLink && avatarLink.tagName === 'A') {
            avatarLink.click();
        }
    }
    
    function handleUsernameClick(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        
        var nickLink = originalPost.querySelector('.nick a');
        if (nickLink) {
            nickLink.click();
        }
    }
    
    function handleQuote(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var quoteLink = originalPost.querySelector('a[href*="CODE=02"]');
        if (quoteLink) {
            window.location.href = quoteLink.getAttribute('href');
        }
    }
    
    function handleEdit(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var editLink = originalPost.querySelector('a[href*="CODE=08"]');
        if (editLink) {
            window.location.href = editLink.getAttribute('href');
        }
    }
    
    function handleDelete(pid) {
        if (confirm('Are you sure you want to delete this post?')) {
            if (typeof window.delete_post === 'function') {
                window.delete_post(pid);
            }
        }
    }
    
    function handleShare(pid, buttonElement) {
        var url = window.location.href.split('#')[0] + '#entry' + pid;
        navigator.clipboard.writeText(url).then(function() {
            var originalHtml = buttonElement.innerHTML;
            buttonElement.innerHTML = '<i class="fa-regular fa-check" aria-hidden="true"></i>';
            setTimeout(function() {
                buttonElement.innerHTML = originalHtml;
            }, 1500);
        }).catch(function(err) {
            console.error('Copy failed:', err);
        });
    }
    
    function handleReport(pid) {
        var reportBtn = document.getElementById(CONFIG.POST_ID_PREFIX + pid + ' .report_button');
        if (!reportBtn) {
            reportBtn = document.querySelector('.report_button[data-pid="' + pid + '"]');
        }
        if (reportBtn) {
            reportBtn.click();
        }
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
                    var href = overlayLink.getAttribute('href');
                    
                    if (typeof $ !== 'undefined' && $.fn.overlay) {
                        if (!overlayLink.hasAttribute('data-overlay-init')) {
                            $(overlayLink).overlay({
                                onBeforeLoad: function() {
                                    var wrap = this.getOverlay();
                                    var content = wrap.find('div');
                                    content.html('<p><img src="https://img.forumfree.net/index_file/loads3.gif"></p>')
                                        .load(href + '&popup=1');
                                }
                            });
                            overlayLink.setAttribute('data-overlay-init', 'true');
                        }
                        $(overlayLink).trigger('click');
                        return;
                    } else {
                        var mouseoverEvent = new MouseEvent('mouseover', {
                            view: window,
                            bubbles: true,
                            cancelable: true
                        });
                        overlayLink.dispatchEvent(mouseoverEvent);
                        
                        setTimeout(function() {
                            var clickEvent = new MouseEvent('click', {
                                view: window,
                                bubbles: true,
                                cancelable: true
                            });
                            overlayLink.dispatchEvent(clickEvent);
                        }, 50);
                        return;
                    }
                }
            }
            
            var pointsPosDirect = pointsContainer.querySelector('.points_pos');
            if (pointsPosDirect) {
                pointsPosDirect.click();
                return;
            }
            
            var anyLink = pointsContainer.querySelector('a[href*="votes"]');
            if (anyLink) {
                anyLink.click();
                return;
            }
            return;
        }
        
        var undoButton = pointsContainer.querySelector('.bullet_delete');
        
        if (undoButton) {
            var undoOnclick = undoButton.getAttribute('onclick');
            if (undoOnclick) {
                eval(undoOnclick);
            } else {
                undoButton.click();
            }
        } else {
            var likeBtn = pointsContainer.querySelector('.points_up');
            
            if (likeBtn) {
                if (likeBtn.tagName === 'A') {
                    var likeOnclick = likeBtn.getAttribute('onclick');
                    if (likeOnclick) {
                        eval(likeOnclick);
                    } else {
                        likeBtn.click();
                    }
                } else {
                    var onclickAttr = likeBtn.getAttribute('onclick');
                    if (onclickAttr) {
                        eval(onclickAttr);
                    } else {
                        likeBtn.click();
                    }
                }
            } else {
                var pointsUpLink = pointsContainer.querySelector('a[href*="points_up"], a[onclick*="points_up"]');
                if (pointsUpLink) {
                    var upOnclick = pointsUpLink.getAttribute('onclick');
                    if (upOnclick) {
                        eval(upOnclick);
                    } else {
                        pointsUpLink.click();
                    }
                }
            }
        }
        
        setTimeout(function() {
            refreshLikeDisplay(pid);
            refreshReactionDisplay(pid);
        }, CONFIG.REACTION_DELAY);
    }
    
    // Custom reaction handler
    function handleReact(pid, buttonElement) {
        // Create custom popup instead of trying to trigger the original
        createCustomReactionPopup(buttonElement, pid);
    }
    
    // ============================================================================
    // ATTACH EVENT LISTENERS
    // ============================================================================
    function attachEventHandlers() {
        document.addEventListener('click', function(e) {
            var avatarDiv = e.target.closest('.post-avatar');
            if (avatarDiv) {
                e.preventDefault();
                var pid = avatarDiv.getAttribute('data-pid');
                if (pid) handleAvatarClick(pid);
            }
        });
        
        document.addEventListener('click', function(e) {
            var userNameDiv = e.target.closest('.user-name');
            if (userNameDiv) {
                e.preventDefault();
                var pid = userNameDiv.getAttribute('data-pid');
                if (pid) handleUsernameClick(pid);
            }
        });
        
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="quote"], .action-icon[title="Quote"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleQuote(pid);
            }
        });
        
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="edit"], .action-icon[title="Edit"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleEdit(pid);
            }
        });
        
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="delete"], .action-icon[title="Delete"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleDelete(pid);
            }
        });
        
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="share"], .action-icon[title="Share"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleShare(pid, btn);
            }
        });
        
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="report"], .action-icon[title="Report"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleReport(pid);
            }
        });
        
        document.addEventListener('click', function(e) {
            var likeBtn = e.target.closest('.like-btn');
            if (likeBtn) {
                e.preventDefault();
                var pid = likeBtn.getAttribute('data-pid');
                if (pid) {
                    var isCountClick = e.target.classList && e.target.classList.contains('like-count-display');
                    handleLike(pid, isCountClick);
                }
            }
        });
        
        // Reaction button handler
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.reaction-btn:not(.like-btn)');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleReact(pid, btn);
            }
        });
        
        // Close popup when pressing escape
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && activePopup) {
                activePopup.remove();
                activePopup = null;
            }
        });
    }
    
    // ============================================================================
    // CONVERT TO MODERN CARD (returns card element)
    // ============================================================================
    function convertToModernCard(postEl, index) {
        if (!isValidPost(postEl)) return null;
       
        var postId = getPostId(postEl);
        if (!postId) return null;
       
        if (convertedPostIds.has(postId)) {
            return null;
        }
       
        var data = extractPostData(postEl, index);
        if (!data) return null;
       
        var modernHTML = generateModernPost(data);
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = modernHTML;
        var newCard = tempDiv.firstElementChild;
       
        newCard.setAttribute('data-original-id', postEl.id);
        convertedPostIds.add(postId);
       
        if (EventBus) {
            EventBus.trigger('post:converted', { postId: postId, element: postEl, card: newCard });
        }
       
        return newCard;
    }
    
    // ============================================================================
    // INITIALIZE
    // ============================================================================
    function initialize() {
        if (isInitialized) {
            console.log('[PostsModule] Already initialized, skipping');
            return;
        }
       
        console.log('[PostsModule] Initializing...');
        var container = getPostsContainer();
       
        if (container) {
            container.innerHTML = '';
        }
       
        convertedPostIds.clear();
        postReactions.clear();
       
        var posts = Utils.getAllElements(CONFIG.POST_SELECTOR);
        var validPosts = 0;
       
        for (var i = 0; i < posts.length; i++) {
            if (isValidPost(posts[i])) {
                var modernCard = convertToModernCard(posts[i], validPosts);
                if (modernCard) {
                    container.appendChild(modernCard);
                    validPosts++;
                }
            }
        }
       
        attachEventHandlers();
       
        if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
            globalThis.forumObserver.register({
                id: 'posts-module',
                selector: CONFIG.POST_SELECTOR,
                priority: 'high',
                callback: function(node) {
                    if (!isValidPost(node)) return;
                   
                    var postId = getPostId(node);
                   
                    if (convertedPostIds.has(postId)) {
                        return;
                    }
                   
                    var allPosts = Utils.getAllElements(CONFIG.POST_SELECTOR);
                    var validIndex = 0;
                    for (var i = 0; i < allPosts.length; i++) {
                        if (isValidPost(allPosts[i])) {
                            if (allPosts[i] === node) {
                                var modernCard = convertToModernCard(node, validIndex);
                                if (modernCard) {
                                    var container = getPostsContainer();
                                    if (container) {
                                        container.appendChild(modernCard);
                                    }
                                }
                                break;
                            }
                            validIndex++;
                        }
                    }
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
                            setTimeout(function() {
                                refreshReactionDisplay(postId);
                            }, 100);
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
                        if (postId) {
                            refreshReactionDisplay(postId);
                        }
                    }
                }
            });
            
            console.log('[PostsModule] Registered with ForumCoreObserver');
        } else {
            console.log('[PostsModule] ForumCoreObserver not available, dynamic content will not auto-convert');
        }
       
        isInitialized = true;
       
        if (EventBus) {
            EventBus.trigger('posts:ready', { count: validPosts });
        }
       
        console.log('[PostsModule] Ready - ' + validPosts + ' posts converted');
    }
    
    // ============================================================================
    // PUBLIC API
    // ============================================================================
    return {
        initialize: initialize,
        convertToModernCard: convertToModernCard,
        refreshReactionDisplay: refreshReactionDisplay,
        refreshLikeDisplay: refreshLikeDisplay,
        getPostsContainer: getPostsContainer,
        isValidPost: isValidPost,
        reset: function() {
            convertedPostIds.clear();
            postReactions.clear();
            isInitialized = false;
            if (activePopup) {
                activePopup.remove();
                activePopup = null;
            }
        },
        CONFIG: CONFIG
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);

// Signal that posts module is ready
if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('posts-module-ready'));
}
