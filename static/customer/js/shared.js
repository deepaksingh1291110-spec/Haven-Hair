// ============================================================
// HAVEN HAIR — shared.js
// Common utilities used by every customer page.
//
// Sections:
//   1. Config  (API base, feature flags)
//   2. API     (fetch wrapper with error handling)
//   3. Auth    (customer session helpers)
//   4. Toast   (in-app notifications)
//   5. Format  (time, distance, wait-time helpers)
//   6. Queue   (localStorage active queue helpers)
//   7. Nav     (page navigation helpers)
//
// Fix 10: Format.token() now pads to 4 digits (tokens are 4-digit random numbers)
// ============================================================


// --- 1. Config --------------------------------------------

const CONFIG = {
    // Flask server base URL
    // When running locally:  'http://localhost:5000'
    // When served by Flask:  '' (empty = relative URLs)
    API_BASE: '',

    // OneSignal push notifications
    ONESIGNAL_ENABLED: false,
    ONESIGNAL_APP_ID:  '',
};

const VAPID_PUBLIC_KEY = 'BMsNn1iSUM3J2JoXhoSCoivlfOMzA4FpuNjfk867dWmKxAWtIqfyAmyw7numrihqwhOWP72bqM-GCT9VxZiLoZc';

// --- 2. API -----------------------------------------------

const API = {

    async get(path) {
        try {
            const res  = await fetch(CONFIG.API_BASE + path);
            const data = await res.json();
            return { ok: res.ok, status: res.status, data };
        } catch (err) {
            console.error('API GET error:', path, err);
            return { ok: false, status: 0, data: { error: 'Cannot connect to server' } };
        }
    },

    async post(path, body) {
        try {
            const res = await fetch(CONFIG.API_BASE + path, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
            });
            const data = await res.json();
            return { ok: res.ok, status: res.status, data };
        } catch (err) {
            console.error('API POST error:', path, err);
            return { ok: false, status: 0, data: { error: 'Cannot connect to server' } };
        }
    },

    async patch(path, body) {
        try {
            const res = await fetch(CONFIG.API_BASE + path, {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
            });
            const data = await res.json();
            return { ok: res.ok, status: res.status, data };
        } catch (err) {
            console.error('API PATCH error:', path, err);
            return { ok: false, status: 0, data: { error: 'Cannot connect to server' } };
        }
    },

    async delete(path) {
        try {
            const res  = await fetch(CONFIG.API_BASE + path, { method: 'DELETE' });
            const data = await res.json();
            return { ok: res.ok, status: res.status, data };
        } catch (err) {
            console.error('API DELETE error:', path, err);
            return { ok: false, status: 0, data: { error: 'Cannot connect to server' } };
        }
    },
};


// --- 3. Auth ----------------------------------------------

const Auth = {
    get() {
        try { return JSON.parse(localStorage.getItem('hh_customer') || 'null'); }
        catch { return null; }
    },
    set(customer) {
        localStorage.setItem('hh_customer', JSON.stringify(customer));
    },
    clear() {
        localStorage.removeItem('hh_customer');
        localStorage.removeItem('hh_active_queue');
        localStorage.removeItem('hh_guest');
    },
    isLoggedIn()  { return !!this.get(); },
    isGuest()     { return localStorage.getItem('hh_guest') === '1'; },
    setGuest()    { localStorage.setItem('hh_guest', '1'); },
    require() {
        if (!this.isLoggedIn() && !this.isGuest()) {
            window.location.href = '/customer/auth';
            return false;
        }
        return true;
    },
    switchRole() {
        this.clear();
        localStorage.removeItem('hh_guest');
        window.location.href = '/';
    },
};


// --- 4. Toast ---------------------------------------------

const Toast = {
    container: null,

    _container() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
        return this.container;
    },

    show(message, type = 'default', duration = 3000) {
        const box = document.createElement('div');
        box.className = `toast ${type !== 'default' ? 'toast-' + type : ''}`;
        box.textContent = message;
        this._container().appendChild(box);
        setTimeout(() => {
            box.classList.add('toast-out');
            setTimeout(() => box.remove(), 280);
        }, duration);
    },

    ok(msg)   { this.show(msg, 'ok'); },
    err(msg)  { this.show(msg, 'err'); },
    info(msg) { this.show(msg, 'default'); },
};


// --- 5. Format Helpers ------------------------------------

