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
                setTimeout(res, 2000); // safety
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
                        // Wait for the load event to ensure tag/ajaxRequest are ready
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

        // Check if elements already exist
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

        // Fallback timeout
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
        // fallback (same as before)
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

    // FIX: Only poll for compose-page globals (tag / ajaxRequest) when we are
    // actually on the compose page.  On messages / contacts those functions are
    // never injected, so the old unconditional poll wasted ~5 seconds every time.
    function waitForGlobalFunctions() {
        if (currentSection !== 'compose') {
            return Promise.resolve();
        }

        return new Promise(function(resolve) {
            var maxAttempts = 50;
            var attempt = 0;
            function check() {
                if (typeof tag !== 'undefined' && typeof ajaxRequest !== 'undefined') {
                    resolve();
                } else if (++attempt >= maxAttempts) {
                    console.warn('[MessengerModule] Global functions not found, continuing anyway');
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

    // FIX: Wait until a CSS selector matches something in the DOM, with retries.
    // Used by buildMessagesSection / buildContactsSection so they don't silently
    // fall back to the empty-state when called a few milliseconds too early.
    function waitForElement(selector, maxMs) {
        maxMs = maxMs || 3000;
        return new Promise(function(resolve) {
            var el = document.querySelector(selector);
            if (el) { resolve(el); return; }

            var elapsed = 0;
            var interval = 50;
            var timer = setInterval(function() {
                el = document.querySelector(selector);
                elapsed += interval;
                if (el || elapsed >= maxMs) {
                    clearInterval(timer);
                    resolve(el || null);
                }
            }, interval);
        });
    }

    // ------------------------------------------------------------------------
    // CONVERTERS (Legacy BBCode ↔ HTML)
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
    // WYSIWYG formatting helpers
    // ------------------------------------------------------------------------
    function applyFormat(command, value) {
        document.execCommand(command, false, value);
        focusWysiwyg();
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
        focusWysiwyg();
    }

    function focusWysiwyg() {
        if (wysiwygDiv) wysiwygDiv.focus();
    }

    // ------------------------------------------------------------------------
    // SECTION BUILDERS
    // ------------------------------------------------------------------------
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
            button.onclick = (function(cmd) {
                return function() { cmd(); };
            })(btn.cmd);
            toolbar.appendChild(button);
        }

        var smileBtn = document.createElement('button');
        smileBtn.type = 'button';
        smileBtn.className = 'modern-editor-btn';
        smileBtn.innerHTML = '<i class="fa-regular fa-face-smile"></i>';
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
            if (isWysiwygEmpty()) {
                wysiwygDiv.classList.add('empty');
            } else {
                wysiwygDiv.classList.remove('empty');
            }
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

        // Wire up sync after appending so getElementById works
        var modernRecipient    = container.querySelector('#modern-recipient');
        var modernContact      = container.querySelector('#modern-contact');
        var modernTitle        = container.querySelector('#modern-title');
        var modernAddSent      = container.querySelector('#modern-add-sent');
        var modernAddTracking  = container.querySelector('#modern-add-tracking');

        function syncToOriginal() {
            if (recipientInput && modernRecipient)    recipientInput.value         = modernRecipient.value;
            if (contactSelect  && modernContact)      contactSelect.value          = modernContact.value;
            if (titleInput     && modernTitle)        titleInput.value             = modernTitle.value;
            if (addSentCheckbox     && modernAddSent)      addSentCheckbox.checked      = modernAddSent.checked;
            if (addTrackingCheckbox && modernAddTracking)  addTrackingCheckbox.checked  = modernAddTracking.checked;
        }

        function syncFromOriginal() {
            if (recipientInput && modernRecipient)    modernRecipient.value        = recipientInput.value;
            if (contactSelect  && modernContact)      modernContact.value          = contactSelect.value;
            if (titleInput     && modernTitle)        modernTitle.value            = titleInput.value;
            if (addSentCheckbox     && modernAddSent)      modernAddSent.checked        = addSentCheckbox.checked;
            if (addTrackingCheckbox && modernAddTracking)  modernAddTracking.checked    = addTrackingCheckbox.checked;
        }

        if (modernRecipient)   modernRecipient.addEventListener('input',  syncToOriginal);
        if (modernContact)     modernContact.addEventListener('change',   syncToOriginal);
        if (modernTitle)       modernTitle.addEventListener('input',      syncToOriginal);
        if (modernAddSent)     modernAddSent.addEventListener('change',   syncToOriginal);
        if (modernAddTracking) modernAddTracking.addEventListener('change', syncToOriginal);
        syncFromOriginal();

        var modernPreviewBtn = container.querySelector('#modern-preview');
        if (modernPreviewBtn) {
            modernPreviewBtn.onclick = function() {
                syncToOriginal();
                if (originalTextarea) originalTextarea.value = htmlToLegacy(wysiwygDiv.innerHTML);
                if (typeof ajaxRequest === 'function') {
                    ajaxRequest();
                } else if (previewButton) {
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

        var modernSubmitBtn = container.querySelector('#modern-submit');
        if (modernSubmitBtn) {
            modernSubmitBtn.onclick = function(e) {
                e.preventDefault();
                syncToOriginal();
                if (originalTextarea) originalTextarea.value = htmlToLegacy(wysiwygDiv.innerHTML);
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

        return container;
    }

    // FIX: Accept the already-resolved element so no second querySelector is needed.
    function buildMessagesSection(cpElement) {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'messages-section';

        if (cpElement) {
            var messagesClone = cpElement.cloneNode(true);
            var tabsClone = messagesClone.querySelector('.tabs');
            if (tabsClone) tabsClone.remove();
            var notificationLink = messagesClone.querySelector('.notification-link');
            if (notificationLink) notificationLink.remove();
            container.appendChild(messagesClone);
        } else {
            container.innerHTML = '<div class="modern-empty-state"><i class="fa-regular fa-inbox"></i><p>No messages</p></div>';
        }

        return container;
    }

    // FIX: Same — accept the pre-resolved element.
    function buildContactsSection(cpElement) {
        var container = document.createElement('div');
        container.className = 'modern-messenger-section';
        container.id = 'contacts-section';

        if (cpElement) {
            var contactsClone = cpElement.cloneNode(true);
            var tabsClone = contactsClone.querySelector('.tabs');
            if (tabsClone) tabsClone.remove();
            container.appendChild(contactsClone);
        } else {
            container.innerHTML = '<div class="modern-empty-state"><i class="fa-regular fa-address-book"></i><p>Contacts list</p></div>';
        }

        return container;
    }

    // ------------------------------------------------------------------------
    // CORE BUILDER
    // ------------------------------------------------------------------------
    function buildModernMessenger() {
        var wrapper = document.getElementById('modern-forum-wrapper');
        if (!wrapper) {
            console.warn('[MessengerModule] Wrapper not found, will retry');
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
            finalize();
        } else if (currentSection === 'messages') {
            // FIX: Use waitForElement so we don't clone before the list is painted.
            waitForElement('.big_list .row-mp').then(function(rowEl) {
                // The .cp ancestor contains the full inbox — walk up to it.
                var cpEl = rowEl ? findAncestor(rowEl, '.cp') : null;
                mainContent.appendChild(buildMessagesSection(cpEl));
                finalize();
            });
            return; // finalize() called asynchronously
        } else {
            // FIX: Same pattern for contacts.
            waitForElement('textarea[name="can_contact"]').then(function(ta) {
                var cpEl = ta ? findAncestor(ta, '.cp') : null;
                mainContent.appendChild(buildContactsSection(cpEl));
                finalize();
            });
            return;
        }

        function finalize() {
            messengerContainer.appendChild(navContainer);
            messengerContainer.appendChild(mainContent);

            if (carousel) {
                carousel.insertAdjacentElement('afterend', messengerContainer);
            } else {
                wrapper.appendChild(messengerContainer);
            }

            console.log('[MessengerModule] Built successfully for section: ' + currentSection);
        }
    }

    // Walk up the DOM to find the nearest ancestor matching a CSS selector.
    function findAncestor(el, selector) {
        while (el && el !== document.body) {
            if (el.matches && el.matches(selector)) return el;
            el = el.parentElement;
        }
        return null;
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

    return {
        initialize: initialize,
        reset: reset
    };
})(typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
   typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus);
