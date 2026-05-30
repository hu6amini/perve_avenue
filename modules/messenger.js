// Messenger Module – TipTap based, with lazy/async images, raw HTML output & rich link previews
var MessengerModule = (function(Utils, EventBus) {
    'use strict';

    var isInitialized = false;
    var observerCallbacks = [];
    var _originalEmoticon = null;

    var currentUrl = window.location.href;
    var currentSection = 'compose';
    if (currentUrl.indexOf('CODE=01') !== -1) {
        currentSection = 'messages';
    } else if (currentUrl.indexOf('CODE=02') !== -1) {
        currentSection = 'contacts';
    }

    // ------------------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------------------
    function initialize() {
        if (isInitialized) return Promise.resolve();
        if (document.body.id !== 'msg') return Promise.resolve();
        if (document.getElementById('modern-messenger')) {
            isInitialized = true;
            return Promise.resolve();
        }

        return new Promise(function(resolve, reject) {
            if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
                var wrapperReady = false;
                var targetReady = false;

                function tryBuild() {
                    if (wrapperReady && targetReady && !isInitialized && !document.getElementById('modern-messenger')) {
                        waitForGlobalFunctions()
                            .then(function() {
                                try {
                                    buildModernMessenger();
                                    isInitialized = true;
                                    if (EventBus) EventBus.trigger('messenger:ready');
                                    resolve();
                                } catch (err) {
                                    console.error('[MessengerModule] Build failed:', err);
                                    reject(err);
                                }
                            })
                            .catch(reject);
                    }
                }

                var wrapperObserverId = globalThis.forumObserver.register({
                    id: 'messenger-wrapper',
                    selector: '#modern-forum-wrapper',
                    priority: 'critical',
                    callback: function() {
                        wrapperReady = true;
                        if (wrapperObserverId) globalThis.forumObserver.unregister(wrapperObserverId);
                        tryBuild();
                    }
                });

                var targetSelector = '';
                if (currentSection === 'messages') {
                    targetSelector = '.big_list .row-mp';
                } else if (currentSection === 'contacts') {
                    targetSelector = 'textarea[name="can_contact"]';
                } else {
                    targetSelector = '.cp.send, #Post';
                }

                var targetObserverId = globalThis.forumObserver.register({
                    id: 'messenger-target',
                    selector: targetSelector,
                    priority: 'critical',
                    callback: function() {
                        targetReady = true;
                        if (targetObserverId) globalThis.forumObserver.unregister(targetObserverId);
                        tryBuild();
                    }
                });

                setTimeout(function() {
                    if (!wrapperReady) wrapperReady = true;
                    if (!targetReady) targetReady = true;
                    tryBuild();
                }, 1000);
            } else {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', function() {
                        waitForGlobalFunctions().then(function() {
                            buildModernMessenger();
                            isInitialized = true;
                            if (EventBus) EventBus.trigger('messenger:ready');
                            resolve();
                        }).catch(reject);
                    });
                } else {
                    waitForGlobalFunctions().then(function() {
                        buildModernMessenger();
                        isInitialized = true;
                        if (EventBus) EventBus.trigger('messenger:ready');
                        resolve();
                    }).catch(reject);
                }
            }
        });
    }

    function reset() {
        isInitialized = false;
        if (_originalEmoticon !== null) {
            window.emoticon = _originalEmoticon;
            _originalEmoticon = null;
        }
        observerCallbacks.forEach(function(id) {
            if (globalThis.forumObserver && typeof globalThis.forumObserver.unregister === 'function') {
                globalThis.forumObserver.unregister(id);
            }
        });
        observerCallbacks = [];
    }

    function waitForGlobalFunctions() {
        if (currentSection !== 'compose') return Promise.resolve();
        return new Promise(function(resolve) {
            if (typeof tag !== 'undefined' && typeof ajaxRequest !== 'undefined') {
                resolve();
            } else {
                setTimeout(resolve, 300);
            }
        });
    }

    // ------------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------------
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch(e) { return dateStr; }
    }

    // ------------------------------------------------------------------------
    // CONVERTERS (Legacy BBCode ↔ HTML) – keep for loading existing messages
    // ------------------------------------------------------------------------
    function legacyToHtml(legacy) {
        if (!legacy) return '';
        var html = legacy;
        html = html.replace(/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>');
        html = html.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');
        html = html.replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>');
        html = html.replace(/\[s\](.*?)\[\/s\]/gi, '<s>$1</s>');
        html = html.replace(/\[list\](.*?)\[\/list\]/gis, '<ul>$1</ul>');
        html = html.replace(/\[\*\](.*?)(?=\n|$)/gi, '<li>$1</li>');
        html = html.replace(/\[list=1\](.*?)\[\/list\]/gis, '<ol>$1</ol>');
        html = html.replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gi, '<a href="$1" target="_blank">$2</a>');
        html = html.replace(/\[img\](.*?)\[\/img\]/gi, '<img src="$1" alt="image" loading="lazy" decoding="async">');
        html = html.replace(/\[quote\](.*?)\[\/quote\]/gis, '<blockquote>$1</blockquote>');
        html = html.replace(/\[code\](.*?)\[\/code\]/gis, '<pre><code>$1</code></pre>');
        html = html.replace(/\[spoiler\](.*?)\[\/spoiler\]/gis, '<div class="spoiler">$1</div>');
        html = html.replace(/\[CENTER\](.*?)\[\/CENTER\]/gis, '<div style="text-align:center">$1</div>');
        html = html.replace(/\[font=([^\]]+)\](.*?)\[\/font\]/gi, '<span style="font-family:$1">$2</span>');
        html = html.replace(/\[size=([^\]]+)\](.*?)\[\/size\]/gi, '<span style="font-size:$1px">$2</span>');
        html = html.replace(/\[color=([^\]]+)\](.*?)\[\/color\]/gi, '<span style="color:$1">$2</span>');
        html = html.replace(/\[EMAIL\](.*?)\[\/EMAIL\]/gi, '<a href="mailto:$1">$1</a>');
        return html;
    }

    // No htmlToLegacy – we keep HTML in the textarea

    // ------------------------------------------------------------------------
    // COMPOSE SECTION – TipTap ES modules with custom Image and LinkPreview
    // ------------------------------------------------------------------------
    function buildComposeSection() {
        var recipientInput   = document.querySelector('input[name="entered_name"]');
        var contactSelect    = document.querySelector('select[name="from_contact"]');
        var titleInput       = document.querySelector('input[name="msg_title"]');
        var originalTextarea = document.getElementById('Post');
        var addSentCheckbox     = document.getElementById('add_sent');
        var addTrackingCheckbox = document.getElementById('add_tracking');
        var submitButton  = document.querySelector('input[name="sub_mit"]');
        var previewButton = document.querySelector('button[name="preview"]');
        var originalForm  = window.REPLIER;

        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'compose-section';

        // Recipient + Subject row
        var recipientRow = document.createElement('div');
        recipientRow.className = 'modern-recipient-row';
        recipientRow.innerHTML = ''
            + '<div class="modern-field">'
            + '<div class="modern-recipient-controls">'
            + '<input type="text" id="modern-recipient" class="modern-input" placeholder="Recipient" value="' + escapeHtml(recipientInput ? recipientInput.value : '') + '">'
            + '<select id="modern-contact" class="modern-select">' + (contactSelect ? contactSelect.innerHTML : '') + '</select>'
            + '</div></div>'
            + '<div class="modern-field">'
            + '<input type="text" id="modern-title" class="modern-input" placeholder="Subject" value="' + escapeHtml(titleInput ? titleInput.value : '') + '">'
            + '</div>';
        container.appendChild(recipientRow);

        // Toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';
        container.appendChild(toolbar);

        var editorElement = document.createElement('div');
        editorElement.id = 'tiptap-editor';
        editorElement.className = 'modern-wysiwyg';
        container.appendChild(editorElement);

        var editor = null;
        var activeButtonElements = [];

        function addSeparator() {
            var sep = document.createElement('span');
            sep.className = 'toolbar-separator';
            sep.style.cssText = 'width:1px;height:1.5rem;background:var(--border-color);margin:0 var(--space-sm);display:inline-block;vertical-align:middle;';
            toolbar.appendChild(sep);
        }

        function exec(cmd) {
            if (!editor) return;
            cmd();
            editor.commands.focus();
        }

        // ----- Build toolbar UI -----
        var group1 = [
            { title: 'Bold',           icon: 'fa-regular fa-bold',          btn: null },
            { title: 'Italic',         icon: 'fa-regular fa-italic',        btn: null },
            { title: 'Underline',      icon: 'fa-regular fa-underline',     btn: null },
            { title: 'Strikethrough',  icon: 'fa-regular fa-strikethrough', btn: null }
        ];
        for (var i = 0; i < group1.length; i++) {
            var g = group1[i];
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'modern-editor-btn';
            button.innerHTML = '<i class="' + g.icon + '"></i>';
            button.title = g.title;
            toolbar.appendChild(button);
            g.btn = button;
            activeButtonElements.push(button);
        }
        addSeparator();

        var listDropdownContainer = document.createElement('div');
        listDropdownContainer.className = 'modern-dropdown';
        listDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var listDropdownBtn = document.createElement('button');
        listDropdownBtn.type = 'button';
        listDropdownBtn.className = 'modern-editor-btn';
        listDropdownBtn.innerHTML = '<i class="fa-regular fa-list"></i> <i class="fa-regular fa-chevron-down" style="font-size:0.7rem;"></i>';
        listDropdownBtn.title = 'Insert list';
        var listDropdownMenu = document.createElement('div');
        listDropdownMenu.className = 'modern-dropdown-menu';
        listDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        listDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" id="bullet-list-option"><i class="fa-regular fa-list"></i> Bullet list</button>'
            + '<button class="modern-dropdown-item" id="ordered-list-option"><i class="fa-regular fa-list-ol"></i> Ordered list</button>';
        listDropdownContainer.appendChild(listDropdownBtn);
        listDropdownContainer.appendChild(listDropdownMenu);
        toolbar.appendChild(listDropdownContainer);
        listDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            listDropdownMenu.style.display = listDropdownMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', function() { listDropdownMenu.style.display = 'none'; });
        listDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

        var blockquoteBtn = document.createElement('button');
        blockquoteBtn.type = 'button';
        blockquoteBtn.className = 'modern-editor-btn';
        blockquoteBtn.innerHTML = '<i class="fa-regular fa-quote-left"></i>';
        blockquoteBtn.title = 'Blockquote';
        toolbar.appendChild(blockquoteBtn);
        activeButtonElements.push(blockquoteBtn);

        var codeBtn = document.createElement('button');
        codeBtn.type = 'button';
        codeBtn.className = 'modern-editor-btn';
        codeBtn.innerHTML = '<i class="fa-regular fa-code"></i>';
        codeBtn.title = 'Code block';
        toolbar.appendChild(codeBtn);
        activeButtonElements.push(codeBtn);
        addSeparator();

        var linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'modern-editor-btn';
        linkBtn.innerHTML = '<i class="fa-regular fa-link"></i>';
        linkBtn.title = 'Insert link';
        toolbar.appendChild(linkBtn);
        activeButtonElements.push(linkBtn);

        var imageDropdownContainer = document.createElement('div');
        imageDropdownContainer.className = 'modern-dropdown';
        imageDropdownContainer.style.cssText = 'position:relative;display:inline-block';
        var imageDropdownBtn = document.createElement('button');
        imageDropdownBtn.type = 'button';
        imageDropdownBtn.className = 'modern-editor-btn';
        imageDropdownBtn.innerHTML = '<i class="fa-regular fa-image"></i> <i class="fa-regular fa-chevron-down" style="font-size:0.7rem;"></i>';
        imageDropdownBtn.title = 'Insert image';
        var imageDropdownMenu = document.createElement('div');
        imageDropdownMenu.className = 'modern-dropdown-menu';
        imageDropdownMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        imageDropdownMenu.innerHTML = ''
            + '<button class="modern-dropdown-item" id="image-url-option"><i class="fa-regular fa-link"></i> By URL</button>'
            + '<button class="modern-dropdown-item" id="image-upload-option"><i class="fa-regular fa-cloud-arrow-up"></i> Upload from computer</button>';
        imageDropdownContainer.appendChild(imageDropdownBtn);
        imageDropdownContainer.appendChild(imageDropdownMenu);
        toolbar.appendChild(imageDropdownContainer);
        imageDropdownBtn.onclick = function(e) {
            e.stopPropagation();
            imageDropdownMenu.style.display = imageDropdownMenu.style.display === 'block' ? 'none' : 'block';
        };
        document.addEventListener('click', function() { imageDropdownMenu.style.display = 'none'; });
        imageDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });
        addSeparator();

        var spoilerBtn = document.createElement('button');
        spoilerBtn.type = 'button';
        spoilerBtn.className = 'modern-editor-btn';
        spoilerBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
        spoilerBtn.title = 'Spoiler';
        toolbar.appendChild(spoilerBtn);
        activeButtonElements.push(spoilerBtn);

        var smileBtn = document.createElement('button');
        smileBtn.type = 'button';
        smileBtn.className = 'modern-editor-btn';
        smileBtn.innerHTML = '<i class="fa-regular fa-face-smile"></i>';
        smileBtn.title = 'Insert smiley';
        toolbar.appendChild(smileBtn);

        // -----------------------------------------------------------------
        // UPLOAD FUNCTION – uses worker that returns url + width + height
        // -----------------------------------------------------------------
        function uploadImageToWorker(file, editorInstance) {
            var formData = new FormData();
            formData.append('image', file);
            var currentPos = editorInstance.state.selection.from;
            editorInstance.chain().focus().insertContent('⬆️ Uploading...').run();
            var placeholderStart = currentPos;
            var placeholderEnd = currentPos + '⬆️ Uploading...'.length;

            fetch('https://imgbb-upload-proxy.nhristakiev.workers.dev/', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                editorInstance.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run();
                if (data.url) {
                    editorInstance.chain().focus().insertContent({
                        type: 'image',
                        attrs: {
                            src: data.url,
                            alt: 'Uploaded image',
                            loading: 'lazy',
                            decoding: 'async',
                            width: data.width ? parseInt(data.width) : null,
                            height: data.height ? parseInt(data.height) : null
                        }
                    }).run();
                } else {
                    editorInstance.chain().focus().insertContent('[Upload failed]').run();
                }
            })
            .catch(error => {
                console.error('Upload error:', error);
                editorInstance.chain().focus().deleteRange({ from: placeholderStart, to: placeholderEnd }).run();
                editorInstance.chain().focus().insertContent('[Upload error]').run();
            });
        }

        function showInputModal(title, placeholder, callback) {
            var modalOverlay = document.createElement('div');
            modalOverlay.className = 'modern-modal-overlay';
            modalOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
            var modalBox = document.createElement('div');
            modalBox.className = 'modern-modal-box';
            modalBox.style.cssText = 'background:var(--surface-color);border-radius:var(--radius-lg);padding:var(--space-lg);width:340px;max-width:90%;box-shadow:var(--shadow-lg);';
            modalBox.innerHTML = ''
                + '<h3 style="margin:0 0 var(--space-md) 0;">' + escapeHtml(title) + '</h3>'
                + '<input type="text" id="modal-input" class="modern-input" placeholder="' + escapeHtml(placeholder) + '" style="width:100%;">'
                + '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">'
                + '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>'
                + '<button id="modal-submit" class="modern-btn modern-btn-primary">Insert</button>'
                + '</div>';
            modalOverlay.appendChild(modalBox);
            document.body.appendChild(modalOverlay);
            var input = modalBox.querySelector('#modal-input');
            input.focus();
            function close() { modalOverlay.remove(); }
            modalBox.querySelector('#modal-cancel').onclick = close;
            modalBox.querySelector('#modal-submit').onclick = function() {
                var val = input.value.trim();
                if (val) callback(val);
                close();
            };
            input.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') modalBox.querySelector('#modal-submit').click();
            });
        }

        // -----------------------------------------------------------------
        // Load TipTap ES modules with custom Image and LinkPreview
        // -----------------------------------------------------------------
        (async function initTipTap() {
            try {
                const core = await import('https://esm.sh/@tiptap/core@2.5.2');
                const Editor = core.Editor || (core.default && core.default.Editor);
                const Node = core.Node || (core.default && core.default.Node);
                
                if (!Editor || !Node) {
                    throw new Error('Editor or Node not found in @tiptap/core');
                }

                // Import ProseMirror state for paste plugin
                const { Plugin, PluginKey } = await import('https://esm.sh/prosemirror-state@1.4.3');

                const starterKitModule = await import('https://esm.sh/@tiptap/starter-kit@2.5.2');
                const placeholderModule = await import('https://esm.sh/@tiptap/extension-placeholder@2.5.2');
                const underlineModule = await import('https://esm.sh/@tiptap/extension-underline@2.5.2');
                const imageModule = await import('https://esm.sh/@tiptap/extension-image@2.5.2');

                const StarterKit = starterKitModule.StarterKit || (starterKitModule.default && starterKitModule.default.StarterKit);
                const Placeholder = placeholderModule.Placeholder || (placeholderModule.default && placeholderModule.default.Placeholder);
                const Underline = underlineModule.Underline || (underlineModule.default && underlineModule.default.Underline);
                const BaseImage = imageModule.Image || (imageModule.default && imageModule.default.Image);

                // -----------------------------------------------------------------
                // Custom Image extension with lazy loading, async decoding, width/height
                // -----------------------------------------------------------------
                const CustomImage = BaseImage.extend({
                    inline: true,
                    group: 'inline',
                    addAttributes() {
                        return {
                            ...this.parent?.(),
                            src: { default: null },
                            alt: { default: 'image' },
                            width: { default: null },
                            height: { default: null },
                            loading: { default: 'lazy' },
                            decoding: { default: 'async' },
                        };
                    },
                    renderHTML({ node, HTMLAttributes }) {
                        return [
                            'img',
                            {
                                ...HTMLAttributes,
                                src: node.attrs.src,
                                alt: node.attrs.alt,
                                loading: node.attrs.loading,
                                decoding: node.attrs.decoding,
                                width: node.attrs.width,
                                height: node.attrs.height,
                            },
                        ];
                    },
                });

                // -----------------------------------------------------------------
                // Link Preview Node (rich card) – with fallback to simple inline link
                // -----------------------------------------------------------------
                const LinkPreview = Node.create({
                    name: 'linkPreview',
                    inline: true,
                    group: 'inline',
                    atom: true,
                    draggable: true,
                    selectable: true,
                    addAttributes() {
                        return {
                            href: { default: '' },
                            title: { default: '' },
                            description: { default: '' },
                            imageSrc: { default: '' },
                        };
                    },
                    parseHTML() {
                        return [{ tag: 'span[data-type="link-preview"]' }];
                    },
                    renderHTML({ node, HTMLAttributes }) {
                        var href = node.attrs.href;
                        var title = node.attrs.title;
                        var description = node.attrs.description;
                        var imageSrc = node.attrs.imageSrc;

                        // Extract hostname for favicon and display
                        var hostname = '';
                        try {
                            var urlObj = new URL(href);
                            hostname = urlObj.hostname.replace(/^www\./, '');
                        } catch (e) {
                            hostname = href.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
                        }
                        var faviconUrl = 'https://www.google.com/s2/favicons?domain=' + hostname + '&sz=32';

                        var isRich = imageSrc && imageSrc.trim() !== '';

                        if (!isRich) {
    // Helper to detect generic challenge titles
    function isGenericTitle(t, h) {
        if (!t || t === h) return true;
        var generic = ['just a moment', 'access denied', 'verification required', 'please wait', 'captcha', 'challenge'];
        var lower = t.toLowerCase();
        return generic.some(function(term) { return lower.indexOf(term) !== -1; });
    }
    var showTitle = !isGenericTitle(title, href);
    var titlePart = showTitle ? (' – ' + title) : '';
    return [
        'span',
        { class: 'link-preview-simple', 'data-type': 'link-preview', ...HTMLAttributes },
        [
            'a',
            { href: href, target: '_blank', rel: 'noopener noreferrer', class: 'simple-link' },
            ['img', { src: faviconUrl, class: 'simple-favicon', alt: '', loading: 'lazy' }],
            ['span', { class: 'simple-hostname' }, hostname],
            ['span', { class: 'simple-title' }, titlePart]
        ]
    ];
}

                        // Rich card layout
                        return [
                            'span',
                            { class: 'link-preview-card', 'data-type': 'link-preview', ...HTMLAttributes },
                            [
                                'a',
                                { href: href, target: '_blank', rel: 'noopener noreferrer', class: 'link-preview-link' },
                                [
                                    'span',
                                    { class: 'link-preview-content' },
                                    [
                                        'span',
                                        { class: 'embedded-link-image' },
                                        ['img', { src: imageSrc, class: 'link-preview-image', loading: 'lazy', alt: '' }]
                                    ],
                                    [
                                        'span',
                                        { class: 'link-preview-text' },
                                        ['span', { class: 'link-preview-title' }, title || href],
                                        description ? ['span', { class: 'link-preview-description' }, description] : '',
                                        [
                                            'span',
                                            { class: 'link-preview-url-wrapper' },
                                            ['img', { src: faviconUrl, class: 'link-preview-favicon', alt: '' }],
                                            ['span', { class: 'link-preview-hostname' }, hostname]
                                        ]
                                    ]
                                ]
                            ]
                        ];
                    },
                });

                // -----------------------------------------------------------------
                // Spoiler extension (block)
                // -----------------------------------------------------------------
                const Spoiler = Node.create({
                    name: 'spoiler',
                    group: 'block',
                    content: 'block+',
                    defining: true,
                    parseHTML: () => [{ tag: 'div.spoiler' }],
                    renderHTML: () => ['div', { class: 'spoiler' }, 0],
                });

                // -----------------------------------------------------------------
                // Paste handler plugin – converts pasted URLs to LinkPreview nodes
                // -----------------------------------------------------------------
                const linkPreviewPlugin = new Plugin({
                    key: new PluginKey('linkPreview'),
                    props: {
                        handlePaste: (view, event) => {
                            var text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                            if (!text) return false;
                            
                            var urlRegex = /(https?:\/\/[^\s]+)/g;
                            var match = urlRegex.exec(text);
                            if (!match) return false;
                            
                            var url = match[0];
                            
                            fetch('https://og-worker.nhristakiev.workers.dev/?url=' + encodeURIComponent(url))
                                .then(function(res) { return res.json(); })
                                .then(function(data) {
                                    if (data.error || (!data.imageSrc && (!data.title || data.title === url))) {
                                        // Fallback: insert a plain text link (no card)
                                        var state = view.state;
                                        var dispatch = view.dispatch;
                                        var from = state.selection.from;
                                        var to = state.selection.to;
                                        var tr = state.tr.replaceWith(from, to, state.schema.text(url));
                                        dispatch(tr);
                                        return;
                                    }
                                    var title = data.title;
                                    var description = data.description;
                                    var imageSrc = data.imageSrc;
                                    var href = data.href;
                                    var state = view.state;
                                    var dispatch = view.dispatch;
                                    var from = state.selection.from;
                                    var to = state.selection.to;
                                    var tr = state.tr.replaceWith(
                                        from, to,
                                        state.schema.nodes.linkPreview.create({
                                            href: href || url,
                                            title: title || url,
                                            description: description || '',
                                            imageSrc: imageSrc || '',
                                        })
                                    );
                                    dispatch(tr);
                                })
                                .catch(function(err) {
                                    console.error('Link preview error:', err);
                                    var state = view.state;
                                    var dispatch = view.dispatch;
                                    var from = state.selection.from;
                                    var to = state.selection.to;
                                    var tr = state.tr.replaceWith(from, to, state.schema.text(url));
                                    dispatch(tr);
                                });
                            
                            return true; // Prevent default paste
                        },
                    },
                });

                // -----------------------------------------------------------------
                // Create editor instance
                // -----------------------------------------------------------------
                var initialHtml = legacyToHtml(originalTextarea ? originalTextarea.value : '');
                editor = new Editor({
                    element: editorElement,
                    extensions: [
                        StarterKit,
                        Placeholder.configure({ placeholder: '💬 Write your message...' }),
                        Underline,
                        CustomImage,
                        Spoiler,
                        LinkPreview,
                    ],
                    content: initialHtml,
                    editorProps: {
                        attributes: { class: 'modern-wysiwyg-content' },
                        plugins: [linkPreviewPlugin],
                    },
                    onUpdate: function({ editor }) {
                        if (originalTextarea) {
                            originalTextarea.value = editor.getHTML();
                        }
                    }
                });

                // -----------------------------------------------------------------
                // Assign toolbar actions
                // -----------------------------------------------------------------
                group1[0].btn.onclick = function() { exec(function() { editor.chain().focus().toggleBold().run(); }); };
                group1[1].btn.onclick = function() { exec(function() { editor.chain().focus().toggleItalic().run(); }); };
                group1[2].btn.onclick = function() { exec(function() { editor.chain().focus().toggleUnderline().run(); }); };
                group1[3].btn.onclick = function() { exec(function() { editor.chain().focus().toggleStrike().run(); }); };

                listDropdownMenu.querySelector('#bullet-list-option').onclick = function() {
                    exec(function() { editor.chain().focus().toggleBulletList().run(); });
                    listDropdownMenu.style.display = 'none';
                };
                listDropdownMenu.querySelector('#ordered-list-option').onclick = function() {
                    exec(function() { editor.chain().focus().toggleOrderedList().run(); });
                    listDropdownMenu.style.display = 'none';
                };
                blockquoteBtn.onclick = function() { exec(function() { editor.chain().focus().toggleBlockquote().run(); }); };
                codeBtn.onclick = function() { exec(function() { editor.chain().focus().toggleCodeBlock().run(); }); };

                linkBtn.onclick = function() {
                    if (!editor) return;
                    var from = editor.state.selection.from;
                    var to = editor.state.selection.to;
                    var selectedText = editor.state.doc.textBetween(from, to, '');
                    showInputModal('Insert link', 'https://example.com', function(url) {
                        if (selectedText) {
                            editor.chain().focus().setLink({ href: url }).run();
                        } else {
                            editor.chain().focus().insertContent('<a href="' + url + '">' + url + '</a>').run();
                        }
                    });
                };

                imageDropdownMenu.querySelector('#image-url-option').onclick = function() {
                    showInputModal('Insert image URL', 'https://example.com/image.jpg', function(url) {
                        var img = new Image();
                        img.onload = function() {
                            editor.chain().focus().insertContent({
                                type: 'image',
                                attrs: {
                                    src: url,
                                    alt: 'image',
                                    loading: 'lazy',
                                    decoding: 'async',
                                    width: this.width,
                                    height: this.height
                                }
                            }).run();
                        };
                        img.onerror = function() {
                            editor.chain().focus().insertContent({
                                type: 'image',
                                attrs: { src: url, alt: 'image', loading: 'lazy', decoding: 'async' }
                            }).run();
                        };
                        img.src = url;
                    });
                    imageDropdownMenu.style.display = 'none';
                };

                imageDropdownMenu.querySelector('#image-upload-option').onclick = function() {
                    var input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = function() {
                        if (input.files && input.files[0]) {
                            uploadImageToWorker(input.files[0], editor);
                        }
                    };
                    input.click();
                    imageDropdownMenu.style.display = 'none';
                };

                spoilerBtn.onclick = function() { exec(function() { editor.chain().focus().toggleSpoiler().run(); }); };
                smileBtn.onclick = function() {
                    var smiliesDiv = document.getElementById('smilies');
                    if (smiliesDiv) smiliesDiv.classList.toggle('nascosta');
                };

                function updateActiveStates() {
                    var isActive = {
                        bold: editor.isActive('bold'),
                        italic: editor.isActive('italic'),
                        underline: editor.isActive('underline'),
                        strike: editor.isActive('strike'),
                        bulletList: editor.isActive('bulletList'),
                        orderedList: editor.isActive('orderedList'),
                        blockquote: editor.isActive('blockquote'),
                        codeBlock: editor.isActive('codeBlock'),
                        spoiler: editor.isActive('spoiler')
                    };
                    group1[0].btn.classList.toggle('active', isActive.bold);
                    group1[1].btn.classList.toggle('active', isActive.italic);
                    group1[2].btn.classList.toggle('active', isActive.underline);
                    group1[3].btn.classList.toggle('active', isActive.strike);
                    blockquoteBtn.classList.toggle('active', isActive.blockquote);
                    codeBtn.classList.toggle('active', isActive.codeBlock);
                    spoilerBtn.classList.toggle('active', isActive.spoiler);
                }
                editor.on('selectionUpdate', updateActiveStates);
                editor.on('transaction', updateActiveStates);
                updateActiveStates();

                var editorRoot = editorElement.querySelector('.ProseMirror');
                if (editorRoot) {
                    editorRoot.setAttribute('dropzone', 'copy');
                    editorRoot.addEventListener('dragover', function(e) { e.preventDefault(); });
                    editorRoot.addEventListener('drop', function(e) {
                        e.preventDefault();
                        var file = e.dataTransfer.files[0];
                        if (file && file.type.startsWith('image/')) {
                            uploadImageToWorker(file, editor);
                        }
                    });
                }

                editor.setOptions({
                    editorProps: {
                        handleDOMEvents: {
                            keydown: function(view, event) {
                                if (event.ctrlKey && event.shiftKey && event.key === 'S') {
                                    event.preventDefault();
                                    editor.chain().focus().toggleSpoiler().run();
                                    return true;
                                }
                                return false;
                            }
                        }
                    }
                });

                _originalEmoticon = window.emoticon;
                window.emoticon = function(x) {
                    if (editor) {
                        editor.chain().focus().insertContent(' ' + x + ' ').run();
                    } else if (_originalEmoticon) {
                        _originalEmoticon(x);
                    }
                };
            } catch (err) {
                console.error('[MessengerModule] TipTap failed to load:', err);
                editorElement.innerHTML = '<div style="color:red;padding:1rem;">Editor failed to load. Please refresh the page.<br>' + escapeHtml(err.message) + '</div>';
            }
        })();

        // Options row, action buttons, data binding (raw HTML)
        var optionsRow = document.createElement('div');
        optionsRow.className = 'modern-options';
        optionsRow.innerHTML = ''
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-sent" '     + (addSentCheckbox     && addSentCheckbox.checked     ? 'checked' : '') + '> <span>Add a copy to Sent Items</span></label>'
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-tracking" ' + (addTrackingCheckbox && addTrackingCheckbox.checked ? 'checked' : '') + '> <span>Notify when read</span></label>';
        container.appendChild(optionsRow);

        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        actions.innerHTML = ''
            + '<button type="button" id="modern-preview" class="modern-btn modern-btn-secondary"><i class="fa-regular fa-eye"></i> Preview</button>'
            + '<button type="button" id="modern-submit"  class="modern-btn modern-btn-primary"><i class="fa-regular fa-paper-plane"></i> Send message</button>';
        container.appendChild(actions);

        var previewArea = document.createElement('div');
        previewArea.id = 'modern-preview-area';
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<div class="preview-content"></div>';
        container.appendChild(previewArea);

        var modernRecipient   = container.querySelector('#modern-recipient');
        var modernContact     = container.querySelector('#modern-contact');
        var modernTitle       = container.querySelector('#modern-title');
        var modernAddSent     = container.querySelector('#modern-add-sent');
        var modernAddTracking = container.querySelector('#modern-add-tracking');

        function syncToOriginal() {
            if (recipientInput && modernRecipient) recipientInput.value = modernRecipient.value;
            if (contactSelect && modernContact) contactSelect.value = modernContact.value;
            if (titleInput && modernTitle) titleInput.value = modernTitle.value;
            if (addSentCheckbox && modernAddSent) addSentCheckbox.checked = modernAddSent.checked;
            if (addTrackingCheckbox && modernAddTracking) addTrackingCheckbox.checked = modernAddTracking.checked;
        }
        function syncFromOriginal() {
            if (recipientInput && modernRecipient) modernRecipient.value = recipientInput.value;
            if (contactSelect && modernContact) modernContact.value = contactSelect.value;
            if (titleInput && modernTitle) modernTitle.value = titleInput.value;
            if (addSentCheckbox && modernAddSent) modernAddSent.checked = addSentCheckbox.checked;
            if (addTrackingCheckbox && modernAddTracking) modernAddTracking.checked = addTrackingCheckbox.checked;
        }

        if (modernRecipient)   modernRecipient.addEventListener('input', syncToOriginal);
        if (modernContact)     modernContact.addEventListener('change', syncToOriginal);
        if (modernTitle)       modernTitle.addEventListener('input', syncToOriginal);
        if (modernAddSent)     modernAddSent.addEventListener('change', syncToOriginal);
        if (modernAddTracking) modernAddTracking.addEventListener('change', syncToOriginal);
        syncFromOriginal();

        var modernPreviewBtn = container.querySelector('#modern-preview');
        if (modernPreviewBtn) {
            modernPreviewBtn.onclick = function() {
                syncToOriginal();
                if (originalTextarea && editor) originalTextarea.value = editor.getHTML();
                if (typeof ajaxRequest === 'function') ajaxRequest();
                else if (previewButton) previewButton.click();
                var loadingDiv = document.getElementById('loading');
                if (loadingDiv) {
                    loadingDiv.style.display = 'block';
                    previewArea.style.display = 'block';
                    var observer = new MutationObserver(function() {
                        var ajaxObj = document.getElementById('ajaxObject');
                        if (ajaxObj && ajaxObj.innerHTML) {
                            var pc = previewArea.querySelector('.preview-content');
                            if (pc) pc.innerHTML = ajaxObj.innerHTML;
                            observer.disconnect();
                        }
                    });
                    observer.observe(loadingDiv, { childList: true, subtree: true });
                }
            };
        }

        var modernSubmitBtn = container.querySelector('#modern-submit');
        if (modernSubmitBtn) {
            modernSubmitBtn.onclick = function(e) {
                e.preventDefault();
                syncToOriginal();
                if (originalTextarea && editor) originalTextarea.value = editor.getHTML();
                if (originalForm && typeof originalForm.submit === 'function') {
                    if (typeof ValidateForm === 'function' && !ValidateForm(1)) return;
                    originalForm.submit();
                } else if (submitButton) {
                    submitButton.click();
                }
            };
        }

        return container;
    }

    // ------------------------------------------------------------------------
    // MESSAGES SECTION (unchanged – keep your existing)
    // ------------------------------------------------------------------------
    function buildModernMessagesSection() {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'messages-section';
        try {
            var folderSelect  = document.querySelector('select[name="VID"]');
            var messageRows   = document.querySelectorAll('.big_list .row-mp');
            var dlItems       = document.querySelectorAll('.main_list dl dd');
            var totalMessages = dlItems.length >= 1 ? dlItems[0].innerText.trim() : '0';
            var spaceLeft     = dlItems.length >= 2 ? dlItems[1].innerText.trim() : '0';
            var folderRow = document.createElement('div');
            folderRow.className = 'messages-folder-row';
            folderRow.innerHTML = ''
                + '<div class="messages-stats">'
                + '<span><i class="fa-regular fa-envelope"></i> Total: ' + escapeHtml(totalMessages) + '</span>'
                + '<span><i class="fa-regular fa-database"></i> Space left: ' + escapeHtml(spaceLeft) + '</span>'
                + '</div>'
                + '<div class="messages-folder-selector">'
                + '<label>Folder:</label> '
                + '<select id="modern-folder-select" class="modern-select">'
                + (folderSelect ? folderSelect.innerHTML : '<option value="in">Inbox</option><option value="sent">Sent Items</option>')
                + '</select>'
                + '</div>';
            container.appendChild(folderRow);
            var listHeader = document.createElement('div');
            listHeader.className = 'messages-list-header';
            listHeader.innerHTML = ''
                + '<div class="msg-status"></div>'
                + '<div class="msg-title">Message Title</div>'
                + '<div class="msg-sender">Sender</div>'
                + '<div class="msg-date">Date</div>'
                + '<div class="msg-select"><input type="checkbox" id="select-all-msgs" class="modern-checkbox-input"></div>';
            container.appendChild(listHeader);
            var listContainer = document.createElement('div');
            listContainer.className = 'messages-list';
            for (var i = 0; i < messageRows.length; i++) {
                var row = messageRows[i];
                var isUnread   = row.classList.contains('on');
                var titleLink  = row.querySelector('.bb h4 a');
                var senderLink = row.querySelector('.xx a');
                var dateSpan   = row.querySelector('.zz .when');
                var date       = dateSpan ? (dateSpan.getAttribute('title') || dateSpan.textContent) : '';
                var origCheckbox = row.querySelector('input[type="checkbox"]');
                var msgName = origCheckbox ? origCheckbox.name : '';
                var msgRow = document.createElement('div');
                msgRow.className = 'message-row' + (isUnread ? ' unread' : ' read');
                msgRow.innerHTML = ''
                    + '<div class="msg-status"><i class="fa-regular ' + (isUnread ? 'fa-envelope' : 'fa-envelope-open') + '"></i></div>'
                    + '<div class="msg-title"><a href="' + escapeHtml(titleLink ? titleLink.getAttribute('href') : '#') + '">' + escapeHtml(titleLink ? titleLink.textContent.trim() : '(no title)') + '</a></div>'
                    + '<div class="msg-sender"><a href="' + escapeHtml(senderLink ? senderLink.getAttribute('href') : '#') + '">' + escapeHtml(senderLink ? senderLink.textContent.trim() : 'Unknown') + '</a></div>'
                    + '<div class="msg-date">' + escapeHtml(formatDate(date)) + '</div>'
                    + '<div class="msg-select"><input type="checkbox" class="modern-checkbox-input" name="' + escapeHtml(msgName) + '" id="msg-' + i + '"></div>';
                listContainer.appendChild(msgRow);
            }
            container.appendChild(listContainer);
            var actionBar = document.createElement('div');
            actionBar.className = 'messages-action-bar';
            actionBar.innerHTML = ''
                + '<div class="action-group">'
                + '<button class="modern-btn modern-btn-secondary" id="export-messages"><i class="fa-regular fa-download"></i> Export as</button> '
                + '<select id="export-format" class="modern-select-sm"><option value="html">HTML</option><option value="xls">Excel</option></select>'
                + '</div>'
                + '<div class="action-group">'
                + '<button class="modern-btn modern-btn-secondary" id="move-messages"><i class="fa-regular fa-folder-open"></i> Move to</button> '
                + '<select id="move-folder" class="modern-select-sm"><option value="in">Inbox</option><option value="sent">Sent Items</option></select>'
                + '</div>'
                + '<div class="action-group">'
                + '<button class="modern-btn modern-btn-secondary danger" id="delete-messages"><i class="fa-regular fa-trash-can"></i> Delete selected</button>'
                + '</div>';
            container.appendChild(actionBar);
            var folderForm   = folderSelect ? folderSelect.form : null;
            var inboxForm    = document.querySelector('form[name="inbox"]');
            var modernFolder = container.querySelector('#modern-folder-select');
            if (modernFolder && folderSelect && folderForm) {
                modernFolder.addEventListener('change', function() {
                    folderSelect.value = this.value;
                    folderForm.submit();
                });
            }
            var selectAll = container.querySelector('#select-all-msgs');
            if (selectAll) {
                selectAll.addEventListener('change', function() {
                    container.querySelectorAll('.message-row .modern-checkbox-input').forEach(function(cb) {
                        cb.checked = selectAll.checked;
                    });
                });
            }
            function syncCheckboxesToForm() {
                if (!inboxForm) return;
                container.querySelectorAll('.message-row .modern-checkbox-input').forEach(function(cb) {
                    var hidden = inboxForm.querySelector('input[name="' + cb.name + '"]');
                    if (hidden) hidden.checked = cb.checked;
                });
            }
            var exportBtn = container.querySelector('#export-messages');
            if (exportBtn && inboxForm) {
                exportBtn.addEventListener('click', function() {
                    syncCheckboxesToForm();
                    var fmt = container.querySelector('#export-format');
                    var typeSelect = inboxForm.querySelector('select[name="type"]');
                    if (fmt && typeSelect) typeSelect.value = fmt.value;
                    var archiveBtn = inboxForm.querySelector('input[name="archive"]');
                    if (archiveBtn) archiveBtn.click(); else inboxForm.submit();
                });
            }
            var deleteBtn = container.querySelector('#delete-messages');
            if (deleteBtn && inboxForm) {
                deleteBtn.addEventListener('click', function() {
                    if (!confirm('Delete selected messages?')) return;
                    syncCheckboxesToForm();
                    var delBtn = inboxForm.querySelector('input[name="delete"]');
                    if (delBtn) delBtn.click(); else inboxForm.submit();
                });
            }
            var moveBtn = container.querySelector('#move-messages');
            if (moveBtn && inboxForm) {
                moveBtn.addEventListener('click', function() {
                    syncCheckboxesToForm();
                    var dest = container.querySelector('#move-folder');
                    var vidSelect = inboxForm.querySelector('select[name="VID"]');
                    if (dest && vidSelect) vidSelect.value = dest.value;
                    var moveInput = inboxForm.querySelector('input[name="move"]');
                    if (moveInput) moveInput.click(); else inboxForm.submit();
                });
            }
        } catch (err) {
            console.error('[MessengerModule] Error building messages section:', err);
            var cpEl = document.querySelector('.cp');
            if (cpEl) {
                var clone = cpEl.cloneNode(true);
                var tabs = clone.querySelector('.tabs');
                if (tabs) tabs.remove();
                container.appendChild(clone);
            } else {
                container.innerHTML = '<div class="modern-empty-state"><i class="fa-regular fa-inbox"></i><p>Unable to load messages</p></div>';
            }
        }
        return container;
    }

    // ------------------------------------------------------------------------
    // CONTACTS SECTION (unchanged – keep your existing)
    // ------------------------------------------------------------------------
    function buildModernContactsSection() {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'contacts-section';
        try {
            var friendsTextarea = document.querySelector('textarea[name="can_contact"]');
            var blockedTextarea = document.querySelector('textarea[name="cannot_contact"]');
            var privacySelect   = document.querySelector('select[name="nobody_can_contact"]');
            var updateButton    = document.querySelector('input[value="Update Contact list"]');
            var friendsCard = document.createElement('div');
            friendsCard.className = 'contacts-card';
            friendsCard.innerHTML = ''
                + '<h3 class="contacts-card-title"><i class="fa-regular fa-user-group"></i> Friends list</h3>'
                + '<textarea id="modern-friends-list" class="modern-textarea-contacts" rows="8" placeholder="One username per line">' + escapeHtml(friendsTextarea ? friendsTextarea.value : '') + '</textarea>'
                + '<p class="contacts-help">Users you allow to message you when privacy mode is on.</p>';
            container.appendChild(friendsCard);
            var blockedCard = document.createElement('div');
            blockedCard.className = 'contacts-card';
            blockedCard.innerHTML = ''
                + '<h3 class="contacts-card-title"><i class="fa-regular fa-ban"></i> Blocked users</h3>'
                + '<textarea id="modern-blocked-list" class="modern-textarea-contacts" rows="5" placeholder="One username per line">' + escapeHtml(blockedTextarea ? blockedTextarea.value : '') + '</textarea>'
                + '<p class="contacts-help">These users cannot send you messages or mention you.</p>';
            container.appendChild(blockedCard);
            var privacyVal = privacySelect ? privacySelect.value : '0';
            var privacyCard = document.createElement('div');
            privacyCard.className = 'contacts-card';
            privacyCard.innerHTML = ''
                + '<h3 class="contacts-card-title"><i class="fa-regular fa-shield"></i> Privacy settings</h3>'
                + '<div class="privacy-option">'
                + '<label class="modern-radio"><input type="radio" name="privacy" value="1" ' + (privacyVal === '1' ? 'checked' : '') + '> <span>Yes — only friends can message me</span></label>'
                + '<label class="modern-radio"><input type="radio" name="privacy" value="0" ' + (privacyVal === '0' ? 'checked' : '') + '> <span>No — everyone can message me (except blocked users)</span></label>'
                + '</div>';
            container.appendChild(privacyCard);
            var actionsDiv = document.createElement('div');
            actionsDiv.className = 'contacts-actions';
            actionsDiv.innerHTML = '<button class="modern-btn modern-btn-primary" id="update-contacts"><i class="fa-regular fa-floppy-disk"></i> Update contact list</button>';
            container.appendChild(actionsDiv);
            var updateContactsBtn = container.querySelector('#update-contacts');
            if (updateContactsBtn && updateButton) {
                updateContactsBtn.addEventListener('click', function() {
                    if (friendsTextarea) friendsTextarea.value = container.querySelector('#modern-friends-list').value;
                    if (blockedTextarea) blockedTextarea.value = container.querySelector('#modern-blocked-list').value;
                    var checkedPrivacy = container.querySelector('input[name="privacy"]:checked');
                    if (privacySelect && checkedPrivacy) privacySelect.value = checkedPrivacy.value;
                    updateButton.click();
                });
            }
        } catch (err) {
            console.error('[MessengerModule] Error building contacts section:', err);
            var cpEl = document.querySelector('.cp');
            if (cpEl) {
                var clone = cpEl.cloneNode(true);
                var tabs = clone.querySelector('.tabs');
                if (tabs) tabs.remove();
                container.appendChild(clone);
            } else {
                container.innerHTML = '<div class="modern-empty-state"><i class="fa-regular fa-address-book"></i><p>Unable to load contacts</p></div>';
            }
        }
        return container;
    }

    // ------------------------------------------------------------------------
    // CORE BUILDER
    // ------------------------------------------------------------------------
    function buildModernMessenger() {
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (!wrapper) return;
        if (document.getElementById('modern-messenger')) return;
        var carousel = wrapper.querySelector('.carousel-wrapper');
        var messengerContainer = document.createElement('div');
        messengerContainer.id = 'modern-messenger';
        messengerContainer.className = 'modern-messenger';
        var navContainer = document.createElement('nav');
        navContainer.className = 'modern-messenger-nav';
        var navItems = [
            { text: 'Compose',  icon: 'fa-regular fa-pen-to-square', url: '/?act=Msg&CODE=04&c=660892', section: 'compose' },
            { text: 'Messages', icon: 'fa-regular fa-envelope',       url: '/?act=Msg&CODE=01&c=660892', section: 'messages' },
            { text: 'Contacts', icon: 'fa-regular fa-address-book',   url: '/?act=Msg&CODE=02&c=660892', section: 'contacts' }
        ];
        for (var i = 0; i < navItems.length; i++) {
            var item = navItems[i];
            var link = document.createElement('a');
            link.href = item.url;
            link.className = 'modern-nav-link' + (item.section === currentSection ? ' current' : '');
            link.innerHTML = '<i class="' + item.icon + '" aria-hidden="true"></i><span class="modern-nav-text">' + item.text + '</span>';
            navContainer.appendChild(link);
        }
        var mainContent = document.createElement('div');
        mainContent.className = 'modern-messenger-main';
        if (currentSection === 'compose') {
            mainContent.appendChild(buildComposeSection());
        } else if (currentSection === 'messages') {
            mainContent.appendChild(buildModernMessagesSection());
        } else {
            mainContent.appendChild(buildModernContactsSection());
        }
        messengerContainer.appendChild(navContainer);
        messengerContainer.appendChild(mainContent);
        if (carousel) {
            carousel.insertAdjacentElement('afterend', messengerContainer);
        } else {
            wrapper.appendChild(messengerContainer);
        }
        console.log('[MessengerModule] Built for section: ' + currentSection);
    }

    return {
        initialize: initialize,
        reset: reset
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);
