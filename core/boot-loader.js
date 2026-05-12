"use strict";
(function() {
    // Configuration object for easy maintenance and testing
    const CONFIG = {
        // Safe list using Set for O(1) lookup performance
        safeList: new Set([
            "jq.js",
            "plugin_v3.js",
            "boot-loader.min.js", 
            "dynamic-loader.min.js",
            "media-optimizer.min.js",
            "event-bus.min.js",
            "modern-forum.min.css",
            "all.min.css"      
        ]),
        // Unified minified asset mapping to avoid duplication
        minifiedMap: {
            'media-optimizer.js': { 
                src: 'media-optimizer.min.js', 
                type: 'module',
                defer: false
            },
            'event-bus.js': { 
                src: 'event-bus.min.js', 
                defer: false,
                type: 'text/javascript'
            }
        },
        // Timing configuration
        releaseTimeout: 2000,
        fallbackTimeout: 1000,
        // Files that should be handled by dynamic loader
        dynamicLoaderPatterns: ['lite-vimeo-embed', '+esm'],
        // Log markers
        trapMarker: "[Bypass Active]:",
        releaseMarker: "[Bypass]: Legacy assets released."
    };

    let logBuffer = CONFIG.trapMarker;
    let observer = null;
    let isInitialized = false;

    /**
     * Extract filename from src URL, removing query parameters
     */
    const getFileName = (src) => {
        if (!src) return '';
        return src.split('/').pop().split('?')[0];
    };

    /**
     * Check if a file is on the safe list
     */
    const isSafeFile = (src) => {
        const fileName = getFileName(src);
        if (!fileName) return false;

        // Direct set lookup
        if (CONFIG.safeList.has(fileName)) return true;

        // Partial match for files that include safe list items
        for (const safeItem of CONFIG.safeList) {
            if (fileName.includes(safeItem)) return true;
        }
        return false;
    };

    /**
     * Check if file should be handled by dynamic loader
     */
    const isDynamicLoaderManaged = (src) => {
        return CONFIG.dynamicLoaderPatterns.some(pattern => src.includes(pattern));
    };

    /**
     * Handle unsafe script elements
     */
    const handleUnsafeScript = (el, src) => {
        const fileName = getFileName(src);

        // Trap script-loaders specifically
        if (src.includes('script-loader')) {
            el.type = "text/plain";
            el.dataset.original = src;
            el.removeAttribute('src');
            logBuffer += `\n- Forced Trap (Loader): ${fileName}`;
            return;
        }

        // Block synchronous scripts that aren't already deferred/async/blocked
        if (!el.hasAttribute('async') && 
            !el.hasAttribute('defer') && 
            el.type !== "text/plain") {
            el.type = "text/plain";
            el.dataset.original = src;
            el.removeAttribute('src');
            logBuffer += `\n- Trapped JS: ${fileName}`;
        }
    };

    /**
     * Handle unsafe CSS stylesheets
     */
    const handleUnsafeCSS = (el, src) => {
        // Skip if already processed or activated
        if (el.dataset.activated || el.media === "print" || el.dataset.bypassProcessed) {
            return;
        }

        const fileName = getFileName(src);
        el.media = "print";
        el.dataset.bypassProcessed = "true";

        // Try immediate activation if sheet is accessible (no CORS issues)
        try {
            if (el.sheet && typeof el.sheet.cssRules !== 'undefined') {
                // Sheet is accessible and rules can be read
                el.media = "all";
                el.dataset.activated = "true";
                logBuffer += `\n- Activated CSS (Immediate): ${fileName}`;
                return;
            }
        } catch (corsError) {
            // CORS restricted or sheet not ready; will use onload fallback
        }

        // Fallback: activate on load event
        const activateOnLoad = function() {
            if (!this.dataset.activated) {
                this.media = "all";
                this.dataset.activated = "true";
                logBuffer += `\n- Activated CSS (OnLoad): ${fileName}`;
            }
        };

        el.onload = activateOnLoad;
        
        // Additional safety: recheck accessibility on error
        el.onerror = function() {
            // If there's a CORS error, try the fallback anyway
            activateOnLoad.call(this);
        };

        logBuffer += `\n- Downgraded CSS (Deferred): ${fileName}`;
    };

    /**
     * Process a single DOM element (script or link)
     */
    const processElement = (el) => {
        const isScript = el.tagName === "SCRIPT";
        const isLink = el.tagName === "LINK" && el.rel === "stylesheet";

        if (!isScript && !isLink) return;

        const src = isScript ? (el.src || el.getAttribute('data-src')) : el.href;
        if (!src) return;

        // Skip safe files
        if (isSafeFile(src)) return;

        if (isScript) {
            handleUnsafeScript(el, src);
        } else {
            handleUnsafeCSS(el, src);
        }
    };

    /**
     * Restore trapped scripts and activate CSS
     */
    const restoreScripts = () => {
        const trapped = document.querySelectorAll('script[type="text/plain"][data-original]');
        let restoredCount = 0;

        trapped.forEach(oldScript => {
            const src = oldScript.dataset.original;
            if (!src) return;

            // Skip files managed by dynamic loader
            if (isDynamicLoaderManaged(src)) return;

            const fileName = getFileName(src);
            let finalSrc = src;
            let scriptAttrs = { defer: true };

            // Check if this file has a minified version mapping
            for (const [pattern, config] of Object.entries(CONFIG.minifiedMap)) {
                if (fileName.includes(pattern) && !src.includes('.min.js')) {
                    finalSrc = src.replace(pattern, config.src);
                    // Merge config attributes, preserving defer unless overridden
                    scriptAttrs = { 
                        defer: config.defer !== false,
                        ...(config.type && { type: config.type })
                    };
                    break;
                }
            }

            // Create new script element with restored attributes
            const newScript = document.createElement("script");
            newScript.src = finalSrc;
            
            // Apply attributes
            if (scriptAttrs.type) newScript.type = scriptAttrs.type;
            if (scriptAttrs.defer) newScript.defer = true;

            oldScript.parentNode.replaceChild(newScript, oldScript);
            restoredCount++;
        });

        // Activate any remaining deferred CSS
        const deferredCSS = document.querySelectorAll('link[media="print"][data-bypass-processed]');
        let activatedCount = 0;

        deferredCSS.forEach(link => {
            if (!link.dataset.activated) {
                link.media = "all";
                link.dataset.activated = "true";
                activatedCount++;
            }
        });

        logBuffer += `\n${CONFIG.releaseMarker} Restored ${restoredCount} scripts, activated ${activatedCount} stylesheets.`;
        console.log(logBuffer);
    };

    /**
     * Initialize mutation observer for dynamic content
     */
    const initializeObserver = () => {
        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    // Only process element nodes
                    if (node.nodeType === 1) {
                        processElement(node);
                        // Process descendants
                        node.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement);
                    }
                });
            }
        });

        observer.observe(document.documentElement, { 
            childList: true, 
            subtree: true 
        });
    };

    /**
     * Cleanup resources
     */
    const cleanup = () => {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        logBuffer = null;
        isInitialized = false;
    };

    /**
     * Schedule script restoration during idle time
     */
    const scheduleRelease = () => {
        if (!isInitialized) {
            const release = () => {
                restoreScripts();
                cleanup();
            };

            if ('requestIdleCallback' in window) {
                requestIdleCallback(release, { timeout: CONFIG.releaseTimeout });
            } else {
                setTimeout(release, CONFIG.fallbackTimeout);
            }
        }
    };

    /**
     * Initialize the boot loader
     */
    const init = () => {
        if (isInitialized) return;
        isInitialized = true;

        // Initialize observer for dynamic content
        initializeObserver();

        // Process existing script and link elements
        document.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement);

        // Schedule restoration on page load
        if (document.readyState === 'loading') {
            window.addEventListener("load", scheduleRelease, { once: true });
        } else {
            // Page already loaded, schedule immediately
            scheduleRelease();
        }
    };

    // Start initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
