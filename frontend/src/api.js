import axios from "axios";

function resolveApiBase() {
  const envBase = (import.meta?.env?.VITE_API_BASE || "").trim();

  if (envBase) {
    return stripTrailingSlash(envBase);
  }

  // Heuristic: Production on Vercel without env var set
  if (typeof window !== "undefined" && window.location.hostname.endsWith("vercel.app")) {
    return "https://expert-survey.onrender.com/api";
  }

  // Local dev default
  return "http://localhost:5001/api";
}

function stripTrailingSlash(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

const API_BASE = resolveApiBase();

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // keep cookies for Flask session
});

// --- user ---
export const getHealth = () => api.get("/health").then((r) => r.data);
export const getUser = () => api.get("/get_user").then((r) => r.data);
export const setUser = (name, email) =>
  api.post("/set_user", { name, email }).then((r) => r.data);

// --- patients ---
export const listPatients = () => api.get("/patients").then((r) => r.data);
export const getPatient = (row) =>
  api.get("/patient", { params: { row } }).then((r) => r.data);
export const claim = (row) => api.post("/claim", { row }).then((r) => r.data);
export const release = (row) => api.post("/release", { row }).then((r) => r.data);

// --- submit ---
export const submitPrediction = (payload) =>
  api.post("/submit_prediction", payload).then((r) => r.data);

// --- data ---
export const downloadCsvUrl = () => `${API_BASE}/csv`;

export default api;