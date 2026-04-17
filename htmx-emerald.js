/**
 * HTMX-Powered Forum Modernizer
 * Transforms classic forum posts into modern cards using htmx swap engine
 * Full compliance with htmx 2.0.8 best practices and patterns
 */

(function() {
    'use strict';
    
    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    
    const CONFIG = {
        // Storage keys
        STORAGE_KEY: 'forumModernView',
        
        // CSS class names (following htmx conventions)
        INDICATOR_CLASS: 'htmx-indicator',
        REQUEST_CLASS: 'htmx-request',
        SETTLING_CLASS: 'htmx-settling',
        SWAPPING_CLASS: 'htmx-swapping',
        ADDED_CLASS: 'htmx-added',
        
        // Timing (ms)
        SETTLE_DELAY: 20,
        SWAP_DELAY: 0,
        
        // Features
        USE_TRANSITIONS: true,
        ENABLE_LOGGING: true,
        PRESERVE_HISTORY: true,
        
        // Selectors
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        MODERN_CARD_SELECTOR: '.post-card',
        CONTAINER_ID: 'posts-container'
    };
    
    // ============================================================================
    // STATE MANAGEMENT
    // ============================================================================
    
    let state = {
        originalHtml: null,
        isModernView: false,
        htmxAvailable: typeof htmx !== 'undefined',
        pendingRequests: new Map(),
        eventHandlersAttached: false,
        observer: null
    };
    
    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================
    
    function log(...args) {
        if (CONFIG.ENABLE_LOGGING && console) {
            console.log('[ForumModernizer]', ...args);
        }
    }
    
    function warn(...args) {
        if (CONFIG.ENABLE_LOGGING && console) {
            console.warn('[ForumModernizer]', ...args);
        }
    }
    
    function error(...args) {
        if (CONFIG.ENABLE_LOGGING && console) {
            console.error('[ForumModernizer]', ...args);
        }
    }
    
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function getPostIdFromElement(element) {
        const id = $(element).attr('id');
        if (!id) return null;
        return id.replace(CONFIG.POST_ID_PREFIX, '');
    }
    
    // ============================================================================
    // DATA EXTRACTION (从原始帖子提取数据)
    // ============================================================================
    
    function extractPostData($post) {
        const postId = getPostIdFromElement($post);
        if (!postId) {
            warn('Could not extract post ID from', $post);
            return null;
        }
        
        // Username
        const username = $post.find('.nick a').first().text().trim() || 'Unknown User';
        
        // Avatar URL
        let avatarUrl = $post.find('.avatar img').attr('src');
        if (avatarUrl && avatarUrl.includes('weserv.nl')) {
            const urlParams = new URLSearchParams(avatarUrl.split('?')[1]);
            avatarUrl = urlParams.get('url') || avatarUrl;
        }
        
        // User group / role
        const groupText = $post.find('.u_group dd').text().trim();
        const isAdmin = groupText === 'Administrator';
        const isMod = groupText === 'Moderator' || groupText === 'Global Moderator';
        let roleBadge = 'member';
        let roleIcon = 'fa-user';
        
        if (isAdmin) {
            roleBadge = 'admin';
            roleIcon = 'fa-crown';
        } else if (isMod) {
            roleBadge = 'moderator';
            roleIcon = 'fa-shield-haltered';
        } else if (groupText) {
            roleBadge = groupText.toLowerCase().replace(/\s+/g, '-');
            roleIcon = 'fa-tag';
        }
        
        // Post count
        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        
        // Reputation
        let reputation = $post.find('.u_reputation dd a').text().trim();
        reputation = reputation.replace('+', '');
        
        // Status (Online/Offline)
        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');
        
        // User title/rank
        let userTitle = $post.find('.u_title').text().trim();
        if (userTitle === 'Member') {
            const stars = $post.find('.u_rank i.fa-star').length;
            if (stars === 3) userTitle = 'Famous';
            else if (stars === 2) userTitle = 'Senior';
            else if (stars === 1) userTitle = 'Junior';
        }
        
        // Post content (preserve images, formatting)
        const postContent = $post.find('.right.Item table.color').clone();
        postContent.find('.signature').remove();
        postContent.find('.edit').remove();
        const contentHtml = postContent.html() || '';
        
        // Signature
        const signatureHtml = $post.find('.signature').html() || '';
        
        // Edit info
        let editInfo = '';
        const editText = $post.find('.edit').text().trim();
        if (editText) {
            editInfo = editText.replace('Edited by', 'Edited');
        }
        
        // Likes/reactions
        let likes = 0;
        let hasLikes = false;
        const pointsSpan = $post.find('.points');
        if (pointsSpan.find('.points_pos').length) {
            const likeText = pointsSpan.find('.points_pos').text();
            likes = parseInt(likeText) || 0;
            hasLikes = likes > 0;
        }
        
        // Custom emoji reactions
        let customReactions = [];
        $post.find('.st-emoji-post .st-emoji-counter').each(function() {
            const count = $(this).data('count') || 1;
            if (count > 0) {
                customReactions.push({ 
                    emoji: '😆', 
                    count: count,
                    img: 'https://twemoji.maxcdn.com/v/latest/svg/1f606.svg'
                });
            }
        });
        
        // IP address
        let ipAddress = $post.find('.ip_address dd a').text().trim();
        if (ipAddress) {
            const parts = ipAddress.split('.');
            if (parts.length === 4) {
                ipAddress = `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
            }
        }
        
        // Post number (position in thread)
        const postNumber = $post.index() + 1;
        
        // Timestamp
        let timestamp = $post.find('.when').attr('title') || '';
        let timeAgo = '';
        let datetime = '';
        
        if (timestamp) {
            const postDate = new Date(timestamp);
            datetime = postDate.toISOString();
            const now = new Date();
            const diffMs = now - postDate;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            const diffWeeks = Math.floor(diffDays / 7);
            const diffMonths = Math.floor(diffDays / 30);
            const diffYears = Math.floor(diffDays / 365);
            
            if (diffMins < 1) timeAgo = 'Just now';
            else if (diffMins < 60) timeAgo = `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
            else if (diffHours < 24) timeAgo = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            else if (diffDays < 7) timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            else if (diffWeeks < 4) timeAgo = `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
            else if (diffMonths < 12) timeAgo = `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
            else timeAgo = `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
        }
        
        return {
            postId, username, avatarUrl, roleBadge, roleIcon, groupText,
            postCount, reputation, isOnline, userTitle, contentHtml,
            signatureHtml, editInfo, likes, hasLikes, customReactions,
            ipAddress, postNumber, timeAgo, datetime
        };
    }
    
    // ============================================================================
    // MODERN POST GENERATION (生成现代化帖子卡片)
    // ============================================================================
    
    function generateModernPost(data) {
        if (!data) return '';
        
        // Generate reactions HTML
        let reactionsHtml = '';
        
        if (data.hasLikes || data.likes > 0 || data.customReactions.length > 0) {
            reactionsHtml = `
                <button class="reaction-btn" 
                        data-action="like" 
                        data-pid="${data.postId}"
                        hx-on:click="handleLike(event)"
                        aria-label="Like this post">
                    <i class="fa-regular fa-thumbs-up"></i>
                    ${data.likes > 0 ? `<span class="reaction-count">${data.likes}</span>` : ''}
                </button>
            `;
            
            // Add custom reactions
            for (const reaction of data.customReactions) {
                reactionsHtml += `
                    <button class="reaction-btn" 
                            data-action="react" 
                            data-pid="${data.postId}"
                            aria-label="Add reaction">
                        <img src="${reaction.img}" alt="emoji" class="reaction-emoji-img" width="16" height="16">
                        <span class="reaction-count">${reaction.count}</span>
                    </button>
                `;
            }
        } else {
            reactionsHtml = `
                <button class="reaction-btn" 
                        data-action="like" 
                        data-pid="${data.postId}"
                        aria-label="Like this post">
                    <i class="fa-regular fa-thumbs-up"></i>
                </button>
                <button class="reaction-btn" 
                        data-action="react" 
                        data-pid="${data.postId}"
                        aria-label="Add reaction">
                    <i class="fa-regular fa-face-smile"></i>
                </button>
            `;
        }
        
        // Determine user title icon
        let titleIcon = 'fa-medal';
        if (data.userTitle === 'Famous') titleIcon = 'fa-fire';
        else if (data.userTitle === 'Senior') titleIcon = 'fa-star';
        else if (data.userTitle === 'Junior') titleIcon = 'fa-seedling';
        
        // Status color
        const statusColor = data.isOnline ? '#10B981' : '#6B7280';
        const statusText = data.isOnline ? 'Online' : 'Offline';
        
        return `
            <article class="post-card ${CONFIG.ADDED_CLASS}" 
                     data-post-id="${data.postId}" 
                     data-original-id="${CONFIG.POST_ID_PREFIX}${data.postId}"
                     aria-labelledby="post-title-${data.postId}">
                
                <!-- Post Header -->
                <div class="post-header-modern">
                    <div class="post-meta-left">
                        <div class="post-number-badge" aria-label="Post number">
                            <i class="fas fa-hashtag" aria-hidden="true"></i>
                            <span>${data.postNumber}</span>
                        </div>
                        <div class="post-timestamp">
                            <time datetime="${data.datetime || ''}" 
                                  title="${data.datetime || ''}">
                                ${data.timeAgo || 'Recently'}
                            </time>
                        </div>
                    </div>
                    
                    <!-- Action Buttons Group -->
                    <div class="action-buttons-group" role="group" aria-label="Post actions">
                        <button class="action-icon" 
                                title="Quote" 
                                aria-label="Quote post"
                                data-action="quote" 
                                data-pid="${data.postId}">
                            <i class="fa-regular fa-quote-left" aria-hidden="true"></i>
                        </button>
                        
                        <button class="action-icon" 
                                title="Edit" 
                                aria-label="Edit post"
                                data-action="edit" 
                                data-pid="${data.postId}">
                            <i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>
                        </button>
                        
                        <button class="action-icon" 
                                title="Share" 
                                aria-label="Share post"
                                data-action="share" 
                                data-pid="${data.postId}">
                            <i class="fa-regular fa-share-nodes" aria-hidden="true"></i>
                        </button>
                        
                        <button class="action-icon report-action" 
                                title="Report" 
                                aria-label="Report post"
                                data-action="report" 
                                data-pid="${data.postId}">
                            <i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i>
                        </button>
                        
                        <button class="action-icon delete-action" 
                                title="Delete" 
                                aria-label="Delete post"
                                data-action="delete" 
                                data-pid="${data.postId}">
                            <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
                
                <!-- User Area -->
                <div class="user-area">
                    <div class="avatar-modern">
                        <img class="avatar-circle" 
                             src="${data.avatarUrl || 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(data.username)}" 
                             alt="Avatar of ${escapeHtml(data.username)}" 
                             width="70" 
                             height="70" 
                             loading="lazy">
                    </div>
                    
                    <div class="user-details">
                        <div class="username-row">
                            <span class="username" id="post-title-${data.postId}">
                                ${escapeHtml(data.username)}
                            </span>
                        </div>
                        
                        <div class="badge-container">
                            <span class="role-badge ${data.roleBadge}" 
                                  aria-label="User role: ${escapeHtml(data.groupText)}">
                                <i class="fas ${data.roleIcon}" aria-hidden="true"></i>
                                <span>${escapeHtml(data.groupText || 'Member')}</span>
                            </span>
                        </div>
                        
                        <div class="user-stats-grid" aria-label="User statistics">
                            <span class="stat-pill" title="User title">
                                <i class="fa-regular ${titleIcon}" aria-hidden="true"></i>
                                <span>${escapeHtml(data.userTitle)}</span>
                            </span>
                            <span class="stat-pill" title="Post count">
                                <i class="fa-regular fa-comments" aria-hidden="true"></i>
                                <span>${data.postCount} posts</span>
                            </span>
                            <span class="stat-pill" title="Reputation">
                                <i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>
                                <span>${data.reputation > 0 ? '+' : ''}${data.reputation} rep</span>
                            </span>
                            <span class="stat-pill" title="Status">
                                <i class="fa-regular fa-circle" style="color: ${statusColor};" aria-hidden="true"></i>
                                <span>${statusText}</span>
                            </span>
                        </div>
                    </div>
                </div>
                
                <!-- Post Body -->
                <div class="post-body">
                    <div class="post-text-content">
                        ${data.contentHtml}
                        ${data.editInfo ? `
                            <div class="edit-indicator" aria-label="Post has been edited">
                                <i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>
                                <span>${escapeHtml(data.editInfo)}</span>
                            </div>
                        ` : ''}
                    </div>
                    ${data.signatureHtml ? `
                        <div class="signature-modern" aria-label="User signature">
                            ${data.signatureHtml}
                        </div>
                    ` : ''}
                </div>
                
                <!-- Post Footer -->
                <div class="post-footer-modern">
                    <div class="reaction-cluster" role="group" aria-label="Post reactions">
                        ${reactionsHtml}
                    </div>
                    ${data.ipAddress ? `
                        <div class="ip-info" title="IP Address (masked)">
                            <i class="fa-regular fa-globe" aria-hidden="true"></i>
                            <span>IP: ${data.ipAddress}</span>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Loading indicators (htmx-style) -->
                <div id="indicator-${data.postId}" class="${CONFIG.INDICATOR_CLASS}" style="display: none;">
                    <i class="fas fa-spinner fa-spin"></i> Processing...
                </div>
            </article>
        `;
    }
    
    // ============================================================================
    // HTMX SWAP FUNCTION (使用htmx的swap引擎)
    // ============================================================================
    
    async function performSwap(container, newHtml, options = {}) {
        const defaultOptions = {
            swapStyle: 'innerHTML',
            settleDelay: CONFIG.SETTLE_DELAY,
            swapDelay: CONFIG.SWAP_DELAY,
            transition: CONFIG.USE_TRANSITIONS
        };
        
        const swapOptions = { ...defaultOptions, ...options };
        
        if (state.htmxAvailable && typeof htmx.swap === 'function') {
            log('Using htmx.swap() for transition');
            
            // Add loading class
            $(container).addClass(CONFIG.REQUEST_CLASS);
            
            try {
                // Use htmx's built-in swap engine
                htmx.swap(container, newHtml, {
                    swapStyle: swapOptions.swapStyle,
                    settleDelay: swapOptions.settleDelay,
                    swapDelay: swapOptions.swapDelay,
                    transition: swapOptions.transition
                });
                
                // Small delay for animations
                await new Promise(resolve => setTimeout(resolve, swapOptions.settleDelay));
            } finally {
                $(container).removeClass(CONFIG.REQUEST_CLASS);
            }
        } else {
            log('htmx.swap() not available, using jQuery fallback');
            $(container).html(newHtml);
        }
    }
    
    // ============================================================================
    // VIEW SWITCHING (视图切换)
    // ============================================================================
    
    async function switchToModernView() {
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        const $posts = $container.find(CONFIG.POST_SELECTOR);
        
        if ($posts.length === 0) {
            warn('No posts found to transform');
            return;
        }
        
        log(`Transforming ${$posts.length} posts to modern view`);
        
        // Store original HTML if not already stored
        if (!state.originalHtml) {
            state.originalHtml = $container.html();
            log('Original HTML cached');
        }
        
        // Build modern HTML
        let modernHtmlString = '';
        let successCount = 0;
        
        $posts.each(function() {
            const postData = extractPostData($(this));
            if (postData) {
                modernHtmlString += generateModernPost(postData);
                successCount++;
            } else {
                warn('Failed to extract data from post:', $(this).attr('id'));
            }
        });
        
        if (successCount === 0) {
            error('No posts could be transformed');
            return;
        }
        
        // Perform the swap
        await performSwap($container[0], modernHtmlString);
        
        // Attach event handlers to the new DOM
        attachGlobalEventDelegation();
        
        // Update UI state
        updateViewButtons('modern');
        state.isModernView = true;
        
        // Save preference
        if (CONFIG.PRESERVE_HISTORY) {
            localStorage.setItem(CONFIG.STORAGE_KEY, 'modern');
        }
        
        // Dispatch custom event for other scripts
        document.dispatchEvent(new CustomEvent('forum:modernViewActivated', {
            detail: { postCount: successCount }
        }));
        
        log('Modern view activated successfully');
    }
    
    function switchToClassicView() {
        if (!state.originalHtml) {
            log('No cached original HTML, cannot revert');
            return;
        }
        
        log('Reverting to classic view');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        
        if (state.htmxAvailable && typeof htmx.swap === 'function') {
            htmx.swap($container[0], state.originalHtml, {
                swapStyle: 'innerHTML',
                settleDelay: CONFIG.SETTLE_DELAY,
                transition: CONFIG.USE_TRANSITIONS
            });
        } else {
            $container.html(state.originalHtml);
        }
        
        updateViewButtons('classic');
        state.isModernView = false;
        
        if (CONFIG.PRESERVE_HISTORY) {
            localStorage.setItem(CONFIG.STORAGE_KEY, 'classic');
        }
        
        document.dispatchEvent(new CustomEvent('forum:classicViewActivated'));
        log('Classic view restored');
    }
    
    function updateViewButtons(activeView) {
        const $modernBtn = $('#modernViewBtn, #modern-view-btn');
        const $classicBtn = $('#originalViewBtn, #classic-view-btn');
        
        if (activeView === 'modern') {
            $modernBtn.addClass('active').attr('aria-pressed', 'true');
            $classicBtn.removeClass('active').attr('aria-pressed', 'false');
        } else {
            $classicBtn.addClass('active').attr('aria-pressed', 'true');
            $modernBtn.removeClass('active').attr('aria-pressed', 'false');
        }
    }
    
    // ============================================================================
    // EVENT HANDLERS (使用htmx风格的事件委托)
    // ============================================================================
    
    // Global event delegation (follows htmx pattern)
    function attachGlobalEventDelegation() {
        if (state.eventHandlersAttached) return;
        
        log('Attaching global event delegation');
        
        // Use event delegation on document (like htmx)
        $(document).off('.forumModernizer').on('click.forumModernizer', '.action-icon[data-action="quote"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Quote action:', pid);
            
            // Emit event (htmx-style)
            const quoteEvent = new CustomEvent('forum:quote', { detail: { pid } });
            document.dispatchEvent(quoteEvent);
            
            // Find original quote link
            const originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const quoteLink = originalPost.find('a[href*="CODE=02"], a:contains("Quote")').first();
            
            if (quoteLink.length) {
                window.location.href = quoteLink.attr('href');
            } else {
                warn(`Quote link not found for post ${pid}`);
            }
        });
        
        $(document).off('click.forumModernizer').on('click.forumModernizer', '.action-icon[data-action="edit"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Edit action:', pid);
            
            const editEvent = new CustomEvent('forum:edit', { detail: { pid } });
            document.dispatchEvent(editEvent);
            
            const originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const editLink = originalPost.find('a[href*="CODE=08"], a:contains("Edit")').first();
            
            if (editLink.length) {
                window.location.href = editLink.attr('href');
            } else {
                warn(`Edit link not found for post ${pid}`);
            }
        });
        
        $(document).off('click.forumModernizer').on('click.forumModernizer', '.action-icon[data-action="delete"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            
            if (confirm('⚠️ Are you sure you want to delete this post? This action cannot be undone.')) {
                log('Delete action:', pid);
                
                const deleteEvent = new CustomEvent('forum:delete', { detail: { pid } });
                document.dispatchEvent(deleteEvent);
                
                if (typeof window.delete_post === 'function') {
                    window.delete_post(pid);
                } else {
                    const originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
                    const deleteLink = originalPost.find('a[href*="delete_post"], a:contains("Delete")').first();
                    if (deleteLink.length) deleteLink[0].click();
                }
            }
        });
        
        $(document).off('click.forumModernizer').on('click.forumModernizer', '.action-icon[data-action="share"]', async function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const url = `${window.location.href.split('#')[0]}#entry${pid}`;
            
            try {
                await navigator.clipboard.writeText(url);
                
                // Visual feedback
                const $btn = $(this);
                const originalHtml = $btn.html();
                $btn.html('<i class="fas fa-check"></i>');
                setTimeout(() => $btn.html(originalHtml), 2000);
                
                log('Share action: URL copied', url);
                
                const shareEvent = new CustomEvent('forum:share', { detail: { pid, url } });
                document.dispatchEvent(shareEvent);
            } catch (err) {
                error('Failed to copy URL:', err);
            }
        });
        
        // Enhanced report handler with retry logic
        $(document).off('click.forumModernizer').on('click.forumModernizer', '.action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Report action:', pid);
            
            const reportEvent = new CustomEvent('forum:report', { detail: { pid } });
            document.dispatchEvent(reportEvent);
            
            function triggerReport(retries = 3) {
                // Try to find report button in original post
                let reportBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
                
                if (!reportBtn.length) {
                    reportBtn = $(`.report_button[data-pid="${pid}"]`);
                }
                
                if (reportBtn.length) {
                    log('Found report button, triggering');
                    reportBtn[0].click();
                    return true;
                }
                
                if (retries > 0) {
                    log(`Report button not found, retrying... (${retries} left)`);
                    setTimeout(() => triggerReport(retries - 1), 500);
                    return false;
                }
                
                error(`Report button not found for post ${pid} after multiple attempts`);
                alert('Report function temporarily unavailable. Please refresh the page and try again.');
                return false;
            }
            
            triggerReport();
        });
        
        $(document).off('click.forumModernizer').on('click.forumModernizer', '.reaction-btn[data-action="like"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Like action:', pid);
            
            const likeEvent = new CustomEvent('forum:like', { detail: { pid } });
            document.dispatchEvent(likeEvent);
            
            const originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const likeBtn = originalPost.find('.points_up, .points a').first();
            
            if (likeBtn.length) {
                const onclickAttr = likeBtn.attr('onclick');
                if (onclickAttr) {
                    eval(onclickAttr);
                } else {
                    likeBtn.click();
                }
            } else {
                warn(`Like button not found for post ${pid}`);
            }
        });
        
        $(document).off('click.forumModernizer').on('click.forumModernizer', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Custom reaction action:', pid);
            
            const reactEvent = new CustomEvent('forum:react', { detail: { pid } });
            document.dispatchEvent(reactEvent);
            
            // Fallback to like if custom reaction not available
            $(this).siblings('.reaction-btn[data-action="like"]').click();
        });
        
        state.eventHandlersAttached = true;
        log('Event delegation attached');
    }
    
    // ============================================================================
    // MUTATION OBSERVER (监听动态内容，符合htmx扩展模式)
    // ============================================================================
    
    function setupMutationObserver() {
        if (state.observer) {
            state.observer.disconnect();
        }
        
        state.observer = new MutationObserver((mutations) => {
            let hasNewPosts = false;
            let hasNewReportButtons = false;
            
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        // Check for new posts
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if ($(node).is(CONFIG.POST_SELECTOR) || $(node).find(CONFIG.POST_SELECTOR).length) {
                                hasNewPosts = true;
                            }
                            if ($(node).is('.report_button') || $(node).find('.report_button').length) {
                                hasNewReportButtons = true;
                            }
                        }
                    }
                }
            }
            
            // Handle new posts (convert them if modern view is active)
            if (hasNewPosts && state.isModernView) {
                log('New posts detected, converting to modern view');
                const $container = $(`#${CONFIG.CONTAINER_ID}`);
                const $newPosts = $container.find(CONFIG.POST_SELECTOR).filter(function() {
                    return !$(this).is(':hidden') && 
                           !$(this).next(`.post-card[data-original-id="${$(this).attr('id')}"]`).length;
                });
                
                if ($newPosts.length) {
                    let newHtml = '';
                    $newPosts.each(function() {
                        const postData = extractPostData($(this));
                        if (postData) newHtml += generateModernPost(postData);
                    });
                    
                    if (newHtml) {
                        $newPosts.last().after(newHtml);
                        $newPosts.css('display', 'none');
                    }
                }
            }
            
            // Refresh report button handlers if needed
            if (hasNewReportButtons && state.isModernView) {
                log('New report buttons detected, refreshing handlers');
                // Re-attach to ensure new buttons are captured
                attachGlobalEventDelegation();
            }
        });
        
        state.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        log('MutationObserver started');
    }
    
    // ============================================================================
    // UI BUTTONS CREATION (创建视图切换按钮)
    // ============================================================================
    
    function createViewToggleButtons() {
        if ($('#modernViewBtn, #modern-view-btn').length > 0) {
            return;
        }
        
        const buttonHtml = `
            <div class="forum-view-controls" style="margin-bottom: 1rem; display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                <div class="view-toggle-group" role="group" aria-label="Forum view mode" style="display: flex; gap: 0.5rem;">
                    <button id="modern-view-btn" 
                            class="view-toggle-btn modern-btn" 
                            data-view="modern"
                            aria-pressed="false"
                            style="padding: 8px 20px; border-radius: 8px; border: 1px solid #e5e7eb; background: white; cursor: pointer; font-weight: 500; transition: all 0.2s;">
                        <i class="fas fa-magic" aria-hidden="true"></i>
                        <span>Modern View</span>
                    </button>
                    <button id="classic-view-btn" 
                            class="view-toggle-btn classic-btn active" 
                            data-view="classic"
                            aria-pressed="true"
                            style="padding: 8px 20px; border-radius: 8px; border: 1px solid #e5e7eb; background: white; cursor: pointer; font-weight: 500; transition: all 0.2s;">
                        <i class="fas fa-history" aria-hidden="true"></i>
                        <span>Classic View</span>
                    </button>
                </div>
                <div class="view-status" style="font-size: 12px; color: #6b7280;">
                    <i class="fas fa-info-circle"></i>
                    <span>Switch between modern and classic post display</span>
                </div>
            </div>
        `;
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if ($container.length) {
            $container.before(buttonHtml);
        } else {
            $('.post').first().before(buttonHtml);
        }
        
        // Style the active button
        const style = document.createElement('style');
        style.textContent = `
            .view-toggle-btn.active {
                background: #2563eb !important;
                color: white !important;
                border-color: #2563eb !important;
            }
            .view-toggle-btn:hover:not(.active) {
                background: #f3f4f6 !important;
            }
        `;
        document.head.appendChild(style);
        
        // Attach button events
        $('#modern-view-btn').off('click').on('click', switchToModernView);
        $('#classic-view-btn').off('click').on('click', switchToClassicView);
        
        log('View toggle buttons created');
    }
    
    // ============================================================================
    // HTMX EVENT LISTENERS (监听htmx事件，实现高级功能)
    // ============================================================================
    
    function setupHtmxEventListeners() {
        if (!state.htmxAvailable) {
            log('htmx not available, skipping event listeners');
            return;
        }
        
        // Listen for htmx events (following htmx documentation)
        document.addEventListener('htmx:beforeSwap', function(evt) {
            // Handle 204 responses (delete)
            if (evt.detail.xhr && evt.detail.xhr.status === 204) {
                evt.detail.shouldSwap = true;
                evt.detail.swapStyle = 'delete';
                log('Handling 204 response for deletion');
            }
        });
        
        document.addEventListener('htmx:afterSwap', function(evt) {
            log('Swap completed:', evt.detail.target);
            // Re-attach event handlers after swap
            attachGlobalEventDelegation();
        });
        
        document.addEventListener('htmx:responseError', function(evt) {
            error('Response error:', evt.detail.xhr.status, evt.detail.xhr.statusText);
        });
        
        document.addEventListener('htmx:sendError', function(evt) {
            error('Send error:', evt.detail);
        });
        
        log('htmx event listeners configured');
    }
    
    // ============================================================================
    // INITIALIZATION (初始化)
    // ============================================================================
    
    function initialize() {
        log('Initializing Forum Modernizer...');
        log(`htmx available: ${state.htmxAvailable}`);
        
        // Ensure container exists
        if ($(`#${CONFIG.CONTAINER_ID}`).length === 0) {
            const $firstPost = $('.post').first();
            if ($firstPost.length) {
                $firstPost.parent().wrapInner(`<div id="${CONFIG.CONTAINER_ID}"></div>`);
                log(`Created container: #${CONFIG.CONTAINER_ID}`);
            } else {
                error('No posts found on page');
                return;
            }
        }
        
        // Create toggle buttons
        createViewToggleButtons();
        
        // Setup event delegation
        attachGlobalEventDelegation();
        
        // Setup mutation observer for dynamic content
        setupMutationObserver();
        
        // Setup htmx event listeners
        setupHtmxEventListeners();
        
        // Check saved preference
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (savedView === 'modern') {
            log('Restoring saved modern view preference');
            setTimeout(() => switchToModernView(), 100);
        }
        
        // Log success
        log('Forum Modernizer initialized successfully');
        
        // Dispatch initialization event
        document.dispatchEvent(new CustomEvent('forum:initialized', {
            detail: { version: '2.0.0', htmxAvailable: state.htmxAvailable }
        }));
    }
    
    // ============================================================================
    // EXPOSE PUBLIC API (暴露公共API，方便调试和扩展)
    // ============================================================================
    
    window.ForumModernizer = {
        // Public methods
        switchToModern: switchToModernView,
        switchToClassic: switchToClassicView,
        isModernView: () => state.isModernView,
        refresh: () => state.isModernView ? switchToModernView() : null,
        
        // Configuration
        config: CONFIG,
        
        // Utility
        log: log,
        version: '2.0.0',
        
        // Events (for external listeners)
        on: function(eventName, callback) {
            document.addEventListener(`forum:${eventName}`, callback);
        }
    };
    
    // ============================================================================
    // START (启动)
    // ============================================================================
    
    if (document.readyState === 'loading') {
        $(document).ready(initialize);
    } else {
        initialize();
    }
    
})();
