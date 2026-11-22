// context.js - the right-hand panel: details of whatever is selected (flight, gate, vehicle, cart).
import { store, subscribe } from "../store.js";
import { flightEvents, journal, onEvents } from "../core/journal.js";
import { appBus, go, route, selection } from "../core/state.js";
import { flightMap, flightStatusLine, gateStatus, PHASE_LABEL, servicesOf, threadOf } from "../core/model.js";
import { fname, opLabel, resName, serviceLabel, TASK_STATE_LABEL } from "../core/plain.js";
import { badge, chip, confirmAction, dash, esc, flightColor, flightName, ICONS, RES_LABEL, run, setHTML, stateBadge, stateKey } from "../ui.js";

const STATES = ["NEW", "READY", "RUNNING", "BLOCKED", "TERMINATED"];

const EVENT_LABEL = {
  FLIGHT_CREATED: (d) => `Process created (needs ${d.burst} CPU ticks)`,
  FLIGHT_ADMITTED: () => "Arrived → joined the CPU queue (READY)",
  DISPATCHED: () => "Got the CPU (RUNNING)",
  QUANTUM_EXPIRED: () => "Time slice used up → back in the queue",
  PREEMPTED: () => "Paused for a higher-priority flight",
  PHASE_CHANGED: (d) => `Phase: ${PHASE_LABEL[d.phase] || d.phase}`,
  RES_REQUESTED: (d) => `${d.task ? "Refuelling worker asks for" : "Asks for"} a ${(RES_LABEL[d.class] || d.class).toLowerCase()}`,
  RES_BLOCKED: (d) => `Waiting (BLOCKED): no ${(RES_LABEL[d.class] || d.class).toLowerCase()} free`,
  UNSAFE_DEFERRED: (d) => `Deferred: granting a ${RES_LABEL[d.class] || d.class} would be unsafe`,
  RES_GRANTED: (d) => `Got ${resName(d.resource)}${d.waited ? ` after ${d.waited} ticks` : ""}`,
  RES_RELEASED: (d) => `Gave back ${resName(d.resource)}`,
  FLIGHT_READY: () => "Woken up → back in the queue",
  SERVICES_STARTED: (d) => `Started ${d.tasks?.length || ""} ground-service worker(s), waits for them`,
  THREAD_JOINED: (d) => `${serviceLabel(d.service)} finished`,
  SERVICES_COMPLETE: () => "All services done → back in the queue",
  POLICY_REFUSED: () => "Request refused (wrong order)",
  VICTIM_SELECTED: () => "Chosen to give up its resources",
  FLIGHT_ABORT: () => "Cancelled",
  FLIGHT_TERMINATED: (d) => `Finished · total ${d.tat ?? "—"} ticks`,
};

export function initContext(app) {
  const panel = document.getElementById("context");
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };
  subscribe(schedule);
  selection.on(() => {
    schedule();
    if (selection.type && app.scene && (route.current.area === "airport" || route.current.area === "story")) app.scene.focus(selection.type, selection.id);
  });
  route.on(schedule);
  onEvents(schedule);

  panel.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) {
      const c = e.target.closest("[data-flight]");
      if (c) selection.set("flight", Number(c.dataset.flight));
      return;
    }
    const act = b.dataset.act;
    if (act === "close") selection.clear();
    if (act === "focus" && app.scene) app.scene.focus(selection.type, selection.id);
    if (act === "follow" && app.scene) { app.scene.follow(selection.id); appBus.emit("follow", selection.id); }
    if (act === "process") go("explorer/process");
    if (act === "disk") go("explorer/disk");
    if (act === "threads") go("explorer/threads");
    if (act === "abort") {
      const f = store.snap?.flights.find((x) => x.spid === selection.id);
      if (f && (await confirmAction(`Cancel ${fname(f)}?`, "The engine stops this flight, gives back everything it holds, and its thread exits. Waiting flights may then be granted the freed resources.", "Abort flight")))
        await run(`flight abort ${f.spid}`);
    }
  });

  function render() {
    const snap = store.snap;
    const area = route.current.area;
    const show = !!selection.type && !!snap && (area === "airport" || area === "story");
    panel.classList.toggle("open", show);
    document.getElementById("stage").classList.toggle("has-context", show);
    if (!show) return;
    let html = "";
    if (selection.type === "flight") html = flightPanel(snap, selection.id);
    else if (selection.type === "gate") html = gatePanel(snap, selection.id);
    else if (selection.type === "vehicle") html = selection.id === "CART" ? cartPanel(snap) : vehiclePanel(snap, selection.id);
    setHTML(panel, html);
  }
}

