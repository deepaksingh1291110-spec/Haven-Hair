# ============================================================
# HAVEN HAIR — routes/shops.py
# Shops, Services, Chairs, Maps, Owner Branches APIs
#
# Fixes implemented:
#   Fix 2  — GET /shops/:id/chairs for Manage Staff panel;
#             home_service_rules_text in rules endpoints;
#             PATCH /chairs/:id for editing barber info
#
# APIs:
#   GET    /maps/reverse                    → city from lat/lon
#   GET    /maps/geocode                    → lat/lon from address
#   GET    /maps/shops                      → all shops with distance
#   GET    /shops/:id                       → single shop detail
#   PATCH  /shops/:id                       → update shop info
#   PATCH  /shops/:id/status               → set open/busy/closed
#   GET    /shops/:id/rules                → shop rules text
#   PATCH  /shops/:id/rules               → update rules + HS rules
#   GET    /shops/:id/chairs              → list chairs (Fix 2)
#   PATCH  /chairs/:id                   → edit barber info (Fix 2)
#   GET    /shops/:id/services             → list services
#   POST   /shops/:id/services             → add service
#   PATCH  /services/:id                   → update service
#   DELETE /services/:id                   → delete service
#   GET    /chairs/:id                     → chair + active entry
#   PATCH  /chairs/:id/status             → open / closed
#   POST   /owner/chairs                   → add barber to shop
#   DELETE /owner/chairs/:id              → deactivate barber
#   GET    /hh/owner/branches             → owner's shops list
#   POST   /hh/owner/branches             → create new shop
#   DELETE /hh/owner/branches/:id         → delete branch
# ============================================================

from flask import Blueprint, request, jsonify
from db    import query, mutate, row_to_dict, rows_to_list, haversine, hash_pw

shops_bp = Blueprint('shops', __name__)


# ---- 2. Maps API -----------------------------------------
# Single SQL JOIN embeds waiting + seated counts
# Frontend needs zero follow-up calls

@shops_bp.route('/maps/shops')
def maps_shops():
    lat = request.args.get('lat',  type=float)
    lon = request.args.get('lon',  type=float)

    # ✅ Single query — queue counts embedded via LEFT JOIN
    # LEFT JOIN preserves shops with no queue entries (waiting=0)
    # date(q.created_at) = date('now') filters to today only
    # COUNT(DISTINCT CASE WHEN...) is standard conditional aggregation
    shops = rows_to_list(query('''
        SELECT s.*,
               COUNT(DISTINCT CASE WHEN q.status = 'waiting'
                    THEN q.id END) AS waiting,
               COUNT(DISTINCT CASE WHEN q.status = 'active'
                    THEN q.id END) AS has_seated
        FROM shops s
        LEFT JOIN queue q ON q.shop_id = s.id
                         AND date(q.created_at) = date('now')
        GROUP BY s.id
    '''))

    for shop in shops:
        if lat and lon and shop['lat'] and shop['lon']:
            shop['distance_km'] = round(
                haversine(lat, lon, shop['lat'], shop['lon']), 2
            )
        else:
            shop['distance_km'] = None

    if lat and lon:
        shops.sort(key=lambda s: s['distance_km'] or 9999)
    else:
        shops.sort(key=lambda s: -(s['reputation_score'] or 0))

    return jsonify(shops)

# ---- 3. Shops API ----------------------------------------

@shops_bp.route('/shops/<int:shop_id>')
def shop_detail(shop_id):
    shop = query('SELECT * FROM shops WHERE id=?', (shop_id,), one=True)
    if not shop:
        return jsonify({'error': 'Shop not found'}), 404
    result = row_to_dict(shop)
    lat = request.args.get('lat', type=float)
    lon = request.args.get('lon', type=float)
    if lat and lon and shop['lat'] and shop['lon']:
        result['distance_km'] = round(haversine(lat, lon, shop['lat'], shop['lon']), 2)
    return jsonify(result)


@shops_bp.route('/shops/<int:shop_id>', methods=['PATCH'])
def update_shop(shop_id):
    body    = request.get_json()
    allowed = ['name', 'address', 'home_service', 'lat', 'lon', 'owner_phone']
    fields, values = [], []
    for key in allowed:
        if key in body:
            fields.append(f'{key}=?')
            values.append(body[key])
    if not fields:
        return jsonify({'error': 'No valid fields to update'}), 400
    values.append(shop_id)
    mutate(f"UPDATE shops SET {', '.join(fields)} WHERE id=?", values)
    return jsonify({'ok': True})


@shops_bp.route('/shops/<int:shop_id>/status', methods=['PATCH'])
def shop_status(shop_id):
    status = (request.get_json() or {}).get('status', 'open')
    if status not in ('open', 'busy', 'closed'):
        return jsonify({'error': 'status must be open, busy or closed'}), 400
    mutate('UPDATE shops SET status=? WHERE id=?', (status, shop_id))
    return jsonify({'ok': True})


