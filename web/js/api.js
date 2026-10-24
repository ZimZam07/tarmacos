// api.js - the only place that talks to the bridge.
//   command(line)  POST /api/cmd   -> engine response {ok, result | error}
//   sys(name)      POST /api/sys   -> real Linux command output (fixed list)
//   connect(...)   GET  /api/stream (Server-Sent Events) -> engine snapshots
//
// API_BASE comes from config.js: empty for the local bridge (same origin), or the
// hosted bridge's https URL in production. Every tab sends its own session id; a
// public bridge gives each session its own engine, the local bridge ignores it.

export const API_BASE = (window.TARMAC_CONFIG?.apiBase || "").replace(/\/+$/, "");
export const HOSTED = API_BASE !== "";

function newSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function storedSessionId() {
  try {
    const sid = sessionStorage.getItem("tarmac.sid") || newSessionId();
    sessionStorage.setItem("tarmac.sid", sid);
    return sid;
  } catch {
    return newSessionId(); // storage blocked: still works, but a refresh starts a new simulation
  }
}

let sessionId = storedSessionId();

// Forget the current session (e.g. it expired) and use a fresh one.
export function renewSession() {
  sessionId = newSessionId();
  try { sessionStorage.setItem("tarmac.sid", sessionId); } catch { /* ignore */ }
}

const url = (path) => `${API_BASE}${path}?sid=${encodeURIComponent(sessionId)}`;

async function post(path, body) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 100000); // the bridge itself gives up after 90 s
  try {
    const response = await fetch(url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    return await response.json();
  } catch (err) {
    const msg = HOSTED ? "The TarmacOS server is unreachable. It may be waking up; try again in a minute."
      : "The bridge is unreachable. Is bridge/server.py running?";
    return { ok: false, error: { code: "E_NETWORK", msg } };
  } finally {
    clearTimeout(timer);
  }
}

export const command = (line) => post("/api/cmd", { line });
export const sys = (name) => post("/api/sys", { cmd: name });
export const restartEngine = () => post("/api/engine/restart", {});

export function connect({ onSnapshot, onEngine, onConnection }) {
  const source = new EventSource(url("/api/stream"));
  source.addEventListener("snapshot", (e) => onSnapshot(JSON.parse(e.data)));
  source.addEventListener("engine", (e) => onEngine(JSON.parse(e.data)));
  source.onopen = () => onConnection(true);
  source.onerror = () => onConnection(false); // EventSource reconnects by itself
  return source;
}
