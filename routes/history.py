from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import db
from models.staff import ActionLog, Notification
from models.shop import Branch
from datetime import datetime, timedelta

history_bp = Blueprint('history', __name__)

def log_action(branch_id, staff_name, staff_role, action, details='',
               customer_name='', duration_mins=None, staff_id=None):
    """Call this from every queue action"""
    suspicious = False
    reason = ''

    # Anti-cheat checks
    if action == 'done' and duration_mins is not None:
        if duration_mins < 2:
            suspicious = True
            reason = f'Service done in {duration_mins:.1f} mins — too fast'

    if action == 'skip':
        today_skips = ActionLog.query.filter_by(
            branch_id=branch_id,
            staff_id=staff_id,
            action='skip'
        ).filter(
            ActionLog.created_at >= datetime.utcnow().replace(hour=0, minute=0)
        ).count()
        if today_skips >= 5:
            suspicious = True
            reason = f'Too many skips today ({today_skips + 1})'

    if action == 'add_walkin' and not customer_name:
        suspicious = True
        reason = 'Walk-in added with no name'

    log = ActionLog(
        branch_id=branch_id,
        staff_id=staff_id,
        staff_name=staff_name,
        staff_role=staff_role,
        action=action,
        details=details,
        customer_name=customer_name,
        duration_mins=duration_mins,
        is_suspicious=suspicious,
        suspicious_reason=reason
    )
    db.session.add(log)
    db.session.commit()

def check_history_cleanup(branch_id, owner_id):
    """Check if history needs cleanup and send notifications"""
    now = datetime.utcnow()
    seven_days_ago = now - timedelta(days=7)
    five_days_ago = now - timedelta(days=5)
    six_days_ago = now - timedelta(days=6)

    # Count old logs
    old_count = ActionLog.query.filter(
        ActionLog.branch_id == branch_id,
        ActionLog.created_at < seven_days_ago
    ).count()

    if old_count > 0:
        # Delete old logs
        ActionLog.query.filter(
            ActionLog.branch_id == branch_id,
            ActionLog.created_at < seven_days_ago
        ).delete()
        db.session.commit()

    # Send warning notifications
    logs_5days = ActionLog.query.filter(
        ActionLog.branch_id == branch_id,
        ActionLog.created_at < five_days_ago,
        ActionLog.created_at >= six_days_ago
    ).count()

    if logs_5days > 0:
        existing = Notification.query.filter_by(
            owner_id=owner_id, type='warning'
        ).filter(
            Notification.created_at >= now.replace(hour=0, minute=0)
        ).first()
        if not existing:
            notif = Notification(
                owner_id=owner_id,
                branch_id=branch_id,
                title='⚠️ History deletes in 2 days',
                message=f'Branch history older than 5 days will be deleted in 2 days. Download if needed.',
                type='warning'
            )
            db.session.add(notif)
            db.session.commit()

# Get history for a branch
@history_bp.route('/history/<int:bid>', methods=['GET'])
@jwt_required()
def get_history(bid):
    identity = get_jwt_identity()
    if not identity.startswith('owner:'):
        return jsonify({'error': 'Owner access required'}), 403
    owner_id = int(identity.split(':')[1])

    # Run cleanup check
    check_history_cleanup(bid, owner_id)

    staff_filter = request.args.get('staff')
    date_filter = request.args.get('date')
    suspicious_only = request.args.get('suspicious') == 'true'

    query = ActionLog.query.filter_by(branch_id=bid)

    if staff_filter:
        query = query.filter(ActionLog.staff_name.ilike(f'%{staff_filter}%'))
    if date_filter:
        date = datetime.strptime(date_filter, '%Y-%m-%d')
        query = query.filter(
            ActionLog.created_at >= date,
            ActionLog.created_at < date + timedelta(days=1)
        )
    if suspicious_only:
        query = query.filter_by(is_suspicious=True)

    logs = query.order_by(ActionLog.created_at.desc()).limit(200).all()

    return jsonify([{
        'id': l.id,
        'staff': l.staff_name,
        'role': l.staff_role,
        'action': l.action,
        'details': l.details,
        'customer': l.customer_name,
        'duration_mins': l.duration_mins,
        'suspicious': l.is_suspicious,
        'reason': l.suspicious_reason,
        'time': l.created_at.strftime('%Y-%m-%d %H:%M')
    } for l in logs])

# Get notifications for owner
@history_bp.route('/notifications', methods=['GET'])
@jwt_required()
def get_notifications():
    identity = get_jwt_identity()
    owner_id = int(identity.split(':')[1])
    notifs = Notification.query.filter_by(
        owner_id=owner_id, is_read=False
    ).order_by(Notification.created_at.desc()).all()
    return jsonify([{
        'id': n.id,
        'title': n.title,
        'message': n.message,
        'type': n.type,
        'time': n.created_at.strftime('%Y-%m-%d %H:%M')
    } for n in notifs])

# Mark notification as read
@history_bp.route('/notifications/<int:nid>/read', methods=['PATCH'])
@jwt_required()
def mark_read(nid):
    n = Notification.query.get_or_404(nid)
    n.is_read = True
    db.session.commit()
    return jsonify({'message': 'Marked as read'})
