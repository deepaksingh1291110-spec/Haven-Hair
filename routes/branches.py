from flask import Blueprint, request, jsonify
from database import db
from models.shop import Branch, Chair, Owner
from models.user import OwnerAccount
from flask_jwt_extended import jwt_required, get_jwt_identity
import math

branches_bp = Blueprint('branches', __name__)

def calc_distance(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return round(R * 2 * math.asin(math.sqrt(a)), 2)

def branch_to_dict(b, lat=None, lon=None):
    chairs = Chair.query.filter_by(branch_id=b.id).all()
    d = {
        'id': b.id,
        'owner_id': b.owner_id,
        'name': b.name,
        'address': b.address,
        'latitude': b.latitude,
        'longitude': b.longitude,
        'phone': b.phone,
        'status': b.status,
        'reputation_score': b.reputation_score,
        'prices': {
            'haircut': b.haircut_price,
            'beard': b.beard_price,
            'both': b.both_price,
            'kids': b.kids_price,
            'color': b.color_price,
            'facial': b.facial_price
        },
        'chairs': [{
            'id': c.id,
            'barber_name': c.barber_name,
            'status': c.status,
            'absent_note': c.absent_note
        } for c in chairs],
        'total_chairs': len(chairs),
        'active_chairs': len([c for c in chairs if c.status == 'active'])
    }
    if lat and lon:
        d['distance_km'] = calc_distance(lat, lon, b.latitude, b.longitude)
    return d

# Get all branches nearby
@branches_bp.route('/branches/nearby', methods=['GET'])
def nearby():
    lat = request.args.get('lat', type=float)
    lon = request.args.get('lon', type=float)
    radius = request.args.get('radius', 10, type=float)
    branches = Branch.query.filter(Branch.status != 'closed').all()
    result = []
    for b in branches:
        d = branch_to_dict(b, lat, lon)
        if lat and lon and radius < 999:
            if d.get('distance_km', 0) > radius:
                continue
        result.append(d)
    if lat and lon:
        result.sort(key=lambda x: x.get('distance_km', 999))
    return jsonify(result)

# Get branch detail
@branches_bp.route('/branches/<int:bid>', methods=['GET'])
def get_branch(bid):
    b = Branch.query.get_or_404(bid)
    lat = request.args.get('lat', type=float)
    lon = request.args.get('lon', type=float)
    return jsonify(branch_to_dict(b, lat, lon))

# Create branch (owner only)
@branches_bp.route('/branches', methods=['POST'])
@jwt_required()
def create_branch():
    identity = get_jwt_identity()
    owner_id = int(identity.split(':')[1])
    data = request.json
    b = Branch(
        owner_id=owner_id,
        name=data['name'],
        address=data['address'],
        latitude=data['latitude'],
        longitude=data['longitude'],
        phone=data.get('phone', ''),
        haircut_price=data.get('haircut_price', 0),
        beard_price=data.get('beard_price', 0),
        both_price=data.get('both_price', 0),
        kids_price=data.get('kids_price', 0),
        color_price=data.get('color_price', 0),
        facial_price=data.get('facial_price', 0)
    )
    db.session.add(b)
    db.session.commit()
    return jsonify({'message': 'Branch created', 'id': b.id}), 201

# Update branch settings
@branches_bp.route('/branches/<int:bid>', methods=['PATCH'])
@jwt_required()
def update_branch(bid):
    b = Branch.query.get_or_404(bid)
    data = request.json
    for field in ['name','address','phone','status','latitude','longitude',
                  'haircut_price','beard_price','both_price',
                  'kids_price','color_price','facial_price']:
        if field in data:
            setattr(b, field, data[field])
    db.session.commit()
    return jsonify({'message': 'Branch updated'})

# Get owner's branches
@branches_bp.route('/owner/branches', methods=['GET'])
@jwt_required()
def owner_branches():
    identity = get_jwt_identity()
    owner_id = int(identity.split(':')[1])
    branches = Branch.query.filter_by(owner_id=owner_id).all()
    return jsonify([branch_to_dict(b) for b in branches])

# Add chair to branch
@branches_bp.route('/branches/<int:bid>/chairs', methods=['POST'])
@jwt_required()
def add_chair(bid):
    Branch.query.get_or_404(bid)
    data = request.json
    chair = Chair(
        branch_id=bid,
        barber_name=data['barber_name']
    )
    db.session.add(chair)
    db.session.commit()
    return jsonify({'message': 'Chair added', 'id': chair.id}), 201

# Update chair status
@branches_bp.route('/chairs/<int:cid>', methods=['PATCH'])
@jwt_required()
def update_chair(cid):
    chair = Chair.query.get_or_404(cid)
    data = request.json
    for field in ['status', 'absent_note', 'barber_name',
                  'avg_haircut_mins', 'avg_beard_mins', 'avg_both_mins',
                  'avg_facial_mins', 'avg_kids_mins', 'avg_color_mins']:
        if field in data:
            setattr(chair, field, data[field])
    db.session.commit()
    return jsonify({'message': 'Chair updated'})


# Get all conversations for a branch (owner inbox)
@branches_bp.route('/branches/<int:bid>/conversations', methods=['GET'])
@jwt_required()
def branch_conversations(bid):
    from models.queue import QueueEntry, Message
    from sqlalchemy import func

    # Get all entries that have messages or are recent
    entries = QueueEntry.query.filter_by(branch_id=bid).order_by(
        QueueEntry.joined_at.desc()
    ).limit(50).all()

    result = []
    for e in entries:
        msg_count = Message.query.filter_by(queue_entry_id=e.id).count()
        last_msg = Message.query.filter_by(
            queue_entry_id=e.id
        ).order_by(Message.created_at.desc()).first()

        result.append({
            'entry_id': e.id,
            'customer_name': e.customer_name,
            'customer_phone': e.customer_phone,
            'service': e.service,
            'status': e.status,
            'token': e.token_number,
            'msg_count': msg_count,
            'last_message': last_msg.text[:40] if last_msg else None,
            'last_msg_sender': last_msg.sender if last_msg else None,
            'last_msg_time': last_msg.created_at.strftime('%H:%M') if last_msg else None,
            'joined_at': e.joined_at.strftime('%H:%M')
        })

    return jsonify(result)


# Delete branch
@branches_bp.route('/branches/<int:bid>', methods=['DELETE'])
@jwt_required()
def delete_branch(bid):
    from models.queue import QueueEntry, Message
    branch = Branch.query.get_or_404(bid)
    # Remove queue entries
    QueueEntry.query.filter_by(branch_id=bid).delete()
    # Remove chairs
    Chair.query.filter_by(branch_id=bid).delete()
    db.session.delete(branch)
    db.session.commit()
    return jsonify({'message': 'Branch deleted'})

# Delete chair
@branches_bp.route('/chairs/<int:cid>', methods=['DELETE'])
@jwt_required()
def delete_chair(cid):
    from models.queue import QueueEntry
    chair = Chair.query.get_or_404(cid)
    QueueEntry.query.filter_by(chair_id=cid).delete()
    db.session.delete(chair)
    db.session.commit()
    return jsonify({'message': 'Chair deleted'})
