(function() {
    'use strict';
    
    // ===== CONSTANTS & CONFIGURATION =====
    var CONFIG = {
        cdn: 'https://images.weserv.nl/',
        lazy: 'lazy',
        async: 'async',
        cache: '1y',
        quality: {
            jpg: '90',
            jpeg: '90',     
            webp: '90',
            avif: '85',
            png: '100',
            gif: '100',
            unknown: '90'
        },
        video: {
            preload: 'none',
            autoplayPreload: 'metadata'
        },
        skipPatterns: [
            '.svg', '.webp', '.avif', '.ico',
            'output=webp', 'output=avif',
            'dicebear.com', 'api.dicebear.com',
            'forum-user-avatar', 'forum-likes-avatar',
            'avatar-size-', 'images.weserv.nl', 'wsrv.nl',
            'data:image',
            'tiptap', 'ProseMirror', 'contenteditable',
            've-content', 'st-editor', 'st-visual-editor'
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
        initDone: false,
        editorCache: new WeakMap(),
        processingQueue: new Set(), // Track elements being processed
        isEditorActive: false // Track if editor is currently active
    };
    
    // ===== EDITOR DETECTION =====
    function isInEditor(el) {
        if (!el || typeof el.closest !== 'function') return false;
        
        // Check cache first
        if (state.editorCache.has(el)) {
            return state.editorCache.get(el);
        }
        
        // CRITICAL: Check if element is inside ProseMirror editor or has ProseMirror classes
        var inEditor = !!(
            el.closest('.tiptap') || 
            el.closest('.ProseMirror') || 
            el.closest('[contenteditable="true"]') ||
            el.closest('.ve-content') ||
            el.closest('.st-editor') ||
            el.closest('#st-visual-editor') ||
            // Check for ProseMirror-specific attributes
            el.hasAttribute('data-prosemirror') ||
            el.classList.contains('ProseMirror-separator') ||
            // Check if parent is ProseMirror widget
            (el.parentElement && el.parentElement.classList.contains('ProseMirror-widget'))
        );
        
        // Also check if this element was likely created by ProseMirror
        if (!inEditor && el.tagName === 'IMG') {
            // Images created by ProseMirror often have these attributes
            inEditor = el.hasAttribute('contenteditable') && 
                      el.getAttribute('contenteditable') === 'false' &&
                      el.hasAttribute('draggable') &&
                      el.closest('.ProseMirror');
        }
        
        state.editorCache.set(el, inEditor);
        return inEditor;
    }
    
    // Check if we're currently in an editor operation
    function isEditorOperation() {
        // Check if active element is editor
        var activeEl = document.activeElement;
        if (activeEl && isInEditor(activeEl)) {
            return true;
        }
        
        // Check if any editor element has focus
        var editor = document.querySelector('.tiptap, .ProseMirror, [contenteditable="true"]');
        if (editor && editor.contains(document.activeElement)) {
            return true;
        }
        
        return false;
    }
    
    function shouldSkip(url, el) {
        if (!url || url.indexOf('data:') === 0) return true;
        
        // ULTRA IMPORTANT: Skip if element is in editor OR if editor is currently active
        if (el) {
            if (isInEditor(el) || state.isEditorActive || isEditorOperation()) {
                if (el.tagName === 'IMG') {
                    // Mark as skipped but preserve original URL
                    el.setAttribute('data-optimized', 'skipped-editor');
                    // Ensure we don't modify the src
                    if (el.hasAttribute('data-original')) {
                        el.removeAttribute('data-original');
                    }
                }
                state.stats.skipped++;
                return true;
            }
        }
        
        var lower = url.toLowerCase();
        
        for (var i = 0; i < CONFIG.skipPatterns.length; i++) {
            if (lower.indexOf(CONFIG.skipPatterns[i]) !== -1) {
                state.stats.skipped++;
                return true;
            }
        }
        
        if (el) {
            var classes = el.className.toLowerCase();
            if (classes.indexOf('forum-') !== -1 || 
                classes.indexOf('prosemirror') !== -1 ||
                classes.indexOf('tiptap') !== -1) {
                state.stats.skipped++;
                return true;
            }
            if (el.hasAttribute('data-forum-avatar') || 
                el.hasAttribute('data-username')) {
                state.stats.skipped++;
                return true;
            }
        }
        
        return false;
    }
    
    // ===== UTILITY FUNCTIONS =====
    function isMediaElement(el) {
        return el && (el.tagName === 'IMG' || el.tagName === 'IFRAME' || el.tagName === 'VIDEO');
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
        if (lower.indexOf('.gif') !== -1) return 'gif';
        if (lower.indexOf('.webp') !== -1) return 'webp';
        if (lower.indexOf('.avif') !== -1) return 'avif';
        return 'unknown';
    }
    
    // ===== VIDEO POSTER GENERATION =====
    function createSvgPoster(video) {
        if (isInEditor(video)) return;
        
        var width = video.getAttribute('width') || 640;
        var height = video.getAttribute('height') || 360;
        
        var svg = '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">' +
                  '<rect width="100%" height="100%" fill="#2a2a2a"/>' +
                  '<text x="50%" y="50%" font-family="Arial" font-size="16" fill="#ffffff" text-anchor="middle" dy=".3em">🎬 Video</text>' +
                  '</svg>';
        
        var poster = 'data:image/svg+xml,' + encodeURIComponent(svg);
        video.setAttribute('poster', poster);
        video.setAttribute('data-poster-type', 'svg');
    }
    
    function generateVideoPoster(video) {
        if (isInEditor(video)) return;
        
        var videoSrc = video.src || (video.querySelector('source[src]') ? video.querySelector('source[src]').src : null);
        if (!videoSrc) return;
        
        var lowerSrc = videoSrc.toLowerCase();
        var posterUrl = null;
        var posterType = 'unknown';
        
        // Platform-specific poster generation (same as before)
        if (lowerSrc.indexOf('tenor.com') !== -1) {
            posterUrl = videoSrc.replace('.webm', '.gif').replace('.mp4', '.gif');
            posterType = 'tenor-gif';
        }
        else if (lowerSrc.indexOf('giphy.com') !== -1 || lowerSrc.indexOf('media.giphy.com') !== -1) {
            var giphyMatches = videoSrc.match(/\/media\/([^\/]+)\//);
            if (giphyMatches) {
                var giphyId = giphyMatches[1];
                posterUrl = 'https://media.giphy.com/media/' + giphyId + '/giphy.gif';
                posterType = 'giphy-gif';
            } else {
                posterUrl = videoSrc.replace('.mp4', '.gif');
                posterType = 'giphy-gif';
            }
        }
        else if (lowerSrc.indexOf('imgur.com') !== -1) {
            var imgurMatches = videoSrc.match(/imgur\.com\/([^\/\.]+)/);
            if (imgurMatches) {
                var imgurId = imgurMatches[1];
                posterUrl = 'https://i.imgur.com/' + imgurId + '.gif';
                posterType = 'imgur-gif';
            }
        }
        else if (lowerSrc.indexOf('reddit.com') !== -1 || lowerSrc.indexOf('redd.it') !== -1) {
            if (lowerSrc.indexOf('v.redd.it') !== -1) {
                var redditId = videoSrc.split('/').pop().split('?')[0];
                posterUrl = 'https://external-preview.redd.it/' + redditId + '?auto=webp&s=thumbnail';
                posterType = 'reddit-preview';
            }
        }
        else if (lowerSrc.indexOf('youtube.com') !== -1 || lowerSrc.indexOf('youtu.be') !== -1) {
            var youtubeId = null;
            var youtubeMatches = videoSrc.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
            if (youtubeMatches) {
                youtubeId = youtubeMatches[1];
                posterUrl = 'https://img.youtube.com/vi/' + youtubeId + '/maxresdefault.jpg';
                posterType = 'youtube-thumb';
            }
        }
        
        if (posterUrl && !isInEditor(video)) {
            video.setAttribute('poster', posterUrl);
            video.setAttribute('data-poster-type', posterType);
            video.setAttribute('data-poster-loaded', 'true');
            state.videos.withPoster++;
        } else if (!isInEditor(video)) {
            createSvgPoster(video);
            video.setAttribute('data-poster-loaded', 'true');
            state.videos.withPoster++;
        }
    }
    
    // ===== VIDEO HANDLING =====
    function setupVideoLazyLoading(video) {
        if (isInEditor(video)) return;
        if (state.processed.has(video)) return;
        
        state.processed.add(video);
        state.videos.total++;
        
        var hasAutoplay = video.hasAttribute('autoplay');
        if (hasAutoplay) {
            state.videos.autoplayVideos++;
        }
        
        if (!video.hasAttribute('preload') || video.getAttribute('preload') === '') {
            var preloadValue = hasAutoplay ? CONFIG.video.autoplayPreload : CONFIG.video.preload;
            video.setAttribute('preload', preloadValue);
            
            if (!hasAutoplay && preloadValue === 'none') {
                state.videos.preloadNone++;
            }
        }
        
        if (!video.poster) {
            generateVideoPoster(video);
        } else {
            state.videos.withPoster++;
        }
        
        video.setAttribute('data-video-processed', 'true');
    }
    
    // ===== LAZY LOADING & DECODING =====
    function applyLazyAttributes(el) {
        if (!isMediaElement(el) || isInEditor(el)) return el;
        
        if (el.tagName === 'IFRAME') {
            if (!el.hasAttribute('loading') || el.getAttribute('loading') === '') {
                el.setAttribute('loading', CONFIG.lazy);
            }
            
            if (!el.src || el.src === '' || el.src === window.location.href) {
                el.setAttribute('data-placeholder', 'true');
            }
        }
        
        if (el.tagName === 'IMG') {
            if (!el.hasAttribute('loading') || el.getAttribute('loading') === '') {
                el.setAttribute('loading', CONFIG.lazy);
            }
            
            if (!el.hasAttribute('decoding') || el.getAttribute('decoding') === '') {
                el.setAttribute('decoding', CONFIG.async);
            }
        }
        
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
        
        var outputFormat = isGif ? 'webp' : 'webp';
        var quality = CONFIG.quality[outputFormat] || CONFIG.quality.unknown;
        
        var params = [
            'maxage=' + CONFIG.cache,
            'q=' + quality
        ];
        
        if (outputFormat === 'webp') {
            params.push('il');
        }
        
        if (isGif) {
            params.push('n=-1');
            params.push('lossless=true');
        } else if (originalFormat === 'png') {
            params.push('af');
            params.push('l=9');
        }
        
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
        // CRITICAL: Multiple checks to ensure we don't process editor images
        if (!img || !img.src || img.src.indexOf('data:') === 0) return;
        
        // Check if editor is active OR image is in editor
        if (state.isEditorActive || isEditorOperation() || isInEditor(img)) {
            img.setAttribute('data-optimized', 'skipped-editor');
            return;
        }
        
        // Additional check for ProseMirror-specific images
        if (img.classList.contains('ProseMirror-separator') ||
            img.hasAttribute('data-prosemirror') ||
            (img.closest('.ProseMirror') && img.getAttribute('contenteditable') === 'false')) {
            img.setAttribute('data-optimized', 'skipped-editor');
            return;
        }
        
        applyLazyAttributes(img);
        
        if (state.processed.has(img)) return;
        if (state.processingQueue.has(img)) return;
        
        var skip = shouldSkip(img.src, img);
        if (skip) {
            state.processed.add(img);
            return;
        }
        
        state.processingQueue.add(img);
        state.processed.add(img);
        state.stats.total++;
        
        var originalSrc = img.src;
        img.setAttribute('data-original', originalSrc);
        
        var optimization = buildWeservUrl(img);
        
        state.stats.optimized++;
        state.stats.byFormat[optimization.format] = (state.stats.byFormat[optimization.format] || 0) + 1;
        state.stats.byQuality[optimization.quality] = (state.stats.byQuality[optimization.quality] || 0) + 1;
        
        img.onerror = function() {
            state.stats.failed++;
            img.setAttribute('data-optimized', 'failed');
            img.src = originalSrc;
            img.onerror = null;
            state.processingQueue.delete(img);
        };
        
        img.onload = function() {
            state.processingQueue.delete(img);
        };
        
        img.src = optimization.url;
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-format', optimization.format);
        img.setAttribute('data-quality', optimization.quality);
    }
    
    // ===== MUTATION OBSERVER =====
    var mutationObserver = new MutationObserver(function(mutations) {
        // Check if editor is active before processing any mutations
        if (state.isEditorActive || isEditorOperation()) {
            return;
        }
        
        var processedInThisBatch = new WeakSet();
        
        mutations.forEach(function(mutation) {
            if (mutation.type !== 'childList') return;
            
            var target = mutation.target;
            
            // Skip if target is in editor
            if (isInEditor(target)) {
                return;
            }
            
            var nodes = mutation.addedNodes;
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                if (node.nodeType !== 1 || processedInThisBatch.has(node)) continue;
                
                // Skip if node is in editor
                if (isInEditor(node)) {
                    continue;
                }
                
                processedInThisBatch.add(node);
                
                if (node.tagName === 'IMG') {
                    if (!isInEditor(node)) {
                        applyLazyAttributes(node);
                        optimizeImage(node);
                    }
                } else if (node.tagName === 'IFRAME' || node.tagName === 'VIDEO') {
                    if (!isInEditor(node)) {
                        applyLazyAttributes(node);
                    }
                }
                
                if (node.children && node.children.length) {
                    var images = node.getElementsByTagName('IMG');
                    for (var j = 0; j < images.length; j++) {
                        var img = images[j];
                        if (!processedInThisBatch.has(img) && !isInEditor(img)) {
                            processedInThisBatch.add(img);
                            applyLazyAttributes(img);
                            optimizeImage(img);
                        }
                    }
                    
                    var iframes = node.getElementsByTagName('IFRAME');
                    for (var k = 0; k < iframes.length; k++) {
                        var iframe = iframes[k];
                        if (!processedInThisBatch.has(iframe) && !isInEditor(iframe)) {
                            processedInThisBatch.add(iframe);
                            applyLazyAttributes(iframe);
                        }
                    }
                    
                    var videos = node.getElementsByTagName('VIDEO');
                    for (var l = 0; l < videos.length; l++) {
                        var video = videos[l];
                        if (!processedInThisBatch.has(video) && !isInEditor(video)) {
                            processedInThisBatch.add(video);
                            applyLazyAttributes(video);
                        }
                    }
                }
            }
        });
    });
    
    // ===== EDITOR ACTIVITY MONITORING =====
    function setupEditorMonitoring() {
        var editor = document.querySelector('.tiptap, .ProseMirror, [contenteditable="true"]');
        if (editor) {
            editor.addEventListener('focus', function() {
                state.isEditorActive = true;
            });
            
            editor.addEventListener('blur', function() {
                state.isEditorActive = false;
            });
            
            editor.addEventListener('click', function() {
                state.isEditorActive = true;
            });
            
            // Monitor for image insertion in editor
            editor.addEventListener('DOMNodeInserted', function(e) {
                if (e.target.tagName === 'IMG') {
                    // Mark any images inserted into editor as skipped
                    e.target.setAttribute('data-optimized', 'skipped-editor');
                }
            }, false);
        }
    }
    
    // ===== PROXY PATTERNS =====
    var OriginalImage = window.Image;
    window.Image = function(width, height) {
        var img = new OriginalImage(width, height);
        
        // Don't apply lazy attributes if editor is active
        if (!state.isEditorActive && !isEditorOperation()) {
            img.setAttribute('loading', CONFIG.lazy);
            img.setAttribute('decoding', CONFIG.async);
        }
        
        var originalSrcDesc = Object.getOwnPropertyDescriptor(img, 'src');
        if (originalSrcDesc && originalSrcDesc.set) {
            Object.defineProperty(img, 'src', {
                set: function(value) {
                    originalSrcDesc.set.call(this, value);
                    // CRITICAL: Don't optimize if editor is active
                    if (value && value.indexOf('data:') !== 0 && 
                        !state.isEditorActive && !isEditorOperation() && !isInEditor(this)) {
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
    
    var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (srcDescriptor && srcDescriptor.set) {
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            set: function(value) {
                srcDescriptor.set.call(this, value);
                // CRITICAL: Don't optimize if editor is active
                if (value && value.indexOf('data:') !== 0 && this.isConnected && 
                    !state.isEditorActive && !isEditorOperation() && !isInEditor(this)) {
                    optimizeImage(this);
                }
            },
            get: srcDescriptor.get,
            configurable: true
        });
    }
    
    var originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
        originalSetAttribute.call(this, name, value);
        
        // CRITICAL: Don't optimize if editor is active
        if (name === 'src' && this.tagName === 'IMG' && value && value.indexOf('data:') !== 0) {
            if (!state.isEditorActive && !isEditorOperation() && !isInEditor(this)) {
                optimizeImage(this);
            } else if (isInEditor(this)) {
                this.setAttribute('data-optimized', 'skipped-editor');
            }
        }
    };
    
    var originalCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        var element = originalCreateElement.call(this, tagName, options);
        
        if (tagName.toLowerCase() === 'img') {
            // Only apply lazy attributes if not in editor
            if (!state.isEditorActive && !isEditorOperation()) {
                applyLazyAttributes(element);
            }
        }
        
        return element;
    };
    
    // ===== INITIALIZATION =====
    function init() {
        if (state.initDone) return;
        state.initDone = true;
        
        // Set up editor monitoring
        setupEditorMonitoring();
        
        // Small delay to ensure editor is fully loaded
        setTimeout(function() {
            // Process only non-editor images
            var allImages = document.querySelectorAll('img');
            for (var i = 0; i < allImages.length; i++) {
                var img = allImages[i];
                if (!isInEditor(img)) {
                    applyLazyAttributes(img);
                    optimizeImage(img);
                } else {
                    img.setAttribute('data-optimized', 'skipped-editor');
                }
            }
            
            // Process iframes (skip editor)
            var allIframes = document.querySelectorAll('iframe');
            for (var j = 0; j < allIframes.length; j++) {
                var iframe = allIframes[j];
                if (!isInEditor(iframe)) {
                    applyLazyAttributes(iframe);
                }
            }
            
            // Process videos (skip editor)
            var allVideos = document.querySelectorAll('video');
            for (var k = 0; k < allVideos.length; k++) {
                var video = allVideos[k];
                if (!isInEditor(video)) {
                    applyLazyAttributes(video);
                }
            }
            
            // Start observing after initial processing
            if (document.body) {
                mutationObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }
            
            // Dispatch ready event
            window.dispatchEvent(new CustomEvent('weserv-ready', {
                detail: { 
                    stats: state.stats,
                    timestamp: Date.now()
                }
            }));
        }, 500); // Increased delay to ensure editor is ready
    }
    
    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})();
