// resources.js - who owns each gate, fuel truck and tug, and who is waiting.
import { badge, chip, esc, flightName, REAL, SIM } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="9" width="11" height="6" rx="1"/><path d="M13 11h3l2 2v2h-5"/><circle cx="6" cy="16" r="1.5"/><circle cx="15" cy="16" r="1.5"/><path d="M5 9V5h5v4"/></svg>`;
const GROUPS = [["GATE", "Gates", "Each gate also has a position on the baggage belt."], ["FUEL_TRUCK", "Fuel trucks", "Requested by REFUEL worker threads."], ["TUG", "Pushback tugs", "Requested by flights before pushback."]];
const REASON = { held: ["warn", "all in use"], unsafe: ["err", "unsafe (Banker's)"], claim: ["err", "exceeds claim"], "": ["", "new"] };

export default {
  id: "resources",
  label: "Resources",
  icon: ICON,
  concept: {
    title: "Shared resources and blocking",
    text: "Every resource instance has at most one owner. A request that cannot be granted leaves the requester BLOCKED: its thread sleeps on a condition variable (no busy waiting) until the allocator grants the resource at the end of a tick, then it is woken and becomes READY.",
    tags: [REAL("blocked flights really sleep in pthread_cond_wait"), SIM("ownership table kept by the engine"), badge("", "Lab M4/M5")],
  },
  mount(root) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Resource management</h1>
        <div class="view-sub">The allocation table is protected by the engine mutex; requests are decided once per tick, oldest first, under the active deadlock policy.</div></div>
        <div id="rs-inv"></div></div>
      <div class="grid cols-side">
        <div class="card" id="rs-groups"></div>
        <div class="grid">
          <div class="card"><div class="card-head"><span class="card-title">Pending requests</span><span class="small muted">oldest first</span></div><div id="rs-pending"></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Availability</span></div><div id="rs-avail"></div></div>
        </div>
      </div>`;
  },
  update(snap) {
    document.getElementById("rs-inv").innerHTML = snap.sim.invariant_error
      ? badge("err", "Invariant violated", snap.sim.invariant_error)
      : badge("real", `Invariants OK · ${snap.sim.invariant_checks} checks`, "one owner per instance, consistent held lists, blocked ⇒ one pending request");
    document.getElementById("rs-groups").innerHTML = GROUPS.map(([cls, title, hint]) => {
      const tiles = snap.resources.filter((r) => r.class === cls).map((r) => {
        const owner = r.owner >= 0 ? `${chip(snap, r.owner)}${r.owner_task ? ` <span class="small muted">worker #${r.owner_task}</span>` : ""}` : r.enabled ? "free" : "closed in this scenario";
        return `<div class="res-tile ${r.owner >= 0 ? "held" : ""} ${r.enabled ? "" : "closed"}">
          <div class="row"><span class="rid">${esc(r.id)}</span>${r.position >= 0 ? `<span class="small muted">belt ${r.position}</span>` : ""}</div>
          <div class="rowner">${owner}</div></div>`;
      }).join("");
      return `<div class="res-group"><h4>${title} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">· ${hint}</span></h4><div class="res-tiles">${tiles}</div></div>`;
    }).join("");

    document.getElementById("rs-pending").innerHTML = snap.pending.length
      ? `<table class="data"><thead><tr><th>Requester</th><th>Wants</th><th class="num">Since</th><th>Status</th></tr></thead><tbody>${snap.pending.map((p) => {
        const [cls, text] = REASON[p.reason] || ["", p.reason];
        return `<tr><td>${chip(snap, p.spid)}${p.task ? ` <span class="small muted">worker #${p.task}</span>` : ""}</td><td><span class="res-tag want">${esc(p.class)}</span></td><td class="num">t${p.since}</td><td>${badge(cls, text)}</td></tr>`;
      }).join("")}</tbody></table>`
      : `<div class="empty small">No flight is waiting for a resource.</div>`;

    const rows = GROUPS.map(([cls, title], i) => {
      const enabled = snap.resources.filter((r) => r.class === cls && r.enabled);
      const free = enabled.filter((r) => r.owner < 0).length;
      return `<tr><td>${title}</td><td class="num">${enabled.length}</td><td class="num">${enabled.length - free}</td><td class="num">${free}</td><td class="num">${snap.deadlock.matrices.available[i]}</td></tr>`;
    }).join("");
    document.getElementById("rs-avail").innerHTML = `<table class="data"><thead><tr><th>Class</th><th class="num">Open</th><th class="num">Held</th><th class="num">Free</th><th class="num">Avail vec</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="small muted" style="margin-top:8px">Holders: ${[...new Set(snap.resources.filter((r) => r.owner >= 0).map((r) => r.owner))].map((s) => esc(flightName(snap, s))).join(", ") || "none"}</div>`;
  },
};
