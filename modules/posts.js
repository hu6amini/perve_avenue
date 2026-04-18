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
        CONTAINER_ID: 'modern-posts-container',
        REACTION_DELAY: 500,
        BATCH_SIZE: 20,
        ENABLE_ANIMATIONS: true
    };
    
    // Track converted posts to prevent duplicates
    var convertedPostIds = new Set();
    var isInitialized = false;
    var processingQueue = [];
    var isProcessing = false;
    
    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================
    function getPostsContainer() {
        // First try to get the modern wrapper container (matches CSS)
        var modernContainer = document.getElementById(CONFIG.CONTAINER_ID);
        if (modernContainer) {
            return modernContainer;
        }
        
        // Try to find within wrapper
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (wrapper) {
            modernContainer = wrapper.querySelector('.modern-posts-container');
            if (modernContainer) {
                return modernContainer;
            }
            // Create if doesn't exist
            modernContainer = document.createElement('div');
            modernContainer.id = CONFIG.CONTAINER_ID;
            modernContainer.className = 'modern-posts-container';
            wrapper.appendChild(modernContainer);
            return modernContainer;
        }
        
        // Final fallback - create wrapper and container
        var newWrapper = document.createElement('div');
        newWrapper.id = 'modern-forum-wrapper';
        newWrapper.className = 'modern-forum-wrapper';
        document.body.insertBefore(newWrapper, document.body.firstChild);
        
        var newContainer = document.createElement('div');
        newContainer.id = CONFIG.CONTAINER_ID;
        newContainer.className = 'modern-posts-container';
        newWrapper.appendChild(newContainer);
        
        return newContainer;
    }
    
    function isValidPost(postEl) {
        if (!postEl || !postEl.nodeType === Node.ELEMENT_NODE) return false;
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
    // DATA EXTRACTION
    // ============================================================================
    function getUsername($post) {
        var nickLink = $post.querySelector('.nick a, .user a, .username a');
        if (nickLink) return nickLink.textContent.trim();
        var nickSpan = $post.querySelector('.nick, .username');
        return nickSpan ? nickSpan.textContent.trim() : 'Unknown';
    }
    
    function getAvatarUrl($post) {
        var avatarImg = $post.querySelector('.avatar img, .user-avatar img');
        if (!avatarImg) return null;
        var src = avatarImg.getAttribute('src');
        if (src && src.includes('weserv.nl')) {
            try {
                var urlParams = new URLSearchParams(src.split('?')[1]);
                return urlParams.get('url') || src;
            } catch(e) {
                return src;
            }
        }
        return src;
    }
    
    function getGroupText($post) {
        var groupDd = $post.querySelector('.u_group dd, .user-group');
        return groupDd ? groupDd.textContent.trim() : '';
    }
    
    function getPostCount($post) {
        var postsLink = $post.querySelector('.u_posts dd a, .post-count');
        return postsLink ? postsLink.textContent.trim() : '0';
    }
    
    function getReputation($post) {
        var repLink = $post.querySelector('.u_reputation dd a, .reputation');
        if (!repLink) return '0';
        var repText = repLink.textContent.trim();
        return repText.replace('+', '').replace('-', '');
    }
    
    function getIsOnline($post) {
        var statusTitle = $post.querySelector('.u_status, .user-status');
        if (!statusTitle) return false;
        var title = statusTitle.getAttribute('title') || statusTitle.textContent;
        return title && title.toLowerCase().includes('online');
    }
    
    function getUserTitle($post) {
        var titleSpan = $post.querySelector('.u_title, .user-title');
        if (!titleSpan) return 'Member';
        var title = titleSpan.textContent.trim();
        if (title === 'Member') {
            var stars = ($post.querySelectorAll('.u_rank i.fa-star').length || 
                        $post.querySelectorAll('.star').length);
            if (stars === 3) return 'Famous';
            if (stars === 2) return 'Senior';
            if (stars === 1) return 'Junior';
        }
        return title || 'Member';
    }
    
    function getRankIconClass($post) {
        var uRank = $post.querySelector('.u_rank');
        if (!uRank) return 'fas fa-medal';
        var icon = uRank.querySelector('i:last-child');
        if (!icon) return 'fas fa-medal';
        var classAttr = icon.getAttribute('class') || '';
        if (classAttr.includes('fa-')) {
            return classAttr;
        }
        return 'fas fa-medal';
    }
    
    function getCleanContent($post) {
        var contentTable = $post.querySelector('.right.Item table.color, .post-content, .message');
        if (!contentTable) return '';
        var contentClone = contentTable.cloneNode(true);
        
        // Remove signature and edit elements
        var signatures = contentClone.querySelectorAll('.signature, .edit, .post-signature');
        signatures.forEach(function(el) { if(el) el.remove(); });
        
        // Remove bottomborder
        var borders = contentClone.querySelectorAll('.bottomborder, .post-footer');
        borders.forEach(function(el) { if(el) el.remove(); });
        
        return contentClone.innerHTML || '';
    }
    
    function getSignatureHtml($post) {
        var signature = $post.querySelector('.signature, .post-signature');
        return signature ? signature.innerHTML : '';
    }
    
    function getEditInfo($post) {
        var editSpan = $post.querySelector('.edit, .post-edit-info');
        return editSpan ? editSpan.textContent.trim() : '';
    }
    
    function getLikes($post) {
        var pointsPos = $post.querySelector('.points .points_pos, .likes-count');
        if (!pointsPos) return 0;
        return parseInt(pointsPos.textContent) || 0;
    }
    
    function getReactionData($post) {
        var hasReactions = false;
        var reactionCount = 0;
        var counters = $post.querySelectorAll('.st-emoji-post .st-emoji-counter, .reaction-count');
        counters.forEach(function(counter) {
            hasReactions = true;
            var count = parseInt(counter.getAttribute('data-count') || counter.textContent || 1);
            reactionCount += count;
        });
        if (!hasReactions && $post.querySelector('.st-emoji-container, .reactions')) {
            hasReactions = true;
        }
        return { hasReactions: hasReactions, reactionCount: reactionCount };
    }
    
    function getMaskedIp($post) {
        var ipLink = $post.querySelector('.ip_address dd a, .ip-address');
        if (!ipLink) return '';
        var ip = ipLink.textContent.trim();
        var parts = ip.split('.');
        if (parts.length === 4) {
            return parts[0] + '.' + parts[1] + '.' + parts[2] + '.xxx';
        }
        return ip;
    }
    
    function getPostNumber($post, index) {
        // Try to get actual post number from the post
        var postNumSpan = $post.querySelector('.post-num, .post-number');
        if (postNumSpan) {
            var num = parseInt(postNumSpan.textContent);
            if (!isNaN(num)) return num;
        }
        return index + 1;
    }
    
    function getTimeAgo($post) {
        var whenSpan = $post.querySelector('.when, .post-time');
        if (!whenSpan) return 'Recently';
        var whenTitle = whenSpan.getAttribute('title') || whenSpan.getAttribute('datetime');
        if (!whenTitle) return 'Recently';
        
        try {
            var postDate = new Date(whenTitle);
            if (isNaN(postDate.getTime())) return 'Recently';
            
            var now = new Date();
            var diffMs = now - postDate;
            var diffMins = Math.floor(diffMs / 60000);
            var diffHours = Math.floor(diffMs / 3600000);
            var diffDays = Math.floor(diffMs / 86400000);
            
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return diffMins + ' minute' + (diffMins > 1 ? 's' : '') + ' ago';
            if (diffHours < 24) return diffHours + ' hour' + (diffHours > 1 ? 's' : '') + ' ago';
            if (diffDays < 7) return diffDays + ' day' + (diffDays > 1 ? 's' : '') + ' ago';
            return postDate.toLocaleDateString();
        } catch(e) {
            return 'Recently';
        }
    }
    
    // ============================================================================
    // DATA EXTRACTION MAIN
    // ============================================================================
    function extractPostData($post, index) {
        var postId = getPostId($post);
        if (!postId) return null;
        
        var reactionData = getReactionData($post);
        var groupText = getGroupText($post);
        var roleClass = 'member';
        if (groupText.toLowerCase().includes('admin')) roleClass = 'admin';
        else if (groupText.toLowerCase().includes('moderator')) roleClass = 'moderator';
        else if (groupText.toLowerCase().includes('developer')) roleClass = 'developer';
        
        return {
            postId: postId,
            username: getUsername($post),
            avatarUrl: getAvatarUrl($post),
            groupText: groupText || 'Member',
            roleBadgeClass: roleClass,
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
    // GENERATE MODERN CARD
    // ============================================================================
    function generateModernPost(data) {
        if (!data) return '';
        
        var statusColor = data.isOnline ? '#10B981' : '#6B7280';
        var statusText = data.isOnline ? 'Online' : 'Offline';
        var repValue = parseInt(data.reputation) || 0;
        var repSign = repValue > 0 ? '+' : '';
        var repClass = repValue > 0 ? 'positive' : (repValue < 0 ? 'negative' : '');
        
        // Avatar URL with fallback
        var avatarUrl = data.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(data.username);
        
        // Escape HTML content
        var escapedUsername = Utils.escapeHtml(data.username);
        var escapedGroupText = Utils.escapeHtml(data.groupText);
        var escapedUserTitle = Utils.escapeHtml(data.userTitle);
        
        // Build the modern post HTML
        return '<div class="post-card" data-original-id="ee' + data.postId + '" data-post-id="' + data.postId + '">' +
            '<div class="post-header-modern">' +
                '<div class="post-meta-left">' +
                    '<div class="post-number-badge">' +
                        '<i class="fas fa-hashtag"></i> #' + data.postNumber +
                    '</div>' +
                    '<div class="post-timestamp">' +
                        '<i class="far fa-clock"></i> ' + data.timeAgo +
                    '</div>' +
                '</div>' +
                '<div class="action-buttons-group">' +
                    '<button class="action-icon quote-action" title="Quote" data-action="quote" data-pid="' + data.postId + '">' +
                        '<i class="fas fa-quote-right"></i>' +
                    '</button>' +
                    '<button class="action-icon edit-action" title="Edit" data-action="edit" data-pid="' + data.postId + '">' +
                        '<i class="fas fa-pencil-alt"></i>' +
                    '</button>' +
                    '<button class="action-icon share-action" title="Share" data-action="share" data-pid="' + data.postId + '">' +
                        '<i class="fas fa-share-alt"></i>' +
                    '</button>' +
                    '<button class="action-icon report-action" title="Report" data-action="report" data-pid="' + data.postId + '">' +
                        '<i class="fas fa-flag"></i>' +
                    '</button>' +
                    '<button class="action-icon delete-action" title="Delete" data-action="delete" data-pid="' + data.postId + '">' +
                        '<i class="fas fa-trash-alt"></i>' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="user-area">' +
                '<div class="avatar-modern">' +
                    '<img class="avatar-circle" src="' + avatarUrl + '" alt="Avatar of ' + escapedUsername + '" width="60" height="60" loading="lazy" onerror="this.src=\'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(data.username) + '\'">' +
                '</div>' +
                '<div class="user-details">' +
                    '<div class="username-row">' +
                        '<span class="username">' + escapedUsername + '</span>' +
                    '</div>' +
                    '<div class="badge-container">' +
                        '<span class="role-badge ' + data.roleBadgeClass + '">' + escapedGroupText + '</span>' +
                    '</div>' +
                    '<div class="user-stats-grid">' +
                        '<div class="stat-pill" title="User title">' +
                            '<i class="' + data.rankIconClass + '"></i> ' + escapedUserTitle +
                        '</div>' +
                        '<div class="stat-pill" title="Posts">' +
                            '<i class="fas fa-comments"></i> ' + data.postCount + ' posts' +
                        '</div>' +
                        '<div class="stat-pill ' + repClass + '" title="Reputation">' +
                            '<i class="fas fa-star"></i> ' + repSign + data.reputation + ' rep' +
                        '</div>' +
                        '<div class="stat-pill" title="Status">' +
                            '<i class="fas fa-circle" style="color: ' + statusColor + '; font-size: 0.6rem;"></i> ' + statusText +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="post-body">' +
                '<div class="post-text-content">' +
                    data.contentHtml +
                '</div>' +
                (data.editInfo ? '<div class="edit-indicator"><i class="fas fa-edit"></i> ' + Utils.escapeHtml(data.editInfo) + '</div>' : '') +
                (data.signatureHtml ? '<div class="signature-modern"><i class="fas fa-signature"></i> ' + data.signatureHtml + '</div>' : '') +
            '</div>' +
            '<div class="post-footer-modern">' +
                '<div class="reaction-cluster">' +
                    '<button class="reaction-btn like-action" data-action="like" data-pid="' + data.postId + '">' +
                        '<i class="far fa-thumbs-up"></i>' +
                        (data.likes > 0 ? '<span class="reaction-count">' + data.likes + '</span>' : '') +
                    '</button>' +
                    '<button class="reaction-btn react-action" data-action="react" data-pid="' + data.postId + '">' +
                        '<i class="far fa-face-smile"></i>' +
                        (data.reactionCount > 0 ? '<span class="reaction-count">' + data.reactionCount + '</span>' : '') +
                    '</button>' +
                '</div>' +
                (data.ipAddress ? '<div class="ip-info"><i class="fas fa-shield-alt"></i> IP: ' + Utils.escapeHtml(data.ipAddress) + '</div>' : '') +
            '</div>' +
        '</div>';
    }
    
    // ============================================================================
    // REACTION DISPLAY REFRESH
    // ============================================================================
    function refreshReactionDisplay(postId) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + postId);
        if (!originalPost) return;
        
        var countEl = originalPost.querySelector('.st-emoji-post .st-emoji-counter, .reaction-count');
        if (!countEl) return;
        
        var count = countEl.getAttribute('data-count') || countEl.textContent;
        var modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) return;
        
        var modernReactBtn = modernCard.querySelector('.react-action');
        if (!modernReactBtn) return;
        
        var span = modernReactBtn.querySelector('.reaction-count');
        if (!span && parseInt(count) > 0) {
            span = document.createElement('span');
            span.className = 'reaction-count';
            modernReactBtn.appendChild(span);
        }
        if (span && count) span.textContent = count;
        
        // Also update like count
        var likeCountEl = originalPost.querySelector('.points .points_pos, .likes-count');
        if (likeCountEl) {
            var likeCount = likeCountEl.textContent;
            var modernLikeBtn = modernCard.querySelector('.like-action');
            if (modernLikeBtn) {
                var likeSpan = modernLikeBtn.querySelector('.reaction-count');
                if (!likeSpan && parseInt(likeCount) > 0) {
                    likeSpan = document.createElement('span');
                    likeSpan.className = 'reaction-count';
                    modernLikeBtn.appendChild(likeSpan);
                }
                if (likeSpan && likeCount) likeSpan.textContent = likeCount;
            }
        }
    }
    
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    function handleQuote(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var quoteLink = originalPost.querySelector('a[href*="CODE=02"], a.quote-link');
        if (quoteLink) {
            window.location.href = quoteLink.getAttribute('href');
        }
    }
    
    function handleEdit(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var editLink = originalPost.querySelector('a[href*="CODE=08"], a.edit-link');
        if (editLink) {
            window.location.href = editLink.getAttribute('href');
        }
    }
    
    function handleDelete(pid) {
        if (confirm('Are you sure you want to delete this post?')) {
            if (typeof window.delete_post === 'function') {
                window.delete_post(pid);
            } else {
                var deleteLink = document.querySelector('#ee' + pid + ' a[href*="CODE=09"]');
                if (deleteLink) {
                    window.location.href = deleteLink.getAttribute('href');
                }
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
            alert('Press Ctrl+C to copy: ' + url);
        });
    }
    
    function handleReport(pid) {
        var reportBtn = document.getElementById(CONFIG.POST_ID_PREFIX + pid + ' .report_button');
        if (!reportBtn) {
            reportBtn = document.querySelector('.report_button[data-pid="' + pid + '"], a[href*="CODE=11"]');
        }
        if (reportBtn) {
            reportBtn.click();
        }
    }
    
    function handleLike(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        var likeBtn = originalPost.querySelector('.points .points_up, .like-button');
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
        var emojiContainer = originalPost.querySelector('.st-emoji-container, .reaction-button');
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
    // ATTACH EVENT LISTENERS (DELEGATED)
    // ============================================================================
    function attachEventHandlers() {
        // Use event delegation on document for dynamically added elements
        
        // Quote buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.quote-action, .action-icon[data-action="quote"]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleQuote(pid);
            }
        });
        
        // Edit buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.edit-action, .action-icon[data-action="edit"]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleEdit(pid);
            }
        });
        
        // Delete buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.delete-action, .action-icon[data-action="delete"]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleDelete(pid);
            }
        });
        
        // Share buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.share-action, .action-icon[data-action="share"]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleShare(pid, btn);
            }
        });
        
        // Report buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.report-action, .action-icon[data-action="report"]');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleReport(pid);
            }
        });
        
        // Like buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.like-action');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleLike(pid);
            }
        });
        
        // React buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.react-action');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleReact(pid, btn);
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
       
        // Check if already converted
        if (convertedPostIds.has(postId)) {
            return null;
        }
       
        var data = extractPostData(postEl, index);
        if (!data) return null;
       
        var modernHTML = generateModernPost(data);
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = modernHTML;
        var newCard = tempDiv.firstElementChild;
       
        // Store reference to original post
        newCard.setAttribute('data-original-id', postEl.id);
        newCard.setAttribute('data-post-id', postId);
       
        // Mark as converted
        convertedPostIds.add(postId);
       
        // Add animation class if enabled
        if (CONFIG.ENABLE_ANIMATIONS) {
            newCard.style.opacity = '0';
            newCard.style.transform = 'translateY(10px)';
            setTimeout(function() {
                if (newCard) {
                    newCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                    newCard.style.opacity = '1';
                    newCard.style.transform = 'translateY(0)';
                }
            }, 10);
        }
       
        if (EventBus) {
            EventBus.trigger('post:converted', { postId: postId, element: postEl, card: newCard });
        }
       
        return newCard;
    }
    
    // ============================================================================
    // PROCESS QUEUE FOR BATCH CONVERSION
    // ============================================================================
    function processQueue() {
        if (isProcessing || processingQueue.length === 0) return;
        
        isProcessing = true;
        var batch = processingQueue.splice(0, CONFIG.BATCH_SIZE);
        var container = getPostsContainer();
        
        batch.forEach(function(item) {
            var card = convertToModernCard(item.post, item.index);
            if (card && container) {
                container.appendChild(card);
            }
        });
        
        isProcessing = false;
        
        if (processingQueue.length > 0) {
            setTimeout(processQueue, 50);
        }
    }
    
    function queuePostConversion(post, index) {
        processingQueue.push({ post: post, index: index });
        processQueue();
    }
    
    // ============================================================================
    // REFRESH ALL POSTS
    // ============================================================================
    function refresh() {
        console.log('[PostsModule] Refreshing all posts...');
        var container = getPostsContainer();
        if (container) {
            container.innerHTML = '';
        }
        convertedPostIds.clear();
        processingQueue = [];
        initialize();
    }
    
    // ============================================================================
    // INITIALIZE
    // ============================================================================
    function initialize() {
        // Prevent double initialization
        if (isInitialized) {
            console.log('[PostsModule] Already initialized, skipping');
            return;
        }
       
        console.log('[PostsModule] Initializing...');
        
        // Get or create the posts container
        var container = getPostsContainer();
        if (!container) {
            console.error('[PostsModule] Failed to create/get container');
            return;
        }
       
        // Clear container if needed (to avoid duplicates)
        container.innerHTML = '';
       
        // Reset converted posts tracking
        convertedPostIds.clear();
        processingQueue = [];
        isProcessing = false;
       
        // Get all original posts
        var posts = Utils.getAllElements(CONFIG.POST_SELECTOR);
        var validPosts = 0;
       
        console.log('[PostsModule] Found ' + posts.length + ' posts');
       
        // Convert each post and append to container
        for (var i = 0; i < posts.length; i++) {
            if (isValidPost(posts[i])) {
                queuePostConversion(posts[i], validPosts);
                validPosts++;
            }
        }
       
        // Attach event handlers (once)
        attachEventHandlers();
       
        // Register with ForumCoreObserver for new posts
        if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
            // Unregister existing if any
            if (window._postsModuleObserverId) {
                globalThis.forumObserver.unregister(window._postsModuleObserverId);
            }
            
            window._postsModuleObserverId = globalThis.forumObserver.register({
                id: 'posts-module',
                selector: CONFIG.POST_SELECTOR,
                priority: 'high',
                callback: function(node) {
                    if (!isValidPost(node)) return;
                    
                    var postId = getPostId(node);
                    if (!postId) return;
                    
                    // Skip if already converted
                    if (convertedPostIds.has(postId)) {
                        return;
                    }
                    
                    // Find the index for this post
                    var allPosts = Utils.getAllElements(CONFIG.POST_SELECTOR);
                    var validIndex = 0;
                    for (var i = 0; i < allPosts.length; i++) {
                        if (isValidPost(allPosts[i])) {
                            if (allPosts[i] === node) {
                                queuePostConversion(node, validIndex);
                                break;
                            }
                            validIndex++;
                        }
                    }
                }
            });
            console.log('[PostsModule] Registered with ForumCoreObserver');
        } else {
            console.log('[PostsModule] ForumCoreObserver not available, dynamic content will not auto-convert');
        }
        
        // Mark as initialized
        isInitialized = true;
       
        // Trigger ready event
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
        refresh: refresh,
        convertToModernCard: convertToModernCard,
        refreshReactionDisplay: refreshReactionDisplay,
        getPostsContainer: getPostsContainer,
        isValidPost: isValidPost,
        reset: function() {
            convertedPostIds.clear();
            isInitialized = false;
            processingQueue = [];
            isProcessing = false;
        },
        CONFIG: CONFIG
    };
    
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);
