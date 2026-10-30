/* =============================================
   Shoutbox Modernizer – Starter Module
   Converts hello-box web component into a modern
   shoutbox UI. Reads existing messages from the
   hello-box element; posting functionality comes
   in a later iteration.
   ============================================= */
'use strict';

const ShoutboxModule = (function () {
    console.log('🔥 ShoutboxModule loaded (hello-box → modern shoutbox)');

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        // The legacy element to read from.
        HELLO_BOX_SELECTOR: 'hello-box',

        // Where the modern shoutbox goes.
        CONTAINER_ID: 'modern-shoutbox',
        WRAPPER_ID: 'modern-forum-wrapper',
        BOARD_LIST_ID: 'modern-board-list',

        // Read at most this many messages from the legacy box. The
        // legacy box renders newest-first, so we keep the first N.
        MAX_MESSAGES: 50,

        // Avatar size for message authors.
        AVATAR_SIZE: 40,

        // Weserv image proxy.
        WESERV_CDN: 'https://images.weserv.nl/',
        CACHE: '1y',
        QUALITY: 85
    });

    // Matches the palette used by every other module so a user gets the
    // same colour everywhere their initial-avatar appears.
    const AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    // =========================================================================
    // UTILITIES
    // =========================================================================
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
        if (lowerUrl.indexOf('weserv.nl') !== -1 || lowerUrl.indexOf('data:') === 0) {
            return url;
        }
        if (url.startsWith('//')) url = 'https:' + url;
        if (url.startsWith('http://') && window.location.protocol === 'https:') {
            url = url.replace('http://', 'https://');
        }
        const encoded = encodeURIComponent(url);
        return CONFIG.WESERV_CDN + '?url=' + encoded +
            '&output=webp&maxage=' + CONFIG.CACHE + '&q=' + CONFIG.QUALITY +
            '&w=' + width + '&h=' + height + '&fit=cover&a=attention&il';
    }

    function sanitizeGroupName(name) {
        if (!name) return 'member';
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'member';
    }

    // =========================================================================
    // LEGACY EXTRACTION
    // The hello-box web component renders its message list into a
    // <div class="hb-messages"> with one <div class="hb-message"> per
    // post. Each message carries the author's MID in a data-uid on the
    // root, the avatar and link in an <a> wrapping the avatar, and the
    // body in <p class="hb-text-content">.
    //
    // The timestamp is plain text (e.g. "30/10, 17:22"). We keep it as
    // a string for now — a later pass can parse it into a Date for
    // relative-time display, but the starter module's job is just to
    // surface the content.
    // =========================================================================
    function extractMessage(hbMessage) {
        if (!hbMessage) return null;

        const authorAnchor = hbMessage.querySelector('a[href*="MID="]');
        if (!authorAnchor) return null;

        const profileUrl = authorAnchor.getAttribute('href') || '#';
        const midMatch = profileUrl.match(/MID=(\d+)/);
        const mid = midMatch ? midMatch[1] : null;

        // Author name: prefer the nickname span's link text, fall back
        // to the anchor text or the avatar alt.
        const nickLink = hbMessage.querySelector('.hb-nickname a');
        const avatarImg = hbMessage.querySelector('img.hb-avatar');
        let authorName = nickLink ? nickLink.textContent.trim() : '';
        if (!authorName && avatarImg) authorName = avatarImg.getAttribute('alt') || '';
        if (!authorName) authorName = authorAnchor.textContent.trim() || 'Unknown';
        authorName = authorName.replace(/^@/, '');

        // Avatar: the legacy box already carries a weserv-optimized
        // src; data-original holds the raw upload URL. Re-optimize at
        // the shoutbox size so the avatar isn't a downsized 250×250.
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

        // Timestamp.
        const timeEl = hbMessage.querySelector('.hb-time');
        const timestamp = timeEl ? timeEl.textContent.trim() : '';

        // Body. The message content lives in <p class="hb-text-content">.
        // Inner markup (bold, spoiler markers, quote refs) is preserved
        // by cloning rather than reading textContent.
        const bodyEl = hbMessage.querySelector('.hb-text-content');
        let bodyHtml = '';
        if (bodyEl) {
            const clone = bodyEl.cloneNode(true);
            // Strip the quote-ref span — it's a jump target, not content.
            clone.querySelectorAll('.hb-quote-ref').forEach(el => el.remove());
            bodyHtml = clone.innerHTML.trim();
        }

        return {
            mid,
            authorName,
            profileUrl,
            avatarUrl,
            timestamp,
            bodyHtml
        };
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

    // =========================================================================
    // RENDER
    // =========================================================================
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
                // Input bar is a placeholder for now — posting lands in
                // a later iteration, at which point this becomes a real
                // textarea + send button wired to the hello-box API.
                '<div class="shoutbox-input-bar">' +
                    '<input type="text" class="shoutbox-input" placeholder="Type a message…" disabled aria-disabled="true">' +
                    '<button type="button" class="modern-btn modern-btn-primary" disabled aria-disabled="true">' +
                        '<i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Send' +
                    '</button>' +
                '</div>' +
            '</section>'
        );
    }

    // =========================================================================
    // CONTAINER
    // =========================================================================
    function getWrapper() {
        return document.getElementById(CONFIG.WRAPPER_ID);
    }

    function getOrCreateContainer() {
        let container = document.getElementById(CONFIG.CONTAINER_ID);
        if (container) return container;

        const wrapper = getWrapper();
        if (!wrapper) return null;

        container = document.createElement('div');
        container.id = CONFIG.CONTAINER_ID;
        container.className = 'modern-shoutbox-container';

        // Preferred insertion point: directly above the board list.
        // Fallback: after the breadcrumbs; last resort: end of wrapper.
        const boardList = document.getElementById(CONFIG.BOARD_LIST_ID);
        if (boardList && boardList.parentNode) {
            boardList.parentNode.insertBefore(container, boardList);
        } else {
            const breadcrumb = document.getElementById('modern-breadcrumbs');
            if (breadcrumb && breadcrumb.parentNode) {
                breadcrumb.insertAdjacentElement('afterend', container);
            } else {
                wrapper.appendChild(container);
            }
        }
        return container;
    }

    // =========================================================================
    // CONVERSION
    // =========================================================================
    let conversionInProgress = false;

    function convert() {
        if (conversionInProgress) return;
        conversionInProgress = true;

        try {
            const helloBox = document.querySelector(CONFIG.HELLO_BOX_SELECTOR);
            if (!helloBox) {
                console.debug('[ShoutboxModule] No hello-box found — skipping');
                return;
            }

            const container = getOrCreateContainer();
            if (!container) return;

            // Don't rebuild if we've already populated this container
            // and the source hasn't changed.
            if (container.dataset.built === 'true') return;

            const messages = extractMessages(helloBox);
            container.innerHTML = buildShoutboxHtml(messages);
            container.dataset.built = 'true';

            // Hide the legacy box — the modern UI replaces it.
            helloBox.style.display = 'none';

            console.log('[ShoutboxModule] Shoutbox modernized (' + messages.length + ' messages)');
        } catch (err) {
            console.error('[ShoutboxModule] Conversion error:', err);
        } finally {
            conversionInProgress = false;
        }
    }

    // =========================================================================
    // OBSERVER REGISTRATION
    // =========================================================================
    function registerObservers() {
        if (!globalThis.forumObserver) {
            console.warn('[ShoutboxModule] forumObserver unavailable — falling back to DOMContentLoaded');
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', convert, { once: true });
            } else {
                convert();
            }
            return;
        }

        // The hello-box may be injected by its own script after page
        // load, so we watch for it. The board list is what we anchor
        // the container to, so we also wait for that to exist.
        try {
            globalThis.forumObserver.register({
                id: 'shoutbox-module-hello-box',
                selector: CONFIG.HELLO_BOX_SELECTOR,
                priority: 'high',
                callback: function () { convert(); }
            });
            console.log('[ShoutboxModule] Registered with ForumCoreObserver');
        } catch (e) {
            console.error('[ShoutboxModule] Observer registration failed:', e);
            // Fallback: try once after a short delay.
            setTimeout(convert, 1000);
        }
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    function initialize() {
        registerObservers();
        // Also try immediately — the hello-box may already be present.
        convert();
        return Promise.resolve();
    }

    function reset() {
        const container = document.getElementById(CONFIG.CONTAINER_ID);
        if (container) container.remove();
        const helloBox = document.querySelector(CONFIG.HELLO_BOX_SELECTOR);
        if (helloBox) helloBox.style.display = '';
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
