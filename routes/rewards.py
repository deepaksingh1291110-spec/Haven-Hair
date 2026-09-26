# ============================================================
# HAVEN HAIR — routes/rewards.py
# Customer Behaviour Reward System
#
# Functions:
#   apply_reward(phone, points, reason)
#       → increases behaviour score (max 100)
#
# Called from:
#   queue.py      → haircut done (+5), no strike (+2)
#   reports.py    → good review 4-5 stars (+3)
#   homeservice.py → home service completed (+5)
# ============================================================

from db import query, mutate

MAX_SCORE = 100

# credits only reset when score >= 20 (out of danger zone)
# Mirrors the exact threshold in apply_penalty (new_score < 20)
# making both functions consistent with each other.

def apply_reward(phone, points, reason=''):
    if not phone or points <= 0:
        return {'rewarded': False}

    row = query(
        'SELECT behaviour_score, credit_points, is_banned FROM customers WHERE phone=?',
        (phone,), one=True
    )
    if not row:
        return {'rewarded': False}

    if row['is_banned']:
        return {'rewarded': False}

    current = row['behaviour_score']

    if current >= MAX_SCORE:
        return {'rewarded': False, 'score': current}

    new_score = min(MAX_SCORE, current + points)
    mutate(
        'UPDATE customers SET behaviour_score=? WHERE phone=?',
        (new_score, phone)
    )

    # ✅ Only clear credits when score fully recovers OUT of danger zone.
    # Danger zone threshold is < 20 (set in apply_penalty).
    # Clearing at > 0 let customers bounce between score=1 and credits=50
    # forever, never reaching permanent ban.
    if new_score >= 20 and row['credit_points'] > 0:  # ← was new_score > 0
        mutate(
            'UPDATE customers SET credit_points=0 WHERE phone=?',
            (phone,)
        )

    return {
        'rewarded':  True,
        'old_score': current,
        'new_score': new_score,
        'points':    points,
        'reason':    reason,
    }