@shops_bp.route('/shops/<int:shop_id>/rules')
def shop_rules(shop_id):
    """
    Fix 2: also returns home_service_rules_text for the HS rules section.
    """
    shop = query(
        'SELECT name, rules_text, rules_version, home_service_rules_text FROM shops WHERE id=?',
        (shop_id,), one=True
    )
    if not shop:
        return jsonify({'error': 'Shop not found'}), 404
    return jsonify(row_to_dict(shop))


@shops_bp.route('/shops/<int:shop_id>/rules', methods=['PATCH'])
def update_shop_rules(shop_id):
    """
    Fix 2: accepts both rules_text and home_service_rules_text.
    Bumps rules_version only when rules_text changes.
    """
    body    = request.get_json() or {}
    fields  = []
    values  = []

    if 'rules_text' in body:
        fields.append('rules_text=?')
        fields.append('rules_version=rules_version+1')
        values.append((body.get('rules_text') or '').strip())

    if 'home_service_rules_text' in body:
        fields.append('home_service_rules_text=?')
        values.append((body.get('home_service_rules_text') or '').strip())

    if not fields:
        return jsonify({'error': 'No valid fields to update'}), 400

    values.append(shop_id)
    mutate(f"UPDATE shops SET {', '.join(fields)} WHERE id=?", values)
    return jsonify({'ok': True})


# ---- Fix 2: Chairs list endpoint -------------------------

@shops_bp.route('/shops/<int:shop_id>/chairs')
def shop_chairs(shop_id):
    """
    Fix 2: List all active chairs for a shop — used by the
    Manage Staff / Chairs section in settings.
    """
    chairs = rows_to_list(query(
        '''SELECT id, barber_name, phone, home_service, status
           FROM chairs
           WHERE shop_id=? AND is_active=1
           ORDER BY id ASC''',
        (shop_id,)
    ))
    return jsonify(chairs)


@shops_bp.route('/chairs/<int:chair_id>', methods=['PATCH'])
def update_chair(chair_id):
    """
    Fix 2: Edit a barber's name, phone, home_service flag,
    or reset their password.
    """
    body     = request.get_json() or {}
    allowed  = ['barber_name', 'phone', 'home_service']
    fields   = []
    values   = []

    for key in allowed:
        if key in body:
            fields.append(f'{key}=?')
            values.append(body[key])

    if 'password' in body and body['password']:
        if len(body['password']) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        fields.append('password_hash=?')
        values.append(hash_pw(body['password']))

    if not fields:
        return jsonify({'error': 'No valid fields to update'}), 400

    values.append(chair_id)
    mutate(f"UPDATE chairs SET {', '.join(fields)} WHERE id=?", values)
    return jsonify({'ok': True})


# ---- 4. Services API -------------------------------------

@shops_bp.route('/shops/<int:shop_id>/services')
def shop_services(shop_id):
    services = rows_to_list(
        query('SELECT * FROM services WHERE shop_id=? ORDER BY id ASC', (shop_id,))
    )
    return jsonify(services)


@shops_bp.route('/shops/<int:shop_id>/services', methods=['POST'])
def add_service(shop_id):
    body          = request.get_json()
    service       = (body.get('service') or '').strip()
    icon          = (body.get('icon')    or '✂️').strip()
    price         = body.get('price')
    duration_mins = int(body.get('duration_mins', 20))
    if not service:
        return jsonify({'error': 'Service name is required'}), 400
    if duration_mins < 5:
        return jsonify({'error': 'Duration must be at least 5 minutes'}), 400
    new_id = mutate(
        'INSERT INTO services (shop_id,service,icon,price,duration_mins) VALUES (?,?,?,?,?)',
        (shop_id, service, icon, price, duration_mins)
    )
    return jsonify({'id': new_id, 'ok': True})


@shops_bp.route('/services/<int:service_id>', methods=['PATCH'])
def update_service(service_id):
    body          = request.get_json()
    service       = (body.get('service') or '').strip()
    icon          = (body.get('icon')    or '✂️').strip()
    price         = body.get('price')
    duration_mins = int(body.get('duration_mins', 20))
    if not service:
        return jsonify({'error': 'Service name is required'}), 400
    mutate(
        'UPDATE services SET service=?, icon=?, price=?, duration_mins=? WHERE id=?',
        (service, icon, price, duration_mins, service_id)
    )
    return jsonify({'ok': True})


@shops_bp.route('/services/<int:service_id>', methods=['DELETE'])
def delete_service(service_id):
    mutate('DELETE FROM services WHERE id=?', (service_id,))
    return jsonify({'ok': True})


# ---- 5. Chairs API ---------------------------------------

@shops_bp.route('/chairs/<int:chair_id>')
def get_chair(chair_id):
    chair = query(
        """SELECT id, shop_id, barber_name, phone,
                  home_service, status, is_active
           FROM chairs WHERE id=?""",
        (chair_id,), one=True
    )
    if not chair:
        return jsonify({'error': 'Chair not found'}), 404
    result = row_to_dict(chair)
    active = query(
        "SELECT * FROM queue WHERE chair_id=? AND status='active' LIMIT 1",
        (chair_id,), one=True
    )
    result['active_entry'] = row_to_dict(active)
    return jsonify(result)

