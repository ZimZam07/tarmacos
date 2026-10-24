// deadlocks.js - Deadlock Observatory. Every graph edge, matrix and verdict on
// this page comes from the engine; the page only draws it.
import { badge, chip, esc, flightName, matrixTable, PROV, RES_SHORT, SIM, toast } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="4" r="2.2"/><circle cx="4" cy="15" r="2.2"/><circle cx="16" cy="15" r="2.2"/><path d="M8.8 6l-3.6 7M6.3 15h7.4M14.8 13l-3.6-7"/></svg>`;

const POLICIES = [
  { id: "PREVENTION", when: "before a request", desc: "Breaks circular wait with a resource order Gate < Truck < Tug. An out-of-order request is refused and the flight restarts in order." },
  { id: "AVOIDANCE", when: "before a grant", desc: "Banker's algorithm: grant only if a safe sequence still exists, using each flight's declared maximum claim. Unsafe requests wait." },
  { id: "DETECTION", when: "after it happens", desc: "Grant whenever possible, then run the detection algorithm. A deadlock is reported, but nothing is done about it." },
  { id: "RECOVERY", when: "after it happens", desc: "Detection plus action: choose a victim (lowest priority, then youngest) and roll it back or terminate it." },
];
let chosen = null;
let chosenAction = "PREEMPT";
let bankerRef = null;

// ---------------------------------------------------------------- graph
function ragSvg(snap) {
  const active = snap.flights.filter((f) => f.state !== "TERMINATED" && (f.held.length || f.requested.length));
  const resources = snap.resources.filter((r) => r.enabled);
  const targetOf = (cls) => resources.find((r) => r.class === cls && r.owner >= 0) || resources.find((r) => r.class === cls);
  // Order nodes so that request -> resource -> holder edges run around the circle.
  const order = [];
  const add = (node) => { if (!order.some((n) => n.key === node.key)) order.push(node); };
  for (const f of active) {
    add({ key: "f" + f.spid, kind: "f", f });
    for (const cls of f.requested) { const r = targetOf(cls); if (r) add({ key: "r" + r.id, kind: "r", r }); }
  }
  for (const r of resources) if (r.owner >= 0) add({ key: "r" + r.id, kind: "r", r });
  if (!order.length) return `<div class="empty">No resource is allocated or requested. Load the A/B/C scenario and step through it.</div>`;

  const W = 640, H = 360, cx = W / 2, cy = H / 2 + 6, R = order.length <= 2 ? 90 : 128;
  order.forEach((n, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / order.length;
    n.x = cx + R * Math.cos(a);
    n.y = cy + R * Math.sin(a);
  });
  const at = (key) => order.find((n) => n.key === key);
  const dead = new Set(snap.deadlock.deadlocked);
  const line = (a, b, cls, marker) => {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, pad = 30;
    return `<line class="${cls}" x1="${a.x + (dx / len) * pad}" y1="${a.y + (dy / len) * pad}" x2="${b.x - (dx / len) * pad}" y2="${b.y - (dy / len) * pad}" marker-end="url(#${marker})"/>`;
  };

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Resource-allocation graph"><defs>
    <marker id="ah-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--amber)"/></marker>
    <marker id="ah-r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--blue)"/></marker>
    <marker id="ah-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--red)"/></marker></defs>`;
  // Assignment edges: resource -> holder (solid).  Request edges: flight -> resource (dashed).
  for (const r of resources) {
    if (r.owner < 0) continue;
    const a = at("r" + r.id), b = at("f" + r.owner);
    if (a && b) s += dead.has(r.owner) ? line(a, b, "edge-assign edge-dead", "ah-d") : line(a, b, "edge-assign", "ah-a");
  }
  for (const f of active) for (const cls of f.requested) {
    const r = targetOf(cls), a = at("f" + f.spid), b = r && at("r" + r.id);
    if (a && b) s += dead.has(f.spid) ? line(a, b, "edge-request edge-dead", "ah-d") : line(a, b, "edge-request", "ah-r");
  }
  for (const n of order) {
    if (n.kind === "f") {
      s += `<circle class="node-f ${dead.has(n.f.spid) ? "dead" : ""}" cx="${n.x}" cy="${n.y}" r="27"/>
        <text class="node-label" x="${n.x}" y="${n.y + 1}">${esc(n.f.flight_no.split("-")[0])}</text>
        <text class="node-sub" x="${n.x}" y="${n.y + 14}">${esc(n.f.state)}</text>`;
    } else {
      s += `<rect class="node-r" x="${n.x - 26}" y="${n.y - 17}" width="52" height="34" rx="5"/>
        <text class="node-label" x="${n.x}" y="${n.y + 1}">${esc(n.r.id)}</text>
        <text class="node-sub" x="${n.x}" y="${n.y + 13}">${esc(RES_SHORT[["GATE", "FUEL_TRUCK", "TUG"].indexOf(n.r.class)])}</text>`;
    }
  }
  return s + `</svg>`;
}

