// ============================================================
// HAVEN HAIR — settings_map.js
// Owner Settings Page — Shop Location Map Logic
//
// Responsibilities:
//   1.  Init map on page load (Leaflet + OpenStreetMap)
//   2.  Mode switching — GPS / Pin / Search
//   3.  GPS mode — phone geolocation → move marker
//   4.  Pin mode  — draggable marker, user moves it manually
//   5.  Search mode — address text → geocode → move marker
//   6.  Tile (map style) switcher — Street / Dark / Satellite / Topo
//   7.  Coordinate display — live lat/lon boxes
//   8.  Save location — PATCH /shops/:id with lat + lon + address
//
// Depends on:
//   - Leaflet 1.9.4       (loaded before this file in settings.html)
//   - settings_core.js    (SHOP_ID, shopData, toast, setLoading, setAlert)
//   - settings.html       (shop-map, map-* element IDs)
//
// External APIs:
//   Leaflet tiles from OpenStreetMap, ESRI, Stadia (all free)
//   Nominatim (OpenStreetMap) for address geocoding — free, no key
//   PATCH /shops/:id → save lat, lon, address to backend
// ============================================================


// ---- Module state ----------------------------------------

let map        = null;    // Leaflet map instance
let marker     = null;    // Leaflet draggable marker
let tileLayer  = null;    // Current active tile layer
let mapMode    = 'gps';   // 'gps' | 'pin' | 'search'

// Default center — Riyadh (used if no shop location saved yet)
const DEFAULT_LAT = 24.7136;
const DEFAULT_LON = 46.6753;
const DEFAULT_ZOOM = 15;

// Tile layer definitions — all free, no API key needed
const TILES = {
    street: {
        url:   'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attr:  '© OpenStreetMap contributors',
        label: '🗺 Street',
    },
    dark: {
        url:   'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
        attr:  '© Stadia Maps © OpenStreetMap',
        label: '🌙 Dark',
    },
    satellite: {
        url:   'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attr:  '© ESRI World Imagery',
        label: '🛰 Satellite',
    },
    topo: {
        url:   'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attr:  '© OpenTopoMap contributors',
        label: '🏔 Topo',
    },
};


// ---- 1. Init map on page load ----------------------------

// Wait for DOMContentLoaded AND Leaflet to be available
// settings_core.js DOMContentLoaded runs first (loads shop data),
// then this file's listener runs and inits the map.

window.mapReady = initMap;

function initMap() {
    // Starting coordinates — use saved shop location if available
    const startLat = (shopData && shopData.lat) ? shopData.lat : DEFAULT_LAT;
    const startLon = (shopData && shopData.lon) ? shopData.lon : DEFAULT_LON;

    // Create map
    map = L.map('shop-map', {
        center:        [startLat, startLon],
        zoom:          DEFAULT_ZOOM,
        zoomControl:   true,
        attributionControl: true,
    });

    window._settingsMap = map;

    // Load default tile layer (street)
    setTile('street');

    // Create draggable marker
    marker = L.marker([startLat, startLon], { draggable: false })
        .addTo(map);

    // When marker is dragged — update coordinate display
    marker.on('dragend', () => {
        const pos = marker.getLatLng();
        updateCoordDisplay(pos.lat, pos.lng);
    });

    // Show saved location in status row
    if (shopData && shopData.lat) {
        updateCoordDisplay(shopData.lat, shopData.lon);
        document.getElementById('map-status-text').textContent =
            shopData.address || 'Saved location loaded';
    } else {
        document.getElementById('map-status-text').textContent =
            'No location saved yet — set one below';
    }

    // Default to GPS mode
    setMapMode('gps');
}


// ---- 2. Mode switching -----------------------------------

function setMapMode(mode) {
    mapMode = mode;

    // Update mode button highlights
    ['gps', 'pin', 'search'].forEach(m => {
        document.getElementById(`mode-${m}`)
            .classList.toggle('active', m === mode);
    });

    // Show/hide search row
    document.getElementById('map-search-row').style.display =
        mode === 'search' ? 'block' : 'none';

    // Toggle marker draggability
    if (marker) {
        if (mode === 'pin') {
            marker.dragging.enable();
            showMapToast('Drag the pin to your exact location');
        } else {
            marker.dragging.disable();
        }
    }

    // GPS mode — trigger immediately
    if (mode === 'gps') {
        getGpsLocation();
    }
}


// ---- 3. GPS mode — phone geolocation --------------------

