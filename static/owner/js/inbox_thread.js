// ============================================================
// HAVEN HAIR — inbox_thread.js
// Owner Inbox Page — Chat Thread View
//
// Responsibilities:
//   1.  Open thread — switch view, show AI context card
//   2.  Load messages for a conversation
//   3.  Render message bubbles with date separators
//   4.  Send a reply as owner
//   5.  Auto-scroll to latest message
//   6.  Auto-resize textarea as owner types
//   7.  Mark conversation as read
//   8.  Close thread — go back to list view
//
// Depends on:
//   - inbox_list.js    (toast, escHtml, owner, SHOP_ID)
//   - inbox.html       (view-list, view-thread, thread-messages,
//                       thread-customer-name, thread-stars,
//                       ai-context-card, msg-input, send-btn)
//   - owner.css        (msg-row, msg-bubble, date-sep, ai-context-card)
//
// APIs used:
//   GET   /api/owner/messages/:conversation_id
//         Returns: [
//           {
//             id        : int,
//             sender    : "owner" | "customer",
//             message   : str,
//             sent_at   : str    // ISO datetime
//           },
//           ...
//         ]
//
//   POST  /api/owner/messages
//         Body:    { conversation_id, owner_id, message }
//         Returns: { id, sender, message, sent_at }
//
//   PATCH /api/owner/conversations/:id/read
//         Marks all messages in this conversation as read
// ============================================================


// ---- Thread state ----------------------------------------

let threadRefreshTimer = null;   // auto-refresh interval for open thread

// activeConv holds the full conversation object currently open in the thread view
let activeConv = null;

// ---- 1. Open thread — switch view, show AI context card --

function openThread(conv) {
    activeConv = conv;

    // Switch views
    document.getElementById('view-list').style.display   = 'none';
    document.getElementById('view-thread').style.display = 'block';

    // Fill thread header
    document.getElementById('thread-customer-name').textContent = conv.customer_name || '—';
    document.getElementById('thread-stars').textContent =
        conv.star_rating ? '★'.repeat(conv.star_rating) + '☆'.repeat(5 - conv.star_rating) : '';

    // Show AI context card if there is review context
    renderAiContext(conv);

    // Set thread messages height so it doesn't overlap input bar
    adjustThreadHeight();

    // Load messages
    loadMessages(conv.conversation_id);

    // Mark as read (no await — fire and forget)
    markAsRead(conv.conversation_id);

    threadRefreshTimer = setInterval(() => {
        loadMessages(conv.conversation_id);
    }, 10000);
}

// ---- Render AI context card at top of thread -------------

function renderAiContext(conv) {
    const card  = document.getElementById('ai-context-card');
    const text  = document.getElementById('ai-context-text');
    const topic = document.getElementById('ai-context-topic');

    // Build context text from available data
    const parts = [];
    if (conv.customer_name) parts.push(`<strong>${conv.customer_name}</strong>`);
    if (conv.star_rating)   parts.push(`rated you <strong>${conv.star_rating} star${conv.star_rating !== 1 ? 's' : ''}</strong>`);
    if (conv.wait_mins)     parts.push(`waited <strong>${conv.wait_mins} min</strong>`);

    if (!parts.length && !conv.ai_topic) {
        card.style.display = 'none';
        return;
    }

    text.innerHTML = parts.join(' · ');

    // AI suggested topic
    if (conv.ai_topic) {
        topic.textContent = `💡 Suggested: mention the ${conv.ai_topic}`;
    } else {
        topic.textContent = '';
    }

    // Show review snippet if available
    if (conv.review_text) {
        const snippet = conv.review_text.length > 80
            ? conv.review_text.slice(0, 80) + '…'
            : conv.review_text;
        topic.textContent += (topic.textContent ? '  •  ' : '') + `"${snippet}"`;
    }

    card.style.display = 'block';
}


// ---- 2. Load messages for a conversation -----------------

async function loadMessages(conversationId) {
    const container = document.getElementById('thread-messages');
    container.innerHTML = `
        <div class="loading-state" style="padding:40px 0">
            <div class="spinner"></div>
        </div>`;

    const res  = await fetch(`/hh/owner/messages/${conversationId}`);
    const data = await res.json();

    if (!res.ok) {
        container.innerHTML = `
            <div class="q-empty">Could not load messages.</div>`;
        return;
    }

    renderMessages(data);
}


// ---- 3. Render message bubbles with date separators ------

