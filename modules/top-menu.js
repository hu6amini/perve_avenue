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
    let cachedSections = null; // Cache for the Sections API

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

    // ── Tippy Polling Loader ──────────────────────────────────
    function initHeaderTippys() {
        // If tippy isn't loaded yet, wait 100ms and try again
        if (typeof window.tippy !== 'function') {
            setTimeout(initHeaderTippys, 100);
            return;
        }

        // Attach tippy to all elements with data-tippy-content in the nav
        document.querySelectorAll('#modern-forum-nav [data-tippy-content]').forEach(el => {
            if (el._tippy) return; // Prevent double initialization
            
            window.tippy(el, {
                theme: 'emerald',      // Matches your custom tooltip theme
                placement: 'bottom',
                delay: [400, 0],       // Show after 400ms, hide instantly
                animation: 'fade',
                touch: false,          // Don't trigger on mobile taps
                allowHTML: true,
                appendTo: () => document.body // Prevents z-index clipping
            });
        });
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

    function getCurrentUserId() {
        const menuLink = document.querySelector('.menuwrap a[href*="MID="]');
        if (menuLink) {
            const m = menuLink.getAttribute('href').match(/MID=(\d+)/);
            if (m) return m[1];
        }
        const avatarImg = document.querySelector('.menuwrap .avatar img');
        if (avatarImg) {
            const orig = avatarImg.getAttribute('data-original') || '';
            const om = orig.match(/\/fc(\d{5,})\//);
            if (om) return om[1];
            const src = avatarImg.getAttribute('src') || '';
            const sm = src.match(/fc(\d{5,})/);
            if (sm) return sm[1];
        }
        const bodyMatch = document.body.className.match(/\ba(\d{5,})\b/);
        if (bodyMatch) return bodyMatch[1];
        return null;
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

    function isLoggedIn() {
        return getCurrentUserId() !== null;
    }

    function iconForLabel(label) {
        const l = (label || '').toLowerCase();
        const map = {
            'edit topic title': 'fa-pen-to-square', 'edit this topic': 'fa-pen-to-square',
            'move selected topics': 'fa-arrows-left-right', 'move selected posts': 'fa-arrows-left-right',
            'move this topic': 'fa-arrows-left-right', 'delete selected topics': 'fa-trash-can',
            'delete selected posts': 'fa-trash-can', 'delete this topic': 'fa-trash-can',
            'close selected topics': 'fa-lock', 'close this topic': 'fa-lock',
            'open selected topics': 'fa-lock-open', 'unpin selected topics': 'fa-thumbtack',
            'unpin this topic': 'fa-thumbtack', 'pin selected topics': 'fa-thumbtack',
            'remove announcement': 'fa-bullhorn', 'create announcement': 'fa-bullhorn',
            'mass moving/deleting': 'fa-layer-group', 'add': 'fa-plus',
            'edit profile': 'fa-user-pen', 'edit avatar': 'fa-image-portrait',
            'edit signature': 'fa-signature', 'my album': 'fa-images',
            'ffupload': 'fa-cloud-arrow-up', 'forum settings': 'fa-gear',
            'email settings': 'fa-envelope', 'change password': 'fa-key',
            'log out': 'fa-right-from-bracket', 'send new pm': 'fa-paper-plane',
            'go to inbox': 'fa-inbox', 'edit folders': 'fa-folder-tree',
            'archive messages': 'fa-box-archive', 'contact list': 'fa-address-book',
            'notepad': 'fa-notebook', 'active topics': 'fa-fire',
            'popular topics': 'fa-star', 'subscriptions': 'fa-bell',
            'notification centre': 'fa-bell-on', 'mark all as read': 'fa-check-double',
            'my topics': 'fa-user-pen', 'my posts': 'fa-message',
            'subscribe to the forum': 'fa-bell', 'subscribe': 'fa-bell',
            'site\'s messages': 'fa-shield-halved', 'topics planned': 'fa-calendar-check',
            'notifications from scripts': 'fa-bell', 'website': 'fa-globe',
            'users': 'fa-users', 'graphic': 'fa-palette',
            'additional features': 'fa-plus', 'posts reported': 'fa-flag',
            'scripts and codes': 'fa-code', 'top forum/blog': 'fa-trophy',
            'attachments': 'fa-paperclip', 'chat/tagboard': 'fa-comments',
            'name, categories': 'fa-tag', 'manage sections': 'fa-folder-tree',
            'custom pages': 'fa-file', 'manage blog': 'fa-newspaper',
            'logs and data': 'fa-database', 'logs': 'fa-database',
            'moderation queue': 'fa-list-check', 'stats and options': 'fa-chart-line',
            'transfer sections': 'fa-arrow-right-arrow-left', 'delete site': 'fa-trash',
            'send newsletter': 'fa-envelope-open-text', 'groups': 'fa-user-group',
            'ban': 'fa-ban', 'user approval': 'fa-user-check',
            'validate user': 'fa-user-shield', 'edit user': 'fa-user-pen',
            'user ranks': 'fa-ranking-star', 'avatars and signatures': 'fa-image',
            'mobile/app': 'fa-mobile-screen', 'html code': 'fa-code',
            'colors and styles': 'fa-palette', 'logo and images': 'fa-image',
            'site skin': 'fa-shirt', 'emoticons': 'fa-face-smile',
            'menu': 'fa-bars', 'tabs': 'fa-table-columns',
            'messenger': 'fa-comment', 'topics': 'fa-list',
            'reactions': 'fa-face-smile', 'notifications': 'fa-bell',
            'administration': 'fa-shield-halved', 'moderation': 'fa-gavel',
            'announcement': 'fa-bullhorn', 'unpin': 'fa-thumbtack',
            'pin': 'fa-thumbtack', 'move': 'fa-arrows-left-right',
            'delete': 'fa-trash-can', 'open': 'fa-lock-open',
            'close': 'fa-lock', 'edit': 'fa-pen-to-square'
        };
        for (const k in map) if (l.includes(k)) return map[k];
        return 'fa-circle';
    }

    function extractSearch(menuWrap) {
        const form = menuWrap.querySelector('.right form.search');
        return {
            action: form ? (form.getAttribute('action') || 'https://www.google.com/search') : 'https://www.google.com/search',
            method: form ? (form.getAttribute('method') || 'get') : 'get'
        };
    }

    function extractUser() {
        const mid = getCurrentUserId();
        if (!mid) return null;
        const link = document.querySelector('.menuwrap a[href*="MID="]');
        let username = 'User';
        let avatarSrc = '';
        let profileUrl = '/?act=Profile&MID=' + mid;

        if (link) {
            const nick = link.querySelector('.nick');
            if (nick) username = nick.textContent.trim();
            const img = link.querySelector('.avatar img');
            if (img) avatarSrc = img.getAttribute('data-original') || img.getAttribute('src') || '';
            profileUrl = link.getAttribute('href') || profileUrl;
        } else {
            const img = document.querySelector('.menuwrap .avatar img');
            if (img) avatarSrc = img.getAttribute('data-original') || img.getAttribute('src') || '';
        }
        return { mid, avatarSrc, username, profileUrl };
    }

    // ─── Recursive menu-item extractor ────────────────────────
    function extractItems(ul) {
        const out = [];
        for (const li of ul.children) {
            if (li.tagName !== 'LI') continue;
            if (li.querySelector(':scope > hr')) { out.push({ type: 'separator' }); continue; }
            const a = li.querySelector(':scope > a');
            if (!a) continue;

            const submenu = li.querySelector(':scope > ul');
            
            // ── FIX: ONLY DECLARE em ONCE ──
            const em = a.querySelector('em'); 
            let badge = null;
            let rawLabel = a.textContent.replace(/\s+/g, ' ').trim();
            
            if (em && /^\d+$/.test(em.textContent.trim())) {
                badge = em.textContent.trim();
                rawLabel = rawLabel.replace(badge, '').trim();
            } else {
                const match = rawLabel.match(/\s+(\d+)$/);
                if (match) {
                    badge = match[1];
                    rawLabel = rawLabel.replace(/\s+\d+$/, '').trim();
                }
            }

            const href = a.getAttribute('href') || '';
            const label = getEnglishLabel(rawLabel, href);

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
                    href: href,
                    id: a.getAttribute('id') || '',
                    liClass: li.className || '',
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

    function getEnglishLabel(originalLabel, href, isTopLevel = false) {
        if (!href) href = '';
        const lower = originalLabel.toLowerCase();

        // 1. FIX: Top-level items that share URLs with their submenus
        if (isTopLevel) {
            if (href.includes('act=Msg&CODE=01')) return 'Messenger';
            if (href.includes('act=UserCP&CODE=26')) return 'Topics';
        }

        // 2. Dictionary for submenus (Italian -> English)
        const itToEn = {
            'profilo': 'Profile', 'messaggi': 'Messenger', 'argomenti': 'Topics',
            'reazioni': 'Reactions', 'notifiche': 'Notifications', 'amministrazione': 'Administration',
            'moderazione': 'Moderation', 'sito web': 'Website', 'utenti': 'Users',
            'grafica': 'Graphic', 'funzioni aggiuntive': 'Additional features',
            'segnalazioni': 'Posts reported', 'nome, categorie e indirizzo': 'Name, categories and address',
            'gestione sezioni': 'Manage sections', 'pagine personalizzate': 'Custom pages',
            'gestisci blog': 'Manage Blog', 'log e ripristino dati': 'Logs and data recovery',
            'coda di moderazione': 'Moderation queue', 'statistiche e opzioni': 'Stats and options',
            'sposta sezioni': 'Transfer sections', 'elimina sito': 'Delete site',
            'invia newsletter': 'Send newsletter', 'gruppi': 'Groups', 'ban': 'Ban',
            'approvazione utenti': 'User approval', 'convalida utente': 'Validate user',
            'modifica nome utente': "Edit user's name", 'livelli utente': 'User ranks',
            'avatar e firme': 'Avatars and signatures', 'mobile/app': 'Mobile/App',
            'codice html': 'HTML code', 'colori e stili': 'Colors and styles',
            'logo e immagini': 'Logo and images', 'skin del sito': 'Site skin',
            'emoticon': 'Emoticons', 'menu': 'Menu', 'tabs': 'Tabs',
            'script e codici': 'Scripts and codes', 'top forum/blog': 'Top Forum/Blog',
            'allegati': 'Attachments', 'chat/tagboard': 'Chat/TagBoard',
            'esci': 'Log Out', 'registrati': 'Register', 'accedi': 'Login'
        };

        for (const [it, en] of Object.entries(itToEn)) {
            if (lower === it || lower.includes(it)) return en;
        }

        // 3. URL Fallbacks
        if (href.includes('act=Profile')) return 'Profile';
        if (href.includes('act=Msg&CODE=04')) return 'Send New PM';
        if (href.includes('act=Msg&CODE=01') && lower.includes('inbox')) return 'Go to Inbox';
        if (href.includes('act=Msg&CODE=07')) return 'Edit Folders';
        if (href.includes('act=Msg&CODE=14')) return 'Archive Messages';
        if (href.includes('act=Msg&CODE=02')) return 'Contact List';
        if (href.includes('act=Msg&CODE=16')) return 'Notification centre';
        if (href.includes('act=UserCP&CODE=00')) return 'Notepad';
        if (href.includes('act=UserCP&CODE=01')) return 'Edit Profile info';
        if (href.includes('act=UserCP&CODE=24')) return 'Edit Avatar Settings';
        if (href.includes('act=UserCP&CODE=22')) return 'Edit Signature';
        if (href.includes('act=UserCP&CODE=04')) return 'Forum Settings';
        if (href.includes('act=UserCP&CODE=02')) return 'Email Settings and Notifications';
        if (href.includes('act=UserCP&CODE=28')) return 'Change Password';
        if (href.includes('act=UserCP&CODE=26')) return 'Subscriptions';
        if (href.includes('act=Search&CODE=getactive&pop=1')) return 'Popular topics';
        if (href.includes('act=Search&CODE=getactive')) return 'Active topics';
        if (href.includes('act=Search&CODE=02')) return 'My topics';
        if (href.includes('act=Search') && !href.includes('CODE')) return 'My posts';
        if (href.includes('act=Members&rep=1')) return 'Top Members';
        if (href.includes('act=Members')) return 'Members';
        if (href.includes('act=staff')) return 'Staff';
        if (href.includes('act=modforum')) return 'Name, categories and address';
        if (href.includes('act=modsezioni')) return 'Manage sections';
        if (href.includes('act=modpages')) return 'Custom pages';
        if (href.includes('act=blog')) return 'Manage Blog';
        if (href.includes('act=logs')) return 'Logs and data recovery';
        if (href.includes('act=queue')) return 'Moderation queue';
        if (href.includes('act=stats')) return 'Stats and options';
        if (href.includes('act=transfer')) return 'Transfer sections';
        if (href.includes('act=delforum')) return 'Delete site';
        if (href.includes('act=gruppi')) return 'Groups';
        if (href.includes('act=ban')) return 'Ban';
        if (href.includes('act=userapprove')) return 'User approval';
        if (href.includes('act=convalida')) return 'Validate user';
        if (href.includes('act=modnick')) return "Edit user's name";
        if (href.includes('act=modlivelli')) return 'User ranks';
        if (href.includes('act=avatar')) return 'Avatars and signatures';
        if (href.includes('act=mobile')) return 'Mobile/App';
        if (href.includes('act=modhtml')) return 'HTML code';
        if (href.includes('act=modcss')) return 'Colors and styles';
        if (href.includes('act=modimg')) return 'Logo and images';
        if (href.includes('act=modskin')) return 'Site skin';
        if (href.includes('act=modemo')) return 'Emoticons';
        if (href.includes('act=modmenu')) return 'Menu';
        if (href.includes('act=modtabs')) return 'Tabs';
        if (href.includes('act=link')) return 'Scripts and codes';
        if (href.includes('act=top')) return 'Top Forum/Blog';
        if (href.includes('act=allegati')) return 'Attachments';
        if (href.includes('act=addtagboard')) return 'Chat/TagBoard';

        return originalLabel;
    }

    // ─── Top-level actions (Messenger / Topics / … / Admin) ──
    function extractTopActions(menuWrap, userLink) {
        const out = [];
        for (const li of menuWrap.querySelectorAll('.left > li.menu')) {
            const a = li.querySelector(':scope > a');
            if (!a || a === userLink) continue;

            const submenu = li.querySelector(':scope > ul');
            
            // ── FIX: ONLY DECLARE em ONCE ──
            const em = a.querySelector('em');
            let badge = null;
            let rawLabel = a.textContent.replace(/\s+/g, ' ').trim();
            
            if (em && /^\d+$/.test(em.textContent.trim())) {
                badge = em.textContent.trim();
                rawLabel = rawLabel.replace(badge, '').trim();
            } else {
                const match = rawLabel.match(/\s+(\d+)$/);
                if (match) {
                    badge = match[1];
                    rawLabel = rawLabel.replace(/\s+\d+$/, '').trim();
                }
            }

            const href = a.getAttribute('href') || '';
            const label = getEnglishLabel(rawLabel, href, true);

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
                    href: href,
                    id: a.getAttribute('id') || '',
                    liClass: li.className || '',
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

    function extractGuest(menuWrap) {
        const socials = [];
        menuWrap.querySelectorAll('.login_with button[data-url]').forEach(btn => {
            const service = btn.getAttribute('data-service');
            const url = btn.getAttribute('data-url');
            if (service && url) socials.push({ service, url });
        });

        if (!document.getElementById('legacy-login-puppet')) {
            const legacyForm = menuWrap.querySelector('#loginForm');
            if (legacyForm) {
                const clone = legacyForm.cloneNode(true);
                clone.id = 'legacy-login-puppet';
                clone.style.display = 'none';
                document.body.appendChild(clone);
            }
        }
        return { socials };
    }

    function buildDropdownBody(items) {
        const frag = document.createDocumentFragment();
        items.forEach(item => {
            if (item.type === 'separator') {
                frag.appendChild(h('hr', { className: 'mfn-sep' }));
                return;
            }
            if (item.type === 'submenu') {
                const det = h('details', { className: 'mfn-submenu' });
                
                // FIXED SYNTAX ERROR HERE
                const summary = h('summary', { 
                    className: 'mfn-submenu-summary',
                    'data-menu-label': item.label 
                });
                
                summary.innerHTML = 
                    '<span class="mfn-submenu-left">' + icon(item.icon) + ' ' + escapeHtml(item.label) + '</span>' +
                    (item.badge ? '<span class="mfn-badge">' + escapeHtml(item.badge) + '</span>' : '') +
                    '<i class="fa-regular fa-angle-down mfn-chev" aria-hidden="true"></i>';
                
                det.appendChild(summary);
                const body = h('div', { className: 'mfn-submenu-body' });
                body.appendChild(buildDropdownBody(item.items));
                det.appendChild(body);
                frag.appendChild(det);
                return;
            }
            const a = h('a', {
                className: 'mfn-dd-link' + (item.bold ? ' mfn-dd-link--bold' : '') + (item.className ? ' ' + item.className : ''),
                href: item.href || undefined, onclick: item.onclick || undefined,
                role: item.role || undefined, tabindex: item.tabindex || undefined
            });
            if (item.dataToggle) a.setAttribute('data-toggle', item.dataToggle);
            // ── LEGACY BRIDGE ──
            if (item.dataToggle) {
                a.setAttribute('data-legacy-selector', `.menuwrap [data-toggle="${item.dataToggle}"]`);
            } else if (item.className && item.className.includes('sn-open-modal')) {
                a.setAttribute('data-legacy-selector', '.menuwrap .sn-open-modal');
            } else if (item.label === 'Posts reported' || (item.liClass && item.liClass.includes('report_menu'))) {
                a.setAttribute('data-legacy-selector', '.menuwrap .report_menu a');
            }
            // ───────────────────
            a.innerHTML =
                '<span class="mfn-dd-link-left">' + icon(item.icon) + ' ' + escapeHtml(item.label) + '</span>' +
                (item.badge ? '<span class="mfn-badge">' + escapeHtml(item.badge) + '</span>' : '');
            frag.appendChild(a);
        });
        return frag;
    }

    function buildTopAction(item) {
        if (item.type === 'submenu') {
            const wrap = h('div', { className: 'mfn-dropdown' });
            const trigger = h('button', {
                type: 'button', 
                className: 'mfn-action mfn-action--has-menu',
                'aria-haspopup': 'true', 
                'aria-expanded': 'false',
                'data-menu-label': item.label, 
                'data-tippy-content': item.label, // <── CHANGED
                innerHTML: icon(item.icon) + '<span class="mfn-action-label">' + escapeHtml(item.label) + '</span>' +
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
            role: item.role || undefined, tabindex: item.tabindex || undefined,
            href: tag === 'a' ? (item.href || '#') : undefined,
            onclick: item.onclick || undefined, 'data-toggle': item.dataToggle || undefined,
            'data-menu-label': item.label, // <── ADD THIS LINE
            'data-tippy-content': item.label,
            innerHTML: icon(item.icon) + '<span class="mfn-action-label">' + escapeHtml(item.label) + '</span>' +
                (item.badge ? '<span class="mfn-badge">' + escapeHtml(item.badge) + '</span>' : '')
        };
        // ── LEGACY BRIDGE ──
        if (item.id && item.id.startsWith('n')) {
            attrs['data-legacy-selector'] = '#' + item.id;
        } else if (item.label === 'Notifications') {
            attrs['data-legacy-selector'] = '.menuwrap a[id^="n"]';
        } else if (item.dataToggle) {
            // Covers Reactions (data-toggle="emoji-notice-modal") and others
            attrs['data-legacy-selector'] = `.menuwrap [data-toggle="${item.dataToggle}"]`;
        } else if (item.liClass && item.liClass.includes('st-emoji-notice')) {
            attrs['data-legacy-selector'] = '.menuwrap .st-emoji-notice a';
        }
        // ───────────────────
        return h(tag, attrs);
    }
   
    function buildUserDropdown(user, items, apiUser) {
        const wrap = h('div', { className: 'mfn-dropdown mfn-user-dropdown' });
        const avatarHtml = generateAvatarHtml(apiUser, user.username, user.mid, 32);
        const groupClass = getGroupClass(apiUser);

        const trigger = h('button', { type: 'button', className: 'mfn-user-trigger', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
        trigger.innerHTML = `<span class="mfn-avatar ${groupClass}">${avatarHtml}</span>` +
            '<span class="mfn-user-name">' + escapeHtml(user.username) + '</span>' +
            '<i class="fa-regular fa-angle-down mfn-chev" aria-hidden="true"></i>';

        const panel = h('div', { className: 'mfn-dropdown-panel mfn-user-panel' });
        const head = h('div', { className: 'mfn-user-panel-head' });
        const lgAvatarHtml = generateAvatarHtml(apiUser, user.username, user.mid, 44);
        head.innerHTML = `<span class="mfn-avatar mfn-avatar--lg ${groupClass}">${lgAvatarHtml}</span>` +
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

    function buildGuestLoginBar(guest) {
        const wrap = h('div', { className: 'mfn-guest-login-bar' });
        const form = h('form', { className: 'mfn-login-inline' });
        form.innerHTML = `
            <input type="text" name="username" placeholder="E-mail or Nickname" autocomplete="username" required>
            <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
            <button type="submit" class="mfn-btn mfn-btn--primary">${icon('fa-right-to-bracket')} Log In</button>
        `;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const u = form.querySelector('input[name="username"]').value;
            const p = form.querySelector('input[name="password"]').value;
            const puppet = document.getElementById('legacy-login-puppet');
            if (puppet) {
                puppet.querySelector('input[name="UserName"]').value = u;
                puppet.querySelector('input[name="PassWord"]').value = p;
                puppet.querySelector('input[name="UserSafe"]').value = '1'; 
                puppet.querySelector('input[type="submit"]').click();
            } else {
                window.location.href = CONFIG.LOGIN_URL;
            }
        });

        wrap.appendChild(form);

        wrap.appendChild(h('a', { className: 'mfn-btn mfn-btn--ghost', href: CONFIG.REGISTER_URL, innerHTML: icon('fa-user-plus') + ' Register' }));

        if (guest.socials.length) {
            const socialWrap = h('div', { className: 'mfn-dropdown' });
            const socialTrigger = h('button', {
                type: 'button', className: 'mfn-action mfn-action--ghost mfn-social-trigger',
                'aria-haspopup': 'true', 'aria-expanded': 'false', 
                'data-tippy-content': 'Alternative login methods', // <── CHANGED
                innerHTML: icon('fa-right-left') + '<span class="mfn-action-label">Social</span>'
            });
            
            const socialPanel = h('div', { className: 'mfn-dropdown-panel mfn-social-panel' });
            const socialRow = h('div', { className: 'mfn-social-row' });
            guest.socials.forEach(s => {
                const btn = h('button', { type: 'button', className: 'mfn-social-btn', 'data-service': s.service, 'data-url': s.url });
                let brandIcon = s.service === 'google' ? '<i class="fa-brands fa-google"></i>' :
                                s.service === 'facebook' ? '<i class="fa-brands fa-facebook-f"></i>' :
                                s.service === 'telegram' ? '<i class="fa-brands fa-telegram"></i>' : '<i class="fa-regular fa-globe"></i>';
                btn.innerHTML = brandIcon + '<span>' + escapeHtml(s.service) + '</span>';
                socialRow.appendChild(btn);
            });
            socialPanel.appendChild(socialRow);
            socialWrap.appendChild(socialTrigger);
            socialWrap.appendChild(socialPanel);
            wrap.appendChild(socialWrap);
        }

        const mobileTrigger = h('button', { type: 'button', className: 'mfn-action mfn-action--primary mfn-mobile-login-trigger', innerHTML: icon('fa-right-to-bracket') + '<span class="mfn-action-label">Login</span>' });
        mobileTrigger.addEventListener('click', () => { window.location.href = CONFIG.LOGIN_URL; });
        wrap.appendChild(mobileTrigger);

        return wrap;
    }

    function buildMobileSearchToggle(searchForm) {
        const searchToggle = h('button', {
            type: 'button', className: 'mfn-action mfn-search-toggle',
            'aria-label': 'Toggle search', innerHTML: '<i class="fa-regular fa-magnifying-glass" aria-hidden="true"></i>'
        });
        searchToggle.style.display = 'none';
        searchToggle.addEventListener('click', () => {
            searchForm.classList.toggle('mfn-search--mobile-open');
        });
        return searchToggle;
    }

    // ─── Build: full nav ─────────────────────────────────────
    function buildNav(data) {
        const nav = h('nav', { id: CONFIG.NAV_ID, className: 'mfn', 'aria-label': 'Primary' });
        const inner = h('div', { className: 'mfn-inner' });

        inner.appendChild(h('a', { className: 'mfn-logo', href: '/', 'aria-label': 'Home', innerHTML: LOGO_SVG }));

        let searchForm = null;

        if (data.loggedIn) {
            const searchWrap = h('div', { className: 'mfn-search-wrap' });
            const scopeWrap = h('div', { className: 'mfn-dropdown mfn-scope-dropdown' });
            
            const scopeTrigger = h('button', { type: 'button', className: 'mfn-scope-trigger', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
            scopeTrigger.innerHTML = '<span class="mfn-scope-label"><i class="fa-regular fa-folder" aria-hidden="true"></i> Forum</span><i class="fa-regular fa-angle-down mfn-chev" aria-hidden="true"></i>';

            const scopePanel = h('div', { className: 'mfn-dropdown-panel mfn-scope-panel' });
            
            const scopeOptions = [
                { value: 'forum', label: 'Forum', icon: 'fa-regular fa-folder' },
                { value: 'user', label: 'Users', icon: 'fa-regular fa-user' },
                { value: 'section', label: 'Sections', icon: 'fa-regular fa-layer-group' }
            ];

            scopeOptions.forEach(opt => {
                const btn = h('button', { type: 'button', className: 'mfn-dd-link mfn-scope-option', 'data-value': opt.value });
                btn.innerHTML = `<span class="mfn-dd-link-left">${opt.icon ? `<i class="${opt.icon}"></i>` : ''} ${opt.label}</span>`;
                scopePanel.appendChild(btn);
            });

            scopeWrap.appendChild(scopeTrigger);
            scopeWrap.appendChild(scopePanel);
            searchWrap.appendChild(scopeWrap);

            // ── FIXED FORM SETUP ──
            const form = h('form', {
                className: 'mfn-search',
                action: window.location.origin + '/', // Always submit to current domain
                method: 'post',
                role: 'search'
            });
            searchForm = form; 
            
            form.innerHTML =
                '<label class="mfn-search-label" for="mfn-search-input">Search</label>' +
                '<i class="fa-regular fa-magnifying-glass mfn-search-icon" aria-hidden="true"></i>' +
                '<input id="mfn-search-input" type="search" name="keywords" ' +
                    'placeholder="Search forum threads..." autocomplete="off" maxlength="150" required>' +
                '<input type="hidden" name="act" value="Search">' +
                '<input type="hidden" name="CODE" value="01">' +
                (data.sToken ? `<input type="hidden" name="s" value="${escapeHtml(data.sToken)}">` : '');
                
            searchWrap.appendChild(form);

            const autocompletePanel = h('div', { className: 'mfn-search-autocomplete' });
            searchWrap.appendChild(autocompletePanel);

            let currentScope = 'forum';
            let searchTimeout = null;
            let searchAbort = null;
            let acResults = [];
            let acFocusIndex = -1;

            const searchInput = form.querySelector('#mfn-search-input');

            // Prevent native form submit when filtering sections
            form.addEventListener('submit', (e) => {
                if (currentScope === 'section') {
                    e.preventDefault();
                    const first = autocompletePanel.querySelector('.mfn-ac-item');
                    if (first) first.click();
                }
            });

            function closeAutocomplete() {
                autocompletePanel.classList.remove('is-active');
                acFocusIndex = -1;
            }

            function renderAutocomplete() {
                if (!acResults.length && currentScope !== 'section') {
                    closeAutocomplete();
                    return;
                }
                autocompletePanel.innerHTML = '';
                acFocusIndex = -1;

                if (currentScope === 'section') {
                    cachedSections.filter(s => s.name.toLowerCase().includes(searchInput.value.trim().toLowerCase())).forEach((sec, i) => {
                        const item = h('a', { href: `/?f=${sec.id}`, className: 'mfn-ac-item', 'data-index': i });
                        item.innerHTML = `<span class="mfn-ac-icon"><i class="fa-regular fa-folder"></i></span><span class="mfn-ac-name">${escapeHtml(sec.name)}</span>`;
                        autocompletePanel.appendChild(item);
                    });
                } else if (currentScope === 'user') {
                    acResults.forEach((user, i) => {
                        const profileUrl = `/?act=Profile&MID=${user.id}`;
                        const username = user.name || user.nickname || 'User';
                        const avatarHtml = generateAvatarHtml(user, username, user.id, 26);
                        const groupClass = getGroupClass(user);

                        const item = h('div', { className: 'mfn-ac-item', 'data-index': i });
                        item.innerHTML = `
                            <span class="mfn-ac-avatar-wrap ${groupClass}">${avatarHtml}</span>
                            <span class="mfn-ac-name">${escapeHtml(username)}</span>
                            <button type="button" class="mfn-ac-topics-btn" title="View topics by ${escapeHtml(username)}" data-mid="${user.id}">
                                <i class="fa-regular fa-list" aria-hidden="true"></i>
                            </button>
                        `;
                        
                        item.querySelector('.mfn-ac-name').addEventListener('click', () => { window.location.href = profileUrl; });
                        
                        item.querySelector('.mfn-ac-topics-btn').addEventListener('click', async (e) => {
                            e.preventDefault(); e.stopPropagation();
                            autocompletePanel.innerHTML = '<div class="mfn-ac-loading"><i class="fa-regular fa-spinner fa-spin"></i> Loading topics...</div>';
                            try {
                                const res = await fetch(`/api.php?starter=${user.id}&threads=1`, { credentials: 'same-origin' });
                                const data = await res.json();
                                if (data && data.threads && data.threads.length > 0) {
                                    autocompletePanel.innerHTML = `<div class="mfn-ac-header">Topics by ${escapeHtml(username)}</div>`;
                                    data.threads.forEach(t => {
                                        const tItem = h('a', { href: `/?t=${t.id}`, className: 'mfn-ac-topic-item' });
                                        tItem.innerHTML = `<span class="mfn-ac-topic-title">${escapeHtml(t.title)}</span><span class="mfn-ac-topic-section">${escapeHtml(t.section_name)}</span>`;
                                        autocompletePanel.appendChild(tItem);
                                    });
                                } else {
                                    autocompletePanel.innerHTML = '<div class="mfn-ac-empty">No topics found.</div>';
                                }
                            } catch (err) { autocompletePanel.innerHTML = '<div class="mfn-ac-empty">Failed to load topics.</div>'; }
                        });
                        autocompletePanel.appendChild(item);
                    });
                }

                if (autocompletePanel.children.length > 0) {
                    autocompletePanel.classList.add('is-active');
                } else {
                    closeAutocomplete();
                }
            }

            function updateAcFocus(items) {
                items.forEach((item, i) => { item.classList.toggle('is-focused', i === acFocusIndex); });
                if (items[acFocusIndex]) items[acFocusIndex].scrollIntoView({ block: 'nearest' });
            }

            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();
                clearTimeout(searchTimeout);
                if (searchAbort) searchAbort.abort();
                
                if (currentScope === 'section') {
                    renderAutocomplete(); 
                    return;
                }

                closeAutocomplete();
                if (query.length < 2) return;

                searchTimeout = setTimeout(async () => {
                    searchAbort = new AbortController();
                    try {
                        const res = await fetch(`/api.php?search&name=${encodeURIComponent(query)}&n=10&cookie=1`, {
                            credentials: 'include', signal: searchAbort.signal
                        });
                        const data = await res.json();
                        acResults = (data && data.users) ? data.users : [];
                        renderAutocomplete();
                    } catch (err) {
                        if (err.name !== 'AbortError') console.warn('[TopMenu] Search failed:', err);
                    }
                }, 300);
            });

            searchInput.addEventListener('keydown', (e) => {
                if (!autocompletePanel.classList.contains('is-active')) return;
                const items = autocompletePanel.querySelectorAll('.mfn-ac-item');
                if (!items.length) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault(); acFocusIndex = (acFocusIndex + 1) % items.length; updateAcFocus(items);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault(); acFocusIndex = (acFocusIndex - 1 + items.length) % items.length; updateAcFocus(items);
                } else if (e.key === 'Enter' && acFocusIndex >= 0) {
                    e.preventDefault(); items[acFocusIndex].click();
                } else if (e.key === 'Escape') {
                    closeAutocomplete();
                }
            });

            searchInput.addEventListener('blur', () => { setTimeout(closeAutocomplete, 200); });

            scopePanel.addEventListener('click', async (e) => {
                const btn = e.target.closest('.mfn-scope-option');
                if (!btn) return;
                
                e.preventDefault();
                const scope = btn.dataset.value;
                const label = btn.textContent.trim();
                const iconHTML = btn.querySelector('i') ? btn.querySelector('i').outerHTML : '';
                
                scopeTrigger.querySelector('.mfn-scope-label').innerHTML = iconHTML + ' ' + label;
                scopeWrap.classList.remove(CONFIG.OPEN_CLASS);
                scopeTrigger.setAttribute('aria-expanded', 'false');

                currentScope = scope;
                searchInput.value = '';
                closeAutocomplete();

                // Reset hidden inputs
                form.querySelectorAll('input[type="hidden"]').forEach(el => el.remove());

                if (scope === 'forum') {
                    form.action = window.location.origin + '/';
                    form.method = 'post';
                    searchInput.name = 'keywords';
                    searchInput.placeholder = 'Search forum threads...';
                    form.insertAdjacentHTML('beforeend', `<input type="hidden" name="act" value="Search"><input type="hidden" name="CODE" value="01">${data.sToken ? `<input type="hidden" name="s" value="${escapeHtml(data.sToken)}">` : ''}`);
                } else if (scope === 'user') {
                    form.action = 'https://www.forumcommunity.net/';
                    form.method = 'get';
                    searchInput.name = 'keywords';
                    searchInput.placeholder = 'Search members...';
                    form.insertAdjacentHTML('beforeend', `<input type="hidden" name="act" value="cerca"><input type="hidden" name="select" value="utente">`);
                } else if (scope === 'section') {
                    form.action = 'javascript:void(0)';
                    form.method = 'get';
                    searchInput.name = 'dummy';
                    searchInput.placeholder = 'Filter sections...';
                    
                    if (!cachedSections) {
                        searchInput.placeholder = 'Loading sections...';
                        try {
                            const res = await fetch('/api.php');
                            const data = await res.json();
                            cachedSections = data.sections || [];
                        } catch (err) { cachedSections = []; }
                    }
                    searchInput.placeholder = 'Filter sections...';
                }
                
                searchInput.focus();
            });

            inner.appendChild(searchWrap);
            
        } else {
            inner.appendChild(buildGuestLoginBar(data.guest));
        }

        const actions = h('div', { className: 'mfn-actions' });

        if (data.loggedIn && searchForm) actions.appendChild(buildMobileSearchToggle(searchForm));

        const themeToggle = h('button', { type: 'button', className: 'mfn-action mfn-theme-toggle', 'data-theme-toggle': '', 'aria-label': 'Toggle theme', 'data-tippy-content': 'Toggle theme' });
        themeToggle.innerHTML = '<i class="fa-regular fa-sun-bright" aria-hidden="true"></i>';
        actions.appendChild(themeToggle);

        if (data.loggedIn) {
            data.actions.forEach(item => actions.appendChild(buildTopAction(item)));
            actions.appendChild(buildUserDropdown(data.user, data.userDropdown, data.apiUser)); 
        }

        inner.appendChild(actions);
        nav.appendChild(inner);
        return nav;
    }

    function onScroll() {
        const y = window.scrollY;
        if (!navEl) return;
        if (y < CONFIG.SCROLL_THRESHOLD) {
            navEl.classList.remove(CONFIG.HIDDEN_CLASS, CONFIG.SCROLLED_CLASS);
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
        navEl.addEventListener('click', (e) => {
            // ── LEGACY CLICK BRIDGE ──
            const bridge = e.target.closest('[data-legacy-selector]');
            if (bridge) {
                e.preventDefault();
                e.stopPropagation();
                closeAllDropdowns(); // Close our modern dropdown
                
                const legacySelector = bridge.getAttribute('data-legacy-selector');
                const legacyEl = document.querySelector(legacySelector);
                if (legacyEl) {
                    legacyEl.click(); // Trigger the original forum script
                } else {
                    console.warn('[TopMenu] Legacy target not found:', legacySelector);
                }
                return;
            }
            // ─────────────────────────

            const trigger = e.target.closest('.mfn-user-trigger, .mfn-action--has-menu, .mfn-action--primary, .mfn-scope-trigger, .mfn-social-trigger');
            if (trigger && navEl.contains(trigger)) {
                const dd = trigger.closest('.mfn-dropdown');
                if (!dd || !dd.querySelector('.mfn-dropdown-panel')) return;
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

            const social = e.target.closest('.mfn-social-btn[data-service][data-url]');
            if (social) {
                e.preventDefault();
                document.cookie = 'social-login=' + social.dataset.service + '; expires=Wed, 1 Jan 2030 00:00:00 GMT; path=/;';
                window.location.href = social.dataset.url;
            }
        });

        document.addEventListener('click', (e) => {
            if (navEl && !navEl.contains(e.target)) {
                closeAllDropdowns();
                openDropdownTrigger = null;
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeAllDropdowns();
                openDropdownTrigger = null;
            }
        });
    }

    async function init() {
        const menuWrap = document.querySelector(CONFIG.LEGACY_MENU_SELECTOR);
        if (!menuWrap || document.getElementById(CONFIG.NAV_ID)) return;

        const loggedIn = isLoggedIn();
        const user = loggedIn ? extractUser() : null;
        
        let apiUser = null;
        if (user && user.mid) {
            apiUser = await fetchUserData(user.mid);
            if (apiUser) {
                user.username = apiUser.nickname || user.username;
                user.avatarSrc = apiUser.avatar || user.avatarSrc;
            }
        }

        const userLink = menuWrap.querySelector('.left .menu > a[href*="act=Profile"]');
        
        // ── EXTRACT THE SECURITY TOKEN ──
        // ForumFree puts this token in the legacy menu to prevent CSRF attacks.
        // We need it to make the native search work.
        const sToken = menuWrap.querySelector('input[name="s"]')?.value || '';
        
        const data = {
            loggedIn, 
            search: extractSearch(menuWrap), 
            user, 
            apiUser,
            sToken, // Pass it to buildNav
            userDropdown: loggedIn && userLink && userLink.nextElementSibling ? extractItems(userLink.nextElementSibling) : [],
            actions: loggedIn ? extractTopActions(menuWrap, userLink) : [],
            guest: !loggedIn ? extractGuest(menuWrap) : null
        };

        navEl = buildNav(data);
        menuWrap.parentNode.insertBefore(navEl, menuWrap);
        menuWrap.setAttribute('aria-hidden', 'true');

        // ── FIX: Start polling for Tippy ──
        initHeaderTippys(); 
        attachEventDelegation();
        window.addEventListener('scroll', requestScroll, { passive: true });

        function syncBadges() {
            menuWrap.querySelectorAll('.left > li.menu > a').forEach(a => {
                let rawLabel = a.textContent.replace(/\s+/g, ' ').trim();
                const em = a.querySelector('em');
                let badge = null;
                
                if (em && /^\d+$/.test(em.textContent.trim())) {
                    badge = em.textContent.trim();
                    rawLabel = rawLabel.replace(badge, '').trim();
                } else {
                    // Check for trailing numbers (Reactions plugin)
                    const match = rawLabel.match(/\s+(\d+)$/);
                    if (match) {
                        badge = match[1];
                        rawLabel = rawLabel.replace(/\s+\d+$/, '').trim();
                    }
                }

                const href = a.getAttribute('href') || '';
                const label = getEnglishLabel(rawLabel, href, true);
                const modernEl = navEl.querySelector(`.mfn-action[data-menu-label="${label}"]`);
                
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
                            badgeEl = document.createElement('span'); badgeEl.className = 'mfn-badge';
                            const chev = modernEl.querySelector('.mfn-chev');
                            if (chev) modernEl.insertBefore(badgeEl, chev); else modernEl.appendChild(badgeEl);
                        }
                        badgeEl.textContent = badge;
                    } else if (badgeEl) { badgeEl.remove(); }
                }
            });
        }

        // ── 1. Initial Badge Sync ──
        syncBadges();

        // ── 2. Submenu Rebuilder (Fixes late plugin injections) ──
        function rebuildSubmenus() {
            menuWrap.querySelectorAll('.submenu').forEach(legacySub => {
                const legacyLink = legacySub.querySelector(':scope > a');
                if (!legacyLink) return;
                
                let rawLabel = legacyLink.textContent.replace(/\s+/g, ' ').trim();
                const em = legacyLink.querySelector('em');
                if (em) rawLabel = rawLabel.replace(em.textContent.trim(), '').trim();
                
                const label = getEnglishLabel(rawLabel, '', false);
                const legacyUl = legacySub.querySelector(':scope > ul');
                if (!legacyUl) return;

                const modernSummary = navEl.querySelector(`.mfn-submenu-summary[data-menu-label="${label}"]`);
                if (modernSummary) {
                    const modernBody = modernSummary.nextElementSibling;
                    if (modernBody && modernBody.classList.contains('mfn-submenu-body')) {
                        modernBody.innerHTML = '';
                        modernBody.appendChild(buildDropdownBody(extractItems(legacyUl)));
                    }
                }
            });
        }

        // ── 3. The Observer ──
        const badgeObserver = new MutationObserver((mutations) => {
            let needsRebuild = false;
            
            for (const m of mutations) {
                // Check if a plugin just injected a new <li> into the legacy menu
                if (m.type === 'childList' && m.addedNodes.length > 0) {
                    const addedLi = Array.from(m.addedNodes).find(n => n.nodeType === 1 && n.tagName === 'LI');
                    if (addedLi && m.target.tagName === 'UL') {
                        needsRebuild = true;
                    }
                }
            }

            if (needsRebuild) rebuildSubmenus();

            clearTimeout(badgeObserver._timer);
            badgeObserver._timer = setTimeout(syncBadges, 100);
        });
        
        badgeObserver.observe(menuWrap, { childList: true, subtree: true, characterData: true });

        console.log('[TopMenu] Modern nav built (' + (loggedIn ? 'member' : 'guest') + ')');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    return { init };
})();
