// =============================================
// MEDIA DIMENSION EXTRACTOR - Skips all post images
// =============================================

'use strict';

class MediaDimensionExtractor {
    #processedMedia = new WeakSet();
    #postCache = new WeakMap();

    constructor() {
        // Initialization logic
    }

    // Memoized check for post status to keep the UI thread fast
    #isInsidePost(element) {
        if (this.#postCache.has(element)) return this.#postCache.get(element);
        
        // Skip elements inside posts as per your architectural requirement
        const result = element.closest?.('.post, .post-card') !== null;
        this.#postCache.set(element, result);
        return result;
    }

    #processSingleMedia(media) {
        if (!media || !media.isConnected || this.#processedMedia.has(media)) return;
        if (this.#isInsidePost(media)) return;

        // Security: Validate protocol to prevent potential javascript: URI injection
        if (media.src && media.src.startsWith('javascript:')) return;

        const tag = media.tagName;
        if (tag === 'IMG') this.#processImage(media);
        else if (tag === 'IFRAME') this.#processIframe(media);
        
        this.#processedMedia.add(media);
    }

    #processImage(img) {
        if (img.complete && img.naturalWidth) {
            this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
        } else {
            // Immediate listener setup for non-cached or lazy-loaded images
            const handler = (e) => {
                img.removeEventListener('load', handler);
                img.removeEventListener('error', handler);
                this.#setImageDimensions(img, img.naturalWidth || 600, img.naturalHeight || 400);
            };
            img.addEventListener('load', handler, { once: true });
            img.addEventListener('error', handler, { once: true });
        }
    }

    #setImageDimensions(img, width, height) {
        img.setAttribute('width', width);
        img.setAttribute('height', height);
        img.style.aspectRatio = `${width}/${height}`;
        this.#processedMedia.add(img);
    }

    // Public API: Trigger this whenever content is injected into the DOM
    scanNow() {
        const media = document.querySelectorAll('img, iframe, video');
        media.forEach(el => this.#processSingleMedia(el));
    }
}

// Module Registration (Global)
var MediaDimensionsModule = {
    initialized: false,
    instance: null,
    initialize: async function() {
        if (this.initialized) return this.instance;
        this.instance = new MediaDimensionExtractor();
        this.instance.scanNow(); // Trigger initial full scan on boot
        
        // Optional: Listen for your dynamic-loader events to auto-scan new content
        if (typeof ForumEventBus !== 'undefined') {
            ForumEventBus.on('content:injected', () => {
                this.instance.scanNow();
            });
        }
        
        this.initialized = true;
        return this.instance;
    }
};

// DO NOT auto-initialise; the enhancer will call initialize()
