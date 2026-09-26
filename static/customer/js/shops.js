// ============================================================
// Haven Hair — shops.js
// Handles shop listing page:
//   - GPS location detection + reverse geocoding
//   - Load shops from API with queue counts
//   - Search (instant name filter + area geocode)
//   - Filter chips (open, top rated, trusted, home service)
//   - Sort (distance, rating, queue length)
//   - Render shop cards
//   - Auto-refresh every 30 seconds
// ============================================================

// ---- State -----------------------------------------------
let allShops     = [];    // full list from API
let activeFilter = 'all'; // current filter chip
let userLat      = null;
let userLon      = null;
let searchTimer  = null;  // debounce timer for search input
let refreshTimer = null;  // auto-refresh interval


// ---- Entry point -----------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    history.replaceState(null, '', '/customer/shops');
    sessionStorage.removeItem('hh_left_shops');

    // Redirect to auth if not logged in and not guest
    if (!Auth.isLoggedIn() && !Auth.isGuest()) {
        window.location.replace('/customer/auth');
        return;
    }

    // Load shops immediately — don't block on GPS
    document.getElementById('loc-name').textContent = 'All areas';
    loadShops();

    // Try to get GPS in background; if it arrives, refresh shops with location
    getLocationInBackground();
});


// ---- Location detection (non-blocking) -------------------

