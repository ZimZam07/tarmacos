// process.js - Module 01: process management. Flights move through the engine's real OS states.
import { flightEvents } from "../core/journal.js";
import { selection } from "../core/state.js";
import { servicesOf, threadOf } from "../core/model.js";
import { describe, fname, opLabel, resName, serviceLabel } from "../core/plain.js";
import { badge, dash, esc, flightColor, REAL, RES_LABEL, setHTML, SIM, stateBadge, toast } from "../ui.js";
import { flightToken, pageHead, simControls, TokenLayer, wireSim } from "./common.js";

// node layout in fractions of the board
const NODES = {
  NEW: { x: 0.1, y: 0.5, color: "var(--s-new)", label: "NEW", sub: "created, not admitted" },
  READY: { x: 0.36, y: 0.22, color: "var(--s-ready)", label: "READY", sub: "in the ready queue" },
  RUNNING: { x: 0.64, y: 0.22, color: "var(--s-running)", label: "RUNNING", sub: "holds the CPU this tick" },
  BLOCKED: { x: 0.5, y: 0.78, color: "var(--s-blocked)", label: "BLOCKED", sub: "waiting (textbook WAITING)" },
  TERMINATED: { x: 0.9, y: 0.5, color: "var(--s-done)", label: "TERMINATED", sub: "thread joined" },
};
const EDGES = [
  ["NEW", "READY", "admit (arrival tick)", -0.05],
  ["READY", "RUNNING", "dispatch", -0.09],
  ["RUNNING", "READY", "quantum / preempt", 0.09],
  ["RUNNING", "BLOCKED", "request denied · services", 0.06],
  ["BLOCKED", "READY", "grant · wake-up", 0.06],
  ["RUNNING", "TERMINATED", "exit", 0.05],
];

let tokens = null;
let selected = null;

