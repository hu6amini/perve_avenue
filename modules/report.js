// report.js
'use strict';

const REPORT_ENDPOINT = (() => {
    const m = location.hostname.match(/(forumfree|forumcommunity|blogfree)\.(it|net)$/);
    return m ? `https://ffp.${m[0]}/php7/reporting/reporting.php` : null;
})();
const REPORT_DOMAIN = location.hostname;
const REPORT_MIN = 5;
const REPORT_MAX = 300;

function readReportCookie() {
    const m = document.cookie.match(/(?:^|;\s*)ffp_auth=([^;]+)/);
    return m ? m[1] : null;
}

async function submitReport(pid, text) {
    if (!REPORT_ENDPOINT) throw new Error('REPORTING_UNAVAILABLE');
    const trimmed = String(text || '').trim();
    if (trimmed.length < REPORT_MIN) throw new Error('TOO_SHORT');
    const body = new URLSearchParams({
        act: 'Report',
        pid: String(pid),
        text: trimmed,
        domain: REPORT_DOMAIN,
        ...(readReportCookie() ? { auth_personal: readReportCookie() } : {})
    });
    const r = await fetch(REPORT_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body
    });
    if (!r.ok) throw new Error('HTTP_' + r.status);
    const data = await r.json();
    if (data && data.ffp_auth) {
        document.cookie =
            'ffp_auth=' + data.ffp_auth + '; path=/; max-age=14400; Secure; SameSite=Lax';
    }
    return data;  // { confirm: bool, ffp_auth?: string }
}

function openReportDialog(pid) {
    const postCard = document.querySelector('.post-card[data-post-id="' + pid + '"]');
    const nickname = postCard?.querySelector('.user-profile-link')?.textContent.trim() || 'this user';

    const overlay = document.createElement('div');
    overlay.className = 'modern-modal-overlay';

    const box = document.createElement('div');
    box.className = 'modern-modal-box modern-report-dialog';
    box.innerHTML =
        '<h3 class="modern-confirm-title">' +
            '<i class="fa-regular fa-flag modern-confirm-icon" aria-hidden="true"></i>' +
            '<span>Report post</span>' +
        '</h3>' +
        '<p class="modern-confirm-message">Report the post by <strong>' +
            escapeHtml(nickname) + '</strong> to the moderators.</p>' +
        '<textarea class="modern-report-textarea" rows="5" maxlength="' + REPORT_MAX +
            '" placeholder="Why are you reporting this post? (min ' + REPORT_MIN + ' characters)"></textarea>' +
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

    const refresh = () => {
        const len = textarea.value.trim().length;
        counter.textContent = textarea.value.length;
        confirmBtn.disabled = len < REPORT_MIN;
    };
    textarea.addEventListener('input', refresh);
    textarea.focus();

    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !confirmBtn.disabled) {
            e.preventDefault();
            confirmBtn.click();
        }
    };
    document.addEventListener('keydown', onKey);

    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Sending…';
        try {
            const result = await submitReport(pid, textarea.value);
            if (result?.confirm) {
                close();
                markPostReported(pid);
                showReportSuccessToast();
            } else {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Send report';
                showReportErrorToast('The report was not accepted. Try again later.');
            }
        } catch (e) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Send report';
            const msg = e.message === 'TOO_SHORT'
                ? 'Please write at least ' + REPORT_MIN + ' characters.'
                : 'Something went wrong. Try again later.';
            showReportErrorToast(msg);
        }
    });
}

function markPostReported(pid) {
    const card = document.querySelector('.post-card[data-post-id="' + pid + '"]');
    const btn = card?.querySelector('[data-action="report"]');
    if (btn) {
        btn.disabled = true;
        btn.title = 'You have already reported this post';
        btn.setAttribute('aria-disabled', 'true');
    }
}

function showReportSuccessToast() {
    if (window.Commons?.toast?.show) {
        window.Commons.toast.show({
            title: 'Post reported',
            content: 'Your report was sent to the moderators.',
            class: ['cs-toast-success'],
            ttl: 4000
        });
        return;
    }
    // fallback if Commons is missing
    const t = document.createElement('div');
    t.className = 'modern-toast modern-toast-success';
    t.textContent = 'Report sent.';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function showReportErrorToast(msg) {
    if (window.Commons?.toast?.show) {
        window.Commons.toast.show({
            title: 'Report failed',
            content: msg,
            class: ['cs-toast-error'],
            ttl: 5000
        });
        return;
    }
    alert(msg);
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// Public surface — window.ModernReport is what posts.js will check
window.ModernReport = { submitReport, openReportDialog };
