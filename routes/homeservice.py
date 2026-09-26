# ============================================================
# HAVEN HAIR — routes/homeservice.py
# Home Service Request APIs
#
# Fixes implemented:
#   Fix 3  — set-arrival endpoint; arrival_time returned after accept
#   Fix 4  — lat/lon stored; tiered cancel penalties
#   Fix 5  — GET /home-service/new-count for staff polling
#   Fix 6  — customer phone masked in list until accepted
#   Fix 9  — shop HS rules returned in check-visit response
#
# APIs:
#   POST   /home-service/request          → customer books home service
#   GET    /home-service/requests         → owner/staff: list pending+accepted
#   PATCH  /home-service/<id>/accept      → accept + share phones
#   PATCH  /home-service/<id>/reject      → reject
#   PATCH  /home-service/<id>/set-arrival → barber sets ETA
#   PATCH  /home-service/<id>/cancel      → customer cancels (tiered penalty)
#   GET    /home-service/my-requests      → customer: check their requests
#   GET    /home-service/check-visit      → eligibility + HS rules
#   GET    /home-service/new-count        → staff: count new requests since id
# ===================================================================================
import secrets
from datetime import datetime
from flask import Blueprint, request, jsonify
from db    import query, mutate, mask_phone, apply_penalty

homeservice_bp = Blueprint('homeservice', __name__)


# ---- Helper: tiered cancel penalty -----------------------

def _hs_cancel_penalty(elapsed_secs):
    """
    Cancel penalty based on seconds elapsed since booking was created.
      < 60s  (< 1 min)  : 0   — grace period, no penalty
      < 600s (< 10 min) : 50  — hardest: waited then cancelled
      < 1800s (< 30 min): 30
      < 3600s (< 60 min): 15
      >= 3600s (> 60 min): 5  — patient, but still late
    """
    if elapsed_secs < 60:
        return 0
    if elapsed_secs < 600:
        return 50
    if elapsed_secs < 1800:
        return 30
    if elapsed_secs < 3600:
        return 15
    return 5


# ----------------------------------------------------------

@homeservice_bp.route('/home-service/request', methods=['POST'])
def request_home_service():
    body           = request.get_json() or {}
    shop_id        = body.get('shop_id')
    customer_name  = (body.get('name')    or '').strip()
    customer_phone = (body.get('phone')   or '').strip()
    address        = (body.get('address') or '').strip()
    service        = (body.get('service') or '').strip()
    note           = (body.get('note')    or '').strip()
    lat            = body.get('lat')
    lon            = body.get('lon')

    if not shop_id or not customer_name or not customer_phone or not address:
        return jsonify({'error': 'name, phone and address are required'}), 400

    # Require at least one completed visit to this shop
    visit = query(
        "SELECT 1 FROM queue WHERE shop_id=? AND phone=? AND status='done'",
        (shop_id, customer_phone), one=True
    )
    if not visit:
        return jsonify({
            'error': 'You need at least one prior visit to this shop to book home service'
        }), 403

    # Block duplicate pending requests
    existing = query(
        """SELECT 1 FROM home_service_requests
           WHERE shop_id=? AND customer_phone=? AND status IN ('pending','accepted')""",
        (shop_id, customer_phone), one=True
    )
    if existing:
        return jsonify({'error': 'You already have an active request for this shop'}), 400

    entry_id = mutate(
        """INSERT INTO home_service_requests
           (shop_id, customer_name, customer_phone, address, lat, lon, service, note)
           VALUES (?,?,?,?,?,?,?,?)""",
        (shop_id, customer_name, customer_phone, address, lat, lon, service, note)
    )
    return jsonify({'ok': True, 'id': entry_id})

# otp stripped before response is built.
# Owner/staff panel never receives it.
# Only the customer endpoint (/home-service/my-requests)
# sends OTP — and only when status='accepted'.

@homeservice_bp.route('/home-service/requests')
def list_home_service_requests():
    """
    Owner / staff view of HS requests.
    Fix 6: customer phone is masked while status is 'pending'.
    Fix 5: supports ?since=<id> to get only new requests.
    Fix 20: OTP stripped — must never appear in owner/staff response.
    """
    shop_id  = request.args.get('shop_id', type=int)
    since_id = request.args.get('since',   type=int, default=0)

    if not shop_id:
        return jsonify([])

    rows = query(
        """SELECT * FROM home_service_requests
           WHERE shop_id=? AND status IN ('pending','accepted')
             AND id > ?
           ORDER BY created_at DESC""",
        (shop_id, since_id)
    )

    result = []
    for r in (rows or []):
        d = dict(r)

        # ✅ Strip OTP — owner/staff must never see it.
        # The entire point of OTP is physical presence verification.
        # If staff can read it from the API, verification is meaningless.
        d.pop('otp', None)

        # Fix 6: mask customer phone on pending requests
        if d['status'] == 'pending':
            d['customer_phone'] = mask_phone(d['customer_phone'])

        result.append(d)

    return jsonify(result)

