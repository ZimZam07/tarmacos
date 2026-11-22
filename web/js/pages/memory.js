// memory.js - Module 05: demand paging with FIFO replacement, one reference per engine tick.
import { badge, esc, flightName, fmt, PROV, setHTML, SIM } from "../ui.js";
import { pageHead, setNum, wireSim } from "./common.js";
import { fname } from "../core/plain.js";

const PAGE_NAMES = ["flight plan", "allocation record", "service log", "baggage list"];
const label = (snap, p) => (!p ? "" : p.spid === 0 ? `page ${p.vpn}` : `${flightName(snap, p.spid)} · p${p.vpn}`);
const same = (a, b) => a && b && a.spid === b.spid && a.vpn === b.vpn;

export default {
  mount(root, ctx) {
    root.innerHTML = pageHead({
      kicker: "05 · MEMORY MANAGEMENT",
      title: "Demand paging with FIFO replacement",
      text: "Each flight's information is 4 logical pages. A page is loaded only when first touched; when every frame is full, FIFO evicts the page that has been resident longest. Load a reference string to watch the engine decide one reference per tick.",
      annos: [SIM("frames, FIFO queue and page tables are engine data structures"), PROV("FIFO is a textbook choice"), "<b>no real machine memory</b> is managed"],
    }) + `
      <div class="ctl-bar">
        <button class="btn small" data-mem="string=silberschatz frames=3">Silberschatz · 3 frames</button>
        <button class="btn small" data-mem="string=belady frames=3">Belady · 3 frames</button>
        <button class="btn small" data-mem="string=belady frames=4">Belady · 4 frames</button>
        <span class="vsep"></span>
        <input type="text" id="mm-string" placeholder="custom e.g. 1,2,3,1,4,5" style="width:190px">
        <select id="mm-frames" aria-label="frames">${[1, 2, 3, 4, 5, 6, 8].map((n) => `<option ${n === 3 ? "selected" : ""}>${n}</option>`).join("")}</select>
        <button class="btn small primary" id="mm-load">Load</button>
        <span class="spacer"></span><button class="btn small" data-sim="step">Step</button><button class="btn small" data-sim="end">Run to end</button>
      </div>
      <div class="card" style="margin-bottom:14px"><div class="card-head"><span class="card-title">Reference string</span><span class="tiny muted" id="mm-refinfo"></span></div><div class="refstrip" id="mm-refs"></div></div>
      <div class="grid side">
        <div class="stack" style="gap:14px">
          <div class="card"><div class="card-head"><span class="card-title">Physical frames</span><span class="tiny muted" id="mm-last"></span></div><div class="frames" id="mm-frames-grid"></div>
            <div class="row" style="margin-top:14px"><span class="small muted">FIFO queue (oldest → newest):</span><div class="fifo-q" id="mm-fifo"></div></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Replacement decisions</span><span class="tiny muted">most recent first</span></div><div class="table-wrap" id="mm-history"></div></div>
        </div>
        <div class="stack" style="gap:14px">
          <div class="card"><div class="grid c2" style="gap:10px">
            <div><div class="stat-label">Page faults</div><div class="big-stat" style="color:var(--red)" id="mm-faults">0</div></div>
            <div><div class="stat-label">Hits</div><div class="big-stat" style="color:var(--green)" id="mm-hits">0</div></div>
            <div><div class="stat-label">Fault rate</div><div class="big-stat" id="mm-rate" style="font-size:22px">—</div></div>
            <div><div class="stat-label">Frames</div><div class="big-stat" id="mm-fr" style="font-size:22px">0</div></div></div></div>
          <div class="card"><div class="card-head"><span class="card-title">Address translation</span></div>
            <div class="row"><label class="field"><span>Flight #</span><input type="number" id="mx-spid" value="0" min="0" style="width:64px"></label>
            <label class="field"><span>Page</span><input type="number" id="mx-page" value="0" min="0" max="99" style="width:64px"></label>
            <label class="field"><span>Offset</span><input type="number" id="mx-off" value="42" min="0" max="255" style="width:72px"></label>
            <button class="btn small" id="mx-go" style="align-self:flex-end">Translate</button></div>
            <div id="mx-out" class="small dim" style="margin-top:10px">physical = frame × 256 + offset (flight 0 = the reference string)</div></div>
          <div class="card"><div class="card-head"><span class="card-title">Page tables · active flights</span></div><div id="mm-tables"></div></div>
        </div>
      </div>`;
    root.querySelectorAll("[data-mem]").forEach((b) => (b.onclick = () => ctx.run(`scenario mem-ref ${b.dataset.mem}`)));
    root.querySelector("#mm-load").onclick = () => {
      const s = root.querySelector("#mm-string").value.replace(/\s+/g, "");
      if (s) ctx.run(`scenario mem-ref string=${s} frames=${root.querySelector("#mm-frames").value}`);
    };
    wireSim(root, ctx);
    root.querySelector("#mx-go").onclick = async () => {
      const r = await ctx.run(`mem xlate ${root.querySelector("#mx-spid").value} ${root.querySelector("#mx-page").value} ${root.querySelector("#mx-off").value}`);
      if (!r) return;
      setHTML(document.getElementById("mx-out"), r.resident
        ? `logical ${r.logical} (page ${r.page}, offset ${r.offset}) → frame ${r.frame} → <b class="mono" style="color:var(--cyan)">physical ${r.physical}</b> = ${r.frame} × 256 + ${r.offset}`
        : `page ${r.page} of ${r.spid === 0 ? "the reference string" : fname(r.spid)} is <b style="color:var(--red)">not resident</b>: an access would cause a page fault`);
    };
    this.frameEls = [];
    this.lastKey = "";
  },

  update(snap) {
    const m = snap.memory;
    const refHistory = m.history.filter((h) => h.spid === 0);
    const offset = m.reference_done - refHistory.length;
    document.getElementById("mm-refinfo").textContent = m.reference.length ? `${m.reference_done} / ${m.reference.length} processed · one per tick` : "none loaded";
    setHTML(document.getElementById("mm-refs"), m.reference.length ? m.reference.map((p, i) => {
      const h = i >= offset && i < m.reference_done ? refHistory[i - offset] : null;
      const cls = h ? (h.hit ? "hit" : "fault") : i === m.reference_done ? "next" : "";
      return `<div class="ref ${cls}" title="${h ? (h.hit ? "hit" : "fault") : i === m.reference_done ? "next" : "pending"}">${p}</div>`;
    }).join("") : `<div class="small muted">No reference string loaded. Pick a preset above, or run flights: their pages fault in as they work.</div>`);

    // frames: keyed, so only the frame that changes animates
    const grid = document.getElementById("mm-frames-grid");
    const last = m.history.length ? m.history[m.history.length - 1] : null;
    const fresh = last && last.tick === snap.tick - 1 ? last : last && last.tick === snap.tick ? last : null;
    const full = m.frames.every((f) => f);
    const victim = full && m.fifo.length ? m.fifo[0] : null;
    while (this.frameEls.length > m.frames.length) this.frameEls.pop().remove();
    m.frames.forEach((p, i) => {
      let el = this.frameEls[i];
      if (!el) { el = document.createElement("div"); el.className = "frame"; grid.appendChild(el); this.frameEls[i] = el; el.__page = undefined; }
      const key = p ? p.spid + ":" + p.vpn : "";
      const qi = p ? m.fifo.findIndex((q) => same(q, p)) : -1;
      if (el.__page !== key) {
        const ghost = fresh && fresh.frame === i && fresh.evicted ? `<div class="ghost">out: ${esc(label(snap, fresh.evicted))}</div>` : "";
        el.innerHTML = `<span class="fno">F${i}</span><span class="fifo-i"></span>${p ? `<div class="page"><span class="pv">${p.spid === 0 ? p.vpn : esc(flightName(snap, p.spid).slice(0, 7)) + "·" + p.vpn}</span><span class="po">${p.spid === 0 ? "reference string" : PAGE_NAMES[p.vpn] || "page"}</span></div>` : ""}${ghost}`;
        el.__page = key;
      }
      el.querySelector(".fifo-i").textContent = qi >= 0 ? `#${qi + 1} in FIFO` : "free";
      el.className = "frame" + (fresh && fresh.frame === i ? " just" + (fresh.hit ? "" : " fault") : "") + (victim && same(victim, p) ? " victim" : "");
    });
    setHTML(document.getElementById("mm-last"), last ? `last: t${last.tick} ${last.spid === 0 ? "ref" : esc(flightName(snap, last.spid))} page ${last.vpn} → ${last.hit ? '<b style="color:var(--green)">HIT</b>' : '<b style="color:var(--red)">FAULT</b>'} in F${last.frame}${last.evicted ? `, evicted ${esc(label(snap, last.evicted))}` : ""}` : "");
    setHTML(document.getElementById("mm-fifo"), m.fifo.map((p, i) => `<span class="q ${i === 0 && full ? "first" : ""}">${esc(label(snap, p))}</span>`).join('<span class="muted">→</span>') || '<span class="tiny muted">empty</span>');

    const rows = m.history.slice(-24).reverse().map((h) => {
      const framesText = h.frames_after.map((p) => (p ? (p.spid === 0 ? p.vpn : `${flightName(snap, p.spid).slice(0, 5)}·${p.vpn}`) : "·")).join(" | ");
      const whyText = h.hit ? "already resident" : h.evicted ? `evict ${label(snap, h.evicted)} (oldest)` : "free frame";
      return `<tr><td class="num">t${h.tick}</td><td>${h.spid === 0 ? "REF" : esc(flightName(snap, h.spid))}</td><td class="num">${h.vpn}</td>
        <td class="${h.hit ? "hit" : "fault"}">${h.hit ? "HIT" : "FAULT"}</td><td class="num">F${h.frame}</td><td class="mono tiny">${esc(framesText)}</td><td class="tiny muted">${esc(whyText)}</td></tr>`;
    }).join("");
    setHTML(document.getElementById("mm-history"), rows ? `<table class="data"><thead><tr><th>Tick</th><th>Owner</th><th class="num">Page</th><th>Result</th><th class="num">Frame</th><th>Frames after</th><th>Decision</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty small">No page accesses yet.</div>`);

    setNum(document.getElementById("mm-faults"), m.faults);
    setNum(document.getElementById("mm-hits"), m.hits);
    const total = m.hits + m.faults;
    document.getElementById("mm-rate").textContent = total ? fmt((100 * m.faults) / total, 1) + "%" : "—";
    document.getElementById("mm-fr").textContent = `${m.frame_count} × ${m.page_size} B`;

    const active = snap.flights.filter((f) => f.state !== "TERMINATED");
    setHTML(document.getElementById("mm-tables"), active.length ? active.map((f) => {
      const cells = PAGE_NAMES.map((name, vpn) => {
        const frame = m.frames.findIndex((p) => p && p.spid === f.spid && p.vpn === vpn);
        return `<tr><td class="num">${vpn}</td><td class="tiny">${name}</td><td class="num">${frame >= 0 ? "F" + frame : "—"}</td><td>${frame >= 0 ? badge("real", "valid") : badge("", "invalid")}</td></tr>`;
      }).join("");
      return `<div style="margin-bottom:10px"><div class="small" style="margin-bottom:4px"><b>${esc(fname(f))}</b></div>
        <table class="data"><thead><tr><th class="num">VPN</th><th>Content</th><th class="num">Frame</th><th>Valid</th></tr></thead><tbody>${cells}</tbody></table></div>`;
    }).join("") : `<div class="tiny muted">No active flights. With a reference string loaded, its pages show as "Reference".</div>`);
  },
};
