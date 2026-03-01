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
        // Scripts to defer - MORE AGGRESSIVE PATTERNS
        scriptPatterns: [
            // Catch ANY script from forum domains, regardless of port/path/extension
            /forum(?:free|community)\.(?:net|it)(?::\d+)?\/.*(?:js|script|loader)/i,
            /forum(?:free|community)\.(?:net|it)/i,  // Catch ALL scripts from these domains
            
            // Your existing patterns
            /akcelo/i,
            /google-analytics/i,
            /ads\./i,
            /doubleclick/i,
            /amazon-adsystem/i,
            /criteo/i
        ],
        // Stylesheets to make non-render-blocking
        stylePatterns: [
            /forum(?:free|community)\.(?:net|it)\/.*\.css/i,
            /akcelo/i,
            /tippy/i
        ]
    };

    // Store processed elements
    const processed = new WeakSet();
    
    // Fast script processing
    const processScript = (script) => {
        if (!script.src || processed.has(script) || script.hasAttribute('data-deferred')) return;
        
        const src = script.src;
        const patterns = DEFER_CONFIG.scriptPatterns;
        for (let i = 0; i < patterns.length; i++) {
            if (patterns[i].test(src)) {
                processed.add(script);
                script.setAttribute('data-deferred', 'true');
                script.defer = true;
                console.log('✅ Deferred:', src);  // Keep this for debugging
                return;
            }
        }
    };

    // Fast stylesheet processing
    const processStylesheet = (link) => {
        if (!link.href || processed.has(link) || link.hasAttribute('data-deferred')) return;
        
        const href = link.href;
        const patterns = DEFER_CONFIG.stylePatterns;
        for (let i = 0; i < patterns.length; i++) {
            if (patterns[i].test(href)) {
                processed.add(link);
                link.setAttribute('data-deferred', 'true');
                link.media = 'print';
                link.onload = () => link.media = 'all';
                link.onerror = () => link.media = 'all';
                console.log('📄 Non-blocking CSS:', href);  // Keep this for debugging
                return;
            }
        }
    };

    // RECURSIVE SCAN function to catch deeply nested scripts
    const scanForScripts = (root) => {
        // Check the root itself
        if (root.tagName === 'SCRIPT' && root.src) {
            processScript(root);
        } else if (root.tagName === 'LINK' && root.rel === 'stylesheet') {
            processStylesheet(root);
        }
        
        // Check all children (fast with getElementsByTagName)
        if (root.querySelectorAll) {
            const scripts = root.getElementsByTagName('SCRIPT');
            for (let i = 0; i < scripts.length; i++) {
                if (scripts[i].src) processScript(scripts[i]);
            }
            
            const links = root.getElementsByTagName('LINK');
            for (let i = 0; i < links.length; i++) {
                if (links[i].rel === 'stylesheet') processStylesheet(links[i]);
            }
        }
    };

    // Identify containers for third-party scripts
    const getTargetNodes = () => {
        const nodes = [
            document.head,
            document.body
        ];
        
        const selectors = [
            '.ads', '.advertisement', '.ad-container',
            '.scripts', '.js-container', '.external-scripts',
            '.footer', '.widget', '.widget-area',
            '#ad-container', '#ads', '#ad-wrapper',
            '.sidebar', '.aside', '.widgets',
            '.third-party', '.embeds', '.integrations',
            '.Fixed', '.modern-menu-wrap', '.menuwrap', '.container', '.topic',
            '.footer', '.footer_links',  // Added your footer classes
            '#ffAdStart', '.FFA-box', '.FFA-element'  // Added ad container
        ];
        
        const container = document.querySelectorAll(selectors.join(','));
        for (let i = 0; i < container.length; i++) {
            nodes.push(container[i]);
        }
        
        const unique = new Set();
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i]) unique.add(nodes[i]);
        }
        
        return Array.from(unique);
    };

    // Target nodes for observation
    const targetNodes = getTargetNodes();

    // RECURSIVE WATCHER - catches deeply nested additions
    const scriptWatcher = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
            const mutation = mutations[i];
            
            // Fast filter
            if (mutation.type !== 'childList' || !mutation.addedNodes.length) continue;
            
            const addedNodes = mutation.addedNodes;
            for (let j = 0; j < addedNodes.length; j++) {
                const node = addedNodes[j];
                
                if (node.nodeType !== 1) continue;
                
                // SCAN THE ENTIRE SUBTREE of added node
                scanForScripts(node);
            }
        }
    });

    // Start watching with subtree: true to catch nested additions
    const watchConfig = {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false
    };

    for (let i = 0; i < targetNodes.length; i++) {
        try {
            scriptWatcher.observe(targetNodes[i], watchConfig);
        } catch (e) {
            // Silently fail
        }
    }

    // INITIAL SCAN - Catch ALL existing scripts everywhere
    console.log('🔍 Scanning for scripts to defer...');
    scanForScripts(document.documentElement);

    console.log('🚀 Script watcher active on', targetNodes.length, 'containers');
})();