// ---------------------------------------------------------------- status banner
function banner(snap) {
  const d = snap.deadlock;
  const recent = snap.events.slice().reverse();
  if (d.deadlocked.length) {
    const names = d.deadlocked.map((s) => esc(flightName(snap, s)));
    return `<div class="banner red"><div><div class="b-title">Deadlock detected at t=${d.detected_at}: ${names.join(" → ")} → ${names[0]}</div>
      <div class="small">All four Coffman conditions hold. ${d.policy === "DETECTION" ? "DETECTION only reports it: the flights stay blocked. Reset, or rerun the scenario under RECOVERY." : ""}</div></div></div>`;
  }
  const rec = recent.find((e) => e.kind === "RECOVERED");
  if (rec) return `<div class="banner green"><div><div class="b-title">Recovered at t=${rec.tick}</div><div class="small">${esc(rec.msg)}</div></div></div>`;
  const refused = recent.find((e) => e.kind === "POLICY_REFUSED");
  if (refused) return `<div class="banner amber"><div><div class="b-title">Prevention refused a request at t=${refused.tick}</div><div class="small">${esc(refused.msg)}</div></div></div>`;
  const unsafe = snap.pending.find((p) => p.reason === "unsafe");
  if (unsafe) return `<div class="banner amber"><div><div class="b-title">Avoidance: ${esc(flightName(snap, unsafe.spid))}'s ${esc(unsafe.class)} request is deferred</div><div class="small">Granting it would leave no safe sequence. An unsafe state is not yet a deadlock; Banker's simply never enters one.</div></div></div>`;
  return `<div class="banner"><div><div class="b-title">No deadlock</div><div class="small">Policy ${d.policy}. Detection has run ${d.detection_runs} time(s).</div></div></div>`;
}

function liveMatrices(snap) {
  const m = snap.deadlock.matrices;
  if (!m.spids.length) return `<div class="empty small">No active flights.</div>`;
  const rows = m.spids.map((s) => flightName(snap, s).split("-")[0]);
  return `<div class="matrices">
    <div><div class="m-title">Allocation</div>${matrixTable(m.allocation, rows, RES_SHORT)}</div>
    <div><div class="m-title">Request (now)</div>${matrixTable(m.request, rows, RES_SHORT)}</div>
    <div><div class="m-title">Max claim</div>${matrixTable(m.maximum, rows, RES_SHORT)}</div>
    <div><div class="m-title">Available</div>${matrixTable([m.available], ["free"], RES_SHORT)}</div></div>`;
}

function lastBanker(snap) {
  const b = snap.deadlock.banker;
  if (!b) return `<div class="empty small">Banker's algorithm runs only under AVOIDANCE. Load the A/B/C scenario with AVOIDANCE to see each check.</div>`;
  const rows = b.spids.map((s) => flightName(snap, s).split("-")[0]);
  const seq = b.sequence.map((i) => esc(rows[i])).join(" → ");
  return `<div class="row" style="margin-bottom:8px">${chip(snap, b.requester)}<span>asked for a <b>${esc(b.class)}</b> at t=${b.tick}</span>
      ${badge(b.verdict === "GRANT" ? "real" : "err", b.verdict)}</div>
    <div class="small muted" style="margin-bottom:10px">${esc(b.reason)}${b.verdict === "GRANT" ? ` · safe sequence ${seq}` : ""}</div>
    <div class="matrices">
      <div><div class="m-title">Allocation (before)</div>${matrixTable(b.allocation, rows, RES_SHORT, b.spids.indexOf(b.requester))}</div>
      <div><div class="m-title">Need (after)</div>${matrixTable(b.need, rows, RES_SHORT, b.spids.indexOf(b.requester))}</div>
      <div><div class="m-title">Available after</div>${matrixTable([b.available_after], ["work"], RES_SHORT)}</div></div>`;
}

