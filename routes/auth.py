# ============================================================
# HAVEN HAIR — routes/auth.py
# Authentication API — register and login for all user types
#
# Fixes implemented:
#   Fix 8  — ban check in customer register / login;
#             banned customers receive 403 and cannot access app
#
# APIs:
#   POST  /auth/customer/register  → register or auto-login by phone
#   POST  /auth/owner/register     → create new owner account
#   POST  /auth/owner/login        → owner login with phone + password
#   POST  /auth/staff/login        → barber login with phone + password
# ============================================================

from flask import Blueprint, request, jsonify
from db    import query, mutate, hash_pw

auth_bp = Blueprint('auth', __name__)


# ---- 2. Customer register / login ------------------------
#
# Customers don't have passwords — phone number is their identity.
# If phone exists → return existing account (auto login).
# If phone is new → create account and return it.
# Fix 8: banned customers get 403 and cannot proceed.

@auth_bp.route('/auth/customer/register', methods=['POST'])
def auth_customer_register():
    body  = request.get_json()
    name  = (body.get('name')  or '').strip()
    phone = (body.get('phone') or '').strip()

    if not name or not phone:
        return jsonify({'error': 'Name and phone are required'}), 400

    existing = query('SELECT * FROM customers WHERE phone=?', (phone,), one=True)

    if existing:
        # Fix 8: ban check
        if existing['is_banned']:
            return jsonify({
                'error': 'Your account has been permanently suspended. Please contact the shop directly.'
            }), 403

        # Phone already registered — treat as login
        return jsonify({
            'token':          phone,
            'name':           existing['name'],
            'behaviour_score': existing['behaviour_score'],
            'credit_points':  existing['credit_points'],
            'status':         'login',
        })

    # New customer — create account
    mutate('INSERT INTO customers (name,phone) VALUES (?,?)', (name, phone))
    return jsonify({
        'token':          phone,
        'name':           name,
        'behaviour_score': 100,
        'credit_points':  0,
        'status':         'registered',
    })


# ---- 3. Owner register -----------------------------------

@auth_bp.route('/auth/owner/register', methods=['POST'])
def owner_register():
    body  = request.get_json()
    name  = (body.get('name',     '') or '').strip()
    phone = (body.get('phone',    '') or '').strip()
    pw    = (body.get('password', '') or '')

    if not name or not phone or not pw:
        return jsonify({'error': 'Name, phone and password are required'}), 400
    if len(pw) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    if query('SELECT 1 FROM owners WHERE phone=?', (phone,), one=True):
        return jsonify({'error': 'Phone already registered'}), 400

    new_id = mutate(
        'INSERT INTO owners (name,phone,password_hash) VALUES (?,?,?)',
        (name, phone, hash_pw(pw))
    )
    return jsonify({'id': new_id, 'name': name, 'phone': phone, 'role': 'owner'})


# ---- 4. Owner login --------------------------------------

@auth_bp.route('/auth/owner/login', methods=['POST'])
def owner_login():
    body  = request.get_json()
    phone = (body.get('phone',    '') or '').strip()
    pw    = (body.get('password', '') or '')

    if not phone or not pw:
        return jsonify({'error': 'Phone and password are required'}), 400

    row = query(
        'SELECT * FROM owners WHERE phone=? AND password_hash=?',
        (phone, hash_pw(pw)), one=True
    )
    if not row:
        return jsonify({'error': 'Wrong phone or password'}), 401

    return jsonify({'id': row['id'], 'name': row['name'], 'phone': row['phone'], 'role': 'owner'})


# ---- 5. Staff login --------------------------------------

@auth_bp.route('/auth/staff/login', methods=['POST'])
def staff_login():
    body  = request.get_json()
    phone = (body.get('phone',    '') or '').strip()
    pw    = (body.get('password', '') or '')

    if not phone or not pw:
        return jsonify({'error': 'Phone and password are required'}), 400

    row = query(
        '''SELECT c.*, s.name as shop_name
           FROM chairs c
           JOIN shops s ON s.id = c.shop_id
           WHERE c.phone=? AND c.password_hash=?''',
        (phone, hash_pw(pw)), one=True
    )
    if not row:
        return jsonify({'error': 'Wrong phone or password'}), 401

    return jsonify({
        'name':      row['barber_name'],
        'phone':     row['phone'],
        'role':      'staff',
        'chair_id':  row['id'],
        'shop_id':   row['shop_id'],
        'shop_name': row['shop_name'],
    })
