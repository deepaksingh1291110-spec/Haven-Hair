# ============================================================
# HAVEN HAIR — db.py
# Database core — shared by all route files
#
# Sections:
#   1.  Imports & config
#   2.  DB connection helpers  (get_db, close_db, query, mutate)
#   3.  Password hashing
#   4.  Row conversion helpers (row_to_dict, rows_to_list)
#   5.  Business helpers       (haversine, next_token, calc_wait,
#                               apply_penalty, mask_phone)
#   6.  Table definitions      (init_db)
#   7.  Migration              (migrate_db — safe to run on existing DBs)
#   8.  Sample data            (_insert_sample_data)
# ============================================================


# ---- 1. Imports & config ---------------------------------

import sqlite3
import hashlib
import math
import random
from datetime import datetime
from flask import g

DB_PATH = 'haven.db'


# ---- 2. DB connection helpers ----------------------------

def get_db():
    """Open one DB connection per request, reuse if already open."""
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(e=None):
    """Close DB at end of request — registered in main.py teardown."""
    db = g.pop('db', None)
    if db:
        db.close()


def query(sql, args=(), one=False):
    """Run a SELECT. Returns one row or a list of rows."""
    cur = get_db().execute(sql, args)
    rv  = cur.fetchall()
    return (rv[0] if rv else None) if one else rv


def mutate(sql, args=()):
    """Run INSERT / UPDATE / DELETE. Returns lastrowid."""
    db  = get_db()
    cur = db.execute(sql, args)
    db.commit()
    return cur.lastrowid


# ---- 3. Password hashing ---------------------------------

def hash_pw(pw):
    """SHA-256 password hash."""
    return hashlib.sha256(pw.encode()).hexdigest()


# ---- 4. Row conversion helpers ---------------------------

def row_to_dict(row):
    """Convert a single sqlite3.Row to a plain dict."""
    return dict(row) if row else None


def rows_to_list(rows):
    """Convert a list of sqlite3.Row objects to a list of dicts."""
    return [dict(r) for r in rows]


# ---- 5. Business helpers ---------------------------------

def haversine(lat1, lon1, lat2, lon2):
    """Straight-line distance between two GPS coordinates in km."""
    R     = 6371
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a     = (math.sin(d_lat / 2) ** 2
             + math.cos(math.radians(lat1))
             * math.cos(math.radians(lat2))
             * math.sin(d_lon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))

# db.py — next_token()
# BEFORE: datetime.now() returns LOCAL server time.
# AFTER:  datetime.utcnow() matches the UTC timestamps
#         stored in every created_at column.
# One word change. All date comparisons are now consistent.

def next_token(shop_id):
    """
    Random 4-digit token (1000-9999) unique within shop's active queue today.
    Falls back to sequential if all random attempts fail (near-impossible in practice).
    Uses UTC date to match created_at values stored via CURRENT_TIMESTAMP / utcnow().
    """
    today = datetime.utcnow().strftime('%Y-%m-%d')  # ✅ was datetime.now()
    used  = set(
        r[0] for r in get_db().execute(
            """SELECT token FROM queue
               WHERE shop_id=? AND date(created_at)=?
                 AND status IN ('waiting','active')""",
            (shop_id, today)
        ).fetchall()
    )
    for _ in range(200):
        token = random.randint(1000, 9999)
        if token not in used:
            return token
    return 1000 + len(used)   # fallback — sequential offset from 1000


def calc_wait(shop_id, chair_id, avg_mins=20):
    """Estimated wait time in minutes for a new entry on a given chair."""
    count = query(
        "SELECT COUNT(*) as c FROM queue WHERE shop_id=? AND chair_id=? AND status='waiting'",
        (shop_id, chair_id), one=True
    )
    return (count['c'] if count else 0) * avg_mins


def mask_phone(phone):
    """
    Mask a phone number for display before booking is accepted.
    e.g. '0501234567' → '050*****67'
    """
    if not phone or len(phone) < 5:
        return '***'
    return phone[:3] + '*' * (len(phone) - 5) + phone[-2:]


