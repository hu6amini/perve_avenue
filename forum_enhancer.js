// ==============================
// Complete Working Avatar System - INCLUDING LIKES/DISLIKES
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
            'likes_list': 30  // Smaller size for likes/dislikes lists
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
            duration: 86400000,
            prefix: 'avatar_',
            brokenPrefix: 'broken_avatar_',
            deletedPrefix: 'deleted_avatar_'
        }
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
        isInitialized: false,
        cacheVersion: '2.0' // Cache version to force refresh
    };

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

    function clearGeneratedAvatarsFromCache() {
        console.log('🔄 Clearing generated avatars from cache...');
        var keysToClear = [];
        var clearedCount = 0;
        
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key && key.startsWith(AVATAR_CONFIG.cache.prefix)) {
                try {
                    var data = JSON.parse(localStorage.getItem(key));
                    if (data && data.url && 
                        (data.url.includes('dicebear.com') || 
                         data.url.includes('api.dicebear.com') ||
                         (data.timestamp && Date.now() - data.timestamp > AVATAR_CONFIG.cache.duration))) {
                        keysToClear.push(key);
                        clearedCount++;
                    }
                } catch (e) {
                    keysToClear.push(key);
                }
            }
        }
        
        for (var j = 0; j < keysToClear.length; j++) {
            localStorage.removeItem(keysToClear[j]);
        }
        
        console.log('✅ Cleared', clearedCount, 'generated/expired avatars from cache');
        return clearedCount;
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
        
        if (state.brokenAvatars.has(avatarUrl)) {
            return true;
        }
        
        var brokenKey = AVATAR_CONFIG.cache.brokenPrefix + btoa(avatarUrl).slice(0, 50);
        var brokenCache = localStorage.getItem(brokenKey);
        if (brokenCache) {
            try {
                var data = JSON.parse(brokenCache);
                if (Date.now() - data.timestamp < AVATAR_CONFIG.cache.duration) {
                    state.brokenAvatars.add(avatarUrl);
                    return true;
                }
            } catch (e) {
                // Invalid cache
            }
        }
        
        return false;
    }

    function markAvatarAsBroken(avatarUrl) {
        if (!avatarUrl) return;
        
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
        
        var img = new Image();
        var timeoutId = setTimeout(function() {
            img.onload = img.onerror = null;
            callback(false);
        }, 3000);
        
        img.onload = function() {
            clearTimeout(timeoutId);
            callback(true);
        };
        
        img.onerror = function() {
            clearTimeout(timeoutId);
            callback(false);
        };
        
        img.src = url;
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
            // For likes list, the element IS the link with the username
            if (element.textContent) {
                username = element.textContent;
            } else if (element.title) {
                username = element.title;
            }
            
            // Also check for class name patterns
            if (!username && element.className) {
                var classMatch = element.className.match(/user\d+/);
                if (classMatch) {
                    // Try to get username from class
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
    // AVATAR FETCHING
    // ==============================

    function getOrCreateAvatar(userId, username, size, callback, isDeletedUser, isLikesList) {
        console.log('🔍 getOrCreateAvatar called:', { 
            userId, 
            username, 
            size, 
            isDeletedUser, 
            isLikesList 
        });
        
        if (isDeletedUser) {
            var cacheKey = 'deleted_' + username + '_' + size;
            
            if (state.userCache[cacheKey]) {
                var cached = state.userCache[cacheKey];
                callback(cached.url, cached.username);
                return;
            }
            
            var stored = localStorage.getItem(getDeletedUserCacheKey(username, size));
            if (stored) {
                try {
                    var data = JSON.parse(stored);
                    if (Date.now() - data.timestamp < AVATAR_CONFIG.cache.duration) {
                        state.userCache[cacheKey] = data;
                        callback(data.url, data.username);
                        return;
                    }
                } catch (e) {
                    // Invalid cache
                }
            }
            
            var avatarUrl = generateLetterAvatar(null, username, size);
            console.log('Generated deleted user avatar:', avatarUrl);
            var cacheData = {
                url: avatarUrl,
                username: username,
                timestamp: Date.now(),
                size: size,
                isDeletedUser: true,
                cacheVersion: state.cacheVersion
            };
            
            try {
                localStorage.setItem(getDeletedUserCacheKey(username, size), JSON.stringify(cacheData));
            } catch (e) {
                clearOldCacheEntries();
                localStorage.setItem(getDeletedUserCacheKey(username, size), JSON.stringify(cacheData));
            }
            
            state.userCache[cacheKey] = cacheData;
            callback(avatarUrl, username);
            return;
        }
        
        // For active users with ID
        var cacheKey = userId + '_' + size;
        
        // Check if we have a valid cached avatar
        if (state.userCache[cacheKey]) {
            var cached = state.userCache[cacheKey];
            
            // Skip cache if it's an old version or generated avatar for likes list
            if (isLikesList && cached.url && cached.url.includes('dicebear.com')) {
                console.log('Skipping generated avatar cache for likes list user', userId);
                delete state.userCache[cacheKey];
            } else if (!isBrokenAvatarUrl(cached.url)) {
                console.log('Using cached avatar for user', userId, cached.url);
                callback(cached.url, cached.username);
                return;
            }
        }
        
        // Check localStorage
        var stored = localStorage.getItem(getCacheKey(userId, size));
        if (stored) {
            try {
                var data = JSON.parse(stored);
                
                // Check if cache is expired or old version
                var isExpired = Date.now() - data.timestamp > AVATAR_CONFIG.cache.duration;
                var isOldVersion = !data.cacheVersion || data.cacheVersion !== state.cacheVersion;
                var isGeneratedAvatar = data.url && data.url.includes('dicebear.com');
                
                // For likes list, always skip generated avatars
                if (isLikesList && isGeneratedAvatar) {
                    console.log('Skipping generated avatar in localStorage for likes list');
                    localStorage.removeItem(getCacheKey(userId, size));
                }
                // Use cache only if valid
                else if (!isExpired && !isOldVersion && !isBrokenAvatarUrl(data.url)) {
                    state.userCache[cacheKey] = data;
                    console.log('Using localStorage cached avatar for user', userId, data.url);
                    callback(data.url, data.username);
                    return;
                } else if (isExpired || isOldVersion) {
                    console.log('Cache expired or old version for user', userId);
                    localStorage.removeItem(getCacheKey(userId, size));
                }
            } catch (e) {
                console.log('Invalid cache for user', userId);
                localStorage.removeItem(getCacheKey(userId, size));
            }
        }
        
        console.log('🔄 Fetching from API for user', userId);
        // Fetch from forum API
        fetch('/api.php?mid=' + userId)
            .then(function(response) {
                console.log('API response status:', response.status, 'for user', userId);
                if (!response.ok) {
                    throw new Error('API failed with status ' + response.status);
                }
                return response.json();
            })
            .then(function(data) {
                console.log('API data received for user', userId, data);
                var userKey = 'm' + userId;
                var userData = data[userKey];
                var finalUsername = username;
                var avatarUrl;
                
                if (userData && userData.nickname) {
                    finalUsername = cleanUsername(userData.nickname);
                    console.log('API nickname:', userData.nickname, '-> cleaned:', finalUsername);
                }
                
                if (userData && userData.avatar && 
                    userData.avatar.trim() !== '' && 
                    userData.avatar !== 'http') {
                    
                    avatarUrl = userData.avatar;
                    console.log('🎯 REAL AVATAR FOUND from API:', avatarUrl, 'for user', userId);
                    
                    if (isBrokenAvatarUrl(avatarUrl)) {
                        console.log('Avatar marked as broken, generating fallback');
                        avatarUrl = generateLetterAvatar(userId, finalUsername, size);
                        finishAvatar(avatarUrl, finalUsername);
                    } else {
                        testImageUrl(avatarUrl, function(success) {
                            if (success) {
                                console.log('✅ Avatar URL test SUCCESS for user', userId);
                                finishAvatar(avatarUrl, finalUsername);
                            } else {
                                console.log('❌ Avatar URL test FAILED for user', userId);
                                markAvatarAsBroken(avatarUrl);
                                avatarUrl = generateLetterAvatar(userId, finalUsername, size);
                                finishAvatar(avatarUrl, finalUsername);
                            }
                        });
                        return;
                    }
                } else {
                    console.log('⚠️ No avatar from API for user', userId, 'generating letter avatar');
                    avatarUrl = generateLetterAvatar(userId, finalUsername, size);
                }
                
                finishAvatar(avatarUrl, finalUsername);
                
                function finishAvatar(url, name) {
                    var cacheData = {
                        url: url,
                        username: name,
                        timestamp: Date.now(),
                        size: size,
                        cacheVersion: state.cacheVersion,
                        source: url.includes('dicebear.com') ? 'generated' : 'forum'
                    };
                    
                    console.log('💾 Caching avatar for user', userId, 'Source:', cacheData.source);
                    try {
                        localStorage.setItem(getCacheKey(userId, size), JSON.stringify(cacheData));
                    } catch (e) {
                        clearOldCacheEntries();
                        localStorage.setItem(getCacheKey(userId, size), JSON.stringify(cacheData));
                    }
                    
                    state.userCache[cacheKey] = cacheData;
                    callback(url, name);
                }
            })
            .catch(function(error) {
                console.warn('❌ Avatar fetch failed for user ' + userId + ':', error);
                var fallbackUrl = generateLetterAvatar(userId, username, size);
                console.log('Using fallback generated avatar for user', userId, fallbackUrl);
                var cacheData = {
                    url: fallbackUrl,
                    username: username || 'User',
                    timestamp: Date.now(),
                    size: size,
                    cacheVersion: state.cacheVersion,
                    source: 'generated_fallback'
                };
                
                try {
                    localStorage.setItem(getCacheKey(userId, size), JSON.stringify(cacheData));
                } catch (e) {
                    clearOldCacheEntries();
                    localStorage.setItem(getCacheKey(userId, size), JSON.stringify(cacheData));
                }
                
                state.userCache[cacheKey] = cacheData;
                callback(fallbackUrl, username || 'User');
            });
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
            // Check the element's href directly (it's already an <a> tag)
            if (element.href) {
                // Try multiple patterns
                var hrefMatch = element.href.match(/MID=(\d+)/) || 
                                element.href.match(/[?&]MID=(\d+)/) ||
                                element.href.match(/MID\%3D(\d+)/);
                
                if (hrefMatch) {
                    userId = hrefMatch[1];
                } else {
                    // Try to decode URL and check again
                    try {
                        var decodedUrl = decodeURIComponent(element.href);
                        hrefMatch = decodedUrl.match(/MID=(\d+)/);
                        if (hrefMatch) userId = hrefMatch[1];
                    } catch (e) {
                        console.log('Failed to decode URL:', element.href);
                    }
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
        
        // Check if it's a summary post
        if (element.matches('.summary li[class^="box_"]')) {
            config = {
                type: 'post',
                size: AVATAR_CONFIG.sizes.post,
                extractor: 'class'
            };
        }
        // Check if it's a default avatar inside a post
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
        // Check if it's a deleted user
        else if (element.matches('.post.box_visitatore')) {
            config = {
                type: 'deleted_user',
                size: AVATAR_CONFIG.sizes.deleted_user,
                extractor: 'visitatore'
            };
        }
        // Check if it's a likes/dislikes list item
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
        
        // Check if already processed
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
            // Check if this link already has an avatar before it
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

    // ==============================
    // AVATAR CREATION & INSERTION
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
        
        img.style.cssText = 
            'width:' + size + 'px;' +
            'height:' + size + 'px;' +
            'border-radius:50%;' +
            'object-fit:cover;' +
            'vertical-align:middle;' +
            'border:2px solid #fff;' +
            'box-shadow:0 2px 4px rgba(0,0,0,0.1);' +
            'background-color:#f0f0f0;' +
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
            console.log('Avatar image error for user', userId, avatarUrl);
            markAvatarAsBroken(avatarUrl);
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

    function insertAvatarForElement(processingInfo) {
        var element = processingInfo.element;
        var userId = processingInfo.userId;
        var config = processingInfo.config;
        
        var username = extractUsernameFromElement(element, config.type, userId);
        
        if (config.type === 'likes_list') {
            if (!userId) {
                console.error('NO USER ID for likes list! Using generated avatar.');
                var fallbackUrl = generateLetterAvatar(null, username, config.size);
                insertLikesListAvatar(element, null, config.size, fallbackUrl, username);
                state.processedLikesList.add(element);
                return;
            }
            
            // Special handling for likes list - use forum API
            getOrCreateAvatar(userId, username, config.size, function(avatarUrl, finalUsername) {
                console.log('✅ Got avatar for likes list user', userId, ':', 
                    avatarUrl.includes('dicebear.com') ? 'Generated' : 'Real Forum Avatar');
                insertLikesListAvatar(element, userId, config.size, avatarUrl, finalUsername);
                state.processedLikesList.add(element);
            }, false, true); // isDeletedUser = false, isLikesList = true
        } else {
            var isDeletedUser = config.type === 'deleted_user';
            getOrCreateAvatar(userId, username, config.size, function(avatarUrl, finalUsername) {
                if (config.type === 'post') {
                    insertPostAvatar(element, userId, config.size, avatarUrl, finalUsername);
                    state.processedPosts.add(element);
                } else if (config.type === 'default_avatar') {
                    insertDefaultAvatar(element, userId, config.size, avatarUrl, finalUsername);
                    state.processedAvatars.add(element);
                } else if (config.type === 'deleted_user') {
                    insertDeletedUserAvatar(element, null, config.size, avatarUrl, finalUsername);
                    state.processedDeletedUsers.add(element);
                }
            }, isDeletedUser, false); // isLikesList = false for posts
        }
    }

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
            'position:relative;';
        
        container.appendChild(createAvatarElement(avatarUrl, userId, size, username, false, false));
        nickname.parentNode.insertBefore(container, nickname);
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
            'position:relative;';
        
        container.appendChild(createAvatarElement(avatarUrl, null, size, username, true, false));
        nickname.parentNode.insertBefore(container, nickname);
    }

    function insertLikesListAvatar(linkElement, userId, size, avatarUrl, username) {
        // Find the span container that holds the link
        var span = linkElement.closest('span');
        if (!span) return;
        
        // Check if avatar already exists
        if (span.querySelector('img.forum-likes-avatar')) {
            return;
        }
        
        var avatarImg = createAvatarElement(avatarUrl, userId, size, username, false, true);
        
        // Insert the avatar before the link
        span.insertBefore(avatarImg, linkElement);
        
        // Add a class to mark as processed
        span.classList.add('has-forum-avatar');
    }

    // ==============================
    // PAGE PROCESSING
    // ==============================

    function handleNewElement(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        
        // Check the node itself
        var nodeInfo = shouldProcessElement(node);
        if (nodeInfo) {
            insertAvatarForElement(nodeInfo);
        }
        
        // Check for posts
        var posts = node.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
        for (var i = 0; i < posts.length; i++) {
            var postInfo = shouldProcessElement(posts[i]);
            if (postInfo) {
                insertAvatarForElement(postInfo);
            }
        }
        
        // Check for default avatars
        var defaultAvatars = node.querySelectorAll('a.avatar[href*="MID="] .default-avatar');
        for (var j = 0; j < defaultAvatars.length; j++) {
            var avatarInfo = shouldProcessElement(defaultAvatars[j]);
            if (avatarInfo) {
                insertAvatarForElement(avatarInfo);
            }
        }
        
        // Check for likes/dislikes lists
        var likesLinks = node.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
        for (var k = 0; k < likesLinks.length; k++) {
            var likesInfo = shouldProcessElement(likesLinks[k]);
            if (likesInfo) {
                insertAvatarForElement(likesInfo);
            }
        }
    }

    function processExistingElements() {
        console.log('🚀 Processing existing elements...');
        
        // Process posts
        var posts = document.querySelectorAll('.summary li[class^="box_"], .post.box_visitatore');
        for (var i = 0; i < posts.length; i++) {
            var postInfo = shouldProcessElement(posts[i]);
            if (postInfo) {
                insertAvatarForElement(postInfo);
            }
        }
        
        // Process default avatars
        var defaultAvatars = document.querySelectorAll('a.avatar[href*="MID="] .default-avatar');
        for (var j = 0; j < defaultAvatars.length; j++) {
            var avatarInfo = shouldProcessElement(defaultAvatars[j]);
            if (avatarInfo) {
                insertAvatarForElement(avatarInfo);
            }
        }
        
        // Process likes/dislikes lists
        var likesLinks = document.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
        for (var k = 0; k < likesLinks.length; k++) {
            var likesInfo = shouldProcessElement(likesLinks[k]);
            if (likesInfo) {
                insertAvatarForElement(likesInfo);
            }
        }
    }

    // ==============================
    // OBSERVER INTEGRATION
    // ==============================

    function setupObserver() {
        if (window.forumObserver && typeof window.forumObserver.register === 'function') {
            window.forumObserver.register({
                id: 'forum_avatars_working',
                selector: '.summary li[class^="box_"], a.avatar[href*="MID="] .default-avatar, .post.box_visitatore, .popup.pop_points .users li a[href*="MID="]',
                callback: handleNewElement,
                priority: 'high'
            });
            console.log('Registered with ForumCoreObserver');
        } else {
            console.error('ForumCoreObserver not available. Avatar system will not work.');
        }
    }

    // ==============================
    // INITIALIZATION
    // ==============================

    function initAvatarSystem() {
        if (state.isInitialized) return;
        
        console.log('🚀 Initializing working avatar system with likes/dislikes support');
        
        // Clear generated avatars from cache on every initialization
        var clearedCount = clearGeneratedAvatarsFromCache();
        console.log('Cleared', clearedCount, 'generated avatars from localStorage');
        
        // Also clear old cache entries
        var expiredCount = clearOldCacheEntries();
        console.log('Cleared', expiredCount, 'expired cache entries');
        
        setupObserver();
        
        setTimeout(function() {
            processExistingElements();
            state.isInitialized = true;
            console.log('✅ Avatar system initialized');
        }, 100);
    }

    // ==============================
    // PUBLIC API
    // ==============================

    window.ForumAvatars = {
        init: initAvatarSystem,
        
        refresh: function() {
            console.log('🔄 Refreshing avatars...');
            
            // Remove all avatars from DOM
            var containers = document.querySelectorAll('.forum-avatar-container, .has-forum-avatar img.forum-likes-avatar');
            for (var i = 0; i < containers.length; i++) {
                if (containers[i].classList && containers[i].classList.contains('forum-avatar-container')) {
                    containers[i].remove();
                } else {
                    containers[i].remove();
                }
            }
            
            // Remove replaced avatars
            var replacedAvatars = document.querySelectorAll('.avatar-replaced img.forum-user-avatar');
            for (var j = 0; j < replacedAvatars.length; j++) {
                replacedAvatars[j].remove();
            }
            
            // Remove avatar-replaced class
            var replacedLinks = document.querySelectorAll('.avatar-replaced, .has-forum-avatar');
            for (var k = 0; k < replacedLinks.length; k++) {
                replacedLinks[k].classList.remove('avatar-replaced');
                replacedLinks[k].classList.remove('has-forum-avatar');
            }
            
            // Clear state
            state.userCache = {};
            state.brokenAvatars.clear();
            state.processedPosts = new WeakSet();
            state.processedAvatars = new WeakSet();
            state.processedDeletedUsers = new WeakSet();
            state.processedLikesList = new WeakSet();
            state.isInitialized = false;
            
            // Clear localStorage COMPLETELY
            console.log('🗑️ Clearing ALL avatar cache from localStorage...');
            var clearedKeys = [];
            for (var l = 0; l < localStorage.length; l++) {
                var key = localStorage.key(l);
                if (key && (key.startsWith(AVATAR_CONFIG.cache.prefix) || 
                            key.startsWith(AVATAR_CONFIG.cache.brokenPrefix) ||
                            key.startsWith(AVATAR_CONFIG.cache.deletedPrefix))) {
                    localStorage.removeItem(key);
                    clearedKeys.push(key);
                }
            }
            console.log('✅ Cleared', clearedKeys.length, 'cache entries from localStorage');
            
            // Reinitialize
            initAvatarSystem();
        },
        
        clearCache: function() {
            console.log('🧹 Manually clearing avatar cache...');
            var clearedCount = clearGeneratedAvatarsFromCache();
            state.userCache = {};
            console.log('✅ Cleared', clearedCount, 'generated avatars from cache');
            return clearedCount;
        },
        
        stats: function() {
            var cacheCount = 0;
            var deletedCacheCount = 0;
            var generatedCount = 0;
            var realCount = 0;
            
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
                    } catch (e) {
                        // Skip invalid entries
                    }
                }
                if (key && key.startsWith(AVATAR_CONFIG.cache.deletedPrefix)) {
                    deletedCacheCount++;
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
            
            return {
                postsTotal: posts.length,
                postsWithAvatars: withAvatars,
                likesAvatars: likesAvatars,
                memoryCache: Object.keys(state.userCache).length,
                localStorageCache: cacheCount,
                realAvatars: realCount,
                generatedAvatars: generatedCount,
                deletedUserCache: deletedCacheCount,
                brokenUrls: state.brokenAvatars.size,
                isInitialized: state.isInitialized
            };
        },
        
        debugUser: function(userId) {
            var posts = document.querySelectorAll('.summary li[class*="box_m' + userId + '"]');
            console.log('Debug user ' + userId + ':');
            
            for (var i = 0; i < posts.length; i++) {
                var nickname = posts[i].querySelector('.nick a, .nick');
                console.log('Post ' + (i+1) + ' .nick:', nickname ? nickname.textContent : 'none');
                
                var extracted = extractUsernameFromElement(posts[i], 'post', userId);
                console.log('Extracted username:', extracted);
            }
        },
        
        debugLikes: function() {
            var likesLinks = document.querySelectorAll('.popup.pop_points .users li a[href*="MID="]');
            console.log('Debug likes links:', likesLinks.length);
            
            for (var i = 0; i < likesLinks.length; i++) {
                var link = likesLinks[i];
                console.log('Link', i + 1, ':', {
                    href: link.href,
                    text: link.textContent,
                    className: link.className
                });
                
                var userId = extractUserIdFromElement(link, 'likes_href');
                console.log('Extracted userId:', userId);
                
                var username = extractUsernameFromElement(link, 'likes_list', userId);
                console.log('Extracted username:', username);
            }
        },
        
        // Force clear localStorage for this domain
        clearLocalStorage: function() {
            console.log('⚠️ WARNING: This will clear ALL localStorage for this domain!');
            var confirmed = confirm('This will clear ALL localStorage data for this site. Continue?');
            if (confirmed) {
                localStorage.clear();
                console.log('✅ localStorage cleared completely');
                location.reload();
            }
        }
    };

    // ==============================
    // AUTO-INITIALIZE
    // ==============================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initAvatarSystem, 100);
        });
    } else {
        setTimeout(initAvatarSystem, 100);
    }

})();

// Ultra-Optimized Media Dimension Extractor for deferred loading
// DOM is guaranteed to be ready when this executes (defer attribute)
'use strict';

class MediaDimensionExtractor {
    #observerId = null;
    #processedMedia = new WeakSet();
    #dimensionCache = new Map();
    #lruMap = new Map();
    #imageLoadHandler = null;
    #imageLoadAbortController = new AbortController();
    #cacheHits = 0;
    #cacheMisses = 0;
    #smallContextElements = null;
    #MAX_CACHE_SIZE = 500;

    // Static configurations for better performance
    static #IFRAME_SIZES = new Map([
        ['youtube', ['560', '315']],
        ['youtu', ['560', '315']],
        ['vimeo', ['640', '360']],
        ['soundcloud', ['100%', '166']],
        ['twitter', ['550', '400']],
        ['x.com', ['550', '400']]
    ]);

    static #EMOJI_PATTERNS = [
        /twemoji/iu,
        /emoji/iu,
        /smiley/iu
    ];

    static #SMALL_CONTEXT_SELECTORS = '.modern-quote, .quote-content, .modern-spoiler, .spoiler-content, .signature, .post-signature';
    
    // UPDATED CONSTANTS TO MATCH NEW CSS HEADING SIZES:
static #EMOJI_SIZE_NORMAL = 20;      // Body text: 16px × 1.25 = 20px
static #EMOJI_SIZE_SMALL = 18;       // Signatures/quotes: 14px × 1.25 ≈ 18px
static #EMOJI_SIZE_H1 = 35;          // h1: 32px × 1.1 = 35px
static #EMOJI_SIZE_H2 = 29;          // h2: 25px × 1.15 = 29px
static #EMOJI_SIZE_H3 = 24;          // h3: 20px × 1.2 = 24px
static #EMOJI_SIZE_H4 = 20;          // h4: 16px × 1.25 = 20px
static #EMOJI_SIZE_H5 = 18;          // h5: 14px × 1.3 = 18px
static #EMOJI_SIZE_H6 = 16;          // h6: 12px × 1.35 = 16px
    static #BROKEN_IMAGE_SIZE = { width: 600, height: 400 };
    static #BATCH_SIZE = 50;

    constructor() {
        this.#imageLoadHandler = this.#handleImageLoad.bind(this);
        // Cache context elements immediately
        this.#cacheContextElements();
        this.#init();
    }

    #init() {
        // Immediate initialization - DOM is ready (defer)
        this.#setupObserver();
        this.#cacheContextElements();
    }

    #cacheContextElements() {
        this.#smallContextElements = new Set(
            document.querySelectorAll(MediaDimensionExtractor.#SMALL_CONTEXT_SELECTORS)
        );
    }

    #setupObserver() {
        if (!globalThis.forumObserver) {
            // Quick retry for observer availability
            setTimeout(() => this.#setupObserver(), 10);
            return;
        }

        // Register with global observer (no page restrictions)
        this.#observerId = globalThis.forumObserver.register({
            id: 'media-dimension-extractor',
            callback: (node) => {
                this.#processMedia(node);
            },
            selector: 'img, iframe, video',
            priority: 'high'
        });

        // Process all existing media using batched approach
        this.#processAllMediaBatched();
    }

    #processAllMediaBatched() {
        const batches = [
            document.images,
            document.getElementsByTagName('iframe'),
            document.getElementsByTagName('video')
        ];
        
        // Process in batches to avoid blocking
        requestAnimationFrame(() => {
            this.#processBatch(batches, 0, 0);
        });
    }

    #processBatch(batches, batchIndex, elementIndex) {
        const BATCH_SIZE = MediaDimensionExtractor.#BATCH_SIZE;
        let processedCount = 0;
        const startTime = performance.now();
        
        while (batchIndex < batches.length && processedCount < BATCH_SIZE) {
            const batch = batches[batchIndex];
            
            while (elementIndex < batch.length && processedCount < BATCH_SIZE) {
                const element = batch[elementIndex];
                if (!this.#processedMedia.has(element)) {
                    this.#processSingleMedia(element);
                    processedCount++;
                }
                elementIndex++;
            }
            
            if (elementIndex >= batch.length) {
                batchIndex++;
                elementIndex = 0;
            }
        }
        
        if (batchIndex < batches.length) {
            requestAnimationFrame(() => {
                this.#processBatch(batches, batchIndex, elementIndex);
            });
        }
    }

    #processMedia(node) {
        if (this.#processedMedia.has(node)) return;

        const tag = node.tagName;

        // Fast tag detection using switch
        switch(tag) {
            case 'IMG':
                this.#processImage(node);
                break;
            case 'IFRAME':
                this.#processIframe(node);
                break;
            case 'VIDEO':
                this.#processVideo(node);
                break;
            default:
                // Handle nested media
                this.#processNestedMedia(node);
        }
    }

    #processNestedMedia(node) {
        const images = node.getElementsByTagName('img');
        const iframes = node.getElementsByTagName('iframe');
        const videos = node.getElementsByTagName('video');

        // Process images
        for (let i = 0, len = images.length; i < len; i++) {
            const img = images[i];
            if (!this.#processedMedia.has(img)) {
                this.#processImage(img);
            }
        }
        
        // Process iframes
        for (let i = 0, len = iframes.length; i < len; i++) {
            const iframe = iframes[i];
            if (!this.#processedMedia.has(iframe)) {
                this.#processIframe(iframe);
            }
        }
        
        // Process videos
        for (let i = 0, len = videos.length; i < len; i++) {
            const video = videos[i];
            if (!this.#processedMedia.has(video)) {
                this.#processVideo(video);
            }
        }
    }

    #processSingleMedia(media) {
        if (this.#processedMedia.has(media)) return;

        const tag = media.tagName;
        
        switch(tag) {
            case 'IMG':
                this.#processImage(media);
                break;
            case 'IFRAME':
                this.#processIframe(media);
                break;
            case 'VIDEO':
                this.#processVideo(media);
                break;
        }

        this.#processedMedia.add(media);
    }

    #processImage(img) {
        // ULTRA-AGGRESSIVE twemoji detection - MUST BE FIRST
        const isTwemoji = img.src.includes('twemoji') || 
                        img.classList.contains('twemoji') ||
                        img.classList.contains('emoji') ||
                        (img.alt && (img.alt.includes(':)') || img.alt.includes(':(') || img.alt.includes('emoji')));
        
        if (isTwemoji) {
            // Determine which size to use based on context
            let size = MediaDimensionExtractor.#EMOJI_SIZE_NORMAL;
            
            // Check for small contexts first (signatures, quotes, spoilers)
            if (this.#isInSmallContext(img)) {
                size = MediaDimensionExtractor.#EMOJI_SIZE_SMALL;
            } 
            // Check for headings
            else {
                const heading = img.closest('h1, h2, h3, h4, h5, h6');
                if (heading) {
                    switch(heading.tagName) {
                        case 'H1': size = MediaDimensionExtractor.#EMOJI_SIZE_H1; break;
                        case 'H2': size = MediaDimensionExtractor.#EMOJI_SIZE_H2; break;
                        case 'H3': size = MediaDimensionExtractor.#EMOJI_SIZE_H3; break;
                        case 'H4': size = MediaDimensionExtractor.#EMOJI_SIZE_H4; break;
                        case 'H5': size = MediaDimensionExtractor.#EMOJI_SIZE_H5; break;
                        case 'H6': size = MediaDimensionExtractor.#EMOJI_SIZE_H6; break;
                    }
                }
            }
            
            // Remove any existing dimension attributes first
            img.removeAttribute('width');
            img.removeAttribute('height');
            
            // Set correct dimensions
            img.setAttribute('width', size);
            img.setAttribute('height', size);
            
            // Clear any problematic styles
            let currentStyle = img.style.cssText || '';
            if (currentStyle) {
                // Remove width/height/max-width/max-height styles
                currentStyle = currentStyle
                    .replace(/width[^;]*;/g, '')
                    .replace(/height[^;]*;/g, '')
                    .replace(/max-width[^;]*;/g, '')
                    .replace(/max-height[^;]*;/g, '');
                img.style.cssText = currentStyle;
            }
            
            // Add aspect ratio
            img.style.aspectRatio = size + ' / ' + size;
            
            // Ensure it's visible and properly sized
            img.style.display = 'inline-block';
            img.style.verticalAlign = 'text-bottom';
            
            // Nuke from cache to prevent future issues
            const cacheKey = this.#getCacheKey(img.src);
            this.#dimensionCache.delete(cacheKey);
            this.#lruMap.delete(cacheKey);
            
            // Cache correct dimensions
            this.#cacheDimension(img.src, size, size);
            return;
        }

        // Cache check first (hottest path) - but NOT for emojis
        const cacheKey = this.#getCacheKey(img.src);
        const cached = this.#dimensionCache.get(cacheKey);
        if (cached) {
            this.#cacheHits++;
            if (!img.hasAttribute('width') || !img.hasAttribute('height')) {
                img.setAttribute('width', cached.width);
                img.setAttribute('height', cached.height);
                img.style.aspectRatio = cached.width + ' / ' + cached.height;
            }
            return;
        }
        this.#cacheMisses++;

        // Validate existing attributes
        const widthAttr = img.getAttribute('width');
        const heightAttr = img.getAttribute('height');

        if (widthAttr !== null && heightAttr !== null) {
            const width = widthAttr | 0;
            const height = heightAttr | 0;

            if (width > 0 && height > 0) {
                // Validate against natural dimensions if available
                if (img.complete && img.naturalWidth) {
                    const wDiff = Math.abs(img.naturalWidth - width);
                    const hDiff = Math.abs(img.naturalHeight - height);

                    if (wDiff > width * 0.5 || hDiff > height * 0.5) {
                        // Wrong dimensions - update
                        this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
                        return;
                    }
                }

                img.style.aspectRatio = width + ' / ' + height;
                return;
            }
        }

        // Other emoji detection using modern iteration
        if (this.#isLikelyEmoji(img)) {
            const size = this.#isInSmallContext(img) ? 
                MediaDimensionExtractor.#EMOJI_SIZE_SMALL : 
                MediaDimensionExtractor.#EMOJI_SIZE_NORMAL;
            img.setAttribute('width', size);
            img.setAttribute('height', size);
            img.style.aspectRatio = size + ' / ' + size;
            
            // Cache emoji dimensions
            this.#cacheDimension(img.src, size, size);
            return;
        }
        
        // Handle loading state
        if (img.complete && img.naturalWidth) {
            this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
        } else {
            this.#setupImageLoadListener(img);
        }
    }

    #getCacheKey(src) {
        // Optimize cache keys for common patterns
        if (src.includes('twemoji')) {
            const match = src.match(/(\d+)x\1/);
            return match ? 'emoji:' + match[1] : 'emoji:default';
        }
        
        // For very long URLs, use hash
        if (src.length > 100) {
            return 'h' + this.#hashString(src);
        }
        
        return src;
    }

    #hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash | 0;
        }
        return hash;
    }

    #isLikelyEmoji(img) {
        const src = img.src;
        const className = img.className;
        
        // Use modern iteration with early exit
        return MediaDimensionExtractor.#EMOJI_PATTERNS.some((pattern) => {
            return pattern.test(src) || pattern.test(className);
        }) || (src.includes('imgbox') && img.alt && img.alt.includes('emoji'));
    }

    #isInSmallContext(img) {
    // Quick check: if we don't have the cache yet, build it
    if (!this.#smallContextElements || this.#smallContextElements.size === 0) {
        this.#cacheContextElements();
    }
    
    // Check all ancestors
    let element = img;
    while (element) {
        // Check if element has any of the signature-related classes
        if (element.classList) {
            const classList = element.classList;
            if (classList.contains('signature') || 
                classList.contains('post-signature') ||
                classList.contains('modern-quote') ||
                classList.contains('quote-content') ||
                classList.contains('modern-spoiler') ||
                classList.contains('spoiler-content')) {
                return true;
            }
            
            // Also check if element matches any in our pre-cached Set
            if (this.#smallContextElements && this.#smallContextElements.has(element)) {
                return true;
            }
        }
        element = element.parentElement;
    }
    return false;
}

    #setupImageLoadListener(img) {
        // Avoid duplicate listeners
        if (img.__dimensionExtractorHandler) return;

        img.__dimensionExtractorHandler = this.#imageLoadHandler;
        
        // Use AbortController for modern event management
        const signal = this.#imageLoadAbortController.signal;
        img.addEventListener('load', this.#imageLoadHandler, { once: true, signal });
        img.addEventListener('error', this.#imageLoadHandler, { once: true, signal });

        // Prevent layout shift
        img.style.maxWidth = '100%';
    }

    #handleImageLoad(e) {
        const img = e.target;
        delete img.__dimensionExtractorHandler;

        if (img.naturalWidth) {
            this.#setImageDimensions(img, img.naturalWidth, img.naturalHeight);
        } else {
            const brokenSize = MediaDimensionExtractor.#BROKEN_IMAGE_SIZE;
            this.#setImageDimensions(img, brokenSize.width, brokenSize.height);
        }
    }

