/* Optimised Boot Loader – v8 (ordered release)
 *
 * Key change vs. v7:
 *   - Released scripts now use `async = false` instead of `defer = true`.
 *     `defer` is a NO-OP on dynamically-created scripts — the browser
 *     treats them as async by default, which scrambles execution order.
 *     `async = false` puts the script in the "execute in insertion order
 *     as soon as possible" queue, which is the real defer behaviour.
 *     Because the trapper only touched synchronous scripts, releasing
 *     them all with async=false preserves the original DOM order.
 *
 *   - `safeList` renamed to `neverTrap` and split conceptually into:
 *       • boot pipeline (perve_avenue modules in <head>)
 *       • forumfree core (jq.js, plugin_v3.js, script-loader)
 *     Any other file on cdn.jsdelivr.net/gh/hu6amini/perve_avenue is
 *     auto-exempt via URL match, so new modules need no config change.
 *
 *   - The Popper/tippy order guard is gone: ordered release guarantees
 *     popper.js (listed first in the DOM) executes before tippy.js.
 *
 *   - Logging is unconditional again. Pre-trapped (server-side) scripts
 *     are catalogued at startup, so you always see what's in the queue.
 */
"use strict";
(function () {
  let logBuffer = "[Bypass Active]:";

  const config = {
    // Must execute before DOMContentLoaded / before the boot pipeline
    // reads them. If a script is already loaded with async="" it won't
    // be trapped anyway — this list is the belt-and-suspenders for any
    // template that forgets the attribute.
    neverTrap: [
      // Boot pipeline
      "boot-loader",
      "dynamic-loader",
      "user-msg-loader",
      "media-optimizer",
      "event-bus",
      "forum_core_observer",
      "dom-utils",
      "media-dimensions",
      // forumfree core
      "jq.js",
      "plugin_v3.js",
      "script-loader"
    ],
    // Any file served from the perve_avenue repo is exempt regardless
    // of filename, so new modules don't need an entry above.
    perveAvenueCDN: "cdn.jsdelivr.net/gh/hu6amini/perve_avenue",
    // Never released at idle — loaded on first form interaction instead
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

  const getFileName = (url) => url.split("/").pop().split("?")[0];

  const isNeverTrap = (src) => {
    if (src.includes(config.perveAvenueCDN)) return true;
    const fileName = getFileName(src);
    return config.neverTrap.some((item) => fileName.includes(item) || src.includes(item));
  };

  const shouldSkipRelease = (src) =>
    config.skipRelease.some((item) => src.includes(item));

  // ---------------------------------------------------------------
  // Startup catalogue — server-side pre-trapped scripts
  // ---------------------------------------------------------------
  // These are emitted by the forum server already in trap form, so the
  // client-side trapper never sees them as live <script src>. Report
  // them up front so the log tells the whole story.
  (function cataloguePreTrapped() {
    const pre = document.querySelectorAll('script[type="text/plain"][data-original]');
    if (pre.length === 0) return;
    logBuffer += "\n\n\u25B8 Pre-trapped (server-side): " + pre.length;
    pre.forEach((el) => {
      logBuffer += "\n  \u00B7 " + getFileName(el.dataset.original || '');
    });
  })();

  // ---------------------------------------------------------------
  // <script> / <link> processing
  // ---------------------------------------------------------------
  const processElement = (el) => {
    const isScript = el.tagName === "SCRIPT";
    const isLink = el.tagName === "LINK" && el.rel === "stylesheet";
    if (!isScript && !isLink) return;

    const src = isScript ? (el.src || el.getAttribute("data-src")) : el.href;
    if (!src) return;

    // Everything in neverTrap is skipped entirely: no trap, no downgrade.
    if (isNeverTrap(src)) return;

    const fileName = getFileName(src);

    // Force-trap the heavy script-loader (only reachable if not in neverTrap)
    if (isScript && src.includes("script-loader")) {
      el.type = "text/plain";
      el.dataset.original = src;
      el.removeAttribute("src");
      logBuffer += "\n- Forced Trap (Loader): " + fileName;
      return;
    }

    // Force-trap reCAPTCHA — lazy-loaded on first form interaction
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
  };

  // ---------------------------------------------------------------
  // Style capture
  // ---------------------------------------------------------------
  const processCSSStyle = (styleEl) => {
    const text = styleEl.textContent || "";
    if (!text) return false;

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

        // Deferred-CSS triggers
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
  // uiDatepicker — inject on the specific interactions
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
  // Turnstile / reCAPTCHA — lazy on first form interaction
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
  // Release trapped assets at idle — ORDERED
  // ---------------------------------------------------------------
  window.addEventListener("load", () => {
    const releaseAssets = () => {
      const released = [];
      const skipped = [];

      // querySelectorAll returns document order — exactly what we want.
      // The trapper never moved nodes, only stripped src / type, so
      // the DOM order still reflects the original author order.
      document.querySelectorAll('script[type="text/plain"][data-original]').forEach((oldScript) => {
        const src = oldScript.dataset.original;
        if (!src) return;

        // Lazy-only scripts (turnstile / recaptcha) — loaded on form focus
        if (shouldSkipRelease(src)) {
          skipped.push(getFileName(src));
          return;
        }

        // Swap to minified variants where available
        if (src.includes("media-optimizer.js") && !src.includes(".min.js")) {
          const minSrc = src.replace(/media-optimizer\.js$/, "media-optimizer.min.js");
          const newScript = document.createElement("script");
          newScript.src = minSrc;
          newScript.type = "module";
          oldScript.parentNode.replaceChild(newScript, oldScript);
          released.push("media-optimizer.min.js (module)");
          return;
        }

        if (src.includes("event-bus.js") && !src.includes(".min.js")) {
          const minSrc = src.replace(/event-bus\.js$/, "event-bus.min.js");
          const newScript = document.createElement("script");
          newScript.src = minSrc;
          newScript.async = false;
          oldScript.parentNode.replaceChild(newScript, oldScript);
          released.push("event-bus.min.js");
          return;
        }

        // Normal release: async=false enforces insertion order.
        // This is the equivalent of defer for a dynamically-inserted
        // classic script. Setting .defer here would be a no-op.
        const newScript = document.createElement("script");
        newScript.src = src;
        newScript.async = false;
        oldScript.parentNode.replaceChild(newScript, oldScript);
        released.push(getFileName(src));
      });

      // Activate downgraded CSS
      document.querySelectorAll('link[media="print"]').forEach((link) => {
        if (!link.dataset.activated) {
          link.media = "all";
          link.dataset.activated = "true";
        }
      });

      if (released.length) {
        logBuffer += "\n\n\u25B8 Released in DOM order: " + released.length;
        released.forEach((name) => { logBuffer += "\n  \u00B7 " + name; });
      }
      if (skipped.length) {
        logBuffer += "\n\n\u25B8 Lazy-loaded on interaction: " + skipped.length;
        skipped.forEach((name) => { logBuffer += "\n  \u00B7 " + name; });
      }

      console.log(logBuffer);
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(releaseAssets, { timeout: 2000 });
    } else {
      setTimeout(releaseAssets, 1000);
    }
  });

  // ---------------------------------------------------------------
  // Cleanup on page unload
  // ---------------------------------------------------------------
  window.addEventListener("beforeunload", () => {
    if (observer) observer.disconnect();
    state.observerDisconnected = true;
  }, { once: true });
})();
