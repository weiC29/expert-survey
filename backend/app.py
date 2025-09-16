import os
import io
from datetime import timedelta

from flask import Flask, request, session, jsonify, send_file
from flask_cors import CORS
from flask_session import Session
from dotenv import load_dotenv

load_dotenv()  # loads backend/.env

import sheets  # uses env inside

app = Flask(__name__)

# --- Flask / Session + CORS config (env-driven) ---
# Allowed frontend origins (comma-separated). Backward compatible with old ALLOW_ORIGIN.
_ORIGINS_ENV = os.environ.get("ALLOWED_ORIGINS") or os.environ.get("ALLOW_ORIGIN", "http://localhost:5173")
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in _ORIGINS_ENV.split(",") if o.strip()]

# Cookie flags: in production across domains you MUST use None/True
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "Lax")            # "Lax" (dev) or "None" (prod)
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"  # True in prod (HTTPS)

app.config.update(
    SECRET_KEY=os.environ.get("FLASK_SECRET", "change_me"),
    SESSION_TYPE="filesystem",
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    SESSION_COOKIE_SAMESITE=COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE=COOKIE_SECURE,
)

Session(app)

# CORS for API
CORS(
    app,
    resources={r"/api/*": {"origins": ALLOWED_ORIGINS}},
    supports_credentials=True,
)

@app.after_request
def add_cors_headers(resp):
    """
    Ensure CORS headers are present even if an upstream proxy strips them.
    We mirror the request's Origin only if it is explicitly allowed.
    """
    origin = (request.headers.get("Origin") or "").rstrip("/")
    if origin and origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        # make caches vary properly by Origin
        vary = resp.headers.get("Vary")
        if vary:
            if "Origin" not in vary:
                resp.headers["Vary"] = vary + ", Origin"
        else:
            resp.headers["Vary"] = "Origin"
    return resp

# ---------- landing ----------
@app.get("/")
def landing():
    return jsonify(
        ok=True,
        service="expert-survey-backend",
        message="Backend is live. Use the /api/* endpoints.",
        endpoints=["/api/health", "/api/get_user", "/api/user_progress", "/api/next_patient", "/api/patients", "/api/patient", "/api/claim", "/api/release", "/api/submit_prediction", "/api/update_prediction", "/api/csv"]
    )

# ---------- basic ----------
@app.get("/api/health")
def health():
    return jsonify(ok=True)

@app.post("/api/set_user")
def set_user():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    if not name or not email:
        return jsonify(ok=False, error="name and email required"), 400
    session["user"] = {"name": name, "email": email}
    session.permanent = True
    return jsonify(ok=True, user=session["user"])

@app.get("/api/get_user")
def get_user():
    return {"ok": True, "user": session.get("user")}

# ---------- user progress & next ----------
@app.get("/api/user_progress")
def user_progress():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="no user"), 401
    email = user.get("email")
    total = sheets.count_patients()
    completed = len(sheets.list_user_submission_rows(email))
    next_row = sheets.next_unsubmitted_row(email)
    return jsonify(ok=True, completed=completed, total=total, next_row=next_row)

@app.get("/api/next_patient")
def next_patient_route():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="no user"), 401
    email = user.get("email")
    try:
        after = request.args.get("after", default=None, type=int)
    except Exception:
        after = None
    nxt = sheets.next_unsubmitted_row(email, after=after)
    if nxt is None:
        return jsonify(ok=True, complete=True)
    rec = sheets.get_patient(nxt)
    my = sheets.get_submission(email, nxt)
    return jsonify(ok=True, row=nxt, record=rec, my_submission=my)

# ---------- patients ----------
@app.get("/api/patients")
def list_patients_route():
    user = session.get("user") or {}
    email = user.get("email")
    pts = sheets.list_patients(current_user_email=email)
    return jsonify(patients=pts)

@app.get("/api/patient")
def get_patient_route():
    try:
        row = int(request.args.get("row", "0"))
    except Exception:
        return jsonify(ok=False, error="bad row"), 400
    rec = sheets.get_patient(row)
    if not rec:
        return jsonify(ok=False, error="not found"), 404
    # Backward compatible: by default return the raw patient record (old behavior).
    include_my = request.args.get("include_my")
    if include_my in {"1", "true", "True"}:
        user = session.get("user") or {}
        email = user.get("email")
        my = sheets.get_submission(email, row) if email else None
        return jsonify({"row": row, "record": rec, "my_submission": my})
    return jsonify(rec)

# ---------- claim / release ----------
@app.post("/api/claim")
def claim_patient():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="no user"), 401
    # New model: claim is a no-op (everyone can work independently).
    return jsonify(ok=True)

@app.post("/api/release")
def release_patient():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="no user"), 401
    # New model: release is a no-op.
    return jsonify(ok=True)


@app.post("/api/update_prediction")
def update_prediction_route():
    user = session.get("user")
    if not user:
        return jsonify({"ok": False, "error": "no user"}), 401
    data = request.json or {}
    try:
        row = int(data.get("row", 0))
    except:
        return jsonify({"ok": False, "error": "bad row"}), 400

    payload = {
        "name": user["name"],
        "email": user["email"],
        "outcome": data.get("outcome"),
        "confidence": data.get("confidence"),
        "snot22": data.get("snot22"),
    }
    res = sheets.update_prediction(row, payload)
    if not res.get("ok"):
        return jsonify(res), 400
    return {"ok": True}

# ---------- submit & csv ----------
@app.post("/api/submit_prediction")
def submit_prediction_route():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="no user"), 401

    data = request.get_json(silent=True) or {}
    try:
        row = int(data.get("row", 0))
    except Exception:
        return jsonify(ok=False, error="bad row"), 400

    payload = {
        "outcome": data.get("outcome"),
        "confidence": data.get("confidence"),
        "snot22": data.get("snot22"),
    }
    try:
        sheets.upsert_submission(user["email"], user["name"], row, payload)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 400
    return jsonify(ok=True)

@app.get("/api/csv")
def csv_download():
    csv_str = sheets.get_csv()
    return send_file(
        io.BytesIO(csv_str.encode("utf-8")),
        mimetype="text/csv",
        as_attachment=True,
        download_name="expert_predictions.csv",
    )

if __name__ == "__main__":
    # Keep use_reloader False to avoid double-registering routes in dev
    app.run(host="0.0.0.0", port=5001, debug=True, use_reloader=False)