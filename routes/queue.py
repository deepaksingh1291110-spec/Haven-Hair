# ============================================================
# HAVEN HAIR — routes/queue.py
# Queue management APIs
#
# Fixes implemented:
#   Fix 1  — queue_versions dict; queue_branch returns
#             {"changed":false} when version unchanged
#   Fix 7  — one active booking per customer;
#             returns 409 with other_shop info so JS can offer cancel
#   Fix 8  — ban check; tiered penalties via apply_penalty()
#
# APIs:
#   GET    /queue/:shop_id             → full queue for a shop
#   GET    /queue/branch/:shop_id      → grouped by chairs (?v= for polling)
#   GET    /queue/status/:entry_id     → single entry status
#   POST   /queue/join                 → add customer to queue
#   DELETE /queue/cancel/:entry_id     → cancel an entry
#   DELETE /queue/:shop_id/clear       → clear all waiting
#   PATCH  /queue/chair/:id/sit        → next customer sits
#   PATCH  /queue/chair/:id/done       → haircut done
#   PATCH  /queue/chair/:id/skip       → skip next waiting entry
#   PATCH  /queue/:entry_id/strike     → add a strike
#   PATCH  /queue/:entry_id/move       → move to another chair
#   PATCH  /queue/swap                 → swap two entries
# ============================================================

from datetime import datetime
from flask   import Blueprint, request, jsonify
from db      import query, mutate, rows_to_list, row_to_dict, next_token, calc_wait, apply_penalty
from predictions import update_done_at, get_wait, _get_avg, _elapsed

queue_bp = Blueprint('queue', __name__)


# ---- Fix 1: version tracking -----------------------------
#
# Each shop has a version counter that bumps on any queue
# mutation. dashboard_queue.js sends its cached version; if
# unchanged the server returns {"changed": false} so the
# client skips re-rendering (no flicker, less data).

_queue_versions = {}   # { shop_id: int }


def _bump(shop_id):
    """Increment the version counter for a shop's queue."""
    _queue_versions[shop_id] = _queue_versions.get(shop_id, 0) + 1


def _version(shop_id):
    return _queue_versions.get(shop_id, 0)


# ---- 2. Queue status -------------------------------------

@queue_bp.route('/queue/<int:shop_id>')
def queue_status(shop_id):
    entries = rows_to_list(query(
        '''SELECT q.*, c.barber_name
           FROM queue q
           LEFT JOIN chairs c ON q.chair_id = c.id
           WHERE q.shop_id=? AND q.status IN ('waiting','active')
           ORDER BY q.id ASC''',
        (shop_id,)
    ))


    seated      = 0
    waiting_pos = 0
    chair_accumulated = {}  # tracks running wait per chair

    for e in entries:
        cid = e.get('chair_id')

        if e['status'] == 'active':
            e['wait_mins'] = 0
            seated += 1
            # Seed accumulation with remaining time for seated customer
            if cid and cid not in chair_accumulated:
                seated_avg = _get_avg(e['shop_id'], cid, e.get('service'))
                elapsed    = _elapsed(e['sat_at']) if e.get('sat_at') else 0
                chair_accumulated[cid] = max(0, seated_avg - elapsed)
        else:
            waiting_pos   += 1
            e['position']  = waiting_pos

            if cid:
                if cid not in chair_accumulated:
                    chair_accumulated[cid] = 0
                svc_avg        = _get_avg(e['shop_id'], cid, e.get('service'))
                e['wait_mins'] = round(chair_accumulated[cid])
                chair_accumulated[cid] += svc_avg  # next person waits longer
            else:
                e['wait_mins'] = waiting_pos * 20  # fallback if no chair

        # Mask before sending to browser
        e['name']  = e['name'].split()[0] if e.get('name') else 'Customer'
        e.pop('phone', None)

    return jsonify({
        'queue':            entries,
        'total_waiting':    waiting_pos,
        'currently_seated': seated,
    })


