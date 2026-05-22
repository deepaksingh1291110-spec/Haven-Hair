from flask import Blueprint, request, jsonify
from database import db
from models.queue import QueueEntry, Message
from models.shop import Branch, Chair
from datetime import datetime, timedelta
try:
    from routes.notifications import notify_customer_seated, notify_owner_new_customer
except: pass
import math
import random
from routes.behaviour import update_score

queue_bp = Blueprint('queue', __name__)

GRACE_MINUTES = 5
SERVICE_KEY = {
    'haircut': 'avg_haircut_mins',
    'beard': 'avg_beard_mins',
    'both': 'avg_both_mins',
    'facial': 'avg_facial_mins',
    'kids': 'avg_kids_mins',
    'color': 'avg_color_mins'
}

def get_wait(chair, service, position):
    key = SERVICE_KEY.get(service, 'avg_haircut_mins')
    avg = getattr(chair, key, 20)
    seated = QueueEntry.query.filter_by(chair_id=chair.id, status='seated').first()
    remaining = avg / 2 if seated else 0
    return round(remaining + (max(0, position - 1) * avg))

def reposition(chair_id):
    waiting = QueueEntry.query.filter_by(
        chair_id=chair_id, status='waiting'
    ).order_by(QueueEntry.position).all()
    for i, e in enumerate(waiting):
        e.position = i + 1
    db.session.commit()

def do_log(branch_id, action, details='', customer_name='',
           duration_mins=None, staff_name='Owner', staff_role='owner', staff_id=None):
    try:
        from routes.history import log_action
        log_action(branch_id, staff_name, staff_role, action,
                   details, customer_name, duration_mins, staff_id)
    except Exception:
        pass

# Get full queue for a branch
@queue_bp.route('/queue/branch/<int:bid>', methods=['GET'])
def branch_queue(bid):
    chairs = Chair.query.filter_by(branch_id=bid).all()
    result = []
    for chair in chairs:
        seated = QueueEntry.query.filter_by(chair_id=chair.id, status='seated').first()
        waiting = QueueEntry.query.filter_by(
            chair_id=chair.id, status='waiting'
        ).order_by(QueueEntry.position).all()
        result.append({
            'chair_id': chair.id,
            'barber_name': chair.barber_name,
            'status': chair.status,
            'absent_note': chair.absent_note,
            'seated': {
                'id': seated.id,
                'name': seated.customer_name,
                'service': seated.service,
                'token': seated.token_number,
                'phone': seated.customer_phone,
                'seated_at': seated.seated_at.isoformat() if seated.seated_at else None
            } if seated else None,
            'waiting': [{
                'id': e.id,
                'position': e.position,
                'name': e.customer_name,
                'service': e.service,
                'token': e.token_number,
                'estimated_wait': get_wait(chair, e.service, e.position),
                'strikes': e.strikes,
                'booking_type': e.booking_type,
                'notes': e.notes,
                'phone': e.customer_phone
            } for e in waiting],
            'total_waiting': len(waiting)
        })
    return jsonify(result)

# Join queue
@queue_bp.route('/queue/join', methods=['POST'])
def join_queue():
    data = request.json
    branch_id = data['branch_id']
    chair_id = data['chair_id']
    branch = Branch.query.get_or_404(branch_id)
    chair = Chair.query.get_or_404(chair_id)

    if branch.status == 'paused':
        return jsonify({'error': 'This branch is temporarily closed'}), 400

    booking_type = data.get('booking_type', 'walkin')
    scheduled_at = None
    if booking_type == 'booked' and data.get('scheduled_at'):
        scheduled_at = datetime.fromisoformat(data['scheduled_at'])

    # Check if customer already in ANY chair of this branch
    phone = data.get('customer_phone', 'N/A')
    if phone != 'N/A':
        existing = QueueEntry.query.filter_by(
            branch_id=branch_id,
            customer_phone=phone
        ).filter(
            QueueEntry.status.in_(['waiting', 'seated'])
        ).first()
        if existing:
            chair = Chair.query.get(existing.chair_id)
            return jsonify({
                'already_in_queue': True,
                'message': 'You are already in a queue at this shop',
                'id': existing.id,
                'token': existing.token_number,
                'position': existing.position,
                'barber': chair.barber_name if chair else '',
                'estimated_wait_mins': get_wait(chair, existing.service, existing.position)
            }), 200

    # Generate unique 4-digit random token (reusable after service done)
    active_tokens = set(
        e.token_number for e in QueueEntry.query.filter_by(
            branch_id=branch_id
        ).filter(
            QueueEntry.status.in_(['waiting', 'seated'])
        ).all()
    )
    attempts = 0
    while attempts < 100:
        token = random.randint(1000, 9999)
        if token not in active_tokens:
            break
        attempts += 1
    last_pos = QueueEntry.query.filter_by(chair_id=chair_id, status='waiting').count()
    position = last_pos + 1
    wait = get_wait(chair, data['service'], position)

    entry = QueueEntry(
        branch_id=branch_id,
        chair_id=chair_id,
        customer_name=data['customer_name'],
        customer_phone=data.get('customer_phone', 'N/A'),
        service=data['service'],
        token_number=token,
        position=position,
        estimated_wait=wait,
        booking_type=booking_type,
        scheduled_at=scheduled_at,
        notes=data.get('notes', '')
    )
    db.session.add(entry)
    db.session.commit()

    do_log(branch_id, 'add_walkin',
           f'Token {token} · {data["service"]} · {booking_type}',
           data['customer_name'])

    try:
        from models.shop import Branch
        b = Branch.query.get(branch_id)
        if b: notify_owner_new_customer(b.owner_id, name, b.name)
    except: pass
    return jsonify({
        'message': 'Joined queue',
        'id': entry.id,
        'token': token,
        'position': position,
        'barber': chair.barber_name,
        'estimated_wait_mins': wait
    }), 201

