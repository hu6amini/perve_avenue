/**
 * Forum Modernizer - Powered by htmx
 * Uses htmx's native onLoad() and events for dynamic content handling
 * No MutationObserver needed - let htmx do the work!
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
        SETTLE_DELAY: 50  // Delay for CSS transitions
    };
    
    // ============================================================================
    // STATE
    // ============================================================================
    
    let state = {
        isModernView: false,
        htmxAvailable: typeof htmx !== 'undefined'
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
    
    // ============================================================================
    // DATA EXTRACTION - Based on your actual post structure
    // ============================================================================
    
    function extractPostData($post) {
        const fullId = $post.attr('id');
        if (!fullId) return null;
        
        const postId = fullId.replace(CONFIG.POST_ID_PREFIX, '');
        
        // Username - from .nick a
        const username = $post.find('.nick a').first().text().trim() || 'Unknown';
        
        // Avatar
        let avatarUrl = $post.find('.avatar img').attr('src');
        if (avatarUrl && avatarUrl.includes('weserv.nl')) {
            const urlParams = new URLSearchParams(avatarUrl.split('?')[1]);
            avatarUrl = urlParams.get('url') || avatarUrl;
        }
        
        // Group - from .u_group dd
        const groupText = $post.find('.u_group dd').text().trim();
        const isAdmin = groupText === 'Administrator';
        const roleBadgeClass = isAdmin ? 'admin' : 'member';
        const roleIcon = isAdmin ? 'fa-crown' : 'fa-user';
        
        // Post count - from .u_posts dd a
        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        
        // Reputation - from .u_reputation dd a
        let reputation = $post.find('.u_reputation dd a').text().trim();
        reputation = reputation.replace('+', '');
        
        // Status - from .u_status title attribute
        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');
        
        // User title - from .u_title
        let userTitle = $post.find('.u_title').text().trim();
        if (userTitle === 'Member') {
            const stars = $post.find('.u_rank i.fa-star').length;
            if (stars === 3) userTitle = 'Famous';
            else if (stars === 2) userTitle = 'Senior';
            else if (stars === 1) userTitle = 'Junior';
        }
        
        // Post content - from .right.Item table.color
        const postContent = $post.find('.right.Item table.color').clone();
        postContent.find('.signature').remove();
        postContent.find('.edit').remove();
        const contentHtml = postContent.html() || '';
        
        // Signature - from .signature
        const signatureHtml = $post.find('.signature').html() || '';
        
        // Edit info - from .edit
        let editInfo = '';
        const editText = $post.find('.edit').text().trim();
        if (editText) {
            editInfo = editText;
        }
        
        // Likes - from .points .points_pos
        let likes = 0;
        const pointsPos = $post.find('.points .points_pos');
        if (pointsPos.length) {
            likes = parseInt(pointsPos.text()) || 0;
        }
        
        // Check if post has reactions (st-emoji)
        const hasReactions = $post.find('.st-emoji-post .st-emoji-counter').length > 0;
        let reactionCount = 0;
        $post.find('.st-emoji-post .st-emoji-counter').each(function() {
            reactionCount += parseInt($(this).data('count') || 1);
        });
        
        // IP address - from .ip_address dd a
        let ipAddress = $post.find('.ip_address dd a').text().trim();
        if (ipAddress) {
            const parts = ipAddress.split('.');
            if (parts.length === 4) {
                ipAddress = `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
            }
        }
        
        // Post number (position)
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
        
        // Reactions HTML
        let reactionsHtml = '';
        if (data.likes > 0 || data.hasReactions) {
            reactionsHtml = `
                <button class="reaction-btn" data-action="like" data-pid="${data.postId}">
                    <i class="fa-regular fa-thumbs-up"></i>
                    ${data.likes > 0 ? `<span class="reaction-count">${data.likes}</span>` : ''}
                </button>
                ${data.hasReactions ? `
                <button class="reaction-btn" data-action="react" data-pid="${data.postId}">
                    <img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" class="reaction-emoji-img" width="16" height="16" alt="laugh">
                    <span class="reaction-count">${data.reactionCount}</span>
                </button>
                ` : ''}
            `;
        } else {
            reactionsHtml = `
                <button class="reaction-btn" data-action="like" data-pid="${data.postId}">
                    <i class="fa-regular fa-thumbs-up"></i>
                </button>
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
                        ${reactionsHtml}
                    </div>
                    ${data.ipAddress ? `<div class="ip-info"><i class="fa-regular fa-globe"></i> IP: ${data.ipAddress}</div>` : ''}
                </div>
            </div>
        `;
    }
    
    // ============================================================================
    // CONVERT A SINGLE POST (used by htmx.onLoad)
    // ============================================================================
    
    function convertPostToModern($post) {
        const postId = $post.attr('id');
        
        if (!postId) return;
        
        // Check if modern card already exists
        if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
            const postData = extractPostData($post);
            if (postData) {
                const modernCard = generateModernPost(postData);
                $post.after(modernCard);
                log(`Created modern card for post: ${postId}`);
            }
        }
        
        // Hide original if modern view is active
        if (state.isModernView) {
            $post.hide();
        }
    }
    
    // ============================================================================
    // CORE FUNCTIONS - Hide original, show modern
    // ============================================================================
    
    function switchToModernView() {
        log('Switching to modern view...');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        const $originalPosts = $container.find(CONFIG.POST_SELECTOR);
        
        if (!$originalPosts.length) {
            log('No posts found');
            return;
        }
        
        // Convert any posts that don't have modern cards yet
        $originalPosts.each(function() {
            const $post = $(this);
            const postId = $post.attr('id');
            
            if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
                const postData = extractPostData($post);
                if (postData) {
                    const modernCard = generateModernPost(postData);
                    $post.after(modernCard);
                }
            }
        });
        
        // Hide all original posts
        $originalPosts.hide();
        
        // Show all modern cards
        $container.find('.post-card').show();
        
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
    // EVENT HANDLERS - Directly trigger original elements
    // ============================================================================
    
    function attachEventHandlers() {
        log('Attaching event handlers');
        
        // QUOTE - Find and click the original quote link
        $(document).on('click.forumModernizer', '.action-icon[data-action="quote"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            log('Quote post:', pid);
            
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            if ($originalPost.length) {
                const $quoteLink = $originalPost.find('a[href*="CODE=02"]');
                if ($quoteLink.length) {
                    window.location.href = $quoteLink.attr('href');
                } else {
                    log('Quote link not found');
                }
            }
        });
        
        // EDIT - Find and click the original edit link
        $(document).on('click.forumModernizer', '.action-icon[data-action="edit"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            log('Edit post:', pid);
            
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            if ($originalPost.length) {
                const $editLink = $originalPost.find('a[href*="CODE=08"]');
                if ($editLink.length) {
                    window.location.href = $editLink.attr('href');
                } else {
                    log('Edit link not found');
                }
            }
        });
        
        // DELETE - Use the global delete_post function
        $(document).on('click.forumModernizer', '.action-icon[data-action="delete"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            
            if (confirm('Are you sure you want to delete this post?')) {
                log('Delete post:', pid);
                if (typeof window.delete_post === 'function') {
                    window.delete_post(pid);
                } else {
                    log('delete_post function not found');
                }
            }
        });
        
        // SHARE - Copy URL to clipboard
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
                log('Share copied:', url);
            }).catch(err => log('Copy failed:', err));
        });
        
        // REPORT - Find and click the original report button
        $(document).on('click.forumModernizer', '.action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            log('Report post:', pid);
            
            // Try multiple ways to find the report button
            let $reportBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            
            if (!$reportBtn.length) {
                $reportBtn = $(`.report_button[data-pid="${pid}"]`);
            }
            
            if ($reportBtn.length) {
                $reportBtn[0].click();
            } else {
                log('Report button not found');
            }
        });
        
        // LIKE - Find and trigger the original like button
        $(document).on('click.forumModernizer', '.reaction-btn[data-action="like"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            log('Like post:', pid);
            
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            if ($originalPost.length) {
                const $likeSpan = $originalPost.find('.points .points_up');
                if ($likeSpan.length) {
                    const onclickAttr = $likeSpan.attr('onclick');
                    if (onclickAttr) {
                        eval(onclickAttr);
                    } else {
                        $likeSpan.click();
                    }
                }
            }
        });
        
        // CUSTOM REACTION - Trigger the emoji reaction
        $(document).on('click.forumModernizer', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pid = $(this).data('pid');
            log('Custom reaction:', pid);
            
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
    // HTMX INTEGRATION - Let htmx handle dynamic content!
    // ============================================================================
    
    function setupHtmxHandlers() {
        if (!state.htmxAvailable) {
            log('htmx not available, using fallback');
            return;
        }
        
        log('Setting up htmx handlers for dynamic content');
        
        // Method 1: htmx.onLoad() - catches ALL content loaded by htmx
        htmx.onLoad(function(target) {
            log('htmx.onLoad triggered for:', target);
            
            // Convert any new posts in the loaded content
            $(target).find('.post').each(function() {
                convertPostToModern($(this));
            });
            
            // Check if target itself is a post
            if ($(target).is('.post')) {
                convertPostToModern($(target));
            }
            
            // Re-attach handlers to any new modern cards
            $(target).find('.action-icon, .reaction-btn').each(function() {
                // Handlers are attached via delegation, so no need to re-bind
                log('New interactive element detected');
            });
        });
        
        // Method 2: Listen to htmx:load event for additional processing
        document.addEventListener('htmx:load', function(event) {
            const element = event.detail.elt;
            log('htmx:load event for:', element);
            
            // Additional initialization for new content
            if (state.isModernView) {
                // Ensure new posts are properly hidden if needed
                $(element).find('.post').hide();
            }
        });
        
        // Method 3: Listen to htmx:afterSwap for CSS transition timing
        document.addEventListener('htmx:afterSwap', function(event) {
            log('htmx:afterSwap completed for:', event.detail.target);
            
            // After swap is complete, ensure all modern cards are visible
            if (state.isModernView) {
                $(event.detail.target).find('.post-card').show();
                $(event.detail.target).find('.post').hide();
            }
        });
        
        // Method 4: Listen for htmx:beforeSwap to modify content before insertion
        document.addEventListener('htmx:beforeSwap', function(event) {
            // You can modify the response before it's swapped in
            log('htmx:beforeSwap - response length:', event.detail.xhr.responseText?.length);
        });
        
        log('htmx handlers configured');
    }
    
    // ============================================================================
    // CREATE VIEW BUTTONS
    // ============================================================================
    
    function createViewButtons() {
        if ($('#modern-view-btn').length > 0) {
            log('View buttons already exist');
            return;
        }
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) {
            log('Container not found, cannot create buttons');
            return;
        }
        
        const buttonHtml = `
            <div id="forum-view-controls" style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
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
        
        // Style active button
        $('<style>')
            .prop('type', 'text/css')
            .html(`
                #modern-view-btn.active, #classic-view-btn.active {
                    background: #2563eb !important;
                    color: white !important;
                    border-color: #2563eb !important;
                }
                .view-toggle-btn {
                    transition: all 0.2s ease;
                }
                .view-toggle-btn:hover:not(.active) {
                    background: #f3f4f6 !important;
                }
            `)
            .appendTo('head');
        
        // Bind button events
        $('#modern-view-btn').off('click').on('click', function(e) {
            e.preventDefault();
            switchToModernView();
        });
        
        $('#classic-view-btn').off('click').on('click', function(e) {
            e.preventDefault();
            switchToClassicView();
        });
        
        log('View buttons created');
    }
    
    // ============================================================================
    // INITIAL CONVERSION OF EXISTING POSTS
    // ============================================================================
    
    function initializeExistingPosts() {
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        const $posts = $container.find(CONFIG.POST_SELECTOR);
        
        log(`Found ${$posts.length} existing posts`);
        
        // Create modern cards for all existing posts (hidden initially)
        $posts.each(function() {
            convertPostToModern($(this));
        });
        
        // If saved preference is modern, hide originals and show modern
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (savedView === 'modern') {
            log('Restoring modern view from preference');
            $posts.hide();
            $container.find('.post-card').show();
            state.isModernView = true;
            $('#modern-view-btn').addClass('active');
            $('#classic-view-btn').removeClass('active');
        } else {
            // Default: classic view - originals visible, modern hidden
            $posts.show();
            $container.find('.post-card').hide();
            state.isModernView = false;
            $('#classic-view-btn').addClass('active');
            $('#modern-view-btn').removeClass('active');
        }
    }
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    function initialize() {
        log('========================================');
        log('Forum Modernizer v2.0 - htmx Powered');
        log(`htmx available: ${state.htmxAvailable}`);
        log('========================================');
        
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
        
        // Create view toggle buttons
        createViewButtons();
        
        // Attach event handlers (uses delegation, works for all elements)
        attachEventHandlers();
        
        // Setup htmx handlers for dynamic content
        setupHtmxHandlers();
        
        // Initialize existing posts
        initializeExistingPosts();
        
        // Update status display
        const statusText = state.isModernView ? 'Modern view active' : 'Classic view active';
        $('#view-status').html(`<i class="fas fa-info-circle"></i> ${statusText}`);
        
        log('Initialization complete!');
        log('Dynamic posts loaded via htmx will be automatically converted');
    }
    
    // ============================================================================
    // START
    // ============================================================================
    
    if (document.readyState === 'loading') {
        $(document).ready(initialize);
    } else {
        initialize();
    }
    
})();
