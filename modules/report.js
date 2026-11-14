// modules/report.js
//
// Modern report dialog. Peer client to script 51 ("Reporting System") —
// both submit to the same ffp.{domain}/php7/reporting backend.
//
// Uses the CSS classes already defined in modern-forum.css section 12 /
// 12b (report-modal-*). Do not rename them — ModalsModule and the
// stylesheet are both built against this shape.
//
// Registered in forum-enhancer.js as `report` with dependencies
// ['domUtils', 'eventBus'].

var ModernReport = (function () {
    'use strict';

    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('report-start');
    }

    // =========================================================================
    // CONFIGURATION — mirrors script 51's own values exactly
    // =========================================================================
    const REPORT_ENDPOINT = (function () {
        const m = location.href.match(/(forumfree|blogfree|forumcommunity)\.(it|net)/);
        return m ? 'https://ffp.' + m[0] + '/php7/reporting/reporting.php' : null;
    })();

    const REPORT_DOMAIN = (function () {
        const m = location.href.match(/[a-z-]+\.(forumfree|blogfree|forumcommunity)\.(it|net)/);
        return m ? m[0] : location.hostname;
    })();

    const REPORT_MIN   = 5;         // script 51: config.report_minLength
    const REPORT_MAX   = 300;       // script 51: config.limitText
    const TEXTAREA_MAX = 220;       // px — cap auto-grow so modal stays bounded
    const WARN_AT      = Math.floor(REPORT_MAX * 0.8);  // 240 — amber counter
    const COOKIE_NAME  = 'ffp_auth';
    const COOKIE_TTL   = 14400;     // script 51: 14400 seconds

    // =========================================================================
    // HELPERS
    // =========================================================================
    function escapeHtml(s) {
        if (typeof ForumDOMUtils !== 'undefined' && ForumDOMUtils.escapeHtml) {
            return ForumDOMUtils.escapeHtml(s);
        }
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function getReportCookie() {
        const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
        return m ? m[1] : null;
    }

    function setReportCookie(value) {
        try {
            document.cookie = COOKIE_NAME + '=' + value +
                '; path=/; max-age=' + COOKIE_TTL +
                '; Secure; SameSite=Lax';
        } catch (_) { /* ignore */ }
    }

    function autoGrow(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, TEXTAREA_MAX) + 'px';
    }

    // =========================================================================
    // SUBMISSION
    // =========================================================================
    async function submitReport(pid, text) {
        if (!REPORT_ENDPOINT) throw new Error('REPORTING_UNAVAILABLE');

        const trimmed = String(text == null ? '' : text).trim();
        if (trimmed.length < REPORT_MIN) throw new Error('TOO_SHORT');

        const cookie = getReportCookie();
        const body = new URLSearchParams({
            act: 'Report',
            pid: String(pid),
            text: trimmed,
            domain: REPORT_DOMAIN
        });
        if (cookie) body.set('auth_personal', cookie);

        const response = await fetch(REPORT_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body
        });

        if (!response.ok) throw new Error('HTTP_' + response.status);

        let data;
        try { data = await response.json(); }
        catch (e) { throw new Error('BAD_JSON'); }

        if (data && data.ffp_auth) setReportCookie(data.ffp_auth);

        return data; // { confirm: true|false, ffp_auth?: "…" }
    }

    // =========================================================================
    // DIALOG — built to the markup shape already defined by the CSS
    // =========================================================================
    function openReportDialog(pid) {
        // Close any existing report dialog first
        document.querySelectorAll('.modern-report-overlay.is-open').forEach(function (el) {
            el.remove();
        });
        document.body.classList.remove('modal-open');

        const card = document.querySelector('.post-card[data-post-id="' + pid + '"]');
        const username =
            (card && card.querySelector('.user-profile-link')?.textContent || '').trim() ||
            'this user';

        // ── Overlay + container ─────────────────────────────────
        const overlay = document.createElement('div');
        overlay.className = 'modern-report-overlay is-open';

        const container = document.createElement('div');
        container.className = 'modern-report-container';
        container.setAttribute('role', 'dialog');
        container.setAttribute('aria-modal', 'true');
        container.setAttribute('aria-labelledby', 'report-modal-title-text');
        overlay.appendChild(container);

        // ── Header ──────────────────────────────────────────────
        const header = document.createElement('div');
        header.className = 'report-modal-header';
        header.innerHTML =
            '<div class="report-modal-title">' +
                '<i class="fa-regular fa-flag" aria-hidden="true"></i>' +
                '<h3 id="report-modal-title-text">Report post</h3>' +
            '</div>' +
            '<button type="button" class="report-modal-close" aria-label="Close">' +
                '<i class="fa-regular fa-xmark" aria-hidden="true"></i>' +
            '</button>';
        container.appendChild(header);

        // ── Content ─────────────────────────────────────────────
        const content = document.createElement('div');
        content.className = 'report-modal-content';
        content.innerHTML =
            '<div class="report-context">' +
                '<i class="fa-regular fa-circle-info" aria-hidden="true"></i>' +
                '<span class="report-intro">You are reporting the post of:</span>' +
                '<span class="reported-nickname">' + escapeHtml(username) + '</span>' +
            '</div>' +
            '<div class="report-field">' +
                '<label for="report-reason">' +
                    '<span>Reason for reporting</span>' +
                    '<span class="counter-value" id="report-counter">0 / ' + REPORT_MAX + '</span>' +
                '</label>' +
                '<textarea id="report-reason" class="report-textarea" ' +
                    'maxlength="' + REPORT_MAX + '" rows="5" ' +
                    'placeholder="Why are you reporting this post? (min ' + REPORT_MIN + ' characters)"></textarea>' +
            '</div>';
        container.appendChild(content);

        // ── Footer ──────────────────────────────────────────────
        const footer = document.createElement('div');
        footer.className = 'report-modal-footer';
        footer.innerHTML =
            '<div class="footer-note">' +
                '<i class="fa-regular fa-triangle-exclamation" aria-hidden="true"></i> ' +
                'Your report will be sent to the moderators.' +
            '</div>' +
            '<div class="action-buttons">' +
                '<button type="button" class="btn-outline" data-action="cancel">Cancel</button>' +
                '<button type="button" class="btn-primary-filled" data-action="confirm" disabled>' +
                    '<i class="fa-regular fa-paper-plane" aria-hidden="true"></i> Send report' +
                '</button>' +
            '</div>';
        container.appendChild(footer);

        // ── Refs ────────────────────────────────────────────────
        const textarea   = container.querySelector('.report-textarea');
        const counter    = container.querySelector('.counter-value');
        const confirmBtn = container.querySelector('[data-action="confirm"]');
        const cancelBtn  = container.querySelector('[data-action="cancel"]');
        const closeBtn   = container.querySelector('.report-modal-close');
        const previousFocus = document.activeElement;

        // ── Behaviours ──────────────────────────────────────────
        function refresh() {
            const len = textarea.value.length;
            counter.textContent = len + ' / ' + REPORT_MAX;
            counter.classList.toggle('warning', len >= WARN_AT && len < REPORT_MAX);
            counter.classList.toggle('exceed',  len >= REPORT_MAX);
            confirmBtn.disabled = textarea.value.trim().length < REPORT_MIN;
            autoGrow(textarea);
        }

        function close() {
            overlay.remove();
            document.body.classList.remove('modal-open');
            document.removeEventListener('keydown', onKey, true);
            if (previousFocus && typeof previousFocus.focus === 'function') {
                try { previousFocus.focus(); } catch (_) {}
            }
        }

        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); close(); return; }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !confirmBtn.disabled) {
                e.preventDefault();
                confirmBtn.click();
            }
        }

        textarea.addEventListener('input', refresh);
        cancelBtn.addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', onKey, true);

        confirmBtn.addEventListener('click', async function () {
            confirmBtn.disabled = true;
            const originalLabel = confirmBtn.innerHTML;
            confirmBtn.textContent = 'Sending…';

            try {
                const result = await submitReport(pid, textarea.value);
                if (result && result.confirm) {
                    close();
                    markPostReported(pid);
                    showToast('Your report was sent to the moderators.', 'success');
                    emitSubmitted(pid);
                } else {
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML = originalLabel;
                    showToast('The report was not accepted. Try again later.', 'error');
                }
            } catch (e) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = originalLabel;
                const msg = (e && e.message === 'TOO_SHORT')
                    ? 'Please write at least ' + REPORT_MIN + ' characters.'
                    : 'Something went wrong. Try again later.';
                showToast(msg, 'error');
            }
        });

        // ── Mount + focus ───────────────────────────────────────
        document.body.appendChild(overlay);
        document.body.classList.add('modal-open');
        requestAnimationFrame(function () {
            try { textarea.focus(); autoGrow(textarea); } catch (_) {}
        });
        refresh();
    }

    // =========================================================================
    // POST-SUBMIT UI
    // =========================================================================
    function markPostReported(pid) {
        const card = document.querySelector('.post-card[data-post-id="' + pid + '"]');
        const btn = card && card.querySelector('[data-action="report"]');
        if (!btn) return;
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'You have already reported this post';
    }

    function emitSubmitted(pid) {
        if (typeof ForumEventBus !== 'undefined' && ForumEventBus.trigger) {
            try { ForumEventBus.trigger('forum:report:submitted', { pid: pid }); }
            catch (_) {}
        }
    }

    // =========================================================================
    // TOAST — prefers Commons, falls back to inline element
    // =========================================================================
    function showToast(message, kind) {
        if (window.Commons && window.Commons.toast && window.Commons.toast.show) {
            try {
                window.Commons.toast.show({
                    title: kind === 'error' ? 'Report failed' : 'Post reported',
                    content: message,
                    class: [kind === 'error' ? 'cs-toast-error' : 'cs-toast-success'],
                    ttl: kind === 'error' ? 5000 : 4000
                });
                return;
            } catch (_) { /* fall through */ }
        }
        const t = document.createElement('div');
        t.textContent = message;
        Object.assign(t.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            padding: '12px 20px',
            borderRadius: '8px',
            background: kind === 'error' ? '#dc2626' : '#059669',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: '14px',
            fontWeight: '500',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            zIndex: '100002',
            maxWidth: '320px'
        });
        document.body.appendChild(t);
        setTimeout(function () { try { t.remove(); } catch (_) {} }, 4000);
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================
    function handlePagehide() {
        document.querySelectorAll('.modern-report-overlay.is-open').forEach(function (el) {
            el.remove();
        });
        document.body.classList.remove('modal-open');
    }

    function initialize() {
        if (ModernReport._initialized) return;
        ModernReport._initialized = true;
        window.addEventListener('pagehide', handlePagehide, { once: true });
        if (REPORT_ENDPOINT) {
            console.log('[ModernReport] ready (endpoint: ' + REPORT_ENDPOINT + ')');
        } else {
            console.warn('[ModernReport] ready, but endpoint unavailable on this host');
        }
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    const api = {
        initialize: initialize,
        submitReport: submitReport,
        openReportDialog: openReportDialog,
        _initialized: false
    };

    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('report-end');
        try { performance.measure('report-load-time', 'report-start', 'report-end'); }
        catch (_) {}
    }

    return api;
})();

if (typeof window !== 'undefined') {
    window.ModernReport = ModernReport;
    window.dispatchEvent(new CustomEvent('report-module-ready'));
}
