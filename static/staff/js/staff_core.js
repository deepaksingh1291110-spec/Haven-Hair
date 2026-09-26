// ============================================================
// HAVEN HAIR — staff_core.js
// Staff Dashboard — Core Logic
//
// Fixes:
//   Fix 3  — "🏠 Home Service" button in action area opens the
//             HS sheet with full request details (masked phone,
//             call/map, accept/reject, set arrival time).
//   Fix 5  — polls /home-service/new-count every 20 s;
//             shows badge + toast when new requests arrive.
//
// Depends on:
//   - staff_queue.js    (loadQueue)
//   - staff_actions.js  (sitAction, doneAction, openAddCustSheet)
// ============================================================


// ---- 1. Shared state & auth guard ------------------------

const staff = JSON.parse(localStorage.getItem('hh_staff') || 'null');
if (!staff || staff.role !== 'staff') window.location.href = '/owner/auth';

const CHAIR_ID = staff.chair_id;
const SHOP_ID  = staff.shop_id;

let chairData     = null;
let activeEntry   = null;
let timerInterval = null;

// Fix 5: HS polling state
let _lastHsId       = 0;
let _hsPollingTimer = null;
let _hsRequests     = [];
let _hsBadgeCount   = 0;

// ---- 2. Init ---------------------------------------------

// loadChairInfo() now resolves cleanly in every case (handles its
// own errors internally), so the lines below always execute.

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('header-shop-name').textContent = staff.shop_name || '—';
    document.getElementById('staff-greeting').textContent   = greeting(staff.name);

    await loadChairInfo();   // ✅ never rejects now — try/catch/finally inside

    // ✅ These now run unconditionally, even if the chair load failed
    _pollHsRequests();
    _hsPollingTimer = setInterval(_pollHsRequests, 20000);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (_hsPollingTimer) { clearInterval(_hsPollingTimer); _hsPollingTimer = null; }
        } else {
            _lastHsId = 0;
            _pollHsRequests();
            if (!_hsPollingTimer) _hsPollingTimer = setInterval(_pollHsRequests, 20000);
        }
    });
});

function greeting(name) {
    const h = new Date().getHours();
    if (h < 12) return `Good morning, ${name} ☀️`;
    if (h < 17) return `Good afternoon, ${name}`;
    return `Good evening, ${name} 🌙`;
}


// ---- Load chair info from API ----------------------------

// ok checked before parsing, full try/catch/finally,
// loader ALWAYS hides regardless of outcome.

async function loadChairInfo() {
    try {
        const res = await fetch(`/chairs/${CHAIR_ID}`);

        // ✅ Check ok BEFORE .json() — avoids SyntaxError on HTML error pages
        // (Flask's built-in 404 for bad route params, or unhandled 500s
        // from e.g. a locked SQLite write during the nightly scheduler)
        if (!res.ok) {
            toast('Could not load chair info. Please refresh.', 'err');
            return;
        }

        const data = await res.json();  // ✅ safe — response already confirmed ok

        chairData = data;
        document.getElementById('staff-chair-label').textContent =
            `${data.barber_name || 'My Chair'} · ${staff.shop_name}`;
        document.getElementById('chair-barber-name').textContent = staff.name;

        activeEntry = data.active_entry || null;

        renderActionButtons();
        renderCurrentCustomer();
        loadQueue();   // staff_queue.js

    } catch (err) {
        // ✅ Catches network failures, JSON parse errors, or anything
        // thrown deeper in render*() — barber always gets feedback
        console.error('[staff] loadChairInfo failed:', err);
        toast('Connection error — please refresh the page.', 'err');

    } finally {
        // ✅ ALWAYS hides spinner — success, early return, or thrown error
        // Barber is never permanently locked on the loading screen
        document.getElementById('staff-loader').style.display  = 'none';
        document.getElementById('staff-content').style.display = 'block';
    }
}

