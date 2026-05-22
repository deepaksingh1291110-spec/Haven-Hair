from flask import Blueprint, request, jsonify
from database import db
from models.queue import Message, QueueEntry
from datetime import datetime, timedelta

messages_bp = Blueprint('messages', __name__)

MESSAGE_LIMIT = 20
MESSAGE_EXPIRY_HOURS = 24

def cleanup_old_messages():
    """Delete messages older than 24 hours"""
    cutoff = datetime.utcnow() - timedelta(hours=MESSAGE_EXPIRY_HOURS)
    Message.query.filter(Message.created_at < cutoff).delete()
    db.session.commit()

def count_messages(entry_id):
    return Message.query.filter_by(queue_entry_id=entry_id).count()

# Send message
@messages_bp.route('/messages/<int:entry_id>', methods=['POST'])
def send_message(entry_id):
    entry = QueueEntry.query.get_or_404(entry_id)
    data = request.json

    # Cleanup old messages on every send
    cleanup_old_messages()

    # Check limit
    count = count_messages(entry_id)
    if count >= MESSAGE_LIMIT:
        return jsonify({
            'error': f'Message limit reached ({MESSAGE_LIMIT} per session)',
            'limit_reached': True
        }), 429

    msg = Message(
        queue_entry_id=entry_id,
        branch_id=entry.branch_id,
        sender=data['sender'],
        text=data['text'][:200]  # Max 200 chars per message
    )
    db.session.add(msg)
    db.session.commit()

    remaining = MESSAGE_LIMIT - (count + 1)
    return jsonify({
        'message': 'Sent ✓',
        'id': msg.id,
        'used': count + 1,
        'remaining': remaining,
        'limit': MESSAGE_LIMIT
    }), 201

# Get messages
@messages_bp.route('/messages/<int:entry_id>', methods=['GET'])
def get_messages(entry_id):
    cleanup_old_messages()
    msgs = Message.query.filter_by(
        queue_entry_id=entry_id
    ).order_by(Message.created_at).all()

    count = len(msgs)
    return jsonify({
        'messages': [{
            'sender': m.sender,
            'text': m.text,
            'time': m.created_at.strftime('%H:%M')
        } for m in msgs],
        'used': count,
        'remaining': MESSAGE_LIMIT - count,
        'limit': MESSAGE_LIMIT,
        'expires_in': '24 hours from first message'
    })
