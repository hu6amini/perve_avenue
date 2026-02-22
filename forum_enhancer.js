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
    
    // UPDATED CONSTANTS TO MATCH NEW CSS HEADING SIZES:
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
        
        const images = node.getElementsByTagName('img');
        const iframes = node.getElementsByTagName('iframe');
        const videos = node.getElementsByTagName('video');

        // Process images
        for (let i = 0, len = images.length; i < len; i++) {
            const img = images[i];
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
                
                // FIX: Check if parent exists and if iframe is still in the DOM
                if (parent && document.contains(iframe) && !parent.classList.contains('iframe-wrapper')) {
                    // Check if wrapper already exists or if parent is being manipulated
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


// ==============================
// Complete Working Avatar System - INCLUDING LIKES/DISLIKES - OPTIMIZED VERSION
// ==============================

(function() {
    'use strict';

    // ==============================
    // CONFIGURATION
    // ==============================
    var AVATAR_THEME = {
        colors: {
            light: [
                '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2',
                '#EF476F', '#FFD166', '#06D6A0', '#073B4C', '#7209B7'
            ],
            dark: [
                '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2',
                '#EF476F', '#FFD166', '#06D6A0', '#073B4C', '#7209B7'
            ]
        },
        currentTheme: 'light'
    };

    var AVATAR_CONFIG = {
        sizes: {
            'post': 60,
            'profile_card': 80,
            'deleted_user': 60,
            'likes_list': 30
        },
        
        selectors: {
            '.summary li[class^="box_"]': {
                type: 'post',
                size: 'post',
                extractor: 'class'
            },
            
            'a.avatar[href*="MID="] .default-avatar': {
                type: 'default_avatar',
                size: 'profile_card',
                extractor: 'href'
            },
            
            '.post.box_visitatore': {
                type: 'deleted_user',
                size: 'deleted_user',
                extractor: 'visitatore'
            },
            
            '.popup.pop_points .users li a[href*="MID="]': {
                type: 'likes_list',
                size: 'likes_list',
                extractor: 'likes_href'
            }
        },
        
        dicebear: {
            style: 'initials',
            version: '7.x',
            format: 'svg'
        },
        
        cache: {
            duration: 86400000, // 24 hours
            prefix: 'avatar_',
            brokenPrefix: 'broken_avatar_',
            deletedPrefix: 'deleted_avatar_'
        },
        
        // Performance settings
        performance: {
            batchSize: 5,              // Process 5 users at a time
            batchDelay: 50,             // 50ms between batches
            prioritySelectors: [        // Elements to prioritize
                '.popup.pop_points',    // Popups first (they're visible)
                '.summary'              // Then summary
            ],
            maxConcurrentRequests: 3     // Maximum concurrent API requests
        }
    };

    // ==============================
    // STATE MANAGEMENT
    // ==============================
    var state = {
        pendingRequests: {},
        userCache: {},
        brokenAvatars: new Set(),
        processedPosts: new WeakSet(),
        processedAvatars: new WeakSet(),
        processedDeletedUsers: new WeakSet(),
        processedLikesList: new WeakSet(),
        isInitialized: false,
        cacheVersion: '2.2', // Updated version
        
        // Performance tracking
        processingQueue: [],
        isProcessing: false,
        activeRequests: 0,
        processedIds: new Set(), // Track processed user IDs to avoid duplicates
        pendingBatches: []
    };

    // ==============================
    // CORE FUNCTIONS
    // ==============================

    function getCacheKey(userId, size) {
        return AVATAR_CONFIG.cache.prefix + userId + '_' + size;
    }

    function getDeletedUserCacheKey(username, size) {
        var hash = 0;
        for (var i = 0; i < username.length; i++) {
            hash = ((hash << 5) - hash) + username.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_CONFIG.cache.deletedPrefix + Math.abs(hash) + '_' + size;
    }

    function clearOldCacheEntries() {
        var cutoff = Date.now() - AVATAR_CONFIG.cache.duration;
        var keysToRemove = [];
        
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && (key.startsWith(AVATAR_CONFIG.cache.prefix) || 
                        key.startsWith(AVATAR_CONFIG.cache.deletedPrefix))) {
                try {
                    var data = JSON.parse(localStorage.getItem(key));
                    if (data && data.timestamp < cutoff) {
                        keysToRemove.push(key);
                    }
                } catch (e) {
                    keysToRemove.push(key);
                }
            }
        }
        
        for (var j = 0; j < keysToRemove.length; j++) {
            localStorage.removeItem(keysToRemove[j]);
        }
        
        return keysToRemove.length;
    }

    function isBrokenAvatarUrl(avatarUrl) {
        if (!avatarUrl || avatarUrl === 'http') {
            return true;
        }
        
        if (avatarUrl.includes('dicebear.com')) {
            return false;
        }
        
        if (state.brokenAvatars.has(avatarUrl)) {
            return true;
        }
        
        var brokenKey = AVATAR_CONFIG.cache.brokenPrefix + btoa(avatarUrl).slice(0, 50);
        var brokenCache = localStorage.getItem(brokenKey);
        if (brokenCache) {
            try {
                var data = JSON.parse(brokenCache);
                if (Date.now() - data.timestamp < 3600000) { // 1 hour
                    state.brokenAvatars.add(avatarUrl);
                    return true;
                } else {
                    localStorage.removeItem(brokenKey);
                }
            } catch (e) {}
        }
        
        return false;
    }

    function markAvatarAsBroken(avatarUrl) {
        if (!avatarUrl || avatarUrl.includes('dicebear.com')) return;
        
        state.brokenAvatars.add(avatarUrl);
        var brokenKey = AVATAR_CONFIG.cache.brokenPrefix + btoa(avatarUrl).slice(0, 50);
        localStorage.setItem(brokenKey, JSON.stringify({
            url: avatarUrl,
            timestamp: Date.now()
        }));
    }

    function testImageUrl(url, callback) {
        if (!url || url === 'http') {
            callback(false);
            return;
        }
        
        if (url.includes('dicebear.com')) {
            callback(true);
            return;
        }
        
        var img = new Image();
        var timeoutId = setTimeout(function() {
            img.onload = img.onerror = null;
            callback(true); // Assume it might work
        }, 3000); // Reduced to 3 seconds for better performance
        
        img.onload = function() {
            clearTimeout(timeoutId);
            callback(true);
        };
        
        img.onerror = function() {
            clearTimeout(timeoutId);
            callback(false);
        };
        
        var separator = url.includes('?') ? '&' : '?';
        img.src = url + separator + 't=' + Date.now();
    }

    // ==============================
    // BATCH API REQUEST FUNCTION
    // ==============================

    function fetchMultipleUsers(userIds, callback) {
        if (!userIds || userIds.length === 0) {
            callback({});
            return;
        }
        
        // Remove duplicates
        var uniqueIds = [...new Set(userIds)];
        
        // Create a single request with multiple IDs (if API supports it)
        // If not, we'll fall back to individual requests with limits
        var url = '/api.php?mid=' + uniqueIds.join(',');
        
        fetch(url)
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Batch API failed');
                }
                return response.json();
            })
            .then(function(data) {
                callback(data);
            })
            .catch(function(error) {
                // Fall back to individual requests with concurrency limit
                fetchMultipleUsersIndividual(uniqueIds, callback);
            });
    }

    function fetchMultipleUsersIndividual(userIds, callback) {
        var results = {};
        var remaining = userIds.length;
        var maxConcurrent = AVATAR_CONFIG.performance.maxConcurrentRequests;
        var currentIndex = 0;
        
        function processNext() {
            if (currentIndex >= userIds.length) return;
            
            var batchEnd = Math.min(currentIndex + maxConcurrent, userIds.length);
            var batchIds = userIds.slice(currentIndex, batchEnd);
            currentIndex = batchEnd;
            
            batchIds.forEach(function(userId) {
                fetch('/api.php?mid=' + userId)
                    .then(function(response) {
                        if (!response.ok) throw new Error('API failed');
                        return response.json();
                    })
                    .then(function(data) {
                        Object.assign(results, data);
                        remaining--;
                        
                        if (remaining === 0) {
                            callback(results);
                        } else {
                            processNext();
                        }
                    })
                    .catch(function(error) {
                        remaining--;
                        
                        if (remaining === 0) {
                            callback(results);
                        } else {
                            processNext();
                        }
                    });
            });
        }
        
        processNext();
    }

    // ==============================
    // USERNAME EXTRACTION
    // ==============================

    function cleanUsername(username) {
        if (!username) return 'User';
        username = username.trim();
        username = username.replace(/\.{3,}/g, '');
        username = username.replace(/[\n\t]/g, ' ');
        username = username.replace(/\s+/g, ' ');
        
        if (username.length < 2 || /^[^a-zA-Z0-9]+$/.test(username)) {
            return 'User';
        }
        
        return username;
    }

    function extractUsernameFromElement(element, type, userId) {
        var username = '';
        
        if (type === 'post') {
            var nickname = element.querySelector('.nick a');
            if (nickname && nickname.textContent) {
                username = nickname.textContent;
            }
            
            if (!username) {
                var userClass = element.querySelector('.user' + userId);
                if (userClass && userClass.textContent) {
                    username = userClass.textContent;
                }
            }
            
            if (!username) {
                var midLinks = element.querySelectorAll('a[href*="MID=' + userId + '"]');
                for (var i = 0; i < midLinks.length; i++) {
                    if (midLinks[i].textContent) {
                        username = midLinks[i].textContent;
                        break;
                    }
                }
            }
        } else if (type === 'default_avatar') {
            var parentLink = element.closest('a[href*="MID="]');
            if (parentLink) {
                if (parentLink.title) {
                    username = parentLink.title;
                }
                
                if (!username && parentLink.textContent) {
                    username = parentLink.textContent;
                }
            }
        } else if (type === 'deleted_user') {
            var nickname = element.querySelector('.nick');
            if (nickname && nickname.textContent) {
                username = nickname.textContent;
            }
        } else if (type === 'likes_list') {
            if (element.textContent) {
                username = element.textContent;
            } else if (element.title) {
                username = element.title;
            }
            
            if (!username && element.className) {
                var classMatch = element.className.match(/user\d+/);
                if (classMatch) {
                    var userSpan = document.querySelector('.' + classMatch[0]);
                    if (userSpan && userSpan.textContent) {
                        username = userSpan.textContent;
                    }
                }
            }
        }
        
        return cleanUsername(username);
    }

    // ==============================
    // AVATAR GENERATION
    // ==============================

    function generateLetterAvatar(userId, username, size) {
        var displayName = username || 'User';
        var firstLetter = displayName.charAt(0).toUpperCase();
        
        if (!firstLetter.match(/[A-Z0-9]/i)) {
            firstLetter = '?';
        }
        
        var colors = AVATAR_THEME.colors.light;
        var colorIndex = 0;
        
        if (firstLetter >= 'A' && firstLetter <= 'Z') {
            colorIndex = (firstLetter.charCodeAt(0) - 65) % colors.length;
        } else if (firstLetter >= '0' && firstLetter <= '9') {
            colorIndex = (parseInt(firstLetter) + 26) % colors.length;
        } else {
            var hash = 0;
            for (var i = 0; i < username.length; i++) {
                hash = ((hash << 5) - hash) + username.charCodeAt(i);
                hash = hash & hash;
            }
            colorIndex = Math.abs(hash) % colors.length;
        }
        
        var backgroundColor = colors[colorIndex];
        if (backgroundColor.startsWith('#')) {
            backgroundColor = backgroundColor.substring(1);
        }
        
        var params = [
            'seed=' + encodeURIComponent(firstLetter),
            'backgroundColor=' + backgroundColor,
            'radius=50',
            'size=' + size
        ];
        
        return 'https://api.dicebear.com/7.x/initials/svg?' + params.join('&');
    }

    // ==============================
    // OPTIMIZED AVATAR FETCHING
    // ==============================

    function getAvatarFromCache(userId, size, isLikesList) {
        var cacheKey = userId + '_' + size;
        
        // Check memory cache
        if (state.userCache[cacheKey]) {
            var cached = state.userCache[cacheKey];
            var isGenerated = cached.url && cached.url.includes('dicebear.com');
            var isBroken = isBrokenAvatarUrl(cached.url);
            
            // For likes list, prefer real avatars
            if (isLikesList && isGenerated) {
                return null;
            }
            
            if (!isBroken) {
                return cached;
            }
            
            // If it's a real avatar marked broken, return null to retry
            if (!isGenerated && isBroken) {
                return null;
            }
        }
        
        // Check localStorage
        var stored = localStorage.getItem(getCacheKey(userId, size));
        if (stored) {
            try {
                var data = JSON.parse(stored);
                var isExpired = Date.now() - data.timestamp > AVATAR_CONFIG.cache.duration;
                var isOldVersion = !data.cacheVersion || data.cacheVersion !== state.cacheVersion;
                var isGenerated = data.url && data.url.includes('dicebear.com');
                var isBroken = isBrokenAvatarUrl(data.url);
                
                if (!isExpired && !isOldVersion) {
                    if (!isGenerated && isBroken) {
                        return null; // Retry broken real avatars
                    }
                    if (!isBroken) {
                        state.userCache[cacheKey] = data;
                        return data;
                    }
                }
            } catch (e) {}
        }
        
        return null;
    }

    function processAvatarQueue() {
        if (state.isProcessing || state.processingQueue.length === 0) return;
        
        state.isProcessing = true;
        
        // Group by type to prioritize popups
        var popupItems = [];
        var summaryItems = [];
        var otherItems = [];
        
        state.processingQueue.forEach(function(item) {
            var element = item.element;
            if (element.closest('.popup.pop_points')) {
                popupItems.push(item);
            } else if (element.closest('.summary')) {
                summaryItems.push(item);
            } else {
                otherItems.push(item);
            }
        });
        
        // Combine with priority order
        var prioritizedQueue = [...popupItems, ...summaryItems, ...otherItems];
        state.processingQueue = [];
        
        // Process in batches
        function processBatch(startIndex) {
            var batch = prioritizedQueue.slice(startIndex, startIndex + AVATAR_CONFIG.performance.batchSize);
            
            if (batch.length === 0) {
                state.isProcessing = false;
                return;
            }
            
            // Group by user ID for batch API requests
            var userMap = new Map();
            batch.forEach(function(item) {
                if (item.userId && !item.isDeletedUser) {
                    if (!userMap.has(item.userId)) {
                        userMap.set(item.userId, {
                            userId: item.userId,
                            username: item.username,
                            elements: [],
                            isLikesList: item.config.type === 'likes_list',
                            size: item.config.size
                        });
                    }
                    var userData = userMap.get(item.userId);
                    userData.elements.push({
                        element: item.element,
                        config: item.config
                    });
                } else {
                    // Handle deleted users immediately (no API call needed)
                    var avatarUrl = generateLetterAvatar(null, item.username, item.config.size);
                    insertAvatarForProcessedItem(item, avatarUrl, item.username);
                }
            });
            
            // Fetch real users in batch
            var realUsers = Array.from(userMap.values());
            if (realUsers.length > 0) {
                var userIds = realUsers.map(u => u.userId);
                
                fetchMultipleUsers(userIds, function(apiData) {
                    realUsers.forEach(function(userData) {
                        var userKey = 'm' + userData.userId;
                        var userApiData = apiData[userKey];
                        var finalUsername = userData.username;
                        var avatarUrl;
                        
                        if (userApiData && userApiData.nickname) {
                            finalUsername = cleanUsername(userApiData.nickname);
                        }
                        
                        if (userApiData && userApiData.avatar && 
                            userApiData.avatar.trim() !== '' && 
                            userApiData.avatar !== 'http') {
                            
                            avatarUrl = userApiData.avatar;
                            
                            // Test image asynchronously
                            testImageUrl(avatarUrl, function(success) {
                                if (success) {
                                    finishUserAvatars(userData, avatarUrl, finalUsername);
                                } else {
                                    markAvatarAsBroken(avatarUrl);
                                    avatarUrl = generateLetterAvatar(userData.userId, finalUsername, userData.size);
                                    finishUserAvatars(userData, avatarUrl, finalUsername);
                                }
                            });
                        } else {
                            avatarUrl = generateLetterAvatar(userData.userId, finalUsername, userData.size);
                            finishUserAvatars(userData, avatarUrl, finalUsername);
                        }
                        
                        function finishUserAvatars(userData, url, name) {
                            // Cache the avatar
                            var cacheKey = userData.userId + '_' + userData.size;
                            var cacheData = {
                                url: url,
                                username: name,
                                timestamp: Date.now(),
                                size: userData.size,
                                cacheVersion: state.cacheVersion,
                                source: url.includes('dicebear.com') ? 'generated' : 'forum'
                            };
                            
                            try {
                                localStorage.setItem(getCacheKey(userData.userId, userData.size), JSON.stringify(cacheData));
                            } catch (e) {
                                clearOldCacheEntries();
                                localStorage.setItem(getCacheKey(userData.userId, userData.size), JSON.stringify(cacheData));
                            }
                            
                            state.userCache[cacheKey] = cacheData;
                            
                            // Insert avatars for all elements of this user
                            userData.elements.forEach(function(elementInfo) {
                                insertAvatarForProcessedItem({
                                    element: elementInfo.element,
                                    config: elementInfo.config,
                                    userId: userData.userId,
                                    username: name
                                }, url, name);
                            });
                        }
                    });
                    
                    // Process next batch after delay
                    setTimeout(function() {
                        processBatch(startIndex + AVATAR_CONFIG.performance.batchSize);
                    }, AVATAR_CONFIG.performance.batchDelay);
                });
            } else {
                // No real users, process next batch
                setTimeout(function() {
                    processBatch(startIndex + AVATAR_CONFIG.performance.batchSize);
                }, AVATAR_CONFIG.performance.batchDelay);
            }
        }
        
        // Start processing first batch
        processBatch(0);
    }

    function insertAvatarForProcessedItem(item, avatarUrl, username) {
        var element = item.element;
        var config = item.config;
        var userId = item.userId;
        
        if (config.type === 'post') {
            insertPostAvatar(element, userId, config.size, avatarUrl, username);
            state.processedPosts.add(element);
        } else if (config.type === 'default_avatar') {
            insertDefaultAvatar(element, userId, config.size, avatarUrl, username);
            state.processedAvatars.add(element);
        } else if (config.type === 'deleted_user') {
            insertDeletedUserAvatar(element, null, config.size, avatarUrl, username);
            state.processedDeletedUsers.add(element);
        } else if (config.type === 'likes_list') {
            insertLikesListAvatar(element, userId, config.size, avatarUrl, username);
            state.processedLikesList.add(element);
        }
    }

    // ==============================
    // ELEMENT PROCESSING
    // ==============================

    function extractUserIdFromElement(element, extractorType) {
        var userId = null;
        
        if (extractorType === 'class') {
            var classMatch = element.className.match(/\bbox_m(\d+)\b/);
            if (classMatch) {
                userId = classMatch[1];
            } else {
                var parentBox = element.closest('[class*="box_m"]');
                if (parentBox) {
                    classMatch = parentBox.className.match(/\bbox_m(\d+)\b/);
                    if (classMatch) userId = classMatch[1];
                }
            }
        } else if (extractorType === 'href') {
            var linkElement = element.closest('a[href*="MID="]');
            if (linkElement) {
                var hrefMatch = linkElement.href.match(/MID=(\d+)/);
                if (hrefMatch) userId = hrefMatch[1];
            }
        } else if (extractorType === 'visitatore') {
            return null;
        } else if (extractorType === 'likes_href') {
            if (element.href) {
                var hrefMatch = element.href.match(/MID=(\d+)/) || 
                                element.href.match(/[?&]MID=(\d+)/) ||
                                element.href.match(/MID\%3D(\d+)/);
                
                if (hrefMatch) {
                    userId = hrefMatch[1];
                } else {
                    try {
                        var decodedUrl = decodeURIComponent(element.href);
                        hrefMatch = decodedUrl.match(/MID=(\d+)/);
                        if (hrefMatch) userId = hrefMatch[1];
                    } catch (e) {}
                }
            }
        }
        
        return userId;
    }

    function shouldProcessElement(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }
        
        var config = null;
        
        if (element.matches('.summary li[class^="box_"]')) {
            config = {
                type: 'post',
                size: AVATAR_CONFIG.sizes.post,
                extractor: 'class'
            };
        }
        else if (element.matches('a.avatar[href*="MID="] .default-avatar')) {
            var postParent = element.closest('.post');
            if (postParent) {
                config = {
                    type: 'default_avatar',
                    size: AVATAR_CONFIG.sizes.post,
                    extractor: 'href'
                };
            } else {
                config = {
                    type: 'default_avatar',
                    size: AVATAR_CONFIG.sizes.profile_card,
                    extractor: 'href'
                };
            }
        }
        else if (element.matches('.post.box_visitatore')) {
            config = {
                type: 'deleted_user',
                size: AVATAR_CONFIG.sizes.deleted_user,
                extractor: 'visitatore'
            };
        }
        else if (element.matches('.popup.pop_points .users li a[href*="MID="]')) {
            if (state.processedLikesList.has(element)) {
                return null;
            }
            
            config = {
                type: 'likes_list',
                size: AVATAR_CONFIG.sizes.likes_list,
                extractor: 'likes_href'
            };
        }
        
        if (!config) {
            return null;
        }
        
        if ((config.type === 'post' && state.processedPosts.has(element)) ||
            (config.type === 'default_avatar' && state.processedAvatars.has(element)) ||
            (config.type === 'deleted_user' && state.processedDeletedUsers.has(element)) ||
            (config.type === 'likes_list' && state.processedLikesList.has(element))) {
            return null;
        }
        
        var userId = extractUserIdFromElement(element, config.extractor);
        
        // Check if already has avatar
        if (config.type === 'post' || config.type === 'deleted_user') {
            var nickname = element.querySelector('.nick');
            if (!nickname) {
                return null;
            }
            if (nickname.previousElementSibling && 
                nickname.previousElementSibling.classList && 
                nickname.previousElementSibling.classList.contains('forum-avatar-container')) {
                if (config.type === 'post') {
                    state.processedPosts.add(element);
                } else {
                    state.processedDeletedUsers.add(element);
                }
                return null;
            }
        } else if (config.type === 'default_avatar') {
            if (!element.querySelector('.fa-user, .fa-regular.fa-user, .fas.fa-user')) {
                return null;
            }
            var parentLink = element.closest('a.avatar[href*="MID="]');
            if (parentLink && parentLink.querySelector('img.forum-user-avatar')) {
                state.processedAvatars.add(element);
                return null;
            }
        } else if (config.type === 'likes_list') {
            var span = element.closest('span');
            if (span && span.querySelector('img.forum-likes-avatar')) {
                state.processedLikesList.add(element);
                return null;
            }
        }
        
        return {
            element: element,
            userId: userId,
            config: config
        };
    }

    function queueElementForProcessing(processingInfo) {
        if (!processingInfo) return;
        
        var element = processingInfo.element;
        var userId = processingInfo.userId;
        var config = processingInfo.config;
        
        // Extract username now for immediate use if needed
        var username = extractUsernameFromElement(element, config.type, userId);
        
        // Check cache first for immediate insertion
        if (userId && config.type !== 'deleted_user') {
            var cached = getAvatarFromCache(userId, config.size, config.type === 'likes_list');
            if (cached) {
                // Insert immediately from cache
                insertAvatarForProcessedItem({
                    element: element,
                    config: config,
                    userId: userId,
                    username: cached.username
                }, cached.url, cached.username);
                return;
            }
        } else if (config.type === 'deleted_user') {
            // Deleted users can be generated immediately
            var avatarUrl = generateLetterAvatar(null, username, config.size);
            insertAvatarForProcessedItem({
                element: element,
                config: config,
                userId: null,
                username: username
            }, avatarUrl, username);
            return;
        }
        
        // Add to queue for batch processing
        state.processingQueue.push({
            element: element,
            userId: userId,
            username: username,
            config: config,
            isDeletedUser: config.type === 'deleted_user'
        });
        
        // Start processing queue if not already running
        if (!state.isProcessing) {
            setTimeout(function() {
                processAvatarQueue();
            }, 10);
        }
    }

    // ==============================
    // AVATAR CREATION & INSERTION
    // ==============================

    function createAvatarElement(avatarUrl, userId, size, username, isDeletedUser, isLikesList) {
        var img = new Image();
        
        if (isLikesList) {
            img.className = 'forum-likes-avatar avatar-size-' + size;
        } else {
            img.className = 'forum-user-avatar avatar-size-' + size;
        }
        
        if (isDeletedUser) {
            img.className += ' deleted-user-avatar';
        }
        
        img.alt = username ? 'Avatar for ' + username : '';
        img.loading = 'lazy';
        img.decoding = 'async';
        
        img.width = size;
        img.height = size;
        
        img.style.cssText = 
            'width:' + size + 'px;' +
            'height:' + size + 'px;' +
            'border-radius:50%;' +
            'object-fit:cover;' +
            'vertical-align:middle;' +
            'border:2px solid #fff;' +
            'box-shadow:0 2px 4px rgba(0,0,0,0.1);' +
            'background-color:#f0f0f0;' +
            'display:inline-block;';
        
        if (isLikesList) {
            img.style.cssText += 
                'margin-right:8px;' +
                'margin-left:4px;' +
                'border:1px solid #ddd;' +
                'box-shadow:0 1px 2px rgba(0,0,0,0.1);';
        }
        
        img.src = avatarUrl;
        
        if (username) {
            img.dataset.username = username;
        }
        
        img.addEventListener('error', function onError() {
            if (!avatarUrl.includes('dicebear.com')) {
                markAvatarAsBroken(avatarUrl);
            }
            
            if (userId) {
                var cacheKey = userId + '_' + size;
                delete state.userCache[cacheKey];
                localStorage.removeItem(getCacheKey(userId, size));
                
                var fallbackUrl = generateLetterAvatar(userId, username || '', size);
                this.src = fallbackUrl;
            } else if (username) {
                var cacheKey = 'deleted_' + username + '_' + size;
                delete state.userCache[cacheKey];
                localStorage.removeItem(getDeletedUserCacheKey(username, size));
                
                var fallbackUrl = generateLetterAvatar(null, username || '', size);
                this.src = fallbackUrl;
            }
            this.removeEventListener('error', onError);
        }, { once: true });
        
        return img;
    }

    function insertPostAvatar(postElement, userId, size, avatarUrl, username) {
        var nickname = postElement.querySelector('.nick a, .nick');
        if (!nickname) return;
        
        if (nickname.previousElementSibling && 
            nickname.previousElementSibling.classList && 
            nickname.previousElementSibling.classList.contains('forum-avatar-container')) {
            return;
        }
        
        var container = document.createElement('div');
        container.className = 'forum-avatar-container';
        container.style.cssText = 
            'display:inline-block;' +
            'vertical-align:middle;' +
            'position:relative;' +
            'margin-right:8px;';
        
        container.appendChild(createAvatarElement(avatarUrl, userId, size, username, false, false));
        nickname.parentNode.insertBefore(container, nickname);
    }

    function insertDefaultAvatar(defaultAvatarElement, userId, size, avatarUrl, username) {
        var parentLink = defaultAvatarElement.closest('a.avatar[href*="MID="]');
        if (!parentLink) return;
        
        if (parentLink.querySelector('img.forum-user-avatar')) {
            return;
        }
        
        var avatarImg = createAvatarElement(avatarUrl, userId, size, username, false, false);
        
        var defaultAvatarDiv = parentLink.querySelector('.default-avatar');
        if (defaultAvatarDiv) {
            defaultAvatarDiv.parentNode.replaceChild(avatarImg, defaultAvatarDiv);
        } else {
            parentLink.appendChild(avatarImg);
        }
        
        parentLink.classList.add('avatar-replaced');
    }

    function insertDeletedUserAvatar(postElement, userId, size, avatarUrl, username) {
        var nickname = postElement.querySelector('.nick');
        if (!nickname) return;
        
        if (nickname.previousElementSibling && 
            nickname.previousElementSibling.classList && 
            nickname.previousElementSibling.classList.contains('forum-avatar-container')) {
            return;
        }
        
        var container = document.createElement('div');
        container.className = 'forum-avatar-container deleted-user-container';
        container.style.cssText = 
            'display:inline-block;' +
            'vertical-align:middle;' +
            'position:relative;' +
            'margin-right:8px;';
        
        container.appendChild(createAvatarElement(avatarUrl, null, size, username, true, false));
        nickname.parentNode.insertBefore(container, nickname);
    }

    function insertLikesListAvatar(linkElement, userId, size, avatarUrl, username) {
        var span = linkElement.closest('span');
        if (!span) return;
        
        if (span.querySelector('img.forum-likes-avatar')) {
            return;
        }
        
        var avatarImg = createAvatarElement(avatarUrl, userId, size, username, false, true);
        
        span.insertBefore(avatarImg, linkElement);
        
        span.classList.add('has-forum-avatar');
    }

    // ==============================
    // PAGE PROCESSING
    // ==============================

    function handleNewElement(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        
        // Check the node itself
        var nodeInfo = shouldProcessElement(node);
        if (nodeInfo) {
            queueElementForProcessing(nodeInfo);
        }
        
        // Check for child elements based on priority
        setTimeout(function() {
            // Check popups first (highest priority)
            var popups = node.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
            for (var k = 0; k < popups.length; k++) {
                var likesInfo = shouldProcessElement(popups[k]);
                if (likesInfo) {
                    queueElementForProcessing(likesInfo);
                }
            }
            
            // Then check posts
            var posts = node.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
            for (var i = 0; i < posts.length; i++) {
                var postInfo = shouldProcessElement(posts[i]);
                if (postInfo) {
                    queueElementForProcessing(postInfo);
                }
            }
            
            // Finally check default avatars
            var defaultAvatars = node.querySelectorAll('a.avatar[href*="MID="] .default-avatar');
            for (var j = 0; j < defaultAvatars.length; j++) {
                var avatarInfo = shouldProcessElement(defaultAvatars[j]);
                if (avatarInfo) {
                    queueElementForProcessing(avatarInfo);
                }
            }
        }, 0);
    }

    function processExistingElements() {
        // Process popups first (highest priority)
        var likesLinks = document.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
        for (var k = 0; k < likesLinks.length; k++) {
            var likesInfo = shouldProcessElement(likesLinks[k]);
            if (likesInfo) {
                queueElementForProcessing(likesInfo);
            }
        }
        
        // Then process posts
        var posts = document.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
        for (var i = 0; i < posts.length; i++) {
            var postInfo = shouldProcessElement(posts[i]);
            if (postInfo) {
                queueElementForProcessing(postInfo);
            }
        }
        
        // Finally process default avatars
        var defaultAvatars = document.querySelectorAll('a.avatar[href*="MID="] .default-avatar');
        for (var j = 0; j < defaultAvatars.length; j++) {
            var avatarInfo = shouldProcessElement(defaultAvatars[j]);
            if (avatarInfo) {
                queueElementForProcessing(avatarInfo);
            }
        }
    }

    // ==============================
    // OBSERVER INTEGRATION
    // ==============================

    function setupObserver() {
        if (window.forumObserver && typeof window.forumObserver.register === 'function') {
            window.forumObserver.register({
                id: 'forum_avatars_working',
                selector: '.summary li[class^="box_"], a.avatar[href*="MID="] .default-avatar, .post.box_visitatore, .popup.pop_points .users li a[href*="MID="]',
                callback: handleNewElement,
                priority: 'high'
            });
        }
    }

    // ==============================
    // INITIALIZATION
    // ==============================

    function initAvatarSystem() {
        if (state.isInitialized) return;
        
        // Clear old cache entries
        clearOldCacheEntries();
        
        setupObserver();
        
        // Process existing elements immediately
        setTimeout(function() {
            processExistingElements();
            state.isInitialized = true;
        }, 50); // Reduced delay for faster startup
    }

    // ==============================
    // PUBLIC API
    // ==============================

    window.ForumAvatars = {
        init: initAvatarSystem,
        
        refresh: function() {
            // Remove all avatars
            var containers = document.querySelectorAll('.forum-avatar-container, .has-forum-avatar img.forum-likes-avatar');
            for (var i = 0; i < containers.length; i++) {
                containers[i].remove();
            }
            
            var replacedAvatars = document.querySelectorAll('.avatar-replaced img.forum-user-avatar');
            for (var j = 0; j < replacedAvatars.length; j++) {
                replacedAvatars[j].remove();
            }
            
            var replacedLinks = document.querySelectorAll('.avatar-replaced, .has-forum-avatar');
            for (var k = 0; k < replacedLinks.length; k++) {
                replacedLinks[k].classList.remove('avatar-replaced');
                replacedLinks[k].classList.remove('has-forum-avatar');
            }
            
            // Reset state
            state.userCache = {};
            state.brokenAvatars.clear();
            state.processedPosts = new WeakSet();
            state.processedAvatars = new WeakSet();
            state.processedDeletedUsers = new WeakSet();
            state.processedLikesList = new WeakSet();
            state.processingQueue = [];
            state.isProcessing = false;
            state.isInitialized = false;
            
            // Clear localStorage
            var clearedKeys = [];
            for (var l = 0; l < localStorage.length; l++) {
                var key = localStorage.key(l);
                if (key && (key.startsWith(AVATAR_CONFIG.cache.prefix) || 
                            key.startsWith(AVATAR_CONFIG.cache.deletedPrefix))) {
                    localStorage.removeItem(key);
                    clearedKeys.push(key);
                }
            }
            
            initAvatarSystem();
        },
        
        clearCache: function() {
            state.userCache = {};
            
            var clearedCount = 0;
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && (key.startsWith(AVATAR_CONFIG.cache.prefix) || 
                            key.startsWith(AVATAR_CONFIG.cache.deletedPrefix))) {
                    localStorage.removeItem(key);
                    clearedCount++;
                }
            }
            
            return clearedCount;
        },
        
        resetBrokenAvatars: function() {
            state.brokenAvatars.clear();
            
            var clearedCount = 0;
            var keysToRemove = [];
            
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.startsWith(AVATAR_CONFIG.cache.brokenPrefix)) {
                    keysToRemove.push(key);
                    clearedCount++;
                }
            }
            
            keysToRemove.forEach(key => localStorage.removeItem(key));
            
            this.refresh();
            
            return clearedCount;
        },
        
        stats: function() {
            var cacheCount = 0;
            var deletedCacheCount = 0;
            var generatedCount = 0;
            var realCount = 0;
            var brokenCount = 0;
            
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.startsWith(AVATAR_CONFIG.cache.prefix)) {
                    cacheCount++;
                    try {
                        var data = JSON.parse(localStorage.getItem(key));
                        if (data && data.url) {
                            if (data.url.includes('dicebear.com')) {
                                generatedCount++;
                            } else {
                                realCount++;
                            }
                        }
                    } catch (e) {}
                }
                if (key && key.startsWith(AVATAR_CONFIG.cache.deletedPrefix)) {
                    deletedCacheCount++;
                }
                if (key && key.startsWith(AVATAR_CONFIG.cache.brokenPrefix)) {
                    brokenCount++;
                }
            }
            
            var posts = document.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
            var withAvatars = 0;
            for (var j = 0; j < posts.length; j++) {
                var nickname = posts[j].querySelector('.nick a, .nick');
                if (nickname && nickname.previousElementSibling && 
                    nickname.previousElementSibling.classList && 
                    nickname.previousElementSibling.classList.contains('forum-avatar-container')) {
                    withAvatars++;
                }
            }
            
            var likesAvatars = document.querySelectorAll('.forum-likes-avatar').length;
            
            return {
                postsTotal: posts.length,
                postsWithAvatars: withAvatars,
                likesAvatars: likesAvatars,
                memoryCache: Object.keys(state.userCache).length,
                localStorageCache: cacheCount,
                realAvatars: realCount,
                generatedAvatars: generatedCount,
                deletedUserCache: deletedCacheCount,
                brokenFlags: brokenCount,
                brokenInMemory: state.brokenAvatars.size,
                queueSize: state.processingQueue.length,
                isProcessing: state.isProcessing,
                isInitialized: state.isInitialized,
                cacheVersion: state.cacheVersion
            };
        },
        
        debugUser: function(userId) {
            var posts = document.querySelectorAll('.summary li[class*="box_m' + userId + '"]');
            
            for (var i = 0; i < posts.length; i++) {
                var nickname = posts[i].querySelector('.nick a, .nick');
                
                var extracted = extractUsernameFromElement(posts[i], 'post', userId);
            }
            
            fetch('/api.php?mid=' + userId)
                .then(r => r.json())
                .then(data => {
                })
                .catch(err => {});
        },
        
        debugLikes: function() {
            var likesLinks = document.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
            
            for (var i = 0; i < likesLinks.length; i++) {
                var link = likesLinks[i];
                
                var userId = extractUserIdFromElement(link, 'likes_href');
                
                var username = extractUsernameFromElement(link, 'likes_list', userId);
            }
        }
    };

    // ==============================
    // AUTO-INITIALIZE
    // ==============================

    // Initialize immediately since script is loaded with defer
    setTimeout(initAvatarSystem, 50);

})();
    

    // ==============================
    // VIDEO-IFRAME
    // ==============================
