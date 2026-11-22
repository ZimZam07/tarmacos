// journal.js - the event journal: every engine event seen so far in this epoch, exactly once.
//
// The bridge streams only the newest snapshot (at most 10 per second), and each snapshot carries the
// last 60 engine events with their structured `data`. The journal merges those windows by (epoch, seq),
// so consumers see each real engine event once and in order, and it reports when a window was missed
// (only possible when the engine runs far faster than the stream, e.g. "run to end").
import { store, subscribe } from "../store.js";

const MAX = 3000;
const listeners = new Set();

export const journal = {
  epoch: null,
  pid: null,
  lastSeq: 0,
  events: [],       // [{seq, tick, kind, msg, data}]
  byFlight: new Map(), // spid -> events
  gaps: 0,          // number of times events were missed
};

export function onEvents(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function resetJournal(epoch, pid) {
  journal.epoch = epoch;
  journal.pid = pid;
  journal.lastSeq = 0;
  journal.events = [];
  journal.byFlight = new Map();
  journal.gaps = 0;
}

function ingest(snap) {
  const pid = snap.ipc.engine_pid;
  let reset = false;
  if (snap.epoch !== journal.epoch || pid !== journal.pid) {
    resetJournal(snap.epoch, pid);
    reset = true;
  }
  const fresh = [];
  const list = snap.events || [];
  if (list.length && journal.lastSeq && list[0].seq > journal.lastSeq + 1) journal.gaps++;
  for (const e of list) {
    if (e.seq <= journal.lastSeq) continue;
    const ev = { seq: e.seq, tick: e.tick, kind: e.kind, msg: e.msg, data: e.data || {} };
    journal.events.push(ev);
    journal.lastSeq = e.seq;
    const spid = ev.data.spid;
    if (typeof spid === "number" && spid > 0) {
      if (!journal.byFlight.has(spid)) journal.byFlight.set(spid, []);
      journal.byFlight.get(spid).push(ev);
    }
    fresh.push(ev);
  }
  if (journal.events.length > MAX) journal.events.splice(0, journal.events.length - MAX);
  if (fresh.length || reset) for (const fn of listeners) fn(fresh, { reset, snap });
}

let lastSnap = null;
subscribe((s) => {
  if (s.snap && s.snap !== lastSnap) {
    lastSnap = s.snap;
    ingest(s.snap);
  }
});

// Category used for colour coding and filtering (same mapping in the timeline and the log).
export function category(kind) {
  if (/DEADLOCK|VICTIM|RECOVER|POLICY|UNSAFE/.test(kind)) return "dead";
  if (/ERROR|INVARIANT/.test(kind)) return "err";
  if (/SERVICES|THREAD/.test(kind)) return "svc";
  if (/^RES_|FLIGHT_READY/.test(kind)) return "res";
  if (/DISPATCH|QUANTUM|PREEMPT|SCHED|ADMITTED|FLIGHT_CREATED|FLIGHT_TERMINATED|FLIGHT_ABORT/.test(kind)) return "cpu";
  if (/PAGE|MEM/.test(kind)) return "mem";
  if (/DISK|IPC/.test(kind)) return "disk";
  return "other";
}

export const flightEvents = (spid) => journal.byFlight.get(spid) || [];
export const isCurrent = () => !!store.snap;
