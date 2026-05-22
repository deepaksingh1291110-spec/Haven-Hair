import os, requests

ONESIGNAL_APP_ID = '9afdf56a-54d7-467c-85b0-ab4930dbf0e1'
ONESIGNAL_API_KEY = os.environ.get('os_v2_app_tl67k2su25dhzbnqvnetbw7q4hrts5mn53medk4evzjcemzcx7ugmyefmlwf7wovlxhypu7fk6pperf6ea7fuiyv5rmqmgq72thsqkq', '')

def send_push(title, message, target_id=None, data=None):
    if not ONESIGNAL_API_KEY: return
    payload = {
        "app_id": ONESIGNAL_APP_ID,
        "headings": {"en": title},
        "contents": {"en": message},
    }
    if data: payload["data"] = data
    if target_id:
        payload["include_aliases"] = {"external_id": [str(target_id)]}
        payload["target_channel"] = "push"
    else:
        payload["included_segments"] = ["All"]
    try:
        requests.post("https://onesignal.com/api/v1/notifications",
            json=payload,
            headers={"Authorization": f"Basic {os_v2_app_tl67k2su25dhzbnqvnetbw7q4hrts5mn53medk4evzjcemzcx7ugmyefmlwf7wovlxhypu7fk6pperf6ea7fuiyv5rmqmgq72thsqkq}","Content-Type":"application/json"},
            timeout=5)
    except: pass

def notify_customer_seated(phone, shop, barber):
    send_push("✂️ Your turn!", f"Take your seat at {shop} — {barber} is ready!", target_id=phone)

def notify_customer_turn(phone, pos, shop):
    if pos <= 2:
        send_push("⏰ Almost your turn!", f"#{pos} in queue at {shop}. Head over now!", target_id=phone)

def notify_owner_new_customer(owner_id, name, shop):
    send_push("👤 New customer", f"{name} joined queue at {shop}", target_id=f"owner_{owner_id}")

def notify_owner_flagged(owner_id, name, score):
    send_push("⚠️ Flagged customer", f"{name} joined (score: {score}). Monitor carefully.", target_id=f"owner_{owner_id}")

def notify_customer_message(phone, shop):
    send_push(f"💬 {shop}", "Your barber sent you a message", target_id=phone)
