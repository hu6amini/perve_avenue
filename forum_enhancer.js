// Ultra-Optimized Media Dimension Extractor
'use strict';

class MediaDimensionExtractor {
    #observerId = null;
    #processedMedia = new WeakSet();
    #dimensionCache = new Map();
    #cacheHits = 0;
    #cacheMisses = 0;
    #MAX_CACHE_SIZE = 500;
    #resizeObserver = null;
    #ABORT_DELAY = 5000; // 5 seconds timeout for image loading

    // Static lookups for better performance
    static #IFRAME_SIZES = new Map([
        ['youtube', ['560', '315']],
        ['youtu', ['560', '315']],
        ['vimeo', ['640', '360']],
        ['soundcloud', ['100%', '166']],
        ['twitter', ['550', '400']],
        ['x.com', ['550', '400']]
    ]);

    static #EMOJI_DOMAINS = new Set(['twemoji', 'emoji', 'smiley']);
    static #SMALL_CONTEXTS = new Set(['modern-quote', 'quote-content', 'modern-spoiler', 'spoiler-content', 'signature', 'post-signature']);

    constructor() {
        this.#init();
    }

    #init() {
        // Use microtask for immediate but non-blocking init
        queueMicrotask(() => {
            this.#setupObserver();
            this.#processAllMedia();
        });
    }

    #setupObserver() {
        if (!globalThis.forumObserver) {
            requestIdleCallback(() => this.#setupObserver(), { timeout: 100 });
            return;
        }

        this.#observerId = globalThis.forumObserver.register({
            id: 'media-dimension-extractor',
            callback: (node) => this.#processNode(node),
            selector: 'img, iframe, video',
            priority: 'high'
        });
    }

    #processAllMedia() {
        // Use documentFragment to batch DOM reads
        const fragment = document.createDocumentFragment();
        const selectors = ['img', 'iframe', 'video'];
        
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (!this.#processedMedia.has(element)) {
                    this.#processMedia(element);
                }
            }
        }
    }

    #processNode(node) {
        if (this.#processedMedia.has(node)) return;
        this.#processMedia(node);
    }

    #processMedia(element) {
        const tag = element.tagName;
        
        // Use bitwise OR for faster tag matching (ASCII codes)
        switch (tag) {
            case 'IMG': this.#processImage(element); break;
            case 'IFRAME': this.#processIframe(element); break;
            case 'VIDEO': this.#processVideo(element); break;
            default: this.#processNested(element);
        }
        
        this.#processedMedia.add(element);
    }

    #processNested(container) {
        // Fastest: querySelectorAll with comma-separated selectors
        const media = container.querySelectorAll('img, iframe, video');
        for (const element of media) {
            if (!this.#processedMedia.has(element)) {
                this.#processMedia(element);
            }
        }
    }

    #processImage(img) {
        // Check twemoji first (fast path)
        if (this.#isTwemoji(img)) {
            this.#setEmojiDimensions(img);
            return;
        }

        // Cache lookup
        const cached = this.#dimensionCache.get(img.src);
        if (cached) {
            this.#cacheHits++;
            this.#applyCachedDimensions(img, cached);
            return;
        }
        this.#cacheMisses++;

        // Validate existing dimensions
        if (this.#validateAndApplyExisting(img)) return;

        // Check for other emojis
        if (this.#isEmoji(img)) {
            this.#setEmojiDimensions(img);
            return;
        }

        // Handle image state
        this.#handleImageState(img);
    }

    #isTwemoji(img) {
        return img.classList.contains('twemoji') || img.src.includes('twemoji');
    }

    #isEmoji(img) {
        const src = img.src;
        const alt = img.alt || '';
        
        for (const domain of MediaDimensionExtractor.#EMOJI_DOMAINS) {
            if (src.includes(domain) || img.classList.contains(domain)) return true;
        }
        
        return alt.includes('emoji') || alt.includes('smiley');
    }

    #setEmojiDimensions(img) {
        const size = this.#isInSmallContext(img) ? 18 : 20;
        this.#setDimensions(img, size, size, true);
        this.#cacheDimension(img.src, size, size);
    }

    #isInSmallContext(img) {
        for (const context of MediaDimensionExtractor.#SMALL_CONTEXTS) {
            if (img.closest(`.${context}`)) return true;
        }
        return false;
    }

    #applyCachedDimensions(img, { width, height }) {
        if (!img.hasAttribute('width') || !img.hasAttribute('height')) {
            this.#setDimensions(img, width, height);
        }
    }

    #validateAndApplyExisting(img) {
        const widthAttr = img.getAttribute('width');
        const heightAttr = img.getAttribute('height');
        
        if (widthAttr === null || heightAttr === null) return false;
        
        const width = parseInt(widthAttr, 10);
        const height = parseInt(heightAttr, 10);
        
        if (width <= 0 || height <= 0) return false;

        // Validate against natural dimensions if available
        if (img.complete && img.naturalWidth) {
            const tolerance = 0.5; // 50% tolerance
            const wDiff = Math.abs(img.naturalWidth - width) / width;
            const hDiff = Math.abs(img.naturalHeight - height) / height;
            
            if (wDiff > tolerance || hDiff > tolerance) {
                this.#setDimensions(img, img.naturalWidth, img.naturalHeight);
                return true;
            }
        }

        img.style.aspectRatio = `${width} / ${height}`;
        return true;
    }

    #handleImageState(img) {
        if (img.complete && img.naturalWidth) {
            this.#setDimensions(img, img.naturalWidth, img.naturalHeight);
        } else if (!img.complete) {
            this.#setupImageLoadListener(img);
        } else {
            // Image with no natural dimensions (broken/loading)
            this.#setDimensions(img, 600, 400);
        }
    }

    #setupImageLoadListener(img) {
        if (img.__loadingAbortController) return;
        
        const controller = new AbortController();
        const { signal } = controller;
        img.__loadingAbortController = controller;
        
        // Set timeout to abort loading attempt
        const timeoutId = setTimeout(() => {
            controller.abort();
            this.#setDimensions(img, 600, 400);
        }, this.#ABORT_DELAY);

        const cleanup = () => {
            clearTimeout(timeoutId);
            delete img.__loadingAbortController;
        };

        img.addEventListener('load', (e) => {
            cleanup();
            if (img.naturalWidth) {
                this.#setDimensions(img, img.naturalWidth, img.naturalHeight);
            }
        }, { signal, once: true });

        img.addEventListener('error', (e) => {
            cleanup();
            this.#setDimensions(img, 600, 400);
        }, { signal, once: true });

        // Prevent layout shift
        Object.assign(img.style, {
            maxWidth: '100%',
            height: 'auto',
            contentVisibility: 'auto'
        });
    }

    #setDimensions(element, width, height, force = false) {
        if (force || !element.hasAttribute('width')) {
            element.setAttribute('width', width);
        }
        if (force || !element.hasAttribute('height')) {
            element.setAttribute('height', height);
        }
        element.style.aspectRatio = `${width} / ${height}`;
        
        // Cache dimensions
        if (element.src) {
            this.#cacheDimension(element.src, width, height);
        }
    }

    #cacheDimension(src, width, height) {
        if (this.#dimensionCache.size >= this.#MAX_CACHE_SIZE) {
            // Remove first (oldest) entry - FIFO is simpler than LRU
            const firstKey = this.#dimensionCache.keys().next().value;
            if (firstKey) this.#dimensionCache.delete(firstKey);
        }
        
        this.#dimensionCache.set(src, { width, height, timestamp: Date.now() });
    }

    #processIframe(iframe) {
        const src = iframe.src || '';
        let width = '100%';
        let height = '400';

        // Fast domain lookup
        for (const [domain, sizes] of MediaDimensionExtractor.#IFRAME_SIZES) {
            if (src.includes(domain)) {
                [width, height] = sizes;
                break;
            }
        }

        iframe.setAttribute('width', width);
        iframe.setAttribute('height', height);

        // Create responsive wrapper for fixed sizes
        if (width !== '100%') {
            const widthNum = parseInt(width, 10);
            const heightNum = parseInt(height, 10);
            
            if (widthNum > 0 && heightNum > 0 && !iframe.closest('.iframe-wrapper')) {
                const wrapper = document.createElement('div');
                wrapper.className = 'iframe-wrapper';
                wrapper.style.cssText = `
                    position: relative;
                    width: 100%;
                    padding-bottom: ${(heightNum / widthNum) * 100}%;
                    overflow: hidden;
                `;
                
                iframe.before(wrapper);
                wrapper.append(iframe);
                
                Object.assign(iframe.style, {
                    position: 'absolute',
                    top: '0',
                    left: '0',
                    width: '100%',
                    height: '100%',
                    border: '0'
                });
            }
        }

        if (!iframe.hasAttribute('title')) {
            iframe.setAttribute('title', 'Embedded content');
        }
    }

    #processVideo(video) {
        if (!video.hasAttribute('controls')) {
            video.setAttribute('controls', '');
        }

        if (!video.style.width) {
            Object.assign(video.style, {
                width: '100%',
                maxWidth: '800px',
                height: 'auto'
            });
        }
    }

    #cleanup() {
        if (globalThis.forumObserver && this.#observerId) {
            globalThis.forumObserver.unregister(this.#observerId);
        }

        // Clean up abort controllers
        const images = document.images;
        for (const img of images) {
            if (img.__loadingAbortController) {
                img.__loadingAbortController.abort();
                delete img.__loadingAbortController;
            }
        }

        this.#resizeObserver?.disconnect();
    }

    // Public API
    extractDimensionsForElement(element) {
        if (!element) return;
        queueMicrotask(() => this.#processNested(element));
    }

    getPerformanceStats() {
        const total = this.#cacheHits + this.#cacheMisses;
        const hitRate = total > 0 ? (this.#cacheHits / total * 100).toFixed(1) : 0;

        return {
            cacheHits: this.#cacheHits,
            cacheMisses: this.#cacheMisses,
            cacheHitRate: `${hitRate}%`,
            cacheSize: this.#dimensionCache.size,
            processedMedia: this.#processedMedia.size,
            memory: this.#getMemoryEstimate()
        };
    }

    #getMemoryEstimate() {
        if (!performance.memory) return 'N/A';
        return `${Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)}MB`;
    }

    destroy() {
        this.#cleanup();
        console.log('Media Dimension Extractor destroyed', this.getPerformanceStats());
    }
}

// ============================================
// INITIALIZATION
// ============================================

if (!globalThis.mediaDimensionExtractor) {
    const init = () => {
        try {
            globalThis.mediaDimensionExtractor = new MediaDimensionExtractor();
        } catch (error) {
            console.error('MediaDimensionExtractor initialization failed:', error);
            requestIdleCallback(init, { timeout: 100 });
        }
    };

    // Use defer attribute, no need for DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        queueMicrotask(init);
    }
}

// Cleanup on pagehide
globalThis.addEventListener('pagehide', () => {
    if (globalThis.mediaDimensionExtractor) {
        requestIdleCallback(() => {
            globalThis.mediaDimensionExtractor.destroy();
            delete globalThis.mediaDimensionExtractor;
        }, { timeout: 100 });
    }
});

//Twemoji
twemoji.parse(document.body,{folder:"svg",ext:".svg",base:"https://twemoji.maxcdn.com/v/latest/",className:"twemoji",size:"svg"});

