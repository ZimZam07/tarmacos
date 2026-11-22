// chrome.js - top bar, navigation rail, scenario + settings menus, HUD, camera dock, offline banner.
// Every control here sends a real engine command; nothing changes only the picture.
import { HOSTED, restartEngine } from "../api.js";
import { isLive, store, subscribe } from "../store.js";
import { appBus, go, route, selection, settings } from "../core/state.js";
import { isRunning, stateCounts, utilization } from "../core/model.js";
import { confirmAction, esc, flightName, ICONS, run, setHTML, STATE_COLOR, toast } from "../ui.js";
import { traffic } from "./traffic.js";
import { scenarioLabel, scenarioNote } from "../core/plain.js";

export const SCENARIOS = [
  { id: "contention", cmd: "scenario contention", go: "airport", title: "Busy apron", desc: "5 flights share 3 gates, 1 fuel truck and 1 tug. Real blocking, refuel/baggage pthreads, child-process cart planning.", tag: "Airport" },
  { id: "traffic", cmd: null, go: "airport", title: "Open airport · live traffic", desc: "Empty apron (6 gates, 2 trucks, 2 tugs). Your browser keeps sending real `flight create` commands.", tag: "Airport" },
  { id: "deadlock", cmd: "scenario deadlock RECOVERY action=PREEMPT", go: "explorer/deadlock", title: "Three-way deadlock", desc: "A, B, C each hold one resource and want the next: a real circular wait, then RECOVERY rolls back a victim.", tag: "Deadlock" },
  { id: "sched", cmd: "scenario sched-ref RR", go: "explorer/scheduler", title: "Scheduler reference", desc: "Four CPU-only flights with hand-checked FCFS / Priority / RR results.", tag: "CPU" },
  { id: "emergency", cmd: "scenario emergency preempt=on", go: "explorer/scheduler", title: "Emergency landing", desc: "A priority-0 flight arrives at t=2 and preempts the running flight.", tag: "CPU" },
  { id: "mem", cmd: "scenario mem-ref string=silberschatz frames=3", go: "explorer/memory", title: "FIFO paging", desc: "Silberschatz reference string with 3 frames: 15 page faults.", tag: "Memory" },
  { id: "disk", cmd: "scenario disk-ref SSTF", go: "explorer/disk", title: "Baggage cart = disk head", desc: "Six requests on belt 0–49; the forked child process plans the SSTF order.", tag: "Disk" },
];

export async function loadScenario(s) {
  traffic.stop();
  if (s.id === "traffic") {
    if (!(await run("sim reset"))) return false;
    traffic.start();
    await run("sim run");
    go(s.go);
    toast("Open airport: live traffic generator on");
    return true;
  }
  if (!(await run(s.cmd))) return false;
  go(s.go);
  toast(`Scenario loaded: ${s.title}`);
  return true;
}

const RAIL = [
  { href: "airport", label: "Airport", icon: "airport" },
  { href: "airport/flights", label: "Flights", icon: "flights", badge: "flights" },
  { href: "airport/ground", label: "Ground Ops", icon: "ground", badge: "ground" },
  { href: "airport/resources", label: "Resources", icon: "resources", badge: "res" },
  "sep",
  { href: "explorer", label: "OS Explorer", icon: "explorer", badge: "dead" },
  { href: "analytics", label: "Analytics", icon: "analytics" },
  { href: "story", label: "Story", icon: "story" },
];

const VIEWS = [["overview", "Overview", "overview"], ["runway", "Runway", "runway"], ["gates", "Gates", "gate"], ["ground", "Ground", "truck"], ["tower", "Tower", "tower"]];

