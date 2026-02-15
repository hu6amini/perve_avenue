(() => {
    "use strict";
    const e = "lazy";
    const t = "async";
    let o = [];
    let n = 0;
    let i = 0;
    
    // Add blacklist for iframes we want to exclude
    const IFRAME_BLACKLIST = {
        ids: ['__tcfapiLocator', 'rufous-sandbox'],
        // You can add more IDs here as needed
    };
    
    const s = EventTarget.prototype.addEventListener;
    
    // Helper function to check if iframe should be excluded
    const shouldExcludeIframe = (element) => {
        if (element.tagName !== 'IFRAME') return false;
        
        // Check by ID
        if (element.id && IFRAME_BLACKLIST.ids.includes(element.id)) {
            return true;
        }
        
        return false;
    };
    
    EventTarget.prototype.addEventListener = function (r, l, d) {
        if ((r === "load" || r === "error") && c(this)) {
            // Skip monitoring for blacklisted iframes
            if (shouldExcludeIframe(this)) {
                return s.call(this, r, l, d);
            }
            
            i++;
            const c = this;
            const a = performance.now();
            const g = c.getAttribute("loading");
            const u = c.getAttribute("decoding");
            const m = {
                element: c.tagName,
                src: c.src || c.getAttribute("src") || "[no-src]",
                initialLoading: g,
                initialDecoding: u,
                startTime: a,
                loadEventAttached: true
            };
            o.push(m);
            if (g === e && (c.tagName !== "IMG" || u === t)) {
                n++;
                m.success = true;
                m.timing = "before";
            } else {
                m.success = false;
            }
            const f = function (o) {
                const i = c.getAttribute("loading");
                const s = c.getAttribute("decoding");
                const r = performance.now();
                m.finalLoading = i;
                m.finalDecoding = s;
                m.loadTime = r;
                m.loaded = true;
                if (!m.success && i === e && (c.tagName !== "IMG" || s === t)) {
                    n++;
                    m.success = true;
                    m.timing = "during";
                }
                if (l && typeof l == "function") {
                    l.call(this, o);
                }
            };
            return s.call(this, r, f, d);
        }
        return s.call(this, r, l, d);
    };
    
    const c = (e) => e && (e.tagName === "IMG" || e.tagName === "IFRAME");
    const r = (e) => !e.hasAttribute("loading") || e.getAttribute("loading") === "";
    const l = (e) => e.tagName === "IMG" && (!e.hasAttribute("decoding") || e.getAttribute("decoding") === "");
    
    const d = (o) => {
        if (!c(o)) return o;
        
        // Skip optimization for blacklisted iframes
        if (shouldExcludeIframe(o)) {
            return o;
        }
        
        if (r(o)) {
            o.setAttribute("loading", e);
        }
        if (l(o)) {
            o.setAttribute("decoding", t);
        }
        return o;
    };
    
    const a = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (e, t) {
        if ((e === "src" || e === "srcset") && c(this)) {
            // Check blacklist before optimizing
            if (!shouldExcludeIframe(this)) {
                d(this);
            }
        }
        return a.call(this, e, t);
    };
    
    const g = (e, t) => {
        if (!e) return;
        const o = Object.getOwnPropertyDescriptor(e, t);
        if (o && o.set) {
            Object.defineProperty(e, t, {
                set: function (value) {
                    try {
                        // Check blacklist before optimizing
                        if (!shouldExcludeIframe(this)) {
                            d(this);
                        }
                    } catch (err) {
                        // If optimization fails, continue anyway
                    }
                    try {
                        o.set.call(this, value);
                    } catch (err) {
                        // If setter fails, try to set the property directly
                        try {
                            Object.defineProperty(this, t, { value: value, writable: true });
                        } catch (err2) {
                            // Last resort - ignore
                        }
                    }
                },
                get: o.get,
                configurable: true
            });
        }
    };
    
    g(HTMLImageElement && HTMLImageElement.prototype, "src");
    g(HTMLIFrameElement && HTMLIFrameElement.prototype, "src");
    
    const u = document.createElement;
    document.createElement = function (e, t) {
        const o = u.call(this, e, t);
        // Skip blacklist check here since element doesn't have ID/attributes yet
        // The attributes will be handled when src is set
        return d(o);
    };
    
    const m = window.Image;
    if (m) {
        window.Image = function (o, n) {
            const i = new m(o, n);
            // Images are always optimized (no blacklist for images)
            i.setAttribute("loading", e);
            i.setAttribute("decoding", t);
            return i;
        };
        window.Image.prototype = m.prototype;
    }
    
    const f = () => {
        const e = ['img:not([loading]), img[loading=""]', 'iframe:not([loading]), iframe[loading=""]', 'img:not([decoding]), img[decoding=""]'];
        const t = document.querySelectorAll(e.join(", "));
        for (let e = 0; e < t.length; e++) {
            // Check blacklist before optimizing
            if (!shouldExcludeIframe(t[e])) {
                d(t[e]);
            }
        }
    };
    
    const b = new MutationObserver((e) => {
        for (let t = 0; t < e.length; t++) {
            const o = e[t];
            if (o.type !== "childList") continue;
            for (let e = 0; e < o.addedNodes.length; e++) {
                const t = o.addedNodes[e];
                if (t.nodeType !== 1) continue;
                
                // Check blacklist before optimizing the element itself
                if (!shouldExcludeIframe(t)) {
                    d(t);
                }
                
                if (t.querySelectorAll) {
                    const e = t.querySelectorAll("img, iframe");
                    for (let t = 0; t < e.length; t++) {
                        // Check blacklist for each child element
                        if (!shouldExcludeIframe(e[t])) {
                            d(e[t]);
                        }
                    }
                }
            }
        }
    });
    
    const p = () => {
        console.log("=== MEDIA OPTIMIZER REPORT ===");
        const s = document.createElement("img");
        console.log("createElement: loading=" + s.getAttribute("loading") + ", decoding=" + s.getAttribute("decoding"));
        if (window.Image) {
            const e = new Image();
            console.log("imageConstructor: loading=" + e.getAttribute("loading") + ", decoding=" + e.getAttribute("decoding"));
        }
        
        // Check blacklisted iframes to confirm they weren't modified
        IFRAME_BLACKLIST.ids.forEach(id => {
            const iframe = document.getElementById(id);
            if (iframe) {
                console.log(`Blacklisted iframe #${id}: loading=${iframe.getAttribute("loading") || 'not set'}`);
            }
        });
        
        const c = document.querySelectorAll("img");
        let r = 0;
        let l = 0;
        for (let o = 0; o < c.length; o++) {
            if (c[o].getAttribute("loading") === e) r++;
            if (c[o].getAttribute("decoding") === t) l++;
        }
        console.log("Existing images: " + r + "/" + c.length + " lazy, " + l + "/" + c.length + " async");
        console.log("Total elements monitored: " + i);
        if (i > 0) {
            const e = Math.round((n / i) * 100);
            console.log("Successfully optimized before load: " + n + "/" + i + " (" + e + "%)");
            if (n === i) {
                console.log("✅ All attributes set BEFORE element load");
            } else {
                console.log("⚠️ " + (i - n) + " elements loaded before optimization");
                for (let e = 0; e < o.length; e++) {
                    const t = o[e];
                    if (!t.success || t.timing === "during") {
                        console.warn("Late optimization #" + e + ": " + t.element + " - " + t.src);
                    }
                }
            }
        } else {
            console.log("No load events monitored (static page or no new images)");
        }
        console.log("=== REPORT COMPLETE ===");
    };
    
    const h = () => {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", f);
        } else {
            f();
        }
        if (document.body) {
            b.observe(document.body, { childList: true, subtree: true });
        } else {
            const e = new MutationObserver(function (e, t) {
                if (document.body) {
                    b.observe(document.body, { childList: true, subtree: true });
                    t.disconnect();
                }
            });
            e.observe(document.documentElement, { childList: true });
        }
        // Single report 1 second after page load
        window.addEventListener("load", function () {
            setTimeout(p, 1000);
        });
    };
    
    if (typeof Promise !== "undefined") {
        Promise.resolve().then(h);
    } else {
        setTimeout(h, 0);
    }
})();
