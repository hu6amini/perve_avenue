// Messenger Module – Complete modern UI for all messenger sections
var MessengerModule = (function(Utils, EventBus) {
    'use strict';

    var isInitialized = false;
    var wysiwygDiv = null;
    var observerCallbacks = [];

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
            var buildStarted = false;

            function doBuild() {
                if (buildStarted) return;
                buildStarted = true;
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

            function waitForEnhancer() {
                return new Promise(function(res) {
                    if (document.getElementById('modern-forum-wrapper')) {
                        res();
                        return;
                    }
                    function onReady() {
                        window.removeEventListener('forum:enhancer:ready', onReady);
                        res();
                    }
                    window.addEventListener('forum:enhancer:ready', onReady);
                    setTimeout(res, 2000);
                });
            }

            waitForEnhancer().then(function() {
                if (globalThis.forumObserver && typeof globalThis.forumObserver.register === 'function') {
                    var targetSelector = '';
                    if (currentSection === 'messages') {
                        targetSelector = '.big_list .row-mp';
                    } else if (currentSection === 'contacts') {
                        targetSelector = 'textarea[name="can_contact"]';
                    } else {
                        targetSelector = '.cp.send, #Post';
                    }

                    var observerId = globalThis.forumObserver.register({
                        id: 'messenger-init',
                        selector: targetSelector,
                        priority: 'critical',
                        callback: function(node) {
                            if (!isInitialized && !document.getElementById('modern-messenger')) {
                                globalThis.forumObserver.unregister(observerId);
                                if (currentSection === 'compose') {
                                    if (typeof tag !== 'undefined' && typeof ajaxRequest !== 'undefined') {
                                        setTimeout(doBuild, 0);
                                    } else {
                                        window.addEventListener('load', doBuild, { once: true });
                                    }
                                } else {
                                    setTimeout(doBuild, 0);
                                }
                            }
                        }
                    });

                    if (document.querySelector(targetSelector)) {
                        globalThis.forumObserver.unregister(observerId);
                        if (currentSection === 'compose') {
                            if (typeof tag !== 'undefined' && typeof ajaxRequest !== 'undefined') {
                                setTimeout(doBuild, 0);
                            } else {
                                window.addEventListener('load', doBuild, { once: true });
                            }
                        } else {
                            setTimeout(doBuild, 0);
                        }
                    }

                    setTimeout(function() {
                        if (!isInitialized && !document.getElementById('modern-messenger')) {
                            if (observerId) globalThis.forumObserver.unregister(observerId);
                            if (currentSection === 'compose') {
                                if (typeof tag !== 'undefined' && typeof ajaxRequest !== 'undefined') {
                                    doBuild();
                                } else {
                                    window.addEventListener('load', doBuild, { once: true });
                                }
                            } else {
                                doBuild();
                            }
                        }
                    }, 1500);
                } else {
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', doBuild);
                    } else {
                        doBuild();
                    }
                }
            });
        });
    }

    function reset() {
        isInitialized = false;
        observerCallbacks.forEach(function(id) {
            if (globalThis.forumObserver && typeof globalThis.forumObserver.unregister === 'function') {
                globalThis.forumObserver.unregister(id);
            }
        });
        observerCallbacks = [];
    }

    function waitForGlobalFunctions() {
        if (currentSection !== 'compose') {
            return Promise.resolve();
        }
        return new Promise(function(resolve) {
            var maxAttempts = 100;
            var attempt = 0;
            function check() {
                if (typeof tag !== 'undefined' && typeof ajaxRequest !== 'undefined') {
                    resolve();
                } else if (++attempt >= maxAttempts) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            }
            check();
        });
    }

    // ------------------------------------------------------------------------
    // HELPERS
    // ------------------------------------------------------------------------
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        try {
            var date = new Date(dateStr);
            return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch(e) { return dateStr; }
    }

    // ------------------------------------------------------------------------
    // CONVERTERS (Legacy BBCode ↔ HTML) – for compose only
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
    // WYSIWYG formatting helpers (compose only)
    // ------------------------------------------------------------------------
    function applyFormat(command, value) {
        document.execCommand(command, false, value);
        if (wysiwygDiv) wysiwygDiv.focus();
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
        if (wysiwygDiv) wysiwygDiv.focus();
    }

    // ------------------------------------------------------------------------
    // MODERN SECTION BUILDERS
    // ------------------------------------------------------------------------

    // ----- COMPOSE SECTION (unchanged, fully modern) -----
    function buildComposeSection() {
        var recipientInput = document.querySelector('input[name="entered_name"]');
        var contactSelect = document.querySelector('select[name="from_contact"]');
        var titleInput = document.querySelector('input[name="msg_title"]');
        var originalTextarea = document.getElementById('Post');
        var addSentCheckbox = document.getElementById('add_sent');
        var addTrackingCheckbox = document.getElementById('add_tracking');
        var submitButton = document.querySelector('input[name="sub_mit"]');
        var previewButton = document.querySelector('button[name="preview"]');
        var originalForm = window.REPLIER;

        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'compose-section';

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

        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';

        var buttons = [
            { title: 'Bold',          icon: 'fa-regular fa-bold',         cmd: function() { applyFormat('bold'); } },
            { title: 'Italic',        icon: 'fa-regular fa-italic',       cmd: function() { applyFormat('italic'); } },
            { title: 'Underline',     icon: 'fa-regular fa-underline',    cmd: function() { applyFormat('underline'); } },
            { title: 'Strikethrough', icon: 'fa-regular fa-strikethrough',cmd: function() { applyFormat('strikeThrough'); } },
            { title: 'List UL',       icon: 'fa-regular fa-list',         cmd: function() { applyFormat('insertUnorderedList'); } },
            { title: 'Link',          icon: 'fa-regular fa-link',         cmd: function() { var url = prompt('Enter URL:'); if (url) applyFormat('createLink', url); } },
            { title: 'Image URL',     icon: 'fa-regular fa-image',        cmd: function() { var url = prompt('Enter image URL:'); if (url) applyFormat('insertImage', url); } },
            { title: 'Quote',         icon: 'fa-regular fa-quote-left',   cmd: function() { applyCustomBBCode('<blockquote>', '</blockquote>'); } },
            { title: 'Code',          icon: 'fa-regular fa-code',         cmd: function() { applyCustomBBCode('<pre><code>', '</code></pre>'); } },
            { title: 'Spoiler',       icon: 'fa-regular fa-eye-slash',    cmd: function() { applyCustomBBCode('<div class="spoiler">', '</div>'); } }
        ];

        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'modern-editor-btn';
            button.innerHTML = '<i class="' + btn.icon + '"></i>';
            button.title = btn.title;
            button.onclick = (function(cmd) { return function() { cmd(); }; })(btn.cmd);
            toolbar.appendChild(button);
        }

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

        var imgbbBtn = document.createElement('button');
        imgbbBtn.type = 'button';
        imgbbBtn.className = 'modern-editor-btn';
        imgbbBtn.innerHTML = '<i class="fa-regular fa-cloud-arrow-up"></i>';
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

        wysiwygDiv = document.createElement('div');
        wysiwygDiv.className = 'modern-wysiwyg';
        wysiwygDiv.contentEditable = 'true';
        wysiwygDiv.setAttribute('role', 'textbox');
        wysiwygDiv.setAttribute('aria-multiline', 'true');
        wysiwygDiv.innerHTML = legacyToHtml(originalTextarea ? originalTextarea.value : '');

        function isWysiwygEmpty() {
            var content = wysiwygDiv.innerHTML;
            return content === '' || content === '<br>' || content === '<br _moz_dirty="">' || content === '<div><br></div>' || content.trim() === '';
        }
        function updatePlaceholder() {
            if (isWysiwygEmpty()) wysiwygDiv.classList.add('empty');
            else wysiwygDiv.classList.remove('empty');
        }
        if (originalTextarea) {
            wysiwygDiv.addEventListener('input', function() {
                originalTextarea.value = htmlToLegacy(wysiwygDiv.innerHTML);
                updatePlaceholder();
            });
        }
        wysiwygDiv.addEventListener('focus', updatePlaceholder);
        wysiwygDiv.addEventListener('blur', updatePlaceholder);
        wysiwygDiv.addEventListener('keyup', updatePlaceholder);
        updatePlaceholder();

        var optionsRow = document.createElement('div');
        optionsRow.className = 'modern-options';
        optionsRow.innerHTML = ''
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-sent" ' + (addSentCheckbox && addSentCheckbox.checked ? 'checked' : '') + '> <span>Add a copy to Sent Items</span></label>'
            + '<label class="modern-checkbox"><input type="checkbox" id="modern-add-tracking" ' + (addTrackingCheckbox && addTrackingCheckbox.checked ? 'checked' : '') + '> <span>Notify when read</span></label>';

        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        actions.innerHTML = ''
            + '<button type="button" id="modern-preview" class="modern-btn modern-btn-secondary"><i class="fa-regular fa-eye"></i> Preview</button>'
            + '<button type="button" id="modern-submit" class="modern-btn modern-btn-primary"><i class="fa-regular fa-paper-plane"></i> Send message</button>';

        var previewArea = document.createElement('div');
        previewArea.id = 'modern-preview-area';
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<div class="preview-content"></div>';

        container.appendChild(recipientRow);
        container.appendChild(toolbar);
        container.appendChild(wysiwygDiv);
        container.appendChild(optionsRow);
        container.appendChild(actions);
        container.appendChild(previewArea);

        var modernRecipient    = container.querySelector('#modern-recipient');
        var modernContact      = container.querySelector('#modern-contact');
        var modernTitle        = container.querySelector('#modern-title');
        var modernAddSent      = container.querySelector('#modern-add-sent');
        var modernAddTracking  = container.querySelector('#modern-add-tracking');

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
                if (originalTextarea) originalTextarea.value = htmlToLegacy(wysiwygDiv.innerHTML);
                if (typeof ajaxRequest === 'function') ajaxRequest();
                else if (previewButton) previewButton.click();
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

        var modernSubmitBtn = container.querySelector('#modern-submit');
        if (modernSubmitBtn) {
            modernSubmitBtn.onclick = function(e) {
                e.preventDefault();
                syncToOriginal();
                if (originalTextarea) originalTextarea.value = htmlToLegacy(wysiwygDiv.innerHTML);
                if (originalForm && typeof originalForm.submit === 'function') {
                    if (typeof ValidateForm === 'function') if (!ValidateForm(1)) return;
                    originalForm.submit();
                } else if (submitButton) submitButton.click();
            };
        }
        return container;
    }

    // ----- MODERN MESSAGES SECTION (transformed from legacy data) -----
    function buildModernMessagesSection() {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'messages-section';

        // Extract folder selector and message list from legacy DOM
        var folderSelect = document.querySelector('select[name="VID"]');
        var messageRows = document.querySelectorAll('.big_list .row-mp');
        var totalMessages = document.querySelector('.main_list dl dd') ? document.querySelector('.main_list dl dd').innerText : '0';
        var spaceLeft = document.querySelectorAll('.main_list dl dd')[1] ? document.querySelectorAll('.main_list dl dd')[1].innerText : '0';

        // Create folder header
        var folderRow = document.createElement('div');
        folderRow.className = 'messages-folder-row';
        folderRow.innerHTML = ''
            + '<div class="messages-stats">'
            + '<span><i class="fa-regular fa-envelope"></i> Total messages: ' + escapeHtml(totalMessages) + '</span>'
            + '<span><i class="fa-regular fa-database"></i> Space left: ' + escapeHtml(spaceLeft) + '</span>'
            + '</div>'
            + '<div class="messages-folder-selector">'
            + '<label>Folder:</label> '
            + '<select id="modern-folder-select" class="modern-select">' + (folderSelect ? folderSelect.innerHTML : '<option value="in">Inbox</option><option value="sent">Sent</option>') + '</select>'
            + '</div>';
        container.appendChild(folderRow);

        // Message list header
        var listHeader = document.createElement('div');
        listHeader.className = 'messages-list-header';
        listHeader.innerHTML = ''
            + '<div class="msg-status"></div>'
            + '<div class="msg-title">Message title</div>'
            + '<div class="msg-sender">Sender</div>'
            + '<div class="msg-date">Date</div>'
            + '<div class="msg-select"><input type="checkbox" id="select-all-msgs" class="modern-checkbox-input"></div>';
        container.appendChild(listHeader);

        // Message list
        var listContainer = document.createElement('div');
        listContainer.className = 'messages-list';

        for (var i = 0; i < messageRows.length; i++) {
            var row = messageRows[i];
            var isRead = row.classList.contains('off') ? false : true;
            var iconClass = isRead ? 'fa-envelope-open' : 'fa-envelope';
            var titleLink = row.querySelector('.bb h4 a');
            var title = titleLink ? titleLink.textContent.trim() : '';
            var titleHref = titleLink ? titleLink.getAttribute('href') : '#';
            var senderLink = row.querySelector('.xx a');
            var senderName = senderLink ? senderLink.textContent.trim() : 'Unknown';
            var senderHref = senderLink ? senderLink.getAttribute('href') : '#';
            var dateSpan = row.querySelector('.zz .when');
            var date = dateSpan ? dateSpan.getAttribute('title') || dateSpan.textContent : '';
            var dateFormatted = formatDate(date);
            var checkboxId = 'msg-' + i;
            var msgId = row.id ? row.id.replace('msg', '') : i;

            var msgRow = document.createElement('div');
            msgRow.className = 'message-row' + (isRead ? ' read' : ' unread');
            msgRow.innerHTML = ''
                + '<div class="msg-status"><i class="fa-regular ' + iconClass + '"></i></div>'
                + '<div class="msg-title"><a href="' + escapeHtml(titleHref) + '">' + escapeHtml(title) + '</a></div>'
                + '<div class="msg-sender"><a href="' + escapeHtml(senderHref) + '">' + escapeHtml(senderName) + '</a></div>'
                + '<div class="msg-date">' + escapeHtml(dateFormatted) + '</div>'
                + '<div class="msg-select"><input type="checkbox" class="modern-checkbox-input" data-msgid="' + escapeHtml(msgId) + '" id="' + checkboxId + '"></div>';
            listContainer.appendChild(msgRow);
        }

        container.appendChild(listContainer);

        // Action bar (export, move, delete)
        var actionBar = document.createElement('div');
        actionBar.className = 'messages-action-bar';
        actionBar.innerHTML = ''
            + '<div class="action-group">'
            + '<button class="modern-btn modern-btn-secondary" id="export-messages"><i class="fa-regular fa-download"></i> Export as</button> '
            + '<select id="export-format" class="modern-select-sm"><option value="html">HTML</option><option value="xls">Excel</option></select>'
            + '</div>'
            + '<div class="action-group">'
            + '<button class="modern-btn modern-btn-secondary" id="move-messages"><i class="fa-regular fa-folder-open"></i> Move to</button> '
            + '<select id="move-folder" class="modern-select-sm"><option value="in">Inbox</option><option value="sent">Sent</option></select>'
            + '</div>'
            + '<div class="action-group">'
            + '<button class="modern-btn modern-btn-secondary danger" id="delete-messages"><i class="fa-regular fa-trash-can"></i> Delete selected</button>'
            + '</div>';
        container.appendChild(actionBar);

        // Attach event listeners for actions (submit original forms)
        var folderSelectModern = container.querySelector('#modern-folder-select');
        if (folderSelectModern && folderSelect) {
            folderSelectModern.addEventListener('change', function() {
                folderSelect.value = this.value;
                folderSelect.form.submit();
            });
        }

        var selectAllCheckbox = container.querySelector('#select-all-msgs');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', function() {
                var checkboxes = container.querySelectorAll('.message-row .modern-checkbox-input');
                for (var j = 0; j < checkboxes.length; j++) {
                    checkboxes[j].checked = this.checked;
                }
            });
        }

        var exportBtn = container.querySelector('#export-messages');
        var exportFormat = container.querySelector('#export-format');
        if (exportBtn && originalForm) {
            exportBtn.addEventListener('click', function() {
                var form = document.querySelector('form[name="inbox"]');
                if (form) {
                    var archiveInput = form.querySelector('input[name="archive"]');
                    if (archiveInput) archiveInput.click();
                    else if (form.submit) form.submit();
                }
            });
        }

        var deleteBtn = container.querySelector('#delete-messages');
        if (deleteBtn && originalForm) {
            deleteBtn.addEventListener('click', function() {
                if (confirm('Delete selected messages?')) {
                    var form = document.querySelector('form[name="inbox"]');
                    if (form) {
                        var deleteInput = form.querySelector('input[name="delete"]');
                        if (deleteInput) deleteInput.click();
                        else if (form.submit) form.submit();
                    }
                }
            });
        }

        return container;
    }

    // ----- MODERN CONTACTS SECTION (transformed from legacy data) -----
    function buildModernContactsSection() {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'contacts-section';

        // Extract data from legacy form
        var friendsTextarea = document.querySelector('textarea[name="can_contact"]');
        var blockedTextarea = document.querySelector('textarea[name="cannot_contact"]');
        var privacySelect = document.querySelector('select[name="nobody_can_contact"]');
        var updateButton = document.querySelector('input[value="Update Contact list"]');

        var friendsList = friendsTextarea ? friendsTextarea.value : '';
        var blockedList = blockedTextarea ? blockedTextarea.value : '';
        var privacyValue = privacySelect ? privacySelect.value : '0';

        var friendsCard = document.createElement('div');
        friendsCard.className = 'contacts-card';
        friendsCard.innerHTML = ''
            + '<h3 class="contacts-card-title"><i class="fa-regular fa-user-group"></i> Friends list</h3>'
            + '<textarea id="modern-friends-list" class="modern-textarea-contacts" rows="8" placeholder="One username per line">' + escapeHtml(friendsList) + '</textarea>'
            + '<p class="contacts-help">Users you allow to message you (if privacy setting is enabled).</p>';

        var blockedCard = document.createElement('div');
        blockedCard.className = 'contacts-card';
        blockedCard.innerHTML = ''
            + '<h3 class="contacts-card-title"><i class="fa-regular fa-ban"></i> Blocked users</h3>'
            + '<textarea id="modern-blocked-list" class="modern-textarea-contacts" rows="5" placeholder="One username per line">' + escapeHtml(blockedList) + '</textarea>'
            + '<p class="contacts-help">These users cannot send you messages or mention you.</p>';

        var privacyCard = document.createElement('div');
        privacyCard.className = 'contacts-card';
        privacyCard.innerHTML = ''
            + '<h3 class="contacts-card-title"><i class="fa-regular fa-shield"></i> Privacy settings</h3>'
            + '<div class="privacy-option">'
            + '<label class="modern-radio"><input type="radio" name="privacy" value="1" ' + (privacyValue === '1' ? 'checked' : '') + '> <span>Yes, only friends can message me</span></label>'
            + '<label class="modern-radio"><input type="radio" name="privacy" value="0" ' + (privacyValue === '0' ? 'checked' : '') + '> <span>No, everyone can message me (except blocked)</span></label>'
            + '</div>';

        var actionsDiv = document.createElement('div');
        actionsDiv.className = 'contacts-actions';
        actionsDiv.innerHTML = '<button class="modern-btn modern-btn-primary" id="update-contacts"><i class="fa-regular fa-floppy-disk"></i> Update contact list</button>';

        container.appendChild(friendsCard);
        container.appendChild(blockedCard);
        container.appendChild(privacyCard);
        container.appendChild(actionsDiv);

        // Sync data to original form and submit
        var updateContactsBtn = container.querySelector('#update-contacts');
        if (updateContactsBtn && updateButton) {
            updateContactsBtn.addEventListener('click', function() {
                var newFriends = container.querySelector('#modern-friends-list').value;
                var newBlocked = container.querySelector('#modern-blocked-list').value;
                var newPrivacy = container.querySelector('input[name="privacy"]:checked').value;
                if (friendsTextarea) friendsTextarea.value = newFriends;
                if (blockedTextarea) blockedTextarea.value = newBlocked;
                if (privacySelect) privacySelect.value = newPrivacy;
                updateButton.click();
            });
        }

        return container;
    }

    // ------------------------------------------------------------------------
    // CORE BUILDER
    // ------------------------------------------------------------------------
    function buildModernMessenger() {
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (!wrapper) {
            setTimeout(function() { buildModernMessenger(); }, 100);
            return;
        }

        var carousel = wrapper.querySelector('.carousel-wrapper');
        if (document.getElementById('modern-messenger')) return;

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
            link.className = 'modern-nav-link';
            if (item.section === currentSection) link.classList.add('current');
            var icon = document.createElement('i');
            icon.className = item.icon;
            icon.setAttribute('aria-hidden', 'true');
            link.appendChild(icon);
            var span = document.createElement('span');
            span.className = 'modern-nav-text';
            span.textContent = item.text;
            link.appendChild(span);
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
    }

    return {
        initialize: initialize,
        reset: reset
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);
