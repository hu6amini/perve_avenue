(function() {
    'use strict';
    
    // ===== PART 1: Constants & Configuration =====
    var LAZY = "lazy";
    var ASYNC = "async";
    var CDN_BASE = 'https://images.weserv.nl/';
    var DEFAULT_QUALITY = '100';
    var FOOTER_QUALITY = '80'; // Lower quality for footer images
    var CACHE_DURATION = '1y';
    
    var SKIP_PATTERNS = [
        '.svg', '.webp', '.avif',
        'output=webp', 'output=avif',
        'dicebear.com',
        'api.dicebear.com',
        'dicebear',
        'forum-user-avatar',
        'forum-likes-avatar',
        'avatar-size-',
        'images.weserv.nl',
        'wsrv.nl'
    ];
    
    for (var sp = 0; sp < SKIP_PATTERNS.length; sp++) {
        SKIP_PATTERNS[sp] = SKIP_PATTERNS[sp].toLowerCase();
    }
    
    var loadEvents = [];
    var successCount = 0;
    var totalMonitored = 0;
    
    // ===== PART 2: Lazy Loading & Async Decoding =====
    
    var originalAddEventListener = EventTarget.prototype.addEventListener;
    var originalSetAttribute = Element.prototype.setAttribute;
    var originalCreateElement = document.createElement;
    var OriginalImage = window.Image;
    
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
    
    Element.prototype.setAttribute = function(name, value) {
        if ((name === 'src' || name === 'srcset') && isMediaElement(this)) {
            applyLazyAttributes(this);
        }
        return originalSetAttribute.call(this, name, value);
    };
    
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
    
    document.createElement = function(tagName, options) {
        var element = originalCreateElement.call(this, tagName, options);
        return applyLazyAttributes(element);
    };
    
    if (OriginalImage) {
        window.Image = function(width, height) {
            var img = new OriginalImage(width, height);
            img.setAttribute('loading', LAZY);
            img.setAttribute('decoding', ASYNC);
            return img;
        };
        window.Image.prototype = OriginalImage.prototype;
    }
    
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
    
    // ===== PART 3: Format Conversion =====
    
    function shouldSkipImage(url, element) {
        if (!url) return true;
        
        var lowerUrl = url.toLowerCase();
        
        if (lowerUrl.indexOf('data:') === 0) return true;
        
        if (element && element.classList) {
            if (element.classList.contains('forum-user-avatar') ||
                element.classList.contains('forum-likes-avatar') ||
                element.classList.contains('avatar-size-')) {
                return true;
            }
        }
        
        if (element && element.hasAttribute) {
            if (element.hasAttribute('data-forum-avatar') ||
                element.hasAttribute('data-username')) {
                return true;
            }
        }
        
        for (var i = 0; i < SKIP_PATTERNS.length; i++) {
            if (lowerUrl.indexOf(SKIP_PATTERNS[i]) !== -1) {
                return true;
            }
        }
        
        return false;
    }
    
    function isInFooter(element) {
        // Check if element is in footer or has footer-related classes
        if (!element) return false;
        
        // Check if element itself has footer class
        if (element.classList) {
            var classes = element.className.toLowerCase();
            if (classes.indexOf('footer') !== -1 || 
                classes.indexOf('foot') !== -1 ||
                classes.indexOf('ffa-image') !== -1) { // Based on your HTML structure
                return true;
            }
        }
        
        // Check parents for footer elements
        var parent = element.parentElement;
        var depth = 0;
        while (parent && depth < 10) { // Limit search depth
            if (parent.classList) {
                var parentClasses = parent.className.toLowerCase();
                if (parentClasses.indexOf('footer') !== -1 || 
                    parentClasses.indexOf('foot') !== -1) {
                    return true;
                }
            }
            // Check tag name
            if (parent.tagName && parent.tagName.toLowerCase() === 'footer') {
                return true;
            }
            parent = parent.parentElement;
            depth++;
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
        
        if (originalSrc.indexOf('http') !== 0 || 
            img.getAttribute('data-optimized') === 'true' || 
            img.getAttribute('data-optimized') === 'skipped') {
            return;
        }
        
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
        
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-original-src', originalSrc);
        
        // Determine quality based on location
        var quality = isInFooter(img) ? FOOTER_QUALITY : DEFAULT_QUALITY;
        
        // More precise GIF detection
        var lowerSrc = originalSrc.toLowerCase();
        var isGif = lowerSrc.indexOf('.gif') !== -1 && 
                   (lowerSrc.indexOf('.gif?') !== -1 || 
                    lowerSrc.indexOf('.gif#') !== -1 || 
                    lowerSrc.lastIndexOf('.gif') === lowerSrc.length - 4);
        
        var format;
        var params = [];
        
        params.push('maxage=' + CACHE_DURATION);
        params.push('q=' + quality);
        params.push('lossless=true');
        
        if (isGif) {
            format = 'webp';
            params.push('n=-1');
            params.push('il');
        } else {
            format = supportsAVIF() ? 'avif' : 'webp';
            
            if (format === 'jpg' || format === 'jpeg') {
                params.push('il');
            } else if (format === 'png') {
                params.push('il');
            }
        }
        
        var encodedUrl = encodeURIComponent(originalSrc);
        var optimizedSrc = CDN_BASE + '?url=' + encodedUrl + '&output=' + format;
        
        if (params.length > 0) {
            optimizedSrc += '&' + params.join('&');
        }
        
        // Add quality flag for debugging/reporting
        img.setAttribute('data-quality', quality);
        
        img.onerror = function() {
            this.src = this.getAttribute('data-original-src');
            this.setAttribute('data-optimized', 'failed');
        };
        
        img.src = optimizedSrc;
    }
    
    function processAllImages() {
        var images = document.querySelectorAll('img');
        for (var i = 0; i < images.length; i++) {
            convertToOptimalFormat(images[i]);
        }
    }
    
    // ===== PART 4: Mutation Observer =====
    
    var unifiedObserver = new MutationObserver(function(mutations) {
        for (var m = 0; m < mutations.length; m++) {
            var mutation = mutations[m];
            if (mutation.type !== 'childList') continue;
            
            var addedNodes = mutation.addedNodes;
            for (var n = 0; n < addedNodes.length; n++) {
                var node = addedNodes[n];
                if (node.nodeType !== 1) continue;
                
                applyLazyAttributes(node);
                
                if (node.querySelectorAll) {
                    var mediaElements = node.querySelectorAll('img, iframe');
                    for (var me = 0; me < mediaElements.length; me++) {
                        applyLazyAttributes(mediaElements[me]);
                    }
                }
                
                if (node.tagName === 'IMG' && !node.getAttribute('data-optimized')) {
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
        
        var testImg = document.createElement('img');
        console.log('createElement: loading=' + testImg.getAttribute('loading') + ', decoding=' + testImg.getAttribute('decoding'));
        
        if (window.Image) {
            var imgConst = new Image();
            console.log('imageConstructor: loading=' + imgConst.getAttribute('loading') + ', decoding=' + imgConst.getAttribute('decoding'));
        }
        
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
        var footerImagesCount = 0;
        var footerOptimizedCount = 0;
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
            var quality = img.getAttribute('data-quality');
            
            if (optimized === 'true') {
                optimizedCount++;
                if (src.indexOf('lossless=true') !== -1) {
                    losslessCount++;
                }
            }
            if (optimized === 'failed') failedCount++;
            
            if (classes.indexOf('forum-user-avatar') !== -1 || 
                classes.indexOf('forum-likes-avatar') !== -1 ||
                img.hasAttribute('data-username')) {
                forumAvatarCount++;
                isForumAvatar = true;
            }
            
            // Check if in footer
            if (isInFooter(img)) {
                footerImagesCount++;
                if (optimized === 'true' && quality === FOOTER_QUALITY) {
                    footerOptimizedCount++;
                }
            }
            
            if (!isForumAvatar) {
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
        console.log('Footer images: ' + footerImagesCount + ' total, ' + footerOptimizedCount + ' with 80% quality');
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
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', applyToExisting);
        } else {
            applyToExisting();
        }
        
        if (document.body) {
            unifiedObserver.observe(document.body, { childList: true, subtree: true });
        } else {
            var bodyObserver = new MutationObserver(function(mutations, obs) {
                if (document.body) {
                    unifiedObserver.observe(document.body, { childList: true, subtree: true });
                    obs.disconnect();
                }
            });
            bodyObserver.observe(document.documentElement, { childList: true });
        }
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', processAllImages);
        } else {
            processAllImages();
        }
        
        window.addEventListener('load', function() {
            setTimeout(generateReport, 1000);
        });
    }
    
    if (typeof Promise !== 'undefined') {
        Promise.resolve().then(initialize);
    } else {
        setTimeout(initialize, 0);
    }
})();