export function initChrome(app) {
  // ---------------- rail
  const rail = document.getElementById("rail");
  rail.innerHTML = RAIL.map((r) => r === "sep" ? '<div class="rail-sep"></div>'
    : `<a href="#/${r.href}" data-href="${r.href}">${ICONS[r.icon]}<span>${r.label}</span>${r.badge ? `<span class="rail-badge hidden" data-badge="${r.badge}"></span>` : ""}</a>`).join("");
  const markRail = () => {
    const cur = route.current.area + (route.current.sub ? "/" + route.current.sub : "");
    rail.querySelectorAll("a").forEach((a) => {
      const h = a.dataset.href;
      a.classList.toggle("on", h === cur || (h === "explorer" && route.current.area === "explorer") || (h === "airport" && cur === "airport"));
    });
  };
  route.on(markRail);
  markRail();

  // ---------------- controls
  const $ = (id) => document.getElementById(id);
  $("btn-step").innerHTML = ICONS.step;
  $("btn-end").innerHTML = ICONS.end;
  $("btn-reset").innerHTML = ICONS.reset;
  $("btn-settings").innerHTML = ICONS.gear;
  $("btn-scenario").querySelector(".ic").outerHTML = ICONS.scenario;
  const toggleRun = () => (isRunning(store.snap) ? run("sim pause") : run("sim run"));
  $("btn-run").onclick = toggleRun;
  $("btn-step").onclick = () => run("sim step");
  $("btn-end").onclick = () => run("sim run-until-quiet 500");
  appBus.on((t) => { if (t === "toggle-run") toggleRun(); if (t === "step" && !isRunning(store.snap)) run("sim step"); });
  $("speed").querySelectorAll("button").forEach((b) => (b.onclick = () => run("sim speed " + b.dataset.ms)));
  $("btn-reset").onclick = async () => {
    const ok = await confirmAction("Reset the simulation?",
      "Every flight and worker thread is stopped and joined, all resources are released and the apron returns to its initial state (6 gates, 2 fuel trucks, 2 tugs). The baggage-handler child process keeps running.", "Reset");
    if (!ok) return;
    traffic.stop();
    appBus.emit("story-stop");
    if (await run("sim reset")) { selection.clear(); toast("Simulation reset"); }
  };
  const syncSound = () => { $("btn-sound").innerHTML = settings.sound ? ICONS.sound : ICONS.mute; $("btn-sound").title = settings.sound ? "Sound on (click to mute)" : "Sound off (click to enable subtle cues)"; };
  $("btn-sound").onclick = () => settings.update({ sound: !settings.sound });
  settings.on(syncSound);
  syncSound();
  $("btn-scenario").onclick = (e) => openScenarioMenu(e.currentTarget);
  $("btn-settings").onclick = (e) => openSettings(e.currentTarget, app);

  // ---------------- camera dock
  const dock = $("view-dock");
  dock.innerHTML = VIEWS.map(([id, label, icon]) => `<button data-view="${id}" title="${label} view">${ICONS[icon]}<span>${label}</span></button>`).join("")
    + `<span class="vsep"></span><button data-act="follow" title="Follow the selected aircraft">${ICONS.follow}<span>Follow</span></button>`
    + `<button data-act="labels" title="Cycle labels: all / selected / none">${ICONS.log}<span>Labels</span></button>`;
  let viewOn = "overview";
  let following = null;
  dock.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !app.scene) return;
    if (b.dataset.view) { viewOn = b.dataset.view; following = null; app.scene.preset(viewOn); }
    if (b.dataset.act === "follow") {
      if (following != null) { following = null; app.scene.follow(null); }
      else if (selection.type === "flight") { following = selection.id; app.scene.follow(following); viewOn = null; }
      else toast("Select an aircraft first, then press Follow");
    }
    if (b.dataset.act === "labels") {
      const next = { all: "selected", selected: "none", none: "all" }[settings.labels];
      settings.update({ labels: next });
      toast(`Labels: ${next}`);
    }
    markDock();
  });
  appBus.on((t, v) => { if (t === "follow") { following = v; markDock(); } if (t === "fps") showFps(v); });
  const markDock = () => {
    dock.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === viewOn));
    dock.querySelector('[data-act="follow"]').classList.toggle("on", following != null);
  };
  markDock();
  const fpsEl = $("fps");
  const showFps = (fps) => {
    fpsEl.classList.toggle("hidden", !settings.fps);
    if (settings.fps) fpsEl.textContent = `${Math.round(fps)} fps · ${settings.quality}`;
  };
  settings.on(() => fpsEl.classList.toggle("hidden", !settings.fps));

  subscribe(() => requestAnimationFrame(renderChrome));
  renderChrome();
}

