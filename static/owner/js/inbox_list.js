// ============================================================
// HAVEN HAIR — inbox_list.js
// Owner Inbox Page — Conversation List View
//
// Responsibilities:
//   1.  Shared state & auth guard
//   2.  Init — load conversation list on page load
//   3.  Load conversations from API
//   4.  Render conversation list items
//   5.  Open a thread (hands off to inbox_thread.js)
//   6.  Drawer navigation
//   7.  Toast notifications
//   8.  Shared helpers
//
// Depends on:
//   - inbox_thread.js   (openThread function)
//   - inbox.html        (conv-list, conv-loader, conv-empty, view-list)
//   - owner.css         (inbox-item, inbox-avatar, inbox-info, inbox-preview)
//
// APIs used:
//   GET  /api/owner/conversations?shop_id=X
//        Returns: [
//          {
//            conversation_id : int,
//            customer_id     : int,
//            customer_name   : str,
//            last_message    : str,
//            last_time       : str,     // ISO datetime
//            unread          : bool,
//            star_rating     : int,     // 1-5 from review
//            wait_mins       : int,     // how long customer waited
//            review_text     : str,     // original review
//            ai_topic        : str      // AI suggested topic e.g. "wait time"
//          },
//          ...
//        ]
// ============================================================


// ---- 1. Shared state & auth guard ------------------------

const owner   = JSON.parse(localStorage.getItem('hh_owner') || 'null');
const SHOP_ID = parseInt(localStorage.getItem('hh_active_shop') || '0');
let listRefreshTimer = null;

if (!owner)   window.location.href = '/owner/auth';
if (!SHOP_ID) window.location.href = '/owner/branches';


// ---- 2. Init ---------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('drawer-name').textContent = owner.name;
    await loadConversations();

    // Check if redirected from dashboard chat button
    const params = new URLSearchParams(window.location.search);
    const phone  = params.get('phone');

    if (phone) {
        // Find matching conversation and auto open thread
        const res  = await fetch(`/hh/owner/conversations?shop_id=${SHOP_ID}`);
        const data = await res.json();

        const conv = data.find(c => c.customer_phone === phone);
        if (conv) {
            openThread(conv);   // auto open matching thread
        }
    }

    listRefreshTimer = setInterval(loadConversations, 15000);
});

// ---- 3. Load conversations from API ----------------------

async function loadConversations() {
    const res  = await fetch(`/hh/owner/conversations?shop_id=${SHOP_ID}`);
    const data = await res.json();

    document.getElementById('conv-loader').style.display = 'none';

    if (!res.ok) {
        toast('Could not load inbox.', 'err');
        return;
    }

    if (!data.length) {
        document.getElementById('conv-empty').style.display = 'block';
        return;
    }

    renderConversations(data);
}


// ---- 4. Render conversation list items -------------------

function renderConversations(list) {
    const container = document.getElementById('conv-list');

    container.innerHTML = list.map(c => buildConvItem(c)).join('');
}

// Build one conversation row
function buildConvItem(c) {
    const initials  = getInitials(c.customer_name);
    const timeLabel = formatTime(c.last_time);
    const preview   = c.last_message || 'No messages yet';
    const stars     = '★'.repeat(c.star_rating || 0) + '☆'.repeat(5 - (c.star_rating || 0));

    return `
    <div class="inbox-item" onclick="openThread(${JSON.stringify(c).replace(/"/g, '&quot;')})">

        <div class="inbox-avatar ${c.unread ? 'unread' : ''}">
            ${initials}
        </div>

        <div class="inbox-info">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px">
                <span class="inbox-name">${c.customer_name}</span>
                <span style="font-size:0.66rem; color:var(--amber); letter-spacing:0.5px">${stars}</span>
            </div>
            <div class="inbox-preview ${c.unread ? 'unread' : ''}">
                ${escHtml(preview)}
            </div>
        </div>

        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex-shrink:0">
            <span class="inbox-time">${timeLabel}</span>
            ${c.unread ? '<span class="notif-dot show" style="position:static"></span>' : ''}
        </div>

    </div>`;
}


// ---- 5. Open a thread ------------------------------------
// Defined in inbox_thread.js — calling it here keeps the
// list and thread logic cleanly separated.
// openThread(conversation) is implemented in inbox_thread.js


// ---- 6. Drawer navigation --------------------------------

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


// ---- 7. Toast notifications ------------------------------

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


// ---- 8. Shared helpers -----------------------------------

// Return 1–2 letter initials from a full name
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Format ISO datetime into a short readable label
// e.g. "2 min ago", "3h ago", "Mon", "12 May"
function formatTime(iso) {
    if (!iso) return '';
    const now   = new Date();
    const then  = new Date(iso);
    const diff  = Math.floor((now - then) / 1000);   // seconds

    if (diff < 60)                return 'just now';
    if (diff < 3600)              return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)             return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 7 * 86400) {
        return then.toLocaleDateString('en-GB', { weekday: 'short' });
    }
    return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Escape HTML special characters to prevent XSS in innerHTML
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.addEventListener('beforeunload', () => {
    clearInterval(listRefreshTimer);
});
