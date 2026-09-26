// ============================================================
// Haven Hair — messages.js
//
// Sections:
//   1. State
//   2. Init
//   3. Conversation list
//   4. Thread view (open, render, scroll)
//   5. Send message
//   6. Auto-refresh
//   7. UI helpers
// ============================================================


// --- 1. State --------------------------------------------

let currentShopId   = null;   // shop ID of open thread
let currentShopName = '';     // shop name of open thread
let refreshTimer    = null;   // auto-refresh interval for open thread
let customer        = null;   // logged-in customer object


// --- 2. Init ---------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    history.replaceState(null, '', '/customer/messages');
    if (!Auth.isLoggedIn()) {
        // Guests can't message — redirect to auth
        window.location.replace('/customer/auth');
        return;
    }

    customer = Auth.get();

    // If URL has ?shop=ID open that thread directly
    const params = new URLSearchParams(window.location.search);
    const shopParam = params.get('shop');

    if (shopParam) {
        // Load shop name then open thread
        const { ok, data } = await API.get(`/shops/${shopParam}`);
        if (ok) openThread(parseInt(shopParam), data.name);
    } else {
        loadConversations();
    }

    // Queue nav badge
    if (Queue.hasActive()) {
        const q = Queue.get();
        document.getElementById('nav-queue').href = `/customer/shop/${q.shopId}`;
    }
});


// --- 3. Conversation list --------------------------------

async function loadConversations() {
    const { ok, data } = await API.get(
        `/messages/conversations?phone=${encodeURIComponent(customer.phone)}`
    );

    document.getElementById('conv-loader').style.display = 'none';

    if (!ok || !data.length) {
        document.getElementById('conv-empty').style.display = 'block';
        return;
    }

    document.getElementById('conv-list').innerHTML = data.map(conv => `
        <div class="conv-item" onclick="openThread(${conv.shop_id}, '${escHtml(conv.shop_name)}')">
            <div class="conv-avatar ${conv.unread > 0 ? 'unread' : ''}">💈</div>
            <div class="conv-info">
                <div class="conv-name">${escHtml(conv.shop_name)}</div>
                <div class="conv-preview ${conv.unread > 0 ? 'unread-preview' : ''}">
                    ${conv.last_sender === 'customer' ? 'You: ' : ''}${escHtml(conv.last_message)}
                </div>
            </div>
            <div class="conv-meta">
                <span class="conv-time">${Format.timeAgo(conv.last_time)}</span>
                <span class="conv-unread-dot ${conv.unread > 0 ? 'show' : ''}"></span>
            </div>
        </div>
    `).join('');
}


// --- 4. Thread view --------------------------------------

function openThread(shopId, shopName) {
    currentShopId   = shopId;
    currentShopName = shopName;

    // Switch views
    document.getElementById('view-list').style.display   = 'none';
    document.getElementById('view-thread').style.display = 'block';

    // Set header
    document.getElementById('thread-shop-name').textContent = shopName;

    // Load messages
    loadThread();

    // Auto-refresh every 5 seconds while thread is open
    refreshTimer = setInterval(loadThread, 5000);
}

function closeThread() {
    clearInterval(refreshTimer);
    currentShopId = null;

    document.getElementById('view-thread').style.display = 'none';
    document.getElementById('view-list').style.display   = 'block';

    // Reload conversations to update unread badges
    loadConversations();
}

async function loadThread() {
    const { ok, data } = await API.get(
        `/messages/${currentShopId}/${encodeURIComponent(customer.phone)}`
    );

    if (!ok) return;

    const container = document.getElementById('thread-messages');

    // Check if user is already at bottom before re-render
    const atBottom = container.scrollHeight - container.scrollTop
                     <= container.clientHeight + 60;

    renderMessages(data);

    // Only auto-scroll if user was already at bottom
    if (atBottom) scrollToBottom();
}

function renderMessages(messages) {
    const container = document.getElementById('thread-messages');

    if (!messages.length) {
        container.innerHTML = `
            <div class="empty-state" style="padding:40px 20px">
                <h3>Start the conversation</h3>
                <p>Send a message to ${escHtml(currentShopName)}</p>
            </div>`;
        // Set thread height so input bar doesn't cover empty state
        setThreadHeight();
        return;
    }

    let lastDate = '';
    let html     = '';

    messages.forEach(msg => {
        const msgDate = new Date(msg.created_at).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric'
        });

        // Date separator when day changes
        if (msgDate !== lastDate) {
            html += `<div class="date-sep">${msgDate}</div>`;
            lastDate = msgDate;
        }

        const fromMe = msg.sender === 'customer';
        html += `
            <div class="msg-row ${fromMe ? 'from-me' : 'from-owner'}">
                <div>
                    <div class="msg-bubble">${escHtml(msg.message)}</div>
                    <div class="msg-time">${Format.timeAgo(msg.created_at)}</div>
                </div>
            </div>`;
    });

    container.innerHTML = html;
    setThreadHeight();
}

function setThreadHeight() {
    // Messages area fills between header and input bar
    const headerH  = 56;   // --header-h
    const inputH   = 64;   // approximate input bar height
    const navH     = 64;   // --nav-h
    const el       = document.getElementById('thread-messages');
    el.style.paddingTop    = (headerH + 10) + 'px';
    el.style.paddingBottom = (inputH + navH + 16) + 'px';
    el.style.minHeight     = '100vh';
}

function scrollToBottom() {
    const container = document.getElementById('thread-messages');
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}


// --- 5. Send message -------------------------------------

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text  = input.value.trim();
    if (!text) return;

    const btn = document.getElementById('send-btn');
    btn.disabled = true;

    const { ok } = await API.post('/messages', {
        shop_id: currentShopId,
        phone:   customer.phone,
        name:    customer.name,
        message: text,
    });

    btn.disabled = false;

    if (ok) {
        input.value          = '';
        input.style.height   = '42px';
        loadThread();
    } else {
        Toast.err('Could not send. Try again.');
    }
}


// --- 6. Auto-resize textarea -----------------------------

function autoResize(el) {
    el.style.height = '42px';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}


// --- 7. Helpers ------------------------------------------

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Add at very bottom of messages.js:
window.addEventListener('beforeunload', () => {
    clearInterval(refreshTimer);
});
