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
    // Cache context elements immediately
    this.#cacheContextElements();
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
            img.style.verticalAlign = 'text-bottom';
            
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
    // Quick check: if we don't have the cache yet, build it
    if (!this.#smallContextElements || this.#smallContextElements.size === 0) {
        this.#cacheContextElements();
    }
    
    // Check all ancestors
    let element = img;
    while (element) {
        // Check if element has any of the signature-related classes
        if (element.classList) {
            const classList = element.classList;
            if (classList.contains('signature') || 
                classList.contains('post-signature') ||
                classList.contains('modern-quote') ||
                classList.contains('quote-content') ||
                classList.contains('modern-spoiler') ||
                classList.contains('spoiler-content')) {
                return true;
            }
            
            // Also check if element matches any in our pre-cached Set
            if (this.#smallContextElements && this.#smallContextElements.has(element)) {
                return true;
            }
        }
        element = element.parentElement;
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


// Enhanced Menu Modernizer - Fixed for proper extraction and no duplicates 
class EnhancedMenuModernizer { 
 #observerId = null; 
 #mobileState = false; 
 #originalMenu = null; 
 #modernMenuWrap = null; 
 #processedMenus = new Set(); 
 #retryCount = 0; 
 #maxRetries = 10; 
 
 // Better icon mappings 
 #iconMappings = { 
 // User menu 
 'Notifications from scripts': 'fa-bell', 
 'Edit Profile info': 'fa-user-pen', 
 'Edit Avatar Settings': 'fa-image', 
 'Edit Signature': 'fa-signature', 
 'My album': 'fa-images', 
 'Forum Settings': 'fa-sliders-h', 
 'Email Settings and Notifications': 'fa-envelope', 
 'Change Password': 'fa-key', 
 'Log Out': 'fa-right-from-bracket', 
 
 // Messenger 
 'Messenger': 'fa-message', 
 'Send New PM': 'fa-paper-plane', 
 'Go to Inbox': 'fa-inbox', 
 'Edit Folders': 'fa-folder', 
 'Archive Messages': 'fa-box-archive', 
 'Contact List': 'fa-address-book', 
 'Notepad': 'fa-note-sticky', 
 
 // Topics 
 'Topics': 'fa-comments', 
 'Active topics': 'fa-bolt', 
 'Popular topics': 'fa-fire', 
 'Subscriptions': 'fa-bookmark', 
 'Notification centre': 'fa-bell', 
 'Mark all as read': 'fa-check-double', 
 'My topics': 'fa-file', 
 'My posts': 'fa-comment', 
 'Subscribe to the forum': 'fa-bell', 
 'Unsubscribe from this topic': 'fa-bell-slash', 
 'Newsletter': 'fa-newspaper', 
 
 // Administration sections 
 'Website': 'fa-globe', 
 'Users': 'fa-users', 
 'Graphic': 'fa-palette', 
 'Additional features': 'fa-puzzle-piece', 
 
 // Moderation 
 'Moderation': 'fa-gavel', 
 'Topics selected': 'fa-list-check', 
 'Section': 'fa-folder-open', 
 
 // Tools & Help 
 'Members': 'fa-users', 
 'Help': 'fa-circle-question', 
 'Search': 'fa-magnifying-glass', 
 'Create your forum': 'fa-plus', 
 'Create your blog': 'fa-blog', 
 'Home ForumCommunity': 'fa-house', 
 'Android App': 'fa-android', 
 'ForumCommunity Mobile': 'fa-mobile', 
 'Last posts': 'fa-clock-rotate-left', 
 'News': 'fa-newspaper', 
 'Top Forum': 'fa-trophy', 
 'Top Blog': 'fa-award', 
 'Add to bookmarks': 'fa-bookmark', 
 'set categories': 'fa-tags' 
 }; 
 
 constructor() { 
 this.#init(); 
 } 
 
 #init() { 
 if (!this.#shouldModernize()) return; 
 
 this.#originalMenu = document.querySelector('.menuwrap'); 
 if (!this.#originalMenu) { 
 // Wait for menu to load 
 setTimeout(() => this.#init(), 100); 
 return; 
 } 
 
 this.createModernMenu(); 
 this.#setupObserver(); 
 this.setupEventListeners(); 
 
 console.log('&#9989; Enhanced Menu Modernizer initialized'); 
 } 
 
 #setupObserver() { 
 if (!globalThis.forumObserver) { 
 setTimeout(() => this.#setupObserver(), 100); 
 return; 
 } 
 
 this.#observerId = globalThis.forumObserver.register({ 
 id: 'enhanced-menu-modernizer', 
 callback: (node) => this.#handleMenuUpdates(node), 
 selector: '.menuwrap, .menu em, .st-emoji-notice, a[id^="i"], a[id^="n"]', 
 priority: 'critical', 
 pageTypes: ['topic', 'forum', 'blog', 'profile', 'search', 'board'] 
 }); 
 } 
 
 #handleMenuUpdates(node) { 
 if (!node) return; 
 
 // Hide original menu if it reappears 
 if (node.matches('.menuwrap') && node.style.display !== 'none') { 
 node.style.display = 'none'; 
 } 
 
 // Update notification badges 
 if (node.matches('em') || node.querySelector('em')) { 
 this.updateNotificationBadges(); 
 } 
 
 // Update emoji reactions 
 if (node.matches('.st-emoji-notice') || node.querySelector('.st-emoji-notice')) { 
 this.updateReactionsMenu(); 
 } 
 } 
 
 #shouldModernize() { 
 if (document.body.id === 'login' || document.body.id === 'register') { 
 return false; 
 } 
 
 if (document.querySelector('.modern-menu-wrap')) { 
 return false; 
 } 
 
 return true; 
 } 
 
 createModernMenu() { 
 if (document.querySelector('.modern-menu-wrap')) return; 
 
 // Hide original menu 
 this.#originalMenu.style.display = 'none'; 
 
 // Create modern menu structure 
 const menuWrap = document.createElement('div'); 
 menuWrap.className = 'modern-menu-wrap'; 
 this.#modernMenuWrap = menuWrap; 
 
 const menu = document.createElement('nav'); 
 menu.className = 'modern-menu'; 
 
 // Extract all menu items from original 
 const leftMenus = this.#extractLeftMenus(); 
 const rightMenus = this.#extractRightMenus(); 
 
 // Build menu structure 
 menu.innerHTML = '<div class="menu-left">' + 
 leftMenus.join('') + 
 '</div>' + 
 '<div class="menu-right">' + 
 rightMenus.join('') + 
 this.#extractSearch() + 
 '</div>'; 
 
 menuWrap.appendChild(menu); 
 
 // Add mobile toggle 
 const mobileToggle = document.createElement('button'); 
 mobileToggle.className = 'mobile-menu-toggle'; 
 mobileToggle.setAttribute('aria-label', 'Open menu'); 
 mobileToggle.innerHTML = '<i class="fa-regular fa-bars" aria-hidden="true"></i>'; 
 mobileToggle.addEventListener('click', () => this.openMobileMenu()); 
 menu.appendChild(mobileToggle); 
 
 // Insert at the beginning of the Fixed container 
 const fixedContainer = document.querySelector('.Fixed'); 
 if (fixedContainer && fixedContainer.firstChild) { 
 fixedContainer.insertBefore(menuWrap, fixedContainer.firstChild); 
 } else { 
 document.body.insertBefore(menuWrap, document.body.firstChild); 
 } 
 
 // Create mobile overlay 
 this.createMobileOverlay(); 
 
 // Initial updates 
 this.updateNotificationBadges(); 
 this.updateReactionsMenu(); 
 } 
 
 #extractLeftMenus() { 
 const leftUl = this.#originalMenu.querySelector('ul.left'); 
 if (!leftUl) return []; 
 
 const menuItems = []; 
 const menus = leftUl.querySelectorAll('li.menu'); 
 
 menus.forEach((menu, index) => { 
 // Skip if already processed 
 if (this.#processedMenus.has(menu)) return; 
 this.#processedMenus.add(menu); 
 
 const menuHTML = this.#extractSingleMenu(menu, index); 
 if (menuHTML) { 
 menuItems.push(menuHTML); 
 } 
 }); 
 
 return menuItems; 
 } 
 
 #extractRightMenus() { 
 const rightUl = this.#originalMenu.querySelector('ul.right'); 
 if (!rightUl) return []; 
 
 const menuItems = []; 
 const menus = rightUl.querySelectorAll('li.menu'); 
 
 menus.forEach((menu, index) => { 
 if (this.#processedMenus.has(menu)) return; 
 this.#processedMenus.add(menu); 
 
 const menuHTML = this.#extractRightMenu(menu, index); 
 if (menuHTML) { 
 menuItems.push(menuHTML); 
 } 
 }); 
 
 return menuItems; 
 } 
 
 #extractSingleMenu(menuElement, index) { 
 const link = menuElement.querySelector('a'); 
 if (!link) return ''; 
 
 const linkText = link.textContent.trim(); 
 const linkHref = link.getAttribute('href') || '#'; 
 
 // Check for Reactions menu FIRST (st-emoji-notice class) 
 if (menuElement.classList.contains('st-emoji-notice')) { 
 return this.#extractReactionsMenu(menuElement); 
 } 
 
 // Check for Notifications menu (has id starting with "n") 
 if (link.id && link.id.startsWith('n')) { 
 return this.#extractNotificationsMenu(menuElement); 
 } 
 
 // Check for user menu 
 if (link.classList.contains('user11517378') || menuElement.querySelector('.avatar')) { 
 return this.#extractUserMenu(menuElement); 
 } 
 
 // Check for Messenger menu (has id starting with "i") 
 if (link.id && link.id.startsWith('i')) { 
 return this.#extractMessengerMenu(menuElement); 
 } 
 
 if (linkText === 'Topics' || (linkHref.includes('UserCP') && linkHref.includes('CODE=26'))) { 
 return this.#extractTopicsMenu(menuElement); 
 } 
 
 if (linkText === 'Administration' || linkHref.includes('forumcommunity.net/?cid=')) { 
 return this.#extractAdminMenu(menuElement); 
 } 
 
 if (linkText === 'Moderation' || !linkHref || linkHref === '#') { 
 return this.#extractModerationMenu(menuElement); 
 } 
 
 // Default simple menu 
 return this.#extractSimpleMenu(menuElement); 
 } 
 
 #extractUserMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const avatar = link.querySelector('.avatar img'); 
 const username = link.querySelector('.nick'); 
 const dropdownItems = menuElement.querySelectorAll('ul li a'); 
 
 const avatarSrc = avatar ? (avatar.src || avatar.getAttribute('src')) : 
 'https://img.forumfree.net/style_images/default_avatar.png'; 
 const usernameText = username ? username.textContent.trim() : 'User'; 
 
 // Build dropdown items 
 let dropdownHTML = ''; 
 let sectionCount = 0; 
 
 dropdownItems.forEach((item, index) => { 
 const text = item.textContent.trim(); 
 if (!text || text === '') return; 
 
 // First item is "Notifications from scripts" 
 if (index === 0) { 
 dropdownHTML += '<div class="dropdown-section">' + 
 '<a href="' + (item.getAttribute('href') || 'javascript:void(0)') + '" class="dropdown-item with-icon sn-open-modal">' + 
 '<i class="fa-regular fa-bell" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>' + 
 '</div>'; 
 sectionCount++; 
 } 
 // Profile settings (items 1-7) 
 else if (index >= 1 && index <= 7) { 
 if (index === 1) { 
 dropdownHTML += '<div class="dropdown-section">'; 
 } 
 
 const icon = this.#getIconForText(text); 
 dropdownHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>'; 
 
 if (index === 7) { 
 dropdownHTML += '</div>'; 
 sectionCount++; 
 } 
 } 
 // Logout (last item) 
 else if (index === dropdownItems.length - 1 && text.toLowerCase().includes('log out')) { 
 dropdownHTML += '<div class="dropdown-section">' + 
 '<form name="Logout" action="/" method="post" style="display:none">' + 
 '<input type="hidden" name="act" value="Login">' + 
 '<input type="hidden" name="CODE" value="03">' + 
 '</form>' + 
 '<button onclick="if(document.forms.Logout)document.forms.Logout.*submit()" class="dropdown-item with-icon logout">' + 
 '<i class="fa-regular fa-right-from-bracket" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</button>' + 
 '</div>'; 
 sectionCount++; 
 } 
 }); 
 
 // Extract user role 
 let userRole = 'Member'; 
 const roleElement = this.#originalMenu.querySelector('.amministratore, .moderatore, .founder'); 
 if (roleElement) { 
 userRole = roleElement.textContent.trim(); 
 } 
 
 return '<div class="menu-item user-menu">' + 
 '<button class="menu-trigger user-trigger">' + 
 '<div class="user-avatar">' + 
 '<img src="' + this.#escapeHtml(avatarSrc) + '" alt="' + this.#escapeHtml(usernameText) + '" loading="lazy">' + 
 '</div>' + 
 '<span class="username">' + this.#escapeHtml(usernameText) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown user-dropdown">' + 
 '<div class="dropdown-header">' + 
 '<div class="user-avatar large">' + 
 '<img src="' + this.#escapeHtml(avatarSrc) + '" alt="' + this.#escapeHtml(usernameText) + '" loading="lazy">' + 
 '</div>' + 
 '<div class="user-info">' + 
 '<div class="username">' + this.#escapeHtml(usernameText) + '</div>' + 
 '<div class="user-role">' + this.#escapeHtml(userRole) + '</div>' + 
 '</div>' + 
 '</div>' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractMessengerMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const em = link.querySelector('em'); 
 const count = em ? em.textContent.trim() : ''; 
 const text = link.textContent.replace(count, '').trim(); 
 
 return '<div class="menu-item">' + 
 '<a href="' + this.#escapeHtml(link.getAttribute('href') || '#') + '" class="menu-link with-icon" id="modern-messenger">' + 
 '<i class="fa-regular fa-message" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '</a>' + 
 '</div>'; 
 } 
 
 #extractTopicsMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const text = link.textContent.trim(); 
 const dropdownItems = menuElement.querySelectorAll('ul li a'); 
 
 let dropdownHTML = ''; 
 let hasDivider = false; 
 
 dropdownItems.forEach((item, index) => { 
 const itemText = item.textContent.trim(); 
 if (!itemText || itemText === '' || itemText.toLowerCase().includes('topics planned')) return; 
 
 const icon = this.#getIconForText(itemText); 
 const href = item.getAttribute('href') || '#'; 
 
 // Add divider before "Notification centre" 
 if (itemText.toLowerCase().includes('notification centre') && !hasDivider) { 
 dropdownHTML += '<div class="dropdown-divider"></div>'; 
 hasDivider = true; 
 } 
 // Add another divider before "Mark all as read" 
 else if (itemText.toLowerCase().includes('mark all as read') && hasDivider) { 
 dropdownHTML += '<div class="dropdown-divider"></div>'; 
 } 
 
 // Special handling for JavaScript actions 
 if (href.startsWith('javascript:')) { 
 const jsCode = href.substring(11); 
 dropdownHTML += '<button onclick="' + this.#escapeHtml(jsCode) + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(itemText) + '</span>' + 
 '</button>'; 
 } else { 
 dropdownHTML += '<a href="' + this.#escapeHtml(href) + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(itemText) + '</span>' + 
 '</a>'; 
 } 
 }); 
 
 return '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-comments" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractAdminMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const text = link.textContent.trim(); 
 const submenus = menuElement.querySelectorAll('.submenu'); 
 
 // Check if we have 3+ submenus for mega menu 
 if (submenus.length >= 3) { 
 const sectionTitles = ['Website', 'Users', 'Graphic']; 
 let megaColumns = ''; 
 
 submenus.forEach((submenu, index) => { 
 if (index >= 3) return; // Only take first 3 
 
 const items = submenu.querySelectorAll('ul li a'); 
 let columnHTML = '<div class="mega-column"><h4>' + sectionTitles[index] + '</h4>'; 
 
 items.forEach(item => { 
 const itemText = item.textContent.trim(); 
 if (itemText && itemText !== '') { 
 columnHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</a>'; 
 } 
 }); 
 
 columnHTML += '</div>'; 
 megaColumns += columnHTML; 
 }); 
 
 // Add Additional features if exists (4th submenu) 
 if (submenus[3] && submenus[3].classList.contains('alternative')) { 
 const additionalItems = submenus[3].querySelectorAll('ul li a'); 
 let additionalHTML = '<div class="mega-column"><h4>Additional</h4>'; 
 
 additionalItems.forEach(item => { 
 const itemText = item.textContent.trim(); 
 if (itemText && itemText !== '') { 
 additionalHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</a>'; 
 } 
 }); 
 
 additionalHTML += '</div>'; 
 megaColumns += additionalHTML; 
 } 
 
 return '<div class="menu-item">' + 
 '<button class="menu-trigger admin-trigger">' + 
 '<i class="fa-regular fa-shield-halved" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown mega-dropdown">' + 
 '<div class="mega-columns">' + 
 megaColumns + 
 '</div>' + 
 '</div>' + 
 '</div>'; 
 } 
 
 // Simple dropdown for fewer sections 
 let dropdownHTML = ''; 
 const items = menuElement.querySelectorAll('ul li a, .submenu ul li a'); 
 
 items.forEach(item => { 
 const itemText = item.textContent.trim(); 
 if (!itemText || itemText === '') return; 
 
 // Skip section headers that aren't links 
 if (!item.getAttribute('href')) { 
 dropdownHTML += '<div class="dropdown-divider"></div><strong>' + this.#escapeHtml(itemText) + '</strong>'; 
 } else { 
 dropdownHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</a>'; 
 } 
 }); 
 
 return '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-shield-halved" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractModerationMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const text = link ? link.textContent.trim() : 'Moderation'; 
 const items = menuElement.querySelectorAll('ul li a, ul li strong'); 
 
 let dropdownHTML = ''; 
 let currentSection = ''; 
 
 items.forEach(item => { 
 const itemText = item.textContent.trim(); 
 if (!itemText || itemText === '') return; 
 
 if (item.tagName === 'STRONG') { 
 if (currentSection !== '') { 
 dropdownHTML += '</div>'; 
 } 
 currentSection = itemText; 
 dropdownHTML += '<div class="dropdown-section">' + 
 '<strong>' + this.#escapeHtml(itemText) + '</strong>'; 
 } else { 
 const href = item.getAttribute('href') || '#'; 
 if (href.startsWith('javascript:')) { 
 dropdownHTML += '<button onclick="' + this.#escapeHtml(href.substring(11)) + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</button>'; 
 } else { 
 dropdownHTML += '<a href="' + this.#escapeHtml(href) + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</a>'; 
 } 
 } 
 }); 
 
 if (currentSection !== '') { 
 dropdownHTML += '</div>'; 
 } 
 
 return '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-gavel" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractReactionsMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const text = link ? link.textContent.trim() : 'Reactions'; 
 const counter = menuElement.querySelector('.st-emoji-notice-counter span'); 
 const count = counter ? counter.textContent.trim() : ''; 
 
 // Check if it has dropdown 
 const dropdown = menuElement.querySelector('ul'); 
 let menuHTML = ''; 
 
 if (dropdown) { 
 // Has dropdown (subscribe/unsubscribe options) 
 menuHTML = '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-face-smile" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 this.#extractReactionsDropdownHTML(menuElement) + 
 '</div>' + 
 '</div>'; 
 } else { 
 // No dropdown, just a link 
 menuHTML = '<div class="menu-item">' + 
 '<a href="javascript:void(0)" class="menu-link with-icon" data-toggle="emoji-notice-modal">' + 
 '<i class="fa-regular fa-face-smile" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '</a>' + 
 '</div>'; 
 } 
 
 return menuHTML; 
 } 
 
 #extractReactionsDropdownHTML(menuElement) { 
 const items = menuElement.querySelectorAll('ul li a'); 
 let html = ''; 
 
 items.forEach(item => { 
 const text = item.textContent.trim(); 
 if (!text || text === '') return; 
 
 const href = item.getAttribute('href') || 'javascript:void(0)'; 
 
 html += '<a href="javascript:void(0)" class="dropdown-item with-icon" data-toggle="' + 
 (text.toLowerCase().includes('unsubscribe') ? 'emoji-notice-subscription' : 'emoji-notice-modal') + 
 '" data-subscribed="' + (text.toLowerCase().includes('unsubscribe') ? 'true' : 'false') + '">' + 
 '<i class="fa-regular ' + (text.toLowerCase().includes('notification') ? 'fa-bell' : 'fa-face-smile') + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>'; 
 }); 
 
 return html; 
 } 
 
 #extractNotificationsMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const em = link.querySelector('em'); 
 const count = em ? em.textContent.trim() : ''; 
 const text = link.textContent.replace(count, '').trim(); 
 
 // Check if it's just a link or has dropdown 
 const dropdown = menuElement.querySelector('ul'); 
 let menuHTML = ''; 
 
 if (dropdown) { 
 // Has dropdown 
 menuHTML = '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-bell" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 this.#extractNotificationsDropdownHTML(menuElement) + 
 '</div>' + 
 '</div>'; 
 } else { 
 // Just a link 
 menuHTML = '<div class="menu-item">' + 
 '<a href="' + this.#escapeHtml(link.getAttribute('href') || '#notifications') + '" class="menu-link with-icon">' + 
 '<i class="fa-regular fa-bell" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '</a>' + 
 '</div>'; 
 } 
 
 return menuHTML; 
 } 
 
 #extractNotificationsDropdownHTML(menuElement) { 
 const items = menuElement.querySelectorAll('ul li a'); 
 let html = ''; 
 
 items.forEach(item => { 
 const text = item.textContent.trim(); 
 if (!text || text === '') return; 
 
 html += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular fa-bell" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>'; 
 }); 
 
 return html; 
 } 
 
 #extractRightMenu(menuElement, index) { 
 const link = menuElement.querySelector('a'); 
 const iconSpan = link ? link.querySelector('span[style*="background"]') : null; 
 
 if (!link || !iconSpan) { 
 return this.#extractSimpleMenu(menuElement); 
 } 
 
 // Check which icon menu this is based on background image 
 const bgImage = iconSpan.style.backgroundImage || ''; 
 let iconClass = 'fa-gear'; // default 
 
 if (bgImage.includes('fc-icon.png')) { 
 iconClass = 'fa-gear'; 
 } else if (bgImage.includes('icon_rss.png')) { 
 iconClass = 'fa-rss'; 
 } else if (bgImage.includes('icon_members.png')) { 
 iconClass = 'fa-users'; 
 } else if (bgImage.includes('icon_help.png')) { 
 iconClass = 'fa-circle-question'; 
 } 
 
 const dropdownItems = menuElement.querySelectorAll('ul li a'); 
 let dropdownHTML = ''; 
 
 dropdownItems.forEach((item, itemIndex) => { 
 const itemText = item.textContent.trim(); 
 if (!itemText || itemText === '') return; 
 
 // Add dividers at specific positions 
 if (itemIndex === 0 || itemIndex === 3 || itemIndex === 6 || itemIndex === 10) { 
 dropdownHTML += '<div class="dropdown-divider"></div>'; 
 } 
 
 // Special handling for form items 
 if (item.querySelector('form')) { 
 const form = item.querySelector('form'); 
 dropdownHTML += '<form action="' + this.#escapeHtml(form.getAttribute('action') || '#') + 
 '" method="' + this.#escapeHtml(form.getAttribute('method') || 'post') + 
 '" class="dropdown-item with-icon">' + 
 form.innerHTML + 
 '<i class="fa-regular ' + this.#getIconForText(itemText) + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(itemText) + '</span>' + 
 '</form>'; 
 } else { 
 dropdownHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular ' + this.#getIconForText(itemText) + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(itemText) + '</span>' + 
 '</a>'; 
 } 
 }); 
 
 return '<div class="menu-item icon-menu">' + 
 '<button class="menu-trigger icon-trigger">' + 
 '<i class="fa-regular ' + iconClass + '" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractSimpleMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 if (!link) return ''; 
 
 const text = link.textContent.trim(); 
 const href = link.getAttribute('href') || '#'; 
 const icon = this.#getIconForText(text); 
 
 return '<div class="menu-item">' + 
 '<a href="' + this.#escapeHtml(href) + '" class="menu-link with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>' + 
 '</div>'; 
 } 
 
 #extractSearch() { 
 const searchForm = this.#originalMenu.querySelector('form[name="search"]'); 
 if (!searchForm) return ''; 
 
 const searchInput = searchForm.querySelector('input[name="q"]'); 
 const siteSearch = searchForm.querySelector('input[name="as_sitesearch"]'); 
 
 const placeholder = searchInput ? (searchInput.value === 'Search' ? 'Search...' : searchInput.value) : 'Search...'; 
 const siteValue = siteSearch ? siteSearch.value : window.location.hostname; 
 
 return '<div class="menu-item search-item">' + 
 '<form class="modern-search" name="search" action="' + this.#escapeHtml(searchForm.getAttribute('action')) + 
 '" method="' + this.#escapeHtml(searchForm.getAttribute('method') || 'get') + '">' + 
 '<div class="search-container">' + 
 '<i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>' + 
 '<input type="text" name="q" placeholder="' + this.#escapeHtml(placeholder) + '" class="search-input" value="">' + 
 '<input type="hidden" name="as_sitesearch" value="' + this.#escapeHtml(siteValue) + '">' + 
 '</div>' + 
 '</form>' + 
 '</div>'; 
 } 
 
 #getIconForText(text) { 
 // Check exact matches first 
 for (const [key, icon] of Object.entries(this.#iconMappings)) { 
 if (text === key) { 
 return icon; 
 } 
 } 
 
 // Check partial matches 
 const lowerText = text.toLowerCase(); 
 for (const [key, icon] of Object.entries(this.#iconMappings)) { 
 if (lowerText.includes(key.toLowerCase())) { 
 return icon; 
 } 
 } 
 
 // Fallback based on common patterns 
 if (lowerText.includes('edit') || lowerText.includes('profile')) return 'fa-user-pen'; 
 if (lowerText.includes('avatar')) return 'fa-image'; 
 if (lowerText.includes('signature')) return 'fa-signature'; 
 if (lowerText.includes('setting')) return 'fa-sliders-h'; 
 if (lowerText.includes('email')) return 'fa-envelope'; 
 if (lowerText.includes('password')) return 'fa-key'; 
 if (lowerText.includes('logout')) return 'fa-right-from-bracket'; 
 if (lowerText.includes('message')) return 'fa-message'; 
 if (lowerText.includes('topic')) return 'fa-comments'; 
 if (lowerText.includes('active')) return 'fa-bolt'; 
 if (lowerText.includes('popular')) return 'fa-fire'; 
 if (lowerText.includes('subscription')) return 'fa-bookmark'; 
 if (lowerText.includes('notification')) return 'fa-bell'; 
 if (lowerText.includes('read')) return 'fa-check-double'; 
 if (lowerText.includes('post')) return 'fa-comment'; 
 if (lowerText.includes('admin')) return 'fa-shield-halved'; 
 if (lowerText.includes('website')) return 'fa-globe'; 
 if (lowerText.includes('user')) return 'fa-users'; 
 if (lowerText.includes('graphic')) return 'fa-palette'; 
 if (lowerText.includes('moderation')) return 'fa-gavel'; 
 if (lowerText.includes('search')) return 'fa-magnifying-glass'; 
 if (lowerText.includes('create')) return 'fa-plus'; 
 if (lowerText.includes('home')) return 'fa-house'; 
 if (lowerText.includes('android')) return 'fa-android'; 
 if (lowerText.includes('mobile')) return 'fa-mobile'; 
 if (lowerText.includes('clock') || lowerText.includes('last')) return 'fa-clock-rotate-left'; 
 if (lowerText.includes('news')) return 'fa-newspaper'; 
 if (lowerText.includes('top')) return 'fa-trophy'; 
 if (lowerText.includes('blog')) return 'fa-blog'; 
 if (lowerText.includes('member')) return 'fa-users'; 
 if (lowerText.includes('help')) return 'fa-circle-question'; 
 if (lowerText.includes('rss')) return 'fa-rss'; 
 if (lowerText.includes('feed')) return 'fa-rss'; 
 
 return 'fa-circle'; 
 } 
 
 createMobileOverlay() { 
 const overlay = document.createElement('div'); 
 overlay.className = 'mobile-menu-overlay'; 
 
 const container = document.createElement('div'); 
 container.className = 'mobile-menu-container'; 
 
 // Build mobile menu from original structure 
 container.innerHTML = this.#buildMobileMenuHTML(); 
 
 overlay.appendChild(container); 
 document.body.appendChild(overlay); 
 
 // Setup mobile menu interactions 
 this.#setupMobileMenuInteractions(overlay, container); 
 } 
 
 #buildMobileMenuHTML() { 
 const leftUl = this.#originalMenu.querySelector('ul.left'); 
 const rightUl = this.#originalMenu.querySelector('ul.right'); 
 
 let html = '<div class="mobile-menu-header">' + 
 '<h3>Menu</h3>' + 
 '<button class="mobile-menu-close">' + 
 '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' + 
 '</button>' + 
 '</div>'; 
 
 // User info section 
 const userMenu = leftUl ? leftUl.querySelector('.menu:first-child') : null; 
 if (userMenu) { 
 const link = userMenu.querySelector('a'); 
 const avatar = link ? link.querySelector('.avatar img') : null; 
 const username = link ? link.querySelector('.nick') : null; 
 
 const avatarSrc = avatar ? (avatar.src || avatar.getAttribute('src')) : 
 'https://img.forumfree.net/style_images/default_avatar.png'; 
 const usernameText = username ? username.textContent.trim() : 'User'; 
 
 html += '<div class="mobile-user-info">' + 
 '<div class="user-avatar large">' + 
 '<img src="' + this.#escapeHtml(avatarSrc) + '" alt="' + this.#escapeHtml(usernameText) + '" loading="lazy">' + 
 '</div>' + 
 '<div class="user-info">' + 
 '<div class="username">' + this.#escapeHtml(usernameText) + '</div>' + 
 '<div class="user-role">Member</div>' + 
 '</div>' + 
 '</div>'; 
 } 
 
 // Search 
 const searchForm = this.#originalMenu.querySelector('form[name="search"]'); 
 if (searchForm) { 
 const searchInput = searchForm.querySelector('input[name="q"]'); 
 const siteSearch = searchForm.querySelector('input[name="as_sitesearch"]'); 
 
 const placeholder = searchInput ? (searchInput.value === 'Search' ? 'Search...' : searchInput.value) : 'Search...'; 
 const siteValue = siteSearch ? siteSearch.value : window.location.hostname; 
 
 html += '<div class="mobile-search">' + 
 '<form class="modern-search" name="search" action="' + this.#escapeHtml(searchForm.getAttribute('action')) + 
 '" method="' + this.#escapeHtml(searchForm.getAttribute('method') || 'get') + '">' + 
 '<div class="search-container">' + 
 '<i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>' + 
 '<input type="text" name="q" placeholder="' + this.#escapeHtml(placeholder) + '" class="search-input">' + 
 '<input type="hidden" name="as_sitesearch" value="' + this.#escapeHtml(siteValue) + '">' + 
 '</div>' + 
 '</form>' + 
 '</div>'; 
 } 
 
 // Menu content 
 html += '<div class="mobile-menu-content">'; 
 
 // Extract left menu items 
 if (leftUl) { 
 const menus = leftUl.querySelectorAll('li.menu'); 
 menus.forEach((menu, index) => { 
 const link = menu.querySelector('a'); 
 if (!link) return; 
 
 const text = link.textContent.trim(); 
 const href = link.getAttribute('href') || '#'; 
 
 // Special handling for each menu type 
 let icon = 'fa-circle'; 
 let hasDropdown = menu.querySelector('ul') !== null; 
 let dropdownId = 'mobile-dropdown-' + index; 
 
 // Determine icon and special handling 
 if (menu.classList.contains('st-emoji-notice')) { 
 icon = 'fa-face-smile'; 
 } else if (link.id && link.id.startsWith('n')) { 
 icon = 'fa-bell'; 
 } else if (link.id && link.id.startsWith('i')) { 
 icon = 'fa-message'; 
 } else if (menu.querySelector('.avatar')) { 
 icon = 'fa-user'; 
 } else if (text === 'Topics') { 
 icon = 'fa-comments'; 
 } else if (text === 'Administration') { 
 icon = 'fa-shield-halved'; 
 } else if (text === 'Moderation') { 
 icon = 'fa-gavel'; 
 } 
 
 // Check for notification count 
 let count = ''; 
 if (link.id && link.id.startsWith('i')) { 
 const em = link.querySelector('em'); 
 count = em ? em.textContent.trim() : ''; 
 } else if (link.id && link.id.startsWith('n')) { 
 const em = link.querySelector('em'); 
 count = em ? em.textContent.trim() : ''; 
 } else if (menu.classList.contains('st-emoji-notice')) { 
 const counter = menu.querySelector('.st-emoji-notice-counter span'); 
 count = counter ? counter.textContent.trim() : ''; 
 } 
 
 if (hasDropdown) { 
 html += '<div class="mobile-menu-item">' + 
 '<button class="mobile-menu-trigger" data-dropdown="' + dropdownId + '">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="mobile-dropdown" id="' + dropdownId + '">' + 
 this.#extractMobileDropdownHTML(menu) + 
 '</div>' + 
 '</div>'; 
 } else { 
 html += '<div class="mobile-menu-item">' + 
 '<a href="' + this.#escapeHtml(href) + '" class="mobile-menu-link with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '</a>' + 
 '</div>'; 
 } 
 }); 
 } 
 
 // Extract right menu items (icon menus) 
 if (rightUl) { 
 const menus = rightUl.querySelectorAll('li.menu'); 
 menus.forEach((menu, index) => { 
 const link = menu.querySelector('a'); 
 if (!link) return; 
 
 const text = link.textContent.trim(); 
 const iconSpan = link.querySelector('span[style*="background"]'); 
 let iconClass = 'fa-gear'; 
 
 if (iconSpan) { 
 const bgImage = iconSpan.style.backgroundImage || ''; 
 if (bgImage.includes('fc-icon.png')) iconClass = 'fa-gear'; 
 else if (bgImage.includes('icon_rss.png')) iconClass = 'fa-rss'; 
 else if (bgImage.includes('icon_members.png')) iconClass = 'fa-users'; 
 else if (bgImage.includes('icon_help.png')) iconClass = 'fa-circle-question'; 
 } 
 
 const dropdownId = 'mobile-dropdown-right-' + index; 
 const hasDropdown = menu.querySelector('ul') !== null; 
 
 if (hasDropdown) { 
 html += '<div class="mobile-menu-item">' + 
 '<button class="mobile-menu-trigger" data-dropdown="' + dropdownId + '">' + 
 '<i class="fa-regular ' + iconClass + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text || 'Tools') + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="mobile-dropdown" id="' + dropdownId + '">' + 
 this.#extractMobileDropdownHTML(menu) + 
 '</div>' + 
 '</div>'; 
 } else { 
 html += '<div class="mobile-menu-item">' + 
 '<a href="' + this.#escapeHtml(link.getAttribute('href') || '#') + '" class="mobile-menu-link with-icon">' + 
 '<i class="fa-regular ' + iconClass + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text || 'Tools') + '</span>' + 
 '</a>' + 
 '</div>'; 
 } 
 }); 
 } 
 
 html += '</div>'; 
 return html; 
 } 
 
 #extractMobileDropdownHTML(menuElement) { 
 const items = menuElement.querySelectorAll('ul li a'); 
 let html = ''; 
 
 items.forEach(item => { 
 const text = item.textContent.trim(); 
 if (!text || text === '') return; 
 
 const href = item.getAttribute('href') || '#'; 
 const icon = this.#getIconForText(text); 
 
 if (href.startsWith('javascript:')) { 
 html += '<button onclick="' + this.#escapeHtml(href.substring(11)) + '" class="mobile-dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</button>'; 
 } else { 
 html += '<a href="' + this.#escapeHtml(href) + '" class="mobile-dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>'; 
 } 
 }); 
 
 return html; 
 } 
 
 #setupMobileMenuInteractions(overlay, container) { 
 // Close on overlay click 
 overlay.addEventListener('click', (e) => { 
 if (e.target === overlay) { 
 this.closeMobileMenu(); 
 } 
 }); 
 
 // Close button 
 const closeBtn = container.querySelector('.mobile-menu-close'); 
 if (closeBtn) { 
 closeBtn.addEventListener('click', () => this.closeMobileMenu()); 
 } 
 
 // Mobile dropdown toggles 
 container.querySelectorAll('.mobile-menu-trigger').forEach(trigger => { 
 trigger.addEventListener('click', () => { 
 const dropdownId = trigger.getAttribute('data-dropdown'); 
 const dropdown = document.getElementById(dropdownId); 
 const isActive = trigger.classList.contains('active'); 
 
 // Close all other dropdowns 
 container.querySelectorAll('.mobile-dropdown').forEach(d => { 
 d.classList.remove('active'); 
 }); 
 container.querySelectorAll('.mobile-menu-trigger').forEach(t => { 
 t.classList.remove('active'); 
 }); 
 
 // Toggle current 
 if (!isActive && dropdown) { 
 trigger.classList.add('active'); 
 dropdown.classList.add('active'); 
 } 
 }); 
 }); 
 } 
 
 updateNotificationBadges() { 
 if (!this.#originalMenu) return; 
 
 // Messenger notifications 
 const messengerLink = this.#originalMenu.querySelector('a[id^="i"]'); 
 if (messengerLink) { 
 const messengerEm = messengerLink.querySelector('em'); 
 if (messengerEm) { 
 const count = messengerEm.textContent.trim(); 
 let badge = document.querySelector('.menu-link#modern-messenger .notification-badge'); 
 
 if (!badge && count && count !== '0') { 
 badge = document.createElement('span'); 
 badge.className = 'notification-badge'; 
 const messengerElement = document.querySelector('.menu-link#modern-messenger'); 
 if (messengerElement) { 
 messengerElement.appendChild(badge); 
 } 
 } 
 
 if (badge) { 
 badge.textContent = count; 
 badge.style.display = count && count !== '0' ? 'flex' : 'none'; 
 } 
 } 
 } 
 
 // Update mobile menu badges too 
 const mobileMessenger = document.querySelector('.mobile-menu-link[href*="Msg"]'); 
 if (mobileMessenger && messengerLink) { 
 const messengerEm = messengerLink.querySelector('em'); 
 if (messengerEm) { 
 const count = messengerEm.textContent.trim(); 
 let mobileBadge = mobileMessenger.querySelector('.notification-badge'); 
 
 if (!mobileBadge && count && count !== '0') { 
 mobileBadge = document.createElement('span'); 
 mobileBadge.className = 'notification-badge'; 
 mobileMessenger.appendChild(mobileBadge); 
 } 
 
 if (mobileBadge) { 
 mobileBadge.textContent = count; 
 mobileBadge.style.display = count && count !== '0' ? 'flex' : 'none'; 
 } 
 } 
 } 
 } 
 
 updateReactionsMenu() { 
 const emojiNotice = document.querySelector('.st-emoji-notice'); 
 if (!emojiNotice) return; 
 
 const counter = emojiNotice.querySelector('.st-emoji-notice-counter span'); 
 const count = counter ? counter.textContent.trim() : ''; 
 
 // Update reactions badge in modern menu 
 const reactionsLink = document.querySelector('.menu-link[data-toggle="emoji-notice-modal"]'); 
 if (reactionsLink) { 
 let badge = reactionsLink.querySelector('.notification-badge'); 
 
 if (!badge && count && count !== '0') { 
 badge = document.createElement('span'); 
 badge.className = 'notification-badge'; 
 reactionsLink.appendChild(badge); 
 } 
 
 if (badge) { 
 badge.textContent = count; 
 badge.style.display = count && count !== '0' ? 'flex' : 'none'; 
 } 
 } 
 } 
 
 setupEventListeners() { 
 // Close dropdowns when clicking outside 
 document.addEventListener('click', (e) => { 
 if (!e.target.closest('.menu-item')) { 
 document.querySelectorAll('.menu-dropdown').forEach(dropdown => { 
 dropdown.style.opacity = '0'; 
 dropdown.style.visibility = 'hidden'; 
 }); 
 } 
 }); 
 
 // Escape key to close mobile menu 
 document.addEventListener('keydown', (e) => { 
 if (e.key === 'Escape' && this.#mobileState) { 
 this.closeMobileMenu(); 
 } 
 }); 
 
 // Close mobile menu on resize to desktop 
 window.addEventListener('resize', () => { 
 if (window.innerWidth > 768 && this.#mobileState) { 
 this.closeMobileMenu(); 
 } 
 }); 
 } 
 
 openMobileMenu() { 
 this.#mobileState = true; 
 const overlay = document.querySelector('.mobile-menu-overlay'); 
 if (overlay) { 
 overlay.classList.add('active'); 
 } 
 document.body.style.overflow = 'hidden'; 
 } 
 
 closeMobileMenu() { 
 this.#mobileState = false; 
 const overlay = document.querySelector('.mobile-menu-overlay'); 
 if (overlay) { 
 overlay.classList.remove('active'); 
 } 
 document.body.style.overflow = ''; 
 
 // Close all mobile dropdowns 
 document.querySelectorAll('.mobile-dropdown').forEach(d => { 
 d.classList.remove('active'); 
 }); 
 document.querySelectorAll('.mobile-menu-trigger').forEach(t => { 
 t.classList.remove('active'); 
 }); 
 } 
 
 #escapeHtml(text) { 
 if (typeof text !== 'string') return text; 
 const div = document.createElement('div'); 
 div.textContent = text; 
 return div.innerHTML; 
 } 
 
 destroy() { 
 if (this.#observerId && globalThis.forumObserver) { 
 globalThis.forumObserver.unregister(this.#observerId); 
 } 
 
 // Remove modern menu 
 if (this.#modernMenuWrap && this.#modernMenuWrap.parentNode) { 
 this.#modernMenuWrap.parentNode.removeChild(this.#modernMenuWrap); 
 } 
 
 // Remove mobile overlay 
 const overlay = document.querySelector('.mobile-menu-overlay'); 
 if (overlay && overlay.parentNode) { 
 overlay.parentNode.removeChild(overlay); 
 } 
 
 // Show original menu 
 if (this.#originalMenu) { 
 this.#originalMenu.style.display = ''; 
 } 
 
 console.log('Enhanced Menu Modernizer destroyed'); 
 } 
} 
 
// Initialize 
(function initEnhancedMenuModernizer() { 
 const init = () => { 
 try { 
 // Don't run on login/register pages 
 if (document.body.id === 'login' || document.body.id === 'register') { 
 return; 
 } 
 
 // Check if we should modernize 
 if (document.querySelector('.modern-menu-wrap')) { 
 return; 
 } 
 
 globalThis.enhancedMenuModernizer = new EnhancedMenuModernizer(); 
 
 } catch (error) { 
 console.error('Failed to create Enhanced Menu Modernizer:', error); 
 } 
 }; 
 
 if (document.readyState !== 'loading') { 
 queueMicrotask(init); 
 } else { 
 document.addEventListener('DOMContentLoaded', init); 
 } 
})(); 
 
// Cleanup on page hide 
globalThis.addEventListener('pagehide', () => { 
 if (globalThis.enhancedMenuModernizer && typeof globalThis.enhancedMenuModernizer.destroy === 'function') { 
 globalThis.enhancedMenuModernizer.destroy(); 
 } 
});




