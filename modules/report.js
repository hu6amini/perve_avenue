// modules/report.js
//
// Modern report dialog. Peer client to script 51 ("Reporting System") —
// both submit to the same ffp.{domain}/php7/reporting backend, both are
// seen as identical by the server. Script 51 stays installed for staff
// notification features; this file owns the user-facing UI.
//
// Registered in forum-enhancer.js as `report` with dependencies
// ['domUtils', 'eventBus'].
//
// To maximise compliance with the sanctioned-client path, submitReport
// could be changed to proxy through script 51's hidden `.report_button`
// (click it, fill its textarea, click its submit). That would require
// temporarily overriding window.confirm, since script 51 always fires a
// native confirm(). The current implementation submits directly to the
// same endpoint with the same payload, which is simpler and has no
// confirm() interruption. Flip if you decide the proxy path is worth it.

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

    const REPORT_MIN = 5;      // script 51: config.report_minLength
    const REPORT_MAX = 300;    // script 51: config.limitText
    const COOKIE_NAME = 'ffp_auth';
    const COOKIE_TTL = 14400;  // script 51: setCookie("ffp_auth", …, 14400, false)

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
        } catch (_) { /* ignore cookie write failures */ }
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
    // DIALOG
    // =========================================================================
    function openReportDialog(pid) {
        // Close any existing dialog first
        document.querySelectorAll('.modern-report-dialog-host').forEach(function (el) {
            el.remove();
        });

        const card = document.querySelector('.post-card[data-post-id="' + pid + '"]');
        const username =
            (card && card.querySelector('.user-profile-link')?.textContent || '').trim() ||
            'this user';

        const overlay = document.createElement('div');
        overlay.className = 'modern-modal-overlay modern-report-dialog-host';

        const box = document.createElement('div');
        box.className = 'modern-modal-box modern-report-dialog';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'modern-report-title');
        box.innerHTML =
            '<h3 class="modern-confirm-title" id="modern-report-title">' +
                '<i class="fa-regular fa-flag modern-confirm-icon" aria-hidden="true"></i>' +
                '<span>Report post</span>' +
            '</h3>' +
            '<p class="modern-confirm-message">' +
                'Report the post by <strong>' + escapeHtml(username) + '</strong> ' +
                'to the moderators.' +
            '</p>' +
            '<textarea class="modern-report-textarea" ' +
                'rows="5" maxlength="' + REPORT_MAX + '" ' +
                'placeholder="Why are you reporting this post? (min ' + REPORT_MIN + ' characters)">' +
            '</textarea>' +
            '<div class="modern-report-counter"><span>0</span>/' + REPORT_MAX + '</div>' +
            '<div class="modern-confirm-actions">' +
                '<button type="button" class="modern-btn modern-btn-secondary" data-action="cancel">Cancel</button>' +
                '<button type="button" class="modern-btn modern-btn-danger" data-action="confirm" disabled>Send report</button>' +
            '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const textarea = box.querySelector('.modern-report-textarea');
        const counter = box.querySelector('.modern-report-counter > span');
        const confirmBtn = box.querySelector('[data-action="confirm"]');
        const cancelBtn = box.querySelector('[data-action="cancel"]');
        const previousFocus = document.activeElement;

        function refresh() {
            counter.textContent = textarea.value.length;
            confirmBtn.disabled = textarea.value.trim().length < REPORT_MIN;
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
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', onKey, true);

        confirmBtn.addEventListener('click', async function () {
            confirmBtn.disabled = true;
            const originalLabel = confirmBtn.textContent;
            confirmBtn.textContent = 'Sending…';

            try {
                const result = await submitReport(pid, textarea.value);
                if (result && result.confirm) {
                    close();
                    markPostReported(pid);
                    showSuccessToast();
                    emitSubmitted(pid);
                } else {
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = originalLabel;
                    showErrorToast('The report was not accepted. Try again later.');
                }
            } catch (e) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = originalLabel;
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
        btn.classList.add('is-reported');
    }

    function emitSubmitted(pid) {
        if (typeof ForumEventBus !== 'undefined' && ForumEventBus.trigger) {
            try { ForumEventBus.trigger('forum:report:submitted', { pid: pid }); }
            catch (_) { /* ignore */ }
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
            } catch (_) { /* fall through */ }
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
            } catch (_) { /* fall through */ }
        }
        fallbackToast(message, 'error');
    }

    function fallbackToast(message, kind) {
        const t = document.createElement('div');
        t.className = 'modern-toast modern-toast-' + (kind || 'info');
        t.textContent = message;
        document.body.appendChild(t);
        setTimeout(function () {
            try { t.remove(); } catch (_) {}
        }, 4000);
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================
    function handlePagehide() {
        document.querySelectorAll('.modern-report-dialog-host').forEach(function (el) {
            el.remove();
        });
    }

    function initialize() {
        if (ModernReport._initialized) return;
        ModernReport._initialized = true;
        window.addEventListener('pagehide', handlePagehide, { once: true });
        if (REPORT_ENDPOINT) {
            console.log('[ModernReport] ready (endpoint: ' + REPORT_ENDPOINT + ')');
        } else {
            console.warn('[ModernReport] ready, but endpoint is unavailable on this host');
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
        catch (_) { /* ignore */ }
    }

    return api;
})();

if (typeof window !== 'undefined') {
    window.ModernReport = ModernReport;
    window.dispatchEvent(new CustomEvent('report-module-ready'));
}
