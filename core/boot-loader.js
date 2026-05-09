"use strict";
(function() {
    let logBuffer = "[Surgical Deferral Active]:";
    let notificationQueue = []; // Holds requests made before the plugin loads

    // 1. THE RECORDER (Safety Net)
    const patchjQuery = () => {
        if (window.jQuery && !window.jQuery.fn.notifications) {
            window.jQuery.fn.notifications = function(options) {
                // Save the request and the element it was called on
                notificationQueue.push({ el: this, opts: options });
                console.log("Notifications request buffered...");
                return this;
            };
        }
    };

    const patchInterval = setInterval(patchjQuery, 10);

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

    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => { if (node.nodeType === 1) processScript(node); });
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    document.querySelectorAll("script").forEach(processScript);

    window.addEventListener("load", () => {
        clearInterval(patchInterval);
        console.log(logBuffer);
        
        const trapped = document.querySelectorAll('script[type="text/plain"]');
        let scriptsLoaded = 0;

        trapped.forEach(oldScript => {
            if (oldScript.dataset.original) {
                const newScript = document.createElement("script");
                newScript.src = oldScript.dataset.original;
                newScript.defer = true;
                
                newScript.onload = () => {
                    scriptsLoaded++;
                    // Once the last script (usually the plugin loader) finishes...
                    if (scriptsLoaded === trapped.length) {
                        setTimeout(() => {
                            console.log("Replaying " + notificationQueue.length + " buffered notification calls...");
                            notificationQueue.forEach(item => {
                                if (typeof item.el.notifications === 'function') {
                                    item.el.notifications(item.opts);
                                }
                            });
                        }, 100); // Small delay to ensure registration
                    }
                };

                oldScript.parentNode.replaceChild(newScript, oldScript);
            }
        });
    });
})();
