// main.js - application shell: navigation, top bar, controls, concept panel, event log.
import { connect, HOSTED, renewSession, restartEngine } from "./api.js";
import { acceptSnapshot, isLive, setConnected, setEngine, store, subscribe } from "./store.js";
import { confirmAction, esc, run, toast } from "./ui.js";
import overview from "./views/overview.js";
import flights from "./views/flights.js";
import scheduler from "./views/scheduler.js";
import resources from "./views/resources.js";
import sync from "./views/sync.js";
import deadlocks from "./views/deadlocks.js";
import memory from "./views/memory.js";
import storage from "./views/storage.js";
import terminal from "./views/terminal.js";

const VIEWS = [overview, flights, scheduler, resources, sync, deadlocks, memory, storage, terminal];
const SECTIONS = { overview: "Control", flights: "Processes & CPU", resources: "Concurrency", memory: "Memory & storage", terminal: "Linux" };
const mounted = new Map();
let current = null;

// ---------------------------------------------------------------- navigation
function buildNav() {
  const nav = document.getElementById("nav");
  let html = "";
  for (const v of VIEWS) {
    if (SECTIONS[v.id]) html += `<div class="nav-section">${SECTIONS[v.id]}</div>`;
    html += `<a class="nav-item" href="#${v.id}" data-view="${v.id}">${v.icon}<span>${esc(v.label)}</span><span class="badge-slot" id="nb-${v.id}"></span></a>`;
  }
  html += `<div class="nav-foot">C++ engine · POSIX threads, semaphores, fork &amp; pipes · Python stdlib bridge</div>`;
  nav.innerHTML = html;
}

function show(id) {
  const view = VIEWS.find((v) => v.id === id) || VIEWS[0];
  current = view;
  document.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.view === view.id));
  const main = document.getElementById("main");
  main.innerHTML = "";
  const root = document.createElement("div");
  main.appendChild(root);
  const offline = document.createElement("div");
  offline.id = "offline-slot";
  root.appendChild(offline);
  const body = document.createElement("div");
  root.appendChild(body);
  view.mount(body, context);
  mounted.set(view.id, body);
  renderConcept(view);
  render();
}

function renderConcept(view) {
  const c = view.concept;
  document.getElementById("concept").innerHTML = `
    <h3>${esc(c.title)}</h3>
    <p>${c.text}</p>
    <div class="tags">${c.tags.join("")}</div>`;
}

// ---------------------------------------------------------------- top bar
function renderTop() {
  const snap = store.snap;
  const pill = document.getElementById("engine-pill");
  const text = document.getElementById("engine-text");
  const live = isLive();
  pill.classList.toggle("online", live);
  pill.classList.toggle("offline", !live);
  const code = store.engine.error;
  if (code === "E_CAPACITY") text.textContent = "Server busy";
  else if (code === "E_SESSION_EXPIRED") text.textContent = "Session ended";
  else if (!store.connected) text.textContent = HOSTED ? "Connecting to server…" : "Bridge unreachable";
  else if (!store.engine.online) text.textContent = "Engine offline";
  else text.textContent = `Engine PID ${store.engine.engine_pid} · child ${store.engine.child_pid}`;

  document.getElementById("clock").textContent = snap ? "T+" + String(snap.tick).padStart(4, "0") : "T+----";
  document.getElementById("st-scenario").textContent = snap ? snap.sim.scenario : "—";
  let runState = "—";
  if (snap) runState = snap.sim.running ? "Running" : snap.sim.fast ? "Running to end" : snap.sim.quiet ? "Idle" : "Paused";
  document.getElementById("st-run").textContent = runState;

  const running = !!snap && (snap.sim.running || snap.sim.fast);
  document.getElementById("btn-run").disabled = !live || running;
  document.getElementById("btn-pause").disabled = !live || !running;
  document.getElementById("btn-step").disabled = !live || running;
  document.getElementById("btn-finish").disabled = !live || running;
  document.getElementById("btn-reset").disabled = !live;
  document.getElementById("speed").disabled = !live;
  if (snap && document.activeElement !== document.getElementById("speed")) {
    const sel = document.getElementById("speed");
    if ([...sel.options].some((o) => Number(o.value) === snap.sim.tick_ms)) sel.value = String(snap.sim.tick_ms);
  }
}

function renderNavBadges() {
  const snap = store.snap;
  if (!snap) return;
  const active = snap.flights.filter((f) => f.state !== "TERMINATED").length;
  const set = (id, html) => {
    const el = document.getElementById("nb-" + id);
    if (el) el.innerHTML = html;
  };
  set("flights", active ? `<span class="badge count">${active}</span>` : "");
  set("deadlocks", snap.deadlock.deadlocked.length ? `<span class="badge err">deadlock</span>` : "");
  set("resources", snap.pending.length ? `<span class="badge warn">${snap.pending.length} waiting</span>` : "");
  set("storage", snap.disk.waiting.length + snap.disk.batch_remaining.length
    ? `<span class="badge count">${snap.disk.waiting.length + snap.disk.batch_remaining.length}</span>` : "");
}

