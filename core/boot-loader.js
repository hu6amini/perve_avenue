
"use strict";
(function() {
    let logBuffer = "[Bypass Active]:";
    
    const safeList = [
        "jq.js",           
        "jqt.js",          
        "ffa.js",          
        "plugin_v3.js",    
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
            // --- HANDLE JAVASCRIPT (The Trap) ---
            if (isScript && !el.hasAttribute('async') && !el.hasAttribute('defer') && el.type !== "text/plain") {
                el.type = "text/plain";
                el.dataset.original = src;
                el.removeAttribute('src'); 
                logBuffer += "\n- Trapped JS: " + fileName;
            } 
            // --- HANDLE CSS (The Media Swap) ---
            else if (isLink && el.media !== "all") {
                el.media = "print"; 
                const activate = function() { 
                    this.media = "all"; 
                    this.dataset.activated = "true";
                };
                el.onload = activate;
                if (el.sheet && el.sheet.cssRules) { activate.call(el); }
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

    // --- RELEASE LOGIC USING IDLE CALLBACK ---
    window.addEventListener("load", () => {
        const releaseAssets = () => {
            console.log(logBuffer);
            
            // 1. Release JS (Matches any trapped script, regardless of dynamic URL params)
            document.querySelectorAll('script[type="text/plain"]').forEach(oldScript => {
                if (oldScript.dataset.original) {
                    const newScript = document.createElement("script");
                    newScript.src = oldScript.dataset.original; // Keeps dynamic numbers intact
                    newScript.defer = true;
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                }
            });

            // 2. Final CSS Check
            document.querySelectorAll('link[media="print"]').forEach(link => {
                if (!link.dataset.activated) {
                    link.media = "all";
                    link.dataset.activated = "true";
                }
            });
            console.log("[Bypass]: Legacy assets released during idle time.");
        };

        // Use requestIdleCallback with a 2-second timeout (force run after 2s if never idle)
        if ('requestIdleCallback' in window) {
            requestIdleCallback(releaseAssets, { timeout: 2000 });
        } else {
            setTimeout(releaseAssets, 1000); 
        }
    });
})();
