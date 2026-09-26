# ============================================================
# HAVEN HAIR — routes/reports.py
# Owner Weekly Reports API
#
# Sections:
#   1.  Blueprint setup
#   2.  Weekly report     (stats, reputation, complaints, chart)
#   3.  Reviews API       (list, can-review, submit)
#
# Blueprint: reports_bp
# Prefix:    none
#
# APIs:
#   GET  /api/owner/reports              → weekly report data
#        Params: ?shop_id=X&week_offset=N
#        week_offset: 0 = this week, -1 = last week, -2 = two weeks ago
#        Returns:
#        {
#          total          : int,        total customers served
#          happy          : int,        4-5 star reviews
#          complaints     : int,        1-2 star reviews
#          avg_wait       : float,      average wait time in minutes
#          rep_score      : int,        current reputation score 0-100
#          rep_score_prev : int,        score from previous week
#          resolved       : int,        complaints resolved via chat
#          updated        : int,        reviews updated after chat
#          days           : dict,       customers per day Mon-Sun
#          complaints_breakdown: list,  [{tag, count}]
#          ai_insight     : str | null  AI-generated insight text
#        }
#
#   GET  /reviews/:shop_id               → list reviews for a shop
#   GET  /reviews/can-review/:id/:phone  → check if customer can review
#   POST /reviews                        → submit a new review
# ============================================================

from datetime import datetime, timedelta
from flask    import Blueprint, request, jsonify
from db       import query, mutate, rows_to_list, row_to_dict

reports_bp = Blueprint('reports', __name__)

# Day labels used in the bar chart
DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


# ---- Helpers ---------------------------------------------

def week_bounds(offset=0):
    """
    Return (monday, sunday) datetime strings for a given week offset.
    offset=0  → this week
    offset=-1 → last week
    """
    today  = datetime.utcnow().date()
    monday = today - timedelta(days=today.weekday()) + timedelta(weeks=offset)
    sunday = monday + timedelta(days=6)
    return str(monday), str(sunday)


def day_label(date_str):
    """Convert a date string 'YYYY-MM-DD' to 'Mon', 'Tue' etc."""
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').strftime('%a')
    except Exception:
        return ''


# ---- 2. Weekly report ------------------------------------