const head = (swatch, title, sub, right) => `<div class="ctx-head">
  <span class="swatch" style="background:${swatch}"></span>
  <div style="flex:1;min-width:0"><div class="title-lg" style="font-size:19px">${title}</div><div class="small muted">${sub}</div></div>
  ${right || ""}<button class="btn small icon ghost" data-act="close" aria-label="Close">${ICONS.close}</button></div>`;

function stateDiagram(f) {
  const cur = f.state;
  return `<div class="psd">${STATES.map((s, i) => `${i ? '<span class="psd-arrow"></span>' : ""}<span class="psd-node ${s === cur ? "on " + stateKey(f) : ""}">${s === "TERMINATED" ? "TERM" : s}</span>`).join("")}</div>`;
}

function flightPanel(snap, spid) {
  const f = snap.flights.find((x) => x.spid === spid);
  if (!f) return head("#4a5d73", "Flight not found", "It belongs to an earlier simulation.");
  const svc = servicesOf(snap, spid);
  const thr = threadOf(snap, spid);
  const pend = snap.pending.filter((p) => p.spid === spid);
  const reason = { held: "all in use", unsafe: "unsafe (Banker's)", claim: "exceeds claim", "": "new" };
  const steps = f.script.map((s, i) => {
    const cls = i < f.step_index || f.state === "TERMINATED" ? "done" : i === f.step_index ? "cur" : "";
    return `<li class="${cls}"><span class="sd"></span>${esc(s)}</li>`;
  }).join("");
  const evs = flightEvents(spid);
  const tl = [];
  for (const e of evs) {
    const lab = EVENT_LABEL[e.kind];
    if (!lab) continue;
    const text = lab(e.data);
    if (tl.length && tl[tl.length - 1].text === text) { tl[tl.length - 1].n++; continue; }
    tl.push({ tick: e.tick, text, kind: e.kind, n: 1 });
  }
  const services = svc.length ? svc.map((t) => {
    const prog = t.service === "REFUEL" ? (3 - t.work_left) / 3 : t.bags_total ? t.bags_served / t.bags_total : 0;
    const txt = t.service === "REFUEL" ? `refuelling ${3 - t.work_left} of 3 ticks` : `${t.bags_served} of ${t.bags_total} bags picked up`;
    const waiting = /WAITING/.test(t.task_state);
    return `<div class="svc"><div class="row nowrap"><b class="small">${serviceLabel(t.service)}</b><span class="spacer"></span>${badge(waiting ? "warn" : t.task_state === "DONE" ? "real" : "info", TASK_STATE_LABEL[t.task_state] || t.task_state)}</div>
      <div class="progress ${waiting ? "amber" : ""}" style="margin:7px 0 5px"><span style="width:${Math.round(prog * 100)}%"></span></div>
      <div class="tiny muted">${txt} · thread id ${t.tid || "—"}</div></div>`;
  }).join("") : `<div class="tiny muted">${f.script.some((s) => s.startsWith("services")) ? (f.state === "TERMINATED" ? "Its service threads were joined." : "Services start at the gate (one pthread per service).") : "This flight needs no ground services."}</div>`;

  return head(flightColor(spid), esc(fname(f)), `${esc(opLabel(f.op))} · priority ${f.priority}`, stateBadge(f)) + `<div class="ctx-body">
    <div class="note ${f.state === "BLOCKED" ? "amber" : "cyan"}" style="margin-bottom:16px">${esc(flightStatusLine(snap, f))}</div>
    <div class="ctx-sec"><span class="eyebrow">Process state</span>${stateDiagram(f)}</div>
    <div class="ctx-sec"><span class="eyebrow">Resources</span>
      <div class="row">${f.held.length ? f.held.map((r) => `<span class="res-tag">${esc(resName(r))}</span>`).join("") : '<span class="tiny muted">holds nothing</span>'}
      ${pend.map((p) => `<span class="res-tag want" title="${esc(reason[p.reason] || p.reason)}">wants ${esc(RES_LABEL[p.class].toLowerCase())}${p.task ? " (for refuelling)" : ""}</span>`).join("")}</div>
      <div class="tiny muted" style="margin-top:6px">Will need at most: ${f.max_claim[0]} gate · ${f.max_claim[1]} fuel truck · ${f.max_claim[2]} tug</div></div>
    <div class="ctx-sec"><span class="eyebrow">Ground-service workers (threads)</span><div class="stack" style="gap:8px">${services}</div></div>
    <div class="ctx-sec"><span class="eyebrow">Scheduling</span><dl class="kv">
      <dt>Arrived at</dt><dd>tick ${f.arrival}</dd><dt>CPU time used</dt><dd>${f.cpu_used} of ${f.burst} ticks</dd>
      <dt>Time waiting in the queue</dt><dd>${f.waiting} ticks</dd><dt>Time blocked</dt><dd>${f.blocked_ticks} ticks</dd>
      <dt>First got the CPU</dt><dd>${f.first_dispatch >= 0 ? "tick " + f.first_dispatch : "—"}</dd><dt>Finished at</dt><dd>${f.finish >= 0 ? "tick " + f.finish : "—"}</dd>
      <dt>Total time (turnaround)</dt><dd>${f.turnaround != null ? f.turnaround + " ticks" : "—"}</dd><dt>Thread id (Linux)</dt><dd class="mono">${f.tid ? f.tid : "—"}${thr ? "" : f.state === "TERMINATED" ? " (joined)" : ""}</dd></dl></div>
    <div class="ctx-sec"><span class="eyebrow">Its plan · one step per CPU tick</span><ul class="steps">${steps}</ul></div>
    <div class="ctx-sec"><span class="eyebrow">What happened so far</span><div class="ftl">${tl.slice(-16).map((x) => `<div class="ftl-i"><span class="mono tiny muted">t${x.tick}</span><span>${esc(x.text)}${x.n > 1 ? ` <span class="muted">×${x.n}</span>` : ""}</span></div>`).join("") || '<div class="tiny muted">No events seen yet.</div>'}</div></div>
    <div class="row">
      <button class="btn small" data-act="follow">${ICONS.follow}Follow</button>
      <button class="btn small" data-act="process">${ICONS.explorer}As a process</button>
      ${f.state !== "TERMINATED" ? `<span class="spacer"></span><button class="btn small danger" data-act="abort">Cancel flight</button>` : ""}
    </div></div>`;
}

