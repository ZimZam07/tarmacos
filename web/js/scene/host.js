// host.js - owns the WebGL renderer, the airport world and every actor, and keeps them in step with
// the engine snapshot. Loaded lazily by main.js; the rest of the UI never touches Three.js directly.
import * as THREE from "three";
import { store, subscribe } from "../store.js";
import { flightMap, flightStation, gateStatus, PHASE_LABEL, servicesOf } from "../core/model.js";
import { appBus, selection, settings, reducedMotion } from "../core/state.js";
import { esc, flightColor, STATE_COLOR, stateKey } from "../ui.js";
import { buildWorld } from "./world.js";
import { AircraftActor, CartActor, LoaderActor, VehicleActor } from "./actors.js";
import { CameraRig } from "./camera.js";
import { Overlay } from "./overlay.js";
import * as L from "./layout.js";
import { makeBag } from "./models.js";
import { fname, resName } from "../core/plain.js";

const QUALITY = {
  performance: { dpr: 1, aa: false, shadows: false, cap: 30 },
  balanced: { dpr: 1.5, aa: true, shadows: true, cap: 60 },
  high: { dpr: 2, aa: true, shadows: true, cap: 0 },
};

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2")) || !!c.getContext("webgl");
  } catch { return false; }
}

export class SceneHost {
  constructor(host, labelsEl, linksEl) {
    this.hostEl = host;
    this.quality = settings.quality in QUALITY ? settings.quality : "balanced";
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x06101d, 0.00082);
    this.camera = new THREE.PerspectiveCamera(38, 1, 2, 9000);
    this.createRenderer();
    this.world = buildWorld(this.renderer, this.quality);
    this.scene.add(this.world.group);
    this.rig = new CameraRig(this.camera, this.renderer.domElement);
    this.rig.onUserMove = () => { this.rig.follow = null; appBus.emit("follow", null); };
    this.overlay = new Overlay(labelsEl, linksEl, (type, id) => this.pick(type, id));

    this.aircraft = new Map();   // spid -> AircraftActor
    this.vehicles = new Map();   // FT1/TG1 -> VehicleActor
    this.loaders = new Map();    // task id -> LoaderActor
    this.cart = new CartActor();
    this.scene.add(this.cart.root);
    this.bags = new Map();       // key -> mesh
    this.holdLevels = [];
    this.remoteSlots = [];
    this.epochKey = null;
    this.restoreSet = new Set();
    this.lastSnap = null;
    this.active = true;
    this.dprScale = 1;
    this.frameTimes = [];
    this.fpsEl = null;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    this.ctx = {
      takeHold: (a) => { if (a.plan.level >= 0) return a.plan.level; let i = this.holdLevels.indexOf(null); if (i < 0) { i = this.holdLevels.length; this.holdLevels.push(null); } this.holdLevels[i] = a; a.plan.level = i; return i; },
      freeHold: (a) => { const i = this.holdLevels.indexOf(a); if (i >= 0) this.holdLevels[i] = null; a.plan.level = -1; },
      takeRemote: (a) => { if (a.plan.station === "remote" && a.plan.slot >= 0) return a.plan.slot; let i = this.remoteSlots.indexOf(null); if (i < 0) { i = this.remoteSlots.length; this.remoteSlots.push(null); } this.remoteSlots[i] = a; return i; },
      freeRemote: (a) => { const i = this.remoteSlots.indexOf(a); if (i >= 0) this.remoteSlots[i] = null; },
      aircraft: (spid) => this.aircraft.get(spid) || null,
      tugAttached: (spid) => [...this.vehicles.values()].some((v) => v.kind === "tug" && v.workingFor === spid && v.state === "attached"),
      needsTug: (spid) => !!this.aircraft.get(spid)?.pushPending,
      tick: () => (this.lastSnap ? this.lastSnap.tick : 0),
    };