# Each entry gets a cumulative wait_mins calculated
# from the remaining time of the seated customer
# plus each person ahead in line.

@queue_bp.route('/queue/branch/<int:shop_id>')
def queue_branch(shop_id):
    client_v = request.args.get('v', type=int)
    server_v = _version(shop_id)

    if client_v is not None and client_v == server_v:
        return jsonify({'changed': False, 'v': server_v})

    chairs = rows_to_list(query(
        """SELECT id, shop_id, barber_name, phone,
                  home_service, status, is_active
           FROM chairs WHERE shop_id=? AND is_active=1 ORDER BY id ASC""",
        (shop_id,)
    ))

    for chair in chairs:
        entries = rows_to_list(query(
            """SELECT * FROM queue
               WHERE chair_id=? AND status IN ('waiting','active')
               ORDER BY id ASC""",
            (chair['id'],)
        ))

        # ── Calculate cumulative wait_mins per entry ──────────
        # Start with whatever time is left for the seated customer.
        # Each waiting customer's wait = everything in front of them.
        accumulated = 0

        seated = next((e for e in entries if e['status'] == 'active'), None)
        if seated and seated.get('sat_at'):
            seated_avg   = _get_avg(shop_id, chair['id'], seated.get('service'))
            elapsed_mins = _elapsed(seated['sat_at'])
            accumulated  = max(0, seated_avg - elapsed_mins)

        for e in entries:
            if e['status'] == 'active':
                # Seated customer is already being served
                e['wait_mins'] = 0
            else:
                svc_avg        = _get_avg(shop_id, chair['id'], e.get('service'))
                e['wait_mins'] = round(accumulated)
                # Next person in line waits this person's service time too
                accumulated   += svc_avg

        chair['queue']    = entries
        chair['waiting']  = sum(1 for e in entries if e['status'] == 'waiting')
        chair['seated']   = any(e['status'] == 'active' for e in entries)
        # Chair-level wait_mins = total wait for a brand new customer joining now
        chair['wait_mins'] = get_wait(shop_id, chair['id'])

    return jsonify({'changed': True, 'v': server_v, 'chairs': chairs})

@queue_bp.route('/queue/status/<int:entry_id>')
def queue_entry_status(entry_id):
    """Single queue entry — used by customer to track position."""
    entry = query(
        '''SELECT q.*, c.barber_name
           FROM queue q
           LEFT JOIN chairs c ON c.id = q.chair_id
           WHERE q.id=?''',
        (entry_id,), one=True
    )
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    result = row_to_dict(entry)

    if entry['status'] == 'waiting':
        pos = query(
            """SELECT COUNT(*) as c FROM queue
               WHERE shop_id=? AND chair_id=? 
               AND status='waiting' AND id <= ?""",
            (entry['shop_id'], entry['chair_id'], entry['id']), one=True
    )
        result['position']  = pos['c'] if pos else 1
        result['wait_mins'] = result['position'] * 20

    return jsonify(result)


# ---- 3. Join queue ---------------------------------------