function historyOf(id) {
  return journal.events.filter((e) => (e.kind === "RES_GRANTED" || e.kind === "RES_RELEASED") && e.data.resource === id).slice(-10).reverse();
}

function gatePanel(snap, id) {
  const g = snap.resources.find((r) => r.id === id);
  if (!g) return head("#4a5d73", id, "unknown gate");
  const gs = gateStatus(snap, g, flightMap(snap));
  const waiting = snap.pending.filter((p) => p.class === "GATE");
  const owner = g.owner >= 0 ? snap.flights.find((f) => f.spid === g.owner) : null;
  return head(gs.color, esc(resName(id)), `${gs.label} · baggage belt spot ${g.position}`) + `<div class="ctx-body">
    <div class="ctx-sec"><span class="eyebrow">Allocation</span>
      ${owner ? `<div class="row">${chip(snap, owner.spid)}${stateBadge(owner)}<span class="small muted">${esc(PHASE_LABEL[owner.phase] || owner.phase)}</span></div>` : `<div class="small muted">${g.enabled ? "Free: the next GATE request is granted immediately." : "Closed in this scenario."}</div>`}</div>
    <div class="ctx-sec"><span class="eyebrow">Waiting for a gate · oldest first</span>
      ${waiting.length ? waiting.map((p) => `<div class="row" style="margin-bottom:6px">${chip(snap, p.spid)}<span class="tiny muted">since t${p.since}</span></div>`).join("") : '<div class="tiny muted">No flight is waiting.</div>'}</div>
    <div class="ctx-sec"><span class="eyebrow">What the gate means here</span><div class="small dim">A gate is an exclusive resource instance: at most one owner. A request that cannot be granted leaves the flight BLOCKED, sleeping on a condition variable until the allocator grants it at the end of a tick.</div></div>
    <div class="ctx-sec"><span class="eyebrow">Recent history</span>${historyOf(id).map((e) => `<div class="ftl-i"><span class="mono tiny muted">t${e.tick}</span><span>${e.kind === "RES_GRANTED" ? "allocated to" : "released by"} <b>${esc(flightName(snap, e.data.spid))}</b></span></div>`).join("") || '<div class="tiny muted">No activity yet.</div>'}</div>
  </div>`;
}

