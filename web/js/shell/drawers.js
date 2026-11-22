// drawers.js - left panels over the airport: Flights (create + list), Ground Ops, Resources.
import { store, subscribe } from "../store.js";
import { go, route, selection } from "../core/state.js";
import { flightMap, flightStatusLine, gateStatus, servicesOf, utilization } from "../core/model.js";
import { fname, opLabel, resName, serviceLabel, TASK_STATE_LABEL } from "../core/plain.js";
import { badge, chip, esc, flightColor, flightName, ICONS, REAL, RES_LABEL, run, setHTML, stateBadge, toast } from "../ui.js";

const PRESETS = [
  { label: "Turnaround", op: "TURNAROUND", prio: 2, hint: "gate → land → taxi → refuel + baggage threads → tug → depart" },
  { label: "Arrival", op: "ARRIVAL", prio: 3, hint: "gate → land → taxi → baggage thread → release" },
  { label: "Departure", op: "DEPARTURE", prio: 2, hint: "gate → refuel thread → tug → pushback" },
];
const HINTS = {
  TURNAROUND: "Lands, gets refuelled and unloaded, then takes off again · 8 CPU ticks",
  ARRIVAL: "Lands and unloads its bags · 6 CPU ticks",
  DEPARTURE: "Boards at a gate, refuels and takes off · 5 CPU ticks",
  CUSTOM: "Only uses the CPU, no gate or vehicles (for scheduling tests)",
};
const TITLES = { flights: ["Flights", "Every flight is a process run by its own thread"], ground: ["Ground operations", "Refuelling and baggage workers, vehicles, bags"], resources: ["Resources", "Gates, fuel trucks and tugs: one flight at a time each"] };

let counter = 100;

export function initDrawers() {
  const drawer = document.getElementById("drawer");
  let current = null;
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };

  function mount(kind) {
    current = kind;
    const [title, sub] = TITLES[kind];
    drawer.innerHTML = `<div class="drawer-head"><div style="flex:1"><div class="title-md">${title}</div><div class="tiny muted">${sub}</div></div>
      <button class="btn small icon ghost" id="dr-close" aria-label="Close">${ICONS.close}</button></div>
      ${kind === "flights" ? createForm() : ""}<div class="drawer-body" id="dr-body"></div>`;
    document.getElementById("dr-close").onclick = () => go("airport");
    if (kind === "flights") wireForm();
    drawer.querySelector("#dr-body").addEventListener("click", (e) => {
      const n = e.target.closest("[data-flight]");
      if (n) return selection.set("flight", Number(n.dataset.flight));
      const g = e.target.closest("[data-gate]");
      if (g) return selection.set("gate", g.dataset.gate);
      const v = e.target.closest("[data-veh]");
      if (v) return selection.set("vehicle", v.dataset.veh);
    });
  }

  function apply() {
    const r = route.current;
    const kind = r.area === "airport" && TITLES[r.sub] ? r.sub : null;
    drawer.classList.toggle("open", !!kind);
    document.getElementById("hud").classList.toggle("dim", !!kind);
    document.getElementById("notices").classList.toggle("hidden", !!kind);
    if (kind && kind !== current) mount(kind);
    if (!kind) current = null;
    schedule();
  }
  route.on(apply);
  subscribe(schedule);
  apply();

  function render() {
    const snap = store.snap;
    const body = document.getElementById("dr-body");
    if (!current || !body || !snap) return;
    if (current === "flights") setHTML(body, flightsList(snap));
    if (current === "ground") setHTML(body, groundOps(snap));
    if (current === "resources") setHTML(body, resourcesView(snap));
  }
}

// ---------------------------------------------------------------- flights
function createForm() {
  return `<div style="padding:0 14px 12px 16px;border-bottom:1px solid var(--line)">
    <div class="row" style="margin-bottom:10px">${PRESETS.map((p, i) => `<button class="btn small" data-preset="${i}" title="${esc(p.hint)}">${ICONS.plus}${p.label}</button>`).join("")}</div>
    <form id="fl-form" autocomplete="off" class="stack" style="gap:8px">
      <div class="row nowrap">
        <label class="field" style="flex:1"><span>Flight type</span><select id="fl-op"><option value="TURNAROUND">Arrive &amp; depart</option><option value="ARRIVAL">Arrival only</option><option value="DEPARTURE">Departure only</option><option value="CUSTOM">CPU-only job</option></select></label>
      </div>
      <div class="row nowrap">
        <label class="field" style="flex:1"><span>Priority (0 = most urgent)</span><input type="number" id="fl-prio" min="0" max="9" value="2"></label>
        <label class="field" style="flex:1"><span>CPU ticks (CPU-only)</span><input type="number" id="fl-burst" min="1" max="50" value="4" disabled></label>
        <label class="field" style="flex:1"><span>Arrives at tick</span><input type="number" id="fl-arrive" min="0" placeholder="now"></label>
      </div>
      <div class="row nowrap"><span class="tiny muted" id="fl-hint" style="flex:1">${HINTS.TURNAROUND}</span><button class="btn primary small" type="submit">Create flight</button></div>
    </form></div>`;
}

