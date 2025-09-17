import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Container, Paper, Typography, TextField, Button,
  Box, Alert, Divider, MenuItem, Select, FormControl, InputLabel,
  RadioGroup, FormControlLabel, Radio, Slider, Stack, Snackbar
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
  const data = (record && typeof record === "object" && "record" in record) ? record.record : record;
  if (!data) return null;

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
  const orderedKeys = ORDER.filter(k => data[k] !== undefined);
  const restKeys = Object.keys(data)
    .filter(k => !ADMIN.has(k) && !orderedKeys.includes(k))
    .sort((a,b) => a.localeCompare(b));

  const keys = [...orderedKeys, ...restKeys];

  return (
    <div className="patient-card">
      <div className="patient-grid">
        {keys.map((k) => {
          const v = data[k];
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
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [metrics, setMetrics] = useState({ users_started: 0, users_completed: 0, total_patients: 0 });
  const [allDone, setAllDone] = useState(false);
  const [doneMap, setDoneMap] = useState({});
  const [snack, setSnack] = useState({ open: false, message: "", severity: "success" });
  const [justMovedRow, setJustMovedRow] = useState(null);
  const [saving, setSaving] = useState(false);

  const markDone = (row) => {
    if (!row) return;
    setDoneMap(prev => ({ ...prev, [row]: true }));
  };
  const toast = (message, severity = "success") => {
    setSnack({ open: true, message, severity });
  };
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [pickRow, setPickRow] = useState("");      // dropdown on menu & predict
  const [active, setActive] = useState(null);      // {row, record}
  const DEFAULTS = { outcome: null, conf: "", snot: 0 };
  const [outcome, setOutcome] = useState(DEFAULTS.outcome);
  const [conf, setConf] = useState(DEFAULTS.conf);
  const [snot, setSnot] = useState(DEFAULTS.snot);
  const resetForm = () => {
    setOutcome(DEFAULTS.outcome);
    setConf(DEFAULTS.conf);
    setSnot(DEFAULTS.snot);
  };
  const [error, setError] = useState("");

  const apiBase = API;

  const selectedPatient = useMemo(() => {
    const r = Number(pickRow);
    if (!r) return null;
    return patients.find(p => p.row === r) || null;
  }, [pickRow, patients]);


  async function refreshProgress() {
    try {
      const r = await api.get("/user_progress");
      const { completed = 0, total = 0 } = r.data || {};
      setProgress({ completed, total });
    } catch {
      setProgress({ completed: 0, total: 0 });
    }
  }

  async function refreshMetrics() {
    try {
      const r = await api.get("/metrics");
      const d = r.data || {};
      setMetrics({
        users_started: d.users_started || 0,
        users_completed: d.users_completed || 0,
        total_patients: d.total_patients || 0
      });
    } catch {
      setMetrics({ users_started: 0, users_completed: 0, total_patients: 0 });
    }
  }

  function prefillFromMySubmission(rec) {
    if (rec?.row) {
      const my0 = rec?.my_submission;
      if (my0 && (my0.outcome !== undefined && my0.outcome !== "")) {
        markDone(rec.row);
      }
    }
    const my = rec?.my_submission;
    if (my && my.outcome !== undefined && my.outcome !== "") {
      const v = Number(my.outcome);
      if (!Number.isNaN(v)) setOutcome(v);
    }
    if (my && my.confidence !== undefined && my.confidence !== "") {
      setConf(String(my.confidence));
    }
    if (my && my.snot22 !== undefined && my.snot22 !== "") {
      const sv = Number(my.snot22);
      if (!Number.isNaN(sv)) setSnot(sv);
    }
  }

  async function loadPatient(rowNum) {
    setError("");
    resetForm();
    if (!rowNum) return;
    const rec = await api.get("/patient", { params: { row: rowNum, include_my: 1 } });
    setActive(rec.data);
    prefillFromMySubmission(rec.data);
    setPickRow(String(rowNum));
    setAllDone(false);
    setJustMovedRow(rowNum);
  }

  async function loadNext(afterRow = null) {
    setError("");
    resetForm();
    const r = await api.get("/next_patient", { params: { after: afterRow ?? undefined } });
    if (r.data?.complete) {
      setActive(null);
      setPickRow("");
      setAllDone(true);
      toast("All patients completed. You can review or edit any entry from the dropdown.", "success");
      return { complete: true };
    }
    setActive(r.data);
    prefillFromMySubmission(r.data);
    setPickRow(String(r.data.row));
    setAllDone(false);
    setJustMovedRow(r.data.row);
    toast(`Now on patient row ${r.data.row}.`, "info");
    return { complete: false, row: r.data.row };
  }

  // If you switch the dropdown while in predict view, load that record (and prefill from your submission)
  useEffect(() => {
    setError("");
    if (view !== "predict" || !pickRow) return;
    const rowNum = Number(pickRow);
    if (!rowNum) return;
    (async () => {
      try {
        await loadPatient(rowNum);
      } catch {
        setError("Failed to load patient data.");
      }
    })();
  }, [pickRow, view]);

  async function handleSaveUser() {
    setError("");
    try {
      await save(name.trim(), email.trim());
      await refresh();           // refresh list for dropdown
      await refreshProgress();   // load completed/total
      await refreshMetrics();
      await loadNext(null);      // load first unsubmitted
      toast("Signed in. Loaded your next patient.", "success");
      window.scrollTo({ top: 0, behavior: "smooth" });
      setView("predict");
    } catch {
      setError("Could not save user.");
    }
  }

  async function submitPrediction() {
    if (!active) return;
    setError("");
    setSaving(true);
    if (outcome === null || !conf) {
      setSaving(false);
      toast("Please select outcome and confidence before saving.", "error");
      return;
    }
    const wasUpdate = !!doneMap[active.row];
    try {
      await api.post("/submit_prediction", {
        row: active.row,
        outcome,
        confidence: conf,
        snot22: snot,
      });
      markDone(active.row);
      toast(wasUpdate ? "Updated your prediction." : "Saved your prediction.", "success");
      await refreshProgress();
      await refreshMetrics();
      const next = await loadNext(active.row);
      if (!next.complete && next.row) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      await refresh(); // update dropdown list if needed
    } catch (e) {
      setError(e?.response?.data?.error || "Submit failed.");
    } finally {
      setSaving(false);
    }
  }

  // Auto-boot to Predict when a session already exists
  useEffect(() => {
    if (user && view === "menu") {
      (async () => {
        try {
          await refresh();
          await refreshProgress();
          await refreshMetrics();
          await loadNext(null);
          setView("predict");
        } catch {
          // ignore
        }
      })();
    }
  }, [user, view]);

  // --------- UI ---------


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

          {(metrics.total_patients > 0) && (
            <Paper sx={{ p:2 }}>
              <Typography variant="h6" gutterBottom>Cohort Progress</Typography>
              <Typography variant="body2" color="text.secondary">
                Experts started: {metrics.users_started} • Finished all {metrics.total_patients}: {metrics.users_completed}
              </Typography>
            </Paper>
          )}

      {/* data / csv only */}
      <Paper sx={{ p:2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">Data</Typography>
          {user && (
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
              Remaining: {Math.max(0, (progress.total - progress.completed))} / total: {progress.total}
            </Typography>
          )}
        </Stack>
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
                  setError("");
                  setJustMovedRow(null);
                  setActive(null);
                  setView("menu");
                  setPickRow("");
                }}
              >
                Back to Menu
              </Button>
            </Stack>
          </Paper>

          <Paper sx={{ p:2 }}>
            <Typography variant="h6" gutterBottom>
              Patient {active?.row ? `(row ${active.row})` : ""}
            </Typography>

            {/* progress */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Remaining: {Math.max(0, (progress.total - progress.completed))} / total: {progress.total}
            </Typography>

            {justMovedRow && !allDone && (
              <Alert severity="info" sx={{ mb: 2 }} onClose={() => setJustMovedRow(null)}>
                Now showing patient row {justMovedRow}.
              </Alert>
            )}

            {allDone && (
              <Alert severity="success" sx={{ mb: 2 }}>
                All patients completed. You can use the dropdown to review or edit your previous entries.
              </Alert>
            )}

            {/* switch within predict */}
            <Stack direction={{ xs:"column", sm:"row" }} spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <FormControl size="small" fullWidth sx={{ minWidth: 260, mb: { xs: 1, sm: 0 } }}>
                <InputLabel id="pick2-label">Go to patient</InputLabel>
                <Select
                  labelId="pick2-label"
                  label="Go to patient"
                  value={pickRow}
                  onChange={(e)=>setPickRow(e.target.value)}
                >
                  {patients.map(p => (
                    <MenuItem key={p.row} value={String(p.row)}>
                      {doneMap[p.row] ? `✅ Row ${p.row}` : `Row ${p.row}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
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
            <RadioGroup
              row
              value={outcome === null ? "" : String(outcome)}
              onChange={(e)=>setOutcome(e.target.value === "" ? null : Number(e.target.value))}
              sx={{ mb: 2 }}
            >
              <FormControlLabel value="0" control={<Radio />} label="0 — Unsuccessful" />
              <FormControlLabel value="1" control={<Radio />} label="1 — Successful" />
            </RadioGroup>

            <Box sx={{ my: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>Confidence</Typography>
              <RadioGroup value={conf} onChange={(e)=>setConf(e.target.value)} sx={{ mb: 1 }}>
                {["Very confident","Somewhat confident","Neutral","Somewhat unsure","Not at all confident"].map(c =>
                  <FormControlLabel key={c} value={c} control={<Radio />} label={c} />
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
                />
                <TextField
                  size="small"
                  label="Value"
                  value={snot}
                  onChange={e=>setSnot(Number(e.target.value||0))}
                  sx={{ width: 90 }}
                />
              </Stack>
              <Typography variant="caption">0 = no symptoms, 110 = worst.</Typography>
            </Box>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="flex-start">
              <Button variant="contained" onClick={submitPrediction} disabled={saving || !active}>
                {saving ? "Saving..." : "Save \u0026 Next"}
              </Button>
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
      <Snackbar
        open={snack.open}
        autoHideDuration={2500}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={() => setSnack(s => ({ ...s, open: false }))} severity={snack.severity} sx={{ width: "100%" }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}