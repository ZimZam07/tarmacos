// scheduler.js - ready queue, Gantt chart and metrics, all from the engine's dispatch log.
import { badge, chip, dash, esc, flightColor, flightName, fmt, PROV, SIM } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="4" width="7" height="4" rx="1"/><rect x="9" y="9" width="9" height="4" rx="1"/><rect x="5" y="14" width="6" height="3" rx="1"/></svg>`;
let pendingAlgo = null;

function ganttSvg(snap) {
  const slices = snap.cpu.gantt;
  if (!slices.length) return `<div class="empty">The Gantt chart appears as soon as the first tick runs.</div>`;
  const end = slices[slices.length - 1].end;
  // The chart always spans the full card width; long runs simply get narrower ticks.
  const W = 720, left = 64, lanes = [-2, ...[...new Set(slices.filter((s) => s.spid >= 0).map((s) => s.spid))].sort((a, b) => a - b)];
  const unit = (W - left - 14) / Math.max(end, 1);
  const rowH = 22, top = 8, H = top + lanes.length * (rowH + 6) + 26;
  const x = (t) => left + t * unit;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gantt chart">`;
  lanes.forEach((spid, i) => {
    const y = top + i * (rowH + 6);
    s += `<text class="lane-label" x="${left - 8}" y="${y + 15}" text-anchor="end">${spid === -2 ? "CPU" : esc(flightName(snap, spid))}</text>`;
    s += `<rect x="${left}" y="${y}" width="${x(end) - left}" height="${rowH}" fill="#0c1526" stroke="#1d2a44"/>`;
    for (const sl of slices) {
      if (spid !== -2 && sl.spid !== spid) continue;
      const w = (sl.end - sl.start) * unit;
      if (sl.spid < 0) {
        if (spid === -2) s += `<rect x="${x(sl.start)}" y="${y}" width="${w}" height="${rowH}" fill="url(#idle)"/>`;
        continue;
      }
      s += `<rect class="slice" x="${x(sl.start) + 0.5}" y="${y + 1}" width="${Math.max(w - 1, 1)}" height="${rowH - 2}" fill="${flightColor(sl.spid)}"><title>${esc(flightName(snap, sl.spid))}: ${sl.start}–${sl.end}</title></rect>`;
      if (w > 30) s += `<text class="slice-text" x="${x(sl.start) + 5}" y="${y + 15}">${esc(flightName(snap, sl.spid))}</text>`;
    }
  });
  const axisY = top + lanes.length * (rowH + 6) + 4;
  const step = end > 60 ? 10 : end > 24 ? 5 : 1;
  s += `<g class="axis"><line x1="${left}" y1="${axisY}" x2="${x(end)}" y2="${axisY}"/>`;
  for (let t = 0; t <= end; t += step) s += `<line x1="${x(t)}" y1="${axisY}" x2="${x(t)}" y2="${axisY + 4}"/><text x="${x(t)}" y="${axisY + 15}" text-anchor="middle">${t}</text>`;
  for (const c of snap.cpu.changes) if (c.tick > 0) s += `<line x1="${x(c.tick)}" y1="${top}" x2="${x(c.tick)}" y2="${axisY}" stroke="var(--violet)" stroke-dasharray="3 3"><title>switched to ${esc(c.config)}</title></line>`;
  s += `</g><defs><pattern id="idle" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#2c3e63" stroke-width="2"/></pattern></defs></svg>`;
  return s;
}

