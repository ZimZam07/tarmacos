// traffic.js - "Open airport" traffic generator. It only sends real `flight create` commands to the
// engine (the same command the Flights panel uses); the engine then schedules and runs those flights.
import { store, subscribe } from "../store.js";
import { command } from "../api.js";

const AIRLINES = ["AI", "6E", "UK", "SG", "IX", "QP", "EK", "LH"];
const OPS = [["TURNAROUND", 0.6], ["ARRIVAL", 0.25], ["DEPARTURE", 0.15]];
const EVERY = 7;      // ticks between new flights
const MAX_ACTIVE = 6;

export const traffic = {
  on: false,
  epoch: null,
  lastTick: -1,
  seq: 100,
  start() {
    this.on = true;
    this.epoch = null;
    this.lastTick = -EVERY;
  },
  stop() { this.on = false; },
};

function pickOp() {
  let r = Math.random();
  for (const [op, w] of OPS) { if ((r -= w) <= 0) return op; }
  return "TURNAROUND";
}

let busy = false;
subscribe(async (s) => {
  const snap = s.snap;
  if (!traffic.on || !snap || busy) return;
  if (traffic.epoch === null) traffic.epoch = snap.epoch;
  if (snap.epoch !== traffic.epoch) { traffic.stop(); return; } // someone reset or loaded a scenario
  const active = snap.flights.filter((f) => f.state !== "TERMINATED").length;
  // The engine auto-pauses when nothing can progress (SIM_IDLE). On an empty apron that is not a
  // pause the user asked for, so feed it a flight and resume. A user's pause with flights active is kept.
  const idleEmpty = !snap.sim.running && !snap.sim.fast && snap.sim.quiet && active === 0;
  if (!idleEmpty && (snap.tick - traffic.lastTick < EVERY || active >= MAX_ACTIVE)) return;
  traffic.lastTick = snap.tick;
  busy = true;
  const taken = new Set(snap.flights.filter((f) => f.state !== "TERMINATED").map((f) => f.flight_no));
  let no;
  do { no = AIRLINES[Math.floor(Math.random() * AIRLINES.length)] + (++traffic.seq); } while (taken.has(no));
  await command(`flight create ${no} ${pickOp()} ${1 + Math.floor(Math.random() * 4)}`);
  if (idleEmpty) await command("sim run");
  busy = false;
  void store;
});
