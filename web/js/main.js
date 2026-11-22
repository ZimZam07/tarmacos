// main.js - bootstraps TarmacOS: engine connection, routing, intro, the lazily loaded 3D scene and the shell.
import { connect, renewSession } from "./api.js";
import { acceptSnapshot, setConnected, setEngine, store } from "./store.js";
import "./core/journal.js";
import "./core/history.js";
import { appBus, go, route, selection, settings } from "./core/state.js";
import { toast } from "./ui.js";
import { initChrome } from "./shell/chrome.js";
import { initTimeline } from "./shell/timeline.js";
import { initContext } from "./shell/context.js";
import { initDrawers } from "./shell/drawers.js";
import { initNotices } from "./shell/notices.js";
import { initPages } from "./pages/index.js";
import { initStory } from "./story.js";
import { initSound } from "./core/sound.js";

export const app = {
  scene: null,         // SceneHost once loaded (null without WebGL)
  sceneReady: null,    // Promise
  fallback: false,
};
window.__tarmac = app; // handy for debugging in the console

// ---------------------------------------------------------------- engine stream
let source = null;
let lastOnlinePid = null;
export function openStream() {
  if (source) source.close();
  source = connect({
    onSnapshot: acceptSnapshot,
    onEngine: (status) => {
      if (status.engine_pid !== store.engine.engine_pid) store.snap = null;
      if (status.online) {
        if (lastOnlinePid !== null && status.engine_pid !== lastOnlinePid)
          toast("A new engine process started, so the simulation is back at the empty apron.", true);
        lastOnlinePid = status.engine_pid;
      }
      if (status.error === "E_SESSION_EXPIRED") source.close();
      setEngine(status);
    },
    onConnection: setConnected,
  });
}
appBus.on((type) => {
  if (type === "new-session") {
    lastOnlinePid = null;
    renewSession();
    openStream();
  }
});

// ---------------------------------------------------------------- 3D scene (lazy)
async function loadScene() {
  const veil = document.getElementById("veil");
  try {
    const mod = await import("./scene/host.js");
    if (!mod.webglAvailable()) throw new Error("WebGL is not available");
    app.scene = new mod.SceneHost(document.getElementById("scene-host"), document.getElementById("labels"), document.getElementById("links"));
    if (!document.getElementById("intro").classList.contains("leave")) app.scene.setIntro(true);
    else app.scene.preset("overview", 0.01);
  } catch (err) {
    console.warn("[TarmacOS] 3D view unavailable, using the 2D map:", err);
    app.fallback = true;
    const fb = await import("./scene/fallback2d.js");
    fb.mountFallback(document.getElementById("scene-host"), String(err.message || err));
  } finally {
    veil.classList.add("leave");
  }
  appBus.emit("scene-ready", app.scene);
  return app.scene;
}

// ---------------------------------------------------------------- intro
function initIntro() {
  const intro = document.getElementById("intro");
  const sync = () => document.body.classList.toggle("intro-on", !intro.classList.contains("leave"));
  new MutationObserver(sync).observe(intro, { attributes: true, attributeFilter: ["class"] });
  const leave = (path) => {
    intro.classList.add("leave");
    settings.update({ introSeen: true });
    if (app.scene) app.scene.setIntro(false);
    go(path);
  };
  document.getElementById("intro-start").onclick = () => leave("airport");
  document.getElementById("intro-explore").onclick = () => leave("explorer/process");
  document.getElementById("intro-story").onclick = () => leave("story");
  document.getElementById("brand").onclick = () => {
    intro.classList.remove("leave");
    if (app.scene) app.scene.setIntro(true);
  };
  // Deep links skip the opening screen.
  if (location.hash && location.hash !== "#/" && location.hash !== "#/airport") intro.classList.add("leave");
  sync();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !intro.classList.contains("leave")) leave("airport");
  });
}

// ---------------------------------------------------------------- route -> which surface is visible
function applyRoute(r) {
  const page = document.getElementById("page-host");
  const sceneVisible = r.area === "airport" || r.area === "story";
  page.classList.toggle("hidden-page", sceneVisible);
  document.getElementById("stage").dataset.area = r.area;
  if (app.scene) app.scene.setActive(sceneVisible);
}

// ---------------------------------------------------------------- start
initIntro();
initChrome(app);
initTimeline(app);
initContext(app);
initDrawers(app);
initNotices(app);
initPages(app);
initStory(app);
initSound();
route.on(applyRoute);
applyRoute(route.current);
openStream();
app.sceneReady = loadScene().then((s) => { applyRoute(route.current); return s; });

// keyboard: space run/pause, s step, 1-5 camera views, esc clears selection
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!document.getElementById("intro").classList.contains("leave")) return;
  if (e.key === "Escape") selection.clear();
  if (e.key === " ") { e.preventDefault(); appBus.emit("toggle-run"); }
  if (e.key === "s" || e.key === "S") appBus.emit("step");
  const views = { 1: "overview", 2: "runway", 3: "gates", 4: "ground", 5: "tower" };
  if (views[e.key] && app.scene && (route.current.area === "airport" || route.current.area === "story")) app.scene.preset(views[e.key]);
});
