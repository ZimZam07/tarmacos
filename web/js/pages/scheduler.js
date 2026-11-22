// scheduler.js - Module 02: CPU scheduling. The Gantt chart is the engine's dispatch log, tick by tick.
import { command } from "../api.js";
import { confirmAction, dash, esc, flightColor, flightName, fmt, PROV, setHTML, SIM, toast } from "../ui.js";
import { fname } from "../core/plain.js";
import { flightToken, pageHead, simControls, TokenLayer, wireSim } from "./common.js";

const EXPLAIN = {
  FCFS: ["<b>FCFS</b> runs flights in arrival order", "a running flight is <b>never preempted</b>", "short jobs can wait behind long ones (convoy effect)"],
  PRIORITY: ["<b>Priority</b>: lowest number runs first", "ties → earlier arrival → smaller process ID", "<b>preemptive</b> only if switched on (emergency scenario)"],
  RR: ["<b>Round Robin</b>: each flight gets <b>q</b> ticks", "then it rejoins the <b>tail</b> of the ready queue", "fair response time; more context switches"],
};
let pendingAlgo = null;
let rqTokens = null;
let compareResult = null;
let lastGanttEnd = -1;

export default {
  mount(root, ctx) {
    root.innerHTML = pageHead({
      kicker: "02 · CPU SCHEDULING",
      title: "Who gets the apron-control CPU?",
      text: "One flight at a time holds the single “apron control CPU” for a tick. The engine's dispatcher picks it with the selected algorithm, and every decision is recorded in the Gantt chart below.",
      annos: [SIM("the dispatcher in the C++ engine decides every tick"), PROV("priority direction, tie-breaks and default quantum are documented choices")],
      right: simControls(),
    }) + `
      <div class="ctl-bar">
        <div class="seg" id="sc-algo"><button data-a="FCFS">FCFS</button><button data-a="PRIORITY">Priority</button><button data-a="RR">Round Robin</button></div>
        <label class="row small muted" style="gap:6px">q <input type="number" id="sc-q" min="1" max="20" value="4" style="width:64px"></label>
        <label class="row small muted" style="gap:6px">preempt <select id="sc-pre"><option value="off">off</option><option value="on">on</option></select></label>
        <button class="btn small primary" id="sc-apply">Apply to engine</button>
        <span class="vsep"></span>
        <span class="small muted">Reference set:</span>
        <button class="btn small" data-ref="FCFS">FCFS</button><button class="btn small" data-ref="PRIORITY">Priority</button><button class="btn small" data-ref="RR">RR q=4</button>
        <button class="btn small" id="sc-emerg">Emergency (preempt)</button>
        <span class="spacer"></span><span class="tiny muted" id="sc-active"></span>
      </div>
      <div class="annos" id="sc-explain" style="margin:-4px 0 14px"></div>
      <div class="card" style="margin-bottom:14px">
        <div class="cpu-stage">
          <div><div class="rq" id="sc-rq"><span class="rq-label">Ready queue · next first →</span></div>
            <div class="tiny muted" style="margin-top:8px" id="sc-waiting"></div></div>
          <div class="cpu-core" id="sc-cpu"><span class="cpu-l">CPU</span><span class="cpu-f" id="sc-run">idle</span><div class="slice-bar"><span id="sc-slice" style="width:0"></span></div><span class="tiny muted" id="sc-slice-t"></span></div>
        </div>
      </div>
      <div class="card gantt" style="margin-bottom:14px"><div class="card-head"><span class="card-title">Gantt chart · engine dispatch log</span><span class="tiny muted" id="sc-legend"></span></div><div id="sc-gantt"></div></div>
      <div class="grid c2">
        <div class="card"><div class="card-head"><span class="card-title">Per-flight metrics</span><span class="tiny muted">ticks · waiting = time in the READY queue</span></div><div class="table-wrap" id="sc-metrics"></div></div>
        <div class="card"><div class="card-head"><span class="card-title">Compare the three algorithms</span><button class="btn small" id="sc-cmp">Run all three on the engine</button></div><div id="sc-cmp-out"></div></div>
      </div>
      <div class="note" style="margin-top:14px"><b>Conventions</b> (configurable, not claimed to be the instructor's): lower number = higher priority; ties go to the earlier arrival, then the smaller process ID; with RR, flights that become ready during a tick join the queue before the flight whose quantum expired.</div>`;

    root.querySelectorAll("#sc-algo button").forEach((b) => (b.onclick = () => { pendingAlgo = b.dataset.a; this.update(ctx.snap); }));
    root.querySelector("#sc-apply").onclick = async () => {
      const algo = pendingAlgo || ctx.snap.cpu.algo;
      if (await ctx.run(`sched set ${algo} q=${root.querySelector("#sc-q").value} preempt=${root.querySelector("#sc-pre").value}`)) { pendingAlgo = null; toast(`Scheduler set to ${algo}; applies from the next tick`); }
    };
    root.querySelectorAll("[data-ref]").forEach((b) => (b.onclick = () => ctx.run(`scenario sched-ref ${b.dataset.ref}`)));
    root.querySelector("#sc-emerg").onclick = () => ctx.run("scenario emergency preempt=on");
    root.querySelector("#sc-cmp").onclick = () => compare(root);
    wireSim(root, ctx);
    rqTokens = new TokenLayer(root.querySelector("#sc-rq"));
    lastGanttEnd = -1;
    if (compareResult) setHTML(root.querySelector("#sc-cmp-out"), compareHtml(compareResult));
    else setHTML(root.querySelector("#sc-cmp-out"), `<div class="small dim">Runs the reference set (P1 6/3, P2 3/1, P3 8/4, P4 2/2 as burst/priority) through FCFS, Priority and RR q=4 <b>on the engine</b>, one after another, and reads the engine's own averages. The current simulation is reset.</div>`);
  },
  unmount() { rqTokens = null; },

  update(snap) {
    if (!rqTokens) return;
    const cpu = snap.cpu;
    const algo = pendingAlgo || cpu.algo;
    document.querySelectorAll("#sc-algo button").forEach((b) => b.classList.toggle("on", b.dataset.a === algo));
    if (document.activeElement?.id !== "sc-q" && !pendingAlgo) document.getElementById("sc-q").value = cpu.quantum;
    if (document.activeElement?.id !== "sc-pre" && !pendingAlgo) document.getElementById("sc-pre").value = cpu.preemptive ? "on" : "off";
    document.getElementById("sc-active").textContent = `engine: ${cpu.algo}${cpu.algo === "RR" ? " q=" + cpu.quantum : ""}${cpu.preemptive ? " · preemptive" : ""} · t=${snap.tick}${pendingAlgo ? " · (not applied yet)" : ""}`;
    setHTML(document.getElementById("sc-explain"), EXPLAIN[algo].map((t) => `<span class="anno">${t}</span>`).join(""));

    // ready queue tokens (ordered exactly as the engine's queue)
    const fm = new Map(snap.flights.map((f) => [f.spid, f]));
    rqTokens.set(cpu.ready.map((spid, i) => ({ key: String(spid), x: 12 + i * 92, y: 0, fromX: -100, html: flightToken(fm.get(spid) || { spid }, ` <span class="muted">p${fm.get(spid)?.priority ?? ""}</span>`) })));
    const blocked = snap.flights.filter((f) => f.state === "BLOCKED");
    document.getElementById("sc-waiting").textContent = blocked.length ? `Not in the queue (BLOCKED): ${blocked.map((f) => fname(f)).join(", ")}` : "";
    const runF = cpu.running >= 0 ? fm.get(cpu.running) : null;
    document.getElementById("sc-cpu").classList.toggle("busy", !!runF);
    setHTML(document.getElementById("sc-run"), runF ? `<span style="color:${flightColor(runF.spid)}">●</span> ${esc(fname(runF))}` : "idle");
    const q = cpu.algo === "RR" ? cpu.quantum : 0;
    document.getElementById("sc-slice").style.width = runF && q ? `${Math.min(100, (100 * cpu.slice_used) / q)}%` : runF ? "100%" : "0";
    document.getElementById("sc-slice-t").textContent = runF ? (q ? `slice ${cpu.slice_used}/${q}` : "runs until it blocks or ends") : "";

    const end = cpu.gantt.length ? cpu.gantt[cpu.gantt.length - 1].end : 0;
    setHTML(document.getElementById("sc-gantt"), gantt(snap, lastGanttEnd));
    lastGanttEnd = end;
    document.getElementById("sc-legend").textContent = `${end} ticks · hatched = idle CPU · violet line = scheduler change`;
    setHTML(document.getElementById("sc-metrics"), metrics(snap));
  },
};

