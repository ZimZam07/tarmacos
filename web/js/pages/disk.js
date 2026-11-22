// disk.js - Module 06: disk scheduling with the baggage cart as the disk head.
// The service order is computed by a real child process (fork + pipes); the cart's movement by the engine.
import { command } from "../api.js";
import { badge, confirmAction, esc, flightColor, flightName, PROV, REAL, setHTML, SIM } from "../ui.js";
import { pageHead, setNum } from "./common.js";

const EXPLAIN = {
  FCFS: "<b>FCFS</b> serves requests in arrival order: simple, but the head zig-zags",
  SSTF: "<b>SSTF</b> always goes to the closest request (tie → lower spot): short moves, can starve far requests",
  SCAN: "<b>SCAN</b> sweeps in one direction to the edge, then reverses: the elevator",
};
let pendingAlgo = null;
let cmpResult = null;

export default {
  mount(root, ctx) {
    root.innerHTML = pageHead({
      kicker: "06 · DISK SCHEDULING",
      title: "The baggage cart is a disk head",
      text: "Belt spots 0–49 act as disk cylinders and the baggage cart is the disk head. When the cart is idle it takes every waiting request as one batch, writes it to a pipe, and a real child process created with <code>fork()</code> replies with the FCFS, SSTF or SCAN order.",
      annos: [REAL("fork(), two pipes, read/write, waitpid"), SIM("head movement and totals"), PROV("SSTF tie → lower; SCAN visits the edge only when it must reverse")],
    }) + `
      <div class="ctl-bar">
        <span class="small muted">Reference queue 5 37 12 44 21 3, head 20:</span>
        <button class="btn small" data-ref="FCFS dir=UP">FCFS</button><button class="btn small" data-ref="SSTF dir=UP">SSTF</button><button class="btn small" data-ref="SCAN dir=UP">SCAN ↑</button><button class="btn small" data-ref="SCAN dir=DOWN">SCAN ↓</button>
        <span class="vsep"></span><button class="btn small" data-sim="step">Step</button><button class="btn small" data-sim="end">Run to end</button>
        <span class="spacer"></span><span class="tiny muted" id="dk-cur"></span>
      </div>
      <div class="annos" id="dk-explain" style="margin:-4px 0 14px"></div>
      <div class="card" style="margin-bottom:14px"><div class="card-head"><span class="card-title">Cylinder track · belt 0–49</span><span class="tiny muted">● pending · ring = in the current batch · cyan = gates</span></div><div class="track" id="dk-track"></div></div>
      <div class="grid side">
        <div class="stack" style="gap:14px">
          <div class="card diskchart"><div class="card-head"><span class="card-title">Head movement</span><span class="tiny muted" id="dk-sum"></span></div><div id="dk-chart"></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Compare algorithms on the reference queue</span><button class="btn small" id="dk-cmp">Run all on the engine</button></div><div id="dk-cmp-out"></div></div>
        </div>
        <div class="stack" style="gap:14px">
          <div class="card"><div class="grid c2" style="gap:10px">
            <div><div class="stat-label">Total head movement</div><div class="big-stat" id="dk-total">0</div></div>
            <div><div class="stat-label">Requests served</div><div class="big-stat" id="dk-served">0</div></div></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Settings</span></div>
            <div class="seg" id="dk-algo"><button data-a="FCFS">FCFS</button><button data-a="SSTF">SSTF</button><button data-a="SCAN">SCAN</button></div>
            <div class="row" style="margin-top:10px"><label class="field"><span>Direction</span><select id="dk-dir"><option>UP</option><option>DOWN</option></select></label>
              <label class="field"><span>Head</span><input type="number" id="dk-head" min="0" max="49" value="20" style="width:72px"></label>
              <button class="btn small primary" id="dk-apply" style="align-self:flex-end">Apply</button></div>
            <div class="row" style="margin-top:10px"><input type="text" id="dk-req" placeholder="add requests e.g. 8,30,46" style="flex:1"><button class="btn small" id="dk-add">Add</button></div>
            <div class="tiny muted" style="margin-top:8px">Settings can change only while the queue is empty.</div></div>
          <div class="card"><div class="card-head"><span class="card-title">Request queue</span></div><div id="dk-queue"></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Child process &amp; pipes</span>${REAL()}</div><div id="dk-ipc"></div></div>
        </div>
      </div>`;
    root.querySelectorAll("[data-ref]").forEach((b) => (b.onclick = () => ctx.run(`scenario disk-ref ${b.dataset.ref}`)));
    root.querySelector("[data-sim=step]").onclick = () => ctx.run("sim step");
    root.querySelector("[data-sim=end]").onclick = () => ctx.run("sim run-until-quiet 300");
    root.querySelectorAll("#dk-algo button").forEach((b) => (b.onclick = () => { pendingAlgo = b.dataset.a; this.update(ctx.snap); }));
    root.querySelector("#dk-apply").onclick = async () => {
      if (await ctx.run(`disk set algo=${pendingAlgo || ctx.snap.disk.algo} dir=${root.querySelector("#dk-dir").value} head=${root.querySelector("#dk-head").value}`)) pendingAlgo = null;
    };
    root.querySelector("#dk-add").onclick = async () => {
      const v = root.querySelector("#dk-req").value.replace(/\s+/g, "");
      if (v && (await ctx.run(`disk req ${v}`))) root.querySelector("#dk-req").value = "";
    };
    root.querySelector("#dk-cmp").onclick = () => compare(root);
    setHTML(root.querySelector("#dk-cmp-out"), cmpResult ? cmpHtml(cmpResult) : `<div class="small dim">Loads the reference queue under each algorithm, lets the engine and the child process serve it, then reads the total head movement. The current simulation is reset.</div>`);
    this.buildTrack(root);
    this.lastPathKey = "";
  },

  buildTrack(root) {
    const t = root.querySelector("#dk-track");
    let h = `<div class="track-line"></div>`;
    for (let p = 0; p <= 49; p += 5) h += `<div class="track-tick" style="left:${(p / 49) * 100}%"><span>${p}</span></div>`;
    for (let i = 0; i < 6; i++) h += `<div class="track-gate" style="left:${((5 + 8 * i) / 49) * 100}%">Gate ${i + 1}</div>`;
    h += `<div id="dk-reqs"></div><div class="track-head" id="dk-headm" style="left:${(20 / 49) * 100}%"><div class="hb">20</div><div class="hp"></div></div>`;
    t.innerHTML = h;
  },

  update(snap) {
    const d = snap.disk;
    const algo = pendingAlgo || d.algo;
    document.querySelectorAll("#dk-algo button").forEach((b) => b.classList.toggle("on", b.dataset.a === algo));
    setHTML(document.getElementById("dk-explain"), `<span class="anno">${EXPLAIN[algo]}</span>`);
    document.getElementById("dk-cur").textContent = `engine: ${d.algo}${d.algo === "SCAN" ? " " + d.direction : ""} · head ${d.head} · ${d.busy ? "serving a batch" : "idle"}`;
    if (document.activeElement?.id !== "dk-dir") document.getElementById("dk-dir").value = d.direction;
    if (document.activeElement?.id !== "dk-head" && !d.busy) document.getElementById("dk-head").value = d.head;
    const pct = (p) => ((p - d.min) / (d.max - d.min)) * 100;
    const head = document.getElementById("dk-headm");
    head.style.left = pct(d.head) + "%";
    head.querySelector(".hb").textContent = d.head;
    const batch = new Set(d.batch_remaining.map((r) => r.position + ":" + r.spid));
    setHTML(document.getElementById("dk-reqs"), [...d.batch_remaining, ...d.waiting].map((r) => `<div class="track-req ${batch.has(r.position + ":" + r.spid) ? "batch" : ""}" style="left:${pct(r.position)}%;background:${flightColor(r.spid)}" title="spot ${r.position} · ${esc(flightName(snap, r.spid))}"></div>`).join(""));

    const key = d.path.join(",") + "|" + d.batches;
    if (key !== this.lastPathKey) { setHTML(document.getElementById("dk-chart"), chart(snap)); this.lastPathKey = key; }
    else this.markProgress(snap);
    setHTML(document.getElementById("dk-sum"), `planned <b>${d.planned_movement}</b> · moved ${d.busy ? d.moved_in_batch : Math.max(0, d.last_batch_movement)} this batch`);
    setNum(document.getElementById("dk-total"), d.total_movement);
    setNum(document.getElementById("dk-served"), d.served_count);

    const row = (r, st) => `<tr><td class="num">${r.position}</td><td><span class="dot" style="background:${flightColor(r.spid)};margin-right:6px"></span>${esc(flightName(snap, r.spid))}</td><td>${st}</td></tr>`;
    const rows = [...d.batch_remaining.map((r) => row(r, badge("warn", "in batch"))), ...d.waiting.map((r) => row(r, badge("", "next batch")))];
    setHTML(document.getElementById("dk-queue"), (rows.length ? `<table class="data"><thead><tr><th class="num">Spot</th><th>Flight</th><th>Status</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : `<div class="empty small">Queue empty.</div>`)
      + `<div class="tiny muted" style="margin-top:10px">Service order: <span class="mono">${d.order.join(" → ") || "—"}</span></div>`);
    const ipc = snap.ipc;
    setHTML(document.getElementById("dk-ipc"), `<dl class="kv"><dt>Engine PID</dt><dd class="mono">${ipc.engine_pid}</dd><dt>Helper process PID</dt><dd class="mono">${ipc.child_pid} ${badge(ipc.status === "RUNNING" ? "real" : "err", ipc.status)}</dd>
      <dt>Pipe fds</dt><dd class="mono tiny">write ${ipc.request_fd} → child · read ${ipc.result_fd} ←</dd><dt>Exchanges</dt><dd>${ipc.exchanges}</dd></dl>
      <div class="eyebrow" style="margin:12px 0 4px;display:block">parent → child</div><div class="mono tiny" style="word-break:break-all">${esc(ipc.last_sent) || "—"}</div>
      <div class="eyebrow" style="margin:10px 0 4px;display:block">child → parent</div><div class="mono tiny" style="word-break:break-all">${esc(ipc.last_received) || "—"}</div>
      ${ipc.last_error ? `<div class="note red small" style="margin-top:10px">${esc(ipc.last_error)}</div>` : ""}`);
  },

  markProgress(snap) {
    const d = snap.disk;
    const done = d.busy ? d.next_waypoint : d.path.length;
    document.querySelectorAll("#dk-chart circle[data-i]").forEach((c) => {
      const i = Number(c.dataset.i);
      if (i > 0 && !c.classList.contains("edge")) c.setAttribute("fill", i < done ? "var(--amber)" : "#142538");
    });
  },
};

function chart(snap) {
  const d = snap.disk;
  if (!d.path.length) return `<div class="empty">No batch planned yet. Load a reference queue, or run flights with baggage.</div>`;
  const W = 760, left = 24, right = 24, top = 24, rowH = 26;
  const H = top + d.path.length * rowH + 16;
  const x = (p) => left + ((p - d.min) * (W - left - right)) / (d.max - d.min);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Head movement chart">`;
  for (let p = d.min; p <= d.max; p += 5) s += `<line x1="${x(p)}" y1="${top - 8}" x2="${x(p)}" y2="${H - 10}" stroke="rgba(140,180,225,.07)"/><text x="${x(p)}" y="${top - 12}" text-anchor="middle">${p}</text>`;
  const pts = d.path.map((p, i) => [x(p), top + i * rowH + 8]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  s += `<polyline points="${pts.map((q) => q.join(",")).join(" ")}" fill="none" stroke="#24364d" stroke-width="2"/>`;
  s += `<polyline class="path-done" style="--len:${len.toFixed(0)}" points="${pts.map((q) => q.join(",")).join(" ")}" fill="none" stroke="var(--amber)" stroke-width="2.5" stroke-linejoin="round"/>`;
  let order = 0;
  const done = d.busy ? d.next_waypoint : d.path.length;
  d.path.forEach((p, i) => {
    const isEdge = i > 0 && !(order < d.order.length && d.order[order] === p);
    if (i > 0 && !isEdge) order++;
    const [cx, cy] = pts[i];
    const fill = i === 0 ? "var(--blue)" : isEdge ? "#07111f" : i < done ? "var(--amber)" : "#142538";
    s += `<circle data-i="${i}" class="${isEdge ? "edge" : ""}" cx="${cx}" cy="${cy}" r="${i === 0 ? 6 : 5}" fill="${fill}" stroke="${isEdge ? "#7d8aa3" : "var(--amber)"}" stroke-width="1.5"/>`;
    const nr = cx > W - 90;
    s += `<text x="${cx + (nr ? -10 : 10)}" y="${cy + 4}" text-anchor="${nr ? "end" : "start"}" style="fill:var(--text-2)">${i === 0 ? "start " + p : isEdge ? "edge " + p : p}</text>`;
  });
  return s + `</svg>`;
}

async function compare(root) {
  if (!(await confirmAction("Run the comparison?", "The engine serves the reference queue (5 37 12 44 21 3, head 20) four times: FCFS, SSTF, SCAN up and SCAN down, each planned by the child process. The current simulation is replaced.", "Run comparison"))) return;
  const out = root.querySelector("#dk-cmp-out");
  const res = [];
  for (const [label, arg] of [["FCFS", "FCFS dir=UP"], ["SSTF", "SSTF dir=UP"], ["SCAN ↑", "SCAN dir=UP"], ["SCAN ↓", "SCAN dir=DOWN"]]) {
    setHTML(out, `<div class="story-status"><span class="spin"></span>Running ${label}: the child process plans the order…</div>`);
    const a = await command(`scenario disk-ref ${arg}`);
    const b = a.ok && (await command("sim run-until-quiet 300"));
    const st = b && b.ok && (await command("state"));
    if (!st || !st.ok) { setHTML(out, `<div class="note red">The engine did not answer.</div>`); return; }
    res.push({ label, total: st.result.disk.total_movement, order: st.result.disk.served.map((x) => x.position) });
  }
  cmpResult = res;
  setHTML(out, cmpHtml(res));
}

function cmpHtml(res) {
  const max = Math.max(...res.map((r) => r.total)), min = Math.min(...res.map((r) => r.total));
  return res.map((r) => `<div class="hbar"><span class="small"><b>${r.label}</b></span><span class="tr"><span style="width:${(100 * r.total) / max}%;background:${r.total === min ? "var(--green)" : "var(--amber)"}"></span></span><span class="mono small" style="text-align:right">${r.total}</span></div>
    <div class="tiny muted mono" style="margin:-4px 0 10px 120px">20 → ${r.order.join(" → ")}</div>`).join("") + `<div class="tiny muted">Read from the engine after each run. Hand calculation: FCFS 145 · SSTF 60 · SCAN↑ 75 · SCAN↓ 64.</div>`;
}
