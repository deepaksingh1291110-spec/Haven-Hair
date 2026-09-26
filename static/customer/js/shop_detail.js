// ============================================================
// Haven Hair — shop_detail.js
//
// Sections:
//   1.  State
//   2.  Init
//   3.  Shop info
//   4.  Price list
//   5.  Barber selection
//   6.  Rules check
//   7.  Join queue flow          (Fix 7: one-booking-per-customer)
//   8.  Token display + cancel
//   9.  Smart arrival
//  10.  Live queue display       (Fix 10: hide other customers' tokens)
//  11.  Home service             (Fix 4: GPS, Fix 6: masked phone)
//  12.  Favourites
//  13.  Map (Leaflet)
//  14.  Reviews
// ============================================================


// --- 1. State ---------------------------------------------

let shopData      = null;
let services      = [];
let pickedBarber  = null;
let pickedService = null;
let pickedStar    = 0;
let pendingRules  = null;
let queueRefresh  = null;
let cancelTimer   = null;
let leafletMap    = null;
let userLat       = null;
let userLon       = null;

// Fix 7: pending "cancel other + join" flow
let _conflictEntryId  = null;
let _conflictShopName = null;

// Fix 4: GPS coordinates captured on HS form
let _hsLat = null;
let _hsLon = null;
let _hsRules = null;

// --- 2. Init ----------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    if (!Auth.isLoggedIn() && !Auth.isGuest()) {
        window.location.replace('/customer/auth');
        return;
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            userLat = pos.coords.latitude;
            userLon = pos.coords.longitude;
        }, () => {}, { timeout: 6000, maximumAge: 120000 });
    }

    await loadShopInfo();
    loadPrices();
    loadBarbers();
    loadQueue();
    loadReviews();
    checkFavourite();
    loadHomeService();

    await restoreQueueSession();

    queueRefresh = setInterval(loadQueue, 10000);
});

window.addEventListener('beforeunload', () => {
    if (queueRefresh) clearInterval(queueRefresh);
    if (cancelTimer)  clearInterval(cancelTimer);
});


// --- 3. Shop info -----------------------------------------

async function loadShopInfo() {
    const { ok, data } = await API.get(`/shops/${SHOP_ID}`);

    if (!ok) {
        document.getElementById('page-loader').innerHTML =
            '<p style="color:var(--red)">Could not load shop. Try again.</p>';
        return;
    }

    shopData = data;

    document.getElementById('header-title').textContent = data.name;
    document.getElementById('shop-name').textContent    = data.name;
    document.getElementById('shop-addr').textContent    = data.address;

    const pill = document.getElementById('status-pill');
    pill.textContent = Format.status(data.status);
    pill.className   = `pill pill-${data.status}`;

    document.getElementById('shop-badge').textContent = Format.badge(data.reputation_score);
    document.getElementById('shop-dist').textContent  = data.distance_km
        ? '📍 ' + Format.distance(data.distance_km) + ' away'
        : '';

    document.getElementById('stat-score').textContent = data.reputation_score || '—';

    if (data.status === 'closed') {
        document.getElementById('closed-bar').classList.add('show');
        document.getElementById('join-card').style.display = 'none';
    }

    const customer = Auth.get();
    document.getElementById('booking-as').textContent = customer
        ? `Booking as ${customer.name}`
        : 'Guest booking';

    if (customer) {
        document.getElementById('guest-fields').style.display = 'none';
    }

    document.getElementById('page-loader').style.display  = 'none';
    document.getElementById('page-content').style.display = 'block';

    if (data.lat && data.lon) initMap(data.lat, data.lon);
}


// --- 4. Price list ----------------------------------------

async function loadPrices() {
    const { ok, data } = await API.get(`/shops/${SHOP_ID}/services`);

    if (!ok || !data.length) {
        document.getElementById('price-list').innerHTML =
            '<p style="color:var(--text-muted);font-size:0.82rem;padding:6px 0">No prices listed yet.</p>';
        return;
    }

    services = data;

    document.getElementById('price-list').innerHTML = data.map(s => `
        <div class="price-row">
            <span class="price-icon">${s.icon || '✂️'}</span>
            <span class="price-name">${s.service}</span>
            <span class="price-duration">~${s.duration_mins || '?'} min</span>
            <span class="price-amount">${s.price ? 'SAR ' + s.price : 'Ask'}</span>
        </div>
    `).join('');

    document.getElementById('service-grid').innerHTML = data.map(s => `
        <button class="svc-btn" onclick="pickService('${s.service}', this)">
            <div>${s.icon || '✂️'}</div>
            <div>${s.service}</div>
            <div style="font-size:0.65rem;color:var(--amber);margin-top:2px">
                ${s.price ? 'SAR ' + s.price : ''}
            </div>
        </button>
    `).join('');
}

function togglePrices() {
    const list  = document.getElementById('price-list');
    const arrow = document.getElementById('price-arrow');
    const open  = list.classList.toggle('open');
    arrow.classList.toggle('open', open);
}

function pickService(name, el) {
    pickedService = name;
    document.querySelectorAll('.svc-btn').forEach(b => b.classList.remove('picked'));
    el.classList.add('picked');
}


// --- 5. Barber selection ----------------------------------

