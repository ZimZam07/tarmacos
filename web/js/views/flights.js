// flights.js - create flights (logical processes) and follow their lifecycle.
import { confirmAction, dash, esc, flightColor, REAL, SIM, stateBadge, toast } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 11l16-5-3 5 3 5-16-5z"/><path d="M7 9.5L5 4"/></svg>`;
let selected = null;

const PRESETS = [
  { label: "Turnaround", op: "TURNAROUND", prio: 2 },
  { label: "Arrival", op: "ARRIVAL", prio: 3 },
  { label: "Departure", op: "DEPARTURE", prio: 2 },
];

function detail(snap, f) {
  if (!f) return `<div class="empty">Select a flight to see its script, resources and thread.</div>`;
  const steps = f.script.map((s, i) => `<li class="${i < f.step_index ? "done" : i === f.step_index && f.state !== "TERMINATED" ? "cur" : ""}">${String(i).padStart(2, "0")}  ${esc(s)}</li>`).join("");
  return `
    <div class="row" style="margin-bottom:10px"><span class="strip-sw" style="background:${flightColor(f.spid)}"></span>
      <div><div class="strip-id">${esc(f.flight_no)} <span class="muted">· SPID ${f.spid}</span></div>
      <div class="small muted">${esc(f.op)} · priority ${f.priority}</div></div><span class="spacer"></span>${stateBadge(f)}</div>
    <dl class="kv">
      <dt>Airport phase</dt><dd>${esc(f.phase)}</dd>
      <dt>OS state</dt><dd>${esc(f.state)}${f.block_reason ? " — " + esc(f.block_reason) : ""}</dd>
      <dt>Arrival / burst</dt><dd>t=${f.arrival} / ${f.burst} ticks (used ${f.cpu_used})</dd>
      <dt>First dispatch</dt><dd>${dash(f.first_dispatch)}</dd>
      <dt>Completion</dt><dd>${dash(f.finish)}</dd>
      <dt>Waiting / TAT</dt><dd>${f.waiting} / ${f.turnaround ?? "—"}</dd>
      <dt>Blocked ticks</dt><dd>${f.blocked_ticks}</dd>
      <dt>Holds</dt><dd>${f.held.length ? f.held.map((r) => `<span class="res-tag">${esc(r)}</span>`).join(" ") : "—"}</dd>
      <dt>Requests</dt><dd>${f.requested.length ? f.requested.map((r) => `<span class="res-tag want">${esc(r)}</span>`).join(" ") : "—"}</dd>
      <dt>Max claim</dt><dd>Gate ${f.max_claim[0]} · Truck ${f.max_claim[1]} · Tug ${f.max_claim[2]}</dd>
      <dt>Linux thread</dt><dd>${f.tid ? "TID " + f.tid : "—"} ${f.state === "TERMINATED" ? "(joined)" : ""}</dd>
    </dl>
    <div class="card-title" style="margin:14px 0 6px">Script <span class="muted">· one step = one CPU tick</span></div>
    <ul class="script">${steps}</ul>
    ${f.state !== "TERMINATED" ? `<div class="row end" style="margin-top:12px"><button class="btn small danger" id="fl-abort">Abort flight</button></div>` : ""}`;
}