'use strict';

// Enhanced replacement function
function replaceVideoIframes() {
    var iframes = document.querySelectorAll('.post .color iframe, #loading .color iframe');
    console.log('Found ' + iframes.length + ' iframes to process');

    for (var i = 0; i < iframes.length; i++) {
        var iframe = iframes[i];

        // Skip if already processed
        if (iframe.hasAttribute('data-lite-processed')) continue;

        var src = iframe.src || iframe.getAttribute('data-src');
        if (!src) {
            console.warn('Iframe ' + i + ' has no src');
            continue;
        }

        var videoId = null;
        var element = null;

        // YouTube
        if (src.includes('youtube.com/embed/') || src.includes('youtube-nocookie.com/embed/')) {
            videoId = extractYouTubeId(src);
            if (videoId) {
                element = document.createElement('lite-youtube');
                element.setAttribute('videoid', videoId);
                element.setAttribute('params', 'rel=0&modestbranding=1');
            }
        }
        // Vimeo
        else if (src.includes('player.vimeo.com/video/')) {
            videoId = extractVimeoId(src);
            if (videoId) {
                element = document.createElement('lite-vimeo');
                element.setAttribute('videoid', videoId);
            }
        }

        if (element && videoId) {
            // Copy attributes
            copyAttributes(iframe, element);

            // Mark as processed
            iframe.setAttribute('data-lite-processed', 'true');

            // Replace
            iframe.parentNode.replaceChild(element, iframe);
            console.log('✓ Replaced iframe ' + i + ' with ' + element.tagName + ' (ID: ' + videoId + ')');
        }
    }
}

