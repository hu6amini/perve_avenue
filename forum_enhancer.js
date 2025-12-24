// Ultra-Optimized Media Dimension Extractor for deferred loading
// DOM is guaranteed to be ready when this executes (defer attribute)
'use strict';

class MediaDimensionExtractor {
    #observerId = null;
    #processedMedia = new WeakSet();
    #dimensionCache = new Map();
    #lruMap = new Map();
    #imageLoadHandler = null;
    #imageLoadAbortController = new AbortController();
    #cacheHits = 0;
    #cacheMisses = 0;
    #smallContextElements = null;
    #MAX_CACHE_SIZE = 500;

    // Static configurations for better performance
    static #IFRAME_SIZES = new Map([
        ['youtube', ['560', '315']],
        ['youtu', ['560', '315']],
        ['vimeo', ['640', '360']],
        ['soundcloud', ['100%', '166']],
        ['twitter', ['550', '400']],
        ['x.com', ['550', '400']]
    ]);

    static #EMOJI_PATTERNS = [
        /twemoji/iu,
        /emoji/iu,
        /smiley/iu
    ];

    static #SMALL_CONTEXT_SELECTORS = '.modern-quote, .quote-content, .modern-spoiler, .spoiler-content, .signature, .post-signature';
    
    // Precomputed static values
    static #EMOJI_SIZE_NORMAL = 20;
    static #EMOJI_SIZE_SMALL = 18;
    static #BROKEN_IMAGE_SIZE = { width: 600, height: 400 };
    static #BATCH_SIZE = 50;

    constructor() {
        this.#imageLoadHandler = this.#handleImageLoad.bind(this);
        this.#init();
    }

    #init() {
        // Immediate initialization - DOM is ready (defer)
        this.#setupObserver();
        this.#cacheContextElements();
    }

    #cacheContextElements() {
        this.#smallContextElements = new Set(
            document.querySelectorAll(MediaDimensionExtractor.#SMALL_CONTEXT_SELECTORS)
        );
    }

    #setupObserver() {
        if (!globalThis.forumObserver) {
            // Quick retry for observer availability
            setTimeout(() => this.#setupObserver(), 10);
            return;
        }

        // Register with global observer (no page restrictions)
        this.#observerId = globalThis.forumObserver.register({
            id: 'media-dimension-extractor',
            callback: (node) => {
                this.#processMedia(node);
            },
            selector: 'img, iframe, video',
            priority: 'high'
        });

        // Process all existing media using batched approach
        this.#processAllMediaBatched();
    }

    #processAllMediaBatched() {
        const batches = [
            document.images,
            document.getElementsByTagName('iframe'),
            document.getElementsByTagName('video')
        ];
        
        // Process in batches to avoid blocking
        requestAnimationFrame(() => {
            this.#processBatch(batches, 0, 0);
        });
    }

    #processBatch(batches, batchIndex, elementIndex) {
        const BATCH_SIZE = MediaDimensionExtractor.#BATCH_SIZE;
        let processedCount = 0;
        const startTime = performance.now();
        
        while (batchIndex < batches.length && processedCount < BATCH_SIZE) {
            const batch = batches[batchIndex];
            
            while (elementIndex < batch.length && processedCount < BATCH_SIZE) {
                const element = batch[elementIndex];
                if (!this.#processedMedia.has(element)) {
                    this.#processSingleMedia(element);
                    processedCount++;
                }
                elementIndex++;
            }
            
            if (elementIndex >= batch.length) {
                batchIndex++;
                elementIndex = 0;
            }
        }
        
        if (batchIndex < batches.length) {
            requestAnimationFrame(() => {
                this.#processBatch(batches, batchIndex, elementIndex);
            });
        }
    }

    #processMedia(node) {
        if (this.#processedMedia.has(node)) return;

        const tag = node.tagName;

        // Fast tag detection using switch
        switch(tag) {
            case 'IMG':
                this.#processImage(node);
                break;
            case 'IFRAME':
                this.#processIframe(node);
                break;
            case 'VIDEO':
                this.#processVideo(node);
                break;
            default:
                // Handle nested media
                this.#processNestedMedia(node);
        }
    }

    #processNestedMedia(node) {
        const images = node.getElementsByTagName('img');
        const iframes = node.getElementsByTagName('iframe');
        const videos = node.getElementsByTagName('video');

        // Process images
        for (let i = 0, len = images.length; i < len; i++) {
            const img = images[i];
            if (!this.#processedMedia.has(img)) {
                this.#processImage(img);
            }
        }
        
        // Process iframes
        for (let i = 0, len = iframes.length; i < len; i++) {
            const iframe = iframes[i];
            if (!this.#processedMedia.has(iframe)) {
                this.#processIframe(iframe);
            }
        }
        
        // Process videos
        for (let i = 0, len = videos.length; i < len; i++) {
            const video = videos[i];
            if (!this.#processedMedia.has(video)) {
                this.#processVideo(video);
            }
        }
    }

    #processSingleMedia(media) {
        if (this.#processedMedia.has(media)) return;

        const tag = media.tagName;
        
        switch(tag) {
            case 'IMG':
                this.#processImage(media);
                break;
            case 'IFRAME':
                this.#processIframe(media);
                break;
            case 'VIDEO':
                this.#processVideo(media);
                break;
        }

        this.#processedMedia.add(media);
    }

    #processImage(img) {
        // ULTRA-AGGRESSIVE twemoji detection - MUST BE FIRST
        const isTwemoji = img.src.includes('twemoji') || 
                        img.classList.contains('twemoji') ||
                        img.classList.contains('emoji') ||
                        (img.alt && (img.alt.includes(':)') || img.alt.includes(':(') || img.alt.includes('emoji')));
        
        if (isTwemoji) {
            // FORCE twemoji dimensions, ignore everything else
            const size = this.#isInSmallContext(img) ? 
                MediaDimensionExtractor.#EMOJI_SIZE_SMALL : 
                MediaDimensionExtractor.#EMOJI_SIZE_NORMAL;
            
            // Remove any existing dimension attributes first
            img.removeAttribute('width');
            img.removeAttribute('height');
            
            // Set correct dimensions
            img.setAttribute('width', size);
            img.setAttribute('height', size);
            
            // Clear any problematic styles
            let currentStyle = img.style.cssText || '';
            if (currentStyle) {
                // Remove width/height/max-width/max-height styles
                currentStyle = currentStyle
                    .replace(/width[^;]*;/g, '')
                    .replace(/height[^;]*;/g, '')
                    .replace(/max-width[^;]*;/g, '')
                    .replace(/max-height[^;]*;/g, '');
                img.style.cssText = currentStyle;
            }
            
            // Add aspect ratio
            img.style.aspectRatio = size + ' / ' + size;
            
            // Ensure it's visible and properly sized
            img.style.display = 'inline-block';
            img.style.verticalAlign = 'middle';
            
            // Nuke from cache to prevent future issues
            const cacheKey = this.#getCacheKey(img.src);
            this.#dimensionCache.delete(cacheKey);
            this.#lruMap.delete(cacheKey);
            
            // Cache correct dimensions
            this.#cacheDimension(img.src, size, size);
            return;
        }

        // Cache check first (hottest path) - but NOT for emojis
        const cacheKey = this.#getCacheKey(img.src);
        const cached = this.#dimensionCache.get(cacheKey);
        if (cached) {
            this.#cacheHits++;
            if (!img.hasAttribute('width') || !img.hasAttribute('height')) {
                img.setAttribute('width', cached.width);
                img.setAttribute('height', cached.height);
                img.style.aspectRatio = cached.width + ' / ' + cached.height;
            }
            return;
        }
        this.#cacheMisses++;

        // Validate existing attributes
        const widthAttr = img.getAttribute('width');
        const heightAttr = img.getAttribute('height');

        if (widthAttr !== null && heightAttr !== null) {
            const width = widthAttr | 0;
            const height = heightAttr | 0;

            if (width > 0 && height > 0) {
                // Validate against natural dimensions if available
                if (img.complete && img.naturalWidth) {
                    const wDiff = Math.abs(img.naturalWidth - width);
                    const hDiff = Math.abs(img.naturalHeight - height);

                    if (wDiff > width * 0.5 || hDiff > height * 0.5) {
                        // Wrong dimensions - update
                        this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
                        return;
                    }
                }

                img.style.aspectRatio = width + ' / ' + height;
                return;
            }
        }

        // Other emoji detection using modern iteration
        if (this.#isLikelyEmoji(img)) {
            const size = this.#isInSmallContext(img) ? 
                MediaDimensionExtractor.#EMOJI_SIZE_SMALL : 
                MediaDimensionExtractor.#EMOJI_SIZE_NORMAL;
            img.setAttribute('width', size);
            img.setAttribute('height', size);
            img.style.aspectRatio = size + ' / ' + size;
            
            // Cache emoji dimensions
            this.#cacheDimension(img.src, size, size);
            return;
        }
        
        // Handle loading state
        if (img.complete && img.naturalWidth) {
            this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
        } else {
            this.#setupImageLoadListener(img);
        }
    }

    #getCacheKey(src) {
        // Optimize cache keys for common patterns
        if (src.includes('twemoji')) {
            const match = src.match(/(\d+)x\1/);
            return match ? 'emoji:' + match[1] : 'emoji:default';
        }
        
        // For very long URLs, use hash
        if (src.length > 100) {
            return 'h' + this.#hashString(src);
        }
        
        return src;
    }

    #hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash | 0;
        }
        return hash;
    }

    #isLikelyEmoji(img) {
        const src = img.src;
        const className = img.className;
        
        // Use modern iteration with early exit
        return MediaDimensionExtractor.#EMOJI_PATTERNS.some((pattern) => {
            return pattern.test(src) || pattern.test(className);
        }) || (src.includes('imgbox') && img.alt && img.alt.includes('emoji'));
    }

    #isInSmallContext(img) {
        if (!this.#smallContextElements || this.#smallContextElements.size === 0) {
            return false;
        }
        
        // Check ancestors in Set (O(1) lookup)
        let parent = img.parentElement;
        while (parent) {
            if (this.#smallContextElements.has(parent)) {
                return true;
            }
            parent = parent.parentElement;
        }
        return false;
    }

    #setupImageLoadListener(img) {
        // Avoid duplicate listeners
        if (img.__dimensionExtractorHandler) return;

        img.__dimensionExtractorHandler = this.#imageLoadHandler;
        
        // Use AbortController for modern event management
        const signal = this.#imageLoadAbortController.signal;
        img.addEventListener('load', this.#imageLoadHandler, { once: true, signal });
        img.addEventListener('error', this.#imageLoadHandler, { once: true, signal });

        // Prevent layout shift
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
    }

    #handleImageLoad(e) {
        const img = e.target;
        delete img.__dimensionExtractorHandler;

        if (img.naturalWidth) {
            this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
        } else {
            const brokenSize = MediaDimensionExtractor.#BROKEN_IMAGE_SIZE;
            this.#setImageDimensions(img, brokenSize.width, brokenSize.height);
        }
    }

    #setImageDimensions(img, width, height) {
        // Set attributes and styles
        img.setAttribute('width', width);
        img.setAttribute('height', height);
        
        // Update aspect ratio without clearing other styles
        const currentStyle = img.style.cssText || '';
        if (!currentStyle.includes('aspect-ratio')) {
            img.style.cssText = currentStyle + (currentStyle ? ';' : '') + 'aspect-ratio:' + width + '/' + height;
        }

        // Cache with LRU management
        this.#cacheDimension(img.src, width, height);
    }

    #cacheDimension(src, width, height) {
        const cacheKey = this.#getCacheKey(src);
        
        if (this.#dimensionCache.size >= this.#MAX_CACHE_SIZE) {
            // Remove oldest entry using LRU Map
            const oldestEntry = this.#lruMap.entries().next().value;
            if (oldestEntry) {
                this.#dimensionCache.delete(oldestEntry[0]);
                this.#lruMap.delete(oldestEntry[0]);
            }
        }

        this.#dimensionCache.set(cacheKey, { width, height });
        this.#lruMap.set(cacheKey, performance.now());
    }

    #processIframe(iframe) {
        const src = iframe.src || '';
        let width = '100%';
        let height = '400';

        // Use Map.forEach for cleaner iteration
        MediaDimensionExtractor.#IFRAME_SIZES.forEach((sizes, domain) => {
            if (src.includes(domain)) {
                width = sizes[0];
                height = sizes[1];
                return true;
            }
        });

        iframe.setAttribute('width', width);
        iframe.setAttribute('height', height);

        // Create responsive wrapper for fixed sizes
        if (width !== '100%') {
            const widthNum = width | 0;
            const heightNum = height | 0;

            if (widthNum > 0 && heightNum > 0) {
                const parent = iframe.parentNode;
                if (!parent || !parent.classList.contains('iframe-wrapper')) {
                    // Use documentFragment for batch DOM operations
                    const fragment = document.createDocumentFragment();
                    const wrapper = document.createElement('div');
                    wrapper.className = 'iframe-wrapper';
                    const paddingBottom = (heightNum / widthNum * 100) + '%';
                    wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:' + paddingBottom + ';overflow:hidden';

                    fragment.appendChild(wrapper);
                    parent.insertBefore(fragment, iframe);
                    wrapper.appendChild(iframe);
                    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0';
                }
            }
        }

        if (!iframe.hasAttribute('title')) {
            iframe.setAttribute('title', 'Embedded content');
        }
    }

    #processVideo(video) {
        // Add controls if missing
        if (!video.hasAttribute('controls')) {
            video.setAttribute('controls', '');
        }

        // Set default dimensions if not already set
        if (!video.style.width) {
            video.style.width = '100%';
            video.style.maxWidth = '800px';
            video.style.height = 'auto';
        }
    }

    #cleanup() {
        // Unregister from forum observer
        if (globalThis.forumObserver && this.#observerId) {
            globalThis.forumObserver.unregister(this.#observerId);
        }

        // Abort all pending event listeners
        this.#imageLoadAbortController.abort();

        // Clean up event handlers
        const images = document.images;
        for (let i = 0, len = images.length; i < len; i++) {
            const img = images[i];
            if (img.__dimensionExtractorHandler) {
                delete img.__dimensionExtractorHandler;
            }
        }
    }

    // Public API methods
    extractDimensionsForElement(element) {
        if (!element) return;

        if (element.matches('img, iframe, video')) {
            this.#processSingleMedia(element);
        } else {
            this.#processNestedMedia(element);
        }
    }

    forceReprocessElement(element) {
        if (!element) return;
        
        // Remove from processed set
        this.#processedMedia.delete(element);
        
        // Remove from cache if it exists
        const cacheKey = this.#getCacheKey(element.src);
        if (this.#dimensionCache.has(cacheKey)) {
            this.#dimensionCache.delete(cacheKey);
            this.#lruMap.delete(cacheKey);
        }
        
        // Reprocess the element
        this.#processSingleMedia(element);
    }

    clearCache() {
        this.#dimensionCache.clear();
        this.#lruMap.clear();
        this.#cacheHits = 0;
        this.#cacheMisses = 0;
    }

    getPerformanceStats() {
        const total = this.#cacheHits + this.#cacheMisses;
        const hitRate = total > 0 ? ((this.#cacheHits / total) * 100).toFixed(1) : 0;

        return {
            cacheHits: this.#cacheHits,
            cacheMisses: this.#cacheMisses,
            cacheHitRate: hitRate + '%',
            cacheSize: this.#dimensionCache.size,
            processedMedia: this.#processedMedia.size
        };
    }

    destroy() {
        this.#cleanup();
    }
}

// ============================================
// INITIALIZATION - Optimized for defer loading
// ============================================

// Deferred scripts execute after DOM is ready, no need for DOMContentLoaded
if (!globalThis.mediaDimensionExtractor) {
    try {
        globalThis.mediaDimensionExtractor = new MediaDimensionExtractor();
    } catch (error) {
        // Single retry after short delay using requestIdleCallback
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                if (!globalThis.mediaDimensionExtractor) {
                    try {
                        globalThis.mediaDimensionExtractor = new MediaDimensionExtractor();
                    } catch (retryError) {
                        // Silent fail
                    }
                }
            }, { timeout: 50 });
        } else {
            setTimeout(() => {
                if (!globalThis.mediaDimensionExtractor) {
                    try {
                        globalThis.mediaDimensionExtractor = new MediaDimensionExtractor();
                    } catch (retryError) {
                        // Silent fail
                    }
                }
            }, 50);
        }
    }
}

