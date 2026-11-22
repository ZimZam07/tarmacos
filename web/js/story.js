// story.js - Airport Story Mode. It drives the REAL engine: it loads the deterministic "contention"
// scenario and advances it with `sim step`, one tick at a time, waiting for the airport animation to
// settle between ticks. Each chapter ends on a real engine event. Replaying a chapter re-runs the
// scenario to that chapter's start tick (the engine is deterministic, so the state is identical).
import { command } from "./api.js";
import { store } from "./store.js";
import { journal, onEvents } from "./core/journal.js";
import { appBus, go, route, selection } from "./core/state.js";
import { esc, flightName, ICONS, setHTML, toast } from "./ui.js";
import { resName, serviceLabel } from "./core/plain.js";

const FOCUS = 1; // AI101: the first flight of the contention scenario
const is = (e, kind, test = () => true) => e.kind === kind && test(e.data);
const of = (spid) => (d) => d.spid === spid;

const CHAPTERS = [
  {
    title: "A flight arrives",
    narr: "A new aircraft has entered the airport. TarmacOS turns it into a process: it gets an ID, a list of steps to carry out, and a real thread that runs them.",
    camera: (s) => s.follow(FOCUS),
    facts: [
      { m: (e) => is(e, "FLIGHT_CREATED", of(FOCUS)), t: (e) => `${name(FOCUS)} becomes a process · priority ${e.data.priority} · needs ${e.data.burst} CPU ticks` },
      { m: (e) => is(e, "FLIGHT_ADMITTED", of(FOCUS)), t: () => "It joins the queue for the CPU (NEW → READY)" },
      { m: (e) => is(e, "DISPATCHED", of(FOCUS)), t: () => "Round Robin gives it the CPU (READY → RUNNING)" },
      { m: (e) => is(e, "PHASE_CHANGED", (d) => d.spid === FOCUS && d.phase === "APPROACHING"), t: () => "Its first step: the aircraft starts its approach" },
    ],
    done: (evs) => evs.some((e) => is(e, "PHASE_CHANGED", (d) => d.spid === FOCUS && d.phase === "APPROACHING")),
  },
  {
    title: "Gate allocation",
    narr: "To land, the flight needs a gate. Gates are limited and only one flight can use each one, so the system hands them out fairly, longest wait first.",
    camera: (s) => s.follow(FOCUS),
    facts: [
      { m: (e) => is(e, "RES_REQUESTED", (d) => d.spid === FOCUS && d.class === "GATE"), t: () => "It asks for a gate" },
      { m: (e) => is(e, "RES_GRANTED", (d) => d.spid === FOCUS && /^G/.test(d.resource)), t: (e) => `${resName(e.data.resource)} assigned · waited ${e.data.waited} ticks` },
      { m: (e) => is(e, "PHASE_CHANGED", (d) => d.spid === FOCUS && d.phase === "LANDING"), t: () => "Landing on runway 09" },
      { m: (e) => is(e, "PHASE_CHANGED", (d) => d.spid === FOCUS && d.phase === "TAXIING"), t: () => "Taxiing to its gate" },
    ],
    done: (evs) => evs.some((e) => is(e, "PHASE_CHANGED", (d) => d.spid === FOCUS && d.phase === "TAXIING")),
  },
  {
    title: "CPU scheduling",
    narr: "Five flights now share one CPU. Round Robin gives each flight 4 ticks, then sends it to the back of the queue so the others get a turn.",
    camera: (s) => s.preset("overview"),
    facts: [
      { m: (e) => is(e, "QUANTUM_EXPIRED", of(FOCUS)), t: () => `${name(FOCUS)} used up its 4-tick time slice → back of the queue` },
      { m: (e) => is(e, "DISPATCHED", (d) => d.spid === 2), t: (e) => `Round Robin gives ${name(2)} its turn (tick ${e.tick})` },
      { m: (e) => is(e, "DISPATCHED", (d) => d.spid === 3), t: (e) => `Round Robin gives ${name(3)} its turn (tick ${e.tick})` },
      { m: (e) => is(e, "RES_GRANTED", (d) => d.spid === 3), t: (e) => `${name(3)} gets ${resName(e.data.resource)}: all 3 open gates are now taken` },
    ],
    done: (evs) => evs.filter((e) => is(e, "DISPATCHED", (d) => d.spid !== FOCUS)).length >= 2 && evs.some((e) => is(e, "RES_GRANTED", (d) => d.spid === 3)),
    link: ["Open the CPU scheduler", "explorer/scheduler"],
  },
  {
    title: "Resource contention",
    narr: "Two more flights need a gate, but all of them are taken. They wait, asleep (BLOCKED), until a gate is given back. Every flight asks for a gate, then a fuel truck, then a tug, always in that order, so this waiting can never turn into a deadlock.",
    camera: (s) => s.preset("gates"),
    facts: [
      { m: (e) => is(e, "RES_BLOCKED", (d) => d.class === "GATE"), t: (e) => `${name(e.data.spid)} must wait (BLOCKED): no gate is free`, all: true },
      { m: (e) => is(e, "PHASE_CHANGED", (d) => d.spid === 5 && d.phase === "APPROACHING"), t: () => `${name(5)} holds in the air until a gate frees` },
    ],
    done: (evs) => evs.filter((e) => is(e, "RES_BLOCKED", (d) => d.class === "GATE")).length >= 2,
    link: ["See a real circular wait", "explorer/deadlock"],
  },
  {
    title: "Ground services",
    narr: "At the gate, Flight 1 starts two worker threads, one for refuelling and one for baggage, and waits until both finish. They run at the same time: the refuelling worker competes for the only fuel truck, and the bags go through a shared holding area to the baggage cart, whose route a separate helper process plans.",
    camera: (s) => s.focus("gate", "G1"),
    facts: [
      { m: (e) => is(e, "SERVICES_STARTED", of(FOCUS)), t: (e) => `${e.data.tasks?.length || 2} worker threads started · ${name(FOCUS)} waits (BLOCKED) for them` },
      { m: (e) => is(e, "RES_GRANTED", (d) => d.spid === FOCUS && /^FT/.test(d.resource)), t: (e) => `The refuelling worker got ${resName(e.data.resource)}` },
      { m: (e) => is(e, "RES_BLOCKED", (d) => d.task > 0 && d.class === "FUEL_TRUCK"), t: (e) => `${name(e.data.spid)}'s refuelling worker waits: the only fuel truck is busy` },
      { m: (e) => is(e, "IPC_EXCHANGE"), t: (e) => `A helper process planned the baggage cart's route: spots ${e.data.order.join(" → ")}` },
      { m: (e) => is(e, "RES_GRANTED", (d) => d.spid === 2 && /^FT/.test(d.resource)), t: () => `Fuel truck 1 passes from ${name(1)} to ${name(2)}'s refuelling worker` },
      { m: (e) => is(e, "SERVICES_COMPLETE", of(FOCUS)), t: () => `All of ${name(FOCUS)}'s bags picked up · services done → back in the queue` },
    ],
    done: (evs) => evs.some((e) => is(e, "SERVICES_COMPLETE", of(FOCUS))),
    link: ["Watch the thread lanes", "explorer/threads"],
  },
  {
    title: "Departure",
    narr: "The workers finish, a tug pushes the aircraft back, everything it held is given back, and its process ends. The freed gate goes straight to the flight that has waited longest.",
    camera: (s) => s.follow(FOCUS),
    facts: [
      { m: (e) => is(e, "THREAD_JOINED", of(FOCUS)), t: (e) => `${serviceLabel(e.data.service)} finished and was collected (pthread_join)`, all: true },
      { m: (e) => is(e, "RES_GRANTED", (d) => d.spid === FOCUS && /^TG/.test(d.resource)), t: (e) => `${resName(e.data.resource)} assigned · pushing back` },
      { m: (e) => is(e, "RES_RELEASED", (d) => d.spid === FOCUS && /^G/.test(d.resource)), t: (e) => `${resName(e.data.resource)} given back` },
      { m: (e) => is(e, "FLIGHT_TERMINATED", of(FOCUS)), t: (e) => `Process finished · total ${e.data.tat} ticks · waited ${e.data.wt} in the queue` },
      { m: (e) => is(e, "RES_GRANTED", (d) => d.spid !== FOCUS && d.resource === "G1"), t: (e) => `Gate 1 goes to ${name(e.data.spid)}, which waited ${e.data.waited} ticks` },
    ],
    done: (evs) => evs.some((e) => is(e, "FLIGHT_TERMINATED", of(FOCUS))),
  },
];

