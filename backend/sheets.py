import os, json, csv, io
from datetime import datetime, timedelta, timezone

import gspread
from oauth2client.service_account import ServiceAccountCredentials
from dotenv import load_dotenv

# ---- configuration / auth ----
load_dotenv()

SHEET_ID = os.environ["SHEET_ID"]
SHEET_TAB = os.environ.get("SHEET_TAB", "Sheet1")
SUBMISSIONS_TAB = os.environ.get("SUBMISSIONS_TAB", "Submissions")

_SCOPE = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]

_GC = None
_WS = None
_SUB_WS = None


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


def _sub_ws():
    global _SUB_WS
    if _SUB_WS:
        return _SUB_WS
    _SUB_WS = _gc().open_by_key(SHEET_ID).worksheet(SUBMISSIONS_TAB)
    return _SUB_WS


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

SUB_REQUIRED_COLS = [
    "timestamp",
    "user_email",
    "user_name",
    "patient_row",
    "outcome",
    "confidence",
    "snot22",
]


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


def _sub_header_and_map():
    """Return (header_list, name->index_map[1-based]) for Submissions. Ensures SUB_REQUIRED_COLS exist."""
    ws = _sub_ws()
    header = ws.row_values(1)
    name_to_idx = {name.strip(): i + 1 for i, name in enumerate(header)}

    # Add any missing columns at the end of the header row.
    missing = [c for c in SUB_REQUIRED_COLS if c not in name_to_idx]
    if missing:
        start_col = len(header) + 1
        need_cols = len(header) + len(missing)
        if ws.col_count < need_cols:
            ws.add_cols(need_cols - ws.col_count)
        ws.update(
            gspread.utils.rowcol_to_a1(1, start_col),
            [missing],
        )
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


def count_patients() -> int:
    """Total number of patient rows (excluding header)."""
    ws = _ws()
    values = ws.get_all_values()
    # subtract header
    return max(0, len(values) - 1)

def all_patient_rows() -> list:
    """Return sheet row numbers (1-based) for all patients (data rows start at 2)."""
    ws = _ws()
    values = ws.get_all_values()
    # data rows start at 2
    return list(range(2, len(values) + 1))

def list_user_submission_rows(email: str) -> set:
    """
    Return a set of patient_row (ints) the given user has submitted.
    Scans the Submissions tab.
    """
    if not (email or "").strip():
        return set()
    ws = _sub_ws()
    # get_all_values is efficient enough for modest sheet sizes; avoids per-row API calls
    values = ws.get_all_values()
    if not values:
        return set()
    header = values[0] if values else []
    # build indices
    try:
        i_email = header.index("user_email")
        i_row = header.index("patient_row")
    except ValueError:
        # ensure headers exist if missing
        _sub_header_and_map()
        values = ws.get_all_values()
        if not values:
            return set()
        header = values[0]
        i_email = header.index("user_email")
        i_row = header.index("patient_row")
    out = set()
    for r in values[1:]:
        if i_email < len(r) and i_row < len(r):
            if (r[i_email] or "").strip().lower() == (email or "").strip().lower():
                try:
                    out.add(int(str(r[i_row]).strip()))
                except Exception:
                    # ignore bad/missing row ids
                    pass
    return out

def get_submission(email: str, row: int):
    """
    Return the current user's submission dict for a given patient row, or None.
    Dict shape: { 'outcome': ..., 'confidence': ..., 'snot22': ... }
    """
    if not (email or "").strip():
        return None
    ws = _sub_ws()
    values = ws.get_all_values()
    if not values:
        return None
    header = values[0]
    try:
        i_email = header.index("user_email")
        i_row = header.index("patient_row")
        i_outcome = header.index("outcome")
        i_conf = header.index("confidence")
        i_snot = header.index("snot22")
    except ValueError:
        _sub_header_and_map()
        values = ws.get_all_values()
        if not values:
            return None
        header = values[0]
        i_email = header.index("user_email")
        i_row = header.index("patient_row")
        i_outcome = header.index("outcome")
        i_conf = header.index("confidence")
        i_snot = header.index("snot22")
    target_email = (email or "").strip().lower()
    target_row = int(row)
    for rec in values[1:]:
        if i_email < len(rec) and i_row < len(rec):
            if (rec[i_email] or "").strip().lower() == target_email and str(rec[i_row]).strip() == str(target_row):
                return {
                    "outcome": (rec[i_outcome] if i_outcome < len(rec) else ""),
                    "confidence": (rec[i_conf] if i_conf < len(rec) else ""),
                    "snot22": (rec[i_snot] if i_snot < len(rec) else ""),
                }
    return None

def upsert_submission(email: str, name: str, row: int, payload: dict):
    """
    Insert or update a submission identified by (user_email, patient_row).
    payload expects keys: outcome, confidence, snot22
    """
    ws = _sub_ws()
    header, h = _sub_header_and_map()
    # scan for existing
    data = ws.get_all_values()
    found_idx = None  # 1-based sheet row index of existing submission
    if len(data) > 1:
        # build quick indices
        name_to_idx = {name.strip(): i for i, name in enumerate(data[0])}
        i_email = name_to_idx.get("user_email")
        i_row = name_to_idx.get("patient_row")
        if i_email is not None and i_row is not None:
            for i in range(1, len(data)):
                rec = data[i]
                if i_email < len(rec) and i_row < len(rec):
                    if (rec[i_email] or "").strip().lower() == (email or "").strip().lower() and str(rec[i_row]).strip() == str(row):
                        found_idx = i + 1  # +1 for header row to get sheet row number
                        break
    ts = _now_iso()
    # Ensure string values
    out = {
        "timestamp": ts,
        "user_email": email or "",
        "user_name": name or "",
        "patient_row": str(row),
        "outcome": str(payload.get("outcome", "")),
        "confidence": str(payload.get("confidence", "")),
        "snot22": str(payload.get("snot22", "")),
    }
    if found_idx:
        # update in place
        # write only the columns we know about to avoid clobbering future extras
        for key in SUB_REQUIRED_COLS:
            col = h.get(key)
            if col:
                ws.update_cell(found_idx, col, out[key])
    else:
        # append as a new row preserving header order
        row_vals = [out.get(col, "") for col in header]
        ws.append_row(row_vals, value_input_option="USER_ENTERED")

def next_unsubmitted_row(email: str, after: int | None = None):
    """
    Return the next patient row that the user has not submitted yet.
    If 'after' is provided, start searching after that row (wrap around).
    """
    rows = all_patient_rows()
    if not rows:
        return None
    done = list_user_submission_rows(email)
    # rotate starting index
    start_idx = 0
    if after in rows:
        start_idx = (rows.index(after) + 1) % len(rows)
    n = len(rows)
    for i in range(n):
        idx = (start_idx + i) % n
        r = rows[idx]
        if r not in done:
            return r
    return None


def get_csv() -> str:
    ws = _ws()
    data = ws.get_all_values()
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in data:
        writer.writerow(row)
    return buf.getvalue()