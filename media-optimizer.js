(function() {
    'use strict';
    
    // ===== CONSTANTS & CONFIGURATION =====
    var CONFIG = {
        cdn: 'https://images.weserv.nl/',
        lazy: 'lazy',
        async: 'async',
        cache: '1y',
        quality: {
            jpg: '90',      // High quality JPEG
            jpeg: '90',     
            webp: '90',     // WebP handles quality differently
            avif: '85',     // AVIF is more efficient
            png: '100',     // PNG needs max for lossless
            gif: '100',     // GIF should be lossless
            unknown: '90'
        },
        video: {
            preload: 'none',           // Default: don't preload videos
            autoplayPreload: 'metadata' // For autoplay videos
        },
        skipPatterns: [
            '.svg', '.webp', '.avif', '.ico',
            'output=webp', 'output=avif',
            'dicebear.com', 'api.dicebear.com',
            'forum-user-avatar', 'forum-likes-avatar',
            'avatar-size-', 'images.weserv.nl', 'wsrv.nl',
            'data:image'
        ].map(function(p) { return p.toLowerCase(); })
    };
    
    // ===== STATE MANAGEMENT =====
    var state = {
        processed: new WeakSet(),
        stats: {
            total: 0,
            optimized: 0,
            failed: 0,
            skipped: 0,
            byFormat: {},
            byQuality: {}
        },
        videos: {
            total: 0,
            preloadNone: 0,
            autoplayVideos: 0,
            withPoster: 0
        },
        initDone: false
    };
    
    // ===== UTILITY FUNCTIONS =====
    function isMediaElement(el) {
        return el && (el.tagName === 'IMG' || el.tagName === 'IFRAME' || el.tagName === 'VIDEO');
    }
    
    function shouldSkip(url, el) {
        if (!url || url.indexOf('data:') === 0) return true;
        
        var lower = url.toLowerCase();
        
        // Check patterns
        for (var i = 0; i < CONFIG.skipPatterns.length; i++) {
            if (lower.indexOf(CONFIG.skipPatterns[i]) !== -1) return true;
        }
        
        // Check element attributes/classes
        if (el) {
            var classes = el.className.toLowerCase();
            if (classes.indexOf('forum-') !== -1) return true;
            if (el.hasAttribute('data-forum-avatar')) return true;
            if (el.hasAttribute('data-username')) return true;
        }
        
        return false;
    }
    
    function supportsFormat(format) {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            return canvas.toDataURL('image/' + format).indexOf('image/' + format) !== -1;
        } catch (e) {
            return false;
        }
    }
    
    function detectFormat(url) {
        var lower = url.toLowerCase();
        if (lower.indexOf('.jpg') !== -1 || lower.indexOf('.jpeg') !== -1) return 'jpeg';
        if (lower.indexOf('.png') !== -1) return 'png';
        if (lower.indexOf('.gif') !== -1 && 
            (lower.indexOf('.gif?') !== -1 || lower.lastIndexOf('.gif') === lower.length - 4)) return 'gif';
        if (lower.indexOf('.webp') !== -1) return 'webp';
        if (lower.indexOf('.avif') !== -1) return 'avif';
        return 'unknown';
    }
    
    // ===== VIDEO HANDLING =====
    function setupVideoLazyLoading(video) {
        if (state.processed.has(video)) return;
        state.processed.add(video);
        state.videos.total++;
        
        // Check if video has autoplay
        var hasAutoplay = video.hasAttribute('autoplay');
        if (hasAutoplay) {
            state.videos.autoplayVideos++;
        }
        
        // Set preload attribute based on autoplay status
        if (!video.hasAttribute('preload') || video.getAttribute('preload') === '') {
            var preloadValue = hasAutoplay ? CONFIG.video.autoplayPreload : CONFIG.video.preload;
            video.setAttribute('preload', preloadValue);
            
            if (!hasAutoplay && preloadValue === 'none') {
                state.videos.preloadNone++;
            }
        } else {
            // Count existing preload="none" videos
            if (video.getAttribute('preload') === 'none') {
                state.videos.preloadNone++;
            }
        }
        
        // Check for poster
        if (video.poster) {
            state.videos.withPoster++;
        } else {
            console.warn('Video without poster:', video);
        }
        
        // Store original sources if needed for future lazy loading
        var sources = video.querySelectorAll('source[src]');
        for (var i = 0; i < sources.length; i++) {
            var source = sources[i];
            if (!source.hasAttribute('data-original-src') && source.src) {
                source.setAttribute('data-original-src', source.src);
            }
        }
        
        video.setAttribute('data-video-processed', 'true');
    }
    
    // ===== LAZY LOADING & DECODING - UPDATED TO HANDLE HIDDEN IFRAMES AND VIDEOS =====
    function applyLazyAttributes(el) {
        if (!isMediaElement(el)) return el;
        
        // Handle IFRAMES - including hidden/placeholder ones
        if (el.tagName === 'IFRAME') {
            // Always set loading="lazy" for iframes, even if no src
            if (!el.hasAttribute('loading') || el.getAttribute('loading') === '') {
                el.setAttribute('loading', CONFIG.lazy);
            }
            
            // Mark placeholder iframes (no src or empty src)
            if (!el.src || el.src === '' || el.src === window.location.href) {
                el.setAttribute('data-placeholder', 'true');
            }
        }
        
        // Handle IMAGES
        if (el.tagName === 'IMG') {
            // Always apply loading="lazy" if not set
            if (!el.hasAttribute('loading') || el.getAttribute('loading') === '') {
                el.setAttribute('loading', CONFIG.lazy);
            }
            
            // Always apply decoding="async" if not set
            if (!el.hasAttribute('decoding') || el.getAttribute('decoding') === '') {
                el.setAttribute('decoding', CONFIG.async);
            }
        }
        
        // Handle VIDEOS
        if (el.tagName === 'VIDEO') {
            setupVideoLazyLoading(el);
        }
        
        return el;
    }
    
    // ===== WESERV OPTIMIZATION =====
    function buildWeservUrl(img) {
        var originalSrc = img.src;
        var originalFormat = detectFormat(originalSrc);
        var isGif = originalFormat === 'gif';
        
        // Determine output format
        var outputFormat;
        if (isGif) {
            outputFormat = 'webp'; // Convert GIF to WebP for animation support
        } else {
            outputFormat = supportsFormat('avif') ? 'avif' : 'webp';
        }
        
        // Get quality setting
        var quality = CONFIG.quality[outputFormat] || CONFIG.quality.unknown;
        
        // Build parameters
        var params = [
            'maxage=' + CONFIG.cache,
            'q=' + quality
        ];
        
        // Format-specific optimizations
        switch (outputFormat) {
            case 'png':
                params.push('af');      // Adaptive filter for PNG
                params.push('l=9');     // Max compression
                params.push('lossless=true');
                break;
            case 'webp':
            case 'avif':
                params.push('lossless=true');
                params.push('il');       // Progressive/Interlace
                break;
            case 'jpeg':
            case 'jpg':
                params.push('il');       // Progressive JPEG
                break;
        }
        
        // Special handling for animated GIFs
        if (isGif) {
            params.push('n=-1');         // All frames
            params.push('lossless=true'); // Keep quality
        } else if (originalFormat === 'png') {
            // PNG specific
            params.push('af');
            params.push('l=9');
        }
        
        // Add filename if possible
        var filename = originalSrc.split('/').pop().split('?')[0].split('#')[0];
        if (filename && /^[a-zA-Z0-9.]+$/.test(filename)) {
            params.push('filename=' + filename);
        }
        
        var encodedUrl = encodeURIComponent(originalSrc);
        var optimizedSrc = CONFIG.cdn + '?url=' + encodedUrl + '&output=' + outputFormat;
        
        if (params.length) {
            optimizedSrc = optimizedSrc + '&' + params.join('&');
        }
        
        return {
            url: optimizedSrc,
            format: outputFormat,
            quality: quality,
            params: params
        };
    }
    
    function optimizeImage(img) {
        // Skip if no src or data URI
        if (!img.src || img.src.indexOf('data:') === 0) return;
        
        // ALWAYS apply lazy attributes first (even if skipped)
        applyLazyAttributes(img);
        
        // Skip if already processed
        if (state.processed.has(img)) return;
        
        // Check if image should be skipped
        var skip = shouldSkip(img.src, img);
        if (skip) {
            state.processed.add(img);
            state.stats.skipped++;
            img.setAttribute('data-optimized', 'skipped');
            return;
        }
        
        // Mark as processed
        state.processed.add(img);
        state.stats.total++;
        
        // Store original
        var originalSrc = img.src;
        img.setAttribute('data-original', originalSrc);
        
        // Build optimized URL
        var optimization = buildWeservUrl(img);
        
        // Update stats
        state.stats.optimized++;
        state.stats.byFormat[optimization.format] = (state.stats.byFormat[optimization.format] || 0) + 1;
        state.stats.byQuality[optimization.quality] = (state.stats.byQuality[optimization.quality] || 0) + 1;
        
        // Set optimized source with error fallback
        img.onerror = function() {
            state.stats.failed++;
            img.setAttribute('data-optimized', 'failed');
            img.src = originalSrc; // Revert to original on error
            img.onerror = null; // Prevent infinite loop
        };
        
        img.src = optimization.url;
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-format', optimization.format);
        img.setAttribute('data-quality', optimization.quality);
    }
    
    // ===== MUTATION OBSERVER =====
    var mutationObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type !== 'childList') return;
            
            var nodes = mutation.addedNodes;
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (node.nodeType !== 1) continue;
                
                // Handle the node itself if it's media
                if (node.tagName === 'IMG' || node.tagName === 'IFRAME' || node.tagName === 'VIDEO') {
                    applyLazyAttributes(node);
                    if (node.tagName === 'IMG') {
                        optimizeImage(node);
                    }
                }
                
                // Handle nested media
                if (node.querySelectorAll) {
                    // First, apply lazy attributes to all media
                    var allMedia = node.querySelectorAll('img, iframe, video');
                    for (var j = 0; j < allMedia.length; j++) {
                        applyLazyAttributes(allMedia[j]);
                    }
                    
                    // Then optimize images
                    var images = node.querySelectorAll('img');
                    for (var k = 0; k < images.length; k++) {
                        optimizeImage(images[k]);
                    }
                }
            }
        });
    });
    
    // ===== PROXY PATTERNS FOR DYNAMIC IMAGES =====
    var OriginalImage = window.Image;
    window.Image = function(width, height) {
        var img = new OriginalImage(width, height);
        
        // Apply lazy attributes immediately
        img.setAttribute('loading', CONFIG.lazy);
        img.setAttribute('decoding', CONFIG.async);
        
        // Store original src setter
        var originalSrcDesc = Object.getOwnPropertyDescriptor(img, 'src');
        if (originalSrcDesc && originalSrcDesc.set) {
            Object.defineProperty(img, 'src', {
                set: function(value) {
                    originalSrcDesc.set.call(this, value);
                    if (value && !value.startsWith('data:')) {
                        optimizeImage(this);
                    }
                },
                get: originalSrcDesc.get,
                configurable: true
            });
        }
        
        return img;
    };
    window.Image.prototype = OriginalImage.prototype;
    
    // Override src setter for all images
    var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (srcDescriptor && srcDescriptor.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            set: function(value) {
                srcDescriptor.set.call(this, value);
                if (value && !value.startsWith('data:') && this.isConnected) {
                    optimizeImage(this);
                }
            },
            get: srcDescriptor.get,
            configurable: true
        });
    }
    
    // Override setAttribute for dynamic src changes
    var originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        originalSetAttribute.call(this, name, value);
        
        if (name === 'src' && this.tagName === 'IMG' && value && !value.startsWith('data:')) {
            optimizeImage(this);
        }
    };
    
    // Override createElement
    var originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        var element = originalCreateElement.call(this, tagName, options);
        
        if (tagName.toLowerCase() === 'img') {
            applyLazyAttributes(element);
        }
        
        return element;
    };
    
    // ===== INITIALIZATION =====
    function init() {
        if (state.initDone) return;
        state.initDone = true;
        
        // Process ALL existing images (including those that will be skipped)
        var allImages = document.querySelectorAll('img');
        for (var i = 0; i < allImages.length; i++) {
            var img = allImages[i];
            
            // ALWAYS apply lazy attributes first
            applyLazyAttributes(img);
            
            // Then attempt optimization (will skip if needed)
            optimizeImage(img);
        }
        
        // Process ALL iframes (including hidden/placeholder ones)
        var allIframes = document.querySelectorAll('iframe');
        for (var j = 0; j < allIframes.length; j++) {
            applyLazyAttributes(allIframes[j]);
        }
        
        // Process ALL videos
        var allVideos = document.querySelectorAll('video');
        for (var k = 0; k < allVideos.length; k++) {
            applyLazyAttributes(allVideos[k]);
        }
        
        // Start mutation observer
        if (document.body) {
            mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        } else {
            // Wait for body
            var bodyCheck = setInterval(function() {
                if (document.body) {
                    clearInterval(bodyCheck);
                    mutationObserver.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    
                    // Re-process any images that might have been missed
                    var missedImages = document.querySelectorAll('img:not([data-optimized])');
                    for (var i = 0; i < missedImages.length; i++) {
                        optimizeImage(missedImages[i]);
                    }
                    
                    // Re-process any iframes that might have been missed
                    var missedIframes = document.querySelectorAll('iframe:not([loading])');
                    for (var j = 0; j < missedIframes.length; j++) {
                        applyLazyAttributes(missedIframes[j]);
                    }
                    
                    // Re-process any videos that might have been missed
                    var missedVideos = document.querySelectorAll('video:not([data-video-processed])');
                    for (var k = 0; k < missedVideos.length; k++) {
                        applyLazyAttributes(missedVideos[k]);
                    }
                }
            }, 50);
        }
        
        // Performance report
        window.addEventListener('load', function() {
            setTimeout(function() {
                var finalImages = document.querySelectorAll('img');
                var finalIframes = document.querySelectorAll('iframe');
                var finalVideos = document.querySelectorAll('video');
                var lazyCount = 0;
                var asyncCount = 0;
                var placeholderCount = 0;
                
                // Count all images (including skipped ones)
                for (var i = 0; i < finalImages.length; i++) {
                    if (finalImages[i].getAttribute('loading') === CONFIG.lazy) lazyCount++;
                    if (finalImages[i].getAttribute('decoding') === CONFIG.async) asyncCount++;
                }
                
                // Count iframes and placeholders
                for (var j = 0; j < finalIframes.length; j++) {
                    if (finalIframes[j].getAttribute('loading') === CONFIG.lazy) lazyCount++;
                    if (finalIframes[j].getAttribute('data-placeholder') === 'true') placeholderCount++;
                }
                
                // Count videos
                for (var k = 0; k < finalVideos.length; k++) {
                    // Videos don't have loading attribute, count them separately
                    var preload = finalVideos[k].getAttribute('preload');
                    if (preload === 'none') lazyCount++; // Count as "lazy loaded"
                }
                
                var totalMedia = finalImages.length + finalIframes.length + finalVideos.length;
                
                console.log('=== WESERV OPTIMIZER REPORT ===');
                console.log('Total images:', state.stats.total);
                console.log('Optimized:', state.stats.optimized);
                console.log('Skipped:', state.stats.skipped);
                console.log('Failed:', state.stats.failed);
                console.log('Format breakdown:', state.stats.byFormat);
                console.log('Quality breakdown:', state.stats.byQuality);
                console.log('Lazy loading (all media):', lazyCount + '/' + totalMedia);
                console.log('Async decoding:', asyncCount + '/' + finalImages.length);
                console.log('Placeholder iframes:', placeholderCount);
                console.log('\n=== VIDEO STATS ===');
                console.log('Total videos:', state.videos.total);
                console.log('Videos with preload="none":', state.videos.preloadNone);
                console.log('Autoplay videos:', state.videos.autoplayVideos);
                console.log('Videos with poster:', state.videos.withPoster);
                console.log('Videos missing poster:', state.videos.total - state.videos.withPoster);
                
                if (state.stats.failed > 0) {
                    console.warn('Optimization failures:', state.stats.failed);
                }
                
                // Verify all iframes have lazy loading
                var iframesWithoutLazy = document.querySelectorAll('iframe:not([loading="lazy"])');
                if (iframesWithoutLazy.length > 0) {
                    console.warn('Iframes still without lazy loading:', iframesWithoutLazy.length);
                } else {
                    console.log('✅ All iframes have lazy loading!');
                }
                
                console.log('=== REPORT COMPLETE ===');
            }, 1000);
        });
    }
    
    // ===== START IMMEDIATELY =====
    init();
})();
