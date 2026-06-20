/* =============================================
   Forum Boards Modernizer – Emerald Theme
   Converts legacy <ul class="board List"> into
   modern cards grouped by category.
   ============================================= */
'use strict';

const ForumBoardsModule = (function () {
    console.log('🔥 ForumBoardsModule loaded');

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        BOARD_LIST_SELECTOR: 'ul.board.List',
        CATEGORY_SELECTOR: 'li.skin_tbl',
        FORUM_ROW_SELECTOR: 'ul.big_list > li',
        CONTAINER_ID: 'modern-board-list',
        WRAPPER_ID: 'modern-forum-wrapper',
        INSERT_AFTER_SELECTOR: '.carousel-wrapper',
    });

    // =========================================================================
    // UTILITIES (copied from Posts module for self‑containment)
    // =========================================================================
    const escapeHtml = (str) => {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    function parseDateFromTitle(title) {
        if (!title) return null;
        title = title.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)?:(\d+)/i, '$1:$2 $3');
        const hasMeridiem = /[ap]m/i.test(title);
        const nums = title.match(/\d+/g);
        if (!nums || nums.length < 3) return null;
        let year, month, day, hour, minute, second;
        if (hasMeridiem) {
            month = parseInt(nums[0], 10) - 1;
            day = parseInt(nums[1], 10);
            year = parseInt(nums[2], 10);
            hour = parseInt(nums[3] || 0, 10);
            minute = parseInt(nums[4] || 0, 10);
            second = parseInt(nums[5] || 0, 10);
            const isPM = /pm/i.test(title);
            if (isPM && hour < 12) hour += 12;
            if (!isPM && hour === 12) hour = 0;
        } else {
            day = parseInt(nums[0], 10);
            month = parseInt(nums[1], 10) - 1;
            year = parseInt(nums[2], 10);
            hour = parseInt(nums[3] || 0, 10);
            minute = parseInt(nums[4] || 0, 10);
            second = parseInt(nums[5] || 0, 10);
        }
        return new Date(year, month, day, hour, minute, second);
    }

    function getRelativeTimeString(date) {
        if (!date || isNaN(date.getTime())) return 'Unknown';
        const now = new Date();
        const diff = date - now;
        const absDiff = Math.abs(diff) / 1000;
        const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'en', { numeric: 'auto' });
        if (absDiff < 60) return rtf.format(Math.floor(diff / 1000), 'second');
        if (absDiff < 3600) return rtf.format(Math.floor(diff / 60000), 'minute');
        if (absDiff < 86400) return rtf.format(Math.floor(diff / 3600000), 'hour');
        if (absDiff < 2592000) return rtf.format(-Math.floor(absDiff / 86400), 'day');
        if (absDiff < 31536000) return rtf.format(-Math.floor(absDiff / 2592000), 'month');
        return rtf.format(-Math.floor(absDiff / 31536000), 'year');
    }

    function formatNumber(num) {
        return (num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // =========================================================================
    // GET OR CREATE MODERN BOARD CONTAINER
    // =========================================================================
    function getModernBoardContainer() {
        const wrapper = document.getElementById(CONFIG.WRAPPER_ID);
        if (!wrapper) {
            console.warn('[BoardsModule] #modern-forum-wrapper not found');
            return null;
        }
        let container = document.getElementById(CONFIG.CONTAINER_ID);
        if (container) return container;

        // Place after .carousel-wrapper (if exists), otherwise at the end of wrapper
        const afterEl = wrapper.querySelector(CONFIG.INSERT_AFTER_SELECTOR);
        container = document.createElement('div');
        container.id = CONFIG.CONTAINER_ID;
        container.className = 'modern-board-list';
        if (afterEl) {
            afterEl.insertAdjacentElement('afterend', container);
        } else {
            wrapper.appendChild(container);
        }
        return container;
    }

    // =========================================================================
    // DATA EXTRACTION FROM LEGACY FORUM ROW
    // =========================================================================
    function extractForumData(row) {
        const id = row.id;                          // e.g. "f9107304"
        const forumId = id ? id.replace('f', '') : '';

        const nameEl = row.querySelector('.bb h3 a');
        const forumName = nameEl ? nameEl.textContent.trim() : 'Unknown Forum';
        const forumUrl = nameEl ? nameEl.getAttribute('href') : '#';

        const topicsEm = row.querySelector('.yy .topics em');
        const repliesEm = row.querySelector('.yy .replies em');
        const topicsCount = topicsEm ? parseInt(topicsEm.textContent, 10) || 0 : 0;
        const repliesCount = repliesEm ? parseInt(repliesEm.textContent, 10) || 0 : 0;

        const whenEl = row.querySelector('.zz .when');
        const lastPostDateStr = whenEl ? whenEl.textContent.trim() : '';
        const lastPostDate = parseDateFromTitle(lastPostDateStr);
        const lastPostRelative = lastPostDate ? getRelativeTimeString(lastPostDate) : '';

        const whereEl = row.querySelector('.zz .where');
        let lastTopicUrl = '';
        let lastTopicTitle = '';
        let subForumUrl = '';
        let subForumName = '';
        if (whereEl) {
            const links = whereEl.querySelectorAll('a');
            // In your example, there's exactly one <a> for the topic
            if (links.length === 1) {
                lastTopicUrl = links[0].getAttribute('href') || '';
                lastTopicTitle = links[0].textContent.trim();
            } else if (links.length >= 2) {
                // If there were two links, the first would be the sub‑forum
                subForumUrl = links[0].getAttribute('href') || '';
                subForumName = links[0].textContent.trim();
                lastTopicUrl = links[1].getAttribute('href') || '';
                lastTopicTitle = links[1].textContent.trim();
            }
        }

        const whoLink = row.querySelector('.zz .who a');
        const lastPostAuthor = whoLink ? whoLink.textContent.trim() : '';
        const lastPostAuthorUrl = whoLink ? whoLink.getAttribute('href') : '';

        const iconEl = row.querySelector('.aa i');
        const iconClass = iconEl ? iconEl.className : 'fa-regular fa-folder';

        return {
            forumId,
            forumName,
            forumUrl,
            topicsCount,
            repliesCount,
            lastPostRelative,
            lastPostDateStr,
            lastTopicUrl,
            lastTopicTitle,
            subForumUrl,
            subForumName,
            lastPostAuthor,
            lastPostAuthorUrl,
            iconClass,
        };
    }

    // =========================================================================
    // EXTRACT CATEGORY DATA (group header)
    // =========================================================================
    function extractCategoryData(catLi) {
        const id = catLi.id;                       // e.g. "c9107304"
        const categoryId = id ? id.replace('c', '') : '';
        const titleEl = catLi.querySelector('h2.mtitle');
        const categoryName = titleEl ? titleEl.textContent.trim() : 'Category';
        return { categoryId, categoryName };
    }

    // =========================================================================
    // GENERATE MODERN HTML FOR ONE FORUM CARD
    // =========================================================================
    function generateForumCard(data) {
        let lastPostHtml = '';
        if (data.lastTopicUrl) {
            let subText = '';
            if (data.subForumName) {
                const subLink = data.subForumUrl
                    ? `<a href="${escapeHtml(data.subForumUrl)}">${escapeHtml(data.subForumName)}</a>`
                    : escapeHtml(data.subForumName);
                subText = ` <span class="last-post-in">in</span> ${subLink} → `;
            } else {
                subText = ' ';
            }
            lastPostHtml = `
                <div class="board-last-post">
                    <div class="last-post-topic">
                        ${subText}<a href="${escapeHtml(data.lastTopicUrl)}">${escapeHtml(data.lastTopicTitle)}</a>
                    </div>
                    <div class="last-post-meta">
                        <span class="last-post-date">${escapeHtml(data.lastPostRelative)}</span>
                        ${data.lastPostAuthor ? `<span class="last-post-author">by <a href="${escapeHtml(data.lastPostAuthorUrl)}">${escapeHtml(data.lastPostAuthor)}</a></span>` : ''}
                    </div>
                </div>`;
        } else {
            lastPostHtml = '<div class="board-last-post board-last-post--empty">No posts yet</div>';
        }

        return `
            <article class="board-card" data-forum-id="${data.forumId}" data-original-id="f${data.forumId}">
                <a href="${escapeHtml(data.forumUrl)}" class="board-card-main-link" aria-label="Go to ${escapeHtml(data.forumName)}">
                    <div class="board-icon">
                        <i class="${escapeHtml(data.iconClass)}" aria-hidden="true"></i>
                    </div>
                    <div class="board-info">
                        <h3 class="board-name">${escapeHtml(data.forumName)}</h3>
                        <div class="board-stats">
                            <span class="stat"><i class="fa-regular fa-message" aria-hidden="true"></i> ${formatNumber(data.topicsCount)} topics</span>
                            <span class="stat"><i class="fa-regular fa-reply" aria-hidden="true"></i> ${formatNumber(data.repliesCount)} replies</span>
                        </div>
                    </div>
                </a>
                ${lastPostHtml}
            </article>`;
    }

    // =========================================================================
    // BUILD COMPLETE MODERN BOARD LIST FROM LEGACY
    // =========================================================================
    function buildModernBoardList() {
        const legacyList = document.querySelector(CONFIG.BOARD_LIST_SELECTOR);
        if (!legacyList) return '';

        const categories = legacyList.querySelectorAll(CONFIG.CATEGORY_SELECTOR);
        if (categories.length === 0) return '';

        let html = '';
        categories.forEach(cat => {
            const catData = extractCategoryData(cat);
            const forumRows = cat.querySelectorAll(CONFIG.FORUM_ROW_SELECTOR);
            if (forumRows.length === 0) return;

            // Category header
            html += `<section class="board-category" data-category-id="${catData.categoryId}">
                <header class="board-category-header">
                    <h2 class="board-category-title">${escapeHtml(catData.categoryName)}</h2>
                </header>
                <div class="board-category-grid">`;

            forumRows.forEach(row => {
                const data = extractForumData(row);
                html += generateForumCard(data);
            });

            html += `</div></section>`;
        });

        return html;
    }

    // =========================================================================
    // MAIN CONVERSION FUNCTION
    // =========================================================================
    function convertBoards() {
        const container = getModernBoardContainer();
        if (!container) return;
        const modernHtml = buildModernBoardList();
        if (!modernHtml) {
            container.innerHTML = '';   // nothing to show
            return;
        }
        container.innerHTML = modernHtml;

        // Attach click handlers for last‑post links (optional: open in same tab)
        // Links already work naturally, but we can add event delegation if needed.
        console.log('[BoardsModule] Board list modernized');
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    function initialize() {
        // Only run on pages that actually have the board list
        if (!document.querySelector(CONFIG.BOARD_LIST_SELECTOR)) {
            return;
        }
        convertBoards();

        // Optional: if your forum uses AJAX to update the board list, you can
        // hook into an observer. For now, we just convert once.
        if (typeof globalThis.forumObserver !== 'undefined' && globalThis.forumObserver) {
            globalThis.forumObserver.register({
                id: 'boards-module',
                selector: CONFIG.BOARD_LIST_SELECTOR,
                priority: 'low',
                callback: () => {
                    // Rebuild if the whole board list changes
                    convertBoards();
                }
            });
        }
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    return {
        initialize,
        refresh: convertBoards
    };
})();

// Auto‑initialize when DOM is ready (or immediately if already interactive)
if (document.readyState === 'interactive' || document.readyState === 'complete') {
    setTimeout(() => ForumBoardsModule.initialize(), 0);
} else {
    document.addEventListener('DOMContentLoaded', () => ForumBoardsModule.initialize());
}

// Expose globally
if (typeof window !== 'undefined') {
    window.ForumBoardsModule = ForumBoardsModule;
    window.dispatchEvent(new CustomEvent('boards-module-ready'));
}
