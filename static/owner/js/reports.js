// ============================================================
// HAVEN HAIR — reports.js
// Owner Reports Page — Full Logic
//
// Responsibilities:
//   1.  Shared state & auth guard
//   2.  Init — load shop name, load current week report
//   3.  Week navigation — prev / next / date range label
//   4.  Load report data from API
//   5.  Render stat cards (happy, complaints, total, avg wait)
//   6.  Render reputation score + bar + badge
//   7.  Render complaints breakdown tags
//   8.  Render follow-ups (resolved, updated reviews)
//   9.  Render customers-per-day bar chart
//  10.  Render AI insight box
//  11.  Drawer navigation
//  12.  Unread message dot
//  13.  Toast notifications
//  14.  Shared helpers
//
// Depends on:
//   - reports.html   (all element IDs used below)
//   - owner.css      (stat-card, bar-chart, insight-box, etc.)
//
// APIs used:
//   GET  /shops/:id              → shop name for page subtitle
//   GET  /api/owner/reports      → ?shop_id=X&week_offset=N
//        Returns:
//        {
//          total          : int,
//          happy          : int,
//          complaints     : int,
//          avg_wait       : float,
//          rep_score      : int,       // current score 0-100
//          rep_score_prev : int,       // score last week
//          resolved       : int,       // complaints resolved via chat
//          updated        : int,       // reviews updated after chat
//          days           : { Mon, Tue, Wed, Thu, Fri, Sat, Sun },
//          complaints_breakdown : [ { tag: str, count: int } ],
//          ai_insight     : str | null
//        }
//   GET  /owner/unread-count     → ?owner_id=X  (message badge)
// ============================================================


// ---- 1. Shared state & auth guard ------------------------

const owner   = JSON.parse(localStorage.getItem('hh_owner') || 'null');
const SHOP_ID = parseInt(localStorage.getItem('hh_active_shop') || '0');

let weekOffset = 0;   // 0 = this week, -1 = last week, etc.

if (!owner)   window.location.href = '/owner/auth';
if (!SHOP_ID) window.location.href = '/owner/branches';


// ---- 2. Init ---------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('drawer-name').textContent = owner.name;

    // Load shop name for subtitle
    const shopRes  = await fetch(`/shops/${SHOP_ID}`);
    const shopData = await shopRes.json();
    document.getElementById('report-shop-name').textContent = shopData.name || '—';

    await loadReport();
    checkUnread();
});


// ---- 3. Week navigation ----------------------------------

// Move forward or backward one week then reload
function changeWeek(direction) {
    weekOffset += direction;

    // Cannot go into the future
    if (weekOffset > 0) { weekOffset = 0; }

    // Disable Next button when on current week
    document.getElementById('next-week-btn').disabled = weekOffset === 0;

    loadReport();
}

// Return the Monday of a week based on offset from current week
function getWeekBounds(offset) {
    const now    = new Date();
    const day    = now.getDay();                          // 0=Sun … 6=Sat
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7) + offset * 7);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { monday, sunday };
}