const name = (spid) => flightName(store.snap, spid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = {
  active: false, paused: false, chapter: 0, starts: [], startSeq: 0, fast: false, finished: false,
  busy: "", loopId: 0, dwellUntil: 0, completeAt: 0,
};

export function initStory(app) {
  const panel = document.getElementById("story");
  const scene = () => app.scene;

  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) {
      const d = e.target.closest("[data-chap]");
      if (d && S.active) jump(Number(d.dataset.chap));
      return;
    }
    const a = b.dataset.act;
    if (a === "start") start();
    if (a === "pause") { S.paused = !S.paused; render(); }
    if (a === "next") { if (S.finished) return; S.fast = true; S.paused = false; render(); }
    if (a === "prev") jump(Math.max(0, S.chapter - 1));
    if (a === "replay") jump(S.chapter);
    if (a === "exit") { stop(); go("airport"); }
    if (a === "link") go(b.dataset.to);
    if (a === "explore") { stop(); go("explorer/process"); }
    if (a === "free") { stop(); go("airport"); command("sim run"); }
  });

  route.on((r) => {
    panel.classList.toggle("open", r.area === "story");
    if (r.area !== "story" && S.active && !S.paused) { S.paused = true; }
    render();
  });
  appBus.on((t) => { if (t === "story-stop") stop(); });
  onEvents(() => { if (route.current.area === "story") render(); });
  panel.classList.toggle("open", route.current.area === "story");
  render();

  // ---------------------------------------------------------------- engine driving
  async function start() {
    if (store.snap && (store.snap.sim.running || store.snap.sim.fast)) await command("sim pause");
    const r = await command("scenario contention");
    if (!r.ok) return toast(r.error?.msg || "Could not load the scenario", true);
    await command("sim speed 500");
    S.active = true; S.paused = false; S.finished = false; S.fast = false;
    S.chapter = 0; S.starts = [0];
    await waitFor(() => store.snap && store.snap.sim.scenario.startsWith("contention") && store.snap.tick === 0, 4000);
    S.startSeq = 0;
    selection.set("flight", FOCUS);
    enterChapter();
    loop();
  }

  function stop() {
    S.active = false;
    S.loopId++;
    render();
  }

  async function jump(index) {
    const tick = S.starts[index] ?? 0;
    S.loopId++;
    S.busy = "Rewinding the engine…";
    render();
    await command("scenario contention");
    if (tick > 0) await command(`sim run-until-quiet ${tick}`);
    await waitFor(() => store.snap && store.snap.tick === tick, 5000);
    S.active = true; S.paused = false; S.finished = false; S.fast = false;
    S.chapter = index;
    S.starts.length = index + 1;
    S.busy = "";
    selection.set("flight", FOCUS);
    enterChapter();
    loop();
  }

  function enterChapter() {
    S.completeAt = 0;
    const ch = CHAPTERS[S.chapter];
    if (scene()) setTimeout(() => ch.camera(scene()), 200);
    render();
  }

  async function loop() {
    const id = ++S.loopId;
    while (S.active && id === S.loopId) {
      if (S.paused || route.current.area !== "story") { await sleep(200); continue; }
      const evs = journal.events;
      const ch = CHAPTERS[S.chapter];
      if (ch.done(evs)) {
        // let the moment play out, then move on (or finish)
        if (!S.completeAt) { S.completeAt = performance.now(); render(); }
        const settled = !scene() || scene().settled();
        const dwell = S.fast ? 300 : 2600;
        if (performance.now() - S.completeAt < dwell || (!settled && !S.fast && performance.now() - S.completeAt < 9000)) { await sleep(150); continue; }
        S.fast = false;
        if (S.chapter === CHAPTERS.length - 1) { S.finished = true; render(); if (scene()) scene().preset("overview", 3); return; }
        S.chapter++;
        S.starts[S.chapter] = store.snap.tick;
        enterChapter();
        continue;
      }
      // advance the engine by exactly one tick
      const before = store.snap?.tick ?? 0;
      S.busy = `t=${before} → t=${before + 1}`;
      render();
      const r = await command("sim step");
      if (!r.ok) {
        if (r.error?.code === "E_STATE") await command("sim pause");
        await sleep(400);
        continue;
      }
      await waitFor(() => store.snap && store.snap.tick > before, 4000);
      // pace: give the airport time to show what the engine just did
      const t0 = performance.now();
      const minGap = S.fast ? 60 : 650;
      const maxWait = S.fast ? 400 : 3200;
      while (performance.now() - t0 < maxWait && id === S.loopId) {
        if (performance.now() - t0 > minGap && (!scene() || scene().settled())) break;
        await sleep(80);
      }
      S.busy = "";
    }
  }

  // ---------------------------------------------------------------- rendering
  function render() {
    if (route.current.area !== "story") return;
    if (!S.active && !S.finished) {
      setHTML(panel, `<div class="story-top"><span class="story-chap">AIRPORT STORY MODE</span></div>
        <h2>Follow one flight through the airport.</h2>
        <div class="narr">Six short chapters follow <b>Flight 1</b> from arrival to departure while four other flights compete for the same gates, fuel truck and CPU. Everything you see is the real C++ engine, advanced one tick at a time.</div>
        <div class="note amber small" style="margin-bottom:14px">Starting resets the engine and loads the <b>Busy apron</b> scenario.</div>
        <div class="story-ctrl"><button class="btn primary" data-act="start">Start the story</button><span class="spacer"></span><button class="btn ghost small" data-act="exit">Back to the airport</button></div>`);
      return;
    }
    const n = CHAPTERS.length;
    const dots = CHAPTERS.map((_, i) => `<i data-chap="${i}" title="Chapter ${i + 1}" class="${i < S.chapter || S.finished ? "done" : i === S.chapter ? "cur" : ""}"></i>`).join("");
    if (S.finished) {
      const f = store.snap?.flights.find((x) => x.spid === FOCUS);
      setHTML(panel, `<div class="story-top"><span class="story-chap">STORY COMPLETE</span><div class="story-dots">${dots}</div></div>
        <h2>Flight 1 is airborne.</h2>
        <div class="narr">One process went NEW → READY → RUNNING ⇄ BLOCKED → TERMINATED, held a gate, a fuel truck (through its refuelling worker) and a tug, and shared one CPU with four other flights.${f ? ` Turnaround <b>${f.turnaround}</b> ticks, of which <b>${f.waiting}</b> waiting in the ready queue and <b>${f.blocked_ticks}</b> blocked.` : ""}</div>
        <div class="story-ctrl"><button class="btn primary small" data-act="free">Keep the airport running</button><button class="btn small" data-act="explore">Explore OS concepts</button><span class="spacer"></span><button class="btn ghost small icon" data-act="replay" title="Replay the last chapter">${ICONS.replay}</button></div>`);
      return;
    }
    const ch = CHAPTERS[S.chapter];
    const evs = journal.events;
    const facts = [];
    for (const fct of ch.facts) {
      const hits = evs.filter(fct.m);
      for (const e of fct.all ? hits : hits.slice(0, 1)) facts.push(`<div class="story-fact"><span class="ck">${ICONS.check}</span><span>${esc(fct.t(e))}</span><span class="tk">t${e.tick}</span></div>`);
    }
    const next = CHAPTERS[S.chapter + 1];
    const status = S.busy ? `<span class="spin"></span>${esc(S.busy)}` : S.paused ? "Paused" : S.completeAt ? "Chapter complete" : `t=${store.snap?.tick ?? 0}`;
    setHTML(panel, `<div class="story-top"><span class="story-chap">CHAPTER ${String(S.chapter + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}</span><div class="story-dots">${dots}</div></div>
      <h2>${esc(ch.title)}</h2>
      <div class="narr">${ch.narr}</div>
      <div class="story-facts">${facts.join("") || '<div class="tiny muted">Watching the engine…</div>'}</div>
      ${ch.link ? `<div style="margin:-4px 0 12px"><button class="btn ghost small" data-act="link" data-to="${ch.link[1]}">${ICONS.link}${esc(ch.link[0])}</button></div>` : ""}
      <div class="story-next">${next ? `Next: <b>${esc(next.title)}</b> →` : "Last chapter"}</div>
      <div class="story-ctrl">
        <button class="btn small icon" data-act="prev" title="Previous chapter (rewinds the engine)" aria-label="Previous chapter" ${S.chapter === 0 ? "disabled" : ""}>${ICONS.prev}</button>
        <button class="btn small icon ${S.paused ? "primary" : ""}" data-act="pause" title="${S.paused ? "Resume" : "Pause"}" aria-label="Pause or resume">${S.paused ? ICONS.play : ICONS.pause}</button>
        <button class="btn small icon" data-act="replay" title="Replay this chapter (rewinds the engine)" aria-label="Replay chapter">${ICONS.replay}</button>
        <button class="btn small icon" data-act="next" title="Skip ahead: finish this chapter quickly" aria-label="Skip chapter">${ICONS.next}</button>
        <span class="story-status" style="margin-left:6px" id="story-status"></span>
        <span class="spacer"></span><button class="btn ghost small icon" data-act="exit" title="Exit Story Mode" aria-label="Exit">${ICONS.exit}</button>
      </div>`);
    // the status changes every tick: update it on its own so the chapter text does not re-render
    setHTML(document.getElementById("story-status"), status);
  }
  setInterval(() => { if (route.current.area === "story" && S.active) render(); }, 500);
}

async function waitFor(pred, ms) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) { if (pred()) return true; await sleep(50); }
  return false;
}
