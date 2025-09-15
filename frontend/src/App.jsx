import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Container, Paper, Typography, TextField, Button,
  Box, Alert, Divider, MenuItem, Select, FormControl, InputLabel,
  RadioGroup, FormControlLabel, Radio, Slider, Stack
} from "@mui/material";

// Show debug UI in dev or when explicitly enabled via env
const SHOW_DEBUG = (import.meta.env && import.meta.env.DEV) || (import.meta.env && import.meta.env.VITE_SHOW_DEBUG === 'true');

const API = "/api";
axios.defaults.withCredentials = true;
const api = axios.create({ baseURL: API, withCredentials: true });

function usePing() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    api.get("/health").then(() => setOk(true)).catch(() => setOk(false));
  }, []);
  return ok;
}

function useUser() {
  const [user, setUser] = useState(null);
  useEffect(() => {
    api.get("/get_user")
      .then((r) => setUser(r.data.user || null))
      .catch(() => setUser(null));
  }, []);
  const save = async (name, email) => {
    const r = await api.post("/set_user", { name, email });
    setUser(r.data.user);
  };
  return { user, save };
}

function usePatients() {
  const [patients, setPatients] = useState([]);
  const refresh = async () => {
    const r = await api.get("/patients");
    setPatients(r.data.patients || []);
  };
  useEffect(() => { refresh(); }, []);
  return { patients, refresh };
}