# Seat
@queue_bp.route('/queue/<int:eid>/seat', methods=['PATCH'])
def seat(eid):
    entry = QueueEntry.query.get_or_404(eid)
    entry.status = 'seated'
    entry.seated_at = datetime.utcnow()
    db.session.commit()
    reposition(entry.chair_id)
    chair = Chair.query.get(entry.chair_id)
    do_log(entry.branch_id, 'seated',
           f'Chair: {chair.barber_name if chair else "?"}',
           entry.customer_name)
    return jsonify({'message': f'{entry.customer_name} seated ✓'})

# Done
@queue_bp.route('/queue/<int:eid>/done', methods=['PATCH'])
def done(eid):
    entry = QueueEntry.query.get_or_404(eid)
    entry.status = 'done'
    entry.done_at = datetime.utcnow()
    duration = None
    if entry.seated_at:
        duration = round((entry.done_at - entry.seated_at).seconds / 60, 1)
        chair = Chair.query.get(entry.chair_id)
        if chair and duration > 1:
            key = SERVICE_KEY.get(entry.service, 'avg_haircut_mins')
            old = getattr(chair, key)
            setattr(chair, key, round((old * 0.8) + (duration * 0.2), 1))
    db.session.commit()
    chair = Chair.query.get(entry.chair_id)
    # Reward on time completion
    try:
        update_score(entry.customer_phone, entry.customer_name, 'completed', branch_id=entry.branch_id)
    except: pass
    do_log(entry.branch_id, 'done',
           f'{entry.service} · {duration} mins' if duration else entry.service,
           entry.customer_name, duration_mins=duration)
    return jsonify({'message': f'{entry.customer_name} done ✅'})

# Skip
@queue_bp.route('/queue/<int:eid>/skip', methods=['PATCH'])
def skip(eid):
    entry = QueueEntry.query.get_or_404(eid)
    entry.status = 'skipped'
    db.session.commit()
    reposition(entry.chair_id)
    do_log(entry.branch_id, 'skip', entry.service, entry.customer_name)
    return jsonify({'message': f'Token {entry.token_number} skipped'})

# Move position
@queue_bp.route('/queue/<int:eid>/move', methods=['PATCH'])
def move_position(eid):
    entry = QueueEntry.query.get_or_404(eid)
    new_pos = request.json.get('position')
    waiting = QueueEntry.query.filter_by(
        chair_id=entry.chair_id, status='waiting'
    ).order_by(QueueEntry.position).all()
    waiting = [e for e in waiting if e.id != entry.id]
    new_pos = max(1, min(new_pos, len(waiting) + 1))
    waiting.insert(new_pos - 1, entry)
    for i, e in enumerate(waiting):
        e.position = i + 1
    db.session.commit()
    do_log(entry.branch_id, 'move',
           f'Moved to position {new_pos}', entry.customer_name)
    return jsonify({'message': f'Moved to position {new_pos}'})

# Strike
@queue_bp.route('/queue/<int:eid>/strike', methods=['PATCH'])
def add_strike(eid):
    entry = QueueEntry.query.get_or_404(eid)
    entry.strikes += 1
    if entry.strikes == 1:
        waiting = QueueEntry.query.filter_by(
            chair_id=entry.chair_id, status='waiting'
        ).order_by(QueueEntry.position).all()
        new_pos = min(entry.position + 1, len(waiting))
        entry.position = new_pos
        entry.strike_timer_start = datetime.utcnow()
        db.session.commit()
        reposition(entry.chair_id)
        do_log(entry.branch_id, 'strike',
               f'Strike 1 — dropped to position {new_pos}', entry.customer_name)
        return jsonify({
            'message': 'Strike 1 — dropped one position',
            'new_position': entry.position,
            'grace_minutes': GRACE_MINUTES
        })
    elif entry.strikes >= 2:
        entry.status = 'removed'
        db.session.commit()
        reposition(entry.chair_id)
        try:
            update_score(entry.customer_phone, entry.customer_name, 'strike2', branch_id=entry.branch_id)
        except: pass
        do_log(entry.branch_id, 'strike',
               'Strike 2 — removed from queue', entry.customer_name)
        return jsonify({'message': 'Strike 2 — removed from queue'})
    return jsonify({'message': 'Strike added'})

