// ==UserScript==
// @name         Modern Likes Modal for ForumFree
// @namespace    http://tampermonkey.net/
// @version      3.9
// @description  Replaces the old likes popup with a modern modal using real API data
// @author       You
// @match        *://*.forumfree.it/*
// @match        *://*.forumcommunity.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    // Track currently open custom modal to prevent duplicates
    var currentCustomModal = null;
    var currentLegacyModal = null;
    
    // Cooldown to prevent re-opening immediately after close
    var closeCooldown = false;
    var cooldownTimer = null;
    var processingModal = false;
    
    // Weserv image optimization configuration
    var WESERV_CONFIG = {
        cdn: 'https://images.weserv.nl/',
        cache: '1y',
        quality: 90,
        avatarWidth: 48,
        avatarHeight: 48
    };
    
    // Harmony color palette based on Midnight Emerald theme
    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];
    
    // Store original profile links for each user
    var userProfileLinks = new Map();
    
    // Helper: Optimize image URL using Weserv
    function optimizeImageUrl(url, width, height) {
        if (!url) return { url: url, quality: null, format: null, isGif: false };
        
        var lowerUrl = url.toLowerCase();
        if (lowerUrl.indexOf('weserv.nl') !== -1 || 
            lowerUrl.indexOf('dicebear.com') !== -1 ||
            lowerUrl.indexOf('api.dicebear.com') !== -1) {
            return { url: url, quality: null, format: null, isGif: false };
        }
        
        if (url.indexOf('data:') === 0) return { url: url, quality: null, format: null, isGif: false };
        
        var targetWidth = width || WESERV_CONFIG.avatarWidth;
        var targetHeight = height || WESERV_CONFIG.avatarHeight;
        
        var isGif = lowerUrl.indexOf('.gif') !== -1 || 
                    lowerUrl.indexOf('.gif?') !== -1 ||
                    lowerUrl.indexOf('.gif#') !== -1 ||
                    /\.gif($|\?|#)/i.test(lowerUrl);
        
        var outputFormat = 'webp';
        var quality = WESERV_CONFIG.quality;
        
        var encodedUrl = encodeURIComponent(url);
        var optimizedUrl = WESERV_CONFIG.cdn + '?url=' + encodedUrl + 
                          '&output=' + outputFormat + 
                          '&maxage=' + WESERV_CONFIG.cache + 
                          '&q=' + quality +
                          '&w=' + targetWidth +
                          '&h=' + targetHeight +
                          '&fit=cover' +
                          '&a=attention' +
                          '&il';
        
        if (isGif) {
            optimizedUrl += '&n=-1';
            optimizedUrl += '&lossless=true';
        }
        
        return {
            url: optimizedUrl,
            quality: quality,
            format: outputFormat,
            isGif: isGif,
            width: targetWidth,
            height: targetHeight
        };
    }
    
    // Modal styles (injected once)
    var modalStyles = '\
        <style id="modern-likes-modal-styles">\
            .modern-modal-overlay {\
                position: fixed;\
                top: 0;\
                left: 0;\
                right: 0;\
                bottom: 0;\
                background: rgba(0, 0, 0, 0.8);\
                backdrop-filter: blur(4px);\
                z-index: 10000;\
                display: flex;\
                align-items: center;\
                justify-content: center;\
                animation: fadeIn 0.2s ease;\
            }\
            .modern-likes-modal {\
                background: var(--surface-color, #1F2937);\
                border-radius: var(--radius-lg, 13px);\
                max-width: 480px;\
                width: 90%;\
                max-height: 80vh;\
                overflow: hidden;\
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);\
                animation: slideUp 0.3s ease;\
                border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));\
                display: flex;\
                flex-direction: column;\
            }\
            .modern-modal-header {\
                display: flex;\
                justify-content: space-between;\
                align-items: center;\
                padding: 1rem 1.5rem;\
                border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));\
                background: var(--surface-color, #1F2937);\
                flex-shrink: 0;\
            }\
            .modern-modal-title {\
                display: flex;\
                align-items: center;\
                gap: 0.5rem;\
                font-family: "Quicksand", sans-serif;\
            }\
            .modern-modal-title i {\
                color: var(--primary-light, #10B981);\
                font-size: 1.1rem;\
            }\
            .modern-modal-title h3 {\
                font-size: 1rem;\
                font-weight: 600;\
                color: var(--text-primary, #F9FAFB);\
                margin: 0;\
                font-family: "Quicksand", sans-serif;\
            }\
            .modal-like-count {\
                background: rgba(5, 150, 105, 0.15);\
                border-radius: 30px;\
                padding: 0.125rem 0.5rem;\
                font-size: 0.75rem;\
                font-weight: 600;\
                color: var(--primary-light, #10B981);\
            }\
            .modern-modal-close {\
                background: transparent;\
                border: none;\
                color: var(--text-tertiary, #6B7280);\
                cursor: pointer;\
                font-size: 1.25rem;\
                padding: 0.25rem;\
                border-radius: 6px;\
                transition: all 0.2s;\
            }\
            .modern-modal-close:hover {\
                background: var(--hover-color, rgba(255, 255, 255, 0.05));\
                color: var(--text-primary, #F9FAFB);\
                transform: rotate(90deg);\
            }\
            .modern-likes-list {\
                flex: 1;\
                overflow-y: auto;\
                background: var(--surface-color, #1F2937);\
            }\
            .modern-likes-list::-webkit-scrollbar {\
                width: 6px;\
            }\
            .modern-likes-list::-webkit-scrollbar-track {\
                background: transparent;\
            }\
            .modern-likes-list::-webkit-scrollbar-thumb {\
                background: var(--surface-light, #374151);\
                border-radius: 20px;\
            }\
            .modern-like-item {\
                display: flex;\
                align-items: center;\
                gap: 1rem;\
                padding: 0.875rem 1.5rem;\
                border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.05));\
                transition: background 0.2s;\
                cursor: pointer;\
            }\
            .modern-like-item:hover {\
                background: var(--hover-color, rgba(255, 255, 255, 0.05));\
            }\
            .modern-like-avatar {\
                width: 48px;\
                height: 48px;\
                border-radius: 50%;\
                object-fit: cover;\
                border: 2px solid var(--primary-color, #059669);\
                flex-shrink: 0;\
                background: var(--surface-light, #374151);\
                cursor: pointer;\
            }\
            .modern-like-info {\
                flex: 1;\
                min-width: 0;\
                cursor: pointer;\
            }\
            .modern-like-name-row {\
                display: flex;\
                align-items: center;\
                flex-wrap: wrap;\
                gap: 0.5rem;\
            }\
            .modern-like-name {\
                font-weight: 600;\
                color: var(--text-primary, #F9FAFB);\
                font-size: 0.95rem;\
                transition: color 0.2s;\
                cursor: pointer;\
            }\
            .modern-like-name:hover {\
                color: var(--primary-light, #10B981);\
                text-decoration: underline;\
            }\
            .modern-role-badge {\
                display: inline-block;\
                padding: 0.125rem 0.5rem;\
                border-radius: 9999px;\
                font-size: 0.625rem;\
                font-weight: 600;\
                color: white;\
                cursor: default;\
            }\
            .role-founder { background: linear-gradient(135deg, #F59E0B, #D97706); }\
            .role-administrator { background: linear-gradient(135deg, #DC2626, #B91C1C); }\
            .role-global-mod { background: linear-gradient(135deg, #8B5CF6, #7C3AED); }\
            .role-moderator { background: linear-gradient(135deg, #8B5CF6, #7C3AED); }\
            .role-developer { background: linear-gradient(135deg, #0EA5E9, #0284C7); }\
            .role-premium { background: linear-gradient(135deg, #D946EF, #C026D3); }\
            .role-vip { background: linear-gradient(135deg, #F97316, #EA580C); }\
            .role-member { background: linear-gradient(135deg, #059669, #047857); }\
            .role-banned { background: linear-gradient(135deg, #4B5563, #374151); }\
            .modern-like-stats {\
                display: flex;\
                flex-wrap: wrap;\
                gap: 1rem;\
                margin-top: 0.25rem;\
                font-size: 0.7rem;\
                color: var(--text-tertiary, #6B7280);\
            }\
            .modern-like-stats i {\
                margin-right: 0.25rem;\
                width: 12px;\
                color: var(--primary-light, #10B981);\
            }\
            .status-online { color: #10B981; }\
            .status-offline { color: #6B7280; }\
            .modern-loading, .modern-empty {\
                text-align: center;\
                padding: 3rem;\
                color: var(--text-tertiary, #6B7280);\
            }\
            .modern-loading i, .modern-empty i {\
                font-size: 2rem;\
                margin-bottom: 0.5rem;\
                display: block;\
            }\
            .modern-modal-footer {\
                padding: 0.75rem 1.5rem;\
                border-top: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));\
                background: var(--bg-color, #111827);\
                font-size: 0.7rem;\
                color: var(--text-tertiary, #6B7280);\
                text-align: center;\
                flex-shrink: 0;\
            }\
            .modern-modal-footer i {\
                margin-right: 0.25rem;\
                font-size: 0.65rem;\
            }\
            @keyframes fadeIn {\
                from { opacity: 0; }\
                to { opacity: 1; }\
            }\
            @keyframes slideUp {\
                from {\
                    opacity: 0;\
                    transform: translateY(20px);\
                }\
                to {\
                    opacity: 1;\
                    transform: translateY(0);\
                }\
            }\
        </style>\
    ';
    
    // Helper functions
    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        var colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
        return AVATAR_COLORS[colorIndex];
    }
    
    function generateDiceBearAvatar(username, userId) {
        var displayName = username || 'User';
        var firstLetter = displayName.charAt(0).toUpperCase();
        if (!firstLetter.match(/[A-Z0-9]/i)) firstLetter = '?';
        var backgroundColor = getColorFromNickname(username, userId);
        var params = [
            'seed=' + encodeURIComponent(firstLetter),
            'backgroundColor=' + backgroundColor,
            'radius=50',
            'size=70',
            'fontSize=32',
            'fontWeight=600'
        ];
        return 'https://api.dicebear.com/7.x/initials/svg?' + params.join('&');
    }
    
    function isValidAvatar(avatarUrl) {
        if (!avatarUrl || typeof avatarUrl !== 'string') return false;
        var lowerUrl = avatarUrl.toLowerCase();
        if (lowerUrl === 'http' || lowerUrl === 'http:' || lowerUrl === 'https' || lowerUrl === 'https:') return false;
        if (lowerUrl === '' || lowerUrl === 'null' || lowerUrl === 'undefined') return false;
        if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://') && !lowerUrl.startsWith('//')) return false;
        return true;
    }
    
    function getUserAvatarSync(user) {
        var avatarUrl = user.avatar;
        if (!isValidAvatar(avatarUrl)) {
            return {
                url: generateDiceBearAvatar(user.nickname, user.id),
                quality: null,
                format: 'svg',
                isGif: false,
                width: 48,
                height: 48
            };
        }
        if (avatarUrl.startsWith('//')) avatarUrl = 'https:' + avatarUrl;
        if (avatarUrl.startsWith('http://') && window.location.protocol === 'https:') {
            avatarUrl = avatarUrl.replace('http://', 'https://');
        }
        return optimizeImageUrl(avatarUrl, 48, 48);
    }
    
    function storeProfileLinks(legacyModal) {
        var userLinks = legacyModal.querySelectorAll('.users li a');
        for (var i = 0; i < userLinks.length; i++) {
            var link = userLinks[i];
            var match = link.href.match(/MID=(\d+)/);
            if (match) userProfileLinks.set(match[1], link.href);
        }
    }
    
    function navigateToProfile(userId) {
        var profileUrl = userProfileLinks.get(userId);
        if (profileUrl) window.location.href = profileUrl;
    }
    
    function clickOriginalCloseButton(legacyModal) {
        if (!legacyModal) return;
        var closeButton = legacyModal.querySelector('a.close');
        if (closeButton) {
            var clickEvent = document.createEvent('MouseEvents');
            clickEvent.initEvent('click', true, true);
            closeButton.dispatchEvent(clickEvent);
        }
    }
    
    function extractUserIdsFromLegacyModal(legacyModal) {
        var userIds = [];
        var userLinks = legacyModal.querySelectorAll('.users a[href*="MID="], .points_pos');
        for (var i = 0; i < userLinks.length; i++) {
            var link = userLinks[i];
            var match = link.href ? link.href.match(/MID=(\d+)/) : null;
            if (match && userIds.indexOf(match[1]) === -1) userIds.push(match[1]);
        }
        return userIds;
    }
    
    async function fetchUsersFromApi(userIds) {
        if (!userIds || userIds.length === 0) return [];
        try {
            var response = await fetch('/api.php?mid=' + userIds.join(','));
            var data = await response.json();
            var users = [];
            for (var key in data) {
                if (data.hasOwnProperty(key) && key.indexOf('m') === 0 && data[key].id) {
                    users.push(data[key]);
                }
            }
            return users;
        } catch (error) {
            console.error('[Modern Likes] API Error:', error);
            return [];
        }
    }
    
    function getUserRoleInfo(user) {
        if (user.banned === 1) return { class: 'role-banned', text: 'Banned' };
        if (user.group) {
            var groupName = (user.group.name || '').toLowerCase();
            var groupClass = (user.group.class || '').toLowerCase();
            var groupId = user.group.id;
            if (groupClass.indexOf('founder') !== -1 || groupName === 'founder') return { class: 'role-founder', text: 'Founder' };
            if (groupName === 'administrator' || groupClass.indexOf('admin') !== -1 || groupId === 1) return { class: 'role-administrator', text: 'Administrator' };
            if (groupName === 'global moderator' || groupClass.indexOf('global_mod') !== -1) return { class: 'role-global-mod', text: 'Global Mod' };
            if (groupName === 'moderator' || groupClass.indexOf('mod') !== -1) return { class: 'role-moderator', text: 'Moderator' };
            if (groupName === 'developer' || groupClass.indexOf('developer') !== -1) return { class: 'role-developer', text: 'Developer' };
            if (groupName === 'premium' || groupClass.indexOf('premium') !== -1) return { class: 'role-premium', text: 'Premium' };
            if (groupName === 'vip' || groupClass.indexOf('vip') !== -1) return { class: 'role-vip', text: 'VIP' };
        }
        if (user.permission) {
            if (user.permission.founder === 1) return { class: 'role-founder', text: 'Founder' };
            if (user.permission.admin === 1) return { class: 'role-administrator', text: 'Administrator' };
            if (user.permission.global_mod === 1) return { class: 'role-global-mod', text: 'Global Mod' };
            if (user.permission.mod_sez === 1) return { class: 'role-moderator', text: 'Moderator' };
        }
        if (user.group && user.group.name && user.group.name !== 'Members' && user.group.name !== 'member') {
            return { class: 'role-member', text: user.group.name };
        }
        return { class: 'role-member', text: 'Member' };
    }
    
    function formatNumber(num) {
        if (!num && num !== 0) return '0';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
    
    function getCurrentTime() {
        var now = new Date();
        var hours = now.getHours().toString().padStart(2, '0');
        var minutes = now.getMinutes().toString().padStart(2, '0');
        return hours + ':' + minutes;
    }
    
    function closeCustomModal(legacyModal, skipOriginalClose) {
        if (currentCustomModal) {
            currentCustomModal.remove();
            currentCustomModal = null;
        }
        if (legacyModal && !skipOriginalClose && !closeCooldown) {
            clickOriginalCloseButton(legacyModal);
            closeCooldown = true;
            if (cooldownTimer) clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(function() { closeCooldown = false; }, 500);
        }
        currentLegacyModal = null;
        processingModal = false;
    }
    
    async function showModernModal(userIds, legacyModal) {
        if (closeCooldown || processingModal) return;
        processingModal = true;
        storeProfileLinks(legacyModal);
        if (currentCustomModal) currentCustomModal.remove();
        currentLegacyModal = legacyModal;
        
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        var modal = document.createElement('div');
        modal.className = 'modern-likes-modal';
        
        var currentTime = getCurrentTime();
        modal.innerHTML = 
            '<div class="modern-modal-header">' +
                '<div class="modern-modal-title">' +
                    '<i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>' +
                    '<h3>Liked by</h3>' +
                    '<span class="modal-like-count">' + userIds.length + '</span>' +
                '</div>' +
                '<button class="modern-modal-close" aria-label="Close">' +
                    '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
                '</button>' +
            '</div>' +
            '<div class="modern-likes-list">' +
                '<div class="modern-loading">' +
                    '<i class="fa-regular fa-spinner fa-pulse" aria-hidden="true"></i>' +
                    '<p>Loading user data...</p>' +
                '</div>' +
            '</div>' +
            '<div class="modern-modal-footer">' +
                '<i class="fa-regular fa-clock" aria-hidden="true"></i> ' + currentTime + ' \u00b7 post feedback' +
            '</div>';
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        currentCustomModal = overlay;
        
        var closeBtn = modal.querySelector('.modern-modal-close');
        closeBtn.addEventListener('click', function() { closeCustomModal(legacyModal, false); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeCustomModal(legacyModal, false); });
        var escHandler = function(e) { if (e.key === 'Escape') closeCustomModal(legacyModal, false); document.removeEventListener('keydown', escHandler); };
        document.addEventListener('keydown', escHandler);
        
        var likesList = modal.querySelector('.modern-likes-list');
        
        try {
            var users = await fetchUsersFromApi(userIds);
            if (!users || users.length === 0) {
                likesList.innerHTML = '<div class="modern-empty"><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i><p>No user data available</p></div>';
                processingModal = false;
                return;
            }
            
            var sortedUsers = users.slice().sort(function(a, b) {
                var aIsStaff = (a.permission && (a.permission.founder || a.permission.admin || a.permission.global_mod));
                var bIsStaff = (b.permission && (b.permission.founder || b.permission.admin || b.permission.global_mod));
                if (aIsStaff && !bIsStaff) return -1;
                if (!aIsStaff && bIsStaff) return 1;
                return (b.reputation || 0) - (a.reputation || 0);
            });
            
            var itemsHtml = '';
            for (var i = 0; i < sortedUsers.length; i++) {
                var user = sortedUsers[i];
                var roleInfo = getUserRoleInfo(user);
                var avatarData = getUserAvatarSync(user);
                var avatarUrl = avatarData.url;
                var avatarQuality = avatarData.quality;
                var avatarFormat = avatarData.format;
                var isGif = avatarData.isGif;
                var dicebearFallback = generateDiceBearAvatar(user.nickname, user.id);
                var optimizedFallback = optimizeImageUrl(dicebearFallback, 48, 48);
                var statusText = user.status || 'offline';
                var statusClass = user.status === 'online' ? 'status-online' : 'status-offline';
                var escapedNickname = escapeHtml(user.nickname);
                var qualityAttr = avatarQuality ? 'data-quality="' + avatarQuality + '" ' : '';
                var formatAttr = avatarFormat ? 'data-format="' + avatarFormat + '" ' : '';
                var optimizedAttr = avatarQuality ? 'data-optimized="true" ' : '';
                var gifAttr = isGif ? 'data-original-format="gif" ' : '';
                
                itemsHtml += 
                    '<div class="modern-like-item" data-user-id="' + user.id + '">' +
                        '<img class="modern-like-avatar" src="' + avatarUrl + '" alt="Avatar of ' + escapedNickname + '" loading="lazy" decoding="async" width="48" height="48" data-user-id="' + user.id + '" ' + qualityAttr + formatAttr + optimizedAttr + gifAttr + 'onerror="this.onerror=null; this.src=\'' + optimizedFallback.url + '\';">' +
                        '<div class="modern-like-info" data-user-id="' + user.id + '">' +
                            '<div class="modern-like-name-row">' +
                                '<span class="modern-like-name" data-user-id="' + user.id + '">' + escapedNickname + '</span>' +
                                '<span class="modern-role-badge ' + roleInfo.class + '">' + escapeHtml(roleInfo.text) + '</span>' +
                            '</div>' +
                            '<div class="modern-like-stats">' +
                                '<span><i class="fa-regular fa-message" aria-hidden="true"></i> ' + formatNumber(user.messages) + ' posts</span>' +
                                '<span><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> ' + formatNumber(user.reputation) + ' rep</span>' +
                                '<span class="' + statusClass + '"><i class="fa-regular fa-circle" aria-hidden="true"></i> ' + statusText + '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
            }
            likesList.innerHTML = itemsHtml;
            
            var clickableElements = likesList.querySelectorAll('.modern-like-item, .modern-like-avatar, .modern-like-info, .modern-like-name');
            for (var i = 0; i < clickableElements.length; i++) {
                var element = clickableElements[i];
                var userId = element.getAttribute('data-user-id');
                if (userId) {
                    element.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var uid = this.getAttribute('data-user-id');
                        if (uid) navigateToProfile(uid);
                    });
                }
            }
        } catch (error) {
            console.error('[Modern Likes] Error:', error);
            likesList.innerHTML = '<div class="modern-empty"><i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i><p>Error loading user data.</p></div>';
        }
        processingModal = false;
    }
    
    // Initialize using the ForumCoreObserver
    function init() {
        // Inject styles
        if (!document.querySelector('#modern-likes-modal-styles')) {
            document.head.insertAdjacentHTML('beforeend', modalStyles);
        }
        
        // Inject Font Awesome if not present
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
            var faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
            document.head.appendChild(faLink);
        }
        
        // Register with ForumCoreObserver
        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
            globalThis.forumObserver.register({
                id: 'modern-likes-modal',
                selector: '.popup.pop_points, #overlay.pop_points',
                priority: 'high',
                callback: function(node) {
                    // Check if this is the legacy modal and it's visible
                    if (node && node.style && node.style.display === 'block') {
                        var userIds = extractUserIdsFromLegacyModal(node);
                        if (userIds.length > 0 && !currentCustomModal) {
                            console.log('[Modern Likes] Detected modal via observer with', userIds.length, 'users');
                            showModernModal(userIds, node);
                        }
                    }
                }
            });
            
            // Also register for attribute changes (style changes)
            globalThis.forumObserver.register({
                id: 'modern-likes-modal-style',
                selector: '#overlay.pop_points',
                priority: 'high',
                callback: function(node) {
                    if (node && node.style && node.style.display === 'block' && !currentCustomModal) {
                        var userIds = extractUserIdsFromLegacyModal(node);
                        if (userIds.length > 0) {
                            console.log('[Modern Likes] Style change detected modal with', userIds.length, 'users');
                            showModernModal(userIds, node);
                        }
                    }
                }
            });
            
            console.log('[Modern Likes] Registered with ForumCoreObserver');
        } else {
            // Fallback: Use MutationObserver if ForumCoreObserver is not available
            console.log('[Modern Likes] ForumCoreObserver not found, using fallback MutationObserver');
            var fallbackObserver = new MutationObserver(function(mutations) {
                if (closeCooldown) return;
                for (var i = 0; i < mutations.length; i++) {
                    var mutation = mutations[i];
                    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                        var modal = mutation.target;
                        if (modal.id === 'overlay' && modal.classList && modal.classList.contains('pop_points') &&
                            modal.style.display === 'block' && !processingModal && !currentCustomModal) {
                            var userIds = extractUserIdsFromLegacyModal(modal);
                            if (userIds.length > 0) showModernModal(userIds, modal);
                        }
                    }
                    if (mutation.type === 'childList') {
                        for (var j = 0; j < mutation.addedNodes.length; j++) {
                            var node = mutation.addedNodes[j];
                            if (node.nodeType === 1 && node.id === 'overlay' && node.classList && 
                                node.classList.contains('pop_points') && node.style.display === 'block' &&
                                !processingModal && !currentCustomModal) {
                                var userIds = extractUserIdsFromLegacyModal(node);
                                if (userIds.length > 0) showModernModal(userIds, node);
                            }
                        }
                    }
                }
            });
            fallbackObserver.observe(document.body, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
        }
        
        console.log('[Modern Likes] Ready - waiting for likes modal');
    }
    
    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