#setImageDimensions(img, width, height) {
    // Only set attributes if they're not already set or are wrong
    const currentWidth = img.getAttribute('width');
    const currentHeight = img.getAttribute('height');
    
    if (!currentWidth || currentWidth === '0' || currentWidth === 'auto') {
        img.setAttribute('width', width);
    }
    
    if (!currentHeight || currentHeight === '0' || currentHeight === 'auto') {
        img.setAttribute('height', height);
    }
    
    // Update aspect ratio WITHOUT overriding height
    img.style.aspectRatio = width + '/' + height;
    
    // IMPORTANT: Remove height: auto if it exists
    img.style.removeProperty('height');
    
    // Cache with LRU management
    this.#cacheDimension(img.src, width, height);
}
    
    #cacheDimension(src, width, height) {
        const cacheKey = this.#getCacheKey(src);
        
        if (this.#dimensionCache.size >= this.#MAX_CACHE_SIZE) {
            // Remove oldest entry using LRU Map
            const oldestEntry = this.#lruMap.entries().next().value;
            if (oldestEntry) {
                this.#dimensionCache.delete(oldestEntry[0]);
                this.#lruMap.delete(oldestEntry[0]);
            }
        }

        this.#dimensionCache.set(cacheKey, { width, height });
        this.#lruMap.set(cacheKey, performance.now());
    }

    #processIframe(iframe) {
        const src = iframe.src || '';
        let width = '100%';
        let height = '400';

        // Use Map.forEach for cleaner iteration
        MediaDimensionExtractor.#IFRAME_SIZES.forEach((sizes, domain) => {
            if (src.includes(domain)) {
                width = sizes[0];
                height = sizes[1];
                return true;
            }
        });

        iframe.setAttribute('width', width);
        iframe.setAttribute('height', height);

        // Create responsive wrapper for fixed sizes
        if (width !== '100%') {
            const widthNum = width | 0;
            const heightNum = height | 0;

            if (widthNum > 0 && heightNum > 0) {
                const parent = iframe.parentNode;
                if (!parent || !parent.classList.contains('iframe-wrapper')) {
                    // Use documentFragment for batch DOM operations
                    const fragment = document.createDocumentFragment();
                    const wrapper = document.createElement('div');
                    wrapper.className = 'iframe-wrapper';
                    const paddingBottom = (heightNum / widthNum * 100) + '%';
                    wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:' + paddingBottom + ';overflow:hidden';

                    fragment.appendChild(wrapper);
                    parent.insertBefore(fragment, iframe);
                    wrapper.appendChild(iframe);
                    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0';
                }
            }
        }

        if (!iframe.hasAttribute('title')) {
            iframe.setAttribute('title', 'Embedded content');
        }
    }

    #processVideo(video) {
        // Add controls if missing
        if (!video.hasAttribute('controls')) {
            video.setAttribute('controls', '');
        }

        // Set default dimensions if not already set
        if (!video.style.width) {
            video.style.width = '100%';
            video.style.maxWidth = '800px';
            video.style.height = 'auto';
        }
    }

    #cleanup() {
        // Unregister from forum observer
        if (globalThis.forumObserver && this.#observerId) {
            globalThis.forumObserver.unregister(this.#observerId);
        }

        // Abort all pending event listeners
        this.#imageLoadAbortController.abort();

        // Clean up event handlers
        const images = document.images;
        for (let i = 0, len = images.length; i < len; i++) {
            const img = images[i];
            if (img.__dimensionExtractorHandler) {
                delete img.__dimensionExtractorHandler;
            }
        }
    }

    // Public API methods
    extractDimensionsForElement(element) {
        if (!element) return;

        if (element.matches('img, iframe, video')) {
            this.#processSingleMedia(element);
        } else {
            this.#processNestedMedia(element);
        }
    }

    forceReprocessElement(element) {
        if (!element) return;
        
        // Remove from processed set
        this.#processedMedia.delete(element);
        
        // Remove from cache if it exists
        const cacheKey = this.#getCacheKey(element.src);
        if (this.#dimensionCache.has(cacheKey)) {
            this.#dimensionCache.delete(cacheKey);
            this.#lruMap.delete(cacheKey);
        }
        
        // Reprocess the element
        this.#processSingleMedia(element);
    }

    clearCache() {
        this.#dimensionCache.clear();
        this.#lruMap.clear();
        this.#cacheHits = 0;
        this.#cacheMisses = 0;
    }

    getPerformanceStats() {
        const total = this.#cacheHits + this.#cacheMisses;
        const hitRate = total > 0 ? ((this.#cacheHits / total) * 100).toFixed(1) : 0;

        return {
            cacheHits: this.#cacheHits,
            cacheMisses: this.#cacheMisses,
            cacheHitRate: hitRate + '%',
            cacheSize: this.#dimensionCache.size,
            processedMedia: this.#processedMedia.size
        };
    }

    destroy() {
        this.#cleanup();
    }
}

// ============================================
// INITIALIZATION - Optimized for defer loading
// ============================================

// Deferred scripts execute after DOM is ready, no need for DOMContentLoaded
if (!globalThis.mediaDimensionExtractor) {
    try {
        globalThis.mediaDimensionExtractor = new MediaDimensionExtractor();
    } catch (error) {
        // Single retry after short delay using requestIdleCallback
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                if (!globalThis.mediaDimensionExtractor) {
                    try {
                        globalThis.mediaDimensionExtractor = new MediaDimensionExtractor();
                    } catch (retryError) {
                        // Silent fail
                    }
                }
            }, { timeout: 50 });
        } else {
            setTimeout(() => {
                if (!globalThis.mediaDimensionExtractor) {
                    try {
                        globalThis.mediaDimensionExtractor = new MediaDimensionExtractor();
                    } catch (retryError) {
                        // Silent fail
                    }
                }
            }, 50);
        }
    }
}

// Optional cleanup (browser handles most cleanup automatically)
globalThis.addEventListener('pagehide', () => {
    if (globalThis.mediaDimensionExtractor && typeof globalThis.mediaDimensionExtractor.destroy === 'function') {
        // Use requestIdleCallback for non-blocking cleanup
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                globalThis.mediaDimensionExtractor.destroy();
            });
        } else {
            setTimeout(() => {
                globalThis.mediaDimensionExtractor.destroy();
            }, 0);
        }
    }
});


//Twemoji
twemoji.parse(document.body,{folder:"svg",ext:".svg",base:"https://twemoji.maxcdn.com/v/latest/",className:"twemoji",size:"svg"});

//Default emojis to Twemoji
(function() {
    'use strict';
    
    const EMOJI_MAP = new Map([
      ['https://img.forumfree.net/html/emoticons/new/heart.svg', '2764.svg'],
      ['https://img.forumfree.net/html/emoticons/new/flame.svg', '1f525.svg'],
      ['https://img.forumfree.net/html/emoticons/new/stars.svg', '1f929.svg'],
      ['https://img.forumfree.net/html/emoticons/new/thumbup.svg', '1f44d.svg'],
      ['https://img.forumfree.net/html/emoticons/new/thumbdown.svg', '1f44e.svg'],
      ['https://img.forumfree.net/html/emoticons/new/w00t.svg', '1f92f.svg'],
      ['https://img.forumfree.net/html/emoticons/new/happy.svg', '1f60a.svg'],
      ['https://img.forumfree.net/html/emoticons/new/biggrin.svg', '1f600.svg'],
      ['https://img.forumfree.net/html/emoticons/new/bigsmile.svg', '1f603.svg'],
      ['https://img.forumfree.net/html/emoticons/new/smile.svg', '1f642.svg'],
      ['https://img.forumfree.net/html/emoticons/new/wink.svg', '1f609.svg'],
      ['https://img.forumfree.net/html/emoticons/new/tongue.svg', '1f61b.svg'],
      ['https://img.forumfree.net/html/emoticons/new/blep.svg', '1f61c.svg'],
      ['https://img.forumfree.net/html/emoticons/new/bleh.svg', '1f61d.svg'],
      ['https://img.forumfree.net/html/emoticons/new/laugh.svg', '1f606.svg'],
      ['https://img.forumfree.net/html/emoticons/new/haha.svg', '1f602.svg'],
      ['https://img.forumfree.net/html/emoticons/new/rotfl.svg', '1f923.svg'],
      ['https://img.forumfree.net/html/emoticons/new/hearts.svg', '1f60d.svg'],
      ['https://img.forumfree.net/html/emoticons/new/love.svg', '1f970.svg'],
      ['https://img.forumfree.net/html/emoticons/new/wub.svg', '1f60b.svg'],
      ['https://img.forumfree.net/html/emoticons/new/kiss.svg', '1f618.svg'],
      ['https://img.forumfree.net/html/emoticons/new/blush.svg', '263a.svg'],
      ['https://img.forumfree.net/html/emoticons/new/joy.svg', '1f60f.svg'],
      ['https://img.forumfree.net/html/emoticons/new/cool.svg', '1f60e.svg'],
      ['https://img.forumfree.net/html/emoticons/new/sad.svg', '1f641.svg'],
      ['https://img.forumfree.net/html/emoticons/new/cry.svg', '1f622.svg'],
      ['https://img.forumfree.net/html/emoticons/new/bigcry.svg', '1f62d.svg'],
      ['https://img.forumfree.net/html/emoticons/new/mad.svg', '1f620.svg'],
      ['https://img.forumfree.net/html/emoticons/new/dry.svg', '1f612.svg'],
      ['https://img.forumfree.net/html/emoticons/new/disgust.svg', '1f611.svg'],
      ['https://img.forumfree.net/html/emoticons/new/doh.svg', '1f623.svg'],
      ['https://img.forumfree.net/html/emoticons/new/neutral.svg', '1f610.svg'],
      ['https://img.forumfree.net/html/emoticons/new/unsure.svg', '1f615.svg'],
      ['https://img.forumfree.net/html/emoticons/new/mouthless.svg', '1f636.svg'],
      ['https://img.forumfree.net/html/emoticons/new/think.svg', '1f914.svg'],
      ['https://img.forumfree.net/html/emoticons/new/huh.svg', '1f928.svg'],
      ['https://img.forumfree.net/html/emoticons/new/ohmy.svg', '1f62f.svg'],
      ['https://img.forumfree.net/html/emoticons/new/rolleyes.svg', '1f644.svg'],
      ['https://img.forumfree.net/html/emoticons/new/sleep.svg', '1f634.svg'],
      ['https://img.forumfree.net/html/emoticons/new/sick.svg', '1f922.svg'],
      ['https://img.forumfree.net/html/emoticons/new/distraught.svg', '1f626.svg'],
      ['https://img.forumfree.net/html/emoticons/new/squint.svg', '1f62c.svg'],
      ['https://img.forumfree.net/html/emoticons/new/wacko.svg', '1f92a.svg'],
      ['https://img.forumfree.net/html/emoticons/new/upside.svg', '1f643.svg'],
      ['https://img.forumfree.net/html/emoticons/new/ph34r.svg', '1f977.svg'],
      ['https://img.forumfree.net/html/emoticons/new/alien.svg', '1f47d.svg'],
      ['https://img.forumfree.net/html/emoticons/new/shifty.svg', '1f608.svg'],
      ['https://img.forumfree.net/html/emoticons/new/blink.svg', '1f440.svg']
    ]);
    
    const TWEMOJI_CONFIG = {
        folder: 'svg',
        ext: '.svg',
        base: 'https://twemoji.maxcdn.com/v/latest/',
        className: 'twemoji',
        size: 'svg'
    };
    
    const PROCESSED_CLASS = 'twemoji-processed';
    const TWEMOJI_BASE_URL = TWEMOJI_CONFIG.base + 'svg/';
    
    function getEmojiSelectors(src) {
        return [
            'img[src="' + src + '"]:not(.' + PROCESSED_CLASS + ')',
            'img[data-emoticon-url="' + src + '"]:not(.' + PROCESSED_CLASS + ')',
            'img[data-emoticon-preview="' + src + '"]:not(.' + PROCESSED_CLASS + ')'
        ];
    }
    
    function replaceCustomEmojis(container) {
        if (!container || !container.querySelectorAll) return;
        
        for (const [oldSrc, newFile] of EMOJI_MAP) {
            const selectors = getEmojiSelectors(oldSrc);
            
            for (const selector of selectors) {
                const imgs = container.querySelectorAll(selector);
                
                for (let i = 0; i < imgs.length; i++) {
                    const img = imgs[i];
                    
                    const originalAttrs = {
                        src: img.src,
                        alt: img.alt,
                        dataEmoticonUrl: img.getAttribute('data-emoticon-url'),
                        dataEmoticonPreview: img.getAttribute('data-emoticon-preview'),
                        dataText: img.getAttribute('data-text')
                    };
                    
                    img.src = TWEMOJI_BASE_URL + newFile;
                    img.classList.add('twemoji', PROCESSED_CLASS);
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    
                    if (originalAttrs.dataEmoticonUrl) {
                        img.setAttribute('data-emoticon-url', originalAttrs.dataEmoticonUrl);
                    }
                    if (originalAttrs.dataEmoticonPreview) {
                        img.setAttribute('data-emoticon-preview', originalAttrs.dataEmoticonPreview);
                    }
                    if (originalAttrs.dataText) {
                        img.setAttribute('data-text', originalAttrs.dataText);
                    }
                    if (originalAttrs.alt) {
                        img.alt = originalAttrs.alt;
                    }
                    
                    img.onerror = function() {
                        console.warn('Failed to load emoji: ' + newFile);
                        this.src = originalAttrs.src;
                        this.classList.remove(PROCESSED_CLASS);
                        
                        if (originalAttrs.dataEmoticonUrl) {
                            this.setAttribute('data-emoticon-url', originalAttrs.dataEmoticonUrl);
                        }
                        if (originalAttrs.dataEmoticonPreview) {
                            this.setAttribute('data-emoticon-preview', originalAttrs.dataEmoticonPreview);
                        }
                        if (originalAttrs.dataText) {
                            this.setAttribute('data-text', originalAttrs.dataText);
                        }
                        if (originalAttrs.alt) {
                            this.alt = originalAttrs.alt;
                        }
                    };
                }
            }
        }
        
        if (window.twemoji && window.twemoji.parse) {
            if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(function() {
                    twemoji.parse(container, TWEMOJI_CONFIG);
                }, { timeout: 1000 });
            } else {
                setTimeout(function() {
                    twemoji.parse(container, TWEMOJI_CONFIG);
                }, 0);
            }
        }
    }
    
    function initEmojiReplacement() {
        replaceCustomEmojis(document.body);
        
        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
            globalThis.forumObserver.register({
                id: 'emoji-replacer-picker',
                callback: replaceCustomEmojis,
                selector: '.picker-custom-grid, .picker-custom-item, .image-thumbnail',
                priority: 'high',
                pageTypes: ['topic', 'blog', 'search', 'forum']
            });
            
            globalThis.forumObserver.register({
                id: 'emoji-replacer-content',
                callback: replaceCustomEmojis,
                selector: '.post, .article, .content, .reply, .comment, .color, td[align], div[align]',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'search', 'forum']
            });
            
            globalThis.forumObserver.register({
                id: 'emoji-replacer-quotes',
                callback: replaceCustomEmojis,
                selector: '.quote, .code, .spoiler, .modern-quote, .modern-spoiler',
                priority: 'normal'
            });
            
            globalThis.forumObserver.register({
                id: 'emoji-replacer-user-content',
                callback: replaceCustomEmojis,
                selector: '.signature, .user-info, .profile-content, .post-content',
                priority: 'low'
            });
            
            console.log('Emoji replacer fully integrated with ForumCoreObserver');
            
            setTimeout(function() {
                const pickerGrid = document.querySelector('.picker-custom-grid');
                if (pickerGrid) {
                    console.log('Found existing emoji picker, processing...');
                    replaceCustomEmojis(pickerGrid);
                }
            }, 500);
            
        } else {
            console.error('ForumCoreObserver not available - emoji replacement disabled');
        }
    }
    
    function checkAndInit() {
        if (window.twemoji) {
            initEmojiReplacement();
            return;
        }
        
        var checkInterval = setInterval(function() {
            if (window.twemoji) {
                clearInterval(checkInterval);
                initEmojiReplacement();
            }
        }, 100);
        
        setTimeout(function() {
            clearInterval(checkInterval);
            if (!window.twemoji) {
                console.warn('Twemoji not loaded after 5 seconds, proceeding without it');
                initEmojiReplacement();
            }
        }, 5000);
    }
    
    function startInitialization() {
        if (typeof queueMicrotask !== 'undefined') {
            queueMicrotask(checkAndInit);
        } else {
            setTimeout(checkAndInit, 0);
        }
    }
    
    if (document.readyState === 'loading') {
        document.onreadystatechange = function() {
            if (document.readyState === 'interactive' || document.readyState === 'complete') {
                document.onreadystatechange = null;
                startInitialization();
            }
        };
    } else {
        startInitialization();
    }
    
    window.emojiReplacer = {
        replace: replaceCustomEmojis,
        init: initEmojiReplacement,
        isReady: function() { return !!window.twemoji; },
        forcePickerUpdate: function() {
            const pickerGrid = document.querySelector('.picker-custom-grid');
            if (pickerGrid) {
                console.log('Force-updating emoji picker...');
                replaceCustomEmojis(pickerGrid);
                return true;
            }
            return false;
        }
    };
    
    document.addEventListener('click', function(e) {
        const target = e.target;
        const isLikelyEmojiTrigger = target.matches(
            '[onclick*="emoticon"], [onclick*="smiley"], ' +
            '.emoticon-btn, .smiley-btn, button:has(img[src*="emoticon"])'
        );
        
        if (isLikelyEmojiTrigger) {
            setTimeout(function() {
                window.emojiReplacer.forcePickerUpdate();
            }, 300);
        }
    }, { passive: true });
    
})();


// Enhanced Menu Modernizer - Fixed for proper extraction and no duplicates 
class EnhancedMenuModernizer { 
 #observerId = null; 
 #mobileState = false; 
 #originalMenu = null; 
 #modernMenuWrap = null; 
 #processedMenus = new Set(); 
 #retryCount = 0; 
 #maxRetries = 10; 
 
 // Better icon mappings 
 #iconMappings = { 
 // User menu 
 'Notifications from scripts': 'fa-bell', 
 'Edit Profile info': 'fa-user-pen', 
 'Edit Avatar Settings': 'fa-image', 
 'Edit Signature': 'fa-signature', 
 'My album': 'fa-images', 
 'Forum Settings': 'fa-sliders-h', 
 'Email Settings and Notifications': 'fa-envelope', 
 'Change Password': 'fa-key', 
 'Log Out': 'fa-right-from-bracket', 
 
 // Messenger 
 'Messenger': 'fa-message', 
 'Send New PM': 'fa-paper-plane', 
 'Go to Inbox': 'fa-inbox', 
 'Edit Folders': 'fa-folder', 
 'Archive Messages': 'fa-box-archive', 
 'Contact List': 'fa-address-book', 
 'Notepad': 'fa-note-sticky', 
 
 // Topics 
 'Topics': 'fa-comments', 
 'Active topics': 'fa-bolt', 
 'Popular topics': 'fa-fire', 
 'Subscriptions': 'fa-bookmark', 
 'Notification centre': 'fa-bell', 
 'Mark all as read': 'fa-check-double', 
 'My topics': 'fa-file', 
 'My posts': 'fa-comment', 
 'Subscribe to the forum': 'fa-bell', 
 'Unsubscribe from this topic': 'fa-bell-slash', 
 'Newsletter': 'fa-newspaper', 
 
 // Administration sections 
 'Website': 'fa-globe', 
 'Users': 'fa-users', 
 'Graphic': 'fa-palette', 
 'Additional features': 'fa-puzzle-piece', 
 
 // Moderation 
 'Moderation': 'fa-gavel', 
 'Topics selected': 'fa-list-check', 
 'Section': 'fa-folder-open', 
 
 // Tools & Help 
 'Members': 'fa-users', 
 'Help': 'fa-circle-question', 
 'Search': 'fa-magnifying-glass', 
 'Create your forum': 'fa-plus', 
 'Create your blog': 'fa-blog', 
 'Home ForumCommunity': 'fa-house', 
 'Android App': 'fa-android', 
 'ForumCommunity Mobile': 'fa-mobile', 
 'Last posts': 'fa-clock-rotate-left', 
 'News': 'fa-newspaper', 
 'Top Forum': 'fa-trophy', 
 'Top Blog': 'fa-award', 
 'Add to bookmarks': 'fa-bookmark', 
 'set categories': 'fa-tags' 
 }; 
 
 constructor() { 
 this.#init(); 
 } 
 
 #init() { 
 if (!this.#shouldModernize()) return; 
 
 this.#originalMenu = document.querySelector('.menuwrap'); 
 if (!this.#originalMenu) { 
 // Wait for menu to load 
 setTimeout(() => this.#init(), 100); 
 return; 
 } 
 
 this.createModernMenu(); 
 this.#setupObserver(); 
 this.setupEventListeners(); 
 
 console.log('&#9989; Enhanced Menu Modernizer initialized'); 
 } 
 
 #setupObserver() { 
 if (!globalThis.forumObserver) { 
 setTimeout(() => this.#setupObserver(), 100); 
 return; 
 } 
 
 this.#observerId = globalThis.forumObserver.register({ 
 id: 'enhanced-menu-modernizer', 
 callback: (node) => this.#handleMenuUpdates(node), 
 selector: '.menuwrap, .menu em, .st-emoji-notice, a[id^="i"], a[id^="n"]', 
 priority: 'critical', 
 pageTypes: ['topic', 'forum', 'blog', 'profile', 'search', 'board'] 
 }); 
 } 
 
 #handleMenuUpdates(node) { 
 if (!node) return; 
 
 // Hide original menu if it reappears 
 if (node.matches('.menuwrap') && node.style.display !== 'none') { 
 node.style.display = 'none'; 
 } 
 
 // Update notification badges 
 if (node.matches('em') || node.querySelector('em')) { 
 this.updateNotificationBadges(); 
 } 
 
 // Update emoji reactions 
 if (node.matches('.st-emoji-notice') || node.querySelector('.st-emoji-notice')) { 
 this.updateReactionsMenu(); 
 } 
 } 
 
 #shouldModernize() { 
 if (document.body.id === 'login' || document.body.id === 'register') { 
 return false; 
 } 
 
 if (document.querySelector('.modern-menu-wrap')) { 
 return false; 
 } 
 
 return true; 
 } 
 
 createModernMenu() { 
 if (document.querySelector('.modern-menu-wrap')) return; 
 
 // Hide original menu 
 this.#originalMenu.style.display = 'none'; 
 
 // Create modern menu structure 
 const menuWrap = document.createElement('div'); 
 menuWrap.className = 'modern-menu-wrap'; 
 this.#modernMenuWrap = menuWrap; 
 
 const menu = document.createElement('nav'); 
 menu.className = 'modern-menu'; 
 
 // Extract all menu items from original 
 const leftMenus = this.#extractLeftMenus(); 
 const rightMenus = this.#extractRightMenus(); 
 
 // Build menu structure 
 menu.innerHTML = '<div class="menu-left">' + 
 leftMenus.join('') + 
 '</div>' + 
 '<div class="menu-right">' + 
 rightMenus.join('') + 
 this.#extractSearch() + 
 '</div>'; 
 
 menuWrap.appendChild(menu); 
 
 // Add mobile toggle 
 const mobileToggle = document.createElement('button'); 
 mobileToggle.className = 'mobile-menu-toggle'; 
 mobileToggle.setAttribute('aria-label', 'Open menu'); 
 mobileToggle.innerHTML = '<i class="fa-regular fa-bars" aria-hidden="true"></i>'; 
 mobileToggle.addEventListener('click', () => this.openMobileMenu()); 
 menu.appendChild(mobileToggle); 
 
 // Insert at the beginning of the Fixed container 
 const fixedContainer = document.querySelector('.Fixed'); 
 if (fixedContainer && fixedContainer.firstChild) { 
 fixedContainer.insertBefore(menuWrap, fixedContainer.firstChild); 
 } else { 
 document.body.insertBefore(menuWrap, document.body.firstChild); 
 } 
 
 // Create mobile overlay 
 this.createMobileOverlay(); 
 
 // Initial updates 
 this.updateNotificationBadges(); 
 this.updateReactionsMenu(); 
 } 
 
 #extractLeftMenus() { 
 const leftUl = this.#originalMenu.querySelector('ul.left'); 
 if (!leftUl) return []; 
 
 const menuItems = []; 
 const menus = leftUl.querySelectorAll('li.menu'); 
 
 menus.forEach((menu, index) => { 
 // Skip if already processed 
 if (this.#processedMenus.has(menu)) return; 
 this.#processedMenus.add(menu); 
 
 const menuHTML = this.#extractSingleMenu(menu, index); 
 if (menuHTML) { 
 menuItems.push(menuHTML); 
 } 
 }); 
 
 return menuItems; 
 } 
 
 #extractRightMenus() { 
 const rightUl = this.#originalMenu.querySelector('ul.right'); 
 if (!rightUl) return []; 
 
 const menuItems = []; 
 const menus = rightUl.querySelectorAll('li.menu'); 
 
 menus.forEach((menu, index) => { 
 if (this.#processedMenus.has(menu)) return; 
 this.#processedMenus.add(menu); 
 
 const menuHTML = this.#extractRightMenu(menu, index); 
 if (menuHTML) { 
 menuItems.push(menuHTML); 
 } 
 }); 
 
 return menuItems; 
 } 
 
 #extractSingleMenu(menuElement, index) { 
 const link = menuElement.querySelector('a'); 
 if (!link) return ''; 
 
 const linkText = link.textContent.trim(); 
 const linkHref = link.getAttribute('href') || '#'; 
 
 // Check for Reactions menu FIRST (st-emoji-notice class) 
 if (menuElement.classList.contains('st-emoji-notice')) { 
 return this.#extractReactionsMenu(menuElement); 
 } 
 
 // Check for Notifications menu (has id starting with "n") 
 if (link.id && link.id.startsWith('n')) { 
 return this.#extractNotificationsMenu(menuElement); 
 } 
 
 // Check for user menu 
 if (link.classList.contains('user11517378') || menuElement.querySelector('.avatar')) { 
 return this.#extractUserMenu(menuElement); 
 } 
 
 // Check for Messenger menu (has id starting with "i") 
 if (link.id && link.id.startsWith('i')) { 
 return this.#extractMessengerMenu(menuElement); 
 } 
 
 if (linkText === 'Topics' || (linkHref.includes('UserCP') && linkHref.includes('CODE=26'))) { 
 return this.#extractTopicsMenu(menuElement); 
 } 
 
 if (linkText === 'Administration' || linkHref.includes('forumcommunity.net/?cid=')) { 
 return this.#extractAdminMenu(menuElement); 
 } 
 
 if (linkText === 'Moderation' || !linkHref || linkHref === '#') { 
 return this.#extractModerationMenu(menuElement); 
 } 
 
 // Default simple menu 
 return this.#extractSimpleMenu(menuElement); 
 } 
 
 #extractUserMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const avatar = link.querySelector('.avatar img'); 
 const username = link.querySelector('.nick'); 
 const dropdownItems = menuElement.querySelectorAll('ul li a'); 
 
 const avatarSrc = avatar ? (avatar.src || avatar.getAttribute('src')) : 
 'https://img.forumfree.net/style_images/default_avatar.png'; 
 const usernameText = username ? username.textContent.trim() : 'User'; 
 
 // Build dropdown items 
 let dropdownHTML = ''; 
 let sectionCount = 0; 
 
 dropdownItems.forEach((item, index) => { 
 const text = item.textContent.trim(); 
 if (!text || text === '') return; 
 
 // First item is "Notifications from scripts" 
 if (index === 0) { 
 dropdownHTML += '<div class="dropdown-section">' + 
 '<a href="' + (item.getAttribute('href') || 'javascript:void(0)') + '" class="dropdown-item with-icon sn-open-modal">' + 
 '<i class="fa-regular fa-bell" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>' + 
 '</div>'; 
 sectionCount++; 
 } 
 // Profile settings (items 1-7) 
 else if (index >= 1 && index <= 7) { 
 if (index === 1) { 
 dropdownHTML += '<div class="dropdown-section">'; 
 } 
 
 const icon = this.#getIconForText(text); 
 dropdownHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>'; 
 
 if (index === 7) { 
 dropdownHTML += '</div>'; 
 sectionCount++; 
 } 
 } 
 // Logout (last item) 
 else if (index === dropdownItems.length - 1 && text.toLowerCase().includes('log out')) { 
 dropdownHTML += '<div class="dropdown-section">' + 
 '<form name="Logout" action="/" method="post" style="display:none">' + 
 '<input type="hidden" name="act" value="Login">' + 
 '<input type="hidden" name="CODE" value="03">' + 
 '</form>' + 
 '<button onclick="if(document.forms.Logout)document.forms.Logout.*submit()" class="dropdown-item with-icon logout">' + 
 '<i class="fa-regular fa-right-from-bracket" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</button>' + 
 '</div>'; 
 sectionCount++; 
 } 
 }); 
 
 // Extract user role 
 let userRole = 'Member'; 
 const roleElement = this.#originalMenu.querySelector('.amministratore, .moderatore, .founder'); 
 if (roleElement) { 
 userRole = roleElement.textContent.trim(); 
 } 
 
 return '<div class="menu-item user-menu">' + 
 '<button class="menu-trigger user-trigger">' + 
 '<div class="user-avatar">' + 
 '<img src="' + this.#escapeHtml(avatarSrc) + '" alt="' + this.#escapeHtml(usernameText) + '" loading="lazy">' + 
 '</div>' + 
 '<span class="username">' + this.#escapeHtml(usernameText) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown user-dropdown">' + 
 '<div class="dropdown-header">' + 
 '<div class="user-avatar large">' + 
 '<img src="' + this.#escapeHtml(avatarSrc) + '" alt="' + this.#escapeHtml(usernameText) + '" loading="lazy">' + 
 '</div>' + 
 '<div class="user-info">' + 
 '<div class="username">' + this.#escapeHtml(usernameText) + '</div>' + 
 '<div class="user-role">' + this.#escapeHtml(userRole) + '</div>' + 
 '</div>' + 
 '</div>' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractMessengerMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const em = link.querySelector('em'); 
 const count = em ? em.textContent.trim() : ''; 
 const text = link.textContent.replace(count, '').trim(); 
 
 return '<div class="menu-item">' + 
 '<a href="' + this.#escapeHtml(link.getAttribute('href') || '#') + '" class="menu-link with-icon" id="modern-messenger">' + 
 '<i class="fa-regular fa-message" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '</a>' + 
 '</div>'; 
 } 
 
 #extractTopicsMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const text = link.textContent.trim(); 
 const dropdownItems = menuElement.querySelectorAll('ul li a'); 
 
 let dropdownHTML = ''; 
 let hasDivider = false; 
 
 dropdownItems.forEach((item, index) => { 
 const itemText = item.textContent.trim(); 
 if (!itemText || itemText === '' || itemText.toLowerCase().includes('topics planned')) return; 
 
 const icon = this.#getIconForText(itemText); 
 const href = item.getAttribute('href') || '#'; 
 
 // Add divider before "Notification centre" 
 if (itemText.toLowerCase().includes('notification centre') && !hasDivider) { 
 dropdownHTML += '<div class="dropdown-divider"></div>'; 
 hasDivider = true; 
 } 
 // Add another divider before "Mark all as read" 
 else if (itemText.toLowerCase().includes('mark all as read') && hasDivider) { 
 dropdownHTML += '<div class="dropdown-divider"></div>'; 
 } 
 
 // Special handling for JavaScript actions 
 if (href.startsWith('javascript:')) { 
 const jsCode = href.substring(11); 
 dropdownHTML += '<button onclick="' + this.#escapeHtml(jsCode) + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(itemText) + '</span>' + 
 '</button>'; 
 } else { 
 dropdownHTML += '<a href="' + this.#escapeHtml(href) + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(itemText) + '</span>' + 
 '</a>'; 
 } 
 }); 
 
 return '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-comments" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractAdminMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const text = link.textContent.trim(); 
 const submenus = menuElement.querySelectorAll('.submenu'); 
 
 // Check if we have 3+ submenus for mega menu 
 if (submenus.length >= 3) { 
 const sectionTitles = ['Website', 'Users', 'Graphic']; 
 let megaColumns = ''; 
 
 submenus.forEach((submenu, index) => { 
 if (index >= 3) return; // Only take first 3 
 
 const items = submenu.querySelectorAll('ul li a'); 
 let columnHTML = '<div class="mega-column"><h4>' + sectionTitles[index] + '</h4>'; 
 
 items.forEach(item => { 
 const itemText = item.textContent.trim(); 
 if (itemText && itemText !== '') { 
 columnHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</a>'; 
 } 
 }); 
 
 columnHTML += '</div>'; 
 megaColumns += columnHTML; 
 }); 
 
 // Add Additional features if exists (4th submenu) 
 if (submenus[3] && submenus[3].classList.contains('alternative')) { 
 const additionalItems = submenus[3].querySelectorAll('ul li a'); 
 let additionalHTML = '<div class="mega-column"><h4>Additional</h4>'; 
 
 additionalItems.forEach(item => { 
 const itemText = item.textContent.trim(); 
 if (itemText && itemText !== '') { 
 additionalHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</a>'; 
 } 
 }); 
 
 additionalHTML += '</div>'; 
 megaColumns += additionalHTML; 
 } 
 
 return '<div class="menu-item">' + 
 '<button class="menu-trigger admin-trigger">' + 
 '<i class="fa-regular fa-shield-halved" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown mega-dropdown">' + 
 '<div class="mega-columns">' + 
 megaColumns + 
 '</div>' + 
 '</div>' + 
 '</div>'; 
 } 
 
 // Simple dropdown for fewer sections 
 let dropdownHTML = ''; 
 const items = menuElement.querySelectorAll('ul li a, .submenu ul li a'); 
 
 items.forEach(item => { 
 const itemText = item.textContent.trim(); 
 if (!itemText || itemText === '') return; 
 
 // Skip section headers that aren't links 
 if (!item.getAttribute('href')) { 
 dropdownHTML += '<div class="dropdown-divider"></div><strong>' + this.#escapeHtml(itemText) + '</strong>'; 
 } else { 
 dropdownHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</a>'; 
 } 
 }); 
 
 return '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-shield-halved" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractModerationMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const text = link ? link.textContent.trim() : 'Moderation'; 
 const items = menuElement.querySelectorAll('ul li a, ul li strong'); 
 
 let dropdownHTML = ''; 
 let currentSection = ''; 
 
 items.forEach(item => { 
 const itemText = item.textContent.trim(); 
 if (!itemText || itemText === '') return; 
 
 if (item.tagName === 'STRONG') { 
 if (currentSection !== '') { 
 dropdownHTML += '</div>'; 
 } 
 currentSection = itemText; 
 dropdownHTML += '<div class="dropdown-section">' + 
 '<strong>' + this.#escapeHtml(itemText) + '</strong>'; 
 } else { 
 const href = item.getAttribute('href') || '#'; 
 if (href.startsWith('javascript:')) { 
 dropdownHTML += '<button onclick="' + this.#escapeHtml(href.substring(11)) + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</button>'; 
 } else { 
 dropdownHTML += '<a href="' + this.#escapeHtml(href) + '" class="dropdown-item">' + 
 this.#escapeHtml(itemText) + 
 '</a>'; 
 } 
 } 
 }); 
 
 if (currentSection !== '') { 
 dropdownHTML += '</div>'; 
 } 
 
 return '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-gavel" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractReactionsMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const text = link ? link.textContent.trim() : 'Reactions'; 
 const counter = menuElement.querySelector('.st-emoji-notice-counter span'); 
 const count = counter ? counter.textContent.trim() : ''; 
 
 // Check if it has dropdown 
 const dropdown = menuElement.querySelector('ul'); 
 let menuHTML = ''; 
 
 if (dropdown) { 
 // Has dropdown (subscribe/unsubscribe options) 
 menuHTML = '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-face-smile" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 this.#extractReactionsDropdownHTML(menuElement) + 
 '</div>' + 
 '</div>'; 
 } else { 
 // No dropdown, just a link 
 menuHTML = '<div class="menu-item">' + 
 '<a href="javascript:void(0)" class="menu-link with-icon" data-toggle="emoji-notice-modal">' + 
 '<i class="fa-regular fa-face-smile" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '</a>' + 
 '</div>'; 
 } 
 
 return menuHTML; 
 } 
 
 #extractReactionsDropdownHTML(menuElement) { 
 const items = menuElement.querySelectorAll('ul li a'); 
 let html = ''; 
 
 items.forEach(item => { 
 const text = item.textContent.trim(); 
 if (!text || text === '') return; 
 
 const href = item.getAttribute('href') || 'javascript:void(0)'; 
 
 html += '<a href="javascript:void(0)" class="dropdown-item with-icon" data-toggle="' + 
 (text.toLowerCase().includes('unsubscribe') ? 'emoji-notice-subscription' : 'emoji-notice-modal') + 
 '" data-subscribed="' + (text.toLowerCase().includes('unsubscribe') ? 'true' : 'false') + '">' + 
 '<i class="fa-regular ' + (text.toLowerCase().includes('notification') ? 'fa-bell' : 'fa-face-smile') + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>'; 
 }); 
 
 return html; 
 } 
 
 #extractNotificationsMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 const em = link.querySelector('em'); 
 const count = em ? em.textContent.trim() : ''; 
 const text = link.textContent.replace(count, '').trim(); 
 
 // Check if it's just a link or has dropdown 
 const dropdown = menuElement.querySelector('ul'); 
 let menuHTML = ''; 
 
 if (dropdown) { 
 // Has dropdown 
 menuHTML = '<div class="menu-item">' + 
 '<button class="menu-trigger">' + 
 '<i class="fa-regular fa-bell" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 this.#extractNotificationsDropdownHTML(menuElement) + 
 '</div>' + 
 '</div>'; 
 } else { 
 // Just a link 
 menuHTML = '<div class="menu-item">' + 
 '<a href="' + this.#escapeHtml(link.getAttribute('href') || '#notifications') + '" class="menu-link with-icon">' + 
 '<i class="fa-regular fa-bell" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '</a>' + 
 '</div>'; 
 } 
 
 return menuHTML; 
 } 
 
 #extractNotificationsDropdownHTML(menuElement) { 
 const items = menuElement.querySelectorAll('ul li a'); 
 let html = ''; 
 
 items.forEach(item => { 
 const text = item.textContent.trim(); 
 if (!text || text === '') return; 
 
 html += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular fa-bell" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>'; 
 }); 
 
 return html; 
 } 
 
 #extractRightMenu(menuElement, index) { 
 const link = menuElement.querySelector('a'); 
 const iconSpan = link ? link.querySelector('span[style*="background"]') : null; 
 
 if (!link || !iconSpan) { 
 return this.#extractSimpleMenu(menuElement); 
 } 
 
 // Check which icon menu this is based on background image 
 const bgImage = iconSpan.style.backgroundImage || ''; 
 let iconClass = 'fa-gear'; // default 
 
 if (bgImage.includes('fc-icon.png')) { 
 iconClass = 'fa-gear'; 
 } else if (bgImage.includes('icon_rss.png')) { 
 iconClass = 'fa-rss'; 
 } else if (bgImage.includes('icon_members.png')) { 
 iconClass = 'fa-users'; 
 } else if (bgImage.includes('icon_help.png')) { 
 iconClass = 'fa-circle-question'; 
 } 
 
 const dropdownItems = menuElement.querySelectorAll('ul li a'); 
 let dropdownHTML = ''; 
 
 dropdownItems.forEach((item, itemIndex) => { 
 const itemText = item.textContent.trim(); 
 if (!itemText || itemText === '') return; 
 
 // Add dividers at specific positions 
 if (itemIndex === 0 || itemIndex === 3 || itemIndex === 6 || itemIndex === 10) { 
 dropdownHTML += '<div class="dropdown-divider"></div>'; 
 } 
 
 // Special handling for form items 
 if (item.querySelector('form')) { 
 const form = item.querySelector('form'); 
 dropdownHTML += '<form action="' + this.#escapeHtml(form.getAttribute('action') || '#') + 
 '" method="' + this.#escapeHtml(form.getAttribute('method') || 'post') + 
 '" class="dropdown-item with-icon">' + 
 form.innerHTML + 
 '<i class="fa-regular ' + this.#getIconForText(itemText) + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(itemText) + '</span>' + 
 '</form>'; 
 } else { 
 dropdownHTML += '<a href="' + this.#escapeHtml(item.getAttribute('href') || '#') + '" class="dropdown-item with-icon">' + 
 '<i class="fa-regular ' + this.#getIconForText(itemText) + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(itemText) + '</span>' + 
 '</a>'; 
 } 
 }); 
 
 return '<div class="menu-item icon-menu">' + 
 '<button class="menu-trigger icon-trigger">' + 
 '<i class="fa-regular ' + iconClass + '" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="menu-dropdown">' + 
 dropdownHTML + 
 '</div>' + 
 '</div>'; 
 } 
 
 #extractSimpleMenu(menuElement) { 
 const link = menuElement.querySelector('a'); 
 if (!link) return ''; 
 
 const text = link.textContent.trim(); 
 const href = link.getAttribute('href') || '#'; 
 const icon = this.#getIconForText(text); 
 
 return '<div class="menu-item">' + 
 '<a href="' + this.#escapeHtml(href) + '" class="menu-link with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>' + 
 '</div>'; 
 } 
 
 #extractSearch() { 
 const searchForm = this.#originalMenu.querySelector('form[name="search"]'); 
 if (!searchForm) return ''; 
 
 const searchInput = searchForm.querySelector('input[name="q"]'); 
 const siteSearch = searchForm.querySelector('input[name="as_sitesearch"]'); 
 
 const placeholder = searchInput ? (searchInput.value === 'Search' ? 'Search...' : searchInput.value) : 'Search...'; 
 const siteValue = siteSearch ? siteSearch.value : window.location.hostname; 
 
 return '<div class="menu-item search-item">' + 
 '<form class="modern-search" name="search" action="' + this.#escapeHtml(searchForm.getAttribute('action')) + 
 '" method="' + this.#escapeHtml(searchForm.getAttribute('method') || 'get') + '">' + 
 '<div class="search-container">' + 
 '<i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>' + 
 '<input type="text" name="q" placeholder="' + this.#escapeHtml(placeholder) + '" class="search-input" value="">' + 
 '<input type="hidden" name="as_sitesearch" value="' + this.#escapeHtml(siteValue) + '">' + 
 '</div>' + 
 '</form>' + 
 '</div>'; 
 } 
 
 #getIconForText(text) { 
 // Check exact matches first 
 for (const [key, icon] of Object.entries(this.#iconMappings)) { 
 if (text === key) { 
 return icon; 
 } 
 } 
 
 // Check partial matches 
 const lowerText = text.toLowerCase(); 
 for (const [key, icon] of Object.entries(this.#iconMappings)) { 
 if (lowerText.includes(key.toLowerCase())) { 
 return icon; 
 } 
 } 
 
 // Fallback based on common patterns 
 if (lowerText.includes('edit') || lowerText.includes('profile')) return 'fa-user-pen'; 
 if (lowerText.includes('avatar')) return 'fa-image'; 
 if (lowerText.includes('signature')) return 'fa-signature'; 
 if (lowerText.includes('setting')) return 'fa-sliders-h'; 
 if (lowerText.includes('email')) return 'fa-envelope'; 
 if (lowerText.includes('password')) return 'fa-key'; 
 if (lowerText.includes('logout')) return 'fa-right-from-bracket'; 
 if (lowerText.includes('message')) return 'fa-message'; 
 if (lowerText.includes('topic')) return 'fa-comments'; 
 if (lowerText.includes('active')) return 'fa-bolt'; 
 if (lowerText.includes('popular')) return 'fa-fire'; 
 if (lowerText.includes('subscription')) return 'fa-bookmark'; 
 if (lowerText.includes('notification')) return 'fa-bell'; 
 if (lowerText.includes('read')) return 'fa-check-double'; 
 if (lowerText.includes('post')) return 'fa-comment'; 
 if (lowerText.includes('admin')) return 'fa-shield-halved'; 
 if (lowerText.includes('website')) return 'fa-globe'; 
 if (lowerText.includes('user')) return 'fa-users'; 
 if (lowerText.includes('graphic')) return 'fa-palette'; 
 if (lowerText.includes('moderation')) return 'fa-gavel'; 
 if (lowerText.includes('search')) return 'fa-magnifying-glass'; 
 if (lowerText.includes('create')) return 'fa-plus'; 
 if (lowerText.includes('home')) return 'fa-house'; 
 if (lowerText.includes('android')) return 'fa-android'; 
 if (lowerText.includes('mobile')) return 'fa-mobile'; 
 if (lowerText.includes('clock') || lowerText.includes('last')) return 'fa-clock-rotate-left'; 
 if (lowerText.includes('news')) return 'fa-newspaper'; 
 if (lowerText.includes('top')) return 'fa-trophy'; 
 if (lowerText.includes('blog')) return 'fa-blog'; 
 if (lowerText.includes('member')) return 'fa-users'; 
 if (lowerText.includes('help')) return 'fa-circle-question'; 
 if (lowerText.includes('rss')) return 'fa-rss'; 
 if (lowerText.includes('feed')) return 'fa-rss'; 
 
 return 'fa-circle'; 
 } 
 
 createMobileOverlay() { 
 const overlay = document.createElement('div'); 
 overlay.className = 'mobile-menu-overlay'; 
 
 const container = document.createElement('div'); 
 container.className = 'mobile-menu-container'; 
 
 // Build mobile menu from original structure 
 container.innerHTML = this.#buildMobileMenuHTML(); 
 
 overlay.appendChild(container); 
 document.body.appendChild(overlay); 
 
 // Setup mobile menu interactions 
 this.#setupMobileMenuInteractions(overlay, container); 
 } 
 
 #buildMobileMenuHTML() { 
 const leftUl = this.#originalMenu.querySelector('ul.left'); 
 const rightUl = this.#originalMenu.querySelector('ul.right'); 
 
 let html = '<div class="mobile-menu-header">' + 
 '<h3>Menu</h3>' + 
 '<button class="mobile-menu-close">' + 
 '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' + 
 '</button>' + 
 '</div>'; 
 
 // User info section 
 const userMenu = leftUl ? leftUl.querySelector('.menu:first-child') : null; 
 if (userMenu) { 
 const link = userMenu.querySelector('a'); 
 const avatar = link ? link.querySelector('.avatar img') : null; 
 const username = link ? link.querySelector('.nick') : null; 
 
 const avatarSrc = avatar ? (avatar.src || avatar.getAttribute('src')) : 
 'https://img.forumfree.net/style_images/default_avatar.png'; 
 const usernameText = username ? username.textContent.trim() : 'User'; 
 
 html += '<div class="mobile-user-info">' + 
 '<div class="user-avatar large">' + 
 '<img src="' + this.#escapeHtml(avatarSrc) + '" alt="' + this.#escapeHtml(usernameText) + '" loading="lazy">' + 
 '</div>' + 
 '<div class="user-info">' + 
 '<div class="username">' + this.#escapeHtml(usernameText) + '</div>' + 
 '<div class="user-role">Member</div>' + 
 '</div>' + 
 '</div>'; 
 } 
 
 // Search 
 const searchForm = this.#originalMenu.querySelector('form[name="search"]'); 
 if (searchForm) { 
 const searchInput = searchForm.querySelector('input[name="q"]'); 
 const siteSearch = searchForm.querySelector('input[name="as_sitesearch"]'); 
 
 const placeholder = searchInput ? (searchInput.value === 'Search' ? 'Search...' : searchInput.value) : 'Search...'; 
 const siteValue = siteSearch ? siteSearch.value : window.location.hostname; 
 
 html += '<div class="mobile-search">' + 
 '<form class="modern-search" name="search" action="' + this.#escapeHtml(searchForm.getAttribute('action')) + 
 '" method="' + this.#escapeHtml(searchForm.getAttribute('method') || 'get') + '">' + 
 '<div class="search-container">' + 
 '<i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>' + 
 '<input type="text" name="q" placeholder="' + this.#escapeHtml(placeholder) + '" class="search-input">' + 
 '<input type="hidden" name="as_sitesearch" value="' + this.#escapeHtml(siteValue) + '">' + 
 '</div>' + 
 '</form>' + 
 '</div>'; 
 } 
 
 // Menu content 
 html += '<div class="mobile-menu-content">'; 
 
 // Extract left menu items 
 if (leftUl) { 
 const menus = leftUl.querySelectorAll('li.menu'); 
 menus.forEach((menu, index) => { 
 const link = menu.querySelector('a'); 
 if (!link) return; 
 
 const text = link.textContent.trim(); 
 const href = link.getAttribute('href') || '#'; 
 
 // Special handling for each menu type 
 let icon = 'fa-circle'; 
 let hasDropdown = menu.querySelector('ul') !== null; 
 let dropdownId = 'mobile-dropdown-' + index; 
 
 // Determine icon and special handling 
 if (menu.classList.contains('st-emoji-notice')) { 
 icon = 'fa-face-smile'; 
 } else if (link.id && link.id.startsWith('n')) { 
 icon = 'fa-bell'; 
 } else if (link.id && link.id.startsWith('i')) { 
 icon = 'fa-message'; 
 } else if (menu.querySelector('.avatar')) { 
 icon = 'fa-user'; 
 } else if (text === 'Topics') { 
 icon = 'fa-comments'; 
 } else if (text === 'Administration') { 
 icon = 'fa-shield-halved'; 
 } else if (text === 'Moderation') { 
 icon = 'fa-gavel'; 
 } 
 
 // Check for notification count 
 let count = ''; 
 if (link.id && link.id.startsWith('i')) { 
 const em = link.querySelector('em'); 
 count = em ? em.textContent.trim() : ''; 
 } else if (link.id && link.id.startsWith('n')) { 
 const em = link.querySelector('em'); 
 count = em ? em.textContent.trim() : ''; 
 } else if (menu.classList.contains('st-emoji-notice')) { 
 const counter = menu.querySelector('.st-emoji-notice-counter span'); 
 count = counter ? counter.textContent.trim() : ''; 
 } 
 
 if (hasDropdown) { 
 html += '<div class="mobile-menu-item">' + 
 '<button class="mobile-menu-trigger" data-dropdown="' + dropdownId + '">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="mobile-dropdown" id="' + dropdownId + '">' + 
 this.#extractMobileDropdownHTML(menu) + 
 '</div>' + 
 '</div>'; 
 } else { 
 html += '<div class="mobile-menu-item">' + 
 '<a href="' + this.#escapeHtml(href) + '" class="mobile-menu-link with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 (count && count !== '0' ? '<span class="notification-badge">' + count + '</span>' : '') + 
 '</a>' + 
 '</div>'; 
 } 
 }); 
 } 
 
 // Extract right menu items (icon menus) 
 if (rightUl) { 
 const menus = rightUl.querySelectorAll('li.menu'); 
 menus.forEach((menu, index) => { 
 const link = menu.querySelector('a'); 
 if (!link) return; 
 
 const text = link.textContent.trim(); 
 const iconSpan = link.querySelector('span[style*="background"]'); 
 let iconClass = 'fa-gear'; 
 
 if (iconSpan) { 
 const bgImage = iconSpan.style.backgroundImage || ''; 
 if (bgImage.includes('fc-icon.png')) iconClass = 'fa-gear'; 
 else if (bgImage.includes('icon_rss.png')) iconClass = 'fa-rss'; 
 else if (bgImage.includes('icon_members.png')) iconClass = 'fa-users'; 
 else if (bgImage.includes('icon_help.png')) iconClass = 'fa-circle-question'; 
 } 
 
 const dropdownId = 'mobile-dropdown-right-' + index; 
 const hasDropdown = menu.querySelector('ul') !== null; 
 
 if (hasDropdown) { 
 html += '<div class="mobile-menu-item">' + 
 '<button class="mobile-menu-trigger" data-dropdown="' + dropdownId + '">' + 
 '<i class="fa-regular ' + iconClass + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text || 'Tools') + '</span>' + 
 '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' + 
 '</button>' + 
 '<div class="mobile-dropdown" id="' + dropdownId + '">' + 
 this.#extractMobileDropdownHTML(menu) + 
 '</div>' + 
 '</div>'; 
 } else { 
 html += '<div class="mobile-menu-item">' + 
 '<a href="' + this.#escapeHtml(link.getAttribute('href') || '#') + '" class="mobile-menu-link with-icon">' + 
 '<i class="fa-regular ' + iconClass + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text || 'Tools') + '</span>' + 
 '</a>' + 
 '</div>'; 
 } 
 }); 
 } 
 
 html += '</div>'; 
 return html; 
 } 
 
 #extractMobileDropdownHTML(menuElement) { 
 const items = menuElement.querySelectorAll('ul li a'); 
 let html = ''; 
 
 items.forEach(item => { 
 const text = item.textContent.trim(); 
 if (!text || text === '') return; 
 
 const href = item.getAttribute('href') || '#'; 
 const icon = this.#getIconForText(text); 
 
 if (href.startsWith('javascript:')) { 
 html += '<button onclick="' + this.#escapeHtml(href.substring(11)) + '" class="mobile-dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</button>'; 
 } else { 
 html += '<a href="' + this.#escapeHtml(href) + '" class="mobile-dropdown-item with-icon">' + 
 '<i class="fa-regular ' + icon + '" aria-hidden="true"></i>' + 
 '<span>' + this.#escapeHtml(text) + '</span>' + 
 '</a>'; 
 } 
 }); 
 
 return html; 
 } 
 
 #setupMobileMenuInteractions(overlay, container) { 
 // Close on overlay click 
 overlay.addEventListener('click', (e) => { 
 if (e.target === overlay) { 
 this.closeMobileMenu(); 
 } 
 }); 
 
 // Close button 
 const closeBtn = container.querySelector('.mobile-menu-close'); 
 if (closeBtn) { 
 closeBtn.addEventListener('click', () => this.closeMobileMenu()); 
 } 
 
 // Mobile dropdown toggles 
 container.querySelectorAll('.mobile-menu-trigger').forEach(trigger => { 
 trigger.addEventListener('click', () => { 
 const dropdownId = trigger.getAttribute('data-dropdown'); 
 const dropdown = document.getElementById(dropdownId); 
 const isActive = trigger.classList.contains('active'); 
 
 // Close all other dropdowns 
 container.querySelectorAll('.mobile-dropdown').forEach(d => { 
 d.classList.remove('active'); 
 }); 
 container.querySelectorAll('.mobile-menu-trigger').forEach(t => { 
 t.classList.remove('active'); 
 }); 
 
 // Toggle current 
 if (!isActive && dropdown) { 
 trigger.classList.add('active'); 
 dropdown.classList.add('active'); 
 } 
 }); 
 }); 
 } 
 
 updateNotificationBadges() { 
 if (!this.#originalMenu) return; 
 
 // Messenger notifications 
 const messengerLink = this.#originalMenu.querySelector('a[id^="i"]'); 
 if (messengerLink) { 
 const messengerEm = messengerLink.querySelector('em'); 
 if (messengerEm) { 
 const count = messengerEm.textContent.trim(); 
 let badge = document.querySelector('.menu-link#modern-messenger .notification-badge'); 
 
 if (!badge && count && count !== '0') { 
 badge = document.createElement('span'); 
 badge.className = 'notification-badge'; 
 const messengerElement = document.querySelector('.menu-link#modern-messenger'); 
 if (messengerElement) { 
 messengerElement.appendChild(badge); 
 } 
 } 
 
 if (badge) { 
 badge.textContent = count; 
 badge.style.display = count && count !== '0' ? 'flex' : 'none'; 
 } 
 } 
 } 
 
 // Update mobile menu badges too 
 const mobileMessenger = document.querySelector('.mobile-menu-link[href*="Msg"]'); 
 if (mobileMessenger && messengerLink) { 
 const messengerEm = messengerLink.querySelector('em'); 
 if (messengerEm) { 
 const count = messengerEm.textContent.trim(); 
 let mobileBadge = mobileMessenger.querySelector('.notification-badge'); 
 
 if (!mobileBadge && count && count !== '0') { 
 mobileBadge = document.createElement('span'); 
 mobileBadge.className = 'notification-badge'; 
 mobileMessenger.appendChild(mobileBadge); 
 } 
 
 if (mobileBadge) { 
 mobileBadge.textContent = count; 
 mobileBadge.style.display = count && count !== '0' ? 'flex' : 'none'; 
 } 
 } 
 } 
 } 
 
 updateReactionsMenu() { 
 const emojiNotice = document.querySelector('.st-emoji-notice'); 
 if (!emojiNotice) return; 
 
 const counter = emojiNotice.querySelector('.st-emoji-notice-counter span'); 
 const count = counter ? counter.textContent.trim() : ''; 
 
 // Update reactions badge in modern menu 
 const reactionsLink = document.querySelector('.menu-link[data-toggle="emoji-notice-modal"]'); 
 if (reactionsLink) { 
 let badge = reactionsLink.querySelector('.notification-badge'); 
 
 if (!badge && count && count !== '0') { 
 badge = document.createElement('span'); 
 badge.className = 'notification-badge'; 
 reactionsLink.appendChild(badge); 
 } 
 
 if (badge) { 
 badge.textContent = count; 
 badge.style.display = count && count !== '0' ? 'flex' : 'none'; 
 } 
 } 
 } 
 
 setupEventListeners() { 
 // Close dropdowns when clicking outside 
 document.addEventListener('click', (e) => { 
 if (!e.target.closest('.menu-item')) { 
 document.querySelectorAll('.menu-dropdown').forEach(dropdown => { 
 dropdown.style.opacity = '0'; 
 dropdown.style.visibility = 'hidden'; 
 }); 
 } 
 }); 
 
 // Escape key to close mobile menu 
 document.addEventListener('keydown', (e) => { 
 if (e.key === 'Escape' && this.#mobileState) { 
 this.closeMobileMenu(); 
 } 
 }); 
 
 // Close mobile menu on resize to desktop 
 window.addEventListener('resize', () => { 
 if (window.innerWidth > 768 && this.#mobileState) { 
 this.closeMobileMenu(); 
 } 
 }); 
 } 
 
 openMobileMenu() { 
 this.#mobileState = true; 
 const overlay = document.querySelector('.mobile-menu-overlay'); 
 if (overlay) { 
 overlay.classList.add('active'); 
 } 
 document.body.style.overflow = 'hidden'; 
 } 
 
 closeMobileMenu() { 
 this.#mobileState = false; 
 const overlay = document.querySelector('.mobile-menu-overlay'); 
 if (overlay) { 
 overlay.classList.remove('active'); 
 } 
 document.body.style.overflow = ''; 
 
 // Close all mobile dropdowns 
 document.querySelectorAll('.mobile-dropdown').forEach(d => { 
 d.classList.remove('active'); 
 }); 
 document.querySelectorAll('.mobile-menu-trigger').forEach(t => { 
 t.classList.remove('active'); 
 }); 
 } 
 
 #escapeHtml(text) { 
 if (typeof text !== 'string') return text; 
 const div = document.createElement('div'); 
 div.textContent = text; 
 return div.innerHTML; 
 } 
 
 destroy() { 
 if (this.#observerId && globalThis.forumObserver) { 
 globalThis.forumObserver.unregister(this.#observerId); 
 } 
 
 // Remove modern menu 
 if (this.#modernMenuWrap && this.#modernMenuWrap.parentNode) { 
 this.#modernMenuWrap.parentNode.removeChild(this.#modernMenuWrap); 
 } 
 
 // Remove mobile overlay 
 const overlay = document.querySelector('.mobile-menu-overlay'); 
 if (overlay && overlay.parentNode) { 
 overlay.parentNode.removeChild(overlay); 
 } 
 
 // Show original menu 
 if (this.#originalMenu) { 
 this.#originalMenu.style.display = ''; 
 } 
 
 console.log('Enhanced Menu Modernizer destroyed'); 
 } 
} 
 
