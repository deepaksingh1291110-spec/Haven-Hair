// ============================================================
// HAVEN HAIR — settings_services.js
// Owner Settings Page — Services & Prices Logic
//
// Responsibilities:
//   1.  Load & render services list
//   2.  Open add service sheet (blank form)
//   3.  Open edit service sheet (pre-filled form)
//   4.  Save service (create new OR update existing)
//   5.  Delete service (with inline confirm)
//   6.  Close service sheet & reset form
//
// Depends on:
//   - settings_core.js   (SHOP_ID, toast, setLoading, setAlert)
//   - settings.html      (service-sheet, services-list, svc-* inputs)
//   - owner.css          (price-item, svc-btn, bottom-sheet classes)
//
// APIs used:
//   GET    /shops/:id/services      → load all services for this shop
//   POST   /shops/:id/services      → create a new service
//   PATCH  /services/:id            → update existing service
//   DELETE /services/:id            → delete a service
// ============================================================


// ---- 1. Load & render services list ----------------------

// Called by settings_core.js on page init
async function loadServices() {
    const res  = await fetch(`/shops/${SHOP_ID}/services`);
    const data = await res.json();

    const container = document.getElementById('services-list');

    if (!res.ok) {
        container.innerHTML = `
            <div class="alert alert-err">Could not load services.</div>`;
        return;
    }

    if (!data.length) {
        container.innerHTML = `
            <div class="q-empty">
                No services yet. Tap <strong>＋ Add</strong> to create your first one.
            </div>`;
        return;
    }

    container.innerHTML = data.map(s => buildServiceRow(s)).join('');
}


// ---- Build one service row HTML --------------------------

function buildServiceRow(s) {
    return `
    <div class="price-item" id="svc-row-${s.id}">
        <span class="price-item-icon">${s.icon || '✂️'}</span>
        <span class="price-item-name">
            ${s.service}
            <span class="text-xs text-muted" style="display:block; margin-top:2px">
                ${s.duration_mins || 20} min
            </span>
        </span>
        <span class="price-item-amount">
            ${s.price ? `SAR ${parseFloat(s.price).toFixed(0)}` : '—'}
        </span>
        <button class="price-item-edit"
                onclick="openEditServiceSheet(${s.id}, '${escStr(s.service)}', '${escStr(s.icon || '')}', ${s.price || 0}, ${s.duration_mins || 20})">
            Edit
        </button>
        <button class="price-item-del"
                id="del-btn-${s.id}"
                onclick="deleteService(${s.id}, '${escStr(s.service)}')">
            ✕
        </button>
    </div>`;
}


// ---- 2. Open add service sheet (blank form) --------------

function openAddServiceSheet() {
    // Reset all fields
    document.getElementById('service-sheet-title').textContent = 'Add Service';
    document.getElementById('svc-editing-id').value = '';
    document.getElementById('svc-name').value        = '';
    document.getElementById('svc-icon').value        = '';
    document.getElementById('svc-price').value       = '';
    document.getElementById('svc-duration').value    = '';
    document.getElementById('service-sheet-alert').innerHTML = '';

    document.getElementById('service-sheet').classList.add('show');
    document.getElementById('svc-name').focus();
}


// ---- 3. Open edit service sheet (pre-filled form) --------

function openEditServiceSheet(id, name, icon, price, duration) {
    document.getElementById('service-sheet-title').textContent = 'Edit Service';
    document.getElementById('svc-editing-id').value = id;
    document.getElementById('svc-name').value        = name;
    document.getElementById('svc-icon').value        = icon;
    document.getElementById('svc-price').value       = price || '';
    document.getElementById('svc-duration').value    = duration || '';
    document.getElementById('service-sheet-alert').innerHTML = '';

    document.getElementById('service-sheet').classList.add('show');
    document.getElementById('svc-name').focus();
}


// ---- 4. Save service (create OR update) ------------------