// ---------------------------------------------------------------- per-snapshot render
let lastKey = "";
function renderChrome() {
  const snap = store.snap;
  const live = isLive();
  const $ = (id) => document.getElementById(id);
  const pill = $("engine-pill");
  pill.classList.toggle("online", live);
  pill.classList.toggle("offline", !live);
  const code = store.engine.error;
  let text;
  if (code === "E_CAPACITY") text = "Server busy";
  else if (code === "E_SESSION_EXPIRED") text = "Session ended";
  else if (!store.connected) text = HOSTED ? "Connecting to server…" : "Bridge unreachable";
  else if (!store.engine.online) text = "Engine offline";
  else text = "Engine running";
  $("engine-text").textContent = text;
  pill.title = live ? `C++ engine process ${store.engine.engine_pid} · helper process ${store.engine.child_pid}` : text;

  $("clock").textContent = snap ? "T+" + String(snap.tick).padStart(4, "0") : "T+----";
  const running = isRunning(snap);
  let runState = "—", dot = "";
  if (snap) {
    runState = snap.sim.running ? "Running" : snap.sim.fast ? "Running to end" : snap.sim.quiet && snap.flights.length ? "Idle · nothing can progress" : "Paused";
    dot = running ? "running" : "paused";
  }
  setHTML($("st-run"), `<span class="run-dot ${dot}"></span>${esc(runState)}`);
  $("st-scenario").textContent = snap ? scenarioLabel(snap.sim.scenario) : "—";
  setHTML($("btn-run"), running ? `${pauseIcon()}<span class="txt">Pause</span>` : `${playIcon()}<span class="txt">Run</span>`);
  $("btn-run").classList.toggle("primary", !running);
  $("btn-run").disabled = !live;
  $("btn-step").disabled = !live || running;
  $("btn-end").disabled = !live || running;
  $("btn-reset").disabled = !live;
  $("btn-scenario").disabled = !live;
  document.querySelectorAll("#speed button").forEach((b) => { b.classList.toggle("on", !!snap && Number(b.dataset.ms) === snap.sim.tick_ms); b.disabled = !live; });

  renderBadges(snap);
  renderHud(snap);
  renderOffline(live);
  void lastKey;
}
const playIcon = () => '<svg viewBox="0 0 16 16"><path d="M4.5 3l8.5 5-8.5 5z" fill="currentColor"/></svg>';
const pauseIcon = () => '<svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/></svg>';

function renderBadges(snap) {
  const set = (k, n, red) => {
    const el = document.querySelector(`[data-badge="${k}"]`);
    if (!el) return;
    el.classList.toggle("hidden", !n);
    el.classList.toggle("red", !!red);
    el.textContent = n || "";
  };
  if (!snap) return;
  set("flights", snap.flights.filter((f) => f.state !== "TERMINATED").length);
  set("ground", snap.threads.filter((t) => t.kind === "service").length);
  set("res", snap.pending.length);
  set("dead", snap.deadlock.deadlocked.length ? "!" : 0, true);
}

function renderHud(snap) {
  const hud = document.getElementById("hud");
  const sc = document.getElementById("hud-scenario");
  if (!snap) return;
  const c = stateCounts(snap);
  const active = snap.flights.length - c.TERMINATED;
  const u = utilization(snap);
  const order = ["RUNNING", "READY", "BLOCKED", "NEW"];
  const segs = [];
  for (const k of order) for (let i = 0; i < c[k]; i++) segs.push(STATE_COLOR[k]);
  const bar = segs.slice(0, 12).map((col) => `<i style="background:${col}"></i>`).join("") || "<i></i>";
  const resTile = (label, x) => `<div class="hud-tile panel"><div class="k">${label}</div><div class="v">${x.used}<small> / ${x.total}</small></div><div class="bar">${Array.from({ length: x.total }, (_, i) => `<i style="background:${i < x.used ? "#20c8ff" : ""}"></i>`).join("")}</div></div>`;
  const cpu = snap.cpu.running >= 0 ? flightName(snap, snap.cpu.running) : "idle";
  setHTML(hud, `
    <div class="hud-tile panel"><div class="k">Flights</div><div class="v">${active}<small> active · ${c.TERMINATED} done</small></div><div class="bar">${bar}</div></div>
    <div class="hud-tile panel"><div class="k">CPU · ${esc(snap.cpu.algo)}${snap.cpu.algo === "RR" ? " q" + snap.cpu.quantum : ""}</div><div class="v" style="font-size:15px">${esc(cpu)}</div><div class="bar"><i style="background:${snap.cpu.running >= 0 ? "#20c8ff" : ""}"></i></div></div>
    ${resTile("Gates", u.GATE)}${resTile("Fuel trucks", u.FUEL_TRUCK)}${resTile("Tugs", u.TUG)}`);
  const empty = snap.flights.length === 0;
  setHTML(sc, empty
    ? `<b>The apron is empty.</b> Load a scenario from <b>Scenarios</b>, create a flight in <a href="#/airport/flights">Flights</a>, or try <a href="#/story">Story Mode</a>.`
    : `<b>${esc(scenarioLabel(snap.sim.scenario))}</b> · ${esc(scenarioNote(snap.sim))}${traffic.on ? ` <span class="badge info">live traffic</span>` : ""}`);
}

