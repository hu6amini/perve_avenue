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

    // ─── Login state detection ────────────────────────────────
    function isLoggedIn(menuWrap) {
        return !!menuWrap.querySelector('.left .menu > a[href*="act=Profile"]');
    }

    // ─── Icon mapping ─────────────────────────────────────────
    function iconForLabel(label) {
        const l = (label || '').toLowerCase();
        const map = {
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
            'administration': 'fa-shield-halved'
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
        const img = link.querySelector('.avatar img');
        const nick = link.querySelector('.nick');
        return {
            avatarSrc: img ? (img.getAttribute('data-original') || img.getAttribute('src') || '') : '',
            username: nick ? nick.textContent.trim() : 'User',
            profileUrl: link.getAttribute('href') || '#'
        };
    }

    // ─── Recursive menu-item extractor ────────────────────────
    // Returns [{type:'link'|'submenu'|'separator', ...}]
    function extractItems(ul) {
        const out = [];
        for (const li of ul.children) {
            if (li.tagName !== 'LI') continue;
            // native separator (in legacy markup: <li><hr …></li>)
            if (li.querySelector(':scope > hr')) { out.push({ type: 'separator' }); continue; }
            const a = li.querySelector(':scope > a');
            if (!a) continue;

            const label = a.textContent.replace(/\s+/g, ' ').trim();
            const submenu = li.querySelector(':scope > ul');
            const em = a.querySelector('em');
            const badge = em && /^\d+$/.test(em.textContent.trim()) ? em.textContent.trim() : null;

            if (submenu) {
                out.push({
                    type: 'submenu',
                    label,
                    icon: iconForLabel(label),
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
            const label = a.textContent.replace(/\s+/g, ' ').trim().replace(/\s*\d+$/, '');
            const submenu = li.querySelector(':scope > ul');
            const em = a.querySelector('em');
            const badge = em && /^\d+$/.test(em.textContent.trim()) ? em.textContent.trim() : null;

            if (submenu) {
                out.push({
                    type: 'submenu',
                    label,
                    icon: iconForLabel(label),
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
                det.appendChild(h('summary', { className: 'mfn-submenu-summary' }, [
                    h('span', { className: 'mfn-submenu-left', innerHTML: icon(item.icon) + ' ' + escapeHtml(item.label) }),
                    '<i class="fa-regular fa-chevron-down mfn-chev" aria-hidden="true"></i>'
                ]));
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
                title: item.label, 
                innerHTML: icon(item.icon) +
                    '<span class="mfn-action-label">' + escapeHtml(item.label) + '</span>' +
                    (item.badge ? '<span class="mfn-badge">' + escapeHtml(item.badge) + '</span>' : '') +
                    '<i class="fa-regular fa-chevron-down mfn-chev" aria-hidden="true"></i>'
            });
            const panel = h('div', { className: 'mfn-dropdown-panel' });
            panel.appendChild(buildDropdownBody(item.items));
            wrap.appendChild(trigger);
            wrap.appendChild(panel);
            return wrap;
        }

        // Simple link — but with optional data-toggle / onclick / special classes
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
    function buildUserDropdown(user, items) {
        const wrap = h('div', { className: 'mfn-dropdown mfn-user-dropdown' });

        const avatarHtml = user.avatarSrc
            ? '<img src="' + escapeHtml(user.avatarSrc) + '" alt="" loading="lazy" class="mfn-avatar-img">'
            : '<span class="mfn-avatar-fallback">' + escapeHtml(user.username.charAt(0).toUpperCase()) + '</span>';

        const trigger = h('button', {
            type: 'button',
            className: 'mfn-user-trigger',
            'aria-haspopup': 'true',
            'aria-expanded': 'false'
        });
        trigger.innerHTML =
            '<span class="mfn-avatar">' + avatarHtml + '</span>' +
            '<span class="mfn-user-name">' + escapeHtml(user.username) + '</span>' +
            '<i class="fa-regular fa-chevron-down mfn-chev" aria-hidden="true"></i>';

        const panel = h('div', { className: 'mfn-dropdown-panel mfn-user-panel' });
        const head = h('div', { className: 'mfn-user-panel-head' });
        head.innerHTML =
            '<span class="mfn-avatar mfn-avatar--lg">' + avatarHtml + '</span>' +
            '<div class="mfn-user-panel-meta">' +
                '<a class="mfn-user-panel-name" href="' + escapeHtml(user.profileUrl) + '">' +
                    escapeHtml(user.username) +
                '</a>' +
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

        // Login button opens a small panel with social options
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
        // Default state
        scopeTrigger.innerHTML = '<span class="mfn-scope-label"><i class="fa-regular fa-folder" aria-hidden="true"></i> Forum</span><i class="fa-regular fa-angle-down mfn-chev" aria-hidden="true"></i>';

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

        // 3. The Switching Logic (Custom Dropdown)
        scopePanel.addEventListener('click', (e) => {
            const btn = e.target.closest('.mfn-scope-option');
            if (!btn) return;
            
            e.preventDefault();
            const scope = btn.dataset.value;
            const label = btn.textContent.trim();
            const iconHTML = btn.querySelector('i') ? btn.querySelector('i').outerHTML : '';
            
            // Update trigger UI
            scopeTrigger.querySelector('.mfn-scope-label').innerHTML = iconHTML + ' ' + label;
            
            // Close dropdown
            scopeWrap.classList.remove(CONFIG.OPEN_CLASS);
            scopeTrigger.setAttribute('aria-expanded', 'false');

            // Update Form Logic
            const input = form.querySelector('input[name="keywords"], input[name="q"], input[name="search"]');
            form.querySelectorAll('input[type="hidden"]').forEach(el => el.remove());

            if (scope === 'forum') {
                form.action = 'https://perveavenue.forumcommunity.net/';
                form.method = 'post';
                input.name = 'keywords';
                input.placeholder = 'Search forum threads...';
                form.insertAdjacentHTML('beforeend', `<input type="hidden" name="act" value="Search"><input type="hidden" name="CODE" value="01">`);
            } else if (scope === 'google') {
                form.action = 'https://www.google.com/search';
                form.method = 'get';
                input.name = 'q';
                input.placeholder = 'Search on Google...';
                form.insertAdjacentHTML('beforeend', `<input type="hidden" name="as_sitesearch" value="${CONFIG.SITE_FILTER}">`);
            } else if (scope === 'user') {
                form.action = 'https://www.forumcommunity.net/'; 
                form.method = 'get';
                input.name = 'act';
                input.placeholder = 'Search members...';
                form.insertAdjacentHTML('beforeend', `<input type="hidden" name="select" value="utente">`);
            }
            
            input.value = '';
            input.focus(); // Keep focus in the search bar for a seamless experience
        });

        inner.appendChild(searchWrap);
        // ─────────────────────────────────────────────────────────

        // Actions
        const actions = h('div', { className: 'mfn-actions' });

        // ── NEW: Theme Toggle ──────────────────────────────────
        // theme.js uses event delegation, so it will automatically 
        // hook into this button as long as it has [data-theme-toggle].
        const themeToggle = h('button', {
            type: 'button',
            className: 'mfn-action mfn-theme-toggle',
            'data-theme-toggle': '',
            'aria-label': 'Toggle theme',
            title: 'Toggle theme'
        });
        // theme.js will automatically sync the icon class (sun/moon) on load.
        themeToggle.innerHTML = '<i class="fa-regular fa-sun-bright" aria-hidden="true"></i>'; 
        
        actions.appendChild(themeToggle);
        // ───────────────────────────────────────────────────────

        if (data.loggedIn) {
            data.actions.forEach(item => actions.appendChild(buildTopAction(item)));
            actions.appendChild(buildUserDropdown(data.user, data.userDropdown));
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
                '.mfn-user-trigger, .mfn-action--has-menu, .mfn-action--primary'
            );
            if (trigger && navEl.contains(trigger)) {
                const dd = trigger.closest('.mfn-dropdown');
                if (!dd) return;
                // Only treat these as dropdown toggles if they actually open a panel
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

            // Append a search toggle button for mobile
const searchToggle = document.createElement('button');
searchToggle.className = 'mfn-action mfn-search-toggle';
searchToggle.setAttribute('aria-label', 'Toggle search');
searchToggle.innerHTML = '<i class="fa-regular fa-magnifying-glass"></i>';
searchToggle.style.display = 'none'; // shown via CSS media query
document.querySelector('.mfn-actions').prepend(searchToggle);

searchToggle.addEventListener('click', () => {
    document.querySelector('.mfn-search').classList.toggle('mfn-search--mobile-open');
});           

            // Social login click → replicate legacy cookie + redirect
            const social = e.target.closest('.mfn-social-btn[data-service][data-url]');
            if (social) {
                e.preventDefault();
                document.cookie = 'social-login=' + social.dataset.service +
                    '; expires=Wed, 1 Jan 2030 00:00:00 GMT; path=/;';
                window.location.href = social.dataset.url;
                return;
            }
        });

        // Click outside → close
        document.addEventListener('click', (e) => {
            if (!navEl) return;
            if (!navEl.contains(e.target)) closeAllDropdowns();
        });

        // Escape → close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllDropdowns();
        });
    }

    // ─── Init ────────────────────────────────────────────────
    function init() {
        const menuWrap = document.querySelector(CONFIG.LEGACY_MENU_SELECTOR);
        if (!menuWrap) {
            console.warn('[TopMenu] Legacy .menuwrap not found — aborting.');
            return;
        }

        if (document.getElementById(CONFIG.NAV_ID)) return; // already built

        const loggedIn = isLoggedIn(menuWrap);
        const userLink = loggedIn
            ? menuWrap.querySelector('.left .menu > a[href*="act=Profile"]')
            : null;

        const data = {
            loggedIn,
            search: extractSearch(menuWrap),
            user: loggedIn ? extractUser(menuWrap) : null,
            userDropdown: loggedIn && userLink
                ? extractItems(userLink.nextElementSibling || document.createElement('ul'))
                : [],
            actions: loggedIn ? extractTopActions(menuWrap, userLink) : [],
            guest: !loggedIn ? extractGuest(menuWrap) : null
        };

        navEl = buildNav(data);

        // Insert BEFORE legacy menu (user hides legacy via CSS)
        menuWrap.parentNode.insertBefore(navEl, menuWrap);

               // Hide from screen readers now that the modern nav is active
        menuWrap.setAttribute('aria-hidden', 'true'); // <── Add this

        attachEventDelegation();
        window.addEventListener('scroll', requestScroll, { passive: true });

        console.log('[TopMenu] Modern nav built (' + (loggedIn ? 'member' : 'guest') + ')');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    return { init };
})();