async function saveService() {
    const editingId = document.getElementById('svc-editing-id').value;
    const name      = document.getElementById('svc-name').value.trim();
    const icon      = document.getElementById('svc-icon').value.trim() || '✂️';
    const price     = parseFloat(document.getElementById('svc-price').value) || 0;
    const duration  = parseInt(document.getElementById('svc-duration').value) || 20;

    // Validate
    if (!name) {
        setAlert('service-sheet-alert', 'Service name is required.');
        return;
    }
    if (duration < 5) {
        setAlert('service-sheet-alert', 'Duration must be at least 5 minutes.');
        return;
    }

    setLoading('svc-save-btn', true);

    const isEditing = !!editingId;
    const url       = isEditing
        ? `/services/${editingId}`
        : `/shops/${SHOP_ID}/services`;
    const method    = isEditing ? 'PATCH' : 'POST';

    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ service: name, icon, price, duration_mins: duration }),
    });

    setLoading('svc-save-btn', false);

    if (res.ok) {
        closeServiceSheet();
        toast(isEditing ? 'Service updated.' : 'Service added.', 'ok');
        loadServices();   // re-render the full list
    } else {
        const data = await res.json().catch(() => ({}));
        setAlert('service-sheet-alert', data.error || 'Could not save service. Try again.');
    }
}


// ---- 5. Delete service (with inline confirm) -------------

// First tap: turns the button red and shows "Confirm?"
// Second tap within 3 seconds: actually deletes
// After 3 seconds: button resets to normal

const _deleteTimers = {};   // track confirm timeout per service id

async function deleteService(id, name) {
    const btn = document.getElementById(`del-btn-${id}`);
    if (!btn) return;

    // First tap — ask for confirm
    if (!btn.dataset.confirming) {
        btn.dataset.confirming = '1';
        btn.textContent = 'Sure?';
        btn.style.color       = 'var(--red)';
        btn.style.borderColor = 'var(--red)';

        // Auto-reset after 3 seconds if no second tap
        _deleteTimers[id] = setTimeout(() => {
            resetDeleteBtn(id);
        }, 3000);
        return;
    }

    // Second tap — confirmed, delete it
    clearTimeout(_deleteTimers[id]);
    btn.textContent = '...';
    btn.disabled = true;

    const res = await fetch(`/services/${id}`, { method: 'DELETE' });

    if (res.ok) {
        // Remove row from DOM immediately
        const row = document.getElementById(`svc-row-${id}`);
        if (row) row.remove();

        // Show empty state if no services left
        const container = document.getElementById('services-list');
        if (!container.querySelector('.price-item')) {
            container.innerHTML = `
                <div class="q-empty">
                    No services yet. Tap <strong>＋ Add</strong> to create your first one.
                </div>`;
        }

        toast(`"${name}" removed.`, 'ok');
    } else {
        resetDeleteBtn(id);
        toast('Could not delete service. Try again.', 'err');
    }
}

// Reset delete button back to normal state
function resetDeleteBtn(id) {
    const btn = document.getElementById(`del-btn-${id}`);
    if (!btn) return;
    delete btn.dataset.confirming;
    btn.textContent   = '✕';
    btn.style.color   = '';
    btn.style.borderColor = '';
    btn.disabled      = false;
}


// ---- 6. Close service sheet & reset form -----------------

function closeServiceSheet() {
    document.getElementById('service-sheet').classList.remove('show');

    // Small delay before clearing so the animation plays clean
    setTimeout(() => {
        document.getElementById('svc-editing-id').value         = '';
        document.getElementById('svc-name').value               = '';
        document.getElementById('svc-icon').value               = '';
        document.getElementById('svc-price').value              = '';
        document.getElementById('svc-duration').value           = '';
        document.getElementById('service-sheet-alert').innerHTML = '';
    }, 300);
}


// ---- Helper — escape strings for inline onclick attrs ----

// Prevents quotes in service names from breaking the onclick attribute
function escStr(str) {
    return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
