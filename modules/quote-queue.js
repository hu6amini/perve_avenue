// modules/quote-queue.js — Toggle-based multi-quote queue.
// Replaces the legacy checkbox multiselect (which lives on hidden .post
// elements and can't be reached from the modern cards).
'use strict';

var QuoteQueueModule = (function (Utils) {
    'use strict';

    var STORAGE_KEY = 'ff-quote-queue-v1';
    var MAX_ITEMS = 20;
    var queue = [];        // [{ postId, author, timestamp, url, preview }]
    var barEl = null;
    var isInitialized = false;
    var _observerIds = [];

    // --- Extract a minimal quote descriptor from a modern card ----------
    // The card carries data-post-id; the legacy .post alongside it holds
    // the timestamp and the author link that the backend expects in the
    // BBCode payload.
    function extractFromCard(card) {
        if (!card) return null;
        var postId = card.getAttribute('data-post-id');
        if (!postId) return null;

        var legacy = document.getElementById('ee' + postId);
        var author = '';
        var timestamp = '';
        var url = '';

        if (legacy) {
            var nickLink = legacy.querySelector('.nick a');
            author = nickLink ? nickLink.textContent.trim() : '';
            var whenEl = legacy.querySelector('.when');
            if (whenEl) {
                timestamp = (whenEl.getAttribute('data-tippy-content') || '')
                    .replace(/<[^>]*>/g, '').trim() || whenEl.textContent.trim();
            }
            var quoteLink = legacy.querySelector('a[href*="CODE=02"]');
            if (quoteLink) url = quoteLink.getAttribute('href');
        }

        // Fallback to the card itself for author.
        if (!author) {
            var cardNick = card.querySelector('.user-name a');
            if (cardNick) author = cardNick.textContent.trim();
        }

        // Preview = first ~120 chars of body text.
        var body = card.querySelector('.post-message');
        var preview = body ? (body.textContent || '').trim().slice(0, 120) : '';

        return {
            postId: postId,
            author: author || 'Unknown',
            timestamp: timestamp,
            url: url,
            preview: preview
        };
    }

    // --- Persistence ---------------------------------------------------
    function load() {
        try {
            var raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) queue = parsed;
        } catch (e) { queue = []; }
    }
    function save() {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); } catch (e) {}
    }

    // --- Button state --------------------------------------------------
    function findQuoteButton(card) {
        if (!card) return null;
        return card.querySelector('.action-icon[data-action="quote"]');
    }

    function setButtonQueued(card, isQueued) {
        var btn = findQuoteButton(card);
        if (!btn) return;
        btn.classList.toggle('is-queued', isQueued);
        btn.setAttribute('aria-pressed', String(isQueued));
        btn.title = isQueued ? 'Remove from quote queue' : 'Add to quote queue';
        btn.setAttribute('aria-label', btn.title);
        var icon = btn.querySelector('i');
        if (icon) {
            icon.className = isQueued
                ? 'fa-solid fa-quote-left'
                : 'fa-regular fa-quote-left';
        }
        card.classList.toggle('is-quote-queued', isQueued);
    }

    function refreshAllButtonStates() {
        var byId = new Map(queue.map(function (q) { return [q.postId, true]; }));
        document.querySelectorAll('.post-card[data-post-id]').forEach(function (card) {
            var pid = card.getAttribute('data-post-id');
            setButtonQueued(card, byId.has(pid));
        });
    }

    // --- Floating bar --------------------------------------------------
    function ensureBar() {
        if (barEl) return barEl;
        barEl = document.createElement('div');
        barEl.className = 'quote-queue-bar';
        barEl.setAttribute('role', 'region');
        barEl.setAttribute('aria-label', 'Quote queue');
        document.body.appendChild(barEl);
        return barEl;
    }

    function render() {
        if (queue.length === 0) {
            if (barEl) {
                barEl.classList.remove('is-visible');
                setTimeout(function () {
                    if (queue.length === 0 && barEl && barEl.parentNode) {
                        barEl.remove();
                        barEl = null;
                    }
                }, 200);
            }
            return;
        }

        ensureBar();
        var chipsHtml = queue.map(function (q) {
            return '<button type="button" class="quote-queue-chip" ' +
                   'data-post-id="' + Utils.escapeHtml(q.postId) + '" ' +
                   'title="Remove ' + Utils.escapeHtml(q.author) + '">' +
                   '<span class="quote-queue-chip-author">' + Utils.escapeHtml(q.author) + '</span>' +
                   '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
                   '</button>';
        }).join('');

        barEl.innerHTML =
            '<div class="quote-queue-inner">' +
                '<div class="quote-queue-lead">' +
                    '<i class="fa-regular fa-quote-left" aria-hidden="true"></i>' +
                    '<span class="quote-queue-count">' + queue.length +
                        ' ' + (queue.length === 1 ? 'post' : 'posts') + ' queued</span>' +
                '</div>' +
                '<div class="quote-queue-chips">' + chipsHtml + '</div>' +
                '<div class="quote-queue-actions">' +
                    '<button type="button" class="modern-btn modern-btn-primary" data-action="insert">' +
                        '<i class="fa-regular fa-arrow-up-from-bracket" aria-hidden="true"></i> Insert quotes' +
                    '</button>' +
                    '<button type="button" class="modern-btn modern-btn-secondary" data-action="clear">Clear</button>' +
                '</div>' +
            '</div>';

        barEl.querySelectorAll('.quote-queue-chip').forEach(function (chip) {
            chip.addEventListener('click', function (e) {
                e.preventDefault();
                removeById(chip.getAttribute('data-post-id'));
            });
        });
        barEl.querySelector('[data-action="insert"]').addEventListener('click', insertAll);
        barEl.querySelector('[data-action="clear"]').addEventListener('click', clear);

        requestAnimationFrame(function () { barEl.classList.add('is-visible'); });
    }

    // --- Public toggle / remove / clear --------------------------------
    function add(card) {
        var data = extractFromCard(card);
        if (!data) return;
        if (queue.some(function (q) { return q.postId === data.postId; })) return;
        if (queue.length >= MAX_ITEMS) {
            if (window.MessengerModule && window.MessengerModule.showToast) {
                // fall through to plain toast
            }
            console.warn('[QuoteQueue] limit reached');
            return;
        }
        queue.push(data);
        save();
        setButtonQueued(card, true);
        render();
    }

    function removeById(postId) {
        var idx = queue.findIndex(function (q) { return q.postId === postId; });
        if (idx === -1) return;
        queue.splice(idx, 1);
        save();
        var card = document.querySelector('.post-card[data-post-id="' + postId + '"]');
        if (card) setButtonQueued(card, false);
        render();
    }

    function clear() {
        queue = [];
        save();
        refreshAllButtonStates();
        render();
    }

    function toggle(card) {
        var pid = card.getAttribute('data-post-id');
        if (!pid) return;
        if (queue.some(function (q) { return q.postId === pid; })) {
            removeById(pid);
        } else {
            add(card);
        }
    }

    function getQueuedPostElements() {
        // Resolve each queued id back to its legacy .post element —
        // EditorModule.startQuoteBatch works on the legacy elements
        // (which still have the CODE=02 quote links).
        return queue.map(function (q) {
            return document.getElementById('ee' + q.postId);
        }).filter(Boolean);
    }

    // --- Insert all into the fast reply editor (or navigate) -----------
    async function insertAll() {
        if (queue.length === 0) return;

        var EM = window.EditorModule;
        var postEls = getQueuedPostElements();

        // Fast reply editor present on this page — use the batch API.
        var fastReplyHost = document.getElementById('modern-editor-fastreply');
        var editorInst = fastReplyHost && fastReplyHost.__editorInstance;

        if (editorInst && EM && typeof EM.startQuoteBatch === 'function') {
            try {
                await EM.startQuoteBatch(postEls);
                clear();
                fastReplyHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (err) {
                console.error('[QuoteQueue] Batch insert failed:', err);
            }
            return;
        }

        // No editor here — fall back to navigation. The first quote comes
        // through the normal CODE=02 request; the rest ride along in
        // sessionStorage and get picked up on the reply page.
        var first = queue[0];
        try {
            sessionStorage.setItem('ff-pending-quotes-v1',
                JSON.stringify(queue.map(function (q) { return q.postId; })));
        } catch (e) {}

        if (first && first.url) {
            window.location.href = first.url;
        }
    }

    // --- Init ----------------------------------------------------------
    function initialize() {
        if (isInitialized) return;
        isInitialized = true;

        load();
        refreshAllButtonStates();
        render();

        // Quote button click → toggle queue (replaces the direct
        // EditorModule.startQuote call in posts.js).
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.action-icon[data-action="quote"]');
            if (!btn) return;
            var card = btn.closest('.post-card');
            if (!card) return;
            // Only intercept when EditorModule is available — otherwise
            // let the legacy fallback in posts.js handle it.
            if (!window.EditorModule) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            toggle(card);
        }, true);   // capture phase — beats posts.js's own handler

        // Refresh button states when new cards appear.
        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
            try {
                var id = globalThis.forumObserver.register({
                    id: 'quote-queue-cards',
                    selector: '.post-card[data-post-id]',
                    priority: 'low',
                    callback: refreshAllButtonStates
                });
                if (id) _observerIds.push(id);
            } catch (e) {}
        }

        // Expose for testing / external integrations.
        window.QuoteQueueModule = {
            toggle: toggle,
            clear: clear,
            insertAll: insertAll,
            count: function () { return queue.length; }
        };

        console.log('[QuoteQueue] Initialized with', queue.length, 'queued');
    }

    return { initialize: initialize };

})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils);
