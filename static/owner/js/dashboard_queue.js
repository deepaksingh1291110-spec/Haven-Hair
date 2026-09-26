// ============================================================
// Haven Hair — dashboard_queue.js
// Handles: load chairs, render chair cards, queue entries,
//          chair status toggle, auto-refresh, home service
//
// Fixes:
//   Fix 1  — version-based refresh: server returns {changed:false}
//             when the queue hasn't changed → client skips re-render.
//             Page Visibility API pauses polling when tab is hidden.
//   Fix 3  — "🏠 Home Service" button replaces "Add Barber/Chair";
//             full HS panel with masked phone, call/map, arrival time,
//             accept/reject.
// ============================================================

let refreshTimer = null;   // auto-refresh interval handle
let allChairs    = [];     // latest chairs data from API
let _qv          = 0;      // Fix 1: cached queue version from server


// Fix 10: 4-digit token formatting
function padToken(n) {
    return String(n).padStart(4, '0');
}


// ---- Load all chairs + queues (initial, full render) -----

async function loadChairs() {
    const res  = await fetch(`/queue/branch/${SHOP_ID}`);
    const data = await res.json();

    document.getElementById('dash-loader').style.display  = 'none';
    document.getElementById('chairs-wrap').style.display  = 'block';

    if (!res.ok || !data.chairs?.length) {
        document.getElementById('chair-cards').innerHTML = `
            <div class="empty-state" style="padding:32px 16px">
                <h3>No barbers yet</h3>
                <p>Add your first barber in Settings → Manage Staff</p>
            </div>`;
        loadHomeServiceRequests();
        return;
    }

    _qv       = data.v || 0;   // Fix 1: store initial version
    allChairs = data.chairs;

    renderChairCards(data.chairs);
    loadHomeServiceRequests();

    // Fix 1: auto-refresh every 8 seconds
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshQueue, 8000);

    // Fix 1: Page Visibility API — pause when tab hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        } else {
            _qv = 0;  // force a full refresh on tab restore
            refreshQueue();
            if (!refreshTimer) refreshTimer = setInterval(refreshQueue, 8000);
        }
    });
}


// ---- Fix 1: version-aware refresh -----------------------
//
// Passes cached version to server. If server returns
// {changed:false}, skips re-render to avoid flicker.

async function refreshQueue() {
    let url = `/queue/branch/${SHOP_ID}?v=${_qv}`;
    const res  = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();

    // Fix 1: unchanged — skip re-render
    if (data.changed === false) return;

    _qv       = data.v || 0;
    allChairs = data.chairs || [];

    const totalWaiting = allChairs.reduce((sum, c) => sum + (c.waiting || 0), 0);
    allChairs.forEach(chair => updateChairCard(chair, totalWaiting));
}


// ---- Render all chair cards (full build) -----------------

function renderChairCards(chairs) {
    document.getElementById('chair-cards').innerHTML =
        chairs.map((c, i) => buildChairCard(c, i)).join('');
}


// ---- Build one full chair card HTML ----------------------

function buildChairCard(chair, index) {
    const statusClass =
        chair.status === 'open'  ? 'is-active' :
        chair.status === 'break' ? 'is-break'  : 'is-closed';

    const totalWaiting = allChairs.reduce((sum, c) => sum + (c.waiting || 0), 0);

    return `
    <div class="chair-card ${statusClass}" id="chair-${chair.id}">

        <div class="chair-head" onclick="toggleChair(${chair.id})">
            <div class="chair-head-left">
                <span class="chair-num">${index + 1}</span>
                <div>
                    <div class="chair-name">${chair.barber_name}</div>
                    <div class="chair-count" id="chair-count-${chair.id}">
                        ${totalWaiting} waiting ·
                        ${chair.seated ? '1 in chair' : 'chair empty'}
                    </div>
                </div>
            </div>
            <div class="chair-head-right">
                <div class="chair-status-toggle" onclick="event.stopPropagation()">
                    <button class="cs-btn ${chair.status==='open'   ? 'on'  : ''}"
                            onclick="setChairStatus(${chair.id}, 'open')">On</button>
                    <button class="cs-btn ${chair.status==='break'  ? 'brk' : ''}"
                            onclick="setChairStatus(${chair.id}, 'break')">Brk</button>
                    <button class="cs-btn ${chair.status==='closed' ? 'off' : ''}"
                            onclick="setChairStatus(${chair.id}, 'closed')">Off</button>
                </div>
                <span class="chair-expand-arrow" id="arrow-${chair.id}">▼</span>
            </div>
        </div>

        <div class="chair-body" id="chair-body-${chair.id}">
            ${buildChairBody(chair)}
        </div>

    </div>`;
}


