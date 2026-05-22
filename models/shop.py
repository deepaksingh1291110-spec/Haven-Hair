from database import db
from datetime import datetime

class Owner(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), unique=True, nullable=False)
    password_hash = db.Column(db.String(64), nullable=False)
    token = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    branches = db.relationship('Branch', backref='owner', lazy=True)

class Branch(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('owner.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    address = db.Column(db.String(200), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    phone = db.Column(db.String(20), nullable=True)
    status = db.Column(db.String(20), default='active')  # active, paused, closed
    reputation_score = db.Column(db.Float, default=70.0)
    # Settings
    haircut_price = db.Column(db.Float, default=0.0)
    beard_price = db.Column(db.Float, default=0.0)
    both_price = db.Column(db.Float, default=0.0)
    kids_price = db.Column(db.Float, default=0.0)
    color_price = db.Column(db.Float, default=0.0)
    facial_price = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    chairs = db.relationship('Chair', backref='branch', lazy=True)

class Chair(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branch.id'), nullable=False)
    barber_name = db.Column(db.String(100), nullable=False)
    status = db.Column(db.String(20), default='active')  # active, absent, paused
    absent_note = db.Column(db.String(200), nullable=True)  # "Returns tomorrow"
    avg_haircut_mins = db.Column(db.Float, default=20.0)
    avg_beard_mins = db.Column(db.Float, default=10.0)
    avg_both_mins = db.Column(db.Float, default=28.0)
    avg_facial_mins = db.Column(db.Float, default=15.0)
    avg_kids_mins = db.Column(db.Float, default=15.0)
    avg_color_mins = db.Column(db.Float, default=45.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