/** Clean two-column patient card (clinical fields only) */
function PatientCard({ record }) {
  if (!record) return null;

  const ADMIN = new Set([
    "expert_prediction", "expert_confidence", "expert_SNOT22score_prediction",
    "reviewer_name", "reviewer_email", "submission_status",
    "claimed_by", "claimed_at", "submitted"
  ]);

  // Optional ordering (place common items first, then the rest)
  const ORDER = [
    "Age","SEX","RACE","ETHNICITY","EDUCATION","HOUSEHOLD_INCOME",
    "PREVIOUS_SURGERY","INSURANCE","AFS","SEPT_DEV","CRS_POLYPS","RAS",
    "HYPER_TURB","MUCOCELE","ASTHMA","ASA_INTOLERANCE","ALLERGY_TESTING",
    "COPD","DEPRESSION","FIBROMYALGIA","OSA_HISTORY","SMOKER","ALCOHOL",
    "STEROID","DIABETES","GERD","BLN_CT_TOTAL","BLN_ENDOSCOPY_TOTAL","SNOT22_BLN_TOTAL","TREATMENT"
  ];

  const pretty = (k) =>
    k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

  // Build [key,value] list in ORDER first, then append any remaining non-admin fields
  const orderedKeys = ORDER.filter(k => record[k] !== undefined);
  const restKeys = Object.keys(record)
    .filter(k => !ADMIN.has(k) && !orderedKeys.includes(k))
    .sort((a,b) => a.localeCompare(b));

  const keys = [...orderedKeys, ...restKeys];

  return (
    <div className="patient-card">
      <div className="patient-grid">
        {keys.map((k) => {
          const v = record[k];
          if (v === "" || v === undefined || v === null) return null;
          return (
            <div className="patient-pair" key={k}>
              <div className="patient-label">{pretty(k)}</div>
              <div className="patient-value">{String(v)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const healthOK = usePing();
  const { user, save } = useUser();
  const { patients, refresh } = usePatients();

  const [view, setView] = useState("menu"); // menu | predict
  const [resumeDone, setResumeDone] = useState(false); // run auto-resume once
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [pickRow, setPickRow] = useState("");      // dropdown on menu & predict
  const [active, setActive] = useState(null);      // {row, record}
  const [outcome, setOutcome] = useState(0);
  const [conf, setConf] = useState("Somewhat confident");
  const [snot, setSnot] = useState(24);
  const [error, setError] = useState("");
  const [lastClaimedRow, setLastClaimedRow] = useState(null);
  const [resumedRow, setResumedRow] = useState(null);

  const apiBase = API;

  const selectedPatient = useMemo(() => {
    const r = Number(pickRow);
    if (!r) return null;
    return patients.find(p => p.row === r) || null;
  }, [pickRow, patients]);

  // Preselect first available on menu load
  useEffect(() => {
    if (user && view === "menu" && patients.length > 0) {
      const firstAvail = patients.find(p => p.available) || null;
      if (firstAvail) setPickRow(String(firstAvail.row));
    }
  }, [user, patients, view]);

  // Auto-resume (once) a row already claimed by this user
  useEffect(() => {
    if (resumeDone) return;
    if (!user || patients.length === 0) return;
    if (view !== "menu") return;
    const mine = patients.find(p => p.locked_by_you && !p.submitted);
    if (!mine) { setResumeDone(true); return; }

    const rowNum = mine.row;
    setPickRow(String(rowNum));
    (async () => {
      try {
        await api.post("/claim", { row: rowNum });
        const rec = await api.get("/patient", { params: { row: rowNum } });
        setActive(rec.data);
        setView("predict");
        setResumedRow(rowNum);
        setResumeDone(true);
      } catch {
        setResumeDone(true);
      }
    })();
  }, [user, patients, view, resumeDone]);

  // If you switch the dropdown while in predict view, load that record
  useEffect(() => {
    if (view !== "predict" || !pickRow) return;
    const rowNum = Number(pickRow);
    if (!rowNum) return;
    (async () => {
      try {
        const rec = await api.get("/patient", { params: { row: rowNum } });
        setActive(rec.data);

        const r = rec.data?.record || {};
        if (r.expert_prediction !== undefined && r.expert_prediction !== "") {
          const v = Number(r.expert_prediction);
          if (!Number.isNaN(v)) setOutcome(v);
        }
        if (r.expert_confidence) {
          setConf(String(r.expert_confidence));
        }
        if (r.expert_SNOT22score_prediction !== undefined && r.expert_SNOT22score_prediction !== "") {
          const sv = Number(r.expert_SNOT22score_prediction);
          if (!Number.isNaN(sv)) setSnot(sv);
        }
      } catch {
        setError("Failed to load patient data.");
      }
    })();
  }, [pickRow, view]);

  const claimedByYou = useMemo(() => {
    if (!active || !user) return false;
    return active.record?.claimed_by === user.email && !active.record?.submitted;
    // submitted rows should never be considered claimable
  }, [active, user]);

  const isSubmitted = !!active?.record?.submitted ||
  (String(active?.record?.submission_status || "").toLowerCase() === "submitted");

  const canEdit = useMemo(() => {
    if (!user || !active) return false;
    // Prefer the list's can_edit if present; fall back to reviewer_email match
    const fromList = patients.find(p => p.row === active.row)?.can_edit;
    if (fromList !== undefined) return !!fromList;
    return String(active.record?.reviewer_email || "").toLowerCase() === String(user.email || "").toLowerCase();
  }, [user, active, patients]);

  const formDisabled = isSubmitted && !canEdit;

  async function handleSaveUser() {
    setError("");
    try {
      await save(name.trim(), email.trim());
      await refresh();
    } catch {
      setError("Could not save user.");
    }
  }

  async function claimSelected(where = "menu") {
    setError("");
    const rowNum = Number(where === "menu" ? pickRow : active?.row);
    if (!rowNum) { setError("Please choose a patient."); return; }
    try {
      const payload = { row: rowNum };
      if (lastClaimedRow && lastClaimedRow !== rowNum) payload.prev_row = lastClaimedRow;
      await api.post("/claim", payload);
      const rec = await api.get("/patient", { params: { row: rowNum } });
      setActive(rec.data);
      setView("predict");
      setPickRow(String(rowNum));
      setLastClaimedRow(rowNum);
      setResumeDone(true);
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.error || "Unable to claim this patient.");
      await refresh();
    }
  }

  async function submitPrediction() {
    if (!active) return;
    try {
      await api.post("/submit_prediction", {
        row: active.row,
        outcome,
        confidence: conf,
        snot22: snot,
      });
      setActive(null);
      setView("menu");
      setPickRow("");
      setResumedRow(null);
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.error || "Submit failed.");
    }
  }

  async function updatePrediction() {
    if (!active) return;
    try {
      await api.post("/update_prediction", {
        row: active.row,
        outcome,
        confidence: conf,
        snot22: snot,
      });
      setActive(null);
      setView("menu");
      setPickRow("");
      setResumedRow(null);
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.error || "Update failed.");
    }
  }

  // --------- UI ---------

  // Memo for whether the selected patient is claimable
  const canClaimSelected = useMemo(() => {
    if (!user || !selectedPatient) return false;
    // Not submitted and (available or claimed by current user)
    if (selectedPatient.submitted) return false;
    return (!selectedPatient.claimed_by || selectedPatient.claimed_by === user.email);
  }, [user, selectedPatient]);

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Typography variant="h5" gutterBottom>Expert Survey</Typography>
      {SHOW_DEBUG && (
        <Typography variant="body2" sx={{ mb: 2 }}>
          API: <code>{apiBase}</code> • Health:{" "}
          {healthOK ? <span style={{color:"green"}}>Available ✅</span> : <span style={{color:"red"}}>Unavailable ❌</span>}
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* MENU VIEW */}
      {view === "menu" && (
        <Stack spacing={3}>
          {/* user card */}
          <Paper sx={{ p:2 }}>
            <Typography variant="h6" gutterBottom>User</Typography>
            {user ? (
              <Alert severity="success">
                Signed in as <strong>{user.name}</strong> ({user.email})
              </Alert>
            ) : (
              <Stack direction={{ xs:"column", sm:"row" }} spacing={1}>
                <TextField label="Name" size="small" value={name} onChange={e=>setName(e.target.value)} />
                <TextField label="Email" size="small" value={email} onChange={e=>setEmail(e.target.value)} />
                <Button variant="contained" onClick={handleSaveUser}>Save</Button>
              </Stack>
            )}
          </Paper>

          {/* patient chooser + actions */}
          <Paper sx={{ p:2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6">Patients</Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                  selectable: {patients.filter(p => (p.submitted ? false : (!p.claimed_by || (user && p.claimed_by === user.email)))).length} / total: {patients.length}
                </Typography>
                <Button size="small" onClick={refresh}>Refresh</Button>
              </Stack>
            </Stack>

            {selectedPatient?.submitted && (
              <Alert
                severity={selectedPatient.can_edit ? "info" : "error"}
                sx={{ mb: 2 }}
              >
                {selectedPatient.can_edit
                  ? "You previously submitted this patient. You can edit your submission."
                  : "This patient has already been completed."}
              </Alert>
            )}

            <Stack direction={{ xs:"column", sm:"row" }} spacing={2} alignItems="center">
              <FormControl size="small" fullWidth sx={{ minWidth: 260, mb: { xs: 1, sm: 0 } }}>
                <InputLabel id="pick-label">Choose patient (by row)</InputLabel>
                <Select
                  labelId="pick-label"
                  label="Choose patient (by row)"
                  value={pickRow}
                  onChange={(e)=>setPickRow(e.target.value)}
                  displayEmpty
                >
                  {patients.length === 0 && (
                    <MenuItem value="" disabled>(no patients loaded)</MenuItem>
                  )}

                  {patients.map(p => {
                    const label = (() => {
                      if (p.submitted) {
                        return `Row ${p.row} • submitted${user && p.can_edit ? " (yours — editable)" : ""}`;
                      }
                      if (p.claimed_by) {
                        return `Row ${p.row} • claimed by ${p.claimed_by}${p.claimed_at ? ` at ${new Date(p.claimed_at).toLocaleString()}` : ""}`;
                      }
                      return `Row ${p.row} • available`;
                    })();

                    const selectable = p.submitted
                      ? !!(user && p.can_edit)                 // allow selecting submitted rows if you can edit
                      : (!p.claimed_by || (user && p.claimed_by === user.email));

                    return (
                      <MenuItem key={p.row} value={String(p.row)} disabled={!selectable}>
                        {label}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>

              <Button
                variant="contained"
                onClick={async()=>{
                  if (!selectedPatient) return;
                  if (selectedPatient.submitted && selectedPatient.can_edit) {
                    // Load for edit without claiming
                    const r = await api.get("/patient", { params: { row: selectedPatient.row } });
                    setActive(r.data);
                    setView("predict");
                    setResumedRow(null);
                    setLastClaimedRow(null);
                  } else {
                    await claimSelected("menu");
                  }
                }}
                disabled={
                  !user ||
                  !selectedPatient ||
                  (selectedPatient.submitted
                    ? !selectedPatient.can_edit
                    : !!(selectedPatient.claimed_by && selectedPatient.claimed_by !== user?.email))
                }
              >
                {selectedPatient?.submitted ? "Edit Submission" : "Claim & Predict"}
              </Button>

              <Button
                variant="outlined"
                onClick={async()=>{
                  const r = await api.get("/csv", { responseType:"blob" });
                  const url = URL.createObjectURL(r.data);
                  const a = document.createElement("a");
                  a.href = url; a.download = "expert_predictions.csv"; a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download CSV
              </Button>
            </Stack>
          </Paper>

          {SHOW_DEBUG && (
            <Paper sx={{ p:2 }}>
              <Typography variant="h6" gutterBottom>Debug Panel</Typography>
              <pre style={{whiteSpace:"pre-wrap"}}>
{JSON.stringify({ health: { ok: healthOK }, user, patients }, null, 2)}
              </pre>
            </Paper>
          )}
        </Stack>
      )}

      {/* PREDICT VIEW */}
      {view === "predict" && (
        <Stack spacing={3}>
          <Paper sx={{ p:2 }}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="flex-start">
              <Button
                variant="outlined"
                onClick={() => {
                  setActive(null);
                  setView("menu");
                  setPickRow("");
                  setResumedRow(null);
                  setResumeDone(true);
                }}
              >
                Back to Menu
              </Button>
            </Stack>
          </Paper>

          <Paper sx={{ p:2 }}>
            {resumedRow && active?.row === resumedRow && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Resumed your in-progress patient (row {resumedRow}).
              </Alert>
            )}

            <Typography variant="h6" gutterBottom>
              Patient (row {active?.row})
            </Typography>
            {isSubmitted && canEdit && (
              <Alert severity="info" sx={{ mb: 2 }}>
                You previously submitted this patient. You can update your submission below.
              </Alert>
            )}

            {isSubmitted && !canEdit && (
              <Alert severity="error" sx={{ mb: 2 }}>
                This patient has already been completed.
              </Alert>
            )}

            {/* switch within predict */}
            <Stack direction={{ xs:"column", sm:"row" }} spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <FormControl size="small" fullWidth sx={{ minWidth: 260, mb: { xs: 1, sm: 0 } }}>
                <InputLabel id="pick2-label">Switch patient</InputLabel>
                <Select
                  labelId="pick2-label"
                  label="Switch patient"
                  value={pickRow}
                  onChange={(e)=>setPickRow(e.target.value)}
                >
                  {patients.map(p => {
                    const label = `Row ${p.row}` +
                      (p.submitted
                        ? " • submitted"
                        : p.claimed_by
                          ? ` • claimed by ${p.claimed_by}${p.claimed_at ? ` at ${new Date(p.claimed_at).toLocaleString()}` : ""}`
                          : " • available");
                    const selectable = p.submitted
                      ? false
                      : (!p.claimed_by || (user && p.claimed_by === user.email));
                    return (
                      <MenuItem key={p.row} value={String(p.row)} disabled={!selectable}>
                        {label}
                      </MenuItem>
                    );
                  })}
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                onClick={async()=>{
                  if (!selectedPatient) return;
                  if (selectedPatient.submitted && selectedPatient.can_edit) {
                    const r = await api.get("/patient", { params: { row: selectedPatient.row } });
                    setActive(r.data);
                  } else {
                    await claimSelected("predict");
                  }
                }}
                disabled={
                  !user ||
                  !pickRow ||
                  (!selectedPatient
                    ? true
                    : (selectedPatient.submitted
                        ? !selectedPatient.can_edit
                        : !!(selectedPatient.claimed_by && selectedPatient.claimed_by !== user?.email)))
                }
              >
                {selectedPatient?.submitted ? "Load For Edit" : "Claim / Load"}
              </Button>
            </Stack>

            {/* clean two-column clinical display */}
            <Box sx={{ mb: 2 }}>
              <PatientCard record={active?.record} />
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* prediction form */}
            <Typography variant="h6" sx={{ mb: 1 }}>Your prediction</Typography>

            <Typography variant="body2" sx={{ mb: 1 }}>
              Outcome (0 = Unsuccessful, 1 = Successful)
            </Typography>
            <RadioGroup row value={String(outcome)} onChange={(e)=>setOutcome(Number(e.target.value))} sx={{ mb: 2 }}>
              <FormControlLabel value="0" control={<Radio />} label="0 — Unsuccessful" disabled={formDisabled} />
              <FormControlLabel value="1" control={<Radio />} label="1 — Successful" disabled={formDisabled} />
            </RadioGroup>

            <Box sx={{ my: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>Confidence</Typography>
              <RadioGroup value={conf} onChange={(e)=>setConf(e.target.value)} sx={{ mb: 1 }}>
                {["Very confident","Somewhat confident","Neutral","Somewhat unsure","Not at all confident"].map(c =>
                  <FormControlLabel key={c} value={c} control={<Radio />} label={c} disabled={formDisabled} />
                )}
              </RadioGroup>
            </Box>

            <Box sx={{ my: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Estimated postoperative SNOT-22 at 6 months
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
                <Slider
                  min={0}
                  max={110}
                  value={snot}
                  onChange={(_, v) => setSnot(Array.isArray(v) ? v[0] : v)}
                  sx={{ maxWidth: 420 }}
                  disabled={formDisabled}
                />
                <TextField
                  size="small"
                  label="Value"
                  value={snot}
                  onChange={e=>setSnot(Number(e.target.value||0))}
                  sx={{ width: 90 }}
                  disabled={formDisabled}
                />
              </Stack>
              <Typography variant="caption">0 = no symptoms, 110 = worst.</Typography>
            </Box>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="flex-start">
              {!isSubmitted && (
                <Button variant="contained" onClick={submitPrediction} disabled={!claimedByYou}>
                  Submit
                </Button>
              )}
              {isSubmitted && canEdit && (
                <Button variant="contained" color="warning" onClick={updatePrediction}>
                  Update Previous Submission
                </Button>
              )}
              {!claimedByYou && !isSubmitted && (
                <Alert severity="info">
                  {active?.record?.claimed_by && active?.record?.claimed_by !== user?.email
                    ? `This patient is currently claimed by ${active.record.claimed_by}.`
                    : "You must claim this patient to submit."}
                </Alert>
              )}
              {isSubmitted && !canEdit && (
                <Alert severity="warning">Submission is already completed for this patient.</Alert>
              )}
            </Stack>
          </Paper>

          {SHOW_DEBUG && (
              <Paper sx={{ p:2 }}>
                <Typography variant="h6" gutterBottom>Debug Panel</Typography>
                <pre style={{whiteSpace:"pre-wrap"}}>
{JSON.stringify({ active }, null, 2)}
                </pre>
              </Paper>
            )}
        </Stack>
      )}
    </Container>
  );
}