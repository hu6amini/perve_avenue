(() => {
    "use strict";
    const e = "lazy";
    const t = "async";
    let o = [];
    let n = 0;
    let i = 0;
    const s = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (r, l, d) {
        if ((r === "load" || r === "error") && c(this)) {
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
            d(this);
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
                        d(this);
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
        return d(o);
    };
    const m = window.Image;
    if (m) {
        window.Image = function (o, n) {
            const i = new m(o, n);
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
            d(t[e]);
        }
    };
    const b = new MutationObserver((e) => {
        for (let t = 0; t < e.length; t++) {
            const o = e[t];
            if (o.type !== "childList") continue;
            for (let e = 0; e < o.addedNodes.length; e++) {
                const t = o.addedNodes[e];
                if (t.nodeType !== 1) continue;
                d(t);
                if (t.querySelectorAll) {
                    const e = t.querySelectorAll("img, iframe");
                    for (let t = 0; t < e.length; t++) {
                        d(e[t]);
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