async function loadBarbers() {
    const { ok, data } = await API.get(`/queue/branch/${SHOP_ID}`);

    if (data?.changed === false) return;  

    if (!ok || !data.chairs?.length) {
        document.getElementById('barber-list').innerHTML =
            '<p style="color:var(--text-muted);font-size:0.82rem">No barbers listed.</p>';
        return;
    }

    document.getElementById('barber-list').innerHTML = data.chairs.map(chair => {
        const statusLabel =
            chair.status === 'open'  ? `${chair.waiting} waiting · Ready` :
            chair.status === 'break' ? `${chair.waiting} waiting · ☕ On Break` :
                                       `${chair.waiting} waiting · 🔴 Closed`;

        const statusColor =
            chair.status === 'open'  ? 'var(--text-muted)' :
            chair.status === 'break' ? 'var(--orange)'     :
                                       'var(--red)';

        return `
            <div class="barber-item" id="barber-${chair.id}"
                 onclick="pickBarber(${chair.id}, '${chair.barber_name}', 
                          ${chair.waiting}, ${chair.wait_mins || 0}, '${chair.status}')">
                <div class="barber-avatar">✂️</div>
                <div class="barber-info">
                    <div class="barber-name">${chair.barber_name}</div>
                    <div class="barber-wait" style="color:${statusColor}">
                        ${statusLabel}
                    </div>
                </div>
                <div class="barber-radio"></div>
            </div>`;
    }).join('');
}

function pickBarber(chairId, name, waiting, waitMins, status) {
    if (status === 'closed') {
        showChairModal('closed', name, chairId, waiting, waitMins);
        return;
    }
    if (status === 'break') {
        showChairModal('break', name, chairId, waiting, waitMins);
        return;
    }
    proceedPickBarber(chairId, name, waiting, waitMins);
}

// Extracted from old pickBarber — actual booking logic
function proceedPickBarber(chairId, name, waiting, waitMins) {
    pickedBarber = { chairId, name, waiting, waitMins };
    document.querySelectorAll('.barber-item')
            .forEach(el => el.classList.remove('picked'));
    document.getElementById(`barber-${chairId}`)?.classList.add('picked');
    setTimeout(() => {
        document.getElementById('step-barber').style.display  = 'none';
        document.getElementById('step-service').style.display = 'block';
        document.getElementById('sel-barber-name').textContent = name;
        document.getElementById('sel-barber-wait').textContent =
            `${waiting} waiting · ${Format.wait(waitMins)}`;
        document.getElementById('sel-barber-bar').classList.add('show');
    }, 180);
}

function showChairModal(type, name, chairId, waiting, waitMins) {
    const modal   = document.getElementById('chair-status-modal');
    const title   = document.getElementById('chair-modal-title');
    const msg     = document.getElementById('chair-modal-msg');
    const confirm = document.getElementById('chair-modal-confirm');

    if (type === 'closed') {
        title.textContent     = '🔴 Chair Closed';
        msg.textContent       = `${name} is currently closed. Please choose another barber.`;
        confirm.style.display = 'none';
    }

    if (type === 'break') {
        title.textContent     = '☕ On Break';
        msg.textContent       = `${name} is on break. If you book now you must wait longer. Continue?`;
        confirm.style.display = '';
        confirm.onclick       = () => {
            closeChairModal();
            proceedPickBarber(chairId, name, waiting, waitMins);
        };
    }

    modal.classList.add('show');
    lockScroll();
}

function closeChairModal() {
    document.getElementById('chair-status-modal').classList.remove('show');
    unlockScroll();
}

function resetBarber() {
    pickedBarber  = null;
    pickedService = null;
    document.getElementById('step-service').style.display = 'none';
    document.getElementById('step-barber').style.display  = 'block';
    document.querySelectorAll('.barber-item').forEach(el => el.classList.remove('picked'));
    document.querySelectorAll('.svc-btn').forEach(b => b.classList.remove('picked'));
}


// --- 6. Rules check ---------------------------------------

async function checkRules() {
    const { ok, data } = await API.get(`/shops/${SHOP_ID}/rules`);
    if (!ok || !data.rules_text) return true;
    const key = `hh_rules_${SHOP_ID}_v${data.rules_version}`;
    if (localStorage.getItem(key) === 'accepted') return true;
    pendingRules = data;
    document.getElementById('rules-body').textContent = data.rules_text;
    document.getElementById('rules-overlay').classList.add('show');
    lockScroll();
    return false;
}

function closeRules() {
    document.getElementById('rules-overlay').classList.remove('show');
    unlockScroll();
    pendingRules = null;
    // Restore defaults
    document.querySelector('.rules-sheet-head h3').textContent = 'Shop Rules';
    document.querySelector('.rules-footer button').onclick = acceptRules;
}

function acceptRules() {
    if (!pendingRules) return;
    const key = `hh_rules_${SHOP_ID}_v${pendingRules.rules_version}`;
    localStorage.setItem(key, 'accepted');
    closeRules();
    doJoinQueue();
}


// --- 7. Join queue flow -----------------------------------

async function startJoinFlow() {
    if (!pickedBarber)  { showJoinAlert('Please select a barber first.'); return; }
    if (!pickedService) { showJoinAlert('Please select a service.'); return; }

    const customer = Auth.get();
    if (!customer) {
        const name = document.getElementById('join-name').value.trim();
        if (!name) { showJoinAlert('Please enter your name.'); return; }
    }

    const passed = await checkRules();
    if (!passed) return;

    doJoinQueue();
}

// Cancel result checked before anything is cleared.
// On failure: state kept intact, user shown error, return early.
// On success: state cleared, proceed to join.

