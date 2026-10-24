// storage.js - baggage cart as a disk head; the service order comes from the real child process.
import { badge, esc, flightColor, flightName, PROV, REAL, SIM } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="10" cy="5" rx="7" ry="2.5"/><path d="M3 5v10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V5"/><path d="M3 10c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/></svg>`;
let pendingAlgo = null;

function pathChart(snap) {
  const d = snap.disk;
  if (!d.path.length) return `<div class="empty">No batch planned yet. Load a reference set or run flights with baggage.</div>`;
  const W = 720, left = 24, right = 24, top = 22, rowH = 24;
  const H = top + d.path.length * rowH + 20;
  const x = (p) => left + ((p - d.min) * (W - left - right)) / (d.max - d.min);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Head movement chart">`;
  for (let p = d.min; p <= d.max; p += 5) s += `<line x1="${x(p)}" y1="${top - 8}" x2="${x(p)}" y2="${H - 14}" stroke="#16223a"/><text x="${x(p)}" y="${top - 10}" text-anchor="middle">${p}</text>`;
  const points = d.path.map((p, i) => `${x(p)},${top + i * rowH + 8}`);
  const doneUpTo = d.busy ? d.next_waypoint : d.path.length;
  s += `<polyline points="${points.join(" ")}" fill="none" stroke="#2c3e63" stroke-width="2"/>`;
  s += `<polyline points="${points.slice(0, doneUpTo).join(" ")}" fill="none" stroke="var(--amber)" stroke-width="2.5"/>`;
  let order = 0;
  d.path.forEach((p, i) => {
    const isEdge = i > 0 && !(order < d.order.length && d.order[order] === p);
    if (i > 0 && !isEdge) order++;
    const cy = top + i * rowH + 8;
    const fill = i === 0 ? "var(--blue)" : isEdge ? "#0a111e" : i < doneUpTo ? "var(--amber)" : "#152139";
    s += `<circle cx="${x(p)}" cy="${cy}" r="${i === 0 ? 6 : 5}" fill="${fill}" stroke="${isEdge ? "#7d8aa3" : "var(--amber)"}" stroke-width="1.5"/>`;
    const nearRight = x(p) > W - 90;  // keep labels inside the chart near the right edge
    s += `<text x="${x(p) + (nearRight ? -9 : 9)}" y="${cy + 4}" text-anchor="${nearRight ? "end" : "start"}" style="fill:var(--text-2)">${i === 0 ? "start " + p : isEdge ? "edge " + p : p}</text>`;
  });
  return s + `</svg>`;
}