function bankerRefPanel() {
  if (!bankerRef) return `<div class="empty small">Load the example to see the engine's safety computation.</div>`;
  const r = bankerRef, P = ["P1", "P2", "P3"];
  const stepsTable = (safety) => `<table class="data" style="margin-top:8px"><thead><tr><th>Step</th><th>Process</th><th>Work before</th><th>Need ≤ Work</th><th>Work after</th></tr></thead><tbody>
    ${safety.steps.map((st, i) => `<tr><td class="num">${i + 1}</td><td class="mono">${P[st.process]}</td><td class="mono">(${st.work_before.join(",")})</td><td class="mono">(${safety.need[st.process].join(",")})</td><td class="mono">(${st.work_after.join(",")})</td></tr>`).join("")}
    </tbody></table><div class="small" style="margin-top:6px">${safety.safe ? `<b style="color:var(--green)">SAFE</b>, sequence ⟨${safety.sequence.map((i) => P[i]).join(", ")}⟩` : `<b style="color:var(--red)">UNSAFE</b>: no remaining process has Need ≤ Work`}</div>`;
  let html = `<div class="matrices">
      <div><div class="m-title">Allocation</div>${matrixTable(r.allocation, P, RES_SHORT)}</div>
      <div><div class="m-title">Max</div>${matrixTable(r.maximum, P, RES_SHORT)}</div>
      <div><div class="m-title">Need = Max − Allocation</div>${matrixTable(r.safety.need, P, RES_SHORT)}</div>
      <div><div class="m-title">Available</div>${matrixTable([r.available], ["(3,2,2) − Σalloc"], RES_SHORT)}</div></div>
    <div class="card-title" style="margin-top:12px">Safety check of the current state</div>${stepsTable(r.safety)}`;
  if (r.request) {
    const q = r.request;
    html += `<div class="note ${q.verdict === "GRANT" ? "green" : "red"}" style="margin-top:12px"><b>${esc(q.label)}: ${P[q.process]} requests (${q.vector.join(",")})</b> → ${badge(q.verdict === "GRANT" ? "real" : "err", q.verdict)} ${esc(q.reason)}</div>`;
    if (q.safety) html += `<div class="card-title" style="margin-top:12px">Safety check after pretending to grant · Available (${q.available_after.join(",")})</div>${stepsTable(q.safety)}`;
  }
  return html;
}

