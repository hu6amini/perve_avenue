// ============================================
// MEDIA DIMENSION EXTRACTOR - Must run first
// Waits for Weserv optimizer to complete
// ============================================

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
    #pendingImages = new Set();  // Track images waiting for Weserv
    #weservReady = false;        // Flag for Weserv completion
    #initStarted = false;        // Prevent double initialization

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
    
    // Emoji sizes based on CSS
    static #EMOJI_SIZE_NORMAL = 20;      // Body text: 16px × 1.25 = 20px
    static #EMOJI_SIZE_SMALL = 18;       // Signatures/quotes: 14px × 1.25 ≈ 18px
    static #EMOJI_SIZE_H1 = 35;          // h1: 32px × 1.1 = 35px
    static #EMOJI_SIZE_H2 = 29;          // h2: 25px × 1.15 = 29px
    static #EMOJI_SIZE_H3 = 24;          // h3: 20px × 1.2 = 24px
    static #EMOJI_SIZE_H4 = 20;          // h4: 16px × 1.25 = 20px
    static #EMOJI_SIZE_H5 = 18;          // h5: 14px × 1.3 = 18px
    static #EMOJI_SIZE_H6 = 16;          // h6: 12px × 1.35 = 16px
    static #BROKEN_IMAGE_SIZE = { width: 600, height: 400 };
    static #BATCH_SIZE = 50;

    constructor() {
        this.#imageLoadHandler = this.#handleImageLoad.bind(this);
        this.#cacheContextElements();
        
        // Wait for Weserv before initializing
        this.#waitForWeserv();
    }

    #waitForWeserv() {
        // Prevent double initialization
        if (this.#initStarted) return;
        this.#initStarted = true;

        // Check if Weserv already ran
        const processedImages = document.querySelectorAll('img[data-optimized="true"]');
        
        if (processedImages.length > 0) {
            console.log('✅ Weserv already processed ' + processedImages.length + ' images');
            this.#weservReady = true;
            this.#init();
            return;
        }

        console.log('⏳ Dimension extractor waiting for Weserv optimizer...');

        // Listen for Weserv ready event
        window.addEventListener('weserv-ready', (e) => {
            console.log('📢 Received weserv-ready event in dimension extractor', e.detail || '');
            this.#weservReady = true;
            this.#init();
        }, { once: true, passive: true });

        // Fallback: Poll for completion (max 3 seconds)
        let attempts = 0;
        const checkInterval = setInterval(() => {
            attempts++;
            const hasWeservImages = document.querySelectorAll('img[data-optimized="true"]').length > 0;
            
            if (hasWeservImages || attempts > 60) { // 60 * 50ms = 3 seconds
                clearInterval(checkInterval);
                
                if (!this.#weservReady) {
                    console.warn(hasWeservImages ? 
                        '⚠️ Weserv ready but event missed - proceeding' : 
                        '⚠️ Weserv timeout - proceeding anyway');
                    
                    this.#weservReady = true;
                    this.#init();
                }
            }
        }, 50);
    }

    #init() {
        // Dispatch ready event
        queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent('dimension-extractor-ready', {
                detail: { timestamp: Date.now() }
            }));
            console.log('📐 Dimension extractor ready');
        });

        this.#setupObserver();
        this.#cacheContextElements();
        
        // Process any pending images
        if (this.#pendingImages.size > 0) {
            console.log(`🔄 Processing ${this.#pendingImages.size} pending images`);
            this.#pendingImages.forEach(img => {
                if (img.isConnected) {
                    this.#processImage(img);
                }
            });
            this.#pendingImages.clear();
        }
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
        // Add this check at the beginning
        if (!node || !node.isConnected) {
            return;
        }
        
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
        // Skip if node is not in DOM
        if (!node || !node.isConnected) return;
        
        // Skip if this entire node is inside ProseMirror
        if (this.#isInsideProseMirror(node)) return;
        
        const images = node.getElementsByTagName('img');
        const iframes = node.getElementsByTagName('iframe');
        const videos = node.getElementsByTagName('video');

        // Process images
        for (let i = 0, len = images.length; i < len; i++) {
            const img = images[i];
            // Skip images inside ProseMirror
            if (this.#isInsideProseMirror(img)) continue;
            if (img.isConnected && !this.#processedMedia.has(img)) {
                this.#processImage(img);
            }
        }
        
        // Process iframes
        for (let i = 0, len = iframes.length; i < len; i++) {
            const iframe = iframes[i];
            if (iframe.isConnected && !this.#processedMedia.has(iframe)) {
                this.#processIframe(iframe);
            }
        }
        
        // Process videos
        for (let i = 0, len = videos.length; i < len; i++) {
            const video = videos[i];
            if (video.isConnected && !this.#processedMedia.has(video)) {
                this.#processVideo(video);
            }
        }
    }

    #processSingleMedia(media) {
        if (!media || !media.isConnected) return;
        if (this.#processedMedia.has(media)) return;
        
        // Skip if inside ProseMirror
        if (this.#isInsideProseMirror(media)) return;

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

    #isInsideProseMirror(element) {
        // Check if element or any parent has .tiptap or .ProseMirror class
        return element.closest('.tiptap, .ProseMirror') !== null;
    }

    #processImage(img) {
        // Skip images inside ProseMirror editors
        if (this.#isInsideProseMirror(img)) {
            return;
        }
        
        // ULTRA-AGGRESSIVE twemoji detection - MUST BE FIRST
        const isTwemoji = img.src.includes('twemoji') || 
                        img.classList.contains('twemoji') ||
                        img.classList.contains('emoji') ||
                        (img.alt && (img.alt.includes(':)') || img.alt.includes(':(') || img.alt.includes('emoji')));
        
        if (isTwemoji) {
            // Determine which size to use based on context
            let size = MediaDimensionExtractor.#EMOJI_SIZE_NORMAL;
            
            // Check for small contexts first (signatures, quotes, spoilers)
            if (this.#isInSmallContext(img)) {
                size = MediaDimensionExtractor.#EMOJI_SIZE_SMALL;
            } 
            // Check for headings
            else {
                const heading = img.closest('h1, h2, h3, h4, h5, h6');
                if (heading) {
                    switch(heading.tagName) {
                        case 'H1': size = MediaDimensionExtractor.#EMOJI_SIZE_H1; break;
                        case 'H2': size = MediaDimensionExtractor.#EMOJI_SIZE_H2; break;
                        case 'H3': size = MediaDimensionExtractor.#EMOJI_SIZE_H3; break;
                        case 'H4': size = MediaDimensionExtractor.#EMOJI_SIZE_H4; break;
                        case 'H5': size = MediaDimensionExtractor.#EMOJI_SIZE_H5; break;
                        case 'H6': size = MediaDimensionExtractor.#EMOJI_SIZE_H6; break;
                    }
                }
            }
            
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

        // NEW: If Weserv isn't ready yet, queue the image
        if (!this.#weservReady && !img.hasAttribute('data-optimized')) {
            this.#pendingImages.add(img);
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
        // Only set attributes if they're not already set or are wrong
        const currentWidth = img.getAttribute('width');
        const currentHeight = img.getAttribute('height');
        
        if (!currentWidth || currentWidth === '0' || currentWidth === 'auto') {
            img.setAttribute('width', width);
        }
        
        if (!currentHeight || currentHeight === '0' || currentHeight === 'auto') {
            img.setAttribute('height', height);
        }
        
        // Update aspect ratio WITHOUT overriding height
        img.style.aspectRatio = width + '/' + height;
        
        // IMPORTANT: Remove height: auto if it exists
        img.style.removeProperty('height');
        
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
                
                // Check if parent exists and if iframe is still in the DOM
                if (parent && document.contains(iframe) && !parent.classList.contains('iframe-wrapper')) {
                    try {
                        // Use documentFragment for batch DOM operations
                        const fragment = document.createDocumentFragment();
                        const wrapper = document.createElement('div');
                        wrapper.className = 'iframe-wrapper';
                        const paddingBottom = (heightNum / widthNum * 100) + '%';
                        wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:' + paddingBottom + ';overflow:hidden';

                        fragment.appendChild(wrapper);
                        
                        // Double-check parent still exists and contains iframe
                        if (parent && iframe.parentNode === parent) {
                            parent.insertBefore(fragment, iframe);
                            wrapper.appendChild(iframe);
                            iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0';
                        }
                    } catch (e) {
                        // Silent fail - iframe was likely removed during processing
                        console.debug('Iframe wrapper creation failed (expected if iframe was removed):', e.message);
                    }
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

    // ===== PUBLIC API METHODS =====
    
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

    // NEW: Refresh method for when Weserv becomes ready
    refresh() {
        console.log('🔄 Refreshing dimension extractor');
        
        // Clear processed flag for images without dimensions
        const images = document.querySelectorAll('img:not([width])');
        images.forEach(img => {
            this.#processedMedia.delete(img);
            this.#processImage(img);
        });
        
        // Reprocess pending images
        if (this.#pendingImages.size > 0) {
            this.#pendingImages.forEach(img => {
                if (img.isConnected) {
                    this.#processImage(img);
                }
            });
            this.#pendingImages.clear();
        }
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
            processedMedia: this.#processedMedia.size,
            pendingImages: this.#pendingImages.size,
            weservReady: this.#weservReady
        };
    }

    destroy() {
        this.#cleanup();
    }
}

// Initialize dimension extractor immediately
if (!globalThis.mediaDimensionExtractor) {
    try {
        globalThis.mediaDimensionExtractor = new MediaDimensionExtractor();
        console.log('📏 MediaDimensionExtractor initialized (top of forum_enhancer.js)');
    } catch (error) {
        console.error('Failed to initialize MediaDimensionExtractor:', error);
    }
}
