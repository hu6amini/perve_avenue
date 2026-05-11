"use strict";

document.documentElement.lang = "en";

// ============================================================================
// 1. STYLESHEETS
// ============================================================================
const STYLESHEETS = Object.freeze([
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@888654e/lightgallery@2.7.1/lightgallery.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482/lightgallery@2.7.1/lg-zoom.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c5a5f52/lightgallery@2.7.1/lg-thumbnail.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b6a816a/lightgallery@2.7.1/lg-fullscreen.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d4e08c6/lightgallery@2.7.1/lg-share.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c64ef50/lightgallery@2.7.1/lg-autoplay.min.css",
    "https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.css",
    "https://cdnjs.cloudflare.com/ajax/libs/lite-youtube-embed/0.3.3/lite-yt-embed.min.css"
]);

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

        // Extract clean filename for conditional checks (handles .min as well)
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
// 3. LCP HELPERS
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
    // Grab the first slide's image – the one that will be LCP
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
// 4. PHASED EXECUTION LOGIC
// ============================================================================
async function bootSystem() {
    try {
        // PHASE A: THE FOUNDATION
        await Promise.all([
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@954d203/media-optimizer.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8e93285/core/event-bus.min.js")
        ]);

        // ––– LCP: inject critical CSS & preload the hero image as early as possible –––
        injectCriticalCSS();
        preloadLCPImage();

        // PHASE B: VISUAL CORE (LCP)
        await Promise.all([
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@7a5f70f/core/dom-utils.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@f547323/forum_core_observer.min.js")
        ]);

        // PHASE C: LIBRARIES
        await Promise.all([
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/twemoji-js/14.0.2/twemoji.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@77a2243/lightgallery@2.7.1/lightgallery.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482/lightgallery@2.7.1/lg-zoom.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b199e98/lightgallery@2.7.1/lg-thumbnail.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8b2d601/lightgallery@2.7.1/lg-fullscreen.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@42de4d6/lightgallery@2.7.1/lg-share.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a7e3cfe/lightgallery@2.7.1/lg-autoplay.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c98180c/lightgallery@2.7.1/lg-hash.min.js"),
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/lite-youtube-embed/0.3.3/lite-yt-embed.js"),
            loadScript("https://cdn.jsdelivr.net/npm/lite-vimeo-embed@0.3.0/+esm", true)
        ]);

        // PHASE D: MODULES
        await Promise.all([
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8fc6f50/modules/media-dimensions.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d63a175/modules/twemoji.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e59079c/modules/posts.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@98563c3/modules/modals.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@f8b469e/modules/slick-carousel.min.js")
        ]);

        // ––– LCP: delay Slick initialisation so the first slide paints without JS –––
        const initSlick = () => {
            if (window.SlickCarouselModule && typeof window.SlickCarouselModule.initialize === 'function') {
                window.SlickCarouselModule.initialize();
            }
        };

        if (window.requestIdleCallback) {
            requestIdleCallback(initSlick, { timeout: 2000 });
        } else {
            setTimeout(initSlick, 100);
        }

        // PHASE E: THE ENHANCER
        setTimeout(async () => {
            await loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@6ccecbb/core/forum-enhancer.js");
            console.log('[Boot] System Fully Enhanced');
        }, 50);

        // Third Party
        ["https://platform.twitter.com/widgets.js", "https://platform.instagram.com/en_US/embeds.js"].forEach(src => {
            const s = document.createElement("script");
            s.src = src; s.async = true;
            document.head.appendChild(s);
        });

    } catch (err) {
        console.error('[Boot] Critical failure:', err);
    }
}

bootSystem();
