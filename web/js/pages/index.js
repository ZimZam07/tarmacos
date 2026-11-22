// pages/index.js - the full-page surfaces: OS Explorer (six concept modules + Linux & IPC) and Analytics.
// Modules are loaded on demand and only re-render while visible.
import { store, subscribe } from "../store.js";
import { onEvents } from "../core/journal.js";
import { go, route } from "../core/state.js";
import { esc, run } from "../ui.js";

export const MODULES = [
  { id: "process", n: "01", label: "Processes", load: () => import("./process.js") },
  { id: "scheduler", n: "02", label: "CPU Scheduling", load: () => import("./scheduler.js") },
  { id: "threads", n: "03", label: "Threads & Sync", load: () => import("./threads.js") },
  { id: "deadlock", n: "04", label: "Deadlocks", load: () => import("./deadlock.js") },
  { id: "memory", n: "05", label: "Memory", load: () => import("./memory.js") },
  { id: "disk", n: "06", label: "Disk Scheduling", load: () => import("./disk.js") },
  { id: "linux", n: "+", label: "Linux & IPC", load: () => import("./linux.js") },
];

export function initPages(app) {
  const host = document.getElementById("page-host");
  let current = null; // { key, mod, root }
  let token = 0;
  const ctx = { run, go, app, get snap() { return store.snap; } };

  async function show(r) {
    if (r.area !== "explorer" && r.area !== "analytics") {
      if (current?.mod.unmount) current.mod.unmount();
      current = null;
      return;
    }
    const key = r.area === "analytics" ? "analytics" : MODULES.some((m) => m.id === r.sub) ? r.sub : "process";
    if (r.area === "explorer" && r.sub !== key) return go("explorer/" + key);
    if (current?.key === key) return;
    if (current?.mod.unmount) current.mod.unmount();
    const my = ++token;
    const mod = (await (key === "analytics" ? import("./analytics.js") : MODULES.find((m) => m.id === key).load())).default;
    if (my !== token) return;
    host.innerHTML = "";
    host.scrollTop = 0;
    if (r.area === "explorer") {
      const tabs = document.createElement("nav");
      tabs.className = "xp-tabs";
      tabs.setAttribute("aria-label", "OS Explorer modules");
      tabs.innerHTML = MODULES.map((m) => `<a href="#/explorer/${m.id}" class="${m.id === key ? "on" : ""}"><span class="n">${m.n}</span>${esc(m.label)}</a>`).join("");
      host.appendChild(tabs);
    }
    const root = document.createElement("div");
    root.className = "page";
    host.appendChild(root);
    mod.mount(root, ctx);
    current = { key, mod, root };
    render();
  }

  let raf = 0;
  function render() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (current && store.snap) current.mod.update(store.snap, ctx); });
  }
  subscribe(render);
  onEvents((fresh, info) => { if (current?.mod.onEvents) current.mod.onEvents(fresh, info); });
  route.on(show);
  show(route.current);
}
