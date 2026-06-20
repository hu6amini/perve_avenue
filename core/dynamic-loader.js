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
// 1. STYLESHEETS (global – no lightgallery)
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
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

// ----------------------------------------------------------------------------
// Optional: load multiple scripts sequentially
// ----------------------------------------------------------------------------
async function loadScriptsSequentially(sources) {
    for (const src of sources) {
        await loadScript(src);
    }
}

// ============================================================================
// 3. UTILITY: schedule work during idle time
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
        /* Ensure first carousel slide is visible before Slick initialises */
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
// 5. CONDITIONAL LIGHTGALLERY LOADING (only on content pages)
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
    const LIGHTGALLERY_CSS = [
        "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@2155573db031dc1f30c32e107dbec11876498c07/lightgallery@2.7.1/lightgallery.min.css",
        "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482dc929aec9979f410815e3bf7bdc233da7/lightgallery@2.7.1/lg-zoom.min.css",
        "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c5a5f520f3985fb7ef4d90892360aba8bf55a2c0/lightgallery@2.7.1/lg-thumbnail.min.css",
        "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b6a816af149a4736f9ee02135f35997b7c03eb4d/lightgallery@2.7.1/lg-fullscreen.min.css",
        "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d4e08c60945a1d195666f212ada2df73eced5447/lightgallery@2.7.1/lg-share.min.css",
        "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c64ef501230b0ff4e87c4be912ba83686da2a8e6/lightgallery@2.7.1/lg-autoplay.min.css"
    ];

    LIGHTGALLERY_CSS.forEach(url => injectStylesheet(url));

    const results = await Promise.allSettled([
        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@77a2243547e38cee67f93610cf59391795e8380c/lightgallery@2.7.1/lightgallery.min.js"),
        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482dc929aec9979f410815e3bf7bdc233da7/lightgallery@2.7.1/lg-zoom.min.js"),
        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b199e98bff31d5d7d4cf359f779edc7a09ac2086/lightgallery@2.7.1/lg-thumbnail.min.js"),
        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8b2d601281752a66afad3bd04a7a084365b9d2a4/lightgallery@2.7.1/lg-fullscreen.min.js"),
        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@42de4d63b84c47559296db9d026f39970d8f77c7/lightgallery@2.7.1/lg-share.min.js"),
        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a7e3cfe5755e6520972b53e8f0563d0b88771e5a/lightgallery@2.7.1/lg-autoplay.min.js"),
        loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c98180cb5d0223215fbcce99520b806470836e40/lightgallery@2.7.1/lg-hash.min.js")
    ]);

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
        console.warn('[Boot] Some lightgallery modules failed to load:', failed);
    }
}

