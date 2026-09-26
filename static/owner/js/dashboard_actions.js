// ============================================================
// Haven Hair — dashboard_actions.js
// Handles: Customer Sits, Done, Skip, Strike, Remove,
//          Add walk-in, Move customer, Add chair, Open chat
//
// Fixes vs previous version:
//   - customerSits() now opens service sheet before calling API
//     (same flow as staff dashboard — barber picks service first)
//   - After sit/done API success, chair body is fully re-rendered
//     so seated box, buttons and queue all update at once
//   - Button text is always reset on error — no more stuck "..."
//   - skipCustomer() uses two-tap confirm instead of browser confirm()
// ============================================================

let addCustChairId  = null;   // chair ID for the add customer sheet
let moveEntryId     = null;   // queue entry being moved
let pickedService   = null;   // selected service in add-customer sheet
let sitChairId      = null;   // chair ID waiting for service selection
let skipConfirmTimers = {};   // tracks two-tap confirm timeouts per chair


// ---- 1. Customer Sits — opens service sheet first --------
//
// Flow: tap "Customer Sits" → service sheet opens →
//       barber picks service (2 sec) → API called →
//       chair body re-renders with seated customer
//
function customerSits(chairId) {
    sitChairId = chairId;

    // If the next waiting entry already has a service, skip the sheet
    const chair       = allChairs.find(c => c.id === chairId);
    const nextWaiting = chair?.queue?.find(e => e.status === 'waiting');
    if (nextWaiting?.service) {
        confirmSit(nextWaiting.service);
        return;
    }

    // No service set — open selection sheet so barber can pick
    // Populate service grid
    const grid = document.getElementById('sit-service-grid');
    if (services.length) {
        grid.innerHTML = services.map(s => `
            <button class="svc-btn" onclick="confirmSit('${escJs(s.service)}')">
                <div style="font-size:1.4rem">${s.icon || '✂️'}</div>
                <div style="font-size:0.75rem">${s.service}</div>
                ${s.price ? `<div style="font-size:0.62rem;color:var(--amber)">SAR ${s.price}</div>` : ''}
            </button>`
        ).join('');
    } else {
        // Fallback default services if none loaded yet
        const defaults = [
            {icon:'✂️',name:'Haircut'}, {icon:'🪒',name:'Beard Trim'},
            {icon:'✨',name:'Both'},    {icon:'👦',name:'Kids Cut'},
            {icon:'💆',name:'Facial'}, {icon:'🎨',name:'Color'},
        ];
        grid.innerHTML = defaults.map(s => `
            <button class="svc-btn" onclick="confirmSit('${s.name}')">
                <div style="font-size:1.4rem">${s.icon}</div>
                <div style="font-size:0.75rem">${s.name}</div>
            </button>`
        ).join('');
    }

    document.getElementById('sit-service-sheet').classList.add('show');
}

function closeSitSheet() {
    document.getElementById('sit-service-sheet').classList.remove('show');
    sitChairId = null;
}

// Called when barber taps a service tile in the sit sheet
async function confirmSit(serviceName) {
    // Save chairId BEFORE closeSitSheet() nullifies sitChairId
    const chairId = sitChairId || addCustChairId;
    closeSitSheet();
    if (!chairId) return;

    // Show loading state on sit button
    const btn = document.getElementById(`btn-sit-${chairId}`);
    if (btn) { btn.disabled = true; btn.textContent = '...'; }

    const res = await fetch(`/queue/chair/${chairId}/sit`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ service: serviceName }),
    });

    if (res.ok) {
        toast(`Started — ${serviceName}`, 'ok');
        await refreshQueue();
    } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'No one waiting on this chair.', 'err');
        // Always reset button on failure — fixes the stuck "..." bug
        if (btn) { btn.disabled = false; btn.innerHTML = '💺 Customer<br>Sits'; }
    }
}


// ---- 2. Haircut Done — two-tap confirm -------------------
async function haircutDone(chairId) {
    const btn = document.getElementById(`btn-done-${chairId}`);
    if (!btn || btn.disabled) return;

    // First tap — ask confirm
    if (!btn.dataset.confirming) {
        btn.dataset.confirming = '1';
        btn.innerHTML = 'Confirm<br>Done?';
        btn.style.background = 'var(--green)';
        btn.style.color = '#0a0a0a';

        setTimeout(() => {
            if (btn.dataset.confirming) {
                delete btn.dataset.confirming;
                btn.innerHTML = '✅ Haircut<br>Done';
                btn.style.background = '';
                btn.style.color = '';
            }
        }, 3000);
        return;
    }

    // Second tap — confirmed, do it
    delete btn.dataset.confirming;
    btn.disabled = true;
    btn.textContent = '...';

    const res = await fetch(`/queue/chair/${chairId}/done`, { method: 'PATCH' });

    if (res.ok) {
        toast('Done! Queue updated.', 'ok');
        await refreshQueue();
    } else {
        toast('Could not complete. Try again.', 'err');
        btn.disabled = false;
        btn.innerHTML = '✅ Haircut<br>Done';
        btn.style.background = '';
        btn.style.color = '';
    }
}


