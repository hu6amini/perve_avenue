document.documentElement.lang = "en";

const STYLESHEETS = Object.freeze([
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@888654e/lightgallery@2.7.1/lightgallery.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e44a482/lightgallery@2.7.1/lg-zoom.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c5a5f52/lightgallery@2.7.1/lg-thumbnail.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@b6a816a/lightgallery@2.7.1/lg-fullscreen.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@d4e08c6/lightgallery@2.7.1/lg-share.min.css",
    "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@c64ef50/lightgallery@2.7.1/lg-autoplay.min.css",
    "https://cdnjs.cloudflare.com/ajax/libs/slick-carousel/1.9.0/slick.min.css",
    "https://cdnjs.cloudflare.com/ajax/libs/lite-youtube-embed/0.3.3/lite-yt-embed.min.css"
    // No separate Vimeo CSS needed - it's bundled in the +esm version
]);

STYLESHEETS.forEach((e) => {
    const n = document.createElement("link");
    n.rel = "preload";
    n.as = "style";
    n.href = e;
    const t = document.createElement("link");
    t.rel = "stylesheet";
    t.href = e;
    t.media = "print";
    t.onload = () => t.media = "all";
    document.head.append(n, t);
});

const instantPagePreload = document.createElement("link");
Object.assign(instantPagePreload, {
    rel: "preload",
    as: "script",
    href: "https://cdn.jsdelivr.net/npm/instant.page@5.2.0/instantpage.min.js",
    crossOrigin: "anonymous"
});
document.head.appendChild(instantPagePreload);

(() => {
    const e = () => {
        const e = Object.freeze([
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
            // Add Vimeo ES module - special handling needed
            "https://cdn.jsdelivr.net/npm/lite-vimeo-embed@0.3.0/+esm",
            "https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.30.1/moment.min.js",
            "https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.6.0/moment-timezone-with-data.min.js"
        ]);
        
        requestIdleCallback(() => {
            // Load main scripts with defer (they need to execute in order)
            const n = e.map((e) => new Promise((n, t) => {
                const s = document.createElement("script");
                
                // Special handling for ES module
                if (e.includes('+esm')) {
                    Object.assign(s, {
                        src: e,
                        type: 'module', // ES module
                        crossOrigin: "anonymous",
                        referrerPolicy: "no-referrer",
                        onload: n,
                        onerror: t
                    });
                    // ES modules are deferred by default - no need for defer attribute
                } else {
                    Object.assign(s, {
                        src: e,
                        defer: true, // Regular scripts use defer
                        crossOrigin: "anonymous",
                        referrerPolicy: "no-referrer",
                        onload: n,
                        onerror: t
                    });
                }
                
                document.head.appendChild(s);
            }));
            
            Promise.allSettled(n).finally(() => {
                // Load platform scripts with async (they're self-contained and don't depend on order)
                // They load after main libraries but before forum enhancer
                const platformScripts = [
                    "https://platform.twitter.com/widgets.js",
                    "https://platform.instagram.com/en_US/embeds.js"
                ];
                
                platformScripts.forEach((src) => {
                    const script = document.createElement("script");
                    Object.assign(script, {
                        src: src,
                        async: true,
                        // No defer - these should execute as soon as they load
                        // They'll be non-blocking due to async
                        referrerPolicy: "no-referrer"
                    });
                    document.head.appendChild(script);
                });
                
                // Add forum_core_observer.js with same attributes as pa_scripts
                const forumCoreObserver = document.createElement("script");
                Object.assign(forumCoreObserver, {
                    src: "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@14835c6/forum_core_observer.js",
                    defer: true,
                    crossOrigin: "anonymous",
                    referrerPolicy: "no-referrer"
                });
                document.head.appendChild(forumCoreObserver);
                
                // Add forum_enhacer.js with same attributes as pa_scripts
                const forumEnhancer = document.createElement("script");
                Object.assign(forumEnhancer, {
                    src: "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@a238541/forum_enhancer.js",
                    defer: true,
                    crossOrigin: "anonymous",
                    referrerPolicy: "no-referrer"
                });
                document.head.appendChild(forumEnhancer);
                
                // Add instant.page script
                const instantPage = document.createElement("script");
                Object.assign(instantPage, {
                    src: "https://cdn.jsdelivr.net/npm/instant.page@5.2.0/instantpage.min.js",
                    type: "module",
                    crossOrigin: "anonymous",
                    referrerPolicy: "no-referrer"
                });
                document.body.appendChild(instantPage);
                
                // Add Google CSE script
                const googleCSE = document.createElement("script");
                Object.assign(googleCSE, {
                    src: "https://cse.google.com/cse.js?cx=45791748ee9234378",
                    async: true,
                    referrerPolicy: "no-referrer"
                });
                document.body.appendChild(googleCSE);
            });
        });
    };
    
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", e);
    } else {
        e();
    }
})();