// Helper functions
function extractYouTubeId(url) {
    var match = url.match(/(?:\/embed\/|v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

function extractVimeoId(url) {
    var match = url.match(/vimeo\.com\/video\/(\d+)/) ||
                url.match(/player\.vimeo\.com\/video\/(\d+)/);
    return match ? match[1] : null;
}

function copyAttributes(source, target) {
    for (var j = 0; j < source.attributes.length; j++) {
        var attr = source.attributes[j];
        var name = attr.name;
        var value = attr.value;

        if (name.startsWith('data-') ||
            name === 'class' ||
            name === 'style' ||
            name === 'title' ||
            name === 'allowfullscreen' ||
            name === 'loading' ||
            name === 'width' ||
            name === 'height') {
            target.setAttribute(name, value);
        }
    }
}

// Wait for custom elements to be defined before processing
function waitForCustomElements() {
    var checkInterval = 100;
    var timeout = 5000;
    var startTime = Date.now();

    function check() {
        var youtubeReady = customElements.get('lite-youtube');
        var vimeoReady = customElements.get('lite-vimeo');

        if (youtubeReady && vimeoReady) {
            replaceVideoIframes();
            // Register with ForumCoreObserver for dynamic content
            registerWithObserver();
        } else if (Date.now() - startTime < timeout) {
            setTimeout(check, checkInterval);
        } else {
            console.warn('Custom elements not loaded after timeout');
            replaceVideoIframes();
            // No fallback observer - rely on ForumCoreObserver or manual triggers
        }
    }

    check();
}

// Register with ForumCoreObserver for dynamic content handling
function registerWithObserver() {
    if (typeof forumObserver !== 'undefined' && forumObserver.register) {
        // Register callback for iframe processing
        forumObserver.register({
            id: 'video-iframe-replacement',
            callback: function(node) {
                // Quick check if this could contain iframes
                var isRelevant = false;
                
                // Direct iframe match
                if (node.matches && node.matches('.post .color iframe, #loading .color iframe')) {
                    isRelevant = true;
                }
                // Container that could have iframes
                else if (node.matches && (node.matches('.post .color') || node.matches('#loading .color'))) {
                    isRelevant = true;
                }
                // New iframe added to body (forumObserver passes the added node)
                else if (node.matches && node.matches('iframe')) {
                    // Check if this iframe is in our target areas
                    var parent = node.parentElement;
                    while (parent) {
                        if (parent.matches && 
                            (parent.matches('.post .color') || parent.matches('#loading .color'))) {
                            isRelevant = true;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }
                
                if (!isRelevant) return;
                
                // Process specific iframes
                var iframes = [];
                
                // If node is an iframe
                if (node.matches && node.matches('iframe')) {
                    iframes.push(node);
                }
                // If node is a container, get its iframes
                else if (node.querySelectorAll) {
                    var found = node.querySelectorAll('.post .color iframe, #loading .color iframe');
                    for (var i = 0; i < found.length; i++) {
                        iframes.push(found[i]);
                    }
                }
                
                // Process found iframes
                for (var j = 0; j < iframes.length; j++) {
                    var iframe = iframes[j];
                    if (iframe.hasAttribute('data-lite-processed')) continue;

                    var src = iframe.src || iframe.getAttribute('data-src');
                    if (!src) continue;

                    var videoId = null;
                    var element = null;

                    // YouTube
                    if (src.includes('youtube.com/embed/') || src.includes('youtube-nocookie.com/embed/')) {
                        videoId = extractYouTubeId(src);
                        if (videoId) {
                            element = document.createElement('lite-youtube');
                            element.setAttribute('videoid', videoId);
                            element.setAttribute('params', 'rel=0&modestbranding=1');
                        }
                    }
                    // Vimeo
                    else if (src.includes('player.vimeo.com/video/')) {
                        videoId = extractVimeoId(src);
                        if (videoId) {
                            element = document.createElement('lite-vimeo');
                            element.setAttribute('videoid', videoId);
                        }
                    }

                    if (element && videoId) {
                        copyAttributes(iframe, element);
                        iframe.setAttribute('data-lite-processed', 'true');
                        iframe.parentNode.replaceChild(element, iframe);
                    }
                }
            },
            // Watch for iframes and their containers
            selector: 'iframe, .post .color, #loading .color, .color',
            priority: 'high'
        });
        
        console.log('📝 Registered video iframe replacement with ForumCoreObserver');
        
        // Also add a periodic check for missed iframes (just in case)
        setupPeriodicCheck();
    } else {
        console.warn('ForumCoreObserver not available - video iframes will only be replaced on initial load');
        // No fallback observer - this is intentional to avoid duplicate observers
    }
}

// Simple periodic check as a backup (no MutationObserver)
function setupPeriodicCheck() {
    // Run once after a delay to catch anything that might have been missed
    setTimeout(replaceVideoIframes, 1000);
    
    // Run again after a longer delay for AJAX content
    setTimeout(replaceVideoIframes, 3000);
    
    // If the page supports it, run on visibility change
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            setTimeout(replaceVideoIframes, 500);
        }
    }, { passive: true });
}

// Initialize
function initVideoIframeReplacement() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForCustomElements);
    } else {
        waitForCustomElements();
    }
}

// Start the process
initVideoIframeReplacement();

// Manual trigger for testing or manual re-scan
if (typeof window !== 'undefined') {
    window.replaceVideoIframes = replaceVideoIframes;
    window.initVideoIframeReplacement = initVideoIframeReplacement;
}

// Export for use by other scripts if they need to trigger video processing
window.videoIframeUtils = {
    replace: replaceVideoIframes,
    init: initVideoIframeReplacement
};


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
// Optimized for performance and modern JavaScript patterns
class PostModernizer {
    #postModernizerId = null;
    #activeStateObserverId = null;
    #debouncedObserverId = null;
    #cleanupObserverId = null;
    #searchPostObserverId = null;
    #quoteLinkObserverId = null;
    #codeBlockObserverId = null;
    #attachmentObserverId = null;
    #embeddedLinkObserverId = null;
    #summaryObserverId = null;
    #retryTimeoutId = null;
    #maxRetries = 10;
    #retryCount = 0;
    #domUpdates = new WeakMap();
    #rafPending = false;
    #timeUpdateIntervals = new Map();
    #formatPatterns = new Map();
    #dateFormatCache = new Map();
    #formatConfidence = { EU: 0, US: 0, AUTO: 0 };
    #detectedSeparator = null;
    #detectedTimeFormat = null;

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
                this.#transformSearchPostElements();
                this.#setupSearchPostObserver();
            } else {
                this.#transformPostElements();
                this.#setupObserverCallbacks();
                this.#setupActiveStateObserver();
            }
            
            this.#enhanceReputationSystem();
            this.#setupEnhancedAnchorNavigation();
            this.#enhanceQuoteLinks();
            this.#modernizeCodeBlocks();
            this.#modernizeAttachments();
            this.#modernizeEmbeddedLinks();
            this.#modernizePolls();
            this.#transformSummaryPostPreviews();
            this.#setupSummaryPostObserver();

            // Clean up any double-wrapped media from previous runs
            setTimeout(() => {
                this.#cleanupAllDoubleWrappedMedia();
            }, 500);

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

    #cleanupAllDoubleWrappedMedia() {
        document.querySelectorAll('.standard-media-wrapper').forEach(standardWrapper => {
            const parent = standardWrapper.parentElement;
            
            // Check if parent is also a wrapper
            if (parent && (parent.classList.contains('media-wrapper') || 
                          parent.classList.contains('iframe-wrapper') ||
                          (parent.style.position === 'relative' && parent.style.paddingBottom))) {
                
                // Move standard wrapper out of the parent wrapper
                parent.parentNode.insertBefore(standardWrapper, parent);
                
                // Remove the old wrapper if it's empty now
                if (parent.children.length === 0) {
                    parent.remove();
                }
            }
        });
    }

    // ==============================
    // EMBEDDED LINK TRANSFORMATION
    // ==============================

    #modernizeEmbeddedLinks() {
        this.#processExistingEmbeddedLinks();
        this.#setupEmbeddedLinkObserver();
    }

    #isInEditor(element) {
        if (!element || !element.closest) return false;
        const selectors = [
            '.ve-content',
            '[contenteditable="true"]',
            '.ProseMirror',
            '.tiptap',
            '.editor-container',
            '#compose',
            '.composer',
            '.message-editor',
            '.reply-editor',
            '.new-topic-editor'
        ];
        return selectors.some(selector => element.closest(selector));
    }

    #processExistingEmbeddedLinks() {
        document.querySelectorAll('.ffb_embedlink:not(.embedded-link-modernized)').forEach(container => {
            if (this.#isInEditor(container)) return;
            this.#transformEmbeddedLink(container);
            container.classList.add('embedded-link-modernized');
        });
    }

#transformEmbeddedLink(container) {
    if (this.#isInEditor(container) || 
        container.classList.contains('modern-embedded-link') ||
        !container) return;

    try {
        const mainLinks = container.querySelectorAll('a[target="_blank"]');
        const mainLink = mainLinks[0] || null;
        if (!mainLink) return;

        const href = mainLink.href;
        const domain = this.#extractDomain(href);
        
        let title = '';
        let description = '';
        let imageUrl = '';
        let faviconUrl = '';

        const allLinks = container.querySelectorAll('a[target="_blank"]');
        if (allLinks.length >= 2) {
            const titleElement = allLinks[1];
            const titleSpan = titleElement.querySelector('span.post-text');
            title = titleSpan ? titleSpan.textContent.trim() : titleElement.textContent.trim();
        }

        if (!title) {
            container.querySelectorAll('span.post-text').forEach(span => {
                const text = span.textContent.trim();
                const lowerText = text.toLowerCase();
                if (text.length > 20 && text.length < 200 && 
                    !lowerText.includes(domain.toLowerCase()) && 
                    !lowerText.includes('leggi altro') &&
                    !lowerText.includes('read more') &&
                    !text.includes('>')) {
                    title = text;
                }
            });
        }

        if (!title) {
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            const texts = [];
            let node;
            while ((node = walker.nextNode())) {
                const text = node.textContent.trim();
                if (text && 
                    !text.toLowerCase().includes(domain.toLowerCase()) && 
                    !text.toLowerCase().includes('leggi altro') &&
                    !text.toLowerCase().includes('read more') &&
                    !text.includes('>')) {
                    texts.push(text);
                }
            }
            
            for (let i = 0; i < texts.length; i++) {
                if (texts[i].length > 20 && texts[i].length < 200) {
                    title = texts[i];
                    break;
                }
            }
        }

        if (!title) {
            title = 'Article on ' + domain;
        }

        if (title !== 'Article on ' + domain) {
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let foundTitle = false;
            let node;
            while ((node = walker.nextNode())) {
                const text = node.textContent.trim();
                if (!text) continue;
                
                if (!foundTitle && (text === title || text.includes(title.substring(0, 20)))) {
                    foundTitle = true;
                    continue;
                }
                
                if (foundTitle && text && text.length > 30) {
                    description = text;
                    break;
                }
            }
        }

        // ===== SIMPLIFIED IMAGE DETECTION =====
        // Look for images - there are only two: favicon and preview
        
        container.querySelectorAll('img').forEach(img => {
            const src = img.src || '';
            
            // Check if this is the favicon (contains "favicon" in URL)
            if (src.includes('favicon')) {
                faviconUrl = src;
            } 
            // Otherwise, it's the preview image
            else if (!imageUrl) {
                imageUrl = src;
            }
        });

        // If we found favicon but no preview, look for the other image
        if (faviconUrl && !imageUrl) {
            container.querySelectorAll('img').forEach(img => {
                if (img.src !== faviconUrl && !imageUrl) {
                    imageUrl = img.src;
                }
            });
        }

        // Check hidden div for favicon if not found
        if (!faviconUrl) {
            const hiddenDiv = container.querySelector('div[style*="display:none"]');
            if (hiddenDiv) {
                const hiddenFavicon = hiddenDiv.querySelector('img[src*="favicon"]');
                if (hiddenFavicon) {
                    faviconUrl = hiddenFavicon.src;
                    
                    // If we found favicon in hidden div, the visible image must be preview
                    if (!imageUrl) {
                        const visibleImg = container.querySelector('img:not([src*="favicon"])');
                        if (visibleImg) {
                            imageUrl = visibleImg.src;
                        }
                    }
                }
            }
        }

        // Last resort: if we have exactly two images, one must be preview
        if (!imageUrl) {
            const allImages = container.querySelectorAll('img');
            if (allImages.length === 2) {
                allImages.forEach(img => {
                    if (img.src !== faviconUrl && !imageUrl) {
                        imageUrl = img.src;
                    }
                });
            }
        }
        // ===== END SIMPLIFIED IMAGE DETECTION =====

        const displayDomain = domain.toLowerCase().replace(/www\d?\./g, '');
        const modernEmbeddedLink = document.createElement('div');
        modernEmbeddedLink.className = 'modern-embedded-link';

        let html = '<a href="' + this.#escapeHtml(href) + '" class="embedded-link-container" target="_blank" rel="noopener noreferrer" title="' + this.#escapeHtml(title) + '">';
        
        if (imageUrl) {
            html += '<div class="embedded-link-image">' +
                '<img src="' + this.#escapeHtml(imageUrl) + '" alt="' + this.#escapeHtml(title) + '" loading="lazy" decoding="async">' +
                '</div>';
        }
        
        html += '<div class="embedded-link-content">' +
            '<div class="embedded-link-domain">';
        
        if (faviconUrl) {
            html += '<img src="' + this.#escapeHtml(faviconUrl) + '" alt="" class="embedded-link-favicon" loading="lazy" decoding="async" width="16" height="16">';
        }
        
        html += '<span>' + this.#escapeHtml(displayDomain) + '</span>' +
            '</div>' +
            '<h3 class="embedded-link-title">' + this.#escapeHtml(title) + '</h3>';
        
        if (description) {
            html += '<p class="embedded-link-description">' + this.#escapeHtml(description) + '</p>';
        }
        
        const isItalian = domain.includes('.it') || 
                         (description && (description.toLowerCase().includes('leggi') || 
                                         description.toLowerCase().includes('italia')));
        
        const readMoreText = isItalian ? 
            'Leggi altro su ' + this.#escapeHtml(displayDomain) + ' &gt;' :
            'Read more on ' + this.#escapeHtml(displayDomain) + ' &gt;';
            
        html += '<div class="embedded-link-meta">' +
            '<span class="embedded-link-read-more">' + readMoreText + '</span>' +
            '</div>' +
            '</div></a>';

        modernEmbeddedLink.innerHTML = html;
        
        modernEmbeddedLink.querySelectorAll('img').forEach(img => {
            img.removeAttribute('style');
            
            if (img.classList.contains('embedded-link-favicon')) {
                img.style.cssText = 'width:16px;height:16px;object-fit:contain;display:inline-block;vertical-align:middle;';
            } else {
                img.style.maxWidth = '100%';
                img.style.objectFit = 'cover';
                img.style.display = 'block';
                
                if (img.hasAttribute('width') && parseInt(img.getAttribute('width')) > 800) {
                    img.removeAttribute('width');
                    img.removeAttribute('height');
                }
            }
        });
        
        container.parentNode.replaceChild(modernEmbeddedLink, container);

        const linkElement = modernEmbeddedLink.querySelector('a');
        if (linkElement) {
            linkElement.addEventListener('click', () => {
                console.log('Embedded link clicked to:', href);
            });
        }

    } catch (error) {
        console.error('Error transforming embedded link:', error);
    }
}

    #extractDomain(url) {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return 'unknown.com';
        }
    }

    #setupEmbeddedLinkObserver() {
        if (globalThis.forumObserver) {
            this.#embeddedLinkObserverId = globalThis.forumObserver.register({
                id: 'embedded-link-modernizer',
                callback: (node) => this.#handleNewEmbeddedLinks(node),
                selector: '.ffb_embedlink',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'send', 'search']
            });
        } else {
            setInterval(() => this.#processExistingEmbeddedLinks(), 2000);
        }
    }

#handleNewEmbeddedLinks(node) {
    if (this.#isInEditor(node)) return;
    
    const safeTransform = (link) => {
        if (this.#isInEditor(link) || link.classList.contains('embedded-link-modernized')) return;
        
        // Check if we should wait for images
        const images = link.querySelectorAll('img');
        
        if (images.length === 0) {
            // No images to wait for, transform immediately
            this.#transformEmbeddedLink(link);
            return;
        }
        
        // Check if images are ready (either processed by media script or loaded)
        const areImagesReady = Array.from(images).every(img => {
            return img.hasAttribute('data-optimized') || 
                   img.src.includes('images.weserv.nl') ||
                   img.complete;
        });
        
        if (areImagesReady) {
            this.#transformEmbeddedLink(link);
        } else {
            // Images not ready, wait for them
            console.log('⏳ Waiting for images to be processed in embedded link');
            
            let attempts = 0;
            const maxAttempts = 15; // 1.5 seconds total
            
            const waitForImages = setInterval(() => {
                attempts++;
                
                const currentImages = link.querySelectorAll('img');
                const nowReady = Array.from(currentImages).every(img => {
                    return img.hasAttribute('data-optimized') || 
                           img.src.includes('images.weserv.nl') ||
                           img.complete;
                });
                
                if (nowReady || attempts >= maxAttempts) {
                    clearInterval(waitForImages);
                    if (!link.classList.contains('embedded-link-modernized')) {
                        console.log(nowReady ? '✅ Images ready, transforming' : '⚠️ Timeout, transforming anyway');
                        this.#transformEmbeddedLink(link);
                    }
                }
            }, 100);
        }
    };
    
    // Process the node
    if (node.matches && node.matches('.ffb_embedlink')) {
        safeTransform(node);
    } else if (node.querySelectorAll) {
        node.querySelectorAll('.ffb_embedlink:not(.embedded-link-modernized)').forEach(safeTransform);
    }
}

// ==============================
// SUMMARY POST PREVIEW TRANSFORMATION (for body#send)
// ==============================

#transformSummaryPostPreviews() {
    // Only run on send page
    if (document.body.id !== 'send') return;
    
    const summaryPosts = document.querySelectorAll('.summary ol.list li:not(.post-preview-modernized)');
    
    summaryPosts.forEach((post, index) => {
        if (post.closest('.summary') && !post.classList.contains('post-preview-modernized')) {
            this.#transformSingleSummaryPost(post, index);
        }
    });
}