// ---- 3. Render action buttons ----------------------------
//
// States: A) no one seated → [Sits]   B) seated → [Done]
//         C) closed → [Tap to Open]
// Fix 3: always include 🏠 Home Service button.

function renderActionButtons() {
    const container = document.getElementById('chair-actions');
    const isClosed  = chairData?.status === 'closed';

    if (isClosed) {
        container.innerHTML = `
        <button class="action-btn action-closed" onclick="toggleChairStatus()">
            🔴 Chair Closed — Tap to Open
        </button>
        ${_hsBtn()}`;
        document.getElementById('chair-status-label').textContent = 'Closed';
    } else if (activeEntry) {
        container.innerHTML = `
        <button class="action-btn action-done" id="done-btn" onclick="doneAction()">
            ✅ Haircut Done
        </button>
        <button class="action-btn-secondary" onclick="toggleChairStatus()">
            🔴 Close Chair
        </button>
        ${_hsBtn()}`;
        document.getElementById('chair-status-label').textContent = 'Cutting now';
    } else {
        container.innerHTML = `
        <button class="action-btn action-sit" id="sit-btn" onclick="sitAction()">
            💺 Customer Sits
        </button>
        <button class="action-btn-secondary" onclick="toggleChairStatus()">
            🔴 Close Chair
        </button>
        ${_hsBtn()}`;
        document.getElementById('chair-status-label').textContent = 'Ready';
    }

    // ✅ Restore badge after every DOM rebuild
    // _hsBadgeCount persists across rebuilds — badge never silently lost
    if (_hsBadgeCount > 0) {
        const badge = document.getElementById('hs-badge');
        if (badge) {
            badge.textContent = _hsBadgeCount;
            badge.style.display = 'inline-flex';
        }
    }
}

function _hsBtn() {
    return `
    <button class="action-btn-secondary hs-action-btn" onclick="openHsSheet()"
            style="position:relative;display:flex;align-items:center;justify-content:center;gap:6px">
        🏠 Home Service
        <span id="hs-badge" style="display:none;position:absolute;top:6px;right:6px;
              background:var(--amber);color:#0a0806;border-radius:50%;
              width:18px;height:18px;font-size:0.62rem;font-weight:700;
              align-items:center;justify-content:center;line-height:1"></span>
    </button>`;
}


// ---- 4. Chair availability toggle ------------------------

