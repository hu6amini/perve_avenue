// modules/report.js
//
// Modern report dialog, built against the pre-existing report-modal
// CSS classes in modern-forum.css sections 12, 12b (user-facing) and
// 12c (staff-facing — handled by a future report-notify.js).
//
// Registered in forum-enhancer.js as `report` with dependencies
// ['domUtils', 'eventBus'].

var ModernReport = (function () {
    'use strict';

    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark('report-start');
    }

    // =========================================================================
    // CONFIGURATION — mirrors script 51
    // =========================================================================
    const REPORT_ENDPOINT = (function () {
        const m = location.href.match(/(forumfree|blogfree|forumcommunity)\.(it|net)/);
        return m ? 'https://ffp.' + m[0] + '/php7/reporting/reporting.php' : null;
    })();

    const REPORT_DOMAIN = location.hostname;
    const REPORT_MIN = 5;
    const REPORT_MAX = 300;
    const COOKIE_NAME = 'ffp_auth';
    const COOKIE_TTL = 14400;

    const _reportedThisSession = new Set();

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
            document.cookie =
                COOKIE_NAME + '=' + value +
                '; path=/; max-age=' + COOKIE_TTL +
                '; Secure; SameSite=Lax';
        } catch (_) {}
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

        return data;
    }

    // =========================================================================
    // DIALOG — built with the pre-existing CSS classes
    // =========================================================================
    function openReportDialog(pid) {
        if (_reportedThisSession.has(String(pid))) {
            showErrorToast('You have already reported this post.');
            return;
        }

        document.querySelectorAll('.modern-report-overlay').forEach(el => el.remove());

        const card = document.querySelector('.post-card[data-post-id="' + pid + '"]');
        const username =
            (card && card.querySelector('.user-profile-link')?.textContent || '').trim() ||
            'this user';

        const overlay = document.createElement('div');
        overlay.className = 'modern-report-overlay';
        overlay.setAttribute('data-report-pid', String(pid));

        overlay.innerHTML =
            '<div class="modern-report-container" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">' +
                '<div class="report-modal-header">' +
                    '<div class="report-modal-title" id="report-modal-title">' +
                        '<i class="fa-regular fa-flag" aria-hidden="true"></i>' +
                        '<h3>Report post</h3>' +
                    '</div>' +
                    '<button type="button" class="report-modal-close" aria-label="Close">\u00D7</button>' +
                '</div>' +
                '<div class="report-modal-content">' +
                    '<div class="report-context">' +
                        '<i class="fa-regular fa-user" aria-hidden="true"></i>' +
                        '<div class="report-intro">' +
                            '<span>Reporting the post by</span>' +
                            '<span class="reported-nickname">' + escapeHtml(username) + '</span>' +
                            '<span class="post-ref-link">' +
                                '<a href="#entry' + escapeHtml(String(pid)) + '">view post</a>' +
                            '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="report-field">' +
                        '<label>' +
                            '<span>Reason for reporting</span>' +
                            '<span class="counter-value">0/' + REPORT_MAX + '</span>' +
                        '</label>' +
                        '<textarea class="report-textarea" rows="5" ' +
                            'maxlength="' + REPORT_MAX + '" ' +
                            'placeholder="Explain why you are reporting this post (min ' +
                            REPORT_MIN + ' characters)\u2026"></textarea>' +
                    '</div>' +
                '</div>' +
                '<div class="report-modal-footer">' +
                    '<div class="footer-note">' +
                        '<i class="fa-regular fa-circle-info" aria-hidden="true"></i> ' +
                        'Once sent, the report cannot be cancelled.' +
                    '</div>' +
                    '<div class="action-buttons">' +
                        '<button type="button" class="btn-outline" data-action="cancel">Cancel</button>' +
                        '<button type="button" class="btn-primary-filled" data-action="confirm" disabled>' +
                            '<i class="fa-regular fa-paper-plane" aria-hidden="true"></i> ' +
                            'Send report' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        const textarea = overlay.querySelector('.report-textarea');
        const counter = overlay.querySelector('.counter-value');
        const confirmBtn = overlay.querySelector('[data-action="confirm"]');
        const cancelBtn = overlay.querySelector('[data-action="cancel"]');
        const closeBtn = overlay.querySelector('.report-modal-close');
        const postLink = overlay.querySelector('.post-ref-link a');
        const previousFocus = document.activeElement;

        function autoGrow() {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        }

        function refresh() {
            const len = textarea.value.length;
            const trimmedLen = textarea.value.trim().length;

            counter.textContent = len + '/' + REPORT_MAX;
            counter.classList.toggle('warning', len >= REPORT_MAX * 0.9 && len < REPORT_MAX);
            counter.classList.toggle('exceed', len >= REPORT_MAX);

            confirmBtn.disabled = trimmedLen < REPORT_MIN;
            autoGrow();
        }

        function close() {
            overlay.remove();
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
        postLink.addEventListener('click', function () { close(); });
        document.addEventListener('keydown', onKey, true);

        confirmBtn.addEventListener('click', async function () {
            confirmBtn.disabled = true;
            const originalLabel = confirmBtn.innerHTML;
            confirmBtn.innerHTML = 'Sending\u2026';

            try {
                const result = await submitReport(pid, textarea.value);
                if (result && result.confirm) {
                    _reportedThisSession.add(String(pid));
                    close();
                    markPostReported(pid);
                    showSuccessToast();
                    emitSubmitted(pid);
                } else {
                    confirmBtn.innerHTML = originalLabel;
                    confirmBtn.disabled = false;
                    showErrorToast('The report was not accepted. Try again later.');
                }
            } catch (e) {
                confirmBtn.innerHTML = originalLabel;
                confirmBtn.disabled = false;
                const msg = (e && e.message === 'TOO_SHORT')
                    ? 'Please write at least ' + REPORT_MIN + ' characters.'
                    : 'Something went wrong. Try again later.';
                showErrorToast(msg);
            }
        });

        requestAnimationFrame(function () {
            try { textarea.focus(); } catch (_) {}
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
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
    }

    function emitSubmitted(pid) {
        if (typeof ForumEventBus !== 'undefined' && ForumEventBus.trigger) {
            try { ForumEventBus.trigger('forum:report:submitted', { pid: pid }); }
            catch (_) {}
        }
    }

    // =========================================================================
    // TOASTS
    // =========================================================================
    function showSuccessToast() {
        if (window.Commons && window.Commons.toast && window.Commons.toast.show) {
            try {
                window.Commons.toast.show({
                    title: 'Post reported',
                    content: 'Your report was sent to the moderators.',
                    class: ['cs-toast-success'],
                    ttl: 4000
                });
                return;
            } catch (_) {}
        }
        fallbackToast('Report sent.', 'success');
    }

    function showErrorToast(message) {
        if (window.Commons && window.Commons.toast && window.Commons.toast.show) {
            try {
                window.Commons.toast.show({
                    title: 'Report failed',
                    content: message,
                    class: ['cs-toast-error'],
                    ttl: 5000
                });
                return;
            } catch (_) {}
        }
        fallbackToast(message, 'error');
    }

    function fallbackToast(message, kind) {
        const t = document.createElement('div');
        t.className = 'modern-toast modern-toast-' + (kind || 'info');
        t.textContent = message;
        document.body.appendChild(t);
        setTimeout(function () { try { t.remove(); } catch (_) {} }, 4000);
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================
    function handlePagehide() {
        document.querySelectorAll('.modern-report-overlay').forEach(el => el.remove());
    }

    function initialize() {
        if (ModernReport._initialized) return;
        ModernReport._initialized = true;
        window.addEventListener('pagehide', handlePagehide, { once: true });
        if (REPORT_ENDPOINT) {
            console.log('[ModernReport] ready (endpoint: ' + REPORT_ENDPOINT + ')');
        } else {
            console.warn('[ModernReport] endpoint unavailable on this host');
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