// Initialize 
(function initEnhancedMenuModernizer() { 
 const init = () => { 
 try { 
 // Don't run on login/register pages 
 if (document.body.id === 'login' || document.body.id === 'register') { 
 return; 
 } 
 
 // Check if we should modernize 
 if (document.querySelector('.modern-menu-wrap')) { 
 return; 
 } 
 
 globalThis.enhancedMenuModernizer = new EnhancedMenuModernizer(); 
 
 } catch (error) { 
 console.error('Failed to create Enhanced Menu Modernizer:', error); 
 } 
 }; 
 
 if (document.readyState !== 'loading') { 
 queueMicrotask(init); 
 } else { 
 document.addEventListener('DOMContentLoaded', init); 
 } 
})(); 
 
// Cleanup on page hide 
globalThis.addEventListener('pagehide', () => { 
 if (globalThis.enhancedMenuModernizer && typeof globalThis.enhancedMenuModernizer.destroy === 'function') { 
 globalThis.enhancedMenuModernizer.destroy(); 
 } 
});

//Enhanced Profile Transformation
// User Profile Modernization Script - Complete Modernization with Observer Integration 
class ProfileModernizer { 
 #profileObserverId = null; 
 #retryCount = 0; 
 #maxRetries = 5; 
 
 constructor() { 
 this.#initWithObserver(); 
 } 
 
 #initWithObserver() { 
 if (document.body.id !== 'profile') return; 
 
 // Check if observer is available 
 if (!globalThis.forumObserver) { 
 if (this.#retryCount < this.#maxRetries) { 
 this.#retryCount++; 
 const delay = Math.min(100 * Math.pow(2, this.#retryCount - 1), 1000); 
 console.log(`Forum Observer not available, retry ${this.#retryCount}/${this.#maxRetries} in ${delay}ms`); 
 
 setTimeout(() => this.#initWithObserver(), delay); 
 return; 
 } else { 
 console.error('Profile Modernizer: Forum Observer not available after maximum retries, using fallback'); 
 this.#initWithFallback(); 
 return; 
 } 
 } 
 
 // Reset retry counter on success 
 this.#retryCount = 0; 
 
 try { 
 // Initial transformation 
 this.modernizeProfileLayout(); 
 this.setupEventListeners(); 
 
 // Register observer for dynamic changes 
 this.#profileObserverId = globalThis.forumObserver.register({ 
 id: 'profile-modernizer', 
 callback: (node) => this.#handleProfileMutations(node), 
 selector: '.profile:not([data-modernized]), .modern-profile, .profile-tab, .avatar-container, .profile-avatar', 
 priority: 'high', 
 pageTypes: ['profile'], 
 dependencies: ['body#profile'] 
 }); 
 
 console.log('&#9989; Profile Modernizer initialized with observer'); 
 } catch (error) { 
 console.error('Profile Modernizer initialization failed:', error); 
 this.#initWithFallback(); 
 } 
 } 
 
