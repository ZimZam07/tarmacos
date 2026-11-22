// actors.js - moving things. Each actor animates towards the state the ENGINE reports:
//   AircraftActor  - one per flight (SPID); follows model.flightStation()
//   VehicleActor   - one per fuel truck / tug resource instance; drives to its engine owner
//   LoaderActor    - one per BAGGAGE service pthread (a visual for the thread, not a resource)
//   CartActor      - the baggage cart = disk head; follows snapshot.disk.head
import * as THREE from "three";
import { EASE, Path, groundPath } from "./paths.js";
import * as L from "./layout.js";
import { makeAircraft, makeCart, makeFuelTruck, makeLoader, makeTug } from "./models.js";

const tmpP = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const yawOf = (d) => Math.atan2(d.x, d.z);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const ORDER = { hold: 0, final: 1, roll: 2, taxi_in: 3, stand: 4, push: 5, depart: 6 };

function cloneMaterials(root) {
  const list = [];
  root.traverse((o) => {
    if (o.isMesh && o.material && !o.userData.keepMat) {
      o.material = o.material.clone();
      list.push(o.material);
    }
  });
  return list;
}

function setOpacity(mats, k) {
  for (const m of mats) {
    const t = k < 0.999;
    if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
    m.opacity = k;
    m.depthWrite = !t || k > 0.6;
  }
}

// ======================================================================== aircraft
export class AircraftActor {
  constructor(flight, color, ctx, restore) {
    this.spid = flight.spid;
    this.kind = "aircraft";
    this.ctx = ctx;
    const m = makeAircraft(color);
    this.m = m;
    this.root = m.root;
    m.ring.userData.keepMat = true;
    this.mats = cloneMaterials(this.root);
    this.root.traverse((o) => { if (o.isMesh) o.userData.pick = { type: "flight", id: flight.spid }; });
    m.ring.userData.pick = null;
    this.root.rotation.order = "YXZ";
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.bank = 0;
    this.opacity = 0;
    this.fade = 1;            // fade target (0 = fading out)
    this.queue = [];          // pending steps: { build(pose) -> moves[] }
    this.moves = [];          // materialised moves of the current step
    this.cur = null;          // { move, t, wait }
    this.plan = { station: "hidden", gate: null, slot: -1, level: -1 };
    this.lastGate = null;
    this.restore = restore;
    this.gone = false;        // fully faded out; host removes it
    this.selected = false;
    this.anchor = new THREE.Vector3();
    this.waitingTug = false;
    this.root.visible = false;
  }

  get moving() { return !!this.cur || this.queue.length > 0 || this.moves.length > 0; }
  get busy() { return this.moving && !(this.cur && this.cur.move.loop && !this.queue.length); }

