from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from database import db
from models.staff import Staff
from models.shop import Branch, Chair

staff_bp = Blueprint('staff', __name__)

# Owner creates staff account
@staff_bp.route('/staff', methods=['POST'])
@jwt_required()
def create_staff():
    identity = get_jwt_identity()
    if not identity.startswith('owner:'):
        return jsonify({'error': 'Owner access required'}), 403
    owner_id = int(identity.split(':')[1])
    data = request.json

    if Staff.query.filter_by(phone=data['phone']).first():
        return jsonify({'error': 'Phone already registered'}), 400

    s = Staff(
        owner_id=owner_id,
        branch_id=data['branch_id'],
        chair_id=data.get('chair_id'),
        name=data['name'],
        phone=data['phone'],
        role=data.get('role', 'barber')
    )
    s.set_password(data['password'])
    db.session.add(s)
    db.session.commit()
    return jsonify({'message': f'{s.name} added as {s.role}', 'id': s.id}), 201

# Staff login
@staff_bp.route('/auth/staff/login', methods=['POST'])
def staff_login():
    data = request.json
    s = Staff.query.filter_by(phone=data['phone']).first()
    if not s or not s.check_password(data['password']):
        return jsonify({'error': 'Wrong phone or password'}), 401
    if not s.is_active:
        return jsonify({'error': 'Account disabled'}), 403

    token = create_access_token(identity=f"staff:{s.id}")
    return jsonify({
        'message': f'Welcome, {s.name}',
        'token': token,
        'role': s.role,
        'name': s.name,
        'branch_id': s.branch_id,
        'chair_id': s.chair_id,
        'staff_id': s.id
    })

# Get staff for a branch
@staff_bp.route('/branches/<int:bid>/staff', methods=['GET'])
@jwt_required()
def get_staff(bid):
    identity = get_jwt_identity()
    if not identity.startswith('owner:'):
        return jsonify({'error': 'Owner access required'}), 403
    staff = Staff.query.filter_by(branch_id=bid).all()
    return jsonify([{
        'id': s.id,
        'name': s.name,
        'phone': s.phone,
        'role': s.role,
        'chair_id': s.chair_id,
        'is_active': s.is_active
    } for s in staff])

# Toggle staff active/inactive
@staff_bp.route('/staff/<int:sid>', methods=['PATCH'])
@jwt_required()
def update_staff(sid):
    identity = get_jwt_identity()
    if not identity.startswith('owner:'):
        return jsonify({'error': 'Owner access required'}), 403
    s = Staff.query.get_or_404(sid)
    data = request.json
    if 'is_active' in data:
        s.is_active = data['is_active']
    if 'role' in data:
        s.role = data['role']
    if 'chair_id' in data:
        s.chair_id = data['chair_id']
    db.session.commit()
    return jsonify({'message': 'Staff updated'})

# Delete staff
@staff_bp.route('/staff/<int:sid>', methods=['DELETE'])
@jwt_required()
def delete_staff(sid):
    identity = get_jwt_identity()
    if not identity.startswith('owner:'):
        return jsonify({'error': 'Owner access required'}), 403
    s = Staff.query.get_or_404(sid)
    db.session.delete(s)
    db.session.commit()
    return jsonify({'message': 'Staff removed'})
