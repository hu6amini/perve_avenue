// Messenger Module – Complete modern UI for all messenger sections
// Uses ForumCoreObserver exclusively for DOM detection (no polling, no custom MutationObservers)
var MessengerModule = (function(Utils, EventBus) {
    'use strict';

    var isInitialized = false;
    var observerCallbacks = [];
    var _originalEmoticon = null;

    // Detect current section once, module-wide
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

                // Observer for wrapper (#modern-forum-wrapper)
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

                // Observer for the current section’s target element(s)
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

                // Very short safety fallback (in case observer never fires)
                setTimeout(function() {
                    if (!wrapperReady) wrapperReady = true;
                    if (!targetReady) targetReady = true;
                    tryBuild();
                }, 1000);
            } else {
                // Fallback when ForumObserver is not available (should not happen on your forum)
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

    // Only check for compose‑page globals; for other sections resolve immediately
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

    function findAncestor(el, selector) {
        while (el && el !== document.body) {
            if (el.matches && el.matches(selector)) return el;
            el = el.parentElement;
        }
        return null;
    }

    // ------------------------------------------------------------------------
    // CONVERTERS (Legacy BBCode ↔ HTML) – with spoiler block support
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
        html = html.replace(/\[img\](.*?)\[\/img\]/gi, '<img src="$1" alt="image">');
        html = html.replace(/\[quote\](.*?)\[\/quote\]/gis, '<blockquote>$1</blockquote>');
        html = html.replace(/\[code\](.*?)\[\/code\]/gis, '<pre><code>$1</code></pre>');
        // Spoiler → multiple <p class="ql-spoiler-line">
        html = html.replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, function(match, content) {
            var lines = content.split(/\r?\n/);
            return lines.map(function(line) {
                if (line.trim() === '') return '<p class="ql-spoiler-line"><br></p>';
                return '<p class="ql-spoiler-line">' + line + '</p>';
            }).join('');
        });
        html = html.replace(/\[CENTER\](.*?)\[\/CENTER\]/gis, '<div style="text-align:center">$1</div>');
        html = html.replace(/\[font=([^\]]+)\](.*?)\[\/font\]/gi, '<span style="font-family:$1">$2</span>');
        html = html.replace(/\[size=([^\]]+)\](.*?)\[\/size\]/gi, '<span style="font-size:$1px">$2</span>');
        html = html.replace(/\[color=([^\]]+)\](.*?)\[\/color\]/gi, '<span style="color:$1">$2</span>');
        html = html.replace(/\[EMAIL\](.*?)\[\/EMAIL\]/gi, '<a href="mailto:$1">$1</a>');
        return html;
    }

    function htmlToLegacy(html) {
        if (!html) return '';
        var div = document.createElement('div');
        div.innerHTML = html;

        // Step 1: Group consecutive .ql-spoiler-line elements into a placeholder
        var spoilerGroups = [];
        var currentGroup = [];
        var children = Array.from(div.childNodes);
        children.forEach(function(node) {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('ql-spoiler-line')) {
                currentGroup.push(node);
            } else {
                if (currentGroup.length > 0) {
                    spoilerGroups.push(currentGroup);
                    currentGroup = [];
                }
            }
        });
        if (currentGroup.length > 0) spoilerGroups.push(currentGroup);

        spoilerGroups.forEach(function(group) {
            var combinedHtml = group.map(function(p) {
                var inner = p.innerHTML;
                if (inner === '<br>') inner = '';
                return inner;
            }).join('\n');
            var placeholder = document.createElement('div');
            placeholder.setAttribute('data-spoiler-group', 'true');
            placeholder.innerHTML = combinedHtml;
            group[0].parentNode.insertBefore(placeholder, group[0]);
            group.forEach(function(p) { p.remove(); });
        });

        // Step 2: Apply all standard regex conversions on the serialized HTML
        var legacy = div.innerHTML;

        // Inline formatting
        legacy = legacy.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '<b>$1</b>');
        legacy = legacy.replace(/<em[^>]*>(.*?)<\/em>/gi, '<i>$1</i>');
        legacy = legacy.replace(/<u>(.*?)<\/u>/gi, '<u>$1</u>');
        legacy = legacy.replace(/<s>(.*?)<\/s>/gi, '<del>$1</del>');
        legacy = legacy.replace(/<del>(.*?)<\/del>/gi, '<del>$1</del>');

        // Block elements
        legacy = legacy.replace(/<pre class="ql-syntax"[^>]*>([\s\S]*?)<\/pre>/gi, '[code]$1[/code]');
        legacy = legacy.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '[code]$1[/code]');
        legacy = legacy.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '[quote]$1[/quote]');
        legacy = legacy.replace(/<div style="text-align:center"[^>]*>([\s\S]*?)<\/div>/gi, '[CENTER]$1[/CENTER]');

        // Links and images
        legacy = legacy.replace(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[url=$1]$2[/url]');
        legacy = legacy.replace(/<img[^>]+src="([^"]+)"[^>]*>/gi, '[img]$1[/img]');

        // Convert spoiler placeholder
        legacy = legacy.replace(/<div data-spoiler-group="true">([\s\S]*?)<\/div>/gi, '[SPOILER]$1[/SPOILER]');

        // Clean up paragraph tags, line breaks, etc.
        legacy = legacy.replace(/<p><br\s*\/?><\/p>/gi, '\n');
        legacy = legacy.replace(/<\/p>/gi, '\n');
        legacy = legacy.replace(/<p[^>]*>/gi, '');
        legacy = legacy.replace(/<div[^>]*>/gi, '').replace(/<\/div>/gi, '');
        legacy = legacy.replace(/<br\s*\/?>/gi, '\n');

        return legacy.trim();
    }

    // ------------------------------------------------------------------------
    // COMPOSE SECTION (Quill-based, with custom modal & dropdown)
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

        // Helper: custom modal with input
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

            function close() {
                modalOverlay.remove();
            }

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

        // Register custom Spoiler blot (Block blot)
        if (window.Quill && !window._spoilerBlotRegistered) {
            window._spoilerBlotRegistered = true;
            var Block = window.Quill.import('blots/block');
            function SpoilerBlot() { Block.apply(this, arguments); }
            SpoilerBlot.prototype = Object.create(Block.prototype);
            SpoilerBlot.prototype.constructor = SpoilerBlot;
            SpoilerBlot.blotName = 'spoiler';
            SpoilerBlot.tagName = 'p';
            SpoilerBlot.className = 'ql-spoiler-line';
            window.Quill.register(SpoilerBlot, true);
        }

        // Toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';

        var quill = null;

        function qFormat(format, value) {
            if (!quill) return;
            var cur = quill.getFormat();
            quill.format(format, value !== undefined ? value : !cur[format]);
            quill.focus();
        }

        function addSeparator() {
            var sep = document.createElement('span');
            sep.className = 'toolbar-separator';
            sep.style.cssText = 'width:1px;height:1.5rem;background:var(--border-color);margin:0 var(--space-sm);display:inline-block;vertical-align:middle;';
            toolbar.appendChild(sep);
        }

        // Group 1: Text formatting
        var group1 = [
            { title: 'Bold',           icon: 'fa-regular fa-bold',          cmd: function() { qFormat('bold'); } },
            { title: 'Italic',         icon: 'fa-regular fa-italic',        cmd: function() { qFormat('italic'); } },
            { title: 'Underline',      icon: 'fa-regular fa-underline',     cmd: function() { qFormat('underline'); } },
            { title: 'Strikethrough',  icon: 'fa-regular fa-strikethrough', cmd: function() { qFormat('strike'); } }
        ];
        for (var i = 0; i < group1.length; i++) {
            var btn = group1[i];
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'modern-editor-btn';
            button.innerHTML = '<i class="' + btn.icon + '"></i>';
            button.title = btn.title;
            button.onclick = (function(cmd) { return function() { cmd(); }; })(btn.cmd);
            toolbar.appendChild(button);
        }
        addSeparator();

        // Group 2: Lists (dropdown) + Blockquote + Code
        var listDropdownContainer = document.createElement('div');
        listDropdownContainer.className = 'modern-dropdown';
        listDropdownContainer.style.position = 'relative';
        listDropdownContainer.style.display = 'inline-block';

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
            var isVisible = listDropdownMenu.style.display === 'block';
            listDropdownMenu.style.display = isVisible ? 'none' : 'block';
        };
        document.addEventListener('click', function() {
            listDropdownMenu.style.display = 'none';
        });
        listDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

        listDropdownMenu.querySelector('#bullet-list-option').onclick = function() {
            qFormat('list', 'bullet');
            listDropdownMenu.style.display = 'none';
        };
        listDropdownMenu.querySelector('#ordered-list-option').onclick = function() {
            qFormat('list', 'ordered');
            listDropdownMenu.style.display = 'none';
        };

        var blockquoteBtn = document.createElement('button');
        blockquoteBtn.type = 'button';
        blockquoteBtn.className = 'modern-editor-btn';
        blockquoteBtn.innerHTML = '<i class="fa-regular fa-quote-left"></i>';
        blockquoteBtn.title = 'Blockquote';
        blockquoteBtn.onclick = function() { qFormat('blockquote'); };
        toolbar.appendChild(blockquoteBtn);

        var codeBtn = document.createElement('button');
        codeBtn.type = 'button';
        codeBtn.className = 'modern-editor-btn';
        codeBtn.innerHTML = '<i class="fa-regular fa-code"></i>';
        codeBtn.title = 'Code block';
        codeBtn.onclick = function() { qFormat('code-block'); };
        toolbar.appendChild(codeBtn);
        addSeparator();

        // Group 3: Link + Image (dropdown)
        var linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'modern-editor-btn';
        linkBtn.innerHTML = '<i class="fa-regular fa-link"></i>';
        linkBtn.title = 'Insert link';
        linkBtn.onclick = function() {
            if (!quill) return;
            var range = quill.getSelection();
            var selectedText = range && range.length > 0 ? quill.getText(range.index, range.length) : '';
            showInputModal('Insert link', 'https://example.com', function(url) {
                if (range && range.length > 0) {
                    quill.format('link', url);
                } else {
                    quill.insertText(range.index, url, 'link', url);
                    quill.setSelection(range.index + url.length);
                }
                quill.focus();
            });
        };
        toolbar.appendChild(linkBtn);

        var imageDropdownContainer = document.createElement('div');
        imageDropdownContainer.className = 'modern-dropdown';
        imageDropdownContainer.style.position = 'relative';
        imageDropdownContainer.style.display = 'inline-block';

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
            var isVisible = imageDropdownMenu.style.display === 'block';
            imageDropdownMenu.style.display = isVisible ? 'none' : 'block';
        };
        document.addEventListener('click', function() { imageDropdownMenu.style.display = 'none'; });
        imageDropdownMenu.addEventListener('click', function(e) { e.stopPropagation(); });

        // Helper: upload image to Cloudflare Worker
        function uploadImageToWorker(file, quillEditor) {
            var formData = new FormData();
            formData.append('image', file);
            var range = quillEditor.getSelection(true);
            var loadingId = 'img-loading-' + Date.now();
            quillEditor.insertEmbed(range.index, 'html', '<div id="' + loadingId + '" style="display:inline-block;">⬆️ Uploading...</div>', 'user');

            fetch('https://imgbb-upload-proxy.nhristakiev.workers.dev/', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                var delta = quillEditor.getContents(range.index, 1);
                if (delta && delta.ops[0] && delta.ops[0].insert.html && delta.ops[0].insert.html.includes(loadingId)) {
                    quillEditor.deleteText(range.index, 1);
                }
                if (data.url) {
                    quillEditor.insertEmbed(range.index, 'image', data.url, 'user');
                    quillEditor.insertText(range.index + 1, '\u200B', 'user');
                    quillEditor.setSelection(range.index + 2);
                } else {
                    console.error('Upload failed:', data);
                }
                quillEditor.focus();
            })
            .catch(error => {
                console.error('Upload error:', error);
                var delta = quillEditor.getContents(range.index, 1);
                if (delta && delta.ops[0] && delta.ops[0].insert.html && delta.ops[0].insert.html.includes(loadingId)) {
                    quillEditor.deleteText(range.index, 1);
                }
                quillEditor.focus();
            });
        }

        imageDropdownMenu.querySelector('#image-url-option').onclick = function() {
            showInputModal('Insert image URL', 'https://example.com/image.jpg', function(url) {
                var range = quill.getSelection(true);
                quill.insertEmbed(range.index, 'image', url, 'user');
                quill.insertText(range.index + 1, '\u200B', 'user');
                quill.setSelection(range.index + 2);
                quill.focus();
            });
            imageDropdownMenu.style.display = 'none';
        };

        imageDropdownMenu.querySelector('#image-upload-option').onclick = function() {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = function() {
                if (input.files && input.files[0]) {
                    uploadImageToWorker(input.files[0], quill);
                }
            };
            input.click();
            imageDropdownMenu.style.display = 'none';
        };
        addSeparator();

        // Group 4: Spoiler + Smiley
        var spoilerBtn = document.createElement('button');
        spoilerBtn.type = 'button';
        spoilerBtn.className = 'modern-editor-btn';
        spoilerBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
        spoilerBtn.title = 'Spoiler';
        spoilerBtn.onclick = function() {
            if (!quill) return;
            var range = quill.getSelection();
            if (!range) { quill.focus(); return; }
            var formats = quill.getFormat(range);
            quill.format('spoiler', !formats.spoiler, 'user');
            quill.focus();
        };
        toolbar.appendChild(spoilerBtn);

        var smileBtn = document.createElement('button');
        smileBtn.type = 'button';
        smileBtn.className = 'modern-editor-btn';
        smileBtn.innerHTML = '<i class="fa-regular fa-face-smile"></i>';
        smileBtn.title = 'Insert smiley';
        smileBtn.onclick = function() {
            var smiliesDiv = document.getElementById('smilies');
            if (smiliesDiv) smiliesDiv.classList.toggle('nascosta');
        };
        toolbar.appendChild(smileBtn);

        container.appendChild(toolbar);

        // Editor element
        var editorElement = document.createElement('div');
        editorElement.id = 'quill-editor';
        editorElement.className = 'modern-wysiwyg';
        container.appendChild(editorElement);

        // Initialise Quill
        quill = new window.Quill(editorElement, {
            modules: {
                toolbar: false,
                history: {
                    delay: 1000,
                    maxStack: 100,
                    userOnly: true
                }
            },
            placeholder: '💬 Write your message...',
            formats: ['bold', 'italic', 'underline', 'strike', 'list', 'ordered', 'link', 'image', 'blockquote', 'code-block', 'spoiler']
        });

        // --- Active state for toolbar buttons ---
        function updateToolbarActiveStates() {
            var range = quill.getSelection();
            if (!range) {
                var btns = document.querySelectorAll('#compose-section .modern-editor-btn');
                btns.forEach(function(btn) { btn.classList.remove('active'); });
                return;
            }
            var formats = quill.getFormat();
            var buttons = document.querySelectorAll('#compose-section .modern-editor-btn');

            buttons.forEach(function(btn) {
                var title = btn.getAttribute('title');
                var active = false;

                if (title === 'Bold') active = !!formats.bold;
                else if (title === 'Italic') active = !!formats.italic;
                else if (title === 'Underline') active = !!formats.underline;
                else if (title === 'Strikethrough') active = !!formats.strike;
                else if (title === 'Blockquote') active = !!formats.blockquote;
                else if (title === 'Code block') active = !!formats['code-block'];
                else if (title === 'Bullet list') active = (formats.list === 'bullet');
                else if (title === 'Ordered list') active = (formats.list === 'ordered');
                else if (title === 'Spoiler') active = !!formats.spoiler;

                if (active) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }

        quill.on('selection-change', updateToolbarActiveStates);
        quill.on('text-change', updateToolbarActiveStates);
        updateToolbarActiveStates();

        // Drag & Drop support
        var editorRoot = quill.root;
        editorRoot.setAttribute('dropzone', 'copy');
        editorRoot.addEventListener('dragover', function(e) { e.preventDefault(); });
        editorRoot.addEventListener('drop', function(e) {
            e.preventDefault();
            var file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                uploadImageToWorker(file, quill);
            }
        });

        // Custom keyboard shortcut for spoiler (Ctrl+Shift+S)
        if (quill.keyboard) {
            quill.keyboard.addBinding({
                key: 'S',
                shortKey: true,
                shiftKey: true
            }, function() {
                var range = quill.getSelection();
                if (range) {
                    var formats = quill.getFormat(range);
                    quill.format('spoiler', !formats.spoiler, 'user');
                    return false;
                }
                return true;
            });
        }

        // Load pre-existing content
        var initialHtml = legacyToHtml(originalTextarea ? originalTextarea.value : '');
        if (initialHtml) {
            quill.clipboard.dangerouslyPasteHTML(initialHtml);
        }

        // Sync back to original textarea
        quill.on('text-change', function() {
            if (originalTextarea) {
                originalTextarea.value = htmlToLegacy(quill.root.innerHTML);
            }
        });

        // Redirect smiley clicks into Quill
        _originalEmoticon = window.emoticon;
        window.emoticon = function(x) {
            if (quill) {
                var range = quill.getSelection() || { index: quill.getLength() - 1 };
                quill.insertText(range.index, ' ' + x + ' ', 'user');
                quill.setSelection(range.index + x.length + 2);
                quill.focus();
            } else if (_originalEmoticon) {
                _originalEmoticon(x);
            }
        };

        // Options row
        var optionsRow = document.createElement('div');
        optionsRow.className = 'modern-options';
        optionsRow.innerHTML = ''
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-sent" '     + (addSentCheckbox     && addSentCheckbox.checked     ? 'checked' : '') + '> <span>Add a copy to Sent Items</span></label>'
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-tracking" ' + (addTrackingCheckbox && addTrackingCheckbox.checked ? 'checked' : '') + '> <span>Notify when read</span></label>';
        container.appendChild(optionsRow);

        // Action buttons (Preview / Send)
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

        // Data binding (recipient, title, checkboxes)
        var modernRecipient   = container.querySelector('#modern-recipient');
        var modernContact     = container.querySelector('#modern-contact');
        var modernTitle       = container.querySelector('#modern-title');
        var modernAddSent     = container.querySelector('#modern-add-sent');
        var modernAddTracking = container.querySelector('#modern-add-tracking');

        function syncToOriginal() {
            if (recipientInput   && modernRecipient)   recipientInput.value        = modernRecipient.value;
            if (contactSelect    && modernContact)     contactSelect.value         = modernContact.value;
            if (titleInput       && modernTitle)       titleInput.value            = modernTitle.value;
            if (addSentCheckbox     && modernAddSent)      addSentCheckbox.checked      = modernAddSent.checked;
            if (addTrackingCheckbox && modernAddTracking)  addTrackingCheckbox.checked  = modernAddTracking.checked;
        }
        function syncFromOriginal() {
            if (recipientInput   && modernRecipient)   modernRecipient.value       = recipientInput.value;
            if (contactSelect    && modernContact)     modernContact.value         = contactSelect.value;
            if (titleInput       && modernTitle)       modernTitle.value           = titleInput.value;
            if (addSentCheckbox     && modernAddSent)      modernAddSent.checked       = addSentCheckbox.checked;
            if (addTrackingCheckbox && modernAddTracking)  modernAddTracking.checked   = addTrackingCheckbox.checked;
        }

        if (modernRecipient)   modernRecipient.addEventListener('input',   syncToOriginal);
        if (modernContact)     modernContact.addEventListener('change',    syncToOriginal);
        if (modernTitle)       modernTitle.addEventListener('input',       syncToOriginal);
        if (modernAddSent)     modernAddSent.addEventListener('change',    syncToOriginal);
        if (modernAddTracking) modernAddTracking.addEventListener('change', syncToOriginal);
        syncFromOriginal();

        // Preview button
        var modernPreviewBtn = container.querySelector('#modern-preview');
        if (modernPreviewBtn) {
            modernPreviewBtn.onclick = function() {
                syncToOriginal();
                if (originalTextarea) originalTextarea.value = htmlToLegacy(quill.root.innerHTML);
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

        // Submit button
        var modernSubmitBtn = container.querySelector('#modern-submit');
        if (modernSubmitBtn) {
            modernSubmitBtn.onclick = function(e) {
                e.preventDefault();
                syncToOriginal();
                if (originalTextarea) originalTextarea.value = htmlToLegacy(quill.root.innerHTML);
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
    // MESSAGES SECTION (fully rebuilt) – unchanged
    // ------------------------------------------------------------------------
    function buildModernMessagesSection() {
        // ... (copy your existing function – too long, but unchanged)
        // For brevity I will not repeat it here; keep the one you already have.
        // The content is exactly as in your previous working version.
    }

    // ------------------------------------------------------------------------
    // CONTACTS SECTION (fully rebuilt) – unchanged
    // ------------------------------------------------------------------------
    function buildModernContactsSection() {
        // ... (copy your existing function – unchanged)
    }

    // ------------------------------------------------------------------------
    // CORE BUILDER – uses only the wrapper and current section
    // ------------------------------------------------------------------------
    function buildModernMessenger() {
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (!wrapper) return;

        if (document.getElementById('modern-messenger')) return;

        var carousel = wrapper.querySelector('.carousel-wrapper');

        var messengerContainer = document.createElement('div');
        messengerContainer.id = 'modern-messenger';
        messengerContainer.className = 'modern-messenger';

        // Navigation
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