@reports_bp.route('/hh/owner/reports')
def owner_reports():
    shop_id     = request.args.get('shop_id',     type=int)
    week_offset = request.args.get('week_offset', type=int, default=0)

    if not shop_id:
        return jsonify({'error': 'shop_id is required'}), 400

    # Clamp offset — can't look into future
    if week_offset > 0:
        week_offset = 0

    monday, sunday = week_bounds(week_offset)

    # ── Total customers served this week ──────────────────
    total_row = query(
        """SELECT COUNT(*) as c FROM queue
           WHERE shop_id=? AND status='done'
           AND date(created_at) BETWEEN ? AND ?""",
        (shop_id, monday, sunday), one=True
    )
    total = total_row['c'] if total_row else 0

    # ── Average wait time this week ───────────────────────
    # Wait = time between created_at and sat_at
    wait_row = query(
        """SELECT AVG(
               (strftime('%s', sat_at) - strftime('%s', created_at)) / 60.0
           ) as avg_wait
           FROM queue
           WHERE shop_id=? AND status='done'
           AND sat_at IS NOT NULL
           AND date(created_at) BETWEEN ? AND ?""",
        (shop_id, monday, sunday), one=True
    )
    avg_wait = round(wait_row['avg_wait'], 1) if wait_row and wait_row['avg_wait'] else 0

    # ── Reviews this week — happy vs complaints ───────────
    reviews_week = rows_to_list(query(
        """SELECT rating, comment FROM reviews
           WHERE shop_id=? AND date(created_at) BETWEEN ? AND ?""",
        (shop_id, monday, sunday)
    ))
    happy      = sum(1 for r in reviews_week if r['rating'] >= 4)
    complaints = sum(1 for r in reviews_week if r['rating'] <= 2)

    # reports.py — owner_reports()
    # BEFORE (broken): ORDER BY + LIMIT apply to the output row,
    # not to the rows being aggregated. AVG() sees ALL history.
    #
    # AFTER: Subquery runs first, correctly selecting the last 50
    # reviews before this week. AVG() then operates only on those rows.

    # ── Reputation score — current and previous week ──────────
    shop = query('SELECT reputation_score FROM shops WHERE id=?', (shop_id,), one=True)
    rep_score = shop['reputation_score'] if shop else 0

    # Wrap in a subquery so ORDER BY + LIMIT actually constrain
    # the rows fed into AVG(), not the aggregate output row.
    # This mirrors the correct pattern already used in predictions.py.
    prev_avg = query(
        """SELECT AVG(rating) as a FROM (
               SELECT rating
               FROM reviews
               WHERE shop_id=? AND date(created_at) < ?
               ORDER BY created_at DESC
               LIMIT 50
           )""",
        (shop_id, monday), one=True
    )

    # Ratings are 1–5. Multiply by 20 to map to 0–100 score scale.
    # Fallback to current score if no historical reviews exist,
    # so the delta shows 0 rather than a misleading number.
    rep_score_prev = round(prev_avg['a'] * 20) if prev_avg and prev_avg['a'] else rep_score

    # ── Resolved complaints + updated reviews ─────────────
    resolved = query(
        """SELECT COUNT(DISTINCT cv.id) as c
           FROM conversations cv
           JOIN messages m ON m.conversation_id = cv.id
           WHERE cv.shop_id=? AND m.sender='owner'
           AND date(m.created_at) BETWEEN ? AND ?""",
        (shop_id, monday, sunday), one=True
    )
    updated = query(
        """SELECT COUNT(*) as c FROM reviews
           WHERE shop_id=? AND replied=1
           AND date(created_at) BETWEEN ? AND ?""",
        (shop_id, monday, sunday), one=True
    )

    # ── Customers per day (Mon–Sun bar chart) ─────────────
    daily_rows = rows_to_list(query(
        """SELECT date(created_at) as day, COUNT(*) as c
           FROM queue
           WHERE shop_id=? AND status='done'
           AND date(created_at) BETWEEN ? AND ?
           GROUP BY date(created_at)""",
        (shop_id, monday, sunday)
    ))

    days = {label: 0 for label in DAY_LABELS}
    for row in daily_rows:
        label = day_label(row['day'])
        if label in days:
            days[label] += row['c']

    # ── Complaints breakdown ───────────────────────────────
    # Scan review comments for common complaint keywords
    all_complaints = rows_to_list(query(
        """SELECT comment FROM reviews
           WHERE shop_id=? AND rating <= 2
           AND date(created_at) BETWEEN ? AND ?""",
        (shop_id, monday, sunday)
    ))

    breakdown = _extract_complaint_tags(all_complaints)

    # ── AI insight ────────────────────────────────────────
    ai_insight = _generate_insight(shop_id, days, complaints, total)

    return jsonify({
        'total':                total,
        'happy':                happy,
        'complaints':           complaints,
        'avg_wait':             avg_wait,
        'rep_score':            rep_score,
        'rep_score_prev':       rep_score_prev,
        'resolved':             resolved['c'] if resolved else 0,
        'updated':              updated['c']  if updated  else 0,
        'days':                 days,
        'complaints_breakdown': breakdown,
        'ai_insight':           ai_insight,
    })


def _extract_complaint_tags(complaints):
    """
    Scan complaint comments for common keywords.
    Returns a list of {tag, count} sorted by count descending.
    No external AI needed — keyword matching is fast and free.
    """
    tags = {
        'wait time':    ['wait', 'long', 'slow', 'late', 'hour', 'minute'],
        'rude staff':   ['rude', 'bad attitude', 'disrespect', 'unprofessional'],
        'hygiene':      ['dirty', 'clean', 'hygiene', 'smell', 'unhygienic'],
        'bad haircut':  ['bad cut', 'ruined', 'wrong', 'uneven', 'terrible haircut'],
        'no-show':      ['no show', 'didnt come', 'cancelled', 'never showed'],
        'overpriced':   ['expensive', 'overpriced', 'too much', 'price'],
    }

    counts = {}
    for row in complaints:
        comment = (row.get('comment') or '').lower()
        for tag, keywords in tags.items():
            if any(kw in comment for kw in keywords):
                counts[tag] = counts.get(tag, 0) + 1

    # Sort by count descending, return top 5
    result = sorted(
        [{'tag': tag, 'count': count} for tag, count in counts.items()],
        key=lambda x: -x['count']
    )
    return result[:5]