export default {
  id: "storage",
  label: "Baggage & disk",
  icon: ICON,
  concept: {
    title: "Disk scheduling with a baggage cart (Lab M8)",
    text: "Belt positions 0–49 act as cylinders and the cart is the disk head (an analogy: no real disk I/O). When the cart is idle it takes every waiting request as one batch and sends it over a pipe to a real child process created with fork(), which replies with the FCFS, SSTF or SCAN order.",
    tags: [REAL("fork(), two pipes, read/write, waitpid"), SIM("cart movement and totals"), PROV("SSTF tie → lower position; SCAN visits the edge only when it must reverse")],
  },
  mount(root, ctx) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Baggage cart · disk scheduling</h1>
        <div class="view-sub">Reference queue 5 37 12 44 21 3 with the head at 20: FCFS 145, SSTF 60, SCAN UP 75, SCAN DOWN 64 positions.</div></div>
        <div class="row"><button class="btn small" data-ref="FCFS dir=UP">Ref: FCFS</button><button class="btn small" data-ref="SSTF dir=UP">SSTF</button><button class="btn small" data-ref="SCAN dir=UP">SCAN ↑</button><button class="btn small" data-ref="SCAN dir=DOWN">SCAN ↓</button></div></div>
      <div class="grid cols-side">
        <div class="grid">
          <div class="card diskchart"><div class="card-head"><span class="card-title">Head movement</span><span class="small muted" id="dk-sum"></span></div><div id="dk-chart"></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Request queue</span></div><div id="dk-queue"></div></div>
        </div>
        <div class="grid">
          <div class="card"><div class="card-head"><span class="card-title">Settings</span><span class="small muted" id="dk-cur"></span></div>
            <div class="seg" id="dk-algo"><button data-a="FCFS">FCFS</button><button data-a="SSTF">SSTF</button><button data-a="SCAN">SCAN</button></div>
            <div class="row" style="margin-top:10px">
              <label class="field"><span>Direction</span><select id="dk-dir"><option>UP</option><option>DOWN</option></select></label>
              <label class="field"><span>Head</span><input type="number" id="dk-head" min="0" max="49" value="20" style="width:80px"></label>
              <button class="btn primary" id="dk-apply" style="align-self:flex-end">Apply</button></div>
            <div class="row" style="margin-top:12px"><input type="text" id="dk-req" placeholder="add requests e.g. 8,30,46" style="flex:1"><button class="btn" id="dk-add">Add</button></div>
            <div class="small muted" style="margin-top:8px">Settings can change only while the queue is empty.</div></div>
          <div class="card"><div class="card-head"><span class="card-title">Child process &amp; pipes</span>${REAL()}</div><div id="dk-ipc"></div></div>
        </div>
      </div>`;
    root.querySelectorAll("#dk-algo button").forEach((b) => (b.onclick = () => {
      pendingAlgo = b.dataset.a;
      root.querySelectorAll("#dk-algo button").forEach((x) => x.classList.toggle("on", x === b));
    }));
    root.querySelector("#dk-apply").onclick = async () => {
      const r = await ctx.run(`disk set algo=${pendingAlgo || ctx.snap.disk.algo} dir=${root.querySelector("#dk-dir").value} head=${root.querySelector("#dk-head").value}`);
      if (r) pendingAlgo = null;
    };
    root.querySelector("#dk-add").onclick = async () => {
      const v = root.querySelector("#dk-req").value.replace(/\s+/g, "");
      if (v && (await ctx.run(`disk req ${v}`))) root.querySelector("#dk-req").value = "";
    };
    root.querySelectorAll("[data-ref]").forEach((b) => (b.onclick = () => ctx.run(`scenario disk-ref ${b.dataset.ref}`)));
  },
  update(snap) {
    const d = snap.disk;
    document.getElementById("dk-chart").innerHTML = pathChart(snap);
    document.getElementById("dk-sum").innerHTML = `planned <b>${d.planned_movement}</b> · moved ${d.busy ? d.moved_in_batch : d.last_batch_movement < 0 ? 0 : d.last_batch_movement} · all-time ${d.total_movement} · ${d.served_count} served`;
    document.getElementById("dk-cur").textContent = `active: ${d.algo} ${d.direction} · head ${d.head}`;
    if (!pendingAlgo) document.querySelectorAll("#dk-algo button").forEach((x) => x.classList.toggle("on", x.dataset.a === d.algo));
    if (document.activeElement?.id !== "dk-dir") document.getElementById("dk-dir").value = d.direction;
    if (document.activeElement?.id !== "dk-head" && !d.busy) document.getElementById("dk-head").value = d.head;

    const reqRow = (r, status) => `<tr><td class="num">${r.position}</td><td><span class="strip-sw" style="background:${flightColor(r.spid)};height:14px"></span>${esc(flightName(snap, r.spid))}</td><td>${status}</td></tr>`;
    const rows = [...d.batch_remaining.map((r) => reqRow(r, badge("warn", "in current batch"))), ...d.waiting.map((r) => reqRow(r, badge("", "waiting for next batch")))];
    const served = d.served.slice(-8).reverse().map((s) => `<span class="res-tag">${s.position}</span>`).join(" ");
    document.getElementById("dk-queue").innerHTML = (rows.length
      ? `<table class="data"><thead><tr><th class="num">Position</th><th>Owner</th><th>Status</th></tr></thead><tbody>${rows.join("")}</tbody></table>`
      : `<div class="empty small">Queue empty.</div>`) +
      `<div class="small muted" style="margin-top:10px">Service order: <span class="mono">${d.order.join(" → ") || "—"}</span></div>
       <div class="small muted" style="margin-top:4px">Recently served: ${served || "—"}</div>`;

    const ipc = snap.ipc;
    document.getElementById("dk-ipc").innerHTML = `<dl class="kv">
      <dt>Engine PID</dt><dd>${ipc.engine_pid}</dd><dt>Child PID</dt><dd>${ipc.child_pid} ${badge(ipc.status === "RUNNING" ? "real" : "err", ipc.status)}</dd>
      <dt>Pipe fds</dt><dd>write ${ipc.request_fd} → child · read ${ipc.result_fd} ← child</dd><dt>Exchanges</dt><dd>${ipc.exchanges}</dd></dl>
      <div class="card-title" style="margin:12px 0 4px">Last request (parent → child)</div><div class="mono small" style="word-break:break-all">${esc(ipc.last_sent) || "—"}</div>
      <div class="card-title" style="margin:10px 0 4px">Last reply (child → parent)</div><div class="mono small" style="word-break:break-all">${esc(ipc.last_received) || "—"}</div>
      ${ipc.last_error ? `<div class="note red small" style="margin-top:10px">${esc(ipc.last_error)}</div>` : ""}`;
  },
};