async function doJoinQueue(forceCancel = false) {
    const customer = Auth.get();
    const name  = customer ? customer.name  : document.getElementById('join-name').value.trim();
    const phone = customer ? customer.phone : document.getElementById('join-phone').value.trim();

    // Fix 7 + Fix 15: cancel existing booking before joining new one
    if (forceCancel && _conflictEntryId) {
        const { ok: cancelOk } = await API.delete(`/queue/cancel/${_conflictEntryId}`);

        if (!cancelOk) {
            // ✅ Cancel failed — keep ALL state intact so user can retry.
            // Do NOT clear Queue or _conflictEntryId.
            // User still has their original booking and can try again.
            Toast.err('Could not cancel your existing booking. Please try again.');
            return;
        }

        // ✅ Cancel confirmed by server — now safe to clear local state
        Queue.clear();
        _conflictEntryId  = null;
        _conflictShopName = null;
    }

    setJoinLoading(true);

    const { ok, data, status } = await API.post('/queue/join', {
        shop_id:  SHOP_ID,
        chair_id: pickedBarber.chairId,
        service:  pickedService,
        name,
        phone,
    });

    setJoinLoading(false);

    // Fix 7: already booked at a DIFFERENT shop
    if (!ok && status === 409 && data.error === 'already_booked') {
        _conflictEntryId  = data.other_entry_id;
        _conflictShopName = data.other_shop || 'another shop';
        showConflictModal(_conflictShopName);
        return;
    }

    if (!ok) {
        showJoinAlert(data.error || 'Could not join queue. Try again.');

        // Fix 8: show penalty/ban info in a better way
        if (data.error?.includes('credit') || data.error?.includes('suspended')) {
            showJoinAlert(`⛔ ${data.error}`);
        }
        return;
    }

    Queue.save({
        entryId:    data.entry_id,
        token:      data.token,
        shopId:     SHOP_ID,
        shopName:   shopData.name,
        chairId:    pickedBarber.chairId,
        barberName: pickedBarber.name,
        service:    pickedService,
        joinedAt:   Date.now(),
        phone:      Auth.get()?.phone || null,
    });

    showTokenCard(data.token, data.position, data.wait_mins);
    Toast.ok('You joined the queue!');
    loadQueue();
}

// Fix 7: conflict modal helpers
function showConflictModal(otherShop) {
    const modal = document.getElementById('conflict-modal');
    if (modal) {
        const msgEl = document.getElementById('conflict-msg');
        if (msgEl) msgEl.textContent =
            `You have an active booking at "${otherShop}". Cancel it and join here instead?`;
        modal.classList.add('show');
        lockScroll();
    } else {
        // Fallback if modal not in HTML
        const confirmed = window.confirm(
            `You have an active booking at "${otherShop}".\nCancel it and join here instead?`
        );
        if (confirmed) doJoinQueue(true);
    }
}

function confirmCancelOther() {
    document.getElementById('conflict-modal')?.classList.remove('show');
    doJoinQueue(true);
}

function dismissConflictModal() {
    document.getElementById('conflict-modal')?.classList.remove('show');
    unlockScroll();
    _conflictEntryId  = null;
    _conflictShopName = null;
}

function showJoinAlert(msg) {
    document.getElementById('join-alert').innerHTML =
        `<div class="alert alert-err">${msg}</div>`;
}

function setJoinLoading(on) {
    const btn = document.getElementById('join-btn');
    btn.classList.toggle('loading', on);
    btn.disabled = on;
}


// --- 8. Token display + cancel countdown ------------------

function showTokenCard(token, position, waitMins, remainingSecs = 60) {
    document.getElementById('join-card').style.display     = 'none';
    document.getElementById('token-section').style.display = 'block';

    document.getElementById('token-number').textContent = Format.token(token);
    document.getElementById('token-info').innerHTML =
        `<strong>Position ${position}</strong> in queue<br>
         Estimated wait: <strong>${Format.wait(waitMins)}</strong><br>
         Barber: <strong>${pickedBarber?.name || '—'}</strong> · ${pickedService || '—'}`;


    let secs   = remainingSecs;
    const cdEl = document.getElementById('cancel-cd');
    const btn  = document.getElementById('cancel-btn');
    btn.disabled = false;

    if (secs <= 0) { cdEl.textContent = ''; return; }

    cdEl.textContent = `You can cancel in ${secs}s`;
    clearInterval(cancelTimer);
    cancelTimer = setInterval(() => {
        secs--;
        if (secs <= 0) { clearInterval(cancelTimer); cdEl.textContent = ''; }
        else             cdEl.textContent = `You can cancel in ${secs}s`;
    }, 1000);

    calcSmartArrival(position, waitMins);
}

async function cancelQueue() {
    const saved = Queue.get();
    if (!saved) return;

    const { ok, data } = await API.delete(`/queue/cancel/${saved.entryId}`);
    if (ok) {
        Queue.clear();
        clearInterval(cancelTimer);
        document.getElementById('token-section').style.display = 'none';
        document.getElementById('join-card').style.display     = 'block';
        document.getElementById('join-alert').innerHTML        = '';
        loadQueue();

        if (data?.penalised) {
            const msg = data.message || 'Late cancel — behaviour score reduced';
            Toast.err(msg);
        } else {
            Toast.info('You left the queue.');
        }
    } else {
        Toast.err('Could not cancel. Try again.');
    }
}