// ---- 3. Skip next customer — two-tap confirm -------------
async function skipCustomer(chairId) {
    const btn = document.querySelector(`#chair-${chairId} .tap-skip`);
    if (!btn || btn.disabled) return;

    // First tap
    if (!btn.dataset.confirming) {
        btn.dataset.confirming = '1';
        btn.textContent = '⏭ Sure? Tap again';
        btn.style.color = 'var(--red)';

        skipConfirmTimers[chairId] = setTimeout(() => {
            delete btn.dataset.confirming;
            btn.textContent = '⏭ Skip Next';
            btn.style.color = '';
        }, 3000);
        return;
    }

    // Second tap
    clearTimeout(skipConfirmTimers[chairId]);
    delete btn.dataset.confirming;
    btn.disabled = true;

    const res = await fetch(`/queue/chair/${chairId}/skip`, { method: 'PATCH' });

    btn.disabled = false;
    btn.textContent = '⏭ Skip Next';
    btn.style.color = '';

    if (res.ok) {
        toast('Customer skipped.', 'ok');
        await refreshQueue();
    } else {
        toast('Could not skip.', 'err');
    }
}


// ---- 4. Strike customer ----------------------------------
async function strikeCustomer(entryId) {
    const res  = await fetch(`/queue/${entryId}/strike`, { method: 'PATCH' });
    const data = await res.json();
    if (res.ok) {
        toast(data.struck ? '⚠ Strike added.' : '✓ Strike removed.', 'ok');
        refreshQueue();
    } else {
        toast('Could not update strike.', 'err');
    }
}

// ---- 5. Remove customer from queue -----------------------
async function removeCustomer(entryId, chairId) {
    const btn = document.querySelector(`#qentry-${entryId} .qa-btn.remove`);
    if (!btn) return;

    // Two-tap confirm
    if (!btn.dataset.confirming) {
        btn.dataset.confirming = '1';
        btn.textContent = 'Sure?';
        btn.style.color = 'var(--red)';
        setTimeout(() => {
            if (btn.dataset.confirming) {
                delete btn.dataset.confirming;
                btn.textContent = '✕';
                btn.style.color = '';
            }
        }, 3000);
        return;
    }

    const res = await fetch(`/queue/cancel/${entryId}`, { method: 'DELETE' });
    if (res.ok) {
        toast('Customer removed.', 'ok');
        const el = document.getElementById(`qentry-${entryId}`);
        if (el) el.remove();
        refreshQueue();
    } else {
        toast('Could not remove.', 'err');
    }
}


// ---- 6. Add walk-in customer -----------------------------
function openAddCustSheet(chairId, barberName) {
    addCustChairId = chairId;
    pickedService  = null;

    document.getElementById('add-cust-chair-name').textContent =
        `Adding to: ${barberName}`;
    document.getElementById('ac-name').value  = '';
    document.getElementById('ac-phone').value = '';
    document.getElementById('add-cust-alert').innerHTML = '';

    const grid = document.getElementById('ac-service-grid');
    if (services.length) {
        grid.innerHTML = services.map(s => `
            <button class="svc-btn" onclick="pickService('${escJs(s.service)}', this)">
                <div>${s.icon || '✂️'}</div>
                <div>${s.service}</div>
                ${s.price ? `<div style="font-size:0.6rem;color:var(--amber)">SAR ${s.price}</div>` : ''}
            </button>`
        ).join('');
    } else {
        grid.innerHTML = `
            <button class="svc-btn" onclick="pickService('Haircut', this)">✂️<br>Haircut</button>
            <button class="svc-btn" onclick="pickService('Beard Trim', this)">🪒<br>Beard</button>
            <button class="svc-btn" onclick="pickService('Haircut + Beard', this)">✨<br>Both</button>
            <button class="svc-btn" onclick="pickService('Kids Cut', this)">👦<br>Kids</button>
            <button class="svc-btn" onclick="pickService('Facial', this)">💆<br>Facial</button>
            <button class="svc-btn" onclick="pickService('Color', this)">🎨<br>Color</button>`;
    }

    document.getElementById('add-cust-sheet').classList.add('show');
}

function closeAddCustSheet() {
    document.getElementById('add-cust-sheet').classList.remove('show');
    addCustChairId = null;
    pickedService  = null;
}

function pickService(name, el) {
    pickedService = name;
    document.querySelectorAll('#ac-service-grid .svc-btn')
        .forEach(b => b.classList.remove('picked'));
    el.classList.add('picked');
}

