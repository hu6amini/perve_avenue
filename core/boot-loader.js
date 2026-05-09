"use strict";
(function() {
    let logBuffer = "[Surgical Deferral Active]:";
    
    // FILES TO ALLOW IMMEDIATELY (Don't trap these)
    const whitelist = [
        "jq.js",             // Core jQuery - fixes the Notifications error
        "media-optimizer.js", // Your optimizer - fixes the report
        "dynamic-loader.js",  // Your loader
        "boot-loader.js"      // Self-exclusion
    ];

    const processScript = (el) => {
        if (el.tagName === "SCRIPT") {
            const src = el.src || el.getAttribute('data-src') || "";
            const fileName = src.split('/').pop().split('?')[0];

            // Check if it's external, not on whitelist, and not already optimized
            const isWhiteListed = whitelist.some(item => fileName.includes(item));
            const isOptimized = el.hasAttribute('async') || el.hasAttribute('defer') || el.type === 'module';

            if (src && !isWhiteListed && !isOptimized && el.type !== "text/plain") {
                el.type = "text/plain";
                el.dataset.original = src;
                
                // Optional: stop download
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
