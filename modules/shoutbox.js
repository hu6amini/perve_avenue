// modules/shoutbox.js
// Modern Shoutbox Module — wraps the legacy <hello-box> element in a
// themed container positioned above the modern board list.
//
// Design notes:
//   - The legacy <hello-box> custom element is NOT reimplemented. It owns
//     the WebSocket connection, message state, emoticon picker, BBCode
//     toolbar, edit/delete/quote actions, and user avatars. Reimplementing
//     that protocol would be a second source of truth and would drift.
//   - Instead we relocate the element into a modern shell and restyle its
//     internal .hb-* classes via CSS. All interactive behaviour continues
//     to be handled by the legacy script.
//   - The module is idempotent: re-running initialize() after the observer
//     fires again does not create duplicate shells or move the element twice.
//   - Placement: above #modern-board-list when present (forum home), else
//     after #modern-breadcrumbs, else appended to #modern-forum-wrapper.
//     This matches the ORDERED_CONTAINERS contract in boards.js by
//     registering a container id that boards.js leaves alone — boards.js
//     only reorders the ids it knows about, so a sibling container survives
//     its reorder pass unchanged in the DOM but the visual position is
//     controlled by insertBefore on the board list.
//   - Collapse state is persisted to localStorage, mirroring the board
//     category collapse pattern in boards.js (board-cat-* prefix).
'use strict';

