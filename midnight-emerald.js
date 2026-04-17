// Forum Modernizer - Pure Vanilla JS with ForumCoreObserver
// No jQuery, no htmx - just native JavaScript

(function() {
    'use strict';

    const CONFIG = {
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container',
        REACTION_DELAY: 500
    };

    // ============================================================================
    // UTILITIES
    // ============================================================================
    
    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function getElement(selector) {
        return document.querySelector(selector);
    }
    
    function getAllElements(selector) {
        return document.querySelectorAll(selector);
    }
    
    function addClass(element, className) {
        if (element && element.classList) {
            element.classList.add(className);
        }
    }
    
    function removeClass(element, className) {
        if (element && element.classList) {
            element.classList.remove(className);
        }
    }
    
    function setStyle(element, property, value) {
        if (element && element.style) {
            element.style[property] = value;
        }
    }
    
    function hideElement(element) {
        setStyle(element, 'display', 'none');
    }
    
    // ============================================================================
    // DATA EXTRACTION
    // ============================================================================
    
    function getPostId($post) {
        var fullId = $post.getAttribute('id');
        if (!fullId) return null;
        return fullId.replace(CONFIG.POST_ID_PREFIX, '');
    }
    
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
    
    function getUserTitle($post) {
        var titleSpan = $post.querySelector('.u_title');
        if (!titleSpan) return 'Member';
        
        var title = titleSpan.textContent.trim();
        if (title === 'Member') {
            var stars = $post.querySelectorAll('.u_rank i.fa-star').length;
            if (stars === 3) return 'Famous';
            if (stars === 2) return 'Senior';
            if (stars === 1) return 'Junior';
        }
        return title;
    }
    
    function getRankIconClass($post) {
        var uRank = $post.querySelector('.u_rank');
        if (!uRank) return 'fa-medal fa-regular';
        
        var icon = uRank.querySelector('i:last-child');
        if (!icon) return 'fa-medal fa-regular';
        
        var classAttr = icon.getAttribute('class') || '';
        var match = classAttr.match(/fa-(regular|solid|light|brands)?\s*fa-([a-z0-9-]+)/i);
        if (match) {
            var style = match[1] ? 'fa-' + match[1] : 'fa-regular';
            return style + ' fa-' + match[2];
        }
        return 'fa-medal fa-regular';
    }
    
    function getCleanContent($post) {
        var contentTable = $post.querySelector('.right.Item table.color');
        if (!contentTable) return '';
        
        var contentClone = contentTable.cloneNode(true);
        
        // Remove signature and edit elements
        var signatures = contentClone.querySelectorAll('.signature, .edit');
        signatures.forEach(function(el) { el.remove(); });
        
        // Remove bottomborder
        var borders = contentClone.querySelectorAll('.bottomborder');
        borders.forEach(function(el) { el.remove(); });
        
        // Remove extra <br> tags around bottomborder
        var breaks = contentClone.querySelectorAll('br');
        breaks.forEach(function(br) {
            var prev = br.previousElementSibling;
            var next = br.nextElementSibling;
            if ((prev && prev.tagName === 'BR') || 
                (next && next.classList && next.classList.contains('bottomborder')) ||
                (prev && prev.classList && prev.classList.contains('bottomborder'))) {
                br.remove();
            }
        });
        
        return contentClone.innerHTML || '';
    }
    
    function getSignatureHtml($post) {
        var signature = $post.querySelector('.signature');
        return signature ? signature.innerHTML : '';
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
        
        var counters = $post.querySelectorAll('.st-emoji-post .st-emoji-counter');
        counters.forEach(function(counter) {
            hasReactions = true;
            var count = parseInt(counter.getAttribute('data-count') || counter.textContent || 1);
            reactionCount += count;
        });
        
        if (!hasReactions && $post.querySelector('.st-emoji-container')) {
            hasReactions = true;
        }
        
        return { hasReactions: hasReactions, reactionCount: reactionCount };
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
        
        return {
            postId: postId,
            username: getUsername($post),
            avatarUrl: getAvatarUrl($post),
            groupText: getGroupText($post),
            roleBadgeClass: getGroupText($post) === 'Administrator' ? 'admin' : 'member',
            postCount: getPostCount($post),
            reputation: getReputation($post),
            isOnline: getIsOnline($post),
            userTitle: getUserTitle($post),
            rankIconClass: getRankIconClass($post),
            contentHtml: getCleanContent($post),
            signatureHtml: getSignatureHtml($post),
            editInfo: getEditInfo($post),
            likes: getLikes($post),
            hasReactions: reactionData.hasReactions,
            reactionCount: reactionData.reactionCount,
            ipAddress: getMaskedIp($post),
            postNumber: getPostNumber($post, index),
            timeAgo: getTimeAgo($post)
        };
    }
    
    // ============================================================================
    // GENERATE MODERN CARD (string concatenation, no template literals)
    // ============================================================================
    
    function generateModernPost(data) {
        if (!data) return '';
        
        var statusColor = data.isOnline ? '#10B981' : '#6B7280';
        var statusText = data.isOnline ? 'Online' : 'Offline';
        var repSign = data.reputation > 0 ? '+' : '';
        
        // Like button HTML
        var likeButton = '<button class="reaction-btn" aria-label="Like this post" data-pid="' + data.postId + '">' +
            '<i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>';
        if (data.likes > 0) {
            likeButton += '<span class="reaction-count" aria-label="' + data.likes + ' likes">' + data.likes + '</span>';
        }
        likeButton += '</button>';
        
        // React button HTML
        var reactButton = '';
        if (data.hasReactions) {
            reactButton = '<button class="reaction-btn reaction-placeholder" aria-label="Add a reaction" data-pid="' + data.postId + '">' +
                '<img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" width="16" height="16" alt="Laughing face emoji">';
            if (data.reactionCount > 0) {
                reactButton += '<span class="reaction-count" aria-label="' + data.reactionCount + ' reactions">' + data.reactionCount + '</span>';
            }
            reactButton += '</button>';
        } else {
            reactButton = '<button class="reaction-btn" aria-label="Add a reaction" data-pid="' + data.postId + '">' +
                '<i class="fa-regular fa-face-smile" aria-hidden="true"></i>' +
                '</button>';
        }
        
        // Edit indicator HTML
        var editHtml = '';
        if (data.editInfo) {
            editHtml = '<div class="edit-indicator" aria-label="Post has been edited">' +
                '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ' + escapeHtml(data.editInfo) +
                '</div>';
        }
        
        // Signature HTML
        var signatureHtml = '';
        if (data.signatureHtml) {
            signatureHtml = '<div class="signature-modern" aria-label="User signature">' + data.signatureHtml + '</div>';
        }
        
        // IP HTML
        var ipHtml = '';
        if (data.ipAddress) {
            ipHtml = '<div class="ip-info" aria-label="IP address (masked)">' +
                '<i class="fa-regular fa-globe" aria-hidden="true"></i> IP: ' + data.ipAddress +
                '</div>';
        }
        
        // Avatar URL
        var avatarUrl = data.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(data.username);
        
        return '<div class="post-card" data-post-id="' + data.postId + '" data-original-id="' + CONFIG.POST_ID_PREFIX + data.postId + '">' +
            '<div class="post-header-modern">' +
                '<div class="post-meta-left">' +
                    '<div class="post-number-badge" aria-label="Post number ' + data.postNumber + '">' +
                        '<i class="fas fa-hashtag" aria-hidden="true"></i> ' + data.postNumber +
                    '</div>' +
                    '<div class="post-timestamp">' +
                        '<time>' + data.timeAgo + '</time>' +
                    '</div>' +
                '</div>' +
                '<div class="action-buttons-group" role="group" aria-label="Post actions">' +
                    '<button class="action-icon" title="Quote" aria-label="Quote this post" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-quote-left" aria-hidden="true"></i>' +
                    '</button>' +
                    '<button class="action-icon" title="Edit" aria-label="Edit this post" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>' +
                    '</button>' +
                    '<button class="action-icon" title="Share" aria-label="Share this post" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>' +
                    '</button>' +
                    '<button class="action-icon report-action" title="Report" aria-label="Report this post" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i>' +
                    '</button>' +
                    '<button class="action-icon delete-action" title="Delete" aria-label="Delete this post" data-pid="' + data.postId + '">' +
                        '<i class="fa-regular fa-trash-can" aria-hidden="true"></i>' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="user-area">' +
                '<div class="avatar-modern">' +
                    '<img class="avatar-circle" src="' + avatarUrl + '" alt="Avatar of ' + escapeHtml(data.username) + '" width="70" height="70" loading="lazy">' +
                '</div>' +
                '<div class="user-details">' +
                    '<div class="username-row">' +
                        '<span class="username">' + escapeHtml(data.username) + '</span>' +
                    '</div>' +
                    '<div class="badge-container">' +
                        '<span class="role-badge ' + data.roleBadgeClass + '" aria-label="Role: ' + escapeHtml(data.groupText || 'Member') + '">' +
                            escapeHtml(data.groupText || 'Member') +
                        '</span>' +
                    '</div>' +
                    '<div class="user-stats-grid" aria-label="User statistics">' +
                        '<span class="stat-pill" aria-label="User title: ' + data.userTitle + '">' +
                            '<i class="' + data.rankIconClass + '" aria-hidden="true"></i> ' + data.userTitle +
                        '</span>' +
                        '<span class="stat-pill" aria-label="Post count: ' + data.postCount + '">' +
                            '<i class="fa-regular fa-comments" aria-hidden="true"></i> ' + data.postCount + ' posts' +
                        '</span>' +
                        '<span class="stat-pill" aria-label="Reputation: ' + repSign + data.reputation + '">' +
                            '<i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> ' + repSign + data.reputation + ' rep' +
                        '</span>' +
                        '<span class="stat-pill" aria-label="Status: ' + statusText + '">' +
                            '<i class="fa-regular fa-circle" style="color: ' + statusColor + '" aria-hidden="true"></i> ' + statusText +
                        '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="post-body">' +
                '<div class="post-text-content">' +
                    data.contentHtml +
                    editHtml +
                '</div>' +
                signatureHtml +
            '</div>' +
            '<div class="post-footer-modern">' +
                '<div class="reaction-cluster" role="group" aria-label="Post reactions">' +
                    likeButton +
                    reactButton +
                '</div>' +
                ipHtml +
            '</div>' +
        '</div>';
    }
    
    // ============================================================================
    // REACTION DISPLAY REFRESH
    // ============================================================================
    
    function refreshReactionDisplay(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return;
        
        var countEl = originalPost.querySelector('.st-emoji-post .st-emoji-counter');
        if (!countEl) return;
        
        var count = countEl.getAttribute('data-count') || countEl.textContent;
        var modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) return;
        
        var modernReactBtn = modernCard.querySelector('.reaction-btn:last-child');
        if (!modernReactBtn) return;
        
        var span = modernReactBtn.querySelector('.reaction-count');
        if (!span && count > 0) {
            span = document.createElement('span');
            span.className = 'reaction-count';
            modernReactBtn.appendChild(span);
        }
        if (span) span.textContent = count;
    }
    
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    
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
            buttonElement.innerHTML = '<i class="fas fa-check"></i>';
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
    
    function handleLike(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        
        var likeBtn = originalPost.querySelector('.points .points_up');
        if (likeBtn) {
            var onclickAttr = likeBtn.getAttribute('onclick');
            if (onclickAttr) {
                eval(onclickAttr);
            } else {
                likeBtn.click();
            }
        }
        setTimeout(function() {
            refreshReactionDisplay(pid);
        }, CONFIG.REACTION_DELAY);
    }
    
    function handleReact(pid, buttonElement) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        
        var emojiContainer = originalPost.querySelector('.st-emoji-container');
        if (emojiContainer) {
            emojiContainer.click();
        } else {
            handleLike(pid);
        }
        setTimeout(function() {
            refreshReactionDisplay(pid);
        }, CONFIG.REACTION_DELAY);
    }
    
    // ============================================================================
    // ATTACH EVENT LISTENERS (Event Delegation)
    // ============================================================================
    
    function attachEventHandlers() {
        // Quote buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[title="Quote"], .action-icon[data-action="quote"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleQuote(pid);
            }
        });
        
        // Edit buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[title="Edit"], .action-icon[data-action="edit"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleEdit(pid);
            }
        });
        
        // Delete buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[title="Delete"], .action-icon[data-action="delete"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleDelete(pid);
            }
        });
        
        // Share buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[title="Share"], .action-icon[data-action="share"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleShare(pid, btn);
            }
        });
        
        // Report buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[title="Report"], .action-icon[data-action="report"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleReport(pid);
            }
        });
        
        // Like buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.reaction-btn[data-action="like"], .reaction-btn:has(.fa-thumbs-up)');
            if (btn && btn.querySelector('.fa-thumbs-up')) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleLike(pid);
            }
        });
        
        // React buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.reaction-btn[data-action="react"], .reaction-btn:has(.fa-face-smile), .reaction-btn:has(img)');
            if (btn && (btn.querySelector('.fa-face-smile') || btn.querySelector('img'))) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleReact(pid, btn);
            }
        });
    }
    
    // ============================================================================
    // CONVERT POST TO MODERN
    // ============================================================================
    
    function convertToModern(postEl, index) {
        var postId = postEl.getAttribute('id');
        if (!postId) return;
        
        var existingCard = document.querySelector('.post-card[data-original-id="' + postId + '"]');
        if (existingCard) return;
        
        var data = extractPostData(postEl, index);
        if (!data) return;
        
        var modernHTML = generateModernPost(data);
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = modernHTML;
        var newCard = tempDiv.firstElementChild;
        
        postEl.parentNode.insertBefore(newCard, postEl.nextSibling);
    }
    
    // ============================================================================
    // HIDE ORIGINAL POSTS
    // ============================================================================
    
    function hideOriginalPosts() {
        var posts = getAllElements(CONFIG.POST_SELECTOR);
        for (var i = 0; i < posts.length; i++) {
            hideElement(posts[i]);
        }
    }
    
    // ============================================================================
    // INITIALIZE WITH FORUM OBSERVER
    // ============================================================================
    
    function initialize() {
        console.log('[ForumModernizer] Initializing with ForumCoreObserver...');
        
        // Ensure container exists
        var container = document.getElementById(CONFIG.CONTAINER_ID);
        if (!container) {
            var firstPost = document.querySelector(CONFIG.POST_SELECTOR);
            if (firstPost && firstPost.parentElement) {
                firstPost.parentElement.id = CONFIG.CONTAINER_ID;
                container = firstPost.parentElement;
            }
        }
        
        // Convert all existing posts
        var posts = getAllElements(CONFIG.POST_SELECTOR);
        for (var i = 0; i < posts.length; i++) {
            convertToModern(posts[i], i);
        }
        
        // Hide original posts
        hideOriginalPosts();
        
        // Attach event handlers
        attachEventHandlers();
        
        // Register with ForumCoreObserver for dynamic content
        if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
            globalThis.forumObserver.register({
                id: 'forum-modernizer',
                selector: CONFIG.POST_SELECTOR,
                priority: 'high',
                callback: function(node) {
                    // Find index of the post
                    var allPosts = getAllElements(CONFIG.POST_SELECTOR);
                    var index = -1;
                    for (var i = 0; i < allPosts.length; i++) {
                        if (allPosts[i] === node) {
                            index = i;
                            break;
                        }
                    }
                    convertToModern(node, index);
                    hideElement(node);
                }
            });
            
            console.log('[ForumModernizer] Registered with ForumCoreObserver');
        } else {
            console.log('[ForumModernizer] ForumCoreObserver not available, dynamic content will not auto-convert');
        }
        
        console.log('[ForumModernizer] Ready - modern view only');
    }
    
    // Start initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
    
})();