// ---- Build chair body (seated + buttons + queue) ---------

function buildChairBody(chair) {
    const seated  = chair.queue?.find(e => e.status === 'active');
    const waiting = chair.queue?.filter(e => e.status === 'waiting') || [];

    return `
        ${seated ? `
        <div class="seated-box">
            <div class="seated-info">
                <div class="seated-name">${escHtml(seated.name)}</div>
                <div class="seated-service">${seated.service || '—'}</div>
            </div>
            <div class="seated-token">${padToken(seated.token)}</div>
        </div>` : `
        <div class="no-seated">Chair is empty — tap Customer Sits when ready</div>`}

        <div class="tap-actions">
            <button class="tap-btn tap-sit"
                    id="btn-sit-${chair.id}"
                    onclick="customerSits(${chair.id})"
                    ${seated ? 'disabled' : ''}>
                💺 Customer<br>Sits
            </button>
            <button class="tap-btn tap-done"
                    id="btn-done-${chair.id}"
                    onclick="haircutDone(${chair.id})"
                    ${!seated ? 'disabled' : ''}>
                ✅ Haircut<br>Done
            </button>
            <button class="tap-btn tap-skip"
                    onclick="skipCustomer(${chair.id})"
                    ${!waiting.length ? 'disabled' : ''}>
                ⏭ Skip Next
            </button>
        </div>

        <div class="q-list" id="queue-${chair.id}">
            ${buildQueueList(waiting, chair.id)}
        </div>

        <div class="add-cust-bar">
            <button class="btn btn-outline btn-sm btn-auto"
                    onclick="openAddCustSheet(${chair.id}, '${chair.barber_name}')">
                ＋ Add Walk-in
            </button>
        </div>`;
}


// ---- Build queue entry list HTML -------------------------

function buildQueueList(entries, chairId) {
    if (!entries.length) {
        return '<div class="q-empty">Queue is empty</div>';
    }
    return entries.map((e, idx) => `
        <div class="q-entry ${e.source==='booking' ? 'is-booked' : ''}"
             id="qentry-${e.id}">
            <span class="q-pos">${padToken(e.token)}</span>
            <div class="q-info">
                <div class="q-name">
                    ${escHtml(e.name)}
                    <span class="q-type ${e.source==='booking' ? 'booked' : 'walkin'}">
                        ${e.source==='booking' ? 'Booked' : 'Walk-in'}
                    </span>
                    ${e.strikes ? `<span class="strike-badge">${e.strikes}⚠</span>` : ''}
                </div>
                <div class="q-svc">${e.service || '—'}</div>
            </div>
            <span class="q-wait">${fmtWait(e.wait_mins)}</span>
            <div class="q-actions">
                <button class="qa-btn reorder"
                        onclick="swapQueue(${e.id}, ${idx > 0 ? entries[idx-1].id : 0})"
                        ${idx === 0 ? 'disabled' : ''}
                        title="Move up">↑</button>
                <button class="qa-btn reorder"
                        onclick="swapQueue(${e.id}, ${idx < entries.length-1 ? entries[idx+1].id : 0})"
                        ${idx === entries.length-1 ? 'disabled' : ''}
                        title="Move down">↓</button>
                <button class="qa-btn move"   onclick="openMoveModal(${e.id}, '${escJs(e.name)}', ${chairId})">Move</button>
                <button class="qa-btn strike" onclick="strikeCustomer(${e.id})">⚠</button>
                <button class="qa-btn remove" onclick="removeCustomer(${e.id}, ${chairId})">✕</button>
                <button class="qa-btn chat"   onclick="openChat(${e.id})">💬</button>
            </div>
        </div>`
    ).join('');
}


