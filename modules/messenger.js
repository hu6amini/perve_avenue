// Messenger Module – WYSIWYG modern UI (integrates into modern wrapper)
var MessengerModule = (function(Utils, EventBus) {
    'use strict';

    var isInitialized = false;

    // ------------------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------------------
    function initialize() {
        if (isInitialized) return Promise.resolve();

        if (document.body.id !== 'msg') return Promise.resolve();

        if (document.getElementById('modern-messenger-container')) {
            isInitialized = true;
            return Promise.resolve();
        }

        return new Promise(function(resolve, reject) {
            function ready() {
                waitForGlobalFunctions().then(function() {
                    try {
                        buildModernMessenger();
                        isInitialized = true;
                        if (EventBus) EventBus.trigger('messenger:ready');
                        resolve();
                    } catch (err) {
                        console.error('[MessengerModule] Build failed:', err);
                        reject(err);
                    }
                }).catch(reject);
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', ready);
            } else {
                ready();
            }
        });
    }

    function reset() { isInitialized = false; }

    function waitForGlobalFunctions() {
        return new Promise(function(resolve) {
            var maxAttempts = 30;
            var attempt = 0;
            function check() {
                if (typeof tag !== 'undefined' && typeof ajaxRequest !== 'undefined') {
                    resolve();
                } else if (++attempt >= maxAttempts) {
                    console.warn('[MessengerModule] Global functions not found, continuing');
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            }
            check();
        });
    }

    // ------------------------------------------------------------------------
    // CONVERTERS (Legacy mixed ↔ HTML)
    // ------------------------------------------------------------------------
    function legacyToHtml(legacy) {
        if (!legacy) return '';
        var html = legacy;
        // BBCode → HTML (common ones)
        html = html.replace(/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>');
        html = html.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');
        html = html.replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>');
        html = html.replace(/\[s\](.*?)\[\/s\]/gi, '<s>$1</s>');
        html = html.replace(/\[list\](.*?)\[\/list\]/gis, '<ul>$1</ul>');
        html = html.replace(/\[\*\](.*?)(?=\n|$)/gi, '<li>$1</li>');
        html = html.replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gi, '<a href="$1" target="_blank">$2</a>');
        html = html.replace(/\[img\](.*?)\[\/img\]/gi, '<img src="$1" alt="image">');
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

    function htmlToLegacy(html) {
        if (!html) return '';
        var div = document.createElement('div');
        div.innerHTML = html;
        var legacy = div.innerHTML;
        legacy = legacy.replace(/<strong>(.*?)<\/strong>/gi, '<b>$1</b>')
                       .replace(/<em>(.*?)<\/em>/gi, '<i>$1</i>')
                       .replace(/<u>(.*?)<\/u>/gi, '<u>$1</u>')
                       .replace(/<s>(.*?)<\/s>/gi, '<del>$1</del>')
                       .replace(/<del>(.*?)<\/del>/gi, '<del>$1</del>');
        legacy = legacy.replace(/<ul>(.*?)<\/ul>/gis, function(match, content) {
            var items = content.replace(/<li>(.*?)<\/li>/gi, '[*]$1');
            return '[list]' + items + '[/list]';
        });
        legacy = legacy.replace(/<ol>(.*?)<\/ol>/gis, function(match, content) {
            var items = content.replace(/<li>(.*?)<\/li>/gi, '[*]$1');
            return '[list=1]' + items + '[/list]';
        });
        legacy = legacy.replace(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[url=$1]$2[/url]');
        legacy = legacy.replace(/<img src="([^"]+)"[^>]*>/gi, '[img]$1[/img]');
        legacy = legacy.replace(/<blockquote>(.*?)<\/blockquote>/gis, '[quote]$1[/quote]');
        legacy = legacy.replace(/<pre><code>(.*?)<\/code><\/pre>/gis, '[code]$1[/code]');
        legacy = legacy.replace(/<div class="spoiler">(.*?)<\/div>/gis, '[spoiler]$1[/spoiler]');
        legacy = legacy.replace(/<div style="text-align:center">(.*?)<\/div>/gis, '[CENTER]$1[/CENTER]');
        legacy = legacy.replace(/<span style="font-family:([^"]+)">(.*?)<\/span>/gi, '[font=$1]$2[/font]');
        legacy = legacy.replace(/<span style="font-size:([0-9]+)px">(.*?)<\/span>/gi, '[size=$1]$2[/size]');
        legacy = legacy.replace(/<span style="color:([^"]+)">(.*?)<\/span>/gi, '[color=$1]$2[/color]');
        legacy = legacy.replace(/<a href="mailto:([^"]+)"[^>]*>(.*?)<\/a>/gi, '[EMAIL]$1[/EMAIL]');
        legacy = legacy.replace(/<div>/gi, '').replace(/<\/div>/gi, '');
        legacy = legacy.replace(/<p>/gi, '').replace(/<\/p>/gi, '');
        legacy = legacy.replace(/<br\s*\/?>/gi, '\n');
        return legacy.trim();
    }

    // ------------------------------------------------------------------------
    // WYSIWYG formatting helpers
    // ------------------------------------------------------------------------
    function applyFormat(command, value) {
        document.execCommand(command, false, value);
    }

    function applyCustomBBCode(openTag, closeTag) {
        var selection = window.getSelection();
        if (!selection.rangeCount) return;
        var range = selection.getRangeAt(0);
        var selectedText = range.toString();
        if (!selectedText) return;
        var html = openTag + selectedText + closeTag;
        range.deleteContents();
        var fragment = range.createContextualFragment(html);
        range.insertNode(fragment);
        selection.collapseToEnd();
    }

    // ------------------------------------------------------------------------
    // CORE BUILDER (places UI inside modern wrapper, after carousel, hides legacy)
    // ------------------------------------------------------------------------
    function buildModernMessenger() {
        // ----- Extract original elements -----
        var legacyForm = document.querySelector('.cp.send');
        if (!legacyForm) throw new Error('.cp.send not found');

        var recipientInput = document.querySelector('input[name="entered_name"]');
        var contactSelect = document.querySelector('select[name="from_contact"]');
        var titleInput = document.querySelector('input[name="msg_title"]');
        var originalTextarea = document.getElementById('Post');
        var addSentCheckbox = document.getElementById('add_sent');
        var addTrackingCheckbox = document.getElementById('add_tracking');
        var fileUploadInput = document.querySelector('input[name="FILE_UPLOAD"]');
        var submitButton = document.querySelector('input[name="sub_mit"]');
        var previewButton = document.querySelector('button[name="preview"]');
        var originalForm = window.REPLIER;

        if (!originalTextarea) throw new Error('Textarea #Post not found');

        // ----- Find or create the main wrapper -----
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (!wrapper) {
            wrapper = document.createElement('main');
            wrapper.id = 'modern-forum-wrapper';
            wrapper.className = 'modern-forum-wrapper';
            // Insert after the carousel (if any) or at the beginning of body
            var carousel = document.querySelector('.carousel-wrapper, .slick_carousel');
            if (carousel && carousel.parentNode) {
                carousel.parentNode.insertBefore(wrapper, carousel.nextSibling);
            } else {
                document.body.insertBefore(wrapper, document.body.firstChild);
            }
        }

        // ----- Locate the carousel inside the wrapper -----
        var carousel = wrapper.querySelector('.carousel-wrapper, .slick_carousel');
        var messengerContainer = document.createElement('div');
        messengerContainer.id = 'modern-messenger-container';
        messengerContainer.className = 'modern-messenger-container';

        if (carousel) {
            // Insert messenger container right after the carousel
            carousel.parentNode.insertBefore(messengerContainer, carousel.nextSibling);
        } else {
            // Fallback: append at the end of wrapper
            wrapper.appendChild(messengerContainer);
        }

        // ----- Build modern UI inside messengerContainer -----
        var container = document.createElement('div');
        container.id = 'modern-messenger';
        container.className = 'modern-messenger';

        // Tabs (clone original)
        var tabsHtml = document.querySelector('.cp.send .tabs');
        if (tabsHtml) {
            tabsHtml = tabsHtml.cloneNode(true);
            tabsHtml.classList.add('modern-tabs');
        } else {
            tabsHtml = document.createElement('div');
        }

        // Recipient & Title row
        var recipientRow = document.createElement('div');
        recipientRow.className = 'modern-recipient-row';
        recipientRow.innerHTML = ''
            + '<div class="modern-field"><label>Recipient</label>'
            + '<div class="modern-recipient-controls">'
            + '<input type="text" id="modern-recipient" class="modern-input" placeholder="Username or MID" value="' + escapeHtml(recipientInput ? recipientInput.value : '') + '">'
            + '<select id="modern-contact" class="modern-select">' + (contactSelect ? contactSelect.innerHTML : '') + '</select>'
            + '</div></div>'
            + '<div class="modern-field"><label>Message title</label>'
            + '<input type="text" id="modern-title" class="modern-input" value="' + escapeHtml(titleInput ? titleInput.value : '') + '" placeholder="Subject"></div>';

        // Toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';

        var buttons = [
            { title: 'Bold', icon: 'fas fa-bold', cmd: function() { applyFormat('bold'); } },
            { title: 'Italic', icon: 'fas fa-italic', cmd: function() { applyFormat('italic'); } },
            { title: 'Underline', icon: 'fas fa-underline', cmd: function() { applyFormat('underline'); } },
            { title: 'Strikethrough', icon: 'fas fa-strikethrough', cmd: function() { applyFormat('strikeThrough'); } },
            { title: 'List UL', icon: 'fas fa-list-ul', cmd: function() { applyFormat('insertUnorderedList'); } },
            { title: 'List OL', icon: 'fas fa-list-ol', cmd: function() { applyFormat('insertOrderedList'); } },
            { title: 'Link', icon: 'fas fa-link', cmd: function() { var url = prompt('Enter URL:'); if (url) applyFormat('createLink', url); } },
            { title: 'Image URL', icon: 'fas fa-image', cmd: function() { var url = prompt('Enter image URL:'); if (url) applyFormat('insertImage', url); } },
            { title: 'Quote', icon: 'fas fa-quote-right', cmd: function() { applyCustomBBCode('<blockquote>', '</blockquote>'); } },
            { title: 'Code', icon: 'fas fa-code', cmd: function() { applyCustomBBCode('<pre><code>', '</code></pre>'); } },
            { title: 'Spoiler', icon: 'fas fa-eye-slash', cmd: function() { applyCustomBBCode('<div class="spoiler">', '</div>'); } }
        ];

        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'modern-editor-btn';
            button.innerHTML = '<i class="' + btn.icon + '"></i>';
            button.title = btn.title;
            button.onclick = (function(cmd) {
                return function() { cmd(); focusWysiwyg(); };
            })(btn.cmd);
            toolbar.appendChild(button);
        }

        // ImgBB upload button
        var imgbbBtn = document.createElement('button');
        imgbbBtn.type = 'button';
        imgbbBtn.className = 'modern-editor-btn';
        imgbbBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i>';
        imgbbBtn.title = 'Upload image (ImgBB)';
        imgbbBtn.onclick = function() {
            if (typeof ibb_ff === 'undefined') {
                var script = document.createElement('script');
                script.src = 'https://imgbb.com/upload.js';
                script.setAttribute('data-palette', 'blue');
                script.setAttribute('data-sibling-pos', 'before');
                script.setAttribute('data-auto-insert', 'bbcode-embed-medium');
                document.body.appendChild(script);
            } else if (window.FFUpload_widget && typeof window.FFUpload_widget.toggle === 'function') {
                window.FFUpload_widget.toggle();
            }
        };
        toolbar.appendChild(imgbbBtn);

        // Smiley button (toggles the original smilies panel)
        var smileBtn = document.createElement('button');
        smileBtn.type = 'button';
        smileBtn.className = 'modern-editor-btn';
        smileBtn.innerHTML = '<i class="fas fa-smile"></i>';
        smileBtn.title = 'Insert smiley';
        smileBtn.onclick = function() {
            var smiliesDiv = document.getElementById('smilies');
            if (smiliesDiv) {
                smiliesDiv.classList.toggle('nascosta');
                smiliesDiv.style.position = 'absolute';
                smiliesDiv.style.zIndex = '1000';
                smiliesDiv.style.backgroundColor = 'var(--surface-color)';
            }
        };
        toolbar.insertBefore(smileBtn, imgbbBtn);

        // WYSIWYG contenteditable div
        var wysiwygDiv = document.createElement('div');
        wysiwygDiv.id = 'modern-wysiwyg';
        wysiwygDiv.className = 'modern-wysiwyg';
        wysiwygDiv.contentEditable = 'true';
        wysiwygDiv.setAttribute('role', 'textbox');
        wysiwygDiv.setAttribute('aria-multiline', 'true');
        wysiwygDiv.style.minHeight = '200px';
        wysiwygDiv.style.padding = 'var(--pad-4)';
        wysiwygDiv.style.backgroundColor = 'var(--bg-color)';
        wysiwygDiv.style.border = '1px solid var(--border-color)';
        wysiwygDiv.style.borderRadius = 'var(--radius)';
        wysiwygDiv.style.fontFamily = 'var(--font-primary)';
        wysiwygDiv.style.fontSize = 'var(--text-sm)';
        wysiwygDiv.style.lineHeight = '1.618';
        wysiwygDiv.style.overflowY = 'auto';
        wysiwygDiv.innerHTML = legacyToHtml(originalTextarea.value);

        function focusWysiwyg() {
            wysiwygDiv.focus();
        }

        // Sync back to original textarea on any input
        wysiwygDiv.addEventListener('input', function() {
            originalTextarea.value = htmlToLegacy(wysiwygDiv.innerHTML);
        });

        // Options row (checkboxes)
        var optionsRow = document.createElement('div');
        optionsRow.className = 'modern-options';
        optionsRow.innerHTML = ''
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-sent" ' + (addSentCheckbox && addSentCheckbox.checked ? 'checked' : '') + '> <span>Add a copy to Sent Items</span></label>'
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-tracking" ' + (addTrackingCheckbox && addTrackingCheckbox.checked ? 'checked' : '') + '> <span>Notify when read</span></label>';

        // File attachment row
        var attachRow = document.createElement('div');
        attachRow.className = 'modern-attach';
        attachRow.innerHTML = ''
            + '<label class="modern-file-label"><i class="fas fa-paperclip"></i> Attach file'
            + '<input type="file" id="modern-file-upload" style="display:none"></label>'
            + '<span id="modern-file-name">No file chosen</span>';
        var fileInput = attachRow.querySelector('#modern-file-upload');
        if (fileUploadInput) {
            fileInput.onchange = function() {
                var fileName = fileInput.files[0] ? fileInput.files[0].name : 'No file chosen';
                var fileNameSpan = document.getElementById('modern-file-name');
                if (fileNameSpan) fileNameSpan.innerText = fileName;
                var dataTransfer = new DataTransfer();
                dataTransfer.items.add(fileInput.files[0]);
                fileUploadInput.files = dataTransfer.files;
            };
            fileUploadInput.style.display = 'none';
        }
        var fileLabel = attachRow.querySelector('.modern-file-label');
        if (fileLabel) fileLabel.onclick = function() { fileInput.click(); };

        // Action buttons (Send / Preview)
        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        actions.innerHTML = ''
            + '<button type="button" id="modern-preview" class="modern-btn modern-btn-secondary">Preview</button>'
            + '<button type="button" id="modern-submit" class="modern-btn modern-btn-primary">Send Message</button>';

        // Preview area (hidden initially)
        var previewArea = document.createElement('div');
        previewArea.id = 'modern-preview-area';
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<div class="preview-content"></div>';

        // Assemble main container
        container.appendChild(tabsHtml);
        container.appendChild(recipientRow);
        container.appendChild(toolbar);
        container.appendChild(wysiwygDiv);
        container.appendChild(optionsRow);
        container.appendChild(attachRow);
        container.appendChild(actions);
        container.appendChild(previewArea);
        messengerContainer.appendChild(container);

        // ----- Hide the legacy form -----
        legacyForm.style.display = 'none';

        // ----- Data binding (sync modern ↔ legacy) -----
        var modernRecipient = document.getElementById('modern-recipient');
        var modernContact = document.getElementById('modern-contact');
        var modernTitle = document.getElementById('modern-title');
        var modernAddSent = document.getElementById('modern-add-sent');
        var modernAddTracking = document.getElementById('modern-add-tracking');

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

        if (modernRecipient) modernRecipient.addEventListener('input', syncToOriginal);
        if (modernContact) modernContact.addEventListener('change', syncToOriginal);
        if (modernTitle) modernTitle.addEventListener('input', syncToOriginal);
        if (modernAddSent) modernAddSent.addEventListener('change', syncToOriginal);
        if (modernAddTracking) modernAddTracking.addEventListener('change', syncToOriginal);
        syncFromOriginal();

        // ----- Preview button -----
        var modernPreviewBtn = document.getElementById('modern-preview');
        if (modernPreviewBtn) {
            modernPreviewBtn.onclick = function() {
                syncToOriginal();
                originalTextarea.value = htmlToLegacy(wysiwygDiv.innerHTML);
                if (typeof ajaxRequest === 'function') {
                    ajaxRequest();
                } else if (previewButton && previewButton.onclick) {
                    previewButton.click();
                }
                var loadingDiv = document.getElementById('loading');
                if (loadingDiv) {
                    loadingDiv.style.display = 'block';
                    previewArea.style.display = 'block';
                    var observer = new MutationObserver(function() {
                        var ajaxObj = document.getElementById('ajaxObject');
                        if (ajaxObj && ajaxObj.innerHTML) {
                            var previewContent = previewArea.querySelector('.preview-content');
                            if (previewContent) previewContent.innerHTML = ajaxObj.innerHTML;
                            observer.disconnect();
                        }
                    });
                    observer.observe(loadingDiv, { childList: true, subtree: true });
                }
            };
        }

        // ----- Submit button -----
        var modernSubmitBtn = document.getElementById('modern-submit');
        if (modernSubmitBtn) {
            modernSubmitBtn.onclick = function(e) {
                e.preventDefault();
                syncToOriginal();
                originalTextarea.value = htmlToLegacy(wysiwygDiv.innerHTML);
                if (originalForm && typeof originalForm.submit === 'function') {
                    if (typeof ValidateForm === 'function') {
                        if (!ValidateForm(1)) return;
                    }
                    originalForm.submit();
                } else if (submitButton) {
                    submitButton.click();
                }
            };
        }

        // Optional: hide any extra carousel outside wrapper
        var extraCarousel = document.querySelector('.carousel-wrapper');
        if (extraCarousel && extraCarousel !== carousel) extraCarousel.style.display = 'none';
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

    // ------------------------------------------------------------------------
    // EXPOSED PUBLIC METHODS
    // ------------------------------------------------------------------------
    return {
        initialize: initialize,
        reset: reset
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);