 #initWithFallback() { 
 // Fallback to DOMContentLoaded initialization 
 if (document.readyState === 'loading') { 
 document.addEventListener('DOMContentLoaded', () => { 
 this.modernizeProfileLayout(); 
 this.setupEventListeners(); 
 }); 
 } else { 
 this.modernizeProfileLayout(); 
 this.setupEventListeners(); 
 } 
 } 
 
 #handleProfileMutations(node) { 
 if (!node) return; 
 
 const needsModernization = node.matches('.profile:not([data-modernized])') || 
 node.closest('.profile:not([data-modernized])') || 
 node.matches('.profile-tab') || 
 node.closest('.profile-tab') || 
 node.matches('.avatar-container') || 
 node.matches('.profile-avatar'); 
 
 if (needsModernization) { 
 this.modernizeProfileLayout(); 
 } 
 } 
 
 init() { 
 if (document.body.id !== 'profile') return; 
 this.modernizeProfileLayout(); 
 this.setupEventListeners(); 
 } 
 
 modernizeProfileLayout() { 
 const oldProfile = document.querySelector('.profile'); 
 if (!oldProfile || oldProfile.dataset.modernized) return; 
 
 try { 
 const profileData = this.extractProfileData(oldProfile); 
 const modernProfile = this.buildModernProfile(profileData); 
 if (!modernProfile) return; 
 
 oldProfile.style.display = 'none'; 
 oldProfile.dataset.modernized = 'true'; 
 
 const parent = oldProfile.parentNode; 
 if (parent) { 
 parent.insertBefore(modernProfile, oldProfile.nextSibling); 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 extractProfileData(oldProfile) { 
 try { 
 // Extract avatar - can be img, div with icon, or any element 
 const avatarContainer = oldProfile.querySelector('.avatar'); 
 let avatarHtml = ''; 
 let avatarType = 'image'; // 'image', 'icon', or 'custom' 
 
 if (avatarContainer) { 
 // Clone the entire avatar container 
 const avatarClone = avatarContainer.cloneNode(true); 
 
 // Remove any onerror handlers that would set default image 
 const avatarImg = avatarClone.querySelector('img'); 
 if (avatarImg) { 
 avatarImg.removeAttribute('onerror'); 
 avatarType = 'image'; 
 } else if (avatarClone.querySelector('i') || avatarClone.querySelector('.default-avatar')) { 
 // Check for Font Awesome icons or our default avatar div 
 avatarType = 'icon'; 
 } 
 
 avatarHtml = avatarClone.innerHTML; 
 } 
 
 const username = oldProfile.querySelector('.nick'); 
 const status = oldProfile.querySelector('.u_status dd'); 
 
 // Extract posts link from member_posts 
 const postsLink = oldProfile.querySelector('.member_posts'); 
 
 // Extract tabs data 
 const tabs = Array.from(oldProfile.querySelectorAll('.tabs li')).map(tab => ({ 
 id: tab.id.replace('t', ''), 
 text: tab.textContent.trim(), 
 href: tab.querySelector('a')?.getAttribute('href') || '', 
 isActive: tab.classList.contains('current') 
 })); 
 
 // Extract and modernize tab content 
 const tabContents = {}; 
 tabs.forEach(tab => { 
 const contentEl = document.getElementById('tab' + tab.id); 
 if (contentEl) { 
 tabContents[tab.id] = this.modernizeTabContent(contentEl.innerHTML, tab.id); 
 } 
 }); 
 
 return { 
 avatarHtml: avatarHtml || '', 
 avatarType: avatarType, 
 username: username?.textContent || '', 
 status: status?.textContent || '', 
 statusTitle: oldProfile.querySelector('.u_status')?.getAttribute('title') || '', 
 postsUrl: postsLink?.getAttribute('href') || '', 
 postsText: postsLink?.textContent?.trim() || 'Posts', 
 tabs: tabs, 
 tabContents: tabContents 
 }; 
 } catch (error) { 
 return { 
 avatarHtml: '', 
 avatarType: 'icon', 
 username: '', 
 status: '', 
 statusTitle: '', 
 postsUrl: '', 
 postsText: 'Posts', 
 tabs: [], 
 tabContents: {} 
 }; 
 } 
 } 
 
 modernizeTabContent(content, tabId) { 
 try { 
 let modernContent = content; 
 
 // Replace all definition lists with modern grid 
 modernContent = modernContent.replace( 
 /<dl class="profile-([^"]*)">\s*<dt[^>]*>([^<]*)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>\s*<\/dl>/g, 
 '<div class="profile-field profile-$1"><div class="field-label">$2</div><div class="field-value">$3</div></div>' 
 ); 
 
 // Modernize friend avatars - KEEP existing avatars as-is 
 modernContent = modernContent.replace( 
 /<a[^>]*>\s*<img[^>]*>\s*<\/a>/g, 
 (match) => { 
 const temp = document.createElement('div'); 
 temp.innerHTML = match; 
 const link = temp.querySelector('a'); 
 const img = temp.querySelector('img'); 
 if (link && img) { 
 // Preserve the original image, remove any onerror handlers 
 const imgClone = img.cloneNode(true); 
 imgClone.removeAttribute('onerror'); 
 return '<a href="' + link.getAttribute('href') + '" class="friend-avatar" title="' + (img.getAttribute('title') || '') + '">' + 
 imgClone.outerHTML + 
 '</a>'; 
 } 
 return match; 
 } 
 ); 
 
 // Modernize interest images 
 modernContent = modernContent.replace( 
 /<a[^>]*>\s*<img[^>]*class="color_img"[^>]*>\s*<\/a>/g, 
 (match) => { 
 const temp = document.createElement('div'); 
 temp.innerHTML = match; 
 const link = temp.querySelector('a'); 
 const img = temp.querySelector('img'); 
 if (link && img) { 
 return '<a href="' + link.getAttribute('href') + '" target="_blank" class="interest-image">' + 
 '<img src="' + img.getAttribute('src') + '" alt="Interest">' + 
 '</a>'; 
 } 
 return match; 
 } 
 ); 
 
 // Modernize action buttons 
 modernContent = modernContent.replace( 
 /<div class="mini_buttons">([\s\S]*?)<\/div>/g, 
 '<div class="modern-actions">$1</div>' 
 ); 
 
 modernContent = modernContent.replace( 
 /<a[^>]*class="mini_buttons[^>]*>([\s\S]*?)<\/a>/g, 
 '<a href="$1" class="modern-btn">$2</a>' 
 ); 
 
 // Remove old table structures 
 modernContent = modernContent.replace(/<table[^>]*>|<\/table>|<tbody>|<\/tbody>|<tr>|<\/tr>|<td>|<\/td>/g, ''); 
 
 // Remove old class attributes 
 modernContent = modernContent.replace(/class="[^"]*Sub[^"]*"|class="[^"]*Item[^"]*"/g, ''); 
 
 // Modernize specific field types 
 modernContent = this.modernizeSpecificFields(modernContent, tabId); 
 
 return modernContent; 
 } catch (error) { 
 return content; 
 } 
 } 
 
 modernizeSpecificFields(content, tabId) { 
 let modernContent = content; 
 
 // Modernize member group (Administrator/Founder) 
 modernContent = modernContent.replace( 
 /<span class="amministratore founder">([^<]*)<\/span>/, 
 '<span class="user-badge admin-badge">$1</span>' 
 ); 
 
 // Modernize gender display 
 modernContent = modernContent.replace( 
 /<span class="male">([^<]*)<\/span>/, 
 '<span class="gender-badge male"><i class="fa-regular fa-mars"></i>$1</span>' 
 ); 
 
 // Modernize status indicators 
 modernContent = modernContent.replace( 
 /<span class="when">([^<]*)<\/span>/g, 
 '<span class="modern-date">$1</span>' 
 ); 
 
 // Modernize post count with icon 
 modernContent = modernContent.replace( 
 /<b>([\d,]+)<\/b>\s*<small>([^<]*)<\/small>/, 
 '<div class="stat-with-icon"><i class="fa-regular fa-comments"></i><div><span class="stat-number">$1</span><span class="stat-detail">$2</span></div></div>' 
 ); 
 
 return modernContent; 
 } 
 
 buildModernProfile(profileData) { 
 try { 
 const profileContainer = document.createElement('div'); 
 profileContainer.className = 'modern-profile'; 
 
 let html = '<div class="profile-header">' + 
 '<div class="profile-avatar-section">' + 
 '<div class="avatar-container">'; 
 
 // Add the avatar HTML as-is (could be img, div with icon, etc.) 
 if (profileData.avatarHtml) { 
 html += profileData.avatarHtml; 
 } else { 
 // Fallback: create a default avatar using our new Font Awesome icon 
 html += '<div class="default-avatar mysterious" aria-hidden="true">' + 
 '<i class="fa-solid fa-user-secret"></i>' + 
 '</div>'; 
 } 
 
 html += '</div>' + 
 '<div class="profile-basic-info">' + 
 '<h1 class="profile-username">' + this.escapeHtml(profileData.username) + '</h1>' + 
 '<div class="profile-status" title="' + this.escapeHtml(profileData.statusTitle) + '">' + 
 '<i class="fa-regular fa-circle"></i>' + 
 '<span>' + this.escapeHtml(profileData.status) + '</span>' + 
 '</div>' + 
 '</div>' + 
 '</div>' + 
 '<div class="profile-actions">' + 
 '<a href="https://msg.forumcommunity.net/?act=Msg&amp;CODE=4&amp;MID=11517378&amp;c=668113" class="btn btn-primary">' + 
 '<i class="fa-regular fa-envelope"></i>' + 
 '<span>Send Message</span>' + 
 '</a>'; 
 
 // Add posts button if URL exists 
 if (profileData.postsUrl) { 
 html += '<a href="' + this.escapeHtml(profileData.postsUrl) + '" class="btn btn-posts" rel="nofollow">' + 
 '<i class="fa-regular fa-comments"></i>' + 
 '<span>' + this.escapeHtml(profileData.postsText) + '</span>' + 
 '</a>'; 
 } 
 
 html += '</div>' + 
 '</div>'; 
 
 // Tabs navigation 
 html += '<nav class="profile-tabs">'; 
 profileData.tabs.forEach(tab => { 
 html += '<a href="' + this.escapeHtml(tab.href) + '" class="profile-tab ' + (tab.isActive ? 'active' : '') + '" data-tab="' + tab.id + '" onclick="tab(' + tab.id + ');return false">' + 
 this.escapeHtml(tab.text) + 
 '</a>'; 
 }); 
 html += '</nav>'; 
 
 // Tab content 
 html += '<div class="profile-content">'; 
 profileData.tabs.forEach(tab => { 
 if (tab.isActive && profileData.tabContents[tab.id]) { 
 html += '<div id="modern-tab' + tab.id + '" class="profile-tab-content active">' + 
 profileData.tabContents[tab.id] + 
 '</div>'; 
 } else if (profileData.tabContents[tab.id]) { 
 html += '<div id="modern-tab' + tab.id + '" class="profile-tab-content">' + 
 profileData.tabContents[tab.id] + 
 '</div>'; 
 } 
 }); 
 html += '</div>'; 
 
 profileContainer.innerHTML = html; 
 
 // Ensure profile avatar gets proper styling 
 this.enhanceProfileAvatar(profileContainer); 
 
 return profileContainer; 
 } catch (error) { 
 return null; 
 } 
 } 
 
 enhanceProfileAvatar(profileContainer) { 
 const avatarContainer = profileContainer.querySelector('.avatar-container'); 
 if (!avatarContainer) return; 
 
 // Check what type of avatar we have 
 const avatar = avatarContainer.children[0]; 
 if (!avatar) return; 
 
 // If it's an img element, ensure it has proper classes 
 if (avatar.tagName === 'IMG') { 
 avatar.classList.add('profile-avatar'); 
 
 // Add basic styling if missing 
 if (!avatar.hasAttribute('style')) { 
 avatar.style.cssText = 'border: 3px solid var(--primary-color); border-radius: 50%; object-fit: cover;'; 
 } 
 
 // Ensure dimensions 
 if (!avatar.hasAttribute('width') && !avatar.hasAttribute('height')) { 
 avatar.setAttribute('width', '80'); 
 avatar.setAttribute('height', '80'); 
 avatar.style.width = '80px'; 
 avatar.style.height = '80px'; 
 } 
 } 
 // If it's our default avatar div, ensure it has profile size 
 else if (avatar.classList.contains('default-avatar')) { 
 avatar.classList.add('profile-avatar'); 
 
 // Ensure proper sizing for profile 
 avatar.style.cssText += 'width: 80px; height: 80px; font-size: 2rem;'; 
 } 
 // If it's an icon, wrap it in our default avatar 
 else if (avatar.tagName === 'I' && avatar.className.includes('fa-')) { 
 const wrapper = document.createElement('div'); 
 wrapper.className = 'default-avatar profile-avatar mysterious'; 
 wrapper.style.cssText = 'width: 80px; height: 80px; font-size: 2rem; display: flex; align-items: center; justify-content: center;'; 
 wrapper.appendChild(avatar.cloneNode(true)); 
 avatarContainer.innerHTML = ''; 
 avatarContainer.appendChild(wrapper); 
 } 
 } 
 
 setupEventListeners() { 
 // Handle tab clicks 
 document.addEventListener('click', (e) => { 
 const tab = e.target.closest('.profile-tab'); 
 if (tab) { 
 e.preventDefault(); 
 this.switchTab(tab.dataset.tab); 
 } 
 }); 
 } 
 
 switchTab(tabId) { 
 try { 
 // Update tab active states 
 document.querySelectorAll('.profile-tab').forEach(tab => { 
 tab.classList.toggle('active', tab.dataset.tab === tabId); 
 }); 
 
 // Update tab content visibility 
 document.querySelectorAll('.profile-tab-content').forEach(content => { 
 content.classList.toggle('active', content.id === 'modern-tab' + tabId); 
 }); 
 
 // Call original tab function if it exists 
 if (typeof tab === 'function') { 
 tab(tabId); 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 escapeHtml(unsafe) { 
 if (typeof unsafe !== 'string') return unsafe; 
 try { 
 const div = document.createElement('div'); 
 div.textContent = unsafe; 
 return div.innerHTML; 
 } catch (error) { 
 return unsafe; 
 } 
 } 
 
 destroy() { 
 if (this.#profileObserverId) { 
 globalThis.forumObserver?.unregister(this.#profileObserverId); 
 this.#profileObserverId = null; 
 } 
 console.log('Profile Modernizer destroyed'); 
 } 
} 
 
// Initialize on profile pages with observer integration 
(function initProfileModernizer() { 
 const init = () => { 
 try { 
 if (document.body.id === 'profile') { 
 globalThis.profileModernizer = new ProfileModernizer(); 
 } 
 } catch (error) { 
 console.error('Failed to create Profile Modernizer:', error); 
 } 
 }; 
 
 // If already ready, initialize immediately 
 if (document.readyState !== 'loading') { 
 queueMicrotask(init); 
 } else { 
 // Start immediately even if still loading 
 init(); 
 } 
})(); 
 
// Cleanup on page hide 
globalThis.addEventListener('pagehide', () => { 
 if (globalThis.profileModernizer && typeof globalThis.profileModernizer.destroy === 'function') { 
 globalThis.profileModernizer.destroy(); 
 } 
}); 


//Enhanced Navigation Modernizer
 
// Forum Navigation Modernization Script - Fully Error-Proof with Proper Observer Integration 
class NavigationModernizer { 
 #navObserverId = null; 
 #breadcrumbObserverId = null; 
 #retryCount = 0; 
 #maxRetries = 5; 
 
 constructor() { 
 this.#initWithObserver(); 
 } 
 
 #initWithObserver() { 
 // Check if observer is available 
 if (!globalThis.forumObserver) { 
 if (this.#retryCount < this.#maxRetries) { 
 this.#retryCount++; 
 const delay = Math.min(100 * Math.pow(2, this.#retryCount - 1), 1000); 
 console.log(`Navigation Modernizer: Forum Observer not available, retry ${this.#retryCount}/${this.#maxRetries} in ${delay}ms`); 
 
 setTimeout(() => this.#initWithObserver(), delay); 
 return; 
 } else { 
 console.error('Navigation Modernizer: Forum Observer not available after maximum retries, using fallback'); 
 this.#initWithFallback(); 
 return; 
 } 
 } 
 
 // Reset retry counter on success 
 this.#retryCount = 0; 
 
 try { 
 // Always run breadcrumb (except board pages) 
 if (document.body.id !== 'board') { 
 this.modernizeBreadcrumb(); 
 
 // Watch for breadcrumb changes 
 this.#breadcrumbObserverId = globalThis.forumObserver.register({ 
 id: 'nav-breadcrumb-modernizer', 
 callback: (node) => this.#handleBreadcrumbMutations(node), 
 selector: 'ul.nav:not([data-modernized]), .modern-breadcrumb', 
 priority: 'normal', 
 pageTypes: ['forum', 'topic', 'blog', 'profile', 'search'] // All except board 
 }); 
 } 
 
 // Only run these on topic pages 
 if (document.body.id === 'topic') { 
 this.modernizeTopicTitle(); 
 this.modernizeNavigationElements(); 
 this.setupEventListeners(); 
 
 // Watch for navigation changes on topic pages 
 this.#navObserverId = globalThis.forumObserver.register({ 
 id: 'nav-modernizer', 
 callback: (node) => this.#handleNavigationMutations(node), 
 selector: 'table.mback:not([data-modernized]), .navsub:not([data-modernized]), .modern-topic-title, .modern-nav', 
 priority: 'high', 
 pageTypes: ['topic'] 
 }); 
 } 
 
 console.log('&#9989; Navigation Modernizer initialized with observer'); 
 } catch (error) { 
 console.error('Navigation Modernizer initialization failed:', error); 
 this.#initWithFallback(); 
 } 
 } 
 
 #initWithFallback() { 
 // Fallback to original initialization 
 if (document.readyState === 'loading') { 
 document.addEventListener('DOMContentLoaded', () => { 
 this.#runFallbackInitialization(); 
 }); 
 } else { 
 this.#runFallbackInitialization(); 
 } 
 } 
 
 #runFallbackInitialization() { 
 this.modernizeBreadcrumb(); 
 
 // Only run these on topic pages 
 if (document.body.id === 'topic') { 
 this.modernizeTopicTitle(); 
 this.modernizeNavigationElements(); 
 this.setupEventListeners(); 
 } 
 } 
 
 #handleBreadcrumbMutations(node) { 
 if (!node) return; 
 
 const needsUpdate = node.matches('ul.nav:not([data-modernized])') || 
 node.closest('ul.nav:not([data-modernized])') || 
 node.matches('.modern-breadcrumb') || 
 node.querySelector('ul.nav:not([data-modernized])'); 
 
 if (needsUpdate) { 
 this.modernizeBreadcrumb(); 
 } 
 } 
 
 #handleNavigationMutations(node) { 
 if (!node) return; 
 
 const needsUpdate = node.matches('table.mback:not([data-modernized])') || 
 node.closest('table.mback:not([data-modernized])') || 
 node.matches('.navsub:not([data-modernized])') || 
 node.closest('.navsub:not([data-modernized])') || 
 node.matches('.modern-topic-title') || 
 node.matches('.modern-nav') || 
 node.querySelector('table.mback:not([data-modernized])') || 
 node.querySelector('.navsub:not([data-modernized])'); 
 
 if (needsUpdate) { 
 this.modernizeTopicTitle(); 
 this.modernizeNavigationElements(); 
 } 
 } 
 
 init() { 
 // Run breadcrumb on all pages except board, run other features only on topic pages 
 this.modernizeBreadcrumb(); 
 
 // Only run these on topic pages 
 if (document.body.id === 'topic') { 
 this.modernizeTopicTitle(); 
 this.modernizeNavigationElements(); 
 this.setupEventListeners(); 
 } 
 } 
 
 modernizeBreadcrumb() { 
 // Don't run on board pages 
 if (document.body.id === 'board') return; 
 
 const oldBreadcrumb = document.querySelector('ul.nav'); 
 if (!oldBreadcrumb || oldBreadcrumb.dataset.modernized) return; 
 
 try { 
 const breadcrumbItems = Array.from(oldBreadcrumb.querySelectorAll('li')); 
 if (breadcrumbItems.length === 0) return; 
 
 const modernBreadcrumb = this.buildModernBreadcrumb(breadcrumbItems); 
 if (!modernBreadcrumb) return; 
 
 oldBreadcrumb.style.display = 'none'; 
 oldBreadcrumb.dataset.modernized = 'true'; 
 
 const parent = oldBreadcrumb.parentNode; 
 if (parent) { 
 parent.insertBefore(modernBreadcrumb, oldBreadcrumb.nextSibling); 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 buildModernBreadcrumb(breadcrumbItems) { 
 try { 
 const breadcrumbContainer = document.createElement('nav'); 
 breadcrumbContainer.className = 'modern-breadcrumb'; 
 
 let html = '<div class="breadcrumb-content">'; 
 
 breadcrumbItems.forEach((item, index) => { 
 const link = item.querySelector('a'); 
 const icon = item.querySelector('i'); 
 
 if (link) { 
 const href = link.getAttribute('href') || '#'; 
 const text = link.textContent.trim() || ''; 
 const iconHtml = icon ? icon.outerHTML : ''; 
 
 // Determine if this is the home item 
 const isHome = href === '/' || index === 0; 
 
 html += '<a href="' + this.escapeHtml(href) + '" class="breadcrumb-item ' + (isHome ? 'home' : '') + '">' + 
 iconHtml + 
 '<span class="breadcrumb-text">' + this.escapeHtml(text) + '</span>' + 
 '</a>'; 
 
 // No separator added - removed as requested 
 } 
 }); 
 
 html += '</div>'; 
 breadcrumbContainer.innerHTML = html; 
 return breadcrumbContainer; 
 } catch (error) { 
 return null; 
 } 
 } 
 
 modernizeTopicTitle() { 
 const mbackTable = document.querySelector('table.mback'); 
 if (!mbackTable || mbackTable.dataset.modernized) return; 
 
 try { 
 const titleElement = mbackTable.querySelector('.mtitle h1') || mbackTable.querySelector('.mtitle'); 
 if (!titleElement) return; 
 
 const titleText = titleElement.innerHTML || titleElement.textContent || ''; 
 const { replies, views } = this.extractTopicStats(); 
 
 const modernTitle = this.buildModernTopicTitle(titleText, replies, views); 
 if (!modernTitle) return; 
 
 mbackTable.style.display = 'none'; 
 mbackTable.dataset.modernized = 'true'; 
 
 const parent = mbackTable.parentNode; 
 if (parent) { 
 parent.insertBefore(modernTitle, mbackTable.nextSibling); 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 extractTopicStats() { 
 try { 
 const statsElement = document.querySelector('.title.bottom.Item.Justify'); 
 if (!statsElement) return { replies: 0, views: 0 }; 
 
 const text = statsElement.textContent || ''; 
 const repliesMatch = text.match(/(\d+)\s*replies?/); 
 const viewsMatch = text.match(/(\d+)\s*views?/); 
 
 return { 
 replies: repliesMatch ? parseInt(repliesMatch[1]) || 0 : 0, 
 views: viewsMatch ? parseInt(viewsMatch[1]) || 0 : 0 
 }; 
 } catch (error) { 
 return { replies: 0, views: 0 }; 
 } 
 } 
 
 buildModernTopicTitle(titleText, replies, views) { 
 try { 
 const titleContainer = document.createElement('div'); 
 titleContainer.className = 'modern-topic-title'; 
 
 titleContainer.innerHTML = 
 '<div class="topic-header">' + 
 '<div class="topic-title-content">' + 
 '<h1 class="topic-title">' + this.escapeHtml(titleText) + '</h1>' + 
 '<div class="topic-meta">' + 
 '<span class="topic-stats">' + 
 '<i class="fa-regular fa-eye"></i>' + 
 '<span>Views: ' + views + '</span>' + 
 '</span>' + 
 '<span class="topic-stats">' + 
 '<i class="fa-regular fa-comment"></i>' + 
 '<span>Replies: ' + replies + '</span>' + 
 '</span>' + 
 '</div>' + 
 '</div>' + 
 '<div class="topic-actions">' + 
 '<button class="btn btn-icon" data-action="watch" title="Watch Topic">' + 
 '<i class="fa-regular fa-bookmark"></i>' + 
 '</button>' + 
 '<button class="btn btn-icon" data-action="share-topic" title="Share Topic">' + 
 '<i class="fa-regular fa-share-nodes"></i>' + 
 '</button>' + 
 '</div>' + 
 '</div>'; 
 
 return titleContainer; 
 } catch (error) { 
 return null; 
 } 
 } 
 
 modernizeNavigationElements() { 
 try { 
 const topNav = document.querySelector('.navsub.top:not([data-modernized])'); 
 const bottomNav = document.querySelector('.navsub.bottom:not([data-modernized])'); 
 
 topNav && this.createModernNavigation(topNav, 'top'); 
 bottomNav && this.createModernNavigation(bottomNav, 'bottom'); 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 createModernNavigation(originalNav, position) { 
 try { 
 const pagesData = this.extractPagesData(originalNav); 
 const buttonsData = this.extractButtonsData(originalNav); 
 const modernNav = this.buildModernNavigation(pagesData, buttonsData, position); 
 
 if (!modernNav) return; 
 
 originalNav.style.display = 'none'; 
 originalNav.dataset.modernized = 'true'; 
 
 const parent = originalNav.parentNode; 
 if (!parent) return; 
 
 if (position === 'top') { 
 parent.insertBefore(modernNav, originalNav.nextSibling); 
 } else { 
 const replyForm = document.querySelector('.modern-reply'); 
 if (replyForm && replyForm.parentNode) { 
 replyForm.parentNode.insertBefore(modernNav, replyForm); 
 } else { 
 parent.insertBefore(modernNav, originalNav.nextSibling); 
 } 
 } 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 extractPagesData(navElement) { 
 try { 
 const jumpLink = navElement.querySelector('.jump a'); 
 const lastPostLink = navElement.querySelector('.lastpost a'); 
 const currentPage = navElement.querySelector('.current'); 
 
 // Extract all page links including their actual hrefs 
 const pageLinks = Array.from(navElement.querySelectorAll('li:not(.jump):not(.lastpost):not(.break) a')); 
 const pageData = pageLinks.map(link => ({ 
 number: parseInt(link.textContent) || 0, 
 href: link.getAttribute('href') || '' 
 })); 
 
 // Also get the current page number 
 const currentPageNumber = parseInt(currentPage?.textContent) || 1; 
 
 return { 
 pages: pageData, 
 currentPage: currentPageNumber, 
 hasJump: !!jumpLink, 
 jumpFunction: jumpLink?.getAttribute('href') || '', 
 hasLastPost: !!lastPostLink, 
 lastPostUrl: lastPostLink?.getAttribute('href') || '', 
 totalPages: pageData.length + 1 // +1 for current page 
 }; 
 } catch (error) { 
 return { 
 pages: [], 
 currentPage: 1, 
 hasJump: false, 
 jumpFunction: '', 
 hasLastPost: false, 
 lastPostUrl: '', 
 totalPages: 1 
 }; 
 } 
 } 
 
 extractButtonsData(navElement) { 
 try { 
 const replyLink = navElement.querySelector('.reply')?.closest('a'); 
 const newTopicLink = navElement.querySelector('.newpost')?.closest('a'); 
 
 // Extract forum link from bottom nav 
 const forumLink = navElement.querySelector('.current_forum'); 
 
 return { 
 replyUrl: replyLink?.getAttribute('href') || '', 
 newTopicUrl: newTopicLink?.getAttribute('href') || '', 
 forumUrl: forumLink?.getAttribute('href') || '', 
 forumText: forumLink?.textContent || '', 
 hasReply: !!replyLink, 
 hasNewTopic: !!newTopicLink, 
 hasForumLink: !!forumLink 
 }; 
 } catch (error) { 
 return { 
 replyUrl: '', 
 newTopicUrl: '', 
 forumUrl: '', 
 forumText: '', 
 hasReply: false, 
 hasNewTopic: false, 
 hasForumLink: false 
 }; 
 } 
 } 
 
 buildModernNavigation(pagesData, buttonsData, position) { 
 try { 
 const navContainer = document.createElement('div'); 
 navContainer.className = `modern-nav ${position}-nav`; 
 
 let html = '<div class="nav-content"><div class="nav-section pages-section"><div class="pagination">'; 
 
 // Page jump 
 if (pagesData.hasJump && pagesData.jumpFunction) { 
 html += '<button class="page-jump btn btn-secondary" onclick="' + this.escapeHtml(pagesData.jumpFunction) + '">' + 
 '<i class="fa-regular fa-ellipsis"></i>' + 
 '<span>' + (pagesData.totalPages || 1) + ' Pages</span>' + 
 '</button>'; 
 } 
 
 // Current page (always show as span) 
 html += '<span class="page-number current">' + pagesData.currentPage + '</span>'; 
 
 // Other page numbers with extracted hrefs 
 pagesData.pages.forEach(page => { 
 if (page.number && page.href) { 
 html += '<a href="' + this.escapeHtml(page.href) + '" class="page-number">' + page.number + '</a>'; 
 } 
 }); 
 
 // Last post link 
 if (pagesData.hasLastPost && pagesData.lastPostUrl) { 
 html += '<a href="' + this.escapeHtml(pagesData.lastPostUrl) + '" class="last-post btn btn-secondary">' + 
 '<i class="fa-regular fa-arrow-right-to-bracket"></i>' + 
 '<span>First Unread</span>' + 
 '</a>'; 
 } 
 
 html += '</div></div><div class="nav-section actions-section"><div class="action-buttons">'; 
 
 // Reply button 
 if (buttonsData.hasReply && buttonsData.replyUrl) { 
 html += '<a href="' + this.escapeHtml(buttonsData.replyUrl) + '" class="btn btn-primary reply-btn">' + 
 '<i class="fa-regular fa-reply"></i>' + 
 '<span>Reply</span>' + 
 '</a>'; 
 } 
 
 // New topic button 
 if (buttonsData.hasNewTopic && buttonsData.newTopicUrl) { 
 html += '<a href="' + this.escapeHtml(buttonsData.newTopicUrl) + '" class="btn btn-secondary new-topic-btn">' + 
 '<i class="fa-regular fa-plus"></i>' + 
 '<span>New Topic</span>' + 
 '</a>'; 
 } 
 
 // Forum link for bottom nav - use extracted text and URL 
 if (position === 'bottom' && buttonsData.hasForumLink) { 
 const forumText = buttonsData.forumText || 'Forum'; 
 html += '<a href="' + this.escapeHtml(buttonsData.forumUrl) + '" class="btn btn-icon forum-home" title="' + this.escapeHtml(forumText) + '">' + 
 '<i class="fa-regular fa-house"></i>' + 
 '</a>'; 
 } 
 
 html += '</div></div></div>'; 
 navContainer.innerHTML = html; 
 return navContainer; 
 } catch (error) { 
 return null; 
 } 
 } 
 
 setupEventListeners() { 
 document.addEventListener('click', (e) => { 
 try { 
 const watchBtn = e.target.closest('[data-action="watch"]'); 
 const shareBtn = e.target.closest('[data-action="share-topic"]'); 
 
 watchBtn && this.handleWatchTopic(); 
 shareBtn && this.handleShareTopic(); 
 } catch (error) { 
 // Silent fail 
 } 
 }); 
 } 
 
 handleWatchTopic() { 
 // Watch topic implementation - no errors possible 
 } 
 
 async handleShareTopic() { 
 try { 
 const topicUrl = window.location.href; 
 
 if (navigator.share) { 
 await navigator.share({ 
 title: document.title, 
 url: topicUrl 
 }); 
 } else if (navigator.clipboard?.writeText) { 
 await navigator.clipboard.writeText(topicUrl); 
 this.showToast('Topic link copied to clipboard!'); 
 } else { 
 prompt('Copy this topic link:', topicUrl); 
 } 
 } catch (error) { 
 if (error.name !== 'AbortError') { 
 prompt('Copy this topic link:', window.location.href); 
 } 
 } 
 } 
 
 showToast(message) { 
 try { 
 const toast = document.createElement('div'); 
 Object.assign(toast.style, { 
 position: 'fixed', 
 bottom: '20px', 
 left: '50%', 
 transform: 'translateX(-50%)', 
 background: 'var(--success-color)', 
 color: 'white', 
 padding: '12px 20px', 
 borderRadius: 'var(--radius)', 
 zIndex: '1000', 
 fontWeight: '500', 
 boxShadow: 'var(--shadow)' 
 }); 
 toast.textContent = message; 
 document.body.appendChild(toast); 
 
 setTimeout(() => { 
 try { 
 toast.remove(); 
 } catch (e) { 
 // Silent cleanup fail 
 } 
 }, 3000); 
 } catch (error) { 
 // Silent fail 
 } 
 } 
 
 escapeHtml(unsafe) { 
 if (typeof unsafe !== 'string') return unsafe; 
 try { 
 const div = document.createElement('div'); 
 div.textContent = unsafe; 
 return div.innerHTML; 
 } catch (error) { 
 return unsafe; 
 } 
 } 
 
 destroy() { 
 if (this.#navObserverId) { 
 globalThis.forumObserver?.unregister(this.#navObserverId); 
 this.#navObserverId = null; 
 } 
 if (this.#breadcrumbObserverId) { 
 globalThis.forumObserver?.unregister(this.#breadcrumbObserverId); 
 this.#breadcrumbObserverId = null; 
 } 
 console.log('Navigation Modernizer destroyed'); 
 } 
} 
 
// Initialize on all pages with observer integration 
(function initNavigationModernizer() { 
 const init = () => { 
 try { 
 // Don't run on board pages 
 if (document.body.id !== 'board') { 
 globalThis.navigationModernizer = new NavigationModernizer(); 
 } 
 } catch (error) { 
 console.error('Failed to create Navigation Modernizer:', error); 
 } 
 }; 
 
 // If already ready, initialize immediately 
 if (document.readyState !== 'loading') { 
 queueMicrotask(init); 
 } else { 
 // Start immediately even if still loading 
 init(); 
 } 
})(); 
 
// Cleanup on page hide 
globalThis.addEventListener('pagehide', () => { 
 if (globalThis.navigationModernizer && typeof globalThis.navigationModernizer.destroy === 'function') { 
 globalThis.navigationModernizer.destroy(); 
 } 
}); 


// Enhanced Post Transformation and Modernization System with CSS-First Image Fixes
// Now includes CSS-first image dimension handling, optimized DOM updates,
// enhanced accessibility, modern code blocks, robust Moment.js timestamps,
// modern attachment styling, Media Dimension Extractor integration,
// adaptive date format detection, future timestamp handling for scheduled posts,
// and modern embedded link support
class PostModernizer {
    #postModernizerId = null;
    #activeStateObserverId = null;
    #debouncedObserverId = null;
    #cleanupObserverId = null;
    #searchPostObserverId = null;
    #quoteLinkObserverId = null;
    #codeBlockObserverId = null;
    #attachmentObserverId = null;
    #embeddedLinkObserverId = null;
    #retryTimeoutId = null;
    #maxRetries = 10;
    #retryCount = 0;
    #domUpdates = new WeakMap();
    #rafPending = false;
    #timeUpdateIntervals = new Map();
    
    // NEW: Add format detection properties
    #formatPatterns = new Map(); // Stores detected patterns
    #dateFormatCache = new Map(); // Cache for parsed dates
    #formatConfidence = {
        EU: 0,
        US: 0,
        AUTO: 0
    };
    #detectedSeparator = null;
    #detectedTimeFormat = null;

    constructor() {
        this.#initWithRetry();
    }

    #initWithRetry() {
        if (this.#retryTimeoutId) {
            clearTimeout(this.#retryTimeoutId);
            this.#retryTimeoutId = null;
        }

        if (!globalThis.forumObserver) {
            if (this.#retryCount < this.#maxRetries) {
                this.#retryCount++;
                const delay = Math.min(100 * Math.pow(1.5, this.#retryCount - 1), 2000);
                console.log('Forum Observer not available, retry ' + this.#retryCount + '/' + this.#maxRetries + ' in ' + delay + 'ms');

                this.#retryTimeoutId = setTimeout(() => {
                    this.#initWithRetry();
                }, delay);
            } else {
                console.error('Failed to initialize Post Modernizer: Forum Observer not available after maximum retries');
            }
            return;
        }

        this.#retryCount = 0;
        this.#init();
    }

    #init() {
        try {
            const bodyId = document.body.id;
            
            if (bodyId === 'search') {
                // Handle search pages specially
                this.#transformSearchPostElements();
                this.#setupSearchPostObserver();
            } else {
                // Handle topic/blog/send pages
                this.#transformPostElements();
                this.#setupObserverCallbacks();
                this.#setupActiveStateObserver();
            }
            
            // These run on all page types
            this.#enhanceReputationSystem();
            this.#setupEnhancedAnchorNavigation();
            this.#enhanceQuoteLinks();
            this.#modernizeCodeBlocks();
            this.#modernizeAttachments();
            this.#modernizeEmbeddedLinks();
            this.#modernizePolls();

            console.log('✅ Post Modernizer with all optimizations initialized');
        } catch (error) {
            console.error('Post Modernizer initialization failed:', error);

            if (this.#retryCount < this.#maxRetries) {
                this.#retryCount++;
                const delay = 100 * Math.pow(2, this.#retryCount - 1);
                console.log('Initialization failed, retrying in ' + delay + 'ms...');

                setTimeout(() => {
                    this.#initWithRetry();
                }, delay);
            }
        }
    }

    // ==============================
    // EMBEDDED LINK TRANSFORMATION
    // ==============================

#modernizeEmbeddedLinks() {
    this.#processExistingEmbeddedLinks();
    this.#setupEmbeddedLinkObserver();
}

    #isInEditor(element) {
    if (!element || !element.closest) return false;
    
    // Check for TipTap/ProseMirror editor containers
    return element.closest('.ve-content') || 
           element.closest('.color.ve-content') ||
           element.closest('[contenteditable="true"]') ||
           element.closest('.ProseMirror') ||
           element.closest('.tiptap') ||
           element.closest('.editor-container') ||
           element.closest('#compose') ||
           element.closest('.composer') ||
           element.closest('.message-editor') ||
           element.closest('.reply-editor') ||
           element.closest('.new-topic-editor');
}

#processExistingEmbeddedLinks() {
    document.querySelectorAll('.ffb_embedlink').forEach(container => {
        // Skip embedded links in the editor
        if (this.#isInEditor(container)) {
            return;
        }
        
        if (container.classList.contains('embedded-link-modernized')) return;
        this.#transformEmbeddedLink(container);
        container.classList.add('embedded-link-modernized');
    });
}

#transformEmbeddedLink(container) {
    // Double-check we're not in editor
    if (this.#isInEditor(container)) {
        return;
    }
    
    if (!container || container.classList.contains('modern-embedded-link')) return;

    try {
        // Extract ALL main links, not just BBC
        const mainLinks = container.querySelectorAll('a[target="_blank"]');
        const mainLink = mainLinks.length > 0 ? mainLinks[0] : null;
        if (!mainLink) return;

        const href = mainLink.href;
        const domain = this.#extractDomain(href);
        
        // Extract title - look for the actual article title
        let title = '';
        let titleElement = null;
        
        // Method 1: Look for the second link (usually the article title)
        const allLinks = container.querySelectorAll('a[target="_blank"]');
        if (allLinks.length >= 2) {
            titleElement = allLinks[1];
            // Get text from span.post-text inside the link
            const titleSpan = titleElement.querySelector('span.post-text');
            if (titleSpan) {
                title = titleSpan.textContent.trim();
            } else {
                title = titleElement.textContent.trim();
            }
        }
        
        // Method 2: Look for text that looks like a headline
        if (!title) {
            const postTextElements = container.querySelectorAll('span.post-text');
            for (const span of postTextElements) {
                const text = span.textContent.trim();
                // Skip domain text and "Read more" text
                if (text.toLowerCase().includes(domain.toLowerCase()) || 
                    text.toLowerCase().includes('leggi altro') ||
                    text.toLowerCase().includes('read more') ||
                    text.includes('>') ||
                    text.length < 10) {
                    continue;
                }
                // This looks like an article title (longer text)
                if (text.length > 20 && text.length < 200) {
                    title = text;
                    break;
                }
            }
        }
        
        // Method 3: Extract from the original HTML structure
        if (!title) {
            // Look for text that's not the domain and not "Read more"
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            const texts = [];
            let node;
            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (text && 
                    !text.toLowerCase().includes(domain.toLowerCase()) && 
                    !text.toLowerCase().includes('leggi altro') &&
                    !text.toLowerCase().includes('read more') &&
                    !text.includes('>')) {
                    texts.push(text);
                }
            }
            
            // The first substantial text that's not a domain is likely the title
            for (const text of texts) {
                if (text.length > 20 && text.length < 200) {
                    title = text;
                    break;
                }
            }
        }
        
        // Fallback
        if (!title) {
            title = 'Article on ' + domain;
        }

        // Extract description - look for additional text after the title
        let description = '';
        if (title !== 'Article on ' + domain) {
            // Find all text nodes
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let foundTitle = false;
            let node;
            while (node = walker.nextNode()) {
                const text = node.textContent.trim();
                if (!text) continue;
                
                if (!foundTitle && (text === title || text.includes(title.substring(0, 20)))) {
                    foundTitle = true;
                    continue;
                }
                
                if (foundTitle && text && text.length > 30) {
                    description = text;
                    break;
                }
            }
        }

        // Extract main image (not the favicon)
        let imageUrl = '';
        const images = container.querySelectorAll('img');
        for (const img of images) {
            const src = img.src || '';
            // Look for any content image (not favicon)
            // Skip images that are likely favicons (small dimensions or have 'favicon' in src)
            if (src.includes('favicon') || src.includes('icon')) {
                continue;
            }
            
            // Check image dimensions if available
            const width = img.getAttribute('width') || img.naturalWidth || 0;
            const height = img.getAttribute('height') || img.naturalHeight || 0;
            
            // If dimensions suggest it's a content image (larger than favicon)
            if (width > 100 || height > 100 || 
                src.includes('news/') || 
                src.includes('media/') || 
                src.includes('wp-content/') || 
                src.includes('images/')) {
                imageUrl = src;
                break;
            }
        }
        
        // Extract favicon (small icon, usually 32x32 or smaller)
        let faviconUrl = '';
        for (const img of images) {
            const src = img.src || '';
            if (src.includes('favicon') || 
                src.includes('touch-icon') || 
                src.includes('icon') ||
                (src.includes('32x32') && src.includes('.png'))) {
                faviconUrl = src;
                break;
            }
        }

        // Fallback: Look for hidden favicon in the structure
        if (!faviconUrl) {
            const hiddenDiv = container.querySelector('div[style*="display:none"]');
            if (hiddenDiv) {
                const hiddenFavicon = hiddenDiv.querySelector('img[src*="favicon"], img[src*="icon"]');
                if (hiddenFavicon) {
                    faviconUrl = hiddenFavicon.src;
                }
            }
        }

        // Normalize domain display (lowercase without www)
        const displayDomain = domain.toLowerCase().replace('www.', '').replace('www2.', '').replace('www3.', '');

        // Create modern embedded link
        const modernEmbeddedLink = document.createElement('div');
        modernEmbeddedLink.className = 'modern-embedded-link';

        // Build HTML
        let html = '<a href="' + this.#escapeHtml(href) + '" class="embedded-link-container" target="_blank" rel="noopener noreferrer" title="' + this.#escapeHtml(title) + '">';
        
        // Left side: Image (only if we have a content image)
        if (imageUrl) {
            html += '<div class="embedded-link-image">' +
                '<img src="' + this.#escapeHtml(imageUrl) + '" alt="' + this.#escapeHtml(title) + '" loading="lazy" decoding="async">' +
                '</div>';
        }
        
        // Right side: Content
        html += '<div class="embedded-link-content">';
        
        // Domain with favicon
        html += '<div class="embedded-link-domain">';
        if (faviconUrl) {
            html += '<img src="' + this.#escapeHtml(faviconUrl) + '" alt="" class="embedded-link-favicon" loading="lazy" decoding="async" width="16" height="16">';
        }
        html += '<span>' + this.#escapeHtml(displayDomain) + '</span>' +
            '</div>';
        
        // Title
        html += '<h3 class="embedded-link-title">' + this.#escapeHtml(title) + '</h3>';
        
        // Description
        if (description) {
            html += '<p class="embedded-link-description">' + this.#escapeHtml(description) + '</p>';
        }
        
        // Read more text (in the appropriate language)
        const isItalian = domain.includes('.it') || 
                         (description && (description.toLowerCase().includes('leggi') || 
                                         description.toLowerCase().includes('italia')));
        
        const readMoreText = isItalian ? 
            'Leggi altro su ' + this.#escapeHtml(displayDomain) + ' &gt;' :
            'Read more on ' + this.#escapeHtml(displayDomain) + ' &gt;';
            
        html += '<div class="embedded-link-meta">' +
            '<span class="embedded-link-read-more">' + readMoreText + '</span>' +
            '</div>' +
            '</div></a>';

        modernEmbeddedLink.innerHTML = html;
        
        // Ensure proper image dimensions and remove inline styles that might interfere
        const imagesInLink = modernEmbeddedLink.querySelectorAll('img');
        imagesInLink.forEach(img => {
            // Remove any inline styles that might cause issues
            img.removeAttribute('style');
            
            // Set proper styles for embedded link images
            if (img.classList.contains('embedded-link-favicon')) {
                img.style.width = '16px';
                img.style.height = '16px';
                img.style.objectFit = 'contain';
                img.style.display = 'inline-block';
                img.style.verticalAlign = 'middle';
            } else {
                // Main content image - let your other scripts handle dimensions
                // Just ensure it doesn't overflow
                img.style.maxWidth = '100%';
                // REMOVED: img.style.height = 'auto' - let other scripts handle this
                img.style.objectFit = 'cover';
                
                // Ensure proper display
                img.style.display = 'block';
            }
            
            // Remove width/height attributes that might be too large
            // BUT: Keep them if your dimension scripts added them!
            // Only remove if they're clearly wrong:
            if (img.hasAttribute('width') && parseInt(img.getAttribute('width')) > 800) {
                img.removeAttribute('width');
                img.removeAttribute('height');
            }
        });
        
        // Replace the original container
        container.parentNode.replaceChild(modernEmbeddedLink, container);

        // Add event listener for tracking
        const linkElement = modernEmbeddedLink.querySelector('a');
        if (linkElement) {
            linkElement.addEventListener('click', (e) => {
                console.log('Embedded link clicked to:', href);
            });
        }

    } catch (error) {
        console.error('Error transforming embedded link:', error);
        // Keep the original if transformation fails
    }
}

#extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch {
        return 'unknown.com';
    }
}

#setupEmbeddedLinkObserver() {
    if (globalThis.forumObserver) {
        this.#embeddedLinkObserverId = globalThis.forumObserver.register({
            id: 'embedded-link-modernizer',
            callback: (node) => this.#handleNewEmbeddedLinks(node),
            selector: '.ffb_embedlink',
            priority: 'normal',
            pageTypes: ['topic', 'blog', 'send', 'search']
        });
    } else {
        setInterval(() => this.#processExistingEmbeddedLinks(), 2000);
    }
}

   #handleNewEmbeddedLinks(node) {
    // Skip if node itself is in editor
    if (this.#isInEditor(node)) return;
    
    if (node.matches('.ffb_embedlink')) {
        // Check if this specific node is in editor
        if (this.#isInEditor(node)) return;
        this.#transformEmbeddedLink(node);
    } else {
        node.querySelectorAll('.ffb_embedlink').forEach(link => {
            // Check each link individually
            if (this.#isInEditor(link)) return;
            this.#transformEmbeddedLink(link);
        });
    }
}

    // ==============================
// MODERN POLL SYSTEM
// ==============================

#modernizePolls() {
    this.#processExistingPolls();
    this.#setupPollObserver();
}

#processExistingPolls() {
    document.querySelectorAll('form#pollform .poll').forEach(pollContainer => {
        if (pollContainer.classList.contains('poll-modernized')) return;
        this.#transformPoll(pollContainer);
        pollContainer.classList.add('poll-modernized');
    });
}

#transformPoll(pollContainer) {
    const pollForm = pollContainer.closest('form#pollform');
    if (!pollForm) return;
    
    // Skip if already modernized
    if (pollContainer.classList.contains('poll-modernized')) return;
    
    try {
        const sunbar = pollContainer.querySelector('.sunbar.top.Item');
        const pollTitle = sunbar ? sunbar.textContent.trim() : 'Poll';
        
        const list = pollContainer.querySelector('ul.list');
        if (!list) return;
        
        const isVotedState = pollContainer.querySelector('input[name="delvote"]') !== null;
        const isResultsState = !isVotedState && pollContainer.querySelector('.bar') !== null;
        const isVoteState = !isVotedState && !isResultsState;
        
        // Store the original poll content for reference
        const originalPollContent = pollContainer.querySelector('.skin_tbl');
        if (!originalPollContent) return;
        
        // Clone the original form inputs
        const hiddenInputs = Array.from(pollForm.querySelectorAll('input[type="hidden"]')).map(input => {
            return {
                name: input.name,
                value: input.value
            };
        });
        
        // Store the original radio buttons for vote state
        const originalRadios = isVoteState ? 
            Array.from(pollForm.querySelectorAll('input[type="radio"]')).map(radio => ({
                id: radio.id,
                name: radio.name,
                value: radio.value
            })) : [];
        
        // Create modern poll wrapper
        const modernPoll = document.createElement('div');
        modernPoll.className = 'modern-poll';
        modernPoll.setAttribute('data-poll-state', isVotedState ? 'voted' : isResultsState ? 'results' : 'vote');
        
        // Build HTML (same as before)
        let html = '<div class="poll-header">' +
            '<div class="poll-icon">' +
            '<i class="fa-regular fa-chart-bar" aria-hidden="true"></i>' +
            '</div>' +
            '<h3 class="poll-title">' + this.#escapeHtml(pollTitle) + '</h3>' +
            '<div class="poll-stats">';
        
        if (isVotedState || isResultsState) {
            const votersText = pollContainer.querySelector('.darkbar.Item');
            if (votersText) {
                const votersMatch = votersText.textContent.match(/Voters:\s*(\d+)/);
                if (votersMatch) {
                    html += '<i class="fa-regular fa-users" aria-hidden="true"></i>' +
                        '<span>' + votersMatch[1] + ' voter' + (parseInt(votersMatch[1]) !== 1 ? 's' : '') + '</span>';
                }
            }
        }
        
        html += '</div></div>';
        html += '<div class="poll-choices">';
        
        if (isVoteState) {
            const choiceItems = list.querySelectorAll('li.Item[style*="text-align:left"]');
            choiceItems.forEach((item, index) => {
                const label = item.querySelector('label');
                const radio = item.querySelector('input[type="radio"]');
                if (!label || !radio) return;
                
                const choiceText = label.textContent.replace(/&nbsp;/g, ' ').trim();
                const choiceId = radio.id;
                const choiceValue = radio.value;
                const choiceName = radio.name;
                
                html += '<div class="poll-choice" data-choice-index="' + index + '">' +
                    '<input type="radio" class="choice-radio" id="' + this.#escapeHtml(choiceId) + '" name="' + 
                    this.#escapeHtml(choiceName) + '" value="' + this.#escapeHtml(choiceValue) + '">' +
                    '<label for="' + this.#escapeHtml(choiceId) + '" class="choice-label">' + 
                    this.#escapeHtml(choiceText) + '</label>' +
                    '</div>';
            });
        } else {
            const choiceItems = list.querySelectorAll('li:not(:first-child)');
            let maxVotes = 0;
            const choicesData = [];
            
            choiceItems.forEach(item => {
                const isMax = item.classList.contains('max');
                const leftDiv = item.querySelector('.left.Sub.Item');
                const centerDiv = item.querySelector('.center.Sub.Item');
                const rightDiv = item.querySelector('.right.Sub.Item');
                
                if (!leftDiv || !centerDiv || !rightDiv) return;
                
                const choiceText = leftDiv.textContent.replace(/\s+/g, ' ').trim();
                const choiceTextClean = choiceText.replace(/^\*+/, '').replace(/\*+$/, '').trim();
                
                const barDiv = centerDiv.querySelector('.bar div');
                const percentageSpan = centerDiv.querySelector('.bar span');
                const votesDiv = rightDiv;
                
                let percentage = 0;
                let votes = 0;
                
                if (barDiv) {
                    const widthMatch = barDiv.style.width.match(/(\d+(?:\.\d+)?)%/);
                    if (widthMatch) percentage = parseFloat(widthMatch[1]);
                }
                
                if (percentageSpan) {
                    const percentageMatch = percentageSpan.textContent.match(/(\d+(?:\.\d+)?)%/);
                    if (percentageMatch) percentage = parseFloat(percentageMatch[1]);
                }
                
                if (votesDiv) {
                    const votesText = votesDiv.textContent.replace(/[^\d.]/g, '');
                    if (votesText) votes = parseInt(votesText);
                }
                
                if (votes > maxVotes) maxVotes = votes;
                
                choicesData.push({
                    text: choiceTextClean,
                    originalText: choiceText,
                    percentage: percentage,
                    votes: votes,
                    isMax: isMax,
                    isVoted: isMax && leftDiv.querySelector('strong') !== null
                });
            });
            
            choicesData.forEach((choice, index) => {
                const isVotedChoice = isVotedState && choice.isVoted;
                
                html += '<div class="poll-choice' + (choice.isMax ? ' max' : '') + 
                    (isVotedChoice ? ' selected' : '') + '" data-choice-index="' + index + '">';
                
                if (isVotedState) {
                    html += '<input type="radio" class="choice-radio" checked disabled>';
                }
                
                html += '<span class="choice-label">' + this.#escapeHtml(choice.text);
                if (isVotedChoice) {
                    html += ' <strong>(Your vote)</strong>';
                }
                html += '</span>';
                
                html += '<div class="choice-stats">' +
                    '<div class="choice-bar">' +
                    '<div class="choice-fill" style="width: ' + choice.percentage.toFixed(2) + '%"></div>' +
                    '</div>' +
                    '<span class="choice-percentage">' + choice.percentage.toFixed(2) + '%</span>' +
                    '<span class="choice-votes">' + choice.votes + ' vote' + (choice.votes !== 1 ? 's' : '') + '</span>' +
                    '</div>';
                
                html += '</div>';
            });
        }
        
        html += '</div>';
        html += '<div class="poll-footer">';
        
        if (isVoteState) {
            html += '<p class="poll-message">Select your choice and click Vote</p>' +
                '<div class="poll-actions">' +
                '<button type="submit" name="submit" class="poll-btn" value="Vote">' +
                '<i class="fa-regular fa-check" aria-hidden="true"></i>' +
                'Vote' +
                '</button>' +
                '<button type="submit" name="nullvote" class="poll-btn secondary" value="1">' +
                '<i class="fa-regular fa-chart-bar" aria-hidden="true"></i>' +
                'View Results' +
                '</button>' +
                '</div>';
        } else if (isVotedState) {
            const darkbar = pollContainer.querySelector('.darkbar.Item');
            let votedForText = '';
            
            if (darkbar) {
                const abbr = darkbar.querySelector('abbr');
                if (abbr) {
                    const choiceNumber = abbr.textContent.trim();
                    const choiceTitle = abbr.getAttribute('title') || '';
                    votedForText = 'You voted for option <strong>' + choiceNumber + '</strong>';
                    if (choiceTitle) {
                        votedForText += ': <span class="poll-choice-name">' + this.#escapeHtml(choiceTitle) + '</span>';
                    }
                }
            }
            
// Get the original cancel button value
const originalCancelBtn = pollContainer.querySelector('input[name="delvote"]');
const cancelValue = originalCancelBtn ? originalCancelBtn.value : 'Annulla';

html += '<p class="poll-message">' + votedForText + '</p>' +
    '<div class="poll-actions">' +
    '<button type="submit" name="delvote" class="poll-btn delete" value="' + this.#escapeHtml(cancelValue) + '">' +
    '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
    'Cancel Vote' +
    '</button>' +
    '</div>';
        } else if (isResultsState) {
            const darkbar = pollContainer.querySelector('.darkbar.Item');
            let votersText = '';
            
            if (darkbar) {
                const votersMatch = darkbar.textContent.match(/Voters:\s*(\d+)/);
                if (votersMatch) {
                    votersText = votersMatch[1] + ' voter' + (parseInt(votersMatch[1]) !== 1 ? 's' : '');
                }
            }
            
            html += '<p class="poll-message">Poll results' + (votersText ? ' • ' + votersText : '') + '</p>' +
                '<div class="poll-actions">' +
                '<button type="button" class="poll-btn secondary" onclick="location.reload()">' +
                '<i class="fa-regular fa-rotate" aria-hidden="true"></i>' +
                'Refresh' +
                '</button>' +
                '</div>';
        }
        
        html += '</div>';
        
        modernPoll.innerHTML = html;
        
        // Hide the original poll content
        originalPollContent.style.display = 'none';
        
        // Insert the modern poll BEFORE the original content
        pollContainer.insertBefore(modernPoll, originalPollContent);
        
        // Mark as modernized
        pollContainer.classList.add('poll-modernized');
        
        // Add event listeners
        this.#addPollEventListeners(modernPoll, pollForm, hiddenInputs, originalRadios);
        
        // Animate percentage bars
        setTimeout(() => {
            modernPoll.querySelectorAll('.choice-fill').forEach(fill => {
                const width = fill.style.width;
                fill.style.width = '0';
                setTimeout(() => {
                    fill.style.width = width;
                }, 10);
            });
        }, 100);
        
    } catch (error) {
        console.error('Error transforming poll:', error);
    }
}

#addPollEventListeners(modernPoll, pollForm, hiddenInputs, originalRadios = []) {
    const state = modernPoll.getAttribute('data-poll-state');
    
    if (state === 'vote') {
        const choiceElements = modernPoll.querySelectorAll('.poll-choice');
        const radioInputs = modernPoll.querySelectorAll('.choice-radio');
        
        choiceElements.forEach(choice => {
            choice.addEventListener('click', (e) => {
                if (e.target.type === 'radio' || e.target.tagName === 'LABEL') return;
                
                const radio = choice.querySelector('.choice-radio');
                if (radio) {
                    radio.checked = true;
                    choiceElements.forEach(c => c.classList.remove('selected'));
                    choice.classList.add('selected');
                }
            });
        });
        
        radioInputs.forEach(radio => {
            radio.addEventListener('change', (e) => {
                choiceElements.forEach(c => c.classList.remove('selected'));
                const selectedChoice = e.target.closest('.poll-choice');
                if (selectedChoice) {
                    selectedChoice.classList.add('selected');
                }
            });
        });
    }
    
    const submitButtons = modernPoll.querySelectorAll('button[type="submit"], button.poll-btn[value]');
    submitButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            
            if (state === 'vote') {
                const selectedRadio = modernPoll.querySelector('.choice-radio:checked');
                if (!selectedRadio && button.name === 'submit') {
                    this.#showPollNotification('Please select a choice before voting', 'warning');
                    return;
                }
                
                // Find and check the corresponding original radio button
                if (selectedRadio) {
                    const originalRadio = pollForm.querySelector('input[type="radio"][value="' + selectedRadio.value + '"]');
                    if (originalRadio) {
                        originalRadio.checked = true;
                    }
                }
            }
            
            const inputName = button.getAttribute('name');
            const inputValue = button.getAttribute('value');
            
            if (inputName && inputValue) {
                let existingInput = pollForm.querySelector('input[name="' + inputName + '"]');
                
                if (!existingInput) {
                    existingInput = document.createElement('input');
                    existingInput.type = 'hidden';
                    existingInput.name = inputName;
                    pollForm.appendChild(existingInput);
                }
                
                existingInput.value = inputValue;
            }
            
            // Add hidden inputs
            hiddenInputs.forEach(hidden => {
                let existingHidden = pollForm.querySelector('input[name="' + hidden.name + '"]');
                if (!existingHidden) {
                    existingHidden = document.createElement('input');
                    existingHidden.type = 'hidden';
                    existingHidden.name = hidden.name;
                    existingHidden.value = hidden.value;
                    pollForm.appendChild(existingHidden);
                }
            });
            
            // Submit the form
            pollForm.submit();
        });
    });
    
    const refreshButton = modernPoll.querySelector('button[onclick*="location.reload"]');
    if (refreshButton) {
        refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            location.reload();
        });
    }
}

#showPollNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = 'poll-notification ' + type;
    notification.textContent = message;
    
    notification.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;background:' + 
        (type === 'warning' ? 'var(--warning-color)' : 'var(--primary-color)') + 
        ';color:white;border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:9999;' +
        'font-weight:500;display:flex;align-items:center;gap:8px;transform:translateX(calc(100% + 20px));' +
        'opacity:0;transition:transform 0.3s ease-out,opacity 0.3s ease-out;pointer-events:none;';
    
    const icon = document.createElement('i');
    icon.className = type === 'warning' ? 'fa-regular fa-exclamation-triangle' : 'fa-regular fa-info-circle';
    icon.setAttribute('aria-hidden', 'true');
    notification.prepend(icon);
    
    document.body.appendChild(notification);
    
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';
        });
    });
    
    setTimeout(() => {
        notification.style.transform = 'translateX(calc(100% + 20px))';
        notification.style.opacity = '0';
        
        notification.addEventListener('transitionend', () => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, { once: true });
    }, 3000);
}

#setupPollObserver() {
    if (globalThis.forumObserver) {
        const pollObserverId = globalThis.forumObserver.register({
            id: 'poll-modernizer',
            callback: (node) => this.#handleNewPolls(node),
            selector: 'form#pollform .poll:not(.poll-modernized)',
            priority: 'normal',
            pageTypes: ['topic', 'blog', 'send']
        });
    } else {
        setInterval(() => {
            document.querySelectorAll('form#pollform .poll:not(.poll-modernized)').forEach(poll => {
                this.#transformPoll(poll);
            });
        }, 2000);
    }
}