async function restoreQueueSession() {
    const saved = Queue.get();

    // Case 1: localStorage has booking
    if (saved && saved.shopId === SHOP_ID) {

        // ---- SHOW IMMEDIATELY from localStorage ----
        // Don't wait for API — show what we know right now
        pickedBarber  = { name: saved.barberName, chairId: saved.chairId };
        pickedService = saved.service;
        showTokenCard(saved.token, '?', null, 0, saved.status || 'waiting');

        // ---- THEN update from API in background ----
        const { ok, data, status } = await API.get(`/queue/status/${saved.entryId}`);

        if (status === 404) {
            Queue.clear();
            document.getElementById('token-section').style.display = 'none';
            document.getElementById('join-card').style.display     = 'block';
            return;
        }

        if (!ok) return; // Offline — keep showing localStorage data

        if (data.status !== 'waiting' && data.status !== 'active') {
            Queue.clear();
            document.getElementById('token-section').style.display = 'none';
            document.getElementById('join-card').style.display     = 'block';
            return;
        }

        // Update with real data from server
        // Save status to localStorage for next time
        Queue.save({ ...saved, status: data.status });

        showTokenCard(saved.token, data.position || '?', data.wait_mins, 0, data.status);
        return;
    }

    // Case 2: localStorage empty — check server by phone
    const customer = Auth.get();
    if (!customer?.phone) return;

    const { ok, data } = await API.get(
        `/customer/active-booking?phone=${encodeURIComponent(customer.phone)}`
    );

    if (!ok || !data.entry_id) return;
    if (data.shop_id !== SHOP_ID) return; 

    // Found active booking on server — restore it
    Queue.save({
        entryId:    data.entry_id,
        shopId:     data.shop_id,
        shopName:   data.shop_name,
        token:      data.token,
        chairId:    null,
        barberName: '—',
        service:    null,
        joinedAt:   Date.now(),
        phone:      customer.phone,
    });

    pickedBarber  = { name: '—', chairId: null };
    pickedService = null;
    showTokenCard(data.token, '?', null, 0);
}

// --- 9. Smart arrival -------------------------------------

function calcSmartArrival(position, waitMins) {
    const el = document.getElementById('smart-arrival');
    if (!waitMins || !userLat || !shopData?.lat) return;
    const distKm  = shopData.distance_km || 0;
    const walkMins = Math.round(distKm * 15);
    const leaveIn  = Math.max(0, Math.round(waitMins - walkMins - 2));
    document.getElementById('smart-title').textContent =
        leaveIn <= 0 ? '🚶 Leave Now!' : `🚶 Leave in ${leaveIn} mins`;
    document.getElementById('smart-text').textContent =
        `You're position ${position} · wait ~${waitMins} min · ` +
        `${Format.distance(distKm)} walk (~${walkMins} min)`;
    el.classList.add('show');
}


// --- 10. Live queue display --------------------------------
//
// isMe = entry.token === saved.token
// Token travels with customer data during swaps.
// entryId kept current so cancel always targets correct row.

async function loadQueue() {
    const { ok, data } = await API.get(`/queue/${SHOP_ID}`);

    if (!ok) {
        _morphEl('queue-list', '<p class="text-muted text-sm" style="padding:8px 0">Could not load queue.</p>');
        return;
    }

    document.getElementById('stat-waiting').textContent = data.total_waiting || 0;
    document.getElementById('stat-seated').textContent  = data.currently_seated || 0;

    if (!data.queue?.length) {
        _morphEl('queue-list', '<p class="text-muted text-sm" style="padding:8px 0">Queue is empty — walk right in!</p>');
        return;
    }

    const saved = Queue.get();

    const newQueueHtml = data.queue.map(entry => {
        // ✅ Token travels with customer data during swaps
        // Row ID stays fixed — token is the reliable identifier
        const isMe     = saved && entry.token === saved.token;
        const isSeated = entry.status === 'active';

        const displayToken = isMe
            ? `<span style="color:var(--amber);font-weight:700">${Format.token(entry.token)}</span>`
            : '<span style="color:var(--text-muted)">####</span>';
        const displayName = isMe ? 'You ✓' : entry.name;

        return `
        <div class="queue-row ${isMe ? 'is-me' : ''} ${isSeated ? 'seated' : ''}"
             ${isMe ? 'style="border-color:var(--amber);background:var(--amber-glow)"' : ''}>
            <span class="q-token">${displayToken}</span>
            <div class="q-info">
                <div class="q-name">${displayName}</div>
                <div class="q-service">${isMe ? (entry.service || '—') : '—'}</div>
            </div>
            <span class="q-wait">${isSeated ? '💈 In chair' : Format.wait(entry.wait_mins)}</span>
        </div>`;
    }).join('');

    _morphEl('queue-list', newQueueHtml);

    if (saved && saved.shopId === SHOP_ID) {
        // ✅ Find by token — correctly locates customer after any swap
        const myEntry = data.queue.find(e => e.token === saved.token);

        if (myEntry) {
            // ✅ Keep entryId current — fixes cancel targeting wrong row
            // Without this: after swap, cancel calls DELETE /queue/cancel/<rohit_id>
            // cancelling the wrong person silently
            if (myEntry.id !== saved.entryId) {
                Queue.save({ ...saved, entryId: myEntry.id });
            }

            calcSmartArrival(myEntry.position, myEntry.wait_mins);

            const tSec  = document.getElementById('token-section');
            const tInfo = document.getElementById('token-info');
            if (tSec && tSec.style.display !== 'none' && tInfo) {
                const isSeated   = myEntry.status === 'active';
                const barberName = myEntry.barber_name || pickedBarber?.name || '—';
                tInfo.innerHTML  = isSeated
                    ? `<strong>💈 You are in the chair</strong><br>
                       Barber: <strong>${barberName}</strong> · ${myEntry.service || pickedService || '—'}`
                    : `<strong>Position ${myEntry.position}</strong> in queue<br>
                       Estimated wait: <strong>${Format.wait(myEntry.wait_mins)}</strong><br>
                       Barber: <strong>${barberName}</strong> · ${myEntry.service || pickedService || '—'}`;

                const cancelBtn = document.getElementById('cancel-btn');
                const cancelCd  = document.getElementById('cancel-cd');
                if (isSeated && cancelBtn) {
                    cancelBtn.style.display = 'none';
                    if (cancelCd) cancelCd.textContent = '';
                } else if (cancelBtn) {
                    cancelBtn.style.display = 'block';
                    cancelBtn.style.margin  = '0 auto';
                }
            }
        } else {
            // Entry gone — service done or cancelled by barber
            Queue.clear();
            clearInterval(cancelTimer);
            document.getElementById('token-section').style.display = 'none';
            document.getElementById('join-card').style.display     = 'block';
            document.getElementById('smart-arrival').classList.remove('show');
            Toast.ok('Your haircut is done! Thank you ✂️');
        }
    }
}



