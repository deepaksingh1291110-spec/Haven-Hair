import os
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

def init_db(app):
    # Use Neon DATABASE_URL if available, else fallback to SQLite
    database_url = os.environ.get('DATABASE_URL')
    
    if database_url:
        # Neon uses postgresql:// — fix for SQLAlchemy
        if database_url.startswith('postgres://'):
            database_url = database_url.replace('postgres://', 'postgresql://', 1)
        app.config['SQLALCHEMY_DATABASE_URI'] = database_url
    else:
        # Local SQLite fallback
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///havenhair.db'
    
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }
    db.init_app(app)
    
    with app.app_context():
        db.create_all()
