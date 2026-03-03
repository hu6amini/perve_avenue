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
(function() {
    'use strict';
    
    // Run immediately - before any resources load
    const config = {
        criticalScripts: [
            'jquery', 'modernizr', 'bootstrap', 'fontawesome',
            'react', 'vue', 'angular', 'ember',
            'gtm', 'analytics', 'facebook', 'twitter',
            // Add your site-specific critical scripts
            'forum', 'core' 
        ],
        criticalCss: ['critical', 'inline', 'base', 'reset', 'normalize', 'main']
    };
    
    // Cache document methods for performance
    const doc = document;
    const head = doc.head;
    const body = doc.body; // May be null at this point
    
    // Helper to get resource name safely
    const getResourceName = (el) => {
        try {
            return el.src?.split('/').pop() || 
                   el.href?.split('/').pop() || 
                   'unknown';
        } catch {
            return 'unknown';
        }
    };
    
    // Check if script is critical (should load normally)
    const isCriticalScript = (src) => {
        if (!src) return false;
        src = src.toLowerCase();
        return config.criticalScripts.some(pattern => src.includes(pattern));
    };
    
    // Check if CSS is critical
    const isCriticalCSS = (href) => {
        if (!href) return false;
        href = href.toLowerCase();
        return config.criticalCss.some(pattern => href.includes(pattern));
    };
    
    // Process all existing script tags BEFORE they load
    const processExistingScripts = () => {
        const scripts = doc.getElementsByTagName('script');
        
        // Use standard for loop for maximum performance
        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            
            // Skip inline scripts and already optimized ones
            if (!script.src || script.defer || script.async) continue;
            
            const src = script.src;
            
            // Add appropriate attributes based on critical status
            if (!isCriticalScript(src)) {
                // Non-critical script - defer it
                script.defer = true;
                console.debug(`[Optimizer] Deferred: ${getResourceName(script)}`);
            } else {
                // Critical script - ensure it loads normally
                console.debug(`[Optimizer] Critical (kept): ${getResourceName(script)}`);
            }
        }
    };
    
    // Process CSS before they load
    const processExistingCSS = () => {
        const links = doc.getElementsByTagName('link');
        
        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            
            // Skip non-stylesheet links
            if (link.rel !== 'stylesheet') continue;
            
            const href = link.href;
            
            // Async load non-critical CSS
            if (!isCriticalCSS(href)) {
                // Store original media
                const originalMedia = link.media || 'all';
                
                // Set to print to prevent blocking
                link.media = 'print';
                
                // Switch back after load
                link.onload = function() {
                    this.media = originalMedia;
                };
                
                console.debug(`[Optimizer] Async CSS: ${getResourceName(link)}`);
            } else {
                console.debug(`[Optimizer] Critical CSS: ${getResourceName(link)}`);
            }
        }
    };
    
    // Override DOM manipulation methods to catch dynamically added scripts
    const overrideElementInsertion = () => {
        // Save original methods
        const originalAppendChild = Element.prototype.appendChild;
        const originalInsertBefore = Element.prototype.insertBefore;
        const originalReplaceChild = Element.prototype.replaceChild;
        const originalInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        
        // Override appendChild
        Element.prototype.appendChild = function(newChild) {
            if (newChild?.nodeName === 'SCRIPT' && newChild.src) {
                const script = newChild;
                if (!script.defer && !script.async && !isCriticalScript(script.src)) {
                    script.defer = true;
                    console.debug(`[Optimizer] Deferred (dynamic): ${getResourceName(script)}`);
                }
            } else if (newChild?.nodeName === 'LINK' && newChild.rel === 'stylesheet') {
                const link = newChild;
                if (!isCriticalCSS(link.href)) {
                    const originalMedia = link.media || 'all';
                    link.media = 'print';
                    link.onload = function() {
                        this.media = originalMedia;
                    };
                    console.debug(`[Optimizer] Async CSS (dynamic): ${getResourceName(link)}`);
                }
            }
            
            return originalAppendChild.call(this, newChild);
        };
        
        // Override insertBefore similarly
        Element.prototype.insertBefore = function(newChild, refChild) {
            if (newChild?.nodeName === 'SCRIPT' && newChild.src) {
                const script = newChild;
                if (!script.defer && !script.async && !isCriticalScript(script.src)) {
                    script.defer = true;
                }
            } else if (newChild?.nodeName === 'LINK' && newChild.rel === 'stylesheet') {
                const link = newChild;
                if (!isCriticalCSS(link.href)) {
                    const originalMedia = link.media || 'all';
                    link.media = 'print';
                    link.onload = function() {
                        this.media = originalMedia;
                    };
                }
            }
            
            return originalInsertBefore.call(this, newChild, refChild);
        };
        
        // Override innerHTML setter
        if (originalInnerHTML?.set) {
            Object.defineProperty(Element.prototype, 'innerHTML', {
                set: function(value) {
                    // Call original setter first
                    originalInnerHTML.set.call(this, value);
                    
                    // Then process any scripts that were added
                    if (this.nodeName === 'HEAD' || this.nodeName === 'BODY' || this === head || this === body) {
                        const scripts = this.getElementsByTagName('script');
                        for (let i = 0; i < scripts.length; i++) {
                            const script = scripts[i];
                            if (script.src && !script.defer && !script.async && !isCriticalScript(script.src)) {
                                script.defer = true;
                            }
                        }
                        
                        const links = this.getElementsByTagName('link');
                        for (let i = 0; i < links.length; i++) {
                            const link = links[i];
                            if (link.rel === 'stylesheet' && !isCriticalCSS(link.href)) {
                                const originalMedia = link.media || 'all';
                                link.media = 'print';
                                link.onload = function() {
                                    this.media = originalMedia;
                                };
                            }
                        }
                    }
                }
            });
        }
    };
    
    // Block parsing until we've processed everything
    const blockAndOptimize = () => {
        // First, process existing scripts/CSS
        processExistingScripts();
        processExistingCSS();
        
        // Then override DOM methods for future additions
        overrideElementInsertion();
        
        // Remove the blocking mechanism (if we added any)
        console.debug('[Optimizer] Initial optimization complete');
    };
    
    // Run immediately - this will block parsing temporarily
    blockAndOptimize();
    
    // Optional: Monitor performance after page load (non-blocking)
    if (window.performance?.getEntriesByType) {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                const resources = performance.getEntriesByType('resource');
                const slowResources = resources.filter(r => r.duration > 200);
                if (slowResources.length) {
                    console.debug(`[Optimizer] Found ${slowResources.length} slow resources`);
                }
            });
        }
    }
})();
