/* ============================================================
   EditorModule – Modern editor for forum post / reply / fast-edit
   ============================================================ */
'use strict';

var EditorModule = (function (Utils, EventBus) {
    'use strict';

    var isInitialized = false;
    var _boundHandlers = [];
    var _dropdownBackdrop = null;
    var _currentUserCache = null;
    var _activeFastEdits = new Map();
    var _observerIds = [];
    var _mentionSearchAbort = null;
    var _quoteQueue = Promise.resolve();

    var CONFIG = {
        OG_FETCH_TIMEOUT: 8000,
        UPLOAD_WORKER_URL: 'https://imgbb-upload-proxy.nhristakiev.workers.dev/',
        OG_WORKER_URL: 'https://og-worker.nhristakiev.workers.dev/?url=',
        TWEMOJI_BASE: 'https://twemoji.maxcdn.com/v/latest/svg/',
        MAX_UPLOAD_BYTES: 32 * 1024 * 1024,
        IMAGE_URL_EXTENSIONS: /\.(?:jpe?g|png|gif|webp|svg|bmp|avif|ico)(?:[?#]|$)/i,
        IMAGE_URL_HOSTS: [
            'i.imgur.com', 'i.ibb.co', 'i.postimg.cc',
            'cdn.discordapp.com', 'media.discordapp.net',
            'pbs.twimg.com', 'i.redd.it', 'lh3.googleusercontent.com'
        ],
        MAX_MESSAGE_LENGTH: 0,
        LIVE_PREVIEW_DEBOUNCE_MS: 800
    };

    var MAX_MESSAGE_LENGTH   = CONFIG.MAX_MESSAGE_LENGTH;
    var OG_FETCH_TIMEOUT     = CONFIG.OG_FETCH_TIMEOUT;
    var UPLOAD_WORKER_URL    = CONFIG.UPLOAD_WORKER_URL;
    var OG_WORKER_URL        = CONFIG.OG_WORKER_URL;
    var TWEMOJI_BASE         = CONFIG.TWEMOJI_BASE;
    var MAX_UPLOAD_BYTES     = CONFIG.MAX_UPLOAD_BYTES;
    var IMAGE_URL_EXTENSIONS = CONFIG.IMAGE_URL_EXTENSIONS;
    var IMAGE_URL_HOSTS      = CONFIG.IMAGE_URL_HOSTS;

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

    function decodeTextNodesInPlace(node) {
        if (!node) return;
        if (node.nodeType === 3) {
            node.nodeValue = decodeHtmlEntities(node.nodeValue || '');
            return;
        }
        if (node.nodeType === 1) {
            Array.from(node.childNodes).forEach(decodeTextNodesInPlace);
        }
    }

    function addGlobalListener(el, type, handler, opts) {
        el.addEventListener(type, handler, opts);
        _boundHandlers.push({ el: el, type: type, handler: handler, opts: opts });
    }

    function fetchWithTimeout(url, opts, timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
        var merged = Object.assign({}, opts || {}, { signal: controller.signal });
        return fetch(url, merged).finally(function () { clearTimeout(timer); });
    }

    var _W1252_REVERSE = {
        0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
        0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
        0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
        0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
        0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
        0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
        0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
    };

    function normalizeCharsetLabel(cs) {
        if (!cs) return null;
        cs = String(cs).trim().replace(/^["']|["']$/g, '').toLowerCase();
        if (cs === 'iso-8859-1' || cs === 'iso8859-1' ||
            cs === 'latin1' || cs === 'latin-1' || cs === 'us-ascii' || cs === 'ascii') {
            return 'windows-1252';
        }
        if (cs === 'utf8' || cs === 'utf-8' || cs === 'unicode-1-1-utf-8') {
            return 'utf-8';
        }
        return cs;
    }

    async function fetchHtmlDecoded(url, opts) {
        var resp = await fetch(url, opts);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var buf = await resp.arrayBuffer();
        return decodeHtmlBuffer(buf, resp.headers.get('content-type') || '');
    }

    function decodeHtmlBuffer(arrayBuffer, contentType) {
        var bytes = new Uint8Array(arrayBuffer);

        if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
            return { text: new TextDecoder('utf-8').decode(arrayBuffer.slice(3)), charset: 'utf-8' };
        }
        if (bytes.length >= 2) {
            if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
                return { text: new TextDecoder('utf-16le').decode(arrayBuffer.slice(2)), charset: 'utf-16le' };
            }
            if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
                return { text: new TextDecoder('utf-16be').decode(arrayBuffer.slice(2)), charset: 'utf-16be' };
            }
        }

        var peek = new TextDecoder('windows-1252').decode(bytes.slice(0, 2048));
        var metaMatch =
            peek.match(/<meta[^>]+charset\s*=\s*["']?\s*([^"'\s>\/]+)/i) ||
            peek.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^"'\s;]+)/i) ||
            peek.match(/<\?xml[^>]+encoding\s*=\s*["']([^"']+)["']/i);
        var metaCharset = normalizeCharsetLabel(metaMatch && metaMatch[1]);

        var headerMatch = contentType.match(/charset\s*=\s*["']?\s*([^;"'\s]+)/i);
        var headerCharset = normalizeCharsetLabel(headerMatch && headerMatch[1]);

        var chosen = headerCharset || metaCharset;

        if (chosen) {
            try {
                return { text: new TextDecoder(chosen).decode(arrayBuffer), charset: chosen };
            } catch (e) {}
        }

        try {
            var utf8Strict = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
            return { text: utf8Strict, charset: 'utf-8' };
        } catch (e) {}

        return { text: new TextDecoder('windows-1252').decode(arrayBuffer), charset: 'windows-1252' };
    }

    function buildFormBody(pairs, charset) {
        var isUtf8 = normalizeCharsetLabel(charset) === 'utf-8';
        var encoder = isUtf8 ? null : (function () {
            return function (str) {
                var out = [];
                for (var i = 0; i < str.length; i++) {
                    var cp = str.charCodeAt(i);
                    if (cp < 0x80 || (cp >= 0xA0 && cp <= 0xFF)) {
                        out.push(cp);
                    } else if (_W1252_REVERSE[cp] !== undefined) {
                        out.push(_W1252_REVERSE[cp]);
                    } else {
                        out.push(0x3F);
                    }
                }
                return new Uint8Array(out);
            };
        })();

        var percentEncode = function (bytes) {
            var s = '';
            for (var i = 0; i < bytes.length; i++) {
                var b = bytes[i];
                if (b === 0x20) { s += '+'; }
                else if (
                    (b >= 0x41 && b <= 0x5A) ||
                    (b >= 0x61 && b <= 0x7A) ||
                    (b >= 0x30 && b <= 0x39) ||
                    b === 0x2D || b === 0x2E || b === 0x5F || b === 0x7E || b === 0x2A
                ) { s += String.fromCharCode(b); }
                else { s += '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase(); }
            }
            return s;
        };

        var encodePart = function (str) {
            if (isUtf8) {
                return encodeURIComponent(str).replace(/%20/g, '+');
            }
            return percentEncode(encoder(str));
        };

        var parts = [];
        for (var i = 0; i < pairs.length; i++) {
            parts.push(encodePart(String(pairs[i][0])) + '=' + encodePart(String(pairs[i][1])));
        }
        return parts.join('&');
    }

    function isImageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (IMAGE_URL_EXTENSIONS.test(url)) return true;
        try {
            var host = new URL(url).hostname.toLowerCase();
            for (var i = 0; i < IMAGE_URL_HOSTS.length; i++) {
                var known = IMAGE_URL_HOSTS[i];
                if (host === known || host.endsWith('.' + known)) return true;
            }
        } catch (e) {}
        return false;
    }

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
        if (/<hr\b/i.test(html)) return false;
        if (/<(video|audio|iframe)\b/i.test(html)) return false;
        return true;
    }

    function ensureTrailingParagraphInHtml(html) {
        if (!html || typeof html !== 'string') return html;
        var d = document.createElement('div');
        d.innerHTML = html;
        var last = d.lastElementChild;
        if (!last) return html;
        if (last.tagName === 'P') return html;
        d.appendChild(document.createElement('p'));
        return d.innerHTML;
    }

    function parseTimeString(t) {
        if (t == null) return null;
        var s = String(t).trim().toLowerCase();
        if (!s) return null;
        if (/^\d+$/.test(s)) {
            var n = parseInt(s, 10);
            return n > 0 ? n : null;
        }
        var m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
        if (!m || (!m[1] && !m[2] && !m[3])) return null;
        return (parseInt(m[1] || '0', 10) * 3600) +
               (parseInt(m[2] || '0', 10) * 60) +
               parseInt(m[3] || '0', 10);
    }

    function formatBytes(bytes) {
        if (!bytes || bytes < 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB'];
        var i = 0;
        var n = bytes;
        while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
        return n.toFixed(n >= 10 || i === 0 ? 0 : 2) + ' ' + units[i];
    }

    function getInitialFromName(name) {
        if (!name || typeof name !== 'string') return '?';
        var match = name.match(/[\p{L}\p{N}]/u);
        if (!match) return '?';
        return match[0].toUpperCase();
    }

    function parseYouTubeUrl(url) {
        if (!url || typeof url !== 'string') return null;
        var m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
        if (!m) return null;
        var videoid = m[1];
        var start = null;
        var end = null;
        var qIndex = url.indexOf('?');
        if (qIndex >= 0) {
            var hashIndex = url.indexOf('#', qIndex);
            var queryStr = url.slice(qIndex + 1, hashIndex >= 0 ? hashIndex : undefined);
            try {
                var params = new URLSearchParams(queryStr);
                var t = params.get('t') || params.get('start');
                if (t) {
                    var parsed = parseTimeString(t);
                    if (parsed != null) start = parsed;
                }
                var e = params.get('end');
                if (e) {
                    var parsedEnd = parseInt(e, 10);
                    if (!isNaN(parsedEnd) && parsedEnd > 0) end = parsedEnd;
                }
            } catch (err) {}
        }
        return { videoid: videoid, start: start, end: end };
    }

    function parseVimeoUrl(url) {
        if (!url || typeof url !== 'string') return null;
        var m = url.match(/vimeo\.com\/(?:[^\/\s]+\/)*?(\d+)/);
        if (!m) return null;
        var videoid = m[1];
        var start = null;
        try {
            var hashIndex = url.indexOf('#');
            if (hashIndex >= 0) {
                var frag = url.slice(hashIndex + 1);
                var fragMatch = frag.match(/^t=(.+)$/);
                if (fragMatch) {
                    var parsed = parseTimeString(fragMatch[1]);
                    if (parsed != null) start = parsed;
                }
            }
            if (start == null) {
                var qIndex = url.indexOf('?');
                if (qIndex >= 0) {
                    var hashIndex2 = url.indexOf('#', qIndex);
                    var queryStr = url.slice(qIndex + 1, hashIndex2 >= 0 ? hashIndex2 : undefined);
                    var params = new URLSearchParams(queryStr);
                    var t = params.get('t');
                    if (t) {
                        var parsed2 = parseTimeString(t);
                        if (parsed2 != null) start = parsed2;
                    }
                }
            }
        } catch (err) {}
        return { videoid: videoid, start: start };
    }

    function parseLegacyIframeProvider(src) {
        if (!src) return null;

        let m = src.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
        if (m) {
            const result = { kind: 'youtube', videoid: m[1], start: null, end: null };
            try {
                const qIndex = src.indexOf('?');
                if (qIndex >= 0) {
                    const hashIndex = src.indexOf('#', qIndex);
                    const queryStr = src.slice(qIndex + 1, hashIndex >= 0 ? hashIndex : undefined);
                    const params = new URLSearchParams(queryStr);
                    const start = params.get('start');
                    const end   = params.get('end');
                    if (start) {
                        const parsed = parseTimeString(start);
                        if (parsed != null) result.start = parsed;
                    }
                    if (end) {
                        const parsed = parseInt(end, 10);
                        if (!isNaN(parsed) && parsed > 0) result.end = parsed;
                    }
                }
            } catch (e) {}
            return result;
        }

        m = src.match(/player\.vimeo\.com\/video\/(\d+)/);
        if (m) {
            const result = { kind: 'vimeo', videoid: m[1], start: null };
            try {
                const hashIndex = src.indexOf('#');
                if (hashIndex >= 0) {
                    const frag = src.slice(hashIndex + 1);
                    const fragMatch = frag.match(/^t=(.+)$/);
                    if (fragMatch) {
                        const parsed = parseTimeString(fragMatch[1]);
                        if (parsed != null) result.start = parsed;
                    }
                }
            } catch (e) {}
            return result;
        }

        return null;
    }

    function transformLegacyIframes(htmlContent) {
        if (!htmlContent || typeof htmlContent !== 'string') return htmlContent;
        if (htmlContent.indexOf('<iframe') === -1) return htmlContent;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;

        const iframes = tempDiv.querySelectorAll('iframe[src]');
        iframes.forEach(iframe => {
            const src = iframe.getAttribute('src') || '';
            const parsed = parseLegacyIframeProvider(src);
            if (!parsed) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'lite-embed-wrapper';
            wrapper.setAttribute('data-videoid', parsed.videoid);
            if (parsed.start != null) wrapper.setAttribute('data-start', String(parsed.start));
            if (parsed.end   != null) wrapper.setAttribute('data-end',   String(parsed.end));

            const lite = document.createElement(
                parsed.kind === 'youtube' ? 'lite-youtube' : 'lite-vimeo'
            );
            lite.setAttribute('videoid', parsed.videoid);
            if (parsed.start != null) lite.setAttribute('start', String(parsed.start));
            if (parsed.end   != null) lite.setAttribute('end',   String(parsed.end));
            wrapper.appendChild(lite);

            const parent = iframe.parentNode;
            const target = (
                parent && parent.tagName === 'DIV' &&
                parent.getAttribute('align') === 'center' &&
                parent.children.length === 1
            ) ? parent : iframe;

            target.parentNode.replaceChild(wrapper, target);
        });

        return tempDiv.innerHTML;
    }

    function isYouTubeHostname(url) {
        try {
            var h = new URL(url).hostname.toLowerCase();
            return h === 'youtube.com' || h === 'www.youtube.com' ||
                   h === 'm.youtube.com' || h === 'youtu.be';
        } catch (e) { return false; }
    }

    function isVimeoHostname(url) {
        try {
            var h = new URL(url).hostname.toLowerCase();
            return h === 'vimeo.com' || h === 'www.vimeo.com';
        } catch (e) { return false; }
    }

    function transformBareVideoUrls(html) {
        if (!html || typeof html !== 'string') return html;
        if (html.indexOf('http') === -1) return html;

        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        var paragraphs = tempDiv.querySelectorAll('p');
        paragraphs.forEach(function (p) {
            var text = (p.textContent || '').trim();
            if (!/^https?:\/\/\S+$/.test(text)) return;

            if (isYouTubeHostname(text)) {
                var yt = parseYouTubeUrl(text);
                if (!yt || !yt.videoid) return;

                var wrapper = document.createElement('div');
                wrapper.className = 'lite-embed-wrapper';
                wrapper.setAttribute('data-videoid', yt.videoid);
                if (yt.start != null) wrapper.setAttribute('data-start', String(yt.start));
                if (yt.end   != null) wrapper.setAttribute('data-end',   String(yt.end));

                var lite = document.createElement('lite-youtube');
                lite.setAttribute('videoid', yt.videoid);
                if (yt.start != null) lite.setAttribute('start', String(yt.start));
                if (yt.end   != null) lite.setAttribute('end',   String(yt.end));
                wrapper.appendChild(lite);

                p.parentNode.replaceChild(wrapper, p);
                return;
            }

            if (isVimeoHostname(text)) {
                var vm = parseVimeoUrl(text);
                if (!vm || !vm.videoid) return;

                var wrapper2 = document.createElement('div');
                wrapper2.className = 'lite-embed-wrapper';
                wrapper2.setAttribute('data-videoid', vm.videoid);
                if (vm.start != null) wrapper2.setAttribute('data-start', String(vm.start));

                var lite2 = document.createElement('lite-vimeo');
                lite2.setAttribute('videoid', vm.videoid);
                if (vm.start != null) lite2.setAttribute('start', String(vm.start));
                wrapper2.appendChild(lite2);

                p.parentNode.replaceChild(wrapper2, p);
            }
        });

        return tempDiv.innerHTML;
    }

   function convertEmojisForEditor(html) {
    if (!html || typeof html !== 'string') return html;
    if (html.indexOf('<img') === -1 && html.search(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/u) === -1) {
        return html;
    }

    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // 1. Forumfree emoticon URLs → twemoji URLs. Reads the map exposed
    //    by twemoji.js at module load; skips silently if that module
    //    hasn't loaded yet (it'd be rare — both are in the same boot
    //    phase — but the guard keeps the editor functional).
    if (window.FF_EMOJI_MAP && typeof window.FF_EMOJI_MAP.get === 'function') {
        tempDiv.querySelectorAll('img').forEach(function (img) {
            var src = img.getAttribute('src') || '';
            var filename = window.FF_EMOJI_MAP.get(src);
            if (!filename) return;
            img.setAttribute('src', TWEMOJI_BASE + filename);
            if (!img.classList.contains('twemoji')) img.classList.add('twemoji');
        });
    }

    // 2. Existing twemoji imgs from previous saves — normalise size.
    //    These already have correct srcs; they just lack dimensions if
    //    they came from the reader side (where twemoji.parse runs
    //    without width/height). Setting the attributes here means
    //    CustomImage's parseHTML reads a definite size and the CSS
    //    fix has a defined baseline.
    tempDiv.querySelectorAll('img[src*="twemoji"]').forEach(function (img) {
        if (!img.getAttribute('width')) img.setAttribute('width', '24');
        if (!img.getAttribute('height')) img.setAttribute('height', '24');
        if (!img.classList.contains('twemoji')) img.classList.add('twemoji');
    });

    // 3. Unicode emojis → twemoji imgs. twemoji.parse skips code, pre,
    //    script, style, textarea and similar — so [code]😀[/code]
    //    survives untouched, which is what we want (an <img> inside a
    //    code block would break the CodeBlock node).
    if (window.twemoji && typeof window.twemoji.parse === 'function') {
        try {
            window.twemoji.parse(tempDiv, {
                base: 'https://twemoji.maxcdn.com/v/latest/',
                folder: 'svg',
                ext: '.svg',
                className: 'twemoji'
            });
            // twemoji.parse produces imgs without width/height.
            tempDiv.querySelectorAll('img.twemoji').forEach(function (img) {
                if (!img.getAttribute('width')) img.setAttribute('width', '24');
                if (!img.getAttribute('height')) img.setAttribute('height', '24');
            });
        } catch (e) {
            console.warn('[EditorModule] twemoji.parse failed:', e);
        }
    }

    return tempDiv.innerHTML;
}

   function buildLinkPreviewSpan(url, title, description, imageSrc) {
    if (!url) return null;
    var span = document.createElement('span');
    span.setAttribute('data-type', 'link-preview');
    span.setAttribute('data-href', url);
    if (title) span.setAttribute('data-title', title);
    if (description) span.setAttribute('data-description', description);
    if (imageSrc) span.setAttribute('data-image-src', imageSrc);
    return span;
}

function parseEmbedContainerForEditor(container) {
    // .ffb_embedlink format: children[0] = hidden favicon div,
    // children[1] = visible part with [previewDiv, contentDiv]
    try {
        var visiblePart = container.children[1];
        if (!visiblePart) return null;
        var previewDiv = visiblePart.children[0];
        var contentDiv = visiblePart.children[1] || visiblePart.children[0];
        if (!contentDiv) return null;

        var imageSrc = '';
        if (previewDiv) {
            var previewImg = previewDiv.querySelector('img');
            if (previewImg) imageSrc = previewImg.getAttribute('src') || '';
        }

        var titleLink = contentDiv.querySelector('a');
        var title = titleLink ? titleLink.textContent.trim() : '';
        var url = titleLink ? titleLink.getAttribute('href') : '';
        if (!url) return null;

        var clone = contentDiv.cloneNode(true);
        clone.querySelectorAll('a').forEach(function (a) { a.remove(); });
        var description = clone.textContent.trim()
            .replace(/\s*Leggi altro su\s*/gi, '')
            .replace(/\s*[>›]\s*$/, '')
            .trim();

        return buildLinkPreviewSpan(url, title, description, imageSrc);
    } catch (e) {
        return null;
    }
}

function transformLegacyEmbedLinks(html) {
    if (!html || typeof html !== 'string') return html;
    if (html.indexOf('ffb_embedlink') === -1 &&
        !/Leggi altro su|Read more on|Continua a leggere/i.test(html)) return html;

    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // --- Strategy 1: .ffb_embedlink containers (posts.js format) ---
    tempDiv.querySelectorAll('.ffb_embedlink').forEach(function (container) {
        var span = parseEmbedContainerForEditor(container);
        if (span) container.parentNode.replaceChild(span, container);
    });

    // --- Strategy 2: flat 3-paragraph form (what your DOM shows) ---
    tempDiv.querySelectorAll('a.ffb_embedlink_preview').forEach(function (previewAnchor) {
        if (previewAnchor.closest('[data-type="link-preview"]')) return;

        var url = previewAnchor.getAttribute('href') || '';
        if (!url) return;

        var previewImg = previewAnchor.querySelector('img');
        var imageSrc = previewImg ? (previewImg.getAttribute('src') || '') : '';

        var imagePara = previewAnchor.closest('p');
        if (!imagePara) return;

        var faviconPara = imagePara.previousElementSibling;
        var infoPara = imagePara.nextElementSibling;

        // favicon paragraph: <p> with an <img> and an <a> (the domain)
        var faviconValid = false;
        if (faviconPara && faviconPara.tagName === 'P' &&
            faviconPara.querySelector('img') && faviconPara.querySelector('a')) {
            faviconValid = true;
        }

        // info paragraph: <p> with title <a>, description, and "Leggi altro su"
        var infoValid = false;
        var title = '';
        var description = '';
        if (infoPara && infoPara.tagName === 'P') {
            var infoText = infoPara.textContent || '';
            var hasReadMore = /Leggi altro su|Read more on|Continua a leggere/i.test(infoText);
            var endsWithArrow = /[>›]\s*$/.test(infoText.trim());

            if (hasReadMore || endsWithArrow) {
                infoValid = true;
                var infoLinks = infoPara.querySelectorAll('a');
                if (infoLinks.length >= 1) title = infoLinks[0].textContent.trim();

                description = infoText;
                if (title) description = description.replace(title, '');
                description = description
                    .replace(/\s*Leggi altro su\s+[\w.]+\s*[>›]?\s*$/i, '')
                    .replace(/\s*Read more on\s+[\w.]+\s*[>›]?\s*$/i, '')
                    .replace(/\s*Continua a leggere\s+[\w.]+\s*[>›]?\s*$/i, '')
                    .trim();
            }
        }

        if (!title) title = previewAnchor.getAttribute('title') || '';

        var span = buildLinkPreviewSpan(url, title, description, imageSrc);
        if (!span) return;

        var insertBefore = faviconValid ? faviconPara : imagePara;
        insertBefore.parentNode.insertBefore(span, insertBefore);
        if (faviconValid) faviconPara.remove();
        imagePara.remove();
        if (infoValid) infoPara.remove();
    });

    return tempDiv.innerHTML;
}

    function searchMentions(query) {
        if (!query || query.length < 1) return Promise.resolve([]);
        if (_mentionSearchAbort) {
            try { _mentionSearchAbort.abort(); } catch (e) {}
        }
        _mentionSearchAbort = new AbortController();
        var url = '/api.php?search&name=' + encodeURIComponent(query) + '&n=10&cookie=1';
        return fetch(url, {
            credentials: 'include',
            signal: _mentionSearchAbort.signal
        })
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(function (data) {
            var users = (data && Array.isArray(data.users)) ? data.users : [];
            return users.slice(0, 8).map(function (u) {
                if (u && typeof u.name === 'string') {
                    u = Object.assign({}, u, { name: decodeHtmlEntities(u.name) });
                }
                return u;
            });
        })
        .catch(function (err) {
            if (err && err.name === 'AbortError') return [];
            console.warn('[EditorModule] Search failed:', err);
            return [];
        });
    }

    var AVATAR_COLORS = [
        '059669', '10B981', '34D399', '6EE7B7', 'A7F3D0',
        '0D9488', '14B8A6', '2DD4BF', '5EEAD4', '99F6E4',
        '3B82F6', '60A5FA', '93C5FD', '2563EB', '1D4ED8',
        '6366F1', '818CF8', 'A5B4FC', '4F46E5', '4338CA',
        '8B5CF6', 'A78BFA', 'C4B5FD', '7C3AED', '6D28D9',
        'D97706', 'F59E0B', 'FBBF24', 'FCD34D', 'B45309',
        '64748B', '94A3B8', 'CBD5E1', '475569', '334155'
    ];

    function getColorFromNickname(nickname, userId) {
        var hash = 0;
        var str = nickname || userId || 'user';
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    }

    function optimizeAvatarUrl(url, width, height) {
        if (!url || typeof url !== 'string') return null;
        var trimmed = url.trim();
        if (!/^(https?:)?\/\//i.test(trimmed)) return null;
        if (trimmed === 'http' || trimmed === 'https' || trimmed === '//') return null;
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

    function sanitizeGroupName(name) {
        if (!name) return 'member';
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'member';
    }

    function getGroupClass(user) {
        if (!user || !user.group) return 'group-member';
        var groupName  = (user.group.name || '').toLowerCase();
        var groupClass = (user.group.class || '').toLowerCase();
        var groupBody  = (user.group.bodyclass || '').toLowerCase();
        var groupId    = user.group.id;

        if (groupClass.indexOf('founder') !== -1 || groupBody.indexOf('founder') !== -1 || groupName === 'founder') {
            return 'group-founder';
        }
        if (groupName === 'administrator' || groupClass.indexOf('admin') !== -1 || groupId === 1) {
            return 'group-administrator';
        }
        if (groupName === 'global moderator' || groupClass.indexOf('global_mod') !== -1) {
            return 'group-global-moderator';
        }
        if (groupName === 'moderator' || groupClass.indexOf('mod') !== -1) {
            return 'group-moderator';
        }
        if (groupName === 'developer' || groupClass.indexOf('developer') !== -1) {
            return 'group-developer';
        }
        if (groupName === 'game dev' || groupClass.indexOf('game_dev') !== -1) {
            return 'group-game-dev';
        }
        if (groupName === 'fan') return 'group-fan';
        return 'group-' + sanitizeGroupName(user.group.name || 'member');
    }

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
        var username = null;
        var avatarUrl = null;
        var menu = document.querySelector('.menuwrap');
        if (menu) {
            var nick = menu.querySelector('.nick');
            if (nick) username = decodeHtmlEntities(nick.textContent.trim());
            var img = menu.querySelector('.avatar img');
            if (img && img.src) avatarUrl = img.src;
        }
        return { mid: mid, nickname: username || null, avatar: avatarUrl || null };
    }

    function fetchCurrentUserData() {
        if (_currentUserCache) return Promise.resolve(_currentUserCache);
        var mid = getCurrentUserId();
        if (!mid) return Promise.resolve(null);
        return fetch('/api.php?mid=' + mid)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                var user = data && (data['m' + mid] || data.info);
                if (user) {
                    user.mid = mid;
                    if (typeof user.nickname === 'string') user.nickname = decodeHtmlEntities(user.nickname);
                    if (typeof user.name === 'string') user.name = decodeHtmlEntities(user.name);
                    _currentUserCache = user;
                }
                return user || null;
            })
            .catch(function () { return null; });
    }

    function buildUserHeader(user, label) {
        if (!user) return null;
        var username = decodeHtmlEntities(user.nickname) || 'You';
        var mid = user.mid;
        var profileUrl = '/?act=Profile&MID=' + mid;
        var avatarUrl = optimizeAvatarUrl(user.avatar, 36, 36);
        var groupClass = getGroupClass(user);

        var header = document.createElement('div');
        header.className = 'modern-replying-as ' + groupClass;

        var avatarHtml;
        if (avatarUrl) {
            avatarHtml = '<img class="modern-replying-avatar" src="' + escapeHtml(avatarUrl) +
                '" alt="" width="36" height="36" loading="lazy" decoding="async">';
        } else {
            avatarHtml = '<span class="modern-replying-avatar modern-replying-avatar--initial" ' +
                'style="background-color:#' + getColorFromNickname(username, mid) + ';">' +
                escapeHtml(getInitialFromName(username)) + '</span>';
        }

        header.innerHTML =
            '<span class="modern-replying-label">' + escapeHtml(label || 'Replying as:') + '</span>' +
            '<a href="' + escapeHtml(profileUrl) + '" class="modern-replying-user" rel="nofollow">' +
                avatarHtml +
                '<span class="modern-replying-name">' + escapeHtml(username) + '</span>' +
            '</a>';
        return header;
    }

    function attachProfileTip(header, user) {
        if (!header || !user) return;
        var tryAttach = function () {
            if (!window.ForumPostsModule ||
                typeof window.ForumPostsModule.attachProfileTip !== 'function') {
                return false;
            }
            var username = decodeHtmlEntities(user.nickname) || 'You';
            var data = {
                mid: user.mid,
                username: username,
                apiUser: user,
                groupText: (user.group && user.group.name) || 'Member',
                postCount: user.messages != null ? user.messages : 0,
                reputation: user.reputation != null ? user.reputation : 0,
                isOnline: user.status === 'online'
            };
            var userLink = header.querySelector('.modern-replying-user');
            if (userLink) window.ForumPostsModule.attachProfileTip(userLink, data);
            return true;
        };
        if (tryAttach()) return;
        setTimeout(tryAttach, 200);
    }

    function paragraphizeLegacyHtml(html) {
        if (!html || typeof html !== 'string') return html;
        try {
            const BLOCK_TAGS = new Set([
                'H1','H2','H3','H4','H5','H6','DIV','P','UL','OL','LI',
                'BLOCKQUOTE','PRE','TABLE','HR','SECTION','ARTICLE','FIGURE',
                'HEADER','FOOTER','ASIDE','NAV','DL','DT','DD','FORM'
            ]);

            const container = document.createElement('div');
            container.innerHTML = html;
            const newChildren = [];
            let inlineBuffer = [];
            let pendingBreaks = 0;

            function hasVisibleContent(nodes) {
                return nodes.some(n => {
                    if (n.nodeType === 3) return n.nodeValue.trim().length > 0;
                    if (n.nodeType === 1) return n.tagName !== 'BR';
                    return false;
                });
            }

            function flushBuffer() {
                while (inlineBuffer.length > 0 && inlineBuffer[0].nodeType === 1 && inlineBuffer[0].tagName === 'BR') {
                    inlineBuffer.shift();
                }
                while (inlineBuffer.length > 0 && inlineBuffer[inlineBuffer.length - 1].nodeType === 1 && inlineBuffer[inlineBuffer.length - 1].tagName === 'BR') {
                    inlineBuffer.pop();
                }
                if (!hasVisibleContent(inlineBuffer)) {
                    inlineBuffer = [];
                    return;
                }
                const p = document.createElement('p');
                inlineBuffer.forEach(n => p.appendChild(n));
                newChildren.push(p);
                inlineBuffer = [];
            }

            Array.from(container.childNodes).forEach(child => {
                if (child.nodeType === 1 && child.tagName === 'BR') {
                    pendingBreaks++;
                    if (pendingBreaks >= 2) {
                        flushBuffer();
                        pendingBreaks = 0;
                    }
                    return;
                }

                if (child.nodeType === 3 && !child.nodeValue.trim() && pendingBreaks > 0) {
                    return;
                }

                if (pendingBreaks === 1) {
                    inlineBuffer.push(document.createElement('br'));
                }
                pendingBreaks = 0;

                if (child.nodeType === 1 && BLOCK_TAGS.has(child.tagName)) {
                    flushBuffer();
                    newChildren.push(child);
                    return;
                }

                inlineBuffer.push(child);
            });

            if (pendingBreaks === 1) {
                inlineBuffer.push(document.createElement('br'));
            }

            flushBuffer();

            container.innerHTML = '';
            newChildren.forEach(n => container.appendChild(n));

            Array.from(container.querySelectorAll('blockquote, .quote-content, .spoiler-content-inner')).forEach(el => {
                el.innerHTML = paragraphizeLegacyHtml(el.innerHTML);
            });

            return container.innerHTML;
        } catch (e) {
            console.warn('[EditorModule] paragraphizeLegacyHtml failed:', e);
            return html;
        }
    }

    function legacyToHtml(legacy) {
        if (!legacy) return '';
        var html = legacy;

        html = html.replace(
            /<span[^>]*\bff-spoiler-title\b[^>]*>([\s\S]*?)<\/span>\s*(?:<br\s*\/?>)*\s*\[spoiler\]([\s\S]*?)\[\/spoiler\]/gis,
            function (_, title, body) {
                var decoded = decodeHtmlEntities(title.replace(/<[^>]*>/g, '')).trim();
                return '<div class="spoiler" data-title="' + escapeHtml(decoded) + '">' + body + '</div>';
            }
        );

        html = html.replace(
            /<span[^>]*\bff-code-lang\b[^>]*>([\s\S]*?)<\/span>\s*(?:<br\s*\/?>)*\s*\[code\]([\s\S]*?)\[\/code\]/gis,
            function (_, lang, body) {
                var decoded = decodeHtmlEntities(lang.replace(/<[^>]*>/g, '')).trim();
                return '<pre data-language="' + escapeHtml(decoded) + '"><code>' + body + '</code></pre>';
            }
        );

        html = html.replace(
            /<span\b[^>]*\bff-lite-youtube\b[^>]*>([\s\S]*?)<\/span>/gis,
            function (match) {
                var idMatch = match.match(/data-videoid="([^"]*)"/);
                var videoid = idMatch ? decodeHtmlEntities(idMatch[1]) : '';
                if (!videoid) return '';
                var t = match.match(/data-title="([^"]*)"/);
                var a = match.match(/data-author="([^"]*)"/);
                var s = match.match(/data-start="([^"]*)"/);
                var e = match.match(/data-end="([^"]*)"/);
                var attrs = 'videoid="' + escapeHtml(videoid) + '"';
                if (t) attrs += ' data-title="' + escapeHtml(decodeHtmlEntities(t[1])) + '"';
                if (a) attrs += ' data-author="' + escapeHtml(decodeHtmlEntities(a[1])) + '"';
                if (s) attrs += ' start="' + escapeHtml(s[1]) + '"';
                if (e) attrs += ' end="' + escapeHtml(e[1]) + '"';
                return '<lite-youtube ' + attrs + '></lite-youtube>';
            }
        );
        html = html.replace(
            /<span\b[^>]*\bff-lite-vimeo\b[^>]*>([\s\S]*?)<\/span>/gis,
            function (match) {
                var idMatch = match.match(/data-videoid="([^"]*)"/);
                var videoid = idMatch ? decodeHtmlEntities(idMatch[1]) : '';
                if (!videoid) return '';
                var t = match.match(/data-title="([^"]*)"/);
                var a = match.match(/data-author="([^"]*)"/);
                var s = match.match(/data-start="([^"]*)"/);
                var attrs = 'videoid="' + escapeHtml(videoid) + '"';
                if (t) attrs += ' data-title="' + escapeHtml(decodeHtmlEntities(t[1])) + '"';
                if (a) attrs += ' data-author="' + escapeHtml(decodeHtmlEntities(a[1])) + '"';
                if (s) attrs += ' start="' + escapeHtml(s[1]) + '"';
                return '<lite-vimeo ' + attrs + '></lite-vimeo>';
            }
        );

        html = html.replace(/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>');
        html = html.replace(/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>');
        html = html.replace(/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>');
        html = html.replace(/\[s\](.*?)\[\/s\]/gi, '<s>$1</s>');
        html = html.replace(/\[list\](.*?)\[\/list\]/gis, '<ul>$1</ul>');
        html = html.replace(/\[\*\](.*?)(?=\n|$)/gi, '<li>$1</li>');
        html = html.replace(/\[list=1\](.*?)\[\/list\]/gis, '<ol>$1</ol>');
        html = html.replace(/\[url=([^\]]+)\](.*?)\[\/url\]/gi, '<a href="$1" target="_blank">$2</a>');
        html = html.replace(/\[img\](.*?)\[\/img\]/gi, '<img src="$1" alt="image" loading="lazy" decoding="async">');

        // -----------------------------------------------------------------
        // [QUOTE=...] parser
        //
        // Legacy format: [QUOTE=Author,Date, Time URL]
        //
        //   - Author, Date, and the whole "Time URL" tail are comma-separated.
        //   - The tail after the second comma can contain ANOTHER comma
        //     (inside the time: "11:25 PM"), so a naive split loses it.
        //   - The URL, when present, is a whitespace-delimited token at the
        //     end that starts with ?, /, #, or http(s)://.
        //
        // Strategy:
        //   1. Split on the FIRST comma (author) and SECOND comma (date).
        //   2. Everything after the second comma is one blob that may or may
        //      not contain a trailing URL.
        //   3. Look for whitespace followed by a URL-prefixed token; if
        //      found, split there. Otherwise the whole blob is the time.
        // -----------------------------------------------------------------
        html = html.replace(/\[QUOTE(?:=([^\]]+))?\]([\s\S]*?)\[\/QUOTE\]/gi, function (match, params, body) {
            var author = '';
            var timestamp = '';
            var url = '';

            if (params) {
                var parts = params.split(',');

                if (parts.length >= 1) author = parts[0].trim();

                if (parts.length >= 2) {
                    var date = parts[1].trim();
                    var tail = parts.slice(2).join(',').trim();

                    // The URL is the last whitespace-delimited token in the
                    // tail that starts with ?, /, #, or http(s)://. Splitting
                    // on whitespace is safe because the time part never
                    // contains one.
                    var urlMatch = tail.match(/^(.*?)\s+([?#\/]\S*$|https?:\/\/\S+$)/);
                    if (urlMatch) {
                        var timePart = urlMatch[1].trim();
                        timestamp = date + (timePart ? ', ' + timePart : '');
                        url = urlMatch[2].trim();
                    } else {
                        // No URL — whole tail is the time part.
                        timestamp = date + (tail ? ', ' + tail : '');
                    }

                    // The forum hands us a bare query string (?t=…&st=…#entry…).
                    // Normalize to a same-origin path so it resolves correctly
                    // from any page.
                    if (url && url.charAt(0) === '?') url = '/' + url;
                }
            }

            var attrs = '';
            if (author)    attrs += ' data-author="' + escapeHtml(author) + '"';
            if (timestamp) attrs += ' data-timestamp="' + escapeHtml(timestamp) + '"';
            if (url)       attrs += ' data-url="' + escapeHtml(url) + '"';

            return '<blockquote' + attrs + '>' + body + '</blockquote>';
        });

        html = html.replace(/\[code\](.*?)\[\/code\]/gis, '<pre><code>$1</code></pre>');
        html = html.replace(/\[spoiler\](.*?)\[\/spoiler\]/gis, '<div class="spoiler">$1</div>');
        html = html.replace(/\[CENTER\](.*?)\[\/CENTER\]/gis, '<div style="text-align:center">$1</div>');
        html = html.replace(/\[font=([^\]]+)\](.*?)\[\/font\]/gis, '$2');

        html = html.replace(/\[size=([^\]]+)\](.*?)\[\/size\]/gis, function (_, sz, content) {
            var n = parseInt(sz, 10);
            if (isNaN(n)) n = 14;
            n = Math.max(10, Math.min(30, n));
            return '<span style="font-size:' + n + 'px">' + content + '</span>';
        });

        html = html.replace(
            /<span[^>]*\bff-inline-code\b[^>]*>([\s\S]*?)<\/span>/gis,
            function (_, content) {
                var decoded = decodeHtmlEntities(content);
                return '<code>' + escapeHtml(decoded) + '</code>';
            }
        );

        html = html.replace(/\[EMAIL\](.*?)\[\/EMAIL\]/gi, '<a href="mailto:$1">$1</a>');
        return html;
    }

    async function legacyToHtmlAsync(legacy) {
        if (!legacy) return '';

        var expanded = legacy.replace(/\[IMG=([^\]]+)\]([^\[]+?)\[\/IMG\]/gi, function (_, altText, url) {
            var safeAlt = escapeHtml(altText.trim());
            return '<img src="' + url.trim() + '" alt="' + safeAlt + '" loading="lazy" decoding="async">';
        });

        if (!/<br\s*\/?>/i.test(expanded) && /\n/.test(expanded)) {
            var codeBlocks = [];
            expanded = expanded.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, function(match) {
                var id = '\uE000CODE' + codeBlocks.length + 'Z\uE001';
                codeBlocks.push(match);
                return id;
            });

            expanded = expanded.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');

            expanded = expanded.replace(/\uE000CODE(\d+)Z\uE001/g, function(m, idx) {
                return codeBlocks[parseInt(idx, 10)];
            });
        }

        var html = legacyToHtml(expanded);
        html = transformLegacyIframes(html);
        html = paragraphizeLegacyHtml(html);
        html = transformLegacyEmbedLinks(html);
        html = transformBareVideoUrls(html);
        html = convertEmojisForEditor(html);

        return await enrichImageDimensions(html);
    }

    async function enrichImageDimensions(html) {
        if (!html || html.indexOf('<img') === -1) return html;

        var temp = document.createElement('div');
        temp.innerHTML = html;

        var promises = [];

        temp.querySelectorAll('img').forEach(function (img) {
            var w = img.getAttribute('width');
            var h = img.getAttribute('height');
            if (w && h && parseInt(w, 10) > 0 && parseInt(h, 10) > 0) return;

            if (img.classList.contains('twemoji')) return;
            var alt = img.getAttribute('alt') || '';
            if (alt.startsWith(':') && alt.endsWith(':')) return;

            var src = img.getAttribute('src') || '';
            if (!src) return;
            if (src.indexOf('weserv.nl') !== -1 || src.indexOf('wsrv.nl') !== -1) return;

            if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
            if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');

            promises.push(new Promise(function (resolve) {
                var probe = new Image();
                var done = false;
                var timer = setTimeout(function () {
                    if (!done) { done = true; resolve(); }
                }, 4000);
                probe.onload = function () {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
                        img.setAttribute('width', probe.naturalWidth);
                        img.setAttribute('height', probe.naturalHeight);
                    }
                    resolve();
                };
                probe.onerror = function () {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve();
                };
                probe.src = src;
            }));
        });

        if (promises.length === 0) return temp.innerHTML;
        await Promise.all(promises);
        return temp.innerHTML;
    }

    function htmlToLegacy(html) {
        if (!html || typeof html !== 'string') return html;
        var result = html;
        for (var i = 0; i < 10; i++) {
            var before = result;

            result = result.replace(
                /<span[^>]*\bff-upload-placeholder-marker\b[^>]*>\s*<\/span>/gi, ''
            );

            result = result.replace(
                /<lite-youtube\b[^>]*\bvideoid="([^"]*)"[^>]*>\s*<\/lite-youtube>/gi,
                function (match, videoid) {
                    var s = match.match(/\bstart="([^"]*)"/);
                    var e = match.match(/\bend="([^"]*)"/);
                    var span = '<span class="ff-lite-youtube" data-videoid="' + escapeHtml(videoid) + '"';
                    if (s) span += ' data-start="' + escapeHtml(s[1]) + '"';
                    if (e) span += ' data-end="' + escapeHtml(e[1]) + '"';
                    return span + '></span>';
                }
            );
            result = result.replace(
                /<lite-vimeo\b[^>]*\bvideoid="([^"]*)"[^>]*>\s*<\/lite-vimeo>/gi,
                function (match, videoid) {
                    var s = match.match(/\bstart="([^"]*)"/);
                    var span = '<span class="ff-lite-vimeo" data-videoid="' + escapeHtml(videoid) + '"';
                    if (s) span += ' data-start="' + escapeHtml(s[1]) + '"';
                    return span + '></span>';
                }
            );

            // -----------------------------------------------------------------
            // <blockquote> → [QUOTE=...] serializer
            //
            // Inverse of the parser above. Rebuild the legacy format exactly:
            //
            //   [QUOTE=Author]                       (no date)
            //   [QUOTE=Author,Date]                  (date only)
            //   [QUOTE=Author,Date, Time]            (no URL — comma before time)
            //   [QUOTE=Author,Date, Time URL]        (URL — space before URL)
            //
            // The URL was normalized to a same-origin path (leading /) on
            // parse; strip that back off so the round-trip is byte-identical.
            // -----------------------------------------------------------------
            result = result.replace(/<blockquote([^>]*)>([\s\S]*?)<\/blockquote>/gi, function (match, attrs, inner) {
                inner = inner.replace(/<p class="quote-author-header">[\s\S]*?<\/p>/gi, '');
                var cleaned = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>\s*/gi, '\n\n').replace(/\n+$/, '');

                var authorMatch = attrs.match(/data-author="([^"]*)"/);
                var tsMatch     = attrs.match(/data-timestamp="([^"]*)"/);
                var urlMatch    = attrs.match(/data-url="([^"]*)"/);

                if (authorMatch) {
                    var author = decodeHtmlEntities(authorMatch[1]);
                    var ts     = tsMatch  ? decodeHtmlEntities(tsMatch[1])  : '';
                    var url    = urlMatch ? decodeHtmlEntities(urlMatch[1]) : '';

                    // Undo the '/' normalization applied at parse time.
                    if (url.charAt(0) === '/') url = url.slice(1);

                    var params = author;
                    if (ts)  params += ',' + ts;    // comma between author and timestamp
                    if (url) params += ' ' + url;   // space between timestamp and URL

                    return '[QUOTE=' + params + ']' + cleaned + '[/QUOTE]';
                }
                return '[QUOTE]' + cleaned + '[/QUOTE]';
            });

            result = result.replace(/<div\b([^>]*\bclass="[^"]*\bspoiler\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi, function (_, attrs, inner) {
                var cleaned = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>\s*/gi, '\n\n').replace(/\n+$/, '');
                var t = attrs.match(/data-title="([^"]*)"/);
                var title = t ? decodeHtmlEntities(t[1]).trim() : '';
                var prefix = title ? '<span class="ff-spoiler-title">' + escapeHtml(title) + '</span>' : '';
                return prefix + '[SPOILER]' + cleaned + '[/SPOILER]';
            });

            result = result.replace(/<pre([^>]*)>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, function (_, preAttrs, inner) {
                var decoded = inner.replace(/<[^>]*>/g, '')
                    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'");
                var l = preAttrs.match(/data-language="([^"]*)"/);
                var lang = l ? decodeHtmlEntities(l[1]).trim() : '';
                var prefix = lang ? '<span class="ff-code-lang">' + escapeHtml(lang) + '</span>' : '';
                return prefix + '[CODE]' + decoded + '[/CODE]';
            });

            result = result.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, function (_, inner) {
                return '<span class="ff-inline-code">' + inner + '</span>';
            });

            if (result === before) break;
        }
        return result;
    }

    function highlightCode(codeText) {
        if (codeText == null) return '';
        var html = String(codeText)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        var stash = [];
        function keep(htmlStr) {
            var key = '\uE000A' + stash.length.toString(36) + 'Z\uE001';
            stash.push(htmlStr);
            return key;
        }
        html = html.replace(/\/\*[\s\S]*?\*\//g, function (m) { return keep('<span class="code-comment">' + m + '</span>'); });
        html = html.replace(/(^|[^:\w])(\/\/[^\n]*)/g, function (m, p, c) { return p + keep('<span class="code-comment">' + c + '</span>'); });
        html = html.replace(/^(\s*)(#[^\n]*)/gm, function (m, ws, c) {
            if (/^#[0-9a-fA-F]{3,8}$/.test(c.trim())) return m;
            return ws + keep('<span class="code-comment">' + c + '</span>');
        });
        html = html.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, function (m) {
            return keep('<span class="code-string">' + m + '</span>');
        });
        html = html.replace(/\b\d+(?:\.\d+)?\b/g, '<span class="code-number">$&</span>');
        var KW = ['abstract','as','assert','async','await','bool','break','case','catch','class','const','continue','def','default','del','delete','do','elif','else','enum','except','export','extends','False','false','final','finally','float','for','from','func','function','global','goto','if','import','in','int','interface','is','lambda','let','match','module','new','None','null','not','or','pass','print','private','protected','public','raise','return','self','static','str','super','switch','this','throw','True','true','try','typeof','var','void','while','with','yield'].join('|');
        html = html.replace(new RegExp('\\b(' + KW + ')\\b', 'g'), '<span class="code-keyword">$1</span>');
        html = html.replace(/\uE000A([0-9a-z]+)Z\uE001/g, function (m, idx) { return stash[parseInt(idx, 36)]; });
        return html;
    }

    function transformPreviewHtml(html) {
        if (!html || typeof html !== 'string') return html;
        var temp = document.createElement('div');
        temp.innerHTML = html;

        Array.from(temp.querySelectorAll('blockquote')).forEach(function (bq) {
            var author = bq.getAttribute('data-author');
            var headerPara = bq.querySelector('.quote-author-header');
            if (headerPara) headerPara.remove();
            var innerHtml = bq.innerHTML;
            var quoteAuthorHtml = author
                ? '<span class="quote-author">' + escapeHtml(author) + ' <span class="quote-said">said:</span></span>'
                : '<span class="quote-author">Quote</span>';
            var modernHtml =
                '<div class="modern-quote long-quote">' +
                    '<div class="quote-header"><div class="quote-meta">' +
                        '<div class="quote-icon"><i class="fa-regular fa-quote-left" aria-hidden="true"></i></div>' +
                        '<div class="quote-info">' + quoteAuthorHtml + '</div>' +
                    '</div></div>' +
                    '<div class="quote-content">' + innerHtml + '</div>' +
                    '<button class="quote-expand-btn" type="button" aria-expanded="false" aria-label="Show full quote">' +
                        '<i class="fa-regular fa-angle-down" aria-hidden="true"></i> <span class="expand-text">Show more</span>' +
                    '</button>' +
                '</div>';
            var wrapper = document.createElement('div');
            wrapper.innerHTML = modernHtml;
            if (bq.parentNode) bq.parentNode.replaceChild(wrapper.firstElementChild, bq);
        });

        Array.from(temp.querySelectorAll('div.spoiler')).forEach(function (sp) {
            var innerHtml = sp.innerHTML;
            var title = sp.getAttribute('data-title') || 'Spoiler';
            var spoilerId = 'preview-spoiler-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
            var modernHtml =
                '<div class="modern-spoiler">' +
                    '<div class="spoiler-header" role="button" tabindex="0" aria-expanded="false">' +
                        '<div class="spoiler-icon"><i class="fa-regular fa-square-caret-down" aria-hidden="true"></i></div>' +
                        '<div class="spoiler-info"><span class="spoiler-title">' + escapeHtml(title) + '</span></div>' +
                        '<button class="spoiler-toggle" type="button" aria-expanded="false" aria-controls="' + spoilerId + '">' +
                            '<i class="fa-regular fa-angle-down" aria-hidden="true"></i>' +
                        '</button>' +
                    '</div>' +
                    '<div id="' + spoilerId + '" class="spoiler-content" aria-hidden="true">' +
                        '<div class="spoiler-content-inner">' + innerHtml + '</div>' +
                    '</div>' +
                '</div>';
            var wrapper = document.createElement('div');
            wrapper.innerHTML = modernHtml;
            if (sp.parentNode) sp.parentNode.replaceChild(wrapper.firstElementChild, sp);
        });

        Array.from(temp.querySelectorAll('pre')).forEach(function (pre) {
            if (pre.closest('.modern-code')) return;
            var code = pre.querySelector('code');
            var rawText = code ? (code.textContent || '') : (pre.textContent || '');
            var codeContent = highlightCode(rawText);
            var lang = (pre.getAttribute('data-language') || '').trim() || 'Code';
            var modernHtml =
                '<div class="modern-code">' +
                    '<div class="code-header" style="cursor: default;">' +
                        '<div class="code-icon"><i class="fa-regular fa-code" aria-hidden="true"></i></div>' +
                        '<div class="code-info"><span class="code-title">' + escapeHtml(lang) + '</span></div>' +
                        '<button class="code-copy-btn" type="button" aria-label="Copy code" tabindex="0"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>' +
                    '</div>' +
                    '<div class="code-content collapsible-content"><pre><code>' + codeContent + '</code></pre></div>' +
                    '<button class="code-expand-btn" type="button" aria-expanded="false" aria-label="Show full code">' +
                        '<i class="fa-regular fa-angle-down" aria-hidden="true"></i> <span class="expand-text">Show more</span>' +
                    '</button>' +
                '</div>';
            var wrapper = document.createElement('div');
            wrapper.innerHTML = modernHtml;
            if (pre.parentNode) pre.parentNode.replaceChild(wrapper.firstElementChild, pre);
        });

        Array.from(temp.querySelectorAll('span.ff-nsfw')).forEach(function (sp) {
            var replacement = document.createElement('span');
            replacement.className = 'nsfw-tag';
            replacement.setAttribute('role', 'button');
            replacement.setAttribute('tabindex', '0');
            replacement.setAttribute('aria-pressed', 'false');
            replacement.setAttribute('aria-label', 'Hidden content, click to reveal');
            replacement.innerHTML = sp.innerHTML;
            decodeTextNodesInPlace(replacement);
            if (sp.parentNode) sp.parentNode.replaceChild(replacement, sp);
        });

        Array.from(temp.querySelectorAll('img[data-nsfw="true"]')).forEach(function (img) {
            if (img.closest('.nsfw-image')) return;
            var wrapper = document.createElement('span');
            wrapper.className = 'nsfw-image';
            wrapper.setAttribute('role', 'button');
            wrapper.setAttribute('tabindex', '0');
            wrapper.setAttribute('aria-pressed', 'false');
            wrapper.setAttribute('aria-label', 'Hidden image, click to reveal');
            var w = img.getAttribute('width');
            var h = img.getAttribute('height');
            if (w && h) { wrapper.style.width = w + 'px'; wrapper.style.aspectRatio = w + '/' + h; wrapper.style.maxWidth = '100%'; }
            var ds = img.getAttribute('data-size');
            if (ds === 'small') wrapper.style.maxWidth = '25%';
            else if (ds === 'medium') wrapper.style.maxWidth = '50%';
            else if (ds === 'large') wrapper.style.maxWidth = '75%';
            img.parentNode.insertBefore(wrapper, img);
            wrapper.appendChild(img);
        });

        return temp.innerHTML;
    }

    function handlePreviewQuoteExpand(btn) {
        var quote = btn.closest('.modern-quote');
        if (!quote) return;
        var content = quote.querySelector('.quote-content');
        if (!content) return;
        var isExpanded = quote.classList.contains('expanded');
        if (isExpanded) {
            content.style.maxHeight = content.scrollHeight + 'px';
            void content.offsetHeight;
            content.style.maxHeight = '';
            quote.classList.remove('expanded');
        } else {
            content.style.maxHeight = content.scrollHeight + 'px';
            quote.classList.add('expanded');
            var cleanup = function (e) {
                if (e.propertyName !== 'max-height') return;
                content.removeEventListener('transitionend', cleanup);
                if (quote.classList.contains('expanded')) content.style.maxHeight = '';
            };
            content.addEventListener('transitionend', cleanup);
        }
        btn.setAttribute('aria-expanded', String(!isExpanded));
        var t = btn.querySelector('.expand-text');
        if (t) t.textContent = isExpanded ? 'Show more' : 'Show less';
    }

    function handlePreviewCodeExpand(btn) {
        var block = btn.closest('.modern-code');
        if (!block) return;
        var content = block.querySelector('.code-content');
        if (!content) return;
        var isExpanded = block.classList.contains('expanded');
        if (isExpanded) {
            content.style.maxHeight = content.scrollHeight + 'px';
            void content.offsetHeight;
            content.style.maxHeight = '';
            block.classList.remove('expanded');
        } else {
            content.style.maxHeight = content.scrollHeight + 'px';
            block.classList.add('expanded');
            var cleanup = function (e) {
                if (e.propertyName !== 'max-height') return;
                content.removeEventListener('transitionend', cleanup);
                if (block.classList.contains('expanded')) content.style.maxHeight = '';
            };
            content.addEventListener('transitionend', cleanup);
        }
        btn.setAttribute('aria-expanded', String(!isExpanded));
        var t = btn.querySelector('.expand-text');
        if (t) t.textContent = isExpanded ? 'Show more' : 'Show less';
    }

    function handlePreviewCodeCopy(btn) {
        var block = btn.closest('.modern-code');
        if (!block) return;
        var codeEl = block.querySelector('.code-content code');
        if (!codeEl) return;
        var text = codeEl.textContent;
        var flash = function () {
            var icon = btn.querySelector('i');
            if (!icon) return;
            var orig = icon.className;
            icon.className = 'fa-regular fa-check';
            setTimeout(function () { icon.className = orig; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(flash).catch(function () {});
        } else {
            var ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); flash(); } catch (e) {}
            document.body.removeChild(ta);
        }
    }

    function handlePreviewSpoilerToggle(trigger) {
        var header = trigger.closest('.spoiler-header');
        if (!header) return;
        var spoiler = header.closest('.modern-spoiler');
        if (!spoiler) return;
        var content = spoiler.querySelector('.spoiler-content');
        var btn = header.querySelector('.spoiler-toggle');
        if (!content) return;
        var isExpanded = spoiler.classList.contains('expanded');
        if (isExpanded) {
            content.style.maxHeight = content.scrollHeight + 'px';
            void content.offsetHeight;
            content.style.maxHeight = '0';
            spoiler.classList.remove('expanded');
        } else {
            var targetHeight = content.scrollHeight;
            if (targetHeight <= 0) return;
            content.style.maxHeight = targetHeight + 'px';
            spoiler.classList.add('expanded');
        }
        if (btn) btn.setAttribute('aria-expanded', String(!isExpanded));
        header.setAttribute('aria-expanded', String(!isExpanded));
        content.setAttribute('aria-hidden', String(isExpanded));
    }

    function handlePreviewNSFWToggle(el) {
        var isRevealed = el.classList.toggle('revealed');
        el.setAttribute('aria-pressed', String(isRevealed));
    }

    function attachPreviewHandlers(previewArea) {
        previewArea.addEventListener('click', function (e) {
    var nsfwImg = e.target.closest('.nsfw-image');
    if (nsfwImg && previewArea.contains(nsfwImg)) {
        e.preventDefault(); e.stopPropagation();
        var r = nsfwImg.classList.toggle('revealed');
        nsfwImg.setAttribute('aria-pressed', String(r));
        return;
    }
    var nsfwTag = e.target.closest('.nsfw-tag');
    if (nsfwTag && previewArea.contains(nsfwTag)) {
        e.preventDefault(); e.stopPropagation();
        handlePreviewNSFWToggle(nsfwTag);
        return;
    }
    var qe = e.target.closest('.quote-expand-btn');
    if (qe && previewArea.contains(qe)) { e.preventDefault(); e.stopPropagation(); handlePreviewQuoteExpand(qe); return; }
    var ce = e.target.closest('.code-expand-btn');
    if (ce && previewArea.contains(ce)) { e.preventDefault(); e.stopPropagation(); handlePreviewCodeExpand(ce); return; }
    var cc = e.target.closest('.code-copy-btn');
    if (cc && previewArea.contains(cc)) { e.preventDefault(); e.stopPropagation(); handlePreviewCodeCopy(cc); return; }
    var sh = e.target.closest('.spoiler-header');
    if (sh && previewArea.contains(sh)) { e.preventDefault(); e.stopPropagation(); handlePreviewSpoilerToggle(sh); return; }
});
        previewArea.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            var nsfwImg = e.target.closest('.nsfw-image');
            if (nsfwImg && previewArea.contains(nsfwImg)) {
                e.preventDefault();
                var r = nsfwImg.classList.toggle('revealed');
                nsfwImg.setAttribute('aria-pressed', String(r));
                return;
            }
            var nsfwTag = e.target.closest('.nsfw-tag');
            if (nsfwTag && previewArea.contains(nsfwTag)) {
                e.preventDefault();
                handlePreviewNSFWToggle(nsfwTag);
                return;
            }
            var sh = e.target.closest('.spoiler-header');
            if (sh && previewArea.contains(sh)) { e.preventDefault(); handlePreviewSpoilerToggle(sh); }
        });
    }

    function initPreviewQuotesAndSpoilers(previewArea) {
        var checkQuoteOverflow = function (quote) {
            var content = quote.querySelector('.quote-content');
            var expandBtn = quote.querySelector('.quote-expand-btn');
            if (!content || !expandBtn) return;
            var maxH = parseFloat(getComputedStyle(content).maxHeight);
            if (isNaN(maxH)) return;
            var actualH = content.getBoundingClientRect().height;
            var tallImg = false;
            content.querySelectorAll('img').forEach(function (img) {
                if (img.getBoundingClientRect().height > maxH + 2) tallImg = true;
            });
            var overflows = (content.scrollHeight > maxH + 2) || (actualH > maxH + 2) || tallImg;
            if (!overflows) {
                expandBtn.remove();
                quote.classList.remove('long-quote');
            }
        };
        previewArea.querySelectorAll('.modern-quote.long-quote').forEach(function (quote) {
            var content = quote.querySelector('.quote-content');
            if (!content) return;
            var imgs = content.querySelectorAll('img');
            if (imgs.length === 0) {
                checkQuoteOverflow(quote);
            } else {
                var pending = imgs.length;
                var onLoadOrError = function () {
                    pending--;
                    if (pending === 0) requestAnimationFrame(function () { setTimeout(function () { checkQuoteOverflow(quote); }, 50); });
                };
                imgs.forEach(function (img) {
                    if (img.complete && img.naturalHeight !== 0) onLoadOrError();
                    else { img.addEventListener('load', onLoadOrError); img.addEventListener('error', onLoadOrError); }
                });
            }
        });
        requestAnimationFrame(function () {
            previewArea.querySelectorAll('.modern-code').forEach(function (block) {
                var content = block.querySelector('.code-content.collapsible-content');
                var expandBtn = block.querySelector('.code-expand-btn');
                if (!content || !expandBtn) return;
                var maxH = parseFloat(getComputedStyle(content).maxHeight);
                if (isNaN(maxH)) return;
                if (content.scrollHeight <= maxH + 2) {
                    content.classList.remove('collapsible-content');
                    expandBtn.remove();
                }
            });
        });
    }

    function makeModalShell(width) {
        var overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
        var box = document.createElement('div');
        box.className = 'modern-modal-box';
        box.style.cssText = 'background:var(--surface-color);border-radius:var(--radius-lg);padding:var(--space-lg);width:' + (width || 360) + 'px;max-width:90%;box-shadow:var(--shadow-lg);';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        return { overlay: overlay, box: box };
    }

    function showInputModal(title, placeholder, icon, callback, editorRef) {
        var m = makeModalShell(340);
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-md) 0;"><i class="fa-regular ' + escapeHtml(icon || 'fa-image') + '" aria-hidden="true"></i> ' + escapeHtml(title) + '</h3>' +
            '<input type="url" id="modal-input" class="modern-input" placeholder="' + escapeHtml(placeholder) + '" style="width:100%;">' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">Insert</button>' +
            '</div>';
        var input = m.box.querySelector('#modal-input');
        input.focus();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = function () { var v = input.value.trim(); if (v) callback(v); close(); };
        input.addEventListener('keypress', function (e) { if (e.key === 'Enter') m.box.querySelector('#modal-submit').click(); });
    }

    function showSpoilerTitleModal(initial, callback, editorRef) {
        var m = makeModalShell(360);
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-eye-slash"></i> Spoiler title</h3>' +
            '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Optional. Leave empty for a plain spoiler.</p>' +
            '<input type="text" id="m-sp" class="modern-input" placeholder="e.g. Route: Lily - Chapter 5" maxlength="80" style="width:100%;" value="' + escapeHtml(initial || '') + '">' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">Save</button>' +
            '</div>';
        var input = m.box.querySelector('#m-sp');
        input.focus(); input.select();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        function submit() { var v = input.value.trim().replace(/[{}]/g, '').replace(/[\r\n]+/g, ' ').trim(); callback(v); close(); }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = submit;
        input.addEventListener('keypress', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }

    var CODE_LANG_SUGGESTIONS = [
        "Ren'Py", 'Python', 'JavaScript', 'TypeScript', 'Lua', 'HTML', 'CSS', 'JSON', 'XML', 'YAML',
        'SQL', 'Bash', 'Shell', 'PowerShell', 'C', 'C++', 'C#', 'Java', 'Kotlin', 'Rust', 'Go',
        'Ruby', 'PHP', 'Swift', 'Markdown', 'Plain text'
    ];

    function showCodeLangModal(initial, callback, editorRef) {
        var m = makeModalShell(360);
        var opts = CODE_LANG_SUGGESTIONS.map(function (l) { return '<option value="' + escapeHtml(l) + '"></option>'; }).join('');
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-code"></i> Code language</h3>' +
            '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Optional. Shown on the code block header.</p>' +
            '<input type="text" id="m-cl" class="modern-input" list="m-cl-l" placeholder="e.g. Python, Ren\'Py" maxlength="40" style="width:100%;" value="' + escapeHtml(initial || '') + '">' +
            '<datalist id="m-cl-l">' + opts + '</datalist>' +
            '<div style="display:flex;gap:var(--space-sm);margin-top:var(--space-md);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">Save</button>' +
            '</div>';
        var input = m.box.querySelector('#m-cl');
        input.focus(); input.select();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        function submit() { var v = input.value.trim().replace(/[\r\n]+/g, ' ').trim(); callback(v); close(); }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = submit;
        input.addEventListener('keypress', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }

    function showLinkModal(initialHref, callback, editorRef) {
        var m = makeModalShell(360);
        var isEdit = initialHref != null;
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-md) 0;"><i class="fa-regular fa-link"></i> ' + (isEdit ? 'Edit link' : 'Insert link') + '</h3>' +
            (isEdit ? '' : '<div style="margin-bottom:var(--space-md);"><label style="display:block;margin-bottom:var(--space-xs);color:var(--text-secondary);">Link text (optional)</label><input type="text" id="m-lt" class="modern-input" placeholder="Enter text to display" style="width:100%;"></div>') +
            '<div style="margin-bottom:var(--space-md);"><label style="display:block;margin-bottom:var(--space-xs);color:var(--text-secondary);">URL</label><input type="url" id="m-lu" class="modern-input" placeholder="https://example.com" style="width:100%;" value="' + escapeHtml(initialHref || '') + '"></div>' +
            '<div style="display:flex;gap:var(--space-sm);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">' + (isEdit ? 'Save' : 'Insert link') + '</button>' +
            '</div>';
        var textInput = m.box.querySelector('#m-lt');
        var urlInput = m.box.querySelector('#m-lu');
        urlInput.focus(); if (isEdit) urlInput.select();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = function () {
            var lt = textInput ? textInput.value.trim() : '';
            var lu = urlInput.value.trim();
            if (lu) callback(lu, lt || null);
            close();
        };
        if (textInput) textInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') m.box.querySelector('#modal-submit').click(); });
        urlInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') m.box.querySelector('#modal-submit').click(); });
    }

    function showImageEditModal(initialAlt, initialSize, callback, editorRef) {
        var m = makeModalShell(380);
        var sizes = [
            { value: 'small', label: 'Small (25%)' },
            { value: 'medium', label: 'Medium (50%)' },
            { value: 'large', label: 'Large (75%)' },
            { value: '', label: 'Full width' }
        ];
        var sizeHtml = sizes.map(function (s) {
            var checked = (initialSize || '') === s.value ? ' checked' : '';
            return '<label class="modern-radio" style="margin-right:var(--space-md);margin-bottom:var(--space-xs);"><input type="radio" name="m-size" value="' + s.value + '"' + checked + '><span>' + s.label + '</span></label>';
        }).join('');
        m.box.innerHTML =
            '<h3 style="margin:0 0 var(--space-xs) 0;"><i class="fa-regular fa-image"></i> Edit image</h3>' +
            '<p style="margin:0 0 var(--space-md) 0;color:var(--text-tertiary);font-size:var(--text-xs);">Describe the image for accessibility, and optionally resize it.</p>' +
            '<div style="margin-bottom:var(--space-md);"><label style="display:block;font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-xs);">Alt text</label><input type="text" id="m-alt" class="modern-input" placeholder="Describe this image" maxlength="200" style="width:100%;" value="' + escapeHtml(initialAlt || '') + '"></div>' +
            '<div style="margin-bottom:var(--space-md);"><label style="display:block;font-size:var(--text-xs);color:var(--text-secondary);margin-bottom:var(--space-xs);">Display size</label><div style="display:flex;flex-wrap:wrap;gap:var(--space-sm);">' + sizeHtml + '</div></div>' +
            '<div style="display:flex;gap:var(--space-sm);justify-content:flex-end;">' +
                '<button id="modal-cancel" class="modern-btn modern-btn-secondary">Cancel</button>' +
                '<button id="modal-submit" class="modern-btn modern-btn-primary">Save</button>' +
            '</div>';
        var altInput = m.box.querySelector('#m-alt');
        altInput.focus(); altInput.select();
        function close() { m.overlay.remove(); document.removeEventListener('keydown', onEsc); if (editorRef) editorRef.commands.focus(); }
        function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
        document.addEventListener('keydown', onEsc);
        m.box.querySelector('#modal-cancel').onclick = close;
        m.box.querySelector('#modal-submit').onclick = function () {
            var c = m.box.querySelector('input[name="m-size"]:checked');
            var size = c ? c.value : '';
            callback(altInput.value.trim(), size || null);
            close();
        };
    }

    var EMOJI_GROUPS = [
        { name: 'Emojis', emojis: [
            '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','🥲','😏','😋','😛',
            '😜','🤪','😝','🤗','🤭','🤫','🤔','🤤','🥳','😎','🤓','🧐','🙃','🤐','🤨','😒','🙄','😬','😌','😔',
            '😪','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','😵','🤯','😕','😟','🙁','😮','😲','😳','🥺','😨',
            '😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','💩','🤡','👋',
            '👌','👍','👎','✊','👏','🙏','💪','👀','🤦','🤷','🎉','❤️','💔','🔥','💯','💥'
        ] }
    ];

    var EMOJI_NAME_MAP = {
        smile:'🙂', joy:'😂', lol:'😆', wink:'😉', thinking:'🤔', cry:'😢', sweat:'😅',
        eyeroll:'🙄', eyebrow:'🤨', facepalm:'🤦', hearteyes:'😍', party:'🥳', frown:'🙁',
        heart:'❤️', fire:'🔥', hundred:'💯', eyes:'👀', skull:'💀', thumbsup:'👍',
        thumbsdown:'👎', clap:'👏', wave:'👋', pray:'🙏'
    };

    var EMOJI_RECENTS_KEY = 'editor-emoji-recents-v1';
    var EMOJI_RECENTS_MAX = 16;

    function loadEmojiRecents() {
        try { var r = localStorage.getItem(EMOJI_RECENTS_KEY); if (!r) return []; var a = JSON.parse(r); return Array.isArray(a) ? a : []; }
        catch (e) { return []; }
    }

    function saveEmojiRecents(arr) {
        try { localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(arr.slice(0, EMOJI_RECENTS_MAX))); } catch (e) {}
    }

    function pushEmojiRecent(e) {
        var r = loadEmojiRecents(); var i = r.indexOf(e);
        if (i !== -1) r.splice(i, 1);
        r.unshift(e); saveEmojiRecents(r);
    }

    function emojiToCodePoint(emoji) {
        var cps = Array.from(emoji).map(function (ch) { return ch.codePointAt(0).toString(16); });
        return cps.filter(function (c) { return c !== 'fe0f'; }).join('-');
    }

    var ASCII_EMOTICON_MAP = {
        '*\\0/*':'1f646','*\\O/*':'1f646','-___-':'1f611',":'-)":'1f602',"':-)":'1f605',"':-D":'1f605',
        ':-D':'1f603',":')":'1f602',":-)":'1f642',"(:":'1f643',";)":'1f609',':P':'1f61b',':D':'1f603',
        ':)':'1f642',':(':'1f61e','<3':'2764','(y)':'1f44d',"B-)":'1f60e','-_-':'1f611'
    };

    async function loadTipTapDeps() {
        const core = await import('https://esm.sh/@tiptap/core@2.5.2');
        const Editor = core.Editor || (core.default && core.default.Editor);
        const Node = core.Node || (core.default && core.default.Node);
        const Mark = core.Mark || (core.default && core.default.Mark);
        const Extension = core.Extension || (core.default && core.default.Extension);
        const InputRule = core.InputRule || (core.default && core.default.InputRule);
        if (!Editor || !Node || !Mark || !Extension || !InputRule) throw new Error('TipTap core missing');

        const { Plugin, PluginKey, TextSelection, NodeSelection } = await import('https://esm.sh/prosemirror-state@1.4.3');
        const { Decoration, DecorationSet } = await import('https://esm.sh/prosemirror-view@1.33.0');

        const sk = await import('https://esm.sh/@tiptap/starter-kit@2.5.2');
        const ph = await import('https://esm.sh/@tiptap/extension-placeholder@2.5.2');
        const ul = await import('https://esm.sh/@tiptap/extension-underline@2.5.2');
        const im = await import('https://esm.sh/@tiptap/extension-image@2.5.2');
        const lk = await import('https://esm.sh/@tiptap/extension-link@2.5.2');
        const mn = await import('https://esm.sh/@tiptap/extension-mention@2.5.2');
        const cbl = await import('https://esm.sh/@tiptap/extension-code-block-lowlight@2.5.2');
        const lh = await import('https://esm.sh/lowlight@3');
        const ccl = await import('https://esm.sh/@tiptap/extension-character-count@2.5.2');
        const typo = await import('https://esm.sh/@tiptap/extension-typography@2.5.2');
        const bq = await import('https://esm.sh/@tiptap/extension-blockquote@2.5.2');

        const BlockquoteClass = bq.Blockquote
            || (bq.default && bq.default.Blockquote)
            || bq.default
            || bq;

        return {
            Editor, Node, Mark, Extension, InputRule,
            Plugin, PluginKey, TextSelection, NodeSelection,
            Decoration, DecorationSet,
            StarterKit: sk.StarterKit || (sk.default && sk.default.StarterKit),
            Placeholder: ph.Placeholder || (ph.default && ph.default.Placeholder),
            Underline: ul.Underline || (ul.default && ul.default.Underline),
            BaseImage: im.Image || (im.default && im.default.Image),
            Link: lk.Link || (lk.default && lk.default.Link),
            Mention: mn.Mention || (mn.default && mn.default.Mention),
            CodeBlockLowlight: cbl.CodeBlockLowlight || (cbl.default && cbl.default.CodeBlockLowlight),
            createLowlight: lh.createLowlight,
            common: lh.common,
            CharacterCount: ccl.CharacterCount || (ccl.default && ccl.default.CharacterCount),
            Typography: typo.Typography || (typo.default && typo.default.Typography),
            Blockquote: BlockquoteClass
        };
    }

    async function buildEditorInto(host, opts) {
        var editorRef = { current: null };
        var deps = await loadTipTapDeps();
        var {
            Editor, Node, Extension, Mark,
            Plugin, PluginKey, TextSelection, NodeSelection,
            Decoration, DecorationSet,
            StarterKit, Placeholder, Underline, BaseImage, Link,
            Mention, CodeBlockLowlight, createLowlight, common,
            CharacterCount, Typography, InputRule, Blockquote
        } = deps;

        var lowlight = createLowlight(common);

        var _rebuildCount = opts._rebuildCount || 0;
        var MAX_REBUILDS = 3;
        var _rebuildScheduled = false;

        function scheduleEditorRebuild() {
            if (_rebuildScheduled) return;
            if (_rebuildCount >= MAX_REBUILDS) {
                console.error('[EditorModule] Max rebuild attempts reached (' + MAX_REBUILDS + '). Please refresh the page.');
                return;
            }
            _rebuildScheduled = true;
            _rebuildCount++;
            console.trace('[EditorModule] Editor rebuild scheduled (attempt #' + _rebuildCount + ')');

            setTimeout(function () {
                _rebuildScheduled = false;
                var htmlToRestore = '';
                try {
                    if (editorRef.current && !editorRef.current.isDestroyed) {
                        htmlToRestore = editorRef.current.getHTML();
                    }
                } catch (e) {
                    console.warn('[EditorModule] Could not read HTML for rebuild:', e);
                }

                try {
                    if (editorRef.current && !editorRef.current.isDestroyed) {
                        editorRef.current.destroy();
                    }
                } catch (e) {
                    console.warn('[EditorModule] Editor destroy threw:', e);
                }

                try {
                    while (host.firstChild) host.removeChild(host.firstChild);
                } catch (e) {
                    console.warn('[EditorModule] Container clear threw:', e);
                }

                buildEditorInto(host, Object.assign({}, opts, {
                    initialHtml: htmlToRestore,
                    _rebuildCount: _rebuildCount
                })).then(function () {
                    if (typeof host.__editorSync === 'function') {
                        try { host.__editorSync(); } catch (e) {}
                    }
                }).catch(function (err) {
                    console.error('[EditorModule] Rebuild failed:', err);
                });
            }, 0);
        }

        function countNonEmptyContainers(doc) {
            var count = 0;
            doc.forEach(function (node) {
                if (node.type.name !== 'blockquote' && node.type.name !== 'spoiler') return;
                var hasContent = false;
                node.descendants(function (n) {
                    if (hasContent) return;
                    if (n.isText && n.text) {
                        var v = n.text.replace(/[\p{Cc}\p{Cf}]/gu, '');
                        if (v.trim()) { hasContent = true; return; }
                        return;
                    }
                    var nm = n.type.name;
                    if (nm === 'image' || nm === 'liteYouTube' || nm === 'liteVimeo' ||
                        nm === 'linkPreview' || nm === 'imageUploadPlaceholder' || nm === 'horizontalRule') {
                        hasContent = true;
                    }
                });
                if (hasContent) count++;
            });
            return count;
        }

        function removeEmptyContainers() {
            if (!editorRef.current || editorRef.current.isDestroyed) return;
            try {
                var doc = editorRef.current.state.doc;
                var toRemove = [];
                doc.forEach(function (node, offset) {
                    if (node.type.name !== 'blockquote' && node.type.name !== 'spoiler') return;
                    var hasContent = false;
                    node.descendants(function (n) {
                        if (hasContent) return;
                        if (n.isText && n.text) {
                            var v = n.text.replace(/[\p{Cc}\p{Cf}]/gu, '');
                            if (v.trim()) { hasContent = true; return; }
                            return;
                        }
                        var nm = n.type.name;
                        if (nm === 'image' || nm === 'liteYouTube' || nm === 'liteVimeo' ||
                            nm === 'linkPreview' || nm === 'imageUploadPlaceholder' || nm === 'horizontalRule') {
                            hasContent = true;
                        }
                    });
                    if (!hasContent) toRemove.push({ pos: offset, size: node.nodeSize });
                });
                if (toRemove.length === 0) return;

                var tr = editorRef.current.state.tr;
                for (var i = toRemove.length - 1; i >= 0; i--) {
                    tr.delete(toRemove[i].pos, toRemove[i].pos + toRemove[i].size);
                }
                if (tr.doc.childCount === 0) {
                    tr.insert(0, editorRef.current.state.schema.nodes.paragraph.create());
                }
                editorRef.current.view.dispatch(tr);
            } catch (e) {
                console.error('[EditorModule] removeEmptyContainers failed:', e);
                scheduleEditorRebuild();
            }
        }

        if (!opts.hideHeader) {
            var syncUser = getCurrentUserSync();
            var currentHeader = null;
            if (syncUser) {
                currentHeader = buildUserHeader(syncUser, opts.headerLabel || 'Replying as:');
                if (currentHeader) host.appendChild(currentHeader);
            }

            fetchCurrentUserData().then(function (user) {
                if (!user) return;
                var newHeader = buildUserHeader(user, opts.headerLabel || 'Replying as:');
                if (!newHeader) return;

                if (currentHeader && currentHeader.parentNode) {
                    currentHeader.parentNode.replaceChild(newHeader, currentHeader);
                } else if (host.firstChild) {
                    host.insertBefore(newHeader, host.firstChild);
                } else {
                    host.appendChild(newHeader);
                }
                currentHeader = newHeader;
                attachProfileTip(currentHeader, user);
            });
        }

        var toolbar = document.createElement('div');
        toolbar.className = 'modern-editor-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Formatting');
        host.appendChild(toolbar);

        var editorEl = document.createElement('div');
        editorEl.id = 'tiptap-editor-' + Math.random().toString(36).slice(2, 9);
        editorEl.className = 'modern-wysiwyg';
        host.appendChild(editorEl);

        var previewArea = document.createElement('div');
        previewArea.className = 'modern-preview';
        previewArea.style.display = 'none';
        previewArea.innerHTML = '<h3 class="modern-preview-title"><i class="fa-regular fa-eye"></i> Preview</h3><div class="preview-content"></div>';
        host.appendChild(previewArea);
        attachPreviewHandlers(previewArea);

        var actions = document.createElement('div');
        actions.className = 'modern-actions';
        var cancelBtnHtml = opts.onCancel ? '<button type="button" class="modern-btn modern-btn-secondary modern-editor-cancel"><i class="fa-regular fa-xmark"></i> Cancel</button>' : '';
        actions.innerHTML = cancelBtnHtml +
            '<button type="button" class="modern-btn modern-btn-secondary modern-editor-preview-btn"><i class="fa-regular fa-eye"></i> Preview</button>' +
            '<button type="button" class="modern-btn modern-btn-primary modern-editor-submit-btn" aria-keyshortcuts="Control+Enter"><i class="fa-regular fa-floppy-disk"></i> ' + escapeHtml(opts.submitLabel || 'Submit') + '</button>';
        host.appendChild(actions);

        var submitBtn = actions.querySelector('.modern-editor-submit-btn');
        var previewBtn = actions.querySelector('.modern-editor-preview-btn');
        var cancelBtn = actions.querySelector('.modern-editor-cancel');

        var livePreviewTimer = null;

        function addSep() {
            var s = document.createElement('span');
            s.className = 'toolbar-separator';
            s.setAttribute('aria-hidden', 'true');
            s.style.cssText = 'width:1px;height:1.5rem;background:var(--border-color);margin:0 var(--space-sm);display:inline-block;vertical-align:middle;';
            toolbar.appendChild(s);
        }

        function mkBtn(icon, label, shortcut) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'modern-editor-btn';
            b.innerHTML = '<i class="' + icon + '"></i>';
            b.title = label;
            b.setAttribute('aria-label', label);
            if (shortcut) b.setAttribute('aria-keyshortcuts', shortcut);
            toolbar.appendChild(b);
            return b;
        }

        function exec(cmd) {
    if (!editorRef.current) return;
    try {
        cmd();
    } catch (err) {
        console.error('[EditorModule] Editor command failed:', err);
    }
    editorRef.current.commands.focus();
}

        var _backdrop = null;
        var _mobileMode = window.matchMedia('(max-width: 680px)').matches;

        function isMobile() { return window.matchMedia('(max-width: 680px)').matches; }

        function ensureBackdrop() {
            if (!_backdrop) {
                _backdrop = document.createElement('div');
                _backdrop.className = 'modern-dropdown-backdrop';
                _backdrop.addEventListener('click', closeAllPopovers);
                document.body.appendChild(_backdrop);
            }
            return _backdrop;
        }

        function positionMenu(btn, menu) {
            menu.style.left = ''; menu.style.right = ''; menu.style.top = ''; menu.style.bottom = '';
            menu.style.maxWidth = ''; menu.style.maxHeight = ''; menu.style.overflowY = '';
            var br = btn.getBoundingClientRect();
            var mr = menu.getBoundingClientRect();
            var vw = window.innerWidth, vh = window.innerHeight, m = 8;
            var sr = vw - br.left - m, sl = br.right - m;
            if (mr.width <= sr) { menu.style.left = '0'; menu.style.right = 'auto'; }
            else if (mr.width <= sl) { menu.style.left = 'auto'; menu.style.right = '0'; }
            else { menu.style.left = '0'; menu.style.right = 'auto'; menu.style.maxWidth = Math.max(120, sr) + 'px'; }
            var sb = vh - br.bottom - m, sa = br.top - m;
            if (mr.height <= sb) { menu.style.top = '100%'; menu.style.bottom = 'auto'; }
            else if (mr.height <= sa) { menu.style.top = 'auto'; menu.style.bottom = '100%'; }
            else { menu.style.top = '100%'; menu.style.bottom = 'auto'; menu.style.maxHeight = Math.max(120, sb) + 'px'; menu.style.overflowY = 'auto'; }
        }

        function openMenu(btn, menu) {
            if (isMobile()) {
                menu.classList.add('is-open', 'is-sheet'); menu.style.display = 'block';
                if (btn) btn.setAttribute('aria-expanded', 'true');
                ensureBackdrop().classList.add('is-active');
                document.body.classList.add('dropdown-sheet-open');
                return;
            }
            menu.classList.remove('is-sheet'); menu.classList.add('is-open'); menu.style.display = 'block';
            if (btn) btn.setAttribute('aria-expanded', 'true');
            positionMenu(btn, menu);
        }

        function closeMenu(btn, menu) {
            if (!menu) return;
            menu.classList.remove('is-open', 'is-sheet');
            menu.style.display = 'none';
            menu.style.left = ''; menu.style.right = ''; menu.style.top = ''; menu.style.bottom = '';
            menu.style.maxWidth = ''; menu.style.maxHeight = ''; menu.style.overflowY = '';
            if (btn) btn.setAttribute('aria-expanded', 'false');
            if (_backdrop) _backdrop.classList.remove('is-active');
            document.body.classList.remove('dropdown-sheet-open');
        }

        function closeAllPopovers() {
            document.querySelectorAll('.modern-dropdown-menu').forEach(function (m) {
                m.classList.remove('is-open', 'is-sheet'); m.style.display = 'none';
            });
            document.querySelectorAll('.modern-editor-btn[aria-haspopup="menu"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
            if (emojiPanel) { emojiPanel.classList.remove('is-open', 'is-sheet'); emojiPanel.style.display = 'none'; }
            if (_backdrop) _backdrop.classList.remove('is-active');
            document.body.classList.remove('dropdown-sheet-open');
        }

        addGlobalListener(document, 'click', closeAllPopovers);
        addGlobalListener(document, 'keydown', function (e) { if (e.key === 'Escape') closeAllPopovers(); });
        addGlobalListener(window, 'resize', function () {
            var nowMobile = isMobile();
            if (nowMobile !== _mobileMode) { _mobileMode = nowMobile; closeAllPopovers(); }
        });

        function focusTrailingEmbedParagraph() {
            if (!editorRef.current) return;
            var doc = editorRef.current.state.doc;
            if (doc.childCount < 2) return;
            var last = doc.child(doc.childCount - 1);
            var secondLast = doc.child(doc.childCount - 2);
            if (last.type.name !== 'paragraph' || last.content.size !== 0) return;
            var atomName = secondLast.type.name;
            if (atomName !== 'liteYouTube' && atomName !== 'liteVimeo' && atomName !== 'imageUploadPlaceholder') return;
            editorRef.current.chain().focus().setTextSelection(doc.content.size - 1).run();
        }

        function fetchEmbedMetadata(kind, videoid) {
            if (!editorRef.current || !videoid) return;
            var canonicalUrl = kind === 'liteYouTube'
                ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoid)
                : 'https://vimeo.com/' + encodeURIComponent(videoid);

            fetchWithTimeout(OG_WORKER_URL + encodeURIComponent(canonicalUrl), {}, OG_FETCH_TIMEOUT)
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    if (!data || data.error || !data.title) return;
                    if (!editorRef.current) return;
                    var positions = [];
                    editorRef.current.state.doc.descendants(function (node, pos) {
                        if (node.type.name === kind && node.attrs.videoid === videoid && !node.attrs.title) {
                            positions.push(pos);
                        }
                        return true;
                    });
                    if (positions.length === 0) return;
                    var tr = editorRef.current.state.tr;
                    for (var i = 0; i < positions.length; i++) {
                        var pos = positions[i];
                        var node = tr.doc.nodeAt(pos);
                        if (!node) continue;
                        tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, {
                            title: data.title || '',
                            author: data.author || '',
                        }));
                    }
                    editorRef.current.view.dispatch(tr);
                })
                .catch(function () {});
        }

        function insertLiteEmbed(kind, videoid, embedOpts) {
            if (!editorRef.current) return;
            embedOpts = embedOpts || {};
            var attrs = { videoid: videoid };
            if (embedOpts.start != null) attrs.start = String(embedOpts.start);
            if (embedOpts.end != null) attrs.end = String(embedOpts.end);
            editorRef.current.chain().focus().insertContent({ type: kind, attrs: attrs }).run();
            focusTrailingEmbedParagraph();
            fetchEmbedMetadata(kind, videoid);
        }

        function updateLivePreview() {
            if (!editorRef.current || editorContentIsEmpty(editorRef.current.getHTML())) return;

            var hasPlaceholder = false;
            editorRef.current.state.doc.content.content.some(function (child) {
                if (child.type.name === 'imageUploadPlaceholder') {
                    hasPlaceholder = true;
                    return true;
                }
                return false;
            });
            if (hasPlaceholder) return;

            if (!previewArea || previewArea.style.display === 'none') return;

            var previewHtml = transformPreviewHtml(editorRef.current.getHTML());
            var previewContent = previewArea.querySelector('.preview-content');
            if (previewContent) {
                previewContent.innerHTML = previewHtml;
                if (window.twemoji) {
                    window.twemoji.parse(previewContent, { base: TWEMOJI_BASE, ext: '.svg' });
                }
            }
            initPreviewQuotesAndSpoilers(previewArea);
        }

        function scheduleLivePreviewRefresh() {
            if (!previewArea || previewArea.style.display === 'none') return;
            if (livePreviewTimer) clearTimeout(livePreviewTimer);
            livePreviewTimer = setTimeout(function () {
                livePreviewTimer = null;
                updateLivePreview();
            }, CONFIG.LIVE_PREVIEW_DEBOUNCE_MS);
        }

        var undoBtn = mkBtn('fa-regular fa-undo', 'Undo', 'Control+Z');
        var redoBtn = mkBtn('fa-regular fa-redo', 'Redo', 'Control+Shift+Z');
        undoBtn.disabled = true; redoBtn.disabled = true;
        addSep();

        var boldBtn      = mkBtn('fa-regular fa-bold', 'Bold', 'Control+B');
        var italicBtn    = mkBtn('fa-regular fa-italic', 'Italic', 'Control+I');
        var underlineBtn = mkBtn('fa-regular fa-underline', 'Underline', 'Control+U');
        var strikeBtn    = mkBtn('fa-regular fa-strikethrough', 'Strikethrough');

        var colorDrop = document.createElement('div');
        colorDrop.className = 'modern-dropdown';
        colorDrop.style.cssText = 'position:relative;display:inline-block';
        var colorBtn = document.createElement('button');
        colorBtn.type = 'button'; colorBtn.className = 'modern-editor-btn';
        colorBtn.innerHTML = '<i class="fa-regular fa-palette"></i>';
        colorBtn.title = 'Text color'; colorBtn.setAttribute('aria-label', 'Text color');
        colorBtn.setAttribute('aria-haspopup', 'menu'); colorBtn.setAttribute('aria-expanded', 'false');
        var colorMenu = document.createElement('div');
        colorMenu.className = 'modern-dropdown-menu'; colorMenu.setAttribute('role', 'menu');
        colorMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:180px;display:none;';
        colorMenu.innerHTML =
            '<button class="modern-dropdown-item" role="menuitem" data-color="primary"><span class="color-swatch color-swatch--primary"></span> Primary</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="info"><span class="color-swatch color-swatch--info"></span> Info</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="accent"><span class="color-swatch color-swatch--accent"></span> Accent</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="warning"><span class="color-swatch color-swatch--warning"></span> Warning</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="danger"><span class="color-swatch color-swatch--danger"></span> Danger</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="muted"><span class="color-swatch color-swatch--muted"></span> Muted</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-color="remove"><i class="fa-regular fa-eraser" aria-hidden="true"></i> Remove color</button>';
        colorDrop.appendChild(colorBtn); colorDrop.appendChild(colorMenu);
        toolbar.appendChild(colorDrop);
        colorBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = colorMenu.classList.contains('is-open');
            closeAllPopovers();
            if (!wasOpen) openMenu(colorBtn, colorMenu);
        };
        colorMenu.addEventListener('click', function (e) { e.stopPropagation(); });
        colorMenu.querySelectorAll('[data-color]').forEach(function (b) {
            b.onclick = function () {
                if (!editorRef.current) return;
                var v = b.getAttribute('data-color');
                if (v === 'remove') editorRef.current.chain().focus().unsetMark('semanticColor').run();
                else editorRef.current.chain().focus().setMark('semanticColor', { variant: v }).run();
                closeMenu(colorBtn, colorMenu);
            };
        });

        var clearFormatBtn = mkBtn('fa-regular fa-remove-format', 'Clear formatting');
        addSep();

        var headDrop = document.createElement('div');
        headDrop.className = 'modern-dropdown'; headDrop.style.cssText = 'position:relative;display:inline-block';
        var headBtn = document.createElement('button');
        headBtn.type = 'button'; headBtn.className = 'modern-editor-btn';
        headBtn.innerHTML = '<i class="fa-regular fa-heading"></i>';
        headBtn.title = 'Heading'; headBtn.setAttribute('aria-label', 'Heading');
        headBtn.setAttribute('aria-haspopup', 'menu'); headBtn.setAttribute('aria-expanded', 'false');
        var headMenu = document.createElement('div');
        headMenu.className = 'modern-dropdown-menu'; headMenu.setAttribute('role', 'menu');
        headMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        headMenu.innerHTML =
            '<button class="modern-dropdown-item" role="menuitem" data-level="1">Heading 1</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-level="2">Heading 2</button>' +
            '<button class="modern-dropdown-item" role="menuitem" data-level="3">Heading 3</button>';
        headDrop.appendChild(headBtn); headDrop.appendChild(headMenu);
        toolbar.appendChild(headDrop);
        headBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = headMenu.classList.contains('is-open');
            closeAllPopovers();
            if (!wasOpen) openMenu(headBtn, headMenu);
        };
        headMenu.addEventListener('click', function (e) { e.stopPropagation(); });
        var headingButtons = { h1: headMenu.querySelector('[data-level="1"]'), h2: headMenu.querySelector('[data-level="2"]'), h3: headMenu.querySelector('[data-level="3"]') };

        var listDrop = document.createElement('div');
        listDrop.className = 'modern-dropdown'; listDrop.style.cssText = 'position:relative;display:inline-block';
        var listBtn = document.createElement('button');
        listBtn.type = 'button'; listBtn.className = 'modern-editor-btn';
        listBtn.innerHTML = '<i class="fa-regular fa-list"></i>';
        listBtn.title = 'Insert list'; listBtn.setAttribute('aria-label', 'Insert list');
        listBtn.setAttribute('aria-haspopup', 'menu'); listBtn.setAttribute('aria-expanded', 'false');
        var listMenu = document.createElement('div');
        listMenu.className = 'modern-dropdown-menu'; listMenu.setAttribute('role', 'menu');
        listMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:160px;display:none;';
        listMenu.innerHTML =
            '<button class="modern-dropdown-item" role="menuitem" id="bullet-list-option"><i class="fa-regular fa-list"></i> Bullet list</button>' +
            '<button class="modern-dropdown-item" role="menuitem" id="ordered-list-option"><i class="fa-regular fa-list-ol"></i> Ordered list</button>';
        listDrop.appendChild(listBtn); listDrop.appendChild(listMenu);
        toolbar.appendChild(listDrop);
        listBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = listMenu.classList.contains('is-open');
            closeAllPopovers();
            if (!wasOpen) openMenu(listBtn, listMenu);
        };
        listMenu.addEventListener('click', function (e) { e.stopPropagation(); });

        var blockquoteBtn = mkBtn('fa-regular fa-quote-left', 'Blockquote');

        var codeDrop = document.createElement('div');
        codeDrop.className = 'modern-dropdown'; codeDrop.style.cssText = 'position:relative;display:inline-block';
        var codeBtn = document.createElement('button');
        codeBtn.type = 'button'; codeBtn.className = 'modern-editor-btn';
        codeBtn.innerHTML = '<i class="fa-regular fa-code"></i>';
        codeBtn.title = 'Code'; codeBtn.setAttribute('aria-label', 'Code');
        codeBtn.setAttribute('aria-haspopup', 'menu'); codeBtn.setAttribute('aria-expanded', 'false');
        var codeMenu = document.createElement('div');
        codeMenu.className = 'modern-dropdown-menu'; codeMenu.setAttribute('role', 'menu');
        codeMenu.style.cssText = 'position:absolute;top:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius-sm);z-index:1000;min-width:180px;display:none;';
        codeMenu.innerHTML =
            '<button class="modern-dropdown-item" role="menuitem" id="inline-code-option"><i class="fa-regular fa-code" aria-hidden="true"></i> Inline code</button>' +
            '<button class="modern-dropdown-item" role="menuitem" id="block-code-option"><i class="fa-regular fa-file-code" aria-hidden="true"></i> Code block</button>';
        codeDrop.appendChild(codeBtn); codeDrop.appendChild(codeMenu);
        toolbar.appendChild(codeDrop);
        codeBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = codeMenu.classList.contains('is-open');
            closeAllPopovers();
            if (!wasOpen) openMenu(codeBtn, codeMenu);
        };
        codeMenu.addEventListener('click', function (e) { e.stopPropagation(); });

        codeMenu.querySelector('#inline-code-option').onclick = function () {
            if (!editorRef.current) return;
            exec(function () { editorRef.current.chain().focus().toggleCode().run(); });
            closeMenu(codeBtn, codeMenu);
        };
        codeMenu.querySelector('#block-code-option').onclick = function () {
            if (!editorRef.current) return;
            closeMenu(codeBtn, codeMenu);
            if (editorRef.current.isActive('codeBlock')) {
                var lang = editorRef.current.getAttributes('codeBlock').language || '';
                showCodeLangModal(lang, function (l) {
                    editorRef.current.chain().focus().updateAttributes('codeBlock', { language: l || null }).run();
                }, editorRef.current);
                return;
            }
            showCodeLangModal('', function (l) {
                var chain = editorRef.current.chain().focus();
                if (l) chain.setCodeBlock({ language: l }).run();
                else chain.setCodeBlock().run();
            }, editorRef.current);
        };

        addSep();
        var linkBtn = mkBtn('fa-regular fa-link', 'Insert link', 'Control+K');
        var imageBtn = mkBtn('fa-regular fa-image', 'Insert image');
        addSep();
        var spoilerBtn = mkBtn('fa-regular fa-square-caret-down', 'Spoiler', 'Control+Shift+S');
        var nsfwBtn = mkBtn('fa-regular fa-eye-slash', 'NSFW (hidden content)', 'Control+Shift+N');

        var emojiBtn = mkBtn('fa-regular fa-face-smile', 'Insert emoji');
        var emojiPanel = document.createElement('div');
        emojiPanel.className = 'modern-emoji-picker';
        emojiPanel.setAttribute('role', 'dialog');
        emojiPanel.setAttribute('aria-label', 'Emoji picker');
        emojiPanel.style.cssText = 'position:absolute;bottom:100%;left:0;background:var(--surface-color);border:1px solid var(--border-color);border-radius:var(--radius);padding:var(--space-sm);z-index:1000;display:none;grid-template-columns:repeat(8,1fr);gap:var(--space-xs);width:min(340px, calc(100vw - 2rem));max-height:280px;overflow-y:auto;';
        toolbar.style.position = 'relative';
        toolbar.appendChild(emojiPanel);

        function renderEmojiPicker() {
            emojiPanel.innerHTML = '';
            var recents = loadEmojiRecents();
            var allGroups = recents.length ? [{ name: 'Recently used', emojis: recents }].concat(EMOJI_GROUPS) : EMOJI_GROUPS;
            allGroups.forEach(function (group, gi) {
                if (gi > 0) {
                    var sep = document.createElement('div');
                    sep.className = 'emoji-group-separator';
                    emojiPanel.appendChild(sep);
                }
                var lbl = document.createElement('div');
                lbl.className = 'emoji-group-label';
                lbl.textContent = group.name;
                emojiPanel.appendChild(lbl);
                group.emojis.forEach(function (emoji) {
                    var item = document.createElement('button');
                    item.type = 'button'; item.className = 'modern-emoji-item';
                    item.setAttribute('data-emoji', emoji);
                    item.setAttribute('aria-label', emoji); item.title = emoji;
                    var img = document.createElement('img');
                    img.src = TWEMOJI_BASE + emojiToCodePoint(emoji) + '.svg';
                    img.alt = emoji;
                    img.style.width = '1.5rem'; img.style.height = '1.5rem';
                    img.onerror = function () { item.innerHTML = ''; item.textContent = emoji; item.style.fontSize = '1.5rem'; };
                    item.appendChild(img);
                    item.onclick = function (e) {
                        e.stopPropagation();
                        if (editorRef.current) {
                            editorRef.current.chain().focus().insertContent({
                                type: 'emoji',
                                attrs: { src: TWEMOJI_BASE + emojiToCodePoint(emoji) + '.svg', alt: emoji, loading: 'lazy', decoding: 'async', width: 24, height: 24 }
                            }).run();
                            pushEmojiRecent(emoji);
                        }
                        closeAllPopovers();
                    };
                    emojiPanel.appendChild(item);
                });
            });
        }

        emojiBtn.onclick = function (e) {
            e.stopPropagation();
            var wasOpen = emojiPanel.classList.contains('is-open');
            closeAllPopovers();
            if (wasOpen) return;
            renderEmojiPicker();
            if (isMobile()) {
                emojiPanel.classList.add('is-open', 'is-sheet');
                emojiPanel.style.display = 'grid';
                ensureBackdrop().classList.add('is-active');
                document.body.classList.add('dropdown-sheet-open');
            } else {
                emojiPanel.classList.add('is-open');
                emojiPanel.style.display = 'grid';
            }
        };
        emojiPanel.addEventListener('click', function (e) { e.stopPropagation(); });

        var _uploadRegistryLocal = new Map();
        function uploadImageToWorker(file) {
            if (!file || !editorRef.current) return;
            var id = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
            _uploadRegistryLocal.set(id, { file: file });
            editorRef.current.chain().focus().insertContent({
                type: 'imageUploadPlaceholder',
                attrs: { uploadId: id, filename: file.name || 'image', filesize: file.size || 0, progress: 0, status: 'uploading' }
            }).run();
        }

        imageBtn.onclick = function () {
            if (!editorRef.current) return;
            editorRef.current.chain().focus().insertContent({ type: 'imageUploadPlaceholder', attrs: { status: 'idle' } }).run();
        };

        linkBtn.onclick = function () {
            if (!editorRef.current) return;
            if (editorRef.current.isActive('link')) {
                var h = editorRef.current.getAttributes('link').href || '';
                showLinkModal(h, function (url) {
                    if (url) editorRef.current.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                }, editorRef.current);
                return;
            }
            var from = editorRef.current.state.selection.from;
            var to = editorRef.current.state.selection.to;
            var selText = editorRef.current.state.doc.textBetween(from, to, '');
            showLinkModal(null, function (url, custom) {
                if (selText) {
                    editorRef.current.chain().focus().setLink({ href: url }).run();
                } else {
                    var display = custom || url;
                    editorRef.current.chain().focus().insertContent(display).run();
                    var p = editorRef.current.state.selection.from;
                    var tl = display.length;
                    editorRef.current.chain().focus()
                        .setTextSelection({ from: p - tl, to: p })
                        .setLink({ href: url })
                        .setTextSelection(p).run();
                }
            }, editorRef.current);
        };

        spoilerBtn.onclick = function () {
            if (!editorRef.current) return;
            if (editorRef.current.isActive('spoiler')) {
                var t = editorRef.current.getAttributes('spoiler').title || '';
                showSpoilerTitleModal(t, function (title) {
                    editorRef.current.chain().focus().updateAttributes('spoiler', { title: title || null }).run();
                }, editorRef.current);
                return;
            }
            showSpoilerTitleModal('', function (title) {
                var chain = editorRef.current.chain().focus();
                if (title) chain.wrapIn('spoiler', { title: title }).run();
                else chain.wrapIn('spoiler').run();
            }, editorRef.current);
        };

        nsfwBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleNSFW().run(); }); };

        undoBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().undo().run(); }); };
        redoBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().redo().run(); }); };
        clearFormatBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().unsetAllMarks().clearNodes().run(); }); };
        boldBtn.onclick      = function () { exec(function () { editorRef.current.chain().focus().toggleBold().run(); }); };
        italicBtn.onclick    = function () { exec(function () { editorRef.current.chain().focus().toggleItalic().run(); }); };
        underlineBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleUnderline().run(); }); };
        strikeBtn.onclick    = function () { exec(function () { editorRef.current.chain().focus().toggleStrike().run(); }); };
        headingButtons.h1.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleHeading({ level: 1 }).run(); }); closeMenu(headBtn, headMenu); };
        headingButtons.h2.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleHeading({ level: 2 }).run(); }); closeMenu(headBtn, headMenu); };
        headingButtons.h3.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleHeading({ level: 3 }).run(); }); closeMenu(headBtn, headMenu); };
        listMenu.querySelector('#bullet-list-option').onclick = function () { exec(function () { editorRef.current.chain().focus().toggleBulletList().run(); }); closeMenu(listBtn, listMenu); };
        listMenu.querySelector('#ordered-list-option').onclick = function () { exec(function () { editorRef.current.chain().focus().toggleOrderedList().run(); }); closeMenu(listBtn, listMenu); };
        blockquoteBtn.onclick = function () { exec(function () { editorRef.current.chain().focus().toggleBlockquote().run(); }); };

        const CustomBlockquote = Blockquote.extend({
            addAttributes() {
                return {
                    author: {
                        default: null,
                        parseHTML: el => el.getAttribute('data-author') || null,
                        renderHTML: a => a.author ? { 'data-author': a.author } : {},
                    },
                    timestamp: {
                        default: null,
                        parseHTML: el => el.getAttribute('data-timestamp') || null,
                        renderHTML: a => a.timestamp ? { 'data-timestamp': a.timestamp } : {},
                    },
                    url: {
                        default: null,
                        parseHTML: el => el.getAttribute('data-url') || null,
                        renderHTML: a => a.url ? { 'data-url': a.url } : {},
                    },
                };
            },
        });

        const ImageUploadPlaceholder = Node.create({
            name: 'imageUploadPlaceholder',
            group: 'block', atom: true, draggable: false, selectable: true,
            addAttributes() {
                return {
                    uploadId:     { default: null },
                    filename:     { default: '' },
                    filesize:     { default: 0 },
                    progress:     { default: 0 },
                    status:       { default: 'idle' },
                    errorMessage: { default: '' },
                };
            },
            parseHTML() { return []; },
            renderHTML({ node }) {
                return ['span', { class: 'ff-upload-placeholder-marker', 'data-upload-id': node.attrs.uploadId || '' }];
            },
            addNodeView() {
                return ({ node, editor, getPos }) => {
                    const dom = document.createElement('div');
                    dom.className = 'ff-upload-placeholder';
                    dom.setAttribute('contenteditable', 'false');

                    const dropzone = document.createElement('div');
                    dropzone.className = 'ff-upload-dropzone';
                    dropzone.innerHTML =
                        '<div class="ff-upload-dropzone-icon"><i class="fa-regular fa-cloud-arrow-up" aria-hidden="true"></i></div>' +
                        '<div class="ff-upload-dropzone-text">' +
                            '<div class="ff-upload-dropzone-primary"><em>Click to upload</em> or drag and drop</div>' +
                            '<div class="ff-upload-dropzone-secondary">or <button type="button" class="ff-upload-by-url">insert by URL</button></div>' +
                            '<div class="ff-upload-dropzone-hint">Max 32 MB per image</div>' +
                        '</div>' +
                        '<button type="button" class="ff-upload-btn is-danger ff-upload-dismiss-btn" aria-label="Remove"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button>';

                    const progress = document.createElement('div');
                    progress.className = 'ff-upload-progress';
                    progress.innerHTML =
                        '<div class="ff-upload-progress-track"><div class="ff-upload-progress-fill"></div></div>' +
                        '<div class="ff-upload-icon"><i class="fa-regular fa-cloud-arrow-up" aria-hidden="true"></i></div>' +
                        '<div class="ff-upload-info"><div class="ff-upload-filename"></div><div class="ff-upload-meta"></div></div>' +
                        '<div class="ff-upload-actions">' +
                            '<span class="ff-upload-percent">0%</span>' +
                            '<button type="button" class="ff-upload-btn ff-upload-retry-btn" hidden aria-label="Retry upload"><i class="fa-regular fa-arrow-rotate-right" aria-hidden="true"></i></button>' +
                            '<button type="button" class="ff-upload-btn is-danger ff-upload-cancel-btn" aria-label="Cancel upload"><i class="fa-regular fa-xmark" aria-hidden="true"></i></button>' +
                        '</div>';

                    dom.appendChild(dropzone); dom.appendChild(progress);

                    const dismissBtn = dropzone.querySelector('.ff-upload-dismiss-btn');
                    const urlBtn = dropzone.querySelector('.ff-upload-by-url');
                    const filenameEl = progress.querySelector('.ff-upload-filename');
                    const metaEl = progress.querySelector('.ff-upload-meta');
                    const percentEl = progress.querySelector('.ff-upload-percent');
                    const fillEl = progress.querySelector('.ff-upload-progress-fill');
                    const retryBtn = progress.querySelector('.ff-upload-retry-btn');
                    const cancelBtn = progress.querySelector('.ff-upload-cancel-btn');
                    const cancelIcon = cancelBtn.querySelector('i');

                    let currentXhr = null;

                    function findSelf() {
                        const pos = getPos();
                        if (typeof pos !== 'number') return null;
                        const n = editor.state.doc.nodeAt(pos);
                        if (!n || n.type.name !== 'imageUploadPlaceholder') return null;
                        return { pos, node: n };
                    }
                    function patch(p) {
                        const s = findSelf(); if (!s) return;
                        editor.view.dispatch(editor.state.tr.setNodeMarkup(s.pos, undefined, Object.assign({}, s.node.attrs, p)));
                    }
                    function deleteSelf() {
                        const s = findSelf(); if (!s) return;
                        if (s.node.attrs.uploadId) _uploadRegistryLocal.delete(s.node.attrs.uploadId);
                        editor.view.dispatch(editor.state.tr.delete(s.pos, s.pos + s.node.nodeSize));
                    }
                    function replaceWithImage(attrs) {
                        const s = findSelf(); if (!s) return;
                        if (s.node.attrs.uploadId) _uploadRegistryLocal.delete(s.node.attrs.uploadId);
                        const img = editor.schema.nodes.image.create(attrs);
                        const p = editor.schema.nodes.paragraph.create(null, img);
                        const tr = editor.state.tr.replaceWith(s.pos, s.pos + s.node.nodeSize, p);
                        let np = s.pos;
                        while (np > 0) {
                            const prev = tr.doc.resolve(np).nodeBefore;
                            if (prev && prev.type.name === 'paragraph' && prev.content.size === 0) { tr.delete(np - prev.nodeSize, np); np -= prev.nodeSize; }
                            else break;
                        }
                        tr.setSelection(TextSelection.create(tr.doc, np + 2));
                        editor.view.dispatch(tr); editor.view.focus();
                    }

                    function render(n) {
                        const idle = n.attrs.status === 'idle';
                        dropzone.style.display = idle ? '' : 'none';
                        progress.style.display = idle ? 'none' : '';
                        dom.classList.toggle('is-idle', idle);
                        if (idle) return;
                        const failed = n.attrs.status === 'failed';
                        dom.classList.toggle('is-failed', failed);
                        filenameEl.textContent = n.attrs.filename || 'image';
                        metaEl.textContent = failed ? (n.attrs.errorMessage || 'Upload failed') : (formatBytes(n.attrs.filesize) + ' · Uploading…');
                        percentEl.textContent = failed ? '!' : n.attrs.progress + '%';
                        fillEl.style.width = (failed ? 100 : n.attrs.progress) + '%';
                        retryBtn.hidden = !failed || !n.attrs.uploadId;
                        cancelIcon.className = failed ? 'fa-regular fa-trash-can' : 'fa-regular fa-xmark';
                        cancelBtn.title = failed ? 'Remove' : 'Cancel upload';
                        cancelBtn.setAttribute('aria-label', failed ? 'Remove' : 'Cancel upload');
                    }

                    function startUpload() {
                        if (currentXhr) { try { currentXhr.abort(); } catch (e) {} currentXhr = null; }
                        const s = findSelf(); if (!s) return;
                        const uid = s.node.attrs.uploadId; if (!uid) return;
                        const entry = _uploadRegistryLocal.get(uid);
                        if (!entry || !entry.file) { patch({ status: 'failed', errorMessage: 'File no longer available' }); return; }

                        const xhr = new XMLHttpRequest();
                        currentXhr = xhr;
                        xhr.open('POST', UPLOAD_WORKER_URL);
                        xhr.upload.addEventListener('progress', function (e) {
                            if (!e.lengthComputable) return;
                            patch({ progress: Math.round(e.loaded / e.total * 100) });
                        });
                        xhr.addEventListener('load', function () {
                            currentXhr = null;
                            if (xhr.status < 200 || xhr.status >= 300) { patch({ status: 'failed', errorMessage: 'Server error (' + xhr.status + ')' }); return; }
                            let d;
                            try { d = JSON.parse(xhr.responseText); } catch (e) { patch({ status: 'failed', errorMessage: 'Invalid response' }); return; }
                            if (!d.url) { patch({ status: 'failed', errorMessage: 'No URL in response' }); return; }
                            replaceWithImage({ src: d.url, alt: entry.file.name || 'Uploaded image', loading: 'lazy', decoding: 'async', width: d.width ? parseInt(d.width, 10) : null, height: d.height ? parseInt(d.height, 10) : null });
                            showToast('Image uploaded', 'success');
                        });
                        xhr.addEventListener('error', function () { currentXhr = null; patch({ status: 'failed', errorMessage: 'Network error' }); });
                        const fd = new FormData(); fd.append('image', entry.file); xhr.send(fd);
                    }

                    function handleFile(file) {
                        if (file.size > MAX_UPLOAD_BYTES) {
                            patch({ status: 'failed', filename: file.name || 'image', filesize: file.size || 0, progress: 0, errorMessage: 'File exceeds 32 MB limit' });
                            return;
                        }
                        const uid = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
                        _uploadRegistryLocal.set(uid, { file: file });
                        patch({ uploadId: uid, filename: file.name || 'image', filesize: file.size || 0, progress: 0, status: 'uploading', errorMessage: '' });
                        startUpload();
                    }

                    function openPicker() {
                        const input = document.createElement('input');
                        input.type = 'file'; input.accept = 'image/*';
                        input.onchange = function () { if (input.files && input.files[0]) handleFile(input.files[0]); };
                        input.click();
                    }

                    dropzone.addEventListener('click', function (e) {
                        if (e.target.closest('.ff-upload-by-url')) return;
                        if (e.target.closest('.ff-upload-dismiss-btn')) return;
                        e.preventDefault(); e.stopPropagation(); openPicker();
                    });
                    urlBtn.addEventListener('click', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        showInputModal('Insert image URL', 'https://example.com/image.jpg', 'fa-image', function (url) {
                            const img = new Image();
                            img.onload = function () { replaceWithImage({ src: url, alt: 'image', loading: 'lazy', decoding: 'async', width: this.naturalWidth, height: this.naturalHeight }); };
                            img.onerror = function () { replaceWithImage({ src: url, alt: 'image', loading: 'lazy', decoding: 'async' }); };
                            img.src = url;
                        }, editorRef.current);
                    });
                    dismissBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); deleteSelf(); });
                    dropzone.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('is-dragover'); });
                    dropzone.addEventListener('dragleave', function (e) { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('is-dragover'); });
                    dropzone.addEventListener('drop', function (e) {
                        e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('is-dragover');
                        const files = e.dataTransfer && e.dataTransfer.files;
                        if (!files || !files.length) return;
                        const f = files[0];
                        if (!f.type || f.type.indexOf('image/') !== 0) return;
                        handleFile(f);
                    });
                    cancelBtn.addEventListener('click', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        if (currentXhr) { try { currentXhr.abort(); } catch (err) {} currentXhr = null; }
                        deleteSelf();
                    });
                    retryBtn.addEventListener('click', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        if (currentXhr) { try { currentXhr.abort(); } catch (err) {} currentXhr = null; }
                        patch({ status: 'uploading', progress: 0, errorMessage: '' }); startUpload();
                    });

                    render(node);
                    if (node.attrs.status === 'uploading') startUpload();

                    return {
                        dom,
                        update(u) { if (u.type.name !== 'imageUploadPlaceholder') return false; render(u); return true; },
                        destroy() {
                            if (currentXhr) { try { currentXhr.abort(); } catch (e) {} currentXhr = null; }
                            const s = findSelf();
                            if (s && s.node.attrs.uploadId) _uploadRegistryLocal.delete(s.node.attrs.uploadId);
                        },
                        stopEvent(e) {
                            const t = e.target;
                            if (!t || !t.closest) return false;
                            return !!t.closest('.ff-upload-dropzone, .ff-upload-progress, .ff-upload-btn, .ff-upload-by-url');
                        },
                        ignoreMutation() { return true; }
                    };
                };
            }
        });

        const Emoji = Node.create({
    name: 'emoji', inline: true, group: 'inline', atom: true, selectable: false,
    addAttributes() { return { src: { default: null }, alt: { default: '' }, loading: { default: 'lazy' }, decoding: { default: 'async' }, width: { default: 24 }, height: { default: 24 } }; },
    parseHTML() { return [{ tag: 'img[src*="twemoji"]' }]; },
            renderHTML({ node, HTMLAttributes }) {
                return ['img', Object.assign({}, HTMLAttributes, {
                    src: node.attrs.src, alt: node.attrs.alt,
                    loading: node.attrs.loading, decoding: node.attrs.decoding,
                    width: node.attrs.width, height: node.attrs.height,
                    class: 'twemoji'
                })];
            }
        });

        const CustomImage = BaseImage.extend({
            inline: true, group: 'inline', draggable: false, selectable: true,
            addAttributes() {
                return Object.assign({}, this.parent && this.parent(), {
                    src: { default: null },
                    alt: { default: 'image' },
                    width: { default: null }, height: { default: null },
                    loading: { default: 'lazy' }, decoding: { default: 'async' },
                    nsfw: {
                        default: false,
                        parseHTML: el => el.getAttribute('data-nsfw') === 'true',
                        renderHTML: a => a.nsfw ? { 'data-nsfw': 'true' } : {}
                    },
                    size: {
                        default: null,
                        parseHTML: el => el.getAttribute('data-size') || null,
                        renderHTML: a => a.size ? { 'data-size': a.size } : {}
                    }
                });
            },
            renderHTML({ node, HTMLAttributes }) {
                return ['img', Object.assign({}, HTMLAttributes, {
                    src: node.attrs.src, alt: node.attrs.alt,
                    loading: node.attrs.loading, decoding: node.attrs.decoding,
                    width: node.attrs.width, height: node.attrs.height,
                    draggable: 'false'
                })];
            }
        });

        const CustomCodeBlock = CodeBlockLowlight.extend({
            addAttributes() {
                return Object.assign({}, this.parent && this.parent(), {
                    language: {
                        default: null,
                        parseHTML: el => el.getAttribute('data-language') || null,
                        renderHTML: a => a.language ? { 'data-language': a.language } : {}
                    }
                });
            }
        }).configure({ lowlight });

        const emoticonPattern = Object.keys(ASCII_EMOTICON_MAP)
            .sort(function (a, b) { return b.length - a.length; })
            .map(function (e) { return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); })
            .join('|');
        const emoticonRegex = new RegExp('(?:^|\\s)(' + emoticonPattern + ')$');

        const EmoticonRule = Extension.create({
            name: 'emoticonRule',
            addInputRules() {
                return [new InputRule({
                    find: emoticonRegex,
                    handler: function ({ state, range, match }) {
                        const emo = match[1];
                        const cp = ASCII_EMOTICON_MAP[emo];
                        if (!cp) return;
                        const uni = String.fromCodePoint(parseInt(cp, 16));
                        state.tr.replaceWith(range.to - emo.length, range.to, state.schema.nodes.emoji.create({
                            src: TWEMOJI_BASE + cp + '.svg', alt: uni, loading: 'lazy', decoding: 'async', width: 24, height: 24
                        }));
                    }
                })];
            }
        });

       const UnicodeEmojiRule = Extension.create({
    name: 'unicodeEmojiRule',
    addInputRules() {
        return [new InputRule({
            find: /([\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}])$/u,
            handler: function ({ state, range, match }) {
                var emoji = match[1];
                var cp = emojiToCodePoint(emoji);
                state.tr.replaceWith(
                    range.from + (range.to - range.from - emoji.length),
                    range.to,
                    state.schema.nodes.emoji.create({
                        src: TWEMOJI_BASE + cp + '.svg',
                        alt: emoji,
                        loading: 'lazy',
                        decoding: 'async',
                        width: 24,
                        height: 24
                    })
                );
            }
        })];
    }
});

        const LiteYouTube = Node.create({
            name: 'liteYouTube',
            group: 'block', atom: true, draggable: true, selectable: true,
            addAttributes() {
                return {
                    videoid: {
                        default: null,
                        parseHTML: el => el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                        renderHTML: attrs => attrs.videoid ? { videoid: attrs.videoid } : {},
                    },
                    title:  { default: '' },
                    author: { default: '' },
                    start: {
                        default: null,
                        parseHTML: el => el.getAttribute('start') || null,
                        renderHTML: attrs => attrs.start ? { start: String(attrs.start) } : {},
                    },
                    end: {
                        default: null,
                        parseHTML: el => el.getAttribute('end') || null,
                        renderHTML: attrs => attrs.end ? { end: String(attrs.end) } : {},
                    },
                };
            },
            parseHTML() {
                return [
                    {
                        tag: 'div.lite-embed-wrapper',
                        getAttrs: el => {
                            const lite = el.querySelector('lite-youtube');
                            if (!lite) return false;
                            return {
                                videoid: lite.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                                title: el.getAttribute('data-title') || '',
                                author: el.getAttribute('data-author') || '',
                                start: el.getAttribute('data-start') || lite.getAttribute('start') || null,
                                end: el.getAttribute('data-end') || lite.getAttribute('end') || null,
                            };
                        },
                    },
                    {
                        tag: 'lite-youtube',
                        getAttrs: el => ({
                            videoid: el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                            title: el.getAttribute('data-title') || '',
                            author: el.getAttribute('data-author') || '',
                            start: el.getAttribute('start') || null,
                            end: el.getAttribute('end') || null,
                        }),
                    },
                    { tag: 'span.ff-lite-youtube' },
                ];
            },
            renderHTML({ node, HTMLAttributes }) {
                const title = node.attrs.title || '';
                const author = node.attrs.author || '';
                const caption = (title || author)
                    ? ['div', { class: 'lite-embed-caption' },
                        title ? ['span', { class: 'lite-embed-title' }, title] : '',
                        author ? ['span', { class: 'lite-embed-author' }, author] : ''
                      ]
                    : '';
                return [
                    'div',
                    {
                        class: 'lite-embed-wrapper',
                        'data-videoid': node.attrs.videoid || '',
                        'data-title': title || null,
                        'data-author': author || null,
                        'data-start': node.attrs.start != null ? String(node.attrs.start) : null,
                        'data-end':   node.attrs.end   != null ? String(node.attrs.end)   : null,
                    },
                    ['lite-youtube', HTMLAttributes],
                    caption,
                ];
            },
        });

        const LiteVimeo = Node.create({
            name: 'liteVimeo',
            group: 'block', atom: true, draggable: true, selectable: true,
            addAttributes() {
                return {
                    videoid: {
                        default: null,
                        parseHTML: el => el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                        renderHTML: attrs => attrs.videoid ? { videoid: attrs.videoid } : {},
                    },
                    title:  { default: '' },
                    author: { default: '' },
                    start: {
                        default: null,
                        parseHTML: el => el.getAttribute('start') || null,
                        renderHTML: attrs => attrs.start ? { start: String(attrs.start) } : {},
                    },
                };
            },
            parseHTML() {
                return [
                    {
                        tag: 'div.lite-embed-wrapper',
                        getAttrs: el => {
                            const lite = el.querySelector('lite-vimeo');
                            if (!lite) return false;
                            return {
                                videoid: lite.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                                title: el.getAttribute('data-title') || '',
                                author: el.getAttribute('data-author') || '',
                                start: el.getAttribute('data-start') || lite.getAttribute('start') || null,
                            };
                        },
                    },
                    {
                        tag: 'lite-vimeo',
                        getAttrs: el => ({
                            videoid: el.getAttribute('videoid') || el.getAttribute('data-videoid') || null,
                            title: el.getAttribute('data-title') || '',
                            author: el.getAttribute('data-author') || '',
                            start: el.getAttribute('start') || null,
                        }),
                    },
                    { tag: 'span.ff-lite-vimeo' },
                ];
            },
            renderHTML({ node, HTMLAttributes }) {
                const title = node.attrs.title || '';
                const author = node.attrs.author || '';
                const caption = (title || author)
                    ? ['div', { class: 'lite-embed-caption' },
                        title ? ['span', { class: 'lite-embed-title' }, title] : '',
                        author ? ['span', { class: 'lite-embed-author' }, author] : ''
                      ]
                    : '';
                return [
                    'div',
                    {
                        class: 'lite-embed-wrapper',
                        'data-videoid': node.attrs.videoid || '',
                        'data-title': title || null,
                        'data-author': author || null,
                        'data-start': node.attrs.start != null ? String(node.attrs.start) : null,
                    },
                    ['lite-vimeo', HTMLAttributes],
                    caption,
                ];
            },
        });

        const LinkPreview = Node.create({
    name: 'linkPreview',
    inline: true, group: 'inline', atom: true, draggable: true, selectable: true,
    addAttributes() {
        return {
            href: {
                default: '',
                parseHTML: el => el.getAttribute('data-href') || '',
                renderHTML: attrs => attrs.href ? { 'data-href': attrs.href } : {},
            },
            title: {
                default: '',
                parseHTML: el => el.getAttribute('data-title') || '',
                renderHTML: attrs => attrs.title ? { 'data-title': attrs.title } : {},
            },
            description: {
                default: '',
                parseHTML: el => el.getAttribute('data-description') || '',
                renderHTML: attrs => attrs.description ? { 'data-description': attrs.description } : {},
            },
            author: {
                default: '',
                parseHTML: el => el.getAttribute('data-author') || '',
                renderHTML: attrs => attrs.author ? { 'data-author': attrs.author } : {},
            },
            imageSrc: {
                default: '',
                parseHTML: el => el.getAttribute('data-image-src') || '',
                renderHTML: attrs => attrs.imageSrc ? { 'data-image-src': attrs.imageSrc } : {},
            },
            loading: {
                default: false,
                parseHTML: el => el.getAttribute('data-loading') === 'true',
                renderHTML: attrs => attrs.loading ? { 'data-loading': 'true' } : {},
            },
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
                var loading = node.attrs.loading;

                var hostname = '';
                try {
                    hostname = new URL(href).hostname.replace(/^www\./, '');
                } catch (e) {
                    hostname = href.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
                }

                if (loading) {
                    return [
                        'span',
                        { class: 'link-preview-card link-preview-card--loading', 'data-type': 'link-preview', ...HTMLAttributes },
                        ['span', { class: 'link-preview-skeleton' },
                            ['span', { class: 'link-preview-skeleton-bar', style: 'width:40%;' }],
                            ['span', { class: 'link-preview-skeleton-bar', style: 'width:80%;' }],
                            ['span', { class: 'link-preview-skeleton-bar', style: 'width:60%;' }]
                        ]
                    ];
                }

                var finalImageUrl = imageSrc;
                if (imageSrc && imageSrc.startsWith('/')) {
                    try { finalImageUrl = new URL(href).origin + imageSrc; }
                    catch (e) { finalImageUrl = imageSrc; }
                }

                var faviconUrl = 'https://www.google.com/s2/favicons?domain=' + hostname + '&sz=32';
                var isRich = finalImageUrl && finalImageUrl.trim() !== '';

                function isGenericTitle(t, h) {
                    if (!t || t === h) return true;
                    var generic = ['just a moment', 'access denied', 'verification required', 'please wait', 'captcha', 'challenge', 'checking your browser'];
                    var lower = t.toLowerCase();
                    return generic.some(function (term) { return lower.indexOf(term) !== -1; });
                }
                function needsProxy(url) {
                    if (!url) return false;
                    var blocked = ['discordapp.com', 'cdn.discordapp.com', 'media.discordapp.net', 'github.com', 'raw.githubusercontent.com', 'redd.it', 'reddit.com', 'twimg.com', 'pbs.twimg.com'];
                    try {
                        var host = new URL(url).hostname;
                        return blocked.some(function (d) { return host.includes(d); });
                    } catch (_) { return false; }
                }

                if (!isRich) {
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

                var proxiedImage = finalImageUrl;
                if (needsProxy(finalImageUrl)) {
                    proxiedImage = 'https://images.weserv.nl/?url=' + encodeURIComponent(finalImageUrl) + '&output=webp&q=85';
                }

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
                                ['img', { src: proxiedImage, class: 'link-preview-image', loading: 'lazy', alt: '' }]
                            ],
                            [
                                'span',
                                { class: 'link-preview-text' },
                                ['span', { class: 'link-preview-title' }, title || href],
                                node.attrs.author
                                    ? ['span', { class: 'link-preview-author' }, node.attrs.author]
                                    : '',
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

        const Spoiler = Node.create({
            name: 'spoiler', group: 'block', content: 'block+', defining: true,
            addAttributes() {
                return { title: { default: null, parseHTML: el => el.getAttribute('data-title') || null, renderHTML: a => a.title ? { 'data-title': a.title } : {} } };
            },
            parseHTML: () => [{ tag: 'div.spoiler' }],
            renderHTML({ HTMLAttributes }) { return ['div', { class: 'spoiler', ...HTMLAttributes }, 0]; }
        });

        const NSFW = Mark.create({
    name: 'nsfw', inclusive: true,
    parseHTML() { return [{ tag: 'span', getAttrs: el => el.classList.contains('ff-nsfw') ? {} : false }]; },
    renderHTML() { return ['span', { class: 'ff-nsfw' }, 0]; },
    addCommands() {
        return {
            setNSFW:    () => ({ commands }) => commands.setMark(this.name),
            toggleNSFW: () => ({ commands }) => commands.toggleMark(this.name),
            unsetNSFW:  () => ({ commands }) => commands.unsetMark(this.name),
        };
    },
});

        const CustomMention = Mention.extend({
            addAttributes() {
                return {
                    id: {
                        default: null,
                        parseHTML: function (el) { return el.getAttribute('data-uid'); },
                        renderHTML: function (attrs) {
                            return attrs.id != null ? { 'data-uid': attrs.id } : {};
                        },
                    },
                    label: {
                        default: null,
                        parseHTML: function (el) {
                            var v = el.getAttribute('data-username') || el.textContent || '';
                            return decodeHtmlEntities(v).replace(/^@/, '');
                        },
                        renderHTML: function (attrs) {
                            return attrs.label ? { 'data-username': attrs.label } : {};
                        },
                    },
                };
            },
            renderHTML: function ({ node }) {
                return ['mark', {
                    'data-uid': node.attrs.id,
                    'data-username': node.attrs.label || '',
                }, node.attrs.label || ''];
            },
            parseHTML: function () {
                return [{
                    tag: 'mark[data-uid]',
                    getAttrs: function (el) {
                        var raw = el.getAttribute('data-username') || el.textContent || '';
                        raw = decodeHtmlEntities(raw).replace(/^@/, '');
                        return { id: el.getAttribute('data-uid'), label: raw };
                    },
                }];
            },
        }).configure({
            HTMLAttributes: { class: 'user-tag' },
            renderText: function ({ node }) {
                return '@' + (node.attrs.label || '');
            },
            suggestion: {
                char: '@',
                allowSpaces: false,
                allow: function ({ state, range }) {
                    try {
                        var $from = state.doc.resolve(range.from);
                        return $from.parent.type.name !== 'codeBlock';
                    } catch (e) { return true; }
                },
                items: function ({ query }) { return searchMentions(query); },
                render: function () {
                    var popup = null;
                    var items = [];
                    var selectedIndex = 0;
                    var itemEls = [];
                    var lastProps = null;

                    function updateSelected() {
                        itemEls.forEach(function (el, i) {
                            el.classList.toggle('is-selected', i === selectedIndex);
                        });
                    }
                    function makeInitialAvatar(name, userId) {
                        var initial = getInitialFromName(name);
                        var span = document.createElement('span');
                        span.className = 'mention-suggestion-avatar mention-suggestion-avatar--initial';
                        span.style.backgroundColor = '#' + getColorFromNickname(name, userId);
                        span.textContent = initial;
                        return span;
                    }
                    function buildList(props) {
                        items = props.items || [];
                        var seen = {};
                        items = items.filter(function (u) {
                            var k = String(u.id);
                            if (seen[k]) return false;
                            seen[k] = true;
                            return true;
                        });
                        selectedIndex = 0;
                        itemEls = [];
                        if (!popup) return;
                        popup.innerHTML = '';
                        if (items.length === 0) {
                            var emptyRow = document.createElement('div');
                            emptyRow.style.cssText = 'padding:var(--pad-2) var(--pad-3);color:var(--text-tertiary);font-size:var(--text-xs);font-style:italic;';
                            emptyRow.textContent = 'No users found';
                            popup.appendChild(emptyRow);
                            popup.style.display = 'block';
                            return;
                        }
                        items.forEach(function (user) {
                            var el = document.createElement('button');
                            el.type = 'button';
                            el.className = 'mention-suggestion-item';
                            el.setAttribute('role', 'option');

                            var rawAvatar = (typeof user.avatar === 'string' && user.avatar) ? user.avatar : null;
                            var avatarUrl = (rawAvatar && !shouldUseInitialAvatar(rawAvatar))
                                ? (optimizeAvatarUrl(rawAvatar, 28, 28) || rawAvatar)
                                : null;
                            var userName = decodeHtmlEntities(user.name || '');

                            if (avatarUrl) {
                                var img = document.createElement('img');
                                img.className = 'mention-suggestion-avatar';
                                img.src = avatarUrl;
                                img.alt = '';
                                img.width = 28; img.height = 28; img.loading = 'lazy';
                                img.onerror = function () { this.replaceWith(makeInitialAvatar(userName, user.id)); };
                                img.onload = function () {
                                    if (this.naturalWidth <= 1 || this.naturalHeight <= 1) {
                                        this.replaceWith(makeInitialAvatar(userName, user.id));
                                    }
                                };
                                el.appendChild(img);
                            } else {
                                el.appendChild(makeInitialAvatar(userName, user.id));
                            }

                            var name = document.createElement('span');
                            name.className = 'mention-suggestion-name';
                            name.textContent = userName;
                            el.appendChild(name);

                            el.addEventListener('mousedown', function (e) {
                                e.preventDefault();
                                props.command({ id: String(user.id), label: userName || String(user.id) });
                            });
                            itemEls.push(el);
                            popup.appendChild(el);
                        });
                        popup.style.display = 'block';
                        updateSelected();
                    }
                    function positionPopup(props) {
                        if (!popup) return;
                        var rect = props.clientRect && props.clientRect();
                        if (!rect) return;
                        var scrollX = window.pageXOffset || document.documentElement.scrollLeft;
                        var scrollY = window.pageYOffset || document.documentElement.scrollTop;
                        popup.style.left = (rect.left + scrollX) + 'px';
                        popup.style.top = (rect.bottom + scrollY + 4) + 'px';
                    }
                    function reposition() {
                        if (lastProps && popup) positionPopup(lastProps);
                    }

                    return {
                        onStart: function (props) {
                            lastProps = props;
                            popup = document.createElement('div');
                            popup.className = 'mention-suggestions';
                            popup.setAttribute('role', 'listbox');
                            document.body.appendChild(popup);
                            window.addEventListener('scroll', reposition, true);
                            window.addEventListener('resize', reposition);
                            buildList(props);
                            positionPopup(props);
                        },
                        onUpdate: function (props) {
                            lastProps = props;
                            if (!popup) return;
                            buildList(props);
                            positionPopup(props);
                        },
                        onKeyDown: function (props) {
                            if (!popup || popup.style.display === 'none' || items.length === 0) return false;
                            if (props.event.key === 'ArrowDown') {
                                selectedIndex = (selectedIndex + 1) % items.length;
                                updateSelected();
                                return true;
                            }
                            if (props.event.key === 'ArrowUp') {
                                selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                                updateSelected();
                                return true;
                            }
                            if (props.event.key === 'Enter') {
                                var user = items[selectedIndex];
                                if (user) {
                                    props.command({
                                        id: String(user.id),
                                        label: decodeHtmlEntities(user.name || '') || String(user.id),
                                    });
                                }
                                return true;
                            }
                            if (props.event.key === 'Escape') {
                                if (popup) { popup.remove(); popup = null; }
                                return true;
                            }
                            return false;
                        },
                        onExit: function () {
                            window.removeEventListener('scroll', reposition, true);
                            window.removeEventListener('resize', reposition);
                            if (popup) { popup.remove(); popup = null; }
                            items = [];
                            itemEls = [];
                            lastProps = null;
                        },
                    };
                },
            },
        });

        const SemanticColor = Mark.create({
            name: 'semanticColor',
            addAttributes() { return { variant: { default: 'primary' } }; },
            parseHTML() {
                return [{ tag: 'span[data-color]', getAttrs: el => {
                    var v = el.getAttribute('data-color');
                    if (v === 'success') v = 'primary';
                    return v ? { variant: v } : false;
                }}];
            },
            renderHTML({ HTMLAttributes }) {
                var v = HTMLAttributes.variant || 'primary';
                return ['span', { class: 'text-' + v, 'data-color': v }, 0];
            }
        });

        const linkPreviewPlugin = new Plugin({
            key: new PluginKey('linkPreview'),
            props: {
                handlePaste: function (view, event) {
                    var text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                    if (!text) return false;
                    var trimmed = text.trim();
                    var urlRegex = /^(https?:\/\/[^\s]+)$/;
                    if (!urlRegex.test(trimmed)) return false;
                    event.preventDefault();

                    var url = trimmed;
                    var state = view.state;
                    var tr = state.tr.replaceWith(
                        state.selection.from, state.selection.to,
                        state.schema.nodes.linkPreview.create({
                            href: url, title: '', description: '', imageSrc: '', loading: true
                        })
                    );
                    view.dispatch(tr);

                    function replaceSkeletonWithText() {
                        var foundPos = -1;
                        view.state.doc.descendants(function (node, pos) {
                            if (node.type.name === 'linkPreview' && node.attrs.href === url && node.attrs.loading) {
                                foundPos = pos;
                                return false;
                            }
                            return true;
                        });
                        if (foundPos === -1) return;
                        view.dispatch(view.state.tr.replaceWith(foundPos, foundPos + 1, view.state.schema.text(url)));
                    }

                    fetchWithTimeout(OG_WORKER_URL + encodeURIComponent(url), {}, OG_FETCH_TIMEOUT)
                        .then(function (res) { return res.json(); })
                        .then(function (data) {
                            var foundPos = -1;
                            view.state.doc.descendants(function (node, pos) {
                                if (node.type.name === 'linkPreview' && node.attrs.href === url && node.attrs.loading) {
                                    foundPos = pos;
                                    return false;
                                }
                                return true;
                            });
                            if (foundPos === -1) return;
                            if (data.error || (!data.imageSrc && (!data.title || data.title === url))) {
                                view.dispatch(view.state.tr.replaceWith(foundPos, foundPos + 1, view.state.schema.text(url)));
                                return;
                            }
                            var newNode = view.state.schema.nodes.linkPreview.create({
                                href: data.href || url,
                                title: data.title || url,
                                description: data.description || '',
                                author: data.author || '',
                                imageSrc: data.imageSrc || '',
                                loading: false,
                            });
                            view.dispatch(view.state.tr.replaceWith(foundPos, foundPos + 1, newNode));
                        })
                        .catch(function (err) {
                            if (err && err.name === 'AbortError') { replaceSkeletonWithText(); return; }
                            replaceSkeletonWithText();
                        });
                    return true;
                },
            },
        });

        const DeleteAdjacentAtom = Extension.create({
            name: 'deleteAdjacentAtom',
            addProseMirrorPlugins() {
                const BLOCK = new Set(['liteYouTube', 'liteVimeo', 'horizontalRule', 'imageUploadPlaceholder']);
                const INLINE = new Set(['image', 'emoji', 'linkPreview']);
                const isBlock = n => n && !n.isText && !n.isInline && BLOCK.has(n.type.name);
                return [new Plugin({
                    key: new PluginKey('deleteAdjacentAtom'),
                    props: {
                        handleKeyDown(view, event) {
                            const key = event.key;
                            if (key !== 'Backspace' && key !== 'Delete') return false;
                            const st = view.state;
                            const sel = st.selection;
                            if (!sel.empty) {
                                let hit = false;
                                st.doc.nodesBetween(sel.from, sel.to, n => {
                                    if (INLINE.has(n.type.name)) { hit = true; return false; }
                                    return true;
                                });
                                if (hit) { view.dispatch(st.tr.deleteSelection()); return true; }
                                return false;
                            }
                            if (sel instanceof NodeSelection) {
                                view.dispatch(st.tr.delete(sel.from, sel.to));
                                return true;
                            }
                            const $f = sel.$from;
                            if (key === 'Backspace') {
                                if ($f.parentOffset > 0) {
                                    const nb = $f.nodeBefore;
                                    if (nb && INLINE.has(nb.type.name)) {
                                        view.dispatch(st.tr.delete($f.pos - nb.nodeSize, $f.pos));
                                        return true;
                                    }
                                }
                                if ($f.parentOffset !== 0 || $f.depth === 0) return false;
                                const bs = $f.before($f.depth);
                                const nbBlock = st.doc.resolve(bs).nodeBefore;
                                if (!isBlock(nbBlock)) return false;
                                view.dispatch(st.tr.delete(bs - nbBlock.nodeSize, bs));
                                return true;
                            }
                            if ($f.parentOffset < $f.parent.content.size) {
                                const na = $f.nodeAfter;
                                if (na && INLINE.has(na.type.name)) {
                                    view.dispatch(st.tr.delete($f.pos, $f.pos + na.nodeSize));
                                    return true;
                                }
                            }
                            if ($f.parentOffset !== $f.parent.content.size) return false;
                            const be = $f.after($f.depth);
                            const naBlock = st.doc.resolve(be).nodeAfter;
                            if (!isBlock(naBlock)) return false;
                            view.dispatch(st.tr.delete(be, be + naBlock.nodeSize));
                            return true;
                        }
                    }
                })];
            }
        });

        const TrailingEmbedParagraph = Extension.create({
            name: 'trailingEmbedParagraph',
            addProseMirrorPlugins() {
                return [new Plugin({
                    key: new PluginKey('trailingEmbedParagraph'),
                    appendTransaction(trs, old, nw) {
                        if (!trs.some(t => t.docChanged)) return null;
                        const last = nw.doc.lastChild;
                        if (!last) return null;
                        const name = last.type.name;
                        if (name !== 'liteYouTube' && name !== 'liteVimeo' && name !== 'imageUploadPlaceholder') return null;
                        const p = nw.schema.nodes.paragraph.create();
                        const tr = nw.tr.insert(nw.doc.content.size, p);
                        tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
                        return tr;
                    }
                })];
            }
        });

        // -------------------------------------------------------------------
        // InlineAtomSelectionHighlight — Safely highlights images and emojis
        // when they are part of a text selection.
        // -------------------------------------------------------------------
        const InlineAtomSelectionHighlight = Extension.create({
            name: 'inlineAtomSelectionHighlight',
            addProseMirrorPlugins() {
                return [new Plugin({
                    key: new PluginKey('inlineAtomSelectionHighlight'),
                    props: {
                        decorations(state) {
                            const { from, to, empty } = state.selection;
                            if (empty) return null; 
                            
                            const decos = [];
                            state.doc.nodesBetween(from, to, (node, pos) => {
                                if (node.type.name === 'emoji' || node.type.name === 'image') {
                                    decos.push(Decoration.node(pos, pos + node.nodeSize, {
                                        class: 'atom-in-selection'
                                    }));
                                }
                            });
                            return decos.length ? DecorationSet.create(state.doc, decos) : null;
                        }
                    }
                })];
            }
        });

        // -------------------------------------------------------------------
        // ForceImageSelection — Bypasses the browser's native text-selection
        // engine to allow right-to-left dragging across images.
        // -------------------------------------------------------------------
                const ForceImageSelection = Extension.create({
            name: 'forceImageSelection',
            addProseMirrorPlugins() {
                let isDragging = false;
                let anchorPos = null;

                return [new Plugin({
                    key: new PluginKey('forceImageSelection'),
                    props: {
                        handleDOMEvents: {
                            mousedown(view, event) {
                                if (event.button === 0) {
                                    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
                                    if (coords) {
                                        isDragging = true;
                                        anchorPos = coords.pos;
                                        view.dom.classList.add('is-dragging-text'); // <--- Add class
                                    }
                                }
                                return false;
                            },
                                                        mousemove(view, event) {
                                if (!isDragging || anchorPos === null) return false;
                                if (event.buttons !== 1) {
                                    isDragging = false;
                                    anchorPos = null;
                                    view.dom.classList.remove('is-dragging-text');
                                    return false;
                                }

                                const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
                                if (!coords) return false;

                                const headPos = coords.pos;
                                const start = Math.min(anchorPos, headPos);
                                const end = Math.max(anchorPos, headPos);

                                let hasImage = false;
                                view.state.doc.nodesBetween(start, end, (node) => {
                                    if (node.type.name === 'image' || node.type.name === 'emoji') {
                                        hasImage = true;
                                        return false;
                                    }
                                });

                                if (hasImage) {
                                    const { selection } = view.state;
                                    if (selection.from !== start || selection.to !== end) {
                                        try {
                                            const $anchor = view.state.doc.resolve(start);
                                            const $head = view.state.doc.resolve(end);
                                            
                                            // Use .between() to safely clamp to inline text nodes
                                            const newSelection = TextSelection.between($anchor, $head);
                                            
                                            if (newSelection) {
                                                view.dispatch(view.state.tr.setSelection(newSelection));
                                            }
                                        } catch (err) {
                                            // Silently ignore if the positions are completely invalid
                                        }
                                    }
                                }
                                return false;
                            },
                            mouseup(view) {
                                isDragging = false;
                                anchorPos = null;
                                view.dom.classList.remove('is-dragging-text'); // <--- Remove class
                                return false;
                            },
                            mouseleave(view) {
                                // Failsafe in case the mouse leaves the window while dragging
                                isDragging = false;
                                anchorPos = null;
                                view.dom.classList.remove('is-dragging-text');
                                return false;
                            }
                        }
                    }
                })];
            }
        });

        var initialHtml = ensureTrailingParagraphInHtml(opts.initialHtml || '');

        var editor = new Editor({
            element: editorEl,
            extensions: [
                StarterKit.configure({ codeBlock: false, blockquote: false }),
                CustomBlockquote,
                CustomCodeBlock,
                Placeholder.configure({
                    placeholder: ({ node }) => {
                        if (node.type.name === 'heading') return 'Heading…';
                        if (node.type.name === 'codeBlock') return '';
                        return opts.placeholder || 'Write your message…';
                    }
                }),
                Underline, CustomImage, ImageUploadPlaceholder, Emoji,
                Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
                LiteYouTube, LiteVimeo, Spoiler, NSFW, LinkPreview, SemanticColor, CustomMention,
                EmoticonRule, UnicodeEmojiRule,
                TrailingEmbedParagraph, DeleteAdjacentAtom, 
                InlineAtomSelectionHighlight, 
                ForceImageSelection,
                CharacterCount.configure({ limit: MAX_MESSAGE_LENGTH > 0 ? MAX_MESSAGE_LENGTH : null }),
                Typography
            ],
            content: initialHtml,
            editorProps: {
                attributes: { class: 'modern-wysiwyg-content', 'aria-label': 'Message body' },
                plugins: [linkPreviewPlugin],
                transformPastedHTML: function (html) {
                    if (!html || typeof html !== 'string') return html;
                    if (html.indexOf('&nbsp') === -1 &&
                        html.indexOf('&#160') === -1 &&
                        html.indexOf('\u00a0') === -1) {
                        return html;
                    }
                    return html
                        .replace(/&nbsp;?|&#160;|&#xA0;/gi, ' ')
                        .replace(/\u00a0/g, ' ')
                        .replace(/ {2,}/g, ' ');
                },
                handlePaste: function (view, event) {
                    var files = event.clipboardData ? event.clipboardData.files : null;
                    if (files && files.length) {
                        var imgs = Array.prototype.slice.call(files).filter(function (f) { return f.type && f.type.indexOf('image/') === 0; });
                        if (imgs.length) { event.preventDefault(); imgs.forEach(function (f) { uploadImageToWorker(f); }); return true; }
                    }

                    if (view.state.selection.empty) {
                        var $from = view.state.selection.$from;
                        var codeMarkType = view.state.schema.marks.code;
                        var hasCode = codeMarkType && codeMarkType.isInSet($from.marks());
                        if (hasCode) {
                            var pasteText = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                            if (pasteText && pasteText.length > 0) {
                                event.preventDefault();
                                var collapsed = pasteText.replace(/\s+/g, ' ').trim();
                                if (collapsed) view.dispatch(view.state.tr.insertText(collapsed));
                                return true;
                            }
                        }
                    }

                    if (event.shiftKey) {
                        var t = event.clipboardData.getData('text/plain');
                        if (t) { event.preventDefault(); view.dispatch(view.state.tr.insertText(t)); return true; }
                    }

                    if (view.state.selection.empty) {
                        var txt = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
                        if (txt) {
                            var url = txt.trim();
                            if (/^https?:\/\/\S+$/.test(url) && isImageUrl(url)) {
                                event.preventDefault();
                                var img = new Image();
                                img.onload = function () {
                                    editorRef.current.chain().focus().insertContent({
                                        type: 'image', attrs: { src: url, alt: 'image', loading: 'lazy', decoding: 'async', width: this.naturalWidth, height: this.naturalHeight }
                                    }).run();
                                };
                                img.onerror = function () {
                                    editorRef.current.chain().focus().insertContent({
                                        type: 'image', attrs: { src: url, alt: 'image', loading: 'lazy', decoding: 'async' }
                                    }).run();
                                };
                                img.src = url;
                                return true;
                            }
                        }
                    }

                    var clipboard = event.clipboardData;
                    if (clipboard) {
                        var htmlData = clipboard.getData('text/html');
                        if (htmlData && htmlData.indexOf('<iframe') !== -1) {
                            var srcMatch = htmlData.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                            var iframeSrc = srcMatch ? srcMatch[1].replace(/&amp;/g, '&') : '';
                            if (iframeSrc) {
                                var ytFromIframe = parseYouTubeUrl(iframeSrc);
                                if (ytFromIframe) {
                                    event.preventDefault();
                                    insertLiteEmbed('liteYouTube', ytFromIframe.videoid, { start: ytFromIframe.start, end: ytFromIframe.end });
                                    return true;
                                }
                                var vmFromIframe = parseVimeoUrl(iframeSrc);
                                if (vmFromIframe) {
                                    event.preventDefault();
                                    insertLiteEmbed('liteVimeo', vmFromIframe.videoid, { start: vmFromIframe.start });
                                    return true;
                                }
                            }
                        }

                        var textData = clipboard.getData('text/plain');
                        if (textData) {
                            var candidate = textData.trim();
                            if (/^https?:\/\/\S+$/.test(candidate)) {
                                var yt = parseYouTubeUrl(candidate);
                                if (yt) {
                                    event.preventDefault();
                                    insertLiteEmbed('liteYouTube', yt.videoid, { start: yt.start, end: yt.end });
                                    return true;
                                }
                                var vm = parseVimeoUrl(candidate);
                                if (vm) {
                                    event.preventDefault();
                                    insertLiteEmbed('liteVimeo', vm.videoid, { start: vm.start });
                                    return true;
                                }
                            }
                        }
                    }

                    return false;
                },
                handleDOMEvents: {
                    keydown: function (view, event) {
                        var mod = event.ctrlKey || event.metaKey;
                        if (mod && event.key === 'Enter') {
                            event.preventDefault();
                            if (submitBtn && !submitBtn.disabled) submitBtn.click();
                            return true;
                        }
                        if (mod && !event.shiftKey && (event.key === 'k' || event.key === 'K')) { event.preventDefault(); linkBtn.click(); return true; }
                        if (mod && !event.shiftKey && (event.key === 'e' || event.key === 'E')) { event.preventDefault(); editor.chain().focus().toggleCode().run(); return true; }
                        if (event.ctrlKey && event.shiftKey && (event.key === 's' || event.key === 'S')) { event.preventDefault(); spoilerBtn.click(); return true; }
                        if (event.ctrlKey && event.shiftKey && (event.key === 'n' || event.key === 'N')) { event.preventDefault(); nsfwBtn.click(); return true; }
                        return false;
                    }
                }
            },
            onCreate: function ({ editor }) {
                (function ensureTrailingParagraph() {
                    var doc = editor.state.doc;
                    var last = doc.lastChild;
                    if (!last) return;
                    var n = last.type.name;
                    if (n !== 'liteYouTube' && n !== 'liteVimeo' && n !== 'imageUploadPlaceholder') return;
                    var p = editor.schema.nodes.paragraph.create();
                    var tr = editor.state.tr.insert(doc.content.size, p);
                    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size - 1)));
                    editor.view.dispatch(tr);
                })();

                if (opts.mode === 'reply') return;

                if (opts.mode === 'fastedit') {
                    setTimeout(function () {
                        if (editor && !editor.isDestroyed && !editor.isFocused) {
                            editor.commands.focus('end');
                        }
                    }, 50);
                    return;
                }

                if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
                var a = document.activeElement;
                if (a && a !== document.body && a !== document.documentElement) return;
                editor.commands.focus('end');
            },
            onUpdate: function ({ editor }) {
                var html = editor.getHTML();
                var legacy = editorContentIsEmpty(html) ? '' : htmlToLegacy(html);
                if (opts.onSync) opts.onSync(legacy);
                updateSendState();
                scheduleLivePreviewRefresh();
            }
        });

        editorRef.current = editor;

        var _origViewUpdateState = editor.view.updateState.bind(editor.view);
        editor.view.updateState = function (state) {
            try {
                _origViewUpdateState(state);
            } catch (err) {
                var errMsg = String((err && err.message) || '');
                if (errMsg.indexOf('localsInner') !== -1) {
                    if (!editor.__localsInnerLogged) {
                        console.warn('[EditorModule] Transient rendering glitch (localsInner) — ignoring, no rebuild:', err);
                        editor.__localsInnerLogged = true;
                    }
                    return;
                }
                console.error('[EditorModule] view.updateState crashed — scheduling rebuild:', err);
                scheduleEditorRebuild();
            }
        };

        var _origViewDispatch = editor.view.dispatch.bind(editor.view);
        editor.view.dispatch = function (tr) {
            try {
                var focusMeta = typeof tr.getMeta === 'function' && tr.getMeta('focus');
                if (focusMeta && tr.steps && tr.steps.length === 0) {
                    return;
                }
            } catch (e) {}
            try {
                _origViewDispatch(tr);
            } catch (err) {
                console.error('[EditorModule] view.dispatch crashed — scheduling rebuild:', err);
                scheduleEditorRebuild();
            }
        };

        var _lastNonEmptyCount = countNonEmptyContainers(editor.state.doc);

        editor.on('update', function () {
            var newCount = countNonEmptyContainers(editor.state.doc);
            var oldCount = _lastNonEmptyCount;
            _lastNonEmptyCount = newCount;

            if (newCount < oldCount) {
                setTimeout(function () {
                    if (!editorRef.current || editorRef.current.isDestroyed) return;
                    removeEmptyContainers();
                }, 0);
            }
        });

        var _healPending = false;
        function healViewDesync() {
            if (_healPending) return;
            if (!editor || editor.isDestroyed || !editor.view) return;
            var dom = editor.view.dom;
            if (!dom || !dom.isConnected) return;
            if (dom.childElementCount > 0) return;

            _healPending = true;
            requestAnimationFrame(function () {
                _healPending = false;
                if (!editor || editor.isDestroyed || !editor.view) return;
                var dom2 = editor.view.dom;
                if (!dom2 || !dom2.isConnected) return;
                if (dom2.childElementCount > 0) return;

                var stateHasContent = false;
                editor.state.doc.forEach(function (node) {
                    if (node.textContent.trim()) { stateHasContent = true; return; }
                    var nm = node.type.name;
                    if (nm === 'image' || nm === 'emoji' || nm === 'liteYouTube' || nm === 'liteVimeo' ||
    nm === 'linkPreview' || nm === 'imageUploadPlaceholder' || nm === 'horizontalRule') {
    hasContent = true;
}
                });
                if (!stateHasContent) return;

                console.warn('[EditorModule] View desync detected — scheduling rebuild.');
                scheduleEditorRebuild();
            });
        }
        editor.on('transaction', function (tr) { if (tr.docChanged) healViewDesync(); });
        setTimeout(healViewDesync, 0);

        function updateActive() {
            undoBtn.disabled = !editor.can().undo();
            redoBtn.disabled = !editor.can().redo();
            boldBtn.classList.toggle('active', editor.isActive('bold'));
            italicBtn.classList.toggle('active', editor.isActive('italic'));
            underlineBtn.classList.toggle('active', editor.isActive('underline'));
            strikeBtn.classList.toggle('active', editor.isActive('strike'));
            blockquoteBtn.classList.toggle('active', editor.isActive('blockquote'));
            codeBtn.classList.toggle('active', editor.isActive('code') || editor.isActive('codeBlock'));
            spoilerBtn.classList.toggle('active', editor.isActive('spoiler'));
            nsfwBtn.classList.toggle('active', editor.isActive('nsfw'));
            linkBtn.classList.toggle('active', editor.isActive('link'));
            var hOn = editor.isActive('heading', { level: 1 }) || editor.isActive('heading', { level: 2 }) || editor.isActive('heading', { level: 3 });
            headBtn.style.backgroundColor = hOn ? 'var(--primary-color)' : '';
            headBtn.style.color = hOn ? 'white' : '';
        }
        editor.on('selectionUpdate', updateActive);
        editor.on('transaction', updateActive);
        updateActive();

        var editorRoot = editorEl.querySelector('.ProseMirror');
        if (editorRoot) {
            editorRoot.setAttribute('dropzone', 'copy');
            editorRoot.addEventListener('dragover', function (e) { e.preventDefault(); });
            editorRoot.addEventListener('drop', function (e) {
                e.preventDefault();
                var f = e.dataTransfer.files[0];
                if (f && f.type.startsWith('image/')) uploadImageToWorker(f);
            });
            setupImageToolbar(editorRoot, editor);
            setupSpoilerTitleEdit(editorRoot, editor);
            setupEmoticonAutocomplete(editor, editorRoot);
        }

        function setupImageToolbar(root, ed) {
            var scrollContainer = root.parentNode;

            var toolbarEl = document.createElement('div');
            toolbarEl.className = 'editor-image-toolbar';
            toolbarEl.style.display = 'none';

            var nsfwB = document.createElement('button');
            nsfwB.type = 'button'; nsfwB.className = 'editor-image-nsfw-btn';
            nsfwB.innerHTML = '<i class="fa-regular fa-eye-slash" aria-hidden="true"></i>';
            nsfwB.title = 'Mark as NSFW'; nsfwB.setAttribute('aria-label', 'Toggle NSFW');

            var editB = document.createElement('button');
            editB.type = 'button'; editB.className = 'editor-image-edit-btn';
            editB.innerHTML = '<i class="fa-regular fa-pen" aria-hidden="true"></i>';
            editB.title = 'Edit image'; editB.setAttribute('aria-label', 'Edit image');

            var delB = document.createElement('button');
            delB.type = 'button'; delB.className = 'editor-image-delete-btn';
            delB.innerHTML = '<i class="fa-regular fa-trash-can" aria-hidden="true"></i>';
            delB.title = 'Delete image'; delB.setAttribute('aria-label', 'Delete image');

            toolbarEl.appendChild(nsfwB); toolbarEl.appendChild(editB); toolbarEl.appendChild(delB);

            scrollContainer.appendChild(toolbarEl);

            [nsfwB, editB, delB].forEach(function (b) { b.addEventListener('mousedown', function (e) { e.preventDefault(); }); });

            var hovered = null;
            var hideTimer = null;

            function isEligible(img) {
    if (!img) return false;
    if (img.classList.contains('twemoji')) return false;
    if (img.classList.contains('ProseMirror-separator')) return false;
    var src = img.getAttribute('src') || '';
    if (!src) return false;
    if (src.indexOf('twemoji') !== -1) return false;
    var alt = img.getAttribute('alt') || '';
    if (alt.startsWith(':') && alt.endsWith(':')) return false;
    if (img.closest('.link-preview-card, .simple-link, .modern-embedded-link')) return false;
    if (img.closest('.ff-upload-placeholder')) return false;
    return true;
}

            function position(img) {
                var r = img.getBoundingClientRect();
                var rootRect = scrollContainer.getBoundingClientRect();
                var w = toolbarEl.offsetWidth || 108;
                var h = toolbarEl.offsetHeight || 32;

                var top = (r.top - rootRect.top) + scrollContainer.scrollTop + 6;
                var left = (r.right - rootRect.left) + scrollContainer.scrollLeft - w - 8;

                toolbarEl.style.top = Math.max(4, top) + 'px';
                toolbarEl.style.left = Math.max(4, left) + 'px';
            }

            function show(img) {
                if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
                hovered = img;
                var isN = img.getAttribute('data-nsfw') === 'true';
                nsfwB.classList.toggle('is-active', isN);
                toolbarEl.style.display = 'flex';
                position(img);
            }

            function hide() {
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(function () { toolbarEl.style.display = 'none'; hovered = null; }, 120);
            }

            function resolve(img) {
                if (!img) return null;
                var view = ed.view;
                var pos;
                try { pos = view.posAtDOM(img, 0); } catch (e) { return null; }
                var $pos = view.state.doc.resolve(pos);
                if ($pos.nodeAfter && $pos.nodeAfter.type.name === 'image') return { node: $pos.nodeAfter, pos: pos };
                if ($pos.nodeBefore && $pos.nodeBefore.type.name === 'image') return { node: $pos.nodeBefore, pos: pos - $pos.nodeBefore.nodeSize };
                return null;
            }

            root.addEventListener('mouseover', function (e) {
                var img = e.target.closest('img');
                if (isEligible(img)) show(img);
            });
            root.addEventListener('click', function (e) {
                var img = e.target.closest('img');
                if (!isEligible(img)) return;
                show(img);
                if (hideTimer) clearTimeout(hideTimer);
                hideTimer = setTimeout(function () { if (!toolbarEl.matches(':hover')) { toolbarEl.style.display = 'none'; hovered = null; } }, 4000);
            });
            root.addEventListener('mouseout', function (e) {
                var img = e.target.closest('img');
                if (!img || img !== hovered) return;
                if (toolbarEl.contains(e.relatedTarget)) return;
                var next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('img');
                if (next === img) return;
                hide();
            });
            toolbarEl.addEventListener('mouseenter', function () { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
            toolbarEl.addEventListener('mouseleave', function () { if (hovered) hide(); });

            nsfwB.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (!hovered) return;
                var r = resolve(hovered); if (!r) return;
                ed.view.dispatch(ed.view.state.tr.setNodeMarkup(r.pos, undefined, Object.assign({}, r.node.attrs, { nsfw: !r.node.attrs.nsfw })));
                toolbarEl.style.display = 'none'; hovered = null;
            });
            editB.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (!hovered) return;
                var r = resolve(hovered); if (!r) return;
                showImageEditModal(r.node.attrs.alt || '', r.node.attrs.size || null, function (alt, size) {
                    ed.view.dispatch(ed.view.state.tr.setNodeMarkup(r.pos, undefined, Object.assign({}, r.node.attrs, { alt: alt || 'image', size: size })));
                }, ed);
                toolbarEl.style.display = 'none'; hovered = null;
            });
            delB.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (!hovered) return;
                var r = resolve(hovered); if (!r) return;
                ed.view.dispatch(ed.view.state.tr.delete(r.pos, r.pos + r.node.nodeSize));
                toolbarEl.style.display = 'none'; hovered = null;
            });

            ed.on('transaction', function () {
                if (!hovered) return;
                if (!document.body.contains(hovered)) { if (hideTimer) clearTimeout(hideTimer); toolbarEl.style.display = 'none'; hovered = null; }
            });
            ed.on('blur', function () { toolbarEl.style.display = 'none'; hovered = null; });
        }

        function setupSpoilerTitleEdit(root, ed) {
            root.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                var spoiler = e.target.closest('div.spoiler');
                if (!spoiler) return;
                var rect = spoiler.getBoundingClientRect();
                if ((e.clientY - rect.top) > 60) return;
                e.preventDefault(); e.stopPropagation();
                var pos;
                try { pos = ed.view.posAtDOM(spoiler, 0); } catch (err) { return; }
                var $pos = ed.state.doc.resolve(pos);
                var spPos = null;
                for (var d = $pos.depth; d > 0; d--) {
                    if ($pos.node(d).type.name === 'spoiler') { spPos = $pos.before(d); break; }
                }
                if (spPos === null) return;
                var node = ed.state.doc.nodeAt(spPos);
                if (!node) return;
                showSpoilerTitleModal(node.attrs.title || '', function (title) {
                    ed.view.dispatch(ed.state.tr.setNodeMarkup(spPos, undefined, Object.assign({}, node.attrs, { title: title || null })));
                }, ed);
            }, true);
        }

        function setupEmoticonAutocomplete(ed, root) {
            var popup = null, items = [], sel = 0, itemEls = [], query = '';

            function close() {
                if (popup) { popup.remove(); popup = null; }
                items = []; itemEls = []; sel = 0; query = '';
            }
            function ensurePopup() {
                if (!popup) {
                    popup = document.createElement('div');
                    popup.className = 'mention-suggestions emoticon-suggestions';
                    popup.setAttribute('role', 'listbox');
                    document.body.appendChild(popup);
                }
                return popup;
            }
            function positionPopup() {
                if (!popup) return;
                try {
                    var c = ed.view.coordsAtPos(ed.state.selection.from);
                    popup.style.left = (c.left + window.pageXOffset) + 'px';
                    popup.style.top = (c.bottom + window.pageYOffset + 4) + 'px';
                } catch (e) {}
            }
            function updateSel() { itemEls.forEach(function (el, i) { el.classList.toggle('is-selected', i === sel); }); }
            function build() {
                if (!popup) return;
                popup.innerHTML = '';
                itemEls = [];
                items.forEach(function (item) {
                    var el = document.createElement('button');
                    el.type = 'button'; el.className = 'mention-suggestion-item'; el.setAttribute('role', 'option');
                    var img = document.createElement('img');
                    img.className = 'emoticon-suggestion-icon';
                    img.src = TWEMOJI_BASE + emojiToCodePoint(item.emoji) + '.svg';
                    img.alt = item.emoji; img.loading = 'lazy';
                    img.onerror = function () { var s = document.createElement('span'); s.className = 'emoticon-suggestion-icon'; s.textContent = item.emoji; this.replaceWith(s); };
                    el.appendChild(img);
                    var lbl = document.createElement('span');
                    lbl.className = 'mention-suggestion-name';
                    lbl.textContent = ':' + item.name;
                    el.appendChild(lbl);
                    el.addEventListener('mousedown', function (e) { e.preventDefault(); commit(item); });
                    itemEls.push(el); popup.appendChild(el);
                });
                popup.style.display = 'block';
                updateSel();
            }
            function trigger() {
                var s = ed.state.selection;
                if (!s || !s.empty) return null;
                var from = s.from;
                var start = Math.max(0, from - 80);
                var text = ed.state.doc.textBetween(start, from, '\n', '\uFFFC');
                var m = text.match(/(^|\s):([a-zA-Z0-9_+\-]*)$/);
                return m ? { query: m[2] } : null;
            }
            function refresh() {
                var t = trigger();
                if (!t) { close(); return; }
                var q = t.query.toLowerCase();
                var matches = [];
                Object.keys(EMOJI_NAME_MAP).forEach(function (n) {
                    if (n.indexOf(q) === 0) matches.push({ name: n, emoji: EMOJI_NAME_MAP[n] });
                });
                if (matches.length === 0) { close(); return; }
                matches.sort(function (a, b) {
                    var ae = a.name === q ? 0 : 1;
                    var be = b.name === q ? 0 : 1;
                    if (ae !== be) return ae - be;
                    return a.name.localeCompare(b.name);
                });
                items = matches.slice(0, 25); sel = 0; query = t.query;
                ensurePopup(); build(); positionPopup();
            }
            function commit(item) {
                if (!item) return;
                var from = ed.state.selection.from;
                var triggerStart = from - query.length - 1;
                var cp = emojiToCodePoint(item.emoji);
                ed.chain().focus().deleteRange({ from: triggerStart, to: from }).insertContent({
                    type: 'emoji',
                    attrs: { src: TWEMOJI_BASE + cp + '.svg', alt: item.emoji, loading: 'lazy', decoding: 'async', width: 24, height: 24 }
                }).run();
                pushEmojiRecent(item.emoji);
                close();
            }
            root.addEventListener('keydown', function (e) {
                if (!popup) return;
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
                if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); sel = (sel + 1) % items.length; updateSel(); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); sel = (sel - 1 + items.length) % items.length; updateSel(); return; }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); commit(items[sel]); return; }
                if (e.key === ' ') close();
            }, true);
            ed.on('update', refresh);
            ed.on('selectionUpdate', refresh);
            ed.on('blur', function () {
                setTimeout(function () {
                    if (document.activeElement !== root && !(popup && popup.contains(document.activeElement))) close();
                }, 0);
            });
        }

        function updateSendState() {
    if (!submitBtn) return;
    if (submitBtn.hasAttribute('data-saving')) {
        submitBtn.disabled = true;
        return;
    }

    var empty = editorContentIsEmpty(editor.getHTML());
    var hasPlaceholder = false;
    editor.state.doc.descendants(function (n) {
        if (n.type.name === 'imageUploadPlaceholder') { hasPlaceholder = true; return false; }
        return true;
    });

    // Send: needs content AND no pending image placeholders.
    // A placeholder marks an image that was intended but hasn't arrived;
    // sending would drop it silently.
    var sendReady = !empty && !hasPlaceholder;
    submitBtn.disabled = !sendReady;
    submitBtn.setAttribute('aria-disabled', String(!sendReady));
    if (sendReady) {
        submitBtn.removeAttribute('title');
    } else {
        submitBtn.setAttribute('title', hasPlaceholder
            ? 'Finish or remove the image placeholder'
            : 'Write something before submitting');
    }

    // Preview: needs content only. Placeholders don't block — the
    // preview renderer already skips re-rendering while a placeholder
    // is present (see updateLivePreview's hasPlaceholder check), so
    // letting the user open the pane is safe; it just shows whatever
    // was last rendered.
    if (previewBtn) {
        var previewReady = !empty;
        previewBtn.disabled = !previewReady;
        previewBtn.setAttribute('aria-disabled', String(!previewReady));
        if (previewReady) {
            previewBtn.removeAttribute('title');
        } else {
            previewBtn.setAttribute('title', 'Write something to preview it');
        }
    }

    // Auto-hide the preview when the editor becomes empty — matches
    // the messenger. Without this, a preview rendered from content
    // that was subsequently deleted stays visible, showing text that
    // no longer exists in the editor.
    if (empty && previewArea && previewArea.style.display !== 'none') {
        previewArea.style.display = 'none';
    }
}

        previewBtn.onclick = function () {
            if (!editorRef.current || editorContentIsEmpty(editorRef.current.getHTML())) return;
            previewArea.style.display = 'block';
            updateLivePreview();
            previewArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };

        submitBtn.onclick = function (e) {
            e.preventDefault();
            if (!editorRef.current) return;
            if (editorContentIsEmpty(editorRef.current.getHTML())) return;
            var legacy = htmlToLegacy(editorRef.current.getHTML());
            if (opts.onSync) opts.onSync(legacy);
            var sig = document.getElementById('enablesig');
            var trk = document.getElementById('track_topic');
            if (sig) sig.checked = true;
            if (trk) trk.checked = true;
            if (opts.onSubmit) opts.onSubmit();
        };

        if (cancelBtn) {
            cancelBtn.onclick = function (e) {
                e.preventDefault();
                if (editorRef.current) {
                    editorRef.current.destroy();
                    editorRef.current = null;
                }
                if (opts.onCancel) opts.onCancel();
            };
        }

        updateSendState();

        host.__editorInstance = editor;
        host.__editorSync = function () {
            if (editor) {
                var legacy = htmlToLegacy(editor.getHTML());
                if (opts.onSync) opts.onSync(legacy);
            }
        };
        host.__editorDestroy = function () {
            if (editor) {
                try { editor.destroy(); } catch (e) {}
            }
        };
    }

    function ensureToastContainer() {
        var c = document.getElementById('editor-toasts');
        if (!c) {
            c = document.createElement('div');
            c.id = 'editor-toasts';
            c.setAttribute('aria-live', 'polite');
            c.style.cssText = 'position:fixed;bottom:var(--space-lg);right:var(--space-lg);z-index:100000;display:flex;flex-direction:column;gap:var(--space-xs);pointer-events:none;';
            document.body.appendChild(c);
        }
        return c;
    }

    function showToast(msg, type) {
        type = type || 'info';
        var color = 'var(--success-color)';
        var icon = 'fa-regular fa-circle-check';
        if (type === 'error') { color = 'var(--danger-color)'; icon = 'fa-regular fa-circle-exclamation'; }
        else if (type === 'warning') { color = 'var(--warning-color)'; icon = 'fa-regular fa-triangle-exclamation'; }

        var t = document.createElement('div');
        t.setAttribute('role', 'status');
        t.style.cssText = 'display:flex;align-items:center;gap:var(--space-sm);padding:var(--pad-3) var(--pad-5);background:var(--surface-color);color:var(--text-primary);border:1px solid var(--border-color);border-left-width:3px;border-left-color:' + color + ';border-radius:var(--radius);box-shadow:var(--shadow-lg);font-family:var(--font-primary);font-size:var(--text-sm);max-width:360px;pointer-events:auto;opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;';
        t.innerHTML = '<i class="' + icon + '" aria-hidden="true" style="color:' + color + ';"></i><span style="flex:1;">' + escapeHtml(msg) + '</span>';
        ensureToastContainer().appendChild(t);
        requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
        setTimeout(function () {
            t.style.opacity = '0'; t.style.transform = 'translateY(8px)';
            setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
        }, 3000);
    }

    async function buildFastReplyEditor() {
        var legacySend = document.querySelector('.fast.send');
        if (!legacySend) return;
        if (document.getElementById('modern-editor-fastreply')) return;

        var legacyPost = document.getElementById('Post');
        var legacyForm = window.REPLIER || (legacyPost ? legacyPost.form : null);
        var legacySubmit = document.querySelector('input[name="sub-mit"]');

        var legacyHtml = legacyPost ? legacyPost.value : '';

        var draftKey = null;
        if (legacyPost) {
            var onkeyup = legacyPost.getAttribute('onkeyup') || '';
            var dm = onkeyup.match(/localStorage\.setItem\(['"]([^'"]+)['"]/);
            if (dm) draftKey = dm[1];
        }

        function persistDraft(legacy) {
            if (!draftKey) return;
            try {
                var trimmed = (legacy || '').trim();
                if (trimmed) localStorage.setItem(draftKey, trimmed);
                else localStorage.removeItem(draftKey);
            } catch (e) {}
        }

        var container = document.createElement('div');
        container.id = 'modern-editor-fastreply';
        container.className = 'modern-editor-container modern-editor-container--reply';

        var insertAfter = document.getElementById('modern-pagination');
        var wrapper = document.getElementById('modern-forum-wrapper');

        if (insertAfter && insertAfter.parentNode) {
            insertAfter.parentNode.insertBefore(container, insertAfter.nextSibling);
        } else if (wrapper) {
            wrapper.appendChild(container);
        } else {
            document.body.appendChild(container);
        }

        var anchorEl = document.getElementById('fastreply');
        if (anchorEl) {
            var anchorNode = (anchorEl.parentElement && anchorEl.parentElement.classList.contains('anchor'))
                ? anchorEl.parentElement
                : anchorEl;
            container.parentNode.insertBefore(anchorNode, container);
        }

        try {
            await buildEditorInto(container, {
                mode: 'reply',
                initialHtml: await legacyToHtmlAsync(legacyHtml),
                placeholder: 'Write your reply…',
                headerLabel: 'Replying as:',
                submitLabel: 'Post reply',
                onSync: function (legacy) {
                    if (legacyPost) legacyPost.value = legacy;
                    persistDraft(legacy);
                },
                onSubmit: function () {
                    var sig = document.getElementById('enablesig');
                    var trk = document.getElementById('track_topic');
                    if (sig) sig.checked = true;
                    if (trk) trk.checked = true;
                    if (legacySubmit) legacySubmit.disabled = false;
                    if (legacyForm && legacyForm instanceof HTMLFormElement) {
                        try { HTMLFormElement.prototype.submit.call(legacyForm); }
                        catch (e) { legacyForm.submit(); }
                    } else if (legacySubmit) {
                        legacySubmit.click();
                    }
                }
            });

            if (window.location.hash === '#fastreply') {
                setTimeout(function () {
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }

            console.log('[EditorModule] Fast reply editor built');
        } catch (err) {
            console.error('[EditorModule] Fast reply build failed:', err);
            container.innerHTML = '<div style="color:red;padding:1rem;">Editor failed to load. <button onclick="location.reload()">Reload</button></div>';
        }
    }

    async function buildFullEditor() {
        var legacySend = document.querySelector('.send');
        if (!legacySend) return;
        if (document.getElementById('modern-editor-full')) return;

        var legacyPost = document.getElementById('Post');
        var legacyForm = window.REPLIER || (legacyPost ? legacyPost.form : null);
        var legacySubmit = document.querySelector('input[name="submit_post"]');

        var legacyHtml = legacyPost ? legacyPost.value : '';

        var container = document.createElement('div');
        container.id = 'modern-editor-full';
        container.className = 'modern-editor-container modern-editor-container--full';

        var summary = document.getElementById('modern-summary-container');
        var wrapper = document.getElementById('modern-forum-wrapper');

        if (summary && summary.parentNode) {
            summary.parentNode.insertBefore(container, summary);
        } else if (wrapper) {
            wrapper.appendChild(container);
        } else {
            document.body.appendChild(container);
        }

        var sig = document.getElementById('enablesig');
        var trk = document.getElementById('track_topic');
        if (sig) sig.checked = true;
        if (trk) trk.checked = true;

        try {
            await buildEditorInto(container, {
                mode: 'full',
                initialHtml: await legacyToHtmlAsync(legacyHtml),
                placeholder: 'Write your post…',
                headerLabel: 'Writing as:',
                submitLabel: 'Submit post',
                onSync: function (legacy) { if (legacyPost) legacyPost.value = legacy; },
                onSubmit: function () {
                    var s2 = document.getElementById('enablesig');
                    var t2 = document.getElementById('track_topic');
                    if (s2) s2.checked = true;
                    if (t2) t2.checked = true;
                    if (legacySubmit) legacySubmit.disabled = false;
                    if (legacyForm && legacyForm instanceof HTMLFormElement) {
                        try { HTMLFormElement.prototype.submit.call(legacyForm); }
                        catch (e) { legacyForm.submit(); }
                    } else if (legacySubmit) {
                        legacySubmit.click();
                    }
                }
            });
            console.log('[EditorModule] Full editor built');
        } catch (err) {
            console.error('[EditorModule] Full editor build failed:', err);
            container.innerHTML = '<div style="color:red;padding:1rem;">Editor failed to load. <button onclick="location.reload()">Reload</button></div>';
        }
    }

    function findPostContent(scope) {
        if (!scope) return null;
        return scope.querySelector('.right.Item table.color') ||
               scope.querySelector('td.Item table.color') ||
               scope.querySelector('.color');
    }

    function findEditLink(postEl) {
        if (!postEl) return null;
        return postEl.querySelector('.mini_buttons > a[href*="act=Post&CODE=08"]') ||
               postEl.querySelector('a[href*="act=Post&CODE=08"]');
    }

    function cleanupFastEditEntry(entry) {
        if (!entry) return;

        if (entry.contentArea) {
            entry.contentArea.style.display = '';
            entry.contentArea = null;
        }

        var container = entry.container;
        if (container && container.parentNode) {
            if (typeof container.__editorDestroy === 'function') {
                try { container.__editorDestroy(); } catch (e) {}
            } else if (container.__editorInstance && !container.__editorInstance.isDestroyed) {
                try { container.__editorInstance.destroy(); } catch (e) {}
            }
            container.remove();
        }

        if (entry.modernCard) {
            entry.modernCard.classList.remove('is-being-edited');
            entry.modernCard.classList.remove('is-fast-editing');
        }
        if (entry.legacyPost && entry.legacyPost.classList.contains('is-being-edited')) {
            entry.legacyPost.classList.remove('is-being-edited');
        }
    }

    async function startFastEdit(postEl) {
        if (!postEl) return;

        var existing = _activeFastEdits.get(postEl);
        if (existing) {
            if (existing.state === 'active') focusFastEdit(postEl);
            return;
        }

        var postId = (postEl.id || '').replace(/^ee/, '');
        if (!postId) return;

        var others = [];
        _activeFastEdits.forEach(function (_entry, pe) {
            if (pe !== postEl) others.push(pe);
        });
        others.forEach(function (pe) { cancelFastEdit(pe); });

        var entry = {
            state: 'pending',
            controller: new AbortController(),
            container: null,
            modernCard: null,
            legacyPost: null,
            contentArea: null,
            pageCharset: null
        };
        _activeFastEdits.set(postEl, entry);

        function isStillPending() {
            return entry.state === 'pending' && _activeFastEdits.get(postEl) === entry;
        }

        var editLink = findEditLink(postEl);
        if (!editLink) {
            _activeFastEdits.delete(postEl);
            showToast('Edit link not found on this post', 'error');
            return;
        }

        var html;
        var pageCharset = 'utf-8';
        try {
            var decoded = await fetchHtmlDecoded(editLink.href, {
                credentials: 'include',
                signal: entry.controller.signal
            });
            html = decoded.text;
            pageCharset = decoded.charset;
        } catch (err) {
            _activeFastEdits.delete(postEl);
            if (err && err.name === 'AbortError') return;
            console.error('[EditorModule] Fast edit load failed:', err);
            showToast('Could not load the editor', 'error');
            return;
        }
        entry.pageCharset = pageCharset;

        if (!isStillPending()) return;

        var doc = new DOMParser().parseFromString(html, 'text/html');
        var form = doc.querySelector('form[name="REPLIER"]');
        var postArea = form && form.querySelector('#Post');
        if (!form || !postArea) {
            _activeFastEdits.delete(postEl);
            showToast('Session expired — please log in again', 'error');
            return;
        }

        var bbcode = postArea.value || '';
        var hidden = {};
        form.querySelectorAll('input[type="hidden"]').forEach(function (i) {
            if (i.name) hidden[i.name] = i.value;
        });

        var initialHtml = '';
        if (bbcode.trim()) {
            try {
                initialHtml = await legacyToHtmlAsync(bbcode);
            } catch (e) {
                console.warn('[EditorModule] legacyToHtmlAsync failed:', e);
                initialHtml = '';
            }
        }

        if (!isStillPending()) return;

        entry.modernCard = document.querySelector(
            '.post-card[data-original-id="' + postEl.id + '"]'
        );

        var container = document.createElement('div');
        container.className = 'modern-editor-container modern-editor-container--fastedit';
        entry.container = container;

        if (entry.modernCard && entry.modernCard.parentNode) {
            var contentArea = entry.modernCard.querySelector('.post-content');
            if (contentArea) {
                entry.contentArea = contentArea;
                contentArea.style.display = 'none';
                entry.modernCard.classList.add('is-fast-editing');
                contentArea.parentNode.insertBefore(container, contentArea.nextSibling);
            } else {
                entry.modernCard.classList.add('is-being-edited');
                entry.modernCard.parentNode.insertBefore(container, entry.modernCard.nextSibling);
            }
        } else {
            entry.legacyPost = postEl;
            postEl.classList.add('is-being-edited');
            postEl.parentNode.insertBefore(container, postEl.nextSibling);
        }

        try {
            await buildEditorInto(container, {
                mode: 'fastedit',
                initialHtml: initialHtml,
                placeholder: 'Edit your post…',
                hideHeader: true,
                submitLabel: 'Save changes',
                onCancel: function () {
                    _activeFastEdits.delete(postEl);
                    cleanupFastEditEntry(entry);
                },
                onSubmit: async function () {
                    var editorInst = container.__editorInstance;
                    if (!editorInst) return;

                    var submitBtn = container.querySelector('.modern-editor-submit-btn');
                    var origLabel = submitBtn ? submitBtn.innerHTML : '';
                    if (submitBtn) {
                        submitBtn.setAttribute('data-saving', '1');
                        submitBtn.disabled = true;
                        submitBtn.innerHTML = '<i class="fa-regular fa-spinner fa-spin"></i> Saving…';
                    }

                    var newBbcode = htmlToLegacy(editorInst.getHTML());

                    var body = new URLSearchParams();
                    Object.keys(hidden).forEach(function (k) {
                        body.set(k, hidden[k]);
                    });
                    body.set('act', 'Post');
                    body.set('CODE', '09');
                    body.set('Post', newBbcode);
                    body.set('enablesig', '1');

                    var saveText;
                    try {
                        var saveCharset = entry.pageCharset || 'utf-8';
                        var bodyString = buildFormBody(Array.from(body.entries()), saveCharset);
                        var saveResp = await fetch('/', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=' + saveCharset },
                            body: bodyString,
                            credentials: 'include'
                        });
                        var saveBuf = await saveResp.arrayBuffer();
                        saveText = decodeHtmlBuffer(saveBuf, saveResp.headers.get('content-type') || '').text;
                    } catch (err) {
                        if (submitBtn) {
                            submitBtn.removeAttribute('data-saving');
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = origLabel;
                        }
                        showToast('Save failed — network error', 'error');
                        return;
                    }

                    var saveDoc = new DOMParser().parseFromString(saveText, 'text/html');
                    var responsePost = saveDoc.getElementById(postEl.id);
                    var newColor = findPostContent(responsePost);
                    var liveColor = findPostContent(postEl);

                    if (!newColor || !liveColor) {
                        if (submitBtn) {
                            submitBtn.removeAttribute('data-saving');
                            submitBtn.disabled = false;
                            submitBtn.innerHTML = origLabel;
                        }
                        showToast('Save failed — please try again', 'error');
                        return;
                    }

                    liveColor.innerHTML = newColor.innerHTML;

                    _activeFastEdits.delete(postEl);
                    cleanupFastEditEntry(entry);
                    showToast('Post updated', 'success');
                    triggerPostReconversion();
                }
            });
        } catch (err) {
            console.error('[EditorModule] Fast edit build failed:', err);
            _activeFastEdits.delete(postEl);
            cleanupFastEditEntry(entry);
            showToast('Failed to load editor', 'error');
            return;
        }

        if (!isStillPending()) {
            cleanupFastEditEntry(entry);
            _activeFastEdits.delete(postEl);
            return;
        }

        entry.state = 'active';
    }

    function cancelFastEdit(postEl) {
        var entry = _activeFastEdits.get(postEl);
        if (!entry) return false;
        if (entry.controller) {
            try { entry.controller.abort(); } catch (e) {}
        }
        cleanupFastEditEntry(entry);
        _activeFastEdits.delete(postEl);
        return true;
    }

    function isFastEditActive(postEl) {
        var entry = _activeFastEdits.get(postEl);
        return !!(entry && entry.state === 'active');
    }

    function focusFastEdit(postEl) {
        var entry = _activeFastEdits.get(postEl);
        if (!entry || entry.state !== 'active') return false;
        var container = entry.container;
        if (!container || !container.__editorInstance) return false;
        try {
            container.__editorInstance.commands.focus('end');
            return true;
        } catch (e) {
            return false;
        }
    }

    function triggerPostReconversion() {
        if (typeof window.ForumPostsModule === 'undefined') return;
        try {
            window.ForumPostsModule.reset();
            window.ForumPostsModule.initialize();
            console.log('[EditorModule] Post re-conversion triggered');
        } catch (e) {
            console.warn('[EditorModule] Post re-conversion failed:', e);
        }
    }

    function startQuote(postEl) {
        _quoteQueue = _quoteQueue
            .then(function () { return doStartQuote(postEl); })
            .catch(function (err) {
                console.warn('[EditorModule] Quote queue error:', err);
            });
        return _quoteQueue;
    }

    async function doStartQuote(postEl) {
        if (!postEl) return;

        var quoteLink =
            postEl.querySelector('.mini_buttons a[href*="CODE=02"]') ||
            postEl.querySelector('a[href*="CODE=02"]');

        if (!quoteLink) {
            showToast('Quote link not found on this post', 'error');
            return;
        }

        var fastReplyHost = document.getElementById('modern-editor-fastreply');
        if (!fastReplyHost || !fastReplyHost.__editorInstance) {
            console.info('[EditorModule] Quote: falling back to full editor (no fast reply editor present)');
            window.location.href = quoteLink.href;
            return;
        }

        var bbcode;
        try {
            var decoded = await fetchHtmlDecoded(quoteLink.href, {
                credentials: 'include'
            });
            var doc = new DOMParser().parseFromString(decoded.text, 'text/html');
            var form = doc.querySelector('form[name="REPLIER"]');
            var postArea = form && form.querySelector('#Post');
            bbcode = postArea ? postArea.value : '';
        } catch (err) {
            console.warn('[EditorModule] Quote fetch failed:', err);
            showToast('Could not load the quote', 'error');
            return;
        }

        if (!bbcode || !bbcode.trim()) {
            showToast('Quote came back empty', 'warning');
            return;
        }

        var html;
        try {
            html = await legacyToHtmlAsync(bbcode);
        } catch (err) {
            console.warn('[EditorModule] Quote conversion failed:', err);
            showToast('Could not convert the quote', 'error');
            return;
        }

        var editorInst = fastReplyHost.__editorInstance;
        try {
            editorInst.chain().focus('end').insertContent(html).run();
        } catch (err) {
            console.warn('[EditorModule] Quote insert failed:', err);
            showToast('Could not insert the quote', 'error');
            return;
        }

        var docAfter = editorInst.state.doc;
        var endPos = docAfter.content.size;
        var lastBlock = docAfter.lastChild;

        if (lastBlock && lastBlock.type.name === 'blockquote') {
            editorInst.chain()
                .insertContentAt(endPos, { type: 'paragraph' })
                .setTextSelection(endPos + 1)
                .focus()
                .run();
        } else if (lastBlock && lastBlock.type.name === 'paragraph') {
            editorInst.chain()
                .setTextSelection(endPos - 1)
                .focus()
                .run();
        }

        fastReplyHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('Quote added', 'success');
    }

    function startQuoteBatch(postEls) {
        _quoteQueue = _quoteQueue
            .then(function () { return doStartQuoteBatch(postEls); })
            .catch(function (err) { console.warn('[EditorModule] Batch quote error:', err); });
        return _quoteQueue;
    }

    async function doStartQuoteBatch(postEls) {
        if (!postEls || postEls.length === 0) return;

        var fastReplyHost = document.getElementById('modern-editor-fastreply');
        if (!fastReplyHost || !fastReplyHost.__editorInstance) {
            console.info('[EditorModule] Batch quote: no fast reply editor');
            return;
        }

        // Fetch every quote in parallel. Each fetch returns the BBCode
        // payload the legacy forum would have inserted into the reply
        // textarea.
        var fetches = postEls.map(function (postEl) {
            var quoteLink =
                postEl.querySelector('.mini_buttons a[href*="CODE=02"]') ||
                postEl.querySelector('a[href*="CODE=02"]');
            if (!quoteLink) return Promise.resolve(null);
            return fetchHtmlDecoded(quoteLink.href, { credentials: 'include' })
                .then(function (decoded) {
                    var doc = new DOMParser().parseFromString(decoded.text, 'text/html');
                    var form = doc.querySelector('form[name="REPLIER"]');
                    var postArea = form && form.querySelector('#Post');
                    return postArea ? postArea.value : null;
                })
                .catch(function () { return null; });
        });

        var bbcodeBlocks = (await Promise.all(fetches)).filter(function (b) {
            return b && b.trim();
        });
        if (bbcodeBlocks.length === 0) return;

        // Convert each to HTML through the existing pipeline.
        var htmlBlocks = [];
        for (var i = 0; i < bbcodeBlocks.length; i++) {
            try {
                htmlBlocks.push(await legacyToHtmlAsync(bbcodeBlocks[i]));
            } catch (e) {
                console.warn('[EditorModule] Quote conversion failed:', e);
            }
        }
        if (htmlBlocks.length === 0) return;

        // Insert everything in one transaction. Empty <p> between quotes
        // gives the user a caret slot between blocks. TrailingEmbedParagraph
        // and CustomBlockquote already handle the block boundaries.
        var editorInst = fastReplyHost.__editorInstance;
        var combined = htmlBlocks.join('<p></p>');
        editorInst.chain().focus('end').insertContent(combined).run();

        // Ensure a trailing paragraph so the user can type after the last
        // quote without selecting the blockquote first.
        var doc = editorInst.state.doc;
        var last = doc.lastChild;
        if (last && (last.type.name === 'blockquote' || last.type.name === 'paragraph')) {
            var endPos = doc.content.size;
            if (last.type.name === 'blockquote') {
                editorInst.chain()
                    .insertContentAt(endPos, { type: 'paragraph' })
                    .setTextSelection(endPos + 1)
                    .focus()
                    .run();
            } else if (last.content.size === 0) {
                editorInst.chain()
                    .setTextSelection(endPos - 1)
                    .focus()
                    .run();
            }
        }

        // One scroll at the end — not N scrolls during the loop.
        fastReplyHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast(
            htmlBlocks.length + ' ' + (htmlBlocks.length === 1 ? 'quote' : 'quotes') + ' inserted',
            'success'
        );
    }

    function registerObservers() {
        if (!globalThis.forumObserver || typeof globalThis.forumObserver.register !== 'function') return;

        try {
            var id = globalThis.forumObserver.register({
                id: 'editor-module-fastreply',
                selector: '.fast.send',
                priority: 'high',
                pageTypes: ['topic'],
                callback: function () { buildFastReplyEditor(); }
            });
            if (id) _observerIds.push(id);
        } catch (e) { console.error('[EditorModule] observer (fastreply) failed:', e); }

        try {
            var id2 = globalThis.forumObserver.register({
                id: 'editor-module-full',
                selector: '.send',
                priority: 'high',
                pageTypes: ['send'],
                callback: function () { buildFullEditor(); }
            });
            if (id2) _observerIds.push(id2);
        } catch (e) { console.error('[EditorModule] observer (full) failed:', e); }
    }

    function initialize() {
        if (isInitialized) return Promise.resolve();
        if (!globalThis.forumObserver) {
            console.error('[EditorModule] forumObserver not available');
            return Promise.reject(new Error('forumObserver missing'));
        }
        isInitialized = true;

        if (document.body.id === 'topic' || document.body.id === 'send') {
            fetchCurrentUserData();
        }

        var promises = [];
        if (document.body.id === 'topic' && document.querySelector('.fast.send')) {
            promises.push(buildFastReplyEditor());
        }
        if (document.body.id === 'send' && document.querySelector('.send')) {
            promises.push(buildFullEditor());
        }

        registerObservers();

        return Promise.all(promises).then(function () {
            console.log('[EditorModule] Initialized');
        }).catch(function (err) {
            console.error('[EditorModule] Initialization error:', err);
        });
    }

    function reset() {
        isInitialized = false;
        _activeFastEdits.forEach(function (entry) {
            if (entry && entry.controller) {
                try { entry.controller.abort(); } catch (e) {}
            }
            cleanupFastEditEntry(entry);
        });
        _activeFastEdits.clear();
        _observerIds.forEach(function (id) {
            if (globalThis.forumObserver && typeof globalThis.forumObserver.unregister === 'function') {
                try { globalThis.forumObserver.unregister(id); } catch (e) {}
            }
        });
        _observerIds = [];
        _boundHandlers.forEach(function (h) {
            try { h.el.removeEventListener(h.type, h.handler, h.opts); } catch (e) {}
        });
        _boundHandlers = [];
        if (_dropdownBackdrop && _dropdownBackdrop.parentNode) {
            _dropdownBackdrop.parentNode.removeChild(_dropdownBackdrop);
        }
        _dropdownBackdrop = null;
        _currentUserCache = null;
    }

    return {
        initialize: initialize,
        reset: reset,
        startFastEdit: startFastEdit,
        cancelFastEdit: cancelFastEdit,
        isFastEditActive: isFastEditActive,
        focusFastEdit: focusFastEdit,
        startQuote: startQuote,
        startQuoteBatch: startQuoteBatch
    };
})(
    typeof ForumDOMUtils !== 'undefined' ? ForumDOMUtils : window.ForumDOMUtils,
    typeof ForumEventBus !== 'undefined' ? ForumEventBus : window.ForumEventBus
);

if (typeof window !== 'undefined') {
    window.EditorModule = EditorModule;
    window.dispatchEvent(new CustomEvent('editor-module-ready'));
}
