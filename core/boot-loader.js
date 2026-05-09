"use strict";
(function() {
    let logBuffer = "[Bypass Deferral Active]:";
    
    // 1. THE "SAFE LIST": These scripts will NOT be trapped.
    // We include core jQuery and forum-specific plugins here.
    const safeList = [
        "jq.js",           // Core jQuery
        "jqt.js",          // Forum toolkit
        "modal.js",        // Forum modals
        "dynamic-loader",  // Your custom loader
        "media-optimizer", // Your optimizer
        "plugin_v3.js",    // Usually the notification handler
        "ffa.js"           // Forum core logic
    ];

    const processScript = (el) => {
        if (el.tagName === "SCRIPT") {
            const src = el.src || el.getAttribute('data-src') || "";
            if (!src) return;

            const fileName = src.split('/').pop().split('?')[0];
            
            // Check if the file is in our safe list
            const isSafe = safeList.some(item => fileName.includes(item));
            // Check if it already has speed attributes
            const isOptimized = el.hasAttribute('async') || el.hasAttribute('defer') || el.type === 'module';

            // TRAP: Only if it's NOT safe and NOT already optimized
            if (!isSafe && !isOptimized && el.type !== "text/plain") {
                el.type = "text/plain";
                el.dataset.original = src;
                el.removeAttribute('src'); 
                logBuffer += "\n- Trapped: " + fileName;
            }
        }
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => { 
                if (node.nodeType === 1) processScript(node); 
            });
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.querySelectorAll("script").forEach(processScript);

    window.addEventListener("load", () => {
        console.log(logBuffer);
        const trapped = document.querySelectorAll('script[type="text/plain"]');
        trapped.forEach(oldScript => {
            if (oldScript.dataset.original) {
                const newScript = document.createElement("script");
                newScript.src = oldScript.dataset.original;
                newScript.defer = true;
                oldScript.parentNode.replaceChild(newScript, oldScript);
            }
        });
    });
})();
