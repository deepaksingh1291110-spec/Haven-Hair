// ============================================================
// Haven Hair — dashboard_core.js
// Handles: auth check, init, shop info, status toggle,
//          drawer navigation, toast system, shared helpers
// ============================================================

// ---- Shared state (used by all dashboard files) ----------
const owner    = JSON.parse(localStorage.getItem('hh_owner') || 'null');
const SHOP_ID  = parseInt(localStorage.getItem('hh_active_shop') || '0');
let   shopData = null;   // full shop object from API
let   services = [];     // shop services (for add customer sheet)

// Auth guard — runs before DOM loads
if (!owner)   window.location.href = '/owner/auth';
if (!SHOP_ID) window.location.href = '/owner/branches';


// ---- Init ------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('drawer-name').textContent = owner.name;
    await loadShopInfo();
    loadChairs();          // dashboard_queue.js
    checkUnread();
});


// ---- Load shop info & score ------------------------------
async function loadShopInfo() {
    const res  = await fetch(`/shops/${SHOP_ID}`);
    const data = await res.json();
    if (!res.ok) return;

    shopData = data;

    // Header + dash-head
    document.getElementById('header-shop-name').textContent = data.name;
    document.getElementById('dash-shop-name').textContent   = data.name;
    document.getElementById('dash-shop-addr').textContent   = data.address || '';

    // Status toggle highlight
    setStatusHighlight(data.status);

    // Score strip
    if (data.reputation_score !== null && data.reputation_score !== undefined) {
        document.getElementById('score-strip').style.display = 'flex';
        document.getElementById('score-num').textContent     = data.reputation_score;
        document.getElementById('score-badge').textContent   = badgeLabel(data.reputation_score);

        const numEl = document.getElementById('score-num');
        // ✅ Updated color thresholds to match new categories
        numEl.style.color =
            data.reputation_score >= 70 ? 'var(--green)'  :
            data.reputation_score >= 30 ? 'var(--orange)' :
                                          'var(--red)';
    }


    // Preload services for add-customer sheet
    loadServices();
}

async function loadServices() {
    const res  = await fetch(`/shops/${SHOP_ID}/services`);
    const data = await res.json();
    if (res.ok) services = data;
}


// ---- Shop status toggle ----------------------------------
function setStatusHighlight(status) {
    ['open','busy','closed'].forEach(s => {
        const btn = document.getElementById(`st-${s}`);
        btn.className = 'st-btn' + (s === status ? ` active-${s}` : '');
    });
}

async function setShopStatus(status) {
    setStatusHighlight(status); // instant UI feedback

    const res = await fetch(`/shops/${SHOP_ID}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
    });

    if (!res.ok) {
        toast('Could not update status.', 'err');
        setStatusHighlight(shopData?.status || 'open'); // revert
    } else {
        if (shopData) shopData.status = status;
    }
}


// ---- Drawer ----------------------------------------------
function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('show');
}

function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('show');
}

function go(url) { closeDrawer(); window.location.href = url; }


// ---- Sign out --------------------------------------------
function signOut() {
    localStorage.removeItem('hh_owner');
    localStorage.removeItem('hh_active_shop');
    window.location.href = '/owner/auth';
}


// ---- Unread message dot ----------------------------------
async function checkUnread() {
    const res  = await fetch(`/owner/unread-count?owner_id=${owner.id}`);
    const data = await res.json();
    if (data.count > 0) document.getElementById('msg-dot').classList.add('show');
}


// ---- Toast -----------------------------------------------
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


// ---- Shared helpers --------------------------------------
function padToken(n) { return String(n).padStart(2, '0'); }

function fmtWait(mins) {
    if (!mins || mins <= 0) return 'Ready';
    if (mins < 60) return `~${Math.round(mins)} min`;
    return `~${(mins / 60).toFixed(1)} hr`;
}

function badgeLabel(score) {
    if (score >= 90) return '🏅 Top Rated';
    if (score >= 70) return '✓ Trusted';
    if (score >= 30) return '';
    return '⚠️ Warning';
}

function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function setLoading(id, on) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('loading', on);
    btn.disabled = on;
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
