const CACHE = 'havenhair-v1';

// Files to cache for offline shell
const STATIC_ASSETS = [
    '/static/css/main.css',
    '/static/customer/css/customer.css',
    '/static/owner/css/owner.css',
    '/static/customer/js/shared.js',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Only handle GET requests
    if (e.request.method !== 'GET') return;

    // Network first for API calls
    if (e.request.url.includes('/queue/') ||
        e.request.url.includes('/shops/') ||
        e.request.url.includes('/auth/') ||
        e.request.url.includes('/home-service/')) {
        e.respondWith(
            fetch(e.request).catch(() =>
                new Response(
                    JSON.stringify({ error: 'No internet connection' }),
                    { headers: { 'Content-Type': 'application/json' } }
                )
            )
        );
        return;
    }

    // Cache first for static assets
    e.respondWith(
        caches.match(e.request).then(cached =>
            cached || fetch(e.request).catch(() =>
                new Response('Offline', { status: 503 })
            )
        )
    );
});

self.addEventListener('push', e => {
    e.waitUntil((async () => {
        try {
            // Guard: push events can legally fire with no data payload
            if (!e.data) {
                await self.registration.showNotification('Haven Hair', {
                    body:    'You have a new update.',
                    icon:    '/static/icons/icon-192.png',
                    badge:   '/static/icons/icon-192.png',
                    vibrate: [200, 100, 200],
                    data:    { url: '/' },
                });
                return;
            }

            // JSON parse now happens INSIDE e.waitUntil() —
            // a SyntaxError here is caught below instead of
            // aborting the entire event handler.
            const data = e.data.json();

            await self.registration.showNotification(
                data.title || 'Haven Hair',
                {
                    body:    data.body    || 'You have a new update.',
                    icon:    '/static/icons/icon-192.png',
                    badge:   '/static/icons/icon-192.png',
                    vibrate: [200, 100, 200],
                    // Fallback to '/' so notificationclick always
                    // has a valid URL to open
                    data:    { url: data.url || '/' },
                }
            );
        } catch (err) {
            // Malformed JSON or showNotification failure —
            // show a generic fallback so the customer is never
            // silently dropped. Log for debugging.
            console.error('[SW] push handler error:', err);
            await self.registration.showNotification('Haven Hair', {
                body:    'You have a new notification.',
                icon:    '/static/icons/icon-192.png',
                badge:   '/static/icons/icon-192.png',
                vibrate: [200, 100, 200],
                data:    { url: '/' },
            });
        }
    })());
});

// optional chaining + fallback to '/'
// Mirrors the same defensive pattern used in the push handler (line 86)

self.addEventListener('notificationclick', e => {
    e.notification.close();
    // ✅ data?.url guards against null notification data
    // (OS-persisted notifications, old SW schema, testing tools)
    // Fallback to '/' ensures tap always opens something useful
    const url = e.notification.data?.url || '/';
    e.waitUntil(clients.openWindow(url));
});
