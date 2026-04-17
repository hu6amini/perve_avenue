/**
 * Forum Modernizer - Fixed for Page Refresh
 * Proper initialization timing and state persistence
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
        
        // Timing
        REACTION_WAIT_DELAY: 500,
        SETTLE_DELAY: 100,
        POLL_INTERVAL: 2000,
        MAX_RETRIES: 5,
        RETRY_DELAY: 300,
        
        // Initialization delays
        INIT_DELAY: 100,      // Wait for DOM
        HTMX_WAIT: 200        // Wait for htmx to be ready
    };
    
    // ============================================================================
    // STATE
    // ============================================================================
    
    let state = {
        isModernView: false,
        htmxAvailable: typeof htmx !== 'undefined',
        processedPosts: new Set(),
        pendingReactions: new Map(),
        retryCounters: new Map(),
        initialized: false,
        restorePending: false
    };
    
    // ============================================================================
    // LOGGING
    // ============================================================================
    
    function log(...args) {
        if (console && console.log) {
            console.log('[ForumModernizer]', ...args);
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
    
    // Wait for htmx to be ready
    function waitForHtmx(callback) {
        if (typeof htmx !== 'undefined' && htmx.onLoad) {
            callback();
            return;
        }
        
        let attempts = 0;
        const maxAttempts = 20; // 2 seconds max
        
        const checkInterval = setInterval(() => {
            attempts++;
            if (typeof htmx !== 'undefined' && htmx.onLoad) {
                clearInterval(checkInterval);
                log('htmx became available');
                callback();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                log('htmx not available, continuing without');
                callback();
            }
        }, 100);
    }
    
    // Wait for element to exist
    function waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(selector);
            if (existing) {
                resolve(existing);
                return;
            }
            
            const observer = new MutationObserver(() => {
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
        });
    }
    
    // ============================================================================
    // DATA EXTRACTION
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
        
        // Likes
        let likes = 0;
        const pointsPos = $post.find('.points .points_pos');
        if (pointsPos.length) {
            likes = parseInt(pointsPos.text()) || 0;
        }
        
        // Reactions
        let hasReactions = false;
        let reactionCount = 0;
        
        $post.find('.st-emoji-post .st-emoji-counter').each(function() {
            hasReactions = true;
            const count = parseInt($(this).data('count') || $(this).text() || 1);
            reactionCount += count;
        });
        
        if (!hasReactions && $post.find('.st-emoji-container').length) {
            hasReactions = true;
        }
        
        // IP
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
            signatureHtml, editInfo, likes, hasReactions, reactionCount,
            ipAddress, postNumber, timeAgo
        };
    }
    
    // ============================================================================
    // MODERN POST GENERATION
    // ============================================================================
    
    function generateModernPost(data) {
        if (!data) return '';
        
        const titleIcon = data.userTitle === 'Famous' ? 'fa-fire' : 
                         (data.userTitle === 'Senior' ? 'fa-star' : 'fa-medal');
        const statusColor = data.isOnline ? '#10B981' : '#6B7280';
        
        const likeButton = `
            <button class="reaction-btn" data-action="like" data-pid="${data.postId}">
                <i class="fa-regular fa-thumbs-up"></i>
                ${data.likes > 0 ? `<span class="reaction-count">${data.likes}</span>` : ''}
            </button>
        `;
        
        let reactButton = '';
        if (data.hasReactions) {
            reactButton = `
                <button class="reaction-btn reaction-placeholder" data-action="react" data-pid="${data.postId}">
                    <img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" class="reaction-emoji-img" width="16" height="16" alt="laugh">
                    <span class="reaction-count">${data.reactionCount > 0 ? data.reactionCount : '...'}</span>
                </button>
            `;
        } else {
            reactButton = `
                <button class="reaction-btn" data-action="react" data-pid="${data.postId}">
                    <i class="fa-regular fa-face-smile"></i>
                </button>
            `;
        }
        
        return `
            <div class="post-card" data-post-id="${data.postId}" data-original-id="${CONFIG.POST_ID_PREFIX}${data.postId}">
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
                        ${likeButton}
                        ${reactButton}
                    </div>
                    ${data.ipAddress ? `<div class="ip-info"><i class="fa-regular fa-globe"></i> IP: ${data.ipAddress}</div>` : ''}
                </div>
            </div>
        `;
    }
    
    // ============================================================================
    // UPDATE REACTION DATA
    // ============================================================================
    
    function updateReactionData($post, postId) {
        const $reactionCounter = $post.find('.st-emoji-post .st-emoji-counter');
        
        if ($reactionCounter.length && $reactionCounter.data('count')) {
            const count = $reactionCounter.data('count');
            log(`Reaction data loaded for post ${postId}: ${count}`);
            
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
                    $reactionBtn.removeClass('reaction-placeholder');
                }
            }
            
            state.pendingReactions.delete(postId);
            state.retryCounters.delete(postId);
            return true;
        }
        
        const retries = state.retryCounters.get(postId) || 0;
        if (retries < CONFIG.MAX_RETRIES && $post.find('.st-emoji-container').length) {
            state.retryCounters.set(postId, retries + 1);
            setTimeout(() => updateReactionData($post, postId), CONFIG.RETRY_DELAY * (retries + 1));
        }
        
        return false;
    }
    
    // ============================================================================
    // CONVERT POST
    // ============================================================================
    
    function convertPostToModern($post) {
        const postId = $post.attr('id');
        if (!postId) return;
        if (state.processedPosts.has(postId)) return;
        
        const $existingCard = $(`.post-card[data-original-id="${postId}"]`);
        if ($existingCard.length === 0) {
            const postData = extractPostData($post);
            if (postData) {
                const modernCard = generateModernPost(postData);
                $post.after(modernCard);
                state.processedPosts.add(postId);
                
                if (postData.hasReactions || $post.find('.st-emoji-container').length) {
                    state.pendingReactions.set(postId, $post);
                    setTimeout(() => updateReactionData($post, postId), CONFIG.REACTION_WAIT_DELAY);
                }
            }
        }
        
        // Apply current view state
        if (state.isModernView) {
            $post.hide();
            $(`.post-card[data-original-id="${postId}"]`).show();
        } else {
            $post.show();
            $(`.post-card[data-original-id="${postId}"]`).hide();
        }
    }
    
    // ============================================================================
    // VIEW SWITCHING
    // ============================================================================
    
    function switchToModernView() {
        log('Switching to modern view...');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) {
            error('Container not found');
            return;
        }
        
        const $posts = $container.find(CONFIG.POST_SELECTOR);
        
        // Convert any unconverted posts
        $posts.each(function() {
            const $post = $(this);
            const postId = $post.attr('id');
            if (!state.processedPosts.has(postId)) {
                convertPostToModern($post);
            }
        });
        
        // Hide originals, show modern
        $posts.hide();
        $container.find('.post-card').show();
        
        state.isModernView = true;
        localStorage.setItem(CONFIG.STORAGE_KEY, 'modern');
        
        // Update buttons
        $('#modern-view-btn').addClass('active');
        $('#classic-view-btn').removeClass('active');
        $('#view-status').html('<i class="fas fa-info-circle"></i> Modern view active');
        
        log('Modern view active');
    }
    
    function switchToClassicView() {
        log('Switching to classic view...');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) return;
        
        $container.find(CONFIG.POST_SELECTOR).show();
        $container.find('.post-card').hide();
        
        state.isModernView = false;
        localStorage.setItem(CONFIG.STORAGE_KEY, 'classic');
        
        $('#classic-view-btn').addClass('active');
        $('#modern-view-btn').removeClass('active');
        $('#view-status').html('<i class="fas fa-info-circle"></i> Classic view active');
        
        log('Classic view active');
    }
    
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    
    function attachEventHandlers() {
        // Remove old handlers first to avoid duplicates
        $(document).off('.forumModernizer');
        
        // Quote
        $(document).on('click.forumModernizer', '.action-icon[data-action="quote"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $quoteLink = $originalPost.find('a[href*="CODE=02"]');
            if ($quoteLink.length) window.location.href = $quoteLink.attr('href');
        });
        
        // Edit
        $(document).on('click.forumModernizer', '.action-icon[data-action="edit"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $editLink = $originalPost.find('a[href*="CODE=08"]');
            if ($editLink.length) window.location.href = $editLink.attr('href');
        });
        
        // Delete
        $(document).on('click.forumModernizer', '.action-icon[data-action="delete"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            if (confirm('Are you sure you want to delete this post?')) {
                if (typeof window.delete_post === 'function') {
                    window.delete_post(pid);
                }
            }
        });
        
        // Share
        $(document).on('click.forumModernizer', '.action-icon[data-action="share"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const url = window.location.href.split('#')[0] + `#entry${pid}`;
            navigator.clipboard.writeText(url).then(() => {
                const $btn = $(this);
                const originalHtml = $btn.html();
                $btn.html('<i class="fas fa-check"></i>');
                setTimeout(() => $btn.html(originalHtml), 1500);
            });
        });
        
        // Report
        $(document).on('click.forumModernizer', '.action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            let $reportBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            if (!$reportBtn.length) $reportBtn = $(`.report_button[data-pid="${pid}"]`);
            if ($reportBtn.length) $reportBtn[0].click();
        });
        
        // Like
        $(document).on('click.forumModernizer', '.reaction-btn[data-action="like"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $likeSpan = $originalPost.find('.points .points_up');
            if ($likeSpan.length) {
                const onclickAttr = $likeSpan.attr('onclick');
                if (onclickAttr) eval(onclickAttr);
                else $likeSpan.click();
            }
        });
        
        // React
        $(document).on('click.forumModernizer', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $emojiContainer = $originalPost.find('.st-emoji-post .st-emoji-container');
            if ($emojiContainer.length) {
                $emojiContainer.click();
            } else {
                $(this).siblings('.reaction-btn[data-action="like"]').click();
            }
        });
    }
    
    // ============================================================================
    // HTMX SETUP
    // ============================================================================
    
    function setupHtmxHandlers() {
        if (typeof htmx === 'undefined' || !htmx.onLoad) {
            log('htmx not available');
            return;
        }
        
        log('Setting up htmx handlers');
        
        htmx.onLoad(function(target) {
            log('htmx.onLoad triggered');
            $(target).find('.post').each(function() {
                convertPostToModern($(this));
            });
            if ($(target).is('.post')) {
                convertPostToModern($(target));
            }
        });
        
        document.addEventListener('htmx:afterSwap', function(event) {
            if (state.isModernView) {
                $(event.detail.target).find('.post').hide();
                $(event.detail.target).find('.post-card').show();
            }
        });
    }
    
    // ============================================================================
    // CREATE UI
    // ============================================================================
    
    function createUI() {
        // Create container if needed
        if ($(`#${CONFIG.CONTAINER_ID}`).length === 0) {
            const $firstPost = $('.post').first();
            if ($firstPost.length) {
                $firstPost.parent().wrapInner(`<div id="${CONFIG.CONTAINER_ID}"></div>`);
                log('Created container');
            }
        }
        
        // Create buttons if needed
        if ($('#modern-view-btn').length === 0) {
            const $container = $(`#${CONFIG.CONTAINER_ID}`);
            if ($container.length) {
                const buttonHtml = `
                    <div id="forum-view-controls" style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 0;">
                        <button id="modern-view-btn" class="view-toggle-btn" style="padding: 8px 18px; border-radius: 8px; border: 1px solid #ccc; background: white; cursor: pointer; font-size: 14px;">
                            <i class="fas fa-magic"></i> Modern View
                        </button>
                        <button id="classic-view-btn" class="view-toggle-btn active" style="padding: 8px 18px; border-radius: 8px; border: 1px solid #ccc; background: white; cursor: pointer; font-size: 14px;">
                            <i class="fas fa-history"></i> Classic View
                        </button>
                        <span id="view-status" style="font-size: 12px; color: #666;"></span>
                    </div>
                `;
                $container.before(buttonHtml);
                
                // Add styles
                $('<style>')
                    .prop('type', 'text/css')
                    .html(`
                        .view-toggle-btn.active {
                            background: #2563eb !important;
                            color: white !important;
                            border-color: #2563eb !important;
                        }
                        .view-toggle-btn:hover:not(.active) {
                            background: #f3f4f6 !important;
                        }
                        .post-card {
                            margin-bottom: 20px;
                        }
                    `)
                    .appendTo('head');
                
                $('#modern-view-btn').on('click', switchToModernView);
                $('#classic-view-btn').on('click', switchToClassicView);
            }
        }
    }
    
    // ============================================================================
    // RESTORE VIEW STATE
    // ============================================================================
    
    function restoreViewState() {
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        log(`Saved view preference: ${savedView}`);
        
        if (savedView === 'modern') {
            // Need to wait for all posts to be processed first
            const $posts = $(`#${CONFIG.CONTAINER_ID}`).find(CONFIG.POST_SELECTOR);
            const expectedCount = $posts.length;
            
            const checkReady = setInterval(() => {
                const processedCount = state.processedPosts.size;
                if (processedCount >= expectedCount || processedCount === expectedCount) {
                    clearInterval(checkReady);
                    log(`All posts processed (${processedCount}/${expectedCount}), restoring modern view`);
                    switchToModernView();
                }
            }, 50);
            
            // Timeout fallback
            setTimeout(() => {
                clearInterval(checkReady);
                if (!state.isModernView) {
                    log('Restore timeout, forcing modern view');
                    switchToModernView();
                }
            }, 3000);
        } else {
            $('#classic-view-btn').addClass('active');
            $('#modern-view-btn').removeClass('active');
            $('#view-status').html('<i class="fas fa-info-circle"></i> Classic view active');
        }
    }
    
    // ============================================================================
    // INITIALIZATION - With proper timing
    // ============================================================================
    
    function initialize() {
        if (state.initialized) {
            log('Already initialized');
            return;
        }
        
        log('========================================');
        log('Forum Modernizer initializing...');
        log('========================================');
        
        // Create UI first
        createUI();
        
        // Get all existing posts
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) {
            error('Container not found, retrying...');
            setTimeout(initialize, 500);
            return;
        }
        
        const $posts = $container.find(CONFIG.POST_SELECTOR);
        log(`Found ${$posts.length} posts`);
        
        // Process all posts
        $posts.each(function() {
            convertPostToModern($(this));
        });
        
        // Attach event handlers
        attachEventHandlers();
        
        // Setup htmx handlers if available
        if (typeof htmx !== 'undefined') {
            setupHtmxHandlers();
        }
        
        // Restore view state
        restoreViewState();
        
        state.initialized = true;
        log('Initialization complete!');
    }
    
    // ============================================================================
    // START - With multiple initialization attempts
    // ============================================================================
    
    let initAttempts = 0;
    const maxInitAttempts = 10;
    
    function tryInitialize() {
        initAttempts++;
        
        // Check if posts exist
        if ($('.post').length > 0) {
            log(`Posts found on attempt ${initAttempts}, initializing`);
            initialize();
        } else if (initAttempts < maxInitAttempts) {
            log(`Waiting for posts (attempt ${initAttempts}/${maxInitAttempts})...`);
            setTimeout(tryInitialize, 200);
        } else {
            error('No posts found after maximum attempts');
        }
    }
    
    // Start when DOM is ready
    if (document.readyState === 'loading') {
        $(document).ready(tryInitialize);
    } else {
        tryInitialize();
    }
    
})();
