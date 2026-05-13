"use strict";

document.documentElement.lang = "en";

// ============================================================================
// 1. STYLESHEETS
// ============================================================================
const STYLESHEETS = Object.freeze([
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@ff5ef31931e77dd3d3b48d6d2795e039bb402603/lightgallery@2.7.1/lightgallery.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482dc929aec9979f410815e3bf7bdc233da7/lightgallery@2.7.1/lg-zoom.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c5a5f520f3985fb7ef4d90892360aba8bf55a2c0/lightgallery@2.7.1/lg-thumbnail.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b6a816af149a4736f9ee02135f35997b7c03eb4d/lightgallery@2.7.1/lg-fullscreen.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d4e08c60945a1d195666f212ada2df73eced5447/lightgallery@2.7.1/lg-share.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c64ef501230b0ff4e87c4be912ba83686da2a8e6/lightgallery@2.7.1/lg-autoplay.min.css",
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
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@6010a8c0698d3642e644442e0e963a0746133cbc/media-optimizer.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@1977fabb5553b0f825fa92671a03b2ae26c67702/core/event-bus.min.js")
        ]);

        // ––– LCP: inject critical CSS & preload the hero image as early as possible –––
        injectCriticalCSS();
        preloadLCPImage();

        // PHASE B: VISUAL CORE (LCP)
        await Promise.all([
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9681242beef6f3a2e2e4c8de461c2e6eeabec26a/core/dom-utils.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@656799812d69040e171f0dbdf75e04c84e0a770b/forum_core_observer.min.js")
        ]);

        // PHASE C: LIBRARIES
        await Promise.all([
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/twemoji-js/14.0.2/twemoji.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@77a2243547e38cee67f93610cf59391795e8380c/lightgallery@2.7.1/lightgallery.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482dc929aec9979f410815e3bf7bdc233da7/lightgallery@2.7.1/lg-zoom.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b199e98bff31d5d7d4cf359f779edc7a09ac2086/lightgallery@2.7.1/lg-thumbnail.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8b2d601281752a66afad3bd04a7a084365b9d2a4/lightgallery@2.7.1/lg-fullscreen.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@42de4d63b84c47559296db9d026f39970d8f77c7/lightgallery@2.7.1/lg-share.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a7e3cfe5755e6520972b53e8f0563d0b88771e5a/lightgallery@2.7.1/lg-autoplay.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c98180cb5d0223215fbcce99520b806470836e40/lightgallery@2.7.1/lg-hash.min.js"),
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/lite-youtube-embed/0.3.3/lite-yt-embed.js"),
            loadScript("https://cdn.jsdelivr.net/npm/lite-vimeo-embed@0.3.0/+esm", true)
        ]);

        // PHASE D: MODULES
        await Promise.all([
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@1855935f5e479985ea90ee101b275386597e72af/modules/media-dimensions.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@373aa7b49ab74b6f35c9ef229b2b34d70165bb4a/modules/twemoji.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@9efe8fc7eba649566cd98b945f0311dcb40c3abe/modules/posts.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@403484e8351e4fd2b9f757b5c340979cf7d452b8/modules/modals.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@f8b469eb5776b3ad978e549b9921b0929a371c41/modules/slick-carousel.min.js")
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
            await loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@3bb60f894525b563f9e7f8da8980e1eb90d6fce0/core/forum-enhancer.min.js");
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
