'use strict';

const ShoutboxModule = (function () {
    console.log('🔥 ShoutboxModule loaded (hello-box → modern shoutbox)');

    const CONFIG = Object.freeze({
        HELLO_BOX_SELECTOR: 'hello-box',
        CONTAINER_ID: 'modern-shoutbox',
        WRAPPER_ID: 'modern-forum-wrapper',
        BOARD_LIST_ID: 'modern-board-list',
        MAX_MESSAGES: 50,
        AVATAR_SIZE: 40,
        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 85,
        // Poll interval for the fallback path, in ms.
        POLL_INTERVAL: 250,
        // Give up polling after this many ms.
        POLL_TIMEOUT: 15000
    });

    const AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    // ------------------------------------------------------------------
    // Utilities (unchanged from the first version)
    // ------------------------------------------------------------------
    const escapeHtml = (str) => {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    function getColorFromNickname(nickname, userId) {
        let hash = 0;
        const str = nickname || userId || 'user';
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function getInitialFromName(name) {
        if (!name || typeof name !== 'string') return '?';
        const match = name.match(/[\p{L}\p{N}]/u);
        if (!match) return '?';
        return match[0].toUpperCase();
    }

    function isValidAvatarUrl(url) {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        return /^(https?:)?\/\//i.test(trimmed) && trimmed.length > 3;
    }

    function optimizeImageUrl(url, width, height) {
        if (!isValidAvatarUrl(url)) return null;
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.indexOf('weserv.nl') !== -1 || lowerUrl.indexOf('data:') === 0) return url;
        if (url.startsWith('//')) url = 'https:' + url;
        if (url.startsWith('http://') && window.location.protocol === 'https:') {
            url = url.replace('http://', 'https://');
        }
        const encoded = encodeURIComponent(url);
        return CONFIG.WESERV_CDN + '?url=' + encoded +
            '&output=webp&maxage=' + CONFIG.CACHE + '&q=' + CONFIG.QUALITY +
            '&w=' + width + '&h=' + height + '&fit=cover&a=attention&il';
    }

    // ------------------------------------------------------------------
    // Extraction
    // ------------------------------------------------------------------
    function extractMessage(hbMessage) {
        if (!hbMessage) return null;

        const authorAnchor = hbMessage.querySelector('a[href*="MID="]');
        if (!authorAnchor) return null;

        const profileUrl = authorAnchor.getAttribute('href') || '#';
        const midMatch = profileUrl.match(/MID=(\d+)/);
        const mid = midMatch ? midMatch[1] : null;

        const nickLink = hbMessage.querySelector('.hb-nickname a');
        const avatarImg = hbMessage.querySelector('img.hb-avatar');
        let authorName = nickLink ? nickLink.textContent.trim() : '';
        if (!authorName && avatarImg) authorName = avatarImg.getAttribute('alt') || '';
        if (!authorName) authorName = authorAnchor.textContent.trim() || 'Unknown';
        authorName = authorName.replace(/^@/, '');

        let avatarUrl = null;
        if (avatarImg) {
            const dataOriginal = avatarImg.getAttribute('data-original');
            const src = avatarImg.getAttribute('src');
            if (dataOriginal && isValidAvatarUrl(dataOriginal)) {
                avatarUrl = optimizeImageUrl(dataOriginal, CONFIG.AVATAR_SIZE, CONFIG.AVATAR_SIZE);
            } else if (src && isValidAvatarUrl(src)) {
                avatarUrl = src;
            }
        }

        const timeEl = hbMessage.querySelector('.hb-time');
        const timestamp = timeEl ? timeEl.textContent.trim() : '';

        const bodyEl = hbMessage.querySelector('.hb-text-content');
        let bodyHtml = '';
        if (bodyEl) {
            const clone = bodyEl.cloneNode(true);
            clone.querySelectorAll('.hb-quote-ref').forEach(el => el.remove());
            bodyHtml = clone.innerHTML.trim();
        }

        return { mid, authorName, profileUrl, avatarUrl, timestamp, bodyHtml };
    }

    function extractMessages(helloBox) {
        if (!helloBox) return [];
        const messageEls = helloBox.querySelectorAll('.hb-messages .hb-message');
        if (!messageEls.length) return [];
        const messages = [];
        const limit = Math.min(messageEls.length, CONFIG.MAX_MESSAGES);
        for (let i = 0; i < limit; i++) {
            const data = extractMessage(messageEls[i]);
            if (data) messages.push(data);
        }
        return messages;
    }

    // ------------------------------------------------------------------
    // Render
    // ------------------------------------------------------------------
    function buildAvatarHtml(msg) {
        if (msg.avatarUrl) {
            return '<a href="' + escapeHtml(msg.profileUrl) + '" class="shoutbox-avatar-link" aria-label="Profile of ' + escapeHtml(msg.authorName) + '">' +
                '<img class="shoutbox-avatar" src="' + escapeHtml(msg.avatarUrl) +
                    '" alt="" width="' + CONFIG.AVATAR_SIZE + '" height="' + CONFIG.AVATAR_SIZE +
                    '" loading="lazy" decoding="async">' +
                '</a>';
        }
        const initial = getInitialFromName(msg.authorName);
        const bgColor = getColorFromNickname(msg.authorName, msg.mid);
        return '<a href="' + escapeHtml(msg.profileUrl) + '" class="shoutbox-avatar-link" aria-label="Profile of ' + escapeHtml(msg.authorName) + '">' +
            '<span class="shoutbox-avatar shoutbox-avatar--initial" style="background-color:#' + bgColor + ';">' +
                escapeHtml(initial) +
            '</span>' +
        '</a>';
    }

    function buildMessageHtml(msg) {
        return '<article class="shoutbox-message">' +
            '<div class="shoutbox-message-avatar">' + buildAvatarHtml(msg) + '</div>' +
            '<div class="shoutbox-message-body">' +
                '<div class="shoutbox-message-header">' +
                    '<a href="' + escapeHtml(msg.profileUrl) + '" class="shoutbox-message-author">' +
                        escapeHtml(msg.authorName) +
                    '</a>' +
                    (msg.timestamp
                        ? '<time class="shoutbox-message-time">' + escapeHtml(msg.timestamp) + '</time>'
                        : '') +
                '</div>' +
                '<div class="shoutbox-message-content">' + msg.bodyHtml + '</div>' +
            '</div>' +
        '</article>';
    }

    function buildShoutboxHtml(messages) {
        const messagesHtml = messages.length
            ? messages.map(buildMessageHtml).join('')
            : '<div class="shoutbox-empty"><i class="fa-regular fa-comments" aria-hidden="true"></i><p>No messages yet. Be the first to shout!</p></div>';

        return (
            '<section class="modern-shoutbox" aria-labelledby="shoutbox-title">' +
                '<header class="shoutbox-header">' +
                    '<h2 class="shoutbox-title" id="shoutbox-title">' +
                        '<i class="fa-regular fa-comments" aria-hidden="true"></i> Shoutbox' +
                    '</h2>' +
                    '<span class="shoutbox-count">' + messages.length +
                        ' ' + (messages.length === 1 ? 'message' : 'messages') + '</span>' +
                '</header>' +
                '<div class="shoutbox-list" role="log" aria-live="polite">' + messagesHtml + '</div>' +
                '<div class="shoutbox-input-bar">' +
                    '<input type="text" class="shoutbox-input" placeholder="Type a message…" disabled aria-disabled="true">' +
                    '<button type="button" class="modern-btn modern-btn-primary" disabled aria-disabled="true">' +
                        '<i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Send' +
                    '</button>' +
                '</div>' +
            '</section>'
        );
    }

    // ------------------------------------------------------------------
    // Container
    //
    // Two things can be true here:
    //   1. The board list already exists → insert before it.
    //   2. The board list doesn't exist yet → we insert at the
    //      breadcrumb fallback now, and re-anchor later when the board
    //      list appears. That's why ensureAnchored() exists — it's
    //      idempotent and re-runs after every conversion.
    // ------------------------------------------------------------------
    function getWrapper() {
        return document.getElementById(CONFIG.WRAPPER_ID);
    }

    function ensureContainerExists() {
        let container = document.getElementById(CONFIG.CONTAINER_ID);
        if (container) return container;

        const wrapper = getWrapper();
        if (!wrapper) return null;

        container = document.createElement('div');
        container.id = CONFIG.CONTAINER_ID;
        container.className = 'modern-shoutbox-container';

        const breadcrumb = document.getElementById('modern-breadcrumbs');
        if (breadcrumb && breadcrumb.parentNode) {
            breadcrumb.insertAdjacentElement('afterend', container);
        } else {
            wrapper.appendChild(container);
        }
        return container;
    }

    function ensureAnchored(container) {
        if (!container) return;
        const boardList = document.getElementById(CONFIG.BOARD_LIST_ID);
        if (!boardList || !boardList.parentNode) return;

        // Already immediately before the board list → nothing to do.
        if (container.nextElementSibling === boardList) return;

        // Otherwise move it into position. insertBefore on an existing
        // node moves it, which is exactly what we want here.
        boardList.parentNode.insertBefore(container, boardList);
    }

    // ------------------------------------------------------------------
    // Conversion
    // ------------------------------------------------------------------
    let conversionInProgress = false;
    let lastMessageCount = -1;

    function convert() {
        if (conversionInProgress) return;
        conversionInProgress = true;

        try {
            const helloBox = document.querySelector(CONFIG.HELLO_BOX_SELECTOR);
            if (!helloBox) {
                return; // nothing to do yet
            }

            const container = ensureContainerExists();
            if (!container) {
                console.warn('[ShoutboxModule] No wrapper — cannot create container');
                return;
            }

            const messages = extractMessages(helloBox);

            // If the hello-box rendered zero messages (its script hasn't
            // populated the list yet), wait for the next callback.
            if (messages.length === 0) {
                return;
            }

            // Rebuild only when the message count changed. The hello-box
            // re-renders its inner list on its own schedule, and the
            // observer may fire multiple times; this keeps us from
            // thrashing the DOM.
            if (container.dataset.built === 'true' && messages.length === lastMessageCount) {
                ensureAnchored(container);
                return;
            }

            container.innerHTML = buildShoutboxHtml(messages);
            container.dataset.built = 'true';
            lastMessageCount = messages.length;

            helloBox.style.display = 'none';

            // Anchor now that the DOM has settled.
            ensureAnchored(container);

            console.log('[ShoutboxModule] Shoutbox modernized (' + messages.length + ' messages)');
        } catch (err) {
            console.error('[ShoutboxModule] Conversion error:', err);
        } finally {
            conversionInProgress = false;
        }
    }

    // ------------------------------------------------------------------
    // Observer + polling fallback
    //
    // The observer alone isn't enough here for two reasons:
    //
    //   1. hello-box is a web component. Its script can add the
    //      element with attributes that trip #shouldProcessMutation
    //      (or add it inside a shadow root the observer can't reach),
    //      so the selector callback never fires.
    //
    //   2. #modern-board-list is rendered asynchronously by
    //      ForumBoardsModule after an API fetch. The shoutbox needs to
    //      re-anchor after it appears, not just at first render.
    //
    // The polling fallback covers (1); ensureAnchored() called on
    // every convert() covers (2), and we also poll on the same tick
    // so the re-anchor happens even when no further observer callback
    // arrives.
    // ------------------------------------------------------------------
    let pollTimer = null;
    let pollStart = 0;

    function startPolling() {
        if (pollTimer) return;
        pollStart = Date.now();

        pollTimer = setInterval(function () {
            const container = document.getElementById(CONFIG.CONTAINER_ID);
            if (container) ensureAnchored(container);

            // Convert if we haven't yet, or if the hello-box has
            // re-rendered with a different count.
            convert();

            // Stop once we have a built container AND the board list is
            // anchored, or once the timeout elapses.
            const built = container && container.dataset.built === 'true';
            const anchored = container && container.nextElementSibling &&
                container.nextElementSibling.id === CONFIG.BOARD_LIST_ID;
            if (built && anchored) {
                clearInterval(pollTimer);
                pollTimer = null;
            } else if (Date.now() - pollStart > CONFIG.POLL_TIMEOUT) {
                clearInterval(pollTimer);
                pollTimer = null;
                console.debug('[ShoutboxModule] Polling stopped after timeout');
            }
        }, CONFIG.POLL_INTERVAL);
    }

    function registerObservers() {
        if (!globalThis.forumObserver) {
            console.warn('[ShoutboxModule] forumObserver unavailable — polling only');
            startPolling();
            return;
        }

        try {
            globalThis.forumObserver.register({
                id: 'shoutbox-module-hello-box',
                selector: CONFIG.HELLO_BOX_SELECTOR,
                priority: 'high',
                callback: function () { convert(); }
            });
            console.log('[ShoutboxModule] Registered hello-box observer');
        } catch (e) {
            console.error('[ShoutboxModule] hello-box observer failed:', e);
        }

        try {
            // Board list appearing is what lets us re-anchor.
            globalThis.forumObserver.register({
                id: 'shoutbox-module-board-list',
                selector: '#' + CONFIG.BOARD_LIST_ID,
                priority: 'high',
                callback: function () {
                    const container = document.getElementById(CONFIG.CONTAINER_ID);
                    if (container) ensureAnchored(container);
                }
            });
            console.log('[ShoutboxModule] Registered board-list observer');
        } catch (e) {
            console.error('[ShoutboxModule] board-list observer failed:', e);
        }

        // Polling covers the cases the observer misses.
        startPolling();
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------
    function initialize() {
        registerObservers();
        // Immediate attempt in case both elements are already present.
        convert();
        const container = document.getElementById(CONFIG.CONTAINER_ID);
        if (container) ensureAnchored(container);
        return Promise.resolve();
    }

    function reset() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        const container = document.getElementById(CONFIG.CONTAINER_ID);
        if (container) container.remove();
        const helloBox = document.querySelector(CONFIG.HELLO_BOX_SELECTOR);
        if (helloBox) helloBox.style.display = '';
        lastMessageCount = -1;
    }

    return {
        initialize: initialize,
        reset: reset,
        name: 'shoutbox'
    };
})();

if (typeof window !== 'undefined') {
    window.ShoutboxModule = ShoutboxModule;
    window.dispatchEvent(new CustomEvent('shoutbox-module-ready'));
}
