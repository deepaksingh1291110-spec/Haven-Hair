# ============================================================
# HAVEN HAIR — main.py
# Application entry point
#
# Sections:
#   1.  Imports
#   2.  App init
#   3.  Register blueprints
#   4.  DB teardown
#   5.  Run
#
# Project structure:
#   main.py              ← this file
#   db.py                ← database helpers, tables, sample data
#   routes/
#     __init__.py        ← empty — makes routes a package
#     pages.py           ← all HTML page routes
#     auth.py            ← register + login for all user types
#     shops.py           ← shops, services, chairs, maps, branches
#     queue.py           ← queue join, sit, done, skip, clear
#     messages.py        ← customer messages + owner inbox
#     reports.py         ← weekly reports + reviews
#     customer.py        ← customer profile, history, account
#
# To run:
#   python main.py
#
# First run creates haven.db with tables + sample data.
# Owner login  : phone=0501234567  password=123456
# Staff login  : phone=0501111111  password=staff123
# ============================================================


# ---- 1. Imports ------------------------------------------

import os
from flask import Flask
from db import init_db, close_db, migrate_db

from routes.pages    import pages_bp
from routes.auth     import auth_bp
from routes.shops    import shops_bp
from routes.queue    import queue_bp
from routes.messages import messages_bp
from routes.reports  import reports_bp
from routes.customer    import customer_bp
from routes.homeservice import homeservice_bp
from predictions import start_scheduler
from routes.notifications import notifications_bp
# ---- 2. App init -----------------------------------------

app = Flask(__name__)


# ---- 3. Register blueprints ------------------------------

app.register_blueprint(pages_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(shops_bp)
app.register_blueprint(queue_bp)
app.register_blueprint(messages_bp)
app.register_blueprint(reports_bp)
app.register_blueprint(customer_bp)
app.register_blueprint(homeservice_bp)
app.register_blueprint(notifications_bp)

# ---- 4. DB teardown --------------------------------------

@app.teardown_appcontext
def teardown_db(e=None):
    close_db(e)


# ---- 5. Run ----------------------------------------------

if __name__ == '__main__':
    init_db()
    migrate_db()
    start_scheduler(app)
    port = int(os.environ.get('PORT', 5000))
    print('✅  Haven Hair backend ready')
    print(f'    Owner    → http://0.0.0.0:{port}/owner/auth')
    print(f'    Customer → http://0.0.0.0:{port}/customer/auth')
    print(f'    Staff    → http://0.0.0.0:{port}/owner/auth  (staff tab)')
    app.run(host='0.0.0.0', port=port, debug=False)
