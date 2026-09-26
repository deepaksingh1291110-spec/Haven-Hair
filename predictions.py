# ============================================================
# HAVEN HAIR — predictions.py
# Service Duration Prediction System
#
# Sections:
#   1.  Imports & config
#   2.  Done_at tracker
#   3.  Nightly average calculator
#   4.  Wait time estimator
#   5.  Scheduler (1 AM IST)
# ============================================================


# ---- 1. Imports & config ---------------------------------

import pytz
import atexit
from datetime       import datetime
from db             import query, mutate
from apscheduler.schedulers.background import BackgroundScheduler

IST        = pytz.timezone('Asia/Kolkata')
SAMPLE_MAX = 40    # max history entries to average
FALLBACK   = 20    # fallback minutes if no data


# ---- 2. Done_at tracker ----------------------------------

def update_done_at(entry_id):
    """
    Called when haircut is marked done.
    Saves the completion timestamp for duration calculation.
    """
    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    mutate(
        "UPDATE queue SET done_at=? WHERE id=?",
        (now, entry_id)
    )


# ---- 3. Nightly average calculator ----------------------

def calculate_all_averages():
    """
    Runs every night 1 AM IST.
    For every shop → every chair → every service:
      Takes last 40 completed entries
      Calculates real average duration
      Stores in service_averages table
    """
    print(f"[predictions] Starting nightly calculation — "
          f"{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')} IST")

    # Get all active shops
    shops = query("SELECT id FROM shops")
    if not shops:
        return

    for shop in shops:
        shop_id = shop['id']

        # Get all active chairs for this shop
        chairs = query(
            "SELECT id FROM chairs WHERE shop_id=? AND is_active=1",
            (shop_id,)
        )
        if not chairs:
            continue

        for chair in chairs:
            chair_id = chair['id']

            # Get all unique services this chair has done
            services = query(
                """SELECT DISTINCT service FROM queue
                   WHERE chair_id=?
                   AND status='done'
                   AND sat_at IS NOT NULL
                   AND done_at IS NOT NULL
                   AND service IS NOT NULL""",
                (chair_id,)
            )
            if not services:
                continue

            for svc in services:
                service = svc['service']

                # Calculate average from last 40 completed entries
                row = query(
                    """SELECT
                           AVG(
                               (strftime('%s', done_at) -
                                strftime('%s', sat_at)) / 60.0
                           ) as avg_mins,
                           COUNT(*) as sample_count
                       FROM (
                           SELECT sat_at, done_at
                           FROM queue
                           WHERE chair_id=?
                           AND service=?
                           AND status='done'
                           AND sat_at IS NOT NULL
                           AND done_at IS NOT NULL
                           AND (strftime('%s', done_at) -
                                strftime('%s', sat_at)) > 0
                           ORDER BY created_at DESC
                           LIMIT ?
                       )""",
                    (chair_id, service, SAMPLE_MAX),
                    one=True
                )

                if not row or not row['avg_mins']:
                    continue

                avg_mins     = round(row['avg_mins'], 1)
                sample_count = row['sample_count']

                # Skip unrealistic values
                # less than 2 min or more than 3 hours = bad data
                if avg_mins < 2 or avg_mins > 180:
                    continue

                now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

                # Update or insert average
                existing = query(
                    """SELECT id FROM service_averages
                       WHERE shop_id=? AND chair_id=? AND service=?""",
                    (shop_id, chair_id, service),
                    one=True
                )

                if existing:
                    mutate(
                        """UPDATE service_averages
                           SET avg_mins=?, sample_count=?, updated_at=?
                           WHERE shop_id=? AND chair_id=? AND service=?""",
                        (avg_mins, sample_count, now,
                         shop_id, chair_id, service)
                    )
                else:
                    mutate(
                        """INSERT INTO service_averages
                           (shop_id, chair_id, service,
                            avg_mins, sample_count, updated_at)
                           VALUES (?,?,?,?,?,?)""",
                        (shop_id, chair_id, service,
                         avg_mins, sample_count, now)
                    )

    print(f"[predictions] Nightly calculation complete — "
          f"{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')} IST")


# ---- 4. Wait time estimator ------------------------------

def get_wait(shop_id, chair_id, service=None):
    """
    Returns estimated wait time in minutes for a new customer.

    Fallback chain:
      1. Barber + service average  (most accurate)
      2. Service default duration  (from services table)
      3. Hardcoded 20 min          (last resort)
    """

    # Step 1: get all waiting entries for this chair
    waiting = query(
        """SELECT service FROM queue
           WHERE chair_id=? AND status='waiting'
           ORDER BY token ASC""",
        (chair_id,)
    )

    # Step 2: get currently seated customer remaining time
    seated = query(
        """SELECT sat_at, service FROM queue
           WHERE chair_id=? AND status='active'
           LIMIT 1""",
        (chair_id,), one=True
    )

    total_mins = 0

    # Add remaining time for seated customer
    if seated and seated['sat_at']:
        seated_avg   = _get_avg(shop_id, chair_id, seated['service'])
        elapsed_mins = _elapsed(seated['sat_at'])
        remaining    = max(0, seated_avg - elapsed_mins)
        total_mins  += remaining

    # Add wait time for each person already waiting
    for entry in (waiting or []):
        total_mins += _get_avg(shop_id, chair_id, entry['service'])

    return round(total_mins)


def _get_avg(shop_id, chair_id, service):
    """
    Get average duration for a service.
    Fallback chain:
      barber+service average → service default → 20 min
    """
    if not service:
        return FALLBACK

    # Try barber + service average first
    row = query(
        """SELECT avg_mins FROM service_averages
           WHERE shop_id=? AND chair_id=? AND service=?""",
        (shop_id, chair_id, service),
        one=True
    )
    if row and row['avg_mins']:
        return row['avg_mins']

    # Try service default duration from services table
    row = query(
        """SELECT duration_mins FROM services
           WHERE shop_id=? AND service=?""",
        (shop_id, service),
        one=True
    )
    if row and row['duration_mins']:
        return row['duration_mins']

    # Last resort
    return FALLBACK