export default {
  id: "scheduler",
  label: "Scheduler",
  icon: ICON,
  concept: {
    title: "CPU scheduling (Lab M4, Assignment 4)",
    text: "One flight at a time holds the “apron control CPU” for a tick. FCFS runs in arrival order, Priority picks the lowest number, Round Robin re-queues a flight at the tail when its quantum expires. Waiting time counts ticks spent in the READY queue; turnaround = completion − arrival.",
    tags: [SIM("the engine's dispatcher decides every tick; the chart is its log"), badge("", "Lab M4 · CO C371.3"), PROV("priority direction, tie-breaking and the default quantum are documented conventions")],
  },
  mount(root, ctx) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Flight scheduler</h1>
        <div class="view-sub">The chart below is the engine's real dispatch log. Load the reference set to compare with the hand-calculated results.</div></div>
        <div class="row"><button class="btn small" data-ref="FCFS">Reference: FCFS</button><button class="btn small" data-ref="PRIORITY">Priority</button><button class="btn small" data-ref="RR">RR q=4</button><button class="btn small" data-emerg="on">Emergency</button></div></div>
      <div class="grid cols-side">
        <div class="card"><div class="card-head"><span class="card-title">CPU timeline (Gantt)</span><span class="small muted" id="sc-legend"></span></div><div class="gantt" id="sc-gantt"></div></div>
        <div class="card">
          <div class="card-head"><span class="card-title">Algorithm</span><span id="sc-current" class="small muted"></span></div>
          <div class="seg" id="sc-algo"><button data-a="FCFS">FCFS</button><button data-a="PRIORITY">Priority</button><button data-a="RR">Round Robin</button></div>
          <div class="row" style="margin-top:10px">
            <label class="field"><span>Quantum</span><input type="number" id="sc-q" min="1" max="20" value="4" style="width:80px"></label>
            <label class="field"><span>Preemption</span><select id="sc-pre"><option value="off">off</option><option value="on">on (priority)</option></select></label>
            <span class="spacer"></span><button class="btn primary" id="sc-apply" style="align-self:flex-end">Apply</button>
          </div>
          <div class="small muted" style="margin-top:10px">Changes apply from the next tick and are marked on the chart.</div>
          <div class="card-title" style="margin:16px 0 8px">Ready queue <span class="muted">· next first</span></div>
          <div class="row" id="sc-ready"></div>
          <div class="card-title" style="margin:16px 0 8px">On the CPU</div>
          <div id="sc-running"></div>
        </div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-head"><span class="card-title">Per-flight metrics</span><span class="small muted">ticks · computed by the engine from dispatch and completion events</span></div>
        <div class="table-wrap" id="sc-metrics"></div></div>
      <div class="note" style="margin-top:14px"><b>Conventions</b> (configurable, not claimed to be the instructor's): lower priority number = higher priority; ties go to the earlier arrival, then the smaller SPID; with Round Robin, flights that become ready during a tick join the queue before the flight whose quantum expired; priority is non-preemptive unless preemption is switched on.</div>`;

    root.querySelectorAll("#sc-algo button").forEach((b) => (b.onclick = () => {
      pendingAlgo = b.dataset.a;
      root.querySelectorAll("#sc-algo button").forEach((x) => x.classList.toggle("on", x === b));
    }));
    root.querySelector("#sc-apply").onclick = async () => {
      const algo = pendingAlgo || ctx.snap.cpu.algo;
      const r = await ctx.run(`sched set ${algo} q=${root.querySelector("#sc-q").value} preempt=${root.querySelector("#sc-pre").value}`);
      if (r) pendingAlgo = null;
    };
    root.querySelectorAll("[data-ref]").forEach((b) => (b.onclick = () => ctx.run(`scenario sched-ref ${b.dataset.ref}`)));
    root.querySelector("[data-emerg]").onclick = () => ctx.run("scenario emergency preempt=on");
  },
  update(snap) {
    const cpu = snap.cpu;
    document.getElementById("sc-gantt").innerHTML = ganttSvg(snap);
    document.getElementById("sc-legend").textContent = `${cpu.gantt.length ? cpu.gantt[cpu.gantt.length - 1].end : 0} ticks · hatched = idle CPU`;
    document.getElementById("sc-current").textContent = `active: ${cpu.algo}${cpu.algo === "RR" ? " q=" + cpu.quantum : ""}${cpu.preemptive ? " · preemptive" : ""}`;
    if (!pendingAlgo) document.querySelectorAll("#sc-algo button").forEach((x) => x.classList.toggle("on", x.dataset.a === cpu.algo));
    if (document.activeElement?.id !== "sc-q") document.getElementById("sc-q").value = cpu.quantum;
    if (document.activeElement?.id !== "sc-pre") document.getElementById("sc-pre").value = cpu.preemptive ? "on" : "off";
    document.getElementById("sc-ready").innerHTML = cpu.ready.length ? cpu.ready.map((s) => chip(snap, s)).join(" ") : `<span class="muted small">empty</span>`;
    document.getElementById("sc-running").innerHTML = cpu.running >= 0
      ? `${chip(snap, cpu.running, "running")} <span class="small muted">${cpu.algo === "RR" ? `slice ${cpu.slice_used}/${cpu.quantum}` : ""}</span>`
      : `<span class="muted small">CPU idle</span>`;

    const rows = snap.flights.map((f) => `<tr>
      <td><span class="strip-sw" style="background:${flightColor(f.spid)};height:16px"></span>${esc(f.flight_no)}</td>
      <td class="num">${f.spid}</td><td class="num">${f.arrival}</td><td class="num">${f.burst}</td><td class="num">${f.priority}</td>
      <td class="num">${dash(f.first_dispatch)}</td><td class="num">${dash(f.finish)}</td>
      <td class="num">${f.turnaround ?? "—"}</td><td class="num">${f.waiting}</td>
      <td class="num">${f.first_dispatch >= 0 ? f.first_dispatch - f.arrival : "—"}</td>
      <td class="num">${f.blocked_ticks}</td></tr>`).join("");
    document.getElementById("sc-metrics").innerHTML = snap.flights.length ? `<table class="data">
      <thead><tr><th>Flight</th><th class="num">SPID</th><th class="num">Arrival</th><th class="num">Burst</th><th class="num">Priority</th><th class="num">First run</th><th class="num">Completion</th><th class="num">Turnaround</th><th class="num">Waiting</th><th class="num">Response</th><th class="num">Blocked</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="7">Average over ${cpu.completed} completed flight(s)</td><td class="num">${fmt(cpu.avg_turnaround)}</td><td class="num">${fmt(cpu.avg_waiting)}</td><td colspan="2"></td></tr></tfoot></table>`
      : `<div class="empty">No flights. Load a reference set above.</div>`;
  },
};