def apply_penalty(phone, points):
    """
    Apply a behaviour penalty to a customer.

    Phase 1 — Normal mode (behaviour_score > 0):
        Deduct `points` from behaviour_score.
        If score reaches 0 for the first time: enter credit mode,
        set credit_points = 50, show warning.

    Phase 2 — Credit mode (behaviour_score == 0, credit_points > 0):
        Deduct `points` from credit_points.
        If credit_points reaches 0: permanent ban.

    Returns dict with keys: warned (bool), banned (bool), credits (int|None)
    """
    if not phone:
        return {'warned': False, 'banned': False}

    row = query(
        'SELECT behaviour_score, credit_points, is_banned FROM customers WHERE phone=?',
        (phone,), one=True
    )
    if not row:
        return {'warned': False, 'banned': False}

    # ✅ Early exit — customer already permanently banned.
    # No DB writes needed. Return banned=True so callers know the
    # current state, but this action did NOT cause the ban.
    if row['is_banned']:
        return {'warned': False, 'banned': True, 'already_banned': True}

    score   = row['behaviour_score']
    credits = row['credit_points']

    if score > 0:
        # Normal mode — deduct from behaviour score
        new_score = max(0, score - points)
        mutate('UPDATE customers SET behaviour_score=? WHERE phone=?', (new_score, phone))

        if new_score < 20 and credits == 0:
            # Score critically low — enter credit mode
            mutate('UPDATE customers SET credit_points=50 WHERE phone=?', (phone,))
            return {'warned': True, 'banned': False, 'credits': 50}

        return {'warned': False, 'banned': False}

    else:
        # Credit mode — score already 0, deduct from credit points
        new_credits = max(0, credits - points)
        if new_credits <= 0:
            mutate(
                'UPDATE customers SET credit_points=0, is_banned=1 WHERE phone=?',
                (phone,)
            )
            return {'warned': True, 'banned': True, 'credits': 0}
        else:
            mutate('UPDATE customers SET credit_points=? WHERE phone=?', (new_credits, phone))
            return {'warned': True, 'banned': False, 'credits': new_credits}


# ---- 6. Table definitions --------------------------------

def init_db():
    """Create all tables and insert sample data on first run."""
    db = sqlite3.connect(DB_PATH)

    db.executescript('''

        CREATE TABLE IF NOT EXISTS customers (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT    NOT NULL,
            phone           TEXT    UNIQUE NOT NULL,
            behaviour_score INTEGER DEFAULT 100,
            credit_points   INTEGER DEFAULT 0,
            is_banned       INTEGER DEFAULT 0,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS owners (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            phone         TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shops (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id                 INTEGER,
            name                     TEXT NOT NULL,
            address                  TEXT,
            lat                      REAL,
            lon                      REAL,
            status                   TEXT DEFAULT 'open',
            reputation_score         INTEGER DEFAULT 75,
            home_service             INTEGER DEFAULT 0,
            rules_text               TEXT,
            rules_version            INTEGER DEFAULT 1,
            home_service_rules_text  TEXT,
            owner_phone              TEXT,
            FOREIGN KEY (owner_id) REFERENCES owners(id)
        );

        CREATE TABLE IF NOT EXISTS services (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id       INTEGER NOT NULL,
            service       TEXT NOT NULL,
            icon          TEXT DEFAULT '✂️',
            price         REAL,
            duration_mins INTEGER DEFAULT 20,
            FOREIGN KEY (shop_id) REFERENCES shops(id)
        );

        CREATE TABLE IF NOT EXISTS chairs (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id       INTEGER NOT NULL,
            barber_name   TEXT NOT NULL,
            phone         TEXT,
            password_hash TEXT,
            home_service  INTEGER DEFAULT 0,
            status        TEXT DEFAULT 'open',
            is_active     INTEGER DEFAULT 1,
            FOREIGN KEY (shop_id) REFERENCES shops(id)
        );

        CREATE TABLE IF NOT EXISTS queue (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id    INTEGER NOT NULL,
            chair_id   INTEGER,
            token      INTEGER,
            name       TEXT NOT NULL,
            phone      TEXT,
            service    TEXT,
            status     TEXT DEFAULT 'waiting',
            strikes    INTEGER DEFAULT 0,
            source     TEXT DEFAULT 'booking',
            sat_at     TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id)
        );

        CREATE TABLE IF NOT EXISTS service_averages (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id      INTEGER NOT NULL,
            chair_id     INTEGER NOT NULL,
            service      TEXT    NOT NULL,
            avg_mins     REAL    NOT NULL,
            sample_count INTEGER DEFAULT 0,
            updated_at   TIMESTAMP,
            UNIQUE(shop_id, chair_id, service),
            FOREIGN KEY (shop_id)  REFERENCES shops(id),
            FOREIGN KEY (chair_id) REFERENCES chairs(id)
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id       INTEGER NOT NULL,
            customer_name TEXT,
            phone         TEXT,
            rating        INTEGER NOT NULL,
            comment       TEXT,
            verified      INTEGER DEFAULT 0,
            replied       INTEGER DEFAULT 0,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id)
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id        INTEGER NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_name  TEXT,
            review_id      INTEGER,
            star_rating    INTEGER,
            wait_mins      INTEGER,
            review_text    TEXT,
            ai_topic       TEXT,
            created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(shop_id, customer_phone),
            FOREIGN KEY (shop_id) REFERENCES shops(id)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER,
            shop_id         INTEGER NOT NULL,
            customer_phone  TEXT NOT NULL,
            customer_name   TEXT,
            sender          TEXT NOT NULL,
            message         TEXT NOT NULL,
            is_read         INTEGER DEFAULT 0,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        );

        CREATE TABLE IF NOT EXISTS home_service_requests (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_id             INTEGER NOT NULL,
            customer_name       TEXT NOT NULL,
            customer_phone      TEXT NOT NULL,
            address             TEXT,
            lat                 REAL,
            lon                 REAL,
            service             TEXT,
            note                TEXT,
            status              TEXT DEFAULT 'pending',
            staff_phone         TEXT,
            accepted_by_chair_id INTEGER,
            arrival_time        TEXT,
            created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (shop_id) REFERENCES shops(id)
        );

    ''')

    if not db.execute('SELECT 1 FROM shops LIMIT 1').fetchone():
        _insert_sample_data(db)

    db.commit()
    db.close()


