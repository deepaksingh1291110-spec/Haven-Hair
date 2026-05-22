from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import db
from models.behaviour import CustomerBehaviour, ScoreLog, Appeal
from models.staff import Notification
from models.queue import QueueEntry
from datetime import datetime, timedelta

behaviour_bp = Blueprint('behaviour', __name__)

# Score change amounts
SCORE_RULES = {
    'noshow_pos1':      {'change': -15, 'reason': 'No-show when barber was waiting'},
    'cancel_pos1':      {'change': -10, 'reason': 'Cancelled when at position 1'},
    'strike1':          {'change': -8,  'reason': 'Late arrival — barber waited'},
    'strike2':          {'change': -12, 'reason': 'Removed after second strike'},
    'geo_fence':        {'change': -5,  'reason': 'Left shop area without notice'},
    'complaint':        {'change': -20, 'reason': 'Staff complaint filed'},
    'completed':        {'change': +3,  'reason': 'Completed haircut on time'},
    'arrived_early':    {'change': +2,  'reason': 'Arrived before being called'},
    'good_review':      {'change': +1,  'reason': 'Left a positive review'},
}

def get_or_create(phone, name):
    c = CustomerBehaviour.query.filter_by(customer_phone=phone).first()
    if not c:
        c = CustomerBehaviour(customer_phone=phone, customer_name=name)
        db.session.add(c)
        db.session.commit()
    return c

def get_badge(score):
    if score >= 90: return '🌟 Excellent'
    if score >= 70: return '✓ Good'
    if score >= 50: return '⚠️ Caution'
    return '🚫 Flagged'

def check_monthly_reset(customer):
    """Reset score monthly but track warnings"""
    now = datetime.utcnow()
    if (now - customer.last_reset).days >= 30:
        if customer.score < 50:
            customer.warnings += 1
        customer.score = 100
        customer.last_reset = now
        # Permanent block after 3 warnings in 6 months
        if customer.warnings >= 3:
            customer.is_blocked = True
            customer.block_reason = 'Permanently blocked after repeated low scores over 6 months'
        db.session.commit()

def update_score(phone, name, rule_key, detail='', branch_id=None, filed_by='System'):
    """Update customer score and log it"""
    rule = SCORE_RULES.get(rule_key)
    if not rule: return None

    customer = get_or_create(phone, name)
    check_monthly_reset(customer)

    old_score = customer.score
    customer.score = max(0, min(100, customer.score + rule['change']))

    # Add warning if drops below 50
    if old_score >= 50 and customer.score < 50:
        customer.warnings += 1
        # Notify owner
        notif = Notification(
            owner_id=1,  # will improve later
            title=f'⚠️ Customer flagged: {name}',
            message=f'{name} ({phone}) score dropped to {customer.score}. Consider monitoring.',
            type='warning'
        )
        db.session.add(notif)

    log = ScoreLog(
        customer_phone=phone,
        customer_name=name,
        change=rule['change'],
        reason=rule['reason'],
        reason_detail=detail,
        branch_id=branch_id,
        filed_by=filed_by
    )
    db.session.add(log)
    db.session.commit()

    return {'score': customer.score, 'change': rule['change'], 'reason': rule['reason']}

# Get customer score
@behaviour_bp.route('/behaviour/<phone>', methods=['GET'])
def get_score(phone):
    customer = CustomerBehaviour.query.filter_by(customer_phone=phone).first()
    if not customer:
        return jsonify({
            'score': 100,
            'badge': '🌟 Excellent',
            'is_blocked': False,
            'logs': []
        })
    check_monthly_reset(customer)
    logs = ScoreLog.query.filter_by(
        customer_phone=phone
    ).order_by(ScoreLog.created_at.desc()).limit(20).all()

    return jsonify({
        'score': customer.score,
        'badge': get_badge(customer.score),
        'is_blocked': customer.is_blocked,
        'block_reason': customer.block_reason,
        'warnings': customer.warnings,
        'logs': [{
            'change': l.change,
            'reason': l.reason,
            'detail': l.reason_detail,
            'filed_by': l.filed_by,
            'time': l.created_at.strftime('%Y-%m-%d %H:%M')
        } for l in logs]
    })

# Check if customer blocked (call before joining queue)
@behaviour_bp.route('/behaviour/check/<phone>', methods=['GET'])
def check_blocked(phone):
    customer = CustomerBehaviour.query.filter_by(customer_phone=phone).first()
    if not customer:
        return jsonify({'blocked': False, 'score': 100, 'badge': '🌟 Excellent'})
    check_monthly_reset(customer)
    return jsonify({
        'blocked': customer.is_blocked,
        'score': customer.score,
        'badge': get_badge(customer.score),
        'block_reason': customer.block_reason if customer.is_blocked else None,
        'warning': customer.score < 70
    })

