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
// ULTRA-EARLY RESOURCE OPTIMIZER - Place in <head> as first script
// ULTRA-EARLY RESOURCE OPTIMIZER - Place in <head> as first script
(function() {
    'use strict';
    
    const config = {
        criticalScripts: [
            'jquery', 'modernizr', 'bootstrap', 'fontawesome',
            'react', 'vue', 'angular', 'ember',
            'gtm', 'analytics', 'facebook', 'twitter',
            'forum', 'core' 
        ],
        criticalCss: ['critical', 'inline', 'base', 'reset', 'normalize', 'main']
    };
    
    const getResourceName = (el) => {
        try {
            return el.src?.split('/').pop() || 
                   el.href?.split('/').pop() || 
                   'unknown';
        } catch {
            return 'unknown';
        }
    };
    
    const isCriticalScript = (src) => {
        if (!src) return false;
        src = src.toLowerCase();
        return config.criticalScripts.some(pattern => src.includes(pattern));
    };
    
    const isCriticalCSS = (href) => {
        if (!href) return false;
        href = href.toLowerCase();
        return config.criticalCss.some(pattern => href.includes(pattern));
    };
    
    // Process a single script element
    const optimizeScript = (script) => {
        // Skip inline scripts and already optimized ones
        if (!script.src || script.defer || script.async) return;
        
        if (!isCriticalScript(script.src)) {
            script.defer = true;
            console.debug(`[Optimizer] Deferred: ${getResourceName(script)}`);
        } else {
            console.debug(`[Optimizer] Critical (kept): ${getResourceName(script)}`);
        }
    };
    
    // Process a single link/CSS element
    const optimizeCSS = (link) => {
        if (link.rel !== 'stylesheet') return;
        
        if (!isCriticalCSS(link.href)) {
            const originalMedia = link.media || 'all';
            link.media = 'print';
            link.onload = function() {
                this.media = originalMedia;
            };
            console.debug(`[Optimizer] Async CSS: ${getResourceName(link)}`);
        } else {
            console.debug(`[Optimizer] Critical CSS: ${getResourceName(link)}`);
        }
    };
    
    // PHASE 1: Immediately process ALL existing scripts/CSS
    const processExisting = () => {
        console.debug('[Optimizer] Phase 1: Processing existing resources');
        
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            optimizeScript(scripts[i]);
        }
        
        const links = document.getElementsByTagName('link');
        for (let i = 0; i < links.length; i++) {
            optimizeCSS(links[i]);
        }
    };
    
    // PHASE 2: Watch for ANY dynamically added resources
    const watchForChanges = () => {
        console.debug('[Optimizer] Phase 2: Starting mutation observer');
        
        const domChangeWatcher = new MutationObserver((mutations) => {
            let optimized = false;
            
            mutations.forEach(mutation => {
                // Check added nodes
                mutation.addedNodes.forEach(node => {
                    // Direct script/link tags
                    if (node.nodeName === 'SCRIPT') {
                        optimizeScript(node);
                        optimized = true;
                    } else if (node.nodeName === 'LINK') {
                        optimizeCSS(node);
                        optimized = true;
                    }
                    
                    // Check for nested scripts/links
                    if (node.querySelectorAll) {
                        node.querySelectorAll('script').forEach(optimizeScript);
                        node.querySelectorAll('link[rel="stylesheet"]').forEach(optimizeCSS);
                    }
                });
                
                // Check for changes to existing nodes (like innerHTML updates)
                if (mutation.type === 'childList' && mutation.target.querySelectorAll) {
                    mutation.target.querySelectorAll('script').forEach(optimizeScript);
                    mutation.target.querySelectorAll('link[rel="stylesheet"]').forEach(optimizeCSS);
                }
            });
            
            if (optimized) {
                console.debug('[Optimizer] Optimized dynamically added resources');
            }
        });
        
        // Start watching the document
        domChangeWatcher.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: false
        });
        
        return domChangeWatcher;
    };
    
    // PHASE 3: Also watch for DOMContentLoaded to catch any late additions
    const watchForLateAdditions = () => {
        document.addEventListener('DOMContentLoaded', () => {
            console.debug('[Optimizer] Phase 3: DOMContentLoaded check');
            
            // Double-check all scripts again
            document.querySelectorAll('script:not([defer]):not([async])').forEach(script => {
                if (script.src && !isCriticalScript(script.src)) {
                    script.defer = true;
                    console.debug(`[Optimizer] Late deferred: ${getResourceName(script)}`);
                }
            });
            
            // Double-check all CSS
            document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                if (!isCriticalCSS(link.href) && link.media !== 'print') {
                    const originalMedia = link.media || 'all';
                    link.media = 'print';
                    link.onload = function() {
                        this.media = originalMedia;
                    };
                    console.debug(`[Optimizer] Late async CSS: ${getResourceName(link)}`);
                }
            });
        });
    };
    
    // Force this script to run before anything else
    if (document.currentScript) {
        document.currentScript.setAttribute('async', 'false');
        document.currentScript.setAttribute('defer', 'false');
    }
    
    // Run Phase 1 immediately (synchronously)
    processExisting();
    
    // Start Phase 2 (asynchronous observer)
    const domChangeWatcher = watchForChanges();
    
    // Setup Phase 3
    watchForLateAdditions();
    
    console.debug('[Optimizer] Initialized and ready');
    
    // Optional: Expose watcher for debugging
    if (window.__DEV__) {
        window.__resourceWatcher = domChangeWatcher;
    }
})();
