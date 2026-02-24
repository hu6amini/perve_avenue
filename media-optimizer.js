(function() {
    'use strict';
    
    // ===== PART 1: Constants & Configuration =====
    var LAZY = "lazy";
    var ASYNC = "async";
    var CDN_BASE = 'https://images.weserv.nl/';
    var CACHE_DURATION = '1y';
    
    // Quality settings by format (optimized for quality vs size)
    var QUALITY_SETTINGS = {
        'jpg': '90',      // High quality JPEG
        'jpeg': '90',     
        'webp': '90',     // WebP handles quality differently
        'avif': '85',     // AVIF is more efficient
        'png': '100',     // PNG needs max for lossless
        'gif': '100'      // GIF should be lossless
    };
    
    var DEFAULT_QUALITY = '90'; // Slightly reduced from 100 for better balance
    
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
        'wsrv.nl',
        'data:image/svg'  // Skip inline SVGs
    ];
    
    for (var sp = 0; sp < SKIP_PATTERNS.length; sp++) {
        SKIP_PATTERNS[sp] = SKIP_PATTERNS[sp].toLowerCase();
    }
    
    var loadEvents = [];
    var successCount = 0;
    var totalMonitored = 0;
    
    // ===== PART 2: Lazy Loading & Async Decoding =====
    
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
    
    // New monitoring function - attaches passive listeners instead of overriding addEventListener
    function monitorMediaLoad(element) {
        if (!isMediaElement(element)) return;
        
        totalMonitored++;
        
        // Check initial attributes
        var initialLoading = element.getAttribute('loading');
        var initialDecoding = element.getAttribute('decoding');
        
        var trackingData = {
            element: element.tagName,
            src: element.src || element.getAttribute('src') || '[no-src]',
            initialLoading: initialLoading,
            initialDecoding: initialDecoding,
            startTime: performance.now()
        };
        
        loadEvents.push(trackingData);
        
        if (initialLoading === LAZY && (element.tagName !== 'IMG' || initialDecoding === ASYNC)) {
            successCount++;
            trackingData.success = true;
            trackingData.timing = 'before';
        } else {
            trackingData.success = false;
        }
        
        // Add passive load listeners (doesn't override native methods)
        element.addEventListener('load', function onLoad(evt) {
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
            
            element.removeEventListener('load', onLoad);
        }, { once: true });
        
        element.addEventListener('error', function onError() {
            trackingData.error = true;
            element.removeEventListener('error', onError);
        }, { once: true });
    }
    
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
        applyLazyAttributes(element);
        monitorMediaLoad(element); // Monitor newly created elements
        return element;
    };
    
    if (OriginalImage) {
        window.Image = function(width, height) {
            var img = new OriginalImage(width, height);
            img.setAttribute('loading', LAZY);
            img.setAttribute('decoding', ASYNC);
            monitorMediaLoad(img); // Monitor Image constructor created elements
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
        
        // Monitor all existing media elements
        var allMedia = document.querySelectorAll('img, iframe');
        for (var j = 0; j < allMedia.length; j++) {
            monitorMediaLoad(allMedia[j]);
        }
    }
    
    // ===== PART 3: Format Conversion with Quality Optimization =====
    
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
    
    function getOptimalFormatForImage(src, isGif) {
        if (isGif) {
            return {
                format: 'webp',
                isAnimated: true
            };
        }
        
        // Check if browser supports AVIF (better quality than WebP)
        var supportsAvif = supportsAVIF();
        
        return {
            format: supportsAvif ? 'avif' : 'webp',
            isAnimated: false
        };
    }
    
    function buildWeservParams(format, isGif, originalSrc, quality) {
        var params = [];
        
        // Cache control
        params.push('maxage=' + CACHE_DURATION);
        
        // Quality setting - use format-specific quality
        params.push('q=' + quality);
        
        // Format-specific optimizations
        switch(format) {
            case 'png':
                // PNG: Enable adaptive filtering for better compression without quality loss
                params.push('af'); // Adaptive filter
                params.push('l=9'); // Maximum compression level
                break;
                
            case 'webp':
            case 'avif':
                // WebP/AVIF: Lossless compression when appropriate
                params.push('lossless=true');
                break;
                
            case 'jpg':
            case 'jpeg':
                // JPEG: Progressive for better perceived quality
                params.push('il'); // Interlace/progressive
                break;
        }
        
        // Handle animated GIFs specially
        if (isGif) {
            params.push('n=-1'); // Render all frames
            params.push('lossless=true'); // Keep lossless
            // Don't add interlace for animated
        } else {
            // Add interlace for non-animated images (better progressive loading)
            // But skip for PNG as it increases file size
            if (format !== 'png') {
                params.push('il');
            }
        }
        
        return params;
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
        
        // More precise GIF detection
        var lowerSrc = originalSrc.toLowerCase();
        var isGif = lowerSrc.indexOf('.gif') !== -1 && 
                   (lowerSrc.indexOf('.gif?') !== -1 || 
                    lowerSrc.indexOf('.gif#') !== -1 || 
                    lowerSrc.lastIndexOf('.gif') === lowerSrc.length - 4);
        
        // Get original format for quality detection
        var originalFormat = 'unknown';
        if (lowerSrc.indexOf('.jpg') !== -1 || lowerSrc.indexOf('.jpeg') !== -1) originalFormat = 'jpg';
        else if (lowerSrc.indexOf('.png') !== -1) originalFormat = 'png';
        else if (lowerSrc.indexOf('.gif') !== -1) originalFormat = 'gif';
        else if (lowerSrc.indexOf('.webp') !== -1) originalFormat = 'webp';
        
        // Determine optimal format
        var formatInfo = getOptimalFormatForImage(originalSrc, isGif);
        var format = formatInfo.format;
        
        // Get quality setting for this format
        var quality = QUALITY_SETTINGS[format] || DEFAULT_QUALITY;
        
        // Build weserv parameters
        var params = buildWeservParams(format, isGif, originalSrc, quality);
        
        var encodedUrl = encodeURIComponent(originalSrc);
        var optimizedSrc = CDN_BASE + '?url=' + encodedUrl + '&output=' + format;
        
        if (params.length > 0) {
            optimizedSrc += '&' + params.join('&');
        }
        
        // Store conversion info for debugging
        img.setAttribute('data-conversion', originalFormat + '→' + format);
        img.setAttribute('data-quality', quality);
        
        img.onerror = function() {
            console.warn('Weserv optimization failed for:', originalSrc);
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
                monitorMediaLoad(node); // Monitor the node itself if it's media
                
                if (node.querySelectorAll) {
                    var mediaElements = node.querySelectorAll('img, iframe');
                    for (var me = 0; me < mediaElements.length; me++) {
                        applyLazyAttributes(mediaElements[me]);
                        monitorMediaLoad(mediaElements[me]); // Monitor nested media
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
        console.log('=== MEDIA OPTIMIZER REPORT (QUALITY OPTIMIZED) ===');
        
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
        var pngOptimized = 0;
        var gifCount = 0;
        var gifToWebpCount = 0;
        var svgCount = 0;
        var dicebearCount = 0;
        var forumAvatarCount = 0;
        var optimizedCount = 0;
        var failedCount = 0;
        var losslessCount = 0;
        var progressiveCount = 0;
        var otherCount = 0;
        var qualityTotals = {};
        
        for (var i = 0; i < images.length; i++) {
            var img = images[i];
            if (img.getAttribute('loading') === LAZY) lazyCount++;
            if (img.getAttribute('decoding') === ASYNC) asyncCount++;
            
            var src = img.src.toLowerCase();
            var originalSrc = (img.getAttribute('data-original-src') || '').toLowerCase();
            var classes = img.className.toLowerCase();
            var isForumAvatar = false;
            var optimized = img.getAttribute('data-optimized');
            var conversion = img.getAttribute('data-conversion');
            var quality = img.getAttribute('data-quality');
            
            if (quality) {
                qualityTotals[quality] = (qualityTotals[quality] || 0) + 1;
            }
            
            if (optimized === 'true') {
                optimizedCount++;
                if (src.indexOf('lossless=true') !== -1) {
                    losslessCount++;
                }
                if (src.indexOf('&il') !== -1 || src.indexOf('?il') !== -1) {
                    progressiveCount++;
                }
                if (src.indexOf('&af') !== -1) {
                    pngOptimized++;
                }
            }
            if (optimized === 'failed') failedCount++;
            
            if (classes.indexOf('forum-user-avatar') !== -1 || 
                classes.indexOf('forum-likes-avatar') !== -1 ||
                img.hasAttribute('data-username')) {
                forumAvatarCount++;
                isForumAvatar = true;
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
        console.log('Optimization: ' + optimizedCount + ' optimized, ' + failedCount + ' failed');
        console.log('Quality features:');
        console.log('  - Lossless: ' + losslessCount);
        console.log('  - Progressive: ' + progressiveCount);
        console.log('  - PNG adaptive: ' + pngOptimized);
        console.log('Quality distribution:', qualityTotals);
        console.log('Format breakdown:');
        console.log('  - WebP: ' + webpCount);
        console.log('  - AVIF: ' + avifCount);
        console.log('  - GIF (original): ' + gifCount);
        console.log('  - GIF → WebP: ' + gifToWebpCount);
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
