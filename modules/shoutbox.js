/* ============================================================
   ChatModule — Modern chat surface for the forum shoutbox.
   Reads from hello-box (or a legacy .shoutbox fallback), writes
   BBCode through the underlying hello-box textarea + send button.
   ============================================================ */
'use strict';

var ChatModule = (function (Utils, EventBus) {
    'use strict';

    var isInitialized = false;
    var observerCallbacks = [];
    var _editorInstance = null;
    var _boundHandlers = [];
    var _pollTimer = null;
    var _seenMessageIds = new Set();
    var _currentUserCache = null;

    // Build guards.
    //   _buildInProgress  — first line of defence against two concurrent
    //                        build() calls (the wrapper observer path and
    //                        the "wrapper already exists" fast path both
    //                        schedule a build ~50ms apart).
    //   _buildPromise     — the in-flight build, returned to any second
    //                        caller that races in while the first is
    //                        still awaiting TipTap's dynamic imports.
    //   _chatPlaced       — set once getOrCreateChatContainer() has
    //                        inserted the section into the DOM. The
    //                        anchor observer consults this to avoid
    //                        re-inserting on every mutation.
    var _buildInProgress = false;
    var _buildPromise = null;
    var _chatPlaced = false;

    // Per-MID cache for author group classes. Populated in the
    // background by resolveGroupClass(); buildMessageElement() paints
    // a group-member default immediately and swaps in the real class
    // when the fetch resolves.
    var _groupCache = new Map();

    var CONFIG = {
        CONTAINER_ID: 'modern-chat',
        POLL_INTERVAL_MS: 4000,
        MAX_MESSAGE_LENGTH: 1000,
        // hello-box's own send path — the textarea and button inside the
        // custom element. Overridable if the forum ships a different skin.
        HELLO_BOX_SELECTOR: 'hello-box',
        LEGACY_SHOUTBOX_SELECTOR: '.shoutbox',
        HELLO_BOX_TEXTAREA: '.hb-textarea',
        HELLO_BOX_SEND: '.hb-send-btn',
        HELLO_BOX_MESSAGE: '.hb-message'
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

    var KNOWN_GROUP_CLASSES = [
        'group-founder', 'group-administrator', 'group-global-moderator',
        'group-moderator', 'group-developer', 'group-game-dev',
        'group-fan', 'group-member'
    ];

    // ------------------------------------------------------------------------
    // Helpers (mirrors editor-module.js / messenger.js conventions)
    // ------------------------------------------------------------------------
    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    function decodeHtmlEntities(str) {
        if (!str || typeof str !== 'string') return str;
        if (str.indexOf('&') === -1) return str;
        var txt = document.createElement('textarea');
        txt.innerHTML = str;
        return txt.value;
    }

    // Local copy — editor-module.js and messenger.js each have their own,
    // and ChatModule doesn't import either. Without this, the editor's
    // onUpdate handler throws ReferenceError on the first keystroke and
    // the Send button never enables.
    function editorContentIsEmpty(html) {
        if (!html || typeof html !== 'string') return true;
        var text = html
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&zeroWidthSpace;/gi, '')
            .replace(/[\p{Cc}\p{Cf}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length > 0) return false;
        if (/<img[^>]+src\s*=/i.test(html)) return false;
        return true;
    }

    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function getInitialFromName(name) {
        if (!name || typeof name !== 'string') return '?';
        var match = name.match(/[\p{L}\p{N}]/u);
        if (!match) return '?';
        return match[0].toUpperCase();
    }

    function optimizeAvatarUrl(url, width, height) {
        if (!url || typeof url !== 'string') return null;
        var trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return null;
        if (trimmed.indexOf('weserv.nl') !== -1 || trimmed.indexOf('data:') === 0) return trimmed;
        if (trimmed.charAt(0) === '/' && trimmed.charAt(1) === '/') trimmed = 'https:' + trimmed;
        if (trimmed.indexOf('http://') === 0 && window.location.protocol === 'https:') {
            trimmed = trimmed.replace('http://', 'https://');
        }
        return 'https://images.weserv.nl/?url=' + encodeURIComponent(trimmed) +
            '&output=webp&maxage=1y&q=85&w=' + width + '&h=' + height +
            '&fit=cover&a=attention&il';
    }

    function shouldUseInitialAvatar(avatarUrl) {
        if (!avatarUrl || typeof avatarUrl !== 'string') return true;
        var lower = avatarUrl.toLowerCase();
        return lower.indexOf('img.forumfree.net') !== -1 ||
               lower.indexOf('style_images/default_avatar.png') !== -1 ||
               lower.indexOf('default_avatar') !== -1;
    }

    function getGroupClass(row) {
        if (!row) return 'group-member';
        var cls = row.className || '';
        if (cls.indexOf('box_founder') !== -1) return 'group-founder';
        if (cls.indexOf('box_amministratore') !== -1) return 'group-administrator';
        if (cls.indexOf('box_gruppo1') !== -1) return 'group-global-moderator';
        if (cls.indexOf('box_gruppo2') !== -1) return 'group-game-dev';
        if (cls.indexOf('box_gruppo3') !== -1) return 'group-fan';
        if (cls.indexOf('box_moderatore') !== -1) return 'group-moderator';
        return 'group-member';
    }

    function addGlobalListener(el, type, handler, opts) {
        el.addEventListener(type, handler, opts);
        _boundHandlers.push({ el: el, type: type, handler: handler, opts: opts });
    }

    function formatTime(date) {
        if (!date || isNaN(date.getTime())) return '';
        try {
            return date.toLocaleTimeString(document.documentElement.lang || 'en', {
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return ''; }
    }

    // ------------------------------------------------------------------------
    // GROUP CLASS RESOLUTION (background)
    //
    // hello-box doesn't expose the author's group in its markup — every
    // message ships with the same .hb-* structure regardless of role. To
    // colour the avatar border the way every other surface does, we look
    // the author up via /api.php?mid=X (the same endpoint boards.js and
    // messenger.js use) and cache the result per MID. The initial paint
    // uses group-member; the real class is swapped in when the fetch
    // resolves. Failures are cached too, so a dead MID isn't refetched.
    // ------------------------------------------------------------------------
    function classifyGroup(user) {
        if (!user || !user.group) return 'group-member';
        var gn = (user.group.name || '').toLowerCase();
        var gc = (user.group.class || '').toLowerCase();
        var gb = (user.group.bodyclass || '').toLowerCase();
        var gid = user.group.id;

        if (gc.indexOf('founder') !== -1 || gb.indexOf('founder') !== -1 || gn === 'founder') {
            return 'group-founder';
        }
        if (gn === 'administrator' || gc.indexOf('admin') !== -1 || gid === 1) {
            return 'group-administrator';
        }
        if (gn === 'global moderator' || gc.indexOf('global_mod') !== -1) {
            return 'group-global-moderator';
        }
        if (gn === 'moderator' || gc.indexOf('mod') !== -1) {
            return 'group-moderator';
        }
        if (gn === 'developer' || gc.indexOf('developer') !== -1) {
            return 'group-developer';
        }
        if (gn === 'game dev' || gc.indexOf('game_dev') !== -1) {
            return 'group-game-dev';
        }
        if (gn === 'fan') {
            return 'group-fan';
        }
        return 'group-member';
    }

    function resolveGroupClass(mid) {
        if (!mid) return Promise.resolve('group-member');
        if (_groupCache.has(mid)) return Promise.resolve(_groupCache.get(mid));

        return fetch('/api.php?mid=' + encodeURIComponent(mid), { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                var user = data && (data['m' + mid] || data.info);
                var cls = classifyGroup(user);
                _groupCache.set(mid, cls);
                return cls;
            })
            .catch(function () {
                _groupCache.set(mid, 'group-member');
                return 'group-member';
            });
    }

    // ------------------------------------------------------------------------
    // SOURCE READING — hello-box (primary) or .shoutbox (fallback)
    //
    // Both produce the same normalised shape so the rest of the module is
    // source-agnostic. Each message gets a stable `id`; new ones are what
    // the poll loop prepends.
    // ------------------------------------------------------------------------
    function readHelloBoxMessages() {
        var box = document.querySelector(CONFIG.HELLO_BOX_SELECTOR);
        if (!box) return [];
        var nodes = box.querySelectorAll(CONFIG.HELLO_BOX_MESSAGE);
        var out = [];
        nodes.forEach(function (node) {
            var uid = node.getAttribute('data-uid') || '';
            var avatarImg = node.querySelector('.hb-avatar');
            var avatar = avatarImg ? (avatarImg.getAttribute('data-original') || avatarImg.getAttribute('src')) : null;
            var nickEl = node.querySelector('.hb-nickname a');
            var name = nickEl ? decodeHtmlEntities(nickEl.textContent.trim()) : 'Unknown';
            var profileUrl = nickEl ? nickEl.getAttribute('href') : '';
            var mid = null;
            if (profileUrl) {
                var m = profileUrl.match(/MID=(\d+)/);
                if (m) mid = m[1];
            }
            var timeEl = node.querySelector('.hb-time');
            var timeStr = timeEl ? timeEl.textContent.trim() : '';

            var bodyEl = node.querySelector('.hb-text-content');
            var html = bodyEl ? bodyEl.innerHTML : '';

            // hello-box lets users quote another message — it renders
            // .hb-quote-ref spans and .hb-spoiler spans. Keep those as-is;
            // our renderer treats the whole body as trusted HTML from the
            // forum itself, exactly like the reader side does for posts.
            out.push({
                id: uid ? ('hb-' + uid + '-' + timeStr) : ('hb-' + name + '-' + timeStr),
                mid: mid,
                name: name,
                avatar: avatar,
                profileUrl: profileUrl,
                timestamp: timeStr,
                timestampDate: null, // hello-box formats as "DD/MM, HH:MM"
                html: html,
                // Painted as the fallback; buildMessageElement() swaps in
                // the real class once resolveGroupClass() resolves.
                groupClass: mid ? (_groupCache.get(mid) || 'group-member') : 'group-member'
            });
        });
        return out;
    }

    function readLegacyShoutboxMessages() {
        var box = document.querySelector(CONFIG.LEGACY_SHOUTBOX_SELECTOR);
        if (!box) return [];
        var rows = box.querySelectorAll('li, .row');
        var out = [];
        rows.forEach(function (row) {
            var link = row.querySelector('.nick a, a[href*="MID="]');
            var name = link ? decodeHtmlEntities(link.textContent.trim()) : 'Unknown';
            var profileUrl = link ? link.getAttribute('href') : '';
            var mid = null;
            if (profileUrl) {
                var m = profileUrl.match(/MID=(\d+)/);
                if (m) mid = m[1];
            }
            var when = row.querySelector('time, .when, .date');
            var timeStr = when ? when.textContent.trim() : '';
            var body = row.querySelector('.msg, .text, .message') || row;
            out.push({
                id: 'legacy-' + name + '-' + timeStr + '-' + body.textContent.slice(0, 20),
                mid: mid,
                name: name,
                avatar: null,
                profileUrl: profileUrl,
                timestamp: timeStr,
                timestampDate: null,
                html: body.innerHTML,
                groupClass: getGroupClass(row)
            });
        });
        return out;
    }

    function readMessages() {
        var hb = readHelloBoxMessages();
        if (hb.length > 0) return hb;
        return readLegacyShoutboxMessages();
    }

    // ------------------------------------------------------------------------
    // CURRENT USER (mirrors messenger.js)
    // ------------------------------------------------------------------------
    function getCurrentUserId() {
        var match = document.body.className.match(/\ba(\d{5,})\b/);
        if (match) return match[1];
        var menuLink = document.querySelector('.menuwrap a[href*="MID="]');
        if (menuLink) {
            var m = menuLink.getAttribute('href').match(/MID=(\d+)/);
            if (m) return m[1];
        }
        return null;
    }

    function getCurrentUserSync() {
        var mid = getCurrentUserId();
        if (!mid) return null;
        var username = null, avatarUrl = null;
        var menu = document.querySelector('.menuwrap');
        if (menu) {
            var nick = menu.querySelector('.nick');
            if (nick) username = decodeHtmlEntities(nick.textContent.trim());
            var img = menu.querySelector('.avatar img');
            if (img && img.src) avatarUrl = img.src;
        }
        return { mid: mid, nickname: username || null, avatar: avatarUrl || null };
    }

    // ------------------------------------------------------------------------
    // OUTBOUND — BBCode → hello-box textarea → send
    //
    // hello-box's textarea accepts BBCode + emoticons (its BBCode toolbar
    // proves it). We reuse that exact submission channel so the message
    // lands in the same store the rest of the site reads.
    // ------------------------------------------------------------------------
    function htmlToLegacy(html) {
        // Same shape as editor-module's htmlToLegacy, minus the bits this
        // module's TipTap config can't produce (no code blocks, no lite
        // embeds, no spoilers — a chat line doesn't need them).
        if (!html || typeof html !== 'string') return '';

        var result = html;

        // bold / italic / underline / strike
        result = result.replace(/<strong>([\s\S]*?)<\/strong>/gi, '[b]$1[/b]');
        result = result.replace(/<b>([\s\S]*?)<\/b>/gi, '[b]$1[/b]');
        result = result.replace(/<em>([\s\S]*?)<\/em>/gi, '[i]$1[/i]');
        result = result.replace(/<i>([\s\S]*?)<\/i>/gi, '[i]$1[/i]');
        result = result.replace(/<u>([\s\S]*?)<\/u>/gi, '[u]$1[/u]');
        result = result.replace(/<s>([\s\S]*?)<\/s>/gi, '[s]$1[/s]');
        result = result.replace(/<del>([\s\S]*?)<\/del>/gi, '[s]$1[/s]');

        // links
        result = result.replace(
            /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
            function (_, href, inner) { return '[url=' + href + ']' + inner + '[/url]'; }
        );

        // twemoji imgs → the unicode char (alt holds it). hello-box's own
        // parser turns unicode back into its emoji representation.
        result = result.replace(
            /<img\b[^>]*\bclass="twemoji"[^>]*\balt="([^"]*)"[^>]*>/gi,
            function (_, alt) { return alt; }
        );

        // any other image → [img]url[/img]
        result = result.replace(
            /<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gi,
            function (_, src) { return '[img]' + src + '[/img]'; }
        );

        // block elements → line breaks. Chat is single-line-ish; convert
        // paragraph/break boundaries to newlines, strip the rest.
        result = result.replace(/<br\s*\/?>/gi, '\n');
        result = result.replace(/<\/p>\s*<p[^>]*>/gi, '\n');
        result = result.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n');

        // strip any remaining tags
        result = result.replace(/<[^>]+>/g, '');

        // decode entities the browser may have inserted
        result = decodeHtmlEntities(result);

        // collapse runs of blank lines, trim
        result = result.replace(/\n{3,}/g, '\n\n').trim();

        return result;
    }

    function sendToHelloBox(legacyText) {
        var box = document.querySelector(CONFIG.HELLO_BOX_SELECTOR);
        if (!box) return false;
        var textarea = box.querySelector(CONFIG.HELLO_BOX_TEXTAREA);
        var sendBtn = box.querySelector(CONFIG.HELLO_BOX_SEND);
        if (!textarea) return false;

        // Respect hello-box's own maxlength.
        var maxLen = parseInt(textarea.getAttribute('maxlength') || '0', 10);
        if (maxLen > 0 && legacyText.length > maxLen) {
            legacyText = legacyText.slice(0, maxLen);
        }

        textarea.value = legacyText;
        // hello-box listens for input to enable the send button.
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));

        if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return true;
        }
        // Some skins submit on Enter instead of a button. Fall back to
        // dispatching a submit-ish key event; if neither path exists
        // the message is left in the textarea and the user can send it.
        try {
            textarea.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
            }));
            return true;
        } catch (e) {
            return false;
        }
    }

    // ------------------------------------------------------------------------
    // RENDERING
    // ------------------------------------------------------------------------
    function buildMessageElement(msg, currentMid) {
        var el = document.createElement('article');
        el.className = 'chat-message' + (msg.mid === currentMid ? ' chat-message--self' : '');
        el.setAttribute('data-message-id', msg.id);

        var avatarHtml;
        var optimized = optimizeAvatarUrl(msg.avatar, 36, 36);
        if (optimized && !shouldUseInitialAvatar(msg.avatar)) {
            avatarHtml =
                '<img class="chat-avatar" src="' + escapeHtml(optimized) +
                '" alt="" width="36" height="36" loading="lazy" decoding="async">';
        } else {
            avatarHtml =
                '<span class="chat-avatar chat-avatar--initial" style="background-color:#' +
                getColorFromNickname(msg.name, msg.mid) + ';">' +
                escapeHtml(getInitialFromName(msg.name)) + '</span>';
        }

        var avatarLink = msg.profileUrl
            ? '<a href="' + escapeHtml(msg.profileUrl) + '" class="chat-avatar-link" rel="nofollow">' +
              avatarHtml + '</a>'
            : avatarHtml;

        var nameHtml = msg.profileUrl
            ? '<a href="' + escapeHtml(msg.profileUrl) + '" class="chat-author" rel="nofollow">' +
              escapeHtml(msg.name) + '</a>'
            : '<span class="chat-author">' + escapeHtml(msg.name) + '</span>';

        el.innerHTML =
            '<div class="chat-avatar-col ' + msg.groupClass + '">' + avatarLink + '</div>' +
            '<div class="chat-body">' +
                '<div class="chat-header">' +
                    nameHtml +
                    '<time class="chat-time">' + escapeHtml(msg.timestamp) + '</time>' +
                '</div>' +
                '<div class="chat-text">' + msg.html + '</div>' +
            '</div>';

        // Background upgrade — if the cache already knows the real class,
        // apply it synchronously so the first paint is correct. Otherwise
        // fetch and patch the avatar column in place.
        if (msg.mid) {
            if (_groupCache.has(msg.mid)) {
                applyGroupClass(el, _groupCache.get(msg.mid));
            } else if (msg.groupClass === 'group-member') {
                var mid = msg.mid;
                resolveGroupClass(mid).then(function (cls) {
                    if (!el.isConnected) return;
                    applyGroupClass(el, cls);
                });
            }
        }

        return el;
    }

    function applyGroupClass(messageEl, cls) {
        if (!messageEl || !cls) return;
        var col = messageEl.querySelector('.chat-avatar-col');
        if (!col) return;
        KNOWN_GROUP_CLASSES.forEach(function (c) { col.classList.remove(c); });
        col.classList.add(cls);
    }

    function renderMessages(container, messages, currentMid) {
        var list = container.querySelector('.chat-messages');
        if (!list) return;

        // Preserve scroll if user was near the bottom (chat convention).
        var wasAtBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 40;

        // Always drop the empty node up front — this makes the branch
        // below idempotent regardless of what the previous paint left
        // behind. The old code only removed it when the incoming list
        // was non-empty, which left a stale "No messages yet" node
        // sitting below real messages whenever the first render ran
        // against an unhydrated hello-box.
        var staleEmpty = list.querySelector('.chat-empty');
        if (staleEmpty) staleEmpty.remove();

        if (messages.length === 0) {
            // Drop any message rows left from a previous paint (can only
            // happen if the source went from populated to empty, e.g. a
            // folder switch or a hello-box reset).
            list.querySelectorAll('.chat-message').forEach(function (n) { n.remove(); });

            var e = document.createElement('div');
            e.className = 'chat-empty';
            e.innerHTML = '<i class="fa-regular fa-comments" aria-hidden="true"></i>' +
                          '<p>No messages yet. Say hi!</p>';
            list.appendChild(e);
            return;
        }

        // Build a map of existing IDs to avoid re-rendering everything.
        var existing = {};
        list.querySelectorAll('.chat-message').forEach(function (n) {
            existing[n.getAttribute('data-message-id')] = n;
        });

        var seen = {};
        var orderedNodes = [];
        messages.forEach(function (msg) {
            if (seen[msg.id]) return;
            seen[msg.id] = true;
            var node = existing[msg.id] || buildMessageElement(msg, currentMid);
            if (!existing[msg.id]) _seenMessageIds.add(msg.id);
            orderedNodes.push(node);
        });

        // Rebuild the list in order (only appendChild moves, no re-innerHTML).
        var fragment = document.createDocumentFragment();
        orderedNodes.forEach(function (n) { fragment.appendChild(n); });
        list.innerHTML = '';
        list.appendChild(fragment);

        if (wasAtBottom) {
            list.scrollTop = list.scrollHeight;
        }
    }

    function updateStatus(container, count) {
        var status = container.querySelector('.chat-status');
        if (!status) return;
        status.textContent = count === 0 ? 'No messages yet' :
            count + ' ' + (count === 1 ? 'message' : 'messages');
    }

    // ------------------------------------------------------------------------
    // POLLING
    // ------------------------------------------------------------------------
    function startPolling(container) {
        if (_pollTimer) return;
        function tick() {
            if (document.hidden) return; // don't poll hidden tabs
            // Read the current MID fresh each tick — a login/logout
            // between ticks would otherwise leave the self-classification
            // stale. getCurrentUserId() is two DOM reads and a regex.
            var messages = readMessages();
            renderMessages(container, messages, getCurrentUserId());
            updateStatus(container, messages.length);
        }
        _pollTimer = setInterval(tick, CONFIG.POLL_INTERVAL_MS);
        addGlobalListener(document, 'visibilitychange', function () {
            if (!document.hidden) tick();
        });
    }

    function stopPolling() {
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    }

    // ------------------------------------------------------------------------
    // TipTap EDITOR
    //
    // Deliberately minimal: bold / italic / underline / link / emoji.
    // A chat line does not need headings, code blocks, spoilers, or
    // upload placeholders — those live in the full editor. Keeping the
    // schema small keeps the editor fast and the serialiser predictable.
    // ------------------------------------------------------------------------
    async function loadTipTapDeps() {
        const core = await import('https://esm.sh/@tiptap/core@2.5.2');
        const Editor = core.Editor || (core.default && core.default.Editor);
        const Node = core.Node || (core.default && core.default.Node);
        const Mark = core.Mark || (core.default && core.default.Mark);
        const Extension = core.Extension || (core.default && core.default.Extension);
        const InputRule = core.InputRule || (core.default && core.default.InputRule);
        if (!Editor || !Node || !Mark || !Extension || !InputRule) {
            throw new Error('TipTap core missing');
        }
        const { Plugin, PluginKey, TextSelection } = await import('https://esm.sh/prosemirror-state@1.4.3');
        const sk = await import('https://esm.sh/@tiptap/starter-kit@2.5.2');
        const ph = await import('https://esm.sh/@tiptap/extension-placeholder@2.5.2');
        const ul = await import('https://esm.sh/@tiptap/extension-underline@2.5.2');
        const lk = await import('https://esm.sh/@tiptap/extension-link@2.5.2');
        const cc = await import('https://esm.sh/@tiptap/extension-character-count@2.5.2');

        return {
            Editor, Node, Mark, Extension, InputRule,
            Plugin, PluginKey, TextSelection,
            StarterKit: sk.StarterKit || (sk.default && sk.default.StarterKit),
            Placeholder: ph.Placeholder || (ph.default && ph.default.Placeholder),
            Underline: ul.Underline || (ul.default && ul.default.Underline),
            Link: lk.Link || (lk.default && lk.default.Link),
            CharacterCount: cc.CharacterCount || (cc.default && cc.default.CharacterCount)
        };
    }

        async function buildComposer(container) {
        var composer = container.querySelector('.chat-composer');
        if (!composer) return;

        // If a *live* editor already exists, do nothing. Checking only for
        // the .chat-editor DOM node isn't enough: after destroy() (or a
        // bfcache restore) the node is still there but the TipTap instance
        // behind it is dead, so the send button renders and does nothing.
        // editor.isDestroyed is false while the view is alive.
        if (composer.querySelector('.chat-editor') &&
            _editorInstance &&
            !_editorInstance.isDestroyed) {
            return;
        }

        // Tear down whatever dead shell is present before building a new
        // one. Without this, a rebuild appends a second toolbar / editor /
        // actions set alongside the orphaned nodes.
        if (_editorInstance) {
            try { _editorInstance.destroy(); } catch (e) { /* ignore */ }
            _editorInstance = null;
        }
        var deadToolbar = composer.querySelector('.chat-toolbar');
        if (deadToolbar) deadToolbar.remove();
        var deadEditor = composer.querySelector('.chat-editor');
        if (deadEditor) deadEditor.remove();
        var deadActions = composer.querySelector('.chat-actions');
        if (deadActions) deadActions.remove();

        var deps = await loadTipTapDeps();
        var {
            Editor, Node, StarterKit, Placeholder, Underline, Link,
            CharacterCount, Extension, InputRule
        } = deps;

        var toolbar = document.createElement('div');
        toolbar.className = 'chat-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Formatting');

        var editorHost = document.createElement('div');
        editorHost.className = 'chat-editor';

        var actions = document.createElement('div');
        actions.className = 'chat-actions';

        var sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.className = 'modern-btn modern-btn-primary chat-send-btn';
        sendBtn.innerHTML = '<i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Send';
        sendBtn.disabled = true;

        actions.appendChild(sendBtn);

        composer.appendChild(toolbar);
        composer.appendChild(editorHost);
        composer.appendChild(actions);

        // --- simple emoji → unicode input rule, so a pasted emoji stays
        //     text and hello-box can re-render it as its own emoji.
        var EmojiInputRule = Extension.create({
            name: 'emojiInputRule',
            addInputRules() {
                return [new InputRule({
                    find: /([\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}])$/u,
                    handler: function ({ state, range, match }) {
                        // Leave unicode emoji as-is — hello-box's own parser
                        // converts them on send. No node swap needed.
                    }
                })];
            }
        });

        var editor = new Editor({
            element: editorHost,
            extensions: [
                StarterKit.configure({
                    codeBlock: false,
                    blockquote: false,
                    heading: false,
                    bulletList: false,
                    orderedList: false,
                    horizontalRule: false
                }),
                Placeholder.configure({ placeholder: 'Write a message…' }),
                Underline,
                Link.configure({
                    openOnClick: false,
                    autolink: true,
                    linkOnPaste: false, // chat links: keep as plain text
                    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' }
                }),
                CharacterCount.configure({ limit: CONFIG.MAX_MESSAGE_LENGTH }),
                EmojiInputRule
            ],
            content: '',
            editorProps: {
                attributes: {
                    class: 'chat-editor-content',
                    'aria-label': 'Chat message',
                    'aria-multiline': 'true'
                },
                handleKeyDown: function (view, event) {
                    // Enter sends; Shift+Enter inserts a newline.
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (!sendBtn.disabled) sendBtn.click();
                        return true;
                    }
                    return false;
                }
            },
            onUpdate: function ({ editor }) {
                var empty = editorContentIsEmpty(editor.getHTML());
                var tooLong = editor.storage.characterCount.characters() > CONFIG.MAX_MESSAGE_LENGTH;
                sendBtn.disabled = empty || tooLong;
                if (tooLong) {
                    sendBtn.setAttribute('title', 'Message too long');
                } else {
                    sendBtn.removeAttribute('title');
                }
            }
        });

        _editorInstance = editor;

        // --- toolbar buttons
        function mkBtn(icon, label, shortcut) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'modern-editor-btn chat-toolbar-btn';
            b.innerHTML = '<i class="' + icon + '" aria-hidden="true"></i>';
            b.title = label;
            b.setAttribute('aria-label', label);
            if (shortcut) b.setAttribute('aria-keyshortcuts', shortcut);
            toolbar.appendChild(b);
            return b;
        }

        var boldBtn = mkBtn('fa-regular fa-bold', 'Bold', 'Control+B');
        var italicBtn = mkBtn('fa-regular fa-italic', 'Italic', 'Control+I');
        var underlineBtn = mkBtn('fa-regular fa-underline', 'Underline', 'Control+U');

        function exec(cmd) {
            cmd();
            editor.commands.focus();
        }
        boldBtn.onclick = function () { exec(function () { editor.chain().focus().toggleBold().run(); }); };
        italicBtn.onclick = function () { exec(function () { editor.chain().focus().toggleItalic().run(); }); };
        underlineBtn.onclick = function () { exec(function () { editor.chain().focus().toggleUnderline().run(); }); };

        // active states
        function updateActive() {
            boldBtn.classList.toggle('active', editor.isActive('bold'));
            italicBtn.classList.toggle('active', editor.isActive('italic'));
            underlineBtn.classList.toggle('active', editor.isActive('underline'));
        }
        editor.on('selectionUpdate', updateActive);
        editor.on('transaction', updateActive);

        // --- send
        sendBtn.onclick = function () {
            var html = editor.getHTML();
            if (editorContentIsEmpty(html)) return;
            var legacy = htmlToLegacy(html);
            if (!legacy) return;

            // Snapshot the message count so we can verify the round-trip
            // after sendToHelloBox() fires. If the count doesn't grow, the
            // send didn't land — restore the draft instead of losing it.
            var beforeCount = readMessages().length;

            if (!sendToHelloBox(legacy)) {
                showToast('Could not reach the shoutbox — your message is still in the editor.', 'error');
                return;
            }

            editor.commands.clearContent(true);
            sendBtn.disabled = true;

            // Give hello-box a beat to render, then refresh our list so the
            // sent message appears immediately instead of after the poll.
            setTimeout(function () {
                var fresh = readMessages();
                renderMessages(container, fresh, getCurrentUserId());
                updateStatus(container, fresh.length);

                if (fresh.length <= beforeCount) {
                    // Send didn't land — restore the draft rather than
                    // silently losing the user's text.
                    editor.commands.setContent(html, true);
                    sendBtn.disabled = false;
                    showToast('Message may not have sent — draft restored.', 'warning');
                    return;
                }

                var list = container.querySelector('.chat-messages');
                if (list) list.scrollTop = list.scrollHeight;
            }, 400);
        };
    }

    // ------------------------------------------------------------------------
    // SHELL — header, messages list, composer mount
    // ------------------------------------------------------------------------
    function buildHeader(container) {
        var header = container.querySelector('.chat-header-bar');
        if (header) return header;

        header = document.createElement('div');
        header.className = 'chat-header-bar';
        header.innerHTML =
            '<div class="chat-title">' +
                '<i class="fa-regular fa-comments" aria-hidden="true"></i>' +
                '<span>Shoutbox</span>' +
            '</div>' +
            '<div class="chat-status" aria-live="polite"></div>';
        container.insertBefore(header, container.firstChild);
        return header;
    }

    function buildMessagesList(container) {
        var list = container.querySelector('.chat-messages');
        if (list) return list;

        list = document.createElement('div');
        list.className = 'chat-messages';
        list.setAttribute('role', 'log');
        list.setAttribute('aria-live', 'polite');
        list.setAttribute('aria-label', 'Chat messages');

        var composer = container.querySelector('.chat-composer');
        if (composer && composer.parentNode === container) {
            container.insertBefore(list, composer);
        } else {
            container.appendChild(list);
        }
        return list;
    }

    function buildComposerShell(container) {
        var composer = container.querySelector('.chat-composer');
        if (composer) return composer;

        composer = document.createElement('div');
        composer.className = 'chat-composer';
        composer.setAttribute('role', 'form');
        composer.setAttribute('aria-label', 'Compose a message');
        container.appendChild(composer);
        return composer;
    }

    // ------------------------------------------------------------------------
    // CONTAINER — creation, placement, idempotency
    // ------------------------------------------------------------------------
    function getOrCreateChatContainer() {
        var existing = document.getElementById(CONFIG.CONTAINER_ID);
        if (existing) {
            _chatPlaced = true;
            return existing;
        }

        var wrapper = document.getElementById('modern-forum-wrapper');
        if (!wrapper) return null;

        var container = document.createElement('section');
        container.id = CONFIG.CONTAINER_ID;
        container.className = 'chat-module';
        container.setAttribute('aria-label', 'Forum shoutbox');

        // Placement priority: before the board list, before the latest
        // posts block, then append. reorderContainers() in boards.js will
        // fix the order after every module initialises anyway, so this is
        // a best-effort initial slot, not the final word.
        var boardList = wrapper.querySelector('#modern-board-list');
        var latestPosts = wrapper.querySelector('#modern-latest-posts');

        if (boardList && boardList.parentNode === wrapper) {
            wrapper.insertBefore(container, boardList);
        } else if (latestPosts && latestPosts.parentNode === wrapper) {
            wrapper.insertBefore(container, latestPosts);
        } else {
            wrapper.appendChild(container);
        }

        _chatPlaced = true;
        return container;
    }

    // ------------------------------------------------------------------------
    // BUILD — guarded, idempotent, concurrency-safe
    // ------------------------------------------------------------------------
    function build() {
        // Concurrent-call guard. Two call sites schedule build() ~50ms
        // apart (the wrapper observer and the "wrapper already exists"
        // fast path in initialize()). Both fire in the common case. If a
        // build is already in flight, hand back its promise so the second
        // caller doesn't start a parallel one.
        if (_buildPromise) return _buildPromise;
        if (_buildInProgress) return Promise.resolve();

        _buildInProgress = true;
        _buildPromise = (async function () {
            try {
                var container = getOrCreateChatContainer();
                if (!container) {
                    console.warn('[ChatModule] Could not find a mount point for the chat container.');
                    return;
                }

                container.classList.add('chat-module');

                // Shell elements are idempotent — each checks for an
                // existing node first.
                buildHeader(container);
                buildMessagesList(container);
                buildComposerShell(container);

                                // Composer build is guarded internally too; this skip
                // avoids re-entering the dynamic import() at all when a
                // *live* editor is already attached. Checking only for
                // the DOM node isn't enough — after destroy() the node
                // remains but the TipTap instance behind it is dead.
                var composer = container.querySelector('.chat-composer');
                var liveEditor = composer && composer.querySelector('.chat-editor') &&
                                 _editorInstance && !_editorInstance.isDestroyed;

                if (!liveEditor) {
                    await buildComposer(container);
                }

                // Initial paint.
                var messages = readMessages();
                renderMessages(container, messages, getCurrentUserId());
                updateStatus(container, messages.length);

                // A second repaint ~600ms later catches hello-box that
                // hydrated after our first read (common on slow pages).
                setTimeout(function () {
                    if (!document.getElementById(CONFIG.CONTAINER_ID)) return;
                    var fresh = readMessages();
                    renderMessages(container, fresh, getCurrentUserId());
                    updateStatus(container, fresh.length);
                }, 600);

                startPolling(container);
            } catch (err) {
                console.error('[ChatModule] build failed:', err);
            } finally {
                _buildInProgress = false;
                _buildPromise = null;
            }
        })();

        return _buildPromise;
    }

    // ------------------------------------------------------------------------
    // OBSERVERS
    //
    // Two registrations:
    //   chat-module-wrapper — primary. Fires when #modern-forum-wrapper
    //                         appears, then unregisters itself.
    //   chat-module-anchors — fallback for late-arriving board/latest
    //                         lists. No-ops once _chatPlaced is set, so
    //                         it can't re-insert on every mutation.
    // ------------------------------------------------------------------------
    function registerObservers() {
        if (typeof Utils === 'undefined' || !Utils || typeof Utils.registerObserver !== 'function') {
            // No observer utility available — fall back to polling for the
            // wrapper a few times, then give up.
            var attempts = 0;
            var iv = setInterval(function () {
                attempts++;
                if (document.getElementById('modern-forum-wrapper')) {
                    clearInterval(iv);
                    setTimeout(build, 100);
                } else if (attempts > 40) {
                    clearInterval(iv);
                    console.warn('[ChatModule] wrapper never appeared.');
                }
            }, 100);
            return;
        }

        Utils.registerObserver('chat-module-wrapper', '#modern-forum-wrapper', function () {
            // Primary path. The observer fires once the wrapper exists;
            // build() is itself guarded, so a second registration racing
            // in is harmless.
            setTimeout(build, 100);
        });

        Utils.registerObserver('chat-module-anchors',
            '#modern-board-list, #modern-latest-posts',
            function () {
                // Once the chat has been placed, this observer has nothing
                // to do. Without this guard, a whitespace text node
                // between the chat and the board list makes
                // container.nextSibling !== boardList true, and every
                // mutation re-inserts the container — an infinite
                // mutation loop.
                if (_chatPlaced) return;

                var wrapper = document.getElementById('modern-forum-wrapper');
                if (!wrapper) return;

                var container = document.getElementById(CONFIG.CONTAINER_ID);
                if (!container) {
                    // Chat hasn't been created yet — let the primary path
                    // handle it. If it never fires, getOrCreateChatContainer
                    // will place us on the next build() anyway.
                    return;
                }

                var boardList = wrapper.querySelector('#modern-board-list');
                if (boardList && boardList.parentNode === wrapper &&
                    container.nextSibling !== boardList) {
                    wrapper.insertBefore(container, boardList);
                }
            });
    }

    // ------------------------------------------------------------------------
    // TOASTS — minimal, non-blocking. Prefers a shared Utils.showToast if
    // one exists (messenger.js uses the same convention).
    // ------------------------------------------------------------------------
    function showToast(message, kind) {
        if (Utils && typeof Utils.showToast === 'function') {
            Utils.showToast(message, kind);
            return;
        }
        // Local fallback.
        var existing = document.querySelector('.chat-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.className = 'chat-toast chat-toast--' + (kind || 'info');
        toast.setAttribute('role', 'status');
        toast.textContent = message;
        document.body.appendChild(toast);

        requestAnimationFrame(function () { toast.classList.add('chat-toast--visible'); });
        setTimeout(function () {
            toast.classList.remove('chat-toast--visible');
            setTimeout(function () { toast.remove(); }, 300);
        }, 3500);
    }

    // ------------------------------------------------------------------------
    // LIFECYCLE
    // ------------------------------------------------------------------------
    function initialize() {
        if (isInitialized) return;
        isInitialized = true;

        registerObservers();

        // Fast path — wrapper may already be present when this module
        // runs (e.g. script loaded late, or boards.js rendered first).
        if (document.getElementById('modern-forum-wrapper')) {
            setTimeout(build, 150);
        }

        // Cleanup on unload so the interval doesn't survive a bfcache
        // restore with a dead container reference.
        addGlobalListener(window, 'pagehide', function () {
            stopPolling();
            observerCallbacks.forEach(function (cb) {
                try { cb(); } catch (e) { /* ignore */ }
            });
            observerCallbacks = [];
            if (_editorInstance) {
                try { _editorInstance.destroy(); } catch (e) { /* ignore */ }
                _editorInstance = null;
            }
        });
    }

    function destroy() {
        stopPolling();
        _boundHandlers.forEach(function (h) {
            try { h.el.removeEventListener(h.type, h.handler, h.opts); } catch (e) { /* ignore */ }
        });
        _boundHandlers = [];
        if (_editorInstance) {
            try { _editorInstance.destroy(); } catch (e) { /* ignore */ }
            _editorInstance = null;
        }
        _seenMessageIds.clear();
        _groupCache.clear();
        isInitialized = false;
        _buildInProgress = false;
        _buildPromise = null;
        _chatPlaced = false;
    }

    // ------------------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------------------
    return {
        init: initialize,
        destroy: destroy,
        build: build,
        readMessages: readMessages,
        getCurrentUserId: getCurrentUserId
    };
})(window.Utils, window.EventBus);

// Auto-init unless another module has claimed ownership.
if (!window.__chatModuleAutoInitDisabled) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            ChatModule.init();
        });
    } else {
        ChatModule.init();
    }
}