    this.bindPicking();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.unsub = subscribe((s) => { if (s.snap && s.snap !== this.lastSnap) this.sync(s.snap); });
    this.unsubSel = selection.on(() => this.onSelection());
    this.unsubSet = settings.on((_, patch) => { if ("quality" in patch) this.setQuality(settings.quality); });
    document.addEventListener("visibilitychange", () => this.kick());
    this.clock = performance.now();
    this.loop = this.loop.bind(this);
    if (store.snap) this.sync(store.snap);
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- renderer + quality
  createRenderer() {
    const q = QUALITY[this.quality];
    const r = new THREE.WebGLRenderer({ antialias: q.aa, powerPreference: "high-performance", alpha: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.type = this.quality === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    r.setClearColor(0x050d18);
    r.domElement.setAttribute("aria-label", "3D airport view: drag to orbit, right-drag to pan, scroll to zoom, click an aircraft, gate or vehicle to inspect it");
    r.domElement.tabIndex = 0;
    if (this.renderer) {
      this.hostEl.replaceChild(r.domElement, this.renderer.domElement);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    } else {
      this.hostEl.prepend(r.domElement);
    }
    this.renderer = r;
  }

  setQuality(q) {
    if (!(q in QUALITY) || q === this.quality) return;
    const needNew = QUALITY[q].aa !== QUALITY[this.quality].aa;
    this.quality = q;
    this.dprScale = 1;
    if (needNew) {
      const dom = this.renderer.domElement;
      this.createRenderer();
      this.rig.dom = this.renderer.domElement;
      this.rig.bind();
      this.bindPicking();
      dom.remove?.();
      // textures and materials re-upload automatically on the new context
    }
    this.renderer.shadowMap.enabled = QUALITY[q].shadows;
    this.renderer.shadowMap.type = q === "high" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.world.configureShadows(q);
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    this.resize();
  }

  resize() {
    const w = this.hostEl.clientWidth || 1, h = this.hostEl.clientHeight || 1;
    const q = QUALITY[this.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr) * this.dprScale;
    this.renderer.setPixelRatio(Math.max(0.75, dpr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < 700 ? 52 : 38;
    this.camera.updateProjectionMatrix();
    this.overlay.resize(w, h);
  }

  // ---------------------------------------------------------------- engine -> actors
  sync(snap) {
    this.lastSnap = snap;
    const key = snap.ipc.engine_pid + ":" + snap.epoch;
    if (key !== this.epochKey) {
      this.clearActors();
      this.epochKey = key;
      // Flights already past NEW when we first see this epoch mid-run are placed, not flown in.
      this.restoreSet = new Set(snap.tick > 0 ? snap.flights.filter((f) => f.state !== "NEW").map((f) => f.spid) : []);
      this.cart.setHead(snap.disk.head, true);
    }
    const fm = flightMap(snap);
    for (const f of snap.flights) {
      let a = this.aircraft.get(f.spid);
      const st = flightStation(f);
      if (!a) {
        if (st.key === "hidden") continue;
        // A flight first seen already finished lived entirely between two snapshots: nothing to draw.
        if (f.state === "TERMINATED") continue;
        a = new AircraftActor(f, flightColor(f.spid), this.ctx, this.restoreSet.has(f.spid));
        this.aircraft.set(f.spid, a);
        this.scene.add(a.root);
      }
      a.flight = f;
      a.setStation(st, f);
    }
    // gates
    for (const r of snap.resources) {
      if (r.class === "GATE") {
        const gs = gateStatus(snap, r, fm);
        this.world.setGateStatus(r.id, gs.key, gs.color, gs.key === "allocated" || gs.key === "releasing");
        continue;
      }
      let v = this.vehicles.get(r.id);
      if (!v) {
        const idx = snap.resources.filter((x) => x.class === r.class).indexOf(r);
        v = new VehicleActor(r.id, r.class === "TUG" ? "tug" : "truck", idx);
        this.vehicles.set(r.id, v);
        this.scene.add(v.root);
      }
      v.enabled = r.enabled;
      v.resource = r;
      v.setOwner(r.owner, this.aircraft.get(r.owner), this.ctx);
    }
    // baggage-service threads -> loaders
    const live = new Set();
    for (const t of snap.threads) {
      if (t.kind !== "service" || t.service !== "BAGGAGE") continue;
      live.add(t.task);
      let ld = this.loaders.get(t.task);
      const ac = this.aircraft.get(t.spid);
      if (!ld && ac) {
        ld = new LoaderActor(t.task, t.spid);
        this.loaders.set(t.task, ld);
        this.scene.add(ld.root);
        ld.goTo(ac);
      }
      if (ld) ld.thread = t;
    }
    for (const [task, ld] of this.loaders) if (!live.has(task)) ld.leave();
    // disk head + pending baggage requests on the belt
    this.cart.setHead(snap.disk.head, false);
    const reqs = [...snap.disk.batch_remaining, ...snap.disk.waiting];
    const want = new Map();
    const count = {};
    for (const r of reqs) {
      const k0 = r.position + ":" + r.spid;
      count[k0] = (count[k0] || 0) + 1;
      want.set(k0 + ":" + count[k0], r);
    }
    for (const [k, r] of want) {
      if (this.bags.has(k)) continue;
      const m = makeBag(flightColor(r.spid));
      const n = Number(k.split(":")[2]) - 1;
      m.position.set(L.beltX(r.position), 0, L.BELT.z + 4 + n * 2);
      m.scale.setScalar(0.01);
      m.userData.grow = 1;
      m.userData.pick = { type: "vehicle", id: "CART" };
      this.scene.add(m);
      this.bags.set(k, m);
    }
    for (const [k, m] of this.bags) if (!want.has(k)) m.userData.grow = 0;
    this.seenAlive = this.seenAlive || new Set();
    for (const f of snap.flights) if (f.state !== "NEW" && f.state !== "TERMINATED") this.seenAlive.add(f.spid);
    this.kick();
  }

  clearActors() {
    for (const a of this.aircraft.values()) { this.scene.remove(a.root); a.dispose(); }
    this.aircraft.clear();
    for (const v of this.vehicles.values()) this.scene.remove(v.root);
    this.vehicles.clear();
    for (const l of this.loaders.values()) this.scene.remove(l.root);
    this.loaders.clear();
    for (const b of this.bags.values()) this.scene.remove(b);
    this.bags.clear();
    this.holdLevels = [];
    this.remoteSlots = [];
    this.seenAlive = new Set();
    this.overlay.clear();
  }

  // ---------------------------------------------------------------- picking
  bindPicking() {
    const el = this.renderer.domElement;
    let down = null, lastHover = 0;
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return;
      const hit = this.raycast(e);
      if (hit) this.pick(hit.type, hit.id);
      else selection.clear();
    });
    el.addEventListener("pointermove", (e) => {
      const now = performance.now();
      if (e.buttons || now - lastHover < 90) return;
      lastHover = now;
      this.hostEl.classList.toggle("pointer", !!this.raycast(e));
    });
  }

  raycast(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const targets = [];
    for (const a of this.aircraft.values()) if (a.root.visible) targets.push(a.root);
    for (const v of this.vehicles.values()) targets.push(v.root);
    for (const l of this.loaders.values()) targets.push(l.root);
    targets.push(this.cart.root);
    for (const gt of this.world.gates.values()) targets.push(gt.pad);
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) if (h.object.userData.pick) return h.object.userData.pick;
    return null;
  }

  pick(type, id) {
    selection.set(type, id);
  }

  onSelection() { this.kick(); }

  // ---------------------------------------------------------------- camera API
  preset(name, dur = 1.6) { this.rig.preset(name, reducedMotion() ? 0.01 : dur); }
  focus(type, id) {
    const p = this.positionOf(type, id);
    if (p) this.rig.focusOn(p, type === "gate" ? 120 : type === "vehicle" ? 90 : 150, reducedMotion() ? 0.01 : 1.2);
  }
  follow(spid) {
    if (spid == null) { this.rig.follow = null; return; }
    this.rig.follow = () => this.aircraft.get(spid)?.pos || null;
    const a = this.aircraft.get(spid);
    if (a) this.rig.focusOn(a.pos, 160, 1);
  }
  positionOf(type, id) {
    if (type === "flight") return this.aircraft.get(id)?.pos || null;
    if (type === "gate") return new THREE.Vector3(L.gateX(L.gateIndex(id)), 0, 0);
    if (type === "vehicle") return id === "CART" ? new THREE.Vector3(this.cart.x, 0, L.BELT.z) : this.vehicles.get(id)?.pos || null;
    return null;
  }
  setIntro(on) {
    if (on) {
      this.world.setLightLevel(0, true);
      this.rig.flyTo({ target: [-40, 0, -70], radius: 820, theta: 205 * Math.PI / 180, phi: 70 * Math.PI / 180 }, 0.01);
      this.rig.idleSpin = reducedMotion() ? 0 : 0.035;
      setTimeout(() => this.world.setLightLevel(1), 500);
    } else {
      this.rig.idleSpin = 0;
      this.world.setLightLevel(1);
      this.preset("overview", 2.6);
    }
  }
  // true when no aircraft or vehicle is still travelling (used by Story Mode to pace engine steps)
  settled() {
    for (const a of this.aircraft.values()) if (a.busy || a.waitingTug) return false;
    for (const v of this.vehicles.values()) if (v.move) return false;
    for (const l of this.loaders.values()) if (l.move) return false;
    return Math.abs(this.cart.target - this.cart.x) < 0.5;
  }
  setActive(on) { this.active = on; this.kick(); }
  kick() {
    if (this.active && !document.hidden && !this.rafPending) { this.rafPending = true; requestAnimationFrame(this.loop); }
  }

  // ---------------------------------------------------------------- frame
  loop(now) {
    this.rafPending = false;
    if (!this.active || document.hidden) return;
    const cap = QUALITY[this.quality].cap;
    const elapsed = now - this.clock;
    if (cap && elapsed < 1000 / cap - 1.5) { this.rafPending = true; requestAnimationFrame(this.loop); return; }
    // up to 0.2 s per frame, so slow machines keep pace with the engine instead of falling behind
    const dt = Math.min(0.2, elapsed / 1000);
    this.clock = now;
    const t = now / 1000;
    const reduced = reducedMotion();
    const snap = this.lastSnap;

    // keep the subject visible beside the right-hand panel: shift the projection centre left
    const stage = this.hostEl.parentElement;
    const want = stage && stage.classList.contains("has-context") && this.hostEl.clientWidth > 900 ? 180 : 0;
    this.viewShift = (this.viewShift || 0) + (want - (this.viewShift || 0)) * Math.min(1, dt * 5);
    if (Math.abs(this.viewShift) > 0.5) {
      const w = this.hostEl.clientWidth, h = this.hostEl.clientHeight;
      this.camera.setViewOffset(w, h, this.viewShift, 0, w, h);
    } else if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();
    this.rig.update(dt);
    this.world.update(dt, reduced);

    // Animation tempo follows the engine's real tick length: faster engine, faster motion.
    const ms = snap ? snap.sim.tick_ms : 500;
    const tempo = snap && snap.sim.fast ? 4 : Math.min(3, Math.max(1, Math.pow(800 / Math.max(ms, 1), 0.75)));
    for (const [spid, a] of this.aircraft) {
      a.update(dt, tempo, reduced);
      a.setSelected(selection.is("flight", spid), t);
      a.blink(t, reduced);
      if (a.gone) {
        this.ctx.freeHold(a);
        this.ctx.freeRemote(a);
        this.scene.remove(a.root);
        a.dispose();
        this.aircraft.delete(spid);
      }
    }
    for (const v of this.vehicles.values()) v.update(dt, tempo, this.ctx, reduced);
    for (const [task, l] of this.loaders) {
      l.update(dt, tempo, reduced);
      if (l.finished) { this.scene.remove(l.root); this.loaders.delete(task); }
    }
    this.cart.update(dt, tempo);
    for (const [k, m] of this.bags) {
      const s = m.scale.x + ((m.userData.grow ? 1 : 0) - m.scale.x) * Math.min(1, dt * 6);
      m.scale.setScalar(Math.max(0.001, s));
      if (!m.userData.grow && s < 0.03) { this.scene.remove(m); this.bags.delete(k); }
    }
    // jet bridges connect only when the aircraft is visibly parked at its stand
    if (snap) {
      for (const r of snap.resources) {
        if (r.class !== "GATE") continue;
        const a = r.owner >= 0 ? this.aircraft.get(r.owner) : null;
        const parked = a && a.flight && a.isParked() && a.plan.station === "stand" && a.flight.phase !== "PUSHBACK";
        this.world.setBridgeTarget(r.id, parked ? 1 : 0);
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(snap);
    this.measure(dt);
    this.rafPending = true;
    requestAnimationFrame(this.loop);
  }

  drawOverlay(snap) {
    const mode = settings.labels;
    const items = [];
    const links = [];
    const far = this.rig.radius > 700;
    if (snap) {
      const fm = flightMap(snap);
      const dead = new Set(snap.deadlock.deadlocked);
      for (const [spid, a] of this.aircraft) {
        const f = fm.get(spid);
        if (!f || !a.root.visible) continue;
        const sel = selection.is("flight", spid);
        const key = stateKey(f);
        const st = key === "TERMINATED" ? "DONE" : key;
        const sub = a.waitingTug ? "waiting for tug" : f.state === "BLOCKED" && f.requested.length ? "wants " + f.requested[0].replace("_", " ").toLowerCase() : PHASE_LABEL[f.phase] || "";
        const html = `<span class="sw" style="background:${flightColor(spid)}"></span>${esc(fname(f))}<span class="st" style="color:${STATE_COLOR[key]}">${st}</span><span class="sub">${esc(sub)}</span>`;
        items.push({ key: "f" + spid, world: a.anchor, html, pick: "flight:" + spid, show: mode === "all" || sel, cls: [sel ? "sel" : "", far && !sel ? "small" : "", f.state === "BLOCKED" ? "flag" : "", dead.has(spid) ? "alert" : ""].join(" ") });
      }
      if (mode === "all" && !far) {
        for (const r of snap.resources) {
          if (r.class !== "GATE") continue;
          const gs = gateStatus(snap, r, fm);
          const sel = selection.is("gate", r.id);
          items.push({ key: "g" + r.id, world: new THREE.Vector3(L.gateX(L.gateIndex(r.id)) - 15, 2, 22), html: `<span class="dot" style="background:${gs.color}"></span>${resName(r.id)}`, pick: "gate:" + r.id, show: true, cls: "gate" + (sel ? " sel" : "") });
        }
      }
      for (const v of this.vehicles.values()) {
        if (!v.enabled) continue;
        const sel = selection.is("vehicle", v.id);
        const who = v.workingFor;
        let status = "";
        if (who >= 0) {
          const thr = v.kind === "truck" ? snap.threads.find((t) => t.kind === "service" && t.service === "REFUEL" && t.spid === who && t.task === v.resource?.owner_task) : null;
          status = v.state === "driving" ? "→ " + fname(who) : v.kind === "truck" && thr ? `refuelling ${fname(who)} ${3 - thr.work_left}/3` : v.kind === "tug" ? `pushing ${fname(who)}` : "working";
          const a = this.aircraft.get(who);
          if (a && (settings.links || sel)) links.push({ key: "l" + v.id, a: v.anchor, b: a.anchor, color: flightColor(who), sel: sel || selection.is("flight", who) });
        }
        if (mode === "all" && (!far || who >= 0 || sel))
          items.push({ key: "v" + v.id, world: v.anchor, html: `${resName(v.id)}${status ? `<span class="sub">${esc(status)}</span>` : ""}`, pick: "vehicle:" + v.id, show: true, cls: "veh" + (sel ? " sel" : "") });
      }
      for (const l of this.loaders.values()) {
        if (l.state === "gone") continue;
        const a = this.aircraft.get(l.spid);
        const t = l.thread;
        if (a && (settings.links || selection.is("flight", l.spid))) links.push({ key: "ld" + l.task, a: l.anchor, b: a.anchor, color: flightColor(l.spid), sel: selection.is("flight", l.spid) });
        if (mode === "all" && !far)
          items.push({ key: "ld" + l.task, world: l.anchor, html: `Bags · ${fname(l.spid)}<span class="sub">${t ? `${t.bags_served}/${t.bags_total} picked up` : "worker"}</span>`, pick: "flight:" + l.spid, show: true, cls: "veh" });
      }
      if (mode !== "none") {
        const sel = selection.is("vehicle", "CART");
        items.push({ key: "cart", world: this.cart.anchor, html: `Baggage cart<span class="sub">at spot ${snap.disk.head}${snap.disk.busy ? " · " + snap.disk.algo : ""}</span>`, pick: "vehicle:CART", show: mode === "all" || sel, cls: "veh" + (sel ? " sel" : "") });
      }
    }
    this.overlay.frame(mode === "none" ? items.filter((i) => i.cls.includes("sel")) : items, this.camera);
    this.overlay.frameLinks(links, this.camera);
  }

  measure(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const fps = 1 / avg;
    this.fps = fps;
    appBus.emit("fps", fps, this.renderer.info.render.calls);
    // adaptive resolution: if a heavy frame rate persists, lower the pixel ratio a step
    const cap = QUALITY[this.quality].cap || 60;
    if (fps < Math.min(36, cap * 0.7) && this.dprScale > 0.67) { this.dprScale -= 0.17; this.resize(); appBus.emit("adaptive", this.dprScale); }
  }

  dispose() {
    this.active = false;
    this.unsub?.();
    this.unsubSel?.();
    this.unsubSet?.();
    this.resizeObs?.disconnect();
    this.clearActors();
    this.world.dispose();
    this.renderer.dispose();
  }
}