#handleNewPolls(node) {
    if (node.matches('form#pollform .poll:not(.poll-modernized)')) {
        this.#transformPoll(node);
    } else {
        node.querySelectorAll('form#pollform .poll:not(.poll-modernized)').forEach(poll => {
            this.#transformPoll(poll);
        });
    }
}
    
    // ==============================
    // ADAPTIVE DATE PARSING SYSTEM - ENHANCED FOR MIXED FORMATS
    // ==============================

    #analyzeDateComponents(dateString) {
        const components = {
            hasAMPM: /[AP]M/i.test(dateString),
            has24Hour: /\d{1,2}:\d{2}(?::\d{2})?(?!\s*[AP]M)/i.test(dateString),
            separator: null,
            parts: []
        };
        
        const dateMatch = dateString.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
        if (dateMatch) {
            components.parts = [parseInt(dateMatch[1]), parseInt(dateMatch[2]), parseInt(dateMatch[3])];
            
            const separatorMatch = dateString.match(/\d{1,2}([\/\-\.])\d{1,2}/);
            components.separator = separatorMatch ? separatorMatch[1] : '/';
            
            const [first, second] = components.parts;
            
            if (first > 12 && second <= 12) {
                components.likelyFormat = 'EU';
                components.confidence = 'high';
                components.reason = 'First number > 12, second ≤ 12';
            } else if (first <= 12 && second > 12) {
                components.likelyFormat = 'US';
                components.confidence = 'high';
                components.reason = 'First number ≤ 12, second > 12';
            } else if (first <= 12 && second <= 12) {
                components.likelyFormat = 'ambiguous';
                components.confidence = 'low';
                components.reason = 'Both numbers ≤ 12, ambiguous';
                
                if (components.has24Hour && !components.hasAMPM) {
                    components.likelyFormat = 'EU';
                    components.confidence = 'medium';
                    components.reason = '24-hour format suggests European';
                }
            } else if (first > 12 && second > 12) {
                components.likelyFormat = 'unknown';
                components.confidence = 'low';
                components.reason = 'Both numbers > 12, invalid';
            } else {
                components.likelyFormat = 'unknown';
                components.confidence = 'low';
                components.reason = 'Unknown pattern';
            }
        }
        
        return components;
    }
    
    #learnFormat(components, successfulFormat) {
        const patternKey = components.separator + '|' + (components.hasAMPM ? '12h' : '24h') + '|' + successfulFormat;
        this.#formatPatterns.set(patternKey, (this.#formatPatterns.get(patternKey) || 0) + 1);
        
        if (successfulFormat === 'EU') {
            this.#formatConfidence.EU++;
        } else if (successfulFormat === 'US') {
            this.#formatConfidence.US++;
        }
        
        if (components.separator) {
            const separatorCount = this.#formatPatterns.get('separator|' + components.separator) || 0;
            this.#formatPatterns.set('separator|' + components.separator, separatorCount + 1);
            
            if (separatorCount > 2) {
                this.#detectedSeparator = components.separator;
            }
        }
        
        const timeFormatKey = components.hasAMPM ? '12h' : '24h';
        const timeFormatCount = this.#formatPatterns.get('timeformat|' + timeFormatKey) || 0;
        this.#formatPatterns.set('timeformat|' + timeFormatKey, timeFormatCount + 1);
        
        if (timeFormatCount > 2) {
            this.#detectedTimeFormat = timeFormatKey;
        }
    }
    
    #getBestFormatForComponents(components) {
        const patternKey = components.separator + '|' + (components.hasAMPM ? '12h' : '24h') + '|';
        
        let bestFormat = null;
        let bestCount = 0;
        
        for (const [key, count] of this.#formatPatterns.entries()) {
            if (key.startsWith(patternKey) && count > bestCount) {
                const format = key.split('|')[2];
                bestFormat = format;
                bestCount = count;
            }
        }
        
        if (this.#formatConfidence.EU > 10 && this.#formatConfidence.EU > this.#formatConfidence.US * 2) {
            bestFormat = 'EU';
        } else if (this.#formatConfidence.US > 10 && this.#formatConfidence.US > this.#formatConfidence.EU * 2) {
            bestFormat = 'US';
        }
        
        if (!bestFormat && components.likelyFormat === 'EU') {
            bestFormat = 'EU';
        } else if (!bestFormat && components.likelyFormat === 'US') {
            bestFormat = 'US';
        }
        
        return bestFormat;
    }

    #buildFormatArray(preference, components) {
        const formats = [];
        const separator = components.separator || '/';
        const timeFormat = components.hasAMPM ? 'h:mm A' : 'HH:mm';
        const timeFormatWithSeconds = components.hasAMPM ? 'h:mm:ss A' : 'HH:mm:ss';
        
        const createFormat = (dateFormat, timeFormat) => {
            return dateFormat.replace(/\//g, separator) + ', ' + timeFormat;
        };
        
        const addFormatsWithSingleDigitSupport = (dateFormat, timeFormat) => {
            formats.push(createFormat(dateFormat, timeFormat));
            
            if (dateFormat === 'DD/MM/YYYY') {
                formats.push(createFormat('D/M/YYYY', timeFormat));
                formats.push(createFormat('D/MM/YYYY', timeFormat));
                formats.push(createFormat('DD/M/YYYY', timeFormat));
                if (!components.hasAMPM) {
                    formats.push(createFormat('DD/MM/YYYY', 'H:mm'));
                    formats.push(createFormat('D/M/YYYY', 'H:mm'));
                }
            } else if (dateFormat === 'MM/DD/YYYY') {
                formats.push(createFormat('M/D/YYYY', timeFormat));
                formats.push(createFormat('M/DD/YYYY', timeFormat));
                formats.push(createFormat('MM/D/YYYY', timeFormat));
                if (!components.hasAMPM) {
                    formats.push(createFormat('MM/DD/YYYY', 'H:mm'));
                    formats.push(createFormat('M/D/YYYY', 'H:mm'));
                }
            }
        };
        
        if (preference === 'EU') {
            addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormat);
            addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormatWithSeconds);
            formats.push(createFormat('DD/MM/YYYY', 'HH:mm'));
            formats.push(createFormat('DD/MM/YYYY', 'HH:mm:ss'));
            
            addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormat);
            addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormatWithSeconds);
        } else if (preference === 'US') {
            addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormat);
            addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormatWithSeconds);
            formats.push(createFormat('MM/DD/YYYY', 'HH:mm'));
            formats.push(createFormat('MM/DD/YYYY', 'HH:mm:ss'));
            
            addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormat);
            addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormatWithSeconds);
        } else {
            if (components.likelyFormat === 'EU') {
                addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormat);
                addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormatWithSeconds);
            } else if (components.likelyFormat === 'US') {
                addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormat);
                addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormatWithSeconds);
            } else {
                addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormat);
                addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormat);
                addFormatsWithSingleDigitSupport('DD/MM/YYYY', timeFormatWithSeconds);
                addFormatsWithSingleDigitSupport('MM/DD/YYYY', timeFormatWithSeconds);
            }
        }
        
        const additionalFormats = [
            'YYYY-MM-DD HH:mm:ss',
            'YYYY-MM-DDTHH:mm:ss',
            'dddd, MMMM D, YYYY h:mm A',
            'D/M/YYYY HH:mm',
            'M/D/YYYY HH:mm',
            'D/M/YYYY, H:mm',
            'M/D/YYYY, H:mm',
            'D/M/YYYY H:mm',
            'M/D/YYYY H:mm'
        ];
        
        return formats.concat(additionalFormats);
    }

    #parseForumDate(dateString) {
        if (!dateString || typeof dateString !== 'string') {
            return null;
        }

        const cacheKey = dateString.trim();
        if (this.#dateFormatCache.has(cacheKey)) {
            return this.#dateFormatCache.get(cacheKey);
        }

        let cleanDateString = cacheKey
            .replace(/^Posted on\s*/i, '')
            .replace(/^on\s*/i, '')
            .replace(/^Posted\s*/i, '')
            .trim();

        const components = this.#analyzeDateComponents(cleanDateString);
        
        if (components.parts.length >= 2) {
            const [first, second] = components.parts;
            if (first > 12 && second <= 12) {
                const formats = this.#buildFormatArray('EU', components);
                
                const aggressiveFormats = [
                    'D/M/YYYY, H:mm',
                    'D/M/YYYY, HH:mm',
                    'D/M/YYYY H:mm',
                    'D/M/YYYY HH:mm',
                    'DD/M/YYYY, H:mm',
                    'DD/M/YYYY, HH:mm',
                    'D/MM/YYYY, H:mm',
                    'D/MM/YYYY, HH:mm'
                ];
                
                const allFormats = aggressiveFormats.concat(formats);
                
                let momentDate = null;
                let successfulFormat = null;
                
                for (let i = 0; i < allFormats.length; i++) {
                    momentDate = moment(cleanDateString, allFormats[i], true);
                    if (momentDate && momentDate.isValid()) {
                        const month = momentDate.month() + 1;
                        if (month >= 1 && month <= 12) {
                            successfulFormat = 'EU';
                            break;
                        } else {
                            momentDate = null;
                        }
                    }
                }
                
                if (momentDate && momentDate.isValid()) {
                    const utcTime = momentDate.utc();
                    
                    if (successfulFormat) {
                        this.#learnFormat(components, successfulFormat);
                    }
                    
                    this.#dateFormatCache.set(cacheKey, utcTime);
                    
                    return utcTime;
                }
            }
        }
        
        const bestFormat = this.#getBestFormatForComponents(components);
        
        let formats = [];
        
        if (bestFormat === 'EU') {
            formats = this.#buildFormatArray('EU', components);
        } else if (bestFormat === 'US') {
            formats = this.#buildFormatArray('US', components);
        } else {
            formats = this.#buildFormatArray('AUTO', components);
        }
        
        let momentDate = null;
        let successfulFormat = null;
        
        for (let i = 0; i < formats.length; i++) {
            momentDate = moment(cleanDateString, formats[i], true);
            if (momentDate && momentDate.isValid()) {
                const month = momentDate.month() + 1;
                if (month >= 1 && month <= 12) {
                    successfulFormat = formats[i].includes('DD/MM') || formats[i].includes('D/M') ? 'EU' : 
                                      formats[i].includes('MM/DD') || formats[i].includes('M/D') ? 'US' : 'UNKNOWN';
                    break;
                } else {
                    momentDate = null;
                }
            }
        }
        
        if ((!momentDate || !momentDate.isValid()) && cleanDateString.includes('(')) {
            try {
                const timezoneMatch = cleanDateString.match(/\(([A-Z]{2,})\)$/);
                if (timezoneMatch) {
                    const tzAbbr = timezoneMatch[1];
                    const dateWithoutTz = cleanDateString.replace(/\s*\([A-Z]{2,}\)$/, '');
                    
                    for (let i = 0; i < formats.length; i++) {
                        const parsed = moment(dateWithoutTz, formats[i], true);
                        if (parsed && parsed.isValid()) {
                            const month = parsed.month() + 1;
                            if (month >= 1 && month <= 12) {
                                const possibleZones = this.#getTimezoneFromAbbr(tzAbbr);
                                if (possibleZones.length > 0) {
                                    momentDate = parsed.tz(possibleZones[0]);
                                } else {
                                    momentDate = parsed;
                                }
                                successfulFormat = formats[i].includes('DD/MM') || formats[i].includes('D/M') ? 'EU' : 
                                                 formats[i].includes('MM/DD') || formats[i].includes('M/D') ? 'US' : 'UNKNOWN';
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                // Timezone parsing failed silently
            }
        }
        
        if (!momentDate || !momentDate.isValid()) {
            const jsDate = new Date(cleanDateString);
            if (!isNaN(jsDate)) {
                momentDate = moment(jsDate);
                
                const month = momentDate.month() + 1;
                const day = momentDate.date();
                
                if (components.parts.length >= 2) {
                    const [first, second] = components.parts;
                    if (first === month && second === day) {
                        successfulFormat = 'US';
                    } else if (first === day && second === month) {
                        successfulFormat = 'EU';
                    }
                }
            }
        }
        
        if (!momentDate || !momentDate.isValid()) {
            const manualMatch = cleanDateString.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4}),?\s+(\d{1,2}):(\d{2})/);
            if (manualMatch) {
                const [_, dayOrMonth, monthOrDay, year, hour, minute] = manualMatch.map(Number);
                
                if (dayOrMonth > 12 && monthOrDay <= 12) {
                    const dateStr = year + '-' + String(monthOrDay).padStart(2, '0') + '-' + String(dayOrMonth).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00';
                    momentDate = moment(dateStr);
                    successfulFormat = 'EU';
                } else if (dayOrMonth <= 12 && monthOrDay > 12) {
                    const dateStr = year + '-' + String(dayOrMonth).padStart(2, '0') + '-' + String(monthOrDay).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00';
                    momentDate = moment(dateStr);
                    successfulFormat = 'US';
                }
            }
        }
        
        if (momentDate && momentDate.isValid()) {
            const utcTime = momentDate.utc();
            
            if (successfulFormat) {
                this.#learnFormat(components, successfulFormat);
            }
            
            this.#dateFormatCache.set(cacheKey, utcTime);
            
            return utcTime;
        }
        
        console.warn('Could not parse date:', dateString, '->', cleanDateString);
        this.#dateFormatCache.set(cacheKey, null);
        return null;
    }
    
    #detectForumTimezone() {
        return null;
    }

    #getTimezoneFromAbbr(abbr) {
        const abbrMap = {
            'EST': ['America/New_York', 'America/Toronto', 'America/Montreal'],
            'EDT': ['America/New_York', 'America/Toronto', 'America/Montreal'],
            'PST': ['America/Los_Angeles', 'America/Vancouver'],
            'PDT': ['America/Los_Angeles', 'America/Vancouver'],
            'CST': ['America/Chicago', 'America/Winnipeg'],
            'CDT': ['America/Chicago', 'America/Winnipeg'],
            'MST': ['America/Denver', 'America/Phoenix'],
            'MDT': ['America/Denver'],
            'GMT': ['UTC', 'Europe/London'],
            'BST': ['Europe/London'],
            'CET': ['Europe/Paris', 'Europe/Berlin', 'Europe/Rome'],
            'CEST': ['Europe/Paris', 'Europe/Berlin', 'Europe/Rome'],
            'EET': ['Europe/Sofia', 'Europe/Athens', 'Europe/Helsinki'],
            'EEST': ['Europe/Sofia', 'Europe/Athens', 'Europe/Helsinki'],
            'AEST': ['Australia/Sydney', 'Australia/Melbourne'],
            'AEDT': ['Australia/Sydney', 'Australia/Melbourne'],
            'UTC': ['UTC']
        };
        
        return abbrMap[abbr] || [];
    }

    #shouldSkipFutureTimestamp(element) {
        const postElement = element.closest('.post');
        return postElement && postElement.classList.contains('post_queue');
    }

    #formatTimeAgo(date) {
        if (!date || !date.isValid()) {
            return 'Unknown time';
        }

        const now = moment();
        const userDate = moment(date).local();
        
        const diffInSeconds = now.diff(userDate, 'seconds');
        
        if (diffInSeconds < 0) {
            const futureDiffInSeconds = Math.abs(diffInSeconds);
            const futureDiffInMinutes = Math.abs(now.diff(userDate, 'minutes'));
            const futureDiffInHours = Math.abs(now.diff(userDate, 'hours'));
            const futureDiffInDays = Math.abs(now.diff(userDate, 'days'));
            
            if (futureDiffInSeconds < 60) {
                return 'in ' + futureDiffInSeconds + ' seconds';
            } else if (futureDiffInMinutes < 60) {
                return 'in ' + futureDiffInMinutes + ' minute' + (futureDiffInMinutes > 1 ? 's' : '');
            } else if (futureDiffInHours < 24) {
                return 'in ' + futureDiffInHours + ' hour' + (futureDiffInHours > 1 ? 's' : '');
            } else if (futureDiffInDays < 7) {
                return 'in ' + futureDiffInDays + ' day' + (futureDiffInDays > 1 ? 's' : '');
            } else if (futureDiffInDays < 30) {
                const weeks = Math.floor(futureDiffInDays / 7);
                return 'in ' + weeks + ' week' + (weeks > 1 ? 's' : '');
            } else if (futureDiffInDays < 365) {
                const months = Math.floor(futureDiffInDays / 30);
                return 'in ' + months + ' month' + (months > 1 ? 's' : '');
            } else {
                const years = Math.floor(futureDiffInDays / 365);
                return 'in ' + years + ' year' + (years > 1 ? 's' : '');
            }
        }
        
        const diffInMinutes = now.diff(userDate, 'minutes');
        const diffInHours = now.diff(userDate, 'hours');
        const diffInDays = now.diff(userDate, 'days');
        
        if (diffInSeconds < 45) {
            return 'Just now';
        } else if (diffInSeconds < 90) {
            return 'A minute ago';
        } else if (diffInMinutes < 45) {
            return diffInMinutes + ' minutes ago';
        } else if (diffInMinutes < 90) {
            return 'An hour ago';
        } else if (diffInHours < 24) {
            return diffInHours + ' hours ago';
        } else if (diffInDays === 1) {
            return 'Yesterday';
        } else if (diffInDays < 7) {
            return diffInDays + ' days ago';
        } else if (diffInDays < 30) {
            const weeks = Math.floor(diffInDays / 7);
            return weeks + (weeks === 1 ? ' week ago' : ' weeks ago');
        } else if (diffInDays < 365) {
            const months = Math.floor(diffInDays / 30);
            return months + (months === 1 ? ' month ago' : ' months ago');
        } else {
            const years = Math.floor(diffInDays / 365);
            return years + (years === 1 ? ' year ago' : ' years ago');
        }
    }

    #createModernTimestamp(originalElement, dateString) {
        if (typeof moment === 'undefined' || typeof moment.tz === 'undefined') {
            console.warn('Moment.js libraries not loaded, skipping timestamp transformation');
            return originalElement;
        }
        
        if (originalElement.classList && originalElement.classList.contains('modern-timestamp')) {
            return originalElement;
        }
        
        if (originalElement.querySelector && originalElement.querySelector('.modern-timestamp')) {
            return originalElement;
        }
        
        if (originalElement.closest && originalElement.closest('.modern-timestamp')) {
            return originalElement;
        }
        
        const isPostQueue = this.#shouldSkipFutureTimestamp(originalElement);
        
        const momentDate = this.#parseForumDate(dateString);
        
        if (!momentDate) {
            console.warn('Could not parse date:', dateString);
            return originalElement;
        }
        
        const userSettings = this.#getUserLocaleSettings();
        
        const link = document.createElement('a');
        
        let href = null;
        
        if (originalElement.tagName === 'A' && originalElement.hasAttribute('href')) {
            href = originalElement.getAttribute('href');
        } else if (originalElement.parentElement && originalElement.parentElement.tagName === 'A' && 
                 originalElement.parentElement.hasAttribute('href')) {
            href = originalElement.parentElement.getAttribute('href');
        } else {
            const postElement = originalElement.closest('.post');
            if (postElement && postElement.id) {
                const postIdMatch = postElement.id.match(/\d+/);
                if (postIdMatch) {
                    const postId = postIdMatch[0];
                    const topicMatch = window.location.href.match(/t=(\d+)/);
                    if (topicMatch) {
                        href = '#entry' + postId;
                    } else {
                        href = '#entry' + postId;
                    }
                }
            }
        }
        
        if (href) {
            link.href = href;
            
            if (originalElement.hasAttribute('rel')) {
                link.setAttribute('rel', originalElement.getAttribute('rel'));
            } else if (originalElement.parentElement && originalElement.parentElement.tagName === 'A' && 
                      originalElement.parentElement.hasAttribute('rel')) {
                link.setAttribute('rel', originalElement.parentElement.getAttribute('rel'));
            }
        }
        
        const timeElement = document.createElement('time');
        timeElement.className = 'modern-timestamp';
        
        if (isPostQueue) {
            timeElement.classList.add('future-timestamp');
            timeElement.setAttribute('data-scheduled-post', 'true');
        }
        
        const utcISOString = momentDate.toISOString();
        timeElement.setAttribute('datetime', utcISOString);
        
        const userLocalDate = momentDate.tz(userSettings.timezone);
        
        const titleFormat = userSettings.formats.longDateTime;
        const localizedTitle = userLocalDate.locale(userSettings.locale).format(titleFormat);
        const timezoneAbbr = userLocalDate.format('z');
        
        const now = moment();
        const isFuture = momentDate.isAfter(now);
        
        if (isFuture && isPostQueue) {
            timeElement.setAttribute('title', 'Scheduled for ' + localizedTitle + ' (' + timezoneAbbr + ')');
        } else {
            timeElement.setAttribute('title', localizedTitle + ' (' + timezoneAbbr + ')');
        }
        
        const relativeSpan = document.createElement('span');
        relativeSpan.className = 'relative-time';
        
        const relativeTime = this.#formatTimeAgo(momentDate);
        relativeSpan.textContent = relativeTime;
        
        timeElement.setAttribute('data-absolute-time', userLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime));
        
        if (isFuture && isPostQueue) {
            const indicator = document.createElement('span');
            indicator.className = 'future-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.innerHTML = '&#x23F1;';
            indicator.style.marginLeft = '4px';
            relativeSpan.appendChild(indicator);
        }
        
        timeElement.appendChild(relativeSpan);
        
        let finalElement;
        if (href) {
            link.appendChild(timeElement);
            finalElement = link;
        } else {
            finalElement = timeElement;
        }
        
        const timeElementId = 'timestamp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        timeElement.setAttribute('data-timestamp-id', timeElementId);
        
        timeElement.setAttribute('data-utc-date', utcISOString);
        timeElement.setAttribute('data-original-date', dateString);
        
        const updateInterval = setInterval(() => {
            if (!document.body.contains(timeElement)) {
                clearInterval(updateInterval);
                this.#timeUpdateIntervals.delete(timeElementId);
                return;
            }
            
            const storedUTC = moment(timeElement.getAttribute('data-utc-date'));
            if (storedUTC.isValid()) {
                const newRelativeTime = this.#formatTimeAgo(storedUTC);
                if (relativeSpan.textContent !== newRelativeTime) {
                    relativeSpan.textContent = newRelativeTime;
                    
                    const existingIndicator = relativeSpan.querySelector('.future-indicator');
                    if (existingIndicator) {
                        existingIndicator.remove();
                    }
                    
                    if (isFuture && timeElement.classList.contains('future-timestamp')) {
                        const indicator = document.createElement('span');
                        indicator.className = 'future-indicator';
                        indicator.setAttribute('aria-hidden', 'true');
                        indicator.innerHTML = '&#x23F1;';
                        indicator.style.marginLeft = '4px';
                        relativeSpan.appendChild(indicator);
                    }
                }
                
                const currentUserLocalDate = storedUTC.tz(userSettings.timezone);
                let currentTitle = currentUserLocalDate.locale(userSettings.locale).format(titleFormat);
                const currentTimezoneAbbr = currentUserLocalDate.format('z');
                
                if (timeElement.classList.contains('future-timestamp')) {
                    currentTitle = 'Scheduled for ' + currentTitle;
                }
                
                timeElement.setAttribute('title', currentTitle + ' (' + currentTimezoneAbbr + ')');
            }
        }, 30000);
        
        this.#timeUpdateIntervals.set(timeElementId, updateInterval);
        
        timeElement.setAttribute('data-parsed-date', dateString);
        timeElement.setAttribute('data-user-timezone', userSettings.timezone);
        timeElement.setAttribute('data-user-locale', userSettings.locale);
        timeElement.setAttribute('data-parsed-utc', utcISOString);
        
        return finalElement;
    }

    #getUserLocaleSettings() {
        try {
            const locale = navigator.language || 'en-US';
            
            const testTime = moment().locale(locale).format('LT');
            const uses24Hour = !testTime.includes('AM') && !testTime.includes('PM');
            
            const timezone = moment.tz.guess() || 'UTC';
            
            return {
                locale: locale,
                timezone: timezone,
                uses24Hour: uses24Hour,
                formats: {
                    longDateTime: 'LLLL',
                    mediumDateTime: 'llll',
                    shortDateTime: 'lll',
                    timeOnly: uses24Hour ? 'HH:mm' : 'h:mm A',
                    dateOnly: 'll'
                }
            };
        } catch (error) {
            return {
                locale: 'en-US',
                timezone: 'UTC',
                uses24Hour: false,
                formats: {
                    longDateTime: 'LLLL',
                    mediumDateTime: 'llll',
                    shortDateTime: 'lll',
                    timeOnly: 'h:mm A',
                    dateOnly: 'll'
                }
            };
        }
    }

    #extractDateFromElement(element) {
        if (element.classList && element.classList.contains('modern-timestamp')) {
            return null;
        }
        
        if (element.closest && element.closest('.modern-timestamp')) {
            return null;
        }
        
        if (element.tagName === 'A') {
            const href = element.getAttribute('href') || '';
            const rel = element.getAttribute('rel') || '';
            
            if (href.includes('&p=') || href.includes('?p=')) {
                return null;
            }
            if (href.includes('CODE=08') || href.includes('CODE=02') || 
                href.includes('delete_post') || href.includes('javascript:')) {
                return null;
            }
            if (element.querySelector('.fa-file-o, .fa-folder')) {
                return null;
            }
            if (rel === 'nofollow' && (href.includes('act=Post') || href.includes('CODE='))) {
                return null;
            }
            if (element.closest('.btn-share') || element.getAttribute('data-action') === 'share') {
                return null;
            }
        }
        
        if (element.tagName === 'BUTTON') {
            return null;
        }
        
        if (element.tagName === 'I' && (
            element.classList.contains('fa-pen-to-square') ||
            element.classList.contains('fa-quote-left') ||
            element.classList.contains('fa-eraser') ||
            element.classList.contains('fa-share-nodes') ||
            element.classList.contains('fa-file-o') ||
            element.classList.contains('fa-folder')
        )) {
            return null;
        }
        
        if (element.hasAttribute('title')) {
            const title = element.getAttribute('title');
            const cleanTitle = title.replace(/:\d+$/, '');
            return cleanTitle;
        }
        
        if (element.textContent) {
            const text = element.textContent.trim();
            
            const datePatterns = [
                /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
                /(\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)/i,
                /(\d{4}-\d{1,2}-\d{1,2},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
                /(\d{1,2}\.\d{1,2}\.\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i
            ];
            
            for (const pattern of datePatterns) {
                const match = text.match(pattern);
                if (match) {
                    return match[1].trim();
                }
            }
            
            const dateTimeMatch = text.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}.+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i);
            if (dateTimeMatch) {
                return dateTimeMatch[1].trim();
            }
        }
        
        const parentCheckElements = [
            element.parentElement,
            element.parentElement?.parentElement,
            element.closest('a'),
            element.closest('.lt.Sub'),
            element.closest('.title2')
        ];
        
        for (const parent of parentCheckElements) {
            if (parent && parent.hasAttribute('title')) {
                if (parent.tagName === 'A') {
                    const parentHref = parent.getAttribute('href') || '';
                    if (parentHref.includes('CODE=') || parentHref.includes('delete_post') || 
                        parentHref.includes('javascript:') || parentHref.includes('&p=')) {
                        continue;
                    }
                }
                
                const parentTitle = parent.getAttribute('title');
                const cleanTitle = parentTitle.replace(/:\d+$/, '');
                return cleanTitle;
            }
        }
        
        return null;
    }
    
    #transformEditTimestamp(span) {
        const editPatterns = [
            /Edited by .+? - (.+)/i,
            /Modificato da .+? - (.+)/i,
            /Editado por .+? - (.+)/i,
            /Bearbeitet von .+? - (.+)/i,
            /Modifié par .+? - (.+)/i,
            /(.+ - \d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}.+)/i
        ];
        
        let editDate = null;
        for (const pattern of editPatterns) {
            const timeMatch = span.textContent.match(pattern);
            if (timeMatch) {
                editDate = timeMatch[1].trim();
                break;
            }
        }
        
        if (editDate) {
            const momentDate = this.#parseForumDate(editDate);
            
            if (momentDate) {
                const userSettings = this.#getUserLocaleSettings();
                
                const userLocalDate = momentDate.tz(userSettings.timezone);
                
                const formattedTime = userLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime);
                const timezoneAbbr = userLocalDate.format('z');
                
                const timeElement = document.createElement('time');
                timeElement.setAttribute('datetime', momentDate.toISOString());
                timeElement.setAttribute('title', formattedTime + ' (' + timezoneAbbr + ')');
                timeElement.textContent = this.#formatTimeAgo(momentDate);
                
                const timeElementId = 'edit-timestamp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                timeElement.setAttribute('data-timestamp-id', timeElementId);
                timeElement.setAttribute('data-utc-date', momentDate.toISOString());
                
                span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> Edited ' + timeElement.outerHTML;
                
                const updateInterval = setInterval(() => {
                    if (!document.body.contains(timeElement)) {
                        clearInterval(updateInterval);
                        this.#timeUpdateIntervals.delete(timeElementId);
                        return;
                    }
                    
                    const storedUTC = moment(timeElement.getAttribute('data-utc-date'));
                    if (storedUTC.isValid()) {
                        const newRelativeTime = this.#formatTimeAgo(storedUTC);
                        if (timeElement.textContent !== newRelativeTime) {
                            timeElement.textContent = newRelativeTime;
                        }
                        
                        const currentUserLocalDate = storedUTC.tz(userSettings.timezone);
                        const currentTitle = currentUserLocalDate.locale(userSettings.locale).format(userSettings.formats.mediumDateTime);
                        const currentTimezoneAbbr = currentUserLocalDate.format('z');
                        timeElement.setAttribute('title', currentTitle + ' (' + currentTimezoneAbbr + ')');
                    }
                }, 30000);
                
                this.#timeUpdateIntervals.set(timeElementId, updateInterval);
            } else {
                console.warn('Could not parse edit date:', editDate);
                span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ' + this.#escapeHtml(span.textContent);
            }
        } else {
            span.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i> ' + this.#escapeHtml(span.textContent);
        }
    }

    #transformTimestampElements(element) {
        const timestampSelectors = [
            '.lt.Sub a span.when',
            '.lt.Sub time',
            '.post-edit time',
            '.lt.Sub span',
            '.lt.Sub a',
            '.title2.top time',
            '.title2.top span',
            '.title2.top a',
            'span.when'
        ];
        
        const timestampElements = element.querySelectorAll(timestampSelectors.join(', '));
        
        timestampElements.forEach(timestampElement => {
            if (timestampElement.classList && timestampElement.classList.contains('modern-timestamp')) {
                return;
            }
            
            if (timestampElement.closest('.modern-timestamp')) {
                return;
            }
            
            if (timestampElement.querySelector && timestampElement.querySelector('.modern-timestamp')) {
                return;
            }
            
            if (timestampElement.closest('time.modern-timestamp, a .modern-timestamp')) {
                return;
            }
            
            if (timestampElement.tagName === 'A') {
                const href = timestampElement.getAttribute('href') || '';
                
                if (timestampElement.querySelector('time')) {
                    return;
                }
                
                if (timestampElement.querySelector('.modern-timestamp')) {
                    return;
                }
                
                if (href.includes('#entry') && !timestampElement.querySelector('span.when, time')) {
                    return;
                }
                
                if (href.includes('CODE=08') ||
                    href.includes('CODE=02') ||
                    href.includes('delete_post') || 
                    href.includes('javascript:')) {
                    return;
                }
                
                if (timestampElement.querySelector('.fa-file-o, .fa-folder, .fa-file-lines')) {
                    return;
                }
                
                const hasActionIcon = timestampElement.querySelector(
                    '.fa-pen-to-square, .fa-quote-left, .fa-eraser, ' +
                    '.fa-share-nodes, .fa-file-o, .fa-folder, .fa-file-lines'
                );
                if (hasActionIcon) {
                    return;
                }
            }
            
            if (timestampElement.tagName === 'BUTTON') {
                return;
            }
            
            if (timestampElement.tagName === 'I') {
                const iconClasses = timestampElement.className;
                if (iconClasses.includes('fa-pen-to-square') ||
                    iconClasses.includes('fa-quote-left') ||
                    iconClasses.includes('fa-eraser') ||
                    iconClasses.includes('fa-share-nodes') ||
                    iconClasses.includes('fa-file-o') ||
                    iconClasses.includes('fa-folder') ||
                    iconClasses.includes('fa-file-lines')) {
                    return;
                }
            }
            
            const dateString = this.#extractDateFromElement(timestampElement);
            
            if (dateString) {
                const modernTimestamp = this.#createModernTimestamp(timestampElement, dateString);
                
                if (modernTimestamp && modernTimestamp !== timestampElement) {
                    const parent = timestampElement.parentNode;
                    
                    if (parent && parent.tagName === 'A' && parent.children.length === 1 && 
                        parent.children[0] === timestampElement && parent.href && parent.href.includes('#entry')) {
                        parent.parentNode.replaceChild(modernTimestamp, parent);
                    } else if (timestampElement.tagName === 'A' && timestampElement.href && 
                             timestampElement.href.includes('#entry') && 
                             timestampElement.children.length === 0) {
                        timestampElement.parentNode.replaceChild(modernTimestamp, timestampElement);
                    } else if (timestampElement.tagName === 'SPAN' && parent && parent.tagName === 'A' && 
                             parent.href && parent.href.includes('#entry')) {
                        parent.replaceChild(modernTimestamp, timestampElement);
                    } else {
                        timestampElement.parentNode.replaceChild(modernTimestamp, timestampElement);
                    }
                }
            }
        });
    }
    
    #transformPostHeaderTimestamps(postHeader) {
        if (!postHeader) return;
        
        const timestampPatterns = [
            'span.when',
            'time:not(.modern-timestamp)',
            '.lt.Sub span.when',
            '.lt.Sub a span.when'
        ];
        
        timestampPatterns.forEach(pattern => {
            const elements = postHeader.querySelectorAll(pattern);
            elements.forEach(el => {
                if (el.classList && el.classList.contains('modern-timestamp')) return;
                
                const dateString = this.#extractDateFromElement(el);
                if (dateString) {
                    const modernTimestamp = this.#createModernTimestamp(el, dateString);
                    if (modernTimestamp !== el) {
                        el.parentNode.replaceChild(modernTimestamp, el);
                    }
                }
            });
        });
    }

    // ==============================
    // ATTACHMENT TRANSFORMATION
    // ==============================

    #modernizeAttachments() {
        this.#processExistingAttachments();
        this.#setupAttachmentObserver();
    }

    #processExistingAttachments() {
        document.querySelectorAll('.fancytop + div[align="center"], .fancytop + .fancyborder').forEach(container => {
            if (container.classList.contains('attachment-modernized')) return;
            this.#transformAttachment(container);
            container.classList.add('attachment-modernized');
        });
    }

    #transformAttachment(container) {
        const fancyTop = container.previousElementSibling;
        if (!fancyTop || !fancyTop.classList.contains('fancytop')) {
            return;
        }

        const isImageAttachment = container.querySelector('a[href*="image.forumcommunity.it"]') || 
                                  container.querySelector('img[src*="image.forumcommunity.it"]');
        
        const isFileAttachment = container.querySelector('img[src*="mime_types/"]') || 
                                container.querySelector('a[onclick*="act=Attach"]');

        if (!isImageAttachment && !isFileAttachment) {
            return;
        }

        fancyTop.remove();

        const modernAttachment = document.createElement('div');
        modernAttachment.className = 'modern-attachment';

        let html = '';

        if (isImageAttachment) {
            html = this.#createImageAttachmentHTML(container);
        } else if (isFileAttachment) {
            html = this.#createFileAttachmentHTML(container);
        }

        if (html) {
            modernAttachment.innerHTML = html;
            container.replaceWith(modernAttachment);
            
            if (isImageAttachment) {
                this.#addImageAttachmentListeners(modernAttachment);
            }
            
            if (isFileAttachment) {
                this.#addFileAttachmentListeners(modernAttachment);
            }
            
            if (isImageAttachment) {
                this.#triggerMediaDimensionExtractor(modernAttachment);
            }
        }
    }

    #createImageAttachmentHTML(container) {
        const imageLink = container.querySelector('a[href*="image.forumcommunity.it"]');
        const imageElement = container.querySelector('img[src*="image.forumcommunity.it"]');
        
        if (!imageLink || !imageElement) {
            return '';
        }

        const imageUrl = imageLink.getAttribute('href') || imageElement.getAttribute('src');
        const imageAlt = imageElement.getAttribute('alt') || 'Attached image';
        const imageTitle = imageLink.getAttribute('title') || imageAlt;
        
        let width = imageElement.getAttribute('width');
        let height = imageElement.getAttribute('height');
        
        if ((!width || !height) && imageElement.naturalWidth && imageElement.naturalHeight) {
            width = imageElement.naturalWidth;
            height = imageElement.naturalHeight;
        }
        
        const dataWidth = imageElement.getAttribute('data-width');
        const dataHeight = imageElement.getAttribute('data-height');
        
        if (dataWidth && dataHeight) {
            width = dataWidth;
            height = dataHeight;
        }
        
        const downloadUrl = imageUrl;
        const fileName = this.#extractFileNameFromUrl(imageUrl) || 'image.jpg';
        const fileSize = this.#calculateImageSize(width, height, fileName);
        
        let html = '<div class="attachment-header">' +
            '<div class="attachment-icon">' +
            '<i class="fa-regular fa-image" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="attachment-info">' +
            '<span class="attachment-title">Attached Image</span>' +
            '<span class="attachment-details">' + this.#escapeHtml(fileName) + ' • ' + fileSize + '</span>' +
            '</div>' +
            '<div class="attachment-actions">' +
            '<a href="' + this.#escapeHtml(downloadUrl) + '" class="attachment-download-btn" download="' + this.#escapeHtml(fileName) + '" title="Download image" target="_blank" rel="nofollow">' +
            '<i class="fa-regular fa-download" aria-hidden="true"></i>' +
            '</a>' +
            '<a href="' + this.#escapeHtml(imageUrl) + '" class="attachment-view-btn" title="View full size" target="_blank" rel="nofollow">' +
            '<i class="fa-regular fa-expand" aria-hidden="true"></i>' +
            '</a>' +
            '</div>' +
            '</div>';
        
        html += '<div class="attachment-preview">' +
            '<a href="' + this.#escapeHtml(imageUrl) + '" class="attachment-image-link" title="' + this.#escapeHtml(imageTitle) + '" target="_blank" rel="nofollow">' +
            '<img src="' + this.#escapeHtml(imageElement.getAttribute('src')) + '" alt="' + this.#escapeHtml(imageAlt) + '" loading="lazy" decoding="async"';
        
        if (width && height) {
            html += ' width="' + width + '" height="' + height + '"';
        }
        
        html += ' style="max-width: 100%; height: auto; display: block;">' +
            '</a>' +
            '</div>';
        
        return html;
    }

    #calculateImageSize(width, height, fileName) {
        if (!width || !height) {
            const dimensionMatch = fileName.match(/(\d+)x(\d+)/);
            if (dimensionMatch) {
                width = parseInt(dimensionMatch[1]);
                height = parseInt(dimensionMatch[2]);
            } else {
                return 'Unknown dimensions';
            }
        }
        
        const megapixels = (width * height) / 1000000;
        
        if (megapixels < 0.1) {
            return width + '×' + height + ' pixels';
        } else if (megapixels < 1) {
            return width + '×' + height + ' (' + Math.round(megapixels * 1000) + 'K pixels)';
        } else {
            return width + '×' + height + ' (' + megapixels.toFixed(1) + ' MP)';
        }
    }

    #extractFileNameFromUrl(url) {
        if (!url) return '';
        
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const parts = pathname.split('/');
            const fileName = parts[parts.length - 1] || 'image.jpg';
            
            return fileName.split('?')[0];
        } catch {
            const parts = url.split('/');
            const fileName = parts[parts.length - 1] || 'image.jpg';
            return fileName.split('?')[0];
        }
    }

    #createFileAttachmentHTML(container) {
        const fileLink = container.querySelector('a[onclick*="act=Attach"]');
        const mimeIcon = container.querySelector('img[src*="mime_types/"]');
        const fileNameElement = fileLink ? fileLink.querySelector('span.post-text') : null;
        const downloadCountElement = container.querySelector('small');
        
        if (!fileLink) {
            return '';
        }

        const fileName = fileNameElement ? fileNameElement.textContent.trim() : 'Unknown file';
        const downloadCount = downloadCountElement ? downloadCountElement.textContent.replace(/[^\d]/g, '') : '0';
        const fileType = this.#getFileTypeFromName(fileName);
        const fileIcon = this.#getFileIcon(fileType);
        
        let downloadUrl = '#';
        const onclickAttr = fileLink.getAttribute('onclick');
        if (onclickAttr) {
            const urlMatch = onclickAttr.match(/window\.open\('([^']+)'/);
            if (urlMatch && urlMatch[1]) {
                downloadUrl = urlMatch[1];
            }
        }
        
        let html = '<div class="attachment-header">' +
            '<div class="attachment-icon">' +
            '<i class="' + fileIcon + '" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="attachment-info">' +
            '<span class="attachment-title">Attached File</span>' +
            '<span class="attachment-details">' + this.#escapeHtml(fileName) + ' • ' + fileType.toUpperCase() + '</span>' +
            '</div>' +
            '<div class="attachment-actions">' +
            '<a href="' + this.#escapeHtml(downloadUrl) + '" class="attachment-download-btn" download="' + this.#escapeHtml(fileName) + '" title="Download file" target="_blank" rel="nofollow" onclick="' + this.#escapeHtml(onclickAttr || '') + '">' +
            '<i class="fa-regular fa-download" aria-hidden="true"></i>' +
            '</a>' +
            '</div>' +
            '</div>';
        
        html += '<div class="attachment-stats">' +
            '<div class="stat-item">' +
            '<i class="fa-regular fa-download" aria-hidden="true"></i>' +
            '<span>' + downloadCount + ' download' + (downloadCount !== '1' ? 's' : '') + '</span>' +
            '</div>' +
            '<div class="stat-item">' +
            '<i class="fa-regular fa-file" aria-hidden="true"></i>' +
            '<span>' + fileType.toUpperCase() + ' file</span>' +
            '</div>' +
            '</div>';
        
        return html;
    }

    #getFileTypeFromName(fileName) {
        if (!fileName) return 'file';
        
        const extension = fileName.split('.').pop().toLowerCase();
        
        const typeMap = {
            'pdf': 'PDF',
            'doc': 'Word',
            'docx': 'Word',
            'txt': 'Text',
            'rtf': 'Rich Text',
            'zip': 'ZIP Archive',
            'rar': 'RAR Archive',
            '7z': '7-Zip Archive',
            'tar': 'TAR Archive',
            'gz': 'GZIP Archive',
            'jpg': 'Image',
            'jpeg': 'Image',
            'png': 'Image',
            'gif': 'Image',
            'bmp': 'Image',
            'svg': 'SVG Image',
            'mp3': 'Audio',
            'wav': 'Audio',
            'flac': 'Audio',
            'm4a': 'Audio',
            'mp4': 'Video',
            'avi': 'Video',
            'mkv': 'Video',
            'mov': 'Video',
            'wmv': 'Video',
            'js': 'JavaScript',
            'html': 'HTML',
            'css': 'CSS',
            'php': 'PHP',
            'py': 'Python',
            'java': 'Java',
            'cpp': 'C++',
            'c': 'C',
            'json': 'JSON',
            'xml': 'XML'
        };
        
        return typeMap[extension] || 'File';
    }

    #getFileIcon(fileType) {
        const iconMap = {
            'PDF': 'fa-regular fa-file-pdf',
            'Word': 'fa-regular fa-file-word',
            'Text': 'fa-regular fa-file-lines',
            'Rich Text': 'fa-regular fa-file-lines',
            'ZIP Archive': 'fa-regular fa-file-zipper',
            'RAR Archive': 'fa-regular fa-file-zipper',
            '7-Zip Archive': 'fa-regular fa-file-zipper',
            'TAR Archive': 'fa-regular fa-file-zipper',
            'GZIP Archive': 'fa-regular fa-file-zipper',
            'Image': 'fa-regular fa-image',
            'SVG Image': 'fa-regular fa-image',
            'Audio': 'fa-regular fa-file-audio',
            'Video': 'fa-regular fa-file-video',
            'JavaScript': 'fa-regular fa-file-code',
            'HTML': 'fa-regular fa-file-code',
            'CSS': 'fa-regular fa-file-code',
            'PHP': 'fa-regular fa-file-code',
            'Python': 'fa-regular fa-file-code',
            'Java': 'fa-regular fa-file-code',
            'C++': 'fa-regular fa-file-code',
            'C': 'fa-regular fa-file-code',
            'JSON': 'fa-regular fa-file-code',
            'XML': 'fa-regular fa-file-code'
        };
        
        return iconMap[fileType] || 'fa-regular fa-file';
    }

    #addImageAttachmentListeners(attachmentElement) {
        const imageLink = attachmentElement.querySelector('.attachment-image-link');
        const viewBtn = attachmentElement.querySelector('.attachment-view-btn');
        const downloadBtn = attachmentElement.querySelector('.attachment-download-btn');
        
        if (imageLink && viewBtn) {
            viewBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.open(imageLink.href, '_blank', 'noopener,noreferrer');
            });
        }
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                console.log('Downloading image attachment');
            });
        }
    }

    #addFileAttachmentListeners(attachmentElement) {
        const downloadBtn = attachmentElement.querySelector('.attachment-download-btn');
        
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                console.log('Downloading file attachment');
            });
        }
    }

    #triggerMediaDimensionExtractor(attachmentElement) {
        if (globalThis.mediaDimensionExtractor && 
            typeof globalThis.mediaDimensionExtractor.extractDimensionsForElement === 'function') {
            
            const image = attachmentElement.querySelector('img');
            if (image) {
                setTimeout(() => {
                    globalThis.mediaDimensionExtractor.extractDimensionsForElement(image);
                    
                    setTimeout(() => {
                        this.#updateAttachmentSizeInfo(attachmentElement, image);
                    }, 100);
                }, 10);
            }
        }
    }

    #updateAttachmentSizeInfo(attachmentElement, imageElement) {
        const width = imageElement.getAttribute('width') || imageElement.naturalWidth;
        const height = imageElement.getAttribute('height') || imageElement.naturalHeight;
        
        if (width && height) {
            const fileName = this.#extractFileNameFromUrl(imageElement.src) || 'image.jpg';
            const fileSize = this.#calculateImageSize(width, height, fileName);
            
            const detailsElement = attachmentElement.querySelector('.attachment-details');
            if (detailsElement) {
                detailsElement.textContent = fileName + ' • ' + fileSize;
            }
            
            if (!imageElement.hasAttribute('width')) {
                imageElement.setAttribute('width', width);
            }
            if (!imageElement.hasAttribute('height')) {
                imageElement.setAttribute('height', height);
            }
            
            imageElement.style.aspectRatio = width + ' / ' + height;
        }
    }

    #setupAttachmentObserver() {
        if (globalThis.forumObserver) {
            this.#attachmentObserverId = globalThis.forumObserver.register({
                id: 'attachment-modernizer',
                callback: (node) => this.#handleNewAttachments(node),
                selector: '.fancytop + div[align="center"], .fancytop + .fancyborder',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'send', 'search']
            });
        } else {
            setInterval(() => this.#processExistingAttachments(), 2000);
        }
    }

    #handleNewAttachments(node) {
        if (node.matches('.fancytop + div[align="center"]') || node.matches('.fancytop + .fancyborder')) {
            this.#transformAttachment(node);
        } else {
            node.querySelectorAll('.fancytop + div[align="center"], .fancytop + .fancyborder').forEach(attachment => {
                this.#transformAttachment(attachment);
            });
        }
    }

    // ==============================
    // OBSERVER SETUP
    // ==============================

    #setupObserverCallbacks() {
        const pageTypes = ['topic', 'blog', 'send', 'search'];
        
        this.#cleanupObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-cleanup',
            callback: (node) => this.#handleCleanupTasks(node),
            selector: '.bullet_delete, .mini_buttons.points.Sub',
            priority: 'critical',
            pageTypes: pageTypes
        });

        this.#debouncedObserverId = globalThis.forumObserver.registerDebounced({
            id: 'post-modernizer-transform',
            callback: (node) => this.#handlePostTransformation(node),
            selector: '.post, .st-emoji, .title2.bottom, div[align="center"]:has(.quote_top), div.spoiler[align="center"], div[align="center"]:has(.code_top)',
            delay: 100,
            priority: 'normal',
            pageTypes: pageTypes
        });
    }

    #setupSearchPostObserver() {
        const pageTypes = ['search'];
        
        this.#searchPostObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-search-posts',
            callback: (node) => this.#handleSearchPostTransformation(node),
            selector: 'body#search .post, body#search li.post',
            priority: 'high',
            pageTypes: pageTypes
        });
    }

    #setupActiveStateObserver() {
        const pageTypes = ['topic', 'blog', 'send', 'search'];
        
        this.#activeStateObserverId = globalThis.forumObserver.register({
            id: 'post-modernizer-active-states',
            callback: (node) => this.#handleActiveStateMutations(node),
            selector: '.st-emoji-container, .mini_buttons.points.Sub .points',
            priority: 'normal',
            pageTypes: pageTypes
        });

        this.#checkInitialActiveStates();
    }

    #checkInitialActiveStates() {
        const emojiContainers = document.querySelectorAll('.st-emoji-container');
        emojiContainers.forEach(container => this.#updateEmojiContainerActiveState(container));

        const pointsContainers = document.querySelectorAll('.mini_buttons.points.Sub .points');
        pointsContainers.forEach(container => this.#updatePointsContainerActiveState(container));
    }

    #handleActiveStateMutations(node) {
        if (!node) return;

        let hasEmojiChanges = false;
        let hasPointsChanges = false;

        if (node.matches('.st-emoji-container') || node.querySelector('.st-emoji-container')) {
            hasEmojiChanges = true;
        }

        if (node.matches('.points') || node.querySelector('.points em')) {
            hasPointsChanges = true;
        }

        if (node.matches('.st-emoji-counter') ||
            (node.textContent && node.textContent.trim && !isNaN(node.textContent.trim()) && node.textContent.trim() !== '0')) {
            hasEmojiChanges = true;
        }

        if (hasEmojiChanges) {
            this.#updateAllEmojiActiveStates();
        }

        if (hasPointsChanges) {
            this.#updateAllPointsActiveStates();
        }
    }

    #updateAllEmojiActiveStates() {
        const emojiContainers = document.querySelectorAll('.st-emoji-container');
        emojiContainers.forEach(container => this.#updateEmojiContainerActiveState(container));
    }

    #updateAllPointsActiveStates() {
        const pointsContainers = document.querySelectorAll('.mini_buttons.points.Sub .points');
        pointsContainers.forEach(container => this.#updatePointsContainerActiveState(container));
    }

    #updateEmojiContainerActiveState(emojiContainer) {
        if (!emojiContainer) return;

        const emojiCounter = emojiContainer.querySelector('.st-emoji-counter');
        const hasCount = emojiCounter && (
            (emojiCounter.dataset && emojiCounter.dataset.count && emojiCounter.dataset.count !== '0') ||
            (emojiCounter.textContent && emojiCounter.textContent.trim && emojiCounter.textContent.trim() !== '0' &&
                !isNaN(emojiCounter.textContent.trim()))
        );

        emojiContainer.classList.toggle('active', !!hasCount);
    }

    #updatePointsContainerActiveState(pointsContainer) {
        if (!pointsContainer) return;

        const hasEm = pointsContainer.querySelector('em');
        pointsContainer.classList.toggle('active', !!hasEm);
    }

    #handleCleanupTasks(node) {
        if (!node) return;

        const needsCleanup = node.matches('.bullet_delete') ||
            (node.textContent && node.textContent.includes('&nbsp;')) ||
            /^\s*$/.test(node.textContent || '');

        if (needsCleanup) {
            this.#cleanupAllMiniButtons();
        }
    }

    #handlePostTransformation(node) {
        if (!node) return;

        const needsTransformation = node.matches('.post') ||
            node.querySelector('.post') ||
            node.querySelector('.st-emoji') ||
            node.querySelector('.title2.bottom') ||
            node.querySelector('div[align="center"]:has(.quote_top)') ||
            node.querySelector('div.spoiler[align="center"]') ||
            node.querySelector('div[align="center"]:has(.code_top)');

        if (needsTransformation) {
            this.#transformPostElements();
        }
    }

    #handleSearchPostTransformation(node) {
        if (!node) return;

        const needsTransformation = node.matches('body#search .post') ||
            node.matches('body#search li.post') ||
            node.querySelector('body#search .post') ||
            node.querySelector('body#search li.post');

        if (needsTransformation) {
            this.#transformSearchPostElements();
        }
    }

    #cleanupAllMiniButtons() {
        const miniButtons = document.querySelectorAll('.mini_buttons.points.Sub');
        miniButtons.forEach(buttons => this.#cleanupMiniButtons(buttons));
    }

     #transformPostElements() {
        const posts = document.querySelectorAll('body#topic .post:not(.post-modernized), body#blog .post:not(.post-modernized)');
        const urlParams = new URLSearchParams(window.location.search);
        const startOffset = parseInt(urlParams.get('st') || '0');

        posts.forEach((post, index) => {
            if (post.closest('body#search')) return;

            post.classList.add('post-modernized');

            const fragment = document.createDocumentFragment();

            const anchorDiv = post.querySelector('.anchor');
            let anchorElements = null;
            if (anchorDiv) {
                anchorElements = anchorDiv.cloneNode(true);
                anchorDiv.remove();
            }

            const title2Top = post.querySelector('.title2.top');
            const miniButtons = title2Top ? title2Top.querySelector('.mini_buttons.points.Sub') : null;
            const stEmoji = title2Top ? title2Top.querySelector('.st-emoji.st-emoji-rep.st-emoji-post') : null;

            const postHeader = document.createElement('div');
            postHeader.className = 'post-header';

            const userInfo = document.createElement('div');
            userInfo.className = 'user-info';

            const postContent = document.createElement('div');
            postContent.className = 'post-content';

            const postFooter = document.createElement('div');
            postFooter.className = 'post-footer';

            if (anchorElements) {
                const anchorContainer = document.createElement('div');
                anchorContainer.className = 'anchor-container';
                anchorContainer.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
                anchorContainer.appendChild(anchorElements);
                postHeader.appendChild(anchorContainer);
            }

            if (!post.classList.contains('post_queue')) {
                const postNumber = document.createElement('span');
                postNumber.className = 'post-number';
                
                const hashIcon = document.createElement('i');
                hashIcon.className = 'fa-regular fa-hashtag';
                hashIcon.setAttribute('aria-hidden', 'true');
                
                const numberSpan = document.createElement('span');
                numberSpan.className = 'post-number-value';
                numberSpan.textContent = startOffset + index + 1;
                
                postNumber.appendChild(hashIcon);
                postNumber.appendChild(document.createTextNode(' '));
                postNumber.appendChild(numberSpan);
                
                postHeader.appendChild(postNumber);
            }

            this.#addNewPostBadge(post, postHeader);

            let nickElement = null;
            let groupValue = '';

            if (title2Top) {
                const tdWrapper = title2Top.closest('td.left.Item');
                nickElement = title2Top.querySelector('.nick');

                if (tdWrapper) {
                    const title2TopClone = title2Top.cloneNode(true);
                    title2TopClone.querySelector('.mini_buttons.points.Sub')?.remove();
                    title2TopClone.querySelector('.st-emoji.st-emoji-rep.st-emoji-post')?.remove();
                    title2TopClone.querySelector('.left.Item')?.remove();
                    this.#removeBreakAndNbsp(title2TopClone);
                    
                    this.#transformPostHeaderTimestamps(title2TopClone);
                    this.#transformTimestampElements(title2TopClone);
                    
                    postHeader.appendChild(title2TopClone);
                    tdWrapper.remove();
                } else {
                    const title2TopClone = title2Top.cloneNode(true);
                    title2TopClone.querySelector('.mini_buttons.points.Sub')?.remove();
                    title2TopClone.querySelector('.st-emoji.st-emoji-rep.st-emoji-post')?.remove();
                    title2TopClone.querySelector('.left.Item')?.remove();
                    this.#removeBreakAndNbsp(title2TopClone);
                    
                    this.#transformPostHeaderTimestamps(title2TopClone);
                    this.#transformTimestampElements(title2TopClone);
                    
                    postHeader.appendChild(title2TopClone);
                }
            }

            const centerElements = post.querySelectorAll('tr.center');
            centerElements.forEach(centerElement => {
                const leftSection = centerElement.querySelector('.left.Item');
                const rightSection = centerElement.querySelector('.right.Item');

                if (leftSection) {
                    const details = leftSection.querySelector('.details');
                    const avatar = leftSection.querySelector('.avatar');

                    // SPECIAL HANDLING: Check if this is a deleted user post
                    const isDeletedUser = post.classList.contains('box_visitatore');
                    
                    if (isDeletedUser) {
                        // For deleted users, we handle the structure differently
                        if (details) {
                            // Create a clean details clone
                            const detailsClone = details.cloneNode(true);
                            
                            // Process the deleted user details
                            this.#processDeletedUserDetails(detailsClone, nickElement);
                            
                            // Add the processed details to userInfo
                            userInfo.appendChild(detailsClone);
                        } else {
                            // Fallback: append the left section as-is
                            userInfo.appendChild(leftSection.cloneNode(true));
                        }
                    } 
                        
                    // NORMAL USER HANDLING
                    else if (details && avatar) {
                        const groupDd = details.querySelector('dl.u_group dd');
                        groupValue = groupDd && groupDd.textContent ? groupDd.textContent.trim() : '';

                        userInfo.appendChild(avatar.cloneNode(true));

                        const detailsClone = details.cloneNode(true);
                        detailsClone.querySelector('.avatar')?.remove();

                        if (nickElement) {
                            const nickClone = nickElement.cloneNode(true);
                            detailsClone.insertBefore(nickClone, detailsClone.firstChild);

                            if (groupValue) {
                                const badge = document.createElement('div');
                                badge.className = 'badge';
                                badge.textContent = groupValue;
                                nickClone.parentNode.insertBefore(badge, nickClone.nextSibling);
                            }
                        }

                        detailsClone.querySelector('span.u_title')?.remove();

                        let rankHTML = '';
                        const pWithURank = detailsClone.querySelector('p');
                        if (pWithURank && pWithURank.querySelector('span.u_rank')) {
                            rankHTML = pWithURank.querySelector('span.u_rank')?.innerHTML || '';
                            pWithURank.remove();
                        }

                        detailsClone.querySelector('br.br_status')?.remove();

                        const userStats = document.createElement('div');
                        userStats.className = 'user-stats';

                        const originalDetails = details.cloneNode(true);

                        if (rankHTML) {
                            const rankStat = document.createElement('div');
                            rankStat.className = 'stat rank';
                            rankStat.innerHTML = rankHTML;
                            userStats.appendChild(rankStat);
                        }

                        const postsDd = originalDetails.querySelector('dl.u_posts dd');
                        if (postsDd) {
                            const postsStat = this.#createStatElement('fa-regular fa-comments', postsDd.textContent.trim(), 'posts');
                            userStats.appendChild(postsStat);
                        }

                        const reputationDd = originalDetails.querySelector('dl.u_reputation dd');
                        if (reputationDd) {
                            const reputationStat = this.#createStatElement('fa-regular fa-thumbs-up', reputationDd.textContent.trim(), 'reputation');
                            userStats.appendChild(reputationStat);
                        }

                        const statusDl = originalDetails.querySelector('dl.u_status');
                        if (statusDl) {
                            const statusDd = statusDl.querySelector('dd');
                            const statusValue = statusDd && statusDd.textContent ? statusDd.textContent.trim() : '';
                            const isOnline = statusValue.toLowerCase().includes('online');
                            const originalStatusIcon = statusDl.querySelector('dd i');

                            let statusIconHTML = '';
                            if (originalStatusIcon) {
                                statusIconHTML = originalStatusIcon.outerHTML;
                                if (statusIconHTML.includes('<i ') && !statusIconHTML.includes('aria-hidden')) {
                                    statusIconHTML = statusIconHTML.replace('<i ', '<i aria-hidden="true" ');
                                }
                            } else {
                                statusIconHTML = '<i class="fa-regular fa-circle-user" aria-hidden="true"></i>';
                            }

                            const statusStat = document.createElement('div');
                            statusStat.className = 'stat status' + (isOnline ? ' online' : '');
                            statusStat.innerHTML = statusIconHTML + '<span>' + statusValue + '</span>';
                            userStats.appendChild(statusStat);
                        }

                        detailsClone.querySelectorAll('dl').forEach(dl => dl.remove());

                        if (userStats.children.length > 0) {
                            detailsClone.appendChild(userStats);
                        }

                        userInfo.appendChild(detailsClone);
                    } else {
                        userInfo.appendChild(leftSection.cloneNode(true));
                    }
                }

                if (rightSection) {
                    const contentWrapper = document.createElement('div');
                    contentWrapper.className = 'post-main-content';

                    const rightSectionClone = rightSection.cloneNode(true);
                    this.#removeBottomBorderAndBr(rightSectionClone);
                    this.#preserveMediaDimensions(rightSectionClone);

                    contentWrapper.appendChild(rightSectionClone);
                    this.#cleanupPostContentStructure(contentWrapper);
                    postContent.appendChild(contentWrapper);
                    this.#modernizeQuotes(contentWrapper);
                    this.#modernizeSpoilers(contentWrapper);
                    this.#modernizeCodeBlocksInContent(contentWrapper);
                    this.#modernizeAttachmentsInContent(contentWrapper);
                    this.#modernizeEmbeddedLinksInContent(contentWrapper);
                }
            });

            const title2Bottom = post.querySelector('.title2.bottom');
            
            if (post.classList.contains('post_queue')) {
            } else if (title2Bottom) {
                this.#addReputationToFooter(miniButtons, stEmoji, postFooter);
                this.#modernizeBottomElements(title2Bottom, postFooter);
                title2Bottom.remove();
            } else {
                this.#addReputationToFooter(miniButtons, stEmoji, postFooter);
            }

            fragment.appendChild(postHeader);
            fragment.appendChild(userInfo);
            fragment.appendChild(postContent);
            
            if (!post.classList.contains('post_queue')) {
                fragment.appendChild(postFooter);
            }

            post.innerHTML = '';
            post.appendChild(fragment);

            if (post.classList.contains('post_queue')) {
                this.#transformPostQueueButtons(post);
            } else {
                this.#convertMiniButtonsToButtons(post);
                this.#addShareButton(post);
            }
            
            this.#cleanupPostContent(post);

            const postId = post.id;
            if (postId && postId.startsWith('ee')) {
                post.setAttribute('data-post-id', postId.replace('ee', ''));
            }
        });
    }

    // NEW METHOD: Handle deleted user details for box_visitatore posts
   #processDeletedUserDetails(detailsElement, nickElement) {
        if (!detailsElement) {
            return;
        }
        
        // Save the elements we need before clearing
        const avatarContainer = detailsElement.querySelector('.forum-avatar-container, .deleted-user-container');
        const nickFromDetails = detailsElement.querySelector('.nick');
        const uTitleElement = detailsElement.querySelector('span.u_title');
        
        // Clear the existing content
        detailsElement.innerHTML = '';
        
        // Add avatar if it exists
        if (avatarContainer) {
            detailsElement.appendChild(avatarContainer.cloneNode(true));
        }
        
        // Add nick if it exists in details, otherwise use the one from title2Top
        if (nickFromDetails) {
            detailsElement.appendChild(nickFromDetails.cloneNode(true));
        } else if (nickElement) {
            // Fallback to nick from title2Top
            const nickClone = nickElement.cloneNode(true);
            detailsElement.appendChild(nickClone);
        }
        
        // Process the u_title element to create a badge
        if (uTitleElement) {
            // Extract text from u_title
            const titleText = this.#extractTextFromUTitle(uTitleElement);
            
            // Create badge if we have any text
            if (titleText) {
                const badge = document.createElement('div');
                badge.className = 'badge deleted-user-badge';
                badge.textContent = titleText;
                detailsElement.appendChild(badge);
            }
        }
        
        // Clean up any remaining empty elements
        this.#cleanEmptyElements(detailsElement);
    }
    
    // Helper method to extract text from u_title element
    #extractTextFromUTitle(uTitleElement) {
        if (!uTitleElement) return '';
        
        // Get all text nodes
        const textNodes = [];
        const walker = document.createTreeWalker(uTitleElement, NodeFilter.SHOW_TEXT, null, false);
        let node;
        
        while (node = walker.nextNode()) {
            const text = node.textContent.trim();
            if (text) {
                textNodes.push(text);
            }
        }
        
        // Join all text nodes
        let result = textNodes.join(' ').trim();
        
        // If the text contains "User deleted", we might want to clean it up
        if (result.toLowerCase().includes('user deleted')) {
            // Remove any <br> HTML tags from the text
            result = result.replace(/<br\s*\/?>/gi, ' ').trim();
            // Remove multiple spaces
            result = result.replace(/\s+/g, ' ');
            // Capitalize properly
            result = result.replace(/\b\w/g, char => char.toUpperCase());
        }
        
        return result;
    }
    
   #modernizeEmbeddedLinksInContent(contentWrapper) {
    // Skip editor content
    if (this.#isInEditor(contentWrapper)) {
        return;
    }
    
    contentWrapper.querySelectorAll('.ffb_embedlink').forEach(container => {
        if (container.classList.contains('embedded-link-modernized')) return;
        this.#transformEmbeddedLink(container);
        container.classList.add('embedded-link-modernized');
    });
}

    #transformPostQueueButtons(post) {
        const miniButtonsContainer = post.querySelector('.mini_buttons.rt.Sub');
        if (!miniButtonsContainer) return;

        const shareButton = miniButtonsContainer.querySelector('.btn-share, [data-action="share"]');
        if (shareButton) {
            shareButton.remove();
        }

        const editLink = miniButtonsContainer.querySelector('a[href*="act=edit"]');
        const removeLink = miniButtonsContainer.querySelector('a[onclick*="remove_cron"]');

        if (editLink) {
            editLink.classList.add('btn', 'btn-icon', 'btn-edit');
            editLink.setAttribute('data-action', 'edit');
            editLink.setAttribute('title', 'Edit');
            editLink.innerHTML = '<i class="fa-regular fa-pen-to-square" aria-hidden="true"></i>';
        }

        if (removeLink) {
            removeLink.classList.add('btn', 'btn-icon', 'btn-delete');
            removeLink.setAttribute('data-action', 'delete');
            removeLink.setAttribute('title', 'Remove');
            removeLink.innerHTML = '<i class="fa-regular fa-eraser" aria-hidden="true"></i>';
            
            removeLink.removeAttribute('style');
        }

        this.#reorderPostQueueButtons(miniButtonsContainer);
    }

    #reorderPostQueueButtons(container) {
        const elements = Array.from(container.children);
        const order = ['edit', 'delete'];

        elements.sort((a, b) => {
            const getAction = (element) => {
                const dataAction = element.getAttribute('data-action');
                if (dataAction && order.includes(dataAction)) return dataAction;

                if (element.classList.contains('btn-edit')) return 'edit';
                if (element.classList.contains('btn-delete')) return 'delete';

                if (element.href && element.href.includes('act=edit')) return 'edit';
                if (element.onclick && element.onclick.toString().includes('remove_cron')) return 'delete';

                return 'other';
            };

            const actionA = getAction(a);
            const actionB = getAction(b);
            const indexA = order.indexOf(actionA);
            const indexB = order.indexOf(actionB);

            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0;
        });

        container.innerHTML = '';
        elements.forEach(el => container.appendChild(el));
    }

    #modernizeAttachmentsInContent(contentWrapper) {
        contentWrapper.querySelectorAll('.fancytop + div[align="center"], .fancytop + .fancyborder').forEach(container => {
            if (container.classList.contains('attachment-modernized')) return;
            this.#transformAttachment(container);
            container.classList.add('attachment-modernized');
        });
    }

    #transformSearchPostElements() {
        const posts = document.querySelectorAll('body#search .post:not(.post-modernized), body#search li.post:not(.post-modernized)');

        posts.forEach((post, index) => {
            post.classList.add('post-modernized', 'search-post');

            const anchorDiv = post.querySelector('.anchor');
            let anchorElements = null;
            if (anchorDiv) {
                anchorElements = anchorDiv.cloneNode(true);
                anchorDiv.remove();
            }

            const title2Top = post.querySelector('.title2.top');
            const pointsElement = post.querySelector('.points');

            let contentHTML = '';
            const colorTable = post.querySelector('table.color');

            if (colorTable) {
                const tds = colorTable.querySelectorAll('td');
                tds.forEach(td => {
                    if (td.innerHTML && td.innerHTML.trim() !== '' && td.innerHTML.trim() !== '<br>') {
                        contentHTML += td.outerHTML;
                    }
                });
            }

            if (!contentHTML) {
                const contentElement = post.querySelector('td.Item table.color td') ||
                    post.querySelector('td.Item td') ||
                    post.querySelector('.color td') ||
                    post.querySelector('td[align]');

                if (contentElement && contentElement.innerHTML && contentElement.innerHTML.trim() !== '') {
                    contentHTML = contentElement.outerHTML;
                }
            }

            const editElement = post.querySelector('span.edit');
            const rtSub = post.querySelector('.rt.Sub');

            const postHeader = document.createElement('div');
            postHeader.className = 'post-header';

            const postContent = document.createElement('div');
            postContent.className = 'post-content search-post-content';

            const postFooter = document.createElement('div');
            postFooter.className = 'post-footer search-post-footer';

            if (anchorElements) {
                const anchorContainer = document.createElement('div');
                anchorContainer.className = 'anchor-container';
                anchorContainer.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
                anchorContainer.appendChild(anchorElements);
                postHeader.appendChild(anchorContainer);
            }

            if (!post.classList.contains('post_queue')) {
                const postNumber = document.createElement('span');
                postNumber.className = 'post-number';
                
                const hashIcon = document.createElement('i');
                hashIcon.className = 'fa-regular fa-hashtag';
                hashIcon.setAttribute('aria-hidden', 'true');
                
                const numberSpan = document.createElement('span');
                numberSpan.className = 'post-number-value';
                numberSpan.textContent = index + 1;
                
                postNumber.appendChild(hashIcon);
                postNumber.appendChild(document.createTextNode(' '));
                postNumber.appendChild(numberSpan);
                
                postHeader.appendChild(postNumber);
            }

            this.#addNewPostBadge(post, postHeader);

            if (title2Top) {
                const title2TopClone = title2Top.cloneNode(true);
                const pointsInTitle = title2TopClone.querySelector('.points');
                pointsInTitle?.remove();

                let locationDiv = null;
                if (rtSub) {
                    const topicLink = rtSub.querySelector('a[href*="?t="]');
                    const forumLink = rtSub.querySelector('a[href*="?f="]');

                    if (topicLink || forumLink) {
                        locationDiv = document.createElement('div');
                        locationDiv.className = 'post-location';

                        if (topicLink) {
                            const topicSpan = document.createElement('span');
                            topicSpan.className = 'topic-link';
                            topicSpan.innerHTML = '<i class="fa-regular fa-file-lines" aria-hidden="true"></i> ' + topicLink.textContent;
                            locationDiv.appendChild(topicSpan);
                        }

                        if (forumLink) {
                            const forumSpan = document.createElement('span');
                            forumSpan.className = 'forum-link';
                            forumSpan.innerHTML = '<i class="fa-regular fa-folder" aria-hidden="true"></i> ' + forumLink.textContent;
                            if (topicLink) {
                                locationDiv.appendChild(document.createTextNode(' - '));
                            }
                            locationDiv.appendChild(forumSpan);
                        }

                        title2TopClone.querySelector('.rt.Sub')?.remove();
                    }
                }

                this.#removeBreakAndNbsp(title2TopClone);
                title2TopClone.querySelector('.Break.Sub')?.remove();

                this.#transformPostHeaderTimestamps(title2TopClone);
                this.#transformTimestampElements(title2TopClone);

                const tdWrapper = title2TopClone.querySelector('td.Item.Justify');
                if (tdWrapper) {
                    const divs = tdWrapper.querySelectorAll('div');
                    divs.forEach(div => {
                        postHeader.appendChild(div.cloneNode(true));
                    });
                    tdWrapper.remove();

                    if (locationDiv) {
                        postHeader.appendChild(locationDiv);
                    }
                } else {
                    if (locationDiv) {
                        title2TopClone.appendChild(locationDiv);
                    }
                    postHeader.appendChild(title2TopClone);
                }
            }

            if (contentHTML) {
                const contentWrapper = document.createElement('div');
                contentWrapper.className = 'post-main-content';

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = contentHTML;

                if (tempDiv.children.length === 1 && tempDiv.firstElementChild && tempDiv.firstElementChild.tagName === 'DIV') {
                    const wrapperDiv = tempDiv.firstElementChild;
                    const hasQuote = wrapperDiv.querySelector('.quote_top');

                    if (!hasQuote) {
                        while (wrapperDiv.firstChild) {
                            tempDiv.appendChild(wrapperDiv.firstChild);
                        }
                        wrapperDiv.remove();
                    }
                }

                while (tempDiv.firstChild) {
                    contentWrapper.appendChild(tempDiv.firstChild);
                }

                this.#preserveMediaDimensions(contentWrapper);

                const walker = document.createTreeWalker(contentWrapper, NodeFilter.SHOW_TEXT, null, false);
                const textNodes = [];
                let node;

                while (node = walker.nextNode()) {
                    if (node.textContent.trim() !== '') {
                        textNodes.push(node);
                    }
                }

                const urlParams = new URLSearchParams(window.location.search);
                const searchQuery = urlParams.get('q');
                if (searchQuery) {
                    textNodes.forEach(textNode => {
                        const text = textNode.textContent;
                        const searchRegex = new RegExp('(' + this.#escapeRegex(searchQuery) + ')', 'gi');
                        const highlightedText = text.replace(searchRegex, '<mark class="search-highlight">$1</mark>');

                        if (highlightedText !== text) {
                            const span = document.createElement('span');
                            span.innerHTML = highlightedText;
                            textNode.parentNode.replaceChild(span, textNode);
                        }
                    });
                }

                this.#processTextAndLineBreaks(contentWrapper);
                this.#cleanupSearchPostContent(contentWrapper);

                const editSpanInContent = contentWrapper.querySelector('span.edit');
                if (editSpanInContent) {
                    this.#transformEditTimestamp(editSpanInContent);
                }

                this.#modernizeQuotes(contentWrapper);
                this.#modernizeSpoilers(contentWrapper);
                this.#modernizeCodeBlocksInContent(contentWrapper);
                this.#modernizeAttachmentsInContent(contentWrapper);
                this.#modernizeEmbeddedLinksInContent(contentWrapper);

                postContent.appendChild(contentWrapper);
            }

            const postFooterActions = document.createElement('div');
            postFooterActions.className = 'post-actions';

            let pointsFooter;
            if (pointsElement && pointsElement.innerHTML.trim() !== '') {
                const pointsClone = pointsElement.cloneNode(true);
                pointsFooter = pointsClone;

                const emElement = pointsFooter.querySelector('em');
                const linkElement = pointsFooter.querySelector('a');
                const href = linkElement ? linkElement.getAttribute('href') : null;

                let pointsValue = '0';
                let pointsClass = 'points_pos';

                if (emElement) {
                    pointsValue = emElement.textContent.trim();
                    pointsClass = emElement.className;
                }

                const newPoints = document.createElement('div');
                newPoints.className = 'points active';
                newPoints.id = pointsElement.id || '';

                if (href) {
                    const link = document.createElement('a');
                    link.href = href;
                    link.setAttribute('tabindex', '0');
                    if (linkElement && linkElement.getAttribute('rel')) {
                        link.setAttribute('rel', linkElement.getAttribute('rel'));
                    }

                    const em = document.createElement('em');
                    em.className = pointsClass;
                    em.textContent = pointsValue;
                    link.appendChild(em);
                    newPoints.appendChild(link);
                } else {
                    const em = document.createElement('em');
                    em.className = pointsClass;
                    em.textContent = pointsValue;
                    newPoints.appendChild(em);
                }

                const thumbsSpan = document.createElement('span');
                thumbsSpan.className = 'points_up opacity';

                const icon = document.createElement('i');
                if (pointsClass === 'points_pos') {
                    thumbsSpan.classList.add('active');
                    icon.className = 'fa-regular fa-thumbs-up';
                } else if (pointsClass === 'points_neg') {
                    icon.className = 'fa-regular fa-thumbs-down';
                } else {
                    icon.className = 'fa-regular fa-thumbs-up';
                }

                icon.setAttribute('aria-hidden', 'true');
                thumbsSpan.appendChild(icon);
                newPoints.appendChild(thumbsSpan);

                pointsFooter = newPoints;
            } else {
                const noPoints = document.createElement('div');
                noPoints.className = 'points no_points';

                const em = document.createElement('em');
                em.className = 'points_pos';
                em.textContent = '0';
                noPoints.appendChild(em);

                const thumbsSpan = document.createElement('span');
                thumbsSpan.className = 'points_up opacity';

                const icon = document.createElement('i');
                icon.className = 'fa-regular fa-thumbs-up';
                icon.setAttribute('aria-hidden', 'true');

                thumbsSpan.appendChild(icon);
                noPoints.appendChild(thumbsSpan);

                pointsFooter = noPoints;
            }

            postFooterActions.appendChild(pointsFooter);
            postFooter.appendChild(postFooterActions);

            const shareContainer = document.createElement('div');
            shareContainer.className = 'modern-bottom-actions';

            const shareButton = document.createElement('button');
            shareButton.className = 'btn btn-icon btn-share';
            shareButton.setAttribute('data-action', 'share');
            shareButton.setAttribute('title', 'Share this post');
            shareButton.setAttribute('type', 'button');
            shareButton.innerHTML = '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>';

            shareButton.addEventListener('click', () => this.#handleShareSearchPost(post));

            shareContainer.appendChild(shareButton);
            postFooter.appendChild(shareContainer);

            const newPost = document.createElement('div');
            newPost.className = 'post post-modernized search-post';
            newPost.id = post.id;

            Array.from(post.attributes).forEach(attr => {
                if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'id') {
                    return;
                }
                newPost.setAttribute(attr.name, attr.value);
            });

            Array.from(post.attributes).forEach(attr => {
                if (attr.name.startsWith('data-')) {
                    newPost.setAttribute(attr.name, attr.value);
                }
            });

            const originalClasses = post.className.split(' ').filter(cls =>
                !cls.includes('post-modernized') && !cls.includes('search-post')
            );
            newPost.className = originalClasses.concat(['post', 'post-modernized', 'search-post']).join(' ');

            newPost.appendChild(postHeader);
            newPost.appendChild(postContent);
            newPost.appendChild(postFooter);

            post.parentNode.replaceChild(newPost, post);
            this.#updatePointsContainerActiveState(pointsFooter);
        });
    }

   #cleanupSearchPostContent(contentWrapper) {
    // Skip if in editor
    if (this.#isInEditor(contentWrapper)) {
        return;
    }
    
    contentWrapper.querySelectorAll('table, tbody, tr, td').forEach(el => {
        if (el.tagName === 'TD' && el.children.length === 0 && el.textContent.trim() === '') {
            el.remove();
        } else if (el.tagName === 'TABLE' || el.tagName === 'TBODY' || el.tagName === 'TR') {
            const parent = el.parentNode;
            if (parent) {
                while (el.firstChild) {
                    parent.insertBefore(el.firstChild, el);
                }
                el.remove();
            }
        }
    });

    contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top)').forEach(container => {
        if (container.classList.contains('quote-modernized')) return;
        this.#transformQuote(container);
        container.classList.add('quote-modernized');
    });

    contentWrapper.querySelectorAll('div[align="center"].spoiler').forEach(container => {
        if (container.classList.contains('spoiler-modernized')) return;
        this.#transformSpoiler(container);
        container.classList.add('spoiler-modernized');
    });

    contentWrapper.querySelectorAll('div[align="center"]:has(.code_top)').forEach(container => {
        if (container.classList.contains('code-modernized')) return;
        this.#transformCodeBlock(container);
        container.classList.add('code-modernized');
    });

    contentWrapper.querySelectorAll('.fancytop + div[align="center"], .fancytop + .fancyborder').forEach(container => {
        if (container.classList.contains('attachment-modernized')) return;
        this.#transformAttachment(container);
        container.classList.add('attachment-modernized');
    });

    contentWrapper.querySelectorAll('.ffb_embedlink').forEach(container => {
        if (container.classList.contains('embedded-link-modernized')) return;
        this.#transformEmbeddedLink(container);
        container.classList.add('embedded-link-modernized');
    });
}

    #escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    #handleShareSearchPost(post) {
        let postLink = null;

        const postLinkElement = post.querySelector('.post-header a[href*="#entry"]');
        if (postLinkElement) {
            postLink = postLinkElement.href;
        }

        if (!postLink) {
            const postIdMatch = post.id.match(/\d+/);
            if (postIdMatch) {
                const postId = postIdMatch[0];
                const topicLink = post.querySelector('.topic-link');
                if (topicLink) {
                    const topicMatch = topicLink.textContent.match(/t=(\d+)/);
                    if (topicMatch) {
                        postLink = window.location.origin + '/?t=' + topicMatch[1] + '#entry' + postId;
                    }
                }
            }
        }

        if (postLink) {
            this.#copyPostLinkToClipboard(postLink);
        } else {
            this.#showCopyNotification('Could not find post link');
        }
    }

    #removeInvalidTableStructure(element) {
        element.querySelectorAll('td.right.Item').forEach(td => {
            while (td.firstChild) {
                td.parentNode.insertBefore(td.firstChild, td);
            }
            td.remove();
        });

        element.querySelectorAll('table.color:empty').forEach(table => table.remove());
    }

   #cleanupPostContentStructure(contentElement) {
    // Skip if in editor
    if (this.#isInEditor(contentElement)) {
        return;
    }
    
    contentElement.querySelectorAll('.ve-table').forEach(table => {
        this.#protectAndRepairTable(table);
    });

    contentElement.querySelectorAll('.post-main-content > td').forEach(td => {
        while (td.firstChild) {
            contentElement.appendChild(td.firstChild);
        }
        td.remove();
    });

    contentElement.querySelectorAll('td').forEach(td => {
        const parent = td.parentNode;
        if (parent && !td.closest('.ve-table')) {
            while (td.firstChild) {
                parent.insertBefore(td.firstChild, td);
            }
            td.remove();
        }
    });

    contentElement.querySelectorAll('tr').forEach(tr => {
        const parent = tr.parentNode;
        if (parent && !tr.closest('.ve-table')) {
            while (tr.firstChild) {
                parent.insertBefore(tr.firstChild, tr);
            }
            tr.remove();
        }
    });

    contentElement.querySelectorAll('tbody').forEach(tbody => {
        const parent = tbody.parentNode;
        if (parent && !tbody.closest('.ve-table')) {
            while (tbody.firstChild) {
                parent.insertBefore(tbody.firstChild, tbody);
            }
            tbody.remove();
        }
    });

    contentElement.querySelectorAll('table:not(.ve-table)').forEach(table => {
        const parent = table.parentNode;
        if (parent) {
            while (table.firstChild) {
                parent.insertBefore(table.firstChild, table);
            }
            table.remove();
        }
    });

    this.#cleanUpLineBreaksBetweenBlocks(contentElement);
    this.#cleanEmptyElements(contentElement);
    this.#processTextAndLineBreaks(contentElement);
    this.#cleanupEditSpans(contentElement);
    this.#processSignature(contentElement);
    this.#cleanInvalidAttributes(contentElement);
}

