(function() {
    'use strict';
    
    // ===== PART 1: Constants & Configuration =====
    var LAZY = "lazy";
    var ASYNC = "async";
    var CDN_BASE = 'https://images.weserv.nl/';
    var CLOUDINARY_CLOUD = 'dbdf6gwgo'; // Your Cloudinary cloud name
    
    // Media types that need special handling
    var SKIP_PATTERNS = [
        '.svg', '.webp', '.avif',
        'output=webp', 'output=avif',
        // Skip DiceBear avatars (generated letter avatars)
        'dicebear.com',
        'api.dicebear.com',
        'dicebear',
        // Skip our forum avatar markers
        'forum-user-avatar',
        'forum-likes-avatar',
        'avatar-size-',
        // Skip Cloudinary URLs (already optimized)
        'res.cloudinary.com'
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
    
    // New function to handle GIFs with Cloudinary
    function convertGifWithCloudinary(img, gifUrl) {
        // Cloudinary URL with automatic format selection for animated images
        // f_auto:animated - automatically selects best animated format (WebP, AVIF, etc.)
        // fl_awebp - ensures WebP animation flag
        // q_auto - automatic quality optimization
        var cloudinaryUrl = 'https://res.cloudinary.com/' + CLOUDINARY_CLOUD + 
                            '/image/fetch/f_auto:animated,fl_awebp,fl_animated,q_auto/' + 
                            encodeURIComponent(gifUrl);
        
        // Store original for fallback
        img.setAttribute('data-original-src', gifUrl);
        
        // Set up error fallback
        img.onerror = function() {
            console.log('Cloudinary GIF conversion failed, falling back to original:', gifUrl);
            this.src = this.getAttribute('data-original-src');
        };
        
        // Update src to Cloudinary URL
        img.src = cloudinaryUrl;
        
        console.log('Converted GIF to animated format via Cloudinary:', gifUrl);
    }
    
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
        
        // SPECIAL HANDLING FOR GIFS - Use Cloudinary
        if (originalSrc.toLowerCase().indexOf('.gif') !== -1) {
            convertGifWithCloudinary(img, originalSrc);
            return;
        }
        
        // NON-GIF IMAGES - Use images.weserv.nl
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
        var cloudinaryCount = 0;
        var svgCount = 0;
        var dicebearCount = 0;
        var forumAvatarCount = 0;
        var otherCount = 0;
        
        for (var i = 0; i < images.length; i++) {
            var img = images[i];
            if (img.getAttribute('loading') === LAZY) lazyCount++;
            if (img.getAttribute('decoding') === ASYNC) asyncCount++;
            
            var src = img.src.toLowerCase();
            var classes = img.className.toLowerCase();
            var isForumAvatar = false;
            
            // Count forum avatars
            if (classes.indexOf('forum-user-avatar') !== -1 || 
                classes.indexOf('forum-likes-avatar') !== -1 ||
                img.hasAttribute('data-username')) {
                forumAvatarCount++;
                isForumAvatar = true;
            }
            
            if (!isForumAvatar) {
                if (src.indexOf('res.cloudinary.com') !== -1) {
                    cloudinaryCount++;
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
        console.log('Format breakdown:');
        console.log('  - WebP (weserv.nl): ' + webpCount);
        console.log('  - AVIF (weserv.nl): ' + avifCount);
        console.log('  - Cloudinary (animated): ' + cloudinaryCount);
        console.log('  - GIF (unoptimized): ' + gifCount);
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
