"use strict";
(function() {
    const log = [];
    const process = (el) => {
        if (el.tagName === "SCRIPT" && el.src && !el.type.includes("module")) {
            // If it's not already deferred/async/trapped, trap it
            if (!el.hasAttribute('async') && !el.hasAttribute('defer') && el.type !== "text/plain") {
                el.type = "text/plain";
                el.dataset.original = el.src;
                el.textContent = ""; 
                log.push(el.src.split('/').pop().split('?')[0]);
            }
        }
    };

    // Start observing immediately
    const observer = new MutationObserver((m) => {
        m.forEach(mutation => mutation.addedNodes.forEach(n => {
            if (n.nodeType === 1) process(n);
        }));
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Initial check
    document.querySelectorAll("script").forEach(process);

    window.addEventListener("load", () => {
        console.log("[Universal Deferral Active]:", log);
        document.querySelectorAll('script[type="text/plain"]').forEach(old => {
            if (old.dataset.original) {
                const s = document.createElement("script");
                s.src = old.dataset.original;
                s.defer = true; 
                old.parentNode.replaceChild(s, old);
            }
        });
    });
})();
