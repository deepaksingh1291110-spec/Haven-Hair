// ============================================================
// HAVEN HAIR — staff_actions.js
// Staff Dashboard — 2-Tap Action Logic
//
// Responsibilities:
//   1.  Customer Sits — open service selection sheet
//   2.  Service selection — barber picks service, entry marked active
//   3.  Haircut Done — mark active entry as done, reset chair card
//   4.  Add Walk-in Customer — load services, submit to queue
//   5.  Open / close add-customer sheet
//   6.  Open / close service-select sheet
//
// Depends on:
//   - staff_core.js     (CHAIR_ID, SHOP_ID, activeEntry, chairData,
//                        renderActionButtons, renderCurrentCustomer,
//                        toast, setLoading, setAlert)
//   - staff_queue.js    (loadQueue)
//   - staff_dashboard.html  (all sheet + modal element IDs)
//
// THE 2-TAP FLOW:
//
//   [Customer Sits]
//       ↓
//   Service select sheet opens
//   Barber taps a service icon (2 seconds)
//       ↓
//   PATCH /queue/chair/:id/sit  → entry marked 'active'
//   Timer starts, waiting customers notified
//       ↓
//   [Haircut Done]
//       ↓
//   PATCH /queue/chair/:id/done → entry marked 'done'
//   Chair resets, next customer moves up
//
// APIs used:
//   GET    /shops/:id/services          → load service options
//   PATCH  /queue/chair/:id/sit         → mark next entry as active
//          Body: { service: str }
//   PATCH  /queue/chair/:id/done        → mark active entry as done
//   POST   /queue/join                  → add a walk-in to the queue
//          Body: { shop_id, chair_id, name, phone, service }
// ============================================================


// ---- Module state ----------------------------------------

let shopServices   = [];      // cached service list for this shop
let selectedSvcAdd = '';      // selected service in add-customer sheet
let selectedSvcSit = '';      // selected service in service-select sheet


// ============================================================
// 1. CUSTOMER SITS — open service selection sheet
// ============================================================

function sitAction() {
    // If no one is waiting, warn the barber
    if (!waitingEntries || !waitingEntries.length) {
        toast('No one in the queue yet.', 'err');
        return;
    }

    // If the next customer already chose their service, skip the sheet
    const firstEntry = waitingEntries[0];
    if (firstEntry?.service) {
        confirmSit(firstEntry.service);
        return;
    }

    openServiceSelectSheet();
}


// ============================================================
// 2. SERVICE SELECTION — barber picks service, entry goes active
// ============================================================

async function openServiceSelectSheet() {
    selectedSvcSit = '';
    document.getElementById('service-select-alert').innerHTML = '';

    // Load services if not cached yet
    if (!shopServices.length) {
        await fetchServices();
    }

    renderServiceGrid('service-select-grid', shopServices, 'sit');
    document.getElementById('service-select-sheet').classList.add('show');
}

function closeServiceSelectSheet() {
    document.getElementById('service-select-sheet').classList.remove('show');
    selectedSvcSit = '';
}

// Tapping a service tile in the service-select sheet
// immediately calls sit — no extra confirm button needed
async function selectServiceAndSit(serviceName) {
    selectedSvcSit = serviceName;

    // Highlight selected tile
    document.querySelectorAll('#service-select-grid .svc-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.svc === serviceName);
    });

    // Short visual pause so barber sees their selection
    await delay(200);

    closeServiceSelectSheet();
    await confirmSit(serviceName);
}

// PATCH the next waiting entry to 'active'
async function confirmSit(serviceName) {
    const res = await fetch(`/queue/chair/${CHAIR_ID}/sit`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ service: serviceName }),
    });

    if (res.ok) {
        const data = await res.json();

        // Update core state immediately
        activeEntry = data.entry || { service: serviceName, sat_at: new Date().toISOString() };
        renderCurrentCustomer();   // staff_core.js
        renderActionButtons();     // staff_core.js

        toast(`Started — ${serviceName}`, 'ok');
        loadQueue();               // staff_queue.js — refresh list
    } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Could not start. Try again.', 'err');
    }
}


// ============================================================
// 3. HAIRCUT DONE — mark active entry as done, reset chair
// ============================================================

