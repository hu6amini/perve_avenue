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
        
        for (var i = 0; i < CONFIG.skipPatterns.length; i++) {
            if (lower.indexOf(CONFIG.skipPatterns[i]) !== -1) return true;
        }
        
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
    
    function tryAlternativeTenorUrl(videoSrc) {
        var matches = videoSrc.match(/tenor\.com\/([^\/]+)\/([^\/\.]+)/);
        if (matches) {
            var id = matches[1];
            return 'https://media.tenor.com/' + id + '/public/thumb.jpg';
        }
        return null;
    }
    
function generateVideoPoster(video) {
    var videoSrc = video.src || (video.querySelector('source[src]') ? video.querySelector('source[src]').src : null);
    if (!videoSrc) return;
    
    var lowerSrc = videoSrc.toLowerCase();
    var posterUrl = null;
    var posterType = 'unknown';
    
    // ===== TENOR =====
    if (lowerSrc.indexOf('tenor.com') !== -1) {
        posterUrl = videoSrc.replace('.webm', '.gif').replace('.mp4', '.gif');
        posterType = 'tenor-gif';
    }
    
    // ===== GIFHY =====
    else if (lowerSrc.indexOf('giphy.com') !== -1 || lowerSrc.indexOf('media.giphy.com') !== -1) {
        // Giphy format: https://media.giphy.com/media/ID/giphy.gif or .mp4
        var giphyMatches = videoSrc.match(/\/media\/([^\/]+)\//);
        if (giphyMatches) {
            var giphyId = giphyMatches[1];
            posterUrl = 'https://media.giphy.com/media/' + giphyId + '/giphy.gif';
            posterType = 'giphy-gif';
        } else {
            // Direct MP4 to GIF conversion
            posterUrl = videoSrc.replace('.mp4', '.gif');
            posterType = 'giphy-gif';
        }
    }
    
    // ===== IMGUR =====
    else if (lowerSrc.indexOf('imgur.com') !== -1) {
        // Imgur format: https://i.imgur.com/12345.mp4
        var imgurMatches = videoSrc.match(/imgur\.com\/([^\/\.]+)/);
        if (imgurMatches) {
            var imgurId = imgurMatches[1];
            posterUrl = 'https://i.imgur.com/' + imgurId + '.gif';
            posterType = 'imgur-gif';
        }
    }
    
    // ===== REDDIT =====
    else if (lowerSrc.indexOf('reddit.com') !== -1 || lowerSrc.indexOf('redd.it') !== -1) {
        // Reddit often uses v.redd.it or external links
        if (lowerSrc.indexOf('v.redd.it') !== -1) {
            // Try to get thumbnail from Reddit's preview system
            var redditId = videoSrc.split('/').pop().split('?')[0];
            posterUrl = 'https://external-preview.redd.it/' + redditId + '?auto=webp&s=thumbnail';
            posterType = 'reddit-preview';
        }
    }
    
    // ===== TWITTER/X =====
    else if (lowerSrc.indexOf('twitter.com') !== -1 || lowerSrc.indexOf('x.com') !== -1) {
        // Twitter video thumbnails follow pattern
        var twitterMatches = videoSrc.match(/\/tweet_video\/([^\/\.]+)/);
        if (twitterMatches) {
            var tweetId = twitterMatches[1];
            posterUrl = 'https://video.twimg.com/tweet_video_thumb/' + tweetId + '.jpg';
            posterType = 'twitter-thumb';
        }
    }
    
    // ===== TIKTOK =====
    else if (lowerSrc.indexOf('tiktok.com') !== -1) {
        // TikTok thumbnails
        var tiktokMatches = videoSrc.match(/\/video\/(\d+)/);
        if (tiktokMatches) {
            var tiktokId = tiktokMatches[1];
            posterUrl = 'https://www.tiktok.com/api/img/?itemId=' + tiktokId;
            posterType = 'tiktok-thumb';
        }
    }
    
    // ===== YOUTUBE =====
    else if (lowerSrc.indexOf('youtube.com') !== -1 || lowerSrc.indexOf('youtu.be') !== -1) {
        // Extract YouTube video ID
        var youtubeId = null;
        var youtubeMatches = videoSrc.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        if (youtubeMatches) {
            youtubeId = youtubeMatches[1];
            // Try maxresdefault first, fallback to hqdefault
            posterUrl = 'https://img.youtube.com/vi/' + youtubeId + '/maxresdefault.jpg';
            posterType = 'youtube-thumb';
            
            // Test if maxresdefault exists, fallback to hqdefault
            var img = new Image();
            img.onload = function() {
                video.setAttribute('poster', posterUrl);
                video.setAttribute('data-poster-type', posterType);
                video.setAttribute('data-poster-loaded', 'true');
                state.videos.withPoster++;
            };
            img.onerror = function() {
                var fallbackUrl = 'https://img.youtube.com/vi/' + youtubeId + '/hqdefault.jpg';
                video.setAttribute('poster', fallbackUrl);
                video.setAttribute('data-poster-type', 'youtube-thumb-fallback');
                video.setAttribute('data-poster-loaded', 'true');
                state.videos.withPoster++;
            };
            img.src = posterUrl;
            return; // Exit early since we're handling async
        }
    }
    
    // ===== VIMEO =====
    else if (lowerSrc.indexOf('vimeo.com') !== -1) {
        var vimeoMatches = videoSrc.match(/vimeo\.com\/(\d+)/);
        if (vimeoMatches) {
            var vimeoId = vimeoMatches[1];
            posterUrl = 'https://i.vimeocdn.com/video/' + vimeoId + '_640.jpg';
            posterType = 'vimeo-thumb';
        }
    }
    
    // ===== IMGPLAY ===== (common for forums)
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
        // Facebook uses complex CDN, try to get thumbnail from video ID
        var fbMatches = videoSrc.match(/\/v\/(\d+)/);
        if (fbMatches) {
            var fbId = fbMatches[1];
            posterUrl = 'https://graph.facebook.com/' + fbId + '/picture';
            posterType = 'facebook-thumb';
        }
    }
    
    // ===== INSTAGRAM =====
    else if (lowerSrc.indexOf('instagram.com') !== -1 || lowerSrc.indexOf('cdninstagram.com') !== -1) {
        var instaMatches = videoSrc.match(/\/p\/([^\/]+)/);
        if (instaMatches) {
            var instaId = instaMatches[1];
            posterUrl = 'https://www.instagram.com/p/' + instaId + '/media/?size=t';
            posterType = 'instagram-thumb';
        }
    }
    
    // ===== DAILYMOTION =====
    else if (lowerSrc.indexOf('dailymotion.com') !== -1) {
        var dmMatches = videoSrc.match(/\/video\/([^_]+)/);
        if (dmMatches) {
            var dmId = dmMatches[1];
            posterUrl = 'https://www.dailymotion.com/thumbnail/video/' + dmId;
            posterType = 'dailymotion-thumb';
        }
    }
    
    // ===== TWITCH =====
    else if (lowerSrc.indexOf('twitch.tv') !== -1 || lowerSrc.indexOf('clips.twitch.tv') !== -1) {
        var twitchMatches = videoSrc.match(/\/clip\/([^\/]+)/i);
        if (twitchMatches) {
            var clipId = twitchMatches[1];
            posterUrl = 'https://clips-media-assets.twitch.tv/' + clipId + '-preview.jpg';
            posterType = 'twitch-thumb';
        }
    }
    
    // If we found a poster URL, set it directly
    if (posterUrl) {
        video.setAttribute('poster', posterUrl);
        video.setAttribute('data-poster-type', posterType);
        video.setAttribute('data-poster-loaded', 'true');
        state.videos.withPoster++;
        console.log('✅ Poster set for ' + posterType + ': ' + posterUrl.substring(0, 60) + '...');
    } else {
        // Fallback to SVG for unknown sites
        createSvgPoster(video);
        video.setAttribute('data-poster-loaded', 'true');
        state.videos.withPoster++;
        console.log('ℹ️ SVG fallback for:', videoSrc.substring(0, 60) + '...');
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
        
        var outputFormat;
        if (isGif) {
            outputFormat = 'webp';
        } else {
            outputFormat = supportsFormat('avif') ? 'avif' : 'webp';
        }
        
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
            case 'avif':
                params.push('lossless=true');
                params.push('il');
                break;
            case 'jpeg':
            case 'jpg':
                params.push('il');
                break;
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
        if (!img.src || img.src.indexOf('data:') === 0) return;
        
        applyLazyAttributes(img);
        
        if (state.processed.has(img)) return;
        
        var skip = shouldSkip(img.src, img);
        if (skip) {
            state.processed.add(img);
            state.stats.skipped++;
            img.setAttribute('data-optimized', 'skipped');
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
                
                if (node.tagName === 'IMG' || node.tagName === 'IFRAME' || node.tagName === 'VIDEO') {
                    applyLazyAttributes(node);
                    if (node.tagName === 'IMG') {
                        optimizeImage(node);
                    }
                }
                
                if (node.querySelectorAll) {
                    var allMedia = node.querySelectorAll('img, iframe, video');
                    for (var j = 0; j < allMedia.length; j++) {
                        applyLazyAttributes(allMedia[j]);
                    }
                    
                    var images = node.querySelectorAll('img');
                    for (var k = 0; k < images.length; k++) {
                        optimizeImage(images[k]);
                    }
                }
            }
        });
    });
    
    // ===== PROXY PATTERNS =====
    var OriginalImage = window.Image;
    window.Image = function(width, height) {
        var img = new OriginalImage(width, height);
        
        img.setAttribute('loading', CONFIG.lazy);
        img.setAttribute('decoding', CONFIG.async);
        
        var originalSrcDesc = Object.getOwnPropertyDescriptor(img, 'src');
        if (originalSrcDesc && originalSrcDesc.set) {
            Object.defineProperty(img, 'src', {
                set: function(value) {
                    originalSrcDesc.set.call(this, value);
                    if (value && value.indexOf('data:') !== 0) {
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
                if (value && value.indexOf('data:') !== 0 && this.isConnected) {
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
        
        if (name === 'src' && this.tagName === 'IMG' && value && value.indexOf('data:') !== 0) {
            optimizeImage(this);
        }
    };
    
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
        
        var allImages = document.querySelectorAll('img');
        for (var i = 0; i < allImages.length; i++) {
            var img = allImages[i];
            applyLazyAttributes(img);
            optimizeImage(img);
        }
        
        var allIframes = document.querySelectorAll('iframe');
        for (var j = 0; j < allIframes.length; j++) {
            applyLazyAttributes(allIframes[j]);
        }
        
        var allVideos = document.querySelectorAll('video');
        for (var k = 0; k < allVideos.length; k++) {
            applyLazyAttributes(allVideos[k]);
        }
        
        if (document.body) {
            mutationObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        } else {
            var bodyCheck = setInterval(function() {
                if (document.body) {
                    clearInterval(bodyCheck);
                    mutationObserver.observe(document.body, {
                        childList: true,
                        subtree: true
                    });
                    
                    var missedImages = document.querySelectorAll('img:not([data-optimized])');
                    for (var i = 0; i < missedImages.length; i++) {
                        optimizeImage(missedImages[i]);
                    }
                    
                    var missedIframes = document.querySelectorAll('iframe:not([loading])');
                    for (var j = 0; j < missedIframes.length; j++) {
                        applyLazyAttributes(missedIframes[j]);
                    }
                    
                    var missedVideos = document.querySelectorAll('video:not([data-video-processed])');
                    for (var k = 0; k < missedVideos.length; k++) {
                        applyLazyAttributes(missedVideos[k]);
                    }
                }
            }, 50);
        }
        
        // ===== PERFORMANCE REPORT =====
        window.addEventListener('load', function() {
            setTimeout(function() {
                // Update video poster count from actual DOM
                var finalVideos = document.querySelectorAll('video');
                var videosWithPoster = 0;
                for (var v = 0; v < finalVideos.length; v++) {
                    if (finalVideos[v].poster) videosWithPoster++;
                }
                
                var finalImages = document.querySelectorAll('img');
                var finalIframes = document.querySelectorAll('iframe');
                var lazyCount = 0;
                var asyncCount = 0;
                var placeholderCount = 0;
                
                for (var i = 0; i < finalImages.length; i++) {
                    if (finalImages[i].getAttribute('loading') === CONFIG.lazy) lazyCount++;
                    if (finalImages[i].getAttribute('decoding') === CONFIG.async) asyncCount++;
                }
                
                for (var j = 0; j < finalIframes.length; j++) {
                    if (finalIframes[j].getAttribute('loading') === CONFIG.lazy) lazyCount++;
                    if (finalIframes[j].getAttribute('data-placeholder') === 'true') placeholderCount++;
                }
                
                for (var k = 0; k < finalVideos.length; k++) {
                    var preload = finalVideos[k].getAttribute('preload');
                    if (preload === 'none') lazyCount++;
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
                console.log('Total videos:', finalVideos.length);
                console.log('Videos with preload="none":', state.videos.preloadNone);
                console.log('Autoplay videos:', state.videos.autoplayVideos);
                console.log('Videos with poster:', videosWithPoster);
                console.log('Videos missing poster:', finalVideos.length - videosWithPoster);
                
                if (state.stats.failed > 0) {
                    console.warn('Optimization failures:', state.stats.failed);
                }
                
                var iframesWithoutLazy = document.querySelectorAll('iframe:not([loading="lazy"])');
                if (iframesWithoutLazy.length > 0) {
                    console.warn('Iframes still without lazy loading:', iframesWithoutLazy.length);
                } else {
                    console.log('✅ All iframes have lazy loading!');
                }
                
                console.log('=== REPORT COMPLETE ===');
            }, 3000);
        });
    }
    
    init();
})();