// --- 11. Home Service ------------------------------------
//
// Fix 4: GPS share button captures lat/lon.
// Fix 6: Barber phone is masked until acceptance; revealed after.
// Fix 9: HS rules shown before form.

async function loadHomeService() {
    if (!shopData?.home_service) return;

    const customer = Auth.get();
    if (!customer) return;

    const section = document.getElementById('home-svc-section');
    const body    = document.getElementById('home-svc-body');
    if (!section || !body) return;

    // Check eligibility + HS rules
    const { ok, data } = await API.get(
        `/home-service/check-visit?phone=${customer.phone}&shop_id=${SHOP_ID}`
    );

    _hsRules = data.hs_rules || null;
    section.style.display = 'block';

    if (!ok || !data.eligible) {
        body.innerHTML = `
            <p style="font-size:0.84rem;color:var(--text-muted);padding:8px 0">
                Home service becomes available after your first visit to this shop.
            </p>`;
        return;
    }

    // Check for existing active request
    const { ok: reqOk, data: reqData } = await API.get(
        `/home-service/my-requests?phone=${customer.phone}&shop_id=${SHOP_ID}`
    );

    const activeRequest = reqOk && reqData.length
        ? reqData.find(r => r.status === 'pending' || r.status === 'accepted')
        : null;

    // If active request exists — show status card instead of form

    if (activeRequest) {
        const isPending  = activeRequest.status === 'pending';
        const isAccepted = activeRequest.status === 'accepted';
        const phone      = activeRequest.staff_phone || '';

        body.innerHTML = `
            <div style="background:var(--surface-2);border:1px solid var(--border);
                        border-radius:var(--radius-sm);padding:14px">

                <!-- Header -->
                <div style="display:flex;justify-content:space-between;
                            align-items:center;margin-bottom:8px">
                    <strong>✂️ ${activeRequest.service || '—'}</strong>
                    <span style="font-size:0.72rem;text-transform:uppercase;
                                 letter-spacing:1px;font-weight:600;
                                 color:${isAccepted ? 'var(--green)' : 'var(--amber)'}">
                        ${isAccepted ? '✅ Accepted' : '⏳ Pending'}
                    </span>
                </div>

                <!-- Address -->
                <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px">
                    📍 ${activeRequest.address || '—'}
                </div>

                <!-- ETA or pending message -->
                ${isAccepted && activeRequest.otp ? `
                <div style="margin-bottom:12px;padding:14px;
                            background:rgba(200,144,42,0.08);
                            border:1px solid var(--amber-dim);
                            border-radius:var(--radius-sm);
                            text-align:center">
                    <div style="font-size:0.7rem;letter-spacing:2px;
                                text-transform:uppercase;color:var(--text-muted);
                                margin-bottom:6px">Your Verification Code</div>
                    <div style="font-family:var(--font-display);font-size:3rem;
                                font-weight:700;color:var(--amber);letter-spacing:8px;
                                line-height:1">
                        ${activeRequest.otp}
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:6px">
                        Show this to your barber when service is complete
                    </div>
                </div>` : ''}

                ${activeRequest.arrival_time ? `
                <div style="color:var(--amber);font-size:0.85rem;
                            font-weight:500;margin-bottom:12px">
                    🕐 Barber ETA: ${activeRequest.arrival_time}
                </div>` : isPending ? `
                <div style="font-size:0.78rem;color:var(--text-muted);
                            margin-bottom:12px;padding:8px 10px;
                            background:rgba(200,144,42,0.06);
                            border:1px solid rgba(200,144,42,0.15);
                            border-radius:var(--radius-sm)">
                    ⏳ Waiting for the shop to accept your request...
                </div>` : ''}

                <!-- Cancel button — full width -->
                <button class="btn btn-danger"
                        onclick="cancelHsRequest(${activeRequest.id})"
                        style="width:100%;margin-bottom:8px">
                    ✕ Cancel Request
                </button>

                <!-- Update Location button — full width -->
                <button class="btn btn-outline"
                        onclick="updateHsLocation(${activeRequest.id})"
                        id="hs-update-loc-btn"
                        style="width:100%;margin-bottom:8px">
                    📡 Update My Location
                </button>

                <!-- GPS status line -->
                <div id="hs-loc-status"
                     style="font-size:0.75rem;color:var(--text-muted);
                            text-align:center;min-height:18px;margin-bottom:10px">
                </div>


                <!-- Barber name + call button -->
                ${isAccepted ? `
                    <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:10px">
                        ✂️ Barber: <strong style="color:var(--amber)">
                            ${activeRequest.barber_name || '—'}
                        </strong>
                    </div>
                    ${phone ? `
                    <a href="tel:${phone}"
                       style="display:flex;align-items:center;justify-content:center;
                              gap:10px;background:var(--green);color:#0a0806;
                              border-radius:var(--radius-sm);padding:16px;
                              font-family:var(--font-display);font-size:1.1rem;
                              font-weight:700;text-decoration:none;">
                        📞 Call ${activeRequest.barber_name || 'Barber'}
                    </a>` : ''}
                ` : ''}
            </div>`;
        return;
    }

    const services2 = (services.length ? services : []).map(s =>
        `<button onclick="pickHsService('${s.service}', this)"
                 style="background:var(--surface-2);border:1px solid var(--border);
                        border-radius:20px;padding:6px 16px;font-size:0.82rem;
                        cursor:pointer;color:var(--text);font-family:var(--font-body);
                        transition:all 0.25s ease;"
                 data-svc="${s.service}">
            ${s.icon || '✂️'} ${s.service}
         </button>`
    ).join('');

    body.innerHTML = `
        <div id="hs-form">
            <div class="form-group">
                <label>Service</label>
                <div style="display:flex;flex-wrap:wrap;gap:8px;
                            margin-top:6px;margin-bottom:14px" 
                     id="hs-svc-grid">
                    ${services2}
                </div>
            </div>
            <div class="form-group">
                <label>Your Address</label>
                <input type="text" id="hs-address" 
                       placeholder="Building, Street, District">
            </div>
            <div class="form-group">
                <label>GPS Location 
                    <span style="font-size:0.72rem;color:var(--red)">
                        (required)
                    </span>
                </label>
                <div style="display:flex;gap:8px;align-items:center">
                    <button class="btn btn-outline btn-sm btn-auto" 
                            onclick="captureHsGps()"
                            id="hs-gps-btn">
                        📡 Share My Location
                    </button>
                    <span id="hs-gps-status" 
                          style="font-size:0.78rem;color:var(--text-muted)">
                    </span>
                </div>
            </div>
            <div class="form-group">
                <label>Note 
                    <span style="font-size:0.72rem;color:var(--text-muted)">
                        (optional)
                    </span>
                </label>
                <textarea id="hs-note" 
                          placeholder="Any special requests...">
                </textarea>
            </div>
            <div id="hs-form-alert"></div>
            <button class="btn btn-primary" id="hs-submit-btn" 
                    onclick="submitHsRequest()">
                <div class="btn-spinner"></div>
                <span class="btn-text">Request Home Service →</span>
            </button>
        </div>`;
}

