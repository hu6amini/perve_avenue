(function() {
    'use strict';
    
    // ===== PART 1: Constants & Configuration =====
    var LAZY = "lazy";
    var ASYNC = "async";
    var CDN_BASE = 'https://images.weserv.nl/';
    var DEFAULT_QUALITY = '100'; // Lossless quality for all images
    var CACHE_DURATION = '1y'; // Cache for up to 1 year
    
    // Media types that need special handling
    var SKIP_PATTERNS = [
        '.svg', '.webp', '.avif',  // REMOVED .gif from here!
        'output=webp', 'output=avif',
        // Skip DiceBear avatars (generated letter avatars)
        'dicebear.com',
        'api.dicebear.com',
        'dicebear',
        // Skip our forum avatar markers
        'forum-user-avatar',
        'forum-likes-avatar',
        'avatar-size-',
        // Skip already optimized images
        'images.weserv.nl',
        'wsrv.nl'
    ];
    
    // Convert patterns to lowercase for comparison
    for (var sp = 0; sp < SKIP_PATTERNS.length; sp++) {
        SKIP_PATTERNS[sp] = SKIP_PATTERNS[sp].toLowerCase();
    }
    
    // Tracking for performance monitoring
    var loadEvents = [];
    var successCount = 0;
    var totalMonitored = 0;
    
    // ===== PART 2: Lazy Loading & Async Decoding Setup =====
    
    // Cache the original methods
    var originalAddEventListener = EventTarget.prototype.addEventListener;
    var originalSetAttribute = Element.prototype.setAttribute;
    var originalCreateElement = document.createElement;
    var OriginalImage = window.Image;
    
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
            
            var element = this;
            var startTime = performance.now();
            var initialLoading = element.getAttribute('loading');
            var initialDecoding = element.getAttribute('decoding');
            
            var trackingData = {
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
                var finalLoading = element.getAttribute('loading');
                var finalDecoding = element.getAttribute('decoding');
                var loadTime = performance.now();
                
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
        
        var descriptor = Object.getOwnPropertyDescriptor(proto, prop);
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
        var element = originalCreateElement.call(this, tagName, options);
        return applyLazyAttributes(element);
    };
    
    // Intercept Image constructor
    if (OriginalImage) {
        window.Image = function(width, height) {
            var img = new OriginalImage(width, height);
            img.setAttribute('loading', LAZY);
            img.setAttribute('decoding', ASYNC);
            return img;
        };
        window.Image.prototype = OriginalImage.prototype;
    }
    
    // Apply to existing elements without attributes
    function applyToExisting() {
        var selectors = [
            'img:not([loading]), img[loading=""]', 
            'iframe:not([loading]), iframe[loading=""]', 
            'img:not([decoding]), img[decoding=""]'
        ];
        
        var elements = document.querySelectorAll(selectors.join(', '));
        for (var i = 0; i < elements.length; i++) {
            applyLazyAttributes(elements[i]);
        }
    }
    
    // ===== PART 3: Format Conversion Functions =====
    
    function shouldSkipImage(url, element) {
        if (!url) return true;
        
        var lowerUrl = url.toLowerCase();
        
        // Data URLs
        if (lowerUrl.indexOf('data:') === 0) return true;
        
        // Skip if it's our forum avatar (check by class)
        if (element && element.classList) {
            if (element.classList.contains('forum-user-avatar') ||
                element.classList.contains('forum-likes-avatar') ||
                element.classList.contains('avatar-size-')) {
                return true;
            }
        }
        
        // Skip if it has forum avatar data attributes
        if (element && element.hasAttribute) {
            if (element.hasAttribute('data-forum-avatar') ||
                element.hasAttribute('data-username')) {
                return true;
            }
        }
        
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
        
        // Check if this is our forum avatar (by class or data attribute)
        if (img.classList.contains('forum-user-avatar') ||
            img.classList.contains('forum-likes-avatar') ||
            img.hasAttribute('data-forum-avatar') ||
            img.getAttribute('data-username')) {
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        if (shouldSkipImage(originalSrc, img)) {
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        // Mark as processing
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-original-src', originalSrc);
        
        // Check if it's a GIF
        var isGif = originalSrc.toLowerCase().indexOf('.gif') !== -1;
        
        // Choose format and parameters
        var format;
        var params = [];
        
        // Add cache control
        params.push('maxage=' + CACHE_DURATION);
        
        // Add lossless quality for all images
        params.push('q=' + DEFAULT_QUALITY);
        params.push('lossless=true'); // Ensure lossless for all formats
        
        if (isGif) {
            // For GIFs, we want to preserve animation
            // Use WebP which has good browser support and supports animation
            format = 'webp';
            
            // Add parameter to preserve all frames for animation
            params.push('n=-1');
            
            // Add interlacing for progressive loading
            params.push('il');
            
        } else {
            // For non-GIFs, use best available format
            format = supportsAVIF() ? 'avif' : 'webp';
            
            // Add progressive/interlaced for better UX
            if (format === 'jpg' || format === 'jpeg') {
                params.push('il'); // Progressive JPEG
            } else if (format === 'png') {
                params.push('il'); // Interlaced PNG
            }
        }
        
        // Construct CDN URL
        var encodedUrl = encodeURIComponent(originalSrc);
        var optimizedSrc = CDN_BASE + '?url=' + encodedUrl + '&output=' + format;
        
        // Add all parameters
        if (params.length > 0) {
            optimizedSrc += '&' + params.join('&');
        }
        
        // Set fallback
        img.onerror = function() {
            // If CDN fails, revert to original
            this.src = this.getAttribute('data-original-src');
            // Mark as failed but don't retry
            this.setAttribute('data-optimized', 'failed');
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
                
                // Then convert images - but skip forum avatars
                if (node.tagName === 'IMG' && !node.getAttribute('data-optimized')) {
                    // Skip if it's a forum avatar
                    if (!node.classList.contains('forum-user-avatar') &&
                        !node.classList.contains('forum-likes-avatar') &&
                        !node.hasAttribute('data-forum-avatar') &&
                        !node.hasAttribute('data-username')) {
                        convertToOptimalFormat(node);
                    } else {
                        node.setAttribute('data-optimized', 'skipped');
                    }
                }
                
                if (node.querySelectorAll) {
                    var nestedImages = node.querySelectorAll('img');
                    for (var ni = 0; ni < nestedImages.length; ni++) {
                        var img = nestedImages[ni];
                        if (!img.getAttribute('data-optimized')) {
                            // Skip if it's a forum avatar
                            if (!img.classList.contains('forum-user-avatar') &&
                                !img.classList.contains('forum-likes-avatar') &&
                                !img.hasAttribute('data-forum-avatar') &&
                                !img.hasAttribute('data-username')) {
                                convertToOptimalFormat(img);
                            } else {
                                img.setAttribute('data-optimized', 'skipped');
                            }
                        }
                    }
                }
            }
        }
    });
    
    // ===== PART 5: Performance Reporting =====
    
    function generateReport() {
        console.log('=== MEDIA OPTIMIZER REPORT (LOSSLESS QUALITY) ===');
        
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
        var gifToWebpCount = 0;
        var svgCount = 0;
        var dicebearCount = 0;
        var forumAvatarCount = 0;
        var optimizedCount = 0;
        var failedCount = 0;
        var losslessCount = 0;
        var otherCount = 0;
        
        for (var i = 0; i < images.length; i++) {
            var img = images[i];
            if (img.getAttribute('loading') === LAZY) lazyCount++;
            if (img.getAttribute('decoding') === ASYNC) asyncCount++;
            
            var src = img.src.toLowerCase();
            var originalSrc = (img.getAttribute('data-original-src') || '').toLowerCase();
            var classes = img.className.toLowerCase();
            var isForumAvatar = false;
            var optimized = img.getAttribute('data-optimized');
            
            if (optimized === 'true') {
                optimizedCount++;
                // Check if lossless parameter is present
                if (src.indexOf('lossless=true') !== -1) {
                    losslessCount++;
                }
            }
            if (optimized === 'failed') failedCount++;
            
            // Count forum avatars
            if (classes.indexOf('forum-user-avatar') !== -1 || 
                classes.indexOf('forum-likes-avatar') !== -1 ||
                img.hasAttribute('data-username')) {
                forumAvatarCount++;
                isForumAvatar = true;
            }
            
            if (!isForumAvatar) {
                // Check if it was originally a GIF but now WebP
                if (originalSrc.indexOf('.gif') !== -1 && src.indexOf('output=webp') !== -1) {
                    gifToWebpCount++;
                } else if (src.indexOf('.gif') !== -1 || src.indexOf('.gif?') !== -1) {
                    gifCount++;
                } else if (src.indexOf('.svg') !== -1 || src.indexOf('.svg?') !== -1) {
                    svgCount++;
                } else if (src.indexOf('dicebear.com') !== -1 || src.indexOf('api.dicebear.com') !== -1) {
                    dicebearCount++;
                } else if (src.indexOf('.webp') !== -1 || src.indexOf('output=webp') !== -1) {
                    webpCount++;
                } else if (src.indexOf('.avif') !== -1 || src.indexOf('output=avif') !== -1) {
                    avifCount++;
                } else {
                    otherCount++;
                }
            }
        }
        
        console.log('Images: ' + lazyCount + '/' + images.length + ' lazy, ' + asyncCount + '/' + images.length + ' async');
        console.log('Optimization: ' + optimizedCount + ' optimized (lossless: ' + losslessCount + '), ' + failedCount + ' failed');
        console.log('Format breakdown:');
        console.log('  - WebP (lossless): ' + webpCount);
        console.log('  - AVIF (lossless): ' + avifCount);
        console.log('  - GIF (original): ' + gifCount);
        console.log('  - GIF → WebP (animated, lossless): ' + gifToWebpCount);
        console.log('  - SVG: ' + svgCount);
        console.log('  - DiceBear avatars: ' + dicebearCount);
        console.log('  - Forum avatars: ' + forumAvatarCount);
        console.log('  - Other formats: ' + otherCount);
        
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