//Default emojis to Twemoji
(function() {
    'use strict';
    
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
    
    function getEmojiSelectors(src) {
        return [
            'img[src="' + src + '"]:not(.' + PROCESSED_CLASS + ')',
            'img[data-emoticon-url="' + src + '"]:not(.' + PROCESSED_CLASS + ')',
            'img[data-emoticon-preview="' + src + '"]:not(.' + PROCESSED_CLASS + ')'
        ];
    }
    
    function replaceCustomEmojis(container) {
        if (!container || !container.querySelectorAll) return;
        
        for (const [oldSrc, newFile] of EMOJI_MAP) {
            const selectors = getEmojiSelectors(oldSrc);
            
            for (const selector of selectors) {
                const imgs = container.querySelectorAll(selector);
                
                for (let i = 0; i < imgs.length; i++) {
                    const img = imgs[i];
                    
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
                    
                    if (originalAttrs.dataEmoticonUrl) {
                        img.setAttribute('data-emoticon-url', originalAttrs.dataEmoticonUrl);
                    }
                    if (originalAttrs.dataEmoticonPreview) {
                        img.setAttribute('data-emoticon-preview', originalAttrs.dataEmoticonPreview);
                    }
                    if (originalAttrs.dataText) {
                        img.setAttribute('data-text', originalAttrs.dataText);
                    }
                    if (originalAttrs.alt) {
                        img.alt = originalAttrs.alt;
                    }
                    
                    img.onerror = function() {
                        console.warn('Failed to load emoji: ' + newFile);
                        this.src = originalAttrs.src;
                        this.classList.remove(PROCESSED_CLASS);
                        
                        if (originalAttrs.dataEmoticonUrl) {
                            this.setAttribute('data-emoticon-url', originalAttrs.dataEmoticonUrl);
                        }
                        if (originalAttrs.dataEmoticonPreview) {
                            this.setAttribute('data-emoticon-preview', originalAttrs.dataEmoticonPreview);
                        }
                        if (originalAttrs.dataText) {
                            this.setAttribute('data-text', originalAttrs.dataText);
                        }
                        if (originalAttrs.alt) {
                            this.alt = originalAttrs.alt;
                        }
                    };
                }
            }
        }
        
        if (window.twemoji && window.twemoji.parse) {
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(function() {
                    twemoji.parse(container, TWEMOJI_CONFIG);
                }, { timeout: 1000 });
            } else {
                setTimeout(function() {
                    twemoji.parse(container, TWEMOJI_CONFIG);
                }, 0);
            }
        }
    }
    
    function initEmojiReplacement() {
        replaceCustomEmojis(document.body);
        
        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
            globalThis.forumObserver.register({
                id: 'emoji-replacer-picker',
                callback: replaceCustomEmojis,
                selector: '.picker-custom-grid, .picker-custom-item, .image-thumbnail',
                priority: 'high',
                pageTypes: ['topic', 'blog', 'search', 'forum']
            });
            
            globalThis.forumObserver.register({
                id: 'emoji-replacer-content',
                callback: replaceCustomEmojis,
                selector: '.post, .article, .content, .reply, .comment, .color, td[align], div[align]',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'search', 'forum']
            });
            
            globalThis.forumObserver.register({
                id: 'emoji-replacer-quotes',
                callback: replaceCustomEmojis,
                selector: '.quote, .code, .spoiler, .modern-quote, .modern-spoiler',
                priority: 'normal'
            });
            
            globalThis.forumObserver.register({
                id: 'emoji-replacer-user-content',
                callback: replaceCustomEmojis,
                selector: '.signature, .user-info, .profile-content, .post-content',
                priority: 'low'
            });
            
            console.log('Emoji replacer fully integrated with ForumCoreObserver');
            
            setTimeout(function() {
                const pickerGrid = document.querySelector('.picker-custom-grid');
                if (pickerGrid) {
                    console.log('Found existing emoji picker, processing...');
                    replaceCustomEmojis(pickerGrid);
                }
            }, 500);
            
        } else {
            console.error('ForumCoreObserver not available - emoji replacement disabled');
        }
    }
    
    function checkAndInit() {
        if (window.twemoji) {
            initEmojiReplacement();
            return;
        }
        
        var checkInterval = setInterval(function() {
            if (window.twemoji) {
                clearInterval(checkInterval);
                initEmojiReplacement();
            }
        }, 100);
        
        setTimeout(function() {
            clearInterval(checkInterval);
            if (!window.twemoji) {
                console.warn('Twemoji not loaded after 5 seconds, proceeding without it');
                initEmojiReplacement();
            }
        }, 5000);
    }
    
    function startInitialization() {
        if (typeof queueMicrotask !== 'undefined') {
            queueMicrotask(checkAndInit);
        } else {
            setTimeout(checkAndInit, 0);
        }
    }
    
    if (document.readyState === 'loading') {
        document.onreadystatechange = function() {
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                document.onreadystatechange = null;
                startInitialization();
            }
        };
    } else {
        startInitialization();
    }
    
    window.emojiReplacer = {
        replace: replaceCustomEmojis,
        init: initEmojiReplacement,
        isReady: function() { return !!window.twemoji; },
        forcePickerUpdate: function() {
            const pickerGrid = document.querySelector('.picker-custom-grid');
            if (pickerGrid) {
                console.log('Force-updating emoji picker...');
                replaceCustomEmojis(pickerGrid);
                return true;
            }
            return false;
        }
    };
    
    document.addEventListener('click', function(e) {
        const target = e.target;
        const isLikelyEmojiTrigger = target.matches(
            '[onclick*="emoticon"], [onclick*="smiley"], ' +
            '.emoticon-btn, .smiley-btn, button:has(img[src*="emoticon"])'
        );
        
        if (isLikelyEmojiTrigger) {
            setTimeout(function() {
                window.emojiReplacer.forcePickerUpdate();
            }, 300);
        }
    }, { passive: true });
    
})();



// Enhanced Post Transformation and Modernization System with CSS-First Image Fixes
// Now includes CSS-first image dimension handling, optimized DOM updates,
// enhanced accessibility, and modern code blocks
class PostModernizer {
    #postModernizerId = null;
    #activeStateObserverId = null;
    #debouncedObserverId = null;
    #cleanupObserverId = null;
    #searchPostObserverId = null;
    #quoteLinkObserverId = null;
    #codeBlockObserverId = null;
    #retryTimeoutId = null;
    #maxRetries = 10;
    #retryCount = 0;
    #domUpdates = new WeakMap();
    #rafPending = false;

    constructor() {
        this.#initWithRetry();
    }

    #initWithRetry() {
        if (this.#retryTimeoutId) {
            clearTimeout(this.#retryTimeoutId);
            this.#retryTimeoutId = null;
        }

        if (!globalThis.forumObserver) {
            if (this.#retryCount < this.#maxRetries) {
                this.#retryCount++;
                const delay = Math.min(100 * Math.pow(1.5, this.#retryCount - 1), 2000);
                console.log(`Forum Observer not available, retry ${this.#retryCount}/${this.#maxRetries} in ${delay}ms`);

                this.#retryTimeoutId = setTimeout(() => {
                    this.#initWithRetry();
                }, delay);
            } else {
                console.error('Failed to initialize Post Modernizer: Forum Observer not available after maximum retries');
            }
            return;
        }

        this.#retryCount = 0;
        this.#init();
    }

    #init() {
        try {
            this.#transformPostElements();
            this.#enhanceReputationSystem();
            this.#setupObserverCallbacks();
            this.#setupActiveStateObserver();
            this.#setupSearchPostObserver();
            this.#setupEnhancedAnchorNavigation();
            this.#enhanceQuoteLinks();
            this.#modernizeCodeBlocks();

            console.log('✅ Post Modernizer with all optimizations initialized');
        } catch (error) {
            console.error('Post Modernizer initialization failed:', error);

            if (this.#retryCount < this.#maxRetries) {
                this.#retryCount++;
                const delay = 100 * Math.pow(2, this.#retryCount - 1);
                console.log(`Initialization failed, retrying in ${delay}ms...`);

                setTimeout(() => {
                    this.#initWithRetry();
                }, delay);
            }
        }
    }

