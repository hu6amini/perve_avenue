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

//Enhanced Profile Transformation
// User Profile Modernization Script - Complete Modernization with Observer Integration 
class ProfileModernizer { 
 #profileObserverId = null; 
 #retryCount = 0; 
 #maxRetries = 5; 
 
 constructor() { 
 this.#initWithObserver(); 
 } 
 
 #initWithObserver() { 
 if (document.body.id !== 'profile') return; 
 
 // Check if observer is available 
 if (!globalThis.forumObserver) { 
 if (this.#retryCount < this.#maxRetries) { 
 this.#retryCount++; 
 const delay = Math.min(100 * Math.pow(2, this.#retryCount - 1), 1000); 
 console.log(`Forum Observer not available, retry ${this.#retryCount}/${this.#maxRetries} in ${delay}ms`); 
 
 setTimeout(() => this.#initWithObserver(), delay); 
 return; 
 } else { 
 console.error('Profile Modernizer: Forum Observer not available after maximum retries, using fallback'); 
 this.#initWithFallback(); 
 return; 
 } 
 } 
 
 // Reset retry counter on success 
 this.#retryCount = 0; 
 
 try { 
 // Initial transformation 
 this.modernizeProfileLayout(); 
 this.setupEventListeners(); 
 
 // Register observer for dynamic changes 
 this.#profileObserverId = globalThis.forumObserver.register({ 
 id: 'profile-modernizer', 
 callback: (node) => this.#handleProfileMutations(node), 
 selector: '.profile:not([data-modernized]), .modern-profile, .profile-tab, .avatar-container, .profile-avatar', 
 priority: 'high', 
 pageTypes: ['profile'], 
 dependencies: ['body#profile'] 
 }); 
 
 console.log('&#9989; Profile Modernizer initialized with observer'); 
 } catch (error) { 
 console.error('Profile Modernizer initialization failed:', error); 
 this.#initWithFallback(); 
 } 
 } 
 
