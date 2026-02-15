(() => {
    "use strict";
    
    // ===== PART 1: Lazy Loading & Async Decoding Setup =====
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
                    } catch (err) {}
                    try {
                        o.set.call(this, value);
                    } catch (err) {
                        try {
                            Object.defineProperty(this, t, { value: value, writable: true });
                        } catch (err2) {}
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
    
    // ===== PART 2: Format Conversion with Cloudflare =====
    
    // Check if URL should be skipped (SVG or already optimized)
    function shouldSkipImage(url) {
        if (!url) return true;
        
        var lowerUrl = url.toLowerCase();
        
        // Skip SVG files (Cloudflare doesn't resize them anyway)
        if (lowerUrl.indexOf('.svg') !== -1 || lowerUrl.indexOf('.svg?') !== -1 || lowerUrl.indexOf('.svg#') !== -1) {
            return true;
        }
        
        // Skip if it's already a Cloudflare optimized URL
        if (lowerUrl.indexOf('/cdn-cgi/image/') !== -1) {
            return true;
        }
        
        // Skip data URLs
        if (lowerUrl.indexOf('data:') === 0) {
            return true;
        }
        
        return false;
    }
    
    // Check if browser supports AVIF
    function supportsAVIF() {
        var canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        return canvas.toDataURL('image/avif').indexOf('image/avif') === 5;
    }
    
    // Check if URL is a GIF
    function isGIF(url) {
        if (!url) return false;
        var lowerUrl = url.toLowerCase();
        return lowerUrl.indexOf('.gif') !== -1 || 
               lowerUrl.indexOf('.gif?') !== -1 || 
               lowerUrl.indexOf('.gif#') !== -1;
    }
    
    // Convert a single image to optimized format using Cloudflare
    function convertToOptimalFormat(img) {
        var originalSrc = img.src;
        
        // Skip if not an external image or already processed
        if (originalSrc.indexOf('http') !== 0 || img.getAttribute('data-optimized') === 'true') {
            return;
        }
        
        // Skip images that don't need conversion
        if (shouldSkipImage(originalSrc)) {
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        // Add marker to prevent reprocessing
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-original-src', originalSrc);
        
        // Extract domain and path for Cloudflare URL
        // Cloudflare transformations work by prefixing /cdn-cgi/image/options/ to the original URL
        // Format: https://example.com/cdn-cgi/image/width=800,quality=85,format=auto/path/to/image.jpg
        
        var urlParts = originalSrc.split('://');
        var protocol = urlParts[0];
        var restOfUrl = urlParts[1];
        
        // Build Cloudflare transformation options
        var options = [];
        
        // For GIFs: preserve animation with animated WebP
        if (isGIF(originalSrc)) {
            options.push('format=webp');
            options.push('anim=true'); // Preserve animation
            options.push('lossless=true'); // Keep quality
            options.push('quality=100'); // Max quality for animations
        } else {
            // For non-GIFs: use AVIF if supported, otherwise WebP
            var format = supportsAVIF() ? 'avif' : 'webp';
            options.push('format=' + format);
            
            // Lossless for PNGs, high quality for others
            if (originalSrc.toLowerCase().indexOf('.png') !== -1) {
                options.push('lossless=true');
            } else {
                options.push('quality=85');
            }
        }
        
        // Build the Cloudflare URL
        // We need to insert /cdn-cgi/image/options/ after the domain
        var domainEndIndex = restOfUrl.indexOf('/');
        if (domainEndIndex === -1) {
            // No path, just domain
            var cloudflareSrc = protocol + '://' + restOfUrl + '/cdn-cgi/image/' + options.join(',') + '/';
        } else {
            var domain = restOfUrl.substring(0, domainEndIndex);
            var path = restOfUrl.substring(domainEndIndex);
            var cloudflareSrc = protocol + '://' + domain + '/cdn-cgi/image/' + options.join(',') + path;
        }
        
        // Fallback to original if Cloudflare processing fails
        img.onerror = function() {
            this.src = this.getAttribute('data-original-src');
        };
        
        // Set the new source
        img.src = cloudflareSrc;
    }
    
    // Process all existing images
    function processAllImages() {
        var images = document.querySelectorAll('img');
        for (var i = 0; i < images.length; i++) {
            convertToOptimalFormat(images[i]);
        }
    }
    
    // ===== PART 3: Unified Mutation Observer =====
    
    const unifiedObserver = new MutationObserver((mutations) => {
        for (let t = 0; t < mutations.length; t++) {
            const mutation = mutations[t];
            if (mutation.type !== "childList") continue;
            
            for (let i = 0; i < mutation.addedNodes.length; i++) {
                const node = mutation.addedNodes[i];
                if (node.nodeType !== 1) continue;
                
                // Apply lazy loading attributes first
                d(node);
                if (node.querySelectorAll) {
                    const elements = node.querySelectorAll("img, iframe");
                    for (let j = 0; j < elements.length; j++) {
                        d(elements[j]);
                    }
                }
                
                // Then convert images to optimal format
                if (node.nodeName === 'IMG') {
                    if (node.getAttribute('data-optimized') !== 'true' && node.getAttribute('data-optimized') !== 'skipped') {
                        convertToOptimalFormat(node);
                    }
                }
                if (node.querySelectorAll) {
                    const newImages = node.querySelectorAll('img');
                    for (let j = 0; j < newImages.length; j++) {
                        var img = newImages[j];
                        if (img.getAttribute('data-optimized') !== 'true' && img.getAttribute('data-optimized') !== 'skipped') {
                            convertToOptimalFormat(img);
                        }
                    }
                }
            }
        }
    });
    
    // ===== PART 4: Reporting =====
    
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
        let webpCount = 0;
        let avifCount = 0;
        let gifCount = 0;
        let originalCount = 0;
        
        for (let o = 0; o < c.length; o++) {
            var img = c[o];
            if (img.getAttribute("loading") === e) r++;
            if (img.getAttribute("decoding") === t) l++;
            
            // Count formats
            var src = img.src.toLowerCase();
            var isCloudflare = src.indexOf('/cdn-cgi/image/') !== -1;
            
            if (isCloudflare) {
                if (src.indexOf('format=avif') !== -1) avifCount++;
                else if (src.indexOf('format=webp') !== -1) {
                    if (src.indexOf('anim=true') !== -1) gifCount++;
                    else webpCount++;
                }
            } else {
                originalCount++;
            }
        }
        
        console.log("Existing images: " + r + "/" + c.length + " lazy, " + l + "/" + c.length + " async");
        console.log("Format conversion: " + webpCount + " WebP, " + avifCount + " AVIF, " + gifCount + " Animated, " + originalCount + " original");
        console.log("Total elements monitored: " + i);
        
        if (i > 0) {
            const e = Math.round((n / i) * 100);
            console.log("Successfully optimized before load: " + n + "/" + i + " (" + e + "%)");
        }
        console.log("=== REPORT COMPLETE ===");
    };
    
    // ===== PART 5: Unified Initialization =====
    
    const h = () => {
        // Apply lazy loading to existing elements
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", f);
        } else {
            f();
        }
        
        // Set up unified observer
        if (document.body) {
            unifiedObserver.observe(document.body, { childList: true, subtree: true });
        } else {
            const bodyObserver = new MutationObserver(function (mutations, obs) {
                if (document.body) {
                    unifiedObserver.observe(document.body, { childList: true, subtree: true });
                    obs.disconnect();
                }
            });
            bodyObserver.observe(document.documentElement, { childList: true });
        }
        
        // Process existing images for format conversion
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", processAllImages);
        } else {
            processAllImages();
        }
        
        // Report after page load
        window.addEventListener("load", function () {
            setTimeout(p, 1000);
        });
    };
    
    // Start everything
    if (typeof Promise !== "undefined") {
        Promise.resolve().then(h);
    } else {
        setTimeout(h, 0);
    }
})();