def _generate_insight(shop_id, days, complaints, total):
    """
    Generate a simple AI-style text insight based on real data.
    No API call needed — rule-based logic produces meaningful advice.
    """
    if total == 0:
        return None

    insights = []

    # Find busiest day
    busiest_day   = max(days, key=lambda d: days[d])
    busiest_count = days[busiest_day]

    if busiest_count > 0:
        # Find quietest day with some customers
        active_days   = {d: c for d, c in days.items() if c > 0}
        quietest_day  = min(active_days, key=lambda d: active_days[d]) if active_days else None

        insights.append(
            f'<strong>{busiest_day}</strong> was your busiest day '
            f'with {busiest_count} customers.'
        )

        if quietest_day and quietest_day != busiest_day:
            insights.append(
                f'Consider promoting <strong>{quietest_day}</strong> '
                f'to balance your queue.'
            )

    # High complaint rate
    if total > 0 and complaints / total > 0.2:
        insights.append(
            f'<strong>{complaints}</strong> of your {total} customers '
            f'left a complaint this week. Reach out to each one — '
            f'resolved complaints often turn into updated reviews.'
        )

    # Check chair count vs peak load
    chair_count = query(
        'SELECT COUNT(*) as c FROM chairs WHERE shop_id=? AND is_active=1',
        (shop_id,), one=True
    )
    if chair_count and busiest_count > (chair_count['c'] * 6):
        insights.append(
            f'Peak load on <strong>{busiest_day}</strong> suggests you may '
            f'need an extra barber for that day.'
        )

    return ' '.join(insights) if insights else None


# ---- 3. Reviews API --------------------------------------

@reports_bp.route('/reviews/<int:shop_id>')
def reviews_list(shop_id):
    """
    Returns one entry per customer with:
      - averaged score
      - all individual reviews for expand view
    """
    # Get all unique customers who reviewed this shop
    customers = query(
        """SELECT phone, customer_name
           FROM reviews
           WHERE shop_id=?
           AND phone != ''
           AND customer_name != '[Deleted]'
           GROUP BY phone
           ORDER BY MAX(created_at) DESC
           LIMIT 50""",
        (shop_id,)
    )

    if not customers:
        return jsonify([])

    result = []
    for c in customers:
        # Get all reviews for this customer
        reviews = rows_to_list(query(
            """SELECT rating, comment, created_at
               FROM reviews
               WHERE shop_id=? AND phone=?
               ORDER BY created_at DESC""",
            (shop_id, c['phone'])
        ))

        if not reviews:
            continue

        # Calculate customer average
        avg = sum(r['rating'] for r in reviews) / len(reviews)

        result.append({
            'customer_name':  c['customer_name'],
            'avg_rating':     round(avg, 1),
            'review_count':   len(reviews),
            'latest_comment': reviews[0]['comment'],
            'latest_time':    reviews[0]['created_at'],
            'all_reviews':    reviews,
        })

    return jsonify(result)

# ✅ FIXED — can_review endpoint
@reports_bp.route('/reviews/can-review/<int:shop_id>/<string:phone>')
def can_review(shop_id, phone):
    last_review = query(
        """SELECT created_at FROM reviews
           WHERE shop_id=? AND phone=?
           ORDER BY created_at DESC LIMIT 1""",
        (shop_id, phone), one=True
    )

    if not last_review:
        visit = query(
            "SELECT 1 FROM queue WHERE shop_id=? AND phone=? AND status='done' LIMIT 1",
            (shop_id, phone), one=True
        )
        return jsonify({'can_review': bool(visit)})

    new_visit = query(
        """SELECT 1 FROM queue
           WHERE shop_id=? AND phone=? AND status='done'
           AND created_at > ? LIMIT 1""",
        (shop_id, phone, last_review['created_at']), one=True
    )
    return jsonify({'can_review': bool(new_visit)})

