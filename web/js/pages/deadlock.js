// deadlock.js - Module 04: the four deadlock policies on a REAL circular wait (scenario A/B/C).
// Every edge, matrix and verdict comes from the engine; this page only draws it.
import { badge, chip, esc, flightColor, flightName, matrixTable, PROV, RES_SHORT, setHTML, SIM, toast } from "../ui.js";
import { pageHead, simControls, wireSim } from "./common.js";
import { className, describe, fname, plainText, resName } from "../core/plain.js";

const POLICIES = [
  { id: "PREVENTION", when: "before a request", desc: "Everyone must ask in the order gate → fuel truck → tug. An out-of-order request is refused, so a circle can never form." },
  { id: "AVOIDANCE", when: "before a grant", desc: "Banker's algorithm: only hand something out if every flight could still finish afterwards." },
  { id: "DETECTION", when: "after it forms", desc: "Hand things out freely, then look for a circle of waiting. It reports the deadlock but does not fix it." },
  { id: "RECOVERY", when: "after it forms", desc: "Detect the circle, then pick one flight (lowest priority) and take its resources away so the others can go." },
];
let chosen = null;
let chosenAction = "PREEMPT";
let bankerRef = null;

export default {
  mount(root, ctx) {
    root.innerHTML = pageHead({
      kicker: "04 · DEADLOCK MANAGEMENT",
      title: "A real circular wait, and four ways to handle it",
      text: "Flight 1 holds Gate 3 and wants the fuel truck. Flight 2 holds the fuel truck and wants the tug. Flight 3 holds the tug and wants Gate 3. Each waits for the next, in a circle. Normal flights always ask for gate → fuel truck → tug in that order and can never get stuck like this; this demo breaks the order on purpose, so the circle really forms in the engine.",
      annos: [SIM("graph and matrices are built from the live ownership table"), PROV("ordering, Banker's, matrix detection and the victim rule are textbook choices")],
    }) + `
      <div class="policy-cards" id="dl-policies">${POLICIES.map((p) => `<button class="policy-card" data-p="${p.id}"><div class="p-name">${p.id[0] + p.id.slice(1).toLowerCase()}</div><div class="p-when">acts ${p.when}</div><div class="p-desc">${p.desc}</div></button>`).join("")}</div>
      <div class="ctl-bar" style="margin-top:12px">
        <label class="row small muted" style="gap:6px">If stuck, the chosen flight: <select id="dl-action"><option value="PREEMPT">Take its resources and restart it</option><option value="TERMINATE">Cancel it</option></select></label>
        <button class="btn small primary" id="dl-load">Load the deadlock demo</button>
        <span class="vsep"></span>${simControls()}
        <span class="spacer"></span><span class="tiny muted" id="dl-active"></span>
      </div>
      <div id="dl-banner" style="margin-bottom:14px"></div>
      <div class="grid c2">
        <div class="card rag"><div class="card-head"><span class="card-title">Resource-allocation graph</span><span class="tiny muted">solid = holds · dashed = requests · red = cycle</span></div><div id="dl-graph"></div></div>
        <div class="card"><div class="card-head"><span class="card-title">Why progress is blocked</span></div><div id="dl-why"></div>
          <div class="divider"></div><div class="card-title" style="margin-bottom:8px">Recovery log</div><div id="dl-log"></div></div>
      </div>
      <div class="grid c2" style="margin-top:14px">
        <div class="card"><div class="card-head"><span class="card-title">Live matrices</span><span class="tiny muted">rows = active flights · (Gate, Truck, Tug)</span></div><div id="dl-matrices"></div></div>
        <div class="card"><div class="card-head"><span class="card-title">Last Banker's check (AVOIDANCE)</span></div><div id="dl-banker"></div></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-head"><span class="card-title">Banker's safety-check example · BANKER-REF, totals Gate 3, Truck 2, Tug 2</span>
        <span class="row"><button class="btn small" data-ref="0">Current state</button><button class="btn small" data-ref="1">R1: P1 asks 1 truck</button><button class="btn small" data-ref="2">R2: P3 asks 1 truck</button><button class="btn small" data-ref="3">R3: P2 asks 2 tugs</button></span></div><div id="dl-ref"></div></div>`;
    root.querySelectorAll(".policy-card").forEach((b) => (b.onclick = () => { chosen = b.dataset.p; this.update(ctx.snap); }));
    root.querySelector("#dl-action").onchange = (e) => { chosenAction = e.target.value; };
    root.querySelector("#dl-load").onclick = async () => {
      const r = await ctx.run(`scenario deadlock ${chosen || ctx.snap.deadlock.policy} action=${chosenAction}`);
      if (r) toast(`Loaded ${r.scenario}. Press Step to advance one tick.`);
    };
    wireSim(root, ctx);
    const loadRef = async (n) => { const r = await ctx.run(`deadlock banker-ref request=${n}`); if (r) { bankerRef = r; setHTML(document.getElementById("dl-ref"), bankerRefPanel()); } };
    root.querySelectorAll("[data-ref]").forEach((b) => (b.onclick = () => loadRef(b.dataset.ref)));
    loadRef(0);
  },

  update(snap) {
    const d = snap.deadlock;
    const policy = chosen || d.policy;
    document.querySelectorAll(".policy-card").forEach((b) => b.classList.toggle("on", b.dataset.p === policy));
    document.getElementById("dl-action").disabled = policy !== "RECOVERY";
    setHTML(document.getElementById("dl-active"), `engine policy <b>${esc(d.policy)}</b>${d.policy === "RECOVERY" ? " · " + esc(d.action) : ""} · t=${snap.tick} · detection ran ${d.detection_runs}×`);
    setHTML(document.getElementById("dl-banner"), banner(snap));
    setHTML(document.getElementById("dl-graph"), rag(snap));
    setHTML(document.getElementById("dl-why"), why(snap));
    setHTML(document.getElementById("dl-matrices"), liveMatrices(snap));
    setHTML(document.getElementById("dl-banker"), lastBanker(snap));
    setHTML(document.getElementById("dl-log"), d.recovery_log.length ? d.recovery_log.map((l) => `<div class="small" style="margin-bottom:3px">${esc(plainText(l, snap))}</div>`).join("") : `<div class="tiny muted">No recovery action yet.</div>`);
  },
};