#transformSingleSummaryPost(postElement, index) {
    try {
        postElement.classList.add('post-preview-modernized');
        
        // Extract the left section (user info/avatar)
        const leftDiv = postElement.querySelector('div.left.Sub.Item');
        // Extract the right section (post content)
        const rightDiv = postElement.querySelector('div.right.Sub');
        
        if (!leftDiv || !rightDiv) return;
        
        // Create modern post structure
        const modernPost = document.createElement('div');
        modernPost.className = 'post post-modernized summary-preview';
        
        // Preserve any data attributes
        Array.from(postElement.attributes).forEach(attr => {
            if (attr.name.startsWith('data-') || attr.name === 'id') {
                modernPost.setAttribute(attr.name, attr.value);
            }
        });
        
        // Post header
        const postHeader = document.createElement('div');
        postHeader.className = 'post-header';
        
        // Add post number
        const postNumber = document.createElement('span');
        postNumber.className = 'post-number';
        
        const hashIcon = document.createElement('i');
        hashIcon.className = 'fa-regular fa-hashtag';
        hashIcon.setAttribute('aria-hidden', 'true');
        
        const numberSpan = document.createElement('span');
        numberSpan.className = 'post-number-value';
        numberSpan.textContent = (index + 1).toString();
        
        postNumber.appendChild(hashIcon);
        postNumber.appendChild(document.createTextNode(' '));
        postNumber.appendChild(numberSpan);
        postHeader.appendChild(postNumber);
        
        // Extract and transform timestamp from right section
        const whenSpan = rightDiv.querySelector('span.when.Item');
        if (whenSpan) {
            const timeText = whenSpan.textContent.replace('Posted', '').replace('on', '').trim();
            
            // Create a dummy element to pass to #createModernTimestamp
            const dummyElement = document.createElement('span');
            dummyElement.textContent = timeText;
            
            const modernTimestamp = this.#createModernTimestamp(dummyElement, timeText);
            if (modernTimestamp) {
                postHeader.appendChild(modernTimestamp);
            } else {
                // Fallback if timestamp creation fails
                const fallbackTime = document.createElement('time');
                fallbackTime.className = 'modern-timestamp';
                fallbackTime.textContent = timeText;
                postHeader.appendChild(fallbackTime);
            }
        }
        
        // User info section
        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';
        
        // ===== FIXED AVATAR HANDLING =====
        // Check if avatar container already exists (from avatar script)
        let avatarContainer = leftDiv.querySelector('.forum-avatar-container');
        
        if (avatarContainer) {
            // Avatar already exists, clone it directly
            userInfo.appendChild(avatarContainer.cloneNode(true));
        } else {
            // No avatar yet, check if there's a default avatar placeholder
            const defaultAvatar = leftDiv.querySelector('.default-avatar');
            
            if (defaultAvatar) {
                // Default avatar exists, clone it and mark for later processing
                const avatarClone = defaultAvatar.cloneNode(true);
                avatarClone.classList.add('avatar-pending'); // Mark as pending
                userInfo.appendChild(avatarClone);
                
                // Queue this element for avatar processing after transformation
                this.#queueForAvatarProcessing(modernPost, leftDiv, rightDiv);
            } else {
                // Create a temporary placeholder
                const tempAvatar = document.createElement('div');
                tempAvatar.className = 'default-avatar avatar-pending';
                tempAvatar.innerHTML = '<img loading="lazy" decoding="async" draggable="false" class="twemoji" alt="👤" src="https://twemoji.maxcdn.com/v/latest/svg/1f464.svg" width="20" height="20">';
                userInfo.appendChild(tempAvatar);
                
                // Queue for avatar processing
                this.#queueForAvatarProcessing(modernPost, leftDiv, rightDiv);
            }
        }
        
        // Process nickname
        const nickLink = leftDiv.querySelector('.nick a');
        if (nickLink) {
            const nickClone = nickLink.cloneNode(true);
            const nickWrapper = document.createElement('strong');
            nickWrapper.className = 'nick';
            nickWrapper.appendChild(nickClone);
            userInfo.appendChild(nickWrapper);
        } else {
            // Try to find nickname in other locations
            const nickSpan = leftDiv.querySelector('.nick');
            if (nickSpan) {
                const nickWrapper = document.createElement('strong');
                nickWrapper.className = 'nick';
                nickWrapper.innerHTML = nickSpan.innerHTML;
                userInfo.appendChild(nickWrapper);
            }
        }
        
        // Post content section
        const postContent = document.createElement('div');
        postContent.className = 'post-content';
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'post-main-content';
        
        // Move content from right section
        const contentDiv = rightDiv.querySelector('.color.Item, .bottom .color.Item');
        if (contentDiv) {
            // Clone and clean content
            const contentClone = contentDiv.cloneNode(true);
            
            // Remove timestamp from content if it was cloned
            const clonedWhen = contentClone.querySelector('.when.Item');
            if (clonedWhen) clonedWhen.remove();
            
            // Remove any empty divs or line breaks
            this.#cleanEmptyElements(contentClone);
            
            // Process media in content
            this.#preserveMediaDimensions(contentClone);
            
            // Transform any quotes, spoilers, code blocks, attachments, embedded links
            this.#modernizeQuotesInContent(contentClone);
            this.#modernizeSpoilersInContent(contentClone);
            this.#modernizeCodeBlocksInContent(contentClone);
            this.#modernizeAttachmentsInContent(contentClone);
            this.#modernizeEmbeddedLinksInContent(contentClone);
            
            // Process text nodes and line breaks
            this.#processTextAndLineBreaks(contentClone);
            
            contentWrapper.appendChild(contentClone);
        }
        
        postContent.appendChild(contentWrapper);
        
        // Assemble the modern post (no footer for summary previews)
        modernPost.appendChild(postHeader);
        modernPost.appendChild(userInfo);
        modernPost.appendChild(postContent);
        
        // Replace original element
        postElement.parentNode.replaceChild(modernPost, postElement);
        
    } catch (error) {
        console.error('Error transforming summary post preview:', error);
    }
}

// Add this new helper method to queue for avatar processing
#queueForAvatarProcessing(modernPost, originalLeftDiv, originalRightDiv) {
    // Try to find the user ID
    let userId = null;
    
    // Check class for box_m pattern
    const classMatch = originalLeftDiv.className.match(/\bbox_m(\d+)\b/);
    if (classMatch) {
        userId = classMatch[1];
    }
    
    if (!userId) {
        // Check parent
        const parentBox = originalLeftDiv.closest('[class*="box_m"]');
        if (parentBox) {
            const parentMatch = parentBox.className.match(/\bbox_m(\d+)\b/);
            if (parentMatch) userId = parentMatch[1];
        }
    }
    
    if (!userId) {
        // Check for MID in links
        const midLink = originalLeftDiv.querySelector('a[href*="MID="]');
        if (midLink) {
            const hrefMatch = midLink.href.match(/MID=(\d+)/);
            if (hrefMatch) userId = hrefMatch[1];
        }
    }
    
    // Get username
    let username = '';
    const nickLink = originalLeftDiv.querySelector('.nick a');
    if (nickLink) {
        username = nickLink.textContent.trim();
    }
    
    if (userId && window.ForumAvatars && typeof window.ForumAvatars.refresh === 'function') {
        // If avatar system exists, trigger a refresh for this specific user
        setTimeout(() => {
            // Try to find the avatar container in the modernized post
            const avatarContainer = modernPost.querySelector('.avatar-pending, .default-avatar');
            if (avatarContainer && avatarContainer.closest('.user-info')) {
                // Remove the pending avatar
                avatarContainer.remove();
                
                // Re-run avatar processing
                if (window.ForumAvatars && window.ForumAvatars.refresh) {
                    window.ForumAvatars.refresh();
                }
            }
        }, 500); // Wait half a second for avatar script to run
    }
}

#modernizeQuotesInContent(element) {
    if (this.#isInEditor(element)) return;
    element.querySelectorAll('div[align="center"]:has(.quote_top):not(.quote-modernized)').forEach(container => {
        this.#transformQuote(container);
        container.classList.add('quote-modernized');
    });
}

#modernizeSpoilersInContent(element) {
    if (this.#isInEditor(element)) return;
    element.querySelectorAll('div[align="center"].spoiler:not(.spoiler-modernized)').forEach(container => {
        this.#transformSpoiler(container);
        container.classList.add('spoiler-modernized');
    });
}

#setupSummaryPostObserver() {
    if (globalThis.forumObserver) {
        this.#summaryObserverId = globalThis.forumObserver.register({
            id: 'summary-post-preview-modernizer',
            callback: (node) => this.#handleNewSummaryPosts(node),
            selector: '.summary ol.list li',
            priority: 'normal',
            pageTypes: ['send'] // Only on send page
        });
    } else {
        // Fallback polling
        setInterval(() => this.#transformSummaryPostPreviews(), 2000);
    }
}

#handleNewSummaryPosts(node) {
    if (document.body.id !== 'send') return;
    
    if (node.matches && node.matches('.summary ol.list li')) {
        // Calculate index based on position
        const allPosts = document.querySelectorAll('.summary ol.list li');
        const index = Array.from(allPosts).indexOf(node);
        this.#transformSingleSummaryPost(node, index);
    } else if (node.querySelectorAll) {
        const posts = node.querySelectorAll('.summary ol.list li:not(.post-preview-modernized)');
        posts.forEach((post, idx) => {
            // Calculate global index
            const allPosts = document.querySelectorAll('.summary ol.list li');
            const globalIndex = Array.from(allPosts).indexOf(post);
            this.#transformSingleSummaryPost(post, globalIndex);
        });
    }
}
    
    // ==============================
    // MODERN POLL SYSTEM
    // ==============================

    #modernizePolls() {
        this.#processExistingPolls();
        this.#setupPollObserver();
    }

    #processExistingPolls() {
        document.querySelectorAll('form#pollform .poll:not(.poll-modernized)').forEach(pollContainer => {
            this.#transformPoll(pollContainer);
        });
    }

