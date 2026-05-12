// =============================================
// MEDIA DIMENSION EXTRACTOR - Module version
// Waits for Weserv optimizer and forum observer
// =============================================

'use strict';

// ===== USER TIMING: mark script start =====
if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark('media-dimensions-start');
}
// ==========================================

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
    #pendingImages = new Set();
    #weservReady = false;
    #initStarted = false;
    #observerReady = false;

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
    
    static #EMOJI_SIZE_NORMAL = 20;
    static #EMOJI_SIZE_SMALL = 18;
    static #EMOJI_SIZE_H1 = 35;
    static #EMOJI_SIZE_H2 = 29;
    static #EMOJI_SIZE_H3 = 24;
    static #EMOJI_SIZE_H4 = 20;
    static #EMOJI_SIZE_H5 = 18;
    static #EMOJI_SIZE_H6 = 16;
    static #BROKEN_IMAGE_SIZE = { width: 600, height: 400 };
    static #BATCH_SIZE = 50;

    constructor() {
        this.#imageLoadHandler = this.#handleImageLoad.bind(this);
        this.#cacheContextElements();
    }

    async #waitForDependencies() {
        // Wait for forum observer
        if (!globalThis.forumObserver) {
            await new Promise((resolve) => {
                const handler = () => {
                    window.removeEventListener('forum-observer-ready', handler);
                    resolve();
                };
                window.addEventListener('forum-observer-ready', handler);
                setTimeout(resolve, 5000);
            });
        }
        this.#observerReady = true;
        
        // Wait for Weserv
        const processedImages = document.querySelectorAll('img[data-optimized="true"]');
        if (processedImages.length > 0) {
            this.#weservReady = true;
            return;
        }
        
        await new Promise((resolve) => {
            const handler = () => {
                window.removeEventListener('weserv-ready', handler);
                resolve();
            };
            window.addEventListener('weserv-ready', handler);
            setTimeout(resolve, 3000);
        });
        this.#weservReady = true;
    }

    async #init() {
        await this.#waitForDependencies();
        
        this.#setupObserver();
        this.#cacheContextElements();
        
        if (this.#pendingImages.size > 0) {
            console.log('Processing ' + this.#pendingImages.size + ' pending images');
            this.#pendingImages.forEach(img => {
                if (img.isConnected) {
                    this.#processImage(img);
                }
            });
            this.#pendingImages.clear();
        }
        
        // Dispatch ready event
        queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent('dimension-extractor-ready', {
                detail: { timestamp: Date.now() }
            }));
            console.log('📐 Dimension extractor ready');

            // ===== USER TIMING: ready and measure =====
            if (typeof performance !== 'undefined' && performance.mark) {
                performance.mark('media-dimensions-ready');
                try {
                    performance.measure('media-dimensions-load-time', 'media-dimensions-start', 'media-dimensions-ready');
                } catch (e) {
                    // Ignore if marks missing
                }
            }
            // ==========================================
        });
    }

    #cacheContextElements() {
        this.#smallContextElements = new Set(
            document.querySelectorAll(MediaDimensionExtractor.#SMALL_CONTEXT_SELECTORS)
        );
    }

    #setupObserver() {
        if (!globalThis.forumObserver) return;
        
        this.#observerId = globalThis.forumObserver.register({
            id: 'media-dimension-extractor',
            callback: (node) => {
                this.#processMedia(node);
            },
            selector: 'img, iframe, video',
            priority: 'high'
        });
        
        this.#processAllMediaBatched();
    }

    #processAllMediaBatched() {
        const batches = [
            document.images,
            document.getElementsByTagName('iframe'),
            document.getElementsByTagName('video')
        ];
        
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
        if (!node || !node.isConnected) return;
        if (this.#processedMedia.has(node)) return;

        const tag = node.tagName;
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
                this.#processNestedMedia(node);
        }
    }

    #processNestedMedia(node) {
        if (!node || !node.isConnected) return;
        if (this.#isInsideProseMirror(node)) return;
        
        const images = node.getElementsByTagName('img');
        const iframes = node.getElementsByTagName('iframe');
        const videos = node.getElementsByTagName('video');

        for (let i = 0, len = images.length; i < len; i++) {
            const img = images[i];
            if (this.#isInsideProseMirror(img)) continue;
            if (img.isConnected && !this.#processedMedia.has(img)) {
                this.#processImage(img);
            }
        }
        
        for (let i = 0, len = iframes.length; i < len; i++) {
            const iframe = iframes[i];
            if (iframe.isConnected && !this.#processedMedia.has(iframe)) {
                this.#processIframe(iframe);
            }
        }
        
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
        return element.closest('.tiptap, .ProseMirror') !== null;
    }

    #processImage(img) {
        if (this.#isInsideProseMirror(img)) return;
        
        const isTwemoji = img.src.includes('twemoji') || 
                        img.classList.contains('twemoji') ||
                        img.classList.contains('emoji') ||
                        (img.alt && (img.alt.includes(':)') || img.alt.includes(':(') || img.alt.includes('emoji')));
        
        if (isTwemoji) {
            let size = MediaDimensionExtractor.#EMOJI_SIZE_NORMAL;
            
            if (this.#isInSmallContext(img)) {
                size = MediaDimensionExtractor.#EMOJI_SIZE_SMALL;
            } else {
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
            
            img.removeAttribute('width');
            img.removeAttribute('height');
            img.setAttribute('width', size);
            img.setAttribute('height', size);
            
            let currentStyle = img.style.cssText || '';
            if (currentStyle) {
                currentStyle = currentStyle
                    .replace(/width[^;]*;/g, '')
                    .replace(/height[^;]*;/g, '')
                    .replace(/max-width[^;]*;/g, '')
                    .replace(/max-height[^;]*;/g, '');
                img.style.cssText = currentStyle;
            }
            img.style.aspectRatio = size + ' / ' + size;
            img.style.display = 'inline-block';
            img.style.verticalAlign = 'text-bottom';
            
            const cacheKey = this.#getCacheKey(img.src);
            this.#dimensionCache.delete(cacheKey);
            this.#lruMap.delete(cacheKey);
            this.#cacheDimension(img.src, size, size);
            return;
        }

        if (!this.#weservReady && !img.hasAttribute('data-optimized')) {
            this.#pendingImages.add(img);
            return;
        }

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

        const widthAttr = img.getAttribute('width');
        const heightAttr = img.getAttribute('height');

        if (widthAttr !== null && heightAttr !== null) {
            const width = widthAttr | 0;
            const height = heightAttr | 0;
            if (width > 0 && height > 0) {
                if (img.complete && img.naturalWidth) {
                    const wDiff = Math.abs(img.naturalWidth - width);
                    const hDiff = Math.abs(img.naturalHeight - height);
                    if (wDiff > width * 0.5 || hDiff > height * 0.5) {
                        this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
                        return;
                    }
                }
                img.style.aspectRatio = width + ' / ' + height;
                return;
            }
        }
        
        if (this.#isLikelyEmoji(img)) {
            const size = this.#isInSmallContext(img) ? 
                MediaDimensionExtractor.#EMOJI_SIZE_SMALL : 
                MediaDimensionExtractor.#EMOJI_SIZE_NORMAL;
            img.setAttribute('width', size);
            img.setAttribute('height', size);
            img.style.aspectRatio = size + ' / ' + size;
            this.#cacheDimension(img.src, size, size);
            return;
        }
        
        if (img.complete && img.naturalWidth) {
            this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
        } else {
            this.#setupImageLoadListener(img);
        }
    }

    #getCacheKey(src) {
        if (src.includes('twemoji')) {
            const match = src.match(/(\d+)x\1/);
            return match ? 'emoji:' + match[1] : 'emoji:default';
        }
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
        return MediaDimensionExtractor.#EMOJI_PATTERNS.some((pattern) => {
            return pattern.test(src) || pattern.test(className);
        }) || (src.includes('imgbox') && img.alt && img.alt.includes('emoji'));
    }

    #isInSmallContext(img) {
        if (!this.#smallContextElements || this.#smallContextElements.size === 0) {
            this.#cacheContextElements();
        }
        let element = img;
        while (element) {
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
                if (this.#smallContextElements && this.#smallContextElements.has(element)) {
                    return true;
                }
            }
            element = element.parentElement;
        }
        return false;
    }

    #setupImageLoadListener(img) {
        if (img.__dimensionExtractorHandler) return;
        img.__dimensionExtractorHandler = this.#imageLoadHandler;
        const signal = this.#imageLoadAbortController.signal;
        img.addEventListener('load', this.#imageLoadHandler, { once: true, signal });
        img.addEventListener('error', this.#imageLoadHandler, { once: true, signal });
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
        const currentWidth = img.getAttribute('width');
        const currentHeight = img.getAttribute('height');
        
        if (!currentWidth || currentWidth === '0' || currentWidth === 'auto') {
            img.setAttribute('width', width);
        }
        if (!currentHeight || currentHeight === '0' || currentHeight === 'auto') {
            img.setAttribute('height', height);
        }
        img.style.aspectRatio = width + '/' + height;
        img.style.removeProperty('height');
        this.#cacheDimension(img.src, width, height);
    }
    
    #cacheDimension(src, width, height) {
        const cacheKey = this.#getCacheKey(src);
        if (this.#dimensionCache.size >= this.#MAX_CACHE_SIZE) {
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

        MediaDimensionExtractor.#IFRAME_SIZES.forEach((sizes, domain) => {
            if (src.includes(domain)) {
                width = sizes[0];
                height = sizes[1];
                return true;
            }
        });

        iframe.setAttribute('width', width);
        iframe.setAttribute('height', height);

        if (width !== '100%') {
            const widthNum = width | 0;
            const heightNum = height | 0;
            if (widthNum > 0 && heightNum > 0) {
                const parent = iframe.parentNode;
                if (parent && document.contains(iframe) && !parent.classList.contains('iframe-wrapper')) {
                    try {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'iframe-wrapper';
                        const paddingBottom = (heightNum / widthNum * 100) + '%';
                        wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:' + paddingBottom + ';overflow:hidden';
                        if (parent && iframe.parentNode === parent) {
                            parent.insertBefore(wrapper, iframe);
                            wrapper.appendChild(iframe);
                            iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0';
                        }
                    } catch (e) {
                        console.debug('Iframe wrapper creation failed:', e.message);
                    }
                }
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
            video.style.width = '100%';
            video.style.maxWidth = '800px';
            video.style.height = 'auto';
        }
    }

    #cleanup() {
        if (globalThis.forumObserver && this.#observerId) {
            globalThis.forumObserver.unregister(this.#observerId);
        }
        this.#imageLoadAbortController.abort();
        const images = document.images;
        for (let i = 0, len = images.length; i < len; i++) {
            const img = images[i];
            if (img.__dimensionExtractorHandler) {
                delete img.__dimensionExtractorHandler;
            }
        }
    }

    // ===== PUBLIC API =====
    
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
        this.#processedMedia.delete(element);
        const cacheKey = this.#getCacheKey(element.src);
        if (this.#dimensionCache.has(cacheKey)) {
            this.#dimensionCache.delete(cacheKey);
            this.#lruMap.delete(cacheKey);
        }
        this.#processSingleMedia(element);
    }

    refresh() {
        console.log('Refreshing dimension extractor');
        const images = document.querySelectorAll('img:not([width])');
        images.forEach(img => {
            this.#processedMedia.delete(img);
            this.#processImage(img);
        });
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

    // Module initialisation entry point
    static async createAndInit() {
        const instance = new MediaDimensionExtractor();
        await instance.#init();
        return instance;
    }
}

// Module export (global)
var MediaDimensionsModule = {
    initialized: false,
    instance: null,
    initialize: async function() {
        if (this.initialized) return this.instance;
        this.instance = await MediaDimensionExtractor.createAndInit();
        this.initialized = true;
        return this.instance;
    },
    name: 'media-dimensions',
    dependencies: ['forumObserver']
};

// Do NOT auto-initialise; the enhancer will call initialize()
