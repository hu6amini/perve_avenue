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
    
    // ===== PART 2: Format Conversion Functions =====
    
    // Function to check if URL should be skipped (SVG or already optimized)
    function shouldSkipImage(url) {
        if (!url) return true;
        
        var lowerUrl = url.toLowerCase();
        
        // Skip SVG files
        if (lowerUrl.indexOf('.svg') !== -1 || lowerUrl.indexOf('.svg?') !== -1 || lowerUrl.indexOf('.svg#') !== -1) {
            return true;
        }
        
        // Skip WebP files (already optimized)
        if (lowerUrl.indexOf('.webp') !== -1 || lowerUrl.indexOf('.webp?') !== -1 || lowerUrl.indexOf('.webp#') !== -1) {
            return true;
        }
        
        // Skip AVIF files (already optimized)
        if (lowerUrl.indexOf('.avif') !== -1 || lowerUrl.indexOf('.avif?') !== -1 || lowerUrl.indexOf('.avif#') !== -1) {
            return true;
        }
        
        // Skip if it's already from our CDN
        if (lowerUrl.indexOf('output=avif') !== -1 || lowerUrl.indexOf('output=webp') !== -1 || 
            lowerUrl.indexOf('output=mp4') !== -1 || lowerUrl.indexOf('output=webm') !== -1) {
            return true;
        }
        
        return false;
    }
    
    // Function to check if browser supports AVIF
    function supportsAVIF() {
        var canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        return canvas.toDataURL('image/avif').indexOf('image/avif') === 5;
    }
    
    // Function to check if URL is a GIF
    function isGifFile(url) {
        if (!url) return false;
        var lower = url.toLowerCase();
        return lower.indexOf('.gif') !== -1 || 
               lower.indexOf('.gif?') !== -1 || 
               lower.indexOf('.gif#') !== -1;
    }
    
    // Function to copy attributes from img to video
    function copyAttributes(source, target) {
        var attributes = ['class', 'id', 'style', 'width', 'height', 'alt', 'title', 'data-original-src'];
        for (var i = 0; i < attributes.length; i++) {
            var attr = attributes[i];
            if (source.hasAttribute(attr)) {
                target.setAttribute(attr, source.getAttribute(attr));
            }
        }
    }
    
    // Function to replace GIF with video
    function replaceGifWithVideo(img, originalSrc) {
        // Mark as processed
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-original-src', originalSrc);
        img.setAttribute('data-was-gif', 'true');
        
        // Create video element
        var video = document.createElement('video');
        
        // Copy useful attributes
        copyAttributes(img, video);
        
        // Video attributes for GIF-like behavior
        video.setAttribute('autoplay', 'true');
        video.setAttribute('loop', 'true');
        video.setAttribute('muted', 'true');
        video.setAttribute('playsinline', 'true');
        
        // Try WebM first (better quality), fallback to MP4
        var cdnBase = 'https://images.weserv.nl/';
        var encodedUrl = encodeURIComponent(originalSrc);
        
        var webmSrc = cdnBase + '?url=' + encodedUrl + '&output=webm';
        var mp4Src = cdnBase + '?url=' + encodedUrl + '&output=mp4';
        
        // Create source elements
        var webmSource = document.createElement('source');
        webmSource.setAttribute('src', webmSrc);
        webmSource.setAttribute('type', 'video/webm');
        
        var mp4Source = document.createElement('source');
        mp4Source.setAttribute('src', mp4Src);
        mp4Source.setAttribute('type', 'video/mp4');
        
        video.appendChild(webmSource);
        video.appendChild(mp4Source);
        
        // Fallback to original GIF if video fails
        video.onerror = function() {
            var fallbackImg = document.createElement('img');
            fallbackImg.src = originalSrc;
            copyAttributes(img, fallbackImg);
            fallbackImg.setAttribute('data-optimized', 'fallback');
            img.parentNode.replaceChild(fallbackImg, video);
        };
        
        // Replace the img with video
        img.parentNode.replaceChild(video, img);
    }
    
    // Function to convert regular images to WebP/AVIF
    function convertImageToOptimizedFormat(img, originalSrc) {
        // Add markers
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-original-src', originalSrc);
        
        // Determine which format to use
        var useAVIF = supportsAVIF();
        var format = useAVIF ? 'avif' : 'webp';
        
        // Construct CDN URL with format selection
        var cdnBase = 'https://images.weserv.nl/';
        var cdnParams = '?url=' + encodeURIComponent(originalSrc) + '&output=' + format + '&lossless=true';
        var optimizedSrc = cdnBase + cdnParams;
        
        // Try optimized version, fallback to original if it fails
        img.onerror = function() {
            this.src = this.getAttribute('data-original-src');
            this.setAttribute('data-optimized', 'fallback');
        };
        
        // Set the new source
        img.src = optimizedSrc;
    }
    
    // Main function to convert a single image to optimal format
    function convertToOptimalFormat(img) {
        var originalSrc = img.src;
        
        // Skip if not an external image or already processed
        if (originalSrc.indexOf('http') !== 0 || img.getAttribute('data-optimized') === 'true') {
            return;
        }
        
        // Skip if it's a video element
        if (img.tagName === 'VIDEO') {
            return;
        }
        
        // Handle GIFs specially
        if (isGifFile(originalSrc)) {
            replaceGifWithVideo(img, originalSrc);
            return;
        }
        
        // Skip SVG and already optimized images
        if (shouldSkipImage(originalSrc)) {
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        // Skip data URLs
        if (originalSrc.indexOf('data:') === 0) {
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        // Regular image conversion
        convertImageToOptimizedFormat(img, originalSrc);
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
                
                // Skip if it's a video element (already processed)
                if (node.tagName === 'VIDEO') continue;
                
                // First: Apply lazy loading attributes
                d(node);
                if (node.querySelectorAll) {
                    const elements = node.querySelectorAll("img, iframe");
                    for (let j = 0; j < elements.length; j++) {
                        d(elements[j]);
                    }
                }
                
                // Second: Convert images to optimal format
                if (node.tagName === 'IMG') {
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
    
    // ===== PART 4: Enhanced Reporting =====
    
    const p = () => {
        console.log("=== MEDIA OPTIMIZER REPORT ===");
        
        // Test element creation
        const s = document.createElement("img");
        console.log("createElement: loading=" + s.getAttribute("loading") + ", decoding=" + s.getAttribute("decoding"));
        
        if (window.Image) {
            const e = new Image();
            console.log("imageConstructor: loading=" + e.getAttribute("loading") + ", decoding=" + e.getAttribute("decoding"));
        }
        
        // Count statistics
        const allImages = document.querySelectorAll("img");
        const allVideos = document.querySelectorAll("video");
        let lazyCount = 0;
        let asyncCount = 0;
        let webpCount = 0;
        let avifCount = 0;
        let gifToVideoCount = 0;
        let skippedCount = 0;
        let fallbackCount = 0;
        
        // Count images
        for (let idx = 0; idx < allImages.length; idx++) {
            var img = allImages[idx];
            if (img.getAttribute("loading") === e) lazyCount++;
            if (img.getAttribute("decoding") === t) asyncCount++;
            
            var optimized = img.getAttribute('data-optimized');
            if (optimized === 'skipped') skippedCount++;
            if (optimized === 'fallback') fallbackCount++;
            
            var src = img.src.toLowerCase();
            if (src.indexOf('.webp') !== -1 || src.indexOf('output=webp') !== -1) webpCount++;
            if (src.indexOf('.avif') !== -1 || src.indexOf('output=avif') !== -1) avifCount++;
        }
        
        // Count videos (converted GIFs)
        for (let idx = 0; idx < allVideos.length; idx++) {
            var video = allVideos[idx];
            if (video.getAttribute('data-was-gif') === 'true') {
                gifToVideoCount++;
            }
        }
        
        console.log("Images: " + allImages.length + " total");
        console.log("Videos (converted GIFs): " + gifToVideoCount);
        console.log("Lazy loading: " + lazyCount + "/" + allImages.length);
        console.log("Async decoding: " + asyncCount + "/" + allImages.length);
        console.log("Format conversion: " + webpCount + " WebP, " + avifCount + " AVIF, " + gifToVideoCount + " GIF→Video");
        console.log("Skipped: " + skippedCount + " (SVG/existing optimized), Fallback: " + fallbackCount);
        
        // Load event monitoring stats
        console.log("Total elements monitored: " + i);
        if (i > 0) {
            const successRate = Math.round((n / i) * 100);
            console.log("Successfully optimized before load: " + n + "/" + i + " (" + successRate + "%)");
            if (n === i) {
                console.log("✅ All attributes set BEFORE element load");
            } else {
                console.log("⚠️ " + (i - n) + " elements loaded before optimization");
                for (let idx = 0; idx < o.length; idx++) {
                    const item = o[idx];
                    if (!item.success || item.timing === "during") {
                        console.warn("Late optimization #" + idx + ": " + item.element + " - " + item.src);
                    }
                }
            }
        } else {
            console.log("No load events monitored (static page or no new images)");
        }
        console.log("=== REPORT COMPLETE ===");
    };
    
    // ===== PART 5: Unified Initialization =====
    
    const h = () => {
        // Step 1: Apply lazy loading to existing elements
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", f);
        } else {
            f();
        }
        
        // Step 2: Set up unified observer
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
        
        // Step 3: Process existing images for format conversion (after lazy loading)
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", processAllImages);
        } else {
            processAllImages();
        }
        
        // Step 4: Single report 2 seconds after page load (giving time for conversions)
        window.addEventListener("load", function () {
            setTimeout(p, 2000);
        });
    };
    
    // Start everything
    if (typeof Promise !== "undefined") {
        Promise.resolve().then(h);
    } else {
        setTimeout(h, 0);
    }
})();
