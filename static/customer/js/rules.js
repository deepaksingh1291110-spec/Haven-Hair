// ============================================================
// Haven Hair — rules.js
//
// 1. Load shop name + rules text from API
// 2. Enable Accept button once rules are visible
// 3. On accept → save to localStorage → redirect to NEXT_URL
// 4. goBack() → return to previous page
// ============================================================


// --- Load on page ready -----------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    await loadRules();
});


// --- Load shop name + rules from API ----------------------

async function loadRules() {
    const { ok, data } = await API.get(`/shops/${SHOP_ID}/rules`);

    if (!ok || !data.rules_text) {
        // No rules set — auto-accept and redirect immediately
        redirectNext();
        return;
    }

    // Check if this version is already accepted
    const key = `hh_rules_${SHOP_ID}_v${data.rules_version}`;
    if (localStorage.getItem(key) === 'accepted') {
        // Already accepted — no need to show page, go straight
        redirectNext();
        return;
    }

    // Fill shop name
    document.getElementById('shop-name').textContent =
        data.shop_name || 'This Shop';

    // Fill rules text
    document.getElementById('rules-text').textContent = data.rules_text;

    // Show version stamp
    document.getElementById('rules-version').textContent =
        `Rules version ${data.rules_version} · Last updated by shop owner`;

    // Enable Accept button now that rules are visible
    document.getElementById('accept-btn').disabled = false;

    // Store version for acceptRules() to use
    window._rulesVersion = data.rules_version;
}


// --- Accept rules → save → redirect -----------------------

function acceptRules() {
    const btn = document.getElementById('accept-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    // Remove all old versions for this shop first
    Object.keys(localStorage)
        .filter(k => k.startsWith(`hh_rules_${SHOP_ID}_v`))
        .forEach(k => localStorage.removeItem(k));

    // Save current version
    const key = `hh_rules_${SHOP_ID}_v${window._rulesVersion}`;
    localStorage.setItem(key, 'accepted');

    setTimeout(() => redirectNext(), 350);
}

// --- Redirect back to shop page (or custom next URL) ------

function redirectNext() {
    // NEXT_URL is set in the HTML by Flask template
    window.location.href = NEXT_URL || `/customer/shop/${SHOP_ID}`;
}


// --- Go back without accepting ----------------------------

function goBack() {
    // If there's history — go back
    if (document.referrer) {
        history.back();
    } else {
        window.location.href = `/customer/shop/${SHOP_ID}`;
    }
}