// ---- Swap two queue entries (reorder) --------------------

async function swapQueue(idA, idB) {
    if (!idA || !idB) return;
    const res = await fetch('/queue/swap', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id_a: idA, id_b: idB }),
    });
    if (res.ok) { _qv = 0; refreshQueue(); }
    else         toast('Could not reorder', 'err');
}


// ---- Update one chair card after refresh -----------------

function updateChairCard(chair, totalWaiting) {
    const bodyEl = document.getElementById(`chair-body-${chair.id}`);
    if (!bodyEl) return;

    const countEl = document.getElementById(`chair-count-${chair.id}`);
    if (countEl) {
        const seated = chair.queue?.some(e => e.status === 'active');
        countEl.textContent =
            `${totalWaiting} waiting · ${seated ? '1 in chair' : 'chair empty'}`;
    }

    const newHtml = document.createElement('div');
    newHtml.innerHTML = buildChairBody(chair);
    morphdom(bodyEl, newHtml, { childrenOnly: true });
}

// ---- Toggle chair expand / collapse ----------------------

function toggleChair(chairId) {
    const card  = document.getElementById(`chair-${chairId}`);
    const arrow = document.getElementById(`arrow-${chairId}`);
    card.classList.toggle('expanded');
    if (arrow) arrow.textContent = card.classList.contains('expanded') ? '▲' : '▼';
}


// ---- Chair status (open / break / closed) ----------------

async function setChairStatus(chairId, status) {
    const res = await fetch(`/chairs/${chairId}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
    });

    if (res.ok) {
        const card = document.getElementById(`chair-${chairId}`);
        if (card) {
            card.className = card.className
                .replace(/is-active|is-break|is-closed/g, '').trim();
            card.classList.add(
                status === 'open'  ? 'is-active' :
                status === 'break' ? 'is-break'  : 'is-closed'
            );
        }
        const btns = document.querySelectorAll(`#chair-${chairId} .cs-btn`);
        btns.forEach(b => b.className = 'cs-btn');
        const idx = status === 'open' ? 0 : status === 'break' ? 1 : 2;
        if (btns[idx]) btns[idx].classList.add(
            status === 'open' ? 'on' : status === 'break' ? 'brk' : 'off'
        );
    } else {
        toast('Could not update chair status.', 'err');
    }
}


// ---- Fix 3: Home Service HS Panel -------------------------
//
// openHsSheet() opens the bottom sheet.
// Renders each request with:
//   - masked customer phone (pending) / real phone (accepted)
//   - Call button (accepted only), Map button (if GPS available)
//   - Arrival time input
//   - Accept / Reject buttons
//
// _hsRequests caches the last loaded list so openHsSheet()
// doesn't need a new fetch on every open.

let _hsRequests  = [];
let _hsBadgeCount = 0;

function openHsSheet() {
    document.getElementById('hs-sheet').classList.add('show');
    document.body.style.overflow = 'hidden';
    loadHomeServiceRequests();
}

function closeHsSheet() {
    document.getElementById('hs-sheet').classList.remove('show');
    document.body.style.overflow = '';
}

