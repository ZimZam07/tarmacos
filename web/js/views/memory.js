// memory.js - FIFO demand paging of the active-flight information area.
import { badge, esc, flightName, fmt, PROV, SIM } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M7 4v12M11 4v12M3 8h14M3 12h14"/></svg>`;
const PAGE_NAMES = ["flight plan", "allocation record", "service log", "baggage list"];

const pageLabel = (snap, p) => (!p ? "" : p.spid === 0 ? `page ${p.vpn}` : `${flightName(snap, p.spid)} · p${p.vpn}`);

export default {
  id: "memory",
  label: "Memory",
  icon: ICON,
  concept: {
    title: "Demand paging with FIFO replacement (Lab M7)",
    text: "Each flight's information is 4 logical pages (flight plan, allocation record, service log, baggage list). A page is loaded only when first touched; with no free frame, FIFO evicts the page that has been resident longest. This is a simulation: no real machine memory is managed.",
    tags: [SIM("frames and page tables are engine data structures"), PROV("FIFO is a textbook choice; the course does not name an algorithm"), badge("", "Lab M7")],
  },
  mount(root, ctx) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Memory manager</h1>
        <div class="view-sub">Load a reference string to watch FIFO decide one reference per tick, or run flights and see their pages fault in.</div></div></div>
      <div class="card" style="margin-bottom:14px"><div class="row">
        <button class="btn small" data-mem="string=silberschatz frames=3">Silberschatz · 3 frames</button>
        <button class="btn small" data-mem="string=belady frames=3">Belady · 3 frames</button>
        <button class="btn small" data-mem="string=belady frames=4">Belady · 4 frames</button>
        <span class="ctl-sep"></span>
        <input type="text" id="mm-string" placeholder="custom string e.g. 1,2,3,1,4" style="width:220px">
        <select id="mm-frames" aria-label="frames">${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select>
        <button class="btn primary" id="mm-load">Load</button>
        <span class="spacer"></span><button class="btn" id="mm-step">Step</button><button class="btn" id="mm-end">Run to end</button></div></div>
      <div class="grid cols-side">
        <div class="grid">
          <div class="card"><div class="card-head"><span class="card-title">Reference string</span><span class="small muted" id="mm-refinfo"></span></div><div class="refstrip" id="mm-refs"></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Physical frames</span><span class="small muted" id="mm-fifo"></span></div><div class="frames" id="mm-frames-grid"></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Replacement decisions</span><span class="small muted">most recent first</span></div><div class="table-wrap" id="mm-history"></div></div>
        </div>
        <div class="grid">
          <div class="card"><div class="card-head"><span class="card-title">Counters</span></div><div id="mm-stats"></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Address translation</span></div>
            <div class="row"><label class="field"><span>SPID</span><input type="number" id="mx-spid" value="0" min="0" style="width:70px"></label>
            <label class="field"><span>Page</span><input type="number" id="mx-page" value="0" min="0" max="99" style="width:70px"></label>
            <label class="field"><span>Offset</span><input type="number" id="mx-off" value="42" min="0" max="255" style="width:80px"></label>
            <button class="btn" id="mx-go" style="align-self:flex-end">Translate</button></div>
            <div id="mx-out" class="small" style="margin-top:10px">physical = frame × 256 + offset (SPID 0 = reference string)</div></div>
          <div class="card"><div class="card-head"><span class="card-title">Page tables</span><span class="small muted">active flights</span></div><div id="mm-tables"></div></div>
        </div>
      </div>`;
    root.querySelectorAll("[data-mem]").forEach((b) => (b.onclick = () => ctx.run(`scenario mem-ref ${b.dataset.mem}`)));
    root.querySelector("#mm-load").onclick = () => {
      const s = root.querySelector("#mm-string").value.replace(/\s+/g, "");
      if (!s) return;
      ctx.run(`scenario mem-ref string=${s} frames=${root.querySelector("#mm-frames").value}`);
    };
    root.querySelector("#mm-step").onclick = () => ctx.run("sim step");
    root.querySelector("#mm-end").onclick = () => ctx.run("sim run-until-quiet 200");
    root.querySelector("#mx-go").onclick = async () => {
      const r = await ctx.run(`mem xlate ${root.querySelector("#mx-spid").value} ${root.querySelector("#mx-page").value} ${root.querySelector("#mx-off").value}`);
      if (!r) return;
      document.getElementById("mx-out").innerHTML = r.resident
        ? `logical ${r.logical} (page ${r.page}, offset ${r.offset}) → frame ${r.frame} → <b class="mono">physical ${r.physical}</b> = ${r.frame} × 256 + ${r.offset}`
        : `page ${r.page} of SPID ${r.spid} is <b style="color:var(--red)">not resident</b>: an access would cause a page fault`;
    };
  },
  update(snap) {
    const m = snap.memory;
    const refHistory = m.history.filter((h) => h.spid === 0);
    const offset = m.reference_done - refHistory.length;  // history keeps only the latest accesses
    document.getElementById("mm-refinfo").textContent = m.reference.length ? `${m.reference_done} / ${m.reference.length} processed` : "none loaded";
    document.getElementById("mm-refs").innerHTML = m.reference.length
      ? m.reference.map((p, i) => {
        const h = i >= offset && i < m.reference_done ? refHistory[i - offset] : null;
        const cls = h ? (h.hit ? "done-hit" : "done-fault") : i === m.reference_done ? "next" : "";
        return `<div class="ref ${cls}" title="${h ? (h.hit ? "hit" : "fault") : i === m.reference_done ? "next" : "pending"}">${p}</div>`;
      }).join("")
      : `<div class="small muted">No reference string. Load a preset above.</div>`;

    const last = m.history.length ? m.history[m.history.length - 1] : null;
    document.getElementById("mm-frames-grid").innerHTML = m.frames.map((p, i) => `
      <div class="frame ${p ? "" : "empty"} ${last && last.frame === i ? "just" : ""}">
        <div class="fno">F${i}</div><div class="fpage">${p ? (p.spid === 0 ? p.vpn : esc(flightName(snap, p.spid)).slice(0, 7) + "·" + p.vpn) : "—"}</div>
        <div class="fowner">${p ? (p.spid === 0 ? "reference" : PAGE_NAMES[p.vpn]) : "free"}</div></div>`).join("");
    document.getElementById("mm-fifo").textContent = `FIFO order (oldest first): ${m.fifo.map((p) => pageLabel(snap, p)).join(" → ") || "empty"}`;

    const rows = m.history.slice(-24).reverse().map((h) => {
      const framesText = h.frames_after.map((p) => (p ? (p.spid === 0 ? p.vpn : `${flightName(snap, p.spid).slice(0, 5)}·${p.vpn}`) : "·")).join(" | ");
      const why = h.hit ? "already resident" : h.evicted ? `evict ${pageLabel(snap, h.evicted)} (oldest)` : "free frame";
      return `<tr><td class="num">t${h.tick}</td><td>${h.spid === 0 ? "REF" : esc(flightName(snap, h.spid))}</td><td class="num">${h.vpn}</td>
        <td class="${h.hit ? "hit" : "fault"}">${h.hit ? "HIT" : "FAULT"}</td><td class="num">F${h.frame}</td><td class="mono small">${esc(framesText)}</td><td class="small muted">${esc(why)}</td></tr>`;
    }).join("");
    document.getElementById("mm-history").innerHTML = rows
      ? `<table class="data"><thead><tr><th>Tick</th><th>Owner</th><th class="num">Page</th><th>Result</th><th class="num">Frame</th><th>Frames after</th><th>Decision</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty small">No page accesses yet.</div>`;

    const total = m.hits + m.faults;
    document.getElementById("mm-stats").innerHTML = `<dl class="kv">
      <dt>Frames</dt><dd>${m.frame_count} × ${m.page_size} B</dd>
      <dt>Page faults</dt><dd style="color:var(--red)">${m.faults}</dd><dt>Hits</dt><dd style="color:var(--green)">${m.hits}</dd>
      <dt>Fault rate</dt><dd>${total ? fmt((100 * m.faults) / total, 1) + "%" : "—"}</dd>
      <dt>Replacement</dt><dd>FIFO (global)</dd></dl>`;

    const active = snap.flights.filter((f) => f.state !== "TERMINATED");
    document.getElementById("mm-tables").innerHTML = active.length ? active.map((f) => {
      const cells = PAGE_NAMES.map((name, vpn) => {
        const frame = m.frames.findIndex((p) => p && p.spid === f.spid && p.vpn === vpn);
        return `<tr><td class="num">${vpn}</td><td class="small">${name}</td><td class="num">${frame >= 0 ? "F" + frame : "—"}</td><td>${frame >= 0 ? badge("real", "valid") : badge("", "invalid")}</td></tr>`;
      }).join("");
      return `<div style="margin-bottom:10px"><div class="small" style="margin-bottom:4px"><b>${esc(f.flight_no)}</b> <span class="muted">SPID ${f.spid}</span></div>
        <table class="data"><thead><tr><th class="num">VPN</th><th>Content</th><th class="num">Frame</th><th>Valid bit</th></tr></thead><tbody>${cells}</tbody></table></div>`;
    }).join("") : `<div class="small muted">No active flights.</div>`;
  },
};
