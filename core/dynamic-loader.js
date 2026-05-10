"use strict";

document.documentElement.lang = "en";

// ============================================================================
// 1. STYLESHEETS (Non-blocking Load)
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
        if (isModule || src.includes('media-optimizer.js')) {
            script.type = 'module';
        } else {
            script.defer = true;
        }
        script.crossOrigin = "anonymous";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed: ${src}`));
        document.head.appendChild(script);
    });
}

// ============================================================================
// 3. PHASED EXECUTION LOGIC
// ============================================================================
async function bootSystem() {
    performance.mark('boot-start');

    try {
        // PHASE A: THE HIJACKER (Critical for LCP & Optimization)
        // Must finish before ANY other script starts to ensure Image prototype is caught.
        await loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@954d203/media-optimizer.js");
        console.log('[Boot] Phase A: Media Hijack Active');

        // PHASE B: VISUAL CORE (LCP Acceleration)
        // Load only what is needed to render the UI and Carousel immediately.
        await Promise.all([
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@7a5f70f/core/dom-utils.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a4ac76d/forum_core_observer.js")
        ]);
        console.log('[Boot] Phase B: Visual Core Ready');

        // PHASE C: FUNCTIONAL MODULES
        // These run in parallel while the user is looking at the LCP image.
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
        console.log('[Boot] Phase C: Libraries Loaded');

        // PHASE D: DOM ENHANCERS
        // Finally, activate your custom logic once libraries are ready.
        await Promise.all([
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8fc6f50/modules/media-dimensions.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d63a175/modules/twemoji.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e59079c/modules/posts.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@98563c3/modules/modals.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@f8b469e/modules/slick-carousel.js"),
            loadScript("https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@6ccecbb/core/forum-enhancer.js")
        ]);
        console.log('[Boot] Phase D: Enhancement Complete');

        // PHASE E: THIRD PARTY (Non-critical)
        ["https://platform.twitter.com/widgets.js", "https://platform.instagram.com/en_US/embeds.js"].forEach(src => {
            const s = document.createElement("script");
            s.src = src; s.async = true;
            document.head.appendChild(s);
        });

        // Instant.page
        const ip = document.createElement("script");
        Object.assign(ip, { src: "https://cdn.jsdelivr.net/npm/instant.page@5.2.0/instantpage.min.js", type: "module" });
        document.body.appendChild(ip);

    } catch (err) {
        console.error('[Boot] Critical failure:', err);
    }
}

// Fire immediately
bootSystem();