 #initWithFallback() { 
 // Fallback to DOMContentLoaded initialization 
 if (document.readyState === 'loading') { 
 document.addEventListener('DOMContentLoaded', () => { 
 this.modernizeProfileLayout(); 
 this.setupEventListeners(); 
 }); 
 } else { 
 this.modernizeProfileLayout(); 
 this.setupEventListeners(); 
 } 
 } 
 
 #handleProfileMutations(node) { 
 if (!node) return; 
 
 const needsModernization = node.matches('.profile:not([data-modernized])') || 
 node.closest('.profile:not([data-modernized])') || 
 node.matches('.profile-tab') || 
 node.closest('.profile-tab') || 
 node.matches('.avatar-container') || 
 node.matches('.profile-avatar'); 
 
 if (needsModernization) { 
 this.modernizeProfileLayout(); 
 } 
 } 
 
 init() { 
 if (document.body.id !== 'profile') return; 
 this.modernizeProfileLayout(); 
 this.setupEventListeners(); 
 } 
 
 modernizeProfileLayout() { 
 const oldProfile = document.querySelector('.profile'); 
 if (!oldProfile || oldProfile.dataset.modernized) return; 
 
 try { 
 const profileData = this.extractProfileData(oldProfile); 
 const modernProfile = this.buildModernProfile(profileData); 
 if (!modernProfile) return; 
 
 oldProfile.style.display = 'none'; 
 oldProfile.dataset.modernized = 'true'; 
 
 const parent = oldProfile.parentNode; 
 if (parent) { 
 parent.insertBefore(modernProfile, oldProfile.nextSibling); 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 extractProfileData(oldProfile) { 
 try { 
 // Extract avatar - can be img, div with icon, or any element 
 const avatarContainer = oldProfile.querySelector('.avatar'); 
 let avatarHtml = ''; 
 let avatarType = 'image'; // 'image', 'icon', or 'custom' 
 
 if (avatarContainer) { 
 // Clone the entire avatar container 
 const avatarClone = avatarContainer.cloneNode(true); 
 
 // Remove any onerror handlers that would set default image 
 const avatarImg = avatarClone.querySelector('img'); 
 if (avatarImg) { 
 avatarImg.removeAttribute('onerror'); 
 avatarType = 'image'; 
 } else if (avatarClone.querySelector('i') || avatarClone.querySelector('.default-avatar')) { 
 // Check for Font Awesome icons or our default avatar div 
 avatarType = 'icon'; 
 } 
 
 avatarHtml = avatarClone.innerHTML; 
 } 
 
 const username = oldProfile.querySelector('.nick'); 
 const status = oldProfile.querySelector('.u_status dd'); 
 
 // Extract posts link from member_posts 
 const postsLink = oldProfile.querySelector('.member_posts'); 
 
 // Extract tabs data 
 const tabs = Array.from(oldProfile.querySelectorAll('.tabs li')).map(tab => ({ 
 id: tab.id.replace('t', ''), 
 text: tab.textContent.trim(), 
 href: tab.querySelector('a')?.getAttribute('href') || '', 
 isActive: tab.classList.contains('current') 
 })); 
 
 // Extract and modernize tab content 
 const tabContents = {}; 
 tabs.forEach(tab => { 
 const contentEl = document.getElementById('tab' + tab.id); 
 if (contentEl) { 
 tabContents[tab.id] = this.modernizeTabContent(contentEl.innerHTML, tab.id); 
 } 
 }); 
 
 return { 
 avatarHtml: avatarHtml || '', 
 avatarType: avatarType, 
 username: username?.textContent || '', 
 status: status?.textContent || '', 
 statusTitle: oldProfile.querySelector('.u_status')?.getAttribute('title') || '', 
 postsUrl: postsLink?.getAttribute('href') || '', 
 postsText: postsLink?.textContent?.trim() || 'Posts', 
 tabs: tabs, 
 tabContents: tabContents 
 }; 
 } catch (error) { 
 return { 
 avatarHtml: '', 
 avatarType: 'icon', 
 username: '', 
 status: '', 
 statusTitle: '', 
 postsUrl: '', 
 postsText: 'Posts', 
 tabs: [], 
 tabContents: {} 
 }; 
 } 
 } 
 
 modernizeTabContent(content, tabId) { 
 try { 
 let modernContent = content; 
 
 // Replace all definition lists with modern grid 
 modernContent = modernContent.replace( 
 /<dl class="profile-([^"]*)">\s*<dt[^>]*>([^<]*)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>\s*<\/dl>/g, 
 '<div class="profile-field profile-$1"><div class="field-label">$2</div><div class="field-value">$3</div></div>' 
 ); 
 
 // Modernize friend avatars - KEEP existing avatars as-is 
 modernContent = modernContent.replace( 
 /<a[^>]*>\s*<img[^>]*>\s*<\/a>/g, 
 (match) => { 
 const temp = document.createElement('div'); 
 temp.innerHTML = match; 
 const link = temp.querySelector('a'); 
 const img = temp.querySelector('img'); 
 if (link && img) { 
 // Preserve the original image, remove any onerror handlers 
 const imgClone = img.cloneNode(true); 
 imgClone.removeAttribute('onerror'); 
 return '<a href="' + link.getAttribute('href') + '" class="friend-avatar" title="' + (img.getAttribute('title') || '') + '">' + 
 imgClone.outerHTML + 
 '</a>'; 
 } 
 return match; 
 } 
 ); 
 
 // Modernize interest images 
 modernContent = modernContent.replace( 
 /<a[^>]*>\s*<img[^>]*class="color_img"[^>]*>\s*<\/a>/g, 
 (match) => { 
 const temp = document.createElement('div'); 
 temp.innerHTML = match; 
 const link = temp.querySelector('a'); 
 const img = temp.querySelector('img'); 
 if (link && img) { 
 return '<a href="' + link.getAttribute('href') + '" target="_blank" class="interest-image">' + 
 '<img src="' + img.getAttribute('src') + '" alt="Interest">' + 
 '</a>'; 
 } 
 return match; 
 } 
 ); 
 
 // Modernize action buttons 
 modernContent = modernContent.replace( 
 /<div class="mini_buttons">([\s\S]*?)<\/div>/g, 
 '<div class="modern-actions">$1</div>' 
 ); 
 
 modernContent = modernContent.replace( 
 /<a[^>]*class="mini_buttons[^>]*>([\s\S]*?)<\/a>/g, 
 '<a href="$1" class="modern-btn">$2</a>' 
 ); 
 
 // Remove old table structures 
 modernContent = modernContent.replace(/<table[^>]*>|<\/table>|<tbody>|<\/tbody>|<tr>|<\/tr>|<td>|<\/td>/g, ''); 
 
 // Remove old class attributes 
 modernContent = modernContent.replace(/class="[^"]*Sub[^"]*"|class="[^"]*Item[^"]*"/g, ''); 
 
 // Modernize specific field types 
 modernContent = this.modernizeSpecificFields(modernContent, tabId); 
 
 return modernContent; 
 } catch (error) { 
 return content; 
 } 
 } 
 
 modernizeSpecificFields(content, tabId) { 
 let modernContent = content; 
 
 // Modernize member group (Administrator/Founder) 
 modernContent = modernContent.replace( 
 /<span class="amministratore founder">([^<]*)<\/span>/, 
 '<span class="user-badge admin-badge">$1</span>' 
 ); 
 
 // Modernize gender display 
 modernContent = modernContent.replace( 
 /<span class="male">([^<]*)<\/span>/, 
 '<span class="gender-badge male"><i class="fa-regular fa-mars"></i>$1</span>' 
 ); 
 
 // Modernize status indicators 
 modernContent = modernContent.replace( 
 /<span class="when">([^<]*)<\/span>/g, 
 '<span class="modern-date">$1</span>' 
 ); 
 
 // Modernize post count with icon 
 modernContent = modernContent.replace( 
 /<b>([\d,]+)<\/b>\s*<small>([^<]*)<\/small>/, 
 '<div class="stat-with-icon"><i class="fa-regular fa-comments"></i><div><span class="stat-number">$1</span><span class="stat-detail">$2</span></div></div>' 
 ); 
 
 return modernContent; 
 } 
 
 buildModernProfile(profileData) { 
 try { 
 const profileContainer = document.createElement('div'); 
 profileContainer.className = 'modern-profile'; 
 
 let html = '<div class="profile-header">' + 
 '<div class="profile-avatar-section">' + 
 '<div class="avatar-container">'; 
 
 // Add the avatar HTML as-is (could be img, div with icon, etc.) 
 if (profileData.avatarHtml) { 
 html += profileData.avatarHtml; 
 } else { 
 // Fallback: create a default avatar using our new Font Awesome icon 
 html += '<div class="default-avatar mysterious" aria-hidden="true">' + 
 '<i class="fa-solid fa-user-secret"></i>' + 
 '</div>'; 
 } 
 
 html += '</div>' + 
 '<div class="profile-basic-info">' + 
 '<h1 class="profile-username">' + this.escapeHtml(profileData.username) + '</h1>' + 
 '<div class="profile-status" title="' + this.escapeHtml(profileData.statusTitle) + '">' + 
 '<i class="fa-regular fa-circle"></i>' + 
 '<span>' + this.escapeHtml(profileData.status) + '</span>' + 
 '</div>' + 
 '</div>' + 
 '</div>' + 
 '<div class="profile-actions">' + 
 '<a href="https://msg.forumcommunity.net/?act=Msg&amp;CODE=4&amp;MID=11517378&amp;c=668113" class="btn btn-primary">' + 
 '<i class="fa-regular fa-envelope"></i>' + 
 '<span>Send Message</span>' + 
 '</a>'; 
 
 // Add posts button if URL exists 
 if (profileData.postsUrl) { 
 html += '<a href="' + this.escapeHtml(profileData.postsUrl) + '" class="btn btn-posts" rel="nofollow">' + 
 '<i class="fa-regular fa-comments"></i>' + 
 '<span>' + this.escapeHtml(profileData.postsText) + '</span>' + 
 '</a>'; 
 } 
 
 html += '</div>' + 
 '</div>'; 
 
 // Tabs navigation 
 html += '<nav class="profile-tabs">'; 
 profileData.tabs.forEach(tab => { 
 html += '<a href="' + this.escapeHtml(tab.href) + '" class="profile-tab ' + (tab.isActive ? 'active' : '') + '" data-tab="' + tab.id + '" onclick="tab(' + tab.id + ');return false">' + 
 this.escapeHtml(tab.text) + 
 '</a>'; 
 }); 
 html += '</nav>'; 
 
 // Tab content 
 html += '<div class="profile-content">'; 
 profileData.tabs.forEach(tab => { 
 if (tab.isActive && profileData.tabContents[tab.id]) { 
 html += '<div id="modern-tab' + tab.id + '" class="profile-tab-content active">' + 
 profileData.tabContents[tab.id] + 
 '</div>'; 
 } else if (profileData.tabContents[tab.id]) { 
 html += '<div id="modern-tab' + tab.id + '" class="profile-tab-content">' + 
 profileData.tabContents[tab.id] + 
 '</div>'; 
 } 
 }); 
 html += '</div>'; 
 
 profileContainer.innerHTML = html; 
 
 // Ensure profile avatar gets proper styling 
 this.enhanceProfileAvatar(profileContainer); 
 
 return profileContainer; 
 } catch (error) { 
 return null; 
 } 
 } 
 
 enhanceProfileAvatar(profileContainer) { 
 const avatarContainer = profileContainer.querySelector('.avatar-container'); 
 if (!avatarContainer) return; 
 
 // Check what type of avatar we have 
 const avatar = avatarContainer.children[0]; 
 if (!avatar) return; 
 
 // If it's an img element, ensure it has proper classes 
 if (avatar.tagName === 'IMG') { 
 avatar.classList.add('profile-avatar'); 
 
 // Add basic styling if missing 
 if (!avatar.hasAttribute('style')) { 
 avatar.style.cssText = 'border: 3px solid var(--primary-color); border-radius: 50%; object-fit: cover;'; 
 } 
 
 // Ensure dimensions 
 if (!avatar.hasAttribute('width') && !avatar.hasAttribute('height')) { 
 avatar.setAttribute('width', '80'); 
 avatar.setAttribute('height', '80'); 
 avatar.style.width = '80px'; 
 avatar.style.height = '80px'; 
 } 
 } 
 // If it's our default avatar div, ensure it has profile size 
 else if (avatar.classList.contains('default-avatar')) { 
 avatar.classList.add('profile-avatar'); 
 
 // Ensure proper sizing for profile 
 avatar.style.cssText += 'width: 80px; height: 80px; font-size: 2rem;'; 
 } 
 // If it's an icon, wrap it in our default avatar 
 else if (avatar.tagName === 'I' && avatar.className.includes('fa-')) { 
 const wrapper = document.createElement('div'); 
 wrapper.className = 'default-avatar profile-avatar mysterious'; 
 wrapper.style.cssText = 'width: 80px; height: 80px; font-size: 2rem; display: flex; align-items: center; justify-content: center;'; 
 wrapper.appendChild(avatar.cloneNode(true)); 
 avatarContainer.innerHTML = ''; 
 avatarContainer.appendChild(wrapper); 
 } 
 } 
 
 setupEventListeners() { 
 // Handle tab clicks 
 document.addEventListener('click', (e) => { 
 const tab = e.target.closest('.profile-tab'); 
 if (tab) { 
 e.preventDefault(); 
 this.switchTab(tab.dataset.tab); 
 } 
 }); 
 } 
 
 switchTab(tabId) { 
 try { 
 // Update tab active states 
 document.querySelectorAll('.profile-tab').forEach(tab => { 
 tab.classList.toggle('active', tab.dataset.tab === tabId); 
 }); 
 
 // Update tab content visibility 
 document.querySelectorAll('.profile-tab-content').forEach(content => { 
 content.classList.toggle('active', content.id === 'modern-tab' + tabId); 
 }); 
 
 // Call original tab function if it exists 
 if (typeof tab === 'function') { 
 tab(tabId); 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 escapeHtml(unsafe) { 
 if (typeof unsafe !== 'string') return unsafe; 
 try { 
 const div = document.createElement('div'); 
 div.textContent = unsafe; 
 return div.innerHTML; 
 } catch (error) { 
 return unsafe; 
 } 
 } 
 
 destroy() { 
 if (this.#profileObserverId) { 
 globalThis.forumObserver?.unregister(this.#profileObserverId); 
 this.#profileObserverId = null; 
 } 
 console.log('Profile Modernizer destroyed'); 
 } 
} 
 
// Initialize on profile pages with observer integration 
(function initProfileModernizer() { 
 const init = () => { 
 try { 
 if (document.body.id === 'profile') { 
 globalThis.profileModernizer = new ProfileModernizer(); 
 } 
 } catch (error) { 
 console.error('Failed to create Profile Modernizer:', error); 
 } 
 }; 
 
 // If already ready, initialize immediately 
 if (document.readyState !== 'loading') { 
 queueMicrotask(init); 
 } else { 
 // Start immediately even if still loading 
 init(); 
 } 
})(); 
 
// Cleanup on page hide 
globalThis.addEventListener('pagehide', () => { 
 if (globalThis.profileModernizer && typeof globalThis.profileModernizer.destroy === 'function') { 
 globalThis.profileModernizer.destroy(); 
 } 
}); 


//Enhanced Navigation Modernizer
 
// Forum Navigation Modernization Script - Fully Error-Proof with Proper Observer Integration 
class NavigationModernizer { 
 #navObserverId = null; 
 #breadcrumbObserverId = null; 
 #retryCount = 0; 
 #maxRetries = 5; 
 
 constructor() { 
 this.#initWithObserver(); 
 } 
 
 #initWithObserver() { 
 // Check if observer is available 
 if (!globalThis.forumObserver) { 
 if (this.#retryCount < this.#maxRetries) { 
 this.#retryCount++; 
 const delay = Math.min(100 * Math.pow(2, this.#retryCount - 1), 1000); 
 console.log(`Navigation Modernizer: Forum Observer not available, retry ${this.#retryCount}/${this.#maxRetries} in ${delay}ms`); 
 
 setTimeout(() => this.#initWithObserver(), delay); 
 return; 
 } else { 
 console.error('Navigation Modernizer: Forum Observer not available after maximum retries, using fallback'); 
 this.#initWithFallback(); 
 return; 
 } 
 } 
 
 // Reset retry counter on success 
 this.#retryCount = 0; 
 
 try { 
 // Always run breadcrumb (except board pages) 
 if (document.body.id !== 'board') { 
 this.modernizeBreadcrumb(); 
 
 // Watch for breadcrumb changes 
 this.#breadcrumbObserverId = globalThis.forumObserver.register({ 
 id: 'nav-breadcrumb-modernizer', 
 callback: (node) => this.#handleBreadcrumbMutations(node), 
 selector: 'ul.nav:not([data-modernized]), .modern-breadcrumb', 
 priority: 'normal', 
 pageTypes: ['forum', 'topic', 'blog', 'profile', 'search'] // All except board 
 }); 
 } 
 
 // Only run these on topic pages 
 if (document.body.id === 'topic') { 
 this.modernizeTopicTitle(); 
 this.modernizeNavigationElements(); 
 this.setupEventListeners(); 
 
 // Watch for navigation changes on topic pages 
 this.#navObserverId = globalThis.forumObserver.register({ 
 id: 'nav-modernizer', 
 callback: (node) => this.#handleNavigationMutations(node), 
 selector: 'table.mback:not([data-modernized]), .navsub:not([data-modernized]), .modern-topic-title, .modern-nav', 
 priority: 'high', 
 pageTypes: ['topic'] 
 }); 
 } 
 
 console.log('&#9989; Navigation Modernizer initialized with observer'); 
 } catch (error) { 
 console.error('Navigation Modernizer initialization failed:', error); 
 this.#initWithFallback(); 
 } 
 } 
 
 #initWithFallback() { 
 // Fallback to original initialization 
 if (document.readyState === 'loading') { 
 document.addEventListener('DOMContentLoaded', () => { 
 this.#runFallbackInitialization(); 
 }); 
 } else { 
 this.#runFallbackInitialization(); 
 } 
 } 
 
 #runFallbackInitialization() { 
 this.modernizeBreadcrumb(); 
 
 // Only run these on topic pages 
 if (document.body.id === 'topic') { 
 this.modernizeTopicTitle(); 
 this.modernizeNavigationElements(); 
 this.setupEventListeners(); 
 } 
 } 
 
 #handleBreadcrumbMutations(node) { 
 if (!node) return; 
 
 const needsUpdate = node.matches('ul.nav:not([data-modernized])') || 
 node.closest('ul.nav:not([data-modernized])') || 
 node.matches('.modern-breadcrumb') || 
 node.querySelector('ul.nav:not([data-modernized])'); 
 
 if (needsUpdate) { 
 this.modernizeBreadcrumb(); 
 } 
 } 
 
 #handleNavigationMutations(node) { 
 if (!node) return; 
 
 const needsUpdate = node.matches('table.mback:not([data-modernized])') || 
 node.closest('table.mback:not([data-modernized])') || 
 node.matches('.navsub:not([data-modernized])') || 
 node.closest('.navsub:not([data-modernized])') || 
 node.matches('.modern-topic-title') || 
 node.matches('.modern-nav') || 
 node.querySelector('table.mback:not([data-modernized])') || 
 node.querySelector('.navsub:not([data-modernized])'); 
 
 if (needsUpdate) { 
 this.modernizeTopicTitle(); 
 this.modernizeNavigationElements(); 
 } 
 } 
 
 init() { 
 // Run breadcrumb on all pages except board, run other features only on topic pages 
 this.modernizeBreadcrumb(); 
 
 // Only run these on topic pages 
 if (document.body.id === 'topic') { 
 this.modernizeTopicTitle(); 
 this.modernizeNavigationElements(); 
 this.setupEventListeners(); 
 } 
 } 
 
 modernizeBreadcrumb() { 
 // Don't run on board pages 
 if (document.body.id === 'board') return; 
 
 const oldBreadcrumb = document.querySelector('ul.nav'); 
 if (!oldBreadcrumb || oldBreadcrumb.dataset.modernized) return; 
 
 try { 
 const breadcrumbItems = Array.from(oldBreadcrumb.querySelectorAll('li')); 
 if (breadcrumbItems.length === 0) return; 
 
 const modernBreadcrumb = this.buildModernBreadcrumb(breadcrumbItems); 
 if (!modernBreadcrumb) return; 
 
 oldBreadcrumb.style.display = 'none'; 
 oldBreadcrumb.dataset.modernized = 'true'; 
 
 const parent = oldBreadcrumb.parentNode; 
 if (parent) { 
 parent.insertBefore(modernBreadcrumb, oldBreadcrumb.nextSibling); 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 buildModernBreadcrumb(breadcrumbItems) { 
 try { 
 const breadcrumbContainer = document.createElement('nav'); 
 breadcrumbContainer.className = 'modern-breadcrumb'; 
 
 let html = '<div class="breadcrumb-content">'; 
 
 breadcrumbItems.forEach((item, index) => { 
 const link = item.querySelector('a'); 
 const icon = item.querySelector('i'); 
 
 if (link) { 
 const href = link.getAttribute('href') || '#'; 
 const text = link.textContent.trim() || ''; 
 const iconHtml = icon ? icon.outerHTML : ''; 
 
 // Determine if this is the home item 
 const isHome = href === '/' || index === 0; 
 
 html += '<a href="' + this.escapeHtml(href) + '" class="breadcrumb-item ' + (isHome ? 'home' : '') + '">' + 
 iconHtml + 
 '<span class="breadcrumb-text">' + this.escapeHtml(text) + '</span>' + 
 '</a>'; 
 
 // No separator added - removed as requested 
 } 
 }); 
 
 html += '</div>'; 
 breadcrumbContainer.innerHTML = html; 
 return breadcrumbContainer; 
 } catch (error) { 
 return null; 
 } 
 } 
 
 modernizeTopicTitle() { 
 const mbackTable = document.querySelector('table.mback'); 
 if (!mbackTable || mbackTable.dataset.modernized) return; 
 
 try { 
 const titleElement = mbackTable.querySelector('.mtitle h1') || mbackTable.querySelector('.mtitle'); 
 if (!titleElement) return; 
 
 const titleText = titleElement.innerHTML || titleElement.textContent || ''; 
 const { replies, views } = this.extractTopicStats(); 
 
 const modernTitle = this.buildModernTopicTitle(titleText, replies, views); 
 if (!modernTitle) return; 
 
 mbackTable.style.display = 'none'; 
 mbackTable.dataset.modernized = 'true'; 
 
 const parent = mbackTable.parentNode; 
 if (parent) { 
 parent.insertBefore(modernTitle, mbackTable.nextSibling); 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 extractTopicStats() { 
 try { 
 const statsElement = document.querySelector('.title.bottom.Item.Justify'); 
 if (!statsElement) return { replies: 0, views: 0 }; 
 
 const text = statsElement.textContent || ''; 
 const repliesMatch = text.match(/(\d+)\s*replies?/); 
 const viewsMatch = text.match(/(\d+)\s*views?/); 
 
 return { 
 replies: repliesMatch ? parseInt(repliesMatch[1]) || 0 : 0, 
 views: viewsMatch ? parseInt(viewsMatch[1]) || 0 : 0 
 }; 
 } catch (error) { 
 return { replies: 0, views: 0 }; 
 } 
 } 
 
 buildModernTopicTitle(titleText, replies, views) { 
 try { 
 const titleContainer = document.createElement('div'); 
 titleContainer.className = 'modern-topic-title'; 
 
 titleContainer.innerHTML = 
 '<div class="topic-header">' + 
 '<div class="topic-title-content">' + 
 '<h1 class="topic-title">' + this.escapeHtml(titleText) + '</h1>' + 
 '<div class="topic-meta">' + 
 '<span class="topic-stats">' + 
 '<i class="fa-regular fa-eye"></i>' + 
 '<span>Views: ' + views + '</span>' + 
 '</span>' + 
 '<span class="topic-stats">' + 
 '<i class="fa-regular fa-comment"></i>' + 
 '<span>Replies: ' + replies + '</span>' + 
 '</span>' + 
 '</div>' + 
 '</div>' + 
 '<div class="topic-actions">' + 
 '<button class="btn btn-icon" data-action="watch" title="Watch Topic">' + 
 '<i class="fa-regular fa-bookmark"></i>' + 
 '</button>' + 
 '<button class="btn btn-icon" data-action="share-topic" title="Share Topic">' + 
 '<i class="fa-regular fa-share-nodes"></i>' + 
 '</button>' + 
 '</div>' + 
 '</div>'; 
 
 return titleContainer; 
 } catch (error) { 
 return null; 
 } 
 } 
 
 modernizeNavigationElements() { 
 try { 
 const topNav = document.querySelector('.navsub.top:not([data-modernized])'); 
 const bottomNav = document.querySelector('.navsub.bottom:not([data-modernized])'); 
 
 topNav && this.createModernNavigation(topNav, 'top'); 
 bottomNav && this.createModernNavigation(bottomNav, 'bottom'); 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 createModernNavigation(originalNav, position) { 
 try { 
 const pagesData = this.extractPagesData(originalNav); 
 const buttonsData = this.extractButtonsData(originalNav); 
 const modernNav = this.buildModernNavigation(pagesData, buttonsData, position); 
 
 if (!modernNav) return; 
 
 originalNav.style.display = 'none'; 
 originalNav.dataset.modernized = 'true'; 
 
 const parent = originalNav.parentNode; 
 if (!parent) return; 
 
 if (position === 'top') { 
 parent.insertBefore(modernNav, originalNav.nextSibling); 
 } else { 
 const replyForm = document.querySelector('.modern-reply'); 
 if (replyForm && replyForm.parentNode) { 
 replyForm.parentNode.insertBefore(modernNav, replyForm); 
 } else { 
 parent.insertBefore(modernNav, originalNav.nextSibling); 
 } 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 extractPagesData(navElement) { 
 try { 
 const jumpLink = navElement.querySelector('.jump a'); 
 const lastPostLink = navElement.querySelector('.lastpost a'); 
 const currentPage = navElement.querySelector('.current'); 
 
 // Extract all page links including their actual hrefs 
 const pageLinks = Array.from(navElement.querySelectorAll('li:not(.jump):not(.lastpost):not(.break) a')); 
 const pageData = pageLinks.map(link => ({ 
 number: parseInt(link.textContent) || 0, 
 href: link.getAttribute('href') || '' 
 })); 
 
 // Also get the current page number 
 const currentPageNumber = parseInt(currentPage?.textContent) || 1; 
 
 return { 
 pages: pageData, 
 currentPage: currentPageNumber, 
 hasJump: !!jumpLink, 
 jumpFunction: jumpLink?.getAttribute('href') || '', 
 hasLastPost: !!lastPostLink, 
 lastPostUrl: lastPostLink?.getAttribute('href') || '', 
 totalPages: pageData.length + 1 // +1 for current page 
 }; 
 } catch (error) { 
 return { 
 pages: [], 
 currentPage: 1, 
 hasJump: false, 
 jumpFunction: '', 
 hasLastPost: false, 
 lastPostUrl: '', 
 totalPages: 1 
 }; 
 } 
 } 
 
 extractButtonsData(navElement) { 
 try { 
 const replyLink = navElement.querySelector('.reply')?.closest('a'); 
 const newTopicLink = navElement.querySelector('.newpost')?.closest('a'); 
 
 // Extract forum link from bottom nav 
 const forumLink = navElement.querySelector('.current_forum'); 
 
 return { 
 replyUrl: replyLink?.getAttribute('href') || '', 
 newTopicUrl: newTopicLink?.getAttribute('href') || '', 
 forumUrl: forumLink?.getAttribute('href') || '', 
 forumText: forumLink?.textContent || '', 
 hasReply: !!replyLink, 
 hasNewTopic: !!newTopicLink, 
 hasForumLink: !!forumLink 
 }; 
 } catch (error) { 
 return { 
 replyUrl: '', 
 newTopicUrl: '', 
 forumUrl: '', 
 forumText: '', 
 hasReply: false, 
 hasNewTopic: false, 
 hasForumLink: false 
 }; 
 } 
 } 
 
 buildModernNavigation(pagesData, buttonsData, position) { 
 try { 
 const navContainer = document.createElement('div'); 
 navContainer.className = `modern-nav ${position}-nav`; 
 
 let html = '<div class="nav-content"><div class="nav-section pages-section"><div class="pagination">'; 
 
 // Page jump 
 if (pagesData.hasJump && pagesData.jumpFunction) { 
 html += '<button class="page-jump btn btn-secondary" onclick="' + this.escapeHtml(pagesData.jumpFunction) + '">' + 
 '<i class="fa-regular fa-ellipsis"></i>' + 
 '<span>' + (pagesData.totalPages || 1) + ' Pages</span>' + 
 '</button>'; 
 } 
 
 // Current page (always show as span) 
 html += '<span class="page-number current">' + pagesData.currentPage + '</span>'; 
 
 // Other page numbers with extracted hrefs 
 pagesData.pages.forEach(page => { 
 if (page.number && page.href) { 
 html += '<a href="' + this.escapeHtml(page.href) + '" class="page-number">' + page.number + '</a>'; 
 } 
 }); 
 
 // Last post link 
 if (pagesData.hasLastPost && pagesData.lastPostUrl) { 
 html += '<a href="' + this.escapeHtml(pagesData.lastPostUrl) + '" class="last-post btn btn-secondary">' + 
 '<i class="fa-regular fa-arrow-right-to-bracket"></i>' + 
 '<span>First Unread</span>' + 
 '</a>'; 
 } 
 
 html += '</div></div><div class="nav-section actions-section"><div class="action-buttons">'; 
 
 // Reply button 
 if (buttonsData.hasReply && buttonsData.replyUrl) { 
 html += '<a href="' + this.escapeHtml(buttonsData.replyUrl) + '" class="btn btn-primary reply-btn">' + 
 '<i class="fa-regular fa-reply"></i>' + 
 '<span>Reply</span>' + 
 '</a>'; 
 } 
 
 // New topic button 
 if (buttonsData.hasNewTopic && buttonsData.newTopicUrl) { 
 html += '<a href="' + this.escapeHtml(buttonsData.newTopicUrl) + '" class="btn btn-secondary new-topic-btn">' + 
 '<i class="fa-regular fa-plus"></i>' + 
 '<span>New Topic</span>' + 
 '</a>'; 
 } 
 
 // Forum link for bottom nav - use extracted text and URL 
 if (position === 'bottom' && buttonsData.hasForumLink) { 
 const forumText = buttonsData.forumText || 'Forum'; 
 html += '<a href="' + this.escapeHtml(buttonsData.forumUrl) + '" class="btn btn-icon forum-home" title="' + this.escapeHtml(forumText) + '">' + 
 '<i class="fa-regular fa-house"></i>' + 
 '</a>'; 
 } 
 
 html += '</div></div></div>'; 
 navContainer.innerHTML = html; 
 return navContainer; 
 } catch (error) { 
 return null; 
 } 
 } 
 
 setupEventListeners() { 
 document.addEventListener('click', (e) => { 
 try { 
 const watchBtn = e.target.closest('[data-action="watch"]'); 
 const shareBtn = e.target.closest('[data-action="share-topic"]'); 
 
 watchBtn && this.handleWatchTopic(); 
 shareBtn && this.handleShareTopic(); 
 } catch (error) { 
 // Silent fail 
 } 
 }); 
 } 
 
 handleWatchTopic() { 
 // Watch topic implementation - no errors possible 
 } 
 
 async handleShareTopic() { 
 try { 
 const topicUrl = window.location.href; 
 
 if (navigator.share) { 
 await navigator.share({ 
 title: document.title, 
 url: topicUrl 
 }); 
 } else if (navigator.clipboard?.writeText) { 
 await navigator.clipboard.writeText(topicUrl); 
 this.showToast('Topic link copied to clipboard!'); 
 } else { 
 prompt('Copy this topic link:', topicUrl); 
 } 
 } catch (error) { 
 if (error.name !== 'AbortError') { 
 prompt('Copy this topic link:', window.location.href); 
 } 
 } 
 } 
 
 showToast(message) { 
 try { 
 const toast = document.createElement('div'); 
 Object.assign(toast.style, { 
 position: 'fixed', 
 bottom: '20px', 
 left: '50%', 
 transform: 'translateX(-50%)', 
 background: 'var(--success-color)', 
 color: 'white', 
 padding: '12px 20px', 
 borderRadius: 'var(--radius)', 
 zIndex: '1000', 
 fontWeight: '500', 
 boxShadow: 'var(--shadow)' 
 }); 
 toast.textContent = message; 
 document.body.appendChild(toast); 
 
 setTimeout(() => { 
 try { 
 toast.remove(); 
 } catch (e) { 
 // Silent cleanup fail 
 } 
 }, 3000); 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 escapeHtml(unsafe) { 
 if (typeof unsafe !== 'string') return unsafe; 
 try { 
 const div = document.createElement('div'); 
 div.textContent = unsafe; 
 return div.innerHTML; 
 } catch (error) { 
 return unsafe; 
 } 
 } 
 
 destroy() { 
 if (this.#navObserverId) { 
 globalThis.forumObserver?.unregister(this.#navObserverId); 
 this.#navObserverId = null; 
 } 
 if (this.#breadcrumbObserverId) { 
 globalThis.forumObserver?.unregister(this.#breadcrumbObserverId); 
 this.#breadcrumbObserverId = null; 
 } 
 console.log('Navigation Modernizer destroyed'); 
 } 
} 
 
// Initialize on all pages with observer integration 
(function initNavigationModernizer() { 
 const init = () => { 
 try { 
 // Don't run on board pages 
 if (document.body.id !== 'board') { 
 globalThis.navigationModernizer = new NavigationModernizer(); 
 } 
 } catch (error) { 
 console.error('Failed to create Navigation Modernizer:', error); 
 } 
 }; 
 
 // If already ready, initialize immediately 
 if (document.readyState !== 'loading') { 
 queueMicrotask(init); 
 } else { 
 // Start immediately even if still loading 
 init(); 
 } 
})(); 
 
// Cleanup on page hide 
globalThis.addEventListener('pagehide', () => { 
 if (globalThis.navigationModernizer && typeof globalThis.navigationModernizer.destroy === 'function') { 
 globalThis.navigationModernizer.destroy(); 
 } 
}); 



// Enhanced Post Transformation and Modernization System with CSS-First Image Fixes
// Now includes CSS-first image dimension handling, optimized DOM updates,
// enhanced accessibility, modern code blocks, and robust Moment.js timestamps
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
    #timeUpdateIntervals = new Map();

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
                console.log('Forum Observer not available, retry ' + this.#retryCount + '/' + this.#maxRetries + ' in ' + delay + 'ms');

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
        const bodyId = document.body.id;
        
        if (bodyId === 'search') {
            // Handle search pages specially
            this.#transformSearchPostElements();
            this.#setupSearchPostObserver();
        } else {
            // Handle topic/blog/send pages
            this.#transformPostElements();
            this.#setupObserverCallbacks();
            this.#setupActiveStateObserver();
        }
        
        // These run on all page types
        this.#enhanceReputationSystem();
        this.#setupEnhancedAnchorNavigation();
        this.#enhanceQuoteLinks();
        this.#modernizeCodeBlocks();

        console.log('✅ Post Modernizer with all optimizations initialized');
    } catch (error) {
        console.error('Post Modernizer initialization failed:', error);

        if (this.#retryCount < this.#maxRetries) {
            this.#retryCount++;
            const delay = 100 * Math.pow(2, this.#retryCount - 1);
            console.log('Initialization failed, retrying in ' + delay + 'ms...');

            setTimeout(() => {
                this.#initWithRetry();
            }, delay);
        }
    }
}
    
    // ==============================
    // MOMENT.JS TIMESTAMP FUNCTIONS - ENHANCED
    // ==============================

#parseForumDate(dateString) {
    if (!dateString || typeof dateString !== 'string') {
        return null;
    }

    // Clean the date string
    let cleanDateString = dateString
        .replace(/^Posted on\s*/i, '')
        .replace(/^on\s*/i, '')
        .replace(/^Posted\s*/i, '')
        .trim();

    console.debug('Parsing date string:', dateString, '->', cleanDateString);

    // Common forum date formats - IMPORTANT: These are already in USER'S local timezone
    const formats = [
        'MM/DD/YYYY, h:mm A',      // 12/28/2025, 06:50 PM (user local)
        'MM/DD/YYYY, h:mm:ss A',   // 12/28/2025, 06:50:10 PM
        'MM/DD/YYYY, HH:mm',       // 12/28/2025, 18:50
        'MM/DD/YYYY, HH:mm:ss',    // 12/28/2025, 18:50:10
        'MM-DD-YYYY, h:mm A',      // 12-28-2025, 06:50 PM
        'DD/MM/YYYY, h:mm A',      // 28/12/2025, 06:50 PM
        'DD/MM/YYYY, HH:mm',       // 28/12/2025, 18:50
        'YYYY-MM-DD HH:mm:ss',     // 2025-12-28 18:50:10
        'YYYY-MM-DDTHH:mm:ss',     // 2025-12-28T18:50:10
        'dddd, MMMM D, YYYY h:mm A', // Sunday, December 28, 2025 6:50 PM
    ];
    
    let momentDate = null;
    
    // STRATEGY: Parse as LOCAL time (forum already shows user's local time)
    for (let i = 0; i < formats.length; i++) {
        momentDate = moment(cleanDateString, formats[i], true);
        if (momentDate && momentDate.isValid()) {
            console.debug('Parsed with format', formats[i], 'as local time:', momentDate.format());
            break;
        }
    }
    
    // If we have timezone in string like "(EET)", handle it
    if ((!momentDate || !momentDate.isValid()) && cleanDateString.includes('(')) {
        try {
            const timezoneMatch = cleanDateString.match(/\(([A-Z]{2,})\)$/);
            if (timezoneMatch) {
                const tzAbbr = timezoneMatch[1];
                const dateWithoutTz = cleanDateString.replace(/\s*\([A-Z]{2,}\)$/, '');
                
                for (let i = 0; i < formats.length; i++) {
                    const parsed = moment(dateWithoutTz, formats[i], true);
                    if (parsed && parsed.isValid()) {
                        const possibleZones = this.#getTimezoneFromAbbr(tzAbbr);
                        if (possibleZones.length > 0) {
                            momentDate = parsed.tz(possibleZones[0]);
                        } else {
                            momentDate = parsed;
                        }
                        console.debug('Parsed with timezone', tzAbbr, ':', momentDate.format());
                        break;
                    }
                }
            }
        } catch (e) {
            console.debug('Timezone parsing failed:', e.message);
        }
    }
    
    // Fallback to JavaScript Date
    if (!momentDate || !momentDate.isValid()) {
        const jsDate = new Date(cleanDateString);
        if (!isNaN(jsDate)) {
            momentDate = moment(jsDate);
            console.debug('Parsed with JS Date:', momentDate.format());
        }
    }
    
    if (momentDate && momentDate.isValid()) {
        // Convert local time to UTC for consistent storage
        const utcTime = momentDate.utc();
        
        console.debug('Final conversion:', {
            original: cleanDateString,
            parsedLocal: momentDate.format(),
            parsedUTC: utcTime.format(),
            localOffset: momentDate.utcOffset(),
            isUTC: momentDate.isUTC()
        });
        
        return utcTime;
    }
    
    console.warn('Could not parse date:', dateString, '->', cleanDateString);
    return null;
}

  #detectForumTimezone() {
    // Since the forum already displays times in user's local timezone,
    // we don't need to detect a forum server timezone.
    // Return null to indicate we're using local parsing.
    return null;
}

#getTimezoneFromAbbr(abbr) {
    // Map common timezone abbreviations to IANA timezones
    const abbrMap = {
        'EST': ['America/New_York', 'America/Toronto', 'America/Montreal'],
        'EDT': ['America/New_York', 'America/Toronto', 'America/Montreal'],
        'PST': ['America/Los_Angeles', 'America/Vancouver'],
        'PDT': ['America/Los_Angeles', 'America/Vancouver'],
        'CST': ['America/Chicago', 'America/Winnipeg'],
        'CDT': ['America/Chicago', 'America/Winnipeg'],
        'MST': ['America/Denver', 'America/Phoenix'],
        'MDT': ['America/Denver'],
        'GMT': ['UTC', 'Europe/London'],
        'BST': ['Europe/London'],
        'CET': ['Europe/Paris', 'Europe/Berlin', 'Europe/Rome'],
        'CEST': ['Europe/Paris', 'Europe/Berlin', 'Europe/Rome'],
        'EET': ['Europe/Sofia', 'Europe/Athens', 'Europe/Helsinki'],
        'EEST': ['Europe/Sofia', 'Europe/Athens', 'Europe/Helsinki'],
        'AEST': ['Australia/Sydney', 'Australia/Melbourne'],
        'AEDT': ['Australia/Sydney', 'Australia/Melbourne'],
        'UTC': ['UTC']
    };
    
    return abbrMap[abbr] || [];
}

   #formatTimeAgo(date) {
    if (!date || !date.isValid()) {
        return 'Unknown time';
    }

    // Convert UTC date to user's local timezone for display
    const now = moment();
    const userDate = moment(date).local();
    
    console.debug('Time ago calculation:', {
        utcDate: date.format(),
        userLocalDate: userDate.format(),
        now: now.format(),
        diffSeconds: now.diff(userDate, 'seconds')
    });
    
    const diffInSeconds = now.diff(userDate, 'seconds');
    const diffInMinutes = now.diff(userDate, 'minutes');
    const diffInHours = now.diff(userDate, 'hours');
    const diffInDays = now.diff(userDate, 'days');
    
    // Smart time ago display with precision
    if (diffInSeconds < 0) {
        // This shouldn't happen if parsing is correct
        console.warn('Negative time diff:', diffInSeconds, 'for date:', userDate.format());
        return 'Just now'; // Fallback
    } else if (diffInSeconds < 45) {
        return 'Just now';
    } else if (diffInSeconds < 90) {
        return 'A minute ago';
    } else if (diffInMinutes < 45) {
        return diffInMinutes + ' minutes ago';
    } else if (diffInMinutes < 90) {
        return 'An hour ago';
    } else if (diffInHours < 24) {
        return diffInHours + ' hours ago';
    } else if (diffInDays === 1) {
        return 'Yesterday';
    } else if (diffInDays < 7) {
        return diffInDays + ' days ago';
    } else if (diffInDays < 30) {
        const weeks = Math.floor(diffInDays / 7);
        return weeks + (weeks === 1 ? ' week ago' : ' weeks ago');
    } else if (diffInDays < 365) {
        const months = Math.floor(diffInDays / 30);
        return months + (months === 1 ? ' month ago' : ' months ago');
    } else {
        const years = Math.floor(diffInDays / 365);
        return years + (years === 1 ? ' year ago' : ' years ago');
    }
}

#getUserLocaleSettings() {
    try {
        const locale = navigator.language || 'en-US';
        
        // Detect time format preference
        const testTime = moment().locale(locale).format('LT');
        const uses24Hour = !testTime.includes('AM') && !testTime.includes('PM');
        
        // Get user's timezone from browser
        const timezone = moment.tz.guess() || 'UTC';
        
        return {
            locale: locale,
            timezone: timezone,
            uses24Hour: uses24Hour,
            formats: {
                longDateTime: 'LLLL',
                mediumDateTime: 'llll',
                shortDateTime: 'lll',
                timeOnly: uses24Hour ? 'HH:mm' : 'h:mm A',
                dateOnly: 'll'
            }
        };
    } catch (error) {
        console.debug('Locale detection failed:', error);
        return {
            locale: 'en-US',
            timezone: 'UTC',
            uses24Hour: false,
            formats: {
                longDateTime: 'LLLL',
                mediumDateTime: 'llll',
                shortDateTime: 'lll',
                timeOnly: 'h:mm A',
                dateOnly: 'll'
            }
        };
    }
}

#createModernTimestamp(originalElement, dateString) {
    if (typeof moment === 'undefined' || typeof moment.tz === 'undefined') {
        console.warn('Moment.js libraries not loaded, skipping timestamp transformation');
        return originalElement;
    }
    
    // Prevent recursive transformation
    if (originalElement.classList && originalElement.classList.contains('modern-timestamp')) {
        console.debug('Element already modernized:', originalElement);
        return originalElement;
    }
    
    // Check if element contains a modern timestamp
    if (originalElement.querySelector && originalElement.querySelector('.modern-timestamp')) {
        console.debug('Element contains modern timestamp:', originalElement);
        return originalElement;
    }
    
    // Check if we're inside a modern timestamp
    if (originalElement.closest && originalElement.closest('.modern-timestamp')) {
        console.debug('Inside modern timestamp:', originalElement);
        return originalElement;
    }
    
    console.debug('Creating modern timestamp for:', {
        element: originalElement.tagName,
        classes: originalElement.className,
        dateString: dateString
    });
    
    const momentDate = this.#parseForumDate(dateString);
    
    if (!momentDate) {
        console.warn('Could not parse date:', dateString);
        return originalElement;
    }
    
    // Log for debugging
    console.debug('Timestamp creation details:', {
        originalDateString: dateString,
        parsedUTC: momentDate.format(),
        parsedLocal: momentDate.local().format(),
        forumTimezone: this.#detectForumTimezone()
    });
    
    // Get user's locale settings
    const userSettings = this.#getUserLocaleSettings();
    
    // Create the link
    const link = document.createElement('a');
    
    // Determine the href - try multiple sources
    let href = null;
    
    // 1. Check if original element is an anchor
    if (originalElement.tagName === 'A' && originalElement.hasAttribute('href')) {
        href = originalElement.getAttribute('href');
    } 
    // 2. Check if parent is an anchor
    else if (originalElement.parentElement && originalElement.parentElement.tagName === 'A' && 
             originalElement.parentElement.hasAttribute('href')) {
        href = originalElement.parentElement.getAttribute('href');
    }
    // 3. Construct from post ID
    else {
        const postElement = originalElement.closest('.post');
        if (postElement && postElement.id) {
            const postIdMatch = postElement.id.match(/\d+/);
            if (postIdMatch) {
                const postId = postIdMatch[0];
                const topicMatch = window.location.href.match(/t=(\d+)/);
                if (topicMatch) {
                    href = '#entry' + postId;
                } else {
                    // Fallback to current page with anchor
                    href = '#entry' + postId;
                }
            }
        }
    }
    
    if (href) {
        link.href = href;
        
        // Copy rel attribute if exists
        if (originalElement.hasAttribute('rel')) {
            link.setAttribute('rel', originalElement.getAttribute('rel'));
        } else if (originalElement.parentElement && originalElement.parentElement.tagName === 'A' && 
                  originalElement.parentElement.hasAttribute('rel')) {
            link.setAttribute('rel', originalElement.parentElement.getAttribute('rel'));
        }
    }
    
    // Create the time element
    const timeElement = document.createElement('time');
    timeElement.className = 'modern-timestamp';
    
    // Store UTC ISO string for machine readability
    const utcISOString = momentDate.toISOString();
    timeElement.setAttribute('datetime', utcISOString);
    
    // Convert to user's local timezone for display
    const userLocalDate = momentDate.tz(userSettings.timezone);
    
    // Create title with full localized date-time
    const titleFormat = userSettings.formats.longDateTime;
    const localizedTitle = userLocalDate.locale(userSettings.locale).format(titleFormat);
    const timezoneAbbr = userLocalDate.format('z');
    
    timeElement.setAttribute('title', `${localizedTitle} (${timezoneAbbr})`);
    
    // Create relative time display
    const relativeSpan = document.createElement('span');
    relativeSpan.className = 'relative-time';
    
    // Calculate relative time from UTC date
    const relativeTime = this.#formatTimeAgo(momentDate);
    relativeSpan.textContent = relativeTime;
    
    // Add absolute time as data attribute for debugging
    timeElement.setAttribute('data-absolute-time', userLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime));
    
    timeElement.appendChild(relativeSpan);
    
    // Only wrap with link if we have a valid href
    let finalElement;
    if (href) {
        link.appendChild(timeElement);
        finalElement = link;
    } else {
        finalElement = timeElement;
    }
    
    // Generate unique ID for this timestamp
    const timeElementId = 'timestamp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    timeElement.setAttribute('data-timestamp-id', timeElementId);
    
    // Store the original UTC date for updates
    timeElement.setAttribute('data-utc-date', utcISOString);
    
    // Store original date string for debugging
    timeElement.setAttribute('data-original-date', dateString);
    
    // Set up interval to update relative time
    const updateInterval = setInterval(() => {
        if (!document.body.contains(timeElement)) {
            clearInterval(updateInterval);
            this.#timeUpdateIntervals.delete(timeElementId);
            return;
        }
        
        // Re-parse the stored UTC date to ensure accuracy
        const storedUTC = moment(timeElement.getAttribute('data-utc-date'));
        if (storedUTC.isValid()) {
            const newRelativeTime = this.#formatTimeAgo(storedUTC);
            if (relativeSpan.textContent !== newRelativeTime) {
                relativeSpan.textContent = newRelativeTime;
            }
            
            // Update title periodically to ensure accuracy
            const currentUserLocalDate = storedUTC.tz(userSettings.timezone);
            const currentTitle = currentUserLocalDate.locale(userSettings.locale).format(titleFormat);
            const currentTimezoneAbbr = currentUserLocalDate.format('z');
            timeElement.setAttribute('title', `${currentTitle} (${currentTimezoneAbbr})`);
        }
    }, 30000);
    
    this.#timeUpdateIntervals.set(timeElementId, updateInterval);
    
    // Add data attributes for debugging
    timeElement.setAttribute('data-parsed-date', dateString);
    timeElement.setAttribute('data-user-timezone', userSettings.timezone);
    timeElement.setAttribute('data-user-locale', userSettings.locale);
    timeElement.setAttribute('data-parsed-utc', utcISOString);
    
    console.debug('Created timestamp element:', {
        href: href,
        utc: utcISOString,
        userLocal: userLocalDate.format(),
        relativeTime: relativeTime,
        elementHTML: finalElement.outerHTML.substring(0, 200)
    });
    
    return finalElement;
}

#extractDateFromElement(element) {
    // Try multiple strategies to extract date
    
    // Strategy 1: Check title attribute (most reliable)
    if (element.hasAttribute('title')) {
        const title = element.getAttribute('title');
        // Remove any time suffix like ":49" or ":10"
        const cleanTitle = title.replace(/:\d+$/, '');
        console.debug('Extracted date from title:', cleanTitle);
        return cleanTitle;
    }
    
    // Strategy 2: Check text content - look for date patterns
    if (element.textContent) {
        const text = element.textContent.trim();
        
        // Look for date patterns (MM/DD/YYYY or DD/MM/YYYY with time)
        const datePatterns = [
            /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,  // 12/23/2025, 09:30 PM
            /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)/i, // 12/23/2025, 09:30:49 PM
            /(\d{4}-\d{1,2}-\d{1,2},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,  // 2025-12-23, 09:30 PM
            /(\d{1,2}\.\d{1,2}\.\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i  // 23.12.2025, 09:30 PM
        ];
        
        for (const pattern of datePatterns) {
            const match = text.match(pattern);
            if (match) {
                console.debug('Extracted date from text pattern:', match[1].trim());
                return match[1].trim();
            }
        }
        
        // Last resort: extract just the date+time part
        // This handles cases like "<span>Posted on</span> 12/23/2025, 09:30 PM"
        const dateTimeMatch = text.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}.+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
        if (dateTimeMatch) {
            console.debug('Extracted date-time with fallback:', dateTimeMatch[1].trim());
            return dateTimeMatch[1].trim();
        }
    }
    
    // Strategy 3: Check parent elements for title
    const parentCheckElements = [
        element.parentElement,
        element.parentElement?.parentElement,
        element.closest('a'),
        element.closest('.lt.Sub'),
        element.closest('.title2')
    ];
    
    for (const parent of parentCheckElements) {
        if (parent && parent.hasAttribute('title')) {
            const parentTitle = parent.getAttribute('title');
            const cleanTitle = parentTitle.replace(/:\d+$/, '');
            console.debug('Extracted date from parent title:', cleanTitle);
            return cleanTitle;
        }
    }
    
    console.warn('Could not extract date from element:', element.outerHTML);
    return null;
}
    
#transformEditTimestamp(span) {
    // Look for any edit pattern across languages
    // Examples: 
    // English: "Edited by Username - 12/28/2025, 07:27 PM"
    // Italian: "Modificato da Username - 12/28/2025, 07:27 PM"
    // Spanish: "Editado por Username - 12/28/2025, 07:27 PM"
    
    // Pattern: "Edited by/MODIFIED BY/Editado por/Modificato da" followed by username and dash, then date
    const editPatterns = [
        /Edited by .+? - (.+)/i,
        /Modificato da .+? - (.+)/i,
        /Editado por .+? - (.+)/i,
        /Bearbeitet von .+? - (.+)/i,
        /Modifié par .+? - (.+)/i,
        /(.+ - \d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}.+)/i  // Fallback: anything ending with date pattern
    ];
    
    let editDate = null;
    for (const pattern of editPatterns) {
        const timeMatch = span.textContent.match(pattern);
        if (timeMatch) {
            editDate = timeMatch[1].trim();
            break;
        }
    }
    
    if (editDate) {
        console.debug('Found edit timestamp:', editDate);
        
        // Use the same parsing logic as regular timestamps
        const momentDate = this.#parseForumDate(editDate);
        
        if (momentDate) {
            const userSettings = this.#getUserLocaleSettings();
            
            // Convert UTC to user's local timezone
            const userLocalDate = momentDate.tz(userSettings.timezone);
            
            // Format for display
            const formattedTime = userLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime);
            const timezoneAbbr = userLocalDate.format('z');
            
            const timeElement = document.createElement('time');
            timeElement.setAttribute('datetime', momentDate.toISOString());
            timeElement.setAttribute('title', `${formattedTime} (${timezoneAbbr})`);
            timeElement.textContent = this.#formatTimeAgo(momentDate);
            
            // Generate unique ID for updates
            const timeElementId = 'edit-timestamp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            timeElement.setAttribute('data-timestamp-id', timeElementId);
            timeElement.setAttribute('data-utc-date', momentDate.toISOString());
            
            // Always use "Edited" in English before the time element
            span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edited ' + timeElement.outerHTML;
            
            // Set up interval to update relative time
            const updateInterval = setInterval(() => {
                if (!document.body.contains(timeElement)) {
                    clearInterval(updateInterval);
                    this.#timeUpdateIntervals.delete(timeElementId);
                    return;
                }
                
                const storedUTC = moment(timeElement.getAttribute('data-utc-date'));
                if (storedUTC.isValid()) {
                    const newRelativeTime = this.#formatTimeAgo(storedUTC);
                    if (timeElement.textContent !== newRelativeTime) {
                        timeElement.textContent = newRelativeTime;
                    }
                    
                    // Update title
                    const currentUserLocalDate = storedUTC.tz(userSettings.timezone);
                    const currentTitle = currentUserLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime);
                    const currentTimezoneAbbr = currentUserLocalDate.format('z');
                    timeElement.setAttribute('title', `${currentTitle} (${currentTimezoneAbbr})`);
                }
            }, 30000);
            
            this.#timeUpdateIntervals.set(timeElementId, updateInterval);
            
            console.debug('Created edit timestamp:', {
                original: editDate,
                parsedUTC: momentDate.format(),
                userLocal: userLocalDate.format(),
                relativeTime: timeElement.textContent
            });
        } else {
            console.warn('Could not parse edit date:', editDate);
            // Fallback: keep original text but add icon
            span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ' + this.#escapeHtml(span.textContent);
        }
    } else {
        // If no edit pattern found but it's an edit span, just add icon
        span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ' + this.#escapeHtml(span.textContent);
    }
}

    #transformTimestampElements(element) {
    const timestampSelectors = [
        '.lt.Sub a span.when',
        '.lt.Sub time',
        '.post-edit time',
        '.lt.Sub span',
        '.lt.Sub a',
        '.title2.top time',
        '.title2.top span',
        '.title2.top a',
        'span.when',
        'a[href*="#entry"]',
        'a[title*="/"]'
    ];
    
    const timestampElements = element.querySelectorAll(timestampSelectors.join(', '));
    
    timestampElements.forEach(timestampElement => {
        // Skip if the element itself is already a modern timestamp
        if (timestampElement.classList && timestampElement.classList.contains('modern-timestamp')) {
            return;
        }
        
        // Skip if any ancestor is already a modern timestamp
        if (timestampElement.closest('.modern-timestamp')) {
            return;
        }
        
        // Skip if this is an anchor that contains a modern timestamp
        if (timestampElement.tagName === 'A' && timestampElement.querySelector('.modern-timestamp')) {
            return;
        }
        
        // Skip if this is a time element that contains a modern timestamp
        if (timestampElement.tagName === 'TIME' && timestampElement.querySelector('.modern-timestamp')) {
            return;
        }
        
        // Skip if we're trying to transform something inside an already transformed timestamp
        if (timestampElement.closest('time.modern-timestamp, a .modern-timestamp')) {
            return;
        }
        
        const dateString = this.#extractDateFromElement(timestampElement);
        
        if (dateString) {
            console.debug('Found timestamp element for transformation:', {
                element: timestampElement.tagName,
                classes: timestampElement.className,
                dateString: dateString
            });
            
            const modernTimestamp = this.#createModernTimestamp(timestampElement, dateString);
            
            if (modernTimestamp && modernTimestamp !== timestampElement) {
                // Check if we're replacing an anchor that contains our timestamp
                const parent = timestampElement.parentNode;
                
                // If the parent is an anchor and we're replacing its only child
                if (parent && parent.tagName === 'A' && parent.children.length === 1 && 
                    parent.children[0] === timestampElement && parent.href && parent.href.includes('#entry')) {
                    // Replace the entire anchor with our new timestamp link
                    parent.parentNode.replaceChild(modernTimestamp, parent);
                } 
                // If the element itself is an anchor with href
                else if (timestampElement.tagName === 'A' && timestampElement.href && 
                         timestampElement.href.includes('#entry') && 
                         timestampElement.children.length === 0) {
                    // Replace the anchor directly
                    timestampElement.parentNode.replaceChild(modernTimestamp, timestampElement);
                }
                // If we're replacing a span inside an anchor
                else if (timestampElement.tagName === 'SPAN' && parent && parent.tagName === 'A' && 
                         parent.href && parent.href.includes('#entry')) {
                    // Replace the span, but keep the anchor
                    parent.replaceChild(modernTimestamp, timestampElement);
                }
                // Default replacement
                else {
                    timestampElement.parentNode.replaceChild(modernTimestamp, timestampElement);
                }
            }
        }
    });
}

    #transformPostHeaderTimestamps(postHeader) {
        if (!postHeader) return;
        
        // Look for common timestamp patterns in post headers
        const timestampPatterns = [
            'a[href*="#entry"]',
            'span.when',
            'time',
            '.lt.Sub a',
            '.lt.Sub span'
        ];
        
        timestampPatterns.forEach(pattern => {
            const elements = postHeader.querySelectorAll(pattern);
            elements.forEach(el => {
                // Skip if already modernized
                if (el.classList && el.classList.contains('modern-timestamp')) return;
                
                const dateString = this.#extractDateFromElement(el);
                if (dateString) {
                    console.log('Post header timestamp found:', {
                        element: el,
                        dateString: dateString,
                        pattern: pattern
                    });
                    
                    const modernTimestamp = this.#createModernTimestamp(el, dateString);
                    if (modernTimestamp !== el) {
                        el.parentNode.replaceChild(modernTimestamp, el);
                    }
                }
            });
        });
    }

    // ==============================
    // OBSERVER SETUP
    // ==============================

    #setupObserverCallbacks() {
        const pageTypes = ['topic', 'blog', 'send', 'search'];
        
        this.#cleanupObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-cleanup',
            callback: (node) => this.#handleCleanupTasks(node),
            selector: '.bullet_delete, .mini_buttons.points.Sub',
            priority: 'critical',
            pageTypes: pageTypes
        });

        this.#debouncedObserverId = globalThis.forumObserver.registerDebounced({
            id: 'post-modernizer-transform',
            callback: (node) => this.#handlePostTransformation(node),
            selector: '.post, .st-emoji, .title2.bottom, div[align="center"]:has(.quote_top), div.spoiler[align="center"], div[align="center"]:has(.code_top)',
            delay: 100,
            priority: 'normal',
            pageTypes: pageTypes
        });
    }

    #setupSearchPostObserver() {
        const pageTypes = ['search'];
        
        this.#searchPostObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-search-posts',
            callback: (node) => this.#handleSearchPostTransformation(node),
            selector: 'body#search .post, body#search li.post',
            priority: 'high',
            pageTypes: pageTypes
        });
    }

    #setupActiveStateObserver() {
        const pageTypes = ['topic', 'blog', 'send', 'search'];
        
        this.#activeStateObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-active-states',
            callback: (node) => this.#handleActiveStateMutations(node),
            selector: '.st-emoji-container, .mini_buttons.points.Sub .points',
            priority: 'normal',
            pageTypes: pageTypes
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

            const fragment = document.createDocumentFragment();

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

            if (anchorElements) {
                const anchorContainer = document.createElement('div');
                anchorContainer.className = 'anchor-container';
                anchorContainer.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
                anchorContainer.appendChild(anchorElements);
                postHeader.appendChild(anchorContainer);
            }

            const postNumber = document.createElement('span');
            postNumber.className = 'post-number';
            
            const hashIcon = document.createElement('i');
            hashIcon.className = 'fa-regular fa-hashtag';
            hashIcon.setAttribute('aria-hidden', 'true');
            
            const numberSpan = document.createElement('span');
            numberSpan.className = 'post-number-value';
            numberSpan.textContent = startOffset + index + 1;
            
            postNumber.appendChild(hashIcon);
            postNumber.appendChild(document.createTextNode(' '));
            postNumber.appendChild(numberSpan);
            
            postHeader.appendChild(postNumber);

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
                    
                    // Transform timestamps in the post header
                    this.#transformPostHeaderTimestamps(title2TopClone);
                    this.#transformTimestampElements(title2TopClone);
                    
                    postHeader.appendChild(title2TopClone);
                    tdWrapper.remove();
                } else {
                    const title2TopClone = title2Top.cloneNode(true);
                    title2TopClone.querySelector('.mini_buttons.points.Sub')?.remove();
                    title2TopClone.querySelector('.st-emoji.st-emoji-rep.st-emoji-post')?.remove();
                    title2TopClone.querySelector('.left.Item')?.remove();
                    this.#removeBreakAndNbsp(title2TopClone);
                    
                    // Transform timestamps in the post header
                    this.#transformPostHeaderTimestamps(title2TopClone);
                    this.#transformTimestampElements(title2TopClone);
                    
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

            fragment.appendChild(postHeader);
            fragment.appendChild(userInfo);
            fragment.appendChild(postContent);
            fragment.appendChild(postFooter);

            post.innerHTML = '';
            post.appendChild(fragment);

            this.#convertMiniButtonsToButtons(post);
            this.#addShareButton(post);
            this.#cleanupPostContent(post);

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
            
            const hashIcon = document.createElement('i');
            hashIcon.className = 'fa-regular fa-hashtag';
            hashIcon.setAttribute('aria-hidden', 'true');
            
            const numberSpan = document.createElement('span');
            numberSpan.className = 'post-number-value';
            numberSpan.textContent = index + 1;
            
            postNumber.appendChild(hashIcon);
            postNumber.appendChild(document.createTextNode(' '));
            postNumber.appendChild(numberSpan);
            
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

                // Transform timestamps in search posts
                this.#transformPostHeaderTimestamps(title2TopClone);
                this.#transformTimestampElements(title2TopClone);

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
                    this.#transformEditTimestamp(editSpanInContent);
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

#cleanupEditSpans(element) {
    element.querySelectorAll('span.edit').forEach(span => {
        // Check if already transformed (contains a time element)
        if (span.querySelector('time[datetime]')) {
            return;
        }
        
        // Always transform edit spans regardless of language
        this.#transformEditTimestamp(span);
    });
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
        element.querySelectorAll('img').forEach(img => {
            if (!img.style.maxWidth) {
                img.style.maxWidth = '100%';
            }
            if (!img.style.height) {
                img.style.height = 'auto';
            }
            
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
            
            if (!img.hasAttribute('alt')) {
                if (isEmoji) {
                    img.setAttribute('alt', 'Emoji');
                    img.setAttribute('role', 'img');
                } else {
                    img.setAttribute('alt', 'Forum image');
                }
            }
        });
        
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
        const originalOnClick = 'document.getElementById(\'' + checkbox.id + '\').checked=!document.getElementById(\'' + checkbox.id + '\').checked;post(\'' + postId + '\')';

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
            originalOnClick = 'document.getElementById(\'' + checkbox.id + '\').checked=!document.getElementById(\'' + checkbox.id + '\').checked;post(\'' + postId + '\')';
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
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'send', 'search']
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
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'send', 'search']
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

        this.#timeUpdateIntervals.forEach(interval => {
            clearInterval(interval);
        });
        this.#timeUpdateIntervals.clear();

        console.log('Post Modernizer destroyed');
    }
}

