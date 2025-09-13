import os, json, csv, io
from datetime import datetime, timedelta, timezone

import gspread
from oauth2client.service_account import ServiceAccountCredentials
from dotenv import load_dotenv

# ---- configuration / auth ----
load_dotenv()

SHEET_ID = os.environ["SHEET_ID"]
SHEET_TAB = os.environ.get("SHEET_TAB", "Sheet1")

_SCOPE = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

_GC = None
_WS = None


def _gc():
    global _GC
    if _GC:
        return _GC
    if os.environ.get("GCP_SERVICE_ACCOUNT_JSON", "").strip():
        info = json.loads(os.environ["GCP_SERVICE_ACCOUNT_JSON"])
        creds = ServiceAccountCredentials.from_json_keyfile_dict(info, _SCOPE)
    else:
        creds = ServiceAccountCredentials.from_json_keyfile_name(
            "service_account.json", _SCOPE
        )
    _GC = gspread.authorize(creds)
    return _GC


def _ws():
    global _WS
    if _WS:
        return _WS
    _WS = _gc().open_by_key(SHEET_ID).worksheet(SHEET_TAB)
    return _WS


# ---- header helpers ----
# We will ensure these columns exist; names must match your sheet header row.
REQUIRED_COLS = [
    "expert_prediction",
    "expert_confidence",
    "expert_SNOT22score_prediction",
    "reviewer_name",
    "reviewer_email",
    "submission_status",
    "claimed_by",
    "claimed_at",
    "edit_count",
    "last_edited_at",
]

TTL_MINUTES = int(os.environ.get("CLAIM_TTL_MINUTES", "30"))


def _header_and_map():
    """Return (header_list, name->index_map[1-based]). Ensures REQUIRED_COLS exist."""
    ws = _ws()
    header = ws.row_values(1)
    name_to_idx = {name.strip(): i + 1 for i, name in enumerate(header)}

    # Add any missing columns at the end of the header row.
    missing = [c for c in REQUIRED_COLS if c not in name_to_idx]
    if missing:
        start_col = len(header) + 1
        # Ensure the sheet has enough columns
        need_cols = len(header) + len(missing)
        if ws.col_count < need_cols:
            ws.add_cols(need_cols - ws.col_count)
        # Write the missing headers
        ws.update(
            gspread.utils.rowcol_to_a1(1, start_col),
            [missing],
        )
        # Refresh header and index map
        header = ws.row_values(1)
        name_to_idx = {name.strip(): i + 1 for i, name in enumerate(header)}

    return header, name_to_idx


def _val_bool(v):
    s = str(v).strip().lower()
    return s in {"1", "true", "yes", "y", "submitted", "done"}


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _is_stale(when_iso):
    try:
        dt = datetime.fromisoformat(when_iso)
    except Exception:
        return True
    return datetime.now(timezone.utc) - dt > timedelta(minutes=TTL_MINUTES)


# ---- public helpers used by app.py ----
def list_patients(current_user_email=None):
    ws = _ws()
    header, h = _header_and_map()
    values = ws.get_all_values()
    out = []

    for r_idx in range(2, len(values) + 1):
        row_vals = values[r_idx - 1]

        def get(col_name):
            idx = h.get(col_name)
            if not idx:
                return ""
            if idx - 1 < len(row_vals):
                return row_vals[idx - 1]
            return ""

        submitted = _val_bool(get("submission_status"))
        claimed_by = get("claimed_by") or ""
        claimed_at = get("claimed_at") or ""
        available = not submitted and (
            not claimed_by or claimed_by == (current_user_email or "")
        )
        locked_by_you = claimed_by == (current_user_email or "") and not submitted
        reviewer = get("reviewer_email").strip().lower()
        can_edit = submitted and current_user_email and (reviewer == (current_user_email or "").strip().lower())

        out.append(
            {
                "row": r_idx,
                "submitted": submitted,
                "available": bool(available),
                "locked_by_you": bool(locked_by_you),
                "claimed_by": claimed_by,
                "claimed_at": claimed_at,
                "can_edit": bool(can_edit),
            }
        )
    return out


def get_patient(row_num: int):
    ws = _ws()
    header, h = _header_and_map()
    row_vals = ws.row_values(row_num)

    record = {}
    for key in header:
        val = ""
        idx = h.get(key)
        if idx and idx - 1 < len(row_vals):
            val = row_vals[idx - 1]
        if val != "":
            record[key] = val

    submitted = _val_bool(record.get("submission_status", ""))
    record["submitted"] = submitted

    return {"row": row_num, "record": record}


