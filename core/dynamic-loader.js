"use strict";

document.documentElement.lang = "en";

// ============================================================================
// CONSTANTS
// ============================================================================
const CONTENT_PAGE_IDS = Object.freeze(['topic', 'send', 'search', 'blog']);

const STYLESHEETS = Object.freeze([
    "https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.css",
    "https://cdnjs.cloudflare.com/ajax/libs/lite-youtube-embed/0.3.3/lite-yt-embed.min.css"
]);

const IDLE_TIMEOUT_SLICK = 500;
const IDLE_TIMEOUT_ENHANCEMENTS = 800;

// ============================================================================
// 1. STYLESHEETS
// ============================================================================
STYLESHEETS.forEach(url => {
    const n = document.createElement("link");
    Object.assign(n, { rel: "preload", as: "style", href: url });
    const t = document.createElement("link");
    Object.assign(t, { rel: "stylesheet", href: url, media: "print" });
    t.onload = () => { t.media = "all"; };
    document.head.append(n, t);
});

// ============================================================================
// 2. SCRIPT LOADER ENGINE
// ============================================================================
function loadScript(src, isModule = false) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;

        const fileName = src.split('/').pop()
                           .replace(/\.min\.(js|css)$/, '.$1')
                           .replace(/\.(js|css)$/, '');

        if (isModule || fileName === 'media-optimizer') {
            script.type = 'module';
        } else {
            script.defer = fileName !== 'event-bus';
        }

        script.crossOrigin = "anonymous";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed: ${src}`));
        document.head.appendChild(script);
    });
}

// ============================================================================
// 3. UTILITY
// ============================================================================
function scheduleWork(callback, timeout = 0) {
    if (window.requestIdleCallback) {
        requestIdleCallback(callback, { timeout });
    } else {
        setTimeout(callback, Math.max(0, timeout / 2));
    }
}

// ============================================================================
// 4. LCP HELPERS
// ============================================================================
function injectCriticalCSS() {
    const style = document.createElement('style');
    style.textContent = `
        .slick_carousel .slick-slide:first-child,
        .slick_carousel .slick-slide[data-slick-index="0"] {
            opacity: 1 !important;
        }
    `;
    document.head.appendChild(style);
}

function preloadLCPImage() {
    const heroImg = document.querySelector('.slick_carousel .slick-slide:first-child img');
    if (heroImg && heroImg.src) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = heroImg.src;
        link.fetchPriority = 'high';
        document.head.appendChild(link);
    }
}

// ============================================================================
// 5. LIGHTGALLERY LOADER (unchanged)
// ============================================================================
function injectStylesheet(url) {
    const preload = document.createElement("link");
    Object.assign(preload, { rel: "preload", as: "style", href: url });
    const link = document.createElement("link");
    Object.assign(link, { rel: "stylesheet", href: url, media: "print" });
    link.onload = () => { link.media = "all"; };
    document.head.append(preload, link);
}

async function loadLightGallery() {
    const LIGHTGALLERY_CSS = [ /* your CSS URLs */ ];
    LIGHTGALLERY_CSS.forEach(url => injectStylesheet(url));
    await Promise.allSettled([
        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@77a2243547e38cee67f93610cf59391795e8380c/lightgallery@2.7.1/lightgallery.min.js"),
        // ... other lightgallery scripts
    ]);
}

// ============================================================================
// 6. BOOT SYSTEM (TipTap removed – will be loaded by messenger)
// ============================================================================
async function bootSystem() {
    try {
        const startTime = performance.now();

        // Phase A: Foundation
        await Promise.allSettled([
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8f6a9f7f137c8f7a9e36bce00a1c5dc937269906/media-optimizer.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@1977fabb5553b0f825fa92671a03b2ae26c67702/core/event-bus.min.js")
        ]);
        injectCriticalCSS();
        preloadLCPImage();

        // Phase B: Visual core
        await Promise.allSettled([
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9681242beef6f3a2e2e4c8de461c2e6eeabec26a/core/dom-utils.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@70efe7c7bca10a5093093841f67994aef3b76819/forum_core_observer.min.js")
        ]);

        // Phase C: Libraries
        await Promise.allSettled([
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/twemoji-js/14.0.2/twemoji.min.js"),
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/lite-youtube-embed/0.3.3/lite-yt-embed.js"),
            loadScript("https://cdn.jsdelivr.net/npm/lite-vimeo-embed@0.3.0/+esm", true)
        ]);

        // Phase D: Carousel module
        await loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@aa4b053757399bdc7d19ad6e9ae0892b30922b2c/modules/slick-carousel.min.js");
        scheduleWork(() => {
            if (window.SlickCarouselModule?.initialize) window.SlickCarouselModule.initialize();
        }, IDLE_TIMEOUT_SLICK);

        // Idle: Load all other modules (including messenger, which will load TipTap itself)
        const loadEnhancements = async () => {
            await Promise.allSettled([
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c1066340cbf311e771dcbb89968413bd5cb646d2/modules/media-dimensions.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a88198b93bbc0093b0d0d64be88d2e2472e79a89/modules/twemoji.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@166baf94c99ec634efacda7561f171ab86ef0b23/modules/posts.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@403484e8351e4fd2b9f757b5c340979cf7d452b8/modules/modals.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@1275148cb90b926aba27d633c61782250f4006bc/modules/messenger.js")
            ]);
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d8425539db17a67f32a4d4990fb23d50369fcd52/core/forum-enhancer.min.js")
                .catch(err => console.warn('[Boot] Forum enhancer failed:', err));
        };
        scheduleWork(loadEnhancements, IDLE_TIMEOUT_ENHANCEMENTS);

        // Lazy social widgets and lightgallery (unchanged)
        // ... (keep your existing IntersectionObserver code for Twitter/Instagram)
        const checkAndLoadLightGallery = () => {
            if (CONTENT_PAGE_IDS.includes(document.body?.id)) loadLightGallery();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkAndLoadLightGallery);
        else checkAndLoadLightGallery();

        console.log(`[Boot] Completed in ${(performance.now() - startTime).toFixed(2)}ms`);
    } catch (err) {
        console.error('[Boot] Critical failure:', err);
    }
}

bootSystem();
