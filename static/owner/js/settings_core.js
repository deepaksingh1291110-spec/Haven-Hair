// ============================================================
// HAVEN HAIR — settings_core.js
// Owner Settings Page — Core Logic
//
// Fixes:
//   Fix 2  — Collapsible accordion (collapsed by default, one
//             section open at a time); "Manage Staff / Chairs"
//             section with load/add/edit/remove; "Home Service
//             Rules" section backed by home_service_rules_text.
//
// APIs used:
//   GET    /shops/:id                 → shop info + rules + HS rules
//   PATCH  /shops/:id                 → save shop info
//   PATCH  /shops/:id/rules           → save rules + HS rules
//   PATCH  /shops/:id/status          → set open/busy/closed
//   DELETE /queue/:id/clear           → remove all waiting today
//   GET    /shops/:id/chairs          → list barbers
//   POST   /owner/chairs              → add barber
//   PATCH  /chairs/:id                → edit barber
//   DELETE /owner/chairs/:id          → remove barber
//   GET    /owner/unread-count        → unread message badge
// ============================================================


// ---- 1. Shared state & auth guard ------------------------

const owner   = JSON.parse(localStorage.getItem('hh_owner') || 'null');
const SHOP_ID = parseInt(localStorage.getItem('hh_active_shop') || '0');

let shopData    = null;
let _staffList  = [];
let _editingChairId = null;

if (!owner)   window.location.href = '/owner/auth';
if (!SHOP_ID) window.location.href = '/owner/branches';


// ---- 2. Init ---------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('drawer-name').textContent = owner.name;
    await loadShopInfo();
    loadServices();     // settings_services.js
    checkUnread();
    initAccordion();    // Fix 2
});


// ---- Fix 2: Accordion ------------------------------------
//
// All .settings-section-body are hidden by CSS (accordion-section class).
// Clicking a .settings-section-head toggles that section open.
// Only one section can be open at a time.

function initAccordion() {
    const sections = document.querySelectorAll('.settings-section');
    sections.forEach((sec, i) => {
        const head = sec.querySelector('.settings-section-head');
        const body = sec.querySelector('.settings-section-body');
        if (!head || !body) return;

        // Add arrow to head title span (not to the edit/add buttons)
        const h3 = head.querySelector('h3');
        if (h3 && !h3.querySelector('.acc-arrow')) {
            const arrow = document.createElement('span');
            arrow.className = 'acc-arrow';
            arrow.textContent = ' ▼';
            arrow.style.cssText = 'font-size:0.7rem;color:var(--text-muted);transition:transform 0.2s';
            h3.appendChild(arrow);
        }

        // First section open by default
        if (i === 0) {
            sec.classList.add('acc-open');
            body.style.display = 'block';
            const arr = h3?.querySelector('.acc-arrow');
            if (arr) arr.textContent = ' ▲';
        } else {
            body.style.display = 'none';
        }

        // Click handler — toggle only on the title area
        head.addEventListener('click', (e) => {
            // Don't toggle if clicking an edit/add button inside the head
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            toggleAccordion(sec);
        });
    });
}

function toggleAccordion(targetSection) {
    const isOpen = targetSection.classList.contains('acc-open');

    // Close all
    document.querySelectorAll('.settings-section').forEach(sec => {
        sec.classList.remove('acc-open');
        const body = sec.querySelector('.settings-section-body');
        const arr  = sec.querySelector('.acc-arrow');
        if (body) body.style.display = 'none';
        if (arr)  arr.textContent = ' ▼';
    });

    // Open target (unless it was already open)
    if (!isOpen) {
        targetSection.classList.add('acc-open');
        const body = targetSection.querySelector('.settings-section-body');
        const arr  = targetSection.querySelector('.acc-arrow');
        if (body) body.style.display = 'block';
        if (arr)  arr.textContent = ' ▲';

        // ✅ Fix Leaflet blank-map bug
        // 120ms delay lets the browser complete the CSS paint
        // before Leaflet remeasures the container dimensions
        if (targetSection.id === 'section-location' && window._settingsMap) {
            setTimeout(() => window._settingsMap.invalidateSize(), 120);
        }

        // Lazy-load staff list when that section opens
        if (targetSection.id === 'section-staff')    loadStaff();
        // Lazy-load HS rules when that section opens
        if (targetSection.id === 'section-hs-rules') loadHSRules();
    }
}

// ---- 3. Shop Info ----------------------------------------
// single fetch — every field the rules endpoint had
// is already present on the main shop response

