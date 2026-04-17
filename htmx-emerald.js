/**
 * Forum Modernizer - Full htmx Integration
 * Uses hx-trigger="load", hx-trigger="revealed", and htmx.onLoad()
 * Handles all dynamically loaded content including lazy-loaded plugins
 */

(function() {
    'use strict';
    
    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    
    const CONFIG = {
        STORAGE_KEY: 'forumModernView',
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container',
        
        // Timing for various features
        REACTION_WAIT_DELAY: 500,    // Wait for reaction buttons to load
        SETTLE_DELAY: 100,           // CSS transition settle time
        POLL_INTERVAL: 2000,         // Poll for missing elements (fallback)
        
        // Retry settings
        MAX_RETRIES: 5,
        RETRY_DELAY: 300
    };
    
    // ============================================================================
    // STATE
    // ============================================================================
    
    let state = {
        isModernView: false,
        htmxAvailable: typeof htmx !== 'undefined',
        processedPosts: new Set(),      // Track which posts have been converted
        pendingReactions: new Map(),    // Track posts waiting for reactions
        retryCounters: new Map()        // Retry counters for each post
    };
    
    // ============================================================================
    // LOGGING
    // ============================================================================
    
    function log(...args) {
        if (console && console.log) {
            console.log('[ForumModernizer]', ...args);
        }
    }
    
    function warn(...args) {
        if (console && console.warn) {
            console.warn('[ForumModernizer]', ...args);
        }
    }
    
    function error(...args) {
        if (console && console.error) {
            console.error('[ForumModernizer]', ...args);
        }
    }
    
    // ============================================================================
    // UTILITIES
    // ============================================================================
    
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Wait for an element to appear in the DOM (using htmx patterns)
    function waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            // Check if element already exists
            const existing = document.querySelector(selector);
            if (existing) {
                resolve(existing);
                return;
            }
            
            // Use htmx:load event if available
            if (state.htmxAvailable) {
                const handler = (event) => {
                    const element = event.detail.elt;
                    if (element && element.matches && element.matches(selector)) {
                        document.removeEventListener('htmx:load', handler);
                        resolve(element);
                    }
                };
                document.addEventListener('htmx:load', handler);
                
                // Timeout
                setTimeout(() => {
                    document.removeEventListener('htmx:load', handler);
                    reject(new Error(`Timeout waiting for ${selector}`));
                }, timeout);
            } else {
                // Fallback to MutationObserver
                const observer = new MutationObserver((mutations) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        observer.disconnect();
                        resolve(element);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                
                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Timeout waiting for ${selector}`));
                }, timeout);
            }
        });
    }
    
    // ============================================================================
    // DATA EXTRACTION - Enhanced to handle lazy-loaded reactions
    // ============================================================================
    
    function extractPostData($post) {
        const fullId = $post.attr('id');
        if (!fullId) return null;
        
        const postId = fullId.replace(CONFIG.POST_ID_PREFIX, '');
        
        // Username
        const username = $post.find('.nick a').first().text().trim() || 'Unknown';
        
        // Avatar
        let avatarUrl = $post.find('.avatar img').attr('src');
        if (avatarUrl && avatarUrl.includes('weserv.nl')) {
            const urlParams = new URLSearchParams(avatarUrl.split('?')[1]);
            avatarUrl = urlParams.get('url') || avatarUrl;
        }
        
        // Group
        const groupText = $post.find('.u_group dd').text().trim();
        const isAdmin = groupText === 'Administrator';
        const roleBadgeClass = isAdmin ? 'admin' : 'member';
        const roleIcon = isAdmin ? 'fa-crown' : 'fa-user';
        
        // Stats
        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        let reputation = $post.find('.u_reputation dd a').text().trim();
        reputation = reputation.replace('+', '');
        
        // Status
        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');
        
        // User title
        let userTitle = $post.find('.u_title').text().trim();
        if (userTitle === 'Member') {
            const stars = $post.find('.u_rank i.fa-star').length;
            if (stars === 3) userTitle = 'Famous';
            else if (stars === 2) userTitle = 'Senior';
            else if (stars === 1) userTitle = 'Junior';
        }
        
        // Content
        const postContent = $post.find('.right.Item table.color').clone();
        postContent.find('.signature').remove();
        postContent.find('.edit').remove();
        const contentHtml = postContent.html() || '';
        
        // Signature
        const signatureHtml = $post.find('.signature').html() || '';
        
        // Edit info
        let editInfo = '';
        const editText = $post.find('.edit').text().trim();
        if (editText) editInfo = editText;
        
        // Likes - check multiple possible locations
        let likes = 0;
        const pointsPos = $post.find('.points .points_pos');
        if (pointsPos.length) {
            likes = parseInt(pointsPos.text()) || 0;
        } else {
            // Check for points span with positive value
            const pointsSpan = $post.find('.points');
            if (pointsSpan.text().match(/\+?\d+/)) {
                const match = pointsSpan.text().match(/\+?(\d+)/);
                if (match) likes = parseInt(match[1]) || 0;
            }
        }
        
        // Reactions - check for st-emoji plugin data
        let hasReactions = false;
        let reactionCount = 0;
        let reactionData = [];
        
        // Method 1: Check for st-emoji counters
        $post.find('.st-emoji-post .st-emoji-counter').each(function() {
            hasReactions = true;
            const count = parseInt($(this).data('count') || $(this).text() || 1);
            reactionCount += count;
            reactionData.push({ type: 'emoji', count: count });
        });
        
        // Method 2: Check for reaction buttons that might load later
        if (!hasReactions && $post.find('.st-emoji-container').length) {
            hasReactions = true;
            reactionCount = 1; // Placeholder, will be updated later
        }
        
        // IP address
        let ipAddress = $post.find('.ip_address dd a').text().trim();
        if (ipAddress) {
            const parts = ipAddress.split('.');
            if (parts.length === 4) {
                ipAddress = `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
            }
        }
        
        // Post number
        const postNumber = $post.index() + 1;
        
        // Timestamp
        let timeAgo = '';
        const whenSpan = $post.find('.when');
        const title = whenSpan.attr('title') || '';
        if (title) {
            const postDate = new Date(title);
            const now = new Date();
            const diffDays = Math.floor((now - postDate) / (1000 * 60 * 60 * 24));
            if (diffDays >= 1) {
                timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            } else {
                const diffHours = Math.floor((now - postDate) / (1000 * 60 * 60));
                if (diffHours >= 1) {
                    timeAgo = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
                } else {
                    timeAgo = 'Just now';
                }
            }
        }
        
        return {
            postId, username, avatarUrl, groupText, isAdmin, roleBadgeClass, roleIcon,
            postCount, reputation, isOnline, userTitle, contentHtml,
            signatureHtml, editInfo, likes, hasReactions, reactionCount, reactionData,
            ipAddress, postNumber, timeAgo
        };
    }
    
    // ============================================================================
    // DYNAMIC REACTION UPDATER - Uses htmx polling for late-loading reactions
    // ============================================================================
    
    function updateReactionData($post, postId) {
        // Check if reaction button has loaded yet
        const $reactionContainer = $post.find('.st-emoji-post .st-emoji-container');
        const $reactionCounter = $post.find('.st-emoji-post .st-emoji-counter');
        
        if ($reactionCounter.length && $reactionCounter.data('count')) {
            // Reaction data is available
            const count = $reactionCounter.data('count');
            log(`Reaction data loaded for post ${postId}: ${count}`);
            
            // Update the modern card if it exists
            const $modernCard = $(`.post-card[data-original-id="${CONFIG.POST_ID_PREFIX}${postId}"]`);
            if ($modernCard.length) {
                const $reactionBtn = $modernCard.find('.reaction-btn[data-action="react"]');
                if ($reactionBtn.length) {
                    const $countSpan = $reactionBtn.find('.reaction-count');
                    if ($countSpan.length) {
                        $countSpan.text(count);
                    } else {
                        $reactionBtn.append(`<span class="reaction-count">${count}</span>`);
                    }
                    log(`Updated modern card reaction count for post ${postId}`);
                }
            }
            
            // Remove from pending
            state.pendingReactions.delete(postId);
            state.retryCounters.delete(postId);
            return true;
        }
        
        if ($reactionContainer.length && !$reactionCounter.length) {
            // Container exists but counter hasn't loaded yet
            const retries = state.retryCounters.get(postId) || 0;
            
            if (retries < CONFIG.MAX_RETRIES) {
                state.retryCounters.set(postId, retries + 1);
                log(`Waiting for reaction data on post ${postId} (attempt ${retries + 1}/${CONFIG.MAX_RETRIES})`);
                
                // Schedule another check using htmx's load polling pattern
                setTimeout(() => updateReactionData($post, postId), CONFIG.RETRY_DELAY * (retries + 1));
                return false;
            } else {
                log(`Reaction data timeout for post ${postId}, using placeholder`);
                state.pendingReactions.delete(postId);
                return false;
            }
        }
        
        return false;
    }
    
    // ============================================================================
    // MODERN POST GENERATION - With placeholder for reactions
    // ============================================================================
    
    function generateModernPost(data) {
        if (!data) return '';
        
        const titleIcon = data.userTitle === 'Famous' ? 'fa-fire' : 
                         (data.userTitle === 'Senior' ? 'fa-star' : 'fa-medal');
        const statusColor = data.isOnline ? '#10B981' : '#6B7280';
        
        // Generate reactions HTML with placeholder for late-loading data
        let reactionsHtml = '';
        
        // Like button
        const likeButton = `
            <button class="reaction-btn" data-action="like" data-pid="${data.postId}">
                <i class="fa-regular fa-thumbs-up"></i>
                ${data.likes > 0 ? `<span class="reaction-count">${data.likes}</span>` : ''}
            </button>
        `;
        
        // Reaction button - with placeholder that will be updated
        let reactButton = '';
        if (data.hasReactions) {
            reactButton = `
                <button class="reaction-btn reaction-placeholder" data-action="react" data-pid="${data.postId}" data-waiting="true">
                    <img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" class="reaction-emoji-img" width="16" height="16" alt="laugh">
                    <span class="reaction-count reaction-placeholder-count">${data.reactionCount > 0 ? data.reactionCount : '...'}</span>
                    <span class="htmx-indicator" style="display: none;">
                        <i class="fas fa-spinner fa-spin"></i>
                    </span>
                </button>
            `;
        } else {
            reactButton = `
                <button class="reaction-btn" data-action="react" data-pid="${data.postId}">
                    <i class="fa-regular fa-face-smile"></i>
                </button>
            `;
        }
        
        reactionsHtml = likeButton + reactButton;
        
        return `
            <div class="post-card" data-post-id="${data.postId}" data-original-id="${CONFIG.POST_ID_PREFIX}${data.postId}" data-reactions-ready="false">
                <div class="post-header-modern">
                    <div class="post-meta-left">
                        <div class="post-number-badge">
                            <i class="fas fa-hashtag"></i> ${data.postNumber}
                        </div>
                        <div class="post-timestamp">
                            <time>${data.timeAgo || 'Recently'}</time>
                        </div>
                    </div>
                    <div class="action-buttons-group">
                        <button class="action-icon" title="Quote" data-action="quote" data-pid="${data.postId}">
                            <i class="fa-regular fa-quote-left"></i>
                        </button>
                        <button class="action-icon" title="Edit" data-action="edit" data-pid="${data.postId}">
                            <i class="fa-regular fa-pen-to-square"></i>
                        </button>
                        <button class="action-icon" title="Share" data-action="share" data-pid="${data.postId}">
                            <i class="fa-regular fa-share-nodes"></i>
                        </button>
                        <button class="action-icon report-action" title="Report" data-action="report" data-pid="${data.postId}">
                            <i class="fa-regular fa-circle-exclamation"></i>
                        </button>
                        <button class="action-icon delete-action" title="Delete" data-action="delete" data-pid="${data.postId}">
                            <i class="fa-regular fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <div class="user-area">
                    <div class="avatar-modern">
                        <img class="avatar-circle" src="${data.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(data.username)}" 
                             alt="${data.username}" width="70" height="70" loading="lazy">
                    </div>
                    <div class="user-details">
                        <div class="username-row">
                            <span class="username">${escapeHtml(data.username)}</span>
                        </div>
                        <div class="badge-container">
                            <span class="role-badge ${data.roleBadgeClass}">
                                <i class="fas ${data.roleIcon}"></i> ${escapeHtml(data.groupText || 'Member')}
                            </span>
                        </div>
                        <div class="user-stats-grid">
                            <span class="stat-pill"><i class="fa-regular ${titleIcon}"></i> ${data.userTitle}</span>
                            <span class="stat-pill"><i class="fa-regular fa-comments"></i> ${data.postCount} posts</span>
                            <span class="stat-pill"><i class="fa-regular fa-thumbs-up"></i> ${data.reputation > 0 ? '+' : ''}${data.reputation} rep</span>
                            <span class="stat-pill"><i class="fa-regular fa-circle" style="color: ${statusColor}"></i> ${data.isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                </div>
                <div class="post-body">
                    <div class="post-text-content">
                        ${data.contentHtml}
                        ${data.editInfo ? `<div class="edit-indicator"><i class="fa-regular fa-pen-to-square"></i> ${escapeHtml(data.editInfo)}</div>` : ''}
                    </div>
                    ${data.signatureHtml ? `<div class="signature-modern">${data.signatureHtml}</div>` : ''}
                </div>
                <div class="post-footer-modern">
                    <div class="reaction-cluster">
                        ${reactionsHtml}
                    </div>
                    ${data.ipAddress ? `<div class="ip-info"><i class="fa-regular fa-globe"></i> IP: ${data.ipAddress}</div>` : ''}
                </div>
            </div>
        `;
    }
    
    // ============================================================================
    // CONVERT A SINGLE POST - With reaction waiting
    // ============================================================================
    
    function convertPostToModern($post) {
        const postId = $post.attr('id');
        
        if (!postId) return;
        if (state.processedPosts.has(postId)) return;
        
        log(`Converting post: ${postId}`);
        
        // Check if modern card already exists
        if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
            const postData = extractPostData($post);
            if (postData) {
                const modernCard = generateModernPost(postData);
                $post.after(modernCard);
                state.processedPosts.add(postId);
                
                // If post has reactions that might load later, start watching
                if (postData.hasReactions || $post.find('.st-emoji-container').length) {
                    state.pendingReactions.set(postId, $post);
                    log(`Watching for reaction data on post ${postId}`);
                    
                    // Use htmx's load polling pattern to check for reactions
                    setTimeout(() => updateReactionData($post, postId), CONFIG.REACTION_WAIT_DELAY);
                }
            }
        }
        
        // Hide original if modern view is active
        if (state.isModernView) {
            $post.hide();
        } else {
            $post.show();
        }
    }
    
    // ============================================================================
    // REACTION OBSERVER - Using htmx events for plugin-loaded content
    // ============================================================================
    
    function setupReactionObserver() {
        if (!state.htmxAvailable) return;
        
        log('Setting up reaction observer using htmx events');
        
        // Listen for htmx:load events that might contain reaction data
        document.addEventListener('htmx:load', function(event) {
            const element = event.detail.elt;
            
            // Check if this element is a reaction counter or container
            if ($(element).is('.st-emoji-counter, .st-emoji-container')) {
                log('Reaction element loaded via htmx:', element);
                
                // Find which post this belongs to
                const $parentPost = $(element).closest('.post');
                if ($parentPost.length) {
                    const postId = $parentPost.attr('id');
                    if (postId) {
                        log(`Reaction data loaded for post ${postId}`);
                        updateReactionData($parentPost, postId.replace(CONFIG.POST_ID_PREFIX, ''));
                    }
                }
            }
        });
        
        // Also listen for the special 'revealed' event for lazy-loaded reactions
        document.addEventListener('htmx:revealed', function(event) {
            const element = event.detail.elt;
            log('Element revealed:', element);
            
            if ($(element).find('.st-emoji-counter, .st-emoji-container').length) {
                const $parentPost = $(element).closest('.post');
                if ($parentPost.length) {
                    const postId = $parentPost.attr('id');
                    if (postId) {
                        updateReactionData($parentPost, postId.replace(CONFIG.POST_ID_PREFIX, ''));
                    }
                }
            }
        });
    }
    
    // ============================================================================
    // HTMX-BASED POLLING FOR MISSING REACTIONS (using every trigger)
    // ============================================================================
    
    function setupReactionPolling() {
        // Create a hidden polling element using htmx's 'every' trigger
        // This checks for missing reaction data periodically
        const pollingHtml = `
            <div id="reaction-polling" 
                 hx-trigger="every ${CONFIG.POLL_INTERVAL}ms"
                 hx-on::every="checkMissingReactions()"
                 style="display: none;">
            </div>
        `;
        
        // Add polling element to body if htmx is available
        if (state.htmxAvailable && !$('#reaction-polling').length) {
            $('body').append(pollingHtml);
            log('Reaction polling enabled');
        }
    }
    
    // Global function for polling to check missing reactions
    window.checkMissingReactions = function() {
        // Check each pending reaction
        state.pendingReactions.forEach(($post, postId) => {
            if ($post && $post.length) {
                updateReactionData($post, postId);
            }
        });
    };
    
    // ============================================================================
    // CORE FUNCTIONS
    // ============================================================================
    
    function switchToModernView() {
        log('Switching to modern view...');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        const $originalPosts = $container.find(CONFIG.POST_SELECTOR);
        
        if (!$originalPosts.length) {
            log('No posts found');
            return;
        }
        
        // Convert any unconverted posts
        $originalPosts.each(function() {
            convertPostToModern($(this));
        });
        
        // Hide all original posts
        $originalPosts.hide();
        
        // Show all modern cards
        $container.find('.post-card').show();
        
        // Mark any pending reactions to check again
        state.pendingReactions.forEach(($post, postId) => {
            setTimeout(() => updateReactionData($post, postId), 500);
        });
        
        state.isModernView = true;
        localStorage.setItem(CONFIG.STORAGE_KEY, 'modern');
        
        // Update button states
        $('#modern-view-btn').addClass('active');
        $('#classic-view-btn').removeClass('active');
        
        log('Modern view active');
    }
    
    function switchToClassicView() {
        log('Switching to classic view...');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        
        // Show original posts
        $container.find(CONFIG.POST_SELECTOR).show();
        
        // Hide modern cards
        $container.find('.post-card').hide();
        
        state.isModernView = false;
        localStorage.setItem(CONFIG.STORAGE_KEY, 'classic');
        
        // Update button states
        $('#classic-view-btn').addClass('active');
        $('#modern-view-btn').removeClass('active');
        
        log('Classic view active');
    }
    
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    
    function attachEventHandlers() {
        log('Attaching event handlers');
        
        // QUOTE
        $(document).on('click.forumModernizer', '.action-icon[data-action="quote"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            if ($originalPost.length) {
                const $quoteLink = $originalPost.find('a[href*="CODE=02"]');
                if ($quoteLink.length) window.location.href = $quoteLink.attr('href');
            }
        });
        
        // EDIT
        $(document).on('click.forumModernizer', '.action-icon[data-action="edit"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            if ($originalPost.length) {
                const $editLink = $originalPost.find('a[href*="CODE=08"]');
                if ($editLink.length) window.location.href = $editLink.attr('href');
            }
        });
        
        // DELETE
        $(document).on('click.forumModernizer', '.action-icon[data-action="delete"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            if (confirm('Are you sure you want to delete this post?')) {
                if (typeof window.delete_post === 'function') {
                    window.delete_post(pid);
                }
            }
        });
        
        // SHARE
        $(document).on('click.forumModernizer', '.action-icon[data-action="share"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            const url = window.location.href.split('#')[0] + `#entry${pid}`;
            navigator.clipboard.writeText(url).then(() => {
                const $btn = $(this);
                const originalIcon = $btn.html();
                $btn.html('<i class="fas fa-check"></i>');
                setTimeout(() => $btn.html(originalIcon), 1500);
            });
        });
        
        // REPORT
        $(document).on('click.forumModernizer', '.action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            
            let $reportBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            if (!$reportBtn.length) $reportBtn = $(`.report_button[data-pid="${pid}"]`);
            if ($reportBtn.length) $reportBtn[0].click();
        });
        
        // LIKE
        $(document).on('click.forumModernizer', '.reaction-btn[data-action="like"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            if ($originalPost.length) {
                const $likeSpan = $originalPost.find('.points .points_up');
                if ($likeSpan.length) {
                    const onclickAttr = $likeSpan.attr('onclick');
                    if (onclickAttr) eval(onclickAttr);
                    else $likeSpan.click();
                }
            }
        });
        
        // REACT - Enhanced to wait for reaction plugin
        $(document).on('click.forumModernizer', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            const $btn = $(this);
            
            // Show loading indicator
            $btn.addClass('htmx-request');
            
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            
            // Try multiple ways to trigger the reaction plugin
            const $emojiContainer = $originalPost.find('.st-emoji-post .st-emoji-container');
            
            if ($emojiContainer.length) {
                // Trigger the emoji picker
                $emojiContainer.click();
                $btn.removeClass('htmx-request');
            } else {
                // Wait for the reaction plugin to load
                log(`Waiting for reaction plugin on post ${pid}`);
                
                waitForElement(`#${CONFIG.POST_ID_PREFIX}${pid} .st-emoji-container`, 3000)
                    .then(container => {
                        log(`Reaction plugin loaded for post ${pid}`);
                        $(container).click();
                        $btn.removeClass('htmx-request');
                    })
                    .catch(() => {
                        log(`Reaction plugin timeout for post ${pid}, falling back to like`);
                        $btn.siblings('.reaction-btn[data-action="like"]').click();
                        $btn.removeClass('htmx-request');
                    });
            }
        });
    }
    
    // ============================================================================
    // HTMX INTEGRATION
    // ============================================================================
    
    function setupHtmxHandlers() {
        if (!state.htmxAvailable) {
            log('htmx not available');
            return;
        }
        
        log('Setting up htmx handlers');
        
        // Use htmx.onLoad for all new content
        htmx.onLoad(function(target) {
            log('htmx.onLoad:', target);
            
            // Convert any new posts
            $(target).find('.post').each(function() {
                convertPostToModern($(this));
            });
            
            if ($(target).is('.post')) {
                convertPostToModern($(target));
            }
            
            // Check for reaction elements in new content
            $(target).find('.st-emoji-counter, .st-emoji-container').each(function() {
                const $parentPost = $(this).closest('.post');
                if ($parentPost.length) {
                    const postId = $parentPost.attr('id');
                    if (postId) {
                        updateReactionData($parentPost, postId.replace(CONFIG.POST_ID_PREFIX, ''));
                    }
                }
            });
        });
        
        // Use htmx:afterSwap for settle timing
        document.addEventListener('htmx:afterSwap', function(event) {
            if (state.isModernView) {
                $(event.detail.target).find('.post').hide();
                $(event.detail.target).find('.post-card').show();
            }
        });
        
        // Setup reaction observer
        setupReactionObserver();
        
        // Setup polling for missing reactions
        setupReactionPolling();
    }
    
    // ============================================================================
    // CREATE VIEW BUTTONS
    // ============================================================================
    
    function createViewButtons() {
        if ($('#modern-view-btn').length > 0) return;
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) return;
        
        const buttonHtml = `
            <div id="forum-view-controls" style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <button id="modern-view-btn" class="view-toggle-btn">
                    <i class="fas fa-magic"></i> Modern View
                </button>
                <button id="classic-view-btn" class="view-toggle-btn active">
                    <i class="fas fa-history"></i> Classic View
                </button>
                <span id="view-status" style="font-size: 12px; color: #666;"></span>
            </div>
        `;
        
        $container.before(buttonHtml);
        
        // Style buttons
        $('<style>')
            .prop('type', 'text/css')
            .html(`
                .view-toggle-btn {
                    padding: 8px 18px;
                    border-radius: 8px;
                    border: 1px solid #ccc;
                    background: white;
                    cursor: pointer;
                    font-size: 14px;
                    transition: all 0.2s ease;
                }
                .view-toggle-btn.active {
                    background: #2563eb !important;
                    color: white !important;
                    border-color: #2563eb !important;
                }
                .view-toggle-btn:hover:not(.active) {
                    background: #f3f4f6 !important;
                }
                .htmx-request {
                    opacity: 0.7;
                    cursor: wait;
                }
            `)
            .appendTo('head');
        
        $('#modern-view-btn').on('click', switchToModernView);
        $('#classic-view-btn').on('click', switchToClassicView);
    }
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    function initialize() {
        log('========================================');
        log('Forum Modernizer v2.1 - Full htmx Integration');
        log(`htmx available: ${state.htmxAvailable}`);
        log('========================================');
        
        // Create container
        if ($(`#${CONFIG.CONTAINER_ID}`).length === 0) {
            const $firstPost = $('.post').first();
            if ($firstPost.length) {
                $firstPost.parent().wrapInner(`<div id="${CONFIG.CONTAINER_ID}"></div>`);
            } else {
                error('No posts found');
                return;
            }
        }
        
        createViewButtons();
        attachEventHandlers();
        setupHtmxHandlers();
        
        // Initialize existing posts
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        const $posts = $container.find(CONFIG.POST_SELECTOR);
        
        $posts.each(function() {
            convertPostToModern($(this));
        });
        
        // Restore preference
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (savedView === 'modern') {
            $posts.hide();
            $container.find('.post-card').show();
            state.isModernView = true;
            $('#modern-view-btn').addClass('active');
            $('#classic-view-btn').removeClass('active');
        } else {
            $posts.show();
            $container.find('.post-card').hide();
            state.isModernView = false;
        }
        
        $('#view-status').html(`<i class="fas fa-info-circle"></i> ${state.isModernView ? 'Modern view active' : 'Classic view active'}`);
        
        log('Initialization complete!');
    }
    
    // Start
    if (document.readyState === 'loading') {
        $(document).ready(initialize);
    } else {
        initialize();
    }
    
})();
