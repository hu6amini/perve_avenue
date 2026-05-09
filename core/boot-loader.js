"use strict";
(function() {
    let logBuffer = "[Surgical Deferral Active]:";
    
    // 1. NON-DESTRUCTIVE SAFETY NET
    // This only adds the 'notifications' function if jQuery exists but the plugin hasn't loaded yet.
    const patchjQuery = () => {
        if (window.jQuery && !window.jQuery.fn.notifications) {
            window.jQuery.fn.notifications = function() {
                console.log("Notifications queued (Plugin not yet loaded)...");
                return this;
            };
        }
    };

    // Run patch immediately and every 50ms until the page is fully loaded
    const patchInterval = setInterval(patchjQuery, 50);

    // 2. WHITELIST
    const whitelist = ["jq.js", "media-optimizer.js", "dynamic-loader.js", "boot-loader.js", "slick.min.js"];

    const processScript = (el) => {
        if (el.tagName === "SCRIPT") {
            const src = el.src || el.getAttribute('data-src') || "";
            const fileName = src.split('/').pop().split('?')[0];
            const isWhiteListed = whitelist.some(item => fileName.includes(item));
            const isOptimized = el.hasAttribute('async') || el.hasAttribute('defer') || el.type === 'module';

            if (src && !isWhiteListed && !isOptimized && el.type !== "text/plain") {
                el.type = "text/plain";
                el.dataset.original = src;
                el.removeAttribute('src'); 
                logBuffer += "\n- Trapped: " + fileName;
            }
        }
    };

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => { if (node.nodeType === 1) processScript(node); });
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.querySelectorAll("script").forEach(processScript);

    window.addEventListener("load", () => {
        clearInterval(patchInterval); // Stop patching once everything is loaded
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
