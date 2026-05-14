/*media attributes - optimized version*/
(function() {
    'use strict';

    // ===== CONFIGURATION =====
    var DEBUG = false; // Set to true for verbose logging
    
    var CONFIG = {
        cdn: 'https://images.weserv.nl/',
        cdnFallback: 'https://cdn.jsdelivr.net/gh/',
        lazy: 'lazy',
        async: 'async',
        cache: '1y',
        posterTimeout: 8000, // timeout for poster generation
        quality: {
            jpg: '90',
            jpeg: '90',
            webp: '85',
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
            'data:image'
        ]
    };

    // ===== PERFORMANCE TRACKING =====
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('weserv-start');
    }

    // ===== STATE MANAGEMENT =====
    var state = {
        processed: new WeakSet(),
        skipRegex: null, // Will be compiled from CONFIG.skipPatterns
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
        mutationObserverActive: false
    };

    // ===== UTILITY FUNCTIONS =====
    function log(message, data) {
        if (DEBUG) {
            console.log(message, data || '');
        }
    }

    function warn(message, data) {
        console.warn(message, data || '');
    }

    function compileSkipRegex() {
        try {
            var escapedPatterns = CONFIG.skipPatterns.map(function(p) {
                return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            });
            state.skipRegex = new RegExp(escapedPatterns.join('|'), 'i');
            log('✅ Skip regex compiled with', CONFIG.skipPatterns.length + ' patterns');
        } catch (e) {
            warn('⚠️ Failed to compile skip regex:', e.message);
            state.skipRegex = null;
        }
    }

    function isMediaElement(el) {
        return el && ['IMG', 'IFRAME', 'VIDEO'].indexOf(el.tagName) !== -1;
    }

    function shouldSkip(url, el) {
        if (!url || typeof url !== 'string') return true;
        
        var lower = url.toLowerCase();
        if (lower.indexOf('data:') === 0) return true;

        // Use compiled regex for efficiency
        if (state.skipRegex && state.skipRegex.test(lower)) return true;

        if (el) {
            var classes = el.className;
            if (typeof classes === 'string' && classes.toLowerCase().indexOf('forum-') !== -1) {
                return true;
            }
            if (el.hasAttribute('data-forum-avatar') || el.hasAttribute('data-username')) {
                return true;
            }
        }

        return false;
    }

    function detectFormat(url) {
        if (!url || typeof url !== 'string') return 'unknown';
        
        var lower = url.toLowerCase();
        if (lower.indexOf('.jpg') !== -1 || lower.indexOf('.jpeg') !== -1) return 'jpeg';
        if (lower.indexOf('.png') !== -1) return 'png';
        if (lower.indexOf('.gif') !== -1 && (lower.indexOf('.gif?') !== -1 || lower.lastIndexOf('.gif') === lower.length - 4)) {
            return 'gif';
        }
        if (lower.indexOf('.webp') !== -1) return 'webp';
        if (lower.indexOf('.avif') !== -1) return 'avif';
        return 'unknown';
    }

    // ===== VIDEO POSTER GENERATION =====
    function createSvgPoster(video) {
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

    function setPosterWithTimeout(video, posterUrl, posterType) {
        var timeoutId = setTimeout(function() {
            if (!video.hasAttribute('data-poster-loaded')) {
                createSvgPoster(video);
                video.setAttribute('data-poster-loaded', 'timeout');
                log('⏱️ Poster timeout, using SVG fallback');
            }
        }, CONFIG.posterTimeout);

        var img = new Image();
        img.onload = function() {
            clearTimeout(timeoutId);
            video.setAttribute('poster', posterUrl);
            video.setAttribute('data-poster-type', posterType);
            video.setAttribute('data-poster-loaded', 'true');
            state.videos.withPoster++;
            log('✅ Poster loaded:', posterType);
        };
        img.onerror = function() {
            clearTimeout(timeoutId);
            if (!video.hasAttribute('data-poster-loaded')) {
                createSvgPoster(video);
                video.setAttribute('data-poster-loaded', 'fallback');
                state.videos.withPoster++;
                log('ℹ️ Poster fallback to SVG');
            }
        };
        img.src = posterUrl;
    }

    function generateVideoPoster(video) {
        var videoSrc = video.src || (video.querySelector('source[src]') ? video.querySelector('source[src]').src : null);
        if (!videoSrc) {
            createSvgPoster(video);
            video.setAttribute('data-poster-loaded', 'true');
            state.videos.withPoster++;
            return;
        }

        var lowerSrc = videoSrc.toLowerCase();
        var posterUrl = null;
        var posterType = 'unknown';

        // ===== TENOR =====
        if (lowerSrc.indexOf('tenor.com') !== -1) {
            posterUrl = videoSrc.replace('.webm', '.gif').replace('.mp4', '.gif');
            posterType = 'tenor-gif';
        }
        // ===== GIPHY =====
        else if (lowerSrc.indexOf('giphy.com') !== -1 || lowerSrc.indexOf('media.giphy.com') !== -1) {
            var giphyMatches = videoSrc.match(/\/media\/([^\/]+)\//);
            if (giphyMatches) {
                posterUrl = 'https://media.giphy.com/media/' + giphyMatches[1] + '/giphy.gif';
                posterType = 'giphy-gif';
            } else {
                posterUrl = videoSrc.replace('.mp4', '.gif');
                posterType = 'giphy-gif';
            }
        }
        // ===== IMGUR =====
        else if (lowerSrc.indexOf('imgur.com') !== -1) {
            var imgurMatches = videoSrc.match(/imgur\.com\/([^\/\.]+)/);
            if (imgurMatches) {
                posterUrl = 'https://i.imgur.com/' + imgurMatches[1] + '.gif';
                posterType = 'imgur-gif';
            }
        }
        // ===== REDDIT =====
        else if (lowerSrc.indexOf('reddit.com') !== -1 || lowerSrc.indexOf('redd.it') !== -1) {
            if (lowerSrc.indexOf('v.redd.it') !== -1) {
                var redditId = videoSrc.split('/').pop().split('?')[0];
                posterUrl = 'https://external-preview.redd.it/' + redditId + '?auto=webp&s=thumbnail';
                posterType = 'reddit-preview';
            }
        }
        // ===== TWITTER/X =====
        else if (lowerSrc.indexOf('twitter.com') !== -1 || lowerSrc.indexOf('x.com') !== -1) {
            var twitterMatches = videoSrc.match(/\/tweet_video\/([^\/\.]+)/);
            if (twitterMatches) {
                posterUrl = 'https://video.twimg.com/tweet_video_thumb/' + twitterMatches[1] + '.jpg';
                posterType = 'twitter-thumb';
            }
        }
        // ===== TIKTOK =====
        else if (lowerSrc.indexOf('tiktok.com') !== -1) {
            var tiktokMatches = videoSrc.match(/\/video\/(\d+)/);
            if (tiktokMatches) {
                posterUrl = 'https://www.tiktok.com/api/img/?itemId=' + tiktokMatches[1];
                posterType = 'tiktok-thumb';
            }
        }
        // ===== YOUTUBE =====
        else if (lowerSrc.indexOf('youtube.com') !== -1 || lowerSrc.indexOf('youtu.be') !== -1) {
            var youtubeMatches = videoSrc.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
            if (youtubeMatches) {
                var youtubeId = youtubeMatches[1];
                posterUrl = 'https://img.youtube.com/vi/' + youtubeId + '/maxresdefault.jpg';
                posterType = 'youtube-thumb';
                setPosterWithTimeout(video, posterUrl, posterType);
                return;
            }
        }
        // ===== VIMEO =====
        else if (lowerSrc.indexOf('vimeo.com') !== -1) {
            var vimeoMatches = videoSrc.match(/vimeo\.com\/(\d+)/);
            if (vimeoMatches) {
                posterUrl = 'https://i.vimeocdn.com/video/' + vimeoMatches[1] + '_640.jpg';
                posterType = 'vimeo-thumb';
            }
        }
        // ===== IMGPLAY =====
        else if (lowerSrc.indexOf('imgplay.io') !== -1 || lowerSrc.indexOf('imgplay') !== -1) {
            posterUrl = videoSrc.replace('.mp4', '.jpg').replace('.webm', '.jpg');
            posterType = 'imgplay-thumb';
        }
        // ===== CLIPCHAMP =====
        else if (lowerSrc.indexOf('clipchamp.com') !== -1) {
            posterUrl = videoSrc.replace('/video/', '/thumbnail/') + '.jpg';
            posterType = 'clipchamp-thumb';
        }
        // ===== FACEBOOK =====
        else if (lowerSrc.indexOf('facebook.com') !== -1 || lowerSrc.indexOf('fbcdn.net') !== -1) {
            var fbMatches = videoSrc.match(/\/v\/(\d+)/);
            if (fbMatches) {
                posterUrl = 'https://graph.facebook.com/' + fbMatches[1] + '/picture';
                posterType = 'facebook-thumb';
            }
        }
        // ===== INSTAGRAM =====
        else if (lowerSrc.indexOf('instagram.com') !== -1 || lowerSrc.indexOf('cdninstagram.com') !== -1) {
            var instaMatches = videoSrc.match(/\/p\/([^\/]+)/);
            if (instaMatches) {
                posterUrl = 'https://www.instagram.com/p/' + instaMatches[1] + '/media/?size=t';
                posterType = 'instagram-thumb';
            }
        }
        // ===== DAILYMOTION =====
        else if (lowerSrc.indexOf('dailymotion.com') !== -1) {
            var dmMatches = videoSrc.match(/\/video\/([^_]+)/);
            if (dmMatches) {
                posterUrl = 'https://www.dailymotion.com/thumbnail/video/' + dmMatches[1];
                posterType = 'dailymotion-thumb';
            }
        }
        // ===== TWITCH =====
        else if (lowerSrc.indexOf('twitch.tv') !== -1 || lowerSrc.indexOf('clips.twitch.tv') !== -1) {
            var twitchMatches = videoSrc.match(/\/clip\/([^\/]+)/i);
            if (twitchMatches) {
                posterUrl = 'https://clips-media-assets.twitch.tv/' + twitchMatches[1] + '-preview.jpg';
                posterType = 'twitch-thumb';
            }
        }

        if (posterUrl) {
            setPosterWithTimeout(video, posterUrl, posterType);
        } else {
            createSvgPoster(video);
            video.setAttribute('data-poster-loaded', 'true');
            state.videos.withPoster++;
            log('ℹ️ SVG fallback for:', videoSrc.substring(0, 60));
        }
    }

    // ===== VIDEO HANDLING =====
    function setupVideoLazyLoading(video) {
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
        } else {
            if (video.getAttribute('preload') === 'none') {
                state.videos.preloadNone++;
            }
        }

        if (!video.poster) {
            generateVideoPoster(video);
        } else {
            state.videos.withPoster++;
        }

        var sources = video.querySelectorAll('source[src]');
        for (var i = 0; i < sources.length; i++) {
            var source = sources[i];
            if (!source.hasAttribute('data-original-src') && source.src) {
                source.setAttribute('data-original-src', source.src);
            }
        }

        video.setAttribute('data-video-processed', 'true');
    }

    // ===== LAZY LOADING & DECODING =====
    function applyLazyAttributes(el) {
        if (!isMediaElement(el)) return el;

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

        // Always use WebP for non-GIF images
        var outputFormat = isGif ? 'gif' : 'webp';
        var quality = CONFIG.quality[outputFormat] || CONFIG.quality.unknown;

        var params = [
            'maxage=' + CONFIG.cache,
            'q=' + quality
        ];

        switch (outputFormat) {
            case 'png':
                params.push('af');
                params.push('l=9');
                params.push('lossless=true');
                break;
            case 'webp':
                params.push('il');
                break;
            case 'gif':
                params.push('n=-1');
                params.push('lossless=true');
                break;
        }

        if (originalFormat === 'png') {
            params.push('af');
            params.push('l=9');
        }

        var filename = originalSrc.split('/').pop().split('?')[0].split('#')[0];
        if (filename && /^[a-zA-Z0-9._-]+$/.test(filename)) {
            params.push('filename=' + encodeURIComponent(filename));
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
        if (!img || !img.src || img.src.indexOf('data:') === 0) return;

        applyLazyAttributes(img);

        if (state.processed.has(img)) return;

        var skip = shouldSkip(img.src, img);
        if (skip) {
            state.processed.add(img);
            state.stats.skipped++;
            img.setAttribute('data-optimized', 'skipped');
            log('⊘ Skipped:', img.src.substring(0, 50));
            return;
        }

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
            warn('⚠️ Optimization failed, reverted:', originalSrc.substring(0, 50));
        };

        img.src = optimization.url;
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-format', optimization.format);
        img.setAttribute('data-quality', optimization.quality);
        log('✅ Optimized:', originalSrc.substring(0, 50));
    }

    // ===== DEBOUNCED MUTATION OBSERVER =====
    var mutationTimeout = null;
    var pendingMutations = [];

    function processPendingMutations() {
        if (pendingMutations.length === 0) return;

        var nodesToProcess = pendingMutations.slice();
        pendingMutations = [];

        nodesToProcess.forEach(function(node) {
            if (node.nodeType !== 1) return;

            if (node.tagName === 'IMG') {
                applyLazyAttributes(node);
                optimizeImage(node);
            } else if (node.tagName === 'IFRAME' || node.tagName === 'VIDEO') {
                applyLazyAttributes(node);
            }

            if (node.querySelectorAll) {
                var allMedia = node.querySelectorAll('img, iframe, video');
                for (var j = 0; j < allMedia.length; j++) {
                    var el = allMedia[j];
                    applyLazyAttributes(el);
                    if (el.tagName === 'IMG') {
                        optimizeImage(el);
                    }
                }
            }
        });
    }

    var mutationObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type !== 'childList') return;

            for (var i = 0; i < mutation.addedNodes.length; i++) {
                pendingMutations.push(mutation.addedNodes[i]);
            }
        });

        // Debounce mutation processing
        clearTimeout(mutationTimeout);
        mutationTimeout = setTimeout(processPendingMutations, 100);
    });

    // ===== CONSOLIDATED IMAGE PROXY (SINGLE ENTRY POINT) =====
    function setupImageProxy() {
        var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        if (!srcDescriptor || !srcDescriptor.set) {
            log('⚠️ Cannot hook HTMLImageElement.src');
            return;
        }

        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            set: function(value) {
                srcDescriptor.set.call(this, value);
                if (value && typeof value === 'string' && value.indexOf('data:') !== 0 && this.isConnected) {
                    // Defer optimization to avoid blocking
                    if (typeof requestAnimationFrame !== 'undefined') {
                        requestAnimationFrame(function() {
                            optimizeImage(this);
                        }.bind(this));
                    } else {
                        setTimeout(function() {
                            optimizeImage(this);
                        }.bind(this), 0);
                    }
                }
            },
            get: srcDescriptor.get,
            configurable: true
        });

        log('✅ Image proxy installed');
    }

    function setupElementProxy() {
        var originalSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            originalSetAttribute.call(this, name, value);

            if (name === 'src' && this.tagName === 'IMG' && value && value.indexOf('data:') !== 0) {
                if (typeof requestAnimationFrame !== 'undefined') {
                    requestAnimationFrame(function() {
                        optimizeImage(this);
                    }.bind(this));
                } else {
                    setTimeout(function() {
                        optimizeImage(this);
                    }.bind(this), 0);
                }
            }
        };

        log('✅ Element proxy installed');
    }

    // ===== INITIALIZATION =====
    function init() {
        if (state.initDone) return;
        state.initDone = true;

        log('🚀 Initializing weserv optimizer...');

        // Compile regex patterns
        compileSkipRegex();

        // Setup proxies
        setupImageProxy();
        setupElementProxy();

        // Batch process existing media
        var allMedia = document.querySelectorAll('img, iframe, video');
        var imageCount = 0;

        for (var i = 0; i < allMedia.length; i++) {
            var el = allMedia[i];
            applyLazyAttributes(el);
            if (el.tagName === 'IMG') {
                optimizeImage(el);
                imageCount++;
            }
        }

        log('✅ Processed ' + imageCount + ' existing images');

        // Setup mutation observer
        if (document.body) {
            mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
            state.mutationObserverActive = true;
            log('✅ Mutation observer active');
        } else {
            var bodyCheck = setInterval(function() {
                if (document.body) {
                    clearInterval(bodyCheck);
                    mutationObserver.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    state.mutationObserverActive = true;
                    log('✅ Mutation observer active (delayed)');

                    // Reprocess any missed media
                    var missedImages = document.querySelectorAll('img:not([data-optimized])');
                    for (var j = 0; j < missedImages.length; j++) {
                        optimizeImage(missedImages[j]);
                    }
                }
            }, 50);
        }

        // ===== DISPATCH READY EVENT =====
        setTimeout(function() {
            window.dispatchEvent(new CustomEvent('weserv-ready', {
                detail: {
                    stats: {
                        optimized: state.stats.optimized,
                        total: state.stats.total,
                        failed: state.stats.failed,
                        skipped: state.stats.skipped
                    },
                    timestamp: Date.now(),
                    imagesProcessed: state.stats.optimized
                }
            }));

            if (typeof performance !== 'undefined' && performance.mark) {
                performance.mark('weserv-ready-dispatched');
                try {
                    performance.measure('weserv-load-time', 'weserv-start', 'weserv-ready-dispatched');
                } catch (e) {
                    log('Performance measurement unavailable:', e.message);
                }
            }

            log('📢 Dispatched weserv-ready event with ' + state.stats.optimized + ' images optimized');
        }, 100);

        // ===== PERFORMANCE REPORT (on page load) =====
        window.addEventListener('load', function() {
            setTimeout(function() {
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(generatePerformanceReport, { timeout: 3000 });
                } else {
                    generatePerformanceReport();
                }
            }, 3000);
        });
    }

    // ===== PERFORMANCE REPORT GENERATION =====
    function generatePerformanceReport() {
        try {
            var finalImages = document.querySelectorAll('img');
            var finalIframes = document.querySelectorAll('iframe');
            var finalVideos = document.querySelectorAll('video');

            var lazyCount = 0;
            var asyncCount = 0;
            var placeholderCount = 0;
            var videosWithPoster = 0;

            for (var i = 0; i < finalImages.length; i++) {
                if (finalImages[i].getAttribute('loading') === CONFIG.lazy) lazyCount++;
                if (finalImages[i].getAttribute('decoding') === CONFIG.async) asyncCount++;
            }

            for (var j = 0; j < finalIframes.length; j++) {
                if (finalIframes[j].getAttribute('loading') === CONFIG.lazy) lazyCount++;
                if (finalIframes[j].getAttribute('data-placeholder') === 'true') placeholderCount++;
            }

            for (var k = 0; k < finalVideos.length; k++) {
                if (finalVideos[k].getAttribute('preload') === 'none') lazyCount++;
                if (finalVideos[k].poster) videosWithPoster++;
            }

            var totalMedia = finalImages.length + finalIframes.length + finalVideos.length;

            console.log('=== WESERV OPTIMIZER REPORT ===');
            console.log('Total images processed:', state.stats.total);
            console.log('Successfully optimized:', state.stats.optimized);
            console.log('Skipped:', state.stats.skipped);
            console.log('Failed:', state.stats.failed);
            console.log('Format breakdown:', state.stats.byFormat);
            console.log('Quality breakdown:', state.stats.byQuality);
            console.log('Lazy loading (all media):', lazyCount + '/' + totalMedia);
            console.log('Async decoding:', asyncCount + '/' + finalImages.length);
            console.log('Placeholder iframes:', placeholderCount);
            console.log('\n=== VIDEO STATS ===');
            console.log('Total videos:', finalVideos.length);
            console.log('Videos with preload="none":', state.videos.preloadNone);
            console.log('Autoplay videos:', state.videos.autoplayVideos);
            console.log('Videos with poster:', videosWithPoster);
            console.log('Videos missing poster:', finalVideos.length - videosWithPoster);

            if (state.stats.failed > 0) {
                console.warn('⚠️ Optimization failures:', state.stats.failed);
            }

            console.log('=== REPORT COMPLETE ===');
        } catch (e) {
            warn('Error generating performance report:', e.message);
        }
    }

    // ===== START INITIALIZATION =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