function nextNo() {
  const taken = new Set((store.snap?.flights || []).filter((f) => f.state !== "TERMINATED").map((f) => f.flight_no));
  let no;
  do { no = "TM" + ++counter; } while (taken.has(no));
  return no;
}

function wireForm() {
  const op = document.getElementById("fl-op");
  op.onchange = () => {
    document.getElementById("fl-burst").disabled = op.value !== "CUSTOM";
    document.getElementById("fl-hint").textContent = HINTS[op.value];
  };
  document.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = async () => {
    const p = PRESETS[Number(b.dataset.preset)];
    const r = await run(`flight create ${nextNo()} ${p.op} ${p.prio}`);
    if (r) { selection.set("flight", r.spid); toast(`${fname(r.spid)} created${store.snap?.sim.running ? "" : " · press Run to start"}`); }
  }));
  document.getElementById("fl-form").onsubmit = async (e) => {
    e.preventDefault();
    const no = nextNo();
    const prio = document.getElementById("fl-prio").value;
    const arrive = document.getElementById("fl-arrive").value;
    let line = `flight create ${no} ${op.value} ${prio}`;
    if (op.value === "CUSTOM") line += ` burst=${document.getElementById("fl-burst").value}`;
    if (arrive !== "") line += ` arrive=${arrive}`;
    const r = await run(line);
    if (r) {
      selection.set("flight", r.spid);
      toast(`${fname(r.spid)} created, arrives at tick ${r.arrival}`);
    }
  };
}

function flightsList(snap) {
  if (!snap.flights.length) return `<div class="empty">No flights yet.<br>Create one above, or load <b>Busy apron</b> from Scenarios.</div>`;
  const order = { RUNNING: 0, READY: 1, BLOCKED: 2, NEW: 3, TERMINATED: 4 };
  const list = snap.flights.slice().sort((a, b) => order[a.state] - order[b.state] || a.spid - b.spid);
  return list.map((f) => `<button class="strip ${selection.is("flight", f.spid) ? "sel" : ""} ${f.state === "TERMINATED" ? "done" : ""}" data-flight="${f.spid}">
      <span class="strip-bar" style="background:${flightColor(f.spid)}"></span>
      <span class="strip-main"><span class="row nowrap" style="gap:7px"><b>${esc(fname(f))}</b><span class="tiny muted">${esc(opLabel(f.op))} · priority ${f.priority}</span><span class="spacer"></span>${stateBadge(f)}</span>
      <span class="tiny dim">${esc(flightStatusLine(snap, f))}</span>
      <span class="strip-res">${f.held.map((r) => `<span class="res-tag">${esc(resName(r))}</span>`).join("")}${f.requested.map((r) => `<span class="res-tag want">wants ${esc(RES_LABEL[r].toLowerCase())}</span>`).join("")}</span></span></button>`).join("");
}

// ---------------------------------------------------------------- ground ops
function groundOps(snap) {
  const svc = snap.threads.filter((t) => t.kind === "service");
  const vehicles = snap.resources.filter((r) => r.class !== "GATE");
  const s = snap.sync;
  const svcHtml = svc.length ? svc.map((t) => {
    const prog = t.service === "REFUEL" ? (3 - t.work_left) / 3 : t.bags_total ? t.bags_served / t.bags_total : 0;
    const waiting = /WAITING/.test(t.task_state);
    return `<div class="svc" data-flight="${t.spid}" style="cursor:pointer"><div class="row nowrap"><span class="dot" style="background:${flightColor(t.spid)}"></span><b class="small">${esc(flightName(snap, t.spid))}</b><span class="small">${serviceLabel(t.service)}</span><span class="spacer"></span>${badge(waiting ? "warn" : "info", TASK_STATE_LABEL[t.task_state] || t.task_state)}</div>
      <div class="progress ${waiting ? "amber" : ""}" style="margin:7px 0 4px"><span style="width:${Math.round(prog * 100)}%"></span></div><div class="tiny muted">${t.service === "REFUEL" ? `refuelling ${3 - t.work_left} of 3 ticks` : `${t.bags_served} of ${t.bags_total} bags picked up`}</div></div>`;
  }).join("") : `<div class="tiny muted">No worker is running. Flights start a refuelling worker and a baggage worker when they reach their gate.</div>`;
  const vHtml = vehicles.map((r) => `<button class="tile ${r.owner >= 0 ? "busy" : ""} ${r.enabled ? "" : "off"}" data-veh="${r.id}">
      <span class="tile-id">${esc(resName(r.id))}</span>
      <span class="tile-own">${r.owner >= 0 ? `<span class="dot" style="background:${flightColor(r.owner)}"></span>${esc(flightName(snap, r.owner))}` : r.enabled ? "free" : "not in use"}</span></button>`).join("");
  const slots = Array.from({ length: s.capacity }, (_, i) => { const b = s.buffer[i]; return `<span class="slot ${b ? "full" : ""}" style="${b ? `--c:${flightColor(b.spid)}` : ""}">${b ? "spot " + b.position : ""}</span>`; }).join("");
  const reqs = snap.disk.waiting.length + snap.disk.batch_remaining.length;
  return `<div class="ctx-sec"><span class="eyebrow">Ground-service workers (threads) · ${svc.length}</span><div class="stack" style="gap:8px">${svcHtml}</div></div>
    <div class="ctx-sec"><span class="eyebrow">Vehicles</span><div class="tiles">${vHtml}</div></div>
    <div class="ctx-sec"><span class="eyebrow">Baggage pipeline</span>
      <div class="small dim" style="margin-bottom:8px">Baggage workers put bags into a 4-slot holding area ${REAL("semaphores")}; an intake worker takes them out; the baggage cart then picks them up along the belt.</div>
      <div class="buf">${slots}</div>
      <div class="row tiny muted" style="margin-top:8px"><span>free slots <b class="mono">${s.empty_sem}</b></span><span>bags in slots <b class="mono">${s.full_sem}</b></span><span>${s.produced} put in · ${s.consumed} taken out</span></div>
      <button class="tile" data-veh="CART" style="margin-top:10px;width:100%"><span class="tile-id">Baggage cart</span><span class="tiny muted">at belt spot ${snap.disk.head} · ${esc(snap.disk.algo)}</span><span class="tile-own">${reqs} bag(s) waiting · drove ${snap.disk.total_movement} spots</span></button></div>`;
}