@reports_bp.route('/reviews', methods=['POST'])
def review_submit():
    body    = request.get_json()
    shop_id = body.get('shop_id')
    phone   = (body.get('phone')         or '').strip()
    rating  = body.get('rating')
    comment = (body.get('comment')       or '').strip()
    name    = (body.get('customer_name') or 'Anonymous').strip()

    if not shop_id or not rating:
        return jsonify({'error': 'shop_id and rating are required'}), 400

    rating = int(rating)
    if not 1 <= rating <= 5:
        return jsonify({'error': 'Rating must be between 1 and 5'}), 400

    # Check customer has completed visit
    # ✅ FIXED — reports.py review_submit()

    if phone:
        # ✅ New gate logic — check visit AFTER last review
        last_review = query(
            """SELECT created_at FROM reviews
               WHERE shop_id=? AND phone=?
               ORDER BY created_at DESC LIMIT 1""",
            (shop_id, phone), one=True
        )

        if last_review:
            new_visit = query(
                """SELECT 1 FROM queue
                   WHERE shop_id=? AND phone=? AND status='done'
                   AND created_at > ? LIMIT 1""",
                (shop_id, phone, last_review['created_at']), one=True
            )
            if not new_visit:
                return jsonify({'error': 'Complete another visit to leave a new review'}), 400
        else:
            first_visit = query(
                """SELECT 1 FROM queue
                   WHERE shop_id=? AND phone=? AND status='done'
                   LIMIT 1""",
                (shop_id, phone), one=True
            )
            if not first_visit:
                return jsonify({'error': 'Complete a visit first'}), 400

        # ✅ Still need reviews count for the cleanup below
        review_count = query(
            """SELECT COUNT(*) as c FROM reviews
               WHERE shop_id=? AND phone=?""",
            (shop_id, phone), one=True
        )
        reviews = review_count['c'] if review_count else 0

        # Keep max 5 reviews per customer per shop
        if reviews >= 5:
            mutate(
                """DELETE FROM reviews
                   WHERE id = (
                       SELECT id FROM reviews
                       WHERE shop_id=? AND phone=?
                       ORDER BY created_at ASC
                       LIMIT 1
                   )""",
                (shop_id, phone)
            )

    # Save new review
    new_id = mutate(
        '''INSERT INTO reviews
           (shop_id, customer_name, phone, rating, comment, verified)
           VALUES (?,?,?,?,?,0)''',
        (shop_id, name, phone, rating, comment)
    )

    # Reward customer for good review
    if rating >= 4 and phone:
        from routes.rewards import apply_reward
        apply_reward(phone, 3, 'good review given')

    # Auto create inbox conversation for bad reviews
    if rating <= 2 and phone:
        # ✅ SELECT id — not SELECT 1 — so we have the ID for the INSERT
        existing_conv = query(
            'SELECT id FROM conversations WHERE shop_id=? AND customer_phone=?',
            (shop_id, phone), one=True
        )

        if not existing_conv:
            # First bad review — create a new conversation record
            queue_entry = query(
                """SELECT sat_at, created_at FROM queue
                   WHERE shop_id=? AND phone=? AND status='done'
                   ORDER BY created_at DESC LIMIT 1""",
                (shop_id, phone), one=True
            )
            wait_mins = None
            if queue_entry and queue_entry['sat_at']:
                try:
                    sat  = datetime.strptime(
                        queue_entry['sat_at'], '%Y-%m-%d %H:%M:%S'
                    )
                    join = datetime.strptime(
                        queue_entry['created_at'], '%Y-%m-%d %H:%M:%S'
                    )
                    wait_mins = round((sat - join).total_seconds() / 60)
                except Exception:
                    pass

            ai_topic = _pick_ai_topic(comment)
            mutate(
                '''INSERT INTO conversations
                   (shop_id, customer_phone, customer_name, review_id,
                   star_rating, wait_mins, review_text, ai_topic)
                   VALUES (?,?,?,?,?,?,?,?)''',
                (shop_id, phone, name, new_id,
                 rating, wait_mins, comment, ai_topic)
            )

        else:
            # Repeat bad review — alert owner inside the existing thread.
            # ✅ conversation_id is now included so the owner's inbox
            #    query (WHERE conversation_id=?) finds it correctly.
            # ✅ sender='owner' prevents the customer's thread
            #    (WHERE shop_id=? AND customer_phone=?) from
            #    rendering this as a shop message in their chat.
            mutate(
                """INSERT INTO messages
                   (conversation_id, shop_id, customer_phone, customer_name,
                    sender, message, is_read)
                   VALUES (?,?,?,?,'owner',?,0)""",
                (existing_conv['id'], shop_id, phone, name,
                 f'⚠️ Customer left a new {rating}★ review: {comment}')
            )

    return jsonify({'ok': True, 'id': new_id})

def _pick_ai_topic(comment):
    """Pick the most relevant topic for the AI nudge based on review text."""
    comment = (comment or '').lower()
    if any(w in comment for w in ['wait', 'long', 'slow', 'late']):
        return 'wait time'
    if any(w in comment for w in ['rude', 'attitude', 'disrespect']):
        return 'staff behavior'
    if any(w in comment for w in ['dirty', 'clean', 'hygiene']):
        return 'hygiene'
    if any(w in comment for w in ['cut', 'style', 'hair']):
        return 'haircut quality'
    return 'their experience'
