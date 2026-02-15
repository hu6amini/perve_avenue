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
    
    // ===== PART 2: Format Detection and Conversion Functions =====
    
    // Function to check if URL is an animated GIF
    function isAnimatedGif(url) {
        if (!url) return false;
        var lowerUrl = url.toLowerCase();
        return lowerUrl.indexOf('.gif') !== -1 || 
               lowerUrl.indexOf('.gif?') !== -1 || 
               lowerUrl.indexOf('.gif#') !== -1;
    }
    
    // Function to check if URL should be skipped (already optimized)
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
        
        // Skip WebM/MP4 video files
        if (lowerUrl.indexOf('.webm') !== -1 || lowerUrl.indexOf('.mp4') !== -1) {
            return true;
        }
        
        // Skip if it's already from our CDN
        if (lowerUrl.indexOf('output=avif') !== -1 || lowerUrl.indexOf('output=webp') !== -1 || 
            lowerUrl.indexOf('output=webm') !== -1 || lowerUrl.indexOf('output=mp4') !== -1) {
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
    
    // Function to replace an image with a video element (for GIFs)
    function replaceGifWithVideo(img, videoSrc, posterSrc) {
        // Create video element
        var video = document.createElement('video');
        video.setAttribute('autoplay', '');
        video.setAttribute('loop', '');
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        
        // Copy relevant attributes from original img
        if (img.className) video.className = img.className;
        if (img.id) video.id = img.id;
        if (img.style.cssText) video.style.cssText = img.style.cssText;
        if (img.width) video.width = img.width;
        if (img.height) video.height = img.height;
        if (img.alt) video.alt = img.alt;
        
        // Add loading="lazy" if it was on the original
        if (img.getAttribute('loading') === 'lazy') {
            video.setAttribute('loading', 'lazy');
        }
        
        // Set poster image (first frame) - optional
        if (posterSrc) {
            video.setAttribute('poster', posterSrc);
        }
        
        // Add source elements
        var webmSource = document.createElement('source');
        webmSource.src = videoSrc + '&output=webm';
        webmSource.type = 'video/webm';
        
        var mp4Source = document.createElement('source');
        mp4Source.src = videoSrc + '&output=mp4';
        mp4Source.type = 'video/mp4';
        
        video.appendChild(webmSource);
        video.appendChild(mp4Source);
        
        // Add fallback text for very old browsers
        var fallback = document.createTextNode('Your browser does not support the video tag.');
        video.appendChild(fallback);
        
        // Replace img with video
        img.parentNode.replaceChild(video, img);
        
        return video;
    }
    
    // Function to convert a single image to optimal format
    function convertToOptimalFormat(img) {
        var originalSrc = img.src;
        
        // Skip if not an external image or already processed
        if (originalSrc.indexOf('http') !== 0 || img.getAttribute('data-optimized') === 'true') {
            return;
        }
        
        // Skip data URLs
        if (originalSrc.indexOf('data:') === 0) {
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        // Check if it's an animated GIF
        var isGif = isAnimatedGif(originalSrc);
        
        // Skip SVG and already optimized images (but process GIFs separately)
        if (!isGif && shouldSkipImage(originalSrc)) {
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        // Add a marker to prevent reprocessing
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-original-src', originalSrc);
        
        // Construct CDN URL base
        var cdnBase = 'https://images.weserv.nl/';
        var cdnParams = '?url=' + encodeURIComponent(originalSrc);
        
        if (isGif) {
            // For GIFs: convert to video format (WebM + MP4) and replace with <video> element
            console.log('Converting animated GIF to video:', originalSrc);
            
            // Optional: Get a static poster image (first frame) as WebP
            var posterSrc = cdnBase + cdnParams + '&output=webp&lossless=true';
            
            // Replace img with video element
            replaceGifWithVideo(img, cdnBase + cdnParams, posterSrc);
        } else {
            // For static images: convert to WebP or AVIF
            var useAVIF = supportsAVIF();
            var format = useAVIF ? 'avif' : 'webp';
            
            var optimizedSrc = cdnBase + cdnParams + '&output=' + format + '&lossless=true';
            
            // Try optimized version, fallback to original if it fails
            img.onerror = function() {
                this.src = this.getAttribute('data-original-src');
            };
            
            // Set the new source
            img.src = optimizedSrc;
        }
    }
    
    // Process all images (called after lazy loading is set up)
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
                
                // First: Apply lazy loading attributes
                d(node);
                if (node.querySelectorAll) {
                    const elements = node.querySelectorAll("img, iframe");
                    for (let j = 0; j < elements.length; j++) {
                        d(elements[j]);
                    }
                }
                
                // Second: Convert images to optimal format
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
    
    // ===== PART 4: Reporting (enhanced) =====
    
    const p = () => {
        console.log("=== MEDIA OPTIMIZER REPORT ===");
        const s = document.createElement("img");
        console.log("createElement: loading=" + s.getAttribute("loading") + ", decoding=" + s.getAttribute("decoding"));
        if (window.Image) {
            const e = new Image();
            console.log("imageConstructor: loading=" + e.getAttribute("loading") + ", decoding=" + e.getAttribute("decoding"));
        }
        
        var allImages = document.querySelectorAll('img');
        var allVideos = document.querySelectorAll('video');
        var images = allImages; // For compatibility with existing code
        
        let r = 0;
        let l = 0;
        let webpCount = 0;
        let avifCount = 0;
        let gifToVideoCount = 0;
        
        // Count image formats
        for (let o = 0; o < allImages.length; o++) {
            var img = allImages[o];
            if (img.getAttribute("loading") === e) r++;
            if (img.getAttribute("decoding") === t) l++;
            
            var src = (img.src || '').toLowerCase();
            if (src.indexOf('.webp') !== -1 || src.indexOf('output=webp') !== -1) webpCount++;
            if (src.indexOf('.avif') !== -1 || src.indexOf('output=avif') !== -1) avifCount++;
        }
        
        // Count videos (converted GIFs)
        for (let o = 0; o < allVideos.length; o++) {
            var video = allVideos[o];
            if (video.getAttribute('data-original-src')) {
                gifToVideoCount++;
            }
        }
        
        console.log("Original images: " + allImages.length);
        console.log("Converted to WebP: " + webpCount);
        console.log("Converted to AVIF: " + avifCount);
        console.log("GIFs converted to video: " + gifToVideoCount);
        console.log("Images with lazy loading: " + r + "/" + allImages.length);
        console.log("Images with async decoding: " + l + "/" + allImages.length);
        console.log("Total elements monitored: " + i);
        
        if (i > 0) {
            const e = Math.round((n / i) * 100);
            console.log("Successfully optimized before load: " + n + "/" + i + " (" + e + "%)");
            if (n === i) {
                console.log("✅ All attributes set BEFORE element load");
            } else {
                console.log("⚠️ " + (i - n) + " elements loaded before optimization");
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
        
        // Step 4: Single report 1 second after page load
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
