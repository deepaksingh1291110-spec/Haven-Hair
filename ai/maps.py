import requests
import math

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
ORS_URL = "https://api.openrouteservice.org/v2/directions/driving-car"

HEADERS = {"User-Agent": "HavenHair/1.0"}

def geocode_address(address):
    """Convert address to lat/lon"""
    try:
        res = requests.get(NOMINATIM_URL, params={
            'q': address,
            'format': 'json',
            'limit': 1
        }, headers=HEADERS, timeout=10)
        data = res.json()
        if data:
            return {
                'lat': float(data[0]['lat']),
                'lon': float(data[0]['lon']),
                'display_name': data[0]['display_name']
            }
        return None
    except Exception as e:
        return {'error': str(e)}

def reverse_geocode(lat, lon):
    """Convert lat/lon to address"""
    try:
        res = requests.get(REVERSE_URL, params={
            'lat': lat,
            'lon': lon,
            'format': 'json'
        }, headers=HEADERS, timeout=10)
        data = res.json()
        return {
            'address': data.get('display_name'),
            'city': data.get('address', {}).get('city'),
            'country': data.get('address', {}).get('country')
        }
    except Exception as e:
        return {'error': str(e)}

def haversine(lat1, lon1, lat2, lon2):
    """Calculate distance between two points in km"""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * \
        math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return round(R * 2 * math.asin(math.sqrt(a)), 2)

def get_directions(from_lat, from_lon, to_lat, to_lon, api_key=None):
    """Get directions using OpenRouteService"""
    if not api_key:
        dist = haversine(from_lat, from_lon, to_lat, to_lon)
        return {
            'distance_km': dist,
            'estimated_drive_mins': round(dist / 0.5),
            'note': 'Add ORS API key for full directions'
        }
    try:
        res = requests.post(ORS_URL, json={
            'coordinates': [[from_lon, from_lat], [to_lon, to_lat]]
        }, headers={
            'Authorization': api_key,
            'Content-Type': 'application/json'
        }, timeout=10)
        data = res.json()
        summary = data['routes'][0]['summary']
        return {
            'distance_km': round(summary['distance'] / 1000, 2),
            'estimated_drive_mins': round(summary['duration'] / 60)
        }
    except Exception as e:
        return {'error': str(e)}