# Transfer to another chair
@queue_bp.route('/queue/<int:eid>/transfer', methods=['PATCH'])
def transfer(eid):
    entry = QueueEntry.query.get_or_404(eid)
    new_chair_id = request.json.get('chair_id')
    new_chair = Chair.query.get_or_404(new_chair_id)

    old_chair = Chair.query.get(entry.chair_id)
    old_chair_name = old_chair.barber_name if old_chair else '?'

    # Remove from current position
    old_chair_id = entry.chair_id
    entry.chair_id = new_chair_id

    # Add to end of new chair queue
    last_pos = QueueEntry.query.filter_by(
        chair_id=new_chair_id, status='waiting'
    ).count()
    entry.position = last_pos + 1
    db.session.commit()

    reposition(old_chair_id)

    do_log(entry.branch_id, 'transfer',
           f'From {old_chair_name} → {new_chair.barber_name}',
           entry.customer_name)

    return jsonify({
        'message': f'{entry.customer_name} transferred to {new_chair.barber_name}',
        'new_position': entry.position
    })

# Update location (geo-fence)
@queue_bp.route('/queue/<int:eid>/location', methods=['PATCH'])
def update_location(eid):
    entry = QueueEntry.query.get_or_404(eid)
    lat = request.json.get('lat')
    lon = request.json.get('lon')
    entry.last_known_lat = lat
    entry.last_known_lon = lon
    branch = Branch.query.get(entry.branch_id)
    geo_warning = False
    if branch and lat and lon:
        dist = haversine(lat, lon, branch.latitude, branch.longitude)
        if dist > 0.1:
            geo_warning = True
    db.session.commit()
    return jsonify({'message': 'Location updated', 'geo_warning': geo_warning})

# Check timers
@queue_bp.route('/queue/check-timers/<int:bid>', methods=['GET'])
def check_timers(bid):
    now = datetime.utcnow()
    expired = []
    entries = QueueEntry.query.filter_by(
        branch_id=bid, status='waiting'
    ).filter(QueueEntry.strike_timer_start != None).all()
    for e in entries:
        elapsed = (now - e.strike_timer_start).seconds / 60
        if elapsed >= GRACE_MINUTES:
            expired.append({
                'id': e.id,
                'name': e.customer_name,
                'strikes': e.strikes,
                'timer_expired': True
            })
    return jsonify(expired)

# Send message
@queue_bp.route('/queue/<int:eid>/message', methods=['POST'])
def send_message(eid):
    entry = QueueEntry.query.get_or_404(eid)
    data = request.json
    msg = Message(
        queue_entry_id=eid,
        branch_id=entry.branch_id,
        sender=data['sender'],
        text=data['text']
    )
    db.session.add(msg)
    db.session.commit()
    return jsonify({'message': 'Sent ✓', 'id': msg.id}), 201

# Get messages
@queue_bp.route('/queue/<int:eid>/messages', methods=['GET'])
def get_messages(eid):
    msgs = Message.query.filter_by(queue_entry_id=eid).order_by(Message.created_at).all()
    return jsonify([{
        'sender': m.sender,
        'text': m.text,
        'time': m.created_at.strftime('%H:%M')
    } for m in msgs])

def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return round(R * 2 * math.asin(math.sqrt(a)), 3)


@queue_bp.route('/queue/status/<int:entry_id>')
def queue_status(entry_id):
    from models.queue import QueueEntry

    entry = QueueEntry.query.get(entry_id)

    if not entry:
        return {'error':'Not found'},404

    if entry.status not in ['waiting','active']:
        return {
            'status': entry.status
        }

    same_queue = QueueEntry.query.filter_by(
        barber_id=entry.barber_id,
        status='waiting'
    ).order_by(QueueEntry.id.asc()).all()

    position = 1

    for i,e in enumerate(same_queue):
        if e.id == entry.id:
            position = i + 1
            break

    return {
        'status': entry.status,
        'position': position,
        'estimated_wait_mins': max(position - 1,0) * 20
    }



# Check single entry status
@queue_bp.route('/queue/entry/<int:eid>', methods=['GET'])
def get_entry(eid):
    entry = QueueEntry.query.get(eid)
    if not entry:
        return jsonify({'error': 'Not found'}), 404
    chair = Chair.query.get(entry.chair_id)
    return jsonify({
        'id': entry.id,
        'status': entry.status,
        'position': entry.position,
        'token': entry.token_number,
        'estimated_wait': get_wait(chair, entry.service, entry.position) if chair else 0
    })