function banner(snap) {
  const d = snap.deadlock;
  const recent = snap.events.slice().reverse();
  if (d.deadlocked.length) {
    const names = d.deadlocked.map((s) => esc(flightName(snap, s)));
    return `<div class="banner red"><div><div class="b-title">Deadlock detected at t=${d.detected_at}: ${names.join(" → ")} → ${names[0]}</div>
      <div class="small">All four Coffman conditions hold. ${d.policy === "DETECTION" ? "DETECTION only reports it: these flights stay BLOCKED for ever. Load it under Recovery to see it fixed." : "RECOVERY acts at the end of this tick."}</div></div></div>`;
  }
  const rec = recent.find((e) => e.kind === "RECOVERED");
  if (rec) return `<div class="banner green"><div><div class="b-title">Recovered at t=${rec.tick}: the system is back in a safe operational state</div><div class="small">${esc(describe(rec, snap))}</div></div></div>`;
  const refused = recent.find((e) => e.kind === "POLICY_REFUSED");
  if (refused) return `<div class="banner amber"><div><div class="b-title">Prevention refused a request at t=${refused.tick}</div><div class="small">${esc(describe(refused, snap))}</div></div></div>`;
  const unsafe = snap.pending.find((p) => p.reason === "unsafe");
  if (unsafe) return `<div class="banner amber"><div><div class="b-title">Avoidance: ${esc(flightName(snap, unsafe.spid))} must wait for a ${esc(className(unsafe.class))}</div><div class="small">Granting it would leave no safe sequence. An unsafe state is not yet a deadlock; Banker's simply never enters one.</div></div></div>`;
  const scen = /deadlock/.test(snap.sim.scenario);
  return `<div class="banner"><div><div class="b-title">No deadlock</div><div class="small">${scen ? "Step through the scenario and watch the graph." : "Load the deadlock demo above to see a real circular wait form."}</div></div></div>`;
}

