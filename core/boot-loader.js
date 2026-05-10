"use strict";
(function() {
    let logBuffer = "[Bypass Active]:";
    
    // 1. THE SAFE LIST (Foundational assets only)
    const safeList = [
        "jq.js",                           
        "plugin_v3.js",    
        "boot-loader.js", 
        "modern-forum.css",
        "all.min.css"      
    ];

    const processElement = (el) => {
        const isScript = el.tagName === "SCRIPT";
        const isLink = el.tagName === "LINK" && el.rel === "stylesheet";

        if (!isScript && !isLink) return;

        const src = isScript ? (el.src || el.getAttribute('data-src')) : el.href;
        if (!src) return;

        const fileName = src.split('/').pop().split('?')[0];
        const isSafe = safeList.some(item => fileName.includes(item));

        if (!isSafe) {
            // --- FORCED TRAP FOR SCRIPT LOADERS ---
            if (isScript && src.includes('script-loader')) {
                el.type = "text/plain";
                el.dataset.original = src;
                el.removeAttribute('src'); 
                logBuffer += "\n- Forced Trap (Loader): " + fileName;
                return; 
            }

            // --- HANDLE OTHER JAVASCRIPT ---
            if (isScript && !el.hasAttribute('async') && !el.hasAttribute('defer') && el.type !== "text/plain") {
                el.type = "text/plain";
                el.dataset.original = src;
                el.removeAttribute('src'); 
                logBuffer += "\n- Trapped JS: " + fileName;
            } 
            // --- HANDLE CSS (With Modern Conflict Protection) ---
            else if (isLink) {
                // If it's already set to print (by Boot-loader) or already activated, skip it
                if (el.dataset.activated || el.media === "print") return;

                el.media = "print"; 
                const activate = function() { 
                    this.media = "all"; 
                    this.dataset.activated = "true";
                };
                el.onload = activate;

                // Security Fail-safe for CORS/Cross-Origin CSS
                try {
                    if (el.sheet && el.sheet.cssRules) { 
                        activate.call(el); 
                    }
                } catch (e) {
                    // CORS restricted; onload handles the swap
                }
                
                logBuffer += "\n- Downgraded CSS: " + fileName;
            }
        }
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => { 
                if (node.nodeType === 1) {
                    processElement(node);
                    node.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement);
                }
            });
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement);

    window.addEventListener("load", () => {
        const releaseAssets = () => {
            console.log(logBuffer);
            
            document.querySelectorAll('script[type="text/plain"]').forEach(oldScript => {
                if (oldScript.dataset.original) {
                    const newScript = document.createElement("script");
                    newScript.src = oldScript.dataset.original; 
                    newScript.defer = true;
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                }
            });

            document.querySelectorAll('link[media="print"]').forEach(link => {
                if (!link.dataset.activated) {
                    link.media = "all";
                    link.dataset.activated = "true";
                }
            });
            console.log("[Bypass]: Legacy assets released during idle time.");
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(releaseAssets, { timeout: 2000 });
        } else {
            setTimeout(releaseAssets, 1000); 
        }
    });
})();
