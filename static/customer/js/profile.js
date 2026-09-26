// ============================================================
// Haven Hair — profile.js
//
// Sections:
//   1. Init
//   2. Load profile
//   3. Favourite shops
//   4. Visit history
//   5. Edit name
//   6. Account actions (sign out, delete, switch role)
// ============================================================


// --- 1. Init ---------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    history.replaceState(null, '', '/customer/profile');
    const customer = Auth.get();

    if (!customer && !Auth.isGuest()) {
        window.location.replace('/customer/auth');
        return;
    }

    if (Auth.isGuest()) {
        // Guest — show sign-in notice only
        document.getElementById('guest-notice').style.display = 'block';
        loadFavourites(); // guests can still have favourites
        return;
    }

    // Logged-in user
    showProfile(customer);
    loadScore(customer.phone);
    loadFavourites();

    // Queue nav
    if (Queue.hasActive()) {
        const q = Queue.get();
        document.getElementById('nav-queue').href = `/customer/shop/${q.shopId}`;
    }
});


// --- 2. Load profile -------------------------------------

function showProfile(customer) {
    document.getElementById('profile-card').style.display    = 'flex';
    document.getElementById('score-bar').style.display       = 'flex';
    document.getElementById('history-section').style.display = 'block';
    document.getElementById('settings-section').style.display= 'block';

    document.getElementById('p-name').textContent  = customer.name;
    document.getElementById('p-phone').textContent = customer.phone;
    document.getElementById('edit-name').value     = customer.name;
}

async function loadScore(phone) {
    const { ok, data } = await API.get(
        `/hh/customer/profile?phone=${encodeURIComponent(phone)}`
    );
    if (!ok) return;

    const score = data.behaviour_score ?? 100;
    document.getElementById('p-score').textContent = score;

    // Colour the score by range
    const scoreEl = document.getElementById('p-score');
    scoreEl.style.color =
        score >= 80 ? 'var(--green)'  :
        score >= 50 ? 'var(--orange)' :
                      'var(--red)';
}


// --- 3. Favourite shops ----------------------------------

function loadFavourites() {
    const favIds = JSON.parse(localStorage.getItem('hh_favourites') || '[]');
    const el     = document.getElementById('fav-list');

    if (!favIds.length) {
        el.innerHTML = '<p class="text-muted text-sm" style="padding:6px 2px">No favourites yet. Tap ♡ on any shop to save it.</p>';
        return;
    }

    // Fetch each shop name in parallel
    Promise.all(favIds.map(id => API.get(`/shops/${id}`))).then(results => {
        el.innerHTML = results.map((r, i) => {
            if (!r.ok) return '';
            return `
            <div class="fav-item" onclick="window.location.href='/customer/shop/${favIds[i]}'">
                <span class="fav-icon">💈</span>
                <span class="fav-name">${r.data.name}</span>
                <span class="fav-go">Visit →</span>
            </div>`;
        }).join('');
    });
}


// --- 5. Edit name ----------------------------------------

function openEdit() {
    document.getElementById('edit-overlay').classList.add('show');
    lockScroll();
}

function closeEdit() {
    document.getElementById('edit-overlay').classList.remove('show');
    document.getElementById('edit-alert').innerHTML = '';
    unlockScroll();
}

async function saveName() {
    const newName = document.getElementById('edit-name').value.trim();
    if (!newName) {
        document.getElementById('edit-alert').innerHTML =
            '<div class="alert alert-err">Name cannot be empty.</div>';
        return;
    }

    const btn = document.getElementById('save-btn');
    btn.classList.add('loading');
    btn.disabled = true;

    const customer = Auth.get();
    const { ok } = await API.patch('/hh/customer/profile', {
        phone: customer.phone,
        name:  newName,
    });

    btn.classList.remove('loading');
    btn.disabled = false;

    if (ok) {
        // Update localStorage
        Auth.set({ ...customer, name: newName });
        document.getElementById('p-name').textContent = newName;
        closeEdit();
        Toast.ok('Name updated!');
    } else {
        document.getElementById('edit-alert').innerHTML =
            '<div class="alert alert-err">Could not update. Try again.</div>';
    }
}


// --- 6. Account actions ----------------------------------

function switchRole() {
    Auth.switchRole();  // clears session → redirects to landing
}

function confirmSignOut() {
    if (confirm('Sign out of Haven Hair?')) {
        Auth.clear();
        window.location.replace('/customer/auth');
    }
}

// .catch() closes that gap. Network failures were already
// safely handled by API.delete()'s internal try/catch —
// this only guards the post-response callback itself.

function confirmDelete() {
    if (!confirm('Delete your account? This cannot be undone.')) return;

    const customer = Auth.get();
    API.delete(`/customer/account?phone=${encodeURIComponent(customer.phone)}`)
       .then(({ ok }) => {
            if (ok) {
                Auth.clear();
                window.location.replace('/customer/auth');
            } else {
                Toast.err('Could not delete account. Try again.');
            }
        })
       .catch(() => Toast.err('Something went wrong. Please refresh and try again.'));  // ✅ added
}