@queue_bp.route('/queue/join', methods=['POST'])
def queue_join():
    body     = request.get_json()
    shop_id  = body.get('shop_id')
    chair_id = body.get('chair_id')
    name     = (body.get('name')  or '').strip()
    phone    = (body.get('phone') or '').strip()
    service  = (body.get('service') or '').strip()
    source   = body.get('source', 'booking')

    if not shop_id or not name:
        return jsonify({'error': 'shop_id and name are required'}), 400

    # Check shop is open
    shop = query('SELECT status FROM shops WHERE id=?', (shop_id,), one=True)
    if not shop:
        return jsonify({'error': 'Shop not found'}), 404
    if shop['status'] == 'closed':
        return jsonify({'error': 'This shop is currently closed'}), 400

    if chair_id:
        chair = query(
            'SELECT status FROM chairs WHERE id=? AND is_active=1',
            (chair_id,), one=True
        )
        if not chair:
            return jsonify({'error': 'Barber not found'}), 404
        if chair['status'] == 'closed':
            return jsonify({'error': 'This barber is currently closed'}), 400
        # Break is allowed — customer was warned on frontend

    if phone:
        cust = query(
            'SELECT behaviour_score, credit_points, is_banned FROM customers WHERE phone=?',
            (phone,), one=True
        )

        # Fix 8: ban check
        if cust and cust['is_banned']:
            return jsonify({'error': 'Your account has been permanently suspended due to repeated violations'}), 403

        # Existing score check
        if cust:
            score   = cust['behaviour_score']
            credits = cust['credit_points']
            banned  = cust['is_banned']

            if banned:
                return jsonify({'error': 'Your account has been permanently suspended due to repeated violations'}), 403

            if score < 20 and credits == 0:
                return jsonify({'error': 'Account suspended due to repeated no-shows'}), 403

            if score == 0 and credits > 0:
                # Credit mode — allow in with warning
                pass  # continues to join queue normally

        # Fix 7: one active booking per customer
        active = query(
            """SELECT q.id, q.shop_id, s.name as shop_name
               FROM queue q
               JOIN shops s ON s.id = q.shop_id
               WHERE q.phone=? AND q.status IN ('waiting','active')
               LIMIT 1""",
            (phone,), one=True
        )
        if active:
            if int(active['shop_id']) == int(shop_id):
                return jsonify({'error': 'You are already in this shop\'s queue'}), 400
            else:
                return jsonify({
                    'error':          'already_booked',
                    'message':        f'You have an active booking at {active["shop_name"]}',
                    'other_shop':     active['shop_name'],
                    'other_shop_id':  active['shop_id'],
                    'other_entry_id': active['id'],
                }), 409

    # Fix 10: random 4-digit token
    token    = next_token(shop_id)
    wait     = calc_wait(shop_id, chair_id)
    position = query(
        "SELECT COUNT(*) as c FROM queue WHERE shop_id=? AND status='waiting'",
        (shop_id,), one=True
    )['c'] + 1

    entry_id = mutate(
        """INSERT INTO queue
           (shop_id,chair_id,token,name,phone,service,status,source)
           VALUES (?,?,?,?,?,?,'waiting',?)""",
        (shop_id, chair_id, token, name, phone, service, source)
    )

    _bump(shop_id)

    return jsonify({
        'entry_id': entry_id,
        'token':    token,
        'position': position,
        'wait_mins': wait,
    })


# ---- 4. Cancel entry -------------------------------------

@queue_bp.route('/queue/cancel/<int:entry_id>', methods=['DELETE'])
def queue_cancel(entry_id):
    entry = query('SELECT * FROM queue WHERE id=?', (entry_id,), one=True)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404
    if entry['status'] not in ('waiting',):
        return jsonify({'error': 'Can only cancel waiting entries'}), 400

    mutate("UPDATE queue SET status='cancelled' WHERE id=?", (entry_id,))
    update_done_at(entry['id'])
    _bump(entry['shop_id'])

    penalised  = False
    result_msg = None

    if entry['phone']:
        try:
            raw = entry['created_at']
            fmt = '%Y-%m-%d %H:%M:%S.%f' if '.' in raw else '%Y-%m-%d %H:%M:%S'
            created_at = datetime.strptime(raw, fmt)
            elapsed    = (datetime.utcnow() - created_at).total_seconds()

            if elapsed > 60:
                res = apply_penalty(entry['phone'], 20)
                penalised = True
                if res.get('banned'):
                    result_msg = 'Account permanently banned'
                elif res.get('warned'):
                    result_msg = f'Warning: {res.get("credits", 0)} credit points remaining'
        except Exception:
            pass

    return jsonify({'ok': True, 'penalised': penalised, 'message': result_msg})


# ---- 5. Chair actions ------------------------------------