// Optional cleanup (browser handles most cleanup automatically)
globalThis.addEventListener('pagehide', () => {
    if (globalThis.mediaDimensionExtractor && typeof globalThis.mediaDimensionExtractor.destroy === 'function') {
        // Use requestIdleCallback for non-blocking cleanup
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                globalThis.mediaDimensionExtractor.destroy();
            });
        } else {
            setTimeout(() => {
                globalThis.mediaDimensionExtractor.destroy();
            }, 0);
        }
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



//Timestamps
function initTimestampScript() {
    const t = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const e = document.body.classList.contains("guest");
    
    function i(e) {
        const i = String(e).trim();
        if (i.includes("T") && (i.includes("+") || i.includes("Z"))) {
            const t = moment(i);
            if (t.isValid()) return t;
        }
        const r = ["M/D/YYYY, h:mm A", "M/D/YYYY, h:mm:ss A", "D/M/YYYY, HH:mm", "D/M/YYYY, HH:mm:ss", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DDTHH:mm:ss", "YYYY/MM/DD HH:mm:ss", "MMMM D, YYYY, h:mm A", "MMM D, YYYY, h:mm A", "YYYY-MM-DD", "M/D/YYYY", "D/M/YYYY"];
        for (const e of r) {
            const r = moment(i, e, !0);
            if (r.isValid()) return r;
        }
        for (const e of r) {
            const r = moment(i, e, !1);
            if (r.isValid()) return r;
        }
        const o = moment(i, moment.ISO_8601, !0);
        return o.isValid() ? o : moment.invalid();
    }
    
    function r(t) {
        if (!t || !t.isValid()) return "Invalid date";
        var e = moment(),
            i = e.diff(t, "hours");
        return i < 24 ? t.fromNow() : i < 48 ? "Yesterday at " + t.format("h:mm A") : i < 168 ? t.format("dddd [at] h:mm A") : t.format("MMM D, YYYY");
    }
    
    function o(t) {
        return !t || !t.isValid() ? "Invalid date" : t.format("MMM, YYYY");
    }
    
    function a(e, i) {
        try {
            var r = moment.tz(e, i, "Europe/Rome");
            return r.isValid() ? r.clone().tz(t) : null;
        } catch (t) {
            return null;
        }
    }
    
    function n(t) {
        try {
            if (!t) return !1;
            const e = t.querySelector(".d_day"),
                i = t.querySelector(".d_month"),
                r = t.querySelector(".d_year");
            return e && i && r && "" === i.textContent.trim() && "" !== r.textContent.trim() && !t.textContent.includes(":");
        } catch (t) {
            return !1;
        }
    }
    
    function m(t) {
        try {
            const e = t.querySelector(".d_day"),
                i = t.querySelector(".d_year");
            if (!e || !i) return null;
            const r = parseInt(e.textContent.trim()),
                o = i.textContent.trim();
            if (isNaN(r) || !o) return null;
            const a = moment({
                year: o,
                month: r - 1
            });
            return a.isValid() ? a : null;
        } catch (t) {
            return null;
        }
    }
    
    function l(t) {
        try {
            if (t.classList.contains("timestamp-processed")) return;
            var e = t.getAttribute("datetime") || t.getAttribute("title") || t.textContent.trim(),
                o = i(e);
            if (o.isValid()) {
                var a = document.createElement("time");
                a.className = "u-dt";
                a.setAttribute("dir", "auto");
                a.setAttribute("datetime", o.format());
                a.setAttribute("title", o.format("MMM D, YYYY [at] h:mm A"));
                a.textContent = r(o);
                a.style.visibility = "visible";
                a.classList.add("timestamp-processed");
                t.replaceWith(a);
            }
        } catch (t) {}
    }
    
    function c(t) {
        try {
            var e = t.textContent.trim(),
                r = e.match(/^(Edited by .+?) - (.+)$/);
            if (r) {
                var o = r[1],
                    a = r[2],
                    n = i(a);
                if (n.isValid()) {
                    var m = n.format("MMM D, YYYY");
                    t.textContent = o + ": " + m;
                    var l = document.createElement("time");
                    l.className = "u-dt";
                    l.setAttribute("datetime", n.format());
                    l.setAttribute("title", n.format("MMM D, YYYY [at] h:mm A"));
                    l.textContent = m;
                    t.innerHTML = o + ": ";
                    t.appendChild(l);
                    t.style.visibility = "visible";
                }
            }
        } catch (t) {}
    }
    
    function s(t) {
        try {
            var e = t.querySelector(".when");
            if (!e) return;
            var r = e.textContent.trim(),
                o = i(r);
            if (!o.isValid()) return;
            var a = document.createElement("time");
            a.className = "u-dt";
            a.setAttribute("datetime", o.format());
            a.setAttribute("title", o.format("MMM D, YYYY [at] h:mm A"));
            a.textContent = o.format("MMM D, YYYY");
            a.style.visibility = "visible";
            e.replaceWith(a);
        } catch (t) {}
    }
    
    function u(t) {
        try {
            if (!document.body.matches("#online")) return;
            var e = t.textContent.trim(),
                o = i(e);
            if (o.isValid()) {
                var a = document.createElement("time");
                a.className = "u-dt";
                a.classList.add("when");
                a.setAttribute("dir", "auto");
                a.setAttribute("datetime", o.format());
                a.setAttribute("title", o.format("MMM D, YYYY [at] h:mm A"));
                a.textContent = r(o);
                a.style.visibility = "visible";
                t.replaceWith(a);
            }
        } catch (t) {}
    }
    
    function d(t) {
        try {
            if (!document.body.matches("#blog")) return;
            if (n(t)) {
                var e = m(t);
                if (e && e.isValid()) {
                    var a = document.createElement("time");
                    a.className = "u-dt";
                    a.classList.add("when");
                    a.setAttribute("dir", "auto");
                    a.setAttribute("datetime", e.format());
                    a.setAttribute("title", e.format("MMM, YYYY"));
                    a.textContent = o(e);
                    a.style.visibility = "visible";
                    t.replaceWith(a);
                    return;
                }
            }
            var l = t.querySelector(".d_day") ? t.querySelector(".d_day").textContent.trim() : "",
                c = t.querySelector(".d_month") ? t.querySelector(".d_month").textContent.trim() : "",
                s = t.querySelector(".d_year") ? t.querySelector(".d_year").textContent.trim() : "";
            c = c.replace(/([A-Za-z]+).*/, "$1");
            var u = s + "-" + c + "-" + l,
                e = moment(u, "YYYY-MMM-DD", !0);
            e.isValid() || (e = i(u));
            e.isValid() && (a = document.createElement("time"), a.className = "u-dt", a.classList.add("when"), a.setAttribute("dir", "auto"), a.setAttribute("datetime", e.format()), a.setAttribute("title", e.format("MMM D, YYYY [at] h:mm A")), a.textContent = r(e), a.style.visibility = "visible", t.replaceWith(a));
        } catch (t) {}
    }
    
    function f(t) {
        try {
            if (n(t)) {
                var e = m(t);
                if (e && e.isValid()) {
                    var a = document.createElement("time");
                    a.className = "u-dt";
                    a.classList.add("when");
                    a.setAttribute("dir", "auto");
                    a.setAttribute("datetime", e.format());
                    a.setAttribute("title", e.format("MMM, YYYY"));
                    a.textContent = o(e);
                    a.style.visibility = "visible";
                    t.replaceWith(a);
                    return;
                }
            }
            var l = t.querySelector(".d_day") ? t.querySelector(".d_day").textContent.trim() : "",
                c = t.querySelector(".d_month") ? t.querySelector(".d_month").textContent.trim() : "",
                s = t.querySelector(".d_year") ? t.querySelector(".d_year").textContent.trim() : "";
            c = c.replace(/([A-Za-z]+).*/, "$1");
            var u = s + "-" + c + "-" + l,
                e = moment(u, "YYYY-MMM-DD", !0);
            e.isValid() || (e = i(u));
            e.isValid() && (a = document.createElement("time"), a.className = "u-dt", a.classList.add("when"), a.setAttribute("dir", "auto"), a.setAttribute("datetime", e.format()), a.setAttribute("title", e.format("MMM D, YYYY [at] h:mm A")), a.textContent = r(e), a.style.visibility = "visible", t.replaceWith(a));
        } catch (t) {}
    }
    
    function Y(t) {
        try {
            if (!document.body.matches("#group, #members")) return;
            var e = t.textContent.trim(),
                r = i(e);
            if (r.isValid()) {
                var o = document.createElement("time");
                o.className = "u-dt";
                o.classList.add("cc");
                o.setAttribute("dir", "auto");
                o.setAttribute("datetime", r.format());
                o.setAttribute("title", r.format("MMM D, YYYY"));
                o.textContent = r.format("MMM D, YYYY");
                o.style.visibility = "visible";
                t.replaceWith(o);
            }
        } catch (t) {}
    }
    
    function h(t) {
        try {
            if (!document.body.matches("#blog")) return;
            var e = t.getAttribute("title") || t.textContent.trim();
            e = e.split(":").slice(0, -1).join(":").trim();
            var o = i(e);
            if (o.isValid()) {
                var a = document.createElement("time");
                a.className = "u-dt";
                a.classList.add("when");
                a.setAttribute("dir", "auto");
                a.setAttribute("datetime", o.format());
                a.setAttribute("title", o.format("MMM D, YYYY [at] h:mm A"));
                a.textContent = r(o);
                a.style.visibility = "visible";
                t.replaceWith(a);
            }
        } catch (t) {}
    }
    
    function y(t) {
        try {
            if (t.classList.contains("timestamp-processed")) return;
            if (!document.body.matches("#board")) return;
            var e = t.lastChild;
            if (!e || e.nodeType !== Node.TEXT_NODE) return;
            var i = e.textContent.trim(),
                o = a(i, "D/M/YYYY, HH:mm");
            if (!o) return;
            var n = document.createElement("time");
            n.className = "u-dt when";
            n.setAttribute("dir", "auto");
            n.setAttribute("datetime", o.format());
            n.setAttribute("title", o.format("MMM D, YYYY [at] h:mm A"));
            n.textContent = r(o);
            n.style.visibility = "visible";
            n.classList.add("timestamp-processed");
            t.replaceWith(n);
        } catch (t) {}
    }
    
    function b(t) {
        try {
            if (t.classList.contains("timestamp-processed")) return;
            var e = t.lastChild;
            if (!e || e.nodeType !== Node.TEXT_NODE) return;
            var i = e.textContent.trim(),
                o = a(i, "D/M/YYYY, HH:mm");
            if (!o) return;
            var n = document.createElement("time");
            n.className = "u-dt when";
            n.setAttribute("dir", "auto");
            n.setAttribute("datetime", o.format());
            n.setAttribute("title", o.format("MMM D, YYYY [at] h:mm A"));
            n.textContent = r(o);
            n.style.visibility = "visible";
            n.classList.add("timestamp-processed");
            t.replaceWith(n);
        } catch (t) {}
    }
    
    function M(t) {
        try {
            var e = t.getAttribute("datetime") || t.textContent.trim();
            if (t.classList.contains("st-emoji-epost-time")) {
                var i = moment(e, "YYYY/MM/DD HH:mm", !0);
                if (i && i.isValid()) {
                    t.textContent = r(i);
                    t.setAttribute("datetime", i.format());
                    t.setAttribute("title", i.format("MMM D, YYYY [at] h:mm A"));
                    t.style.visibility = "visible";
                }
                return;
            }
            var o = a(e, "YYYY/MM/DD HH:mm");
            if (!o) return;
            t.textContent = r(o);
            t.setAttribute("datetime", o.format());
            t.setAttribute("title", o.format("MMM D, YYYY [at] h:mm A"));
            t.style.visibility = "visible";
        } catch (t) {}
    }
    
    function v(t) {
        try {
            var e = t.textContent.trim(),
                i = moment(e, "YYYY/MM/DD HH:mm", !0);
            if (i && i.isValid()) {
                var o = document.createElement("time");
                o.className = "u-dt st-emoji-post-time";
                o.setAttribute("dir", "auto");
                o.setAttribute("datetime", i.format());
                o.setAttribute("title", i.format("MMM D, YYYY [at] h:mm A"));
                o.textContent = r(i);
                o.style.visibility = "visible";
                t.replaceWith(o);
            }
        } catch (t) {}
    }
    
    function A(t, e) {
        try {
            if (t.closest(".edit")) return;
            if (t.classList.contains("timeago")) return;
            if (".big_list .zz .when" === e && !document.body.matches("#board, #forum, #blog, #search")) return;
            if (".post .title2.top .when" === e && !document.body.matches("#topic, #search, #blog")) return;
            if (".summary .when" === e && !document.body.matches("#send")) return;
            if (".article .title2.top .when" === e && !document.body.matches("#blog")) return;
            var o = t.getAttribute("title") || t.textContent.trim();
            t.children.length && "SPAN" === t.children[0].tagName && (o = t.childNodes[t.childNodes.length - 1].textContent.trim());
            var a = i(o);
            if (a.isValid()) {
                if (t.classList.contains("st-emoji-notice-time") || t.classList.contains("st-emoji-epost-time")) M(t);
                else {
                    var n = document.createElement("time");
                    n.className = "u-dt";
                    t.classList.contains("when") && n.classList.add("when");
                    t.classList.contains("Item") && n.classList.add("Item");
                    n.setAttribute("dir", "auto");
                    n.setAttribute("datetime", a.format());
                    n.setAttribute("title", a.format("MMM D, YYYY [at] h:mm A"));
                    n.textContent = r(a);
                    n.style.visibility = "visible";
                    n.classList.add("timestamp-processed");
                    t.replaceWith(n);
                }
            }
        } catch (t) {}
    }

    // Main processing function that replaces the original p() function
    function processTimestampElements() {
        try {
            // Process existing elements on page load
            document.querySelectorAll("dl.profile-joined, dl.profile-lastaction").forEach(s);
            document.querySelectorAll(".timeago").forEach(l);
            document.querySelectorAll(".post .edit").forEach(c);
            document.querySelectorAll(".st-emoji-post-time").forEach(v);
            
            if (document.body.matches("#online")) {
                document.querySelectorAll(".online .yy .when").forEach(u);
            }
            
            if (document.body.matches("#blog")) {
                document.querySelectorAll(".article .title2.top .when").forEach(d);
                document.querySelectorAll(".bt_mini .when").forEach(f);
                document.querySelectorAll(".mini_buttons .when").forEach(h);
            }
            
            if (document.body.matches("#group, #members")) {
                document.querySelectorAll(".big_list .cc").forEach(Y);
            }
            
            if (document.body.matches("#board")) {
                document.querySelectorAll(".side_topics .when").forEach(y);
            }
            
            document.querySelectorAll(".lastarticles .topic .when").forEach(b);
            document.querySelectorAll(".st-emoji-epost-time, .st-emoji-notice-time").forEach(M);
            
            var selectors = [
                ".big_list .zz .when",
                ".post-date", 
                ".time",
                ".date",
                ".post .title2.top .when",
                ".summary .when"
            ];
            
            for (var e = 0; e < selectors.length; e++) {
                var selector = selectors[e];
                document.querySelectorAll(selector).forEach(function(t) {
                    A(t, selector);
                });
            }
        } catch (t) {}
    }

    // Register callbacks with ForumCoreObserver
    function registerWithForumObserver() {
        if (!globalThis.forumObserver || !globalThis.registerForumScript) {
            console.error('ForumCoreObserver not available. Timestamp script cannot initialize.');
            return;
        }

        // Register callbacks for different element types
        const callbacks = [
            {
                id: 'timestamp-timeago',
                selector: '.timeago',
                callback: l,
                priority: 'normal'
            },
            {
                id: 'timestamp-post-edit',
                selector: '.post .edit',
                callback: c,
                priority: 'normal'
            },
            {
                id: 'timestamp-emoji-post-time',
                selector: '.st-emoji-post-time',
                callback: v,
                priority: 'normal'
            },
            {
                id: 'timestamp-online-when',
                selector: '.online .yy .when',
                callback: function(node) {
                    if (document.body.matches("#online")) u(node);
                },
                priority: 'normal'
            },
            {
                id: 'timestamp-blog-article-when',
                selector: '.article .title2.top .when',
                callback: function(node) {
                    if (document.body.matches("#blog")) d(node);
                },
                priority: 'normal'
            },
            {
                id: 'timestamp-blog-bt-mini',
                selector: '.bt_mini .when',
                callback: function(node) {
                    if (document.body.matches("#blog")) f(node);
                },
                priority: 'normal'
            },
            {
                id: 'timestamp-blog-mini-buttons',
                selector: '.mini_buttons .when',
                callback: function(node) {
                    if (document.body.matches("#blog")) h(node);
                },
                priority: 'normal'
            },
            {
                id: 'timestamp-group-cc',
                selector: '.big_list .cc',
                callback: function(node) {
                    if (document.body.matches("#group, #members")) Y(node);
                },
                priority: 'normal'
            },
            {
                id: 'timestamp-board-side-topics',
                selector: '.side_topics .when',
                callback: function(node) {
                    if (document.body.matches("#board")) y(node);
                },
                priority: 'normal'
            },
            {
                id: 'timestamp-lastarticles-topic',
                selector: '.lastarticles .topic .when',
                callback: b,
                priority: 'normal'
            },
            {
                id: 'timestamp-emoji-notice',
                selector: '.st-emoji-epost-time, .st-emoji-notice-time',
                callback: M,
                priority: 'normal'
            },
            {
                id: 'timestamp-profile-joined',
                selector: 'dl.profile-joined, dl.profile-lastaction',
                callback: s,
                priority: 'normal'
            }
        ];

        // Register general timestamp selectors with conditional logic
        const generalSelectors = [
            ".big_list .zz .when",
            ".post-date", 
            ".time",
            ".date",
            ".post .title2.top .when",
            ".summary .when"
        ];

        generalSelectors.forEach((selector, index) => {
            globalThis.registerForumScript({
                id: `timestamp-general-${index}`,
                selector: selector,
                callback: function(node) {
                    A(node, selector);
                },
                priority: 'normal'
            });
        });

        // Register all callbacks
        callbacks.forEach(callback => {
            globalThis.registerForumScript(callback);
        });

        console.log('✅ Timestamp script registered with ForumCoreObserver');
    }

    // Initialize function
    function init() {
        // Process existing elements first
        processTimestampElements();
        
        // Register with ForumCoreObserver for dynamic content
        registerWithForumObserver();
    }

    // Start initialization
    init();
}

function waitForMoment() {
    if ("undefined" != typeof moment && "undefined" != typeof moment.tz) {
        initTimestampScript();
    } else {
        setTimeout(waitForMoment, 50);
    }
}

// Start the script
waitForMoment();
