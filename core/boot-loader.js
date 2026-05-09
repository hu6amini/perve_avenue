"use strict";
(function() {
    // SAFETY NET: Prevents inline crashes before scripts are ready
    window.$ = window.jQuery = function() { 
        return { 
            ready: function(fn) { window.addEventListener('load', fn); },
            notifications: function() { console.log("Notifications queued..."); return this; },
            on: function() { return this; }
        }; 
    };

    let logBuffer = "[Surgical Deferral Active]:";
    
    // Whitelist core needs to prevent logic gaps
    const whitelist = ["jq.js", "media-optimizer.js", "dynamic-loader.js", "boot-loader.js"];

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
        console.log(logBuffer);
        // Once window loads, the 'real' jQuery will overwrite our safety net
        document.querySelectorAll('script[type="text/plain"]').forEach(oldScript => {
            if (oldScript.dataset.original) {
                const newScript = document.createElement("script");
                newScript.src = oldScript.dataset.original;
                newScript.defer = true;
                oldScript.parentNode.replaceChild(newScript, oldScript);
            }
        });
    });
})();