  // ---------------------------------------------------------------- planning
  setStation(st, flight) {
    if (st.gate) this.lastGate = st.gate;
    const from = this.plan.station;
    const to = st.key;
    if (to === "hidden") return;
    if (from === to && (to !== "remote" || this.plan.slot >= 0)) return;

    if (from === "hidden") return this.appear(st, flight);

    if (to === "vanish" || to === "arrived") {
      this.leaveHold();
      this.queue.push({ tick: this.ctx.tick(), build: () => [{ fade: true, dur: to === "arrived" ? 2.2 : 1.6 }] });
      this.plan.station = to;
      return;
    }
    if (to === "remote") {
      const slot = this.ctx.takeRemote(this);
      if (from === "stand" || from === "push") {
        const gate = this.plan.gate || this.lastGate;
        this.queue.push({ tick: this.ctx.tick(), build: () => L.moveStandToRemote(gate, L.remoteSlot(slot)) });
      } else if (from !== "remote") {
        this.queue.push({ tick: this.ctx.tick(), build: () => [{ fade: true, dur: 0.8 }, { place: L.remotePose(L.remoteSlot(slot)) }] });
      }
      this.plan = { station: "remote", gate: null, slot, level: -1 };
      return;
    }
    if (from === "remote") {
      const slot = this.plan.slot;
      if (to === "stand" || to === "push" || to === "taxi_in") {
        const gate = st.gate;
        this.queue.push({ tick: this.ctx.tick(), build: () => { this.ctx.freeRemote(this); return L.moveRemoteToStand(L.remoteSlot(slot), gate); } });
        this.plan = { station: "stand", gate, slot: -1, level: -1 };
        if (to === "push") return this.setStation(st, flight);
        return;
      }
      if (to === "depart") {
        this.queue.push({ tick: this.ctx.tick(), build: () => { this.ctx.freeRemote(this); return [L.moveRemoteToRunway(L.remoteSlot(slot)), ...L.moveTakeoff()]; } });
        this.plan = { station: "depart", gate: null, slot: -1, level: -1 };
        return;
      }
    }
    if (ORDER[from] !== undefined && ORDER[to] !== undefined && ORDER[to] > ORDER[from]) {
      for (let k = ORDER[from] + 1; k <= ORDER[to]; k++) this.stepTo(Object.keys(ORDER)[k], st);
      return;
    }
    if (to === "hold" && from !== "hold") {
      // e.g. a victim rolled back while inbound: rejoin the stack
      this.queue.push({ tick: this.ctx.tick(), build: (pose) => L.moveToHold(pose.pos, this.ctx.takeHold(this)) });
      this.plan.station = "hold";
      return;
    }
    // Anything else cannot be animated physically (should not happen with the engine's scripts):
    // fade out and in at the new station rather than jump.
    this.queue.push({ tick: this.ctx.tick(), build: () => [{ fade: true, dur: 0.8 }, { place: this.restPose(st) }] });
    this.plan.station = to;
  }

  stepTo(station, st) {
    const gate = st.gate || this.plan.gate || this.lastGate;
    switch (station) {
      case "final":
        this.queue.push({ tick: this.ctx.tick(), build: (pose) => { this.leaveHold(); return L.moveFinal(pose.pos); } });
        break;
      case "roll":
        this.queue.push({ tick: this.ctx.tick(), build: () => L.moveRoll() });
        break;
      case "taxi_in":
        if (gate) this.queue.push({ tick: this.ctx.tick(), build: () => L.moveTaxiIn(gate) });
        break;
      case "stand":
        break;
      case "push":
        if (gate) {
          this.pushPending = true;
          this.queue.push({ tick: this.ctx.tick(), build: () => L.movePush(gate, st.tug || true) });
        }
        break;
      case "depart":
        this.queue.push({
          build: (pose) => {
            const moves = [];
            if (this.plan.pushed !== true && gate && pose.pos.distanceTo(L.standPose(gate).pos) < 4) moves.push(...L.movePush(gate, null));
            const start = moves.length ? moves[0].path.end : pose.pos;
            moves.push(L.moveTaxiOutFrom(start), ...L.moveTakeoff());
            return moves;
          },
        });
        break;
      default:
        break;
    }
    this.plan.station = station;
    if (gate) this.plan.gate = gate;
    if (station === "push") this.plan.pushed = true;
  }

  restPose(st) {
    switch (st.key) {
      case "stand": case "taxi_in": return L.standPose(st.gate);
      case "push": { const p = L.pushbackPath(st.gate); return { pos: p.end.clone(), dir: new THREE.Vector3(-1, 0, 0) }; }
      case "roll": return { pos: new THREE.Vector3(L.RWY.touchdown + 120, 0, L.RWY.z), dir: new THREE.Vector3(1, 0, 0) };
      case "final": return { pos: new THREE.Vector3(-560, 22, L.RWY.z), dir: new THREE.Vector3(1, -0.05, 0).normalize() };
      default: return { pos: L.ENTRY.clone(), dir: new THREE.Vector3(1, 0, 0.2).normalize() };
    }
  }

