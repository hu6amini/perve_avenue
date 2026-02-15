(() => {
    "use strict";
    
    // ===== PART 1: Constants & Configuration =====
    const LAZY = "lazy";
    const ASYNC = "async";
    const CDN_BASE = 'https://images.weserv.nl/';
    
    // Media types that need special handling
    const SKIP_PATTERNS = [
        '.svg', '.gif', '.webp', '.avif',
        'output=webp', 'output=avif'
    ].map(function(pattern) { return pattern.toLowerCase(); });
    
    // Tracking for performance monitoring
    const loadEvents = [];
    let successCount = 0;
    let totalMonitored = 0;
    
    // ===== PART 2: Lazy Loading & Async Decoding Setup =====
    
    // Cache the original methods
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const originalSetAttribute = Element.prototype.setAttribute;
    const originalCreateElement = document.createElement;
    const OriginalImage = window.Image;
    
    // Helper functions
    function isMediaElement(el) {
        return el && (el.tagName === 'IMG' || el.tagName === 'IFRAME');
    }
    
    function needsLoading(el) {
        return !el.hasAttribute('loading') || el.getAttribute('loading') === '';
    }
    
    function needsDecoding(el) {
        return el.tagName === 'IMG' && (!el.hasAttribute('decoding') || el.getAttribute('decoding') === '');
    }
    
    function applyLazyAttributes(el) {
        if (!isMediaElement(el)) return el;
        
        if (needsLoading(el)) {
            el.setAttribute('loading', LAZY);
        }
        
        if (needsDecoding(el)) {
            el.setAttribute('decoding', ASYNC);
        }
        
        return el;
    }
    
    // Intercept addEventListener to track load events
    EventTarget.prototype.addEventListener = function(event, listener, options) {
        if ((event === 'load' || event === 'error') && isMediaElement(this)) {
            totalMonitored++;
            
            const element = this;
            const startTime = performance.now();
            const initialLoading = element.getAttribute('loading');
            const initialDecoding = element.getAttribute('decoding');
            
            const trackingData = {
                element: element.tagName,
                src: element.src || element.getAttribute('src') || '[no-src]',
                initialLoading: initialLoading,
                initialDecoding: initialDecoding,
                startTime: startTime,
                loadEventAttached: true
            };
            
            loadEvents.push(trackingData);
            
            if (initialLoading === LAZY && (element.tagName !== 'IMG' || initialDecoding === ASYNC)) {
                successCount++;
                trackingData.success = true;
                trackingData.timing = 'before';
            } else {
                trackingData.success = false;
            }
            
            function wrappedListener(evt) {
                const finalLoading = element.getAttribute('loading');
                const finalDecoding = element.getAttribute('decoding');
                const loadTime = performance.now();
                
                trackingData.finalLoading = finalLoading;
                trackingData.finalDecoding = finalDecoding;
                trackingData.loadTime = loadTime;
                trackingData.loaded = true;
                
                if (!trackingData.success && finalLoading === LAZY && 
                    (element.tagName !== 'IMG' || finalDecoding === ASYNC)) {
                    successCount++;
                    trackingData.success = true;
                    trackingData.timing = 'during';
                }
                
                if (listener && typeof listener === 'function') {
                    listener.call(this, evt);
                }
            }
            
            return originalAddEventListener.call(this, event, wrappedListener, options);
        }
        
        return originalAddEventListener.call(this, event, listener, options);
    };
    
    // Intercept setAttribute for src/srcset changes
    Element.prototype.setAttribute = function(name, value) {
        if ((name === 'src' || name === 'srcset') && isMediaElement(this)) {
            applyLazyAttributes(this);
        }
        return originalSetAttribute.call(this, name, value);
    };
    
    // Intercept src property setters
    function overrideSrcSetter(proto, prop) {
        if (!proto) return;
        
        const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
        if (descriptor && descriptor.set) {
            Object.defineProperty(proto, prop, {
                set: function(value) {
                    try { applyLazyAttributes(this); } catch (err) {}
                    try { descriptor.set.call(this, value); } catch (err) {}
                },
                get: descriptor.get,
                configurable: true
            });
        }
    }
    
    overrideSrcSetter(HTMLImageElement && HTMLImageElement.prototype, 'src');
    overrideSrcSetter(HTMLIFrameElement && HTMLIFrameElement.prototype, 'src');
    
    // Intercept document.createElement
    document.createElement = function(tagName, options) {
        const element = originalCreateElement.call(this, tagName, options);
        return applyLazyAttributes(element);
    };
    
    // Intercept Image constructor
    if (OriginalImage) {
        window.Image = function(width, height) {
            const img = new OriginalImage(width, height);
            img.setAttribute('loading', LAZY);
            img.setAttribute('decoding', ASYNC);
            return img;
        };
        window.Image.prototype = OriginalImage.prototype;
    }
    
    // Apply to existing elements without attributes
    function applyToExisting() {
        const selectors = [
            'img:not([loading]), img[loading=""]', 
            'iframe:not([loading]), iframe[loading=""]', 
            'img:not([decoding]), img[decoding=""]'
        ];
        
        const elements = document.querySelectorAll(selectors.join(', '));
        for (var i = 0; i < elements.length; i++) {
            applyLazyAttributes(elements[i]);
        }
    }
    
    // ===== PART 3: Format Conversion Functions =====
    
    function shouldSkipImage(url) {
        if (!url) return true;
        
        var lowerUrl = url.toLowerCase();
        
        // Data URLs
        if (lowerUrl.indexOf('data:') === 0) return true;
        
        // Check against skip patterns
        for (var i = 0; i < SKIP_PATTERNS.length; i++) {
            if (lowerUrl.indexOf(SKIP_PATTERNS[i]) !== -1) {
                return true;
            }
        }
        
        return false;
    }
    
    function supportsAVIF() {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            var dataURL = canvas.toDataURL('image/avif');
            return dataURL.indexOf('image/avif') !== -1;
        } catch (err) {
            return false;
        }
    }
    
    function convertToOptimalFormat(img) {
        var originalSrc = img.src;
        
        // Skip if not external, already processed, or should be skipped
        if (originalSrc.indexOf('http') !== 0 || 
            img.getAttribute('data-optimized') === 'true' || 
            img.getAttribute('data-optimized') === 'skipped') {
            return;
        }
        
        if (shouldSkipImage(originalSrc)) {
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        // Mark as processing
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-original-src', originalSrc);
        
        // Choose format based on browser support
        var format = supportsAVIF() ? 'avif' : 'webp';
        
        // Construct CDN URL with string concatenation
        var encodedUrl = encodeURIComponent(originalSrc);
        var optimizedSrc = CDN_BASE + '?url=' + encodedUrl + '&output=' + format + '&lossless=true';
        
        // Set fallback
        img.onerror = function() {
            this.src = this.getAttribute('data-original-src');
        };
        
        // Update src
        img.src = optimizedSrc;
    }
    
    function processAllImages() {
        var images = document.querySelectorAll('img');
        for (var i = 0; i < images.length; i++) {
            convertToOptimalFormat(images[i]);
        }
    }
    
    // ===== PART 4: Unified Mutation Observer =====
    
    var unifiedObserver = new MutationObserver(function(mutations) {
        for (var m = 0; m < mutations.length; m++) {
            var mutation = mutations[m];
            if (mutation.type !== 'childList') continue;
            
            var addedNodes = mutation.addedNodes;
            for (var n = 0; n < addedNodes.length; n++) {
                var node = addedNodes[n];
                if (node.nodeType !== 1) continue; // Node.ELEMENT_NODE = 1
                
                // Apply lazy loading attributes first
                applyLazyAttributes(node);
                
                // Check for nested media elements
                if (node.querySelectorAll) {
                    var mediaElements = node.querySelectorAll('img, iframe');
                    for (var me = 0; me < mediaElements.length; me++) {
                        applyLazyAttributes(mediaElements[me]);
                    }
                }
                
                // Then convert images (skips GIFs automatically)
                if (node.tagName === 'IMG' && !node.getAttribute('data-optimized')) {
                    convertToOptimalFormat(node);
                }
                
                if (node.querySelectorAll) {
                    var nestedImages = node.querySelectorAll('img');
                    for (var ni = 0; ni < nestedImages.length; ni++) {
                        var img = nestedImages[ni];
                        if (!img.getAttribute('data-optimized')) {
                            convertToOptimalFormat(img);
                        }
                    }
                }
            }
        }
    });
    
    // ===== PART 5: Performance Reporting =====
    
    function generateReport() {
        console.log('=== MEDIA OPTIMIZER REPORT ===');
        
        // Test element creation
        var testImg = document.createElement('img');
        console.log('createElement: loading=' + testImg.getAttribute('loading') + ', decoding=' + testImg.getAttribute('decoding'));
        
        if (window.Image) {
            var imgConst = new Image();
            console.log('imageConstructor: loading=' + imgConst.getAttribute('loading') + ', decoding=' + imgConst.getAttribute('decoding'));
        }
        
        // Analyze all images
        var images = document.querySelectorAll('img');
        var lazyCount = 0;
        var asyncCount = 0;
        var webpCount = 0;
        var avifCount = 0;
        var gifCount = 0;
        var svgCount = 0;
        var otherCount = 0;
        
        for (var i = 0; i < images.length; i++) {
            var img = images[i];
            if (img.getAttribute('loading') === LAZY) lazyCount++;
            if (img.getAttribute('decoding') === ASYNC) asyncCount++;
            
            var src = img.src.toLowerCase();
            
            if (src.indexOf('.gif') !== -1 || src.indexOf('.gif?') !== -1) {
                gifCount++;
            } else if (src.indexOf('.svg') !== -1 || src.indexOf('.svg?') !== -1) {
                svgCount++;
            } else if (src.indexOf('.webp') !== -1 || src.indexOf('output=webp') !== -1) {
                webpCount++;
            } else if (src.indexOf('.avif') !== -1 || src.indexOf('output=avif') !== -1) {
                avifCount++;
            } else {
                otherCount++;
            }
        }
        
        console.log('Images: ' + lazyCount + '/' + images.length + ' lazy, ' + asyncCount + '/' + images.length + ' async');
        console.log('Formats: ' + webpCount + ' WebP, ' + avifCount + ' AVIF, ' + gifCount + ' GIF, ' + svgCount + ' SVG, ' + otherCount + ' other');
        
        var successRate = totalMonitored > 0 ? Math.round((successCount / totalMonitored) * 100) : 0;
        console.log('Monitored: ' + totalMonitored + ' total, ' + successCount + ' optimized before load (' + successRate + '%)');
        
        // Check for late optimizations
        var lateOptimizations = [];
        for (var j = 0; j < loadEvents.length; j++) {
            var evt = loadEvents[j];
            if (!evt.success || evt.timing === 'during') {
                lateOptimizations.push(evt);
            }
        }
        
        if (lateOptimizations.length > 0) {
            console.warn('⚠️ ' + lateOptimizations.length + ' elements optimized late:');
            var maxShow = Math.min(lateOptimizations.length, 3);
            for (var k = 0; k < maxShow; k++) {
                var e = lateOptimizations[k];
                var shortSrc = e.src.length > 50 ? e.src.substring(0, 47) + '...' : e.src;
                console.warn('  ' + (k+1) + '. ' + e.element + ' - ' + shortSrc);
            }
        } else {
            console.log('✅ All elements optimized before load');
        }
        
        console.log('=== REPORT COMPLETE ===');
    }
    
    // ===== PART 6: Initialization =====
    
    function initialize() {
        // Apply to existing elements
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', applyToExisting);
        } else {
            applyToExisting();
        }
        
        // Set up observer
        if (document.body) {
            unifiedObserver.observe(document.body, { childList: true, subtree: true });
        } else {
            // Wait for body to exist
            var bodyObserver = new MutationObserver(function(mutations, obs) {
                if (document.body) {
                    unifiedObserver.observe(document.body, { childList: true, subtree: true });
                    obs.disconnect();
                }
            });
            bodyObserver.observe(document.documentElement, { childList: true });
        }
        
        // Process existing images for format conversion
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', processAllImages);
        } else {
            processAllImages();
        }
        
        // Generate report after load
        window.addEventListener('load', function() {
            setTimeout(generateReport, 1000);
        });
    }
    
    // Start
    if (typeof Promise !== 'undefined') {
        Promise.resolve().then(initialize);
    } else {
        setTimeout(initialize, 0);
    }
})();
