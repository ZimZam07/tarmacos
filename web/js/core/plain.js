// plain.js - the dashboard's plain-language vocabulary.
// The engine keeps its precise internal identifiers (call signs like TM136, resource ids like FT1,
// event kinds like DISK_REQ_SERVED); this module turns them into words anyone can read:
// "Flight 3", "Fuel truck 1", "The baggage cart picked up Flight 3's bags at belt spot 38".
// Every function only renames what the engine reported; nothing is invented.

// ---------------------------------------------------------------- names
export const fname = (spidOrFlight) => {
  const spid = typeof spidOrFlight === "object" && spidOrFlight ? spidOrFlight.spid : spidOrFlight;
  return spid === 0 ? "Reference" : `Flight ${spid}`;
};

export function resName(id) {
  const s = String(id);
  let m;
  if ((m = s.match(/^G(\d+)$/))) return `Gate ${m[1]}`;
  if ((m = s.match(/^FT(\d+)$/))) return `Fuel truck ${m[1]}`;
  if ((m = s.match(/^TG(\d+)$/))) return `Tug ${m[1]}`;
  if (s === "CART") return "Baggage cart";
  return s;
}

export const CLASS_NAME = { GATE: "gate", FUEL_TRUCK: "fuel truck", TUG: "tug" };
export const className = (c) => CLASS_NAME[c] || String(c).toLowerCase().replace("_", " ");

export const OP_LABEL = { TURNAROUND: "Arrive & depart", ARRIVAL: "Arrival only", DEPARTURE: "Departure only", CUSTOM: "CPU-only job", SCRIPTED: "Deadlock demo" };
export const opLabel = (op) => OP_LABEL[op] || op;

export const SERVICE_LABEL = { REFUEL: "Refuelling worker", BAGGAGE: "Baggage worker" };
export const serviceLabel = (s) => SERVICE_LABEL[s] || s;

export const ALGO_LABEL = { FCFS: "first come, first served (FCFS)", SSTF: "nearest first (SSTF)", SCAN: "elevator sweep (SCAN)", RR: "Round Robin", PRIORITY: "Priority" };
export const algoLabel = (a) => ALGO_LABEL[a] || a;

export const PAGE_NAME = ["flight plan", "allocation record", "service log", "baggage list"];

export const TASK_STATE_LABEL = { NEW: "starting", WAITING_GRANT: "waiting for a truck", WORKING: "working", WAITING_BAGS: "waiting for the cart", FINISHING: "finishing", DONE: "done" };

export function scenarioLabel(s) {
  if (!s) return "—";
  if (s === "free-play") return "Open airport";
  if (s === "contention") return "Busy apron";
  let m;
  if ((m = s.match(/^deadlock (\w+)(?: (\w+))?/))) return `Deadlock demo · ${cap(m[1])}${m[2] ? " (" + cap(m[2]) + ")" : ""}`;
  if ((m = s.match(/^sched-ref (\w+)/))) return `CPU scheduling test · ${m[1] === "RR" ? "Round Robin" : cap(m[1])}`;
  if (/^emergency/.test(s)) return `Emergency landing${/off/.test(s) ? " (no preemption)" : ""}`;
  if ((m = s.match(/^mem-ref (\S+) frames=(\d+)/))) return `Memory test · ${m[2]} frames`;
  if ((m = s.match(/^disk-ref (\w+) (\w+)/))) return `Baggage cart test · ${m[1]}${m[1] === "SCAN" ? (m[2] === "UP" ? " ↑" : " ↓") : ""}`;
  return s;
}
const cap = (w) => w.charAt(0) + w.slice(1).toLowerCase();

export function scenarioNote(sim) {
  const s = sim.scenario || "";
  if (s === "free-play") return "Empty airport with 6 gates, 2 fuel trucks and 2 tugs. Create flights or load a scenario.";
  if (s === "contention") return "5 flights share 3 gates, 1 fuel truck and 1 tug, so they must take turns and wait.";
  if (/^deadlock/.test(s)) return "Flight 1 holds Gate 3 and wants the fuel truck. Flight 2 holds the fuel truck and wants the tug. Flight 3 holds the tug and wants Gate 3. Nobody can move.";
  if (/^sched-ref/.test(s)) return "4 CPU-only jobs arrive together. Compare how long each waits under FCFS, Priority and Round Robin.";
  if (/^emergency/.test(s)) return "Flight 1 is using the CPU when urgent Flight 2 (priority 0) arrives at tick 2.";
  if (/^mem-ref/.test(s)) return "Pages are requested one per tick. When memory is full, the oldest page is replaced (FIFO).";
  if (/^disk-ref/.test(s)) return "Bags wait at belt spots 5, 37, 12, 44, 21, 3. The cart starts at spot 20. Which order means the least driving?";
  return plainText(sim.note || "");
}

// ---------------------------------------------------------------- free text from the engine
// Renames any call signs and resource ids inside an engine sentence.
export function plainText(text, snap) {
  let t = String(text || "");
  if (snap) {
    const flights = snap.flights.slice().sort((a, b) => b.flight_no.length - a.flight_no.length);
    for (const f of flights) t = t.split(f.flight_no).join(fname(f.spid));
  }
  t = t.replace(/\bG(\d+)\b/g, "Gate $1").replace(/\bFT(\d+)\b/g, "Fuel truck $1").replace(/\bTG(\d+)\b/g, "Tug $1");
  t = t.replace(/\bSPID (\d+)/g, "Flight $1").replace(/\bFUEL_TRUCK\b/g, "fuel truck").replace(/\bGATE\b/g, "gate").replace(/\bTUG\b/g, "tug");
  t = t.replace(/\(refuel worker\)/g, "(refuelling worker)");
  return t;
}

