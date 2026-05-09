"use strict";
(function() {
    let logBuffer = "[Universal Deferral Active]:";

    const processScript = (el) => {
        if (el.tagName === "SCRIPT") {
            const dataSrc = el.getAttribute('data-src');
            const rawSrc = el.src;

            // Target scripts that have a source (either data-src or src) 
            // and aren't already optimized modules/async/defer
            if (dataSrc || (rawSrc && !el.hasAttribute('async') && !el.hasAttribute('defer') && el.type !== 'module')) {
                
                if (el.type !== "text/plain") {
                    // Standard forum script found: Trap it
                    el.type = "text/plain";
                    el.dataset.original = rawSrc;
                    el.textContent = ""; 
                    // Remove src to stop the browser from prioritizing the download
                    el.removeAttribute('src'); 
                } else if (dataSrc) {
                    // Our manual 'data-src' script found: Prepare it
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
