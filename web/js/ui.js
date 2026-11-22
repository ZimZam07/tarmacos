// ui.js - small shared helpers: escaping, colours, chips, badges, toasts, confirmation, engine commands.
import { command } from "./api.js";
import { fname } from "./core/plain.js";

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// One distinguishable accent per flight (by SPID), used on tails, labels, chips and charts.
export const PALETTE = ["#20c8ff", "#ffb547", "#2fd69a", "#ff6b8b", "#a68bff", "#4fe0d0", "#ff8a4c", "#b5e655", "#6fa8ff", "#f07ce0"];
export const flightColor = (spid) => (spid > 0 ? PALETTE[(spid - 1) % PALETTE.length] : "#8a9bb0");
export const STATE_COLOR = { NEW: "#8a9bb0", READY: "#438bff", RUNNING: "#20c8ff", BLOCKED: "#ffb547", TERMINATED: "#2fd69a", ABORTED: "#ff5c6c" };
export const stateKey = (f) => (f.state === "TERMINATED" && f.end_status === "ABORTED" ? "ABORTED" : f.state);

export function flightName(snap, spid) {
  return fname(spid); // plain name ("Flight 3"); the engine's call sign stays internal
}

export function chip(snap, spid, extra = "") {
  return `<span class="chip ${extra}" data-flight="${spid}"><span class="sw" style="background:${flightColor(spid)}"></span>${esc(flightName(snap, spid))}</span>`;
}

export function stateBadge(f) {
  const key = stateKey(f);
  const text = f.state === "TERMINATED" ? (f.end_status === "ABORTED" ? "ABORTED" : "DONE") : f.state;
  return `<span class="state ${key === "TERMINATED" ? "DONE" : key}">${text}</span>`;
}

export const badge = (cls, text, title = "") => `<span class="badge ${cls}" ${title ? `title="${esc(title)}"` : ""}>${esc(text)}</span>`;
export const REAL = (title = "Uses a real POSIX mechanism") => badge("real", "Real POSIX", title);
export const SIM = (title = "Logical simulation computed by the C++ engine") => badge("sim", "Engine-simulated", title);
export const PROV = (title = "Textbook choice; not specified by the course material") => badge("prov", "Textbook choice", title);

