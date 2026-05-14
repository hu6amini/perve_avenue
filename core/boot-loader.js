/* Optimised Boot Loader – v6 */
"use strict";
(function () {
  let logBuffer = "[Bypass Active]:";

  // Configuration
  const config = {
    safeList: [
      "jq.js",
      "plugin_v3.js",
      "boot-loader.min.js",
      "dynamic-loader.min.js",
      "media-optimizer.min.js",
      "event-bus.min.js",
      "forum-enhancer.min.js",
      "modern-forum.min.css",
      "all.min.css"
    ],
    skipRelease: [
      "lite-vimeo-embed",
      "+esm",
      "challenges.cloudflare.com",
      "turnstile",
     
      "recaptcha"
    ],
    emojiEditorPages: ["topic", "send", "blog"],
    capturedStyleKeys: {
      emoji: "emoji-picker",
      ffbEmbed: "ffb_embedlink",
      elModal: "el-modal"
    }
  };

  // State management
  const state = {
    turnstileLoaded: false,
    recaptchaSrc: null,
    recaptchaLoaded: false,
    emojiCSSParts: [],
    emojiCSSLoaded: false,
    capturedCSS: {},
    injected: {},
    observerDisconnected: false
  };

  // Utility: Check if filename is in safe list
  const isSafeAsset = (fileName) => {
    return config.safeList.some((item) => fileName.includes(item));
  };

  // Utility: Extract filename from URL
  const getFileName = (url) => {
    return url.split("/").pop().split("?")[0];
  };

  // Utility: Check if should skip release
  const shouldSkipRelease = (src) => {
    return config.skipRelease.some((item) => src.includes(item));
  };

  // 1. Core processing of <script> and <link rel="stylesheet">
  const processElement = (el) => {
    const isScript = el.tagName === "SCRIPT";
    const isLink = el.tagName === "LINK" && el.rel === "stylesheet";
    if (!isScript && !isLink) return;

    const src = isScript ? (el.src || el.getAttribute("data-src")) : el.href;
    if (!src) return;

    const fileName = getFileName(src);
    const isSafe = isSafeAsset(fileName);

    if (!isSafe) {
      // Force-trap the heavy script-loader
      if (isScript && src.includes("script-loader")) {
        el.type = "text/plain";
        el.dataset.original = src;
        el.removeAttribute("src");
        logBuffer += "\n- Forced Trap (Loader): " + fileName;
        return;
      }

      // Force-trap reCAPTCHA (may have async, but we want to lazy-load it)
      if (isScript && src.includes("recaptcha/api.js")) {
        state.recaptchaSrc = src;
        el.type = "text/plain";
        el.dataset.original = src;
        el.removeAttribute("src");
        logBuffer += "\n- Forced Trap (reCAPTCHA): " + fileName;
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

      // Downgrade render-blocking CSS to print (then activate on load)
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

  // 2. Capture and manage CSS styles (emoji, ffb_embedlink, el-modal)
  const processCSSStyle = (styleEl) => {
    const text = styleEl.textContent || "";

    // Capture emoji-picker CSS (both the ID-based and class-based blocks)
    if ((styleEl.id === 'emoji-picker-css' || text.includes(".emoji-picker")) && !state.injected[config.capturedStyleKeys.emoji]) {
      if (!state.emojiCSSParts) state.emojiCSSParts = [];
      state.emojiCSSParts.push(text);
      styleEl.remove();
      return true;
    }

    // Capture ffb_embedlink CSS
    if (text.includes(".ffb_embedlink") && !state.capturedCSS[config.capturedStyleKeys.ffbEmbed]) {
      state.capturedCSS[config.capturedStyleKeys.ffbEmbed] = text;
      styleEl.remove();
      return true;
    }

    // Capture el-modal CSS
    if (text.includes(".el-modal") && !state.capturedCSS[config.capturedStyleKeys.elModal]) {
      state.capturedCSS[config.capturedStyleKeys.elModal] = text;
      styleEl.remove();
      return true;
    }

    return false;
  };

  // 3. Inject captured CSS (generic)
  const injectCapturedCSS = (key, styleId = null) => {
    if (!state.capturedCSS[key] || state.injected[key]) return;
    state.injected[key] = true;
    const style = document.createElement("style");
    if (styleId) style.id = styleId;
    style.textContent = state.capturedCSS[key];
    document.head.appendChild(style);
  };

  // 4. Inject emoji CSS (handles multiple blocks)
  const injectEmojiCSS = () => {
    if (!state.emojiCSSParts || state.emojiCSSParts.length === 0 || state.emojiCSSLoaded) return;
    state.emojiCSSLoaded = true;
    const style = document.createElement("style");
    style.id = "emoji-picker-css";
    style.textContent = state.emojiCSSParts.join("\n");
    document.head.appendChild(style);
  };

  // 5. Unified MutationObserver for all DOM changes
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue; // Only process Element nodes

        // Process scripts and stylesheets
        processElement(node);

        // Process child scripts and stylesheets
        if (node.querySelectorAll) {
          try {
            node.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement);
          } catch (e) {
            /* Error querying, continue */
          }
        }

        // Process captured CSS styles
        if (node.tagName === "STYLE") {
          processCSSStyle(node);
        }

        // Check for emoji-picker CSS in child styles
        if (node.querySelectorAll) {
          try {
            node.querySelectorAll("style").forEach(processCSSStyle);
          } catch (e) {
            /* Error querying, continue */
          }
        }

        // Inject CSS when target elements appear
        if (node.querySelectorAll) {
          try {
            if (node.querySelector && state.capturedCSS[config.capturedStyleKeys.ffbEmbed] && !state.injected[config.capturedStyleKeys.ffbEmbed]) {
              if (node.querySelector(".ffb_embedlink")) {
                injectCapturedCSS(config.capturedStyleKeys.ffbEmbed);
              }
            }
            if (node.querySelector && state.capturedCSS[config.capturedStyleKeys.elModal] && !state.injected[config.capturedStyleKeys.elModal]) {
              if (node.querySelector(".el-modal")) {
                injectCapturedCSS(config.capturedStyleKeys.elModal);
              }
            }
          } catch (e) {
            /* Error querying, continue */
          }
        }

        // Check if node itself has target classes
        if (node.classList) {
          if (node.classList.contains("ffb_embedlink") && state.capturedCSS[config.capturedStyleKeys.ffbEmbed]) {
            injectCapturedCSS(config.capturedStyleKeys.ffbEmbed);
          }
          if (node.classList.contains("el-modal") && state.capturedCSS[config.capturedStyleKeys.elModal]) {
            injectCapturedCSS(config.capturedStyleKeys.elModal);
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial scan of existing elements
  document.querySelectorAll("script, link[rel='stylesheet'], style").forEach((el) => {
    if (el.tagName === "STYLE") {
      processCSSStyle(el);
    } else {
      processElement(el);
    }
  });

  // ============================================================
  // 6. Lazy-load Turnstile on first form interaction
  // ============================================================
  function loadTurnstile() {
    if (state.turnstileLoaded) return;
    state.turnstileLoaded = true;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    document.head.appendChild(script);
  }

  document.addEventListener("focusin", (e) => {
    if (e.target.closest("form")) loadTurnstile();
  }, { once: true, passive: true });

  // ============================================================
  // 7. Lazy-load reCAPTCHA on first form interaction
  // ============================================================
  function loadRecaptcha() {
    if (state.recaptchaLoaded || !state.recaptchaSrc) return;
    state.recaptchaLoaded = true;
    const script = document.createElement("script");
    script.src = state.recaptchaSrc;
    script.async = true;
    document.head.appendChild(script);
  }

  document.addEventListener("focusin", (e) => {
    if (e.target.closest("form")) loadRecaptcha();
  }, { once: true, passive: true });

  // ============================================================
  // 8. Lazy-load emoji-picker CSS on editor pages
  // ============================================================
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".ve-btn-emoji") || e.target.closest("#emoticons");
    if (!btn) return;
    if (document.body && config.emojiEditorPages.includes(document.body.id)) {
      injectEmojiCSS();
    }
  }, { passive: true });

  // ============================================================
  // 9. Release trapped assets at idle (with priority hints)
  // ============================================================
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
          newScript.defer = false; // event-bus must run immediately
          oldScript.parentNode.replaceChild(newScript, oldScript);
          return;
        }

        // Replace original Handlebars with our minified version
        if (src.includes("handlebars/hb.js") && !src.includes(".min.js")) {
          const minSrc = "https://cdn.jsdelivr.net/gh/hu6amini/perve_avenue@e8e8c12f6bdbf38f74b83492ffc48b0e004b8b1a/core/handlebars.min.js";
          const newScript = document.createElement("script");
          newScript.src = minSrc;
          newScript.defer = true;
          oldScript.parentNode.replaceChild(newScript, oldScript);
          return;
        }

        // Skip assets we handle separately
        if (shouldSkipRelease(src)) return;

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

  // ============================================================
  // 10. Cleanup on page unload
  // ============================================================
  window.addEventListener("beforeunload", () => {
    if (observer) observer.disconnect();
    state.observerDisconnected = true;
  }, { once: true });
})();
