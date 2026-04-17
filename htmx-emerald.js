// Forum Modernizer - Fixed view switching without server endpoints
(function () {
    'use strict';

    const CONFIG = {
        STORAGE_KEY: 'forumModernView',
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container',
        REACTION_DELAY: 500
    };

    // ============================================================================
    // DATA EXTRACTION
    // ============================================================================
    function extractPostData($post) {
        const fullId = $post.attr('id');
        if (!fullId) return null;

        const postId = fullId.replace(CONFIG.POST_ID_PREFIX, '');

        const username = $post.find('.nick a').first().text().trim() || 'Unknown';
        let avatarUrl = $post.find('.avatar img').attr('src');
        if (avatarUrl && avatarUrl.includes('weserv.nl')) {
            const urlParams = new URLSearchParams(avatarUrl.split('?')[1]);
            avatarUrl = urlParams.get('url') || avatarUrl;
        }

        const groupText = $post.find('.u_group dd').text().trim();
        const isAdmin = groupText === 'Administrator';
        const roleBadgeClass = isAdmin ? 'admin' : 'member';

        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        let reputation = $post.find('.u_reputation dd a').text().trim().replace('+', '');

        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');

        // Rank parsing
        let userTitle = 'Member';
        let rankIconClass = 'fa-medal fa-regular';

        const $uRank = $post.find('.u_rank').first();
        if ($uRank.length) {
            const rankText = $uRank.find('span').last().text().trim();
            if (rankText) userTitle = rankText;

            const $icon = $uRank.find('i').last();
            if ($icon.length) {
                const classAttr = $icon.attr('class') || '';
                const match = classAttr.match(/fa-(regular|solid|light|brands)?\s*fa-([a-z0-9-]+)/i);
                if (match) {
                    const style = match[1] ? `fa-${match[1]}` : 'fa-regular';
                    rankIconClass = `${style} fa-${match[2]}`;
                }
            }
        }

        // Clean post content - remove bottomborder and extra <br> tags around it
        const contentClone = $post.find('.right.Item table.color').clone();
        contentClone.find('.signature, .edit').remove();

        // Remove the bottomborder div and surrounding <br> tags
        contentClone.find('.bottomborder').remove();
        contentClone.find('br').each(function() {
            const $br = $(this);
            if ($br.prev().is('br') || $br.next().is('.bottomborder') || $br.prev().is('.bottomborder')) {
                $br.remove();
            }
        });

        const contentHtml = contentClone.html() || '';

        const signatureHtml = $post.find('.signature').html() || '';
        const editInfo = $post.find('.edit').text().trim();

        let likes = 0;
        const pointsPos = $post.find('.points .points_pos');
        if (pointsPos.length) likes = parseInt(pointsPos.text()) || 0;

        let hasReactions = false;
        let reactionCount = 0;
        $post.find('.st-emoji-post .st-emoji-counter').each(function () {
            hasReactions = true;
            reactionCount += parseInt($(this).data('count') || $(this).text() || 1);
        });
        if (!hasReactions && $post.find('.st-emoji-container').length) hasReactions = true;

        let ipAddress = $post.find('.ip_address dd a').text().trim();
        if (ipAddress) {
            const parts = ipAddress.split('.');
            if (parts.length === 4) ipAddress = `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
        }

        const postNumber = $post.index() + 1;

        let timeAgo = 'Recently';
        const whenTitle = $post.find('.when').attr('title');
        if (whenTitle) {
            const diffDays = Math.floor((Date.now() - new Date(whenTitle)) / 86400000);
            timeAgo = diffDays >= 1 ? `${diffDays} day${diffDays > 1 ? 's' : ''} ago` : 'Just now';
        }

        return {
            postId, username, avatarUrl, groupText, roleBadgeClass,
            postCount, reputation, isOnline, userTitle, rankIconClass,
            contentHtml, signatureHtml, editInfo, likes, hasReactions, reactionCount,
            ipAddress, postNumber, timeAgo
        };
    }

    // ============================================================================
    // GENERATE MODERN CARD
    // ============================================================================
    function generateModernPost(data) {
        if (!data) return '';

        const statusColor = data.isOnline ? '#10B981' : '#6B7280';

        return `
            <div class="post-card" data-post-id="${data.postId}" data-original-id="${CONFIG.POST_ID_PREFIX}${data.postId}">
                <div class="post-header-modern">
                    <div class="post-meta-left">
                        <div class="post-number-badge"><i class="fas fa-hashtag"></i> ${data.postNumber}</div>
                        <div class="post-timestamp"><time>${data.timeAgo}</time></div>
                    </div>
                    <div class="action-buttons-group">
                        <button class="action-icon" title="Quote" data-pid="${data.postId}">
                            <i class="fa-regular fa-quote-left"></i>
                        </button>
                        <button class="action-icon" title="Edit" data-pid="${data.postId}">
                            <i class="fa-regular fa-pen-to-square"></i>
                        </button>
                        <button class="action-icon" title="Share" data-pid="${data.postId}">
                            <i class="fa-regular fa-share-nodes"></i>
                        </button>
                        <button class="action-icon report-action" title="Report" data-pid="${data.postId}">
                            <i class="fa-regular fa-circle-exclamation"></i>
                        </button>
                        <button class="action-icon delete-action" title="Delete" data-pid="${data.postId}">
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
                        <div class="username-row"><span class="username">${escapeHtml(data.username)}</span></div>
                        <div class="badge-container">
                            <span class="role-badge ${data.roleBadgeClass}">
                                ${escapeHtml(data.groupText || 'Member')}
                            </span>
                        </div>
                        <div class="user-stats-grid">
                            <span class="stat-pill">
                                <i class="${data.rankIconClass}"></i> ${data.userTitle}
                            </span>
                            <span class="stat-pill">
                                <i class="fa-regular fa-comments"></i> ${data.postCount} posts
                            </span>
                            <span class="stat-pill">
                                <i class="fa-regular fa-thumbs-up"></i> ${data.reputation > 0 ? '+' : ''}${data.reputation} rep
                            </span>
                            <span class="stat-pill">
                                <i class="fa-regular fa-circle" style="color: ${statusColor}"></i> 
                                ${data.isOnline ? 'Online' : 'Offline'}
                            </span>
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
                        <button class="reaction-btn ${data.hasReactions ? 'reaction-placeholder' : ''}" data-action="react" data-pid="${data.postId}">
                            ${data.hasReactions ?
                                `<img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" width="16" height="16" alt="laugh">` :
                                `<i class="fa-regular fa-face-smile"></i>`}
                            ${data.reactionCount > 0 ? `<span class="reaction-count">${data.reactionCount}</span>` : ''}
                        </button>
                    </div>
                    ${data.ipAddress ? `<div class="ip-info"><i class="fa-regular fa-globe"></i> IP: ${data.ipAddress}</div>` : ''}
                </div>
            </div>
        `;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================
    
    // Use event delegation for all modern card buttons
    function attachGlobalHandlers() {
        // Quote
        $(document).on('click', '.action-icon[title="Quote"], .action-icon[data-action="quote"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const link = $(`#${CONFIG.POST_ID_PREFIX}${pid} a[href*="CODE=02"]`);
            if (link.length) window.location.href = link.attr('href');
        });
        
        // Edit
        $(document).on('click', '.action-icon[title="Edit"], .action-icon[data-action="edit"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const link = $(`#${CONFIG.POST_ID_PREFIX}${pid} a[href*="CODE=08"]`);
            if (link.length) window.location.href = link.attr('href');
        });
        
        // Delete
        $(document).on('click', '.action-icon[title="Delete"], .action-icon[data-action="delete"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            if (confirm('Are you sure you want to delete this post?')) {
                if (typeof window.delete_post === 'function') {
                    window.delete_post(pid);
                }
            }
        });
        
        // Share
        $(document).on('click', '.action-icon[title="Share"], .action-icon[data-action="share"]', function(e) {
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
        
        // Report
        $(document).on('click', '.action-icon[title="Report"], .action-icon[data-action="report"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            let reportBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            if (!reportBtn.length) reportBtn = $(`.report_button[data-pid="${pid}"]`);
            if (reportBtn.length) reportBtn[0].click();
        });
        
        // Like
        $(document).on('click', '.reaction-btn[data-action="like"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const likeBtn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .points .points_up`);
            if (likeBtn.length) {
                const onclickAttr = likeBtn.attr('onclick');
                if (onclickAttr) eval(onclickAttr);
                else likeBtn.click();
            }
            setTimeout(() => refreshReactionDisplay(pid), CONFIG.REACTION_DELAY);
        });
        
        // React
        $(document).on('click', '.reaction-btn[data-action="react"]', function(e) {
            e.preventDefault();
            const pid = $(this).data('pid');
            const emojiContainer = $(`#${CONFIG.POST_ID_PREFIX}${pid} .st-emoji-container`);
            if (emojiContainer.length) {
                emojiContainer.click();
            } else {
                $(this).siblings('.reaction-btn[data-action="like"]').click();
            }
            setTimeout(() => refreshReactionDisplay(pid), CONFIG.REACTION_DELAY);
        });
    }

    function refreshReactionDisplay(postId) {
        const $post = $(`#${CONFIG.POST_ID_PREFIX}${postId}`);
        if (!$post.length) return;
        
        const countEl = $post.find('.st-emoji-post .st-emoji-counter').first();
        if (countEl.length) {
            const count = countEl.data('count') || parseInt(countEl.text()) || 0;
            const $modernBtn = $(`.post-card[data-original-id="${CONFIG.POST_ID_PREFIX}${postId}"] .reaction-btn[data-action="react"]`);
            if ($modernBtn.length) {
                let $span = $modernBtn.find('.reaction-count');
                if (!$span.length && count > 0) {
                    $modernBtn.append(`<span class="reaction-count">${count}</span>`);
                } else if ($span.length && count > 0) {
                    $span.text(count);
                }
            }
        }
    }

    // ============================================================================
    // VIEW SWITCHING - No server calls!
    // ============================================================================
    
    function switchToModernView() {
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        
        // Ensure all posts have modern cards
        $container.find(CONFIG.POST_SELECTOR).each(function() {
            const $post = $(this);
            const postId = $post.attr('id');
            if (!postId) return;
            
            if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
                const data = extractPostData($post);
                if (data) {
                    const modernCard = generateModernPost(data);
                    $post.after(modernCard);
                    if (typeof htmx !== 'undefined') {
                        htmx.process($(modernCard)[0]);
                    }
                }
            }
        });
        
        // Add class to show modern, hide original
        $container.addClass('view-modern');
        localStorage.setItem(CONFIG.STORAGE_KEY, 'modern');
        
        // Update button states
        $('#modern-view-btn').addClass('active');
        $('#classic-view-btn').removeClass('active');
    }
    
    function switchToClassicView() {
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        $container.removeClass('view-modern');
        localStorage.setItem(CONFIG.STORAGE_KEY, 'classic');
        
        $('#classic-view-btn').addClass('active');
        $('#modern-view-btn').removeClass('active');
    }

    // ============================================================================
    // CREATE VIEW BUTTONS (if not already in HTML)
    // ============================================================================
    
    function createViewButtonsIfNeeded() {
        if ($('#modern-view-btn').length > 0) return;
        
        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) return;
        
        const buttonHtml = `
            <div id="forum-view-controls" style="margin: 20px 0; display: flex; gap: 12px; flex-wrap: wrap;">
                <button id="modern-view-btn" class="view-toggle-btn">
                    <i class="fas fa-magic"></i> Modern View
                </button>
                <button id="classic-view-btn" class="view-toggle-btn active">
                    <i class="fas fa-history"></i> Classic View
                </button>
            </div>
        `;
        
        $container.before(buttonHtml);
        
        // Add button styles
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
                    transition: all 0.2s;
                }
                .view-toggle-btn.active {
                    background: #2563eb !important;
                    color: white !important;
                    border-color: #2563eb !important;
                }
                .view-toggle-btn:hover:not(.active) {
                    background: #f3f4f6 !important;
                }
            `)
            .appendTo('head');
        
        $('#modern-view-btn').on('click', switchToModernView);
        $('#classic-view-btn').on('click', switchToClassicView);
    }

    // ============================================================================
    // CONVERT POSTS AND INITIALIZE
    // ============================================================================
    
    function convertToModern(postEl) {
        const $post = $(postEl);
        const postId = $post.attr('id');
        if (!postId) return;
        
        if ($(`.post-card[data-original-id="${postId}"]`).length === 0) {
            const data = extractPostData($post);
            if (data) {
                const modernHTML = generateModernPost(data);
                $post.after(modernHTML);
                if (typeof htmx !== 'undefined') {
                    const $newCard = $(modernHTML);
                    htmx.process($newCard[0]);
                }
            }
        }
    }
    
    function initialize() {
        console.log('[ForumModernizer] Initializing...');
        
        // Ensure container exists
        let container = document.getElementById(CONFIG.CONTAINER_ID);
        if (!container) {
            const firstPost = document.querySelector(CONFIG.POST_SELECTOR);
            if (firstPost && firstPost.parentElement) {
                firstPost.parentElement.id = CONFIG.CONTAINER_ID;
                container = firstPost.parentElement;
                console.log('[ForumModernizer] Created container');
            }
        }
        
        if (!container) {
            console.error('[ForumModernizer] No container found');
            return;
        }
        
        // Create view buttons if needed
        createViewButtonsIfNeeded();
        
        // Convert all existing posts
        document.querySelectorAll(CONFIG.POST_SELECTOR).forEach(convertToModern);
        
        // Attach global event handlers
        attachGlobalHandlers();
        
        // Setup htmx handlers for dynamic content
        if (typeof htmx !== 'undefined') {
            htmx.onLoad(function(target) {
                $(target).find(CONFIG.POST_SELECTOR).each(function() {
                    convertToModern(this);
                });
            });
        }
        
        // Restore saved view preference
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (savedView === 'modern') {
            $(container).addClass('view-modern');
            $('#modern-view-btn').addClass('active');
            $('#classic-view-btn').removeClass('active');
        } else {
            $(container).removeClass('view-modern');
            $('#classic-view-btn').addClass('active');
            $('#modern-view-btn').removeClass('active');
        }
        
        console.log('[ForumModernizer] Ready!');
    }
    
    // Start
    if (document.readyState === 'loading') {
        $(document).ready(initialize);
    } else {
        initialize();
    }
    
})();
