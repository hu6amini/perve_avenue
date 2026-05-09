"use strict";
(function() {
    const targetScripts = [
        "script-loader", 
        "fonts.google", 
        "gstatic", 
        "graphql-http", 
        "addtoany", 
        "kakashi", 
        "handlebars", 
        "jquery.scrollbar", 
        "tippy"
    ];

    let logBuffer = "[Deferred Scripts]:";

    const processScript = (el) => {
        if (el.tagName === "SCRIPT" && el.src && !el.type.includes("plain")) {
            const shouldDefer = targetScripts.some(slug => el.src.includes(slug));
            
            if (shouldDefer) {
                // Change type to prevent execution
                el.type = "text/plain";
                el.dataset.original = el.src;
                
                // Block internal execution for inline-wrapped bundles
                el.textContent = ""; 
                
                logBuffer += "\n- Deferring: " + (el.src.includes("script-loader") ? "Forum-Core-Bundle" : el.src.split('/').pop());
            }
        }
    };

    // 1. Start Observer immediately to catch streaming scripts
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

    // 2. Immediate sweep for scripts already parsed in the <head>
    document.querySelectorAll("script").forEach(processScript);

    // 3. Re-injection on window.load
    window.addEventListener("load", () => {
        console.log(logBuffer);
        
        const deferred = document.querySelectorAll('script[type="text/plain"]');
        deferred.forEach(oldScript => {
            if (oldScript.dataset.original) {
                const newScript = document.createElement("script");
                newScript.src = oldScript.dataset.original;
                newScript.defer = true;
                oldScript.parentNode.replaceChild(newScript, oldScript);
            }
        });
    });
})();