async function doneAction() {
    const btn = document.getElementById('done-btn');
    if (!btn || btn.disabled) return;

    // Two-tap confirm — first tap turns button orange
    if (!btn.dataset.confirming) {
        btn.dataset.confirming = '1';
        btn.textContent = 'Confirm Done?';
        btn.style.background = 'var(--orange, #f97316)';

        setTimeout(() => {
            if (btn.dataset.confirming) {
                delete btn.dataset.confirming;
                btn.textContent = '✅ Haircut Done';
                btn.style.background = '';
            }
        }, 3000);
        return;
    }

    // Confirmed — mark as done
    delete btn.dataset.confirming;
    btn.disabled    = true;
    btn.textContent = '...';

    const res = await fetch(`/queue/chair/${CHAIR_ID}/done`, { method: 'PATCH' });

    if (res.ok) {
        // Reset active entry
        activeEntry = null;
        renderCurrentCustomer();   // staff_core.js — clears timer
        renderActionButtons();     // staff_core.js — back to "Customer Sits"

        toast('Done! Next customer up.', 'ok');
        loadQueue();               // staff_queue.js
    } else {
        btn.disabled    = false;
        btn.textContent = '✅ Haircut Done';
        toast('Could not update. Try again.', 'err');
    }
}


// ============================================================
// 4. ADD WALK-IN CUSTOMER
// ============================================================

// ---- Open add-customer sheet ----------------------------

async function openAddCustSheet() {
    selectedSvcAdd = '';
    document.getElementById('ac-name').value  = '';
    document.getElementById('ac-phone').value = '';
    document.getElementById('add-cust-alert').innerHTML = '';

    // Load services if not cached yet
    if (!shopServices.length) {
        await fetchServices();
    }

    renderServiceGrid('ac-service-grid', shopServices, 'add');
    document.getElementById('add-cust-sheet').classList.add('show');
    document.getElementById('ac-name').focus();
}

function closeAddCustSheet() {
    document.getElementById('add-cust-sheet').classList.remove('show');
    selectedSvcAdd = '';
}

// Tapping a service tile in the add-customer sheet
function selectServiceAdd(serviceName) {
    selectedSvcAdd = serviceName;

    document.querySelectorAll('#ac-service-grid .svc-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.svc === serviceName);
    });
}

// Submit the walk-in to the queue
async function submitAddCustomer() {
    const name  = document.getElementById('ac-name').value.trim();
    const phone = document.getElementById('ac-phone').value.trim();

    if (!name) {
        setAlert('add-cust-alert', 'Customer name is required.');
        return;
    }
    if (!selectedSvcAdd) {
        setAlert('add-cust-alert', 'Please select a service.');
        return;
    }

    setLoading('ac-btn', true);

    const res = await fetch('/queue/join', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            shop_id:  SHOP_ID,
            chair_id: CHAIR_ID,
            name,
            phone,
            service:  selectedSvcAdd,
            source:   'walkin',
        }),
    });

    setLoading('ac-btn', false);

    if (res.ok) {
        const data = await res.json();
        closeAddCustSheet();
        toast(`${name} added — Token #${data.token}`, 'ok');
        loadQueue();    // staff_queue.js
    } else {
        const data = await res.json().catch(() => ({}));
        setAlert('add-cust-alert', data.error || 'Could not add customer. Try again.');
    }
}


// ============================================================
// 5 & 6. SHARED SHEET HELPERS
// ============================================================

// Fetch and cache services for this shop
async function fetchServices() {
    const res  = await fetch(`/shops/${SHOP_ID}/services`);
    const data = await res.json();
    if (res.ok) shopServices = data;
}

// Render a service selection grid into a container
// mode: 'sit' → clicking calls selectServiceAndSit()
// mode: 'add' → clicking calls selectServiceAdd()
function renderServiceGrid(containerId, services, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!services.length) {
        container.innerHTML = `
            <div class="q-empty" style="padding: 10px 0">
                No services set up yet.
                <br>
                <span class="text-xs text-muted">
                    Ask the shop owner to add services in Settings.
                </span>
            </div>`;
        return;
    }

    const clickHandler = mode === 'sit'
        ? name => `selectServiceAndSit('${escJs(name)}')`
        : name => `selectServiceAdd('${escJs(name)}')`;

    container.innerHTML = services.map(s => `
        <button class="svc-btn"
                data-svc="${escHtml(s.service)}"
                onclick="${clickHandler(s.service)}">
            <span class="svc-icon">${s.icon || '✂️'}</span>
            <span class="svc-name">${escHtml(s.service)}</span>
            ${s.price ? `<span class="svc-price">SAR ${parseFloat(s.price).toFixed(0)}</span>` : ''}
        </button>`
    ).join('');
}


// ---- Utility helpers -------------------------------------

// Short delay (ms) — used for visual feedback before API call
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Escape a string for use inside an HTML attribute
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Escape a string for use inside a JS onclick string literal
function escJs(str) {
    return String(str).replace(/'/g, "\\'").replace(/\\/g, '\\\\');
}