async function toggleChairStatus() {
    const isClosed  = chairData?.status === 'closed';
    const newStatus = isClosed ? 'open' : 'closed';
    const res = await fetch(`/chairs/${CHAIR_ID}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
        chairData.status = newStatus;
        renderActionButtons();
        toast(newStatus === 'open' ? 'Chair is now open.' : 'Chair closed.', 'ok');
    } else {
        toast('Could not update chair status.', 'err');
    }
}


// ---- Render current customer row -------------------------

function renderCurrentCustomer() {
    const row = document.getElementById('current-customer-row');
    if (!activeEntry) {
        row.style.display = 'none';
        stopTimer();
        return;
    }
    row.style.display = 'block';
    document.getElementById('cc-name').textContent    = activeEntry.name    || '—';
    document.getElementById('cc-service').textContent = activeEntry.service || '—';
    startTimer(activeEntry.sat_at || new Date().toISOString());
    updateQueueBadge();
}


// ---- 5. Active customer timer ----------------------------

function startTimer(satAtIso) {
    stopTimer();
    const satAt = new Date(satAtIso);
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - satAt) / 1000);
        const mins    = Math.floor(elapsed / 60);
        const secs    = elapsed % 60;
        const el      = document.getElementById('cc-timer');
        if (el) el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    const el = document.getElementById('cc-timer');
    if (el) el.textContent = '0:00';
}

function updateQueueBadge(count) {
    const badge = document.getElementById('chair-queue-count');
    if (badge && count !== undefined) badge.textContent = count;
}


// ---- Fix 5: HS request polling ---------------------------

async function _pollHsRequests() {
    try {
        const res  = await fetch(`/home-service/new-count?shop_id=${SHOP_ID}&since=${_lastHsId}`);
        const data = await res.json();

        if (data.count > 0) {
            _lastHsId     = data.latest_id;
            _hsBadgeCount = data.count;   // ✅ persist count so rebuild can restore it
            toast(`🏠 ${data.count} new home service request${data.count > 1 ? 's' : ''}`, 'ok');
            const badge = document.getElementById('hs-badge');
            if (badge) {
                badge.textContent   = data.count;
                badge.style.display = 'inline-flex';
            }
        }
    } catch { /* network error — ignore */ }
}

// ---- Fix 3: Home Service sheet ---------------------------

async function openHsSheet() {
    _hsBadgeCount = 0;   // ✅ staff has seen the requests — clear count
    document.getElementById('hs-sheet').classList.add('show');
    document.body.style.overflow = 'hidden';
    await _loadHsRequests();
    // Clear badge once opened
    const badge = document.getElementById('hs-badge');
    if (badge) badge.style.display = 'none';
}

function closeHsSheet() {
    document.getElementById('hs-sheet').classList.remove('show');
    document.body.style.overflow = '';
}

async function _loadHsRequests() {
    const listEl = document.getElementById('staff-hs-list');
    if (!listEl) return;

    listEl.innerHTML = '<div class="loading-state" style="padding:16px"><div class="spinner"></div></div>';

    const res  = await fetch(`/home-service/requests?shop_id=${SHOP_ID}`);
    const data = await res.json();

    _hsRequests = Array.isArray(data) ? data : [];

    if (!_hsRequests.length) {
        listEl.innerHTML = `
            <div style="padding:24px;text-align:center;color:var(--text-muted)">
                No home service requests
            </div>`;
        return;
    }

    listEl.innerHTML = _hsRequests.map(r => {
        const isPending  = r.status === 'pending';
        const isAccepted = r.status === 'accepted';
        const phone      = r.customer_phone || '';
        const hasGps     = r.lat && r.lon;
        const mapUrl     = hasGps
            ? `https://www.google.com/maps?q=${r.lat},${r.lon}`
            : `https://www.google.com/maps?q=${encodeURIComponent(r.address || '')}`;

        return `
        <div class="home-req-card" style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <strong>${r.customer_name}</strong>
                <span style="font-size:0.72rem;color:var(--amber);text-transform:uppercase;letter-spacing:1px">${r.status}</span>
            </div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px">
                📍 ${r.address || '—'} · ✂️ ${r.service || '—'}
            </div>
            ${r.note ? `<div style="font-size:0.8rem;font-style:italic;color:var(--text-muted);margin-bottom:6px">"${r.note}"</div>` : ''}
            <div style="font-size:0.82rem;margin-bottom:8px">
                📞 ${isPending
                    ? `<span style="color:var(--text-muted)">${phone} (masked)</span>`
                    : `<a href="tel:${phone}" style="color:var(--amber)">${phone}</a>`}
                ${r.arrival_time ? `&nbsp; 🕐 ETA: <strong>${r.arrival_time}</strong>` : ''}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
                <a href="${mapUrl}" target="_blank" class="btn btn-outline btn-sm btn-auto">
                    🗺️ ${hasGps ? 'GPS Map' : 'Map'}
                </a>
                ${isAccepted ? `
                    <a href="tel:${phone}" class="btn btn-outline btn-sm btn-auto">📞 Call</a>
                    <div style="display:flex;gap:6px;width:100%;margin-top:6px;align-items:center">
                        <input type="text"
                               id="shs-otp-${r.id}"
                               placeholder="Enter OTP from customer"
                               maxlength="4"
                               style="flex:1;padding:6px 10px;font-size:0.9rem;
                                      letter-spacing:4px;text-align:center;
                                      background:var(--surface);border:1px solid var(--border);
                                      border-radius:var(--radius-sm);color:var(--text)">
                        <button class="btn btn-primary btn-sm btn-auto"
                                onclick="staffCompleteHs(${r.id})">✅ Done</button>
                    </div>
                ` : ''}
                ${isPending ? `
                    <input type="text" id="shs-arrival-${r.id}"
                           placeholder="ETA (e.g. 3:30 PM)"
                           style="flex:1;min-width:110px;padding:6px 10px;font-size:0.8rem;
                                  background:var(--surface);border:1px solid var(--border);
                                  border-radius:var(--radius-sm);color:var(--text)">
                    <button class="btn btn-primary btn-sm btn-auto"
                            onclick="staffAcceptHs(${r.id})">✅ Accept</button>
                    <button class="btn btn-danger btn-sm btn-auto"
                            onclick="staffRejectHs(${r.id})">✕ Reject</button>
                ` : ''}
                ${isAccepted && !r.arrival_time ? `
                    <input type="text" id="shs-arrival-${r.id}"
                           placeholder="Set ETA"
                           style="flex:1;min-width:110px;padding:6px 10px;font-size:0.8rem;
                                  background:var(--surface);border:1px solid var(--border);
                                  border-radius:var(--radius-sm);color:var(--text)">
                    <button class="btn btn-outline btn-sm btn-auto"
                            onclick="staffSetArrival(${r.id})">Set ETA</button>
                ` : ''}
            </div>
        </div>`;
    }).join('');
}