export default {
  id: "deadlocks",
  label: "Deadlocks",
  icon: ICON,
  concept: {
    title: "Four ways to handle deadlock (Lab M6)",
    text: "Prevention and avoidance act <b>before</b> resources are granted, so a deadlock never forms. Detection and recovery let it form, then find it with the detection algorithm (Available / Allocation / Request). Only recovery takes action. An unsafe state (Banker's) is a warning, not a deadlock.",
    tags: [SIM("matrices built from the live ownership table"), PROV("resource ordering, Banker's, matrix detection and the victim rule are textbook choices"), badge("", "Lab M6 · CO C371.3")],
  },
  mount(root, ctx) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Deadlock observatory</h1>
        <div class="view-sub">Scenario: A holds Gate 3 and wants the fuel truck, B holds the truck and wants the tug, C holds the tug and wants Gate 3. Choose a policy, load the scenario, then step through it.</div></div></div>
      <div class="policy-cards" id="dl-policies"></div>
      <div class="row" style="margin:12px 0 14px">
        <label class="field"><span>Recovery action</span><select id="dl-action"><option value="PREEMPT">Preempt + roll back victim</option><option value="TERMINATE">Terminate victim</option></select></label>
        <button class="btn primary" id="dl-load" style="align-self:flex-end">Load A/B/C scenario with this policy</button>
        <button class="btn" id="dl-step" style="align-self:flex-end">Step one tick</button>
        <button class="btn" id="dl-end" style="align-self:flex-end">Run to end</button>
        <span class="spacer"></span><span class="small muted" style="align-self:flex-end" id="dl-active"></span>
      </div>
      <div id="dl-banner" style="margin-bottom:14px"></div>
      <div class="grid cols-2">
        <div class="card rag"><div class="card-head"><span class="card-title">Resource-allocation graph</span>
          <span class="small muted">solid = holds · dashed = requests · red = deadlocked</span></div><div id="dl-graph"></div></div>
        <div class="card"><div class="card-head"><span class="card-title">Live matrices</span><span class="small muted">rows = active flights</span></div><div id="dl-matrices"></div>
          <div class="card-title" style="margin:16px 0 8px">Last Banker's check</div><div id="dl-banker"></div>
          <div class="card-title" style="margin:16px 0 8px">Recovery log</div><div id="dl-log"></div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="card-head"><span class="card-title">Banker's safety-check example <span class="muted">· BANKER-REF, totals Gate 3, Truck 2, Tug 2</span></span>
          <span class="row"><button class="btn small" data-ref="0">Current state</button><button class="btn small" data-ref="1">R1: P1 asks 1 truck</button><button class="btn small" data-ref="2">R2: P3 asks 1 truck</button><button class="btn small" data-ref="3">R3: P2 asks 2 tugs</button></span></div>
        <div id="dl-ref"></div>
      </div>`;

    root.querySelector("#dl-policies").innerHTML = POLICIES.map((p) => `
      <button class="policy-card" data-p="${p.id}"><div class="p-name">${p.id[0] + p.id.slice(1).toLowerCase()}</div>
      <div class="p-when">acts ${p.when}</div><div class="p-desc">${p.desc}</div></button>`).join("");
    root.querySelectorAll(".policy-card").forEach((b) => (b.onclick = () => { chosen = b.dataset.p; this.update(ctx.snap, ctx); }));
    root.querySelector("#dl-action").onchange = (e) => { chosenAction = e.target.value; };
    root.querySelector("#dl-load").onclick = async () => {
      const policy = chosen || ctx.snap.deadlock.policy;
      const r = await ctx.run(`scenario deadlock ${policy} action=${chosenAction}`);
      if (r) toast(`Loaded ${r.scenario}. Press Step to advance one tick.`);
    };
    root.querySelector("#dl-step").onclick = () => ctx.run("sim step");
    root.querySelector("#dl-end").onclick = () => ctx.run("sim run-until-quiet 200");
    root.querySelectorAll("[data-ref]").forEach((b) => (b.onclick = async () => {
      const r = await ctx.run(`deadlock banker-ref request=${b.dataset.ref}`);
      if (r) { bankerRef = r; document.getElementById("dl-ref").innerHTML = bankerRefPanel(); }
    }));
    ctx.run("deadlock banker-ref request=0").then((r) => { if (r) { bankerRef = r; const el = document.getElementById("dl-ref"); if (el) el.innerHTML = bankerRefPanel(); } });
  },
  update(snap) {
    const policy = chosen || snap.deadlock.policy;
    document.querySelectorAll(".policy-card").forEach((b) => b.classList.toggle("on", b.dataset.p === policy));
    document.getElementById("dl-action").disabled = policy !== "RECOVERY";
    document.getElementById("dl-active").innerHTML = `engine policy: <b>${esc(snap.deadlock.policy)}</b>${snap.deadlock.policy === "RECOVERY" ? " · " + esc(snap.deadlock.action) : ""} · t=${snap.tick}`;
    document.getElementById("dl-banner").innerHTML = banner(snap);
    document.getElementById("dl-graph").innerHTML = ragSvg(snap);
    document.getElementById("dl-matrices").innerHTML = liveMatrices(snap);
    document.getElementById("dl-banker").innerHTML = lastBanker(snap);
    document.getElementById("dl-log").innerHTML = snap.deadlock.recovery_log.length
      ? snap.deadlock.recovery_log.map((l) => `<div class="small mono">${esc(l)}</div>`).join("")
      : `<div class="small muted">No recovery action yet.</div>`;
  },
};
