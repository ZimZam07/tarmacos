// ui.js - small shared helpers: escaping, colours, chips, toasts, confirmation.
import { command } from "./api.js";

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// One muted, distinguishable colour per flight (by SPID).
const PALETTE = ["#4ba3e3", "#f0b43c", "#3fc98c", "#e07b9a", "#a48cf0", "#5fd0d0", "#e8935a", "#9fbf5a"];
export const flightColor = (spid) => (spid > 0 ? PALETTE[(spid - 1) % PALETTE.length] : "#8792a8");

export function flightIndex(snap) {
  const map = new Map();
  for (const f of snap.flights) map.set(f.spid, f);
  return map;
}

export function flightName(snap, spid) {
  if (spid === 0) return "REF";
  const f = snap.flights.find((x) => x.spid === spid);
  return f ? f.flight_no : `SPID ${spid}`;
}

export function chip(snap, spid, extra = "") {
  return `<span class="chip ${extra}"><span class="sw" style="background:${flightColor(spid)}"></span>${esc(flightName(snap, spid))}<span class="muted">#${spid}</span></span>`;
}

export function stateBadge(flight) {
  const label = flight.state === "TERMINATED" && flight.end_status === "ABORTED" ? "ABORTED" : flight.state;
  const text = flight.state === "TERMINATED" ? (flight.end_status === "ABORTED" ? "ABORTED" : "DONE") : flight.state;
  return `<span class="state ${label}">${text}</span>`;
}

export const badge = (cls, text, title = "") => `<span class="badge ${cls}" title="${esc(title)}">${esc(text)}</span>`;
export const REAL = (title = "Uses a real POSIX mechanism") => badge("real", "Real POSIX", title);
export const SIM = (title = "Logical simulation computed by the C++ engine") => badge("sim", "Simulated", title);
export const PROV = (title = "Textbook choice; not specified by the course material") => badge("prov", "Provisional", title);

export function toast(message, isError = false, code = "") {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " err" : "");
  el.innerHTML = (code ? `<span class="code">${esc(code)}</span>` : "") + esc(message);
  box.appendChild(el);
  setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

// Sends a command; shows the engine's error message if it fails.
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

// Builds a small matrix table. rows: array of arrays; rowLabels/colLabels: strings.
export function matrixTable(rows, rowLabels, colLabels, highlightRow = -1) {
  if (!rows || !rows.length) return `<div class="muted small">empty</div>`;
  const head = `<tr><th></th>${colLabels.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const body = rows
    .map((r, i) => `<tr><th>${esc(rowLabels[i])}</th>${r.map((v) => `<td class="${i === highlightRow ? "hl" : ""}">${v}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="matrix">${head}${body}</table>`;
}

export const RES_SHORT = ["Gate", "Truck", "Tug"];