    #setupObserverCallbacks() {
        this.#cleanupObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-cleanup',
            callback: (node) => this.#handleCleanupTasks(node),
            selector: '.bullet_delete, .mini_buttons.points.Sub',
            priority: 'critical'
        });

        this.#debouncedObserverId = globalThis.forumObserver.registerDebounced({
            id: 'post-modernizer-transform',
            callback: (node) => this.#handlePostTransformation(node),
            selector: '.post, .st-emoji, .title2.bottom, div[align="center"]:has(.quote_top), div.spoiler[align="center"], div[align="center"]:has(.code_top)',
            delay: 100,
            priority: 'normal',
            pageTypes: ['topic', 'blog']
        });
    }

    #setupSearchPostObserver() {
        this.#searchPostObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-search-posts',
            callback: (node) => this.#handleSearchPostTransformation(node),
            selector: 'body#search .post, body#search li.post',
            priority: 'high',
            pageTypes: ['search']
        });
    }

    #setupActiveStateObserver() {
        this.#activeStateObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-active-states',
            callback: (node) => this.#handleActiveStateMutations(node),
            selector: '.st-emoji-container, .mini_buttons.points.Sub .points',
            priority: 'normal'
        });

        this.#checkInitialActiveStates();
    }

    #checkInitialActiveStates() {
        const emojiContainers = document.querySelectorAll('.st-emoji-container');
        emojiContainers.forEach(container => this.#updateEmojiContainerActiveState(container));

        const pointsContainers = document.querySelectorAll('.mini_buttons.points.Sub .points');
        pointsContainers.forEach(container => this.#updatePointsContainerActiveState(container));
    }

    #handleActiveStateMutations(node) {
        if (!node) return;

        let hasEmojiChanges = false;
        let hasPointsChanges = false;

        if (node.matches('.st-emoji-container') || node.querySelector('.st-emoji-container')) {
            hasEmojiChanges = true;
        }

        if (node.matches('.points') || node.querySelector('.points em')) {
            hasPointsChanges = true;
        }

        if (node.matches('.st-emoji-counter') ||
            (node.textContent && node.textContent.trim && !isNaN(node.textContent.trim()) && node.textContent.trim() !== '0')) {
            hasEmojiChanges = true;
        }

        if (hasEmojiChanges) {
            this.#updateAllEmojiActiveStates();
        }

        if (hasPointsChanges) {
            this.#updateAllPointsActiveStates();
        }
    }

    #updateAllEmojiActiveStates() {
        const emojiContainers = document.querySelectorAll('.st-emoji-container');
        emojiContainers.forEach(container => this.#updateEmojiContainerActiveState(container));
    }

    #updateAllPointsActiveStates() {
        const pointsContainers = document.querySelectorAll('.mini_buttons.points.Sub .points');
        pointsContainers.forEach(container => this.#updatePointsContainerActiveState(container));
    }

    #updateEmojiContainerActiveState(emojiContainer) {
        if (!emojiContainer) return;

        const emojiCounter = emojiContainer.querySelector('.st-emoji-counter');
        const hasCount = emojiCounter && (
            (emojiCounter.dataset && emojiCounter.dataset.count && emojiCounter.dataset.count !== '0') ||
            (emojiCounter.textContent && emojiCounter.textContent.trim && emojiCounter.textContent.trim() !== '0' &&
                !isNaN(emojiCounter.textContent.trim()))
        );

        emojiContainer.classList.toggle('active', !!hasCount);
    }

    #updatePointsContainerActiveState(pointsContainer) {
        if (!pointsContainer) return;

        const hasEm = pointsContainer.querySelector('em');
        pointsContainer.classList.toggle('active', !!hasEm);
    }

    #handleCleanupTasks(node) {
        if (!node) return;

        const needsCleanup = node.matches('.bullet_delete') ||
            (node.textContent && node.textContent.includes('&nbsp;')) ||
            /^\s*$/.test(node.textContent || '');

        if (needsCleanup) {
            this.#cleanupAllMiniButtons();
        }
    }

    #handlePostTransformation(node) {
        if (!node) return;

        const needsTransformation = node.matches('.post') ||
            node.querySelector('.post') ||
            node.querySelector('.st-emoji') ||
            node.querySelector('.title2.bottom') ||
            node.querySelector('div[align="center"]:has(.quote_top)') ||
            node.querySelector('div.spoiler[align="center"]') ||
            node.querySelector('div[align="center"]:has(.code_top)');

        if (needsTransformation) {
            this.#transformPostElements();
        }
    }

    #handleSearchPostTransformation(node) {
        if (!node) return;

        const needsTransformation = node.matches('body#search .post') ||
            node.matches('body#search li.post') ||
            node.querySelector('body#search .post') ||
            node.querySelector('body#search li.post');

        if (needsTransformation) {
            this.#transformSearchPostElements();
        }
    }

    #cleanupAllMiniButtons() {
        const miniButtons = document.querySelectorAll('.mini_buttons.points.Sub');
        miniButtons.forEach(buttons => this.#cleanupMiniButtons(buttons));
    }

    #transformPostElements() {
        const posts = document.querySelectorAll('body#topic .post:not(.post-modernized), body#blog .post:not(.post-modernized)');
        const urlParams = new URLSearchParams(window.location.search);
        const startOffset = parseInt(urlParams.get('st') || '0');

        posts.forEach((post, index) => {
            if (post.closest('body#search')) return;

            post.classList.add('post-modernized');

            // Use DocumentFragment for batch DOM operations
            const fragment = document.createDocumentFragment();

            // Extract and preserve anchor elements
            const anchorDiv = post.querySelector('.anchor');
            let anchorElements = null;
            if (anchorDiv) {
                anchorElements = anchorDiv.cloneNode(true);
                anchorDiv.remove();
            }

            const title2Top = post.querySelector('.title2.top');
            const miniButtons = title2Top ? title2Top.querySelector('.mini_buttons.points.Sub') : null;
            const stEmoji = title2Top ? title2Top.querySelector('.st-emoji.st-emoji-rep.st-emoji-post') : null;

            const postHeader = document.createElement('div');
            postHeader.className = 'post-header';

            const userInfo = document.createElement('div');
            userInfo.className = 'user-info';

            const postContent = document.createElement('div');
            postContent.className = 'post-content';

            const postFooter = document.createElement('div');
            postFooter.className = 'post-footer';

            // Add preserved anchor elements
            if (anchorElements) {
                const anchorContainer = document.createElement('div');
                anchorContainer.className = 'anchor-container';
                anchorContainer.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
                anchorContainer.appendChild(anchorElements);
                postHeader.appendChild(anchorContainer);
            }

            const postNumber = document.createElement('span');
            postNumber.className = 'post-number';
            postNumber.textContent = '#' + (startOffset + index + 1);
            postHeader.appendChild(postNumber);

            // Add NEW badge
            this.#addNewPostBadge(post, postHeader);

            let nickElement = null;
            let groupValue = '';

            if (title2Top) {
                const tdWrapper = title2Top.closest('td.left.Item');
                nickElement = title2Top.querySelector('.nick');

                if (tdWrapper) {
                    const title2TopClone = title2Top.cloneNode(true);
                    title2TopClone.querySelector('.mini_buttons.points.Sub')?.remove();
                    title2TopClone.querySelector('.st-emoji.st-emoji-rep.st-emoji-post')?.remove();
                    title2TopClone.querySelector('.left.Item')?.remove();
                    this.#removeBreakAndNbsp(title2TopClone);
                    postHeader.appendChild(title2TopClone);
                    tdWrapper.remove();
                } else {
                    const title2TopClone = title2Top.cloneNode(true);
                    title2TopClone.querySelector('.mini_buttons.points.Sub')?.remove();
                    title2TopClone.querySelector('.st-emoji.st-emoji-rep.st-emoji-post')?.remove();
                    title2TopClone.querySelector('.left.Item')?.remove();
                    this.#removeBreakAndNbsp(title2TopClone);
                    postHeader.appendChild(title2TopClone);
                }
            }

            const centerElements = post.querySelectorAll('tr.center');
            centerElements.forEach(centerElement => {
                const leftSection = centerElement.querySelector('.left.Item');
                const rightSection = centerElement.querySelector('.right.Item');

                if (leftSection) {
                    const details = leftSection.querySelector('.details');
                    const avatar = leftSection.querySelector('.avatar');

                    if (details && avatar) {
                        const groupDd = details.querySelector('dl.u_group dd');
                        groupValue = groupDd && groupDd.textContent ? groupDd.textContent.trim() : '';

                        userInfo.appendChild(avatar.cloneNode(true));

                        const detailsClone = details.cloneNode(true);
                        detailsClone.querySelector('.avatar')?.remove();

                        if (nickElement) {
                            const nickClone = nickElement.cloneNode(true);
                            detailsClone.insertBefore(nickClone, detailsClone.firstChild);

                            if (groupValue) {
                                const badge = document.createElement('div');
                                badge.className = 'badge';
                                badge.textContent = groupValue;
                                nickClone.parentNode.insertBefore(badge, nickClone.nextSibling);
                            }
                        }

                        detailsClone.querySelector('span.u_title')?.remove();

                        let rankHTML = '';
                        const pWithURank = detailsClone.querySelector('p');
                        if (pWithURank && pWithURank.querySelector('span.u_rank')) {
                            rankHTML = pWithURank.querySelector('span.u_rank')?.innerHTML || '';
                            pWithURank.remove();
                        }

                        detailsClone.querySelector('br.br_status')?.remove();

                        const userStats = document.createElement('div');
                        userStats.className = 'user-stats';

                        const originalDetails = details.cloneNode(true);

                        if (rankHTML) {
                            const rankStat = document.createElement('div');
                            rankStat.className = 'stat rank';
                            rankStat.innerHTML = rankHTML;
                            userStats.appendChild(rankStat);
                        }

                        const postsDd = originalDetails.querySelector('dl.u_posts dd');
                        if (postsDd) {
                            const postsStat = this.#createStatElement('fa-regular fa-comments', postsDd.textContent.trim(), 'posts');
                            userStats.appendChild(postsStat);
                        }

                        const reputationDd = originalDetails.querySelector('dl.u_reputation dd');
                        if (reputationDd) {
                            const reputationStat = this.#createStatElement('fa-regular fa-thumbs-up', reputationDd.textContent.trim(), 'reputation');
                            userStats.appendChild(reputationStat);
                        }

                        const statusDl = originalDetails.querySelector('dl.u_status');
                        if (statusDl) {
                            const statusDd = statusDl.querySelector('dd');
                            const statusValue = statusDd && statusDd.textContent ? statusDd.textContent.trim() : '';
                            const isOnline = statusValue.toLowerCase().includes('online');
                            const originalStatusIcon = statusDl.querySelector('dd i');

                            let statusIconHTML = '';
                            if (originalStatusIcon) {
                                statusIconHTML = originalStatusIcon.outerHTML;
                                if (statusIconHTML.includes('<i ') && !statusIconHTML.includes('aria-hidden')) {
                                    statusIconHTML = statusIconHTML.replace('<i ', '<i aria-hidden="true" ');
                                }
                            } else {
                                statusIconHTML = '<i class="fa-regular fa-circle-user" aria-hidden="true"></i>';
                            }

                            const statusStat = document.createElement('div');
                            statusStat.className = 'stat status' + (isOnline ? ' online' : '');
                            statusStat.innerHTML = statusIconHTML + '<span>' + statusValue + '</span>';
                            userStats.appendChild(statusStat);
                        }

                        detailsClone.querySelectorAll('dl').forEach(dl => dl.remove());

                        if (userStats.children.length > 0) {
                            detailsClone.appendChild(userStats);
                        }

                        userInfo.appendChild(detailsClone);
                    } else {
                        userInfo.appendChild(leftSection.cloneNode(true));
                    }
                }

                if (rightSection) {
                    const contentWrapper = document.createElement('div');
                    contentWrapper.className = 'post-main-content';

                    const rightSectionClone = rightSection.cloneNode(true);
                    this.#removeBottomBorderAndBr(rightSectionClone);
                    this.#preserveMediaDimensions(rightSectionClone);

                    contentWrapper.appendChild(rightSectionClone);
                    this.#cleanupPostContentStructure(contentWrapper);
                    postContent.appendChild(contentWrapper);
                    this.#modernizeQuotes(contentWrapper);
                    this.#modernizeSpoilers(contentWrapper);
                    this.#modernizeCodeBlocksInContent(contentWrapper);
                }
            });

            const title2Bottom = post.querySelector('.title2.bottom');
            if (title2Bottom) {
                this.#addReputationToFooter(miniButtons, stEmoji, postFooter);
                this.#modernizeBottomElements(title2Bottom, postFooter);
                title2Bottom.remove();
            } else {
                this.#addReputationToFooter(miniButtons, stEmoji, postFooter);
            }

            // Build structure in fragment first
            fragment.appendChild(postHeader);
            fragment.appendChild(userInfo);
            fragment.appendChild(postContent);
            fragment.appendChild(postFooter);

            // Single DOM replacement
            post.innerHTML = '';
            post.appendChild(fragment);

            this.#convertMiniButtonsToButtons(post);
            this.#addShareButton(post);
            this.#cleanupPostContent(post);

            // Ensure post ID is preserved
            const postId = post.id;
            if (postId && postId.startsWith('ee')) {
                post.setAttribute('data-post-id', postId.replace('ee', ''));
            }
        });
    }

    #transformSearchPostElements() {
        const posts = document.querySelectorAll('body#search .post:not(.post-modernized), body#search li.post:not(.post-modernized)');

        posts.forEach((post, index) => {
            post.classList.add('post-modernized', 'search-post');

            // Extract anchor elements
            const anchorDiv = post.querySelector('.anchor');
            let anchorElements = null;
            if (anchorDiv) {
                anchorElements = anchorDiv.cloneNode(true);
                anchorDiv.remove();
            }

            const title2Top = post.querySelector('.title2.top');
            const pointsElement = post.querySelector('.points');

            let contentHTML = '';
            const colorTable = post.querySelector('table.color');

            if (colorTable) {
                const tds = colorTable.querySelectorAll('td');
                tds.forEach(td => {
                    if (td.innerHTML && td.innerHTML.trim() !== '' && td.innerHTML.trim() !== '<br>') {
                        contentHTML += td.outerHTML;
                    }
                });
            }

            if (!contentHTML) {
                const contentElement = post.querySelector('td.Item table.color td') ||
                    post.querySelector('td.Item td') ||
                    post.querySelector('.color td') ||
                    post.querySelector('td[align]');

                if (contentElement && contentElement.innerHTML && contentElement.innerHTML.trim() !== '') {
                    contentHTML = contentElement.outerHTML;
                }
            }

            const editElement = post.querySelector('span.edit');
            const rtSub = post.querySelector('.rt.Sub');

            const postHeader = document.createElement('div');
            postHeader.className = 'post-header';

            const postContent = document.createElement('div');
            postContent.className = 'post-content search-post-content';

            const postFooter = document.createElement('div');
            postFooter.className = 'post-footer search-post-footer';

            if (anchorElements) {
                const anchorContainer = document.createElement('div');
                anchorContainer.className = 'anchor-container';
                anchorContainer.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
                anchorContainer.appendChild(anchorElements);
                postHeader.appendChild(anchorContainer);
            }

            const postNumber = document.createElement('span');
            postNumber.className = 'post-number';
            postNumber.textContent = '#' + (index + 1);
            postHeader.appendChild(postNumber);

            this.#addNewPostBadge(post, postHeader);

            if (title2Top) {
                const title2TopClone = title2Top.cloneNode(true);
                const pointsInTitle = title2TopClone.querySelector('.points');
                pointsInTitle?.remove();

                let locationDiv = null;
                if (rtSub) {
                    const topicLink = rtSub.querySelector('a[href*="?t="]');
                    const forumLink = rtSub.querySelector('a[href*="?f="]');

                    if (topicLink || forumLink) {
                        locationDiv = document.createElement('div');
                        locationDiv.className = 'post-location';

                        if (topicLink) {
                            const topicSpan = document.createElement('span');
                            topicSpan.className = 'topic-link';
                            topicSpan.innerHTML = '<i class="fa-regular fa-file-lines" aria-hidden="true"></i> ' + topicLink.textContent;
                            locationDiv.appendChild(topicSpan);
                        }

                        if (forumLink) {
                            const forumSpan = document.createElement('span');
                            forumSpan.className = 'forum-link';
                            forumSpan.innerHTML = '<i class="fa-regular fa-folder" aria-hidden="true"></i> ' + forumLink.textContent;
                            if (topicLink) {
                                locationDiv.appendChild(document.createTextNode(' - '));
                            }
                            locationDiv.appendChild(forumSpan);
                        }

                        title2TopClone.querySelector('.rt.Sub')?.remove();
                    }
                }

                this.#removeBreakAndNbsp(title2TopClone);
                title2TopClone.querySelector('.Break.Sub')?.remove();

                const tdWrapper = title2TopClone.querySelector('td.Item.Justify');
                if (tdWrapper) {
                    const divs = tdWrapper.querySelectorAll('div');
                    divs.forEach(div => {
                        postHeader.appendChild(div.cloneNode(true));
                    });
                    tdWrapper.remove();

                    if (locationDiv) {
                        postHeader.appendChild(locationDiv);
                    }
                } else {
                    if (locationDiv) {
                        title2TopClone.appendChild(locationDiv);
                    }
                    postHeader.appendChild(title2TopClone);
                }
            }

            if (contentHTML) {
                const contentWrapper = document.createElement('div');
                contentWrapper.className = 'post-main-content';

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = contentHTML;

                if (tempDiv.children.length === 1 && tempDiv.firstElementChild && tempDiv.firstElementChild.tagName === 'DIV') {
                    const wrapperDiv = tempDiv.firstElementChild;
                    const hasQuote = wrapperDiv.querySelector('.quote_top');

                    if (!hasQuote) {
                        while (wrapperDiv.firstChild) {
                            tempDiv.appendChild(wrapperDiv.firstChild);
                        }
                        wrapperDiv.remove();
                    }
                }

                while (tempDiv.firstChild) {
                    contentWrapper.appendChild(tempDiv.firstChild);
                }

                this.#preserveMediaDimensions(contentWrapper);

                const walker = document.createTreeWalker(contentWrapper, NodeFilter.SHOW_TEXT, null, false);
                const textNodes = [];
                let node;

                while (node = walker.nextNode()) {
                    if (node.textContent.trim() !== '') {
                        textNodes.push(node);
                    }
                }

                const urlParams = new URLSearchParams(window.location.search);
                const searchQuery = urlParams.get('q');
                if (searchQuery) {
                    textNodes.forEach(textNode => {
                        const text = textNode.textContent;
                        const searchRegex = new RegExp('(' + this.#escapeRegex(searchQuery) + ')', 'gi');
                        const highlightedText = text.replace(searchRegex, '<mark class="search-highlight">$1</mark>');

                        if (highlightedText !== text) {
                            const span = document.createElement('span');
                            span.innerHTML = highlightedText;
                            textNode.parentNode.replaceChild(span, textNode);
                        }
                    });
                }

                this.#processTextAndLineBreaks(contentWrapper);
                this.#cleanupSearchPostContent(contentWrapper);

                const editSpanInContent = contentWrapper.querySelector('span.edit');
                if (editSpanInContent) {
                    editSpanInContent.classList.add('post-edit');
                    const timeMatch = editSpanInContent.textContent.match(/Edited by .+? - (.+)/);
                    if (timeMatch) {
                        editSpanInContent.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edited on <time>' + this.#escapeHtml(timeMatch[1]) + '</time>';
                    }
                }

                this.#modernizeQuotes(contentWrapper);
                this.#modernizeSpoilers(contentWrapper);
                this.#modernizeCodeBlocksInContent(contentWrapper);

                postContent.appendChild(contentWrapper);
            }

            const postFooterActions = document.createElement('div');
            postFooterActions.className = 'post-actions';

            let pointsFooter;
            if (pointsElement && pointsElement.innerHTML.trim() !== '') {
                const pointsClone = pointsElement.cloneNode(true);
                pointsFooter = pointsClone;

                const emElement = pointsFooter.querySelector('em');
                const linkElement = pointsFooter.querySelector('a');
                const href = linkElement ? linkElement.getAttribute('href') : null;

                let pointsValue = '0';
                let pointsClass = 'points_pos';

                if (emElement) {
                    pointsValue = emElement.textContent.trim();
                    pointsClass = emElement.className;
                }

                const newPoints = document.createElement('div');
                newPoints.className = 'points active';
                newPoints.id = pointsElement.id || '';

                if (href) {
                    const link = document.createElement('a');
                    link.href = href;
                    link.setAttribute('tabindex', '0');
                    if (linkElement && linkElement.getAttribute('rel')) {
                        link.setAttribute('rel', linkElement.getAttribute('rel'));
                    }

                    const em = document.createElement('em');
                    em.className = pointsClass;
                    em.textContent = pointsValue;
                    link.appendChild(em);
                    newPoints.appendChild(link);
                } else {
                    const em = document.createElement('em');
                    em.className = pointsClass;
                    em.textContent = pointsValue;
                    newPoints.appendChild(em);
                }

                const thumbsSpan = document.createElement('span');
                thumbsSpan.className = 'points_up opacity';

                const icon = document.createElement('i');
                if (pointsClass === 'points_pos') {
                    thumbsSpan.classList.add('active');
                    icon.className = 'fa-regular fa-thumbs-up';
                } else if (pointsClass === 'points_neg') {
                    icon.className = 'fa-regular fa-thumbs-down';
                } else {
                    icon.className = 'fa-regular fa-thumbs-up';
                }

                icon.setAttribute('aria-hidden', 'true');
                thumbsSpan.appendChild(icon);
                newPoints.appendChild(thumbsSpan);

                pointsFooter = newPoints;
            } else {
                const noPoints = document.createElement('div');
                noPoints.className = 'points no_points';

                const em = document.createElement('em');
                em.className = 'points_pos';
                em.textContent = '0';
                noPoints.appendChild(em);

                const thumbsSpan = document.createElement('span');
                thumbsSpan.className = 'points_up opacity';

                const icon = document.createElement('i');
                icon.className = 'fa-regular fa-thumbs-up';
                icon.setAttribute('aria-hidden', 'true');

                thumbsSpan.appendChild(icon);
                noPoints.appendChild(thumbsSpan);

                pointsFooter = noPoints;
            }

            postFooterActions.appendChild(pointsFooter);
            postFooter.appendChild(postFooterActions);

            const shareContainer = document.createElement('div');
            shareContainer.className = 'modern-bottom-actions';

            const shareButton = document.createElement('button');
            shareButton.className = 'btn btn-icon btn-share';
            shareButton.setAttribute('data-action', 'share');
            shareButton.setAttribute('title', 'Share this post');
            shareButton.setAttribute('type', 'button');
            shareButton.innerHTML = '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>';

            shareButton.addEventListener('click', () => this.#handleShareSearchPost(post));

            shareContainer.appendChild(shareButton);
            postFooter.appendChild(shareContainer);

            const newPost = document.createElement('div');
            newPost.className = 'post post-modernized search-post';
            newPost.id = post.id;

            Array.from(post.attributes).forEach(attr => {
                if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'id') {
                    return;
                }
                newPost.setAttribute(attr.name, attr.value);
            });

            Array.from(post.attributes).forEach(attr => {
                if (attr.name.startsWith('data-')) {
                    newPost.setAttribute(attr.name, attr.value);
                }
            });

            const originalClasses = post.className.split(' ').filter(cls =>
                !cls.includes('post-modernized') && !cls.includes('search-post')
            );
            newPost.className = originalClasses.concat(['post', 'post-modernized', 'search-post']).join(' ');

            newPost.appendChild(postHeader);
            newPost.appendChild(postContent);
            newPost.appendChild(postFooter);

            post.parentNode.replaceChild(newPost, post);
            this.#updatePointsContainerActiveState(pointsFooter);
        });
    }

    #cleanupSearchPostContent(contentWrapper) {
        contentWrapper.querySelectorAll('table, tbody, tr, td').forEach(el => {
            if (el.tagName === 'TD' && el.children.length === 0 && el.textContent.trim() === '') {
                el.remove();
            } else if (el.tagName === 'TABLE' || el.tagName === 'TBODY' || el.tagName === 'TR') {
                const parent = el.parentNode;
                if (parent) {
                    while (el.firstChild) {
                        parent.insertBefore(el.firstChild, el);
                    }
                    el.remove();
                }
            }
        });

        contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top)').forEach(container => {
            if (container.classList.contains('quote-modernized')) return;
            this.#transformQuote(container);
            container.classList.add('quote-modernized');
        });

        contentWrapper.querySelectorAll('div[align="center"].spoiler').forEach(container => {
            if (container.classList.contains('spoiler-modernized')) return;
            this.#transformSpoiler(container);
            container.classList.add('spoiler-modernized');
        });

        contentWrapper.querySelectorAll('div[align="center"]:has(.code_top)').forEach(container => {
            if (container.classList.contains('code-modernized')) return;
            this.#transformCodeBlock(container);
            container.classList.add('code-modernized');
        });
    }

    #escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    #handleShareSearchPost(post) {
        let postLink = null;

        const postLinkElement = post.querySelector('.post-header a[href*="#entry"]');
        if (postLinkElement) {
            postLink = postLinkElement.href;
        }

        if (!postLink) {
            const postIdMatch = post.id.match(/\d+/);
            if (postIdMatch) {
                const postId = postIdMatch[0];
                const topicLink = post.querySelector('.topic-link');
                if (topicLink) {
                    const topicMatch = topicLink.textContent.match(/t=(\d+)/);
                    if (topicMatch) {
                        postLink = window.location.origin + '/?t=' + topicMatch[1] + '#entry' + postId;
                    }
                }
            }
        }

        if (postLink) {
            this.#copyPostLinkToClipboard(postLink);
        } else {
            this.#showCopyNotification('Could not find post link');
        }
    }

    #removeInvalidTableStructure(element) {
        element.querySelectorAll('td.right.Item').forEach(td => {
            while (td.firstChild) {
                td.parentNode.insertBefore(td.firstChild, td);
            }
            td.remove();
        });

        element.querySelectorAll('table.color:empty').forEach(table => table.remove());
    }

    #cleanupPostContentStructure(contentElement) {
        contentElement.querySelectorAll('.post-main-content > td').forEach(td => {
            while (td.firstChild) {
                contentElement.appendChild(td.firstChild);
            }
            td.remove();
        });

        contentElement.querySelectorAll('td').forEach(td => {
            const parent = td.parentNode;
            if (parent) {
                while (td.firstChild) {
                    parent.insertBefore(td.firstChild, td);
                }
                td.remove();
            }
        });

        contentElement.querySelectorAll('tr').forEach(tr => {
            const parent = tr.parentNode;
            if (parent) {
                while (tr.firstChild) {
                    parent.insertBefore(tr.firstChild, tr);
                }
                tr.remove();
            }
        });

        contentElement.querySelectorAll('tbody').forEach(tbody => {
            const parent = tbody.parentNode;
            if (parent) {
                while (tbody.firstChild) {
                    parent.insertBefore(tbody.firstChild, tbody);
                }
                tbody.remove();
            }
        });

        contentElement.querySelectorAll('table').forEach(table => {
            const parent = table.parentNode;
            if (parent) {
                while (table.firstChild) {
                    parent.insertBefore(table.firstChild, table);
                }
                table.remove();
            }
        });

        this.#cleanUpLineBreaksBetweenBlocks(contentElement);
        this.#cleanEmptyElements(contentElement);
        this.#processTextAndLineBreaks(contentElement);
        this.#cleanupEditSpans(contentElement);
        this.#processSignature(contentElement);
        this.#cleanInvalidAttributes(contentElement);
    }

    #cleanUpLineBreaksBetweenBlocks(element) {
        const blockSelectors = [
            '.modern-spoiler',
            '.modern-code',
            '.modern-quote',
            'div[align="center"]:has(.code_top)',
            'div[align="center"].spoiler',
            'div[align="center"]:has(.quote_top)'
        ];

        const blocks = Array.from(element.querySelectorAll(blockSelectors.join(', ')));
        blocks.sort((a, b) => {
            const position = a.compareDocumentPosition(b);
            return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        });

        blocks.forEach(block => {
            let nextSibling = block.nextSibling;
            while (nextSibling) {
                if (nextSibling.nodeType === Node.ELEMENT_NODE &&
                    nextSibling.tagName === 'BR') {
                    const brToRemove = nextSibling;
                    nextSibling = nextSibling.nextSibling;
                    brToRemove.remove();
                } else if (nextSibling.nodeType === Node.TEXT_NODE &&
                    /^\s*$/.test(nextSibling.textContent)) {
                    const textToRemove = nextSibling;
                    nextSibling = nextSibling.nextSibling;
                    textToRemove.remove();
                } else {
                    break;
                }
            }
        });

        blocks.forEach(block => {
            let prevSibling = block.previousSibling;
            while (prevSibling) {
                if (prevSibling.nodeType === Node.ELEMENT_NODE &&
                    prevSibling.tagName === 'BR') {
                    const brToRemove = prevSibling;
                    prevSibling = prevSibling.previousSibling;
                    brToRemove.remove();
                } else if (prevSibling.nodeType === Node.TEXT_NODE &&
                    /^\s*$/.test(prevSibling.textContent)) {
                    const textToRemove = prevSibling;
                    prevSibling = prevSibling.previousSibling;
                    textToRemove.remove();
                } else {
                    break;
                }
            }
        });
    }

    #cleanEmptyElements(element) {
        element.querySelectorAll(':empty').forEach(emptyEl => {
            if (!['IMG', 'BR', 'HR', 'INPUT', 'META', 'LINK'].includes(emptyEl.tagName)) {
                emptyEl.remove();
            }
        });

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const nodesToRemove = [];
        let node;

        while (node = walker.nextNode()) {
            if (node.textContent.trim() === '') {
                nodesToRemove.push(node);
            }
        }

        nodesToRemove.forEach(node => node.parentNode && node.parentNode.removeChild(node));
    }

    #cleanInvalidAttributes(element) {
        element.querySelectorAll('[width]').forEach(el => {
            if (!['IMG', 'IFRAME', 'VIDEO', 'CANVAS', 'TABLE', 'TD', 'TH'].includes(el.tagName)) {
                el.removeAttribute('width');
            }
        });

        element.querySelectorAll('[cellpadding], [cellspacing]').forEach(el => {
            if (el.tagName !== 'TABLE') {
                el.removeAttribute('cellpadding');
                el.removeAttribute('cellspacing');
            }
        });
    }

    #processTextAndLineBreaks(element) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;

        while (node = walker.nextNode()) {
            if (node.textContent.trim() !== '') {
                textNodes.push(node);
            }
        }

        textNodes.forEach(textNode => {
            if (textNode.parentNode && (!textNode.parentNode.classList || !textNode.parentNode.classList.contains('post-text'))) {
                const span = document.createElement('span');
                span.className = 'post-text';
                span.textContent = textNode.textContent;
                textNode.parentNode.replaceChild(span, textNode);
            }
        });

        element.querySelectorAll('br').forEach(br => {
            const prevSibling = br.previousElementSibling;
            const nextSibling = br.nextElementSibling;

            if (br.closest('.modern-spoiler, .modern-code, .modern-quote, .code-header, .spoiler-header, .quote-header')) {
                return;
            }

            if (prevSibling && nextSibling) {
                const prevIsPostText = prevSibling.classList && prevSibling.classList.contains('post-text');
                const nextIsPostText = nextSibling.classList && nextSibling.classList.contains('post-text');

                if (prevIsPostText && nextIsPostText) {
                    prevSibling.classList.add('paragraph-end');
                    br.remove();
                } else {
                    const prevIsModern = prevSibling.closest('.modern-spoiler, .modern-code, .modern-quote');
                    const nextIsModern = nextSibling.closest('.modern-spoiler, .modern-code, .modern-quote');

                    if (prevIsModern && nextIsModern) {
                        br.remove();
                    } else {
                        br.style.cssText = 'margin:0;padding:0;display:block;content:\'\';height:0.75em;margin-bottom:0.25em';
                    }
                }
            } else {
                br.remove();
            }
        });

        const postTextElements = element.querySelectorAll('.post-text');
        for (let i = 0; i < postTextElements.length - 1; i++) {
            const current = postTextElements[i];
            const next = postTextElements[i + 1];

            let nodeBetween = current.nextSibling;
            let onlyWhitespace = true;

            while (nodeBetween && nodeBetween !== next) {
                if (nodeBetween.nodeType === Node.TEXT_NODE && nodeBetween.textContent.trim() !== '') {
                    onlyWhitespace = false;
                    break;
                }
                nodeBetween = nodeBetween.nextSibling;
            }

            if (onlyWhitespace) {
                current.classList.add('paragraph-end');
            }
        }
    }

    #cleanupEditSpans(element) {
        element.querySelectorAll('span.edit').forEach(span => {
            span.classList.add('post-edit');
            const timeMatch = span.textContent.match(/Edited by .+? - (.+)/);
            if (timeMatch) {
                span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edited on <time>' + this.#escapeHtml(timeMatch[1]) + '</time>';
            }
        });
    }

    #processSignature(element) {
        element.querySelectorAll('.signature').forEach(sig => {
            sig.classList.add('post-signature');
            sig.previousElementSibling && sig.previousElementSibling.tagName === 'BR' && sig.previousElementSibling.remove();
        });
    }

    #modernizeQuotes(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top)').forEach(container => {
            if (container.classList.contains('quote-modernized')) return;
            this.#transformQuote(container);
            container.classList.add('quote-modernized');
        });
    }

    #modernizeSpoilers(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"].spoiler').forEach(container => {
            if (container.classList.contains('spoiler-modernized')) return;
            this.#transformSpoiler(container);
            container.classList.add('spoiler-modernized');
        });
    }

    #modernizeCodeBlocksInContent(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"]:has(.code_top)').forEach(container => {
            if (container.classList.contains('code-modernized')) return;
            this.#transformCodeBlock(container);
            container.classList.add('code-modernized');
        });
    }

    #transformQuote(container) {
        const quoteTop = container.querySelector('.quote_top');
        const quoteContent = container.querySelector('.quote');

        if (!quoteTop || !quoteContent) return;

        const quoteText = quoteTop.textContent.trim();
        const match = quoteText.match(/QUOTE\s*\(([^@]+)\s*@/);
        const author = match ? match[1].trim() : 'Unknown';
        const quoteLink = quoteTop.querySelector('a');
        const linkHref = quoteLink ? quoteLink.href : '#';
        const isLongContent = this.#isLongContent(quoteContent);

        const modernQuote = document.createElement('div');
        modernQuote.className = 'modern-quote' + (isLongContent ? ' long-quote' : '');

        let html = '<div class="quote-header">' +
            '<div class="quote-meta">' +
            '<div class="quote-icon">' +
            '<i class="fa-regular fa-quote-left" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="quote-info">' +
            '<span class="quote-author">' + this.#escapeHtml(author) + ' <span class="quote-said">said:</span></span>' +
            '</div>' +
            '</div>' +
            '<a href="' + this.#escapeHtml(linkHref) + '" class="quote-link" title="Go to post" tabindex="0">' +
            '<i class="fa-regular fa-chevron-up" aria-hidden="true"></i>' +
            '</a>' +
            '</div>';

        html += '<div class="quote-content' + (isLongContent ? ' collapsible-content' : '') + '">' +
            this.#preserveMediaDimensionsInHTML(quoteContent.innerHTML) +
            '</div>';

        if (isLongContent) {
            html += '<button class="quote-expand-btn" type="button" aria-label="Show full quote">' +
                '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
                'Show more' +
                '</button>';
        }

        modernQuote.innerHTML = html;
        container.replaceWith(modernQuote);

        if (isLongContent) {
            this.#addQuoteEventListeners(modernQuote);
        }

        setTimeout(() => {
            const quoteLink = modernQuote.querySelector('.quote-link');
            if (quoteLink) {
                this.#enhanceSingleQuoteLink(quoteLink);
            }
        }, 10);
    }

    #transformSpoiler(container) {
        const spoilerTop = container.querySelector('.code_top');
        const spoilerContent = container.querySelector('.code[align="left"]');

        if (!spoilerTop || !spoilerContent) return;

        const isLongContent = this.#isLongContent(spoilerContent);

        const modernSpoiler = document.createElement('div');
        modernSpoiler.className = 'modern-spoiler';

        let html = '<div class="spoiler-header" role="button" tabindex="0" aria-expanded="false">' +
            '<div class="spoiler-icon">' +
            '<i class="fa-regular fa-eye-slash" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="spoiler-info">' +
            '<span class="spoiler-title">SPOILER</span>' +
            '</div>' +
            '<button class="spoiler-toggle" type="button" aria-label="Toggle spoiler">' +
            '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
            '</button>' +
            '</div>';

        html += '<div class="spoiler-content' +
            (isLongContent ? ' collapsible-content' : '') + '">' +
            this.#preserveMediaDimensionsInHTML(spoilerContent.innerHTML) +
            '</div>';

        if (isLongContent) {
            html += '<button class="spoiler-expand-btn" type="button" aria-label="Show full spoiler content">' +
                '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
                'Show more' +
                '</button>';
        }

        modernSpoiler.innerHTML = html;
        container.replaceWith(modernSpoiler);

        this.#addSpoilerEventListeners(modernSpoiler, isLongContent);
    }

    #addSpoilerEventListeners(spoilerElement, isLongContent = false) {
        const spoilerHeader = spoilerElement.querySelector('.spoiler-header');
        const spoilerToggle = spoilerElement.querySelector('.spoiler-toggle');
        const expandBtn = spoilerElement.querySelector('.spoiler-expand-btn');
        const spoilerContent = spoilerElement.querySelector('.spoiler-content');
        const chevronIcon = spoilerToggle ? spoilerToggle.querySelector('i') : null;

        spoilerContent.style.maxHeight = '0';
        spoilerContent.style.padding = '0 16px';
        spoilerHeader.setAttribute('aria-expanded', 'false');

        if (chevronIcon) {
            chevronIcon.style.transform = 'rotate(0deg)';
        }

        if (isLongContent && expandBtn) {
            expandBtn.style.display = 'flex';
        }

        const toggleSpoiler = (shouldExpand = null) => {
            const isExpanded = shouldExpand !== null ? shouldExpand : !spoilerElement.classList.contains('expanded');

            if (isExpanded) {
                spoilerElement.classList.add('expanded');
                spoilerHeader.setAttribute('aria-expanded', 'true');

                if (chevronIcon) {
                    chevronIcon.style.transform = 'rotate(180deg)';
                }

                if (isLongContent) {
                    spoilerContent.style.maxHeight = '250px';
                    spoilerContent.style.padding = '16px';

                    if (expandBtn) {
                        expandBtn.style.display = 'none';
                    }
                } else {
                    spoilerContent.style.maxHeight = spoilerContent.scrollHeight + 'px';
                    spoilerContent.style.padding = '16px';
                    setTimeout(() => {
                        spoilerContent.style.maxHeight = 'none';
                    }, 300);
                }
            } else {
                spoilerElement.classList.remove('expanded');
                spoilerHeader.setAttribute('aria-expanded', 'false');

                if (chevronIcon) {
                    chevronIcon.style.transform = 'rotate(0deg)';
                }

                if (isLongContent) {
                    spoilerContent.style.maxHeight = '250px';
                    void spoilerContent.offsetHeight;
                    spoilerContent.style.maxHeight = '0';
                    spoilerContent.style.padding = '0 16px';
                } else {
                    spoilerContent.style.maxHeight = spoilerContent.scrollHeight + 'px';
                    void spoilerContent.offsetHeight;
                    spoilerContent.style.maxHeight = '0';
                    spoilerContent.style.padding = '0 16px';
                }

                if (isLongContent && expandBtn) {
                    setTimeout(() => {
                        expandBtn.style.display = 'flex';
                    }, 300);
                }
            }
        };

        spoilerHeader.addEventListener('click', () => toggleSpoiler());
        if (spoilerToggle) {
            spoilerToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSpoiler();
            });
        }

        spoilerHeader.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSpoiler();
            }
        });

        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                toggleSpoiler(true);

                if (isLongContent && spoilerContent.scrollHeight > 250) {
                    spoilerContent.style.maxHeight = spoilerContent.scrollHeight + 'px';
                    setTimeout(() => {
                        spoilerContent.style.maxHeight = 'none';
                    }, 300);
                }
            });
        }
    }

    #isLongContent(contentElement) {
        const clone = contentElement.cloneNode(true);
        const textLength = clone.textContent.trim().length;
        const mediaElements = clone.querySelectorAll('img, iframe, video, object, embed');
        const mediaCount = mediaElements.length;
        const totalElements = clone.querySelectorAll('*').length;

        let contentScore = 0;

        if (textLength > 800) contentScore += 3;
        else if (textLength > 500) contentScore += 2;
        else if (textLength > 300) contentScore += 1;

        if (mediaCount >= 3) contentScore += 3;
        else if (mediaCount >= 2) contentScore += 2;
        else if (mediaCount >= 1) contentScore += 1;

        if (totalElements > 20) contentScore += 2;
        else if (totalElements > 10) contentScore += 1;

        const hasIframeOrVideo = clone.querySelector('iframe, video');
        if (hasIframeOrVideo) contentScore += 3;

        const images = clone.querySelectorAll('img');
        if (images.length >= 2) {
            let totalPixelArea = 0;
            images.forEach(img => {
                const width = parseInt(img.getAttribute('width')) || 0;
                const height = parseInt(img.getAttribute('height')) || 0;
                totalPixelArea += width * height;
            });
            if (totalPixelArea > 500000) contentScore += 2;
        }

        return contentScore >= 4;
    }

    #preserveMediaDimensionsInHTML(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        this.#preserveMediaDimensions(tempDiv);
        return tempDiv.innerHTML;
    }