async function updateHsLocation(reqId) {
    const btn    = document.getElementById('hs-update-loc-btn');
    const status = document.getElementById('hs-loc-status');

    if (!navigator.geolocation) {
        if (status) status.textContent = '⚠️ GPS not supported on this device.';
        return;
    }

    if (btn) { btn.disabled = true; btn.innerHTML = '📡 Detecting location...'; }
    if (status) {
        status.style.color = 'var(--text-muted)';
        status.textContent = 'Searching for your location...';
    }

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;

            if (status) {
                status.style.color = 'var(--amber)';
                status.textContent = `📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
            }

            const { ok } = await API.patch(
                `/home-service/${reqId}/update-location`,
                { lat, lon }
            );

            if (ok) {
                if (btn) { btn.disabled = false; btn.innerHTML = '📡 Update My Location'; }
                if (status) {
                    status.style.color = 'var(--green)';
                    status.textContent = `✅ Location updated — ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
                }
            } else {
                if (btn) { btn.disabled = false; btn.innerHTML = '📡 Update My Location'; }
                if (status) {
                    status.style.color = 'var(--red)';
                    status.textContent = '⚠️ Could not save location. Try again.';
                }
            }
        },
        () => {
            if (btn) { btn.disabled = false; btn.innerHTML = '📡 Update My Location'; }
            if (status) {
                status.style.color = 'var(--red)';
                status.textContent = '⚠️ Could not find your location.';
            }
        },
        { timeout: 10000 }
    );
}

let _hsPickedService = null;

function pickHsService(name, el) {
    _hsPickedService = name;
    document.querySelectorAll('#hs-svc-grid button').forEach(b => {
        b.style.borderColor = 'var(--border)';
        b.style.color = 'var(--text)';
    });
    el.style.borderColor = 'var(--amber)';
    el.style.color = 'var(--amber)';
}

// Fix 4: capture GPS coordinates
function captureHsGps() {
    const btn    = document.getElementById('hs-gps-btn');
    const status = document.getElementById('hs-gps-status');
    if (!navigator.geolocation) {
        if (status) status.textContent = 'GPS not supported on this device.';
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '📡 Getting location...'; }
    navigator.geolocation.getCurrentPosition(
        pos => {
            _hsLat = pos.coords.latitude;
            _hsLon = pos.coords.longitude;
            if (btn)    { btn.disabled = false; btn.textContent = '✅ Location shared'; }
            if (status) status.textContent = `${_hsLat.toFixed(5)}, ${_hsLon.toFixed(5)}`;
        },
        () => {
            if (btn)    { btn.disabled = false; btn.textContent = '📡 Share My Location'; }
            if (status) status.textContent = 'Could not get location. Please enter address manually.';
        },
        { timeout: 10000 }
    );
}