// ---------------------------------------------------------------- events
const PHASE_SENTENCE = {
  APPROACHING: "is approaching the airport",
  LANDING: "is landing",
  TAXIING: "is taxiing to its gate",
  AT_GATE: "is at the gate",
  TURNAROUND: "is being serviced at the gate",
  PUSHBACK: "is pushing back from the gate",
  DEPARTED: "took off",
  ARRIVED: "has finished its arrival",
};

// One short, readable sentence for an engine event.
export function describe(e, snap) {
  const d = e.data || {};
  const F = d.spid > 0 ? fname(d.spid) : "";
  const worker = d.task ? `${F}'s refuelling worker` : F;
  switch (e.kind) {
    case "FLIGHT_CREATED": return `${F} created (${opLabel(d.op).toLowerCase()}, priority ${d.priority})`;
    case "FLIGHT_ADMITTED": return `${F} arrived and joined the queue for the CPU`;
    case "DISPATCHED": return `${F} got its turn on the CPU`;
    case "QUANTUM_EXPIRED": return `${F} used up its time slice and went back in the queue`;
    case "PREEMPTED": return `${F} was paused for a higher-priority flight`;
    case "PHASE_CHANGED": return `${F} ${PHASE_SENTENCE[d.phase] || "changed phase"}`;
    case "RES_REQUESTED": return `${worker} asked for a ${className(d.class)}`;
    case "RES_GRANTED": return `${resName(d.resource)} assigned to ${worker}${d.waited ? ` after waiting ${d.waited} ticks` : ""}`;
    case "RES_BLOCKED": return `${worker} is waiting: no ${className(d.class)} is free`;
    case "UNSAFE_DEFERRED": return `${worker} must wait: giving it a ${className(d.class)} now could lead to a deadlock`;
    case "RES_RELEASED": return `${F} gave back ${resName(d.resource)}`;
    case "FLIGHT_READY": return `${F} got what it was waiting for and is back in the queue`;
    case "SERVICES_STARTED": return `${F} started ${d.tasks?.length || ""} ground-service worker${d.tasks?.length === 1 ? "" : "s"} and waits for them`;
    case "THREAD_JOINED": return `${F}'s ${serviceLabel(d.service).toLowerCase()} finished its job`;
    case "SERVICES_COMPLETE": return `All ground services for ${F} are done`;
    case "PAGE_FAULT": {
      const what = d.spid === 0 ? `reference page ${d.vpn}` : `${F}'s ${PAGE_NAME[d.vpn] || "page " + d.vpn}`;
      const out = d.evicted >= 0 ? `, replacing ${Math.floor(d.evicted / 100) === 0 ? "reference page " + (d.evicted % 100) : fname(Math.floor(d.evicted / 100)) + "'s " + (PAGE_NAME[d.evicted % 100] || "page")}` : "";
      return `Memory: loaded ${what} into frame ${d.frame}${out}`;
    }
    case "DISK_REQ_ADDED": return plainText(e.msg.replace(/baggage requests/, "baggage pickups"), snap);
    case "DISK_REQ_SERVED": return `Baggage cart picked up ${F || "a"}${F ? "'s" : ""} bags at belt spot ${d.position}`;
    case "DISK_BATCH_SCHEDULED": return `Baggage cart route planned (${d.algo}): spots ${(d.order || []).join(" → ")}, ${d.movement} spots of driving`;
    case "DISK_BATCH_DONE": return `Baggage cart finished its round after driving ${d.moved} spots`;
    case "IPC_EXCHANGE": return `The helper process worked out the cart's route (sent and received over pipes)`;
    case "DEADLOCK_DETECTED": {
      const ids = snap?.deadlock?.last_detected?.length ? snap.deadlock.last_detected : [];
      return ids.length ? `Deadlock! ${ids.map(fname).join(", ")} are each waiting for one another` : plainText(e.msg, snap);
    }
    case "VICTIM_SELECTED": return `${F} was chosen to give up its resources and break the deadlock`;
    case "RECOVERED": return plainText(e.msg.replace(/^Recovery \((\w+)\): /, "Deadlock resolved: "), snap);
    case "POLICY_REFUSED": return `${F}'s request was refused: it broke the Gate → Fuel truck → Tug order`;
    case "FLIGHT_TERMINATED": return d.status === "DONE" ? `${F} finished (total ${d.tat} ticks, waited ${d.wt} in the queue)` : `${F} was stopped`;
    case "FLIGHT_ABORT": return `${F} was cancelled`;
    case "SCENARIO_LOADED": return `Scenario loaded: ${scenarioLabel(snap?.sim.scenario)}`;
    case "SIM_RESET": return "Simulation reset to an empty airport";
    case "SIM_IDLE": return "Paused: nothing can move right now";
    case "SCHED_CHANGED": return plainText(e.msg.replace("Scheduler set to", "CPU scheduling switched to"), snap);
    default: return plainText(e.msg, snap);
  }
}

// Category word shown instead of the raw event kind.
export const CATEGORY_LABEL = { cpu: "CPU", res: "Resources", svc: "Ground service", dead: "Deadlock", mem: "Memory", disk: "Baggage cart", err: "Error", other: "System" };
