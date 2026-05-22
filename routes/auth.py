from flask import Blueprint, request, jsonify

def clean_phone(phone):
    """Remove quotes, spaces and sanitize phone number"""
    if not phone: return ''
    return str(phone).strip().strip("'\"").strip()
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from database import db
from models.user import OwnerAccount, Customer

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/auth/owner/register', methods=['POST'])
def owner_register():
    data = request.json
    if OwnerAccount.query.filter_by(phone=data['phone']).first():
        return jsonify({'error': 'Phone already registered'}), 400
    owner = OwnerAccount(name=data['name'], phone=data['phone'])
    owner.set_password(data['password'])
    db.session.add(owner)
    db.session.commit()
    token = create_access_token(identity=f"owner:{owner.id}")
    return jsonify({'message': 'Registered ✅', 'token': token, 'owner_id': owner.id}), 201

@auth_bp.route('/auth/owner/login', methods=['POST'])
def owner_login():
    data = request.json
    owner = OwnerAccount.query.filter_by(phone=data['phone']).first()
    if not owner or not owner.check_password(data['password']):
        return jsonify({'error': 'Wrong phone or password'}), 401
    token = create_access_token(identity=f"owner:{owner.id}")
    return jsonify({'message': 'Welcome back 💈', 'token': token, 'owner_id': owner.id})

@auth_bp.route('/auth/owner/me', methods=['GET'])
@jwt_required()
def owner_me():
    identity = get_jwt_identity()
    owner_id = int(identity.split(':')[1])
    owner = OwnerAccount.query.get_or_404(owner_id)
    return jsonify({'name': owner.name, 'phone': owner.phone, 'id': owner.id})

@auth_bp.route('/auth/customer/register', methods=['POST'])
def customer_register():
    data = request.json
    existing = Customer.query.filter_by(phone=data['phone']).first()
    if existing:
        token = create_access_token(identity=f"customer:{existing.id}")
        return jsonify({'message': 'Welcome back', 'token': token, 'customer_id': existing.id})
    customer = Customer(name=data['name'], phone=data['phone'])
    db.session.add(customer)
    db.session.commit()
    token = create_access_token(identity=f"customer:{customer.id}")
    return jsonify({'message': 'Registered ✅', 'token': token, 'customer_id': customer.id}), 201

# Update customer profile
@auth_bp.route('/auth/customer/profile', methods=['PATCH'])
def update_customer_profile():
    # Try JWT first, fall back to phone lookup
    data = request.json
    customer = None
    try:
        from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
        verify_jwt_in_request()
        identity = get_jwt_identity()
        customer_id = int(identity.split(':')[1])
        customer = Customer.query.get(customer_id)
    except:
        # Fallback: find by current phone
        if data.get('current_phone'):
            customer = Customer.query.filter_by(phone=data['current_phone']).first()
    if not customer:
        return jsonify({'error': 'Not found'}), 404
    data = request.json
    if 'name' in data: customer.name = data['name']
    if 'phone' in data:
        existing = Customer.query.filter_by(phone=data['phone']).first()
        if existing and existing.id != customer_id:
            return jsonify({'error': 'Phone already in use'}), 400
        customer.phone = data['phone']
    db.session.commit()
    return jsonify({'message': 'Profile updated ✅'})

# Update owner profile
@auth_bp.route('/auth/owner/profile', methods=['PATCH'])
@jwt_required()
def update_owner_profile():
    identity = get_jwt_identity()
    owner_id = int(identity.split(':')[1])
    owner = OwnerAccount.query.get_or_404(owner_id)
    data = request.json
    if 'name' in data: owner.name = data['name']
    if 'phone' in data:
        existing = OwnerAccount.query.filter_by(phone=data['phone']).first()
        if existing and existing.id != owner_id:
            return jsonify({'error': 'Phone already in use'}), 400
        owner.phone = data['phone']
    db.session.commit()
    return jsonify({'message': 'Profile updated ✅'})

# Change password (owner)
@auth_bp.route('/auth/owner/password', methods=['PATCH'])
@jwt_required()
def change_password():
    identity = get_jwt_identity()
    owner_id = int(identity.split(':')[1])
    owner = OwnerAccount.query.get_or_404(owner_id)
    data = request.json
    if not owner.check_password(data['current_password']):
        return jsonify({'error': 'Current password is wrong'}), 401
    owner.set_password(data['new_password'])
    db.session.commit()
    return jsonify({'message': 'Password changed ✅'})

# Delete customer account
@auth_bp.route('/auth/customer/account', methods=['DELETE'])
@jwt_required()
def delete_customer():
    identity = get_jwt_identity()
    customer_id = int(identity.split(':')[1])
    customer = Customer.query.get_or_404(customer_id)
    from models.queue import QueueEntry
    from models.behaviour import CustomerBehaviour, ScoreLog
    # Remove from active queues
    QueueEntry.query.filter_by(
        customer_phone=customer.phone,
        status='waiting'
    ).update({'status': 'removed'})
    # Delete behaviour data
    CustomerBehaviour.query.filter_by(customer_phone=customer.phone).delete()
    ScoreLog.query.filter_by(customer_phone=customer.phone).delete()
    db.session.delete(customer)
    db.session.commit()
    return jsonify({'message': 'Account deleted'})

# Delete owner account
@auth_bp.route('/auth/owner/account', methods=['DELETE'])
@jwt_required()
def delete_owner():
    identity = get_jwt_identity()
    owner_id = int(identity.split(':')[1])
    owner = OwnerAccount.query.get_or_404(owner_id)
    db.session.delete(owner)
    db.session.commit()
    return jsonify({'message': 'Account deleted'})