def claim_row(row_num: int, email: str, prev_row: int = None):
    ws = _ws()
    header, h = _header_and_map()

    if row_num is None or row_num < 2:
        return {"ok": False, "error": "bad row"}

    # Release a previous claim by the same user (navigation change), if provided
    if prev_row and prev_row != row_num:
        _safe_release(ws, h, prev_row, email)

    claimed_by = ws.cell(row_num, h["claimed_by"]).value or ""
    claimed_at = ws.cell(row_num, h["claimed_at"]).value or ""
    submitted = _val_bool(ws.cell(row_num, h["submission_status"]).value)

    if submitted:
        return {"ok": False, "error": "already completed"}

    if claimed_by and claimed_by != email:
        return {"ok": False, "error": "locked by another reviewer"}

    # Assign claim to this user
    ws.update_cell(row_num, h["claimed_by"], email or "")
    ws.update_cell(row_num, h["claimed_at"], _now_iso())
    return {"ok": True}


def _safe_release(ws, h, row_num, email):
    """Clear claim if the same user holds it and it's not submitted."""
    try:
        submitted = _val_bool(ws.cell(row_num, h["submission_status"]).value)
        if submitted:
            return
        if (ws.cell(row_num, h["claimed_by"]).value or "") == (email or ""):
            ws.update_cell(row_num, h["claimed_by"], "")
            ws.update_cell(row_num, h["claimed_at"], "")
    except Exception:
        pass


def release_row(row_num: int, email: str):
    ws = _ws()
    header, h = _header_and_map()
    _safe_release(ws, h, row_num, email)
    return {"ok": True}


def release_stale_claims():
    # stale-claim auto-release disabled
    return


def submit_prediction(row_num: int, payload: dict) -> bool:
    """Write reviewer + prediction fields, mark as submitted, and clear claim."""
    ws = _ws()
    header, h = _header_and_map()

    # Only allow the same user who claimed to submit (if a claim exists)
    claimed_by = ws.cell(row_num, h["claimed_by"]).value or ""
    if claimed_by and claimed_by != payload.get("email", ""):
        return False

    ws.update_cell(row_num, h["reviewer_name"], payload.get("name", ""))
    ws.update_cell(row_num, h["reviewer_email"], payload.get("email", ""))
    ws.update_cell(row_num, h["expert_prediction"], str(payload.get("outcome", "")))
    ws.update_cell(row_num, h["expert_confidence"], payload.get("confidence", ""))
    ws.update_cell(
        row_num, h["expert_SNOT22score_prediction"], str(payload.get("snot22", ""))
    )
    ws.update_cell(row_num, h["submission_status"], "submitted")

    # Clear claim when submitted
    ws.update_cell(row_num, h["claimed_by"], "")
    ws.update_cell(row_num, h["claimed_at"], "")
    return True


def update_prediction(row_num: int, payload: dict) -> dict:
    ws = _ws()
    header, h = _header_and_map()

    # Check row exists
    try:
        row_vals = ws.row_values(row_num)
    except Exception:
        return {"ok": False, "error": "row not found"}

    # Get submission_status and reviewer_email
    submission_status = ""
    reviewer_email = ""
    if h.get("submission_status") and h.get("reviewer_email"):
        submission_status = ws.cell(row_num, h["submission_status"]).value or ""
        reviewer_email = ws.cell(row_num, h["reviewer_email"]).value or ""
    else:
        return {"ok": False, "error": "required columns missing"}

    if submission_status.strip().lower() != "submitted":
        return {"ok": False, "error": "not submitted"}

    if reviewer_email.strip().lower() != payload.get("email", "").strip().lower():
        return {"ok": False, "error": "email mismatch"}

    # Update prediction fields
    ws.update_cell(row_num, h["expert_prediction"], str(payload.get("outcome", "")))
    ws.update_cell(row_num, h["expert_confidence"], payload.get("confidence", ""))
    ws.update_cell(
        row_num, h["expert_SNOT22score_prediction"], str(payload.get("snot22", ""))
    )

    # Increment edit_count
    edit_count_val = "0"
    if h.get("edit_count"):
        edit_count_val = ws.cell(row_num, h["edit_count"]).value or "0"
    try:
        edit_count = int(edit_count_val)
    except Exception:
        edit_count = 0
    edit_count += 1
    if h.get("edit_count"):
        ws.update_cell(row_num, h["edit_count"], str(edit_count))

    # Update last_edited_at
    if h.get("last_edited_at"):
        ws.update_cell(row_num, h["last_edited_at"], _now_iso())

    return {"ok": True}


def get_csv() -> str:
    ws = _ws()
    data = ws.get_all_values()
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in data:
        writer.writerow(row)
    return buf.getvalue()