function renderOffline(live) {
  const slot = document.getElementById("offline-slot");
  if (live) { setHTML(slot, ""); return; }
  const code = store.engine.error;
  let title = "Engine offline.", why = "The C++ engine is not running. Values are frozen until it restarts.";
  let button = store.connected ? '<button class="btn small" id="btn-restart">Restart engine</button>' : "";
  if (code === "E_CAPACITY") { title = "Server busy."; why = `${esc(store.engine.msg || "All simulation slots are in use.")} Retrying automatically…`; button = ""; }
  else if (code === "E_SESSION_EXPIRED") { title = "Session ended."; why = "Your simulation was stopped after a period of inactivity; its threads and child process were cleaned up."; button = '<button class="btn small primary" id="btn-new-session">Start a new simulation</button>'; }
  else if (!store.connected && HOSTED) { title = "Connecting…"; why = "Waiting for the TarmacOS server. On the free hosting tier it sleeps when unused and takes up to a minute to wake."; }
  else if (!store.connected) why = "Cannot reach the bridge. Start it with <code>./scripts/run_dev.sh</code>.";
  setHTML(slot, `<div class="offline"><b>${title}</b><span>${why}</span>${button}</div>`);
  const r = document.getElementById("btn-restart");
  if (r) r.onclick = async () => { const x = await restartEngine(); toast(x.ok ? "Engine restarted" : x.error?.msg || "Engine could not be restarted", !x.ok); };
  const n = document.getElementById("btn-new-session");
  if (n) n.onclick = () => appBus.emit("new-session");
}

// ---------------------------------------------------------------- popovers
let openPop = null;
function popover(anchor, html, onMount) {
  closePop();
  const el = document.createElement("div");
  el.className = "popover";
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  el.style.top = r.bottom + 8 + "px";
  el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + "px";
  openPop = el;
  onMount?.(el);
  setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
  return el;
}
function outside(e) { if (openPop && !openPop.contains(e.target)) closePop(); }
function closePop() { if (openPop) { openPop.remove(); openPop = null; document.removeEventListener("pointerdown", outside, true); } }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

function openScenarioMenu(anchor) {
  popover(anchor, `<div class="menu-head"><div class="eyebrow">Scenarios</div><div class="tiny muted" style="margin-top:3px">Each one resets the engine and loads a reproducible preset.</div></div>
    ${SCENARIOS.map((s, i) => `<button class="menu-item" data-i="${i}"><span class="mi-ic">${ICONS[s.tag === "Airport" ? "airport" : s.tag === "CPU" ? "analytics" : s.tag === "Deadlock" ? "explorer" : s.tag === "Memory" ? "resources" : "truck"]}</span>
      <span><div class="mi-t">${esc(s.title)} <span class="badge" style="margin-left:4px">${s.tag}</span></div><div class="mi-d">${esc(s.desc)}</div></span></button>`).join("")}`, (el) => {
    el.style.width = "380px";
    el.querySelectorAll("[data-i]").forEach((b) => (b.onclick = async () => {
      closePop();
      appBus.emit("story-stop");
      await loadScenario(SCENARIOS[Number(b.dataset.i)]);
    }));
  });
}

function openSettings(anchor, app) {
  const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(settings[key]) === String(v) ? "on" : ""}">${l}</button>`).join("")}</div>`;
  popover(anchor, `<div class="menu-head"><div class="eyebrow">Settings</div></div>
    <div class="set-row"><div><div class="sr-l">3D quality</div><div class="sr-h">Performance: no shadows, 30 fps cap</div></div>${seg("quality", [["performance", "Perf"], ["balanced", "Balanced"], ["high", "High"]])}</div>
    <div class="set-row"><div><div class="sr-l">Motion</div><div class="sr-h">Reduced shortens animations</div></div>${seg("motion", [["auto", "Auto"], ["reduced", "Reduced"], ["full", "Full"]])}</div>
    <div class="set-row"><div class="sr-l">Labels</div>${seg("labels", [["all", "All"], ["selected", "Selected"], ["none", "None"]])}</div>
    <div class="set-row"><div class="sr-l">Assignment lines</div>${seg("links", [[true, "On"], [false, "Off"]])}</div>
    <div class="set-row"><div class="sr-l">Sound cues</div>${seg("sound", [[true, "On"], [false, "Off"]])}</div>
    <div class="set-row"><div class="sr-l">Frame-rate meter</div>${seg("fps", [[true, "On"], [false, "Off"]])}</div>
    <div class="divider" style="margin:6px 10px"></div>
    <div class="tiny muted" style="padding:2px 10px 8px;max-width:340px">The 1× / 2× / 5× buttons set the engine's tick length (1 s, 0.5 s, 0.2 s): the real execution speed. Animations follow the engine and catch up when it runs ahead; they never run their own clock.${app.fallback ? "<br><b>WebGL is unavailable: showing the 2D map.</b>" : ""}</div>`, (el) => {
    el.style.width = "400px";
    el.querySelectorAll(".seg").forEach((s) => s.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      let v = b.dataset.v;
      if (v === "true") v = true; else if (v === "false") v = false;
      settings.update({ [s.dataset.key]: v });
      s.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    })));
  });
}