function renderMessages(messages) {
    const container = document.getElementById('thread-messages');

    if (!messages.length) {
        container.innerHTML = `
            <div class="q-empty" style="padding: 30px 0">
                No messages yet. Say hello 👋
            </div>`;
        return;
    }

    let lastDateStr = '';
    let html = '';

    messages.forEach(msg => {
        const dateStr = formatDateLabel(msg.sent_at);

        // Insert date separator when the date changes
        if (dateStr !== lastDateStr) {
            html += `<div class="date-sep">${dateStr}</div>`;
            lastDateStr = dateStr;
        }

        const side    = msg.sender === 'owner' ? 'from-owner' : 'from-customer';
        const timeStr = formatMsgTime(msg.sent_at);

        html += `
        <div class="msg-row ${side}">
            <div>
                <div class="msg-bubble">${escHtml(msg.message)}</div>
                <div class="msg-time">${timeStr}</div>
            </div>
        </div>`;
    });

    container.innerHTML = html;
    scrollToBottom();
}


// ---- 4. Send a reply as owner ----------------------------

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text  = input.value.trim();

    if (!text || !activeConv) return;

    // Disable send button while sending
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;

    // Optimistically add the message to the UI immediately
    appendMessage({ sender: 'owner', message: text, sent_at: new Date().toISOString() });
    input.value = '';
    input.style.height = '42px';    // reset textarea height

    const res = await fetch('/hh/owner/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            conversation_id: activeConv.conversation_id,
            owner_id:        owner.id,
            message:         text,
        }),
    });

    sendBtn.disabled = false;

    if (!res.ok) {
        toast('Message failed to send. Try again.', 'err');
    }
}

// Append a single message bubble without re-rendering the full list
function appendMessage(msg) {
    const container = document.getElementById('thread-messages');

    // Remove empty state if present
    const empty = container.querySelector('.q-empty');
    if (empty) empty.remove();

    const side    = msg.sender === 'owner' ? 'from-owner' : 'from-customer';
    const timeStr = formatMsgTime(msg.sent_at);

    const row = document.createElement('div');
    row.className = `msg-row ${side}`;
    row.innerHTML = `
        <div>
            <div class="msg-bubble">${escHtml(msg.message)}</div>
            <div class="msg-time">${timeStr}</div>
        </div>`;

    container.appendChild(row);
    scrollToBottom();
}


// ---- 5. Auto-scroll to latest message -------------------

function scrollToBottom() {
    const container = document.getElementById('thread-messages');
    container.scrollTop = container.scrollHeight;
}


// ---- 6. Auto-resize textarea as owner types -------------

function autoResize(el) {
    el.style.height = '42px';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}


// ---- 7. Mark conversation as read -----------------------

async function markAsRead(conversationId) {
    await fetch(`/hh/owner/conversations/${conversationId}/read`, {
        method: 'PATCH',
    });

    // Remove unread dot from the list item in view-list
    // (in case user goes back to the list)
    const dots = document.querySelectorAll('.inbox-item .notif-dot');
    dots.forEach(d => d.remove());
}


// ---- 8. Close thread — back to list view ----------------

function closeThread() {
    activeConv = null;

    clearInterval(threadRefreshTimer);
    threadRefreshTimer = null;

    document.getElementById('view-thread').style.display = 'none';
    document.getElementById('view-list').style.display   = 'block';

    // Clear message input
    const input = document.getElementById('msg-input');
    input.value = '';
    input.style.height = '42px';

    // Reload conversation list to reflect read status
    loadConversations();
}


// ---- Thread height helper --------------------------------

// Sets thread-messages height so it fills the screen between
// the header and the fixed input bar without overlapping either
function adjustThreadHeight() {
    const headerH = 56;
    const inputH  = 66;
    const ctxCard = document.getElementById('ai-context-card');
    const ctxH    = ctxCard.style.display !== 'none' ? (ctxCard.offsetHeight || 80) : 0;
    const available = window.innerHeight - headerH - inputH - ctxH;

    document.getElementById('thread-messages').style.height = `${available}px`;
}

window.addEventListener('resize', adjustThreadHeight);


// ---- Time formatting helpers ----------------------------

// "Today", "Yesterday", "Mon 12 May"
function formatDateLabel(iso) {
    if (!iso) return '';
    const d   = new Date(iso);
    const now = new Date();

    const sameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth()    === b.getMonth()    &&
        a.getDate()     === b.getDate();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (sameDay(d, now))       return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';

    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// "2:45 PM"
function formatMsgTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// Add at bottom of inbox_thread.js:
window.addEventListener('beforeunload', () => {
    clearInterval(threadRefreshTimer);
});
