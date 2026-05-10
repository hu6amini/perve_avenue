"use strict";

document.documentElement.lang = "en";

// ============================================================================
// STYLESHEETS (preload + async load)
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

STYLESHEETS.forEach(function(e) {
    var n = document.createElement("link");
    n.rel = "preload";
    n.as = "style";
    n.href = e;
    var t = document.createElement("link");
    t.rel = "stylesheet";
    t.href = e;
    t.media = "print";
    t.onload = function() { t.media = "all"; };
    document.head.append(n, t);
});

// ============================================================================
// SCRIPT LOADER WITH RETRIES
// ============================================================================
function loadScript(src, retries, delayMs) {
    retries = retries || 3;
    delayMs = delayMs || 1000;
    return new Promise(function(resolve, reject) {
        var attempt = 0;
        function tryLoad() {
            var script = document.createElement('script');
            script.src = src;
            
            // SPECIAL HANDLING: Load Media Optimizer as a Module to bypass forum blocking
            if (src.includes('media-optimizer.js')) {
                script.type = 'module';
            } else {
                script.defer = true;
            }

            script.crossOrigin = "anonymous";
            script.referrerPolicy = "no-referrer";
            script.onload = function() { resolve(); };
            script.onerror = function() {
                attempt++;
                if (attempt < retries) {
                    console.warn('Failed to load ' + src + ', retrying (' + attempt + '/' + retries + ')...');
                    setTimeout(tryLoad, delayMs * attempt);
                } else {
                    console.error('Failed to load ' + src + ' after ' + retries + ' attempts');
                    reject(new Error('Script load failed: ' + src));
                }
            };
            document.head.appendChild(script);
        }
        tryLoad();
    });
}

// ============================================================================
// SCRIPT ORDER (Critical Optimizer FIRST)
// ============================================================================
const SCRIPT_URLS = [
    // 1. MEDIA OPTIMIZER: Must be #1 to hijack Image prototype early
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@954d203/media-optimizer.js",

    // 2. External libraries (required by modules)
    "https://cdnjs.cloudflare.com/ajax/libs/twemoji-js/14.0.2/twemoji.min.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@77a2243/lightgallery@2.7.1/lightgallery.min.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482/lightgallery@2.7.1/lg-zoom.min.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b199e98/lightgallery@2.7.1/lg-thumbnail.min.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8b2d601/lightgallery@2.7.1/lg-fullscreen.min.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@42de4d6/lightgallery@2.7.1/lg-share.min.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a7e3cfe/lightgallery@2.7.1/lg-autoplay.min.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c98180c/lightgallery@2.7.1/lg-hash.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/lite-youtube-embed/0.3.3/lite-yt-embed.js",
    "https://cdn.jsdelivr.net/npm/lite-vimeo-embed@0.3.0/+esm",
    
    // 3. Core utilities
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@7a5f70f/core/dom-utils.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8e93285/core/event-bus.js",
    
    // 4. Forum Core Observer
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a4ac76d/forum_core_observer.js",
    
    // 5. Modules
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@8fc6f50/modules/media-dimensions.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d63a175/modules/twemoji.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e59079c/modules/posts.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@98563c3/modules/modals.js",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@f8b469e/modules/slick-carousel.js",    
    
    // 6. Main enhancer (last)
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@6ccecbb/core/forum-enhancer.js"
];

async function loadAllScripts() {
    performance.mark('loader-start');

    // 1. Load critical scripts in PARALLEL
    const scriptPromises = SCRIPT_URLS.map(url =>
        loadScript(url, 3, 1000).then(() => {
            console.log('Loaded: ' + url);
        })
    );

    try {
        await Promise.all(scriptPromises);
    } catch (err) {
        console.error('Critical script failed:', err);
        var banner = document.createElement('div');
        banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#c00;color:#fff;padding:8px;text-align:center;z-index:99999;';
        banner.textContent = 'Forum Enhancer Error. Please refresh.';
        document.body.appendChild(banner);
        return;
    }

    performance.mark('critical-scripts-loaded');

    // 2. Platform social widgets
    var platformScripts = [
        "https://platform.twitter.com/widgets.js",
        "https://platform.instagram.com/en_US/embeds.js"
    ];
    platformScripts.forEach(src => {
        var s = document.createElement("script");
        s.src = src;
        s.async = true;
        document.head.appendChild(s);
    });

    // 3. Instant.page (Module)
    var instantPageScript = document.createElement("script");
    Object.assign(instantPageScript, {
        src: "https://cdn.jsdelivr.net/npm/instant.page@5.2.0/instantpage.min.js",
        type: "module",
        crossOrigin: "anonymous"
    });
    document.body.appendChild(instantPageScript);
}

// Preload Instant Page
var instantPagePreload = document.createElement("link");
Object.assign(instantPagePreload, {
    rel: "preload",
    as: "script",
    href: "https://cdn.jsdelivr.net/npm/instant.page@5.2.0/instantpage.min.js",
    crossOrigin: "anonymous"
});
document.head.appendChild(instantPagePreload);

// EXECUTION: Start immediately to catch early images
if (document.readyState === "complete") {
    loadAllScripts();
} else {
    // We don't wait for DOMContentLoaded because we want to catch 
    // Image prototypes before the body is fully parsed.
    loadAllScripts();
}
