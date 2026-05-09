"use strict";
(function() {
    let logBuffer = "[Universal Deferral Active]:";

    const processScript = (el) => {
        // Only target external scripts with a source
        if (el.tagName === "SCRIPT" && el.src) {
            const isAsync = el.hasAttribute('async');
            const isDefer = el.hasAttribute('defer');
            const isModule = el.type === 'module';
            const isPlain = el.type === 'text/plain';

            // Trap anything that is currently RENDER-BLOCKING
            if (!isAsync && !isDefer && !isModule && !isPlain) {
                el.type = "text/plain";
                el.dataset.original = el.src;
                
                // Block execution of internal forum wrappers
                el.textContent = ""; 
                
                logBuffer += "\n- Trapped: " + el.src.split('/').pop().split('?')[0];
            }
        }
    };

    // 1. Setup MutationObserver to catch scripts as they are injected
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) processScript(node);
            });
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // 2. Immediate sweep for scripts already in the DOM
    document.querySelectorAll("script").forEach(processScript);

    // 3. Re-inject all trapped scripts after the page is ready
    window.addEventListener("load", () => {
        console.log(logBuffer);
        const trapped = document.querySelectorAll('script[type="text/plain"]');
        
        trapped.forEach(oldScript => {
            if (oldScript.dataset.original) {
                const newScript = document.createElement("script");
                newScript.src = oldScript.dataset.original;
                // Force defer to ensure they don't block the load event
                newScript.defer = true; 
                oldScript.parentNode.replaceChild(newScript, oldScript);
            }
        });
    });
})();
