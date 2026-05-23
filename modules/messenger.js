// Messenger Module – modern UI for private messages
var MessengerModule = (function(Utils, EventBus) {
    'use strict';

    var isInitialized = false;

    // Main initialization function (called by the orchestrator)
    function initialize() {
        if (isInitialized) return Promise.resolve();

        // Only run on Messenger page
        if (document.body.id !== 'msg') return Promise.resolve();

        // Avoid double initialization
        if (document.getElementById('modern-messenger')) {
            isInitialized = true;
            return Promise.resolve();
        }

        return new Promise(function(resolve, reject) {
            try {
                buildModernMessenger();
                isInitialized = true;
                if (EventBus) EventBus.trigger('messenger:ready');
                resolve();
            } catch (err) {
                console.error('[MessengerModule]', err);
                reject(err);
            }
        });
    }

    function buildModernMessenger() {
        // ---- Extract original elements (same as your previous script) ----
        var legacyForm = document.querySelector('.cp.send');
        if (!legacyForm) return;

        var recipientInput = document.querySelector('input[name="entered_name"]');
        var contactSelect = document.querySelector('select[name="from_contact"]');
        var titleInput = document.querySelector('input[name="msg_title"]');
        var postTextarea = document.getElementById('Post');
        var addSentCheckbox = document.getElementById('add_sent');
        var addTrackingCheckbox = document.getElementById('add_tracking');
        var fileUploadInput = document.querySelector('input[name="FILE_UPLOAD"]');
        var submitButton = document.querySelector('input[name="sub_mit"]');
        var previewButton = document.querySelector('button[name="preview"]');
        var originalForm = window.REPLIER;

        if (!postTextarea) return;

        // ---- Create modern container (exactly as your previous code, but without duplicate style injection) ----
        // (We will reuse the existing CSS from your theme, so no inline <style> needed)
        var container = document.createElement('div');
        container.id = 'modern-messenger';
        container.className = 'modern-messenger';

        // Tabs (clone original)
        var tabsHtml = document.querySelector('.cp.send .tabs').cloneNode(true);
        tabsHtml.classList.add('modern-tabs');

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
        // ImgBB button
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

        // Smiley button (toggle original smilies panel)
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

        // Textarea wrapper
        var textareaWrapper = document.createElement('div');
        textareaWrapper.className = 'modern-textarea-wrapper';
        postTextarea.style.width = '100%';
        postTextarea.style.minHeight = '200px';
        postTextarea.classList.add('modern-textarea');
        textareaWrapper.appendChild(postTextarea);

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
                document.getElementById('modern-file-name').innerText = fileName;
                var dataTransfer = new DataTransfer();
                dataTransfer.items.add(fileInput.files[0]);
                fileUploadInput.files = dataTransfer.files;
            };
            fileUploadInput.style.display = 'none';
        }
        var fileLabel = attachRow.querySelector('.modern-file-label');
        fileLabel.onclick = function() { fileInput.click(); };

        // Action buttons
        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        actions.innerHTML = ''
            + '<button type="button" id="modern-preview" class="modern-btn modern-btn-secondary">Preview</button>'
            + '<button type="button" id="modern-submit" class="modern-btn modern-btn-primary">Send Message</button>';

        // Preview area
        var previewArea = document.createElement('div');
        previewArea.id = 'modern-preview-area';
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<div class="preview-content"></div>';

        // Assemble
        container.appendChild(tabsHtml);
        container.appendChild(recipientRow);
        container.appendChild(toolbar);
        container.appendChild(textareaWrapper);
        container.appendChild(optionsRow);
        container.appendChild(attachRow);
        container.appendChild(actions);
        container.appendChild(previewArea);

        // Insert and hide original
        legacyForm.parentNode.insertBefore(container, legacyForm);
        legacyForm.style.display = 'none';

        // ---- Data binding (same as previous script) ----
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
        }

        function syncFromOriginal() {
            if (recipientInput) modernRecipient.value = recipientInput.value;
            if (contactSelect) modernContact.value = contactSelect.value;
            if (titleInput) modernTitle.value = titleInput.value;
            if (addSentCheckbox) modernAddSent.checked = addSentCheckbox.checked;
            if (addTrackingCheckbox) modernAddTracking.checked = addTrackingCheckbox.checked;
        }

        modernRecipient.addEventListener('input', syncToOriginal);
        modernContact.addEventListener('change', syncToOriginal);
        modernTitle.addEventListener('input', syncToOriginal);
        modernAddSent.addEventListener('change', syncToOriginal);
        modernAddTracking.addEventListener('change', syncToOriginal);
        postTextarea.addEventListener('input', syncToOriginal);
        syncFromOriginal();

        // Preview button
        var modernPreviewBtn = document.getElementById('modern-preview');
        modernPreviewBtn.onclick = function() {
            syncToOriginal();
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
                        previewArea.querySelector('.preview-content').innerHTML = ajaxObj.innerHTML;
                        observer.disconnect();
                    }
                });
                observer.observe(loadingDiv, { childList: true, subtree: true });
            }
        };

        // Submit button
        var modernSubmitBtn = document.getElementById('modern-submit');
        modernSubmitBtn.onclick = function(e) {
            e.preventDefault();
            syncToOriginal();
            if (originalForm && typeof originalForm.submit === 'function') {
                if (typeof ValidateForm === 'function') {
                    if (!ValidateForm(1)) return;
                }
                originalForm.submit();
            } else if (submitButton) {
                submitButton.click();
            }
        };

        // Hide carousel (if any)
        var carousel = document.querySelector('.carousel-wrapper');
        if (carousel) carousel.style.display = 'none';
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

    // Public API
    return {
        initialize: initialize,
        reset: function() { isInitialized = false; }
    };

})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);