@homeservice_bp.route('/home-service/new-count')
def hs_new_count():
    """
    Fix 5: Staff polls this to check if new HS requests arrived
    since the last known id.
    Returns { count, latest_id }
    """
    shop_id  = request.args.get('shop_id', type=int)
    since_id = request.args.get('since',   type=int, default=0)

    if not shop_id:
        return jsonify({'count': 0, 'latest_id': since_id})

    row = query(
        """SELECT COUNT(*) as c, MAX(id) as max_id
           FROM home_service_requests
           WHERE shop_id=? AND status='pending' AND id > ?""",
        (shop_id, since_id), one=True
    )
    return jsonify({
        'count':     row['c']      if row else 0,
        'latest_id': row['max_id'] if row and row['max_id'] else since_id,
    })


# homeservice.py — accept_home_service()
# Reward belongs ONLY in complete_home_service (OTP-verified completion).
@homeservice_bp.route('/home-service/<int:req_id>/accept', methods=['PATCH'])
def accept_home_service(req_id):
    body     = request.get_json() or {}
    chair_id = body.get('chair_id')

    req = query('SELECT * FROM home_service_requests WHERE id=?', (req_id,), one=True)
    if not req:
        return jsonify({'error': 'Request not found'}), 404

    staff_phone = ''
    barber_name = ''
    if chair_id:
        chair = query('SELECT phone, barber_name FROM chairs WHERE id=?', (chair_id,), one=True)
        if chair and chair['phone']:
            staff_phone = chair['phone']
            barber_name = chair['barber_name']

    mutate(
        """UPDATE home_service_requests
           SET status='accepted', staff_phone=?, accepted_by_chair_id=?
           WHERE id=?""",
        (staff_phone, chair_id, req_id)
    )

    otp = str(secrets.randbelow(9000) + 1000)
    mutate(
        "UPDATE home_service_requests SET otp=? WHERE id=?",
        (otp, req_id)
    )

    # Reward is granted only in complete_home_service()
    # after the customer presents the OTP at the door.

    return jsonify({
        'ok':             True,
        'staff_phone':    staff_phone,
        'barber_name':    barber_name,
        'customer_phone': req['customer_phone'],
        'customer_name':  req['customer_name'],
        'address':        req['address'],
        'lat':            req['lat'],
        'lon':            req['lon'],
        'otp':            otp,
    })


@homeservice_bp.route('/home-service/<int:req_id>/set-arrival', methods=['PATCH'])
def set_arrival_time(req_id):
    """
    Fix 3: Barber sets their estimated arrival time.
    Stored as a plain text string (e.g. '3:30 PM', '~20 minutes').
    """
    body         = request.get_json() or {}
    arrival_time = (body.get('arrival_time') or '').strip()

    req = query('SELECT id FROM home_service_requests WHERE id=?', (req_id,), one=True)
    if not req:
        return jsonify({'error': 'Request not found'}), 404

    mutate(
        "UPDATE home_service_requests SET arrival_time=? WHERE id=?",
        (arrival_time, req_id)
    )
    return jsonify({'ok': True, 'arrival_time': arrival_time})


@homeservice_bp.route('/home-service/<int:req_id>/reject', methods=['PATCH'])
def reject_home_service(req_id):
    mutate("UPDATE home_service_requests SET status='rejected' WHERE id=?", (req_id,))
    return jsonify({'ok': True})

# LEFT JOIN chairs brings barber_name into every row.
# LEFT JOIN (not INNER) preserves pending requests
# where accepted_by_chair_id is still NULL.

@homeservice_bp.route('/home-service/my-requests')
def my_home_service_requests():
    phone   = request.args.get('phone', '').strip()
    shop_id = request.args.get('shop_id', type=int)
    if not phone:
        return jsonify([])

    if shop_id:
        rows = query(
            """SELECT hsr.*, c.barber_name
               FROM home_service_requests hsr
               LEFT JOIN chairs c ON c.id = hsr.accepted_by_chair_id
               WHERE hsr.customer_phone=? AND hsr.shop_id=?
               ORDER BY hsr.created_at DESC LIMIT 3""",
            (phone, shop_id)
        )
    else:
        rows = query(
            """SELECT hsr.*, c.barber_name
               FROM home_service_requests hsr
               LEFT JOIN chairs c ON c.id = hsr.accepted_by_chair_id
               WHERE hsr.customer_phone=?
               ORDER BY hsr.created_at DESC LIMIT 3""",
            (phone,)
        )

    result = []
    for r in (rows or []):
        d = dict(r)
        if d['status'] == 'accepted':
            pass  # otp already in dict
        else:
            d['otp'] = None

        if d['status'] != 'accepted' and d.get('staff_phone'):
            d['staff_phone'] = mask_phone(d['staff_phone'])
        result.append(d)

    return jsonify(result)