@queue_bp.route('/queue/chair/<int:chair_id>/sit', methods=['PATCH'])
def queue_sit(chair_id):
    """Mark the next waiting entry as active. Records sat_at timestamp."""
    body    = request.get_json() or {}
    service = (body.get('service') or '').strip()

    already = query(
        "SELECT 1 FROM queue WHERE chair_id=? AND status='active'",
        (chair_id,), one=True
    )
    if already:
        return jsonify({'error': 'Someone is already seated on this chair'}), 400

    entry = query(
        "SELECT * FROM queue WHERE chair_id=? AND status='waiting' ORDER BY id ASC LIMIT 1",
        (chair_id,), one=True
    )
    if not entry:
        return jsonify({'error': 'No one waiting on this chair'}), 400

    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

    if service:
        mutate(
            "UPDATE queue SET status='active', sat_at=?, service=? WHERE id=?",
            (now, service, entry['id'])
        )
    else:
        mutate(
            "UPDATE queue SET status='active', sat_at=? WHERE id=?",
            (now, entry['id'])
        )

    # Notify customer
    if entry['phone']:
        try:
            from routes.notifications import send_push
            shop = query('SELECT name FROM shops WHERE id=?', (entry['shop_id'],), one=True)
            shop_name = shop['name'] if shop else 'the shop'
            send_push(
                entry['phone'],
                '💈 Your turn!',
                f'You are now in the chair at {shop_name}',
                f'/customer/shop/{entry["shop_id"]}'
            )
        except Exception as e:
            print(f'[push] error: {e}')

    _bump(entry['shop_id'])

    updated = query('SELECT * FROM queue WHERE id=?', (entry['id'],), one=True)
    return jsonify({'ok': True, 'entry': row_to_dict(updated)})


@queue_bp.route('/queue/chair/<int:chair_id>/done', methods=['PATCH'])
def queue_done(chair_id):
    """Mark the active entry on this chair as done."""
    entry = query(
        "SELECT * FROM queue WHERE chair_id=? AND status='active'",
        (chair_id,), one=True
    )
    if not entry:
        return jsonify({'error': 'No active entry on this chair'}), 400

    mutate("UPDATE queue SET status='done' WHERE id=?", (entry['id'],))
    update_done_at(entry['id'])
    _bump(entry['shop_id'])

    # Apply penalty if strike was given
    if entry['strikes'] >= 1 and entry['phone']:
        apply_penalty(entry['phone'], 5)

    # Reward customer if no strike
    if entry['strikes'] == 0 and entry['phone']:
        from routes.rewards import apply_reward
        apply_reward(entry['phone'], 5, 'haircut completed')

    return jsonify({'ok': True})

# queue.py — queue_skip()
# FIX: Apply penalty FIRST (core business logic),
# THEN send notification (side effect).
# If the notification fails, the penalty already landed.
# Core data is always consistent regardless of push outcome.
@queue_bp.route('/queue/chair/<int:chair_id>/skip', methods=['PATCH'])
def queue_skip(chair_id):
    entry = query(
        "SELECT * FROM queue WHERE chair_id=? AND status='waiting' ORDER BY id ASC LIMIT 1",
        (chair_id,), one=True
    )
    if not entry:
        return jsonify({'error': 'No one waiting on this chair'}), 400

    # Step 1: Commit the skip to DB — do this first
    mutate("UPDATE queue SET status='skipped' WHERE id=?", (entry['id'],))
    _bump(entry['shop_id'])

    # Step 2: Apply penalty — core business logic BEFORE any side effects
    # If this fails, the skip is still recorded but no ghost notification fires
    result_msg = None
    if entry['phone']:
        try:
            res = apply_penalty(entry['phone'], 10)
            if res.get('already_banned'):
                result_msg = 'Note: this customer was already banned before this skip'
            elif res.get('banned'):
                result_msg = 'Customer account permanently banned due to this skip'
            elif res.get('warned'):
                result_msg = f'Customer warned: {res.get("credits", 0)} credits left'
        except Exception as e:
            print(f'[penalty] error on skip for {entry["phone"]}: {e}')

    # Step 3: Send notification LAST — side effect, allowed to fail silently
    # Penalty is already locked in by this point
    if entry['phone']:
        try:
            from routes.notifications import send_push
            shop = query('SELECT name FROM shops WHERE id=?', (entry['shop_id'],), one=True)
            shop_name = shop['name'] if shop else 'the shop'
            send_push(
                entry['phone'],
                '⏭ You were skipped',
                'Please return to the shop to rejoin the queue.',
                f'/customer/shop/{entry["shop_id"]}'
            )
        except Exception as e:
            print(f'[push] error: {e}')

    return jsonify({'ok': True, 'skipped_token': entry['token'], 'message': result_msg})