async function loadHomeServiceRequests() {
    const res  = await fetch(`/home-service/requests?shop_id=${SHOP_ID}`);
    const data = await res.json();

    // Update badge
    const pending = Array.isArray(data) ? data.filter(r => r.status === 'pending') : [];
    _hsBadgeCount = pending.length;
    const badge = document.getElementById('hs-badge');
    if (badge) {
        badge.textContent = _hsBadgeCount;
        badge.style.display = _hsBadgeCount > 0 ? 'inline-flex' : 'none';
    }

    _hsRequests = Array.isArray(data) ? data : [];

    const listEl = document.getElementById('hs-request-list');
    if (!listEl) return;

    if (!_hsRequests.length) {
        listEl.innerHTML = `
            <div class="empty-state" style="padding:24px 16px;text-align:center">
                <p style="color:var(--text-muted)">No home service requests</p>
            </div>`;
        return;
    }

    // Get all active chairs for assigning barber
    const chairOptions = allChairs.map(c =>
        `<option value="${c.id}">${c.barber_name}</option>`
    ).join('');

    listEl.innerHTML = _hsRequests.map(r => {
        const isPending  = r.status === 'pending';
        const isAccepted = r.status === 'accepted';
        const phone      = r.customer_phone || '';
        const hasGps     = r.lat && r.lon;
        const mapUrl     = hasGps
            ? `https://www.google.com/maps?q=${r.lat},${r.lon}`
            : `https://www.google.com/maps?q=${encodeURIComponent(r.address || '')}`;

        return `
        <div class="home-req-card" id="hs-req-${r.id}">
            <div class="home-req-header">
                <div class="home-req-name">${r.customer_name}</div>
                <span class="home-req-status status-${r.status}">${r.status}</span>
            </div>
            <div class="home-req-detail">
                📍 ${r.address || 'No address'} · ✂️ ${r.service || '—'}
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">
                ✂️ Barber: <span style="color:var(--amber)">${
                r.accepted_by_chair_id
                    ? (allChairs.find(c => c.id === r.accepted_by_chair_id)?.barber_name || 'Assigned')
                    : 'Not assigned yet'
                }</span>
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">
                🕐 Requested: <span style="color:var(--text)">${
                    new Date(r.created_at).toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})
                } · ${new Date(r.created_at).toLocaleDateString('en-GB', {day:'numeric', month:'short'})}</span>
            </div>
            ${r.note ? `<div class="home-req-note">"${r.note}"</div>` : ''}

            <!-- Phone (masked on pending, real on accepted) -->
            <div class="home-req-phone">
                📞 ${isPending ? `<span style="color:var(--text-muted)">${phone} (masked)</span>`
                               : `<a href="tel:${phone}" style="color:var(--amber)">${phone}</a>`}
                ${isAccepted ? `<a href="tel:${phone}" class="btn btn-outline btn-sm btn-auto" style="margin-left:8px">
                    📞 Call</a>` : ''}
                ${r.arrival_time ? `<span style="color:var(--amber);font-size:0.78rem;margin-left:8px">
                    🕐 ETA: ${r.arrival_time}</span>` : ''}
            </div>

            <!-- GPS map link -->
            <div class="home-req-actions" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
                <a href="${mapUrl}" target="_blank" class="btn btn-outline btn-sm btn-auto">
                    🗺️ ${hasGps ? 'GPS Map' : 'Map'}
                </a>

                ${isPending ? `
                    <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:140px">
                        <select id="hs-chair-${r.id}" class="form-control"
                                style="flex:1;padding:6px 8px;font-size:0.8rem">
                            <option value="">— Assign barber —</option>
                            ${chairOptions}
                        </select>
                    </div>
                    <input type="text" id="hs-arrival-${r.id}"
                           placeholder="ETA (e.g. 3:30 PM)"
                           style="flex:1;min-width:120px;padding:6px 10px;font-size:0.8rem;
                                  background:var(--surface-2);border:1px solid var(--border);
                                  border-radius:var(--radius-sm);color:var(--text)">
                    <button class="btn btn-primary btn-sm btn-auto"
                            onclick="acceptHs(${r.id})">✅ Accept</button>
                    <button class="btn btn-danger btn-sm btn-auto"
                            onclick="rejectHs(${r.id})">✕</button>
                ` : ''}

                ${isAccepted ? `
                    <div style="width:100%;display:flex;flex-direction:column;gap:6px;margin-top:4px">
                        <!-- Reassign barber -->
                        <div style="display:flex;gap:6px;align-items:center">
                            <select id="hs-chair-${r.id}"
                                    style="flex:1;padding:6px 8px;font-size:0.8rem;
                                           background:var(--surface-2);border:1px solid var(--border);
                                           border-radius:var(--radius-sm);color:var(--text)">
                                <option value="">— Reassign barber —</option>
                                ${chairOptions}
                            </select>
                            <button class="btn btn-outline btn-sm btn-auto"
                                    onclick="reassignHsBarber(${r.id})">
                                ✂️ Assign
                            </button>
                        </div>
                        <!-- Update ETA -->
                        <div style="display:flex;gap:6px;align-items:center">
                            <input type="text" id="hs-arrival-${r.id}"
                                   placeholder="${r.arrival_time ? 'Update ETA (e.g. 3:30 PM)' : 'Set ETA (e.g. 3:30 PM)'}"
                                   style="flex:1;padding:6px 10px;font-size:0.8rem;
                                          background:var(--surface-2);border:1px solid var(--border);
                                          border-radius:var(--radius-sm);color:var(--text)">
                            <button class="btn btn-outline btn-sm btn-auto"
                                    onclick="setHsArrival(${r.id})">
                                ${r.arrival_time ? '✏️ Update ETA' : 'Set ETA'}
                          </button>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center">
                            <input type="text" id="hs-otp-${r.id}"
                                   placeholder="Enter 4-digit OTP from customer"
                                   maxlength="4"
                                   style="flex:1;padding:6px 10px;font-size:0.9rem;
                                          letter-spacing:4px;text-align:center;
                                          background:var(--surface-2);border:1px solid var(--border);
                                          border-radius:var(--radius-sm);color:var(--text)">
                            <button class="btn btn-primary btn-sm btn-auto"
                                    onclick="completeHsService(${r.id})">
                                ✅ Done
                            </button>
                        </div>
                    </div>
                ` : ''}
           </div>
        </div>`;
    }).join('');
}