# Staff files complaint
@behaviour_bp.route('/behaviour/complaint', methods=['POST'])
def file_complaint():
    identity = 'staff'
    data = request.json

    # Check if complaint already filed for this queue entry
    entry_id = data.get('queue_entry_id')
    if entry_id:
        entry = QueueEntry.query.get(entry_id)
        if entry and entry.notes and 'COMPLAINED' in entry.notes:
            return jsonify({'error': 'Complaint already filed for this customer visit'}), 400
        # Mark entry as complained
        if entry:
            entry.notes = (entry.notes or '') + ' COMPLAINED'
            from database import db
            db.session.commit()
    reasons = {
        'late': 'Late arrival — barber waited',
        'noshow': 'No-show — barber waited 5+ minutes',
        'cancel_chair': 'Cancelled at position 1',
        'rude': 'Rude behaviour reported'
    }
    detail = reasons.get(data.get('type'), data.get('type', 'Complaint filed'))
    result = update_score(
        data['customer_phone'],
        data['customer_name'],
        'complaint',
        detail=detail,
        branch_id=data.get('branch_id'),
        filed_by=identity.split(':')[0] + ' staff'
    )

    # Notify owner
    customer = get_or_create(data['customer_phone'], data['customer_name'])
    if customer.score < 50:
        notif = Notification(
            owner_id=1,
            title=f'🚫 Flagged customer in queue',
            message=f"{data['customer_name']} score is now {customer.score}. They may need to be removed.",
            type='danger'
        )
        db.session.add(notif)
        db.session.commit()

    return jsonify({
        'message': 'Complaint filed',
        'result': result,
        'new_score': customer.score,
        'badge': get_badge(customer.score)
    })

# Award positive score
@behaviour_bp.route('/behaviour/reward', methods=['POST'])
def reward():
    data = request.json
    result = update_score(
        data['customer_phone'],
        data['customer_name'],
        data['rule'],
        branch_id=data.get('branch_id')
    )
    return jsonify({'message': 'Score updated', 'result': result})

# Customer submits appeal
@behaviour_bp.route('/behaviour/appeal', methods=['POST'])
def submit_appeal():
    data = request.json
    existing = Appeal.query.filter_by(
        customer_phone=data['phone'],
        status='pending'
    ).first()
    if existing:
        return jsonify({'error': 'You already have a pending appeal'}), 400

    appeal = Appeal(
        customer_phone=data['phone'],
        customer_name=data['name'],
        message=data['message']
    )
    db.session.add(appeal)

    # Notify owner
    notif = Notification(
        owner_id=1,
        title=f'📩 Appeal from {data["name"]}',
        message=data['message'][:100],
        type='info'
    )
    db.session.add(notif)
    db.session.commit()
    return jsonify({'message': 'Appeal submitted — owner will review shortly'}), 201

# Owner reviews appeal
@behaviour_bp.route('/behaviour/appeal/<int:aid>', methods=['PATCH'])
@jwt_required()
def review_appeal(aid):
    identity = get_jwt_identity()
    if not identity.startswith('owner:'):
        return jsonify({'error': 'Owner only'}), 403
    appeal = Appeal.query.get_or_404(aid)
    data = request.json
    appeal.status = data['status']  # approved / rejected
    appeal.owner_response = data.get('response', '')

    if data['status'] == 'approved':
        customer = CustomerBehaviour.query.filter_by(
            customer_phone=appeal.customer_phone
        ).first()
        if customer:
            customer.is_blocked = False
            customer.score = 60
            customer.warnings = max(0, customer.warnings - 1)
            db.session.commit()

    db.session.commit()
    return jsonify({'message': f'Appeal {data["status"]}'})

# Get all appeals for owner
@behaviour_bp.route('/behaviour/appeals', methods=['GET'])
@jwt_required()
def get_appeals():
    identity = get_jwt_identity()
    if not identity.startswith('owner:'):
        return jsonify({'error': 'Owner only'}), 403
    appeals = Appeal.query.filter_by(status='pending').order_by(
        Appeal.created_at.desc()
    ).all()
    return jsonify([{
        'id': a.id,
        'name': a.customer_name,
        'phone': a.customer_phone,
        'message': a.message,
        'time': a.created_at.strftime('%Y-%m-%d %H:%M')
    } for a in appeals])
