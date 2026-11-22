// threads.js - Module 03: POSIX threads and synchronisation, from the engine's real thread table.
import { history } from "../core/history.js";
import { badge, esc, flightColor, flightName, REAL, setHTML, toast } from "../ui.js";
import { pageHead, simControls, wireSim } from "./common.js";
import { plainText, resName } from "../core/plain.js";
import { store } from "../store.js";

// "REFUEL #1 for AI101" -> "Refuelling worker for Flight 1", "flight AI101" -> "Flight 1"
function threadName(name) {
  return plainText(name, store.snap)
    .replace(/^flight Flight/, "Flight")
    .replace(/^REFUEL #\d+ for/, "Refuelling worker for")
    .replace(/^BAGGAGE #\d+ for/, "Baggage worker for")
    .replace("main (command reader)", "Main thread (reads commands)")
    .replace(/^clock$/, "Clock thread (drives each tick)")
    .replace("baggage intake (consumer)", "Baggage intake worker");
}

const CAT = {
  run: ["#20c8ff", "executing a step"],
  ready: ["#438bff", "cond_wait: waiting for its CPU turn"],
  block: ["#ffb547", "cond_wait: waiting for a resource / the cart"],
  sem: ["#a68bff", "sem_wait on the bounded buffer"],
  join: ["#2fd69a", "pthread_join / waiting for its workers"],
  idle: ["rgba(255,255,255,.08)", "idle / between ticks"],
  exit: ["#ff5c6c", "exited"],
};
const WINDOW = 40;
const LOCK = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>';

export default {
  mount(root, ctx) {
    root.innerHTML = pageHead({
      kicker: "03 · THREADING & SYNCHRONIZATION",
      title: "Ground services run as POSIX threads",
      text: "Every lane below is a real Linux thread inside the engine process (the TIDs match <code>ps -T</code> in Linux & IPC). Flights start a REFUEL and a BAGGAGE pthread at the gate and wait with <code>pthread_join</code>; shared state is protected by one mutex, and baggage flows through a semaphore bounded buffer.",
      annos: [REAL("pthread_create / join, pthread_mutex, pthread_cond, sem_t"), "<b>while (!cond) pthread_cond_wait()</b>: no lost wake-ups", "<b>no busy waiting</b>: blocked threads sleep"],
      right: `<button class="btn small" id="th-busy">Load busy apron</button>${simControls()}`,
    }) + `
      <div class="card" style="margin-bottom:14px"><div class="card-head"><span class="card-title">Thread lanes · last ${WINDOW} ticks as observed</span><span class="tiny muted" id="th-count"></span></div>
        <div class="legend" style="margin-bottom:12px">${Object.entries(CAT).map(([, [c, l]]) => `<span><i style="background:${c}"></i>${l}</span>`).join("")}</div>
        <div class="lanes" id="th-lanes"></div></div>
      <div class="grid c2">
        <div class="card"><div class="card-head"><span class="card-title">Bounded buffer · producer / consumer</span>${REAL("2 counting sem_t + mutex")}</div>
          <div class="buf" id="th-buf" style="margin-bottom:14px"></div>
          <div class="row" style="gap:10px;margin-bottom:12px"><div class="sem"><span class="stat-label">sem empty</span><span class="v" id="th-empty">0</span></div><div class="sem"><span class="stat-label">sem full</span><span class="v" id="th-full">0</span></div>
            <div class="small dim" style="flex:1;min-width:200px">Producers: BAGGAGE threads do <code>sem_wait(empty)</code> → insert → <code>sem_post(full)</code>.<br>Consumer: the intake thread does <code>sem_wait(full)</code> → remove → <code>sem_post(empty)</code>.</div></div>
          <div class="row"><span class="small muted" id="th-pc"></span><span class="spacer"></span><button class="btn small" id="th-hold">Hold the consumer</button></div>
          <div class="tiny muted" style="margin-top:8px">Holding the intake thread (an engine debug command) lets the buffer fill up, so producers really block in <code>sem_wait(empty)</code>. Release it to watch them wake.</div></div>
        <div class="card"><div class="card-head"><span class="card-title">Locks and shared resources</span></div><div id="th-locks"></div></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-head"><span class="card-title">Primitives in this engine</span></div>
        <table class="data"><tbody>
          <tr><td><b>Monitor</b> · one pthread_mutex + condition variables</td><td class="dim">resource table, CPU turns, the per-tick acknowledgement barrier</td></tr>
          <tr><td><b>Counting semaphores</b> · sem_t empty / full</td><td class="dim">bounded baggage buffer (capacity 4)</td></tr>
          <tr><td><b>Binary semaphore</b></td><td class="dim">the pipe channel to the child process: one exchange at a time</td></tr>
          <tr><td><b>pthread_join + return value</b></td><td class="dim">a flight collects each worker's ServiceResult</td></tr>
          <tr><td><b>Lock order</b></td><td class="dim mono small">Simulation::mtx → buffer mutex → output mutex · mtx is never held across sem_wait or a pipe read</td></tr>
        </tbody></table></div>`;
    root.querySelector("#th-busy").onclick = () => ctx.run("scenario contention");
    root.querySelector("#th-hold").onclick = async () => {
      const held = ctx.snap?.sync.intake_held;
      if (await ctx.run(`debug intake ${held ? "release" : "hold"}`)) toast(held ? "Consumer released" : "Consumer held: the buffer will fill");
    };
    wireSim(root, ctx);
  },

  update(snap) {
    const lanes = [...history.threads.values()].sort((a, b) => order(a) - order(b) || (a.first - b.first));
    document.getElementById("th-count").textContent = `${snap.threads.length} live threads in PID ${snap.ipc.engine_pid}`;
    const t1 = snap.tick, t0 = Math.max(0, t1 - WINDOW + 1);
    setHTML(document.getElementById("th-lanes"), lanes.map((rec) => {
      const cells = [];
      let lastCat = null;
      for (let t = t0; t <= t1; t++) {
        const c = rec.samples.get(t);
        if (c) lastCat = c;
        const show = t < rec.first || (!rec.alive && t > rec.endedAt) ? null : c || lastCat;
        cells.push(`<i style="background:${show ? CAT[show][0] : "transparent"}"></i>`);
      }
      const color = rec.spid > 0 ? flightColor(rec.spid) : "var(--muted)";
      return `<div class="lane"><span class="lane-name"><span class="dot" style="background:${color};margin-right:6px"></span>${esc(threadName(rec.name))} <span class="tid">${rec.tid ? "id " + rec.tid : ""}</span></span>
        <span class="lane-track">${cells.join("")}</span><span class="lane-state">${rec.alive ? esc(rec.state) : "exited · joined"}</span></div>`;
    }).join("") || `<div class="empty">No thread history yet.</div>`);

    const s = snap.sync;
    setHTML(document.getElementById("th-buf"), Array.from({ length: s.capacity }, (_, i) => { const b = s.buffer[i]; return `<span class="slot ${b ? "full" : ""}" style="${b ? `--c:${flightColor(b.spid)}` : ""}" title="${b ? esc(flightName(snap, b.spid)) : "empty"}">${b ? "bag · spot " + b.position : "empty"}</span>`; }).join(""));
    document.getElementById("th-empty").textContent = s.empty_sem;
    document.getElementById("th-full").textContent = s.full_sem;
    document.getElementById("th-empty").style.color = s.empty_sem === 0 ? "var(--red)" : "";
    const blockedProducers = snap.threads.filter((t) => /sem_wait\(empty\)/.test(t.state));
    setHTML(document.getElementById("th-pc"), `produced ${s.produced} · consumed ${s.consumed}${s.intake_held ? ` · ${badge("warn", "consumer held")}` : ""}${blockedProducers.length ? ` · ${badge("err", blockedProducers.length + " producer(s) blocked in sem_wait")}` : ""}`);
    document.getElementById("th-hold").textContent = s.intake_held ? "Release the consumer" : "Hold the consumer";

    // locks: the engine mutex, then every fuel truck / tug as an exclusive resource with its waiters
    const res = snap.resources.filter((r) => r.class !== "GATE" && r.enabled);
    const ownerText = (r) => {
      if (r.owner < 0) return '<span class="muted">free</span>';
      const t = r.owner_task ? snap.threads.find((x) => x.kind === "service" && x.task === r.owner_task) : null;
      return `<b style="color:${flightColor(r.owner)}">${esc(flightName(snap, r.owner))}</b> ${t ? (t.service === "REFUEL" ? "refuelling worker" : "baggage worker") : "flight thread"}`;
    };
    setHTML(document.getElementById("th-locks"), `<div class="lock">${LOCK}<div><div class="small"><b>Simulation::mtx</b> · pthread_mutex_t</div><div class="tiny muted">Guards all simulation state. Held briefly by the clock, the command reader and each worker step; never across a blocking wait.</div></div></div>`
      + res.map((r) => {
        const waiters = snap.pending.filter((p) => p.class === r.class);
        return `<div class="lock ${r.owner >= 0 ? "held" : ""}">${LOCK}<div style="flex:1"><div class="small"><b>${esc(resName(r.id))}</b> → ${ownerText(r)}</div>
          ${waiters.length ? `<div class="tiny" style="color:var(--amber);margin-top:2px">waiting (pthread_cond_wait): ${waiters.map((p) => `${esc(flightName(snap, p.spid))}${p.task ? "'s refuelling worker" : ""}`).join(", ")}</div>` : ""}</div></div>`;
      }).join(""));
  },
};

const order = (r) => ({ main: 0, clock: 1, intake: 2, flight: 3, service: 4 })[r.kind] ?? 5;
