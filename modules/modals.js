// ==UserScript==
// @name         Modern Likes Modal for ForumFree
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Replaces the old likes popup with a modern modal using real API data
// @author       You
// @match        *://*.forumfree.it/*
// @match        *://*.forumcommunity.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- STATE ---
    var currentCustomModal = null;
    var currentLegacyModal = null;
    var closeCooldown = false;
    var cooldownTimer = null;
    var processingModal = false;

    // --- CONFIGURATION ---
    var WESERV_CONFIG = {
        cdn: 'https://images.weserv.nl/',
        cache: '1y',
        quality: 90,
        avatarWidth: 48,
        avatarHeight: 48
    };

    // Midnight Emerald harmonious color palette
    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    var userProfileLinks = new Map();

    // --- HELPERS ---
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
        var isGif = (lowerUrl.indexOf('.gif') !== -1 ||
                     lowerUrl.indexOf('.gif?') !== -1 ||
                     lowerUrl.indexOf('.gif#') !== -1 ||
                     /\.gif($|\?|#)/i.test(lowerUrl));

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
            optimizedUrl += '&n=-1&lossless=true';
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
            var dicebearUrl = generateDiceBearAvatar(user.nickname, user.id);
            return { url: dicebearUrl, quality: null, format: 'svg', isGif: false, width: 48, height: 48 };
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
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
                var uid = element.getAttribute('data-user-id');
                if (uid) {
                    element.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var uid2 = this.getAttribute('data-user-id');
                        if (uid2) navigateToProfile(uid2);
                    });
                }
            }
        } catch (error) {
            console.error('[Modern Likes] Error:', error);
            likesList.innerHTML = '<div class="modern-empty"><i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i><p>Error loading user data.</p></div>';
        }
        processingModal = false;
    }

    // --- INITIALIZATION (relies on ForumCoreObserver, falls back to MutationObserver) ---
    function init() {
        // Ensure Font Awesome is available
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
            var faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
            document.head.appendChild(faLink);
        }

        // Use global ForumCoreObserver if present
        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
            globalThis.forumObserver.register({
                id: 'modern-likes-modal',
                selector: '.popup.pop_points, #overlay.pop_points',
                priority: 'high',
                callback: function(node) {
                    if (node && node.style && node.style.display === 'block') {
                        var userIds = extractUserIdsFromLegacyModal(node);
                        if (userIds.length > 0 && !currentCustomModal) {
                            showModernModal(userIds, node);
                        }
                    }
                }
            });
            globalThis.forumObserver.register({
                id: 'modern-likes-modal-style',
                selector: '#overlay.pop_points',
                priority: 'high',
                callback: function(node) {
                    if (node && node.style && node.style.display === 'block' && !currentCustomModal) {
                        var userIds = extractUserIdsFromLegacyModal(node);
                        if (userIds.length > 0) {
                            showModernModal(userIds, node);
                        }
                    }
                }
            });
            console.log('[Modern Likes] Registered with ForumCoreObserver');
        } else {
            // Fallback MutationObserver (same as old version)
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
            console.log('[Modern Likes] Using fallback MutationObserver');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
