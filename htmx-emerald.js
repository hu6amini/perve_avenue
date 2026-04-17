/**
 * Forum Modernizer - Preserves original posts, only hides/shows them
 * All original functionality remains intact
 */

(function() {
    'use strict';
    
    const CONFIG = {
        STORAGE_KEY: 'forumModernView',
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container'
    };
    
    let state = {
        isModernView: false,
        initialized: false
    };
    
    function log(...args) {
        console.log('[ForumModernizer]', ...args);
    }
    
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
            postId, username, avatarUrl, groupText, isAdmin,
            postCount, reputation, isOnline, userTitle, contentHtml,
            signatureHtml, editInfo, likes, hasReactions, reactionCount,
            ipAddress, postNumber, timeAgo
        };
    }
    
    // ============================================================================
    // MODERN POST GENERATION
    // ============================================================================
    
    function generateModernPost(data) {
        const titleIcon = data.userTitle === 'Famous' ? 'fa-fire' : 
                         (data.userTitle === 'Senior' ? 'fa-star' : 'fa-medal');
        const statusColor = data.isOnline ? '#10B981' : '#6B7280';
        const roleBadgeClass = data.isAdmin ? 'admin' : 'member';
        const roleIcon = data.isAdmin ? 'fa-crown' : 'fa-user';
        
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
                    <img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" class="reaction-emoji-img" width="16" height="16">
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
                            <span class="role-badge ${roleBadgeClass}">
                                <i class="fas ${roleIcon}"></i> ${escapeHtml(data.groupText || 'Member')}
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
        
        // Check if modern cards already exist
        const $existingCards = $container.find('.post-card');
        
        if ($existingCards.length === 0) {
            // Generate and insert modern cards
            let modernHtml = '';
            $originalPosts.each(function() {
                const postData = extractPostData($(this));
                if (postData) {
                    modernHtml += generateModernPost(postData);
                }
            });
            
            // Insert after each original post
            $originalPosts.each(function(index) {
                const $this = $(this);
                const modernCard = $(modernHtml).eq(index);
                $this.after(modernCard);
            });
            
            log(`Created ${$originalPosts.length} modern cards`);
        } else {
            log('Modern cards already exist, just showing them');
            $existingCards.show();
        }
        
        // Hide original posts
        $originalPosts.hide();
        
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
        $(document).on('click', '.action-icon[data-action="quote"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Quote post:', pid);
            
            // Find the hidden original post
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            
            if ($originalPost.length) {
                // Look for the quote link - from your HTML: href*="CODE=02"
                const $quoteLink = $originalPost.find('a[href*="CODE=02"]');
                if ($quoteLink.length) {
                    log('Found quote link, navigating to:', $quoteLink.attr('href'));
                    window.location.href = $quoteLink.attr('href');
                } else {
                    log('Quote link not found for post', pid);
                }
            } else {
                log('Original post not found:', CONFIG.POST_ID_PREFIX + pid);
            }
        });
        
        // EDIT - Find and click the original edit link
        $(document).on('click', '.action-icon[data-action="edit"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Edit post:', pid);
            
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            
            if ($originalPost.length) {
                // Look for edit link - from your HTML: href*="CODE=08"
                const $editLink = $originalPost.find('a[href*="CODE=08"]');
                if ($editLink.length) {
                    log('Found edit link, navigating to:', $editLink.attr('href'));
                    window.location.href = $editLink.attr('href');
                } else {
                    log('Edit link not found for post', pid);
                }
            }
        });
        
        // DELETE - Use the global delete_post function
        $(document).on('click', '.action-icon[data-action="delete"]', function(e) {
            e.preventDefault();
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
        $(document).on('click', '.action-icon[data-action="share"]', function(e) {
            e.preventDefault();
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
        $(document).on('click', '.action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Report post:', pid);
            
            // Try multiple ways to find the report button
            let $reportBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            
            if (!$reportBtn.length) {
                $reportBtn = $(`.report_button[data-pid="${pid}"]`);
            }
            
            if ($reportBtn.length) {
                log('Found report button, triggering click');
                // Trigger the click event properly
                $reportBtn[0].click();
            } else {
                log('Report button not found for post', pid);
                // Fallback: try to find any report button in the original post
                const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
                const anyReport = $originalPost.find('.report_button');
                if (anyReport.length) {
                    anyReport[0].click();
                }
            }
        });
        
        // LIKE - Find and trigger the original like button
        $(document).on('click', '.reaction-btn[data-action="like"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Like post:', pid);
            
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            
            if ($originalPost.length) {
                // Find the like button/span
                const $likeSpan = $originalPost.find('.points .points_up');
                
                if ($likeSpan.length) {
                    const onclickAttr = $likeSpan.attr('onclick');
                    if (onclickAttr) {
                        log('Executing like onclick');
                        eval(onclickAttr);
                    } else {
                        $likeSpan.click();
                    }
                } else {
                    // Alternative: find .points a
                    const $pointsLink = $originalPost.find('.points a');
                    if ($pointsLink.length && $pointsLink.attr('onclick')) {
                        eval($pointsLink.attr('onclick'));
                    }
                }
            }
        });
        
        // CUSTOM REACTION - Trigger the emoji reaction
        $(document).on('click', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Custom reaction for post:', pid);
            
            // Find the emoji reaction area in original post
            const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $emojiContainer = $originalPost.find('.st-emoji-post .st-emoji-container');
            
            if ($emojiContainer.length) {
                // Trigger click on the emoji container
                $emojiContainer.click();
            } else {
                // Fallback to like
                $(this).siblings('.reaction-btn[data-action="like"]').click();
            }
        });
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
            <div id="forum-view-controls" style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center;">
                <button id="modern-view-btn" class="view-toggle-btn" style="padding: 6px 16px; border-radius: 6px; border: 1px solid #ccc; background: white; cursor: pointer;">
                    <i class="fas fa-magic"></i> Modern View
                </button>
                <button id="classic-view-btn" class="view-toggle-btn active" style="padding: 6px 16px; border-radius: 6px; border: 1px solid #ccc; background: white; cursor: pointer;">
                    <i class="fas fa-history"></i> Classic View
                </button>
                <span style="font-size: 12px; color: #666;">Switch between post display modes</span>
            </div>
        `;
        
        $container.before(buttonHtml);
        
        // Bind button events
        $('#modern-view-btn').on('click', function(e) {
            e.preventDefault();
            switchToModernView();
        });
        
        $('#classic-view-btn').on('click', function(e) {
            e.preventDefault();
            switchToClassicView();
        });
        
        log('View buttons created');
    }
    
    // ============================================================================
    // MUTATION OBSERVER - Handle dynamically loaded posts
    // ============================================================================
    
    function setupMutationObserver() {
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    // Check if new posts were added
                    $(mutation.addedNodes).each(function() {
                        const $node = $(this);
                        if ($node.is(CONFIG.POST_SELECTOR) || $node.find(CONFIG.POST_SELECTOR).length) {
                            log('New posts detected');
                            // If modern view is active, convert the new posts
                            if (state.isModernView) {
                                const $newPosts = $node.is(CONFIG.POST_SELECTOR) ? $node : $node.find(CONFIG.POST_SELECTOR);
                                $newPosts.each(function() {
                                    const $newPost = $(this);
                                    const postId = $newPost.attr('id');
                                    
                                    // Check if modern card already exists
                                    if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
                                        const postData = extractPostData($newPost);
                                        if (postData) {
                                            const modernCard = generateModernPost(postData);
                                            $newPost.after(modernCard);
                                            $newPost.hide();
                                        }
                                    }
                                });
                            }
                        }
                    });
                }
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        log('MutationObserver started');
    }
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    function initialize() {
        log('========================================');
        log('Forum Modernizer initializing');
        log('========================================');
        
        // Create container if needed
        if ($(`#${CONFIG.CONTAINER_ID}`).length === 0) {
            const $firstPost = $('.post').first();
            if ($firstPost.length) {
                $firstPost.parent().wrapInner(`<div id="${CONFIG.CONTAINER_ID}"></div>`);
                log('Created posts container');
            } else {
                log('ERROR: No posts found on page');
                return;
            }
        }
        
        // Create view buttons
        createViewButtons();
        
        // Attach event handlers
        attachEventHandlers();
        
        // Setup mutation observer for dynamic content
        setupMutationObserver();
        
        // Check saved preference
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (savedView === 'modern') {
            log('Restoring modern view from preference');
            setTimeout(switchToModernView, 100);
        } else {
            // Ensure classic view is active (original posts visible)
            $(`#${CONFIG.CONTAINER_ID}`).find(CONFIG.POST_SELECTOR).show();
            $(`#${CONFIG.CONTAINER_ID}`).find('.post-card').remove();
        }
        
        state.initialized = true;
        log('Initialization complete!');
    }
    
    // Start
    if (document.readyState === 'loading') {
        $(document).ready(initialize);
    } else {
        initialize();
    }
    
})();
