// overview.js - apron map and live KPIs, all derived from the engine snapshot.
import { badge, esc, flightColor, flightName, fmt, REAL, SIM } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>`;

const SCENARIOS = [
  { cmd: "scenario deadlock DETECTION", go: "deadlocks", name: "Three-way deadlock", desc: "Flights A, B and C form a circular wait over Gate 3, the fuel truck and the tug." },
  { cmd: "scenario contention", go: "overview", name: "Busy apron", desc: "Five flights compete for 3 gates, 1 truck and 1 tug; ground services run as pthreads." },
  { cmd: "scenario sched-ref RR", go: "scheduler", name: "Scheduler reference", desc: "Four CPU-only flights with hand-checked FCFS / Priority / RR results." },
  { cmd: "scenario emergency preempt=on", go: "scheduler", name: "Emergency landing", desc: "A priority-0 flight arrives mid-run and preempts the CPU." },
  { cmd: "scenario mem-ref string=silberschatz frames=3", go: "memory", name: "FIFO paging", desc: "Silberschatz reference string, 3 frames, step by step (15 faults)." },
  { cmd: "scenario disk-ref SSTF", go: "storage", name: "Baggage cart (disk)", desc: "Six requests on belt 0–49; the child process plans the SSTF order." },
];

const STATE_COLORS = { NEW: "var(--s-new)", READY: "var(--s-ready)", RUNNING: "var(--s-running)", BLOCKED: "var(--s-blocked)", TERMINATED: "var(--s-done)" };

function apronSvg(snap) {
  const W = 900;
  const gates = snap.resources.filter((r) => r.class === "GATE");
  const trucks = snap.resources.filter((r) => r.class === "FUEL_TRUCK");
  const tugs = snap.resources.filter((r) => r.class === "TUG");
  const beltX = (p) => 40 + (p - snap.disk.min) * (820 / (snap.disk.max - snap.disk.min));
  let s = `<svg viewBox="0 0 ${W} 300" role="img" aria-label="Apron map">`;

  // Runway with centre line and inbound flights waiting for a gate.
  s += `<rect class="runway" x="20" y="10" width="860" height="40" rx="3"/>`;
  s += `<line class="rw-center" x1="70" y1="30" x2="830" y2="30"/>`;
  s += `<text class="rw-label" x="30" y="35">09</text><text class="rw-label" x="855" y="35">27</text>`;
  const inbound = snap.flights.filter((f) => f.state !== "TERMINATED" && f.held.length === 0);
  inbound.slice(0, 6).forEach((f, i) => {
    const x = 90 + i * 120;
    s += `<g><rect x="${x}" y="18" width="104" height="24" rx="4" fill="${flightColor(f.spid)}" opacity="0.9"/>
          <text x="${x + 8}" y="34" font-size="11" font-weight="700" fill="#0b1220" font-family="var(--mono)">${esc(f.flight_no)}</text>
          <text x="${x + 98}" y="34" font-size="9" text-anchor="end" fill="#0b1220">${esc(f.state === "NEW" ? "INBOUND" : f.state)}</text></g>`;
  });

  // Taxiway and gate stands.
  s += `<path class="taxi" d="M 40 70 H 860"/>`;
  const gw = 820 / gates.length;
  gates.forEach((g, i) => {
    const x = 40 + i * gw + 6, w = gw - 12;
    const cls = !g.enabled ? "closed" : g.owner >= 0 ? "busy" : "";
    s += `<path class="taxi" d="M ${x + w / 2} 70 V 92"/>`;
    s += `<rect class="stand ${cls}" x="${x}" y="92" width="${w}" height="74" rx="5"/>`;
    s += `<text class="stand-label" x="${x + 8}" y="108">${esc(g.id)}${g.enabled ? "" : " · closed"}</text>`;
    if (g.owner >= 0) {
      const f = snap.flights.find((x2) => x2.spid === g.owner);
      s += `<rect x="${x + 8}" y="116" width="${w - 16}" height="24" rx="4" fill="${flightColor(g.owner)}"/>
            <text x="${x + 16}" y="132" font-size="11" font-weight="700" fill="#0b1220" font-family="var(--mono)">${esc(flightName(snap, g.owner))}</text>`;
      if (f) s += `<text x="${x + 8}" y="156" font-size="10" fill="var(--text-2)">${esc(f.phase)} · ${esc(f.state)}</text>`;
    }
  });

  // Ground-service vehicles.
  const vehicle = (r, x, label) => {
    const held = r.owner >= 0;
    return `<g opacity="${r.enabled ? 1 : 0.35}"><rect x="${x}" y="182" width="96" height="34" rx="5" fill="${held ? "rgba(240,180,60,.14)" : "#0f192c"}" stroke="${held ? "var(--amber)" : "#2a3a5c"}"/>
      <text x="${x + 8}" y="196" font-size="10" fill="var(--muted)" font-family="var(--mono)">${esc(label)} ${esc(r.id)}</text>
      <text x="${x + 8}" y="210" font-size="11" font-weight="700" fill="${held ? flightColor(r.owner) : "var(--muted)"}" font-family="var(--mono)">${held ? esc(flightName(snap, r.owner)) : r.enabled ? "free" : "closed"}</text></g>`;
  };
  let vx = 40;
  for (const r of trucks) { s += vehicle(r, vx, "FUEL"); vx += 108; }
  vx += 12;
  for (const r of tugs) { s += vehicle(r, vx, "TUG"); vx += 108; }
  s += `<text x="${vx + 10}" y="203" font-size="11" fill="var(--muted)">Ground-service vehicles</text>`;

  // Baggage belt (disk analogy): positions, gate markers, pending requests, cart.
  s += `<line class="belt" x1="40" y1="262" x2="860" y2="262"/>`;
  for (let p = snap.disk.min; p <= snap.disk.max; p += 5) s += `<text class="tick-label" x="${beltX(p)}" y="290" text-anchor="middle">${p}</text>`;
  for (const g of gates) s += `<line x1="${beltX(g.position)}" y1="246" x2="${beltX(g.position)}" y2="254" stroke="#4f5d78"/>`;
  for (const r of [...snap.disk.waiting, ...snap.disk.batch_remaining])
    s += `<circle cx="${beltX(r.position)}" cy="262" r="5" fill="${flightColor(r.spid)}" stroke="#0a111e" stroke-width="1.5"/>`;
  const cx = beltX(snap.disk.head);
  s += `<g style="transition:transform .3s" transform="translate(${cx},0)"><rect x="-15" y="236" width="30" height="14" rx="3" fill="var(--amber)"/>
        <text x="0" y="246.5" font-size="8.5" font-weight="700" text-anchor="middle" fill="#1b1404">CART</text></g>`;
  s += `<text x="40" y="240" font-size="11" fill="var(--muted)">Baggage belt · positions ${snap.disk.min}–${snap.disk.max} (disk cylinders)</text>`;
  return s + `</svg>`;
}

function kpis(snap) {
  const counts = { NEW: 0, READY: 0, RUNNING: 0, BLOCKED: 0, TERMINATED: 0 };
  for (const f of snap.flights) counts[f.state]++;
  const total = snap.flights.length || 1;
  const bar = Object.entries(counts).map(([k, v]) => `<span title="${k}: ${v}" style="width:${(100 * v) / total}%;background:${STATE_COLORS[k]}"></span>`).join("");
  const enabled = snap.resources.filter((r) => r.enabled);
  const used = enabled.filter((r) => r.owner >= 0).length;
  const framesUsed = snap.memory.frames.filter((f) => f).length;
  const accesses = snap.memory.hits + snap.memory.faults;
  const dead = snap.deadlock.deadlocked.length > 0;
  const running = snap.cpu.running >= 0 ? flightName(snap, snap.cpu.running) : "idle";
  const pendingBags = snap.disk.waiting.length + snap.disk.batch_remaining.length;
  const tile = (label, value, foot, extra = "", after = "") =>
    `<div class="kpi ${extra}"><div class="k-label">${label}</div><div class="k-value">${value}</div><div class="k-foot">${foot}</div>${after}</div>`;
  return `<div class="kpis">
    ${tile("Flights (processes)", `${snap.flights.length - counts.TERMINATED}<small> active</small>`,
      `${counts.READY} ready · ${counts.RUNNING} running · ${counts.BLOCKED} blocked · ${counts.TERMINATED} done`, "",
      `<div class="statebar">${bar}</div>`)}
    ${tile("CPU", esc(running), `${snap.cpu.algo}${snap.cpu.algo === "RR" ? " q=" + snap.cpu.quantum : ""}${snap.cpu.preemptive ? " · preemptive" : ""} · ready queue ${snap.cpu.ready.length}`)}
    ${tile("Resources in use", `${used}<small> / ${enabled.length}</small>`, `${snap.pending.length} request(s) pending`)}
    ${tile("Deadlock", dead ? "DEADLOCK" : "none", `policy ${snap.deadlock.policy}${dead ? " · " + snap.deadlock.deadlocked.length + " flights" : ""}`, dead ? "alert" : "")}
    ${tile("Memory frames", `${framesUsed}<small> / ${snap.memory.frame_count}</small>`, `${snap.memory.faults} faults · hit ratio ${accesses ? fmt((100 * snap.memory.hits) / accesses, 0) + "%" : "—"}`)}
    ${tile("Baggage queue", `${pendingBags}<small> bags</small>`, `${snap.disk.algo} · head ${snap.disk.head} · moved ${snap.disk.total_movement}`)}
    ${tile("Threads", snap.threads.length, "real pthreads in the engine (incl. main, clock, intake)")}
    ${tile("Avg WT / TAT", snap.cpu.completed ? `${fmt(snap.cpu.avg_waiting)}<small> / ${fmt(snap.cpu.avg_turnaround)}</small>` : "—", `${snap.cpu.completed} completed flight(s)`)}
  </div>`;
}

function narrative(snap) {
  const parts = [];
  if (snap.deadlock.deadlocked.length)
    parts.push(`<b>Deadlock:</b> ${snap.deadlock.deadlocked.map((s) => esc(flightName(snap, s))).join(", ")} wait on each other in a cycle (policy ${snap.deadlock.policy}).`);
  if (snap.cpu.running >= 0) parts.push(`<b>${esc(flightName(snap, snap.cpu.running))}</b> holds the CPU.`);
  const blocked = snap.flights.filter((f) => f.state === "BLOCKED");
  if (blocked.length) parts.push(`${blocked.length} flight(s) blocked: ${blocked.map((f) => `${esc(f.flight_no)} (${esc(f.block_reason)})`).join("; ")}.`);
  if (snap.disk.busy) parts.push(`The cart is serving a ${snap.disk.algo} batch (${snap.disk.moved_in_batch}/${snap.disk.planned_movement} positions moved).`);
  if (snap.sim.invariant_error) parts.push(`<span style="color:var(--red)">Invariant violated: ${esc(snap.sim.invariant_error)}</span>`);
  if (!parts.length) parts.push(snap.sim.quiet && snap.flights.length ? "Nothing can make further progress: the simulation is idle." : "Waiting for work.");
  return parts.join(" ");
}

export default {
  id: "overview",
  label: "Overview",
  icon: ICON,
  concept: {
    title: "One integrated operating system",
    text: "Every tab shows the same engine state. Flights are logical processes executed by real pthreads; gates, trucks and tugs are shared resources; the baggage cart is a disk head; a real child process plans its route over pipes.",
    tags: [REAL("pthreads, mutex/condition variables, sem_t, fork + pipes"), SIM("scheduling, allocation, paging and disk results are computed by the engine")],
  },
  mount(root, ctx) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Apron overview</h1>
        <div class="view-sub" id="ov-note"></div></div></div>
      <div id="ov-start"></div>
      <div class="card apron" style="margin-bottom:14px"><div id="ov-map"></div></div>
      <div id="ov-kpis"></div>
      <div class="note" style="margin-top:14px" id="ov-now"></div>
      <div class="card" style="margin-top:14px">
        <div class="card-head"><span class="card-title">Guided scenarios <span class="muted">· each resets the simulation</span></span></div>
        <div class="scenario-grid" id="ov-scenarios"></div>
      </div>`;
    root.querySelector("#ov-scenarios").innerHTML = SCENARIOS.map((s, i) => `
      <button class="scenario" data-i="${i}"><div class="s-name">${esc(s.name)}</div><div class="s-desc">${esc(s.desc)}</div></button>`).join("");
    root.querySelectorAll(".scenario").forEach((b) => (b.onclick = async () => {
      const s = SCENARIOS[Number(b.dataset.i)];
      if (await ctx.run(s.cmd)) ctx.go(s.go);
    }));
  },
  update(snap) {
    document.getElementById("ov-note").textContent = snap.sim.note;
    document.getElementById("ov-map").innerHTML = apronSvg(snap);
    document.getElementById("ov-kpis").innerHTML = kpis(snap);
    document.getElementById("ov-now").innerHTML = `<b>Now (t=${snap.tick}):</b> ${narrative(snap)}`;
    const start = document.getElementById("ov-start");
    start.innerHTML = snap.flights.length === 0
      ? `<div class="note amber" style="margin-bottom:14px"><b>Getting started.</b> Pick a guided scenario below, or create flights on the <a href="#flights">Flights</a> tab and press <b>Run</b>. ${badge("", "Space = run/pause · S = step")}</div>`
      : "";
  },
};
