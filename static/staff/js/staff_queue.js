// ============================================================
// HAVEN HAIR — staff_queue.js
// Staff Dashboard — Queue List Logic
//
// Responsibilities:
//   1.  Load queue for this chair from API
//   2.  Filter entries to this chair only
//   3.  Render waiting queue entries
//   4.  Render active (seated) entry — syncs with staff_core.js
//   5.  Auto-refresh every 15 seconds
//   6.  Skip a waiting entry
//   7.  Stop auto-refresh (called on sign out)
//
// Depends on:
//   - staff_core.js     (CHAIR_ID, SHOP_ID, activeEntry,
//                        renderActionButtons, renderCurrentCustomer,
//                        updateQueueBadge, toast, setLoading)
//   - staff_dashboard.html  (queue-list element)
//   - owner.css             (queue-entry, q-name, q-meta, q-badge)
//
// APIs used:
//   GET    /queue/:shop_id
//          Returns: {
//            queue: [
//              {
//                id       : int,
//                chair_id : int,
//                token    : int,
//                name     : str,
//                service  : str,
//                status   : "waiting" | "active",
//                position : int,       // only on waiting entries
//                wait_mins: int,
//                sat_at   : str | null // ISO datetime, only on active
//              }
//            ],
//            total_waiting    : int,
//            currently_seated : int
//          }
//
//   PATCH  /queue/chair/:chair_id/skip
//          Skips the first waiting entry on this chair
// ============================================================


// ---- Auto-refresh handle ---------------------------------

let queueRefreshTimer = null;
const REFRESH_INTERVAL_MS = 15000;   // 15 seconds

// Exposed so staff_actions.js can read the first waiting entry's service
let waitingEntries = [];


// ---- 1. Load queue for this chair ------------------------

// ok checked before parsing. scheduleRefresh() moved into a
// finally block so the polling loop NEVER dies — it always
// re-arms itself regardless of success, HTTP error, or thrown
// exception. This is the critical fix beyond what Claude 1
// proposed: the loop must be self-healing, not just the toast.

async function loadQueue() {
    try {
        const res = await fetch(`/queue/${SHOP_ID}`);

        // ✅ Check ok BEFORE .json() — avoids SyntaxError on HTML error pages
        if (!res.ok) {
            document.getElementById('queue-list').innerHTML = `
                <div class="alert alert-err" style="margin: 0 12px">
                    Could not load queue.
                </div>`;
            return;
        }

        const data = await res.json();  // ✅ safe — response already confirmed ok

        // ---- 2. Filter entries to this chair only ------------
        const myEntries = (data.queue || []).filter(e => e.chair_id === CHAIR_ID);
        const waiting   = myEntries.filter(e => e.status === 'waiting');
        const active    = myEntries.find(e  => e.status === 'active') || null;

        // ---- 4. Sync active entry with staff_core.js ---------
        const prevActiveId = activeEntry?.id || null;
        const newActiveId  = active?.id       || null;

        if (prevActiveId !== newActiveId) {
            activeEntry = active;
            renderCurrentCustomer();   // staff_core.js
            renderActionButtons();     // staff_core.js
        }

        updateQueueBadge(waiting.length);
        waitingEntries = waiting;

        // ---- 3. Render waiting queue list --------------------
        renderQueueList(waiting);

    } catch (err) {
        // ✅ Catches network failures, JSON parse errors from bad
        // server responses, or anything thrown deeper in render calls
        console.error('[staff] loadQueue failed:', err);
        document.getElementById('queue-list').innerHTML = `
            <div class="alert alert-err" style="margin: 0 12px">
                Could not load queue.
            </div>`;

    } finally {
        // ✅ CRITICAL: always re-arms the auto-refresh loop, regardless
        // of success, HTTP error, or thrown exception. Without this in
        // a finally block, one locked-DB response permanently kills
        // queue polling for the rest of the barber's session.
        scheduleRefresh();
    }
}