// ---------------------------------------------------------------- resources
function resourcesView(snap) {
  const fm = flightMap(snap);
  const u = utilization(snap);
  const gates = snap.resources.filter((r) => r.class === "GATE").map((g) => {
    const gs = gateStatus(snap, g, fm);
    return `<button class="tile ${g.enabled ? "" : "off"}" data-gate="${g.id}" style="--c:${gs.color}"><span class="tile-id"><span class="dot" style="background:${gs.color}"></span> ${esc(resName(g.id))}</span><span class="tiny muted">${gs.label}</span>
      <span class="tile-own">${g.owner >= 0 ? esc(flightName(snap, g.owner)) : g.enabled ? "—" : "not in use"}</span></button>`;
  }).join("");
  const reason = { held: ["warn", "none free"], unsafe: ["err", "unsafe now"], claim: ["err", "too many"], "": ["", "new"] };
  const pend = snap.pending.length ? snap.pending.map((p) => {
    const [c, t] = reason[p.reason] || ["", p.reason];
    return `<div class="row" style="margin-bottom:7px">${chip(snap, p.spid)}<span class="res-tag want">wants ${esc(RES_LABEL[p.class].toLowerCase())}</span>${p.task ? `<span class="tiny muted">for refuelling</span>` : ""}<span class="spacer"></span><span class="tiny muted">since tick ${p.since}</span>${badge(c, t)}</div>`;
  }).join("") : `<div class="tiny muted">No request is waiting.</div>`;
  const bar = (label, x) => `<div class="avail"><span class="small">${label}</span><span class="spacer"></span><span class="mono small">${x.total - x.used}<span class="muted"> / ${x.total} free</span></span></div><div class="progress" style="margin-bottom:10px"><span style="width:${x.total ? (100 * x.used) / x.total : 0}%"></span></div>`;
  return `<div class="ctx-sec"><span class="eyebrow">Availability</span>${bar("Gates", u.GATE)}${bar("Fuel trucks", u.FUEL_TRUCK)}${bar("Tugs", u.TUG)}
      <div class="tiny muted">Free right now: ${snap.deadlock.matrices.available[0]} gate(s), ${snap.deadlock.matrices.available[1]} fuel truck(s), ${snap.deadlock.matrices.available[2]} tug(s)</div></div>
    <div class="ctx-sec"><span class="eyebrow">Gates</span><div class="tiles">${gates}</div></div>
    <div class="ctx-sec"><span class="eyebrow">Who is waiting · longest first</span>${pend}</div>
    <div class="ctx-sec"><span class="eyebrow">Integrity</span>${snap.sim.invariant_error ? badge("err", "Invariant violated: " + snap.sim.invariant_error) : badge("real", `Consistency checks passed · ${snap.sim.invariant_checks}`, "every resource has at most one owner, and every waiting flight has exactly one request")}
      <div class="tiny muted" style="margin-top:6px">Deadlock policy: <b>${esc(snap.deadlock.policy)}</b>. Every normal flight asks for a gate first, then a fuel truck, then a tug, so normal traffic can never deadlock.</div></div>`;
}
