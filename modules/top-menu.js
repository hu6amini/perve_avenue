/* =============================================
   Forum Top Menu Modernizer
   Emerald Theme — modern sticky top nav
   ============================================= */
'use strict';

const ForumTopMenuModule = (function () {
    console.log('🧭 ForumTopMenuModule loaded');

    const CONFIG = Object.freeze({
        LEGACY_MENU_SELECTOR: '.menuwrap',
        NAV_ID: 'modern-forum-nav',
        HIDDEN_CLASS: 'mfn--hidden',
        SCROLLED_CLASS: 'mfn--scrolled',
        OPEN_CLASS: 'mfn--open',
        SCROLL_THRESHOLD: 80,       // px before hide-on-scroll kicks in
        SCROLL_DELTA: 8,            // px of movement to flip state
        SITE_FILTER: 'patestt.forumcommunity.net',
        LOGIN_URL: 'https://accounts.forumcommunity.net/?act=Login&cid=660892',
        REGISTER_URL: 'https://accounts.forumcommunity.net/?act=Reg&cid=660892'
    });

    const LOGO_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227 60.08" aria-hidden="true" focusable="false">' +
        '<path fill="currentColor" d="M9.39 41.3V60.08H0V0H16.9A19.93 19.93 0 0 1 31.51 6a19.82 19.82 0 0 1 6 14.61 19.88 19.88 0 0 1-6 14.6 19.9 19.9 0 0 1-14.6 6ZM16.9 9.39H9.39V31.91H16.9a10.86 10.86 0 0 0 8-3.3 10.83 10.83 0 0 0 3.3-8 10.84 10.84 0 0 0-3.3-8 10.86 10.86 0 0 0-8-3.3ZM57 60.07H47.68V0H85.24V9.39H57V22.53H70.36v9.38H57V50.69H85.38v9.39H57ZM112.56 0a19.9 19.9 0 0 1 14.61 6 19.9 19.9 0 0 1 6 14.61 20.5 20.5 0 0 1-2.52 9.28 20.33 20.33 0 0 1-6 7.47 19.71 19.71 0 0 1 4.73 7 20.54 20.54 0 0 1 1.94 8.22v7.51H122V52.56A11.29 11.29 0 0 0 110.68 41.3h-5.63V60.08H95.67V0Zm-7.51 31.91h7.51a10.83 10.83 0 0 0 8-3.3 10.87 10.87 0 0 0 3.31-8 10.89 10.89 0 0 0-3.31-8 10.83 10.83 0 0 0-8-3.3h-7.51Zm60 28.16h-9.31l-7.06-30L141.62 0h9.61l1.13 4.66 1.13 4.73 3.45 14.79L160.39 39l3.46-14.79L167.3 9.39l1.13-4.73L169.56 0h9.61l-7.06 30-7.06 30Zm33.57 0H189.3V0h37.56V9.39H198.62V22.53H212v9.38H198.62V50.69H227v9.39H198.62Z"/>' +
        '</svg>';

    let navEl = null;
    let lastY = 0;
    let ticking = false;
    let openDropdownTrigger = null;
    const userApiCache = new Map();

    // ─── Helpers ──────────────────────────────────────────────
    const escapeHtml = (s) => {
        if (typeof s !== 'string') return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    };

    function h(tag, attrs, children) {
        const node = document.createElement(tag);
        if (attrs) {
            for (const k in attrs) {
                const v = attrs[k];
                if (v == null || v === false) continue;
                if (k === 'className') node.className = v;
                else if (k === 'textContent') node.textContent = v;
                else if (k === 'innerHTML') node.innerHTML = v;
                else if (v === true) node.setAttribute(k, '');
                else node.setAttribute(k, v);
            }
        }
        (Array.isArray(children) ? children : [children]).forEach(c => {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function icon(name, style) {
        return '<i class="fa-' + (style || 'regular') + ' ' + name + '" aria-hidden="true"></i>';
    }

       // ── Avatar Utilities ──────────────────────────────────────
    const AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    function getColorFromNickname(nickname, userId) {
        let hash = 0;
        const str = nickname || userId || 'user';
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function optimizeImageUrl(url, width, height) {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return null;
        if (trimmed.indexOf('weserv.nl') !== -1 || trimmed.indexOf('data:') === 0) return trimmed;
        const finalUrl = trimmed.startsWith('//') ? 'https:' + trimmed : trimmed;
        return `https://images.weserv.nl/?url=${encodeURIComponent(finalUrl)}&output=webp&maxage=1y&q=85&w=${width}&h=${height}&fit=cover&a=attention&il`;
    }

    function getGroupClass(user) {
        if (!user || !user.group) return 'group-member';
        const name = (user.group.name || '').toLowerCase();
        const cls = (user.group.class || '').toLowerCase();
        const body = (user.group.bodyclass || '').toLowerCase();
        const all = name + ' ' + cls + ' ' + body;

        if (all.includes('founder')) return 'group-founder';
        if (all.includes('admin') || all.includes('amministrat')) return 'group-administrator';
        if (all.includes('global') && all.includes('mod')) return 'group-global-moderator';
        if (all.includes('moderator') || all.includes('moderat')) return 'group-moderator';
        if (all.includes('developer')) return 'group-developer';
        if (all.includes('game dev')) return 'group-game-dev';
        if (all.includes('fan')) return 'group-fan';
        return 'group-member';
    }

    function generateAvatarHtml(user, username, userId, size) {
        const groupClass = getGroupClass(user);
        const avatarUrl = user && user.avatar ? optimizeImageUrl(user.avatar, size, size) : null;
        const isDefaultAvatar = user && user.avatar && user.avatar.includes('default_avatar');

        if (avatarUrl && !isDefaultAvatar) {
            return `<img class="mfn-avatar-img ${groupClass}" src="${avatarUrl}" alt="${escapeHtml(username)}" width="${size}" height="${size}" loading="lazy">`;
        } else {
            const initial = (username || '?').charAt(0).toUpperCase();
            const bgColor = getColorFromNickname(username, userId);
            return `<span class="mfn-avatar-initial ${groupClass}" style="background-color:#${bgColor}; width:${size}px; height:${size}px; font-size:${size * 0.618}px; line-height:${size}px;">${escapeHtml(initial)}</span>`;
        }
    }

    // Fetch group data for the logged-in user
    async function fetchUserData(mid) {
        try {
            const res = await fetch(`/api.php?mid=${mid}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data['m' + mid] || data.info || null;
        } catch (e) {
            console.warn('[TopMenu] Failed to fetch user data', e);
            return null;
        }
    }

    function normalizeAvatarUrl(url) {
        if (!url || typeof url !== 'string') return '';
        const trimmed = url.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('//')) return 'https:' + trimmed;
        if (trimmed.startsWith('http://') && window.location.protocol === 'https:') {
            return trimmed.replace(/^http:\/\//i, 'https://');
        }
        return trimmed;
    }

    function buildAvatarHtml(avatarSrc, username) {
        const cleanSrc = normalizeAvatarUrl(avatarSrc);
        if (cleanSrc) {
            return '<img src="' + escapeHtml(cleanSrc) + '" alt="" loading="lazy" class="mfn-avatar-img">';
        }
        const initial = (username || 'U').charAt(0).toUpperCase();
        return '<span class="mfn-avatar-fallback">' + escapeHtml(initial) + '</span>';
    }

    // ─── API User Lookup ──────────────────────────────────────
    async function fetchUserByMid(mid) {
        if (mid == null) return null;
        const key = String(mid).trim();
        if (!/^\d+$/.test(key)) return null;
        if (userApiCache.has(key)) return userApiCache.get(key);

        try {
            const resp = await fetch(
                window.location.origin + '/api.php?mid=' + encodeURIComponent(key),
                { credentials: 'same-origin' }
            );
            if (!resp.ok) return null;
            const data = await resp.json();
            const user = data['m' + key] || data.info || null;
            if (user && (user.id || user.nickname || user.avatar)) {
                userApiCache.set(key, user);
                return user;
            }
            return null;
        } catch (err) {
            console.warn('[TopMenu] API user fetch failed for MID ' + key + ':', err);
            return null;
        }
    }

    // ─── Login state detection ────────────────────────────────
    function isLoggedIn(menuWrap) {
        return !!menuWrap.querySelector('.left .menu > a[href*="act=Profile"]');
    }

    // ─── Icon mapping ─────────────────────────────────────────
// ─── Icon mapping ─────────────────────────────────────────
    function iconForLabel(label) {
        const l = (label || '').toLowerCase();
        const map = {
            // Specific multi-word / compound labels first
            'edit topic title': 'fa-pen-to-square',
            'edit this topic': 'fa-pen-to-square',
            'move selected topics': 'fa-arrows-left-right',
            'move selected posts': 'fa-arrows-left-right',
            'move this topic': 'fa-arrows-left-right',
            'delete selected topics': 'fa-trash-can',
            'delete selected posts': 'fa-trash-can',
            'delete this topic': 'fa-trash-can',
            'close selected topics': 'fa-lock',
            'close this topic': 'fa-lock',
            'open selected topics': 'fa-lock-open',
            'unpin selected topics': 'fa-thumbtack',
            'unpin this topic': 'fa-thumbtack',
            'pin selected topics': 'fa-thumbtack',
            'remove announcement': 'fa-bullhorn',
            'create announcement': 'fa-bullhorn',
            'mass moving/deleting': 'fa-layer-group',
            'add': 'fa-plus',

            // Existing user, forum, and admin labels
            'edit profile': 'fa-user-pen',
            'edit avatar': 'fa-image-portrait',
            'edit signature': 'fa-signature',
            'my album': 'fa-images',
            'ffupload': 'fa-cloud-arrow-up',
            'forum settings': 'fa-gear',
            'email settings': 'fa-envelope',
            'change password': 'fa-key',
            'log out': 'fa-right-from-bracket',
            'send new pm': 'fa-paper-plane',
            'go to inbox': 'fa-inbox',
            'edit folders': 'fa-folder-tree',
            'archive messages': 'fa-box-archive',
            'contact list': 'fa-address-book',
            'notepad': 'fa-notebook',
            'active topics': 'fa-fire',
            'popular topics': 'fa-star',
            'subscriptions': 'fa-bell',
            'notification centre': 'fa-bell-on',
            'mark all as read': 'fa-check-double',
            'my topics': 'fa-user-pen',
            'my posts': 'fa-message',
            'subscribe to the forum': 'fa-bell',
            'subscribe': 'fa-bell',
            'site\'s messages': 'fa-shield-halved',
            'topics planned': 'fa-calendar-check',
            'notifications from scripts': 'fa-bell',
            'website': 'fa-globe',
            'users': 'fa-users',
            'graphic': 'fa-palette',
            'additional features': 'fa-plus',
            'posts reported': 'fa-flag',
            'scripts and codes': 'fa-code',
            'top forum/blog': 'fa-trophy',
            'attachments': 'fa-paperclip',
            'chat/tagboard': 'fa-comments',
            'name, categories': 'fa-tag',
            'manage sections': 'fa-folder-tree',
            'custom pages': 'fa-file',
            'manage blog': 'fa-newspaper',
            'logs and data': 'fa-database',
            'logs': 'fa-database',
            'moderation queue': 'fa-list-check',
            'stats and options': 'fa-chart-line',
            'transfer sections': 'fa-arrow-right-arrow-left',
            'delete site': 'fa-trash',
            'send newsletter': 'fa-envelope-open-text',
            'groups': 'fa-user-group',
            'ban': 'fa-ban',
            'user approval': 'fa-user-check',
            'validate user': 'fa-user-shield',
            'edit user': 'fa-user-pen',
            'user ranks': 'fa-ranking-star',
            'avatars and signatures': 'fa-image',
            'mobile/app': 'fa-mobile-screen',
            'html code': 'fa-code',
            'colors and styles': 'fa-palette',
            'logo and images': 'fa-image',
            'site skin': 'fa-shirt',
            'emoticons': 'fa-face-smile',
            'menu': 'fa-bars',
            'tabs': 'fa-table-columns',
            'messenger': 'fa-comment',
            'topics': 'fa-list',
            'reactions': 'fa-face-smile',
            'notifications': 'fa-bell',
            'administration': 'fa-shield-halved',

            // Broader single-word / fallback action keywords
            'moderation': 'fa-gavel',
            'announcement': 'fa-bullhorn',
            'unpin': 'fa-thumbtack',
            'pin': 'fa-thumbtack',
            'move': 'fa-arrows-left-right',
            'delete': 'fa-trash-can',
            'open': 'fa-lock-open',
            'close': 'fa-lock',
            'edit': 'fa-pen-to-square'
        };
        for (const k in map) if (l.includes(k)) return map[k];
        return 'fa-circle';
    }

    // ─── Extract search form ──────────────────────────────────
    function extractSearch(menuWrap) {
        const form = menuWrap.querySelector('.right form.search');
        return {
            action: form ? (form.getAttribute('action') || 'https://www.google.com/search') : 'https://www.google.com/search',
            method: form ? (form.getAttribute('method') || 'get') : 'get'
        };
    }

    // ─── Extract user card (logged in) ────────────────────────
    function extractUser(menuWrap) {
        const link = menuWrap.querySelector('.left .menu > a[href*="act=Profile"]');
        if (!link) return null;
        const href = link.getAttribute('href') || '#';
        const midMatch = href.match(/MID=(\d+)/i);
        const img = link.querySelector('.avatar img');
        const nick = link.querySelector('.nick');
        return {
            mid: midMatch ? midMatch[1] : null,
            avatarSrc: img ? (img.getAttribute('data-original') || img.getAttribute('src') || '') : '',
            username: nick ? nick.textContent.trim() : 'User',
            profileUrl: href
        };
    }

    async function hydrateUserFromApi(user) {
        if (!user || !user.mid || !navEl) return;
        const apiUser = await fetchUserByMid(user.mid);
        if (!apiUser || !navEl) return;

        const nextUsername = (apiUser.nickname || '').trim() || user.username;
        const nextAvatarSrc = normalizeAvatarUrl(apiUser.avatar) || normalizeAvatarUrl(user.avatarSrc);
        const avatarHtml = buildAvatarHtml(nextAvatarSrc, nextUsername);

        const trigger = navEl.querySelector('.mfn-user-trigger');
        if (trigger) {
            const triggerAvatar = trigger.querySelector('.mfn-avatar');
            const triggerName = trigger.querySelector('.mfn-user-name');
            if (triggerAvatar) triggerAvatar.innerHTML = avatarHtml;
            if (triggerName) triggerName.textContent = nextUsername;
        }

        const panelHead = navEl.querySelector('.mfn-user-panel-head');
        if (panelHead) {
            const headAvatar = panelHead.querySelector('.mfn-avatar');
            const headName = panelHead.querySelector('.mfn-user-panel-name');
            if (headAvatar) headAvatar.innerHTML = avatarHtml;
            if (headName) headName.textContent = nextUsername;
        }
    }

    // ─── Recursive menu-item extractor ────────────────────────
    function extractItems(ul) {
        const out = [];
        for (const li of ul.children) {
            if (li.tagName !== 'LI') continue;
            // native separator (in legacy markup: <li><hr …></li>)
            if (li.querySelector(':scope > hr')) { out.push({ type: 'separator' }); continue; }
            const a = li.querySelector(':scope > a');
            if (!a) continue;

            const submenu = li.querySelector(':scope > ul');
            const em = a.querySelector('em');
            let badge = null;
            
            // Extract label and strip the badge number from it
            let label = a.textContent.replace(/\s+/g, ' ').trim();
            if (em) {
                const emText = em.textContent.trim();
                if (/^\d+$/.test(emText)) {
                    badge = emText;
                    label = label.replace(emText, '').trim();
                }
            }

            if (submenu) {
                out.push({
                    type: 'submenu',
                    label,
                    icon: iconForLabel(label),
                    badge,
                    items: extractItems(submenu)
                });
            } else {
                out.push({
                    type: 'link',
                    label,
                    href: a.getAttribute('href') || '',
                    onclick: a.getAttribute('onclick') || '',
                    role: a.getAttribute('role') || '',
                    tabindex: a.getAttribute('tabindex') || '',
                    dataToggle: a.getAttribute('data-toggle') || '',
                    className: a.className || '',
                    bold: /font-weight:\s*(600|bold)/i.test(a.getAttribute('style') || ''),
                    badge,
                    icon: iconForLabel(label)
                });
            }
        }
        return out;
    }

    // ─── Top-level actions (Messenger / Topics / … / Admin) ──
    function extractTopActions(menuWrap, userLink) {
        const out = [];
        for (const li of menuWrap.querySelectorAll('.left > li.menu')) {
            const a = li.querySelector(':scope > a');
            if (!a || a === userLink) continue;

            const submenu = li.querySelector(':scope > ul');
            const em = a.querySelector('em');
            let badge = null;
            
            // Extract label and strip the badge number from it
            let label = a.textContent.replace(/\s+/g, ' ').trim();
            if (em) {
                const emText = em.textContent.trim();
                if (/^\d+$/.test(emText)) {
                    badge = emText;
                    label = label.replace(emText, '').trim();
                }
            }

            if (submenu) {
                out.push({
                    type: 'submenu',
                    label,
                    icon: iconForLabel(label),
                    badge,
                    items: extractItems(submenu)
                });
            } else {
                out.push({
                    type: 'link',
                    label,
                    href: a.getAttribute('href') || '',
                    onclick: a.getAttribute('onclick') || '',
                    role: a.getAttribute('role') || '',
                    tabindex: a.getAttribute('tabindex') || '',
                    dataToggle: a.getAttribute('data-toggle') || '',
                    className: a.className || '',
                    badge,
                    icon: iconForLabel(label)
                });
            }
        }
        return out;
    }
   
    // ─── Guest data ───────────────────────────────────────────
    function extractGuest(menuWrap) {
        const socials = [];
        menuWrap.querySelectorAll('.login_with button[data-url]').forEach(btn => {
            const service = btn.getAttribute('data-service');
            const url = btn.getAttribute('data-url');
            if (service && url) socials.push({ service, url });
        });
        return { socials };
    }

    // ─── Build: dropdown content for a list of items ─────────
    function buildDropdownBody(items) {
        const frag = document.createDocumentFragment();
        items.forEach(item => {
            if (item.type === 'separator') {
                frag.appendChild(h('hr', { className: 'mfn-sep' }));
                return;
            }
            if (item.type === 'submenu') {
                const det = h('details', { className: 'mfn-submenu' });
                
                // ── FIX: Build the summary using innerHTML ──
                const summary = h('summary', { className: 'mfn-submenu-summary' },
                                 'data-menu-label': item.label);
                summary.innerHTML = 
                    '<span class="mfn-submenu-left">' + icon(item.icon) + ' ' + escapeHtml(item.label) + '</span>' +
                    (item.badge ? '<span class="mfn-badge">' + escapeHtml(item.badge) + '</span>' : '') +
                    '<i class="fa-regular fa-chevron-down mfn-chev" aria-hidden="true"></i>';
                
                det.appendChild(summary);
                
                const body = h('div', { className: 'mfn-submenu-body' });
                body.appendChild(buildDropdownBody(item.items));
                det.appendChild(body);
                frag.appendChild(det);
                return;
            }
            const a = h('a', {
                className: 'mfn-dd-link' + (item.bold ? ' mfn-dd-link--bold' : '') +
                           (item.className ? ' ' + item.className : ''),
                href: item.href || undefined,
                onclick: item.onclick || undefined,
                role: item.role || undefined,
                tabindex: item.tabindex || undefined
            });
            if (item.dataToggle) a.setAttribute('data-toggle', item.dataToggle);
            a.innerHTML =
                '<span class="mfn-dd-link-left">' + icon(item.icon) + ' ' + escapeHtml(item.label) + '</span>' +
                (item.badge ? '<span class="mfn-badge">' + escapeHtml(item.badge) + '</span>' : '');
            frag.appendChild(a);
        });
        return frag;
    }

    // ─── Build: primary action button (link or submenu) ──────
    function buildTopAction(item) {
        if (item.type === 'submenu') {
            const wrap = h('div', { className: 'mfn-dropdown' });
            const trigger = h('button', {
                type: 'button',
                className: 'mfn-action mfn-action--has-menu',
                'aria-haspopup': 'true',
                'aria-expanded': 'false',
                'data-menu-label': item.label,
                title: item.label,
                innerHTML: icon(item.icon) +
                    '<span class="mfn-action-label">' + escapeHtml(item.label) + '</span>' +
                    (item.badge ? '<span class="mfn-badge">' + escapeHtml(item.badge) + '</span>' : '') +
                    '<i class="fa-regular fa-angle-down mfn-chev" aria-hidden="true"></i>'
            });
            const panel = h('div', { className: 'mfn-dropdown-panel' });
            panel.appendChild(buildDropdownBody(item.items));
            wrap.appendChild(trigger);
            wrap.appendChild(panel);
            return wrap;
        }

        const tag = (item.dataToggle || item.onclick) ? 'button' : 'a';
        const attrs = {
            type: tag === 'button' ? 'button' : undefined,
            className: 'mfn-action' + (item.className ? ' ' + item.className : ''),
            role: item.role || undefined,
            tabindex: item.tabindex || undefined,
            href: tag === 'a' ? (item.href || '#') : undefined,
            onclick: item.onclick || undefined,
            'data-toggle': item.dataToggle || undefined,
            innerHTML: icon(item.icon) +
                '<span class="mfn-action-label">' + escapeHtml(item.label) + '</span>' +
                (item.badge ? '<span class="mfn-badge">' + escapeHtml(item.badge) + '</span>' : '')
        };
        return h(tag, attrs);
    }

    // ─── Build: user dropdown (logged-in) ────────────────────
    function buildUserDropdown(user, items, apiUser) {
        const wrap = h('div', { className: 'mfn-dropdown mfn-user-dropdown' });
        
        // Generate avatar using the API data if available, otherwise fall back to DOM data
        const avatarHtml = generateAvatarHtml(apiUser, user.username, user.mid, 32);
        const groupClass = getGroupClass(apiUser);

        const trigger = h('button', {
            type: 'button',
            className: 'mfn-user-trigger',
            'aria-haspopup': 'true',
            'aria-expanded': 'false'
        });
        trigger.innerHTML =
            `<span class="mfn-avatar ${groupClass}">${avatarHtml}</span>` +
            '<span class="mfn-user-name">' + escapeHtml(user.username) + '</span>' +
            '<i class="fa-regular fa-chevron-down mfn-chev" aria-hidden="true"></i>';

        const panel = h('div', { className: 'mfn-dropdown-panel mfn-user-panel' });
        const head = h('div', { className: 'mfn-user-panel-head' });
        
        // Use a larger 44px avatar for the dropdown header
        const lgAvatarHtml = generateAvatarHtml(apiUser, user.username, user.mid, 44);
        head.innerHTML =
            `<span class="mfn-avatar mfn-avatar--lg ${groupClass}">${lgAvatarHtml}</span>` +
            '<div class="mfn-user-panel-meta">' +
                '<a class="mfn-user-panel-name" href="' + escapeHtml(user.profileUrl) + '">' + escapeHtml(user.username) + '</a>' +
                '<span class="mfn-user-panel-sub">Signed in</span>' +
            '</div>';
            
        panel.appendChild(head);
        panel.appendChild(h('hr', { className: 'mfn-sep' }));
        panel.appendChild(buildDropdownBody(items));
        wrap.appendChild(trigger);
        wrap.appendChild(panel);
        return wrap;
    }

    // ─── Build: guest block ──────────────────────────────────
    function buildGuestBlock(guest) {
        const frag = document.createDocumentFragment();

        const loginWrap = h('div', { className: 'mfn-dropdown' });
        const loginTrigger = h('button', {
            type: 'button',
            className: 'mfn-action mfn-action--primary',
            'aria-haspopup': 'true',
            'aria-expanded': 'false',
            innerHTML: icon('fa-right-to-bracket') + '<span class="mfn-action-label">Login</span>'
        });

        const loginPanel = h('div', { className: 'mfn-dropdown-panel mfn-login-panel' });
        loginPanel.appendChild(
            h('a', {
                className: 'mfn-login-main',
                href: CONFIG.LOGIN_URL,
                innerHTML: '<i class="fa-regular fa-user" aria-hidden="true"></i> Sign in with username'
            })
        );
        if (guest.socials.length) {
            loginPanel.appendChild(h('div', { className: 'mfn-login-or', textContent: 'or continue with' }));
            const socialRow = h('div', { className: 'mfn-social-row' });
            guest.socials.forEach(s => {
                const btn = h('button', {
                    type: 'button',
                    className: 'mfn-social-btn',
                    'data-service': s.service,
                    'data-url': s.url
                });
                let brandIcon;
                if (s.service === 'google')        brandIcon = '<i class="fa-brands fa-google"></i>';
                else if (s.service === 'facebook') brandIcon = '<i class="fa-brands fa-facebook-f"></i>';
                else if (s.service === 'telegram') brandIcon = '<i class="fa-brands fa-telegram"></i>';
                else                               brandIcon = '<i class="fa-regular fa-globe"></i>';
                btn.innerHTML = brandIcon + '<span>' + escapeHtml(s.service) + '</span>';
                socialRow.appendChild(btn);
            });
            loginPanel.appendChild(socialRow);
        }
        loginPanel.appendChild(
            h('a', {
                className: 'mfn-register-link',
                href: CONFIG.REGISTER_URL,
                innerHTML: 'Create an account <i class="fa-regular fa-arrow-right" aria-hidden="true"></i>'
            })
        );

        loginWrap.appendChild(loginTrigger);
        loginWrap.appendChild(loginPanel);
        frag.appendChild(loginWrap);

        frag.appendChild(
            h('a', {
                className: 'mfn-action mfn-action--ghost',
                href: CONFIG.REGISTER_URL,
                innerHTML: icon('fa-user-plus') + '<span class="mfn-action-label">Register</span>'
            })
        );

        return frag;
    }

    // ─── Build: mobile search toggle ─────────────────────────
    function buildMobileSearchToggle(searchForm) {
        const searchToggle = h('button', {
            type: 'button',
            className: 'mfn-action mfn-search-toggle',
            'aria-label': 'Toggle search',
            innerHTML: '<i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>'
        });
        searchToggle.style.display = 'none'; // shown via CSS media query

        searchToggle.addEventListener('click', () => {
            searchForm.classList.toggle('mfn-search--mobile-open');
        });

        return searchToggle;
    }

    // ─── Build: full nav ─────────────────────────────────────
    function buildNav(data) {
        const nav = h('nav', { id: CONFIG.NAV_ID, className: 'mfn', 'aria-label': 'Primary' });
        const inner = h('div', { className: 'mfn-inner' });

        // Logo → home
        inner.appendChild(
            h('a', {
                className: 'mfn-logo',
                href: '/',
                'aria-label': 'Home',
                innerHTML: LOGO_SVG
            })
        );

        // ── Scoped Search Setup ──────────────────────────────────
        const searchWrap = h('div', { className: 'mfn-search-wrap' });

        // 1. Custom Scope Dropdown
        const scopeWrap = h('div', { className: 'mfn-dropdown mfn-scope-dropdown' });
        
        const scopeTrigger = h('button', {
            type: 'button',
            className: 'mfn-scope-trigger',
            'aria-haspopup': 'true',
            'aria-expanded': 'false'
        });
        scopeTrigger.innerHTML = '<span class="mfn-scope-label"><i class="fa-regular fa-folder" aria-hidden="true"></i> Forum</span><i class="fa-regular fa-chevron-down mfn-chev" aria-hidden="true"></i>';

        const scopePanel = h('div', { className: 'mfn-dropdown-panel mfn-scope-panel' });
        const scopeOptions = [
            { value: 'forum', label: 'Forum', icon: 'fa-regular fa-folder' },
            { value: 'google', label: 'Google', icon: 'fa-brands fa-google' },
            { value: 'user', label: 'Users', icon: 'fa-regular fa-user' }
        ];

        scopeOptions.forEach(opt => {
            const btn = h('button', {
                type: 'button',
                className: 'mfn-dd-link mfn-scope-option',
                'data-value': opt.value
            });
            btn.innerHTML = `<span class="mfn-dd-link-left">${opt.icon ? `<i class="${opt.icon}"></i>` : ''} ${opt.label}</span>`;
            scopePanel.appendChild(btn);
        });

        scopeWrap.appendChild(scopeTrigger);
        scopeWrap.appendChild(scopePanel);
        searchWrap.appendChild(scopeWrap);

        // 2. The Search Form
        const form = h('form', {
            className: 'mfn-search',
            action: 'https://perveavenue.forumcommunity.net/',
            method: 'post',
            role: 'search'
        });
        
        form.innerHTML =
            '<label class="mfn-search-label" for="mfn-search-input">Search</label>' +
            '<i class="fa-regular fa-magnifying-glass mfn-search-icon" aria-hidden="true"></i>' +
            '<input id="mfn-search-input" type="search" name="keywords" ' +
                'placeholder="Search forum threads..." autocomplete="off" maxlength="150" required>' +
            '<input type="hidden" name="act" value="Search" data-scope-added>' +
            '<input type="hidden" name="CODE" value="01" data-scope-added>';
            
        searchWrap.appendChild(form);

        // 3. Autocomplete Panel
        const autocompletePanel = h('div', { className: 'mfn-search-autocomplete' });
        searchWrap.appendChild(autocompletePanel);

        // 4. Search State & Logic
        let currentScope = 'forum';
        let searchTimeout = null;
        let searchAbort = null;
        let acResults = [];
        let acFocusIndex = -1;

        const searchInput = form.querySelector('#mfn-search-input');

        function closeAutocomplete() {
            autocompletePanel.classList.remove('is-active');
            acFocusIndex = -1;
        }

        function renderAutocomplete() {
            if (!acResults.length) {
                closeAutocomplete();
                return;
            }
            autocompletePanel.innerHTML = '';
            acFocusIndex = -1;

            acResults.forEach((user, i) => {
                const profileUrl = `/?act=Profile&MID=${user.id}`;
                const username = user.name || user.nickname || 'User';
                
                // Use the shared helper!
                const avatarHtml = generateAvatarHtml(user, username, user.id, 26);
                const groupClass = getGroupClass(user);

                const item = h('div', {
                    className: 'mfn-ac-item',
                    'data-index': i,
                    'data-url': profileUrl
                });
                
                item.innerHTML = `
                    <span class="mfn-ac-avatar-wrap ${groupClass}">${avatarHtml}</span>
                    <span class="mfn-ac-name">${escapeHtml(username)}</span>
                `;
                
                item.addEventListener('click', () => {
                    window.location.href = profileUrl;
                });
                
                autocompletePanel.appendChild(item);
            });
            autocompletePanel.classList.add('is-active');
        }

        function updateAcFocus(items) {
            items.forEach((item, i) => {
                item.classList.toggle('is-focused', i === acFocusIndex);
            });
            if (items[acFocusIndex]) {
                items[acFocusIndex].scrollIntoView({ block: 'nearest' });
            }
        }

        // Input Listener (Debounced API Fetch)
        searchInput.addEventListener('input', (e) => {
            if (currentScope !== 'user') return;
            const query = e.target.value.trim();
            
            clearTimeout(searchTimeout);
            if (searchAbort) searchAbort.abort();
            closeAutocomplete();
            
            if (query.length < 2) return;

            searchTimeout = setTimeout(async () => {
                searchAbort = new AbortController();
                try {
                    const res = await fetch(`/api.php?search&name=${encodeURIComponent(query)}&n=10&cookie=1`, {
                        credentials: 'include',
                        signal: searchAbort.signal
                    });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    const data = await res.json();
                    acResults = (data && data.users) ? data.users : [];
                    renderAutocomplete();
                } catch (err) {
                    if (err.name !== 'AbortError') console.warn('[TopMenu] User search failed:', err);
                }
            }, 300);
        });

        // Keyboard Navigation
        searchInput.addEventListener('keydown', (e) => {
            if (currentScope !== 'user' || !autocompletePanel.classList.contains('is-active')) return;
            
            const items = autocompletePanel.querySelectorAll('.mfn-ac-item');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                acFocusIndex = (acFocusIndex + 1) % items.length;
                updateAcFocus(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                acFocusIndex = (acFocusIndex - 1 + items.length) % items.length;
                updateAcFocus(items);
            } else if (e.key === 'Enter' && acFocusIndex >= 0) {
                e.preventDefault();
                window.location.href = items[acFocusIndex].getAttribute('data-url');
            } else if (e.key === 'Escape') {
                closeAutocomplete();
            }
        });

        // Close dropdown when input loses focus (with delay for clicks)
        searchInput.addEventListener('blur', () => {
            setTimeout(closeAutocomplete, 200);
        });

        // 5. Switching Logic
        scopePanel.addEventListener('click', (e) => {
            const btn = e.target.closest('.mfn-scope-option');
            if (!btn) return;
            
            e.preventDefault();
            const scope = btn.dataset.value;
            const label = btn.textContent.trim();
            const iconHTML = btn.querySelector('i') ? btn.querySelector('i').outerHTML : '';
            
            scopeTrigger.querySelector('.mfn-scope-label').innerHTML = iconHTML + ' ' + label;
            scopeWrap.classList.remove(CONFIG.OPEN_CLASS);
            scopeTrigger.setAttribute('aria-expanded', 'false');

            currentScope = scope; // Update global scope state
            searchInput.value = '';
            closeAutocomplete();

            form.querySelectorAll('input[type="hidden"]').forEach(el => el.remove());

            if (scope === 'forum') {
                form.action = 'https://perveavenue.forumcommunity.net/';
                form.method = 'post';
                searchInput.name = 'keywords';
                searchInput.placeholder = 'Search forum threads...';
                form.insertAdjacentHTML('beforeend', `<input type="hidden" name="act" value="Search"><input type="hidden" name="CODE" value="01">`);
            } else if (scope === 'google') {
                form.action = 'https://www.google.com/search';
                form.method = 'get';
                searchInput.name = 'q';
                searchInput.placeholder = 'Search on Google...';
                form.insertAdjacentHTML('beforeend', `<input type="hidden" name="as_sitesearch" value="${CONFIG.SITE_FILTER}">`);
            } else if (scope === 'user') {
                form.action = 'https://www.forumcommunity.net/';
                form.method = 'get';
                searchInput.name = 'keywords';
                searchInput.placeholder = 'Search members...';
                form.insertAdjacentHTML('beforeend', `<input type="hidden" name="act" value="cerca"><input type="hidden" name="select" value="utente">`);
            }
            
            searchInput.focus();
        });

        inner.appendChild(searchWrap);
        // ─────────────────────────────────────────────────────────

        // Actions
        const actions = h('div', { className: 'mfn-actions' });

        // Mobile search toggle (created once)
        actions.appendChild(buildMobileSearchToggle(form));

        // Theme Toggle
        const themeToggle = h('button', {
            type: 'button',
            className: 'mfn-action mfn-theme-toggle',
            'data-theme-toggle': '',
            'aria-label': 'Toggle theme',
            title: 'Toggle theme'
        });
        themeToggle.innerHTML = '<i class="fa-regular fa-sun-bright" aria-hidden="true"></i>';

        actions.appendChild(themeToggle);

        if (data.loggedIn) {
            data.actions.forEach(item => actions.appendChild(buildTopAction(item)));
            // Pass data.apiUser here
            actions.appendChild(buildUserDropdown(data.user, data.userDropdown, data.apiUser)); 
        } else {
            actions.appendChild(buildGuestBlock(data.guest));
        }

        inner.appendChild(actions);
        nav.appendChild(inner);
        return nav;
    }

    // ─── Scroll behavior (smart sticky) ──────────────────────
    function onScroll() {
        const y = window.scrollY;
        if (!navEl) return;

        if (y < CONFIG.SCROLL_THRESHOLD) {
            navEl.classList.remove(CONFIG.HIDDEN_CLASS);
            navEl.classList.remove(CONFIG.SCROLLED_CLASS);
        } else {
            if (y > lastY + CONFIG.SCROLL_DELTA) {
                navEl.classList.add(CONFIG.HIDDEN_CLASS);
                closeAllDropdowns();
            } else if (y < lastY - CONFIG.SCROLL_DELTA) {
                navEl.classList.remove(CONFIG.HIDDEN_CLASS);
            }
            navEl.classList.add(CONFIG.SCROLLED_CLASS);
        }
        lastY = y;
        ticking = false;
    }

    function requestScroll() {
        if (!ticking) {
            window.requestAnimationFrame(onScroll);
            ticking = true;
        }
    }

    // ─── Dropdown toggling ───────────────────────────────────
    function closeAllDropdowns(except) {
        if (!navEl) return;
        navEl.querySelectorAll('.mfn-dropdown.mfn--open').forEach(dd => {
            if (dd === except) return;
            dd.classList.remove(CONFIG.OPEN_CLASS);
            const t = dd.querySelector('[aria-expanded="true"]');
            if (t) t.setAttribute('aria-expanded', 'false');
        });
    }

    function attachEventDelegation() {
        // Click on triggers
        navEl.addEventListener('click', (e) => {
            const trigger = e.target.closest(
                '.mfn-user-trigger, .mfn-action--has-menu, .mfn-action--primary, .mfn-scope-trigger'
            );
            if (trigger && navEl.contains(trigger)) {
                const dd = trigger.closest('.mfn-dropdown');
                if (!dd) return;
                if (!dd.querySelector('.mfn-dropdown-panel')) return;
                e.preventDefault();
                const isOpen = dd.classList.contains(CONFIG.OPEN_CLASS);
                closeAllDropdowns(dd);
                if (isOpen) {
                    dd.classList.remove(CONFIG.OPEN_CLASS);
                    trigger.setAttribute('aria-expanded', 'false');
                } else {
                    dd.classList.add(CONFIG.OPEN_CLASS);
                    trigger.setAttribute('aria-expanded', 'true');
                }
                openDropdownTrigger = isOpen ? null : trigger;
                return;
            }

            // Social login click → replicate legacy cookie + redirect
            const social = e.target.closest('.mfn-social-btn[data-service][data-url]');
            if (social) {
                e.preventDefault();
                document.cookie = 'social-login=' + social.dataset.service +
                    '; expires=Wed, 1 Jan 2030 00:00:00 GMT; path=/;';
                window.location.href = social.dataset.url;
            }
        });

        // Click outside → close
        document.addEventListener('click', (e) => {
            if (!navEl) return;
            if (!navEl.contains(e.target)) {
                closeAllDropdowns();
                openDropdownTrigger = null;
            }
        });

        // Escape → close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllDropdowns();
                openDropdownTrigger = null;
            }
        });
    }

    // ─── Init ────────────────────────────────────────────────
    async function init() { // <── Make this async
        const menuWrap = document.querySelector(CONFIG.LEGACY_MENU_SELECTOR);
        if (!menuWrap) return;
        if (document.getElementById(CONFIG.NAV_ID)) return;

        const loggedIn = isLoggedIn(menuWrap);
        const userLink = loggedIn ? menuWrap.querySelector('.left .menu > a[href*="act=Profile"]') : null;

        // 1. Extract the basic user data from the DOM
        const user = loggedIn ? extractUser(menuWrap) : null;
        
        // 2. Fetch full user data (group info) if logged in
        let apiUser = null;
        if (user) {
            const midMatch = user.profileUrl.match(/MID=(\d+)/);
            if (midMatch) {
                user.mid = midMatch[1];
                apiUser = await fetchUserData(user.mid);
            }
        }

        const data = {
            loggedIn,
            search: extractSearch(menuWrap),
            user: user,
            apiUser: apiUser, // <── Pass the API data
            userDropdown: loggedIn && userLink ? extractItems(userLink.nextElementSibling || document.createElement('ul')) : [],
            actions: loggedIn ? extractTopActions(menuWrap, userLink) : [],
            guest: !loggedIn ? extractGuest(menuWrap) : null
        };

        navEl = buildNav(data);
        menuWrap.parentNode.insertBefore(navEl, menuWrap);
        menuWrap.setAttribute('aria-hidden', 'true');

        attachEventDelegation();
        window.addEventListener('scroll', requestScroll, { passive: true });

        // ── NEW: Watch for late-injected plugin badges ──
        function syncBadges() {
            // 1. Check top-level items
            menuWrap.querySelectorAll('.left > li.menu > a').forEach(a => {
                let label = a.textContent.replace(/\s+/g, ' ').trim();
                const em = a.querySelector('em');
                let badge = null;
                
                if (em && /^\d+$/.test(em.textContent.trim())) {
                    badge = em.textContent.trim();
                    label = label.replace(badge, '').trim();
                }

                const modernEl = navEl.querySelector(`[data-menu-label="${label}"]`);
                if (modernEl) {
                    let badgeEl = modernEl.querySelector('.mfn-badge');
                    if (badge) {
                        if (!badgeEl) {
                            badgeEl = document.createElement('span');
                            badgeEl.className = 'mfn-badge';
                            modernEl.appendChild(badgeEl);
                        }
                        badgeEl.textContent = badge;
                    } else if (badgeEl) {
                        badgeEl.remove();
                    }
                }
            });

            // 2. Check nested submenu items (like "Additional features")
            menuWrap.querySelectorAll('.submenu > a').forEach(a => {
                let label = a.textContent.replace(/\s+/g, ' ').trim();
                const em = a.querySelector('em');
                let badge = null;
                
                if (em && /^\d+$/.test(em.textContent.trim())) {
                    badge = em.textContent.trim();
                    label = label.replace(badge, '').trim();
                }

                const modernEl = navEl.querySelector(`.mfn-submenu-summary[data-menu-label="${label}"]`);
                if (modernEl) {
                    let badgeEl = modernEl.querySelector('.mfn-badge');
                    if (badge) {
                        if (!badgeEl) {
                            badgeEl = document.createElement('span');
                            badgeEl.className = 'mfn-badge';
                            // Insert before the chevron
                            const chev = modernEl.querySelector('.mfn-chev');
                            if (chev) modernEl.insertBefore(badgeEl, chev);
                            else modernEl.appendChild(badgeEl);
                        }
                        badgeEl.textContent = badge;
                    } else if (badgeEl) {
                        badgeEl.remove();
                    }
                }
            });
        }

        // Run once immediately to catch anything that loaded in time
        syncBadges();

        // Watch for the plugin injecting the <em> tags later
        const badgeObserver = new MutationObserver((mutations) => {
            // Debounce slightly to prevent firing 10 times in a row if multiple nodes are added
            clearTimeout(badgeObserver._timer);
            badgeObserver._timer = setTimeout(syncBadges, 100);
        });
        
        badgeObserver.observe(menuWrap, {
            childList: true,
            subtree: true,
            characterData: true
        });
        // ────────────────────────────────────────────────

        console.log('[TopMenu] Modern nav built (' + (loggedIn ? 'member' : 'guest') + ')');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    return { init };
})();