// ---- 3. Render waiting queue entries ---------------------

function renderQueueList(entries) {
    const container = document.getElementById('queue-list');
    const newHtml   = document.createElement('div');
    newHtml.innerHTML = entries.length
        ? entries.map((e, i) => buildQueueRow(e, i)).join('')
        : '<div class="q-empty">No one waiting right now.</div>';

    morphdom(container, newHtml, { childrenOnly: true });
}

// Build one queue row
function buildQueueRow(e, index) {
    const isNext   = index === 0;   // first in line
    const waitText = e.wait_mins > 0 ? `~${e.wait_mins} min wait` : 'Up next';

    return `
    <div class="queue-entry ${isNext ? 'next-up' : ''}" id="qe-${e.id}">

        <div class="q-badge">#${e.token}</div>

        <div class="q-info">
            <div class="q-name">${escHtml(e.name || 'Walk-in')}</div>
            <div class="q-meta">
                ${e.service ? `<span class="q-service">${escHtml(e.service)}</span>` : ''}
                <span class="q-wait">${waitText}</span>
                ${isNext ? '<span class="q-next-pill">Next ↑</span>' : ''}
            </div>
        </div>

        <button class="q-skip-btn"
                id="skip-btn-${e.id}"
                onclick="skipEntry(${e.id})"
                title="Skip this customer">
            Skip
        </button>

    </div>`;
}


// ---- 5. Auto-refresh -------------------------------------

function scheduleRefresh() {
    // Clear any existing timer before setting a new one
    if (queueRefreshTimer) clearTimeout(queueRefreshTimer);
    queueRefreshTimer = setTimeout(loadQueue, REFRESH_INTERVAL_MS);
}

// ---- 7. Stop auto-refresh (called from signOut) ----------

function stopQueueRefresh() {
    if (queueRefreshTimer) {
        clearTimeout(queueRefreshTimer);
        queueRefreshTimer = null;
    }
}


// ---- 6. Skip a waiting entry -----------------------------
//
// Staff can skip any waiting entry on their chair.
// Uses the PATCH /queue/chair/:chair_id/skip endpoint
// which always skips the FIRST waiting entry.
//
// If the tapped entry is not first, show a message explaining
// that entries must be skipped in order.

async function skipEntry(entryId) {
    const btn = document.getElementById(`skip-btn-${entryId}`);
    if (!btn || btn.disabled) return;

    // Check if this entry is first in line
    const container = document.getElementById('queue-list');
    const firstRow  = container.querySelector('.queue-entry');
    const isFirst   = firstRow && firstRow.id === `qe-${entryId}`;

    if (!isFirst) {
        toast('Can only skip the next person in line.', 'err');
        return;
    }

    // Confirm skip — button turns red on first tap
    if (!btn.dataset.confirming) {
        btn.dataset.confirming = '1';
        btn.textContent = 'Sure?';
        btn.style.color       = 'var(--red)';
        btn.style.borderColor = 'var(--red)';

        // Auto-reset after 3 seconds
        setTimeout(() => {
            delete btn.dataset.confirming;
            btn.textContent   = 'Skip';
            btn.style.color   = '';
            btn.style.borderColor = '';
        }, 3000);
        return;
    }

    // Confirmed — skip it
    btn.disabled    = true;
    btn.textContent = '...';

    const res = await fetch(`/queue/chair/${CHAIR_ID}/skip`, { method: 'PATCH' });

    if (res.ok) {
        // Remove the row immediately then reload
        const row = document.getElementById(`qe-${entryId}`);
        if (row) row.remove();
        toast('Customer skipped.', 'ok');
        loadQueue();
    } else {
        btn.disabled    = false;
        btn.textContent = 'Skip';
        delete btn.dataset.confirming;
        toast('Could not skip. Try again.', 'err');
    }
}


// ---- Helper — escape HTML --------------------------------

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