# ---- 7. Migration — safe to run on existing DBs ----------

def migrate_db():
    """
    Add new columns introduced by the fixes to an existing database.
    Each ALTER TABLE is wrapped in try/except so reruns are harmless.
    """
    db = sqlite3.connect(DB_PATH)
    migrations = [
        "ALTER TABLE customers ADD COLUMN credit_points INTEGER DEFAULT 0",
        "ALTER TABLE customers ADD COLUMN is_banned INTEGER DEFAULT 0",
        "ALTER TABLE shops ADD COLUMN home_service_rules_text TEXT",
        "ALTER TABLE home_service_requests ADD COLUMN lat REAL",
        "ALTER TABLE home_service_requests ADD COLUMN lon REAL",
        "ALTER TABLE home_service_requests ADD COLUMN arrival_time TEXT",
        "ALTER TABLE home_service_requests ADD COLUMN accepted_by_chair_id INTEGER",
        "ALTER TABLE queue ADD COLUMN done_at TIMESTAMP",
        "CREATE TABLE IF NOT EXISTS service_averages (id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER NOT NULL, chair_id INTEGER NOT NULL, service TEXT NOT NULL, avg_mins REAL NOT NULL, sample_count INTEGER DEFAULT 0, updated_at TIMESTAMP, UNIQUE(shop_id, chair_id, service))",
        "ALTER TABLE home_service_requests ADD COLUMN otp TEXT",
        "CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, subscription TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"

    ]
    for sql in migrations:
        try:
            db.execute(sql)
        except Exception:
            pass   # column already exists — ignore
    db.commit()
    db.close()


# ---- 8. Sample data --------------------------------------

