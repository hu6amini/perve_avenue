/*New Version*/
"use strict";
(function() {
    let logBuffer = "[Bypass Active]:";
    
    // 1. THE SAFE LIST (Foundational assets only)
    const safeList = [
        "jq.js",
        "plugin_v3.js",
        "boot-loader.min.js",
        "dynamic-loader.min.js",
        "media-optimizer.min.js",
        "event-bus.min.js",
        "forum-enhancer.min.js",
        "modern-forum.min.css",
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
            // --- FORCED TRAP FOR SCRIPT LOADERS ---
            if (isScript && src.includes('script-loader')) {
                el.type = "text/plain";
                el.dataset.original = src;
                el.removeAttribute('src'); 
                logBuffer += "\n- Forced Trap (Loader): " + fileName;
                return; 
            }

            // --- HANDLE OTHER JAVASCRIPT ---
            if (isScript && !el.hasAttribute('async') && !el.hasAttribute('defer') && el.type !== "text/plain") {
                el.type = "text/plain";
                el.dataset.original = src;
                el.removeAttribute('src'); 
                logBuffer += "\n- Trapped JS: " + fileName;
            } 
            // --- HANDLE CSS (With Modern Conflict Protection) ---
            else if (isLink) {
                if (el.dataset.activated || el.media === "print") return;

                el.media = "print"; 
                const activate = function() { 
                    this.media = "all"; 
                    this.dataset.activated = "true";
                };
                el.onload = activate;

                try {
                    if (el.sheet && el.sheet.cssRules) { 
                        activate.call(el); 
                    }
                } catch (e) {
                    // CORS restricted; onload handles the swap
                }
                
                logBuffer += "\n- Downgraded CSS: " + fileName;
            }
        }
    };

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

    // ============================================================
    // LAZY LOAD TURNSTILE ON FIRST FORM INTERACTION
    // ============================================================
    let turnstileLoaded = false;
    function loadTurnstile() {
        if (turnstileLoaded) return;
        turnstileLoaded = true;
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        script.async = true;
        document.head.appendChild(script);
    }
    document.addEventListener('focusin', (e) => {
        if (e.target.closest('form')) {
            loadTurnstile();
        }
    }, { once: true, passive: true });

    // ============================================================
    // LAZY LOAD EMOJI PICKER CSS
    // ============================================================
    (function() {
        const emojiStyle = document.getElementById('emoji-picker-css');
        if (!emojiStyle) return;

        const emojiCSS = emojiStyle.textContent;
        emojiStyle.remove();

        let emojiCSSLoaded = false;
        function injectEmojiCSS() {
            if (emojiCSSLoaded) return;
            emojiCSSLoaded = true;
            const style = document.createElement('style');
            style.id = 'emoji-picker-css';
            style.textContent = emojiCSS;
            document.head.appendChild(style);
        }

        document.addEventListener('click', function(e) {
            if (e.target.closest('.ve-btn-emoji') || e.target.closest('#emoticons')) {
                injectEmojiCSS();
            }
        }, { passive: true });
    })();

    window.addEventListener("load", () => {
        const releaseAssets = () => {
            console.log(logBuffer);
            
            document.querySelectorAll('script[type="text/plain"]').forEach(oldScript => {
                const src = oldScript.dataset.original;
                if (!src) return;

                // Replace originals with minified versions to avoid duplication
                if (src.includes('media-optimizer.js') && !src.includes('.min.js')) {
                    const minSrc = src.replace(/media-optimizer\.js$/, 'media-optimizer.min.js');
                    const newScript = document.createElement("script");
                    newScript.src = minSrc;
                    newScript.type = 'module';
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                    return;
                }
                if (src.includes('event-bus.js') && !src.includes('.min.js')) {
                    const minSrc = src.replace(/event-bus\.js$/, 'event-bus.min.js');
                    const newScript = document.createElement("script");
                    newScript.src = minSrc;
                    newScript.defer = false;
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                    return;
                }

                // Skip lite‑vimeo, +esm, and Turnstile – we handle them separately
                if (src.includes('lite-vimeo-embed') || src.includes('+esm') || 
                    src.includes('challenges.cloudflare.com') || src.includes('turnstile')) return;

                // --- Popper.js guard for tippy ---
                if (src.includes('tippy.js') && !window.Popper) {
                    // Popper not yet loaded, delay tippy slightly
                    setTimeout(() => {
                        const newScript = document.createElement("script");
                        newScript.src = src;
                        newScript.defer = true;
                        oldScript.parentNode.replaceChild(newScript, oldScript);
                    }, 50);
                    return;
                }

                const newScript = document.createElement("script");
                newScript.src = src;
                newScript.defer = true;
                oldScript.parentNode.replaceChild(newScript, oldScript);
            });

            document.querySelectorAll('link[media="print"]').forEach(link => {
                if (!link.dataset.activated) {
                    link.media = "all";
                    link.dataset.activated = "true";
                }
            });
            console.log("[Bypass]: Legacy assets released during idle time.");
        };

        if ('requestIdleCallback' in window) {
            requestIdleCallback(releaseAssets, { timeout: 2000 });
        } else {
            setTimeout(releaseAssets, 1000); 
        }
    });
})();