def _elapsed(sat_at_str):
    """
    Minutes elapsed since customer sat down.
    """
    try:
        fmt     = '%Y-%m-%d %H:%M:%S.%f' if '.' in sat_at_str \
                  else '%Y-%m-%d %H:%M:%S'
        sat_at  = datetime.strptime(sat_at_str, fmt)
        elapsed = (datetime.utcnow() - sat_at).total_seconds() / 60
        return max(0, elapsed)
    except Exception:
        return 0

# ---- 5. Nightly cleanup ---------------------------------

def nightly_cleanup():
    """
    Runs every night at 1:30 AM IST.
    Keeps database small.
    """
    # Keep only 5 reviews per customer per shop
    mutate("""
        DELETE FROM reviews
        WHERE id NOT IN (
            SELECT id FROM reviews r1
            WHERE (
                SELECT COUNT(*) FROM reviews r2
                WHERE r2.phone   = r1.phone
                AND r2.shop_id  = r1.shop_id
                AND r2.created_at >= r1.created_at
            ) <= 5
        )
    """)

    # Add to nightly_cleanup() after cancelled/skipped deletion:
    # Keep only latest 40 done entries per chair per service
    # (needed for predictions calculation)
    # Keep only latest 5 done entries per customer per shop
    # (needed for review eligibility and visit history)
    # Delete everything older than both these needs

    mutate("""
        DELETE FROM queue
        WHERE status = 'done'
        AND id NOT IN (
            SELECT id FROM queue q1
            WHERE status = 'done'
            AND (
                SELECT COUNT(*) FROM queue q2
                WHERE q2.phone   = q1.phone
                AND q2.shop_id  = q1.shop_id
                AND q2.status   = 'done'
                AND q2.id >= q1.id
            ) <= 5
        )
        AND id NOT IN (
            SELECT id FROM queue q1
            WHERE status = 'done'
            AND (
                SELECT COUNT(*) FROM queue q2
                WHERE q2.chair_id = q1.chair_id
                AND q2.service   = q1.service
                AND q2.status    = 'done'
                AND q2.id >= q1.id
            ) <= 40
        )
    """)

    # Delete cancelled/skipped queue entries older than 7 days
    mutate("""
        DELETE FROM queue
        WHERE status IN ('cancelled', 'skipped')
        AND created_at < datetime('now', '-7 days')
    """)

    # Delete old messages older than 30 days
    mutate("""
        DELETE FROM messages
        WHERE created_at < datetime('now', '-30 days')
    """)

    # Delete rejected/cancelled home service older than 7 days
    mutate("""
        DELETE FROM home_service_requests
        WHERE status IN ('rejected', 'cancelled')
        AND created_at < datetime('now', '-7 days')
    """)

    print(f"[predictions] Nightly cleanup complete — "
          f"{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')} IST")



# ---- 5. Scheduler ----------------------------------------
def start_scheduler(app):
    def run_averages():
        with app.app_context():
            calculate_all_averages()

    def run_reputation():
        with app.app_context():
            calculate_reputation_scores()

    def run_cleanup():
        with app.app_context():
            nightly_cleanup()

    scheduler = BackgroundScheduler(timezone=IST)
    scheduler.add_job(
        run_averages,
        trigger  = 'cron',
        hour     = 1,
        minute   = 0,
        id       = 'nightly_averages',
        name     = 'Nightly service averages',
        replace_existing = True,
    )
    scheduler.add_job(
        run_reputation,
        trigger          = 'cron',
        hour             = 1,
        minute           = 15,
        id               = 'nightly_reputation',
        name             = 'Nightly reputation scores',
        replace_existing = True,
    )
    scheduler.add_job(
        run_cleanup,
        trigger  = 'cron',
        hour     = 1,
        minute   = 30,
        id       = 'nightly_cleanup',
        name     = 'Nightly database cleanup',
        replace_existing = True,
    )
    scheduler.start()
    atexit.register(lambda: scheduler.shutdown(wait=False))
    print("[predictions] Scheduler started — "
          "nightly averages at 1:00 AM, reputation at 1:15 AM, cleanup 1:30 AM IST")


def calculate_reputation_scores():
    """
    Runs every night 1:15 AM IST.
    Per shop:
      Step 1 — average each customer's own reviews (max 5)
      Step 2 — average of 50 most recent customers' scores
      Step 3 — convert to 0-100 scale and save
    """
    print(f"[predictions] Reputation scores starting — "
          f"{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')} IST")

    shops = query("SELECT id FROM shops")
    if not shops:
        return

    for shop in shops:
        shop_id = shop['id']

        # Per-customer average (their up to 5 reviews)
        # then limit to 50 most recently visiting customers
        customer_avgs = query(
            """SELECT AVG(rating) as avg_rating
               FROM reviews
               WHERE shop_id=?
               AND phone != ''
               AND phone IS NOT NULL
               GROUP BY phone
               ORDER BY MAX(created_at) DESC
               LIMIT 50""",
            (shop_id,)
        )

        if not customer_avgs:
            continue

        total      = sum(r['avg_rating'] for r in customer_avgs)
        shop_score = round((total / len(customer_avgs)) * 20)
        shop_score = max(0, min(100, shop_score))  # clamp to 0-100

        mutate(
            'UPDATE shops SET reputation_score=? WHERE id=?',
            (shop_score, shop_id)
        )

    print(f"[predictions] Reputation scores done — "
          f"{datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')} IST")
