"use strict";
(function() {
    let logBuffer = "[Bypass Active]:";
    
    // 1. THE SAFE LIST: Scripts and Styles here load normally (Render Blocking)
    const safeList = [
        "jq.js",           // Core jQuery
        "jqt.js",          // Forum toolkit
        "ffa.js",          // Specific fixes
        "plugin_v3.js",    // Notification logic
        "modern-forum.css",// Your new UI
        "all.min.css"      // FontAwesome or similar
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
            // --- HANDLE CSS (The Media Swap / Non-Blocking) ---
            else if (isLink && el.media !== "all") {
                el.media = "print"; // Forces background loading
                
                // Define the activation function
                const activate = function() { 
                    this.media = "all"; 
                    this.dataset.activated = "true";
                };

                el.onload = activate;

                // CACHE CHECK: If already loaded/cached, activate immediately
                if (el.sheet && el.sheet.cssRules) {
                    activate.call(el);
                }
                
                logBuffer += "\n- Downgraded CSS: " + fileName;
            }
        }
    };

    // --- MutationObserver: Catches elements as they are injected ---
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
    
    // Initial Scan for elements already in the DOM
    document.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement);

    // --- FINAL EXECUTION (When Page is Ready) ---
    window.addEventListener("load", () => {
        console.log(logBuffer);
        
        // 1. Release Trapped JS with Defer
        document.querySelectorAll('script[type="text/plain"]').forEach(oldScript => {
            if (oldScript.dataset.original) {
                const newScript = document.createElement("script");
                newScript.src = oldScript.dataset.original;
                newScript.defer = true;
                oldScript.parentNode.replaceChild(newScript, oldScript);
            }
        });

        // 2. CSS FAIL-SAFE: Wake up any legacy styles that missed the onload event
        // This prevents "frozen" modals and layout glitches
        document.querySelectorAll('link[media="print"]').forEach(link => {
            if (!link.dataset.activated) {
                link.media = "all";
                link.dataset.activated = "true";
                console.log("[Fail-Safe]: Manually activated " + link.href);
            }
        });
    });
})();
