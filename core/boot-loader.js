"use strict";
(function() {
    let logBuffer = "[Bypass Active]:";
    
    const safeList = [
        "jq.js", "jqt.js", "ffa.js", "plugin_v3.js",
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
            // HANDLE JAVASCRIPT (The Trap)
            if (isScript && !el.hasAttribute('async') && !el.hasAttribute('defer')) {
                el.type = "text/plain";
                el.dataset.original = src;
                el.removeAttribute('src'); 
                logBuffer += "\n- Trapped JS: " + fileName;
            } 
            // HANDLE CSS (The Media Swap)
            else if (isLink) {
                // We apply the attributes that the forum filter usually deletes
                el.media = "print"; 
                el.onload = function() { this.media = "all"; };
                logBuffer += "\n- Downgraded CSS: " + fileName;
            }
        }
    };

    // --- MutationObserver Logic ---
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

    // --- Final Execution ---
    window.addEventListener("load", () => {
        console.log(logBuffer);
        
        // Only JS needs manual release now
        document.querySelectorAll('script[type="text/plain"]').forEach(oldScript => {
            const newScript = document.createElement("script");
            newScript.src = oldScript.dataset.original;
            newScript.defer = true;
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    });
})();