// ============================================================================
// HOST SCRIPT DEFERRER - Added to catch and defer host-injected scripts
// This MUST remain at the very end of this file to ensure it runs after all
// other code and is ready to catch any scripts injected by the host service
// ============================================================================
(() => {
    "use strict";
    
    // Configuration for what to defer
    const DEFER_CONFIG = {
        // Scripts to defer (add patterns that match host-injected scripts)
        scriptPatterns: [
            /forumfree\.net\/.*\.js$/,
            /akcelo/,
            /google-analytics/,
            /ads\./,
            /doubleclick/,
            /amazon-adsystem/,
            /criteo/
        ],
        // Stylesheets to make non-render-blocking
        stylePatterns: [
            /forumfree\.net\/.*\.css$/,
            /akcelo/,
            /tippy/
        ]
    };

    // Store processed elements to avoid duplicate processing
    const processedElements = new WeakSet();
    
    // Function to defer a script - NEW APPROACH: use async=false instead of removing src
    const deferScript = (script) => {
        if (processedElements.has(script) || script.hasAttribute('data-deferred')) return;
        
        // Don't defer critical scripts
        if (script.src.includes('jq.js') || 
            script.src.includes('jquery') ||
            script.src.includes('jqt.js')) return;
        
        // Check if this script matches our patterns
        const shouldDefer = DEFER_CONFIG.scriptPatterns.some(pattern => 
            pattern.test(script.src)
        );
        
        if (!shouldDefer) return;
        
        // Mark as processed
        processedElements.add(script);
        script.setAttribute('data-deferred', 'true');
        
        // FIX: Use async=false to make it load without blocking, but preserve src
        // This tells the browser to load asynchronously but execute in order
        script.async = false;
        script.defer = true;
        
        // No src removal - this keeps the dynamic loader happy
        
        if (window.DEFER_DEBUG) {
            console.log('✅ Deferred script:', script.src.split('/').pop());
        }
    };

    // Function to make stylesheet non-render-blocking
    const deferStylesheet = (link) => {
        if (processedElements.has(link) || link.hasAttribute('data-deferred')) return;
        
        const shouldDefer = DEFER_CONFIG.stylePatterns.some(pattern => 
            pattern.test(link.href)
        );
        
        if (!shouldDefer) return;
        
        processedElements.add(link);
        link.setAttribute('data-deferred', 'true');
        
        // Convert to non-blocking stylesheet
        link.media = 'print';
        link.onload = () => {
            link.media = 'all';
        };
        link.onerror = () => {
            link.media = 'all'; // Fallback if load fails
        };
        
        if (window.DEFER_DEBUG) {
            console.log('✅ Deferred stylesheet:', link.href.split('/').pop());
        }
    };

    // Function to process new elements
    const processNode = (node) => {
        if (node.nodeType === 1) { // Element node
            if (node.tagName === 'SCRIPT' && node.src && !node.hasAttribute('data-deferred')) {
                deferScript(node);
            } else if (node.tagName === 'LINK' && 
                       node.rel === 'stylesheet' && 
                       node.href &&
                       !node.hasAttribute('data-deferred')) {
                deferStylesheet(node);
            }
            
            // Process children for elements added with nested content
            if (node.querySelectorAll) {
                node.querySelectorAll('script[src]:not([data-deferred])').forEach(deferScript);
                node.querySelectorAll('link[rel="stylesheet"]:not([data-deferred])').forEach(deferStylesheet);
            }
        }
    };

    // Create MutationObserver with unique variable name
    const resourceObserver = new MutationObserver((mutations) => {
        // Process all mutations immediately
        for (const mutation of mutations) {
            // Process added nodes
            for (const node of mutation.addedNodes) {
                processNode(node);
            }
        }
    });

    // Start observing with childList only (faster)
    resourceObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // Process any existing elements that might have been added before observer started
    // Use requestIdleCallback for this if available, otherwise fallback to setTimeout
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            document.querySelectorAll('script[src]:not([data-deferred])').forEach(deferScript);
            document.querySelectorAll('link[rel="stylesheet"]:not([data-deferred])').forEach(deferStylesheet);
        }, { timeout: 1000 });
    } else {
        setTimeout(() => {
            document.querySelectorAll('script[src]:not([data-deferred])').forEach(deferScript);
            document.querySelectorAll('link[rel="stylesheet"]:not([data-deferred])').forEach(deferStylesheet);
        }, 0);
    }

    // Extra safety: microtask to catch any that might have been missed
    // This runs before the browser paints
    queueMicrotask(() => {
        document.querySelectorAll('script[src]:not([data-deferred])').forEach(deferScript);
        document.querySelectorAll('link[rel="stylesheet"]:not([data-deferred])').forEach(deferStylesheet);
    });

    // SIMPLIFIED createElement proxy - just marks scripts for processing
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
        const element = originalCreateElement.call(document, tagName);
        
        if (tagName.toLowerCase() === 'script') {
            // Store the original src setter but don't interfere with loading
            let srcValue = '';
            Object.defineProperty(element, 'src', {
                get: function() { return srcValue; },
                set: function(value) {
                    srcValue = value;
                    // Don't process immediately - let the observer handle it
                    // This prevents conflicts with dynamic loader
                },
                configurable: true
            });
        }
        
        return element;
    };

    // CLEANUP: Only remove truly empty scripts (not ones with src)
    const cleanupEmptyScripts = () => {
        document.querySelectorAll('script:not([src]):not([type="application/ld+json"]):not([type="application/json"])').forEach(script => {
            // Check if it's truly empty (no src, no inner content)
            if (!script.src && !script.innerHTML.trim()) {
                // Check if it was created by our old logic (has data-deferred but no src)
                if (script.hasAttribute('data-deferred')) {
                    script.remove();
                    if (window.DEFER_DEBUG) {
                        console.log('🧹 Removed empty deferred script tag');
                    }
                }
            }
        });
    };

    // Run cleanup after everything settles (only if needed)
    if ('requestIdleCallback' in window) {
        requestIdleCallback(cleanupEmptyScripts, { timeout: 3000 });
    } else {
        setTimeout(cleanupEmptyScripts, 2000);
    }

    // Optional: Enable debug mode to see what's being deferred
    // window.DEFER_DEBUG = true;

    console.log('🚀 Resource deferrer initialized - compatible with dynamic loader');
})();