function getGpsLocation() {
    setMapStatus('📡 Getting your location...');

    if (!navigator.geolocation) {
        setMapStatus('⚠️ GPS not supported on this device');
        setAlert('map-alert', 'Your browser does not support GPS. Use Pin or Search mode.');
        return;
    }

    navigator.geolocation.getCurrentPosition(
        // Success
        (pos) => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;

            moveMarkerTo(lat, lon, true);
            updateCoordDisplay(lat, lon);
            reverseGeocode(lat, lon);
            setMapStatus('📍 GPS location found — tap Update Location to save');
        },
        // Error
        (err) => {
            const msgs = {
                1: 'Location access denied. Enable location in browser settings.',
                2: 'Could not detect location. Try Pin mode instead.',
                3: 'Location request timed out. Try again.',
            };
            const msg = msgs[err.code] || 'Could not get GPS location.';
            setMapStatus(`⚠️ ${msg}`);
            setAlert('map-alert', msg);
        },
        // Options
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// Reverse geocode — get human-readable address from lat/lon
// Uses Nominatim (OpenStreetMap) — completely free, no key needed
async function reverseGeocode(lat, lon) {
    try {
        const res  = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
            { headers: { 'Accept-Language': 'en', 'User-Agent': 'HavenHair/1.0' } }
        );
        const data = await res.json();
        const addr = data.display_name || '';
        if (addr) {
            setMapStatus(`📍 ${addr}`);
            // Store address string for save
            marker._resolvedAddress = addr;
        }
    } catch (e) {
        // Silently fail — address is optional, lat/lon is what matters
    }
}


// ---- 4. Pin mode — draggable marker ---------------------
// Pin mode dragging is enabled/disabled inside setMapMode().
// When user drops the pin, dragend event fires → updateCoordDisplay().
// Reverse geocode fires on save to get address string.


// ---- 5. Search mode — address text → geocode ------------

async function searchAddress() {
    const input = document.getElementById('map-search-input');
    const query = (input.value || '').trim();

    if (!query) return;

    setMapStatus('🔍 Searching...');

    try {
        const res  = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
            { headers: { 'Accept-Language': 'en', 'User-Agent': 'HavenHair/1.0' } }
        );
        const data = await res.json();

        if (!data.length) {
            setMapStatus('⚠️ Address not found. Try a different search.');
            return;
        }

        const lat  = parseFloat(data[0].lat);
        const lon  = parseFloat(data[0].lon);
        const addr = data[0].display_name || query;

        moveMarkerTo(lat, lon, true);
        updateCoordDisplay(lat, lon);
        setMapStatus(`📍 ${addr}`);
        marker._resolvedAddress = addr;

    } catch (e) {
        setMapStatus('⚠️ Search failed. Check your connection.');
    }
}


// ---- 6. Tile (map style) switcher -----------------------

function setTile(name) {
    const config = TILES[name];
    if (!config || !map) return;

    // Remove existing tile layer
    if (tileLayer) map.removeLayer(tileLayer);

    // Add new tile layer
    tileLayer = L.tileLayer(config.url, {
        attribution: config.attr,
        maxZoom:     19,
    }).addTo(map);

    // Update tile button highlights
    ['street', 'dark', 'satellite', 'topo'].forEach(t => {
        const btn = document.getElementById(`tile-${t}`);
        if (btn) btn.classList.toggle('active', t === name);
    });
}


// ---- 7. Coordinate display — live lat/lon boxes ---------

function updateCoordDisplay(lat, lon) {
    document.getElementById('map-lat-display').textContent =
        parseFloat(lat).toFixed(7);
    document.getElementById('map-lon-display').textContent =
        parseFloat(lon).toFixed(7);
}


// ---- 8. Save location -----------------------------------

async function saveLocation() {
    if (!map || !marker) return;

    const pos = marker.getLatLng();
    const lat  = pos.lat;
    const lon  = pos.lng;

    if (!lat || !lon) {
        setAlert('map-alert', 'No location selected. Use GPS, Pin or Search first.');
        return;
    }

    setLoading('map-save-btn', true);

    // Get address — use resolved one or reverse geocode now
    let address = marker._resolvedAddress || shopData?.address || '';
    if (!address) {
        try {
            const res  = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
                { headers: { 'Accept-Language': 'en', 'User-Agent': 'HavenHair/1.0' } }
            );
            const data = await res.json();
            address = data.display_name || '';
        } catch (e) { /* silently skip */ }
    }

    const res = await fetch(`/shops/${SHOP_ID}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ lat, lon, address }),
    });

    setLoading('map-save-btn', false);

    if (res.ok) {
        // Update local shopData
        if (shopData) {
            shopData.lat     = lat;
            shopData.lon     = lon;
            shopData.address = address;
        }

        // Update address view in Shop Info section
        const addrView = document.getElementById('si-addr-view');
        if (addrView && address) addrView.textContent = address;

        setMapStatus(`✅ Location saved`);
        document.getElementById('map-alert').innerHTML = '';
        toast('Location updated.', 'ok');
    } else {
        const data = await res.json().catch(() => ({}));
        setAlert('map-alert', data.error || 'Could not save location. Try again.');
    }
}


// ---- Shared map helpers ----------------------------------

// Move marker and optionally pan the map to it
function moveMarkerTo(lat, lon, panTo = false) {
    if (!marker) return;
    marker.setLatLng([lat, lon]);
    if (panTo && map) map.setView([lat, lon], DEFAULT_ZOOM);
}

// Update the status row text
function setMapStatus(text) {
    const el = document.getElementById('map-status-text');
    if (el) el.textContent = text;
}

// Brief floating message on the map (uses Leaflet popup)
function showMapToast(text) {
    if (!map || !marker) return;
    marker.bindPopup(text).openPopup();
    setTimeout(() => marker.closePopup(), 2000);
}
