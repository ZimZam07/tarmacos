// analytics.js - performance dashboard. Totals come from the engine snapshot; time series are the
// engine's values at each tick the dashboard observed (history.js), and are labelled as such.
import { history } from "../core/history.js";
import { journal } from "../core/journal.js";
import { stateCounts, utilization } from "../core/model.js";
import { esc, flightColor, fmt, setHTML, STATE_COLOR } from "../ui.js";
import { setNum } from "./common.js";
import { fname, opLabel } from "../core/plain.js";

function spark(values, max, color) {
  if (values.length < 2) return `<svg class="spark" viewBox="0 0 200 46"><text x="0" y="28" font-size="10" fill="#6d8198">collecting…</text></svg>`;
  const n = values.length, m = Math.max(max, 1);
  const pts = values.map((v, i) => `${(i / (n - 1)) * 200},${44 - (v / m) * 40}`);
  return `<svg class="spark" viewBox="0 0 200 46" preserveAspectRatio="none"><polygon points="0,46 ${pts.join(" ")} 200,46" fill="${color}" opacity=".12"/><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

export default {
  mount(root) {
    root.innerHTML = `<div class="page-head"><div><div class="xp-kicker">ANALYTICS</div><h1 class="xp-title">How the airport is performing</h1>
      <p>Totals and averages are computed by the engine. Sparklines show the engine's value at each tick this page observed (the stream sends at most 10 snapshots per second, so very fast runs are sampled).</p></div></div>
      <div class="grid c4" id="an-kpis"></div>
      <div class="grid c3" style="margin-top:14px">
        <div class="card"><div class="card-head"><span class="card-title">Resource utilisation · now</span></div><div id="an-util"></div></div>
        <div class="card"><div class="card-head"><span class="card-title">Process states · now</span></div><div id="an-states"></div></div>
        <div class="card"><div class="card-head"><span class="card-title">OS subsystems</span></div><div id="an-os"></div></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-head"><span class="card-title">Per-flight results</span><span class="tiny muted">ticks · from the engine</span></div><div class="table-wrap" id="an-table"></div></div>`;
  },
  update(snap) {
    const c = stateCounts(snap);
    const u = utilization(snap);
    const H = history.ticks;
    const series = (k) => H.map((r) => r[k]);
    const done = snap.flights.filter((f) => f.state === "TERMINATED" && f.end_status === "DONE").length;
    const kpi = (k, v, f, sp) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="f">${f}</div>${sp || ""}</div>`;
    if (!document.getElementById("an-k1")) {
      setHTML(document.getElementById("an-kpis"), [
        kpi("Flights", `<span id="an-k1">0</span><small> total</small>`, `<span id="an-k1f"></span>`, `<div id="an-s1"></div>`),
        kpi("Avg waiting time", `<span id="an-k2">—</span><small> ticks</small>`, `<span id="an-k2f"></span>`, `<div id="an-s2"></div>`),
        kpi("Gate utilisation", `<span id="an-k3">0</span><small>%</small>`, `<span id="an-k3f"></span>`, `<div id="an-s3"></div>`),
        kpi("Waiting (blocked) flights", `<span id="an-k4">0</span>`, `<span id="an-k4f"></span>`, `<div id="an-s4"></div>`),
      ].join(""));
    }
    setNum(document.getElementById("an-k1"), snap.flights.length);
    document.getElementById("an-k1f").textContent = `${done} completed · ${snap.flights.length - c.TERMINATED} active`;
    document.getElementById("an-k2").textContent = snap.cpu.completed ? fmt(snap.cpu.avg_waiting) : "—";
    document.getElementById("an-k2f").textContent = `turnaround ${fmt(snap.cpu.avg_turnaround)} · ${snap.cpu.algo}${snap.cpu.algo === "RR" ? " q=" + snap.cpu.quantum : ""}`;
    setNum(document.getElementById("an-k3"), u.GATE.total ? Math.round((100 * u.GATE.used) / u.GATE.total) : 0);
    document.getElementById("an-k3f").textContent = `${u.GATE.used} of ${u.GATE.total} open gates allocated`;
    setNum(document.getElementById("an-k4"), c.BLOCKED);
    document.getElementById("an-k4f").textContent = `${snap.pending.length} waiting for a resource · ${c.READY} in the CPU queue`;
    setHTML(document.getElementById("an-s1"), spark(series("active"), Math.max(...series("active"), 1), "#20c8ff"));
    setHTML(document.getElementById("an-s2"), spark(series("ready"), Math.max(...series("ready"), 1), "#438bff"));
    setHTML(document.getElementById("an-s3"), spark(H.map((r) => (r.gatesT ? r.gates / r.gatesT : 0)), 1, "#2fd69a"));
    setHTML(document.getElementById("an-s4"), spark(series("blocked"), Math.max(...series("blocked"), 1), "#ffb547"));

    const bar = (label, x, color) => `<div class="hbar"><span>${label}</span><span class="tr"><span style="width:${x.total ? (100 * x.used) / x.total : 0}%;background:${color}"></span></span><span class="mono small" style="text-align:right">${x.used}/${x.total}</span></div>`;
    setHTML(document.getElementById("an-util"), bar("Gates", u.GATE, "#20c8ff") + bar("Fuel trucks", u.FUEL_TRUCK, "#ffb547") + bar("Tugs", u.TUG, "#a68bff")
      + `<div class="tiny muted">Truck utilisation over the observed ticks</div>${spark(H.map((r) => (r.trucksT ? r.trucks / r.trucksT : 0)), 1, "#ffb547")}`);
    const total = snap.flights.length || 1;
    setHTML(document.getElementById("an-states"), Object.entries(c).map(([k, v]) => `<div class="hbar"><span class="mono tiny">${k}</span><span class="tr"><span style="width:${(100 * v) / total}%;background:${STATE_COLOR[k]}"></span></span><span class="mono small" style="text-align:right">${v}</span></div>`).join(""));
    const recoveries = journal.events.filter((e) => e.kind === "RECOVERED").length;
    const accesses = snap.memory.faults + snap.memory.hits;
    setHTML(document.getElementById("an-os"), `<dl class="kv">
      <dt>Page faults / hits</dt><dd>${snap.memory.faults} / ${snap.memory.hits}${accesses ? ` <span class="muted">(${fmt((100 * snap.memory.faults) / accesses, 0)}% faults)</span>` : ""}</dd>
      <dt>Baggage cart distance (disk head)</dt><dd>${snap.disk.total_movement} spots <span class="muted">· ${snap.disk.served_count} bags</span></dd>
      <dt>Messages to the helper process</dt><dd>${snap.ipc.exchanges}</dd>
      <dt>Deadlock detection runs</dt><dd>${snap.deadlock.detection_runs}</dd>
      <dt>Deadlocks now · resolved</dt><dd>${snap.deadlock.deadlocked.length ? `<b style="color:var(--red)">${snap.deadlock.deadlocked.length} flights</b>` : 0} · ${recoveries}</dd>
      <dt>Threads running now</dt><dd>${snap.threads.length}</dd>
      <dt>Consistency checks</dt><dd>${snap.sim.invariant_checks} ${snap.sim.invariant_error ? '<b style="color:var(--red)">failed</b>' : '<span style="color:var(--green)">all passed</span>'}</dd></dl>`);
    setHTML(document.getElementById("an-table"), snap.flights.length ? `<table class="data"><thead><tr><th>Flight</th><th>Type</th><th class="num">Priority</th><th class="num">Arrived</th><th class="num">CPU ticks</th><th class="num">Waited</th><th class="num">Blocked</th><th class="num">Total time</th><th>Status</th></tr></thead><tbody>
      ${snap.flights.map((f) => `<tr><td><span class="dot" style="background:${flightColor(f.spid)};margin-right:6px"></span><b>${esc(fname(f))}</b></td><td class="tiny">${esc(opLabel(f.op))}</td><td class="num">${f.priority}</td><td class="num">${f.arrival}</td><td class="num">${f.burst}</td><td class="num">${f.waiting}</td><td class="num">${f.blocked_ticks}</td><td class="num">${f.turnaround ?? "—"}</td><td class="tiny">${f.state === "TERMINATED" ? (f.end_status === "DONE" ? "finished" : "stopped") : esc(f.state)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty">No flights yet. Load a scenario to see results.</div>`);
  },
};