#transformPoll(pollContainer) {
    const pollForm = pollContainer.closest('form#pollform');
    if (!pollForm || pollContainer.classList.contains('poll-modernized')) return;
    
    try {
        // STORE THE POPUP BEFORE HIDING ANYTHING
        const popupElement = pollContainer.querySelector('.popup.pop_points#overlay');
        
        const sunbar = pollContainer.querySelector('.sunbar.top.Item');
        const pollTitle = sunbar ? sunbar.textContent.trim() : 'Poll';
        const list = pollContainer.querySelector('ul.list');
        if (!list) return;

        const originalCancelBtn = pollContainer.querySelector('input[name="delvote"]');
        const originalVoteBtn = pollContainer.querySelector('input[name="submit"]');
        const originalViewResultsBtn = pollContainer.querySelector('button[name="nullvote"]');
        
        const isVotedState = originalCancelBtn !== null;
        const isResultsState = !isVotedState && pollContainer.querySelector('.bar') !== null;
        const isVoteState = !isVotedState && !isResultsState;
        
        const originalPollContent = pollContainer.querySelector('.skin_tbl');
        if (!originalPollContent) return;
        
        // Hide original content BUT DETACH THE POPUP FIRST
        if (popupElement) {
            // Move popup outside the poll container before hiding
            document.body.appendChild(popupElement);
            
            // Ensure popup has proper styling
            popupElement.style.cssText = 'display: none; position: absolute; z-index: 9999;';
            
            // Re-initialize the overlay if jQuery is available
            if (typeof $ !== 'undefined' && $.fn.overlay) {
                // Small delay to ensure DOM is ready
                setTimeout(() => {
                    $("a[rel=#overlay]").overlay({
                        top: $(window).height() / 2 - 100,
                        left: $(window).width() / 2 - 150,
                        onBeforeLoad: function() {
                            var wrap = this.getOverlay().find("div");
                            wrap.html('<p><img src="https://img.forumfree.net/index_file/loads3.gif" alt=""></p>')
                                .load(this.getTrigger().attr("href") + "&popup=1");
                        }
                    });
                }, 100);
            }
        }
        
        // Now hide the original content (popup is safely outside)
        originalPollContent.style.cssText = 'opacity:0;height:0;overflow:hidden;position:absolute;pointer-events:none';
        
        const modernPoll = document.createElement('div');
        modernPoll.className = 'modern-poll';
        modernPoll.setAttribute('data-poll-state', isVotedState ? 'voted' : isResultsState ? 'results' : 'vote');
        
        let html = '<div class="poll-header">' +
            '<div class="poll-icon">' +
            '<i class="fa-regular fa-chart-bar" aria-hidden="true"></i>' +
            '</div>' +
            '<h3 class="poll-title">' + this.#escapeHtml(pollTitle) + '</h3>' +
            '<div class="poll-stats">';
        
        if (isVotedState || isResultsState) {
            const votersText = pollContainer.querySelector('.darkbar.Item');
            if (votersText) {
                const votersMatch = votersText.textContent.match(/Voters:\s*(\d+)/);
                if (votersMatch) {
                    html += '<i class="fa-regular fa-users" aria-hidden="true"></i>' +
                        '<span>' + votersMatch[1] + ' voter' + (parseInt(votersMatch[1]) !== 1 ? 's' : '') + '</span>';
                }
            }
        }
        
        html += '</div></div><div class="poll-choices">';
        
        if (isVoteState) {
            const choiceItems = list.querySelectorAll('li.Item[style*="text-align:left"]');
            choiceItems.forEach((item, index) => {
                const label = item.querySelector('label');
                const radio = item.querySelector('input[type="radio"]');
                if (!label || !radio) return;
                
                const choiceText = label.textContent.replace(/&nbsp;/g, ' ').trim();
                const choiceId = radio.id;
                const choiceValue = radio.value;
                const choiceName = radio.name;
                
                html += '<div class="poll-choice" data-choice-index="' + index + '">' +
                    '<input type="radio" class="choice-radio" id="modern_' + this.#escapeHtml(choiceId) + 
                    '" name="' + this.#escapeHtml(choiceName) + '" value="' + this.#escapeHtml(choiceValue) + '" onclick="event.stopPropagation()">' +
                    '<label for="modern_' + this.#escapeHtml(choiceId) + '" class="choice-label">' + 
                    this.#escapeHtml(choiceText) + '</label>' +
                    '</div>';
            });
        } else {
            const choiceItems = list.querySelectorAll('li:not(:first-child)');
            let maxVotes = 0;
            const choicesData = [];
            
            choiceItems.forEach(item => {
                const isMax = item.classList.contains('max');
                const leftDiv = item.querySelector('.left.Sub.Item');
                const centerDiv = item.querySelector('.center.Sub.Item');
                const rightDiv = item.querySelector('.right.Sub.Item');
                
                if (!leftDiv || !centerDiv || !rightDiv) return;
                
                const choiceText = leftDiv.textContent.replace(/\s+/g, ' ').trim();
                const choiceTextClean = choiceText.replace(/^\*+/, '').replace(/\*+$/, '').trim();
                
                const barDiv = centerDiv.querySelector('.bar div');
                const percentageSpan = centerDiv.querySelector('.bar span');
                const votesDiv = rightDiv;
                
                let percentage = 0;
                let votes = 0;
                
                if (barDiv) {
                    const widthMatch = barDiv.style.width.match(/(\d+(?:\.\d+)?)%/);
                    if (widthMatch) percentage = parseFloat(widthMatch[1]);
                }
                
                if (percentageSpan) {
                    const percentageMatch = percentageSpan.textContent.match(/(\d+(?:\.\d+)?)%/);
                    if (percentageMatch) percentage = parseFloat(percentageMatch[1]);
                }
                
                if (votesDiv) {
                    const votesText = votesDiv.textContent.replace(/[^\d.]/g, '');
                    if (votesText) votes = parseInt(votesText);
                }
                
                if (votes > maxVotes) maxVotes = votes;
                
                choicesData.push({
                    text: choiceTextClean,
                    originalText: choiceText,
                    percentage: percentage,
                    votes: votes,
                    isMax: isMax,
                    isVoted: isMax && leftDiv.querySelector('strong') !== null
                });
            });
            
            choicesData.forEach((choice, index) => {
                const isVotedChoice = isVotedState && choice.isVoted;
                
                html += '<div class="poll-choice' + (choice.isMax ? ' max' : '') + 
                    (isVotedChoice ? ' selected' : '') + '" data-choice-index="' + index + '">';
                
                if (isVotedState && isVotedChoice) {
                    html += '<input type="radio" class="choice-radio" checked disabled>';
                }
                
                html += '<span class="choice-label">' + this.#escapeHtml(choice.text);
                if (isVotedChoice) {
                    html += ' <strong>(Your vote)</strong>';
                }
                html += '</span>';
                
                html += '<div class="choice-stats">' +
                    '<div class="choice-bar">' +
                    '<div class="choice-fill" style="width: ' + choice.percentage.toFixed(2) + '%"></div>' +
                    '</div>' +
                    '<span class="choice-percentage">' + choice.percentage.toFixed(2) + '%</span>' +
                    '<span class="choice-votes">' + choice.votes + ' vote' + (choice.votes !== 1 ? 's' : '') + '</span>' +
                    '</div>';
                
                html += '</div>';
            });
        }
        
        html += '</div><div class="poll-footer">';
        
        if (isVoteState) {
            html += '<p class="poll-message">Select your choice and click Vote</p>' +
                '<div class="poll-actions">' +
                '<button type="button" class="poll-btn vote-btn">' +
                '<i class="fa-regular fa-check" aria-hidden="true"></i>' +
                'Vote' +
                '</button>' +
                '<button type="button" class="poll-btn secondary view-results-btn">' +
                '<i class="fa-regular fa-chart-bar" aria-hidden="true"></i>' +
                'View Results' +
                '</button>' +
                '</div>';
        } else if (isVotedState) {
            const darkbar = pollContainer.querySelector('.darkbar.Item');
            let votedForText = '';
            
            if (darkbar) {
                const abbr = darkbar.querySelector('abbr');
                if (abbr) {
                    const choiceNumber = abbr.textContent.trim();
                    const choiceTitle = abbr.getAttribute('title') || '';
                    votedForText = 'You voted for option <strong>' + choiceNumber + '</strong>';
                    if (choiceTitle) {
                        votedForText += ': <span class="poll-choice-name">' + this.#escapeHtml(choiceTitle) + '</span>';
                    }
                }
            }
            
            html += '<p class="poll-message">' + votedForText + '</p>' +
                '<div class="poll-actions">' +
                '<button type="button" class="poll-btn delete cancel-vote-btn">' +
                '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
                'Cancel Vote' +
                '</button>' +
                '</div>';
        } else if (isResultsState) {
            const darkbar = pollContainer.querySelector('.darkbar.Item');
            let votersText = '';
            
            if (darkbar) {
                const votersMatch = darkbar.textContent.match(/Voters:\s*(\d+)/);
                if (votersMatch) {
                    votersText = votersMatch[1] + ' voter' + (parseInt(votersMatch[1]) !== 1 ? 's' : '');
                }
            }
            
            html += '<p class="poll-message">Poll results' + (votersText ? ' • ' + votersText : '') + '</p>' +
                '<div class="poll-actions">' +
                '<button type="button" class="poll-btn secondary" onclick="location.reload()">' +
                '<i class="fa-regular fa-rotate" aria-hidden="true"></i>' +
                'Refresh' +
                '</button>' +
                '</div>';
        }
        
        html += '</div>';
        
        modernPoll.innerHTML = html;
        pollContainer.insertBefore(modernPoll, originalPollContent);
        pollContainer.classList.add('poll-modernized');
        
        this.#setupPollEventListeners(modernPoll, pollForm, originalPollContent, {
            isVoteState: isVoteState,
            isVotedState: isVotedState,
            originalCancelBtn: originalCancelBtn,
            originalVoteBtn: originalVoteBtn,
            originalViewResultsBtn: originalViewResultsBtn
        });
        
        if (isVotedState || isResultsState) {
            setTimeout(() => {
                modernPoll.querySelectorAll('.choice-fill').forEach(fill => {
                    const width = fill.style.width;
                    fill.style.width = '0';
                    setTimeout(() => {
                        fill.style.width = width;
                    }, 10);
                });
            }, 100);
        }
        
    } catch (error) {
        console.error('Error transforming poll:', error);
    }
}
    
    #setupPollEventListeners(modernPoll, pollForm, originalPollContent, options) {
        const { isVoteState, isVotedState, originalCancelBtn, originalVoteBtn, originalViewResultsBtn } = options;
        
        if (isVoteState) {
            const voteBtn = modernPoll.querySelector('.vote-btn');
            const viewResultsBtn = modernPoll.querySelector('.view-results-btn');
            const originalRadios = originalPollContent.querySelectorAll('input[type="radio"]');
            const pollChoices = modernPoll.querySelectorAll('.poll-choice');
            const radiosMap = new Map();
            
            pollChoices.forEach((choice, index) => {
                const originalRadio = originalRadios[index];
                if (!originalRadio) return;
                
                const modernRadio = choice.querySelector('.choice-radio');
                if (!modernRadio) return;
                
                radiosMap.set(modernRadio, originalRadio);
                
                if (originalRadio.checked) {
                    choice.classList.add('selected');
                    modernRadio.checked = true;
                }
                
                modernRadio.addEventListener('change', (e) => {
                    if (modernRadio.checked) {
                        pollChoices.forEach((c, idx) => {
                            if (idx !== index) {
                                const otherRadio = c.querySelector('.choice-radio');
                                if (otherRadio) otherRadio.checked = false;
                            }
                        });
                        
                        originalRadios.forEach((r, idx) => {
                            r.checked = (idx === index);
                        });
                        
                        pollChoices.forEach(c => c.classList.remove('selected'));
                        choice.classList.add('selected');
                        
                        originalRadio.dispatchEvent(new Event('change', { bubbles: true }));
                        originalRadio.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                });
                
                choice.addEventListener('click', (e) => {
                    if (e.target.closest('.choice-radio')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    modernRadio.checked = true;
                    modernRadio.dispatchEvent(new Event('change', { bubbles: true }));
                });
                
                const label = choice.querySelector('.choice-label');
                if (label) {
                    label.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        modernRadio.checked = true;
                        modernRadio.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                }
                
                originalRadio.addEventListener('change', (e) => {
                    if (originalRadio.checked) {
                        modernRadio.checked = true;
                        pollChoices.forEach(c => c.classList.remove('selected'));
                        choice.classList.add('selected');
                    }
                });
            });
            
            if (voteBtn && originalVoteBtn) {
                voteBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const isAnySelected = Array.from(pollChoices).some(choice => {
                        const modernRadio = choice.querySelector('.choice-radio');
                        return modernRadio && modernRadio.checked;
                    });
                    
                    if (!isAnySelected) {
                        this.#showPollNotification('Please select a choice before voting', 'warning');
                        return;
                    }
                    
                    const isAnyOriginalSelected = Array.from(originalRadios).some(r => r.checked);
                    if (!isAnyOriginalSelected) {
                        pollChoices.forEach((choice, index) => {
                            const modernRadio = choice.querySelector('.choice-radio');
                            const originalRadio = originalRadios[index];
                            if (modernRadio && modernRadio.checked && originalRadio) {
                                originalRadio.checked = true;
                            }
                        });
                    }
                    
                    setTimeout(() => {
                        originalVoteBtn.click();
                    }, 50);
                });
            }
            
            if (viewResultsBtn && originalViewResultsBtn) {
                viewResultsBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTimeout(() => {
                        originalViewResultsBtn.click();
                    }, 50);
                });
            }
        }
        
        if (isVotedState) {
            const cancelBtn = modernPoll.querySelector('.cancel-vote-btn');
            if (cancelBtn && originalCancelBtn) {
                cancelBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTimeout(() => {
                        originalCancelBtn.click();
                    }, 50);
                });
            }
        }
    }

    #showPollNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = 'poll-notification ' + type;
        notification.textContent = message;
        
        notification.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;background:' + 
            (type === 'warning' ? 'var(--warning-color)' : 'var(--primary-color)') + 
            ';color:white;border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:9999;' +
            'font-weight:500;display:flex;align-items:center;gap:8px;transform:translateX(calc(100% + 20px));' +
            'opacity:0;transition:transform 0.3s ease-out,opacity 0.3s ease-out;pointer-events:none;';
        
        const icon = document.createElement('i');
        icon.className = type === 'warning' ? 'fa-regular fa-exclamation-triangle' : 'fa-regular fa-info-circle';
        icon.setAttribute('aria-hidden', 'true');
        notification.prepend(icon);
        
        document.body.appendChild(notification);
        
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';
        });
        
        setTimeout(() => {
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';
            
            notification.addEventListener('transitionend', () => {
                notification.remove();
            }, { once: true });
        }, 3000);
    }
    
    #setupPollObserver() {
        if (globalThis.forumObserver) {
            const pollObserverId = globalThis.forumObserver.register({
                id: 'poll-modernizer',
                callback: (node) => this.#handleNewPolls(node),
                selector: 'form#pollform .poll:not(.poll-modernized)',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'send']
            });
        } else {
            setInterval(() => {
                document.querySelectorAll('form#pollform .poll:not(.poll-modernized)').forEach(poll => {
                    this.#transformPoll(poll);
                });
            }, 2000);
        }
    }

    #handleNewPolls(node) {
        if (node.matches('form#pollform .poll:not(.poll-modernized)')) {
            this.#transformPoll(node);
        } else {
            node.querySelectorAll('form#pollform .poll:not(.poll-modernized)').forEach(poll => {
                this.#transformPoll(poll);
            });
        }
    }
    
    // ==============================
    // ADAPTIVE DATE PARSING SYSTEM
    // ==============================

    #analyzeDateComponents(dateString) {
        const components = {
            hasAMPM: /[AP]M/i.test(dateString),
            has24Hour: /\d{1,2}:\d{2}(?::\d{2})?(?!\s*[AP]M)/i.test(dateString),
            separator: null,
            parts: []
        };
        
        const dateMatch = dateString.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
        if (dateMatch) {
            components.parts = [parseInt(dateMatch[1]), parseInt(dateMatch[2]), parseInt(dateMatch[3])];
            
            const separatorMatch = dateString.match(/\d{1,2}([\/\-\.])\d{1,2}/);
            components.separator = separatorMatch ? separatorMatch[1] : '/';
            
            const [first, second] = components.parts;
            
            if (first > 12 && second <= 12) {
                components.likelyFormat = 'EU';
                components.confidence = 'high';
                components.reason = 'First number > 12, second ≤ 12';
            } else if (first <= 12 && second > 12) {
                components.likelyFormat = 'US';
                components.confidence = 'high';
                components.reason = 'First number ≤ 12, second > 12';
            } else if (first <= 12 && second <= 12) {
                components.likelyFormat = 'ambiguous';
                components.confidence = 'low';
                components.reason = 'Both numbers ≤ 12, ambiguous';
                
                if (components.has24Hour && !components.hasAMPM) {
                    components.likelyFormat = 'EU';
                    components.confidence = 'medium';
                    components.reason = '24-hour format suggests European';
                }
            } else if (first > 12 && second > 12) {
                components.likelyFormat = 'unknown';
                components.confidence = 'low';
                components.reason = 'Both numbers > 12, invalid';
            } else {
                components.likelyFormat = 'unknown';
                components.confidence = 'low';
                components.reason = 'Unknown pattern';
            }
        }
        
        return components;
    }
    
    #learnFormat(components, successfulFormat) {
        const patternKey = components.separator + '|' + (components.hasAMPM ? '12h' : '24h') + '|' + successfulFormat;
        this.#formatPatterns.set(patternKey, (this.#formatPatterns.get(patternKey) || 0) + 1);
        
        if (successfulFormat === 'EU') {
            this.#formatConfidence.EU++;
        } else if (successfulFormat === 'US') {
            this.#formatConfidence.US++;
        }
        
        if (components.separator) {
            const separatorCount = this.#formatPatterns.get('separator|' + components.separator) || 0;
            this.#formatPatterns.set('separator|' + components.separator, separatorCount + 1);
            
            if (separatorCount > 2) {
                this.#detectedSeparator = components.separator;
            }
        }
        
        const timeFormatKey = components.hasAMPM ? '12h' : '24h';
        const timeFormatCount = this.#formatPatterns.get('timeformat|' + timeFormatKey) || 0;
        this.#formatPatterns.set('timeformat|' + timeFormatKey, timeFormatCount + 1);
        
        if (timeFormatCount > 2) {
            this.#detectedTimeFormat = timeFormatKey;
        }
    }
    
    #getBestFormatForComponents(components) {
        const patternKey = components.separator + '|' + (components.hasAMPM ? '12h' : '24h') + '|';
        
        let bestFormat = null;
        let bestCount = 0;
        
        for (const [key, count] of this.#formatPatterns.entries()) {
            if (key.startsWith(patternKey) && count > bestCount) {
                bestFormat = key.split('|')[2];
                bestCount = count;
            }
        }
        
        if (this.#formatConfidence.EU > 10 && this.#formatConfidence.EU > this.#formatConfidence.US * 2) {
            bestFormat = 'EU';
        } else if (this.#formatConfidence.US > 10 && this.#formatConfidence.US > this.#formatConfidence.EU * 2) {
            bestFormat = 'US';
        }
        
        if (!bestFormat && components.likelyFormat === 'EU') {
            bestFormat = 'EU';
        } else if (!bestFormat && components.likelyFormat === 'US') {
            bestFormat = 'US';
        }
        
        return bestFormat;
    }

    #buildFormatArray(preference, components) {
        const formats = [];
        const separator = components.separator || '/';
        const timeFormat = components.hasAMPM ? 'h:mm A' : 'HH:mm';
        const timeFormatWithSeconds = components.hasAMPM ? 'h:mm:ss A' : 'HH:mm:ss';
        
        const createFormat = (dateFormat, timeFormat) => {
            return dateFormat.replace(/\//g, separator) + ', ' + timeFormat;
        };
        
        const addFormatsWithSingleDigitSupport = (dateFormat, timeFormat) => {
            formats.push(createFormat(dateFormat, timeFormat));
            
            if (dateFormat === 'DD/MM/YYYY') {
                formats.push(createFormat('D/M/YYYY', timeFormat));
                formats.push(createFormat('D/MM/YYYY', timeFormat));
                formats.push(createFormat('DD/M/YYYY', timeFormat));
                if (!components.hasAMPM) {
                    formats.push(createFormat('DD/MM/YYYY', 'H:mm'));
                    formats.push(createFormat('D/M/YYYY', 'H:mm'));
                }
            } else if (dateFormat === 'MM/DD/YYYY') {
                formats.push(createFormat('M/D/YYYY', timeFormat));
                formats.push(createFormat('M/DD/YYYY', timeFormat));
                formats.push(createFormat('MM/D/YYYY', timeFormat));
                if (!components.hasAMPM) {
                    formats.push(createFormat('MM/DD/YYYY', 'H:mm'));
                    formats.push(createFormat('M/D/YYYY', 'H:mm'));
                }
            }
        };
        
        if (preference === 'EU') {
            addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormat);
            addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormatWithSeconds);
            formats.push(createFormat('DD/MM/YYYY', 'HH:mm'));
            formats.push(createFormat('DD/MM/YYYY', 'HH:mm:ss'));
            
            addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormat);
            addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormatWithSeconds);
        } else if (preference === 'US') {
            addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormat);
            addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormatWithSeconds);
            formats.push(createFormat('MM/DD/YYYY', 'HH:mm'));
            formats.push(createFormat('MM/DD/YYYY', 'HH:mm:ss'));
            
            addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormat);
            addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormatWithSeconds);
        } else {
            if (components.likelyFormat === 'EU') {
                addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormat);
                addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormatWithSeconds);
            } else if (components.likelyFormat === 'US') {
                addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormat);
                addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormatWithSeconds);
            } else {
                addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormat);
                addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormat);
                addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormatWithSeconds);
                addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormatWithSeconds);
            }
        }
        
        const additionalFormats = [
            'YYYY-MM-DD HH:mm:ss',
            'YYYY-MM-DDTHH:mm:ss',
            'dddd, MMMM D, YYYY h:mm A',
            'D/M/YYYY HH:mm',
            'M/D/YYYY HH:mm',
            'D/M/YYYY, H:mm',
            'M/D/YYYY, H:mm',
            'D/M/YYYY H:mm',
            'M/D/YYYY H:mm'
        ];
        
        return formats.concat(additionalFormats);
    }

    #parseForumDate(dateString) {
        if (!dateString || typeof dateString !== 'string') {
            return null;
        }

        const cacheKey = dateString.trim();
        if (this.#dateFormatCache.has(cacheKey)) {
            return this.#dateFormatCache.get(cacheKey);
        }

        let cleanDateString = cacheKey
            .replace(/^Posted on\s*/i, '')
            .replace(/^on\s*/i, '')
            .replace(/^Posted\s*/i, '')
            .trim();

        const components = this.#analyzeDateComponents(cleanDateString);
        
        if (components.parts.length >= 2) {
            const [first, second] = components.parts;
            if (first > 12 && second <= 12) {
                const formats = this.#buildFormatArray('EU', components);
                
                const aggressiveFormats = [
                    'D/M/YYYY, H:mm',
                    'D/M/YYYY, HH:mm',
                    'D/M/YYYY H:mm',
                    'D/M/YYYY HH:mm',
                    'DD/M/YYYY, H:mm',
                    'DD/M/YYYY, HH:mm',
                    'D/MM/YYYY, H:mm',
                    'D/MM/YYYY, HH:mm'
                ];
                
                const allFormats = aggressiveFormats.concat(formats);
                
                let momentDate = null;
                let successfulFormat = null;
                
                for (let i = 0; i < allFormats.length; i++) {
                    momentDate = moment(cleanDateString, allFormats[i], true);
                    if (momentDate && momentDate.isValid()) {
                        const month = momentDate.month() + 1;
                        if (month >= 1 && month <= 12) {
                            successfulFormat = 'EU';
                            break;
                        } else {
                            momentDate = null;
                        }
                    }
                }
                
                if (momentDate && momentDate.isValid()) {
                    const utcTime = momentDate.utc();
                    
                    if (successfulFormat) {
                        this.#learnFormat(components, successfulFormat);
                    }
                    
                    this.#dateFormatCache.set(cacheKey, utcTime);
                    return utcTime;
                }
            }
        }
        
        const bestFormat = this.#getBestFormatForComponents(components);
        let formats = [];
        
        if (bestFormat === 'EU') {
            formats = this.#buildFormatArray('EU', components);
        } else if (bestFormat === 'US') {
            formats = this.#buildFormatArray('US', components);
        } else {
            formats = this.#buildFormatArray('AUTO', components);
        }
        
        let momentDate = null;
        let successfulFormat = null;
        
        for (let i = 0; i < formats.length; i++) {
            momentDate = moment(cleanDateString, formats[i], true);
            if (momentDate && momentDate.isValid()) {
                const month = momentDate.month() + 1;
                if (month >= 1 && month <= 12) {
                    successfulFormat = formats[i].includes('DD/MM') || formats[i].includes('D/M') ? 'EU' : 
                                      formats[i].includes('MM/DD') || formats[i].includes('M/D') ? 'US' : 'UNKNOWN';
                    break;
                } else {
                    momentDate = null;
                }
            }
        }
        
        if ((!momentDate || !momentDate.isValid()) && cleanDateString.includes('(')) {
            try {
                const timezoneMatch = cleanDateString.match(/\(([A-Z]{2,})\)$/);
                if (timezoneMatch) {
                    const tzAbbr = timezoneMatch[1];
                    const dateWithoutTz = cleanDateString.replace(/\s*\([A-Z]{2,}\)$/, '');
                    
                    for (let i = 0; i < formats.length; i++) {
                        const parsed = moment(dateWithoutTz, formats[i], true);
                        if (parsed && parsed.isValid()) {
                            const month = parsed.month() + 1;
                            if (month >= 1 && month <= 12) {
                                const possibleZones = this.#getTimezoneFromAbbr(tzAbbr);
                                if (possibleZones.length > 0) {
                                    momentDate = parsed.tz(possibleZones[0]);
                                } else {
                                    momentDate = parsed;
                                }
                                successfulFormat = formats[i].includes('DD/MM') || formats[i].includes('D/M') ? 'EU' : 
                                                 formats[i].includes('MM/DD') || formats[i].includes('M/D') ? 'US' : 'UNKNOWN';
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                // Timezone parsing failed silently
            }
        }
        
        if (!momentDate || !momentDate.isValid()) {
            const jsDate = new Date(cleanDateString);
            if (!isNaN(jsDate)) {
                momentDate = moment(jsDate);
                
                const month = momentDate.month() + 1;
                const day = momentDate.date();
                
                if (components.parts.length >= 2) {
                    const [first, second] = components.parts;
                    if (first === month && second === day) {
                        successfulFormat = 'US';
                    } else if (first === day && second === month) {
                        successfulFormat = 'EU';
                    }
                }
            }
        }
        
        if (!momentDate || !momentDate.isValid()) {
            const manualMatch = cleanDateString.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4}),?\s+(\d{1,2}):(\d{2})/);
            if (manualMatch) {
                const [_, dayOrMonth, monthOrDay, year, hour, minute] = manualMatch.map(Number);
                
                if (dayOrMonth > 12 && monthOrDay <= 12) {
                    const dateStr = year + '-' + String(monthOrDay).padStart(2, '0') + '-' + String(dayOrMonth).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00';
                    momentDate = moment(dateStr);
                    successfulFormat = 'EU';
                } else if (dayOrMonth <= 12 && monthOrDay > 12) {
                    const dateStr = year + '-' + String(dayOrMonth).padStart(2, '0') + '-' + String(monthOrDay).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00';
                    momentDate = moment(dateStr);
                    successfulFormat = 'US';
                }
            }
        }
        
        if (momentDate && momentDate.isValid()) {
            const utcTime = momentDate.utc();
            
            if (successfulFormat) {
                this.#learnFormat(components, successfulFormat);
            }
            
            this.#dateFormatCache.set(cacheKey, utcTime);
            return utcTime;
        }
        
        console.warn('Could not parse date:', dateString, '->', cleanDateString);
        this.#dateFormatCache.set(cacheKey, null);
        return null;
    }
    
    #detectForumTimezone() {
        return null;
    }

    #getTimezoneFromAbbr(abbr) {
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

    #shouldSkipFutureTimestamp(element) {
        const postElement = element.closest('.post');
        return postElement && postElement.classList.contains('post_queue');
    }

    #formatTimeAgo(date) {
        if (!date || !date.isValid()) {
            return 'Unknown time';
        }

        const now = moment();
        const userDate = moment(date).local();
        const diffInSeconds = now.diff(userDate, 'seconds');
        
        if (diffInSeconds < 0) {
            const futureDiffInSeconds = Math.abs(diffInSeconds);
            const futureDiffInMinutes = Math.abs(now.diff(userDate, 'minutes'));
            const futureDiffInHours = Math.abs(now.diff(userDate, 'hours'));
            const futureDiffInDays = Math.abs(now.diff(userDate, 'days'));
            
            if (futureDiffInSeconds < 60) {
                return 'in ' + futureDiffInSeconds + ' seconds';
            } else if (futureDiffInMinutes < 60) {
                return 'in ' + futureDiffInMinutes + ' minute' + (futureDiffInMinutes > 1 ? 's' : '');
            } else if (futureDiffInHours < 24) {
                return 'in ' + futureDiffInHours + ' hour' + (futureDiffInHours > 1 ? 's' : '');
            } else if (futureDiffInDays < 7) {
                return 'in ' + futureDiffInDays + ' day' + (futureDiffInDays > 1 ? 's' : '');
            } else if (futureDiffInDays < 30) {
                const weeks = Math.floor(futureDiffInDays / 7);
                return 'in ' + weeks + ' week' + (weeks > 1 ? 's' : '');
            } else if (futureDiffInDays < 365) {
                const months = Math.floor(futureDiffInDays / 30);
                return 'in ' + months + ' month' + (months > 1 ? 's' : '');
            } else {
                const years = Math.floor(futureDiffInDays / 365);
                return 'in ' + years + ' year' + (years > 1 ? 's' : '');
            }
        }
        
        const diffInMinutes = now.diff(userDate, 'minutes');
        const diffInHours = now.diff(userDate, 'hours');
        const diffInDays = now.diff(userDate, 'days');
        
        if (diffInSeconds < 45) {
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

    #createModernTimestamp(originalElement, dateString) {
        if (typeof moment === 'undefined' || typeof moment.tz === 'undefined') {
            console.warn('Moment.js libraries not loaded, skipping timestamp transformation');
            return originalElement;
        }
        
        if (originalElement.classList && originalElement.classList.contains('modern-timestamp')) {
            return originalElement;
        }
        
        if (originalElement.querySelector && originalElement.querySelector('.modern-timestamp')) {
            return originalElement;
        }
        
        if (originalElement.closest && originalElement.closest('.modern-timestamp')) {
            return originalElement;
        }
        
        const isPostQueue = this.#shouldSkipFutureTimestamp(originalElement);
        const momentDate = this.#parseForumDate(dateString);
        
        if (!momentDate) {
            console.warn('Could not parse date:', dateString);
            return originalElement;
        }
        
        const userSettings = this.#getUserLocaleSettings();
        const link = document.createElement('a');
        let href = null;
        
        if (originalElement.tagName === 'A' && originalElement.hasAttribute('href')) {
            href = originalElement.getAttribute('href');
        } else if (originalElement.parentElement && originalElement.parentElement.tagName === 'A' && 
                 originalElement.parentElement.hasAttribute('href')) {
            href = originalElement.parentElement.getAttribute('href');
        } else {
            const postElement = originalElement.closest('.post');
            if (postElement && postElement.id) {
                const postIdMatch = postElement.id.match(/\d+/);
                if (postIdMatch) {
                    const postId = postIdMatch[0];
                    const topicMatch = window.location.href.match(/t=(\d+)/);
                    if (topicMatch) {
                        href = '#entry' + postId;
                    } else {
                        href = '#entry' + postId;
                    }
                }
            }
        }
        
        if (href) {
            link.href = href;
            
            if (originalElement.hasAttribute('rel')) {
                link.setAttribute('rel', originalElement.getAttribute('rel'));
            } else if (originalElement.parentElement && originalElement.parentElement.tagName === 'A' && 
                      originalElement.parentElement.hasAttribute('rel')) {
                link.setAttribute('rel', originalElement.parentElement.getAttribute('rel'));
            }
        }
        
        const timeElement = document.createElement('time');
        timeElement.className = 'modern-timestamp';
        
        if (isPostQueue) {
            timeElement.classList.add('future-timestamp');
            timeElement.setAttribute('data-scheduled-post', 'true');
        }
        
        const utcISOString = momentDate.toISOString();
        timeElement.setAttribute('datetime', utcISOString);
        
        const userLocalDate = momentDate.tz(userSettings.timezone);
        const titleFormat = userSettings.formats.longDateTime;
        const localizedTitle = userLocalDate.locale(userSettings.locale).format(titleFormat);
        const timezoneAbbr = userLocalDate.format('z');
        const now = moment();
        const isFuture = momentDate.isAfter(now);
        
        if (isFuture && isPostQueue) {
            timeElement.setAttribute('title', 'Scheduled for ' + localizedTitle + ' (' + timezoneAbbr + ')');
        } else {
            timeElement.setAttribute('title', localizedTitle + ' (' + timezoneAbbr + ')');
        }
        
        const relativeSpan = document.createElement('span');
        relativeSpan.className = 'relative-time';
        const relativeTime = this.#formatTimeAgo(momentDate);
        relativeSpan.textContent = relativeTime;
        
        timeElement.setAttribute('data-absolute-time', userLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime));
        
        if (isFuture && isPostQueue) {
            const indicator = document.createElement('span');
            indicator.className = 'future-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.innerHTML = '&#x23F1;';
            indicator.style.marginLeft = '4px';
            relativeSpan.appendChild(indicator);
        }
        
        timeElement.appendChild(relativeSpan);
        
        let finalElement;
        if (href) {
            link.appendChild(timeElement);
            finalElement = link;
        } else {
            finalElement = timeElement;
        }
        
        const timeElementId = 'timestamp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        timeElement.setAttribute('data-timestamp-id', timeElementId);
        timeElement.setAttribute('data-utc-date', utcISOString);
        timeElement.setAttribute('data-original-date', dateString);
        
        const updateInterval = setInterval(() => {
            if (!document.body.contains(timeElement)) {
                clearInterval(updateInterval);
                this.#timeUpdateIntervals.delete(timeElementId);
                return;
            }
            
            const storedUTC = moment(timeElement.getAttribute('data-utc-date'));
            if (storedUTC.isValid()) {
                const newRelativeTime = this.#formatTimeAgo(storedUTC);
                if (relativeSpan.textContent !== newRelativeTime) {
                    relativeSpan.textContent = newRelativeTime;
                    
                    const existingIndicator = relativeSpan.querySelector('.future-indicator');
                    if (existingIndicator) {
                        existingIndicator.remove();
                    }
                    
                    if (isFuture && timeElement.classList.contains('future-timestamp')) {
                        const indicator = document.createElement('span');
                        indicator.className = 'future-indicator';
                        indicator.setAttribute('aria-hidden', 'true');
                        indicator.innerHTML = '&#x23F1;';
                        indicator.style.marginLeft = '4px';
                        relativeSpan.appendChild(indicator);
                    }
                }
                
                const currentUserLocalDate = storedUTC.tz(userSettings.timezone);
                let currentTitle = currentUserLocalDate.locale(userSettings.locale).format(titleFormat);
                const currentTimezoneAbbr = currentUserLocalDate.format('z');
                
                if (timeElement.classList.contains('future-timestamp')) {
                    currentTitle = 'Scheduled for ' + currentTitle;
                }
                
                timeElement.setAttribute('title', currentTitle + ' (' + currentTimezoneAbbr + ')');
            }
        }, 30000);
        
        this.#timeUpdateIntervals.set(timeElementId, updateInterval);
        timeElement.setAttribute('data-parsed-date', dateString);
        timeElement.setAttribute('data-user-timezone', userSettings.timezone);
        timeElement.setAttribute('data-user-locale', userSettings.locale);
        timeElement.setAttribute('data-parsed-utc', utcISOString);
        
        return finalElement;
    }

    #getUserLocaleSettings() {
        try {
            const locale = navigator.language || 'en-US';
            const testTime = moment().locale(locale).format('LT');
            const uses24Hour = !testTime.includes('AM') && !testTime.includes('PM');
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

    #extractDateFromElement(element) {
        if (element.classList && element.classList.contains('modern-timestamp')) {
            return null;
        }
        
        if (element.closest && element.closest('.modern-timestamp')) {
            return null;
        }
        
        if (element.tagName === 'A') {
            const href = element.getAttribute('href') || '';
            const rel = element.getAttribute('rel') || '';
            
            if (href.includes('&p=') || href.includes('?p=')) {
                return null;
            }
            if (href.includes('CODE=08') || href.includes('CODE=02') || 
                href.includes('delete_post') || href.includes('javascript:')) {
                return null;
            }
            if (element.querySelector('.fa-file-o, .fa-folder')) {
                return null;
            }
            if (rel === 'nofollow' && (href.includes('act=Post') || href.includes('CODE='))) {
                return null;
            }
            if (element.closest('.btn-share') || element.getAttribute('data-action') === 'share') {
                return null;
            }
        }
        
        if (element.tagName === 'BUTTON') {
            return null;
        }
        
        if (element.tagName === 'I' && (
            element.classList.contains('fa-pen-to-square') ||
            element.classList.contains('fa-quote-left') ||
            element.classList.contains('fa-eraser') ||
            element.classList.contains('fa-share-nodes') ||
            element.classList.contains('fa-file-o') ||
            element.classList.contains('fa-folder')
        )) {
            return null;
        }
        
        if (element.hasAttribute('title')) {
            const title = element.getAttribute('title');
            return title.replace(/:\d+$/, '');
        }
        
        if (element.textContent) {
            const text = element.textContent.trim();
            
            const datePatterns = [
                /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
                /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)/i,
                /(\d{4}-\d{1,2}-\d{1,2},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
                /(\d{1,2}\.\d{1,2}\.\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
            ];
            
            for (const pattern of datePatterns) {
                const match = text.match(pattern);
                if (match) {
                    return match[1].trim();
                }
            }
            
            const dateTimeMatch = text.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}.+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
            if (dateTimeMatch) {
                return dateTimeMatch[1].trim();
            }
        }
        
        const parentCheckElements = [
            element.parentElement,
            element.parentElement?.parentElement,
            element.closest('a'),
            element.closest('.lt.Sub'),
            element.closest('.title2')
        ];
        
        for (const parent of parentCheckElements) {
            if (parent && parent.hasAttribute('title')) {
                if (parent.tagName === 'A') {
                    const parentHref = parent.getAttribute('href') || '';
                    if (parentHref.includes('CODE=') || parentHref.includes('delete_post') || 
                        parentHref.includes('javascript:') || parentHref.includes('&p=')) {
                        continue;
                    }
                }
                
                const parentTitle = parent.getAttribute('title');
                return parentTitle.replace(/:\d+$/, '');
            }
        }
        
        return null;
    }
    
    #transformEditTimestamp(span) {
        const editPatterns = [
            /Edited by .+? - (.+)/i,
            /Modificato da .+? - (.+)/i,
            /Editado por .+? - (.+)/i,
            /Bearbeitet von .+? - (.+)/i,
            /Modifié par .+? - (.+)/i,
            /(.+ - \d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}.+)/i
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
            const momentDate = this.#parseForumDate(editDate);
            
            if (momentDate) {
                const userSettings = this.#getUserLocaleSettings();
                const userLocalDate = momentDate.tz(userSettings.timezone);
                const formattedTime = userLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime);
                const timezoneAbbr = userLocalDate.format('z');
                
                const timeElement = document.createElement('time');
                timeElement.setAttribute('datetime', momentDate.toISOString());
                timeElement.setAttribute('title', formattedTime + ' (' + timezoneAbbr + ')');
                timeElement.textContent = this.#formatTimeAgo(momentDate);
                
                const timeElementId = 'edit-timestamp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                timeElement.setAttribute('data-timestamp-id', timeElementId);
                timeElement.setAttribute('data-utc-date', momentDate.toISOString());
                
                span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edited ' + timeElement.outerHTML;
                
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
                        
                        const currentUserLocalDate = storedUTC.tz(userSettings.timezone);
                        const currentTitle = currentUserLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime);
                        const currentTimezoneAbbr = currentUserLocalDate.format('z');
                        timeElement.setAttribute('title', currentTitle + ' (' + currentTimezoneAbbr + ')');
                    }
                }, 30000);
                
                this.#timeUpdateIntervals.set(timeElementId, updateInterval);
            } else {
                console.warn('Could not parse edit date:', editDate);
                span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ' + this.#escapeHtml(span.textContent);
            }
        } else {
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
            'span.when'
        ].join(', ');
        
        element.querySelectorAll(timestampSelectors).forEach(timestampElement => {
            if (timestampElement.classList && timestampElement.classList.contains('modern-timestamp')) {
                return;
            }
            
            if (timestampElement.closest('.modern-timestamp')) {
                return;
            }
            
            if (timestampElement.querySelector && timestampElement.querySelector('.modern-timestamp')) {
                return;
            }
            
            if (timestampElement.closest('time.modern-timestamp, a .modern-timestamp')) {
                return;
            }
            
            if (timestampElement.tagName === 'A') {
                const href = timestampElement.getAttribute('href') || '';
                
                if (timestampElement.querySelector('time') || timestampElement.querySelector('.modern-timestamp')) {
                    return;
                }
                
                if (href.includes('#entry') && !timestampElement.querySelector('span.when, time')) {
                    return;
                }
                
                if (href.includes('CODE=08') ||
                    href.includes('CODE=02') ||
                    href.includes('delete_post') || 
                    href.includes('javascript:')) {
                    return;
                }
                
                if (timestampElement.querySelector('.fa-file-o, .fa-folder, .fa-file-lines')) {
                    return;
                }
                
                const hasActionIcon = timestampElement.querySelector(
                    '.fa-pen-to-square, .fa-quote-left, .fa-eraser, ' +
                    '.fa-share-nodes, .fa-file-o, .fa-folder, .fa-file-lines'
                );
                if (hasActionIcon) {
                    return;
                }
            }
            
            if (timestampElement.tagName === 'BUTTON' || timestampElement.tagName === 'I') {
                return;
            }
            
            const dateString = this.#extractDateFromElement(timestampElement);
            
            if (dateString) {
                const modernTimestamp = this.#createModernTimestamp(timestampElement, dateString);
                
                if (modernTimestamp && modernTimestamp !== timestampElement) {
                    const parent = timestampElement.parentNode;
                    
                    if (parent && parent.tagName === 'A' && parent.children.length === 1 && 
                        parent.children[0] === timestampElement && parent.href && parent.href.includes('#entry')) {
                        parent.parentNode.replaceChild(modernTimestamp, parent);
                    } else if (timestampElement.tagName === 'A' && timestampElement.href && 
                             timestampElement.href.includes('#entry') && 
                             timestampElement.children.length === 0) {
                        timestampElement.parentNode.replaceChild(modernTimestamp, timestampElement);
                    } else if (timestampElement.tagName === 'SPAN' && parent && parent.tagName === 'A' && 
                             parent.href && parent.href.includes('#entry')) {
                        parent.replaceChild(modernTimestamp, timestampElement);
                    } else {
                        timestampElement.parentNode.replaceChild(modernTimestamp, timestampElement);
                    }
                }
            }
        });
    }
    
    #transformPostHeaderTimestamps(postHeader) {
        if (!postHeader) return;
        
        const timestampPatterns = [
            'span.when',
            'time:not(.modern-timestamp)',
            '.lt.Sub span.when',
            '.lt.Sub a span.when'
        ];
        
        timestampPatterns.forEach(pattern => {
            postHeader.querySelectorAll(pattern).forEach(el => {
                if (el.classList && el.classList.contains('modern-timestamp')) return;
                
                const dateString = this.#extractDateFromElement(el);
                if (dateString) {
                    const modernTimestamp = this.#createModernTimestamp(el, dateString);
                    if (modernTimestamp !== el) {
                        el.parentNode.replaceChild(modernTimestamp, el);
                    }
                }
            });
        });
    }

    // ==============================
    // ATTACHMENT TRANSFORMATION
    // ==============================

    #modernizeAttachments() {
        this.#processExistingAttachments();
        this.#setupAttachmentObserver();
    }

    #processExistingAttachments() {
        document.querySelectorAll('.fancytop + div[align="center"], .fancytop + .fancyborder:not(.attachment-modernized)').forEach(container => {
            this.#transformAttachment(container);
            container.classList.add('attachment-modernized');
        });
    }

    #transformAttachment(container) {
        const fancyTop = container.previousElementSibling;
        if (!fancyTop || !fancyTop.classList.contains('fancytop')) {
            return;
        }

        const isImageAttachment = container.querySelector('a[href*="image.forumcommunity.it"]') || 
                                  container.querySelector('img[src*="image.forumcommunity.it"]');
        
        const isFileAttachment = container.querySelector('img[src*="mime_types/"]') || 
                                container.querySelector('a[onclick*="act=Attach"]');

        if (!isImageAttachment && !isFileAttachment) {
            return;
        }

        fancyTop.remove();

        const modernAttachment = document.createElement('div');
        modernAttachment.className = 'modern-attachment';

        let html = '';

        if (isImageAttachment) {
            html = this.#createImageAttachmentHTML(container);
        } else if (isFileAttachment) {
            html = this.#createFileAttachmentHTML(container);
        }

        if (html) {
            modernAttachment.innerHTML = html;
            container.replaceWith(modernAttachment);
            
            if (isImageAttachment) {
                this.#addImageAttachmentListeners(modernAttachment);
            }
            
            if (isFileAttachment) {
                this.#addFileAttachmentListeners(modernAttachment);
            }
            
            if (isImageAttachment) {
                this.#triggerMediaDimensionExtractor(modernAttachment);
            }
        }
    }

    #createImageAttachmentHTML(container) {
        const imageLink = container.querySelector('a[href*="image.forumcommunity.it"]');
        const imageElement = container.querySelector('img[src*="image.forumcommunity.it"]');
        
        if (!imageLink || !imageElement) {
            return '';
        }

        const imageUrl = imageLink.getAttribute('href') || imageElement.getAttribute('src');
        const imageAlt = imageElement.getAttribute('alt') || 'Attached image';
        const imageTitle = imageLink.getAttribute('title') || imageAlt;
        
        let width = imageElement.getAttribute('width');
        let height = imageElement.getAttribute('height');
        
        if ((!width || !height) && imageElement.naturalWidth && imageElement.naturalHeight) {
            width = imageElement.naturalWidth;
            height = imageElement.naturalHeight;
        }
        
        const dataWidth = imageElement.getAttribute('data-width');
        const dataHeight = imageElement.getAttribute('data-height');
        
        if (dataWidth && dataHeight) {
            width = dataWidth;
            height = dataHeight;
        }
        
        const downloadUrl = imageUrl;
        const fileName = this.#extractFileNameFromUrl(imageUrl) || 'image.jpg';
        const fileSize = this.#calculateImageSize(width, height, fileName);
        
        let html = '<div class="attachment-header">' +
            '<div class="attachment-icon">' +
            '<i class="fa-regular fa-image" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="attachment-info">' +
            '<span class="attachment-title">Attached Image</span>' +
            '<span class="attachment-details">' + this.#escapeHtml(fileName) + ' • ' + fileSize + '</span>' +
            '</div>' +
            '<div class="attachment-actions">' +
            '<a href="' + this.#escapeHtml(downloadUrl) + '" class="attachment-download-btn" download="' + this.#escapeHtml(fileName) + '" title="Download image" target="_blank" rel="nofollow">' +
            '<i class="fa-regular fa-download" aria-hidden="true"></i>' +
            '</a>' +
            '<a href="' + this.#escapeHtml(imageUrl) + '" class="attachment-view-btn" title="View full size" target="_blank" rel="nofollow">' +
            '<i class="fa-regular fa-expand" aria-hidden="true"></i>' +
            '</a>' +
            '</div>' +
            '</div>';
        
        html += '<div class="attachment-preview">' +
            '<a href="' + this.#escapeHtml(imageUrl) + '" class="attachment-image-link" title="' + this.#escapeHtml(imageTitle) + '" target="_blank" rel="nofollow">' +
            '<img src="' + this.#escapeHtml(imageElement.getAttribute('src')) + '" alt="' + this.#escapeHtml(imageAlt) + '" loading="lazy" decoding="async"';
        
        if (width && height) {
            html += ' width="' + width + '" height="' + height + '"';
        }
        
        html += ' style="max-width: 100%; height: auto; display: block;">' +
            '</a>' +
            '</div>';
        
        return html;
    }

    #calculateImageSize(width, height, fileName) {
        if (!width || !height) {
            const dimensionMatch = fileName.match(/(\d+)x(\d+)/);
            if (dimensionMatch) {
                width = parseInt(dimensionMatch[1]);
                height = parseInt(dimensionMatch[2]);
            } else {
                return 'Unknown dimensions';
            }
        }
        
        const megapixels = (width * height) / 1000000;
        
        if (megapixels < 0.1) {
            return width + '×' + height + ' pixels';
        } else if (megapixels < 1) {
            return width + '×' + height + ' (' + Math.round(megapixels * 1000) + 'K pixels)';
        } else {
            return width + '×' + height + ' (' + megapixels.toFixed(1) + ' MP)';
        }
    }

    #extractFileNameFromUrl(url) {
        if (!url) return '';
        
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const parts = pathname.split('/');
            const fileName = parts[parts.length - 1] || 'image.jpg';
            
            return fileName.split('?')[0];
        } catch {
            const parts = url.split('/');
            const fileName = parts[parts.length - 1] || 'image.jpg';
            return fileName.split('?')[0];
        }
    }

    #createFileAttachmentHTML(container) {
        const fileLink = container.querySelector('a[onclick*="act=Attach"]');
        const mimeIcon = container.querySelector('img[src*="mime_types/"]');
        const fileNameElement = fileLink ? fileLink.querySelector('span.post-text') : null;
        const downloadCountElement = container.querySelector('small');
        
        if (!fileLink) {
            return '';
        }

        const fileName = fileNameElement ? fileNameElement.textContent.trim() : 'Unknown file';
        const downloadCount = downloadCountElement ? downloadCountElement.textContent.replace(/[^\d]/g, '') : '0';
        const fileType = this.#getFileTypeFromName(fileName);
        const fileIcon = this.#getFileIcon(fileType);
        
        let downloadUrl = '#';
        const onclickAttr = fileLink.getAttribute('onclick');
        if (onclickAttr) {
            const urlMatch = onclickAttr.match(/window\.open\('([^']+)'/);
            if (urlMatch && urlMatch[1]) {
                downloadUrl = urlMatch[1];
            }
        }
        
        let html = '<div class="attachment-header">' +
            '<div class="attachment-icon">' +
            '<i class="' + fileIcon + '" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="attachment-info">' +
            '<span class="attachment-title">Attached File</span>' +
            '<span class="attachment-details">' + this.#escapeHtml(fileName) + ' • ' + fileType.toUpperCase() + '</span>' +
            '</div>' +
            '<div class="attachment-actions">' +
            '<a href="' + this.#escapeHtml(downloadUrl) + '" class="attachment-download-btn" download="' + this.#escapeHtml(fileName) + '" title="Download file" target="_blank" rel="nofollow" onclick="' + this.#escapeHtml(onclickAttr || '') + '">' +
            '<i class="fa-regular fa-download" aria-hidden="true"></i>' +
            '</a>' +
            '</div>' +
            '</div>';
        
        html += '<div class="attachment-stats">' +
            '<div class="stat-item">' +
            '<i class="fa-regular fa-download" aria-hidden="true"></i>' +
            '<span>' + downloadCount + ' download' + (downloadCount !== '1' ? 's' : '') + '</span>' +
            '</div>' +
            '<div class="stat-item">' +
            '<i class="fa-regular fa-file" aria-hidden="true"></i>' +
            '<span>' + fileType.toUpperCase() + ' file</span>' +
            '</div>' +
            '</div>';
        
        return html;
    }

    #getFileTypeFromName(fileName) {
        if (!fileName) return 'file';
        
        const extension = fileName.split('.').pop().toLowerCase();
        
        const typeMap = {
            'pdf': 'PDF',
            'doc': 'Word',
            'docx': 'Word',
            'txt': 'Text',
            'rtf': 'Rich Text',
            'zip': 'ZIP Archive',
            'rar': 'RAR Archive',
            '7z': '7-Zip Archive',
            'tar': 'TAR Archive',
            'gz': 'GZIP Archive',
            'jpg': 'Image',
            'jpeg': 'Image',
            'png': 'Image',
            'gif': 'Image',
            'bmp': 'Image',
            'svg': 'SVG Image',
            'mp3': 'Audio',
            'wav': 'Audio',
            'flac': 'Audio',
            'm4a': 'Audio',
            'mp4': 'Video',
            'avi': 'Video',
            'mkv': 'Video',
            'mov': 'Video',
            'wmv': 'Video',
            'js': 'JavaScript',
            'html': 'HTML',
            'css': 'CSS',
            'php': 'PHP',
            'py': 'Python',
            'java': 'Java',
            'cpp': 'C++',
            'c': 'C',
            'json': 'JSON',
            'xml': 'XML'
        };
        
        return typeMap[extension] || 'File';
    }

    #getFileIcon(fileType) {
        const iconMap = {
            'PDF': 'fa-regular fa-file-pdf',
            'Word': 'fa-regular fa-file-word',
            'Text': 'fa-regular fa-file-lines',
            'Rich Text': 'fa-regular fa-file-lines',
            'ZIP Archive': 'fa-regular fa-file-zipper',
            'RAR Archive': 'fa-regular fa-file-zipper',
            '7-Zip Archive': 'fa-regular fa-file-zipper',
            'TAR Archive': 'fa-regular fa-file-zipper',
            'GZIP Archive': 'fa-regular fa-file-zipper',
            'Image': 'fa-regular fa-image',
            'SVG Image': 'fa-regular fa-image',
            'Audio': 'fa-regular fa-file-audio',
            'Video': 'fa-regular fa-file-video',
            'JavaScript': 'fa-regular fa-file-code',
            'HTML': 'fa-regular fa-file-code',
            'CSS': 'fa-regular fa-file-code',
            'PHP': 'fa-regular fa-file-code',
            'Python': 'fa-regular fa-file-code',
            'Java': 'fa-regular fa-file-code',
            'C++': 'fa-regular fa-file-code',
            'C': 'fa-regular fa-file-code',
            'JSON': 'fa-regular fa-file-code',
            'XML': 'fa-regular fa-file-code'
        };
        
        return iconMap[fileType] || 'fa-regular fa-file';
    }

    #addImageAttachmentListeners(attachmentElement) {
        const imageLink = attachmentElement.querySelector('.attachment-image-link');
        const viewBtn = attachmentElement.querySelector('.attachment-view-btn');
        const downloadBtn = attachmentElement.querySelector('.attachment-download-btn');
        
        if (imageLink && viewBtn) {
            viewBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(imageLink.href, '_blank', 'noopener,noreferrer');
            });
        }
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                console.log('Downloading image attachment');
            });
        }
    }

    #addFileAttachmentListeners(attachmentElement) {
        const downloadBtn = attachmentElement.querySelector('.attachment-download-btn');
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                console.log('Downloading file attachment');
            });
        }
    }

    #triggerMediaDimensionExtractor(attachmentElement) {
        if (globalThis.mediaDimensionExtractor && 
            typeof globalThis.mediaDimensionExtractor.extractDimensionsForElement === 'function') {
            
            const image = attachmentElement.querySelector('img');
            if (image) {
                setTimeout(() => {
                    globalThis.mediaDimensionExtractor.extractDimensionsForElement(image);
                    
                    setTimeout(() => {
                        this.#updateAttachmentSizeInfo(attachmentElement, image);
                    }, 100);
                }, 10);
            }
        }
    }

    #updateAttachmentSizeInfo(attachmentElement, imageElement) {
        const width = imageElement.getAttribute('width') || imageElement.naturalWidth;
        const height = imageElement.getAttribute('height') || imageElement.naturalHeight;
        
        if (width && height) {
            const fileName = this.#extractFileNameFromUrl(imageElement.src) || 'image.jpg';
            const fileSize = this.#calculateImageSize(width, height, fileName);
            
            const detailsElement = attachmentElement.querySelector('.attachment-details');
            if (detailsElement) {
                detailsElement.textContent = fileName + ' • ' + fileSize;
            }
            
            if (!imageElement.hasAttribute('width')) {
                imageElement.setAttribute('width', width);
            }
            if (!imageElement.hasAttribute('height')) {
                imageElement.setAttribute('height', height);
            }
            
            imageElement.style.aspectRatio = width + ' / ' + height;
        }
    }

    #setupAttachmentObserver() {
        if (globalThis.forumObserver) {
            this.#attachmentObserverId = globalThis.forumObserver.register({
                id: 'attachment-modernizer',
                callback: (node) => this.#handleNewAttachments(node),
                selector: '.fancytop + div[align="center"], .fancytop + .fancyborder',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'send', 'search']
            });
        } else {
            setInterval(() => this.#processExistingAttachments(), 2000);
        }
    }

    #handleNewAttachments(node) {
        if (node.matches('.fancytop + div[align="center"]') || node.matches('.fancytop + .fancyborder')) {
            this.#transformAttachment(node);
        } else {
            node.querySelectorAll('.fancytop + div[align="center"], .fancytop + .fancyborder').forEach(attachment => {
                this.#transformAttachment(attachment);
            });
        }
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
        document.querySelectorAll('.st-emoji-container').forEach(container => this.#updateEmojiContainerActiveState(container));
        document.querySelectorAll('.mini_buttons.points.Sub .points').forEach(container => this.#updatePointsContainerActiveState(container));
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
        document.querySelectorAll('.st-emoji-container').forEach(container => this.#updateEmojiContainerActiveState(container));
    }

    #updateAllPointsActiveStates() {
        document.querySelectorAll('.mini_buttons.points.Sub .points').forEach(container => this.#updatePointsContainerActiveState(container));
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
        document.querySelectorAll('.mini_buttons.points.Sub').forEach(buttons => this.#cleanupMiniButtons(buttons));
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

            if (!post.classList.contains('post_queue')) {
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
            }

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

                    const isDeletedUser = post.classList.contains('box_visitatore');
                    
                    if (isDeletedUser) {
                        if (details) {
                            const detailsClone = details.cloneNode(true);
                            this.#processDeletedUserDetails(detailsClone, nickElement);
                            userInfo.appendChild(detailsClone);
                        } else {
                            userInfo.appendChild(leftSection.cloneNode(true));
                        }
                    } 
                        
                    else if (details && avatar) {
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
                    this.#processIframeTables(rightSectionClone);
                    this.#preserveMediaDimensions(rightSectionClone);

                    contentWrapper.appendChild(rightSectionClone);
                    this.#cleanupPostContentStructure(contentWrapper);
                    postContent.appendChild(contentWrapper);
                    this.#modernizeQuotes(contentWrapper);
                    this.#modernizeSpoilers(contentWrapper);
                    this.#modernizeCodeBlocksInContent(contentWrapper);
                    this.#modernizeAttachmentsInContent(contentWrapper);
                    this.#modernizeEmbeddedLinksInContent(contentWrapper);
                }
            });

            const title2Bottom = post.querySelector('.title2.bottom');
            
            if (post.classList.contains('post_queue')) {
            } else if (title2Bottom) {
                this.#addReputationToFooter(miniButtons, stEmoji, postFooter);
                this.#modernizeBottomElements(title2Bottom, postFooter);
                title2Bottom.remove();
            } else {
                this.#addReputationToFooter(miniButtons, stEmoji, postFooter);
            }

            fragment.appendChild(postHeader);
            fragment.appendChild(userInfo);
            fragment.appendChild(postContent);
            
            if (!post.classList.contains('post_queue')) {
                fragment.appendChild(postFooter);
            }

            post.innerHTML = '';
            post.appendChild(fragment);

            if (post.classList.contains('post_queue')) {
                this.#transformPostQueueButtons(post);
            } else {
                this.#convertMiniButtonsToButtons(post);
                this.#addShareButton(post);
            }
            
            this.#cleanupPostContent(post);

            const postId = post.id;
            if (postId && postId.startsWith('ee')) {
                post.setAttribute('data-post-id', postId.replace('ee', ''));
            }
            
            // Clean up double-wrapped media after transformation
            setTimeout(() => {
                this.#cleanupOldMediaWrappers(post);
            }, 100);
        });
    }

    #processDeletedUserDetails(detailsElement, nickElement) {
        if (!detailsElement) return;
        
        const avatarContainer = detailsElement.querySelector('.forum-avatar-container, .deleted-user-container');
        const nickFromDetails = detailsElement.querySelector('.nick');
        const uTitleElement = detailsElement.querySelector('span.u_title');
        
        detailsElement.innerHTML = '';
        
        if (avatarContainer) {
            detailsElement.appendChild(avatarContainer.cloneNode(true));
        }
        
        if (nickFromDetails) {
            detailsElement.appendChild(nickFromDetails.cloneNode(true));
        } else if (nickElement) {
            detailsElement.appendChild(nickElement.cloneNode(true));
        }
        
        if (uTitleElement) {
            const titleText = this.#extractTextFromUTitle(uTitleElement);
            if (titleText) {
                const badge = document.createElement('div');
                badge.className = 'badge deleted-user-badge';
                badge.textContent = titleText;
                detailsElement.appendChild(badge);
            }
        }
        
        this.#cleanEmptyElements(detailsElement);
    }
    
    #extractTextFromUTitle(uTitleElement) {
        if (!uTitleElement) return '';
        
        const textNodes = [];
        const walker = document.createTreeWalker(uTitleElement, NodeFilter.SHOW_TEXT, null, false);
        let node;
        
        while ((node = walker.nextNode())) {
            const text = node.textContent.trim();
            if (text) {
                textNodes.push(text);
            }
        }
        
        let result = textNodes.join(' ').trim();
        
        if (result.toLowerCase().includes('user deleted')) {
            result = result.replace(/<br\s*\/?>/gi, ' ').trim();
            result = result.replace(/\s+/g, ' ');
            result = result.replace(/\b\w/g, char => char.toUpperCase());
        }
        
        return result;
    }
    
    #modernizeEmbeddedLinksInContent(contentWrapper) {
        if (this.#isInEditor(contentWrapper)) return;
        
        contentWrapper.querySelectorAll('.ffb_embedlink:not(.embedded-link-modernized)').forEach(container => {
            this.#transformEmbeddedLink(container);
            container.classList.add('embedded-link-modernized');
        });
    }

    #transformPostQueueButtons(post) {
        const miniButtonsContainer = post.querySelector('.mini_buttons.rt.Sub');
        if (!miniButtonsContainer) return;

        const shareButton = miniButtonsContainer.querySelector('.btn-share, [data-action="share"]');
        if (shareButton) {
            shareButton.remove();
        }

        const editLink = miniButtonsContainer.querySelector('a[href*="act=edit"]');
        const removeLink = miniButtonsContainer.querySelector('a[onclick*="remove_cron"]');

        if (editLink) {
            editLink.classList.add('btn', 'btn-icon', 'btn-edit');
            editLink.setAttribute('data-action', 'edit');
            editLink.setAttribute('title', 'Edit');
            editLink.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>';
        }

        if (removeLink) {
            removeLink.classList.add('btn', 'btn-icon', 'btn-delete');
            removeLink.setAttribute('data-action', 'delete');
            removeLink.setAttribute('title', 'Remove');
            removeLink.innerHTML = '<i class="fa-regular fa-eraser" aria-hidden="true"></i>';
            removeLink.removeAttribute('style');
        }

        this.#reorderPostQueueButtons(miniButtonsContainer);
    }

    #reorderPostQueueButtons(container) {
        const elements = Array.from(container.children);
        const order = ['edit', 'delete'];

        elements.sort((a, b) => {
            const getAction = (element) => {
                const dataAction = element.getAttribute('data-action');
                if (dataAction && order.includes(dataAction)) return dataAction;

                if (element.classList.contains('btn-edit')) return 'edit';
                if (element.classList.contains('btn-delete')) return 'delete';

                if (element.href && element.href.includes('act=edit')) return 'edit';
                if (element.onclick && element.onclick.toString().includes('remove_cron')) return 'delete';

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

    #modernizeAttachmentsInContent(contentWrapper) {
        contentWrapper.querySelectorAll('.fancytop + div[align="center"], .fancytop + .fancyborder:not(.attachment-modernized)').forEach(container => {
            this.#transformAttachment(container);
            container.classList.add('attachment-modernized');
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

            if (!post.classList.contains('post_queue')) {
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
            }

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

                while ((node = walker.nextNode())) {
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
                this.#modernizeAttachmentsInContent(contentWrapper);
                this.#modernizeEmbeddedLinksInContent(contentWrapper);

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
            
            // Clean up double-wrapped media after transformation
            setTimeout(() => {
                this.#cleanupOldMediaWrappers(newPost);
            }, 100);
        });
    }
    
    #cleanupSearchPostContent(contentWrapper) {
        if (this.#isInEditor(contentWrapper)) return;
        
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

        contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top):not(.quote-modernized)').forEach(container => {
            this.#transformQuote(container);
            container.classList.add('quote-modernized');
        });

        contentWrapper.querySelectorAll('div[align="center"].spoiler:not(.spoiler-modernized)').forEach(container => {
            this.#transformSpoiler(container);
            container.classList.add('spoiler-modernized');
        });

        contentWrapper.querySelectorAll('div[align="center"]:has(.code_top):not(.code-modernized)').forEach(container => {
            this.#transformCodeBlock(container);
            container.classList.add('code-modernized');
        });

        contentWrapper.querySelectorAll('.fancytop + div[align="center"], .fancytop + .fancyborder:not(.attachment-modernized)').forEach(container => {
            this.#transformAttachment(container);
            container.classList.add('attachment-modernized');
        });

        contentWrapper.querySelectorAll('.ffb_embedlink:not(.embedded-link-modernized)').forEach(container => {
            this.#transformEmbeddedLink(container);
            container.classList.add('embedded-link-modernized');
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
        if (this.#isInEditor(contentElement)) return;
        
        contentElement.querySelectorAll('table.color[data-protected-iframe]').forEach(table => {
            const parent = table.parentNode;
            if (!parent) return;
            
            const container = document.createElement('div');
            container.className = 'extracted-content';
            
            const tbody = table.querySelector('tbody');
            if (tbody) {
                while (tbody.firstChild) {
                    container.appendChild(tbody.firstChild);
                }
            } else {
                while (table.firstChild) {
                    container.appendChild(table.firstChild);
                }
            }
            
            parent.insertBefore(container, table);
            table.remove();
            this.#cleanupExtractedTableContent(container);
        });
        
        contentElement.querySelectorAll('.ve-table').forEach(table => {
            this.#protectAndRepairTable(table);
        });

        contentElement.querySelectorAll('table:not(.ve-table):not([data-protected-iframe])').forEach(table => {
            const parent = table.parentNode;
            if (parent) {
                while (table.firstChild) {
                    parent.insertBefore(table.firstChild, table);
                }
                table.remove();
            }
        });

        contentElement.querySelectorAll('tbody, tr, td').forEach(el => {
            const parent = el.parentNode;
            if (parent && !el.closest('.ve-table')) {
                while (el.firstChild) {
                    parent.insertBefore(el.firstChild, el);
                }
                el.remove();
            }
        });

        this.#cleanUpLineBreaksBetweenBlocks(contentElement);
        this.#cleanEmptyElements(contentElement);
        this.#processTextAndLineBreaks(contentElement);
        this.#cleanupEditSpans(contentElement);
        this.#processSignature(contentElement);
        this.#cleanInvalidAttributes(contentElement);
    }

    #processIframeTables(element) {
        element.querySelectorAll('table.color').forEach(table => {
            const hasIframe = table.querySelector('iframe');
            const hasVideoWrapper = table.querySelector('[style*="padding-bottom"]');
            
            if (hasIframe || hasVideoWrapper) {
                table.setAttribute('data-protected-iframe', 'true');
            }
        });
    }

    #cleanupExtractedTableContent(container) {
        container.querySelectorAll('tbody, tr').forEach(el => {
            const parent = el.parentNode;
            if (parent) {
                while (el.firstChild) {
                    parent.insertBefore(el.firstChild, el);
                }
                el.remove();
            }
        });
        
        container.querySelectorAll('td').forEach(td => {
            const parent = td.parentNode;
            if (parent) {
                while (td.firstChild) {
                    parent.insertBefore(td.firstChild, td);
                }
                td.remove();
            }
        });
        
        if (container.children.length === 0 && !container.textContent.trim()) {
            container.remove();
        }
    }
    
    #protectAndRepairTable(table) {
        table.setAttribute('data-table-protected', 'true');
        
        if (!table.querySelector('tbody')) {
            const tbody = document.createElement('tbody');
            const rows = [];
            let currentRow = null;
            
            Array.from(table.children).forEach(child => {
                if (child.tagName === 'TR') {
                    if (currentRow) {
                        rows.push(currentRow);
                        currentRow = null;
                    }
                    rows.push(child);
                } else if (child.tagName === 'TH' || child.tagName === 'TD') {
                    if (!currentRow) {
                        currentRow = document.createElement('tr');
                    }
                    currentRow.appendChild(child);
                } else if (child.tagName === 'TBODY') {
                    tbody = child;
                    return;
                }
            });
            
            if (currentRow) {
                rows.push(currentRow);
            }
            
            rows.forEach(row => tbody.appendChild(row));
            
            table.innerHTML = '';
            table.appendChild(tbody);
        }
        
        table.querySelectorAll('th, td').forEach(cell => {
            const existingSpans = cell.querySelectorAll('.post-text');
            existingSpans.forEach(span => {
                while (span.firstChild) {
                    cell.insertBefore(span.firstChild, span);
                }
                span.remove();
            });
            
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null, false);
            const textNodes = [];
            let node;
            while ((node = walker.nextNode())) {
                if (node.textContent.trim()) {
                    textNodes.push(node);
                }
            }
            
            textNodes.forEach(textNode => {
                const span = document.createElement('span');
                span.className = 'post-text';
                span.textContent = textNode.textContent;
                textNode.parentNode.replaceChild(span, textNode);
            });
            
            if (cell.children.length === 0 && !cell.textContent.trim()) {
                const span = document.createElement('span');
                span.className = 'post-text';
                cell.appendChild(span);
            }
        });
        
        table.removeAttribute('style');
        table.removeAttribute('cellpadding');
        table.removeAttribute('cellspacing');
        table.removeAttribute('border');
        
        table.querySelectorAll('th[rowspan="1"], td[rowspan="1"]').forEach(cell => {
            cell.removeAttribute('rowspan');
        });
        table.querySelectorAll('th[colspan="1"], td[colspan="1"]').forEach(cell => {
            cell.removeAttribute('colspan');
        });
        
        if (!table.parentElement || !table.parentElement.classList.contains('table-container')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'table-container';
            
            const tableClasses = Array.from(table.classList).filter(cls => cls !== 've-table');
            if (tableClasses.length > 0) {
                wrapper.classList.add(...tableClasses);
            }
            
            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);
        }
        
        table.classList.add('ve-table');
    }
    
    #cleanupEditSpans(element) {
        if (this.#isInEditor(element)) return;
        
        element.querySelectorAll('span.edit:not(:has(time[datetime]))').forEach(span => {
            this.#transformEditTimestamp(span);
        });
    }

    #cleanUpLineBreaksBetweenBlocks(element) {
        if (this.#isInEditor(element)) return;
        
        const blockSelectors = [
            '.modern-spoiler',
            '.modern-code',
            '.modern-quote',
            'div[align="center"]:has(.code_top)',
            'div[align="center"].spoiler',
            'div[align="center"]:has(.quote_top)',
            '.modern-attachment',
            '.modern-embedded-link'
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
        if (this.#isInEditor(element)) return;
        
        element.querySelectorAll(':empty').forEach(emptyEl => {
            const isIframeWrapper = emptyEl.classList && 
                (emptyEl.classList.contains('iframe-wrapper') || 
                 emptyEl.style.paddingBottom || 
                 emptyEl.style.position === 'relative');
            
            if (!isIframeWrapper && 
                !['IMG', 'BR', 'HR', 'INPUT', 'META', 'LINK', 'IFRAME'].includes(emptyEl.tagName)) {
                emptyEl.remove();
            }
        });

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const nodesToRemove = [];
        let node;

        while ((node = walker.nextNode())) {
            if (node.textContent.trim() === '') {
                nodesToRemove.push(node);
            }
        }

        nodesToRemove.forEach(node => node.parentNode && node.parentNode.removeChild(node));
    }
    
    #cleanInvalidAttributes(element) {
        if (this.#isInEditor(element)) return;
        
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
        if (this.#isInEditor(element)) return;
        
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;

        while ((node = walker.nextNode())) {
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

            if (br.closest('.modern-spoiler, .modern-code, .modern-quote, .code-header, .spoiler-header, .quote-header, .modern-attachment, .attachment-header, .modern-embedded-link')) {
                return;
            }

            if (prevSibling && nextSibling) {
                const prevIsPostText = prevSibling.classList && prevSibling.classList.contains('post-text');
                const nextIsPostText = nextSibling.classList && nextSibling.classList.contains('post-text');

                if (prevIsPostText && nextIsPostText) {
                    prevSibling.classList.add('paragraph-end');
                    br.remove();
                } else {
                    const prevIsModern = prevSibling.closest('.modern-spoiler, .modern-code, .modern-quote, .modern-attachment, .modern-embedded-link');
                    const nextIsModern = nextSibling.closest('.modern-spoiler, .modern-code, .modern-quote, .modern-attachment, .modern-embedded-link');

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
        if (this.#isInEditor(element)) return;
        
        element.querySelectorAll('.signature').forEach(sig => {
            sig.classList.add('post-signature');
            sig.previousElementSibling && sig.previousElementSibling.tagName === 'BR' && sig.previousElementSibling.remove();
        });
    }

    #modernizeQuotes(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top):not(.quote-modernized)').forEach(container => {
            this.#transformQuote(container);
            container.classList.add('quote-modernized');
        });
    }

    #modernizeSpoilers(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"].spoiler:not(.spoiler-modernized)').forEach(container => {
            this.#transformSpoiler(container);
            container.classList.add('spoiler-modernized');
        });
    }

    #modernizeCodeBlocksInContent(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"]:has(.code_top):not(.code-modernized)').forEach(container => {
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
        // Process images (existing code)
        element.querySelectorAll('img').forEach(img => {
            if (!img.style.maxWidth) {
                img.style.maxWidth = '100%';
            }
            
            img.style.removeProperty('height');
            
            const isTwemoji = img.src.includes('twemoji') || img.classList.contains('twemoji');
            const isEmoji = img.src.includes('emoji') || img.src.includes('smiley') || 
                           (img.src.includes('imgbox') && img.alt && img.alt.includes('emoji')) ||
                           img.className.includes('emoji');
            
            if (isTwemoji || isEmoji) {
                img.style.cssText = 'display:inline-block;vertical-align:text-bottom;margin:0 2px;';
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
        
        // Clean up old wrappers first to prevent double-wrapping
        this.#cleanupOldMediaWrappers(element);
        
        // Process all media elements with standardized wrappers
        this.#normalizeAllMediaWrappers(element);
    }

    #cleanupOldMediaWrappers(element) {
        // Find all old wrapper divs that have standardized wrappers inside them
        const oldWrappers = element.querySelectorAll('.media-wrapper, .iframe-wrapper');
        
        oldWrappers.forEach(oldWrapper => {
            // Check if this old wrapper has a standard-media-wrapper inside it
            const hasStandardWrapperInside = oldWrapper.querySelector('.standard-media-wrapper');
            
            if (hasStandardWrapperInside) {
                // Get the standard wrapper
                const standardWrapper = oldWrapper.querySelector('.standard-media-wrapper');
                
                // Move the standard wrapper out of the old wrapper
                oldWrapper.parentNode.insertBefore(standardWrapper, oldWrapper);
                
                // Remove the old wrapper
                oldWrapper.remove();
            }
        });
        
        // Also clean up empty wrapper divs with specific styling patterns
        const emptyWrappers = element.querySelectorAll('div[style*="padding"][style*="position:relative"]');
        
        emptyWrappers.forEach(wrapper => {
            // Check if wrapper is empty or only contains whitespace
            const hasRealContent = Array.from(wrapper.childNodes).some(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if element is media or has real content
                    const tagName = node.tagName.toLowerCase();
                    return !['br', 'span', 'div'].includes(tagName) || 
                           node.textContent.trim() !== '' ||
                           node.querySelector('iframe, lite-youtube, lite-vimeo, video, img');
                }
                return node.textContent.trim() !== '';
            });
            
            if (!hasRealContent || wrapper.children.length === 0) {
                wrapper.remove();
            }
        });
    }

    #normalizeAllMediaWrappers(element) {
        // Find all potential media elements
        const mediaElements = element.querySelectorAll(
            'iframe, lite-youtube, lite-vimeo, video, [class*="media-wrapper"], [class*="iframe-wrapper"]'
        );
        
        mediaElements.forEach(media => {
            // Skip already wrapped elements
            if (media.getAttribute('data-wrapped') === 'true') return;
            
            // Check if element needs wrapping
            if (media.tagName === 'IFRAME') {
                this.#wrapIframe(media);
            } else if (media.tagName === 'LITE-YOUTUBE') {
                this.#wrapLiteYoutube(media);
            } else if (media.tagName === 'LITE-VIMEO') {
                this.#wrapLiteVimeo(media);
            } else if (media.tagName === 'VIDEO') {
                this.#wrapVideo(media);
            } else if (media.classList.contains('media-wrapper') || 
                       media.classList.contains('iframe-wrapper')) {
                // This is already a wrapper, ensure it's standardized
                this.#standardizeExistingWrapper(media);
            }
        });
    }

    #standardizeExistingWrapper(wrapper) {
        // Add standard class if not present
        if (!wrapper.classList.contains('standard-media-wrapper')) {
            wrapper.classList.add('standard-media-wrapper');
        }
        
        // Ensure proper styling
        const computedStyle = window.getComputedStyle(wrapper);
        
        // Check if padding-bottom is set for aspect ratio
        if (!computedStyle.paddingBottom || computedStyle.paddingBottom === '0px') {
            // Calculate or set default aspect ratio
            const children = wrapper.querySelectorAll('iframe, lite-youtube, lite-vimeo, video');
            if (children.length > 0) {
                const child = children[0];
                
                // Try to get dimensions from child
                const width = child.getAttribute('width') || child.offsetWidth;
                const height = child.getAttribute('height') || child.offsetHeight;
                
                if (width && height && !isNaN(width) && !isNaN(height)) {
                    const aspectRatio = (parseInt(height) / parseInt(width)) * 100;
                    wrapper.style.paddingBottom = aspectRatio + '%';
                } else {
                    // Default to 16:9
                    wrapper.style.paddingBottom = '56.25%';
                }
            } else {
                // Default to 16:9
                wrapper.style.paddingBottom = '56.25%';
            }
        }
        
        // Ensure wrapper has relative positioning
        if (computedStyle.position !== 'relative') {
            wrapper.style.position = 'relative';
        }
        
        // Ensure overflow hidden
        if (computedStyle.overflow !== 'hidden') {
            wrapper.style.overflow = 'hidden';
        }
        
        // Ensure full width
        if (!wrapper.style.width || wrapper.style.width !== '100%') {
            wrapper.style.width = '100%';
        }
        
        // Add margin for spacing
        if (!wrapper.style.margin || !wrapper.style.margin.includes('1em')) {
            wrapper.style.margin = '1em 0';
        }
        
        // Mark as standardized
        wrapper.setAttribute('data-standardized', 'true');
    }

    #wrapIframe(iframe) {
        // Check if already inside a standard wrapper
        const isInStandardWrapper = iframe.closest('.standard-media-wrapper');
        if (isInStandardWrapper) {
            iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0;';
            iframe.setAttribute('data-wrapped', 'true');
            return;
        }
        
        // Check if already has a wrapper
        const parent = iframe.parentElement;
        const hasWrapper = parent && (
            parent.classList.contains('media-wrapper') || 
            parent.classList.contains('iframe-wrapper') ||
            (parent.style.position === 'relative' && parent.style.paddingBottom)
        );
        
        if (hasWrapper) {
            // This is an old wrapper, replace it with standard wrapper
            const wrapper = this.#createStandardMediaWrapper(iframe);
            
            // Replace the old wrapper with standard wrapper
            parent.parentNode.insertBefore(wrapper, parent);
            wrapper.appendChild(iframe);
            parent.remove();
        } else {
            // Create standard wrapper
            const wrapper = this.#createStandardMediaWrapper(iframe);
            
            // Set standard dimensions
            if (!iframe.hasAttribute('width') || !iframe.hasAttribute('height')) {
                iframe.setAttribute('width', '100%');
                iframe.setAttribute('height', '100%');
            }
            
            // Insert wrapper before iframe
            iframe.parentNode.insertBefore(wrapper, iframe);
            
            // Move iframe into wrapper
            wrapper.appendChild(iframe);
        }
        
        // Style the iframe
        iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0;';
        iframe.setAttribute('data-wrapped', 'true');
    }
    
    #wrapLiteYoutube(liteYoutube) {
        const parent = liteYoutube.parentElement;
        
        // Check if already has a standard wrapper
        const hasStandardWrapper = parent && parent.classList.contains('standard-media-wrapper');
        
        if (hasStandardWrapper) {
            liteYoutube.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
            liteYoutube.setAttribute('data-wrapped', 'true');
            return;
        }
        
        // Create standard wrapper
        const wrapper = this.#createStandardMediaWrapper(liteYoutube);
        wrapper.classList.add('lite-youtube-wrapper');
        
        // Add YouTube-specific styling
        wrapper.style.cssText += 'background: #000;';
        
        // Insert wrapper before lite-youtube
        liteYoutube.parentNode.insertBefore(wrapper, liteYoutube);
        
        // Move element into wrapper
        wrapper.appendChild(liteYoutube);
        
        // Style lite-youtube
        liteYoutube.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        liteYoutube.setAttribute('data-wrapped', 'true');
        
        // Ensure it has proper attributes
        if (!liteYoutube.hasAttribute('width')) {
            liteYoutube.setAttribute('width', '100%');
        }
        if (!liteYoutube.hasAttribute('height')) {
            liteYoutube.setAttribute('height', '100%');
        }
    }

    #wrapLiteVimeo(liteVimeo) {
        const parent = liteVimeo.parentElement;
        
        // Check if already has a standard wrapper
        const hasStandardWrapper = parent && parent.classList.contains('standard-media-wrapper');
        
        if (hasStandardWrapper) {
            liteVimeo.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
            liteVimeo.setAttribute('data-wrapped', 'true');
            return;
        }
        
        // Create standard wrapper
        const wrapper = this.#createStandardMediaWrapper(liteVimeo);
        wrapper.classList.add('lite-vimeo-wrapper');
        
        // Add Vimeo-specific styling
        wrapper.style.cssText += 'background: #1ab7ea;';
        
        // Insert wrapper before lite-vimeo
        liteVimeo.parentNode.insertBefore(wrapper, liteVimeo);
        
        // Move element into wrapper
        wrapper.appendChild(liteVimeo);
        
        // Style lite-vimeo
        liteVimeo.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
        liteVimeo.setAttribute('data-wrapped', 'true');
        
        // Ensure it has proper attributes
        if (!liteVimeo.hasAttribute('width')) {
            liteVimeo.setAttribute('width', '100%');
        }
        if (!liteVimeo.hasAttribute('height')) {
            liteVimeo.setAttribute('height', '100%');
        }
    }

    #wrapVideo(video) {
        const parent = video.parentElement;
        
        // Check if already has a standard wrapper
        const hasStandardWrapper = parent && parent.classList.contains('standard-media-wrapper');
        
        if (hasStandardWrapper) {
            video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
            video.setAttribute('data-wrapped', 'true');
            return;
        }
        
        // Create standard wrapper
        const wrapper = this.#createStandardMediaWrapper(video);
        wrapper.classList.add('video-wrapper');
        
        // Get video dimensions or use defaults
        const width = video.getAttribute('width') || video.videoWidth || 640;
        const height = video.getAttribute('height') || video.videoHeight || 360;
        
        // Calculate aspect ratio for video specifically
        const aspectRatio = ((height / width) * 100);
        wrapper.style.paddingBottom = aspectRatio + '%';
        
        // Insert wrapper before video
        video.parentNode.insertBefore(wrapper, video);
        
        // Move video into wrapper
        wrapper.appendChild(video);
        
        // Style video
        video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;';
        video.setAttribute('data-wrapped', 'true');
        
        // Ensure it has proper attributes
        if (!video.hasAttribute('width')) {
            video.setAttribute('width', width);
        }
        if (!video.hasAttribute('height')) {
            video.setAttribute('height', height);
        }
        
        // Add video controls if not present
        if (!video.hasAttribute('controls')) {
            video.setAttribute('controls', '');
        }
    }

