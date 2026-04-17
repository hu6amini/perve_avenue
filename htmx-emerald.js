(function() {
    'use strict';

    const CONFIG = {
        STORAGE_KEY: 'forumModernView',
        CONTAINER: '#posts-container',
        POST_SELECTOR: '.post',
        MODERN_CLASS: 'modern-view-active'
    };

    let isModern = false;

    function log(...args) { console.log('[ForumModernizer]', ...args); }

    // Core: Convert one classic post → modern card (your existing logic, kept minimal)
    function convertPost($post) {
        const postId = $post.attr('id');
        if (!postId || $(`.post-card[data-original-id="${postId}"]`).length) return;

        const data = extractPostData($post); // ← keep your extractPostData function
        if (!data) return;

        const modernHtml = generateModernPost(data); // ← keep your generateModernPost
        $post.after(modernHtml);
    }

    // Toggle view using htmx + idiomorph for smooth transition
    window.toggleView = function(view) {
        isModern = (view === 'modern');
        localStorage.setItem(CONFIG.STORAGE_KEY, view);

        const $container = $(CONFIG.CONTAINER);
        
        // Add a class that can drive CSS if needed
        document.documentElement.classList.toggle(CONFIG.MODERN_CLASS, isModern);

        // Process any new/unprocessed posts
        $container.find(CONFIG.POST_SELECTOR).each(function() {
            convertPost($(this));
        });

        // Use idiomorph swap on the container for intelligent diffing
        // This is the htmx magic: smooth updates, preserves focus etc.
        htmx.trigger(CONFIG.CONTAINER, 'htmx:morph', {
            target: $container[0],
            swap: isModern ? 'morph:innerHTML' : 'innerHTML'  // fallback for classic
        });

        // Update UI
        $('#modern-btn').toggleClass('active', isModern);
        $('#classic-btn').toggleClass('active', !isModern);
        $('#view-status').html(`<i class="fas fa-info-circle"></i> ${isModern ? 'Modern' : 'Classic'} view active`);
    };

    // Setup htmx handlers declaratively where possible
    function setupHtmx() {
        // Auto-convert posts when htmx loads new content
        htmx.onLoad(function(target) {
            $(target).find(CONFIG.POST_SELECTOR).each(function() {
                convertPost($(this));
            });
            if ($(target).is(CONFIG.POST_SELECTOR)) convertPost($(target));
        });

        // After any swap, ensure correct visibility based on current view
        document.addEventListener('htmx:afterSwap', (evt) => {
            if (isModern) {
                $(evt.detail.target).find(CONFIG.POST_SELECTOR).hide();
                $(evt.detail.target).find('.post-card').show();
            }
        });

        // Optional: Use hx-swap-oob if you ever return multiple fragments from server
    }

    // Restore saved view on load (with htmx readiness)
    function restoreView() {
        const saved = localStorage.getItem(CONFIG.STORAGE_KEY) || 'classic';
        log(`Restoring view: ${saved}`);
        toggleView(saved);
    }

    // Initialize with proper timing
    function init() {
        log('Forum Modernizer (htmx-first) starting...');

        // Process initial posts
        $(CONFIG.CONTAINER).find(CONFIG.POST_SELECTOR).each(function() {
            convertPost($(this));
        });

        setupHtmx();

        // Restore after a short delay to let htmx settle
        setTimeout(restoreView, 150);

        log('Initialization complete – now using idiomorph + declarative htmx');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