async function loadShopInfo() {
    const shopRes = await fetch(`/shops/${SHOP_ID}`);
    const shop    = await shopRes.json();

    document.getElementById('settings-loader').style.display  = 'none';
    document.getElementById('settings-content').style.display = 'block';

    shopData = shop;   // ✅ single source — was { ...shop, ...rules }

    // Notify map that shop data is ready
    if (window.mapReady) window.mapReady();

    document.getElementById('settings-shop-name').textContent = shop.name || '—';
    document.getElementById('si-name-view').textContent  = shop.name          || '—';
    document.getElementById('si-addr-view').textContent  = shop.address       || '—';
    document.getElementById('si-phone-view').textContent = shop.owner_phone   || '—';
    document.getElementById('si-home-view').textContent  = shop.home_service  ? '✅ Enabled' : '—';

    document.getElementById('si-name').value   = shop.name          || '';
    document.getElementById('si-addr').value   = shop.address       || '';
    document.getElementById('si-phone').value  = shop.owner_phone   || '';
    document.getElementById('si-home').checked = !!shop.home_service;

    const track = document.getElementById('si-home-track');
    if (track) track.classList.toggle('on', !!shop.home_service);

    document.getElementById('si-home').addEventListener('change', function() {
        if (track) track.classList.toggle('on', this.checked);
    });

    // ✅ rules.* fallback removed — shop.* already carries every field
    const rulesText = shop.rules_text || '';
    document.getElementById('rules-text-view').textContent = rulesText || 'No rules set yet.';
    document.getElementById('rules-textarea').value        = rulesText;

    // Fix 2: HS rules
    const hsRules = shop.home_service_rules_text || '';
    const hsView  = document.getElementById('hs-rules-view');
    const hsTa    = document.getElementById('hs-rules-textarea');
    if (hsView) hsView.textContent = hsRules || 'No home service rules set yet.';
    if (hsTa)   hsTa.value         = hsRules;

    setStatusHighlight(shop.status || 'open');
}

function toggleShopInfoEdit() {
    document.getElementById('shop-info-view').style.display  = 'none';
    document.getElementById('shop-info-edit').style.display  = 'block';
    document.getElementById('shop-info-edit-btn').style.display = 'none';
    document.getElementById('shop-info-alert').innerHTML = '';
}

function cancelShopInfoEdit() {
    document.getElementById('shop-info-edit').style.display  = 'none';
    document.getElementById('shop-info-view').style.display  = 'block';
    document.getElementById('shop-info-edit-btn').style.display = 'inline-flex';
    if (shopData) {
        document.getElementById('si-name').value   = shopData.name          || '';
        document.getElementById('si-addr').value   = shopData.address       || '';
        document.getElementById('si-phone').value  = shopData.owner_phone   || '';
        document.getElementById('si-home').checked = !!shopData.home_service;
    }
}