  appear(st, flight) {
    this.root.visible = true;
    this.fade = 1;
    const key = st.key;
    if (key === "depart" || key === "arrived" || key === "vanish") { this.gone = true; return; }
    const live = !this.restore;
    if (key === "remote") {
      const slot = this.ctx.takeRemote(this);
      this.placeAt(L.remotePose(L.remoteSlot(slot)));
      this.plan = { station: "remote", gate: null, slot, level: -1 };
      return;
    }
    if (key === "hold") {
      const level = this.ctx.takeHold(this);
      const loop = L.holdLoop(level);
      if (live) {
        this.placeAt({ pos: L.ENTRY.clone(), dir: tmpD.copy(loop.pts[0]).sub(L.ENTRY).normalize().clone() });
        this.queue.push({ tick: this.ctx.tick(), build: (pose) => L.moveToHold(pose.pos, level) });
      } else {
        this.placeAt({ pos: loop.pts[0].clone(), dir: new THREE.Vector3(1, 0, 0) });
        this.queue.push({ tick: this.ctx.tick(), build: () => [{ path: loop, dur: loop.length / 45, loop: true, air: true }] });
      }
      this.plan = { station: "hold", gate: null, slot: -1, level };
      return;
    }
    if (live && ORDER[key] !== undefined && ORDER[key] >= ORDER.final && L.arrivesByAirOp(flight.op)) {
      this.placeAt({ pos: L.ENTRY.clone(), dir: new THREE.Vector3(1, -0.1, 0.25).normalize() });
      this.plan = { station: "hold", gate: null, slot: -1, level: -1 };
      return this.setStation(st, flight);
    }
    this.placeAt(this.restPose(st));
    this.plan = { station: key, gate: st.gate, slot: -1, level: -1, pushed: key === "push" };
  }

  placeAt(pose) {
    this.pos.copy(pose.pos);
    this.yaw = yawOf(pose.dir);
    this.pitch = -Math.asin(Math.max(-1, Math.min(1, pose.dir.y || 0)));
    this.opacity = 0;
    this.applyTransform();
  }

  leaveHold() { this.ctx.freeHold(this); }