function rag(snap) {
  const active = snap.flights.filter((f) => f.state !== "TERMINATED" && (f.held.length || f.requested.length));
  const resources = snap.resources.filter((r) => r.enabled && (r.owner >= 0 || active.some((f) => f.requested.includes(r.class))));
  const targetOf = (cls) => resources.find((r) => r.class === cls && r.owner >= 0) || resources.find((r) => r.class === cls);
  const order = [];
  const add = (n) => { if (!order.some((x) => x.key === n.key)) order.push(n); };
  for (const f of active) {
    add({ key: "f" + f.spid, kind: "f", f });
    for (const cls of f.requested) { const r = targetOf(cls); if (r) add({ key: "r" + r.id, kind: "r", r }); }
  }
  for (const r of resources) if (r.owner >= 0) add({ key: "r" + r.id, kind: "r", r });
  if (!order.length) return `<div class="empty" style="padding:70px 0">No resource is allocated or requested right now.</div>`;
  const W = 640, H = 380, cx = W / 2, cy = H / 2, R = order.length <= 2 ? 100 : 140;
  order.forEach((n, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / order.length; n.x = cx + R * Math.cos(a); n.y = cy + R * Math.sin(a); });
  const at = (k) => order.find((n) => n.key === k);
  const dead = new Set(snap.deadlock.deadlocked);
  const deadRes = new Set(snap.deadlock.edges.filter((e) => dead.has(e.from)).map((e) => e.resource));
  const edge = (a, b, cls, marker) => {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, pa = 32, pb = 36;
    const nx = -dy / len * 14, ny = dx / len * 14;
    const x1 = a.x + (dx / len) * pa, y1 = a.y + (dy / len) * pa, x2 = b.x - (dx / len) * pb, y2 = b.y - (dy / len) * pb;
    return `<path class="${cls}" d="M${x1} ${y1} Q${(x1 + x2) / 2 + nx} ${(y1 + y2) / 2 + ny} ${x2} ${y2}" marker-end="url(#${marker})"/>`;
  };
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Resource-allocation graph"><defs>
    ${["a:#ffb547", "r:#438bff", "d:#ff5c6c"].map((m) => { const [id, c] = m.split(":"); return `<marker id="ah-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`; }).join("")}</defs>`;
  if (dead.size) s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(255,92,108,.18)" stroke-width="26"><animate attributeName="stroke-opacity" values=".35;.9;.35" dur="2.4s" repeatCount="indefinite"/></circle>`;
  for (const r of resources) {
    if (r.owner < 0) continue;
    const a = at("r" + r.id), b = at("f" + r.owner);
    if (a && b) s += edge(a, b, "e-assign" + (dead.has(r.owner) && deadRes.has(r.id) ? " e-dead" : ""), dead.has(r.owner) ? "ah-d" : "ah-a");
  }
  for (const f of active) for (const cls of f.requested) {
    const r = targetOf(cls), a = at("f" + f.spid), b = r && at("r" + r.id);
    if (a && b) s += edge(a, b, "e-request" + (dead.has(f.spid) ? " e-dead" : ""), dead.has(f.spid) ? "ah-d" : "ah-r");
  }
  for (const n of order) {
    if (n.kind === "f") {
      s += `<g class="node-f ${dead.has(n.f.spid) ? "dead" : ""}"><circle cx="${n.x}" cy="${n.y}" r="29"/><circle cx="${n.x}" cy="${n.y - 18}" r="3.5" fill="${flightColor(n.f.spid)}"/>
        <text class="n-label" x="${n.x}" y="${n.y + 3}" style="font-size:11px">${esc(fname(n.f))}</text><text class="n-sub" x="${n.x}" y="${n.y + 16}">${esc(n.f.state)}</text></g>`;
    } else {
      s += `<g class="node-r ${deadRes.has(n.r.id) ? "dead" : ""}"><rect x="${n.x - 40}" y="${n.y - 16}" width="80" height="32" rx="7"/>
        <text class="n-label" x="${n.x}" y="${n.y + 4}" style="font-size:11.5px">${esc(resName(n.r.id).replace("Fuel truck", "Truck"))}</text></g>`;
    }
  }
  return s + `</svg>`;
}

function why(snap) {
  const d = snap.deadlock;
  const edges = d.edges;
  if (!edges.length) return `<div class="small dim">No flight is waiting for a resource held by another flight. Wait-for edges appear here as soon as one does.</div>`;
  const dead = new Set(d.deadlocked);
  const lines = edges.map((e) => `<div class="cycle-step" style="margin-bottom:6px">${chip(snap, e.from)}<span class="small muted">waits for</span><span class="res-tag">${esc(resName(e.resource))}</span><span class="small muted">held by</span>${chip(snap, e.to)}${dead.has(e.from) ? '<span class="arr">↻</span>' : ""}</div>`).join("");
  const coffman = dead.size ? `<div class="divider"></div><div class="card-title" style="margin-bottom:8px">Coffman conditions · all hold</div>
    <div class="row">${["Mutual exclusion: one owner per instance", "Hold and wait: each holds one, wants another", "No preemption: only the owner releases", "Circular wait: the edges close a cycle"].map((t) => `<span class="badge err">✓ ${t}</span>`).join("")}</div>
    <div class="small dim" style="margin-top:10px">${d.policy === "RECOVERY" ? `RECOVERY breaks the cycle by choosing a victim (lowest priority, then the newest flight) and ${d.action === "PREEMPT" ? "rolling it back: its resources are released and it restarts its script" : "terminating it"}.` : "Under DETECTION nothing breaks the cycle: no thread in it can ever run again."}</div>` : "";
  return `<div class="small muted" style="margin-bottom:8px">Who is waiting for whom (from the engine):</div>${lines}${coffman}`;
}