#protectAndRepairTable(table) {
    table.setAttribute('data-table-protected', 'true');
    
    if (!table.querySelector('tbody')) {
        const tbody = document.createElement('tbody');
        const rows = [];
        let currentRow = null;
        
        Array.from(table.children).forEach(child => {
            if (child.tagName === 'TR') {
                if (currentRow) {
                    rows.push(currentRow);
                    currentRow = null;
                }
                rows.push(child);
            } else if (child.tagName === 'TH' || child.tagName === 'TD') {
                if (!currentRow) {
                    currentRow = document.createElement('tr');
                }
                currentRow.appendChild(child);
            } else if (child.tagName === 'TBODY') {
                tbody = child;
                return;
            }
        });
        
        if (currentRow) {
            rows.push(currentRow);
        }
        
        rows.forEach(row => tbody.appendChild(row));
        
        table.innerHTML = '';
        table.appendChild(tbody);
    }
    
    table.querySelectorAll('th, td').forEach(cell => {
        const existingSpans = cell.querySelectorAll('.post-text');
        existingSpans.forEach(span => {
            while (span.firstChild) {
                cell.insertBefore(span.firstChild, span);
            }
            span.remove();
        });
        
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null, false);
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.trim()) {
                textNodes.push(node);
            }
        }
        
        textNodes.forEach(textNode => {
            const span = document.createElement('span');
            span.className = 'post-text';
            span.textContent = textNode.textContent;
            textNode.parentNode.replaceChild(span, textNode);
        });
        
        if (cell.children.length === 0 && !cell.textContent.trim()) {
            const span = document.createElement('span');
            span.className = 'post-text';
            cell.appendChild(span);
        }
    });
    
    table.removeAttribute('style');
    table.removeAttribute('cellpadding');
    table.removeAttribute('cellspacing');
    table.removeAttribute('border');
    
    table.querySelectorAll('th[rowspan="1"], td[rowspan="1"]').forEach(cell => {
        cell.removeAttribute('rowspan');
    });
    table.querySelectorAll('th[colspan="1"], td[colspan="1"]').forEach(cell => {
        cell.removeAttribute('colspan');
    });
    
    if (!table.parentElement || !table.parentElement.classList.contains('table-container')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'table-container';
        
        const tableClasses = Array.from(table.classList).filter(cls => cls !== 've-table');
        if (tableClasses.length > 0) {
            wrapper.classList.add(...tableClasses);
        }
        
        table.parentNode.insertBefore(wrapper, table);
        
        wrapper.appendChild(table);
    }
    
    table.classList.add('ve-table');
}
    
  #cleanupEditSpans(element) {
    // Skip if in editor
    if (this.#isInEditor(element)) return;
    
    element.querySelectorAll('span.edit').forEach(span => {
        if (span.querySelector('time[datetime]')) {
            return;
        }
        
        this.#transformEditTimestamp(span);
    });
}

#cleanUpLineBreaksBetweenBlocks(element) {
    // Skip if in editor
    if (this.#isInEditor(element)) return;
    
    const blockSelectors = [
        '.modern-spoiler',
        '.modern-code',
        '.modern-quote',
        'div[align="center"]:has(.code_top)',
        'div[align="center"].spoiler',
        'div[align="center"]:has(.quote_top)',
        '.modern-attachment',
        '.modern-embedded-link'
    ];

    const blocks = Array.from(element.querySelectorAll(blockSelectors.join(', ')));
    blocks.sort((a, b) => {
        const position = a.compareDocumentPosition(b);
        return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    blocks.forEach(block => {
        let nextSibling = block.nextSibling;
        while (nextSibling) {
            if (nextSibling.nodeType === Node.ELEMENT_NODE &&
                nextSibling.tagName === 'BR') {
                const brToRemove = nextSibling;
                nextSibling = nextSibling.nextSibling;
                brToRemove.remove();
            } else if (nextSibling.nodeType === Node.TEXT_NODE &&
                /^\s*$/.test(nextSibling.textContent)) {
                const textToRemove = nextSibling;
                nextSibling = nextSibling.nextSibling;
                textToRemove.remove();
            } else {
                break;
            }
        }
    });

    blocks.forEach(block => {
        let prevSibling = block.previousSibling;
        while (prevSibling) {
            if (prevSibling.nodeType === Node.ELEMENT_NODE &&
                prevSibling.tagName === 'BR') {
                const brToRemove = prevSibling;
                prevSibling = prevSibling.previousSibling;
                brToRemove.remove();
            } else if (prevSibling.nodeType === Node.TEXT_NODE &&
                /^\s*$/.test(prevSibling.textContent)) {
                const textToRemove = prevSibling;
                prevSibling = prevSibling.previousSibling;
                textToRemove.remove();
            } else {
                break;
            }
        }
    });
}

#cleanEmptyElements(element) {
    // Skip if in editor
    if (this.#isInEditor(element)) return;
    
    element.querySelectorAll(':empty').forEach(emptyEl => {
        if (!['IMG', 'BR', 'HR', 'INPUT', 'META', 'LINK'].includes(emptyEl.tagName)) {
            emptyEl.remove();
        }
    });

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const nodesToRemove = [];
    let node;

    while (node = walker.nextNode()) {
        if (node.textContent.trim() === '') {
            nodesToRemove.push(node);
        }
    }

    nodesToRemove.forEach(node => node.parentNode && node.parentNode.removeChild(node));
}

 #cleanInvalidAttributes(element) {
    // Skip if in editor
    if (this.#isInEditor(element)) return;
    
    element.querySelectorAll('[width]').forEach(el => {
        if (!['IMG', 'IFRAME', 'VIDEO', 'CANVAS', 'TABLE', 'TD', 'TH'].includes(el.tagName)) {
            el.removeAttribute('width');
        }
    });

    element.querySelectorAll('[cellpadding], [cellspacing]').forEach(el => {
        if (el.tagName !== 'TABLE') {
            el.removeAttribute('cellpadding');
            el.removeAttribute('cellspacing');
        }
    });
}

    #processTextAndLineBreaks(element) {
    // Skip if in editor
    if (this.#isInEditor(element)) return;
    
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let node;

    while (node = walker.nextNode()) {
        if (node.textContent.trim() !== '') {
            textNodes.push(node);
        }
    }

    textNodes.forEach(textNode => {
        if (textNode.parentNode && (!textNode.parentNode.classList || !textNode.parentNode.classList.contains('post-text'))) {
            const span = document.createElement('span');
            span.className = 'post-text';
            span.textContent = textNode.textContent;
            textNode.parentNode.replaceChild(span, textNode);
        }
    });

    element.querySelectorAll('br').forEach(br => {
        const prevSibling = br.previousElementSibling;
        const nextSibling = br.nextElementSibling;

        if (br.closest('.modern-spoiler, .modern-code, .modern-quote, .code-header, .spoiler-header, .quote-header, .modern-attachment, .attachment-header, .modern-embedded-link')) {
            return;
        }

        if (prevSibling && nextSibling) {
            const prevIsPostText = prevSibling.classList && prevSibling.classList.contains('post-text');
            const nextIsPostText = nextSibling.classList && nextSibling.classList.contains('post-text');

            if (prevIsPostText && nextIsPostText) {
                prevSibling.classList.add('paragraph-end');
                br.remove();
            } else {
                const prevIsModern = prevSibling.closest('.modern-spoiler, .modern-code, .modern-quote, .modern-attachment, .modern-embedded-link');
                const nextIsModern = nextSibling.closest('.modern-spoiler, .modern-code, .modern-quote, .modern-attachment, .modern-embedded-link');

                if (prevIsModern && nextIsModern) {
                    br.remove();
                } else {
                    br.style.cssText = 'margin:0;padding:0;display:block;content:\'\';height:0.75em;margin-bottom:0.25em';
                }
            }
        } else {
            br.remove();
        }
    });

    const postTextElements = element.querySelectorAll('.post-text');
    for (let i = 0; i < postTextElements.length - 1; i++) {
        const current = postTextElements[i];
        const next = postTextElements[i + 1];

        let nodeBetween = current.nextSibling;
        let onlyWhitespace = true;

        while (nodeBetween && nodeBetween !== next) {
            if (nodeBetween.nodeType === Node.TEXT_NODE && nodeBetween.textContent.trim() !== '') {
                onlyWhitespace = false;
                break;
            }
            nodeBetween = nodeBetween.nextSibling;
        }

        if (onlyWhitespace) {
            current.classList.add('paragraph-end');
        }
    }
}

 #processSignature(element) {
    // Skip if in editor
    if (this.#isInEditor(element)) return;
    
    element.querySelectorAll('.signature').forEach(sig => {
        sig.classList.add('post-signature');
        sig.previousElementSibling && sig.previousElementSibling.tagName === 'BR' && sig.previousElementSibling.remove();
    });
}

    #modernizeQuotes(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"]:has(.quote_top)').forEach(container => {
            if (container.classList.contains('quote-modernized')) return;
            this.#transformQuote(container);
            container.classList.add('quote-modernized');
        });
    }

    #modernizeSpoilers(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"].spoiler').forEach(container => {
            if (container.classList.contains('spoiler-modernized')) return;
            this.#transformSpoiler(container);
            container.classList.add('spoiler-modernized');
        });
    }

    #modernizeCodeBlocksInContent(contentWrapper) {
        contentWrapper.querySelectorAll('div[align="center"]:has(.code_top)').forEach(container => {
            if (container.classList.contains('code-modernized')) return;
            this.#transformCodeBlock(container);
            container.classList.add('code-modernized');
        });
    }

    #transformQuote(container) {
        const quoteTop = container.querySelector('.quote_top');
        const quoteContent = container.querySelector('.quote');

        if (!quoteTop || !quoteContent) return;

        const quoteText = quoteTop.textContent.trim();
        const match = quoteText.match(/QUOTE\s*\(([^@]+)\s*@/);
        const author = match ? match[1].trim() : 'Unknown';
        const quoteLink = quoteTop.querySelector('a');
        const linkHref = quoteLink ? quoteLink.href : '#';
        const isLongContent = this.#isLongContent(quoteContent);

        const modernQuote = document.createElement('div');
        modernQuote.className = 'modern-quote' + (isLongContent ? ' long-quote' : '');

        let html = '<div class="quote-header">' +
            '<div class="quote-meta">' +
            '<div class="quote-icon">' +
            '<i class="fa-regular fa-quote-left" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="quote-info">' +
            '<span class="quote-author">' + this.#escapeHtml(author) + ' <span class="quote-said">said:</span></span>' +
            '</div>' +
            '</div>' +
            '<a href="' + this.#escapeHtml(linkHref) + '" class="quote-link" title="Go to post" tabindex="0">' +
            '<i class="fa-regular fa-chevron-up" aria-hidden="true"></i>' +
            '</a>' +
            '</div>';

        html += '<div class="quote-content' + (isLongContent ? ' collapsible-content' : '') + '">' +
            this.#preserveMediaDimensionsInHTML(quoteContent.innerHTML) +
            '</div>';

        if (isLongContent) {
            html += '<button class="quote-expand-btn" type="button" aria-label="Show full quote">' +
                '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
                'Show more' +
                '</button>';
        }

        modernQuote.innerHTML = html;
        container.replaceWith(modernQuote);

        if (isLongContent) {
            this.#addQuoteEventListeners(modernQuote);
        }

        setTimeout(() => {
            const quoteLink = modernQuote.querySelector('.quote-link');
            if (quoteLink) {
                this.#enhanceSingleQuoteLink(quoteLink);
            }
        }, 10);
    }

    #transformSpoiler(container) {
        const spoilerTop = container.querySelector('.code_top');
        const spoilerContent = container.querySelector('.code[align="left"]');

        if (!spoilerTop || !spoilerContent) return;

        const isLongContent = this.#isLongContent(spoilerContent);

        const modernSpoiler = document.createElement('div');
        modernSpoiler.className = 'modern-spoiler';

        let html = '<div class="spoiler-header" role="button" tabindex="0" aria-expanded="false">' +
            '<div class="spoiler-icon">' +
            '<i class="fa-regular fa-eye-slash" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="spoiler-info">' +
            '<span class="spoiler-title">SPOILER</span>' +
            '</div>' +
            '<button class="spoiler-toggle" type="button" aria-label="Toggle spoiler">' +
            '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
            '</button>' +
            '</div>';

        html += '<div class="spoiler-content' +
            (isLongContent ? ' collapsible-content' : '') + '">' +
            this.#preserveMediaDimensionsInHTML(spoilerContent.innerHTML) +
            '</div>';

        if (isLongContent) {
            html += '<button class="spoiler-expand-btn" type="button" aria-label="Show full spoiler content">' +
                '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
                'Show more' +
                '</button>';
        }

        modernSpoiler.innerHTML = html;
        container.replaceWith(modernSpoiler);

        this.#addSpoilerEventListeners(modernSpoiler, isLongContent);
    }

    #addSpoilerEventListeners(spoilerElement, isLongContent = false) {
        const spoilerHeader = spoilerElement.querySelector('.spoiler-header');
        const spoilerToggle = spoilerElement.querySelector('.spoiler-toggle');
        const expandBtn = spoilerElement.querySelector('.spoiler-expand-btn');
        const spoilerContent = spoilerElement.querySelector('.spoiler-content');
        const chevronIcon = spoilerToggle ? spoilerToggle.querySelector('i') : null;

        spoilerContent.style.maxHeight = '0';
        spoilerContent.style.padding = '0 16px';
        spoilerHeader.setAttribute('aria-expanded', 'false');

        if (chevronIcon) {
            chevronIcon.style.transform = 'rotate(0deg)';
        }

        if (isLongContent && expandBtn) {
            expandBtn.style.display = 'flex';
        }

        const toggleSpoiler = (shouldExpand = null) => {
            const isExpanded = shouldExpand !== null ? shouldExpand : !spoilerElement.classList.contains('expanded');

            if (isExpanded) {
                spoilerElement.classList.add('expanded');
                spoilerHeader.setAttribute('aria-expanded', 'true');

                if (chevronIcon) {
                    chevronIcon.style.transform = 'rotate(180deg)';
                }

                if (isLongContent) {
                    spoilerContent.style.maxHeight = '250px';
                    spoilerContent.style.padding = '16px';

                    if (expandBtn) {
                        expandBtn.style.display = 'none';
                    }
                } else {
                    spoilerContent.style.maxHeight = spoilerContent.scrollHeight + 'px';
                    spoilerContent.style.padding = '16px';
                    setTimeout(() => {
                        spoilerContent.style.maxHeight = 'none';
                    }, 300);
                }
            } else {
                spoilerElement.classList.remove('expanded');
                spoilerHeader.setAttribute('aria-expanded', 'false');

                if (chevronIcon) {
                    chevronIcon.style.transform = 'rotate(0deg)';
                }

                if (isLongContent) {
                    spoilerContent.style.maxHeight = '250px';
                    void spoilerContent.offsetHeight;
                    spoilerContent.style.maxHeight = '0';
                    spoilerContent.style.padding = '0 16px';
                } else {
                    spoilerContent.style.maxHeight = spoilerContent.scrollHeight + 'px';
                    void spoilerContent.offsetHeight;
                    spoilerContent.style.maxHeight = '0';
                    spoilerContent.style.padding = '0 16px';
                }

                if (isLongContent && expandBtn) {
                    setTimeout(() => {
                        expandBtn.style.display = 'flex';
                    }, 300);
                }
            }
        };

        spoilerHeader.addEventListener('click', () => toggleSpoiler());
        if (spoilerToggle) {
            spoilerToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSpoiler();
            });
        }

        spoilerHeader.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleSpoiler();
            }
        });

        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                toggleSpoiler(true);

                if (isLongContent && spoilerContent.scrollHeight > 250) {
                    spoilerContent.style.maxHeight = spoilerContent.scrollHeight + 'px';
                    setTimeout(() => {
                        spoilerContent.style.maxHeight = 'none';
                    }, 300);
                }
            });
        }
    }

    #isLongContent(contentElement) {
        const clone = contentElement.cloneNode(true);
        const textLength = clone.textContent.trim().length;
        const mediaElements = clone.querySelectorAll('img, iframe, video, object, embed');
        const mediaCount = mediaElements.length;
        const totalElements = clone.querySelectorAll('*').length;

        let contentScore = 0;

        if (textLength > 800) contentScore += 3;
        else if (textLength > 500) contentScore += 2;
        else if (textLength > 300) contentScore += 1;

        if (mediaCount >= 3) contentScore += 3;
        else if (mediaCount >= 2) contentScore += 2;
        else if (mediaCount >= 1) contentScore += 1;

        if (totalElements > 20) contentScore += 2;
        else if (totalElements > 10) contentScore += 1;

        const hasIframeOrVideo = clone.querySelector('iframe, video');
        if (hasIframeOrVideo) contentScore += 3;

        const images = clone.querySelectorAll('img');
        if (images.length >= 2) {
            let totalPixelArea = 0;
            images.forEach(img => {
                const width = parseInt(img.getAttribute('width')) || 0;
                const height = parseInt(img.getAttribute('height')) || 0;
                totalPixelArea += width * height;
            });
            if (totalPixelArea > 500000) contentScore += 2;
        }

        return contentScore >= 4;
    }

    #preserveMediaDimensionsInHTML(html) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        this.#preserveMediaDimensions(tempDiv);
        return tempDiv.innerHTML;
    }

#preserveMediaDimensions(element) {
    element.querySelectorAll('img').forEach(img => {
        // DO NOT set width/height styles here - your other scripts handle this
        
        // Only set max-width to prevent overflow
        if (!img.style.maxWidth) {
            img.style.maxWidth = '100%';
        }
        
        // Remove any height style that might interfere with aspect-ratio
        img.style.removeProperty('height');
        
        const isTwemoji = img.src.includes('twemoji') || img.classList.contains('twemoji');
        const isEmoji = img.src.includes('emoji') || img.src.includes('smiley') || 
                       (img.src.includes('imgbox') && img.alt && img.alt.includes('emoji')) ||
                       img.className.includes('emoji');
        
        if (isTwemoji || isEmoji) {
            img.style.display = 'inline-block';
            img.style.verticalAlign = 'text-bottom';
            img.style.margin = '0 2px';
        } else if (!img.style.display || img.style.display === 'inline') {
            img.style.display = 'block';
        }
        
        if (!img.hasAttribute('alt')) {
            if (isEmoji) {
                img.setAttribute('alt', 'Emoji');
                img.setAttribute('role', 'img');
            } else {
                img.setAttribute('alt', 'Forum image');
            }
        }
    });
    
    element.querySelectorAll('iframe, video').forEach(media => {
        if (globalThis.mediaDimensionExtractor) {
            globalThis.mediaDimensionExtractor.extractDimensionsForElement(media);
        }
    });
}

    #enhanceIframesInElement(element) {
        element.querySelectorAll('iframe').forEach(iframe => {
            const originalWidth = iframe.getAttribute('width');
            const originalHeight = iframe.getAttribute('height');

            const commonSizes = {
                'youtube.com': { width: '560', height: '315' },
                'youtu.be': { width: '560', height: '315' },
                'vimeo.com': { width: '640', height: '360' },
                'soundcloud.com': { width: '100%', height: '166' },
                'twitter.com': { width: '550', height: '400' },
                'x.com': { width: '550', height: '400' },
                'default': { width: '100%', height: '400' }
            };

            let src = iframe.src || iframe.dataset.src || '';
            let dimensions = commonSizes.default;

            for (let domain in commonSizes) {
                if (commonSizes.hasOwnProperty(domain) && src.includes(domain)) {
                    dimensions = commonSizes[domain];
                    break;
                }
            }

            if (!originalWidth || !originalHeight) {
                iframe.setAttribute('width', dimensions.width);
                iframe.setAttribute('height', dimensions.height);

                const wrapper = document.createElement('div');
                wrapper.className = 'iframe-wrapper';

                if (dimensions.width !== '100%') {
                    const widthNum = parseInt(dimensions.width);
                    const heightNum = parseInt(dimensions.height);
                    if (widthNum > 0 && heightNum > 0) {
                        const paddingBottom = (heightNum / widthNum * 100) + '%';
                        wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:' + paddingBottom + ';overflow:hidden;';
                    } else {
                        wrapper.style.cssText = 'position:relative;width:100%;overflow:hidden;';
                    }
                } else {
                    wrapper.style.cssText = 'position:relative;width:100%;overflow:hidden;';
                }

                iframe.parentNode.insertBefore(wrapper, iframe);
                wrapper.appendChild(iframe);

                iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0;';
            }

            if (!iframe.hasAttribute('title')) {
                iframe.setAttribute('title', 'Embedded content');
            }
        });
    }

    #addQuoteEventListeners(quoteElement) {
        const expandBtn = quoteElement.querySelector('.quote-expand-btn');
        const quoteContent = quoteElement.querySelector('.quote-content.collapsible-content');

        if (expandBtn && quoteContent) {
            expandBtn.addEventListener('click', () => {
                quoteContent.style.maxHeight = quoteContent.scrollHeight + 'px';
                expandBtn.style.display = 'none';
                setTimeout(() => {
                    quoteContent.style.maxHeight = 'none';
                }, 300);
            });
        }
    }

    #addReputationToFooter(miniButtons, stEmoji, postFooter) {
        if (miniButtons || stEmoji) {
            const postActions = document.createElement('div');
            postActions.className = 'post-actions';

            if (miniButtons) {
                this.#cleanupMiniButtons(miniButtons);
                this.#setInitialPointsState(miniButtons);
                const pointsContainer = miniButtons.querySelector('.points');
                if (pointsContainer) {
                    this.#updatePointsContainerActiveState(pointsContainer);
                }
                postActions.appendChild(miniButtons);
            }

            if (stEmoji) {
                const emojiContainer = stEmoji.querySelector('.st-emoji-container');
                if (emojiContainer) {
                    this.#updateEmojiContainerActiveState(emojiContainer);
                }
                postActions.appendChild(stEmoji);
            }

            postFooter.insertBefore(postActions, postFooter.firstChild);
        }
    }

    #modernizeBottomElements(title2Bottom, postFooter) {
        title2Bottom.querySelectorAll('.rt.Sub').forEach(rtSub => {
            const label = rtSub.querySelector('label');
            const checkbox = rtSub.querySelector('input[type="checkbox"]');
            const ipAddress = rtSub.querySelector('.ip_address');

            const modernContainer = document.createElement('div');
            modernContainer.className = 'modern-bottom-actions';

            let html = '';

            if (label && checkbox && !ipAddress) {
                html = this.#createModernMultiquote(label, checkbox);
            } else if (ipAddress && checkbox) {
                html = this.#createModernModeratorView(ipAddress, checkbox, label);
            } else if (ipAddress) {
                html = this.#createModernIPAddress(ipAddress);
            } else if (checkbox) {
                html = this.#createBasicMultiquote(checkbox);
            } else if (label) {
                html = this.#createLabelOnly(label);
            }

            if (html) {
                modernContainer.innerHTML = html;
                postFooter.appendChild(modernContainer);
            }
        });
    }

    #removeBreakAndNbsp(element) {
        element.querySelectorAll('.Break.Sub').forEach(el => el.remove());

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        const nodesToRemove = [];
        let node;

        while (node = walker.nextNode()) {
            if (node.textContent.includes('&nbsp;') || node.textContent.trim() === '') {
                nodesToRemove.push(node);
            }
        }

        nodesToRemove.forEach(node => {
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        });
    }

    #removeBottomBorderAndBr(element) {
        element.querySelectorAll('.bottomborder').forEach(bottomBorder => {
            bottomBorder.remove();
            bottomBorder.nextElementSibling && bottomBorder.nextElementSibling.tagName === 'BR' && bottomBorder.nextElementSibling.remove();
        });
    }

    #cleanupPostContent(post) {
        post.querySelectorAll('.bottomborder').forEach(bottomBorder => {
            bottomBorder.parentNode && bottomBorder.parentNode.removeChild(bottomBorder);
            bottomBorder.nextElementSibling && bottomBorder.nextElementSibling.tagName === 'BR' &&
                bottomBorder.parentNode && bottomBorder.parentNode.removeChild(bottomBorder.nextElementSibling);
        });
    }

    #createStatElement(iconClass, value, additionalClass) {
        const statDiv = document.createElement('div');
        statDiv.className = 'stat ' + additionalClass;

        const icon = document.createElement('i');
        icon.className = iconClass;
        icon.setAttribute('aria-hidden', 'true');

        const span = document.createElement('span');
        span.textContent = value;

        statDiv.appendChild(icon);
        statDiv.appendChild(span);

        return statDiv;
    }

    #cleanupMiniButtons(miniButtons) {
        const walker = document.createTreeWalker(miniButtons, NodeFilter.SHOW_TEXT, null, false);
        const nodesToRemove = [];
        let node;

        while (node = walker.nextNode()) {
            if (node.textContent.trim() === '' || node.textContent.includes('&nbsp;') || /^\s*$/.test(node.textContent)) {
                nodesToRemove.push(node);
            }
        }

        nodesToRemove.forEach(node => node.parentNode && node.parentNode.removeChild(node));

        Array.from(miniButtons.childNodes).forEach(child => {
            if (child.nodeType === Node.TEXT_NODE &&
                (child.textContent.trim() === '' || child.textContent.includes('&nbsp;'))) {
                miniButtons.removeChild(child);
            }
        });
    }

