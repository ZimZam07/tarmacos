// history.js - records engine state per observed tick, for charts over time (thread lanes, utilisation).
// The bridge streams at most 10 snapshots/s, so when the engine runs faster some ticks are not observed:
// gaps are filled with the last observed value and every chart that uses this says "as observed".
import { subscribe } from "../store.js";

const KEEP = 240;
export const history = {
  key: null,
  ticks: [],          // [{ tick, gates, trucks, tugs, ready, blocked, running, faults, moved }]
  threads: new Map(), // tid/name key -> { name, kind, spid, samples: Map(tick -> category), last, alive }
};

export function threadCategory(state) {
  if (/executing a step|running a tick/.test(state)) return "run";
  if (/sem_wait/.test(state)) return "sem";
  if (/waiting for a resource|fuel truck|waiting for the cart|WAITING/.test(state)) return "block";
  if (/pthread_join|its services/.test(state)) return "join";
  if (/waiting for a CPU turn|waiting for a turn/.test(state)) return "ready";
  if (/exiting/.test(state)) return "exit";
  return "idle";
}

subscribe((s) => {
  const snap = s.snap;
  if (!snap) return;
  const key = snap.ipc.engine_pid + ":" + snap.epoch;
  if (key !== history.key) {
    history.key = key;
    history.ticks = [];
    history.threads = new Map();
  }
  const last = history.ticks[history.ticks.length - 1];
  const used = (c) => snap.resources.filter((r) => r.class === c && r.enabled && r.owner >= 0).length;
  const total = (c) => snap.resources.filter((r) => r.class === c && r.enabled).length;
  const row = {
    tick: snap.tick,
    gates: used("GATE"), gatesT: total("GATE"), trucks: used("FUEL_TRUCK"), trucksT: total("FUEL_TRUCK"), tugs: used("TUG"), tugsT: total("TUG"),
    ready: snap.cpu.ready.length, blocked: snap.flights.filter((f) => f.state === "BLOCKED").length,
    active: snap.flights.filter((f) => f.state !== "TERMINATED" && f.state !== "NEW").length,
    faults: snap.memory.faults, moved: snap.disk.total_movement,
  };
  if (last && last.tick === snap.tick) history.ticks[history.ticks.length - 1] = row;
  else history.ticks.push(row);
  if (history.ticks.length > KEEP) history.ticks.shift();

  const seen = new Set();
  for (const t of snap.threads) {
    const k = t.tid ? "t" + t.tid : t.name;
    seen.add(k);
    let rec = history.threads.get(k);
    if (!rec) { rec = { name: t.name, kind: t.kind, spid: t.spid, samples: new Map(), first: snap.tick }; history.threads.set(k, rec); }
    rec.state = t.state;
    rec.tid = t.tid;
    rec.alive = true;
    rec.samples.set(snap.tick, threadCategory(t.state));
    if (rec.samples.size > KEEP) rec.samples.delete(rec.samples.keys().next().value);
  }
  for (const [k, rec] of history.threads) {
    if (!seen.has(k) && rec.alive) { rec.alive = false; rec.endedAt = snap.tick; rec.samples.set(snap.tick, "exit"); }
    if (!rec.alive && snap.tick - rec.endedAt > 40) history.threads.delete(k);
  }
});