function vehiclePanel(snap, id) {
  const r = snap.resources.find((x) => x.id === id);
  if (!r) return head("#4a5d73", id, "unknown vehicle");
  const kind = r.class === "TUG" ? "Pushback tug" : "Fuel truck";
  const waiting = snap.pending.filter((p) => p.class === r.class);
  const thr = r.owner_task ? snap.threads.find((t) => t.kind === "service" && t.task === r.owner_task) : null;
  return head(r.owner >= 0 ? flightColor(r.owner) : "#2fd69a", esc(resName(id)), r.enabled ? (r.owner >= 0 ? "Allocated" : "Available") : "Out of service in this scenario") + `<div class="ctx-body">
    <div class="ctx-sec"><span class="eyebrow">Owner</span>${r.owner >= 0 ? `<div class="row">${chip(snap, r.owner)}${r.owner_task ? `<span class="small muted">used by its refuelling worker</span>` : '<span class="small muted">used by the flight itself</span>'}</div>
      ${thr ? `<div class="progress" style="margin-top:10px"><span style="width:${Math.round(((3 - thr.work_left) / 3) * 100)}%"></span></div><div class="tiny muted" style="margin-top:5px">refuelling: ${3 - thr.work_left} of 3 ticks done</div>` : ""}`
      : '<div class="small muted">Parked at the depot.</div>'}</div>
    <div class="ctx-sec"><span class="eyebrow">Waiting for a ${kind.toLowerCase()}</span>${waiting.length ? waiting.map((p) => `<div class="row" style="margin-bottom:6px">${chip(snap, p.spid)}${p.task ? `<span class="tiny muted">refuelling worker</span>` : ""}<span class="tiny muted">since tick ${p.since}</span></div>`).join("") : '<div class="tiny muted">Nobody is waiting.</div>'}</div>
    <div class="ctx-sec"><span class="eyebrow">Recent history</span>${historyOf(id).map((e) => `<div class="ftl-i"><span class="mono tiny muted">t${e.tick}</span><span>${e.kind === "RES_GRANTED" ? "assigned to" : "released by"} <b>${esc(flightName(snap, e.data.spid))}</b></span></div>`).join("") || '<div class="tiny muted">No activity yet.</div>'}</div>
    <div class="row"><button class="btn small" data-act="threads">${ICONS.explorer}See the threads</button></div>
  </div>`;
}

function cartPanel(snap) {
  const d = snap.disk;
  const waiting = d.waiting.length + d.batch_remaining.length;
  return head("#ffb547", "Baggage cart", `Works like a disk head · now at belt spot ${d.head} (of 0–49)`) + `<div class="ctx-body">
    <div class="ctx-sec"><span class="eyebrow">Scheduling</span><dl class="kv">
      <dt>Route rule</dt><dd>${esc(d.algo)} ${d.algo === "SCAN" ? esc(d.direction) : ""}</dd><dt>Now</dt><dd>${d.busy ? "on a pickup round" : "parked"}</dd>
      <dt>Bags waiting</dt><dd>${waiting}</dd><dt>Planned route (spots)</dt><dd class="mono">${d.order.join(" → ") || "—"}</dd>
      <dt>Driven this round</dt><dd>${d.busy ? `${d.moved_in_batch} of ${d.planned_movement} spots` : "—"}</dd><dt>Total distance driven</dt><dd>${d.total_movement} spots</dd>
      <dt>Bags picked up</dt><dd>${d.served_count} in ${d.batches} round(s)</dd></dl></div>
    <div class="ctx-sec"><span class="eyebrow">Who plans the route</span><div class="small dim">A separate helper process (created with <code>fork()</code>, PID <span class="mono">${snap.ipc.child_pid}</span>) receives the list of bags through a pipe and sends back the order to pick them up.</div></div>
    <div class="row"><button class="btn small" data-act="disk">${ICONS.explorer}Disk scheduling</button></div>
  </div>`;
}