#setInitialPointsState(miniButtons) {
    const pointsContainer = miniButtons.querySelector('.points');
    if (!pointsContainer) return;

    const pointsPos = pointsContainer.querySelector('.points_pos');
    const pointsNeg = pointsContainer.querySelector('.points_neg');
    const pointsUp = pointsContainer.querySelector('.points_up');
    const pointsDown = pointsContainer.querySelector('.points_down');
    const bulletDelete = pointsContainer.querySelector('.bullet_delete');

    // Always check for bulletDelete first
    if (bulletDelete) {
        if (pointsPos) {
            // Positive points - thumbs-up should be active
            pointsUp && pointsUp.classList.add('active');
            pointsDown && pointsDown.classList.remove('active');
        } else if (pointsNeg) {
            // Negative points - we need to check which icon is thumbs-down
            const pointsUpIcon = pointsUp ? pointsUp.querySelector('i') : null;
            const pointsDownIcon = pointsDown ? pointsDown.querySelector('i') : null;

            // Check which element has the thumbs-down icon
            if (pointsUpIcon && pointsUpIcon.classList.contains('fa-thumbs-down')) {
                pointsUp && pointsUp.classList.add('active');
            }
            if (pointsDownIcon && pointsDownIcon.classList.contains('fa-thumbs-down')) {
                pointsDown && pointsDown.classList.add('active');
            }

            // Ensure only one is active
            if (pointsUp && pointsUp.classList.contains('active')) {
                pointsDown && pointsDown.classList.remove('active');
            } else if (pointsDown && pointsDown.classList.contains('active')) {
                pointsUp && pointsUp.classList.remove('active');
            }
        }
    }
}

    #createModernMultiquote(label, checkbox) {
        const labelText = label.textContent.replace('multiquote »', '').trim();
        const originalOnClick = label.getAttribute('onclick') || '';

        let html = '<div class="multiquote-control">' +
            '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="' + this.#escapeHtml(label.title || 'Select post') + '" type="button">' +
            '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' +
            '</button>' +
            '<label class="multiquote-label">' + this.#escapeHtml(labelText || 'Quote +') + '</label>';

        if (checkbox) {
            html += '<div class="user-checkbox-container">' +
                checkbox.outerHTML +
                '</div>';
        }

        html += '</div>';
        return html;
    }

    #createBasicMultiquote(checkbox) {
        const postId = checkbox.id.replace('p', '');
        const originalOnClick = 'document.getElementById(\'' + checkbox.id + '\').checked=!document.getElementById(\'' + checkbox.id + '\').checked;post(\'' + postId + '\')';

        return '<div class="multiquote-control">' +
            '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="Select post for multiquote" type="button">' +
            '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' +
            '</button>' +
            '<label class="multiquote-label">Quote +</label>' +
            '<div class="user-checkbox-container">' +
            checkbox.outerHTML +
            '</div>' +
            '</div>';
    }

    #createLabelOnly(label) {
        const labelText = label.textContent.replace('multiquote »', '').trim();
        const originalOnClick = label.getAttribute('onclick') || '';

        return '<div class="multiquote-control">' +
            '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="' + this.#escapeHtml(label.title || 'Select post') + '" type="button">' +
            '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' +
            '</button>' +
            '<label class="multiquote-label">' + this.#escapeHtml(labelText || 'Quote +') + '</label>' +
            '</div>';
    }

    #createModernModeratorView(ipAddress, checkbox, label) {
        const ipLink = ipAddress.querySelector('a');
        const ipTextElement = ipAddress.querySelector('dd');
        const ipText = ipTextElement && ipTextElement.textContent ? ipTextElement.textContent : '';

        let originalOnClick = '';
        let labelText = 'Quote +';

        if (label) {
            originalOnClick = label.getAttribute('onclick') || '';
            labelText = label.textContent.replace('multiquote »', '').trim() || 'Quote +';
        } else {
            const postId = checkbox.id.replace('p', '');
            originalOnClick = 'document.getElementById(\'' + checkbox.id + '\').checked=!document.getElementById(\'' + checkbox.id + '\').checked;post(\'' + postId + '\')';
        }

        let html = '<div class="moderator-controls">' +
            '<div class="multiquote-control">' +
            '<button class="btn btn-icon multiquote-btn" onclick="' + this.#escapeHtml(originalOnClick) + '" title="Select post for multiquote" type="button">' +
            '<i class="fa-regular fa-quote-right" aria-hidden="true"></i>' +
            '</button>' +
            '<label class="multiquote-label">' + this.#escapeHtml(labelText) + '</label>' +
            '</div>' +
            '<div class="ip-address-control">' +
            '<span class="ip-label">IP:</span>' +
            '<span class="ip-value">';

        if (ipLink) {
            html += '<a href="' + this.#escapeHtml(ipLink.href) + '" target="_self" class="ip-link" tabindex="0">' + this.#escapeHtml(ipText) + '</a>';
        } else {
            html += '<span class="ip-text">' + this.#escapeHtml(ipText) + '</span>';
        }

        html += '</span></div>' +
            '<div class="mod-checkbox-container">' +
            checkbox.outerHTML +
            '</div></div>';

        return html;
    }

    #createModernIPAddress(ipAddress) {
        const ipLink = ipAddress.querySelector('a');
        const ipTextElement = ipAddress.querySelector('dd');
        const ipText = ipTextElement && ipTextElement.textContent ? ipTextElement.textContent : '';

        let html = '<div class="ip-address-control">' +
            '<span class="ip-label">IP:</span>' +
            '<span class="ip-value">';

        if (ipLink) {
            html += '<a href="' + this.#escapeHtml(ipLink.href) + '" target="_self" class="ip-link" tabindex="0">' + this.#escapeHtml(ipText) + '</a>';
        } else {
            html += '<span class="ip-text">' + this.#escapeHtml(ipText) + '</span>';
        }

        html += '</span></div>';
        return html;
    }

    #convertMiniButtonsToButtons(post) {
        const miniButtonsContainer = post.querySelector('.mini_buttons.rt.Sub');
        if (!miniButtonsContainer) return;

        miniButtonsContainer.querySelectorAll('.mini_buttons.rt.Sub a').forEach(link => {
            const href = link.getAttribute('href');

            if (href && href.startsWith('javascript:')) {
                const jsCode = href.replace('javascript:', '');
                if (jsCode.includes('delete_post')) {
                    const button = document.createElement('button');
                    button.className = 'btn btn-icon btn-delete';
                    button.setAttribute('data-action', 'delete');
                    button.setAttribute('onclick', jsCode);
                    button.setAttribute('title', 'Delete');
                    button.setAttribute('type', 'button');

                    let buttonHTML = link.innerHTML;
                    buttonHTML = buttonHTML.replace(/<i(?![^>]*aria-hidden)/g, '<i aria-hidden="true" ');
                    button.innerHTML = buttonHTML;

                    link.parentNode.replaceChild(button, link);
                }
            } else if (href && href.includes('CODE=08')) {
                link.classList.add('btn', 'btn-icon', 'btn-edit');
                link.setAttribute('data-action', 'edit');
                link.setAttribute('title', 'Edit');

                const icon = link.querySelector('i');
                icon && !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true');
            } else if (href && href.includes('CODE=02')) {
                link.classList.add('btn', 'btn-icon', 'btn-quote');
                link.setAttribute('data-action', 'quote');
                link.setAttribute('title', 'Quote');
                link.getAttribute('rel') && link.setAttribute('rel', link.getAttribute('rel'));

                const icon = link.querySelector('i');
                icon && !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true');
            } else if (href) {
                link.classList.add('btn', 'btn-icon');
                link.querySelectorAll('i').forEach(icon => {
                    !icon.hasAttribute('aria-hidden') && icon.setAttribute('aria-hidden', 'true');
                });
            }
        });

        this.#reorderPostButtons(miniButtonsContainer);
    }

    #addShareButton(post) {
        if (post.classList.contains('post_queue')) {
            return;
        }

        const miniButtonsContainer = post.querySelector('.post-header .mini_buttons.rt.Sub');
        if (!miniButtonsContainer || miniButtonsContainer.querySelector('.btn-share')) return;

        const shareButton = document.createElement('button');
        shareButton.className = 'btn btn-icon btn-share';
        shareButton.setAttribute('data-action', 'share');
        shareButton.setAttribute('title', 'Share this post');
        shareButton.setAttribute('type', 'button');
        shareButton.innerHTML = '<i class="fa-regular fa-share-nodes" aria-hidden="true"></i>';

        const deleteButton = miniButtonsContainer.querySelector('.btn-delete, [data-action="delete"]');
        if (deleteButton) {
            miniButtonsContainer.insertBefore(shareButton, deleteButton);
        } else {
            miniButtonsContainer.insertBefore(shareButton, miniButtonsContainer.firstChild);
        }

        shareButton.addEventListener('click', () => this.#handleSharePost(post));
    }

    #reorderPostButtons(container) {
        const elements = Array.from(container.children);
        const order = ['share', 'quote', 'edit', 'delete'];

        elements.sort((a, b) => {
            const getAction = (element) => {
                const dataAction = element.getAttribute('data-action');
                if (dataAction && order.includes(dataAction)) return dataAction;

                if (element.classList.contains('btn-share')) return 'share';
                if (element.classList.contains('btn-quote')) return 'quote';
                if (element.classList.contains('btn-edit')) return 'edit';
                if (element.classList.contains('btn-delete')) return 'delete';

                if (element.href) {
                    if (element.href.includes('CODE=02')) return 'quote';
                    if (element.href.includes('CODE=08')) return 'edit';
                }

                if (element.onclick && element.onclick.toString().includes('delete_post')) return 'delete';

                return 'other';
            };

            const actionA = getAction(a);
            const actionB = getAction(b);
            const indexA = order.indexOf(actionA);
            const indexB = order.indexOf(actionB);

            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return 0;
        });

        container.innerHTML = '';
        elements.forEach(el => container.appendChild(el));
    }

    #handleSharePost(post) {
        let postLink = null;

        const timestampLink = post.querySelector('.post-header .lt.Sub a[href*="#entry"]');
        if (timestampLink) {
            postLink = timestampLink.href;
        }

        if (!postLink) {
            const timeLink = post.querySelector('.post-header time[class*="when"]');
            if (timeLink && timeLink.closest('a')) {
                postLink = timeLink.closest('a').href;
            }
        }

        if (!postLink) {
            const postIdMatch = post.id.match(/\d+/);
            if (postIdMatch) {
                const postId = postIdMatch[0];
                const topicMatch = window.location.href.match(/t=(\d+)/);
                if (topicMatch) {
                    postLink = window.location.origin + '/?t=' + topicMatch[1] + '#entry' + postId;
                }
            }
        }

        if (postLink) {
            this.#copyPostLinkToClipboard(postLink);
        } else {
            this.#showCopyNotification('Could not find post link');
        }
    }

    #copyPostLinkToClipboard(link) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(() => {
                this.#showCopyNotification('Post link copied to clipboard!');
            }).catch(() => {
                this.#fallbackCopyPostLink(link);
            });
        } else {
            this.#fallbackCopyPostLink(link);
        }
    }

    #fallbackCopyPostLink(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            if (document.execCommand('copy')) {
                this.#showCopyNotification('Post link copied to clipboard!');
            } else {
                this.#showCopyNotification('Failed to copy link');
            }
        } catch {
            this.#showCopyNotification('Failed to copy link');
        } finally {
            document.body.removeChild(textArea);
        }
    }

    #showCopyNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'copy-notification';
        notification.textContent = message;

        notification.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 20px;background:var(--success-color);color:white;border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:9999;font-weight:500;display:flex;align-items:center;gap:8px;transform:translateX(calc(100% + 20px));opacity:0;transition:transform 0.3s ease-out,opacity 0.3s ease-out;pointer-events:none;white-space:nowrap;';

        const icon = document.createElement('i');
        icon.className = 'fa-regular fa-check-circle';
        icon.setAttribute('aria-hidden', 'true');
        notification.prepend(icon);

        document.body.appendChild(notification);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                notification.style.transform = 'translateX(0)';
                notification.style.opacity = '1';
            });
        });

        const dismissTimer = setTimeout(() => {
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';

            notification.addEventListener('transitionend', () => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, { once: true });
        }, 2000);

        notification.style.pointerEvents = 'auto';
        notification.style.cursor = 'pointer';
        notification.addEventListener('click', () => {
            clearTimeout(dismissTimer);
            notification.style.transform = 'translateX(calc(100% + 20px))';
            notification.style.opacity = '0';

            notification.addEventListener('transitionend', () => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, { once: true });
        });
    }

   #enhanceReputationSystem() {
    document.addEventListener('click', (e) => {
        const pointsUp = e.target.closest('.points_up');
        const pointsDown = e.target.closest('.points_down');
        const emojiPreview = e.target.closest('.st-emoji-preview');

        if (pointsUp || pointsDown) {
            const pointsContainer = (pointsUp || pointsDown).closest('.points');
            const bulletDelete = pointsContainer ? pointsContainer.querySelector('.bullet_delete') : null;

            // Don't automatically trigger bulletDelete.onclick() - this was causing issues
            // Just update the UI state and let the forum's original handlers work
            if (bulletDelete) {
                // The bulletDelete handler will be triggered by the forum's original code
                // We just need to update the visual state
                if (pointsUp) {
                    pointsContainer && pointsContainer.querySelector('.points_down') && 
                    pointsContainer.querySelector('.points_down').classList.remove('active');
                    pointsUp.classList.add('active');
                }

                if (pointsDown) {
                    pointsContainer && pointsContainer.querySelector('.points_up') && 
                    pointsContainer.querySelector('.points_up').classList.remove('active');
                    pointsDown.classList.add('active');
                }
                
                // Let the event propagate so the forum's original handler can work
                // Don't call bulletDelete.onclick() or prevent default
            } else {
                // If no bulletDelete, just toggle active states
                if (pointsUp) {
                    pointsContainer && pointsContainer.querySelector('.points_down') && 
                    pointsContainer.querySelector('.points_down').classList.remove('active');
                    pointsUp.classList.add('active');
                }

                if (pointsDown) {
                    pointsContainer && pointsContainer.querySelector('.points_up') && 
                    pointsContainer.querySelector('.points_up').classList.remove('active');
                    pointsDown.classList.add('active');
                }
            }
        }

        if (emojiPreview) {
            emojiPreview.closest('.st-emoji-container') && 
            emojiPreview.closest('.st-emoji-container').classList.toggle('active');
        }
    });
}

    #escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ==============================
    // ENHANCED ANCHOR NAVIGATION
    // ==============================

    #setupEnhancedAnchorNavigation() {
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href*="#"]');
            if (!link) return;

            const href = link.getAttribute('href');
            const hashMatch = href.match(/#([^?&]+)/);
            if (!hashMatch) return;

            const anchorId = hashMatch[1];

            if (anchorId === 'lastpost' || anchorId === 'newpost' || anchorId.startsWith('entry')) {
                e.preventDefault();

                const url = new URL(href, window.location.origin);
                const isCrossPage = this.#isCrossPageAnchor(url);

                if (isCrossPage) {
                    window.location.href = href;
                } else {
                    this.#scrollToAnchorWithPrecision(anchorId, link);
                }
            }
        });

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.substring(1);
            if (hash && (hash === 'lastpost' || hash === 'newpost' || hash.startsWith('entry'))) {
                setTimeout(() => this.#scrollToAnchorWithPrecision(hash), 100);
            }
        });

        if (window.location.hash) {
            const hash = window.location.hash.substring(1);
            if (hash && (hash === 'lastpost' || hash === 'newpost' || hash.startsWith('entry'))) {
                setTimeout(() => this.#scrollToAnchorWithPrecision(hash), 500);
            }
        }
    }

    #scrollToAnchorWithPrecision(anchorId, triggerElement = null) {
        const anchorElement = document.getElementById(anchorId);
        if (!anchorElement) {
            console.warn('Anchor #' + anchorId + ' not found');
            if (triggerElement) {
                window.location.hash = anchorId;
            }
            return;
        }

        const postElement = anchorElement.closest('.post');
        if (!postElement) {
            console.warn('Post containing anchor #' + anchorId + ' not found');
            this.#scrollToElementWithOffset(anchorElement);
            return;
        }

        this.#focusPost(postElement);

        const postHeader = postElement.querySelector('.post-header');
        if (postHeader) {
            this.#scrollToElementWithOffset(postHeader, 20);
        } else {
            this.#scrollToElementWithOffset(postElement, 20);
        }

        postElement.setAttribute('tabindex', '-1');
        postElement.focus({ preventScroll: true });

        history.replaceState(null, null, '#' + anchorId);
    }

    #focusPost(postElement) {
        document.querySelectorAll('.post.focus').forEach(post => {
            post.classList.remove('focus');
        });

        postElement.classList.add('focus');

        const removeFocusHandler = (e) => {
            if (!postElement.contains(e.target)) {
                postElement.classList.remove('focus');
                document.removeEventListener('click', removeFocusHandler);
                document.removeEventListener('keydown', escapeHandler);
            }
        };

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                postElement.classList.remove('focus');
                document.removeEventListener('click', removeFocusHandler);
                document.removeEventListener('keydown', escapeHandler);
            }
        };

        document.addEventListener('click', removeFocusHandler);
        document.addEventListener('keydown', escapeHandler);

        setTimeout(() => {
            postElement.classList.remove('focus');
            document.removeEventListener('click', removeFocusHandler);
            document.removeEventListener('keydown', escapeHandler);
        }, 10000);
    }

    #scrollToElementWithOffset(element, additionalOffset = 0) {
        const elementRect = element.getBoundingClientRect();
        const offsetTop = elementRect.top + window.pageYOffset;
        const headerHeight = this.#getFixedHeaderHeight();
        const targetScroll = offsetTop - headerHeight - additionalOffset;

        if ('scrollBehavior' in document.documentElement.style) {
            window.scrollTo({
                top: targetScroll,
                behavior: 'smooth'
            });
        } else {
            window.scrollTo(0, targetScroll);
        }
    }

    #getFixedHeaderHeight() {
        let totalHeight = 0;

        const headerSelectors = [
            '.header_h',
            '.menuwrap',
            '.modern-nav.top-nav',
            '[style*="fixed"]',
            '[style*="sticky"]'
        ];

        headerSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                const position = style.position;

                if (position === 'fixed' || position === 'sticky') {
                    totalHeight += rect.height;
                }
            });
        });

        return Math.max(totalHeight, 80);
    }

    #isCrossPageAnchor(url) {
        const currentUrl = new URL(window.location.href);

        const currentPage = this.#getPageNumber(currentUrl);
        const targetPage = this.#getPageNumber(url);

        const currentTopic = currentUrl.searchParams.get('t');
        const targetTopic = url.searchParams.get('t');

        return (currentPage !== targetPage && currentTopic === targetTopic);
    }

    #getPageNumber(url) {
        const stParam = url.searchParams.get('st');
        if (stParam) {
            const postsPerPage = 30;
            return Math.floor(parseInt(stParam) / postsPerPage) + 1;
        }
        return 1;
    }

    // ==============================
    // ENHANCED QUOTE LINKS
    // ==============================

    #enhanceQuoteLinks() {
        this.#processExistingQuoteLinks();
        this.#setupQuoteLinkObserver();
    }

    #processExistingQuoteLinks() {
        document.querySelectorAll('.quote-link').forEach(link => {
            this.#enhanceSingleQuoteLink(link);
        });

        document.querySelectorAll('.quote_top a[href*="#entry"]').forEach(link => {
            this.#enhanceSingleQuoteLink(link);
        });
    }

    #enhanceSingleQuoteLink(link) {
        const href = link.getAttribute('href');
        if (!href || !href.includes('#entry')) return;

        const url = new URL(href, window.location.origin);
        const anchorId = url.hash.substring(1);
        const isCrossPage = this.#isCrossPageAnchor(url);

        const button = document.createElement('button');
        button.className = 'quote-jump-btn';
        button.setAttribute('data-anchor-id', anchorId);
        button.setAttribute('data-is-cross-page', isCrossPage.toString());
        button.setAttribute('data-target-url', href);
        button.setAttribute('title', isCrossPage ? 'Go to post on another page' : 'Jump to quoted post');
        button.setAttribute('aria-label', isCrossPage ? 'Go to quoted post on another page' : 'Jump to quoted post');
        button.setAttribute('type', 'button');
        button.setAttribute('tabindex', '0');

        const icon = link.querySelector('i') ? link.querySelector('i').cloneNode(true) :
            document.createElement('i');
        if (!icon.className.includes('fa-')) {
            icon.className = 'fa-regular fa-chevron-up';
        }
        icon.setAttribute('aria-hidden', 'true');

        if (isCrossPage) {
            const indicator = document.createElement('span');
            indicator.className = 'cross-page-indicator';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.textContent = '↗';
            button.appendChild(indicator);
        }

        button.appendChild(icon);

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.#handleQuoteJumpClick(button);
        });

        link.parentNode.replaceChild(button, link);
    }

    #handleQuoteJumpClick(button) {
        const anchorId = button.getAttribute('data-anchor-id');
        const isCrossPage = button.getAttribute('data-is-cross-page') === 'true';
        const targetUrl = button.getAttribute('data-target-url');

        this.#setButtonLoading(button, true);

        if (isCrossPage) {
            window.location.href = targetUrl;
        } else {
            this.#jumpToQuoteOnSamePage(anchorId, button);
        }
    }

    #jumpToQuoteOnSamePage(anchorId, button) {
        const anchorElement = document.getElementById(anchorId);

        if (!anchorElement) {
            console.warn('Anchor #' + anchorId + ' not found, falling back to standard navigation');
            window.location.hash = anchorId;
            this.#setButtonLoading(button, false);
            return;
        }

        const postElement = anchorElement.closest('.post');

        if (!postElement) {
            this.#scrollToElementWithOffset(anchorElement);
            this.#setButtonLoading(button, false);
            return;
        }

        this.#focusPost(postElement);

        const postHeader = postElement.querySelector('.post-header');
        if (postHeader) {
            this.#scrollToElementWithOffset(postHeader, 20);
        } else {
            this.#scrollToElementWithOffset(postElement, 20);
        }

        postElement.setAttribute('tabindex', '-1');
        postElement.focus({ preventScroll: true });

        setTimeout(() => {
            this.#setButtonLoading(button, false);
        }, 500);
    }

    #setButtonLoading(button, isLoading) {
        if (isLoading) {
            button.classList.add('loading');
            const icon = button.querySelector('i');
            if (icon) {
                icon.className = 'fa-regular fa-spinner fa-spin';
            }
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            const icon = button.querySelector('i');
            if (icon && icon.className.includes('fa-spinner')) {
                icon.className = 'fa-regular fa-chevron-up';
            }
            button.disabled = false;
        }
    }

    #setupQuoteLinkObserver() {
        if (globalThis.forumObserver) {
            this.#quoteLinkObserverId = globalThis.forumObserver.register({
                id: 'quote-link-enhancer',
                callback: (node) => this.#handleNewQuoteLinks(node),
                selector: '.quote-link, .quote_top a[href*="#entry"]',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'send', 'search']
            });
        } else {
            setInterval(() => this.#processExistingQuoteLinks(), 2000);
        }
    }

    #handleNewQuoteLinks(node) {
        if (node.matches('.quote-link') || node.matches('.quote_top a[href*="#entry"]')) {
            this.#enhanceSingleQuoteLink(node);
        } else {
            node.querySelectorAll('.quote-link, .quote_top a[href*="#entry"]').forEach(link => {
                this.#enhanceSingleQuoteLink(link);
            });
        }
    }

    // ==============================
    // NEW POST BADGE
    // ==============================

    #addNewPostBadge(post, postHeader) {
        if (post.classList.contains('post_queue')) {
            return;
        }
        
        const hasNewPostAnchor = post.querySelector('.anchor a#newpost');
        if (!hasNewPostAnchor) return;

        const newBadge = document.createElement('span');
        newBadge.className = 'post-new-badge';
        newBadge.textContent = 'NEW';
        newBadge.setAttribute('aria-label', 'New post since your last visit');

        const postNumber = postHeader.querySelector('.post-number');
        if (postNumber) {
            let badgeContainer = postHeader.querySelector('.post-badges');
            if (!badgeContainer) {
                badgeContainer = document.createElement('div');
                badgeContainer.className = 'post-badges';
                postHeader.insertBefore(badgeContainer, postNumber.nextSibling);
            }
            badgeContainer.appendChild(newBadge);
        } else {
            postHeader.insertBefore(newBadge, postHeader.firstChild);
        }
    }

    // ==============================
    // MODERN CODE BLOCKS
    // ==============================

    #modernizeCodeBlocks() {
        this.#processExistingCodeBlocks();
        this.#setupCodeBlockObserver();
    }

    #processExistingCodeBlocks() {
        document.querySelectorAll('div[align="center"]:has(.code_top)').forEach(container => {
            if (container.classList.contains('code-modernized')) return;
            this.#transformCodeBlock(container);
            container.classList.add('code-modernized');
        });
    }

    #transformCodeBlock(container) {
        const codeTop = container.querySelector('.code_top');
        const codeContent = container.querySelector('.code');

        if (!codeTop || !codeContent) return;

        const codeText = codeTop.textContent.trim();
        const codeType = codeText.toUpperCase();
        const isLongContent = this.#isLongContent(codeContent);

        const modernCode = document.createElement('div');
        modernCode.className = 'modern-code' + (isLongContent ? ' long-code' : '');

        let html = '<div class="code-header">' +
            '<div class="code-icon">' +
            '<i class="fa-regular fa-code" aria-hidden="true"></i>' +
            '</div>' +
            '<div class="code-info">' +
            '<span class="code-title">' + this.#escapeHtml(codeType) + '</span>' +
            '</div>' +
            '<button class="code-copy-btn" type="button" aria-label="Copy code" tabindex="0">' +
            '<i class="fa-regular fa-copy" aria-hidden="true"></i>' +
            '</button>' +
            '</div>';

        html += '<div class="code-content' +
            (isLongContent ? ' collapsible-content' : '') + '">' +
            '<pre><code>' + this.#escapeHtml(codeContent.textContent) + '</code></pre>' +
            '</div>';

        if (isLongContent) {
            html += '<button class="code-expand-btn" type="button" aria-label="Show full code" tabindex="0">' +
                '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
                'Show more code' +
                '</button>';
        }

        modernCode.innerHTML = html;
        container.replaceWith(modernCode);

        this.#addCodeEventListeners(modernCode, codeContent.textContent, isLongContent);
    }

    #addCodeEventListeners(codeElement, codeText, isLongContent = false) {
        const codeHeader = codeElement.querySelector('.code-header');
        const copyBtn = codeElement.querySelector('.code-copy-btn');
        const expandBtn = codeElement.querySelector('.code-expand-btn');
        const codeContent = codeElement.querySelector('.code-content');

        codeHeader.style.cursor = 'default';

        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.#copyCodeToClipboard(codeText, 'code');
            });
        }

        if (expandBtn) {
            expandBtn.addEventListener('click', () => {
                this.#toggleCodeExpansion(codeElement, true);
            });
        }

        this.#applySyntaxHighlighting(codeElement);
    }

    #toggleCodeExpansion(codeElement, forceExpand = null) {
        const codeContent = codeElement.querySelector('.code-content');
        const expandBtn = codeElement.querySelector('.code-expand-btn');
        const isExpanded = forceExpand !== null ? forceExpand : !codeElement.classList.contains('expanded');

        if (isExpanded) {
            codeElement.classList.add('expanded');
            codeContent.style.maxHeight = codeContent.scrollHeight + 'px';
            if (expandBtn) {
                expandBtn.style.display = 'none';
            }

            setTimeout(() => {
                codeContent.style.maxHeight = 'none';
            }, 300);
        } else {
            codeElement.classList.remove('expanded');
            codeContent.style.maxHeight = codeContent.scrollHeight + 'px';

            void codeContent.offsetHeight;

            codeContent.style.maxHeight = '0';
            if (expandBtn) {
                setTimeout(() => {
                    expandBtn.style.display = 'flex';
                }, 300);
            }
        }
    }

    #copyCodeToClipboard(codeText, codeType) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(codeText).then(() => {
                this.#showCopyNotification('Copied ' + codeType + ' to clipboard!');
            }).catch(() => {
                this.#fallbackCopyCode(codeText, codeType);
            });
        } else {
            this.#fallbackCopyCode(codeText, codeType);
        }
    }

    #fallbackCopyCode(text, codeType) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            if (document.execCommand('copy')) {
                this.#showCopyNotification('Copied ' + codeType + ' to clipboard!');
            } else {
                this.#showCopyNotification('Failed to copy ' + codeType);
            }
        } catch {
            this.#showCopyNotification('Failed to copy ' + codeType);
        } finally {
            document.body.removeChild(textArea);
        }
    }

    #applySyntaxHighlighting(codeElement) {
        const code = codeElement.querySelector('code');
        const codeTitle = codeElement.querySelector('.code-title');
        if (!code || !codeTitle) return;

        const text = code.textContent;
        const codeType = codeTitle.textContent;

        if (codeType === 'JAVASCRIPT' || codeType === 'JS') {
            code.innerHTML = this.#highlightJavaScript(text);
        } else if (codeType === 'HTML' || codeType === 'XML') {
            code.innerHTML = this.#highlightHTML(text);
        } else if (codeType === 'CSS') {
            code.innerHTML = this.#highlightCSS(text);
        }

        if (text.split('\n').length > 10) {
            this.#addLineNumbers(codeElement);
        }
    }

    #highlightJavaScript(code) {
        return code
            .replace(/\/\/.*$/gm, '<span class="code-comment">$&</span>')
            .replace(/\/\*[\s\S]*?\*\//g, '<span class="code-comment">$&</span>')
            .replace(/(\b(function|const|let|var|return|if|else|for|while|try|catch|class|import|export)\b)/g, '<span class="code-keyword">$1</span>')
            .replace(/(\b(true|false|null|undefined)\b)/g, '<span class="code-literal">$1</span>')
            .replace(/(\b(\d+)\b)/g, '<span class="code-number">$1</span>')
            .replace(/(["'`][^"'`]*["'`])/g, '<span class="code-string">$1</span>');
    }

    #highlightHTML(code) {
        return code
            .replace(/&lt;\/?([a-zA-Z][a-zA-Z0-9]*)/g, '<span class="code-tag">&lt;$1</span>')
            .replace(/(&lt;\/[a-zA-Z][a-zA-Z0-9]*&gt;)/g, '<span class="code-tag">$1</span>')
            .replace(/([a-zA-Z\-]+)=/g, '<span class="code-attribute">$1</span>=')
            .replace(/("[^"]*"|'[^']*')/g, '<span class="code-value">$1</span>')
            .replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="code-comment">$&</span>');
    }

    #highlightCSS(code) {
        return code
            .replace(/([a-zA-Z\-]+)\s*:/g, '<span class="code-property">$1</span>:')
            .replace(/#[0-9a-fA-F]{3,6}/g, '<span class="code-color">$&</span>')
            .replace(/(rgb|rgba|hsl|hsla)\([^)]+\)/g, '<span class="code-color">$&</span>')
            .replace(/(\b([0-9]+(\.[0-9]+)?)(px|em|rem|%|vh|vw)\b)/g, '<span class="code-number">$1</span>')
            .replace(/\/\*[\s\S]*?\*\//g, '<span class="code-comment">$&</span>');
    }

    #addLineNumbers(codeElement) {
        const codeContent = codeElement.querySelector('code');
        const lines = codeContent.innerHTML.split('\n');

        if (lines.length > 1) {
            let numberedHTML = '';
            lines.forEach((line, index) => {
                numberedHTML += '<span class="line-number">' + (index + 1) + '</span>' + line + '\n';
            });
            codeContent.innerHTML = numberedHTML;
            codeElement.classList.add('has-line-numbers');
        }
    }

    #setupCodeBlockObserver() {
        if (globalThis.forumObserver) {
            this.#codeBlockObserverId = globalThis.forumObserver.register({
                id: 'code-block-modernizer',
                callback: (node) => this.#handleNewCodeBlocks(node),
                selector: 'div[align="center"]:has(.code_top)',
                priority: 'normal',
                pageTypes: ['topic', 'blog', 'send', 'search']
            });
        } else {
            setInterval(() => this.#processExistingCodeBlocks(), 2000);
        }
    }

    #handleNewCodeBlocks(node) {
        if (node.matches('div[align="center"]:has(.code_top)')) {
            this.#transformCodeBlock(node);
        } else {
            node.querySelectorAll('div[align="center"]:has(.code_top)').forEach(block => {
                this.#transformCodeBlock(block);
            });
        }
    }

    destroy() {
        const ids = [this.#postModernizerId, this.#activeStateObserverId,
        this.#debouncedObserverId, this.#cleanupObserverId,
        this.#searchPostObserverId, this.#quoteLinkObserverId,
            this.#codeBlockObserverId, this.#attachmentObserverId,
            this.#embeddedLinkObserverId];

        ids.forEach(id => id && globalThis.forumObserver && globalThis.forumObserver.unregister(id));

        if (this.#retryTimeoutId) {
            clearTimeout(this.#retryTimeoutId);
            this.#retryTimeoutId = null;
        }

        this.#timeUpdateIntervals.forEach(interval => {
            clearInterval(interval);
        });
        this.#timeUpdateIntervals.clear();

        console.log('Post Modernizer destroyed');
    }
}

// Modern initialization without DOMContentLoaded with body ID check
(function initPostModernizer() {
    var bodyId = document.body.id;
    var shouldModernize = bodyId === 'topic' || bodyId === 'search' || bodyId === 'blog' || bodyId === 'send';
    
    if (!shouldModernize) {
        console.log('Post Modernizer skipped for body#' + bodyId);
        return;
    }
    
    var init = function() {
        try {
            globalThis.postModernizer = new PostModernizer();
        } catch (error) {
            console.error('Failed to create Post Modernizer instance:', error);

            setTimeout(function() {
                if (!globalThis.postModernizer) {
                    try {
                        globalThis.postModernizer = new PostModernizer();
                    } catch (retryError) {
                        console.error('Post Modernizer failed on retry:', retryError);
                    }
                }
            }, 100);
        }
    };

    if (document.readyState !== 'loading') {
        queueMicrotask(init);
    } else {
        init();
    }
})();

// Cleanup on page hide
globalThis.addEventListener('pagehide', function() {
    if (globalThis.postModernizer && typeof globalThis.postModernizer.destroy === 'function') {
        globalThis.postModernizer.destroy();
    }
});
