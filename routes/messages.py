# ============================================================
# HAVEN HAIR — routes/messages.py
# Customer Messages + Owner Inbox APIs
#
# Sections:
#   1.  Blueprint setup
#   2.  Customer side     (conversations list, thread, send, unread)
#   3.  Owner side        (conversations, messages, send, mark read)
#   4.  Owner unread dot
#
# Blueprint: messages_bp
# Prefix:    none
#
# Customer APIs (used by customer/messages.html):
#   GET    /messages/conversations        → list convs for customer phone
#   GET    /messages/:shop_id/:phone      → thread messages
#   POST   /messages                      → customer sends a message
#   GET    /messages/unread-count         → unread badge for customer
#
# Owner Inbox APIs (used by inbox_list.js + inbox_thread.js):
#   GET    /api/owner/conversations       → list convs for a shop
#   GET    /api/owner/messages/:conv_id   → thread by conversation_id
#   POST   /api/owner/messages            → owner sends a reply
#   PATCH  /api/owner/conversations/:id/read → mark conv as read
#   GET    /owner/unread-count            → unread dot for owner header
# ============================================================

from flask import Blueprint, request, jsonify
from db    import query, mutate, rows_to_list, row_to_dict

messages_bp = Blueprint('messages', __name__)


# ---- 2. Customer side ------------------------------------

@messages_bp.route('/messages/conversations')
def messages_conversations():
    """All shops this customer has talked to, with last message."""
    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify([])

    rows = query('''
        SELECT
            m.shop_id,
            s.name          AS shop_name,
            (
                SELECT message FROM messages
                WHERE shop_id = m.shop_id
                AND customer_phone = ?
                ORDER BY created_at DESC LIMIT 1
            )               AS last_message,
            (
                SELECT sender FROM messages
                WHERE shop_id = m.shop_id
                AND customer_phone = ?
                ORDER BY created_at DESC LIMIT 1
            )               AS last_sender,
            (
                SELECT created_at FROM messages
                WHERE shop_id = m.shop_id
                AND customer_phone = ?
                ORDER BY created_at DESC LIMIT 1
            )               AS last_time,
            SUM(CASE WHEN m.sender = 'owner' AND m.is_read = 0
                     THEN 1 ELSE 0 END) AS unread
        FROM messages m
        JOIN shops s ON s.id = m.shop_id
        WHERE m.customer_phone = ?
        GROUP BY m.shop_id
        ORDER BY COALESCE(last_time, '1970-01-01') DESC
    ''', (phone, phone, phone, phone,))
    return jsonify(rows_to_list(rows))

@messages_bp.route('/messages/<int:shop_id>/<string:phone>')
def messages_thread(shop_id, phone):
    """Full message thread between customer and a shop."""
    msgs = rows_to_list(query(
        '''SELECT * FROM messages
           WHERE shop_id=? AND customer_phone=?
           ORDER BY created_at ASC''',
        (shop_id, phone)
    ))

    # Mark owner messages as read when customer opens thread
    mutate(
        """UPDATE messages SET is_read=1
           WHERE shop_id=? AND customer_phone=? AND sender='owner'""",
        (shop_id, phone)
    )

    return jsonify(msgs)


@messages_bp.route('/messages', methods=['POST'])
def messages_send():
    """Customer sends a message to a shop."""
    body    = request.get_json()
    shop_id = body.get('shop_id')
    phone   = (body.get('phone')   or '').strip()
    name    = (body.get('name')    or 'Customer').strip()
    msg     = (body.get('message') or '').strip()

    if not shop_id or not msg:
        return jsonify({'error': 'shop_id and message are required'}), 400

    # Require phone — guests cannot send messages
    if not phone:
        return jsonify({'error': 'Please sign in to send messages'}), 400


    # Get or create conversation record
    conv = query(
        'SELECT id FROM conversations WHERE shop_id=? AND customer_phone=?',
        (shop_id, phone), one=True
    )
    if not conv:
        conv_id = mutate(
            '''INSERT INTO conversations
               (shop_id,customer_phone,customer_name)
               VALUES (?,?,?)''',
            (shop_id, phone, name)
        )
    else:
        conv_id = conv['id']

    mutate(
        """INSERT INTO messages
           (conversation_id,shop_id,customer_phone,customer_name,sender,message)
           VALUES (?,?,?,?,'customer',?)""",
        (conv_id, shop_id, phone, name, msg)
    )

    return jsonify({'ok': True})


@messages_bp.route('/messages/unread-count')
def messages_unread_count():
    """Unread message count for customer header badge."""
    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify({'count': 0})

    row = query(
        """SELECT COUNT(*) as c FROM messages
           WHERE customer_phone=? AND sender='owner' AND is_read=0""",
        (phone,), one=True
    )
    return jsonify({'count': row['c'] if row else 0})


# ---- 3. Owner Inbox APIs ---------------------------------