async function saveShopInfo() {
    const name  = document.getElementById('si-name').value.trim();
    const addr  = document.getElementById('si-addr').value.trim();
    const phone = document.getElementById('si-phone').value.trim();
    const home  = document.getElementById('si-home').checked ? 1 : 0;

    if (!name) { setAlert('shop-info-alert', 'Shop name is required.'); return; }

    setLoading('shop-info-save-btn', true);
    const res = await fetch(`/shops/${SHOP_ID}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, address: addr, owner_phone: phone, home_service: home }),
    });
    setLoading('shop-info-save-btn', false);

    if (res.ok) {
        if (shopData) { shopData.name = name; shopData.address = addr;
                        shopData.owner_phone = phone; shopData.home_service = home; }
        document.getElementById('si-name-view').textContent  = name  || '—';
        document.getElementById('si-addr-view').textContent  = addr  || '—';
        document.getElementById('si-phone-view').textContent = phone || '—';
        document.getElementById('si-home-view').textContent  = home  ? '✅ Enabled' : '—';
        document.getElementById('settings-shop-name').textContent = name;
        cancelShopInfoEdit();
        toast('Shop info saved.', 'ok');
    } else {
        const data = await res.json();
        setAlert('shop-info-alert', data.error || 'Could not save. Try again.');
    }
}


// ---- 4. Shop Rules ---------------------------------------

function toggleRulesEdit() {
    document.getElementById('rules-view').style.display     = 'none';
    document.getElementById('rules-edit').style.display     = 'block';
    document.getElementById('rules-edit-btn').style.display = 'none';
    document.getElementById('rules-alert').innerHTML = '';
}

function cancelRulesEdit() {
    document.getElementById('rules-edit').style.display     = 'none';
    document.getElementById('rules-view').style.display     = 'block';
    document.getElementById('rules-edit-btn').style.display = 'inline-flex';
    if (shopData) document.getElementById('rules-textarea').value = shopData.rules_text || '';
}

async function saveRules() {
    const text = document.getElementById('rules-textarea').value.trim();
    setLoading('rules-save-btn', true);
    const res = await fetch(`/shops/${SHOP_ID}/rules`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rules_text: text }),
    });
    setLoading('rules-save-btn', false);
    if (res.ok) {
        if (shopData) shopData.rules_text = text;
        document.getElementById('rules-text-view').textContent = text || 'No rules set yet.';
        cancelRulesEdit();
        toast('Rules saved.', 'ok');
    } else {
        const data = await res.json();
        setAlert('rules-alert', data.error || 'Could not save rules. Try again.');
    }
}


// ---- Fix 2: Home Service Rules ---------------------------

function loadHSRules() {
    const hsRules = shopData?.home_service_rules_text || '';
    const hsView  = document.getElementById('hs-rules-view');
    const hsTa    = document.getElementById('hs-rules-textarea');
    if (hsView) hsView.textContent = hsRules || 'No home service rules set yet.';
    if (hsTa)   hsTa.value         = hsRules;
}

function toggleHsRulesEdit() {
    document.getElementById('hs-rules-view-wrap').style.display = 'none';
    document.getElementById('hs-rules-edit-wrap').style.display = 'block';
    document.getElementById('hs-rules-edit-btn').style.display  = 'none';
}

function cancelHsRulesEdit() {
    document.getElementById('hs-rules-edit-wrap').style.display = 'none';
    document.getElementById('hs-rules-view-wrap').style.display = 'block';
    document.getElementById('hs-rules-edit-btn').style.display  = 'inline-flex';
    if (shopData) {
        document.getElementById('hs-rules-textarea').value =
            shopData.home_service_rules_text || '';
    }
}

async function saveHsRules() {
    const text = document.getElementById('hs-rules-textarea').value.trim();
    setLoading('hs-rules-save-btn', true);
    const res = await fetch(`/shops/${SHOP_ID}/rules`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ home_service_rules_text: text }),
    });
    setLoading('hs-rules-save-btn', false);
    if (res.ok) {
        if (shopData) shopData.home_service_rules_text = text;
        document.getElementById('hs-rules-view').textContent =
            text || 'No home service rules set yet.';
        cancelHsRulesEdit();
        toast('Home service rules saved.', 'ok');
    } else {
        toast('Could not save. Try again.', 'err');
    }
}


// ---- Fix 2: Manage Staff / Chairs ------------------------

async function loadStaff() {
    const listEl = document.getElementById('staff-list');
    if (!listEl) return;

    listEl.innerHTML = '<div class="loading-state" style="padding:16px"><div class="spinner"></div></div>';

    const res  = await fetch(`/shops/${SHOP_ID}/chairs`);
    const data = await res.json();
    _staffList = Array.isArray(data) ? data : [];

    if (!_staffList.length) {
        listEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.84rem;padding:8px 0">No barbers added yet.</p>';
        return;
    }

    listEl.innerHTML = _staffList.map(c => `
        <div class="staff-row" id="staff-row-${c.id}">
            <div class="staff-avatar">✂️</div>
            <div class="staff-info">
                <div class="staff-name">${c.barber_name}</div>
                <div class="staff-phone">${c.phone || '—'}
                    ${c.home_service ? ' · 🏠 Home' : ''}</div>
            </div>
            <div class="staff-actions">
                <button class="btn btn-outline btn-sm btn-auto"
                        onclick="openEditStaffSheet(${c.id})">Edit</button>
                <button class="btn btn-danger btn-sm btn-auto"
                        onclick="removeStaff(${c.id}, '${c.barber_name}')">✕</button>
            </div>
        </div>
    `).join('');
}

function openAddStaffSheet() {
    _editingChairId = null;
    document.getElementById('staff-sheet-title').textContent = 'Add Barber';
    document.getElementById('staff-pass-group').style.display = 'block';
    document.getElementById('staff-alert').innerHTML = '';
    ['staff-chr-name','staff-chr-phone','staff-chr-pass'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const chk = document.getElementById('staff-chr-home');
    if (chk) chk.checked = false;
    document.getElementById('staff-sheet').classList.add('show');
    document.body.style.overflow = 'hidden';
}

function openEditStaffSheet(chairId) {
    _editingChairId = chairId;
    const chair = _staffList.find(c => c.id === chairId);
    if (!chair) return;

    document.getElementById('staff-sheet-title').textContent = 'Edit Barber';
    document.getElementById('staff-pass-group').style.display = 'block';
    document.getElementById('staff-alert').innerHTML = '';

    const nameEl = document.getElementById('staff-chr-name');
    const phoneEl = document.getElementById('staff-chr-phone');
    const homeEl  = document.getElementById('staff-chr-home');
    const passEl  = document.getElementById('staff-chr-pass');
    if (nameEl)  nameEl.value   = chair.barber_name || '';
    if (phoneEl) phoneEl.value  = chair.phone       || '';
    if (homeEl)  homeEl.checked = !!chair.home_service;
    if (passEl)  passEl.value   = '';   // blank = don't change password

    document.getElementById('staff-sheet').classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeStaffSheet() {
    document.getElementById('staff-sheet').classList.remove('show');
    document.body.style.overflow = '';
}

async function submitStaff() {
    const name     = document.getElementById('staff-chr-name')?.value.trim();
    const phone    = document.getElementById('staff-chr-phone')?.value.trim();
    const password = document.getElementById('staff-chr-pass')?.value;
    const home     = document.getElementById('staff-chr-home')?.checked ? 1 : 0;

    if (!name) { setAlert('staff-alert', 'Barber name is required.'); return; }

    setLoading('staff-save-btn', true);

    let res;
    if (_editingChairId) {
        // Edit existing barber
        const body = { barber_name: name, home_service: home };
        if (phone)    body.phone    = phone;
        if (password) body.password = password;

        res = await fetch(`/chairs/${_editingChairId}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
    } else {
        // Add new barber
        if (!phone || !password) {
            setLoading('staff-save-btn', false);
            setAlert('staff-alert', 'Phone and password required for new barbers.');
            return;
        }
        res = await fetch('/owner/chairs', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ shop_id: SHOP_ID, barber_name: name,
                                      phone, password, home_service: home }),
        });
    }

    setLoading('staff-save-btn', false);

    if (res.ok) {
        closeStaffSheet();
        toast(_editingChairId ? 'Barber updated.' : 'Barber added.', 'ok');
        loadStaff();
    } else {
        const data = await res.json();
        setAlert('staff-alert', data.error || 'Could not save. Try again.');
    }
}

