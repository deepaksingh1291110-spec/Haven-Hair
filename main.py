import os
from flask import Flask, send_from_directory
from flask_cors import CORS
from database import db, init_db
from auth import jwt, init_jwt
import models.shop, models.queue, models.review
import models.user, models.staff, models.behaviour
from routes.branches import branches_bp
from routes.queue import queue_bp
from routes.reviews import reviews_bp
from routes.auth import auth_bp
from routes.maps import maps_bp
from routes.staff import staff_bp
from routes.history import history_bp
from routes.messages import messages_bp
from routes.behaviour import behaviour_bp

app = Flask(__name__, static_folder='static')

# CORS — allow all origins
CORS(app, resources={r"/*": {"origins": "*"}}, 
     supports_credentials=False)

init_db(app)
init_jwt(app)

app.register_blueprint(branches_bp)
app.register_blueprint(queue_bp)
app.register_blueprint(reviews_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(maps_bp)
app.register_blueprint(staff_bp)
app.register_blueprint(history_bp)
app.register_blueprint(messages_bp)
app.register_blueprint(behaviour_bp)

@app.route('/')
def index():
    return {'message': 'Haven Hair API 2.0 💈', 'status': 'running'}

@app.route('/web')
def web():
    return app.send_static_file('index.html')

@app.route('/customer')
def customer():
    return app.send_static_file('customer.html')

@app.route('/owner')
def owner():
    return app.send_static_file('owner.html')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
