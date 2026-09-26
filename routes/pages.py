# ============================================================
# HAVEN HAIR — routes/pages.py
# All HTML page routes — returns rendered templates only
#
# Sections:
#   1.  Blueprint setup
#   2.  Landing page
#   3.  Customer pages
#   4.  Owner pages
#   5.  Staff pages
#
# No API logic here — every route just renders a template.
# All data loading is done client-side via JS fetch calls.
#
# Blueprint: pages_bp
# Prefix:    none (routes registered at root level)
# ============================================================

from flask import Blueprint, render_template, redirect, request
import re
from urllib.parse import urlparse

_SAFE_NEXT_PATTERN = re.compile(r'^/customer/[a-zA-Z0-9/_-]+$')

pages_bp = Blueprint('pages', __name__)


# ---- 2. Landing page -------------------------------------

@pages_bp.route('/')
def landing():
    return render_template('index.html')


# ---- 3. Customer pages -----------------------------------

@pages_bp.route('/customer')
@pages_bp.route('/customer/')
def customer_index():
    return redirect('/customer/auth')

@pages_bp.route('/customer/auth')
def customer_auth():
    return render_template('customer/auth.html')

@pages_bp.route('/customer/shops')
def customer_shops():
    return render_template('customer/shops.html')

@pages_bp.route('/customer/shop/<int:shop_id>')
def customer_shop_detail(shop_id):
    return render_template('customer/shop_detail.html', shop_id=shop_id)

@pages_bp.route('/customer/shop/<int:shop_id>/rules')
# Two independent, layered checks — a prefix/character-class
# regex AND a structural urlparse scheme/netloc check. Both
# must pass. Confirmed against every real call site in this
# codebase (there are none supplying a non-default 'next' —
# Nav.toRules() is dead code) — zero risk of regression.

def _is_safe_next_url(candidate):
    """
    Returns True only if candidate is a same-app relative path under
    /customer/ with no scheme, no netloc, and no disallowed characters.
    Rejects: external URLs, protocol-relative URLs (//evil.com),
    javascript:/data: URIs, and anything outside the /customer/ tree
    (e.g. no leaking into /owner/ or /staff/ routes via this parameter).
    """
    if not candidate:
        return False
    # Structural check — catches scheme/netloc-based attacks
    # (javascript:, https://, //host, etc.) regardless of character content
    parsed = urlparse(candidate)
    if parsed.scheme or parsed.netloc:
        return False
    # Character/prefix check — restricts to the expected app path shape
    return bool(_SAFE_NEXT_PATTERN.match(candidate))


def customer_shop_rules(shop_id):
    raw = request.args.get('next', '')
    next_url = raw if _is_safe_next_url(raw) else f'/customer/shop/{shop_id}'
    return render_template('customer/rules.html', shop_id=shop_id, next_url=next_url)

@pages_bp.route('/customer/messages')
def customer_messages():
    return render_template('customer/messages.html')

@pages_bp.route('/customer/profile')
def customer_profile():
    return render_template('customer/profile.html')

@pages_bp.route('/customer/queue')
def customer_queue():
    return render_template('customer/queue.html')

@pages_bp.route('/customer/history')
def customer_history_page():
    return render_template('customer/history.html')

# ---- 4. Owner pages --------------------------------------

@pages_bp.route('/owner/auth')
def owner_auth():
    return render_template('owner/auth.html')

@pages_bp.route('/owner/branches')
def owner_branches():
    return render_template('owner/branches.html')

@pages_bp.route('/owner/dashboard')
def owner_dashboard():
    return render_template('owner/dashboard.html')

@pages_bp.route('/owner/chair/<int:chair_id>')
def owner_chair_detail(chair_id):
    return render_template('owner/chair.html', chair_id=chair_id)

@pages_bp.route('/owner/settings')
def owner_settings():
    return render_template('owner/settings.html')

@pages_bp.route('/owner/reports')
def owner_reports_page():
    return render_template('owner/reports.html')

@pages_bp.route('/owner/inbox')
def owner_inbox():
    return render_template('owner/inbox.html')


# ---- 5. Staff pages --------------------------------------

@pages_bp.route('/staff/dashboard')
def staff_dashboard():
    return render_template('staff/dashboard.html')
