// ==UserScript==
// @name         Modern Modals for ForumFree (Likes + Report)
// @namespace    http://tampermonkey.net/
// @version      6.4
// @description  Replaces old likes popup, report modal, and admin report-notify modal with modern, accessible modals – consistent Midnight Emerald style (CSS must be provided by theme)
// @author       You
// @match        *://*.forumfree.it/*
// @match        *://*.forumcommunity.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ========== STATE (Likes) ==========
    var currentModal = null;
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

    // ========== STATE (Report - user) ==========
    var currentReportModal = null;
    var currentLegacyReportModal = null;
    var reportProcessing = false;
    var reportTriggerElement = null;
    var reportFocusable = [];
    var reportFirstFocusable = null;
    var reportLastFocusable = null;
    var reportCloseCooldown = false;

    // ========== STATE (Report Notify - admin) ==========
    var currentReportNotifyModal = null;
    var currentLegacyReportNotifyModal = null;
    var reportNotifyProcessing = false;
    var reportNotifyTriggerElement = null;
    var reportNotifyFocusable = [];
    var reportNotifyFirstFocusable = null;
    var reportNotifyLastFocusable = null;
    var reportNotifyCloseCooldown = false;

    // ========== CONFIGURATION ==========
    var WESERV_CONFIG = {
        cdn: 'https://images.weserv.nl/',
        cache: '1y',
        quality: 90,
        avatarWidth: 48,
        avatarHeight: 48
    };

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

    // ========== HELPER FUNCTIONS ==========
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

    // ========== SCROLLBAR UTILITIES ==========
    function getScrollbarWidth() {
        var scrollDiv = document.createElement('div');
        scrollDiv.className = 'modal-scrollbar-measure';
        document.body.appendChild(scrollDiv);
        var scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;
        document.body.removeChild(scrollDiv);
        return scrollbarWidth;
    }

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

    // ========== FOCUS TRAP GENERIC ==========
    function getFocusableElements(modalElement) {
        var selectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        var elements = modalElement.querySelectorAll(selectors);
        return Array.prototype.filter.call(elements, function(el) {
            return !el.hasAttribute('disabled') && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        });
    }

    function trapFocus(e, focusableList, first, last) {
        if (e.key !== 'Tab') return;
        if (!focusableList.length) {
            e.preventDefault();
            return;
        }
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    // ========== LIKES MODAL ==========
    function setLikesFocusTrap(modalElement) {
        focusableElements = getFocusableElements(modalElement);
        if (focusableElements.length) {
            firstFocusable = focusableElements[0];
            lastFocusable = focusableElements[focusableElements.length - 1];
            firstFocusable.focus();
        } else {
            modalElement.setAttribute('tabindex', '-1');
            modalElement.focus();
        }
        document.addEventListener('keydown', function(e) { trapFocus(e, focusableElements, firstFocusable, lastFocusable); });
    }

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

    function closeCustomModal(legacyModal, skipOriginalClose) {
        if (currentModal) {
            unlockBodyScroll();
            document.removeEventListener('keydown', trapFocus);
            var dialog = currentModal.querySelector('.modern-likes-modal');
            if (dialog && dialog.close && typeof dialog.close === 'function' && !isDialogPolyfilled) {
                dialog.close();
            }
            currentModal.remove();
            currentModal = null;
        }
        if (legacyModal && !skipOriginalClose && !closeCooldown) {
            clickOriginalCloseButton(legacyModal);
            closeCooldown = true;
            if (cooldownTimer) clearTimeout(cooldownTimer);
            cooldownTimer = setTimeout(function() { closeCooldown = false; }, 500);
        }
        currentLegacyModal = null;
        processingModal = false;
        if (triggerElement && triggerElement.focus) triggerElement.focus();
        triggerElement = null;
    }

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
        setLikesFocusTrap(modal);

        var closeBtn = modal.querySelector('.modern-modal-close');
        closeBtn.addEventListener('click', function() { closeCustomModal(legacyModal, false); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeCustomModal(legacyModal, false); });
        var escHandler = function(e) { if (e.key === 'Escape') { closeCustomModal(legacyModal, false); document.removeEventListener('keydown', escHandler); } };
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
            document.removeEventListener('keydown', trapFocus);
            setLikesFocusTrap(modal);
        } catch (error) {
            console.error('[Modern Modals] Error:', error);
            likesList.innerHTML = '<div class="modern-empty"><i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i><p>Error loading user data.</p></div>';
            announceToScreenReader('Error loading user data');
        }
        processingModal = false;
    }

    // ========== USER REPORT MODAL (single report) ==========
    function autoGrowTextarea(textarea) {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }

    function closeModernReportModal(legacyModal, skipOriginalClose) {
        if (currentReportModal) {
            unlockBodyScroll();
            document.removeEventListener('keydown', reportTrapHandler);
            currentReportModal.remove();
            currentReportModal = null;
        }
        if (legacyModal && !skipOriginalClose && !reportCloseCooldown) {
            var closeLink = legacyModal.querySelector('a.close-modal, a.close');
            if (closeLink) {
                var clickEv = document.createEvent('MouseEvents');
                clickEv.initEvent('click', true, true);
                closeLink.dispatchEvent(clickEv);
            }
            reportCloseCooldown = true;
            setTimeout(function() { reportCloseCooldown = false; }, 500);
        }
        currentLegacyReportModal = null;
        reportProcessing = false;
        if (reportTriggerElement && reportTriggerElement.focus) reportTriggerElement.focus();
        reportTriggerElement = null;
    }

    var reportTrapHandler = function(e) {
        if (e.key !== 'Tab') return;
        if (!reportFocusable.length) {
            e.preventDefault();
            return;
        }
        if (e.shiftKey) {
            if (document.activeElement === reportFirstFocusable) {
                e.preventDefault();
                reportLastFocusable.focus();
            }
        } else {
            if (document.activeElement === reportLastFocusable) {
                e.preventDefault();
                reportFirstFocusable.focus();
            }
        }
    };

    function setReportFocusTrap(container) {
        reportFocusable = getFocusableElements(container);
        if (reportFocusable.length) {
            reportFirstFocusable = reportFocusable[0];
            reportLastFocusable = reportFocusable[reportFocusable.length - 1];
            reportFirstFocusable.focus();
        } else {
            container.setAttribute('tabindex', '-1');
            container.focus();
        }
        document.addEventListener('keydown', reportTrapHandler);
    }

    function createReportModalStructure(legacyModal) {
        var postLink = legacyModal.querySelector('.modal-title a');
        var postHref = postLink ? postLink.getAttribute('href') : '#';
        var postNumberMatch = postHref.match(/p=(\d+)/);
        var postId = postNumberMatch ? postNumberMatch[1] : 'unknown';
        var nicknameSpan = legacyModal.querySelector('.nickname');
        var nickname = nicknameSpan ? nicknameSpan.textContent.trim() : 'Unknown user';

        var overlay = document.createElement('div');
        overlay.className = 'modern-report-overlay';
        var container = document.createElement('div');
        container.className = 'modern-report-container';
        container.setAttribute('role', 'dialog');
        container.setAttribute('aria-modal', 'true');
        container.setAttribute('aria-labelledby', 'reportModalTitle');
        container.setAttribute('aria-describedby', 'reportModalDesc');

        container.innerHTML = 
            '<div class="report-modal-header">' +
                '<div class="report-modal-title">' +
                    '<i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i>' +
                    '<h3 id="reportModalTitle">Report post</h3>' +
                '</div>' +
                '<button class="report-modal-close" aria-label="Close modal">' +
                    '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
                '</button>' +
            '</div>' +
            '<div class="report-modal-content">' +
                '<div class="report-context">' +
                    '<i class="fa-regular fa-user-pen" aria-hidden="true"></i> You are reporting the <strong>post</strong> of: ' +
                    '<span class="reported-nickname">' + escapeHtml(nickname) + '</span>' +
                    '<div class="post-ref-link" style="margin-top:0.3rem;font-size:0.8rem;">' +
                        '<i class="fa-regular fa-link" aria-hidden="true"></i> ' +
                        '<a href="' + escapeHtml(postHref) + '" target="_blank" rel="noopener noreferrer">post #' + escapeHtml(postId) + '</a>' +
                    '</div>' +
                '</div>' +
                '<div class="report-field">' +
                    '<label for="reportReasonTextarea">' +
                        '<span><i class="fa-regular fa-message" aria-hidden="true"></i> Reason for report</span>' +
                        '<span class="counter-value" id="reportCharCounter">0/300</span>' +
                    '</label>' +
                    '<textarea id="reportReasonTextarea" class="report-textarea" rows="3" maxlength="300" placeholder="Write your report here… (minimum 5 characters)" aria-describedby="charHint"></textarea>' +
                    '<span id="charHint" class="sr-only">Maximum 300 characters, minimum 5 characters required.</span>' +
                '</div>' +
            '</div>' +
            '<div class="report-modal-footer">' +
                '<div class="footer-note">' +
                    '<i class="fa-regular fa-circle-info" aria-hidden="true"></i> Once the report has been sent, it cannot be canceled.' +
                '</div>' +
                '<div class="action-buttons">' +
                    '<button class="btn-primary-filled" id="reportSendBtn">' +
                        '<i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Send Report' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div id="reportModalDesc" class="sr-only">Dialog to report an inappropriate post. Fill in the reason and confirm sending. The action cannot be undone.</div>';

        overlay.appendChild(container);
        document.body.appendChild(overlay);
        return { overlay: overlay, container: container, postId: postId, nickname: nickname };
    }

    function showModernReportModal(legacyModal, triggerEl) {
        if (reportCloseCooldown || reportProcessing) return;
        reportProcessing = true;
        reportTriggerElement = triggerEl || document.activeElement;

        if (currentReportModal) closeModernReportModal(legacyModal, true);
        currentLegacyReportModal = legacyModal;

        var struct = createReportModalStructure(legacyModal);
        var overlay = struct.overlay;
        var modalContainer = struct.container;  // renamed to avoid conflict
        currentReportModal = overlay;

        lockBodyScroll();
        setReportFocusTrap(modalContainer);

        var closeBtn = modalContainer.querySelector('.report-modal-close');
        var sendBtn = modalContainer.querySelector('#reportSendBtn');
        var textarea = modalContainer.querySelector('#reportReasonTextarea');
        var counterSpan = modalContainer.querySelector('#reportCharCounter');

        function updateCounter() {
            var len = textarea.value.length;
            var max = 300;
            counterSpan.textContent = len + '/' + max;
            counterSpan.classList.remove('warning', 'exceed');
            if (len > max) {
                counterSpan.classList.add('exceed');
                sendBtn.disabled = true;
            } else if (len > 240) {
                counterSpan.classList.add('warning');
                sendBtn.disabled = (len < 5);
            } else {
                sendBtn.disabled = (len < 5);
            }
            if (len > max) sendBtn.disabled = true;
            autoGrowTextarea(textarea);
        }

        if (textarea) {
            textarea.addEventListener('input', updateCounter);
            updateCounter();
            setTimeout(function() { textarea.focus(); }, 50);
        }

        var closeHandler = function() { closeModernReportModal(legacyModal, false); };
        closeBtn.addEventListener('click', closeHandler);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeHandler(); });

        var escHandler = function(e) { if (e.key === 'Escape') { closeHandler(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);

        sendBtn.addEventListener('click', function(e) {
            e.preventDefault();
            var reason = textarea ? textarea.value.trim() : '';
            if (reason.length < 5) {
                if (counterSpan) counterSpan.style.color = '#DC2626';
                textarea.style.borderColor = '#DC2626';
                setTimeout(function() {
                    if (textarea) textarea.style.borderColor = '';
                    if (counterSpan) counterSpan.style.color = '';
                }, 1200);
                announceToScreenReader('Report reason must be at least 5 characters');
                return;
            }
            if (reason.length > 300) {
                announceToScreenReader('Reason cannot exceed 300 characters');
                return;
            }
            var legacyTextarea = legacyModal.querySelector('textarea.textinput.report_textarea');
            if (legacyTextarea) legacyTextarea.value = reason;
            var legacySend = legacyModal.querySelector('input.report_send_button, .report_send_button');
            if (legacySend) {
                var clickEvent = document.createEvent('MouseEvents');
                clickEvent.initEvent('click', true, true);
                legacySend.dispatchEvent(clickEvent);
            }
            announceToScreenReader('Report sent. Thank you.');
            closeModernReportModal(legacyModal, false);
        });
    }

    // ========== ADMIN REPORT NOTIFY MODAL ==========
    function closeModernReportNotifyModal(legacyModal, skipOriginalClose) {
        if (currentReportNotifyModal) {
            unlockBodyScroll();
            document.removeEventListener('keydown', reportNotifyTrapHandler);
            currentReportNotifyModal.remove();
            currentReportNotifyModal = null;
        }
        if (legacyModal && !skipOriginalClose && !reportNotifyCloseCooldown) {
            var closeLink = legacyModal.querySelector('a.close-modal, a.close');
            if (closeLink) {
                var clickEv = document.createEvent('MouseEvents');
                clickEv.initEvent('click', true, true);
                closeLink.dispatchEvent(clickEv);
            }
            reportNotifyCloseCooldown = true;
            setTimeout(function() { reportNotifyCloseCooldown = false; }, 500);
        }
        currentLegacyReportNotifyModal = null;
        reportNotifyProcessing = false;
        if (reportNotifyTriggerElement && reportNotifyTriggerElement.focus) reportNotifyTriggerElement.focus();
        reportNotifyTriggerElement = null;
    }

    var reportNotifyTrapHandler = function(e) {
        if (e.key !== 'Tab') return;
        if (!reportNotifyFocusable.length) {
            e.preventDefault();
            return;
        }
        if (e.shiftKey) {
            if (document.activeElement === reportNotifyFirstFocusable) {
                e.preventDefault();
                reportNotifyLastFocusable.focus();
            }
        } else {
            if (document.activeElement === reportNotifyLastFocusable) {
                e.preventDefault();
                reportNotifyFirstFocusable.focus();
            }
        }
    };

    function setReportNotifyFocusTrap(container) {
        reportNotifyFocusable = getFocusableElements(container);
        if (reportNotifyFocusable.length) {
            reportNotifyFirstFocusable = reportNotifyFocusable[0];
            reportNotifyLastFocusable = reportNotifyFocusable[reportNotifyFocusable.length - 1];
            reportNotifyFirstFocusable.focus();
        } else {
            container.setAttribute('tabindex', '-1');
            container.focus();
        }
        document.addEventListener('keydown', reportNotifyTrapHandler);
    }

    function extractNotifyReports(legacyModal) {
        var reportRows = legacyModal.querySelectorAll('.report_row');
        var reports = [];
        for (var i = 0; i < reportRows.length; i++) {
            var row = reportRows[i];
            var avatarImg = row.querySelector('.avatar img');
            var avatarUrl = avatarImg ? avatarImg.src : '';
            var usernameElem = row.querySelector('b');
            var username = usernameElem ? usernameElem.textContent.trim() : 'Unknown';
            var reasonDiv = row.querySelector('.report');
            var reason = reasonDiv ? reasonDiv.textContent.trim() : '';
            var timeSmall = row.querySelector('.time small');
            var time = timeSmall ? timeSmall.textContent.trim() : '';
            var reportId = row.getAttribute('data-id') || '';
            reports.push({
                avatarUrl: avatarUrl,
                username: username,
                reason: reason,
                time: time,
                reportId: reportId
            });
        }
        return reports;
    }

    function optimizeAvatarForNotify(avatarUrl, username) {
        if (!avatarUrl || avatarUrl === '') return generateDiceBearAvatar(username, 'notify_fallback');
        var lower = avatarUrl.toLowerCase();
        if (lower.indexOf('default_avatar.png') !== -1) return generateDiceBearAvatar(username, 'notify_fallback');
        if (lower.indexOf('weserv.nl') !== -1 || lower.indexOf('dicebear.com') !== -1) return avatarUrl;
        var fixed = avatarUrl;
        if (fixed.startsWith('//')) fixed = 'https:' + fixed;
        if (fixed.startsWith('http://')) fixed = fixed.replace('http://', 'https://');
        return 'https://images.weserv.nl/?url=' + encodeURIComponent(fixed) + '&output=webp&maxage=1y&q=90&w=48&h=48&fit=cover&a=attention&il';
    }

    function createReportNotifyModalStructure(legacyModal) {
        var reports = extractNotifyReports(legacyModal);
        var legacySelect = legacyModal.querySelector('.select_reporting_group');
        var optionsHtml = '';
        if (legacySelect) {
            for (var i = 0; i < legacySelect.options.length; i++) {
                var opt = legacySelect.options[i];
                var selectedAttr = opt.selected ? ' selected' : '';
                optionsHtml += '<option value="' + escapeHtml(opt.value) + '"' + selectedAttr + '>' + escapeHtml(opt.text) + '</option>';
            }
        }
        var groupsSelectHtml = '<select multiple class="multi-select" size="4">' + optionsHtml + '</select>';

        var reportsHtml = '';
        for (var i = 0; i < reports.length; i++) {
            var r = reports[i];
            var optimizedAvatar = optimizeAvatarForNotify(r.avatarUrl, r.username);
            var dicebearFallback = generateDiceBearAvatar(r.username, 'notify_' + r.reportId);
            reportsHtml += 
                '<div class="report-item" data-report-id="' + escapeHtml(r.reportId) + '">' +
                    '<div class="report-avatar">' +
                        '<img src="' + escapeHtml(optimizedAvatar) + '" alt="Avatar" width="48" height="48" data-fallback="' + escapeHtml(dicebearFallback) + '" onerror="this.onerror=null; this.src=this.getAttribute(\'data-fallback\');">' +
                    '</div>' +
                    '<div class="report-details">' +
                        '<div class="report-header">' +
                            '<span class="report-username">' + escapeHtml(r.username) + '</span>' +
                            '<span class="report-badge"><i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i> reported a post</span>' +
                        '</div>' +
                        '<div class="report-reason">' + escapeHtml(r.reason) + '</div>' +
                        '<div class="report-time"><i class="fa-regular fa-clock" aria-hidden="true"></i> ' + escapeHtml(r.time) + '</div>' +
                    '</div>' +
                    '<div class="report-actions">' +
                        '<button class="delete-report" data-report-id="' + escapeHtml(r.reportId) + '"><i class="fa-regular fa-trash-can" aria-hidden="true"></i> Delete</button>' +
                    '</div>' +
                '</div>';
        }

        var overlay = document.createElement('div');
        overlay.className = 'modern-report-notify-overlay';
        var container = document.createElement('div');
        container.className = 'modern-report-notify-container';
        container.setAttribute('role', 'dialog');
        container.setAttribute('aria-modal', 'true');
        container.setAttribute('aria-labelledby', 'notifyModalTitle');
        container.setAttribute('aria-describedby', 'notifyModalDesc');

        container.innerHTML = 
            '<div class="notify-modal-header">' +
                '<div class="notify-modal-title">' +
                    '<i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i>' +
                    '<h3 id="notifyModalTitle">Reporting System</h3>' +
                '</div>' +
                '<button class="notify-modal-close" aria-label="Close modal">' +
                    '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
                '</button>' +
            '</div>' +
            '<div class="notify-tabs">' +
                '<button class="tab-btn active" data-tab="reports" id="notifyTabReports"><i class="fa-regular fa-list" aria-hidden="true"></i> Reports</button>' +
                '<button class="tab-btn" data-tab="group" id="notifyTabGroup"><i class="fa-regular fa-users" aria-hidden="true"></i> Group Management</button>' +
            '</div>' +
            '<div class="notify-modal-content">' +
                '<div id="notifyReportsPanel" class="report-list">' + reportsHtml + '</div>' +
                '<div id="notifyGroupPanel" class="group-management-panel">' +
                    '<div class="group-selector">' +
                        '<label><i class="fa-regular fa-layer-group" aria-hidden="true"></i> Groups enabled to view reports</label>' +
                        '<small>Choose the groups to be enabled to view the reports (CTRL to select individual groups)</small>' +
                        groupsSelectHtml +
                        '<button class="save-groups-btn"><i class="fa-regular fa-floppy-disk" aria-hidden="true"></i> Save settings</button>' +
                    '</div>' +
                    '<div class="footer-note" style="font-size:0.7rem; padding:0.5rem 0;">' +
                        '<i class="fa-regular fa-circle-info" aria-hidden="true"></i> Remember: if you move a group in administration, update these settings.' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="notify-modal-footer">' +
                '<i class="fa-regular fa-shield" aria-hidden="true"></i> Reported posts are visible to staff only' +
            '</div>' +
            '<div id="notifyModalDesc" class="sr-only">Admin panel for managing user reports and group permissions.</div>';

        overlay.appendChild(container);
        document.body.appendChild(overlay);
        return { overlay: overlay, container: container, reports: reports };
    }

    function showModernReportNotifyModal(legacyModal, triggerEl) {
        if (reportNotifyCloseCooldown || reportNotifyProcessing) return;
        reportNotifyProcessing = true;
        reportNotifyTriggerElement = triggerEl || document.activeElement;

        if (currentReportNotifyModal) closeModernReportNotifyModal(legacyModal, true);
        currentLegacyReportNotifyModal = legacyModal;

        var struct = createReportNotifyModalStructure(legacyModal);
        var overlay = struct.overlay;
        var container = struct.container;
        currentReportNotifyModal = overlay;

        lockBodyScroll();
        setReportNotifyFocusTrap(container);

        var closeBtn = container.querySelector('.notify-modal-close');
        var tabReports = container.querySelector('#notifyTabReports');
        var tabGroup = container.querySelector('#notifyTabGroup');
        var reportsPanel = container.querySelector('#notifyReportsPanel');
        var groupPanel = container.querySelector('#notifyGroupPanel');
        var saveGroupsBtn = container.querySelector('.save-groups-btn');
        var multiSelect = container.querySelector('.multi-select');

        function setActiveTab(active) {
            if (active === 'reports') {
                reportsPanel.style.display = 'flex';
                groupPanel.classList.remove('active');
                groupPanel.style.display = 'none';
                tabReports.classList.add('active');
                tabGroup.classList.remove('active');
            } else {
                reportsPanel.style.display = 'none';
                groupPanel.classList.add('active');
                groupPanel.style.display = 'flex';
                tabReports.classList.remove('active');
                tabGroup.classList.add('active');
            }
        }
        reportsPanel.style.display = 'flex';
        groupPanel.style.display = 'none';
        tabReports.classList.add('active');
        tabGroup.classList.remove('active');
        tabReports.addEventListener('click', function(e) { e.preventDefault(); setActiveTab('reports'); });
        tabGroup.addEventListener('click', function(e) { e.preventDefault(); setActiveTab('group'); });

        var deleteBtns = container.querySelectorAll('.delete-report');
        for (var i = 0; i < deleteBtns.length; i++) {
            deleteBtns[i].addEventListener('click', function(e) {
                e.preventDefault();
                var reportId = this.getAttribute('data-report-id');
                var legacyDeleteBtn = legacyModal.querySelector('.report_row[data-id="' + reportId + '"] .delete');
                if (legacyDeleteBtn) {
                    var clickEv = document.createEvent('MouseEvents');
                    clickEv.initEvent('click', true, true);
                    legacyDeleteBtn.dispatchEvent(clickEv);
                }
                var reportItem = this.closest('.report-item');
                if (reportItem) reportItem.remove();
                announceToScreenReader('Report deleted');
            });
        }

        if (saveGroupsBtn) {
            saveGroupsBtn.addEventListener('click', function(e) {
                e.preventDefault();
                var selectedValues = [];
                if (multiSelect) {
                    for (var i = 0; i < multiSelect.options.length; i++) {
                        if (multiSelect.options[i].selected) {
                            selectedValues.push(multiSelect.options[i].value);
                        }
                    }
                }
                var legacySelect = legacyModal.querySelector('.select_reporting_group');
                if (legacySelect) {
                    for (var i = 0; i < legacySelect.options.length; i++) {
                        legacySelect.options[i].selected = (selectedValues.indexOf(legacySelect.options[i].value) !== -1);
                    }
                    var changeEvent = document.createEvent('HTMLEvents');
                    changeEvent.initEvent('change', true, true);
                    legacySelect.dispatchEvent(changeEvent);
                }
                announceToScreenReader('Group settings saved');
            });
        }

        var closeHandler = function() { closeModernReportNotifyModal(legacyModal, false); };
        closeBtn.addEventListener('click', closeHandler);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeHandler(); });
        var escHandler = function(e) { if (e.key === 'Escape') { closeHandler(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    }

    // ========== INITIALIZATION ==========
    function init() {
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
            var faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
            document.head.appendChild(faLink);
        }

        function getTriggerElement() { return document.activeElement; }

        if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
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
                id: 'modern-report-modal',
                selector: '.ff-modal.modal.report-modal, .report-modal',
                priority: 'high',
                callback: function(node) {
                    if (node && (node.style.display === 'inline-block' || node.style.display === 'block') && !currentReportModal) {
                        showModernReportModal(node, getTriggerElement());
                    }
                }
            });
            globalThis.forumObserver.register({
                id: 'modern-report-notify-modal',
                selector: '.ff-modal.modal.report-modal-notify, .report-modal-notify',
                priority: 'high',
                callback: function(node) {
                    if (node && (node.style.display === 'inline-block' || node.style.display === 'block') && !currentReportNotifyModal) {
                        showModernReportNotifyModal(node, getTriggerElement());
                    }
                }
            });
            console.log('[Modern Modals] Registered with ForumCoreObserver');
        } else {
            var fallbackObserver = new MutationObserver(function(mutations) {
                if (closeCooldown) return;
                for (var i = 0; i < mutations.length; i++) {
                    var mutation = mutations[i];
                    if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                        var modal = mutation.target;
                        if (modal.id === 'overlay' && modal.classList && modal.classList.contains('pop_points') &&
                            modal.style.display === 'block' && !processingModal && !currentModal) {
                            var userIds = extractUserIdsFromLegacyModal(modal);
                            if (userIds.length > 0) showModernModal(userIds, modal, getTriggerElement());
                        }
                        if (modal.classList && modal.classList.contains('report-modal') && 
                            (modal.style.display === 'inline-block' || modal.style.display === 'block') && 
                            !reportProcessing && !currentReportModal) {
                            showModernReportModal(modal, getTriggerElement());
                        }
                        if (modal.classList && modal.classList.contains('report-modal-notify') && 
                            (modal.style.display === 'inline-block' || modal.style.display === 'block') && 
                            !reportNotifyProcessing && !currentReportNotifyModal) {
                            showModernReportNotifyModal(modal, getTriggerElement());
                        }
                    }
                    if (mutation.type === 'childList') {
                        for (var j = 0; j < mutation.addedNodes.length; j++) {
                            var node = mutation.addedNodes[j];
                            if (node.nodeType === 1) {
                                if (node.id === 'overlay' && node.classList && node.classList.contains('pop_points') &&
                                    node.style.display === 'block' && !processingModal && !currentModal) {
                                    var userIds = extractUserIdsFromLegacyModal(node);
                                    if (userIds.length > 0) showModernModal(userIds, node, getTriggerElement());
                                }
                                if (node.classList && node.classList.contains('report-modal') &&
                                    (node.style.display === 'inline-block' || node.style.display === 'block') &&
                                    !reportProcessing && !currentReportModal) {
                                    showModernReportModal(node, getTriggerElement());
                                }
                                if (node.classList && node.classList.contains('report-modal-notify') &&
                                    (node.style.display === 'inline-block' || node.style.display === 'block') &&
                                    !reportNotifyProcessing && !currentReportNotifyModal) {
                                    showModernReportNotifyModal(node, getTriggerElement());
                                }
                            }
                        }
                    }
                }
            });
            fallbackObserver.observe(document.body, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
            console.log('[Modern Modals] Using fallback MutationObserver');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