const Format = {
    wait(mins) {
        if (!mins || mins <= 0) return 'Ready';
        if (mins < 60) return `~${Math.round(mins)} min`;
        return `~${(mins / 60).toFixed(1)} hr`;
    },

    distance(km) {
        if (!km && km !== 0) return '—';
        if (km < 1) return `${Math.round(km * 1000)} m`;
        return `${parseFloat(km).toFixed(1)} km`;
    },

    badge(score) {
        if (score >= 90) return '🏅 Top Rated';
        if (score >= 70) return '✓ Trusted';
        if (score > 0 && score < 50) return '⚠️ Warning';
        return '';
    },

    status(s) {
        const map = { open: 'Open', busy: 'Busy', closed: 'Closed' };
        return map[s] || s;
    },

    // Fix 10: tokens are now random 4-digit numbers (1000–9999)
    // padStart(4) handles the (extremely unlikely) case of a token < 1000
    token(n) {
        return String(n).padStart(4, '0');
    },

    timeAgo(iso) {
        const diff = (Date.now() - new Date(iso)) / 1000;
        if (diff < 60)    return 'just now';
        if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    },
};


// --- 6. Queue (Active Session) ----------------------------

// Both real call sites (shop_detail.js, queue.html) intentionally
// implement their own, more nuanced offline-aware verification —
// do not consolidate them into this method, as it would remove
// the "preserve localStorage on network failure" behavior both
// callers depend on.

const Queue = {
    save(data) {
        localStorage.setItem('hh_active_queue', JSON.stringify(data));
    },
    get() {
        try { return JSON.parse(localStorage.getItem('hh_active_queue') || 'null'); }
        catch { return null; }
    },
    clear() {
        localStorage.removeItem('hh_active_queue');
    },
    hasActive() {
        return !!this.get();
    },
    // "any failure = clear" behavior would regress both real
    // implementations if ever wired in as-is.
};

// --- 7. Navigation ----------------------------------------

const Nav = {
    toShop(shopId)     { navTo(`/customer/shop/${shopId}`); },
    toRules(shopId, next = 'queue') {
        window.location.href = `/customer/shop/${shopId}/rules?next=${next}`;
    },
    back()             { history.back(); },
    setActive() {
        const path = window.location.pathname;
        document.querySelectorAll('.nav-item').forEach(item => {
            const href = item.getAttribute('href') || item.dataset.href || '';
            item.classList.toggle('active', href !== '' && path.startsWith(href));
        });
    },
};


// --- Auto-init on every page ------------------------------

document.addEventListener('DOMContentLoaded', () => {
    Nav.setActive();
    subscribePush();

    const customer = Auth.get();
    document.querySelectorAll('[data-user-name]').forEach(el => {
        el.textContent = customer ? customer.name : 'Guest';
    });

    // phone passed as query param → server returns real unread count
    // customer is already in scope from Auth.get() above

    if (customer) {
        const updateBadge = async () => {
            // ✅ Guard: skip if no phone (shouldn't happen inside 'if customer'
            // but defensive check costs nothing)
            if (!customer?.phone) return;

            const { ok, data } = await API.get(
                `/messages/unread-count?phone=${encodeURIComponent(customer.phone)}`
            );
            if (ok && data.count > 0) {
                document.querySelectorAll('.nav-badge').forEach(b => {
                    b.textContent = data.count;
                    b.classList.add('show');
                });
            }
        };
        updateBadge();
        setInterval(updateBadge, 30000);
    }
});

async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const customer = Auth.get();
    if (!customer) return;

    // ✅ Skip if already registered this session
    // Subscription object doesn't change between page loads.
    // No reason to hit the server again.
    if (localStorage.getItem('hh_push_registered') === customer.phone) return;

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
        await API.post('/push/subscribe', {
            phone: customer.phone,
            subscription: sub.toJSON(),
        });

        // ✅ Mark as registered so we skip on every future page load
        localStorage.setItem('hh_push_registered', customer.phone);
        console.log('Push subscribed');
    } catch(e) {
        console.log('Push failed:', e);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding  = '='.repeat((4 - base64String.length % 4) % 4);
    const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData  = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function lockScroll()   { document.body.style.overflow = 'hidden'; }
function unlockScroll() { document.body.style.overflow = '';       }

// Navigation helper — keeps max 2 blocks after Shops
function navTo(url) {
    if (sessionStorage.getItem('hh_left_shops')) {
        // Already left Shops before — replace Block 2
        window.location.replace(url);
    } else {
        // First time leaving Shops — create Block 1
        sessionStorage.setItem('hh_left_shops', '1');
        window.location.href = url;
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/sw.js')
            .then(() => console.log('SW registered'))
            .catch(err => console.log('SW failed:', err));
    });
}

window.addEventListener('online',  () => {
    document.getElementById('offline-bar')?.remove();
});

window.addEventListener('offline', () => {
    if (document.getElementById('offline-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'offline-bar';
    bar.style.cssText = `
        position:fixed;top:0;left:0;right:0;z-index:9999;
        background:#e05555;color:white;text-align:center;
        padding:10px;font-size:0.85rem;font-family:sans-serif;
    `;
    bar.textContent = '⚠️ No internet connection — please turn on WiFi or mobile data';
    document.body.prepend(bar);
});
