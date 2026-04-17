/**
 * Forum Modernizer - Pure htmx Server-Side Rendering
 * No client-side post conversion - server sends modern cards directly
 * Only handles event delegation for modern card buttons
 */

(function() {
    'use strict';

    const CONFIG = {
        STORAGE_KEY: 'forumModernView',
        POST_ID_PREFIX: 'ee',
        REACTION_DELAY: 500
    };

    // ============================================================================
    // EVENT HANDLERS - Delegated for modern cards
    // ============================================================================
    
    function attachEventHandlers() {
        console.log('[ForumModernizer] Attaching event handlers');
        
        // QUOTE
        $(document).off('click.forumModernizer', '.action-icon[title="Quote"], .action-icon[data-action="quote"]')
                   .on('click.forumModernizer', '.action-icon[title="Quote"], .action-icon[data-action="quote"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const link = $(`#${CONFIG.POST_ID_PREFIX}${pid} a[href*="CODE=02"]`);
            if (link.length) {
                window.location.href = link.attr('href');
            }
        });
        
        // EDIT
        $(document).off('click.forumModernizer', '.action-icon[title="Edit"], .action-icon[data-action="edit"]')
                   .on('click.forumModernizer', '.action-icon[title="Edit"], .action-icon[data-action="edit"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const link = $(`#${CONFIG.POST_ID_PREFIX}${pid} a[href*="CODE=08"]`);
            if (link.length) {
                window.location.href = link.attr('href');
            }
        });
        
        // DELETE
        $(document).off('click.forumModernizer', '.action-icon[title="Delete"], .action-icon[data-action="delete"]')
                   .on('click.forumModernizer', '.action-icon[title="Delete"], .action-icon[data-action="delete"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            if (confirm('Are you sure you want to delete this post?')) {
                if (typeof window.delete_post === 'function') {
                    window.delete_post(pid);
                }
            }
        });
        
        // SHARE
        $(document).off('click.forumModernizer', '.action-icon[title="Share"], .action-icon[data-action="share"]')
                   .on('click.forumModernizer', '.action-icon[title="Share"], .action-icon[data-action="share"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const url = window.location.href.split('#')[0] + `#entry${pid}`;
            navigator.clipboard.writeText(url).then(() => {
                const $btn = $(this);
                const original = $btn.html();
                $btn.html('<i class="fas fa-check"></i>');
                setTimeout(() => $btn.html(original), 1500);
            });
        });
        
        // REPORT
        $(document).off('click.forumModernizer', '.action-icon[title="Report"], .action-icon[data-action="report"]')
                   .on('click.forumModernizer', '.action-icon[title="Report"], .action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            let reportBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            if (!reportBtn.length) {
                reportBtn = $(`.report_button[data-pid="${pid}"]`);
            }
            if (reportBtn.length) {
                reportBtn[0].click();
            }
        });
        
        // LIKE
        $(document).off('click.forumModernizer', '.reaction-btn[data-action="like"]')
                   .on('click.forumModernizer', '.reaction-btn[data-action="like"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const likeBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .points .points_up`);
            if (likeBtn.length) {
                const onclickAttr = likeBtn.attr('onclick');
                if (onclickAttr) {
                    eval(onclickAttr);
                } else {
                    likeBtn.click();
                }
            }
            // Refresh reaction display after a moment
            setTimeout(() => refreshReactionDisplay(pid), CONFIG.REACTION_DELAY);
        });
        
        // REACT (emoji reactions)
        $(document).off('click.forumModernizer', '.reaction-btn[data-action="react"]')
                   .on('click.forumModernizer', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const emojiContainer = $(`#${CONFIG.POST_ID_PREFIX}${pid} .st-emoji-container`);
            if (emojiContainer.length) {
                emojiContainer.click();
            } else {
                // Fallback to like if no emoji container
                $(this).siblings('.reaction-btn[data-action="like"]').click();
            }
            setTimeout(() => refreshReactionDisplay(pid), CONFIG.REACTION_DELAY);
        });
    }
    
    // ============================================================================
    // REACTION DISPLAY REFRESH - Updates counts in modern cards
    // ============================================================================
    
    function refreshReactionDisplay(postId) {
        const $originalPost = $(`#${CONFIG.POST_ID_PREFIX}${postId}`);
        if (!$originalPost.length) return;
        
        // Get reaction count from original post
        const countEl = $originalPost.find('.st-emoji-post .st-emoji-counter').first();
        if (countEl.length) {
            const count = countEl.data('count') || parseInt(countEl.text()) || 0;
            
            // Update modern card reaction button
            const $modernReactBtn = $(`.post-card[data-original-id="${CONFIG.POST_ID_PREFIX}${postId}"] .reaction-btn[data-action="react"]`);
            if ($modernReactBtn.length && count > 0) {
                let $countSpan = $modernReactBtn.find('.reaction-count');
                if (!$countSpan.length) {
                    $modernReactBtn.append(`<span class="reaction-count">${count}</span>`);
                } else {
                    $countSpan.text(count);
                }
            }
        }
        
        // Update like count
        const likesEl = $originalPost.find('.points .points_pos');
        if (likesEl.length) {
            const likes = parseInt(likesEl.text()) || 0;
            const $modernLikeBtn = $(`.post-card[data-original-id="${CONFIG.POST_ID_PREFIX}${postId}"] .reaction-btn[data-action="like"]`);
            if ($modernLikeBtn.length && likes > 0) {
                let $countSpan = $modernLikeBtn.find('.reaction-count');
                if (!$countSpan.length) {
                    $modernLikeBtn.append(`<span class="reaction-count">${likes}</span>`);
                } else {
                    $countSpan.text(likes);
                }
            }
        }
    }
    
    // ============================================================================
    // HTMX EVENT HANDLERS
    // ============================================================================
    
    function setupHtmxHandlers() {
        if (typeof htmx === 'undefined') {
            console.log('[ForumModernizer] htmx not available');
            return;
        }
        
        console.log('[ForumModernizer] Setting up htmx handlers');
        
        // After htmx swaps new content, re-attach event handlers
        document.addEventListener('htmx:afterSwap', function(event) {
            console.log('[ForumModernizer] htmx:afterSwap', event.detail.target.id);
            
            // Re-attach handlers to the new content
            attachEventHandlers();
            
            // If we're in modern view, ensure the container has the class
            if (localStorage.getItem(CONFIG.STORAGE_KEY) === 'modern') {
                const container = document.getElementById('posts-container');
                if (container && !container.classList.contains('view-modern')) {
                    container.classList.add('view-modern');
                }
            }
        });
        
        // Process new content after load
        htmx.onLoad(function(target) {
            console.log('[ForumModernizer] htmx.onLoad');
            attachEventHandlers();
        });
        
        // Handle response errors
        document.addEventListener('htmx:responseError', function(event) {
            console.error('[ForumModernizer] Response error:', event.detail.xhr.status);
        });
    }
    
    // ============================================================================
    // VIEW STATE MANAGEMENT
    // ============================================================================
    
    function saveViewPreference(view) {
        localStorage.setItem(CONFIG.STORAGE_KEY, view);
        console.log('[ForumModernizer] Saved preference:', view);
    }
    
    function restoreViewPreference() {
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        const container = document.getElementById('posts-container');
        
        if (!container) return;
        
        if (savedView === 'modern') {
            container.classList.add('view-modern');
            console.log('[ForumModernizer] Restored modern view');
        } else {
            container.classList.remove('view-modern');
            console.log('[ForumModernizer] Restored classic view');
        }
    }
    
    // ============================================================================
    // CREATE VIEW BUTTONS (if not in HTML)
    // ============================================================================
    
    function createViewButtonsIfNeeded() {
        // Check if buttons already exist
        if ($('#modern-view-btn').length > 0) {
            console.log('[ForumModernizer] Buttons already exist');
            return;
        }
        
        const container = document.getElementById('posts-container');
        if (!container) {
            console.log('[ForumModernizer] No container found');
            return;
        }
        
        console.log('[ForumModernizer] Creating view buttons');
        
        const buttonHtml = `
            <div id="forum-view-controls" style="margin: 20px 0; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
                <button id="modern-view-btn" 
                        class="view-toggle-btn"
                        hx-get="/forum/posts?view=modern"
                        hx-target="#posts-container"
                        hx-swap="innerHTML"
                        hx-push-url="true"
                        hx-on::after-request="localStorage.setItem('${CONFIG.STORAGE_KEY}', 'modern'); document.getElementById('posts-container').classList.add('view-modern')">
                    <i class="fas fa-magic"></i> Modern View
                </button>
                
                <button id="classic-view-btn" 
                        class="view-toggle-btn active"
                        hx-get="/forum/posts?view=classic"
                        hx-target="#posts-container"
                        hx-swap="innerHTML"
                        hx-push-url="true"
                        hx-on::after-request="localStorage.setItem('${CONFIG.STORAGE_KEY}', 'classic'); document.getElementById('posts-container').classList.remove('view-modern')">
                    <i class="fas fa-history"></i> Classic View
                </button>
                
                <span style="font-size: 12px; color: #666;">
                    <i class="fas fa-info-circle"></i> Switch between view modes
                </span>
            </div>
        `;
        
        $(container).before(buttonHtml);
        
        // Add styles for buttons
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
                    opacity: 0.6;
                    transition: opacity 0.2s;
                }
            `)
            .appendTo('head');
    }
    
    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    function initialize() {
        console.log('========================================');
        console.log('[ForumModernizer] Pure htmx Server-Side Mode');
        console.log('========================================');
        
        // Ensure container exists
        if ($('#posts-container').length === 0) {
            const $firstPost = $('.post').first();
            if ($firstPost.length && $firstPost.parent()) {
                $firstPost.parent().attr('id', 'posts-container');
                console.log('[ForumModernizer] Created posts-container');
            }
        }
        
        // Create view buttons if needed
        createViewButtonsIfNeeded();
        
        // Attach event handlers
        attachEventHandlers();
        
        // Setup htmx handlers
        setupHtmxHandlers();
        
        // Restore view preference
        restoreViewPreference();
        
        console.log('[ForumModernizer] Ready!');
        console.log('[ForumModernizer] View buttons will fetch from server');
        console.log('[ForumModernizer] No client-side post conversion');
    }
    
    // Start
    if (document.readyState === 'loading') {
        $(document).ready(initialize);
    } else {
        initialize();
    }
    
})();
