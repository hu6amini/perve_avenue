/**
 * Forum Modernizer - Complete htmx Integration
 * Catches ALL dynamically loaded content including plugins
 * Uses every htmx dynamic content feature
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
        SETTLE_DELAY: 100,  // Increased for plugin loading
        REACTION_POLL_INTERVAL: 500,  // Poll for reaction buttons that load later
        MAX_REACTION_WAIT: 5000  // Max time to wait for reactions
    };
    
    // ============================================================================
    // STATE
    // ============================================================================
    
    let state = {
        isModernView: false,
        htmxAvailable: typeof htmx !== 'undefined',
        pendingReactions: new Map(),  // Track posts waiting for reaction buttons
        reactionObservers: []  // Store observers for cleanup
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
    // DATA EXTRACTION - Enhanced for plugin content
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
        
        // Post count
        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        
        // Reputation
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
        
        // Post content
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
            editInfo = editText;
        }
        
        // Likes - from .points (may load later)
        let likes = 0;
        const pointsPos = $post.find('.points .points_pos');
        if (pointsPos.length) {
            likes = parseInt(pointsPos.text()) || 0;
        }
        
        // Reaction plugin data (st-emoji) - may not exist yet!
        const hasReactions = $post.find('.st-emoji-post').length > 0;
        let reactionCount = 0;
        
        // Check multiple possible reaction locations
        $post.find('.st-emoji-post .st-emoji-counter, .st-emoji-container .st-emoji-counter').each(function() {
            reactionCount += parseInt($(this).data('count') || $(this).text() || 1);
        });
        
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
            signatureHtml, editInfo, likes, hasReactions, reactionCount,
            ipAddress, postNumber, timeAgo
        };
    }
    
    // ============================================================================
    // MODERN POST GENERATION with placeholders for reactions
    // ============================================================================
    
    function generateModernPost(data) {
        if (!data) return '';
        
        const titleIcon = data.userTitle === 'Famous' ? 'fa-fire' : 
                         (data.userTitle === 'Senior' ? 'fa-star' : 'fa-medal');
        const statusColor = data.isOnline ? '#10B981' : '#6B7280';
        
        // Create reaction area with placeholder that will be updated
        const reactionPlaceholderId = `reactions-${data.postId}`;
        
        // Initial reactions HTML (will be updated when plugin loads)
        let reactionsHtml = `
            <div id="${reactionPlaceholderId}" class="reaction-placeholder" data-post-id="${data.postId}">
                <button class="reaction-btn reaction-loading" data-action="like" data-pid="${data.postId}">
                    <i class="fa-regular fa-thumbs-up"></i>
                    ${data.likes > 0 ? `<span class="reaction-count">${data.likes}</span>` : ''}
                </button>
                <button class="reaction-btn reaction-loading" data-action="react" data-pid="${data.postId}">
                    <i class="fa-regular fa-face-smile"></i>
                </button>
                <span class="reaction-loading-indicator" style="font-size: 11px; color: #999;">
                    <i class="fas fa-spinner fa-spin"></i> Loading reactions...
                </span>
            </div>
        `;
        
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
                    <div class="reaction-cluster" data-reaction-container="${data.postId}">
                        ${reactionsHtml}
                    </div>
                    ${data.ipAddress ? `<div class="ip-info"><i class="fa-regular fa-globe"></i> IP: ${data.ipAddress}</div>` : ''}
                </div>
            </div>
        `;
    }
    
    // ============================================================================
    // UPDATE REACTIONS - Sync with plugin when it loads
    // ============================================================================
    
    function updateReactionButtons(postId) {
        const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${postId}`);
        const $modernCard = $(`.post-card[data-post-id="${postId}"]`);
        const $reactionContainer = $modernCard.find('.reaction-cluster');
        
        if (!$originalPost.length || !$modernCard.length) return false;
        
        // Extract updated reaction data from original post
        const postData = extractPostData($originalPost);
        if (!postData) return false;
        
        // Check if reaction plugin has loaded
        const hasPluginReactions = $originalPost.find('.st-emoji-post .st-emoji-counter').length > 0;
        
        let newReactionsHtml = '';
        
        if (postData.likes > 0 || hasPluginReactions) {
            newReactionsHtml = `
                <button class="reaction-btn" data-action="like" data-pid="${postId}">
                    <i class="fa-regular fa-thumbs-up"></i>
                    ${postData.likes > 0 ? `<span class="reaction-count">${postData.likes}</span>` : ''}
                </button>
            `;
            
            if (hasPluginReactions) {
                // Try to extract the actual emoji from the plugin
                const emojiImg = $originalPost.find('.st-emoji-post img').first().attr('src') || 
                                'https://twemoji.maxcdn.com/v/latest/svg/1f606.svg';
                newReactionsHtml += `
                    <button class="reaction-btn" data-action="react" data-pid="${postId}">
                        <img src="${emojiImg}" class="reaction-emoji-img" width="16" height="16" alt="reaction">
                        <span class="reaction-count">${postData.reactionCount}</span>
                    </button>
                `;
            } else {
                newReactionsHtml += `
                    <button class="reaction-btn" data-action="react" data-pid="${postId}">
                        <i class="fa-regular fa-face-smile"></i>
                    </button>
                `;
            }
        } else {
            newReactionsHtml = `
                <button class="reaction-btn" data-action="like" data-pid="${postId}">
                    <i class="fa-regular fa-thumbs-up"></i>
                </button>
                <button class="reaction-btn" data-action="react" data-pid="${postId}">
                    <i class="fa-regular fa-face-smile"></i>
                </button>
            `;
        }
        
        $reactionContainer.html(newReactionsHtml);
        log(`Updated reactions for post ${postId}`);
        return true;
    }
    
    // ============================================================================
    // WAIT FOR REACTION PLUGIN USING MUTATION OBSERVER (only for this specific case)
    // ============================================================================
    
    function watchForReactionPlugin(postId) {
        return new Promise((resolve) => {
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${postId}`);
            
            if (!$originalPost.length) {
                resolve(false);
                return;
            }
            
            // Check if reactions already exist
            if ($originalPost.find('.st-emoji-post').length > 0) {
                resolve(updateReactionButtons(postId));
                return;
            }
            
            // Watch for the reaction plugin to load
            const observer = new MutationObserver((mutations, obs) => {
                if ($originalPost.find('.st-emoji-post').length > 0) {
                    log(`Reaction plugin loaded for post ${postId}`);
                    updateReactionButtons(postId);
                    obs.disconnect();
                    resolve(true);
                }
            });
            
            observer.observe($originalPost[0], {
                childList: true,
                subtree: true
            });
            
            // Timeout after 5 seconds
            setTimeout(() => {
                observer.disconnect();
                log(`Reaction plugin timeout for post ${postId}`);
                resolve(false);
            }, CONFIG.MAX_REACTION_WAIT);
            
            state.reactionObservers.push(observer);
        });
    }
    
    // ============================================================================
    // CONVERT A SINGLE POST with reaction waiting
    // ============================================================================
    
    async function convertPostToModern($post) {
        const postId = $post.attr('id');
        
        if (!postId) return;
        
        // Check if modern card already exists
        if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
            const postData = extractPostData($post);
            if (postData) {
                const modernCard = generateModernPost(postData);
                $post.after(modernCard);
                log(`Created modern card for post: ${postId}`);
                
                // Start watching for reaction plugin
                watchForReactionPlugin(postData.postId);
            }
        } else if (state.isModernView) {
            // Update existing modern card's reactions
            updateReactionButtons(postId.replace(CONFIG.POST_ID_PREFIX, ''));
        }
        
        // Hide original if modern view is active
        if (state.isModernView) {
            $post.hide();
        }
    }
    
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
        
        // Convert any posts that don't have modern cards yet
        $originalPosts.each(async function() {
            const $post = $(this);
            const postId = $post.attr('id');
            
            if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
                await convertPostToModern($post);
            } else {
                // Update existing card's reactions
                updateReactionButtons(postId.replace(CONFIG.POST_ID_PREFIX, ''));
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
                if ($quoteLink.length) {
                    window.location.href = $quoteLink.attr('href');
                }
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
                if ($editLink.length) {
                    window.location.href = $editLink.attr('href');
                }
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
            if (!$reportBtn.length) {
                $reportBtn = $(`.report_button[data-pid="${pid}"]`);
            }
            if ($reportBtn.length) {
                $reportBtn[0].click();
            }
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
                    if (onclickAttr) {
                        eval(onclickAttr);
                    } else {
                        $likeSpan.click();
                    }
                }
            }
        });
        
        // CUSTOM REACTION
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
    }
    
    // ============================================================================
    // COMPREHENSIVE HTMX HANDLERS - Catching EVERYTHING
    // ============================================================================
    
    function setupHtmxHandlers() {
        if (!state.htmxAvailable) {
            log('htmx not available, using fallback observers');
            setupFallbackObservers();
            return;
        }
        
        log('Setting up comprehensive htmx handlers');
        
        // 1. htmx.onLoad() - catches ALL content loaded by htmx
        htmx.onLoad(async function(target) {
            log('htmx.onLoad triggered');
            
            // Convert posts
            const newPosts = $(target).find('.post');
            if (newPosts.length) {
                log(`Found ${newPosts.length} new posts via htmx.onLoad`);
                for (const post of newPosts) {
                    await convertPostToModern($(post));
                }
            }
            
            if ($(target).is('.post')) {
                await convertPostToModern($(target));
            }
            
            // Check for reaction plugin elements that just loaded
            $(target).find('.st-emoji-post, .st-emoji-container').each(function() {
                const $parentPost = $(this).closest('.post');
                if ($parentPost.length) {
                    const postId = $parentPost.attr('id');
                    if (postId) {
                        updateReactionButtons(postId.replace(CONFIG.POST_ID_PREFIX, ''));
                    }
                }
            });
        });
        
        // 2. htmx:load event
        document.addEventListener('htmx:load', function(event) {
            log('htmx:load event');
            const element = event.detail.elt;
            
            if (state.isModernView) {
                $(element).find('.post').hide();
                $(element).find('.post-card').show();
            }
        });
        
        // 3. htmx:afterSwap event
        document.addEventListener('htmx:afterSwap', function(event) {
            log('htmx:afterSwap completed');
            
            // Re-check for reaction buttons after swap settles
            setTimeout(() => {
                $(event.detail.target).find('.post').each(function() {
                    const postId = $(this).attr('id');
                    if (postId) {
                        updateReactionButtons(postId.replace(CONFIG.POST_ID_PREFIX, ''));
                    }
                });
            }, CONFIG.SETTLE_DELAY);
        });
        
        // 4. htmx:beforeSwap - modify response if needed
        document.addEventListener('htmx:beforeSwap', function(event) {
            // You could inject reaction placeholders here if needed
            log('htmx:beforeSwap');
        });
    }
    
    // ============================================================================
    // FALLBACK OBSERVERS (when htmx not available)
    // ============================================================================
    
    function setupFallbackObservers() {
        log('Setting up fallback MutationObserver');
        
        // Watch for new posts
        const postObserver = new MutationObserver((mutations) => {
            mutations.forEach(async (mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const $node = $(node);
                            if ($node.is('.post') || $node.find('.post').length) {
                                const posts = $node.is('.post') ? $node : $node.find('.post');
                                for (const post of posts) {
                                    await convertPostToModern($(post));
                                }
                            }
                        }
                    }
                }
            });
        });
        
        postObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        state.reactionObservers.push(postObserver);
        
        // Watch for reaction plugin loading
        const reactionObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const $node = $(node);
                            if ($node.is('.st-emoji-post, .st-emoji-container') || 
                                $node.find('.st-emoji-post, .st-emoji-container').length) {
                                
                                const $parentPost = $node.closest('.post');
                                if ($parentPost.length) {
                                    const postId = $parentPost.attr('id');
                                    if (postId) {
                                        updateReactionButtons(postId.replace(CONFIG.POST_ID_PREFIX, ''));
                                    }
                                }
                            }
                        }
                    }
                }
            });
        });
        
        reactionObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        state.reactionObservers.push(reactionObserver);
    }
    
    // ============================================================================
    // CREATE VIEW BUTTONS
    // ============================================================================
    
    function createViewButtons() {
        if ($('#modern-view-btn').length > 0) {
            return;
        }
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) return;
        
        const buttonHtml = `
            <div id="forum-view-controls" style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <button id="modern-view-btn" class="view-toggle-btn" style="padding: 8px 18px; border-radius: 8px; border: 1px solid #ccc; background: white; cursor: pointer;">
                    <i class="fas fa-magic"></i> Modern View
                </button>
                <button id="classic-view-btn" class="view-toggle-btn active" style="padding: 8px 18px; border-radius: 8px; border: 1px solid #ccc; background: white; cursor: pointer;">
                    <i class="fas fa-history"></i> Classic View
                </button>
                <span id="view-status" style="font-size: 12px; color: #666;"></span>
            </div>
        `;
        
        $container.before(buttonHtml);
        
        $('#modern-view-btn').off('click').on('click', switchToModernView);
        $('#classic-view-btn').off('click').on('click', switchToClassicView);
    }
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    async function initialize() {
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
        
        log(`Found ${$posts.length} existing posts`);
        
        for (const post of $posts) {
            await convertPostToModern($(post));
        }
        
        // Check saved preference
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (savedView === 'modern') {
            await switchToModernView();
            $('#view-status').html('<i class="fas fa-check-circle"></i> Modern view active');
        } else {
            $posts.show();
            $container.find('.post-card').hide();
            $('#view-status').html('<i class="fas fa-info-circle"></i> Classic view active');
        }
        
        log('Initialization complete!');
        log('Watching for: posts, reactions, plugins, and all dynamic content');
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