@shops_bp.route('/chairs/<int:chair_id>/status', methods=['PATCH'])
def chair_status(chair_id):
    status = (request.get_json() or {}).get('status', 'open')
    if status not in ('open', 'closed', 'break'):
        return jsonify({'error': 'status must be open, closed or break'}), 400
    mutate('UPDATE chairs SET status=? WHERE id=?', (status, chair_id))
    return jsonify({'ok': True})


@shops_bp.route('/owner/chairs', methods=['POST'])
def owner_add_chair():
    body     = request.get_json()
    shop_id  = body.get('shop_id')
    name     = (body.get('barber_name') or '').strip()
    phone    = (body.get('phone')       or '').strip()
    password = (body.get('password')    or '')
    if not shop_id or not name or not phone or not password:
        return jsonify({'error': 'shop_id, barber_name, phone and password required'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if query('SELECT 1 FROM chairs WHERE phone=?', (phone,), one=True):
        return jsonify({'error': 'Phone already registered to a chair'}), 400
    new_id = mutate(
        '''INSERT INTO chairs
           (shop_id,barber_name,phone,password_hash,home_service)
           VALUES (?,?,?,?,?)''',
        (shop_id, name, phone, hash_pw(password), body.get('home_service', 0))
    )
    return jsonify({'id': new_id, 'ok': True})


@shops_bp.route('/owner/chairs/<int:chair_id>', methods=['DELETE'])
def delete_chair_route(chair_id):
    """Deactivate (soft-delete) a chair / staff member."""
    mutate('UPDATE chairs SET is_active=0 WHERE id=?', (chair_id,))
    return jsonify({'ok': True})


# ---- 6. Owner Branches API -------------------------------

@shops_bp.route('/hh/owner/branches')
def api_owner_branches():
    owner_id = request.args.get('owner_id', type=int)
    shop_id  = request.args.get('shop_id',  type=int)

    # Guard — require at least one param
    if not owner_id and not shop_id:
        return jsonify({'error': 'owner_id or shop_id is required'}), 400

    if shop_id:
        rows = query('''
            SELECT s.*,
                   COUNT(DISTINCT c.id) as chair_count,
                   COUNT(DISTINCT CASE WHEN q.status='waiting' THEN q.id END) as waiting
            FROM shops s
            LEFT JOIN chairs c ON c.shop_id = s.id AND c.is_active = 1
            LEFT JOIN queue  q ON q.shop_id = s.id AND q.status='waiting'
                                  AND date(q.created_at) = date('now')
            WHERE s.id = ?
            GROUP BY s.id
        ''', (shop_id,))
    else:
        rows = query('''
            SELECT s.*,
                   COUNT(DISTINCT c.id) as chair_count,
                   COUNT(DISTINCT CASE WHEN q.status='waiting' THEN q.id END) as waiting
            FROM shops s
            LEFT JOIN chairs c ON c.shop_id = s.id AND c.is_active = 1
            LEFT JOIN queue  q ON q.shop_id = s.id AND q.status='waiting'
                                  AND date(q.created_at) = date('now')
            WHERE s.owner_id = ?
            GROUP BY s.id
            ORDER BY s.id ASC
        ''', (owner_id,))
    return jsonify(rows_to_list(rows))


@shops_bp.route('/hh/owner/branches/<int:shop_id>', methods=['DELETE'])
def delete_branch(shop_id):
    # Delete in correct order to avoid any dependency issues
    mutate('DELETE FROM messages               WHERE shop_id=?', (shop_id,))
    mutate('DELETE FROM conversations          WHERE shop_id=?', (shop_id,))
    mutate('DELETE FROM reviews               WHERE shop_id=?', (shop_id,))
    mutate('DELETE FROM home_service_requests WHERE shop_id=?', (shop_id,))
    mutate('DELETE FROM queue                 WHERE shop_id=?', (shop_id,))
    mutate('DELETE FROM service_averages      WHERE shop_id=?', (shop_id,))
    mutate('DELETE FROM services              WHERE shop_id=?', (shop_id,))
    mutate('DELETE FROM chairs                WHERE shop_id=?', (shop_id,))
    mutate('DELETE FROM shops                 WHERE id=?',      (shop_id,))
    return jsonify({'ok': True})

@shops_bp.route('/hh/owner/branches', methods=['POST'])
def api_owner_branches_create():
    body     = request.get_json()
    owner_id = body.get('owner_id')
    name     = (body.get('name')    or '').strip()
    address  = (body.get('address') or '').strip()
    if not owner_id or not name:
        return jsonify({'error': 'owner_id and name are required'}), 400
    new_id = mutate(
        'INSERT INTO shops (owner_id,name,address,status) VALUES (?,?,?,?)',
        (owner_id, name, address, 'open')
    )
    return jsonify({'id': new_id, 'ok': True})