#preserveMediaDimensions(element) {
    // This method now just ensures basic styles and delegates to the extractor
    
    element.querySelectorAll('img').forEach(img => {
        // Set basic display styles
        if (!img.style.maxWidth) {
            img.style.maxWidth = '100%';
        }
        if (!img.style.height) {
            img.style.height = 'auto';
        }
        
        // Ensure emoji-specific styling
        const isTwemoji = img.src.includes('twemoji') || img.classList.contains('twemoji');
        const isEmoji = img.src.includes('emoji') || img.src.includes('smiley') || 
                       (img.src.includes('imgbox') && img.alt && img.alt.includes('emoji')) ||
                       img.className.includes('emoji');
        
        if (isTwemoji || isEmoji) {
            img.style.display = 'inline-block';
            img.style.verticalAlign = 'text-bottom';
            img.style.margin = '0 2px';
        } else if (!img.style.display || img.style.display === 'inline') {
            img.style.display = 'block';
        }
        
        // Add alt text if missing
        if (!img.hasAttribute('alt')) {
            if (isEmoji) {
                img.setAttribute('alt', 'Emoji');
                img.setAttribute('role', 'img');
            } else {
                img.setAttribute('alt', 'Forum image');
            }
        }
    });
    
    // Process iframes and videos that might have been missed
    element.querySelectorAll('iframe, video').forEach(media => {
        if (globalThis.mediaDimensionExtractor) {
            globalThis.mediaDimensionExtractor.extractDimensionsForElement(media);
        }
    });
}

    #enhanceIframesInElement(element) {
        element.querySelectorAll('iframe').forEach(iframe => {
            const originalWidth = iframe.getAttribute('width');
            const originalHeight = iframe.getAttribute('height');

            const commonSizes = {
                'youtube.com': { width: '560', height: '315' },
                'youtu.be': { width: '560', height: '315' },
                'vimeo.com': { width: '640', height: '360' },
                'soundcloud.com': { width: '100%', height: '166' },
                'twitter.com': { width: '550', height: '400' },
                'x.com': { width: '550', height: '400' },
                'default': { width: '100%', height: '400' }
            };

            let src = iframe.src || iframe.dataset.src || '';
            let dimensions = commonSizes.default;

            for (let domain in commonSizes) {
                if (commonSizes.hasOwnProperty(domain) && src.includes(domain)) {
                    dimensions = commonSizes[domain];
                    break;
                }
            }

            if (!originalWidth || !originalHeight) {
                iframe.setAttribute('width', dimensions.width);
                iframe.setAttribute('height', dimensions.height);

                const wrapper = document.createElement('div');
                wrapper.className = 'iframe-wrapper';

                if (dimensions.width !== '100%') {
                    const widthNum = parseInt(dimensions.width);
                    const heightNum = parseInt(dimensions.height);
                    if (widthNum > 0 && heightNum > 0) {
                        const paddingBottom = (heightNum / widthNum * 100) + '%';
                        wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:' + paddingBottom + ';overflow:hidden;';
                    } else {
                        wrapper.style.cssText = 'position:relative;width:100%;overflow:hidden;';
                    }
                } else {
                    wrapper.style.cssText = 'position:relative;width:100%;overflow:hidden;';
                }

                iframe.parentNode.insertBefore(wrapper, iframe);
                wrapper.appendChild(iframe);

                iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0;';
            }

            if (!iframe.hasAttribute('title')) {
                iframe.setAttribute('title', 'Embedded content');
            }
        });
    }

    #addQuoteEventListeners(quoteElement) {
        const expandBtn = quoteElement.querySelector('.quote-expand-btn');
        const quoteContent = quoteElement.querySelector('.quote-content.collapsible-content');

        if (expandBtn && quoteContent) {
            expandBtn.addEventListener('click', () => {
                quoteContent.style.maxHeight = quoteContent.scrollHeight + 'px';
                expandBtn.style.display = 'none';
                setTimeout(() => {
                    quoteContent.style.maxHeight = 'none';
                }, 300);
            });
        }
    }

    #addReputationToFooter(miniButtons, stEmoji, postFooter) {
        if (miniButtons || stEmoji) {
            const postActions = document.createElement('div');
            postActions.className = 'post-actions';

            if (miniButtons) {
                this.#cleanupMiniButtons(miniButtons);
                this.#setInitialPointsState(miniButtons);
                const pointsContainer = miniButtons.querySelector('.points');
                if (pointsContainer) {
                    this.#updatePointsContainerActiveState(pointsContainer);
                }
                postActions.appendChild(miniButtons);
            }

            if (stEmoji) {
                const emojiContainer = stEmoji.querySelector('.st-emoji-container');
                if (emojiContainer) {
                    this.#updateEmojiContainerActiveState(emojiContainer);
                }
                postActions.appendChild(stEmoji);
            }

            postFooter.insertBefore(postActions, postFooter.firstChild);
        }
    }

    #modernizeBottomElements(title2Bottom, postFooter) {
        title2Bottom.querySelectorAll('.rt.Sub').forEach(rtSub => {
            const label = rtSub.querySelector('label');
            const checkbox = rtSub.querySelector('input[type="checkbox"]');
            const ipAddress = rtSub.querySelector('.ip_address');

            const modernContainer = document.createElement('div');
            modernContainer.className = 'modern-bottom-actions';

            let html = '';

            if (label && checkbox && !ipAddress) {
                html = this.#createModernMultiquote(label, checkbox);
            } else if (ipAddress && checkbox) {
                html = this.#createModernModeratorView(ipAddress, checkbox, label);
            } else if (ipAddress) {
                html = this.#createModernIPAddress(ipAddress);
            } else if (checkbox) {
                html = this.#createBasicMultiquote(checkbox);
            } else if (label) {
                html = this.#createLabelOnly(label);
            }

            if (html) {
                modernContainer.innerHTML = html;
                postFooter.appendChild(modernContainer);
            }
        });
    }

    #removeBreakAndNbsp(element) {
        element.querySelectorAll('.Break.Sub').forEach(el => el.remove());

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const nodesToRemove = [];
        let node;

        while (node = walker.nextNode()) {
            if (node.textContent.includes('&nbsp;') || node.textContent.trim() === '') {
                nodesToRemove.push(node);
            }
        }

        nodesToRemove.forEach(node => {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
    }

    #removeBottomBorderAndBr(element) {
        element.querySelectorAll('.bottomborder').forEach(bottomBorder => {
            bottomBorder.remove();
            bottomBorder.nextElementSibling && bottomBorder.nextElementSibling.tagName === 'BR' && bottomBorder.nextElementSibling.remove();
        });
    }

    #cleanupPostContent(post) {
        post.querySelectorAll('.bottomborder').forEach(bottomBorder => {
            bottomBorder.parentNode && bottomBorder.parentNode.removeChild(bottomBorder);
            bottomBorder.nextElementSibling && bottomBorder.nextElementSibling.tagName === 'BR' &&
                bottomBorder.parentNode && bottomBorder.parentNode.removeChild(bottomBorder.nextElementSibling);
        });
    }

    #createStatElement(iconClass, value, additionalClass) {
        const statDiv = document.createElement('div');
        statDiv.className = 'stat ' + additionalClass;

        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');

        const span = document.createElement('span');
        span.textContent = value;

        statDiv.appendChild(icon);
        statDiv.appendChild(span);

        return statDiv;
    }

    #cleanupMiniButtons(miniButtons) {
        const walker = document.createTreeWalker(miniButtons, NodeFilter.SHOW_TEXT, null, false);
        const nodesToRemove = [];
        let node;

        while (node = walker.nextNode()) {
            if (node.textContent.trim() === '' || node.textContent.includes('&nbsp;') || /^\s*$/.test(node.textContent)) {
                nodesToRemove.push(node);
            }
        }

        nodesToRemove.forEach(node => node.parentNode && node.parentNode.removeChild(node));

        Array.from(miniButtons.childNodes).forEach(child => {
            if (child.nodeType === Node.TEXT_NODE &&
                (child.textContent.trim() === '' || child.textContent.includes('&nbsp;'))) {
                miniButtons.removeChild(child);
            }
        });
    }

    #setInitialPointsState(miniButtons) {
        const pointsContainer = miniButtons.querySelector('.points');
        if (!pointsContainer) return;

        const pointsPos = pointsContainer.querySelector('.points_pos');
        const pointsNeg = pointsContainer.querySelector('.points_neg');
        const pointsUp = pointsContainer.querySelector('.points_up');
        const pointsDown = pointsContainer.querySelector('.points_down');
        const bulletDelete = pointsContainer.querySelector('.bullet_delete');

        if (bulletDelete) {
            if (pointsPos) {
                pointsUp && pointsUp.classList.add('active');
                pointsDown && pointsDown.classList.remove('active');
            } else if (pointsNeg) {
                const pointsUpIcon = pointsUp ? pointsUp.querySelector('i') : null;
                const pointsDownIcon = pointsDown ? pointsDown.querySelector('i') : null;

                if (pointsUpIcon && pointsUpIcon.classList.contains('fa-thumbs-down')) {
                    pointsUp && pointsUp.classList.add('active');
                }
                if (pointsDownIcon && pointsDownIcon.classList.contains('fa-thumbs-down')) {
                    pointsDown && pointsDown.classList.add('active');
                }

                if (pointsUp && pointsUp.classList.contains('active')) {
                    pointsDown && pointsDown.classList.remove('active');
                } else if (pointsDown && pointsDown.classList.contains('active')) {
                    pointsUp && pointsUp.classList.remove('active');
                }
            }
        }
    }

    #createModernMultiquote(label, checkbox) {
        const labelText = label.textContent.replace('multiquote »', '').trim();
        const originalOnClick = label.getAttribute('onclick') || '';

        let html = '<div class="multiquote-control">' +
            '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="' + this.#escapeHtml(label.title || 'Select post') + '" type="button">' +
            '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' +
            '</button>' +
            '<label class="multiquote-label">' + this.#escapeHtml(labelText || 'Quote +') + '</label>';

        if (checkbox) {
            html += '<div class="user-checkbox-container">' +
                checkbox.outerHTML +
                '</div>';
        }

        html += '</div>';
        return html;
    }

    #createBasicMultiquote(checkbox) {
        const postId = checkbox.id.replace('p', '');
        const originalOnClick = "document.getElementById('" + checkbox.id + "').checked=!document.getElementById('" + checkbox.id + "').checked;post('" + postId + "')";

        return '<div class="multiquote-control">' +
            '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="Select post for multiquote" type="button">' +
            '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' +
            '</button>' +
            '<label class="multiquote-label">Quote +</label>' +
            '<div class="user-checkbox-container">' +
            checkbox.outerHTML +
            '</div>' +
            '</div>';
    }

    #createLabelOnly(label) {
        const labelText = label.textContent.replace('multiquote »', '').trim();
        const originalOnClick = label.getAttribute('onclick') || '';

        return '<div class="multiquote-control">' +
            '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="' + this.#escapeHtml(label.title || 'Select post') + '" type="button">' +
            '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' +
            '</button>' +
            '<label class="multiquote-label">' + this.#escapeHtml(labelText || 'Quote +') + '</label>' +
            '</div>';
    }

    #createModernModeratorView(ipAddress, checkbox, label) {
        const ipLink = ipAddress.querySelector('a');
        const ipTextElement = ipAddress.querySelector('dd');
        const ipText = ipTextElement && ipTextElement.textContent ? ipTextElement.textContent : '';

        let originalOnClick = '';
        let labelText = 'Quote +';

        if (label) {
            originalOnClick = label.getAttribute('onclick') || '';
            labelText = label.textContent.replace('multiquote »', '').trim() || 'Quote +';
        } else {
            const postId = checkbox.id.replace('p', '');
            originalOnClick = "document.getElementById('" + checkbox.id + "').checked=!document.getElementById('" + checkbox.id + "').checked;post('" + postId + "')";
        }

        let html = '<div class="moderator-controls">' +
            '<div class="multiquote-control">' +
            '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="Select post for multiquote" type="button">' +
            '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' +
            '</button>' +
            '<label class="multiquote-label">' + this.#escapeHtml(labelText) + '</label>' +
            '</div>' +
            '<div class="ip-address-control">' +
            '<span class="ip-label">IP:</span>' +
            '<span class="ip-value">';

        if (ipLink) {
            html += '<a href="' + this.#escapeHtml(ipLink.href) + '" target="_self" class="ip-link" tabindex="0">' + this.#escapeHtml(ipText) + '</a>';
        } else {
            html += '<span class="ip-text">' + this.#escapeHtml(ipText) + '</span>';
        }

        html += '</span></div>' +
            '<div class="mod-checkbox-container">' +
            checkbox.outerHTML +
            '</div></div>';

        return html;
    }

    #createModernIPAddress(ipAddress) {
        const ipLink = ipAddress.querySelector('a');
        const ipTextElement = ipAddress.querySelector('dd');
        const ipText = ipTextElement && ipTextElement.textContent ? ipTextElement.textContent : '';

        let html = '<div class="ip-address-control">' +
            '<span class="ip-label">IP:</span>' +
            '<span class="ip-value">';

        if (ipLink) {
            html += '<a href="' + this.#escapeHtml(ipLink.href) + '" target="_self" class="ip-link" tabindex="0">' + this.#escapeHtml(ipText) + '</a>';
        } else {
            html += '<span class="ip-text">' + this.#escapeHtml(ipText) + '</span>';
        }

        html += '</span></div>';
        return html;
    }

    #convertMiniButtonsToButtons(post) {
        const miniButtonsContainer = post.querySelector('.mini_buttons.rt.Sub');
        if (!miniButtonsContainer) return;

        miniButtonsContainer.querySelectorAll('.mini_buttons.rt.Sub a').forEach(link => {
            const href = link.getAttribute('href');

            if (href && href.startsWith('javascript:')) {
                const jsCode = href.replace('javascript:', '');
                if (jsCode.includes('delete_post')) {
                    const button = document.createElement('button');
                    button.className = 'btn btn-icon btn-delete';
                    button.setAttribute('data-action', 'delete');
                    button.setAttribute('onclick', jsCode);
                    button.setAttribute('title', 'Delete');
                    button.setAttribute('type', 'button');

                    let buttonHTML = link.innerHTML;
                    buttonHTML = buttonHTML.replace(/<i(?![^>]*aria-hidden)/g, '<i aria-hidden="true" ');
                    button.innerHTML = buttonHTML;

                    link.parentNode.replaceChild(button, link);
                }
            } else if (href && href.includes('CODE=08')) {
                link.classList.add('btn', 'btn-icon', 'btn-edit');
                link.setAttribute('data-action', 'edit');
                link.setAttribute('title', 'Edit');

                const icon = link.querySelector('i');
                icon && !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true');
            } else if (href && href.includes('CODE=02')) {
                link.classList.add('btn', 'btn-icon', 'btn-quote');
                link.setAttribute('data-action', 'quote');
                link.setAttribute('title', 'Quote');
                link.getAttribute('rel') && link.setAttribute('rel', link.getAttribute('rel'));

                const icon = link.querySelector('i');
                icon && !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true');
            } else if (href) {
                link.classList.add('btn', 'btn-icon');
                link.querySelectorAll('i').forEach(icon => {
                    !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true');
                });
            }
        });

        this.#reorderPostButtons(miniButtonsContainer);
    }

    #addShareButton(post) {
        const miniButtonsContainer = post.querySelector('.post-header .mini_buttons.rt.Sub');
        if (!miniButtonsContainer || miniButtonsContainer.querySelector('.btn-share')) return;

        const shareButton = document.createElement('button');
        shareButton.className = 'btn btn-icon btn-share';
        shareButton.setAttribute('data-action', 'share');
        shareButton.setAttribute('title', 'Share this post');
        shareButton.setAttribute('type', 'button');
        shareButton.innerHTML = '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>';

        const deleteButton = miniButtonsContainer.querySelector('.btn-delete, [data-action="delete"]');
        if (deleteButton) {
            miniButtonsContainer.insertBefore(shareButton, deleteButton);
        } else {
            miniButtonsContainer.insertBefore(shareButton, miniButtonsContainer.firstChild);
        }

        shareButton.addEventListener('click', () => this.#handleSharePost(post));
    }

    #reorderPostButtons(container) {
        const elements = Array.from(container.children);
        const order = ['share', 'quote', 'edit', 'delete'];

        elements.sort((a, b) => {
            const getAction = (element) => {
                const dataAction = element.getAttribute('data-action');
                if (dataAction && order.includes(dataAction)) return dataAction;

                if (element.classList.contains('btn-share')) return 'share';
                if (element.classList.contains('btn-quote')) return 'quote';
                if (element.classList.contains('btn-edit')) return 'edit';
                if (element.classList.contains('btn-delete')) return 'delete';

                if (element.href) {
                    if (element.href.includes('CODE=02')) return 'quote';
                    if (element.href.includes('CODE=08')) return 'edit';
                }

                if (element.onclick && element.onclick.toString().includes('delete_post')) return 'delete';

                return 'other';
            };

            const actionA = getAction(a);
            const actionB = getAction(b);
            const indexA = order.indexOf(actionA);
            const indexB = order.indexOf(actionB);

            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0;
        });

        container.innerHTML = '';
        elements.forEach(el => container.appendChild(el));
    }

    #handleSharePost(post) {
        let postLink = null;

        const timestampLink = post.querySelector('.post-header .lt.Sub a[href*="#entry"]');
        if (timestampLink) {
            postLink = timestampLink.href;
        }

        if (!postLink) {
            const timeLink = post.querySelector('.post-header time[class*="when"]');
            if (timeLink && timeLink.closest('a')) {
                postLink = timeLink.closest('a').href;
            }
        }

        if (!postLink) {
            const postIdMatch = post.id.match(/\d+/);
            if (postIdMatch) {
                const postId = postIdMatch[0];
                const topicMatch = window.location.href.match(/t=(\d+)/);
                if (topicMatch) {
                    postLink = window.location.origin + '/?t=' + topicMatch[1] + '#entry' + postId;
                }
            }
        }

        if (postLink) {
            this.#copyPostLinkToClipboard(postLink);
        } else {
            this.#showCopyNotification('Could not find post link');
        }
    }

    #copyPostLinkToClipboard(link) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(() => {
                this.#showCopyNotification('Post link copied to clipboard!');
            }).catch(() => {
                this.#fallbackCopyPostLink(link);
            });
        } else {
            this.#fallbackCopyPostLink(link);
        }
    }

    #fallbackCopyPostLink(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            if (document.execCommand('copy')) {
                this.#showCopyNotification('Post link copied to clipboard!');
            } else {
                this.#showCopyNotification('Failed to copy link');
            }
        } catch {
            this.#showCopyNotification('Failed to copy link');
        } finally {
            document.body.removeChild(textArea);
        }
    }

    #showCopyNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'copy-notification';
        notification.textContent = message;

        notification.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;background:var(--success-color);color:white;border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:9999;font-weight:500;display:flex;align-items:center;gap:8px;transform:translateX(calc(100% + 20px));opacity:0;transition:transform 0.3s ease-out,opacity 0.3s ease-out;pointer-events:none;white-space:nowrap;';

        const icon = document.createElement('i');
        icon.className = 'fa-regular fa-check-circle';
        icon.setAttribute('aria-hidden', 'true');
        notification.prepend(icon);

        document.body.appendChild(notification);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                notification.style.transform = 'translateX(0)';
                notification.style.opacity = '1';
            });
        });

        const dismissTimer = setTimeout(() => {
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';

            notification.addEventListener('transitionend', () => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, { once: true });
        }, 2000);

        notification.style.pointerEvents = 'auto';
        notification.style.cursor = 'pointer';
        notification.addEventListener('click', () => {
            clearTimeout(dismissTimer);
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';

            notification.addEventListener('transitionend', () => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, { once: true });
        });
    }

    #enhanceReputationSystem() {
        document.addEventListener('click', (e) => {
            const pointsUp = e.target.closest('.points_up');
            const pointsDown = e.target.closest('.points_down');
            const emojiPreview = e.target.closest('.st-emoji-preview');

            if (pointsUp || pointsDown) {
                const pointsContainer = (pointsUp || pointsDown).closest('.points');
                const bulletDelete = pointsContainer ? pointsContainer.querySelector('.bullet_delete') : null;

                if (bulletDelete && bulletDelete.onclick &&
                    (pointsContainer.querySelector('.points_pos') ||
                        pointsContainer.querySelector('.points_neg'))) {
                    bulletDelete.onclick();
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                if (pointsUp) {
                    pointsContainer && pointsContainer.querySelector('.points_down') && pointsContainer.querySelector('.points_down').classList.remove('active');
                    pointsUp.classList.add('active');
                }

                if (pointsDown) {
                    pointsContainer && pointsContainer.querySelector('.points_up') && pointsContainer.querySelector('.points_up').classList.remove('active');
                    pointsDown.classList.add('active');
                }
            }

            if (emojiPreview) {
                emojiPreview.closest('.st-emoji-container') && emojiPreview.closest('.st-emoji-container').classList.toggle('active');
            }
        });
    }

    #escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ==============================
    // ENHANCED ANCHOR NAVIGATION
    // ==============================

    #setupEnhancedAnchorNavigation() {
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href*="#"]');
            if (!link) return;

            const href = link.getAttribute('href');
            const hashMatch = href.match(/#([^?&]+)/);
            if (!hashMatch) return;

            const anchorId = hashMatch[1];

            if (anchorId === 'lastpost' || anchorId === 'newpost' || anchorId.startsWith('entry')) {
                e.preventDefault();

                const url = new URL(href, window.location.origin);
                const isCrossPage = this.#isCrossPageAnchor(url);

                if (isCrossPage) {
                    window.location.href = href;
                } else {
                    this.#scrollToAnchorWithPrecision(anchorId, link);
                }
            }
        });

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.substring(1);
            if (hash && (hash === 'lastpost' || hash === 'newpost' || hash.startsWith('entry'))) {
                setTimeout(() => this.#scrollToAnchorWithPrecision(hash), 100);
            }
        });

        if (window.location.hash) {
            const hash = window.location.hash.substring(1);
            if (hash && (hash === 'lastpost' || hash === 'newpost' || hash.startsWith('entry'))) {
                setTimeout(() => this.#scrollToAnchorWithPrecision(hash), 500);
            }
        }
    }

    #scrollToAnchorWithPrecision(anchorId, triggerElement = null) {
        console.log('Navigating to anchor: ' + anchorId);

        const anchorElement = document.getElementById(anchorId);
        if (!anchorElement) {
            console.warn('Anchor #' + anchorId + ' not found');
            if (triggerElement) {
                window.location.hash = anchorId;
            }
            return;
        }

        const postElement = anchorElement.closest('.post');
        if (!postElement) {
            console.warn('Post containing anchor #' + anchorId + ' not found');
            this.#scrollToElementWithOffset(anchorElement);
            return;
        }

        this.#focusPost(postElement);

        const postHeader = postElement.querySelector('.post-header');
        if (postHeader) {
            this.#scrollToElementWithOffset(postHeader, 20);
        } else {
            this.#scrollToElementWithOffset(postElement, 20);
        }

        postElement.setAttribute('tabindex', '-1');
        postElement.focus({ preventScroll: true });

        history.replaceState(null, null, '#' + anchorId);
    }

    #focusPost(postElement) {
        document.querySelectorAll('.post.focus').forEach(post => {
            post.classList.remove('focus');
        });

        postElement.classList.add('focus');

        const removeFocusHandler = (e) => {
            if (!postElement.contains(e.target)) {
                postElement.classList.remove('focus');
                document.removeEventListener('click', removeFocusHandler);
                document.removeEventListener('keydown', escapeHandler);
            }
        };

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                postElement.classList.remove('focus');
                document.removeEventListener('click', removeFocusHandler);
                document.removeEventListener('keydown', escapeHandler);
            }
        };

        document.addEventListener('click', removeFocusHandler);
        document.addEventListener('keydown', escapeHandler);

        setTimeout(() => {
            postElement.classList.remove('focus');
            document.removeEventListener('click', removeFocusHandler);
            document.removeEventListener('keydown', escapeHandler);
        }, 10000);
    }

    #scrollToElementWithOffset(element, additionalOffset = 0) {
        const elementRect = element.getBoundingClientRect();
        const offsetTop = elementRect.top + window.pageYOffset;
        const headerHeight = this.#getFixedHeaderHeight();
        const targetScroll = offsetTop - headerHeight - additionalOffset;

        if ('scrollBehavior' in document.documentElement.style) {
            window.scrollTo({
                top: targetScroll,
                behavior: 'smooth'
            });
        } else {
            window.scrollTo(0, targetScroll);
        }
    }

    #getFixedHeaderHeight() {
        let totalHeight = 0;

        const headerSelectors = [
            '.header_h',
            '.menuwrap',
            '.modern-nav.top-nav',
            '[style*="fixed"]',
            '[style*="sticky"]'
        ];

        headerSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                const position = style.position;

                if (position === 'fixed' || position === 'sticky') {
                    totalHeight += rect.height;
                }
            });
        });

        return Math.max(totalHeight, 80);
    }

    #isCrossPageAnchor(url) {
        const currentUrl = new URL(window.location.href);

        const currentPage = this.#getPageNumber(currentUrl);
        const targetPage = this.#getPageNumber(url);

        const currentTopic = currentUrl.searchParams.get('t');
        const targetTopic = url.searchParams.get('t');

        return (currentPage !== targetPage && currentTopic === targetTopic);
    }

    #getPageNumber(url) {
        const stParam = url.searchParams.get('st');
        if (stParam) {
            const postsPerPage = 30;
            return Math.floor(parseInt(stParam) / postsPerPage) + 1;
        }
        return 1;
    }

    // ==============================
    // ENHANCED QUOTE LINKS
    // ==============================

    #enhanceQuoteLinks() {
        this.#processExistingQuoteLinks();
        this.#setupQuoteLinkObserver();
    }

    #processExistingQuoteLinks() {
        document.querySelectorAll('.quote-link').forEach(link => {
            this.#enhanceSingleQuoteLink(link);
        });

        document.querySelectorAll('.quote_top a[href*="#entry"]').forEach(link => {
            this.#enhanceSingleQuoteLink(link);
        });
    }

    #enhanceSingleQuoteLink(link) {
        const href = link.getAttribute('href');
        if (!href || !href.includes('#entry')) return;

        const url = new URL(href, window.location.origin);
        const anchorId = url.hash.substring(1);
        const isCrossPage = this.#isCrossPageAnchor(url);

        const button = document.createElement('button');
        button.className = 'quote-jump-btn';
        button.setAttribute('data-anchor-id', anchorId);
        button.setAttribute('data-is-cross-page', isCrossPage.toString());
        button.setAttribute('data-target-url', href);
        button.setAttribute('title', isCrossPage ? 'Go to post on another page' : 'Jump to quoted post');
        button.setAttribute('aria-label', isCrossPage ? 'Go to quoted post on another page' : 'Jump to quoted post');
        button.setAttribute('type', 'button');
        button.setAttribute('tabindex', '0');

        const icon = link.querySelector('i') ? link.querySelector('i').cloneNode(true) :
            document.createElement('i');
        if (!icon.className.includes('fa-')) {
            icon.className = 'fa-regular fa-chevron-up';
        }
        icon.setAttribute('aria-hidden', 'true');

        if (isCrossPage) {
            const indicator = document.createElement('span');
            indicator.className = 'cross-page-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.textContent = '↗';
            button.appendChild(indicator);
        }

        button.appendChild(icon);

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.#handleQuoteJumpClick(button);
        });

        link.parentNode.replaceChild(button, link);
    }

    #handleQuoteJumpClick(button) {
        const anchorId = button.getAttribute('data-anchor-id');
        const isCrossPage = button.getAttribute('data-is-cross-page') === 'true';
        const targetUrl = button.getAttribute('data-target-url');

        this.#setButtonLoading(button, true);

        if (isCrossPage) {
            window.location.href = targetUrl;
        } else {
            this.#jumpToQuoteOnSamePage(anchorId, button);
        }
    }

    #jumpToQuoteOnSamePage(anchorId, button) {
        const anchorElement = document.getElementById(anchorId);

        if (!anchorElement) {
            console.warn('Anchor #' + anchorId + ' not found, falling back to standard navigation');
            window.location.hash = anchorId;
            this.#setButtonLoading(button, false);
            return;
        }

        const postElement = anchorElement.closest('.post');

        if (!postElement) {
            this.#scrollToElementWithOffset(anchorElement);
            this.#setButtonLoading(button, false);
            return;
        }

        this.#focusPost(postElement);

        const postHeader = postElement.querySelector('.post-header');
        if (postHeader) {
            this.#scrollToElementWithOffset(postHeader, 20);
        } else {
            this.#scrollToElementWithOffset(postElement, 20);
        }

        postElement.setAttribute('tabindex', '-1');
        postElement.focus({ preventScroll: true });

        setTimeout(() => {
            this.#setButtonLoading(button, false);
        }, 500);
    }

    #setButtonLoading(button, isLoading) {
        if (isLoading) {
            button.classList.add('loading');
            const icon = button.querySelector('i');
            if (icon) {
                icon.className = 'fa-regular fa-spinner fa-spin';
            }
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            const icon = button.querySelector('i');
            if (icon && icon.className.includes('fa-spinner')) {
                icon.className = 'fa-regular fa-chevron-up';
            }
            button.disabled = false;
        }
    }

    #setupQuoteLinkObserver() {
        if (globalThis.forumObserver) {
            this.#quoteLinkObserverId = globalThis.forumObserver.register({
                id: 'quote-link-enhancer',
                callback: (node) => this.#handleNewQuoteLinks(node),
                selector: '.quote-link, .quote_top a[href*="#entry"]',
                priority: 'normal'
            });
        } else {
            setInterval(() => this.#processExistingQuoteLinks(), 2000);
        }
    }

    #handleNewQuoteLinks(node) {
        if (node.matches('.quote-link') || node.matches('.quote_top a[href*="#entry"]')) {
            this.#enhanceSingleQuoteLink(node);
        } else {
            node.querySelectorAll('.quote-link, .quote_top a[href*="#entry"]').forEach(link => {
                this.#enhanceSingleQuoteLink(link);
            });
        }
    }

    // ==============================
    // NEW POST BADGE
    // ==============================

    #addNewPostBadge(post, postHeader) {
        const hasNewPostAnchor = post.querySelector('.anchor a#newpost');
        if (!hasNewPostAnchor) return;

        const newBadge = document.createElement('span');
        newBadge.className = 'post-new-badge';
        newBadge.textContent = 'NEW';
        newBadge.setAttribute('aria-label', 'New post since your last visit');

        const postNumber = postHeader.querySelector('.post-number');
        if (postNumber) {
            let badgeContainer = postHeader.querySelector('.post-badges');
            if (!badgeContainer) {
                badgeContainer = document.createElement('div');
                badgeContainer.className = 'post-badges';
                postHeader.insertBefore(badgeContainer, postNumber.nextSibling);
            }
            badgeContainer.appendChild(newBadge);
        } else {
            postHeader.insertBefore(newBadge, postHeader.firstChild);
        }
    }

    // ==============================
    // MODERN CODE BLOCKS
    // ==============================

    #modernizeCodeBlocks() {
        this.#processExistingCodeBlocks();
        this.#setupCodeBlockObserver();
    }

    #processExistingCodeBlocks() {
        document.querySelectorAll('div[align="center"]:has(.code_top)').forEach(container => {
            if (container.classList.contains('code-modernized')) return;
            this.#transformCodeBlock(container);
            container.classList.add('code-modernized');
        });
    }

    #transformCodeBlock(container) {
        const codeTop = container.querySelector('.code_top');
        const codeContent = container.querySelector('.code');

        if (!codeTop || !codeContent) return;

        const codeText = codeTop.textContent.trim();
        const codeType = codeText.toUpperCase();
        const isLongContent = this.#isLongContent(codeContent);

        const modernCode = document.createElement('div');
        modernCode.className = 'modern-code' + (isLongContent ? ' long-code' : '');

        let html = '<div class="code-header">' +
            '<div class="code-icon">' +
            '<i class="fa-regular fa-code" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="code-info">' +
            '<span class="code-title">' + this.#escapeHtml(codeType) + '</span>' +
            '</div>' +
            '<button class="code-copy-btn" type="button" aria-label="Copy code" tabindex="0">' +
            '<i class="fa-regular fa-copy" aria-hidden="true"></i>' +
            '</button>' +
            '</div>';

        html += '<div class="code-content' +
            (isLongContent ? ' collapsible-content' : '') + '">' +
            '<pre><code>' + this.#escapeHtml(codeContent.textContent) + '</code></pre>' +
            '</div>';

        if (isLongContent) {
            html += '<button class="code-expand-btn" type="button" aria-label="Show full code" tabindex="0">' +
                '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
                'Show more code' +
                '</button>';
        }

        modernCode.innerHTML = html;
        container.replaceWith(modernCode);

        this.#addCodeEventListeners(modernCode, codeContent.textContent, isLongContent);
    }

    #addCodeEventListeners(codeElement, codeText, isLongContent = false) {
        const codeHeader = codeElement.querySelector('.code-header');
        const copyBtn = codeElement.querySelector('.code-copy-btn');
        const expandBtn = codeElement.querySelector('.code-expand-btn');
        const codeContent = codeElement.querySelector('.code-content');

        codeHeader.style.cursor = 'default';

        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.#copyCodeToClipboard(codeText, 'code');
            });
        }

        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                this.#toggleCodeExpansion(codeElement, true);
            });
        }

        this.#applySyntaxHighlighting(codeElement);
    }

    #toggleCodeExpansion(codeElement, forceExpand = null) {
        const codeContent = codeElement.querySelector('.code-content');
        const expandBtn = codeElement.querySelector('.code-expand-btn');
        const isExpanded = forceExpand !== null ? forceExpand : !codeElement.classList.contains('expanded');

        if (isExpanded) {
            codeElement.classList.add('expanded');
            codeContent.style.maxHeight = codeContent.scrollHeight + 'px';
            if (expandBtn) {
                expandBtn.style.display = 'none';
            }

            setTimeout(() => {
                codeContent.style.maxHeight = 'none';
            }, 300);
        } else {
            codeElement.classList.remove('expanded');
            codeContent.style.maxHeight = codeContent.scrollHeight + 'px';

            void codeContent.offsetHeight;

            codeContent.style.maxHeight = '0';
            if (expandBtn) {
                setTimeout(() => {
                    expandBtn.style.display = 'flex';
                }, 300);
            }
        }
    }

    #copyCodeToClipboard(codeText, codeType) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(codeText).then(() => {
                this.#showCopyNotification('Copied ' + codeType + ' to clipboard!');
            }).catch(() => {
                this.#fallbackCopyCode(codeText, codeType);
            });
        } else {
            this.#fallbackCopyCode(codeText, codeType);
        }
    }

    #fallbackCopyCode(text, codeType) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            if (document.execCommand('copy')) {
                this.#showCopyNotification('Copied ' + codeType + ' to clipboard!');
            } else {
                this.#showCopyNotification('Failed to copy ' + codeType);
            }
        } catch {
            this.#showCopyNotification('Failed to copy ' + codeType);
        } finally {
            document.body.removeChild(textArea);
        }
    }

    #applySyntaxHighlighting(codeElement) {
        const code = codeElement.querySelector('code');
        const codeTitle = codeElement.querySelector('.code-title');
        if (!code || !codeTitle) return;

        const text = code.textContent;
        const codeType = codeTitle.textContent;

        if (codeType === 'JAVASCRIPT' || codeType === 'JS') {
            code.innerHTML = this.#highlightJavaScript(text);
        } else if (codeType === 'HTML' || codeType === 'XML') {
            code.innerHTML = this.#highlightHTML(text);
        } else if (codeType === 'CSS') {
            code.innerHTML = this.#highlightCSS(text);
        }

        if (text.split('\n').length > 10) {
            this.#addLineNumbers(codeElement);
        }
    }

    #highlightJavaScript(code) {
        return code
            .replace(/\/\/.*$/gm, '<span class="code-comment">$&</span>')
            .replace(/\/\*[\s\S]*?\*\//g, '<span class="code-comment">$&</span>')
            .replace(/(\b(function|const|let|var|return|if|else|for|while|try|catch|class|import|export)\b)/g, '<span class="code-keyword">$1</span>')
            .replace(/(\b(true|false|null|undefined)\b)/g, '<span class="code-literal">$1</span>')
            .replace(/(\b(\d+)\b)/g, '<span class="code-number">$1</span>')
            .replace(/(["'`][^"'`]*["'`])/g, '<span class="code-string">$1</span>');
    }

    #highlightHTML(code) {
        return code
            .replace(/&lt;\/?([a-zA-Z][a-zA-Z0-9]*)/g, '<span class="code-tag">&lt;$1</span>')
            .replace(/(&lt;\/[a-zA-Z][a-zA-Z0-9]*&gt;)/g, '<span class="code-tag">$1</span>')
            .replace(/([a-zA-Z\-]+)=/g, '<span class="code-attribute">$1</span>=')
            .replace(/("[^"]*"|'[^']*')/g, '<span class="code-value">$1</span>')
            .replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="code-comment">$&</span>');
    }

    #highlightCSS(code) {
        return code
            .replace(/([a-zA-Z\-]+)\s*:/g, '<span class="code-property">$1</span>:')
            .replace(/#[0-9a-fA-F]{3,6}/g, '<span class="code-color">$&</span>')
            .replace(/(rgb|rgba|hsl|hsla)\([^)]+\)/g, '<span class="code-color">$&</span>')
            .replace(/(\b([0-9]+(\.[0-9]+)?)(px|em|rem|%|vh|vw)\b)/g, '<span class="code-number">$1</span>')
            .replace(/\/\*[\s\S]*?\*\//g, '<span class="code-comment">$&</span>');
    }

    #addLineNumbers(codeElement) {
        const codeContent = codeElement.querySelector('code');
        const lines = codeContent.innerHTML.split('\n');

        if (lines.length > 1) {
            let numberedHTML = '';
            lines.forEach((line, index) => {
                numberedHTML += '<span class="line-number">' + (index + 1) + '</span>' + line + '\n';
            });
            codeContent.innerHTML = numberedHTML;
            codeElement.classList.add('has-line-numbers');
        }
    }

    #setupCodeBlockObserver() {
        if (globalThis.forumObserver) {
            this.#codeBlockObserverId = globalThis.forumObserver.register({
                id: 'code-block-modernizer',
                callback: (node) => this.#handleNewCodeBlocks(node),
                selector: 'div[align="center"]:has(.code_top)',
                priority: 'normal'
            });
        } else {
            setInterval(() => this.#processExistingCodeBlocks(), 2000);
        }
    }

    #handleNewCodeBlocks(node) {
        if (node.matches('div[align="center"]:has(.code_top)')) {
            this.#transformCodeBlock(node);
        } else {
            node.querySelectorAll('div[align="center"]:has(.code_top)').forEach(block => {
                this.#transformCodeBlock(block);
            });
        }
    }

    destroy() {
        const ids = [this.#postModernizerId, this.#activeStateObserverId,
        this.#debouncedObserverId, this.#cleanupObserverId,
        this.#searchPostObserverId, this.#quoteLinkObserverId,
            this.#codeBlockObserverId];

        ids.forEach(id => id && globalThis.forumObserver && globalThis.forumObserver.unregister(id));

        if (this.#retryTimeoutId) {
            clearTimeout(this.#retryTimeoutId);
            this.#retryTimeoutId = null;
        }

        console.log('Post Modernizer destroyed');
    }
}

// Modern initialization without DOMContentLoaded
(function initPostModernizer() {
    const init = () => {
        try {
            globalThis.postModernizer = new PostModernizer();
        } catch (error) {
            console.error('Failed to create Post Modernizer instance:', error);

            setTimeout(() => {
                if (!globalThis.postModernizer) {
                    try {
                        globalThis.postModernizer = new PostModernizer();
                    } catch (retryError) {
                        console.error('Post Modernizer failed on retry:', retryError);
                    }
                }
            }, 100);
        }
    };

    if (document.readyState !== 'loading') {
        queueMicrotask(init);
    } else {
        init();
    }
})();

// Cleanup on page hide
globalThis.addEventListener('pagehide', () => {
    if (globalThis.postModernizer && typeof globalThis.postModernizer.destroy === 'function') {
        globalThis.postModernizer.destroy();
    }
});