function getLocationInBackground() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            userLat = pos.coords.latitude;
            userLon = pos.coords.longitude;

            let area = 'Near you';
            try {
                const res  = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${userLat}&lon=${userLon}&format=json`,
                    { headers: { 'Accept-Language': 'en', 'User-Agent': 'HavenHair/1.0' } }
                );
                const data = await res.json();
                const pincode = data.address?.postcode;
                const locality = data.address?.village
                    || data.address?.suburb
                    || data.address?.neighbourhood
                    || data.address?.town
                    || data.address?.city;
                area = locality
                    ? (pincode ? `${locality} · ${pincode}` : locality)
                    : (pincode || 'Near you');
            } catch { /* keep 'Near you' */ }

            document.getElementById('loc-name').textContent = '📍 ' + area;
            loadShops();
        },
        () => {
            document.getElementById('loc-name').textContent = 'Location unavailable';
        },
        { timeout: 30000, maximumAge: 300000 }
    );
}

// Manual GPS button
function getLocation() {
    document.getElementById('loc-name').textContent = 'Detecting...';
    getLocationInBackground();
}


// ---- Load shops from API ---------------------------------

async function loadShops() {
    // Stop any previous auto-refresh
    if (refreshTimer) clearInterval(refreshTimer);

    let url = '/maps/shops';
    if (userLat && userLon) url += `?lat=${userLat}&lon=${userLon}`;

    const { ok, data } = await API.get(url);

    if (!ok) {
        hideSkeleton();
        document.getElementById('shops-list').innerHTML = `
            <div class="empty-state">
                <h3>Can't connect</h3>
                <p>Make sure Flask server is running</p>
            </div>`;
        return;
    }

    // Filter by selected radius
    const radius = parseFloat(document.getElementById('radius-sel').value);
    let shops = radius === 999
        ? data
        : data.filter(s => !s.distance_km || s.distance_km <= radius);

    allShops = shops;
    applyFilters();
    hideSkeleton();

    // Auto-refresh queue counts every 30 seconds
    refreshTimer = setInterval(refreshQueueCounts, 30000);
}


// ---- Refresh only queue counts (not full reload) ----------

// Single /maps/shops call — same endpoint, same data

async function refreshQueueCounts() {
    let url = '/maps/shops';
    if (userLat && userLon) url += `?lat=${userLat}&lon=${userLon}`;

    const { ok, data } = await API.get(url);
    if (!ok) return;

    const radius = parseFloat(document.getElementById('radius-sel').value);
    const shops  = radius === 999
        ? data
        : data.filter(s => !s.distance_km || s.distance_km <= radius);

    // Merge fresh counts into allShops
    shops.forEach(fresh => {
        const existing = allShops.find(s => s.id === fresh.id);
        if (existing) {
            existing.waiting   = fresh.waiting   || 0;
            existing.has_seated = fresh.has_seated || 0;
        }
    });

    applyFilters();
}

// ---- Search ----------------------------------------------

// Instant filter while typing — debounced 200ms
function onSearchInput(val) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFilters(), 200);
}

// Area search — geocode and reload shops
async function searchByArea() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) { loadShops(); return; }

    // If any shop name/address matches — just filter locally
    const nameMatch = allShops.filter(s =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.address.toLowerCase().includes(query.toLowerCase())
    );
    if (nameMatch.length > 0) { applyFilters(); return; }

    // No local match — geocode as area name
    document.getElementById('loc-name').textContent = '📍 ' + query;
    showSkeleton();

    try {
        const res  = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
            { headers: { 'Accept-Language': 'en', 'User-Agent': 'HavenHair/1.0' } }
        );
        const data = await res.json();

        if (data.length) {
            userLat = parseFloat(data[0].lat);
            userLon = parseFloat(data[0].lon);
            document.getElementById('loc-name').textContent = '📍 ' + (data[0].display_name?.split(',')[0] || query);
            document.getElementById('search-input').value = '';
            loadShops();
        } else {
            hideSkeleton();
            document.getElementById('loc-name').textContent = 'Location not found';
            applyFilters();
        }
    } catch {
        hideSkeleton();
        applyFilters();
    }
}


// ---- Filter chips ----------------------------------------

function setFilter(filter, btn) {
    activeFilter = filter;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
}


// ---- Sort + Filter + Render ------------------------------

function applyFilters() {
    const search = document.getElementById('search-input').value.toLowerCase().trim();
    const sort   = document.getElementById('sort-sel').value;

    // 1. Filter by search text
    let list = allShops.filter(shop => {
        const matchSearch = !search ||
            shop.name.toLowerCase().includes(search) ||
            shop.address.toLowerCase().includes(search);

        const matchFilter =
            activeFilter === 'all'          ? true :
            activeFilter === 'open'         ? shop.status === 'open' :
            activeFilter === 'top'          ? shop.reputation_score >= 90 :
            activeFilter === 'trusted'      ? shop.reputation_score >= 70 :
            activeFilter === 'home_service' ? !!shop.home_service :
            true;

        return matchSearch && matchFilter;
    });

    // 2. Sort
    list.sort((a, b) =>
        sort === 'rating'   ? b.reputation_score - a.reputation_score :
        sort === 'queue'    ? a.waiting - b.waiting :
        (a.distance_km || 999) - (b.distance_km || 999)
    );

    renderShops(list);
}


// ---- Render shop cards -----------------------------------

function renderShops(list) {
    const countEl = document.getElementById('results-count');
    countEl.innerHTML = `<strong>${list.length}</strong> shop${list.length !== 1 ? 's' : ''} found`;

    if (!list.length) {
        document.getElementById('shops-list').innerHTML = `
            <div class="empty-state">
                <h3>No shops found</h3>
                <p>Try a wider radius or different search</p>
            </div>`;
        return;
    }

    document.getElementById('shops-list').innerHTML = list.map(shop => `
        <div class="shop-card" onclick="goToShop(${shop.id})">
            <div class="shop-card-body">

                <div class="shop-card-top">
                    <div>
                        <div class="shop-name">${escHtml(shop.name)}</div>
                        <div class="shop-address">📍 ${escHtml(shop.address)}</div>
                        ${shop.home_service
                            ? '<span class="home-svc-tag">🏠 Home Service Available</span>'
                            : ''}
                    </div>
                    <span class="pill pill-${shop.status}">
                        ${Format.status(shop.status)}
                    </span>
                </div>

                <div class="shop-stats">
                    <div class="stat-cell">
                        <span class="val">${shop.waiting}</span>
                        <span class="lbl">Waiting</span>
                    </div>
                    <div class="stat-cell">
                        <span class="val">${shop.reputation_score || '—'}</span>
                        <span class="lbl">Score</span>
                    </div>
                    <div class="stat-cell">
                        <span class="val">${Format.distance(shop.distance_km)}</span>
                        <span class="lbl">Distance</span>
                    </div>
                </div>

                <div class="shop-card-footer">
                    <span class="badge">${Format.badge(shop.reputation_score)}</span>
                    <span class="shop-arrow">View Shop →</span>
                </div>

            </div>
        </div>
    `).join('');
}


// ---- Navigate to shop ------------------------------------

function goToShop(shopId) {
    window.location.href = `/customer/shop/${shopId}`;
}


// ---- Skeleton helpers ------------------------------------
// showSkeleton() generates its own markup on demand — it no
// longer depends on any pre-existing node surviving prior
// renders. hideSkeleton() stays defensive (safe to call even
// when nothing needs removing, e.g. after renderShops() has
// already cleared it).

function showSkeleton() {
    const container = document.getElementById('shops-list');
    if (!container) return;

    // Self-contained — doesn't rely on the static markup in shops.html
    // still being present. Works correctly no matter how many times
    // renderShops() has already overwritten this container.
    container.innerHTML = `
        <div id="skeleton-loader">
            ${Array.from({ length: 3 }).map(() => `
                <div class="skeleton-card">
                    <div class="skel-line w-60 skeleton"></div>
                    <div class="skel-line w-40 skeleton"></div>
                    <div class="skel-stats">
                        <div class="skel-stat skeleton"></div>
                        <div class="skel-stat skeleton"></div>
                        <div class="skel-stat skeleton"></div>
                    </div>
                </div>
            `).join('')}
        </div>`;
}

function hideSkeleton() {
    // Defensive no-op-safe removal. In practice every real call site
    // (loadShops, searchByArea) immediately follows this with either
    // a direct shops-list.innerHTML overwrite or applyFilters() →
    // renderShops(), so the skeleton is usually already gone by the
    // time this runs — but it's still safe to call standalone.
    const sk = document.getElementById('skeleton-loader');
    if (sk) sk.remove();
}

// ---- Cleanup on page leave -------------------------------

window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
});

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
