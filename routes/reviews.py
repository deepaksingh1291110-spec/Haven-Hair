from flask import Blueprint, request, jsonify
from database import db
from models.review import Review
from models.shop import Branch
from models.queue import QueueEntry

reviews_bp = Blueprint('reviews', __name__)

def sentiment(rating, comment):
    if rating >= 4: return 'positive'
    elif rating == 3: return 'neutral'
    return 'negative'

def update_reputation(branch_id):
    reviews = Review.query.filter_by(branch_id=branch_id, is_verified=True).all()
    if not reviews: return
    avg = sum(r.rating for r in reviews) / len(reviews)
    score = round((avg / 5) * 100, 1)
    branch = Branch.query.get(branch_id)
    if branch:
        branch.reputation_score = score
        db.session.commit()

def get_badge(score):
    if score >= 90: return '🏅 Top Rated'
    elif score >= 70: return '✓ Trusted Shop'
    elif score >= 50: return 'No badge'
    return '⚠️ Warning'

@reviews_bp.route('/reviews', methods=['POST'])
def add_review():
    data = request.json
    branch_id = data.get('branch_id') or data.get('shop_id')
    phone = data.get('customer_phone', '')
    name = data.get('customer_name', '')

    if not branch_id:
        return jsonify({'error': 'Branch ID required'}), 400

    # Check if customer actually completed a service at this branch
    completed = QueueEntry.query.filter_by(
        branch_id=branch_id,
        customer_phone=phone,
        status='done'
    ).all()

    if not completed:
        return jsonify({
            'error': 'You can only review after completing a service at this shop'
        }), 403

    # Check if already reviewed for each completed entry
    # One review per completed queue entry
    reviewed_entries = [
        r.queue_entry_id for r in
        Review.query.filter_by(branch_id=branch_id, customer_phone=phone).all()
        if r.queue_entry_id
    ]

    # Find a completed entry not yet reviewed
    unreviewed = [e for e in completed if e.id not in reviewed_entries]

    if not unreviewed:
        return jsonify({
            'error': 'You have already reviewed all your visits. Complete another service to review again.'
        }), 403

    # Use the most recent unreviewed completed entry
    entry = unreviewed[-1]

    r = Review(
        branch_id=branch_id,
        customer_name=name,
        customer_phone=phone,
        rating=data['rating'],
        comment=data.get('comment', ''),
        queue_entry_id=entry.id,
        ai_sentiment=sentiment(data['rating'], data.get('comment', '')),
        is_verified=True
    )
    db.session.add(r)
    db.session.commit()
    update_reputation(branch_id)
    return jsonify({'message': 'Review submitted ⭐ — Thank you!'}), 201

@reviews_bp.route('/reviews/<int:bid>', methods=['GET'])
def get_reviews(bid):
    branch = Branch.query.get_or_404(bid)
    reviews = Review.query.filter_by(branch_id=bid).order_by(
        Review.created_at.desc()
    ).all()
    return jsonify({
        'branch': branch.name,
        'reputation_score': branch.reputation_score,
        'badge': get_badge(branch.reputation_score),
        'total_reviews': len(reviews),
        'reviews': [{
            'customer': r.customer_name,
            'rating': r.rating,
            'comment': r.comment,
            'sentiment': r.ai_sentiment,
            'verified': r.is_verified
        } for r in reviews]
    })

# Check if customer can review
@reviews_bp.route('/reviews/can-review/<int:bid>/<phone>', methods=['GET'])
def can_review(bid, phone):
    completed = QueueEntry.query.filter_by(
        branch_id=bid, customer_phone=phone, status='done'
    ).count()
    reviewed = Review.query.filter_by(
        branch_id=bid, customer_phone=phone
    ).count()
    remaining = completed - reviewed
    return jsonify({
        'can_review': remaining > 0,
        'completed_services': completed,
        'reviews_given': reviewed,
        'reviews_remaining': max(0, remaining)
    })