@homeservice_bp.route('/home-service/<int:req_id>/cancel', methods=['PATCH'])
def cancel_home_service_request(req_id):
    """
    Fix 4: Tiered cancel penalty based on elapsed time since booking.
    < 1 min  → 0 pts   (grace period)
    1-10 min → -50 pts (hardest)
    10-30    → -30 pts
    30-60    → -15 pts
    > 60 min → -5 pts
    """
    body  = request.get_json() or {}
    phone = (body.get('phone') or '').strip()

    req = query(
        'SELECT * FROM home_service_requests WHERE id=? AND customer_phone=?',
        (req_id, phone), one=True
    )
    if not req:
        return jsonify({'error': 'Request not found'}), 404
    if req['status'] not in ('pending', 'accepted'):
        return jsonify({'error': 'Request cannot be cancelled'}), 400

    # Calculate elapsed time
    try:
        raw     = req['created_at']
        fmt     = '%Y-%m-%d %H:%M:%S.%f' if '.' in raw else '%Y-%m-%d %H:%M:%S'
        created = datetime.strptime(raw, fmt)
        elapsed = (datetime.utcnow() - created).total_seconds()
    except Exception:
        elapsed = 0

    penalty = _hs_cancel_penalty(elapsed)

    mutate("UPDATE home_service_requests SET status='cancelled' WHERE id=?", (req_id,))

    result_msg = None
    if penalty > 0 and phone:
        res = apply_penalty(phone, penalty)
        if res.get('banned'):
            result_msg = 'Account permanently banned due to repeated cancellations'
        elif res.get('warned'):
            result_msg = f'Warning: {res.get("credits", 0)} credit points remaining'

    return jsonify({
        'ok':        True,
        'penalty':   penalty,
        'penalised': penalty > 0,
        'message':   result_msg,
    })


@homeservice_bp.route('/home-service/check-visit')
def check_prior_visit():
    """
    Check if customer is eligible (has a completed visit).
    Fix 9: Also returns shop's home_service_rules_text so the
    customer app can show HS rules before they book.
    """
    phone   = request.args.get('phone', '').strip()
    shop_id = request.args.get('shop_id', type=int)
    if not phone or not shop_id:
        return jsonify({'eligible': False})

    visit = query(
        "SELECT 1 FROM queue WHERE shop_id=? AND phone=? AND status='done'",
        (shop_id, phone), one=True
    )

    shop = query(
        'SELECT home_service_rules_text FROM shops WHERE id=?',
        (shop_id,), one=True
    )
    hs_rules = shop['home_service_rules_text'] if shop else None

    return jsonify({
        'eligible': bool(visit),
        'hs_rules': hs_rules,
    })


@homeservice_bp.route('/home-service/<int:req_id>/update-location', methods=['PATCH'])
def update_hs_location(req_id):
    body = request.get_json() or {}
    lat  = body.get('lat')
    lon  = body.get('lon')

    if not lat or not lon:
        return jsonify({'error': 'lat and lon required'}), 400

    req = query('SELECT id FROM home_service_requests WHERE id=?', (req_id,), one=True)
    if not req:
        return jsonify({'error': 'Request not found'}), 404

    mutate(
        'UPDATE home_service_requests SET lat=?, lon=? WHERE id=?',
        (lat, lon, req_id)
    )
    return jsonify({'ok': True})


@homeservice_bp.route('/home-service/<int:req_id>/complete', methods=['PATCH'])
def complete_home_service(req_id):
    body = request.get_json() or {}
    otp  = (body.get('otp') or '').strip()

    req = query('SELECT * FROM home_service_requests WHERE id=?', (req_id,), one=True)
    if not req:
        return jsonify({'error': 'Request not found'}), 404
    if req['status'] != 'accepted':
        return jsonify({'error': 'Request is not active'}), 400
    if not req['otp'] or req['otp'] != otp:
        return jsonify({'error': 'Invalid OTP'}), 400

    mutate(
        "UPDATE home_service_requests SET status='completed' WHERE id=?",
        (req_id,)
    )

    # Reward customer
    if req['customer_phone']:
        from routes.rewards import apply_reward
        apply_reward(req['customer_phone'], 5, 'home service completed')

    return jsonify({'ok': True})
