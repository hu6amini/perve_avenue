// ==UserScript==
// @name         Modern Likes Modal for ForumFree
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Adds a modern likes modal alongside the original
// @author       You
// @match        *://*.forumfree.it/*
// @match        *://*.forumcommunity.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    // Modern modal styles
    var modalStyles = '\
        <style id="modern-likes-modal-styles">\
            /* Modal Overlay */\
            .modern-modal-overlay {\
                position: fixed;\
                top: 0;\
                left: 0;\
                right: 0;\
                bottom: 0;\
                background: rgba(0, 0, 0, 0.8);\
                backdrop-filter: blur(4px);\
                z-index: 10001;\
                display: flex;\
                align-items: center;\
                justify-content: center;\
                animation: fadeIn 0.2s ease;\
            }\
            \
            /* Modal Container */\
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
            \
            /* Modal Header */\
            .modern-modal-header {\
                display: flex;\
                justify-content: space-between;\
                align-items: center;\
                padding: 1rem 1.5rem;\
                border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));\
                background: var(--surface-color, #1F2937);\
            }\
            \
            .modern-modal-title {\
                display: flex;\
                align-items: center;\
                gap: 0.5rem;\
                font-weight: 600;\
                font-size: 1.1rem;\
                color: var(--text-primary, #F9FAFB);\
                font-family: "Quicksand", sans-serif;\
            }\
            \
            .modern-modal-title i {\
                color: var(--primary-light, #10B981);\
            }\
            \
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
            \
            .modern-modal-close:hover {\
                background: var(--hover-color, rgba(255, 255, 255, 0.05));\
                color: var(--text-primary, #F9FAFB);\
                transform: rotate(90deg);\
            }\
            \
            /* Likes List */\
            .modern-likes-list {\
                max-height: 60vh;\
                overflow-y: auto;\
                background: var(--surface-color, #1F2937);\
            }\
            \
            .modern-likes-list::-webkit-scrollbar {\
                width: 6px;\
            }\
            \
            .modern-likes-list::-webkit-scrollbar-track {\
                background: transparent;\
            }\
            \
            .modern-likes-list::-webkit-scrollbar-thumb {\
                background: var(--surface-light, #374151);\
                border-radius: 20px;\
            }\
            \
            /* Like Item */\
            .modern-like-item {\
                display: flex;\
                align-items: center;\
                gap: 1rem;\
                padding: 0.875rem 1.5rem;\
                border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.05));\
                transition: background 0.2s;\
            }\
            \
            .modern-like-item:hover {\
                background: var(--hover-color, rgba(255, 255, 255, 0.05));\
            }\
            \
            /* Avatar */\
            .modern-like-avatar {\
                width: 48px;\
                height: 48px;\
                border-radius: 50%;\
                object-fit: cover;\
                border: 2px solid var(--primary-color, #059669);\
                flex-shrink: 0;\
                background: var(--surface-light, #374151);\
            }\
            \
            /* User Info */\
            .modern-like-info {\
                flex: 1;\
                min-width: 0;\
            }\
            \
            .modern-like-name-row {\
                display: flex;\
                align-items: center;\
                flex-wrap: wrap;\
                gap: 0.5rem;\
            }\
            \
            .modern-like-name {\
                font-weight: 600;\
                color: var(--text-primary, #F9FAFB);\
                text-decoration: none;\
                font-size: 0.95rem;\
                transition: color 0.2s;\
            }\
            \
            .modern-like-name:hover {\
                color: var(--primary-light, #10B981);\
                text-decoration: underline;\
            }\
            \
            /* Role Badges */\
            .modern-role-badge {\
                display: inline-block;\
                padding: 0.125rem 0.5rem;\
                border-radius: 9999px;\
                font-size: 0.625rem;\
                font-weight: 600;\
                color: white;\
            }\
            \
            .role-founder { background: linear-gradient(135deg, #F59E0B, #D97706); }\
            .role-administrator { background: linear-gradient(135deg, #DC2626, #B91C1C); }\
            .role-global-mod { background: linear-gradient(135deg, #8B5CF6, #7C3AED); }\
            .role-moderator { background: linear-gradient(135deg, #8B5CF6, #7C3AED); }\
            .role-developer { background: linear-gradient(135deg, #0EA5E9, #0284C7); }\
            .role-premium { background: linear-gradient(135deg, #D946EF, #C026D3); }\
            .role-vip { background: linear-gradient(135deg, #F97316, #EA580C); }\
            .role-member { background: linear-gradient(135deg, #059669, #047857); }\
            .role-banned { background: linear-gradient(135deg, #4B5563, #374151); }\
            \
            /* User Stats */\
            .modern-like-stats {\
                display: flex;\
                flex-wrap: wrap;\
                gap: 1rem;\
                margin-top: 0.25rem;\
                font-size: 0.7rem;\
                color: var(--text-tertiary, #6B7280);\
            }\
            \
            .modern-like-stats i {\
                margin-right: 0.25rem;\
                width: 12px;\
                color: var(--primary-light, #10B981);\
            }\
            \
            .status-online { color: #10B981; }\
            .status-offline { color: #6B7280; }\
            \
            .modern-loading, .modern-empty {\
                text-align: center;\
                padding: 3rem;\
                color: var(--text-tertiary, #6B7280);\
            }\
            \
            .modern-loading i, .modern-empty i {\
                font-size: 2rem;\
                margin-bottom: 0.5rem;\
                display: block;\
            }\
            \
            @keyframes fadeIn {\
                from { opacity: 0; }\
                to { opacity: 1; }\
            }\
            \
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
    
    // Helper: Get the position of the original modal to place ours nearby
    function getModalPosition(originalModal) {
        var rect = originalModal.getBoundingClientRect();
        return {
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
            height: rect.height
        };
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
            if (groupName === 'global moderator' || groupClass.indexOf('global_mod') !== -1) {
                return { class: 'role-global-mod', text: 'Global Mod' };
            }
            if (groupName === 'moderator' || groupClass.indexOf('mod') !== -1) {
                return { class: 'role-moderator', text: 'Moderator' };
            }
            if (groupName === 'developer' || groupClass.indexOf('developer') !== -1) {
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
    
    // Create modern modal based on original modal content
    async function createModernModal(originalModal) {
        // Extract user IDs from the original modal
        var userIds = extractUserIdsFromLegacyModal(originalModal);
        
        if (userIds.length === 0) {
            console.log('[Modern Likes] No user IDs found in original modal');
            return;
        }
        
        console.log('[Modern Likes] Creating modern modal for', userIds.length, 'users');
        
        // Create overlay
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        
        // Create modal container
        var modal = document.createElement('div');
        modal.className = 'modern-likes-modal';
        
        // Build modal HTML with concatenation
        var modalHtml = 
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
        
        modal.innerHTML = modalHtml;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Close button functionality
        var closeBtn = modal.querySelector('.modern-modal-close');
        var closeModal = function() { overlay.remove(); };
        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeModal();
        });
        
        // Fetch and render users
        var likesList = modal.querySelector('.modern-likes-list');
        
        try {
            var users = await fetchUsersFromApi(userIds);
            
            if (!users || users.length === 0) {
                likesList.innerHTML = 
                    '<div class="modern-empty">' +
                        '<i class="fa-regular fa-thumbs-up"></i>' +
                        '<p>No user data available</p>' +
                    '</div>';
                return;
            }
            
            // Sort users: staff first, then by reputation
            var sortedUsers = users.slice().sort(function(a, b) {
                var aIsStaff = (a.permission && (a.permission.founder || a.permission.admin || a.permission.global_mod));
                var bIsStaff = (b.permission && (b.permission.founder || b.permission.admin || b.permission.global_mod));
                if (aIsStaff && !bIsStaff) return -1;
                if (!aIsStaff && bIsStaff) return 1;
                return (b.reputation || 0) - (a.reputation || 0);
            });
            
            // Build HTML for each user
            var itemsHtml = '';
            for (var i = 0; i < sortedUsers.length; i++) {
                var user = sortedUsers[i];
                var roleInfo = getUserRoleInfo(user);
                var avatarUrl = user.avatar || 'https://img.forumfree.net/style_images/avatar_nn.png';
                var statusIcon = 'fa-circle';
                var statusText = user.status || 'offline';
                
                itemsHtml += 
                    '<div class="modern-like-item">' +
                        '<img class="modern-like-avatar" ' +
                             'src="' + avatarUrl + '" ' +
                             'alt="' + escapeHtml(user.nickname) + '" ' +
                             'onerror="this.src=\'https://img.forumfree.net/style_images/avatar_nn.png\'">' +
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
                                '<span class="status-' + user.status + '">' +
                                    '<i class="fa-regular ' + statusIcon + '"></i> ' + statusText +
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
    }
    
    // Add a modern button next to the original like button
    function addModernLikeButton() {
        // Find the points_up container which contains the like button
        var pointsUpContainers = document.querySelectorAll('.points_up');
        
        for (var i = 0; i < pointsUpContainers.length; i++) {
            var pointsUp = pointsUpContainers[i];
            
            // Check if we already added a modern button here
            if (pointsUp.parentNode.querySelector('.modern-like-trigger')) {
                continue;
            }
            
            // Create modern like button
            var modernBtn = document.createElement('button');
            modernBtn.className = 'modern-like-trigger';
            modernBtn.innerHTML = '<i class="fa-regular fa-heart"></i> <span>Likes</span>';
            modernBtn.style.cssText = 
                'background: linear-gradient(135deg, #059669, #047857);' +
                'border: none;' +
                'border-radius: 40px;' +
                'padding: 0.3rem 0.9rem;' +
                'font-size: 0.75rem;' +
                'font-weight: 500;' +
                'color: white;' +
                'cursor: pointer;' +
                'margin-left: 8px;' +
                'transition: all 0.2s;';
            
            modernBtn.onmouseover = function() {
                this.style.transform = 'translateY(-1px)';
                this.style.boxShadow = '0 2px 8px rgba(5, 150, 105, 0.3)';
            };
            modernBtn.onmouseout = function() {
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = 'none';
            };
            
            // Add click handler to show modern modal
            modernBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                // Find the closest overlay (the original likes modal)
                var overlay = document.getElementById('overlay');
                if (overlay && overlay.classList.contains('pop_points')) {
                    // If the original modal exists, use its data
                    createModernModal(overlay);
                } else {
                    console.log('[Modern Likes] Original modal not found');
                }
            });
            
            // Insert the button next to points_up
            pointsUp.parentNode.insertBefore(modernBtn, pointsUp.nextSibling);
        }
    }
    
    // Watch for dynamically loaded content (ajax pagination, etc)
    function initObserver() {
        // Inject styles
        if (!document.querySelector('#modern-likes-modal-styles')) {
            document.head.insertAdjacentHTML('beforeend', modalStyles);
        }
        
        // Inject Font Awesome if needed
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
            var faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
            document.head.appendChild(faLink);
        }
        
        // Add buttons to existing content
        addModernLikeButton();
        
        // Watch for new content loaded via AJAX
        var observer = new MutationObserver(function(mutations) {
            var shouldAdd = false;
            for (var i = 0; i < mutations.length; i++) {
                if (mutations[i].addedNodes.length > 0) {
                    shouldAdd = true;
                    break;
                }
            }
            if (shouldAdd) {
                addModernLikeButton();
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('[Modern Likes] Modern like buttons added - click them to see the modern modal');
    }
    
    // Start the script when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initObserver);
    } else {
        initObserver();
    }
})();