// ---------------------------------------------------------------- event log
const CATEGORY = (kind) => {
  if (/DEADLOCK|VICTIM|RECOVER|POLICY|UNSAFE/.test(kind)) return "dead";
  if (/ERROR|INVARIANT/.test(kind)) return "err";
  if (/^RES_|FLIGHT_READY/.test(kind)) return "res";
  if (/DISPATCH|QUANTUM|PREEMPT|SCHED|ADMITTED/.test(kind)) return "cpu";
  if (/PAGE|MEM/.test(kind)) return "mem";
  if (/DISK|IPC/.test(kind)) return "disk";
  return "other";
};
let lastLogKey = "";
function renderLog() {
  const snap = store.snap;
  const filter = document.getElementById("log-filter").value;
  if (!snap) return;
  const events = snap.events.filter((e) => filter === "all" || CATEGORY(e.kind) === filter || (filter === "disk" && CATEGORY(e.kind) === "disk"));
  const key = filter + snap.epoch + ":" + (snap.events.length ? snap.events[snap.events.length - 1].seq : 0);
  if (key === lastLogKey) return;
  lastLogKey = key;
  const log = document.getElementById("log");
  log.innerHTML = events.length
    ? events.slice().reverse().map((e) => `
        <div class="log-item c-${CATEGORY(e.kind)}">
          <span class="t">t${e.tick}</span>
          <div><div class="k">${esc(e.kind)}</div><div class="m">${esc(e.msg)}</div></div>
        </div>`).join("")
    : `<div class="empty small">No events yet. Start a scenario or create a flight.</div>`;
}

// ---------------------------------------------------------------- render loop
function renderOffline() {
  const slot = document.getElementById("offline-slot");
  if (!slot) return;
  if (isLive()) {
    slot.innerHTML = "";
    return;
  }
  const code = store.engine.error;
  let title = "Engine offline.";
  let why = "The C++ engine is not running. All values below are frozen until it restarts.";
  let button = store.connected ? '<button class="btn small" id="btn-restart">Restart engine</button>' : "";
  if (code === "E_CAPACITY") {
    title = "Server busy.";
    why = `${esc(store.engine.msg || "All simulation slots are in use.")} Retrying automatically…`;
    button = "";
  } else if (code === "E_SESSION_EXPIRED") {
    title = "Session ended.";
    why = "Your simulation was stopped after a period of inactivity, and its threads and child process were cleaned up.";
    button = '<button class="btn small primary" id="btn-new-session">Start a new simulation</button>';
  } else if (!store.connected && HOSTED) {
    title = "Connecting…";
    why = "Waiting for the TarmacOS server. On the free hosting tier it sleeps when unused and takes up to a minute to wake.";
  } else if (!store.connected) {
    why = "Cannot reach the bridge. Start it with <code>./scripts/run_dev.sh</code>.";
  }
  slot.innerHTML = `<div class="offline-banner"><strong>${title}</strong><span>${why}</span>
    <span class="spacer"></span>${button}</div>`;
  const btn = document.getElementById("btn-restart");
  if (btn) btn.onclick = async () => {
    const r = await restartEngine();
    toast(r.ok ? "Engine restarted" : (r.error?.msg || "Engine could not be restarted"), !r.ok);
  };
  const fresh = document.getElementById("btn-new-session");
  if (fresh) fresh.onclick = () => {
    lastOnlinePid = null;
    renewSession();
    openStream();
  };
}

let frame = 0;
function render() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    renderTop();
    renderNavBadges();
    renderLog();
    renderOffline();
    if (current && store.snap) current.update(store.snap, context);
  });
}

const context = {
  run,
  go: (id) => { location.hash = id; },
  get snap() { return store.snap; },
  get live() { return isLive(); },
};

// ---------------------------------------------------------------- controls
function wireControls() {
  document.getElementById("btn-run").onclick = () => run("sim run");
  document.getElementById("btn-pause").onclick = () => run("sim pause");
  document.getElementById("btn-step").onclick = () => run("sim step");
  document.getElementById("btn-finish").onclick = () => run("sim run-until-quiet 500");
  document.getElementById("speed").onchange = (e) => run("sim speed " + e.target.value);
  document.getElementById("btn-reset").onclick = async () => {
    const ok = await confirmAction("Reset the simulation?",
      "All flight and worker threads are stopped and joined, every resource is released and the apron returns to its initial state. The baggage-handler child process keeps running.",
      "Reset");
    if (ok && (await run("sim reset"))) toast("Simulation reset");
  };
  document.getElementById("log-filter").onchange = () => { lastLogKey = ""; renderLog(); };
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === " ") { e.preventDefault(); (store.snap?.sim.running ? run("sim pause") : run("sim run")); }
    if (e.key === "s") run("sim step");
  });
}

// ---------------------------------------------------------------- start
buildNav();
wireControls();
subscribe(render);
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
let source = null;
let lastOnlinePid = null; // to tell the user when a restart replaced their engine
function openStream() {
  if (source) source.close();
  source = connect({
    onSnapshot: acceptSnapshot,
    onEngine: (status) => {
      if (status.engine_pid !== store.engine.engine_pid) store.snap = null; // a new engine process
      if (status.online) {
        if (lastOnlinePid !== null && status.engine_pid !== lastOnlinePid)
          toast("A new engine process started, so the simulation is back at the empty apron.", true);
        lastOnlinePid = status.engine_pid;
      }
      if (status.error === "E_SESSION_EXPIRED") source.close(); // do not silently start a new one
      setEngine(status);
    },
    onConnection: setConnected,
  });
}
openStream();
show(location.hash.slice(1) || "overview");