async function submitHsRequest() {
    const customer = Auth.get();
    if (!customer) { Toast.err('Please log in to use home service.'); return; }

        if (_hsRules) {
            showHsRulesPopup();
            return;
        }

    const address = document.getElementById('hs-address')?.value.trim();
    const note    = document.getElementById('hs-note')?.value.trim();

    if (!_hsPickedService) {
        document.getElementById('hs-form-alert').innerHTML =
            '<div class="alert alert-err">Please select a service.</div>';
        return;
    }
    if (!address) {
        document.getElementById('hs-form-alert').innerHTML =
            '<div class="alert alert-err">Please enter your address.</div>';
        return;
    }

    if (!_hsLat || !_hsLon) {
        document.getElementById('hs-form-alert').innerHTML =
            '<div class="alert alert-err">Please share your GPS location so the barber can find you.</div>';
        return;
    }

    const btn = document.getElementById('hs-submit-btn');
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }

    const { ok, data } = await API.post('/home-service/request', {
        shop_id: SHOP_ID,
        name:    customer.name,
        phone:   customer.phone,
        address,
        service: _hsPickedService,
        note,
        lat:     _hsLat,
        lon:     _hsLon,
    });

    if (btn) { btn.disabled = false; btn.classList.remove('loading'); }

    if (ok) {
        Toast.ok('Home service request sent! The barber will contact you shortly.');
        _hsLat = null;
        _hsLon = null;
        _hsPickedService = null;
        await loadHomeService();
    } else {
        document.getElementById('hs-form-alert').innerHTML =
            `<div class="alert alert-err">${data.error || 'Could not send request. Try again.'}</div>`;
    }
}

async function cancelHsRequest(reqId) {
    const customer = Auth.get();
    if (!customer) return;

    const { ok, data } = await API.patch(
        `/home-service/${reqId}/cancel`,
        { phone: customer.phone }
    );

    if (ok) {
        const msg = data.message || (data.penalty > 0
            ? `Request cancelled — behaviour score -${data.penalty}`
            : 'Request cancelled.');
        data.penalised ? Toast.err(msg) : Toast.info(msg);
        loadHomeService();   // reload to show form again
    } else {
        Toast.err(data.error || 'Could not cancel. Try again.');
    }
}

// --- 12. Favourites ---------------------------------------

function getFavourites() {
    try { return JSON.parse(localStorage.getItem('hh_favourites') || '[]'); }
    catch { return []; }
}

function checkFavourite() {
    const favs = getFavourites();
    const btn  = document.getElementById('fav-btn');
    btn.textContent = favs.includes(SHOP_ID) ? '♥' : '♡';
    btn.style.color = favs.includes(SHOP_ID) ? 'var(--amber)' : '';
}

function toggleFavourite() {
    let favs = getFavourites();
    if (favs.includes(SHOP_ID)) {
        favs = favs.filter(id => id !== SHOP_ID);
        Toast.info('Removed from favourites');
    } else {
        favs.push(SHOP_ID);
        Toast.ok('Added to favourites ♥');
    }
    localStorage.setItem('hh_favourites', JSON.stringify(favs));
    checkFavourite();
}


// --- 13. Map (Leaflet) ------------------------------------