// Modern initialization without DOMContentLoaded with body ID check
(function initPostModernizer() {
    // Check if we are on a page that should have post modernization
    var bodyId = document.body.id;
    var shouldModernize = bodyId === 'topic' || bodyId === 'search' || bodyId === 'blog' || bodyId === 'send';
    
    if (!shouldModernize) {
        console.log('Post Modernizer skipped for body#' + bodyId);
        return; // Exit early
    }
    
    var init = function() {
        try {
            globalThis.postModernizer = new PostModernizer();
        } catch (error) {
            console.error('Failed to create Post Modernizer instance:', error);

            setTimeout(function() {
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
globalThis.addEventListener('pagehide', function() {
    if (globalThis.postModernizer && typeof globalThis.postModernizer.destroy === 'function') {
        globalThis.postModernizer.destroy();
    }
});



//Article Modernizer

// Blog Article Modernization System with Title2 Top Preservation 
// FIXED: Event listener preservation for st-emoji elements
class ArticleModernizer {
    #articleModernizerId = null;
    #debouncedArticleObserverId = null;
    #retryTimeoutId = null;
    #maxRetries = 10;
    #retryCount = 0;
    #emojiObserverId = null;
    
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
                var delay = Math.min(100 * Math.pow(1.5, this.#retryCount - 1), 2000);
                console.log('Forum Observer not available, retry ' + this.#retryCount + '/' + this.#maxRetries + ' in ' + delay + 'ms');
                
                this.#retryTimeoutId = setTimeout(function() {
                    this.#initWithRetry();
                }.bind(this), delay);
            } else {
                console.error('Failed to initialize Article Modernizer: Forum Observer not available after maximum retries');
            }
            return;
        }
        
        this.#retryCount = 0;
        this.#init();
    }
    
    #init() {
        try {
            this.#transformArticleElements();
            this.#setupArticleObserver();
            this.#setupEmojiObserver();
            this.#enhanceEmojiClickHandling(); // Added: Global click handler
            
            console.log('✅ Article Modernizer initialized (Title2 Top preserved)');
        } catch (error) {
            console.error('Article Modernizer initialization failed:', error);
            
            if (this.#retryCount < this.#maxRetries) {
                this.#retryCount++;
                var delay = 100 * Math.pow(2, this.#retryCount - 1);
                console.log('Initialization failed, retrying in ' + delay + 'ms...');
                
                setTimeout(function() {
                    this.#initWithRetry();
                }.bind(this), delay);
            }
        }
    }
    
    #setupArticleObserver() {
        var pageTypes = ['blog'];
        
        this.#debouncedArticleObserverId = globalThis.forumObserver.registerDebounced({
            id: 'article-modernizer-transform',
            callback: function(node) {
                this.#handleArticleTransformation(node);
            }.bind(this),
            selector: '.article:not(.post-article-modernized), .comments .post:not(.post-article-modernized), .post-article-modernized .title2.top',
            delay: 100,
            priority: 'normal',
            pageTypes: pageTypes
        });
    }
    
    #setupEmojiObserver() {
        this.#emojiObserverId = globalThis.forumObserver.registerDebounced({
            id: 'article-modernizer-emoji-mover',
            callback: function(node) {
                this.#checkAndMoveEmojiElements();
            }.bind(this),
            selector: '.st-emoji-rep, .article-title2-top, .article-stats, .post-article-modernized .title2.top',
            delay: 50,
            priority: 'high',
            pageTypes: ['blog']
        });
    }
    
    #checkAndMoveEmojiElements() {
        var articles = document.querySelectorAll('.post-article-modernized');
        for (var i = 0; i < articles.length; i++) {
            this.#moveEmojiToFooter(articles[i]);
        }
    }
    
    #moveEmojiToFooter(article) {
        var statsSection = article.querySelector('.article-stats');
        if (!statsSection) return;
        
        var existingEmoji = statsSection.querySelector('.st-emoji-rep');
        if (existingEmoji) return;
        
        var title2TopContainer = article.querySelector('.article-title2-top');
        if (!title2TopContainer) return;
        
        var rightSub = title2TopContainer.querySelector('.right.Sub');
        if (!rightSub) return;
        
        var stEmoji = rightSub.querySelector('.st-emoji-rep');
        if (!stEmoji) return;
        
        // FIXED: Use wrapper approach to preserve event listeners
        var emojiWrapper = document.createElement('div');
        emojiWrapper.className = 'article-emoji-wrapper';
        emojiWrapper.style.cssText = 'display: inline-block; margin-left: 8px; vertical-align: middle;';
        
        // Clone the emoji element with all attributes and event listeners
        var clonedEmoji = this.#cloneElementWithListeners(stEmoji);
        
        // Add the cloned emoji to wrapper
        emojiWrapper.appendChild(clonedEmoji);
        
        var pointsElement = statsSection.querySelector('.points');
        
        if (pointsElement) {
            pointsElement.parentNode.insertBefore(emojiWrapper, pointsElement.nextSibling);
        } else {
            statsSection.appendChild(emojiWrapper);
        }
        
        // Hide the original element but keep it in DOM for any script dependencies
        stEmoji.style.cssText = 'display: none !important; position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; overflow: hidden;';
        
        if (rightSub.children.length === 0) {
            rightSub.style.display = 'none';
        }
        
        console.log('✅ Moved st-emoji to footer with preserved event listeners');
        this.#checkAndFixEmojiCounter(clonedEmoji);
        
        // Try to reinitialize forum's emoji system
        this.#reattachForumEmojiListeners(article, clonedEmoji);
    }
    
    #cloneElementWithListeners(element) {
        // Create a deep clone
        var clone = element.cloneNode(true);
        
        // Copy all attributes
        Array.from(element.attributes).forEach(attr => {
            clone.setAttribute(attr.name, attr.value);
        });
        
        // Copy inline event handlers
        if (element.onclick) {
            clone.onclick = element.onclick;
        }
        if (element.onmouseenter) {
            clone.onmouseenter = element.onmouseenter;
        }
        if (element.onmouseleave) {
            clone.onmouseleave = element.onmouseleave;
        }
        
        // Copy dataset
        if (element.dataset) {
            for (var key in element.dataset) {
                if (element.dataset.hasOwnProperty(key)) {
                    clone.dataset[key] = element.dataset[key];
                }
            }
        }
        
        // Copy jQuery data if available
        if (typeof jQuery !== 'undefined' && jQuery.data) {
            var jqData = jQuery.data(element);
            if (jqData) {
                jQuery.data(clone, jqData);
            }
            
            // Copy jQuery events
            var jqEvents = jQuery._data(element, 'events');
            if (jqEvents) {
                for (var eventType in jqEvents) {
                    if (jqEvents.hasOwnProperty(eventType)) {
                        jqEvents[eventType].forEach(function(handler) {
                            jQuery(clone).on(eventType, handler.selector, handler.handler);
                        });
                    }
                }
            }
        }
        
        return clone;
    }
    
    #reattachForumEmojiListeners(article, emojiElement) {
        // Try to trigger the forum's native emoji initialization
        setTimeout(() => {
            if (typeof window.st_emoji_init === 'function') {
                try {
                    window.st_emoji_init(emojiElement);
                } catch (e) {
                    console.log('Could not reinitialize emoji via st_emoji_init:', e.message);
                }
            }
            
            // Trigger any mutation observers
            if (typeof MutationObserver !== 'undefined') {
                try {
                    var observer = new MutationObserver(() => {});
                    observer.observe(emojiElement, {
                        attributes: true,
                        attributeFilter: ['class', 'data-count', 'data-touch']
                    });
                    observer.disconnect();
                } catch (e) {
                    // Ignore observer errors
                }
            }
            
            // Dispatch custom event for any listeners
            var event = new CustomEvent('emoji-element-moved', {
                detail: {
                    element: emojiElement,
                    article: article,
                    timestamp: Date.now()
                }
            });
            document.dispatchEvent(event);
            
        }, 100);
    }
    
    #enhanceEmojiClickHandling() {
        // Add a global click handler as a fallback
        document.addEventListener('click', (e) => {
            var emojiContainer = e.target.closest('.st-emoji-container');
            var emojiPreview = e.target.closest('.st-emoji-preview');
            var emojiCounter = e.target.closest('.st-emoji-counter');
            
            if (emojiContainer || emojiPreview || emojiCounter) {
                var stEmoji = (emojiContainer || emojiPreview || emojiCounter).closest('.st-emoji');
                
                if (!stEmoji) return;
                
                // Check if this is in an article footer (where we moved it)
                var isInArticleFooter = stEmoji.closest('.article-stats') !== null;
                
                if (isInArticleFooter) {
                    // Check if event is already being handled
                    if (e.defaultPrevented) return;
                    
                    // Check if the element has any click handlers
                    var hasInlineHandler = stEmoji.onclick !== null;
                    var hasJQueryHandler = typeof jQuery !== 'undefined' && 
                                          jQuery._data(stEmoji, 'events') && 
                                          jQuery._data(stEmoji, 'events').click;
                    
                    if (!hasInlineHandler && !hasJQueryHandler) {
                        console.log('Emoji in article footer missing click handler, using fallback');
                        e.preventDefault();
                        e.stopPropagation();
                        
                        // Try to manually trigger the forum's emoji modal
                        this.#triggerEmojiModalFallback(stEmoji);
                    }
                }
            }
        }, true); // Use capture phase
    }
    
    #triggerEmojiModalFallback(emojiElement) {
        // Get emoji data
        var counter = emojiElement.querySelector('.st-emoji-counter');
        var preview = emojiElement.querySelector('.st-emoji-preview img');
        var count = counter ? counter.getAttribute('data-count') || counter.textContent : '0';
        var emojiType = preview ? preview.alt || 'Emoji' : 'Unknown';
        
        console.log('Fallback emoji modal for:', emojiType, 'count:', count);
        
        // Create a simple notification since we can't trigger the actual modal
        var notification = document.createElement('div');
        notification.className = 'emoji-fallback-notification';
        notification.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            padding: 12px 16px;
            background: var(--primary-color, #007bff);
            color: white;
            border-radius: var(--radius, 8px);
            box-shadow: var(--shadow-lg, 0 4px 20px rgba(0,0,0,0.2));
            z-index: 10000;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            transform: translateX(calc(100% + 20px));
            opacity: 0;
            transition: transform 0.3s ease-out, opacity 0.3s ease-out;
            pointer-events: none;
            white-space: nowrap;
            max-width: 300px;
        `;
        
        notification.innerHTML = `
            <i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>
            <span>${emojiType}: ${count} reaction${count !== '1' ? 's' : ''}</span>
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                notification.style.transform = 'translateX(0)';
                notification.style.opacity = '1';
            });
        });
        
        // Auto-dismiss
        setTimeout(() => {
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';
            
            notification.addEventListener('transitionend', () => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, { once: true });
        }, 3000);
        
        // Allow manual dismissal
        notification.style.pointerEvents = 'auto';
        notification.style.cursor = 'pointer';
        notification.addEventListener('click', () => {
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';
            
            notification.addEventListener('transitionend', () => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, { once: true });
        });
    }
    
    #checkAndFixEmojiCounter(stEmoji) {
        var counter = stEmoji.querySelector('.st-emoji-counter');
        if (!counter) return;
        
        var dataCount = counter.getAttribute('data-count');
        var displayCount = counter.textContent.trim();
        
        if (dataCount && dataCount !== '0' && displayCount === '0') {
            console.log('Fixing counter display: data-count=' + dataCount + ' but shows ' + displayCount);
            counter.textContent = dataCount;
            
            var container = stEmoji.querySelector('.st-emoji-container');
            if (container) {
                container.classList.add('active');
            }
        }
        
        setTimeout(function() {
            var updatedCounter = stEmoji.querySelector('.st-emoji-counter');
            if (updatedCounter && updatedCounter.textContent.trim() === '0') {
                var updatedDataCount = updatedCounter.getAttribute('data-count');
                if (updatedDataCount && updatedDataCount !== '0') {
                    console.log('Post-delay fix: updating counter from 0 to ' + updatedDataCount);
                    updatedCounter.textContent = updatedDataCount;
                }
            }
        }.bind(this), 300);
    }
    
    #handleArticleTransformation(node) {
        if (!node) return;
        
        var needsTransformation = node.matches('.article:not(.post-article-modernized)') ||
        node.querySelector('.article:not(.post-article-modernized)') ||
        node.matches('.comments .post:not(.post-article-modernized)') ||
        (node.matches('.title2.top') && node.closest('.post-article-modernized'));
        
        if (needsTransformation) {
            this.#transformArticleElements();
        }
    }
    
    #transformArticleElements() {
        var articles = document.querySelectorAll('#blog .article:not(.post-article-modernized)');
        for (var i = 0; i < articles.length; i++) {
            this.#transformMainArticle(articles[i], i);
        }
        
        var comments = document.querySelectorAll('#blog .comments .post:not(.post-article-modernized)');
        for (var j = 0; j < comments.length; j++) {
            this.#transformCommentPost(comments[j], j);
        }
    }
    
    #extractElements(article) {
        return {
            anchor: article.querySelector('.anchor'),
            articleTitle: article.querySelector('h2.btitle'),
            title2Top: article.querySelector('.title2.top'),
            center: article.querySelector('.center.Item'),
            title2Bottom: article.querySelector('.title2.bottom'),
            mainBg: article.querySelector('.mainbg')
        };
    }
    
    #transformMainArticle(article, index) {
        article.classList.add('post-article-modernized');
        
        var elements = this.#extractElements(article);
        var fragment = document.createDocumentFragment();
        
        var articleHeader = document.createElement('div');
        articleHeader.className = 'article-header';
        
        if (elements.anchor) {
            var anchorContainer = document.createElement('div');
            anchorContainer.className = 'anchor-container';
            anchorContainer.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
            anchorContainer.appendChild(elements.anchor.cloneNode(true));
            articleHeader.appendChild(anchorContainer);
        }
        
        // Create action buttons container like PostModernizer does
        var headerActions = document.createElement('div');
        headerActions.className = 'article-header-actions';
        
        // Extract and transform timestamps from title2Top - but work on a clone
        if (elements.title2Top) {
            // Create a working copy for timestamp extraction
            var title2TopWorkingCopy = elements.title2Top.cloneNode(true);
            this.#transformTimestampElements(title2TopWorkingCopy);
            
            // Extract the modern timestamp that was created
            var modernTimestamp = title2TopWorkingCopy.querySelector('.modern-timestamp');
            if (modernTimestamp) {
                // Get the parent link if it exists
                var timestampLink = modernTimestamp.closest('a');
                if (timestampLink) {
                    headerActions.appendChild(timestampLink.cloneNode(true));
                } else {
                    headerActions.appendChild(modernTimestamp.cloneNode(true));
                }
            }
        }
        
        // Add share button from bottom actions (will be populated later)
        var shareButton = document.createElement('a');
        shareButton.className = 'btn btn-icon btn-share';
        shareButton.setAttribute('title', 'Share');
        shareButton.setAttribute('data-action', 'share');
        shareButton.innerHTML = '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>';
        
        // Get the article URL
        var articleUrl = window.location.href.split('#')[0];
        var articleIdMatch = article.id.match(/\d+/);
        if (articleIdMatch) {
            articleUrl += '#entry' + articleIdMatch[0];
        }
        
        // Make the share button copy the URL to clipboard
        shareButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(articleUrl).then(function() {
                    // Show a notification
                    var notification = document.createElement('div');
                    notification.className = 'copy-notification';
                    notification.textContent = 'Link copied to clipboard!';
                    notification.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;background:var(--success-color);color:white;border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index: 9;font-weight:500;display:flex;align-items:center;gap:8px;transform:translateX(calc(100% + 20px));opacity:0;transition:transform 0.3s ease-out,opacity 0.3s ease-out;pointer-events:none;white-space:nowrap;';
                    
                    var icon = document.createElement('i');
                    icon.className = 'fa-regular fa-check-circle';
                    icon.setAttribute('aria-hidden', 'true');
                    notification.prepend(icon);
                    
                    document.body.appendChild(notification);
                    
                    requestAnimationFrame(function() {
                        requestAnimationFrame(function() {
                            notification.style.transform = 'translateX(0)';
                            notification.style.opacity = '1';
                        });
                    });
                    
                    setTimeout(function() {
                        notification.style.transform = 'translateX(calc(100% + 20px))';
                        notification.style.opacity = '0';
                        
                        notification.addEventListener('transitionend', function() {
                            if (notification.parentNode) {
                                notification.parentNode.removeChild(notification);
                            }
                        });
                    }, 2000);
                }).catch(function(err) {
                    console.error('Failed to copy: ', err);
                    // Fallback: open in new tab
                    window.open(articleUrl, '_blank');
                });
            } else {
                // Fallback for older browsers
                window.open(articleUrl, '_blank');
            }
        });
        
        headerActions.appendChild(shareButton);
        
        // Add edit button
        var editButton = document.createElement('a');
        editButton.className = 'btn btn-icon btn-edit';
        editButton.setAttribute('title', 'Edit');
        editButton.setAttribute('data-action', 'edit');
        editButton.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>';
        
        // Find the actual edit URL from bottom elements
        if (elements.title2Bottom) {
            var rtSub = elements.title2Bottom.querySelector('.mini_buttons.right.Sub');
            if (rtSub) {
                var editLink = rtSub.querySelector('a[href*="CODE=08"]');
                if (editLink) {
                    editButton.href = editLink.getAttribute('href');
                }
            }
        }
        headerActions.appendChild(editButton);
        
        // Add quote button
        var quoteButton = document.createElement('a');
        quoteButton.className = 'btn btn-icon btn-quote';
        quoteButton.setAttribute('title', 'Quote');
        quoteButton.setAttribute('data-action', 'quote');
        quoteButton.innerHTML = '<i class="fa-regular fa-quote-left" aria-hidden="true"></i>';
        
        // Find the actual quote URL from bottom elements
        if (elements.title2Bottom) {
            var rtSub = elements.title2Bottom.querySelector('.mini_buttons.right.Sub');
            if (rtSub) {
                var quoteLink = rtSub.querySelector('a[href*="CODE=02"]');
                if (quoteLink) {
                    quoteButton.href = quoteLink.getAttribute('href');
                    if (quoteLink.getAttribute('rel')) {
                        quoteButton.setAttribute('rel', quoteLink.getAttribute('rel'));
                    }
                }
            }
        }
        headerActions.appendChild(quoteButton);
        
        // Add header actions to the beginning of article header
        articleHeader.appendChild(headerActions);
        
        this.#addNewArticleBadge(elements.articleTitle, articleHeader);
        
        var titleSection = document.createElement('div');
        titleSection.className = 'article-title-section';
        
        if (elements.articleTitle) {
            var titleLink = elements.articleTitle.querySelector('a');
            var modernTitle = document.createElement('h2');
            modernTitle.className = 'article-title';
            
            if (titleLink) {
                var modernTitleLink = document.createElement('a');
                modernTitleLink.href = titleLink.href;
                modernTitleLink.innerHTML = titleLink.innerHTML;
                modernTitle.appendChild(modernTitleLink);
            } else {
                modernTitle.textContent = elements.articleTitle.textContent.trim();
            }
            
            titleSection.appendChild(modernTitle);
            
            var bdesc = elements.articleTitle.querySelector('.bdesc');
            if (bdesc) {
                var descElement = document.createElement('div');
                descElement.className = 'article-description';
                descElement.textContent = bdesc.textContent.trim();
                titleSection.appendChild(descElement);
            }
        }
        
        articleHeader.appendChild(titleSection);
        
        var title2TopContainer = document.createElement('div');
        title2TopContainer.className = 'article-title2-top';
        
        if (elements.title2Top) {
            // Now transform the actual title2Top for display (remove .when but keep everything else)
            var title2TopForDisplay = elements.title2Top.cloneNode(true);
            
            // Remove the .when element since we've already moved it to the header
            var whenElement = title2TopForDisplay.querySelector('.when');
            if (whenElement) {
                whenElement.remove();
            }
            
            // Also remove any empty left.Sub if it only contained the .when
            var leftSub = title2TopForDisplay.querySelector('.left.Sub');
            if (leftSub && leftSub.children.length === 0) {
                leftSub.remove();
            }
            
            var breakElement = title2TopForDisplay.querySelector('.Break.Sub');
            if (breakElement) breakElement.remove();
            
            this.#cleanupTextNodes(title2TopForDisplay);
            this.#removeStatsFromTitle2Top(title2TopForDisplay);
            
            title2TopContainer.appendChild(title2TopForDisplay);
        }
        
        var articleContent = document.createElement('div');
        articleContent.className = 'article-content';
        
        if (elements.center) {
            var colorElement = elements.center.querySelector('.color');
            if (colorElement) {
                var emojiWidget = colorElement.querySelector('.st-emoji-widget');
                if (emojiWidget) emojiWidget.remove();
                
                var contentClone = colorElement.cloneNode(true);
                this.#preserveMediaDimensions(contentClone);
                this.#cleanupArticleContentStructure(contentClone);
                this.#modernizeQuotes(contentClone);
                this.#modernizeSpoilers(contentClone);
                this.#modernizeCodeBlocksInContent(contentClone);
                
                articleContent.appendChild(contentClone);
            }
        }
        
        var articleFooter = document.createElement('div');
        articleFooter.className = 'article-footer';
        
        var statsSection = document.createElement('div');
        statsSection.className = 'article-stats';
        
        // Use the ORIGINAL elements.title2Top (not the display copy) for stats
        if (elements.title2Top) {
            // Create a fresh copy for stats extraction
            var title2TopForStats = elements.title2Top.cloneNode(true);
            this.#moveBasicStatsToFooter(title2TopForStats, statsSection);
        }
        
        articleFooter.appendChild(statsSection);
        
        if (elements.title2Bottom) {
            var bottomActions = this.#modernizeArticleBottomActions(elements.title2Bottom);
            if (bottomActions) {
                articleFooter.appendChild(bottomActions);
            }
        }
        
        fragment.appendChild(articleHeader);
        fragment.appendChild(title2TopContainer);
        fragment.appendChild(articleContent);
        fragment.appendChild(articleFooter);
        
        if (elements.mainBg) {
            elements.mainBg.innerHTML = '';
            elements.mainBg.appendChild(fragment);
        } else {
            article.innerHTML = '';
            article.appendChild(fragment);
        }
        
        if (elements.articleTitle) {
            elements.articleTitle.remove();
        }
        
        // Delay emoji movement to ensure DOM is ready
        setTimeout(function() {
            this.#moveEmojiToFooter(article);
        }.bind(this), 200);
    }
    
    #removeStatsFromTitle2Top(title2TopClone) {
        var pointsElement = title2TopClone.querySelector('.points');
        if (pointsElement) pointsElement.remove();
        
        var repliesElement = title2TopClone.querySelector('.replies');
        if (repliesElement) repliesElement.remove();
        
        var viewsElement = title2TopClone.querySelector('.views');
        if (viewsElement) viewsElement.remove();
        
        var leftSub = title2TopClone.querySelector('.left.Sub');
        if (leftSub && leftSub.children.length === 0) {
            leftSub.style.display = 'none';
        }
    }
    
    #moveBasicStatsToFooter(title2Top, statsSection) {
        // 1. Points (always first)
        var pointsElement = title2Top.querySelector('.points');
        if (pointsElement) {
            var pointsClone = pointsElement.cloneNode(true);
            this.#cleanupMiniButtons(pointsClone);
            this.#setInitialPointsState(pointsClone);
            this.#updatePointsContainerActiveState(pointsClone);
            statsSection.appendChild(pointsClone);
        }
        
        // 2. st-emoji will be moved later by #moveEmojiToFooter
        
        // 3. Views with icon only
        var viewsElement = title2Top.querySelector('.views');
        if (viewsElement) {
            var viewsClone = viewsElement.cloneNode(true);
            this.#transformMetricToIconOnly(viewsClone, 'eye');
            
            // Optional: Highlight high view counts
            var viewCount = this.#extractNumberFromMetric(viewsClone);
            if (viewCount > 1000) {
                viewsClone.classList.add('highlight');
            }
            
            statsSection.appendChild(viewsClone);
        }
        
        // 4. Replies with icon only
        var repliesElement = title2Top.querySelector('.replies');
        if (repliesElement) {
            var repliesClone = repliesElement.cloneNode(true);
            this.#transformMetricToIconOnly(repliesClone, 'message-dots');
            
            // Optional: Highlight high reply counts
            var replyCount = this.#extractNumberFromMetric(repliesClone);
            if (replyCount > 20) {
                repliesClone.classList.add('highlight');
            }
            
            statsSection.appendChild(repliesClone);
        }
        
        var leftSub = title2Top.querySelector('.left.Sub');
        if (leftSub && leftSub.children.length === 0) {
            leftSub.style.display = 'none';
        }
    }
    
    #transformMetricToIconOnly(element, iconType) {
        // Extract the number from the element
        var number = this.#extractNumberFromElement(element);
        
        // Find if there's a link in the original
        var originalLink = element.querySelector('a');
        var hasLink = originalLink && originalLink.href;
        
        // Clear the element
        element.innerHTML = '';
        
        // Create icon
        var icon = document.createElement('i');
        icon.className = 'fa-regular fa-' + iconType;
        icon.setAttribute('aria-hidden', 'true');
        
        // Create number span
        var numberSpan = document.createElement('span');
        numberSpan.className = 'metric-count';
        numberSpan.textContent = number;
        
        // If original had a link, wrap everything in a link
        if (hasLink) {
            var link = document.createElement('a');
            link.href = originalLink.href;
            link.appendChild(icon);
            link.appendChild(numberSpan);
            element.appendChild(link);
        } else {
            // No link, just add icon and number
            element.appendChild(icon);
            element.appendChild(numberSpan);
        }
        
        // Add accessibility title based on icon type
        var title = iconType === 'eye' ? 'Total views' : 'Total replies';
        element.setAttribute('title', title);
        element.setAttribute('aria-label', title + ': ' + number);
    }
    
    #extractNumberFromElement(element) {
        // Try to extract number from text content
        var text = element.textContent || '';
        
        // Remove any non-numeric characters except for numbers
        var numberMatch = text.match(/\d+/);
        if (numberMatch) {
            return numberMatch[0];
        }
        
        // Check for <em> tag (often used for reply counts)
        var emTag = element.querySelector('em');
        if (emTag) {
            var emText = emTag.textContent || '';
            var emMatch = emText.match(/\d+/);
            if (emMatch) {
                return emMatch[0];
            }
        }
        
        // Check for any span with number
        var spans = element.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
            var spanText = spans[i].textContent || '';
            var spanMatch = spanText.match(/\d+/);
            if (spanMatch) {
                return spanMatch[0];
            }
        }
        
        return '0';
    }
    
    #extractNumberFromMetric(metricElement) {
        // Get the text content and extract number
        var text = metricElement.textContent || '';
        var match = text.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
    }
    
    #addNewArticleBadge(articleTitle, articleHeader) {
        if (!articleTitle) return;
        var hasNewPostAnchor = articleTitle.querySelector('a#newpost');
        if (!hasNewPostAnchor) return;
        
        var newBadge = document.createElement('span');
        newBadge.className = 'article-new-badge';
        newBadge.textContent = 'NEW';
        newBadge.setAttribute('aria-label', 'New article since your last visit');
        
        var articleTitleSection = articleHeader.querySelector('.article-title-section');
        if (articleTitleSection) {
            var badgeContainer = articleHeader.querySelector('.article-badges');
            if (!badgeContainer) {
                badgeContainer = document.createElement('div');
                badgeContainer.className = 'article-badges';
                articleHeader.insertBefore(badgeContainer, articleTitleSection);
            }
            badgeContainer.appendChild(newBadge);
        } else {
            articleHeader.insertBefore(newBadge, articleHeader.firstChild);
        }
    }
    
    #transformCommentPost(comment, index) {
        comment.classList.add('post-article-modernized', 'comment-post');
        
        var fragment = document.createDocumentFragment();
        var elements = this.#extractElements(comment);
        
        var commentHeader = document.createElement('div');
        commentHeader.className = 'comment-header';
        
        // Create header actions for comments too
        var headerActions = document.createElement('div');
        headerActions.className = 'article-header-actions';
        
        // Extract and transform timestamps from title2Top for comments
        if (elements.title2Top) {
            // Create a working copy for timestamp extraction
            var title2TopWorkingCopy = elements.title2Top.cloneNode(true);
            this.#transformTimestampElements(title2TopWorkingCopy);
            
            var modernTimestamp = title2TopWorkingCopy.querySelector('.modern-timestamp');
            if (modernTimestamp) {
                var timestampLink = modernTimestamp.closest('a');
                if (timestampLink) {
                    headerActions.appendChild(timestampLink.cloneNode(true));
                } else {
                    headerActions.appendChild(modernTimestamp.cloneNode(true));
                }
            }
        }
        
        commentHeader.appendChild(headerActions);
        
        var commentContent = document.createElement('div');
        commentContent.className = 'comment-content';
        
        var commentFooter = document.createElement('div');
        commentFooter.className = 'comment-footer';
        
        if (elements.anchor) {
            var anchorContainer = document.createElement('div');
            anchorContainer.className = 'anchor-container';
            anchorContainer.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
            anchorContainer.appendChild(elements.anchor.cloneNode(true));
            commentHeader.appendChild(anchorContainer);
        }
        
        if (elements.title2Top) {
            // Now transform the actual title2Top for display (remove .when but keep everything else)
            var title2TopForDisplay = elements.title2Top.cloneNode(true);
            
            // Remove the .when element since we've already moved it to the header
            var whenElement = title2TopForDisplay.querySelector('.when');
            if (whenElement) {
                whenElement.remove();
            }
            
            // Also remove any empty left.Sub if it only contained the .when
            var leftSub = title2TopForDisplay.querySelector('.left.Sub');
            if (leftSub && leftSub.children.length === 0) {
                leftSub.remove();
            }
            
            var breakElement = title2TopForDisplay.querySelector('.Break.Sub');
            if (breakElement) breakElement.remove();
            
            commentHeader.appendChild(title2TopForDisplay);
        }
        
        if (elements.center) {
            var colorElement = elements.center.querySelector('.color');
            if (colorElement) {
                var contentClone = colorElement.cloneNode(true);
                
                this.#preserveMediaDimensions(contentClone);
                this.#cleanupArticleContentStructure(contentClone);
                this.#modernizeQuotes(contentClone);
                this.#modernizeSpoilers(contentClone);
                this.#modernizeCodeBlocksInContent(contentClone);
                
                commentContent.appendChild(contentClone);
            }
        }
        
        var statsDiv = document.createElement('div');
        statsDiv.className = 'comment-stats';
        
        var pointsElement = comment.querySelector('.points');
        if (pointsElement) {
            var pointsClone = pointsElement.cloneNode(true);
            this.#cleanupMiniButtons(pointsClone);
            this.#setInitialPointsState(pointsClone);
            statsDiv.appendChild(pointsClone);
        }
        
        // Add views and replies to comments if they exist (icon only)
        var viewsElement = comment.querySelector('.views');
        if (viewsElement) {
            var viewsClone = viewsElement.cloneNode(true);
            this.#transformMetricToIconOnly(viewsClone, 'eye');
            statsDiv.appendChild(viewsClone);
        }
        
        var repliesElement = comment.querySelector('.replies');
        if (repliesElement) {
            var repliesClone = repliesElement.cloneNode(true);
            this.#transformMetricToIconOnly(repliesClone, 'message-dots');
            statsDiv.appendChild(repliesClone);
        }
        
        commentFooter.appendChild(statsDiv);
        
        if (elements.title2Bottom) {
            var modernActions = this.#modernizeArticleBottomActions(elements.title2Bottom);
            if (modernActions) {
                commentFooter.appendChild(modernActions);
            }
        }
        
        fragment.appendChild(commentHeader);
        fragment.appendChild(commentContent);
        fragment.appendChild(commentFooter);
        
        comment.innerHTML = '';
        comment.appendChild(fragment);
    }
    
    #modernizeArticleBottomActions(bottomElement) {
        var rtSub = bottomElement.querySelector('.mini_buttons.right.Sub');
        var leftSub = bottomElement.querySelector('.left.Sub');
        
        if (!rtSub && !leftSub) return null;
        
        var actionsContainer = document.createElement('div');
        actionsContainer.className = 'article-bottom-actions';
        
        if (leftSub) {
            // Renamed from article-share-buttons to article-tools-buttons
            var toolsContainer = document.createElement('div');
            toolsContainer.className = 'article-tools-buttons';
            
            // Keep the track/unsubscribe button in the footer
            var trackLink = leftSub.querySelector('a.track');
            if (trackLink && !trackLink.classList.contains('a2a_button')) {
                var trackBtn = document.createElement('a');
                trackBtn.href = trackLink.href;
                trackBtn.className = 'btn btn-icon btn-track';
                
                // Determine if it's Subscribe or Unsubscribe based on link text
                var linkText = trackLink.textContent || '';
                var isUnsubscribe = linkText.includes('Unsubscription') || linkText.includes('Unsubscribe');
                var title = isUnsubscribe ? 'Unsubscribe' : 'Subscribe';
                var iconClass = isUnsubscribe ? 'fa-regular fa-bell-slash' : 'fa-regular fa-bell';
                
                trackBtn.setAttribute('title', title);
                trackBtn.innerHTML = '<i class="' + iconClass + '" aria-hidden="true"></i>';
                toolsContainer.appendChild(trackBtn);
            }
            
            // Share button is now in header, so skip it here
            
            if (toolsContainer.children.length > 0) {
                actionsContainer.appendChild(toolsContainer);
            }
        }
        
        if (rtSub) {
            var actionButtons = document.createElement('div');
            actionButtons.className = 'article-action-buttons';
            
            // Edit and quote buttons are now in header, so skip them here
            
            var checkbox = rtSub.querySelector('input[type="checkbox"]');
            if (checkbox) {
                // For articles, we only keep the checkbox for moderator/admin selection
                // Remove the multiquote button and label since you can't multiquote articles
                var checkboxContainer = document.createElement('div');
                checkboxContainer.className = 'article-checkbox-container';
                checkboxContainer.appendChild(checkbox.cloneNode(true));
                actionButtons.appendChild(checkboxContainer);
            }
            
            if (actionButtons.children.length > 0) {
                actionsContainer.appendChild(actionButtons);
            }
        }
        
        return actionsContainer.children.length > 0 ? actionsContainer : null;
    }
    
    #cleanupTextNodes(element) {
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        var nodesToRemove = [];
        var node;
        
        while (node = walker.nextNode()) {
            if (node.textContent.includes('&nbsp;') || node.textContent.trim() === '') {
                nodesToRemove.push(node);
            }
        }
        
        for (var i = 0; i < nodesToRemove.length; i++) {
            var textNode = nodesToRemove[i];
            if (textNode.parentNode) {
                textNode.parentNode.removeChild(textNode);
            }
        }
    }
    
    #cleanupArticleContentStructure(contentElement) {
        contentElement.querySelectorAll('.st-emoji-widget').forEach(function(el) {
            el.remove();
        });
        
        contentElement.querySelectorAll(':empty').forEach(function(emptyEl) {
            if (!['IMG', 'BR', 'HR', 'INPUT', 'META', 'LINK'].includes(emptyEl.tagName)) {
                emptyEl.remove();
            }
        });
        
        this.#processTextAndLineBreaks(contentElement);
    }
    
    #processTextAndLineBreaks(element) {
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        var textNodes = [];
        var node;
        
        while (node = walker.nextNode()) {
            if (node.textContent.trim() !== '') {
                textNodes.push(node);
            }
        }
        
        for (var i = 0; i < textNodes.length; i++) {
            var textNode = textNodes[i];
            if (textNode.parentNode && (!textNode.parentNode.classList || !textNode.parentNode.classList.contains('post-text'))) {
                var span = document.createElement('span');
                span.className = 'post-text';
                span.textContent = textNode.textContent;
                textNode.parentNode.replaceChild(span, textNode);
            }
        }
        
        var brElements = element.querySelectorAll('br');
        for (var j = 0; j < brElements.length; j++) {
            var br = brElements[j];
            
            if (br.closest('.modern-spoiler, .modern-code, .modern-quote, .code-header, .spoiler-header, .quote-header')) {
                continue;
            }
            
            var prevSibling = br.previousElementSibling;
            var nextSibling = br.nextElementSibling;
            
            if (prevSibling && nextSibling) {
                var prevIsPostText = prevSibling.classList && prevSibling.classList.contains('post-text');
                var nextIsPostText = nextSibling.classList && nextSibling.classList.contains('post-text');
                
                if (prevIsPostText && nextIsPostText) {
                    prevSibling.classList.add('paragraph-end');
                    br.remove();
                } else {
                    br.style.cssText = 'margin:0;padding:0;display:block;content:\'\';height:0.75em;margin-bottom:0.25em';
                }
            } else {
                br.remove();
            }
        }
    }
    
    #preserveMediaDimensions(element) {
        var images = element.querySelectorAll('img');
        for (var i = 0; i < images.length; i++) {
            var img = images[i];
            if (!img.style.maxWidth) {
                img.style.maxWidth = '100%';
            }
            if (!img.style.height) {
                img.style.height = 'auto';
            }
            
            var isTwemoji = img.src.includes('twemoji') || img.classList.contains('twemoji');
            var isEmoji = img.src.includes('emoji') || img.src.includes('smiley') ||
            (img.src.includes('imgbox') && img.alt && img.alt.includes('emoji')) ||
            img.className.includes('emoji');
            
            if (isTwemoji || isEmoji) {
                img.style.display = 'inline-block';
                img.style.verticalAlign = 'text-bottom';
                img.style.margin = '0 2px';
            } else if (!img.style.display || img.style.display === 'inline') {
                img.style.display = 'block';
            }
            
            if (!img.hasAttribute('alt')) {
                if (isEmoji) {
                    img.setAttribute('alt', 'Emoji');
                    img.setAttribute('role', 'img');
                } else {
                    img.setAttribute('alt', 'Forum image');
                }
            }
        }
    }
    
    // Import timestamp transformation methods from PostModernizer
    #transformTimestampElements(element) {
        var timestampSelectors = [
            '.lt.Sub a span.when',
            '.lt.Sub time',
            '.lt.Sub span',
            '.lt.Sub a',
            '.title2.top time',
            '.title2.top span',
            '.title2.top a',
            'span.when',
            'a[href*="#entry"]',
            'a[title*="/"]'
        ];
        
        var timestampElements = element.querySelectorAll(timestampSelectors.join(', '));
        
        for (var i = 0; i < timestampElements.length; i++) {
            var timestampElement = timestampElements[i];
            
            // Skip if the element itself is already a modern timestamp
            if (timestampElement.classList && timestampElement.classList.contains('modern-timestamp')) {
                continue;
            }
            
            // Skip if any ancestor is already a modern timestamp
            if (timestampElement.closest('.modern-timestamp')) {
                continue;
            }
            
            // Skip if this is an anchor that contains a modern timestamp
            if (timestampElement.tagName === 'A' && timestampElement.querySelector('.modern-timestamp')) {
                continue;
            }
            
            // Skip if this is a time element that contains a modern timestamp
            if (timestampElement.tagName === 'TIME' && timestampElement.querySelector('.modern-timestamp')) {
                continue;
            }
            
            // Skip if we're trying to transform something inside an already transformed timestamp
            if (timestampElement.closest('time.modern-timestamp, a .modern-timestamp')) {
                continue;
            }
            
            // Check if this is a .when element without a title attribute
            var isWhenWithoutTitle = timestampElement.classList && timestampElement.classList.contains('when') && !timestampElement.hasAttribute('title');
            
            if (isWhenWithoutTitle) {
                // For .when elements without title, use static month/year display
                var staticDate = this.#extractStaticMonthYearFromWhen(timestampElement);
                if (staticDate) {
                    var staticTimestamp = this.#createStaticMonthYearTimestamp(timestampElement, staticDate);
                    if (staticTimestamp) {
                        timestampElement.parentNode.replaceChild(staticTimestamp, timestampElement);
                    }
                }
                continue; // Skip regular timestamp processing for these elements
            }
            
            var dateString = this.#extractDateFromElement(timestampElement);
            
            if (dateString) {
                var modernTimestamp = this.#createModernTimestamp(timestampElement, dateString);
                
                if (modernTimestamp && modernTimestamp !== timestampElement) {
                    // Check if we're replacing an anchor that contains our timestamp
                    var parent = timestampElement.parentNode;
                    
                    // If the parent is an anchor and we're replacing its only child
                    if (parent && parent.tagName === 'A' && parent.children.length === 1 &&
                        parent.children[0] === timestampElement && parent.href && parent.href.includes('#entry')) {
                        // Replace the entire anchor with our new timestamp link
                        parent.parentNode.replaceChild(modernTimestamp, parent);
                    }
                    // If the element itself is an anchor with href
                    else if (timestampElement.tagName === 'A' && timestampElement.href &&
                             timestampElement.href.includes('#entry') &&
                             timestampElement.children.length === 0) {
                        // Replace the anchor directly
                        timestampElement.parentNode.replaceChild(modernTimestamp, timestampElement);
                    }
                    // If we're replacing a span inside an anchor
                    else if (timestampElement.tagName === 'SPAN' && parent && parent.tagName === 'A' &&
                             parent.href && parent.href.includes('#entry')) {
                        // Replace the span, but keep the anchor
                        parent.replaceChild(modernTimestamp, timestampElement);
                    }
                    // Default replacement
                    else {
                        timestampElement.parentNode.replaceChild(modernTimestamp, timestampElement);
                    }
                }
            }
        }
    }
    
    #extractStaticMonthYearFromWhen(whenElement) {
        // Extract month and year from .when element structure
        var dayElement = whenElement.querySelector('.d_day');
        var yearElement = whenElement.querySelector('.d_year');
        
        if (!dayElement || !yearElement) {
            return null;
        }
        
        // Decode HTML entities from text content
        var monthText = this.#decodeHtmlEntities(dayElement.textContent || '');
        var yearText = this.#decodeHtmlEntities(yearElement.textContent || '');
        
        // Remove non-digit characters
        var monthNumber = parseInt(monthText.replace(/[^\d]/g, ''), 10);
        var yearNumber = parseInt(yearText.replace(/[^\d]/g, ''), 10);
        
        // Validate month (1-12) and year (reasonable range)
        if (monthNumber < 1 || monthNumber > 12 || yearNumber < 2000 || yearNumber > 2100) {
            return null;
        }
        
        // Month names for display
        var monthNames = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];
        
        var monthName = monthNames[monthNumber - 1];
        
        // Return formatted string like "Dec, 2025"
        return monthName + ', ' + yearNumber;
    }
    
    #createStaticMonthYearTimestamp(originalElement, monthYearString) {
        // Create a simple static display for month/year dates
        var timeElement = document.createElement('time');
        timeElement.className = 'modern-timestamp static-month-year';
        
        // Generate unique ID for the timestamp
        var timestampId = 'timestamp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        // Clean the monthYearString by decoding any HTML entities
        var cleanMonthYearString = this.#decodeHtmlEntities(monthYearString);
        
        // Create a date object for the middle of the month for machine readability
        var monthYearMatch = cleanMonthYearString.match(/([A-Za-z]{3}), (\d{4})/);
        if (monthYearMatch) {
            var monthName = monthYearMatch[1];
            var year = parseInt(monthYearMatch[2], 10);
            
            var monthNames = {
                'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
            };
            
            if (monthNames.hasOwnProperty(monthName)) {
                var monthNumber = monthNames[monthName];
                var jsDate = new Date(year, monthNumber, 15, 12, 0, 0);
                var utcISOString = jsDate.toISOString();
                
                timeElement.setAttribute('datetime', utcISOString);
                timeElement.setAttribute('title', cleanMonthYearString);
                timeElement.setAttribute('data-timestamp-id', timestampId);
                timeElement.setAttribute('data-static-month-year', cleanMonthYearString);
                timeElement.setAttribute('data-original-element', 'when-without-title');
            }
        } else {
            timeElement.setAttribute('title', cleanMonthYearString);
            timeElement.setAttribute('data-static-month-year', cleanMonthYearString);
            timeElement.setAttribute('data-original-element', 'when-without-title');
        }
        
        // Create static month/year display (NO relative time)
        var staticSpan = document.createElement('span');
        staticSpan.className = 'static-month-year-display';
        staticSpan.textContent = cleanMonthYearString;
        
        timeElement.appendChild(staticSpan);
        
        // Try to preserve any link that might be around the original element
        var parent = originalElement.parentNode;
        if (parent && parent.tagName === 'A' && parent.href && parent.href.includes('#entry')) {
            var link = document.createElement('a');
            link.href = parent.href;
            
            // Copy rel attribute if exists
            if (parent.hasAttribute('rel')) {
                link.setAttribute('rel', parent.getAttribute('rel'));
            }
            
            link.appendChild(timeElement);
            return link;
        }
        
        return timeElement;
    }
    
    #decodeHtmlEntities(text) {
        // Create a temporary textarea element to decode HTML entities
        var textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    }
    
    #extractDateFromElement(element) {
        // Strategy 1: Check title attribute (most reliable)
        if (element.hasAttribute('title')) {
            var title = element.getAttribute('title');
            // Remove any time suffix like ":39" or ":10" but keep the time
            var cleanTitle = title.replace(/:(\d{2})$/, '');
            return cleanTitle;
        }
        
        // Strategy 2: For .when elements without title, construct date from child elements
        if (element.classList && element.classList.contains('when')) {
            return this.#constructDateFromWhenElement(element);
        }
        
        // Strategy 3: Check parent elements for title
        var parentCheckElements = [
            element.parentElement,
            element.parentElement ? element.parentElement.parentElement : null,
            element.closest('a'),
            element.closest('.lt.Sub'),
            element.closest('.title2')
        ];
        
        for (var j = 0; j < parentCheckElements.length; j++) {
            var parent = parentCheckElements[j];
            if (parent && parent.hasAttribute('title')) {
                var parentTitle = parent.getAttribute('title');
                var cleanTitle = parentTitle.replace(/:(\d{2})$/, '');
                return cleanTitle;
            }
        }
        
        // Strategy 4: Check text content - look for date patterns
        if (element.textContent) {
            var text = element.textContent.trim();
            
            // Look for date patterns
            var datePatterns = [
                /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
                /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)/i,
                /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2})/i,
                /(\d{1,2}\/\d{1,2}\/\d{4})/i
            ];
            
            for (var k = 0; k < datePatterns.length; k++) {
                var pattern = datePatterns[k];
                var match = text.match(pattern);
                if (match) {
                    return match[1].trim();
                }
            }
        }
        
        return null;
    }
    
    #constructDateFromWhenElement(whenElement) {
        // Extract day, month, and year from the .when element structure
        var dayElement = whenElement.querySelector('.d_day');
        var monthElement = whenElement.querySelector('.d_month');
        var yearElement = whenElement.querySelector('.d_year');
        
        if (!dayElement || !yearElement) {
            return null;
        }
        
        // IMPORTANT: When there's no title, .d_day contains the MONTH, not the day
        // .d_month is usually empty or contains nothing useful
        // Example: <span class="d_day">12</span> means December
        
        // Get text and decode HTML entities
        var dayText = this.#decodeHtmlEntities(dayElement.textContent || '');
        var monthNumber = parseInt(dayText.replace(/[^\d]/g, ''), 10); // Remove non-digits
        
        var yearText = this.#decodeHtmlEntities(yearElement.textContent || '');
        var year = parseInt(yearText.replace(/[^\d]/g, ''), 10); // Remove non-digits
        
        // Validate month number (1-12)
        if (monthNumber < 1 || monthNumber > 12) {
            return null;
        }
        
        // Validate year (should be reasonable)
        if (year < 2000 || year > 2100) {
            return null;
        }
        
        // Month names for display
        var monthNames = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];
        
        var monthName = monthNames[monthNumber - 1];
        
        // Return formatted string like "Dec, 2025"
        return monthName + ', ' + year;
    }
    
    #createModernTimestamp(originalElement, dateString) {
        if (typeof moment === 'undefined' || typeof moment.tz === 'undefined') {
            console.warn('Moment.js libraries not loaded, skipping timestamp transformation');
            return originalElement;
        }
        
        // Prevent recursive transformation
        if (originalElement.classList && originalElement.classList.contains('modern-timestamp')) {
            return originalElement;
        }
        
        // Check if element contains a modern timestamp
        if (originalElement.querySelector && originalElement.querySelector('.modern-timestamp')) {
            return originalElement;
        }
        
        // Check if we're inside a modern timestamp
        if (originalElement.closest && originalElement.closest('.modern-timestamp')) {
            return originalElement;
        }
        
        var momentDate = this.#parseForumDate(dateString);
        
        if (!momentDate) {
            return originalElement;
        }
        
        // Get user's locale settings
        var userSettings = this.#getUserLocaleSettings();
        
        // Create the link
        var link = document.createElement('a');
        
        // Determine the href - try multiple sources
        var href = null;
        
        // 1. Check if original element is an anchor
        if (originalElement.tagName === 'A' && originalElement.hasAttribute('href')) {
            href = originalElement.getAttribute('href');
        }
        // 2. Check if parent is an anchor
        else if (originalElement.parentElement && originalElement.parentElement.tagName === 'A' &&
                 originalElement.parentElement.hasAttribute('href')) {
            href = originalElement.parentElement.getAttribute('href');
        }
        // 3. Construct from post ID
        else {
            var articleElement = originalElement.closest('.article');
            if (articleElement && articleElement.id) {
                var articleIdMatch = articleElement.id.match(/\d+/);
                if (articleIdMatch) {
                    href = '#entry' + articleIdMatch[0];
                }
            }
        }
        
        if (href) {
            link.href = href;
            
            // Copy rel attribute if exists
            if (originalElement.hasAttribute('rel')) {
                link.setAttribute('rel', originalElement.getAttribute('rel'));
            } else if (originalElement.parentElement && originalElement.parentElement.tagName === 'A' &&
                      originalElement.parentElement.hasAttribute('rel')) {
                link.setAttribute('rel', originalElement.parentElement.getAttribute('rel'));
            }
        }
        
        // Create the time element
        var timeElement = document.createElement('time');
        timeElement.className = 'modern-timestamp';
        
        // Generate unique ID for the timestamp
        var timestampId = 'timestamp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        // Store UTC ISO string for machine readability
        var utcISOString = momentDate.toISOString();
        timeElement.setAttribute('datetime', utcISOString);
        
        // Convert to user's local timezone for display
        var userLocalDate = momentDate.tz(userSettings.timezone);
        
        // Create title with full localized date-time
        var titleFormat = userSettings.formats.longDateTime;
        var localizedTitle = userLocalDate.locale(userSettings.locale).format(titleFormat);
        var timezoneAbbr = userLocalDate.format('z');
        
        timeElement.setAttribute('title', localizedTitle + ' (' + timezoneAbbr + ')');
        
        // Store additional metadata
        timeElement.setAttribute('data-absolute-time', userLocalDate.locale(userSettings.locale).format('ddd, MMM D, YYYY h:mm A'));
        timeElement.setAttribute('data-timestamp-id', timestampId);
        timeElement.setAttribute('data-utc-date', utcISOString);
        timeElement.setAttribute('data-original-date', dateString);
        timeElement.setAttribute('data-parsed-date', dateString);
        timeElement.setAttribute('data-user-timezone', userSettings.timezone);
        timeElement.setAttribute('data-user-locale', userSettings.locale);
        timeElement.setAttribute('data-parsed-utc', utcISOString);
        
        // Create relative time display
        var relativeSpan = document.createElement('span');
        relativeSpan.className = 'relative-time';
        
        // Calculate relative time from UTC date
        var relativeTime = this.#formatTimeAgo(momentDate);
        relativeSpan.textContent = relativeTime;
        
        timeElement.appendChild(relativeSpan);
        
        // Only wrap with link if we have a valid href
        var finalElement;
        if (href) {
            link.appendChild(timeElement);
            finalElement = link;
        } else {
            finalElement = timeElement;
        }
        
        return finalElement;
    }
    
    #parseForumDate(dateString) {
        if (!dateString || typeof dateString !== 'string') {
            return null;
        }
        
        // Clean the date string - remove HTML entities and special characters
        var cleanDateString = this.#decodeHtmlEntities(dateString)
            .replace(/^Posted on\s*/i, '')
            .replace(/^on\s*/i, '')
            .replace(/^Posted\s*/i, '')
            .replace(/:(\d{2})$/, '') // Remove trailing seconds like ":39"
            .trim();
        
        // Check if it's a "Month, Year" format (e.g., "Dec, 2025")
        var monthYearPattern = /^([A-Za-z]{3,}),?\s+(\d{4})$/;
        var monthYearMatch = cleanDateString.match(monthYearPattern);
        
        if (monthYearMatch) {
            var monthName = monthYearMatch[1];
            var year = parseInt(monthYearMatch[2], 10);
            
            // Map month names to numbers
            var monthNames = {
                'jan': 0, 'january': 0,
                'feb': 1, 'february': 1,
                'mar': 2, 'march': 2,
                'apr': 3, 'april': 3,
                'may': 4,
                'jun': 5, 'june': 5,
                'jul': 6, 'july': 6,
                'aug': 7, 'august': 7,
                'sep': 8, 'september': 8,
                'oct': 9, 'october': 9,
                'nov': 10, 'november': 10,
                'dec': 11, 'december': 11
            };
            
            var monthKey = monthName.toLowerCase();
            if (monthNames.hasOwnProperty(monthKey)) {
                // Create date for the middle of the month (15th)
                var monthNumber = monthNames[monthKey];
                var jsDate = new Date(year, monthNumber, 15, 12, 0, 0);
                if (!isNaN(jsDate)) {
                    var momentDate = moment(jsDate);
                    return momentDate.utc();
                }
            }
        }
        
        // Common forum date formats
        var formats = [
            'MM/DD/YYYY, h:mm A', // 12/28/2025, 01:33 PM
            'MM/DD/YYYY, h:mm:ss A', // 12/28/2025, 01:33:39 PM
            'MM/DD/YYYY, HH:mm', // 12/28/2025, 13:33
            'MM/DD/YYYY, HH:mm:ss', // 12/28/2025, 13:33:39
            'MM-DD-YYYY, h:mm A', // 12-28-2025, 01:33 PM
            'DD/MM/YYYY, h:mm A', // 28/12/2025, 01:33 PM
            'DD/MM/YYYY, HH:mm', // 28/12/2025, 13:33
            'YYYY-MM-DD HH:mm:ss', // 2025-12-28 13:33:39
            'YYYY-MM-DDTHH:mm:ss', // 2025-12-28T13:33:39
            'MMMM D, YYYY', // December 28, 2025
            'MM/DD/YYYY', // 12/28/2025
            'M/D/YYYY', // 12/28/2025
            'DD MMMM YYYY', // 28 December 2025
            'MMM D, YYYY', // Dec 28, 2025
            'MMM, YYYY', // Dec, 2025
            'MMMM, YYYY', // December, 2025
        ];
        
        var momentDate = null;
        
        // Try parsing with each format
        for (var i = 0; i < formats.length; i++) {
            momentDate = moment(cleanDateString, formats[i], true);
            if (momentDate && momentDate.isValid()) {
                break;
            }
        }
        
        // If no format worked, try to parse the components manually
        if (!momentDate || !momentDate.isValid()) {
            // Try to parse "12/28/2025, 01:33 PM" pattern
            var pattern = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i;
            var match = cleanDateString.match(pattern);
            
            if (match) {
                var month = parseInt(match[1], 10) - 1;
                var day = parseInt(match[2], 10);
                var year = parseInt(match[3], 10);
                var hour = parseInt(match[4], 10);
                var minute = parseInt(match[5], 10);
                var second = match[6] ? parseInt(match[6], 10) : 0;
                var ampm = match[7] ? match[7].toUpperCase() : null;
                
                // Convert 12-hour format to 24-hour if needed
                if (ampm === 'PM' && hour < 12) {
                    hour += 12;
                } else if (ampm === 'AM' && hour === 12) {
                    hour = 0;
                }
                
                var jsDate = new Date(year, month, day, hour, minute, second);
                if (!isNaN(jsDate)) {
                    momentDate = moment(jsDate);
                }
            }
        }
        
        // Fallback to JavaScript Date for simple month/day/year
        if (!momentDate || !momentDate.isValid()) {
            // Try to parse simple date like "12/28/2025"
            var simpleMatch = cleanDateString.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
            if (simpleMatch) {
                var month = parseInt(simpleMatch[1], 10) - 1;
                var day = parseInt(simpleMatch[2], 10);
                var year = parseInt(simpleMatch[3], 10);
                
                var jsDate = new Date(year, month, day, 12, 0, 0);
                if (!isNaN(jsDate)) {
                    momentDate = moment(jsDate);
                }
            }
        }
        
        // Final fallback
        if (!momentDate || !momentDate.isValid()) {
            var jsDate = new Date(cleanDateString);
            if (!isNaN(jsDate)) {
                momentDate = moment(jsDate);
            }
        }
        
        if (momentDate && momentDate.isValid()) {
            // IMPORTANT: The forum shows times in USER'S LOCAL TIMEZONE
            // So we need to interpret it as local time, then convert to UTC
            return momentDate.utc();
        }
        
        return null;
    }
    
    #formatTimeAgo(date) {
        if (!date || !date.isValid()) {
            return 'Unknown time';
        }
        
        // Convert UTC date to user's local timezone for display
        var now = moment();
        var userDate = moment(date).local();
        
        var diffInSeconds = now.diff(userDate, 'seconds');
        var diffInMinutes = now.diff(userDate, 'minutes');
        var diffInHours = now.diff(userDate, 'hours');
        var diffInDays = now.diff(userDate, 'days');
        var diffInMonths = now.diff(userDate, 'months');
        var diffInYears = now.diff(userDate, 'years');
        
        // Check if this is a month/year only date (no specific day)
        // If the day is the 15th (default for month/year dates), use month/year format
        if (userDate.date() === 15) {
            // It's likely a month/year only date
            // Format as "Dec, 2025"
            return userDate.format('MMM, YYYY');
        }
        
        // Smart time ago display with precision for full dates
        if (diffInSeconds < 0) {
            return 'Just now';
        } else if (diffInSeconds < 45) {
            return 'Just now';
        } else if (diffInSeconds < 90) {
            return 'A minute ago';
        } else if (diffInMinutes < 45) {
            return diffInMinutes + ' minutes ago';
        } else if (diffInMinutes < 90) {
            return 'An hour ago';
        } else if (diffInHours < 24) {
            return diffInHours + ' hours ago';
        } else if (diffInDays === 1) {
            return 'Yesterday';
        } else if (diffInDays < 7) {
            return diffInDays + ' days ago';
        } else if (diffInDays < 30) {
            var weeks = Math.floor(diffInDays / 7);
            return weeks + (weeks === 1 ? ' week ago' : ' weeks ago');
        } else if (diffInDays < 365) {
            var months = Math.floor(diffInDays / 30);
            return months + (months === 1 ? ' month ago' : ' months ago');
        } else {
            var years = Math.floor(diffInDays / 365);
            return years + (years === 1 ? ' year ago' : ' years ago');
        }
    }
    
    #getUserLocaleSettings() {
        try {
            var locale = navigator.language || 'en-US';
            
            // Detect time format preference
            var testTime = moment().locale(locale).format('LT');
            var uses24Hour = !testTime.includes('AM') && !testTime.includes('PM');
            
            // Get user's timezone from browser
            var timezone = moment.tz.guess() || 'UTC';
            
            return {
                locale: locale,
                timezone: timezone,
                uses24Hour: uses24Hour,
                formats: {
                    longDateTime: 'LLLL',
                    mediumDateTime: 'llll',
                    shortDateTime: 'lll',
                    timeOnly: uses24Hour ? 'HH:mm' : 'h:mm A',
                    dateOnly: 'll'
                }
            };
        } catch (error) {
            return {
                locale: 'en-US',
                timezone: 'UTC',
                uses24Hour: false,
                formats: {
                    longDateTime: 'LLLL',
                    mediumDateTime: 'llll',
                    shortDateTime: 'lll',
                    timeOnly: 'h:mm A',
                    dateOnly: 'll'
                }
            };
        }
    }
    
    #modernizeQuotes(contentWrapper) {
        var quotes = contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top)');
        for (var i = 0; i < quotes.length; i++) {
            var container = quotes[i];
            if (container.classList.contains('quote-modernized')) continue;
            this.#transformQuote(container);
            container.classList.add('quote-modernized');
        }
    }
    
    #modernizeSpoilers(contentWrapper) {
        var spoilers = contentWrapper.querySelectorAll('div[align="center"].spoiler');
        for (var i = 0; i < spoilers.length; i++) {
            var container = spoilers[i];
            if (container.classList.contains('spoiler-modernized')) continue;
            this.#transformSpoiler(container);
            container.classList.add('spoiler-modernized');
        }
    }
    
    #modernizeCodeBlocksInContent(contentWrapper) {
        var codeBlocks = contentWrapper.querySelectorAll('div[align="center"]:has(.code_top)');
        for (var i = 0; i < codeBlocks.length; i++) {
            var container = codeBlocks[i];
            if (container.classList.contains('code-modernized')) continue;
            this.#transformCodeBlock(container);
            container.classList.add('code-modernized');
        }
    }
    
    #transformQuote(container) {
        var quoteTop = container.querySelector('.quote_top');
        var quoteContent = container.querySelector('.quote');
        
        if (!quoteTop || !quoteContent) return;
        
        var quoteText = quoteTop.textContent.trim();
        var match = quoteText.match(/QUOTE\s*\(([^@]+)\s*@/);
        var author = match ? match[1].trim() : 'Unknown';
        var quoteLink = quoteTop.querySelector('a');
        var linkHref = quoteLink ? quoteLink.href : '#';
        
        var modernQuote = document.createElement('div');
        modernQuote.className = 'modern-quote';
        
        var html = '<div class="quote-header">' +
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
        
        html += '<div class="quote-content">' + quoteContent.innerHTML + '</div>';
        
        modernQuote.innerHTML = html;
        this.#preserveMediaDimensions(modernQuote.querySelector('.quote-content'));
        container.replaceWith(modernQuote);
    }
    
    #transformSpoiler(container) {
        var spoilerTop = container.querySelector('.code_top');
        var spoilerContent = container.querySelector('.code[align="left"]');
        
        if (!spoilerTop || !spoilerContent) return;
        
        var modernSpoiler = document.createElement('div');
        modernSpoiler.className = 'modern-spoiler';
        
        var html = '<div class="spoiler-header" role="button" tabindex="0" aria-expanded="false">' +
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
        
        html += '<div class="spoiler-content">' + spoilerContent.innerHTML + '</div>';
        
        modernSpoiler.innerHTML = html;
        this.#preserveMediaDimensions(modernSpoiler.querySelector('.spoiler-content'));
        container.replaceWith(modernSpoiler);
        
        this.#addSpoilerEventListeners(modernSpoiler);
    }
    
    #addSpoilerEventListeners(spoilerElement) {
        var spoilerHeader = spoilerElement.querySelector('.spoiler-header');
        var spoilerToggle = spoilerElement.querySelector('.spoiler-toggle');
        var spoilerContent = spoilerElement.querySelector('.spoiler-content');
        
        spoilerContent.style.maxHeight = '0';
        spoilerContent.style.padding = '0 16px';
        spoilerHeader.setAttribute('aria-expanded', 'false');
        
        var toggleSpoiler = function() {
            var isExpanded = !spoilerElement.classList.contains('expanded');
            
            if (isExpanded) {
                spoilerElement.classList.add('expanded');
                spoilerHeader.setAttribute('aria-expanded', 'true');
                spoilerContent.style.maxHeight = spoilerContent.scrollHeight + 'px';
                spoilerContent.style.padding = '16px';
            } else {
                spoilerElement.classList.remove('expanded');
                spoilerHeader.setAttribute('aria-expanded', 'false');
                spoilerContent.style.maxHeight = '0';
                spoilerContent.style.padding = '0 16px';
            }
        };
        
        spoilerHeader.addEventListener('click', toggleSpoiler);
        if (spoilerToggle) {
            spoilerToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleSpoiler();
            });
        }
    }
    
    #transformCodeBlock(container) {
        var codeTop = container.querySelector('.code_top');
        var codeContent = container.querySelector('.code');
        
        if (!codeTop || !codeContent) return;
        
        var codeText = codeTop.textContent.trim();
        var codeType = codeText.toUpperCase();
        
        var modernCode = document.createElement('div');
        modernCode.className = 'modern-code';
        
        var html = '<div class="code-header">' +
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
        
        html += '<div class="code-content">' +
            '<pre><code>' + this.#escapeHtml(codeContent.textContent) + '</code></pre>' +
            '</div>';
        
        modernCode.innerHTML = html;
        container.replaceWith(modernCode);
        
        this.#addCodeEventListeners(modernCode, codeContent.textContent);
    }
    
    #addCodeEventListeners(codeElement, codeText) {
        var copyBtn = codeElement.querySelector('.code-copy-btn');
        
        if (copyBtn) {
            copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                this.#copyCodeToClipboard(codeText, 'code');
            }.bind(this));
        }
    }
    
    #copyCodeToClipboard(codeText, codeType) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(codeText).then(function() {
                this.#showCopyNotification('Copied ' + codeType + ' to clipboard!');
            }.bind(this)).catch(function() {
                this.#fallbackCopyCode(codeText, codeType);
            }.bind(this));
        } else {
            this.#fallbackCopyCode(codeText, codeType);
        }
    }
    
    #fallbackCopyCode(text, codeType) {
        var textArea = document.createElement('textarea');
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
    
    #showCopyNotification(message) {
        var notification = document.createElement('div');
        notification.className = 'copy-notification';
        notification.textContent = message;
        
        notification.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;background:var(--success-color);color:white;border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index: 9;font-weight:500;display:flex;align-items:center;gap:8px;transform:translateX(calc(100% + 20px));opacity:0;transition:transform 0.3s ease-out,opacity 0.3s ease-out;pointer-events:none;white-space:nowrap;';
        
        var icon = document.createElement('i');
        icon.className = 'fa-regular fa-check-circle';
        icon.setAttribute('aria-hidden', 'true');
        notification.prepend(icon);
        
        document.body.appendChild(notification);
        
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                notification.style.transform = 'translateX(0)';
                notification.style.opacity = '1';
            });
        });
        
        var dismissTimer = setTimeout(function() {
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';
            
            notification.addEventListener('transitionend', function() {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, { once: true });
        }, 2000);
        
        notification.style.pointerEvents = 'auto';
        notification.style.cursor = 'pointer';
        notification.addEventListener('click', function() {
            clearTimeout(dismissTimer);
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';
            
            notification.addEventListener('transitionend', function() {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, { once: true });
        });
    }
    
    #cleanupMiniButtons(element) {
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        var nodesToRemove = [];
        var node;
        
        while (node = walker.nextNode()) {
            if (node.textContent.trim() === '' || node.textContent.includes('&nbsp;') || /^\s*$/.test(node.textContent)) {
                nodesToRemove.push(node);
            }
        }
        
        for (var i = 0; i < nodesToRemove.length; i++) {
            var textNode = nodesToRemove[i];
            if (textNode.parentNode) {
                textNode.parentNode.removeChild(textNode);
            }
        }
    }
    
    #setInitialPointsState(pointsContainer) {
        var pointsPos = pointsContainer.querySelector('.points_pos');
        var pointsNeg = pointsContainer.querySelector('.points_neg');
        var pointsUp = pointsContainer.querySelector('.points_up');
        var pointsDown = pointsContainer.querySelector('.points_down');
        
        if (pointsPos) {
            if (pointsUp) pointsUp.classList.add('active');
            if (pointsDown) pointsDown.classList.remove('active');
        } else if (pointsNeg) {
            var pointsUpIcon = pointsUp ? pointsUp.querySelector('i') : null;
            var pointsDownIcon = pointsDown ? pointsDown.querySelector('i') : null;
            
            if (pointsUpIcon && pointsUpIcon.classList.contains('fa-thumbs-down')) {
                if (pointsUp) pointsUp.classList.add('active');
            }
            if (pointsDownIcon && pointsDownIcon.classList.contains('fa-thumbs-down')) {
                if (pointsDown) pointsDown.classList.add('active');
            }
            
            if (pointsUp && pointsUp.classList.contains('active')) {
                if (pointsDown) pointsDown.classList.remove('active');
            } else if (pointsDown && pointsDown.classList.contains('active')) {
                if (pointsUp) pointsUp.classList.remove('active');
            }
        }
    }
    
    #updatePointsContainerActiveState(pointsContainer) {
        if (!pointsContainer) return;
        
        var hasEm = pointsContainer.querySelector('em');
        pointsContainer.classList.toggle('active', !!hasEm);
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
    
    destroy() {
        var ids = [this.#articleModernizerId, this.#debouncedArticleObserverId, this.#emojiObserverId];
        
        for (var i = 0; i < ids.length; i++) {
            if (ids[i] && globalThis.forumObserver) {
                globalThis.forumObserver.unregister(ids[i]);
            }
        }
        
        if (this.#retryTimeoutId) {
            clearTimeout(this.#retryTimeoutId);
            this.#retryTimeoutId = null;
        }
        
        console.log('Article Modernizer destroyed');
    }
}

// Initialize Article Modernizer
(function initArticleModernizer() {
    var bodyId = document.body.id;
    var shouldModernize = bodyId === 'blog';
    
    if (!shouldModernize) {
        console.log('Article Modernizer skipped for body#' + bodyId);
        return;
    }
    
    var init = function() {
        try {
            globalThis.articleModernizer = new ArticleModernizer();
        } catch (error) {
            console.error('Failed to create Article Modernizer instance:', error);
            
            setTimeout(function() {
                if (!globalThis.articleModernizer) {
                    try {
                        globalThis.articleModernizer = new ArticleModernizer();
                    } catch (retryError) {
                        console.error('Article Modernizer failed on retry:', retryError);
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
globalThis.addEventListener('pagehide', function() {
    if (globalThis.articleModernizer && typeof globalThis.articleModernizer.destroy === 'function') {
        globalThis.articleModernizer.destroy();
    }
});
