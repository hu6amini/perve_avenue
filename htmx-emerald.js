/**
 * Forum Modernizer - Fixed for page refresh
 * Ensures htmx is fully loaded before initialization
 * Uses proper event persistence across refreshes
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
        REACTION_WAIT_DELAY: 500,
        MAX_RETRIES: 5,
        RETRY_DELAY: 300
    };
    
    // ============================================================================
    // STATE
    // ============================================================================
    
    let state = {
        isModernView: false,
        htmxAvailable: false,
        processedPosts: new Set(),
        pendingReactions: new Map(),
        retryCounters: new Map(),
        initialized: false
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
    
    // Wait for htmx to be fully ready
    function waitForHtmx() {
        return new Promise((resolve) => {
            if (typeof htmx !== 'undefined' && htmx.version) {
                log('htmx already loaded, version:', htmx.version);
                resolve(true);
                return;
            }
            
            // Wait for htmx to initialize
            let attempts = 0;
            const checkInterval = setInterval(() => {
                attempts++;
                if (typeof htmx !== 'undefined' && htmx.version) {
                    clearInterval(checkInterval);
                    log('htmx detected after', attempts, 'attempts');
                    resolve(true);
                } else if (attempts > 50) {
                    clearInterval(checkInterval);
                    log('htmx not detected, using fallback mode');
                    resolve(false);
                }
            }, 100);
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
            reactionCount += parseInt($(this).data('count') || $(this).text() || 1);
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
                    log(`Updated reaction count for post ${postId}`);
                }
            }
            
            state.pendingReactions.delete(postId);
            state.retryCounters.delete(postId);
            return true;
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
        
        const modernCardExists = $(`.post-card[data-original-id="${postId}"]`).length > 0;
        
        if (!modernCardExists) {
            const postData = extractPostData($post);
            if (postData) {
                const modernCard = generateModernPost(postData);
                $post.after(modernCard);
                state.processedPosts.add(postId);
                
                if (postData.hasReactions) {
                    state.pendingReactions.set(postId, $post);
                    setTimeout(() => updateReactionData($post, postId), CONFIG.REACTION_WAIT_DELAY);
                }
            }
        }
        
        if (state.isModernView) {
            $post.hide();
        } else {
            $post.show();
        }
    }
    
    // ============================================================================
    // VIEW SWITCHING
    // ============================================================================
    
    function switchToModernView() {
        log('Switching to modern view...');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        const $originalPosts = $container.find(CONFIG.POST_SELECTOR);
        
        if (!$originalPosts.length) return;
        
        $originalPosts.each(function() {
            convertPostToModern($(this));
        });
        
        $originalPosts.hide();
        $container.find('.post-card').show();
        
        state.pendingReactions.forEach(($post, postId) => {
            setTimeout(() => updateReactionData($post, postId), 500);
        });
        
        state.isModernView = true;
        localStorage.setItem(CONFIG.STORAGE_KEY, 'modern');
        
        $('#modern-view-btn').addClass('active');
        $('#classic-view-btn').removeClass('active');
        $('#view-status').html('<i class="fas fa-info-circle"></i> Modern view active');
        
        log('Modern view active');
    }
    
    function switchToClassicView() {
        log('Switching to classic view...');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        
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
    // EVENT HANDLERS - Using event delegation (works after refresh)
    // ============================================================================
    
    function attachEventHandlers() {
        log('Attaching event handlers');
        
        // Remove old handlers first to avoid duplicates
        $(document).off('.forumModernizer');
        
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
                const originalHtml = $btn.html();
                $btn.html('<i class="fas fa-check"></i>');
                setTimeout(() => $btn.html(originalHtml), 1500);
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
        
        // REACT
        $(document).on('click.forumModernizer', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $emojiContainer = $originalPost.find('.st-emoji-post .st-emoji-container');
            if ($emojiContainer.length) {
                $emojiContainer.click();
            } else {
                $(this).siblings('.reaction-btn[data-action="like"]').click();
            }
        });
        
        log('Event handlers attached');
    }
    
    // ============================================================================
    // HTMX INTEGRATION - Fixed for page refresh
    // ============================================================================
    
    function setupHtmxHandlers() {
        if (typeof htmx === 'undefined' || !htmx.version) {
            log('htmx not available, skipping htmx handlers');
            return;
        }
        
        log('Setting up htmx handlers');
        
        // Use htmx.onLoad if available
        if (typeof htmx.onLoad === 'function') {
            htmx.onLoad(function(target) {
                log('htmx.onLoad triggered');
                $(target).find('.post').each(function() {
                    convertPostToModern($(this));
                });
                if ($(target).is('.post')) {
                    convertPostToModern($(target));
                }
            });
        }
        
        // Listen for htmx:load event
        document.addEventListener('htmx:load', function(event) {
            log('htmx:load event');
            const element = event.detail.elt;
            if ($(element).find('.st-emoji-counter, .st-emoji-container').length) {
                const $parentPost = $(element).closest('.post');
                if ($parentPost.length) {
                    const postId = $parentPost.attr('id');
                    if (postId) {
                        setTimeout(() => updateReactionData($parentPost, postId.replace(CONFIG.POST_ID_PREFIX, '')), 100);
                    }
                }
            }
        });
        
        // Listen for htmx:afterSwap
        document.addEventListener('htmx:afterSwap', function(event) {
            if (state.isModernView) {
                $(event.detail.target).find('.post').hide();
                $(event.detail.target).find('.post-card').show();
            }
        });
    }
    
    // ============================================================================
    // CREATE VIEW BUTTONS
    // ============================================================================
    
    function createViewButtons() {
        if ($('#modern-view-btn').length > 0) return;
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) return;
        
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
        
        // Style buttons
        if (!$('#forum-modernizer-styles').length) {
            $('<style id="forum-modernizer-styles">')
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
        }
        
        $('#modern-view-btn').off('click').on('click', switchToModernView);
        $('#classic-view-btn').off('click').on('click', switchToClassicView);
    }
    
    // ============================================================================
    // INITIALIZE EXISTING POSTS
    // ============================================================================
    
    function initializeExistingPosts() {
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        const $posts = $container.find(CONFIG.POST_SELECTOR);
        
        log(`Found ${$posts.length} existing posts`);
        
        // Create modern cards for all posts
        $posts.each(function() {
            const $post = $(this);
            const postId = $post.attr('id');
            
            if (!state.processedPosts.has(postId)) {
                const postData = extractPostData($post);
                if (postData) {
                    const modernCard = generateModernPost(postData);
                    $post.after(modernCard);
                    state.processedPosts.add(postId);
                    
                    if (postData.hasReactions) {
                        state.pendingReactions.set(postId, $post);
                        setTimeout(() => updateReactionData($post, postId), CONFIG.REACTION_WAIT_DELAY);
                    }
                }
            }
        });
        
        // Apply saved view preference
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        
        if (savedView === 'modern') {
            $posts.hide();
            $container.find('.post-card').show();
            state.isModernView = true;
            $('#modern-view-btn').addClass('active');
            $('#classic-view-btn').removeClass('active');
            $('#view-status').html('<i class="fas fa-info-circle"></i> Modern view active');
        } else {
            $posts.show();
            $container.find('.post-card').hide();
            state.isModernView = false;
            $('#classic-view-btn').addClass('active');
            $('#modern-view-btn').removeClass('active');
            $('#view-status').html('<i class="fas fa-info-circle"></i> Classic view active');
        }
        
        log('Existing posts initialized');
    }
    
    // ============================================================================
    // MAIN INITIALIZATION - Fixed order
    // ============================================================================
    
    async function initialize() {
        if (state.initialized) {
            log('Already initialized, skipping');
            return;
        }
        
        log('========================================');
        log('Forum Modernizer initializing...');
        log('========================================');
        
        // Wait for htmx to be ready
        const htmxReady = await waitForHtmx();
        state.htmxAvailable = htmxReady;
        
        // Create container if needed
        if ($(`#${CONFIG.CONTAINER_ID}`).length === 0) {
            const $firstPost = $('.post').first();
            if ($firstPost.length) {
                $firstPost.parent().wrapInner(`<div id="${CONFIG.CONTAINER_ID}"></div>`);
                log('Created posts container');
            } else {
                error('No posts found on page');
                return;
            }
        }
        
        // Create UI buttons
        createViewButtons();
        
        // Attach event handlers (always needed)
        attachEventHandlers();
        
        // Setup htmx handlers if available
        if (state.htmxAvailable) {
            setupHtmxHandlers();
        }
        
        // Initialize existing posts
        initializeExistingPosts();
        
        state.initialized = true;
        log('Initialization complete!');
    }
    
    // Start after DOM is ready
    if (document.readyState === 'loading') {
        $(document).ready(initialize);
    } else {
        initialize();
    }
    
})();