function gantt(snap, prevEnd) {
  const slices = snap.cpu.gantt;
  if (!slices.length) return `<div class="empty">The chart grows as soon as the engine runs its first tick. Load a reference set and press Step.</div>`;
  const end = slices[slices.length - 1].end;
  const W = 1000, left = 70;
  const lanes = [-2, ...[...new Set(slices.filter((s) => s.spid >= 0).map((s) => s.spid))].sort((a, b) => a - b)];
  const span = Math.max(end, 20);
  const unit = (W - left - 16) / span;
  const rowH = 22, top = 8, H = top + lanes.length * (rowH + 7) + 28;
  const x = (t) => left + t * unit;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gantt chart"><defs><pattern id="idle" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#24364d" stroke-width="2"/></pattern></defs>`;
  lanes.forEach((spid, i) => {
    const y = top + i * (rowH + 7);
    s += `<text class="lane-label" x="${left - 10}" y="${y + 15}" text-anchor="end">${spid === -2 ? "CPU" : esc(flightName(snap, spid))}</text>`;
    s += `<rect x="${left}" y="${y}" width="${x(span) - left}" height="${rowH}" rx="4" fill="rgba(255,255,255,.025)"/>`;
    for (const sl of slices) {
      if (spid !== -2 && sl.spid !== spid) continue;
      const w = (sl.end - sl.start) * unit;
      if (sl.spid < 0) { if (spid === -2) s += `<rect x="${x(sl.start)}" y="${y}" width="${w}" height="${rowH}" fill="url(#idle)"/>`; continue; }
      const grow = sl.end > prevEnd && prevEnd >= 0;
      s += `<rect class="slice${grow ? " grow" : ""}" x="${x(sl.start) + 0.6}" y="${y + 1}" width="${Math.max(w - 1.2, 1)}" height="${rowH - 2}" rx="3" fill="${flightColor(sl.spid)}" opacity="${spid === -2 ? 0.95 : 0.85}"><title>${esc(flightName(snap, sl.spid))}: ${sl.start}–${sl.end}</title></rect>`;
      if (w > 34 && spid === -2) s += `<text x="${x(sl.start) + 6}" y="${y + 15}" font-size="10.5" font-weight="700" fill="#07111f">${esc(flightName(snap, sl.spid))}</text>`;
    }
  });
  const axisY = top + lanes.length * (rowH + 7) + 2;
  const step = span > 60 ? 10 : span > 24 ? 5 : 1;
  s += `<g class="axis"><line x1="${left}" y1="${axisY}" x2="${x(span)}" y2="${axisY}"/>`;
  for (let t = 0; t <= span; t += step) s += `<line x1="${x(t)}" y1="${axisY}" x2="${x(t)}" y2="${axisY + 4}"/><text x="${x(t)}" y="${axisY + 16}" text-anchor="middle">${t}</text>`;
  for (const c of snap.cpu.changes) if (c.tick > 0) s += `<line x1="${x(c.tick)}" y1="${top}" x2="${x(c.tick)}" y2="${axisY}" stroke="var(--violet)" stroke-dasharray="3 3"><title>switched to ${esc(c.config)}</title></line>`;
  s += `<line x1="${x(end)}" y1="${top - 4}" x2="${x(end)}" y2="${axisY}" stroke="var(--cyan)" stroke-width="1.5"/><text x="${x(end)}" y="${top - 6 < 6 ? 6 : top - 6}" text-anchor="middle" fill="var(--cyan)" font-size="9.5">now</text>`;
  return s + `</g><style>.gantt .grow{transform-box:fill-box;transform-origin:left;animation:gg .5s var(--ease)}@keyframes gg{from{transform:scaleX(.2)}to{transform:none}}</style></svg>`;
}

function metrics(snap) {
  if (!snap.flights.length) return `<div class="empty">No flights. Load a reference set above.</div>`;
  const rows = snap.flights.map((f) => `<tr><td><span class="dot" style="background:${flightColor(f.spid)};margin-right:6px"></span>${esc(fname(f))}</td>
    <td class="num">${f.arrival}</td><td class="num">${f.burst}</td><td class="num">${f.priority}</td><td class="num">${dash(f.first_dispatch)}</td><td class="num">${dash(f.finish)}</td>
    <td class="num">${f.turnaround ?? "—"}</td><td class="num">${f.waiting}</td><td class="num">${f.first_dispatch >= 0 ? f.first_dispatch - f.arrival : "—"}</td></tr>`).join("");
  return `<table class="data"><thead><tr><th>Flight</th><th class="num">Arr</th><th class="num">Burst</th><th class="num">Prio</th><th class="num">First run</th><th class="num">Done</th><th class="num">TAT</th><th class="num">WT</th><th class="num">Resp</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="6">Average over ${snap.cpu.completed} completed</td><td class="num">${fmt(snap.cpu.avg_turnaround)}</td><td class="num">${fmt(snap.cpu.avg_waiting)}</td><td></td></tr></tfoot></table>`;
}

async function compare(root) {
  const ok = await confirmAction("Run the comparison?", "The engine runs the reference set three times (FCFS, Priority, RR q=4), each from a reset, and the dashboard reads the engine's results. The current simulation is replaced.", "Run comparison");
  if (!ok) return;
  const out = root.querySelector("#sc-cmp-out");
  const results = [];
  for (const algo of ["FCFS", "PRIORITY", "RR"]) {
    setHTML(out, `<div class="story-status"><span class="spin"></span>Running ${algo} on the engine…</div>`);
    const a = await command(`scenario sched-ref ${algo}`);
    const b = a.ok && (await command("sim run-until-quiet 300"));
    const st = b && b.ok && (await command("state"));
    if (!st || !st.ok) { setHTML(out, `<div class="note red">The engine did not answer (${esc((st || b || a).error?.msg || "error")}).</div>`); return; }
    const s = st.result;
    results.push({ algo, wt: s.cpu.avg_waiting, tat: s.cpu.avg_turnaround, switches: s.cpu.gantt.length, gantt: s.cpu.gantt, names: Object.fromEntries(s.flights.map((f) => [f.spid, fname(f)])) });
  }
  compareResult = results;
  setHTML(out, compareHtml(results));
}

function compareHtml(rs) {
  const best = Math.min(...rs.map((r) => r.wt));
  const mini = (r) => {
    const end = r.gantt.length ? r.gantt[r.gantt.length - 1].end : 1;
    return `<svg viewBox="0 0 200 18" style="width:100%;height:18px;margin:8px 0 6px">${r.gantt.map((g) => `<rect x="${(g.start / end) * 200}" y="0" width="${((g.end - g.start) / end) * 200 - 0.6}" height="18" rx="2" fill="${g.spid < 0 ? "#24364d" : flightColor(g.spid)}"><title>${esc(r.names[g.spid] || "idle")} ${g.start}–${g.end}</title></rect>`).join("")}</svg>`;
  };
  return `<div class="cmp">${rs.map((r) => `<div class="cmp-col ${r.wt === best ? "best" : ""}"><div class="row"><b>${r.algo === "RR" ? "RR q=4" : r.algo}</b>${r.wt === best ? '<span class="badge real">lowest WT</span>' : ""}</div>${mini(r)}
    <div class="stat-label">avg waiting</div><div class="big-stat" style="font-size:22px">${fmt(r.wt)}</div>
    <div class="stat-label" style="margin-top:6px">avg turnaround</div><div class="big-stat" style="font-size:22px">${fmt(r.tat)}</div>
    <div class="tiny muted" style="margin-top:6px">${r.switches} CPU slices (context switches + 1)</div></div>`).join("")}</div>
    <div class="tiny muted" style="margin-top:10px">Values read from the engine after each run. Hand calculation: FCFS 8.00 / 12.75 · Priority 4.75 / 9.50 · RR 8.75 / 13.50.</div>`;
}
