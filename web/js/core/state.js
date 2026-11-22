// state.js - UI-only state: selection, settings and the route. Never engine state.

function bus() {
  const fns = new Set();
  return { on: (fn) => (fns.add(fn), () => fns.delete(fn)), emit: (...a) => fns.forEach((fn) => fn(...a)) };
}

// ---------------------------------------------------------------- selection
const selBus = bus();
export const selection = {
  type: null, // "flight" | "gate" | "vehicle"
  id: null,   // spid (number) | "G3" | "FT1" | "TG2" | "CART"
  set(type, id) {
    if (this.type === type && this.id === id) return;
    this.type = type;
    this.id = id;
    selBus.emit(this);
  },
  clear() { this.set(null, null); },
  is(type, id) { return this.type === type && this.id === id; },
  on: selBus.on,
};

// ---------------------------------------------------------------- settings (per viewer, localStorage)
const DEFAULTS = { quality: "balanced", motion: "auto", labels: "all", links: true, fps: false, sound: false, introSeen: false };
const setBus = bus();
function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("tarmac.settings") || "{}") }; } catch { return { ...DEFAULTS }; }
}
export const settings = {
  ...load(),
  update(patch) {
    Object.assign(this, patch);
    try {
      const out = {};
      for (const k of Object.keys(DEFAULTS)) out[k] = this[k];
      localStorage.setItem("tarmac.settings", JSON.stringify(out));
    } catch { /* storage blocked: settings last for this page only */ }
    applyMotion();
    setBus.emit(this, patch);
  },
  on: setBus.on,
};

export const reducedMotion = () =>
  settings.motion === "reduced" || (settings.motion === "auto" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function applyMotion() {
  document.documentElement.dataset.motion = reducedMotion() ? "reduced" : "full";
}
applyMotion();

// ---------------------------------------------------------------- route
const routeBus = bus();
export function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const area = ["airport", "explorer", "analytics", "story"].includes(parts[0]) ? parts[0] : "airport";
  return { area, sub: parts[1] || "", hash: "#/" + [area, parts[1]].filter(Boolean).join("/") };
}
export const route = { current: parseRoute(), on: routeBus.on };
export function go(path) {
  const target = path.startsWith("#") ? path : "#/" + path.replace(/^\//, "");
  if (location.hash === target) {
    route.current = parseRoute(target);
    routeBus.emit(route.current);
  } else location.hash = target;
}
window.addEventListener("hashchange", () => {
  route.current = parseRoute();
  routeBus.emit(route.current);
});

// A tiny app-wide bus for cross-module requests (camera focus, story hooks...).
export const appBus = bus();