  // ---------------------------------------------------------------- per frame
  update(dt, speed, reduced) {
    if (this.plan.station === "hidden" && !this.moving) return;
    // pull the next step when idle (or when a holding loop must be left)
    if ((!this.cur && !this.moves.length && this.queue.length) || (this.cur && this.cur.move.loop && this.queue.length && !this.moves.length)) {
      const step = this.queue.shift();
      this.moves = step.build({ pos: this.pos.clone(), yaw: this.yaw }) || [];
      for (const m of this.moves) m.tick = step.tick;
      this.cur = null;
    }
    if (!this.cur && this.moves.length) this.cur = { move: this.moves.shift(), t: 0, wait: 0 };

    // Stay in step with the engine: speed up with queued moves and with how many engine ticks ago the
    // current move was requested (a couple of ticks of lag is normal; more means we are behind).
    const backlog = this.queue.length + this.moves.length;
    const lagTicks = this.cur && this.cur.move.tick != null ? Math.max(0, this.ctx.tick() - this.cur.move.tick - 2) : 0;
    const catchUp = reduced ? 3 : (1 + 1.8 * backlog) * (1 + 0.45 * lagTicks);
    let targetYaw = this.yaw, targetPitch = 0, airborne = this.pos.y > 1.5;
    this.waitingTug = false;
    const c = this.cur;
    if (c) {
      const mv = c.move;
      if (mv.place) {
        this.placeAt(mv.place);
        this.cur = null;
      } else if (mv.fade) {
        this.fade = 0;
        c.t += (dt * speed) / mv.dur;
        if (c.t >= 1) { this.cur = null; if (!this.moves.length && !this.queue.length && (this.plan.station === "vanish" || this.plan.station === "arrived")) this.gone = true; else this.fade = 1; }
      } else if (mv.loop) {
        c.t = (c.t + (dt * speed) / mv.dur) % 1;
        mv.path.at(c.t, this.pos, tmpD);
        targetYaw = yawOf(tmpD);
      } else {
        if (mv.needsTug && !this.ctx.tugAttached(this.spid) && c.wait < 12) {
          c.wait += dt;
          this.waitingTug = true;
        } else {
          c.t = Math.min(1, c.t + (dt * speed * catchUp) / mv.dur);
          const u = (EASE[mv.ease] || EASE.inOut)(c.t);
          mv.path.at(u, this.pos, tmpD);
          if (mv.reverse) tmpD.negate();
          targetYaw = yawOf(tmpD);
          targetPitch = mv.air ? -Math.asin(Math.max(-0.5, Math.min(0.5, tmpD.y))) : 0;
          if (mv.fadeOut) this.fade = c.t > 0.55 ? 0 : 1;
          if (c.t >= 1) {
            this.cur = null;
            if (mv.needsTug) this.pushPending = false;
            if (mv.fadeOut && !this.moves.length) this.gone = true;
          }
        }
      }
    }
    // smooth heading, pitch and bank
    const dy = angDiff(this.yaw, targetYaw);
    const rate = airborne ? 3.2 : 6;
    const turn = dy * Math.min(1, dt * rate);
    this.yaw += turn;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 3);
    const bankTarget = airborne ? Math.max(-0.5, Math.min(0.5, -(turn / Math.max(dt, 1e-3)) * 0.45)) : 0;
    this.bank += (bankTarget - this.bank) * Math.min(1, dt * 2.5);
    // fade
    const ft = this.fade;
    this.opacity += (ft - this.opacity) * Math.min(1, dt * (reduced ? 20 : 3));
    this.applyTransform();
    this.m.gear.visible = this.pos.y < 26;
    this.anchor.copy(this.pos).add(tmpP.set(0, 14, 0));
  }

  applyTransform() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.yaw, this.bank);
    setOpacity(this.mats, Math.max(0.001, this.opacity));
    this.root.visible = this.opacity > 0.01 || this.fade > 0;
  }

  // nose / wing service points in world space, from the PARKED pose the engine implies
  // Where the aircraft is parked according to the engine (its stand or remote slot), or where it is now.
  parkedPose() {
    const st = this.plan.station;
    if ((st === "stand" || st === "taxi_in" || st === "push") && this.plan.gate) { const p = L.standPose(this.plan.gate); return { pos: p.pos, yaw: 0 }; }
    if (st === "remote" && this.plan.slot >= 0) { const s = L.remoteSlot(this.plan.slot); return { pos: new THREE.Vector3(s.x, 0, s.z), yaw: Math.PI / 2 }; }
    return { pos: this.pos.clone().setY(0), yaw: this.yaw };
  }

  // Standing still at its parked pose (a pushback that is waiting for its tug counts as standing still).
  isParked() { const p = this.parkedPose(); return this.pos.distanceTo(p.pos) < 2.5 && (!this.cur || this.cur.t === 0); }

  servicePose(kind, live = false) {
    const base = live ? { pos: this.pos.clone().setY(0), yaw: this.yaw } : this.parkedPose();
    const yaw = base.yaw;
    const local = kind === "tug" ? new THREE.Vector3(0, 0, 24.5) : kind === "loader" ? new THREE.Vector3(6.5, 0, -9) : new THREE.Vector3(-12.5, 0, -1.5);
    local.applyAxisAngle(UP, yaw);
    const pos = base.pos.clone().add(local);
    const dyaw = kind === "tug" ? yaw + Math.PI : kind === "loader" ? yaw - Math.PI / 2 : yaw;
    return { pos, dir: new THREE.Vector3(Math.sin(dyaw), 0, Math.cos(dyaw)) };
  }

  setSelected(on, now) {
    this.selected = on;
    this.m.ring.material.opacity = on ? 0.55 + 0.25 * Math.sin(now * 3) : 0;
  }

  blink(now, reduced) {
    if (reduced) return;
    const b = Math.sin(now * 5 + this.spid) > 0.92;
    this.m.beacon.material.color.setHex(b ? 0xff4b5c : 0x3a0f16);
    this.m.strobe.material.color.setHex(Math.sin(now * 3.1 + this.spid * 2) > 0.97 ? 0xffffff : 0x40464f);
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.m.ring.material.dispose();
  }
}