function initMap(lat, lon) {
    leafletMap = L.map('map-box', { zoomControl: false }).setView([lat, lon], 15);
    const tileLayers = {
        dark:      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB', maxZoom: 19 }),
        street:    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 19 }),
        topo:      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '© OpenTopoMap', maxZoom: 17 }),
    };
    tileLayers.dark.addTo(leafletMap);
    window._mapTileLayers = tileLayers;
    window._leafletMap    = leafletMap;
    const icon = L.divIcon({
        html: '<div style="background:var(--amber);width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px rgba(200,144,42,0.6)"></div>',
        className: '', iconSize: [14, 14], iconAnchor: [7, 7],
    });
    L.marker([lat, lon], { icon }).addTo(leafletMap).bindPopup(shopData?.name || 'Haven Hair');
    document.getElementById('map-actions').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;width:100%">
            <div style="display:flex;gap:6px">
                <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}"
                   target="_blank" class="btn btn-outline btn-sm" style="flex:1">🗺️ Google Maps</a>
                <a href="https://maps.apple.com/?daddr=${lat},${lon}"
                   target="_blank" class="btn btn-outline btn-sm" style="flex:1">📍 Apple Maps</a>
            </div>
            <div style="display:flex;gap:6px">
                <button class="btn btn-sm map-layer-btn active" onclick="switchMapLayer('dark')">🌙 Dark</button>
                <button class="btn btn-sm map-layer-btn" onclick="switchMapLayer('street')">🗺️ Street</button>
                <button class="btn btn-sm map-layer-btn" onclick="switchMapLayer('satellite')">🛰️ Satellite</button>
                <button class="btn btn-sm map-layer-btn" onclick="switchMapLayer('topo')">⛰️ Topo</button>
            </div>
        </div>
    `;
}

function switchMapLayer(name) {
    const layers = window._mapTileLayers;
    const map    = window._leafletMap;
    if (!layers || !map) return;
    Object.values(layers).forEach(l => map.removeLayer(l));
    layers[name].addTo(map);
    document.querySelectorAll('.map-layer-btn').forEach(btn => {
        btn.classList.toggle('active', btn.onclick?.toString().includes(name));
    });
}


// --- 14. Reviews ------------------------------------------

async function loadReviews() {
    const { ok, data } = await API.get(`/reviews/${SHOP_ID}`);

    if (!ok || !data.length) {
        document.getElementById('reviews-list').innerHTML =
            '<p class="text-muted text-sm" style="padding:8px 0">No reviews yet. Be the first!</p>';
        checkCanReview();
        return;
    }

    document.getElementById('reviews-list').innerHTML = data.map((c, index) => `
        <div class="review-customer-card">

            <div class="review-customer-header"
                 onclick="toggleReviews('rv-${index}')">

                <div class="review-customer-left">
                    <div class="review-customer-name">
                        ${escHtml(c.customer_name)}
                    </div>
                    <div class="review-customer-avg">
                        ${'★'.repeat(Math.round(c.avg_rating))}${'☆'.repeat(5 - Math.round(c.avg_rating))}
                        <span style="color:var(--text-muted)">
                            ${c.avg_rating} · ${c.review_count}
                            ${c.review_count === 1 ? 'review' : 'reviews'}
                        </span>
                    </div>
                    ${c.latest_comment ? `
                    <div class="review-customer-latest">
                        "${escHtml(c.latest_comment)}"
                    </div>` : ''}
                </div>

                <!-- ✅ index-based arrow ID — matches toggleReviews() lookup -->
                <span class="review-expand-arrow"
                      id="arrow-rv-${index}">▼</span>
            </div>

            <!-- ✅ index-based entries ID — no collision possible -->
            <div class="review-entries" id="rv-${index}">
                ${c.all_reviews.map(r => `
                    <div class="review-entry">
                        <div class="review-entry-top">
                            <span class="review-entry-stars">
                                ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}
                            </span>
                            <span class="review-entry-time">
                                ${Format.timeAgo(r.created_at)}
                            </span>
                        </div>
                        ${r.comment ? `
                        <div class="review-entry-comment">
                            ${escHtml(r.comment)}
                        </div>` : ''}
                    </div>
                `).join('')}
            </div>

        </div>
    `).join('');

    checkCanReview();
}

async function checkCanReview() {
    const wrap = document.getElementById('review-form-wrap');
    if (!wrap) return;

    // Hide by default
    wrap.style.display = 'none';

    const customer = Auth.get();
    if (!customer) return;

    const { ok, data } = await API.get(
        `/reviews/can-review/${SHOP_ID}/${customer.phone}`
    );

    if (ok && data.can_review) {
        wrap.style.display = 'block';
    }
}

function setStar(n) {
    pickedStar = n;
    document.querySelectorAll('#star-row .star').forEach((s, i) => {
        s.classList.toggle('on', i < n);
        s.style.opacity = i < n ? '1' : '0.2';
    });
}

function toggleReviews(id) {
    const entries = document.getElementById(id);
    const arrow   = document.getElementById('arrow-' + id);
    if (!entries) return;

    const isOpen = entries.classList.toggle('open');
    if (arrow) arrow.classList.toggle('open', isOpen);
}

async function submitReview() {
    const customer = Auth.get();
    if (!customer) { Toast.err('Log in to leave a review.'); return; }
    if (!pickedStar) { Toast.err('Please select a star rating.'); return; }
    const comment = document.getElementById('review-comment').value.trim();
    const { ok, data } = await API.post(`/reviews`, {
        shop_id:       SHOP_ID,
        phone:         customer.phone,
        customer_name: customer.name,
        rating:        pickedStar,
        comment,
    });
    if (ok) {
        Toast.ok('Review submitted!');
        document.getElementById('review-alert').innerHTML = '';
        loadReviews();
    } else {
        document.getElementById('review-alert').innerHTML =
            `<div class="alert alert-err">${data.error || 'Could not submit review.'}</div>`;
    }
}
function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Refresh immediately when user returns to this page
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Page became visible — update immediately
        loadQueue();
        restoreQueueSession();

        // Restart interval
        if (queueRefresh) clearInterval(queueRefresh);
        queueRefresh = setInterval(loadQueue, 10000);
    } else {
        // Page hidden — stop polling to save battery
        if (queueRefresh) clearInterval(queueRefresh);
    }
});

window.addEventListener('beforeunload', () => {
    if (queueRefresh) clearInterval(queueRefresh);
    if (cancelTimer)  clearInterval(cancelTimer);
});

function showHsRulesPopup() {
    document.getElementById('rules-body').textContent = _hsRules;
    document.getElementById('rules-overlay').classList.add('show');

    // Change header title to HS rules
    document.querySelector('.rules-sheet-head h3').textContent = '🏠 Home Service Rules';

    // Override accept button onclick directly by ID
    const footer = document.querySelector('.rules-footer button');
    footer.onclick = acceptHsRules;

    lockScroll();
}

function acceptHsRules() {
    _hsRules = null;
    closeRules();
    // Restore header and button for shop rules
    document.querySelector('.rules-sheet-head h3').textContent = 'Shop Rules';
    document.querySelector('.rules-footer button').onclick = acceptRules;
    submitHsRequest();
}

function _morphEl(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    morphdom(el, tmp, { childrenOnly: true });
}
