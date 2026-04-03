import axios from "axios";

function resolveBaseURL() {
  const env = process.env.REACT_APP_API_URL;
  if (env != null && String(env).trim() !== "") {
    return String(env).replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "development") {
    return "http://127.0.0.1:8000";
  }
  // Production build without env: same origin (static host has no FastAPI — set REACT_APP_API_URL on Vercel)
  return "";
}

const API = axios.create({
  baseURL: resolveBaseURL(),
});

API.interceptors.request.use((config) => {
  if (config.data instanceof FormData) {
    delete config.headers["Content-Type"];
  } else if (
    config.data &&
    typeof config.data === "object" &&
    !(config.data instanceof FormData)
  ) {
    config.headers["Content-Type"] = config.headers["Content-Type"] || "application/json";
  }
  return config;
});

export default API;
