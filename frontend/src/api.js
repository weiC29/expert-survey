/*
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "http://localhost:5001/api",
  withCredentials: true, // 👈 important for Flask session
});

export default api;
*/
import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

// --- user ---
export const getHealth = () => api.get("/health").then(r => r.data);
export const getUser = () => api.get("/get_user").then(r => r.data);
export const setUser = (name, email) =>
  api.post("/set_user", { name, email }).then(r => r.data);

// --- patients ---
export const listPatients = () => api.get("/patients").then(r => r.data);
export const getPatient = (row) => api.get("/patient", { params: { row } }).then(r => r.data);
export const claim = (row) => api.post("/claim", { row }).then(r => r.data);
export const release = (row) => api.post("/release", { row }).then(r => r.data);

// --- submit ---
export const submitPrediction = (payload) =>
  api.post("/submit_prediction", payload).then(r => r.data);

// --- data ---
export const downloadCsvUrl = () => "/api/csv";

export default api;