// Format a date as "12 May"
function fmtDate(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Update the period label and date range shown above the chart
function updateDateLabels() {
    const { monday, sunday } = getWeekBounds(weekOffset);

    const periodEl = document.getElementById('report-period');
    const rangeEl  = document.getElementById('report-date-range');

    if (weekOffset === 0) {
        periodEl.textContent = 'This Week';
    } else if (weekOffset === -1) {
        periodEl.textContent = 'Last Week';
    } else {
        periodEl.textContent = `${Math.abs(weekOffset)} Weeks Ago`;
    }

    rangeEl.textContent = `${fmtDate(monday)} — ${fmtDate(sunday)}`;
}


// ---- 4. Load report data from API ------------------------

async function loadReport() {
    // Show loader, hide content
    document.getElementById('report-loader').style.display  = 'flex';
    document.getElementById('report-content').style.display = 'none';

    updateDateLabels();

    const res  = await fetch(`/hh/owner/reports?shop_id=${SHOP_ID}&week_offset=${weekOffset}`);
    const data = await res.json();

    document.getElementById('report-loader').style.display  = 'none';
    document.getElementById('report-content').style.display = 'block';

    if (!res.ok) {
        toast('Could not load report.', 'err');
        return;
    }

    const isEmpty = !data.total || data.total === 0;
    document.getElementById('no-data-msg').style.display = isEmpty ? 'block' : 'none';

    if (!isEmpty) {
        renderStatCards(data);
        renderRepScore(data);
        renderComplaintsBreakdown(data.complaints_breakdown || []);
        renderFollowUps(data);
        renderDaysChart(data.days || {});
        renderInsight(data.ai_insight);
    }
}


// ---- 5. Render stat cards --------------------------------

function renderStatCards(d) {
    document.getElementById('stat-happy').textContent      = d.happy       ?? '—';
    document.getElementById('stat-complaints').textContent = d.complaints  ?? '—';
    document.getElementById('stat-total').textContent      = d.total       ?? '—';
    document.getElementById('stat-avg-wait').textContent   =
        d.avg_wait != null ? Math.round(d.avg_wait) : '—';
}


// ---- 6. Render reputation score + bar + badge -----------

function renderRepScore(d) {
    const score     = d.rep_score      ?? 0;
    const prevScore = d.rep_score_prev ?? score;
    const diff      = score - prevScore;

    // Big number
    document.getElementById('rep-score-val').textContent = score;

    // Change label  e.g. "↑ +5 from last week"  or  "↓ -3 from last week"
    const changeEl = document.getElementById('rep-score-change');
    if (diff > 0) {
        changeEl.textContent = `↑ +${diff} from last week`;
        changeEl.style.color = 'var(--green)';
    } else if (diff < 0) {
        changeEl.textContent = `↓ ${diff} from last week`;
        changeEl.style.color = 'var(--red)';
    } else {
        changeEl.textContent = 'Same as last week';
        changeEl.style.color = 'var(--text-muted)';
    }

    // Score bar (width = score%)
    document.getElementById('rep-score-bar').style.width = `${score}%`;

    // Badge
    const badgeEl = document.getElementById('rep-badge');
    if      (score >= 90) { badgeEl.textContent = '🏅 Top Rated — shown first in search'; badgeEl.style.color = 'var(--amber)'; }
    else if (score >= 70) { badgeEl.textContent = '✓ Trusted Shop — shown normally';      badgeEl.style.color = 'var(--green)'; }
    else if (score >= 50) { badgeEl.textContent = 'No badge — shown lower in results';    badgeEl.style.color = 'var(--text-muted)'; }
    else                  { badgeEl.textContent = '⚠️ Warning shown to customers';        badgeEl.style.color = 'var(--red)'; }
}


// ---- 7. Render complaints breakdown ---------------------

function renderComplaintsBreakdown(list) {
    const section = document.getElementById('complaints-section');
    const body    = document.getElementById('complaints-body');

    if (!list.length) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    body.innerHTML = list.map(item => `
        <div class="complaint-row">
            <span class="complaint-tag">${item.tag}</span>
            <span class="complaint-count">×${item.count}</span>
        </div>
    `).join('');
}


// ---- 8. Render follow-ups (resolved, updated) -----------

function renderFollowUps(d) {
    document.getElementById('stat-resolved').textContent = d.resolved ?? '—';
    document.getElementById('stat-updated').textContent  = d.updated  ?? '—';
}


// ---- 9. Render customers-per-day bar chart --------------

function renderDaysChart(days) {
    const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const values = LABELS.map(l => days[l] || 0);
    const maxVal = Math.max(...values, 1);   // avoid div-by-zero

    const container = document.getElementById('days-chart');

    container.innerHTML = LABELS.map((label, i) => {
        const val     = values[i];
        const pct     = Math.round((val / maxVal) * 100);
        const isToday = isTodayLabel(label);

        return `
        <div class="bar-row">
            <span class="bar-label" style="${isToday ? 'color:var(--amber)' : ''}">${label}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width:${pct}%; ${isToday ? 'background:var(--amber-dark, var(--amber))' : ''}"></div>
            </div>
            <span class="bar-val">${val}</span>
        </div>`;
    }).join('');
}

// Returns true if the short day label matches today (only when viewing current week)
function isTodayLabel(label) {
    if (weekOffset !== 0) return false;
    const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return SHORT[new Date().getDay()] === label;
}


// ---- 10. Render AI insight box ---------------------------

function renderInsight(text) {
    const box = document.getElementById('ai-insight');
    if (!text) { box.style.display = 'none'; return; }
    document.getElementById('ai-insight-text').innerHTML = text;
    box.style.display = 'block';
}


// ---- 11. Drawer navigation -------------------------------

function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('show');
}

function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('show');
}

function go(url) { closeDrawer(); window.location.href = url; }

function signOut() {
    localStorage.removeItem('hh_owner');
    localStorage.removeItem('hh_active_shop');
    window.location.href = '/owner/auth';
}


// ---- 12. Unread message dot ------------------------------

async function checkUnread() {
    const res  = await fetch(`/owner/unread-count?owner_id=${owner.id}`);
    const data = await res.json();
    if (data.count > 0) document.getElementById('msg-dot').classList.add('show');
}


// ---- 13. Toast notifications ----------------------------

function toast(msg, type = 'default') {
    const el = document.createElement('div');
    el.className = `toast ${type !== 'default' ? type : ''}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => {
        el.classList.add('out');
        setTimeout(() => el.remove(), 280);
    }, 2800);
}


// ---- 14. Shared helpers ---------------------------------

function setLoading(id, on) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('loading', on);
    btn.disabled = on;
}
