// model.js - pure, read-only derivations from one engine snapshot.
// Nothing here invents state: every function only renames or groups what the engine reported.

export const PHASES_AIR = new Set(["CREATED", "APPROACHING"]);

export function flightMap(snap) {
  const m = new Map();
  for (const f of snap.flights) m.set(f.spid, f);
  return m;
}

export const heldGate = (f) => f.held.find((id) => /^G\d+$/.test(id)) || null;
export const heldTug = (f) => f.held.find((id) => /^TG\d+$/.test(id)) || null;
export const heldTruck = (f) => f.held.find((id) => /^FT\d+$/.test(id)) || null;

// Ground-service pthreads of one flight (REFUEL / BAGGAGE), straight from snapshot.threads.
export const servicesOf = (snap, spid) => snap.threads.filter((t) => t.kind === "service" && t.spid === spid);
export const threadOf = (snap, spid) => snap.threads.find((t) => t.kind === "flight" && t.spid === spid) || null;

// Does this flight start in the air (arriving aircraft) or on the ground?
export const arrivesByAir = (f) => f.op === "TURNAROUND" || f.op === "ARRIVAL";

/**
 * Where the aircraft must be, according to the engine. The scene animates towards this station.
 *   hidden   - not admitted yet (NEW, arrival tick in the future)
 *   hold     - airborne, no gate yet (inbound / holding stack)
 *   final    - APPROACHING with a gate granted: final approach to the runway
 *   roll     - LANDING: runway roll-out
 *   taxi_in  - TAXIING to the granted gate
 *   stand    - parked at its gate
 *   push     - PUSHBACK with a tug attached
 *   remote   - on the ground without a gate (departures waiting for a gate, scripted / CPU-only flights)
 *   depart   - terminated after DEPARTED: taxi out and take off
 *   arrived  - terminated after ARRIVED: leaves the stand for the hangar
 *   vanish   - terminated in any other way (CPU-only flight finished, aborted)
 */
export function flightStation(f) {
  const gate = heldGate(f);
  if (f.state === "NEW") return { key: "hidden", gate: null };
  if (f.state === "TERMINATED") {
    if (f.end_status === "DONE" && f.phase === "DEPARTED") return { key: "depart", gate: null };
    if (f.end_status === "DONE" && f.phase === "ARRIVED") return { key: "arrived", gate: null };
    return { key: "vanish", gate: null };
  }
  if (arrivesByAir(f) && PHASES_AIR.has(f.phase)) return { key: gate ? "final" : "hold", gate };
  if (f.phase === "LANDING") return { key: "roll", gate };
  if (f.phase === "TAXIING") return { key: gate ? "taxi_in" : "remote", gate };
  if (f.phase === "PUSHBACK") return { key: heldTug(f) ? "push" : gate ? "stand" : "remote", gate, tug: heldTug(f) };
  if (gate) return { key: "stand", gate };
  return { key: "remote", gate: null };
}

/** Gate status shown on the stand: derived from ownership + the owner's phase + its service threads. */
export function gateStatus(snap, gate, flights = flightMap(snap)) {
  if (!gate.enabled) return { key: "closed", label: "Closed", color: "#4a5d73" };
  if (gate.owner < 0) return { key: "free", label: "Available", color: "#2fd69a" };
  const f = flights.get(gate.owner);
  if (!f) return { key: "occupied", label: "Occupied", color: "#438bff" };
  const st = flightStation(f).key;
  if (st === "hold" || st === "final" || st === "roll" || st === "taxi_in" || st === "remote")
    return { key: "allocated", label: "Allocated · inbound", color: "#20c8ff" };
  if (f.phase === "PUSHBACK") return { key: "releasing", label: "Pushback", color: "#a68bff" };
  if (servicesOf(snap, f.spid).length) return { key: "service", label: "Under service", color: "#ffb547" };
  return { key: "occupied", label: "Occupied", color: "#438bff" };
}

/** One-line plain-English status of a flight, from its engine state. */
export function flightStatusLine(snap, f) {
  if (f.state === "NEW") return `Scheduled to arrive at t=${f.arrival}`;
  if (f.state === "TERMINATED") return f.end_status === "ABORTED" ? "Aborted" : f.phase === "DEPARTED" ? "Departed" : f.phase === "ARRIVED" ? "Arrived · trip complete" : "Completed";
  const want = f.requested.length ? f.requested.map((c) => c.replace("_", " ").toLowerCase()).join(", ") : "";
  if (f.state === "BLOCKED") {
    if (/services/.test(f.block_reason)) return "Blocked · waiting for its ground-service threads";
    if (want) return `Blocked · waiting for a ${want}`;
    return `Blocked · ${f.block_reason}`;
  }
  const where = { CREATED: "Inbound", APPROACHING: "On approach", LANDING: "Landing", TAXIING: "Taxiing", AT_GATE: "At gate", TURNAROUND: "Turnaround", PUSHBACK: "Pushback", DEPARTED: "Departed", ARRIVED: "Arrived" }[f.phase] || f.phase;
  return `${where} · ${f.state === "RUNNING" ? "on the CPU" : "in the ready queue"}`;
}

export const PHASE_LABEL = { CREATED: "Inbound", APPROACHING: "Approach", LANDING: "Landing", TAXIING: "Taxi", AT_GATE: "At gate", TURNAROUND: "Turnaround", PUSHBACK: "Pushback", DEPARTED: "Departed", ARRIVED: "Arrived" };

export function utilization(snap) {
  const cls = (c) => snap.resources.filter((r) => r.class === c && r.enabled);
  const u = (list) => ({ total: list.length, used: list.filter((r) => r.owner >= 0).length });
  return { GATE: u(cls("GATE")), FUEL_TRUCK: u(cls("FUEL_TRUCK")), TUG: u(cls("TUG")) };
}

export function stateCounts(snap) {
  const c = { NEW: 0, READY: 0, RUNNING: 0, BLOCKED: 0, TERMINATED: 0 };
  for (const f of snap.flights) c[f.state]++;
  return c;
}

export const isRunning = (snap) => !!snap && (snap.sim.running || snap.sim.fast);
