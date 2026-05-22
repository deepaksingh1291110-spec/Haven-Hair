from database import db
from datetime import datetime

class QueueEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branch.id'), nullable=False)
    chair_id = db.Column(db.Integer, db.ForeignKey('chair.id'), nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    customer_phone = db.Column(db.String(20), nullable=False)
    service = db.Column(db.String(50), nullable=False)
    token_number = db.Column(db.Integer, nullable=False)
    position = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), default='waiting')
    # waiting, seated, done, skipped, removed, next_day
    booking_type = db.Column(db.String(20), default='walkin')  # walkin, booked
    scheduled_at = db.Column(db.DateTime, nullable=True)  # for bookings
    strikes = db.Column(db.Integer, default=0)  # 0,1,2
    strike_timer_start = db.Column(db.DateTime, nullable=True)
    last_known_lat = db.Column(db.Float, nullable=True)
    last_known_lon = db.Column(db.Float, nullable=True)
    estimated_wait = db.Column(db.Integer, default=0)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    seated_at = db.Column(db.DateTime, nullable=True)
    done_at = db.Column(db.DateTime, nullable=True)
    notes = db.Column(db.String(200), nullable=True)

class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    queue_entry_id = db.Column(db.Integer, db.ForeignKey('queue_entry.id'), nullable=False)
    branch_id = db.Column(db.Integer, db.ForeignKey('branch.id'), nullable=False)
    sender = db.Column(db.String(20), nullable=False)  # customer, barber
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