// ============================================================================
// 6. PHASED EXECUTION (NO TIPTAP – messenger loads it via import)
// ============================================================================
async function bootSystem() {
    try {
        const startTime = performance.now();

        // PHASE A: Foundation (media optimizer & event bus)
        const phaseAStart = performance.now();
        const resultsA = await Promise.allSettled([
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8f6a9f7f137c8f7a9e36bce00a1c5dc937269906/media-optimizer.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@1977fabb5553b0f825fa92671a03b2ae26c67702/core/event-bus.min.js")
        ]);
        const failedA = resultsA.filter(r => r.status === 'rejected');
        if (failedA.length > 0) {
            console.error('[Boot] Phase A failures – system may not function correctly:', failedA);
        }
        console.debug(`[Boot] Phase A completed in ${(performance.now() - phaseAStart).toFixed(2)}ms`);

        injectCriticalCSS();
        preloadLCPImage();

        // PHASE B: Visual core (Slick, DOM utils, Forum Observer)
        const phaseBStart = performance.now();
        const resultsB = await Promise.allSettled([
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9681242beef6f3a2e2e4c8de461c2e6eeabec26a/core/dom-utils.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@70efe7c7bca10a5093093841f67994aef3b76819/forum_core_observer.min.js")
        ]);
        const failedB = resultsB.filter(r => r.status === 'rejected');
        if (failedB.length > 0) {
            console.warn('[Boot] Phase B had failures:', failedB);
        }
        console.debug(`[Boot] Phase B completed in ${(performance.now() - phaseBStart).toFixed(2)}ms`);

        // PHASE C: Third‑party libraries (twemoji, lite-youtube, lite-vimeo)
        const phaseCStart = performance.now();
        const resultsC = await Promise.allSettled([
            loadScript("https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js"),
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/lite-youtube-embed/0.3.3/lite-yt-embed.js"),
            loadScript("https://cdn.jsdelivr.net/npm/lite-vimeo-embed@0.3.0/+esm", true)
        ]);
        const failedC = resultsC.filter(r => r.status === 'rejected');
        if (failedC.length > 0) {
            console.warn('[Boot] Phase C had failures:', failedC);
        }
        console.debug(`[Boot] Phase C completed in ${(performance.now() - phaseCStart).toFixed(2)}ms`);

        // PHASE D: Essential module – carousel handling
        const phaseDStart = performance.now();
        try {
            await loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@aa4b053757399bdc7d19ad6e9ae0892b30922b2c/modules/slick-carousel.min.js");
            console.debug(`[Boot] Phase D completed in ${(performance.now() - phaseDStart).toFixed(2)}ms`);
        } catch (err) {
            console.error('[Boot] Phase D critical failure:', err);
        }

        // Initialise Slick carousel after a short idle delay
        const initSlick = () => {
            if (window.SlickCarouselModule && typeof window.SlickCarouselModule.initialize === 'function') {
                window.SlickCarouselModule.initialize();
                console.debug('[Boot] Slick carousel initialized');
            }
        };
        scheduleWork(initSlick, IDLE_TIMEOUT_SLICK);

        // ============================================================
        // IDLE LOAD: All remaining enhancement modules (including messenger)
        // Messenger will load TipTap dynamically via ES modules.
        // ============================================================
        const loadEnhancements = async () => {
            const enhStart = performance.now();

            const results = await Promise.allSettled([
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@11588f18d3c85bfe9998aea25a0ad1412492c188/modules/media-dimensions.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a88198b93bbc0093b0d0d64be88d2e2472e79a89/modules/twemoji.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b0f473583279dba7a4c884fced43005a61726b69/modules/posts.min.js"),
                loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@403484e8351e4fd2b9f757b5c340979cf7d452b8/modules/modals.min.js")
            ]);

            const failed = results.filter(r => r.status === 'rejected');
            if (failed.length > 0) {
                console.warn('[Boot] Enhancement load had failures:', failed);
            }
            console.debug(`[Boot] Enhancements loaded in ${(performance.now() - enhStart).toFixed(2)}ms`);

            // Finally, load the Forum Enhancer which registers everything
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d8425539db17a67f32a4d4990fb23d50369fcd52/core/forum-enhancer.min.js")
                .then(() => console.log('[Boot] System Fully Enhanced'))
                .catch(err => console.warn('[Boot] Forum enhancer failed to load:', err));
        };

        scheduleWork(loadEnhancements, IDLE_TIMEOUT_ENHANCEMENTS);

        // ============================================================
        // LAZY LOAD: Social widgets (Twitter/Instagram) when they become visible
        // ============================================================
        const tweetEl = document.querySelector('.twitter-tweet, .twitter-timeline, [data-twitter]');
        if (tweetEl) {
            const tweetObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const s = document.createElement('script');
                        s.src = 'https://platform.twitter.com/widgets.js';
                        s.async = true;
                        document.head.appendChild(s);
                        tweetObserver.disconnect();
                        console.debug('[Boot] Twitter widgets loaded');
                    }
                });
            }, { rootMargin: '200px' });
            tweetObserver.observe(tweetEl);
        }

        const instagramEl = document.querySelector('.instagram-media, .instagram-embed, [data-instagram]');
        if (instagramEl) {
            const instagramObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const s = document.createElement("script");
                        s.src = "https://platform.instagram.com/en_US/embeds.js";
                        s.async = true;
                        document.head.appendChild(s);
                        instagramObserver.disconnect();
                        console.debug('[Boot] Instagram embeds loaded');
                    }
                });
            }, { rootMargin: '200px' });
            instagramObserver.observe(instagramEl);
        }

        // Load LightGallery only on content pages (topic, send, search, blog)
        const checkAndLoadLightGallery = () => {
            const id = document.body?.id;
            if (CONTENT_PAGE_IDS.includes(id)) {
                loadLightGallery().catch(err => console.error('[Boot] LightGallery failed:', err));
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', checkAndLoadLightGallery, { once: true });
        } else {
            checkAndLoadLightGallery();
        }

        console.log(`[Boot] System initialization completed in ${(performance.now() - startTime).toFixed(2)}ms`);
    } catch (err) {
        console.error('[Boot] Critical failure:', err);
    }
}

// Start the boot process
bootSystem();
