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
// ULTRA-AGGRESSIVE RESOURCE OPTIMIZER - Place FIRST in <head>
(function() {
    'use strict';
    
    console.log('[OPTIMIZER] Starting - blocking parser');
    
    // Configuration - add your critical patterns
    const CRITICAL_SCRIPTS = [
        'jquery', 'modernizr', 'bootstrap', 'fontawesome',
        'react', 'vue', 'angular', 'ember',
        'gtm', 'analytics', 'facebook', 'twitter',
        'forum', 'core', 'jquery.min.js', 'jquery.js'
    ];
    
    const CRITICAL_CSS = [
        'critical', 'inline', 'base', 'reset', 'normalize', 'main'
    ];
    
    // Store original methods
    const originalCreateElement = document.createElement;
    const originalQuerySelectorAll = document.querySelectorAll;
    const originalGetElementsByTagName = document.getElementsByTagName;
    
    // Track processed scripts
    const processed = new WeakSet();
    
    // Helper to check if script is critical
    const isCriticalScript = (src) => {
        if (!src) return false;
        src = src.toLowerCase();
        return CRITICAL_SCRIPTS.some(pattern => src.includes(pattern));
    };
    
    // Helper to check if CSS is critical
    const isCriticalCSS = (href) => {
        if (!href) return false;
        href = href.toLowerCase();
        return CRITICAL_CSS.some(pattern => href.includes(pattern));
    };
    
    // Process a script element
    const processScript = (script) => {
        if (processed.has(script)) return;
        
        const src = script.src;
        if (!src) return;
        
        // Skip if already has defer/async (but we might override)
        if (!isCriticalScript(src)) {
            // Force defer on non-critical scripts
            script.defer = true;
            // Remove async if present
            script.async = false;
            console.log(`[OPTIMIZER] Deferred: ${src.split('/').pop()}`);
        } else {
            console.log(`[OPTIMIZER] Critical: ${src.split('/').pop()}`);
        }
        
        processed.add(script);
    };
    
    // Process a CSS link
    const processCSS = (link) => {
        if (processed.has(link)) return;
        
        const href = link.href;
        if (!href || link.rel !== 'stylesheet') return;
        
        if (!isCriticalCSS(href)) {
            const originalMedia = link.media || 'all';
            link.media = 'print';
            link.onload = function() {
                this.media = originalMedia;
            };
            console.log(`[OPTIMIZER] Async CSS: ${href.split('/').pop()}`);
        }
        
        processed.add(link);
    };
    
    // Override createElement to catch ALL script/link creation
    document.createElement = function(tagName, options) {
        const element = originalCreateElement.call(this, tagName, options);
        
        if (tagName.toLowerCase() === 'script') {
            // Intercept property setting
            const originalSetAttribute = element.setAttribute;
            element.setAttribute = function(name, value) {
                originalSetAttribute.call(this, name, value);
                if (name === 'src' && this.src) {
                    processScript(this);
                }
            };
            
            // Intercept src property
            let srcValue;
            Object.defineProperty(element, 'src', {
                get: () => srcValue,
                set: (value) => {
                    srcValue = value;
                    if (value) {
                        processScript(element);
                    }
                },
                configurable: true
            });
        }
        
        if (tagName.toLowerCase() === 'link') {
            const originalSetAttribute = element.setAttribute;
            element.setAttribute = function(name, value) {
                originalSetAttribute.call(this, name, value);
                if (name === 'href' && this.href) {
                    processCSS(this);
                }
            };
        }
        
        return element;
    };
    
    // Block parsing until we process existing elements
    const processExisting = () => {
        // Get all scripts currently in the document
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            processScript(scripts[i]);
        }
        
        // Get all CSS links
        const links = document.getElementsByTagName('link');
        for (let i = 0; i < links.length; i++) {
            processCSS(links[i]);
        }
    };
    
    // Override document.write to catch inline script writing
    const originalWrite = document.write;
    document.write = function(str) {
        // Parse the string for script tags
        if (str.includes('<script')) {
            const temp = document.createElement('div');
            temp.innerHTML = str;
            temp.querySelectorAll('script[src]').forEach(processScript);
        }
        return originalWrite.call(this, str);
    };
    
    // Process everything synchronously NOW
    processExisting();
    
    // Set up mutation observer for any dynamic additions
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeName === 'SCRIPT') {
                    processScript(node);
                } else if (node.nodeName === 'LINK') {
                    processCSS(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('script[src]').forEach(processScript);
                    node.querySelectorAll('link[rel="stylesheet"]').forEach(processCSS);
                }
            });
        });
    });
    
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });
    
    console.log('[OPTIMIZER] Ready - blocking released');
    
    // Optional: Report results after load
    window.addEventListener('load', () => {
        const deferred = document.querySelectorAll('script[defer]').length;
        const asyncCSS = document.querySelectorAll('link[media="print"]').length;
        console.log(`[OPTIMIZER] Complete: ${deferred} scripts deferred, ${asyncCSS} CSS async`);
    });
})();
