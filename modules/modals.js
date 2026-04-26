// ==UserScript==
// @name         Modern Modals for ForumFree (Likes + Report) – Accessible
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Replaces old likes popup and report modal with modern, accessible modals (Midnight Emerald theme)
// @author       You
// @match        *://*.forumfree.it/*
// @match        *://*.forumcommunity.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ========== STATE ==========
    var currentModal = null;          // overlay element of current active modal (likes or report)
    var currentLegacyModal = null;
    var closeCooldown = false;
    var cooldownTimer = null;
    var processingModal = false;
    var triggerElement = null;
    var previousActiveElement = null;
    var focusableElements = [];
    var firstFocusable = null;
    var lastFocusable = null;
    var isDialogPolyfilled = false;

    // ========== CONFIGURATION ==========
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

    // ========== HELPER FUNCTIONS (existing from your script) ==========
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
            'size=48',
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
            console.error('[Modern Modals] API Error:', error);
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

    // ========== SCROLLBAR WIDTH UTILITY ==========
    function getScrollbarWidth() {
        var scrollDiv = document.createElement('div');
        scrollDiv.className = 'modal-scrollbar-measure';
        document.body.appendChild(scrollDiv);
        var scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;
        document.body.removeChild(scrollDiv);
        return scrollbarWidth;
    }

    // ========== BODY SCROLL LOCK ==========
    var scrollbarWidth = 0;
    function lockBodyScroll() {
        scrollbarWidth = getScrollbarWidth();
        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = scrollbarWidth + 'px';
        document.body.classList.add('modal-open');
    }
    function unlockBodyScroll() {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
        document.body.classList.remove('modal-open');
    }

    // ========== FOCUS TRAP ==========
    function getFocusableElements(modalElement) {
        var selectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        var elements = modalElement.querySelectorAll(selectors);
        return Array.prototype.filter.call(elements, function(el) {
            return !el.hasAttribute('disabled') && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        });
    }

    function trapFocus(e) {
        if (e.key !== 'Tab') return;
        if (!focusableElements.length) {
            e.preventDefault();
            return;
        }
        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable.focus();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable.focus();
            }
        }
    }

    function setFocusTrap(modalElement) {
        focusableElements = getFocusableElements(modalElement);
        if (focusableElements.length) {
            firstFocusable = focusableElements[0];
            lastFocusable = focusableElements[focusableElements.length - 1];
            firstFocusable.focus();
        } else {
            modalElement.setAttribute('tabindex', '-1');
            modalElement.focus();
        }
        document.addEventListener('keydown', trapFocus);
    }

    function removeFocusTrap() {
        document.removeEventListener('keydown', trapFocus);
        focusableElements = [];
        firstFocusable = null;
        lastFocusable = null;
    }

    // ========== RESTORE FOCUS ==========
    function restoreFocus() {
        if (triggerElement && triggerElement.focus) {
            triggerElement.focus();
            triggerElement = null;
        } else if (previousActiveElement && previousActiveElement.focus) {
            previousActiveElement.focus();
            previousActiveElement = null;
        }
    }

    // ========== LIVE REGION ANNOUNCEMENT ==========
    function announceToScreenReader(message) {
        var liveRegion = document.querySelector('.modal-live-region');
        if (!liveRegion) {
            liveRegion = document.createElement('div');
            liveRegion.className = 'modal-live-region';
            liveRegion.setAttribute('aria-live', 'polite');
            liveRegion.setAttribute('aria-atomic', 'true');
            document.body.appendChild(liveRegion);
        }
        liveRegion.textContent = message;
        setTimeout(function() { if (liveRegion.textContent === message) liveRegion.textContent = ''; }, 3000);
    }

    // ========== CLOSE ANY MODAL (unified) ==========
    function closeCustomModal(legacyModal, skipOriginalClose) {
        if (currentModal) {
            unlockBodyScroll();
            removeFocusTrap();
            var dialog = currentModal.querySelector('.modern-likes-modal, .modern-report-modal');
            if (dialog && dialog.close && typeof dialog.close === 'function' && !isDialogPolyfilled) {
                dialog.close();
            }
            currentModal.remove();
            currentModal = null;
        }
        if (legacyModal && !skipOriginalClose && !closeCooldown) {
            // For report modal, close button might be different
            var closeBtn = legacyModal.querySelector('a.close-modal, a.close');
            if (closeBtn) {
                var clickEvent = document.createEvent('MouseEvents');
                clickEvent.initEvent('click', true, true);
                closeBtn.dispatchEvent(clickEvent);
            }
            closeCooldown = true;
            if (cooldownTimer) clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(function() { closeCooldown = false; }, 500);
        }
        currentLegacyModal = null;
        processingModal = false;
        restoreFocus();
    }

    // ========== LIKES MODAL (existing, unchanged logic) ==========
    // ... (keep existing showModernModal and createModalStructure functions) ...
    // We'll insert them here for completeness, but they are identical to your original.

    // ----------------------------------------------------------------------
    // LIKES MODAL (copied from your original script, unchanged except for naming)
    // ----------------------------------------------------------------------
    function createModalStructure(userIds, legacyModal) {
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        var modal = document.createElement('div');
        modal.className = 'modern-likes-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'modal-title');
        modal.setAttribute('aria-describedby', 'modal-description');

        var currentTime = getCurrentTime();
        modal.innerHTML = 
            '<div class="modern-modal-header">' +
                '<div class="modern-modal-title">' +
                    '<i class="fa-regular fa-thumbs-up" aria-hidden="true"></i>' +
                    '<h3 id="modal-title">Liked by</h3>' +
                    '<span class="modal-like-count" aria-live="polite">' + userIds.length + '</span>' +
                '</div>' +
                '<button class="modern-modal-close" aria-label="Close modal">' +
                    '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
                '</button>' +
            '</div>' +
            '<div id="modal-description" class="screen-reader-only" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0">List of users who liked this post</div>' +
            '<div class="modern-likes-list" aria-live="polite" aria-busy="true">' +
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
        return { overlay: overlay, modal: modal };
    }

    async function showModernModal(userIds, legacyModal, triggerEl) {
        if (closeCooldown || processingModal) return;
        processingModal = true;

        triggerElement = triggerEl || document.activeElement;
        previousActiveElement = document.activeElement;

        storeProfileLinks(legacyModal);

        if (currentModal) {
            closeCustomModal(legacyModal, true);
        }

        currentLegacyModal = legacyModal;

        var structures = createModalStructure(userIds, legacyModal);
        var overlay = structures.overlay;
        var modal = structures.modal;
        currentModal = overlay;

        lockBodyScroll();
        setFocusTrap(modal);

        var closeBtn = modal.querySelector('.modern-modal-close');
        closeBtn.addEventListener('click', function() { closeCustomModal(legacyModal, false); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeCustomModal(legacyModal, false); });
        var escHandler = function(e) { if (e.key === 'Escape') closeCustomModal(legacyModal, false); document.removeEventListener('keydown', escHandler); };
        document.addEventListener('keydown', escHandler);

        var likesList = modal.querySelector('.modern-likes-list');
        var countSpan = modal.querySelector('.modal-like-count');

        announceToScreenReader('Loading users who liked this post');

        try {
            var users = await fetchUsersFromApi(userIds);
            likesList.removeAttribute('aria-busy');
            if (!users || users.length === 0) {
                likesList.innerHTML = '<div class="modern-empty"><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i><p>No user data available</p></div>';
                announceToScreenReader('No user data available');
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
                var dicebearFallback = generateDiceBearAvatar(user.nickname, user.id);
                var optimizedFallback = optimizeImageUrl(dicebearFallback, 48, 48);
                var statusText = user.status || 'offline';
                var statusClass = user.status === 'online' ? 'online' : (user.status === 'idle' ? 'idle' : (user.status === 'dnd' ? 'dnd' : 'offline'));
                var escapedNickname = escapeHtml(user.nickname);

                itemsHtml += 
                    '<div class="modern-like-item" data-user-id="' + user.id + '" tabindex="0" role="button" aria-label="View profile of ' + escapedNickname + '">' +
                        '<div class="modern-like-avatar-wrapper">' +
                            '<img class="modern-like-avatar" src="' + avatarUrl + '" alt="Avatar of ' + escapedNickname + '" loading="lazy" decoding="async" width="48" height="48" data-user-id="' + user.id + '" onerror="this.onerror=null; this.src=\'' + optimizedFallback.url + '\';">' +
                            '<span class="modern-status-dot ' + statusClass + '" data-status="' + statusText + '" aria-label="User is ' + statusText + '"></span>' +
                        '</div>' +
                        '<div class="modern-like-info" data-user-id="' + user.id + '">' +
                            '<div class="modern-like-name-row">' +
                                '<span class="modern-like-name" data-user-id="' + user.id + '">' + escapedNickname + '</span>' +
                                '<span class="modern-role-badge ' + roleInfo.class + '">' + escapeHtml(roleInfo.text) + '</span>' +
                            '</div>' +
                            '<div class="modern-like-stats">' +
                                '<span><i class="fa-regular fa-message" aria-hidden="true"></i> ' + formatNumber(user.messages) + ' posts</span>' +
                                '<span><i class="fa-regular fa-thumbs-up" aria-hidden="true"></i> ' + formatNumber(user.reputation) + ' rep</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>';
            }
            likesList.innerHTML = itemsHtml;
            countSpan.textContent = sortedUsers.length;
            announceToScreenReader('Loaded ' + sortedUsers.length + ' users');

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
                    element.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            var uid2 = this.getAttribute('data-user-id');
                            if (uid2) navigateToProfile(uid2);
                        }
                    });
                }
            }
            removeFocusTrap();
            setFocusTrap(modal);
        } catch (error) {
            console.error('[Modern Modals] Likes error:', error);
            likesList.innerHTML = '<div class="modern-empty"><i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i><p>Error loading user data.</p></div>';
            announceToScreenReader('Error loading user data');
        }
        processingModal = false;
    }

    // ========== REPORT MODAL (new implementation) ==========
    function extractReportInfo(legacyModal) {
        // legacyModal is the .ff-modal.modal.report-modal or its parent .Blocker
        var modalContent = legacyModal.querySelector('.ff-modal.modal.report-modal') || legacyModal;
        var postLinkElem = modalContent.querySelector('.modal-title a');
        var postUrl = postLinkElem ? postLinkElem.href : '';
        var nicknameElem = modalContent.querySelector('.nickname');
        var nickname = nicknameElem ? nicknameElem.textContent : 'Unknown user';
        var pid = modalContent.getAttribute('data-pid') || '';
        return { postUrl: postUrl, nickname: nickname, pid: pid };
    }

    function createReportModalStructure(reportInfo, legacyModal) {
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        var modal = document.createElement('div');
        modal.className = 'modern-report-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'report-modal-title');
        modal.setAttribute('aria-describedby', 'report-modal-desc');

        var currentTime = getCurrentTime();
        modal.innerHTML = 
            '<div class="modern-modal-header">' +
                '<div class="modern-modal-title">' +
                    '<i class="fa-regular fa-flag" aria-hidden="true"></i>' +
                    '<h3 id="report-modal-title">Report post</h3>' +
                '</div>' +
                '<button class="modern-modal-close" aria-label="Close report modal">' +
                    '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
                '</button>' +
            '</div>' +
            '<div id="report-modal-desc" class="screen-reader-only" style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0">Report the post by ' + escapeHtml(reportInfo.nickname) + '</div>' +
            '<div class="modern-report-body">' +
                '<p class="report-post-info">You are reporting the post of <strong>' + escapeHtml(reportInfo.nickname) + '</strong></p>' +
                '<div class="report-reason-container">' +
                    '<label for="report-reason-textarea" class="report-label">Reason (max 300 characters)</label>' +
                    '<div class="counter-wrapper">' +
                        '<textarea id="report-reason-textarea" class="report-textarea" rows="4" maxlength="300" placeholder="Write here the reason why you want to report the post"></textarea>' +
                        '<div class="counter"><span>0</span>/300</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="modern-modal-footer">' +
                '<div class="report-actions">' +
                    '<button class="report-send-button" type="button">Send Report</button>' +
                    '<span class="report-cancel-note">Once the report has been sent, it cannot be canceled.</span>' +
                '</div>' +
                '<div class="modal-timestamp"><i class="fa-regular fa-clock" aria-hidden="true"></i> ' + currentTime + '</div>' +
            '</div>';

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        return { overlay: overlay, modal: modal };
    }

    function showModernReportModal(legacyModal, triggerEl) {
        if (closeCooldown || processingModal) return;
        processingModal = true;

        triggerElement = triggerEl || document.activeElement;
        previousActiveElement = document.activeElement;

        // Hide the original report modal so only our modern one is visible
        legacyModal.style.display = 'none';

        var reportInfo = extractReportInfo(legacyModal);
        var structures = createReportModalStructure(reportInfo, legacyModal);
        var overlay = structures.overlay;
        var modal = structures.modal;
        currentModal = overlay;
        currentLegacyModal = legacyModal;

        lockBodyScroll();
        setFocusTrap(modal);

        // Get references to modern elements
        var closeBtn = modal.querySelector('.modern-modal-close');
        var sendBtn = modal.querySelector('.report-send-button');
        var textarea = modal.querySelector('#report-reason-textarea');
        var counterSpan = modal.querySelector('.counter span');

        // Update counter on input
        function updateCounter() {
            var len = textarea.value.length;
            counterSpan.textContent = len;
            if (len === 300) {
                announceToScreenReader('Maximum 300 characters reached');
            }
        }
        textarea.addEventListener('input', updateCounter);
        updateCounter();

        // Close modal when clicking close button, backdrop, or Escape
        function closeReportModal() {
            // Click original close button to properly close the legacy modal
            var origClose = legacyModal.querySelector('a.close-modal, a.close');
            if (origClose) {
                var clickEvt = document.createEvent('MouseEvents');
                clickEvt.initEvent('click', true, true);
                origClose.dispatchEvent(clickEvt);
            }
            // Restore legacy modal visibility (it will be removed from DOM after close)
            legacyModal.style.display = '';
            closeCustomModal(legacyModal, true); // skip original close because we already clicked it
        }

        closeBtn.addEventListener('click', closeReportModal);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeReportModal(); });
        var escHandler = function(e) { if (e.key === 'Escape') closeReportModal(); document.removeEventListener('keydown', escHandler); };
        document.addEventListener('keydown', escHandler);

        // Send report: copy reason to legacy textarea, click legacy send button
        sendBtn.addEventListener('click', function() {
            var reason = textarea.value.trim();
            if (reason === "") {
                announceToScreenReader('Please enter a reason for reporting this post.');
                textarea.focus();
                return;
            }
            // Find legacy textarea and send button
            var legacyTextarea = legacyModal.querySelector('.report_textarea');
            var legacySend = legacyModal.querySelector('.report_send_button');
            if (legacyTextarea && legacySend) {
                // Copy the reason
                legacyTextarea.value = reason;
                // Trigger input event to ensure any internal validation runs
                var inputEvent = new Event('input', { bubbles: true });
                legacyTextarea.dispatchEvent(inputEvent);
                // Click the send button
                legacySend.click();
                announceToScreenReader('Report sent. Thank you.');
                // Close modern modal after a short delay (allow original modal to process)
                setTimeout(function() {
                    closeReportModal();
                }, 300);
            } else {
                console.error('[Modern Report] Could not find legacy report elements');
                announceToScreenReader('Error: Could not submit report. Please try again.');
            }
        });

        processingModal = false;
    }

    // ========== INITIALIZATION (enhanced to catch report modal) ==========
    function init() {
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
            var faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
            document.head.appendChild(faLink);
        }

        function getTriggerElement() {
            return document.activeElement;
        }

        // Helper to detect report modal (visible Blocker with report-modal)
        function isReportModalVisible(node) {
            if (!node || node.nodeType !== 1) return false;
            // The report modal is typically inside a .forumfree-modal.Blocker.current block
            var blocker = node.classList && node.classList.contains('Blocker') && node.classList.contains('current') ? node : node.closest('.Blocker.current');
            if (blocker && blocker.querySelector('.report-modal')) {
                var style = window.getComputedStyle(blocker);
                return style.display !== 'none' && style.visibility !== 'hidden' && blocker.style.opacity !== '0';
            }
            return false;
        }

        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
            // Register for likes modal (existing)
            globalThis.forumObserver.register({
                id: 'modern-likes-modal',
                selector: '.popup.pop_points, #overlay.pop_points',
                priority: 'high',
                callback: function(node) {
                    if (node && node.style && node.style.display === 'block') {
                        var userIds = extractUserIdsFromLegacyModal(node);
                        if (userIds.length > 0 && !currentModal) {
                            showModernModal(userIds, node, getTriggerElement());
                        }
                    }
                }
            });
            globalThis.forumObserver.register({
                id: 'modern-likes-modal-style',
                selector: '#overlay.pop_points',
                priority: 'high',
                callback: function(node) {
                    if (node && node.style && node.style.display === 'block' && !currentModal) {
                        var userIds = extractUserIdsFromLegacyModal(node);
                        if (userIds.length > 0) {
                            showModernModal(userIds, node, getTriggerElement());
                        }
                    }
                }
            });
            // Register for report modal
            globalThis.forumObserver.register({
                id: 'modern-report-modal',
                selector: '.forumfree-modal.Blocker.current, .ff-modal.modal.report-modal',
                priority: 'high',
                callback: function(node) {
                    if (isReportModalVisible(node) && !currentModal && !processingModal) {
                        // Find the actual legacy modal container (the .Blocker)
                        var blocker = node.classList && node.classList.contains('Blocker') ? node : node.closest('.Blocker.current');
                        if (blocker) {
                            showModernReportModal(blocker, getTriggerElement());
                        }
                    }
                }
            });
            console.log('[Modern Modals] Registered with ForumCoreObserver (likes + report)');
        } else {
            // Fallback MutationObserver
            var fallbackObserver = new MutationObserver(function(mutations) {
                if (closeCooldown || processingModal) return;
                for (var i = 0; i < mutations.length; i++) {
                    var mutation = mutations[i];
                    // Check for style changes on existing modals
                    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                        var target = mutation.target;
                        if (target.id === 'overlay' && target.classList && target.classList.contains('pop_points') &&
                            target.style.display === 'block' && !currentModal) {
                            var userIds = extractUserIdsFromLegacyModal(target);
                            if (userIds.length > 0) showModernModal(userIds, target, getTriggerElement());
                        }
                        // Report modal became visible
                        if (target.classList && target.classList.contains('Blocker') && target.classList.contains('current') &&
                            target.style.display !== 'none' && target.style.visibility !== 'hidden' && !currentModal) {
                            if (target.querySelector('.report-modal')) {
                                showModernReportModal(target, getTriggerElement());
                            }
                        }
                    }
                    // Check for added nodes (modal just appended)
                    if (mutation.type === 'childList') {
                        for (var j = 0; j < mutation.addedNodes.length; j++) {
                            var node = mutation.addedNodes[j];
                            if (node.nodeType === 1) {
                                if (node.id === 'overlay' && node.classList && node.classList.contains('pop_points') &&
                                    node.style.display === 'block' && !currentModal) {
                                    var userIds = extractUserIdsFromLegacyModal(node);
                                    if (userIds.length > 0) showModernModal(userIds, node, getTriggerElement());
                                }
                                if (isReportModalVisible(node) && !currentModal) {
                                    var blocker = node.classList && node.classList.contains('Blocker') ? node : node.closest('.Blocker.current');
                                    if (blocker) showModernReportModal(blocker, getTriggerElement());
                                }
                            }
                        }
                    }
                }
            });
            fallbackObserver.observe(document.body, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
            console.log('[Modern Modals] Using fallback MutationObserver (likes + report)');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
