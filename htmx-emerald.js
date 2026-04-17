// Forum Modernizer - Full htmx Optimized (No Idiomorph)
(function() {
    'use strict';

    const CONFIG = {
        STORAGE_KEY: 'forumModernView',
        POST_SELECTOR: '.post',
        POST_ID_PREFIX: 'ee',
        CONTAINER_ID: 'posts-container',
        REACTION_WAIT_DELAY: 600
    };

    const state = {
        processedPosts: new Set()
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
    // Extract data from legacy .post (only part that still needs JS)
    // ============================================================================
    function extractPostData($post) {
        const fullId = $post.attr('id');
        if (!fullId) return null;
        const postId = fullId.replace(CONFIG.POST_ID_PREFIX, '');

        const username = $post.find('.nick a').first().text().trim() || 'Unknown';
        let avatarUrl = $post.find('.avatar img').attr('src');
        if (avatarUrl?.includes('weserv.nl')) {
            const params = new URLSearchParams(avatarUrl.split('?')[1]);
            avatarUrl = params.get('url') || avatarUrl;
        }

        const groupText = $post.find('.u_group dd').text().trim();
        const isAdmin = groupText === 'Administrator';
        const roleBadgeClass = isAdmin ? 'admin' : 'member';
        const roleIcon = isAdmin ? 'fa-crown' : 'fa-user';

        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        let reputation = $post.find('.u_reputation dd a').text().trim().replace('+', '');

        const isOnline = $post.find('.u_status').attr('title')?.toLowerCase().includes('online') || false;

        let userTitle = $post.find('.u_title').text().trim();
        if (userTitle === 'Member') {
            const stars = $post.find('.u_rank i.fa-star').length;
            userTitle = stars === 3 ? 'Famous' : stars === 2 ? 'Senior' : stars === 1 ? 'Junior' : 'Member';
        }

        const contentClone = $post.find('.right.Item table.color').clone();
        contentClone.find('.signature, .edit').remove();
        const contentHtml = contentClone.html() || '';

        const signatureHtml = $post.find('.signature').html() || '';
        const editInfo = $post.find('.edit').text().trim();

        let likes = parseInt($post.find('.points .points_pos').text()) || 0;

        let hasReactions = false, reactionCount = 0;
        $post.find('.st-emoji-post .st-emoji-counter').each(function() {
            hasReactions = true;
            reactionCount += parseInt($(this).data('count') || $(this).text() || 1);
        });
        if (!hasReactions && $post.find('.st-emoji-container').length) hasReactions = true;

        let ipAddress = $post.find('.ip_address dd a').text().trim();
        if (ipAddress) ipAddress = ipAddress.replace(/(\d+\.\d+\.\d+)\.\d+/, '$1.xxx');

        const postNumber = $post.index() + 1;
        let timeAgo = 'Recently';
        const title = $post.find('.when').attr('title');
        if (title) {
            const diff = Math.floor((Date.now() - new Date(title)) / 86400000);
            timeAgo = diff >= 1 ? `${diff} day${diff > 1 ? 's' : ''} ago` : 'Just now';
        }

        return {
            postId, username, avatarUrl, groupText, roleBadgeClass, roleIcon,
            postCount, reputation, isOnline, userTitle, contentHtml,
            signatureHtml, editInfo, likes, hasReactions, reactionCount,
            ipAddress, postNumber, timeAgo
        };
    }

    // ============================================================================
    // Generate modern card with full hx-on declarations
    // ============================================================================
    function generateModernPost(data) {
        if (!data) return '';

        const titleIcon = data.userTitle === 'Famous' ? 'fa-fire' : 
                         data.userTitle === 'Senior' ? 'fa-star' : 'fa-medal';

        const statusColor = data.isOnline ? '#10B981' : '#6B7280';

        return `
            <div class="post-card" data-post-id="${data.postId}" data-original-id="${CONFIG.POST_ID_PREFIX}${data.postId}">
                <div class="post-header-modern">
                    <div class="post-meta-left">
                        <div class="post-number-badge"><i class="fas fa-hashtag"></i> ${data.postNumber}</div>
                        <div class="post-timestamp"><time>${data.timeAgo}</time></div>
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
                        <img class="avatar-circle" src="${data.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(data.username)}`}" 
                             alt="${data.username}" width="70" height="70" loading="lazy">
                    </div>
                    <div class="user-details">
                        <div class="username-row"><span class="username">${escapeHtml(data.username)}</span></div>
                        <div class="badge-container">
                            <span class="role-badge ${data.roleBadgeClass}">
                                <i class="fas ${data.roleIcon}"></i> ${escapeHtml(data.groupText)}
                            </span>
                        </div>
                        <div class="user-stats-grid">
                            <span class="stat-pill"><i class="fa-regular ${titleIcon}"></i> ${data.userTitle}</span>
                            <span class="stat-pill"><i class="fa-regular fa-comments"></i> ${data.postCount} posts</span>
                            <span class="stat-pill"><i class="fa-regular fa-thumbs-up"></i> ${data.reputation ? '+' : ''}${data.reputation} rep</span>
                            <span class="stat-pill"><i class="fa-regular fa-circle" style="color:${statusColor}"></i> ${data.isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                </div>

                <div class="post-body">
                    <div class="post-text-content">${data.contentHtml}
                        ${data.editInfo ? `<div class="edit-indicator"><i class="fa-regular fa-pen-to-square"></i> ${escapeHtml(data.editInfo)}</div>` : ''}
                    </div>
                    ${data.signatureHtml ? `<div class="signature-modern">${data.signatureHtml}</div>` : ''}
                </div>

                <div class="post-footer-modern">
                    <div class="reaction-cluster">
                        <button class="reaction-btn" data-pid="${data.postId}" 
                                hx-on:click="forumModernizer.handleLike(this)">
                            <i class="fa-regular fa-thumbs-up"></i>
                            ${data.likes ? `<span class="reaction-count">${data.likes}</span>` : ''}
                        </button>
                        <button class="reaction-btn ${data.hasReactions ? 'reaction-placeholder' : ''}" data-pid="${data.postId}" 
                                hx-on:click="forumModernizer.handleReact(this)">
                            ${data.hasReactions ? 
                                `<img src="https://twemoji.maxcdn.com/v/latest/svg/1f606.svg" width="16" height="16" alt="laugh">` : 
                                `<i class="fa-regular fa-face-smile"></i>`}
                            ${data.reactionCount ? `<span class="reaction-count">${data.reactionCount}</span>` : ''}
                        </button>
                    </div>
                    ${data.ipAddress ? `<div class="ip-info"><i class="fa-regular fa-globe"></i> IP: ${data.ipAddress}</div>` : ''}
                </div>
            </div>
        `;
    }

    // ============================================================================
    // Core handlers (exposed globally for hx-on)
    // ============================================================================
    window.forumModernizer = {
        handleQuote(elt) {
            const pid = elt.dataset.pid;
            const link = document.querySelector(`#${CONFIG.POST_ID_PREFIX}${pid} a[href*="CODE=02"]`);
            if (link) location.href = link.href;
        },

        handleEdit(elt) {
            const pid = elt.dataset.pid;
            const link = document.querySelector(`#${CONFIG.POST_ID_PREFIX}${pid} a[href*="CODE=08"]`);
            if (link) location.href = link.href;
        },

        handleDelete(elt) {
            if (confirm('Delete this post?')) {
                if (typeof window.delete_post === 'function') window.delete_post(elt.dataset.pid);
            }
        },

        handleShare(elt) {
            const pid = elt.dataset.pid;
            const url = location.href.split('#')[0] + `#entry${pid}`;
            navigator.clipboard.writeText(url).then(() => {
                const orig = elt.innerHTML;
                elt.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => elt.innerHTML = orig, 1500);
            });
        },

        handleReport(elt) {
            const pid = elt.dataset.pid;
            let btn = document.querySelector(`#${CONFIG.POST_ID_PREFIX}${pid} .report_button`) ||
                      document.querySelector(`.report_button[data-pid="${pid}"]`);
            btn?.click();
        },

        handleLike(elt) {
            const pid = elt.dataset.pid;
            const likeBtn = document.querySelector(`#${CONFIG.POST_ID_PREFIX}${pid} .points .points_up`);
            likeBtn?.click();
            // Refresh reaction display after short delay
            setTimeout(() => refreshReactions(pid), CONFIG.REACTION_WAIT_DELAY);
        },

        handleReact(elt) {
            const pid = elt.dataset.pid;
            const emojiContainer = document.querySelector(`#${CONFIG.POST_ID_PREFIX}${pid} .st-emoji-container`);
            emojiContainer ? emojiContainer.click() : this.handleLike(elt);
            setTimeout(() => refreshReactions(pid), CONFIG.REACTION_WAIT_DELAY);
        }
    };

    function refreshReactions(postId) {
        const $post = $(`#${CONFIG.POST_ID_PREFIX}${postId}`);
        if (!$post.length) return;

        const countEl = $post.querySelector('.st-emoji-post .st-emoji-counter');
        if (countEl) {
            const count = countEl.dataset.count || countEl.textContent;
            const modernBtn = document.querySelector(`.post-card[data-original-id="${CONFIG.POST_ID_PREFIX}${postId}"] .reaction-btn`);
            if (modernBtn) {
                let span = modernBtn.querySelector('.reaction-count');
                if (!span) {
                    span = document.createElement('span');
                    span.className = 'reaction-count';
                    modernBtn.appendChild(span);
                }
                span.textContent = count;
            }
        }
    }

    // ============================================================================
    // Convert legacy post → modern card
    // ============================================================================
    function convertPostToModern($post) {
        const id = $post.attr('id');
        if (!id || state.processedPosts.has(id)) return;

        const data = extractPostData($post);
        if (data) {
            const html = generateModernPost(data);
            $post.after(html);
            state.processedPosts.add(id);
        }
    }

    // ============================================================================
    // Initialize everything
    // ============================================================================
    function initialize() {
        log('Forum Modernizer (htmx-optimized) starting...');

        const container = document.getElementById(CONFIG.CONTAINER_ID);
        if (!container) {
            // Auto-wrap if needed
            const firstPost = document.querySelector(CONFIG.POST_SELECTOR);
            if (firstPost) firstPost.parentElement.id = CONFIG.CONTAINER_ID;
        }

        // Convert all current posts
        document.querySelectorAll(CONFIG.POST_SELECTOR).forEach(post => {
            convertPostToModern($(post));
        });

        // htmx setup
        if (typeof htmx !== 'undefined') {
            htmx.onLoad(target => {
                target.querySelectorAll?.(CONFIG.POST_SELECTOR).forEach(p => convertPostToModern($(p)));
            });

            document.addEventListener('htmx:afterSwap', e => {
                if (e.detail.target.id === CONFIG.CONTAINER_ID) {
                    // Re-apply saved view after any swap
                    const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
                    if (saved === 'modern') {
                        e.detail.target.classList.add('view-modern');
                    }
                }
            });
        }

        // Restore view preference
        const savedView = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (savedView === 'modern') {
            document.getElementById(CONFIG.CONTAINER_ID)?.classList.add('view-modern');
        }

        log('Forum Modernizer ready — using htmx for view switching, actions, and content updates');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
