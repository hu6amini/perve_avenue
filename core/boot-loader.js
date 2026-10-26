/* Optimised Boot Loader – v7 */
"use strict";
(function () {
  let logBuffer = "[Bypass Active]:";

  const config = {
    safeList: [
      "jq.js",
      "plugin_v3.js",
      "script-loader",
      "boot-loader.min.js",
      "dynamic-loader.min.js",
      "media-optimizer.min.js",
      "event-bus.min.js",
      "forum-enhancer.min.js",
      "modern-forum.css",
      "all.css"
    ],
    skipRelease: [
      "challenges.cloudflare.com",
      "turnstile",
      "recaptcha"
    ],
    emojiEditorPages: ["topic", "send", "blog"],
    capturedStyleKeys: {
      emoji: "emoji-picker",
      ffbEmbed: "ffb_embedlink",
      elModal: "el-modal",
      csFramework: "cs-framework",
      notifications: "notifications",
      uiDatepicker: "ui-datepicker"
    }
  };

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

  // Rules run in order; first match wins, one block per key. `key`
  // holds the CSS-string identifier used to index state.capturedCSS /
  // state.injected. Injection triggers are wired separately below so
  // each block fires at the right user interaction.
  const STYLE_CAPTURE_RULES = [
    {
      key: config.capturedStyleKeys.ffbEmbed,
      test: (t) => t.includes('.ffb_embedlink')
    },
    {
      key: config.capturedStyleKeys.elModal,
      test: (t) => t.includes('.el-modal')
    },
    {
      key: config.capturedStyleKeys.csFramework,
      test: (t) => t.includes('.cs-toast') && t.includes('.cs-modal') && t.includes('.cs-btn')
    },
    {
      key: config.capturedStyleKeys.notifications,
      test: (t) => t.includes('.script-notification-modal')
    },
    {
      key: config.capturedStyleKeys.uiDatepicker,
      test: (t) => t.includes('.ui-datepicker') && t.includes('.ui-timepicker')
    }
  ];

  const isSafeAsset = (fileName) => config.safeList.some((item) => fileName.includes(item));
  const getFileName = (url) => url.split("/").pop().split("?")[0];
  const shouldSkipRelease = (src) => config.skipRelease.some((item) => src.includes(item));

  // ---------------------------------------------------------------
  // <script> / <link> processing — unchanged
  // ---------------------------------------------------------------
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

      // Force-trap reCAPTCHA (lazy-load on first form interaction)
      if (isScript && src.includes("recaptcha/api.js")) {
        state.recaptchaSrc = src;
        el.type = "text/plain";
        el.dataset.original = src;
        el.removeAttribute("src");
        logBuffer += "\n- Forced Trap (reCAPTCHA): " + fileName;
        return;
      }

      // Trap synchronous scripts
      if (isScript && !el.hasAttribute("async") && !el.hasAttribute("defer") && el.type !== "text/plain") {
        el.type = "text/plain";
        el.dataset.original = src;
        el.removeAttribute("src");
        logBuffer += "\n- Trapped JS: " + fileName;
        return;
      }

      // Downgrade render-blocking CSS
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
        } catch (e) { /* CORS – onload will handle it */ }
        logBuffer += "\n- Downgraded CSS: " + fileName;
      }
    }
  };

  // ---------------------------------------------------------------
  // Style capture
  // ---------------------------------------------------------------
  const processCSSStyle = (styleEl) => {
    const text = styleEl.textContent || "";
    if (!text) return false;

    // Emoji-picker CSS is multi-part — accumulate, inject as one block.
    if ((styleEl.id === 'emoji-picker-css' || text.includes(".emoji-picker")) &&
        !state.injected[config.capturedStyleKeys.emoji]) {
      if (!state.emojiCSSParts) state.emojiCSSParts = [];
      state.emojiCSSParts.push(text);
      styleEl.remove();
      return true;
    }

    for (let i = 0; i < STYLE_CAPTURE_RULES.length; i++) {
      const rule = STYLE_CAPTURE_RULES[i];
      if (state.capturedCSS[rule.key]) continue;
      if (!rule.test(text)) continue;

      state.capturedCSS[rule.key] = text;
      styleEl.remove();

      // The cs-framework block also carries the cursor affordance for
      // the "(elenco)" scripts-credits link. Preserve that one rule so
      // the link keeps its clickable look before the modal framework
      // is injected.
      if (rule.key === config.capturedStyleKeys.csFramework && text.includes('[data-credits]')) {
        const mini = document.createElement('style');
        mini.textContent = '[data-credits]{cursor:pointer}';
        document.head.appendChild(mini);
      }

      return true;
    }

    return false;
  };

  const injectCapturedCSS = (key, styleId) => {
    if (!state.capturedCSS[key] || state.injected[key]) return;
    state.injected[key] = true;
    const style = document.createElement("style");
    if (styleId) style.id = styleId;
    style.textContent = state.capturedCSS[key];
    document.head.appendChild(style);
    logBuffer += "\n- Injected CSS: " + key;
  };

  const injectEmojiCSS = () => {
    if (!state.emojiCSSParts || state.emojiCSSParts.length === 0 || state.emojiCSSLoaded) return;
    state.emojiCSSLoaded = true;
    const style = document.createElement("style");
    style.id = "emoji-picker-css";
    style.textContent = state.emojiCSSParts.join("\n");
    document.head.appendChild(style);
  };

  // ---------------------------------------------------------------
  // Unified MutationObserver
  // ---------------------------------------------------------------
  const observer = new MutationObserver((mutations) => {
    for (let m = 0; m < mutations.length; m++) {
      const added = mutations[m].addedNodes;
      for (let n = 0; n < added.length; n++) {
        const node = added[n];
        if (node.nodeType !== 1) continue;

        // Scripts / stylesheets
        processElement(node);
        if (node.querySelectorAll) {
          try { node.querySelectorAll("script, link[rel='stylesheet']").forEach(processElement); } catch (e) {}
        }

        // Styles
        if (node.tagName === "STYLE") processCSSStyle(node);
        if (node.querySelectorAll) {
          try { node.querySelectorAll("style").forEach(processCSSStyle); } catch (e) {}
        }

        // Deferred-CSS triggers. Skip the queries entirely if nothing
        // is pending — the observer fires for every DOM mutation.
        const pending =
          (state.capturedCSS[config.capturedStyleKeys.ffbEmbed]     && !state.injected[config.capturedStyleKeys.ffbEmbed]) ||
          (state.capturedCSS[config.capturedStyleKeys.elModal]      && !state.injected[config.capturedStyleKeys.elModal]) ||
          (state.capturedCSS[config.capturedStyleKeys.csFramework]  && !state.injected[config.capturedStyleKeys.csFramework]) ||
          (state.capturedCSS[config.capturedStyleKeys.notifications]&& !state.injected[config.capturedStyleKeys.notifications]);
        if (!pending) continue;

        try {
          const self  = (sel) => node.matches && node.matches(sel);
          const child = (sel) => node.querySelector && node.querySelector(sel);

          if (state.capturedCSS[config.capturedStyleKeys.ffbEmbed] && !state.injected[config.capturedStyleKeys.ffbEmbed]) {
            if (self('.ffb_embedlink') || child('.ffb_embedlink')) {
              injectCapturedCSS(config.capturedStyleKeys.ffbEmbed);
            }
          }
          if (state.capturedCSS[config.capturedStyleKeys.elModal] && !state.injected[config.capturedStyleKeys.elModal]) {
            if (self('.el-modal') || child('.el-modal')) {
              injectCapturedCSS(config.capturedStyleKeys.elModal);
            }
          }
          if (state.capturedCSS[config.capturedStyleKeys.csFramework] && !state.injected[config.capturedStyleKeys.csFramework]) {
            if (self('.cs-toast, .cs-modal, .FFB_popup_credits') ||
                child('.cs-toast, .cs-modal, .FFB_popup_credits')) {
              injectCapturedCSS(config.capturedStyleKeys.csFramework);
            }
          }
          if (state.capturedCSS[config.capturedStyleKeys.notifications] && !state.injected[config.capturedStyleKeys.notifications]) {
            if (self('.script-notification-modal') || child('.script-notification-modal')) {
              injectCapturedCSS(config.capturedStyleKeys.notifications);
            }
          }
        } catch (e) { /* ignore selector errors */ }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ---------------------------------------------------------------
  // Initial scan of existing elements
  // ---------------------------------------------------------------
  document.querySelectorAll("script, link[rel='stylesheet'], style").forEach((el) => {
    if (el.tagName === "STYLE") processCSSStyle(el);
    else processElement(el);
  });

  // If any trigger element already exists, inject its CSS now.
  // MutationObserver only sees NEW nodes, so this covers the case
  // where a trigger element was in the initial HTML.
  (function injectIfPresent() {
    const triggers = {};
    triggers[config.capturedStyleKeys.ffbEmbed]      = '.ffb_embedlink';
    triggers[config.capturedStyleKeys.elModal]       = '.el-modal';
    triggers[config.capturedStyleKeys.csFramework]   = '.cs-toast, .cs-modal, .FFB_popup_credits';
    triggers[config.capturedStyleKeys.notifications] = '.script-notification-modal';
    triggers[config.capturedStyleKeys.uiDatepicker]  = '.hasDatepicker, .ui-datepicker';

    Object.keys(triggers).forEach((key) => {
      if (state.capturedCSS[key] && !state.injected[key]) {
        try {
          if (document.querySelector(triggers[key])) injectCapturedCSS(key);
        } catch (e) {}
      }
    });
  })();

  // ---------------------------------------------------------------
  // uiDatepicker — inject on the specific interactions that trigger it
  // ---------------------------------------------------------------
  function maybeInjectDatepicker() {
    const key = config.capturedStyleKeys.uiDatepicker;
    if (state.capturedCSS[key] && !state.injected[key]) injectCapturedCSS(key);
  }

  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#ADDCRON') || t.closest('#TopicTime') ||
        t.closest('.hasDatepicker') || t.closest('.ui-datepicker-trigger')) {
      maybeInjectDatepicker();
    }
  }, { capture: true, passive: true });

  document.addEventListener('focusin', function (e) {
    const t = e.target;
    if (!t) return;
    if (t.id === 'TopicTime' || (t.classList && t.classList.contains('hasDatepicker'))) {
      maybeInjectDatepicker();
    }
  }, { passive: true });

  // ---------------------------------------------------------------
  // Turnstile / reCAPTCHA — unchanged
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  // Emoji picker CSS — lazy-load on editor pages
  // ---------------------------------------------------------------
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".ve-btn-emoji") || e.target.closest("#emoticons");
    if (!btn) return;
    if (document.body && config.emojiEditorPages.includes(document.body.id)) {
      injectEmojiCSS();
    }
  }, { passive: true });

  // ---------------------------------------------------------------
  // Release trapped assets at idle — unchanged
  // ---------------------------------------------------------------
  window.addEventListener("load", () => {
    const releaseAssets = () => {
      console.log(logBuffer);

      document.querySelectorAll('script[type="text/plain"]').forEach((oldScript) => {
        const src = oldScript.dataset.original;
        if (!src) return;

        // Swap in minified variants where available
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

  // ---------------------------------------------------------------
  // Cleanup on page unload — unchanged
  // ---------------------------------------------------------------
  window.addEventListener("beforeunload", () => {
    if (observer) observer.disconnect();
    state.observerDisconnected = true;
  }, { once: true });
})();