var ShoutboxModule = (function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    var CONFIG = Object.freeze({
        LEGACY_SELECTOR: 'hello-box',
        SHELL_ID: 'modern-shoutbox',
        BODY_ID: 'modern-shoutbox-body',
        COLLAPSE_KEY: 'shoutbox-collapsed',
        WRAPPER_ID: 'modern-forum-wrapper',
        BOARD_LIST_ID: 'modern-board-list',
        BREADCRUMB_ID: 'modern-breadcrumbs',
        // The legacy element sometimes starts hidden until its script
        // hydrates. We don't gate on visibility — the shell renders
        // immediately with a loading state and the legacy element
        // fills in when it's ready.
        MAX_WAIT_MS: 8000,
        POLL_INTERVAL_MS: 150
    });

    // =========================================================================
    // STATE
    // =========================================================================
    var isInitialized = false;
    var shellEl = null;
    var bodyEl = null;
    var legacyEl = null;
    var collapseBtn = null;
    var waitTimer = null;
    var waitStartedAt = 0;
    var _observerIds = [];

    // =========================================================================
    // HELPERS
    // =========================================================================
    function escapeHtml(str) {
        if (typeof str !== 'string') return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getWrapper() {
        return document.getElementById(CONFIG.WRAPPER_ID);
    }

    function isCollapsed() {
        try {
            return localStorage.getItem(CONFIG.COLLAPSE_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function setCollapsed(collapsed) {
        try {
            localStorage.setItem(CONFIG.COLLAPSE_KEY, collapsed ? '1' : '0');
        } catch (e) { /* ignore */ }
    }

    // =========================================================================
    // SHELL CONSTRUCTION
    //
    // The shell is deliberately thin. It owns only:
    //   - a header with a title, a live message counter, and a collapse
    //     toggle
    //   - a body container into which the legacy <hello-box> is moved
    //
    // Everything else (message list, input, emoticon picker, BBCode
    // toolbar) is the legacy element's own markup, restyled via CSS.
    // =========================================================================
    function buildShell() {
        var shell = document.createElement('section');
        shell.id = CONFIG.SHELL_ID;
        shell.className = 'modern-shoutbox';
        shell.setAttribute('aria-label', 'Shoutbox');

        var header = document.createElement('header');
        header.className = 'modern-shoutbox-header';

        // Title row
        var titleWrap = document.createElement('div');
        titleWrap.className = 'modern-shoutbox-title-wrap';

        var icon = document.createElement('span');
        icon.className = 'modern-shoutbox-icon';
        icon.innerHTML = '<i class="fa-regular fa-comments" aria-hidden="true"></i>';

        var title = document.createElement('h2');
        title.className = 'modern-shoutbox-title';
        title.textContent = 'Shoutbox';

        var counter = document.createElement('span');
        counter.className = 'modern-shoutbox-counter';
        counter.setAttribute('aria-live', 'polite');
        counter.setAttribute('aria-atomic', 'true');
        counter.textContent = '';

        titleWrap.appendChild(icon);
        titleWrap.appendChild(title);
        titleWrap.appendChild(counter);

        // Controls
        var controls = document.createElement('div');
        controls.className = 'modern-shoutbox-controls';

        var collapseBtnEl = document.createElement('button');
        collapseBtnEl.type = 'button';
        collapseBtnEl.className = 'modern-shoutbox-toggle';
        collapseBtnEl.setAttribute('aria-label', 'Collapse shoutbox');
        collapseBtnEl.setAttribute('aria-expanded', 'true');
        collapseBtnEl.setAttribute('aria-controls', CONFIG.BODY_ID);
        collapseBtnEl.innerHTML = '<i class="fa-regular fa-angle-down" aria-hidden="true"></i>';

        controls.appendChild(collapseBtnEl);

        header.appendChild(titleWrap);
        header.appendChild(controls);

        var body = document.createElement('div');
        body.id = CONFIG.BODY_ID;
        body.className = 'modern-shoutbox-body';

        // Loading placeholder shown until the legacy element is located
        // and moved in. Replaced with the real content on success, or
        // with an error state on timeout.
        var loading = document.createElement('div');
        loading.className = 'modern-shoutbox-loading';
        loading.innerHTML =
            '<i class="fa-regular fa-spinner fa-spin" aria-hidden="true"></i>' +
            '<span>Connecting to shoutbox…</span>';
        body.appendChild(loading);

        shell.appendChild(header);
        shell.appendChild(body);

        collapseBtn = collapseBtnEl;
        return shell;
    }

    // =========================================================================
    // PLACEMENT
    //
    // Three-tier placement, matching the priority the rest of the suite
    // uses:
    //   1. before #modern-board-list     (forum home — the target)
    //   2. after  #modern-breadcrumbs    (any other page with breadcrumbs)
    //   3. appended to #modern-forum-wrapper (fallback)
    // =========================================================================
    function placeShell(shell) {
        var wrapper = getWrapper();
        if (!wrapper) return false;

        var boardList = document.getElementById(CONFIG.BOARD_LIST_ID);
        if (boardList && boardList.parentNode) {
            boardList.parentNode.insertBefore(shell, boardList);
            return true;
        }

        var breadcrumb = document.getElementById(CONFIG.BREADCRUMB_ID);
        if (breadcrumb && breadcrumb.parentNode) {
            breadcrumb.insertAdjacentElement('afterend', shell);
            return true;
        }

        wrapper.appendChild(shell);
        return true;
    }

    // =========================================================================
    // LEGACY ELEMENT RELOCATION
    //
    // Moves the <hello-box> into the shell body. The element keeps its
    // identity — moving a node in the DOM does not disconnect its custom
    // element instance, does not reset its state, and does not interrupt
    // its open WebSocket. The connectedCallback fires again on reinsertion
    // but the legacy script is written to be idempotent (it checks for
    // existing state before rebuilding), so reinsertion is safe.
    //
    // The only side effect: any `document.querySelector('hello-box')`
    // calls made by the legacy script after the move will still find it,
    // because we do not detach it — insertBefore/appendChild on a live
    // node is a move, not a remove-then-insert from querySelector's
    // perspective.
    // =========================================================================
    function relocateLegacyElement() {
        if (legacyEl && legacyEl.parentNode === bodyEl) return true;

        var el = document.querySelector(CONFIG.LEGACY_SELECTOR);
        if (!el) return false;

        legacyEl = el;

        // Clear the loading placeholder.
        bodyEl.innerHTML = '';

        // Add a class to the legacy element so our CSS can target it
        // without depending on the tag name, which keeps the styles
        // scoped if other <hello-box> elements ever appear.
        legacyEl.classList.add('modern-shoutbox-legacy');

        // Preserve any inline styles the legacy script set on the element
        // itself, but clear display:none if the script uses it as a
        // "not yet hydrated" gate — the shell is already visible and the
        // loading state has been cleared, so there's nothing left to gate.
        if (legacyEl.style && legacyEl.style.display === 'none') {
            legacyEl.style.display = '';
        }

        bodyEl.appendChild(legacyEl);
        return true;
    }

    // =========================================================================
    // MESSAGE COUNTER
    //
    // The legacy element renders messages as `.hb-message` children of
    // `.hb-messages`. A MutationObserver on the messages container keeps
    // the counter in sync without polling. If the container doesn't exist
    // yet (legacy script still hydrating), we retry once on the next
    // observer pass.
    // =========================================================================
    var counterObserver = null;

    function updateCounter() {
        if (!legacyEl) return;
        var counterEl = shellEl && shellEl.querySelector('.modern-shoutbox-counter');
        if (!counterEl) return;

        var messages = legacyEl.querySelectorAll('.hb-message');
        var count = messages.length;
        counterEl.textContent = count === 1 ? '1 message' : count + ' messages';
    }

    function attachCounterObserver() {
        if (!legacyEl) return;
        var messagesContainer = legacyEl.querySelector('.hb-messages');
        if (!messagesContainer) {
            // Container not present yet — try again on the next idle tick.
            // One retry is enough; if it still isn't there, the legacy
            // element is in an error state and the counter is moot.
            setTimeout(function () {
                if (counterObserver) return;
                var retry = legacyEl && legacyEl.querySelector('.hb-messages');
                if (retry) attachCounterObserver();
            }, 500);
            return;
        }
        if (counterObserver) return;

        counterObserver = new MutationObserver(function () {
            updateCounter();
        });
        counterObserver.observe(messagesContainer, { childList: true, subtree: false });
        updateCounter();
    }

    // =========================================================================
    // COLLAPSE
    // =========================================================================
    function applyCollapseState(collapsed) {
        if (!shellEl || !bodyEl || !collapseBtn) return;

        shellEl.classList.toggle('is-collapsed', collapsed);
        bodyEl.hidden = collapsed;
        collapseBtn.setAttribute('aria-expanded', String(!collapsed));
        collapseBtn.setAttribute(
            'aria-label',
            collapsed ? 'Expand shoutbox' : 'Collapse shoutbox'
        );

        var icon = collapseBtn.querySelector('i');
        if (icon) {
            icon.className = collapsed
                ? 'fa-regular fa-angle-up'
                : 'fa-regular fa-angle-down';
        }
    }

    function handleCollapseClick(e) {
        e.preventDefault();
        var collapsed = !shellEl.classList.contains('is-collapsed');
        setCollapsed(collapsed);
        applyCollapseState(collapsed);
    }

    // =========================================================================
    // WAIT LOOP
    //
    // The legacy <hello-box> element is injected by the forum's own script,
    // which loads after ours on some pages. We poll for its appearance
    // rather than depending on a specific event, since the forum script
    // does not emit one. The timeout matches MAX_WAIT_MS; on failure the
    // shell stays in place with an error state rather than vanishing,
    // so the user sees that something is expected there.
    // =========================================================================
    function failWithError() {
        if (!bodyEl) return;
        bodyEl.innerHTML =
            '<div class="modern-shoutbox-error">' +
                '<i class="fa-regular fa-triangle-exclamation" aria-hidden="true"></i>' +
                '<span>Shoutbox is unavailable right now.</span>' +
            '</div>';
    }

    function tryRelocate() {
        if (relocateLegacyElement()) {
            attachCounterObserver();
            // Reapply collapse state — the body was empty when the
            // initial applyCollapseState ran, so the hidden attribute
            // was set but the visual is now meaningful.
            applyCollapseState(isCollapsed());
            if (waitTimer) {
                clearTimeout(waitTimer);
                waitTimer = null;
            }
            return true;
        }
        return false;
    }

    function startWaitLoop() {
        if (tryRelocate()) return;

        waitStartedAt = Date.now();

        function poll() {
            if (tryRelocate()) return;

            if (Date.now() - waitStartedAt > CONFIG.MAX_WAIT_MS) {
                failWithError();
                return;
            }
            waitTimer = setTimeout(poll, CONFIG.POLL_INTERVAL_MS);
        }

        waitTimer = setTimeout(poll, CONFIG.POLL_INTERVAL_MS);
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    function initialize() {
        if (isInitialized) {
            // Idempotent re-entry: if the legacy element was moved and
            // then the page re-rendered the wrapper (rare, but the
            // observer can fire after a DOM replacement), rebuild the
            // shell. The old shell is removed by the replacement, so
            // the isInitialized guard alone would leave us with no UI.
            if (!document.getElementById(CONFIG.SHELL_ID)) {
                isInitialized = false;
            } else {
                // Shell exists — ensure the legacy element is still
                // inside it. If not, re-relocate.
                if (legacyEl && legacyEl.parentNode !== bodyEl) {
                    bodyEl.appendChild(legacyEl);
                }
                return;
            }
        }

        if (!getWrapper()) {
            // Wrapper not built yet — forum-enhancer creates it. Retry
            // once the observer reports the wrapper. Registering here
            // (rather than depending on enhancer order) keeps the module
            // self-contained.
            if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
                try {
                    var id = globalThis.forumObserver.register({
                        id: 'shoutbox-wrapper-wait',
                        selector: '#' + CONFIG.WRAPPER_ID,
                        priority: 'high',
                        callback: function () {
                            try { globalThis.forumObserver.unregister(id); } catch (e) {}
                            initialize();
                        }
                    });
                    if (id) _observerIds.push(id);
                } catch (e) { /* ignore */ }
            }
            return;
        }

        isInitialized = true;

        // Build and place the shell.
        shellEl = buildShell();
        bodyEl = shellEl.querySelector('#' + CONFIG.BODY_ID);
        collapseBtn = shellEl.querySelector('.modern-shoutbox-toggle');

        if (!placeShell(shellEl)) {
            console.warn('[ShoutboxModule] Could not place shell — no wrapper available');
            return;
        }

        // Wire the collapse toggle.
        collapseBtn.addEventListener('click', handleCollapseClick);

        // Apply the persisted collapse state immediately. The body is
        // hidden before the legacy element arrives, so the user never
        // sees a flash of unstyled content.
        applyCollapseState(isCollapsed());

        // Locate and move the legacy element.
        startWaitLoop();

        console.log('[ShoutboxModule] Initialized');
    }

    // =========================================================================
    // RESET
    // =========================================================================
    function reset() {
        if (waitTimer) {
            clearTimeout(waitTimer);
            waitTimer = null;
        }
        if (counterObserver) {
            counterObserver.disconnect();
            counterObserver = null;
        }
        _observerIds.forEach(function (id) {
            if (globalThis.forumObserver && typeof globalThis.forumObserver.unregister === 'function') {
                try { globalThis.forumObserver.unregister(id); } catch (e) {}
            }
        });
        _observerIds = [];

        // Move the legacy element back out of the shell so a subsequent
        // page render (e.g. an AJAX partial swap) finds it in its
        // expected position. Best-effort: if the shell is gone, there's
        // nothing to move back to.
        if (legacyEl && bodyEl && bodyEl.parentNode) {
            var wrapper = getWrapper();
            if (wrapper) {
                wrapper.insertBefore(legacyEl, wrapper.firstChild);
            }
        }

        if (shellEl && shellEl.parentNode) {
            shellEl.parentNode.removeChild(shellEl);
        }

        shellEl = null;
        bodyEl = null;
        legacyEl = null;
        collapseBtn = null;
        isInitialized = false;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    return {
        initialize: initialize,
        reset: reset,
        name: 'shoutbox',
        dependencies: ['forumObserver']
    };
})();

if (typeof window !== 'undefined') {
    window.ShoutboxModule = ShoutboxModule;
    window.dispatchEvent(new CustomEvent('shoutbox-module-ready'));
}
