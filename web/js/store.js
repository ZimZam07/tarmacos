// store.js - holds the latest engine snapshot. Every view renders from here,
// so the same flight or resource always looks the same on every tab.

const listeners = new Set();

export const store = {
  snap: null,            // latest snapshot from the engine
  engine: { online: false, engine_pid: null, child_pid: null },
  connected: false,      // SSE connection to the bridge
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(store);
}

// Ignore snapshots that are older than the one we already have (same engine
// process, older epoch or version). A new engine process always wins.
export function acceptSnapshot(snap) {
  const cur = store.snap;
  const samePid = cur && cur.ipc.engine_pid === snap.ipc.engine_pid;
  if (samePid && (snap.epoch < cur.epoch || (snap.epoch === cur.epoch && snap.version <= cur.version))) return;
  store.snap = snap;
  emit();
}

export function setEngine(status) {
  store.engine = status;
  emit();
}

export function setConnected(flag) {
  store.connected = flag;
  emit();
}

export const isLive = () => store.connected && store.engine.online && !!store.snap;
