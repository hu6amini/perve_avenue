// Modern Messenger – replaces legacy UI with a clean, interactive editor
(function() {
    'use strict';

    // Wait for DOM and jQuery (used by legacy code)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        // Check if we are on the Messenger page and the legacy container exists
        var legacyForm = document.querySelector('.cp.send');
        if (!legacyForm || document.getElementById('modern-messenger')) return;

        // ---- Extract original elements and values ----
        var recipientInput = document.querySelector('input[name="entered_name"]');
        var contactSelect = document.querySelector('select[name="from_contact"]');
        var titleInput = document.querySelector('input[name="msg_title"]');
        var postTextarea = document.getElementById('Post');
        var addSentCheckbox = document.getElementById('add_sent');
        var addTrackingCheckbox = document.getElementById('add_tracking');
        var fileUploadInput = document.querySelector('input[name="FILE_UPLOAD"]');
        var submitButton = document.querySelector('input[name="sub_mit"]');
        var previewButton = document.querySelector('button[name="preview"]');
        var originalForm = window.REPLIER; // global form reference

        if (!postTextarea) return;

        // ---- Build modern container ----
        var container = document.createElement('div');
        container.id = 'modern-messenger';
        container.className = 'modern-messenger';
        container.style.cssText = 'max-width:1200px; margin:0 auto;';

        // ---- Tabs (same as original – keep as links) ----
        var tabsHtml = document.querySelector('.cp.send .tabs').cloneNode(true);
        tabsHtml.classList.add('modern-tabs');

        // ---- Recipient & Title row (flex layout) ----
        var recipientRow = document.createElement('div');
        recipientRow.className = 'modern-recipient-row';
        recipientRow.innerHTML = ''
            + '<div class="modern-field">'
            + '<label>Recipient</label>'
            + '<div class="modern-recipient-controls">'
            + '<input type="text" id="modern-recipient" class="modern-input" placeholder="Username or MID" value="' + escapeHtml(recipientInput ? recipientInput.value : '') + '">'
            + '<select id="modern-contact" class="modern-select">' + (contactSelect ? contactSelect.innerHTML : '') + '</select>'
            + '</div>'
            + '</div>'
            + '<div class="modern-field">'
            + '<label>Message title</label>'
            + '<input type="text" id="modern-title" class="modern-input" value="' + escapeHtml(titleInput ? titleInput.value : '') + '" placeholder="Subject">'
            + '</div>';

        // ---- Editor toolbar (modern buttons) ----
        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';
        var buttons = [
            { title: 'Bold', icon: 'fas fa-bold', cmd: function() { tag('[b]', '[/b]'); } },
            { title: 'Italic', icon: 'fas fa-italic', cmd: function() { tag('[i]', '[/i]'); } },
            { title: 'Underline', icon: 'fas fa-underline', cmd: function() { tag('[u]', '[/u]'); } },
            { title: 'Strikethrough', icon: 'fas fa-strikethrough', cmd: function() { tag('[s]', '[/s]'); } },
            { title: 'List', icon: 'fas fa-list-ul', cmd: function() { tag_list(); } },
            { title: 'Link', icon: 'fas fa-link', cmd: function() { tag_url(); } },
            { title: 'Image URL', icon: 'fas fa-image', cmd: function() { tag_image(); } },
            { title: 'Quote', icon: 'fas fa-quote-right', cmd: function() { tag('[quote]', '[/quote]'); } },
            { title: 'Code', icon: 'fas fa-code', cmd: function() { tag_code(); } },
            { title: 'Spoiler', icon: 'fas fa-eye-slash', cmd: function() { tag('[spoiler]', '[/spoiler]'); } }
        ];
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'modern-editor-btn';
            button.innerHTML = '<i class="' + btn.icon + '"></i>';
            button.title = btn.title;
            button.onclick = (function(cmd) {
                return function() { cmd(); postTextarea.focus(); };
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
            } else {
                if (window.FFUpload_widget && typeof window.FFUpload_widget.toggle === 'function') {
                    window.FFUpload_widget.toggle();
                }
            }
        };
        toolbar.appendChild(imgbbBtn);

        // ---- Textarea (original, but we will restyle) ----
        var textareaWrapper = document.createElement('div');
        textareaWrapper.className = 'modern-textarea-wrapper';
        postTextarea.style.width = '100%';
        postTextarea.style.minHeight = '200px';
        postTextarea.classList.add('modern-textarea');
        textareaWrapper.appendChild(postTextarea);

        // ---- Options row (checkboxes) ----
        var optionsRow = document.createElement('div');
        optionsRow.className = 'modern-options';
        optionsRow.innerHTML = ''
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-sent" ' + (addSentCheckbox && addSentCheckbox.checked ? 'checked' : '') + '> <span>Add a copy to Sent Items</span></label>'
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-tracking" ' + (addTrackingCheckbox && addTrackingCheckbox.checked ? 'checked' : '') + '> <span>Notify when read</span></label>';

        // ---- File attachment (custom styled) ----
        var attachRow = document.createElement('div');
        attachRow.className = 'modern-attach';
        attachRow.innerHTML = ''
            + '<label class="modern-file-label">'
            + '<i class="fas fa-paperclip"></i> Attach file'
            + '<input type="file" id="modern-file-upload" style="display:none">'
            + '</label>'
            + '<span id="modern-file-name">No file chosen</span>';
        var fileInput = attachRow.querySelector('#modern-file-upload');
        if (fileUploadInput) {
            fileInput.onchange = function() {
                var fileName = fileInput.files[0] ? fileInput.files[0].name : 'No file chosen';
                document.getElementById('modern-file-name').innerText = fileName;
                // Copy file to original input (since original input is hidden)
                var dataTransfer = new DataTransfer();
                dataTransfer.items.add(fileInput.files[0]);
                fileUploadInput.files = dataTransfer.files;
            };
            // Hide original file input
            fileUploadInput.style.display = 'none';
        }

        // ---- Action buttons (Send / Preview) ----
        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        actions.innerHTML = ''
            + '<button type="button" id="modern-preview" class="modern-btn modern-btn-secondary">Preview</button>'
            + '<button type="button" id="modern-submit" class="modern-btn modern-btn-primary">Send Message</button>';

        // ---- Preview area (hidden initially) ----
        var previewArea = document.createElement('div');
        previewArea.id = 'modern-preview-area';
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<div class="preview-content"></div>';

        // ---- Assemble container ----
        container.appendChild(tabsHtml);
        container.appendChild(recipientRow);
        container.appendChild(toolbar);
        container.appendChild(textareaWrapper);
        container.appendChild(optionsRow);
        container.appendChild(attachRow);
        container.appendChild(actions);
        container.appendChild(previewArea);

        // Insert before legacy container
        legacyForm.parentNode.insertBefore(container, legacyForm);
        legacyForm.style.display = 'none';

        // ---- Bind data sync (original ↔ modern) ----
        var modernRecipient = document.getElementById('modern-recipient');
        var modernContact = document.getElementById('modern-contact');
        var modernTitle = document.getElementById('modern-title');
        var modernAddSent = document.getElementById('modern-add-sent');
        var modernAddTracking = document.getElementById('modern-add-tracking');

        function syncToOriginal() {
            if (recipientInput) recipientInput.value = modernRecipient.value;
            if (contactSelect) contactSelect.value = modernContact.value;
            if (titleInput) titleInput.value = modernTitle.value;
            if (addSentCheckbox) addSentCheckbox.checked = modernAddSent.checked;
            if (addTrackingCheckbox) addTrackingCheckbox.checked = modernAddTracking.checked;
            // Textarea is the original element, no need to copy
        }

        function syncFromOriginal() {
            if (recipientInput) modernRecipient.value = recipientInput.value;
            if (contactSelect) modernContact.value = contactSelect.value;
            if (titleInput) modernTitle.value = titleInput.value;
            if (addSentCheckbox) modernAddSent.checked = addSentCheckbox.checked;
            if (addTrackingCheckbox) modernAddTracking.checked = addTrackingCheckbox.checked;
        }

        // Sync on input events
        modernRecipient.addEventListener('input', syncToOriginal);
        modernContact.addEventListener('change', syncToOriginal);
        modernTitle.addEventListener('input', syncToOriginal);
        modernAddSent.addEventListener('change', syncToOriginal);
        modernAddTracking.addEventListener('change', syncToOriginal);
        postTextarea.addEventListener('input', syncToOriginal); // already original

        // Initial sync from original (in case values were pre-filled)
        syncFromOriginal();

        // ---- Handle Preview (using original ajaxRequest) ----
        var modernPreviewBtn = document.getElementById('modern-preview');
        modernPreviewBtn.onclick = function() {
            syncToOriginal();
            // Trigger original preview function
            if (typeof ajaxRequest === 'function') {
                ajaxRequest();
            } else if (previewButton && previewButton.onclick) {
                previewButton.click();
            }
            // Show preview area (the original #loading becomes visible)
            var loadingDiv = document.getElementById('loading');
            if (loadingDiv) {
                loadingDiv.style.display = 'block';
                previewArea.style.display = 'block';
                // Move preview content into our modern area (optional)
                var observer = new MutationObserver(function() {
                    var ajaxObj = document.getElementById('ajaxObject');
                    if (ajaxObj && ajaxObj.innerHTML) {
                        previewArea.querySelector('.preview-content').innerHTML = ajaxObj.innerHTML;
                        observer.disconnect();
                    }
                });
                observer.observe(loadingDiv, { childList: true, subtree: true });
            }
        };

        // ---- Handle Submit (trigger original form submission) ----
        var modernSubmitBtn = document.getElementById('modern-submit');
        modernSubmitBtn.onclick = function(e) {
            e.preventDefault();
            syncToOriginal();
            if (originalForm && typeof originalForm.submit === 'function') {
                // Validate before submit (original ValidateForm)
                if (typeof ValidateForm === 'function') {
                    if (!ValidateForm(1)) return;
                }
                originalForm.submit();
            } else if (submitButton) {
                submitButton.click();
            }
        };

        // ---- Smilies integration (keep original smilies panel accessible) ----
        var smileBtn = document.createElement('button');
        smileBtn.type = 'button';
        smileBtn.className = 'modern-editor-btn';
        smileBtn.innerHTML = '<i class="fas fa-smile"></i>';
        smileBtn.title = 'Insert smiley';
        smileBtn.onclick = function() {
            var smiliesDiv = document.getElementById('smilies');
            if (smiliesDiv) {
                smiliesDiv.classList.toggle('nascosta');
                // Ensure it appears near the textarea
                smiliesDiv.style.position = 'absolute';
                smiliesDiv.style.zIndex = '1000';
                smiliesDiv.style.backgroundColor = 'var(--surface-color)';
                // Position logic could be added here
            }
        };
        toolbar.insertBefore(smileBtn, imgbbBtn);

        // ---- File attachment visual update ----
        var fileLabel = attachRow.querySelector('.modern-file-label');
        fileLabel.onclick = function() { fileInput.click(); };

        // ---- Style with CSS (or reuse existing theme) ----
        var style = document.createElement('style');
        style.textContent = ''
            + '.modern-messenger { background: var(--surface-color); border-radius: var(--radius-lg); border: 1px solid var(--border-color); box-shadow: var(--shadow-md); overflow: hidden; margin-bottom: var(--space-lg); }'
            + '.modern-tabs { /* reuse existing .cp.send .tabs styles */ }'
            + '.modern-recipient-row { display: flex; gap: var(--space-lg); padding: var(--space-md); flex-wrap: wrap; }'
            + '.modern-field { flex: 1; }'
            + '.modern-field label { display: block; margin-bottom: var(--space-xs); color: var(--text-secondary); }'
            + '.modern-recipient-controls { display: flex; gap: var(--space-sm); flex-wrap: wrap; }'
            + '.modern-input, .modern-select { background: var(--bg-color); border: 1px solid var(--border-color); border-radius: var(--radius); padding: var(--pad-3) var(--pad-4); color: var(--text-primary); font-family: var(--font-primary); width: 100%; }'
            + '.modern-editor-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-xs); padding: var(--pad-4) var(--pad-6); border-bottom: 1px solid var(--border-color); background: var(--bg-color); }'
            + '.modern-editor-btn { background: var(--surface-color); border: 1px solid var(--border-color); border-radius: var(--radius-sm); width: 2rem; height: 2rem; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-secondary); transition: all 0.2s; }'
            + '.modern-editor-btn:hover { background: var(--hover-color); border-color: var(--primary-color); color: var(--text-primary); transform: translateY(-1px); }'
            + '.modern-textarea { background: var(--bg-color); border: 1px solid var(--border-color); border-radius: var(--radius); padding: var(--pad-4); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--text-sm); line-height: 1.618; width: 100%; resize: vertical; margin: var(--space-md); width: calc(100% - 2 * var(--space-md)); }'
            + '.modern-options { display: flex; gap: var(--space-lg); padding: var(--pad-4) var(--pad-6); border-top: 1px solid var(--border-color); }'
            + '.modern-checkbox { display: flex; align-items: center; gap: var(--space-xs); cursor: pointer; color: var(--text-secondary); }'
            + '.modern-attach { padding: var(--pad-4) var(--pad-6); border-top: 1px solid var(--border-color); display: flex; align-items: center; gap: var(--space-md); }'
            + '.modern-file-label { background: var(--surface-light); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: var(--pad-2) var(--pad-4); cursor: pointer; display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--text-primary); }'
            + '.modern-actions { display: flex; justify-content: flex-end; gap: var(--space-md); padding: var(--pad-5); border-top: 1px solid var(--border-color); }'
            + '.modern-btn { border: none; border-radius: var(--radius); padding: var(--pad-3) var(--pad-6); font-family: var(--font-primary); font-weight: 500; font-size: var(--text-sm); cursor: pointer; transition: all 0.2s; }'
            + '.modern-btn-primary { background: var(--primary-color); color: white; }'
            + '.modern-btn-primary:hover { background: var(--primary-dark); transform: translateY(-1px); }'
            + '.modern-btn-secondary { background: var(--surface-color); border: 1px solid var(--border-color); color: var(--text-secondary); }'
            + '.modern-btn-secondary:hover { background: var(--hover-color); border-color: var(--primary-color); color: var(--text-primary); transform: translateY(-1px); }'
            + '.modern-preview { background: var(--surface-color); border: 1px solid var(--border-color); border-radius: var(--radius); margin: var(--space-md); padding: var(--space-md); }'
            + '.modern-preview .preview-content { color: var(--text-primary); }'
            + '#smilies.nascosta { display: none; }'
            + '#smilies { position: absolute; z-index: 1000; background: var(--surface-color); border: 1px solid var(--border-color); border-radius: var(--radius); padding: var(--space-sm); max-width: 300px; }';
        document.head.appendChild(style);

        // ---- Hide original carousel on this page (optional) ----
        var carousel = document.querySelector('.carousel-wrapper');
        if (carousel) carousel.style.display = 'none';

        console.log('[ModernMessenger] Initialized');
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
})();
