// Twemoji Module - replaces custom emojis with Twemoji

'use strict';

var TwemojiModule = (function() {
    'use strict';

    // ===== USER TIMING: mark start =====
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('twemoji-start');
    }
    // ====================================

    const EMOJI_MAP = new Map([ 
        ['https://img.forumfree.net/html/emoticons/new/heart.svg', '2764.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/flame.svg', '1f525.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/stars.svg', '1f929.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/thumbup.svg', '1f44d.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/thumbdown.svg', '1f44e.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/w00t.svg', '1f92f.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/happy.svg', '1f60a.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/biggrin.svg', '1f600.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/bigsmile.svg', '1f603.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/smile.svg', '1f642.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/wink.svg', '1f609.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/tongue.svg', '1f61b.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/blep.svg', '1f61c.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/bleh.svg', '1f61d.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/laugh.svg', '1f606.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/haha.svg', '1f602.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/rotfl.svg', '1f923.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/hearts.svg', '1f60d.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/love.svg', '1f970.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/wub.svg', '1f60b.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/kiss.svg', '1f618.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/blush.svg', '263a.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/joy.svg', '1f60f.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/cool.svg', '1f60e.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/sad.svg', '1f641.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/cry.svg', '1f622.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/bigcry.svg', '1f62d.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/mad.svg', '1f620.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/dry.svg', '1f612.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/disgust.svg', '1f611.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/doh.svg', '1f623.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/neutral.svg', '1f610.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/unsure.svg', '1f615.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/mouthless.svg', '1f636.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/think.svg', '1f914.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/huh.svg', '1f928.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/ohmy.svg', '1f62f.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/rolleyes.svg', '1f644.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/sleep.svg', '1f634.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/sick.svg', '1f922.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/distraught.svg', '1f626.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/squint.svg', '1f62c.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/wacko.svg', '1f92a.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/upside.svg', '1f643.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/ph34r.svg', '1f977.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/alien.svg', '1f47d.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/shifty.svg', '1f608.svg'], 
        ['https://img.forumfree.net/html/emoticons/new/blink.svg', '1f440.svg'] 
    ]);

    const TWEMOJI_CONFIG = { 
        folder: 'svg',
        ext: '.svg',
        base: 'https://twemoji.maxcdn.com/v/latest/',
        className: 'twemoji',
        size: 'svg'
    };

    const PROCESSED_CLASS = 'twemoji-processed';
    const TWEMOJI_BASE_URL = TWEMOJI_CONFIG.base + 'svg/';

    let initialized = false;

    function shouldSkipContainer(container) {
        if (!container) return false;
        if (container.closest && container.closest('.ve-emoji-dropdown')) return true;
        if (container.closest && container.closest('.ve-content.color')) return true;
        if (container.matches) {
            if (container.matches('.ve-emoji-dropdown, .ve-content.color')) return true;
        }
        if (container.closest && container.closest('[contenteditable="true"]')) return true;
        if (container.getAttribute && container.getAttribute('contenteditable') === 'true') return true;
        return false;
    }

    function getEmojiSelectors(src) {
        return [
            'img[src="' + src + '"]:not(.' + PROCESSED_CLASS + ')',
            'img[data-emoticon-url="' + src + '"]:not(.' + PROCESSED_CLASS + ')',
            'img[data-emoticon-preview="' + src + '"]:not(.' + PROCESSED_CLASS + ')'
        ];
    }

    function replaceCustomEmojis(container, sync) {
        if (shouldSkipContainer(container)) return;
        if (!container || !container.querySelectorAll) return;

        // Replace custom SVG emojis (always synchronous)
        for (const [oldSrc, newFile] of EMOJI_MAP) {
            const selectors = getEmojiSelectors(oldSrc);
            for (const selector of selectors) {
                const imgs = container.querySelectorAll(selector);
                for (let i = 0; i < imgs.length; i++) {
                    const img = imgs[i];
                    if (shouldSkipContainer(img)) continue;
                    const originalAttrs = {
                        src: img.src,
                        alt: img.alt,
                        dataEmoticonUrl: img.getAttribute('data-emoticon-url'),
                        dataEmoticonPreview: img.getAttribute('data-emoticon-preview'),
                        dataText: img.getAttribute('data-text')
                    };
                    img.src = TWEMOJI_BASE_URL + newFile;
                    img.classList.add('twemoji', PROCESSED_CLASS);
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    if (originalAttrs.dataEmoticonUrl) img.setAttribute('data-emoticon-url', originalAttrs.dataEmoticonUrl);
                    if (originalAttrs.dataEmoticonPreview) img.setAttribute('data-emoticon-preview', originalAttrs.dataEmoticonPreview);
                    if (originalAttrs.dataText) img.setAttribute('data-text', originalAttrs.dataText);
                    if (originalAttrs.alt) img.alt = originalAttrs.alt;
                    img.onerror = function() {
                        console.warn('Failed to load emoji: ' + newFile);
                        this.src = originalAttrs.src;
                        this.classList.remove(PROCESSED_CLASS);
                        if (originalAttrs.dataEmoticonUrl) this.setAttribute('data-emoticon-url', originalAttrs.dataEmoticonUrl);
                        if (originalAttrs.dataEmoticonPreview) this.setAttribute('data-emoticon-preview', originalAttrs.dataEmoticonPreview);
                        if (originalAttrs.dataText) this.setAttribute('data-text', originalAttrs.dataText);
                        if (originalAttrs.alt) this.alt = originalAttrs.alt;
                    };
                }
            }
        }

        // Replace Unicode emojis using Twemoji
        if (window.twemoji && window.twemoji.parse) {
            if (!shouldSkipContainer(container)) {
                if (sync === true) {
                    // Run synchronously (blocking) – used for initial replacement
                    twemoji.parse(container, TWEMOJI_CONFIG);
                } else {
                    // Async (deferred) – used for dynamic callbacks to avoid blocking
                    if (typeof requestIdleCallback !== 'undefined') {
                        requestIdleCallback(function() {
                            if (!shouldSkipContainer(container)) {
                                twemoji.parse(container, TWEMOJI_CONFIG);
                            }
                        }, { timeout: 1000 });
                    } else {
                        setTimeout(function() {
                            if (!shouldSkipContainer(container)) {
                                twemoji.parse(container, TWEMOJI_CONFIG);
                            }
                        }, 0);
                    }
                }
            }
        }
    }

    function initEmojiReplacement() {
        // Perform initial replacement SYNCHRONOUSLY – this ensures all Unicode emojis are
        // converted to <img> tags before posts.js clones the content.
        replaceCustomEmojis(document.body, true);

        // Register asynchronous callbacks for future dynamic content
        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
            globalThis.forumObserver.register({
                id: 'emoji-replacer-picker',
                callback: function(node) { replaceCustomEmojis(node, false); },
                selector: '.picker-custom-grid, .picker-custom-item, .image-thumbnail, .ve-emoji-list',
                priority: 'high',
                pageTypes: ['topic', 'blog', 'search', 'forum']
            });
            globalThis.forumObserver.register({
                id: 'emoji-replacer-content',
                callback: function(node) { replaceCustomEmojis(node, false); },
                selector: '.post, .article, .content, .reply, .comment, .color, td[align], div[align]',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'search', 'forum']
            });
            globalThis.forumObserver.register({
                id: 'emoji-replacer-quotes',
                callback: function(node) { replaceCustomEmojis(node, false); },
                selector: '.quote, .code, .spoiler, .modern-quote, .modern-spoiler',
                priority: 'normal'
            });
            globalThis.forumObserver.register({
                id: 'emoji-replacer-user-content',
                callback: function(node) { replaceCustomEmojis(node, false); },
                selector: '.signature, .user-info, .profile-content, .post-content',
                priority: 'low'
            });
            console.log('Emoji replacer fully integrated with ForumCoreObserver');

            // Also process any existing emoji picker immediately (synchronously)
            setTimeout(function() {
                const pickerGrid = document.querySelector('.picker-custom-grid');
                if (pickerGrid && !shouldSkipContainer(pickerGrid)) {
                    replaceCustomEmojis(pickerGrid, true);
                    console.log('Found existing emoji picker, processed synchronously');
                }
            }, 500);
        } else {
            console.error('ForumCoreObserver not available - emoji replacement disabled');
        }
    }

    async function waitForTwemoji() {
        if (typeof twemoji !== 'undefined') return true;
        return new Promise((resolve) => {
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (typeof twemoji !== 'undefined') {
                    clearInterval(interval);
                    resolve(true);
                } else if (attempts >= 100) { // 10 seconds max
                    clearInterval(interval);
                    console.warn('Twemoji not loaded after 10 seconds, proceeding without it');
                    resolve(false);
                }
            }, 100);
        });
    }

    async function waitForForumObserver() {
        if (globalThis.forumObserver) return true;
        return new Promise((resolve) => {
            const handler = () => {
                window.removeEventListener('forum-observer-ready', handler);
                resolve(true);
            };
            window.addEventListener('forum-observer-ready', handler);
            setTimeout(() => {
                window.removeEventListener('forum-observer-ready', handler);
                console.warn('ForumObserver not ready after 5 seconds, proceeding anyway');
                resolve(false);
            }, 5000);
        });
    }

    async function initialize() {
        if (initialized) return;
        console.log('TwemojiModule initializing...');
        await waitForTwemoji();
        await waitForForumObserver();
        initEmojiReplacement();
        initialized = true;
        console.log('TwemojiModule ready');

        // ===== USER TIMING: mark ready and measure =====
        if (typeof performance !== 'undefined' && performance.mark) {
            performance.mark('twemoji-ready');
            try {
                performance.measure('twemoji-load-time', 'twemoji-start', 'twemoji-ready');
            } catch (e) {
                // Ignore if marks missing
            }
        }
        // ================================================

        // Expose helper on window for external use
        window.emojiReplacer = {
            replace: function(container) { replaceCustomEmojis(container, false); },
            replaceSync: function(container) { replaceCustomEmojis(container, true); },
            init: initEmojiReplacement,
            isReady: function() { return !!window.twemoji; },
            forcePickerUpdate: function() {
                const pickerGrid = document.querySelector('.picker-custom-grid');
                if (pickerGrid && !shouldSkipContainer(pickerGrid)) {
                    replaceCustomEmojis(pickerGrid, true);
                    return true;
                }
                return false;
            },
            shouldSkip: shouldSkipContainer
        };
    }

    return {
        initialize: initialize,
        name: 'twemoji',
        dependencies: ['twemojiLib', 'forumObserver']
    };
})();
