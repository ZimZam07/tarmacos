// notices.js - small, short-lived notifications for the milestones of a flight's life (from real events).
import { onEvents } from "../core/journal.js";
import { route, selection } from "../core/state.js";
import { store } from "../store.js";
import { esc, flightColor, flightName } from "../ui.js";
import { describe as sentence, opLabel, resName } from "../core/plain.js";

function describe(e, snap) {
  const d = e.data;
  const name = d.spid > 0 ? flightName(snap, d.spid) : "";
  switch (e.kind) {
    case "FLIGHT_ADMITTED": {
      const f = snap.flights.find((x) => x.spid === d.spid);
      return { t: `${name} arrived`, m: `New process created${f ? ` · priority ${f.priority} · ${opLabel(f.op).toLowerCase()}` : ""}`, c: flightColor(d.spid) };
    }
    case "RES_GRANTED":
      if (/^G\d/.test(d.resource)) return { t: `${resName(d.resource)} assigned`, m: `to ${name}${d.waited ? ` after waiting ${d.waited} ticks` : ""}`, c: "#20c8ff" };
      if (/^FT/.test(d.resource)) return { t: `${resName(d.resource)} assigned`, m: `${name}'s refuelling worker${d.waited ? ` waited ${d.waited} ticks` : ""}`, c: "#ffb547" };
      if (/^TG/.test(d.resource)) return { t: `${resName(d.resource)} assigned`, m: `${name} is ready for pushback`, c: "#a68bff" };
      return null;
    case "RES_BLOCKED":
      return { t: `${name} is waiting`, m: `no ${String(d.class).replace("_", " ").toLowerCase()} is free`, c: "#ffb547" };
    case "DEADLOCK_DETECTED":
      return { t: "Deadlock detected", m: sentence(e, snap), c: "#ff5c6c" };
    case "RECOVERED":
      return { t: "Deadlock recovered", m: sentence(e, snap), c: "#2fd69a" };
    case "FLIGHT_TERMINATED":
      return { t: `${name} ${d.status === "DONE" ? "completed" : "was stopped"}`, m: d.status === "DONE" ? `Process finished · total ${d.tat} ticks · waited ${d.wt} in the queue` : "Process stopped", c: d.status === "DONE" ? "#2fd69a" : "#ff5c6c" };
    default:
      return null;
  }
}

export function initNotices() {
  const box = document.getElementById("notices");
  onEvents((fresh, { reset }) => {
    if (reset) box.innerHTML = "";
    if (!(route.current.area === "airport") || !store.snap) return;
    if (fresh.length > 40) return; // a whole run arrived at once ("run to end"): don't flood
    for (const e of fresh) {
      const n = describe(e, store.snap);
      if (!n) continue;
      const el = document.createElement("div");
      el.className = "notice";
      el.style.setProperty("--c", n.c);
      el.innerHTML = `<span class="bar"></span><div><div class="nt">${esc(n.t)} <span class="tiny muted mono">t${e.tick}</span></div><div class="nm">${esc(n.m)}</div></div>`;
      if (e.data.spid > 0) el.onclick = () => selection.set("flight", e.data.spid);
      box.prepend(el);
      while (box.children.length > 3) box.lastElementChild.remove();
      setTimeout(() => { el.classList.add("leave"); setTimeout(() => el.remove(), 600); }, 5200);
    }
  });
}