// ======================================================================== vehicles (truck / tug)
export class VehicleActor {
  constructor(id, kind, homeIndex) {
    this.id = id;
    this.kind = kind;
    this.root = kind === "tug" ? makeTug() : makeFuelTruck();
    this.root.traverse((o) => { if (o.isMesh) o.userData.pick = { type: "vehicle", id }; });
    const hx = L.DEPOT.x + homeIndex * 14 + 1;
    this.home = { pos: new THREE.Vector3(hx, 0, kind === "tug" ? L.DEPOT.z + 21 : L.DEPOT.z), dir: new THREE.Vector3(0, 0, kind === "tug" ? 1 : -1) };
    this.pos = this.home.pos.clone();
    this.yaw = yawOf(this.home.dir);
    this.owner = -1;
    this.releaseWhenPushed = -1;
    this.state = "home"; // home | driving | serving | attached | returning
    this.move = null;
    this.enabled = true;
    this.anchor = new THREE.Vector3();
    this.applyTransform();
  }

  setOwner(spid, aircraft, ctx) {
    if (spid === this.owner) return;
    const prev = this.owner;
    this.owner = spid;
    if (spid >= 0 && aircraft) {
      this.releaseWhenPushed = -1;
      this.drive(aircraft.servicePose(this.kind === "tug" ? "tug" : "truck"), "serving");
    } else if (this.kind === "tug" && prev >= 0 && ctx && ctx.needsTug(prev)) {
      // The engine already released the tug, but the pushback it performed has not been drawn yet:
      // stay with the aircraft until the animation of that pushback is complete.
      this.releaseWhenPushed = prev;
    } else if (this.state !== "home") {
      this.drive(this.home, "home");
    }
  }

  drive(target, endState) {
    const path = L.vehiclePath(this.pos, target.pos, target.dir);
    this.move = { path, t: 0, dur: Math.min(7, Math.max(2, path.length / 30)), endState, endYaw: yawOf(target.dir) };
    this.state = endState === "home" ? "returning" : "driving";
  }

  // The flight this vehicle is visually working for (owner, or the flight whose pushback it finishes).
  get workingFor() { return this.owner >= 0 ? this.owner : this.releaseWhenPushed >= 0 ? this.releaseWhenPushed : -1; }

  update(dt, speed, ctx, reduced) {
    const who = this.workingFor;
    if (this.state === "attached") {
      const ac = ctx.aircraft(who);
      if (ac) {
        const p = ac.servicePose("tug", true);
        this.pos.copy(p.pos);
        this.yaw = yawOf(p.dir);
      }
      if (this.owner < 0 && (this.releaseWhenPushed < 0 || !ctx.needsTug(this.releaseWhenPushed))) {
        this.releaseWhenPushed = -1;
        this.drive(this.home, "home");
      }
    } else if (this.move) {
      const mv = this.move;
      mv.t = Math.min(1, mv.t + (dt * speed * (reduced ? 3 : 1)) / mv.dur);
      mv.path.at(EASE.inOut(mv.t), this.pos, tmpD);
      const target = mv.t > 0.97 ? mv.endYaw : yawOf(tmpD);
      this.yaw += angDiff(this.yaw, target) * Math.min(1, dt * 8);
      if (mv.t >= 1) {
        this.move = null;
        this.state = mv.endState;
        this.yaw = mv.endYaw;
      }
    } else if (this.state === "serving" && this.kind === "tug" && who >= 0) {
      // couple to the nose only once the aircraft is really standing where the tug waits
      const ac = ctx.aircraft(who);
      if (ac && ac.isParked()) this.state = "attached";
      else if (!ac && this.owner < 0) this.drive(this.home, "home");
    } else if (this.state === "serving" && this.owner < 0 && who < 0) {
      this.drive(this.home, "home");
    }
    this.applyTransform();
    this.anchor.copy(this.pos).add(tmpP.set(0, 6, 0));
  }

