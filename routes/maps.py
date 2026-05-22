from flask import Blueprint, request, jsonify
from ai.maps import geocode_address, reverse_geocode, get_directions, haversine
from models.shop import Branch

maps_bp = Blueprint('maps', __name__)

@maps_bp.route('/maps/geocode', methods=['GET'])
def geocode():
    address = request.args.get('address')
    if not address:
        return jsonify({'error': 'address required'}), 400
    return jsonify(geocode_address(address))

@maps_bp.route('/maps/reverse', methods=['GET'])
def reverse():
    lat = float(request.args.get('lat'))
    lon = float(request.args.get('lon'))
    return jsonify(reverse_geocode(lat, lon))

@maps_bp.route('/maps/directions/<int:bid>', methods=['GET'])
def directions(bid):
    from_lat = float(request.args.get('lat'))
    from_lon = float(request.args.get('lon'))
    branch = Branch.query.get_or_404(bid)
    result = get_directions(from_lat, from_lon, branch.latitude, branch.longitude)
    result['branch'] = branch.name
    result['address'] = branch.address
    return jsonify(result)

@maps_bp.route('/maps/shops', methods=['GET'])
def shops_map():
    lat = request.args.get('lat', type=float)
    lon = request.args.get('lon', type=float)
    branches = Branch.query.filter(Branch.status != 'closed').all()
    result = []
    for b in branches:
        entry = {
            'id': b.id,
            'name': b.name,
            'address': b.address,
            'status': b.status,
            'reputation_score': b.reputation_score,
            'latitude': b.latitude,
            'longitude': b.longitude
        }
        if lat and lon:
            entry['distance_km'] = haversine(lat, lon, b.latitude, b.longitude)
        result.append(entry)
    if lat and lon:
        result.sort(key=lambda x: x.get('distance_km', 999))
    return jsonify(result)