async function removeStaff(chairId, name) {
    if (!confirm(`Remove ${name} from this shop?`)) return;
    const res = await fetch(`/owner/chairs/${chairId}`, { method: 'DELETE' });
    if (res.ok) { toast('Barber removed.', 'ok'); loadStaff(); }
    else         toast('Could not remove barber.', 'err');
}


// ---- 5. Shop Status toggle -------------------------------

function setStatusHighlight(status) {
    ['open', 'busy', 'closed'].forEach(s => {
        const btn = document.getElementById(`st-${s}`);
        if (btn) btn.className = 'st-btn' + (s === status ? ` active-${s}` : '');
    });
}

async function setShopStatus(status) {
    setStatusHighlight(status);
    const res = await fetch(`/shops/${SHOP_ID}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
    });
    if (res.ok) {
        if (shopData) shopData.status = status;
        toast(`Shop set to ${status}.`, 'ok');
    } else {
        toast('Could not update status.', 'err');
        setStatusHighlight(shopData?.status || 'open');
    }
}


// ---- 6. Danger Zone — clear today's queue ----------------

function openClearQueueModal()  { document.getElementById('clear-queue-modal').classList.add('show'); }
function closeClearQueueModal() { document.getElementById('clear-queue-modal').classList.remove('show'); }

async function clearQueue() {
    setLoading('clear-queue-btn', true);
    const res = await fetch(`/queue/${SHOP_ID}/clear`, { method: 'DELETE' });
    setLoading('clear-queue-btn', false);
    if (res.ok) {
        const data = await res.json();
        closeClearQueueModal();
        toast(`Queue cleared — ${data.removed || 0} entries removed.`, 'ok');
    } else {
        toast('Could not clear queue. Try again.', 'err');
    }
}


// ---- 7. Drawer navigation --------------------------------

function openDrawer()  {
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


// ---- 8. Unread message dot --------------------------------

async function checkUnread() {
    const res  = await fetch(`/owner/unread-count?owner_id=${owner.id}`);
    const data = await res.json();
    if (data.count > 0) document.getElementById('msg-dot').classList.add('show');
}


// ---- 9. Toast notifications ------------------------------

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


// ---- 10. Shared helpers ----------------------------------

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
