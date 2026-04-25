// ==UserScript==
// @name         Modern Likes Modal for ForumFree
// @namespace    http://tampermonkey.net/
// @version      5.3
// @description  Replaces the old likes popup with a modern modal using real API data
// @author       You
// @match        *://*.forumfree.it/*
// @match        *://*.forumcommunity.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // CONFIGURATION
    // ============================================
    var CONFIG = {
        weserv: {
            cdn: 'https://images.weserv.nl/',
            cache: '1y',
            quality: 90,
            avatarWidth: 48,
            avatarHeight: 48
        },
        modal: {
            maxWidth: 480,
            maxHeight: '80vh',
            closeDelay: 500,
            animationDuration: 200
        },
        api: {
            endpoint: '/api.php',
            batchSize: 50
        }
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

    // Role badge mapping
    var ROLE_BADGES = {
        founder: { class: 'role-founder', text: 'Founder' },
        administrator: { class: 'role-administrator', text: 'Administrator' },
        globalMod: { class: 'role-global-mod', text: 'Global Mod' },
        moderator: { class: 'role-moderator', text: 'Moderator' },
        developer: { class: 'role-developer', text: 'Developer' },
        premium: { class: 'role-premium', text: 'Premium' },
        vip: { class: 'role-vip', text: 'VIP' },
        member: { class: 'role-member', text: 'Member' },
        banned: { class: 'role-banned', text: 'Banned' }
    };

    // ============================================
    // STATE MANAGEMENT
    // ============================================
    var state = {
        currentModal: null,
        currentLegacyModal: null,
        closeCooldown: false,
        processingModal: false,
        userProfileLinks: new Map(),
        cooldownTimer: null,
        registered: false
    };

    // ============================================
    // UTILITY FUNCTIONS
    // ============================================
    var utils = {
        // Deterministic hash function
        hashCode: function(str) {
            var hash = 0;
            for (var i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash = hash | 0;
            }
            return Math.abs(hash);
        },

        // Format number with commas
        formatNumber: function(num) {
            if (!num && num !== 0) return '0';
            return num.toLocaleString();
        },

        // Escape HTML
        escapeHtml: function(str) {
            if (!str) return '';
            var div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        // Get current time
        getCurrentTime: function() {
            var now = new Date();
            var hours = now.getHours().toString().padStart(2, '0');
            var minutes = now.getMinutes().toString().padStart(2, '0');
            return hours + ':' + minutes;
        },

        // Check if avatar URL is valid
        isValidAvatar: function(url) {
            if (!url || typeof url !== 'string') return false;
            var lowerUrl = url.toLowerCase();
            var invalidPatterns = ['http', 'http:', 'https', 'https:', '', 'null', 'undefined'];
            for (var i = 0; i < invalidPatterns.length; i++) {
                if (lowerUrl === invalidPatterns[i]) return false;
            }
            return lowerUrl.indexOf('http://') === 0 || 
                   lowerUrl.indexOf('https://') === 0 || 
                   lowerUrl.indexOf('//') === 0;
        }
    };

    // ============================================
    // AVATAR GENERATION & OPTIMIZATION
    // ============================================
    var avatarHandler = {
        // Get color from nickname
        getColor: function(nickname, userId) {
            var hash = utils.hashCode(nickname || userId || 'user');
            return AVATAR_COLORS[hash % AVATAR_COLORS.length];
        },

        // Generate DiceBear avatar
        generateDiceBear: function(username, userId) {
            var firstLetter = (username && username[0] ? username[0] : 'U').toUpperCase();
            var color = this.getColor(username, userId);
            return 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(firstLetter) + 
                   '&backgroundColor=' + color + '&radius=50&size=70&fontSize=32&fontWeight=600';
        },

        // Optimize image URL with Weserv
        optimize: function(url, width, height) {
            width = width || 48;
            height = height || 48;
            
            if (!url) return { url: null, quality: null, format: null, isGif: false };
            
            var lowerUrl = url.toLowerCase();
            var skipPatterns = ['weserv.nl', 'dicebear.com', 'api.dicebear.com', 'data:'];
            var shouldSkip = false;
            for (var i = 0; i < skipPatterns.length; i++) {
                if (lowerUrl.indexOf(skipPatterns[i]) !== -1) {
                    shouldSkip = true;
                    break;
                }
            }
            if (shouldSkip) {
                return { url: url, quality: null, format: null, isGif: false };
            }

            var isGif = /\.gif($|\?|#)/i.test(lowerUrl);
            var encodedUrl = encodeURIComponent(url);
            var optimizedUrl = CONFIG.weserv.cdn + '?url=' + encodedUrl + 
                              '&output=webp&maxage=' + CONFIG.weserv.cache + 
                              '&q=' + CONFIG.weserv.quality + '&w=' + width + 
                              '&h=' + height + '&fit=cover&a=attention&il';

            if (isGif) {
                optimizedUrl = optimizedUrl + '&n=-1&lossless=true';
            }

            return {
                url: optimizedUrl,
                quality: CONFIG.weserv.quality,
                format: 'webp',
                isGif: isGif,
                width: width,
                height: height
            };
        },

        // Get user avatar (with fallback)
        getUserAvatar: function(user) {
            var avatarUrl = user.avatar;
            
            if (!utils.isValidAvatar(avatarUrl)) {
                return {
                    url: this.generateDiceBear(user.nickname, user.id),
                    quality: null,
                    format: 'svg',
                    isGif: false,
                    width: 48,
                    height: 48
                };
            }

            if (avatarUrl.indexOf('//') === 0) avatarUrl = 'https:' + avatarUrl;
            if (avatarUrl.indexOf('http://') === 0 && window.location.protocol === 'https:') {
                avatarUrl = avatarUrl.replace('http://', 'https://');
            }

            return this.optimize(avatarUrl, 48, 48);
        }
    };

    // ============================================
    // ROLE DETECTION
    // ============================================
    var roleDetector = {
        getUserRole: function(user) {
            if (user.banned === 1) return ROLE_BADGES.banned;
            
            // Check group object
            if (user.group) {
                var groupName = (user.group.name || '').toLowerCase();
                var groupClass = (user.group.class || '').toLowerCase();
                var groupId = user.group.id;

                if (groupClass.indexOf('founder') !== -1 || groupName === 'founder') return ROLE_BADGES.founder;
                if (groupName === 'administrator' || groupClass.indexOf('admin') !== -1 || groupId === 1) return ROLE_BADGES.administrator;
                if (groupName === 'global moderator' || groupClass.indexOf('global_mod') !== -1) return ROLE_BADGES.globalMod;
                if (groupName === 'moderator' || groupClass.indexOf('mod') !== -1) return ROLE_BADGES.moderator;
                if (groupName === 'developer' || groupClass.indexOf('developer') !== -1) return ROLE_BADGES.developer;
                if (groupName === 'premium' || groupClass.indexOf('premium') !== -1) return ROLE_BADGES.premium;
                if (groupName === 'vip' || groupClass.indexOf('vip') !== -1) return ROLE_BADGES.vip;
            }

            // Check permission object
            if (user.permission) {
                if (user.permission.founder === 1) return ROLE_BADGES.founder;
                if (user.permission.admin === 1) return ROLE_BADGES.administrator;
                if (user.permission.global_mod === 1) return ROLE_BADGES.globalMod;
                if (user.permission.mod_sez === 1) return ROLE_BADGES.moderator;
            }

            // Custom group name
            if (user.group && user.group.name && user.group.name !== 'Members' && user.group.name !== 'member') {
                return { class: ROLE_BADGES.member.class, text: user.group.name };
            }

            return ROLE_BADGES.member;
        }
    };

    // ============================================
    // API HANDLING
    // ============================================
    var api = {
        fetchUsers: function(userIds) {
            if (!userIds || userIds.length === 0) return Promise.resolve([]);
            
            return fetch(CONFIG.api.endpoint + '?mid=' + userIds.join(','))
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    var users = [];
                    for (var key in data) {
                        if (data.hasOwnProperty(key) && key.indexOf('m') === 0 && data[key].id) {
                            users.push(data[key]);
                        }
                    }
                    return users;
                })
                .catch(function(error) {
                    console.error('[Modern Likes] API Error:', error);
                    return [];
                });
        },

        extractUserIds: function(legacyModal) {
            var userIds = [];
            var links = legacyModal.querySelectorAll('.users a[href*="MID="], .points_pos');
            
            for (var i = 0; i < links.length; i++) {
                var link = links[i];
                var match = link.href ? link.href.match(/MID=(\d+)/) : null;
                if (match && userIds.indexOf(match[1]) === -1) {
                    userIds.push(match[1]);
                }
            }
            
            return userIds;
        },

        storeProfileLinks: function(legacyModal) {
            var links = legacyModal.querySelectorAll('.users li a');
            for (var i = 0; i < links.length; i++) {
                var link = links[i];
                var match = link.href.match(/MID=(\d+)/);
                if (match) {
                    state.userProfileLinks.set(match[1], link.href);
                }
            }
        },

        navigateToProfile: function(userId) {
            var url = state.userProfileLinks.get(userId);
            if (url) {
                window.location.href = url;
            }
        }
    };

    // ============================================
    // MODAL CREATION & MANAGEMENT
    // ============================================
    var modalManager = {
        close: function(skipOriginalClose) {
            skipOriginalClose = skipOriginalClose || false;
            
            if (state.currentModal) {
                state.currentModal.remove();
                state.currentModal = null;
            }

            if (state.currentLegacyModal && !skipOriginalClose && !state.closeCooldown) {
                var closeBtn = state.currentLegacyModal.querySelector('a.close');
                if (closeBtn) {
                    closeBtn.click();
                }
                
                state.closeCooldown = true;
                if (state.cooldownTimer) clearTimeout(state.cooldownTimer);
                state.cooldownTimer = setTimeout(function() {
                    state.closeCooldown = false;
                }, CONFIG.modal.closeDelay);
            }

            state.currentLegacyModal = null;
            state.processingModal = false;
        },

        create: function(userIds, legacyModal) {
            if (state.closeCooldown || state.processingModal) return;
            state.processingModal = true;

            api.storeProfileLinks(legacyModal);
            if (state.currentModal) state.currentModal.remove();
            state.currentLegacyModal = legacyModal;

            // Create overlay
            var overlay = document.createElement('div');
            overlay.className = 'modern-modal-overlay';
            
            // Create modal
            var modal = document.createElement('div');
            modal.className = 'modern-likes-modal';
            
            var currentTime = utils.getCurrentTime();
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
            state.currentModal = overlay;

            // Set up close handlers
            var closeBtn = modal.querySelector('.modern-modal-close');
            var self = this;
            closeBtn.onclick = function() { self.close(false); };
            overlay.onclick = function(e) { if (e.target === overlay) self.close(false); };
            
            var escHandler = function(e) {
                if (e.key === 'Escape') {
                    self.close(false);
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);

            // Load and render users
            this.loadUsers(userIds, modal);
        },

        loadUsers: function(userIds, modal) {
            var likesList = modal.querySelector('.modern-likes-list');
            var self = this;
            
            api.fetchUsers(userIds)
                .then(function(users) {
                    if (!users || users.length === 0) {
                        likesList.innerHTML = 
                            '<div class="modern-empty">' +
                                '<i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>' +
                                '<p>No user data available</p>' +
                            '</div>';
                        state.processingModal = false;
                        return;
                    }

                    // Sort users (staff first, then by reputation)
                    var sortedUsers = users.slice();
                    sortedUsers.sort(function(a, b) {
                        var aIsStaff = (a.permission && (a.permission.founder || a.permission.admin || a.permission.global_mod));
                        var bIsStaff = (b.permission && (b.permission.founder || b.permission.admin || b.permission.global_mod));
                        if (aIsStaff && !bIsStaff) return -1;
                        if (!aIsStaff && bIsStaff) return 1;
                        return (b.reputation || 0) - (a.reputation || 0);
                    });

                    // Render users
                    var itemsHtml = '';
                    for (var i = 0; i < sortedUsers.length; i++) {
                        itemsHtml += self.renderUserItem(sortedUsers[i]);
                    }
                    likesList.innerHTML = itemsHtml;
                    self.attachClickHandlers(likesList);
                    state.processingModal = false;
                })
                .catch(function(error) {
                    console.error('[Modern Likes] Error:', error);
                    likesList.innerHTML = 
                        '<div class="modern-empty">' +
                            '<i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i>' +
                            '<p>Error loading user data. Please try again.</p>' +
                        '</div>';
                    state.processingModal = false;
                });
        },

        renderUserItem: function(user) {
            var avatar = avatarHandler.getUserAvatar(user);
            var role = roleDetector.getUserRole(user);
            var fallbackAvatar = avatarHandler.generateDiceBear(user.nickname, user.id);
            var optimizedFallback = avatarHandler.optimize(fallbackAvatar, 48, 48);
            
            var qualityAttr = avatar.quality ? 'data-quality="' + avatar.quality + '" ' : '';
            var formatAttr = avatar.format ? 'data-format="' + avatar.format + '" ' : '';
            var optimizedAttr = avatar.quality ? 'data-optimized="true" ' : '';
            var gifAttr = avatar.isGif ? 'data-original-format="gif" ' : '';
            
            var statusText = user.status || 'offline';
            var statusClass = user.status === 'online' ? 'status-online' : 'status-offline';
            var escapedNickname = utils.escapeHtml(user.nickname);
            
            return '<div class="modern-like-item" data-user-id="' + user.id + '">' +
                        '<img class="modern-like-avatar" ' +
                             'src="' + avatar.url + '" ' +
                             'alt="Avatar of ' + escapedNickname + '" ' +
                             'loading="lazy" ' +
                             'decoding="async" ' +
                             'width="48" ' +
                             'height="48" ' +
                             'data-user-id="' + user.id + '" ' +
                             qualityAttr +
                             formatAttr +
                             optimizedAttr +
                             gifAttr +
                             'onerror="this.onerror=null; this.src=\'' + optimizedFallback.url + '\';">' +
                        '<div class="modern-like-info" data-user-id="' + user.id + '">' +
                            '<div class="modern-like-name-row">' +
                                '<span class="modern-like-name" data-user-id="' + user.id + '">' + escapedNickname + '</span>' +
                                '<span class="modern-role-badge ' + role.class + '">' + utils.escapeHtml(role.text) + '</span>' +
                            '</div>' +
                            '<div class="modern-like-stats">' +
                                '<span><i class="fa-regular fa-message" aria-hidden="true"></i> ' + utils.formatNumber(user.messages) + ' posts</span>' +
                                '<span><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> ' + utils.formatNumber(user.reputation) + ' rep</span>' +
                                '<span class="' + statusClass + '">' +
                                    '<i class="fa-regular fa-circle" aria-hidden="true"></i> ' + statusText +
                                '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
        },

        attachClickHandlers: function(container) {
            var selectors = ['.modern-like-item', '.modern-like-avatar', '.modern-like-info', '.modern-like-name'];
            var elements = [];
            
            for (var i = 0; i < selectors.length; i++) {
                var found = container.querySelectorAll(selectors[i]);
                for (var j = 0; j < found.length; j++) {
                    if (elements.indexOf(found[j]) === -1) {
                        elements.push(found[j]);
                    }
                }
            }
            
            for (var k = 0; k < elements.length; k++) {
                var element = elements[k];
                var userId = element.getAttribute('data-user-id');
                if (userId) {
                    element.onclick = (function(uid) {
                        return function(e) {
                            e.stopPropagation();
                            api.navigateToProfile(uid);
                        };
                    })(userId);
                }
            }
        }
    };

    // ============================================
    // FORUM CORE OBSERVER INTEGRATION (ONLY)
    // ============================================
    function init() {
        // Inject Font Awesome if needed
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
            document.head.appendChild(link);
        }

        // Check if ForumCoreObserver is available
        if (!globalThis.forumObserver || typeof globalThis.forumObserver.register !== 'function') {
            console.error('[Modern Likes] ForumCoreObserver not found. Modal will not work.');
            return;
        }

        // Modal detection handler
        var modalHandler = function(node) {
            if (node && node.style && node.style.display === 'block' && !state.currentModal) {
                var userIds = api.extractUserIds(node);
                if (userIds.length > 0) {
                    modalManager.create(userIds, node);  // FIXED: was 'userids' now 'userIds'
                }
            }
        };

        // Register with ForumCoreObserver
        globalThis.forumObserver.register({
            id: 'modern-likes-modal',
            selector: '.popup.pop_points, #overlay.pop_points',
            priority: 'high',
            callback: modalHandler
        });

        globalThis.forumObserver.register({
            id: 'modern-likes-modal-style',
            selector: '#overlay.pop_points',
            priority: 'high',
            callback: modalHandler
        });

        console.log('[Modern Likes] Successfully registered with ForumCoreObserver');
        state.registered = true;
    }

    // Start the script - wait for ForumCoreObserver to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Small delay to ensure ForumCoreObserver is initialized
        setTimeout(init, 100);
    }
})();
