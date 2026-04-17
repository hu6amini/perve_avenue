
/**
 * Forum Modernizer - htmx Optimized Version
 * Fully declarative with hx-on, CSS view switching, and minimal JS
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
        MAX_RETRIES: 5,
        RETRY_DELAY: 300,
    };

    // ============================================================================
    // STATE
    // ============================================================================
    const state = {
        isModernView: false,
        processedPosts: new Set(),
        pendingReactions: new Map(),
        retryCounters: new Map(),
        initialized: false,
    };

    // ============================================================================
    // LOGGING
    // ============================================================================
    function log(...args) {
        if (console?.log) console.log('[ForumModernizer]', ...args);
    }

    function error(...args) {
        if (console?.error) console.error('[ForumModernizer]', ...args);
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
    // DATA EXTRACTION (unchanged)
    // ============================================================================
    function extractPostData($post) {
        // ... (your original extractPostData function - unchanged for brevity)
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
        const roleIcon = isAdmin ? 'fa-crown' : 'fa-user';

        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        let reputation = $post.find('.u_reputation dd a').text().trim().replace('+', '');

        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');

        let userTitle = $post.find('.u_title').text().trim();
        if (userTitle === 'Member') {
            const stars = $post.find('.u_rank i.fa-star').length;
            if (stars === 3) userTitle = 'Famous';
            else if (stars === 2) userTitle = 'Senior';
            else if (stars === 1) userTitle = 'Junior';
        }

        const postContent = $post.find('.right.Item table.color').clone();
        postContent.find('.signature, .edit').remove();
        const contentHtml = postContent.html() || '';

        const signatureHtml = $post.find('.signature').html() || '';
        const editInfo = $post.find('.edit').text().trim();

        let likes = 0;
        const pointsPos = $post.find('.points .points_pos');
        if (pointsPos.length) likes = parseInt(pointsPos.text()) || 0;

        let hasReactions = false;
        let reactionCount = 0;
        $post.find('.st-emoji-post .st-emoji-counter').each(function() {
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

        let timeAgo = '';
        const whenSpan = $post.find('.when');
        const title = whenSpan.attr('title') || '';
        if (title) {
            const postDate = new Date(title);
            const now = new Date();
            const diffDays = Math.floor((now - postDate) / (1000 * 60 * 60 * 24));
            if (diffDays >= 1) timeAgo = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            else {
                const diffHours = Math.floor((now - postDate) / (1000 * 60 * 60));
                timeAgo = diffHours >= 1 ? `${diffHours} hour${diffHours > 1 ? 's' : ''} ago` : 'Just now';
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
    // MODERN POST GENERATION (now with hx-on attributes!)
    // ============================================================================
    function generateModernPost(data) {
        if (!data) return '';

        const titleIcon = data.userTitle === 'Famous' ? 'fa-fire' : 
                         (data.userTitle === 'Senior' ? 'fa-star' : 'fa-medal');
        const statusColor = data.isOnline ? '#10B981' : '#6B7280';

        const likeButton = `
            <button class="reaction-btn" data-pid="${data.postId}" 
                    hx-on:click="forumModernizer.handleLike(this)">
                <i class="fa-regular fa-thumbs-up"></i>
                ${data.likes > 0 ? `<span class="reaction-count">${data.likes}</span>` : ''}
            </button>
        `;

        const reactButton = data.hasReactions ? `
            <button class="reaction-btn reaction-placeholder" data-pid="${data.postId}" 
                    hx-on:click="forumModernizer.handleReact(this)">
                <img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" class="reaction-emoji-img" width="16" height="16" alt="laugh">
                <span class="reaction-count">${data.reactionCount > 0 ? data.reactionCount : '...'}</span>
            </button>
        ` : `
            <button class="reaction-btn" data-pid="${data.postId}" 
                    hx-on:click="forumModernizer.handleReact(this)">
                <i class="fa-regular fa-face-smile"></i>
            </button>
        `;

        return `
            <div class="post-card" data-post-id="${data.postId}" data-original-id="${CONFIG.POST_ID_PREFIX}${data.postId}">
                <div class="post-header-modern">
                    <div class="post-meta-left">
                        <div class="post-number-badge"><i class="fas fa-hashtag"></i> ${data.postNumber}</div>
                        <div class="post-timestamp"><time>${data.timeAgo || 'Recently'}</time></div>
                    </div>
                    <div class="action-buttons-group">
                        <button class="action-icon" title="Quote" data-pid="${data.postId}" 
                                hx-on:click="forumModernizer.handleQuote(this)">
                            <i class="fa-regular fa-quote-left"></i>
                        </button>
                        <button class="action-icon" title="Edit" data-pid="${data.postId}" 
                                hx-on:click="forumModernizer.handleEdit(this)">
                            <i class="fa-regular fa-pen-to-square"></i>
                        </button>
                        <button class="action-icon" title="Share" data-pid="${data.postId}" 
                                hx-on:click="forumModernizer.handleShare(this)">
                            <i class="fa-regular fa-share-nodes"></i>
                        </button>
                        <button class="action-icon report-action" title="Report" data-pid="${data.postId}" 
                                hx-on:click="forumModernizer.handleReport(this)">
                            <i class="fa-regular fa-circle-exclamation"></i>
                        </button>
                        <button class="action-icon delete-action" title="Delete" data-pid="${data.postId}" 
                                hx-on:click="forumModernizer.handleDelete(this)">
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
    // REACTION UPDATE (unchanged logic)
    // ============================================================================
    function updateReactionData($post, postId) {
        const $reactionCounter = $post.find('.st-emoji-post .st-emoji-counter');
        if ($reactionCounter.length && $reactionCounter.data('count')) {
            const count = $reactionCounter.data('count');
            const $modernCard = $(`.post-card[data-original-id="${CONFIG.POST_ID_PREFIX}${postId}"]`);
            if ($modernCard.length) {
                const $reactionBtn = $modernCard.find('.reaction-btn[data-pid="' + postId + '"]');
                if ($reactionBtn.length) {
                    let $countSpan = $reactionBtn.find('.reaction-count');
                    if ($countSpan.length) $countSpan.text(count);
                    else $reactionBtn.append(`<span class="reaction-count">${count}</span>`);
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
    // CONVERT POST (now only generates - CSS handles visibility)
    // ============================================================================
    function convertPostToModern($post) {
        const postId = $post.attr('id');
        if (!postId || state.processedPosts.has(postId)) return;

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
        // No hide/show here - CSS + .view-modern class does it all
    }

    // ============================================================================
    // HTMX HANDLERS (exposed for hx-on)
    // ============================================================================
    const handlers = {
        handleQuote(elt) {
            const pid = elt.dataset.pid;
            const $original = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $link = $original.find('a[href*="CODE=02"]');
            if ($link.length) window.location.href = $link.attr('href');
        },

        handleEdit(elt) {
            const pid = elt.dataset.pid;
            const $original = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $link = $original.find('a[href*="CODE=08"]');
            if ($link.length) window.location.href = $link.attr('href');
        },

        handleDelete(elt) {
            const pid = elt.dataset.pid;
            if (confirm('Are you sure you want to delete this post?')) {
                if (typeof window.delete_post === 'function') window.delete_post(pid);
            }
        },

        handleShare(elt) {
            const pid = elt.dataset.pid;
            const url = window.location.href.split('#')[0] + `#entry${pid}`;
            navigator.clipboard.writeText(url).then(() => {
                const original = elt.innerHTML;
                elt.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { elt.innerHTML = original; }, 1500);
            });
        },

        handleReport(elt) {
            const pid = elt.dataset.pid;
            let $btn = $(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`);
            if (!$btn.length) $btn = $(`.report_button[data-pid="${pid}"]`);
            if ($btn.length) $btn[0].click();
        },

        handleLike(elt) {
            const pid = elt.dataset.pid;
            const $original = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $like = $original.find('.points .points_up');
            if ($like.length) {
                const onclick = $like.attr('onclick');
                if (onclick) eval(onclick);
                else $like[0].click();
            }
            // Trigger reaction refresh
            const $post = $original;
            state.pendingReactions.set(pid, $post);
            setTimeout(() => updateReactionData($post, pid), CONFIG.REACTION_WAIT_DELAY);
        },

        handleReact(elt) {
            const pid = elt.dataset.pid;
            const $original = $(`#${CONFIG.POST_ID_PREFIX}${pid}`);
            const $emoji = $original.find('.st-emoji-post .st-emoji-container');
            if ($emoji.length) $emoji[0].click();
            else this.handleLike(elt); // fallback

            const $post = $original;
            state.pendingReactions.set(pid, $post);
            setTimeout(() => updateReactionData($post, pid), CONFIG.REACTION_WAIT_DELAY);
        },

        switchToModernView() {
            const $container = $(`#${CONFIG.CONTAINER_ID}`);
            if (!$container.length) return;
            $container.addClass('view-modern');
            state.isModernView = true;
            localStorage.setItem(CONFIG.STORAGE_KEY, 'modern');
            $('#modern-view-btn').addClass('active');
            $('#classic-view-btn').removeClass('active');
            $('#view-status').html('<i class="fas fa-info-circle"></i> Modern view active');
            log('Modern view active');
        },

        switchToClassicView() {
            const $container = $(`#${CONFIG.CONTAINER_ID}`);
            if (!$container.length) return;
            $container.removeClass('view-modern');
            state.isModernView = false;
            localStorage.setItem(CONFIG.STORAGE_KEY, 'classic');
            $('#classic-view-btn').addClass('active');
            $('#modern-view-btn').removeClass('active');
            $('#view-status').html('<i class="fas fa-info-circle"></i> Classic view active');
            log('Classic view active');
        }
    };

    // Expose handlers globally so hx-on can call them
    window.forumModernizer = handlers;

    // ============================================================================
    // VIEW SWITCHING UI
    // ============================================================================
    function createUI() {
        if ($(`#${CONFIG.CONTAINER_ID}`).length === 0) {
            const $firstPost = $('.post').first();
            if ($firstPost.length) $firstPost.parent().wrapInner(`<div id="${CONFIG.CONTAINER_ID}"></div>`);
        }

        if ($('#modern-view-btn').length === 0) {
            const $container = $(`#${CONFIG.CONTAINER_ID}`);
            if (!$container.length) return;

            const buttonHtml = `
                <div id="forum-view-controls" style="margin-bottom: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 0;">
                    <button id="modern-view-btn" class="view-toggle-btn" 
                            hx-on:click="forumModernizer.switchToModernView()">
                        <i class="fas fa-magic"></i> Modern View
                    </button>
                    <button id="classic-view-btn" class="view-toggle-btn active" 
                            hx-on:click="forumModernizer.switchToClassicView()">
                        <i class="fas fa-history"></i> Classic View
                    </button>
                    <span id="view-status" style="font-size: 12px; color: #666;"></span>
                </div>
            `;
            $container.before(buttonHtml);

            // Add all required CSS (including the new view-modern rules)
            $('<style>')
                .prop('type', 'text/css')
                .html(`
                    .view-toggle-btn.active {
                        background: #2563eb !important; color: white !important; border-color: #2563eb !important;
                    }
                    .view-toggle-btn:hover:not(.active) { background: #f3f4f6 !important; }
                    #posts-container .post-card { display: none; }
                    #posts-container.view-modern .post { display: none !important; }
                    #posts-container.view-modern .post-card { display: block; }
                    .post-card { margin-bottom: 20px; }
                `)
                .appendTo('head');

            // Make sure htmx processes the new buttons
            if (typeof htmx !== 'undefined') {
                htmx.process(document.getElementById('forum-view-controls'));
            }
        }
    }

    // ============================================================================
    // RESTORE VIEW STATE (now simple & reliable)
    // ============================================================================
    function restoreViewState() {
        const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
        const $container = $(`#${CONFIG.CONTAINER_ID}`);

        if (saved === 'modern' && $container.length) {
            $container.addClass('view-modern');
            state.isModernView = true;
            $('#modern-view-btn').addClass('active');
            $('#classic-view-btn').removeClass('active');
            $('#view-status').html('<i class="fas fa-info-circle"></i> Modern view active');
        } else {
            $('#view-status').html('<i class="fas fa-info-circle"></i> Classic view active');
        }
    }

    // ============================================================================
    // HTMX SETUP
    // ============================================================================
    function setupHtmxHandlers() {
        if (typeof htmx === 'undefined') {
            log('htmx not available - running in classic mode only');
            return;
        }

        log('Setting up htmx handlers');

        htmx.onLoad(function(target) {
            $(target).find(CONFIG.POST_SELECTOR).each(function() {
                convertPostToModern($(this));
            });
            if ($(target).is(CONFIG.POST_SELECTOR)) {
                convertPostToModern($(target));
            }
        });

        // Re-apply view class if the container itself is swapped
        document.addEventListener('htmx:afterSwap', function(evt) {
            if (evt.detail.target.id === CONFIG.CONTAINER_ID) {
                const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
                if (saved === 'modern') {
                    evt.detail.target.classList.add('view-modern');
                    state.isModernView = true;
                } else {
                    evt.detail.target.classList.remove('view-modern');
                    state.isModernView = false;
                }
            }
        });
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    function initialize() {
        if (state.initialized) return;

        log('Forum Modernizer (htmx optimized) initializing...');

        createUI();

        const $container = $(`#${CONFIG.CONTAINER_ID}`);
        if (!$container.length) {
            error('Container not found');
            return;
        }

        // Convert all existing posts
        $container.find(CONFIG.POST_SELECTOR).each(function() {
            convertPostToModern($(this));
        });

        setupHtmxHandlers();
        restoreViewState();

        state.initialized = true;
        log('Initialization complete - fully htmx powered!');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        $(document).ready(initialize);
    } else {
        initialize();
    }
})();
