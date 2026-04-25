// ==UserScript==
// @name         Modern Likes Modal for ForumFree
// @namespace    http://tampermonkey.net/
// @version      2.7
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
    
    // Modern modal styles
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
            }\
            .modern-modal-header {\
                display: flex;\
                justify-content: space-between;\
                align-items: center;\
                padding: 1rem 1.5rem;\
                border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));\
                background: var(--surface-color, #1F2937);\
            }\
            .modern-modal-title {\
                display: flex;\
                align-items: center;\
                gap: 0.5rem;\
                font-weight: 600;\
                font-size: 1.1rem;\
                color: var(--text-primary, #F9FAFB);\
                font-family: "Quicksand", sans-serif;\
            }\
            .modern-modal-title i {\
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
                max-height: 60vh;\
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
            }\
            .modern-like-info {\
                flex: 1;\
                min-width: 0;\
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
                text-decoration: none;\
                font-size: 0.95rem;\
                transition: color 0.2s;\
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
    
    // Helper: Generate deterministic color from nickname
    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        
        var absHash = Math.abs(hash);
        var colorIndex = absHash % AVATAR_COLORS.length;
        
        return AVATAR_COLORS[colorIndex];
    }
    
    // Helper: Generate DiceBear avatar from username
    function generateDiceBearAvatar(username, userId) {
        var displayName = username || 'User';
        var firstLetter = displayName.charAt(0).toUpperCase();
        
        if (!firstLetter.match(/[A-Z0-9]/i)) {
            firstLetter = '?';
        }
        
        var backgroundColor = getColorFromNickname(username, userId);
        
        var params = [
            'seed=' + encodeURIComponent(firstLetter),
            'backgroundColor=' + backgroundColor,
            'radius=50',
            'size=70',
            'fontSize=32',
            'fontWeight=600',
            'bold=true',
            'fontFamily=Quicksand,sans-serif'
        ];
        
        return 'https://api.dicebear.com/7.x/initials/svg?' + params.join('&');
    }
    
    // Helper: Check if avatar URL is valid and not broken
    function isValidAvatar(avatarUrl) {
        if (!avatarUrl) return false;
        if (typeof avatarUrl !== 'string') return false;
        
        var lowerUrl = avatarUrl.toLowerCase();
        
        // Check for incomplete URLs
        if (lowerUrl === 'http' || lowerUrl === 'http:' || lowerUrl === 'https' || lowerUrl === 'https:') {
            return false;
        }
        
        // Check for empty or invalid values
        if (lowerUrl === '' || lowerUrl === 'null' || lowerUrl === 'undefined') {
            return false;
        }
        
        // Check if it's a valid URL format
        if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://') && !lowerUrl.startsWith('//')) {
            return false;
        }
        
        return true;
    }
    
    // Helper: Test if an image URL actually loads (async)
    function testImageUrl(url) {
        return new Promise(function(resolve) {
            var img = new Image();
            img.onload = function() { resolve(true); };
            img.onerror = function() { resolve(false); };
            img.src = url;
        });
    }
    
    // Helper: Get best avatar URL for user (synchronous, returns DiceBear immediately for invalid URLs)
    function getUserAvatarSync(user) {
        var avatarUrl = user.avatar;
        
        // If avatar is invalid, immediately return DiceBear
        if (!isValidAvatar(avatarUrl)) {
            return generateDiceBearAvatar(user.nickname, user.id);
        }
        
        // Fix protocol-relative URLs
        if (avatarUrl.startsWith('//')) {
            avatarUrl = 'https:' + avatarUrl;
        }
        
        // Fix http to https if needed
        if (avatarUrl.startsWith('http://') && window.location.protocol === 'https:') {
            avatarUrl = avatarUrl.replace('http://', 'https://');
        }
        
        // For valid-looking URLs, we'll use them and let onerror handle fallback
        return avatarUrl;
    }
    
    // Helper: Find the close button in the legacy modal and click it
    function clickOriginalCloseButton(legacyModal) {
        if (!legacyModal) return;
        
        var closeButton = legacyModal.querySelector('a.close');
        if (closeButton) {
            console.log('[Modern Likes] Clicking original close button');
            var clickEvent = document.createEvent('MouseEvents');
            clickEvent.initEvent('click', true, true);
            closeButton.dispatchEvent(clickEvent);
        }
    }
    
    // Helper: Extract user IDs from the legacy modal
    function extractUserIdsFromLegacyModal(legacyModal) {
        var userIds = [];
        var userLinks = legacyModal.querySelectorAll('.users a[href*="MID="], .points_pos');
        
        for (var i = 0; i < userLinks.length; i++) {
            var link = userLinks[i];
            var match = link.href ? link.href.match(/MID=(\d+)/) : null;
            if (match && userIds.indexOf(match[1]) === -1) {
                userIds.push(match[1]);
            }
        }
        
        return userIds;
    }
    
    // Helper: Fetch multiple users from API
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
    
    // Helper: Determine role badge class and text from group object
    function getUserRoleInfo(user) {
        if (user.banned === 1) {
            return { class: 'role-banned', text: 'Banned' };
        }
        
        if (user.group) {
            var groupName = (user.group.name || '').toLowerCase();
            var groupClass = (user.group.class || '').toLowerCase();
            var groupId = user.group.id;
            
            if (groupClass.indexOf('founder') !== -1 || groupName === 'founder') {
                return { class: 'role-founder', text: 'Founder' };
            }
            if (groupName === 'administrator' || groupClass.indexOf('admin') !== -1 || groupId === 1) {
                return { class: 'role-administrator', text: 'Administrator' };
            }
            if (groupName === 'global moderator' || groupClass.indexOf('global_mod') !== -1 || groupName === 'global mod') {
                return { class: 'role-global-mod', text: 'Global Mod' };
            }
            if (groupName === 'moderator' || groupClass.indexOf('mod') !== -1 || groupName === 'mod') {
                return { class: 'role-moderator', text: 'Moderator' };
            }
            if (groupName === 'developer' || groupClass.indexOf('developer') !== -1 || groupClass.indexOf('dev') !== -1) {
                return { class: 'role-developer', text: 'Developer' };
            }
            if (groupName === 'premium' || groupClass.indexOf('premium') !== -1) {
                return { class: 'role-premium', text: 'Premium' };
            }
            if (groupName === 'vip' || groupClass.indexOf('vip') !== -1) {
                return { class: 'role-vip', text: 'VIP' };
            }
        }
        
        if (user.permission) {
            if (user.permission.founder === 1) {
                return { class: 'role-founder', text: 'Founder' };
            }
            if (user.permission.admin === 1) {
                return { class: 'role-administrator', text: 'Administrator' };
            }
            if (user.permission.global_mod === 1) {
                return { class: 'role-global-mod', text: 'Global Mod' };
            }
            if (user.permission.mod_sez === 1) {
                return { class: 'role-moderator', text: 'Moderator' };
            }
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
    
    // Close custom modal
    function closeCustomModal(legacyModal, skipOriginalClose) {
        if (currentCustomModal) {
            currentCustomModal.remove();
            currentCustomModal = null;
        }
        
        if (legacyModal && !skipOriginalClose && !closeCooldown) {
            clickOriginalCloseButton(legacyModal);
            
            closeCooldown = true;
            if (cooldownTimer) clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(function() {
                closeCooldown = false;
                console.log('[Modern Likes] Cooldown ended');
            }, 500);
        }
        
        currentLegacyModal = null;
        processingModal = false;
    }
    
    // Create and show modern modal
    async function showModernModal(userIds, legacyModal) {
        if (closeCooldown || processingModal) {
            console.log('[Modern Likes] Skipping - cooldown or already processing');
            return;
        }
        
        processingModal = true;
        
        if (currentCustomModal) {
            currentCustomModal.remove();
            currentCustomModal = null;
        }
        
        currentLegacyModal = legacyModal;
        
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        
        var modal = document.createElement('div');
        modal.className = 'modern-likes-modal';
        
        var headerHtml = 
            '<div class="modern-modal-header">' +
                '<div class="modern-modal-title">' +
                    '<i class="fa-regular fa-heart"></i>' +
                    '<span>Liked by <span class="like-count-display">' + userIds.length + '</span></span>' +
                '</div>' +
                '<button class="modern-modal-close" aria-label="Close">' +
                    '<i class="fa-regular fa-xmark"></i>' +
                '</button>' +
            '</div>' +
            '<div class="modern-likes-list">' +
                '<div class="modern-loading">' +
                    '<i class="fa-regular fa-spinner fa-pulse"></i>' +
                    '<p>Loading user data...</p>' +
                '</div>' +
            '</div>';
        
        modal.innerHTML = headerHtml;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        currentCustomModal = overlay;
        
        var closeBtn = modal.querySelector('.modern-modal-close');
        closeBtn.addEventListener('click', function() {
            closeCustomModal(legacyModal, false);
        });
        
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeCustomModal(legacyModal, false);
            }
        });
        
        var escHandler = function(e) {
            if (e.key === 'Escape') {
                closeCustomModal(legacyModal, false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        var likesList = modal.querySelector('.modern-likes-list');
        
        try {
            var users = await fetchUsersFromApi(userIds);
            
            if (!users || users.length === 0) {
                likesList.innerHTML = 
                    '<div class="modern-empty">' +
                        '<i class="fa-regular fa-thumbs-up"></i>' +
                        '<p>No user data available</p>' +
                    '</div>';
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
                // Get avatar URL - returns DiceBear immediately for invalid URLs
                var avatarUrl = getUserAvatarSync(user);
                var dicebearFallback = generateDiceBearAvatar(user.nickname, user.id);
                var statusText = user.status || 'offline';
                var statusClass = user.status === 'online' ? 'status-online' : 'status-offline';
                var escapedNickname = escapeHtml(user.nickname);
                
                itemsHtml += 
                    '<div class="modern-like-item">' +
                        '<img class="modern-like-avatar" ' +
                             'src="' + avatarUrl + '" ' +
                             'alt="Avatar of ' + escapedNickname + '" ' +
                             'loading="lazy" ' +
                             'onerror="this.onerror=null; this.src=\'' + dicebearFallback + '\';">' +
                        '<div class="modern-like-info">' +
                            '<div class="modern-like-name-row">' +
                                '<a href="/?act=Profile&amp;MID=' + user.id + '" class="modern-like-name" target="_blank">' +
                                    escapedNickname +
                                '</a>' +
                                '<span class="modern-role-badge ' + roleInfo.class + '">' + escapeHtml(roleInfo.text) + '</span>' +
                            '</div>' +
                            '<div class="modern-like-stats">' +
                                '<span><i class="fa-regular fa-message"></i> ' + formatNumber(user.messages) + ' posts</span>' +
                                '<span><i class="fa-regular fa-thumbs-up"></i> ' + formatNumber(user.reputation) + ' rep</span>' +
                                '<span class="' + statusClass + '">' +
                                    '<i class="fa-regular fa-circle"></i> ' + statusText +
                                '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
            }
            
            likesList.innerHTML = itemsHtml;
            
        } catch (error) {
            console.error('[Modern Likes] Error rendering:', error);
            likesList.innerHTML = 
                '<div class="modern-empty">' +
                    '<i class="fa-regular fa-circle-exclamation"></i>' +
                    '<p>Error loading user data. Please try again.</p>' +
                '</div>';
        }
        
        processingModal = false;
    }
    
    // Main observer to detect legacy modal
    function initModalObserver() {
        if (!document.querySelector('#modern-likes-modal-styles')) {
            document.head.insertAdjacentHTML('beforeend', modalStyles);
        }
        
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
            var faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
            document.head.appendChild(faLink);
        }
        
        var observer = new MutationObserver(function(mutations) {
            if (closeCooldown) return;
            
            for (var i = 0; i < mutations.length; i++) {
                var mutation = mutations[i];
                
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    var modal = mutation.target;
                    if (modal.id === 'overlay' && 
                        modal.classList.contains('pop_points') &&
                        modal.style.display === 'block' &&
                        !processingModal &&
                        !currentCustomModal) {
                        
                        var userIds = extractUserIdsFromLegacyModal(modal);
                        if (userIds.length > 0) {
                            console.log('[Modern Likes] Found likes modal with', userIds.length, 'users');
                            showModernModal(userIds, modal);
                        }
                    }
                }
                
                if (mutation.type === 'childList') {
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        var node = mutation.addedNodes[j];
                        if (node.nodeType === 1 && node.id === 'overlay' && 
                            node.classList && node.classList.contains('pop_points') &&
                            node.style.display === 'block' &&
                            !processingModal &&
                            !currentCustomModal) {
                            
                            var userIds = extractUserIdsFromLegacyModal(node);
                            if (userIds.length > 0) {
                                console.log('[Modern Likes] New modal detected with', userIds.length, 'users');
                                showModernModal(userIds, node);
                            }
                        }
                    }
                }
            }
        });
        
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['style'],
            childList: true,
            subtree: true
        });
        
        console.log('[Modern Likes] Observer active - waiting for likes modal to appear');
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModalObserver);
    } else {
        initModalObserver();
    }
})();
