from flask import Blueprint, request, jsonify
from database import db
from models.shop import Shop, Barber
import math

shops_bp = Blueprint('shops', __name__)

def calc_distance(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))

# Find nearby shops
@shops_bp.route('/shops/nearby', methods=['GET'])
def nearby():
    lat = float(request.args.get('lat'))
    lon = float(request.args.get('lon'))
    radius = float(request.args.get('radius', 5))  # default 5km

    shops = Shop.query.filter(Shop.status != 'closed').all()
    result = []

    for shop in shops:
        dist = calc_distance(lat, lon, shop.latitude, shop.longitude)
        if dist <= radius:
            result.append({
                'id': shop.id,
                'name': shop.name,
                'address': shop.address,
                'status': shop.status,
                'reputation_score': shop.reputation_score,
                'distance_km': round(dist, 2),
                'latitude': shop.latitude,
                'longitude': shop.longitude
            })

    result.sort(key=lambda x: x['distance_km'])
    return jsonify(result)

# Register a new shop
@shops_bp.route('/shops', methods=['POST'])
def create_shop():
    data = request.json
    shop = Shop(
        name=data['name'],
        owner_name=data['owner_name'],
        phone=data['phone'],
        address=data['address'],
        latitude=data['latitude'],
        longitude=data['longitude']
    )
    db.session.add(shop)
    db.session.commit()
    return jsonify({'message': 'Shop created', 'id': shop.id}), 201

# Update shop status (open/busy/closed)
@shops_bp.route('/shops/<int:shop_id>/status', methods=['PATCH'])
def update_status(shop_id):
    shop = Shop.query.get_or_404(shop_id)
    shop.status = request.json['status']
    db.session.commit()
    return jsonify({'message': 'Status updated', 'status': shop.status})

# Get shop details
@shops_bp.route('/shops/<int:shop_id>', methods=['GET'])
def get_shop(shop_id):
    shop = Shop.query.get_or_404(shop_id)
    return jsonify({
        'id': shop.id,
        'name': shop.name,
        'owner_name': shop.owner_name,
        'address': shop.address,
        'status': shop.status,
        'reputation_score': shop.reputation_score,
        'latitude': shop.latitude,
        'longitude': shop.longitude
    })

# Add barber to shop
@shops_bp.route('/shops/<int:shop_id>/barbers', methods=['POST'])
def add_barber(shop_id):
    data = request.json
    barber = Barber(
        shop_id=shop_id,
        name=data['name']
    )
    db.session.add(barber)
    db.session.commit()
    return jsonify({'message': 'Barber added', 'id': barber.id}), 201
