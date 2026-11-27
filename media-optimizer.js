/* media attributes - API-aware optimized version with adaptive debouncing */
(function () {
    'use strict';

    var DEBUG = false;

    var CONFIG = {
        cdn: 'https://images.weserv.nl/',
        lazy: 'lazy',
        async: 'async',
        cache: '1y',
        posterTimeout: 8000,
        apiCacheTtlMs: 3 * 60 * 1000,
        preloadCap: 3,
        debounce: {
            smallBatchDelay: 16,
            largeBatchDelay: 100,
            batchSizeThreshold: 50
        },
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
            'res.cloudinary.com',
            'img.forumfree.net/html/emoticons',
            '/emojis/',
            'data:image'
        ]
    };

    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('weserv-start');
    }

    var state = {
        processed: new WeakSet(),
        skipRegex: null,
        apiMemoryCache: {},
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
        mutationObserverActive: false,
        processingMetrics: {
            lastProcessTime: 0,
            batchesProcessed: 0,
            averageBatchSize: 0
        }
    };

    function log(message, data) {
        if (DEBUG) {
            console.log(message, data || '');
        }
    }

    function warn(message, data) {
        console.warn(message, data || '');
    }

    // FIX Bug 2: use URL parsing instead of regex so protocol-relative URLs (//cdn/x.jpg)
    // are resolved against window.location.origin instead of rejected.
    function isValidHttpUrl(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            var parsed = new URL(url.trim(), window.location.origin);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (e) {
            return false;
        }
    }

    function decodeHtmlEntities(str) {
        if (!str || typeof str !== 'string') return '';
        var textarea = document.createElement('textarea');
        textarea.innerHTML = str;
        var once = textarea.value;
        if (once.indexOf('&') !== -1) {
            textarea.innerHTML = once;
            return textarea.value;
        }
        return once;
    }

    function extractImageUrlsFromHtml(htmlOrEscaped) {
        var urls = [];
        var seen = {};
        var decoded = decodeHtmlEntities(htmlOrEscaped || '');
        if (!decoded) return urls;

        var container = document.createElement('div');
        container.innerHTML = decoded;
        var imgs = container.querySelectorAll('img[src]');
        for (var i = 0; i < imgs.length; i++) {
            var src = imgs[i].getAttribute('src');
            if (isValidHttpUrl(src) && !seen[src]) {
                seen[src] = true;
                urls.push(src);
            }
        }
        return urls;
    }

    function compileSkipRegex() {
        try {
            var escapedPatterns = CONFIG.skipPatterns.map(function (p) {
                return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            });
            state.skipRegex = new RegExp(escapedPatterns.join('|'), 'i');
            log('Skip regex compiled with ' + CONFIG.skipPatterns.length + ' patterns');
        } catch (e) {
            warn('Failed to compile skip regex:', e.message);
            state.skipRegex = null;
        }
    }

    function isMediaElement(el) {
        return el && ['IMG', 'IFRAME', 'VIDEO'].indexOf(el.tagName) !== -1;
    }

    function shouldSkip(url, el) {
        if (!url || typeof url !== 'string') return true;
        var trimmed = url.trim();
        var lower = trimmed.toLowerCase();

        if (lower.indexOf('data:') === 0) return true;
        if (!isValidHttpUrl(trimmed)) return true;

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

    function createSvgPoster(video) {
        var width = video.getAttribute('width') || 640;
        var height = video.getAttribute('height') || 360;

        var svg = '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">' +
            '<rect width="100%" height="100%" fill="#2a2a2a"/>' +
            '<text x="50%" y="50%" font-family="Arial" font-size="16" fill="#ffffff" text-anchor="middle" dy=".3em">Video</text>' +
            '</svg>';

        var poster = 'data:image/svg+xml,' + encodeURIComponent(svg);
        video.setAttribute('poster', poster);
        video.setAttribute('data-poster-type', 'svg');
    }

    function setPosterWithTimeout(video, posterUrl, posterType) {
        var timeoutId = setTimeout(function () {
            if (!video.hasAttribute('data-poster-loaded')) {
                createSvgPoster(video);
                video.setAttribute('data-poster-loaded', 'timeout');
            }
        }, CONFIG.posterTimeout);

        var img = new Image();
        img.onload = function () {
            clearTimeout(timeoutId);
            video.setAttribute('poster', posterUrl);
            video.setAttribute('data-poster-type', posterType);
            video.setAttribute('data-poster-loaded', 'true');
            state.videos.withPoster++;
        };
        img.onerror = function () {
            clearTimeout(timeoutId);
            if (!video.hasAttribute('data-poster-loaded')) {
                createSvgPoster(video);
                video.setAttribute('data-poster-loaded', 'fallback');
                state.videos.withPoster++;
            }
        };
        img.src = posterUrl;
    }

    function generateVideoPoster(video) {
        var videoSrc = video.src || (video.querySelector('source[src]') ? video.querySelector('source[src]').src : null);
        if (!videoSrc || !isValidHttpUrl(videoSrc)) {
            createSvgPoster(video);
            video.setAttribute('data-poster-loaded', 'true');
            state.videos.withPoster++;
            return;
        }

        var lowerSrc = videoSrc.toLowerCase();
        var posterUrl = null;
        var posterType = 'unknown';

        if (lowerSrc.indexOf('tenor.com') !== -1) {
            posterUrl = videoSrc.replace('.webm', '.gif').replace('.mp4', '.gif');
            posterType = 'tenor-gif';
        } else if (lowerSrc.indexOf('giphy.com') !== -1 || lowerSrc.indexOf('media.giphy.com') !== -1) {
            var giphyMatches = videoSrc.match(/\/media\/([^\/]+)\//);
            posterUrl = giphyMatches
                ? ('https://media.giphy.com/media/' + giphyMatches[1] + '/giphy.gif')
                : videoSrc.replace('.mp4', '.gif');
            posterType = 'giphy-gif';
        } else if (lowerSrc.indexOf('imgur.com') !== -1) {
            var imgurMatches = videoSrc.match(/imgur\.com\/([^\/\.]+)/);
            if (imgurMatches) {
                posterUrl = 'https://i.imgur.com/' + imgurMatches[1] + '.gif';
                posterType = 'imgur-gif';
            }
        } else if (lowerSrc.indexOf('youtube.com') !== -1 || lowerSrc.indexOf('youtu.be') !== -1) {
            var youtubeMatches = videoSrc.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
            if (youtubeMatches) {
                posterUrl = 'https://img.youtube.com/vi/' + youtubeMatches[1] + '/maxresdefault.jpg';
                posterType = 'youtube-thumb';
            }
        } else if (lowerSrc.indexOf('vimeo.com') !== -1) {
            var vimeoMatches = videoSrc.match(/vimeo\.com\/(\d+)/);
            if (vimeoMatches) {
                posterUrl = 'https://i.vimeocdn.com/video/' + vimeoMatches[1] + '_640.jpg';
                posterType = 'vimeo-thumb';
            }
        }

        if (posterUrl && isValidHttpUrl(posterUrl)) {
            setPosterWithTimeout(video, posterUrl, posterType);
        } else {
            createSvgPoster(video);
            video.setAttribute('data-poster-loaded', 'true');
            state.videos.withPoster++;
        }
    }

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
        } else if (video.getAttribute('preload') === 'none') {
            state.videos.preloadNone++;
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

    function buildWeservUrlFromSrc(originalSrc) {
        var originalFormat = detectFormat(originalSrc);
        var outputFormat = 'webp';
        var quality = CONFIG.quality.webp;

        var params = [
            'maxage=' + CONFIG.cache,
            'q=' + quality,
            'il'
        ];

        if (originalFormat === 'gif') {
            params.push('n=-1');
            params.push('loop=0');
        }

        if (originalFormat === 'png') {
            params.push('af');
            params.push('l=9');
        }

        var filename = originalSrc.split('/').pop().split('?')[0].split('#')[0];
        if (filename && /^[a-zA-Z0-9._-]+$/.test(filename)) {
            params.push('filename=' + encodeURIComponent(filename));
        }

        var optimizedSrc = CONFIG.cdn + '?url=' + encodeURIComponent(originalSrc) + '&output=' + outputFormat;
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

    function buildWeservUrl(img) {
        return buildWeservUrlFromSrc(img.src);
    }

    function optimizeImage(img) {
        if (!img || !img.src || img.src.indexOf('data:') === 0) return;

        applyLazyAttributes(img);

        if (state.processed.has(img)) return;

        if (shouldSkip(img.src, img)) {
            state.processed.add(img);
            state.stats.skipped++;
            img.setAttribute('data-optimized', 'skipped');
            log('Skipped:', img.src.substring(0, 60));
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

        img.onerror = function () {
            state.stats.failed++;
            img.setAttribute('data-optimized', 'failed');
            img.src = originalSrc;
            img.onerror = null;
            warn('Optimization failed, reverted:', originalSrc.substring(0, 60));
        };

        img.src = optimization.url;
        img.setAttribute('data-optimized', 'true');
        img.setAttribute('data-format', optimization.format);
        img.setAttribute('data-quality', optimization.quality);
        log('Optimized:', originalSrc.substring(0, 60));
    }

    // ===== /api.php DISCOVERY PRELOAD & NORMALIZATION =====
    // Shared cache contract with media-dimensions: key = 'mfs_api:<endpoint>',
    // value = JSON { ts, data }. TTL 3 minutes.
    function fetchCachedApi(endpoint) {
        var now = Date.now();
        var mem = state.apiMemoryCache[endpoint];
        if (mem && now - mem.ts < CONFIG.apiCacheTtlMs) {
            return Promise.resolve(mem.data);
        }

        try {
            var raw = sessionStorage.getItem('mfs_api:' + endpoint);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && now - parsed.ts < CONFIG.apiCacheTtlMs) {
                    state.apiMemoryCache[endpoint] = parsed;
                    return Promise.resolve(parsed.data);
                }
            }
        } catch (e) {}

        return fetch(endpoint, { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                var entry = { ts: now, data: data };
                state.apiMemoryCache[endpoint] = entry;
                try {
                    sessionStorage.setItem('mfs_api:' + endpoint, JSON.stringify(entry));
                } catch (e) {}
                return data;
            });
    }

    // FIX Bug 3: dedupe against DOM, cap concurrent preloads, skip if image already being
    // fetched (in DOM in either original or optimized form). Preloading races the browser
    // otherwise and causes double fetches.
    function preloadOptimizedUrl(url) {
        if (!url || shouldSkip(url, null)) return;

        for (var i = 0; i < document.images.length; i++) {
            var img = document.images[i];
            if (img.src === url || img.getAttribute('data-original') === url) return;
        }

        if (document.querySelectorAll('link[data-mfs-preload]').length >= CONFIG.preloadCap) return;

        var opt = buildWeservUrlFromSrc(url);
        var link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = opt.url;
        link.setAttribute('data-mfs-preload', 'true');
        document.head.appendChild(link);
    }

    // FIX §2E: preconnect to weserv once per page. Old ?f= branch called buildWeservUrlFromSrc
    // with no side effect (dead loop) — replaced with a single preconnect.
    function addWeservPreconnect() {
        var origin = CONFIG.cdn.replace(/\/$/, '');
        if (document.querySelector('link[rel="preconnect"][href="' + origin + '"]')) return;
        var pc = document.createElement('link');
        pc.rel = 'preconnect';
        pc.href = origin;
        pc.crossOrigin = 'anonymous';
        document.head.appendChild(pc);
    }

    function discoverApiMediaFromContext() {
        var search = window.location.search || '';
        var topicMatch = search.match(/[?&]t=(\d+)/);
        var sectionMatch = search.match(/[?&]f=(\d+)/);

        if (topicMatch && topicMatch[1]) {
            fetchCachedApi('/api.php?t=' + encodeURIComponent(topicMatch[1]))
                .then(function (topicData) {
                    var msgs = (topicData && topicData.messages) || [];
                    if (msgs.length > 0 && msgs[0].content) {
                        var firstUrls = extractImageUrlsFromHtml(msgs[0].content);
                        if (firstUrls.length > 0) {
                            preloadOptimizedUrl(firstUrls[0]);
                        }
                    }
                })
                .catch(function () {});
        } else if (sectionMatch && sectionMatch[1]) {
            // Section pages: desc HTML has no width/height (verified against live API),
            // so per-thumbnail preloading would race the browser and add no value. Just
            // warm the connection and prime the cache for other consumers.
            addWeservPreconnect();
            fetchCachedApi('/api.php?f=' + encodeURIComponent(sectionMatch[1])).catch(function () {});
        }
    }

    // ===== ADAPTIVE DEBOUNCED MUTATION OBSERVER =====
    var mutationTimeout = null;
    var pendingMutations = [];
    var isProcessing = false;

    function processPendingMutations(nodesToProcess) {
        if (!nodesToProcess || nodesToProcess.length === 0 || isProcessing) return;

        isProcessing = true;
        var startTime = performance.now ? performance.now() : Date.now();
        var processedCount = 0;

        var runBatch = function () {
            nodesToProcess.forEach(function (node) {
                if (node.nodeType !== 1) return;

                if (node.tagName === 'IMG') {
                    applyLazyAttributes(node);
                    optimizeImage(node);
                    processedCount++;
                } else if (node.tagName === 'IFRAME' || node.tagName === 'VIDEO') {
                    applyLazyAttributes(node);
                    processedCount++;
                }

                if (node.querySelectorAll) {
                    var allMedia = node.querySelectorAll('img, iframe, video');
                    for (var j = 0; j < allMedia.length; j++) {
                        var el = allMedia[j];
                        applyLazyAttributes(el);
                        if (el.tagName === 'IMG') {
                            optimizeImage(el);
                        }
                        processedCount++;
                    }
                }
            });

            isProcessing = false;

            if (performance.now) {
                var processTime = performance.now() - startTime;
                state.processingMetrics.lastProcessTime = processTime;
                state.processingMetrics.batchesProcessed++;
                state.processingMetrics.averageBatchSize =
                    (state.processingMetrics.averageBatchSize * (state.processingMetrics.batchesProcessed - 1) + processedCount) /
                    state.processingMetrics.batchesProcessed;
            }
        };

        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(runBatch);
        } else {
            runBatch();
        }
    }

    var mutationObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (mutation.type !== 'childList') return;
            for (var i = 0; i < mutation.addedNodes.length; i++) {
                pendingMutations.push(mutation.addedNodes[i]);
            }
        });

        var adaptiveDelay = pendingMutations.length > CONFIG.debounce.batchSizeThreshold
            ? CONFIG.debounce.largeBatchDelay
            : CONFIG.debounce.smallBatchDelay;

        clearTimeout(mutationTimeout);
        mutationTimeout = setTimeout(function () {
            var nodesToProcess = pendingMutations.slice();
            pendingMutations = [];
            processPendingMutations(nodesToProcess);
        }, adaptiveDelay);
    });

    function setupImageProxy() {
        var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        if (!srcDescriptor || !srcDescriptor.set) return;

        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            set: function (value) {
                srcDescriptor.set.call(this, value);
                if (value && typeof value === 'string' && value.indexOf('data:') !== 0 && this.isConnected) {
                    var self = this;
                    if (typeof requestAnimationFrame !== 'undefined') {
                        requestAnimationFrame(function () { optimizeImage(self); });
                    } else {
                        setTimeout(function () { optimizeImage(self); }, 0);
                    }
                }
            },
            get: srcDescriptor.get,
            configurable: true
        });
    }

    function setupElementProxy() {
        var originalSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (name, value) {
            originalSetAttribute.call(this, name, value);
            if (name === 'src' && this.tagName === 'IMG' && value && value.indexOf('data:') !== 0) {
                var self = this;
                if (typeof requestAnimationFrame !== 'undefined') {
                    requestAnimationFrame(function () { optimizeImage(self); });
                } else {
                    setTimeout(function () { optimizeImage(self); }, 0);
                }
            }
        };
    }

    function init() {
        if (state.initDone) return;
        state.initDone = true;

        compileSkipRegex();
        setupImageProxy();
        setupElementProxy();

        var allMedia = document.querySelectorAll('img, iframe, video');
        for (var i = 0; i < allMedia.length; i++) {
            var el = allMedia[i];
            applyLazyAttributes(el);
            if (el.tagName === 'IMG') {
                optimizeImage(el);
            }
        }

        discoverApiMediaFromContext();

        if (document.body) {
            mutationObserver.observe(document.body, { childList: true, subtree: true });
            state.mutationObserverActive = true;
        } else {
            var bodyCheck = setInterval(function () {
                if (document.body) {
                    clearInterval(bodyCheck);
                    mutationObserver.observe(document.body, { childList: true, subtree: true });
                    state.mutationObserverActive = true;
                    var missedImages = document.querySelectorAll('img:not([data-optimized])');
                    for (var j = 0; j < missedImages.length; j++) {
                        optimizeImage(missedImages[j]);
                    }
                }
            }, 50);
        }

        setTimeout(function () {
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
                } catch (e) {}
            }
        }, 100);

        window.addEventListener('load', function () {
            setTimeout(function () {
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(generatePerformanceReport, { timeout: 3000 });
                } else {
                    generatePerformanceReport();
                }
            }, 3000);
        });
    }

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
            console.log('\n=== MUTATION PROCESSING METRICS ===');
            console.log('Batches processed:', state.processingMetrics.batchesProcessed);
            console.log('Average batch size:', Math.round(state.processingMetrics.averageBatchSize));
            console.log('Last batch process time:', Math.round(state.processingMetrics.lastProcessTime) + 'ms');
            console.log('\n=== VIDEO STATS ===');
            console.log('Total videos:', finalVideos.length);
            console.log('Videos with preload="none":', state.videos.preloadNone);
            console.log('Autoplay videos:', state.videos.autoplayVideos);
            console.log('Videos with poster:', videosWithPoster);
            console.log('Videos missing poster:', finalVideos.length - videosWithPoster);

            if (state.stats.failed > 0) {
                console.warn('Optimization failures:', state.stats.failed);
            }
            console.log('=== REPORT COMPLETE ===');
        } catch (e) {
            warn('Error generating performance report:', e.message);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
