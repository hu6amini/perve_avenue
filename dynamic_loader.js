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
// ULTRA-EARLY RESOURCE OPTIMIZER - Place in <head> as first script
(function() {
    'use strict';
    
    console.debug('[Optimizer] Initializing...');
    
    const config = {
        criticalScripts: [
            'jquery', 'modernizr', 'bootstrap', 'fontawesome',
            'react', 'vue', 'angular', 'ember',
            'gtm', 'analytics', 'facebook', 'twitter',
            'forum', 'core', 'jquery'  // Added jquery explicitly
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
    
    // Force defer on a script element
    const optimizeScript = (script) => {
        // Skip if already processed or inline
        if (!script.src || script.hasAttribute('data-optimized')) return;
        
        // Skip if already has defer/async
        if (script.defer || script.async) return;
        
        if (!isCriticalScript(script.src)) {
            script.defer = true;
            script.setAttribute('data-optimized', 'true');
            console.debug(`[Optimizer] Deferred: ${getResourceName(script)}`);
        } else {
            script.setAttribute('data-optimized', 'true');
            console.debug(`[Optimizer] Critical (kept): ${getResourceName(script)}`);
        }
    };
    
    const optimizeCSS = (link) => {
        if (link.rel !== 'stylesheet' || link.hasAttribute('data-optimized')) return;
        
        if (!isCriticalCSS(link.href)) {
            const originalMedia = link.media || 'all';
            link.media = 'print';
            link.onload = function() {
                this.media = originalMedia;
            };
            link.setAttribute('data-optimized', 'true');
            console.debug(`[Optimizer] Async CSS: ${getResourceName(link)}`);
        } else {
            link.setAttribute('data-optimized', 'true');
            console.debug(`[Optimizer] Critical CSS: ${getResourceName(link)}`);
        }
    };
    
    // PHASE 1: Scan existing DOM
    const scanExisting = () => {
        console.debug('[Optimizer] Phase 1: Scanning existing resources');
        
        // Get all scripts and links currently in the document
        document.querySelectorAll('script[src]').forEach(optimizeScript);
        document.querySelectorAll('link[rel="stylesheet"]').forEach(optimizeCSS);
    };
    
    // PHASE 2: Watch for DOM changes
    const watchDOM = () => {
        console.debug('[Optimizer] Phase 2: Starting DOM watcher');
        
        const domWatcher = new MutationObserver((mutations) => {
            let hasChanges = false;
            
            mutations.forEach(mutation => {
                // Check added nodes
                mutation.addedNodes.forEach(node => {
                    // Direct script/link tags
                    if (node.nodeName === 'SCRIPT' && node.src) {
                        optimizeScript(node);
                        hasChanges = true;
                    } else if (node.nodeName === 'LINK' && node.rel === 'stylesheet') {
                        optimizeCSS(node);
                        hasChanges = true;
                    }
                    
                    // Check for scripts/links added via innerHTML or other methods
                    if (node.nodeType === 1) { // Element node
                        const scripts = node.querySelectorAll('script[src]');
                        const links = node.querySelectorAll('link[rel="stylesheet"]');
                        
                        scripts.forEach(optimizeScript);
                        links.forEach(optimizeCSS);
                        
                        if (scripts.length || links.length) hasChanges = true;
                    }
                });
                
                // Also check for attribute changes (sometimes scripts get added via src attribute change)
                if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
                    if (mutation.target.nodeName === 'SCRIPT') {
                        optimizeScript(mutation.target);
                        hasChanges = true;
                    }
                }
            });
            
            if (hasChanges) {
                console.debug('[Optimizer] Processed newly added resources');
            }
        });
        
        // Watch the entire document for changes
        domWatcher.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'href', 'rel']
        });
        
        return domWatcher;
    };
    
    // PHASE 3: Override script creation methods
    const overrideScriptCreation = () => {
        // Save original createElement
        const originalCreateElement = document.createElement;
        
        // Override createElement for script tags
        document.createElement = function(tagName, options) {
            const element = originalCreateElement.call(this, tagName, options);
            
            if (tagName.toLowerCase() === 'script') {
                // Intercept script creation
                const originalSetAttribute = element.setAttribute;
                element.setAttribute = function(name, value) {
                    originalSetAttribute.call(this, name, value);
                    
                    if (name === 'src' && this.src && !this.hasAttribute('data-optimized')) {
                        // Small delay to let the script be added to DOM
                        setTimeout(() => optimizeScript(this), 0);
                    }
                };
                
                // Also watch property changes
                let srcValue = '';
                Object.defineProperty(element, 'src', {
                    get: function() { return srcValue; },
                    set: function(value) {
                        srcValue = value;
                        if (value && !this.hasAttribute('data-optimized')) {
                            setTimeout(() => optimizeScript(this), 0);
                        }
                    },
                    configurable: true
                });
            }
            
            return element;
        };
    };
    
    // PHASE 4: Periodic rescan (catch anything missed)
    const startPeriodicRescan = () => {
        console.debug('[Optimizer] Phase 4: Starting periodic rescan');
        
        // Rescan every 500ms for the first 3 seconds
        let scans = 0;
        const interval = setInterval(() => {
            scans++;
            
            const unoptimizedScripts = document.querySelectorAll('script[src]:not([data-optimized])');
            const unoptimizedCSS = document.querySelectorAll('link[rel="stylesheet"]:not([data-optimized])');
            
            unoptimizedScripts.forEach(optimizeScript);
            unoptimizedCSS.forEach(optimizeCSS);
            
            if (unoptimizedScripts.length || unoptimizedCSS.length) {
                console.debug(`[Optimizer] Periodic scan #${scans}: Found ${unoptimizedScripts.length} scripts, ${unoptimizedCSS.length} CSS`);
            }
            
            // Stop after 3 seconds or when no unoptimized resources left
            if (scans > 6 || (document.querySelectorAll('script[src]:not([data-optimized])').length === 0 && 
                document.querySelectorAll('link[rel="stylesheet"]:not([data-optimized])').length === 0)) {
                clearInterval(interval);
                console.debug('[Optimizer] Periodic scans complete');
            }
        }, 500);
    };
    
    // PHASE 5: Handle DOMContentLoaded and load events
    const watchEvents = () => {
        document.addEventListener('DOMContentLoaded', () => {
            console.debug('[Optimizer] DOMContentLoaded - final check');
            
            // Final scan
            document.querySelectorAll('script[src]:not([data-optimized])').forEach(optimizeScript);
            document.querySelectorAll('link[rel="stylesheet"]:not([data-optimized])').forEach(optimizeCSS);
        });
        
        window.addEventListener('load', () => {
            console.debug('[Optimizer] Window load - final check');
            
            // One last scan
            document.querySelectorAll('script[src]:not([data-optimized])').forEach(optimizeScript);
            document.querySelectorAll('link[rel="stylesheet"]:not([data-optimized])').forEach(optimizeCSS);
            
            // Report final stats
            const totalDeferred = document.querySelectorAll('script[defer][data-optimized]').length;
            const totalAsyncCSS = document.querySelectorAll('link[rel="stylesheet"][media="print"][data-optimized]').length;
            console.debug(`[Optimizer] Complete: ${totalDeferred} scripts deferred, ${totalAsyncCSS} CSS async loaded`);
        });
    };
    
    // Initialize all phases
    const init = () => {
        // Phase 1: Immediate scan
        scanExisting();
        
        // Phase 2: DOM watcher
        watchDOM();
        
        // Phase 3: Override script creation
        overrideScriptCreation();
        
        // Phase 4: Periodic rescan
        startPeriodicRescan();
        
        // Phase 5: Event listeners
        watchEvents();
        
        console.debug('[Optimizer] All systems active');
    };
    
    // Start immediately
    init();
})();