#createStandardMediaWrapper(element) {
    const wrapper = document.createElement('div');
    wrapper.className = 'standard-media-wrapper';
    
    // ALWAYS use 16:9 aspect ratio for consistency
    const aspectRatio = '16 / 9';
    const maxWidth = 560;
    
    wrapper.style.cssText = 
        'position: relative; ' +
        'width: 100%; ' +
        'max-width: ' + maxWidth + 'px; ' +
        'aspect-ratio: ' + aspectRatio + '; ' +
        'margin: var(--space-md) 0; ' + // Top/bottom: 1rem, Left/right: 0
        'overflow: hidden; ' +
        'background: var(--bg-secondary); ' +
        'border-radius: var(--radius-sm); ' +
        'padding: 0 !important; ' +
        'box-sizing: border-box !important;';
    
    // Type-specific styling
    const src = element.src || element.dataset.src || '';
    const isYouTube = src.includes('youtube.com') || src.includes('youtu.be') || 
                      element.tagName === 'LITE-YOUTUBE';
    const isVimeo = src.includes('vimeo.com') || element.tagName === 'LITE-VIMEO';
    
    if (isYouTube) {
        wrapper.classList.add('youtube-wrapper');
        wrapper.style.background = '#000';
    } else if (isVimeo) {
        wrapper.classList.add('vimeo-wrapper');
        wrapper.style.background = '#1ab7ea';
    } else if (element.tagName === 'VIDEO') {
        wrapper.classList.add('video-wrapper');
        wrapper.style.background = '#000';
    }
    
    return wrapper;
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

        while ((node = walker.nextNode())) {
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

        while ((node = walker.nextNode())) {
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
        } else {
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
        if (post.classList.contains('post_queue')) {
            return;
        }

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
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';
        });

        const dismissTimer = setTimeout(() => {
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';

            notification.addEventListener('transitionend', () => {
                notification.remove();
            }, { once: true });
        }, 2000);

        notification.style.pointerEvents = 'auto';
        notification.style.cursor = 'pointer';
        notification.addEventListener('click', () => {
            clearTimeout(dismissTimer);
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';

            notification.addEventListener('transitionend', () => {
                notification.remove();
            }, { once: true });
        });
    }

