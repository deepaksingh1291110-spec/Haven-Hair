from database import db
from datetime import datetime

class CustomerBehaviour(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_phone = db.Column(db.String(20), nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    score = db.Column(db.Integer, default=100)
    is_blocked = db.Column(db.Boolean, default=False)
    block_reason = db.Column(db.String(200), nullable=True)
    warnings = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_reset = db.Column(db.DateTime, default=datetime.utcnow)

class ScoreLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_phone = db.Column(db.String(20), nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    change = db.Column(db.Integer, nullable=False)  # negative or positive
    reason = db.Column(db.String(200), nullable=False)
    reason_detail = db.Column(db.String(200), nullable=True)
    branch_id = db.Column(db.Integer, nullable=True)
    filed_by = db.Column(db.String(100), nullable=True)  # staff name
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Appeal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_phone = db.Column(db.String(20), nullable=False)
    customer_name = db.Column(db.String(100), nullable=False)
    message = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), default='pending')  # pending, approved, rejected
    owner_response = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
