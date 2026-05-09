"use strict";
(function() {
    let logBuffer = "[Universal Deferral Active]:";

    const processScript = (el) => {
        if (el.tagName === "SCRIPT") {
            const dataSrc = el.getAttribute('data-src');
            const rawSrc = el.src;

            // Only trap if it's an external script and isn't already deferred/async
            if (dataSrc || (rawSrc && !el.hasAttribute('async') && !el.hasAttribute('defer') && el.type !== 'module')) {
                
                // CRITICAL: If the script is jQuery core (jq.js), we might need to let it pass 
                // if the forum has inline code that demands it immediately.
                // However, for maximum speed, we trap it and fix the inline calls.
                
                if (el.type !== "text/plain") {
                    el.type = "text/plain";
                    el.dataset.original = rawSrc;
                    // el.textContent = ""; // REMOVE THIS LINE - it might be clearing code the forum needs
                    el.removeAttribute('src'); 
                } else if (dataSrc) {
                    el.dataset.original = dataSrc;
                }
                
                const fileName = (dataSrc || rawSrc).split('/').pop().split('?')[0];
                if (!logBuffer.includes(fileName)) {
                    logBuffer += "\n- Trapped: " + fileName;
                }
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
        const trapped = document.querySelectorAll('script[type="text/plain"]');
        console.log(logBuffer + "\n- Re-injecting " + trapped.length + " scripts...");
        
        let index = 0;
        const injectNext = () => {
            if (index >= trapped.length) {
                // ALL SCRIPTS LOADED - Trigger a custom event in case other scripts are listening
                window.dispatchEvent(new Event('scripts-ready'));
                return;
            }

            const oldScript = trapped[index];
            if (oldScript.dataset.original) {
                const newScript = document.createElement("script");
                newScript.src = oldScript.dataset.original;
                newScript.onload = () => {
                    index++;
                    injectNext(); // Load next script only after this one finishes
                };
                oldScript.parentNode.replaceChild(newScript, oldScript);
            } else {
                index++;
                injectNext();
            }
        };

        injectNext();
    });
})();
