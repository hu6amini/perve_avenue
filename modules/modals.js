// ==UserScript==
// @name         Modern Likes Modal for ForumFree
// @namespace    http://tampermonkey.net/
// @version      2.6
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
    
    // ============================================================================
    // EMERALD THEME HARMONIZED COLOR PALETTE
    // Based on midnight emerald theme from the modern post cards
    // ============================================================================
    var AVATAR_COLORS = [
        // Emerald greens (primary theme colors)
        '#059669', // primary emerald
        '#10B981', // light emerald
        '#047857', // dark emerald
        '#34D399', // soft emerald
        '#6EE7B7', // pale emerald
        
        // Accent colors that complement emerald
        '#7C3AED', // purple accent (from theme)
        '#0EA5E9', // blue accent (from theme)
        '#F59E0B', // warm amber accent
        '#DC2626', // red accent (admin color)
        '#8B5CF6', // violet (mod color)
        
        // Harmonious teals and mints
        '#14B8A6', // teal
        '#2DD4BF', // light teal
        '#0D9488', // dark teal
        '#00A896', // mint teal
        
        // Warm accents that don't clash
        '#F97316', // orange
        '#FBBF24', // golden
        '#EF4444', // sunset red
        '#EC4899', // pink accent
        
        // Cool accents that work with emerald
        '#3B82F6', // blue
        '#6366F1', // indigo
        '#8B5CF6', // purple
        '#A855F7', // bright purple
        
        // Soft neutral tones
        '#78716C', // warm gray
        '#64748B', // slate
        '#6B7280', // cool gray
        '#9CA3AF', // light gray
        '#A8A29E'  // taupe
    ];
    
    // Fallback simple colors in case of any issues
    var FALLBACK_COLORS = ['#059669', '#10B981', '#7C3AED', '#0EA5E9', '#F59E0B', '#DC2626', '#8B5CF6'];
    
    // ============================================================================
    // AVATAR GENERATION WITH THEME-HARMONIZED COLORS
    // ============================================================================
    
    // Generate a consistent hash from a string (username or user ID)
    function getStringHash(str) {
        var hash = 0;
        if (!str) return hash;
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }
    
    // Get a consistent color for a user based on their nickname
    function getAvatarColorForUser(nickname, userId) {
        // Use nickname if available, otherwise use userId
        var identifier = nickname || userId || 'unknown';
        var hash = getStringHash(identifier);
        var colorIndex = hash % AVATAR_COLORS.length;
        return AVATAR_COLORS[colorIndex];
    }
    
    // Generate DiceBear avatar with emerald-theme harmonized colors
    function generateDiceBearAvatar(username, userId) {
        var displayName = username || 'User';
        
        // Get the first letter, handle special cases
        var firstLetter = displayName.charAt(0).toUpperCase();
        if (!firstLetter.match(/[A-Z0-9]/i)) {
            firstLetter = '?';
        }
        
        // Get consistent color for this user
        var backgroundColor = getAvatarColorForUser(username, userId);
        // Remove the '#' if present for the URL
        var bgColorHex = backgroundColor.replace('#', '');
        
        // Use DiceBear initials API with the harmonized color
        var params = [
            'seed=' + encodeURIComponent(firstLetter),
            'backgroundColor=' + bgColorHex,
            'radius=50',
            'size=70',
            'fontSize=32',
            'fontWeight=600',
            'bold=true',
            'fontColor=FFFFFF'  // White text for contrast on all colors
        ];
        
        return 'https://api.dicebear.com/7.x/initials/svg?' + params.join('&');
    }
    
    // Check if avatar URL is valid (not the broken "http" from API)
    function isValidAvatar(avatarUrl) {
        if (!avatarUrl) return false;
        // Catch broken URL patterns from the API
        if (avatarUrl === 'http' || avatarUrl === 'http:' || avatarUrl === 'https' || avatarUrl === 'https:') {
            return false;
        }
        // Check if it's an empty string
        if (avatarUrl === '' || avatarUrl.trim() === '') {
            return false;
        }
        // Check if it's a valid URL format
        if (!avatarUrl.startsWith('http://') && !avatarUrl.startsWith('https://') && !avatarUrl.startsWith('//')) {
            return false;
        }
        return true;
    }
    
    // Get best avatar URL for user (forum avatar or DiceBear fallback)
    function getUserAvatar(user) {
        var avatarUrl = user.avatar;
        
        // Fix protocol-relative URLs
        if (avatarUrl && avatarUrl.startsWith('//')) {
            avatarUrl = 'https:' + avatarUrl;
        }
        
        // Check if avatar exists and is valid
        if (isValidAvatar(avatarUrl)) {
            return avatarUrl;
        }
        
        // Fallback to DiceBear avatar with harmonized color
        return generateDiceBearAvatar(user.nickname, user.id);
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
                var avatarUrl = getUserAvatar(user);
                var statusText = user.status || 'offline';
                var statusClass = user.status === 'online' ? 'status-online' : 'status-offline';
                var dicebearFallback = generateDiceBearAvatar(user.nickname, user.id);
                
                itemsHtml += 
                    '<div class="modern-like-item">' +
                        '<img class="modern-like-avatar" ' +
                             'src="' + avatarUrl + '" ' +
                             'alt="Avatar of ' + escapeHtml(user.nickname) + '" ' +
                             'loading="lazy" ' +
                             'onerror="this.onerror=null; this.src=\'' + dicebearFallback + '\';">' +
                        '<div class="modern-like-info">' +
                            '<div class="modern-like-name-row">' +
                                '<a href="/?act=Profile&amp;MID=' + user.id + '" class="modern-like-name" target="_blank">' +
                                    escapeHtml(user.nickname) +
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