function liveMatrices(snap) {
  const m = snap.deadlock.matrices;
  if (!m.spids.length) return `<div class="empty small">No active flights.</div>`;
  const rows = m.spids.map((s) => flightName(snap, s).split("-")[0]);
  return `<div class="matrices"><div><div class="m-title">Allocation</div>${matrixTable(m.allocation, rows, RES_SHORT)}</div>
    <div><div class="m-title">Request (now)</div>${matrixTable(m.request, rows, RES_SHORT)}</div>
    <div><div class="m-title">Max claim</div>${matrixTable(m.maximum, rows, RES_SHORT)}</div>
    <div><div class="m-title">Available</div>${matrixTable([m.available], ["free"], RES_SHORT)}</div></div>`;
}

function lastBanker(snap) {
  const b = snap.deadlock.banker;
  if (!b) return `<div class="empty small">Banker's algorithm runs only under AVOIDANCE. Choose Avoidance above and load the scenario.</div>`;
  const rows = b.spids.map((s) => flightName(snap, s).split("-")[0]);
  const seq = b.sequence.map((i) => esc(rows[i])).join(" → ");
  return `<div class="row" style="margin-bottom:8px">${chip(snap, b.requester)}<span class="small">asked for a <b>${esc(className(b.class))}</b> at tick ${b.tick}</span>${badge(b.verdict === "GRANT" ? "real" : "err", b.verdict)}</div>
    <div class="small muted" style="margin-bottom:10px">${esc(b.reason)}${b.verdict === "GRANT" ? ` · safe sequence ${seq}` : ""}</div>
    <div class="matrices"><div><div class="m-title">Allocation (before)</div>${matrixTable(b.allocation, rows, RES_SHORT, b.spids.indexOf(b.requester))}</div>
    <div><div class="m-title">Need (after)</div>${matrixTable(b.need, rows, RES_SHORT, b.spids.indexOf(b.requester))}</div>
    <div><div class="m-title">Available after</div>${matrixTable([b.available_after], ["work"], RES_SHORT)}</div></div>`;
}

function bankerRefPanel() {
  if (!bankerRef) return `<div class="empty small">Loading the engine's example…</div>`;
  const r = bankerRef, P = ["P1", "P2", "P3"];
  const steps = (safety) => `<table class="data" style="margin-top:8px"><thead><tr><th>Step</th><th>Process</th><th>Work before</th><th>Need ≤ Work</th><th>Work after</th></tr></thead><tbody>
    ${safety.steps.map((st, i) => `<tr><td class="num">${i + 1}</td><td class="mono">${P[st.process]}</td><td class="mono">(${st.work_before.join(",")})</td><td class="mono">(${safety.need[st.process].join(",")})</td><td class="mono">(${st.work_after.join(",")})</td></tr>`).join("")}
    </tbody></table><div class="small" style="margin-top:6px">${safety.safe ? `<b style="color:var(--green)">SAFE</b>, sequence ⟨${safety.sequence.map((i) => P[i]).join(", ")}⟩` : `<b style="color:var(--red)">UNSAFE</b>: no remaining process has Need ≤ Work`}</div>`;
  let html = `<div class="matrices"><div><div class="m-title">Allocation</div>${matrixTable(r.allocation, P, RES_SHORT)}</div><div><div class="m-title">Max</div>${matrixTable(r.maximum, P, RES_SHORT)}</div>
    <div><div class="m-title">Need = Max − Allocation</div>${matrixTable(r.safety.need, P, RES_SHORT)}</div><div><div class="m-title">Available</div>${matrixTable([r.available], ["(3,2,2) − Σalloc"], RES_SHORT)}</div></div>
    <div class="card-title" style="margin-top:12px">Safety check of the current state</div>${steps(r.safety)}`;
  if (r.request) {
    const q = r.request;
    html += `<div class="note ${q.verdict === "GRANT" ? "green" : "red"}" style="margin-top:12px"><b>${esc(q.label)}: ${P[q.process]} requests (${q.vector.join(",")})</b> → ${badge(q.verdict === "GRANT" ? "real" : "err", q.verdict)} ${esc(q.reason)}</div>`;
    if (q.safety) html += `<div class="card-title" style="margin-top:12px">Safety check after pretending to grant · Available (${q.available_after.join(",")})</div>${steps(q.safety)}`;
  }
  return html;
}