async function staffAcceptHs(reqId) {
    const arrivalRaw = document.getElementById(`shs-arrival-${reqId}`)?.value?.trim();
    const res = await fetch(`/home-service/${reqId}/accept`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chair_id: CHAIR_ID }),
    });
    if (!res.ok) { toast('Could not accept request.', 'err'); return; }
    if (arrivalRaw) {
        await fetch(`/home-service/${reqId}/set-arrival`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ arrival_time: arrivalRaw }),
        });
    }
    toast('Request accepted.', 'ok');
    _loadHsRequests();
}

async function staffRejectHs(reqId) {
    const res = await fetch(`/home-service/${reqId}/reject`, { method: 'PATCH' });
    if (res.ok) { toast('Request rejected.', 'ok'); _loadHsRequests(); }
    else         toast('Could not reject.', 'err');
}

async function staffSetArrival(reqId) {
    const arrival = document.getElementById(`shs-arrival-${reqId}`)?.value?.trim();
    if (!arrival) { toast('Enter an ETA first.', 'err'); return; }
    const res = await fetch(`/home-service/${reqId}/set-arrival`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ arrival_time: arrival }),
    });
    if (res.ok) { toast('ETA set.', 'ok'); _loadHsRequests(); }
    else         toast('Could not set ETA.', 'err');
}

async function staffCompleteHs(reqId) {
    const otp = document.getElementById(`shs-otp-${reqId}`)?.value?.trim();
    if (!otp || otp.length !== 4) {
        toast('Enter the 4-digit OTP from the customer.', 'err');
        return;
    }
    const res = await fetch(`/home-service/${reqId}/complete`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ otp }),
    });
    const data = await res.json();
    if (res.ok) {
        toast('✅ Home service completed!', 'ok');
        _loadHsRequests();
    } else {
        toast(data.error || 'Invalid OTP. Try again.', 'err');
    }
}

// ---- 6. Sign out ----------------------------------------

function confirmSignOut() {
    document.getElementById('signout-modal').classList.add('show');
}
function closeSignOutModal() {
    document.getElementById('signout-modal').classList.remove('show');
}
function signOut() {
    stopTimer();
    if (_hsPollingTimer) clearInterval(_hsPollingTimer);
    localStorage.removeItem('hh_staff');
    window.location.href = '/owner/auth';
}


// ---- 7. Toast -------------------------------------------

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


// ---- 8. Shared helpers ----------------------------------

function setLoading(id, on) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('loading', on);
    btn.disabled = on;
}

function setAlert(containerId, msg, type = 'err') {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}