@messages_bp.route('/hh/owner/conversations')
def owner_conversations():
    """
    All conversations for a shop.
    Used by inbox_list.js — supports ?shop_id=X.
    Returns conversation metadata including star_rating,
    wait_mins, review_text and ai_topic for the AI context card.
    """
    shop_id = request.args.get('shop_id', type=int)
    if not shop_id:
        return jsonify([])

    rows = rows_to_list(query('''
        SELECT
            cv.id               AS conversation_id,
            cv.customer_phone,
            cv.customer_name,
            cv.star_rating,
            cv.wait_mins,
            cv.review_text,
            cv.ai_topic,
            cv.created_at,
            (
                SELECT message FROM messages
                WHERE conversation_id = cv.id
                ORDER BY created_at DESC LIMIT 1
            )                   AS last_message,
            (
                SELECT created_at FROM messages
                WHERE conversation_id = cv.id
                ORDER BY created_at DESC LIMIT 1
            )                   AS last_time,
            SUM(CASE WHEN m.sender = 'customer' AND m.is_read = 0
                     THEN 1 ELSE 0 END) AS unread
        FROM conversations cv
        LEFT JOIN messages m ON m.conversation_id = cv.id
        WHERE cv.shop_id = ?
        GROUP BY cv.id
        ORDER BY COALESCE(last_time, '1970-01-01') DESC
    ''', (shop_id,)))

    return jsonify(rows)


@messages_bp.route('/hh/owner/messages/<int:conversation_id>')
def owner_messages_thread(conversation_id):
    """
    Full message thread for a conversation.
    Used by inbox_thread.js — fetches by conversation_id.
    Returns sender, message, sent_at for each message.
    """
    msgs = rows_to_list(query(
        '''SELECT id, sender, message, created_at AS sent_at
           FROM messages
           WHERE conversation_id=?
           ORDER BY created_at ASC''',
        (conversation_id,)
    ))
    return jsonify(msgs)


@messages_bp.route('/hh/owner/messages', methods=['POST'])
def owner_send_message():
    """
    Owner sends a reply to a customer.
    Body: { conversation_id, owner_id, message }
    Owner messages are pre-marked as read (is_read=1)
    because the owner just wrote it — no need to mark later.
    """
    body            = request.get_json()
    conversation_id = body.get('conversation_id')
    msg             = (body.get('message') or '').strip()

    if not conversation_id or not msg:
        return jsonify({'error': 'conversation_id and message are required'}), 400

    # Get conversation details for the insert
    conv = query(
        'SELECT * FROM conversations WHERE id=?',
        (conversation_id,), one=True
    )
    if not conv:
        return jsonify({'error': 'Conversation not found'}), 404

    new_id = mutate(
        """INSERT INTO messages
           (conversation_id,shop_id,customer_phone,customer_name,sender,message,is_read)
           VALUES (?,?,?,?,'owner',?,1)""",
        (conversation_id, conv['shop_id'],
         conv['customer_phone'], conv['customer_name'], msg)
    )

    # Mark review as replied so reports can track follow-ups
    if conv['review_id']:
        mutate('UPDATE reviews SET replied=1 WHERE id=?', (conv['review_id'],))

    # Return the new message so inbox_thread.js can confirm it was saved
    new_msg = query('SELECT * FROM messages WHERE id=?', (new_id,), one=True)
    return jsonify(row_to_dict(new_msg))


@messages_bp.route('/hh/owner/conversations/<int:conversation_id>/read', methods=['PATCH'])
def owner_mark_read(conversation_id):
    """
    Mark all customer messages in this conversation as read.
    Called by inbox_thread.js when owner opens a thread.
    """
    mutate(
        """UPDATE messages SET is_read=1
           WHERE conversation_id=? AND sender='customer'""",
        (conversation_id,)
    )
    return jsonify({'ok': True})


# ---- 4. Owner unread dot ---------------------------------

@messages_bp.route('/owner/unread-count')
def owner_unread():
    """
    Total unread customer messages across all shops owned.
    Used by the 💬 dot in the owner header.
    Supports ?owner_id=X (cross-shop) or ?shop_id=X (single shop).
    """
    owner_id = request.args.get('owner_id', type=int)
    shop_id  = request.args.get('shop_id',  type=int)

    if shop_id:
        row = query(
            """SELECT COUNT(*) as c FROM messages
               WHERE shop_id=? AND sender='customer' AND is_read=0""",
            (shop_id,), one=True
        )
    elif owner_id:
        row = query(
            """SELECT COUNT(*) as c FROM messages m
               JOIN shops s ON s.id = m.shop_id
               WHERE s.owner_id=? AND m.sender='customer' AND m.is_read=0""",
            (owner_id,), one=True
        )
    else:
        return jsonify({'count': 0})

    return jsonify({'count': row['c'] if row else 0})
