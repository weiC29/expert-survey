import { useEffect, useMemo, useState } from "react";
import { listPatients, claim, release, getPatient } from "../api";

export default function PatientPicker({ onClaimed }) {
  const [loading, setLoading] = useState(false);
  const [patients, setPatients] = useState([]);
  const [selectedRow, setSelectedRow] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const { patients } = await listPatients();
      setPatients(patients || []);
    } catch (e) {
      setError("Failed to load patients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const options = useMemo(() => {
    return patients.map(p => {
      // p example: { row, status, label, locked_by, submitted }
      const disabled = !!p.submitted || p.status === "claimed";
      const text = p.label || `Row ${p.row}`;
      return { value: String(p.row), text, disabled };
    });
  }, [patients]);

  const handleClaim = async () => {
    setError("");
    if (!selectedRow) {
      setError("Please select a patient");
      return;
    }
    try {
      const row = Number(selectedRow);
      const res = await claim(row);
      if (!res.ok) {
        setError(res.error || "Could not claim patient");
        await refresh();
        return;
      }
      const details = await getPatient(row);
      onClaimed({ row, details });
    } catch (e) {
      setError("Claim failed");
    }
  };

  const handleRelease = async () => {
    setError("");
    if (!selectedRow) return;
    try {
      await release(Number(selectedRow));
      await refresh();
    } catch {
      // ignore
    }
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Choose a patient</h3>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          disabled={loading}
          value={selectedRow}
          onChange={(e) => setSelectedRow(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        >
          <option value="">— Select —</option>
          {options.map(opt => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.text}{opt.disabled ? " (locked/submitted)" : ""}
            </option>
          ))}
        </select>

        <button onClick={refresh} disabled={loading}>Refresh</button>
        <button onClick={handleClaim} disabled={loading || !selectedRow}>Claim</button>
        <button onClick={handleRelease} disabled={loading || !selectedRow}>Release</button>
      </div>

      {error && <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>}

      <small style={{ display: "block", marginTop: 8 }}>
        Disabled items are already submitted or currently claimed by someone else.
      </small>
    </div>
  );
}