export default {
  mount(root, ctx) {
    root.innerHTML = pageHead({
      kicker: "01 · PROCESS MANAGEMENT",
      title: "Every flight is a process",
      text: "The engine gives each flight a process ID and runs it on its own real thread. The state below is the engine's process state: watch flights move as the scheduler and the resource allocator act on them.",
      annos: ["<b>Process ID</b> one per flight", "<b>1 thread</b> per flight (a real Linux thread)", "<b>BLOCKED</b> = textbook WAITING", SIM(), REAL("pthread_create / pthread_cond_wait / pthread_join")],
      right: `<button class="btn small" id="pr-busy">Load busy apron</button>${simControls()}`,
    }) + `
      <div class="grid side">
        <div class="card"><div class="card-head"><span class="card-title">Process state diagram · live</span><span class="tiny muted" id="pr-sum"></span></div>
          <div class="lifecycle" id="pr-board"><svg class="lc-edges" id="pr-edges"></svg></div>
          <div class="tiny muted" style="margin-top:6px">Click a token to inspect its process control block. Tokens glide between states as engine events arrive.</div></div>
        <div class="card" id="pr-pcb"></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-head"><span class="card-title">Process table</span><span class="tiny muted">one row per flight · values reported by the engine</span></div><div class="table-wrap" id="pr-table"></div></div>`;
    root.querySelector("#pr-busy").onclick = async () => { if (await ctx.run("scenario contention")) toast("Busy apron loaded: press Step or Run"); };
    wireSim(root, ctx);
    const board = root.querySelector("#pr-board");
    for (const [k, n] of Object.entries(NODES)) {
      const el = document.createElement("div");
      el.className = "lc-node";
      el.dataset.node = k;
      el.innerHTML = `<span class="lc-name" style="color:${n.color}">${n.label}</span><span class="lc-count" id="pr-c-${k}">0</span>`;
      board.appendChild(el);
    }
    tokens = new TokenLayer(board, (key) => { selected = Number(key); selection.set("flight", selected); this.update(ctx.snap); });
    root.querySelector("#pr-table").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-spid]"); if (tr) { selected = Number(tr.dataset.spid); this.update(ctx.snap); } });
    this.layout = () => this.place(root);
    window.addEventListener("resize", this.layout);
    if (selection.type === "flight") selected = selection.id;
  },
  unmount() { window.removeEventListener("resize", this.layout); tokens = null; },

  place(root) {
    const board = root.querySelector("#pr-board");
    const W = board.clientWidth, H = board.clientHeight;
    const pos = {};
    for (const [k, n] of Object.entries(NODES)) {
      const x = n.x * W, y = n.y * H;
      pos[k] = { x, y };
      const el = board.querySelector(`[data-node="${k}"]`);
      el.style.left = x + "px";
      el.style.top = y + "px";
    }
    const svg = root.querySelector("#pr-edges");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `<defs><marker id="pr-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="rgba(140,180,225,.45)"/></marker></defs>` +
      EDGES.map(([a, b, label, bend]) => {
        const A = pos[a], B = pos[b];
        const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len, r = 78;
        const sx = A.x + ux * r, sy = A.y + uy * r, ex = B.x - ux * r, ey = B.y - uy * r;
        const mx = (sx + ex) / 2 - uy * bend * len, my = (sy + ey) / 2 + ux * bend * len;
        return `<path d="M${sx} ${sy} Q${mx} ${my} ${ex} ${ey}" marker-end="url(#pr-ah)"/><text x="${mx}" y="${my + (bend < 0 ? -4 : 12)}" text-anchor="middle">${esc(label)}</text>`;
      }).join("");
    this.pos = pos;
  },

  update(snap) {
    if (!tokens) return;
    const root = document.getElementById("pr-board").closest(".page");
    if (!this.pos) this.place(root);
    const groups = { NEW: [], READY: [], RUNNING: [], BLOCKED: [], TERMINATED: [] };
    for (const f of snap.flights) groups[f.state].push(f);
    // order the READY group like the real ready queue
    const rq = snap.cpu.ready;
    groups.READY.sort((a, b) => rq.indexOf(a.spid) - rq.indexOf(b.spid));
    const items = [];
    for (const [k, list] of Object.entries(groups)) {
      document.getElementById("pr-c-" + k).textContent = `${list.length} process${list.length === 1 ? "" : "es"}`;
      const p = this.pos[k];
      const shown = list.slice(0, 8);
      shown.forEach((f, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        items.push({ key: String(f.spid), x: p.x - 62 + col * 64 + (shown.length === 1 ? 30 : 0), y: p.y - 18 + row * 27, html: flightToken(f), cls: (f.spid === selected ? "sel " : "") + (f.end_status === "ABORTED" ? "aborted" : "") });
      });
    }
    tokens.set(items);
    setHTML(document.getElementById("pr-sum"), `${snap.flights.length} processes · t=${snap.tick} · ${snap.cpu.algo}`);

    if (selected != null && !snap.flights.some((f) => f.spid === selected)) selected = null;
    if (selected == null && snap.flights.length) selected = (snap.flights.find((f) => f.state === "RUNNING") || snap.flights[0]).spid;
    setHTML(document.getElementById("pr-pcb"), pcb(snap, snap.flights.find((f) => f.spid === selected)));
    setHTML(document.getElementById("pr-table"), table(snap));
  },
};

