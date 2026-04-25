// ==UserScript==
// @name         Modern Likes Modal for ForumFree (Accessible)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Replaces the old likes popup with a modern, fully accessible modal using real API data
// @author       You
// @match        *://*.forumfree.it/*
// @match        *://*.forumcommunity.net/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ========== STATE ==========
    var currentModal = null;          // reference to overlay element
    var currentLegacyModal = null;
    var closeCooldown = false;
    var cooldownTimer = null;
    var processingModal = false;
    var triggerElement = null;         // element that opened the modal
    var previousActiveElement = null;
    var focusableElements = [];
    var firstFocusable = null;
    var lastFocusable = null;
    var isDialogPolyfilled = false;    // tracks if we used dialog polyfill

    // ========== CONFIGURATION ==========
    var WESERV_CONFIG = {
        cdn: 'https://images.weserv.nl/',
        cache: '1y',
        quality: 90,
        avatarWidth: 48,
        avatarHeight: 48
    };

    var AVATAR_COLORS = [ /* same as before */ ];
    var userProfileLinks = new Map();

    // ========== HELPER FUNCTIONS (unchanged from your original) ==========
    function optimizeImageUrl(url, width, height) { /* keep your existing implementation */ }
    function getColorFromNickname(nickname, userId) { /* keep */ }
    function generateDiceBearAvatar(username, userId) { /* keep */ }
    function isValidAvatar(avatarUrl) { /* keep */ }
    function getUserAvatarSync(user) { /* keep */ }
    function storeProfileLinks(legacyModal) { /* keep */ }
    function navigateToProfile(userId) { /* keep */ }
    function clickOriginalCloseButton(legacyModal) { /* keep */ }
    function extractUserIdsFromLegacyModal(legacyModal) { /* keep */ }
    async function fetchUsersFromApi(userIds) { /* keep */ }
    function getUserRoleInfo(user) { /* keep */ }
    function formatNumber(num) { /* keep */ }
    function escapeHtml(str) { /* keep */ }
    function getCurrentTime() { /* keep */ }

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
        // Only elements that are visible and not disabled
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
            // Move focus to the first focusable element (close button)
            firstFocusable.focus();
        } else {
            // If nothing focusable, focus the modal itself
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
        // Clear after a few seconds
        setTimeout(function() { if (liveRegion.textContent === message) liveRegion.textContent = ''; }, 3000);
    }

    // ========== CLOSE MODAL (core) ==========
    function closeCustomModal(legacyModal, skipOriginalClose) {
        if (currentModal) {
            unlockBodyScroll();
            removeFocusTrap();

            // If using polyfill <dialog>, call close() method
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
        restoreFocus();
    }

    // ========== CREATE MODAL DOM (with ARIA) ==========
    function createModalStructure(userIds, legacyModal) {
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        var modal = document.createElement('div');
        modal.className = 'modern-likes-modal';
        // ARIA roles & attributes
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

    // ========== SHOW MODAL (main entry) ==========
    async function showModernModal(userIds, legacyModal, triggerEl) {
        if (closeCooldown || processingModal) return;
        processingModal = true;

        // Store the element that caused the modal to open
        triggerElement = triggerEl || document.activeElement;
        previousActiveElement = document.activeElement;

        storeProfileLinks(legacyModal);

        // Remove existing modal if any
        if (currentModal) {
            closeCustomModal(legacyModal, true);
        }

        currentLegacyModal = legacyModal;

        // Create DOM
        var structures = createModalStructure(userIds, legacyModal);
        var overlay = structures.overlay;
        var modal = structures.modal;
        currentModal = overlay;

        // Lock body scroll
        lockBodyScroll();

        // Set up focus trap after modal is in DOM
        setFocusTrap(modal);

        // Close handlers
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

            // Sort users (same logic)
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
                var statusClass = user.status === 'online' ? 'status-online' : 'status-offline';
                var escapedNickname = escapeHtml(user.nickname);

                itemsHtml += 
                    '<div class="modern-like-item" data-user-id="' + user.id + '" tabindex="0" role="button" aria-label="View profile of ' + escapedNickname + '">' +
                        '<img class="modern-like-avatar" src="' + avatarUrl + '" alt="Avatar of ' + escapedNickname + '" loading="lazy" decoding="async" width="48" height="48" data-user-id="' + user.id + '" onerror="this.onerror=null; this.src=\'' + optimizedFallback.url + '\';">' +
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
            countSpan.textContent = sortedUsers.length;
            announceToScreenReader('Loaded ' + sortedUsers.length + ' users');

            // Attach click events for profile navigation (same as before)
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
                    // Keyboard support: Enter or Space
                    element.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            var uid2 = this.getAttribute('data-user-id');
                            if (uid2) navigateToProfile(uid2);
                        }
                    });
                }
            }
            // Reapply focus trap because new elements have been added
            removeFocusTrap();
            setFocusTrap(modal);
        } catch (error) {
            console.error('[Modern Likes] Error:', error);
            likesList.innerHTML = '<div class="modern-empty"><i class="fa-regular fa-circle-exclamation" aria-hidden="true"></i><p>Error loading user data.</p></div>';
            announceToScreenReader('Error loading user data');
        }
        processingModal = false;
    }

    // ========== INITIALIZATION (unchanged from your original, but we pass trigger element) ==========
    function init() {
        // Ensure Font Awesome is available (unchanged)
        if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
            var faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
            document.head.appendChild(faLink);
        }

        // Helper to get the element that triggered the modal (the like button)
        function getTriggerElement() {
            // Find the currently focused element or the element that was just clicked
            return document.activeElement;
        }

        // Use global ForumCoreObserver if present (same as before, but now pass trigger)
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
            console.log('[Modern Likes] Registered with ForumCoreObserver');
        } else {
            // Fallback MutationObserver (unchanged, but add trigger)
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
                    }
                    if (mutation.type === 'childList') {
                        for (var j = 0; j < mutation.addedNodes.length; j++) {
                            var node = mutation.addedNodes[j];
                            if (node.nodeType === 1 && node.id === 'overlay' && node.classList &&
                                node.classList.contains('pop_points') && node.style.display === 'block' &&
                                !processingModal && !currentModal) {
                                var userIds = extractUserIdsFromLegacyModal(node);
                                if (userIds.length > 0) showModernModal(userIds, node, getTriggerElement());
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