  applyTransform() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.visible = this.enabled;
  }
}

// ======================================================================== baggage loader (BAGGAGE pthread)
export class LoaderActor {
  constructor(task, spid) {
    this.task = task;
    this.spid = spid;
    this.root = makeLoader();
    this.root.traverse((o) => { if (o.isMesh) o.userData.pick = { type: "flight", id: spid }; });
    this.pos = new THREE.Vector3(L.DEPOT.x + 62, 0, L.DEPOT.z + 10);
    this.yaw = -Math.PI / 2;
    this.move = null;
    this.state = "new"; // new | driving | serving | leaving | gone
    this.scale = 0.01;
    this.anchor = new THREE.Vector3();
    this.applyTransform();
  }

  goTo(aircraft) {
    const t = aircraft.servicePose("loader");
    const path = L.vehiclePath(this.pos, t.pos, t.dir);
    this.move = { path, t: 0, dur: Math.min(7, Math.max(2, path.length / 30)), endYaw: yawOf(t.dir), end: "serving" };
    this.state = "driving";
  }

  leave() {
    if (this.state === "leaving" || this.state === "gone") return;
    const home = { pos: new THREE.Vector3(L.DEPOT.x + 62, 0, L.DEPOT.z + 10), dir: new THREE.Vector3(1, 0, 0) };
    const path = L.vehiclePath(this.pos, home.pos, home.dir);
    this.move = { path, t: 0, dur: Math.min(8, Math.max(2, path.length / 20)), endYaw: Math.PI / 2, end: "gone" };
    this.state = "leaving";
  }

  update(dt, speed, reduced) {
    if (this.move) {
      const mv = this.move;
      mv.t = Math.min(1, mv.t + (dt * speed * (reduced ? 3 : 1)) / mv.dur);
      mv.path.at(EASE.inOut(mv.t), this.pos, tmpD);
      this.yaw += angDiff(this.yaw, mv.t > 0.97 ? mv.endYaw : yawOf(tmpD)) * Math.min(1, dt * 8);
      if (mv.t >= 1) { this.move = null; this.state = mv.end; }
    }
    const target = this.state === "gone" ? 0 : 1;
    this.scale += (target - this.scale) * Math.min(1, dt * 4);
    this.applyTransform();
    this.anchor.copy(this.pos).add(tmpP.set(0, 6, 0));
  }

  get finished() { return this.state === "gone" && this.scale < 0.03; }

  applyTransform() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.scale.setScalar(Math.max(0.001, this.scale));
  }
}

// ======================================================================== baggage cart (disk head)
export class CartActor {
  constructor() {
    this.root = makeCart();
    this.root.traverse((o) => { if (o.isMesh) o.userData.pick = { type: "vehicle", id: "CART" }; });
    this.x = L.beltX(20);
    this.target = this.x;
    this.dirSign = 1;
    this.yaw = Math.PI / 2;
    this.anchor = new THREE.Vector3();
    this.apply();
  }
  setHead(head, instant) {
    this.target = L.beltX(head);
    if (instant) this.x = this.target;
  }
  update(dt, speed) {
    const d = this.target - this.x;
    const maxStep = dt * speed * 34;
    this.x += Math.sign(d) * Math.min(Math.abs(d), maxStep);
    if (Math.abs(d) > 0.3) this.dirSign = Math.sign(d);
    const targetYaw = this.dirSign > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.yaw += angDiff(this.yaw, targetYaw) * Math.min(1, dt * 5);
    this.apply();
    this.anchor.set(this.x, 6, L.BELT.z);
  }
  apply() {
    this.root.position.set(this.x, 0, L.BELT.z - 2.5);
    this.root.rotation.y = this.yaw;
  }
}

export { Path, groundPath };
