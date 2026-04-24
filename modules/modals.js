// Modern Likes Modal - FORUM OBSERVER ONLY (fixed)
(function() {
    'use strict';
    
    // Inject Font Awesome if not present
    if (!document.querySelector('link[href*="font-awesome"], link[href*="fa.css"]')) {
        var faLink = document.createElement('link');
        faLink.rel = 'stylesheet';
        faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css';
        document.head.appendChild(faLink);
    }
    
    // Modal HTML/CSS (injected once) - using array join for cleaner multi-line
    var modalStyles = [
        '<style id="modern-likes-modal-styles">',
        '.modern-modal-overlay {',
        '  position: fixed;',
        '  top: 0; left: 0; right: 0; bottom: 0;',
        '  background: rgba(0, 0, 0, 0.85);',
        '  backdrop-filter: blur(4px);',
        '  z-index: 100000;',
        '  display: flex;',
        '  align-items: center;',
        '  justify-content: center;',
        '  animation: modernFadeIn 0.2s ease;',
        '}',
        '.modern-likes-modal {',
        '  background: var(--surface-color, #1F2937);',
        '  border-radius: var(--radius-lg, 13px);',
        '  max-width: 480px;',
        '  width: 90%;',
        '  max-height: 80vh;',
        '  overflow: hidden;',
        '  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);',
        '  animation: modernSlideUp 0.3s ease;',
        '  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));',
        '}',
        '.modern-modal-header {',
        '  display: flex;',
        '  justify-content: space-between;',
        '  align-items: center;',
        '  padding: 1rem 1.5rem;',
        '  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));',
        '  background: var(--surface-color, #1F2937);',
        '}',
        '.modern-modal-title {',
        '  display: flex;',
        '  align-items: center;',
        '  gap: 0.5rem;',
        '  font-weight: 600;',
        '  font-size: 1.1rem;',
        '  color: var(--text-primary, #F9FAFB);',
        '  font-family: "Quicksand", sans-serif;',
        '}',
        '.modern-modal-title i { color: var(--primary-light, #10B981); }',
        '.modern-modal-close {',
        '  background: transparent;',
        '  border: none;',
        '  color: var(--text-tertiary, #6B7280);',
        '  cursor: pointer;',
        '  font-size: 1.25rem;',
        '  padding: 0.25rem;',
        '  border-radius: 6px;',
        '  transition: all 0.2s;',
        '}',
        '.modern-modal-close:hover {',
        '  background: var(--hover-color, rgba(255, 255, 255, 0.05));',
        '  color: var(--text-primary, #F9FAFB);',
        '  transform: rotate(90deg);',
        '}',
        '.modern-likes-list {',
        '  max-height: 60vh;',
        '  overflow-y: auto;',
        '  background: var(--surface-color, #1F2937);',
        '}',
        '.modern-likes-list::-webkit-scrollbar { width: 6px; }',
        '.modern-likes-list::-webkit-scrollbar-track { background: transparent; }',
        '.modern-likes-list::-webkit-scrollbar-thumb { background: var(--surface-light, #374151); border-radius: 20px; }',
        '.modern-like-item {',
        '  display: flex;',
        '  align-items: center;',
        '  gap: 1rem;',
        '  padding: 0.875rem 1.5rem;',
        '  border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.05));',
        '  transition: background 0.2s;',
        '}',
        '.modern-like-item:hover { background: var(--hover-color, rgba(255, 255, 255, 0.05)); }',
        '.modern-like-avatar {',
        '  width: 48px;',
        '  height: 48px;',
        '  border-radius: 50%;',
        '  object-fit: cover;',
        '  border: 2px solid var(--primary-color, #059669);',
        '  flex-shrink: 0;',
        '  background: var(--surface-light, #374151);',
        '}',
        '.modern-like-info { flex: 1; min-width: 0; }',
        '.modern-like-name-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem; }',
        '.modern-like-name {',
        '  font-weight: 600;',
        '  color: var(--text-primary, #F9FAFB);',
        '  text-decoration: none;',
        '  font-size: 0.95rem;',
        '  transition: color 0.2s;',
        '}',
        '.modern-like-name:hover { color: var(--primary-light, #10B981); text-decoration: underline; }',
        '.modern-role-badge {',
        '  display: inline-block;',
        '  padding: 0.125rem 0.5rem;',
        '  border-radius: 9999px;',
        '  font-size: 0.625rem;',
        '  font-weight: 600;',
        '  color: white;',
        '}',
        '.role-founder { background: linear-gradient(135deg, #F59E0B, #D97706); }',
        '.role-administrator { background: linear-gradient(135deg, #DC2626, #B91C1C); }',
        '.role-global-mod { background: linear-gradient(135deg, #8B5CF6, #7C3AED); }',
        '.role-moderator { background: linear-gradient(135deg, #8B5CF6, #7C3AED); }',
        '.role-developer { background: linear-gradient(135deg, #0EA5E9, #0284C7); }',
        '.role-premium { background: linear-gradient(135deg, #D946EF, #C026D3); }',
        '.role-vip { background: linear-gradient(135deg, #F97316, #EA580C); }',
        '.role-member { background: linear-gradient(135deg, #059669, #047857); }',
        '.role-banned { background: linear-gradient(135deg, #4B5563, #374151); }',
        '.modern-like-stats {',
        '  display: flex;',
        '  flex-wrap: wrap;',
        '  gap: 1rem;',
        '  margin-top: 0.25rem;',
        '  font-size: 0.7rem;',
        '  color: var(--text-tertiary, #6B7280);',
        '}',
        '.modern-like-stats i { margin-right: 0.25rem; width: 12px; color: var(--primary-light, #10B981); }',
        '.status-online { color: #10B981; }',
        '.status-offline { color: #6B7280; }',
        '.modern-loading, .modern-empty { text-align: center; padding: 3rem; color: var(--text-tertiary, #6B7280); }',
        '.modern-loading i, .modern-empty i { font-size: 2rem; margin-bottom: 0.5rem; display: block; }',
        '@keyframes modernFadeIn { from { opacity: 0; } to { opacity: 1; } }',
        '@keyframes modernSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }',
        '#overlay.pop_points[style*="display: block"], .popup.pop_points[style*="display: block"] { display: none !important; }',
        '</style>'
    ].join('\n');
    
    // Helper: Extract user IDs from legacy modal
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
    function fetchUsersFromApi(userIds) {
        if (!userIds || userIds.length === 0) {
            return Promise.resolve([]);
        }
        
        var url = '/api.php?mid=' + userIds.join(',');
        
        return fetch(url)
            .then(function(response) {
                return response.json();
            })
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
    }
    
    // Helper: Get user role info from group object
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
            if (groupName && groupName !== 'members' && groupName !== 'member') {
                return { class: 'role-member', text: user.group.name };
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
        
        return { class: 'role-member', text: 'Member' };
    }
    
    // Helper: Format numbers
    function formatNumber(num) {
        if (!num && num !== 0) {
            return '0';
        }
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    
    // Helper: Escape HTML
    function escapeHtml(str) {
        if (!str) {
            return '';
        }
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
    
    // Show modern modal
    function showModernModal(userIds) {
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        
        var modal = document.createElement('div');
        modal.className = 'modern-likes-modal';
        
        var headerHtml = '<div class="modern-modal-header">' +
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
        
        var closeBtn = modal.querySelector('.modern-modal-close');
        var closeModal = function() {
            overlay.remove();
        };
        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                closeModal();
            }
        });
        
        var likesList = modal.querySelector('.modern-likes-list');
        
        fetchUsersFromApi(userIds).then(function(users) {
            if (!users || users.length === 0) {
                likesList.innerHTML = '<div class="modern-empty">' +
                    '<i class="fa-regular fa-thumbs-up"></i>' +
                    '<p>No user data available</p>' +
                    '</div>';
                return;
            }
            
            // Sort users - staff first, then by reputation
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
                var avatarUrl = user.avatar || 'https://img.forumfree.net/style_images/avatar_nn.png';
                var statusIcon = 'fa-circle';
                var statusClass = (user.status === 'online') ? 'status-online' : 'status-offline';
                var statusText = user.status || 'offline';
                
                itemsHtml = itemsHtml + '<div class="modern-like-item">' +
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
                    '<span class="' + statusClass + '">' +
                    '<i class="fa-regular ' + statusIcon + '"></i> ' + statusText +
                    '</span>' +
                    '</div>' +
                    '</div>' +
                    '</div>';
            }
            
            likesList.innerHTML = itemsHtml;
        }).catch(function(error) {
            console.error('[Modern Likes] Error:', error);
            likesList.innerHTML = '<div class="modern-empty">' +
                '<i class="fa-regular fa-circle-exclamation"></i>' +
                '<p>Error loading user data. Please try again.</p>' +
                '</div>';
        });
    }
    
    // Handle legacy modal detection
    function handleLegacyModal(node) {
        // Check if this is the legacy likes modal showing
        if (node.id === 'overlay' && 
            node.classList && 
            node.classList.contains('pop_points') &&
            node.style.display === 'block') {
            
            var userIds = extractUserIdsFromLegacyModal(node);
            
            if (userIds.length > 0) {
                console.log('[Modern Likes] Detected modal with ' + userIds.length + ' users');
                showModernModal(userIds);
                node.style.display = 'none';
            }
        }
    }
    
    // Check if ForumCoreObserver is available
    if (typeof globalThis.forumObserver === 'undefined' || !globalThis.forumObserver) {
        console.error('[Modern Likes] ForumCoreObserver not found. Script requires ForumCoreObserver to run.');
        return;
    }
    
    console.log('[Modern Likes] ForumCoreObserver detected, registering...');
    
    // Inject styles once
    if (!document.querySelector('#modern-likes-modal-styles')) {
        document.head.insertAdjacentHTML('beforeend', modalStyles);
    }
    
    // Register with ForumCoreObserver
    globalThis.forumObserver.register({
        id: 'modern-likes-modal-detector',
        selector: '#overlay.pop_points',
        priority: 'high',
        callback: handleLegacyModal
    });
    
    // Watch for new modals being added
    globalThis.forumObserver.register({
        id: 'modern-likes-modal-insertion',
        selector: 'body',
        priority: 'normal',
        callback: function() {
            var existingModal = document.querySelector('#overlay.pop_points[style*="display: block"]');
            if (existingModal) {
                handleLegacyModal(existingModal);
            }
        }
    });
    
    // Check for existing modal immediately
    var existingModal = document.querySelector('#overlay.pop_points[style*="display: block"]');
    if (existingModal) {
        var userIds = extractUserIdsFromLegacyModal(existingModal);
        if (userIds.length > 0) {
            console.log('[Modern Likes] Found existing modal with ' + userIds.length + ' users');
            showModernModal(userIds);
            existingModal.style.display = 'none';
        }
    }
    
    console.log('[Modern Likes] Ready and waiting (ForumCoreObserver only)');
})();