async function acceptHs(reqId) {
    const chairId    = parseInt(document.getElementById(`hs-chair-${reqId}`)?.value || '0');
    const arrivalRaw = document.getElementById(`hs-arrival-${reqId}`)?.value?.trim();

    const res = await fetch(`/home-service/${reqId}/accept`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chair_id: chairId || null }),
    });

    if (!res.ok) { toast('Could not accept request.', 'err'); return; }

    // Set arrival time if provided
    if (arrivalRaw) {
        await fetch(`/home-service/${reqId}/set-arrival`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ arrival_time: arrivalRaw }),
        });
    }

    toast('Request accepted.', 'ok');
    loadHomeServiceRequests();
}

async function rejectHs(reqId) {
    const res = await fetch(`/home-service/${reqId}/reject`, { method: 'PATCH' });
    if (res.ok) { toast('Request rejected.', 'ok'); loadHomeServiceRequests(); }
    else         toast('Could not reject request.', 'err');
}

async function setHsArrival(reqId) {
    const arrival = document.getElementById(`hs-arrival-${reqId}`)?.value?.trim();
    if (!arrival) { toast('Enter an arrival time first.', 'err'); return; }
    const res = await fetch(`/home-service/${reqId}/set-arrival`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ arrival_time: arrival }),
    });
    if (res.ok) { toast('ETA set.', 'ok'); loadHomeServiceRequests(); }
    else         toast('Could not set ETA.', 'err');
}

async function completeHsService(reqId) {
    const otp = document.getElementById(`hs-otp-${reqId}`)?.value?.trim();
    if (!otp || otp.length !== 4) {
        toast('Please enter the 4-digit OTP.', 'err');
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
        loadHomeServiceRequests();
    } else {
        toast(data.error || 'Invalid OTP. Try again.', 'err');
    }
}

async function reassignHsBarber(reqId) {
    const chairId = parseInt(document.getElementById(`hs-chair-${reqId}`)?.value || '0');
    if (!chairId) { toast('Please select a barber first.', 'err'); return; }

    const res = await fetch(`/home-service/${reqId}/accept`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chair_id: chairId }),
    });

    if (res.ok) { toast('Barber reassigned.', 'ok'); loadHomeServiceRequests(); }
    else         toast('Could not reassign barber.', 'err');
}

// ---- Cleanup on page leave -------------------------------

window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
});
