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

# --- Flask / Session config ---
app.config.update(
    SECRET_KEY=os.environ.get("FLASK_SECRET", "change_me"),
    SESSION_TYPE="filesystem",
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    SESSION_COOKIE_SAMESITE="Lax",   # good for localhost http
    SESSION_COOKIE_SECURE=False,     # set True only when serving over HTTPS
)
Session(app)

# --- CORS config (single place) ---
# Allow the React dev server to call /api/* and send cookies
CORS(
    app,
    resources={r"/api/*": {"origins": ["http://localhost:5173"]}},
    supports_credentials=True,
)

# Extra safety: fallback CORS headers for all responses (should rarely be needed)
@app.after_request
def add_cors_headers(resp):
    resp.headers.setdefault("Access-Control-Allow-Origin", "http://localhost:5173")
    resp.headers.setdefault("Access-Control-Allow-Credentials", "true")
    resp.headers.setdefault("Vary", "Origin")
    return resp

# ---------- landing ----------
@app.get("/")
def landing():
    return jsonify(
        ok=True,
        service="expert-survey-backend",
        message="Backend is live. Use the /api/* endpoints.",
        endpoints=["/api/health", "/api/get_user", "/api/patients", "/api/patient", "/api/claim", "/api/release", "/api/submit_prediction", "/api/update_prediction", "/api/csv"]
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
    return jsonify(rec)

# ---------- claim / release ----------
@app.post("/api/claim")
def claim_patient():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="no user"), 401

    data = request.get_json(silent=True) or {}
    row = int(data.get("row", 0))

    #auto-release a previous in-progress claim by the same user
    prev = data.get("prev_row")
    if prev is not None:
        try:
            sheets.release_row(int(prev), user.get("email", ""))
        except Exception:
            pass

    res = sheets.claim_row(row, user.get("email", ""))
    if not res.get("ok"):
        return jsonify(res), 400
    return jsonify(res)

@app.post("/api/release")
def release_patient():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="no user"), 401
    data = request.get_json(silent=True) or {}
    row = int(data.get("row", 0))
    res = sheets.release_row(row, user.get("email", ""))
    if not res.get("ok"):
        return jsonify(res), 400
    return jsonify(res)


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
        "name": user["name"],
        "email": user["email"],
        "outcome": data.get("outcome"),
        "confidence": data.get("confidence"),
        "snot22": data.get("snot22"),
    }
    ok = sheets.submit_prediction(row, payload)
    if not ok:
        return jsonify(ok=False, error="not allowed or locked by another"), 400
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