def _insert_sample_data(db):
    """
    Populate the DB with realistic demo data for development.
    Owner password  : 123456
    Staff password  : staff123
    """

    # Owners
    db.execute(
        'INSERT INTO owners (name,phone,password_hash) VALUES (?,?,?)',
        ('Ahmed Al-Rashid', '0501234567', hash_pw('123456'))
    )
    db.execute(
        'INSERT INTO owners (name,phone,password_hash) VALUES (?,?,?)',
        ('Sara Al-Mutairi', '0502223344', hash_pw('123456'))
    )

    # Shops (owner_id matches owners above)
    shops = [
        ('Royal Cuts Studio', 'King Fahad Road, Riyadh',
         24.7136, 46.6753, 'open', 95, 0,
         'Welcome to Royal Cuts!\n\n'
         '• Be on time for your slot\n'
         '• No phone calls during haircut\n'
         '• Children must be accompanied by an adult\n'
         '• No-shows will be skipped after 5 minutes\n\n'
         'Thank you for respecting our team and other customers.',
         1, '0501234567', 1, None),

        ('Classic Barbers', 'Tahlia Street, Riyadh',
         24.6977, 46.6872, 'open', 82, 1,
         None, 1, '0509876543', 1,
         '• Home visits available within 10km\n• Min 24h advance notice required'),

        ('The Fade House', 'Olaya District, Riyadh',
         24.7230, 46.6590, 'busy', 71, 0,
         None, 1, '0505551234', 1, None),

        ("Gentlemen's Club", 'Al Nakheel Mall, Riyadh',
         24.7500, 46.7100, 'closed', 88, 0,
         "Welcome to Gentlemen's Club.\n\n"
         '• Smart casual dress code required\n'
         '• Advance booking strongly preferred\n'
         '• 10 minute grace period only\n'
         '• Fragrance-free environment — please avoid heavy perfume\n\n'
         'We appreciate your cooperation.',
         2, '0502223344', 2, None),
    ]
    for s in shops:
        db.execute(
            '''INSERT INTO shops
               (name,address,lat,lon,status,reputation_score,home_service,
                rules_text,rules_version,owner_phone,owner_id,home_service_rules_text)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''', s
        )

    # Services
    services = [
        (1,'Haircut','✂️',25,20), (1,'Beard Trim','🪒',15,10),
        (1,'Haircut + Beard','✨',35,30), (1,'Facial','💆',40,25),
        (1,'Kids Cut','👦',20,15), (1,'Color','🎨',60,45),

        (2,'Haircut','✂️',20,20), (2,'Beard Trim','🪒',12,10),
        (2,'Haircut + Beard','✨',28,30), (2,'Home Visit','🏠',50,40),

        (3,'Haircut','✂️',22,20), (3,'Fade','⚡',25,25),
        (3,'Beard','🪒',14,10),   (3,'Kids Cut','👦',18,15),

        (4,'Haircut','✂️',30,20), (4,'Beard Trim','🪒',20,10),
        (4,'Hot Towel Shave','🔥',45,35), (4,'Haircut + Beard','✨',45,30),
    ]
    for s in services:
        db.execute(
            'INSERT INTO services (shop_id,service,icon,price,duration_mins) VALUES (?,?,?,?,?)', s
        )

    # Chairs — all with phone + password for staff login
    chairs = [
        (1,'Ahmed',    '0501111111', hash_pw('staff123'), 0),
        (1,'Mohammed', '0501111112', hash_pw('staff123'), 0),
        (1,'Khalid',   '0501111113', hash_pw('staff123'), 0),
        (2,'Omar',     '0502111111', hash_pw('staff123'), 1),
        (2,'Hassan',   '0502111112', hash_pw('staff123'), 0),
        (3,'Faisal',   '0503111111', hash_pw('staff123'), 0),
        (3,'Ali',      '0503111112', hash_pw('staff123'), 0),
        (4,'Saud',     '0504111111', hash_pw('staff123'), 0),
        (4,'Ibrahim',  '0504111112', hash_pw('staff123'), 0),
    ]
    for c in chairs:
        db.execute(
            '''INSERT INTO chairs
               (shop_id,barber_name,phone,password_hash,home_service)
               VALUES (?,?,?,?,?)''', c
        )

    # Queue (shop 1 demo) — tokens are now 4-digit
    queue_entries = [
        (1,1,1423,'Mohammed Al-Ghamdi','0501001001','Haircut',   'waiting'),
        (1,2,2871,'Abdullah Saad',     '0501001002','Beard Trim','waiting'),
        (1,1,3156,'Khalid Hassan',     '',           'Fade',      'active'),
        (1,3,4019,'Fahad Omar',        '0501001004','Kids Cut',  'waiting'),
        (1,2,5342,'Nasser Al-Qahtani', '0501001005','Haircut',   'waiting'),
    ]
    for q in queue_entries:
        db.execute(
            '''INSERT INTO queue
               (shop_id,chair_id,token,name,phone,service,status)
               VALUES (?,?,?,?,?,?,?)''', q
        )

    # Reviews
    reviews = [
        (1,'Fahad', '0503333333',5,'Amazing — very professional!',           1,0),
        (1,'Saad',  '0504444444',4,'Good haircut, slight wait.',              1,0),
        (1,'Turki', '0505555555',5,'Best barber in Riyadh without a doubt.',  1,0),
        (1,'Sara',  '0506666666',2,'Waited 40 minutes with no update.',       1,1),
        (1,'Majed', '0507777777',3,'Haircut was ok but forgot my beard.',     1,0),
        (2,'Nasser','0508888888',4,'Clean shop, friendly staff.',             1,0),
        (3,'Waleed','0509999999',3,'Fade was ok but took too long.',          1,0),
    ]
    for r in reviews:
        db.execute(
            '''INSERT INTO reviews
               (shop_id,customer_name,phone,rating,comment,verified,replied)
               VALUES (?,?,?,?,?,?,?)''', r
        )

    # Conversation — Sara's 2-star complaint (demo inbox)
    db.execute(
        '''INSERT INTO conversations
           (shop_id,customer_phone,customer_name,star_rating,
            wait_mins,review_text,ai_topic)
           VALUES (?,?,?,?,?,?,?)''',
        (1,'0506666666','Sara',2,40,
         'Waited 40 minutes with no update.',
         'wait time')
    )

    # Messages — demo thread between owner and Sara
    msgs = [
        (1,1,'0506666666','Sara','owner',
         'Hi Sara, i saw ur review and i really sorry for the wait. '
         'we had unexpected issue that day. will do better next time inshallah'),
        (1,1,'0506666666','Sara','customer',
         'ok thank you for replying, i appreciate that'),
        (1,1,'0506666666','Sara','owner',
         'next time u come ask for ahmed he is very fast, '
         'and i will give u discount as sorry'),
    ]
    for m in msgs:
        db.execute(
            '''INSERT INTO messages
               (conversation_id,shop_id,customer_phone,customer_name,sender,message)
               VALUES (?,?,?,?,?,?)''', m
        )
