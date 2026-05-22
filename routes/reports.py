from flask import Blueprint, jsonify
from models.review import Review
from models.queue import Queue
from models.shop import Shop

reports_bp = Blueprint('reports', __name__)

@reports_bp.route('/shops/<int:shop_id>/report', methods=['GET'])
def weekly_report(shop_id):
    shop = Shop.query.get_or_404(shop_id)

    reviews = Review.query.filter_by(shop_id=shop_id).all()
    positive = [r for r in reviews if r.ai_sentiment == 'positive']
    negative = [r for r in reviews if r.ai_sentiment == 'negative']

    complaints = {}
    for r in negative:
        if r.comment:
            if 'wait' in r.comment.lower():
                complaints['wait_time'] = complaints.get('wait_time', 0) + 1
            if 'rude' in r.comment.lower():
                complaints['staff_behavior'] = complaints.get('staff_behavior', 0) + 1
            if 'dirty' in r.comment.lower() or 'clean' in r.comment.lower():
                complaints['hygiene'] = complaints.get('hygiene', 0) + 1

    done_queue = Queue.query.filter_by(shop_id=shop_id, status='done').all()

    badge = '🏅 Top Rated' if shop.reputation_score >= 90 else \
            '✓ Trusted Shop' if shop.reputation_score >= 70 else \
            '⚠️ Warning' if shop.reputation_score < 50 else 'No badge'

    return jsonify({
        'shop': shop.name,
        'reputation_score': shop.reputation_score,
        'badge': badge,
        'summary': {
            'happy_customers': len(positive),
            'complaints': len(negative),
            'complaint_breakdown': complaints,
            'total_served': len(done_queue)
        },
        'ai_insight': generate_insight(complaints, done_queue)
    })

def generate_insight(complaints, done_queue):
    if not complaints:
        return '💡 No major complaints this week. Keep it up!'
    if complaints.get('wait_time', 0) > 1:
        return '💡 Multiple wait time complaints. Consider adding a barber during peak hours.'
    if complaints.get('staff_behavior', 0) > 0:
        return '💡 Staff behavior complaints detected. Address with your team.'
    if complaints.get('hygiene', 0) > 0:
        return '💡 Hygiene complaints found. Schedule a deep clean.'
    return '💡 Review complaints and reach out to unhappy customers.'