export function toast(message, isError = false, code = "") {
  const box = document.getElementById("toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.innerHTML = (code ? `<span class="code">${esc(code)}</span>` : "") + `<span>${esc(message)}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add("leave"); setTimeout(() => el.remove(), 300); }, isError ? 6000 : 3000);
}

// Sends a command to the engine; shows the engine's own error message if it fails.
export async function run(line, { quiet = true } = {}) {
  const resp = await command(line);
  if (!resp.ok) {
    toast(resp.error?.msg || "Command failed", true, resp.error?.code);
    return null;
  }
  if (!quiet) toast("Done: " + line);
  return resp.result;
}

export function confirmAction(title, text, okLabel = "Confirm") {
  const dialog = document.getElementById("confirm");
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").textContent = text;
  document.getElementById("confirm-ok").textContent = okLabel;
  return new Promise((resolve) => {
    const ok = document.getElementById("confirm-ok");
    const cancel = document.getElementById("confirm-cancel");
    const finish = (value) => {
      ok.onclick = cancel.onclick = null;
      dialog.close();
      resolve(value);
    };
    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    dialog.oncancel = () => finish(false);
    dialog.showModal();
  });
}

export const fmt = (value, digits = 2) => (value === null || value === undefined ? "—" : Number(value).toFixed(digits));
export const dash = (value) => (value === null || value === undefined || value < 0 ? "—" : value);

export function matrixTable(rows, rowLabels, colLabels, highlightRow = -1) {
  if (!rows || !rows.length) return `<div class="muted small">empty</div>`;
  const head = `<tr><th></th>${colLabels.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const body = rows
    .map((r, i) => `<tr><th>${esc(rowLabels[i])}</th>${r.map((v) => `<td class="${i === highlightRow ? "hl" : ""}">${v}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="matrix">${head}${body}</table>`;
}

export const RES_SHORT = ["Gate", "Truck", "Tug"];
export const RES_LABEL = { GATE: "Gate", FUEL_TRUCK: "Fuel truck", TUG: "Tug" };

// Replaces innerHTML only when the markup really changed (keeps hover/focus and avoids layout work).
export function setHTML(el, html) {
  if (!el) return;
  if (el.__html !== html) {
    el.__html = html;
    el.innerHTML = html;
  }
}

export const svgIcon = (path, vb = "0 0 20 20") => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const ICONS = {
  airport: svgIcon('<path d="M2 12l16-5-3 5 3 5-16-5z"/><path d="M7 10.5L5 4"/>'),
  flights: svgIcon('<rect x="3" y="4" width="14" height="3.2" rx="1"/><rect x="3" y="8.4" width="14" height="3.2" rx="1"/><rect x="3" y="12.8" width="14" height="3.2" rx="1"/>'),
  ground: svgIcon('<rect x="2" y="9" width="10" height="5.5" rx="1"/><path d="M12 10.5h3.2l2.3 2.4v1.6H12"/><circle cx="5.5" cy="15.5" r="1.5"/><circle cx="14.5" cy="15.5" r="1.5"/><path d="M4.5 9V5.5h5V9"/>'),
  resources: svgIcon('<rect x="3" y="3" width="6" height="6" rx="1.2"/><rect x="11" y="3" width="6" height="6" rx="1.2"/><rect x="3" y="11" width="6" height="6" rx="1.2"/><rect x="11" y="11" width="6" height="6" rx="1.2"/>'),
  explorer: svgIcon('<path d="M10 2.5l6.5 3.7v7.6L10 17.5l-6.5-3.7V6.2z"/><path d="M10 10l6.5-3.8M10 10v7.5M10 10L3.5 6.2"/>'),
  analytics: svgIcon('<path d="M3 17V9M8 17V4M13 17v-6M18 17V7"/>'),
  story: svgIcon('<path d="M4 3.5h8.5L16 7v9.5H4z"/><path d="M12.5 3.5V7H16M7 10h6M7 13h4"/>'),
  play: '<svg viewBox="0 0 16 16"><path d="M4.5 3l8.5 5-8.5 5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>',
  step: '<svg viewBox="0 0 16 16"><path d="M3 3l7 5-7 5zM11 3h2v10h-2z" fill="currentColor"/></svg>',
  end: '<svg viewBox="0 0 16 16"><path d="M2 3l6 5-6 5zM8 3l6 5-6 5z" fill="currentColor"/></svg>',
  reset: '<svg viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v3h3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  gear: svgIcon('<circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7"/>'),
  sound: svgIcon('<path d="M3 8h3l4-3.5v11L6 12H3z"/><path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5.5a6.3 6.3 0 0 1 0 9"/>'),
  mute: svgIcon('<path d="M3 8h3l4-3.5v11L6 12H3z"/><path d="M13.5 8l4 4M17.5 8l-4 4"/>'),
  scenario: svgIcon('<path d="M3 5h14M3 10h9M3 15h6"/><path d="M14 12.5l3 2.5-3 2.5z"/>'),
  close: svgIcon('<path d="M5 5l10 10M15 5L5 15"/>'),
  focus: svgIcon('<circle cx="10" cy="10" r="3"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3"/>'),
  overview: svgIcon('<path d="M3 15l7-9 7 9z"/><path d="M7 15l3-4 3 4"/>'),
  runway: svgIcon('<path d="M7 2l-2 16M13 2l2 16M10 4v2M10 9v2M10 14v2"/>'),
  gate: svgIcon('<rect x="3" y="12" width="14" height="4" rx="1"/><path d="M6 12V7h3v5M11 12V9h3v3"/>'),
  truck: svgIcon('<rect x="2" y="7" width="10" height="6" rx="1"/><path d="M12 9h3l2 2v2h-5"/><circle cx="5.5" cy="14.5" r="1.5"/><circle cx="14" cy="14.5" r="1.5"/>'),
  tower: svgIcon('<path d="M7.5 18l1-10h3l1 10M6 8h8l-1-3H7z"/><path d="M10 5V2.5"/>'),
  log: svgIcon('<path d="M4 5h12M4 10h12M4 15h8"/>'),
  expand: svgIcon('<path d="M6 12l4-4 4 4"/>'),
  check: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 6.2l2.4 2.3 4.6-5"/></svg>',
  prev: svgIcon('<path d="M12.5 5l-5 5 5 5"/>'),
  next: svgIcon('<path d="M7.5 5l5 5-5 5"/>'),
  replay: svgIcon('<path d="M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3h3"/>'),
  exit: svgIcon('<path d="M8 4H4v12h4M12 6l4 4-4 4M16 10H8"/>'),
  plus: svgIcon('<path d="M10 4v12M4 10h12"/>'),
  follow: svgIcon('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2" fill="currentColor"/>'),
  link: svgIcon('<path d="M8.5 11.5l3-3M7 9l-2 2a2.5 2.5 0 0 0 3.5 3.5l2-2M13 11l2-2a2.5 2.5 0 0 0-3.5-3.5l-2 2"/>'),
};
