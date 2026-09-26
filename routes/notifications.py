from flask import Blueprint, request, jsonify
from db import query, mutate
import json
import os
from dotenv import load_dotenv

notifications_bp = Blueprint('notifications', __name__)

load_dotenv()

VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_PUBLIC_KEY  = os.environ.get('VAPID_PUBLIC_KEY',  '')
VAPID_CLAIMS      = {'sub': f"mailto:{os.environ.get('VAPID_EMAIL', '')}"}

if not VAPID_PRIVATE_KEY:
    print('[push] WARNING: VAPID_PRIVATE_KEY not set — push notifications disabled')

@notifications_bp.route('/push/subscribe', methods=['POST'])
def push_subscribe():
    body  = request.get_json()
    phone = (body.get('phone') or '').strip()
    sub   = body.get('subscription')
    if not phone or not sub:
        return jsonify({'error': 'phone and subscription required'}), 400
    mutate('DELETE FROM push_subscriptions WHERE phone=?', (phone,))
    mutate('INSERT INTO push_subscriptions (phone, subscription) VALUES (?,?)',
           (phone, json.dumps(sub)))
    return jsonify({'ok': True})


def send_push(phone, title, body_text, url='/'):
    row = query(
        'SELECT subscription FROM push_subscriptions WHERE phone=?',
        (phone,), one=True
    )
    if not row:
        return
    try:
        from pywebpush import webpush, WebPushException
        webpush(
            subscription_info=json.loads(row['subscription']),
            data=json.dumps({'title': title, 'body': body_text, 'url': url}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS,
        )
    except Exception as e:
        print(f'[push] failed for {phone}: {e}')