@queue_bp.route('/queue/<int:entry_id>/strike', methods=['PATCH'])
def queue_strike(entry_id):
    entry = query('SELECT * FROM queue WHERE id=?', (entry_id,), one=True)
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    # Toggle strike — if already struck, remove it
    if entry['strikes'] >= 1:
        mutate('UPDATE queue SET strikes=0 WHERE id=?', (entry_id,))
        _bump(entry['shop_id'])
        return jsonify({'ok': True, 'struck': False})
    else:
        mutate('UPDATE queue SET strikes=1 WHERE id=?', (entry_id,))
        _bump(entry['shop_id'])
        return jsonify({'ok': True, 'struck': True})

@queue_bp.route('/queue/<int:entry_id>/move', methods=['PATCH'])
def queue_move(entry_id):
    """Move a waiting entry to a different chair."""
    body     = request.get_json() or {}
    chair_id = body.get('chair_id')
    if not chair_id:
        return jsonify({'error': 'chair_id is required'}), 400

    entry = query('SELECT shop_id FROM queue WHERE id=?', (entry_id,), one=True)
    mutate('UPDATE queue SET chair_id=? WHERE id=?', (chair_id, entry_id))
    if entry:
        _bump(entry['shop_id'])
    return jsonify({'ok': True})


# ---- 5b. Swap queue positions (reorder) ------------------

@queue_bp.route('/queue/swap', methods=['PATCH'])
def queue_swap():
    body = request.get_json() or {}
    id_a = body.get('id_a')
    id_b = body.get('id_b')
    if not id_a or not id_b:
        return jsonify({'error': 'id_a and id_b are required'}), 400

    a = query('SELECT * FROM queue WHERE id=? AND status="waiting"', (id_a,), one=True)
    b = query('SELECT * FROM queue WHERE id=? AND status="waiting"', (id_b,), one=True)
    if not a or not b:
        return jsonify({'error': 'Both entries must be waiting'}), 400

    # Swap all customer data between slots
    mutate('''UPDATE queue
              SET name=?, phone=?, service=?, source=?, strikes=?, token=?
              WHERE id=?''',
           (b['name'], b['phone'], b['service'], b['source'], b['strikes'], b['token'], id_a))

    mutate('''UPDATE queue
              SET name=?, phone=?, service=?, source=?, strikes=?, token=?
              WHERE id=?''',
           (a['name'], a['phone'], a['service'], a['source'], a['strikes'], a['token'], id_b))

    _bump(a['shop_id'])
    return jsonify({'ok': True})

# ---- 6. Danger zone — clear today's queue ---------------

@queue_bp.route('/queue/<int:shop_id>/clear', methods=['DELETE'])
def clear_queue(shop_id):
    """Cancel all waiting entries for this shop today."""
    today = datetime.utcnow().strftime('%Y-%m-%d')
    mutate(
        """UPDATE queue SET status='cancelled'
           WHERE shop_id=? AND status='waiting' AND date(created_at)=?""",
        (shop_id, today)
    )
    removed = query(
        """SELECT COUNT(*) as c FROM queue
           WHERE shop_id=? AND status='cancelled' AND date(created_at)=?""",
        (shop_id, today), one=True
    )
    _bump(shop_id)
    return jsonify({'ok': True, 'removed': removed['c'] if removed else 0})
