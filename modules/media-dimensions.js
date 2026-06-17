'use strict';

class MediaDimensionExtractor {
    #processedMedia = new WeakSet();
    #postCache = new WeakMap();

    #isInsidePost(element) {
        if (this.#postCache.has(element)) return this.#postCache.get(element);
        const result = element.closest?.('.post, .post-card') !== null;
        this.#postCache.set(element, result);
        return result;
    }

    #processSingleMedia(media) {
        if (!media || !media.isConnected || this.#processedMedia.has(media)) return;
        if (this.#isInsidePost(media)) return;
        if (media.src && media.src.startsWith('javascript:')) return;

        const tag = media.tagName;
        if (tag === 'IMG') this.#processImage(media);
        else if (tag === 'IFRAME') this.#processIframe(media);
        
        this.#processedMedia.add(media);
    }

    #processImage(img) {
        // If image has natural dimensions, apply them immediately
        if (img.complete && img.naturalWidth > 0) {
            this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
        } else {
            // Otherwise, set a listener to catch it once it loads
            const handler = () => {
                img.removeEventListener('load', handler);
                img.removeEventListener('error', handler);
                if (img.naturalWidth > 0) {
                    this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
                }
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

    scanNow() {
        const media = document.querySelectorAll('img, iframe, video');
        media.forEach(el => this.#processSingleMedia(el));
    }
}

var MediaDimensionsModule = {
    initialized: false,
    instance: null,
    initialize: async function() {
        if (this.initialized) return this.instance;
        this.instance = new MediaDimensionExtractor();
        
        // 1. Initial scan
        this.instance.scanNow();
        
        // 2. Hook into EventBus for dynamic content (Critical for your loader)
        if (typeof ForumEventBus !== 'undefined') {
            ForumEventBus.on('content:injected', () => {
                this.instance.scanNow();
            });
        }
        
        this.initialized = true;
        return this.instance;
    }
};
