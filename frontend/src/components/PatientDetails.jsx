import { useState } from "react";
import { submitPrediction } from "../api";

const FRIENDLY = {
  TREATMENT: "Treatment",
  Age: "Age",
  SEX: "Sex",
  RACE: "Race",
  ETHNICITY: "Ethnicity (NIH)",
  EDUCATION: "Years of education",
  HOUSEHOLD_INCOME: "Annual household income",
  PREVIOUS_SURGERY: "Prior sinus surgery (#)",
  INSURANCE: "Insurance Type",
  AFS: "AFRS",
  SEPT_DEV: "Septal Deviation",
  CRS_POLYPS: "Polyps",
  RAS: "Recurrent Acute Sinusitis",
  HYPER_TURB: "Inferior Turb Hypertrophy",
  MUCOCELE: "Mucocele",
  ASTHMA: "Asthma",
  ASA_INTOLERANCE: "AERD",
  ALLERGY_TESTING: "Positive allergy skin testing",
  COPD: "COPD",
  DEPRESSION: "Depression",
  FIBROMYALGIA: "Fibromyalgia",
  OSA_HISTORY: "OSA History",
  SMOKER: "Smoker (ppd)",
  ALCOHOL: "Alcohol Use (drinks/wk)",
  STEROID: "Steroid dependence",
  DIABETES: "Diabetes",
  GERD: "GERD",
  BLN_CT_TOTAL: "CT score (LM 0–24)",
  BLN_ENDOSCOPY_TOTAL: "Endoscopy Score (LK 0–20)",
  SNOT22_BLN_TOTAL: "SNOT-22 total (0–110)",
};

const DISPLAY_ORDER = [
  "Age","SEX","RACE","ETHNICITY","EDUCATION","HOUSEHOLD_INCOME",
  "PREVIOUS_SURGERY","INSURANCE","AFS","SEPT_DEV","CRS_POLYPS","RAS",
  "HYPER_TURB","MUCOCELE","ASTHMA","ASA_INTOLERANCE","ALLERGY_TESTING",
  "COPD","DEPRESSION","FIBROMYALGIA","OSA_HISTORY","SMOKER","ALCOHOL",
  "STEROID","DIABETES","GERD","BLN_CT_TOTAL","BLN_ENDOSCOPY_TOTAL","SNOT22_BLN_TOTAL"
];

export default function PatientDetails({ row, details, onSubmitted }) {
  const [outcome, setOutcome] = useState(1);
  const [confidence, setConfidence] = useState("Neutral");
  const [snot22, setSnot22] = useState(24);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const fields = DISPLAY_ORDER
    .filter(k => k in details)
    .map(k => ({ key: k, label: FRIENDLY[k] || k, value: details[k] }));

  const handleSubmit = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await submitPrediction({
        row,
        outcome,
        confidence,
        snot22,
      });
      if (res.ok) {
        setMsg("✅ Submission saved.");
        onSubmitted?.();
      } else {
        setMsg(res.error || "Submission failed.");
      }
    } catch {
      setMsg("Submission error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Patient (row {row})</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        {fields.map(f => (
          <div key={f.key} style={{ padding: 8, background: "#fafafa", borderRadius: 8 }}>
            <div style={{ fontWeight: 600 }}>{f.label}</div>
            <div>{String(f.value ?? "")}</div>
          </div>
        ))}
      </div>

      <hr />

      <h4>Your prediction</h4>

      <div style={{ margin: "8px 0" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Outcome (0 = Unsuccessful, 1 = Successful)</div>
        <div style={{ display: "flex", gap: 8 }}>
          <label><input type="radio" name="outcome" checked={outcome===0} onChange={() => setOutcome(0)} /> 0 — Unsuccessful</label>
          <label><input type="radio" name="outcome" checked={outcome===1} onChange={() => setOutcome(1)} /> 1 — Successful</label>
        </div>
      </div>

      <div style={{ margin: "8px 0" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Confidence</div>
        {["Very confident","Somewhat confident","Neutral","Somewhat unsure","Not at all confident"].map(c => (
          <label key={c} style={{ display: "block", padding: "4px 0" }}>
            <input type="radio" name="conf" checked={confidence===c} onChange={() => setConfidence(c)} /> {c}
          </label>
        ))}
      </div>

      <div style={{ margin: "8px 0" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Estimated postoperative SNOT-22 at 6 months ({snot22})
        </div>
        <input
          type="range"
          min={0}
          max={110}
          step={1}
          value={snot22}
          onChange={(e) => setSnot22(Number(e.target.value))}
          style={{ width: 320 }}
        />
        <div style={{ fontSize: 12, color: "#666" }}>0 = no symptoms, 110 = worst.</div>
      </div>

      <button onClick={handleSubmit} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? "Submitting…" : "Submit"}
      </button>

      {msg && <div style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}