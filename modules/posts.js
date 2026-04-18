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
    // Track converted posts to prevent duplicates
    var convertedPostIds = new Set();
    var isInitialized = false;
    // Store reaction data for each post
    var postReactions = new Map();
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
        signatures.forEach(function(el) { if (el && el.remove) el.remove(); });
        
        // Remove bottomborder
        var borders = contentClone.querySelectorAll('.bottomborder');
        borders.forEach(function(el) { if (el && el.remove) el.remove(); });
        
        // Remove extra br tags that are directly adjacent to bottomborder (cleanup)
        var breaks = contentClone.querySelectorAll('br');
        breaks.forEach(function(br) {
            if (!br) return;
            var prev = br.previousElementSibling;
            var next = br.nextElementSibling;
            // Only remove br tags that are adjacent to bottomborder elements
            if ((next && next.classList && next.classList.contains('bottomborder')) ||
                (prev && prev.classList && prev.classList.contains('bottomborder'))) {
                if (br.remove) br.remove();
            }
        });
        
        // Get the HTML content as-is, preserving all formatting
        var html = contentClone.innerHTML || '';
        
        // Clean up any empty paragraphs or extra whitespace
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.trim();
        
        return html;
    }
    function getSignatureHtml($post) {
        var signature = $post.querySelector('.signature');
        if (!signature) return '';
        // Clone to avoid modifying original
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
        
        // Look for the st-emoji-container (the reaction plugin container)
        var emojiContainer = $post.querySelector('.st-emoji-container');
        if (emojiContainer) {
            // Get counters
            var counters = emojiContainer.querySelectorAll('.st-emoji-counter');
            if (counters.length > 0) {
                hasReactions = true;
                counters.forEach(function(counter) {
                    var count = parseInt(counter.getAttribute('data-count') || counter.textContent || 0);
                    reactionCount += count;
                });
                
                // Get reaction images from preview
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
        
        // Store reaction data for later updates
        if (reactionData.hasReactions) {
            postReactions.set(postId, reactionData.reactions);
        }
        
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
        // If no reactions have counters, just show the add reaction button (smiley face)
        if (!data.hasReactions || data.reactionCount === 0) {
            return '<button class="reaction-btn reaction-add-btn" aria-label="Add a reaction" data-pid="' + data.postId + '">' +
                '<i class="fa-regular fa-face-smile" aria-hidden="true"></i>' +
                '</button>';
        }
        
        // Has reactions with counters - show only the reaction image buttons (no separate add button)
        var reactionHtml = '<div class="reactions-container" data-pid="' + data.postId + '">';
        
        // Group reactions by image src to combine counts
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
        
        // Create buttons for each unique reaction
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
        
        // Like button HTML
        var likeButton = '<button class="reaction-btn like-btn" aria-label="Like this post" data-pid="' + data.postId + '">' +
            '<i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>';
        if (data.likes > 0) {
            likeButton += '<span class="like-count">' + data.likes + '</span>';
        }
        likeButton += '</button>';
        
        // Reactions HTML
        var reactionsHtml = generateReactionButtons(data);
        
        // Edit indicator HTML
        var editHtml = '';
        if (data.editInfo) {
            editHtml = '<div class="post-edit-info">' +
                ' <small>' + Utils.escapeHtml(data.editInfo) + '</small>' +
                '</div>';
        }
        
        // Signature HTML
        var signatureHtml = '';
        if (data.signatureHtml) {
            signatureHtml = '<div class="post-signature">' + data.signatureHtml + '</div>';
        }
        
        // IP HTML
        var ipHtml = '';
        if (data.ipAddress) {
            ipHtml = '<div class="post-ip">' +
                ' IP: ' + data.ipAddress +
                '</div>';
        }
        
        // Avatar URL
        var avatarUrl = data.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(data.username);
        
        return '<div class="post-card" data-original-id="' + CONFIG.POST_ID_PREFIX + data.postId + '" data-post-id="' + data.postId + '">' +
            '<div class="post-card-header">' +
                '<div class="post-meta">' +
                    '<div class="post-number">' +
                        '<i class="fa-regular fa-hashtag" aria-hidden="true"></i> ' + data.postNumber +
                    '</div>' +
                    '<div class="post-time">' +
                        data.timeAgo +
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
            '</div>' +
            '<div class="post-card-body">' +
                '<div class="post-avatar">' +
                    '<img class="avatar-circle" src="' + avatarUrl + '" alt="Avatar of ' + Utils.escapeHtml(data.username) + '" width="70" height="70" loading="lazy">' +
                '</div>' +
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
                        '<div class="user-title">' +
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
            '<div class="post-footer">' +
                '<div class="post-reactions">' +
                    likeButton +
                    reactionsHtml +
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
        if (!originalPost) {
            return;
        }
        
        // Get updated reaction data
        var reactionData = getReactionData(originalPost);
        
        var modernCard = document.querySelector('.post-card[data-original-id="' + CONFIG.POST_ID_PREFIX + postId + '"]');
        if (!modernCard) {
            return;
        }
        
        var postReactionsDiv = modernCard.querySelector('.post-reactions');
        if (!postReactionsDiv) return;
        
        // Store reactions for this post
        if (reactionData.reactions.length > 0) {
            postReactions.set(postId, reactionData.reactions);
        }
        
        // Find the like button (keep it)
        var likeButton = postReactionsDiv.querySelector('.like-btn');
        var likeButtonHtml = likeButton ? likeButton.outerHTML : '';
        
        // Generate new reactions HTML
        var newReactionsHtml = generateReactionButtons({
            postId: postId,
            hasReactions: reactionData.hasReactions,
            reactionCount: reactionData.reactionCount,
            reactions: reactionData.reactions
        });
        
        // Update the reactions container
        if (likeButtonHtml) {
            postReactionsDiv.innerHTML = likeButtonHtml + newReactionsHtml;
        } else {
            postReactionsDiv.innerHTML = newReactionsHtml;
        }
    }
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    function handleUsernameClick(pid) {
        var originalPost = document.getElementById(CONFIG.POST_ID_PREFIX + pid);
        if (!originalPost) return;
        
        // Find the nickname link in the original post
        var nickLink = originalPost.querySelector('.nick a');
        if (nickLink) {
            // Trigger a click on the original link
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
        
        // Find the emoji container
        var emojiContainer = originalPost.querySelector('.st-emoji-container');
        if (emojiContainer) {
            var trigger = emojiContainer.querySelector('.st-emoji-trigger') || emojiContainer;
            trigger.click();
        } else {
            // Fallback to like
            handleLike(pid);
        }
        
        setTimeout(function() {
            refreshReactionDisplay(pid);
        }, CONFIG.REACTION_DELAY);
    }
    // ============================================================================
    // ATTACH EVENT LISTENERS
    // ============================================================================
    function attachEventHandlers() {
        // Username click handler - trigger the original nickname link
        document.addEventListener('click', function(e) {
            var userNameDiv = e.target.closest('.user-name');
            if (userNameDiv) {
                e.preventDefault();
                var pid = userNameDiv.getAttribute('data-pid');
                if (pid) handleUsernameClick(pid);
            }
        });
        
        // Quote buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="quote"], .action-icon[title="Quote"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleQuote(pid);
            }
        });
        
        // Edit buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="edit"], .action-icon[title="Edit"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleEdit(pid);
            }
        });
        
        // Delete buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="delete"], .action-icon[title="Delete"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleDelete(pid);
            }
        });
        
        // Share buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="share"], .action-icon[title="Share"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleShare(pid, btn);
            }
        });
        
        // Report buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.action-icon[data-action="report"], .action-icon[title="Report"]');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleReport(pid);
            }
        });
        
        // Like buttons
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.like-btn');
            if (btn) {
                e.preventDefault();
                var pid = btn.getAttribute('data-pid');
                if (pid) handleLike(pid);
            }
        });
        
        // React buttons (any reaction button that's not a like button)
        document.addEventListener('click', function(e) {
            var btn = e.target.closest('.reaction-btn:not(.like-btn)');
            if (btn) {
                e.preventDefault();
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
       
        // Mark as converted
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
        // Prevent double initialization
        if (isInitialized) {
            console.log('[PostsModule] Already initialized, skipping');
            return;
        }
       
        console.log('[PostsModule] Initializing...');
        // Get or create the posts container
        var container = getPostsContainer();
       
        // Clear container if needed (to avoid duplicates)
        if (container) {
            container.innerHTML = '';
        }
       
        // Reset converted posts tracking
        convertedPostIds.clear();
        postReactions.clear();
       
        // Get all original posts
        var posts = Utils.getAllElements(CONFIG.POST_SELECTOR);
        var validPosts = 0;
       
        // Convert each post and append to container
        for (var i = 0; i < posts.length; i++) {
            if (isValidPost(posts[i])) {
                var modernCard = convertToModernCard(posts[i], validPosts);
                if (modernCard) {
                    container.appendChild(modernCard);
                    validPosts++;
                }
            }
        }
       
        // Attach event handlers
        attachEventHandlers();
       
        // Register with ForumCoreObserver for new posts AND reaction containers
        if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
            // Register for new posts
            globalThis.forumObserver.register({
                id: 'posts-module',
                selector: CONFIG.POST_SELECTOR,
                priority: 'high',
                callback: function(node) {
                    if (!isValidPost(node)) return;
                   
                    var postId = getPostId(node);
                   
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
            
            // Register for reaction containers (st-emoji-container)
            globalThis.forumObserver.register({
                id: 'posts-module-reactions',
                selector: '.st-emoji-container',
                priority: 'medium',
                callback: function(node) {
                    // Find the parent post
                    var postEl = node.closest('.post');
                    if (postEl && isValidPost(postEl)) {
                        var postId = getPostId(postEl);
                        if (postId) {
                            // Small delay to ensure the reaction plugin has fully loaded
                            setTimeout(function() {
                                refreshReactionDisplay(postId);
                            }, 100);
                        }
                    }
                }
            });
            
            console.log('[PostsModule] Registered with ForumCoreObserver');
        }
        
        // Also set up a MutationObserver as fallback specifically for reactions
        var reactionFallbackObserver = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check for reaction containers
                            var emojiContainers = node.querySelectorAll ? node.querySelectorAll('.st-emoji-container') : [];
                            if (node.classList && node.classList.contains('st-emoji-container')) {
                                emojiContainers = [node];
                            }
                            
                            emojiContainers.forEach(function(container) {
                                var postEl = container.closest('.post');
                                if (postEl && isValidPost(postEl)) {
                                    var postId = getPostId(postEl);
                                    if (postId) {
                                        setTimeout(function() {
                                            refreshReactionDisplay(postId);
                                        }, 100);
                                    }
                                }
                            });
                        }
                    });
                }
            });
        });
        
        reactionFallbackObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
       
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
        convertToModernCard: convertToModernCard,
        refreshReactionDisplay: refreshReactionDisplay,
        getPostsContainer: getPostsContainer,
        isValidPost: isValidPost,
        reset: function() {
            convertedPostIds.clear();
            postReactions.clear();
            isInitialized = false;
        },
        CONFIG: CONFIG
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);

// Signal that posts module is ready
if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('posts-module-ready'));
}