async function submitAddCustomer() {
    const name  = document.getElementById('ac-name').value.trim();
    const phone = document.getElementById('ac-phone').value.trim();

    if (!name) {
        document.getElementById('add-cust-alert').innerHTML =
            '<div class="alert alert-err">Customer name is required.</div>';
        return;
    }
    if (!pickedService) {
        document.getElementById('add-cust-alert').innerHTML =
            '<div class="alert alert-err">Please select a service.</div>';
        return;
    }

    setLoading('ac-btn', true);

    const res = await fetch('/queue/join', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            shop_id:  SHOP_ID,
            chair_id: addCustChairId,
            name, phone,
            service: pickedService,
            source:  'walkin',
        }),
    });

    setLoading('ac-btn', false);

    if (res.ok) {
        const data = await res.json();
        toast(`${name} added — Token ${padToken(data.token)}`, 'ok');
        closeAddCustSheet();
        refreshQueue();
    } else {
        const data = await res.json().catch(() => ({}));
        document.getElementById('add-cust-alert').innerHTML =
            `<div class="alert alert-err">${data.error || 'Could not add customer.'}</div>`;
    }
}


// ---- 7. Move customer ------------------------------------
function openMoveModal(entryId, customerName, currentChairId) {
    moveEntryId = entryId;
    document.getElementById('move-customer-name').textContent = customerName;

    const options = allChairs
        .filter(c => c.id !== currentChairId)
        .map(c => `
            <div class="move-option" onclick="submitMove(${c.id})">
                <span>✂️ ${c.barber_name}</span>
                <span class="text-xs text-muted">${c.waiting || 0} waiting</span>
            </div>`
        ).join('');

    document.getElementById('move-options').innerHTML =
        options || '<p class="text-muted text-sm">No other barbers available.</p>';

    document.getElementById('move-modal').classList.add('show');
}

function closeMoveModal() {
    document.getElementById('move-modal').classList.remove('show');
    moveEntryId = null;
}

async function submitMove(targetChairId) {
    const res = await fetch(`/queue/${moveEntryId}/move`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chair_id: targetChairId }),
    });

    if (res.ok) {
        toast('Customer moved.', 'ok');
        closeMoveModal();
        refreshQueue();
    } else {
        toast('Could not move customer.', 'err');
    }
}


// ---- 8. Add new barber -----------------------------------
function openAddChairSheet() {
    document.getElementById('chr-name').value   = '';
    document.getElementById('chr-phone').value  = '';
    document.getElementById('chr-pass').value   = '';
    document.getElementById('chr-home').checked = false;
    document.getElementById('add-chair-alert').innerHTML = '';
    document.getElementById('add-chair-sheet').classList.add('show');
}

function closeAddChairSheet() {
    document.getElementById('add-chair-sheet').classList.remove('show');
}

async function submitAddChair() {
    const name  = document.getElementById('chr-name').value.trim();
    const phone = document.getElementById('chr-phone').value.trim();
    const pass  = document.getElementById('chr-pass').value;
    const home  = document.getElementById('chr-home').checked;

    if (!name || !phone || !pass) {
        document.getElementById('add-chair-alert').innerHTML =
            '<div class="alert alert-err">Name, phone and password are required.</div>';
        return;
    }
    if (pass.length < 6) {
        document.getElementById('add-chair-alert').innerHTML =
            '<div class="alert alert-err">Password must be at least 6 characters.</div>';
        return;
    }

    setLoading('add-chair-btn', true);

    const res = await fetch('/owner/chairs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            shop_id: SHOP_ID, barber_name: name,
            phone, password: pass, home_service: home ? 1 : 0,
        }),
    });

    setLoading('add-chair-btn', false);

    if (res.ok) {
        toast(`${name} added as barber!`, 'ok');
        closeAddChairSheet();
        loadChairs();
    } else {
        const data = await res.json().catch(() => ({}));
        document.getElementById('add-chair-alert').innerHTML =
            `<div class="alert alert-err">${data.error || 'Could not add barber.'}</div>`;
    }
}


// ---- 9. Open customer chat -------------------------------
function openChat(entryId) {
    fetch(`/queue/status/${entryId}`)
        .then(r => r.json())
        .then(data => {
            if (data.phone) {
                window.location.href =
                    `/owner/inbox?phone=${encodeURIComponent(data.phone)}&shop=${SHOP_ID}`;
            } else {
                toast('No phone number for this customer.', 'err');
            }
        })
        .catch(() => toast('Could not open chat. Try again.', 'err'));  // ✅ added
}

// ---- Escape JS string for inline onclick -----------------
function escJs(str) {
    return String(str).replace(/'/g, "\\'").replace(/\\/g, '\\\\');
}