#enhanceReputationSystem() {
    document.addEventListener('click', (e) => {
        const pointsUp = e.target.closest('.points_up');
        const pointsDown = e.target.closest('.points_down');
        const bulletDelete = e.target.closest('.bullet_delete');
        const pointsLink = e.target.closest('.points a[href*="CODE=votes"]');
        const pointsContainer = e.target.closest('.points');
        
        // Handle undo (bullet_delete) clicks
        if (bulletDelete && pointsContainer) {
            e.preventDefault();
            e.stopPropagation();
            
            // Find the original onclick attribute and execute it
            const onclickAttr = bulletDelete.getAttribute('onclick');
            if (onclickAttr) {
                try {
                    // Execute the onclick function
                    new Function(onclickAttr)();
                } catch (error) {
                    console.error('Error executing undo action:', error);
                }
            }
            
            // Update active states after undo
            setTimeout(() => {
                this.#updatePointsContainerActiveState(pointsContainer);
            }, 100);
            
            return;
        }
        
        // Handle points link (view votes) clicks
        if (pointsLink && pointsLink.getAttribute('rel') === '#overlay') {
            e.preventDefault();
            // Let the overlay handler work normally
            return;
        }
        
        if (pointsUp || pointsDown) {
            const pointsContainer = (pointsUp || pointsDown).closest('.points');
            const bulletDelete = pointsContainer ? pointsContainer.querySelector('.bullet_delete') : null;

            if (bulletDelete) {
                // Already voted state - handle differently
                if (pointsUp) {
                    pointsContainer.querySelector('.points_down')?.classList.remove('active');
                    pointsUp.classList.add('active');
                    
                    // Trigger undo when clicking active thumbs up?
                    if (pointsUp.classList.contains('active') && bulletDelete) {
                        bulletDelete.click();
                    }
                }

                if (pointsDown) {
                    pointsContainer.querySelector('.points_up')?.classList.remove('active');
                    pointsDown.classList.add('active');
                    
                    // Trigger undo when clicking active thumbs down?
                    if (pointsDown.classList.contains('active') && bulletDelete) {
                        bulletDelete.click();
                    }
                }
            } else {
                // Not voted yet - handle normal voting
                if (pointsUp) {
                    pointsContainer.querySelector('.points_down')?.classList.remove('active');
                    pointsUp.classList.add('active');
                    
                    // Trigger the original vote action
                    const voteLink = pointsContainer.querySelector('a.points_up');
                    if (voteLink) {
                        const onclick = voteLink.getAttribute('onclick');
                        if (onclick) {
                            setTimeout(() => new Function(onclick)(), 10);
                        }
                    }
                }

                if (pointsDown) {
                    pointsContainer.querySelector('.points_up')?.classList.remove('active');
                    pointsDown.classList.add('active');
                    
                    // Trigger the original vote action
                    const voteLink = pointsContainer.querySelector('a.points_down');
                    if (voteLink) {
                        const onclick = voteLink.getAttribute('onclick');
                        if (onclick) {
                            setTimeout(() => new Function(onclick)(), 10);
                        }
                    }
                }
            }
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
            document.querySelectorAll(selector).forEach(el => {
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
        if (post.classList.contains('post_queue')) {
            return;
        }
        
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
        document.querySelectorAll('div[align="center"]:has(.code_top):not(.code-modernized)').forEach(container => {
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
            this.#codeBlockObserverId, this.#attachmentObserverId,
            this.#embeddedLinkObserverId, this.#summaryObserverId];

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
    var bodyId = document.body.id;
    var shouldModernize = bodyId === 'topic' || bodyId === 'search' || bodyId === 'blog' || bodyId === 'send';
    
    if (!shouldModernize) {
        console.log('Post Modernizer skipped for body#' + bodyId);
        return;
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
