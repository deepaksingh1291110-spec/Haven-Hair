import os
from flask_jwt_extended import JWTManager

jwt = JWTManager()

def init_jwt(app):
    app.config['JWT_SECRET_KEY'] = 'haven-hair-secret-change-in-production'
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = False  # No expiry for now
    jwt.init_app(app)
