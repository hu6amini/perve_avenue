// ==============================
// Complete Working Avatar System - COORDINATED WITH MEDIA SCRIPTS
// OPTIMIZED FOR FAST LIKES POPUP LOADING
// ==============================

(function() {
    'use strict';

    // ==============================
    // CONFIGURATION
    // ==============================
    var AVATAR_THEME = {
        colors: {
            light: [
                '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2',
                '#EF476F', '#FFD166', '#06D6A0', '#073B4C', '#7209B7'
            ],
            dark: [
                '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2',
                '#EF476F', '#FFD166', '#06D6A0', '#073B4C', '#7209B7'
            ]
        },
        currentTheme: 'light'
    };

    var AVATAR_CONFIG = {
        sizes: {
            'post': 60,
            'profile_card': 80,
            'deleted_user': 60,
            'likes_list': 30,
            'fast_reply': 40
        },
        
        selectors: {
            '.summary li[class^="box_"]': {
                type: 'post',
                size: 'post',
                extractor: 'class'
            },
            
            'a.avatar[href*="MID="] .default-avatar': {
                type: 'default_avatar',
                size: 'profile_card',
                extractor: 'href'
            },
            
            '.post.box_visitatore': {
                type: 'deleted_user',
                size: 'deleted_user',
                extractor: 'visitatore'
            },
            
            '.popup.pop_points .users li a[href*="MID="]': {
                type: 'likes_list',
                size: 'likes_list',
                extractor: 'likes_href'
            }
        },
        
        dicebear: {
            style: 'initials',
            version: '7.x',
            format: 'svg'
        },
        
        cache: {
            duration: 86400000, // 24 hours
            prefix: 'avatar_',
            brokenPrefix: 'broken_avatar_',
            deletedPrefix: 'deleted_avatar_'
        },
        
        // Performance settings
        performance: {
            batchSize: 5,
            batchDelay: 50,
            prioritySelectors: [
                '.popup.pop_points',
                '.summary'
            ],
            maxConcurrentRequests: 3
        },
        
        // Script coordination settings
        coordination: {
            maxWaitTime: 5000,
            checkInterval: 100
        },
        
        // Prefetch configuration
        prefetch: {
            enabled: true,
            batchSize: 50,
            delayBetweenBatches: 100,
            maxUsersToPrefetch: 500
        }
    };

    // ==============================
    // FAST REPLY USER INFO CONFIG
    // ==============================
    var FAST_REPLY_CONFIG = {
        selectors: {
            fastReply: '.send .skin_tbl',
            menuWrap: '.menuwrap',
            nick: '.nick',
            avatar: '.avatar',
            userLink: 'a[href*="MID="]'
        },
        size: 40,
        debug: false
    };

    // ==============================
    // STATE MANAGEMENT
    // ==============================
    var state = {
        pendingRequests: {},
        userCache: {},
        brokenAvatars: new Set(),
        processedPosts: new WeakSet(),
        processedAvatars: new WeakSet(),
        processedDeletedUsers: new WeakSet(),
        processedLikesList: new WeakSet(),
        processedFastReply: new WeakSet(),
        isInitialized: false,
        cacheVersion: '2.3',
        
        // Performance tracking
        processingQueue: [],
        isProcessing: false,
        activeRequests: 0,
        processedIds: new Set(),
        pendingBatches: [],
        
        // Script readiness tracking
        scriptsReady: {
            weserv: false,
            dimensionExtractor: false
        },
        waitingForScripts: true,
        pendingElements: [],
        
        // Fast reply state
        fastReply: {
            currentUser: null,
            initialized: false
        }
    };

    // Prefetch state
    var prefetchState = {
        isPrefetching: false,
        prefetchedUsers: new Map(),
        pendingPrefetchIds: []
    };

    // ==============================
    // SCRIPT COORDINATION
    // ==============================

    function checkScriptsReady() {
        var weservProcessed = document.querySelector('img[data-optimized="true"]') !== null;
        var extractorExists = !!window.mediaDimensionExtractor;
        
        state.scriptsReady.weserv = state.scriptsReady.weserv || weservProcessed;
        state.scriptsReady.dimensionExtractor = state.scriptsReady.dimensionExtractor || extractorExists;
        
        return state.scriptsReady.weserv && state.scriptsReady.dimensionExtractor;
    }

    function waitForScripts(callback) {
        if (checkScriptsReady()) {
            console.log('✅ Avatar system: Media scripts ready, proceeding');
            state.waitingForScripts = false;
            callback();
            return;
        }

        console.log('⏳ Avatar system waiting for media scripts...');

        var onWeservReady = function() {
            state.scriptsReady.weserv = true;
            if (checkScriptsReady()) {
                cleanup();
                callback();
            }
        };

        var onExtractorReady = function() {
            state.scriptsReady.dimensionExtractor = true;
            if (checkScriptsReady()) {
                cleanup();
                callback();
            }
        };

        var cleanup = function() {
            window.removeEventListener('weserv-ready', onWeservReady);
            window.removeEventListener('dimension-extractor-ready', onExtractorReady);
            if (waitInterval) clearInterval(waitInterval);
            if (timeout) clearTimeout(timeout);
        };

        window.addEventListener('weserv-ready', onWeservReady, { passive: true });
        window.addEventListener('dimension-extractor-ready', onExtractorReady, { passive: true });

        var waitInterval = setInterval(function() {
            if (checkScriptsReady()) {
                cleanup();
                callback();
            }
        }, AVATAR_CONFIG.coordination.checkInterval);

        var timeout = setTimeout(function() {
            console.warn('⚠️ Avatar system timeout waiting for scripts, proceeding anyway');
            cleanup();
            callback();
        }, AVATAR_CONFIG.coordination.maxWaitTime);
    }

    // ==============================
    // PREFETCH FUNCTIONS
    // ==============================

    function prefetchUserAvatars() {
        if (!AVATAR_CONFIG.prefetch.enabled || prefetchState.isPrefetching) return;
        
        // Collect all user IDs from the page
        var userIds = new Set();
        
        // Get users from posts
        var posts = document.querySelectorAll('.summary li[class^="box_"]');
        for (var i = 0; i < posts.length; i++) {
            var classMatch = posts[i].className.match(/\bbox_m(\d+)\b/);
            if (classMatch) userIds.add(classMatch[1]);
        }
        
        // Get users from profile cards
        var avatars = document.querySelectorAll('a.avatar[href*="MID="]');
        for (var j = 0; j < avatars.length; j++) {
            var hrefMatch = avatars[j].href.match(/MID=(\d+)/);
            if (hrefMatch) userIds.add(hrefMatch[1]);
        }
        
        // Get users from menu wrap (current user)
        var menuWrap = document.querySelector('.menuwrap a[href*="MID="]');
        if (menuWrap) {
            var menuMatch = menuWrap.href.match(/MID=(\d+)/);
            if (menuMatch) userIds.add(menuMatch[1]);
        }
        
        var uniqueUserIds = Array.from(userIds).slice(0, AVATAR_CONFIG.prefetch.maxUsersToPrefetch);
        
        if (uniqueUserIds.length === 0) return;
        
        console.log(`🔄 Prefetching avatars for ${uniqueUserIds.length} users...`);
        prefetchState.isPrefetching = true;
        
        function fetchBatch(startIndex) {
            var batch = uniqueUserIds.slice(startIndex, startIndex + AVATAR_CONFIG.prefetch.batchSize);
            
            if (batch.length === 0) {
                prefetchState.isPrefetching = false;
                console.log(`✅ Avatar prefetch complete. Cached ${prefetchState.prefetchedUsers.size} users.`);
                // Preload images after prefetch completes
                setTimeout(preloadLikesAvatars, 500);
                return;
            }
            
            var url = '/api.php?mid=' + batch.join(',');
            
            fetch(url)
                .then(function(response) {
                    if (!response.ok) throw new Error('Prefetch API failed');
                    return response.json();
                })
                .then(function(data) {
                    // Cache the fetched data
                    for (var userId in data) {
                        if (data.hasOwnProperty(userId)) {
                            var numericId = userId.replace('m', '');
                            prefetchState.prefetchedUsers.set(numericId, data[userId]);
                            
                            // Also pre-cache avatars for common sizes
                            var sizes = [30, 40, 60, 80];
                            sizes.forEach(function(size) {
                                if (data[userId].avatar && data[userId].avatar.trim() !== '' && data[userId].avatar !== 'http') {
                                    var cacheKey = numericId + '_' + size;
                                    var cacheData = {
                                        url: data[userId].avatar,
                                        username: cleanUsername(data[userId].nickname),
                                        timestamp: Date.now(),
                                        size: size,
                                        cacheVersion: state.cacheVersion,
                                        source: 'forum'
                                    };
                                    
                                    try {
                                        localStorage.setItem(getCacheKey(numericId, size), JSON.stringify(cacheData));
                                        state.userCache[cacheKey] = cacheData;
                                    } catch (e) {}
                                }
                            });
                        }
                    }
                    
                    setTimeout(function() {
                        fetchBatch(startIndex + AVATAR_CONFIG.prefetch.batchSize);
                    }, AVATAR_CONFIG.prefetch.delayBetweenBatches);
                })
                .catch(function(error) {
                    console.warn('⚠️ Avatar prefetch error:', error);
                    setTimeout(function() {
                        fetchBatch(startIndex + AVATAR_CONFIG.prefetch.batchSize);
                    }, AVATAR_CONFIG.prefetch.delayBetweenBatches);
                });
        }
        
        fetchBatch(0);
    }

    function preloadLikesAvatars() {
        // Preload images for users in the prefetch cache
        var preloadedCount = 0;
        var entries = Array.from(prefetchState.prefetchedUsers.entries());
        
        entries.forEach(function(entry) {
            var userData = entry[1];
            var avatarUrl = userData.avatar;
            
            if (avatarUrl && avatarUrl.trim() !== '' && avatarUrl !== 'http' && !avatarUrl.includes('dicebear.com')) {
                var img = new Image();
                img.src = avatarUrl;
                preloadedCount++;
            }
        });
        
        if (preloadedCount > 0) {
            console.log(`🖼️ Preloaded ${preloadedCount} custom avatars for faster display`);
        }
    }

    function setupLikesPopupObserver() {
        var observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    var popup = mutation.target;
                    if (popup.style.display === 'block') {
                        // Popup opened, prefetch any missing users in this popup
                        var links = popup.querySelectorAll('.users li a[href*="MID="]');
                        var missingUserIds = [];
                        
                        links.forEach(function(link) {
                            var match = link.href.match(/MID=(\d+)/);
                            if (match && match[1] && !prefetchState.prefetchedUsers.has(match[1])) {
                                missingUserIds.push(match[1]);
                            }
                        });
                        
                        if (missingUserIds.length > 0) {
                            // Fetch missing users immediately
                            var url = '/api.php?mid=' + missingUserIds.join(',');
                            fetch(url).then(r => r.json()).then(data => {
                                for (var id in data) {
                                    var numId = id.replace('m', '');
                                    prefetchState.prefetchedUsers.set(numId, data[id]);
                                }
                            });
                        }
                    }
                }
            });
        });
        
        var likesPopup = document.querySelector('.popup.pop_points');
        if (likesPopup) {
            observer.observe(likesPopup, { attributes: true });
        }
    }

    function backgroundValidateAvatar(userId, avatarUrl, username, size) {
        if (!avatarUrl || avatarUrl.includes('dicebear.com')) return;
        
        testImageUrl(avatarUrl, function(success) {
            if (!success) {
                markAvatarAsBroken(avatarUrl);
                
                // Update all instances of this avatar in the current page
                var avatars = document.querySelectorAll(`img.forum-likes-avatar[data-username="${username}"]`);
                avatars.forEach(function(img) {
                    if (img.src === avatarUrl) {
                        img.src = generateLetterAvatar(userId, username, size);
                    }
                });
            }
        });
    }

    // ==============================
    // CORE FUNCTIONS
    // ==============================

    function getCacheKey(userId, size) {
        return AVATAR_CONFIG.cache.prefix + userId + '_' + size;
    }

    function getDeletedUserCacheKey(username, size) {
        var hash = 0;
        for (var i = 0; i < username.length; i++) {
            hash = ((hash << 5) - hash) + username.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_CONFIG.cache.deletedPrefix + Math.abs(hash) + '_' + size;
    }

    function clearOldCacheEntries() {
        var cutoff = Date.now() - AVATAR_CONFIG.cache.duration;
        var keysToRemove = [];
        
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && (key.startsWith(AVATAR_CONFIG.cache.prefix) || 
                        key.startsWith(AVATAR_CONFIG.cache.deletedPrefix))) {
                try {
                    var data = JSON.parse(localStorage.getItem(key));
                    if (data && data.timestamp < cutoff) {
                        keysToRemove.push(key);
                    }
                } catch (e) {
                    keysToRemove.push(key);
                }
            }
        }
        
        for (var j = 0; j < keysToRemove.length; j++) {
            localStorage.removeItem(keysToRemove[j]);
        }
        
        return keysToRemove.length;
    }

    function isBrokenAvatarUrl(avatarUrl) {
        if (!avatarUrl || avatarUrl === 'http') {
            return true;
        }
        
        if (avatarUrl.includes('dicebear.com')) {
            return false;
        }
        
        if (state.brokenAvatars.has(avatarUrl)) {
            return true;
        }
        
        var brokenKey = AVATAR_CONFIG.cache.brokenPrefix + btoa(avatarUrl).slice(0, 50);
        var brokenCache = localStorage.getItem(brokenKey);
        if (brokenCache) {
            try {
                var data = JSON.parse(brokenCache);
                if (Date.now() - data.timestamp < 3600000) {
                    state.brokenAvatars.add(avatarUrl);
                    return true;
                } else {
                    localStorage.removeItem(brokenKey);
                }
            } catch (e) {}
        }
        
        return false;
    }

    function markAvatarAsBroken(avatarUrl) {
        if (!avatarUrl || avatarUrl.includes('dicebear.com')) return;
        
        state.brokenAvatars.add(avatarUrl);
        var brokenKey = AVATAR_CONFIG.cache.brokenPrefix + btoa(avatarUrl).slice(0, 50);
        localStorage.setItem(brokenKey, JSON.stringify({
            url: avatarUrl,
            timestamp: Date.now()
        }));
    }

    function testImageUrl(url, callback) {
        if (!url || url === 'http') {
            callback(false);
            return;
        }
        
        if (url.includes('dicebear.com')) {
            callback(true);
            return;
        }
        
        var img = new Image();
        var timeoutId = setTimeout(function() {
            img.onload = img.onerror = null;
            callback(true);
        }, 3000);
        
        img.onload = function() {
            clearTimeout(timeoutId);
            callback(true);
        };
        
        img.onerror = function() {
            clearTimeout(timeoutId);
            callback(false);
        };
        
        var separator = url.includes('?') ? '&' : '?';
        img.src = url + separator + 't=' + Date.now();
    }

    // ==============================
    // BATCH API REQUEST FUNCTION
    // ==============================

    function fetchMultipleUsers(userIds, callback) {
        if (!userIds || userIds.length === 0) {
            callback({});
            return;
        }
        
        var uniqueIds = [...new Set(userIds)];
        
        var url = '/api.php?mid=' + uniqueIds.join(',');
        
        fetch(url)
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Batch API failed');
                }
                return response.json();
            })
            .then(function(data) {
                callback(data);
            })
            .catch(function(error) {
                fetchMultipleUsersIndividual(uniqueIds, callback);
            });
    }

    function fetchMultipleUsersIndividual(userIds, callback) {
        var results = {};
        var remaining = userIds.length;
        var maxConcurrent = AVATAR_CONFIG.performance.maxConcurrentRequests;
        var currentIndex = 0;
        
        function processNext() {
            if (currentIndex >= userIds.length) return;
            
            var batchEnd = Math.min(currentIndex + maxConcurrent, userIds.length);
            var batchIds = userIds.slice(currentIndex, batchEnd);
            currentIndex = batchEnd;
            
            batchIds.forEach(function(userId) {
                fetch('/api.php?mid=' + userId)
                    .then(function(response) {
                        if (!response.ok) throw new Error('API failed');
                        return response.json();
                    })
                    .then(function(data) {
                        Object.assign(results, data);
                        remaining--;
                        
                        if (remaining === 0) {
                            callback(results);
                        } else {
                            processNext();
                        }
                    })
                    .catch(function(error) {
                        remaining--;
                        
                        if (remaining === 0) {
                            callback(results);
                        } else {
                            processNext();
                        }
                    });
            });
        }
        
        processNext();
    }

    // ==============================
    // USERNAME EXTRACTION
    // ==============================

    function cleanUsername(username) {
        if (!username) return 'User';
        username = username.trim();
        username = username.replace(/\.{3,}/g, '');
        username = username.replace(/[\n\t]/g, ' ');
        username = username.replace(/\s+/g, ' ');
        
        if (username.length < 2 || /^[^a-zA-Z0-9]+$/.test(username)) {
            return 'User';
        }
        
        return username;
    }

    function extractUsernameFromElement(element, type, userId) {
        var username = '';
        
        if (type === 'post') {
            var nickname = element.querySelector('.nick a');
            if (nickname && nickname.textContent) {
                username = nickname.textContent;
            }
            
            if (!username) {
                var userClass = element.querySelector('.user' + userId);
                if (userClass && userClass.textContent) {
                    username = userClass.textContent;
                }
            }
            
            if (!username) {
                var midLinks = element.querySelectorAll('a[href*="MID=' + userId + '"]');
                for (var i = 0; i < midLinks.length; i++) {
                    if (midLinks[i].textContent) {
                        username = midLinks[i].textContent;
                        break;
                    }
                }
            }
        } else if (type === 'default_avatar') {
            var parentLink = element.closest('a[href*="MID="]');
            if (parentLink) {
                if (parentLink.title) {
                    username = parentLink.title;
                }
                
                if (!username && parentLink.textContent) {
                    username = parentLink.textContent;
                }
            }
        } else if (type === 'deleted_user') {
            var nickname = element.querySelector('.nick');
            if (nickname && nickname.textContent) {
                username = nickname.textContent;
            }
        } else if (type === 'likes_list') {
            if (element.textContent) {
                username = element.textContent;
            } else if (element.title) {
                username = element.title;
            }
            
            if (!username && element.className) {
                var classMatch = element.className.match(/user\d+/);
                if (classMatch) {
                    var userSpan = document.querySelector('.' + classMatch[0]);
                    if (userSpan && userSpan.textContent) {
                        username = userSpan.textContent;
                    }
                }
            }
        }
        
        return cleanUsername(username);
    }

    // ==============================
    // AVATAR GENERATION
    // ==============================

    function generateLetterAvatar(userId, username, size) {
        var displayName = username || 'User';
        var firstLetter = displayName.charAt(0).toUpperCase();
        
        if (!firstLetter.match(/[A-Z0-9]/i)) {
            firstLetter = '?';
        }
        
        var colors = AVATAR_THEME.colors.light;
        var colorIndex = 0;
        
        if (firstLetter >= 'A' && firstLetter <= 'Z') {
            colorIndex = (firstLetter.charCodeAt(0) - 65) % colors.length;
        } else if (firstLetter >= '0' && firstLetter <= '9') {
            colorIndex = (parseInt(firstLetter) + 26) % colors.length;
        } else {
            var hash = 0;
            for (var i = 0; i < username.length; i++) {
                hash = ((hash << 5) - hash) + username.charCodeAt(i);
                hash = hash & hash;
            }
            colorIndex = Math.abs(hash) % colors.length;
        }
        
        var backgroundColor = colors[colorIndex];
        if (backgroundColor.startsWith('#')) {
            backgroundColor = backgroundColor.substring(1);
        }
        
        var params = [
            'seed=' + encodeURIComponent(firstLetter),
            'backgroundColor=' + backgroundColor,
            'radius=50',
            'size=' + size
        ];
        
        return 'https://api.dicebear.com/7.x/initials/svg?' + params.join('&');
    }

    // ==============================
    // OPTIMIZED AVATAR FETCHING
    // ==============================

    function getAvatarFromCache(userId, size, isLikesList) {
        var cacheKey = userId + '_' + size;
        
        // Check prefetch cache first (fastest)
        if (prefetchState.prefetchedUsers.has(userId)) {
            var userData = prefetchState.prefetchedUsers.get(userId);
            if (userData.avatar && userData.avatar.trim() !== '' && userData.avatar !== 'http') {
                // For likes list, return immediately with error handling to be done on insertion
                if (isLikesList) {
                    return {
                        url: userData.avatar,
                        username: cleanUsername(userData.nickname),
                        timestamp: Date.now(),
                        size: size,
                        cacheVersion: state.cacheVersion,
                        source: 'prefetch'
                    };
                }
                // For non-likes, validate
                if (!isBrokenAvatarUrl(userData.avatar)) {
                    return {
                        url: userData.avatar,
                        username: cleanUsername(userData.nickname),
                        timestamp: Date.now(),
                        size: size,
                        cacheVersion: state.cacheVersion,
                        source: 'prefetch'
                    };
                }
            }
        }
        
        if (state.userCache[cacheKey]) {
            var cached = state.userCache[cacheKey];
            var isGenerated = cached.url && cached.url.includes('dicebear.com');
            var isBroken = isBrokenAvatarUrl(cached.url);
            
            if (isLikesList && isGenerated) {
                return null;
            }
            
            if (!isBroken) {
                return cached;
            }
            
            if (!isGenerated && isBroken) {
                return null;
            }
        }
        
        var stored = localStorage.getItem(getCacheKey(userId, size));
        if (stored) {
            try {
                var data = JSON.parse(stored);
                var isExpired = Date.now() - data.timestamp > AVATAR_CONFIG.cache.duration;
                var isOldVersion = !data.cacheVersion || data.cacheVersion !== state.cacheVersion;
                var isGenerated = data.url && data.url.includes('dicebear.com');
                var isBroken = isBrokenAvatarUrl(data.url);
                
                if (!isExpired && !isOldVersion) {
                    if (!isGenerated && isBroken) {
                        return null;
                    }
                    if (!isBroken) {
                        state.userCache[cacheKey] = data;
                        return data;
                    }
                }
            } catch (e) {}
        }
        
        return null;
    }

    function processLikesListImmediately(linkElement, userId, size, username) {
        if (userId && prefetchState.prefetchedUsers.has(userId)) {
            var userData = prefetchState.prefetchedUsers.get(userId);
            var avatarUrl = userData.avatar;
            var finalUsername = cleanUsername(userData.nickname);
            
            if (avatarUrl && avatarUrl.trim() !== '' && avatarUrl !== 'http') {
                // Insert with error handling but no pre-testing
                insertLikesListAvatarFast(linkElement, userId, size, avatarUrl, finalUsername);
                return true;
            }
        }
        return false;
    }

    function processAvatarQueue() {
        if (state.isProcessing || state.processingQueue.length === 0) return;
        
        state.isProcessing = true;
        
        var popupItems = [];
        var summaryItems = [];
        var otherItems = [];
        
        state.processingQueue.forEach(function(item) {
            var element = item.element;
            if (element.closest('.popup.pop_points')) {
                popupItems.push(item);
            } else if (element.closest('.summary')) {
                summaryItems.push(item);
            } else {
                otherItems.push(item);
            }
        });
        
        var prioritizedQueue = [...popupItems, ...summaryItems, ...otherItems];
        state.processingQueue = [];
        
        function processBatch(startIndex) {
            var batch = prioritizedQueue.slice(startIndex, startIndex + AVATAR_CONFIG.performance.batchSize);
            
            if (batch.length === 0) {
                state.isProcessing = false;
                return;
            }
            
            var userMap = new Map();
            batch.forEach(function(item) {
                if (item.userId && !item.isDeletedUser) {
                    if (!userMap.has(item.userId)) {
                        userMap.set(item.userId, {
                            userId: item.userId,
                            username: item.username,
                            elements: [],
                            isLikesList: item.config.type === 'likes_list',
                            size: item.config.size
                        });
                    }
                    var userData = userMap.get(item.userId);
                    userData.elements.push({
                        element: item.element,
                        config: item.config
                    });
                } else {
                    var avatarUrl = generateLetterAvatar(null, item.username, item.config.size);
                    insertAvatarForProcessedItem(item, avatarUrl, item.username);
                }
            });
            
            var realUsers = Array.from(userMap.values());
            if (realUsers.length > 0) {
                var userIds = realUsers.map(u => u.userId);
                
                fetchMultipleUsers(userIds, function(apiData) {
                    realUsers.forEach(function(userData) {
                        var userKey = 'm' + userData.userId;
                        var userApiData = apiData[userKey];
                        var finalUsername = userData.username;
                        var avatarUrl;
                        
                        if (userApiData && userApiData.nickname) {
                            finalUsername = cleanUsername(userApiData.nickname);
                        }
                        
                        if (userApiData && userApiData.avatar && 
                            userApiData.avatar.trim() !== '' && 
                            userApiData.avatar !== 'http') {
                            
                            avatarUrl = userApiData.avatar;
                            
                            testImageUrl(avatarUrl, function(success) {
                                if (success) {
                                    finishUserAvatars(userData, avatarUrl, finalUsername);
                                } else {
                                    markAvatarAsBroken(avatarUrl);
                                    avatarUrl = generateLetterAvatar(userData.userId, finalUsername, userData.size);
                                    finishUserAvatars(userData, avatarUrl, finalUsername);
                                }
                            });
                        } else {
                            avatarUrl = generateLetterAvatar(userData.userId, finalUsername, userData.size);
                            finishUserAvatars(userData, avatarUrl, finalUsername);
                        }
                        
                        function finishUserAvatars(userData, url, name) {
                            var cacheKey = userData.userId + '_' + userData.size;
                            var cacheData = {
                                url: url,
                                username: name,
                                timestamp: Date.now(),
                                size: userData.size,
                                cacheVersion: state.cacheVersion,
                                source: url.includes('dicebear.com') ? 'generated' : 'forum'
                            };
                            
                            try {
                                localStorage.setItem(getCacheKey(userData.userId, userData.size), JSON.stringify(cacheData));
                            } catch (e) {
                                clearOldCacheEntries();
                                localStorage.setItem(getCacheKey(userData.userId, userData.size), JSON.stringify(cacheData));
                            }
                            
                            state.userCache[cacheKey] = cacheData;
                            
                            userData.elements.forEach(function(elementInfo) {
                                insertAvatarForProcessedItem({
                                    element: elementInfo.element,
                                    config: elementInfo.config,
                                    userId: userData.userId,
                                    username: name
                                }, url, name);
                            });
                        }
                    });
                    
                    setTimeout(function() {
                        processBatch(startIndex + AVATAR_CONFIG.performance.batchSize);
                    }, AVATAR_CONFIG.performance.batchDelay);
                });
            } else {
                setTimeout(function() {
                    processBatch(startIndex + AVATAR_CONFIG.performance.batchSize);
                }, AVATAR_CONFIG.performance.batchDelay);
            }
        }
        
        processBatch(0);
    }

    function insertAvatarForProcessedItem(item, avatarUrl, username) {
        var element = item.element;
        var config = item.config;
        var userId = item.userId;
        
        if (config.type === 'post') {
            insertPostAvatar(element, userId, config.size, avatarUrl, username);
            state.processedPosts.add(element);
        } else if (config.type === 'default_avatar') {
            insertDefaultAvatar(element, userId, config.size, avatarUrl, username);
            state.processedAvatars.add(element);
        } else if (config.type === 'deleted_user') {
            insertDeletedUserAvatar(element, null, config.size, avatarUrl, username);
            state.processedDeletedUsers.add(element);
        } else if (config.type === 'likes_list') {
            insertLikesListAvatar(element, userId, config.size, avatarUrl, username);
            state.processedLikesList.add(element);
        }
    }

    // ==============================
    // ENHANCED AVATAR CREATION
    // ==============================

    function createAvatarElement(avatarUrl, userId, size, username, isDeletedUser, isLikesList) {
        var img = new Image();
        
        if (isLikesList) {
            img.className = 'forum-likes-avatar avatar-size-' + size;
        } else {
            img.className = 'forum-user-avatar avatar-size-' + size;
        }
        
        if (isDeletedUser) {
            img.className += ' deleted-user-avatar';
        }
        
        img.alt = username ? 'Avatar for ' + username : '';
        img.loading = 'lazy';
        img.decoding = 'async';
        
        img.width = size;
        img.height = size;
        
        img.dataset.needsDimensions = 'true';
        
        img.style.cssText = 
            'width:' + size + 'px;' +
            'height:' + size + 'px;' +
            'border-radius:50%;' +
            'object-fit:cover;' +
            'vertical-align:middle;' +
            'display:inline-block;';
        
        if (isLikesList) {
            img.style.cssText += 
                'margin-right:8px;' +
                'margin-left:4px;' +
                'border:1px solid #ddd;' +
                'box-shadow:0 1px 2px rgba(0,0,0,0.1);';
        }
        
        img.src = avatarUrl;
        
        if (username) {
            img.dataset.username = username;
        }
        
        img.addEventListener('error', function onError() {
            if (!avatarUrl.includes('dicebear.com')) {
                markAvatarAsBroken(avatarUrl);
            }
            
            if (userId) {
                var cacheKey = userId + '_' + size;
                delete state.userCache[cacheKey];
                localStorage.removeItem(getCacheKey(userId, size));
                
                var fallbackUrl = generateLetterAvatar(userId, username || '', size);
                this.src = fallbackUrl;
            } else if (username) {
                var cacheKey = 'deleted_' + username + '_' + size;
                delete state.userCache[cacheKey];
                localStorage.removeItem(getDeletedUserCacheKey(username, size));
                
                var fallbackUrl = generateLetterAvatar(null, username || '', size);
                this.src = fallbackUrl;
            }
            this.removeEventListener('error', onError);
        }, { once: true });
        
        return img;
    }

    // ==============================
    // FAST LIKES LIST AVATAR INSERTION
    // ==============================

    function insertLikesListAvatarFast(linkElement, userId, size, avatarUrl, username) {
        var span = linkElement.closest('span');
        if (!span) return;
        
        if (span.querySelector('img.forum-likes-avatar')) {
            return;
        }
        
        var img = new Image();
        img.className = 'forum-likes-avatar avatar-size-' + size;
        img.alt = username ? 'Avatar for ' + username : '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = size;
        img.height = size;
        img.dataset.needsDimensions = 'true';
        
        img.style.cssText = 
            'width:' + size + 'px;' +
            'height:' + size + 'px;' +
            'border-radius:50%;' +
            'object-fit:cover;' +
            'vertical-align:middle;' +
            'display:inline-block;' +
            'margin-right:8px;' +
            'margin-left:4px;' +
            'border:1px solid #ddd;' +
            'box-shadow:0 1px 2px rgba(0,0,0,0.1);';
        
        img.src = avatarUrl;
        
        if (username) {
            img.dataset.username = username;
        }
        
        // Keep error handling for 404 fallback
        img.addEventListener('error', function onError() {
            if (!this.src.includes('dicebear.com')) {
                markAvatarAsBroken(avatarUrl);
                
                // Remove the broken image from prefetch cache
                if (userId && prefetchState.prefetchedUsers.has(userId)) {
                    var userData = prefetchState.prefetchedUsers.get(userId);
                    userData.avatar = null;
                    prefetchState.prefetchedUsers.set(userId, userData);
                }
                
                // Clear from localStorage cache
                var cacheKey = getCacheKey(userId, size);
                localStorage.removeItem(cacheKey);
                delete state.userCache[cacheKey];
                
                // Replace with generated avatar
                var fallbackUrl = generateLetterAvatar(userId, username || '', size);
                this.src = fallbackUrl;
            }
            this.removeEventListener('error', onError);
        }, { once: true });
        
        span.insertBefore(img, linkElement);
        span.classList.add('has-forum-avatar');
        
        // Background validation without blocking display
        if (!avatarUrl.includes('dicebear.com')) {
            setTimeout(function() {
                backgroundValidateAvatar(userId, avatarUrl, username, size);
            }, 100);
        }
        
        if (window.mediaDimensionExtractor) {
            setTimeout(function() {
                window.mediaDimensionExtractor.forceReprocessElement(img);
            }, 10);
        }
    }

    // ==============================
    // AVATAR INSERTION FUNCTIONS
    // ==============================

    function insertPostAvatar(postElement, userId, size, avatarUrl, username) {
        var nickname = postElement.querySelector('.nick a, .nick');
        if (!nickname) return;
        
        if (nickname.previousElementSibling && 
            nickname.previousElementSibling.classList && 
            nickname.previousElementSibling.classList.contains('forum-avatar-container')) {
            return;
        }
        
        var container = document.createElement('div');
        container.className = 'forum-avatar-container';
        container.style.cssText = 
            'display:inline-block;' +
            'vertical-align:middle;' +
            'position:relative;' +
            'margin-right:8px;';
        
        var avatarImg = createAvatarElement(avatarUrl, userId, size, username, false, false);
        container.appendChild(avatarImg);
        nickname.parentNode.insertBefore(container, nickname);
        
        if (window.mediaDimensionExtractor) {
            setTimeout(function() {
                window.mediaDimensionExtractor.forceReprocessElement(avatarImg);
            }, 10);
        }
    }

    function insertDefaultAvatar(defaultAvatarElement, userId, size, avatarUrl, username) {
        var parentLink = defaultAvatarElement.closest('a.avatar[href*="MID="]');
        if (!parentLink) return;
        
        if (parentLink.querySelector('img.forum-user-avatar')) {
            return;
        }
        
        var avatarImg = createAvatarElement(avatarUrl, userId, size, username, false, false);
        
        var defaultAvatarDiv = parentLink.querySelector('.default-avatar');
        if (defaultAvatarDiv) {
            defaultAvatarDiv.parentNode.replaceChild(avatarImg, defaultAvatarDiv);
        } else {
            parentLink.appendChild(avatarImg);
        }
        
        parentLink.classList.add('avatar-replaced');
        
        if (window.mediaDimensionExtractor) {
            setTimeout(function() {
                window.mediaDimensionExtractor.forceReprocessElement(avatarImg);
            }, 10);
        }
    }

    function insertDeletedUserAvatar(postElement, userId, size, avatarUrl, username) {
        var nickname = postElement.querySelector('.nick');
        if (!nickname) return;
        
        if (nickname.previousElementSibling && 
            nickname.previousElementSibling.classList && 
            nickname.previousElementSibling.classList.contains('forum-avatar-container')) {
            return;
        }
        
        var container = document.createElement('div');
        container.className = 'forum-avatar-container deleted-user-container';
        container.style.cssText = 
            'display:inline-block;' +
            'vertical-align:middle;' +
            'position:relative;' +
            'margin-right:8px;';
        
        var avatarImg = createAvatarElement(avatarUrl, null, size, username, true, false);
        container.appendChild(avatarImg);
        nickname.parentNode.insertBefore(container, nickname);
        
        if (window.mediaDimensionExtractor) {
            setTimeout(function() {
                window.mediaDimensionExtractor.forceReprocessElement(avatarImg);
            }, 10);
        }
    }

    function insertLikesListAvatar(linkElement, userId, size, avatarUrl, username) {
        var span = linkElement.closest('span');
        if (!span) return;
        
        if (span.querySelector('img.forum-likes-avatar')) {
            return;
        }
        
        var avatarImg = createAvatarElement(avatarUrl, userId, size, username, false, true);
        
        span.insertBefore(avatarImg, linkElement);
        span.classList.add('has-forum-avatar');
        
        if (window.mediaDimensionExtractor) {
            setTimeout(function() {
                window.mediaDimensionExtractor.forceReprocessElement(avatarImg);
            }, 10);
        }
    }

    // ==============================
    // FAST REPLY USER INFO FUNCTIONS
    // ==============================

    function extractCurrentUser() {
        if (state.fastReply.currentUser) return state.fastReply.currentUser;
        
        var menuwrap = document.querySelector(FAST_REPLY_CONFIG.selectors.menuWrap);
        if (!menuwrap) return null;
        
        var nickElement = menuwrap.querySelector(FAST_REPLY_CONFIG.selectors.nick);
        if (!nickElement) return null;
        
        var username = nickElement.textContent.trim();
        
        var userId = null;
        var userLink = menuwrap.querySelector(FAST_REPLY_CONFIG.selectors.userLink);
        if (userLink) {
            var match = userLink.href.match(/MID=(\d+)/);
            if (match) userId = match[1];
        }
        
        var avatarUrl = null;
        var avatarElement = menuwrap.querySelector(FAST_REPLY_CONFIG.selectors.avatar);
        if (avatarElement) {
            var img = avatarElement.querySelector('img');
            if (img && img.src) {
                avatarUrl = img.src;
            } else {
                var bgImage = window.getComputedStyle(avatarElement).backgroundImage;
                if (bgImage && bgImage !== 'none') {
                    avatarUrl = bgImage.slice(5, -2).replace(/["']/g, '');
                }
            }
        }
        
        state.fastReply.currentUser = {
            username: username,
            userId: userId,
            avatarUrl: avatarUrl
        };
        
        if (FAST_REPLY_CONFIG.debug) {
            console.log('[FastReply] Extracted user:', state.fastReply.currentUser);
        }
        
        return state.fastReply.currentUser;
    }

    function createFastReplyAvatarImg(avatarUrl, username, userId) {
        var img = new Image();
        img.src = avatarUrl || generateLetterAvatar(userId, username, FAST_REPLY_CONFIG.size);
        img.alt = 'Avatar for ' + username;
        img.width = FAST_REPLY_CONFIG.size;
        img.height = FAST_REPLY_CONFIG.size;
        img.loading = 'lazy';
        img.decoding = 'async';
        
        img.className = 'fast-reply-avatar';
        img.dataset.userId = userId || '';
        img.dataset.username = username;
        img.dataset.needsDimensions = 'true';
        
        img.style.cssText = 
            'width: ' + FAST_REPLY_CONFIG.size + 'px;' +
            'height: ' + FAST_REPLY_CONFIG.size + 'px;' +
            'border-radius: 50%;' +
            'object-fit: cover;' +
            'border: 2px solid #fff;' +
            'box-shadow: 0 2px 4px rgba(0,0,0,0.1);' +
            'vertical-align: middle;' +
            'display: inline-block;';
        
        img.addEventListener('error', function onError() {
            if (!this.src.includes('dicebear.com')) {
                this.src = generateLetterAvatar(userId, username, FAST_REPLY_CONFIG.size);
            }
            this.removeEventListener('error', onError);
        }, { once: true });
        
        return img;
    }

    function createFastReplyUserInfo(user) {
        if (!user) return null;
        
        var container = document.createElement('div');
        container.className = 'fast-reply-user-info';
        container.style.cssText = 
            'padding: 10px 15px;' +
            'display: flex;' +
            'align-items: center;' +
            'gap: 12px;';
        
        var label = document.createElement('span');
        label.style.cssText = 
            'color: #6c757d;' +
            'font-size: 13px;' +
            'margin-right: 5px;';
        label.textContent = 'Replying as:';
        
        var avatarLink = document.createElement('a');
        avatarLink.href = user.userId ? '/?act=Profile&MID=' + user.userId : '#';
        avatarLink.className = 'avatar';
        avatarLink.rel = 'nofollow';
        avatarLink.style.display = 'flex';
        
        var avatarImg = createFastReplyAvatarImg(user.avatarUrl, user.username, user.userId);
        avatarLink.appendChild(avatarImg);
        
        var usernameLink = document.createElement('a');
        usernameLink.href = avatarLink.href;
        usernameLink.className = 'fast-reply-username';
        usernameLink.style.cssText = 
            'font-weight: 600;' +
            'color: #007bff;' +
            'text-decoration: none;' +
            'font-size: 15px;' +
            'margin-left: 5px;';
        usernameLink.textContent = user.username;
        
        usernameLink.addEventListener('mouseenter', function() {
            this.style.textDecoration = 'underline';
        });
        usernameLink.addEventListener('mouseleave', function() {
            this.style.textDecoration = 'none';
        });
        
        container.appendChild(label);
        container.appendChild(avatarLink);
        container.appendChild(usernameLink);
        
        return container;
    }

    function addFastReplyUserInfo(node) {
        if (state.processedFastReply.has(node)) return;
        
        var fastReply = node && node.matches && node.matches(FAST_REPLY_CONFIG.selectors.fastReply) 
            ? node 
            : node && node.querySelector && node.querySelector(FAST_REPLY_CONFIG.selectors.fastReply) 
            || document.querySelector(FAST_REPLY_CONFIG.selectors.fastReply);
        
        if (!fastReply) return;
        
        if (fastReply.querySelector('.fast-reply-user-info')) return;
        
        var user = extractCurrentUser();
        if (!user) {
            if (FAST_REPLY_CONFIG.debug) console.warn('[FastReply] Could not extract current user');
            return;
        }
        
        var userInfo = createFastReplyUserInfo(user);
        if (!userInfo) return;
        
        var skinTbl = fastReply.closest('.skin_tbl') || fastReply;
        skinTbl.insertBefore(userInfo, skinTbl.firstChild);
        
        state.processedFastReply.add(fastReply);
        
        if (FAST_REPLY_CONFIG.debug) console.log('[FastReply] Added user info for:', user.username);
        
        if (window.mediaDimensionExtractor) {
            var avatarImg = userInfo.querySelector('img');
            if (avatarImg) {
                setTimeout(function() {
                    window.mediaDimensionExtractor.forceReprocessElement(avatarImg);
                }, 100);
            }
        }
    }

    function refreshFastReplyUser() {
        state.fastReply.currentUser = null;
        var fastReply = document.querySelector(FAST_REPLY_CONFIG.selectors.fastReply);
        if (fastReply) {
            var existing = fastReply.querySelector('.fast-reply-user-info');
            if (existing) existing.remove();
            state.processedFastReply.delete(fastReply);
            addFastReplyUserInfo(fastReply);
        }
    }

    // ==============================
    // ELEMENT PROCESSING
    // ==============================

    function extractUserIdFromElement(element, extractorType) {
        var userId = null;
        
        if (extractorType === 'class') {
            var classMatch = element.className.match(/\bbox_m(\d+)\b/);
            if (classMatch) {
                userId = classMatch[1];
            } else {
                var parentBox = element.closest('[class*="box_m"]');
                if (parentBox) {
                    classMatch = parentBox.className.match(/\bbox_m(\d+)\b/);
                    if (classMatch) userId = classMatch[1];
                }
            }
        } else if (extractorType === 'href') {
            var linkElement = element.closest('a[href*="MID="]');
            if (linkElement) {
                var hrefMatch = linkElement.href.match(/MID=(\d+)/);
                if (hrefMatch) userId = hrefMatch[1];
            }
        } else if (extractorType === 'visitatore') {
            return null;
        } else if (extractorType === 'likes_href') {
            if (element.href) {
                var hrefMatch = element.href.match(/MID=(\d+)/) || 
                                element.href.match(/[?&]MID=(\d+)/) ||
                                element.href.match(/MID\%3D(\d+)/);
                
                if (hrefMatch) {
                    userId = hrefMatch[1];
                } else {
                    try {
                        var decodedUrl = decodeURIComponent(element.href);
                        hrefMatch = decodedUrl.match(/MID=(\d+)/);
                        if (hrefMatch) userId = hrefMatch[1];
                    } catch (e) {}
                }
            }
        }
        
        return userId;
    }

    function shouldProcessElement(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }
        
        var config = null;
        
        if (element.matches('.summary li[class^="box_"]')) {
            config = {
                type: 'post',
                size: AVATAR_CONFIG.sizes.post,
                extractor: 'class'
            };
        }
        else if (element.matches('a.avatar[href*="MID="] .default-avatar')) {
            var postParent = element.closest('.post');
            if (postParent) {
                config = {
                    type: 'default_avatar',
                    size: AVATAR_CONFIG.sizes.post,
                    extractor: 'href'
                };
            } else {
                config = {
                    type: 'default_avatar',
                    size: AVATAR_CONFIG.sizes.profile_card,
                    extractor: 'href'
                };
            }
        }
        else if (element.matches('.post.box_visitatore')) {
            config = {
                type: 'deleted_user',
                size: AVATAR_CONFIG.sizes.deleted_user,
                extractor: 'visitatore'
            };
        }
        else if (element.matches('.popup.pop_points .users li a[href*="MID="]')) {
            if (state.processedLikesList.has(element)) {
                return null;
            }
            
            config = {
                type: 'likes_list',
                size: AVATAR_CONFIG.sizes.likes_list,
                extractor: 'likes_href'
            };
        }
        
        if (!config) {
            return null;
        }
        
        if ((config.type === 'post' && state.processedPosts.has(element)) ||
            (config.type === 'default_avatar' && state.processedAvatars.has(element)) ||
            (config.type === 'deleted_user' && state.processedDeletedUsers.has(element)) ||
            (config.type === 'likes_list' && state.processedLikesList.has(element))) {
            return null;
        }
        
        var userId = extractUserIdFromElement(element, config.extractor);
        
        if (config.type === 'post' || config.type === 'deleted_user') {
            var nickname = element.querySelector('.nick');
            if (!nickname) {
                return null;
            }
            if (nickname.previousElementSibling && 
                nickname.previousElementSibling.classList && 
                nickname.previousElementSibling.classList.contains('forum-avatar-container')) {
                if (config.type === 'post') {
                    state.processedPosts.add(element);
                } else {
                    state.processedDeletedUsers.add(element);
                }
                return null;
            }
        } else if (config.type === 'default_avatar') {
            if (!element.querySelector('.fa-user, .fa-regular.fa-user, .fas.fa-user')) {
                return null;
            }
            var parentLink = element.closest('a.avatar[href*="MID="]');
            if (parentLink && parentLink.querySelector('img.forum-user-avatar')) {
                state.processedAvatars.add(element);
                return null;
            }
        } else if (config.type === 'likes_list') {
            var span = element.closest('span');
            if (span && span.querySelector('img.forum-likes-avatar')) {
                state.processedLikesList.add(element);
                return null;
            }
        }
        
        return {
            element: element,
            userId: userId,
            config: config
        };
    }

    function queueElementForProcessing(processingInfo) {
        if (!processingInfo) return;
        
        if (state.waitingForScripts) {
            state.pendingElements.push(processingInfo);
            return;
        }
        
        processElementNow(processingInfo);
    }

    function processElementNow(processingInfo) {
        var element = processingInfo.element;
        var userId = processingInfo.userId;
        var config = processingInfo.config;
        
        var username = extractUsernameFromElement(element, config.type, userId);
        
        if (userId && config.type !== 'deleted_user') {
            // For likes list, try immediate prefetch first
            if (config.type === 'likes_list') {
                if (processLikesListImmediately(element, userId, config.size, username)) {
                    state.processedLikesList.add(element);
                    return;
                }
            }
            
            var cached = getAvatarFromCache(userId, config.size, config.type === 'likes_list');
            if (cached) {
                insertAvatarForProcessedItem({
                    element: element,
                    config: config,
                    userId: userId,
                    username: cached.username
                }, cached.url, cached.username);
                return;
            }
        } else if (config.type === 'deleted_user') {
            var avatarUrl = generateLetterAvatar(null, username, config.size);
            insertAvatarForProcessedItem({
                element: element,
                config: config,
                userId: null,
                username: username
            }, avatarUrl, username);
            return;
        }
        
        state.processingQueue.push({
            element: element,
            userId: userId,
            username: username,
            config: config,
            isDeletedUser: config.type === 'deleted_user'
        });
        
        if (!state.isProcessing) {
            setTimeout(function() {
                processAvatarQueue();
            }, 10);
        }
    }

    function handleNewElement(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        
        var nodeInfo = shouldProcessElement(node);
        if (nodeInfo) {
            queueElementForProcessing(nodeInfo);
        }
        
        setTimeout(function() {
            var popups = node.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
            for (var k = 0; k < popups.length; k++) {
                var likesInfo = shouldProcessElement(popups[k]);
                if (likesInfo) {
                    queueElementForProcessing(likesInfo);
                }
            }
            
            var posts = node.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
            for (var i = 0; i < posts.length; i++) {
                var postInfo = shouldProcessElement(posts[i]);
                if (postInfo) {
                    queueElementForProcessing(postInfo);
                }
            }
            
            var defaultAvatars = node.querySelectorAll('a.avatar[href*="MID="] .default-avatar');
            for (var j = 0; j < defaultAvatars.length; j++) {
                var avatarInfo = shouldProcessElement(defaultAvatars[j]);
                if (avatarInfo) {
                    queueElementForProcessing(avatarInfo);
                }
            }
            
            if (node.matches && node.matches(FAST_REPLY_CONFIG.selectors.fastReply)) {
                addFastReplyUserInfo(node);
            } else if (node.querySelector) {
                var fastReply = node.querySelector(FAST_REPLY_CONFIG.selectors.fastReply);
                if (fastReply) {
                    addFastReplyUserInfo(fastReply);
                }
            }
        }, 0);
    }

    function processExistingElements() {
        if (state.waitingForScripts) {
            var allElements = [];
            
            var likesLinks = document.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
            for (var k = 0; k < likesLinks.length; k++) {
                var likesInfo = shouldProcessElement(likesLinks[k]);
                if (likesInfo) allElements.push(likesInfo);
            }
            
            var posts = document.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
            for (var i = 0; i < posts.length; i++) {
                var postInfo = shouldProcessElement(posts[i]);
                if (postInfo) allElements.push(postInfo);
            }
            
            var defaultAvatars = document.querySelectorAll('a.avatar[href*="MID="] .default-avatar');
            for (var j = 0; j < defaultAvatars.length; j++) {
                var avatarInfo = shouldProcessElement(defaultAvatars[j]);
                if (avatarInfo) allElements.push(avatarInfo);
            }
            
            state.pendingElements = allElements;
            console.log('📦 Avatar system queued ' + allElements.length + ' elements for after scripts ready');
            return;
        }
        
        var likesLinks = document.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
        for (var k = 0; k < likesLinks.length; k++) {
            var likesInfo = shouldProcessElement(likesLinks[k]);
            if (likesInfo) {
                queueElementForProcessing(likesInfo);
            }
        }
        
        var posts = document.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
        for (var i = 0; i < posts.length; i++) {
            var postInfo = shouldProcessElement(posts[i]);
            if (postInfo) {
                queueElementForProcessing(postInfo);
            }
        }
        
        var defaultAvatars = document.querySelectorAll('a.avatar[href*="MID="] .default-avatar');
        for (var j = 0; j < defaultAvatars.length; j++) {
            var avatarInfo = shouldProcessElement(defaultAvatars[j]);
            if (avatarInfo) {
                queueElementForProcessing(avatarInfo);
            }
        }
        
        addFastReplyUserInfo(document);
    }

    // ==============================
    // OBSERVER INTEGRATION
    // ==============================

    function setupObserver() {
        if (window.forumObserver && typeof window.forumObserver.register === 'function') {
            window.forumObserver.register({
                id: 'forum_avatars_working',
                selector: '.summary li[class^="box_"], a.avatar[href*="MID="] .default-avatar, .post.box_visitatore, .popup.pop_points .users li a[href*="MID="], .send .skin_tbl',
                callback: function(node) {
                    if (state.waitingForScripts) {
                        var info = shouldProcessElement(node);
                        if (info) {
                            state.pendingElements.push(info);
                        } else if (node.matches && node.matches(FAST_REPLY_CONFIG.selectors.fastReply)) {
                            addFastReplyUserInfo(node);
                        }
                    } else {
                        handleNewElement(node);
                    }
                },
                priority: 'high'
            });
            
            window.forumObserver.register({
                id: 'fast_reply_user_update',
                selector: FAST_REPLY_CONFIG.selectors.menuWrap,
                priority: 'medium',
                callback: function() {
                    refreshFastReplyUser();
                }
            });
        }
    }

    // ==============================
    // INITIALIZATION
    // ==============================

    function initAvatarSystem() {
        if (state.isInitialized) return;
        
        clearOldCacheEntries();
        
        setupObserver();
        
        waitForScripts(function() {
            console.log('🚀 Avatar system starting with media scripts ready');
            
            if (state.pendingElements.length > 0) {
                console.log('📦 Processing ' + state.pendingElements.length + ' queued elements');
                state.pendingElements.forEach(function(info) {
                    processElementNow(info);
                });
                state.pendingElements = [];
            }
            
            processExistingElements();
            
            // Start prefetching user avatars in the background
            setTimeout(function() {
                prefetchUserAvatars();
                setupLikesPopupObserver();
            }, 1000);
            
            state.isInitialized = true;
            
            window.dispatchEvent(new CustomEvent('forum-avatars-ready', {
                detail: { 
                    timestamp: Date.now(),
                    processed: state.processedPosts.size
                }
            }));
            console.log('📢 Dispatched forum-avatars-ready event');
        });
    }

    // ==============================
    // PUBLIC API
    // ==============================

    window.ForumAvatars = {
        init: initAvatarSystem,
        
        isInitialized: false,
        
        refresh: function() {
            var containers = document.querySelectorAll('.forum-avatar-container, .has-forum-avatar img.forum-likes-avatar');
            for (var i = 0; i < containers.length; i++) {
                containers[i].remove();
            }
            
            var replacedAvatars = document.querySelectorAll('.avatar-replaced img.forum-user-avatar');
            for (var j = 0; j < replacedAvatars.length; j++) {
                replacedAvatars[j].remove();
            }
            
            var replacedLinks = document.querySelectorAll('.avatar-replaced, .has-forum-avatar');
            for (var k = 0; k < replacedLinks.length; k++) {
                replacedLinks[k].classList.remove('avatar-replaced');
                replacedLinks[k].classList.remove('has-forum-avatar');
            }
            
            state.userCache = {};
            state.brokenAvatars.clear();
            state.processedPosts = new WeakSet();
            state.processedAvatars = new WeakSet();
            state.processedDeletedUsers = new WeakSet();
            state.processedLikesList = new WeakSet();
            state.processedFastReply = new WeakSet();
            state.processingQueue = [];
            state.isProcessing = false;
            state.isInitialized = false;
            window.ForumAvatars.isInitialized = false;
            
            for (var l = 0; l < localStorage.length; l++) {
                var key = localStorage.key(l);
                if (key && (key.startsWith(AVATAR_CONFIG.cache.prefix) || 
                            key.startsWith(AVATAR_CONFIG.cache.deletedPrefix))) {
                    localStorage.removeItem(key);
                }
            }
            
            initAvatarSystem();
        },
        
        refreshFastReply: refreshFastReplyUser,
        
        getCurrentUser: function() {
            return extractCurrentUser();
        },
        
        setFastReplyDebug: function(enabled) {
            FAST_REPLY_CONFIG.debug = enabled;
        },
        
        clearCache: function() {
            state.userCache = {};
            
            var clearedCount = 0;
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && (key.startsWith(AVATAR_CONFIG.cache.prefix) || 
                            key.startsWith(AVATAR_CONFIG.cache.deletedPrefix))) {
                    localStorage.removeItem(key);
                    clearedCount++;
                }
            }
            
            return clearedCount;
        },
        
        resetBrokenAvatars: function() {
            state.brokenAvatars.clear();
            
            var clearedCount = 0;
            var keysToRemove = [];
            
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.startsWith(AVATAR_CONFIG.cache.brokenPrefix)) {
                    keysToRemove.push(key);
                    clearedCount++;
                }
            }
            
            keysToRemove.forEach(key => localStorage.removeItem(key));
            
            this.refresh();
            
            return clearedCount;
        },
        
        stats: function() {
            var cacheCount = 0;
            var deletedCacheCount = 0;
            var generatedCount = 0;
            var realCount = 0;
            var brokenCount = 0;
            
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.startsWith(AVATAR_CONFIG.cache.prefix)) {
                    cacheCount++;
                    try {
                        var data = JSON.parse(localStorage.getItem(key));
                        if (data && data.url) {
                            if (data.url.includes('dicebear.com')) {
                                generatedCount++;
                            } else {
                                realCount++;
                            }
                        }
                    } catch (e) {}
                }
                if (key && key.startsWith(AVATAR_CONFIG.cache.deletedPrefix)) {
                    deletedCacheCount++;
                }
                if (key && key.startsWith(AVATAR_CONFIG.cache.brokenPrefix)) {
                    brokenCount++;
                }
            }
            
            var posts = document.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
            var withAvatars = 0;
            for (var j = 0; j < posts.length; j++) {
                var nickname = posts[j].querySelector('.nick a, .nick');
                if (nickname && nickname.previousElementSibling && 
                    nickname.previousElementSibling.classList && 
                    nickname.previousElementSibling.classList.contains('forum-avatar-container')) {
                    withAvatars++;
                }
            }
            
            var likesAvatars = document.querySelectorAll('.forum-likes-avatar').length;
            var fastReplyExists = !!document.querySelector('.fast-reply-user-info');
            
            return {
                postsTotal: posts.length,
                postsWithAvatars: withAvatars,
                likesAvatars: likesAvatars,
                fastReplyPresent: fastReplyExists,
                memoryCache: Object.keys(state.userCache).length,
                localStorageCache: cacheCount,
                realAvatars: realCount,
                generatedAvatars: generatedCount,
                deletedUserCache: deletedCacheCount,
                brokenFlags: brokenCount,
                brokenInMemory: state.brokenAvatars.size,
                queueSize: state.processingQueue.length,
                isProcessing: state.isProcessing,
                isInitialized: state.isInitialized,
                cacheVersion: state.cacheVersion,
                scriptsReady: state.scriptsReady,
                waitingForScripts: state.waitingForScripts,
                pendingElements: state.pendingElements.length,
                prefetchedUsers: prefetchState.prefetchedUsers.size
            };
        },
        
        debugUser: function(userId) {
            var posts = document.querySelectorAll('.summary li[class*="box_m' + userId + '"]');
            
            for (var i = 0; i < posts.length; i++) {
                var nickname = posts[i].querySelector('.nick a, .nick');
                var extracted = extractUsernameFromElement(posts[i], 'post', userId);
            }
            
            fetch('/api.php?mid=' + userId)
                .then(r => r.json())
                .then(data => {})
                .catch(err => {});
        },
        
        debugLikes: function() {
            var likesLinks = document.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
            
            for (var i = 0; i < likesLinks.length; i++) {
                var link = likesLinks[i];
                var userId = extractUserIdFromElement(link, 'likes_href');
                var username = extractUsernameFromElement(link, 'likes_list', userId);
            }
        },
        
        areMediaScriptsReady: function() {
            return checkScriptsReady();
        },
        
        reprocessWithDimensionExtractor: function(element) {
            if (window.mediaDimensionExtractor && element) {
                window.mediaDimensionExtractor.forceReprocessElement(element);
            }
        },
        
        getPrefetchStats: function() {
            return {
                prefetchedUsers: prefetchState.prefetchedUsers.size,
                isPrefetching: prefetchState.isPrefetching
            };
        }
    };

    Object.defineProperty(window.ForumAvatars, 'isInitialized', {
        get: function() { return state.isInitialized; },
        set: function(value) { state.isInitialized = value; },
        configurable: true
    });

    // ==============================
    // AUTO-INITIALIZE
    // ==============================

    setTimeout(initAvatarSystem, 10);

})();
