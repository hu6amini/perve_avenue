// ================================================
// Forum Modernizer - Maximum htmx Edition
// Final robust .u_rank parser (correct prefix + icon name)
// ================================================

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
    // DATA EXTRACTION - Final fixed rank parsing
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
        const roleIcon = isAdmin ? 'fa-crown' : 'fa-user';

        const postCount = $post.find('.u_posts dd a').text().trim() || '0';
        let reputation = $post.find('.u_reputation dd a').text().trim().replace('+', '');

        const statusTitle = $post.find('.u_status').attr('title') || '';
        const isOnline = statusTitle.toLowerCase().includes('online');

        // === FINAL ROBUST RANK PARSING ===
        let userTitle = 'Member';
        let rankIconClass = 'fa-medal fa-regular';   // safe default with style

        const $uRank = $post.find('.u_rank').first();
        if ($uRank.length) {
            // Rank name
            const rankText = $uRank.find('span').last().text().trim();
            if (rankText) userTitle = rankText;

            // Get icon - take the last <i> and extract both style and icon name
            const $icon = $uRank.find('i').last();
            if ($icon.length) {
                const classAttr = $icon.attr('class') || '';

                // Match both the style (regular/solid) and the icon name
                const match = classAttr.match(/fa-(regular|solid|light|brands)?\s*fa-([a-z0-9-]+)/i);
                if (match) {
                    const style = match[1] ? `fa-${match[1]}` : 'fa-regular';
                    const iconName = match[2];
                    rankIconClass = `${style} fa-${iconName}`;
                }
            }
        }

        const contentClone = $post.find('.right.Item table.color').clone();
        contentClone.find('.signature, .edit').remove();
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
            postId, username, avatarUrl, groupText, roleBadgeClass, roleIcon,
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
                        <button class="action-icon" title="Quote" data-pid="${data.postId}" hx-on:click="forumModernizer.handleQuote(this)">
                            <i class="fa-regular fa-quote-left"></i>
                        </button>
                        <button class="action-icon" title="Edit" data-pid="${data.postId}" hx-on:click="forumModernizer.handleEdit(this)">
                            <i class="fa-regular fa-pen-to-square"></i>
                        </button>
                        <button class="action-icon" title="Share" data-pid="${data.postId}" hx-on:click="forumModernizer.handleShare(this)">
                            <i class="fa-regular fa-share-nodes"></i>
                        </button>
                        <button class="action-icon report-action" title="Report" data-pid="${data.postId}" hx-on:click="forumModernizer.handleReport(this)">
                            <i class="fa-regular fa-circle-exclamation"></i>
                        </button>
                        <button class="action-icon delete-action" title="Delete" data-pid="${data.postId}" hx-on:click="forumModernizer.handleDelete(this)">
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
                        <button class="reaction-btn" data-pid="${data.postId}" hx-on:click="forumModernizer.handleLike(this)">
                            <i class="fa-regular fa-thumbs-up"></i>
                            ${data.likes > 0 ? `<span class="reaction-count">${data.likes}</span>` : ''}
                        </button>
                        <button class="reaction-btn ${data.hasReactions ? 'reaction-placeholder' : ''}" data-pid="${data.postId}" hx-on:click="forumModernizer.handleReact(this)">
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

    // Handlers (unchanged)
    window.forumModernizer = {
        handleQuote(elt) { /* ... same as before */ },
        handleEdit(elt) { /* ... */ },
        handleDelete(elt) { /* ... */ },
        handleShare(elt) { /* ... */ },
        handleReport(elt) { /* ... */ },
        handleLike(elt) { /* ... */ },
        handleReact(elt) { /* ... */ }
    };

    function refreshReactionDisplay(postId) {
        const $post = $(`#${CONFIG.POST_ID_PREFIX}${postId}`);
        if (!$post.length) return;
        const countEl = $post.find('.st-emoji-post .st-emoji-counter').first();
        if (countEl.length) {
            const count = countEl.data('count') || countEl.text();
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

    function convertToModern(postEl) {
        const $post = $(postEl);
        const postId = $post.attr('id');
        if (!postId || document.querySelector(`.post-card[data-original-id="${postId}"]`)) return;

        const data = extractPostData($post);
        if (!data) return;

        const modernHTML = generateModernPost(data);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = modernHTML;
        const newCard = tempDiv.firstElementChild;

        $post.after(newCard);

        if (typeof htmx !== 'undefined') htmx.process(newCard);
    }

    function initialize() {
        console.log('[ForumModernizer] Starting with final rank fix');

        let container = document.getElementById(CONFIG.CONTAINER_ID);
        if (!container) {
            const firstPost = document.querySelector(CONFIG.POST_SELECTOR);
            if (firstPost && firstPost.parentElement) {
                firstPost.parentElement.id = CONFIG.CONTAINER_ID;
                container = firstPost.parentElement;
            }
        }

        document.querySelectorAll(CONFIG.POST_SELECTOR).forEach(convertToModern);

        if (typeof htmx !== 'undefined') {
            htmx.onLoad((target) => {
                target.querySelectorAll?.(CONFIG.POST_SELECTOR).forEach(convertToModern);
            });

            document.addEventListener('htmx:afterSwap', (evt) => {
                if (evt.detail.target.id === CONFIG.CONTAINER_ID) {
                    if (localStorage.getItem(CONFIG.STORAGE_KEY) === 'modern') {
                        evt.detail.target.classList.add('view-modern');
                    }
                }
            });
        }

        if (localStorage.getItem(CONFIG.STORAGE_KEY) === 'modern') {
            document.getElementById(CONFIG.CONTAINER_ID)?.classList.add('view-modern');
        }

        console.log('[ForumModernizer] Ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