function pcb(snap, f) {
  if (!f) return `<div class="card-head"><span class="card-title">Process control block</span></div><div class="empty">No processes yet. Load the busy apron, or create flights from the airport's Flights panel.</div>`;
  const thr = threadOf(snap, f.spid);
  const svc = servicesOf(snap, f.spid);
  const evs = flightEvents(f.spid).filter((e) => /ADMITTED|DISPATCHED|QUANTUM|PREEMPT|BLOCKED|READY|SERVICES|TERMINATED|DEFERRED/.test(e.kind)).slice(-8);
  return `<div class="card-head"><span class="card-title">Process control block</span>${stateBadge(f)}</div>
    <div class="row nowrap" style="margin-bottom:12px"><span class="swatch" style="background:${flightColor(f.spid)};height:30px;width:10px"></span>
      <div><div class="title-md" style="font-size:18px">${esc(fname(f))}</div><div class="tiny muted">${esc(opLabel(f.op))} · ${f.block_reason ? esc(f.block_reason) : "—"}</div></div></div>
    <dl class="kv">
      <dt>Process ID</dt><dd class="mono">${f.spid}</dd>
      <dt>Linux thread id</dt><dd class="mono">${f.tid || "—"}${thr ? "" : f.state === "TERMINATED" ? " · joined" : ""}</dd>
      <dt>State</dt><dd>${esc(f.state)}</dd>
      <dt>Priority</dt><dd>${f.priority} <span class="tiny muted">(0 = highest)</span></dd>
      <dt>Program counter</dt><dd class="mono">step ${f.step_index} / ${f.script.length}</dd>
      <dt>CPU time</dt><dd>${f.cpu_used} of ${f.burst} ticks</dd>
      <dt>Arrival · first run</dt><dd>t=${f.arrival} · ${dash(f.first_dispatch)}</dd>
      <dt>Waiting · blocked</dt><dd>${f.waiting} · ${f.blocked_ticks} ticks</dd>
      <dt>Resources held</dt><dd>${f.held.map((r) => `<span class="res-tag">${esc(resName(r))}</span>`).join(" ") || "—"}</dd>
      <dt>Requested</dt><dd>${f.requested.map((r) => `<span class="res-tag want">${esc(RES_LABEL[r])}</span>`).join(" ") || "—"}</dd>
      <dt>Worker threads</dt><dd>${svc.map((t) => badge("warn", serviceLabel(t.service))).join(" ") || "—"}</dd>
    </dl>
    ${thr ? `<div class="note" style="margin-top:12px"><b>Thread now:</b> <span class="mono small">${esc(thr.state)}</span></div>` : ""}
    <div class="eyebrow" style="margin:14px 0 6px;display:block">Recent state transitions</div>
    <div class="ftl">${evs.map((e) => `<div class="ftl-i"><span class="mono tiny muted">t${e.tick}</span><span class="small">${esc(describe(e, snap))}</span></div>`).join("") || '<div class="tiny muted">None yet.</div>'}</div>`;
}

function table(snap) {
  if (!snap.flights.length) return `<div class="empty">The process table is empty.</div>`;
  return `<table class="data"><thead><tr><th>Flight</th><th class="num">Process ID</th><th class="num">Thread ID</th><th>Type</th><th class="num">Prio</th><th>State</th><th>Phase</th><th class="num">Arr</th><th class="num">Burst</th><th class="num">Used</th><th class="num">WT</th><th class="num">TAT</th><th>Holds / wants</th></tr></thead><tbody>
    ${snap.flights.map((f) => `<tr class="clickable ${f.spid === selected ? "selected" : ""}" data-spid="${f.spid}">
      <td><span class="dot" style="background:${flightColor(f.spid)};margin-right:6px"></span><b>${esc(fname(f))}</b></td>
      <td class="num">${f.spid}</td><td class="num mono tiny">${f.tid || "—"}</td><td class="tiny">${esc(opLabel(f.op))}</td><td class="num">${f.priority}</td>
      <td>${stateBadge(f)}</td><td class="tiny">${esc(f.phase)}</td><td class="num">${f.arrival}</td><td class="num">${f.burst}</td><td class="num">${f.cpu_used}</td>
      <td class="num">${f.waiting}</td><td class="num">${f.turnaround ?? "—"}</td>
      <td>${f.held.map((r) => `<span class="res-tag">${esc(resName(r))}</span>`).join(" ")} ${f.requested.map((r) => `<span class="res-tag want">${esc(RES_LABEL[r])}</span>`).join(" ")}</td></tr>`).join("")}
    </tbody></table>`;
}