export default {
  id: "flights",
  label: "Flights",
  icon: ICON,
  concept: {
    title: "Flights are logical processes",
    text: "Each flight has a simulated PID (SPID) and moves NEW → READY → RUNNING ⇄ BLOCKED → TERMINATED. Its airport phase (landing, at gate, pushback…) is tracked separately. Every flight is executed by its own real pthread, which sleeps on a condition variable until the scheduler gives it the CPU.",
    tags: [SIM("SPIDs and the lifecycle are engine records, not Linux processes"), REAL("one pthread per flight (TID shown)")],
  },
  mount(root, ctx) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Flights &amp; process lifecycle</h1>
        <div class="view-sub">Create a flight; the engine assigns an SPID, builds its script and starts its thread. CUSTOM flights are CPU-only bursts for scheduling exercises.</div></div></div>
      <div class="grid cols-side">
        <div class="grid">
          <div class="card">
            <div class="card-head"><span class="card-title">New flight</span>
              <span class="row">${PRESETS.map((p, i) => `<button class="btn small ghost" data-preset="${i}">+ ${p.label}</button>`).join("")}</span></div>
            <form class="row" id="fl-form" autocomplete="off" style="align-items:flex-end">
              <label class="field"><span>Flight no.</span><input type="text" id="fl-no" placeholder="AI101" maxlength="8" required style="width:110px"></label>
              <label class="field"><span>Operation</span><select id="fl-op">
                <option>TURNAROUND</option><option>ARRIVAL</option><option>DEPARTURE</option><option>CUSTOM</option></select></label>
              <label class="field"><span>Priority (0 = highest)</span><input type="number" id="fl-prio" min="0" max="9" value="2" style="width:110px"></label>
              <label class="field"><span>Burst (CUSTOM)</span><input type="number" id="fl-burst" min="1" max="50" value="4" style="width:100px" disabled></label>
              <label class="field"><span>Arrival tick</span><input type="number" id="fl-arrive" min="0" value="" placeholder="now" style="width:90px"></label>
              <button class="btn primary" type="submit">Create</button>
            </form>
            <div class="small muted" style="margin-top:8px" id="fl-hint">TURNAROUND: gate → land → taxi → refuel + baggage threads → tug → depart (8 CPU ticks).</div>
          </div>
          <div class="card"><div class="card-head"><span class="card-title">Flight strips</span><span class="small muted" id="fl-count"></span></div>
            <div class="table-wrap" id="fl-table"></div></div>
        </div>
        <div class="card" id="fl-detail"></div>
      </div>`;

    const op = root.querySelector("#fl-op");
    const hints = {
      TURNAROUND: "TURNAROUND: gate → land → taxi → refuel + baggage threads → tug → depart (8 CPU ticks).",
      ARRIVAL: "ARRIVAL: gate → land → taxi → baggage thread → release (6 CPU ticks).",
      DEPARTURE: "DEPARTURE: gate → refuel thread → tug → pushback (5 CPU ticks).",
      CUSTOM: "CUSTOM: a pure CPU burst with no resources, for scheduling exercises.",
    };
    op.onchange = () => {
      root.querySelector("#fl-burst").disabled = op.value !== "CUSTOM";
      root.querySelector("#fl-hint").textContent = hints[op.value];
    };
    let counter = 100;
    const nextNo = () => {
      const taken = new Set((ctx.snap?.flights || []).filter((f) => f.state !== "TERMINATED").map((f) => f.flight_no));
      let no;
      do { no = "TM" + ++counter; } while (taken.has(no));
      return no;
    };
    root.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = async () => {
      const p = PRESETS[Number(b.dataset.preset)];
      const r = await ctx.run(`flight create ${nextNo()} ${p.op} ${p.prio}`);
      if (r) { selected = r.spid; toast(`${p.label} flight created as SPID ${r.spid}`); }
    }));
    root.querySelector("#fl-form").onsubmit = async (e) => {
      e.preventDefault();
      const no = root.querySelector("#fl-no").value.trim();
      const prio = root.querySelector("#fl-prio").value;
      const arrive = root.querySelector("#fl-arrive").value;
      let line = `flight create ${no} ${op.value} ${prio}`;
      if (op.value === "CUSTOM") line += ` burst=${root.querySelector("#fl-burst").value}`;
      if (arrive !== "") line += ` arrive=${arrive}`;
      const r = await ctx.run(line);
      if (r) {
        selected = r.spid;
        root.querySelector("#fl-no").value = "";
        toast(`${no.toUpperCase()} created as SPID ${r.spid}, arrives at t=${r.arrival}`);
      }
    };
    root.addEventListener("click", async (e) => {
      const row = e.target.closest("tr[data-spid]");
      if (row) { selected = Number(row.dataset.spid); this.update(ctx.snap, ctx); }
      if (e.target.id === "fl-abort") {
        const f = ctx.snap.flights.find((x) => x.spid === selected);
        if (f && (await confirmAction(`Abort ${f.flight_no}?`, "The flight is terminated, its resources are released and its thread exits. Waiting flights may be granted the freed resources.", "Abort")))
          await ctx.run(`flight abort ${f.spid}`);
      }
    });
  },
  update(snap) {
    const rows = snap.flights.map((f) => `
      <tr class="clickable ${f.spid === selected ? "selected" : ""}" data-spid="${f.spid}">
        <td style="white-space:nowrap"><span class="strip-sw" style="background:${flightColor(f.spid)}"></span><span class="strip-id">${esc(f.flight_no)}</span></td>
        <td class="num">${f.spid}</td><td>${esc(f.op)}</td><td class="num">${f.priority}</td>
        <td class="num">${f.arrival}</td><td class="num">${f.burst}</td>
        <td><span class="small">${esc(f.phase)}</span></td><td>${stateBadge(f)}</td>
        <td>${f.held.map((r) => `<span class="res-tag">${esc(r)}</span>`).join(" ")} ${f.requested.map((r) => `<span class="res-tag want">${esc(r)}</span>`).join(" ")}</td>
        <td class="num">${f.waiting}</td><td class="num">${f.turnaround ?? "—"}</td>
      </tr>`).join("");
    document.getElementById("fl-table").innerHTML = snap.flights.length
      ? `<table class="data"><thead><tr><th>Flight</th><th class="num">SPID</th><th>Op</th><th class="num">Prio</th><th class="num">Arr</th><th class="num">Burst</th><th>Phase</th><th>OS state</th><th>Holds / wants</th><th class="num">WT</th><th class="num">TAT</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty">No flights yet. Use the form above or load a guided scenario from the Overview.</div>`;
    document.getElementById("fl-count").textContent = `${snap.flights.filter((f) => f.state !== "TERMINATED").length} active · ${snap.flights.length} total`;
    if (selected && !snap.flights.some((f) => f.spid === selected)) selected = null;
    if (!selected && snap.flights.length) selected = snap.flights[0].spid;
    document.getElementById("fl-detail").innerHTML = detail(snap, snap.flights.find((f) => f.spid === selected));
  },
};
