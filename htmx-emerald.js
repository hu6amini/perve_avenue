/**
 * HTMX-Powered Forum Modernizer - FIXED VERSION
 * Complete working solution with proper initialization
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
        ENABLE_LOGGING: true,
        SETTLE_DELAY: 20
    };
    
    // ============================================================================
    // STATE
    // ============================================================================
    
    let state = {
        originalHtml: null,
        isModernView: false,
        initialized: false
    };
    
    // ============================================================================
    // LOGGING
    // ============================================================================
    
    function log(...args) {
        if (CONFIG.ENABLE_LOGGING && console) {
            console.log('[ForumModernizer]', ...args);
        }
    }
    
    function error(...args) {
        if (CONFIG.ENABLE_LOGGING && console) {
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
    // DATA EXTRACTION
    // ============================================================================
    
    function extractPostData($post) {
        const postId = $post.attr('id').replace(CONFIG.POST_ID_PREFIX, '');
        
        // Username
        const username = $post.find('.nick a').first().text().trim() || 'Unknown';
        
        // Avatar
        let avatarUrl = $post.find('.avatar img').attr('src');
        if (avatarUrl && avatarUrl.includes('weserv.nl')) {
            const urlParams = new URLSearchParams(avatarUrl.split('?')[1]);
            avatarUrl = urlParams.get('url') || avatarUrl;
        }
        
        // Role
        const groupText = $post.find('.u_group dd').text().trim();
        const isAdmin = groupText === 'Administrator';
        const roleBadge = isAdmin ? 'admin' : 'member';
        const roleIcon = isAdmin ? 'fa-crown' : 'fa-user';
        
        // Stats
        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        let reputation = $post.find('.u_reputation dd a').text().trim().replace('+', '');
        
        // Status
        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');
        
        // Title
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
        if (editText) {
            editInfo = editText.replace('Edited by', 'Edited');
        }
        
        // Likes
        let likes = 0;
        const pointsSpan = $post.find('.points');
        if (pointsSpan.find('.points_pos').length) {
            likes = parseInt(pointsSpan.find('.points_pos').text()) || 0;
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
        
        // Time ago
        let timestamp = $post.find('.when').attr('title') || '';
        let timeAgo = '';
        if (timestamp) {
            const postDate = new Date(timestamp);
            const now = new Date();
            const diffDays = Math.floor((now - postDate) / (1000 * 60 * 60 * 24));
            if (diffDays >= 1) {
                timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            } else {
                const diffHours = Math.floor((now - postDate) / (1000 * 60 * 60));
                timeAgo = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            }
        }
        
        return {
            postId, username, avatarUrl, roleBadge, roleIcon, groupText,
            postCount, reputation, isOnline, userTitle, contentHtml,
            signatureHtml, editInfo, likes, ipAddress, postNumber, timeAgo
        };
    }
    
    // ============================================================================
    // MODERN POST GENERATION
    // ============================================================================
    
    function generateModernPost(data) {
        if (!data) return '';
        
        const titleIcon = data.userTitle === 'Famous' ? 'fa-fire' : 'fa-medal';
        const statusColor = data.isOnline ? '#10B981' : '#6B7280';
        const statusText = data.isOnline ? 'Online' : 'Offline';
        
        return `
            <article class="post-card" data-post-id="${data.postId}" data-original-id="${CONFIG.POST_ID_PREFIX}${data.postId}">
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
                            <span class="role-badge ${data.roleBadge}">
                                <i class="fas ${data.roleIcon}"></i> ${escapeHtml(data.groupText || 'Member')}
                            </span>
                        </div>
                        <div class="user-stats-grid">
                            <span class="stat-pill"><i class="fa-regular ${titleIcon}"></i> ${data.userTitle}</span>
                            <span class="stat-pill"><i class="fa-regular fa-comments"></i> ${data.postCount} posts</span>
                            <span class="stat-pill"><i class="fa-regular fa-thumbs-up"></i> ${data.reputation > 0 ? '+' : ''}${data.reputation} rep</span>
                            <span class="stat-pill"><i class="fa-regular fa-circle" style="color: ${statusColor}"></i> ${statusText}</span>
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
                        <button class="reaction-btn" data-action="like" data-pid="${data.postId}">
                            <i class="fa-regular fa-thumbs-up"></i>
                            ${data.likes > 0 ? `<span class="reaction-count">${data.likes}</span>` : ''}
                        </button>
                        <button class="reaction-btn" data-action="react" data-pid="${data.postId}">
                            <i class="fa-regular fa-face-smile"></i>
                        </button>
                    </div>
                    ${data.ipAddress ? `<div class="ip-info"><i class="fa-regular fa-globe"></i> IP: ${data.ipAddress}</div>` : ''}
                </div>
            </article>
        `;
    }
    
    // ============================================================================
    // CORE FUNCTIONS
    // ============================================================================
    
    function switchToModernView() {
        log('switchToModernView called');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        
        if (!$container.length) {
            error(`Container #${CONFIG.CONTAINER_ID} not found`);
            return;
        }
        
        const $posts = $container.find(CONFIG.POST_SELECTOR);
        
        if (!$posts.length) {
            error('No posts found');
            return;
        }
        
        log(`Found ${$posts.length} posts to transform`);
        
        // Store original HTML if not already stored
        if (!state.originalHtml) {
            state.originalHtml = $container.html();
            log('Original HTML cached');
        }
        
        // Build modern HTML
        let modernHtml = '';
        $posts.each(function() {
            const postData = extractPostData($(this));
            if (postData) {
                modernHtml += generateModernPost(postData);
            }
        });
        
        if (!modernHtml) {
            error('Failed to generate modern HTML');
            return;
        }
        
        // Apply the new HTML
        $container.html(modernHtml);
        
        // Hide original posts (they've been replaced, but we need to preserve them for revert)
        // Store the original posts separately
        if (!window._originalPostsHtml) {
            window._originalPostsHtml = state.originalHtml;
        }
        
        // Re-attach event handlers
        attachEventHandlers();
        
        // Update UI
        state.isModernView = true;
        updateButtonStates('modern');
        
        // Save preference
        localStorage.setItem(CONFIG.STORAGE_KEY, 'modern');
        
        log('Modern view activated successfully');
    }
    
    function switchToClassicView() {
        log('switchToClassicView called');
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        
        if (!$container.length) {
            error('Container not found');
            return;
        }
        
        // Restore original HTML
        const originalHtml = window._originalPostsHtml || state.originalHtml;
        
        if (originalHtml) {
            $container.html(originalHtml);
            state.isModernView = false;
            updateButtonStates('classic');
            localStorage.setItem(CONFIG.STORAGE_KEY, 'classic');
            log('Classic view restored');
        } else {
            error('No original HTML to restore');
        }
    }
    
    function updateButtonStates(activeView) {
        const $modernBtn = $('#modern-view-btn');
        const $classicBtn = $('#classic-view-btn');
        
        if (activeView === 'modern') {
            $modernBtn.addClass('active').css({
                background: '#2563eb',
                color: 'white',
                borderColor: '#2563eb'
            });
            $classicBtn.removeClass('active').css({
                background: 'white',
                color: '#333',
                borderColor: '#e5e7eb'
            });
        } else {
            $classicBtn.addClass('active').css({
                background: '#2563eb',
                color: 'white',
                borderColor: '#2563eb'
            });
            $modernBtn.removeClass('active').css({
                background: 'white',
                color: '#333',
                borderColor: '#e5e7eb'
            });
        }
    }
    
    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    
    function attachEventHandlers() {
        log('Attaching event handlers');
        
        // Quote
        $(document).off('click.forumModernizer', '.action-icon[data-action="quote"]')
                   .on('click.forumModernizer', '.action-icon[data-action="quote"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Quote clicked:', pid);
            
            // Try to find original post (might be hidden or in stored HTML)
            let originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            
            if (!originalPost.length && window._originalPostsHtml) {
                // Create a temporary DOM to search
                const temp = $('<div>').html(window._originalPostsHtml);
                originalPost = temp.find(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            }
            
            const quoteLink = originalPost.find('a[href*="CODE=02"], a:contains("Quote")').first();
            if (quoteLink.length) {
                window.location.href = quoteLink.attr('href');
            } else {
                error('Quote link not found');
            }
        });
        
        // Edit
        $(document).off('click.forumModernizer', '.action-icon[data-action="edit"]')
                   .on('click.forumModernizer', '.action-icon[data-action="edit"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Edit clicked:', pid);
            
            let originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            if (!originalPost.length && window._originalPostsHtml) {
                const temp = $('<div>').html(window._originalPostsHtml);
                originalPost = temp.find(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            }
            
            const editLink = originalPost.find('a[href*="CODE=08"], a:contains("Edit")').first();
            if (editLink.length) {
                window.location.href = editLink.attr('href');
            } else {
                error('Edit link not found');
            }
        });
        
        // Delete
        $(document).off('click.forumModernizer', '.action-icon[data-action="delete"]')
                   .on('click.forumModernizer', '.action-icon[data-action="delete"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            
            if (confirm('Are you sure you want to delete this post?')) {
                log('Delete clicked:', pid);
                if (typeof window.delete_post === 'function') {
                    window.delete_post(pid);
                }
            }
        });
        
        // Share
        $(document).off('click.forumModernizer', '.action-icon[data-action="share"]')
                   .on('click.forumModernizer', '.action-icon[data-action="share"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const url = window.location.href.split('#')[0] + `#entry${pid}`;
            
            navigator.clipboard.writeText(url).then(() => {
                const $btn = $(this);
                const originalHtml = $btn.html();
                $btn.html('<i class="fas fa-check"></i>');
                setTimeout(() => $btn.html(originalHtml), 2000);
                log('Share copied:', url);
            }).catch(err => error('Copy failed:', err));
        });
        
        // Report
        $(document).off('click.forumModernizer', '.action-icon[data-action="report"]')
                   .on('click.forumModernizer', '.action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Report clicked:', pid);
            
            // Try multiple ways to find the report button
            let reportBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            
            if (!reportBtn.length && window._originalPostsHtml) {
                const temp = $('<div>').html(window._originalPostsHtml);
                reportBtn = temp.find(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            }
            
            if (!reportBtn.length) {
                reportBtn = $(`.report_button[data-pid="${pid}"]`);
            }
            
            if (reportBtn.length) {
                reportBtn.click();
            } else {
                error('Report button not found');
            }
        });
        
        // Like
        $(document).off('click.forumModernizer', '.reaction-btn[data-action="like"]')
                   .on('click.forumModernizer', '.reaction-btn[data-action="like"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('Like clicked:', pid);
            
            let originalPost = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            if (!originalPost.length && window._originalPostsHtml) {
                const temp = $('<div>').html(window._originalPostsHtml);
                originalPost = temp.find(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            }
            
            const likeBtn = originalPost.find('.points_up, .points a').first();
            if (likeBtn.length) {
                const onclickAttr = likeBtn.attr('onclick');
                if (onclickAttr) {
                    eval(onclickAttr);
                } else {
                    likeBtn.click();
                }
            }
        });
        
        // Custom reaction
        $(document).off('click.forumModernizer', '.reaction-btn[data-action="react"]')
                   .on('click.forumModernizer', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            log('React clicked:', pid);
            // Fallback to like
            $(this).siblings('.reaction-btn[data-action="like"]').click();
        });
    }
    
    // ============================================================================
    // CREATE UI BUTTONS
    // ============================================================================
    
    function createViewButtons() {
        // Check if buttons already exist
        if ($('#modern-view-btn').length > 0) {
            log('Buttons already exist');
            return;
        }
        
        log('Creating view toggle buttons');
        
        // Find where to insert buttons
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        let $target = $container;
        
        if (!$container.length) {
            $target = $('.post').first().parent();
        }
        
        if (!$target.length) {
            error('Could not find target for buttons');
            return;
        }
        
        // Create button HTML
        const buttonHtml = `
            <div id="forum-view-controls" style="margin-bottom: 20px; padding: 10px; background: #f8f9fa; border-radius: 8px; display: flex; gap: 10px; align-items: center;">
                <span style="font-weight: 500; color: #333;">View Mode:</span>
                <button id="modern-view-btn" style="padding: 6px 16px; border-radius: 6px; border: 1px solid #e5e7eb; background: white; cursor: pointer; font-size: 14px;">
                    <i class="fas fa-magic"></i> Modern View
                </button>
                <button id="classic-view-btn" style="padding: 6px 16px; border-radius: 6px; border: 1px solid #e5e7eb; background: white; cursor: pointer; font-size: 14px;">
                    <i class="fas fa-history"></i> Classic View
                </button>
                <span id="view-status" style="font-size: 12px; color: #666;"></span>
            </div>
        `;
        
        // Insert buttons
        $target.before(buttonHtml);
        
        // Attach click handlers with direct binding
        $('#modern-view-btn').on('click', function(e) {
            e.preventDefault();
            log('Modern view button clicked directly');
            switchToModernView();
        });
        
        $('#classic-view-btn').on('click', function(e) {
            e.preventDefault();
            log('Classic view button clicked directly');
            switchToClassicView();
        });
        
        log('Buttons created and handlers attached');
    }
    
    // ============================================================================
    // CSS STYLES
    // ============================================================================
    
    function injectStyles() {
        if ($('#forum-modernizer-styles').length) return;
        
        const styles = `
            <style id="forum-modernizer-styles">
                .post-card {
                    background: white;
                    border-radius: 12px;
                    margin-bottom: 1.5rem;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    overflow: hidden;
                    transition: all 0.2s;
                }
                .post-header-modern {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 1rem 1.5rem;
                    background: #f9fafb;
                    border-bottom: 1px solid #e5e7eb;
                }
                .post-meta-left {
                    display: flex;
                    gap: 1rem;
                    align-items: center;
                }
                .post-number-badge {
                    background: #e5e7eb;
                    padding: 0.25rem 0.75rem;
                    border-radius: 20px;
                    font-size: 0.875rem;
                }
                .post-timestamp {
                    font-size: 0.875rem;
                    color: #6b7280;
                }
                .action-buttons-group {
                    display: flex;
                    gap: 0.5rem;
                }
                .action-icon {
                    background: transparent;
                    border: none;
                    padding: 0.5rem;
                    cursor: pointer;
                    border-radius: 6px;
                    color: #6b7280;
                    transition: all 0.2s;
                }
                .action-icon:hover {
                    background: #e5e7eb;
                }
                .delete-action:hover {
                    background: #fee2e2;
                    color: #dc2626;
                }
                .report-action:hover {
                    background: #fed7aa;
                    color: #ea580c;
                }
                .user-area {
                    display: flex;
                    gap: 1rem;
                    padding: 1.5rem;
                }
                .avatar-circle {
                    border-radius: 50%;
                    width: 70px;
                    height: 70px;
                    object-fit: cover;
                }
                .user-details {
                    flex: 1;
                }
                .username {
                    font-weight: 600;
                    font-size: 1.125rem;
                }
                .role-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.375rem;
                    padding: 0.25rem 0.75rem;
                    border-radius: 20px;
                    font-size: 0.75rem;
                }
                .role-badge.admin {
                    background: #fef3c7;
                    color: #d97706;
                }
                .user-stats-grid {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.75rem;
                    margin-top: 0.5rem;
                }
                .stat-pill {
                    font-size: 0.75rem;
                    color: #6b7280;
                }
                .post-body {
                    padding: 0 1.5rem 1.5rem;
                }
                .post-text-content {
                    line-height: 1.6;
                }
                .edit-indicator {
                    margin-top: 1rem;
                    font-size: 0.75rem;
                    color: #9ca3af;
                }
                .signature-modern {
                    margin-top: 1rem;
                    padding-top: 1rem;
                    border-top: 1px solid #e5e7eb;
                    font-size: 0.875rem;
                    color: #6b7280;
                }
                .post-footer-modern {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.75rem 1.5rem;
                    background: #f9fafb;
                    border-top: 1px solid #e5e7eb;
                }
                .reaction-cluster {
                    display: flex;
                    gap: 0.5rem;
                }
                .reaction-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.375rem;
                    background: white;
                    border: 1px solid #e5e7eb;
                    padding: 0.375rem 0.75rem;
                    border-radius: 20px;
                    cursor: pointer;
                }
                .reaction-btn:hover {
                    background: #f3f4f6;
                }
                .ip-info {
                    font-size: 0.75rem;
                    color: #9ca3af;
                    font-family: monospace;
                }
                #modern-view-btn.active, #classic-view-btn.active {
                    background: #2563eb !important;
                    color: white !important;
                    border-color: #2563eb !important;
                }
            </style>
        `;
        
        $('head').append(styles);
        log('Styles injected');
    }
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    function initialize() {
        log('========================================');
        log('Forum Modernizer initializing...');
        log('========================================');
        
        // Inject CSS
        injectStyles();
        
        // Create container if needed
        if ($(`#${CONFIG.CONTAINER_ID}`).length === 0) {
            const $firstPost = $('.post').first();
            if ($firstPost.length) {
                $firstPost.parent().wrapInner(`<div id="${CONFIG.CONTAINER_ID}"></div>`);
                log(`Created container: #${CONFIG.CONTAINER_ID}`);
            } else {
                error('No posts found on page!');
                return;
            }
        }
        
        // Create view buttons
        createViewButtons();
        
        // Attach event handlers (for when modern view is active)
        attachEventHandlers();
        
        // Check for saved preference
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        log(`Saved preference: ${savedView}`);
        
        if (savedView === 'modern') {
            log('Restoring modern view from preference');
            setTimeout(function() {
                switchToModernView();
            }, 500);
        }
        
        state.initialized = true;
        log('Initialization complete!');
        log('Click "Modern View" button to transform posts');
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
