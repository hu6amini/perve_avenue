// modules/posts.js
var ForumPostsModule = (function(Utils, EventBus) {
    'use strict';

    const CONFIG = {
        POST_SELECTORS: ['.post', 'div[id^="ee"]', 'div[id^="post"]', '.entry'],
        CONTAINER_ID: 'modern-posts-container',
        REACTION_DELAY: 600
    };

    let convertedPostIds = new Set();
    let isInitialized = false;
    let observerCallbackId = null;

    function getPostsContainer() {
        return document.getElementById(CONFIG.CONTAINER_ID) ||
               document.querySelector('.modern-posts-container') ||
               createFallbackContainer();
    }

    function createFallbackContainer() {
        const container = Utils.createDiv('modern-posts-container');
        const wrapper = document.getElementById('modern-forum-wrapper') || document.body;
        wrapper.appendChild(container);
        return container;
    }

    function isValidPost(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
        const id = el.id || '';
        return (id.startsWith('ee') || id.startsWith('post') || el.classList.contains('post')) &&
               !Utils.closest(el, '.signature, .edit, .quote') &&
               (el.querySelector('.nick') || el.querySelector('.avatar'));
    }

    function getPostId(postEl) {
        let id = postEl.id || '';
        if (id.startsWith('ee')) return id.replace(/^ee/, '');
        if (id.startsWith('post')) return id.replace(/^post/, '');
        return 'p' + (Date.now().toString(36) + Math.random().toString(36).slice(2));
    }

    function extractPostData(postEl, index) {
        if (!postEl) return null;
        const postId = getPostId(postEl);

        return {
            postId: postId,
            username: postEl.querySelector('.nick a')?.textContent.trim() || 'Unknown',
            avatarUrl: getAvatarUrl(postEl),
            groupText: postEl.querySelector('.u_group dd')?.textContent.trim() || 'Member',
            postCount: postEl.querySelector('.u_posts dd a')?.textContent.trim() || '0',
            reputation: postEl.querySelector('.u_reputation dd a')?.textContent.trim().replace(/[+\s]/g, '') || '0',
            isOnline: !!postEl.querySelector('.u_status[title*="online" i]'),
            userTitle: getUserTitle(postEl),
            rankIconClass: getRankIconClass(postEl),
            contentHtml: getCleanContent(postEl),
            signatureHtml: postEl.querySelector('.signature')?.innerHTML || '',
            editInfo: postEl.querySelector('.edit')?.textContent.trim() || '',
            likes: parseInt(postEl.querySelector('.points_pos')?.textContent) || 0,
            hasReactions: !!postEl.querySelector('.st-emoji-container'),
            reactionCount: Array.from(postEl.querySelectorAll('.st-emoji-counter')).reduce((sum, el) => sum + (parseInt(el.textContent) || 0), 0),
            ipAddress: getMaskedIp(postEl),
            postNumber: index + 1,
            timeAgo: getTimeAgo(postEl)
        };
    }

    function getAvatarUrl(postEl) {
        const img = postEl.querySelector('.avatar img');
        if (!img) return null;
        let src = img.getAttribute('src') || '';
        if (src.includes('weserv.nl')) {
            try {
                const params = new URLSearchParams(src.split('?')[1] || '');
                return params.get('url') || src;
            } catch(e) {}
        }
        return src;
    }

    function getUserTitle(postEl) {
        const titleEl = postEl.querySelector('.u_title');
        if (!titleEl) return 'Member';
        let title = titleEl.textContent.trim();
        if (title === 'Member') {
            const stars = postEl.querySelectorAll('.u_rank i.fa-star').length;
            if (stars >= 3) return 'Famous';
            if (stars === 2) return 'Senior';
            if (stars === 1) return 'Junior';
        }
        return title;
    }

    function getRankIconClass(postEl) {
        const icon = postEl.querySelector('.u_rank i:last-child');
        if (!icon) return 'fa-medal fa-regular';
        const cls = icon.getAttribute('class') || '';
        const match = cls.match(/fa-(regular|solid|light)?\s*fa-([a-z0-9-]+)/i);
        return match ? `${match[1] ? 'fa-' + match[1] : 'fa-regular'} fa-${match[2]}` : 'fa-medal fa-regular';
    }

    function getCleanContent(postEl) {
        let content = postEl.querySelector('.right .Item table.color, .post-content, .message, .right');
        if (!content) content = postEl;

        const clone = content.cloneNode(true);
        clone.querySelectorAll('.signature, .edit, .bottomborder, .st-emoji-container').forEach(el => el.remove());

        clone.querySelectorAll('br').forEach(br => {
            if (br.previousElementSibling?.tagName === 'BR' ||
                br.nextElementSibling?.classList?.contains('bottomborder')) {
                br.remove();
            }
        });

        return clone.innerHTML.trim();
    }

    function getMaskedIp(postEl) {
        const ipLink = postEl.querySelector('.ip_address a, .ip');
        if (!ipLink) return '';
        let ip = ipLink.textContent.trim();
        const parts = ip.split('.');
        return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.xxx` : ip;
    }

    function getTimeAgo(postEl) {
        const when = postEl.querySelector('.when');
        if (!when) return 'Recently';
        const title = when.getAttribute('title');
        if (!title) return 'Recently';

        const diffMs = Date.now() - new Date(title);
        const diffDays = Math.floor(diffMs / 86400000);
        if (diffDays >= 1) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        const diffHours = Math.floor(diffMs / 3600000);
        if (diffHours >= 1) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return 'Just now';
    }

    function generateModernPost(data) {
        if (!data) return '';
        const statusColor = data.isOnline ? '#10b981' : '#6b7280';
        const repSign = parseInt(data.reputation) > 0 ? '+' : '';

        return `
        <article class="post-card" data-post-id="${data.postId}" data-original-id="ee${data.postId}">
            <header class="post-header-modern">
                <div class="post-meta-left">
                    <span class="post-number-badge">#${data.postNumber}</span>
                    <time class="post-timestamp">${data.timeAgo}</time>
                </div>
                <div class="post-actions">
                    <button class="action-btn" data-action="quote" data-pid="${data.postId}" title="Quote">Quote</button>
                    <button class="action-btn" data-action="edit" data-pid="${data.postId}" title="Edit">Edit</button>
                    <button class="action-btn" data-action="share" data-pid="${data.postId}" title="Share">Share</button>
                    <button class="action-btn" data-action="report" data-pid="${data.postId}" title="Report">Report</button>
                </div>
            </header>

            <div class="user-area">
                <div class="avatar-modern">
                    <img src="${data.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(data.username)}`}" 
                         alt="${Utils.escapeHtml(data.username)}" width="72" height="72" loading="lazy">
                </div>
                <div class="user-details">
                    <div class="username">${Utils.escapeHtml(data.username)}</div>
                    <div class="role-badge">${Utils.escapeHtml(data.groupText)}</div>
                    <div class="user-stats">
                        <span><i class="${data.rankIconClass}"></i> ${data.userTitle}</span>
                        <span>${data.postCount} posts</span>
                        <span>${repSign}${data.reputation} rep</span>
                        <span style="color:${statusColor}">● ${data.isOnline ? 'Online' : 'Offline'}</span>
                    </div>
                </div>
            </div>

            <div class="post-body">
                <div class="post-content">${data.contentHtml}</div>
                ${data.editInfo ? `<div class="edit-indicator">Edited: ${Utils.escapeHtml(data.editInfo)}</div>` : ''}
                ${data.signatureHtml ? `<div class="signature-modern">${data.signatureHtml}</div>` : ''}
            </div>

            <footer class="post-footer-modern">
                <div class="reactions">
                    <button class="reaction-btn like-btn" data-pid="${data.postId}">
                        <i class="fa-regular fa-thumbs-up"></i>
                        ${data.likes ? `<span>${data.likes}</span>` : ''}
                    </button>
                    <button class="reaction-btn react-btn" data-pid="${data.postId}">
                        <i class="fa-regular fa-face-smile"></i>
                        ${data.reactionCount ? `<span>${data.reactionCount}</span>` : ''}
                    </button>
                </div>
                ${data.ipAddress ? `<div class="ip-info">IP: ${data.ipAddress}</div>` : ''}
            </footer>
        </article>`;
    }

    function convertAndAppend(postEl, index) {
        const postId = getPostId(postEl);
        if (convertedPostIds.has(postId)) return;

        const data = extractPostData(postEl, index);
        if (!data) return;

        const temp = document.createElement('div');
        temp.innerHTML = generateModernPost(data);
        const card = temp.firstElementChild;

        getPostsContainer().appendChild(card);
        convertedPostIds.add(postId);

        if (EventBus) EventBus.trigger('post:converted', { postId, original: postEl, card });
    }

    function attachEventHandlers() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action], button.reaction-btn');
            if (!btn) return;
            const pid = btn.dataset.pid;
            if (!pid) return;

            const action = btn.dataset.action || (btn.classList.contains('like-btn') ? 'like' : 'react');

            // TODO: Wire these to original forum functions as needed
            if (action === 'share') {
                navigator.clipboard.writeText(location.href.split('#')[0] + '#entry' + pid);
            }
            // Add more handlers (quote, edit, like, etc.) by calling original links
        });
    }

    function initialize() {
        if (isInitialized) return;
        isInitialized = true;

        const container = getPostsContainer();
        container.innerHTML = '';
        convertedPostIds.clear();

        const allPosts = Array.from(document.querySelectorAll(CONFIG.POST_SELECTORS.join(',')))
                             .filter(isValidPost);

        allPosts.forEach((post, idx) => convertAndAppend(post, idx));

        attachEventHandlers();

        // Dynamic updates via observer
        if (globalThis.forumObserver) {
            observerCallbackId = globalThis.forumObserver.register({
                id: 'posts-module-dynamic',
                selector: '.post',
                priority: 'high',
                callback: (node) => {
                    if (isValidPost(node)) {
                        const idx = Array.from(document.querySelectorAll(CONFIG.POST_SELECTORS.join(',')))
                                        .filter(isValidPost).indexOf(node);
                        convertAndAppend(node, idx);
                    }
                }
            });
        }

        console.log(`[PostsModule] Ready — ${convertedPostIds.size} posts modernized`);
    }

    function destroy() {
        if (observerCallbackId && globalThis.forumObserver) {
            globalThis.forumObserver.unregister(observerCallbackId);
        }
        convertedPostIds.clear();
        isInitialized = false;
    }

    return {
        initialize,
        destroy,
        reset: () => { convertedPostIds.clear(); isInitialized = false; },
        refresh: initialize
    };

})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);
