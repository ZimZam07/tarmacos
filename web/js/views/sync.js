// sync.js - the real threads inside the engine and the semaphore bounded buffer.
import { badge, esc, flightName, REAL } from "../ui.js";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 5h14M3 10h14M3 15h14"/><circle cx="7" cy="5" r="1.6" fill="currentColor"/><circle cx="12" cy="10" r="1.6" fill="currentColor"/><circle cx="9" cy="15" r="1.6" fill="currentColor"/></svg>`;

export default {
  id: "sync",
  label: "Threads & sync",
  icon: ICON,
  concept: {
    title: "pthreads, mutexes, condition variables, semaphores",
    text: "All shared state is protected by one pthread mutex. Threads wait with <code>while (!condition) pthread_cond_wait()</code>, so wake-ups are never lost. Baggage requests pass through a bounded buffer built from two POSIX counting semaphores (<code>empty</code>, <code>full</code>) and a mutex: the classical producer-consumer solution. The pipe to the child process is guarded by a binary semaphore.",
    tags: [REAL("pthread_create/join, pthread_mutex, pthread_cond, sem_t"), badge("", "Lab M3/M5 · Assignment 5")],
  },
  mount(root) {
    root.innerHTML = `
      <div class="view-head"><div><h1 class="view-title">Threads &amp; synchronisation</h1>
        <div class="view-sub">Every row below is a real Linux thread of the engine process (TIDs match <code>ps -T</code> in the Ops Terminal).</div></div></div>
      <div class="grid cols-side">
        <div class="card"><div class="card-head"><span class="card-title">Engine threads</span><span id="sy-count" class="small muted"></span></div><div class="table-wrap" id="sy-threads"></div></div>
        <div class="grid">
          <div class="card">
            <div class="card-head"><span class="card-title">Bounded buffer</span>${REAL("sem_t empty/full + mutex")}</div>
            <div class="buffer" id="sy-buffer"></div>
            <div class="semrow" id="sy-sems"></div>
            <div class="small muted" style="margin-top:10px">Producers: BAGGAGE worker threads (<code>sem_wait(empty)</code> → insert → <code>sem_post(full)</code>). Consumer: the intake thread (<code>sem_wait(full)</code> → remove → <code>sem_post(empty)</code>).</div>
          </div>
          <div class="card">
            <div class="card-head"><span class="card-title">Primitives in use</span></div>
            <table class="data"><tbody>
              <tr><td>Monitor (mutex + condition variables)</td><td>resource table, CPU turns, ack barrier</td></tr>
              <tr><td>Counting semaphores</td><td>bounded-buffer <code>empty</code> / <code>full</code></td></tr>
              <tr><td>Binary semaphore</td><td>child-process pipe channel (one exchange at a time)</td></tr>
              <tr><td>pthread_join + return value</td><td>flights collect ServiceResult from workers</td></tr>
            </tbody></table>
          </div>
        </div>
      </div>`;
  },
  update(snap) {
    const kindBadge = { main: "", clock: "", intake: "", flight: "count", service: "warn" };
    document.getElementById("sy-count").textContent = `${snap.threads.length} threads`;
    document.getElementById("sy-threads").innerHTML = `<table class="data"><thead><tr><th>Thread</th><th>Kind</th><th class="num">Linux TID</th><th>Currently</th></tr></thead><tbody>${snap.threads.map((t) => `
      <tr><td>${esc(t.name)}</td><td>${badge(kindBadge[t.kind] || "", t.kind)}</td><td class="num">${t.tid || "—"}</td>
      <td class="small ${/sem_wait\(empty\)/.test(t.state) ? "" : "muted"}" style="${/sem_wait\(empty\)/.test(t.state) ? "color:var(--amber)" : ""}">${esc(t.state)}${t.task_state ? ` · ${esc(t.task_state)}` : ""}</td></tr>`).join("")}</tbody></table>`;
    const s = snap.sync;
    const slots = [];
    for (let i = 0; i < s.capacity; i++) {
      const b = s.buffer[i];
      slots.push(b ? `<div class="slot filled" title="${esc(flightName(snap, b.spid))}">pos ${b.position}</div>` : `<div class="slot muted">empty</div>`);
    }
    document.getElementById("sy-buffer").innerHTML = slots.join("");
    document.getElementById("sy-sems").innerHTML = `<span>empty = <b>${s.empty_sem}</b></span><span>full = <b>${s.full_sem}</b></span><span class="muted">produced ${s.produced} · consumed ${s.consumed}</span>${s.intake_held ? badge("warn", "intake held (debug)") : ""}`;
  },
};
