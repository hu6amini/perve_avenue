/* Optimised Boot Loader – v3 */
"use strict";
(function () {
  let logBuffer = "[Bypass Active]:";

  // 1. Safe list – scripts/CSS that must not be trapped
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

  // 2. Core processing of <script> and <link rel="stylesheet">
  const processElement = (el) => {
    const isScript = el.tagName === "SCRIPT";
    const isLink = el.tagName === "LINK" && el.rel === "stylesheet";
    if (!isScript && !isLink) return;

    const src = isScript ? (el.src || el.getAttribute("data-src")) : el.href;
    if (!src) return;

    const fileName = src.split("/").pop().split("?")[0];
    const isSafe = safeList.some((item) => fileName.includes(item));

    if (!isSafe) {
      // Force-trap the heavy script‑loader
      if (isScript && src.includes("script-loader")) {
        el.type = "text/plain";
        el.dataset.original = src;
        el.removeAttribute("src");
        logBuffer += "\n- Forced Trap (Loader): " + fileName;
        return;
      }

      // Trap synchronous scripts (without async/defer)
      if (isScript && !el.hasAttribute("async") && !el.hasAttribute("defer") && el.type !== "text/plain") {
        el.type = "text/plain";
        el.dataset.original = src;
        el.removeAttribute("src");
        logBuffer += "\n- Trapped JS: " + fileName;
        return;
      }

      // Downgrade render‑blocking CSS to print (then activate on load)
      if (isLink) {
        if (el.dataset.activated || el.media === "print") return;
        el.media = "print";
        const activate = function () {
          this.media = "all";
          this.dataset.activated = "true";
        };
        el.onload = activate;
        try {
          if (el.sheet && el.sheet.cssRules) activate.call(el);
        } catch (e) {
          /* CORS – onload will handle it */
        }
        logBuffer += "\n- Downgraded CSS: " + fileName;
      }
    }
  };

  // 3. Observe the whole document for added scripts/styles
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          processElement(node);
          node.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement);
        }
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement);

  // 4. Lazy‑load Turnstile on first form interaction
  let turnstileLoaded = false;
  function loadTurnstile() {
    if (turnstileLoaded) return;
    turnstileLoaded = true;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    document.head.appendChild(script);
  }
  document.addEventListener("focusin", (e) => {
    if (e.target.closest("form")) loadTurnstile();
  }, { once: true, passive: true });

  // 5. Lazy‑load emoji‑picker CSS (both blocks) – only on editor pages
  (function () {
    const emojiCSSParts = [];
    let emojiCSSLoaded = false;
    let emojiObserver;

    function injectEmojiCSS() {
      if (emojiCSSParts.length === 0 || emojiCSSLoaded) return;
      emojiCSSLoaded = true;
      const style = document.createElement("style");
      style.id = "emoji-picker-css";
      style.textContent = emojiCSSParts.join("\n");
      document.head.appendChild(style);
      if (emojiObserver) emojiObserver.disconnect();
    }

    document.addEventListener("click", function (e) {
      const btn = e.target.closest(".ve-btn-emoji") || e.target.closest("#emoticons");
      if (!btn) return;
      if (document.body && (document.body.id === "topic" || document.body.id === "send" || document.body.id === "blog")) {
        injectEmojiCSS();
      }
    }, { passive: true });

    emojiObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && node.tagName === "STYLE") {
            const text = node.textContent || "";
            if (node.id === "emoji-picker-css" || text.includes(".emoji-picker")) {
              emojiCSSParts.push(text);
              node.remove();
            }
          }
        }
      }
    });
    emojiObserver.observe(document.head || document.documentElement, { childList: true, subtree: true });
  })();

  // 6. Lazy‑load ffb_embedlink and el‑modal styles when their elements first appear
  (function () {
    const capturedCSS = {};
    const injected = {};

    function injectCSS(key) {
      if (!capturedCSS[key] || injected[key]) return;
      injected[key] = true;
      const style = document.createElement("style");
      style.textContent = capturedCSS[key];
      document.head.appendChild(style);
    }

    const styleObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1 || node.tagName !== "STYLE") continue;
          const text = node.textContent || "";
          if (text.includes(".ffb_embedlink") && !capturedCSS["ffb_embedlink"]) {
            capturedCSS["ffb_embedlink"] = text;
            node.remove();
          } else if (text.includes(".el-modal") && !capturedCSS["el-modal"]) {
            capturedCSS["el-modal"] = text;
            node.remove();
          }
          if (capturedCSS["ffb_embedlink"] && capturedCSS["el-modal"]) {
            styleObserver.disconnect();
            return;
          }
        }
      }
    });
    styleObserver.observe(document.head || document.documentElement, { childList: true, subtree: true });

    const domObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.querySelectorAll) {
            if (node.querySelector(".ffb_embedlink") && capturedCSS["ffb_embedlink"]) {
              injectCSS("ffb_embedlink");
            }
            if (node.querySelector(".el-modal") && capturedCSS["el-modal"]) {
              injectCSS("el-modal");
            }
          }
          if (node.classList) {
            if (node.classList.contains("ffb_embedlink") && capturedCSS["ffb_embedlink"]) {
              injectCSS("ffb_embedlink");
            }
            if (node.classList.contains("el-modal") && capturedCSS["el-modal"]) {
              injectCSS("el-modal");
            }
          }
          if (injected["ffb_embedlink"] && injected["el-modal"]) {
            domObserver.disconnect();
            return;
          }
        }
      }
    });
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
  })();

  // 7. Release trapped assets at idle (with priority hints)
  window.addEventListener("load", () => {
    const releaseAssets = () => {
      console.log(logBuffer);

      document.querySelectorAll('script[type="text/plain"]').forEach((oldScript) => {
        const src = oldScript.dataset.original;
        if (!src) return;

        // Use minified versions if available
        if (src.includes("media-optimizer.js") && !src.includes(".min.js")) {
          const minSrc = src.replace(/media-optimizer\.js$/, "media-optimizer.min.js");
          const newScript = document.createElement("script");
          newScript.src = minSrc;
          newScript.type = "module";
          oldScript.parentNode.replaceChild(newScript, oldScript);
          return;
        }
        if (src.includes("event-bus.js") && !src.includes(".min.js")) {
          const minSrc = src.replace(/event-bus\.js$/, "event-bus.min.js");
          const newScript = document.createElement("script");
          newScript.src = minSrc;
          newScript.defer = false;   // event‑bus must run immediately
          oldScript.parentNode.replaceChild(newScript, oldScript);
          return;
        }

        // Replace original Handlebars with our minified version
        if (src.includes('handlebars/hb.js') && !src.includes('.min.js')) {
          const minSrc = 'https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e8e8c12f6bdbf38f74b83492ffc48b0e004b8b1a/core/handlebars.min.js';
          const newScript = document.createElement('script');
          newScript.src = minSrc;
          newScript.defer = true;
          oldScript.parentNode.replaceChild(newScript, oldScript);
          return;
        }

        // Skip assets we handle separately
        if (
          src.includes("lite-vimeo-embed") ||
          src.includes("+esm") ||
          src.includes("challenges.cloudflare.com") ||
          src.includes("turnstile")
        )
          return;

        // Popper.js guard: delay tippy if Popper isn't ready
        if (src.includes("tippy.js") && !window.Popper) {
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

      // Activate downgraded CSS
      document.querySelectorAll('link[media="print"]').forEach((link) => {
        if (!link.dataset.activated) {
          link.media = "all";
          link.dataset.activated = "true";
        }
      });

      console.log("[Bypass]: Legacy assets released during idle time.");
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(releaseAssets, { timeout: 2000 });
    } else {
      setTimeout(releaseAssets, 1000);
    }
  });
})();
