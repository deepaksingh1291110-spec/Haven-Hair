# ============================================================
# HAVEN HAIR — routes/customer.py
# Customer Profile, History & Account APIs
#
# Fixes implemented:
#   Fix 7  — GET /customer/active-booking returns current active
#             queue entry so JS can offer to cancel it before
#             joining a different shop
#   Fix 8  — GET /customer/behaviour includes credit_points +
#             is_banned in response
#
# APIs:
#   GET    /hh/customer/profile         → get customer profile
#   PATCH  /hh/customer/profile         → update name
#   GET    /customer/history            → past visits (last 5)
#   DELETE /customer/account            → delete account + data
#   GET    /customer/behaviour          → get behaviour score
#   GET    /customer/active-booking     → Fix 7: current active queue entry
# ============================================================

from flask import Blueprint, request, jsonify
from db    import query, mutate, row_to_dict, rows_to_list

customer_bp = Blueprint('customer', __name__)


# ---- 2. Profile ------------------------------------------

@customer_bp.route('/hh/customer/profile')
def customer_profile_api():
    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify({'error': 'phone is required'}), 400
    row = query('SELECT * FROM customers WHERE phone=?', (phone,), one=True)
    if not row:
        return jsonify({'error': 'Customer not found'}), 404
    return jsonify(row_to_dict(row))


@customer_bp.route('/hh/customer/profile', methods=['PATCH'])
def customer_profile_update():
    body  = request.get_json()
    phone = (body.get('phone') or '').strip()
    name  = (body.get('name')  or '').strip()
    if not phone:
        return jsonify({'error': 'phone is required'}), 400
    if not name:
        return jsonify({'error': 'Name cannot be empty'}), 400
    mutate('UPDATE customers SET name=? WHERE phone=?', (name, phone))
    return jsonify({'ok': True})


# ---- 3. Visit history ------------------------------------

@customer_bp.route('/hh/customer/history')
def customer_history():
    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify([])
    rows = rows_to_list(query(
        '''SELECT
               q.id,
               q.service,
               q.status,
               q.created_at,
               s.name        AS shop_name,
               s.id          AS shop_id,
               sv.price      AS price,
               sv.icon       AS service_icon
           FROM queue q
           JOIN shops s ON s.id = q.shop_id
           LEFT JOIN services sv
               ON sv.shop_id = q.shop_id AND sv.service = q.service
           WHERE q.phone=? AND q.status IN ('done','cancelled','skipped')
           ORDER BY q.created_at DESC
           LIMIT 5''',
        (phone,)
    ))
    return jsonify(rows)


# ---- 4. Account ------------------------------------------

@customer_bp.route('/customer/account', methods=['DELETE'])
def customer_delete():
    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify({'error': 'phone is required'}), 400
    mutate("UPDATE queue SET phone='', name='[Deleted]' WHERE phone=?", (phone,))
    mutate("UPDATE reviews SET phone='', customer_name='[Deleted]' WHERE phone=?", (phone,))
    mutate('DELETE FROM messages WHERE customer_phone=?', (phone,))
    mutate('DELETE FROM conversations WHERE customer_phone=?', (phone,))
    mutate('DELETE FROM customers WHERE phone=?', (phone,))
    return jsonify({'ok': True})


# ---- 5. Behaviour score ----------------------------------

@customer_bp.route('/customer/behaviour')
def customer_behaviour():
    """
    Fix 8: now also returns credit_points and is_banned.
    """
    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify({'score': 100, 'credit_points': 0, 'is_banned': 0})

    row = query(
        'SELECT behaviour_score, credit_points, is_banned FROM customers WHERE phone=?',
        (phone,), one=True
    )
    if not row:
        return jsonify({'score': 100, 'credit_points': 0, 'is_banned': 0})

    score   = row['behaviour_score']
    credits = row['credit_points']
    banned  = bool(row['is_banned'])

    return jsonify({
        'score':         score,
        'credit_points': credits,
        'is_banned':     banned,
        'status':        _score_label(score, banned, credits),
        'blocked':       (score < 20 and credits == 0) or banned,
        'in_credit_mode': score == 0 and credits > 0,
    })


def _score_label(score, banned, credits):
    if banned:
        return 'Permanently suspended — contact the shop directly'
    if score == 0 and credits > 0:
        return f'Final warning — {credits} credit points remaining before permanent ban'
    if score >= 80:
        return 'Good standing'
    if score >= 50:
        return 'Warning — avoid no-shows'
    if score >= 20:
        return 'At risk — one more no-show may block you'
    return 'Blocked — contact the shop directly'


# ---- 6. Active booking (Fix 7) ---------------------------

@customer_bp.route('/customer/active-booking')
def customer_active_booking():
    """
    Fix 7: Returns the customer's current active queue entry (if any).
    Used by shop_detail.js to offer cancellation before joining a different shop.

    Response:
      { entry_id, shop_id, shop_name }  — if active entry exists
      { entry_id: null }                — if no active entry
    """
    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify({'entry_id': None})

    row = query(
        """SELECT q.id, q.shop_id, q.token, s.name as shop_name
           FROM queue q
           JOIN shops s ON s.id = q.shop_id
           WHERE q.phone=? AND q.status IN ('waiting','active')
           LIMIT 1""",
        (phone,), one=True
    )

    if not row:
        return jsonify({'entry_id': None})

    return jsonify({
        'entry_id':  row['id'],
        'shop_id':   row['shop_id'],
        'shop_name': row['shop_name'],
        'token':     row['token'],
    })




