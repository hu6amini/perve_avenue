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
                groupClass: 'group-member'
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

        return el;
    }

    function renderMessages(container, messages, currentMid) {
        var list = container.querySelector('.chat-messages');
        if (!list) return;

        // Preserve scroll if user was near the bottom (chat convention).
        var wasAtBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 40;

        // Remove "empty" placeholder if present.
        var empty = list.querySelector('.chat-empty');
        if (empty && messages.length > 0) empty.remove();

        if (messages.length === 0 && !empty) {
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
        // Keep the "empty" node if it exists at the tail.
        if (empty) fragment.appendChild(empty);
        list.innerHTML = '';
        list.appendChild(fragment);

        if (wasAtBottom) {
            list.scrollTop = list.scrollHeight;
        }
    }

    // ------------------------------------------------------------------------
    // POLLING
    // ------------------------------------------------------------------------
    function startPolling(container) {
        if (_pollTimer) return;
        var currentMid = getCurrentUserId();
        function tick() {
            if (document.hidden) return; // don't poll hidden tabs
            var messages = readMessages();
            renderMessages(container, messages, currentMid);
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

        var composer = container.querySelector('.chat-composer');
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

            if (!sendToHelloBox(legacy)) {
                showToast('Could not reach the shoutbox — your message is still in the editor.', 'error');
                return;
            }

            editor.commands.clearContent(true);
            sendBtn.disabled = true;

            // Give hello-box a beat to render, then refresh our list so the
            // sent message appears immediately instead of after the poll.
            setTimeout(function () {
                var msgs = readMessages();
                renderMessages(container, msgs, getCurrentUserId());
                var list = container.querySelector('.chat-messages');
                if (list) list.scrollTop = list.scrollHeight;
            }, 300);
        };

        // focus on mount
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            setTimeout(function () {
                if (editor && !editor.isDestroyed) editor.commands.focus('end');
            }, 50);
        }
    }

    // ------------------------------------------------------------------------
    // Container creation — placed between latest-posts and board-list
    // without a selector dependency. Uses insertBefore against the board
    // list; falls back to appending into the wrapper.
    // ------------------------------------------------------------------------
    function getOrCreateChatContainer() {
        var existing = document.getElementById(CONFIG.CONTAINER_ID);
        if (existing) return existing;

        var wrapper = document.getElementById('modern-forum-wrapper');
        if (!wrapper) return null;

        var container = document.createElement('section');
        container.id = CONFIG.CONTAINER_ID;
        container.className = 'modern-chat';

        var header = document.createElement('header');
        header.className = 'chat-header-bar';
        header.innerHTML =
            '<h2 class="chat-title">' +
                '<i class="fa-regular fa-comments" aria-hidden="true"></i> Shoutbox' +
            '</h2>' +
            '<span class="chat-status" aria-live="polite"></span>';
        container.appendChild(header);

        var list = document.createElement('div');
        list.className = 'chat-messages';
        list.setAttribute('role', 'log');
        list.setAttribute('aria-live', 'polite');
        list.setAttribute('aria-relevant', 'additions');
        container.appendChild(list);

        var composer = document.createElement('div');
        composer.className = 'chat-composer';
        container.appendChild(composer);

        // Placement: after latest-posts, before the board list. This is the
        // "just before #modern-board-list and after latest posts" slot the
        // brief asks for. Any missing anchor is skipped gracefully.
        var boardList = document.getElementById('modern-board-list');
        var latestPosts = document.getElementById('modern-latest-posts');

        if (boardList && boardList.parentNode === wrapper) {
            wrapper.insertBefore(container, boardList);
        } else if (latestPosts && latestPosts.parentNode === wrapper) {
            // board list absent (e.g. topic page): go right after latest posts.
            if (latestPosts.nextSibling) {
                wrapper.insertBefore(container, latestPosts.nextSibling);
            } else {
                wrapper.appendChild(container);
            }
        } else {
            // Neither anchor present: append to the wrapper. The page's
            // own ordering will place it wherever the wrapper sits.
            wrapper.appendChild(container);
        }

        return container;
    }

    // ------------------------------------------------------------------------
    // Toast (self-contained — chat shouldn't depend on messenger's)
    // ------------------------------------------------------------------------
    function ensureToastContainer() {
        var c = document.getElementById('chat-toasts');
        if (!c) {
            c = document.createElement('div');
            c.id = 'chat-toasts';
            c.setAttribute('aria-live', 'polite');
            c.style.cssText = 'position:fixed;bottom:var(--space-lg);right:var(--space-lg);z-index:100000;display:flex;flex-direction:column;gap:var(--space-xs);pointer-events:none;';
            document.body.appendChild(c);
        }
        return c;
    }
    function showToast(message, type) {
        var color = 'var(--success-color)';
        var icon = 'fa-regular fa-circle-check';
        if (type === 'error') { color = 'var(--danger-color)'; icon = 'fa-regular fa-circle-exclamation'; }
        else if (type === 'warning') { color = 'var(--warning-color)'; icon = 'fa-regular fa-triangle-exclamation'; }
        var t = document.createElement('div');
        t.setAttribute('role', 'status');
        t.style.cssText = 'display:flex;align-items:center;gap:var(--space-sm);padding:var(--pad-3) var(--pad-5);background:var(--surface-color);color:var(--text-primary);border:1px solid var(--border-color);border-left-width:3px;border-left-color:' + color + ';border-radius:var(--radius);box-shadow:var(--shadow-lg);font-family:var(--font-primary);font-size:var(--text-sm);max-width:360px;pointer-events:auto;opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;';
        t.innerHTML = '<i class="' + icon + '" aria-hidden="true" style="color:' + color + ';"></i><span style="flex:1;">' + escapeHtml(message) + '</span>';
        ensureToastContainer().appendChild(t);
        requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
        setTimeout(function () {
            t.style.opacity = '0'; t.style.transform = 'translateY(8px)';
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
        }, 3500);
    }

    // ------------------------------------------------------------------------
    // BOOTSTRAP
    // ------------------------------------------------------------------------
    async function build() {
        var container = getOrCreateChatContainer();
        if (!container) {
            console.warn('[ChatModule] #modern-forum-wrapper not present — chat not built');
            return;
        }

        // Initial paint
        var msgs = readMessages();
        renderMessages(container, msgs, getCurrentUserId());

         var status = container.querySelector('.chat-status');
        if (status) {
            status.textContent = msgs.length === 0 ? 'No messages yet' :
                msgs.length + ' ' + (msgs.length === 1 ? 'message' : 'messages');
        }

        await buildComposer(container);

        // Repaint once the composer exists — the first read may have run
        // before hello-box finished hydrating its message list.
        setTimeout(function () {
            var fresh = readMessages();
            renderMessages(container, fresh, getCurrentUserId());
            if (status) {
                status.textContent = fresh.length === 0 ? 'No messages yet' :
                    fresh.length + ' ' + (fresh.length === 1 ? 'message' : 'messages');
            }
        }, 600);

        startPolling(container);

        console.log('[ChatModule] Chat surface built');
    }

    // ------------------------------------------------------------------------
    // TEARDOWN
    // ------------------------------------------------------------------------
    function reset() {
        stopPolling();

        _boundHandlers.forEach(function (h) {
            try { h.el.removeEventListener(h.type, h.handler, h.opts); } catch (e) {}
        });
        _boundHandlers = [];

        if (_editorInstance && !_editorInstance.isDestroyed) {
            try { _editorInstance.destroy(); } catch (e) {}
        }
        _editorInstance = null;

        _seenMessageIds.clear();
        _currentUserCache = null;

        var container = document.getElementById(CONFIG.CONTAINER_ID);
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }

        var toasts = document.getElementById('chat-toasts');
        if (toasts && toasts.parentNode) toasts.parentNode.removeChild(toasts);

        isInitialized = false;
    }

    // ------------------------------------------------------------------------
    // OBSERVER REGISTRATION
    //
    // Two watch points, deliberately split:
    //   - The wrapper must exist before we can insert anything.
    //   - The latest-posts / board-list anchors tell us when the boards
    //     module has finished building its lists, so our insertBefore
    //     lands in the correct slot rather than at the wrapper's tail.
    //
    // We register against #modern-forum-wrapper (always present after
    // forum-enhancer builds it) and re-check placement whenever either
    // anchor appears. The observer callbacks self-unregister once the
    // chat container exists.
    // ------------------------------------------------------------------------
    function registerObservers() {
        if (!globalThis.forumObserver || typeof globalThis.forumObserver.register !== 'function') {
            console.warn('[ChatModule] forumObserver unavailable — falling back to immediate build');
            build();
            return;
        }

        var wrapperId = globalThis.forumObserver.register({
            id: 'chat-module-wrapper',
            selector: '#modern-forum-wrapper',
            priority: 'high',
            callback: function () {
                if (globalThis.forumObserver && wrapperId != null) {
                    try { globalThis.forumObserver.unregister(wrapperId); } catch (e) {}
                }
                // Wait for the boards module to place its lists before
                // we insert — the module registers at high priority too,
                // and its conversion is async. A microtask defer plus a
                // short timeout gives the two sibling conversions room
                // to settle without hard-coupling to their timing.
                Promise.resolve().then(function () {
                    setTimeout(build, 100);
                });
            }
        });

        // A second observer for the anchors. If #modern-board-list or
        // #modern-latest-posts appears after our initial build (e.g.
        // boards.js converted asynchronously and finished later than
        // our 100ms window), relocate the chat container into the
        // correct slot. getOrCreateChatContainer() is idempotent and
        // only moves the node when it isn't already in place.
        var anchorId = globalThis.forumObserver.register({
            id: 'chat-module-anchors',
            selector: '#modern-board-list, #modern-latest-posts',
            priority: 'medium',
            callback: function () {
                var container = document.getElementById(CONFIG.CONTAINER_ID);
                if (!container) return;
                var wrapper = document.getElementById('modern-forum-wrapper');
                var boardList = document.getElementById('modern-board-list');
                if (wrapper && boardList && boardList.parentNode === wrapper && container.nextSibling !== boardList) {
                    wrapper.insertBefore(container, boardList);
                }
            }
        });

        observerCallbacks.push(wrapperId, anchorId);
    }

    // ------------------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------------------
    function initialize() {
        if (isInitialized) return Promise.resolve();
        isInitialized = true;

        return new Promise(function (resolve) {
            registerObservers();

            // Fallback: if the wrapper already exists when we boot (the
            // common case — forum-enhancer builds it synchronously before
            // modules initialize), skip the observer round-trip.
            if (document.getElementById('modern-forum-wrapper')) {
                setTimeout(function () {
                    build().then(resolve).catch(function (err) {
                        console.error('[ChatModule] Build failed:', err);
                        resolve();
                    });
                }, 150);
            } else {
                // Observer callback resolves the promise indirectly; we
                // resolve here on a timeout so a missing wrapper can't
                // hang the enhancer's module-init loop.
                setTimeout(resolve, 2000);
            }
        });
    }

    return {
        initialize: initialize,
        reset: reset,
        refresh: function () {
            var container = document.getElementById(CONFIG.CONTAINER_ID);
            if (!container) { build(); return; }
            renderMessages(container, readMessages(), getCurrentUserId());
        }
    };
})(
    typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
    typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus
);

// ---------------------------------------------------------------------------
// AUTO-INITIALIZE
//
// Mirrors the pattern the other modules use: boot immediately if the DOM
// is already parsed, otherwise wait for DOMContentLoaded. The enhancer's
// module registry will also call initialize() — the isInitialized guard
// makes the second call a no-op.
// ---------------------------------------------------------------------------
if (document.readyState === 'interactive' || document.readyState === 'complete') {
    setTimeout(function () { ChatModule.initialize(); }, 0);
} else {
    document.addEventListener('DOMContentLoaded', function () { ChatModule.initialize(); });
}

if (typeof window !== 'undefined') {
    window.ChatModule = ChatModule;
    window.dispatchEvent(new CustomEvent('chat-module-ready'));
}
